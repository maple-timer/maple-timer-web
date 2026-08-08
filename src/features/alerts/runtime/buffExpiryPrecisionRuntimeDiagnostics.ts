import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryDebugDetectionFrame,
  BuffExpiryRejectedMatch,
  BuffExpiryRuntimeTraceAcceptedMatch,
  BuffExpiryRuntimeTraceExpiryCluster,
  BuffExpiryRuntimeTraceFrame,
  BuffExpiryRuntimeTraceNextFrame,
  BuffExpiryRuntimeTraceRejectedMatch,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryAlertDecision } from "../../../domain/buff-expiry/precisionAlertTypes";
import type {
  BuffExpiryBox,
  BuffExpiryExpiryCluster,
  BuffExpiryPendingTrack,
  BuffExpiryTrackedBuff,
} from "../../../domain/buff-expiry/precisionTrackingTypes";
import type { BuffExpiryPrecisionSampleResponse } from "../../../runtime/buff-expiry/analysis/buffExpiryPrecisionAnalysisRuntime";
import {
  findBuffExpiryMatchForBox,
  getBuffExpiryBoxKey,
} from "../../../lib/buffExpiry/buffExpiryRuntimeDiagnosticBoxes";

const BUFF_EXPIRY_DEBUG_HISTORY_LIMIT = 12;
const BUFF_EXPIRY_RUNTIME_TRACE_LIMIT = 60;
const BUFF_EXPIRY_RUNTIME_TRACE_TOP_MATCH_LIMIT = 3;
const BUFF_EXPIRY_ALERT_DECISION_HISTORY_LIMIT = 120;

export { getBuffExpiryConfirmationCandidateCount } from "../../../lib/buffExpiry/buffExpiryConfirmationCandidates";
export {
  appendBuffExpiryIconEvidence,
  pruneBuffExpiryIconEvidence,
} from "../../../lib/buffExpiry/buffExpiryIconEvidenceDiagnostics";
export {
  findBuffExpiryMatchForBox,
  getBuffExpiryBoxKey,
} from "../../../lib/buffExpiry/buffExpiryRuntimeDiagnosticBoxes";

export function appendBuffExpiryDebugDetectionFrame(
  history: BuffExpiryDebugDetectionFrame[],
  frame: BuffExpiryDebugDetectionFrame,
): BuffExpiryDebugDetectionFrame[] {
  return [...history, frame].slice(-BUFF_EXPIRY_DEBUG_HISTORY_LIMIT);
}

export function createBuffExpiryDebugDetectionFrame({
  sampledAt,
  boxes,
  acceptedMatches,
  rejectedMatches,
  normalizedBoxPreviewUrls,
  rawBoxPreviewUrls,
  performance,
  boxLimit,
}: {
  sampledAt: number;
  boxes: BuffExpiryBox[];
  acceptedMatches: BuffExpiryAcceptedMatch[];
  rejectedMatches: BuffExpiryRejectedMatch[];
  normalizedBoxPreviewUrls: Record<string, string>;
  rawBoxPreviewUrls: Record<string, string>;
  performance: BuffExpiryDebugDetectionFrame["performance"];
  boxLimit: number;
}): BuffExpiryDebugDetectionFrame {
  return {
    sampledAt,
    boxCount: boxes.length,
    acceptedMatchCount: acceptedMatches.length,
    boxes: boxes.slice(0, boxLimit).map((box) => {
      const boxKey = getBuffExpiryBoxKey(box);
      const acceptedMatch = findBuffExpiryMatchForBox(acceptedMatches, box);
      const rejectedMatch = findBuffExpiryMatchForBox(rejectedMatches, box);
      return {
        box,
        previewDataUrl: normalizedBoxPreviewUrls[boxKey] ?? rawBoxPreviewUrls[boxKey] ?? null,
        acceptedMatch,
        rejectedMatch,
        topMatches: acceptedMatch?.topMatches ?? rejectedMatch?.topMatches ?? [],
      };
    }),
    performance,
  };
}

export function appendBuffExpiryRuntimeTraceFrame(
  history: BuffExpiryRuntimeTraceFrame[],
  frame: BuffExpiryRuntimeTraceFrame,
): BuffExpiryRuntimeTraceFrame[] {
  return [...history, frame].slice(-BUFF_EXPIRY_RUNTIME_TRACE_LIMIT);
}

