import { describe, expect, it } from "vitest";
import {
  makeMapleTimerPanelGeometryVariants,
  makeTimerCandidateVariants,
  mergeRectCandidates,
} from "./timerRectCandidateVariants";
import type { ImageDataLike, Rect } from "./timerTypes";

describe("timer rect candidate variants", () => {
  it("merges duplicate candidates while preserving first occurrence order", () => {
    const first = { x: 10, y: 20, width: 30, height: 40 };
    const second = { x: 10, y: 21, width: 30, height: 40 };

    expect(mergeRectCandidates([first, first, second, first])).toEqual([
      first,
      second,
    ]);
  });

  it("normalizes variants to the frame and removes duplicates", () => {
    const imageData = makeImage(100, 80);

    expect(
      makeTimerCandidateVariants(
        [
          { x: -5, y: -4, width: 30, height: 20 },
          { x: 0, y: 0, width: 25, height: 16 },
          { x: 200, y: 10, width: 20, height: 20 },
        ],
        imageData,
        { maxCandidates: 4 },
      ),
    ).toEqual([
      { x: 0, y: 0, width: 25, height: 16 },
      { x: 99, y: 10, width: 1, height: 20 },
    ]);
  });

  it("creates nearby geometry variants for wide Maple timer panels", () => {
    const rect = { x: 40, y: 12, width: 176, height: 40 };

    const variants = makeMapleTimerPanelGeometryVariants(rect);

    expect(variants).toContainEqual({ x: 36, y: 8, width: 172, height: 36 });
    expect(variants).toContainEqual({ x: 44, y: 14, width: 178, height: 42 });
    expect(variants).not.toContainEqual(rect);
  });

  it("expands narrow fragments toward full Maple timer panel widths", () => {
    const rect = { x: 120, y: 40, width: 80, height: 32 };

    const variants = makeMapleTimerPanelGeometryVariants(rect);

    expect(variants.some((variant) => variant.width > rect.width)).toBe(true);
    expect(variants.some((variant) => variant.x < rect.x)).toBe(true);
    expect(variants.every((variant) => variant.width >= rect.width)).toBe(true);
  });
});

function makeImage(width: number, height: number): ImageDataLike {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}
