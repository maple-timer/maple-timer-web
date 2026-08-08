import {
  findConnectedComponents,
  findLargestConnectedComponent,
  forEachPixel,
  resolveRelativeRegion,
} from "./imageMask";

export const ULTIMA_RAID_INVENTORY_FULL_DETECTOR_VERSION =
  "ultima-raid-inventory-full-v9";

const MIN_SUPPORTED_ASPECT_RATIO = 2.1;
const MAX_SUPPORTED_ASPECT_RATIO = 2.8;
const MIN_SUPPORTED_WIDTH = 160;
const MIN_SUPPORTED_HEIGHT = 64;

const BAG_COUNT_REGION = {
  x: 0.035,
  y: 0.49,
  width: 0.08,
  height: 0.135,
} as const;
const BANNER_SEARCH_REGION = {
  x: 0.14,
  y: 0,
  width: 0.74,
  height: 0.2,
} as const;

const MIN_BAG_WARM_PIXEL_RATIO = 0.14;
const BAG_COUNT_ROW_SEARCH_TOP_RATIO = 0.28;
const BAG_COUNT_ROW_SEARCH_BOTTOM_RATIO = 0.82;
const BAG_COUNT_ROW_WINDOW_HEIGHT_RATIO = 0.27;
const BAG_COUNT_ROW_EXPECTED_CENTER_RATIO = 0.56;
const MIN_BAG_WARM_COMPONENT_START_X_RATIO = 0.14;
const MAX_BAG_WARM_COMPONENT_START_X_RATIO = 0.7;
const MIN_BANNER_WIDTH_RATIO = 0.28;
const MIN_BANNER_HEIGHT_RATIO = 0.035;
const MIN_BANNER_FILL_RATIO = 0.25;

export type UltimaRaidInventoryFullDetectionSource =
  | "bag-and-banner"
  | "bag-number"
  | "full-banner"
  | "none";

export type UltimaRaidBagCountState = "full" | "clear" | "unreadable";

export type UltimaRaidInventoryFullDetection = {
  detected: boolean;
  confidence: number;
  layoutValid: boolean;
  source: UltimaRaidInventoryFullDetectionSource;
  bagCountState: UltimaRaidBagCountState;
  bagCountReadable: boolean;
  bagCountOccluded: boolean;
  bagFullDetected: boolean;
  bagWarmPixelCount: number;
  bagForegroundPixelCount: number;
  bagReadablePixelCount: number;
  bagWarmPixelRatio: number;
  largestBagWarmClusterSize: number;
  largestBagWarmClusterWidth: number;
  largestBagWarmClusterHeight: number;
  largestBagWarmClusterXRatio: number;
  largestBagWarmClusterYRatio: number;
  bagWarmComponentValid: boolean;
  bagWarmComponentTouchesBoundary: boolean;
  bagCountRowTopRatio: number;
  bagCountRowHeightRatio: number;
  fullBannerDetected: boolean;
  largestBannerClusterSize: number;
  bannerWidthRatio: number;
  bannerHeightRatio: number;
  bannerFillRatio: number;
  detectorVersion: typeof ULTIMA_RAID_INVENTORY_FULL_DETECTOR_VERSION;
};

