import type { BuffIconBox, ImageLike } from "../types.js";
import { median } from "./math.js";
import { cropQuality, hasLikelyBuffFrame, hasNearbyLikelyBuffFrame, isBlankDarkWindowFragment, isDamageNumberLikeCrop, isDamageTextPrefixFragment, isFlatDarkEffectFragment, isSevereTextOverlayPrefix, isTextOverlayFragment, isWeakTextOverlayCompanion } from "./cropQuality.js";

export function pruneWeakTextOverlayPrefixes(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  image: ImageLike,
  viewportTop: number,
  remove: Set<BuffIconBox>,
) {
  for (const row of rows) {
    if (row.row.length < 3) continue;
    const sorted = [...row.row].sort((a, b) => a.x - b.x);
    const size = Math.round(median(sorted.map((box) => box.size)));
    const topRow = row.y - viewportTop <= Math.max(10, size * 0.45);

    if (topRow && size <= 40 && sorted.length >= 7 && sorted.length <= 10) {
      const first = sorted[0]!;
      const firstQuality = cropQuality(image, first);
      const suffix = sorted.slice(1);
      const lowDetailTopPrefix =
        hasStableSuffixPitch(suffix, size) &&
        (hasSupportedLowerRail(rows, row, sorted, suffix, size, image) || hasRightAlignedLowerRow(rows, row, sorted, suffix, size)) &&
        !hasLikelyBuffFrame(image, first) &&
        !hasNearbyLikelyBuffFrame(image, first) &&
        isSevereTextOverlayPrefix(image, first) &&
        firstQuality.edge <= 24 &&
        firstQuality.dark <= 0.58 &&
        firstQuality.bright >= 0.28;
      if (lowDetailTopPrefix) {
        remove.add(first);
        continue;
      }

      for (const prefixLength of [2, 1]) {
        if (sorted.length - prefixLength < 5) continue;

        const prefix = sorted.slice(0, prefixLength);
        const suffix = sorted.slice(prefixLength);
        if (!hasStableSuffixPitch(suffix, size)) continue;

        const suffixFrameCount = suffix.slice(0, Math.min(6, suffix.length)).filter((box) => hasLikelyBuffFrame(image, box)).length;
        if (suffixFrameCount < 4) continue;

        const obviousTextEffectPrefix = prefix.every((box) => {
          const quality = cropQuality(image, box);
          return (
            !hasNearbyLikelyBuffFrame(image, box) &&
            !hasLikelyBuffFrame(image, box) &&
            (isTextOverlayFragment(image, box) || isSevereTextOverlayPrefix(image, box) || isDamageTextPrefixFragment(image, box)) &&
            quality.dark < 0.55
          );
        });
        if (obviousTextEffectPrefix) {
          for (const box of prefix) remove.add(box);
          break;
        }

        if (prefixLength !== 1) continue;
        const first = prefix[0]!;
        const firstQuality = cropQuality(image, first);
        const suffixDark = median(suffix.slice(0, Math.min(6, suffix.length)).map((box) => cropQuality(image, box).dark));
        const frameLikeEffectPrefix =
          suffixDark >= 0.86 &&
          firstQuality.dark <= suffixDark - 0.12 &&
          firstQuality.centerDark >= 0.55 &&
          firstQuality.centerBright <= 0.3 &&
          firstQuality.edge <= 75;
        if (frameLikeEffectPrefix) {
          remove.add(first);
          break;
        }
      }
    }

    if (sorted.length >= 6) {
      const first = sorted[0]!;
      const suffix = sorted.slice(1);
      const suffixGaps = suffix.slice(0, -1).map((box, index) => suffix[index + 1]!.x - box.x);
      const suffixPitch = suffixGaps.length > 0 ? median(suffixGaps) : size;
      const prefixGap = suffix[0]!.x - first.x;
      const alignedPrefix = Math.abs(prefixGap - suffixPitch) <= Math.max(5, size * 0.34);
      const stableSuffixPitch =
        suffixGaps.length >= 4 && suffixGaps.every((gap) => Math.abs(gap - suffixPitch) <= Math.max(4, size * 0.18));
      const suffixScore = median(suffix.map((box) => box.score));
      const suffixFrameCount = suffix.slice(0, Math.min(6, suffix.length)).filter((box) => hasLikelyBuffFrame(image, box)).length;
      const firstTextFragment = isTextOverlayFragment(image, first);
      const firstQuality = cropQuality(image, first);
      const topDetachedPitchPrefix =
        topRow &&
        stableSuffixPitch &&
        prefixGap > suffixPitch + Math.max(6, size * 0.18) &&
        firstTextFragment &&
        !hasNearbyLikelyBuffFrame(image, first);
      const topAlignedFramelessPrefix =
        topRow &&
        alignedPrefix &&
        size <= 40 &&
        !hasLikelyBuffFrame(image, first) &&
        (firstTextFragment || (firstQuality.dark < 0.66 && firstQuality.bright <= 0.22 && firstQuality.sat > 70)) &&
        !hasNearbyLikelyBuffFrame(image, first) &&
        suffixFrameCount >= 4 &&
        firstQuality.dark < 0.62 &&
        firstQuality.bright <= 0.24 &&
        firstQuality.centerDark <= 0.62;
      if (
        topDetachedPitchPrefix ||
        topAlignedFramelessPrefix ||
        (topRow &&
          (!alignedPrefix || isSevereTextOverlayPrefix(image, first)) &&
          firstTextFragment &&
          !hasNearbyLikelyBuffFrame(image, first) &&
          suffixFrameCount >= 4 &&
          first.score < suffixScore * 0.94)
      ) {
        remove.add(first);
        continue;
      }
    }

    if (!topRow && sorted.length >= 8) {
      const prefix = sorted.slice(0, 2);
      const suffix = sorted.slice(2);
      const suffixGaps = suffix.slice(0, -1).map((box, index) => suffix[index + 1]!.x - box.x);
      const suffixPitch = suffixGaps.length > 0 ? median(suffixGaps) : size;
      const firstPrefixGap = prefix[1]!.x - prefix[0]!.x;
      const bridgeGap = suffix[0]!.x - prefix[1]!.x;
      const alignedPrefix =
        Math.abs(firstPrefixGap - suffixPitch) <= Math.max(5, size * 0.34) &&
        Math.abs(bridgeGap - suffixPitch) <= Math.max(5, size * 0.34);
      const prefixScore = median(prefix.map((box) => box.score));
      const suffixScore = median(suffix.map((box) => box.score));
      const suffixFrameCount = suffix.slice(0, Math.min(8, suffix.length)).filter((box) => hasLikelyBuffFrame(image, box)).length;
      const textLikePrefix = prefix.some((box) => isTextOverlayFragment(image, box));
      const severePrefix = prefix.some((box) => isSevereTextOverlayPrefix(image, box));
      if (!alignedPrefix && textLikePrefix && suffix.length >= 6 && suffixFrameCount >= 4 && prefixScore < suffixScore * 0.94) {
        for (const box of prefix) remove.add(box);
        continue;
      }
      if (alignedPrefix && severePrefix && suffix.length >= 6 && suffixFrameCount >= 4 && prefixScore < suffixScore * 0.94) {
        for (const box of prefix) {
          if (isSevereTextOverlayPrefix(image, box) || isWeakTextOverlayCompanion(image, box)) remove.add(box);
        }
        continue;
      }
    }

    if (!topRow && sorted.length === 3) {
      const first = sorted[0]!;
      const suffix = sorted.slice(1);
      const suffixScore = median(suffix.map((box) => box.score));
      const firstGap = suffix[0]!.x - first.x;
      const suffixGap = suffix[1]!.x - suffix[0]!.x;
      const firstQuality = cropQuality(image, first);
      const detachedVisualPrefix =
        firstGap > suffixGap * 1.55 &&
        !hasNearbyLikelyBuffFrame(image, first) &&
        suffix.every((box) => hasNearbyLikelyBuffFrame(image, box)) &&
        isTextOverlayFragment(image, first) &&
        (first.score < suffixScore * 0.82 || (firstQuality.edge < 18 && firstQuality.centerDark > 0.92));
      if (
        isTextOverlayFragment(image, first) &&
        suffixScore >= 270 &&
        (first.score < suffixScore * 0.72 || detachedVisualPrefix)
      ) {
        remove.add(first);
      }
    }
  }
}

