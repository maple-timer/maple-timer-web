import { describe, expect, it, vi } from "vitest";
import {
  makeMapleTimeReadOptions,
  readFixedMapleDecimalTime,
  readFixedMapleMinuteSecondTime,
} from "./timerFixedMapleTimeReader";
import {
  MAPLE_DECIMAL_TIME_DIGIT_RATIOS,
  MAPLE_REMAINING_TIME_DIGIT_RATIOS,
  MAPLE_SINGLE_SECOND_DECIMAL_TIME_DIGIT_RATIOS,
} from "./timerTypes";
import type {
  ImageDataLike,
  Rect,
  SevenSegmentDigitResult,
  SevenSegmentOptions,
  TimeReadResult,
} from "./timerTypes";

const imageData: ImageDataLike = {
  width: 240,
  height: 80,
  data: new Uint8ClampedArray(),
};
const rect: Rect = { x: 1, y: 2, width: 200, height: 50 };

describe("timer fixed Maple time reader", () => {
  it("fills Maple-specific read option defaults", () => {
    expect(makeMapleTimeReadOptions({})).toMatchObject({
      requireFuzzyHorizontalSignal: true,
      maxMapleMinuteSecondMinutes: 5,
      minMapleMinuteSecondDigitConfidence: 6,
      rejectAmbiguousMapleMinuteSecondFuzzyDigits: false,
      minAmbiguousMapleMinuteSecondFuzzyConfidence: 8,
      minAmbiguousMapleMinuteSecondFuzzyMargin: 0.55,
      fuzzyVerticalSignalRatio: 0.25,
      allowSyntheticTemplateFallback: true,
      minSyntheticTemplateDigitScore: 0.18,
      minSyntheticTemplateDigitMargin: 0.01,
    });
  });

  it("preserves explicit Maple read option values", () => {
    expect(
      makeMapleTimeReadOptions({
        requireFuzzyHorizontalSignal: false,
        maxMapleMinuteSecondMinutes: 9,
        minMapleMinuteSecondDigitConfidence: 4,
        rejectAmbiguousMapleMinuteSecondFuzzyDigits: true,
        minAmbiguousMapleMinuteSecondFuzzyConfidence: 10,
        minAmbiguousMapleMinuteSecondFuzzyMargin: 0.7,
        fuzzyVerticalSignalRatio: 0.5,
        allowSyntheticTemplateFallback: false,
        minSyntheticTemplateDigitScore: 0.3,
        minSyntheticTemplateDigitMargin: 0.04,
      }),
    ).toMatchObject({
      requireFuzzyHorizontalSignal: false,
      maxMapleMinuteSecondMinutes: 9,
      minMapleMinuteSecondDigitConfidence: 4,
      rejectAmbiguousMapleMinuteSecondFuzzyDigits: true,
      minAmbiguousMapleMinuteSecondFuzzyConfidence: 10,
      minAmbiguousMapleMinuteSecondFuzzyMargin: 0.7,
      fuzzyVerticalSignalRatio: 0.5,
      allowSyntheticTemplateFallback: false,
      minSyntheticTemplateDigitScore: 0.3,
      minSyntheticTemplateDigitMargin: 0.04,
    });
  });

  it("formats fixed Maple minute-second readings and supplies Maple ratios", () => {
    const readArea = vi.fn(() => result([3, 0, 1]));

    const time = readFixedMapleMinuteSecondTime(imageData, rect, readArea);

    expect(time).toMatchObject({
      ok: true,
      text: "3:01",
      seconds: 181,
      format: "m:ss",
    });
    expect(readArea).toHaveBeenCalledWith(
      imageData,
      rect,
      expect.objectContaining({
        digitRatios: MAPLE_REMAINING_TIME_DIGIT_RATIOS,
        allowFuzzyCandidateFallback: true,
      }),
    );
  });

  it("uses synthetic fallback when fixed minute-second area reading fails", () => {
    const readArea = vi.fn(() => failResult("not-enough-digits"));
    const readSynthetic = vi.fn(() => ({
      ...result([2, 1, 0]),
      text: "2:10",
      seconds: 130,
      format: "m:ss" as const,
      selectedBy: "synthetic-template",
    }));

    expect(
      readFixedMapleMinuteSecondTime(
        imageData,
        rect,
        readArea,
        {},
        readSynthetic,
      ),
    ).toMatchObject({
      ok: true,
      text: "2:10",
      selectedBy: "synthetic-template",
    });
    expect(readSynthetic).toHaveBeenCalledWith(
      imageData,
      rect,
      expect.objectContaining({ allowSyntheticTemplateFallback: true }),
    );
  });

  it("can preserve the segmented m:ss path synthetic fallback after invalid fixed digits", () => {
    const readArea = vi.fn(() => result([6, 0, 1]));
    const readSynthetic = vi.fn(() => ({
      ...result([2, 1, 0]),
      text: "2:10",
      seconds: 130,
      format: "m:ss" as const,
      selectedBy: "synthetic-template",
    }));

    expect(
      readFixedMapleMinuteSecondTime(
        imageData,
        rect,
        readArea,
        {},
        readSynthetic,
      ),
    ).toMatchObject({
      ok: false,
      reason: "invalid-minutes",
    });
    expect(
      readFixedMapleMinuteSecondTime(
        imageData,
        rect,
        readArea,
        {},
        readSynthetic,
        { allowSyntheticFallbackAfterInvalidResult: true },
      ),
    ).toMatchObject({
      ok: true,
      text: "2:10",
      selectedBy: "synthetic-template",
    });
  });

  it("falls back from four-digit decimal to single-second decimal readings", () => {
    const readArea = vi.fn(
      (
        _imageData: ImageDataLike,
        _rect: Rect | readonly [number, number, number, number],
        options?: SevenSegmentOptions,
      ) =>
        options?.digitRatios === MAPLE_DECIMAL_TIME_DIGIT_RATIOS
          ? failResult("unknown-digit-mask")
          : result([5, 8, 6]),
    );

    const time = readFixedMapleDecimalTime(imageData, rect, readArea);

    expect(time).toMatchObject({
      ok: true,
      text: "5.86",
      format: "s.cc",
    });
    expect(time.seconds).toBeCloseTo(5.86);
    expect(readArea).toHaveBeenNthCalledWith(
      1,
      imageData,
      rect,
      expect.objectContaining({
        digitRatios: MAPLE_DECIMAL_TIME_DIGIT_RATIOS,
      }),
    );
    expect(readArea).toHaveBeenNthCalledWith(
      2,
      imageData,
      rect,
      expect.objectContaining({
        digitRatios: MAPLE_SINGLE_SECOND_DECIMAL_TIME_DIGIT_RATIOS,
      }),
    );
  });
});

function digitResult(digit: number): SevenSegmentDigitResult {
  return {
    ok: true,
    reason: "ok",
    mask: digit,
    digit,
    confidence: 9,
    scoreMargin: 1,
  };
}

function result(digits: number[]): TimeReadResult {
  return {
    ok: true,
    reason: "ok",
    rect,
    digits,
    digitResults: digits.map(digitResult),
    seconds: null,
    text: null,
  };
}

function failResult(reason: string): TimeReadResult {
  return {
    ok: false,
    reason,
    rect,
    digits: [],
    digitResults: [],
    seconds: null,
    text: null,
  };
}