export function detectUltimaRaidInventoryFull(
  image: ImageData,
): UltimaRaidInventoryFullDetection {
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

  const bagEvidence = inspectBagCount(image);
  const bannerEvidence = inspectFullBanner(image);
  const bagCountReadable =
    bagEvidence.readablePixelCount >=
      bagEvidence.requiredReadablePixelCount &&
    !bagEvidence.occluded;
  const bagFullDetected =
    bagCountReadable &&
    bagEvidence.warmPixelCount >= bagEvidence.requiredWarmPixelCount &&
    bagEvidence.warmPixelRatio >= MIN_BAG_WARM_PIXEL_RATIO &&
    bagEvidence.warmComponentValid;
  const fullBannerDetected =
    bannerEvidence.largestClusterSize > 0 &&
    bannerEvidence.widthRatio >= MIN_BANNER_WIDTH_RATIO &&
    bannerEvidence.heightRatio >= MIN_BANNER_HEIGHT_RATIO &&
    bannerEvidence.fillRatio >= MIN_BANNER_FILL_RATIO;
  const source = getDetectionSource(bagFullDetected, fullBannerDetected);
  const bagCountState: UltimaRaidBagCountState = bagFullDetected
    ? "full"
    : bagCountReadable
      ? "clear"
      : "unreadable";
  const bagConfidence = Math.min(
    1,
    (bagEvidence.warmPixelRatio / MIN_BAG_WARM_PIXEL_RATIO) * 0.55 +
      (bagEvidence.warmPixelCount / bagEvidence.requiredWarmPixelCount) * 0.25 +
      (bagEvidence.largestWarmClusterSize / bagEvidence.requiredWarmClusterSize) *
        0.2,
  );
  const bannerConfidence = Math.min(
    1,
    (bannerEvidence.widthRatio / MIN_BANNER_WIDTH_RATIO) * 0.55 +
      (bannerEvidence.fillRatio / MIN_BANNER_FILL_RATIO) * 0.45,
  );

  return {
    detected: bagFullDetected || fullBannerDetected,
    confidence: Math.max(
      bagFullDetected ? bagConfidence : 0,
      fullBannerDetected ? bannerConfidence : 0,
    ),
    layoutValid,
    source,
    bagCountState,
    bagCountReadable,
    bagCountOccluded: bagEvidence.occluded,
    bagFullDetected,
    bagWarmPixelCount: bagEvidence.warmPixelCount,
    bagForegroundPixelCount: bagEvidence.foregroundPixelCount,
    bagReadablePixelCount: bagEvidence.readablePixelCount,
    bagWarmPixelRatio: bagEvidence.warmPixelRatio,
    largestBagWarmClusterSize: bagEvidence.largestWarmClusterSize,
    largestBagWarmClusterWidth: bagEvidence.largestWarmClusterWidth,
    largestBagWarmClusterHeight: bagEvidence.largestWarmClusterHeight,
    largestBagWarmClusterXRatio: bagEvidence.largestWarmClusterXRatio,
    largestBagWarmClusterYRatio: bagEvidence.largestWarmClusterYRatio,
    bagWarmComponentValid: bagEvidence.warmComponentValid,
    bagWarmComponentTouchesBoundary:
      bagEvidence.warmComponentTouchesBoundary,
    bagCountRowTopRatio: bagEvidence.countRowTopRatio,
    bagCountRowHeightRatio: bagEvidence.countRowHeightRatio,
    fullBannerDetected,
    largestBannerClusterSize: bannerEvidence.largestClusterSize,
    bannerWidthRatio: bannerEvidence.widthRatio,
    bannerHeightRatio: bannerEvidence.heightRatio,
    bannerFillRatio: bannerEvidence.fillRatio,
    detectorVersion: ULTIMA_RAID_INVENTORY_FULL_DETECTOR_VERSION,
  };
}

export function isBagFullWarmPixel(
  red: number,
  green: number,
  blue: number,
  alpha = 255,
): boolean {
  if (alpha < 96 || Math.min(red, green) - blue < 7) {
    return false;
  }

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (max === 0 || delta === 0) {
    return false;
  }

  const saturation = delta / max;
  const value = max / 255;
  const hue = getHueDegrees(red, green, blue, max, delta);

  return hue >= 24 && hue <= 78 && saturation >= 0.16 && value >= 0.38;
}

