import { createBoosterExpiryTimerPreviewUrl } from "../../../lib/boosterExpiry/boosterExpiryCapture";
import type {
  BoosterExpiryRuntimeState,
  BoosterExpirySnapshot,
  BoosterExpiryWorkerPerformance,
  BoosterExpiryWorkerResult,
} from "../../../lib/boosterExpiry/boosterExpiryTypes";
import {
  BOOSTER_EXPIRY_LATEST_TRACE_LIMIT,
  type BoosterExpirySampleProcessorState,
  type BoosterExpiryVideoSample,
} from "./boosterExpirySampleProcessorState";

export function createBoosterExpiryPreviewUrls({
  previewImageData,
  result,
  sample,
}: {
  previewImageData: ImageData | null;
  result: BoosterExpiryWorkerResult;
  sample: BoosterExpiryVideoSample;
}): BoosterExpirySampleProcessorState["previewUrls"] {
  const rect = result.timeRect.rect ?? result.time?.rect ?? null;
  return {
    rawPreviewUrl: sample.rawPreviewUrl,
    timerPreviewUrl: previewImageData
      ? createBoosterExpiryTimerPreviewUrl(previewImageData, rect)
      : null,
  };
}

export function createBoosterExpiryDiagnosticSnapshot(
  sampledAt: number,
  state: BoosterExpiryRuntimeState,
  diagnostics: BoosterExpirySampleProcessorState,
): BoosterExpirySnapshot {
  const previous = diagnostics.snapshot;
  return {
    sampledAt,
    rawPreviewUrl:
      previous?.rawPreviewUrl ?? diagnostics.previewUrls.rawPreviewUrl ?? null,
    timerPreviewUrl:
      previous?.timerPreviewUrl ??
      diagnostics.previewUrls.timerPreviewUrl ??
      null,
    regionLabel: previous?.regionLabel ?? null,
    rawTime: previous?.rawTime ?? null,
    time: previous?.time ?? null,
    timeRect: previous?.timeRect ?? null,
    flow: previous?.flow ?? null,
    performance: previous?.performance ?? null,
    runtimeTrace: diagnostics.trace,
    timerEvidence: [],
    confirmationEvidence: [],
    runtimeFailure:
      diagnostics.trace[diagnostics.trace.length - 1]?.runtimeFailure ?? null,
  };
}

export function appendBoosterExpiryTrace(
  diagnostics: BoosterExpirySampleProcessorState,
  {
    sampledAt,
    state,
    result,
    performance,
    runtimeFailure = null,
  }: {
    sampledAt: number;
    state: BoosterExpiryRuntimeState;
    result: BoosterExpiryWorkerResult | null;
    performance: BoosterExpiryWorkerPerformance | null;
    runtimeFailure?: BoosterExpirySnapshot["runtimeFailure"];
  },
): BoosterExpirySampleProcessorState {
  return {
    ...diagnostics,
    trace: [
      ...diagnostics.trace,
      {
        sampledAt,
        status: state.status,
        rawText: state.rawText,
        displayText: state.displayText,
        rawRemainingSeconds: state.rawRemainingSeconds,
        remainingSeconds: state.remainingSeconds,
        estimatedExpiresAt: state.estimatedExpiresAt,
        alertAt: state.alertAt,
        cycleCandidateObservationCount: state.cycleCandidateObservationCount,
        cycleCandidateDecreaseSeconds:
          state.cycleCandidateFirstRemainingSeconds !== null &&
          state.cycleCandidateLastRemainingSeconds !== null
            ? state.cycleCandidateFirstRemainingSeconds -
              state.cycleCandidateLastRemainingSeconds
            : null,
        confirmedAt: state.confirmedAt,
        confirmedExpiresAt: state.confirmedExpiresAt,
        confirmedLastSupportedAt: state.confirmedLastSupportedAt,
        confirmedContradictionCount: state.confirmedContradictionCount,
        alerted: state.alertedAt === sampledAt,
        flowSource: state.flowSource,
        locked: state.locked,
        decision: state.lastDecision,
        rect: result?.timeRect.rect ?? result?.time?.rect ?? null,
        performance,
        runtimeFailure,
      },
    ].slice(-BOOSTER_EXPIRY_LATEST_TRACE_LIMIT),
  };
}

export function appendBoosterExpiryAlertedTrace({
  diagnostics,
  sampledAt,
  state,
}: {
  diagnostics: BoosterExpirySampleProcessorState;
  sampledAt: number;
  state: BoosterExpiryRuntimeState;
}): BoosterExpirySampleProcessorState {
  return appendBoosterExpiryTrace(diagnostics, {
    sampledAt,
    state,
    result: null,
    performance: null,
  });
}
