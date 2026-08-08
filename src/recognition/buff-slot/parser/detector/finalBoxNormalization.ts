import type { BuffIconBox, FeatureMaps, ImageLike, Rect } from "../types.js";
import { estimateLocalRowAnchor, isLowResCompactBuffLayout } from "./completionShared.js";
import { clusterBoxesByRow, describeGridRow, estimateConsensusRightSlot, estimateGlobalGrid, estimateRowPitch } from "./grid.js";
import { mean, median } from "./math.js";
import { cropQuality, hasLikelyBuffFrame, hasVisibleRightRailControl } from "./cropQuality.js";
import { rowCellThreshold, rowFrameScore, scoreTightSlot } from "./scoring.js";

const CROPPED_1366_COMPACT_LAYOUT = { minBoxes: 8, maxImageWidth: 1365, maxImageHeight: 765 } as const;

export function normalizeIrregularRowColumns(boxes: BuffIconBox[]) {
  if (boxes.length < 8) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const xByBox = new Map<BuffIconBox, number>();

  for (const row of rows) {
    if (row.length < 6) continue;
    const sorted = [...row].sort((a, b) => a.x - b.x);
    const baseSize = median(sorted.map((box) => box.size));
    if (baseSize < 52) continue;

    const estimatedPitch = estimateRowPitch(sorted, baseSize);
    const pitch = baseSize <= 34 && Math.abs(estimatedPitch - baseSize) <= Math.max(3, baseSize * 0.1) ? baseSize : estimatedPitch;
    if (pitch < baseSize * 0.82 || pitch > baseSize * 1.28) continue;
    const diffs = sorted.slice(1).map((box, index) => box.x - sorted[index]!.x);
    const irregular = diffs.some((diff) => Math.abs(diff - pitch) > Math.max(3, baseSize * 0.06));
    if (!irregular) continue;

    const anchor = estimateLocalRowAnchor(sorted, pitch);
    for (const box of sorted) {
      const slot = Math.round((box.x - anchor) / pitch);
      const snappedX = Math.round(anchor + slot * pitch);
      const dx = Math.abs(snappedX - box.x);
      if (dx >= 2 && dx <= Math.max(4, baseSize * 0.12)) xByBox.set(box, snappedX);
    }
  }

  return xByBox.size === 0 ? boxes : boxes.map((box) => (xByBox.has(box) ? { ...box, x: xByBox.get(box)! } : box));
}

export function snapLowConfidenceCompactInternalGaps(boxes: BuffIconBox[], image: ImageLike) {
  if (boxes.length < 8) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const xByBox = new Map<BuffIconBox, number>();

  for (const row of rows) {
    if (row.length < 8) continue;
    const sorted = [...row].sort((a, b) => a.x - b.x);
    const baseSize = median(sorted.map((box) => box.size));
    if (baseSize < 28 || baseSize > 42) continue;
    const pitch = estimateRowPitch(sorted, baseSize);
    if (pitch < baseSize * 0.82 || pitch > baseSize * 1.18) continue;

    for (let index = 1; index < sorted.length - 1; index++) {
      const box = sorted[index]!;
      if (box.confidence > 0.69) continue;
      const left = sorted[index - 1]!;
      const right = sorted[index + 1]!;
      const leftGap = box.x - left.x;
      const rightGap = right.x - box.x;
      if (leftGap < pitch * 0.72 || leftGap > pitch * 1.38 || rightGap < pitch * 0.72 || rightGap > pitch * 1.38) continue;
      const expectedX = Math.round(median([left.x + pitch, right.x - pitch]));
      const dx = Math.abs(expectedX - box.x);
      if (dx < 2 || dx > Math.max(5, baseSize * 0.16)) continue;
      if (expectedX < 0 || expectedX + box.size > image.width) continue;
      xByBox.set(box, expectedX);
    }
  }

  return xByBox.size === 0 ? boxes : boxes.map((box) => (xByBox.has(box) ? { ...box, x: xByBox.get(box)! } : box));
}

