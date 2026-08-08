import {
  getMaximumPositivePrototypeCosine,
  type PositivePrototypeGate,
  type PositivePrototypeGatePolicy,
} from "../matching/positiveGatedOnnxRuntime";
import {
  getSkillMatcherSkillMetadata,
  type SkillMatcherBundleId,
  type SkillMatcherBundleSkillId,
} from "./skillMatcherBundleRegistry";

export type SkillMatcherBundlePolicy = {
  contractVersion: 1;
  bundleId: SkillMatcherBundleId;
  modelId: string;
  modelVersion: string;
  variantId: string;
  files: {
    onnx: string;
    onnxData: string;
    policy: string;
    [key: string]: string | null;
  };
  labels: string[];
  skills: SkillMatcherBundleSkillId[];
  backgroundLabel: string;
  scoreKind: "logitMargin";
  thresholds: Partial<Record<SkillMatcherBundleSkillId, number>>;
  input: {
    shape: [number, number, number, number];
    layout: "CHW";
    color: "RGB";
    normalization: string;
  };
  output: {
    logits: {
      name: string;
      shape: [number, number];
      order: string[];
    };
    embedding: {
      name: string;
      shape: [number, number];
      normalization: string;
    };
  };
  modelConfig: {
    embeddingDim: number;
    logitScale: number;
  };
  postGates: Partial<Record<SkillMatcherBundleSkillId, SkillMatcherPostGatePolicy>>;
};

export type SkillMatcherPostGatePolicy = PositivePrototypeGatePolicy;

export type SkillMatcherPositiveGate = PositivePrototypeGate<SkillMatcherBundleSkillId>;

export type SkillMatcherBundleDecisionReason =
  | "base_below_threshold"
  | "base_target_disabled"
  | "positive_gate_below_threshold"
  | "cross_bundle_conflict"
  | "target_accepted";

export type SkillMatcherCandidateDecisionReason =
  | SkillMatcherBundleDecisionReason
  | "not_base_target";

export type SkillMatcherBundleCandidate = {
  bundleId: SkillMatcherBundleId;
  modelVersion: string;
  detectorId: string;
  skillId: SkillMatcherBundleSkillId;
  appSkillId: string;
  slug: string;
  displayName: string;
  label: string;
  matched: boolean;
  baseSelected: boolean;
  score: number;
  threshold: number;
  margin: number;
  gateScore: number | null;
  gateThreshold: number | null;
  gateMargin: number | null;
  decisionReason: SkillMatcherCandidateDecisionReason;
};

export type SkillMatcherSingleBundleDecision = {
  bundleId: SkillMatcherBundleId;
  modelVersion: string;
  kind: "target" | "unknown";
  skillId: SkillMatcherBundleSkillId | null;
  baseSkillId: SkillMatcherBundleSkillId | null;
  decisionReason: Exclude<SkillMatcherBundleDecisionReason, "cross_bundle_conflict">;
  bestMatch: SkillMatcherBundleCandidate | null;
  candidates: SkillMatcherBundleCandidate[];
};

export type SkillMatcherBundleMatchResult = {
  kind: "target" | "unknown";
  matched: boolean;
  skillId: SkillMatcherBundleSkillId | null;
  appSkillId: string | null;
  slug: string | null;
  displayName: string | null;
  label: string | null;
  bundleId: SkillMatcherBundleId | null;
  modelVersion: string | null;
  baseSkillId: SkillMatcherBundleSkillId | null;
  score: number;
  margin: number;
  gateScore: number | null;
  gateThreshold: number | null;
  gateMargin: number | null;
  decisionReason: SkillMatcherBundleDecisionReason;
  bestMatch: SkillMatcherBundleCandidate | null;
  candidates: SkillMatcherBundleCandidate[];
  bundleDecisions: SkillMatcherSingleBundleDecision[];
  elapsedMs: number;
};

export type DecideSkillMatcherBundleBatchInput = {
  policy: SkillMatcherBundlePolicy;
  logits: Float32Array;
  embeddings: Float32Array;
  imageCount: number;
  activeSkillIds: ReadonlySet<SkillMatcherBundleSkillId>;
  gates: ReadonlyMap<SkillMatcherBundleSkillId, SkillMatcherPositiveGate>;
};

