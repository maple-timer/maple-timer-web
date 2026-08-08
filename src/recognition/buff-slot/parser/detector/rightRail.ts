import type { BuffIconBox, ExtractBuffIconsOptions, FeatureMaps, ImageLike, Rect } from "../types.js";
import { createTightCellRefiner, type TightCellRefiner } from "./cellRefine.js";
import { clusterBoxesByRow } from "./grid.js";
import { avg, clamp, clampInt, clusterValues, iou, median, nms } from "./math.js";
import { rowCellThreshold, scoreTightSlot } from "./scoring.js";

export function appendRightRailSingletons(
  boxes: BuffIconBox[],
  maps: FeatureMaps,
  roi: Rect,
  image: ImageLike,
  options: ExtractBuffIconsOptions,
  maxIcons: number,
) {
  if (boxes.length < 2 || boxes.length >= maxIcons) return boxes;

  const baseSize = Math.round(median(boxes.map((box) => box.size)));
  if (baseSize < 30) return boxes;
  const rowBands = clusterValues(
    boxes.map((box) => box.y),
    Math.max(4, baseSize * 0.35),
  );
  if (rowBands.length < 2) return boxes;
  const singletonSearchBands = [
    ...rightRailGapBands(rowBands, baseSize, roi.y, maps.height - baseSize),
    ...rightRailBottomBands(rowBands, baseSize, roi.y, maps.height - baseSize),
  ];
  if (singletonSearchBands.length === 0) return boxes;
  const rightEdge = Math.max(...boxes.map((box) => box.x + box.size));
  const observedRightMargin = Math.max(0, image.width - rightEdge);
  const rightColumnCount = boxes.filter((box) => Math.abs(box.x + box.size - rightEdge) <= baseSize * 0.4).length;
  if (rightColumnCount < 2) return boxes;

  const minSize = Math.max(12, baseSize - 2);
  const maxSize = Math.min(baseSize + 2, maps.width, maps.height);
  const rightMarginLimit = Math.round(
    Math.max(
      clamp(baseSize * (baseSize < 40 ? 0.9 : 0.55), 14, baseSize < 40 ? 38 : 34),
      Math.min(baseSize * 1.15, observedRightMargin + baseSize * 0.24),
    ),
  );
  const rightMarginMin = -Math.round(Math.min(8, image.width * 0.003));
  const minScore = Math.max(options.minBoxScore ?? 190, rowCellThreshold(baseSize) + (baseSize < 40 ? 74 : 122));
  const candidates: BuffIconBox[] = [];
  const refine = createTightCellRefiner(maps, roi);

  for (let size = minSize; size <= maxSize; size++) {
    const xStep = Math.max(1, Math.round(size / 18));
    const yStep = Math.max(1, Math.round(size / 18));
    for (
      let localX = maps.width - size - rightMarginLimit;
      localX <= maps.width - size - rightMarginMin;
      localX += xStep
    ) {
      if (localX < 0 || localX + size > maps.width) continue;
      for (const band of singletonSearchBands) {
        for (let localY = band.start; localY <= band.end; localY += yStep) {
          const refined = refine(localX + roi.x, localY + roi.y, size);
          if (!refined || refined.score < minScore) continue;
          const rightDrift = Math.abs(refined.x + refined.size - rightEdge);
          const nearRightEdge =
            rightDrift <= baseSize * 0.38 || image.width - (refined.x + refined.size) <= rightMarginLimit + (baseSize < 40 ? 6 : 4);
          const overlapsExisting = boxes.some((box) => iou(box, refined) > 0.22);
          if (!nearRightEdge || overlapsExisting) continue;
          candidates.push(refined);
        }
      }
    }
  }

  const tail = probeRightRailVisibleRows(boxes, maps, roi, image, options, maxIcons, refine);
  if (candidates.length === 0) return polishRightRailSingletonY(tail.length === 0 ? boxes : [...boxes, ...tail], maps, roi, image);
  const selected = nms(candidates.sort((a, b) => b.score - a.score), 0.3).slice(0, maxIcons - boxes.length);
  const expanded = selected.flatMap((candidate) => expandRightRailCandidateLeft(candidate, boxes, maps, roi, options, maxIcons, refine));
  const merged = nms([...boxes, ...selected, ...expanded, ...tail].sort((a, b) => b.score - a.score), 0.35)
    .slice(0, maxIcons)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return polishRightRailSingletonY(merged, maps, roi, image).sort((a, b) => a.y - b.y || a.x - b.x);
}

