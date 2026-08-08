import { hydrateBuffExpiryLastAlertEvidenceIcons } from "../../../lib/buffExpiry/buffExpiryEvidence";
import {
  createBuffExpiryNormalizedBoxPreviewImageData,
  createBuffExpiryNormalizedBoxPreviewUrls,
} from "../../../lib/buffExpiry/buffExpiryPreview";
import { sampleBuffExpiryPrecisionVideoFrame } from "../../../platform/frame-capture/buff-expiry/buffExpiryPrecisionCapture";
import {
  createBuffExpiryPrecisionBoxes,
  createBuffExpiryPrecisionNormalizedBoxIcons,
  createBuffExpiryPrecisionPerformanceMetrics,
  getBuffExpiryPrecisionAcceptedMatchCount,
  getBuffExpiryPrecisionRuntimeStatus,
} from "./buffExpiryPrecisionSampleArtifacts";
import {
  getBuffExpiryPrecisionSelectedTargetGroups,
} from "../../../domain/buff-expiry/precisionTrackingPolicy";
import type { BuffExpiryPrecisionTargetGroup } from "../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import type { BuffExpiryAlertConfig } from "../../../types";
import { createPlaceholderImageData } from "../../../lib/imageData";
import {
  createBuffSlotEvidenceSource,
  type BuffSlotEvidenceSource,
} from "../../../lib/buffSlotParser/buffSlotFrameCapture";
import {
  applyBuffExpiryPrecisionSampleTracking,
  publishBuffExpiryPrecisionSampleState,
  updateBuffExpiryPrecisionDisplayBoxes,
  updateBuffExpiryPrecisionPreloadStatusFromSampleResponse,
  updateBuffExpiryPrecisionPreviewState,
  updateBuffExpiryPrecisionRoiHistory,
  type BuffExpiryPrecisionTrackingUpdate,
} from "./buffExpiryPrecisionSampleProcessorState";
import type { BuffExpiryPrecisionSampleProcessorContext } from "./buffExpirySampleProcessorContext";
import type { SharedBuffSlotAnalysisResult } from "./useSharedBuffSlotAnalysis";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";

type ProcessBuffExpiryPrecisionSampleOptions = {
  sampledAt: number;
  frameContext: MonitoringFrameContext;
  shouldIncludeDebugPreview: boolean;
  showDebugColumns: boolean;
  config: BuffExpiryAlertConfig;
  context: BuffExpiryPrecisionSampleProcessorContext;
  sharedBuffSlotAnalysis?: SharedBuffSlotAnalysisResult | null;
  isResultCurrent?: () => boolean;
  onMatcherOcrCompleted?: () => void;
  onTemporalDecisionCompleted?: (
    tracking: BuffExpiryPrecisionTrackingUpdate,
  ) => void;
};

