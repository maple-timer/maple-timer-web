export type GameResolution = {
  width: number;
  height: number;
};

export type CaptureSize = {
  width: number;
  height: number;
};

export type GameViewportCrop = {
  source: CaptureSize;
  game: GameResolution;
  x: number;
  y: number;
  width: number;
  height: number;
  isCropped: boolean;
};

export const KNOWN_GAME_RESOLUTIONS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 1920, height: 1200 },
  { width: 2560, height: 1440 },
  { width: 2560, height: 1600 },
  { width: 2732, height: 1536 },
  { width: 3840, height: 2160 },
] as const satisfies readonly GameResolution[];

export const KNOWN_GAME_RESOLUTION_TUPLES = [
  [1024, 768],
  [1280, 720],
  [1366, 768],
  [1920, 1080],
  [1920, 1200],
  [2560, 1440],
  [2560, 1600],
  [2732, 1536],
  [3840, 2160],
] as const;

export function findClosestKnownGameResolution(
  captureSize: CaptureSize | null,
  {
    maxWidthDelta = 3,
    maxHeightDelta = 160,
  }: {
    maxWidthDelta?: number;
    maxHeightDelta?: number;
  } = {},
): GameResolution | null {
  if (!captureSize?.width || !captureSize.height) {
    return null;
  }

  const matched = KNOWN_GAME_RESOLUTIONS.map((resolution) => {
    const widthDelta = Math.abs(captureSize.width - resolution.width);
    const heightDelta = Math.abs(captureSize.height - resolution.height);
    return {
      ...resolution,
      widthDelta,
      heightDelta,
      score: widthDelta * 8 + heightDelta,
    };
  })
    .filter(({ widthDelta, heightDelta }) => {
      return widthDelta <= maxWidthDelta && heightDelta <= maxHeightDelta;
    })
    .sort((a, b) => a.score - b.score)[0];

  return matched ? { width: matched.width, height: matched.height } : null;
}

export function getGameResolutionLabel(captureSize: CaptureSize | null): string {
  if (!captureSize) {
    return "캡처 대기";
  }

  const matched = findClosestKnownGameResolution(captureSize);
  if (!matched) {
    return `${captureSize.width} x ${captureSize.height}`;
  }

  return `${matched.width} x ${matched.height}`;
}

export function getLikelyGameViewportCrop(captureSize: CaptureSize | null): GameViewportCrop | null {
  const matched = findClosestKnownGameResolution(captureSize, {
    maxWidthDelta: 16,
    maxHeightDelta: 180,
  });

  if (!captureSize || !matched) {
    return null;
  }

  const widthExtra = captureSize.width - matched.width;
  const heightExtra = captureSize.height - matched.height;

  if (widthExtra < 0 || heightExtra < 0) {
    return null;
  }

  const x = Math.round(widthExtra / 2);
  const y = Math.round(heightExtra);

  return {
    source: captureSize,
    game: matched,
    x,
    y,
    width: matched.width,
    height: matched.height,
    isCropped: x > 0 || y > 0 || matched.width !== captureSize.width || matched.height !== captureSize.height,
  };
}
