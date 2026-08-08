import type { BuffIconBox, Candidate, ExtractBuffIconsOptions, FeatureMaps, ImageLike, Rect, Score } from "../types.js";
import { DEFAULT_MAX_SLOT_SIZE, DEFAULT_MIN_SLOT_SIZE } from "./constants.js";
import { cropQuality, lumaAt } from "./cropQuality.js";
import { avg, clamp, clamp01, clusterValues, median, nms } from "./math.js";

export function scanSquareCandidates(
  maps: FeatureMaps,
  roi: Rect,
  image: ImageLike,
  options: ExtractBuffIconsOptions,
): Candidate[] {
  const adaptiveMinSlotSize = Math.floor(Math.min(image.width, image.height) * 0.018);
  const minSlotSize = Math.max(12, options.minSlotSize ?? Math.max(DEFAULT_MIN_SLOT_SIZE, adaptiveMinSlotSize));
  const maxSlotSize = Math.min(options.maxSlotSize ?? DEFAULT_MAX_SLOT_SIZE, maps.width, maps.height);
  const candidates: Candidate[] = [];

  for (let size = minSlotSize; size <= maxSlotSize; size++) {
    const step = Math.max(2, Math.round(size / 14));
    const perSize: Candidate[] = [];
    for (let y = 0; y <= maps.height - size; y += step) {
      for (let x = 0; x <= maps.width - size; x += step) {
        const globalX = x + roi.x;
        if (globalX + size < image.width * 0.64) continue;
        const score = scoreSquare(maps, x, y, size);
        if (score.score < 150) continue;
        const rightness = clamp01((globalX - image.width * 0.5) / (image.width * 0.5));
        const topness = 1 - clamp01((y + roi.y) / Math.max(1, roi.height));
        const weightedScore = score.score * (0.86 + rightness * 0.18 + topness * 0.08);
        perSize.push({
          x: globalX,
          y: y + roi.y,
          size,
          score: weightedScore,
          confidence: score.confidence,
          support: 0,
        });
      }
    }
    perSize.sort((a, b) => b.score - a.score);
    candidates.push(...nms(perSize.slice(0, 260), 0.42).slice(0, 120));
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 7000);
}

export function scanGappedGridBoxes(
  maps: FeatureMaps,
  roi: Rect,
  image: ImageLike,
  options: ExtractBuffIconsOptions,
  maxIcons: number,
): BuffIconBox[] {
  const candidates = scanSquareCandidates(maps, roi, image, {
    ...options,
    minSlotSize: options.minSlotSize ?? 28,
    maxSlotSize: Math.min(options.maxSlotSize ?? 35, 35),
  });
  const grid = selectGrid(candidates, image);
  if (!grid) return [];
  const boxes = normalizeGappedGridSlotSize(expandGrid(grid, candidates, maps, roi, image, maxIcons), image);
  return isValidGappedGridResult(boxes) ? boxes : [];
}

function scoreSquare(maps: FeatureMaps, x: number, y: number, size: number): Score {
  if (x < 0 || y < 0 || x + size > maps.width || y + size > maps.height) return { score: 0, confidence: 0 };
  const t = Math.max(2, Math.round(size * 0.08));
  const centerPad = Math.max(t + 1, Math.round(size * 0.16));
  const centerSize = size - centerPad * 2;
  if (centerSize <= 4) return { score: 0, confidence: 0 };

  const topEdge = avg(maps.edgeI, maps.width, x + t, y, size - t * 2, t);
  const bottomEdge = avg(maps.edgeI, maps.width, x + t, y + size - t, size - t * 2, t);
  const leftEdge = avg(maps.edgeI, maps.width, x, y + t, t, size - t * 2);
  const rightEdge = avg(maps.edgeI, maps.width, x + size - t, y + t, t, size - t * 2);
  const borderEdgeAvg = (topEdge + bottomEdge + leftEdge + rightEdge) / 4;
  const borderEdgeMin = Math.min(topEdge, bottomEdge, leftEdge, rightEdge);

  const darkBorder =
    (avg(maps.darkI, maps.width, x, y, size, t) +
      avg(maps.darkI, maps.width, x, y + size - t, size, t) +
      avg(maps.darkI, maps.width, x, y, t, size) +
      avg(maps.darkI, maps.width, x + size - t, y, t, size)) /
    4;
  const brightBorder =
    (avg(maps.brightI, maps.width, x, y, size, t) +
      avg(maps.brightI, maps.width, x, y + size - t, size, t) +
      avg(maps.brightI, maps.width, x, y, t, size) +
      avg(maps.brightI, maps.width, x + size - t, y, t, size)) /
    4;
  const centerSat = avg(maps.satI, maps.width, x + centerPad, y + centerPad, centerSize, centerSize);
  const centerEdge = avg(maps.edgeI, maps.width, x + centerPad, y + centerPad, centerSize, centerSize);

  const borderColorScore = darkBorder * 118 + brightBorder * 72;
  const activityScore = centerSat * 0.34 + centerEdge * 0.14;
  const edgeScore = borderEdgeAvg * 0.88 + Math.min(borderEdgeMin, borderEdgeAvg * 0.72) * 0.18;
  const score = edgeScore + borderColorScore + activityScore;
  const confidence = clamp01((score - 135) / 240);
  return { score, confidence };
}

