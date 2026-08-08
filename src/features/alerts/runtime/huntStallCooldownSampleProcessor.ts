import type {
  HuntStallCropHistoryFrame,
  HuntStallRuntimeState,
  HuntStallRuntimeTraceFrame,
  HuntStallSnapshot,
} from "../../../alertTypes";
import { cloneImageDataSnapshot } from "../../../lib/imageDataSnapshot";
import { updateHuntStallCooldownPresenceRuntimeState } from "../../../lib/huntStall";
import type { HuntStallCooldownWorkerClient } from "../../../platform/runtime-workers/hunt-stall-cooldown/huntStallCooldownWorkerClient";
import type { HuntStallCooldownVisualActivity } from "../../../recognition/hunt-stall/cooldown/huntStallCooldownActivity";
import {
  getSkillRegionForLayout,
  hasUsableRegion,
} from "../../../lib/regions";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import type { HuntStallAlertConfig, RecognitionResult } from "../../../types";
import { COOLDOWN_DIGIT_RECOGNIZER_VERSION } from "../../../contracts/recognition/cooldownDigitRecognition";
import { TRUSTED_CONFIDENCE } from "../../../lib/timerRules";
import {
  appendHuntStallCropHistoryFrame,
  appendHuntStallRuntimeTraceFrame,
  createCooldownCropHistoryFrame,
  createHuntStallRuntimeTraceFrame,
  getCooldownCropHistoryReasons,
  type HuntStallSampleProcessResult,
  type HuntStallSampleProcessorPreviewState,
} from "./huntStallSampleProcessorShared";

