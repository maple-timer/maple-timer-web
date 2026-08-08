import { describe, expect, it } from "vitest";
import {
  findEdgeRectCandidates,
  makeSobelEdgeMask,
} from "./timerEdgeRectCandidates";
import type { ImageDataLike, Rect } from "./timerTypes";

describe("timer edge rect candidates", () => {
  it("builds a Sobel mask for hard red-channel edges inside the ROI", () => {
    const imageData = makeImage(40, 30);
    paintRect(imageData, { x: 10, y: 8, width: 18, height: 10 }, 255);
    const roi = { x: 0, y: 0, width: 40, height: 30 };
    const edgeMask = makeSobelEdgeMask(imageData, roi);

    expect(edgeMask.width).toBe(40);
    expect(edgeMask.height).toBe(30);
    expect(edgeMask.maxMagnitude).toBeGreaterThan(0);
    expect(edgeMask.data.some((value) => value > 0)).toBe(true);
  });

  it("creates rect candidates from matching horizontal and vertical edge runs", () => {
    const roi = { x: 5, y: 7, width: 120, height: 80 };
    const edgeMask = makeEmptyEdgeMask(roi.width, roi.height);
    drawHorizontal(edgeMask, 12, 18, 80);
    drawHorizontal(edgeMask, 44, 18, 80);
    drawVertical(edgeMask, 18, 12, 33);
    drawVertical(edgeMask, 97, 12, 33);

    expect(
      findEdgeRectCandidates(edgeMask, roi, {
        minRectWidth: 20,
        minRectHeight: 10,
      }),
    ).toEqual([{ x: 23, y: 19, width: 80, height: 33 }]);
  });

  it("drops rects that are contained by a larger candidate", () => {
    const roi = { x: 0, y: 0, width: 120, height: 80 };
    const edgeMask = makeEmptyEdgeMask(roi.width, roi.height);
    drawCandidateEdges(edgeMask, { x: 10, y: 10, width: 80, height: 40 });
    drawCandidateEdges(edgeMask, { x: 20, y: 20, width: 30, height: 14 });

    expect(
      findEdgeRectCandidates(edgeMask, roi, {
        minRectWidth: 10,
        minRectHeight: 10,
      }),
    ).toEqual([{ x: 10, y: 10, width: 80, height: 40 }]);
  });
});

function makeImage(width: number, height: number): ImageDataLike {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}

function paintRect(imageData: ImageDataLike, rect: Rect, red: number): void {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const offset = (y * imageData.width + x) * 4;
      imageData.data[offset] = red;
      imageData.data[offset + 1] = red;
      imageData.data[offset + 2] = red;
      imageData.data[offset + 3] = 255;
    }
  }
}

function makeEmptyEdgeMask(
  width: number,
  height: number,
): { width: number; height: number; data: Uint8Array } {
  return { width, height, data: new Uint8Array(width * height) };
}

function drawCandidateEdges(
  edgeMask: { width: number; height: number; data: Uint8Array },
  rect: Rect,
): void {
  drawHorizontal(edgeMask, rect.y, rect.x, rect.width);
  drawHorizontal(edgeMask, rect.y + rect.height - 1, rect.x, rect.width);
  drawVertical(edgeMask, rect.x, rect.y, rect.height);
  drawVertical(edgeMask, rect.x + rect.width - 1, rect.y, rect.height);
}

function drawHorizontal(
  edgeMask: { width: number; height: number; data: Uint8Array },
  y: number,
  x: number,
  width: number,
): void {
  for (let offsetX = 0; offsetX < width; offsetX += 1) {
    edgeMask.data[y * edgeMask.width + x + offsetX] = 1;
  }
}

function drawVertical(
  edgeMask: { width: number; height: number; data: Uint8Array },
  x: number,
  y: number,
  height: number,
): void {
  for (let offsetY = 0; offsetY < height; offsetY += 1) {
    edgeMask.data[(y + offsetY) * edgeMask.width + x] = 1;
  }
}
