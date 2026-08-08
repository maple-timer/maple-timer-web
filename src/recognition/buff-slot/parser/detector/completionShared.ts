import type { BuffIconBox, GridHint, GridRowInfo, ImageLike } from "../types.js";
import type { DetectionContext } from "./context.js";
import { refineTightCell } from "./cellRefine.js";
import { clusterBoxesByRow, estimateRowPitch } from "./grid.js";
import { iou, mean, median } from "./math.js";
import { hasLikelyBuffFrame } from "./pruning.js";
import { rowCellThreshold, scoreTightSlot } from "./scoring.js";

export function probeRightEdgeRun(
  row: NonNullable<ReturnType<typeof describePitchRow>>,
  y: number,
  ctx: DetectionContext,
  existing: BuffIconBox[],
  minScore: number,
  topClipped: boolean,
) {
  const { maps, roi, image, maxIcons } = ctx;
  const rowScore = median(row.sorted.map((box) => box.score));
  const acceptScore = Math.max(
    minScore - (topClipped ? 14 : 8),
    rowCellThreshold(row.size) + (topClipped ? 46 : 56),
    rowScore * (topClipped ? 0.52 : 0.56),
  );
  const run: BuffIconBox[] = [];
  const maxSteps = Math.min(8, Math.max(4, row.sorted.length));

  for (let step = 0; step < maxSteps; step++) {
    if (existing.length + run.length >= maxIcons) break;
    const slot = row.maxSlot - step;
    const predictedX = Math.round(row.anchor + slot * row.pitch);
    const direct: BuffIconBox = { x: predictedX, y, size: row.size, score: 0, confidence: 0 };
    if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
    if ([...existing, ...run].some((box) => iou(box, direct) > 0.22)) continue;

    const directScore = scoreTightSlot(maps, predictedX - roi.x, y - roi.y, row.size).score;
    const directFrame = hasLikelyBuffFrame(image, direct);
    if (directScore < acceptScore - (topClipped ? 72 : 48) && !directFrame) {
      if (run.length > 0) break;
      continue;
    }

    const refineRadius = Math.round(row.size * (directScore >= acceptScore ? 0.14 : 0.26));
    const refined = refineTightCell(predictedX, y, row.size, maps, roi, refineRadius);
    const closeToSlot =
      refined && Math.abs(refined.x - predictedX) <= row.size * 0.34 && Math.abs(refined.y - y) <= row.size * (topClipped ? 0.36 : 0.5);
    const score = Math.max(directScore, closeToSlot ? refined.score : 0);
    const frameOk = directFrame || Boolean(refined && closeToSlot && hasLikelyBuffFrame(image, refined));
    const strongWithoutFrame = score >= acceptScore + (topClipped ? 34 : 18);
    if (!refined || !closeToSlot || score < acceptScore || (!frameOk && !strongWithoutFrame)) {
      if (run.length > 0) break;
      continue;
    }

    run.push({
      ...refined,
      x: Math.round(refined.x),
      y: Math.round(refined.y),
      size: row.size,
      score: Math.max(refined.score, directScore, minScore),
      confidence: Math.max(refined.confidence, 0.72),
    });
  }

  return run;
}

export function estimatePitchRowVerticalPitch(rows: Array<NonNullable<ReturnType<typeof describePitchRow>>>, size: number) {
  const pitches: number[] = [];
  for (let index = 0; index < rows.length - 1; index++) {
    const upper = rows[index]!;
    const lower = rows[index + 1]!;
    if (Math.abs(upper.size - size) > Math.max(4, size * 0.16) || Math.abs(lower.size - size) > Math.max(4, size * 0.16)) continue;
    const diff = lower.rowY - upper.rowY;
    if (diff >= size * 0.82 && diff <= size * 1.55) pitches.push(diff);
    const steps = Math.round(diff / size);
    if (steps >= 2 && steps <= 3) {
      const pitch = diff / steps;
      if (pitch >= size * 0.82 && pitch <= size * 1.28) pitches.push(pitch);
    }
  }
  return Math.round(pitches.length > 0 ? median(pitches) : size * 1.2);
}