export function pruneDetachedVisualRows(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  image: ImageLike,
  remove: Set<BuffIconBox>,
) {
  const orderedRows = [...rows].sort((a, b) => a.y - b.y);
  const framedRows = rows
    .map((row) => ({
      ...row,
      frameCount: row.row.filter((box) => hasLikelyBuffFrame(image, box)).length,
    }))
    .filter((row) => row.row.length >= 3 && row.frameCount >= Math.max(2, Math.ceil(row.row.length * 0.36)));
  if (framedRows.length === 0) return;

  const lastFramedY = Math.max(...framedRows.map((row) => row.y));
  for (const [rowIndex, row] of orderedRows.entries()) {
    if (row.row.length < 3) continue;
    const previousRow = rowIndex > 0 ? orderedRows[rowIndex - 1] : undefined;
    if (previousRow && row.y - previousRow.y <= row.size * 1.45) continue;
    if (row.y <= lastFramedY + row.size * 1.65) continue;
    if (row.row.some((box) => hasNearbyLikelyBuffFrame(image, box))) continue;

    const visualFragments = row.row.filter((box) => isTextOverlayFragment(image, box) || isDamageTextPrefixFragment(image, box) || isDamageNumberLikeCrop(image, box));
    if (visualFragments.length < Math.ceil(row.row.length * 0.75)) continue;
    for (const box of row.row) remove.add(box);
  }
}

