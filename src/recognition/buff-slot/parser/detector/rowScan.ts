import type { BuffIconBox, ExtractBuffIconsOptions, FeatureMaps, ImageLike, Rect, RowCandidate } from "../types.js";
import { detectCompactTopRightRow, rowsToBoxes } from "./cellRefine.js";
import {
  completeStrongRowLeftEdges,
  finalizeDetectedBoxes,
  normalizeCompactSupportedColumns,
  normalizeFinalBoxSizes,
  snapLowConfidenceCompactInternalGaps,
  snapCompactShortRailRowsToGrid,
  snapCompactRowsToLocalPitch,
  snapRightRailSingletonColumns,
  recoverScoredTopRightTwoRowGrid,
  separateOverlappingFinalBoxes,
  snapRowsToScoredNonOverlappingPitch,
} from "./completion.js";
import { createDetectionContext } from "./context.js";
import { clamp, clamp01, mean } from "./math.js";
import { pruneDetachedDamageRows } from "./pruning.js";
import {
  completeCompactDenseRowInternalVisualGaps,
  completeCompactDenseRowLeftVisualEdges,
  completeCompactPartialRowsToRightRail,
  completeFinalCompactTopLeftFromRightEdgeAnchor,
  completeCompactRowsFromRightEdgeAnchor,
  completeCompactRowsToSupportedColumns,
  completeCompactDenseInternalLocalPitchGaps,
  completeCompactShortRailLeftVisualEdges,
  completeFinalRightRailSingletonRows,
  completeCompactLowerRightEdgeSupportedColumnsFinal,
  completeCompactFinalSupportedColumnGaps,
  completeCompactTitleBarTopRow,
  completeCompactTopLeftSupportedColumnsFinal,
  completeCompactTrailingRowsFromRailStructureFinal,
  completeTopRightTwoRowRailGrid,
  pruneCompactFinalArtifacts,
  completeSupportedTopRowColumns,
  pruneCompactLocalFalsePrefixes,
  pruneFinalShortRailPrefixes,
  stabilizeCompactSecondRowFinal,
  pruneWeakTopLeftVisualExtensions,
} from "./rightAlignedCompletion.js";
import { appendRightRailSingletons } from "./rightRail.js";
import { isLowResCompactBuffLayout } from "./completionShared.js";
import { completeStructuralRowGaps } from "./rowGapCompletion.js";
import { rowCellThreshold, scoreTightSlot } from "./scoring.js";
import { completeMissingShortRightRailRows, completeProjectedCompactRowsBelowTopGrid, completeShortRightRailRowsFromVerticalGaps, completeSingletonSupportedShortRows } from "./shortRailCompletion.js";
import { completeMissingTopRailRows, completeTopClippedRightEdgeRows, completeVisibleTopRightRow } from "./topRowCompletion.js";
import { scanGappedGridBoxes } from "./legacyCandidateScan.js";

const CROPPED_1366_COMPACT_LAYOUT = { minBoxes: 8, maxImageWidth: 1365, maxImageHeight: 765 } as const;

