import type { BuffIconBox, FeatureMaps, GridRowInfo, ImageLike, Rect } from "../types.js";
import { clusterBoxesByRow, describeGridRow, estimateGlobalGrid } from "./grid.js";
import { median } from "./math.js";
import { hasLikelyBuffFrame } from "./pruning.js";
import { columnFrameScoreAt, rowFrameScore } from "./scoring.js";

export function alignFinalGridCoordinates(boxes: BuffIconBox[], maps: FeatureMaps, roi: Rect, image: ImageLike) {
  if (boxes.length < 2) return boxes;
  const rowAligned = alignFinalRowY(boxes, maps, roi, image);
  const topClippedAligned = alignTopClippedCompactRow(rowAligned, image);
  const rows = clusterBoxesByRow(topClippedAligned);
  const grid = estimateGlobalGrid(rows);
  if (!grid) return alignSupportedCompactColumns(topClippedAligned, maps, roi, image);

  const rowInfos = rows.map((row) => describeGridRow(row, grid)).filter((row): row is GridRowInfo => Boolean(row));
  if (rowInfos.length < 2) return alignSupportedCompactColumns(topClippedAligned, maps, roi, image);

  const verticalAligned = snapRowsToVerticalGrid(topClippedAligned, rowInfos, grid, maps, roi, image);
  const verticalRows = clusterBoxesByRow(verticalAligned);
  const verticalGrid = estimateGlobalGrid(verticalRows) ?? grid;
  const verticalRowInfos = verticalRows
    .map((row) => describeGridRow(row, verticalGrid))
    .filter((row): row is GridRowInfo => Boolean(row));
  if (verticalRowInfos.length < 2) return alignSupportedCompactColumns(verticalAligned, maps, roi, image);

  const columnBoxes = new Map<number, BuffIconBox[]>();
  for (const row of verticalRowInfos) {
    for (let index = 0; index < row.sorted.length; index++) {
      const box = row.sorted[index]!;
      const slot = row.slots[index]!;
      const snappedX = Math.round(verticalGrid.anchor + slot * verticalGrid.pitch);
      if (Math.abs(snappedX - box.x) > row.rowSize * 0.3) continue;
      const list = columnBoxes.get(slot) ?? [];
      list.push(box);
      columnBoxes.set(slot, list);
    }
  }

  const columnX = new Map<number, number>();
  for (const [slot, column] of columnBoxes) {
    if (column.length < 2) continue;
    const size = Math.round(median(column.map((box) => box.size)));
    const baseX = Math.round(verticalGrid.anchor + slot * verticalGrid.pitch);
    const radius = Math.max(2, Math.min(8, Math.round(size * 0.15)));
    let bestX = baseX;
    let bestScore = columnFrameScoreAt(column, maps, roi, baseX);
    const currentScore = bestScore;
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0) continue;
      const x = baseX + dx;
      if (x < 0 || x + size > image.width) continue;
      const score = columnFrameScoreAt(column, maps, roi, x) - Math.abs(dx) * 0.18;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
      }
    }
    columnX.set(slot, bestScore >= currentScore + 2 ? bestX : baseX);
  }

  if (columnX.size === 0) return verticalAligned;
  return verticalAligned.map((box) => {
    const slot = Math.round((box.x - verticalGrid.anchor) / verticalGrid.pitch);
    const x = columnX.get(slot);
    if (x === undefined || Math.abs(x - box.x) > box.size * 0.32 || x < 0 || x + box.size > image.width) return box;
    return { ...box, x };
  });
}

