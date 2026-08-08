import type { BuffIconBox, ExtractBuffIconsOptions, FeatureMaps, ImageLike, Rect, RowCandidate, Score } from "../types.js";
import { clamp, clamp01, iou, mean, median, nms } from "./math.js";
import { rowCellThreshold, scoreTightSlot } from "./scoring.js";

export function rowsToBoxes(rows: RowCandidate[], maps: FeatureMaps, roi: Rect, maxIcons: number) {
  const boxes: BuffIconBox[] = [];
  const refine = createTightCellRefiner(maps, roi);
  for (const row of rows) {
    const rowBoxes: BuffIconBox[] = [];
    for (let index = 0; index < row.count; index++) {
      const predictedX = row.x + index * row.size;
      const refined = refine(predictedX, row.y, row.size);
      if (!refined) continue;
      rowBoxes.push(refined);
      if (boxes.length + rowBoxes.length >= maxIcons) break;
    }
    rowBoxes.push(...expandRowLeft(row, rowBoxes, maps, roi, maxIcons - boxes.length - rowBoxes.length, refine));
    rowBoxes.push(...fillRowGaps(row, rowBoxes, maps, roi, maxIcons - boxes.length - rowBoxes.length, refine));
    boxes.push(...snapSparseRowBoxesToTrace(row, rowBoxes));
    if (boxes.length >= maxIcons) break;
  }
  return boxes;
}

