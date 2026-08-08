import type { BuffIconBox, GridRowInfo } from "../types.js";
import type { DetectionContext } from "./context.js";
import { refineTightCell } from "./cellRefine.js";
import { hasLikelyBuffFrame, hasNearbyLikelyBuffFrame, hasVisibleRightRailControl } from "./cropQuality.js";
import { clusterBoxesByRow, describeGridRow, estimateConsensusRightSlot, estimateGlobalGrid } from "./grid.js";
import { iou, mean, median } from "./math.js";
import { rowCellThreshold, scoreTightSlot } from "./scoring.js";
import {
  describePitchRow,
  estimatePitchRowVerticalPitch,
  estimateVerticalPitchFromWideGaps,
  estimateVisibleVerticalPitch,
  expandShortGridRowSlots,
  hasExistingRowNear,
  probeRightEdgeRun,
  uniqueInts,
} from "./completionShared.js";

export function completeMissingShortRightRailRows(
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

  const baseSize = Math.round(median(pitchRows.map((row) => row.size)));
  const verticalPitch = estimatePitchRowVerticalPitch(pitchRows, baseSize);
  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];

  for (const row of pitchRows) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length < 3 || row.size < 28 || row.size > 66) continue;
    if (Math.abs(row.size - baseSize) > Math.max(4, baseSize * 0.16)) continue;
    if (image.width - (row.rightX + row.size) > Math.max(34, row.size * 1.45)) continue;

    const predictedY = Math.round(row.rowY + verticalPitch);
    if (predictedY <= row.rowY + row.size * 0.68 || predictedY + row.size > roi.y + roi.height) continue;
    if (hasExistingRowNear(rows, [...boxes, ...additions], predictedY, row.size)) continue;

    const candidateYs = uniqueInts([predictedY, predictedY - Math.round(row.size * 0.12), predictedY + Math.round(row.size * 0.12)]);
    const runs = candidateYs
      .map((y) => probeRightEdgeRun(row, y, ctx, [...boxes, ...additions], minScore, false))
      .filter((run) => run.length > 0)
      .sort((a, b) => b.length - a.length || mean(b.map((box) => box.score)) - mean(a.map((box) => box.score)));
    const best = runs[0];
    if (!best) continue;

    const rowScore = median(row.sorted.map((box) => box.score));
    const singleTopRowTail =
      pitchRows.length === 1 &&
      row.size >= 28 &&
      row.size <= 66 &&
      row.sorted.length >= 3 &&
      row.sorted.length <= 5 &&
      row.rowY - roi.y <= Math.max(48, row.size * 0.8);
    const singleTopRowSingleton =
      singleTopRowTail &&
      best.length === 1 &&
      (hasVisibleRightRailControl(image, best[0]!) || best[0]!.score >= minScore + 20) &&
      best[0]!.score >= Math.max(minScore - 10, rowScore * 0.58);
    const framedWideSingleton =
      !singleTopRowTail &&
      row.size >= 40 &&
      best.length === 1 &&
      best[0]!.score >= Math.max(250, rowScore * 0.82) &&
      (hasLikelyBuffFrame(image, best[0]!) || hasNearbyLikelyBuffFrame(image, best[0]!));
    const strongSingleton = best.length === 1 && (singleTopRowSingleton || framedWideSingleton);
    const sparseGeneratedTail = best.length === 3 && row.sorted.length >= 8 && pitchRows.filter((other) => other.rowY <= row.rowY).length >= 2;
    const bestScore = mean(best.map((box) => box.score));
    const bestFrameLike = best.filter((box) => hasLikelyBuffFrame(image, box) || hasNearbyLikelyBuffFrame(image, box)).length;
    const compactStrongTail = row.size < 40 && best.length === 3 && bestScore >= Math.max(minScore + 54, rowScore * 0.82);
    const strongSparseTail =
      best.length === 3 && ((bestFrameLike >= 2 && bestScore >= Math.max(minScore + 40, rowScore * 0.72)) || compactStrongTail);
    if (sparseGeneratedTail && !strongSparseTail) continue;
    if (best.length < 2 && !strongSingleton) continue;
    additions.push(...best.map((box) => ({ ...box, size: row.size })));
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions].slice(0, maxIcons);
}

