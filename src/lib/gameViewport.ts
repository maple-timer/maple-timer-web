import type {
  GameViewportCalibration,
  GameViewportCalibrationState,
  PixelSize,
  ResolvedGameViewport,
} from "../contracts/geometry/frameSource";
import type { PixelRegion } from "../contracts/geometry/pixelRegion";
import type { RelativeRegion } from "../types";
import { KNOWN_GAME_RESOLUTIONS } from "./gameResolutions";
import { pixelsToRegion, regionToPixels } from "./regions";

export function isSamePixelSize(left: PixelSize | null, right: PixelSize | null): boolean {
  return Boolean(
    left &&
      right &&
      left.width === right.width &&
      left.height === right.height,
  );
}

export function getGameViewportLayoutKey(gameResolution: PixelSize): string {
  return `game:${Math.round(gameResolution.width)}x${Math.round(gameResolution.height)}`;
}

export function isGameViewportLayoutKey(
  layoutKey: string | null | undefined,
): boolean {
  return typeof layoutKey === "string" && layoutKey.startsWith("game:");
}

export function getGameViewportStateRevision(
  state: GameViewportCalibrationState,
): number {
  return state.status === "legacy-passthrough"
    ? state.revision
    : state.calibration.revision;
}

export function getFullCapturePixelRegion(captureSize: PixelSize): PixelRegion {
  return {
    x: 0,
    y: 0,
    width: Math.max(1, Math.round(captureSize.width)),
    height: Math.max(1, Math.round(captureSize.height)),
  };
}

export function getSuggestedGameResolution(captureSize: PixelSize): PixelSize {
  const candidates = KNOWN_GAME_RESOLUTIONS.filter(
    (resolution) =>
      resolution.width <= captureSize.width &&
      resolution.height <= captureSize.height,
  )
    .map((resolution) => ({
      resolution,
      unusedArea:
        captureSize.width * captureSize.height -
        resolution.width * resolution.height,
      edgeDelta:
        captureSize.width -
        resolution.width +
        captureSize.height -
        resolution.height,
    }))
    .sort(
      (left, right) =>
        left.unusedArea - right.unusedArea ||
        left.edgeDelta - right.edgeDelta,
    );

  const selected =
    candidates[0]?.resolution ??
    KNOWN_GAME_RESOLUTIONS.reduce((closest, resolution) => {
      const closestScale = Math.min(
        captureSize.width / closest.width,
        captureSize.height / closest.height,
      );
      const resolutionScale = Math.min(
        captureSize.width / resolution.width,
        captureSize.height / resolution.height,
      );
      return resolutionScale > closestScale ? resolution : closest;
    });

  return { width: selected.width, height: selected.height };
}

export function getInitialGameViewportRegion(
  captureSize: PixelSize,
  gameResolution: PixelSize,
): RelativeRegion {
  const captureWidth = Math.max(1, Math.round(captureSize.width));
  const captureHeight = Math.max(1, Math.round(captureSize.height));
  const resolutionWidth = Math.max(1, Math.round(gameResolution.width));
  const resolutionHeight = Math.max(1, Math.round(gameResolution.height));
  const scale = Math.min(
    1,
    captureWidth / resolutionWidth,
    captureHeight / resolutionHeight,
  );
  const width = Math.max(1, Math.round(resolutionWidth * scale));
  const height = Math.max(1, Math.round(resolutionHeight * scale));
  const widthExtra = captureWidth - width;
  const heightExtra = captureHeight - height;
  const isOrdinaryWindowWrapper = widthExtra <= 16 && heightExtra <= 180;
  const pixelRegion = {
    x: Math.round(widthExtra / 2),
    y: isOrdinaryWindowWrapper ? heightExtra : Math.round(heightExtra / 2),
    width,
    height,
  };

  return pixelsToRegion(pixelRegion, captureWidth, captureHeight);
}

export function createGameViewportCalibration({
  captureSize,
  gameResolution,
  region,
  revision,
}: {
  captureSize: PixelSize;
  gameResolution: PixelSize;
  region: RelativeRegion;
  revision: number;
}): GameViewportCalibration {
  return {
    captureSize: {
      width: Math.max(1, Math.round(captureSize.width)),
      height: Math.max(1, Math.round(captureSize.height)),
    },
    gameResolution: {
      width: Math.max(1, Math.round(gameResolution.width)),
      height: Math.max(1, Math.round(gameResolution.height)),
    },
    region: regionToPixels(region, captureSize.width, captureSize.height),
    revision,
  };
}

export function isGameViewportCalibrationCurrent(
  calibration: GameViewportCalibration,
  captureSize: PixelSize | null,
): boolean {
  return isSamePixelSize(calibration.captureSize, captureSize);
}

export function resolveGameViewport(
  state: GameViewportCalibrationState,
  captureSize: PixelSize | null,
): ResolvedGameViewport | null {
  if (!captureSize?.width || !captureSize.height) {
    return null;
  }

  if (state.status === "stale") {
    return null;
  }

  if (state.status === "calibrated") {
    if (!isGameViewportCalibrationCurrent(state.calibration, captureSize)) {
      return null;
    }

    return {
      mode: "calibrated",
      sourceSize: state.calibration.captureSize,
      gameResolution: state.calibration.gameResolution,
      region: state.calibration.region,
      layoutKey: getGameViewportLayoutKey(state.calibration.gameResolution),
      revision: state.calibration.revision,
    };
  }

  return {
    mode: "legacy-passthrough",
    sourceSize: captureSize,
    gameResolution: captureSize,
    region: getFullCapturePixelRegion(captureSize),
    layoutKey: `${Math.round(captureSize.width)}x${Math.round(captureSize.height)}`,
    revision: state.revision,
  };
}

export function mapViewportRelativeRegionToCapturePixels(
  region: RelativeRegion,
  viewport: ResolvedGameViewport,
): PixelRegion {
  const local = regionToPixels(region, viewport.region.width, viewport.region.height);
  return {
    x: viewport.region.x + local.x,
    y: viewport.region.y + local.y,
    width: local.width,
    height: local.height,
  };
}

export function mapCaptureRelativeRegionToViewport(
  region: RelativeRegion,
  captureSize: PixelSize,
  viewport: PixelRegion,
): RelativeRegion | null {
  const captured = regionToPixels(region, captureSize.width, captureSize.height);
  const capturedRight = captured.x + captured.width;
  const capturedBottom = captured.y + captured.height;
  const viewportRight = viewport.x + viewport.width;
  const viewportBottom = viewport.y + viewport.height;

  if (
    captured.x < viewport.x ||
    captured.y < viewport.y ||
    capturedRight > viewportRight ||
    capturedBottom > viewportBottom
  ) {
    return null;
  }

  return pixelsToRegion(
    {
      x: captured.x - viewport.x,
      y: captured.y - viewport.y,
      width: captured.width,
      height: captured.height,
    },
    viewport.width,
    viewport.height,
  );
}
