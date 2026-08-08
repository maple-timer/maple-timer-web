import {
  assertImageData,
  clampNumber,
  failDigit,
  failTime,
  normalizeStrictRect,
} from "./timerImage";
import { makeDigitRect } from "./timerDigitRects";
import {
  dilateBinaryMask,
  erodeBinaryMask,
} from "./timerBinaryMaskMorphology";
import {
  isMapleTimerDigitPixel,
  isMapleTimerDigitPreprocessPixel,
} from "./timerPixelClassifiers";
import {
  AREA_SEGMENT_ZONES,
  areaSegmentThreshold,
  chooseDirectAreaDigitCorrection,
  classifyAreaSevenSegmentDensityCandidates,
  countMaskBits,
  mergePreprocessedAreaDensity,
  readFuzzyAreaDigit,
  scoreSelectedAreaDigit,
} from "./timerAreaSegmentClassifier";
import {
  makeSevenSegmentSettings,
  type SevenSegmentSettings,
} from "./timerSevenSegmentSettings";
import type {
  ImageDataLike,
  Rect,
  SevenSegmentDigitResult,
  SevenSegmentOptions,
  TimeReadResult,
} from "./timerTypes";

type BinaryMask = {
  width: number;
  height: number;
  data: Uint8Array;
};

export function readAreaSevenSegmentDigits(
  imageData: ImageDataLike,
  rect: Rect | readonly [number, number, number, number],
  options: SevenSegmentOptions = {},
): TimeReadResult {
  assertImageData(imageData);
  const settings = makeSevenSegmentSettings(options);
  const sourceRect = normalizeStrictRect(
    rect,
    imageData.width,
    imageData.height,
  );
  if (!sourceRect) return failTime("invalid-rect", null, [], []);

  const digits: number[] = [];
  const digitResults: SevenSegmentDigitResult[] = [];
  for (let index = 0; index < settings.digitRatios.length; index += 1) {
    const digitRect = makeDigitRect(sourceRect, settings.digitRatios[index]);
    const digitResult = {
      ...readAreaSevenSegmentDigit(imageData, digitRect, settings),
      index,
      rect: digitRect,
    };
    digitResults.push(digitResult);

    if (!digitResult.ok)
      return failTime(digitResult.reason, sourceRect, digits, digitResults);
    if (!hasDigitForMask(settings.maskToDigit, digitResult.mask))
      return failTime("unknown-digit-mask", sourceRect, digits, digitResults);
    digits.push(settings.maskToDigit[digitResult.mask]);
  }

  return {
    ok: true,
    reason: "ok",
    rect: sourceRect,
    digits,
    digitResults,
    seconds: null,
    text: null,
  };
}

export function readAreaSevenSegmentDigit(
  imageData: ImageDataLike,
  rect: Rect | readonly [number, number, number, number],
  options: SevenSegmentOptions = {},
): SevenSegmentDigitResult {
  const settings = makeSevenSegmentSettings(options);
  const digitRect = normalizeStrictRect(
    rect,
    imageData.width,
    imageData.height,
  );
  if (!digitRect) return failDigit("invalid-digit-rect", null);

  const binaryMask = settings.areaPreprocess
    ? makeMapleTimerDigitBinaryMask(imageData, digitRect, settings)
    : null;
  const densities: number[] = [];
  let mask = 0;
  for (const zone of AREA_SEGMENT_ZONES) {
    const rawDensity = readAreaSegmentDensity(imageData, digitRect, zone);
    const density = binaryMask
      ? mergePreprocessedAreaDensity(
          rawDensity,
          readBinaryAreaSegmentDensity(binaryMask, zone),
          zone.bit,
        )
      : rawDensity;
    densities.push(density);
    const threshold = areaSegmentThreshold(zone.bit);
    if (density >= threshold) mask |= 1 << zone.bit;
  }

  const rawMask = mask;
  const scoredCandidates = classifyAreaSevenSegmentDensityCandidates(densities);
  let selectedBy = "direct";

  if (hasDigitForMask(settings.maskToDigit, mask)) {
    const correction = settings.correctWeakDirectAreaDigit
      ? chooseDirectAreaDigitCorrection(
          densities,
          mask,
          scoredCandidates,
          settings,
        )
      : null;
    if (correction) {
      mask = correction.mask;
      selectedBy = "direct-corrected";
    }
  } else {
    const fuzzy =
      countMaskBits(mask) >= settings.minFuzzyOnSegments
        ? readFuzzyAreaDigit(densities, mask, settings, scoredCandidates)
        : null;
    if (fuzzy) {
      mask = fuzzy.mask;
      selectedBy = "fuzzy";
    }
  }

  const confidence = scoreSelectedAreaDigit(
    densities,
    mask,
    scoredCandidates,
    settings.maskToDigit,
  );

  return {
    ok: true,
    reason: "ok",
    mask,
    rawMask,
    rawDigit: hasDigitForMask(settings.maskToDigit, rawMask)
      ? settings.maskToDigit[rawMask]
      : null,
    digit: hasDigitForMask(settings.maskToDigit, mask)
      ? settings.maskToDigit[mask]
      : null,
    score: confidence.score,
    scoreMargin: confidence.margin,
    confidence: confidence.value,
    selectedBy,
    densities,
    candidates: scoredCandidates.slice(0, 4),
  };
}

