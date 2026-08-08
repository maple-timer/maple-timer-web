import { describe, expect, it } from "vitest";
import {
  findClosestKnownGameResolution,
  getGameResolutionLabel,
  getLikelyGameViewportCrop,
} from "./gameResolutions";

describe("gameResolutions", () => {
  it("labels known game resolutions from captured window sizes", () => {
    expect(getGameResolutionLabel(null)).toBe("캡처 대기");
    expect(getGameResolutionLabel({ width: 1922, height: 1112 })).toBe("1920 x 1080");
    expect(getGameResolutionLabel({ width: 1200, height: 900 })).toBe("1200 x 900");
  });

  it("finds the closest known game resolution within a bounded window chrome delta", () => {
    expect(findClosestKnownGameResolution({ width: 1368, height: 806 })).toEqual({
      width: 1366,
      height: 768,
    });
    expect(findClosestKnownGameResolution({ width: 1400, height: 806 })).toBeNull();
  });

  it("estimates a top-biased viewport crop for game windows with title bars", () => {
    expect(getLikelyGameViewportCrop({ width: 1922, height: 1112 })).toEqual({
      source: { width: 1922, height: 1112 },
      game: { width: 1920, height: 1080 },
      x: 1,
      y: 32,
      width: 1920,
      height: 1080,
      isCropped: true,
    });
  });

  it("keeps exact game captures uncropped", () => {
    expect(getLikelyGameViewportCrop({ width: 2560, height: 1440 })).toEqual({
      source: { width: 2560, height: 1440 },
      game: { width: 2560, height: 1440 },
      x: 0,
      y: 0,
      width: 2560,
      height: 1440,
      isCropped: false,
    });
  });
});