function alignTopClippedCompactRow(boxes: BuffIconBox[], image: ImageLike) {
  const rows = clusterBoxesByRow(boxes).sort((a, b) => median(a.map((box) => box.y)) - median(b.map((box) => box.y)));
  if (rows.length < 2) return boxes;

  const top = rows[0]!;
  const topSorted = [...top].sort((a, b) => a.x - b.x);
  if (topSorted.length < 5) return boxes;

  const size = Math.round(median(topSorted.map((box) => box.size)));
  const topY = Math.round(median(topSorted.map((box) => box.y)));
  if (size < 28 || size > 42 || topY > Math.max(4, size * 0.18)) return boxes;
  if (topSorted.some((box) => hasLikelyBuffFrame(image, box))) return boxes;

  const support = rows
    .slice(1)
    .map((row) => [...row].sort((a, b) => a.x - b.x))
    .find((row) => {
      if (row.length < 5) return false;
      const rowSize = Math.round(median(row.map((box) => box.size)));
      if (Math.abs(rowSize - size) > Math.max(3, size * 0.12)) return false;
      const frameCount = row.filter((box) => hasLikelyBuffFrame(image, box)).length;
      const topRight = topSorted[topSorted.length - 1]!.x + size;
      const rowRight = row[row.length - 1]!.x + rowSize;
      return frameCount >= Math.max(3, Math.ceil(row.length * 0.58)) && Math.abs(topRight - rowRight) <= size * 0.55;
    });
  if (!support) return boxes;
  if (topSorted.length <= support.length) return boxes;

  const diffs: number[] = [];
  for (let index = 0; index < support.length - 1; index++) {
    const diff = support[index + 1]!.x - support[index]!.x;
    if (diff >= size * 0.78 && diff <= size * 1.34) diffs.push(diff);
  }
  const pitch = Math.round(diffs.length > 0 ? median(diffs) : size);
  if (pitch < size * 0.78 || pitch > size * 1.34) return boxes;

  const snapX = new Map<BuffIconBox, number>();
  for (let index = topSorted.length - 1; index >= 0; index--) {
    const box = topSorted[index]!;
    const fromRight = topSorted.length - 1 - index;
    const supportIndex = support.length - 1 - fromRight;
    const targetX = supportIndex >= 0 ? support[supportIndex]!.x : support[0]!.x - Math.abs(supportIndex) * pitch;
    if (targetX < 0 || targetX + size > image.width) continue;
    if (Math.abs(targetX - box.x) <= size * 0.52) snapX.set(box, Math.round(targetX));
  }
  if (snapX.size < Math.min(topSorted.length, 4)) return boxes;

  return boxes.map((box) => {
    const x = snapX.get(box);
    if (x === undefined) return box;
    return { ...box, x, y: topY, size };
  });
}

function snapRowsToVerticalGrid(
  boxes: BuffIconBox[],
  rows: GridRowInfo[],
  grid: NonNullable<ReturnType<typeof estimateGlobalGrid>>,
  maps: FeatureMaps,
  roi: Rect,
  image: ImageLike,
) {
  if (!grid.verticalPitch || grid.verticalAnchor === undefined) return boxes;
  const yByBox = new Map<BuffIconBox, number>();
  for (const row of rows) {
    if (row.sorted.length < 2) continue;
    const slot = Math.round((row.rowY - grid.verticalAnchor) / grid.verticalPitch);
    if (slot < 0) continue;
    const snappedY = Math.round(grid.verticalAnchor + slot * grid.verticalPitch);
    if (snappedY < 0 || snappedY + row.rowSize > image.height) continue;
    const drift = Math.abs(snappedY - row.rowY);
    if (drift < 1 || drift > Math.max(10, row.rowSize * 0.3)) continue;

    const currentScore = rowFrameScore(row.sorted, maps, roi, 0);
    const snappedScore = rowFrameScore(row.sorted, maps, roi, snappedY - row.rowY);
    if (snappedScore < currentScore - 10) continue;
    for (const box of row.row) yByBox.set(box, snappedY);
  }

  return yByBox.size === 0 ? boxes : boxes.map((box) => (yByBox.has(box) ? { ...box, y: yByBox.get(box)! } : box));
}

