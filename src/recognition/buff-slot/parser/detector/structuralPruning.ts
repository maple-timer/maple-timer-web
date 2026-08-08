import type { BuffIconBox, ImageLike } from "../types.js";
import { estimateGlobalGrid } from "./grid.js";
import { iou, median } from "./math.js";
import { cropQuality, hasLikelyBuffFrame, isDamageNumberLikeCrop, isDamageTextPrefixFragment, isFlatDarkEffectFragment, isTextOverlayFragment } from "./cropQuality.js";

export function pruneRightOverflowGridFragments(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  grid: NonNullable<ReturnType<typeof estimateGlobalGrid>>,
  image: ImageLike,
  remove: Set<BuffIconBox>,
) {
  const maxSlotCounts = new Map<number, number>();
  for (const row of rows) {
    if (row.row.length < 4) continue;
    const slots = row.row.map((box) => Math.round((box.x - grid.anchor) / grid.pitch));
    const maxSlot = Math.max(...slots);
    const snapped = row.row.filter((box, index) => Math.abs(grid.anchor + slots[index]! * grid.pitch - box.x) <= row.size * 0.34);
    if (snapped.length / row.row.length < 0.66) continue;
    maxSlotCounts.set(maxSlot, (maxSlotCounts.get(maxSlot) ?? 0) + 1);
  }

  let targetSlot: number | undefined;
  let targetCount = 0;
  for (const [slot, count] of maxSlotCounts) {
    if (count < 2) continue;
    if (count > targetCount || (count === targetCount && (targetSlot === undefined || slot > targetSlot))) {
      targetSlot = slot;
      targetCount = count;
    }
  }
  if (targetSlot === undefined) return;

  for (const row of rows) {
    if (row.row.length < 3) continue;
    const rowScore = median(row.row.map((box) => box.score));
    for (const box of row.row) {
      const slot = Math.round((box.x - grid.anchor) / grid.pitch);
      if (slot <= targetSlot) continue;
      const weakOverflow =
        !hasLikelyBuffFrame(image, box) ||
        box.score < rowScore * 0.92 ||
        cropQuality(image, box).dark < 0.45 ||
        cropQuality(image, box).bright > 0.24;
      if (weakOverflow) remove.add(box);
    }
  }
}

export function pruneOverfullMultiRowRows(rows: Array<{ row: BuffIconBox[]; y: number; size: number }>, image: ImageLike, remove: Set<BuffIconBox>) {
  const rightEdges = rows
    .filter((row) => row.row.length >= 2 && row.row.length <= 13)
    .map((row) => Math.max(...row.row.map((box) => box.x + box.size)));
  if (rightEdges.length === 0) return;

  for (const row of rows) {
    if (row.row.length <= 13) continue;
    const sorted = [...row.row].sort((a, b) => a.x - b.x);
    const rowRightEdge = Math.max(...sorted.map((box) => box.x + box.size));
    const alignedRows = rightEdges.filter((rightEdge) => Math.abs(rightEdge - rowRightEdge) <= Math.max(8, row.size * 0.72)).length;
    if (alignedRows === 0) continue;

    const prefix = sorted.slice(0, sorted.length - 13);
    const suffix = sorted.slice(sorted.length - 13);
    const suffixScore = median(suffix.map((box) => box.score));
    const suffixFrameCount = suffix.slice(0, Math.min(8, suffix.length)).filter((box) => hasLikelyBuffFrame(image, box)).length;
    if (suffixFrameCount < 4) continue;
    if (!prefix.every((box) => isWeakOverfullPrefix(image, box, suffixScore))) continue;

    for (const box of prefix) remove.add(box);
  }
}

export function isWeakOverfullPrefix(image: ImageLike, box: BuffIconBox, suffixScore: number) {
  const weakScore = box.score <= Math.min(215, suffixScore * 0.82);
  if (!weakScore) return false;
  if (hasLikelyBuffFrame(image, box)) return false;
  return isDamageTextPrefixFragment(image, box) || isTextOverlayFragment(image, box) || isFlatDarkEffectFragment(image, box);
}

