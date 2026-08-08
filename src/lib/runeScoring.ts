import type {
  RuneCandidate,
  RuneComponent,
} from "../recognition/rune/runeDetectionTypes";
import { isRuneCorePurple, isRuneDarkOutline, isRuneOutline, isRunePurple } from "./runeMask";

const MIN_COMPONENT_PIXELS = 8;
const MAX_DIAMOND_TOP_RATIO = 0.84;
const MAX_DIAMOND_BOTTOM_RATIO = 0.82;
const MAX_NEAR_EDGE_WIDTH_RATIO = 0.86;
const MAX_NEAR_EDGE_IMBALANCE_RATIO = 0.52;
const MAX_LINE_RESCUE_NEAR_EDGE_IMBALANCE_RATIO = 0.64;
const MIN_ROUNDED_SMALL_RUNE_SCORE = 0.4;
const MIN_COMPACT_LOW_LIGHT_RUNE_SCORE = 0.38;
const MIN_COMPACT_CORE_DIAMOND_RUNE_SCORE = 0.38;
const MIN_COMPACT_CORE_DIAMOND_CONFIDENCE = 0.62;

export type RuneScoreOptions = {
  allowLineRescue?: boolean;
};

export function scoreRuneComponent(
  component: RuneComponent,
  imageData: ImageData,
  options: RuneScoreOptions = {},
): RuneCandidate | null {
  const imageWidth = imageData.width;
  const imageHeight = imageData.height;
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  const area = width * height;
  const imageArea = imageWidth * imageHeight;
  const areaRatio = area / imageArea;
  const aspectRatio = width / Math.max(1, height);
  const squareAspectScore = Math.abs(aspectRatio - 1);
  const fillRatio = component.pixelCount / Math.max(1, area);
  const centerWidth = getAverageRowWidth(component.rows, component.minY, component.maxY, 0.38, 0.62);
  const topWidth = getAverageRowWidth(component.rows, component.minY, component.maxY, 0, 0.24);
  const bottomWidth = getAverageRowWidth(component.rows, component.minY, component.maxY, 0.76, 1);
  const maxRowWidth = Math.max(1, centerWidth);
  const topRatio = topWidth / maxRowWidth;
  const bottomRatio = bottomWidth / maxRowWidth;
  const rowWidths = getRowWidths(component.rows, component.minY, component.maxY);
  const rotatedSquareScore = getRotatedSquareScore(rowWidths, width, height);
  const coreColorScore = getCoreColorScore(imageData, component);
  const outlineScore = getLayeredOutlineScore(imageData, component);
  // Some real minimap rune captures have an anti-aliased top shoulder just
  // above 0.82. Keep the bottom taper stricter so inverted-triangle-like
  // fragments still fail the shape check.
  const hasDiamondTaper =
    topRatio <= MAX_DIAMOND_TOP_RATIO && bottomRatio <= MAX_DIAMOND_BOTTOM_RATIO;
  const hasTinyRuneTaper =
    width <= 7 &&
    height <= 7 &&
    topRatio <= 1.1 &&
    bottomRatio <= 0.58 &&
    rotatedSquareScore.score >= 0.46 &&
    rotatedSquareScore.peakCenterScore >= 0.68;
  const hasRoundedSmallRuneShape =
    width <= 16 &&
    height <= 16 &&
    rotatedSquareScore.score >= MIN_ROUNDED_SMALL_RUNE_SCORE &&
    rotatedSquareScore.peakCenterScore >= 0.72 &&
    outlineScore.score >= 0.78 &&
    coreColorScore.brightCorePixels >= 8 &&
    coreColorScore.brightRatio >= 0.35;
  const hasCompactLowLightRuneShape =
    width >= 8 &&
    width <= 10 &&
    height >= 7 &&
    height <= 10 &&
    component.pixelCount >= 36 &&
    rowWidths[0] / Math.max(1, width) <= 0.45 &&
    rowWidths[rowWidths.length - 1] / Math.max(1, width) <= 0.35 &&
    rotatedSquareScore.score >= MIN_COMPACT_LOW_LIGHT_RUNE_SCORE &&
    rotatedSquareScore.peakCenterScore >= 0.72 &&
    coreColorScore.brightCorePixels >= 12 &&
    coreColorScore.brightRatio >= 0.35 &&
    outlineScore.outlinePixels >= 2 &&
    outlineScore.hasLowerLightCoverage &&
    outlineScore.darkCoverage >= 3;
  const hasCompactCoreDiamondRuneShape =
    width >= 7 &&
    width <= 12 &&
    height >= 7 &&
    height <= 12 &&
    component.pixelCount >= 34 &&
    fillRatio >= 0.42 &&
    fillRatio <= 0.78 &&
    hasDiamondTaper &&
    rotatedSquareScore.score >= MIN_COMPACT_CORE_DIAMOND_RUNE_SCORE &&
    rotatedSquareScore.peakCenterScore >= 0.78 &&
    rotatedSquareScore.maxNearEdgeRatio <= 0.68 &&
    rotatedSquareScore.nearEdgeImbalanceRatio <= 0.22 &&
    coreColorScore.brightCorePixels >= 12 &&
    coreColorScore.brightRatio >= 0.34 &&
    outlineScore.darkPixels >= 40 &&
    outlineScore.darkCoverage >= 3;
  const hasCompressedTinyRuneShape =
    width >= 5 &&
    width <= 7 &&
    height >= 6 &&
    height <= 8 &&
    component.pixelCount >= 28 &&
    fillRatio >= 0.72 &&
    coreColorScore.brightCorePixels >= 10 &&
    coreColorScore.brightRatio >= 0.3 &&
    outlineScore.outlinePixels >= 12 &&
    outlineScore.darkPixels >= 20 &&
    outlineScore.lightCoverage >= 3 &&
    outlineScore.darkCoverage >= 3 &&
    outlineScore.hasUpperLightCoverage &&
    outlineScore.hasLowerLightCoverage;

  if (hasCompressedTinyRuneShape) {
    return {
      x: component.minX,
      y: component.minY,
      width,
      height,
      pixelCount: component.pixelCount,
      confidence: 0.6,
    };
  }

  if (
    component.pixelCount < MIN_COMPONENT_PIXELS ||
    width < 6 ||
    height < 6 ||
    areaRatio < 0.00008 ||
    areaRatio > 0.08 ||
    aspectRatio < 0.62 ||
    aspectRatio > 1.45 ||
    squareAspectScore > 0.42 ||
    fillRatio < 0.12 ||
    (!hasDiamondTaper && !hasTinyRuneTaper) ||
    rotatedSquareScore.maxNearEdgeRatio > MAX_NEAR_EDGE_WIDTH_RATIO ||
    rotatedSquareScore.nearEdgeImbalanceRatio >
      (options.allowLineRescue
        ? MAX_LINE_RESCUE_NEAR_EDGE_IMBALANCE_RATIO
        : MAX_NEAR_EDGE_IMBALANCE_RATIO) ||
    rotatedSquareScore.score < 0.28 ||
    (
      !hasRoundedSmallRuneShape &&
      !hasCompactLowLightRuneShape &&
      !hasCompactCoreDiamondRuneShape &&
      rotatedSquareScore.sharpEdgeScore < 0.08
    ) ||
    rotatedSquareScore.peakCenterScore < 0.28 ||
    coreColorScore.brightCorePixels < 8 ||
    coreColorScore.brightRatio < 0.35 ||
    (!hasCompactLowLightRuneShape && !hasCompactCoreDiamondRuneShape && outlineScore.outlinePixels < 8) ||
    outlineScore.darkPixels < 6 ||
    (!hasCompactLowLightRuneShape && !hasCompactCoreDiamondRuneShape && outlineScore.lightCoverage < 3) ||
    (!hasCompactLowLightRuneShape && !hasCompactCoreDiamondRuneShape && !outlineScore.hasUpperLightCoverage) ||
    (!hasCompactCoreDiamondRuneShape && !outlineScore.hasLowerLightCoverage) ||
    outlineScore.darkCoverage < 2
  ) {
    return null;
  }

  const aspectScore = Math.max(0, 1 - Math.abs(aspectRatio - 1) / 0.9);
  const sizeScore = areaRatio < 0.0004 ? areaRatio / 0.0004 : Math.max(0, 1 - areaRatio / 0.08);
  const centerScore = Math.min(1, centerWidth / Math.max(1, width * 0.6));
  const taperScore =
    Math.max(0, 1 - Math.abs(topRatio - bottomRatio) / 0.42) *
    Math.max(0, 1 - Math.abs((topRatio + bottomRatio) / 2 - 0.36) / 0.36);
  const fillScore = fillRatio > 0.72 ? 0.25 : Math.min(1, fillRatio / 0.42);
  const confidence =
    aspectScore * 0.16 +
    sizeScore * 0.14 +
    centerScore * 0.12 +
    taperScore * 0.12 +
    rotatedSquareScore.score * 0.16 +
    coreColorScore.score * 0.12 +
    outlineScore.score * 0.08 +
    fillScore * 0.1;
  const adjustedConfidence = hasCompactCoreDiamondRuneShape
    ? Math.max(confidence, MIN_COMPACT_CORE_DIAMOND_CONFIDENCE)
    : confidence;

  if (adjustedConfidence < 0.36) {
    return null;
  }

  return {
    x: component.minX,
    y: component.minY,
    width,
    height,
    pixelCount: component.pixelCount,
    confidence: adjustedConfidence,
  };
}

