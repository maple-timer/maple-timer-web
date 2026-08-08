import {
  getMaximumPositivePrototypeCosine,
  type PositiveGatedOnnxPolicy,
  type PositivePrototypeGate,
  type PositivePrototypeGatePolicy,
} from "../../matching/positiveGatedOnnxRuntime";
import type { BuffExpiryTargetGroup } from "../../../contracts/recognition/buffExpiryRecognition";
import type { BuffGroupMatcherBundleId } from "./buffGroupMatcherBundleRegistry";

export type BuffGroupMatcherBundlePolicy = PositiveGatedOnnxPolicy & {
  contractVersion: 1;
  bundleId: BuffGroupMatcherBundleId;
  modelId: string;
  modelVersion: string;
  variantId: string;
  labels: string[];
  groups: BuffExpiryTargetGroup[];
  backgroundLabel: string;
  scoreKind: "logitMargin";
  thresholds: Partial<Record<BuffExpiryTargetGroup, number>>;
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
  postGates: Partial<Record<BuffExpiryTargetGroup, PositivePrototypeGatePolicy>>;
};

export type BuffGroupMatcherDecisionReason =
  | "base_below_threshold"
  | "positive_gate_below_threshold"
  | "cross_bundle_conflict"
  | "target_accepted";

export type BuffGroupMatcherBundleCandidate = {
  group: BuffExpiryTargetGroup;
  bundleId: BuffGroupMatcherBundleId;
  modelVersion: string;
  accepted: boolean;
  score: number;
  threshold: number;
  margin: number;
  gateScore: number | null;
  gateThreshold: number;
  gateMargin: number | null;
  decisionReason: Exclude<BuffGroupMatcherDecisionReason, "cross_bundle_conflict">;
};

export type BuffGroupMatcherSingleBundleDecision = {
  group: BuffExpiryTargetGroup;
  bundleId: BuffGroupMatcherBundleId;
  modelVersion: string;
  kind: "target" | "unknown";
  decisionReason: Exclude<BuffGroupMatcherDecisionReason, "cross_bundle_conflict">;
  candidate: BuffGroupMatcherBundleCandidate;
};

export type BuffGroupMatcherMatchResult = {
  kind: "target" | "unknown";
  group: BuffExpiryTargetGroup | null;
  bundleId: BuffGroupMatcherBundleId | null;
  modelVersion: string | null;
  score: number | null;
  margin: number | null;
  gateScore: number | null;
  gateMargin: number | null;
  decisionReason: BuffGroupMatcherDecisionReason;
  candidates: BuffGroupMatcherBundleCandidate[];
  bundleDecisions: BuffGroupMatcherSingleBundleDecision[];
  elapsedMs: number;
};

export function decideBuffGroupMatcherBundleBatch({
  policy,
  logits,
  embeddings,
  imageCount,
  gate,
}: {
  policy: BuffGroupMatcherBundlePolicy;
  logits: Float32Array;
  embeddings: Float32Array;
  imageCount: number;
  gate: PositivePrototypeGate<BuffExpiryTargetGroup>;
}): BuffGroupMatcherSingleBundleDecision[] {
  const group = policy.groups[0];
  if (!group || policy.groups.length !== 1) {
    throw new Error(`buff-group-matcher-policy-group-mismatch:${policy.bundleId}`);
  }
  const outputOrder = policy.output.logits.order;
  const targetIndex = outputOrder.indexOf(group);
  const backgroundIndex = outputOrder.indexOf(policy.backgroundLabel);
  const embeddingDim = policy.output.embedding.shape[1];
  const threshold = policy.thresholds[group];
  if (targetIndex < 0 || backgroundIndex < 0 || typeof threshold !== "number") {
    throw new Error(`buff-group-matcher-policy-target-missing:${policy.bundleId}:${group}`);
  }
  if (logits.length !== imageCount * outputOrder.length) {
    throw new Error(`buff-group-matcher-logit-shape-mismatch:${policy.bundleId}`);
  }
  if (embeddings.length !== imageCount * embeddingDim) {
    throw new Error(`buff-group-matcher-embedding-shape-mismatch:${policy.bundleId}`);
  }

  return Array.from({ length: imageCount }, (_, imageIndex) => {
    const outputOffset = imageIndex * outputOrder.length;
    const score = logits[outputOffset + targetIndex] - logits[outputOffset + backgroundIndex];
    const margin = score - threshold;
    if (margin < 0) {
      return buildSingleBundleDecision({
        policy,
        group,
        score,
        threshold,
        gateScore: null,
        gateThreshold: gate.threshold,
        decisionReason: "base_below_threshold",
      });
    }

    const gateScore = getMaximumPositivePrototypeCosine(
      embeddings,
      imageIndex * embeddingDim,
      gate,
    );
    return buildSingleBundleDecision({
      policy,
      group,
      score,
      threshold,
      gateScore,
      gateThreshold: gate.threshold,
      decisionReason: gateScore - gate.threshold < 0
        ? "positive_gate_below_threshold"
        : "target_accepted",
    });
  });
}

