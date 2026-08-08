import type { HuntStallSnapshot } from "../alertTypes";
import type { HuntStallReading } from "../contracts/recognition/huntStallExperienceRecognition";
import { readHuntStallReadingFromImageData } from "../recognition/hunt-stall/experience/huntStallExperienceRecognition";
import type { PixelRegion } from "../contracts/geometry/pixelRegion";
import type { RelativeRegion } from "../types";
import { imageDataToUrl } from "./imageData";
import { captureFullFramePreview } from "./huntStallOcrSampling";
import { roundMs } from "./huntStallOcrDiagnostics";
import { normalizeRegion, regionToPixels } from "./regions";

export type ManualExperienceVideoSample = {
  imageData: ImageData;
  processedImageData: ImageData;
  reading: HuntStallReading;
  snapshot: HuntStallSnapshot;
};

export type ManualExperienceCropSample = {
  imageData: ImageData;
  displayPreviewImageData: ImageData | null;
  frameReadMs: number;
  fullFramePreviewMs: number | null;
  displayPreviewUrl: string | null;
  fullFramePreviewUrl: string | null;
  rawPreviewUrl: string | null;
  regionLabel: string;
  regionPixels: PixelRegion;
};

export function sampleManualExperienceFromVideo({
  includePreview,
  includeReportDiagnostics = false,
  region,
  sourceRegion,
  video,
}: {
  includePreview: boolean;
  includeReportDiagnostics?: boolean;
  region: RelativeRegion;
  sourceRegion?: PixelRegion;
  video: HTMLVideoElement;
}): ManualExperienceVideoSample {
  const totalStartedAt = performance.now();
  const crop = captureManualExperienceCropFromVideo({
    video,
    region,
    includePreview,
    includeReportDiagnostics,
    sourceRegion,
  });
  const ocrStartedAt = performance.now();
  const { processedImageData, reading } = readHuntStallReadingFromImageData(crop.imageData);
  const selectedOcrMs = roundMs(performance.now() - ocrStartedAt);
  const processedPreviewUrl =
    includePreview || includeReportDiagnostics ? imageDataToUrl(processedImageData) : null;

  return {
    imageData: crop.imageData,
    processedImageData,
    reading,
    snapshot: {
      sampledAt: Date.now(),
      displayPreviewUrl: crop.displayPreviewUrl,
      rawPreviewUrl: crop.rawPreviewUrl,
      processedPreviewUrl,
      fullFramePreviewUrl: crop.fullFramePreviewUrl,
      mode: "manual-experience",
      regionLabel: crop.regionLabel,
      recognizedText: reading.recognizedText,
      debugText: reading.debugText,
      confidence: reading.confidence,
      foregroundRatio: reading.foregroundRatio,
      changeScore: 0,
      performance: {
        totalMs: roundMs(performance.now() - totalStartedAt),
        barEstimateMs: null,
        candidateCount: null,
        candidateMs: null,
        selectedCandidateMs: null,
        selectedFrameReadMs: crop.frameReadMs,
        selectedOcrMs,
        selectedPreviewMs: null,
        fullFramePreviewMs: crop.fullFramePreviewMs,
        barFrameReadMs: null,
      },
    },
  };
}

export function captureManualExperienceCropFromVideo({
  includePreview,
  includeReportDiagnostics = false,
  region,
  sourceRegion,
  video,
}: {
  includePreview: boolean;
  includeReportDiagnostics?: boolean;
  region: RelativeRegion;
  sourceRegion?: PixelRegion;
  video: HTMLVideoElement;
}): ManualExperienceCropSample {
  const sourceFrame = sourceRegion ?? {
    x: 0,
    y: 0,
    width: video.videoWidth,
    height: video.videoHeight,
  };
  const pixelRegion = regionToPixels(
    normalizeRegion(region),
    sourceFrame.width,
    sourceFrame.height,
  );
  const capturePixelRegion = {
    x: sourceFrame.x + pixelRegion.x,
    y: sourceFrame.y + pixelRegion.y,
    width: pixelRegion.width,
    height: pixelRegion.height,
  };
  const scale = Math.max(1, Math.min(3, Math.floor(900 / Math.max(1, pixelRegion.width))));
  const width = Math.max(24, pixelRegion.width * scale);
  const height = Math.max(12, pixelRegion.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("canvas-context-unavailable");
  }

  context.imageSmoothingEnabled = false;
  const frameStartedAt = performance.now();
  context.drawImage(
    video,
    capturePixelRegion.x,
    capturePixelRegion.y,
    capturePixelRegion.width,
    capturePixelRegion.height,
    0,
    0,
    width,
    height,
  );
  const imageData = context.getImageData(0, 0, width, height);
  const frameReadMs = roundMs(performance.now() - frameStartedAt);
  const rawPreviewUrl = includePreview || includeReportDiagnostics
    ? canvas.toDataURL("image/png")
    : null;
  const displayPreview = createManualExperienceDisplayPreview({
    include: includePreview || includeReportDiagnostics,
    pixelRegion: offsetPixelRegion(
      getManualExperienceDisplayPreviewRegion(pixelRegion, sourceFrame.width),
      sourceFrame,
    ),
    video,
  });
  const fullFramePreview = captureFullFramePreview(
    video,
    video.videoWidth,
    video.videoHeight,
    includeReportDiagnostics,
    sourceRegion,
  );

  return {
    imageData,
    displayPreviewImageData: displayPreview.imageData,
    frameReadMs,
    fullFramePreviewMs: fullFramePreview.ms,
    displayPreviewUrl: displayPreview.url,
    fullFramePreviewUrl: fullFramePreview.url,
    rawPreviewUrl,
    regionLabel: `${pixelRegion.x},${pixelRegion.y} ${pixelRegion.width}x${pixelRegion.height}`,
    regionPixels: pixelRegion,
  };
}

function offsetPixelRegion(
  region: PixelRegion,
  sourceRegion: PixelRegion,
): PixelRegion {
  return {
    x: sourceRegion.x + region.x,
    y: sourceRegion.y + region.y,
    width: region.width,
    height: region.height,
  };
}

export function getManualExperienceDisplayPreviewRegion(
  ocrPixelRegion: PixelRegion,
  videoWidth: number,
): PixelRegion {
  return {
    x: 0,
    y: ocrPixelRegion.y,
    width: Math.max(1, videoWidth),
    height: ocrPixelRegion.height,
  };
}

function createManualExperienceDisplayPreview({
  include,
  pixelRegion,
  video,
}: {
  include: boolean;
  pixelRegion: PixelRegion;
  video: HTMLVideoElement;
}): { imageData: ImageData | null; url: string | null } {
  if (!include) {
    return { imageData: null, url: null };
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, pixelRegion.width);
  canvas.height = Math.max(1, pixelRegion.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return { imageData: null, url: null };
  }

  context.imageSmoothingEnabled = false;
  context.drawImage(
    video,
    pixelRegion.x,
    pixelRegion.y,
    pixelRegion.width,
    pixelRegion.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return {
    imageData: context.getImageData(0, 0, canvas.width, canvas.height),
    url: canvas.toDataURL("image/png"),
  };
}
