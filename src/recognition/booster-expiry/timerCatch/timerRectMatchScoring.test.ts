import { describe, expect, it } from "vitest";
import {
  rerankAmbiguousMapleDecimalMatches,
  rerankAmbiguousMapleMinuteSecondMatches,
  scoreTimeRect,
} from "./timerRectMatchScoring";
import type {
  Rect,
  SevenSegmentDigitResult,
  TimeReadResult,
  TimerRectMatch,
} from "./timerTypes";

const centeredFrame = { width: 200, height: 100, data: new Uint8Array(200 * 100 * 4) };

describe("timer rect match scoring", () => {
  it("rewards centered m:ss matches with confident direct digits", () => {
    const rect = { x: 56, y: 10, width: 88, height: 20 };
    const confident = scoreTimeRect(
      rect,
      time([3, 0, 1], {
        format: "m:ss",
        confidence: 10,
        selectedBy: "direct",
      }),
      centeredFrame,
    );
    const weak = scoreTimeRect(
      { ...rect, x: 10 },
      time([3, 0, 1], {
        format: "m:ss",
        confidence: 6,
        selectedBy: "fuzzy",
      }),
      centeredFrame,
    );

    expect(confident).toBeGreaterThan(weak);
  });

  it("penalizes oversaturated digit densities", () => {
    const rect = { x: 56, y: 10, width: 88, height: 20 };
    const normal = scoreTimeRect(rect, time([3, 0, 1], { format: "m:ss" }));
    const saturated = scoreTimeRect(
      rect,
      time([3, 0, 1], {
        format: "m:ss",
        densities: [0.95, 0.92, 0.94, 0.91, 0.93, 0.1, 0.2],
      }),
    );

    expect(normal - saturated).toBeCloseTo(7.5, 5);
  });

  it("reranks overlapping decimal matches by digit confidence tie-break", () => {
    const top = match(
      "67.46",
      "ss.cc",
      { x: 10, y: 10, width: 100, height: 25 },
      50,
      { confidence: 1, scoreMargin: -1.5, selectedBy: "fuzzy" },
    );
    const better = match(
      "67.48",
      "ss.cc",
      { x: 12, y: 11, width: 98, height: 24 },
      49.995,
      { confidence: 4, scoreMargin: 1.5, selectedBy: "direct" },
    );
    const distant = match(
      "67.49",
      "ss.cc",
      { x: 140, y: 10, width: 100, height: 25 },
      49.995,
      { confidence: 10, scoreMargin: 1.5, selectedBy: "direct" },
    );
    const matches = [top, distant, better];

    rerankAmbiguousMapleDecimalMatches(matches);

    expect(matches[0]).toBe(better);
  });

  it("reranks ambiguous m:ss matches to a nearby synthetic-template fallback", () => {
    const top = match(
      "3:01",
      "m:ss",
      { x: 50, y: 20, width: 88, height: 20 },
      50,
      { scoreMargin: 0.1, selectedBy: "fuzzy" },
    );
    const replacement = match(
      "3:07",
      "m:ss",
      { x: 51, y: 21, width: 88, height: 20 },
      45,
      { scoreMargin: 0.2, selectedBy: "synthetic-template" },
    );
    const matches = [top, replacement];

    rerankAmbiguousMapleMinuteSecondMatches(matches);

    expect(matches[0]).toBe(replacement);
  });
});

function match(
  text: string,
  format: TimeReadResult["format"],
  rect: Rect,
  score: number,
  digitDefaults: Partial<SevenSegmentDigitResult> = {},
): TimerRectMatch {
  return { rect, score, time: time(parseDigits(text), { format, ...digitDefaults }) };
}

function time(
  digits: number[],
  options: Partial<SevenSegmentDigitResult> & {
    format?: TimeReadResult["format"];
  } = {},
): TimeReadResult {
  const { format, ...digitDefaults } = options;
  return {
    ok: true,
    reason: "ok",
    rect: null,
    digits,
    digitResults: digits.map((digit) => ({
      ok: true,
      reason: "ok",
      mask: digit,
      digit,
      ...digitDefaults,
    })),
    seconds: null,
    text: format === "m:ss" ? `${digits[0]}:${digits[1]}${digits[2]}` : digits.join(""),
    format,
    selectedBy: digitDefaults.selectedBy,
  };
}

function parseDigits(text: string): number[] {
  return [...text].filter((char) => /\d/.test(char)).map(Number);
}
