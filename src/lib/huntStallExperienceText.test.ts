import { describe, expect, it } from "vitest";
import {
  canIgnoreLowFingerprintExperienceChange,
  chooseMoreCompleteExperienceText,
  compareExperienceTotals,
  estimateExperienceTotalFromText,
  expectedExperienceMilli,
  formatExperiencePercent,
  formatExperienceValue,
  hasExperiencePercentProgress,
  hasSameExperienceValue,
  isLikelyExperienceBaselineReplacement,
  isLikelyExperienceLevelReset,
  isLikelyHuntProgressWithLag,
  isPlausibleExperienceProgress,
  parseExperienceReading,
  parseExperienceReadingForMath,
} from "./huntStallExperienceText";

describe("huntStallExperienceText", () => {
  it("parses display readings and math-friendly values", () => {
    expect(parseExperienceReading("22,256,477,898,851 [5.682%]")).toEqual({
      total: "22,256,477,898,851",
      totalDigits: "22256477898851",
      percent: "5.682",
    });
    expect(parseExperienceReading("-- [46.441%]")).toEqual({
      total: null,
      totalDigits: "",
      percent: "46.441",
    });
    expect(parseExperienceReading("22256477898851 [5.682%]")).toBeNull();
    expect(parseExperienceReadingForMath("22,256,477,898,851 [5.682%]")).toMatchObject({
      total: 22_256_477_898_851,
      totalDigits: "22256477898851",
      milliPercent: 5682,
    });
  });

  it("formats experience totals and percent values", () => {
    expect(formatExperienceValue(1_024_178_384, 46_405)).toBe("1,024,178,384 [46.405%]");
    expect(formatExperienceValue(42.4, 90)).toBe("42 [0.090%]");
    expect(formatExperiencePercent(-12)).toBe("0.000");
    expect(formatExperiencePercent(100_500)).toBe("100.000");
  });

  it("compares stable OCR variants of the same value", () => {
    expect(hasSameExperienceValue("149,655,215 [46.441%]", "349,655,215 [46.441%]")).toBe(true);
    expect(hasSameExperienceValue("149,655,215 [46.441%]", "149,655,216 [46.442%]")).toBe(false);
    expect(canIgnoreLowFingerprintExperienceChange("-- [46.441%]", "86,649,655,215 [46.441%]")).toBe(true);
    expect(chooseMoreCompleteExperienceText("-- [46.441%]", "86,649,655,215 [46.441%]")).toBe(
      "86,649,655,215 [46.441%]",
    );
  });

  it("detects plausible hunting progress and lagged progress", () => {
    expect(
      isPlausibleExperienceProgress(
        "22,256,477,898,851 [5.682%]",
        "22,256,477,899,112 [5.683%]",
      ),
    ).toBe(true);
    expect(
      isLikelyHuntProgressWithLag(
        "35,525,236,685,723 [9.669%]",
        "35,552,508,784,067 [9.076%]",
      ),
    ).toBe(true);
    expect(hasExperiencePercentProgress("22,256,477,898,851 [5.682%]", "22,256,477,899,112 [5.683%]")).toBe(
      true,
    );
  });

  it("detects baseline replacement and level reset shaped changes", () => {
    expect(isLikelyExperienceBaselineReplacement("76,400 [12.954%]", "35,987,275,135,118 [9.187%]")).toBe(
      true,
    );
    expect(isLikelyExperienceLevelReset("12,345,678,901 [82.500%]", "11,111,111,111 [12.000%]")).toBe(
      true,
    );
  });

  it("compares totals only when digit lengths are comparable", () => {
    expect(compareExperienceTotals("1,000,000 [1.000%]", "1,000,001 [1.000%]")).toBe(-1);
    expect(compareExperienceTotals("1,000,000 [1.000%]", "1,000,000 [1.000%]")).toBe(0);
    expect(compareExperienceTotals("1,000,000 [1.000%]", "100,000 [1.000%]")).toBeNull();
    expect(compareExperienceTotals("-- [1.000%]", "1,000,000 [1.000%]")).toBeNull();
  });

  it("estimates experience total from consistent readings", () => {
    expect(estimateExperienceTotalFromText("1,024,178,384 [46.405%]")).toBeCloseTo(
      2_207_043_172,
      0,
    );
    expect(estimateExperienceTotalFromText("1,024,178,384 [1.500%]")).toBeNull();
    expect(expectedExperienceMilli(1_024_178_384, 2_207_043_928)).toBeCloseTo(46_405, 0);
  });
});