export function pruneOverlappingSingletonFragments(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  image: ImageLike,
  remove: Set<BuffIconBox>,
) {
  for (const row of rows) {
    if (row.row.length !== 2) continue;
    const [aBox, bBox] = [...row.row].sort((a, b) => a.x - b.x);
    if (!aBox || !bBox || remove.has(aBox) || remove.has(bBox)) continue;
    const size = Math.round(median([row.size, aBox.size, bBox.size]));
    const horizontalOverlap = boxHorizontalOverlap(aBox, bBox);
    if (horizontalOverlap < 0.35 && iou(aBox, bBox) < 0.16) continue;

    const aStrength = singletonStructuralStrength(aBox, image);
    const bStrength = singletonStructuralStrength(bBox, image);
    remove.add(aStrength <= bStrength ? aBox : bBox);
  }

  const singletons = rows.filter((row) => row.row.length === 1);
  for (let aIndex = 0; aIndex < singletons.length; aIndex++) {
    const a = singletons[aIndex]!;
    const aBox = a.row[0]!;
    if (remove.has(aBox)) continue;

    for (let bIndex = aIndex + 1; bIndex < singletons.length; bIndex++) {
      const b = singletons[bIndex]!;
      const bBox = b.row[0]!;
      if (remove.has(bBox)) continue;

      const size = Math.round(median([a.size, b.size, aBox.size, bBox.size]));
      if (Math.abs(a.y - b.y) > Math.max(3, size * 0.24)) continue;
      const horizontalOverlap = boxHorizontalOverlap(aBox, bBox);
      if (horizontalOverlap < 0.35 && iou(aBox, bBox) < 0.16) continue;

      const aStrength = singletonStructuralStrength(aBox, image);
      const bStrength = singletonStructuralStrength(bBox, image);
      remove.add(aStrength <= bStrength ? aBox : bBox);
    }
  }
}

export function pruneOverlappingRowFragments(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  image: ImageLike,
  remove: Set<BuffIconBox>,
) {
  for (const row of rows) {
    if (row.row.length < 3) continue;
    const sorted = [...row.row].sort((a, b) => a.x - b.x);

    for (let index = 0; index < sorted.length - 1; index++) {
      const left = sorted[index]!;
      const right = sorted[index + 1]!;
      if (remove.has(left) || remove.has(right)) continue;
      if (boxHorizontalOverlap(left, right) < 0.24 && iou(left, right) < 0.12) continue;

      const leftStrength = singletonStructuralStrength(left, image);
      const rightStrength = singletonStructuralStrength(right, image);
      if (leftStrength === rightStrength) continue;
      remove.add(leftStrength < rightStrength ? left : right);
    }
  }
}

export function singletonStructuralStrength(box: BuffIconBox, image: ImageLike) {
  return box.score + (hasLikelyBuffFrame(image, box) ? 80 : 0) - (isDamageNumberLikeCrop(image, box) ? 28 : 0);
}

export function boxHorizontalOverlap(a: BuffIconBox, b: BuffIconBox) {
  const overlap = Math.max(0, Math.min(a.x + a.size, b.x + b.size) - Math.max(a.x, b.x));
  return overlap / Math.max(1, Math.min(a.size, b.size));
}

export function hasChainedRightRailRow(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  current: { row: BuffIconBox[]; y: number; size: number },
  lastStrongY: number,
  strongestRightEdge: number,
  size: number,
) {
  const currentRight = Math.max(...current.row.map((box) => box.x + box.size));
  if (Math.abs(currentRight - strongestRightEdge) > size * 0.55) return false;

  return rows.some((row) => {
    if (row === current || row.row.length > 3) return false;
    if (row.y <= lastStrongY + size * 0.45 || row.y >= current.y) return false;
    if (current.y - row.y > size * 1.48) return false;
    const rowRight = Math.max(...row.row.map((box) => box.x + box.size));
    return Math.abs(rowRight - currentRight) <= size * 0.55;
  });
}