export function pruneDamageTextRowPrefixes(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  image: ImageLike,
  viewportTop: number,
  remove: Set<BuffIconBox>,
) {
  for (const row of rows) {
    if (row.row.length < 8) continue;
    if (row.y - viewportTop <= row.size * 1.15) continue;
    const sorted = [...row.row].sort((a, b) => a.x - b.x);
    const size = Math.round(median(sorted.map((box) => box.size)));
    const maxPrefix = Math.min(6, sorted.length - 4);

    for (let prefixLength = maxPrefix; prefixLength >= 2; prefixLength--) {
      const prefix = sorted.slice(0, prefixLength);
      const suffix = sorted.slice(prefixLength);
      const lastPrefix = prefix[prefix.length - 1]!;
      const firstSuffix = suffix[0]!;
      if (firstSuffix.x - lastPrefix.x > size * 1.35) continue;
      if (prefix.some((box) => hasNearbyLikelyBuffFrame(image, box))) continue;

      const prefixVisual = prefix.filter((box) => {
        const quality = cropQuality(image, box);
        return (
          isDamageTextPrefixFragment(image, box) ||
          isDamageNumberLikeCrop(image, box) ||
          (quality.dark < 0.36 && quality.bright > 0.28 && quality.edge < 54)
        );
      }).length;
      if (prefixVisual < Math.ceil(prefix.length * 0.8)) continue;

      const suffixFrameCount = suffix.filter((box) => hasLikelyBuffFrame(image, box)).length;
      const suffixNearbyFrameCount = suffix.filter((box) => hasNearbyLikelyBuffFrame(image, box)).length;
      if (suffixFrameCount < 2 && suffixNearbyFrameCount < Math.max(4, Math.ceil(suffix.length * 0.58))) continue;

      const prefixScore = median(prefix.map((box) => box.score));
      const suffixScore = median(suffix.map((box) => box.score));
      if (prefixScore > Math.min(245, suffixScore * 0.96)) continue;

      for (const box of prefix) remove.add(box);
      break;
    }
  }
}

