import type {
  HuntStallCropHistoryFrame,
  HuntStallRuntimeState,
  HuntStallRuntimeTraceFrame,
} from "../../../alertTypes";
import {
  updateHuntStallCooldownPresenceRuntimeState,
} from "../../../lib/huntStallCooldownPresenceRuntime";
import type { HuntStallCooldownWorkerClient } from "../../../platform/runtime-workers/hunt-stall-cooldown/huntStallCooldownWorkerClient";
import type { HuntStallOcrEngine } from "../../../lib/huntStallOcrEngine";
import type { HuntStallAlertConfig } from "../../../types";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import { processHuntStallCooldownPresenceSample } from "./huntStallCooldownSampleProcessor";
import { processHuntStallManualExperienceSample } from "./huntStallManualExperienceSampleProcessor";
import { updateHuntStallManualExperienceRuntimeState } from "../../../lib/huntStallManualExperienceRuntime";
import {
  createHuntStallSampleProcessorPreviewState,
  appendHuntStallRuntimeTraceFrame,
  createHuntStallRuntimeTraceFrame,
  HUNT_STALL_CANVAS_ERROR_MESSAGE,
  shouldIncludeHuntStallPreview,
  type HuntStallSampleProcessResult,
  type HuntStallSampleProcessorPreviewState,
} from "./huntStallSampleProcessorShared";
import { createRuntimeAnalysisFailureEvidence } from "./runtimeAnalysisFailure";

export { createHuntStallSampleProcessorPreviewState } from "./huntStallSampleProcessorShared";
export type {
  HuntStallSampleProcessResult,
  HuntStallSampleProcessorPreviewState,
} from "./huntStallSampleProcessorShared";

export function processHuntStallUnavailableSample({
  config,
  hasStream,
  previousState,
  previewState,
  runtimeTrace,
  cropHistory,
  sampledAt,
}: {
  config: HuntStallAlertConfig;
  hasStream: boolean;
  previousState: HuntStallRuntimeState;
  previewState: HuntStallSampleProcessorPreviewState;
  runtimeTrace: HuntStallRuntimeTraceFrame[];
  cropHistory: HuntStallCropHistoryFrame[];
  sampledAt: number;
}): HuntStallSampleProcessResult {
  const update =
    config.mode === "cooldown-presence"
      ? updateHuntStallCooldownPresenceRuntimeState({
          previous: previousState,
          result: null,
          config,
          now: sampledAt,
          hasStream,
          hasRegion: true,
        })
      : updateHuntStallManualExperienceRuntimeState({
          previous: previousState,
          reading: null,
          config,
          now: sampledAt,
          hasStream,
          hasRegion: true,
        });
  return {
    stateBefore: previousState,
    state: update.state,
    snapshot: null,
    shouldAlert: false,
    shouldResetOcrState: false,
    previewState,
    runtimeTrace,
    cropHistory,
    errorMessage: null,
    incidentEvidence: null,
  };
}

export async function processHuntStallActiveSample({
  config,
  context,
  cooldownWorker,
  cropHistory,
  ocrEngine,
  previousState,
  previewState,
  runtimeTrace,
  sampledAt,
  showDebugColumns,
}: {
  config: HuntStallAlertConfig;
  context: MonitoringFrameContext;
  cooldownWorker: HuntStallCooldownWorkerClient;
  cropHistory: HuntStallCropHistoryFrame[];
  ocrEngine: HuntStallOcrEngine;
  previousState: HuntStallRuntimeState;
  previewState: HuntStallSampleProcessorPreviewState;
  runtimeTrace: HuntStallRuntimeTraceFrame[];
  sampledAt: number;
  showDebugColumns: boolean;
}): Promise<HuntStallSampleProcessResult> {
  const loopStartedAt = performance.now();
  const shouldIncludePreview = shouldIncludeHuntStallPreview({
    sampledAt,
    requiresPreview: config.mode === "manual-experience",
    showDebugColumns,
    previousPreviewAt: previewState.lastPreviewAt,
  });

  if (config.mode === "cooldown-presence") {
    return processHuntStallCooldownPresenceSample({
      config,
      context,
      cooldownWorker,
      cropHistory,
      loopStartedAt,
      previousState,
      previewState,
      runtimeTrace,
      sampledAt,
      shouldIncludePreview,
    });
  }

  return processHuntStallManualExperienceSample({
    config,
    context,
    cropHistory,
    loopStartedAt,
    ocrEngine,
    previousState,
    previewState,
    runtimeTrace,
    sampledAt,
    shouldIncludePreview,
  });
}

