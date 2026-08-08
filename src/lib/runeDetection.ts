import { collectRuneCandidateProposals } from "./runeCandidateProposals";
import {
  classifyRuneCandidatesWithCnn,
  RUNE_CNN_MODEL_VERSION,
} from "./runeCnnClassifier";
import type { RuneDetectionResult } from "../recognition/rune/runeDetectionTypes";

export type { RuneCandidate, RuneDetectionResult } from "../recognition/rune/runeDetectionTypes";
export { createRuneMaskPreview } from "./runeDetectionPreview";

export function detectRuneInMinimap(imageData: ImageData): RuneDetectionResult {
  const { candidates, purplePixels, componentCount } = collectRuneCandidateProposals(imageData);
  const classification = classifyRuneCandidatesWithCnn(imageData, candidates);

  return {
    detected: classification.detected,
    confidence: classification.confidence,
    candidates: classification.candidates,
    debug: {
      purplePixelRatio: purplePixels / Math.max(1, imageData.width * imageData.height),
      componentCount,
      proposalCount: candidates.length,
      classifier: RUNE_CNN_MODEL_VERSION,
      reason: candidates.length === 0 ? "no-diamond-candidate" : undefined,
    },
  };
}
