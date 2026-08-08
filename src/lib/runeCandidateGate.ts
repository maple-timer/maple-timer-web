import type { RuneCandidate } from "../recognition/rune/runeDetectionTypes";
import { isRuneCorePurple, isRuneDarkOutline, isRuneOutline, isRunePurple } from "./runeMask";

const MIN_CORE_PURPLE_PIXELS = 10;
const MIN_PURPLE_PIXELS = 18;
const MIN_FINAL_LEFT_RIGHT_SYMMETRY = 0.48;
const MIN_FINAL_TOP_BOTTOM_SYMMETRY = 0.42;
const MIN_FINAL_STRONG_CNN_TOP_BOTTOM_SYMMETRY = 0.38;
const MIN_FINAL_STRONG_CNN_SCORE = 0.98;
const MIN_FINAL_DARK_OUTLINE_ADJACENT_PIXELS = 8;
const MIN_FINAL_DARK_OUTLINE_SIDE_COUNT = 2;
const TINY_RUNE_MAX_DIMENSION = 7;
const MIN_FINAL_TINY_LIGHT_OUTLINE_PIXELS = 12;
const MIN_FINAL_TINY_LIGHT_OUTLINE_SIDE_COUNT = 3;
const COMPACT_STRONG_LIGHT_OUTLINE_MAX_DIMENSION = 12;
const MIN_FINAL_COMPACT_STRONG_LIGHT_OUTLINE_SCORE = 0.98;
const MIN_FINAL_COMPACT_LIGHT_OUTLINE_PIXELS = 24;
const MIN_FINAL_COMPACT_LIGHT_OUTLINE_SIDE_COUNT = 4;
const MIN_FINAL_COMPACT_DARK_OUTLINE_ADJACENT_PIXELS = 6;
const MIN_FINAL_COMPACT_DARK_OUTLINE_SIDE_COUNT = 3;
const MIN_FINAL_COMPACT_BRIGHT_OUTLINE_SCORE = 0.995;
const MIN_FINAL_COMPACT_BRIGHT_OUTLINE_PIXELS = 32;
const MIN_FINAL_COMPACT_BRIGHT_OUTLINE_RATIO = 0.32;
const MIN_FINAL_COMPACT_BRIGHT_OUTLINE_MIN_SIDE_PIXELS = 4;
const MIN_FINAL_COMPACT_BRIGHT_OUTLINE_SIDE_BALANCE = 0.45;
const MIN_FINAL_COMPACT_BRIGHT_CORE_RATIO = 0.45;
const COMPACT_CORE_DIAMOND_MAX_DIMENSION = 12;
const COMPACT_CORE_DIAMOND_MIN_DIMENSION = 7;
const MIN_FINAL_COMPACT_CORE_DIAMOND_CNN_SCORE = 0.78;
const MIN_FINAL_COMPACT_CORE_DIAMOND_CONFIDENCE = 0.62;
const MIN_FINAL_COMPACT_CORE_DIAMOND_PURPLE_PIXELS = 34;
const MIN_FINAL_COMPACT_CORE_DIAMOND_CORE_PIXELS = 12;
const MIN_FINAL_COMPACT_CORE_DIAMOND_CORE_RATIO = 0.34;
const MAX_FINAL_COMPACT_CORE_DIAMOND_NO_LIGHT_CORE_RATIO = 0.9;
const MIN_FINAL_COMPACT_CORE_DIAMOND_LIGHT_OUTLINE_PIXELS = 4;
const MIN_FINAL_COMPACT_CORE_DIAMOND_SYMMETRY = 0.72;
const MIN_FINAL_COMPACT_CORE_DIAMOND_DARK_SIDE_COUNT = 3;
const COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_MAX_DIMENSION = 10;
const MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_SCORE = 0.999;
const MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_CONFIDENCE = 0.78;
const MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_PURPLE_PIXELS = 52;
const MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_CORE_PIXELS = 28;
const MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_CORE_RATIO = 0.48;
const MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_SYMMETRY = 0.68;
const MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_PIXELS = 18;
const MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_SIDE_COUNT = 3;
const FLAT_MARKER_CORE_MIN_DIMENSION = 12;
const FLAT_MARKER_CORE_MIN_PLATEAU_RATIO = 0.24;
const FLAT_MARKER_CORE_MAX_SPARSE_ROW_RATIO = 0.18;
const LARGE_DIAMOND_SCAN_WEDGE_MIN_DIMENSION = 13;
const LARGE_DIAMOND_SCAN_WEDGE_MIN_WIDE_EDGE_RATIO = 0.62;
const LARGE_DIAMOND_SCAN_WEDGE_MAX_NARROW_EDGE_RATIO = 0.2;
const COMPACT_DIAMOND_SCAN_ATTACHED_CORE_MAX_DIMENSION = 10;
const MIN_COMPACT_DIAMOND_SCAN_ATTACHED_OUTER_CORE_PIXELS = 18;
const MIN_COMPACT_DIAMOND_SCAN_ATTACHED_OUTER_CORE_SIDE_PIXELS = 18;

