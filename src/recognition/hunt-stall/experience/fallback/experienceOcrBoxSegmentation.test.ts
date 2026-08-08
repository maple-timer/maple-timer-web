import { describe, expect, it } from "vitest";
import type { DigitBox } from "../../../template-digit/segmentation";
import {
  findExperienceBoxSplitColumn,
  mergeOverlappingExperienceBoxes,
  normalizeExperienceBoxToBitmap,
  splitWideExperienceBox,
  splitWideExperienceBoxes,
  trimExperienceBox,
} from "./experienceOcrBoxSegmentation";

function makeMaskImage(width: number, height: number, points: Array<[number, number]> = []) {
  const imageData = new ImageData(width, height);
  points.forEach(([x, y]) => {
    imageData.data[(y * width + x) * 4] = 255;
    imageData.data[(y * width + x) * 4 + 3] = 255;
  });
  return imageData;
}

function makeFilledRectPoints(
  x: number,
  y: number,
  width: number,
  height: number,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      points.push([px, py]);
    }
  }
  return points;
}

describe("experience OCR box segmentation", () => {
  it("merges overlapping and touching boxes without mutating the input", () => {
    const boxes: DigitBox[] = [
      { x: 9, y: 3, width: 3, height: 4 },
      { x: 1, y: 2, width: 5, height: 3 },
      { x: 6, y: 1, width: 4, height: 6 },
      { x: 20, y: 4, width: 2, height: 2 },
    ];
    const original = boxes.map((box) => ({ ...box }));

    expect(mergeOverlappingExperienceBoxes(boxes)).toEqual([
      { x: 1, y: 1, width: 11, height: 6 },
      { x: 20, y: 4, width: 2, height: 2 },
    ]);
    expect(boxes).toEqual(original);
  });

  it("trims a box to foreground pixels and returns null for blank boxes", () => {
    const imageData = makeMaskImage(12, 10, [
      [4, 3],
      [5, 4],
      [6, 5],
    ]);

    expect(trimExperienceBox(imageData, { x: 1, y: 1, width: 9, height: 8 })).toEqual({
      x: 4,
      y: 3,
      width: 3,
      height: 3,
    });
    expect(trimExperienceBox(imageData, { x: 0, y: 0, width: 3, height: 3 })).toBeNull();
  });

  it("finds a split column in the valley between two wide glyph clusters", () => {
    const imageData = makeMaskImage(32, 12, [
      ...makeFilledRectPoints(2, 2, 8, 8),
      ...makeFilledRectPoints(21, 2, 8, 8),
    ]);

    const splitColumn = findExperienceBoxSplitColumn(imageData, {
      x: 0,
      y: 0,
      width: 32,
      height: 12,
    });

    expect(splitColumn).not.toBeNull();
    expect(splitColumn ?? 0).toBeGreaterThanOrEqual(10);
    expect(splitColumn ?? 0).toBeLessThanOrEqual(20);
  });

  it("splits wide boxes into trimmed glyph boxes", () => {
    const imageData = makeMaskImage(32, 12, [
      ...makeFilledRectPoints(2, 2, 8, 8),
      ...makeFilledRectPoints(21, 2, 8, 8),
    ]);

    expect(
      splitWideExperienceBox(imageData, {
        x: 0,
        y: 0,
        width: 32,
        height: 12,
      }),
    ).toEqual([
      { x: 2, y: 2, width: 8, height: 8 },
      { x: 21, y: 2, width: 8, height: 8 },
    ]);
  });

  it("keeps split wide box results sorted by x", () => {
    const imageData = makeMaskImage(50, 12, [
      ...makeFilledRectPoints(2, 2, 8, 8),
      ...makeFilledRectPoints(21, 2, 8, 8),
      ...makeFilledRectPoints(42, 2, 4, 8),
    ]);

    expect(
      splitWideExperienceBoxes(imageData, [
        { x: 40, y: 0, width: 8, height: 12 },
        { x: 0, y: 0, width: 32, height: 12 },
      ]),
    ).toEqual([
      { x: 2, y: 2, width: 8, height: 8 },
      { x: 21, y: 2, width: 8, height: 8 },
      { x: 40, y: 0, width: 8, height: 12 },
    ]);
  });

  it("normalizes a box into a compact bitmap mask", () => {
    const imageData = makeMaskImage(4, 4, makeFilledRectPoints(0, 0, 2, 4));

    expect(
      normalizeExperienceBoxToBitmap(
        imageData,
        { x: 0, y: 0, width: 4, height: 4 },
        2,
        2,
      ),
    ).toEqual(["10", "10"]);
  });
});
