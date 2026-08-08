import { updateBoosterExpiryRuntimeState } from "../../../lib/boosterExpiry/boosterExpiryRuntime";
import type { BoosterExpiryRuntimeState } from "../../../lib/boosterExpiry/boosterExpiryTypes";
import type { BoosterExpiryAlertConfig } from "../../../types";
import {
  appendBoosterExpiryTrace,
  createBoosterExpiryDiagnosticSnapshot,
} from "./boosterExpirySampleProcessorDiagnostics";
import {
  BOOSTER_EXPIRY_CANVAS_ERROR_MESSAGE,
  type BoosterExpirySampleProcessResult,
  type BoosterExpirySampleProcessorState,
} from "./boosterExpirySampleProcessorState";
import { createRuntimeAnalysisFailureEvidence } from "./runtimeAnalysisFailure";

export { appendBoosterExpiryAlertedTrace } from "./boosterExpirySampleProcessorDiagnostics";
export {
  createBoosterExpirySampleProcessorState,
  resetBoosterExpirySampleProcessorState,
  shouldIncludeBoosterExpiryPreview,
} from "./boosterExpirySampleProcessorState";
export type {
  BoosterExpirySampleProcessResult,
  BoosterExpirySampleProcessorState,
} from "./boosterExpirySampleProcessorState";
export { processBoosterExpiryWorkerSample } from "./boosterExpiryWorkerSampleProcessor";

export function processBoosterExpiryUnavailableSample({
  config,
  diagnostics,
  hasStream,
  previousState,
  sampledAt,
}: {
  config: BoosterExpiryAlertConfig;
  diagnostics: BoosterExpirySampleProcessorState;
  hasStream: boolean;
  previousState: BoosterExpiryRuntimeState;
  sampledAt: number;
}): BoosterExpirySampleProcessResult {
  const update = updateBoosterExpiryRuntimeState({
    previous: previousState,
    result: null,
    config,
    now: sampledAt,
    hasStream,
  });
  const nextDiagnostics = appendBoosterExpiryTrace(diagnostics, {
    sampledAt,
    state: update.state,
    result: null,
    performance: null,
  });
  const snapshot = createBoosterExpiryDiagnosticSnapshot(
    sampledAt,
    update.state,
    nextDiagnostics,
  );
  return {
    stateBefore: previousState,
    state: update.state,
    snapshot,
    diagnostics: { ...nextDiagnostics, snapshot },
    shouldAlertNow: false,
    alreadyAlertedForSameSchedule: false,
    errorMessage: null,
  };
}

export function processBoosterExpirySampleError({
  config,
  diagnostics,
  error,
  previousState,
  sampledAt,
}: {
  config: BoosterExpiryAlertConfig;
  diagnostics: BoosterExpirySampleProcessorState;
  error: unknown;
  previousState: BoosterExpiryRuntimeState;
  sampledAt: number;
}): BoosterExpirySampleProcessResult {
  const update = updateBoosterExpiryRuntimeState({
    previous: previousState,
    result: null,
    config,
    now: sampledAt,
    hasStream: true,
  });
  const runtimeFailure = createRuntimeAnalysisFailureEvidence({
    error,
    occurredAt: sampledAt,
    stage:
      error instanceof Error && error.message === "canvas-context-unavailable"
        ? "frame-capture"
        : "feature-analysis",
  });
  const nextDiagnostics = appendBoosterExpiryTrace(diagnostics, {
    sampledAt,
    state: update.state,
    result: null,
    performance: null,
    runtimeFailure,
  });
  const snapshot = createBoosterExpiryDiagnosticSnapshot(
    sampledAt,
    update.state,
    nextDiagnostics,
  );
  return {
    stateBefore: previousState,
    state: update.state,
    snapshot,
    diagnostics: { ...nextDiagnostics, snapshot },
    shouldAlertNow: false,
    alreadyAlertedForSameSchedule: false,
    errorMessage:
      error instanceof Error && error.message === "canvas-context-unavailable"
        ? BOOSTER_EXPIRY_CANVAS_ERROR_MESSAGE
        : null,
  };
}
