import type { PixelRegion } from "./pixelRegion";

export type PixelSize = {
  width: number;
  height: number;
};

export type FrameCoordinateSpace = "capture" | "game-viewport";

export type GameViewportVerificationStatus =
  | "unavailable"
  | "unverified"
  | "known-capture"
  | "user-confirmed"
  | "calibrated"
  | "stale";

export type GameViewportCalibration = {
  captureSize: PixelSize;
  gameResolution: PixelSize;
  region: PixelRegion;
  revision: number;
};

export type GameViewportCalibrationState =
  | {
      status: "legacy-passthrough";
      revision: number;
    }
  | {
      status: "calibrated";
      calibration: GameViewportCalibration;
    }
  | {
      status: "stale";
      calibration: GameViewportCalibration;
      captureSize: PixelSize | null;
    };

export type ResolvedGameViewport = {
  mode: "legacy-passthrough" | "calibrated";
  sourceSize: PixelSize;
  gameResolution: PixelSize;
  region: PixelRegion;
  layoutKey: string;
  revision: number;
};
