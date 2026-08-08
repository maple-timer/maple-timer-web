import type { BuffIconBox, GridHint, GridRowInfo, ImageLike } from "../types.js";
import { median } from "./math.js";

export function clusterBoxesByRow(boxes: BuffIconBox[]) {
  const rows: BuffIconBox[][] = [];
  for (const box of [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let bestRow: BuffIconBox[] | undefined;
    let bestDistance = Infinity;
    for (const row of rows) {
      const rowY = median(row.map((item) => item.y));
      const rowSize = median(row.map((item) => item.size));
      const distance = Math.abs(box.y - rowY);
      const yTolerance = Math.max(6, rowSize * 0.42);
      const sizeTolerance = Math.max(3, rowSize * 0.1);
      if (distance <= yTolerance && Math.abs(box.size - rowSize) <= sizeTolerance && distance < bestDistance) {
        bestRow = row;
        bestDistance = distance;
      }
    }
    if (bestRow) bestRow.push(box);
    else rows.push([box]);
  }
  return rows;
}

export function stabilizeDetectedRows(boxes: BuffIconBox[], image: ImageLike) {
  if (boxes.length < 3) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const grid = estimateGlobalGrid(rows);
  return rows.flatMap((row) => stabilizeRowBoxes(row, image, grid));
}

function stabilizeRowBoxes(row: BuffIconBox[], image: ImageLike, grid?: GridHint) {
  if (row.length < 3) return row;
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const baseSize = median(sorted.map((box) => box.size));
  if (baseSize < 40) return sorted;
  if (!grid && sorted.length === 3) return stabilizeSparseThreeBoxRow(sorted, baseSize);

  const rowPitch = estimateRowPitch(sorted, baseSize);
  const pitch = grid && Math.abs(grid.size - baseSize) <= Math.max(4, baseSize * 0.12) ? grid.pitch : rowPitch;
  if (pitch < baseSize * 0.78 || pitch > baseSize * 1.32) return sorted;

  const rowY = Math.round(median(sorted.map((box) => box.y)));
  const rowSize = Math.round(baseSize < 52 ? Math.max(baseSize, pitch) : baseSize);
  const anchor = grid && Math.abs(grid.size - baseSize) <= Math.max(4, baseSize * 0.12) ? grid.anchor : estimateRowAnchor(sorted, pitch);
  const snapTolerance = Math.max(7, rowSize * 0.22);
  const snappedRowY = snapRowYToGlobalGrid(rowY, rowSize, grid);

  return sorted.map((box) => {
    const slot = Math.round((box.x - anchor) / pitch);
    const snappedX = Math.round(anchor + slot * pitch);
    const safeSnapX = slot >= 0 && Math.abs(snappedX - box.x) <= snapTolerance && snappedX >= 0 && snappedX + rowSize <= image.width;
    return {
      ...box,
      x: safeSnapX ? snappedX : box.x,
      y: snappedRowY,
      size: rowSize,
    };
  });
}

function stabilizeSparseThreeBoxRow(row: BuffIconBox[], baseSize: number) {
  const diffs = [row[1]!.x - row[0]!.x, row[2]!.x - row[1]!.x];
  const pitch = Math.round(Math.max(...diffs));
  if (pitch < baseSize * 0.94 || pitch > baseSize * 1.34) return row;
  const rowSize = Math.round(Math.max(baseSize, pitch));
  const anchor = Math.round(median([row[1]!.x - pitch, row[2]!.x - pitch * 2]));
  const rowY = Math.round(median(row.map((box) => box.y)));

  return row.map((box, index) => ({
    ...box,
    x: anchor + index * pitch,
    y: rowY,
    size: rowSize,
  }));
}

export function estimateGlobalGrid(rows: BuffIconBox[][]): GridHint | undefined {
  const strongRows = rows
    .filter((row) => row.length >= 6)
    .map((row) => {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      const size = median(sorted.map((box) => box.size));
      const pitch = estimateRowPitch(sorted, size);
      if (size < 30 || pitch < size * 0.78 || pitch > size * 1.32) return undefined;
      return {
        sorted,
        size,
        pitch,
        anchor: estimateRowAnchor(sorted, pitch),
      };
    })
    .filter((row): row is { sorted: BuffIconBox[]; size: number; pitch: number; anchor: number } => Boolean(row));

  if (strongRows.length < 2) return undefined;
  const pitch = Math.round(median(strongRows.map((row) => row.pitch)));
  const size = Math.round(median(strongRows.flatMap((row) => row.sorted.map((box) => box.size))));
  const baseAnchor = Math.min(...strongRows.map((row) => row.anchor));
  const normalizedAnchors = strongRows.map((row) => row.anchor + Math.round((baseAnchor - row.anchor) / pitch) * pitch);
  const anchor = Math.round(median(normalizedAnchors));
  const rowYs = strongRows.map((row) => Math.round(median(row.sorted.map((box) => box.y)))).sort((a, b) => a - b);
  const verticalDiffs: number[] = [];
  for (let index = 0; index < rowYs.length - 1; index++) {
    const diff = rowYs[index + 1]! - rowYs[index]!;
    if (diff >= size * 0.92 && diff <= size * 1.45) verticalDiffs.push(diff);
  }
  const verticalPitch = verticalDiffs.length > 0 ? Math.round(median(verticalDiffs)) : undefined;
  const verticalAnchor = verticalPitch ? rowYs[0] : undefined;
  return { pitch, anchor, size, verticalPitch, verticalAnchor };
}

function estimateRowAnchor(row: BuffIconBox[], pitch: number) {
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const leftX = sorted[0]!.x;
  return Math.round(median(sorted.map((box) => box.x - Math.round((box.x - leftX) / pitch) * pitch)));
}

function snapRowYToGlobalGrid(rowY: number, rowSize: number, grid?: GridHint) {
  if (!grid?.verticalPitch || grid.verticalAnchor === undefined || rowSize < 52) return rowY;
  const slot = Math.round((rowY - grid.verticalAnchor) / grid.verticalPitch);
  if (slot < 0) return rowY;
  const snappedY = Math.round(grid.verticalAnchor + slot * grid.verticalPitch);
  return Math.abs(snappedY - rowY) <= rowSize * 0.45 ? snappedY : rowY;
}

export function estimateRowPitch(row: BuffIconBox[], baseSize: number) {
  const diffs: number[] = [];
  const sorted = [...row].sort((a, b) => a.x - b.x);
  for (let index = 0; index < sorted.length - 1; index++) {
    const gap = sorted[index + 1]!.x - sorted[index]!.x;
    if (gap >= baseSize * 0.72 && gap <= baseSize * 1.38) diffs.push(gap);
  }
  if (diffs.length === 0) return Math.round(baseSize);
  return Math.round(median(diffs));
}

export function describeGridRow(row: BuffIconBox[], grid: GridHint): GridRowInfo | undefined {
  if (row.length < 3) return undefined;
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const baseSize = median(sorted.map((box) => box.size));
  if (baseSize < 30 || Math.abs(baseSize - grid.size) > Math.max(4, baseSize * 0.14)) return undefined;

  const rowPitch = estimateRowPitch(sorted, baseSize);
  if (Math.abs(rowPitch - grid.pitch) > Math.max(4, baseSize * 0.16)) return undefined;

  const rowSize = Math.round(baseSize < 52 ? Math.max(baseSize, grid.pitch) : baseSize);
  const snapTolerance = Math.max(6, rowSize * 0.24);
  const slots = sorted.map((box) => Math.round((box.x - grid.anchor) / grid.pitch));
  const snapped = sorted.filter((box, index) => Math.abs(grid.anchor + slots[index]! * grid.pitch - box.x) <= snapTolerance);
  const snapRatio = snapped.length / sorted.length;
  if (snapRatio < 0.66) return undefined;

  return {
    row,
    sorted,
    baseSize,
    rowY: Math.round(median(sorted.map((box) => box.y))),
    rowSize,
    maxSlot: Math.max(...slots),
    slots,
    snapRatio,
  };
}

export function estimateConsensusRightSlot(rows: GridRowInfo[]) {
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (row.sorted.length < 4 || row.snapRatio < 0.78) continue;
    counts.set(row.maxSlot, (counts.get(row.maxSlot) ?? 0) + 1);
  }

  let best: { slot: number; count: number } | undefined;
  for (const [slot, count] of counts) {
    if (count < 2) continue;
    if (!best || count > best.count || (count === best.count && slot > best.slot)) best = { slot, count };
  }
  return best?.slot;
}