export async function processBuffExpiryPrecisionSample({
  sampledAt,
  frameContext,
  shouldIncludeDebugPreview,
  showDebugColumns,
  config,
  context,
  sharedBuffSlotAnalysis = null,
  isResultCurrent = () => true,
  onMatcherOcrCompleted,
  onTemporalDecisionCompleted,
}: ProcessBuffExpiryPrecisionSampleOptions): Promise<{
  state: ReturnType<typeof publishBuffExpiryPrecisionSampleState>["state"];
  snapshot: ReturnType<typeof publishBuffExpiryPrecisionSampleState>["snapshot"];
  evidenceSource: BuffSlotEvidenceSource | null;
  parserRuntime: SharedBuffSlotAnalysisResult["analysis"]["runtime"] | null;
  parserPerformance: SharedBuffSlotAnalysisResult["performance"] | null;
  confirmedTransitions: BuffExpiryPrecisionTrackingUpdate["confirmedTransitions"];
}> {
  const frame = sharedBuffSlotAnalysis && !shouldIncludeDebugPreview
    ? createBuffExpiryPrecisionVideoSampleFromSharedFrame(sharedBuffSlotAnalysis)
    : frameContext.gameViewport?.mode === "calibrated"
      ? sampleBuffExpiryPrecisionVideoFrame(
          frameContext.video,
          shouldIncludeDebugPreview,
          shouldIncludeDebugPreview,
          frameContext.gameViewport.region,
        )
      : sampleBuffExpiryPrecisionVideoFrame(
          frameContext.video,
          shouldIncludeDebugPreview,
          shouldIncludeDebugPreview,
        );
  const previewImageData = shouldIncludeDebugPreview
    ? new ImageData(
        new Uint8ClampedArray(frame.imageData.data),
        frame.imageData.width,
        frame.imageData.height,
      )
    : null;

  context.trackMonitoringStarted();

  const activeGroups = getBuffExpiryPrecisionSelectedTargetGroups(config);
  const response = await context.precisionEngineRef.current.process({
    imageData: sharedBuffSlotAnalysis ? createPlaceholderImageData() : frame.imageData,
    sampledAt,
    buffSlotAnalysis: sharedBuffSlotAnalysis?.analysis,
    sourceSize: sharedBuffSlotAnalysis?.frame.sourceSize ?? {
      width: frame.imageData.width,
      height: frame.imageData.height,
    },
    activeGroups,
  });
  if (!isResultCurrent()) {
    throw new Error("buff-expiry-sample-superseded");
  }
  safelyNotifyWarmTraceBoundary(onMatcherOcrCompleted);
  const boxes = createBuffExpiryPrecisionBoxes(response);
  const displayBoxes = updateBuffExpiryPrecisionDisplayBoxes({ boxes });
  const selectedGroups = new Set(activeGroups);
  const previewBoxIndexes = getBuffExpiryPrecisionPreviewBoxIndexes({
    response,
    boxes,
    displayBoxes,
    selectedGroups,
    showDebugColumns,
    lastAlertEvidence: context.buffExpiryRuntimeRef.current.lastAlertEvidence ?? null,
  });
  const normalizedBoxIcons = createBuffExpiryPrecisionNormalizedBoxIcons({
    response,
    boxes,
    boxIndexes: previewBoxIndexes,
  });
  const boxPreviewUrls = createBuffExpiryNormalizedBoxPreviewUrls({
    normalizedBoxIcons,
  });
  const boxPreviewImageData = createBuffExpiryNormalizedBoxPreviewImageData({
    normalizedBoxIcons,
  });
  const tracking = applyBuffExpiryPrecisionSampleTracking({
    sampledAt,
    response,
    config,
    context,
    boxes,
    boxPreviewUrls,
  });
  safelyNotifyWarmTraceBoundary(onTemporalDecisionCompleted, tracking);

  updateBuffExpiryPrecisionRoiHistory({
    sampledAt,
    frameContext,
    response,
    tracking,
    context,
  });

  const processedPreviewUrl = updateBuffExpiryPrecisionPreviewState({
    sampledAt,
    frame,
    previewImageData,
    boxes,
    shouldIncludeDebugPreview,
    context,
  });
  const acceptedMatchCount = getBuffExpiryPrecisionAcceptedMatchCount(response, selectedGroups);
  const performance = createBuffExpiryPrecisionPerformanceMetrics({
    response,
    acceptedMatchCount,
  });
  updateBuffExpiryPrecisionPreloadStatusFromSampleResponse({ response, context });
  const nextStatus = getBuffExpiryPrecisionRuntimeStatus({
    tracks: tracking.nextTracks,
    pendingTracks: tracking.pendingTracks,
    boxCount: boxes.length,
  });
  const lastAlertEvidence = hydrateBuffExpiryLastAlertEvidenceIcons(
    context.buffExpiryRuntimeRef.current.lastAlertEvidence ?? null,
    boxPreviewUrls,
    boxes,
  );

  const published = publishBuffExpiryPrecisionSampleState({
    sampledAt,
    frame,
    response,
    boxes,
    displayBoxes,
    boxPreviewUrls,
    boxPreviewImageData,
    processedPreviewUrl,
    acceptedMatchCount,
    performance,
    nextStatus,
    tracking,
    lastAlertEvidence,
    showDebugColumns,
    context,
  });
  return {
    ...published,
    confirmedTransitions: tracking.confirmedTransitions,
    evidenceSource: sharedBuffSlotAnalysis
      ? createBuffSlotEvidenceSource(sharedBuffSlotAnalysis.frame)
      : null,
    parserRuntime: sharedBuffSlotAnalysis?.analysis.runtime ?? null,
    parserPerformance: sharedBuffSlotAnalysis?.performance ?? null,
  };
}