export function detectRows(
  maps: FeatureMaps,
  roi: Rect,
  image: ImageLike,
  options: ExtractBuffIconsOptions,
  maxIcons: number,
): BuffIconBox[] {
  const adaptiveMinSlotSize = Math.floor(Math.min(image.width, image.height) * 0.014);
  const minSlotSize = options.minSlotSize ?? Math.max(32, adaptiveMinSlotSize, resolutionMinSlotSize(image));
  const adaptiveMaxSlotSize = Math.ceil(Math.min(image.width, image.height) * 0.045);
  const maxSlotSize = Math.min(options.maxSlotSize ?? Math.max(64, adaptiveMaxSlotSize), 96, maps.width, maps.height);
  const rightMarginMax = Math.round(clamp(image.width * 0.055, 52, 150));
  const rightMarginMin = -Math.round(Math.min(16, image.width * 0.005));
  const minGlobalX =
    options.inputMode === "croppedRoi" || options.inputMode === "topRightQuadrant"
      ? roi.x
      : image.width * 0.55;
  const rowCandidates: RowCandidate[] = [];

  for (let size = minSlotSize; size <= maxSlotSize; size++) {
    const yStep = Math.max(1, Math.round(size / 20));
    const xStep = Math.max(1, Math.round(size / 18));
    const maxLocalY = Math.min(maps.height - size, Math.round(image.height * 0.24));
    const minCellScore = rowCellThreshold(size);

    for (let localY = 0; localY <= maxLocalY; localY += yStep) {
      for (
        let localRightX = maps.width - size - rightMarginMax;
        localRightX <= maps.width - size - rightMarginMin;
        localRightX += xStep
      ) {
        if (localRightX < 0 || localRightX + size > maps.width) continue;
        const traced = traceRow(maps, roi, localRightX, localY, size, minCellScore, minGlobalX);
        if (!traced || traced.count < 2) continue;
        rowCandidates.push(traced);
      }
    }
  }

  const selectedRows = selectRows(rowCandidates, image, maxIcons);
  const primaryBoxes = finalizeDetectedBoxes(rowsToBoxes(selectedRows, maps, roi, maxIcons), maps, roi, image, options, minGlobalX, maxIcons);
  if (primaryBoxes.length > 1) return appendRailAndPrune(primaryBoxes, maps, roi, image, options, maxIcons);

  const gappedGridBoxes = primaryBoxes.length <= 1 ? scanGappedGridBoxes(maps, roi, image, options, maxIcons) : [];
  if (gappedGridBoxes.length > primaryBoxes.length + 3) return appendRailAndPrune(gappedGridBoxes, maps, roi, image, options, maxIcons);

  const compactTopRow = primaryBoxes.length <= 1 ? detectCompactTopRightRow(maps, roi, image, options, maxIcons) : [];
  const compactFallback =
    compactTopRow.length > 4 && primaryBoxes.length <= 1 && roi.y > 0 && image.width <= 1500 ? compactTopRow.slice(-3) : compactTopRow;
  if (compactFallback.length > primaryBoxes.length + 1 && compactFallback.length <= 4) return normalizeFinalBoxSizes(compactFallback, image);
  if (primaryBoxes.length > 0) return appendRailAndPrune(primaryBoxes, maps, roi, image, options, maxIcons);

  const sparseRows = selectSparseRightRows(rowCandidates, image);
  return finalizeDetectedBoxes(rowsToBoxes(sparseRows, maps, roi, maxIcons), maps, roi, image, options, minGlobalX, maxIcons);
}