export function pruneWeakLeftEdgeFragments(rows: BuffIconBox[][], image: ImageLike, viewportTop: number, remove: Set<BuffIconBox>) {
  for (const row of rows) {
    if (row.length < 5) continue;
    const sorted = [...row].sort((a, b) => a.x - b.x);
    const first = sorted[0]!;
    const size = Math.round(median(sorted.map((box) => box.size)));
    const topRow = first.y - viewportTop <= Math.max(10, size * 0.45);
    if (topRow && size < 52) continue;
    if (!topRow && first.y - viewportTop <= Math.max(10, size * 0.45)) continue;
    if (hasLikelyBuffFrame(image, first)) continue;

    const rightSide = sorted.slice(1);
    const framedRightCount = rightSide.slice(0, 4).filter((box) => hasLikelyBuffFrame(image, box)).length;
    if (framedRightCount < 3) continue;

    const rightScore = median(rightSide.map((box) => box.score));
    const weakAgainstRow = first.score < rightScore * 0.74;
    const absoluteWeakLeadingFragment =
      !topRow && row.length >= 8 && size < 40 && first.score <= Math.min(225, rightScore * 0.82);
    const weakLargeTopFramelessPrefix =
      topRow && size >= 52 && row.length >= 8 && first.score <= Math.min(205, rightScore * 0.98);
    if (weakLargeTopFramelessPrefix) {
      remove.add(first);
      continue;
    }
    if (topRow && (!weakAgainstRow || first.score > 205)) continue;
    if (!weakAgainstRow && !absoluteWeakLeadingFragment && !isDamageNumberLikeCrop(image, first)) continue;
    remove.add(first);
  }
}

export function pruneWeakLeadingRowFragments(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  image: ImageLike,
  viewportTop: number,
  remove: Set<BuffIconBox>,
) {
  for (const row of rows) {
    if (row.row.length < 4 || row.row.length > 14) continue;
    const sorted = [...row.row].sort((a, b) => a.x - b.x);
    const size = Math.round(median(sorted.map((box) => box.size)));
    const maxPrefix = Math.min(4, sorted.length - 2);

    for (let prefixLength = maxPrefix; prefixLength >= 1; prefixLength--) {
      const prefix = sorted.slice(0, prefixLength);
      const suffix = sorted.slice(prefixLength);
      const lastPrefix = prefix[prefix.length - 1]!;
      const firstSuffix = suffix[0]!;
      if (firstSuffix.x - lastPrefix.x > size * 1.35) continue;
      if (prefix.some((box) => hasLikelyBuffFrame(image, box))) continue;

      const suffixFrameCount = suffix.filter((box) => hasLikelyBuffFrame(image, box)).length;
      const prefixDamageCount = prefix.filter((box) => isDamageNumberLikeCrop(image, box)).length;
      const prefixScore = median(prefix.map((box) => box.score));
      const suffixScore = median(suffix.map((box) => box.score));
      const weakPrefix = prefixScore < suffixScore * 0.88;
      const damagePrefix = prefixDamageCount >= Math.ceil(prefix.length * 0.67);
      const framedSuffix = suffixFrameCount >= Math.max(2, Math.ceil(suffix.length * 0.45));
      const compactWeakPrefix = sorted.length <= 5 && prefix.length <= 2 && weakPrefix && suffixScore >= 225;
      const localRowY = row.y - viewportTop;
      const topClippedDamagePrefix =
        size <= 36 && localRowY <= Math.max(4, size * 0.18) && damagePrefix && hasSupportedLowerRail(rows, row, sorted, suffix, size, image);
      const topClippedFramelessPrefix =
        size <= 36 &&
        prefix.length >= 3 &&
        prefix.length <= 4 &&
        localRowY <= Math.max(4, size * 0.18) &&
        prefix.every((box) => !hasLikelyBuffFrame(image, box)) &&
        suffixFrameCount >= 2 &&
        hasSupportedLowerRail(rows, row, sorted, suffix, size, image) &&
        hasSupportedLowerRailStartingAtSuffix(rows, row, suffix, size, image);
      const topClippedWeakFramelessPrefix =
        size <= 36 &&
        viewportTop > 0 &&
        prefix.length <= 2 &&
        localRowY <= Math.max(4, size * 0.18) &&
        prefix.every((box) => !hasLikelyBuffFrame(image, box)) &&
        suffix.length >= 4 &&
        prefixScore <= Math.min(230, suffixScore * 0.96) &&
        hasSupportedLowerRail(rows, row, sorted, suffix, size, image);
      if (row.row.length > 9 && !topClippedFramelessPrefix && !topClippedWeakFramelessPrefix) continue;
      if (prefix.length === 1 && !topClippedDamagePrefix && !topClippedFramelessPrefix && !topClippedWeakFramelessPrefix) continue;

      if (
        !damagePrefix &&
        !compactWeakPrefix &&
        !topClippedDamagePrefix &&
        !topClippedFramelessPrefix &&
        !topClippedWeakFramelessPrefix &&
        !(weakPrefix && framedSuffix)
      ) {
        continue;
      }
      if (
        !framedSuffix &&
        !compactWeakPrefix &&
        !topClippedDamagePrefix &&
        !topClippedFramelessPrefix &&
        !topClippedWeakFramelessPrefix
      ) {
        continue;
      }
      for (const box of prefix) remove.add(box);
      break;
    }
  }
}