export function completeShortRightRailRowsFromVerticalGaps(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 8) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const grid = estimateGlobalGrid(rows);
  if (!grid || grid.size < 28 || grid.size > 42) return boxes;

  const rowInfos = rows
    .map((row) => describeGridRow(row, grid))
    .filter((row): row is GridRowInfo => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  if (rowInfos.length < 2) return boxes;

  const baseSize = grid.size;
  const strongRows = rowInfos.filter(
    (row) =>
      row.sorted.length >= 6 &&
      row.snapRatio >= 0.68 &&
      Math.abs(row.rowSize - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  if (strongRows.length < 2) return boxes;

  const targetRightSlot = estimateConsensusRightSlot(rowInfos) ?? Math.max(...strongRows.map((row) => row.maxSlot));
  if (!Number.isFinite(targetRightSlot)) return boxes;

  const verticalPitch =
    estimateVisibleVerticalPitch(rowInfos, baseSize) ??
    estimateVerticalPitchFromWideGaps(rowInfos, baseSize) ??
    Math.round(baseSize * 1.08);
  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];

  for (let index = 0; index < strongRows.length - 1; index++) {
    if (boxes.length + additions.length >= maxIcons) break;
    const upper = strongRows[index]!;
    const lower = strongRows[index + 1]!;
    const gap = lower.rowY - upper.rowY;
    if (gap < baseSize * 1.58 || gap > baseSize * 2.85) continue;

    const betweenRows = rowInfos.filter(
      (row) =>
        row !== upper &&
        row !== lower &&
        row.sorted.length <= 3 &&
        row.rowY > upper.rowY + baseSize * 0.55 &&
        row.rowY < lower.rowY - baseSize * 0.35,
    );
    const candidateYs = uniqueInts([
      ...betweenRows.map((row) => row.rowY),
      upper.rowY + verticalPitch,
      upper.rowY + Math.round(baseSize * 0.88),
      upper.rowY + Math.round(baseSize),
      upper.rowY + Math.round(baseSize * 1.08),
      upper.rowY + Math.round(baseSize * 1.18),
      lower.rowY - verticalPitch,
      lower.rowY - Math.round(baseSize * 0.88),
      lower.rowY - Math.round(baseSize),
      lower.rowY - Math.round(baseSize * 1.08),
    ]).filter((y) => y > upper.rowY + baseSize * 0.5 && y < lower.rowY - baseSize * 0.18);

    const rowScore = median([...upper.sorted, ...lower.sorted].map((box) => box.score));
    const runs = candidateYs
      .map((y) => ({
        y,
        run: probeGridRightRailRun(grid, targetRightSlot, y, baseSize, rowScore, ctx, [...boxes, ...additions], minScore),
      }))
      .filter(({ run }) => run.length > 0)
      .sort((a, b) => b.run.length - a.run.length || mean(b.run.map((box) => box.score)) - mean(a.run.map((box) => box.score)));
    const best = runs[0];
    if (!best) continue;

    const existingNear = rows.some((row) => {
      const y = Math.round(median(row.map((box) => box.y)));
      if (Math.abs(y - best.y) > Math.max(6, baseSize * 0.42)) return false;
      const size = Math.round(median(row.map((box) => box.size)));
      return row.length <= 3 && Math.abs(size - baseSize) <= Math.max(3, baseSize * 0.12);
    });
    if (existingNear || best.run.length < 3) continue;

    const rowY = Math.round(median(best.run.map((box) => box.y)));
    additions.push(...best.run.map((box) => ({ ...box, y: rowY, size: baseSize })));
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions].slice(0, maxIcons);
}

export function completeProjectedCompactRowsBelowTopGrid(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { roi, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 12) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const grid = estimateGlobalGrid(rows);
  if (!grid || grid.size < 28 || grid.size > 42) return boxes;

  const rowInfos = rows
    .map((row) => describeGridRow(row, grid))
    .filter((row): row is GridRowInfo => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  if (rowInfos.length < 2 || rowInfos.length > 3) return boxes;

  const baseSize = grid.size;
  const topRow = rowInfos.find(
    (row) =>
      row.rowY <= Math.max(8, baseSize * 0.28) &&
      row.sorted.length >= 5 &&
      row.snapRatio >= 0.68 &&
      Math.abs(row.rowSize - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  if (!topRow) return boxes;

  const anchorRow = rowInfos.find(
    (row) =>
      row !== topRow &&
      row.sorted.length >= 11 &&
      row.snapRatio >= 0.72 &&
      row.rowY > topRow.rowY + baseSize * 0.86 &&
      row.rowY <= topRow.rowY + baseSize * 1.55 &&
      Math.abs(row.rowSize - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  if (!anchorRow) return boxes;

  const visiblePitch = anchorRow.rowY - topRow.rowY;
  if (visiblePitch < baseSize * 0.92 || visiblePitch > baseSize * 1.45) return boxes;

  const targetRightSlot = estimateConsensusRightSlot(rowInfos) ?? Math.max(topRow.maxSlot, anchorRow.maxSlot);
  if (!Number.isFinite(targetRightSlot)) return boxes;

  const minScore = options.minBoxScore ?? 190;
  const rowScore = median(anchorRow.sorted.map((box) => box.score));
  const additions: BuffIconBox[] = [];
  const existing = () => [...boxes, ...additions];

  const shortCandidates = projectedRowYs(anchorRow.rowY + visiblePitch, baseSize, roi.y, roi.y + roi.height - baseSize);
  const shortRun = bestProjectedGridRun(
    grid,
    targetRightSlot - 2,
    targetRightSlot,
    shortCandidates,
    baseSize,
    rowScore,
    ctx,
    existing(),
    minScore,
    3,
  );
  if (shortRun.length >= 3) additions.push(...shortRun);

  if (boxes.length + additions.length >= maxIcons) {
    return additions.length === 0 ? boxes : [...boxes, ...additions].slice(0, maxIcons);
  }

  const denseCandidates = projectedRowYs(anchorRow.rowY + visiblePitch * 2, baseSize, roi.y, roi.y + roi.height - baseSize);
  const denseRun = bestProjectedGridRun(
    grid,
    targetRightSlot - 8,
    targetRightSlot,
    denseCandidates,
    baseSize,
    rowScore,
    ctx,
    existing(),
    minScore,
    8,
  );
  if (denseRun.length >= 8) additions.push(...denseRun);

  return additions.length === 0 ? boxes : [...boxes, ...additions].slice(0, maxIcons);
}

export function completeShortSupportedGridRows(
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

  const targetRightSlot =
    estimateConsensusRightSlot(rowInfos) ??
    Math.max(...rowInfos.filter((row) => row.sorted.length >= 4).flatMap((row) => row.slots));
  if (!Number.isFinite(targetRightSlot)) return boxes;

  const slotSupport = new Map<number, number>();
  for (const row of rowInfos) {
    if (row.sorted.length < 4) continue;
    for (const slot of new Set(row.slots)) slotSupport.set(slot, (slotSupport.get(slot) ?? 0) + 1);
  }

  const additions: BuffIconBox[] = [];
  for (const row of rowInfos) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length < 2 || row.sorted.length > 3 || row.snapRatio < 0.66) continue;
    if (row.rowY - roi.y <= Math.max(10, row.rowSize * 0.45)) continue;

    const occupied = new Set(row.slots);
    const minSlot = Math.min(...row.slots);
    const maxSlot = Math.max(...row.slots);
    const rowScore = median(row.sorted.map((box) => box.score));
    const minScore = options.minBoxScore ?? 190;
    const acceptScore = Math.max(minScore, rowCellThreshold(row.rowSize) + 42, rowScore * 0.48);

    additions.push(
      ...expandShortGridRowSlots(row, grid, slotSupport, occupied, minSlot - 1, -1, acceptScore, ctx, [...boxes, ...additions]),
    );
    if (boxes.length + additions.length >= maxIcons) break;
    additions.push(
      ...expandShortGridRowSlots(
        row,
        grid,
        slotSupport,
        occupied,
        maxSlot + 1,
        1,
        acceptScore,
        ctx,
        [...boxes, ...additions],
        targetRightSlot,
      ),
    );
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}

function projectedRowYs(centerY: number, size: number, minY: number, maxY: number) {
  return uniqueInts([
    centerY - size * 0.25,
    centerY - size * 0.14,
    centerY,
    centerY + size * 0.14,
    centerY + size * 0.25,
  ]).filter((y) => y >= minY && y <= maxY);
}

function bestProjectedGridRun(
  grid: NonNullable<ReturnType<typeof estimateGlobalGrid>>,
  minSlot: number,
  maxSlot: number,
  candidateYs: number[],
  size: number,
  rowScore: number,
  ctx: DetectionContext,
  existing: BuffIconBox[],
  minScore: number,
  minRunLength: number,
) {
  const runs = candidateYs
    .map((y) => probeProjectedGridRun(grid, minSlot, maxSlot, y, size, rowScore, ctx, existing, minScore, minRunLength >= 8))
    .filter((run) => run.length >= minRunLength)
    .sort((a, b) => b.length - a.length || mean(b.map((box) => box.score)) - mean(a.map((box) => box.score)));
  return runs[0] ?? [];
}

function probeProjectedGridRun(
  grid: NonNullable<ReturnType<typeof estimateGlobalGrid>>,
  minSlot: number,
  maxSlot: number,
  y: number,
  size: number,
  rowScore: number,
  ctx: DetectionContext,
  existing: BuffIconBox[],
  minScore: number,
  weakProjectedDense: boolean,
) {
  const { maps, roi, image, maxIcons } = ctx;
  if (hasExistingRowNear(clusterBoxesByRow(existing), existing, y, size)) return [];
  const relaxedDense = size < 40 && weakProjectedDense;
  const acceptScore = relaxedDense
    ? Math.max(minScore - 42, rowCellThreshold(size) + 30, rowScore * 0.46)
    : Math.max(minScore - 6, rowCellThreshold(size) + 50, rowScore * 0.58);
  const accepted: Array<{ slot: number; box: BuffIconBox }> = [];

  for (let slot = maxSlot; slot >= minSlot; slot--) {
    if (existing.length + accepted.length >= maxIcons) break;
    const predictedX = Math.round(grid.anchor + slot * grid.pitch);
    const direct: BuffIconBox = { x: predictedX, y, size, score: 0, confidence: 0 };
    if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
    if ([...existing, ...accepted.map((item) => item.box)].some((box) => iou(box, direct) > 0.22)) {
      if (accepted.length > 0) break;
      continue;
    }

    const directScore = scoreTightSlot(maps, predictedX - roi.x, y - roi.y, size).score;
    const refined = refineTightCell(predictedX, y, size, maps, roi, Math.round(size * 0.28));
    const closeToSlot =
      refined && Math.abs(refined.x - predictedX) <= size * 0.34 && Math.abs(refined.y - y) <= size * 0.48;
    const score = Math.max(directScore, closeToSlot ? refined.score : 0);
    const frameOk =
      hasLikelyBuffFrame(image, direct) ||
      hasNearbyLikelyBuffFrame(image, direct) ||
      Boolean(refined && closeToSlot && (hasLikelyBuffFrame(image, refined) || hasNearbyLikelyBuffFrame(image, refined)));
    const strongWithoutFrame = size < 40 && (score >= acceptScore + 24 || (relaxedDense && score >= acceptScore));
    if (!refined || !closeToSlot || score < acceptScore || (!frameOk && !strongWithoutFrame)) {
      if (accepted.length > 0) break;
      continue;
    }

    accepted.push({
      slot,
      box: {
        ...refined,
        x: predictedX,
        y,
        size,
        score: Math.max(score, minScore),
        confidence: Math.max(refined.confidence, 0.74),
      },
    });
  }

  if (accepted.length === 0 || accepted[0]!.slot < maxSlot - 1) return [];
  const run = [accepted[0]!];
  for (let index = 1; index < accepted.length; index++) {
    const previous = run[run.length - 1]!;
    const next = accepted[index]!;
    if (previous.slot - next.slot > 1) break;
    run.push(next);
  }
  return run.map((item) => item.box).sort((a, b) => a.x - b.x);
}

function probeGridRightRailRun(
  grid: NonNullable<ReturnType<typeof estimateGlobalGrid>>,
  targetRightSlot: number,
  y: number,
  size: number,
  rowScore: number,
  ctx: DetectionContext,
  existing: BuffIconBox[],
  minScore: number,
) {
  const { maps, roi, image, maxIcons } = ctx;
  const acceptScore = Math.max(minScore - 8, rowCellThreshold(size) + 46, rowScore * 0.5);
  const accepted: Array<{ slot: number; box: BuffIconBox }> = [];

  for (let step = 0; step < 5; step++) {
    if (existing.length + accepted.length >= maxIcons) break;
    const slot = targetRightSlot - step;
    const predictedX = Math.round(grid.anchor + slot * grid.pitch);
    const direct: BuffIconBox = { x: predictedX, y, size, score: 0, confidence: 0 };
    if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) continue;
    if (existing.some((box) => iou(box, direct) > 0.22)) continue;

    const directScore = scoreTightSlot(maps, predictedX - roi.x, y - roi.y, size).score;
    const refined = refineTightCell(predictedX, y, size, maps, roi, Math.round(size * 0.3));
    const closeToSlot =
      refined && Math.abs(refined.x - predictedX) <= size * 0.34 && Math.abs(refined.y - y) <= size * 0.46;
    const score = Math.max(directScore, closeToSlot ? refined.score : 0);
    const directFrame = hasLikelyBuffFrame(image, direct) || hasNearbyLikelyBuffFrame(image, direct);
    const refinedFrame = Boolean(refined && closeToSlot && (hasLikelyBuffFrame(image, refined) || hasNearbyLikelyBuffFrame(image, refined)));
    const strongWithoutFrame = size < 40 && score >= acceptScore + 18;
    if (!refined || !closeToSlot || score < acceptScore || (!directFrame && !refinedFrame && !strongWithoutFrame)) continue;

    accepted.push({
      slot,
      box: {
        ...refined,
        x: predictedX,
        y: Math.round(refined.y),
        size,
        score: Math.max(score, minScore),
        confidence: Math.max(refined.confidence, 0.74),
      },
    });
  }

  if (accepted.length === 0) return [];
  accepted.sort((a, b) => b.slot - a.slot);
  if (accepted[0]!.slot < targetRightSlot - 1) return [];

  const run = [accepted[0]!];
  for (let index = 1; index < accepted.length; index++) {
    const next = accepted[index]!;
    const previous = run[run.length - 1]!;
    if (previous.slot - next.slot > 1) break;
    run.push(next);
  }

  return run.map((item) => item.box);
}

export function completeSingletonSupportedShortRows(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 8) return boxes;
  const rows = clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      sorted: [...row].sort((a, b) => a.x - b.x),
      y: Math.round(median(row.map((box) => box.y))),
      size: Math.round(median(row.map((box) => box.size))),
    }))
    .sort((a, b) => a.y - b.y);
  if (rows.length < 3) return boxes;

  const baseSize = Math.round(median(rows.flatMap((row) => row.row.map((box) => box.size))));
  if (baseSize < 28 || baseSize > 42) return boxes;

  const supportRows = rows.filter(
    (row) =>
      row.sorted.length >= 6 &&
      Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  if (supportRows.length < 2) return boxes;

  const rightEdges = supportRows.map((row) => Math.max(...row.sorted.map((box) => box.x + box.size)));
  const targetRightEdge = Math.round(median(rightEdges));
  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];

  for (const row of rows) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length !== 1) continue;
    if (Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12)) continue;
    if (row.y - roi.y <= baseSize * 1.45) continue;

    const rightBox = row.sorted[0]!;
    if (Math.abs(rightBox.x + rightBox.size - targetRightEdge) > baseSize * 0.65) continue;

    const predictedX = Math.round(rightBox.x - baseSize);
    const supportedColumns = supportRows.filter((supportRow) =>
      supportRow.sorted.some((box) => Math.abs(box.x - predictedX) <= baseSize * 0.5),
    ).length;
    if (supportedColumns < 2) continue;

    const direct: BuffIconBox = { x: predictedX, y: row.y, size: baseSize, score: 0, confidence: 0 };
    if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) continue;
    if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

    const directScore = scoreTightSlot(maps, predictedX - roi.x, row.y - roi.y, baseSize).score;
    const refined = refineTightCell(predictedX, row.y, baseSize, maps, roi, Math.round(baseSize * 0.3));
    const closeToSlot =
      refined && Math.abs(refined.x - predictedX) <= baseSize * 0.36 && Math.abs(refined.y - row.y) <= baseSize * 0.32;
    const score = Math.max(directScore, closeToSlot ? refined.score : 0);
    const acceptScore = Math.max(minScore, rowCellThreshold(baseSize) + 64, rightBox.score * 0.62);
    const frameOk = hasLikelyBuffFrame(image, direct) || Boolean(refined && closeToSlot && hasLikelyBuffFrame(image, refined));
    if (!refined || !closeToSlot || score < acceptScore || !frameOk) continue;

    additions.push({
      ...refined,
      x: Math.round(refined.x),
      y: Math.round(refined.y),
      size: baseSize,
      score: Math.max(score, minScore),
      confidence: Math.max(refined.confidence, 0.74),
    });
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}
