import { describe, expect, it } from "vitest";
import { getRuneCandidateCropBounds } from "./runeCandidateImage";

describe("runeCandidateImage", () => {
  it("builds a wide preview crop around the rune candidate and clamps to the image edges", () => {
    expect(
      getRuneCandidateCropBounds(120, 80, {
        x: 2,
        y: 3,
        width: 10,
        height: 12,
        pixelCount: 30,
        confidence: 0.8,
      }),
    ).toEqual({
      left: 0,
      top: 0,
      width: 83,
      height: 39,
    });
  });

  it("keeps the rune candidate preview crop centered when there is room", () => {
    expect(
      getRuneCandidateCropBounds(240, 120, {
        x: 100,
        y: 50,
        width: 10,
        height: 10,
        pixelCount: 30,
        confidence: 0.8,
      }),
    ).toEqual({
      left: 71,
      top: 39,
      width: 68,
      height: 32,
    });
  });

  it("keeps at least one pixel of output area", () => {
    expect(
      getRuneCandidateCropBounds(1, 1, {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        pixelCount: 1,
        confidence: 1,
      }),
    ).toEqual({
      left: 0,
      top: 0,
      width: 1,
      height: 1,
    });
  });
});
