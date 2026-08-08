import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  processBoosterExpiryFrame,
  resetBoosterExpiryWorkerCore,
} from "./boosterExpiryWorkerCore";

class TestImageData implements ImageData {
  readonly colorSpace: PredefinedColorSpace = "srgb";

  constructor(
    public data: ImageDataArray,
    public width: number,
    public height: number,
  ) {}
}

describe("boosterExpiryWorkerCore", () => {
  beforeEach(() => {
    resetBoosterExpiryWorkerCore();
  });

  it("reads the booster timer crop without upscaling distortion", () => {
    const imageData = readFixtureImageData("booster-timer-67_46.png");
    const first = processBoosterExpiryFrame(imageData, 0);
    const second = processBoosterExpiryFrame(imageData, 1000);

    expect(first.rawTime?.text).toBe("67.46");
    expect(first.rawTime?.seconds).toBeCloseTo(67.46);
    expect(first.recognizerVersion).toBe("timer-catch-flow-v1");
    expect(first.timeRect.reason).toBe("ok");
    expect(first.timeRect.rect).toMatchObject({ x: 3, y: 6, width: 198, height: 48 });
    expect(second.flow.source).toBe("raw-lock");
    expect(second.flow.locked).toBe(true);
  });
});

function readFixtureImageData(fileName: string): ImageData {
  const png = PNG.sync.read(readFileSync(fixturePath(fileName)));
  return new TestImageData(Uint8ClampedArray.from(png.data), png.width, png.height);
}

function fixturePath(fileName: string): string {
  return resolve("src/recognition/booster-expiry/__fixtures__", fileName);
}
