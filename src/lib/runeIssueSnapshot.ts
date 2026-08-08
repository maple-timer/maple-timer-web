import type { RuneSnapshot } from "../alertTypes";
import type { sampleVideoRegion } from "./capture";
import type {
  RuneCandidate,
  RuneDetectionResult,
} from "../recognition/rune/runeDetectionTypes";

type RuneIssueSample = Pick<ReturnType<typeof sampleVideoRegion>, "rawPreviewUrl" | "region">;

export function buildRuneIssueSnapshot({
  previousSnapshot,
  sample,
  maskPreviewUrl,
  detection,
  currentCandidatePreviewUrl,
  sampledAt,
}: {
  previousSnapshot: RuneSnapshot | null;
  sample: RuneIssueSample;
  maskPreviewUrl: string | null;
  detection: RuneDetectionResult;
  currentCandidatePreviewUrl: string | null;
  sampledAt: number;
  issueReason: string;
}): RuneSnapshot {
  const currentCandidate = detection.candidates[0] ?? detection.debug.modelCandidate ?? null;
  const hasCandidatePreview = Boolean(currentCandidate && currentCandidatePreviewUrl);

  return {
    sampledAt,
    detectorVersion: detection.debug.classifier ?? null,
    detectionDebug: {
      detectorKind: detection.debug.detectorKind ?? null,
      classifier: detection.debug.classifier ?? null,
      proposalCount: detection.debug.proposalCount ?? null,
      proposalScore: detection.debug.proposalScore ?? null,
      selectedProposalRank: detection.debug.selectedProposalRank ?? null,
      shapeScore: detection.debug.shapeScore ?? null,
      shapeThreshold: detection.debug.shapeThreshold ?? null,
      shapePass: detection.debug.shapePass ?? null,
      appearanceScore: detection.debug.appearanceScore ?? null,
      appearanceThreshold: detection.debug.appearanceThreshold ?? null,
      appearancePass: detection.debug.appearancePass ?? null,
      modelScore: detection.debug.modelScore ?? null,
      modelThreshold: detection.debug.modelThreshold ?? null,
      proposalInferenceMs: detection.debug.proposalInferenceMs ?? null,
      gateInferenceMs: detection.debug.gateInferenceMs ?? null,
      inferenceMs: detection.debug.inferenceMs ?? null,
      reason: detection.debug.reason ?? null,
    },
    rawPreviewUrl: sample.rawPreviewUrl,
    maskPreviewUrl,
    candidatePreviewUrl: currentCandidatePreviewUrl,
    candidateRawPreviewUrl: hasCandidatePreview ? sample.rawPreviewUrl : null,
    candidateMaskPreviewUrl: hasCandidatePreview ? maskPreviewUrl : null,
    candidateRegionLabel: currentCandidate
      ? `${currentCandidate.width}x${currentCandidate.height}`
      : `${sample.region.width}x${sample.region.height}`,
    candidateSampledAt: currentCandidate ? sampledAt : null,
    candidate: currentCandidate ? toSnapshotCandidate(currentCandidate) : null,
    detected: detection.detected,
    confidence: detection.confidence,
    candidateCount: detection.candidates.length,
    runtimeIncident: previousSnapshot?.runtimeIncident ?? null,
    pendingAlertTriggerFrames: previousSnapshot?.pendingAlertTriggerFrames ?? [],
    lastAlertTrigger: previousSnapshot?.lastAlertTrigger ?? null,
    evidenceMediaBudget: previousSnapshot?.evidenceMediaBudget ?? null,
    evidenceArchive: previousSnapshot?.evidenceArchive ?? null,
  };
}

function toSnapshotCandidate(candidate: RuneCandidate): RuneSnapshot["candidate"] {
  return {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
    confidence: candidate.confidence,
    source: candidate.source ?? null,
  };
}
