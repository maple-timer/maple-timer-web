import { describe, expect, it } from "vitest";
import {
  isMapleTimerDigitPixel,
  isMapleTimerDigitPreprocessPixel,
  isMapleTimerGoldPixel,
  isRelaxedMapleTimerGoldPixel,
} from "./timerPixelClassifiers";

describe("timer pixel classifiers", () => {
  it("accepts bright timer digits while rejecting dark background pixels", () => {
    expect(isMapleTimerDigitPixel(pixel(160, 120, 40), 0)).toBe(true);
    expect(isMapleTimerDigitPixel(pixel(80, 80, 80), 0)).toBe(false);
  });

  it("keeps muted reddish digit pixels for preprocessing", () => {
    expect(isMapleTimerDigitPreprocessPixel(pixel(95, 70, 45), 0)).toBe(true);
    expect(isMapleTimerDigitPreprocessPixel(pixel(80, 70, 100), 0)).toBe(false);
  });

  it("separates strict and relaxed Maple timer gold pixels", () => {
    expect(isMapleTimerGoldPixel(pixel(135, 95, 100), 0)).toBe(true);
    expect(isMapleTimerGoldPixel(pixel(110, 70, 100), 0)).toBe(false);
    expect(isRelaxedMapleTimerGoldPixel(pixel(110, 80, 100), 0)).toBe(true);
  });
});

function pixel(red: number, green: number, blue: number): Uint8Array {
  return Uint8Array.from([red, green, blue, 255]);
}
