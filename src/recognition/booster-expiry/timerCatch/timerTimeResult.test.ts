import { describe, expect, it } from "vitest";
import type { SevenSegmentDigitResult, TimeReadResult } from "./timerTypes";
import {
  formatMapleFourDigitDecimalTime,
  formatMapleMinuteSecondTime,
  formatMapleSingleSecondDecimalTime,
  formatTimerCatchMinuteSecondTime,
  validateMapleMinuteSecondTime,
} from "./timerTimeResult";

function digitResult(partial: Partial<SevenSegmentDigitResult> = {}): SevenSegmentDigitResult {
  return {
    ok: partial.ok ?? true,
    reason: partial.reason ?? "ok",
    mask: partial.mask ?? 0x77,
    digit: partial.digit ?? 0,
    confidence: partial.confidence ?? 8,
    scoreMargin: partial.scoreMargin ?? 1,
    selectedBy: partial.selectedBy,
  };
}

function result(digits: number[], digitResults = digits.map(() => digitResult())): TimeReadResult {
  return {
    ok: true,
    reason: "ok",
    rect: { x: 1, y: 2, width: 30, height: 10 },
    digits,
    digitResults,
    seconds: null,
    text: null,
  };
}

describe("timerTimeResult", () => {
  it("formats timer-catch mm:ss readings", () => {
    expect(formatTimerCatchMinuteSecondTime(result([0, 3, 2, 1]))).toMatchObject({
      seconds: 201,
      text: "03:21",
      format: "mm:ss",
    });
  });

  it("formats Maple m:ss and decimal readings", () => {
    expect(formatMapleMinuteSecondTime(result([3, 0, 1]))).toMatchObject({
      seconds: 181,
      text: "3:01",
      format: "m:ss",
    });
    expect(formatMapleMinuteSecondTime(result([3, 0, 1]), "synthetic-template")).toMatchObject({
      selectedBy: "synthetic-template",
    });
    const fourDigitDecimal = formatMapleFourDigitDecimalTime(result([6, 7, 4, 6]));
    expect(fourDigitDecimal).toMatchObject({
      text: "67.46",
      format: "ss.cc",
    });
    expect(fourDigitDecimal.seconds).toBeCloseTo(67.46);
    const singleSecondDecimal = formatMapleSingleSecondDecimalTime(result([5, 8, 6]));
    expect(singleSecondDecimal).toMatchObject({
      text: "5.86",
      format: "s.cc",
    });
    expect(singleSecondDecimal.seconds).toBeCloseTo(5.86);
  });

  it("validates Maple m:ss digit ranges and confidence", () => {
    expect(validateMapleMinuteSecondTime(result([3, 0, 1]), {})).toBeNull();
    expect(validateMapleMinuteSecondTime(result([6, 0, 1]), {})).toMatchObject({
      ok: false,
      reason: "invalid-minutes",
      seconds: null,
      text: null,
    });
    expect(validateMapleMinuteSecondTime(result([3, 6, 1]), {})).toMatchObject({
      ok: false,
      reason: "invalid-seconds",
    });
    expect(
      validateMapleMinuteSecondTime(result([3, 0, 1], [digitResult({ confidence: 5 })]), {
        minMapleMinuteSecondDigitConfidence: 6,
      }),
    ).toMatchObject({
      ok: false,
      reason: "low-digit-confidence",
    });
  });

  it("rejects ambiguous fuzzy m:ss digits when configured", () => {
    const invalid = validateMapleMinuteSecondTime(
      result([3, 0, 1], [
        digitResult({ selectedBy: "fuzzy", confidence: 7, scoreMargin: 0.2 }),
      ]),
      {
        rejectAmbiguousMapleMinuteSecondFuzzyDigits: true,
        minAmbiguousMapleMinuteSecondFuzzyConfidence: 8,
        minAmbiguousMapleMinuteSecondFuzzyMargin: 0.55,
      },
    );

    expect(invalid).toMatchObject({
      ok: false,
      reason: "ambiguous-fuzzy-digit",
    });
  });
});