export function snapCompactRowsToLocalPitch(boxes: BuffIconBox[], maps: FeatureMaps, roi: Rect, image: ImageLike) {
  if (boxes.length < 8) return boxes;
  if (!isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const xByBox = new Map<BuffIconBox, number>();
  const referenceColumns: number[] = [];

  for (const row of rows) {
    if (row.length < 6) continue;
    const sorted = [...row].sort((a, b) => a.x - b.x);
    const baseSize = Math.round(median(sorted.map((box) => box.size)));
    if (baseSize < 28 || baseSize > 42) continue;

    const pitch = estimateRowPitch(sorted, baseSize);
    if (pitch < baseSize * 0.82 || pitch > baseSize * 1.22) continue;
    const anchor = estimateLocalRowAnchor(sorted, pitch);
    const snapped = sorted.map((box) => Math.round(anchor + Math.round((box.x - anchor) / pitch) * pitch));
    const snapErrors = snapped.map((x, index) => Math.abs(x - sorted[index]!.x));
    if (snapErrors.filter((error) => error >= 2).length === 0) continue;

    for (let index = 0; index < sorted.length; index++) {
      const box = sorted[index]!;
      const snappedX = snapped[index]!;
      const dx = Math.abs(snappedX - box.x);
      const bestX = bestLocalSlotX(snappedX, box.y, box.size, maps, roi, image);
      referenceColumns.push(bestX);
      const bestDx = Math.abs(bestX - box.x);
      if ((dx < 2 && bestDx < 2) || bestDx > Math.max(12, baseSize * 0.4)) continue;
      if (bestX < 0 || bestX + box.size > image.width) continue;

      const previous = sorted[index - 1];
      const next = sorted[index + 1];
      const rightOutlier = Boolean(previous && box.x - previous.x > pitch + Math.max(4, baseSize * 0.16));
      const leftOutlier = Boolean(next && next.x - box.x > pitch + Math.max(4, baseSize * 0.16));
      const currentScore = scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score;
      const snappedScore = scoreTightSlot(maps, bestX - roi.x, box.y - roi.y, box.size).score;
      const scoreCompatible =
        snappedScore >= currentScore - (dx >= 6 ? 10 : 24) ||
        (rightOutlier && snappedScore >= Math.max(120, currentScore - 34)) ||
        (leftOutlier && snappedScore >= Math.max(120, currentScore - 34));
      if (!scoreCompatible) continue;

      xByBox.set(box, bestX);
    }
  }

  const supportedColumns = compactSupportedColumns(referenceColumns);
  if (supportedColumns.length > 0) {
    for (const row of rows) {
      if (row.length >= 6 || row.length > 4) continue;
      const sorted = [...row].sort((a, b) => a.x - b.x);
      const baseSize = Math.round(median(sorted.map((box) => box.size)));
      if (baseSize < 28 || baseSize > 42) continue;

      for (const box of sorted) {
        const nearest = supportedColumns
          .map((x) => ({ x, dx: Math.abs(x - box.x) }))
          .sort((a, b) => a.dx - b.dx)[0];
        if (!nearest || nearest.dx < 2 || nearest.dx > Math.max(12, baseSize * 0.42)) continue;
        if (nearest.x < 0 || nearest.x + box.size > image.width) continue;
        const currentScore = scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score;
        const snappedScore = scoreTightSlot(maps, nearest.x - roi.x, box.y - roi.y, box.size).score;
        if (snappedScore < currentScore - 18 && snappedScore < 120) continue;
        xByBox.set(box, nearest.x);
      }
    }
  }

  return xByBox.size === 0 ? boxes : boxes.map((box) => (xByBox.has(box) ? { ...box, x: xByBox.get(box)! } : box));
}

function bestLocalSlotX(x: number, y: number, size: number, maps: FeatureMaps, roi: Rect, image: ImageLike) {
  let bestX = x;
  let bestScore = Number.NEGATIVE_INFINITY;
  const radius = Math.max(2, Math.round(size * 0.14));
  for (let candidateX = x - radius; candidateX <= x + radius; candidateX++) {
    if (candidateX < 0 || candidateX + size > image.width) continue;
    const score = scoreTightSlot(maps, candidateX - roi.x, y - roi.y, size).score - Math.abs(candidateX - x) * 0.8;
    if (score > bestScore) {
      bestScore = score;
      bestX = candidateX;
    }
  }
  return bestX;
}

function compactSupportedColumns(columns: number[]) {
  if (columns.length < 8) return [];
  const groups: Array<{ values: number[] }> = [];
  for (const x of columns.sort((a, b) => a - b)) {
    const group = groups.find((candidate) => Math.abs(median(candidate.values) - x) <= 6);
    if (group) group.values.push(x);
    else groups.push({ values: [x] });
  }
  return groups
    .filter((group) => group.values.length >= 2)
    .map((group) => Math.round(median(group.values)))
    .sort((a, b) => a - b);
}

export function normalizeCompactSupportedColumns(boxes: BuffIconBox[], image: ImageLike) {
  if (boxes.length < 8) return boxes;
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

  const longRows = rows.filter((row) => row.sorted.length >= 8 && Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.1));
  const railRows = rows.filter((row) => {
    if (row.sorted.length < 2 || row.sorted.length > 3) return false;
    if (Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.1)) return false;
    return row.sorted.every((box) => hasLikelyBuffFrame(image, box));
  });
  if (longRows.length === 0 || railRows.length === 0) return boxes;

  const candidates = longRows
    .map((row) => {
      const pitch = estimateCompactPitch(row.sorted, baseSize);
      if (!pitch || pitch < baseSize * 0.88 || pitch > baseSize * 1.12) return undefined;
      const anchor = estimateLocalRowAnchor(row.sorted, pitch);
      const support = railRows.find((rail) => rail.sorted.every((box) => Math.abs(anchor + Math.round((box.x - anchor) / pitch) * pitch - box.x) <= Math.max(5, baseSize * 0.24)));
      if (!support) return undefined;
      return { anchor, pitch, supportCount: support.sorted.length, rowLength: row.sorted.length };
    })
    .filter((candidate): candidate is { anchor: number; pitch: number; supportCount: number; rowLength: number } => Boolean(candidate))
    .sort((a, b) => b.supportCount - a.supportCount || b.rowLength - a.rowLength);

  const candidate = candidates[0];
  if (!candidate) return boxes;

  const xByBox = new Map<BuffIconBox, number>();
  for (const box of boxes) {
    if (Math.abs(box.size - baseSize) > Math.max(3, baseSize * 0.12)) continue;
    const slot = Math.round((box.x - candidate.anchor) / candidate.pitch);
    const snappedX = Math.round(candidate.anchor + slot * candidate.pitch);
    const dx = Math.abs(snappedX - box.x);
    if (dx < 1 || dx > Math.max(8, baseSize * 0.28)) continue;
    if (snappedX < 0 || snappedX + box.size > image.width) continue;
    xByBox.set(box, snappedX);
  }

  return xByBox.size === 0 ? boxes : boxes.map((box) => (xByBox.has(box) ? { ...box, x: xByBox.get(box)! } : box));
}

