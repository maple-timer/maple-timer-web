import type {
  HuntStallCropHistoryFrame,
  HuntStallRuntimeState,
  HuntStallRuntimeTraceFrame,
  HuntStallSnapshot,
} from "../../../alertTypes";
import { cloneImageData, imageDataToUrl } from "../../../lib/imageData";
import { cloneImageDataSnapshot } from "../../../lib/imageDataSnapshot";
import type { HuntStallOcrEngine } from "../../../lib/huntStallOcrEngine";
import { captureManualExperienceCropFromVideo } from "../../../lib/huntStallManualExperienceSampling";
import { updateHuntStallManualExperienceRuntimeState } from "../../../lib/huntStallManualExperienceRuntime";
import { roundMs } from "../../../lib/huntStallOcrDiagnostics";
import { HUNT_STALL_EXPERIENCE_RECOGNIZER_VERSION } from "../../../lib/recognizerVersions";
import {
  getSkillRegionForLayout,
  hasUsableRegion,
} from "../../../lib/regions";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import type { HuntStallAlertConfig } from "../../../types";
import {
  appendHuntStallCropHistoryFrame,
  appendHuntStallRuntimeTraceFrame,
  createHuntStallRuntimeTraceFrame,
  createManualExperienceCropHistoryFrame,
  getManualExperienceCropHistoryReasons,
  type HuntStallSampleProcessResult,
  type HuntStallSampleProcessorPreviewState,
} from "./huntStallSampleProcessorShared";

