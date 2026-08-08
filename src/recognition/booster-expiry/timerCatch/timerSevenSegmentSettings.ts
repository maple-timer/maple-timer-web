import {
  SEVEN_SEGMENT_MASK_TO_DIGIT,
  TIMER_CATCH_TIME_DIGIT_RATIOS,
} from "./timerTypes";
import type { SevenSegmentOptions } from "./timerTypes";

export type SevenSegmentSettings = Required<
  Omit<SevenSegmentOptions, "maskToDigit">
> & {
  maskToDigit: Readonly<Record<number, number>>;
};

export function makeSevenSegmentSettings(
  options: SevenSegmentOptions,
): SevenSegmentSettings {
  return {
    brightnessMode: options.brightnessMode ?? "red-channel",
    threshold: options.threshold ?? 0x80,
    digitRatios: options.digitRatios ?? TIMER_CATCH_TIME_DIGIT_RATIOS,
    rejectBrightBorder: options.rejectBrightBorder ?? true,
    allowBlankLeadingDigit: options.allowBlankLeadingDigit ?? false,
    maskToDigit: options.maskToDigit ?? SEVEN_SEGMENT_MASK_TO_DIGIT,
    areaPreprocess: options.areaPreprocess ?? false,
    areaPreprocessClosing: options.areaPreprocessClosing ?? true,
    areaPreprocessDilation: Math.max(
      0,
      Math.round(options.areaPreprocessDilation ?? 0),
    ),
    minFuzzyOnSegments: Math.max(
      0,
      Math.round(options.minFuzzyOnSegments ?? 0),
    ),
    minFuzzyMargin: options.minFuzzyMargin ?? 0.35,
    requireFuzzyHorizontalSignal: options.requireFuzzyHorizontalSignal ?? false,
    allowFuzzyCandidateFallback: options.allowFuzzyCandidateFallback ?? false,
    fuzzyTopSignalRatio: options.fuzzyTopSignalRatio ?? 0.55,
    fuzzyMiddleSignalRatio: options.fuzzyMiddleSignalRatio ?? 1,
    fuzzyBottomSignalRatio: options.fuzzyBottomSignalRatio ?? 0.55,
    fuzzyVerticalSignalRatio: options.fuzzyVerticalSignalRatio ?? 0,
    maxMapleMinuteSecondMinutes: options.maxMapleMinuteSecondMinutes ?? 5,
    minMapleMinuteSecondDigitConfidence:
      options.minMapleMinuteSecondDigitConfidence ?? 6,
    rejectAmbiguousMapleMinuteSecondFuzzyDigits:
      options.rejectAmbiguousMapleMinuteSecondFuzzyDigits ?? false,
    minAmbiguousMapleMinuteSecondFuzzyConfidence:
      options.minAmbiguousMapleMinuteSecondFuzzyConfidence ?? 8,
    minAmbiguousMapleMinuteSecondFuzzyMargin:
      options.minAmbiguousMapleMinuteSecondFuzzyMargin ?? 0.55,
    correctWeakDirectAreaDigit: options.correctWeakDirectAreaDigit ?? false,
    minDirectCorrectionMargin: options.minDirectCorrectionMargin ?? 0.75,
    allowSyntheticTemplateFallback:
      options.allowSyntheticTemplateFallback ?? false,
    minSyntheticTemplateDigitScore:
      options.minSyntheticTemplateDigitScore ?? 0.18,
    minSyntheticTemplateDigitMargin:
      options.minSyntheticTemplateDigitMargin ?? 0.01,
  };
}