export function snapRightRailSingletonColumns(boxes: BuffIconBox[], image: ImageLike) {
  if (boxes.length < 8) return boxes;
  const rows = clusterBoxesByRow(boxes)
    .map((row) => {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      const size = Math.round(median(sorted.map((box) => box.size)));
      return {
        row,
        sorted,
        y: Math.round(median(sorted.map((box) => box.y))),
        size,
        rightEdge: Math.max(...sorted.map((box) => box.x + box.size)),
      };
    })
    .sort((a, b) => a.y - b.y);
  if (rows.length < 3) return boxes;

  const baseSize = Math.round(median(rows.flatMap((row) => row.row.map((box) => box.size))));
  if (baseSize < 28 || baseSize > 66) return boxes;

  const strongRows = rows.filter((row) => row.sorted.length >= 3 && Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12));
  if (strongRows.length < 2) return boxes;

  const maxRightEdge = Math.max(...strongRows.flatMap((row) => row.sorted.map((box) => box.x + box.size)));
  const rightColumn = strongRows
    .flatMap((row) => row.sorted)
    .filter((box) => Math.abs(box.x + box.size - maxRightEdge) <= Math.max(4, baseSize * 0.24));
  if (rightColumn.length < 2) return boxes;

  const targetRightEdge = Math.round(median(rightColumn.map((box) => box.x + box.size)));
  const xByBox = new Map<BuffIconBox, number>();
  for (const row of rows) {
    if (row.sorted.length !== 1) continue;
    const box = row.sorted[0]!;
    if (Math.abs(box.size - baseSize) > Math.max(4, baseSize * 0.16)) continue;

    const currentRightEdge = box.x + box.size;
    if (Math.abs(currentRightEdge - targetRightEdge) > Math.max(8, baseSize * 0.34)) continue;

    const targetX = Math.round(targetRightEdge - box.size);
    const dx = Math.abs(targetX - box.x);
    if (dx < 1 || dx > Math.max(7, baseSize * 0.22)) continue;
    if (targetX < 0 || targetX + box.size > image.width) continue;
    xByBox.set(box, targetX);
  }

  return xByBox.size === 0 ? boxes : boxes.map((box) => (xByBox.has(box) ? { ...box, x: xByBox.get(box)! } : box));
}

