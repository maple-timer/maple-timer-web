import { describe, expect, it } from "vitest";
import {
  canUseFixedMapleDecimalTime,
  canUseFixedMapleMinuteSecondTime,
  hasMapleDecimalDigitLayout,
  isMapleTimerPanelShape,
  isWideMapleDecimalPanel,
} from "./timerMaplePanelLayout";
import type { ImageDataLike, Rect, TimeReadResult } from "./timerTypes";

const frame: ImageDataLike = {
  width: 1920,
  height: 1080,
  data: new Uint8ClampedArray(),
};

describe("timer Maple panel layout", () => {
  it("accepts centered Maple timer panel shapes within expected size and aspect bounds", () => {
    expect(
      isMapleTimerPanelShape({ x: 840, y: 40, width: 240, height: 48 }, frame),
    ).toBe(true);
  });

  it("rejects panels outside the expected bounds", () => {
    const centered = { x: 840, y: 40, width: 240, height: 48 };

    expect(isMapleTimerPanelShape({ ...centered, x: 100 }, frame)).toBe(false);
    expect(isMapleTimerPanelShape({ ...centered, width: 60 }, frame)).toBe(false);
    expect(isMapleTimerPanelShape({ ...centered, width: 500 }, frame)).toBe(false);
    expect(isMapleTimerPanelShape({ ...centered, height: 18 }, frame)).toBe(false);
    expect(isMapleTimerPanelShape({ ...centered, height: 100 }, frame)).toBe(false);
    expect(isMapleTimerPanelShape({ ...centered, width: 100, height: 50 }, frame)).toBe(
      false,
    );
  });

  it("classifies wide decimal panels separately from minute-second panels", () => {
    const wide = { x: 840, y: 40, width: 200, height: 50 };
    const narrow = { x: 840, y: 40, width: 180, height: 50 };

    expect(isWideMapleDecimalPanel(wide, frame)).toBe(true);
    expect(isWideMapleDecimalPanel(narrow, frame)).toBe(false);
    expect(canUseFixedMapleDecimalTime(wide, frame)).toBe(true);
    expect(canUseFixedMapleDecimalTime({ ...wide, height: 48 }, frame)).toBe(false);
    expect(canUseFixedMapleMinuteSecondTime(wide, frame)).toBe(false);
    expect(canUseFixedMapleMinuteSecondTime(narrow, frame)).toBe(true);
  });

  it("rejects invalid fixed decimal rect inputs", () => {
    expect(canUseFixedMapleDecimalTime([0, 0, -1, 50], frame)).toBe(false);
    expect(isWideMapleDecimalPanel([0, 0, -1, 50], frame)).toBe(false);
  });

  it("accepts four decimal digit rects only when they fit the Maple decimal layout", () => {
    const sourceRect: Rect = { x: 10, y: 20, width: 200, height: 50 };
    const result = makeTimeResult(sourceRect, [
      { x: 90, y: 20, width: 20, height: 40 },
      { x: 110, y: 20, width: 20, height: 40 },
      { x: 140, y: 20, width: 20, height: 40 },
      { x: 165, y: 20, width: 20, height: 40 },
    ]);

    expect(hasMapleDecimalDigitLayout(result)).toBe(true);
    expect(
      hasMapleDecimalDigitLayout(
        makeTimeResult(sourceRect, [
          { x: 70, y: 20, width: 20, height: 40 },
          { x: 110, y: 20, width: 20, height: 40 },
          { x: 140, y: 20, width: 20, height: 40 },
          { x: 165, y: 20, width: 20, height: 40 },
        ]),
      ),
    ).toBe(false);
    expect(hasMapleDecimalDigitLayout({ ...result, rect: null })).toBe(false);
    const partialDigitRects = result.digitResults
      .slice(0, 3)
      .map((digit) => digit.rect!);
    expect(hasMapleDecimalDigitLayout(makeTimeResult(sourceRect, partialDigitRects))).toBe(
      false,
    );
  });
});

function makeTimeResult(sourceRect: Rect, digitRects: Rect[]): TimeReadResult {
  return {
    ok: true,
    reason: "ok",
    rect: sourceRect,
    digits: digitRects.map((_, index) => index),
    digitResults: digitRects.map((rect, index) => ({
      ok: true,
      reason: "ok",
      rect,
      mask: index,
      digit: index,
    })),
    seconds: null,
    text: null,
  };
}
