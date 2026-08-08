import type {
  HuntStallCropHistoryFrame,
  HuntStallCropHistoryState,
  HuntStallRuntimeState,
  HuntStallRuntimeTraceFrame,
  HuntStallSnapshot,
  RgbaImageSnapshot,
} from "../../../alertTypes";
import { RUNTIME_EVIDENCE_ROLLING_MEDIA_BUDGET_CHARS } from "../../../contracts/reporting/runtimeEvidenceMediaPolicy";
import type {
  HuntStallIncidentRecognition,
  HuntStallIncidentRecognizerProvenance,
  HuntStallIncidentRegion,
  HuntStallIncidentRuntimeFailure,
} from "../../../runtime/hunt-stall/evidence/huntStallIncidentEvidenceTypes";

const HUNT_STALL_PREVIEW_INTERVAL_MS = 2000;
const HUNT_STALL_RUNTIME_TRACE_LIMIT = 300;
const HUNT_STALL_CROP_HISTORY_LIMIT = 24;
const HUNT_STALL_CROP_HISTORY_INTERVAL_MS = 15_000;
export const HUNT_STALL_CROP_HISTORY_DATA_URL_MAX_CHARS =
  RUNTIME_EVIDENCE_ROLLING_MEDIA_BUDGET_CHARS.huntStall;
export const HUNT_STALL_CANVAS_ERROR_MESSAGE =
  "사냥 멈춤 감지용 캔버스를 준비하지 못했습니다.";

type HuntStallPreviewUrls = {
  displayPreviewUrl: string | null;
  rawPreviewUrl: string | null;
  processedPreviewUrl: string | null;
};

type HuntStallPreviewImageData = {
  displayPreviewImageData: RgbaImageSnapshot | null;
  rawPreviewImageData: RgbaImageSnapshot | null;
  processedPreviewImageData: RgbaImageSnapshot | null;
};

export type HuntStallSampleProcessorPreviewState = {
  lastPreviewAt: number;
  urls: HuntStallPreviewUrls;
  imageData?: HuntStallPreviewImageData;
};

export type HuntStallSampleProcessResult = {
  stateBefore: HuntStallRuntimeState;
  state: HuntStallRuntimeState;
  snapshot: HuntStallSnapshot | null;
  shouldAlert: boolean;
  shouldResetOcrState: boolean;
  previewState: HuntStallSampleProcessorPreviewState;
  runtimeTrace: HuntStallRuntimeTraceFrame[];
  cropHistory: HuntStallCropHistoryFrame[];
  errorMessage: string | null;
  incidentEvidence: HuntStallProcessedIncidentEvidence | null;
};

export type HuntStallProcessedIncidentEvidence = {
  layoutKey: string;
  sourceDimensions: { width: number; height: number } | null;
  region: HuntStallIncidentRegion | null;
  sourceToCrop: {
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
  } | null;
  recognition: HuntStallIncidentRecognition | null;
  recognizer: HuntStallIncidentRecognizerProvenance | null;
  runtimeFailure: HuntStallIncidentRuntimeFailure | null;
  timings: {
    captureMs: number | null;
    cropMs: number | null;
    recognitionMs: number | null;
    transitionMs: number | null;
    totalMs: number | null;
  } | null;
  media: {
    rawDataUrl: string | null;
    processedDataUrl: string | null;
  } | null;
};

export function createHuntStallSampleProcessorPreviewState(): HuntStallSampleProcessorPreviewState {
  return {
    lastPreviewAt: 0,
    urls: { displayPreviewUrl: null, rawPreviewUrl: null, processedPreviewUrl: null },
  };
}

export function shouldIncludeHuntStallPreview({
  previousPreviewAt,
  requiresPreview = false,
  sampledAt,
  showDebugColumns,
}: {
  previousPreviewAt: number;
  requiresPreview?: boolean;
  sampledAt: number;
  showDebugColumns: boolean;
}) {
  return (
    (showDebugColumns || requiresPreview) &&
    sampledAt - previousPreviewAt >= HUNT_STALL_PREVIEW_INTERVAL_MS
  );
}

export function appendHuntStallRuntimeTraceFrame(
  frames: HuntStallRuntimeTraceFrame[],
  frame: HuntStallRuntimeTraceFrame,
) {
  return [...frames, frame].slice(-HUNT_STALL_RUNTIME_TRACE_LIMIT);
}