type RuneCandidateGateStats = {
  corePurplePixels: number;
  purplePixels: number;
  innerCorePurplePixels: number;
  outerCorePurplePixels: number;
  outerCoreMaxSidePixels: number;
  leftRightSymmetry: number;
  topBottomSymmetry: number;
  darkOutlineAdjacentPixels: number;
  darkOutlineSideCount: number;
  lightOutlinePixels: number;
  lightOutlineSideCount: number;
  lightOutlineMinSidePixels: number;
  lightOutlineMaxSidePixels: number;
  innerTopEdgeRatio: number;
  innerBottomEdgeRatio: number;
  innerPeakPlateauRatio: number;
  innerSparseRowRatio: number;
};

export function passesRuneCandidateProposalGate(
  imageData: ImageData,
  candidate: RuneCandidate,
): boolean {
  const stats = getRuneCandidateGateStats(imageData, candidate);
  return (
    stats.corePurplePixels >= MIN_CORE_PURPLE_PIXELS &&
    stats.purplePixels >= MIN_PURPLE_PIXELS
  );
}

export function passesRuneCandidateFinalGate(
  imageData: ImageData,
  candidate: RuneCandidate,
): boolean {
  const stats = getRuneCandidateGateStats(imageData, candidate, { includeOutline: true });
  const maxDimension = Math.max(candidate.width, candidate.height);
  const hasDarkRuneOutline =
    stats.darkOutlineAdjacentPixels >= MIN_FINAL_DARK_OUTLINE_ADJACENT_PIXELS &&
    stats.darkOutlineSideCount >= MIN_FINAL_DARK_OUTLINE_SIDE_COUNT;
  const hasTinyRuneLightOutline =
    maxDimension <= TINY_RUNE_MAX_DIMENSION &&
    stats.lightOutlinePixels >= MIN_FINAL_TINY_LIGHT_OUTLINE_PIXELS &&
    stats.lightOutlineSideCount >= MIN_FINAL_TINY_LIGHT_OUTLINE_SIDE_COUNT;
  const hasCompactStrongLightOutline =
    maxDimension <= COMPACT_STRONG_LIGHT_OUTLINE_MAX_DIMENSION &&
    (candidate.cnnScore ?? 0) >= MIN_FINAL_COMPACT_STRONG_LIGHT_OUTLINE_SCORE &&
    stats.darkOutlineAdjacentPixels >= MIN_FINAL_COMPACT_DARK_OUTLINE_ADJACENT_PIXELS &&
    stats.darkOutlineSideCount >= MIN_FINAL_COMPACT_DARK_OUTLINE_SIDE_COUNT &&
    stats.lightOutlinePixels >= MIN_FINAL_COMPACT_LIGHT_OUTLINE_PIXELS &&
    stats.lightOutlineSideCount >= MIN_FINAL_COMPACT_LIGHT_OUTLINE_SIDE_COUNT;
  const compactBrightOutlinePixelFloor = Math.max(
    MIN_FINAL_COMPACT_BRIGHT_OUTLINE_PIXELS,
    Math.ceil(maxDimension * maxDimension * MIN_FINAL_COMPACT_BRIGHT_OUTLINE_RATIO),
  );
  const hasCompactBrightLightOutline =
    maxDimension <= COMPACT_STRONG_LIGHT_OUTLINE_MAX_DIMENSION &&
    (candidate.cnnScore ?? 0) >= MIN_FINAL_COMPACT_BRIGHT_OUTLINE_SCORE &&
    stats.corePurplePixels / Math.max(1, stats.purplePixels) >=
      MIN_FINAL_COMPACT_BRIGHT_CORE_RATIO &&
    stats.lightOutlinePixels >= compactBrightOutlinePixelFloor &&
    stats.lightOutlineSideCount >= MIN_FINAL_COMPACT_LIGHT_OUTLINE_SIDE_COUNT &&
    stats.lightOutlineMinSidePixels >= MIN_FINAL_COMPACT_BRIGHT_OUTLINE_MIN_SIDE_PIXELS &&
    stats.lightOutlineMinSidePixels / Math.max(1, stats.lightOutlineMaxSidePixels) >=
      MIN_FINAL_COMPACT_BRIGHT_OUTLINE_SIDE_BALANCE;
  const hasCompactCoreDiamond =
    candidate.source === "component" &&
    maxDimension <= COMPACT_CORE_DIAMOND_MAX_DIMENSION &&
    Math.min(candidate.width, candidate.height) >= COMPACT_CORE_DIAMOND_MIN_DIMENSION &&
    (candidate.cnnScore ?? 0) >= MIN_FINAL_COMPACT_CORE_DIAMOND_CNN_SCORE &&
    (candidate.heuristicConfidence ?? candidate.confidence) >=
      MIN_FINAL_COMPACT_CORE_DIAMOND_CONFIDENCE &&
    stats.purplePixels >= MIN_FINAL_COMPACT_CORE_DIAMOND_PURPLE_PIXELS &&
    stats.corePurplePixels >= MIN_FINAL_COMPACT_CORE_DIAMOND_CORE_PIXELS &&
    stats.corePurplePixels / Math.max(1, stats.purplePixels) >=
      MIN_FINAL_COMPACT_CORE_DIAMOND_CORE_RATIO &&
    (
      stats.lightOutlinePixels >= MIN_FINAL_COMPACT_CORE_DIAMOND_LIGHT_OUTLINE_PIXELS ||
      stats.corePurplePixels / Math.max(1, stats.purplePixels) <=
        MAX_FINAL_COMPACT_CORE_DIAMOND_NO_LIGHT_CORE_RATIO
    ) &&
    stats.leftRightSymmetry >= MIN_FINAL_COMPACT_CORE_DIAMOND_SYMMETRY &&
    stats.topBottomSymmetry >= MIN_FINAL_COMPACT_CORE_DIAMOND_SYMMETRY &&
    stats.darkOutlineSideCount >= MIN_FINAL_COMPACT_CORE_DIAMOND_DARK_SIDE_COUNT;
  const hasCompactUniformCoreWithoutLightOutline =
    candidate.source === "component" &&
    maxDimension <= COMPACT_CORE_DIAMOND_MAX_DIMENSION &&
    stats.lightOutlinePixels < MIN_FINAL_COMPACT_CORE_DIAMOND_LIGHT_OUTLINE_PIXELS &&
    stats.corePurplePixels / Math.max(1, stats.purplePixels) >
      MAX_FINAL_COMPACT_CORE_DIAMOND_NO_LIGHT_CORE_RATIO;
  const hasCompactDiamondScanPartialLightOutline =
    candidate.source === "diamond-scan" &&
    maxDimension <= COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_MAX_DIMENSION &&
    (candidate.cnnScore ?? 0) >= MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_SCORE &&
    (candidate.heuristicConfidence ?? candidate.confidence) >=
      MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_CONFIDENCE &&
    stats.purplePixels >= MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_PURPLE_PIXELS &&
    stats.corePurplePixels >= MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_CORE_PIXELS &&
    stats.corePurplePixels / Math.max(1, stats.purplePixels) >=
      MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_CORE_RATIO &&
    stats.leftRightSymmetry >= MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_SYMMETRY &&
    stats.topBottomSymmetry >= MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_SYMMETRY &&
    stats.lightOutlinePixels >= MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_PIXELS &&
    stats.lightOutlineSideCount >= MIN_FINAL_COMPACT_DIAMOND_SCAN_PARTIAL_LIGHT_SIDE_COUNT;
  const isStrongCnnRune =
    (candidate.cnnScore ?? 0) >= MIN_FINAL_STRONG_CNN_SCORE &&
    hasDarkRuneOutline &&
    stats.leftRightSymmetry >= MIN_FINAL_LEFT_RIGHT_SYMMETRY &&
    stats.topBottomSymmetry >= MIN_FINAL_STRONG_CNN_TOP_BOTTOM_SYMMETRY;
  const hasFlatMarkerCore =
    candidate.source === "component" &&
    maxDimension >= FLAT_MARKER_CORE_MIN_DIMENSION &&
    stats.innerPeakPlateauRatio >= FLAT_MARKER_CORE_MIN_PLATEAU_RATIO &&
    stats.innerSparseRowRatio <= FLAT_MARKER_CORE_MAX_SPARSE_ROW_RATIO;
  const hasLargeDiamondScanWedgeProfile =
    candidate.source === "diamond-scan" &&
    maxDimension >= LARGE_DIAMOND_SCAN_WEDGE_MIN_DIMENSION &&
    Math.max(stats.innerTopEdgeRatio, stats.innerBottomEdgeRatio) >=
      LARGE_DIAMOND_SCAN_WEDGE_MIN_WIDE_EDGE_RATIO &&
    Math.min(stats.innerTopEdgeRatio, stats.innerBottomEdgeRatio) <=
      LARGE_DIAMOND_SCAN_WEDGE_MAX_NARROW_EDGE_RATIO;
  const hasCompactDiamondScanAttachedOuterCore =
    candidate.source === "diamond-scan" &&
    maxDimension <= COMPACT_DIAMOND_SCAN_ATTACHED_CORE_MAX_DIMENSION &&
    stats.outerCorePurplePixels >= MIN_COMPACT_DIAMOND_SCAN_ATTACHED_OUTER_CORE_PIXELS &&
    stats.outerCorePurplePixels > stats.innerCorePurplePixels &&
    stats.outerCoreMaxSidePixels >= MIN_COMPACT_DIAMOND_SCAN_ATTACHED_OUTER_CORE_SIDE_PIXELS;

  return (
    stats.corePurplePixels >= MIN_CORE_PURPLE_PIXELS &&
    stats.purplePixels >= MIN_PURPLE_PIXELS &&
    !hasFlatMarkerCore &&
    !hasLargeDiamondScanWedgeProfile &&
    !hasCompactDiamondScanAttachedOuterCore &&
    !hasCompactUniformCoreWithoutLightOutline &&
    stats.leftRightSymmetry >= MIN_FINAL_LEFT_RIGHT_SYMMETRY &&
    (stats.topBottomSymmetry >= MIN_FINAL_TOP_BOTTOM_SYMMETRY || isStrongCnnRune) &&
    (
      hasDarkRuneOutline ||
      hasTinyRuneLightOutline ||
      hasCompactStrongLightOutline ||
      hasCompactBrightLightOutline ||
      hasCompactCoreDiamond ||
      hasCompactDiamondScanPartialLightOutline
    )
  );
}

