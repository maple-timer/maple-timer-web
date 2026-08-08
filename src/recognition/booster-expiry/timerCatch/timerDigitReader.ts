import {
  assertImageData,
  failTime,
  normalizeStrictRect,
} from "./timerImage";
import { makeDigitRect } from "./timerDigitRects";
import { TIMER_CATCH_TIME_DIGIT_RATIOS } from "./timerTypes";
import {
  formatMapleFourDigitDecimalTime,
  formatMapleMinuteSecondTime,
  formatTimerCatchMinuteSecondTime,
  validateMapleMinuteSecondTime,
} from "./timerTimeResult";
import { readSevenSegmentDigit } from "./timerSamplePointDigitReader";
import {
  makeSevenSegmentSettings,
} from "./timerSevenSegmentSettings";
import {
  hasDigitForMask,
  readAreaSevenSegmentDigits,
} from "./timerAreaSevenSegmentReader";
import {
  canUseFixedMapleDecimalTime,
  canUseFixedMapleMinuteSecondTime,
  hasMapleDecimalDigitLayout,
  isMapleTimerPanelShape,
  isWideMapleDecimalPanel,
} from "./timerMaplePanelLayout";
import {
  makeMapleTimeReadOptions,
  readFixedMapleDecimalTime,
  readFixedMapleMinuteSecondTime,
} from "./timerFixedMapleTimeReader";
import { readMapleSegmentedDigits } from "./timerMapleSegmentedDigits";
import type {
  ImageDataLike,
  Rect,
  SevenSegmentDigitResult,
  SevenSegmentOptions,
  TimeReadResult,
} from "./timerTypes";

export { readSevenSegmentDigit } from "./timerSamplePointDigitReader";

export function readTimerCatchTimeSeconds(
  imageData: ImageDataLike,
  rect: Rect | readonly [number, number, number, number],
  options: SevenSegmentOptions = {},
): number | null {
  const result = readTimerCatchTime(imageData, rect, options);
  return result.ok ? result.seconds : null;
}

export function readTimerCatchTime(
  imageData: ImageDataLike,
  rect: Rect | readonly [number, number, number, number],
  options: SevenSegmentOptions = {},
): TimeReadResult {
  const result = readSevenSegmentDigits(imageData, rect, {
    ...options,
    digitRatios: options.digitRatios ?? TIMER_CATCH_TIME_DIGIT_RATIOS,
    allowBlankLeadingDigit: options.allowBlankLeadingDigit ?? true,
  });
  if (!result.ok) {
    return {
      ...result,
      seconds: null,
      text: null,
    };
  }

  return formatTimerCatchMinuteSecondTime(result);
}