export async function processHuntStallCooldownPresenceSample({
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
}: {
  config: HuntStallAlertConfig;
  context: MonitoringFrameContext;
  cooldownWorker: HuntStallCooldownWorkerClient;
  cropHistory: HuntStallCropHistoryFrame[];
  loopStartedAt: number;
  previousState: HuntStallRuntimeState;
  previewState: HuntStallSampleProcessorPreviewState;
  runtimeTrace: HuntStallRuntimeTraceFrame[];
  sampledAt: number;
  shouldIncludePreview: boolean;
}): Promise<HuntStallSampleProcessResult> {
  const currentRegion = getSkillRegionForLayout(
    {
      region: config.cooldownRegion,
      regionsByLayout: config.cooldownRegionsByLayout,
    },
    context.gameFrameLayoutKey,
  );
  const hasRegion = hasUsableRegion(currentRegion);
  let result: RecognitionResult | null = null;
  let activity: HuntStallCooldownVisualActivity | null = null;
  let workerMs: number | null = null;
  let rawPreviewUrl: string | null = null;
  let previewUrl: string | null = null;
  let rawPreviewImageData: HuntStallSnapshot["rawPreviewImageData"] = null;
  let processedPreviewImageData: HuntStallSnapshot["processedPreviewImageData"] = null;
  let regionLabel: string | null = null;
  let sampledRegion: { x: number; y: number; width: number; height: number } | null = null;
  let sampledImageSize: { width: number; height: number } | null = null;

  if (hasRegion) {
    const sample = context.sampleSkill(currentRegion, true);
    rawPreviewUrl = sample.rawPreviewUrl;
    previewUrl = sample.previewUrl;
    rawPreviewImageData = shouldIncludePreview
      ? cloneImageDataSnapshot(sample.rawImageData ?? sample.imageData)
      : null;
    processedPreviewImageData = shouldIncludePreview
      ? cloneImageDataSnapshot(sample.imageData)
      : null;
    regionLabel = `${sample.region.width}x${sample.region.height}`;
    sampledRegion = sample.region;
    sampledImageSize = {
      width: sample.rawImageData?.width ?? sample.imageData.width,
      height: sample.rawImageData?.height ?? sample.imageData.height,
    };
    const processed = await cooldownWorker.process(sample.imageData);
    result = processed.result;
    activity = processed.activity;
    workerMs = processed.performance.totalMs;
  }

  const update = updateHuntStallCooldownPresenceRuntimeState({
    previous: previousState,
    result,
    activity,
    config,
    now: sampledAt,
    hasStream: true,
    hasRegion,
  });
  const nextPreviewState =
    shouldIncludePreview && hasRegion
      ? {
          lastPreviewAt: sampledAt,
          urls: {
            displayPreviewUrl: null,
            rawPreviewUrl,
            processedPreviewUrl: previewUrl,
          },
          imageData: {
            displayPreviewImageData: null,
            rawPreviewImageData,
            processedPreviewImageData,
          },
        }
      : previewState;
  const loopMs = Math.round((performance.now() - loopStartedAt) * 10) / 10;
  const snapshotResult: RecognitionResult = result ?? {
    value: null,
    confidence: 0,
    debug: {
      reason: "cooldown-empty",
      foregroundRatio: activity?.foregroundRatio ?? 0,
    },
  };
  const nextHuntSnapshot = hasRegion
    ? createCooldownPresenceSnapshot({
        changeScore: update.state.changeScore,
        debugMs: loopMs,
        rawPreviewUrl,
        rawPreviewImageData,
        previewUrl,
        processedPreviewImageData:
          processedPreviewImageData,
        regionLabel,
        result: snapshotResult,
        sampledAt,
        visualActivity: activity,
        visualChangeScore: update.state.cooldownVisualChangeScore ?? null,
        visualChanged: Boolean(
          update.state.cooldownVisualChangedAt === sampledAt,
        ),
        visualUsed: update.state.cooldownUsedVisualActivity === true,
        workerMs,
      })
    : null;
  const nextTrace = appendHuntStallRuntimeTraceFrame(
    runtimeTrace,
    createHuntStallRuntimeTraceFrame({
      mode: "cooldown-presence",
      sampledAt,
      shouldAlert: update.shouldAlert,
      snapshot: nextHuntSnapshot,
      state: update.state,
    }),
  );
  let nextCropHistory = cropHistory;
  let nextSnapshotWithHistory = nextHuntSnapshot;

  if (nextHuntSnapshot) {
    const lastCropFrame = cropHistory[cropHistory.length - 1] ?? null;
    const cropHistoryReasons = getCooldownCropHistoryReasons({
      lastFrame: lastCropFrame,
      previous: previousState,
      sampledAt,
      shouldAlert: update.shouldAlert,
      snapshot: {
        ...nextHuntSnapshot,
        rawPreviewUrl,
        processedPreviewUrl: previewUrl,
      },
      state: update.state,
    });

    if (cropHistoryReasons.length > 0 && rawPreviewUrl) {
      nextCropHistory = appendHuntStallCropHistoryFrame(
        cropHistory,
        createCooldownCropHistoryFrame({
          previous: previousState,
          reasons: cropHistoryReasons,
          snapshot: {
            ...nextHuntSnapshot,
            rawPreviewUrl,
            processedPreviewUrl: previewUrl,
          },
          state: update.state,
        }),
      );
    }

    nextSnapshotWithHistory = {
      ...nextHuntSnapshot,
      runtimeTrace: nextTrace,
      cropHistory: nextCropHistory,
    };
  }

  return {
    stateBefore: previousState,
    state: update.state,
    snapshot: nextSnapshotWithHistory,
    shouldAlert: update.shouldAlert,
    shouldResetOcrState: false,
    previewState: nextPreviewState,
    runtimeTrace: nextTrace,
    cropHistory: nextCropHistory,
    errorMessage: null,
    incidentEvidence: {
      layoutKey: context.gameFrameLayoutKey ?? "unknown",
      sourceDimensions: {
        width: context.gameViewport?.region.width ?? context.video.videoWidth,
        height: context.gameViewport?.region.height ?? context.video.videoHeight,
      },
      region: sampledRegion,
      sourceToCrop:
        sampledRegion && sampledImageSize
          ? {
              scaleX: sampledImageSize.width / Math.max(1, sampledRegion.width),
              scaleY: sampledImageSize.height / Math.max(1, sampledRegion.height),
              offsetX: 0,
              offsetY: 0,
            }
          : null,
      recognition: {
        decision:
          result?.value !== null &&
          result?.value !== undefined &&
          result.confidence >= TRUSTED_CONFIDENCE
            ? "accepted"
            : result?.value === null || result?.value === undefined
              ? "missing"
              : "rejected",
        reason: result?.debug?.reason ?? null,
        rawText:
          result?.debug?.recognizedText ??
          (result?.value !== null && result?.value !== undefined
            ? String(result.value)
            : null),
        rawValue: result?.value ?? null,
        correctedValue: result?.value ?? null,
        fingerprint: activity?.fingerprint ?? null,
        confidence: result?.confidence ?? null,
        foregroundRatio:
          result?.debug?.foregroundRatio ?? activity?.foregroundRatio ?? null,
        visualActivityScore: activity?.foregroundRatio ?? null,
        visualChangeScore: update.state.cooldownVisualChangeScore ?? null,
        usedVisualFallback: update.state.cooldownUsedVisualActivity === true,
        readableStreak: update.state.cooldownConsecutiveReadableCount,
        visualActivityStreak:
          update.state.cooldownConsecutiveVisualActivityCount ?? 0,
        failure: null,
      },
      recognizer: {
        engine: "cooldown-digit",
        modelId: COOLDOWN_DIGIT_RECOGNIZER_VERSION,
        modelVersion: COOLDOWN_DIGIT_RECOGNIZER_VERSION,
        workerVersion: null,
        provider: "worker",
      },
      runtimeFailure: null,
      timings: {
        captureMs: null,
        cropMs: null,
        recognitionMs: workerMs,
        transitionMs:
          workerMs === null ? null : Math.max(0, loopMs - workerMs),
        totalMs: loopMs,
      },
      media:
        rawPreviewUrl || previewUrl
          ? {
              rawDataUrl: rawPreviewUrl,
              processedDataUrl: previewUrl ?? rawPreviewUrl,
            }
          : null,
    },
  };
}