export function mergeBuffGroupMatcherBundleDecisions(
  decisionsByBundle: readonly BuffGroupMatcherSingleBundleDecision[][],
  elapsedMs: number,
): BuffGroupMatcherMatchResult[] {
  const imageCount = decisionsByBundle[0]?.length ?? 0;
  if (decisionsByBundle.some((decisions) => decisions.length !== imageCount)) {
    throw new Error("buff-group-matcher-bundle-length-mismatch");
  }

  return Array.from({ length: imageCount }, (_, imageIndex) => {
    const bundleDecisions = decisionsByBundle.flatMap((decisions) => (
      decisions[imageIndex] ? [decisions[imageIndex]] : []
    ));
    const accepted = bundleDecisions.filter((decision) => decision.kind === "target");
    const candidates = bundleDecisions.map((decision) => decision.candidate);

    if (accepted.length === 1) {
      const decision = accepted[0];
      return {
        kind: "target",
        group: decision.group,
        bundleId: decision.bundleId,
        modelVersion: decision.modelVersion,
        score: decision.candidate.score,
        margin: decision.candidate.margin,
        gateScore: decision.candidate.gateScore,
        gateMargin: decision.candidate.gateMargin,
        decisionReason: "target_accepted",
        candidates,
        bundleDecisions,
        elapsedMs,
      };
    }

    return {
      kind: "unknown",
      group: null,
      bundleId: null,
      modelVersion: null,
      score: null,
      margin: null,
      gateScore: null,
      gateMargin: null,
      decisionReason: accepted.length > 1
        ? "cross_bundle_conflict"
        : getMergedUnknownReason(bundleDecisions),
      candidates,
      bundleDecisions,
      elapsedMs,
    };
  });
}

function buildSingleBundleDecision({
  policy,
  group,
  score,
  threshold,
  gateScore,
  gateThreshold,
  decisionReason,
}: {
  policy: BuffGroupMatcherBundlePolicy;
  group: BuffExpiryTargetGroup;
  score: number;
  threshold: number;
  gateScore: number | null;
  gateThreshold: number;
  decisionReason: Exclude<BuffGroupMatcherDecisionReason, "cross_bundle_conflict">;
}): BuffGroupMatcherSingleBundleDecision {
  const accepted = decisionReason === "target_accepted";
  const candidate: BuffGroupMatcherBundleCandidate = {
    group,
    bundleId: policy.bundleId,
    modelVersion: policy.modelVersion,
    accepted,
    score: round(score),
    threshold: round(threshold),
    margin: round(score - threshold),
    gateScore: gateScore === null ? null : round(gateScore),
    gateThreshold: round(gateThreshold),
    gateMargin: gateScore === null ? null : round(gateScore - gateThreshold),
    decisionReason,
  };
  return {
    group,
    bundleId: policy.bundleId,
    modelVersion: policy.modelVersion,
    kind: accepted ? "target" : "unknown",
    decisionReason,
    candidate,
  };
}

function getMergedUnknownReason(
  decisions: readonly BuffGroupMatcherSingleBundleDecision[],
): Exclude<BuffGroupMatcherDecisionReason, "cross_bundle_conflict" | "target_accepted"> {
  return decisions.some((decision) => decision.decisionReason === "positive_gate_below_threshold")
    ? "positive_gate_below_threshold"
    : "base_below_threshold";
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