export function pruneBlankDarkWindowPrefixes(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  image: ImageLike,
  viewportTop: number,
  remove: Set<BuffIconBox>,
) {
  for (const row of rows) {
    if (row.row.length < 8) continue;
    const sorted = [...row.row].sort((a, b) => a.x - b.x);
    const first = sorted[0]!;
    if (remove.has(first)) continue;

    const size = Math.round(median(sorted.map((box) => box.size)));
    const topRow = row.y - viewportTop <= Math.max(10, size * 0.45);
    if (topRow) continue;

    const suffix = sorted.slice(1);
    const suffixFrameCount = suffix.slice(0, Math.min(8, suffix.length)).filter((box) => hasLikelyBuffFrame(image, box)).length;
    if (suffixFrameCount < 5) continue;

    const suffixScore = median(suffix.map((box) => box.score));
    const weakAgainstSuffix = first.score <= Math.min(230, suffixScore * 0.78);
    if (!weakAgainstSuffix) continue;

    if (isBlankDarkWindowFragment(image, first)) remove.add(first);
  }
}

export function pruneShortRightRailEffectPrefixes(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  image: ImageLike,
  remove: Set<BuffIconBox>,
) {
  const strongRightEdges = rows.filter((row) => row.row.length >= 6).flatMap((row) => row.row.map((box) => box.x + box.size));
  if (strongRightEdges.length === 0) return;
  const strongestRightEdge = Math.max(...strongRightEdges);

  for (const row of rows) {
    if (row.row.length < 2 || row.row.length > 3) continue;
    const sorted = [...row.row].sort((a, b) => a.x - b.x);
    const first = sorted[0];
    const second = sorted[1];
    if (!first || !second || remove.has(first)) continue;

    const size = Math.round(median(sorted.map((box) => box.size)));
    const last = sorted[sorted.length - 1]!;
    const rightAligned = Math.abs(last.x + last.size - strongestRightEdge) <= Math.max(8, size * 0.58);
    const adjacent = second.x - first.x >= size * 0.72 && second.x - first.x <= size * 1.38;
    const weakPrefix = first.score <= Math.min(210, second.score * 0.72);
    const firstQuality = cropQuality(image, first);
    const supportedSuffix = sorted.slice(1).some((box) => hasLikelyBuffFrame(image, box) || hasNearbyLikelyBuffFrame(image, box));
    const darkLowDetailPrefix =
      rightAligned &&
      adjacent &&
      supportedSuffix &&
      first.score <= Math.min(210, second.score * 0.78) &&
      firstQuality.centerDark >= 0.78 &&
      firstQuality.centerBright <= 0.06 &&
      firstQuality.edge <= 24;
    const damageLowDetailPrefix =
      rightAligned &&
      adjacent &&
      supportedSuffix &&
      isDamageNumberLikeCrop(image, first) &&
      first.score <= Math.min(210, second.score * 0.72) &&
      firstQuality.centerBright <= 0.08 &&
      firstQuality.edge <= 18;
    const compactTextEffectPrefix =
      size <= 32 &&
      rightAligned &&
      adjacent &&
      !hasLikelyBuffFrame(image, first) &&
      isTextOverlayFragment(image, first) &&
      firstQuality.dark <= 0.65 &&
      firstQuality.bright >= 0.12 &&
      sorted.slice(1).some((box) => hasLikelyBuffFrame(image, box) || hasNearbyLikelyBuffFrame(image, box));
    const textEffectPrefix =
      row.row.length === 2 &&
      rightAligned &&
      adjacent &&
      hasLikelyBuffFrame(image, second) &&
      !hasLikelyBuffFrame(image, first) &&
      isTextOverlayFragment(image, first) &&
      first.score <= Math.min(245, second.score * 0.9) &&
      firstQuality.dark <= 0.74 &&
      firstQuality.bright >= 0.16;
    const nearbyRailTextPrefix =
      rightAligned &&
      adjacent &&
      size <= 40 &&
      hasNearbyLikelyBuffFrame(image, second) &&
      !hasNearbyLikelyBuffFrame(image, first) &&
      !hasLikelyBuffFrame(image, first) &&
      isTextOverlayFragment(image, first) &&
      first.score <= second.score * 0.86 &&
      firstQuality.dark <= 0.74 &&
      firstQuality.bright >= 0.16;
    if (rightAligned && adjacent && weakPrefix && isFlatDarkEffectFragment(image, first) && !isFlatDarkEffectFragment(image, second)) {
      remove.add(first);
      continue;
    }
    if (darkLowDetailPrefix || damageLowDetailPrefix) {
      remove.add(first);
      continue;
    }
    if (compactTextEffectPrefix || textEffectPrefix || nearbyRailTextPrefix) {
      remove.add(first);
    }
  }
}