function getRuneCandidateGateStats(
  imageData: ImageData,
  candidate: RuneCandidate,
  options: { includeOutline?: boolean } = {},
): RuneCandidateGateStats {
  const padding = Math.max(2, Math.ceil(Math.max(candidate.width, candidate.height) * 0.35));
  const left = Math.max(0, candidate.x - padding);
  const right = Math.min(imageData.width - 1, candidate.x + candidate.width + padding - 1);
  const top = Math.max(0, candidate.y - padding);
  const bottom = Math.min(imageData.height - 1, candidate.y + candidate.height + padding - 1);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const candidateCenterX = candidate.x + (candidate.width - 1) / 2;
  const candidateCenterY = candidate.y + (candidate.height - 1) / 2;
  const candidateRadius = Math.max(1, Math.max(candidate.width, candidate.height) / 2);
  let corePurplePixels = 0;
  let purplePixels = 0;
  let innerCorePurplePixels = 0;
  let outerCorePurplePixels = 0;
  let leftPurplePixels = 0;
  let rightPurplePixels = 0;
  let topPurplePixels = 0;
  let bottomPurplePixels = 0;
  let darkOutlineAdjacentPixels = 0;
  const darkOutlineSidePixels = [0, 0, 0, 0];
  let lightOutlinePixels = 0;
  const lightOutlineSidePixels = [0, 0, 0, 0];
  const outerCoreSidePixels = [0, 0, 0, 0];
  const innerPurpleRows = new Array(candidate.height).fill(0);

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const index = (y * imageData.width + x) * 4;
      const alpha = imageData.data[index + 3] ?? 255;
      if (alpha <= 24) {
        continue;
      }

      const red = imageData.data[index] ?? 0;
      const green = imageData.data[index + 1] ?? 0;
      const blue = imageData.data[index + 2] ?? 0;
      const isPurple = isRunePurple(red, green, blue) || isRuneCorePurple(red, green, blue);
      if (!isPurple) {
        if (options.includeOutline) {
          const dx = x - candidateCenterX;
          const dy = y - candidateCenterY;
          const diamondDistance = (Math.abs(dx) + Math.abs(dy)) / candidateRadius;
          if (diamondDistance >= 0.55 && diamondDistance <= 1.75) {
            const sideIndex = outlineSideIndex(dx, dy);
            if (isRuneDarkOutline(red, green, blue)) {
              if (hasAdjacentPurplePixel(imageData, x, y)) {
                darkOutlineAdjacentPixels += 1;
              }
              darkOutlineSidePixels[sideIndex] += 1;
            }
            if (isRuneOutline(red, green, blue)) {
              lightOutlinePixels += 1;
              lightOutlineSidePixels[sideIndex] += 1;
            }
          }
        }
        continue;
      }

      purplePixels += 1;
      if (isRuneCorePurple(red, green, blue)) {
        corePurplePixels += 1;
      }
      const isInsideCandidate =
        x >= candidate.x &&
        x < candidate.x + candidate.width &&
        y >= candidate.y &&
        y < candidate.y + candidate.height;
      if (isRuneCorePurple(red, green, blue)) {
        if (isInsideCandidate) {
          innerCorePurplePixels += 1;
        } else {
          outerCorePurplePixels += 1;
          outerCoreSidePixels[outlineSideIndex(x - candidateCenterX, y - candidateCenterY)] += 1;
        }
      }
      if (
        isInsideCandidate
      ) {
        innerPurpleRows[y - candidate.y] += 1;
      }
      if (x < centerX) {
        leftPurplePixels += 1;
      } else {
        rightPurplePixels += 1;
      }
      if (y < centerY) {
        topPurplePixels += 1;
      } else {
        bottomPurplePixels += 1;
      }
    }
  }

  return {
    corePurplePixels,
    purplePixels,
    innerCorePurplePixels,
    outerCorePurplePixels,
    outerCoreMaxSidePixels: Math.max(...outerCoreSidePixels),
    leftRightSymmetry: symmetryRatio(leftPurplePixels, rightPurplePixels),
    topBottomSymmetry: symmetryRatio(topPurplePixels, bottomPurplePixels),
    darkOutlineAdjacentPixels,
    darkOutlineSideCount: countPopulatedSides(darkOutlineSidePixels),
    lightOutlinePixels,
    lightOutlineSideCount: countPopulatedSides(lightOutlineSidePixels),
    lightOutlineMinSidePixels: Math.min(...lightOutlineSidePixels),
    lightOutlineMaxSidePixels: Math.max(...lightOutlineSidePixels),
    ...getInnerPurpleRowShapeStats(innerPurpleRows),
  };
}

