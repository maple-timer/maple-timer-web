import { describe, expect, it } from "vitest";
import { makeDigitRect } from "./timerDigitRects";
import {
  readSyntheticAreaDigit,
  readSyntheticMapleMinuteSecondTime,
  syntheticVectorFromRect,
} from "./timerSyntheticTimeReader";
import {
  MAPLE_REMAINING_TIME_DIGIT_RATIOS,
  SEVEN_SEGMENT_DIGIT_TO_MASK,
  type ImageDataLike,
  type PixelArray,
  type Rect,
} from "./timerTypes";

const SYNTHETIC_TEMPLATE_SEGMENT_ZONES = Object.freeze([
  Object.freeze({ x1: 0.22, y1: 0.02, x2: 0.78, y2: 0.16, bit: 0 }),
  Object.freeze({ x1: 0.02, y1: 0.1, x2: 0.25, y2: 0.47, bit: 1 }),
  Object.freeze({ x1: 0.75, y1: 0.1, x2: 0.98, y2: 0.47, bit: 2 }),
  Object.freeze({ x1: 0.22, y1: 0.42, x2: 0.78, y2: 0.58, bit: 3 }),
  Object.freeze({ x1: 0.02, y1: 0.53, x2: 0.25, y2: 0.9, bit: 4 }),
  Object.freeze({ x1: 0.75, y1: 0.53, x2: 0.98, y2: 0.9, bit: 5 }),
  Object.freeze({ x1: 0.22, y1: 0.84, x2: 0.78, y2: 0.98, bit: 6 }),
]);

function makeImage(width = 300, height = 120): ImageDataLike {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}

function drawSyntheticDigit(imageData: ImageDataLike, rect: Rect, digit: number) {
  const data = imageData.data as PixelArray;
  const mask = SEVEN_SEGMENT_DIGIT_TO_MASK[digit];

  for (const zone of SYNTHETIC_TEMPLATE_SEGMENT_ZONES) {
    if (!(mask & (1 << zone.bit))) continue;

    const left = Math.floor(rect.x + rect.width * zone.x1);
    const right = Math.ceil(rect.x + rect.width * zone.x2);
    const top = Math.floor(rect.y + rect.height * zone.y1);
    const bottom = Math.ceil(rect.y + rect.height * zone.y2);

    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const offset = (y * imageData.width + x) * 4;
        data[offset] = 255;
        data[offset + 1] = 255;
        data[offset + 2] = 255;
        data[offset + 3] = 255;
      }
    }
  }
}

function drawSyntheticTime(digits: [number, number, number]) {
  const imageData = makeImage();
  const sourceRect = { x: 0, y: 0, width: imageData.width, height: imageData.height };

  digits.forEach((digit, index) => {
    drawSyntheticDigit(
      imageData,
      makeDigitRect(sourceRect, MAPLE_REMAINING_TIME_DIGIT_RATIOS[index]),
      digit,
    );
  });

  return { imageData, sourceRect };
}

describe("timer synthetic time reader", () => {
  it("reads Maple m:ss time through the synthetic template fallback", () => {
    const { imageData, sourceRect } = drawSyntheticTime([3, 2, 4]);

    expect(readSyntheticMapleMinuteSecondTime(imageData, sourceRect)).toMatchObject({
      ok: true,
      reason: "ok",
      digits: [3, 2, 4],
      seconds: 204,
      text: "3:24",
      format: "m:ss",
      selectedBy: "synthetic-template",
    });
  });

  it("rejects blank images as low-confidence synthetic readings", () => {
    const imageData = makeImage();

    expect(
      readSyntheticMapleMinuteSecondTime(imageData, {
        x: 0,
        y: 0,
        width: imageData.width,
        height: imageData.height,
      }),
    ).toMatchObject({
      ok: false,
      reason: "low-synthetic-template-confidence",
      digits: [],
      seconds: null,
      text: null,
    });
  });

  it("reports invalid source rects before building synthetic digit vectors", () => {
    const imageData = makeImage();

    expect(
      readSyntheticMapleMinuteSecondTime(imageData, {
        x: imageData.width,
        y: imageData.height,
        width: 4,
        height: 4,
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid-rect",
      rect: null,
    });
  });

  it("exposes individual synthetic digit confidence and vector density", () => {
    const { imageData, sourceRect } = drawSyntheticTime([3, 0, 1]);
    const digitRect = makeDigitRect(sourceRect, MAPLE_REMAINING_TIME_DIGIT_RATIOS[0]);
    const vector = syntheticVectorFromRect(imageData, digitRect);
    const digit = readSyntheticAreaDigit(imageData, digitRect);

    expect(vector.some((value) => value > 0)).toBe(true);
    expect(digit).toMatchObject({
      ok: true,
      reason: "ok",
      digit: 3,
      selectedBy: "synthetic-template",
    });
    expect(digit.score).toBeGreaterThan(0.18);
    expect(digit.scoreMargin).toBeGreaterThan(0.01);
  });
});