export function snapCompactShortRailRowsToGrid(boxes: BuffIconBox[], image: ImageLike) {
  if (boxes.length < 8) return boxes;
  const rows = clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      sorted: [...row].sort((a, b) => a.x - b.x),
      y: Math.round(median(row.map((box) => box.y))),
      size: Math.round(median(row.map((box) => box.size))),
    }))
    .sort((a, b) => a.y - b.y);
  const grid = estimateGlobalGrid(rows.map((row) => row.row));
  if (!grid || grid.size < 28 || grid.size > 42) return boxes;

  const rowInfos = rows
    .map((row) => describeGridRow(row.row, grid))
    .filter((row): row is NonNullable<ReturnType<typeof describeGridRow>> => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  const strongRows = rowInfos.filter(
    (row) =>
      row.sorted.length >= 6 &&
      row.snapRatio >= 0.68 &&
      Math.abs(row.rowSize - grid.size) <= Math.max(3, grid.size * 0.12),
  );
  if (strongRows.length < 2) return boxes;

  const targetRightSlot = estimateConsensusRightSlot(rowInfos) ?? Math.max(...strongRows.map((row) => row.maxSlot));
  if (!Number.isFinite(targetRightSlot)) return boxes;
  const targetRightEdge = Math.round(grid.anchor + targetRightSlot * grid.pitch + grid.size);

  const xByBox = new Map<BuffIconBox, number>();
  for (const row of rows) {
    if (row.sorted.length < 2 || row.sorted.length > 3) continue;
    if (Math.abs(row.size - grid.size) > Math.max(3, grid.size * 0.12)) continue;

    const betweenWideStrongRows = strongRows.some((upper, index) => {
      const lower = strongRows[index + 1];
      if (!lower) return false;
      const gap = lower.rowY - upper.rowY;
      return (
        gap >= grid.size * 1.5 &&
        gap <= grid.size * 2.9 &&
        row.y > upper.rowY + grid.size * 0.5 &&
        row.y < lower.rowY - grid.size * 0.18
      );
    });
    if (!betweenWideStrongRows) continue;

    for (const box of row.sorted) {
      const slot = Math.round((box.x - grid.anchor) / grid.pitch);
      if (slot < targetRightSlot - 4 || slot > targetRightSlot) continue;
      const snappedX = Math.round(grid.anchor + slot * grid.pitch);
      const dx = Math.abs(snappedX - box.x);
      const rightOverflow = box.x + box.size - targetRightEdge;
      const overflowSnapAllowed = rightOverflow >= Math.max(7, grid.size * 0.22) && rightOverflow <= Math.max(14, grid.size * 0.44);
      const maxDx = overflowSnapAllowed ? Math.max(11, grid.size * 0.36) : Math.max(7, grid.size * 0.24);
      if (dx < 1 || dx > maxDx) continue;
      if (snappedX < 0 || snappedX + box.size > image.width) continue;
      xByBox.set(box, snappedX);
    }
  }

  return xByBox.size === 0 ? boxes : boxes.map((box) => (xByBox.has(box) ? { ...box, x: xByBox.get(box)! } : box));
}

