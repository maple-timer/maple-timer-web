import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { makeMapleTimeReadOptions } from "./timerFixedMapleTimeReader";
import { readMapleSegmentedDigits } from "./timerMapleSegmentedDigits";
import type { ImageDataLike } from "./timerTypes";

class TestImageData implements ImageData {
  readonly colorSpace: PredefinedColorSpace = "srgb";

  constructor(
    public data: ImageDataArray,
    public width: number,
    public height: number,
  ) {}
}

describe("timer Maple segmented digits", () => {
  it("returns the raw segmented failure for a known decimal timer crop", () => {
    const imageData = readFixtureImageData("booster-timer-67_46.png");

    const result = readMapleSegmentedDigits(
      imageData,
      {
        x: 3,
        y: 6,
        width: 198,
        height: 48,
      },
      makeMapleTimeReadOptions({}),
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "unknown-digit-mask",
      rect: { x: 3, y: 6, width: 198, height: 48 },
      digits: [6],
      seconds: null,
      text: null,
    });
    expect(result.digitResults).toHaveLength(2);
    expect(result.digitResults[0]).toMatchObject({ ok: true, digit: 6 });
    expect(result.digitResults[1]).toMatchObject({
      ok: true,
      digit: null,
    });
  });

  it("reports invalid and blank segmented timer crops without formatting", () => {
    const imageData = makeBlankImage(198, 48);

    expect(
      readMapleSegmentedDigits(imageData, { x: 200, y: 0, width: 20, height: 20 }),
    ).toMatchObject({
      ok: false,
      reason: "invalid-rect",
      rect: null,
      seconds: null,
      text: null,
    });
    expect(
      readMapleSegmentedDigits(imageData, { x: 0, y: 0, width: 198, height: 48 }),
    ).toMatchObject({
      ok: false,
      reason: "not-enough-digits",
      rect: { x: 0, y: 0, width: 198, height: 48 },
      digits: [],
      digitResults: [],
      seconds: null,
      text: null,
    });
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

function makeBlankImage(width: number, height: number): ImageDataLike {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}
