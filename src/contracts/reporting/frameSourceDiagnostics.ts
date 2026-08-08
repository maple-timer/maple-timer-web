import type {
  FrameCoordinateSpace,
  GameViewportCalibrationState,
  GameViewportVerificationStatus,
  PixelSize,
  ResolvedGameViewport,
} from "../geometry/frameSource";
import type { PixelRegion } from "../geometry/pixelRegion";

export type ReportGameViewportDiagnostics = {
  state: "legacy-passthrough" | "calibrated" | "stale";
  captureSize: PixelSize | null;
  region: PixelRegion | null;
  gameResolution: PixelSize | null;
  revision: number;
  verification?: GameViewportVerificationStatus;
};

export type ReportFrameSourceDiagnostics = {
  coordinateSpace: FrameCoordinateSpace;
  layoutKey: string | null;
  gameViewport: ReportGameViewportDiagnostics;
};

export type ReportFrameSourceContext = {
  captureLayoutKey: string | null;
  gameLayoutKey: string | null;
  gameViewport: ResolvedGameViewport | null;
  gameViewportState: GameViewportCalibrationState;
  gameViewportVerification?: GameViewportVerificationStatus;
};

export function createLegacyReportFrameSourceContext(
  layoutKey: string | null,
): ReportFrameSourceContext {
  return {
    captureLayoutKey: layoutKey,
    gameLayoutKey: layoutKey,
    gameViewport: null,
    gameViewportState: {
      status: "legacy-passthrough",
      revision: 0,
    },
  };
}
