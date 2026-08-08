import { rectFromInput } from "./timerImage";
import type { ImageDataLike, Rect, TimeReadResult } from "./timerTypes";

export function isMapleTimerPanelShape(
  rect: Rect,
  imageData: ImageDataLike,
): boolean {
  const aspect = rect.width / Math.max(1, rect.height);
  const centerXRatio = (rect.x + rect.width / 2) / imageData.width;
  const minWidth = Math.max(1, Math.min(80, Math.round(imageData.width * 0.035)));
  const maxWidth = Math.max(
    minWidth,
    Math.min(imageData.width, Math.max(360, Math.round(imageData.width * 0.24))),
  );
  const minHeight = Math.max(1, Math.min(24, Math.round(imageData.height * 0.02)));
  const maxHeight = Math.max(
    minHeight,
    Math.min(imageData.height, Math.max(90, Math.round(imageData.height * 0.075))),
  );

  return (
    rect.width >= minWidth &&
    rect.width <= maxWidth &&
    rect.height >= minHeight &&
    rect.height <= maxHeight &&
    aspect >= 2.8 &&
    aspect <= 6.8 &&
    centerXRatio >= 0.33 &&
    centerXRatio <= 0.67
  );
}

export function canUseFixedMapleMinuteSecondTime(
  rect: Rect | readonly [number, number, number, number],
  imageData: ImageDataLike,
): boolean {
  return !isWideMapleDecimalPanel(rect, imageData);
}

export function canUseFixedMapleDecimalTime(
  rect: Rect | readonly [number, number, number, number],
  imageData: ImageDataLike,
): boolean {
  const value = rectFromInput(rect);
  if (!value || !isWideMapleDecimalPanel(value, imageData)) return false;
  return value.height >= Math.max(28, Math.round(imageData.height * 0.045));
}

export function hasMapleDecimalDigitLayout(result: TimeReadResult): boolean {
  const sourceRect = result.rect;
  if (
    !sourceRect ||
    !Array.isArray(result.digitResults) ||
    result.digitResults.length !== 4
  )
    return false;

  const expectedStarts = [0.39, 0.49, 0.64, 0.75];
  const expectedEnds = [0.57, 0.66, 0.8, 0.92];
  return result.digitResults.every((digitResult, index) => {
    const digitRect = digitResult.rect;
    if (!digitRect) return false;
    const start = (digitRect.x - sourceRect.x) / sourceRect.width;
    const end =
      (digitRect.x + digitRect.width - sourceRect.x) / sourceRect.width;
    return start >= expectedStarts[index] && end <= expectedEnds[index];
  });
}

export function isWideMapleDecimalPanel(
  rect: Rect | readonly [number, number, number, number],
  imageData: ImageDataLike,
): boolean {
  const value = rectFromInput(rect);
  return Boolean(value && value.width / imageData.width > 0.095);
}
