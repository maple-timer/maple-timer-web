import {
  cosineSimilarity,
  describeSingleIconImage,
  type SingleIconCandidateScore,
  type SingleIconImage,
  type SingleIconPolicy,
} from "../500001002/src/runtime.js";
import { HOLOGRAM_GRAFFITI_BARRIER_VI_POLICY } from "../hologram-graffiti-barrier-vi/src/model.js";

export interface SkillIconDetectorDefinition {
  readonly id: string;
  readonly skillId: string;
  readonly slug: string;
  readonly displayName: string;
  readonly policy: SingleIconPolicy;
}

export interface SkillIconMatcherOptions {
  readonly enabledIds?: readonly string[];
  readonly maxCandidates?: number;
}

export interface SkillIconCandidate {
  readonly detectorId: string;
  readonly skillId: string;
  readonly slug: string;
  readonly displayName: string;
  readonly label: string;
  readonly matched: boolean;
  readonly score: number;
  readonly threshold: number;
  readonly margin: number;
  readonly minMarginVsHardNegative: number;
  readonly decisionReason: "matched" | "below_threshold" | "too_close_to_hard_negative";
  readonly bestPositive: SingleIconCandidateScore | null;
  readonly bestHardNegative: SingleIconCandidateScore | null;
}

export interface SkillIconMatchResult {
  readonly kind: "target" | "unknown";
  readonly matched: boolean;
  readonly skillId: string | null;
  readonly slug: string | null;
  readonly displayName: string | null;
  readonly label: string | null;
  readonly score: number;
  readonly margin: number;
  readonly decisionReason: "matched" | "no_detector_matched" | "invalid_input";
  readonly bestMatch: SkillIconCandidate | null;
  readonly candidates: readonly SkillIconCandidate[];
  readonly elapsedMs: number;
}

export interface SkillIconMatcher {
  readonly version: string;
  readonly detectors: readonly SkillIconDetectorDefinition[];
  match(image: SingleIconImage | ArrayLike<number>): SkillIconMatchResult;
  matchBatch(images: readonly (SingleIconImage | ArrayLike<number>)[]): SkillIconMatchResult[];
}

export const SKILL_ICON_DETECTOR_DEFINITIONS: readonly SkillIconDetectorDefinition[] = [
  {
    id: "hologramGraffitiBarrierVi",
    skillId: "hologramGraffitiBarrierVi",
    slug: "hologram-graffiti-barrier-vi",
    displayName: "홀로그램 그래피티: 역장VI",
    policy: HOLOGRAM_GRAFFITI_BARRIER_VI_POLICY,
  },
];

export const SKILL_ICON_MATCHER_VERSION = SKILL_ICON_DETECTOR_DEFINITIONS.map(
  (definition) => `${definition.id}@${definition.policy.version}`,
).join("|");

export function createSkillIconMatcher(options: SkillIconMatcherOptions = {}): SkillIconMatcher {
  const detectors = selectDetectors(options.enabledIds);
  const maxCandidates = options.maxCandidates ?? detectors.length;
  const version = detectors.map((definition) => `${definition.id}@${definition.policy.version}`).join("|");

  const match = (image: SingleIconImage | ArrayLike<number>): SkillIconMatchResult => {
    const startedAt = now();
    try {
      const vector = describeSingleIconImage(image);
      const candidates = detectors.map((definition) => scoreDetector(definition, vector)).sort(compareCandidates);
      const limitedCandidates = candidates.slice(0, maxCandidates);
      const bestMatched = candidates.find((candidate) => candidate.matched) ?? null;
      const bestMatch = bestMatched ?? candidates[0] ?? null;
      const elapsedMs = round(now() - startedAt);

      if (!bestMatched) {
        return {
          kind: "unknown",
          matched: false,
          skillId: null,
          slug: null,
          displayName: null,
          label: null,
          score: bestMatch?.score ?? -1,
          margin: bestMatch?.margin ?? -1,
          decisionReason: "no_detector_matched",
          bestMatch,
          candidates: limitedCandidates,
          elapsedMs,
        };
      }

      return {
        kind: "target",
        matched: true,
        skillId: bestMatched.skillId,
        slug: bestMatched.slug,
        displayName: bestMatched.displayName,
        label: bestMatched.label,
        score: bestMatched.score,
        margin: bestMatched.margin,
        decisionReason: "matched",
        bestMatch: bestMatched,
        candidates: limitedCandidates,
        elapsedMs,
      };
    } catch {
      return {
        kind: "unknown",
        matched: false,
        skillId: null,
        slug: null,
        displayName: null,
        label: null,
        score: -1,
        margin: -1,
        decisionReason: "invalid_input",
        bestMatch: null,
        candidates: [],
        elapsedMs: round(now() - startedAt),
      };
    }
  };

  return {
    version,
    detectors,
    match,
    matchBatch(images) {
      return images.map(match);
    },
  };
}

