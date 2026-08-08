import { describe, expect, it } from "vitest";
import {
  createGameViewportCalibration,
  getGameViewportStateRevision,
  getInitialGameViewportRegion,
  getSuggestedGameResolution,
  mapCaptureRelativeRegionToViewport,
  mapViewportRelativeRegionToCapturePixels,
  resolveGameViewport,
} from "./gameViewport";

describe("gameViewport", () => {
  it("keeps one monotonic revision across every calibration state", () => {
    const calibration = createGameViewportCalibration({
      captureSize: { width: 1766, height: 968 },
      gameResolution: { width: 1366, height: 768 },
      region: { x: 0.1, y: 0.1, width: 0.7, height: 0.7 },
      revision: 3,
    });

    expect(
      getGameViewportStateRevision({
        status: "legacy-passthrough",
        revision: 2,
      }),
    ).toBe(2);
    expect(
      getGameViewportStateRevision({
        status: "calibrated",
        calibration,
      }),
    ).toBe(3);
    expect(
      getGameViewportStateRevision({
        status: "stale",
        calibration: { ...calibration, revision: 4 },
        captureSize: { width: 1800, height: 968 },
      }),
    ).toBe(4);
  });

  it("keeps the legacy path as a full-capture passthrough", () => {
    expect(
      resolveGameViewport(
        { status: "legacy-passthrough", revision: 0 },
        { width: 1368, height: 800 },
      ),
    ).toEqual({
      mode: "legacy-passthrough",
      sourceSize: { width: 1368, height: 800 },
      gameResolution: { width: 1368, height: 800 },
      region: { x: 0, y: 0, width: 1368, height: 800 },
      layoutKey: "1368x800",
      revision: 0,
    });
  });

  it("suggests the current bottom-aligned wrapper crop for ordinary windows", () => {
    const region = getInitialGameViewportRegion(
      { width: 1368, height: 800 },
      { width: 1366, height: 768 },
    );

    expect(region).toEqual({
      x: 1 / 1368,
      y: 32 / 800,
      width: 1366 / 1368,
      height: 768 / 800,
    });
  });

  it("suggests the largest fitting canonical game viewport", () => {
    expect(
      getSuggestedGameResolution({ width: 1766, height: 968 }),
    ).toEqual({ width: 1366, height: 768 });
    expect(
      getSuggestedGameResolution({ width: 1922, height: 1112 }),
    ).toEqual({ width: 1920, height: 1080 });
  });

  it("centers a game-resolution suggestion inside a larger expanded capture", () => {
    const region = getInitialGameViewportRegion(
      { width: 1766, height: 968 },
      { width: 1366, height: 768 },
    );

    expect(region).toEqual({
      x: 200 / 1766,
      y: 100 / 968,
      width: 1366 / 1766,
      height: 768 / 968,
    });
  });

  it("maps a game-relative crop into capture pixels", () => {
    const calibration = createGameViewportCalibration({
      captureSize: { width: 1766, height: 968 },
      gameResolution: { width: 1366, height: 768 },
      region: {
        x: 200 / 1766,
        y: 100 / 968,
        width: 1366 / 1766,
        height: 768 / 968,
      },
      revision: 2,
    });
    const viewport = resolveGameViewport(
      { status: "calibrated", calibration },
      calibration.captureSize,
    );

    expect(viewport).not.toBeNull();
    expect(
      mapViewportRelativeRegionToCapturePixels(
        { x: 0.5, y: 0.75, width: 0.1, height: 0.1 },
        viewport!,
      ),
    ).toEqual({
      x: 883,
      y: 676,
      width: 137,
      height: 77,
    });
  });

  it.each([
    {
      name: "left expansion",
      captureSize: { width: 1606, height: 768 },
      viewport: { x: 240, y: 0, width: 1366, height: 768 },
    },
    {
      name: "right expansion",
      captureSize: { width: 1606, height: 768 },
      viewport: { x: 0, y: 0, width: 1366, height: 768 },
    },
    {
      name: "bottom expansion",
      captureSize: { width: 1366, height: 968 },
      viewport: { x: 0, y: 0, width: 1366, height: 768 },
    },
    {
      name: "left, right, and bottom expansion",
      captureSize: { width: 1766, height: 968 },
      viewport: { x: 190, y: 48, width: 1366, height: 768 },
    },
  ])(
    "maps fixed-HUD crops inside $name without assuming an outer edge",
    ({ captureSize, viewport }) => {
      const calibration = createGameViewportCalibration({
        captureSize,
        gameResolution: { width: 1366, height: 768 },
        region: {
          x: viewport.x / captureSize.width,
          y: viewport.y / captureSize.height,
          width: viewport.width / captureSize.width,
          height: viewport.height / captureSize.height,
        },
        revision: 2,
      });
      const resolved = resolveGameViewport(
        { status: "calibrated", calibration },
        captureSize,
      );

      expect(resolved).not.toBeNull();
      expect(
        mapViewportRelativeRegionToCapturePixels(
          { x: 0.8, y: 0.75, width: 0.1, height: 0.1 },
          resolved!,
        ),
      ).toEqual({
        x: viewport.x + 1093,
        y: viewport.y + 576,
        width: 137,
        height: 77,
      });
    },
  );

  it("converts an existing capture crop only when it is inside the viewport", () => {
    expect(
      mapCaptureRelativeRegionToViewport(
        { x: 0.5, y: 0.5, width: 0.1, height: 0.1 },
        { width: 1766, height: 968 },
        { x: 200, y: 100, width: 1366, height: 768 },
      ),
    ).not.toBeNull();
    expect(
      mapCaptureRelativeRegionToViewport(
        { x: 0.01, y: 0.01, width: 0.1, height: 0.1 },
        { width: 1766, height: 968 },
        { x: 200, y: 100, width: 1366, height: 768 },
      ),
    ).toBeNull();
  });

  it("rejects a calibrated viewport after the capture dimensions change", () => {
    const calibration = createGameViewportCalibration({
      captureSize: { width: 1766, height: 968 },
      gameResolution: { width: 1366, height: 768 },
      region: { x: 0.1, y: 0.1, width: 0.7, height: 0.7 },
      revision: 1,
    });

    expect(
      resolveGameViewport(
        { status: "calibrated", calibration },
        { width: 1800, height: 968 },
      ),
    ).toBeNull();
  });
});
