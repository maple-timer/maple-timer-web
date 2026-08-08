import { getBuffExpiryPrecisionDiagnosticRoi } from "../../../runtime/buff-expiry/evidence/buffExpiryDiagnosticRoi";
import type { PixelRegion } from "../../../contracts/geometry/pixelRegion";

export type BuffExpiryPrecisionVideoSample = {
  imageData: ImageData;
  roi: PixelRegion;
  rawPreviewUrl: string | null;
  fullFramePreviewUrl: string | null;
};

export type BuffExpiryPrecisionDiagnosticRoiPreview = {
  sourceSize: { width: number; height: number };
  roi: PixelRegion;
  imageDataUrl: string;
};

export function sampleBuffExpiryPrecisionVideoFrame(
  video: HTMLVideoElement,
  includePreview: boolean,
  includeFullFramePreview = false,
  sourceRegion?: PixelRegion,
): BuffExpiryPrecisionVideoSample {
  const source = sourceRegion ?? {
    x: 0,
    y: 0,
    width: video.videoWidth,
    height: video.videoHeight,
  };
  const width = source.width;
  const height = source.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("canvas-context-unavailable");
  }

  context.imageSmoothingEnabled = false;
  if (sourceRegion) {
    context.drawImage(
      video,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      width,
      height,
    );
  } else {
    context.drawImage(video, 0, 0, width, height);
  }

  return {
    imageData: context.getImageData(0, 0, width, height),
    roi: { x: 0, y: 0, width, height },
    rawPreviewUrl: includePreview ? canvas.toDataURL("image/png") : null,
    fullFramePreviewUrl: includeFullFramePreview ? createFullFramePreview(canvas) : null,
  };
}

function createFullFramePreview(source: HTMLCanvasElement): string | null {
  const maxPreviewWidth = 960;
  const scale = Math.min(1, maxPreviewWidth / Math.max(1, source.width));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  context.imageSmoothingEnabled = scale !== 1;
  context.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

export function createBuffExpiryPrecisionDiagnosticRoiPreview(
  video: HTMLVideoElement,
  quality = 0.82,
  sourceRegion?: PixelRegion,
): BuffExpiryPrecisionDiagnosticRoiPreview {
  const source = sourceRegion ?? {
    x: 0,
    y: 0,
    width: video.videoWidth,
    height: video.videoHeight,
  };
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const roi = getBuffExpiryPrecisionDiagnosticRoi(sourceWidth, sourceHeight);
  const canvas = document.createElement("canvas");
  canvas.width = roi.width;
  canvas.height = roi.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("canvas-context-unavailable");
  }
  context.imageSmoothingEnabled = false;
  context.drawImage(
    video,
    source.x + roi.x,
    source.y + roi.y,
    roi.width,
    roi.height,
    0,
    0,
    roi.width,
    roi.height,
  );
  return {
    sourceSize: { width: sourceWidth, height: sourceHeight },
    roi,
    imageDataUrl: canvas.toDataURL("image/webp", quality),
  };
}