function inspectBagCount(image: ImageData) {
  const region = resolveRelativeRegion(image, BAG_COUNT_REGION);
  const foregroundMask = new Uint8Array(region.width * region.height);
  const readableMask = new Uint8Array(region.width * region.height);
  const warmMask = new Uint8Array(region.width * region.height);
  const readableByRow = new Uint16Array(region.height);

  forEachPixel(image, region, ({ localIndex, red, green, blue, alpha }) => {
    const isForeground = isBagNumberForegroundPixel(
      red,
      green,
      blue,
      alpha,
    );
    if (isForeground) {
      foregroundMask[localIndex] = 1;
    }
    if (
      isForeground ||
      isCoolBagNumberReadablePixel(red, green, blue, alpha)
    ) {
      readableMask[localIndex] = 1;
      readableByRow[Math.floor(localIndex / region.width)] += 1;
    }
    if (isBagFullWarmPixel(red, green, blue, alpha)) {
      warmMask[localIndex] = 1;
    }
  });

  const countRow = findBagCountRow(readableByRow);
  let foregroundPixelCount = 0;
  let readablePixelCount = 0;
  let warmPixelCount = 0;
  for (
    let localY = countRow.top;
    localY < countRow.top + countRow.height;
    localY += 1
  ) {
    const rowOffset = localY * region.width;
    for (let localX = 0; localX < region.width; localX += 1) {
      const index = rowOffset + localX;
      foregroundPixelCount += foregroundMask[index];
      readablePixelCount += readableMask[index];
      warmPixelCount += warmMask[index];
    }
  }

  const largestWarmComponent = findLargestRowComponent(
    warmMask,
    region.width,
    region.height,
    countRow,
  );
  const largestWarmClusterSize = largestWarmComponent?.size ?? 0;
  const regionArea = Math.max(1, region.width * region.height);
  const requiredWarmClusterSize = Math.max(
    4,
    Math.ceil(Math.min(region.width, region.height) * 0.08),
  );
  const requiredWarmClusterWidth = Math.max(
    2,
    Math.ceil(region.width * 0.04),
  );
  const standardWarmClusterHeight = Math.max(
    3,
    Math.ceil(region.height * 0.12),
  );
  const compactHorizontalClusterWidth = Math.max(
    4,
    Math.ceil(region.width * 0.1),
  );
  const standardMaximumWarmClusterWidth = Math.max(
    requiredWarmClusterWidth,
    Math.ceil(region.width * 0.3),
  );
  const mergedDigitMaximumWarmClusterWidth = Math.max(
    standardMaximumWarmClusterWidth,
    Math.ceil(region.width * 0.55),
  );
  const maximumWarmClusterHeight = Math.max(
    standardWarmClusterHeight,
    Math.ceil(region.height * 0.7),
  );
  const warmComponentTouchesBoundary = largestWarmComponent
    ? largestWarmComponent.x === 0 ||
      largestWarmComponent.y === 0 ||
      largestWarmComponent.x + largestWarmComponent.width === region.width ||
      largestWarmComponent.y + largestWarmComponent.height === region.height
    : false;
  const largestWarmComponentXRatio =
    largestWarmComponent && region.width > 0
      ? largestWarmComponent.x / region.width
      : 0;
  const warmComponentShapeValid = Boolean(
    largestWarmComponent &&
      largestWarmComponent.size >= requiredWarmClusterSize &&
      largestWarmComponent.width >= requiredWarmClusterWidth &&
      largestWarmComponent.height >= 2 &&
      (largestWarmComponent.height >= standardWarmClusterHeight ||
        largestWarmComponent.width >= compactHorizontalClusterWidth) &&
      largestWarmComponent.height <= largestWarmComponent.width * 2 &&
      (largestWarmComponent.width <= standardMaximumWarmClusterWidth ||
        (largestWarmComponent.width <= mergedDigitMaximumWarmClusterWidth &&
          largestWarmComponent.width >= largestWarmComponent.height * 2)) &&
      largestWarmComponent.height <= maximumWarmClusterHeight &&
      !warmComponentTouchesBoundary,
  );
  const distributedWarmSupportSize = Math.max(
    0,
    warmPixelCount - largestWarmClusterSize,
  );
  const hasDistributedWarmSupport =
    distributedWarmSupportSize >= requiredWarmClusterSize * 2;
  const warmComponentValid = Boolean(
    warmComponentShapeValid &&
      ((largestWarmComponentXRatio >=
          MIN_BAG_WARM_COMPONENT_START_X_RATIO &&
        largestWarmComponentXRatio <=
          MAX_BAG_WARM_COMPONENT_START_X_RATIO) ||
        hasDistributedWarmSupport),
  );
  const occluded =
    largestWarmClusterSize >= requiredWarmClusterSize && !warmComponentValid;

  return {
    foregroundPixelCount,
    readablePixelCount,
    warmPixelCount,
    warmPixelRatio:
      foregroundPixelCount > 0 ? warmPixelCount / foregroundPixelCount : 0,
    largestWarmClusterSize,
    largestWarmClusterWidth: largestWarmComponent?.width ?? 0,
    largestWarmClusterHeight: largestWarmComponent?.height ?? 0,
    largestWarmClusterXRatio:
      largestWarmComponentXRatio,
    largestWarmClusterYRatio:
      largestWarmComponent && region.height > 0
        ? largestWarmComponent.y / region.height
        : 0,
    warmComponentValid,
    warmComponentTouchesBoundary,
    occluded,
    countRowTopRatio:
      region.height > 0 ? countRow.top / region.height : 0,
    countRowHeightRatio:
      region.height > 0 ? countRow.height / region.height : 0,
    requiredReadablePixelCount: Math.max(3, Math.ceil(regionArea * 0.006)),
    requiredWarmPixelCount: Math.max(4, Math.ceil(regionArea * 0.003)),
    requiredWarmClusterSize,
  };
}

function findBagCountRow(foregroundByRow: Uint16Array): {
  top: number;
  height: number;
} {
  const regionHeight = foregroundByRow.length;
  const windowHeight = Math.min(
    regionHeight,
    Math.max(4, Math.round(regionHeight * BAG_COUNT_ROW_WINDOW_HEIGHT_RATIO)),
  );
  const searchTop = Math.min(
    Math.max(0, regionHeight - windowHeight),
    Math.floor(regionHeight * BAG_COUNT_ROW_SEARCH_TOP_RATIO),
  );
  const searchBottom = Math.max(
    searchTop + windowHeight,
    Math.min(
      regionHeight,
      Math.ceil(regionHeight * BAG_COUNT_ROW_SEARCH_BOTTOM_RATIO),
    ),
  );
  let bestTop = searchTop;
  let bestForegroundCount = -1;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (
    let top = searchTop;
    top + windowHeight <= searchBottom;
    top += 1
  ) {
    let foregroundCount = 0;
    for (let row = top; row < top + windowHeight; row += 1) {
      foregroundCount += foregroundByRow[row];
    }
    const center = (top + windowHeight / 2) / Math.max(1, regionHeight);
    const centerDistance = Math.abs(
      center - BAG_COUNT_ROW_EXPECTED_CENTER_RATIO,
    );
    if (
      foregroundCount > bestForegroundCount ||
      (foregroundCount === bestForegroundCount &&
        centerDistance < bestCenterDistance)
    ) {
      bestTop = top;
      bestForegroundCount = foregroundCount;
      bestCenterDistance = centerDistance;
    }
  }

  return { top: bestTop, height: windowHeight };
}

