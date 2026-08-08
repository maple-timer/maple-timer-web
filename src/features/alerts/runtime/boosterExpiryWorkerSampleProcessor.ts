import {
  markBoosterExpiryRuntimeAlerted,
  updateBoosterExpiryRuntimeState,
} from "../../../lib/boosterExpiry/boosterExpiryRuntime";
import type {
  BoosterExpiryRuntimeState,
  BoosterExpirySnapshot,
} from "../../../lib/boosterExpiry/boosterExpiryTypes";
import type { BoosterExpiryAlertConfig } from "../../../types";
import {
  appendBoosterExpiryTrace,
  createBoosterExpiryPreviewUrls,
} from "./boosterExpirySampleProcessorDiagnostics";
import type {
  BoosterExpirySampleProcessResult,
  BoosterExpirySampleProcessorState,
  BoosterExpiryVideoSample,
  BoosterExpiryWorkerProcessed,
} from "./boosterExpirySampleProcessorState";

export function processBoosterExpiryWorkerSample({
  config,
  currentState,
  diagnostics,
  previousState,
  previewImageData,
  processed,
  sample,
  sampledAt,
  shouldIncludePreview,
}: {
  config: BoosterExpiryAlertConfig;
  currentState: BoosterExpiryRuntimeState;
  diagnostics: BoosterExpirySampleProcessorState;
  previousState: BoosterExpiryRuntimeState;
  previewImageData: ImageData | null;
  processed: BoosterExpiryWorkerProcessed;
  sample: BoosterExpiryVideoSample;
  sampledAt: number;
  shouldIncludePreview: boolean;
}): BoosterExpirySampleProcessResult {
  const update = updateBoosterExpiryRuntimeState({
    previous: previousState,
    result: processed.result,
    config,
    now: sampledAt,
    hasStream: true,
  });
  const sameTickState = preserveSameTickAlertDecision(
    previousState,
    update.state,
    sampledAt,
  );
  const alreadyAlertedForSameSchedule =
    hasSameBoosterExpiryAlertSchedule(currentState, sameTickState) &&
    currentState.alertedAt !== null;
  const nextState = preserveConcurrentBoosterExpiryAlert(
    currentState,
    sameTickState,
  );
  const nextPreviewUrls = shouldIncludePreview
    ? createBoosterExpiryPreviewUrls({
        previewImageData,
        result: processed.result,
        sample,
      })
    : diagnostics.previewUrls;
  const withPreview = shouldIncludePreview
    ? {
        ...diagnostics,
        lastPreviewAt: sampledAt,
        previewUrls: nextPreviewUrls,
      }
    : diagnostics;
  const withTrace = appendBoosterExpiryTrace(withPreview, {
    sampledAt,
    state: nextState,
    result: processed.result,
    performance: processed.performance,
  });
  const snapshot: BoosterExpirySnapshot = {
    sampledAt,
    error: null,
    recognizerVersion: processed.result.recognizerVersion ?? null,
    rawPreviewUrl: nextPreviewUrls.rawPreviewUrl,
    timerPreviewUrl: nextPreviewUrls.timerPreviewUrl,
    regionLabel: `${sample.region.width}x${sample.region.height}`,
    rawTime: processed.result.rawTime,
    time: processed.result.time,
    timeRect: processed.result.timeRect,
    flow: processed.result.flow,
    performance: processed.performance,
    runtimeTrace: withTrace.trace,
    timerEvidence: [],
    confirmationEvidence: [],
  };

  return {
    stateBefore: previousState,
    state: nextState,
    snapshot,
    diagnostics: { ...withTrace, snapshot },
    shouldAlertNow: update.shouldAlert && !alreadyAlertedForSameSchedule,
    alreadyAlertedForSameSchedule,
    errorMessage: null,
  };
}

function preserveSameTickAlertDecision(
  previous: BoosterExpiryRuntimeState,
  next: BoosterExpiryRuntimeState,
  sampledAt: number,
): BoosterExpiryRuntimeState {
  if (
    previous.lastDecision === "alerted" &&
    previous.alertedAt !== null &&
    previous.alertedAt === sampledAt &&
    next.alertedAt === previous.alertedAt &&
    next.status === "alerted"
  ) {
    return {
      ...next,
      lastDecision: "alerted",
    };
  }
  return next;
}

function preserveConcurrentBoosterExpiryAlert(
  current: BoosterExpiryRuntimeState,
  next: BoosterExpiryRuntimeState,
): BoosterExpiryRuntimeState {
  if (
    current.alertedAt === null ||
    !hasSameBoosterExpiryAlertSchedule(current, next)
  ) {
    return next;
  }

  return {
    ...markBoosterExpiryRuntimeAlerted(next, current.alertedAt),
    lastAlertPlayback: current.lastAlertPlayback ?? next.lastAlertPlayback ?? null,
  };
}

function hasSameBoosterExpiryAlertSchedule(
  a: BoosterExpiryRuntimeState,
  b: BoosterExpiryRuntimeState,
): boolean {
  return (
    a.alertAt !== null &&
    b.alertAt !== null &&
    a.alertAt === b.alertAt &&
    a.confirmedExpiresAt !== null &&
    b.confirmedExpiresAt !== null &&
    a.confirmedExpiresAt === b.confirmedExpiresAt
  );
}
