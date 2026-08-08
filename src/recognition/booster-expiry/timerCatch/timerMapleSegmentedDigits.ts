import { findMapleTimerDigitRects } from "./timerDigitRects";
import {
  assertImageData,
  failTime,
  normalizeStrictRect,
} from "./timerImage";
import {
  hasDigitForMask,
  readAreaSevenSegmentDigit,
} from "./timerAreaSevenSegmentReader";
import { makeSevenSegmentSettings } from "./timerSevenSegmentSettings";
import type {
  ImageDataLike,
  Rect,
  SevenSegmentDigitResult,
  SevenSegmentOptions,
  TimeReadResult,
} from "./timerTypes";

export function readMapleSegmentedDigits(
  imageData: ImageDataLike,
  rect: Rect | readonly [number, number, number, number],
  options: SevenSegmentOptions = {},
): TimeReadResult {
  assertImageData(imageData);
  const settings = makeSevenSegmentSettings(options);
  const sourceRect = normalizeStrictRect(
    rect,
    imageData.width,
    imageData.height,
  );
  if (!sourceRect) return failTime("invalid-rect", null, [], []);

  const digitRects = findMapleTimerDigitRects(imageData, sourceRect);
  if (digitRects.length < 3)
    return failTime("not-enough-digits", sourceRect, [], []);
  if (digitRects.length > 4)
    return failTime("too-many-digits", sourceRect, [], []);

  const digits: number[] = [];
  const digitResults: SevenSegmentDigitResult[] = [];
  for (let index = 0; index < digitRects.length; index += 1) {
    const digitRect = digitRects[index];
    const digitResult = {
      ...readAreaSevenSegmentDigit(imageData, digitRect, settings),
      index,
      rect: digitRect,
    };
    digitResults.push(digitResult);

    if (!digitResult.ok)
      return failTime(digitResult.reason, sourceRect, digits, digitResults);
    if (!hasDigitForMask(settings.maskToDigit, digitResult.mask))
      return failTime("unknown-digit-mask", sourceRect, digits, digitResults);
    digits.push(settings.maskToDigit[digitResult.mask]);
  }

  return {
    ok: true,
    reason: "ok",
    rect: sourceRect,
    digits,
    digitResults,
    seconds: null,
    text: null,
  };
}
