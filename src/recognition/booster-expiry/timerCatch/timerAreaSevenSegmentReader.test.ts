import { describe, expect, it } from "vitest";
import { AREA_SEGMENT_ZONES } from "./timerAreaSegmentClassifier";
import {
  hasDigitForMask,
  readAreaSevenSegmentDigit,
  readAreaSevenSegmentDigits,
} from "./timerAreaSevenSegmentReader";
import {
  SEVEN_SEGMENT_DIGIT_TO_MASK,
  SEVEN_SEGMENT_MASK_TO_DIGIT,
} from "./timerTypes";
import type { ImageDataLike, Rect } from "./timerTypes";

const digitRect: Rect = { x: 0, y: 0, width: 20, height: 28 };

describe("timer area seven-segment reader", () => {
  it("rejects invalid digit rects", () => {
    expect(
      readAreaSevenSegmentDigit(makeImage(), [0, 0, -1, 10]),
    ).toMatchObject({
      ok: false,
      reason: "invalid-digit-rect",
      digit: null,
      mask: null,
    });
  });

  it("reads a direct area segment digit", () => {
    const imageData = makeDigitImage(SEVEN_SEGMENT_DIGIT_TO_MASK[1]);

    expect(readAreaSevenSegmentDigit(imageData, digitRect)).toMatchObject({
      ok: true,
      rawMask: SEVEN_SEGMENT_DIGIT_TO_MASK[1],
      mask: SEVEN_SEGMENT_DIGIT_TO_MASK[1],
      rawDigit: 1,
      digit: 1,
      selectedBy: "direct",
    });
  });

  it("reads digit ratios through the multi-digit area path", () => {
    const imageData = makeDigitImage(SEVEN_SEGMENT_DIGIT_TO_MASK[1]);

    expect(
      readAreaSevenSegmentDigits(imageData, digitRect, {
        digitRatios: [{ xRatio: 0, yRatio: 0, widthRatio: 0.95, heightRatio: 0.96 }],
      }),
    ).toMatchObject({
      ok: true,
      digits: [1],
      digitResults: [{ index: 0, digit: 1 }],
      rect: digitRect,
    });
  });

  it("uses fuzzy fallback when raw segments are close but not a known digit", () => {
    const imageData = makeDigitImage(SEVEN_SEGMENT_DIGIT_TO_MASK[8] & ~(1 << 0));

    expect(
      readAreaSevenSegmentDigit(imageData, digitRect, {
        allowFuzzyCandidateFallback: true,
        requireFuzzyHorizontalSignal: false,
        minFuzzyOnSegments: 1,
      }),
    ).toMatchObject({
      ok: true,
      rawDigit: null,
      digit: 8,
      selectedBy: "fuzzy",
    });
  });

  it("can merge binary-preprocessed segment density into a weak raw signal", () => {
    const imageData = makeWeakPreprocessedDigitImage(SEVEN_SEGMENT_DIGIT_TO_MASK[1]);

    expect(
      readAreaSevenSegmentDigit(imageData, digitRect, {
        minFuzzyOnSegments: 1,
      }),
    ).toMatchObject({
      digit: null,
      mask: 0,
    });
    expect(
      readAreaSevenSegmentDigit(imageData, digitRect, {
        areaPreprocess: true,
        areaPreprocessClosing: false,
      }),
    ).toMatchObject({
      digit: 1,
      mask: SEVEN_SEGMENT_DIGIT_TO_MASK[1],
    });
  });

  it("checks masks against the configured digit map", () => {
    expect(hasDigitForMask(SEVEN_SEGMENT_MASK_TO_DIGIT, null)).toBe(false);
    expect(hasDigitForMask(SEVEN_SEGMENT_MASK_TO_DIGIT, 0)).toBe(false);
    expect(hasDigitForMask(SEVEN_SEGMENT_MASK_TO_DIGIT, SEVEN_SEGMENT_DIGIT_TO_MASK[1]))
      .toBe(true);
  });
});

function makeImage(): ImageDataLike {
  return {
    width: digitRect.width,
    height: digitRect.height,
    data: new Uint8ClampedArray(digitRect.width * digitRect.height * 4),
  };
}

function makeDigitImage(mask: number): ImageDataLike {
  const imageData = makeImage();
  for (const zone of AREA_SEGMENT_ZONES) {
    if (mask & (1 << zone.bit)) paintZone(imageData, zone.bit, [255, 255, 255]);
  }
  return imageData;
}

function makeWeakPreprocessedDigitImage(mask: number): ImageDataLike {
  const imageData = makeImage();
  for (const zone of AREA_SEGMENT_ZONES) {
    if (!(mask & (1 << zone.bit))) continue;
    const painted = paintZone(imageData, zone.bit, [100, 80, 20]);
    for (let index = 0; index < Math.ceil(painted.length * 0.1); index += 1) {
      const [x, y] = painted[index];
      paintPixel(imageData, x, y, [255, 255, 255]);
    }
  }
  return imageData;
}

function paintZone(
  imageData: ImageDataLike,
  bit: number,
  rgb: readonly [number, number, number],
): Array<[number, number]> {
  const zone = AREA_SEGMENT_ZONES.find((candidate) => candidate.bit === bit);
  if (!zone) return [];

  const left = clamp(
    Math.round(digitRect.x + digitRect.width * zone.x1),
    digitRect.x,
    digitRect.x + digitRect.width - 1,
  );
  const top = clamp(
    Math.round(digitRect.y + digitRect.height * zone.y1),
    digitRect.y,
    digitRect.y + digitRect.height - 1,
  );
  const right = clamp(
    Math.round(digitRect.x + digitRect.width * zone.x2),
    left + 1,
    digitRect.x + digitRect.width,
  );
  const bottom = clamp(
    Math.round(digitRect.y + digitRect.height * zone.y2),
    top + 1,
    digitRect.y + digitRect.height,
  );

  const painted: Array<[number, number]> = [];
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      paintPixel(imageData, x, y, rgb);
      painted.push([x, y]);
    }
  }
  return painted;
}

function paintPixel(
  imageData: ImageDataLike,
  x: number,
  y: number,
  [red, green, blue]: readonly [number, number, number],
): void {
  const offset = (y * imageData.width + x) * 4;
  imageData.data[offset] = red;
  imageData.data[offset + 1] = green;
  imageData.data[offset + 2] = blue;
  imageData.data[offset + 3] = 255;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