export function pruneVerticallyOverlappingRows(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  image: ImageLike,
  remove: Set<BuffIconBox>,
) {
  for (let aIndex = 0; aIndex < rows.length; aIndex++) {
    const a = rows[aIndex]!;
    if (a.row.every((box) => remove.has(box))) continue;

    for (let bIndex = aIndex + 1; bIndex < rows.length; bIndex++) {
      const b = rows[bIndex]!;
      if (b.row.every((box) => remove.has(box))) continue;

      const size = Math.round(median([...a.row, ...b.row].map((box) => box.size)));
      const dy = Math.abs(b.y - a.y);
      if (dy <= Math.max(4, size * 0.16) || dy >= size * 0.84) continue;
      if (rowHorizontalOverlap(a.row, b.row) < 0.18) continue;

      const aStrength = rowStructuralStrength(a.row, image);
      const bStrength = rowStructuralStrength(b.row, image);
      const weaker = aStrength <= bStrength ? a : b;
      const stronger = weaker === a ? b : a;
      const weakerFrames = weaker.row.filter((box) => hasLikelyBuffFrame(image, box)).length;
      const strongerFrames = stronger.row.filter((box) => hasLikelyBuffFrame(image, box)).length;
      const clearlyWeaker =
        aStrength !== bStrength &&
        (weaker.row.length + 2 <= stronger.row.length ||
          weakerFrames + 2 <= strongerFrames ||
          rowStructuralStrength(weaker.row, image) < rowStructuralStrength(stronger.row, image) * 0.92);

      if (!clearlyWeaker) continue;
      for (const box of weaker.row) remove.add(box);
    }
  }
}

export function rowHorizontalOverlap(a: BuffIconBox[], b: BuffIconBox[]) {
  const aLeft = Math.min(...a.map((box) => box.x));
  const aRight = Math.max(...a.map((box) => box.x + box.size));
  const bLeft = Math.min(...b.map((box) => box.x));
  const bRight = Math.max(...b.map((box) => box.x + box.size));
  const overlap = Math.max(0, Math.min(aRight, bRight) - Math.max(aLeft, bLeft));
  const minWidth = Math.min(aRight - aLeft, bRight - bLeft);
  return overlap / Math.max(1, minWidth);
}

export function rowStructuralStrength(row: BuffIconBox[], image: ImageLike) {
  const score = median(row.map((box) => box.score));
  const frameCount = row.filter((box) => hasLikelyBuffFrame(image, box)).length;
  return score + Math.min(row.length, 10) * 9 + frameCount * 24;
}

