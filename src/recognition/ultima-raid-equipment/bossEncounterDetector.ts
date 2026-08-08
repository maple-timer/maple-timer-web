import {
  findLargestConnectedComponent,
  forEachPixel,
  resolveRelativeRegion,
} from "./imageMask";

export const ULTIMA_RAID_BOSS_DETECTOR_VERSION =
  "ultima-raid-boss-progress-v1";

const MIN_SUPPORTED_ASPECT_RATIO = 2.1;
const MAX_SUPPORTED_ASPECT_RATIO = 2.8;
const MIN_SUPPORTED_WIDTH = 160;
const MIN_SUPPORTED_HEIGHT = 64;

const PROGRESS_BAR_REGION = {
  x: 0.37,
  y: 0.81,
  width: 0.35,
  height: 0.14,
} as const;

const MIN_BAR_WIDTH_RATIO = 0.22;
const MIN_BAR_HEIGHT_RATIO = 0.025;
const MIN_BAR_FILL_RATIO = 0.42;
const MIN_NORMAL_BAR_WIDTH_RATIO = 0.055;

export type UltimaRaidBossProgressState = "boss" | "normal" | "unreadable";

export type UltimaRaidBossDetection = {
  layoutValid: boolean;
  progressState: UltimaRaidBossProgressState;
  bossBarDetected: boolean;
  normalBarDetected: boolean;
  bossBarPixelCount: number;
  bossBarWidthRatio: number;
  bossBarHeightRatio: number;
  bossBarFillRatio: number;
  normalBarPixelCount: number;
  normalBarWidthRatio: number;
  detectorVersion: typeof ULTIMA_RAID_BOSS_DETECTOR_VERSION;
};

export function detectUltimaRaidBossEncounter(
  image: ImageData,
): UltimaRaidBossDetection {
  const totalPixels = Math.max(0, image.width * image.height);
  if (totalPixels === 0 || image.data.length < totalPixels * 4) {
    return createEmptyDetection(false);
  }

  const aspectRatio = image.width / image.height;
  const layoutValid =
    image.width >= MIN_SUPPORTED_WIDTH &&
    image.height >= MIN_SUPPORTED_HEIGHT &&
    aspectRatio >= MIN_SUPPORTED_ASPECT_RATIO &&
    aspectRatio <= MAX_SUPPORTED_ASPECT_RATIO;
  if (!layoutValid) {
    return createEmptyDetection(false);
  }

  const region = resolveRelativeRegion(image, PROGRESS_BAR_REGION);
  const bossMask = new Uint8Array(region.width * region.height);
  const normalMask = new Uint8Array(region.width * region.height);
  let bossBarPixelCount = 0;
  let normalBarPixelCount = 0;

  forEachPixel(image, region, ({ localIndex, red, green, blue, alpha }) => {
    if (isBossProgressPixel(red, green, blue, alpha)) {
      bossMask[localIndex] = 1;
      bossBarPixelCount += 1;
    }
    if (isNormalProgressPixel(red, green, blue, alpha)) {
      normalMask[localIndex] = 1;
      normalBarPixelCount += 1;
    }
  });

  const bossComponent = findLargestConnectedComponent(
    bossMask,
    region.width,
    region.height,
  );
  const normalComponent = findLargestConnectedComponent(
    normalMask,
    region.width,
    region.height,
  );
  const bossComponentArea = Math.max(
    1,
    bossComponent.width * bossComponent.height,
  );
  const bossBarWidthRatio = bossComponent.width / image.width;
  const bossBarHeightRatio = bossComponent.height / image.height;
  const bossBarFillRatio = bossComponent.size / bossComponentArea;
  const normalBarWidthRatio = normalComponent.width / image.width;
  const bossBarDetected =
    bossComponent.size > 0 &&
    bossBarWidthRatio >= MIN_BAR_WIDTH_RATIO &&
    bossBarHeightRatio >= MIN_BAR_HEIGHT_RATIO &&
    bossBarFillRatio >= MIN_BAR_FILL_RATIO;
  const normalBarDetected =
    !bossBarDetected &&
    normalComponent.size > 0 &&
    normalBarWidthRatio >= MIN_NORMAL_BAR_WIDTH_RATIO;

  return {
    layoutValid,
    progressState: bossBarDetected
      ? "boss"
      : normalBarDetected
        ? "normal"
        : "unreadable",
    bossBarDetected,
    normalBarDetected,
    bossBarPixelCount,
    bossBarWidthRatio,
    bossBarHeightRatio,
    bossBarFillRatio,
    normalBarPixelCount,
    normalBarWidthRatio,
    detectorVersion: ULTIMA_RAID_BOSS_DETECTOR_VERSION,
  };
}

export function isBossProgressPixel(
  red: number,
  green: number,
  blue: number,
  alpha = 255,
): boolean {
  return (
    alpha >= 96 &&
    red >= 165 &&
    blue >= 60 &&
    red - green >= 45 &&
    blue - green >= 5
  );
}

export function isNormalProgressPixel(
  red: number,
  green: number,
  blue: number,
  alpha = 255,
): boolean {
  return (
    alpha >= 96 &&
    green >= 120 &&
    blue >= 125 &&
    green - red >= 30 &&
    blue - red >= 35 &&
    Math.abs(green - blue) <= 80
  );
}

function createEmptyDetection(
  layoutValid: boolean,
): UltimaRaidBossDetection {
  return {
    layoutValid,
    progressState: "unreadable",
    bossBarDetected: false,
    normalBarDetected: false,
    bossBarPixelCount: 0,
    bossBarWidthRatio: 0,
    bossBarHeightRatio: 0,
    bossBarFillRatio: 0,
    normalBarPixelCount: 0,
    normalBarWidthRatio: 0,
    detectorVersion: ULTIMA_RAID_BOSS_DETECTOR_VERSION,
  };
}