function polishRightRailSingletonY(boxes: BuffIconBox[], maps: FeatureMaps, roi: Rect, image: ImageLike) {
  const rows = clusterBoxesByRow(boxes);
  if (rows.length < 3) return boxes;
  const baseSize = Math.round(median(boxes.map((box) => box.size)));
  const yByBox = new Map<BuffIconBox, number>();

  for (const row of rows) {
    if (row.length !== 1) continue;
    const box = row[0]!;
    const size = Math.round(box.size);
    if (size < 36 || Math.abs(size - baseSize) > Math.max(4, size * 0.16)) continue;
    if (image.width - (box.x + box.size) > size * 1.6) continue;

    const nearbyRows = rows.filter((other) => other !== row && Math.abs(median(other.map((item) => item.y)) - box.y) <= size * 2.4);
    if (nearbyRows.length < 2) continue;

    const localX = Math.round(box.x - roi.x);
    const localY = Math.round(box.y - roi.y);
    const currentScore = scoreTightSlot(maps, localX, localY, size).score;
    let bestY = Math.round(box.y);
    let bestScore = currentScore;
    const radius = Math.max(8, Math.min(14, Math.round(size * 0.3)));
    for (let dy = -radius; dy <= radius; dy++) {
      if (dy === 0) continue;
      const y = Math.round(box.y + dy);
      if (y < 0 || y + size > image.height) continue;
      const score = scoreTightSlot(maps, localX, y - roi.y, size).score - Math.abs(dy) * 0.35;
      if (score > bestScore) {
        bestScore = score;
        bestY = y;
      }
    }

    if (bestScore >= currentScore + 45 && Math.abs(bestY - box.y) >= 2) yByBox.set(box, bestY);
  }

  return yByBox.size === 0 ? boxes : boxes.map((box) => (yByBox.has(box) ? { ...box, y: yByBox.get(box)! } : box));
}

function probeRightRailVisibleRows(
  boxes: BuffIconBox[],
  maps: FeatureMaps,
  roi: Rect,
  image: ImageLike,
  options: ExtractBuffIconsOptions,
  maxIcons: number,
  refine: TightCellRefiner = createTightCellRefiner(maps, roi),
) {
  if (boxes.length >= maxIcons || boxes.length < 8) return [];
  const rows = clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      y: Math.round(median(row.map((box) => box.y))),
      size: Math.round(median(row.map((box) => box.size))),
    }))
    .sort((a, b) => a.y - b.y);
  if (rows.length < 3) return [];

  const baseSize = Math.round(median(rows.flatMap((row) => row.row.map((box) => box.size))));
  if (baseSize < 30) return [];

  const diffs: number[] = [];
  for (let index = 0; index < rows.length - 1; index++) {
    const diff = rows[index + 1]!.y - rows[index]!.y;
    if (diff >= baseSize * 0.86 && diff <= baseSize * 1.35) diffs.push(diff);
  }
  if (diffs.length < 2) return [];

  const pitch = Math.round(median(diffs));
  const rightEdge = Math.max(...boxes.map((box) => box.x + box.size));
  const rightColumn = boxes.filter((box) => Math.abs(box.x + box.size - rightEdge) <= baseSize * 0.34);
  if (rightColumn.length < 3) return [];

  const existingRailScores = rows.map((row) => rightRailControlScore(maps, roi, row.y, baseSize));
  const railThreshold = Math.max(160, median(existingRailScores) * 0.82);
  const railBands = detectRightRailBands(maps, roi, baseSize, railThreshold);
  if (railBands.length === 0) return [];

  const firstRowY = rows[0]!.y;
  const lastRowY = rows[rows.length - 1]!.y;
  const predictedX = Math.round(rightEdge - baseSize);
  const minScore = options.minBoxScore ?? 190;
  const acceptScore = Math.max(minScore, rowCellThreshold(baseSize) + 46, median(rightColumn.map((box) => box.score)) * 0.5);
  const additions: BuffIconBox[] = [];

  for (const bandY of railBands) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (bandY < firstRowY - pitch * 0.65 || bandY > lastRowY + pitch * 1.35) continue;

    let alignedY: number | undefined;
    let bestDrift = Infinity;
    for (const row of rows) {
      const steps = Math.round((bandY - row.y) / pitch);
      if (steps === 0 || Math.abs(steps) > 4) continue;
      const candidateY = Math.round(row.y + steps * pitch);
      const drift = Math.abs(candidateY - bandY);
      if (drift <= Math.max(5, baseSize * 0.26) && drift < bestDrift) {
        alignedY = candidateY;
        bestDrift = drift;
      }
    }
    if (alignedY === undefined) continue;

    const alreadyHasRow = rows.some((row) => Math.abs(row.y - alignedY) <= baseSize * 0.45);
    if (alreadyHasRow) continue;

    const direct = { x: predictedX, y: alignedY, size: baseSize };
    if (direct.x < 0 || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) continue;
    if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

    const refined = refine(predictedX, alignedY, baseSize, Math.round(baseSize * 0.28));
    if (!refined) continue;
    const closeToSlot = Math.abs(refined.x - predictedX) <= baseSize * 0.28 && Math.abs(refined.y - alignedY) <= baseSize * 0.28;
    if (!closeToSlot || refined.score < acceptScore) continue;

    additions.push({
      ...refined,
      x: predictedX,
      y: alignedY,
      size: baseSize,
      score: Math.max(refined.score, minScore),
      confidence: Math.max(refined.confidence, 0.72),
    });
  }

  return additions;
}

