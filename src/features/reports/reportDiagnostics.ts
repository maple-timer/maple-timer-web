import type {
  FrameCoordinateSpace,
} from "../../contracts/geometry/frameSource";
import type {
  ReportFrameSourceContext,
  ReportFrameSourceDiagnostics,
} from "../../contracts/reporting/frameSourceDiagnostics";
export {
  createLegacyReportFrameSourceContext,
  type ReportFrameSourceContext,
} from "../../contracts/reporting/frameSourceDiagnostics";
import { getFullCapturePixelRegion } from "../../lib/gameViewport";
import { captureSizeToLayoutKey } from "../../lib/regions";
import { getRuntimeAssetHealthReportSnapshot } from "../../platform/runtime-assets/browserRuntimeAssetHealth";
import type { CaptureDiagnostics } from "./alertReportPayloadShared";

export function getVideoLayoutKey(
  video: HTMLVideoElement | null,
  fallbackLayoutKey: string | null,
): string | null {
  return video?.videoWidth && video.videoHeight
    ? captureSizeToLayoutKey({ width: video.videoWidth, height: video.videoHeight })
    : fallbackLayoutKey;
}

export function getCaptureDiagnostics(
  video: HTMLVideoElement | null,
  context: ReportFrameSourceContext,
  coordinateSpace: FrameCoordinateSpace,
  frameLayoutKey?: string | null,
): CaptureDiagnostics {
  const size =
    video?.videoWidth && video.videoHeight
      ? { width: video.videoWidth, height: video.videoHeight }
      : null;
  const captureLayoutKey = getVideoLayoutKey(video, context.captureLayoutKey);

  return {
    hasStream: Boolean(size),
    size,
    layoutKey: captureLayoutKey,
    frameSource: createReportFrameSourceDiagnostics({
      context,
      coordinateSpace,
      frameLayoutKey:
        frameLayoutKey ??
        (coordinateSpace === "game-viewport"
          ? context.gameLayoutKey
          : captureLayoutKey),
      liveCaptureSize: size,
    }),
  };
}

export function createReportFrameSourceDiagnostics({
  context,
  coordinateSpace,
  frameLayoutKey,
  liveCaptureSize,
}: {
  context: ReportFrameSourceContext;
  coordinateSpace: FrameCoordinateSpace;
  frameLayoutKey: string | null;
  liveCaptureSize: { width: number; height: number } | null;
}): ReportFrameSourceDiagnostics {
  const state = context.gameViewportState;
  if (state.status === "legacy-passthrough") {
    const viewport = context.gameViewport;
    const captureSize = viewport?.sourceSize ?? liveCaptureSize;
    return {
      coordinateSpace,
      layoutKey: frameLayoutKey,
      gameViewport: {
        state: "legacy-passthrough",
        captureSize,
        region:
          viewport?.region ??
          (captureSize ? getFullCapturePixelRegion(captureSize) : null),
        gameResolution: viewport?.gameResolution ?? captureSize,
        revision: state.revision,
        ...(context.gameViewportVerification
          ? { verification: context.gameViewportVerification }
          : {}),
      },
    };
  }

  const calibration = state.calibration;
  return {
    coordinateSpace,
    layoutKey: frameLayoutKey,
    gameViewport: {
      state: state.status,
      captureSize: calibration.captureSize,
      region: calibration.region,
      gameResolution: calibration.gameResolution,
      revision: calibration.revision,
      ...(context.gameViewportVerification
        ? { verification: context.gameViewportVerification }
        : {}),
    },
  };
}

export function getViewportDiagnostics() {
  return {
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    runtimeAssets: getRuntimeAssetHealthReportSnapshot(),
  };
}
