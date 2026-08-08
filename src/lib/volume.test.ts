import { afterEach, describe, expect, it } from "vitest";
import {
  acknowledgeVolumeBoostWarning,
  applyMasterVolume,
  clampMasterVolume,
  getMasterVolumePercentLabel,
  resetVolumeBoostWarningForTests,
  shouldWarnForBoostedVolume,
} from "./volume";

describe("master volume", () => {
  it("keeps master volume in the normal 0 to 100 percent range", () => {
    expect(clampMasterVolume(0.45)).toBe(0.45);
    expect(clampMasterVolume(2)).toBe(1);
    expect(clampMasterVolume(-1)).toBe(0);
    expect(clampMasterVolume(Number.NaN)).toBe(1);
  });

  it("applies master volume without changing the individual boosted-volume range", () => {
    expect(applyMasterVolume(0.8, 0.5)).toBe(0.4);
    expect(applyMasterVolume(2, 0.5)).toBe(1);
    expect(applyMasterVolume(2, 1)).toBe(2);
    expect(getMasterVolumePercentLabel(0.65)).toBe("65%");
  });
});

describe("volume boost warning", () => {
  afterEach(() => {
    resetVolumeBoostWarningForTests();
  });

  it("keeps the boosted-volume warning scoped to each alert target", () => {
    acknowledgeVolumeBoostWarning("skill:one");

    expect(shouldWarnForBoostedVolume(1.5, "skill:one")).toBe(false);
    expect(shouldWarnForBoostedVolume(1.5, "skill:two")).toBe(true);
    expect(shouldWarnForBoostedVolume(1.5, "rune")).toBe(true);
    expect(shouldWarnForBoostedVolume(1.5, "hunt-stall")).toBe(true);
  });
});
