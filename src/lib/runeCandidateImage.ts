import type { RuneCandidate } from "./runeDetection";
import { imageDataToCanvas } from "./canvasImage";

export type CropBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const RUNE_CANDIDATE_PREVIEW_WIDTH = 96;
const RUNE_CANDIDATE_PREVIEW_HEIGHT = 44;
const RUNE_CANDIDATE_PREVIEW_ASPECT_RATIO =
  RUNE_CANDIDATE_PREVIEW_WIDTH / RUNE_CANDIDATE_PREVIEW_HEIGHT;
const RUNE_CANDIDATE_MIN_CONTEXT_HEIGHT = 28;
const RUNE_CANDIDATE_CONTEXT_MULTIPLIER = 3.1;

export function getRuneCandidateCropBounds(
  imageWidth: number,
  imageHeight: number,
  candidate: RuneCandidate,
): CropBounds {
  const maxDimension = Math.max(candidate.width, candidate.height);
  const targetHeight = Math.min(
    imageHeight,
    Math.max(
      RUNE_CANDIDATE_MIN_CONTEXT_HEIGHT,
      Math.ceil(maxDimension * RUNE_CANDIDATE_CONTEXT_MULTIPLIER),
    ),
  );
  const targetWidth = Math.min(
    imageWidth,
    Math.max(
      candidate.width + 8,
      Math.ceil(targetHeight * RUNE_CANDIDATE_PREVIEW_ASPECT_RATIO),
    ),
  );
  const cropWidth =
    targetWidth / Math.max(1, targetHeight) >= RUNE_CANDIDATE_PREVIEW_ASPECT_RATIO
      ? targetWidth
      : Math.min(imageWidth, Math.ceil(targetHeight * RUNE_CANDIDATE_PREVIEW_ASPECT_RATIO));
  const cropHeight = Math.min(
    imageHeight,
    Math.ceil(cropWidth / RUNE_CANDIDATE_PREVIEW_ASPECT_RATIO),
  );
  const centerX = candidate.x + candidate.width / 2;
  const centerY = candidate.y + candidate.height / 2;
  const left = clamp(Math.round(centerX - cropWidth / 2), 0, Math.max(0, imageWidth - cropWidth));
  const top = clamp(
    Math.round(centerY - cropHeight / 2),
    0,
    Math.max(0, imageHeight - cropHeight),
  );

  return {
    left,
    top,
    width: Math.max(1, cropWidth),
    height: Math.max(1, cropHeight),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function renderRuneCandidateCropCanvas(
  imageData: ImageData,
  candidate: RuneCandidate | null | undefined,
): HTMLCanvasElement | null {
  if (!candidate) {
    return null;
  }

  const { left, top, width, height } = getRuneCandidateCropBounds(
    imageData.width,
    imageData.height,
    candidate,
  );
  const outputWidth = RUNE_CANDIDATE_PREVIEW_WIDTH;
  const outputHeight = RUNE_CANDIDATE_PREVIEW_HEIGHT;
  const sourceCanvas = imageDataToCanvas(imageData);
  if (!sourceCanvas) {
    return null;
  }

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;
  const outputContext = outputCanvas.getContext("2d");
  if (!outputContext) {
    return null;
  }

  outputContext.imageSmoothingEnabled = false;
  outputContext.drawImage(
    sourceCanvas,
    left,
    top,
    width,
    height,
    0,
    0,
    outputWidth,
    outputHeight,
  );

  return outputCanvas;
}

export function cropRuneCandidateToImageData(
  imageData: ImageData,
  candidate: RuneCandidate | null | undefined,
): ImageData | null {
  const outputCanvas = renderRuneCandidateCropCanvas(imageData, candidate);
  if (!outputCanvas) {
    return null;
  }

  const outputContext = outputCanvas.getContext("2d");
  return outputContext?.getImageData(0, 0, outputCanvas.width, outputCanvas.height) ?? null;
}

export function cropRuneCandidateToUrl(
  imageData: ImageData,
  candidate: RuneCandidate | null | undefined,
): string | null {
  return renderRuneCandidateCropCanvas(imageData, candidate)?.toDataURL("image/png") ?? null;
}