export function scoreTallAttachedRuneComponent(
  component: RuneComponent,
  imageData: ImageData,
): RuneCandidate | null {
  const imageWidth = imageData.width;
  const imageHeight = imageData.height;
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  const area = width * height;
  const aspectRatio = width / Math.max(1, height);
  const fillRatio = component.pixelCount / Math.max(1, area);
  const topRowWidth = component.rows.get(component.minY)?.count ?? 0;
  const bottomRowWidth = component.rows.get(component.maxY)?.count ?? 0;
  const rowWidths = getRowWidths(component.rows, component.minY, component.maxY);
  const maxRowWidth = Math.max(1, ...rowWidths);
  const lowerQuarterMaxWidth = Math.max(0, ...rowWidths.slice(Math.floor(height * 0.75)));
  const coreColorScore = getCoreColorScore(imageData, component);
  const outlineScore = getLayeredOutlineScore(imageData, component);

  if (
    width < 8 ||
    width > 16 ||
    height < 20 ||
    height > 34 ||
    width * height > imageWidth * imageHeight * 0.02 ||
    aspectRatio < 0.42 ||
    aspectRatio > 0.72 ||
    fillRatio < 0.28 ||
    fillRatio > 0.72 ||
    topRowWidth > 4 ||
    bottomRowWidth > 4 ||
    lowerQuarterMaxWidth > Math.max(8, width - 2) ||
    component.pixelCount < 90 ||
    coreColorScore.brightCorePixels < 18 ||
    coreColorScore.brightRatio < 0.18 ||
    outlineScore.outlinePixels < 18 ||
    outlineScore.darkPixels < 6 ||
    outlineScore.lightCoverage < 1 ||
    outlineScore.darkCoverage < 1 ||
    !outlineScore.hasLowerLightCoverage
  ) {
    return null;
  }

  const coreScore =
    Math.min(1, coreColorScore.brightCorePixels / 42) * 0.6 +
    Math.min(1, coreColorScore.brightRatio / 0.3) * 0.4;
  const outlineConfidence =
    Math.min(1, outlineScore.outlinePixels / 34) * 0.5 +
    Math.min(1, outlineScore.darkPixels / 12) * 0.3 +
    Math.min(1, outlineScore.lightCoverage / 2) * 0.2;
  const taperScore =
    Math.min(1, Math.max(0, 5 - topRowWidth) / 4) * 0.45 +
    Math.min(1, Math.max(0, 5 - bottomRowWidth) / 4) * 0.45 +
    Math.min(1, maxRowWidth / Math.max(1, width * 0.74)) * 0.1;
  const confidence = Math.min(
    0.78,
    0.52 + coreScore * 0.12 + outlineConfidence * 0.08 + taperScore * 0.08,
  );

  return {
    x: component.minX,
    y: component.minY,
    width,
    height,
    pixelCount: component.pixelCount,
    confidence,
  };
}

