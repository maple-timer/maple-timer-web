import { describe, expect, it } from "vitest";
import {
  classifyBarCoverage,
  estimateFixedYExpBarFromStrips,
  getFixedYExpBarStripRegions,
  type ExpBarEstimate,
} from "./huntStallExperienceBar";

describe("huntStallExperienceBar", () => {
  it("keeps the measured strip presets for a supported capture size", () => {
    expect(getFixedYExpBarStripRegions(1368, 807)).toEqual([
      { sourceLabel: "fixed-full-width-y 1368x807 #4", y: 797, height: 7 },
      { sourceLabel: "fixed-full-width-y 1368x807 #5", y: 797, height: 7 },
      { sourceLabel: "fixed-full-width-y 1368x807 #6", y: 797, height: 7 },
    ]);
    expect(getFixedYExpBarStripRegions(800, 600)).toEqual([]);
  });

  it("estimates a stable colored prefix from already-captured strips", () => {
    const imageData = new ImageData(100, 6);
    for (let y = 0; y < imageData.height; y += 1) {
      for (let x = 0; x < 50; x += 1) {
        const index = (y * imageData.width + x) * 4;
        imageData.data[index] = 200;
        imageData.data[index + 1] = 160;
        imageData.data[index + 2] = 50;
        imageData.data[index + 3] = 255;
      }
    }

    expect(
      estimateFixedYExpBarFromStrips(
        [{ sourceLabel: "test", y: 700, height: 6, imageData }],
        100,
      ),
    ).toMatchObject({
      percent: 50,
      confidence: 1,
      fillX0: 0,
      fillX1: 50,
      y: 703,
      supportRows: 6,
      sourceLabel: "test",
    });
  });

  it("classifies bar coverage relative to the selected crop", () => {
    const estimate = makeEstimate();

    expect(classifyBarCoverage(estimate, { x: 60, y: 0, width: 20, height: 10 })).toBe(
      "no_bar",
    );
    expect(classifyBarCoverage(estimate, { x: 40, y: 0, width: 20, height: 10 })).toBe(
      "partial_bar",
    );
    expect(classifyBarCoverage(estimate, { x: 10, y: 0, width: 20, height: 10 })).toBe(
      "full_bar",
    );
    expect(classifyBarCoverage(null, { x: 10, y: 0, width: 20, height: 10 })).toBe(
      "unknown",
    );
  });
});

function makeEstimate(): ExpBarEstimate {
  return {
    percent: 50,
    confidence: 0.9,
    fillX0: 0,
    fillX1: 50,
    trackX0: 0,
    trackX1: 100,
    y: 700,
    supportRows: 6,
    sourceLabel: "test",
  };
}