export function uniqueInts(values: number[]) {
  return [...new Set(values.map((value) => Math.round(value)))].sort((a, b) => a - b);
}

export function expandShortGridRowSlots(
  row: GridRowInfo,
  grid: GridHint,
  slotSupport: Map<number, number>,
  occupied: Set<number>,
  startSlot: number,
  direction: -1 | 1,
  acceptScore: number,
  ctx: DetectionContext,
  existing: BuffIconBox[],
  targetRightSlot?: number,
) {
  const { maps, roi, image, maxIcons } = ctx;
  const additions: BuffIconBox[] = [];
  const minScore = 190;
  const maxSteps = direction < 0 ? 4 : 4;
  for (let step = 0; step < maxSteps; step++) {
    if (existing.length + additions.length >= maxIcons) break;
    const slot = startSlot + step * direction;
    if (direction > 0 && targetRightSlot !== undefined && slot > targetRightSlot) break;
    if (occupied.has(slot) || (slotSupport.get(slot) ?? 0) < 2) break;

    const predictedX = Math.round(grid.anchor + slot * grid.pitch);
    const direct = { x: predictedX, y: row.rowY, size: row.rowSize };
    if (direct.x < 0 || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
    if ([...existing, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

    const refined = refineTightCell(predictedX, row.rowY, row.rowSize, maps, roi, Math.round(row.rowSize * 0.3));
    const closeToSlot =
      refined && Math.abs(refined.x - predictedX) <= row.rowSize * 0.32 && Math.abs(refined.y - row.rowY) <= row.rowSize * 0.3;
    if (!refined || refined.score < acceptScore || !closeToSlot) break;

    additions.push({
      ...refined,
      x: direction < 0 ? Math.round(refined.x) : predictedX,
      y: row.rowY,
      size: row.rowSize,
      score: Math.max(refined.score, minScore),
      confidence: Math.max(refined.confidence, 0.74),
    });
  }

  return additions;
}

export function describePitchRow(row: BuffIconBox[]) {
  if (row.length < 3) return undefined;
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const baseSize = median(sorted.map((box) => box.size));
  if (baseSize < 30 || baseSize > 66) return undefined;
  const pitch = estimateRowPitch(sorted, baseSize);
  if (pitch < baseSize * 0.78 || pitch > baseSize * 1.34) return undefined;
  const anchor = estimateLocalRowAnchor(sorted, pitch);
  const rowSize = Math.round(baseSize < 52 ? Math.max(baseSize, pitch) : baseSize);
  const slots = sorted.map((box) => Math.round((box.x - anchor) / pitch));
  const snapTolerance = Math.max(6, rowSize * 0.32);
  const snapped = sorted.filter((box, index) => Math.abs(anchor + slots[index]! * pitch - box.x) <= snapTolerance);
  if (snapped.length / sorted.length < 0.66) return undefined;

  return {
    sorted,
    size: rowSize,
    pitch: Math.round(pitch),
    anchor,
    rowY: Math.round(median(sorted.map((box) => box.y))),
    minSlot: Math.min(...slots),
    maxSlot: Math.max(...slots),
    slots,
    rightX: sorted[sorted.length - 1]!.x,
  };
}

export type CompactRightAlignedStructure = {
  rows: Array<NonNullable<ReturnType<typeof describePitchRow>>>;
  denseRows: Array<NonNullable<ReturnType<typeof describePitchRow>>>;
  baseSize: number;
  pitch: number;
  targetRightEdge: number;
  targetRightX: number;
};

export function describeCompactRightAlignedStructure(
  boxes: BuffIconBox[],
  image: ImageLike,
  options: { minBoxes?: number; minRows?: number; minDenseRows?: number; maxImageWidth?: number; maxImageHeight?: number } = {},
): CompactRightAlignedStructure | undefined {
  const minBoxes = options.minBoxes ?? 8;
  const minRows = options.minRows ?? 3;
  const minDenseRows = options.minDenseRows ?? 2;
  if (options.maxImageWidth !== undefined && image.width > options.maxImageWidth) return undefined;
  if (options.maxImageHeight !== undefined && image.height > options.maxImageHeight) return undefined;
  if (boxes.length < minBoxes) return undefined;

  const rawRows = clusterBoxesByRow(boxes)
    .map((row) => {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      return {
        row,
        sorted,
        size: Math.round(median(sorted.map((box) => box.size))),
        rightEdge: Math.max(...sorted.map((box) => box.x + box.size)),
      };
    });
  const rows = rawRows
    .map(({ row }) => describePitchRow(row))
    .filter((row): row is NonNullable<ReturnType<typeof describePitchRow>> => Boolean(row))
    .filter((row) => row.size >= 28 && row.size <= 42)
    .sort((a, b) => a.rowY - b.rowY);
  if (rows.length < Math.min(2, minRows)) return undefined;

  const baseSize = Math.round(median(rows.map((row) => row.size)));
  const pitch = Math.round(median(rows.map((row) => row.pitch)));
  if (baseSize < 28 || baseSize > 42 || pitch < baseSize * 0.78 || pitch > baseSize * 1.34) return undefined;

  const compatibleRows = rows.filter(
    (row) =>
      Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12) &&
      Math.abs(row.pitch - pitch) <= Math.max(4, baseSize * 0.16),
  );
  if (compatibleRows.length < Math.min(2, minRows)) return undefined;

  const denseRows = compatibleRows.filter((row) => row.sorted.length >= 6 && row.sorted.length <= 13);
  if (denseRows.length < minDenseRows) return undefined;

  const rightEdges = denseRows.map((row) => row.rightX + row.size);
  const medianRightEdge = Math.round(median(rightEdges));
  const rightAlignedDenseRows = denseRows.filter((row) => {
    const rightEdge = row.rightX + row.size;
    const nearConsensus = Math.abs(rightEdge - medianRightEdge) <= Math.max(14, baseSize * 0.72);
    const nearScreenRight = image.width - rightEdge <= Math.max(72, baseSize * 2.2);
    return nearConsensus && nearScreenRight;
  });
  if (rightAlignedDenseRows.length < minDenseRows) return undefined;

  const targetRightEdge = Math.round(median(rightAlignedDenseRows.map((row) => row.rightX + row.size)));
  const shortRightRows = rawRows.filter(
    (row) => {
      if (row.sorted.length < 1 || row.sorted.length >= 3) return false;
      if (Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12)) return false;
      const rightGap = targetRightEdge - row.rightEdge;
      const alignedToRightEdge = Math.abs(rightGap) <= Math.max(14, baseSize * 0.72);
      const oneSlotShort = rightGap >= pitch * 0.55 && rightGap <= pitch * 1.45;
      return (alignedToRightEdge || oneSlotShort) && image.width - row.rightEdge <= Math.max(72, baseSize * 2.2);
    },
  );
  if (compatibleRows.length + shortRightRows.length < minRows) return undefined;

  return {
    rows: compatibleRows,
    denseRows: rightAlignedDenseRows,
    baseSize,
    pitch,
    targetRightEdge,
    targetRightX: targetRightEdge - baseSize,
  };
}

export function hasCompactRightAlignedStructure(
  boxes: BuffIconBox[],
  image: ImageLike,
  options: { minBoxes?: number; minRows?: number; minDenseRows?: number; maxImageWidth?: number; maxImageHeight?: number } = {},
) {
  return Boolean(describeCompactRightAlignedStructure(boxes, image, options));
}

export function isLowResCompactBuffLayout(
  boxes: BuffIconBox[],
  image: ImageLike,
  options: { minBoxes?: number; maxImageWidth?: number; maxImageHeight?: number } = {},
) {
  const minBoxes = options.minBoxes ?? 8;
  if (options.maxImageWidth !== undefined && image.width > options.maxImageWidth) return false;
  if (options.maxImageHeight !== undefined && image.height > options.maxImageHeight) return false;
  if (boxes.length < minBoxes) return false;

  const rows = clusterBoxesByRow(boxes)
    .map((row) => {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      return {
        sorted,
        size: Math.round(median(sorted.map((box) => box.size))),
        rightEdge: Math.max(...sorted.map((box) => box.x + box.size)),
      };
    })
    .filter((row) => row.size >= 28 && row.size <= 42);
  if (rows.length === 0) return false;

  const baseSize = Math.round(median(rows.map((row) => row.size)));
  if (baseSize < 28 || baseSize > 42) return false;
  const compatibleRows = rows.filter((row) => Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12));
  const compactBoxCount = compatibleRows.reduce((sum, row) => sum + row.sorted.length, 0);
  if (compactBoxCount < minBoxes) return false;

  return compatibleRows.some((row) => {
    if (row.sorted.length < 2) return false;
    const rightMargin = image.width - row.rightEdge;
    return rightMargin >= -Math.max(10, baseSize * 0.32) && rightMargin <= Math.max(120, baseSize * 3.8);
  });
}

