import type { BuffIconBox, ImageLike } from "../types.js";
import { clusterBoxesByRow, estimateGlobalGrid } from "./grid.js";
import { median } from "./math.js";
import { detectGameViewport } from "./viewport.js";
import { hasLikelyBuffFrame, hasVisibleRightRailControl, isDamageNumberLikeCrop } from "./cropQuality.js";
import { hasChainedRightRailRow, pruneDetachedFragmentsBelowSingleTopRow, pruneFrameLessDetachedRows, pruneImpossibleLeftRowEdges, pruneOverfullMultiRowRows, pruneOverlappingRowFragments, pruneOverlappingSingletonFragments, pruneRightOverflowGridFragments, pruneVerticallyOverlappingRows } from "./structuralPruning.js";
import { pruneBlankDarkWindowPrefixes, pruneCollapsedTopRowFragments, pruneDamageTextRowPrefixes, pruneDetachedVisualRows, pruneShortRightRailEffectPrefixes, pruneTopDamageTextPrefixes, pruneWeakLeadingRowFragments, pruneWeakLeftEdgeFragments, pruneWeakTextOverlayPrefixes } from "./visualPruning.js";

export { hasLikelyBuffFrame } from "./cropQuality.js";

export function pruneDetachedDamageRows(boxes: BuffIconBox[], image: ImageLike) {
  if (boxes.length < 8) return boxes;
  const viewportTop = detectGameViewport(image).y;
  const rows = clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      y: Math.round(median(row.map((box) => box.y))),
      size: Math.round(median(row.map((box) => box.size))),
    }))
    .sort((a, b) => a.y - b.y);
  const strongRows = rows.filter((row) => row.row.length >= 3);
  if (strongRows.length < 2) {
    const remove = new Set<BuffIconBox>();
    if (strongRows.length === 1) pruneDetachedFragmentsBelowSingleTopRow(rows, strongRows[0]!, image, viewportTop, remove);
    return remove.size === 0 ? boxes : boxes.filter((box) => !remove.has(box));
  }

  const grid = estimateGlobalGrid(rows.map((row) => row.row));
  const size = Math.round(median(strongRows.flatMap((row) => row.row.map((box) => box.size))));
  const strongRightSlots = grid
    ? strongRows
        .filter((row) => row.row.length >= 4)
        .flatMap((row) => row.row.map((box) => Math.round((box.x - grid.anchor) / grid.pitch)))
    : [];
  const strongestRightSlot = strongRightSlots.length > 0 ? Math.max(...strongRightSlots) : undefined;
  const strongestRightEdge = Math.max(...strongRows.flatMap((row) => row.row.map((box) => box.x + box.size)));
  const lastStrongY = Math.max(...strongRows.map((row) => row.y));
  const supportedColumnXs = supportedColumnsFromRows(strongRows, size);
  const remove = new Set<BuffIconBox>();

  pruneVerticallyOverlappingRows(rows, image, remove);
  pruneOverlappingSingletonFragments(rows, image, remove);
  pruneOverlappingRowFragments(rows, image, remove);
  pruneFrameLessDetachedRows(rows, image, remove);
  if (grid) pruneRightOverflowGridFragments(rows, grid, image, remove);
  pruneOverfullMultiRowRows(rows, image, remove);

  for (const row of rows) {
    if (row.row.length > 2) continue;
    const overlapsStrongRow = strongRows.some((strong) => strong !== row && Math.abs(row.y - strong.y) < size * 0.72);
    const slots = grid ? row.row.map((box) => Math.round((box.x - grid.anchor) / grid.pitch)).sort((a, b) => a - b) : [];
    const rightAligned =
      strongestRightSlot === undefined || slots.length === 0 ? true : Math.max(...slots) >= strongestRightSlot;
    const consecutive = slots.length <= 1 || slots.every((slot, index) => index === 0 || slot - slots[index - 1]! === 1);
    const detachedDamage = row.y > lastStrongY + size * 0.45 && row.row.every((box) => isDamageNumberLikeCrop(image, box));
    const rowRightEdge = Math.max(...row.row.map((box) => box.x + box.size));
    const plausibleRightRailSingleton =
      row.row.length === 1 &&
      (strongestRightSlot !== undefined && slots.length === 1
        ? slots[0]! >= strongestRightSlot
        : Math.abs(rowRightEdge - strongestRightEdge) <= size * 0.42) &&
      (row.y <= lastStrongY + size * 1.45 || hasChainedRightRailRow(rows, row, lastStrongY, strongestRightEdge, size));
    const railBackedSingleton = plausibleRightRailSingleton && hasVisibleRightRailControl(image, row.row[0]!);
    const columnOverlappedSingleton =
      row.row.length === 1 &&
      supportedColumnXs.some((columnX) => hasConflictingColumnOverlap(row.row[0]!, columnX, size));
    const weakDetachedSingleton =
      row.row.length === 1 &&
      row.y > lastStrongY + size * 0.45 &&
      !plausibleRightRailSingleton &&
      !hasLikelyBuffFrame(image, row.row[0]!);

    if (overlapsStrongRow || !rightAligned || !consecutive || (detachedDamage && !railBackedSingleton) || columnOverlappedSingleton || weakDetachedSingleton) {
      for (const box of row.row) remove.add(box);
    }
  }

  pruneImpossibleLeftRowEdges(rows.map((row) => row.row), image, remove);
  pruneDetachedVisualRows(rows, image, remove);
  pruneDamageTextRowPrefixes(rows, image, viewportTop, remove);
  pruneWeakLeftEdgeFragments(rows.map((row) => row.row), image, viewportTop, remove);
  pruneWeakTextOverlayPrefixes(rows, image, viewportTop, remove);
  pruneBlankDarkWindowPrefixes(rows, image, viewportTop, remove);
  pruneShortRightRailEffectPrefixes(rows, image, remove);
  pruneCollapsedTopRowFragments(rows, image, viewportTop, remove);
  pruneTopDamageTextPrefixes(rows, image, viewportTop, remove);
  pruneWeakLeadingRowFragments(rows, image, viewportTop, remove);

  return remove.size === 0 ? boxes : boxes.filter((box) => !remove.has(box));
}

function supportedColumnsFromRows(rows: Array<{ row: BuffIconBox[] }>, size: number) {
  const tolerance = Math.max(4, size * 0.22);
  const columns: Array<{ xs: number[] }> = [];
  for (const box of rows.flatMap((row) => row.row)) {
    const column = columns.find((candidate) => Math.abs(median(candidate.xs) - box.x) <= tolerance);
    if (column) {
      column.xs.push(box.x);
    } else {
      columns.push({ xs: [box.x] });
    }
  }
  return columns.filter((column) => column.xs.length >= 2).map((column) => Math.round(median(column.xs)));
}

function hasConflictingColumnOverlap(box: BuffIconBox, columnX: number, size: number) {
  const overlap = Math.max(0, Math.min(box.x + box.size, columnX + size) - Math.max(box.x, columnX));
  const overlapRatio = overlap / Math.max(1, Math.min(box.size, size));
  return overlapRatio >= 0.55 && Math.abs(box.x - columnX) >= Math.max(5, size * 0.2);
}
