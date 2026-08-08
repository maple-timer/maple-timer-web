import type { BuffIconBox, GridRowInfo } from "../types.js";
import type { DetectionContext } from "./context.js";
import { refineTightCell } from "./cellRefine.js";
import { clusterBoxesByRow, describeGridRow, estimateGlobalGrid, estimateRowPitch } from "./grid.js";
import { iou, median } from "./math.js";
import { hasLikelyBuffFrame } from "./pruning.js";
import { rowCellThreshold } from "./scoring.js";

export function completeFinalSupportedTopRowGaps(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const grid = estimateGlobalGrid(rows);
  if (!grid) return boxes;

  const slotSupport = new Map<number, number>();
  for (const row of rows) {
    for (const box of row) {
      const baseSize = median(row.map((item) => item.size));
      if (Math.abs(baseSize - grid.size) > Math.max(4, baseSize * 0.14)) continue;
      const slot = Math.round((box.x - grid.anchor) / grid.pitch);
      slotSupport.set(slot, (slotSupport.get(slot) ?? 0) + 1);
    }
  }

  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];
  for (const row of rows) {
    if (boxes.length + additions.length >= maxIcons || row.length < 4) continue;
    const sorted = [...row].sort((a, b) => a.x - b.x);
    const baseSize = median(sorted.map((box) => box.size));
    if (Math.abs(baseSize - grid.size) > Math.max(4, baseSize * 0.14)) continue;

    const rowY = Math.round(median(sorted.map((box) => box.y)));
    const rowSize = Math.round(baseSize);
    if (rowY - roi.y > Math.max(10, rowSize * 0.35)) continue;

    const slots = sorted.map((box) => Math.round((box.x - grid.anchor) / grid.pitch));
    const rowScore = median(sorted.map((box) => box.score));
    const acceptScore = Math.max(minScore, rowCellThreshold(rowSize) + 42, rowScore * 0.48);

    for (let index = 0; index < sorted.length - 1; index++) {
      const left = sorted[index]!;
      const right = sorted[index + 1]!;
      const leftSlot = slots[index]!;
      const rightSlot = slots[index + 1]!;
      const missingCount = rightSlot - leftSlot - 1;
      if (missingCount !== 1) continue;
      if (!hasLikelyBuffFrame(image, left) || !hasLikelyBuffFrame(image, right)) continue;

      const slot = leftSlot + 1;
      if ((slotSupport.get(slot) ?? 0) < 2) continue;
      const predictedX = Math.round(grid.anchor + slot * grid.pitch);
      const direct = { x: predictedX, y: rowY, size: rowSize };
      if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;
      if (predictedX < 0 || predictedX + rowSize > image.width || rowY < 0 || rowY + rowSize > image.height) continue;

      const refined = refineTightCell(predictedX, rowY, rowSize, maps, roi, Math.round(rowSize * 0.28));
      const closeToSlot =
        refined && Math.abs(refined.x - predictedX) <= rowSize * 0.3 && Math.abs(refined.y - rowY) <= rowSize * 0.3;
      if (!refined || refined.score < acceptScore || !closeToSlot) continue;

      additions.push({
        ...refined,
        x: predictedX,
        y: rowY,
        size: rowSize,
        score: Math.max(refined.score, minScore),
        confidence: Math.max(refined.confidence, 0.72),
      });
    }
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}

