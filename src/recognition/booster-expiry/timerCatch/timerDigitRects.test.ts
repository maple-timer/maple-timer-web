import { describe, expect, it } from "vitest";
import type { ImageDataLike, PixelArray, Rect } from "./timerTypes";
import {
  findMapleTimerColumnRuns,
  findMapleTimerDigitRectsWithPredicate,
  isDigitColumnRun,
  isStrictDigitColumnRun,
  makeDigitRect,
  mergeCloseDigitRuns,
  mergeStrictDigitRuns,
  minDigitColumnRunWidth,
  shouldMergeDigitColumnRuns,
  type DigitColumnRun,
} from "./timerDigitRects";

function makeImage(width: number, height: number, activeColumns: Array<[number, number, number, number]>): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [left, right, top, bottom] of activeColumns) {
    for (let x = left; x <= right; x += 1) {
      for (let y = top; y <= bottom; y += 1) {
        data[(y * width + x) * 4] = 255;
      }
    }
  }
  return { width, height, data };
}

function activePixel(data: PixelArray, offset: number): boolean {
  return data[offset] > 0;
}

function run(partial: Partial<DigitColumnRun>): DigitColumnRun {
  return {
    left: partial.left ?? 0,
    right: partial.right ?? 0,
    top: partial.top ?? 3,
    bottom: partial.bottom ?? 31,
    count: partial.count ?? 32,
  };
}

describe("timerDigitRects", () => {
  it("builds ratio-based digit rects with inclusive bounds", () => {
    expect(
      makeDigitRect(
        { x: 10, y: 20, width: 100, height: 50 },
        { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.2, heightRatio: 0.4 },
      ),
    ).toEqual({ x: 20, y: 30, width: 21, height: 21 });
  });

  it("finds active column runs inside the scan band", () => {
    const image = makeImage(80, 40, [
      [10, 17, 4, 31],
      [30, 39, 4, 31],
      [55, 64, 4, 31],
    ]);

    expect(
      findMapleTimerColumnRuns(image, { x: 0, y: 0, width: 80, height: 40 }, activePixel),
    ).toEqual([
      { left: 10, right: 17, top: 4, bottom: 31, count: 224 },
      { left: 30, right: 39, top: 4, bottom: 31, count: 280 },
      { left: 55, right: 64, top: 4, bottom: 31, count: 280 },
    ]);
  });

  it("merges strict runs only across small gaps", () => {
    const runs = [
      run({ left: 1, right: 4, top: 4, bottom: 30, count: 80 }),
      run({ left: 7, right: 9, top: 3, bottom: 31, count: 70 }),
      run({ left: 20, right: 25, top: 5, bottom: 29, count: 90 }),
    ];

    expect(mergeStrictDigitRuns(runs, 2)).toEqual([
      { left: 1, right: 9, top: 3, bottom: 31, count: 150 },
      { left: 20, right: 25, top: 5, bottom: 29, count: 90 },
    ]);
  });

  it("merges close relaxed runs when a nearby segment is narrow", () => {
    const rect: Rect = { x: 0, y: 0, width: 80, height: 40 };
    const previous = run({ left: 10, right: 13 });
    const current = run({ left: 22, right: 32 });

    expect(minDigitColumnRunWidth(rect)).toBe(6);
    expect(shouldMergeDigitColumnRuns(previous, current, 2, 11, 6)).toBe(true);
    expect(mergeCloseDigitRuns([previous, current], rect)).toEqual([
      { left: 10, right: 32, top: 3, bottom: 31, count: 64 },
    ]);
  });

  it("classifies strict and relaxed digit runs by size and signal count", () => {
    const rect: Rect = { x: 0, y: 0, width: 80, height: 40 };

    expect(isStrictDigitColumnRun(run({ left: 10, right: 17, count: 40 }), rect)).toBe(true);
    expect(isStrictDigitColumnRun(run({ left: 10, right: 14, count: 40 }), rect)).toBe(false);
    expect(isDigitColumnRun(run({ left: 10, right: 15, count: 32 }), rect)).toBe(true);
    expect(isDigitColumnRun(run({ left: 10, right: 14, count: 32 }), rect)).toBe(false);
  });

  it("converts detected digit runs to padded frame rects", () => {
    const image = makeImage(200, 260, [
      [110, 117, 204, 231],
      [130, 139, 204, 231],
      [155, 164, 204, 231],
    ]);

    expect(
      findMapleTimerDigitRectsWithPredicate(
        image,
        { x: 100, y: 200, width: 80, height: 40 },
        activePixel,
        false,
      ),
    ).toEqual([
      { x: 104, y: 202, width: 20, height: 30 },
      { x: 124, y: 202, width: 22, height: 30 },
      { x: 149, y: 202, width: 22, height: 30 },
    ]);
  });
});