function createCooldownPresenceSnapshot({
  changeScore,
  debugMs,
  rawPreviewUrl,
  previewUrl,
  processedPreviewImageData,
  regionLabel,
  result,
  sampledAt,
  rawPreviewImageData,
  visualActivity,
  visualChangeScore,
  visualChanged,
  visualUsed,
  workerMs,
}: {
  changeScore: number;
  debugMs: number;
  rawPreviewUrl: string | null;
  rawPreviewImageData: HuntStallSnapshot["rawPreviewImageData"];
  previewUrl: string | null;
  processedPreviewImageData: HuntStallSnapshot["processedPreviewImageData"];
  regionLabel: string | null;
  result: RecognitionResult;
  sampledAt: number;
  visualActivity: HuntStallCooldownVisualActivity | null;
  visualChangeScore: number | null;
  visualChanged: boolean;
  visualUsed: boolean;
  workerMs: number | null;
}): HuntStallSnapshot {
  return {
    sampledAt,
    rawPreviewUrl,
    rawPreviewImageData,
    processedPreviewUrl: previewUrl,
    processedPreviewImageData,
    mode: "cooldown-presence",
    regionLabel,
    recognizedText:
      result.value !== null
        ? String(result.value)
        : (result.debug?.recognizedText ?? null),
    debugText: [
      result.debug?.reason ?? null,
      visualChangeScore !== null
        ? `visual=${visualChangeScore.toFixed(3)}`
        : null,
      visualChanged ? "visualChanged=true" : null,
      visualUsed ? "visualUsed=true" : null,
      workerMs !== null ? `workerMs=${workerMs.toFixed(1)}` : null,
      `loopMs=${debugMs.toFixed(1)}`,
    ]
      .filter(Boolean)
      .join(" | "),
    confidence: result.confidence,
    foregroundRatio:
      result.debug?.foregroundRatio ?? visualActivity?.foregroundRatio ?? 0,
    changeScore,
    cooldownVisualChangeScore: visualChangeScore,
    cooldownVisualChanged: visualChanged,
    cooldownUsedVisualActivity: visualUsed,
    performance: null,
  };
}