function getAverageRowWidth(
  rows: RuneComponent["rows"],
  minY: number,
  maxY: number,
  fromRatio: number,
  toRatio: number,
): number {
  const height = Math.max(1, maxY - minY + 1);
  const from = minY + Math.floor(height * fromRatio);
  const to = minY + Math.ceil(height * toRatio);
  let total = 0;
  let count = 0;

  for (let y = from; y <= to; y += 1) {
    const row = rows.get(y);
    if (!row) {
      continue;
    }
    total += row.maxX - row.minX + 1;
    count += 1;
  }

  return count === 0 ? 0 : total / count;
}

function getRowWidths(rows: RuneComponent["rows"], minY: number, maxY: number): number[] {
  const rowWidths: number[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    const row = rows.get(y);
    rowWidths.push(row ? row.maxX - row.minX + 1 : 0);
  }
  return rowWidths;
}

function getRotatedSquareScore(rowWidths: number[], width: number, height: number) {
  const maxRowWidth = Math.max(1, ...rowWidths);
  const peakIndex = Math.max(
    0,
    rowWidths.findIndex((rowWidth) => rowWidth === maxRowWidth),
  );
  const edgeIndex = Math.max(1, Math.floor((height - 1) * 0.22));
  const topNearRatio = (rowWidths[edgeIndex] ?? 0) / maxRowWidth;
  const bottomNearRatio = (rowWidths[height - 1 - edgeIndex] ?? 0) / maxRowWidth;
  const maxNearEdgeRatio = Math.max(topNearRatio, bottomNearRatio);
  const nearEdgeImbalanceRatio = Math.abs(topNearRatio - bottomNearRatio);
  const sharpEdgeRatio = Math.min(topNearRatio, bottomNearRatio);
  const sharpEdgeScore = Math.max(0, 1 - sharpEdgeRatio / 0.55);
  const peakCenterScore =
    height <= 1 ? 0 : Math.max(0, 1 - Math.abs(peakIndex / (height - 1) - 0.5) / 0.5);
  const squareBoxScore = Math.max(0, 1 - Math.abs(width / Math.max(1, height) - 1) / 0.72);

  return {
    maxNearEdgeRatio,
    nearEdgeImbalanceRatio,
    sharpEdgeScore,
    peakCenterScore,
    score: sharpEdgeScore * 0.52 + peakCenterScore * 0.28 + squareBoxScore * 0.2,
  };
}