function readAreaSegmentDensity(
  imageData: ImageDataLike,
  rect: Rect,
  zone: (typeof AREA_SEGMENT_ZONES)[number],
): number {
  const left = clampNumber(
    Math.round(rect.x + rect.width * zone.x1),
    rect.x,
    rect.x + rect.width - 1,
  );
  const top = clampNumber(
    Math.round(rect.y + rect.height * zone.y1),
    rect.y,
    rect.y + rect.height - 1,
  );
  const right = clampNumber(
    Math.round(rect.x + rect.width * zone.x2),
    left + 1,
    rect.x + rect.width,
  );
  const bottom = clampNumber(
    Math.round(rect.y + rect.height * zone.y2),
    top + 1,
    rect.y + rect.height,
  );
  let brightCount = 0;
  let total = 0;

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * imageData.width + x) * 4;
      if (isMapleTimerDigitPixel(imageData.data, offset)) brightCount += 1;
      total += 1;
    }
  }

  return total > 0 ? brightCount / total : 0;
}

function readBinaryAreaSegmentDensity(
  binaryMask: BinaryMask,
  zone: (typeof AREA_SEGMENT_ZONES)[number],
): number {
  const left = clampNumber(
    Math.round(binaryMask.width * zone.x1),
    0,
    binaryMask.width - 1,
  );
  const top = clampNumber(
    Math.round(binaryMask.height * zone.y1),
    0,
    binaryMask.height - 1,
  );
  const right = clampNumber(
    Math.round(binaryMask.width * zone.x2),
    left + 1,
    binaryMask.width,
  );
  const bottom = clampNumber(
    Math.round(binaryMask.height * zone.y2),
    top + 1,
    binaryMask.height,
  );
  let brightCount = 0;
  let total = 0;

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (binaryMask.data[y * binaryMask.width + x]) brightCount += 1;
      total += 1;
    }
  }

  return total > 0 ? brightCount / total : 0;
}

function makeMapleTimerDigitBinaryMask(
  imageData: ImageDataLike,
  rect: Rect,
  settings: SevenSegmentSettings,
): BinaryMask {
  const width = rect.width;
  const height = rect.height;
  let data: Uint8Array = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = ((rect.y + y) * imageData.width + rect.x + x) * 4;
      if (isMapleTimerDigitPreprocessPixel(imageData.data, sourceOffset)) {
        data[y * width + x] = 1;
      }
    }
  }

  if (settings.areaPreprocessClosing) {
    data = erodeBinaryMask(
      dilateBinaryMask(data, width, height),
      width,
      height,
    );
  }
  for (let index = 0; index < settings.areaPreprocessDilation; index += 1) {
    data = dilateBinaryMask(data, width, height);
  }

  return { width, height, data };
}

export function hasDigitForMask(
  maskToDigit: Readonly<Record<number, number>>,
  mask: number | null,
): mask is number {
  return (
    mask !== null && Object.prototype.hasOwnProperty.call(maskToDigit, mask)
  );
}
