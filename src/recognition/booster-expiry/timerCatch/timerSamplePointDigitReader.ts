import {
  assertImageData,
  failDigit,
  normalizeStrictRect,
} from "./timerImage";
import {
  SEVEN_SEGMENT_MASK_TO_DIGIT,
  type ImageDataLike,
  type Rect,
  type SevenSegmentDigitResult,
  type SevenSegmentOptions,
} from "./timerTypes";

const DEFAULT_SAMPLE_X_RATIOS = Object.freeze([0.2, 0.5, 0.8]);
const DEFAULT_SAMPLE_Y_RATIOS = Object.freeze([0.12, 0.31, 0.5, 0.69, 0.88]);
const SEGMENT_SAMPLE_POINTS = Object.freeze([
  Object.freeze({ row: 0, col: 1, bit: 0 }),
  Object.freeze({ row: 1, col: 0, bit: 1 }),
  Object.freeze({ row: 1, col: 2, bit: 2 }),
  Object.freeze({ row: 2, col: 1, bit: 3 }),
  Object.freeze({ row: 3, col: 0, bit: 4 }),
  Object.freeze({ row: 3, col: 2, bit: 5 }),
  Object.freeze({ row: 4, col: 1, bit: 6 }),
]);
const HOLE_SAMPLE_POINTS = Object.freeze([
  Object.freeze({ row: 1, col: 1 }),
  Object.freeze({ row: 3, col: 1 }),
]);

type SamplePointDigitSettings = Required<
  Pick<SevenSegmentOptions, "brightnessMode" | "threshold" | "rejectBrightBorder">
> & {
  maskToDigit: Readonly<Record<number, number>>;
};

export function readSevenSegmentDigit(
  imageData: ImageDataLike,
  rect: Rect | readonly [number, number, number, number],
  options: SevenSegmentOptions = {},
): SevenSegmentDigitResult {
  assertImageData(imageData);
  const settings = makeSamplePointDigitSettings(options);
  const digitRect = normalizeStrictRect(
    rect,
    imageData.width,
    imageData.height,
  );
  if (!digitRect) return failDigit("invalid-digit-rect", null);

  if (settings.rejectBrightBorder) {
    const border = findBrightBorderPixel(imageData, digitRect, settings);
    if (border) return failDigit("bright-border", null);
  }

  for (const point of HOLE_SAMPLE_POINTS) {
    if (
      readSamplePoint(imageData, digitRect, point.row, point.col, settings)
        .bright
    ) {
      return failDigit("bright-hole", null);
    }
  }

  let mask = 0;
  for (const point of SEGMENT_SAMPLE_POINTS) {
    if (
      readSamplePoint(imageData, digitRect, point.row, point.col, settings)
        .bright
    ) {
      mask |= 1 << point.bit;
    }
  }

  return {
    ok: true,
    reason: "ok",
    mask,
    digit: hasDigitForMask(settings.maskToDigit, mask)
      ? settings.maskToDigit[mask]
      : null,
  };
}

function makeSamplePointDigitSettings(
  options: SevenSegmentOptions,
): SamplePointDigitSettings {
  return {
    brightnessMode: options.brightnessMode ?? "red-channel",
    threshold: options.threshold ?? 0x80,
    rejectBrightBorder: options.rejectBrightBorder ?? true,
    maskToDigit: options.maskToDigit ?? SEVEN_SEGMENT_MASK_TO_DIGIT,
  };
}

function readSamplePoint(
  imageData: ImageDataLike,
  rect: Rect,
  row: number,
  col: number,
  settings: SamplePointDigitSettings,
) {
  const x = Math.floor(rect.x + rect.width * DEFAULT_SAMPLE_X_RATIOS[col]);
  const y = Math.floor(rect.y + rect.height * DEFAULT_SAMPLE_Y_RATIOS[row]);
  const value = readPixelValue(imageData, x, y, settings.brightnessMode);
  return {
    x,
    y,
    value,
    bright: value >= settings.threshold,
  };
}

function findBrightBorderPixel(
  imageData: ImageDataLike,
  rect: Rect,
  settings: SamplePointDigitSettings,
) {
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width - 1;
  const bottom = rect.y + rect.height - 1;

  for (let x = left; x <= right; x += 1) {
    const topValue = readPixelValue(imageData, x, top, settings.brightnessMode);
    if (topValue >= settings.threshold) return true;
    const bottomValue = readPixelValue(
      imageData,
      x,
      bottom,
      settings.brightnessMode,
    );
    if (bottomValue >= settings.threshold) return true;
  }

  for (let y = top + 1; y < bottom; y += 1) {
    const leftValue = readPixelValue(
      imageData,
      left,
      y,
      settings.brightnessMode,
    );
    if (leftValue >= settings.threshold) return true;
    const rightValue = readPixelValue(
      imageData,
      right,
      y,
      settings.brightnessMode,
    );
    if (rightValue >= settings.threshold) return true;
  }

  return false;
}

function readPixelValue(
  imageData: ImageDataLike,
  x: number,
  y: number,
  mode: SamplePointDigitSettings["brightnessMode"],
): number {
  const offset = (y * imageData.width + x) * 4;
  const red = imageData.data[offset];
  if (mode === "red-channel") return red;
  const green = imageData.data[offset + 1];
  const blue = imageData.data[offset + 2];
  if (mode === "max-channel") return Math.max(red, green, blue);
  return Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
}

function hasDigitForMask(
  maskToDigit: Readonly<Record<number, number>>,
  mask: number | null,
): mask is number {
  return (
    mask !== null && Object.prototype.hasOwnProperty.call(maskToDigit, mask)
  );
}