function detectRightRailBands(maps: FeatureMaps, roi: Rect, size: number, threshold: number) {
  const candidates: { y: number; score: number }[] = [];
  const yStep = Math.max(1, Math.round(size / 18));
  for (let localY = 0; localY <= maps.height - size; localY += yStep) {
    const y = localY + roi.y;
    const score = rightRailControlScore(maps, roi, y, size);
    if (score >= threshold) candidates.push({ y, score });
  }

  const selected: { y: number; score: number }[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (selected.some((other) => Math.abs(other.y - candidate.y) <= size * 0.55)) continue;
    selected.push(candidate);
  }

  return selected.sort((a, b) => a.y - b.y).map((candidate) => candidate.y);
}

function rightRailControlScore(maps: FeatureMaps, roi: Rect, globalY: number, size: number) {
  const localY = Math.round(globalY - roi.y);
  if (localY < 0 || localY + size > maps.height) return 0;

  const railWidth = Math.round(clamp(size * 0.55, 16, 42));
  let best = 0;
  for (let offset = 0; offset <= Math.round(size * 0.5); offset += 2) {
    const x = maps.width - railWidth - offset;
    if (x < 0 || x + railWidth > maps.width) continue;
    const y = localY + Math.round(size * 0.12);
    const height = Math.max(4, Math.round(size * 0.76));
    const dark = avg(maps.darkI, maps.width, x, y, railWidth, height);
    const bright = avg(maps.brightI, maps.width, x, y, railWidth, height);
    const edge = avg(maps.edgeI, maps.width, x, y, railWidth, height);
    best = Math.max(best, dark * 150 + bright * 70 + edge * 1.6);
  }
  return best;
}

function rightRailGapBands(rowBands: number[], size: number, roiY: number, maxLocalY: number) {
  const sorted = [...rowBands].sort((a, b) => a - b);
  const bands: { start: number; end: number }[] = [];
  for (let index = 0; index < sorted.length - 1; index++) {
    const upper = sorted[index]!;
    const lower = sorted[index + 1]!;
    const gap = lower - upper;
    if (gap < size * 1.45 || gap > size * 3.2) continue;
    const start = clampInt(upper + size * 0.65 - roiY, 0, maxLocalY);
    const end = clampInt(lower - size * 0.65 - roiY, 0, maxLocalY);
    if (end >= start) bands.push({ start, end });
  }
  return bands;
}

function rightRailBottomBands(rowBands: number[], size: number, roiY: number, maxLocalY: number) {
  const sorted = [...rowBands].sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let index = 0; index < sorted.length - 1; index++) {
    const diff = sorted[index + 1]! - sorted[index]!;
    if (diff >= size * 0.82 && diff <= size * 1.45) diffs.push(diff);
  }
  if (diffs.length === 0) return [];

  const pitch = Math.round(median(diffs));
  const predicted = sorted[sorted.length - 1]! + pitch;
  const localCenter = predicted - roiY;
  if (localCenter < 0 || localCenter > maxLocalY + size * 0.5) return [];

  const radius = Math.max(5, Math.round(size * 0.32));
  return [
    {
      start: clampInt(localCenter - radius, 0, maxLocalY),
      end: clampInt(localCenter + radius, 0, maxLocalY),
    },
  ];
}

function expandRightRailCandidateLeft(
  candidate: BuffIconBox,
  existing: BuffIconBox[],
  maps: FeatureMaps,
  roi: Rect,
  options: ExtractBuffIconsOptions,
  maxIcons: number,
  refine: TightCellRefiner = createTightCellRefiner(maps, roi),
) {
  const additions: BuffIconBox[] = [];
  const size = Math.round(candidate.size);
  const minScore = options.minBoxScore ?? 190;
  const acceptScore = Math.max(minScore, rowCellThreshold(size) + 54, candidate.score * 0.56);
  let misses = 0;

  for (let step = 1; step <= 10; step++) {
    if (existing.length + additions.length >= maxIcons) break;
    const predictedX = Math.round(candidate.x - step * size);
    if (predictedX < roi.x) break;

    const direct = { x: predictedX, y: candidate.y, size };
    if ([...existing, candidate, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

    const refined = refine(predictedX, candidate.y, size, Math.round(size * 0.2));
    if (!refined || refined.score < acceptScore) {
      misses++;
      if (misses >= 2 || additions.length === 0) break;
      continue;
    }

    const closeToSlot = Math.abs(refined.x - predictedX) <= size * 0.24 && Math.abs(refined.y - candidate.y) <= size * 0.24;
    if (!closeToSlot) {
      misses++;
      if (misses >= 2 || additions.length === 0) break;
      continue;
    }

    additions.push({
      ...refined,
      x: predictedX,
      y: Math.round(candidate.y),
      size,
      score: Math.max(refined.score, minScore),
      confidence: Math.max(refined.confidence, 0.74),
    });
    misses = 0;
  }

  return additions;
}