function selectGrid(candidates: Candidate[], image: ImageLike) {
  const bucketMap = new Map<number, Candidate[]>();
  for (const c of candidates) {
    if (c.y > image.height * 0.42) continue;
    if (c.x + c.size < image.width * 0.64) continue;
    const bucket = Math.round(c.size / 2) * 2;
    const list = bucketMap.get(bucket) ?? [];
    list.push({ ...c, support: 0 });
    bucketMap.set(bucket, list);
  }

  let best:
    | {
        slotSize: number;
        pitch: number;
        score: number;
        supportedCandidates: Candidate[];
      }
    | undefined;

  for (const [bucket, rawMembers] of bucketMap) {
    if (rawMembers.length < 2) continue;
    const members = nms(rawMembers.sort((a, b) => b.score - a.score).slice(0, 260), 0.34);
    const distances: number[] = [];
    for (let i = 0; i < members.length; i++) {
      const a = members[i]!;
      for (let j = i + 1; j < members.length; j++) {
        const b = members[j]!;
        const centerDx = Math.abs(a.x + a.size / 2 - (b.x + b.size / 2));
        const centerDy = Math.abs(a.y + a.size / 2 - (b.y + b.size / 2));
        const size = (a.size + b.size) / 2;
        const sameRow = centerDy <= size * 0.36 && centerDx >= size * 0.78 && centerDx <= size * 1.72;
        const sameCol = centerDx <= size * 0.42 && centerDy >= size * 0.78 && centerDy <= size * 1.86;
        if (!sameRow && !sameCol) continue;
        a.support++;
        b.support++;
        distances.push(sameRow ? centerDx : centerDy);
      }
    }
    const supported = members.filter((c) => c.support > 0);
    if (supported.length < 2) continue;
    const anchoredCount = supported.filter((c) => c.x + c.size > image.width * 0.88).length;
    if (anchoredCount === 0) continue;
    const pitch = estimatePitch(distances, bucket);
    const rightness = supported.reduce((sum, c) => sum + clamp01((c.x - image.width * 0.5) / (image.width * 0.5)), 0);
    const topness = supported.reduce((sum, c) => sum + (1 - clamp01(c.y / Math.max(1, image.height * 0.42))), 0);
    const rawScore =
      supported.length * 180 +
      supported.reduce((sum, c) => sum + Math.min(600, c.score) * 0.12 + c.support * 26, 0) +
      anchoredCount * 260 +
      rightness * 64 +
      topness * 20 +
      bucket * 1.5;
    const oversizePenalty = bucket > 58 ? Math.exp(-((bucket - 58) * (bucket - 58)) / 18) : 1;
    const pitchRatio = pitch / Math.max(1, bucket);
    const pitchPenalty =
      pitchRatio > 1.42 ? Math.exp(-((pitchRatio - 1.42) * (pitchRatio - 1.42)) / 0.012) : pitchRatio < 1.02 ? 0.65 : 1;
    const scaleWeight = Math.pow(clamp(bucket / 50, 0.5, 1.18), 1.6) * oversizePenalty;
    const score = rawScore * scaleWeight * pitchPenalty;
    if (!best || score > best.score) {
      best = {
        slotSize: Math.round(median(supported.map((c) => c.size))),
        pitch,
        score,
        supportedCandidates: supported.sort((a, b) => a.y - b.y || a.x - b.x),
      };
    }
  }

  return best;
}

