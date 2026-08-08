import { sampleVideoRegion } from "../capture";
import { imageDataToUrl } from "../imageData";
import type { Rect } from "../../recognition/booster-expiry/timerCatch/timer";
import type { RelativeRegion } from "../../types";
import { cropImageData } from "../../recognition/booster-expiry/timerCatch/timer";

export const BOOSTER_EXPIRY_CAPTURE_REGION: RelativeRegion = {
  x: 0,
  y: 0,
  width: 1,
  height: 0.25,
};

export const BOOSTER_EXPIRY_MAX_CAPTURE_WIDTH = 1280;

export function sampleBoosterExpiryVideoFrame(
  video: HTMLVideoElement,
  includePreview: boolean,
) {
  return sampleVideoRegion(
    video,
    BOOSTER_EXPIRY_CAPTURE_REGION,
    includePreview,
    BOOSTER_EXPIRY_MAX_CAPTURE_WIDTH,
  );
}

export function cloneImageData(imageData: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

export function createBoosterExpiryTimerPreviewUrl(
  imageData: ImageData,
  rect: Rect | null | undefined,
): string | null {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  try {
    const padding = Math.max(3, Math.round(rect.height * 0.16));
    const paddedRect = {
      x: Math.max(0, rect.x - padding),
      y: Math.max(0, rect.y - padding),
      width: Math.min(imageData.width - Math.max(0, rect.x - padding), rect.width + padding * 2),
      height: Math.min(imageData.height - Math.max(0, rect.y - padding), rect.height + padding * 2),
    };
    const cropped = cropImageData(imageData, paddedRect);
    return imageDataToUrl(
      new ImageData(new Uint8ClampedArray(cropped.data), cropped.width, cropped.height),
    );
  } catch {
    return null;
  }
}