export async function processHuntStallManualExperienceSample({
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
}: {
  config: HuntStallAlertConfig;
  context: MonitoringFrameContext;
  cropHistory: HuntStallCropHistoryFrame[];
  loopStartedAt: number;
  ocrEngine: HuntStallOcrEngine;
  previousState: HuntStallRuntimeState;
  previewState: HuntStallSampleProcessorPreviewState;
  runtimeTrace: HuntStallRuntimeTraceFrame[];
  sampledAt: number;
  shouldIncludePreview: boolean;
}): Promise<HuntStallSampleProcessResult> {
  const video = context.video;
  const gameViewport = context.gameViewport;
  if (!gameViewport) {
    throw new Error("game-viewport-unavailable");
  }
  const sourceDimensions = {
    width: gameViewport.region.width,
    height: gameViewport.region.height,
  };
  const region = getSkillRegionForLayout(
    {
      region: config.manualExperienceRegion ?? null,
      regionsByLayout: config.manualExperienceRegionsByLayout,
    },
    context.gameFrameLayoutKey,
  );
  const hasRegion = hasUsableRegion(region);

  if (!hasRegion) {
    const update = updateHuntStallManualExperienceRuntimeState({
      previous: previousState,
      reading: null,
      config,
      now: sampledAt,
      hasStream: true,
      hasRegion: false,
    });
    const nextTrace = appendHuntStallRuntimeTraceFrame(
      runtimeTrace,
      createHuntStallRuntimeTraceFrame({
        mode: "manual-experience",
        sampledAt,
        shouldAlert: false,
        snapshot: null,
        state: update.state,
      }),
    );
    return {
      stateBefore: previousState,
      state: update.state,
      snapshot: null,
      shouldAlert: false,
      shouldResetOcrState: false,
      previewState,
      runtimeTrace: nextTrace,
      cropHistory,
      errorMessage: null,
      incidentEvidence: {
        layoutKey: context.gameFrameLayoutKey ?? "unknown",
        sourceDimensions,
        region: null,
        sourceToCrop: null,
        recognition: {
          decision: "missing",
          reason: "no-region",
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
          failure: null,
        },
        recognizer: createManualExperienceRecognizerProvenance(),
        runtimeFailure: null,
        timings: null,
        media: null,
      },
    };
  }

  const crop = captureManualExperienceCropFromVideo({
    video,
    region,
    includePreview: shouldIncludePreview,
    sourceRegion:
      gameViewport.mode === "calibrated" ? gameViewport.region : undefined,
  });
  const displayPreviewImageData = shouldIncludePreview
    ? cloneImageDataSnapshot(crop.displayPreviewImageData)
    : null;
  const rawPreviewImageData = shouldIncludePreview
    ? cloneImageDataSnapshot(crop.imageData)
    : null;
  // Worker transfer detaches its input buffer. Keep the non-preview source alive
  // because a state transition may still need it for bounded incident evidence.
  const workerImageData = shouldIncludePreview
    ? crop.imageData
    : cloneImageData(crop.imageData);
  const response = await ocrEngine.processCrop({
    sampleIndex: Math.max(0, Math.floor(sampledAt)),
    sourceWidth: sourceDimensions.width,
    sourceHeight: sourceDimensions.height,
    barStrips: [],
    candidates: [
      {
        label: "manual-experience",
        regionPixels: crop.regionPixels,
        imageData: workerImageData,
      },
    ],
    includePreview: shouldIncludePreview,
    includeReportDiagnostics: false,
    applyStreamingCorrection: false,
  });
  const selected = response.candidates[response.selectedIndex] ?? response.candidates[0];
  if (!selected) {
    throw new Error("hunt-stall-manual-experience-worker-empty-result");
  }
  const processedPreviewUrl =
    shouldIncludePreview && selected.processedImageData
      ? imageDataToUrl(selected.processedImageData)
      : null;
  const processedPreviewImageData =
    shouldIncludePreview && selected.processedImageData
      ? cloneImageDataSnapshot(selected.processedImageData)
      : null;
  const update = updateHuntStallManualExperienceRuntimeState({
    previous: previousState,
    reading: response.reading,
    config,
    now: sampledAt,
    hasStream: true,
    hasRegion: true,
  });
  const nextPreviewState = shouldIncludePreview
    ? {
        lastPreviewAt: sampledAt,
        urls: {
          displayPreviewUrl: crop.displayPreviewUrl,
          rawPreviewUrl: crop.rawPreviewUrl,
          processedPreviewUrl,
        },
        imageData: {
          displayPreviewImageData,
          rawPreviewImageData,
          processedPreviewImageData,
        },
      }
    : previewState;
  const loopMs = Math.round((performance.now() - loopStartedAt) * 10) / 10;
  const workerPerformance = response.performance;
  const performanceMetrics = {
    ...workerPerformance,
    totalMs: roundMs(crop.frameReadMs + workerPerformance.totalMs),
    loopMs,
    selectedFrameReadMs: crop.frameReadMs,
    fullFramePreviewMs: crop.fullFramePreviewMs,
  };
  const engineMs = performanceMetrics?.totalMs ?? loopMs;
  const nextHuntSnapshot: HuntStallSnapshot = {
    ...nextPreviewState.urls,
    ...(nextPreviewState.imageData ?? {}),
    sampledAt,
    mode: "manual-experience",
    fullFramePreviewUrl: crop.fullFramePreviewUrl,
    regionLabel: crop.regionLabel,
    recognizedText: response.reading.recognizedText,
    debugText: [response.reading.debugText, `ocrMs=${engineMs.toFixed(1)}`]
      .filter(Boolean)
      .join(" | "),
    confidence: response.reading.confidence,
    foregroundRatio: response.reading.foregroundRatio,
    changeScore: update.state.changeScore,
    performance: performanceMetrics,
  };
  const nextTrace = appendHuntStallRuntimeTraceFrame(
    runtimeTrace,
    createHuntStallRuntimeTraceFrame({
      mode: "manual-experience",
      sampledAt,
      shouldAlert: update.shouldAlert,
      snapshot: nextHuntSnapshot,
      state: update.state,
    }),
  );
  const reasons = getManualExperienceCropHistoryReasons({
    lastFrame: cropHistory[cropHistory.length - 1] ?? null,
    previous: previousState,
    sampledAt,
    shouldAlert: update.shouldAlert,
    snapshot: nextHuntSnapshot,
    state: update.state,
  });
  const nextCropHistory =
    reasons.length > 0
      ? appendHuntStallCropHistoryFrame(
          cropHistory,
          createManualExperienceCropHistoryFrame({
            previous: previousState,
            reasons,
            snapshot: {
              ...nextHuntSnapshot,
              rawPreviewUrl:
                crop.rawPreviewUrl ?? imageDataToUrl(crop.imageData),
              processedPreviewUrl: selected.processedImageData
                ? processedPreviewUrl ?? imageDataToUrl(selected.processedImageData)
                : crop.rawPreviewUrl ?? imageDataToUrl(crop.imageData),
            },
            state: update.state,
          }),
        )
      : cropHistory;
  const currentHistoryFrame =
    nextCropHistory[nextCropHistory.length - 1]?.sampledAt === sampledAt
      ? nextCropHistory[nextCropHistory.length - 1]
      : null;

  return {
    stateBefore: previousState,
    state: update.state,
    snapshot: {
      ...nextHuntSnapshot,
      runtimeTrace: nextTrace,
      cropHistory: nextCropHistory,
    },
    shouldAlert: update.shouldAlert,
    shouldResetOcrState: false,
    previewState: nextPreviewState,
    runtimeTrace: nextTrace,
    cropHistory: nextCropHistory,
    errorMessage: null,
    incidentEvidence: {
      layoutKey: context.gameFrameLayoutKey ?? "unknown",
      sourceDimensions,
      region: crop.regionPixels,
      sourceToCrop: {
        scaleX: crop.imageData.width / Math.max(1, crop.regionPixels.width),
        scaleY: crop.imageData.height / Math.max(1, crop.regionPixels.height),
        offsetX: 0,
        offsetY: 0,
      },
      recognition: {
        decision:
          update.state.lastDecision === "foreground-ratio"
            ? "rejected"
            : update.state.lastDecision === "sample-error"
              ? "error"
              : "accepted",
        reason:
          update.state.lastDecision === "foreground-ratio" ||
          update.state.lastDecision === "sample-error"
            ? update.state.lastDecision
            : response.reading.correctionReason ?? null,
        rawText:
          response.reading.rawRecognizedText ??
          response.reading.oneFrameRecognizedText ??
          response.reading.recognizedText,
        rawValue: parseIncidentNumericValue(
          response.reading.rawRecognizedText ??
            response.reading.oneFrameRecognizedText ??
            response.reading.recognizedText,
        ),
        correctedValue: parseIncidentNumericValue(
          response.reading.correctedRecognizedText ??
            response.reading.recognizedText,
        ),
        fingerprint: response.reading.fingerprint,
        confidence: response.reading.confidence,
        foregroundRatio: response.reading.foregroundRatio,
        visualActivityScore: null,
        visualChangeScore: null,
        usedVisualFallback: false,
        readableStreak: update.state.stableSampleCount,
        visualActivityStreak: 0,
        failure: null,
      },
      recognizer: createManualExperienceRecognizerProvenance(),
      runtimeFailure: null,
      timings: {
        captureMs: crop.frameReadMs,
        cropMs: null,
        recognitionMs: workerPerformance.selectedOcrMs ?? workerPerformance.totalMs,
        transitionMs: Math.max(
          0,
          loopMs - crop.frameReadMs - workerPerformance.totalMs,
        ),
        totalMs: loopMs,
      },
      media: {
        rawDataUrl:
          currentHistoryFrame?.rawDataUrl ?? nextHuntSnapshot.rawPreviewUrl,
        processedDataUrl:
          currentHistoryFrame?.processedDataUrl ??
          nextHuntSnapshot.processedPreviewUrl,
      },
    },
  };
}

function createManualExperienceRecognizerProvenance() {
  return {
    engine: "experience-ocr",
    modelId: HUNT_STALL_EXPERIENCE_RECOGNIZER_VERSION,
    modelVersion: HUNT_STALL_EXPERIENCE_RECOGNIZER_VERSION,
    workerVersion: null,
    provider: "worker",
  };
}

function parseIncidentNumericValue(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