function estimatePitch(distances: number[], slotSize: number) {
  const filtered = distances.filter((d) => d >= slotSize * 0.95 && d <= slotSize * 1.85);
  if (filtered.length === 0) return Math.round(slotSize * 1.24);
  const sorted = filtered.sort((a, b) => a - b);
  if (slotSize <= 40) return Math.round(clamp(median(sorted), slotSize + 2, slotSize * 1.45));
  const upper = sorted.slice(Math.floor(sorted.length * 0.35));
  return Math.round(clamp(median(upper), slotSize + 2, slotSize * 1.55));
}

function expandGrid(
  grid: { slotSize: number; pitch: number; supportedCandidates: Candidate[] },
  candidates: Candidate[],
  maps: FeatureMaps,
  roi: Rect,
  image: ImageLike,
  maxIcons: number,
): BuffIconBox[] {
  const size = grid.slotSize;
  const pitch = grid.pitch;
  const related = candidates
    .filter((c) => Math.abs(c.size - size) <= Math.max(3, Math.round(size * 0.08)))
    .filter((c) => c.x + c.size > image.width * 0.64)
    .filter((c) => c.y < roi.y + roi.height);
  const anchoredRows = clusterValues(related.map((c) => c.y), Math.max(5, size * 0.42, pitch * 0.8)).filter((row) =>
    related.some((c) => Math.abs(c.y - row) <= size * 0.52 && c.x + c.size > image.width * 0.86),
  );
  const firstRow = Math.min(...anchoredRows);
  const rowAnchors = anchoredRows.filter((row) => row <= firstRow + pitch * 3.4);

  const boxes: BuffIconBox[] = [];
  const supportedMedianScore = median(grid.supportedCandidates.map((c) => c.score));

  for (const rowY of rowAnchors) {
    const rowCandidates = related.filter((c) => Math.abs(c.y - rowY) <= size * 0.52);
    if (rowCandidates.length === 0) continue;
    const xAnchors = clusterValues(
      rowCandidates.map((c) => c.x),
      Math.max(5, size * 0.34),
    );
    let rightMost = Math.max(...xAnchors);
    const rightLimit = image.width - Math.max(2, Math.round(size * 0.08));
    while (rightMost + pitch + size <= rightLimit) {
      const next = refineCell(rightMost + pitch, rowY, size, maps, roi, Math.max(3, Math.round(size * 0.14)));
      const x = rightMost + pitch;
      const rightness = clamp01((x - image.width * 0.64) / Math.max(1, image.width * 0.36));
      const absoluteAcceptedScore = size >= 50 || image.height >= 1500 ? 215 : size >= 40 ? 185 : 175;
      const acceptedScore = Math.max(absoluteAcceptedScore, supportedMedianScore * (0.72 - rightness * 0.2));
      if (!next || next.score < acceptedScore * 0.82 || !hasGappedCellActivity(next, maps, roi, image)) break;
      rightMost += pitch;
    }

    let misses = 0;
    let seen = 0;
    for (let x = rightMost; x >= image.width * 0.64 - size; x -= pitch) {
      const refined = refineCell(x, rowY, size, maps, roi, Math.max(3, Math.round(size * 0.14)));
      const rightness = clamp01((x - image.width * 0.64) / Math.max(1, image.width * 0.36));
      const absoluteAcceptedScore = size >= 50 || image.height >= 1500 ? 215 : size >= 40 ? 185 : 175;
      const acceptedScore = Math.max(absoluteAcceptedScore, supportedMedianScore * (0.72 - rightness * 0.2));
      if (refined && refined.score >= acceptedScore && hasGappedCellActivity(refined, maps, roi, image)) {
        boxes.push({
          x: Math.round(refined.x),
          y: Math.round(refined.y),
          size,
          score: refined.score,
          confidence: clamp01(refined.score / Math.max(1, median(grid.supportedCandidates.map((c) => c.score)))),
        });
        misses = 0;
        seen++;
      } else {
        misses++;
        if (seen > 0 && misses >= 2) break;
      }
      if (boxes.length >= maxIcons) break;
    }
    if (boxes.length >= maxIcons) break;
  }

  const selected = nms(
    boxes
      .filter((box) => box.x >= image.width * 0.64 - 2 && box.y >= 0 && box.x + box.size <= image.width && box.y + box.size <= image.height)
      .sort((a, b) => b.score - a.score),
    0.38,
  )
    .slice(0, maxIcons)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return completeGappedGridRows(selected, maps, roi, image, maxIcons);
}