export function decideSkillMatcherBundleBatch({
  policy,
  logits,
  embeddings,
  imageCount,
  activeSkillIds,
  gates,
}: DecideSkillMatcherBundleBatchInput): SkillMatcherSingleBundleDecision[] {
  const outputOrder = policy.output.logits.order;
  const embeddingDim = policy.modelConfig.embeddingDim;
  if (logits.length !== imageCount * outputOrder.length) {
    throw new Error(`skill-matcher-logit-shape-mismatch:${policy.bundleId}`);
  }
  if (embeddings.length !== imageCount * embeddingDim) {
    throw new Error(`skill-matcher-embedding-shape-mismatch:${policy.bundleId}`);
  }

  return Array.from({ length: imageCount }, (_, imageIndex) => {
    const candidates = buildBaseCandidates(policy, logits, imageIndex);
    const baseCandidate = candidates.reduce<SkillMatcherBundleCandidate | null>(
      (best, candidate) => !best || candidate.margin > best.margin ? candidate : best,
      null,
    );
    if (!baseCandidate || baseCandidate.margin < 0) {
      return buildUnknownDecision(
        policy,
        candidates,
        baseCandidate,
        "base_below_threshold",
      );
    }
    if (!activeSkillIds.has(baseCandidate.skillId)) {
      return buildUnknownDecision(
        policy,
        candidates,
        baseCandidate,
        "base_target_disabled",
      );
    }

    const gate = gates.get(baseCandidate.skillId);
    const gatePolicy = policy.postGates[baseCandidate.skillId];
    if (!gate || !gatePolicy) {
      throw new Error(`skill-matcher-gate-missing:${policy.bundleId}:${baseCandidate.skillId}`);
    }
    const embeddingOffset = imageIndex * embeddingDim;
    const gateScore = getMaximumPositivePrototypeCosine(
      embeddings,
      embeddingOffset,
      gate,
    );
    const gateMargin = gateScore - gate.threshold;
    if (gateMargin < 0) {
      return buildUnknownDecision(
        policy,
        candidates,
        baseCandidate,
        "positive_gate_below_threshold",
        gateScore,
        gate.threshold,
      );
    }

    const accepted = withCandidateDecision(
      baseCandidate,
      true,
      "target_accepted",
      gateScore,
      gate.threshold,
    );
    return {
      bundleId: policy.bundleId,
      modelVersion: policy.modelVersion,
      kind: "target",
      skillId: accepted.skillId,
      baseSkillId: accepted.skillId,
      decisionReason: "target_accepted",
      bestMatch: accepted,
      candidates: replaceCandidate(candidates, accepted),
    };
  });
}

export function mergeSkillMatcherBundleDecisions(
  decisionsByBundle: readonly SkillMatcherSingleBundleDecision[][],
  elapsedMs: number,
): SkillMatcherBundleMatchResult[] {
  const imageCount = decisionsByBundle[0]?.length ?? 0;
  if (!decisionsByBundle.every((decisions) => decisions.length === imageCount)) {
    throw new Error("skill-matcher-bundle-result-length-mismatch");
  }

  return Array.from({ length: imageCount }, (_, imageIndex) => {
    const bundleDecisions = decisionsByBundle.map((decisions) => decisions[imageIndex]);
    const accepted = bundleDecisions.filter(
      (decision): decision is SkillMatcherSingleBundleDecision & {
        kind: "target";
        bestMatch: SkillMatcherBundleCandidate;
      } => decision.kind === "target" && decision.bestMatch !== null,
    );
    const candidates = bundleDecisions.flatMap((decision) => decision.candidates);

    if (accepted.length === 1) {
      const decision = accepted[0];
      const bestMatch = decision.bestMatch;
      return {
        kind: "target",
        matched: true,
        skillId: bestMatch.skillId,
        appSkillId: bestMatch.appSkillId,
        slug: bestMatch.slug,
        displayName: bestMatch.displayName,
        label: bestMatch.label,
        bundleId: bestMatch.bundleId,
        modelVersion: bestMatch.modelVersion,
        baseSkillId: decision.baseSkillId,
        score: bestMatch.score,
        margin: bestMatch.margin,
        gateScore: bestMatch.gateScore,
        gateThreshold: bestMatch.gateThreshold,
        gateMargin: bestMatch.gateMargin,
        decisionReason: "target_accepted",
        bestMatch,
        candidates,
        bundleDecisions,
        elapsedMs,
      };
    }

    if (accepted.length > 1) {
      const acceptedKeys = new Set(accepted.map(
        (decision) => `${decision.bundleId}:${decision.bestMatch.skillId}`,
      ));
      const conflictedCandidates = candidates.map((candidate) => (
        acceptedKeys.has(`${candidate.bundleId}:${candidate.skillId}`)
          ? withCandidateDecision(candidate, false, "cross_bundle_conflict")
          : candidate
      ));
      return buildMergedUnknownResult({
        bundleDecisions,
        candidates: conflictedCandidates,
        decisionReason: "cross_bundle_conflict",
        elapsedMs,
      });
    }

    return buildMergedUnknownResult({
      bundleDecisions,
      candidates,
      decisionReason: getMergedUnknownReason(bundleDecisions),
      elapsedMs,
    });
  });
}

