import { describe, expect, it } from "vitest";
import { getExperienceTextRegion } from "./experienceOcrRegionSampling";

describe("experienceOcrRegionSampling", () => {
  it("returns a bottom-center experience text region", () => {
    const region = getExperienceTextRegion(1920, 1080);

    expect(region.x).toBeGreaterThanOrEqual(0.35);
    expect(region.x + region.width).toBeLessThanOrEqual(0.65);
    expect(region.y).toBeGreaterThan(0.98);
  });
});