function hasGappedCellActivity(box: BuffIconBox, maps: FeatureMaps, roi: Rect, image: ImageLike) {
  if (box.size > 42) return true;
  const localX = Math.round(box.x - roi.x);
  const localY = Math.round(box.y - roi.y);
  const pad = Math.max(4, Math.round(box.size * 0.18));
  const centerSize = box.size - pad * 2;
  if (centerSize <= 4) return true;
  const centerSat = avg(maps.satI, maps.width, localX + pad, localY + pad, centerSize, centerSize);
  const centerEdge = avg(maps.edgeI, maps.width, localX + pad, localY + pad, centerSize, centerSize);
  return centerSat >= 34 || centerEdge >= 118;
}

function completeGappedGridRows(
  boxes: BuffIconBox[],
  maps: FeatureMaps,
  roi: Rect,
  image: ImageLike,
  maxIcons: number,
) {
  if (boxes.length < 8 || boxes.length >= maxIcons) return boxes;
  const rows = groupGappedRows(boxes);
  if (rows.length !== 2) return boxes;
  const size = Math.round(median(boxes.map((box) => box.size)));
  if (size > 40 || Math.max(...rows.map((row) => row.y)) > Math.max(110, image.height * 0.12)) return boxes;

  const pitch = estimateGappedOutputPitch(rows, size);
  if (pitch < size + 5 || pitch > size * 1.65) return boxes;
  const projectedPitch = size <= 40 ? Math.round(clamp(pitch, size + 7, size * 1.29)) : pitch;

  const projected: BuffIconBox[] = [];
  for (const row of rows) {
    const sorted = [...row.boxes].sort((a, b) => a.x - b.x);
    const targetY = Math.round(median(sorted.map((box) => box.y)));
    const rightMost = sorted[sorted.length - 1]!;
    const rowProjection: BuffIconBox[] = [];
    for (let step = 0; step < 13; step++) {
      const candidate = refineGappedCompletionCell(rightMost.x - projectedPitch * step, targetY, size, maps, roi, image);
      if (!candidate) {
        if (step > 0) break;
        continue;
      }
      rowProjection.push(candidate);
    }
    if (rowProjection.length < Math.max(3, sorted.length - 1)) return boxes;
    projected.push(...rowProjection);
  }

  if (projected.length < boxes.length) return boxes;
  return nms(projected.sort((a, b) => b.score - a.score), 0.38)
    .slice(0, maxIcons)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function groupGappedRows(boxes: BuffIconBox[]) {
  const rows: Array<{ y: number; boxes: BuffIconBox[] }> = [];
  for (const box of [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let row = rows.find((candidate) => Math.abs(candidate.y - box.y) <= Math.max(7, box.size * 0.55));
    if (!row) {
      row = { y: box.y, boxes: [] };
      rows.push(row);
    }
    row.boxes.push(box);
    row.y = median(row.boxes.map((item) => item.y));
  }
  return rows.sort((a, b) => a.y - b.y);
}

function estimateGappedOutputPitch(rows: Array<{ boxes: BuffIconBox[] }>, size: number) {
  const gaps: number[] = [];
  for (const row of rows) {
    const sorted = [...row.boxes].sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1]!.x - sorted[i]!.x;
      if (gap >= size + 4 && gap <= size * 1.75) gaps.push(gap);
      if (gap >= size * 1.9 && gap <= size * 3.3) gaps.push(gap / Math.max(2, Math.round(gap / Math.max(size + 5, size * 1.28))));
    }
  }
  return Math.round(gaps.length > 0 ? median(gaps) : size * 1.3);
}