export function estimateLocalRowAnchor(row: BuffIconBox[], pitch: number) {
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const leftX = sorted[0]!.x;
  return Math.round(median(sorted.map((box) => box.x - Math.round((box.x - leftX) / pitch) * pitch)));
}

export function hasOccupiedSlotNear(occupied: Set<number>, slot: number, direction: -1 | 1, limit: number) {
  for (let current = slot + direction; direction < 0 ? current >= limit : current <= limit; current += direction) {
    if (occupied.has(current)) return Math.abs(current - slot) <= 2;
  }
  return false;
}

export function estimateVisibleVerticalPitch(rows: GridRowInfo[], size: number) {
  const diffs: number[] = [];
  for (let index = 0; index < rows.length - 1; index++) {
    const diff = rows[index + 1]!.rowY - rows[index]!.rowY;
    if (diff >= size * 0.82 && diff <= size * 1.55) diffs.push(diff);
  }
  if (diffs.length === 0) return undefined;
  return Math.round(median(diffs));
}

export function estimateVerticalPitchFromWideGaps(rows: GridRowInfo[], size: number) {
  const pitches: number[] = [];
  for (let index = 0; index < rows.length - 1; index++) {
    const diff = rows[index + 1]!.rowY - rows[index]!.rowY;
    const steps = Math.round(diff / size);
    if (steps < 2 || steps > 3) continue;
    const pitch = diff / steps;
    if (pitch >= size * 0.82 && pitch <= size * 1.28) pitches.push(pitch);
  }
  return pitches.length > 0 ? Math.round(median(pitches)) : undefined;
}

