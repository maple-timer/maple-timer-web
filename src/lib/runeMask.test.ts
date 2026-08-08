import { describe, expect, it } from "vitest";
import { buildPurpleMask, isRuneCorePurple, isRuneDarkOutline, isRuneOutline, isRunePurple } from "./runeMask";

function createImage(colors: Array<[number, number, number, number?]>) {
  const imageData = new ImageData(colors.length, 1);
  colors.forEach(([red, green, blue, alpha = 255], index) => {
    const target = index * 4;
    imageData.data[target] = red;
    imageData.data[target + 1] = green;
    imageData.data[target + 2] = blue;
    imageData.data[target + 3] = alpha;
  });
  return imageData;
}

describe("runeMask", () => {
  it("keeps rune-purple pixels and ignores transparent pixels", () => {
    const imageData = createImage([
      [190, 82, 255],
      [190, 82, 255, 12],
      [24, 31, 38],
    ]);

    expect([...buildPurpleMask(imageData)]).toEqual([1, 0, 0]);
  });

  it("classifies rune color layers", () => {
    expect(isRunePurple(190, 82, 255)).toBe(true);
    expect(isRuneCorePurple(190, 82, 255)).toBe(true);
    expect(isRuneOutline(206, 204, 218)).toBe(true);
    expect(isRuneDarkOutline(42, 34, 50)).toBe(true);
  });
});
