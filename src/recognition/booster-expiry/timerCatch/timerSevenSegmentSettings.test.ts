import { describe, expect, it } from "vitest";
import {
  SEVEN_SEGMENT_MASK_TO_DIGIT,
  TIMER_CATCH_TIME_DIGIT_RATIOS,
} from "./timerTypes";
import { makeSevenSegmentSettings } from "./timerSevenSegmentSettings";

describe("timer seven segment settings", () => {
  it("fills defaults used by the timer catch reader", () => {
    const settings = makeSevenSegmentSettings({});

    expect(settings).toMatchObject({
      brightnessMode: "red-channel",
      threshold: 0x80,
      rejectBrightBorder: true,
      allowBlankLeadingDigit: false,
      areaPreprocess: false,
      areaPreprocessClosing: true,
      areaPreprocessDilation: 0,
      minFuzzyOnSegments: 0,
      minFuzzyMargin: 0.35,
      requireFuzzyHorizontalSignal: false,
      allowFuzzyCandidateFallback: false,
      fuzzyTopSignalRatio: 0.55,
      fuzzyMiddleSignalRatio: 1,
      fuzzyBottomSignalRatio: 0.55,
      fuzzyVerticalSignalRatio: 0,
      maxMapleMinuteSecondMinutes: 5,
      minMapleMinuteSecondDigitConfidence: 6,
      rejectAmbiguousMapleMinuteSecondFuzzyDigits: false,
      minAmbiguousMapleMinuteSecondFuzzyConfidence: 8,
      minAmbiguousMapleMinuteSecondFuzzyMargin: 0.55,
      correctWeakDirectAreaDigit: false,
      minDirectCorrectionMargin: 0.75,
      allowSyntheticTemplateFallback: false,
      minSyntheticTemplateDigitScore: 0.18,
      minSyntheticTemplateDigitMargin: 0.01,
    });
    expect(settings.digitRatios).toBe(TIMER_CATCH_TIME_DIGIT_RATIOS);
    expect(settings.maskToDigit).toBe(SEVEN_SEGMENT_MASK_TO_DIGIT);
  });

  it("preserves explicit option values", () => {
    const digitRatios = [
      { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.4 },
    ] as const;
    const maskToDigit = { 0x12: 9 };

    const settings = makeSevenSegmentSettings({
      brightnessMode: "luma",
      threshold: 0x44,
      digitRatios,
      rejectBrightBorder: false,
      allowBlankLeadingDigit: true,
      maskToDigit,
      areaPreprocess: true,
      areaPreprocessClosing: false,
      areaPreprocessDilation: 2,
      minFuzzyOnSegments: 3,
      minFuzzyMargin: 0.2,
      requireFuzzyHorizontalSignal: true,
      allowFuzzyCandidateFallback: true,
      fuzzyTopSignalRatio: 0.1,
      fuzzyMiddleSignalRatio: 0.2,
      fuzzyBottomSignalRatio: 0.3,
      fuzzyVerticalSignalRatio: 0.4,
      maxMapleMinuteSecondMinutes: 9,
      minMapleMinuteSecondDigitConfidence: 7,
      rejectAmbiguousMapleMinuteSecondFuzzyDigits: true,
      minAmbiguousMapleMinuteSecondFuzzyConfidence: 10,
      minAmbiguousMapleMinuteSecondFuzzyMargin: 0.6,
      correctWeakDirectAreaDigit: true,
      minDirectCorrectionMargin: 0.8,
      allowSyntheticTemplateFallback: true,
      minSyntheticTemplateDigitScore: 0.3,
      minSyntheticTemplateDigitMargin: 0.04,
    });

    expect(settings).toMatchObject({
      brightnessMode: "luma",
      threshold: 0x44,
      rejectBrightBorder: false,
      allowBlankLeadingDigit: true,
      areaPreprocess: true,
      areaPreprocessClosing: false,
      areaPreprocessDilation: 2,
      minFuzzyOnSegments: 3,
      minFuzzyMargin: 0.2,
      requireFuzzyHorizontalSignal: true,
      allowFuzzyCandidateFallback: true,
      fuzzyTopSignalRatio: 0.1,
      fuzzyMiddleSignalRatio: 0.2,
      fuzzyBottomSignalRatio: 0.3,
      fuzzyVerticalSignalRatio: 0.4,
      maxMapleMinuteSecondMinutes: 9,
      minMapleMinuteSecondDigitConfidence: 7,
      rejectAmbiguousMapleMinuteSecondFuzzyDigits: true,
      minAmbiguousMapleMinuteSecondFuzzyConfidence: 10,
      minAmbiguousMapleMinuteSecondFuzzyMargin: 0.6,
      correctWeakDirectAreaDigit: true,
      minDirectCorrectionMargin: 0.8,
      allowSyntheticTemplateFallback: true,
      minSyntheticTemplateDigitScore: 0.3,
      minSyntheticTemplateDigitMargin: 0.04,
    });
    expect(settings.digitRatios).toBe(digitRatios);
    expect(settings.maskToDigit).toBe(maskToDigit);
  });

  it("normalizes integer count settings", () => {
    expect(
      makeSevenSegmentSettings({
        areaPreprocessDilation: -3.4,
        minFuzzyOnSegments: -1.2,
      }),
    ).toMatchObject({
      areaPreprocessDilation: 0,
      minFuzzyOnSegments: 0,
    });

    expect(
      makeSevenSegmentSettings({
        areaPreprocessDilation: 1.6,
        minFuzzyOnSegments: 2.4,
      }),
    ).toMatchObject({
      areaPreprocessDilation: 2,
      minFuzzyOnSegments: 2,
    });
  });
});