function appendRailAndPrune(
  boxes: BuffIconBox[],
  maps: FeatureMaps,
  roi: Rect,
  image: ImageLike,
  options: ExtractBuffIconsOptions,
  maxIcons: number,
) {
  const pruned = pruneDetachedDamageRows(boxes, image);
  const firstRailPass = pruneDetachedDamageRows(appendRightRailSingletons(pruned, maps, roi, image, options, maxIcons), image);
  const secondRailPass =
    firstRailPass.length > pruned.length
      ? pruneDetachedDamageRows(appendRightRailSingletons(firstRailPass, maps, roi, image, options, maxIcons), image)
      : firstRailPass;
  const ctx = createDetectionContext(maps, roi, image, options, maxIcons);
  const completedLeftEdges = completeStrongRowLeftEdges(secondRailPass, ctx);
  const normalized = normalizeFinalBoxSizes(pruneDetachedDamageRows(completedLeftEdges, image), image);
  const compactColumns = normalizeCompactSupportedColumns(normalized, image);
  const localPitchSnapped = snapCompactRowsToLocalPitch(compactColumns, maps, roi, image);
  const rightRailColumnSnapped = snapRightRailSingletonColumns(localPitchSnapped, image);
  const lowResCompactLayout = isLowResCompactBuffLayout(rightRailColumnSnapped, image, CROPPED_1366_COMPACT_LAYOUT);
  const missingTopRecovered = lowResCompactLayout ? completeMissingTopRailRows(rightRailColumnSnapped, ctx) : rightRailColumnSnapped;
  const visibleTopRecovered = lowResCompactLayout ? completeVisibleTopRightRow(missingTopRecovered, ctx) : missingTopRecovered;
  const clippedTopRecovered = lowResCompactLayout ? completeTopClippedRightEdgeRows(visibleTopRecovered, ctx) : visibleTopRecovered;
  const supportedTopColumns = completeSupportedTopRowColumns(clippedTopRecovered, ctx);
  const compactAnchorCompleted = completeCompactRowsFromRightEdgeAnchor(supportedTopColumns, ctx);
  const projectedCompactRows = completeProjectedCompactRowsBelowTopGrid(compactAnchorCompleted, ctx);
  const structuralGapsCompleted = completeStructuralRowGaps(projectedCompactRows, ctx);
  const shortRailRecovered = completeShortRightRailRowsFromVerticalGaps(structuralGapsCompleted, ctx);
  const shortRailLeftCompleted = completeCompactShortRailLeftVisualEdges(shortRailRecovered, ctx);
  const denseGapsCompleted = completeCompactDenseRowInternalVisualGaps(shortRailLeftCompleted, ctx);
  const denseLeftCompleted = completeCompactDenseRowLeftVisualEdges(denseGapsCompleted, ctx);
  const supportedColumnsCompleted = completeCompactRowsToSupportedColumns(denseLeftCompleted, ctx);
  const partialRowsCompleted = completeCompactPartialRowsToRightRail(supportedColumnsCompleted, ctx);
  const finalDenseGapsCompleted = completeCompactDenseRowInternalVisualGaps(partialRowsCompleted, ctx);
  const finalShortRailRecovered = completeMissingShortRightRailRows(finalDenseGapsCompleted, ctx);
  const finalSingletonSupported = completeSingletonSupportedShortRows(finalShortRailRecovered, ctx);
  const finalRightRailSingletons = completeFinalRightRailSingletonRows(finalSingletonSupported, ctx);
  const topLeftPruned = pruneWeakTopLeftVisualExtensions(finalRightRailSingletons, ctx);
  const finalTopLeftRecovered = completeFinalCompactTopLeftFromRightEdgeAnchor(topLeftPruned, ctx);
  const compactRailSnapped = snapCompactShortRailRowsToGrid(finalTopLeftRecovered, image);
  const finalShortPruned = pruneFinalShortRailPrefixes(compactRailSnapped, image);
  const finalLocalPitchGapsCompleted = completeCompactDenseInternalLocalPitchGaps(finalShortPruned, ctx);
  const finalLocalPitchSnapped = snapCompactRowsToLocalPitch(finalLocalPitchGapsCompleted, maps, roi, image);
  const finalPrefixPruned = pruneCompactLocalFalsePrefixes(finalLocalPitchSnapped, ctx);
  const finalTitleBarTopRecovered = completeCompactTitleBarTopRow(finalPrefixPruned, ctx);
  const finalSupportedTopLeftRecovered = completeCompactTopLeftSupportedColumnsFinal(finalTitleBarTopRecovered, ctx);
  const finalLowerRightRecovered = completeCompactLowerRightEdgeSupportedColumnsFinal(finalSupportedTopLeftRecovered, ctx);
  const finalTrailingRailRecovered = completeCompactTrailingRowsFromRailStructureFinal(finalLowerRightRecovered, ctx);
  const finalSupportedColumnGapsRecovered = completeCompactFinalSupportedColumnGaps(finalTrailingRailRecovered, ctx);
  const finalSecondRowStabilized = stabilizeCompactSecondRowFinal(finalSupportedColumnGapsRecovered, ctx);
  const finalArtifactsPruned = pruneCompactFinalArtifacts(finalSecondRowStabilized, ctx);
  const finalTwoRowRailCompleted = completeTopRightTwoRowRailGrid(finalArtifactsPruned, ctx);
  const finalTwoRowFrameRecovered = recoverScoredTopRightTwoRowGrid(finalTwoRowRailCompleted, maps, roi, image, maxIcons);
  const finalSeparated = separateOverlappingFinalBoxes(finalTwoRowFrameRecovered, image);
  const finalPitchSnapped = snapRowsToScoredNonOverlappingPitch(finalSeparated, maps, roi, image);
  return snapLowConfidenceCompactInternalGaps(finalPitchSnapped, image).sort((a, b) => a.y - b.y || a.x - b.x);
}

function resolutionMinSlotSize(image: ImageLike) {
  const minDimension = Math.min(image.width, image.height);
  if (minDimension >= 1900) return 60;
  if (minDimension >= 1250) return 52;
  return 0;
}

function selectSparseRightRows(rows: RowCandidate[], image: ImageLike) {
  const topLimit = Math.max(72, image.height * 0.13);
  const rightMarginLimit = Math.round(clamp(image.width * 0.06, 48, 130));
  const rightMarginMin = -Math.round(Math.min(12, image.width * 0.004));
  const candidates = rows
    .filter((row) => row.count >= 2 && row.count <= 4)
    .filter((row) => row.y <= topLimit)
    .filter((row) => row.x >= image.width * 0.72)
    .filter((row) => {
      const rightMargin = image.width - (row.x + row.count * row.size);
      return rightMargin >= rightMarginMin && rightMargin <= rightMarginLimit;
    })
    .filter((row) => {
      const threshold = rowCellThreshold(row.size);
      return mean(row.cellScores) >= threshold + 48 && Math.min(...row.cellScores) >= threshold + 18;
    })
    .map((row) => {
      const rightMargin = image.width - (row.x + row.count * row.size);
      const meanScore = mean(row.cellScores);
      const minScore = Math.min(...row.cellScores);
      const rightness = 1 - clamp01(Math.max(0, rightMargin) / rightMarginLimit);
      const topness = 1 - clamp01(row.y / topLimit);
      const shortRowScore = meanScore * row.count + minScore * 0.7 + rightness * 180 + topness * 60 + row.size * 2;
      return { ...row, score: shortRowScore };
    })
    .sort((a, b) => b.score - a.score);

  const selected: RowCandidate[] = [];
  for (const row of candidates) {
    if (selected.some((other) => rowOverlap(row, other) > 0.25 || sameRowBand(row, other))) continue;
    selected.push(row);
    if (selected.length >= 1) break;
  }
  return selected;
}

