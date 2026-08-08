import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGameViewportCalibrationController } from "./useGameViewportCalibrationController";

function createStream(displaySurface: MediaTrackSettings["displaySurface"]): MediaStream {
  return {
    getVideoTracks: () => [
      {
        getSettings: () => ({ displaySurface }),
      },
    ],
  } as unknown as MediaStream;
}

describe("useGameViewportCalibrationController", () => {
  it("starts on the unchanged full-capture path", () => {
    const stream = {} as MediaStream;
    const { result } = renderHook(() =>
      useGameViewportCalibrationController({
        stream,
        captureSize: { width: 1368, height: 800 },
      }),
    );

    expect(result.current.state.status).toBe("legacy-passthrough");
    expect(result.current.verificationStatus).toBe("known-capture");
    expect(result.current.resolvedViewport?.region).toEqual({
      x: 0,
      y: 0,
      width: 1368,
      height: 800,
    });
  });

  it("keeps an explicit calibration only for the current dimensions", () => {
    const stream = {} as MediaStream;
    const onCalibrationApplied = vi.fn();
    const { result, rerender } = renderHook(
      ({ captureSize }) =>
        useGameViewportCalibrationController({
          stream,
          captureSize,
          onCalibrationApplied,
        }),
      {
        initialProps: {
          captureSize: { width: 1766, height: 968 } as {
            width: number;
            height: number;
          },
        },
      },
    );

    act(() => {
      result.current.applyCalibration({
        gameResolution: { width: 1366, height: 768 },
        region: {
          x: 200 / 1766,
          y: 100 / 968,
          width: 1366 / 1766,
          height: 768 / 968,
        },
      });
    });

    expect(result.current.state.status).toBe("calibrated");
    expect(result.current.resolvedViewport?.layoutKey).toBe("game:1366x768");
    expect(onCalibrationApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        layoutKey: "game:1366x768",
        region: {
          x: 200,
          y: 100,
          width: 1366,
          height: 768,
        },
      }),
    );

    rerender({ captureSize: { width: 1800, height: 968 } });

    expect(result.current.state.status).toBe("stale");
    expect(result.current.resolvedViewport).toBeNull();
  });

  it("does not silently reuse calibration for a replacement stream", () => {
    const firstStream = {} as MediaStream;
    const secondStream = {} as MediaStream;
    const captureSize = { width: 1766, height: 968 };
    const { result, rerender } = renderHook(
      ({ stream }) =>
        useGameViewportCalibrationController({
          stream,
          captureSize,
        }),
      { initialProps: { stream: firstStream } },
    );

    act(() => {
      result.current.applyCalibration({
        gameResolution: { width: 1366, height: 768 },
        region: { x: 0.1, y: 0.1, width: 0.7, height: 0.7 },
      });
    });
    rerender({ stream: secondStream });

    expect(result.current.state.status).toBe("legacy-passthrough");
    expect(result.current.verificationStatus).toBe("unverified");
    expect(result.current.resolvedViewport).toBeNull();
  });

  it("increments the revision when the same capture is manually recalibrated", () => {
    const stream = {} as MediaStream;
    const captureSize = { width: 1766, height: 968 };
    const { result } = renderHook(() =>
      useGameViewportCalibrationController({
        stream,
        captureSize,
      }),
    );

    act(() => {
      result.current.applyCalibration({
        gameResolution: { width: 1366, height: 768 },
        region: {
          x: 200 / 1766,
          y: 100 / 968,
          width: 1366 / 1766,
          height: 768 / 968,
        },
      });
    });
    const firstRevision = result.current.resolvedViewport?.revision;

    act(() => {
      result.current.applyCalibration({
        gameResolution: { width: 1366, height: 768 },
        region: {
          x: 190 / 1766,
          y: 48 / 968,
          width: 1366 / 1766,
          height: 768 / 968,
        },
      });
    });

    expect(result.current.resolvedViewport).toMatchObject({
      mode: "calibrated",
      region: { x: 190, y: 48, width: 1366, height: 768 },
      revision: (firstRevision ?? 0) + 1,
    });
  });

  it("remembers an explicit full-capture choice only for the current stream", () => {
    const firstStream = createStream("monitor");
    const secondStream = createStream("monitor");
    const captureSize = { width: 1920, height: 1080 };
    const { result, rerender } = renderHook(
      ({ stream }) =>
        useGameViewportCalibrationController({
          stream,
          captureSize,
        }),
      { initialProps: { stream: firstStream } },
    );

    expect(result.current.isSetupRecommended).toBe(true);
    expect(result.current.verificationStatus).toBe("unverified");
    expect(result.current.resolvedViewport).toBeNull();
    const initialRevision =
      result.current.state.status === "legacy-passthrough"
        ? result.current.state.revision
        : 0;

    act(() => {
      result.current.useLegacyPassthrough();
    });

    expect(result.current.isSetupRecommended).toBe(false);
    expect(result.current.verificationStatus).toBe("user-confirmed");
    expect(result.current.resolvedViewport?.revision).toBe(initialRevision + 1);

    rerender({ stream: secondStream });

    expect(result.current.isSetupRecommended).toBe(true);
    expect(result.current.verificationStatus).toBe("unverified");
    expect(result.current.resolvedViewport).toBeNull();
  });

  it("requires another decision when the current stream dimensions change", () => {
    const stream = createStream("monitor");
    const { result, rerender } = renderHook(
      ({ captureSize }) =>
        useGameViewportCalibrationController({
          stream,
          captureSize,
        }),
      {
        initialProps: {
          captureSize: { width: 1920, height: 1080 } as {
            width: number;
            height: number;
          },
        },
      },
    );

    act(() => {
      result.current.useLegacyPassthrough();
    });
    expect(result.current.verificationStatus).toBe("user-confirmed");

    rerender({ captureSize: { width: 2560, height: 1440 } });

    expect(result.current.verificationStatus).toBe("unverified");
    expect(result.current.resolvedViewport).toBeNull();
  });
});