export function pruneCollapsedTopRowFragments(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  image: ImageLike,
  viewportTop: number,
  remove: Set<BuffIconBox>,
) {
  for (const row of rows) {
    if (row.row.length < 2 || row.row.length > 3) continue;
    const sorted = [...row.row].sort((a, b) => a.x - b.x);
    const size = Math.round(median(sorted.map((box) => box.size)));
    if (size > 40) continue;
    if (row.y - viewportTop > Math.max(10, size * 0.45)) continue;
    if (hasPlausiblePitch(sorted, size)) continue;
    if (sorted.some((box) => hasLikelyBuffFrame(image, box))) continue;
    if (!hasSupportedLowerTopRecoveryRow(rows, row, size, image)) continue;

    for (const box of sorted) remove.add(box);
  }
}

export function pruneTopDamageTextPrefixes(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  image: ImageLike,
  viewportTop: number,
  remove: Set<BuffIconBox>,
) {
  for (const row of rows) {
    if (row.row.length < 10) continue;
    const sorted = [...row.row].sort((a, b) => a.x - b.x);
    const size = Math.round(median(sorted.map((box) => box.size)));
    if (size < 52) continue;
    const topRow = row.y - viewportTop <= Math.max(14, size * 0.42);
    if (!topRow) continue;

    const maxPrefix = Math.min(5, sorted.length - 5);
    for (let prefixLength = maxPrefix; prefixLength >= 2; prefixLength--) {
      const prefix = sorted.slice(0, prefixLength);
      const suffix = sorted.slice(prefixLength);
      const firstSuffix = suffix[0];
      const lastPrefix = prefix[prefix.length - 1];
      if (!firstSuffix || !lastPrefix) continue;
      if (firstSuffix.x - lastPrefix.x > size * 1.35) continue;
      if (prefix.some((box) => hasLikelyBuffFrame(image, box))) continue;

      const suffixFrameCount = suffix.slice(0, Math.min(10, suffix.length)).filter((box) => hasLikelyBuffFrame(image, box)).length;
      if (suffixFrameCount < 3) continue;

      const prefixScore = median(prefix.map((box) => box.score));
      const suffixScore = median(suffix.map((box) => box.score));
      if (prefixScore > Math.min(205, suffixScore * 0.82)) continue;
      if (!prefix.every((box) => isDamageTextPrefixFragment(image, box))) continue;

      for (const box of prefix) remove.add(box);
      break;
    }
  }
}

