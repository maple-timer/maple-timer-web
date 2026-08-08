import { describe, expect, it } from "vitest";
import { getManualExperienceDisplayPreviewRegion } from "./huntStallManualExperienceSampling";

describe("huntStallManualExperienceSampling", () => {
  it("uses the full capture width for the display preview while preserving the selected Y band", () => {
    const previewRegion = getManualExperienceDisplayPreviewRegion(
      { x: 633, y: 1_080, width: 653, height: 39 },
      1_920,
    );

    expect(previewRegion).toEqual({
      x: 0,
      y: 1_080,
      width: 1_920,
      height: 39,
    });
  });
});