function safelyNotifyWarmTraceBoundary<T>(
  listener: ((value: T) => void) | undefined,
  value: T,
): void;
function safelyNotifyWarmTraceBoundary(
  listener: (() => void) | undefined,
): void;
function safelyNotifyWarmTraceBoundary<T>(
  listener: ((value?: T) => void) | undefined,
  value?: T,
): void {
  try {
    listener?.(value);
  } catch {
    // Warm-trace instrumentation cannot replace a valid product sample.
  }
}

function createBuffExpiryPrecisionVideoSampleFromSharedFrame(
  sharedBuffSlotAnalysis: SharedBuffSlotAnalysisResult,
): ReturnType<typeof sampleBuffExpiryPrecisionVideoFrame> {
  const frame = sharedBuffSlotAnalysis.frame;
  return {
    imageData: createPlaceholderImageData(),
    roi: {
      x: 0,
      y: 0,
      width: frame.sourceSize.width,
      height: frame.sourceSize.height,
    },
    rawPreviewUrl: null,
    fullFramePreviewUrl: null,
  };
}

const BUFF_EXPIRY_DEBUG_PREVIEW_BOX_LIMIT = 40;

function getBuffExpiryPrecisionPreviewBoxIndexes({
  response,
  boxes,
  displayBoxes,
  selectedGroups,
  showDebugColumns,
  lastAlertEvidence,
}: {
  response: Parameters<typeof createBuffExpiryPrecisionNormalizedBoxIcons>[0]["response"];
  boxes: Parameters<typeof createBuffExpiryPrecisionNormalizedBoxIcons>[0]["boxes"];
  displayBoxes: Parameters<typeof createBuffExpiryPrecisionNormalizedBoxIcons>[0]["boxes"];
  selectedGroups: Set<BuffExpiryPrecisionTargetGroup>;
  showDebugColumns: boolean;
  lastAlertEvidence: ReturnType<typeof hydrateBuffExpiryLastAlertEvidenceIcons>;
}): number[] {
  const boxIndexes = new Set<number>();
  const boxIndexByKey = new Map(boxes.map((box, index) => [getBuffExpiryPrecisionBoxKey(box), index]));

  for (const box of displayBoxes) {
    const index = boxIndexByKey.get(getBuffExpiryPrecisionBoxKey(box));
    if (typeof index === "number") {
      boxIndexes.add(index);
    }
  }

  for (const observation of response.iconObservations) {
    if (
      observation.identity.kind === "target" &&
      observation.identity.group !== null &&
      selectedGroups.has(observation.identity.group)
    ) {
      boxIndexes.add(observation.boxIndex);
    }
  }

  for (const candidate of response.bestByGroup) {
    if (selectedGroups.has(candidate.group)) {
      boxIndexes.add(candidate.boxIndex);
    }
  }

  for (const track of lastAlertEvidence?.triggeredTracks ?? []) {
    const exactIndex = boxIndexByKey.get(getBuffExpiryPrecisionBoxKey(track.box));
    if (typeof exactIndex === "number") {
      boxIndexes.add(exactIndex);
      continue;
    }
    const sameSlotIndex = boxes.findIndex(
      (box) =>
        Number.isFinite(box.row) &&
        Number.isFinite(box.col) &&
        Number.isFinite(track.box.row) &&
        Number.isFinite(track.box.col) &&
        Math.round(box.row ?? -1) === Math.round(track.box.row ?? -2) &&
        Math.round(box.col ?? -1) === Math.round(track.box.col ?? -2),
    );
    if (sameSlotIndex >= 0) {
      boxIndexes.add(sameSlotIndex);
    }
  }

  if (showDebugColumns) {
    boxes.slice(0, BUFF_EXPIRY_DEBUG_PREVIEW_BOX_LIMIT).forEach((_, index) => {
      boxIndexes.add(index);
    });
  }

  return [...boxIndexes].filter((index) => index >= 0 && index < boxes.length);
}

function getBuffExpiryPrecisionBoxKey(box: { x: number; y: number; width: number; height: number }) {
  return `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.width)}:${Math.round(box.height)}`;
}
