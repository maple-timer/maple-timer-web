import { describe, expect, it } from "vitest";
import {
  capAmbiguousSingleDigitConfidence,
  parseCooldownDigits,
} from "./parsing";

describe("recognition parsing", () => {
  it("parses minute-second digit strings when seconds are valid", () => {
    expect(parseCooldownDigits("122")).toBe(82);
    expect(parseCooldownDigits("1030")).toBe(630);
  });

  it("keeps plain digit parsing when minute-second seconds are invalid", () => {
    expect(parseCooldownDigits("160")).toBe(160);
  });

  it("caps ambiguous single high digit confidence", () => {
    expect(capAmbiguousSingleDigitConfidence(6, 1, 0.92)).toBe(0.53);
    expect(capAmbiguousSingleDigitConfidence(3, 1, 0.92)).toBe(0.92);
    expect(capAmbiguousSingleDigitConfidence(6, 2, 0.92)).toBe(0.92);
  });
});
