import { describe, expect, it } from "vitest";
import {
  buildRegionPatchForLayout,
  captureSizeToLayoutKey,
  getSkillRegionForLayout,
  hasUsableRegion,
  normalizeRegion,
  pixelsToRegion,
  regionToPixels,
} from "./regions";

describe("regions", () => {
  it("normalizes reversed drag coordinates", () => {
    const normalized = normalizeRegion({ x: 0.8, y: 0.7, width: -0.3, height: -0.2 });
    expect(normalized.x).toBeCloseTo(0.5);
    expect(normalized.y).toBeCloseTo(0.5);
    expect(normalized.width).toBeCloseTo(0.3);
    expect(normalized.height).toBeCloseTo(0.2);
  });

  it("converts relative regions to source pixels", () => {
    expect(regionToPixels({ x: 0.25, y: 0.5, width: 0.125, height: 0.25 }, 1920, 1080)).toEqual({
      x: 480,
      y: 540,
      width: 240,
      height: 270,
    });
  });

  it("round trips pixel regions through relative coordinates", () => {
    const relative = pixelsToRegion({ x: 100, y: 50, width: 300, height: 120 }, 1000, 600);
    expect(regionToPixels(relative, 1000, 600)).toEqual({
      x: 100,
      y: 50,
      width: 300,
      height: 120,
    });
  });

  it("rejects unusably small regions", () => {
    expect(hasUsableRegion(null)).toBe(false);
    expect(hasUsableRegion({ x: 0.1, y: 0.1, width: 0.001, height: 0.1 })).toBe(false);
    expect(hasUsableRegion({ x: 0.1, y: 0.1, width: 0.05, height: 0.04 })).toBe(true);
  });

  it("builds stable layout keys from capture dimensions", () => {
    expect(captureSizeToLayoutKey({ width: 1920, height: 1080 })).toBe("1920x1080");
    expect(captureSizeToLayoutKey(null)).toBeNull();
  });

  it("prefers the current resolution region and hides other resolution regions", () => {
    const legacy = { x: 0.1, y: 0.1, width: 0.04, height: 0.04 };
    const current = { x: 0.2, y: 0.2, width: 0.05, height: 0.05 };
    const skill = {
      region: legacy,
      regionsByLayout: {
        "1920x1080": current,
      },
    };

    expect(getSkillRegionForLayout(skill, "1920x1080")).toEqual(current);
    expect(getSkillRegionForLayout(skill, "2560x1440")).toBeNull();
    expect(getSkillRegionForLayout({ region: legacy, regionsByLayout: {} }, "2560x1440")).toEqual(
      legacy,
    );
  });

  it("stores a selected region under the current resolution key", () => {
    const region = { x: 0.2, y: 0.3, width: 0.04, height: 0.04 };
    const patch = buildRegionPatchForLayout({ regionsByLayout: {} }, "1920x1080", region);

    expect(patch.region?.x).toBeCloseTo(region.x);
    expect(patch.region?.y).toBeCloseTo(region.y);
    expect(patch.region?.width).toBeCloseTo(region.width);
    expect(patch.region?.height).toBeCloseTo(region.height);
    expect(patch.regionsByLayout?.["1920x1080"].width).toBeCloseTo(region.width);
  });
});
