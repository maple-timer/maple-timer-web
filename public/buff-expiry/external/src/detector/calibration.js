const KNOWN_RESOLUTIONS = [
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

const MATCH_TOLERANCE_PX = 4;
const MAX_FRAME_WIDTH_EXTRA = 8;
const MIN_TITLEBAR_HEIGHT = 16;
const MAX_TITLEBAR_HEIGHT = 64;

// These values come only from the 27 supplied calibration screenshots.
// They are size priors, not coordinate or row-count rules.
const CALIBRATED_SIDES_BY_RESOLUTION = {
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

export function getFrameCalibration(width, height, options = {}) {
  const resolution = options.forceFallbackSides ? null : matchKnownResolution(width, height);
  const fallbackSides = options.fallbackSides ?? [];
  const sides = resolution ? CALIBRATED_SIDES_BY_RESOLUTION[resolution.key] ?? [] : fallbackSides;
  const gameRect = resolution ? makeGameRect(width, height, resolution) : makeFullFrameRect(width, height);

  return {
    resolutionKey: resolution?.key ?? null,
    gameWidth: resolution?.width ?? null,
    gameHeight: resolution?.height ?? null,
    frameWidth: width,
    frameHeight: height,
    frameExtraWidth: resolution ? Math.max(0, width - resolution.width) : null,
    frameExtraHeight: resolution ? Math.max(0, height - resolution.height) : null,
    contentOffsetX: gameRect.x,
    contentOffsetY: gameRect.y,
    gameRect,
    sideCandidates: [...new Set(sides)].sort((a, b) => a - b),
    matched: Boolean(resolution),
    matchScore: resolution?.score ?? null,
    unsupportedReason: resolution || fallbackSides.length ? null : `unsupported resolution: ${width}x${height}`,
  };
}

export function scaleSideCandidates(sideCandidates, scale) {
  return [...new Set(sideCandidates.map((side) => Math.max(1, Math.round(side * scale))))].sort((a, b) => a - b);
}

function matchKnownResolution(width, height) {
  const matches = [];
  for (const resolution of KNOWN_RESOLUTIONS) {
    if (width < resolution.width || height < resolution.height) continue;
    const widthExtra = width - resolution.width;
    if (widthExtra > MAX_FRAME_WIDTH_EXTRA) continue;

    const heightExtra = height - resolution.height;
    const validHeightExtra =
      Math.abs(heightExtra) <= MATCH_TOLERANCE_PX ||
      (heightExtra >= MIN_TITLEBAR_HEIGHT && heightExtra <= MAX_TITLEBAR_HEIGHT + MATCH_TOLERANCE_PX);
    if (!validHeightExtra) continue;

    const normalizedHeightExtra = Math.abs(heightExtra) <= MATCH_TOLERANCE_PX ? 0 : heightExtra;
    const heightDelta = normalizedHeightExtra === 0 ? Math.abs(heightExtra) : 0;
    matches.push({
      ...resolution,
      expectedFrameWidth: resolution.width + widthExtra,
      expectedFrameHeight: resolution.height + normalizedHeightExtra,
      widthExtra,
      heightExtra: normalizedHeightExtra,
      score: widthExtra * 2 + heightDelta + (normalizedHeightExtra > 0 ? 1 : 0),
      widthDelta: 0,
      heightDelta,
    });
  }

  matches.sort((a, b) => a.score - b.score || a.widthExtra - b.widthExtra || a.heightDelta - b.heightDelta);

  const best = matches[0];
  return best && best.heightDelta <= MATCH_TOLERANCE_PX ? best : null;
}

function makeGameRect(frameWidth, frameHeight, resolution) {
  const horizontalExtra = Math.max(0, frameWidth - resolution.width);
  const verticalExtra = Math.max(0, frameHeight - resolution.height);
  return {
    x: Math.floor(horizontalExtra / 2),
    y: verticalExtra,
    width: resolution.width,
    height: resolution.height,
  };
}

function makeFullFrameRect(width, height) {
  return {
    x: 0,
    y: 0,
    width,
    height,
  };
}
