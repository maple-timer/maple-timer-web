import { describe, expect, it } from "vitest";
import {
  COOLDOWN_VISUAL_ACTIVITY_THRESHOLD,
  createHuntStallCooldownVisualActivity,
  getHuntStallCooldownVisualChangeScore,
  isHuntStallCooldownVisualActivity,
} from "./huntStallCooldownActivity";

describe("huntStallCooldownActivity", () => {
  it("creates the existing 16 by 16 fingerprint and foreground evidence", () => {
    const black = createHuntStallCooldownVisualActivity(createSolidImageData(0));
    const white = createHuntStallCooldownVisualActivity(createSolidImageData(255));

    expect(black).toEqual({
      fingerprint: "0".repeat(256),
      gridColumns: 16,
      gridRows: 16,
      foregroundRatio: 0,
    });
    expect(white).toEqual({
      fingerprint: "c".repeat(256),
      gridColumns: 16,
      gridRows: 16,
      foregroundRatio: 1,
    });
  });

  it("returns a weighted visual change score without owning temporal state", () => {
    const current = createHuntStallCooldownVisualActivity(createSolidImageData(255));

    expect(getHuntStallCooldownVisualChangeScore(null, current)).toBeNull();
    expect(
      getHuntStallCooldownVisualChangeScore("0".repeat(256), current),
    ).toBeCloseTo(0.8, 8);
  });

  it("keeps the current activity threshold contract", () => {
    expect(isHuntStallCooldownVisualActivity(COOLDOWN_VISUAL_ACTIVITY_THRESHOLD)).toBe(true);
    expect(
      isHuntStallCooldownVisualActivity(COOLDOWN_VISUAL_ACTIVITY_THRESHOLD - 0.0001),
    ).toBe(false);
    expect(isHuntStallCooldownVisualActivity(null)).toBe(false);
  });
});

function createSolidImageData(channel: number): ImageData {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = channel;
    data[index + 1] = channel;
    data[index + 2] = channel;
    data[index + 3] = 255;
  }
  return new ImageData(data, 16, 16);
}
