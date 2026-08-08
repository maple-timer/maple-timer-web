import type { BuffIconBox, GridRowInfo } from "../types.js";
import type { DetectionContext } from "./context.js";
import { refineTightCell } from "./cellRefine.js";
import { clusterBoxesByRow, describeGridRow, estimateConsensusRightSlot, estimateGlobalGrid } from "./grid.js";
import { iou, mean, median } from "./math.js";
import { hasLikelyBuffFrame } from "./pruning.js";
import { rowCellThreshold, scoreTightSlot } from "./scoring.js";
import { describePitchRow, estimateVisibleVerticalPitch, estimateVerticalPitchFromWideGaps, expandShortGridRowSlots, hasExistingRowNear, probeRightEdgeRun, uniqueInts } from "./completionShared.js";

export function completeMissingTopRailRows(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 8) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const grid = estimateGlobalGrid(rows);
  if (!grid) return boxes;

  const rowInfos = rows
    .map((row) => describeGridRow(row, grid))
    .filter((row): row is GridRowInfo => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  if (rowInfos.length < 2) return boxes;

  const first = rowInfos[0]!;
  const rowSize = Math.round(median([first.rowSize, grid.size]));
  if (first.rowY - roi.y <= Math.max(10, rowSize * 0.45)) return boxes;
  if (first.sorted.length < 6) return boxes;

  const verticalPitch =
    estimateVisibleVerticalPitch(rowInfos, rowSize) ?? estimateVerticalPitchFromWideGaps(rowInfos, rowSize) ?? Math.round(rowSize * 1.08);
  const predictedY = Math.max(roi.y, Math.round(first.rowY - verticalPitch));
  if (predictedY > Math.max(12, rowSize * 0.32)) return boxes;

  const targetRightSlot = estimateConsensusRightSlot(rowInfos) ?? first.maxSlot;
  const rowScore = median(first.sorted.map((box) => box.score));
  const minScore = options.minBoxScore ?? 190;
  const acceptScore = Math.max(minScore - 14, rowCellThreshold(rowSize) + 38, rowScore * 0.46);
  const slotSupport = new Map<number, number>();
  for (const row of rowInfos) {
    if (row.sorted.length < 4) continue;
    for (const slot of new Set(row.slots)) slotSupport.set(slot, (slotSupport.get(slot) ?? 0) + 1);
  }
  const candidateYs = uniqueInts([
    predictedY,
    roi.y + Math.round(rowSize * 0.08),
    roi.y + Math.round(rowSize * 0.12),
    roi.y + Math.round(rowSize * 0.18),
  ]).filter((y) => y >= roi.y && y <= roi.y + Math.max(12, rowSize * 0.38));
  const runs: BuffIconBox[][] = [];

  for (const y of candidateYs) {
    if (hasExistingRowNear(rows, boxes, y, rowSize)) continue;
    const candidates: BuffIconBox[] = [];
    let misses = 0;
    for (let slot = targetRightSlot; slot >= targetRightSlot - 8; slot--) {
      const predictedX = Math.round(grid.anchor + slot * grid.pitch);
      const direct = { x: predictedX, y, size: rowSize };
      if (direct.x < 0 || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
      if (boxes.some((box) => iou(box, direct) > 0.22)) continue;

      const directScore = scoreTightSlot(maps, predictedX - roi.x, y - roi.y, rowSize).score;
      const refined = refineTightCell(predictedX, y, rowSize, maps, roi, Math.round(rowSize * 0.32));
      const closeToSlot =
        refined && Math.abs(refined.x - predictedX) <= rowSize * 0.34 && Math.abs(refined.y - y) <= rowSize * 0.42;
      const supported = (slotSupport.get(slot) ?? 0) >= 1;
      const score = Math.max(directScore, closeToSlot ? refined.score : 0);
      const supportedClippedCell =
        supported &&
        Boolean(refined && closeToSlot) &&
        score >= acceptScore - 34 &&
        (refined!.confidence >= 0.52 || directScore >= acceptScore - 28);
      if (!refined || !closeToSlot || (score < acceptScore && !supportedClippedCell)) {
        misses++;
        if (candidates.length > 0 && misses >= 2) break;
        continue;
      }

      candidates.push({
        ...refined,
        x: predictedX,
        y: Math.round(refined.y),
        size: rowSize,
        score: Math.max(score, minScore),
        confidence: Math.max(refined.confidence, supportedClippedCell ? 0.68 : 0.74),
      });
      misses = 0;
    }
    if (candidates.length >= 3) runs.push(candidates);
  }

  if (runs.length === 0) return boxes;
  const best = runs.sort((a, b) => b.length - a.length || mean(b.map((box) => box.score)) - mean(a.map((box) => box.score)))[0]!;
  const rowY = Math.round(median(best.map((box) => box.y)));
  return [...boxes, ...best.map((box) => ({ ...box, y: rowY }))];
}

export function completeVisibleTopRightRow(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 8) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const grid = estimateGlobalGrid(rows);
  if (!grid) return boxes;

  const rowInfos = rows
    .map((row) => describeGridRow(row, grid))
    .filter((row): row is GridRowInfo => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  if (rowInfos.length < 2) return boxes;

  const rowSize = Math.round(median(rowInfos.flatMap((row) => row.sorted.map((box) => box.size))));
  const existingTopRow = rowInfos[0]!.rowY - roi.y <= Math.max(10, rowSize * 0.45) ? rowInfos[0] : undefined;
  if (existingTopRow && isPlausibleExistingTopRow(existingTopRow.sorted, rowSize, image)) return boxes;
  const hasSubstantialTopRow = rows.some((row) => {
    const rowY = Math.round(median(row.map((box) => box.y)));
    return rowY - roi.y <= Math.max(10, rowSize * 0.45) && isPlausibleExistingTopRow(row, rowSize, image);
  });
  if (!existingTopRow && hasSubstantialTopRow) return boxes;

  const targetRightSlot = estimateConsensusRightSlot(rowInfos) ?? Math.max(...rowInfos.flatMap((row) => row.slots));
  const minScore = options.minBoxScore ?? 190;
  const acceptScore = Math.max(minScore - 16, rowCellThreshold(rowSize) + 34);
  const yLimit = Math.round(Math.max(12, rowSize * 0.36));
  const runs: BuffIconBox[][] = [];

  for (let y = roi.y; y <= roi.y + yLimit; y += 2) {
    const run: BuffIconBox[] = [];
    for (let slot = targetRightSlot; slot >= targetRightSlot - 6; slot--) {
      const predictedX = Math.round(grid.anchor + slot * grid.pitch);
      const direct = { x: predictedX, y, size: rowSize };
      if (direct.x < 0 || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
      if (boxes.some((box) => iou(box, direct) > 0.22)) continue;

      const refined = refineTightCell(predictedX, y, rowSize, maps, roi, Math.round(rowSize * 0.28));
      const closeToSlot = refined && Math.abs(refined.x - predictedX) <= rowSize * 0.3 && Math.abs(refined.y - y) <= rowSize * 0.36;
      if (!refined || refined.score < acceptScore || !closeToSlot) {
        if (run.length > 0) break;
        continue;
      }
      run.push({
        ...refined,
        x: predictedX,
        y: Math.round(refined.y),
        size: rowSize,
        score: Math.max(refined.score, minScore),
        confidence: Math.max(refined.confidence, 0.74),
      });
    }
    if (run.length >= 3) runs.push(run);
  }

  if (runs.length === 0) return boxes;
  const best = runs.sort((a, b) => b.length - a.length || mean(b.map((box) => box.score)) - mean(a.map((box) => box.score)))[0]!;
  const rowY = Math.round(median(best.map((box) => box.y)));
  return [...boxes, ...best.map((box) => ({ ...box, y: rowY }))];
}

function isPlausibleExistingTopRow(row: BuffIconBox[], rowSize: number, image: DetectionContext["image"]) {
  if (row.length < 3) return false;
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const size = Math.round(median(sorted.map((box) => box.size)));
  const stablePitch = hasPlausiblePitch(sorted, size || rowSize);
  const frameCount = sorted.filter((box) => hasLikelyBuffFrame(image, box)).length;
  return stablePitch || frameCount >= Math.max(2, Math.ceil(sorted.length * 0.5));
}

function hasPlausiblePitch(sorted: BuffIconBox[], size: number) {
  const gaps = sorted.slice(0, -1).map((box, index) => sorted[index + 1]!.x - box.x);
  if (gaps.length === 0) return false;
  const pitch = median(gaps);
  return gaps.every((gap) => Math.abs(gap - pitch) <= Math.max(5, size * 0.28));
}

export function completeTopClippedRightEdgeRows(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 3) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const pitchRows = rows
    .map((row) => describePitchRow(row))
    .filter((row): row is NonNullable<ReturnType<typeof describePitchRow>> => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  if (pitchRows.length === 0) return boxes;

  const topExists = pitchRows.some((row) => row.rowY - roi.y <= Math.max(10, row.size * 0.45));
  if (topExists) return boxes;

  const reference = pitchRows.find((row) => {
    if (row.sorted.length < 3 || row.size < 28 || row.size > 66) return false;
    if (row.rowY - roi.y < row.size * 0.72 || row.rowY - roi.y > row.size * 1.55) return false;
    return image.width - (row.rightX + row.size) <= Math.max(28, row.size * 1.25);
  });
  if (!reference) return boxes;

  const candidateYs = uniqueInts([
    roi.y + Math.round(reference.size * 0.08),
    roi.y + Math.round(reference.size * 0.12),
    Math.max(roi.y, reference.rowY - Math.round(reference.size * 1.15)),
  ]);
  const minScore = options.minBoxScore ?? 190;
  const runs = candidateYs
    .map((y) => probeRightEdgeRun(reference, y, ctx, boxes, minScore, true))
    .filter((run) => run.length > 0)
    .sort((a, b) => b.length - a.length || mean(b.map((box) => box.score)) - mean(a.map((box) => box.score)));
  const best = runs[0];
  if (!best) return boxes;

  const strongSingleton = best.length === 1 && best[0]!.score >= Math.max(250, median(reference.sorted.map((box) => box.score)) * 0.84);
  if (best.length < 2 && !strongSingleton) return boxes;
  const rowY = Math.round(median(best.map((box) => box.y)));
  return [...boxes, ...best.map((box) => ({ ...box, y: rowY, size: reference.size }))].slice(0, maxIcons);
}

export function completeSparseSupportedTopRow(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 8) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const grid = estimateGlobalGrid(rows);
  if (!grid) return boxes;

  const rowInfos = rows
    .map((row) => describeGridRow(row, grid))
    .filter((row): row is GridRowInfo => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  if (rowInfos.length < 2) return boxes;

  const top = rowInfos[0]!;
  const rowSize = Math.round(median([top.rowSize, grid.size]));
  if (top.rowY - roi.y > Math.max(10, rowSize * 0.45)) return boxes;
  if (top.sorted.length < 3 || top.sorted.length > 5 || top.snapRatio < 0.66) return boxes;

  const lowerStrongRows = rowInfos.filter((row) => row !== top && row.sorted.length >= 4 && row.snapRatio >= 0.7);
  if (lowerStrongRows.length === 0) return boxes;

  const targetRightSlot =
    estimateConsensusRightSlot(rowInfos) ??
    Math.max(...lowerStrongRows.map((row) => row.maxSlot));
  if (!Number.isFinite(targetRightSlot)) return boxes;

  const occupied = new Set(top.slots);
  const minSlot = Math.min(...top.slots);
  if (targetRightSlot < top.maxSlot || targetRightSlot - minSlot > 8) return boxes;

  const slotSupport = new Map<number, number>();
  for (const row of lowerStrongRows) {
    for (const slot of new Set(row.slots)) slotSupport.set(slot, (slotSupport.get(slot) ?? 0) + 1);
  }

  const rowScore = median(top.sorted.map((box) => box.score));
  const minScore = options.minBoxScore ?? 190;
  const acceptScore = Math.max(minScore - 10, rowCellThreshold(rowSize) + 36, rowScore * 0.55);
  const additions: BuffIconBox[] = [];

  for (let slot = minSlot; slot <= targetRightSlot; slot++) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (occupied.has(slot)) continue;
    if ((slotSupport.get(slot) ?? 0) < 1) continue;

    const predictedX = Math.round(grid.anchor + slot * grid.pitch);
    const direct = { x: predictedX, y: top.rowY, size: rowSize };
    if (direct.x < 0 || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) continue;
    if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

    const refined = refineTightCell(predictedX, top.rowY, rowSize, maps, roi, Math.round(rowSize * 0.32));
    const closeToSlot =
      refined && Math.abs(refined.x - predictedX) <= rowSize * 0.3 && Math.abs(refined.y - top.rowY) <= rowSize * 0.3;
    if (!refined || refined.score < acceptScore || !closeToSlot) continue;

    additions.push({
      ...refined,
      x: predictedX,
      y: top.rowY,
      size: rowSize,
      score: Math.max(refined.score, minScore),
      confidence: Math.max(refined.confidence, 0.74),
    });
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}

export function completeTopRightWrappedRows(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 8) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const grid = estimateGlobalGrid(rows);
  if (!grid) return boxes;

  const rowInfos = rows
    .map((row) => describeGridRow(row, grid))
    .filter((row): row is GridRowInfo => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  if (rowInfos.length < 2) return boxes;

  const targetRightSlot =
    estimateConsensusRightSlot(rowInfos) ??
    Math.max(...rowInfos.filter((row) => row.sorted.length >= 4).flatMap((row) => row.slots));
  if (!Number.isFinite(targetRightSlot)) return boxes;

  const additions: BuffIconBox[] = [];
  const minScore = options.minBoxScore ?? 190;
  for (let index = 0; index < rowInfos.length - 1; index++) {
    if (boxes.length + additions.length >= maxIcons) break;
    const upper = rowInfos[index]!;
    const lower = rowInfos[index + 1]!;
    const rowSize = Math.round(median([upper.rowSize, lower.rowSize, grid.size]));
    if (upper.rowY - roi.y > Math.max(8, rowSize * 0.22)) continue;
    if (upper.sorted.length < 6 || lower.sorted.length < 4) continue;

    const gap = lower.rowY - upper.rowY;
    if (gap < rowSize * 1.62 || gap > rowSize * 2.75) continue;

    const predictedY = Math.round(upper.rowY + rowSize);
    if (predictedY <= upper.rowY + rowSize * 0.62 || predictedY + rowSize >= lower.rowY + rowSize * 0.35) continue;
    if (hasExistingRowNear(rows, [...boxes, ...additions], predictedY, rowSize)) continue;

    const rowScore = median([...upper.sorted, ...lower.sorted].map((box) => box.score));
    const acceptScore = Math.max(minScore, rowCellThreshold(rowSize) + 46, rowScore * 0.52);
    const run: BuffIconBox[] = [];
    let misses = 0;

    for (let slot = targetRightSlot; slot >= targetRightSlot - 3; slot--) {
      if (boxes.length + additions.length + run.length >= maxIcons) break;
      const predictedX = Math.round(grid.anchor + slot * grid.pitch);
      const direct = { x: predictedX, y: predictedY, size: rowSize };
      if (direct.x < 0 || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
      if ([...boxes, ...additions, ...run].some((box) => iou(box, direct) > 0.22)) continue;

      const refined = refineTightCell(predictedX, predictedY, rowSize, maps, roi, Math.round(rowSize * 0.28));
      const closeToSlot =
        refined && Math.abs(refined.x - predictedX) <= rowSize * 0.28 && Math.abs(refined.y - predictedY) <= rowSize * 0.24;
      if (!refined || refined.score < acceptScore || !closeToSlot) {
        misses++;
        if (run.length > 0 || misses >= 1) break;
        continue;
      }

      run.push({
        ...refined,
        x: predictedX,
        y: predictedY,
        size: rowSize,
        score: Math.max(refined.score, minScore),
        confidence: Math.max(refined.confidence, 0.74),
      });
      misses = 0;
    }

    if (run.length >= 2) additions.push(...run);
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}
