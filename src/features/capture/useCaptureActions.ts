import { useCallback, useEffect, useRef } from "react";
import type { CaptureStatus } from "../../captureTypes";
import {
  trackCaptureLayoutObserved,
  trackScreenShareFailed,
  trackScreenShareStart,
  trackScreenShareSuccess,
} from "../../lib/analyticsEvents";
import { getLikelyGameViewportCrop } from "../../lib/gameResolutions";
import { ensureCurrentRuntimeBeforeAction } from "../../platform/runtime-assets/browserRuntimeAssetHealth";
import { getCaptureSurface } from "./gameViewportSetupRecommendation";

type CaptureSize = {
  width: number;
  height: number;
};

export function useCaptureActions({
  captureStatus,
  captureSize,
  stream,
  startCapture,
  changeCapture,
}: {
  captureStatus: CaptureStatus;
  captureSize: CaptureSize | null;
  stream: MediaStream | null;
  startCapture: () => Promise<void>;
  changeCapture: () => Promise<void>;
}) {
  const previousCaptureStatusRef = useRef<CaptureStatus>("idle");
  const observedLayoutStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const previousStatus = previousCaptureStatusRef.current;
    if (previousStatus === captureStatus) {
      return;
    }

    if (captureStatus === "active") {
      trackScreenShareSuccess();
    } else if (previousStatus === "starting" && captureStatus === "idle") {
      trackScreenShareFailed();
    }

    previousCaptureStatusRef.current = captureStatus;
  }, [captureStatus]);

  useEffect(() => {
    if (!stream || !captureSize || observedLayoutStreamRef.current === stream) {
      return;
    }

    const gameViewport = getLikelyGameViewportCrop(captureSize);
    observedLayoutStreamRef.current = stream;
    trackCaptureLayoutObserved({
      captureResolution: `${captureSize.width}x${captureSize.height}`,
      captureSurface: getCaptureSurface(stream),
      captureMatch: gameViewport
        ? gameViewport.isCropped
          ? "known_window_chrome"
          : "known_exact"
        : "unknown",
      gameResolution: gameViewport
        ? `${gameViewport.game.width}x${gameViewport.game.height}`
        : "unknown",
    });
  }, [captureSize, stream]);

  const startCaptureWithAnalytics = useCallback(async () => {
    if (!(await ensureCurrentRuntimeBeforeAction("capture-start"))) {
      return;
    }
    trackScreenShareStart("start");
    await startCapture();
  }, [startCapture]);

  const changeCaptureWithAnalytics = useCallback(async () => {
    if (!(await ensureCurrentRuntimeBeforeAction("capture-change"))) {
      return;
    }
    trackScreenShareStart("change");
    await changeCapture();
  }, [changeCapture]);

  return {
    startCaptureWithAnalytics,
    changeCaptureWithAnalytics,
  };
}
