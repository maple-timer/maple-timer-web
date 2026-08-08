import { describe, expect, it } from "vitest";
import {
  aspectRegionFromBottomRightDrag,
  coerceRegionToAspectRatio,
  rectangleRegionFromDrag,
  squareRegionFromBottomRightDrag,
} from "./capture";

describe("capture region helpers", () => {
  it("keeps the initial point fixed while drawing a square region", () => {
    const region = squareRegionFromBottomRightDrag(
      { x: 0.2, y: 0.3 },
      { x: 0.34, y: 0.34 },
      16 / 9,
    );

    expect(region.x).toBeCloseTo(0.2);
    expect(region.y).toBeCloseTo(0.3);
    expect(region.width * (16 / 9)).toBeCloseTo(region.height);
  });

  it("clamps the square size without moving the initial point", () => {
    const region = squareRegionFromBottomRightDrag(
      { x: 0.92, y: 0.9 },
      { x: 1, y: 1 },
      16 / 9,
    );

    expect(region.x).toBeCloseTo(0.92);
    expect(region.y).toBeCloseTo(0.9);
    expect(region.x + region.width).toBeLessThanOrEqual(1);
    expect(region.y + region.height).toBeLessThanOrEqual(1);
  });

  it("draws a free rectangle in any direction", () => {
    expect(rectangleRegionFromDrag({ x: 0.6, y: 0.4 }, { x: 0.2, y: 0.8 })).toEqual({
      x: 0.2,
      y: 0.4,
      width: 0.39999999999999997,
      height: 0.4,
    });
  });

  it("draws a region locked to a logical game aspect ratio", () => {
    const region = aspectRegionFromBottomRightDrag(
      { x: 0.1, y: 0.2 },
      { x: 0.8, y: 0.7 },
      1766 / 968,
      1366 / 768,
    );

    expect(
      (region.width * (1766 / 968)) / region.height,
    ).toBeCloseTo(1366 / 768);
    expect(region.x + region.width).toBeLessThanOrEqual(1);
    expect(region.y + region.height).toBeLessThanOrEqual(1);
  });

  it("coerces an existing region without changing its top-left anchor", () => {
    const region = coerceRegionToAspectRatio(
      { x: 0.2, y: 0.1, width: 0.5, height: 0.2 },
      16 / 9,
      4 / 3,
    );

    expect(region.x).toBeCloseTo(0.2);
    expect(region.y).toBeCloseTo(0.1);
    expect((region.width * (16 / 9)) / region.height).toBeCloseTo(4 / 3);
  });
});