function traceRow(
  maps: FeatureMaps,
  roi: Rect,
  localRightX: number,
  localY: number,
  size: number,
  minCellScore: number,
  minGlobalX: number,
): RowCandidate | undefined {
  const cells: { x: number; score: number }[] = [];
  let misses = 0;

  for (let localX = localRightX; localX + size >= minGlobalX - roi.x; localX -= size) {
    if (localX < 0 || localX + size > maps.width || localY < 0 || localY + size > maps.height) break;
    const score = scoreTightSlot(maps, localX, localY, size).score;
    if (score >= minCellScore) {
      cells.push({ x: localX + roi.x, score });
      misses = 0;
    } else {
      misses++;
      if (cells.length === 0 || misses >= 1) break;
    }
  }

  if (cells.length < 2) return undefined;
  cells.reverse();
  const scoreSum = cells.reduce((sum, cell) => sum + cell.score, 0);
  const meanScore = scoreSum / cells.length;
  const rightness = clamp01((cells[cells.length - 1]!.x + size - minGlobalX) / Math.max(1, roi.x + roi.width - minGlobalX));
  const topness = 1 - clamp01((localY + roi.y) / Math.max(1, roi.height));
  const sizeWeight = Math.pow(clamp(size / 42, 0.68, 1.75), 2.4);
  const countWeight = Math.min(cells.length, 14) + Math.max(0, cells.length - 14) * 0.28;
  const rowScore = (meanScore * countWeight + cells.length * size * 1.2 + rightness * 130 + topness * 28) * sizeWeight;

  return {
    x: cells[0]!.x,
    y: localY + roi.y,
    size,
    count: cells.length,
    score: rowScore,
    cellScores: cells.map((cell) => cell.score),
  };
}

