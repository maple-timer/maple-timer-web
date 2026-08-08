import { describe, expect, it } from "vitest";
import {
  findDarkTimerPanelCandidates,
  isMapleTimerPanelFragment,
  isMapleTimerPanelShape,
} from "./timerDarkPanelCandidates";
import type { ImageDataLike, Rect } from "./timerTypes";

const frameWidth = 320;
const frameHeight = 120;

describe("timer dark panel candidates", () => {
  it("finds centered dark Maple timer panel components", () => {
    const imageData = makeImage();
    paintRect(imageData, { x: 88, y: 24, width: 144, height: 32 }, [22, 22, 22]);
    paintRect(imageData, { x: 8, y: 80, width: 80, height: 20 }, [22, 22, 22]);

    expect(
      findDarkTimerPanelCandidates(imageData, fullFrameRoi(), {
        minRectWidth: 10,
        minRectHeight: 10,
      }),
    ).toEqual([{ x: 88, y: 24, width: 144, height: 32 }]);
  });

  it("ignores sparse dark components that do not have panel density", () => {
    const imageData = makeImage();
    for (let x = 88; x < 232; x += 3) {
      for (let y = 24; y < 56; y += 3) {
        paintPixel(imageData, x, y, [22, 22, 22]);
      }
    }

    expect(findDarkTimerPanelCandidates(imageData, fullFrameRoi())).toEqual([]);
  });

  it("classifies full timer panel shapes and partial fragments separately", () => {
    const imageData = makeImage();

    expect(
      isMapleTimerPanelShape(
        { x: 88, y: 24, width: 144, height: 32 },
        imageData,
      ),
    ).toBe(true);
    expect(
      isMapleTimerPanelShape(
        { x: 135, y: 24, width: 50, height: 38 },
        imageData,
      ),
    ).toBe(false);
    expect(
      isMapleTimerPanelFragment(
        { x: 135, y: 24, width: 50, height: 38 },
        imageData,
      ),
    ).toBe(true);
  });
});

function makeImage(): ImageDataLike {
  const imageData = {
    width: frameWidth,
    height: frameHeight,
    data: new Uint8ClampedArray(frameWidth * frameHeight * 4),
  };
  paintRect(imageData, fullFrameRoi(), [230, 230, 230]);
  return imageData;
}

function fullFrameRoi(): Rect {
  return { x: 0, y: 0, width: frameWidth, height: frameHeight };
}

function paintRect(
  imageData: ImageDataLike,
  rect: Rect,
  rgb: readonly [number, number, number],
): void {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      paintPixel(imageData, x, y, rgb);
    }
  }
}

function paintPixel(
  imageData: ImageDataLike,
  x: number,
  y: number,
  [red, green, blue]: readonly [number, number, number],
): void {
  const offset = (y * imageData.width + x) * 4;
  imageData.data[offset] = red;
  imageData.data[offset + 1] = green;
  imageData.data[offset + 2] = blue;
  imageData.data[offset + 3] = 255;
}
