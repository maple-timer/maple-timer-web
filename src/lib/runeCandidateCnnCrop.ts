import type { RuneCandidate } from "../recognition/rune/runeDetectionTypes";
import { isRunePurple } from "./runeMask";

export type RuneCandidateCnnCropImage = {
  width: number;
  height: number;
  data: ArrayLike<number>;
};

export type RuneCandidateCnnCropBounds = {
  left: number;
  top: number;
  size: number;
};

export type RuneCandidateCnnCropOptions = {
  offsetX?: number;
  offsetY?: number;
};

export function getRuneCandidateCnnCropBounds(
  imageData: RuneCandidateCnnCropImage,
  candidate: RuneCandidate,
  options: RuneCandidateCnnCropOptions = {},
): RuneCandidateCnnCropBounds {
  const candidateSize = Math.max(candidate.width, candidate.height);
  const baseSize = Math.max(18, Math.ceil(candidateSize * 3.6));
  const size = Math.min(baseSize, imageData.width, imageData.height);
  const focus = getRunePurpleFocusPoint(imageData, candidate);
  const centerX = focus.x + (options.offsetX ?? 0);
  const centerY = focus.y + (options.offsetY ?? 0);
  const left = Math.max(0, Math.min(imageData.width - size, Math.round(centerX - size / 2)));
  const top = Math.max(0, Math.min(imageData.height - size, Math.round(centerY - size / 2)));
  return { left, top, size };
}

function getRunePurpleFocusPoint(
  imageData: RuneCandidateCnnCropImage,
  candidate: RuneCandidate,
): { x: number; y: number } {
  const candidateSize = Math.max(candidate.width, candidate.height);
  const padding = Math.max(2, Math.ceil(candidateSize * 0.2));
  const fromX = Math.max(0, candidate.x - padding);
  const toX = Math.min(imageData.width - 1, candidate.x + candidate.width + padding - 1);
  const fromY = Math.max(0, candidate.y - padding);
  const toY = Math.min(imageData.height - 1, candidate.y + candidate.height + padding - 1);
  let weightSum = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let y = fromY; y <= toY; y += 1) {
    for (let x = fromX; x <= toX; x += 1) {
      const index = (y * imageData.width + x) * 4;
      const red = imageData.data[index] ?? 0;
      const green = imageData.data[index + 1] ?? 0;
      const blue = imageData.data[index + 2] ?? 0;
      const alpha = imageData.data[index + 3] ?? 255;
      if (alpha <= 24 || !isRunePurple(red, green, blue)) {
        continue;
      }
      const channelBias = Math.max(1, ((red + blue) / 2 - green) / 32);
      weightSum += channelBias;
      weightedX += x * channelBias;
      weightedY += y * channelBias;
    }
  }

  if (weightSum > 0) {
    return {
      x: weightedX / weightSum,
      y: weightedY / weightSum,
    };
  }

  return {
    x: candidate.x + candidate.width / 2,
    y: candidate.y + candidate.height / 2,
  };
}