function buildBaseCandidates(
  policy: SkillMatcherBundlePolicy,
  logits: Float32Array,
  imageIndex: number,
): SkillMatcherBundleCandidate[] {
  const outputOrder = policy.output.logits.order;
  const rowOffset = imageIndex * outputOrder.length;
  return policy.skills.map((skillId) => {
    const labelIndex = outputOrder.indexOf(skillId);
    if (labelIndex < 0) {
      throw new Error(`skill-matcher-label-missing:${policy.bundleId}:${skillId}`);
    }
    const targetLogit = logits[rowOffset + labelIndex] ?? Number.NEGATIVE_INFINITY;
    let otherMax = Number.NEGATIVE_INFINITY;
    outputOrder.forEach((_, index) => {
      if (index !== labelIndex) {
        otherMax = Math.max(otherMax, logits[rowOffset + index] ?? Number.NEGATIVE_INFINITY);
      }
    });
    const threshold = policy.thresholds[skillId];
    if (typeof threshold !== "number") {
      throw new Error(`skill-matcher-threshold-missing:${policy.bundleId}:${skillId}`);
    }
    const score = targetLogit - otherMax;
    const metadata = getSkillMatcherSkillMetadata(skillId);
    return {
      bundleId: policy.bundleId,
      modelVersion: policy.modelVersion,
      detectorId: metadata.detectorId,
      skillId,
      appSkillId: metadata.appSkillId,
      slug: metadata.slug,
      displayName: metadata.displayName,
      label: skillId,
      matched: false,
      baseSelected: false,
      score: round(score),
      threshold,
      margin: round(score - threshold),
      gateScore: null,
      gateThreshold: policy.postGates[skillId]?.threshold ?? null,
      gateMargin: null,
      decisionReason: "not_base_target",
    };
  });
}

function buildUnknownDecision(
  policy: SkillMatcherBundlePolicy,
  candidates: SkillMatcherBundleCandidate[],
  baseCandidate: SkillMatcherBundleCandidate | null,
  decisionReason: Exclude<SkillMatcherBundleDecisionReason, "cross_bundle_conflict" | "target_accepted">,
  gateScore: number | null = null,
  gateThreshold: number | null = null,
): SkillMatcherSingleBundleDecision {
  const bestMatch = baseCandidate
    ? withCandidateDecision(
        baseCandidate,
        false,
        decisionReason,
        gateScore,
        gateThreshold,
      )
    : null;
  return {
    bundleId: policy.bundleId,
    modelVersion: policy.modelVersion,
    kind: "unknown",
    skillId: null,
    baseSkillId: baseCandidate?.skillId ?? null,
    decisionReason,
    bestMatch,
    candidates: bestMatch ? replaceCandidate(candidates, bestMatch) : candidates,
  };
}

function withCandidateDecision(
  candidate: SkillMatcherBundleCandidate,
  matched: boolean,
  decisionReason: SkillMatcherCandidateDecisionReason,
  gateScore: number | null = candidate.gateScore,
  gateThreshold: number | null = candidate.gateThreshold,
): SkillMatcherBundleCandidate {
  return {
    ...candidate,
    matched,
    baseSelected: true,
    gateScore: gateScore === null ? null : round(gateScore),
    gateThreshold,
    gateMargin:
      gateScore === null || gateThreshold === null
        ? null
        : round(gateScore - gateThreshold),
    decisionReason,
  };
}

function replaceCandidate(
  candidates: SkillMatcherBundleCandidate[],
  replacement: SkillMatcherBundleCandidate,
): SkillMatcherBundleCandidate[] {
  return candidates.map((candidate) => (
    candidate.skillId === replacement.skillId ? replacement : candidate
  ));
}

function getMergedUnknownReason(
  decisions: readonly SkillMatcherSingleBundleDecision[],
): Exclude<SkillMatcherBundleDecisionReason, "cross_bundle_conflict" | "target_accepted"> {
  if (decisions.some((decision) => decision.decisionReason === "positive_gate_below_threshold")) {
    return "positive_gate_below_threshold";
  }
  if (decisions.some((decision) => decision.decisionReason === "base_target_disabled")) {
    return "base_target_disabled";
  }
  return "base_below_threshold";
}

function buildMergedUnknownResult({
  bundleDecisions,
  candidates,
  decisionReason,
  elapsedMs,
}: {
  bundleDecisions: SkillMatcherSingleBundleDecision[];
  candidates: SkillMatcherBundleCandidate[];
  decisionReason: Exclude<SkillMatcherBundleDecisionReason, "target_accepted">;
  elapsedMs: number;
}): SkillMatcherBundleMatchResult {
  const bestMatch = bundleDecisions.length === 1 ? bundleDecisions[0]?.bestMatch ?? null : null;
  return {
    kind: "unknown",
    matched: false,
    skillId: null,
    appSkillId: null,
    slug: null,
    displayName: null,
    label: null,
    bundleId: bestMatch?.bundleId ?? null,
    modelVersion: bestMatch?.modelVersion ?? null,
    baseSkillId: bestMatch?.skillId ?? null,
    score: bestMatch?.score ?? -1,
    margin: bestMatch?.margin ?? -1,
    gateScore: bestMatch?.gateScore ?? null,
    gateThreshold: bestMatch?.gateThreshold ?? null,
    gateMargin: bestMatch?.gateMargin ?? null,
    decisionReason,
    bestMatch,
    candidates,
    bundleDecisions,
    elapsedMs,
  };
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