export function pruneFrameLessDetachedRows(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  image: ImageLike,
  remove: Set<BuffIconBox>,
) {
  const framedRows = rows
    .map((row) => ({
      ...row,
      frameCount: row.row.filter((box) => hasLikelyBuffFrame(image, box)).length,
    }))
    .filter((row) => row.row.length >= 3 && row.frameCount >= Math.max(2, Math.ceil(row.row.length * 0.34)))
    .sort((a, b) => a.y - b.y);
  if (framedRows.length === 0) return;

  const firstFramedY = framedRows[0]!.y;
  const lastFramedY = framedRows[framedRows.length - 1]!.y;

  for (const row of rows) {
    if (row.row.length < 3 || row.row.length > 6) continue;
    const frameCount = row.row.filter((box) => hasLikelyBuffFrame(image, box)).length;
    if (frameCount > 0) continue;

    const allFragments = row.row.every((box) => !hasLikelyBuffFrame(image, box) || isDamageNumberLikeCrop(image, box));
    if (!allFragments) continue;

    const nearSameRow = framedRows.some((framed) => Math.abs(row.y - framed.y) <= row.size * 0.72);
    if (nearSameRow) continue;

    const framedRowsAbove = framedRows.filter((framed) => framed.y < row.y);
    const framedAbove = framedRowsAbove[framedRowsAbove.length - 1];
    const framedBelow = framedRows.find((framed) => framed.y > row.y);
    const betweenFramedRows =
      framedAbove &&
      framedBelow &&
      row.y - framedAbove.y <= row.size * 1.55 &&
      framedBelow.y - row.y <= row.size * 1.55;
    const detachedBelowKnownRows = row.y > lastFramedY + row.size * 0.6;
    const detachedBelowOnlyTop = framedRows.length === 1 && row.y > firstFramedY + row.size * 1.8;
    const rowScore = median(row.row.map((box) => box.score));
    const surroundingScore =
      framedAbove && framedBelow ? median([...framedAbove.row, ...framedBelow.row].map((box) => box.score)) : 0;
    const referenceScore = median(framedRows.flatMap((framed) => framed.row.map((box) => box.score)));
    const rowRightEdge = Math.max(...row.row.map((box) => box.x + box.size));
    const rightAlignedFramedRows = framedRows.filter((framed) => {
      const framedRightEdge = Math.max(...framed.row.map((box) => box.x + box.size));
      return Math.abs(framedRightEdge - rowRightEdge) <= row.size * 0.55;
    }).length;
    const plausibleWeakRailRow =
      row.row.length >= 3 &&
      row.row.length <= 5 &&
      row.size < 52 &&
      rightAlignedFramedRows >= 2 &&
      row.y <= lastFramedY + row.size * 2.2 &&
      referenceScore > 0 &&
      rowScore >= referenceScore * 0.84;
    if (plausibleWeakRailRow) continue;

    const weakBetweenFramedRows = Boolean(betweenFramedRows && surroundingScore > 0 && rowScore < surroundingScore * 0.84);
    const weakSmallDetachedRow = row.row.length <= 4 && (detachedBelowKnownRows || detachedBelowOnlyTop);
    const weakLargeDetachedRow =
      row.row.length >= 5 &&
      row.row.length <= 6 &&
      (detachedBelowKnownRows || detachedBelowOnlyTop) &&
      row.y > lastFramedY + row.size * 1.7 &&
      referenceScore > 0 &&
      rowScore < Math.min(245, referenceScore * 0.88);

    if (!weakBetweenFramedRows && !weakSmallDetachedRow && !weakLargeDetachedRow) continue;
    for (const box of row.row) remove.add(box);
  }
}

export function pruneDetachedFragmentsBelowSingleTopRow(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  primary: { row: BuffIconBox[]; y: number; size: number },
  image: ImageLike,
  viewportTop: number,
  remove: Set<BuffIconBox>,
) {
  if (primary.row.length < 6 || primary.y - viewportTop > Math.max(10, primary.size * 0.5)) return;
  const primaryRightEdge = Math.max(...primary.row.map((box) => box.x + box.size));

  for (const row of rows) {
    if (row === primary || row.row.length > 3) continue;
    if (row.y <= primary.y + primary.size * 1.8) continue;

    const rowRightEdge = Math.max(...row.row.map((box) => box.x + box.size));
    const plausibleRightRail = Math.abs(rowRightEdge - primaryRightEdge) <= primary.size * 0.55 && row.row.every((box) => hasLikelyBuffFrame(image, box));
    if (plausibleRightRail) continue;

    const allFragments = row.row.every((box) => !hasLikelyBuffFrame(image, box) || isDamageNumberLikeCrop(image, box));
    if (!allFragments) continue;
    for (const box of row.row) remove.add(box);
  }
}

export function pruneImpossibleLeftRowEdges(rows: BuffIconBox[][], image: ImageLike, remove: Set<BuffIconBox>) {
  for (const row of rows) {
    if (row.length < 5) continue;
    const sorted = [...row].sort((a, b) => a.x - b.x);
    const first = sorted[0]!;
    if (hasLikelyBuffFrame(image, first)) continue;

    const size = Math.round(median(sorted.map((box) => box.size)));
    const firstGap = sorted[1]!.x - first.x;
    const impossibleGap = firstGap >= size * 1.55 && sorted.length >= 5;
    const topDamageFragment = first.y <= size * 0.35 && sorted.length >= 6 && isDamageNumberLikeCrop(image, first);

    if (impossibleGap || topDamageFragment) remove.add(first);
  }
}
