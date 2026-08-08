import { describe, expect, it } from "vitest";
import { getManualExperienceRegionValidationError } from "./manualExperienceRegionValidation";

describe("getManualExperienceRegionValidationError", () => {
  it("accepts a narrow experience-bar band", () => {
    expect(
      getManualExperienceRegionValidationError({
        x: 0.33,
        y: 0.98,
        width: 0.34,
        height: 0.02,
      }),
    ).toBeNull();
  });

  it("rejects a band that includes expanded UI below the game", () => {
    expect(
      getManualExperienceRegionValidationError({
        x: 0.33,
        y: 0.8,
        width: 0.34,
        height: 0.2,
      }),
    ).toContain("게임 화면을 먼저 맞춰주세요");
  });
});
