import { describe, expect, it } from "vitest";
import { getRuneCandidateCnnCropBounds } from "./runeCandidateCnnCrop";

describe("runeCandidateCnnCrop", () => {
  it("centers the CNN crop on the local purple mass instead of the candidate bbox", () => {
    const imageData = createImageDataLike(200, 200);
    paintPurplePixel(imageData, 68, 84);
    paintPurplePixel(imageData, 69, 84);
    paintPurplePixel(imageData, 68, 85);

    expect(
      getRuneCandidateCnnCropBounds(imageData, {
        x: 40,
        y: 80,
        width: 30,
        height: 8,
        pixelCount: 3,
        confidence: 0.8,
      }),
    ).toEqual({
      left: 14,
      top: 30,
      size: 108,
    });
  });

  it("falls back to the candidate bbox center when no purple pixels are present", () => {
    expect(
      getRuneCandidateCnnCropBounds(createImageDataLike(30, 22), {
        x: 2,
        y: 3,
        width: 10,
        height: 8,
        pixelCount: 1,
        confidence: 0.2,
      }),
    ).toEqual({
      left: 0,
      top: 0,
      size: 22,
    });
  });
});

function createImageDataLike(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 3; index < data.length; index += 4) {
    data[index] = 255;
  }
  return { width, height, data };
}

function paintPurplePixel(imageData: ReturnType<typeof createImageDataLike>, x: number, y: number) {
  const index = (y * imageData.width + x) * 4;
  imageData.data[index] = 220;
  imageData.data[index + 1] = 80;
  imageData.data[index + 2] = 240;
  imageData.data[index + 3] = 255;
}