export function appendHuntStallCropHistoryFrame(
  frames: HuntStallCropHistoryFrame[],
  frame: HuntStallCropHistoryFrame,
) {
  const recent = [...frames, frame].slice(-HUNT_STALL_CROP_HISTORY_LIMIT);
  while (
    getHuntStallCropHistoryDataUrlLength(recent) >
      HUNT_STALL_CROP_HISTORY_DATA_URL_MAX_CHARS &&
    recent.length > 1
  ) {
    const periodicIndex = recent.findIndex(
      (entry) => entry.reasons.length === 1 && entry.reasons[0] === "interval",
    );
    recent.splice(periodicIndex >= 0 ? periodicIndex : 0, 1);
  }
  return recent;
}

function getHuntStallCropHistoryDataUrlLength(
  history: HuntStallCropHistoryFrame[],
) {
  return history.reduce(
    (total, entry) =>
      total +
      (entry.rawDataUrl?.length ?? 0) +
      (entry.processedDataUrl?.length ?? 0),
    0,
  );
}

export function createHuntStallRuntimeTraceFrame({
  mode,
  runtimeFailure = null,
  sampledAt,
  shouldAlert,
  snapshot,
  state,
}: {
  mode: "manual-experience" | "cooldown-presence";
  runtimeFailure?: HuntStallRuntimeTraceFrame["runtimeFailure"];
  sampledAt: number;
  shouldAlert: boolean;
  snapshot: HuntStallSnapshot | null;
  state: HuntStallRuntimeState;
}): HuntStallRuntimeTraceFrame {
  return {
    sampledAt,
    mode,
    status: state.status,
    lastDecision: state.lastDecision,
    shouldAlert,
    recognizedText: state.recognizedText,
    snapshotRecognizedText: snapshot?.recognizedText ?? null,
    alertedRecognizedText: state.alertedRecognizedText,
    pendingRecognizedText: state.pendingRecognizedText,
    pendingRecognizedCount: state.pendingRecognizedCount,
    lastRejectedRecognizedText: state.lastRejectedRecognizedText,
    lastReadFailureReason: state.lastReadFailureReason,
    confidence: state.confidence,
    foregroundRatio: snapshot?.foregroundRatio ?? null,
    unchangedSeconds: state.unchangedSeconds,
    stableSampleCount: state.stableSampleCount,
    lastChangedAt: state.lastChangedAt,
    lastReadableAt: state.lastReadableAt,
    lastReadFailureAt: state.lastReadFailureAt,
    alertedAt: state.alertedAt,
    alertDecision: shouldAlert
      ? state.repeatedAlertCount > 0
        ? "repeat"
        : "initial"
      : null,
    lastRepeatedAlertAt: state.lastRepeatedAlertAt,
    repeatedAlertCount: state.repeatedAlertCount,
    lastAlertedAt: state.lastAlertedAt,
    lastAlertPlaybackStatus: state.lastAlertPlayback?.status ?? null,
    lastAlertPlaybackRequestedAt: state.lastAlertPlayback?.requestedAt ?? null,
    lastAlertPlaybackStartedAt: state.lastAlertPlayback?.startedAt ?? null,
    lastAlertPlaybackFinishedAt: state.lastAlertPlayback?.finishedAt ?? null,
    hasObservedCooldownPresence: state.hasObservedCooldownPresence,
    cooldownLastDetectedAt: state.cooldownLastDetectedAt,
    cooldownMissingSeconds: state.cooldownMissingSeconds,
    cooldownConsecutiveReadableCount: state.cooldownConsecutiveReadableCount,
    cooldownVisualChangeScore: state.cooldownVisualChangeScore ?? null,
    cooldownVisualChanged: snapshot?.cooldownVisualChanged ?? false,
    cooldownUsedVisualActivity: state.cooldownUsedVisualActivity ?? false,
    runtimeFailure,
  };
}

export function getCooldownCropHistoryReasons({
  lastFrame,
  previous,
  sampledAt,
  shouldAlert,
  snapshot,
  state,
}: {
  lastFrame: HuntStallCropHistoryFrame | null;
  previous: HuntStallRuntimeState;
  sampledAt: number;
  shouldAlert: boolean;
  snapshot: HuntStallSnapshot;
  state: HuntStallRuntimeState;
}) {
  const reasons: string[] = [];
  if (
    !lastFrame ||
    sampledAt - lastFrame.sampledAt >= HUNT_STALL_CROP_HISTORY_INTERVAL_MS
  ) {
    reasons.push("interval");
  }
  if (shouldAlert) {
    reasons.push("alert");
  }
  if (previous.status !== state.status) {
    reasons.push("status-change");
  }
  if (previous.lastDecision !== state.lastDecision) {
    reasons.push("decision-change");
  }
  if (previous.recognizedText !== state.recognizedText) {
    reasons.push("state-text-change");
  }
  if (lastFrame?.recognizedText !== snapshot.recognizedText) {
    reasons.push("snapshot-text-change");
  }
  if (
    previous.lastRejectedRecognizedText !== state.lastRejectedRecognizedText
  ) {
    reasons.push("rejected-text-change");
  }
  if (snapshot.cooldownVisualChanged) {
    reasons.push("visual-change");
  }
  return reasons;
}