export function processHuntStallSampleError({
  config,
  cropHistory,
  error,
  previousState,
  previewState,
  runtimeTrace,
  sampledAt,
}: {
  config: HuntStallAlertConfig;
  cropHistory: HuntStallCropHistoryFrame[];
  error: unknown;
  previousState: HuntStallRuntimeState;
  previewState: HuntStallSampleProcessorPreviewState;
  runtimeTrace: HuntStallRuntimeTraceFrame[];
  sampledAt: number;
}): HuntStallSampleProcessResult {
  const update =
    config.mode === "cooldown-presence"
      ? updateHuntStallCooldownPresenceRuntimeState({
          previous: previousState,
          result: null,
          config,
          now: sampledAt,
          hasStream: true,
          hasRegion: true,
        })
      : updateHuntStallManualExperienceRuntimeState({
          previous: previousState,
          reading: null,
          config,
          now: sampledAt,
          hasStream: true,
          hasRegion: true,
        });
  const runtimeFailure = createRuntimeAnalysisFailureEvidence({
    error,
    occurredAt: sampledAt,
    stage:
      error instanceof Error && error.message === "canvas-context-unavailable"
        ? "frame-capture"
        : "feature-analysis",
  });
  const nextRuntimeTrace = appendHuntStallRuntimeTraceFrame(
    runtimeTrace,
    createHuntStallRuntimeTraceFrame({
      mode: config.mode,
      runtimeFailure,
      sampledAt,
      shouldAlert: false,
      snapshot: null,
      state: update.state,
    }),
  );

  return {
    stateBefore: previousState,
    state: update.state,
    snapshot: {
      sampledAt,
      rawPreviewUrl: previewState.urls.rawPreviewUrl,
      rawPreviewImageData: previewState.imageData?.rawPreviewImageData ?? null,
      displayPreviewUrl: previewState.urls.displayPreviewUrl,
      displayPreviewImageData:
        previewState.imageData?.displayPreviewImageData ?? null,
      processedPreviewUrl: previewState.urls.processedPreviewUrl,
      processedPreviewImageData:
        previewState.imageData?.processedPreviewImageData ?? null,
      mode: config.mode,
      regionLabel: null,
      recognizedText: null,
      confidence: 0,
      foregroundRatio: 0,
      changeScore: 0,
      runtimeTrace: nextRuntimeTrace,
      cropHistory,
      runtimeFailure,
    },
    shouldAlert: false,
    shouldResetOcrState: false,
    previewState,
    runtimeTrace: nextRuntimeTrace,
    cropHistory,
    errorMessage:
      error instanceof Error && error.message === "canvas-context-unavailable"
        ? HUNT_STALL_CANVAS_ERROR_MESSAGE
        : null,
    incidentEvidence: {
      layoutKey: "unknown",
      sourceDimensions: null,
      region: null,
      sourceToCrop: null,
      recognition: {
        decision: "error",
        reason: runtimeFailure.code,
        rawText: null,
        rawValue: null,
        correctedValue: null,
        fingerprint: null,
        confidence: null,
        foregroundRatio: null,
        visualActivityScore: null,
        visualChangeScore: null,
        usedVisualFallback: false,
        readableStreak: 0,
        visualActivityStreak: 0,
        failure: toHuntStallIncidentRuntimeFailure(runtimeFailure),
      },
      recognizer: null,
      runtimeFailure: toHuntStallIncidentRuntimeFailure(runtimeFailure),
      timings: null,
      media: null,
    },
  };
}

function toHuntStallIncidentRuntimeFailure(
  failure: ReturnType<typeof createRuntimeAnalysisFailureEvidence>,
) {
  return {
    stage:
      failure.stage === "frame-capture"
        ? ("capture" as const)
        : ("recognition" as const),
    code: failure.code,
    message: failure.technicalMessage,
    durationMs: null,
    recovered: false,
  };
}
