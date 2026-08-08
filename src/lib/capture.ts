import type { PixelRegion } from "../contracts/geometry/pixelRegion";
import type { RelativeRegion } from "../types";
import { preprocessImageData } from "./recognition";
import { clamp, normalizeRegion, regionToPixels } from "./regions";

export function coerceRegionToSquare(
  region: RelativeRegion,
  sourceAspect: number,
): RelativeRegion {
  return coerceRegionToAspectRatio(region, sourceAspect, 1);
}

export function coerceRegionToAspectRatio(
  region: RelativeRegion,
  sourceAspect: number,
  targetAspectRatio: number,
): RelativeRegion {
  const normalized = normalizeRegion(region);
  const aspect = Math.max(0.1, sourceAspect);
  const targetAspect = Math.max(0.1, targetAspectRatio);
  const currentHeight = Math.max(
    normalized.height,
    (normalized.width * aspect) / targetAspect,
  );
  const maxHeight = Math.min(
    ((1 - normalized.x) * aspect) / targetAspect,
    1 - normalized.y,
  );
  const height = Math.max(
    0.006,
    Math.min(currentHeight, maxHeight),
  );

  return normalizeRegion({
    x: normalized.x,
    y: normalized.y,
    width: (height * targetAspect) / aspect,
    height,
  });
}

export function squareRegionFromBottomRightDrag(
  start: { x: number; y: number },
  point: { x: number; y: number },
  sourceAspect: number,
): RelativeRegion {
  return aspectRegionFromBottomRightDrag(start, point, sourceAspect, 1);
}

export function aspectRegionFromBottomRightDrag(
  start: { x: number; y: number },
  point: { x: number; y: number },
  sourceAspect: number,
  targetAspectRatio: number,
): RelativeRegion {
  const aspect = Math.max(0.1, sourceAspect);
  const targetAspect = Math.max(0.1, targetAspectRatio);
  const origin = {
    x: clamp(start.x),
    y: clamp(start.y),
  };
  const pointer = {
    x: clamp(point.x),
    y: clamp(point.y),
  };
  const widthInSourceHeight =
    (Math.max(0, pointer.x - origin.x) * aspect) / targetAspect;
  const heightInSourceHeight = Math.max(0, pointer.y - origin.y);
  const minimum = 0.006;
  const maxSizeInSourceHeight = Math.max(
    minimum,
    Math.min(((1 - origin.x) * aspect) / targetAspect, 1 - origin.y),
  );
  const sizeInSourceHeight = Math.max(
    minimum,
    Math.min(Math.max(widthInSourceHeight, heightInSourceHeight), maxSizeInSourceHeight),
  );
  const width = (sizeInSourceHeight * targetAspect) / aspect;

  return normalizeRegion({
    x: origin.x,
    y: origin.y,
    width,
    height: sizeInSourceHeight,
  });
}

export function rectangleRegionFromDrag(
  start: { x: number; y: number },
  point: { x: number; y: number },
): RelativeRegion {
  const startX = clamp(start.x);
  const startY = clamp(start.y);
  const pointX = clamp(point.x);
  const pointY = clamp(point.y);

  return normalizeRegion({
    x: Math.min(startX, pointX),
    y: Math.min(startY, pointY),
    width: Math.max(0.006, Math.abs(pointX - startX)),
    height: Math.max(0.006, Math.abs(pointY - startY)),
  });
}

export function sampleVideoRegion(
  video: HTMLVideoElement,
  region: RelativeRegion,
  includePreview: boolean,
  maxPreviewWidth = 520,
) {
  const pixelRegion = regionToPixels(
    normalizeRegion(region),
    video.videoWidth,
    video.videoHeight,
  );
  return sampleVideoPixelRegion(
    video,
    pixelRegion,
    includePreview,
    maxPreviewWidth,
  );
}

export function sampleVideoPixelRegion(
  video: HTMLVideoElement,
  pixelRegion: PixelRegion,
  includePreview: boolean,
  maxPreviewWidth = 520,
) {
  const scale = Math.min(1, maxPreviewWidth / Math.max(1, pixelRegion.width));
  const width = Math.max(8, Math.round(pixelRegion.width * scale));
  const height = Math.max(8, Math.round(pixelRegion.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("canvas-context-unavailable");
  }

  context.imageSmoothingEnabled = true;
  context.drawImage(
    video,
    pixelRegion.x,
    pixelRegion.y,
    pixelRegion.width,
    pixelRegion.height,
    0,
    0,
    width,
    height,
  );

  return {
    imageData: context.getImageData(0, 0, width, height),
    rawPreviewUrl: includePreview ? canvas.toDataURL("image/png") : null,
    region: pixelRegion,
  };
}

export type SkillRegionSample = {
  imageData: ImageData;
  rawImageData?: ImageData;
  rawPreviewUrl: string | null;
  previewUrl: string | null;
  region: PixelRegion;
};

export function sampleSkill(
  video: HTMLVideoElement,
  region: RelativeRegion,
  includePreview: boolean,
): SkillRegionSample {
  const pixelRegion = regionToPixels(
    coerceRegionToSquare(region, video.videoWidth / video.videoHeight),
    video.videoWidth,
    video.videoHeight,
  );
  return sampleSkillPixelRegion(video, pixelRegion, includePreview);
}

export function sampleSkillPixelRegion(
  video: HTMLVideoElement,
  pixelRegion: PixelRegion,
  includePreview: boolean,
): SkillRegionSample {
  const scale = Math.max(2, Math.min(5, Math.floor(180 / Math.max(1, pixelRegion.height))));
  const width = Math.max(12, Math.min(520, pixelRegion.width * scale));
  const height = Math.max(12, Math.min(180, pixelRegion.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("canvas-context-unavailable");
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
    width,
    height,
  );

  const source = context.getImageData(0, 0, width, height);
  const rawPreviewUrl = includePreview ? canvas.toDataURL("image/png") : null;
  const imageData = preprocessImageData(source);
  let previewUrl: string | null = null;

  if (includePreview) {
    context.putImageData(imageData, 0, 0);
    previewUrl = canvas.toDataURL("image/png");
  }

  return {
    imageData,
    rawImageData: source,
    rawPreviewUrl,
    previewUrl,
    region: pixelRegion,
  };
}