function refineGappedCompletionCell(
  globalX: number,
  globalY: number,
  size: number,
  maps: FeatureMaps,
  roi: Rect,
  image: ImageLike,
) {
  const refined = refineCell(globalX, globalY, size, maps, roi, Math.max(8, Math.round(size * 0.34)));
  if (!refined || refined.score < 168) return undefined;
  if (!hasGappedCompletionActivity(refined, image)) return undefined;
  return refined;
}

function hasGappedCompletionActivity(box: BuffIconBox, image: ImageLike) {
  const quality = cropQuality(image, box);
  return ((quality.sat >= 52 || quality.edge >= 40 || quality.centerDark >= 0.18) && quality.edge >= 16) || (box.score >= 248 && quality.edge >= 16);
}

function refineCell(
  globalX: number,
  globalY: number,
  size: number,
  maps: FeatureMaps,
  roi: Rect,
  radius: number,
): (BuffIconBox & { score: number }) | undefined {
  let best: (BuffIconBox & { score: number }) | undefined;
  const localBaseX = Math.round(globalX - roi.x);
  const localBaseY = Math.round(globalY - roi.y);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const lx = localBaseX + dx;
      const ly = localBaseY + dy;
      if (lx < 0 || ly < 0 || lx + size > maps.width || ly + size > maps.height) continue;
      const score = scoreSquare(maps, lx, ly, size);
      const alignmentPenalty = (Math.abs(dx) + Math.abs(dy)) * 2.8;
      const weighted = score.score - alignmentPenalty;
      if (!best || weighted > best.score) {
        best = {
          x: lx + roi.x,
          y: ly + roi.y,
          size,
          score: weighted,
          confidence: score.confidence,
        };
      }
    }
  }
  return best;
}

