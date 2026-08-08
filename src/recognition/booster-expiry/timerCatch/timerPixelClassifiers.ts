import type { PixelArray } from "./timerTypes";

export function isMapleTimerDigitPixel(
  data: PixelArray,
  offset: number,
): boolean {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return Math.max(red, green, blue) > 145 && red + green + blue > 260;
}

export function isMapleTimerDigitPreprocessPixel(
  data: PixelArray,
  offset: number,
): boolean {
  if (isMapleTimerDigitPixel(data, offset)) return true;

  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return (
    red >= 90 &&
    green >= 55 &&
    blue <= 170 &&
    red + green + blue >= 190 &&
    red >= blue + 5 &&
    green >= blue - 35
  );
}

export function isMapleTimerGoldPixel(
  data: PixelArray,
  offset: number,
): boolean {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return (
    red >= 130 &&
    green >= 80 &&
    blue <= 170 &&
    red >= green - 70 &&
    red >= blue + 25 &&
    green >= blue - 10
  );
}

export function isRelaxedMapleTimerGoldPixel(
  data: PixelArray,
  offset: number,
): boolean {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return (
    red >= 105 &&
    green >= 65 &&
    blue <= 190 &&
    red >= green - 85 &&
    red >= blue + 5 &&
    green >= blue - 25
  );
}
