import { describe, expect, it } from "vitest";
import {
  areaSegmentThreshold,
  canUseFuzzyAreaDigit,
  chooseDirectAreaDigitCorrection,
  classifyAreaSevenSegmentDensities,
  classifyAreaSevenSegmentDensityCandidates,
  countMaskBits,
  mergePreprocessedAreaDensity,
  readFuzzyAreaDigit,
  scoreSelectedAreaDigit,
} from "./timerAreaSegmentClassifier";
import { SEVEN_SEGMENT_DIGIT_TO_MASK, SEVEN_SEGMENT_MASK_TO_DIGIT } from "./timerTypes";

const defaultFuzzySettings = {
  allowFuzzyCandidateFallback: true,
  minFuzzyMargin: 0.35,
  requireFuzzyHorizontalSignal: true,
  fuzzyTopSignalRatio: 0.55,
  fuzzyMiddleSignalRatio: 1,
  fuzzyBottomSignalRatio: 0.55,
  fuzzyVerticalSignalRatio: 0.25,
};

describe("timer area segment classifier", () => {
  it("uses stricter thresholds for vertical segments than horizontal segments", () => {
    expect(areaSegmentThreshold(0)).toBe(0.16);
    expect(areaSegmentThreshold(3)).toBe(0.18);
    expect(areaSegmentThreshold(6)).toBe(0.16);
    expect(areaSegmentThreshold(1)).toBe(0.25);
  });

  it("keeps weak raw density instead of trusting binary preprocessing alone", () => {
    expect(mergePreprocessedAreaDensity(0.04, 0.8, 0)).toBe(0.04);
    expect(mergePreprocessedAreaDensity(0.07, 0.8, 1)).toBe(0.07);
    expect(mergePreprocessedAreaDensity(0.09, 0.8, 1)).toBe(0.8);
  });

  it("ranks density candidates by seven-segment similarity", () => {
    const oneDensities = [0.02, 0.02, 0.7, 0.02, 0.02, 0.7, 0.02];
    const candidates = classifyAreaSevenSegmentDensityCandidates(oneDensities);

    expect(candidates[0]).toMatchObject({
      digit: 1,
      mask: SEVEN_SEGMENT_DIGIT_TO_MASK[1],
    });
    expect(classifyAreaSevenSegmentDensities(oneDensities)).toMatchObject({
      digit: 1,
    });
  });

  it("selects fuzzy candidates only when missing segment evidence is strong enough", () => {
    const eightDensities = [0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45];
    const directMask = SEVEN_SEGMENT_DIGIT_TO_MASK[1];
    const candidates = classifyAreaSevenSegmentDensityCandidates(eightDensities);

    expect(readFuzzyAreaDigit(eightDensities, directMask, defaultFuzzySettings, candidates))
      .toMatchObject({ digit: 8 });

    expect(
      canUseFuzzyAreaDigit(
        [0.01, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45],
        directMask,
        candidates[0],
        defaultFuzzySettings,
      ),
    ).toBe(false);
  });

  it("corrects weak direct masks when the best candidate is clearly stronger", () => {
    const eightDensities = [0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45];
    const directMask = SEVEN_SEGMENT_DIGIT_TO_MASK[1];
    const candidates = classifyAreaSevenSegmentDensityCandidates(eightDensities);

    expect(
      chooseDirectAreaDigitCorrection(eightDensities, directMask, candidates, {
        ...defaultFuzzySettings,
        minDirectCorrectionMargin: 0.75,
      }),
    ).toMatchObject({ digit: 8 });
  });

  it("scores the selected digit against the next-best candidate", () => {
    const oneDensities = [0.02, 0.02, 0.7, 0.02, 0.02, 0.7, 0.02];
    const candidates = classifyAreaSevenSegmentDensityCandidates(oneDensities);
    const confidence = scoreSelectedAreaDigit(
      oneDensities,
      SEVEN_SEGMENT_DIGIT_TO_MASK[1],
      candidates,
      SEVEN_SEGMENT_MASK_TO_DIGIT,
    );

    expect(confidence.score).toBeGreaterThan(5.5);
    expect(confidence.margin).toBeGreaterThan(0.35);
    expect(confidence.value).toBe(confidence.score + confidence.margin);
    expect(
      scoreSelectedAreaDigit(oneDensities, 0, candidates, SEVEN_SEGMENT_MASK_TO_DIGIT),
    ).toEqual({
      score: -Infinity,
      margin: -Infinity,
      value: -Infinity,
    });
  });

  it("counts enabled mask segments", () => {
    expect(countMaskBits(0)).toBe(0);
    expect(countMaskBits(SEVEN_SEGMENT_DIGIT_TO_MASK[1])).toBe(2);
    expect(countMaskBits(SEVEN_SEGMENT_DIGIT_TO_MASK[8])).toBe(7);
  });
});