function estimateCompactPitch(row: BuffIconBox[], baseSize: number) {
  const counts = new Map<number, number>();
  for (let index = 0; index < row.length - 1; index++) {
    const diff = row[index + 1]!.x - row[index]!.x;
    if (diff < baseSize * 0.72 || diff > baseSize * 1.38) continue;
    const rounded = Math.round(diff);
    counts.set(rounded, (counts.get(rounded) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;

  let bestPitch: number | undefined;
  let bestCount = 0;
  for (const [pitch, count] of counts) {
    if (count > bestCount || (count === bestCount && Math.abs(pitch - baseSize) < Math.abs((bestPitch ?? pitch) - baseSize))) {
      bestPitch = pitch;
      bestCount = count;
    }
  }
  return bestPitch;
}

export function normalizeFinalBoxSizes(boxes: BuffIconBox[], image: ImageLike) {
  if (boxes.length < 4) return boxes;
  const sizes = boxes.map((box) => box.size).filter((size) => size >= 28 && size <= 66);
  if (sizes.length < 4) return boxes;

  const targetSize = Math.round(median(sizes));
  if (targetSize < 28 || targetSize > 66) return boxes;

  const tolerance = Math.max(1, Math.min(2, Math.round(targetSize * 0.05)));
  const closeCount = sizes.filter((size) => Math.abs(size - targetSize) <= tolerance).length;
  if (closeCount < Math.max(4, Math.ceil(boxes.length * 0.72))) return boxes;

  return boxes.map((box) => {
    if (Math.abs(box.size - targetSize) > tolerance) return box;
    const x = Math.min(Math.max(0, box.x), image.width - targetSize);
    const y = Math.min(Math.max(0, box.y), image.height - targetSize);
    return { ...box, x, y, size: targetSize };
  });
}

export function separateOverlappingFinalBoxes(boxes: BuffIconBox[], image: ImageLike) {
  if (boxes.length < 2) return boxes;
  const adjusted = new Map<BuffIconBox, number>();
  for (const row of clusterBoxesByRow(boxes)) {
    const sorted = [...row].sort((a, b) => a.x - b.x);
    const rowSize = Math.round(median(sorted.map((box) => box.size)));
    if (sorted.length < 2 || rowSize < 28 || rowSize > 66) continue;
    let nextX = Math.round(sorted[sorted.length - 1]!.x);
    for (let index = sorted.length - 2; index >= 0; index--) {
      const left = sorted[index]!;
      const right = sorted[index + 1]!;
      const size = Math.round(median([left.size, right.size]));
      if (Math.abs(left.size - right.size) > Math.max(2, size * 0.08)) {
        nextX = Math.round(left.x);
        continue;
      }
      const rightX = adjusted.get(right) ?? nextX;
      const overlap = left.x + left.size - rightX;
      if (overlap <= 0 || overlap > Math.max(3, size * 0.2)) {
        nextX = Math.round(left.x);
        continue;
      }
      const targetX = Math.max(0, Math.round(rightX - left.size));
      adjusted.set(left, targetX);
      nextX = targetX;
    }
  }

  return adjusted.size === 0
    ? boxes
    : boxes.map((box) => {
        const x = adjusted.get(box);
        if (x === undefined) return box;
        return { ...box, x: Math.min(x, image.width - box.size) };
      });
}

export function snapRowsToScoredNonOverlappingPitch(boxes: BuffIconBox[], maps: FeatureMaps, roi: Rect, image: ImageLike) {
  if (boxes.length < 8) return boxes;
  const rows = clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      sorted: [...row].sort((a, b) => a.x - b.x),
      y: Math.round(median(row.map((box) => box.y))),
      size: Math.round(median(row.map((box) => box.size))),
    }))
    .sort((a, b) => a.y - b.y);
  if (rows.length < 2) return boxes;

  const baseSize = Math.round(median(rows.flatMap((row) => row.row.map((box) => box.size))));
  if (baseSize < 38 || baseSize > 56) return boxes;

  const topLimit = Math.max(image.height * 0.14, baseSize * 3.1);
  const rightEdgeTolerance = Math.max(72, Math.min(170, image.width * 0.085));
  const xByBox = new Map<BuffIconBox, number>();

  for (const row of rows) {
    if (row.sorted.length < 5) continue;
    if (row.y > topLimit) continue;
    if (Math.abs(row.size - baseSize) > Math.max(2, baseSize * 0.06)) continue;

    const rightmost = row.sorted[row.sorted.length - 1]!;
    if (image.width - (rightmost.x + rightmost.size) > rightEdgeTolerance) continue;

    const pitch = baseSize;
    const gaps = row.sorted.slice(1).map((box, index) => box.x - row.sorted[index]!.x);
    const compactEnough = gaps.every((gap) => gap >= pitch * 0.74 && gap <= pitch * 1.26);
    if (!compactEnough) continue;

    const currentScore = mean(row.sorted.map((box) => scoreTightSlot(maps, Math.round(box.x) - roi.x, row.y - roi.y, pitch).score));
    const anchoredXs = row.sorted.map((_box, index) => Math.round(rightmost.x - pitch * (row.sorted.length - 1 - index)));
    const currentGapError = mean(gaps.map((gap) => Math.abs(gap - pitch)));

    let bestXs = row.sorted.map((box) => Math.round(box.x));
    let bestScore = currentScore;
    let bestGapError = currentGapError;
    const searchRadius = Math.max(4, Math.round(pitch * 0.14));

    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      const candidateXs = anchoredXs.map((x) => x + dx);
      if (candidateXs.some((x) => x < 0 || x + pitch > image.width)) continue;
      const overlaps = candidateXs.some((x, index) => index > 0 && x < candidateXs[index - 1]! + pitch);
      if (overlaps) continue;

      const movement = mean(candidateXs.map((x, index) => Math.abs(x - row.sorted[index]!.x)));
      if (movement > Math.max(7, pitch * 0.18)) continue;

      const visualScore = mean(candidateXs.map((x) => scoreTightSlot(maps, x - roi.x, row.y - roi.y, pitch).score));
      const candidateScore = visualScore - movement * 0.32 - Math.abs(dx) * 0.16;
      const candidateGapError = 0;
      const improvesVisual = candidateScore >= bestScore + 2.5;
      const repairsPitch = currentGapError >= 1.1 && candidateScore >= bestScore - 1.5 && candidateGapError < bestGapError;
      if (!improvesVisual && !repairsPitch) continue;

      bestXs = candidateXs;
      bestScore = candidateScore;
      bestGapError = candidateGapError;
    }

    if (bestXs.every((x, index) => Math.abs(x - row.sorted[index]!.x) < 1)) continue;
    for (let index = 0; index < row.sorted.length; index++) {
      const box = row.sorted[index]!;
      const x = bestXs[index]!;
      if (Math.abs(x - box.x) < 1) continue;
      xByBox.set(box, x);
    }
  }

  return xByBox.size === 0 ? boxes : boxes.map((box) => (xByBox.has(box) ? { ...box, x: xByBox.get(box)! } : box));
}

