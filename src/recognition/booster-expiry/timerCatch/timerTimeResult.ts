import { failTime } from "./timerImage";
import type { SevenSegmentOptions, TimeReadResult } from "./timerTypes";

export function formatTimerCatchMinuteSecondTime(result: TimeReadResult): TimeReadResult {
  const [minuteTens, minuteOnes, secondTens, secondOnes] = result.digits;
  const seconds =
    (minuteTens * 10 + minuteOnes) * 60 + secondTens * 10 + secondOnes;

  return {
    ...result,
    seconds,
    text: `${minuteTens}${minuteOnes}:${secondTens}${secondOnes}`,
    format: "mm:ss",
  };
}

export function formatMapleMinuteSecondTime(
  result: TimeReadResult,
  selectedBy?: string,
): TimeReadResult {
  const [minuteOnes, secondTens, secondOnes] = result.digits;
  const seconds = minuteOnes * 60 + secondTens * 10 + secondOnes;
  return {
    ...result,
    seconds,
    text: `${minuteOnes}:${secondTens}${secondOnes}`,
    format: "m:ss",
    ...(selectedBy ? { selectedBy } : {}),
  };
}

export function formatMapleFourDigitDecimalTime(result: TimeReadResult): TimeReadResult {
  const [secondTens, secondOnes, centisecondTens, centisecondOnes] =
    result.digits;
  const seconds =
    secondTens * 10 + secondOnes + centisecondTens / 10 + centisecondOnes / 100;
  return {
    ...result,
    seconds,
    text: `${secondTens}${secondOnes}.${centisecondTens}${centisecondOnes}`,
    format: "ss.cc",
  };
}

export function formatMapleSingleSecondDecimalTime(result: TimeReadResult): TimeReadResult {
  const [secondOnes, centisecondTens, centisecondOnes] = result.digits;
  const seconds = secondOnes + centisecondTens / 10 + centisecondOnes / 100;
  return {
    ...result,
    seconds,
    text: `${secondOnes}.${centisecondTens}${centisecondOnes}`,
    format: "s.cc",
  };
}

export function validateMapleMinuteSecondTime(
  result: TimeReadResult,
  options: SevenSegmentOptions,
): TimeReadResult | null {
  const [minuteOnes, secondTens] = result.digits;
  if (minuteOnes > (options.maxMapleMinuteSecondMinutes ?? 5)) {
    return failTime(
      "invalid-minutes",
      result.rect,
      result.digits,
      result.digitResults,
    );
  }

  if (secondTens > 5) {
    return failTime(
      "invalid-seconds",
      result.rect,
      result.digits,
      result.digitResults,
    );
  }

  const minConfidence = options.minMapleMinuteSecondDigitConfidence ?? 6;
  if (
    result.digitResults.some(
      (digit) =>
        typeof digit.confidence !== "number" ||
        !Number.isFinite(digit.confidence) ||
        digit.confidence < minConfidence,
    )
  ) {
    return failTime(
      "low-digit-confidence",
      result.rect,
      result.digits,
      result.digitResults,
    );
  }

  if (
    options.rejectAmbiguousMapleMinuteSecondFuzzyDigits &&
    result.digitResults.some((digit) => {
      const confidence = digit.confidence;
      const margin = digit.scoreMargin;
      return (
        digit.selectedBy === "fuzzy" &&
        (typeof confidence !== "number" ||
          !Number.isFinite(confidence) ||
          typeof margin !== "number" ||
          !Number.isFinite(margin) ||
          (confidence <
            (options.minAmbiguousMapleMinuteSecondFuzzyConfidence ?? 8) &&
            margin <
              (options.minAmbiguousMapleMinuteSecondFuzzyMargin ?? 0.55)))
      );
    })
  ) {
    return failTime(
      "ambiguous-fuzzy-digit",
      result.rect,
      result.digits,
      result.digitResults,
    );
  }

  return null;
}
