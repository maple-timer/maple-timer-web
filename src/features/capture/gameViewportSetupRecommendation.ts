import type { CaptureSize } from "../../lib/gameResolutions";
import { getLikelyGameViewportCrop } from "../../lib/gameResolutions";

export type CaptureSurface = "browser" | "monitor" | "window" | "unknown";

export function getCaptureSurface(stream: MediaStream | null): CaptureSurface {
  if (!stream || typeof stream.getVideoTracks !== "function") {
    return "unknown";
  }

  try {
    const displaySurface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
    return displaySurface === "browser" ||
      displaySurface === "monitor" ||
      displaySurface === "window"
      ? displaySurface
      : "unknown";
  } catch {
    return "unknown";
  }
}

export function shouldRecommendGameViewportSetup({
  captureSize,
  stream,
}: {
  captureSize: CaptureSize | null;
  stream: MediaStream | null;
}): boolean {
  if (!stream || !captureSize) {
    return false;
  }

  if (getCaptureSurface(stream) === "monitor") {
    return true;
  }

  return getLikelyGameViewportCrop(captureSize) === null;
}