export function recoverScoredTopRightTwoRowGrid(
  boxes: BuffIconBox[],
  maps: FeatureMaps,
  roi: Rect,
  image: ImageLike,
  maxIcons: number,
) {
  if (boxes.length < 4 || boxes.length > 18 || image.width < 1500 || roi.y !== 0) return boxes;
  const rows = clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      sorted: [...row].sort((a, b) => a.x - b.x),
      y: Math.round(median(row.map((box) => box.y))),
      size: Math.round(median(row.map((box) => box.size))),
    }))
    .sort((a, b) => a.y - b.y);
  if (rows.length < 1 || rows.length > 2) return boxes;

  const sourceSize = Math.round(median(rows.flatMap((row) => row.row.map((box) => box.size))));
  if (sourceSize < 40 || sourceSize > 52) return boxes;
  if (rows.some((row) => row.y > Math.max(74, sourceSize * 1.8))) return boxes;

  const rightmost = rows
    .flatMap((row) => row.sorted)
    .sort((a, b) => b.x - a.x)[0];
  if (!rightmost) return boxes;
  const rightMargin = image.width - (rightmost.x + rightmost.size);
  if (rightMargin > Math.max(180, sourceSize * 4.4)) return boxes;
  if (!hasVisibleRightRailControl(image, rightmost) && rightMargin > Math.max(150, sourceSize * 3.6)) return boxes;

  const currentGaps = rows.flatMap((row) => row.sorted.slice(1).map((box, index) => box.x - row.sorted[index]!.x));
  const irregular = currentGaps.some((gap) => gap > sourceSize * 1.2 || gap < sourceSize * 0.72);
  const tooShort = boxes.length < 12;
  const rowLengthImbalance =
    rows.length === 2 &&
    rows[0]!.y <= Math.max(10, sourceSize * 0.35) &&
    rows[1]!.sorted.length - rows[0]!.sorted.length >= 3 &&
    rows[1]!.sorted.length >= 8;
  if (!irregular && !tooShort && !rowLengthImbalance) return boxes;

  let best: { boxes: BuffIconBox[]; score: number } | undefined;
  const sizeMin = Math.max(40, sourceSize - 4);
  const sizeMax = Math.min(52, sourceSize + 6);
  const rightXBase = Math.round(rightmost.x);

  for (let size = sizeMin; size <= sizeMax; size++) {
    const yPairs = candidateTwoRowYs(rows.map((row) => row.y), size);
    for (const [topYBase, lowerYBase] of yPairs) {
      for (let rightX = rightXBase - 5; rightX <= rightXBase + 5; rightX++) {
        const topRun = bestScoredGridRun(rightX, topYBase, size, maps, roi, image);
        const lowerRun = bestScoredGridRun(rightX, lowerYBase, size, maps, roi, image);
        if (topRun.length < 4 || lowerRun.length < 4) continue;
        if (topRun.length > 8 || lowerRun.length > 9) continue;
        const rebuilt = [...topRun, ...lowerRun].slice(0, maxIcons);
        if (rebuilt.length <= boxes.length && !irregular) continue;
        if (rebuilt.length < Math.max(10, boxes.length + (tooShort ? 2 : 0))) continue;
        const score =
          rebuilt.length * 80 +
          mean(rebuilt.map((box) => box.score)) -
          Math.abs(topYBase - rows[0]!.y) * 0.9 -
          Math.abs(rightX - rightXBase) * 0.4;
        if (!best || score > best.score) best = { boxes: rebuilt, score };
      }
    }
  }

  return best ? best.boxes : boxes;
}

