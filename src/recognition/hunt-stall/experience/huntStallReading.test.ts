import { describe, expect, it } from "vitest";
import type { ExperienceOcrV2Result } from "./experienceOcrV2";
import {
  buildHuntStallReadingFromExperienceOcrV2,
  buildHuntStallReadingFromProcessedImage,
} from "./huntStallReading";

function makeImageData(width = 4, height = 2): ImageData {
  const imageData = new ImageData(width, height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    imageData.data[index + 3] = 255;
  }
  imageData.data[0] = 255;
  imageData.data[4] = 255;
  return imageData;
}

function makeOcrResult(overrides: Partial<ExperienceOcrV2Result> = {}): ExperienceOcrV2Result {
  return {
    text: "123 [1.234%]",
    debugText: "123 [1.234%] (neutral)",
    confidence: 0.8,
    source: "neutral",
    score: 12.3,
    processedImageData: makeImageData(),
    candidates: [
      {
        text: "123 [1.234%]",
        source: "neutral",
        score: 12.3,
        sequence: "123 [1.234%]",
      },
    ],
    ...overrides,
  };
}

describe("huntStallReading", () => {
  it("builds a reading from processed legacy OCR output", () => {
    const processed = makeImageData();

    const reading = buildHuntStallReadingFromProcessedImage(processed, {
      text: "42 [0.123%]",
      debugText: "42[0.123]",
      confidence: 0.72,
    });

    expect(reading).toMatchObject({
      recognizedText: "42 [0.123%]",
      debugText: "42[0.123]",
      confidence: 0.72,
      foregroundRatio: 2 / 8,
    });
    expect(reading.fingerprint).toEqual(expect.any(String));
  });

  it("accepts v2 OCR text when confidence is high enough", () => {
    const ocr = makeOcrResult();
    const { processedImageData, reading } = buildHuntStallReadingFromExperienceOcrV2(
      ocr,
      0.5,
    );

    expect(processedImageData).toBe(ocr.processedImageData);
    expect(reading.recognizedText).toBe("123 [1.234%]");
    expect(reading.debugText).toBe("123 [1.234%] (neutral)");
    expect(reading.ocrCandidates).toEqual([
      { text: "123 [1.234%]", source: "neutral", score: 12.3 },
    ]);
  });

  it("keeps v2 OCR candidate text for debugging when confidence is too low", () => {
    const { reading } = buildHuntStallReadingFromExperienceOcrV2(
      makeOcrResult({
        confidence: 0.31,
        debugText: "low-confidence-debug",
        candidates: [
          { text: "candidate-a", source: "neutral", score: 50, sequence: "candidate-a" },
          { text: "candidate-b", source: "bright", score: 55, sequence: "candidate-b" },
        ],
      }),
      0.5,
    );

    expect(reading.recognizedText).toBeNull();
    expect(reading.debugText).toBe("candidate-a");
    expect(reading.ocrCandidates).toEqual([
      { text: "candidate-a", source: "neutral", score: 50 },
      { text: "candidate-b", source: "bright", score: 55 },
    ]);
  });

  it("falls back to v2 debug text when there are no candidates", () => {
    const { reading } = buildHuntStallReadingFromExperienceOcrV2(
      makeOcrResult({
        text: null,
        confidence: 0,
        debugText: "no candidates",
        candidates: [],
      }),
      0.5,
    );

    expect(reading.recognizedText).toBeNull();
    expect(reading.debugText).toBe("no candidates");
    expect(reading.ocrCandidates).toEqual([]);
  });
});
