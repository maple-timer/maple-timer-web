import type {
  RuneAlertTriggerEvidence,
  RuneAlertTriggerFrame,
  RuneRuntimeState,
  RuneSnapshot,
  RuneSnapshotCandidate,
  RuneSnapshotDetectionDebug,
} from "../alertTypes";
import { RUNE_REQUIRED_STABLE_FRAMES } from "./runeAlertPolicy";
import { getRuneDetectionEpisodeId } from "./runeEpisodeIdentity";
import type { RuneDetectionResult } from "../recognition/rune/runeDetectionTypes";

export type RuneAlertTriggerEvidenceUpdate = {
  pendingFrames: RuneAlertTriggerFrame[];
  lastAlertTrigger: RuneAlertTriggerEvidence | null;
};

export function updateRuneAlertTriggerEvidence({
  previousSnapshot,
  detection,
  state,
  sampledAt,
  rawDataUrl,
  alertPlaybackId,
  alertDecision,
}: {
  previousSnapshot: RuneSnapshot | null;
  detection: RuneDetectionResult;
  state: RuneRuntimeState;
  sampledAt: number;
  rawDataUrl: string | null;
  alertPlaybackId: string | null;
  alertDecision: "initial" | "repeat" | null;
}): RuneAlertTriggerEvidenceUpdate {
  const previousPending = previousSnapshot?.pendingAlertTriggerFrames ?? [];
  const previousTrigger = previousSnapshot?.lastAlertTrigger ?? null;
  if (!detection.detected) {
    return {
      pendingFrames: [],
      lastAlertTrigger: previousTrigger,
    };
  }
  if (!rawDataUrl) {
    return {
      pendingFrames: previousPending,
      lastAlertTrigger: previousTrigger,
    };
  }

  const recentSamples = state.recentSamples ?? [];
  const trace = recentSamples[recentSamples.length - 1] ?? null;
  const frame: RuneAlertTriggerFrame = {
    sampledAt,
    detectorVersion: detection.debug.classifier ?? state.detectorVersion ?? null,
    detectionDebug: toDetectionDebug(detection),
    rawDataUrl,
    detected: detection.detected,
    confidence: detection.confidence,
    candidateCount: detection.candidates.length,
    candidate: toSnapshotCandidate(detection.candidates[0] ?? detection.debug.modelCandidate ?? null),
    status: state.status,
    stableCount: state.stableCount,
    firstDetectedAt: state.firstDetectedAt,
    stableDurationMs: trace?.stableDurationMs ?? 0,
    confirmationSatisfied: trace?.confirmationSatisfied ?? false,
    confirmationSatisfiedBy: trace?.confirmationSatisfiedBy ?? null,
    shouldAlert: trace?.shouldAlert ?? false,
    reason: trace?.reason ?? state.lastDecisionReason ?? "stabilizing",
    sceneEpoch: state.sceneEpoch ?? 0,
  };
  const pendingFrames = [
    ...(state.stableCount > 1 ? previousPending : []),
    frame,
  ].slice(-RUNE_REQUIRED_STABLE_FRAMES);

  if (!alertPlaybackId || !alertDecision) {
    return {
      pendingFrames,
      lastAlertTrigger: previousTrigger,
    };
  }

  return {
    pendingFrames,
    lastAlertTrigger: {
      schemaVersion: "rune-alert-trigger-v1",
      cycleId: alertPlaybackId,
      episodeId: getRuneDetectionEpisodeId(state),
      decision: alertDecision,
      triggeredAt: sampledAt,
      detectorVersion: frame.detectorVersion,
      sceneEpoch: frame.sceneEpoch,
      frames: pendingFrames,
    },
  };
}

function toDetectionDebug(
  detection: RuneDetectionResult,
): RuneSnapshotDetectionDebug {
  return {
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
  };
}

function toSnapshotCandidate(
  candidate: RuneDetectionResult["candidates"][number] | null,
): RuneSnapshotCandidate | null {
  if (!candidate) {
    return null;
  }
  return {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
    confidence: candidate.confidence,
    source: candidate.source ?? null,
  };
}
