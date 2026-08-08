import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  analyzeTimerCatchTimer,
  cropImageData,
  findEdgeRectCandidates,
  findTimerCatchTimeRect,
  makeSobelEdgeMask,
  readSevenSegmentDigits,
  readTimerCatchSegmentTime,
  resolveTimerCatchRoi,
} from "./timer";

class TestImageData implements ImageData {
  readonly colorSpace: PredefinedColorSpace = "srgb";

  constructor(
    public data: ImageDataArray,
    public width: number,
    public height: number,
  ) {}
}

describe("timerCatch timer reader", () => {
  it("reads the Maple SS.CC booster timer from a known timer crop", () => {
    const imageData = readFixtureImageData("booster-timer-67_46.png");
    const result = readTimerCatchSegmentTime(imageData, {
      x: 3,
      y: 6,
      width: 198,
      height: 48,
    });

    expect(result).toMatchObject({
      ok: true,
      reason: "ok",
      rect: { x: 3, y: 6, width: 198, height: 48 },
      digits: [6, 7, 4, 6],
      text: "67.46",
      format: "ss.cc",
    });
    expect(result.seconds).toBeCloseTo(67.46);
  });

  it("finds the timer rectangle and reads the same timer through the full analysis path", () => {
    const imageData = readFixtureImageData("booster-timer-67_46.png");
    const detected = findTimerCatchTimeRect(imageData);
    const analyzed = analyzeTimerCatchTimer(imageData, {
      autoUpscale: false,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
    });

    expect(detected).toMatchObject({
      ok: true,
      reason: "ok",
      rect: { x: 3, y: 6, width: 198, height: 48 },
      time: {
        text: "67.46",
        format: "ss.cc",
      },
    });
    expect(detected.matches).toHaveLength(1);
    expect(detected.candidates).toEqual([
      { x: 3, y: 6, width: 198, height: 48 },
    ]);
    expect(analyzed.time?.text).toBe("67.46");
    expect(analyzed.timeRect.rect).toEqual(detected.rect);
  });

  it("crops and resolves default ROI without mutating timer pixels", () => {
    const imageData = readFixtureImageData("booster-timer-67_46.png");
    const roi = resolveTimerCatchRoi(imageData);
    const cropped = cropImageData(imageData, {
      x: 3,
      y: 6,
      width: 198,
      height: 48,
    });

    expect(roi).toEqual({ x: 0, y: 0, width: 209, height: 58 });
    expect(cropped.width).toBe(198);
    expect(cropped.height).toBe(48);
    expect(cropped.data.length).toBe(198 * 48 * 4);
    expect(
      readTimerCatchSegmentTime(cropped, { x: 0, y: 0, width: 198, height: 48 })
        .text,
    ).toBe("67.46");
  });

  it("reports invalid fixed rects without reading outside the frame", () => {
    const imageData = readFixtureImageData("booster-timer-67_46.png");
    const invalidRead = readSevenSegmentDigits(imageData, {
      x: 200,
      y: 50,
      width: 20,
      height: 20,
    });

    expect(invalidRead).toMatchObject({
      ok: false,
      reason: "invalid-rect",
      rect: null,
      seconds: null,
      text: null,
    });
    expect(() =>
      cropImageData(imageData, { x: 200, y: 50, width: 20, height: 20 }),
    ).toThrow(RangeError);
  });

  it("keeps the fixed timeRect path on the explicit timer-catch reader without falling back", () => {
    const imageData = readFixtureImageData("booster-timer-67_46.png");
    const result = analyzeTimerCatchTimer(imageData, {
      autoUpscale: false,
      timeRect: [3, 6, 198, 48],
    });

    expect(result.timeRect).toMatchObject({
      ok: false,
      reason: "bright-border",
      rect: null,
      candidates: [{ x: 3, y: 6, width: 198, height: 48 }],
      roi: { x: 3, y: 6, width: 198, height: 48 },
    });
    expect(result.time).toBeNull();
  });

  it("builds edge masks and edge candidates inside the requested ROI", () => {
    const imageData = readFixtureImageData("booster-timer-67_46.png");
    const roi = {
      x: 0,
      y: 0,
      width: imageData.width,
      height: imageData.height,
    };
    const edgeMask = makeSobelEdgeMask(imageData, roi);
    const candidates = findEdgeRectCandidates(edgeMask, roi, {
      minRectWidth: 20,
      minRectHeight: 10,
    });

    expect(edgeMask.width).toBe(imageData.width);
    expect(edgeMask.height).toBe(imageData.height);
    expect(edgeMask.maxMagnitude).toBeGreaterThan(0);
    expect(
      candidates.every((candidate) => candidate.x >= 0 && candidate.y >= 0),
    ).toBe(true);
    expect(
      candidates.every(
        (candidate) =>
          candidate.x + candidate.width <= imageData.width &&
          candidate.y + candidate.height <= imageData.height,
      ),
    ).toBe(true);
  });
});

function readFixtureImageData(fileName: string): ImageData {
  const png = PNG.sync.read(readFileSync(fixturePath(fileName)));
  return new TestImageData(
    Uint8ClampedArray.from(png.data),
    png.width,
    png.height,
  );
}

function fixturePath(fileName: string): string {
  return resolve("src/recognition/booster-expiry/__fixtures__", fileName);
}
