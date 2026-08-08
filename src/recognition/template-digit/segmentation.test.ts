import { describe, expect, it } from "vitest";
import {
  countForegroundPixels,
  findForegroundComponents,
  selectTopDigitRow,
  segmentDigitBoxes,
} from "./segmentation";

function makeImage(width: number, height: number, points: Array<[number, number]>): ImageData {
  const imageData = new ImageData(width, height);
  for (const [x, y] of points) {
    const index = (y * width + x) * 4;
    imageData.data[index] = 255;
    imageData.data[index + 3] = 255;
  }
  return imageData;
}

function makeRectImage(
  width: number,
  height: number,
  rects: Array<{ x: number; y: number; width: number; height: number }>,
): ImageData {
  const points: Array<[number, number]> = [];
  rects.forEach((rect) => {
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        points.push([x, y]);
      }
    }
  });

  return makeImage(width, height, points);
}

describe("recognition segmentation", () => {
  it("counts foreground pixels from the red channel", () => {
    expect(countForegroundPixels(makeImage(3, 3, [[0, 0], [2, 2]]))).toBe(2);
  });

  it("groups connected foreground pixels into boxes", () => {
    const imageData = makeImage(6, 4, [
      [1, 1],
      [2, 1],
      [2, 2],
      [5, 3],
    ]);

    expect(findForegroundComponents(imageData)).toEqual([
      { x: 1, y: 1, width: 2, height: 2 },
      { x: 5, y: 3, width: 1, height: 1 },
    ]);
  });

  it("keeps only the top digit row when command-key fragments are lower", () => {
    expect(
      selectTopDigitRow(
        [
          { x: 0, y: 1, width: 4, height: 8 },
          { x: 6, y: 2, width: 4, height: 7 },
          { x: 11, y: 16, width: 4, height: 5 },
        ],
        24,
      ),
    ).toEqual([
      { x: 0, y: 1, width: 4, height: 8 },
      { x: 6, y: 2, width: 4, height: 7 },
    ]);
  });

  it("filters tiny components before selecting digit boxes", () => {
    const imageData = makeImage(10, 10, [
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 1],
      [2, 2],
      [2, 3],
      [8, 8],
    ]);

    expect(segmentDigitBoxes(imageData)).toEqual([{ x: 1, y: 1, width: 2, height: 3 }]);
  });

  it("keeps short cooldown digits from large square skill crops", () => {
    const imageData = makeRectImage(168, 168, [
      { x: 52, y: 64, width: 24, height: 36 },
      { x: 84, y: 60, width: 26, height: 40 },
      { x: 130, y: 142, width: 5, height: 5 },
    ]);

    expect(segmentDigitBoxes(imageData)).toEqual([
      { x: 52, y: 64, width: 24, height: 36 },
      { x: 84, y: 60, width: 26, height: 40 },
    ]);
  });
});