export function hasExistingRowNear(rows: BuffIconBox[][], boxes: BuffIconBox[], y: number, size: number) {
  const rowNear = rows.some((row) => Math.abs(median(row.map((box) => box.y)) - y) <= Math.max(6, size * 0.42));
  if (rowNear) return true;
  return boxes.some((box) => Math.abs(box.y - y) <= Math.max(6, size * 0.42));
}

export function strongestConsecutiveGridRun(candidates: BuffIconBox[], grid: GridHint) {
  if (candidates.length < 3) return [];
  const sorted = candidates.sort((a, b) => a.x - b.x);
  const runs: BuffIconBox[][] = [];
  for (const box of sorted) {
    const slot = Math.round((box.x - grid.anchor) / grid.pitch);
    const current = runs[runs.length - 1];
    const previous = current?.[current.length - 1];
    const previousSlot = previous ? Math.round((previous.x - grid.anchor) / grid.pitch) : undefined;
    if (!current || previousSlot === undefined || slot - previousSlot > 1) runs.push([box]);
    else current.push(box);
  }

  const viable = runs.filter((run) => run.length >= 3).sort((a, b) => b.length - a.length || mean(b.map((box) => box.score)) - mean(a.map((box) => box.score)));
  return viable[0] ?? [];
}

export function rightEdgeSingletonRun(candidates: BuffIconBox[], grid: GridHint, sharedRight: number, acceptScore: number) {
  const rightEdgeCandidates = candidates.filter((box) => {
    const slot = Math.round((box.x - grid.anchor) / grid.pitch);
    return slot >= sharedRight - 1 && slot <= sharedRight && box.score >= acceptScore + 18;
  });
  return rightEdgeCandidates.sort((a, b) => b.score - a.score).slice(0, 2);
}

export function normalizeRowY(row: BuffIconBox[]) {
  if (row.length === 0) return row;
  const y = Math.round(median(row.map((box) => box.y)));
  return row.map((box) => ({ ...box, y }));
}