export function hasSupportedLowerRailStartingAtSuffix(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  current: { row: BuffIconBox[]; y: number; size: number },
  suffix: BuffIconBox[],
  size: number,
  image: ImageLike,
) {
  const suffixLeft = suffix[0]?.x;
  if (suffixLeft === undefined) return false;

  return rows.some((row) => {
    if (row === current || row.y <= current.y + size * 0.72 || row.y > current.y + size * 1.55) return false;
    const sorted = [...row.row].sort((a, b) => a.x - b.x);
    if (sorted.length < Math.max(4, suffix.length - 1)) return false;
    const rowSize = Math.round(median(sorted.map((box) => box.size)));
    if (Math.abs(rowSize - size) > Math.max(3, size * 0.12)) return false;
    const frameCount = sorted.filter((box) => hasLikelyBuffFrame(image, box)).length;
    return frameCount >= Math.max(3, Math.ceil(sorted.length * 0.55)) && Math.abs(sorted[0]!.x - suffixLeft) <= size * 0.6;
  });
}

export function hasSupportedLowerRail(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  current: { row: BuffIconBox[]; y: number; size: number },
  currentSorted: BuffIconBox[],
  suffix: BuffIconBox[],
  size: number,
  image: ImageLike,
) {
  const currentRight = currentSorted[currentSorted.length - 1]!.x + size;
  return rows.some((row) => {
    if (row === current || row.y <= current.y + size * 0.72 || row.y > current.y + size * 1.55) return false;
    const sorted = [...row.row].sort((a, b) => a.x - b.x);
    if (sorted.length < Math.max(4, suffix.length - 1)) return false;
    const rowSize = Math.round(median(sorted.map((box) => box.size)));
    if (Math.abs(rowSize - size) > Math.max(3, size * 0.12)) return false;
    const frameCount = sorted.filter((box) => hasLikelyBuffFrame(image, box)).length;
    const rowRight = sorted[sorted.length - 1]!.x + rowSize;
    return frameCount >= Math.max(3, Math.ceil(sorted.length * 0.55)) && Math.abs(rowRight - currentRight) <= size * 0.6;
  });
}

function hasStableSuffixPitch(suffix: BuffIconBox[], size: number) {
  const gaps = suffix.slice(0, -1).map((box, index) => suffix[index + 1]!.x - box.x);
  if (gaps.length < 4) return false;
  const pitch = median(gaps);
  return gaps.every((gap) => Math.abs(gap - pitch) <= Math.max(4, size * 0.2));
}

function hasPlausiblePitch(sorted: BuffIconBox[], size: number) {
  const gaps = sorted.slice(0, -1).map((box, index) => sorted[index + 1]!.x - box.x);
  if (gaps.length === 0) return false;
  const pitch = median(gaps);
  return gaps.every((gap) => Math.abs(gap - pitch) <= Math.max(5, size * 0.28));
}

function hasSupportedLowerTopRecoveryRow(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  current: { row: BuffIconBox[]; y: number; size: number },
  size: number,
  image: ImageLike,
) {
  return rows.some((row) => {
    if (row === current || row.y <= current.y + size * 0.72 || row.y > current.y + size * 1.55) return false;
    if (row.row.length < 6) return false;
    const rowSize = Math.round(median(row.row.map((box) => box.size)));
    if (Math.abs(rowSize - size) > Math.max(3, size * 0.12)) return false;
    const frameCount = row.row.filter((box) => hasLikelyBuffFrame(image, box)).length;
    return frameCount >= Math.max(4, Math.ceil(row.row.length * 0.55));
  });
}

function hasRightAlignedLowerRow(
  rows: Array<{ row: BuffIconBox[]; y: number; size: number }>,
  current: { row: BuffIconBox[]; y: number; size: number },
  currentSorted: BuffIconBox[],
  suffix: BuffIconBox[],
  size: number,
) {
  const currentRight = currentSorted[currentSorted.length - 1]!.x + size;
  return rows.some((row) => {
    if (row === current || row.y <= current.y + size * 0.72 || row.y > current.y + size * 1.55) return false;
    const sorted = [...row.row].sort((a, b) => a.x - b.x);
    if (sorted.length < suffix.length + 2) return false;
    const rowSize = Math.round(median(sorted.map((box) => box.size)));
    if (Math.abs(rowSize - size) > Math.max(3, size * 0.12)) return false;
    const rowRight = sorted[sorted.length - 1]!.x + rowSize;
    return Math.abs(rowRight - currentRight) <= size * 0.6;
  });
}