export function detectCompactTopRightRow(
  maps: FeatureMaps,
  roi: Rect,
  image: ImageLike,
  options: ExtractBuffIconsOptions,
  maxIcons: number,
) {
  const minSize = Math.max(28, options.minSlotSize ?? Math.floor(Math.min(image.width, image.height) * 0.012));
  const maxSize = Math.min(options.maxSlotSize ?? 58, 58, maps.width, maps.height);
  const maxTopY = Math.min(maps.height, Math.max(76, image.height * 0.08));
  const maxRightMargin = Math.round(clamp(image.width * 0.09, 72, 190));
  const minRightMargin = -Math.round(Math.min(8, image.width * 0.004));
  const rows: { boxes: BuffIconBox[]; score: number }[] = [];
  const refine = createTightCellRefiner(maps, roi);

  for (let size = minSize; size <= maxSize; size++) {
    const minCellScore = rowCellThreshold(size) + (size < 40 ? 18 : 30);
    const yStep = Math.max(1, Math.round(size / 20));
    const xStep = Math.max(1, Math.round(size / 20));
    const maxLocalY = Math.min(maps.height - size, Math.round(maxTopY));
    for (let localY = 0; localY <= maxLocalY; localY += yStep) {
      for (
        let localRightX = maps.width - size - maxRightMargin;
        localRightX <= maps.width - size - minRightMargin;
        localRightX += xStep
      ) {
        if (localRightX < 0 || localRightX + size > maps.width) continue;
        const cells: { x: number; score: number }[] = [];
        let misses = 0;
        for (let localX = localRightX; localX + size >= maps.width - maxRightMargin - size * 4.5; localX -= size) {
          if (localX < 0 || localX + size > maps.width) break;
          const cellScore = scoreTightSlot(maps, localX, localY, size).score;
          if (cellScore >= minCellScore) {
            cells.push({ x: localX + roi.x, score: cellScore });
            misses = 0;
            continue;
          }
          misses++;
          if (cells.length === 0 || misses >= 1) break;
        }

        if (cells.length < 3 || cells.length > 5) continue;
        cells.reverse();
        const rightMargin = image.width - (cells[cells.length - 1]!.x + size);
        if (rightMargin < minRightMargin || rightMargin > maxRightMargin) continue;
        const rowScore = mean(cells.map((cell) => cell.score)) * cells.length + (1 - clamp01(rightMargin / maxRightMargin)) * 90 - localY * 0.15;
        const rowBoxes = cells
          .map((cell) => refine(cell.x, localY + roi.y, size, Math.round(size * 0.16)))
          .filter((box): box is BuffIconBox => Boolean(box))
          .filter((box) => Math.abs(box.y - (localY + roi.y)) <= size * 0.24)
          .map((box) => ({
            ...box,
            y: Math.round(median(cells.map(() => localY + roi.y))),
            size,
            score: Math.max(box.score, 190),
            confidence: Math.max(box.confidence, 0.72),
          }));
        if (rowBoxes.length >= 3) rows.push({ boxes: rowBoxes, score: rowScore });
      }
    }
  }

  const selected = rows.sort((a, b) => b.score - a.score)[0]?.boxes ?? [];
  return nms(selected.sort((a, b) => b.score - a.score), 0.35)
    .slice(0, maxIcons)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function snapSparseRowBoxesToTrace(row: RowCandidate, rowBoxes: BuffIconBox[]) {
  if (row.size < 52 || row.count > 3 || rowBoxes.length < 2 || rowBoxes.length > 3) return rowBoxes;
  const usedSlots = new Set<number>();
  const snapped: BuffIconBox[] = [];

  for (const box of rowBoxes) {
    const slot = Math.round((box.x - row.x) / row.size);
    const x = row.x + slot * row.size;
    const closeToTrace = Math.abs(box.x - x) <= row.size * 0.22 && Math.abs(box.y - row.y) <= row.size * 0.22;
    if (slot < 0 || slot >= row.count || usedSlots.has(slot) || !closeToTrace) return rowBoxes;
    usedSlots.add(slot);
    snapped.push({
      ...box,
      x: Math.round(x),
      y: Math.round(row.y),
      size: row.size,
    });
  }

  return snapped;
}

function expandRowLeft(
  row: RowCandidate,
  rowBoxes: BuffIconBox[],
  maps: FeatureMaps,
  roi: Rect,
  remaining: number,
  refine: TightCellRefiner = createTightCellRefiner(maps, roi),
) {
  if (remaining <= 0 || row.count < 4 || row.size < 52) return [];
  const expanded: BuffIconBox[] = [];
  const topRowCompletion = row.y - roi.y <= Math.max(18, row.size * 0.42);
  const acceptScore = topRowCompletion ? rowCellThreshold(row.size) + 42 : Math.max(190, rowCellThreshold(row.size) + 84);
  let misses = 0;

  for (let step = 1; step <= 8; step++) {
    const predictedX = row.x - step * row.size;
    if (predictedX < roi.x || expanded.length >= remaining) break;
    const refined = refine(predictedX, row.y, row.size, topRowCompletion ? Math.round(row.size * 0.28) : undefined);
    const overlaps = refined && [...rowBoxes, ...expanded].some((box) => iou(box, refined) > 0.22);
    if (refined && refined.score >= acceptScore && !overlaps) {
      expanded.push(topRowCompletion && refined.score < 190 ? { ...refined, score: 190, confidence: Math.max(refined.confidence, 0.72) } : refined);
      misses = 0;
      continue;
    }
    misses++;
    if (misses >= 2) break;
  }

  return expanded;
}

function fillRowGaps(
  row: RowCandidate,
  rowBoxes: BuffIconBox[],
  maps: FeatureMaps,
  roi: Rect,
  remaining: number,
  refine: TightCellRefiner = createTightCellRefiner(maps, roi),
) {
  if (remaining <= 0 || row.size < 52 || rowBoxes.length < 4) return [];
  const sorted = [...rowBoxes].sort((a, b) => a.x - b.x);
  const filled: BuffIconBox[] = [];
  const topRowCompletion = row.y - roi.y <= Math.max(18, row.size * 0.42);
  const acceptScore = topRowCompletion ? rowCellThreshold(row.size) + 20 : Math.max(190, rowCellThreshold(row.size) + 84);

  for (let index = 0; index < sorted.length - 1; index++) {
    const left = sorted[index]!;
    const right = sorted[index + 1]!;
    const gap = right.x - left.x;
    if (gap < row.size * 1.45 || gap > row.size * 3.2) continue;
    const missingCount = Math.round(gap / row.size) - 1;
    for (let step = 1; step <= missingCount; step++) {
      if (filled.length >= remaining) return filled;
      const predictedX = left.x + step * row.size;
      const refined = refine(predictedX, row.y, row.size, topRowCompletion ? Math.round(row.size * 0.14) : undefined);
      const overlaps = refined && [...rowBoxes, ...filled].some((box) => iou(box, refined) > 0.22);
      if (refined && refined.score >= acceptScore && !overlaps) {
        filled.push(topRowCompletion && refined.score < 190 ? { ...refined, score: 190, confidence: Math.max(refined.confidence, 0.72) } : refined);
      } else if (topRowCompletion && refined && overlaps) {
        const direct = {
          x: Math.round(predictedX),
          y: Math.round(row.y),
          size: row.size,
          score: 190,
          confidence: 0.72,
        };
        if (![...rowBoxes, ...filled].some((box) => iou(box, direct) > 0.22)) filled.push(direct);
      }
    }
  }

  return filled;
}

export function refineTightCell(
  globalX: number,
  globalY: number,
  baseSize: number,
  maps: FeatureMaps,
  roi: Rect,
  searchRadius?: number,
): BuffIconBox | undefined {
  return refineTightCellWithScoreAt(globalX, globalY, baseSize, maps, roi, (x, y, size) => scoreTightSlot(maps, x, y, size), searchRadius);
}

export type TightCellRefiner = (
  globalX: number,
  globalY: number,
  baseSize: number,
  searchRadius?: number,
) => BuffIconBox | undefined;

export function createTightCellRefiner(maps: FeatureMaps, roi: Rect): TightCellRefiner {
  const scoreCache = new Map<number, Score>();
  const scoreAt = (x: number, y: number, size: number) => {
    const key = (size * maps.height + y) * maps.width + x;
    const cached = scoreCache.get(key);
    if (cached) return cached;
    const score = scoreTightSlot(maps, x, y, size);
    scoreCache.set(key, score);
    return score;
  };
  return (globalX, globalY, baseSize, searchRadius) => refineTightCellWithScoreAt(globalX, globalY, baseSize, maps, roi, scoreAt, searchRadius);
}

function refineTightCellWithScoreAt(
  globalX: number,
  globalY: number,
  baseSize: number,
  maps: FeatureMaps,
  roi: Rect,
  scoreAt: (x: number, y: number, size: number) => Score,
  searchRadius?: number,
): BuffIconBox | undefined {
  let best: BuffIconBox | undefined;
  const radius = searchRadius ?? Math.max(2, Math.round(baseSize / 11));
  const localBaseX = Math.round(globalX - roi.x);
  const localBaseY = Math.round(globalY - roi.y);
  for (let ds = -2; ds <= 2; ds++) {
    const size = baseSize + ds;
    if (size < 12) continue;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const lx = localBaseX + dx;
        const ly = localBaseY + dy;
        if (lx < 0 || ly < 0 || lx + size > maps.width || ly + size > maps.height) continue;
        const raw = scoreAt(lx, ly, size);
        const alignmentPenalty = (Math.abs(dx) + Math.abs(dy)) * 3.2 + Math.abs(ds) * 11;
        const weighted = raw.score - alignmentPenalty;
        if (!best || weighted > best.score) {
          best = {
            x: lx + roi.x,
            y: ly + roi.y,
            size,
            score: weighted,
            confidence: raw.confidence,
          };
        }
      }
    }
  }
  if (!best || best.score < rowCellThreshold(baseSize) * 0.78) return undefined;
  return best;
}