export function pruneDetachedGridOutliers(rows: BuffIconBox[][], gridRows: GridRowInfo[], grid: GridHint) {
  const columnSupport = new Map<number, number>();
  for (const row of gridRows) {
    for (const slot of new Set(row.slots)) {
      columnSupport.set(slot, (columnSupport.get(slot) ?? 0) + 1);
    }
  }

  const prunedByRow = new Map<BuffIconBox[], BuffIconBox[]>();
  for (const row of gridRows) {
    prunedByRow.set(row.row, pruneDetachedRowOutliers(row, grid, columnSupport));
  }

  return rows.flatMap((row) => prunedByRow.get(row) ?? row);
}

function pruneDetachedRowOutliers(row: GridRowInfo, grid: GridHint, columnSupport: Map<number, number>) {
  if (row.sorted.length < 4) return row.sorted;

  const components: { boxes: BuffIconBox[]; slots: number[] }[] = [];
  for (let index = 0; index < row.sorted.length; index++) {
    const box = row.sorted[index]!;
    const slot = row.slots[index]!;
    const current = components[components.length - 1];
    if (!current || slot - current.slots[current.slots.length - 1]! > 2) {
      components.push({ boxes: [box], slots: [slot] });
    } else {
      current.boxes.push(box);
      current.slots.push(slot);
    }
  }

  if (components.length < 2) return row.sorted;
  const rightComponent = components[components.length - 1]!;
  if (rightComponent.boxes.length < 3) return row.sorted;

  const rightScore = median(rightComponent.boxes.map((box) => box.score));
  const kept = new Set<BuffIconBox>(rightComponent.boxes);
  for (let index = components.length - 2; index >= 0; index--) {
    const component = components[index]!;
    const next = components[index + 1]!;
    const slotGap = next.slots[0]! - component.slots[component.slots.length - 1]!;
    const supported = component.slots.some((slot) => (columnSupport.get(slot) ?? 0) >= 2);
    const componentScore = median(component.boxes.map((box) => box.score));
    const detachedSingle = component.boxes.length <= 1 && slotGap >= 2;
    const detachedSmallGroup = component.boxes.length <= 2 && slotGap >= 3 && rightComponent.boxes.length >= 5;
    const verySmall = component.boxes.length <= 1 && slotGap >= 3;
    const smallWeak = component.boxes.length <= 2 && slotGap >= 4 && componentScore < rightScore * 0.92;

    if (!supported && (detachedSingle || detachedSmallGroup || verySmall || smallWeak)) continue;
    for (const box of component.boxes) kept.add(box);
  }

  const result = row.sorted.filter((box) => kept.has(box));
  return result.length >= 3 ? result : row.sorted;
}