export function preserveBuffExpiryPrecisionAlertMarkers(
  tracks: BuffExpiryTrackedBuff[],
  runtimeTracks: BuffExpiryTrackedBuff[],
): BuffExpiryTrackedBuff[] {
  const alertedAtById = new Map(
    runtimeTracks
      .filter((track) => track.alertedAt !== null)
      .map((track) => [track.id, track.alertedAt] as const),
  );
  if (!alertedAtById.size) {
    return tracks;
  }
  return tracks.map((track) => {
    const alertedAt = alertedAtById.get(track.id);
    return alertedAt === undefined ? track : { ...track, alertedAt };
  });
}

export function compactBuffExpiryPrecisionRuntimeFrame(
  response: BuffExpiryPrecisionSampleResponse,
): BuffExpiryRuntimeTraceNextFrame {
  const targetObservations = response.iconObservations.filter(
    (observation) => observation.identity.kind === "target",
  );
  return {
    targetObservationCount: targetObservations.length,
    countdownObservationCount: response.iconObservations.filter((observation) => observation.countdown).length,
    bestByGroup: response.bestByGroup.map((candidate) => ({
      group: candidate.group,
      boxIndex: candidate.boxIndex,
      accepted: candidate.accepted,
      winningGroup: candidate.winningGroup,
      score: candidate.score,
      margin: candidate.margin,
      decisionReason: candidate.decisionReason,
      countdownText: candidate.countdown?.text ?? null,
      countdownSeconds: candidate.countdown?.totalSeconds ?? null,
      countdownStatus: candidate.countdown?.status ?? null,
    })),
    targetObservations: targetObservations.map((observation) => ({
      boxIndex: observation.boxIndex,
      group: observation.identity.group,
      score: observation.identity.score,
      margin: observation.identity.margin,
      decisionReason: observation.identity.decisionReason,
      countdownText: observation.countdown?.text ?? null,
      countdownSeconds: observation.countdown?.totalSeconds ?? null,
      countdownStatus: observation.countdown?.status ?? null,
    })),
    moduleVersions: response.moduleVersions,
  };
}

export function appendBuffExpiryAlertDecision(
  history: BuffExpiryAlertDecision[],
  decision: BuffExpiryAlertDecision,
): BuffExpiryAlertDecision[] {
  if (!isReportableBuffExpiryAlertDecision(decision)) {
    return history;
  }
  return [...history, decision].slice(-BUFF_EXPIRY_ALERT_DECISION_HISTORY_LIMIT);
}

export function isReportableBuffExpiryAlertDecision(decision: BuffExpiryAlertDecision): boolean {
  return decision.dueTracks.length > 0 || decision.shouldAlert;
}

export function getBuffExpiryAlertedTrackIds({
  tracks,
  sampledAt,
  shouldAlert,
}: {
  tracks: BuffExpiryTrackedBuff[];
  sampledAt: number;
  shouldAlert: boolean;
}): string[] {
  if (!shouldAlert) {
    return [];
  }
  return tracks.filter((track) => track.alertedAt === sampledAt).map((track) => track.id);
}

export function compactBuffExpiryAcceptedMatch(
  match: BuffExpiryAcceptedMatch,
): BuffExpiryRuntimeTraceAcceptedMatch {
  return {
    ...match,
    topMatches: match.topMatches.slice(0, BUFF_EXPIRY_RUNTIME_TRACE_TOP_MATCH_LIMIT),
  };
}

export function compactBuffExpiryRejectedMatch(
  match: BuffExpiryRejectedMatch,
): BuffExpiryRuntimeTraceRejectedMatch {
  return {
    ...match,
    topMatches: match.topMatches.slice(0, BUFF_EXPIRY_RUNTIME_TRACE_TOP_MATCH_LIMIT),
  };
}

export function compactBuffExpiryExpiryCluster(
  cluster: BuffExpiryExpiryCluster,
): BuffExpiryRuntimeTraceExpiryCluster {
  const inlierObservations = cluster.observations.filter(
    (observation) => Math.abs(observation.predictedExpiresAt - cluster.centerExpiresAt) <= 4000,
  );
  return {
    id: cluster.id,
    firstSeenAt: cluster.firstSeenAt,
    lastSeenAt: cluster.lastSeenAt,
    centerExpiresAt: cluster.centerExpiresAt,
    confirmedAt: cluster.confirmedAt,
    observationCount: cluster.observations.length,
    inlierCount: inlierObservations.length,
    distinctSlotCount: new Set(inlierObservations.map((observation) => observation.slotKey)).size,
    distinctBuffCount: new Set(inlierObservations.map((observation) => observation.buffId)).size,
  };
}
