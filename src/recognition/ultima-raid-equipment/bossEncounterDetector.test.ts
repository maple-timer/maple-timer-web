import { describe, expect, it } from "vitest";
import {
  detectUltimaRaidBossEncounter,
  isBossProgressPixel,
  isNormalProgressPixel,
} from "./bossEncounterDetector";

describe("bossEncounterDetector", () => {
  it("uses relative magenta and cyan colors instead of exact RGB values", () => {
    expect(isBossProgressPixel(244, 55, 124)).toBe(true);
    expect(isBossProgressPixel(210, 105, 145)).toBe(true);
    expect(isBossProgressPixel(60, 196, 214)).toBe(false);
    expect(isNormalProgressPixel(60, 196, 214)).toBe(true);
    expect(isNormalProgressPixel(244, 55, 124)).toBe(false);
  });

  it.each([
    { width: 390, height: 166 },
    { width: 780, height: 332 },
    { width: 975, height: 415 },
  ])(
    "detects the full magenta boss progress bar across scales",
    ({ width, height }) => {
      const image = createUltimaRaidImage(width, height);
      paintProgressBar(image, 0.31, [244, 55, 124, 255]);

      const result = detectUltimaRaidBossEncounter(image);

      expect(result.layoutValid).toBe(true);
      expect(result.progressState).toBe("boss");
      expect(result.bossBarDetected).toBe(true);
      expect(result.bossBarWidthRatio).toBeGreaterThan(0.29);
    },
  );

  it("classifies the ordinary cyan progress bar as a confirmed normal state", () => {
    const image = createUltimaRaidImage(390, 166);
    paintProgressBar(image, 0.24, [60, 196, 214, 255]);

    const result = detectUltimaRaidBossEncounter(image);

    expect(result.progressState).toBe("normal");
    expect(result.normalBarDetected).toBe(true);
    expect(result.bossBarDetected).toBe(false);
  });

  it("does not treat the reused magenta top banner as a boss", () => {
    const image = createUltimaRaidImage(390, 166);
    paintRelativeRect(image, 0.23, 0.045, 0.54, 0.11, [
      244,
      55,
      124,
      255,
    ]);
    paintProgressBar(image, 0.24, [60, 196, 214, 255]);

    const result = detectUltimaRaidBossEncounter(image);

    expect(result.progressState).toBe("normal");
    expect(result.bossBarDetected).toBe(false);
  });

  it("keeps an obscured or transition frame unreadable instead of treating it as normal", () => {
    const image = createUltimaRaidImage(390, 166);
    paintRelativeRect(image, 0.45, 0.84, 0.02, 0.05, [
      244,
      55,
      124,
      255,
    ]);

    const result = detectUltimaRaidBossEncounter(image);

    expect(result.progressState).toBe("unreadable");
    expect(result.bossBarDetected).toBe(false);
    expect(result.normalBarDetected).toBe(false);
  });

  it("rejects a crop that is not the full Ultima Squad layout", () => {
    const image = createUltimaRaidImage(80, 100);
    paintRelativeRect(image, 0.37, 0.82, 0.31, 0.06, [
      244,
      55,
      124,
      255,
    ]);

    const result = detectUltimaRaidBossEncounter(image);

    expect(result.layoutValid).toBe(false);
    expect(result.progressState).toBe("unreadable");
  });
});

function createUltimaRaidImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set([54, 84, 92, 255], offset);
  }
  return {
    width,
    height,
    colorSpace: "srgb",
    data,
  } as ImageData;
}

function paintProgressBar(
  image: ImageData,
  width: number,
  color: readonly [number, number, number, number],
) {
  paintRelativeRect(image, 0.39, 0.845, width, 0.065, color);
}

function paintRelativeRect(
  image: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  color: readonly [number, number, number, number],
) {
  const left = Math.floor(image.width * x);
  const top = Math.floor(image.height * y);
  const right = Math.ceil(image.width * (x + width));
  const bottom = Math.ceil(image.height * (y + height));

  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      image.data.set(color, (row * image.width + column) * 4);
    }
  }
}