function selectDetectors(enabledIds: readonly string[] | undefined): readonly SkillIconDetectorDefinition[] {
  if (!enabledIds || enabledIds.length === 0) return SKILL_ICON_DETECTOR_DEFINITIONS;
  const enabled = new Set(enabledIds);
  const unknown = [...enabled].filter(
    (id) => !SKILL_ICON_DETECTOR_DEFINITIONS.some((definition) => definition.id === id),
  );
  if (unknown.length > 0) throw new Error(`Unknown skill icon detector id: ${unknown.join(", ")}`);
  return SKILL_ICON_DETECTOR_DEFINITIONS.filter((definition) => enabled.has(definition.id));
}

function scoreDetector(definition: SkillIconDetectorDefinition, vector: ArrayLike<number>): SkillIconCandidate {
  const policy = definition.policy;
  const bestPositive = bestScore(vector, policy.positivePrototypes);
  const score = bestPositive?.score ?? -1;
  if (score < policy.threshold) {
    return {
      detectorId: definition.id,
      skillId: definition.skillId,
      slug: definition.slug,
      displayName: definition.displayName,
      label: policy.label,
      matched: false,
      score: round(score),
      threshold: policy.threshold,
      margin: round(score - policy.threshold),
      minMarginVsHardNegative: policy.minMarginVsHardNegative,
      decisionReason: "below_threshold",
      bestPositive: bestPositive && { ...bestPositive, score: round(bestPositive.score) },
      bestHardNegative: null,
    };
  }

  const bestHardNegative = bestScore(vector, policy.hardNegativePrototypes);
  const hardNegativeScore = bestHardNegative?.score ?? -1;
  const margin = score - hardNegativeScore;
  const matched = margin >= policy.minMarginVsHardNegative;
  const decisionReason: SkillIconCandidate["decisionReason"] = matched ? "matched" : "too_close_to_hard_negative";

  return {
    detectorId: definition.id,
    skillId: definition.skillId,
    slug: definition.slug,
    displayName: definition.displayName,
    label: policy.label,
    matched,
    score: round(score),
    threshold: policy.threshold,
    margin: round(margin),
    minMarginVsHardNegative: policy.minMarginVsHardNegative,
    decisionReason,
    bestPositive: bestPositive && { ...bestPositive, score: round(bestPositive.score) },
    bestHardNegative: bestHardNegative && { ...bestHardNegative, score: round(bestHardNegative.score) },
  };
}

function bestScore(
  vector: ArrayLike<number>,
  prototypes: readonly { readonly id: string; readonly source: string; readonly vector: ArrayLike<number> }[],
): SingleIconCandidateScore | null {
  let best: SingleIconCandidateScore | null = null;
  for (const prototype of prototypes) {
    const score = cosineSimilarity(vector, prototype.vector);
    if (!best || score > best.score) {
      best = { id: prototype.id, source: prototype.source, score };
    }
  }
  return best;
}

function compareCandidates(left: SkillIconCandidate, right: SkillIconCandidate): number {
  if (left.matched !== right.matched) return left.matched ? -1 : 1;
  if (left.score !== right.score) return right.score - left.score;
  return right.margin - left.margin;
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
