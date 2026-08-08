import { describe, expect, it } from "vitest";
import {
  clampGameViewportEditorPan,
  clampGameViewportEditorZoom,
  zoomGameViewportEditorAtPoint,
} from "./useGameViewportEditorView";

describe("game viewport editor view", () => {
  it("keeps zoom inside the supported precision range", () => {
    expect(clampGameViewportEditorZoom(0.5)).toBe(1);
    expect(clampGameViewportEditorZoom(2.5)).toBe(2.5);
    expect(clampGameViewportEditorZoom(8)).toBe(4);
  });

  it("keeps the source point under the cursor while zooming", () => {
    const viewportSize = { width: 1000, height: 600 };
    const focalPoint = { x: 760, y: 180 };
    const before = {
      zoom: 1.5,
      pan: { x: 90, y: -45 },
    };
    const after = zoomGameViewportEditorAtPoint(
      before,
      2.25,
      viewportSize,
      focalPoint,
    );
    const sourcePointBefore = {
      x:
        (focalPoint.x - viewportSize.width / 2 - before.pan.x) /
        before.zoom,
      y:
        (focalPoint.y - viewportSize.height / 2 - before.pan.y) /
        before.zoom,
    };
    const sourcePointAfter = {
      x:
        (focalPoint.x - viewportSize.width / 2 - after.pan.x) /
        after.zoom,
      y:
        (focalPoint.y - viewportSize.height / 2 - after.pan.y) /
        after.zoom,
    };

    expect(sourcePointAfter.x).toBeCloseTo(sourcePointBefore.x, 8);
    expect(sourcePointAfter.y).toBeCloseTo(sourcePointBefore.y, 8);
  });

  it("keeps the enlarged scene covering the editor viewport", () => {
    expect(
      clampGameViewportEditorPan(
        { x: 900, y: -900 },
        2,
        { width: 800, height: 500 },
      ),
    ).toEqual({
      x: 400,
      y: -250,
    });
    expect(
      clampGameViewportEditorPan(
        { x: 30, y: -40 },
        1,
        { width: 800, height: 500 },
      ),
    ).toEqual({
      x: 0,
      y: 0,
    });
  });
});