export function fillDetectedRowGaps(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons) return boxes;
  const additions: BuffIconBox[] = [];
  const rows = clusterBoxesByRow(boxes);
  const grid = estimateGlobalGrid(rows);
  const slotSupport = new Map<number, number>();
  if (grid) {
    for (const row of rows) {
      for (const box of row) {
        const baseSize = median(row.map((item) => item.size));
        if (Math.abs(baseSize - grid.size) > Math.max(4, baseSize * 0.14)) continue;
        const slot = Math.round((box.x - grid.anchor) / grid.pitch);
        slotSupport.set(slot, (slotSupport.get(slot) ?? 0) + 1);
      }
    }
  }
  const minScore = options.minBoxScore ?? 190;
  const strongRightEdges = rows.filter((row) => row.length >= 6).flatMap((row) => row.map((box) => box.x + box.size));
  const strongRightEdge = strongRightEdges.length > 0 ? Math.max(...strongRightEdges) : undefined;
  const multiRowMaxSlots = rows.length >= 2 ? 13 : Number.POSITIVE_INFINITY;

  for (const row of rows) {
    if (boxes.length + additions.length >= maxIcons || row.length < 3) continue;
    if (row.length >= multiRowMaxSlots) continue;
    const sorted = [...row].sort((a, b) => a.x - b.x);
    const baseSize = median(sorted.map((box) => box.size));
    const rowY = Math.round(median(sorted.map((box) => box.y)));
    const rowSize = Math.round(baseSize);
    const smallTopRow = baseSize >= 28 && baseSize < 40 && rowY - roi.y <= Math.max(7, rowSize * 0.28);
    const rowRightEdge = Math.max(...sorted.map((box) => box.x + box.size));
    const rightAlignedSupportedGapRow =
      row.length <= 5 &&
      strongRightEdge !== undefined &&
      Math.abs(rowRightEdge - strongRightEdge) <= Math.max(8, rowSize * 0.72) &&
      (Boolean(grid) || smallTopRow);
    if (row.length < 4 && !rightAlignedSupportedGapRow) continue;
    if (baseSize < 40 && !smallTopRow) continue;
    const pitch = estimateRowPitch(sorted, baseSize);
    if (pitch < baseSize * 0.78 || pitch > baseSize * 1.32) continue;

    const rowScore = median(sorted.map((box) => box.score));
    const acceptScore = Math.max(minScore, rowCellThreshold(rowSize) + 42, rowScore * 0.54);
    const extendedGapFill = smallTopRow || rightAlignedSupportedGapRow;

    for (let index = 0; index < sorted.length - 1; index++) {
      const left = sorted[index]!;
      const right = sorted[index + 1]!;
      const gap = right.x - left.x;
      if (gap < pitch * 1.55 || gap > pitch * (extendedGapFill ? 5.45 : 3.45)) continue;
      const missingCount = Math.round(gap / pitch) - 1;
      const maxMissingCount = extendedGapFill ? 4 : 2;
      if (missingCount < 1 || missingCount > maxMissingCount) continue;
      let rowAdditions = additions.filter((box) => Math.abs(box.y - rowY) <= Math.max(6, rowSize * 0.42)).length;
      if (baseSize < 52 && !rightAlignedSupportedGapRow && (!hasLikelyBuffFrame(image, left) || !hasLikelyBuffFrame(image, right))) continue;

      for (let step = 1; step <= missingCount; step++) {
        if (boxes.length + additions.length >= maxIcons) break;
        if (row.length + rowAdditions >= multiRowMaxSlots) break;
        const roughX = Math.round(left.x + step * pitch);
        const slot = grid ? Math.round((roughX - grid.anchor) / grid.pitch) : undefined;
        const predictedX = grid && slot !== undefined ? Math.round(grid.anchor + slot * grid.pitch) : roughX;
        const direct = { x: predictedX, y: rowY, size: rowSize };
        if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

        const refined = refineTightCell(predictedX, rowY, rowSize, maps, roi, Math.round(rowSize * 0.22));
        const closeToSlot =
          refined && Math.abs(refined.x - predictedX) <= rowSize * 0.28 && Math.abs(refined.y - rowY) <= rowSize * 0.28;
        const inBounds = predictedX >= 0 && predictedX + rowSize <= image.width && rowY >= 0 && rowY + rowSize <= image.height;
        if (!inBounds) continue;

        if (refined && refined.score >= acceptScore && closeToSlot) {
          additions.push({
            ...refined,
            x: predictedX,
            y: rowY,
            size: rowSize,
            confidence: Math.max(refined.confidence, 0.72),
          });
          rowAdditions++;
          continue;
        }

        const structurallySupported =
          grid &&
          slot !== undefined &&
          (row.length >= 8 ||
            (rowY - roi.y <= Math.max(8, rowSize * 0.3) && row.length >= 4 && missingCount === 1 && (slotSupport.get(slot) ?? 0) >= 2)) &&
          missingCount <= 2 &&
          (slotSupport.get(slot) ?? 0) >= 1 &&
          Math.abs(grid.pitch - pitch) <= Math.max(3, rowSize * 0.12);
        if (!structurallySupported) continue;

        additions.push({
          x: predictedX,
          y: rowY,
          size: rowSize,
          score: minScore,
          confidence: 0.68,
        });
        rowAdditions++;
      }
    }
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}

export function completeStructuralRowGaps(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 8) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const grid = estimateGlobalGrid(rows);
  if (!grid) return boxes;

  const rowInfos = rows.map((row) => describeGridRow(row, grid)).filter((row): row is GridRowInfo => Boolean(row));
  if (rowInfos.length < 2) return boxes;

  const slotSupport = new Map<number, number>();
  for (const row of rowInfos) {
    for (const slot of new Set(row.slots)) slotSupport.set(slot, (slotSupport.get(slot) ?? 0) + 1);
  }

  const additions: BuffIconBox[] = [];
  const minScore = options.minBoxScore ?? 190;
  for (const row of rowInfos) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length < 6 || row.snapRatio < 0.7) continue;

    const occupied = new Set(row.slots);
    const minSlot = Math.min(...row.slots);
    const maxSlot = Math.max(...row.slots);
    for (let slot = minSlot + 1; slot < maxSlot; slot++) {
      if (boxes.length + additions.length >= maxIcons) break;
      if (occupied.has(slot)) continue;

      let leftSlot = slot - 1;
      while (leftSlot >= minSlot && !occupied.has(leftSlot)) leftSlot--;
      let rightSlot = slot + 1;
      while (rightSlot <= maxSlot && !occupied.has(rightSlot)) rightSlot++;
      if (leftSlot < minSlot || rightSlot > maxSlot || rightSlot - leftSlot > 3) continue;
      if ((slotSupport.get(slot) ?? 0) < 1) continue;

      const predictedX = Math.round(grid.anchor + slot * grid.pitch);
      const direct = { x: predictedX, y: row.rowY, size: row.rowSize };
      if (direct.x < 0 || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) continue;
      if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

      const refined = refineTightCell(predictedX, row.rowY, row.rowSize, maps, roi, Math.round(row.rowSize * 0.18));
      const closeToSlot =
        refined && Math.abs(refined.x - predictedX) <= row.rowSize * 0.24 && Math.abs(refined.y - row.rowY) <= row.rowSize * 0.24;

      additions.push({
        ...(refined && closeToSlot ? refined : direct),
        x: predictedX,
        y: row.rowY,
        size: row.rowSize,
        score: Math.max(refined?.score ?? minScore, minScore),
        confidence: Math.max(refined?.confidence ?? 0, 0.68),
      });
    }
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}
