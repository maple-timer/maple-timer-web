import type { CooldownDigitRecognitionResult } from "../../contracts/recognition/cooldownDigitRecognition";
import {
  capAmbiguousSingleDigitConfidence,
  parseCooldownDigits,
} from "../template-digit/parsing";
import { recognizeBox } from "../template-digit/matching";
import {
  countForegroundPixels,
  segmentDigitBoxes,
  type DigitBox,
} from "../template-digit/segmentation";
import { MAX_RECOGNIZED_SECONDS } from "../template-digit/templates";

export { preprocessImageData as preprocessCooldownImageData } from "../template-digit/preprocess";

export function recognizeCooldownDigits(
  imageData: ImageData,
): CooldownDigitRecognitionResult {
  const boxes = segmentDigitBoxes(imageData);
  const foregroundRatio = countForegroundPixels(imageData) / (imageData.width * imageData.height);
  const result = recognizeDigitsFromBoxes(imageData, boxes, foregroundRatio);

  if (!shouldTrySafeInsetFallback(imageData, boxes)) {
    return result;
  }

  const safeInsetImageData = maskOuterInset(imageData);
  const safeInsetBoxes = segmentDigitBoxes(safeInsetImageData);
  const safeInsetForegroundRatio =
    countForegroundPixels(safeInsetImageData) /
    (safeInsetImageData.width * safeInsetImageData.height);
  const safeInsetResult = recognizeDigitsFromBoxes(
    safeInsetImageData,
    safeInsetBoxes,
    safeInsetForegroundRatio,
  );

  if (isBetterSafeInsetResult(imageData, result, safeInsetResult, boxes, safeInsetBoxes)) {
    return {
      ...safeInsetResult,
      debug: {
        ...safeInsetResult.debug,
        reason: "safe-inset-edge-fallback",
      },
    };
  }

  return result;
}

function recognizeDigitsFromBoxes(
  imageData: ImageData,
  boxes: DigitBox[],
  foregroundRatio: number,
): CooldownDigitRecognitionResult {
  if (boxes.length === 0) {
    return {
      value: null,
      confidence: 0,
      debug: { digitCount: 0, foregroundRatio, reason: "no-foreground-components" },
    };
  }

  if (boxes.length > 4) {
    return {
      value: null,
      confidence: 0.1,
      debug: { digitCount: boxes.length, foregroundRatio, reason: "too-many-components" },
    };
  }

  const recognized = boxes.map((box) => recognizeBox(imageData, box, boxes.length));
  const minConfidence = Math.min(...recognized.map((item) => item.confidence));
  const averageConfidence =
    recognized.reduce((total, item) => total + item.confidence, 0) / recognized.length;

  if (minConfidence < 0.5) {
    return {
      value: null,
      confidence: averageConfidence,
      debug: {
        digitCount: boxes.length,
        foregroundRatio,
        recognizedText: recognized.map((item) => item.text).join(""),
        reason: "low-confidence",
      },
    };
  }

  const digitText = recognized.map((item) => item.text).join("");
  const value = parseCooldownDigits(digitText);
  const confidence = capAmbiguousSingleDigitConfidence(value, boxes.length, averageConfidence);

  if (!Number.isFinite(value) || value > MAX_RECOGNIZED_SECONDS) {
    return {
      value: null,
      confidence: 0,
      debug: {
        digitCount: boxes.length,
        foregroundRatio,
        recognizedText: digitText,
        reason: "out-of-range",
      },
    };
  }

  return {
    value,
    confidence,
    debug: { digitCount: boxes.length, foregroundRatio, recognizedText: digitText },
  };
}

function shouldTrySafeInsetFallback(imageData: ImageData, boxes: DigitBox[]): boolean {
  if (imageData.width < 80 || imageData.height < 80) {
    return false;
  }

  return (
    boxes.length > 0 &&
    boxes.every((box) => isDominantEdgeLikeComponent(box, imageData.width, imageData.height))
  );
}

function isDominantEdgeLikeComponent(box: DigitBox, imageWidth: number, imageHeight: number): boolean {
  const touchesVerticalEdge = box.x <= 1 || box.x + box.width >= imageWidth - 1;
  const touchesHorizontalEdge = box.y <= 1 || box.y + box.height >= imageHeight - 1;
  const widthRatio = box.width / Math.max(1, imageWidth);
  const heightRatio = box.height / Math.max(1, imageHeight);
  const aspectRatio = box.width / Math.max(1, box.height);

  const verticalFrameLike =
    touchesVerticalEdge && heightRatio >= 0.65 && widthRatio <= 0.16 && aspectRatio <= 0.22;
  const horizontalFrameLike =
    touchesHorizontalEdge && widthRatio >= 0.65 && heightRatio <= 0.16 && aspectRatio >= 4.5;
  const largeFrameLike =
    touchesVerticalEdge && touchesHorizontalEdge && widthRatio >= 0.75 && heightRatio >= 0.75;

  return verticalFrameLike || horizontalFrameLike || largeFrameLike;
}

function maskOuterInset(imageData: ImageData): ImageData {
  const insetX = Math.max(1, Math.round(imageData.width * 0.08));
  const insetY = Math.max(1, Math.round(imageData.height * 0.08));
  const output = {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  } as ImageData;

  for (let y = 0; y < output.height; y++) {
    for (let x = 0; x < output.width; x++) {
      if (x >= insetX && x < output.width - insetX && y >= insetY && y < output.height - insetY) {
        continue;
      }

      const index = (y * output.width + x) * 4;
      output.data[index] = 0;
      output.data[index + 1] = 0;
      output.data[index + 2] = 0;
    }
  }

  return output;
}

function isBetterSafeInsetResult(
  imageData: ImageData,
  current: CooldownDigitRecognitionResult,
  candidate: CooldownDigitRecognitionResult,
  currentBoxes: DigitBox[],
  candidateBoxes: DigitBox[],
): boolean {
  if (candidate.value === null || candidate.confidence < 0.5) {
    return false;
  }

  const currentDigitCount = current.debug?.recognizedText?.length ?? currentBoxes.length;
  const candidateDigitCount = candidate.debug?.recognizedText?.length ?? candidateBoxes.length;

  if (candidateDigitCount > currentDigitCount) {
    return true;
  }

  const currentIsOnlyEdgeNoise = currentBoxes.every((box) =>
    isDominantEdgeLikeComponent(box, imageData.width, imageData.height),
  );
  const candidateHasNonEdgeDigits = candidateBoxes.some(
    (box) => !isDominantEdgeLikeComponent(box, imageData.width, imageData.height),
  );

  return currentIsOnlyEdgeNoise && candidateHasNonEdgeDigits;
}
