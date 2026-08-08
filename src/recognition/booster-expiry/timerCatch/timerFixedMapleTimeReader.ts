import { readSyntheticMapleMinuteSecondTime } from "./timerSyntheticTimeReader";
import {
  formatMapleFourDigitDecimalTime,
  formatMapleMinuteSecondTime,
  formatMapleSingleSecondDecimalTime,
  validateMapleMinuteSecondTime,
} from "./timerTimeResult";
import {
  MAPLE_DECIMAL_TIME_DIGIT_RATIOS,
  MAPLE_REMAINING_TIME_DIGIT_RATIOS,
  MAPLE_SINGLE_SECOND_DECIMAL_TIME_DIGIT_RATIOS,
} from "./timerTypes";
import type {
  ImageDataLike,
  Rect,
  SevenSegmentOptions,
  TimeReadResult,
} from "./timerTypes";

export type AreaSevenSegmentDigitsReader = (
  imageData: ImageDataLike,
  rect: Rect | readonly [number, number, number, number],
  options?: SevenSegmentOptions,
) => TimeReadResult;

export type SyntheticMapleMinuteSecondReader = (
  imageData: ImageDataLike,
  rect: Rect | readonly [number, number, number, number],
  options?: SevenSegmentOptions,
) => TimeReadResult;

export type FixedMapleMinuteSecondReadBehavior = {
  allowSyntheticFallbackAfterInvalidResult?: boolean;
};

export function readFixedMapleMinuteSecondTime(
  imageData: ImageDataLike,
  rect: Rect | readonly [number, number, number, number],
  readAreaSevenSegmentDigits: AreaSevenSegmentDigitsReader,
  options: SevenSegmentOptions = {},
  readSyntheticMinuteSecond: SyntheticMapleMinuteSecondReader =
    readSyntheticMapleMinuteSecondTime,
  behavior: FixedMapleMinuteSecondReadBehavior = {},
): TimeReadResult {
  const mapleOptions = makeMapleTimeReadOptions(options);
  const result = readAreaSevenSegmentDigits(imageData, rect, {
    ...mapleOptions,
    digitRatios: mapleOptions.digitRatios ?? MAPLE_REMAINING_TIME_DIGIT_RATIOS,
    allowFuzzyCandidateFallback:
      mapleOptions.allowFuzzyCandidateFallback ?? true,
  });
  if (!result.ok) {
    const syntheticTime = mapleOptions.allowSyntheticTemplateFallback
      ? readSyntheticMinuteSecond(imageData, rect, mapleOptions)
      : null;
    if (syntheticTime?.ok) return syntheticTime;

    return {
      ...result,
      seconds: null,
      text: null,
    };
  }

  const invalidMinuteSecondTime = validateMapleMinuteSecondTime(
    result,
    mapleOptions,
  );
  if (invalidMinuteSecondTime) {
    const syntheticTime =
      behavior.allowSyntheticFallbackAfterInvalidResult &&
      mapleOptions.allowSyntheticTemplateFallback
        ? readSyntheticMinuteSecond(imageData, rect, mapleOptions)
        : null;
    return syntheticTime?.ok ? syntheticTime : invalidMinuteSecondTime;
  }

  return formatMapleMinuteSecondTime(result);
}

export function makeMapleTimeReadOptions(
  options: SevenSegmentOptions,
): SevenSegmentOptions {
  return {
    ...options,
    requireFuzzyHorizontalSignal: options.requireFuzzyHorizontalSignal ?? true,
    maxMapleMinuteSecondMinutes: options.maxMapleMinuteSecondMinutes ?? 5,
    minMapleMinuteSecondDigitConfidence:
      options.minMapleMinuteSecondDigitConfidence ?? 6,
    rejectAmbiguousMapleMinuteSecondFuzzyDigits:
      options.rejectAmbiguousMapleMinuteSecondFuzzyDigits ?? false,
    minAmbiguousMapleMinuteSecondFuzzyConfidence:
      options.minAmbiguousMapleMinuteSecondFuzzyConfidence ?? 8,
    minAmbiguousMapleMinuteSecondFuzzyMargin:
      options.minAmbiguousMapleMinuteSecondFuzzyMargin ?? 0.55,
    fuzzyVerticalSignalRatio: options.fuzzyVerticalSignalRatio ?? 0.25,
    allowSyntheticTemplateFallback:
      options.allowSyntheticTemplateFallback ?? true,
    minSyntheticTemplateDigitScore:
      options.minSyntheticTemplateDigitScore ?? 0.18,
    minSyntheticTemplateDigitMargin:
      options.minSyntheticTemplateDigitMargin ?? 0.01,
  };
}

export function readFixedMapleDecimalTime(
  imageData: ImageDataLike,
  rect: Rect | readonly [number, number, number, number],
  readAreaSevenSegmentDigits: AreaSevenSegmentDigitsReader,
  options: SevenSegmentOptions = {},
): TimeReadResult {
  const fourDigitTime = readFixedMapleFourDigitDecimalTime(
    imageData,
    rect,
    readAreaSevenSegmentDigits,
    options,
  );
  if (fourDigitTime.ok) return fourDigitTime;

  const threeDigitTime = readFixedMapleSingleSecondDecimalTime(
    imageData,
    rect,
    readAreaSevenSegmentDigits,
    options,
  );
  return threeDigitTime.ok
    ? threeDigitTime
    : {
        ...fourDigitTime,
        seconds: null,
        text: null,
      };
}

export function readFixedMapleFourDigitDecimalTime(
  imageData: ImageDataLike,
  rect: Rect | readonly [number, number, number, number],
  readAreaSevenSegmentDigits: AreaSevenSegmentDigitsReader,
  options: SevenSegmentOptions = {},
): TimeReadResult {
  const result = readAreaSevenSegmentDigits(imageData, rect, {
    ...options,
    requireFuzzyHorizontalSignal: options.requireFuzzyHorizontalSignal ?? true,
    digitRatios: MAPLE_DECIMAL_TIME_DIGIT_RATIOS,
  });

  if (!result.ok) {
    return {
      ...result,
      seconds: null,
      text: null,
    };
  }

  return formatMapleFourDigitDecimalTime(result);
}

export function readFixedMapleSingleSecondDecimalTime(
  imageData: ImageDataLike,
  rect: Rect | readonly [number, number, number, number],
  readAreaSevenSegmentDigits: AreaSevenSegmentDigitsReader,
  options: SevenSegmentOptions = {},
): TimeReadResult {
  const result = readAreaSevenSegmentDigits(imageData, rect, {
    ...options,
    requireFuzzyHorizontalSignal: options.requireFuzzyHorizontalSignal ?? true,
    digitRatios: MAPLE_SINGLE_SECOND_DECIMAL_TIME_DIGIT_RATIOS,
  });

  if (!result.ok) {
    return {
      ...result,
      seconds: null,
      text: null,
    };
  }

  return formatMapleSingleSecondDecimalTime(result);
}