function candidateTwoRowYs(rowYs: number[], size: number) {
  const pairs: Array<[number, number]> = [];
  const addPair = (topY: number, lowerY: number) => {
    if (topY < 0 || lowerY < 0) return;
    if (lowerY - topY < size * 0.82 || lowerY - topY > size * 1.45) return;
    const rounded: [number, number] = [Math.round(topY), Math.round(lowerY)];
    if (pairs.some(([top, lower]) => Math.abs(top - rounded[0]) <= 2 && Math.abs(lower - rounded[1]) <= 2)) return;
    pairs.push(rounded);
  };

  const sorted = [...rowYs].sort((a, b) => a - b);
  if (sorted.length >= 2) {
    addPair(sorted[0]!, sorted[1]!);
    addPair(sorted[1]! - Math.round(size * 1.15), sorted[1]!);
  } else if (sorted.length === 1) {
    const y = sorted[0]!;
    if (y <= Math.max(10, size * 0.35)) addPair(y, y + Math.round(size * 1.15));
    else addPair(y - Math.round(size * 1.15), y);
  }
  return pairs;
}

function bestScoredGridRun(
  rightX: number,
  yBase: number,
  size: number,
  maps: FeatureMaps,
  roi: Rect,
  image: ImageLike,
) {
  let bestRun: BuffIconBox[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let y = yBase - 5; y <= yBase + 5; y++) {
    const run = scoredGridRun(rightX, y, size, maps, roi, image);
    if (run.length === 0) continue;
    const score = run.length * 55 + mean(run.map((box) => box.score)) - Math.abs(y - yBase) * 1.4;
    if (score > bestScore) {
      bestScore = score;
      bestRun = run;
    }
  }
  return bestRun;
}

function scoredGridRun(rightX: number, y: number, size: number, maps: FeatureMaps, roi: Rect, image: ImageLike) {
  const acceptScore = Math.max(138, rowCellThreshold(size) + 34);
  const run: BuffIconBox[] = [];
  for (let step = 0; step < 13; step++) {
    const x = Math.round(rightX - size * step);
    const direct: BuffIconBox = { x, y, size, score: 0, confidence: 0 };
    if (x < roi.x || x + size > image.width || y < roi.y || y + size > image.height) break;
    const score = scoreTightSlot(maps, x - roi.x, y - roi.y, size).score;
    const quality = cropQuality(image, direct);
    const visualBacked = score >= acceptScore && quality.edge >= 12 && quality.bright <= 0.82;
    if (!visualBacked) break;
    run.push({
      ...direct,
      score: Math.max(score, 190),
      confidence: Math.min(0.96, Math.max(0.72, score / 360)),
    });
  }
  return run.reverse();
}