function fallbackBoxes(candidates: Candidate[], maxIcons: number): BuffIconBox[] {
  return nms(candidates, 0.42)
    .slice(0, Math.min(maxIcons, 24))
    .map((c) => ({ x: c.x, y: c.y, size: c.size, score: c.score, confidence: c.confidence }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function normalizeGappedGridSlotSize(boxes: BuffIconBox[], image: ImageLike) {
  if (boxes.length < 8) return boxes;
  const baseSize = Math.round(median(boxes.map((box) => box.size)));
  if (baseSize < 30 || baseSize > 36) return boxes;
  const rows = groupGappedRows(boxes);
  if (rows.length !== 2) return boxes;

  const fittedRows = rows.map((row) => ({
    ...row,
    sorted: [...row.boxes].sort((a, b) => a.x - b.x),
  })).map((row) => ({
    ...row,
    fits: row.sorted.map((box) => fitGappedOuterCellFrame(image, box, baseSize)),
  }));
  const referenceRow = [...fittedRows].sort((a, b) => b.fits.length - a.fits.length || b.y - a.y)[0];
  const referenceXs = referenceRow ? referenceRow.fits.map((fit) => fit.x).sort((a, b) => a - b) : [];
  const referencePitch = minPositiveGap(referenceXs);
  const targetSize = Math.round(clamp(baseSize + 10, baseSize + 8, referencePitch ? Math.min(baseSize + 12, referencePitch) : baseSize + 12));
  const columnAnchors = clusterValues(
    referenceXs.length > 0 ? referenceXs : fittedRows.flatMap((row) => row.fits.map((fit) => fit.x)),
    Math.max(4, targetSize * 0.14),
  );

  return fittedRows
    .flatMap((row) => {
      const rowFits = row.fits;
      const rowXs =
        referenceXs.length >= row.sorted.length
          ? referenceXs.slice(referenceXs.length - row.sorted.length)
          : rowFits.map((box) => nearestValue(columnAnchors, box.x));
      const rowTop = findGappedOuterRowTop(image, rowXs, Math.round(median(rowFits.map((box) => box.y))), targetSize);
      return row.sorted.map((box, index) => ({
        ...box,
        x: Math.round(clamp(rowXs[index]!, 0, image.width - targetSize)),
        y: rowTop,
        size: targetSize,
      }));
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function isValidGappedGridResult(boxes: BuffIconBox[]) {
  if (boxes.length < 10) return false;
  const rows = groupGappedRows(boxes);
  if (rows.length !== 2) return false;
  const rowCounts = rows.map((row) => row.boxes.length);
  if (Math.min(...rowCounts) < 5 || Math.max(...rowCounts) < 7) return false;
  const size = Math.round(median(boxes.map((box) => box.size)));
  const yGap = Math.abs(rows[1]!.y - rows[0]!.y);
  if (yGap < size * 0.75 || yGap > size * 1.65) return false;

  const reference = [...rows].sort((a, b) => b.boxes.length - a.boxes.length || b.y - a.y)[0]!;
  const referenceXs = reference.boxes.map((box) => box.x).sort((a, b) => a - b);
  for (const row of rows) {
    if (row.boxes.length > referenceXs.length) continue;
    const xs = row.boxes.map((box) => box.x).sort((a, b) => a - b);
    const expectedXs = referenceXs.slice(referenceXs.length - xs.length);
    if (xs.some((x, index) => Math.abs(x - expectedXs[index]!) > Math.max(2, size * 0.08))) return false;
  }
  return true;
}

function minPositiveGap(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1]! - sorted[i]!;
    if (gap > 1) gaps.push(gap);
  }
  return gaps.length > 0 ? Math.min(...gaps) : undefined;
}

function fitGappedOuterCellFrame(image: ImageLike, box: BuffIconBox, baseSize: number) {
  const minSize = Math.round(baseSize + 7);
  const maxSize = Math.round(baseSize + 14);
  const minX = Math.round(clamp(box.x - 4, 0, image.width - minSize));
  const maxX = Math.round(clamp(box.x + 8, 0, image.width - minSize));
  const minY = Math.round(clamp(box.y - 10, 0, image.height - minSize));
  const maxY = Math.round(clamp(box.y + 10, 0, image.height - minSize));
  let best = { x: Math.round(box.x), y: Math.round(box.y), size: minSize };
  let bestScore = -Infinity;

  for (let size = minSize; size <= maxSize; size++) {
    for (let y = minY; y <= maxY && y + size <= image.height; y++) {
      for (let x = minX; x <= maxX && x + size <= image.width; x++) {
        const score = gappedOuterFrameScore(image, x, y, size);
        if (score > bestScore) {
          bestScore = score;
          best = { x, y, size };
        }
      }
    }
  }
  return best;
}

function nearestValue(values: number[], value: number) {
  if (values.length === 0) return Math.round(value);
  return values.reduce((best, candidate) => (Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best), values[0]!);
}

function findGappedOuterRowTop(image: ImageLike, xs: number[], baseY: number, size: number) {
  if (xs.length === 0) return Math.round(clamp(baseY, 0, image.height - size));
  const minY = Math.round(clamp(baseY - Math.max(14, size * 0.34), 0, image.height - size));
  const maxY = Math.round(clamp(baseY + Math.max(6, size * 0.14), 0, image.height - size));
  let bestY = Math.round(clamp(baseY, 0, image.height - size));
  let bestScore = -Infinity;

  for (let y = minY; y <= maxY; y++) {
    const sampleXs = xs.slice(Math.max(0, xs.length - Math.min(xs.length, 8)));
    const score = sampleXs.reduce((sum, x) => sum + gappedOuterFrameScore(image, x, y, size), 0) / Math.max(1, sampleXs.length);
    if (score > bestScore) {
      bestScore = score;
      bestY = y;
    }
  }
  return Math.round(clamp(bestY, 0, image.height - size));
}

function gappedOuterFrameScore(image: ImageLike, x: number, y: number, size: number) {
  let dark = 0;
  let edge = 0;
  let count = 0;
  for (let k = 0; k < size; k++) {
    for (const py of [y, y + size - 1]) {
      const luma = lumaAt(image, x + k, py);
      dark += luma < 92 ? 1 : 0;
      edge += Math.abs(luma - lumaAt(image, x + k, py - 1)) + Math.abs(luma - lumaAt(image, x + k, py + 1));
      count++;
    }
    for (const px of [x, x + size - 1]) {
      const luma = lumaAt(image, px, y + k);
      dark += luma < 92 ? 1 : 0;
      edge += Math.abs(luma - lumaAt(image, px - 1, y + k)) + Math.abs(luma - lumaAt(image, px + 1, y + k));
      count++;
    }
  }
  return (dark / Math.max(1, count)) * 220 + (edge / Math.max(1, count)) * 1.3;
}
