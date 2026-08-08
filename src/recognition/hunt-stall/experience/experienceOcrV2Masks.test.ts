import { describe, expect, it } from "vitest";
import {
  createExperienceOcrV2MaskSources,
  findExperienceOcrV2RowBands,
  makeExperienceOcrV2Mask,
  maskToExperienceOcrV2ImageData,
} from "./experienceOcrV2Masks";

function makeImage(width: number, height: number, pixels: Array<[number, number, [number, number, number]]>) {
  const imageData = new ImageData(width, height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    imageData.data[index] = 20;
    imageData.data[index + 1] = 24;
    imageData.data[index + 2] = 28;
    imageData.data[index + 3] = 255;
  }

  for (const [x, y, [red, green, blue]] of pixels) {
    const offset = (y * width + x) * 4;
    imageData.data[offset] = red;
    imageData.data[offset + 1] = green;
    imageData.data[offset + 2] = blue;
    imageData.data[offset + 3] = 255;
  }

  return imageData;
}

describe("experienceOcrV2Masks", () => {
  it("keeps neutral light text pixels and rejects saturated pixels in neutral mode", () => {
    const imageData = makeImage(3, 1, [
      [0, 0, [230, 230, 230]],
      [1, 0, [210, 70, 40]],
      [2, 0, [100, 100, 100]],
    ]);

    expect(Array.from(makeExperienceOcrV2Mask(imageData, "neutral"))).toEqual([1, 0, 0]);
    expect(Array.from(makeExperienceOcrV2Mask(imageData, "loose"))).toEqual([1, 0, 0]);
  });

  it("creates row bands from active mask rows", () => {
    const width = 4;
    const height = 6;
    const mask = new Uint8Array(width * height);
    for (const y of [1, 2, 4, 5]) {
      for (const x of [1, 2]) {
        mask[y * width + x] = 1;
      }
    }

    expect(findExperienceOcrV2RowBands(mask, width, height, 0.2)).toEqual([
      { startY: 1, endY: 3, sum: 4 },
      { startY: 4, endY: 6, sum: 4 },
    ]);
  });

  it("converts binary masks to black and white ImageData", () => {
    const imageData = maskToExperienceOcrV2ImageData(new Uint8Array([1, 0]), 2, 1);

    expect(Array.from(imageData.data)).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
  });

  it("returns the base OCR mask sources in stable order", () => {
    const sources = createExperienceOcrV2MaskSources(makeImage(2, 2, []));

    expect(sources.map((source) => source.mode).slice(0, 9)).toEqual([
      "neutral",
      "loose",
      "local_dark",
      "contrast",
      "bright",
      "colored_dark60",
      "colored_dark70",
      "colored_dark80",
      "colored_dark90",
    ]);
    expect(sources.every((source) => source.width === 2 && source.height === 2 && source.mask.length === 4)).toBe(true);
  });
});
