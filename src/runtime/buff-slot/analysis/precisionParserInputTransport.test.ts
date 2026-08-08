import { describe, expect, it } from "vitest";
import {
  cropPrecisionParserInput,
  projectTransportAnalysisToSourcePixels,
} from "./precisionParserInputTransport";

describe("precision parser input transport", () => {
  it("crops the exact top-right parser input pixels", () => {
    const source = createTestImageData(4, 3, (x, y) => [x, y, x + y, 255]);

    const cropped = cropPrecisionParserInput(source, {
      x: 2,
      y: 0,
      width: 2,
      height: 2,
    });

    expect(cropped).toMatchObject({ width: 2, height: 2 });
    expect(Array.from(cropped.data)).toEqual([
      2, 0, 2, 255, 3, 0, 3, 255,
      2, 1, 3, 255, 3, 1, 4, 255,
    ]);
  });

  it("restores full-frame coordinates and recrops icons from source pixels", () => {
    const source = createTestImageData(6, 4, (x, y) => [x * 20, y * 30, 5, 255]);
    const projected = projectTransportAnalysisToSourcePixels({
      source,
      roi: { x: 3, y: 0, width: 3, height: 2 },
      analysis: {
        boxes: [
          {
            x: 0,
            y: 0,
            size: 2,
            confidence: 0.98,
            score: 0.97,
          },
        ],
        icons: [createTestImageData(32, 32, () => [255, 0, 0, 255])],
        engine: "dl",
        parserVersion: "test-parser",
      },
    });

    expect(projected.boxes[0]).toMatchObject({ x: 3, y: 0, size: 2 });
    expect(projected.icons[0]).toMatchObject({ width: 32, height: 32 });
    expect(Array.from(projected.icons[0].data.slice(0, 4))).toEqual([
      51, 16, 5, 255,
    ]);
  });

  it("rejects parser boxes outside the transported quadrant", () => {
    const source = createTestImageData(4, 4, () => [0, 0, 0, 255]);

    expect(() =>
      projectTransportAnalysisToSourcePixels({
        source,
        roi: { x: 2, y: 0, width: 2, height: 2 },
        analysis: {
          boxes: [
            {
              x: 2,
              y: 0,
              size: 2,
              confidence: 0.98,
              score: 0.97,
            },
          ],
          icons: [],
          engine: "dl",
          parserVersion: "test-parser",
        },
      }),
    ).toThrow("precision-parser-transport-box-invalid");
  });
});

function createTestImageData(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}