export function readTimerCatchSegmentTime(
  imageData: ImageDataLike,
  rect: Rect | readonly [number, number, number, number],
  options: SevenSegmentOptions = {},
): TimeReadResult {
  const mapleOptions = makeMapleTimeReadOptions(options);
  const result = readMapleSegmentedDigits(imageData, rect, {
    ...mapleOptions,
    allowFuzzyCandidateFallback:
      mapleOptions.allowFuzzyCandidateFallback ??
      !isWideMapleDecimalPanel(rect, imageData),
  });
  if (!result.ok) {
    const fixedDecimalTime = canUseFixedMapleDecimalTime(rect, imageData)
      ? readFixedMapleDecimalTime(
          imageData,
          rect,
          readAreaSevenSegmentDigits,
          mapleOptions,
        )
      : null;
    if (fixedDecimalTime?.ok) return fixedDecimalTime;

    const fixedMinuteTime = canUseFixedMapleMinuteSecondTime(rect, imageData)
      ? readFixedMapleMinuteSecondTime(
          imageData,
          rect,
          readAreaSevenSegmentDigits,
          mapleOptions,
          undefined,
          { allowSyntheticFallbackAfterInvalidResult: true },
        )
      : null;
    if (fixedMinuteTime?.ok) return fixedMinuteTime;

    return {
      ...result,
      seconds: null,
      text: null,
    };
  }

  if (result.digits.length === 3) {
    if (isWideMapleDecimalPanel(result.rect ?? rect, imageData)) {
      const fallbackRect = result.rect ?? rect;
      const fallbackDecimalTime = canUseFixedMapleDecimalTime(
        fallbackRect,
        imageData,
      )
        ? readFixedMapleDecimalTime(
            imageData,
            fallbackRect,
            readAreaSevenSegmentDigits,
            mapleOptions,
          )
        : null;
      if (fallbackDecimalTime?.ok) return fallbackDecimalTime;

      return failTime(
        "ambiguous-digit-count",
        result.rect,
        result.digits,
        result.digitResults,
      );
    }

    const fixedMinuteTime = readFixedMapleMinuteSecondTime(
      imageData,
      result.rect ?? rect,
      readAreaSevenSegmentDigits,
      mapleOptions,
      undefined,
      { allowSyntheticFallbackAfterInvalidResult: true },
    );
    if (fixedMinuteTime.ok) return fixedMinuteTime;

    const invalidMinuteSecondTime = validateMapleMinuteSecondTime(
      result,
      mapleOptions,
    );
    if (invalidMinuteSecondTime) return invalidMinuteSecondTime;

    return formatMapleMinuteSecondTime(result);
  }

  if (result.digits.length === 4) {
    const fallbackRect = result.rect ?? rect;
    if (!isWideMapleDecimalPanel(fallbackRect, imageData)) {
      return failTime(
        "invalid-decimal-panel",
        result.rect,
        result.digits,
        result.digitResults,
      );
    }

    if (!hasMapleDecimalDigitLayout(result)) {
      const fallbackDecimalTime = canUseFixedMapleDecimalTime(
        fallbackRect,
        imageData,
      )
        ? readFixedMapleDecimalTime(
            imageData,
            fallbackRect,
            readAreaSevenSegmentDigits,
            mapleOptions,
          )
        : null;
      if (fallbackDecimalTime?.ok) return fallbackDecimalTime;

      return failTime(
        "invalid-decimal-digit-layout",
        result.rect,
        result.digits,
        result.digitResults,
      );
    }

    return formatMapleFourDigitDecimalTime(result);
  }

  return failTime(
    "unsupported-digit-count",
    result.rect,
    result.digits,
    result.digitResults,
  );
}

export function readSevenSegmentDigits(
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

  const digits: number[] = [];
  const digitResults: SevenSegmentDigitResult[] = [];
  for (let index = 0; index < settings.digitRatios.length; index += 1) {
    const digitRect = makeDigitRect(sourceRect, settings.digitRatios[index]);
    const digitResult = {
      ...readSevenSegmentDigit(imageData, digitRect, settings),
      index,
      rect: digitRect,
    };
    digitResults.push(digitResult);

    if (!digitResult.ok)
      return failTime(digitResult.reason, sourceRect, digits, digitResults);
    if (hasDigitForMask(settings.maskToDigit, digitResult.mask)) {
      digits.push(settings.maskToDigit[digitResult.mask]);
      continue;
    }
    if (
      index === 0 &&
      settings.allowBlankLeadingDigit &&
      digitResult.mask === 0
    ) {
      digits.push(0);
      continue;
    }
    return failTime("unknown-digit-mask", sourceRect, digits, digitResults);
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

export function readTimerCandidate(
  imageData: ImageDataLike,
  rect: Rect,
  options: SevenSegmentOptions,
): TimeReadResult {
  const timerCatchTime = readTimerCatchTime(imageData, rect, options);
  if (timerCatchTime.ok) return timerCatchTime;
  if (!isMapleTimerPanelShape(rect, imageData)) return timerCatchTime;
  const remainingTime = readTimerCatchSegmentTime(imageData, rect, options);
  return remainingTime.ok ? remainingTime : timerCatchTime;
}