function selectRows(rows: RowCandidate[], image: ImageLike, maxIcons: number) {
  const selected: RowCandidate[] = [];
  const family = selectSizeFamily(rows);
  if (!family) return selected;
  const sorted = rows
    .filter((row) => Math.abs(row.size - family) <= Math.max(2, family * 0.045))
    .filter((row) => row.count >= (image.width <= 1400 ? 2 : 3) || row.score > row.count * 250)
    .sort((a, b) => b.score - a.score);

  for (const row of sorted) {
    const duplicate = selected.some((other) => rowOverlap(row, other) > 0.42 || sameRowFamily(row, other) || sameRowBand(row, other));
    if (duplicate) continue;
    selected.push(row);
    const iconCount = selected.reduce((sum, item) => sum + item.count, 0);
    if (selected.length >= 5 || iconCount >= maxIcons) break;
  }

  return selected
    .filter((row) => !isIntermediateRow(row, selected))
    .filter((row) => row.count >= 2)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function isIntermediateRow(row: RowCandidate, rows: RowCandidate[]) {
  const above = rows.filter((other) => isNeighborBand(row, other, -1));
  const below = rows.filter((other) => isNeighborBand(row, other, 1));
  if (above.length === 0 || below.length === 0) return false;
  const strongestAbove = Math.max(...above.map((other) => other.score));
  const strongestBelow = Math.max(...below.map((other) => other.score));
  return strongestAbove > row.score * 1.08 && strongestBelow > row.score * 1.08;
}

function isNeighborBand(row: RowCandidate, other: RowCandidate, direction: -1 | 1) {
  if (row === other) return false;
  const size = (row.size + other.size) / 2;
  if (Math.abs(row.size - other.size) > Math.max(3, size * 0.1)) return false;
  const dy = (other.y - row.y) * direction;
  if (dy < size * 0.42 || dy > size * 0.78) return false;
  return rowHorizontalOverlap(row, other) > 0.28;
}

function rowHorizontalOverlap(a: RowCandidate, b: RowCandidate) {
  const ax2 = a.x + a.count * a.size;
  const bx2 = b.x + b.count * b.size;
  const overlapWidth = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const minWidth = Math.min(a.count * a.size, b.count * b.size);
  return overlapWidth / Math.max(1, minWidth);
}

function selectSizeFamily(rows: RowCandidate[]) {
  const buckets = new Map<number, RowCandidate[]>();
  for (const row of rows) {
    const bucket = Math.round(row.size / 2) * 2;
    const list = buckets.get(bucket) ?? [];
    list.push(row);
    buckets.set(bucket, list);
  }

  const scored: { size: number; score: number; rows: number; count: number; strongScore: number; strongRows: number }[] = [];
  for (const [size, members] of buckets) {
    const topRows = members.sort((a, b) => b.score - a.score).slice(0, 6);
    const rowScore = topRows.reduce((sum, row) => sum + row.score, 0);
    const countScore = topRows.reduce((sum, row) => sum + Math.min(row.count, 14) * 35, 0);
    const strongRows = topRows.filter((row) => mean(row.cellScores) >= rowCellThreshold(row.size) + 60 && row.count >= 2);
    const strongScore = strongRows.reduce((sum, row) => sum + row.score, 0);
    const score = rowScore + countScore;
    scored.push({
      size,
      score,
      rows: topRows.length,
      count: topRows.reduce((sum, row) => sum + row.count, 0),
      strongScore,
      strongRows: strongRows.length,
    });
  }
  if (scored.length === 0) return undefined;
  const strong = scored.filter((item) => item.strongRows > 0);
  if (strong.length > 0) {
    const bestStrong = Math.max(...strong.map((item) => item.strongScore));
    const strongViable = strong
      .filter((item) => item.strongScore >= bestStrong * 0.45)
      .filter((item) => item.count >= 2)
      .sort((a, b) => a.size - b.size);
    if (strongViable[0]) {
      const outerFrameFamily = selectDominantOuterFrameFamily(strongViable[0], scored);
      return outerFrameFamily ?? strongViable[0].size;
    }
  }
  const bestScore = Math.max(...scored.map((item) => item.score));
  const viable = scored
    .filter((item) => item.score >= bestScore * 0.52)
    .filter((item) => item.rows >= 1 && item.count >= 2)
    .sort((a, b) => a.size - b.size);
  return (viable[0] ?? scored.sort((a, b) => b.score - a.score)[0])?.size;
}

function selectDominantOuterFrameFamily(
  selected: { size: number; score: number; count: number },
  scored: { size: number; score: number; rows: number; count: number; strongScore: number; strongRows: number }[],
) {
  if (selected.size >= 40) return undefined;
  const larger = scored
    .filter((item) => item.size >= 42 && item.size <= 50)
    .filter((item) => item.score >= selected.score * 2.15)
    .filter((item) => item.count >= selected.count * 1.8)
    .filter((item) => item.rows >= 4)
    .sort((a, b) => b.score - a.score);
  return larger[0]?.size;
}

function sameRowFamily(a: RowCandidate, b: RowCandidate) {
  const size = (a.size + b.size) / 2;
  const sameY = Math.abs(a.y - b.y) <= size * 0.42;
  const similarSize = Math.abs(a.size - b.size) <= Math.max(3, size * 0.09);
  if (!sameY || !similarSize) return false;
  const aRight = a.x + a.count * a.size;
  const bRight = b.x + b.count * b.size;
  return Math.abs(aRight - bRight) <= size * 0.8;
}

function sameRowBand(a: RowCandidate, b: RowCandidate) {
  const size = (a.size + b.size) / 2;
  const sameY = Math.abs(a.y - b.y) <= size * 0.48;
  const similarSize = Math.abs(a.size - b.size) <= Math.max(3, size * 0.09);
  if (!sameY || !similarSize) return false;
  const ax2 = a.x + a.count * a.size;
  const bx2 = b.x + b.count * b.size;
  const overlapWidth = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const minWidth = Math.min(a.count * a.size, b.count * b.size);
  return overlapWidth / Math.max(1, minWidth) > 0.22;
}

function rowOverlap(a: RowCandidate, b: RowCandidate) {
  const ax2 = a.x + a.count * a.size;
  const bx2 = b.x + b.count * b.size;
  const ay2 = a.y + a.size;
  const by2 = b.y + b.size;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(ax2, bx2);
  const y2 = Math.min(ay2, by2);
  const width = Math.max(0, x2 - x1);
  const height = Math.max(0, y2 - y1);
  const intersection = width * height;
  const union = a.count * a.size * a.size + b.count * b.size * b.size - intersection;
  return union <= 0 ? 0 : intersection / union;
}
