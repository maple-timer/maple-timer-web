import { describe, expect, it } from "vitest";
import { scoreHuntStallCropCandidate } from "./huntStallCropScoring";

function makeProcessedImage(width: number, height: number, rows: number[]): ImageData {
  const imageData = new ImageData(width, height);
  for (const y of rows) {
    for (let x = 0; x < Math.round(width * 0.12); x += 1) {
      const index = (y * width + x) * 4;
      imageData.data[index] = 255;
      imageData.data[index + 1] = 255;
      imageData.data[index + 2] = 255;
      imageData.data[index + 3] = 255;
    }
  }
  return imageData;
}

function score(overrides: Partial<Parameters<typeof scoreHuntStallCropCandidate>[0]> = {}): number {
  return scoreHuntStallCropCandidate({
    recognizedText: "67,244,568,570,334 [17.166%]",
    confidence: 0.84,
    foregroundRatio: 0.095,
    regionWidth: 653,
    processedImageData: makeProcessedImage(300, 21, [0, 1, 19, 20]),
    ...overrides,
  });
}

describe("scoreHuntStallCropCandidate", () => {
  it("penalizes shifted crops whose processed top edge is empty", () => {
    const aligned = score();
    const shifted = score({
      confidence: 0.9,
      foregroundRatio: 0.04,
      processedImageData: makeProcessedImage(300, 21, [19, 20]),
    });

    expect(aligned).toBeGreaterThan(shifted);
  });

  it("penalizes impossible Maple EXP digit lengths", () => {
    const plausible = score();
    const tooLong = score({
      confidence: 0.95,
      recognizedText: "67,244,562,815,701,334 [17.166%]",
    });

    expect(plausible).toBeGreaterThan(tooLong);
  });
});
