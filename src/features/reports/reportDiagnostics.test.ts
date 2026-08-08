import { describe, expect, it } from "vitest";
import type { ReportFrameSourceContext } from "./reportDiagnostics";
import { getCaptureDiagnostics } from "./reportDiagnostics";

function createVideo(width: number, height: number): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "videoWidth", { value: width });
  Object.defineProperty(video, "videoHeight", { value: height });
  return video;
}

describe("getCaptureDiagnostics", () => {
  it("records legacy passthrough without changing the capture layout", () => {
    const video = createVideo(1368, 800);
    const context: ReportFrameSourceContext = {
      captureLayoutKey: "1368x800",
      gameLayoutKey: "1368x800",
      gameViewport: {
        mode: "legacy-passthrough",
        sourceSize: { width: 1368, height: 800 },
        gameResolution: { width: 1368, height: 800 },
        region: { x: 0, y: 0, width: 1368, height: 800 },
        layoutKey: "1368x800",
        revision: 2,
      },
      gameViewportState: {
        status: "legacy-passthrough",
        revision: 2,
      },
      gameViewportVerification: "user-confirmed",
    };

    expect(
      getCaptureDiagnostics(video, context, "capture"),
    ).toEqual({
      hasStream: true,
      size: { width: 1368, height: 800 },
      layoutKey: "1368x800",
      frameSource: {
        coordinateSpace: "capture",
        layoutKey: "1368x800",
        gameViewport: {
          state: "legacy-passthrough",
          captureSize: { width: 1368, height: 800 },
          region: { x: 0, y: 0, width: 1368, height: 800 },
          gameResolution: { width: 1368, height: 800 },
          revision: 2,
          verification: "user-confirmed",
        },
      },
    });
  });

  it("records the calibrated viewport used by fixed HUD recognition", () => {
    const video = createVideo(1920, 1080);
    const calibration = {
      captureSize: { width: 1920, height: 1080 },
      gameResolution: { width: 1366, height: 768 },
      region: { x: 277, y: 156, width: 1366, height: 768 },
      revision: 4,
    };
    const context: ReportFrameSourceContext = {
      captureLayoutKey: "1920x1080",
      gameLayoutKey: "game:1366x768",
      gameViewport: {
        mode: "calibrated",
        sourceSize: calibration.captureSize,
        gameResolution: calibration.gameResolution,
        region: calibration.region,
        layoutKey: "game:1366x768",
        revision: 4,
      },
      gameViewportState: {
        status: "calibrated",
        calibration,
      },
      gameViewportVerification: "calibrated",
    };

    expect(
      getCaptureDiagnostics(video, context, "game-viewport"),
    ).toMatchObject({
      size: { width: 1920, height: 1080 },
      layoutKey: "1920x1080",
      frameSource: {
        coordinateSpace: "game-viewport",
        layoutKey: "game:1366x768",
        gameViewport: {
          state: "calibrated",
          captureSize: { width: 1920, height: 1080 },
          region: { x: 277, y: 156, width: 1366, height: 768 },
          gameResolution: { width: 1366, height: 768 },
          revision: 4,
          verification: "calibrated",
        },
      },
    });
  });

  it("keeps stale calibration metadata while marking the frame source unavailable", () => {
    const calibration = {
      captureSize: { width: 1920, height: 1080 },
      gameResolution: { width: 1366, height: 768 },
      region: { x: 277, y: 156, width: 1366, height: 768 },
      revision: 5,
    };
    const context: ReportFrameSourceContext = {
      captureLayoutKey: "1600x900",
      gameLayoutKey: null,
      gameViewport: null,
      gameViewportState: {
        status: "stale",
        calibration,
        captureSize: { width: 1600, height: 900 },
      },
      gameViewportVerification: "stale",
    };

    expect(
      getCaptureDiagnostics(
        createVideo(1600, 900),
        context,
        "game-viewport",
      ).frameSource,
    ).toEqual({
      coordinateSpace: "game-viewport",
      layoutKey: null,
      gameViewport: {
        state: "stale",
        captureSize: { width: 1920, height: 1080 },
        region: { x: 277, y: 156, width: 1366, height: 768 },
        gameResolution: { width: 1366, height: 768 },
        revision: 5,
        verification: "stale",
      },
    });
  });
});