function findLargestRowComponent(
  warmMask: Uint8Array,
  width: number,
  height: number,
  countRow: { top: number; height: number },
) {
  const components = findConnectedComponents(warmMask, width, height);
  const rowBottom = countRow.top + countRow.height;
  let largest = null;

  for (const component of components) {
    const overlapHeight =
      Math.min(component.y + component.height, rowBottom) -
      Math.max(component.y, countRow.top);
    if (overlapHeight < Math.min(2, component.height)) {
      continue;
    }
    if (!largest || component.size > largest.size) {
      largest = component;
    }
  }

  return largest;
}

function inspectFullBanner(image: ImageData) {
  const region = resolveRelativeRegion(image, BANNER_SEARCH_REGION);
  const mask = new Uint8Array(region.width * region.height);

  forEachPixel(image, region, ({ localIndex, red, green, blue, alpha }) => {
    if (isFullBannerPixel(red, green, blue, alpha)) {
      mask[localIndex] = 1;
    }
  });

  const largest = findLargestConnectedComponent(mask, region.width, region.height);
  const componentArea = Math.max(1, largest.width * largest.height);

  return {
    largestClusterSize: largest.size,
    widthRatio: largest.width / image.width,
    heightRatio: largest.height / image.height,
    fillRatio: largest.size / componentArea,
  };
}

function isBagNumberForegroundPixel(
  red: number,
  green: number,
  blue: number,
  alpha: number,
): boolean {
  return (
    alpha >= 96 &&
    Math.max(red, green, blue) >= 105 &&
    red >= blue - 15 &&
    green >= blue - 25
  );
}

function isCoolBagNumberReadablePixel(
  red: number,
  green: number,
  blue: number,
  alpha: number,
): boolean {
  return (
    alpha >= 96 &&
    Math.max(red, green, blue) >= 200 &&
    red >= 100 &&
    green >= 170 &&
    blue >= 190
  );
}

function isFullBannerPixel(
  red: number,
  green: number,
  blue: number,
  alpha: number,
): boolean {
  return (
    alpha >= 96 &&
    red >= 180 &&
    green >= 25 &&
    green <= 175 &&
    blue >= 55 &&
    blue <= 190 &&
    red - green >= 55 &&
    red - blue >= 35
  );
}

function getHueDegrees(
  red: number,
  green: number,
  blue: number,
  max: number,
  delta: number,
): number {
  let hue: number;

  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }

  return ((hue * 60) + 360) % 360;
}

function getDetectionSource(
  bagFullDetected: boolean,
  fullBannerDetected: boolean,
): UltimaRaidInventoryFullDetectionSource {
  if (bagFullDetected && fullBannerDetected) {
    return "bag-and-banner";
  }
  if (bagFullDetected) {
    return "bag-number";
  }
  if (fullBannerDetected) {
    return "full-banner";
  }
  return "none";
}

function createEmptyDetection(
  layoutValid: boolean,
): UltimaRaidInventoryFullDetection {
  return {
    detected: false,
    confidence: 0,
    layoutValid,
    source: "none",
    bagCountState: "unreadable",
    bagCountReadable: false,
    bagCountOccluded: false,
    bagFullDetected: false,
    bagWarmPixelCount: 0,
    bagForegroundPixelCount: 0,
    bagReadablePixelCount: 0,
    bagWarmPixelRatio: 0,
    largestBagWarmClusterSize: 0,
    largestBagWarmClusterWidth: 0,
    largestBagWarmClusterHeight: 0,
    largestBagWarmClusterXRatio: 0,
    largestBagWarmClusterYRatio: 0,
    bagWarmComponentValid: false,
    bagWarmComponentTouchesBoundary: false,
    bagCountRowTopRatio: 0,
    bagCountRowHeightRatio: 0,
    fullBannerDetected: false,
    largestBannerClusterSize: 0,
    bannerWidthRatio: 0,
    bannerHeightRatio: 0,
    bannerFillRatio: 0,
    detectorVersion: ULTIMA_RAID_INVENTORY_FULL_DETECTOR_VERSION,
  };
}
