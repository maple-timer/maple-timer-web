import type { PixelRegion } from "../../contracts/geometry/pixelRegion";

type KnownResolution = {
  key: string;
  width: number;
  height: number;
};

export type BuffExpiryFrameCalibration = {
  resolutionKey: string | null;
  gameRect: PixelRegion;
  sideCandidates: number[];
  unsupportedReason: string | null;
};

const KNOWN_RESOLUTIONS: KnownResolution[] = [
  { key: "1024x768", width: 1024, height: 768 },
  { key: "1280x720", width: 1280, height: 720 },
  { key: "1366x768", width: 1366, height: 768 },
  { key: "1920x1080", width: 1920, height: 1080 },
  { key: "1920x1200", width: 1920, height: 1200 },
  { key: "2560x1440", width: 2560, height: 1440 },
  { key: "2560x1600", width: 2560, height: 1600 },
  { key: "2732x1536", width: 2732, height: 1536 },
  { key: "3840x2160", width: 3840, height: 2160 },
];

const CALIBRATED_SIDES_BY_RESOLUTION: Record<string, number[]> = {
  "1024x768": [34],
  "1280x720": [34],
  "1366x768": [34],
  "1920x1080": [34, 47],
  "1920x1200": [34, 52],
  "2560x1440": [61, 66],
  "2560x1600": [66, 67],
  "2732x1536": [66],
  "3840x2160": [66, 89],
};

const MATCH_TOLERANCE_PX = 4;
const MAX_FRAME_WIDTH_EXTRA = 8;
const MIN_TITLEBAR_HEIGHT = 16;
const MAX_TITLEBAR_HEIGHT = 64;

export function getBuffExpiryFrameCalibration(width: number, height: number): BuffExpiryFrameCalibration {
  const resolution = matchKnownResolution(width, height);
  if (!resolution) {
    return {
      resolutionKey: null,
      gameRect: { x: 0, y: 0, width, height },
      sideCandidates: [],
      unsupportedReason: `지원하지 않는 해상도입니다: ${width}x${height}`,
    };
  }

  const horizontalExtra = Math.max(0, width - resolution.width);
  const verticalExtra = Math.max(0, height - resolution.height);
  const gameRect = {
    x: Math.floor(horizontalExtra / 2),
    y: verticalExtra,
    width: resolution.width,
    height: resolution.height,
  };

  return {
    resolutionKey: resolution.key,
    gameRect,
    sideCandidates: [...(CALIBRATED_SIDES_BY_RESOLUTION[resolution.key] ?? [])],
    unsupportedReason: null,
  };
}

export function getBuffExpiryCaptureRoi(width: number, height: number): {
  calibration: BuffExpiryFrameCalibration;
  roi: PixelRegion;
} {
  const calibration = getBuffExpiryFrameCalibration(width, height);
  const gameRect = calibration.gameRect;
  const roiX = gameRect.x + Math.floor(gameRect.width * 0.5);
  const roiY = gameRect.y;
  const roiWidth = gameRect.x + gameRect.width - roiX;
  const roiHeight = Math.floor(gameRect.height * 0.45);

  return {
    calibration,
    roi: {
      x: clamp(roiX, 0, Math.max(0, width - 1)),
      y: clamp(roiY, 0, Math.max(0, height - 1)),
      width: Math.max(1, Math.min(roiWidth, width - roiX)),
      height: Math.max(1, Math.min(roiHeight, height - roiY)),
    },
  };
}

function matchKnownResolution(width: number, height: number): KnownResolution | null {
  const matches = KNOWN_RESOLUTIONS.flatMap((resolution) => {
    if (width < resolution.width || height < resolution.height) {
      return [];
    }

    const widthExtra = width - resolution.width;
    if (widthExtra > MAX_FRAME_WIDTH_EXTRA) {
      return [];
    }

    const heightExtra = height - resolution.height;
    const validHeightExtra =
      Math.abs(heightExtra) <= MATCH_TOLERANCE_PX ||
      (heightExtra >= MIN_TITLEBAR_HEIGHT && heightExtra <= MAX_TITLEBAR_HEIGHT + MATCH_TOLERANCE_PX);
    if (!validHeightExtra) {
      return [];
    }

    const normalizedHeightExtra = Math.abs(heightExtra) <= MATCH_TOLERANCE_PX ? 0 : heightExtra;
    const heightDelta = normalizedHeightExtra === 0 ? Math.abs(heightExtra) : 0;

    return [
      {
        ...resolution,
        score: widthExtra * 2 + heightDelta + (normalizedHeightExtra > 0 ? 1 : 0),
        widthExtra,
        heightDelta,
      },
    ];
  });

  matches.sort((a, b) => a.score - b.score || a.widthExtra - b.widthExtra || a.heightDelta - b.heightDelta);
  return matches[0] && matches[0].heightDelta <= MATCH_TOLERANCE_PX ? matches[0] : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
