import { createBuffExpiryProcessedPreview } from "../../../lib/buffExpiry/buffExpiryPreview";
import type { BuffExpiryBox } from "../../../domain/buff-expiry/precisionTrackingTypes";
import type { BuffExpiryPrecisionSampleResponse } from "../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import type { sampleBuffExpiryPrecisionVideoFrame } from "../../../platform/frame-capture/buff-expiry/buffExpiryPrecisionCapture";
import type { BuffExpiryPrecisionSampleProcessorContext } from "./buffExpirySampleProcessorContext";

export function updateBuffExpiryPrecisionPreviewState({
  sampledAt,
  frame,
  previewImageData,
  boxes,
  shouldIncludeDebugPreview,
  context,
}: {
  sampledAt: number;
  frame: ReturnType<typeof sampleBuffExpiryPrecisionVideoFrame>;
  previewImageData: ImageData | null;
  boxes: BuffExpiryBox[];
  shouldIncludeDebugPreview: boolean;
  context: BuffExpiryPrecisionSampleProcessorContext;
}): string | null {
  const processedPreviewUrl =
    shouldIncludeDebugPreview && previewImageData
      ? createBuffExpiryProcessedPreview({
          imageData: previewImageData,
          roi: frame.roi,
          boxes,
          acceptedMatches: [],
          rejectedMatches: [],
        })
      : context.lastPreviewUrlsRef.current.processedPreviewUrl;
  context.lastPreviewUrlsRef.current = {
    rawPreviewUrl:
      frame.rawPreviewUrl ?? context.lastPreviewUrlsRef.current.rawPreviewUrl,
    processedPreviewUrl,
    fullFramePreviewUrl:
      frame.fullFramePreviewUrl ??
      context.lastPreviewUrlsRef.current.fullFramePreviewUrl,
  };
  if (shouldIncludeDebugPreview) {
    context.lastPreviewAtRef.current = sampledAt;
  }
  return processedPreviewUrl;
}

export function updateBuffExpiryPrecisionPreloadStatusFromSampleResponse({
  response,
  context,
}: {
  response: BuffExpiryPrecisionSampleResponse;
  context: BuffExpiryPrecisionSampleProcessorContext;
}) {
  const countdownStatus = response.performance.countdownModelStatus;
  const matcherStatus = response.performance.matcherModelStatus;
  if (countdownStatus === "error" || matcherStatus === "error") {
    context.updatePrecisionEnginePreloadStatusFromSample("error");
  } else if (countdownStatus === "ready" && matcherStatus === "ready") {
    context.updatePrecisionEnginePreloadStatusFromSample("ready");
  } else if (
    countdownStatus === "loading" ||
    matcherStatus === "loading"
  ) {
    context.updatePrecisionEnginePreloadStatusFromSample("loading");
  }
}
