import type { BuffIconBox, GridHint, GridRowInfo } from "../types.js";
import type { DetectionContext } from "./context.js";
import { refineTightCell } from "./cellRefine.js";
import { clusterBoxesByRow, describeGridRow, estimateGlobalGrid } from "./grid.js";
import { iou, median } from "./math.js";
import { rowCellThreshold } from "./scoring.js";
import { estimateVerticalPitchFromWideGaps, estimateVisibleVerticalPitch, hasExistingRowNear, normalizeRowY, rightEdgeSingletonRun, strongestConsecutiveGridRun } from "./completionShared.js";

export function completeMissingRowsFromVerticalGaps(
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

  const verticalPitch = estimateVisibleVerticalPitch(rowInfos, grid.size) ?? estimateVerticalPitchFromWideGaps(rowInfos, grid.size);
  if (!verticalPitch) return boxes;

  const additions: BuffIconBox[] = [];
  const allRows = clusterBoxesByRow(boxes);
  for (let index = 0; index < rowInfos.length - 1; index++) {
    if (boxes.length + additions.length >= maxIcons) break;
    const upper = rowInfos[index]!;
    const lower = rowInfos[index + 1]!;
    const gap = lower.rowY - upper.rowY;
    if (gap < verticalPitch * 1.58 || gap > verticalPitch * 3.25) continue;

    const missingCount = Math.round(gap / verticalPitch) - 1;
    if (missingCount < 1 || missingCount > 2) continue;

    for (let step = 1; step <= missingCount; step++) {
      if (boxes.length + additions.length >= maxIcons) break;
      const predictedY = Math.round(upper.rowY + step * verticalPitch);
      if (hasExistingRowNear(allRows, [...boxes, ...additions], predictedY, upper.rowSize)) continue;
      const rowAdditions = probeMissingGridRow(predictedY, upper, lower, grid, ctx, [...boxes, ...additions]);
      if (rowAdditions.length > 0) additions.push(...rowAdditions.slice(0, maxIcons - boxes.length - additions.length));
    }
  }

  for (const row of rowInfos) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length < 6) continue;
    const predictedY = Math.round(row.rowY + verticalPitch);
    if (predictedY < 0 || predictedY + row.rowSize > roi.y + roi.height) continue;
    if (hasExistingRowNear(allRows, [...boxes, ...additions], predictedY, row.rowSize)) continue;
    const rowAdditions = probeMissingGridRow(predictedY, row, row, grid, ctx, [...boxes, ...additions]);
    if (rowAdditions.length >= 3) additions.push(...rowAdditions.slice(0, maxIcons - boxes.length - additions.length));
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}

export function probeMissingGridRow(
  rowY: number,
  upper: GridRowInfo,
  lower: GridRowInfo,
  grid: GridHint,
  ctx: DetectionContext,
  existing: BuffIconBox[],
) {
  const { maps, roi, image, options } = ctx;
  const sharedRight = Math.min(upper.maxSlot, lower.maxSlot);
  const sharedLeft = Math.max(Math.min(...upper.slots), Math.min(...lower.slots));
  const rowSize = Math.round(median([upper.rowSize, lower.rowSize, grid.size]));
  const rowScore = median([...upper.sorted, ...lower.sorted].map((box) => box.score));
  const acceptScore = Math.max(options.minBoxScore ?? 190, rowCellThreshold(rowSize) + 72, rowScore * 0.64);
  const candidates: BuffIconBox[] = [];

  for (let slot = sharedRight; slot >= sharedLeft; slot--) {
    const predictedX = Math.round(grid.anchor + slot * grid.pitch);
    const direct = { x: predictedX, y: rowY, size: rowSize };
    if (direct.x < 0 || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) continue;
    if (existing.some((box) => iou(box, direct) > 0.22)) continue;

    const refined = refineTightCell(predictedX, rowY, rowSize, maps, roi, Math.round(rowSize * 0.2));
    if (!refined || refined.score < acceptScore) continue;
    const closeToSlot = Math.abs(refined.x - predictedX) <= rowSize * 0.22 && Math.abs(refined.y - rowY) <= rowSize * 0.22;
    if (!closeToSlot) continue;

    candidates.push({
      ...refined,
      x: predictedX,
      y: Math.round(refined.y),
      size: Math.round(refined.size),
      score: Math.max(refined.score, options.minBoxScore ?? 190),
      confidence: Math.max(refined.confidence, 0.76),
    });
  }

  const strongRun = strongestConsecutiveGridRun(candidates, grid);
  if (strongRun.length >= 3) return normalizeRowY(strongRun);
  return normalizeRowY(rightEdgeSingletonRun(candidates, grid, sharedRight, acceptScore));
}
