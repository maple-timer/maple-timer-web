import { describe, expect, it } from "vitest";
import type { PixelRegion, RelativeRegion } from "../../types";
import { pixelsToRegion } from "../../lib/regions";
import {
  clampCropZoom,
  getMovedPan,
  getWheelZoom,
  isRegionInExpectedCropArea,
  isRegionInSkillQuickSlotArea,
  isRegionCenteredInQuickSlotQuadrant,
} from "./cropSelectionUtils";

function pixelRegionToRelative(
  size: { width: number; height: number },
  region: PixelRegion,
): RelativeRegion {
  return pixelsToRegion(region, size.width, size.height);
}

describe("cropSelectionUtils", () => {
  it("detects whether the crop center is in the bottom-right quickslot quadrant", () => {
    expect(
      isRegionCenteredInQuickSlotQuadrant({ x: 0.72, y: 0.78, width: 0.06, height: 0.06 }),
    ).toBe(true);
    expect(
      isRegionCenteredInQuickSlotQuadrant({ x: 0.42, y: 0.78, width: 0.06, height: 0.06 }),
    ).toBe(false);
    expect(
      isRegionCenteredInQuickSlotQuadrant({ x: 0.72, y: 0.42, width: 0.06, height: 0.06 }),
    ).toBe(false);
  });

  it("keeps skill crop warnings scoped to the lower half of the bottom-right quadrant", () => {
    const knownQuickslotRegions = [
      { size: { width: 1920, height: 1080 }, region: { x: 1640, y: 990, width: 48, height: 48 } },
      { size: { width: 2560, height: 1440 }, region: { x: 2240, y: 1320, width: 56, height: 56 } },
      { size: { width: 1922, height: 1112 }, region: { x: 1690, y: 1018, width: 44, height: 44 } },
      { size: { width: 1924, height: 1126 }, region: { x: 1700, y: 1034, width: 44, height: 44 } },
      { size: { width: 1368, height: 800 }, region: { x: 1120, y: 716, width: 40, height: 40 } },
      { size: { width: 1026, height: 800 }, region: { x: 850, y: 720, width: 38, height: 38 } },
    ];

    knownQuickslotRegions.forEach(({ size, region }) => {
      const relative = pixelRegionToRelative(size, region);
      expect(isRegionInSkillQuickSlotArea(relative)).toBe(true);
      expect(isRegionInExpectedCropArea(relative, "skill-quickslot")).toBe(true);
    });

    expect(isRegionInSkillQuickSlotArea({ x: 0.78, y: 0.58, width: 0.04, height: 0.04 })).toBe(
      false,
    );
    expect(isRegionInSkillQuickSlotArea({ x: 0.86, y: 0.1, width: 0.04, height: 0.04 })).toBe(
      false,
    );
  });

  it("clamps and applies wheel zoom consistently", () => {
    expect(clampCropZoom(0.2)).toBe(1);
    expect(clampCropZoom(9)).toBe(8);
    expect(getWheelZoom(2, -1)).toBeCloseTo(2.32);
    expect(getWheelZoom(2, 1)).toBeCloseTo(1.72);
  });

  it("moves pan by pointer delta from the captured starting point", () => {
    expect(
      getMovedPan(
        {
          startClientX: 100,
          startClientY: 80,
          startPanX: 12,
          startPanY: -4,
        },
        { clientX: 130, clientY: 70 },
      ),
    ).toEqual({ x: 42, y: -14 });
  });
});