function getInnerPurpleRowShapeStats(rowWidths: number[]) {
  const maxWidth = Math.max(1, ...rowWidths);
  const topEdgeWidth = Math.max(rowWidths[0] ?? 0, rowWidths[1] ?? 0);
  const bottomEdgeWidth = Math.max(
    rowWidths[rowWidths.length - 1] ?? 0,
    rowWidths[rowWidths.length - 2] ?? 0,
  );
  const peakPlateauRows = rowWidths.filter((width) => width >= maxWidth * 0.92).length;
  const sparseRows = rowWidths.filter((width) => width <= Math.max(2, maxWidth * 0.35)).length;

  return {
    innerTopEdgeRatio: topEdgeWidth / maxWidth,
    innerBottomEdgeRatio: bottomEdgeWidth / maxWidth,
    innerPeakPlateauRatio: peakPlateauRows / Math.max(1, rowWidths.length),
    innerSparseRowRatio: sparseRows / Math.max(1, rowWidths.length),
  };
}

function symmetryRatio(a: number, b: number): number {
  return 1 - Math.abs(a - b) / Math.max(1, a + b);
}

function outlineSideIndex(dx: number, dy: number): number {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx < 0 ? 0 : 1;
  }
  return dy < 0 ? 2 : 3;
}

function countPopulatedSides(sidePixels: number[]): number {
  return sidePixels.filter((value) => value >= 2).length;
}

function hasAdjacentPurplePixel(imageData: ImageData, x: number, y: number): boolean {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) {
        continue;
      }
      if (isPurplePixelAt(imageData, x + offsetX, y + offsetY)) {
        return true;
      }
    }
  }
  return false;
}

function isPurplePixelAt(imageData: ImageData, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) {
    return false;
  }
  const index = (y * imageData.width + x) * 4;
  const alpha = imageData.data[index + 3] ?? 255;
  if (alpha <= 24) {
    return false;
  }
  const red = imageData.data[index] ?? 0;
  const green = imageData.data[index + 1] ?? 0;
  const blue = imageData.data[index + 2] ?? 0;
  return isRunePurple(red, green, blue) || isRuneCorePurple(red, green, blue);
}
