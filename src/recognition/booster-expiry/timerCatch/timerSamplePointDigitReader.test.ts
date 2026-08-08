import { describe, expect, it } from "vitest";
import { readSevenSegmentDigit } from "./timerSamplePointDigitReader";
import {
  SEVEN_SEGMENT_DIGIT_TO_MASK,
  type ImageDataLike,
  type PixelArray,
} from "./timerTypes";

const SAMPLE_X_RATIOS = [0.2, 0.5, 0.8] as const;
const SAMPLE_Y_RATIOS = [0.12, 0.31, 0.5, 0.69, 0.88] as const;
const SEGMENT_SAMPLE_POINTS = [
  { row: 0, col: 1, bit: 0 },
  { row: 1, col: 0, bit: 1 },
  { row: 1, col: 2, bit: 2 },
  { row: 2, col: 1, bit: 3 },
  { row: 3, col: 0, bit: 4 },
  { row: 3, col: 2, bit: 5 },
  { row: 4, col: 1, bit: 6 },
] as const;

function makeImage(width = 10, height = 10): ImageDataLike {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}

function setPixel(
  imageData: ImageDataLike,
  x: number,
  y: number,
  [red, green, blue]: readonly [number, number, number],
) {
  const offset = (y * imageData.width + x) * 4;
  const data = imageData.data as PixelArray;
  data[offset] = red;
  data[offset + 1] = green;
  data[offset + 2] = blue;
  data[offset + 3] = 255;
}

function setSamplePoint(
  imageData: ImageDataLike,
  row: number,
  col: number,
  color: readonly [number, number, number] = [255, 255, 255],
) {
  setPixel(
    imageData,
    Math.floor(imageData.width * SAMPLE_X_RATIOS[col]),
    Math.floor(imageData.height * SAMPLE_Y_RATIOS[row]),
    color,
  );
}

function drawDigitMask(
  mask: number,
  color: readonly [number, number, number] = [255, 255, 255],
): ImageDataLike {
  const imageData = makeImage();
  for (const point of SEGMENT_SAMPLE_POINTS) {
    if (mask & (1 << point.bit)) {
      setSamplePoint(imageData, point.row, point.col, color);
    }
  }
  return imageData;
}

describe("timer sample-point digit reader", () => {
  it("reads a seven-segment mask from configured sample points", () => {
    const imageData = drawDigitMask(SEVEN_SEGMENT_DIGIT_TO_MASK[2]);

    expect(
      readSevenSegmentDigit(imageData, {
        x: 0,
        y: 0,
        width: imageData.width,
        height: imageData.height,
      }),
    ).toMatchObject({
      ok: true,
      reason: "ok",
      mask: SEVEN_SEGMENT_DIGIT_TO_MASK[2],
      digit: 2,
    });
  });

  it("rejects invalid digit rectangles before sampling pixels", () => {
    const imageData = drawDigitMask(SEVEN_SEGMENT_DIGIT_TO_MASK[1]);

    expect(
      readSevenSegmentDigit(imageData, {
        x: imageData.width,
        y: imageData.height,
        width: 4,
        height: 4,
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid-digit-rect",
      mask: null,
      digit: null,
    });
  });

  it("rejects bright border pixels unless border rejection is disabled", () => {
    const imageData = makeImage();
    setPixel(imageData, 0, 0, [255, 255, 255]);

    expect(
      readSevenSegmentDigit(imageData, {
        x: 0,
        y: 0,
        width: imageData.width,
        height: imageData.height,
      }),
    ).toMatchObject({
      ok: false,
      reason: "bright-border",
    });

    expect(
      readSevenSegmentDigit(
        imageData,
        {
          x: 0,
          y: 0,
          width: imageData.width,
          height: imageData.height,
        },
        { rejectBrightBorder: false },
      ),
    ).toMatchObject({
      ok: true,
      reason: "ok",
      mask: 0,
      digit: null,
    });
  });

  it("rejects bright inner hole sample points", () => {
    const imageData = drawDigitMask(SEVEN_SEGMENT_DIGIT_TO_MASK[1]);
    setSamplePoint(imageData, 1, 1);

    expect(
      readSevenSegmentDigit(imageData, {
        x: 0,
        y: 0,
        width: imageData.width,
        height: imageData.height,
      }),
    ).toMatchObject({
      ok: false,
      reason: "bright-hole",
    });
  });

  it("honors red-channel, max-channel, and luma brightness modes", () => {
    const blueDigit = drawDigitMask(SEVEN_SEGMENT_DIGIT_TO_MASK[1], [0, 0, 255]);
    const greenDigit = drawDigitMask(SEVEN_SEGMENT_DIGIT_TO_MASK[1], [0, 255, 0]);
    const rect = { x: 0, y: 0, width: 10, height: 10 };

    expect(readSevenSegmentDigit(blueDigit, rect)).toMatchObject({
      ok: true,
      mask: 0,
      digit: null,
    });
    expect(
      readSevenSegmentDigit(blueDigit, rect, { brightnessMode: "max-channel" }),
    ).toMatchObject({
      ok: true,
      mask: SEVEN_SEGMENT_DIGIT_TO_MASK[1],
      digit: 1,
    });
    expect(
      readSevenSegmentDigit(greenDigit, rect, { brightnessMode: "luma" }),
    ).toMatchObject({
      ok: true,
      mask: SEVEN_SEGMENT_DIGIT_TO_MASK[1],
      digit: 1,
    });
  });
});
