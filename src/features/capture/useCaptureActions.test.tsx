import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureStatus } from "../../captureTypes";
import {
  trackCaptureLayoutObserved,
  trackScreenShareFailed,
  trackScreenShareStart,
  trackScreenShareSuccess,
} from "../../lib/analyticsEvents";
import { ensureCurrentRuntimeBeforeAction } from "../../platform/runtime-assets/browserRuntimeAssetHealth";
import { useCaptureActions } from "./useCaptureActions";

vi.mock("../../lib/analyticsEvents", () => ({
  trackCaptureLayoutObserved: vi.fn(),
  trackScreenShareFailed: vi.fn(),
  trackScreenShareStart: vi.fn(),
  trackScreenShareSuccess: vi.fn(),
}));

vi.mock("../../platform/runtime-assets/browserRuntimeAssetHealth", () => ({
  ensureCurrentRuntimeBeforeAction: vi.fn(),
}));

const trackCaptureLayoutObservedMock = vi.mocked(trackCaptureLayoutObserved);
const trackScreenShareFailedMock = vi.mocked(trackScreenShareFailed);
const trackScreenShareStartMock = vi.mocked(trackScreenShareStart);
const trackScreenShareSuccessMock = vi.mocked(trackScreenShareSuccess);
const ensureCurrentRuntimeBeforeActionMock = vi.mocked(ensureCurrentRuntimeBeforeAction);

function Harness({
  captureStatus,
  captureSize = null,
  stream = null,
  startCapture,
  changeCapture,
}: {
  captureStatus: CaptureStatus;
  captureSize?: { width: number; height: number } | null;
  stream?: MediaStream | null;
  startCapture: () => Promise<void>;
  changeCapture: () => Promise<void>;
}) {
  const { startCaptureWithAnalytics, changeCaptureWithAnalytics } = useCaptureActions({
    captureStatus,
    captureSize,
    stream,
    startCapture,
    changeCapture,
  });

  return (
    <>
      <button type="button" onClick={startCaptureWithAnalytics}>
        start
      </button>
      <button type="button" onClick={changeCaptureWithAnalytics}>
        change
      </button>
    </>
  );
}

describe("useCaptureActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureCurrentRuntimeBeforeActionMock.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it("checks the running build before explicit start and change capture actions", async () => {
    const startCapture = vi.fn().mockResolvedValue(undefined);
    const changeCapture = vi.fn().mockResolvedValue(undefined);
    render(
      <Harness
        captureStatus="idle"
        startCapture={startCapture}
        changeCapture={changeCapture}
      />,
    );

    await act(async () => {
      screen.getByText("start").click();
      screen.getByText("change").click();
    });

    expect(ensureCurrentRuntimeBeforeActionMock).toHaveBeenNthCalledWith(1, "capture-start");
    expect(ensureCurrentRuntimeBeforeActionMock).toHaveBeenNthCalledWith(2, "capture-change");
    expect(trackScreenShareStartMock).toHaveBeenNthCalledWith(1, "start");
    expect(trackScreenShareStartMock).toHaveBeenNthCalledWith(2, "change");
    expect(startCapture).toHaveBeenCalledTimes(1);
    expect(changeCapture).toHaveBeenCalledTimes(1);
  });

  it("does not start capture while a newer build is waiting to be applied", async () => {
    ensureCurrentRuntimeBeforeActionMock.mockResolvedValue(false);
    const startCapture = vi.fn().mockResolvedValue(undefined);
    const changeCapture = vi.fn().mockResolvedValue(undefined);
    render(
      <Harness
        captureStatus="idle"
        startCapture={startCapture}
        changeCapture={changeCapture}
      />,
    );

    await act(async () => {
      screen.getByText("start").click();
    });

    expect(trackScreenShareStartMock).not.toHaveBeenCalled();
    expect(startCapture).not.toHaveBeenCalled();
  });

  it("tracks success when capture status becomes active", () => {
    const startCapture = vi.fn().mockResolvedValue(undefined);
    const changeCapture = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <Harness
        captureStatus="idle"
        startCapture={startCapture}
        changeCapture={changeCapture}
      />,
    );

    act(() => {
      rerender(
        <Harness
          captureStatus="starting"
          startCapture={startCapture}
          changeCapture={changeCapture}
        />,
      );
    });
    act(() => {
      rerender(
        <Harness
          captureStatus="active"
          startCapture={startCapture}
          changeCapture={changeCapture}
        />,
      );
    });

    expect(trackScreenShareSuccessMock).toHaveBeenCalledTimes(1);
    expect(trackScreenShareFailedMock).not.toHaveBeenCalled();
  });

  it("tracks the first observed layout once per capture stream", () => {
    const startCapture = vi.fn().mockResolvedValue(undefined);
    const changeCapture = vi.fn().mockResolvedValue(undefined);
    const windowStream = {
      getVideoTracks: () => [
        {
          getSettings: () => ({ displaySurface: "window" }),
        },
      ],
    } as unknown as MediaStream;
    const monitorStream = {
      getVideoTracks: () => [
        {
          getSettings: () => ({ displaySurface: "monitor" }),
        },
      ],
    } as unknown as MediaStream;
    const { rerender } = render(
      <Harness
        captureStatus="active"
        stream={windowStream}
        startCapture={startCapture}
        changeCapture={changeCapture}
      />,
    );

    rerender(
      <Harness
        captureStatus="active"
        captureSize={{ width: 1922, height: 1112 }}
        stream={windowStream}
        startCapture={startCapture}
        changeCapture={changeCapture}
      />,
    );
    rerender(
      <Harness
        captureStatus="active"
        captureSize={{ width: 1922, height: 1118 }}
        stream={windowStream}
        startCapture={startCapture}
        changeCapture={changeCapture}
      />,
    );
    rerender(
      <Harness
        captureStatus="active"
        captureSize={{ width: 3000, height: 1800 }}
        stream={monitorStream}
        startCapture={startCapture}
        changeCapture={changeCapture}
      />,
    );

    expect(trackCaptureLayoutObservedMock).toHaveBeenNthCalledWith(1, {
      captureResolution: "1922x1112",
      captureSurface: "window",
      captureMatch: "known_window_chrome",
      gameResolution: "1920x1080",
    });
    expect(trackCaptureLayoutObservedMock).toHaveBeenNthCalledWith(2, {
      captureResolution: "3000x1800",
      captureSurface: "monitor",
      captureMatch: "unknown",
      gameResolution: "unknown",
    });
    expect(trackCaptureLayoutObservedMock).toHaveBeenCalledTimes(2);
  });

  it("tracks failure when starting returns to idle", () => {
    const startCapture = vi.fn().mockResolvedValue(undefined);
    const changeCapture = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <Harness
        captureStatus="idle"
        startCapture={startCapture}
        changeCapture={changeCapture}
      />,
    );

    act(() => {
      rerender(
        <Harness
          captureStatus="starting"
          startCapture={startCapture}
          changeCapture={changeCapture}
        />,
      );
    });
    act(() => {
      rerender(
        <Harness
          captureStatus="idle"
          startCapture={startCapture}
          changeCapture={changeCapture}
        />,
      );
    });

    expect(trackScreenShareFailedMock).toHaveBeenCalledTimes(1);
    expect(trackScreenShareSuccessMock).not.toHaveBeenCalled();
  });
});