function alignSupportedCompactColumns(boxes: BuffIconBox[], maps: FeatureMaps, roi: Rect, image: ImageLike) {
  if (boxes.length < 6) return boxes;
  const rows = clusterBoxesByRow(boxes);
  if (rows.length < 2) return boxes;
  const rowSizes = rows.flatMap((row) => row.map((box) => box.size));
  const baseSize = Math.round(median(rowSizes));
  if (baseSize < 28 || baseSize > 42) return boxes;

  const sortedBoxes = [...boxes].sort((a, b) => a.x - b.x || a.y - b.y);
  const columns: BuffIconBox[][] = [];
  const xTolerance = Math.max(2, Math.round(baseSize * 0.08));
  for (const box of sortedBoxes) {
    let bestColumn: BuffIconBox[] | undefined;
    let bestDistance = Infinity;
    for (const column of columns) {
      const columnX = median(column.map((item) => item.x));
      const columnSize = median(column.map((item) => item.size));
      const distance = Math.abs(box.x - columnX);
      if (distance <= xTolerance && Math.abs(box.size - columnSize) <= 3 && distance < bestDistance) {
        bestColumn = column;
        bestDistance = distance;
      }
    }
    if (bestColumn) bestColumn.push(box);
    else columns.push([box]);
  }

  const columnX = new Map<BuffIconBox, number>();
  for (const column of columns) {
    if (column.length < 2) continue;
    const uniqueRows = new Set(column.map((box) => Math.round(box.y / Math.max(1, baseSize * 0.7))));
    if (uniqueRows.size < 2) continue;
    const size = Math.round(median(column.map((box) => box.size)));
    const baseX = Math.round(median(column.map((box) => box.x)));
    const radius = Math.max(1, Math.min(3, Math.round(size * 0.08)));
    let bestX = baseX;
    let bestScore = columnFrameScoreAt(column, maps, roi, baseX);
    const currentScore = bestScore;
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0) continue;
      const x = baseX + dx;
      if (x < 0 || x + size > image.width) continue;
      const score = columnFrameScoreAt(column, maps, roi, x) - Math.abs(dx) * 0.35;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
      }
    }
    const minGain = size < 36 ? 18 : 24;
    if (bestScore < currentScore + minGain) continue;
    for (const box of column) {
      if (Math.abs(bestX - box.x) <= Math.max(2, size * 0.12) && bestX >= 0 && bestX + box.size <= image.width) {
        columnX.set(box, bestX);
      }
    }
  }

  if (columnX.size === 0) return boxes;
  return boxes.map((box) => {
    const x = columnX.get(box);
    return x === undefined ? box : { ...box, x };
  });
}

function alignFinalRowY(boxes: BuffIconBox[], maps: FeatureMaps, roi: Rect, image: ImageLike) {
  const rows = clusterBoxesByRow(boxes);
  const strongRows = rows.filter((row) => row.length >= 3);
  const strongestRightEdge =
    strongRows.length > 0 ? Math.max(...strongRows.flatMap((row) => row.map((box) => box.x + box.size))) : undefined;
  return rows.flatMap((row) => {
    const rowSize = Math.round(median(row.map((box) => box.size)));
    if (rowSize < 28) return row;
    const rowY = Math.round(median(row.map((box) => box.y)));
    const rowRightEdge = Math.max(...row.map((box) => box.x + box.size));
    const shortRightRailRow =
      row.length <= 3 &&
      strongestRightEdge !== undefined &&
      Math.abs(rowRightEdge - strongestRightEdge) <= Math.max(8, rowSize * 0.72);
    if (row.length < 2 && !shortRightRailRow) return row;
    const normalized = row.map((box) => ({ ...box, y: rowY, size: Math.round(median([box.size, rowSize])) }));
    let bestDy = 0;
    let bestScore = rowFrameScore(normalized, maps, roi, 0);
    const currentScore = bestScore;
    const topLargeRow = rowSize >= 52 && rowY - roi.y <= Math.max(24, rowSize * 0.45);
    const radius =
      shortRightRailRow
        ? Math.max(8, Math.min(18, Math.round(rowSize * 0.3)))
        : rowSize < 52
          ? Math.max(3, Math.min(12, Math.round(rowSize * 0.24)))
          : topLargeRow
            ? Math.max(10, Math.min(16, Math.round(rowSize * 0.24)))
            : Math.max(2, Math.min(8, Math.round(rowSize * 0.16)));
    for (let dy = -radius; dy <= radius; dy++) {
      if (dy === 0) continue;
      const y = rowY + dy;
      if (y < 0 || y + rowSize > image.height) continue;
      const score = rowFrameScore(normalized, maps, roi, dy) - Math.abs(dy) * 0.18;
      if (score > bestScore) {
        bestScore = score;
        bestDy = dy;
      }
    }
    const minGain = shortRightRailRow ? Math.max(8, rowSize * 0.12) : rowSize < 40 ? 2 : 3;
    const finalY = bestScore >= currentScore + minGain ? rowY + bestDy : rowY;
    return normalized.map((box) => ({ ...box, y: finalY }));
  });
}
