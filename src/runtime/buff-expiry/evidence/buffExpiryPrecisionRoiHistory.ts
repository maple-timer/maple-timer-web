import type { PixelRegion } from "../../../contracts/geometry/pixelRegion";
import { RUNTIME_EVIDENCE_ROLLING_MEDIA_BUDGET_CHARS } from "../../../contracts/reporting/runtimeEvidenceMediaPolicy";
import type {
  BuffExpiryTrackedBuff,
  BuffExpiryBox,
  BuffExpiryPendingTrack,
} from "../../../domain/buff-expiry/precisionTrackingTypes";
import type {
  BuffExpiryPrecisionSampleResponse,
  BuffExpiryPrecisionTargetGroup,
} from "../analysis/buffExpiryPrecisionAnalysisRuntime";

export type BuffExpiryPrecisionRecentRoiFrameReason =
  | "periodic"
  | "target-seen"
  | "near-miss"
  | "track-started"
  | "track-lost"
  | "alert-fired"
  | "report-submitted";

export type BuffExpiryPrecisionRecentRoiBestCandidate = {
  group: BuffExpiryPrecisionTargetGroup;
  boxIndex: number;
  accepted: boolean;
  winningGroup: BuffExpiryPrecisionTargetGroup | null;
  score: number;
  margin: number;
  decisionReason: string;
  countdownText: string | null;
  countdownSeconds: number | null;
  countdownStatus: string | null;
};

export type BuffExpiryPrecisionRecentRoiFrame = {
  sampledAt: number;
  reason: BuffExpiryPrecisionRecentRoiFrameReason;
  sourceSize: { width: number; height: number };
  roi: PixelRegion;
  imageDataUrl: string;
  boxCount: number;
  targetObservationCount: number;
  countdownObservationCount: number;
  bestByGroup: BuffExpiryPrecisionRecentRoiBestCandidate[];
  trackCount: number;
  pendingTrackCount: number;
};

export const BUFF_EXPIRY_PRECISION_ROI_HISTORY_WINDOW_MS = 5 * 60_000;
export const BUFF_EXPIRY_PRECISION_ROI_HISTORY_PERIODIC_INTERVAL_MS = 30_000;
export const BUFF_EXPIRY_PRECISION_ROI_HISTORY_LIMIT = 14;
export const BUFF_EXPIRY_PRECISION_ROI_HISTORY_DATA_URL_MAX_CHARS =
  RUNTIME_EVIDENCE_ROLLING_MEDIA_BUDGET_CHARS.buffExpiry;
export const BUFF_EXPIRY_PRECISION_ROI_HISTORY_NEAR_MISS_MIN_SCORE = 0.5;
export const BUFF_EXPIRY_PRECISION_ROI_HISTORY_NEAR_MISS_MIN_GAP_MS = 8_000;

export function createBuffExpiryPrecisionRecentRoiFrame({
  sampledAt,
  reason,
  preview,
  response,
  tracks,
  pendingTracks,
}: {
  sampledAt: number;
  reason: BuffExpiryPrecisionRecentRoiFrameReason;
  preview: {
    sourceSize: { width: number; height: number };
    roi: { x: number; y: number; width: number; height: number };
    imageDataUrl: string;
  };
  response: BuffExpiryPrecisionSampleResponse;
  tracks: BuffExpiryTrackedBuff[];
  pendingTracks: BuffExpiryPendingTrack[];
}): BuffExpiryPrecisionRecentRoiFrame {
  const targetObservationCount = response.iconObservations.filter(
    (observation) => observation.identity.kind === "target",
  ).length;
  return {
    sampledAt,
    reason,
    sourceSize: preview.sourceSize,
    roi: preview.roi,
    imageDataUrl: preview.imageDataUrl,
    boxCount: response.boxes.length,
    targetObservationCount,
    countdownObservationCount: response.iconObservations.filter(
      (observation) => observation.countdown,
    ).length,
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
    trackCount: tracks.length,
    pendingTrackCount: pendingTracks.length,
  };
}

export function appendBuffExpiryPrecisionRecentRoiFrame(
  history: BuffExpiryPrecisionRecentRoiFrame[],
  frame: BuffExpiryPrecisionRecentRoiFrame,
): BuffExpiryPrecisionRecentRoiFrame[] {
  return pruneBuffExpiryPrecisionRecentRoiFrames(
    [...history, frame],
    frame.sampledAt,
  );
}

