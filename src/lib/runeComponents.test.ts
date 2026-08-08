import { describe, expect, it } from "vitest";
import { collectPurpleComponents } from "./runeComponents";

describe("runeComponents", () => {
  it("collects separated four-way connected components", () => {
    const width = 6;
    const height = 4;
    const mask = new Uint8Array(width * height);
    mask[1] = 1;
    mask[2] = 1;
    mask[7] = 1;
    mask[22] = 1;

    const result = collectPurpleComponents(mask, width, height);

    expect(result.purplePixels).toBe(4);
    expect(result.componentCount).toBe(2);
    expect(result.components[0]).toMatchObject({
      minX: 1,
      minY: 0,
      maxX: 2,
      maxY: 1,
      pixelCount: 3,
    });
    expect(result.components[0].rows.get(0)).toEqual({ minX: 1, maxX: 2, count: 2 });
  });
});