export function createCooldownCropHistoryFrame({
  previous,
  reasons,
  snapshot,
  state,
}: {
  previous: HuntStallRuntimeState;
  reasons: string[];
  snapshot: HuntStallSnapshot;
  state: HuntStallRuntimeState;
}): HuntStallCropHistoryFrame {
  const stateBefore = toHuntStallCropHistoryState(previous);
  const stateAfter = toHuntStallCropHistoryState(state);
  return {
    sampledAt: snapshot.sampledAt,
    mode: "cooldown-presence",
    reasons,
    rawDataUrl: snapshot.rawPreviewUrl,
    processedDataUrl: snapshot.processedPreviewUrl ?? snapshot.rawPreviewUrl,
    regionLabel: snapshot.regionLabel,
    recognizedText: snapshot.recognizedText,
    debugText: snapshot.debugText,
    confidence: snapshot.confidence,
    foregroundRatio: snapshot.foregroundRatio,
    changeScore: snapshot.changeScore,
    cooldownVisualChangeScore: snapshot.cooldownVisualChangeScore ?? null,
    cooldownVisualChanged: snapshot.cooldownVisualChanged ?? false,
    cooldownUsedVisualActivity: snapshot.cooldownUsedVisualActivity ?? false,
    state: stateAfter,
    stateBefore,
    stateAfter,
  };
}

export function getManualExperienceCropHistoryReasons({
  lastFrame,
  previous,
  sampledAt,
  shouldAlert,
  snapshot,
  state,
}: {
  lastFrame: HuntStallCropHistoryFrame | null;
  previous: HuntStallRuntimeState;
  sampledAt: number;
  shouldAlert: boolean;
  snapshot: HuntStallSnapshot;
  state: HuntStallRuntimeState;
}) {
  const reasons: string[] = [];
  if (
    !lastFrame ||
    sampledAt - lastFrame.sampledAt >= HUNT_STALL_CROP_HISTORY_INTERVAL_MS
  ) {
    reasons.push("interval");
  }
  if (shouldAlert) {
    reasons.push("alert");
  }
  if (previous.status !== state.status) {
    reasons.push("status-change");
  }
  if (previous.lastDecision !== state.lastDecision) {
    reasons.push("decision-change");
  }
  if (previous.recognizedText !== state.recognizedText) {
    reasons.push("state-text-change");
  }
  if (lastFrame?.recognizedText !== snapshot.recognizedText) {
    reasons.push("snapshot-text-change");
  }
  return reasons;
}

export function createManualExperienceCropHistoryFrame({
  previous,
  reasons,
  snapshot,
  state,
}: {
  previous: HuntStallRuntimeState;
  reasons: string[];
  snapshot: HuntStallSnapshot;
  state: HuntStallRuntimeState;
}): HuntStallCropHistoryFrame {
  const stateBefore = toHuntStallCropHistoryState(previous);
  const stateAfter = toHuntStallCropHistoryState(state);
  return {
    sampledAt: snapshot.sampledAt,
    mode: "manual-experience",
    reasons,
    rawDataUrl: snapshot.rawPreviewUrl,
    processedDataUrl: snapshot.processedPreviewUrl ?? snapshot.rawPreviewUrl,
    regionLabel: snapshot.regionLabel,
    recognizedText: snapshot.recognizedText,
    debugText: snapshot.debugText,
    confidence: snapshot.confidence,
    foregroundRatio: snapshot.foregroundRatio,
    changeScore: snapshot.changeScore,
    cooldownVisualChangeScore: null,
    cooldownVisualChanged: false,
    cooldownUsedVisualActivity: false,
    state: stateAfter,
    stateBefore,
    stateAfter,
  };
}

export function toHuntStallCropHistoryState(
  state: HuntStallRuntimeState,
): HuntStallCropHistoryState {
  return {
    status: state.status,
    lastDecision: state.lastDecision,
    recognizedText: state.recognizedText,
    alertedRecognizedText: state.alertedRecognizedText,
    lastRejectedRecognizedText: state.lastRejectedRecognizedText,
    lastReadFailureReason: state.lastReadFailureReason,
    unchangedSeconds: state.unchangedSeconds,
    cooldownMissingSeconds: state.cooldownMissingSeconds,
    alertedAt: state.alertedAt,
  };
}