export function pruneBuffExpiryPrecisionRecentRoiFrames(
  history: BuffExpiryPrecisionRecentRoiFrame[],
  now: number,
): BuffExpiryPrecisionRecentRoiFrame[] {
  const recent = history
    .filter(
      (frame) =>
        now - frame.sampledAt <= BUFF_EXPIRY_PRECISION_ROI_HISTORY_WINDOW_MS,
    )
    .slice(-BUFF_EXPIRY_PRECISION_ROI_HISTORY_LIMIT);

  while (
    getBuffExpiryPrecisionRoiHistoryDataUrlLength(recent) >
      BUFF_EXPIRY_PRECISION_ROI_HISTORY_DATA_URL_MAX_CHARS &&
    recent.length > 1
  ) {
    const periodicIndex = recent.findIndex(
      (frame) => frame.reason === "periodic",
    );
    recent.splice(periodicIndex >= 0 ? periodicIndex : 0, 1);
  }

  return recent;
}

export function selectBuffExpiryPrecisionRoiFrameReason({
  sampledAt,
  lastPeriodicAt,
  lastNearMissAt,
  lastCapturedAlertedAt,
  currentLastAlertedAt,
  previousTargetObservationCount,
  currentTargetObservationCount,
  previousTracks,
  currentTracks,
  bestByGroup,
}: {
  sampledAt: number;
  lastPeriodicAt: number;
  lastNearMissAt: number;
  lastCapturedAlertedAt: number | null;
  currentLastAlertedAt: number | null;
  previousTargetObservationCount: number;
  currentTargetObservationCount: number;
  previousTracks: BuffExpiryTrackedBuff[];
  currentTracks: BuffExpiryTrackedBuff[];
  bestByGroup: BuffExpiryPrecisionSampleResponse["bestByGroup"];
}): BuffExpiryPrecisionRecentRoiFrameReason | null {
  if (
    currentLastAlertedAt !== null &&
    currentLastAlertedAt !== lastCapturedAlertedAt
  ) {
    return "alert-fired";
  }

  const previousTrackKeys = new Set(
    previousTracks.map(getBuffExpiryPrecisionTrackHistoryKey),
  );
  const currentTrackKeys = new Set(
    currentTracks.map(getBuffExpiryPrecisionTrackHistoryKey),
  );
  if (
    currentTracks.some(
      (track) =>
        !previousTrackKeys.has(getBuffExpiryPrecisionTrackHistoryKey(track)),
    )
  ) {
    return "track-started";
  }
  if (
    previousTracks.some(
      (track) => !currentTrackKeys.has(getBuffExpiryPrecisionTrackHistoryKey(track)),
    )
  ) {
    return "track-lost";
  }

  if (
    previousTargetObservationCount === 0 &&
    currentTargetObservationCount > 0
  ) {
    return "target-seen";
  }

  if (
    sampledAt - lastNearMissAt >=
      BUFF_EXPIRY_PRECISION_ROI_HISTORY_NEAR_MISS_MIN_GAP_MS &&
    currentTargetObservationCount === 0 &&
    bestByGroup.some(
      (candidate) =>
        !candidate.accepted &&
        candidate.winningGroup === candidate.group &&
        candidate.score >= BUFF_EXPIRY_PRECISION_ROI_HISTORY_NEAR_MISS_MIN_SCORE,
    )
  ) {
    return "near-miss";
  }

  if (
    sampledAt - lastPeriodicAt >=
    BUFF_EXPIRY_PRECISION_ROI_HISTORY_PERIODIC_INTERVAL_MS
  ) {
    return "periodic";
  }

  return null;
}

function getBuffExpiryPrecisionTrackHistoryKey(
  track: BuffExpiryTrackedBuff,
): string {
  return `${track.buffId}:${getBuffExpiryPrecisionBoxHistoryKey(track.box)}`;
}

function getBuffExpiryPrecisionBoxHistoryKey(box: BuffExpiryBox): string {
  return `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.width)}:${Math.round(box.height)}`;
}

function getBuffExpiryPrecisionRoiHistoryDataUrlLength(
  history: BuffExpiryPrecisionRecentRoiFrame[],
): number {
  return history.reduce((total, frame) => total + frame.imageDataUrl.length, 0);
}