export function polishDetectedRowsToFrame(boxes: BuffIconBox[], maps: FeatureMaps, roi: Rect) {
  const rows = clusterBoxesByRow(boxes);
  return rows.flatMap((row) => {
    if (row.length < 4) return row;
    const baseSize = median(row.map((box) => box.size));
    if (baseSize < 40) return row;

    let bestDy = 0;
    let bestScore = rowFrameScore(row, maps, roi, 0);
    const rowY = Math.round(median(row.map((box) => box.y)));
    const topLargeRow = baseSize >= 52 && rowY - roi.y <= Math.max(24, baseSize * 0.45);
    const searchRadius = baseSize < 52 ? 12 : topLargeRow ? Math.max(10, Math.min(16, Math.round(baseSize * 0.24))) : 8;
    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      if (dy === 0) continue;
      const score = rowFrameScore(row, maps, roi, dy) - Math.abs(dy) * 0.18;
      if (score > bestScore) {
        bestScore = score;
        bestDy = dy;
      }
    }
    if (bestDy === 0) return row;
    const currentScore = rowFrameScore(row, maps, roi, 0);
    const minGain = baseSize < 52 ? 3 : 4;
    if (bestScore < currentScore + minGain) return row;
    return row.map((box) => ({ ...box, y: box.y + bestDy }));
  });
}

export function snapTopRowToLowerVerticalPitch(boxes: BuffIconBox[], roi: Rect) {
  const rows = clusterBoxesByRow(boxes)
    .filter((row) => row.length >= 3)
    .map((row) => ({
      row,
      y: Math.round(median(row.map((box) => box.y))),
      size: median(row.map((box) => box.size)),
    }))
    .sort((a, b) => a.y - b.y);
  if (rows.length < 2) return boxes;

  const first = rows[0]!;
  const firstLocalY = first.y - roi.y;
  if (firstLocalY > Math.max(24, first.size * 0.45)) return boxes;
  const second = rows[1]!;
  const adjacentSize = Math.round(median([first.size, second.size]));
  const adjacentGap = second.y - first.y;
  if (adjacentGap >= adjacentSize * 0.78 && adjacentGap <= adjacentSize * 1.08) {
    const predictedTopY = Math.round(second.y - adjacentSize);
    const drift = Math.abs(predictedTopY - first.y);
    if (
      predictedTopY >= roi.y &&
      predictedTopY - roi.y <= Math.max(24, adjacentSize * 0.42) &&
      drift >= 2 &&
      drift <= Math.max(6, adjacentSize * 0.14)
    ) {
      const firstSet = new Set(first.row);
      return boxes.map((box) => (firstSet.has(box) ? { ...box, y: predictedTopY } : box));
    }
  }

  if (rows.length < 3) return boxes;

  const lowerDiffs: number[] = [];
  for (let index = 1; index < rows.length - 1; index++) {
    const diff = rows[index + 1]!.y - rows[index]!.y;
    const size = (rows[index]!.size + rows[index + 1]!.size) / 2;
    if (diff >= size * 0.9 && diff <= size * 1.35) lowerDiffs.push(diff);
  }
  if (lowerDiffs.length === 0) return boxes;

  const pitch = Math.round(median(lowerDiffs));
  const predictedTopY = rows[1]!.y - pitch;
  if (predictedTopY < roi.y || predictedTopY - roi.y > Math.max(6, first.size * 0.16)) return boxes;
  if (Math.abs(predictedTopY - first.y) > Math.max(4, first.size * 0.16)) return boxes;

  const firstSet = new Set(first.row);
  return boxes.map((box) => (firstSet.has(box) ? { ...box, y: predictedTopY } : box));
}

export function snapDenseAdjacentRows(boxes: BuffIconBox[]) {
  const rows = clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      y: Math.round(median(row.map((box) => box.y))),
      size: median(row.map((box) => box.size)),
    }))
    .sort((a, b) => a.y - b.y);
  if (rows.length < 2) return boxes;

  const yByBox = new Map<BuffIconBox, number>();
  for (let index = 0; index < rows.length - 1; index++) {
    const upper = rows[index]!;
    const lower = rows[index + 1]!;
    if (upper.row.length < 4 || lower.row.length < 4) continue;
    const size = Math.round(median([...upper.row, ...lower.row].map((box) => box.size)));
    const gap = lower.y - upper.y;
    if (gap < size * 0.78 || gap > size * 0.98) continue;

    const snappedY = upper.y + size;
    if (Math.abs(snappedY - lower.y) > Math.max(2, size * 0.08)) continue;
    for (const box of lower.row) yByBox.set(box, snappedY);
  }

  return yByBox.size === 0 ? boxes : boxes.map((box) => (yByBox.has(box) ? { ...box, y: yByBox.get(box)! } : box));
}