function getCoreColorScore(imageData: ImageData, component: RuneComponent) {
  let purplePixels = 0;
  let brightCorePixels = 0;

  for (let y = component.minY; y <= component.maxY; y += 1) {
    for (let x = component.minX; x <= component.maxX; x += 1) {
      const index = (y * imageData.width + x) * 4;
      if (!isRunePurple(imageData.data[index], imageData.data[index + 1], imageData.data[index + 2])) {
        continue;
      }
      purplePixels += 1;
      if (isRuneCorePurple(imageData.data[index], imageData.data[index + 1], imageData.data[index + 2])) {
        brightCorePixels += 1;
      }
    }
  }

  const brightRatio = brightCorePixels / Math.max(1, purplePixels);
  return {
    brightCorePixels,
    brightRatio,
    score: Math.min(1, brightRatio / 0.72) * 0.55 + Math.min(1, brightCorePixels / 18) * 0.45,
  };
}

function getLayeredOutlineScore(imageData: ImageData, component: RuneComponent) {
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  const pad = Math.max(4, Math.ceil(Math.min(width, height) * 0.75));
  const centerX = component.minX + (width - 1) / 2;
  const centerY = component.minY + (height - 1) / 2;
  const lightQuadrants = [0, 0, 0, 0];
  const darkQuadrants = [0, 0, 0, 0];
  let outlinePixels = 0;
  let darkPixels = 0;

  const fromX = Math.max(0, component.minX - pad);
  const toX = Math.min(imageData.width, component.maxX + pad + 1);
  const fromY = Math.max(0, component.minY - pad);
  const toY = Math.min(imageData.height, component.maxY + pad + 1);

  for (let y = fromY; y < toY; y += 1) {
    for (let x = fromX; x < toX; x += 1) {
      if (x >= component.minX && x <= component.maxX && y >= component.minY && y <= component.maxY) {
        continue;
      }

      const index = (y * imageData.width + x) * 4;
      const dx = x - centerX;
      const dy = y - centerY;
      const quadrant = dy < 0 ? (dx < 0 ? 0 : 1) : dx < 0 ? 2 : 3;

      if (isRuneOutline(imageData.data[index], imageData.data[index + 1], imageData.data[index + 2])) {
        lightQuadrants[quadrant] += 1;
        outlinePixels += 1;
      }

      if (isRuneDarkOutline(imageData.data[index], imageData.data[index + 1], imageData.data[index + 2])) {
        darkQuadrants[quadrant] += 1;
        darkPixels += 1;
      }
    }
  }

  const lightCoverage = lightQuadrants.filter((count) => count >= 2).length;
  const darkCoverage = darkQuadrants.filter((count) => count >= 2).length;
  const hasUpperLightCoverage = lightQuadrants[0] >= 2 || lightQuadrants[1] >= 2;
  const hasLowerLightCoverage = lightQuadrants[2] >= 2 || lightQuadrants[3] >= 2;
  const lightPixelScore = Math.min(1, outlinePixels / Math.max(10, Math.min(width, height) * 3));
  const darkPixelScore = Math.min(1, darkPixels / Math.max(8, Math.min(width, height) * 2));
  return {
    outlinePixels,
    darkPixels,
    lightCoverage,
    darkCoverage,
    hasUpperLightCoverage,
    hasLowerLightCoverage,
    score: lightPixelScore * 0.34 + darkPixelScore * 0.26 + (lightCoverage / 4) * 0.22 + (darkCoverage / 4) * 0.18,
  };
}
