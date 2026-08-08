import type { BuffIconBox, GridHint, GridRowInfo, ImageLike, Rect } from "../types.js";
import type { DetectionContext } from "./context.js";
import { refineTightCell } from "./cellRefine.js";
import { clusterBoxesByRow, describeGridRow, estimateConsensusRightSlot, estimateGlobalGrid, pruneDetachedGridOutliers, stabilizeDetectedRows } from "./grid.js";
import { iou, mean, median } from "./math.js";
import { cropQuality, hasLikelyBuffFrame, hasNearbyLikelyBuffFrame, hasVisibleRightRailControl, isDamageNumberLikeCrop, isSevereTextOverlayPrefix, isTextOverlayFragment } from "./cropQuality.js";
import { rowCellThreshold, scoreTightSlot } from "./scoring.js";
import {
  describeCompactRightAlignedStructure,
  describePitchRow,
  estimateVerticalPitchFromWideGaps,
  estimateVisibleVerticalPitch,
  hasOccupiedSlotNear,
  isLowResCompactBuffLayout,
  uniqueInts,
} from "./completionShared.js";

const LOW_RES_COMPACT_STRUCTURE = { minBoxes: 8, minRows: 3, minDenseRows: 2, maxImageWidth: 1500, maxImageHeight: 900 } as const;
const CROPPED_1366_COMPACT_LAYOUT = { minBoxes: 8, maxImageWidth: 1365, maxImageHeight: 765 } as const;

export function completeTopRightTwoRowRailGrid(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 5 || boxes.length > 18 || image.width < 1500 || roi.y !== 0) return boxes;

  const rows = clusterBoxesByRow(boxes)
    .map((row) => describePitchRow(row))
    .filter((row): row is NonNullable<ReturnType<typeof describePitchRow>> => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  if (rows.length < 1 || rows.length > 2) return boxes;

  const baseSize = Math.round(median(rows.map((row) => row.size)));
  const pitch = Math.round(median(rows.map((row) => row.pitch)));
  if (baseSize < 42 || baseSize > 50 || pitch < baseSize * 0.82 || pitch > baseSize * 1.18) return boxes;
  const standardRightMarginLimit = Math.max(64, baseSize * 1.65);
  if (boxes.length < 8) {
    const row = rows[0]!;
    const canRecoverWideSingleTopRow = rows.length === 1 && image.width - (row.rightX + row.size) > standardRightMarginLimit;
    if (!canRecoverWideSingleTopRow) return boxes;
  }
  if (rows[0]!.rowY > Math.min(8, baseSize * 0.22)) return boxes;
  if (rows.length === 1) {
    const row = rows[0]!;
    if (image.width - (row.rightX + row.size) <= standardRightMarginLimit) return boxes;
    return completeLowerTwoRowRailGridFromTopRow(row, pitch, baseSize, boxes, ctx);
  }

  if (rows[1]!.rowY > Math.max(66, baseSize * 1.55)) return boxes;
  if (rows.some((row) => row.sorted.length > 8)) return boxes;
  const rowGap = rows[1]!.rowY - rows[0]!.rowY;
  if (rowGap < baseSize * 0.8 || rowGap > baseSize * 1.55) return boxes;
  if (rows.some((row) => Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12))) return boxes;
  const hasRailSupport = rows.some((row) => hasVisibleRightRailControl(image, row.sorted[row.sorted.length - 1]!));
  const hasWideRightMargin = rows.some((row) => image.width - (row.rightX + row.size) > standardRightMarginLimit);
  const rightMarginLimit = hasRailSupport ? Math.max(150, baseSize * 3.4) : standardRightMarginLimit;
  if (rows.some((row) => image.width - (row.rightX + row.size) > rightMarginLimit)) return boxes;
  if (!hasRailSupport) return boxes;

  const targetRightX = Math.round(Math.min(...rows.map((row) => row.rightX)));
  const rebuiltRows = rows.map((row, index) =>
    index === 0 && hasWideRightMargin
      ? stabilizeTwoRowRailGridY(
          row.sorted.map((box) => ({
            ...box,
            x: Math.round(box.x),
            y: row.rowY,
            size: baseSize,
          })),
          maps,
          roi,
        )
      : completeTwoRowRailGridRow(row, targetRightX, pitch, baseSize, boxes, ctx),
  );
  if (rebuiltRows.some((row, index) => row.length < rows[index]!.sorted.length)) return boxes;

  const rebuilt = rebuiltRows.flat();
  if (rebuilt.length <= boxes.length) {
    const snapped = rebuiltRows.flatMap((row, index) =>
      row.length === rows[index]!.sorted.length ? row : rows[index]!.sorted,
    );
    return snapped.length === boxes.length ? snapped : boxes;
  }

  return rebuilt.slice(0, maxIcons);
}

function completeLowerTwoRowRailGridFromTopRow(
  row: NonNullable<ReturnType<typeof describePitchRow>>,
  pitch: number,
  baseSize: number,
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { image } = ctx;
  if (row.sorted.length < 5 || row.sorted.length > 8) return boxes;
  if (Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12)) return boxes;
  if (!hasVisibleRightRailControl(image, row.sorted[row.sorted.length - 1]!)) return boxes;
  if (image.width - (row.rightX + row.size) > Math.max(150, baseSize * 3.4)) return boxes;

  const baseY = Math.round(row.rowY + baseSize * 1.15);
  let bestRow: BuffIconBox[] = [];
  let bestScore = -Infinity;
  for (let y = baseY - 8; y <= baseY + 8; y++) {
    const candidate = buildLowerTwoRowRailGridRun(row.rightX, y, pitch, baseSize, boxes, row, ctx);
    if (candidate.length < Math.max(4, Math.min(row.sorted.length, 6))) continue;
    const score = mean(candidate.map((box) => box.score)) + candidate.length * 18 - Math.abs(y - baseY) * 1.2;
    if (score > bestScore) {
      bestScore = score;
      bestRow = candidate;
    }
  }

  if (bestRow.length === 0) return boxes;
  const topRow = stabilizeTwoRowRailGridY(
    row.sorted.map((box) => ({
      ...box,
      x: Math.round(box.x),
      y: row.rowY,
      size: baseSize,
    })),
    ctx.maps,
    ctx.roi,
  );
  return [...topRow, ...bestRow].slice(0, ctx.maxIcons);
}

function buildLowerTwoRowRailGridRun(
  targetRightX: number,
  y: number,
  pitch: number,
  baseSize: number,
  boxes: BuffIconBox[],
  sourceRow: NonNullable<ReturnType<typeof describePitchRow>>,
  ctx: DetectionContext,
) {
  const { maps, roi, image } = ctx;
  const rowScore = median(sourceRow.sorted.map((box) => box.score));
  const acceptScore = Math.max(rowCellThreshold(baseSize) + 54, rowScore * 0.5, 158);
  const run: BuffIconBox[] = [];

  for (let step = 0; step < 13; step++) {
    const predictedX = Math.round(targetRightX - pitch * step);
    const direct: BuffIconBox = { x: predictedX, y, size: baseSize, score: 0, confidence: 0 };
    if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
    if ([...boxes, ...run].some((box) => iou(box, direct) > 0.22)) break;

    const directScore = scoreTightSlot(maps, predictedX - roi.x, y - roi.y, baseSize).score;
    const refined = refineTightCell(predictedX, y, baseSize, maps, roi, Math.round(baseSize * 0.34));
    const closeToSlot =
      refined && Math.abs(refined.x - predictedX) <= baseSize * 0.46 && Math.abs(refined.y - y) <= baseSize * 0.5;
    const score = Math.max(directScore, closeToSlot ? refined.score : 0);
    const quality = cropQuality(image, direct);
    const visualBacked =
      (quality.edge >= 24 && quality.bright <= 0.58) ||
      hasLikelyBuffFrame(image, direct) ||
      hasNearbyLikelyBuffFrame(image, direct) ||
      hasVisibleRightRailControl(image, direct) ||
      Boolean(refined && closeToSlot && (hasLikelyBuffFrame(image, refined) || hasNearbyLikelyBuffFrame(image, refined)));
    if (score < acceptScore || !visualBacked) break;

    run.push(fitTwoRowRailGridCell({
      ...(refined && closeToSlot ? refined : direct),
      x: predictedX,
      y,
      size: baseSize,
      score: Math.max(score, 190),
      confidence: Math.max(refined?.confidence ?? 0, 0.72),
    }, maps, roi));
  }

  return stabilizeTwoRowRailGridY(run.reverse(), maps, roi);
}

function completeTwoRowRailGridRow(
  row: NonNullable<ReturnType<typeof describePitchRow>>,
  targetRightX: number,
  pitch: number,
  baseSize: number,
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image } = ctx;
  const run: BuffIconBox[] = [];
  const existing = [...row.sorted].sort((a, b) => a.x - b.x);
  const rowScore = median(existing.map((box) => box.score));
  const acceptScore = Math.max(rowCellThreshold(baseSize) + 54, rowScore * 0.52, 158);

  for (let step = 0; step < 13; step++) {
    const predictedX = Math.round(targetRightX - pitch * step);
    const direct: BuffIconBox = { x: predictedX, y: row.rowY, size: baseSize, score: 0, confidence: 0 };
    if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;

    const existingBox = existing.find(
      (box) =>
        Math.abs(box.x - predictedX) <= Math.max(4, baseSize * 0.45) &&
        Math.abs(box.y - row.rowY) <= Math.max(4, baseSize * 0.34) &&
        !run.some((used) => used === box),
    );
    if (existingBox) {
      run.push(fitTwoRowRailGridCell({
        ...existingBox,
        x: Math.round(existingBox.x),
        y: Math.round(existingBox.y),
        size: baseSize,
      }, maps, roi));
      continue;
    }

    if ([...boxes, ...run].some((box) => iou(box, direct) > 0.22)) continue;

    const directScore = scoreTightSlot(maps, predictedX - roi.x, row.rowY - roi.y, baseSize).score;
    const refined = refineTightCell(predictedX, row.rowY, baseSize, maps, roi, Math.round(baseSize * 0.34));
    const closeToSlot =
      refined && Math.abs(refined.x - predictedX) <= baseSize * 0.46 && Math.abs(refined.y - row.rowY) <= baseSize * 0.5;
    const score = Math.max(directScore, closeToSlot ? refined.score : 0);
    const quality = cropQuality(image, direct);
    const visualBacked =
      (quality.edge >= 24 && quality.bright <= 0.58) ||
      hasLikelyBuffFrame(image, direct) ||
      hasNearbyLikelyBuffFrame(image, direct) ||
      hasVisibleRightRailControl(image, direct) ||
      Boolean(refined && closeToSlot && (hasLikelyBuffFrame(image, refined) || hasNearbyLikelyBuffFrame(image, refined)));
    if (score < acceptScore || !visualBacked) break;

    run.push(fitTwoRowRailGridCell({
      ...(refined && closeToSlot ? refined : direct),
      x: predictedX,
      y: row.rowY,
      size: baseSize,
      score: Math.max(score, 190),
      confidence: Math.max(refined?.confidence ?? 0, 0.72),
    }, maps, roi));
  }

  return stabilizeTwoRowRailGridY(run.reverse(), maps, roi);
}

function fitTwoRowRailGridCell(box: BuffIconBox, maps: DetectionContext["maps"], roi: DetectionContext["roi"]) {
  const size = Math.round(box.size);
  let best = { ...box, x: Math.round(box.x), y: Math.round(box.y), size };
  let bestScore = scoreTightSlot(maps, best.x - roi.x, best.y - roi.y, size).score;

  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const x = Math.round(box.x + dx);
      const y = Math.round(box.y + dy);
      if (x < roi.x || y < roi.y || x + size > roi.x + roi.width || y + size > roi.y + roi.height) continue;
      const score = scoreTightSlot(maps, x - roi.x, y - roi.y, size).score - (Math.abs(dx) + Math.abs(dy)) * 0.45;
      if (score > bestScore) {
        best = {
          ...box,
          x,
          y,
          size,
          score: Math.max(box.score, score),
          confidence: Math.max(box.confidence, 0.72),
        };
        bestScore = score;
      }
    }
  }

  return best;
}

function stabilizeTwoRowRailGridY(row: BuffIconBox[], maps: DetectionContext["maps"], roi: DetectionContext["roi"]) {
  if (row.length < 2) return row;
  const baseY = Math.round(median(row.map((box) => box.y)));
  const size = Math.round(median(row.map((box) => box.size)));
  let bestY = baseY;
  let bestScore = -Infinity;

  for (let y = baseY - 4; y <= baseY + 4; y++) {
    if (y < roi.y || y + size > roi.y + roi.height) continue;
    const score =
      mean(row.map((box) => scoreTightSlot(maps, Math.round(box.x) - roi.x, y - roi.y, size).score)) -
      Math.abs(y - baseY) * 0.8;
    if (score > bestScore) {
      bestScore = score;
      bestY = y;
    }
  }

  return row.map((box) => ({
    ...box,
    y: bestY,
    size,
    score: Math.max(box.score, scoreTightSlot(maps, Math.round(box.x) - roi.x, bestY - roi.y, size).score),
  }));
}

export function completeRowsToSharedRightEdge(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 6) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const pitchRows = rows
    .map((row) => describePitchRow(row))
    .filter((row): row is NonNullable<ReturnType<typeof describePitchRow>> => Boolean(row));
  if (pitchRows.length < 2) return boxes;

  const baseSize = Math.round(median(pitchRows.map((row) => row.size)));
  const basePitch = Math.round(median(pitchRows.map((row) => row.pitch)));
  const compatibleRows = pitchRows.filter(
    (row) =>
      Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12) &&
      Math.abs(row.pitch - basePitch) <= Math.max(3, baseSize * 0.14),
  );
  if (compatibleRows.length < 2) return boxes;

  const rightMarginLimit = Math.round(Math.max(42, baseSize * 1.35));
  const targetRows = compatibleRows.filter((row) => row.sorted.length >= 3 && image.width - (row.rightX + row.size) <= rightMarginLimit);
  if (targetRows.length === 0) return boxes;
  const targetRightX = Math.max(...targetRows.map((row) => row.rightX));
  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];

  for (const row of compatibleRows) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length < 3) continue;
    if (targetRightX - row.rightX < row.pitch * 0.55) continue;

    const targetSlot = Math.round((targetRightX - row.anchor) / row.pitch);
    const targetX = Math.round(row.anchor + targetSlot * row.pitch);
    if (Math.abs(targetX - targetRightX) > Math.max(6, row.size * 0.34)) continue;
    if (targetSlot <= row.maxSlot || targetSlot - row.maxSlot > 6) continue;
    if (targetSlot - row.minSlot > 14) continue;

    const occupied = new Set(row.slots);
    const rowScore = median(row.sorted.map((box) => box.score));
    const smallTopRow = row.size < 40 && row.rowY - roi.y <= Math.max(7, row.size * 0.28);
    const acceptScore = Math.max(
      smallTopRow ? minScore - 10 : minScore,
      rowCellThreshold(row.size) + (smallTopRow ? 28 : row.size < 40 ? 34 : 42),
      rowScore * (smallTopRow ? 0.72 : row.size < 40 ? 0.82 : 0.62),
    );
    let misses = 0;

    for (let slot = row.minSlot + 1; slot <= targetSlot; slot++) {
      if (boxes.length + additions.length >= maxIcons) break;
      if (occupied.has(slot)) continue;

      const internalGap = slot < row.maxSlot;
      const supportedGap =
        !internalGap ||
        (hasOccupiedSlotNear(occupied, slot, -1, row.minSlot) && hasOccupiedSlotNear(occupied, slot, 1, row.maxSlot));
      if (!supportedGap) continue;

      const predictedX = Math.round(row.anchor + slot * row.pitch);
      const direct: BuffIconBox = { x: predictedX, y: row.rowY, size: row.size, score: 0, confidence: 0 };
      if (direct.x < 0 || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) continue;
      if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

      const refined = refineTightCell(predictedX, row.rowY, row.size, maps, roi, Math.round(row.size * 0.34));
      const closeToSlot =
        refined && Math.abs(refined.x - predictedX) <= row.size * 0.36 && Math.abs(refined.y - row.rowY) <= row.size * 0.34;
      if (!refined || refined.score < acceptScore || !closeToSlot) {
        if (!internalGap) {
          misses++;
          if (misses >= 1) break;
        }
        continue;
      }

      additions.push({
        ...refined,
        x: Math.round(refined.x),
        y: row.rowY,
        size: row.size,
        score: Math.max(refined.score, minScore),
        confidence: Math.max(refined.confidence, 0.72),
      });
      occupied.add(slot);
      misses = 0;
    }
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}

export function completeStrongRowLeftEdges(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 8) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const allPitchRows = rows
    .map((row) => describePitchRow(row))
    .filter((row): row is NonNullable<ReturnType<typeof describePitchRow>> => Boolean(row));
  const pitchRows = allPitchRows
    .filter(
      (row) =>
        (row.size >= 52 && row.sorted.length >= 6) ||
        (row.size >= 28 && row.size < 40 && row.sorted.length >= 5 && row.rowY - roi.y <= Math.max(7, row.size * 0.28)) ||
        isSupportedSmallRightAlignedRow(row, allPitchRows, roi) ||
        isSupportedShortRightRailRow(row, allPitchRows),
    );
  if (pitchRows.length === 0) return boxes;

  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];
  for (const row of pitchRows) {
    if (boxes.length + additions.length >= maxIcons) break;

    const frameCount = row.sorted.filter((box) => hasLikelyBuffFrame(image, box)).length;
    if (frameCount < Math.max(3, Math.ceil(row.sorted.length * 0.3))) continue;

    const occupied = new Set(row.slots);
    const rowScore = median(row.sorted.map((box) => box.score));
    const smallTopRow = row.size < 40 && row.rowY - roi.y <= Math.max(7, row.size * 0.28);
    const smallSupportedRow = !smallTopRow && isSupportedSmallRightAlignedRow(row, allPitchRows, roi);
    const shortRightRailRow = isSupportedShortRightRailRow(row, allPitchRows);
    const acceptScore = smallTopRow
      ? Math.max(minScore - 8, rowCellThreshold(row.size) + 58, rowScore * 0.7)
      : smallSupportedRow
        ? Math.max(minScore - 8, rowCellThreshold(row.size) + 44, rowScore * 0.8)
        : shortRightRailRow
          ? Math.max(minScore, rowCellThreshold(row.size) + 58, rowScore * 0.62)
          : Math.max(minScore, rowCellThreshold(row.size) + 74, rowScore * 0.78);
    let misses = 0;

    const maxSteps = shortRightRailRow ? 2 : smallSupportedRow ? 1 : 4;
    for (let step = 1; step <= maxSteps; step++) {
      if (boxes.length + additions.length >= maxIcons) break;
      const slot = row.minSlot - step;
      const predictedX = Math.round(row.anchor + slot * row.pitch);
      const direct: BuffIconBox = { x: predictedX, y: row.rowY, size: row.size, score: 0, confidence: 0 };
      if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
      if (occupied.has(slot) || [...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;
      if (shortRightRailRow && supportedColumnCount(predictedX, row, allPitchRows) < 2) break;
      if (smallSupportedRow && supportedColumnCount(predictedX, row, allPitchRows) < 1) break;

      const refined = refineTightCell(predictedX, row.rowY, row.size, maps, roi, Math.round(row.size * 0.28));
      const closeToSlot =
        refined && Math.abs(refined.x - predictedX) <= row.size * 0.3 && Math.abs(refined.y - row.rowY) <= row.size * 0.3;
      const strongSmallTopCell = Boolean(refined && smallTopRow && refined.score >= Math.max(230, rowScore * 0.88));
      const strongSmallSupportedCell = Boolean(refined && smallSupportedRow && refined.score >= Math.max(205, rowScore * 0.8));
      const directScore = smallTopRow ? scoreTightSlot(maps, predictedX - roi.x, row.rowY - roi.y, row.size).score : 0;
      const strongDirectSmallTopCell =
        smallTopRow && hasLikelyBuffFrame(image, direct) && directScore >= acceptScore && directScore >= rowScore * 0.74;
      const frameOk = Boolean(
        refined && (hasLikelyBuffFrame(image, refined) || strongSmallTopCell || strongSmallSupportedCell || strongDirectSmallTopCell),
      );
      if (!refined || refined.score < acceptScore || !closeToSlot || !frameOk) {
        misses++;
        if (misses >= 1) break;
        continue;
      }

      additions.push({
        ...refined,
        x: smallTopRow || smallSupportedRow ? predictedX : Math.round(refined.x),
        y: smallTopRow || smallSupportedRow ? row.rowY : Math.round(refined.y),
        size: smallTopRow || smallSupportedRow ? row.size : Math.round(refined.size),
        score: Math.max(refined.score, minScore),
        confidence: Math.max(refined.confidence, 0.74),
      });
      occupied.add(slot);
      misses = 0;
    }
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}

export function completeCompactDenseRowLeftVisualEdges(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 12) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const pitchRows = rows
    .map((row) => describePitchRow(row))
    .filter((row): row is NonNullable<ReturnType<typeof describePitchRow>> => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  if (pitchRows.length < 3) return boxes;

  const baseSize = Math.round(median(pitchRows.map((row) => row.size)));
  if (baseSize < 28 || baseSize > 46) return boxes;
  if (baseSize > 42 && roi.y <= 0) return boxes;
  const sourceTopClipped = rows.some((row) => {
    const rowY = Math.round(median(row.map((box) => box.y)));
    const rowSize = Math.round(median(row.map((box) => box.size)));
    return row.length >= 4 && rowY <= Math.max(8, rowSize * 0.3) && Math.abs(rowSize - baseSize) <= Math.max(3, baseSize * 0.12);
  });

  const compatibleRows = pitchRows.filter(
    (row) =>
      Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12) &&
      image.width - (row.rightX + row.size) <= Math.max(40, baseSize * 1.5),
  );
  if (compatibleRows.length < 3) return boxes;

  const maxRowLength = Math.max(...compatibleRows.map((row) => row.sorted.length));
  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];

  for (const row of compatibleRows) {
    if (boxes.length + additions.length >= maxIcons) break;
    const localRowY = baseSize > 42 ? row.rowY - roi.y : row.rowY;
    const sourceTopClippedLowerDense = sourceTopClipped && baseSize <= 42 && localRowY >= baseSize * 3 && localRowY <= baseSize * 4.4;
    if (row.sorted.length < (sourceTopClippedLowerDense ? 5 : 9) || row.sorted.length >= 13) continue;
    if (!sourceTopClippedLowerDense && row.sorted.length < maxRowLength - 1) continue;
    if (!sourceTopClippedLowerDense && localRowY > Math.max(56, baseSize * 1.7)) continue;
    if (localRowY <= Math.max(8, baseSize * 0.32)) continue;

    const rightEdge = row.rightX + row.size;
    const supportRows = compatibleRows.filter((other) => {
      if (other === row) return false;
      if (Math.abs(other.rightX + other.size - rightEdge) > baseSize * 0.65) return false;
      return other.sorted.length >= 3 && (sourceTopClippedLowerDense || other.sorted.length <= row.sorted.length);
    });
    if (supportRows.length < 2) continue;
    if (!sourceTopClippedLowerDense && !supportRows.some((other) => other.sorted.length <= row.sorted.length - 2)) continue;

    const rowScore = median(row.sorted.map((box) => box.score));
    const acceptScore = sourceTopClippedLowerDense
      ? Math.max(minScore - 45, rowCellThreshold(row.size) + 26, rowScore * 0.45)
      : Math.max(minScore - 25, rowCellThreshold(row.size) + 38, rowScore * 0.5);
    const occupied = new Set(row.slots);
    const maxSteps = sourceTopClippedLowerDense ? Math.min(2, 9 - row.sorted.length) : Math.min(2, 13 - row.sorted.length);

    for (let step = 1; step <= maxSteps; step++) {
      if (boxes.length + additions.length >= maxIcons) break;
      const slot = row.minSlot - step;
      if (occupied.has(slot)) continue;
      const predictedX = Math.round(row.anchor + slot * row.pitch);
      const direct: BuffIconBox = { x: predictedX, y: row.rowY, size: row.size, score: 0, confidence: 0 };
      if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
      if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

      const directScore = scoreTightSlot(maps, predictedX - roi.x, row.rowY - roi.y, row.size).score;
      const refined = refineTightCell(predictedX, row.rowY, row.size, maps, roi, Math.round(row.size * 0.26));
      const closeToSlot =
        refined && Math.abs(refined.x - predictedX) <= row.size * 0.34 && Math.abs(refined.y - row.rowY) <= row.size * 0.32;
      const score = Math.max(directScore, closeToSlot ? refined.score : 0);
      const frameOk =
        hasLikelyBuffFrame(image, direct) ||
        Boolean(refined && closeToSlot && hasLikelyBuffFrame(image, refined)) ||
        score >= acceptScore + (sourceTopClippedLowerDense ? 0 : 0);
      if (!refined || !closeToSlot || score < acceptScore || !frameOk) break;

      additions.push({
        ...refined,
        x: Math.round(refined.x),
        y: row.rowY,
        size: row.size,
        score: Math.max(score, minScore),
        confidence: Math.max(refined.confidence, 0.74),
      });
      occupied.add(slot);
    }
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}

export function completeCompactDenseRowInternalVisualGaps(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 12) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const pitchRows = rows
    .map((row) => describePitchRow(row))
    .filter((row): row is NonNullable<ReturnType<typeof describePitchRow>> => Boolean(row));
  if (pitchRows.length < 3) return boxes;

  const baseSize = Math.round(median(pitchRows.map((row) => row.size)));
  if (baseSize < 28 || baseSize > 42) return boxes;
  const sourceTopClipped = rows.some((row) => {
    const rowY = Math.round(median(row.map((box) => box.y)));
    const rowSize = Math.round(median(row.map((box) => box.size)));
    return (
      row.length >= 4 &&
      rowY - roi.y <= Math.max(8, rowSize * 0.3) &&
      Math.abs(rowSize - baseSize) <= Math.max(3, baseSize * 0.12)
    );
  });
  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];

  for (const row of pitchRows) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.size < 28 || row.size > 42 || Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12)) continue;
    const topClippedRow = row.rowY <= Math.max(8, baseSize * 0.3);
    const sourceTopClippedLowerDense = sourceTopClipped && row.rowY >= baseSize * 3 && row.sorted.length >= 3;
    if (row.sorted.length < (topClippedRow || sourceTopClippedLowerDense ? 3 : 6) || row.sorted.length > 12) continue;
    if (image.width - (row.rightX + row.size) > Math.max(40, baseSize * 1.5)) continue;

    const occupied = new Set(row.slots);
    const missingSlots: number[] = [];
    for (let slot = row.minSlot + 1; slot < row.maxSlot; slot++) {
      if (!occupied.has(slot) && occupied.has(slot - 1) && occupied.has(slot + 1)) missingSlots.push(slot);
    }
    if (missingSlots.length === 0 || missingSlots.length > 3) continue;

    const rowScore = median(row.sorted.map((box) => box.score));
    const acceptScore = sourceTopClippedLowerDense
      ? Math.max(minScore - 45, rowCellThreshold(row.size) + 26, rowScore * 0.45)
      : Math.max(minScore - 20, rowCellThreshold(row.size) + (topClippedRow ? 34 : 40), rowScore * 0.54);
    for (const slot of missingSlots) {
      if (boxes.length + additions.length >= maxIcons) break;
      const predictedX = Math.round(row.anchor + slot * row.pitch);
      const direct: BuffIconBox = { x: predictedX, y: row.rowY, size: row.size, score: 0, confidence: 0 };
      if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) continue;
      if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

      const directScore = scoreTightSlot(maps, predictedX - roi.x, row.rowY - roi.y, row.size).score;
      const refined = refineTightCell(predictedX, row.rowY, row.size, maps, roi, Math.round(row.size * 0.28));
      const closeToSlot =
        refined && Math.abs(refined.x - predictedX) <= row.size * 0.34 && Math.abs(refined.y - row.rowY) <= row.size * 0.34;
      const score = Math.max(directScore, closeToSlot ? refined.score : 0);
      const topAttached = !topClippedRow || Boolean(refined && refined.y <= row.rowY + Math.max(3, row.size * 0.16));
      const frameOk =
        hasLikelyBuffFrame(image, direct) ||
        Boolean(refined && closeToSlot && hasLikelyBuffFrame(image, refined)) ||
        score >= acceptScore + (sourceTopClippedLowerDense ? 0 : 2);
      if (!refined || !closeToSlot || !topAttached || score < acceptScore || !frameOk) continue;

      additions.push({
        ...refined,
        x: Math.round(refined.x),
        y: row.rowY,
        size: row.size,
        score: Math.max(score, minScore),
        confidence: Math.max(refined.confidence, 0.72),
      });
      occupied.add(slot);
    }

    if (boxes.length + additions.length >= maxIcons) continue;
    if (row.sorted.length === 12 && row.maxSlot - row.minSlot <= 12) {
      const slot = row.minSlot - 1;
      if (!occupied.has(slot)) {
        const predictedX = Math.round(row.anchor + slot * row.pitch);
        const direct: BuffIconBox = { x: predictedX, y: row.rowY, size: row.size, score: 0, confidence: 0 };
        if (
          direct.x >= roi.x &&
          direct.x + direct.size <= image.width &&
          direct.y >= 0 &&
          direct.y + direct.size <= image.height &&
          ![...boxes, ...additions].some((box) => iou(box, direct) > 0.22)
        ) {
          const directScore = scoreTightSlot(maps, predictedX - roi.x, row.rowY - roi.y, row.size).score;
          const refined = refineTightCell(predictedX, row.rowY, row.size, maps, roi, Math.round(row.size * 0.34));
          const closeToSlot =
            refined && Math.abs(refined.x - predictedX) <= row.size * 0.42 && Math.abs(refined.y - row.rowY) <= row.size * 0.46;
          const score = Math.max(directScore, closeToSlot ? refined.score : 0);
          const strongLeftCell =
            Boolean(refined && closeToSlot) &&
            score >= Math.max(minScore + 35, rowScore * 1.08) &&
            (hasLikelyBuffFrame(image, direct) ||
              hasNearbyLikelyBuffFrame(image, direct) ||
              hasLikelyBuffFrame(image, refined!) ||
              score >= Math.max(minScore + 48, rowScore * 1.18));
          if (strongLeftCell) {
            additions.push({
              ...refined!,
              x: Math.round(refined!.x),
              y: row.rowY,
              size: row.size,
              score: Math.max(score, minScore),
              confidence: Math.max(refined!.confidence, 0.74),
            });
            occupied.add(slot);
          }
        }
      }
    }
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}

export function completeCompactDenseInternalLocalPitchGaps(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (!isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;
  if (boxes.length >= maxIcons || boxes.length < 12) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const pitchRows = rows
    .map((row) => describePitchRow(row))
    .filter((row): row is NonNullable<ReturnType<typeof describePitchRow>> => Boolean(row));
  if (pitchRows.length < 3) return boxes;

  const baseSize = Math.round(median(pitchRows.map((row) => row.size)));
  if (baseSize < 28 || baseSize > 42) return boxes;
  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];

  for (const row of pitchRows) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length < 6 || row.sorted.length >= 13) continue;
    if (Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12)) continue;

    const occupied = new Set(row.slots);
    const missingSlots: number[] = [];
    for (let slot = row.minSlot + 1; slot < row.maxSlot; slot++) {
      if (occupied.has(slot)) continue;
      if (!hasOccupiedSlotNear(occupied, slot, -1, row.minSlot)) continue;
      if (!hasOccupiedSlotNear(occupied, slot, 1, row.maxSlot)) continue;
      missingSlots.push(slot);
    }
    if (missingSlots.length > 4) continue;
    if (row.sorted.length + missingSlots.length > 13) continue;

    const rowScore = median(row.sorted.map((box) => box.score));
    const acceptScore = Math.max(minScore - 28, rowCellThreshold(row.size) + 24, rowScore * 0.62);
    for (const slot of missingSlots) {
      if (boxes.length + additions.length >= maxIcons) break;
      const predictedX = Math.round(row.anchor + slot * row.pitch);
      const direct: BuffIconBox = { x: predictedX, y: row.rowY, size: row.size, score: 0, confidence: 0 };
      if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) continue;
      if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

      const directScore = scoreTightSlot(maps, predictedX - roi.x, row.rowY - roi.y, row.size).score;
      const refined = refineTightCell(predictedX, row.rowY, row.size, maps, roi, Math.round(row.size * 0.34));
      const closeToSlot =
        refined && Math.abs(refined.x - predictedX) <= row.size * 0.42 && Math.abs(refined.y - row.rowY) <= row.size * 0.46;
      const score = Math.max(directScore, closeToSlot ? refined.score : 0);
      const visualBacked =
        hasLikelyBuffFrame(image, direct) ||
        hasNearbyLikelyBuffFrame(image, direct) ||
        Boolean(refined && closeToSlot && (hasLikelyBuffFrame(image, refined) || hasNearbyLikelyBuffFrame(image, refined))) ||
        (isTextOverlayFragment(image, direct) && score >= acceptScore - 12) ||
        score >= acceptScore + 10;
      if (!refined || !closeToSlot || score < acceptScore || !visualBacked) continue;

      additions.push({
        ...refined,
        x: Math.round(refined.x),
        y: row.rowY,
        size: row.size,
        score: Math.max(score, minScore),
        confidence: Math.max(refined.confidence, 0.72),
      });
      occupied.add(slot);
    }
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions].slice(0, maxIcons);
}

export function completeCompactShortRailLeftVisualEdges(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 10) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const grid = estimateGlobalGrid(rows);
  if (!grid || grid.size < 28 || grid.size > 42) return boxes;

  const rowInfos = rows
    .map((row) => describeGridRow(row, grid))
    .filter((row): row is GridRowInfo => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  if (rowInfos.length < 3) return boxes;

  const baseSize = grid.size;
  const sourceTopClipped = rows.some((row) => {
    const rowY = Math.round(median(row.map((box) => box.y)));
    const rowSize = Math.round(median(row.map((box) => box.size)));
    return row.length >= 4 && rowY <= Math.max(8, rowSize * 0.3) && Math.abs(rowSize - baseSize) <= Math.max(3, baseSize * 0.12);
  });
  if (!sourceTopClipped) return boxes;

  const targetRightSlot = estimateConsensusRightSlot(rowInfos) ?? Math.max(...rowInfos.map((row) => row.maxSlot));
  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];

  for (const row of rowInfos) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length < 1 || row.sorted.length > 4) continue;
    if (row.snapRatio < 0.62 || Math.abs(row.rowSize - baseSize) > Math.max(3, baseSize * 0.12)) continue;
    if (row.rowY <= Math.max(8, baseSize * 0.3)) continue;
    if (targetRightSlot - row.maxSlot > 1) continue;

    const occupied = new Set(row.slots);
    const minSlot = Math.min(...row.slots);
    const rowScore = median(row.sorted.map((box) => box.score));
    const acceptScore = Math.max(minScore - 20, rowCellThreshold(row.rowSize) + 42, rowScore * 0.54);
    const maxSteps = Math.min(3, 4 - row.sorted.length);

    for (let step = 1; step <= maxSteps; step++) {
      if (boxes.length + additions.length >= maxIcons) break;
      const slot = minSlot - step;
      const predictedX = Math.round(grid.anchor + slot * grid.pitch);
      const direct: BuffIconBox = { x: predictedX, y: row.rowY, size: row.rowSize, score: 0, confidence: 0 };
      if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
      if (occupied.has(slot) || [...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

      const directScore = scoreTightSlot(maps, predictedX - roi.x, row.rowY - roi.y, row.rowSize).score;
      const refined = refineTightCell(predictedX, row.rowY, row.rowSize, maps, roi, Math.round(row.rowSize * 0.32));
      const closeToSlot =
        refined && Math.abs(refined.x - predictedX) <= row.rowSize * 0.42 && Math.abs(refined.y - row.rowY) <= row.rowSize * 0.42;
      const score = Math.max(directScore, closeToSlot ? refined.score : 0);
      const frameOk =
        hasLikelyBuffFrame(image, direct) ||
        Boolean(refined && closeToSlot && hasLikelyBuffFrame(image, refined)) ||
        score >= acceptScore + 8;
      if (!refined || !closeToSlot || score < acceptScore || !frameOk) break;

      additions.push({
        ...refined,
        x: Math.round(refined.x),
        y: row.rowY,
        size: row.rowSize,
        score: Math.max(score, minScore),
        confidence: Math.max(refined.confidence, 0.72),
      });
      occupied.add(slot);
    }
  }

  for (const rawRow of rows) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (rawRow.length < 1 || rawRow.length > 2) continue;
    const sorted = [...rawRow].sort((a, b) => a.x - b.x);
    const rowY = Math.round(median(sorted.map((box) => box.y)));
    const rowSize = Math.round(median(sorted.map((box) => box.size)));
    if (rowSize < 28 || rowSize > 42 || Math.abs(rowSize - baseSize) > Math.max(3, baseSize * 0.12)) continue;
    if (rowY <= Math.max(8, baseSize * 0.3)) continue;
    const slots = sorted.map((box) => Math.round((box.x - grid.anchor) / grid.pitch));
    const maxSlot = Math.max(...slots);
    const minSlot = Math.min(...slots);
    if (targetRightSlot - maxSlot > 1) continue;

    const belowSupport = rowInfos.some(
      (row) =>
        row.sorted.length >= 3 &&
        row.rowY > rowY + baseSize * 0.65 &&
        row.rowY <= rowY + baseSize * 1.7,
    );
    if (!belowSupport) continue;

    const occupied = new Set(slots);
    const rowScore = median(sorted.map((box) => box.score));
    const acceptScore = Math.max(minScore - 20, rowCellThreshold(rowSize) + 42, rowScore * 0.54);
    const maxSteps = Math.min(3, 4 - sorted.length);
    for (let step = 1; step <= maxSteps; step++) {
      if (boxes.length + additions.length >= maxIcons) break;
      const slot = minSlot - step;
      const predictedX = Math.round(grid.anchor + slot * grid.pitch);
      const direct: BuffIconBox = { x: predictedX, y: rowY, size: rowSize, score: 0, confidence: 0 };
      if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
      if (occupied.has(slot) || [...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

      const directScore = scoreTightSlot(maps, predictedX - roi.x, rowY - roi.y, rowSize).score;
      const refined = refineTightCell(predictedX, rowY, rowSize, maps, roi, Math.round(rowSize * 0.32));
      const closeToSlot =
        refined && Math.abs(refined.x - predictedX) <= rowSize * 0.42 && Math.abs(refined.y - rowY) <= rowSize * 0.42;
      const score = Math.max(directScore, closeToSlot ? refined.score : 0);
      const frameOk =
        hasLikelyBuffFrame(image, direct) ||
        Boolean(refined && closeToSlot && hasLikelyBuffFrame(image, refined)) ||
        score >= acceptScore + 8;
      if (!refined || !closeToSlot || score < acceptScore || !frameOk) break;

      additions.push({
        ...refined,
        x: Math.round(refined.x),
        y: rowY,
        size: rowSize,
        score: Math.max(score, minScore),
        confidence: Math.max(refined.confidence, 0.72),
      });
      occupied.add(slot);
    }
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}

export function completeCompactPartialRowsToRightRail(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 10) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const grid = estimateGlobalGrid(rows);
  if (!grid || grid.size < 28 || grid.size > 42) return boxes;

  const rowInfos = rows
    .map((row) => describeGridRow(row, grid))
    .filter((row): row is GridRowInfo => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  if (rowInfos.length < 3) return boxes;

  const baseSize = grid.size;
  const targetRightSlot = estimateConsensusRightSlot(rowInfos) ?? Math.max(...rowInfos.map((row) => row.maxSlot));
  const rightRailSupport = rowInfos.filter(
    (row) =>
      row.sorted.length <= 4 &&
      row.maxSlot >= targetRightSlot - 1 &&
      row.snapRatio >= 0.62 &&
      row.rowY > baseSize * 1.6,
  );
  const rawRightRailSupport = rows
    .filter((row) => row.length <= 2)
    .map((row) => {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      const rowY = Math.round(median(sorted.map((box) => box.y)));
      const rowSize = Math.round(median(sorted.map((box) => box.size)));
      const maxSlot = Math.max(...sorted.map((box) => Math.round((box.x - grid.anchor) / grid.pitch)));
      return { rowY, rowSize, maxSlot };
    })
    .filter(
      (row) =>
        row.rowSize >= 28 &&
        row.rowSize <= 42 &&
        Math.abs(row.rowSize - baseSize) <= Math.max(3, baseSize * 0.12) &&
        row.maxSlot >= targetRightSlot - 1 &&
        row.rowY > baseSize * 1.6,
    );
  if (rightRailSupport.length === 0 && rawRightRailSupport.length === 0) return boxes;

  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];
  for (const row of rowInfos) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length < 3 || row.sorted.length > 12) continue;
    const shortPartialRow = row.sorted.length <= 5 && row.maxSlot < targetRightSlot - 1 && targetRightSlot - row.maxSlot <= 6;
    const longRightEdgeRow = row.sorted.length >= 6 && row.maxSlot === targetRightSlot - 1;
    if (!shortPartialRow && !longRightEdgeRow) continue;
    if (row.rowY <= baseSize * 2.2) continue;
    if (row.snapRatio < 0.62 || Math.abs(row.rowSize - baseSize) > Math.max(3, baseSize * 0.12)) continue;

    const supportNearby =
      rightRailSupport.some((support) => Math.abs(support.rowY - row.rowY) <= baseSize * 2.5) ||
      rawRightRailSupport.some((support) => Math.abs(support.rowY - row.rowY) <= baseSize * 2.5);
    if (!supportNearby) continue;

    const occupied = new Set(row.slots);
    const rowScore = median(row.sorted.map((box) => box.score));
    const acceptScore = Math.max(minScore - 45, rowCellThreshold(row.rowSize) + 34, rowScore * 0.56);
    const minSlot = Math.min(...row.slots);
    const candidateSlots = longRightEdgeRow
      ? [targetRightSlot]
      : [minSlot - 1, ...Array.from({ length: targetRightSlot - row.maxSlot }, (_, index) => row.maxSlot + index + 1)];

    for (const slot of candidateSlots) {
      if (boxes.length + additions.length >= maxIcons) break;
      if (occupied.has(slot)) continue;
      const predictedX = Math.round(grid.anchor + slot * grid.pitch);
      const direct: BuffIconBox = { x: predictedX, y: row.rowY, size: row.rowSize, score: 0, confidence: 0 };
      if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) continue;
      if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

      const directScore = scoreTightSlot(maps, predictedX - roi.x, row.rowY - roi.y, row.rowSize).score;
      const refined = refineTightCell(predictedX, row.rowY, row.rowSize, maps, roi, Math.round(row.rowSize * 0.34));
      const closeToSlot =
        refined && Math.abs(refined.x - predictedX) <= row.rowSize * 0.42 && Math.abs(refined.y - row.rowY) <= row.rowSize * 0.46;
      const score = Math.max(directScore, closeToSlot ? refined.score : 0);
      const frameOk =
        hasLikelyBuffFrame(image, direct) ||
        Boolean(refined && closeToSlot && hasLikelyBuffFrame(image, refined)) ||
        score >= acceptScore + 4;
      if (!refined || !closeToSlot || score < acceptScore || !frameOk) continue;

      additions.push({
        ...refined,
        x: longRightEdgeRow ? predictedX : Math.round(refined.x),
        y: row.rowY,
        size: longRightEdgeRow ? row.rowSize : row.rowSize,
        score: Math.max(score, minScore),
        confidence: Math.max(refined.confidence, 0.7),
      });
      occupied.add(slot);
    }
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}

export function pruneWeakTopLeftVisualExtensions(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image } = ctx;
  if (boxes.length < 8) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const remove = new Set<BuffIconBox>();

  for (const row of rows) {
    if (row.length < 5) continue;
    const sorted = [...row].sort((a, b) => a.x - b.x);
    const rowY = Math.round(median(sorted.map((box) => box.y)));
    const rowSize = Math.round(median(sorted.map((box) => box.size)));
    if (rowY > Math.max(8, rowSize * 0.3) || rowSize < 28 || rowSize > 42) continue;

    const first = sorted[0]!;
    const second = sorted[1]!;
    const gap = second.x - first.x;
    if (gap < rowSize * 0.72 || gap > rowSize * 1.38) continue;

    const suffix = sorted.slice(1);
    const firstQuality = cropQuality(image, first);
    const lowerColumnSupported =
      countRightAlignedLowerColumnSupport(rows, row, first, rowSize) >= 2 &&
      isSupportedCompactTopLeftVisual(first.x, first.y, first.size, maps, roi, image);
    const lowDetailTopPrefix =
      sorted.length >= 6 &&
      sorted.length <= 10 &&
      hasStableFinalSuffixPitch(suffix, rowSize) &&
      hasRightAlignedFinalLowerRow(rows, row, sorted, suffix, rowSize) &&
      !lowerColumnSupported &&
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

    const flatDarkEffectPrefix =
      sorted.length >= 7 &&
      sorted.length <= 10 &&
      hasStableFinalSuffixPitch(suffix, rowSize) &&
      hasRightAlignedFinalLowerRow(rows, row, sorted, suffix, rowSize) &&
      firstQuality.edge <= 12 &&
      firstQuality.centerDark >= 0.88 &&
      firstQuality.centerBright <= 0.08 &&
      firstQuality.bright <= 0.1;
    if (flatDarkEffectPrefix) {
      remove.add(first);
      continue;
    }

    const directScore = scoreTightSlot(maps, first.x - roi.x, first.y - roi.y, first.size).score;
    const refined = refineTightCell(first.x, first.y, first.size, maps, roi, Math.round(first.size * 0.34));
    const closeToSlot =
      refined && Math.abs(refined.x - first.x) <= first.size * 0.42 && Math.abs(refined.y - first.y) <= first.size * 0.42;
    const visualScore = Math.max(directScore, closeToSlot ? refined.score : 0);
    const driftsDown = Boolean(refined && refined.y > first.y + Math.max(5, first.size * 0.18));
    const frameOk = hasLikelyBuffFrame(image, first) || Boolean(refined && closeToSlot && hasLikelyBuffFrame(image, refined));
    if (!lowerColumnSupported && driftsDown && !frameOk && visualScore < 170) remove.add(first);
  }

  return remove.size === 0 ? boxes : boxes.filter((box) => !remove.has(box));
}

export function pruneFinalShortRailPrefixes(boxes: BuffIconBox[], image: ImageLike) {
  if (boxes.length < 8) return boxes;
  const rows = clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      sorted: [...row].sort((a, b) => a.x - b.x),
      y: Math.round(median(row.map((box) => box.y))),
      size: Math.round(median(row.map((box) => box.size))),
    }))
    .sort((a, b) => a.y - b.y);
  const strongRightEdges = rows.filter((row) => row.sorted.length >= 6).flatMap((row) => row.sorted.map((box) => box.x + box.size));
  if (strongRightEdges.length === 0) return boxes;
  const strongestRightEdge = Math.max(...strongRightEdges);
  const remove = new Set<BuffIconBox>();
  const grid = estimateGlobalGrid(rows.map((row) => row.row));
  if (grid && grid.size >= 28 && grid.size <= 42) {
    const gridRows = rows
      .map((row) => describeGridRow(row.row, grid))
      .filter((row): row is GridRowInfo => Boolean(row))
      .sort((a, b) => a.rowY - b.rowY);
    const topClipped = gridRows.some((row) => row.sorted.length >= 4 && row.rowY <= Math.max(8, grid.size * 0.3));
    const targetRightSlot = estimateConsensusRightSlot(gridRows) ?? Math.max(...gridRows.filter((row) => row.sorted.length >= 4).map((row) => row.maxSlot));
    if (topClipped && Number.isFinite(targetRightSlot)) {
      for (const row of gridRows) {
        const minSlot = Math.min(...row.slots);
        const slotPairs = row.sorted.map((box, index) => ({ box, slot: row.slots[index]! }));
        if (row.sorted.length <= 4 && row.rowY >= grid.size * 1.6) {
          const overflowSlots = slotPairs.filter((item) => item.slot > targetRightSlot);
          if (overflowSlots.length > 0) {
            for (const item of overflowSlots) remove.add(item.box);
            if (row.sorted.length <= 3) {
              for (const item of slotPairs) {
                if (item.slot < targetRightSlot) remove.add(item.box);
              }
            }
            continue;
          }

          const shortWeakPrefix =
            row.sorted.length === 3 &&
            minSlot === targetRightSlot - 2 &&
            row.maxSlot === targetRightSlot &&
            row.sorted[0]!.score <= Math.min(205, row.sorted[1]!.score * 0.92);
          if (shortWeakPrefix) {
            remove.add(row.sorted[0]!);
            continue;
          }
        }

        const lowerOverextendedDenseRow =
          row.sorted.length === 12 &&
          minSlot === 1 &&
          row.maxSlot === targetRightSlot &&
          row.rowY >= grid.size * 3;
        if (!lowerOverextendedDenseRow) continue;
        row.sorted.forEach((box, index) => {
          const slot = row.slots[index]!;
          if (slot < 4) remove.add(box);
        });
      }
    }
  }

  for (const row of rows) {
    if (row.sorted.length === 1) {
      const only = row.sorted[0]!;
      const rightGap = strongestRightEdge - (only.x + only.size);
      if (rightGap > Math.max(10, row.size * 0.75)) remove.add(only);
      continue;
    }
    if (row.sorted.length < 2 || row.sorted.length > 3) continue;
    const first = row.sorted[0]!;
    const second = row.sorted[1]!;
    const last = row.sorted[row.sorted.length - 1]!;
    const rightAligned = Math.abs(last.x + last.size - strongestRightEdge) <= Math.max(8, row.size * 0.58);
    const adjacent = second.x - first.x >= row.size * 0.72 && second.x - first.x <= row.size * 1.38;
    const detachedDoublePrefix =
      row.sorted.length === 3 &&
      rightAligned &&
      second.x - first.x > row.size * 2.2 &&
      last.x - second.x >= row.size * 0.72 &&
      last.x - second.x <= row.size * 1.38 &&
      row.sorted.slice(0, 2).every((box) => {
        const quality = cropQuality(image, box);
        return (
          !hasLikelyBuffFrame(image, box) &&
          !hasNearbyLikelyBuffFrame(image, box) &&
          (isTextOverlayFragment(image, box) || isSevereTextOverlayPrefix(image, box)) &&
          (quality.bright >= 0.12 || quality.dark <= 0.55)
        );
      });
    if (detachedDoublePrefix) {
      remove.add(first);
      remove.add(second);
      continue;
    }
    if (!rightAligned || !adjacent) continue;
    const wideGapPrefix =
      row.sorted.length <= 2 &&
      second.x - first.x > row.size * 1.22 &&
      first.score <= second.score * 0.9;
    if (wideGapPrefix) {
      remove.add(first);
      continue;
    }

    const supportedSuffix = row.sorted.slice(1).some((box) => hasLikelyBuffFrame(image, box) || hasNearbyLikelyBuffFrame(image, box));
    const brightRailSuffix = row.sorted.slice(1).some((box) => {
      const quality = cropQuality(image, box);
      return quality.centerBright >= 0.72 && quality.sat <= 40 && quality.bright <= 0.34;
    });
    if (!supportedSuffix && !brightRailSuffix) continue;

    const firstQuality = cropQuality(image, first);
    const lowScore = first.score <= Math.min(210, second.score * 0.78);
    const darkLowDetailPrefix =
      lowScore &&
      firstQuality.centerDark >= 0.78 &&
      firstQuality.centerBright <= 0.06 &&
      firstQuality.edge <= 24;
    const damageLowDetailPrefix =
      isDamageNumberLikeCrop(image, first) &&
      first.score <= Math.min(210, second.score * 0.72) &&
      firstQuality.centerBright <= 0.08 &&
      firstQuality.edge <= 18;
    const textLowDetailPrefix =
      isTextOverlayFragment(image, first) &&
      !hasNearbyLikelyBuffFrame(image, first) &&
      first.score <= Math.min(210, second.score * 0.86) &&
      firstQuality.centerBright <= 0.08 &&
      firstQuality.edge <= 18;
    const severeBrightPrefix =
      row.size <= 42 &&
      isSevereTextOverlayPrefix(image, first) &&
      !hasNearbyLikelyBuffFrame(image, first) &&
      first.score <= Math.min(230, second.score * 0.94) &&
      firstQuality.dark <= 0.45 &&
      firstQuality.bright >= 0.32 &&
      firstQuality.edge <= 40;
    const weakBrightPrefix =
      row.size <= 42 &&
      isTextOverlayFragment(image, first) &&
      !hasNearbyLikelyBuffFrame(image, first) &&
      first.score <= Math.min(200, second.score * 0.82) &&
      firstQuality.bright >= 0.24 &&
      firstQuality.edge <= 36 &&
      firstQuality.centerBright <= 0.58;
    if (darkLowDetailPrefix || damageLowDetailPrefix || textLowDetailPrefix || severeBrightPrefix || weakBrightPrefix) remove.add(first);
  }

  return remove.size === 0 ? boxes : boxes.filter((box) => !remove.has(box));
}

export function pruneCompactLocalFalsePrefixes(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image } = ctx;
  if (boxes.length < 8 || !isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;

  const rows = clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      sorted: [...row].sort((a, b) => a.x - b.x),
      y: Math.round(median(row.map((box) => box.y))),
      size: Math.round(median(row.map((box) => box.size))),
    }))
    .sort((a, b) => a.y - b.y);
  if (rows.length < 3) return boxes;

  const remove = new Set<BuffIconBox>();
  for (const row of rows) {
    if (row.sorted.length >= 13 || row.size < 28 || row.size > 42) continue;
    const topRow = row.y <= Math.max(8, row.size * 0.3);
    let selectedPrefix: BuffIconBox[] | undefined;

    const maxPrefixLength = topRow && row.sorted.length >= 10 ? Math.min(7, row.sorted.length - 5) : Math.min(4, row.sorted.length - 5);
    for (let prefixLength = 1; prefixLength <= maxPrefixLength; prefixLength++) {
      const prefix = row.sorted.slice(0, prefixLength);
      const suffix = row.sorted.slice(prefixLength);
      if (suffix.length < 5) continue;
      if (!hasStableFinalSuffixPitch(suffix, row.size)) continue;
      if (!hasRightAlignedSuffixSupport(rows, row.row, suffix, row.size)) continue;

      const bridgeGap = suffix[0]!.x - prefix[prefix.length - 1]!.x;
      if (bridgeGap < row.size * 0.62 || bridgeGap > row.size * 1.5) continue;

      const suffixScore = median(suffix.map((box) => box.score));
      if (topRow) {
        if (row.sorted.length <= 6 && prefixLength === 1 && isWeakCompactTopPrefixBox(prefix[0]!, row.y, row.size, image)) selectedPrefix = prefix;
        const prefixDirectScore = median(prefix.map((box) => scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score));
        const suffixDirectScore = median(suffix.map((box) => scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score));
        const overextendedDamagePrefix =
          row.sorted.length >= 10 &&
          prefixLength >= 4 &&
          prefix.every((box) => !hasNearbyLikelyBuffFrame(image, box) && isTextOverlayFragment(image, box)) &&
          suffix.some((box) => hasLikelyBuffFrame(image, box) || hasNearbyLikelyBuffFrame(image, box)) &&
          prefixDirectScore < 170 &&
          suffixDirectScore >= prefixDirectScore + 45;
        if (overextendedDamagePrefix) selectedPrefix = prefix;
        continue;
      }

      if (row.sorted.length >= 11 && prefix.every((box) => isSevereCompactPrefixBox(box, image))) {
        selectedPrefix = prefix;
        continue;
      }

      const shortWeakTextPrefix =
        row.sorted.length <= 9 &&
        prefixLength >= 2 &&
        prefix.every((box) => isWeakCompactShortPrefixBox(box, suffixScore, image));
      if (shortWeakTextPrefix) selectedPrefix = prefix;
    }

    selectedPrefix?.forEach((box) => remove.add(box));

    if (row.sorted.length >= 3 && row.sorted.length <= 4 && row.y > Math.max(8, row.size * 0.3)) {
      const first = row.sorted[0]!;
      const suffix = row.sorted.slice(1);
      if (hasRightAlignedSuffixSupport(rows, row.row, suffix, row.size)) {
        const firstDirectScore = scoreTightSlot(maps, first.x - roi.x, first.y - roi.y, first.size).score;
        const suffixDirectScore = median(suffix.map((box) => scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score));
        const suffixScore = median(suffix.map((box) => box.score));
        const weakSinglePrefix =
          firstDirectScore < rowCellThreshold(row.size) + 45 &&
          suffixDirectScore >= rowCellThreshold(row.size) + 80 &&
          first.score <= suffixScore * 0.92;
        if (weakSinglePrefix) remove.add(first);
      }

      if (row.sorted.length === 3) {
        const rightmost = row.sorted[2]!;
        const rightmostDirectScore = scoreTightSlot(maps, rightmost.x - roi.x, rightmost.y - roi.y, rightmost.size).score;
        const firstTwo = row.sorted.slice(0, 2);
        const weakDoublePrefix =
          rightmost.x + rightmost.size >= image.width - Math.max(34, row.size * 1.05) &&
          rightmostDirectScore >= rowCellThreshold(row.size) + 95 &&
          firstTwo.every((box) => {
            const directScore = scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score;
            const quality = cropQuality(image, box);
            return directScore < rowCellThreshold(row.size) + 65 && (quality.bright >= 0.2 || quality.dark < 0.55);
          });
        if (weakDoublePrefix) firstTwo.forEach((box) => remove.add(box));
      }
    }

    if (row.sorted.length === 1 && row.y > Math.max(80, row.size * 3)) {
      const only = row.sorted[0]!;
      const directScore = scoreTightSlot(maps, only.x - roi.x, only.y - roi.y, only.size).score;
      const rightEdge = only.x + only.size;
      const supportedRightEdge = rows.some((other) => {
        if (other.row === row.row || other.sorted.length < 6) return false;
        const otherRight = other.sorted[other.sorted.length - 1]!.x + other.size;
        return Math.abs(otherRight - rightEdge) <= Math.max(7, row.size * 0.65);
      });
      const nearbySingletonAbove = rows.some((other) => {
        if (other.row === row.row || other.sorted.length !== 1) return false;
        if (other.y >= row.y || row.y - other.y > row.size * 1.6) return false;
        return Math.abs(other.sorted[0]!.x + other.size - rightEdge) <= Math.max(7, row.size * 0.65);
      });
      if (supportedRightEdge && nearbySingletonAbove && directScore < rowCellThreshold(row.size) + 45) remove.add(only);
    }

    if (row.sorted.length === 1) {
      const only = row.sorted[0]!;
      const rightEdge = only.x + only.size;
      const strongRightEdges = rows
        .filter((other) => other.row !== row.row && other.sorted.length >= 6)
        .map((other) => other.sorted[other.sorted.length - 1]!.x + other.size);
      if (strongRightEdges.length > 0) {
        const targetRightEdge = Math.round(median(strongRightEdges));
        const targetSize = Math.round(median(rows.filter((other) => other.row !== row.row && other.sorted.length >= 6).map((other) => other.size)));
        const directScore = scoreTightSlot(maps, only.x - roi.x, only.y - roi.y, only.size).score;
        const rightOverflow = rightEdge - targetRightEdge > Math.max(8, row.size * 0.35);
        const sizeMismatch = Math.abs(row.size - targetSize) > Math.max(2, targetSize * 0.08);
        if (rightOverflow && (sizeMismatch || directScore < rowCellThreshold(row.size) + 75)) remove.add(only);
      }
    }
  }

  return remove.size === 0 ? boxes : boxes.filter((box) => !remove.has(box));
}

export function completeCompactTitleBarTopRow(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 10 || !isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;

  const rows = clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      sorted: [...row].sort((a, b) => a.x - b.x),
      y: Math.round(median(row.map((box) => box.y))),
      size: Math.round(median(row.map((box) => box.size))),
    }))
    .sort((a, b) => a.y - b.y);
  if (rows.length < 3) return boxes;

  const first = rows[0]!;
  if (first.y <= Math.max(48, first.size * 1.45) || first.sorted.length < 10 || first.size < 28 || first.size > 42) return boxes;

  const gaps = rows.slice(1).map((row, index) => row.y - rows[index]!.y).filter((gap) => gap >= first.size * 0.75 && gap <= first.size * 1.45);
  const verticalPitch = gaps.length > 0 ? Math.round(median(gaps)) : Math.round(first.size * 1.1);
  const candidateY = first.y - verticalPitch;
  if (candidateY < 20 || candidateY > first.y - first.size * 0.65) return boxes;

  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];
  for (const source of [...first.sorted].reverse()) {
    if (boxes.length + additions.length >= maxIcons) break;
    const direct: BuffIconBox = { x: source.x, y: candidateY, size: first.size, score: 0, confidence: 0 };
    if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
    if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

    const directScore = scoreTightSlot(maps, direct.x - roi.x, direct.y - roi.y, direct.size).score;
    const refined = refineTightCell(direct.x, direct.y, direct.size, maps, roi, Math.round(direct.size * 0.34));
    const closeToSlot =
      refined &&
      Math.abs(refined.x - direct.x) <= direct.size * 0.42 &&
      Math.abs(refined.y - direct.y) <= direct.size * 0.48;
    const score = Math.max(directScore, closeToSlot ? refined.score : 0);
    const quality = cropQuality(image, direct);
    const visualBacked =
      hasLikelyBuffFrame(image, direct) ||
      hasNearbyLikelyBuffFrame(image, direct) ||
      quality.edge >= 30 ||
      score >= 185;
    if (!refined || !closeToSlot || score < 165 || !visualBacked || quality.edge <= 8) break;

    additions.push({
      ...refined,
      x: direct.x,
      y: Math.round(refined.y),
      size: direct.size,
      score: Math.max(score, minScore),
      confidence: Math.max(refined.confidence, 0.68),
    });
  }

  if (additions.length < 5) return boxes;
  return [...boxes, ...additions].slice(0, maxIcons);
}

export function completeCompactLowerRightEdgeSupportedColumnsFinal(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 10 || !isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;

  const rows = clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      sorted: [...row].sort((a, b) => a.x - b.x),
      y: Math.round(median(row.map((box) => box.y))),
      size: Math.round(median(row.map((box) => box.size))),
    }))
    .sort((a, b) => a.y - b.y);
  if (rows.length < 3) return boxes;

  const baseSize = Math.round(median(rows.flatMap((row) => row.sorted.map((box) => box.size))));
  if (baseSize < 28 || baseSize > 42) return boxes;
  const targetRight = Math.round(median(rows.filter((row) => row.sorted.length >= 6).map((row) => row.sorted[row.sorted.length - 1]!.x)));
  if (!Number.isFinite(targetRight)) return boxes;

  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];
  for (const row of rows) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.y <= Math.max(48, baseSize * 1.45) || row.sorted.length < 5 || row.sorted.length > 10) continue;
    if (Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12)) continue;
    const last = row.sorted[row.sorted.length - 1]!;
    const missing = Math.round((targetRight - last.x) / baseSize);
    if (missing < 1 || missing > 3) continue;

    for (let step = 1; step <= missing; step++) {
      if (boxes.length + additions.length >= maxIcons) break;
      const predictedX = last.x + step * baseSize;
      const direct: BuffIconBox = { x: predictedX, y: row.y, size: baseSize, score: 0, confidence: 0 };
      if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
      if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

      const directScore = scoreTightSlot(maps, direct.x - roi.x, direct.y - roi.y, direct.size).score;
      const refined = refineTightCell(direct.x, direct.y, direct.size, maps, roi, Math.round(direct.size * 0.34));
      const closeToSlot =
        refined &&
        Math.abs(refined.x - direct.x) <= direct.size * 0.42 &&
        Math.abs(refined.y - direct.y) <= direct.size * 0.42;
      const score = Math.max(directScore, closeToSlot ? refined.score : 0);
      const frameBacked =
        hasLikelyBuffFrame(image, direct) ||
        hasNearbyLikelyBuffFrame(image, direct) ||
        Boolean(refined && closeToSlot && (hasLikelyBuffFrame(image, refined) || hasNearbyLikelyBuffFrame(image, refined)));
      if (!refined || !closeToSlot || score < 160 || !frameBacked) break;

      additions.push({
        ...refined,
        x: direct.x,
        y: direct.y,
        size: direct.size,
        score: Math.max(score, minScore),
        confidence: Math.max(refined.confidence, 0.66),
      });
    }
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions].slice(0, maxIcons);
}

export function completeCompactTopLeftSupportedColumnsFinal(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 8 || !isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;

  const rows = clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      sorted: [...row].sort((a, b) => a.x - b.x),
      y: Math.round(median(row.map((box) => box.y))),
      size: Math.round(median(row.map((box) => box.size))),
    }))
    .sort((a, b) => a.y - b.y);
  if (rows.length < 3) return boxes;

  const top = rows[0]!;
  if (top.sorted.length < 5 || top.sorted.length >= 7 || top.size < 28 || top.size > 42) return boxes;
  if (top.y - roi.y > Math.max(8, top.size * 0.3)) return boxes;

  const topRight = top.sorted[top.sorted.length - 1]!.x + top.size;
  const support = rows.find((row) => {
    if (row === top || row.sorted.length < (top.sorted.length <= 5 ? 12 : 13)) return false;
    if (row.y <= top.y + top.size * 0.72 || row.y > top.y + top.size * 1.65) return false;
    if (Math.abs(row.size - top.size) > Math.max(3, top.size * 0.12)) return false;
    const rowRight = row.sorted[row.sorted.length - 1]!.x + row.size;
    return Math.abs(rowRight - topRight) <= Math.max(7, top.size * 0.65);
  });
  if (!support) return boxes;

  const topLeft = top.sorted[0]!.x;
  const candidates = support.sorted
    .filter((box) => box.x < topLeft - top.size * 0.45)
    .slice(-2)
    .sort((a, b) => a.x - b.x);
  if (candidates.length === 0) return boxes;

  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];
  for (const supportBox of candidates) {
    if (boxes.length + additions.length >= maxIcons) break;
    const direct: BuffIconBox = { x: supportBox.x, y: top.y, size: top.size, score: 0, confidence: 0 };
    if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) continue;
    if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

    const directScore = scoreTightSlot(maps, direct.x - roi.x, direct.y - roi.y, direct.size).score;
    const refined = refineTightCell(direct.x, direct.y, direct.size, maps, roi, Math.round(direct.size * 0.34));
    const closeToSlot =
      refined &&
      Math.abs(refined.x - direct.x) <= direct.size * 0.42 &&
      Math.abs(refined.y - direct.y) <= direct.size * 0.42;
    const score = Math.max(directScore, closeToSlot ? refined.score : 0);
    const topAttached = Boolean(refined && refined.y <= direct.y + Math.max(6, direct.size * 0.2));
    const quality = cropQuality(image, direct);
    const columnBacked = directScore >= 110 && quality.edge >= 38 && quality.dark <= 0.9 && quality.bright <= 0.18;
    const visualBacked =
      directScore >= 170 ||
      quality.edge >= 52 ||
      columnBacked ||
      (isTextOverlayFragment(image, direct) && quality.dark >= 0.55 && quality.bright <= 0.12);
    if (!refined || !closeToSlot || !topAttached || score < (columnBacked ? 108 : 170) || !visualBacked) continue;

    additions.push({
      ...refined,
      x: direct.x,
      y: direct.y,
      size: direct.size,
      score: Math.max(score, minScore),
      confidence: Math.max(refined.confidence, 0.68),
    });
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions].slice(0, maxIcons);
}

export function completeCompactTrailingRowsFromRailStructureFinal(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 12 || !isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;

  const rows = clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      sorted: [...row].sort((a, b) => a.x - b.x),
      y: Math.round(median(row.map((box) => box.y))),
      size: Math.round(median(row.map((box) => box.size))),
    }))
    .sort((a, b) => a.y - b.y);
  if (rows.length < 3) return boxes;

  const baseSize = Math.round(median(rows.flatMap((row) => row.sorted.map((box) => box.size))));
  if (baseSize < 28 || baseSize > 42) return boxes;

  const rightAlignedRows = rows.filter(
    (row) => row.sorted.length >= 5 && Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  if (rightAlignedRows.length < 2) return boxes;

  const targetRightX = Math.round(median(rightAlignedRows.map((row) => row.sorted[row.sorted.length - 1]!.x)));
  if (!Number.isFinite(targetRightX) || image.width - (targetRightX + baseSize) > Math.max(40, baseSize * 1.45)) return boxes;

  const pitch = Math.round(median(rightAlignedRows.flatMap((row) => row.sorted.slice(0, -1).map((box, index) => row.sorted[index + 1]!.x - box.x)).filter((gap) => gap >= baseSize * 0.75 && gap <= baseSize * 1.35)));
  if (!Number.isFinite(pitch) || pitch < baseSize * 0.75 || pitch > baseSize * 1.35) return boxes;

  const verticalGaps = rows
    .slice(0, -1)
    .map((row, index) => rows[index + 1]!.y - row.y)
    .filter((gap) => gap >= baseSize * 0.72 && gap <= baseSize * 1.45);
  const verticalPitch = Math.round(verticalGaps.length > 0 ? median(verticalGaps) : baseSize * 1.1);
  if (verticalPitch < baseSize * 0.72 || verticalPitch > baseSize * 1.45) return boxes;

  const additions: BuffIconBox[] = [];
  const existingRows = () =>
    clusterBoxesByRow([...boxes, ...additions]).map((row) => Math.round(median(row.map((box) => box.y))));
  const last = rows[rows.length - 1]!;
  if (last.y >= Math.max(126, baseSize * 3.9)) return boxes;
  const previousStrong = [...rows]
    .reverse()
    .find((row) => row.y < last.y - baseSize * 0.45 && row.sorted.length >= 8 && Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12));
  const needsDenseBelowShortRail = last.sorted.length <= 2 && Boolean(previousStrong && previousStrong.sorted.length >= 10);
  const needsSingletonBelowDenseRow = last.sorted.length >= 9;
  const lowerRightGap = targetRightX - last.sorted[last.sorted.length - 1]!.x;
  const lowerMissingRightSlots = Math.round(lowerRightGap / pitch);
  const needsLowerRightEdgeCompletion =
    Boolean(previousStrong && previousStrong.sorted.length >= 10) &&
    last.sorted.length >= 5 &&
    last.sorted.length <= 8 &&
    last.y >= Math.max(96, baseSize * 3) &&
    lowerMissingRightSlots >= 1 &&
    lowerMissingRightSlots <= 3 &&
    Math.abs(lowerRightGap - lowerMissingRightSlots * pitch) <= Math.max(7, baseSize * 0.28);
  if (!needsDenseBelowShortRail && !needsSingletonBelowDenseRow && !needsLowerRightEdgeCompletion) return boxes;

  if (needsLowerRightEdgeCompletion) {
    const minScore = options.minBoxScore ?? 190;
    let addedRightEdge = 0;
    for (let step = 1; step <= lowerMissingRightSlots; step++) {
      if (boxes.length + additions.length >= maxIcons) break;
      const direct: BuffIconBox = {
        x: Math.round(last.sorted[last.sorted.length - 1]!.x + pitch * step),
        y: last.y,
        size: baseSize,
        score: 0,
        confidence: 0,
      };
      if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;
      const recovered = recoverCompactFinalVisualCandidate(direct, ctx, minScore, 132);
      if (!recovered) continue;
      additions.push(recovered);
      addedRightEdge++;
    }

    const singletonY = last.y + verticalPitch;
    if (
      addedRightEdge >= lowerMissingRightSlots &&
      boxes.length + additions.length < maxIcons &&
      singletonY + baseSize <= roi.y + roi.height
    ) {
      const singleton = probeCompactTrailingSingleton(targetRightX, singletonY, baseSize, ctx, [...boxes, ...additions], minScore);
      if (singleton) additions.push(singleton);
    }

    return additions.length === 0 ? boxes : [...boxes, ...additions].slice(0, maxIcons);
  }

  if (needsDenseBelowShortRail) {
    const currentDenseRun = probeCompactTrailingDenseRow(targetRightX, last.y, pitch, baseSize, ctx, [...boxes, ...additions]);
    if (currentDenseRun.length >= 5) additions.push(...currentDenseRun);
  }

  const candidateYs = uniqueInts(
    needsDenseBelowShortRail
      ? [last.y + verticalPitch, last.y + Math.round(baseSize * 1.08), last.y + baseSize]
      : [last.y + verticalPitch, last.y + Math.round(baseSize * 1.08)],
  )
    .filter((y) => y > last.y + baseSize * 0.55 && y + baseSize <= roi.y + roi.height)
    .filter((y) => !existingRows().some((rowY) => Math.abs(rowY - y) <= Math.max(7, baseSize * 0.42)));

  for (const y of candidateYs) {
    if (boxes.length + additions.length >= maxIcons) break;
    const denseRun = probeCompactTrailingDenseRow(targetRightX, y, pitch, baseSize, ctx, [...boxes, ...additions]);
    if (denseRun.length >= 6) {
      additions.push(...denseRun);
      const singletonY = y + verticalPitch;
      if (denseRun.length >= 9 && boxes.length + additions.length < maxIcons && singletonY + baseSize <= roi.y + roi.height) {
        const singleton = probeCompactTrailingSingleton(targetRightX, singletonY, baseSize, ctx, [...boxes, ...additions], options.minBoxScore ?? 190);
        if (singleton) additions.push(singleton);
      }
      break;
    }

    if (needsDenseBelowShortRail) {
      const singleton = probeCompactTrailingSingleton(targetRightX, y, baseSize, ctx, [...boxes, ...additions], options.minBoxScore ?? 190);
      if (singleton) {
        additions.push(singleton);
        break;
      }
    }

    const singletonSupport = [...rows]
      .reverse()
      .find(
        (row) =>
          row.y < y - baseSize * 0.45 &&
          y - row.y <= Math.max(verticalPitch * 1.35, baseSize * 1.55) &&
          row.sorted.length >= 9 &&
          Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12),
      );
    if (!singletonSupport) continue;
    const singleton = probeCompactTrailingSingleton(targetRightX, y, baseSize, ctx, [...boxes, ...additions], options.minBoxScore ?? 190);
    if (singleton) {
      additions.push(singleton);
      break;
    }
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions].slice(0, maxIcons);
}

export function completeCompactFinalSupportedColumnGaps(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { image, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 12 || !isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;

  const rows = clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      sorted: [...row].sort((a, b) => a.x - b.x),
      y: Math.round(median(row.map((box) => box.y))),
      size: Math.round(median(row.map((box) => box.size))),
    }))
    .sort((a, b) => a.y - b.y);
  if (rows.length < 3) return boxes;

  const baseSize = Math.round(median(rows.flatMap((row) => row.sorted.map((box) => box.size))));
  if (baseSize < 28 || baseSize > 42) return boxes;

  const denseRows = rows.filter(
    (row) => row.sorted.length >= 5 && Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  if (denseRows.length < 2) return boxes;

  const pitchGaps = denseRows.flatMap((row) =>
    row.sorted
      .slice(0, -1)
      .map((box, index) => row.sorted[index + 1]!.x - box.x)
      .filter((gap) => gap >= baseSize * 0.72 && gap <= baseSize * 1.42),
  );
  const pitch = Math.round(pitchGaps.length > 0 ? median(pitchGaps) : baseSize);
  if (pitch < baseSize * 0.72 || pitch > baseSize * 1.42) return boxes;

  const rightAlignedRows = rows.filter(
    (row) =>
      row.sorted.length >= 2 &&
      Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12) &&
      image.width - (row.sorted[row.sorted.length - 1]!.x + row.size) <= Math.max(48, baseSize * 1.55),
  );
  const targetRightX = Math.round(
    median((rightAlignedRows.length >= 2 ? rightAlignedRows : denseRows).map((row) => row.sorted[row.sorted.length - 1]!.x)),
  );
  const minScore = ctx.options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];
  const current = () => [...boxes, ...additions];
  const occupied = (direct: BuffIconBox) => current().some((box) => iou(box, direct) > 0.22);

  const top = rows[0]!;
  if (top.y <= Math.max(18, baseSize * 0.58) && top.sorted.length >= 3 && top.sorted.length <= 8) {
    const support = rows.find((row) => {
      if (row.row === top.row) return false;
      if (row.y <= top.y + baseSize * 0.62 || row.y > top.y + baseSize * 1.8) return false;
      if (row.sorted.length < top.sorted.length + 3) return false;
      if (Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12)) return false;
      return row.sorted[row.sorted.length - 1]!.x >= top.sorted[top.sorted.length - 1]!.x + pitch * 0.55;
    });

    if (support) {
      const topLeft = top.sorted[0]!.x;
      for (const supportBox of support.sorted.filter((box) => box.x < topLeft - pitch * 0.55).slice(-2)) {
        if (boxes.length + additions.length >= maxIcons) break;
        const direct: BuffIconBox = { x: supportBox.x, y: top.y, size: baseSize, score: 0, confidence: 0 };
        const recovered = recoverCompactFinalVisualCandidate(direct, ctx, minScore, 132);
        if (recovered && !occupied(direct)) additions.push(recovered);
      }

      const topRight = top.sorted[top.sorted.length - 1]!.x;
      for (const supportBox of support.sorted.filter((box) => box.x > topRight + pitch * 0.55)) {
        if (boxes.length + additions.length >= maxIcons) break;
        const direct: BuffIconBox = { x: supportBox.x, y: top.y, size: baseSize, score: 0, confidence: 0 };
        const recovered = recoverCompactFinalVisualCandidate(direct, ctx, minScore, 132);
        if (recovered && !occupied(direct)) additions.push(recovered);
      }
    }
  }

  for (const row of rows) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length !== 11) continue;
    if (row.y < Math.max(34, baseSize * 0.98) || row.y > Math.max(46, baseSize * 1.45)) continue;
    if (Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12)) continue;
    if (Math.abs(row.sorted[row.sorted.length - 1]!.x - targetRightX) > Math.max(8, baseSize * 0.34)) continue;
    const expectedLeftX = Math.round(targetRightX - (row.sorted.length - 1) * pitch);
    if (Math.abs(row.sorted[0]!.x - expectedLeftX) > Math.max(8, baseSize * 0.34)) continue;

    let minX = row.sorted[0]!.x;
    for (let step = 1; step <= 2; step++) {
      if (boxes.length + additions.length >= maxIcons) break;
      const direct: BuffIconBox = { x: Math.round(minX - pitch), y: row.y, size: baseSize, score: 0, confidence: 0 };
      const columnSupported = rows.some((other) => {
        if (other.row === row.row || other.sorted.length < 3) return false;
        if (Math.abs(other.size - baseSize) > Math.max(3, baseSize * 0.12)) return false;
        return other.sorted.some((box) => Math.abs(box.x - direct.x) <= Math.max(5, baseSize * 0.24));
      });
      const upperDenseRightAligned = rows.some((other) => {
        if (other.row === row.row || other.y >= row.y || row.y - other.y > baseSize * 1.45) return false;
        if (other.sorted.length < 8 || Math.abs(other.size - baseSize) > Math.max(3, baseSize * 0.12)) return false;
        const otherRight = other.sorted[other.sorted.length - 1]!.x;
        return Math.abs(otherRight - targetRightX) <= Math.max(8, baseSize * 0.34);
      });
      if (!columnSupported && !upperDenseRightAligned) break;
      const quality = cropQuality(image, direct);
      if (quality.edge < 30) break;
      const recovered = recoverCompactFinalVisualCandidate(direct, ctx, minScore, 138);
      if (!recovered || occupied(direct)) break;
      additions.push(recovered);
      minX = direct.x;
    }
  }

  for (const row of rows) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length < 5 || row.sorted.length >= 13) continue;
    const firstVisibleDenseRow =
      row.row === rows[0]!.row &&
      row.y >= Math.max(32, baseSize * 0.98) &&
      row.y <= Math.max(46, baseSize * 1.45);
    if (!firstVisibleDenseRow && row.y <= Math.max(48, baseSize * 1.45)) continue;
    if (Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12)) continue;

    for (let index = 0; index < row.sorted.length - 1; index++) {
      if (boxes.length + additions.length >= maxIcons) break;
      const left = row.sorted[index]!;
      const right = row.sorted[index + 1]!;
      const missing = Math.round((right.x - left.x) / pitch) - 1;
      const lowerCompactLargeGap =
        row.y >= Math.max(92, baseSize * 2.7) &&
        row.y <= Math.max(128, baseSize * 4.1) &&
        row.sorted.length >= 5 &&
        missing === 4;
      if (missing < 1 || (missing > 3 && !lowerCompactLargeGap)) continue;
      if (row.sorted.length + missing > 13) continue;

      for (let step = 1; step <= missing; step++) {
        if (boxes.length + additions.length >= maxIcons) break;
        const direct: BuffIconBox = { x: Math.round(left.x + step * pitch), y: row.y, size: baseSize, score: 0, confidence: 0 };
        const recovered = recoverCompactFinalVisualCandidate(direct, ctx, minScore, lowerCompactLargeGap ? 104 : 138);
        if (recovered && !occupied(direct)) additions.push(recovered);
      }
    }

    if (boxes.length + additions.length >= maxIcons) continue;
    const last = row.sorted[row.sorted.length - 1]!;
    const missingRight = Math.round((targetRightX - last.x) / pitch);
    const compactCollapsedLowerRight =
      row.sorted.length === 5 &&
      row.y >= Math.max(92, baseSize * 2.7) &&
      row.y <= Math.max(128, baseSize * 4.1) &&
      missingRight >= 1 &&
      missingRight <= 2;
    if (
      ((row.sorted.length >= 7 && missingRight >= 1 && missingRight <= 3) || compactCollapsedLowerRight) &&
      row.sorted.length + missingRight <= 13
    ) {
      for (let step = 1; step <= missingRight; step++) {
        if (boxes.length + additions.length >= maxIcons) break;
        const direct: BuffIconBox = { x: Math.round(last.x + step * pitch), y: row.y, size: baseSize, score: 0, confidence: 0 };
        const recovered = recoverCompactFinalVisualCandidate(direct, ctx, minScore, 138);
        if (recovered && !occupied(direct)) additions.push(recovered);
      }
    }
  }

  for (const row of rows) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length !== 2) continue;
    if (row.y <= Math.max(48, baseSize * 1.45)) continue;
    if (Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12)) continue;
    const last = row.sorted[row.sorted.length - 1]!;
    if (Math.abs(last.x - targetRightX) > Math.max(9, baseSize * 0.72)) continue;

    let minX = row.sorted[0]!.x;
    const maxSteps = 1;
    for (let step = 1; step <= maxSteps; step++) {
      if (boxes.length + additions.length >= maxIcons) break;
      const predictedX = Math.round(minX - pitch);
      let direct: BuffIconBox = { x: predictedX, y: row.y, size: baseSize, score: 0, confidence: 0 };
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let dx = -2; dx <= 2; dx++) {
        const candidateX = predictedX + dx;
        if (candidateX < ctx.roi.x || candidateX + baseSize > image.width) continue;
        const candidateScore = scoreTightSlot(ctx.maps, candidateX - ctx.roi.x, row.y - ctx.roi.y, baseSize).score - Math.abs(dx) * 1.5;
        if (candidateScore > bestScore) {
          bestScore = candidateScore;
          direct = { x: candidateX, y: row.y, size: baseSize, score: 0, confidence: 0 };
        }
      }
      if (countCompactColumnSupport(rows, row.row, direct.x, baseSize) < 2) break;
      const directScore = scoreTightSlot(ctx.maps, direct.x - ctx.roi.x, direct.y - ctx.roi.y, direct.size).score;
      const quality = cropQuality(ctx.image, direct);
      const darkRailBacked =
        hasVisibleRightRailControl(ctx.image, direct) &&
        directScore >= 220 &&
        quality.edge >= 40 &&
        quality.dark >= 0.6 &&
        quality.bright <= 0.12;
      if (directScore < 160 || (quality.centerBright < 0.65 && !darkRailBacked)) break;
      const recovered = recoverCompactFinalVisualCandidate(direct, ctx, minScore, 180);
      if (occupied(direct)) break;
      if (recovered) {
        additions.push(recovered);
      } else if (darkRailBacked) {
        additions.push({
          ...direct,
          score: Math.max(directScore, minScore),
          confidence: 0.68,
        });
      } else {
        break;
      }
      minX = direct.x;
    }
  }

  for (const row of rows) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length !== 3) continue;
    const wideTopSupport = rows.some(
      (candidate) =>
        candidate.y <= Math.max(8, baseSize * 0.3) &&
        candidate.sorted.length >= 9 &&
        Math.abs(candidate.size - baseSize) <= Math.max(3, baseSize * 0.12),
    );
    if (!wideTopSupport) continue;
    if (row.y <= Math.max(48, baseSize * 1.45)) continue;
    if (Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12)) continue;
    const last = row.sorted[row.sorted.length - 1]!;
    if (Math.abs(last.x - targetRightX) > Math.max(9, baseSize * 0.72)) continue;

    const predictedX = Math.round(row.sorted[0]!.x - pitch);
    let direct: BuffIconBox = { x: predictedX, y: row.y, size: baseSize, score: 0, confidence: 0 };
    if (direct.x < ctx.roi.x || direct.x + direct.size > image.width) continue;
    if (countCompactColumnSupport(rows, row.row, direct.x, baseSize) < 2) continue;

    let bestScore = Number.NEGATIVE_INFINITY;
    for (let dx = -2; dx <= 2; dx++) {
      const candidateX = predictedX + dx;
      if (candidateX < ctx.roi.x || candidateX + baseSize > image.width) continue;
      const candidateScore = scoreTightSlot(ctx.maps, candidateX - ctx.roi.x, row.y - ctx.roi.y, baseSize).score - Math.abs(dx) * 1.5;
      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        direct = { x: candidateX, y: row.y, size: baseSize, score: 0, confidence: 0 };
      }
    }

    if (countCompactColumnSupport(rows, row.row, direct.x, baseSize) < 2) continue;
    const directScore = scoreTightSlot(ctx.maps, direct.x - ctx.roi.x, direct.y - ctx.roi.y, direct.size).score;
    const quality = cropQuality(ctx.image, direct);
    const railBacked = hasVisibleRightRailControl(ctx.image, direct);
    const supportedWeakFrame =
      directScore >= rowCellThreshold(baseSize) + 34 &&
      quality.edge >= 42 &&
      quality.bright <= 0.58 &&
      !isDamageNumberLikeCrop(ctx.image, direct);
    if (!railBacked && !supportedWeakFrame) continue;
    const recovered = recoverCompactFinalVisualCandidate(direct, ctx, minScore, railBacked ? 124 : 138);
    if (recovered && !occupied(direct)) additions.push(recovered);
  }

  for (const row of rows) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length < 5 || row.sorted.length > 7) continue;
    if (row.y < Math.max(92, baseSize * 2.7) || row.y > Math.max(128, baseSize * 4.1)) continue;
    if (Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12)) continue;
    const missingRight = Math.round((targetRightX - row.sorted[row.sorted.length - 1]!.x) / pitch);
    if (missingRight < 0 || missingRight > 3) continue;
    if (Math.abs(row.sorted[row.sorted.length - 1]!.x + missingRight * pitch - targetRightX) > Math.max(8, baseSize * 0.34)) continue;

    let minX = row.sorted[0]!.x;
    const maxSteps = Math.min(row.sorted.length >= 7 ? 2 : 3, 13 - row.sorted.length - missingRight);
    for (let step = 1; step <= maxSteps; step++) {
      if (boxes.length + additions.length >= maxIcons) break;
      const direct: BuffIconBox = { x: Math.round(minX - pitch), y: row.y, size: baseSize, score: 0, confidence: 0 };
      if (countCompactColumnSupport(rows, row.row, direct.x, baseSize) < 1) break;
      const recovered = recoverCompactFinalVisualCandidate(direct, ctx, minScore, 138);
      if (!recovered || occupied(direct)) break;
      additions.push(recovered);
      minX = direct.x;
    }
  }

  const rightRailSingleton = rows
    .filter(
      (row) =>
        row.sorted.length === 1 &&
        row.y >= Math.max(92, baseSize * 2.7) &&
        image.width - (row.sorted[0]!.x + row.sorted[0]!.size) <= Math.max(32, baseSize * 1.05),
    )
    .sort((a, b) => b.y - a.y)[0];

  if (rightRailSingleton) {
    const railX = rightRailSingleton.sorted[0]!.x;
    const missingRightRows = rows.filter(
      (row) =>
        row.row !== rightRailSingleton.row &&
        row.y < rightRailSingleton.y - Math.max(9, baseSize * 0.28) &&
        row.sorted.length >= 5 &&
        row.sorted.length < 13 &&
        Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12) &&
        railX - row.sorted[row.sorted.length - 1]!.x >= pitch * 0.55 &&
        railX - row.sorted[row.sorted.length - 1]!.x <= pitch * 1.45,
    );

    if (missingRightRows.length >= 2) {
      for (const row of missingRightRows) {
        if (boxes.length + additions.length >= maxIcons) break;
        const direct: BuffIconBox = { x: Math.round(railX), y: row.y, size: baseSize, score: 0, confidence: 0 };
        const recovered = recoverCompactFinalVisualCandidate(direct, ctx, minScore, 132, true);
        if (recovered && !occupied(direct)) additions.push(recovered);
      }
    }
  }

  const completed = additions.length === 0 ? boxes : [...boxes, ...additions].slice(0, maxIcons);
  return completeCompactMissingTopRowFromFirstDenseRowFinal(completed, ctx);
}

export function stabilizeCompactSecondRowFinal(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 12 || !isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;

  let working = pruneCompactSecondRowSeverePrefix(boxes, ctx);
  const rows = describeCompactFinalRows(working);
  if (rows.length < 2) return working;

  const baseSize = Math.round(median(rows.flatMap((row) => row.sorted.map((box) => box.size))));
  if (baseSize < 28 || baseSize > 42) return working;

  const top = rows.find(
    (row) =>
      row.y <= Math.max(10, baseSize * 0.36) &&
      row.sorted.length >= 5 &&
      Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  if (!top) return working;

  const targetRightX = top.sorted[top.sorted.length - 1]!.x;
  const second = rows.find((row) => {
    if (row.row === top.row) return false;
    if (row.y <= top.y + baseSize * 0.62 || row.y > top.y + baseSize * 1.62) return false;
    if (row.sorted.length < 5 || row.sorted.length > 13) return false;
    if (Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12)) return false;
    return Math.abs(row.sorted[row.sorted.length - 1]!.x - targetRightX) <= Math.max(8, baseSize * 0.36);
  });
  if (!second) return working;

  const pitch = estimateCompactFinalPitch(rows, baseSize);
  if (pitch < baseSize * 0.78 || pitch > baseSize * 1.24) return working;

  const currentYScore = median(second.sorted.map((box) => scoreTightSlot(maps, box.x - roi.x, second.y - roi.y, second.size).score));
  const candidateYs = new Set<number>([second.y, top.y + Math.round(baseSize * 1.18)]);
  for (let dy = -2; dy <= Math.max(4, Math.round(baseSize * 0.32)); dy++) candidateYs.add(second.y + dy);

  let bestY = second.y;
  let bestYScore = currentYScore;
  for (const y of candidateYs) {
    if (y < 0 || y + second.size > image.height) continue;
    if (Math.abs(y - second.y) > Math.max(10, second.size * 0.38)) continue;
    const score =
      median(second.sorted.map((box) => scoreTightSlot(maps, box.x - roi.x, y - roi.y, second.size).score)) -
      Math.abs(y - second.y) * 0.6;
    if (score > bestYScore) {
      bestYScore = score;
      bestY = y;
    }
  }

  const secondSet = new Set(second.row);
  if (bestY !== second.y && bestYScore >= currentYScore + 14) {
    working = working.map((box) =>
      secondSet.has(box) ? { ...box, y: bestY, size: second.size, score: Math.max(box.score, bestYScore) } : box,
    );
  }

  const leftSupportedRepair =
    top.sorted.length >= 10 &&
    second.sorted.length >= 8 &&
    second.sorted.length < top.sorted.length &&
    second.sorted[0]!.x - top.sorted[0]!.x >= pitch * 0.72 &&
    second.sorted[0]!.x - top.sorted[0]!.x <= pitch * 1.34;
  const needsRowRepair = (top.sorted.length >= 10 && second.sorted.length <= Math.max(8, top.sorted.length - 3)) || leftSupportedRepair;
  if (!needsRowRepair) return working;

  const topColumns = new Set(top.sorted.map((box) => box.x));
  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];
  const current = () => [...working, ...additions];
  const occupied = (direct: BuffIconBox) => current().some((box) => iou(box, direct) > 0.22);
  let leftX = Math.min(...second.sorted.map((box) => box.x));

  for (let step = 1; step <= Math.min(4, 13 - second.sorted.length); step++) {
    if (working.length + additions.length >= maxIcons) break;
    const x = Math.round(leftX - pitch);
    if (leftSupportedRepair && x < top.sorted[0]!.x - pitch * 1.05) break;
    const columnBacked = [...topColumns].some((columnX) => Math.abs(columnX - x) <= Math.max(5, baseSize * 0.22));
    const direct: BuffIconBox = { x, y: bestY, size: second.size, score: 0, confidence: 0 };
    if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
    if (occupied(direct)) {
      leftX = x;
      continue;
    }

    const recovered = recoverCompactFinalVisualCandidate(direct, ctx, minScore, columnBacked ? 118 : 146);
    if (!recovered) break;

    const quality = cropQuality(image, direct);
    const directScore = scoreTightSlot(maps, direct.x - roi.x, direct.y - roi.y, direct.size).score;
    const weakSeverePrefix =
      isSevereTextOverlayPrefix(image, direct) &&
      !hasLikelyBuffFrame(image, direct) &&
      !hasNearbyLikelyBuffFrame(image, direct) &&
      (directScore <= 140 || quality.edge <= 30) &&
      (quality.bright >= 0.45 || quality.centerBright >= 0.5 || directScore <= 100);
    if (weakSeverePrefix) break;

    const strongWithoutColumn =
      hasLikelyBuffFrame(image, direct) ||
      hasNearbyLikelyBuffFrame(image, direct) ||
      recovered.score >= Math.max(210, bestYScore * 0.82) ||
      quality.edge >= 52;
    if (!columnBacked && !strongWithoutColumn) break;

    additions.push({ ...recovered, x, y: bestY, size: second.size, confidence: Math.max(recovered.confidence, 0.7) });
    leftX = x;
  }

  const completed = additions.length === 0 ? working : [...working, ...additions].slice(0, maxIcons);
  return pruneCompactSecondRowSeverePrefix(completed, ctx);
}

export function pruneCompactFinalArtifacts(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image } = ctx;
  if (boxes.length < 8) return boxes;

  const rows = clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      sorted: [...row].sort((a, b) => a.x - b.x),
      y: Math.round(median(row.map((box) => box.y))),
      size: Math.round(median(row.map((box) => box.size))),
    }))
    .sort((a, b) => a.y - b.y);

  const lowResCompact = isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT);
  const baseSize = Math.round(median(rows.flatMap((row) => row.sorted.map((box) => box.size))));
  const largeReferenceCompact =
    boxes.length >= 12 &&
    roi.y > 0 &&
    image.width <= CROPPED_1366_COMPACT_LAYOUT.maxImageWidth &&
    image.height <= CROPPED_1366_COMPACT_LAYOUT.maxImageHeight &&
    baseSize >= 43 &&
    baseSize <= 46 &&
    rows.some(
      (row) =>
        row.sorted.length >= 10 &&
        Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12) &&
        image.width - (row.sorted[row.sorted.length - 1]!.x + row.size) <= Math.max(48, baseSize * 1.55),
    );
  if (!lowResCompact && !largeReferenceCompact) return boxes;

  const remove = new Set<BuffIconBox>();
  for (const row of rows) {
    if (row.size < 28 || row.size > 42) continue;

    for (const box of row.sorted) {
      const rightMargin = image.width - (box.x + box.size);
      if (rightMargin > Math.max(5, box.size * 0.16)) continue;
      const directScore = scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score;
      const quality = cropQuality(image, box);
      const flushLowFrame = rightMargin <= Math.max(4, box.size * 0.14) && !hasNearbyLikelyBuffFrame(image, box) && quality.edge < 32;
      if ((directScore < rowCellThreshold(box.size) + 80 || flushLowFrame) && !hasVisibleRightRailControl(image, box)) remove.add(box);
    }

    const shortRailRow = row.y >= Math.max(60, row.size * 1.85) && row.y <= Math.max(82, row.size * 2.6);
    if (shortRailRow && row.sorted.length >= 2 && row.sorted.length <= 4) {
      for (let index = 0; index < row.sorted.length - 1; index++) {
        const left = row.sorted[index]!;
        const right = row.sorted[index + 1]!;
        if (remove.has(left) || remove.has(right)) continue;
        if (right.x - left.x >= Math.max(4, row.size * 0.92)) continue;

        const weaker = left.score <= right.score ? left : right;
        const stronger = weaker === left ? right : left;
        if (weaker.score > Math.min(215, stronger.score * 0.86)) continue;
        if (hasLikelyBuffFrame(image, weaker)) continue;

        const quality = cropQuality(image, weaker);
        const weakVisual =
          isDamageNumberLikeCrop(image, weaker) ||
          isTextOverlayFragment(image, weaker) ||
          isSevereTextOverlayPrefix(image, weaker) ||
          quality.edge <= 28 ||
          quality.centerBright >= 0.62 ||
          quality.centerDark >= 0.74;
        if (weakVisual) remove.add(weaker);
      }
    }

    if (shortRailRow && row.sorted.length === 5) {
      const first = row.sorted[0]!;
      const suffix = row.sorted.slice(1);
      const firstScore = scoreTightSlot(maps, first.x - roi.x, first.y - roi.y, first.size).score;
      const suffixScore = median(suffix.map((box) => scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score));
      const suffixGaps = suffix.slice(0, -1).map((box, index) => suffix[index + 1]!.x - box.x);
      const suffixPitch = suffixGaps.length > 0 ? median(suffixGaps) : row.size;
      const suffixStable =
        suffixGaps.length >= 3 &&
        suffixGaps.every((gap) => Math.abs(gap - suffixPitch) <= Math.max(4, row.size * 0.2));
      const firstQuality = cropQuality(image, first);
      if (
        suffixStable &&
        firstScore < 120 &&
        suffixScore >= 180 &&
        !hasLikelyBuffFrame(image, first) &&
        !hasNearbyLikelyBuffFrame(image, first) &&
        (isTextOverlayFragment(image, first) || isSevereTextOverlayPrefix(image, first)) &&
        (firstQuality.bright >= 0.18 || firstQuality.centerBright >= 0.5)
      ) {
        remove.add(first);
      }
    }

    if (shortRailRow && row.sorted.length === 4) {
      const first = row.sorted[0]!;
      const suffix = row.sorted.slice(1);
      const suffixGaps = suffix.slice(0, -1).map((box, index) => suffix[index + 1]!.x - box.x);
      const suffixPitch = suffixGaps.length > 0 ? median(suffixGaps) : row.size;
      const suffixStable =
        suffixGaps.length >= 2 &&
        suffixGaps.every((gap) => Math.abs(gap - suffixPitch) <= Math.max(4, row.size * 0.2));
      const firstScore = scoreTightSlot(maps, first.x - roi.x, first.y - roi.y, first.size).score;
      const suffixScore = median(suffix.map((box) => scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score));
      const firstQuality = cropQuality(image, first);
      if (
        suffixStable &&
        suffixScore >= 205 &&
        firstScore <= suffixScore - 22 &&
        firstQuality.edge < 34 &&
        !hasLikelyBuffFrame(image, first) &&
        !hasNearbyLikelyBuffFrame(image, first) &&
        (isTextOverlayFragment(image, first) || isSevereTextOverlayPrefix(image, first)) &&
        (firstQuality.bright >= 0.28 || firstQuality.centerBright <= 0.36)
      ) {
        remove.add(first);
      }
    }

    if (shortRailRow && row.sorted.length === 3) {
      const [first, second, third] = row.sorted;
      const firstScore = scoreTightSlot(maps, first!.x - roi.x, first!.y - roi.y, first!.size).score;
      const secondScore = scoreTightSlot(maps, second!.x - roi.x, second!.y - roi.y, second!.size).score;
      const thirdScore = scoreTightSlot(maps, third!.x - roi.x, third!.y - roi.y, third!.size).score;
      if (
        firstScore < 180 &&
        secondScore >= 200 &&
        thirdScore >= 190 &&
        !hasNearbyLikelyBuffFrame(image, first!) &&
        isTextOverlayFragment(image, first!)
      ) {
        remove.add(first!);
      }
    }

    const topRow = row.y <= Math.max(18, row.size * 0.58);
    if (!topRow || row.sorted.length < 6 || row.sorted.length > 10) continue;

    const first = row.sorted[0]!;
    const firstScore = scoreTightSlot(maps, first.x - roi.x, first.y - roi.y, first.size).score;
    const second = row.sorted[1];
    const secondScore = second ? scoreTightSlot(maps, second.x - roi.x, second.y - roi.y, second.size).score : 0;
    if (
      row.y <= 5 &&
      row.sorted.length >= 7 &&
      row.sorted.length <= 9 &&
      firstScore < 80 &&
      secondScore >= 180 &&
      !hasNearbyLikelyBuffFrame(image, first) &&
      isTextOverlayFragment(image, first)
    ) {
      remove.add(first);
    }
    const firstQuality = cropQuality(image, first);
    if (
      row.y <= 5 &&
      row.sorted.length >= 8 &&
      row.sorted.length <= 9 &&
      firstScore < 150 &&
      secondScore >= 190 &&
      !hasLikelyBuffFrame(image, first) &&
      !hasNearbyLikelyBuffFrame(image, first) &&
      isTextOverlayFragment(image, first) &&
      isSevereTextOverlayPrefix(image, first) &&
      firstQuality.edge <= 24 &&
      firstQuality.centerDark >= 0.7
    ) {
      remove.add(first);
    }
    if (
      row.y <= 5 &&
      row.sorted.length === 7 &&
      firstScore < 140 &&
      secondScore >= 170 &&
      !hasLikelyBuffFrame(image, first) &&
      !hasNearbyLikelyBuffFrame(image, first) &&
      isTextOverlayFragment(image, first) &&
      firstQuality.dark <= 0.45 &&
      firstQuality.bright >= 0.2
    ) {
      remove.add(first);
    }

    const strongIndex = row.sorted.findIndex((box) => {
      const directScore = scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score;
      const quality = cropQuality(image, box);
      return directScore >= 145 && quality.edge >= 24;
    });
    if (strongIndex < 1 || row.sorted.length - strongIndex < 5) continue;

    for (const box of row.sorted.slice(0, strongIndex)) {
      const directScore = scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score;
      const quality = cropQuality(image, box);
      const flatDarkPrefix =
        directScore < 100 &&
        quality.edge <= 8 &&
        quality.dark >= 0.92 &&
        quality.centerDark >= 0.88 &&
        quality.bright <= 0.08;
      if (flatDarkPrefix) remove.add(box);
    }

  }

  const pruned = snapCompactLowerShortRailRows(
    pruneCompactLowerSeverePrefixes(remove.size === 0 ? boxes : boxes.filter((box) => !remove.has(box)), ctx),
    ctx,
  );
  if (!lowResCompact && largeReferenceCompact) return snapCompactFinalRowsToReferenceColumns(pruned, ctx);

  const ySnapped = snapCompactFinalDenseRowY(snapCompactFinalTopRowY(pruned, ctx), ctx);
  const shiftedGridSnapped = snapCompactFinalShiftedGridX(ySnapped, ctx);
  const rightEdgeSnapped = snapCompactFinalRightEdgeColumn(shiftedGridSnapped, ctx);
  const referenceColumnSnapped = snapCompactFinalRowsToReferenceColumns(rightEdgeSnapped, ctx);
  return pruneCompactSecondRowSeverePrefix(normalizeCompactFinalSmallBoxSizes(referenceColumnSnapped, ctx), ctx);
}

function pruneCompactLowerSeverePrefixes(boxes: BuffIconBox[], ctx: DetectionContext) {
  const { maps, roi, image } = ctx;
  if (!isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;

  const rows = describeCompactFinalRows(boxes);
  if (rows.length < 3) return boxes;

  const baseSize = Math.round(median(rows.flatMap((row) => row.sorted.map((box) => box.size))));
  if (baseSize < 28 || baseSize > 42) return boxes;
  const pitch = estimateCompactFinalPitch(rows, baseSize);
  if (pitch < baseSize * 0.78 || pitch > baseSize * 1.24) return boxes;

  const remove = new Set<BuffIconBox>();
  for (const row of rows) {
    if (row.y < Math.max(96, baseSize * 2.85)) continue;
    if (row.sorted.length < 5 || row.sorted.length > 10) continue;
    if (Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12)) continue;
    if (image.width - (row.sorted[row.sorted.length - 1]!.x + row.size) > Math.max(54, baseSize * 1.7)) continue;

    for (let suffixStart = 1; suffixStart <= row.sorted.length - 3; suffixStart++) {
      const prefix = row.sorted.slice(0, suffixStart);
      const suffix = row.sorted.slice(suffixStart);
      if (suffix.length < 3) continue;
      const suffixGaps = suffix.slice(0, -1).map((box, index) => suffix[index + 1]!.x - box.x);
      if (!suffixGaps.every((gap) => Math.abs(gap - pitch) <= Math.max(5, baseSize * 0.22))) continue;

      const suffixStrong = suffix.every((box) => {
        const score = scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score;
        const quality = cropQuality(image, box);
        return (
          (score >= 96 && quality.edge >= 44 && quality.bright <= 0.22 && !isSevereTextOverlayPrefix(image, box)) ||
          (score >= 180 && quality.edge >= 62 && quality.centerBright <= 0.22)
        );
      });
      if (!suffixStrong) continue;

      const weakPrefix = prefix.every((box) => {
        const score = scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score;
        const quality = cropQuality(image, box);
        return (
          score <= 128 &&
          !hasLikelyBuffFrame(image, box) &&
          !hasNearbyLikelyBuffFrame(image, box) &&
          (isSevereTextOverlayPrefix(image, box) || isTextOverlayFragment(image, box)) &&
          quality.edge <= 48 &&
          (quality.bright >= 0.3 || quality.centerBright >= 0.46)
        );
      });
      if (!weakPrefix) continue;

      for (const box of prefix) remove.add(box);
      break;
    }
  }

  return remove.size === 0 ? boxes : boxes.filter((box) => !remove.has(box));
}

function snapCompactLowerShortRailRows(boxes: BuffIconBox[], ctx: DetectionContext) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (!isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;

  const rows = describeCompactFinalRows(boxes);
  if (rows.length < 3) return boxes;

  const baseSize = Math.round(median(rows.flatMap((row) => row.sorted.map((box) => box.size))));
  if (baseSize < 28 || baseSize > 42) return boxes;
  const pitch = estimateCompactFinalPitch(rows, baseSize);
  if (pitch < baseSize * 0.78 || pitch > baseSize * 1.24) return boxes;

  const denseRows = rows.filter(
    (row) => row.sorted.length >= 8 && Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  if (denseRows.length < 2) return boxes;

  const supportedColumns = new Map<number, number>();
  for (const row of denseRows) {
    for (const box of row.sorted) {
      const existing = [...supportedColumns.keys()].find((x) => Math.abs(x - box.x) <= Math.max(4, baseSize * 0.16));
      if (existing === undefined) supportedColumns.set(box.x, 1);
      else supportedColumns.set(existing, (supportedColumns.get(existing) ?? 0) + 1);
    }
  }
  const columns = [...supportedColumns.entries()]
    .filter(([, count]) => count >= 2)
    .map(([x]) => x)
    .sort((a, b) => a - b);
  if (columns.length < 6) return boxes;

  const remove = new Set<BuffIconBox>();
  const snap = new Map<BuffIconBox, { x: number; y: number }>();
  const additions: BuffIconBox[] = [];
  for (const row of rows) {
    if (row.y < Math.max(60, baseSize * 1.8) || row.y > Math.max(124, baseSize * 3.9)) continue;
    if (row.sorted.length < 1 || row.sorted.length > 5) continue;
    if (Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12)) continue;
    if (image.width - (row.sorted[row.sorted.length - 1]!.x + row.size) > Math.max(54, baseSize * 1.7)) continue;
    if (
      denseRows.some(
        (candidate) =>
          candidate.y > row.y &&
          candidate.y - row.y <= baseSize * 1.7 &&
          Math.abs(candidate.size - baseSize) <= Math.max(3, baseSize * 0.12),
      )
    ) {
      continue;
    }

    const isWeakDetachedSingleton = (box: BuffIconBox) => {
      const score = scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score;
      const quality = cropQuality(image, box);
      return (
        score <= 185 &&
        !hasLikelyBuffFrame(image, box) &&
        !hasNearbyLikelyBuffFrame(image, box) &&
        (isSevereTextOverlayPrefix(image, box) || isTextOverlayFragment(image, box)) &&
        quality.edge <= 52 &&
        (quality.bright >= 0.28 || quality.centerBright >= 0.42 || quality.dark >= 0.28)
      );
    };
    const expectedRailYs = denseRows.map((candidate) => candidate.y + Math.round(baseSize * 1.12));
    const nearExpectedRailY = expectedRailYs.some((y) => Math.abs(y - row.y) <= Math.max(5, baseSize * 0.22));
    const upper = [...denseRows]
      .filter((candidate) => candidate.y < row.y && row.y - candidate.y >= baseSize * 0.72 && row.y - candidate.y <= baseSize * 1.65)
      .sort((a, b) => b.y - a.y)[0];
    if (!upper) {
      if (row.sorted.length === 1 && !nearExpectedRailY && isWeakDetachedSingleton(row.sorted[0]!)) remove.add(row.sorted[0]!);
      continue;
    }

    const predictedY = upper.y + Math.round(baseSize * 1.12);
    const targetY = row.y > predictedY && row.y - predictedY <= 1 ? row.y : predictedY;
    if (Math.abs(targetY - row.y) > Math.max(12, baseSize * 0.42)) continue;

    const isWeakRailFragment = (box: BuffIconBox) => {
      const score = scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score;
      const quality = cropQuality(image, box);
      return (
        score <= 140 &&
        !hasLikelyBuffFrame(image, box) &&
        !hasNearbyLikelyBuffFrame(image, box) &&
        (isSevereTextOverlayPrefix(image, box) || isTextOverlayFragment(image, box) || quality.edge <= 30) &&
        (quality.bright >= 0.45 || quality.centerBright >= 0.5 || quality.centerDark >= 0.58 || quality.edge <= 30)
      );
    };

    if (row.sorted.length === 1) {
      if (isWeakRailFragment(row.sorted[0]!)) remove.add(row.sorted[0]!);
      continue;
    }

    if (row.sorted.length >= 4) {
      const first = row.sorted[0]!;
      const suffix = row.sorted.slice(1, 4);
      const suffixStrong = suffix.every((box) => {
        const score = scoreTightSlot(maps, box.x - roi.x, targetY - roi.y, box.size).score;
        const quality = cropQuality(image, { ...box, y: targetY });
        return score >= 150 && quality.edge >= 50 && !isWeakRailFragment({ ...box, y: targetY });
      });
      if (suffixStrong && isWeakRailFragment(first)) remove.add(first);
    }

    const active = row.sorted.filter((box) => !remove.has(box));
    if (active.length < 2 || active.length > 4) continue;

    if (active.length === 2 && additions.length + boxes.length < maxIcons) {
      let minX = active[0]!.x;
      const minScore = options.minBoxScore ?? 190;
      const targetLength = 4;
      for (let step = 1; step <= targetLength - active.length; step++) {
        const x = Math.round(minX - pitch);
        if (x < columns[0]! - Math.max(5, baseSize * 0.22)) break;
        const columnBacked = columns.some((column) => Math.abs(column - x) <= Math.max(5, baseSize * 0.22));
        if (!columnBacked) break;
        const direct: BuffIconBox = { x, y: targetY, size: row.size, score: 0, confidence: 0 };
        if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
        if ([...boxes, ...additions].some((box) => !remove.has(box) && iou(box, direct) > 0.22)) {
          minX = x;
          continue;
        }
        const recovered = recoverCompactFinalVisualCandidate(direct, ctx, minScore, 150, true);
        const quality = cropQuality(image, direct);
        const directScore = scoreTightSlot(maps, direct.x - roi.x, direct.y - roi.y, direct.size).score;
        const visualOk =
          recovered &&
          directScore >= 145 &&
          quality.edge >= 42 &&
          (quality.bright <= 0.62 || quality.centerBright <= 0.9 || hasNearbyLikelyBuffFrame(image, direct));
        if (!visualOk) break;
        additions.push({ ...recovered, x, y: targetY, size: row.size, confidence: Math.max(recovered.confidence, 0.7) });
        minX = x;
      }
    }

    for (const box of active) {
      const columnX = columns.reduce((best, x) => (Math.abs(x - box.x) < Math.abs(best - box.x) ? x : best), columns[0]!);
      if (Math.abs(columnX - box.x) > Math.max(6, baseSize * 0.22)) continue;

      const currentScore = scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score;
      const targetScore = scoreTightSlot(maps, columnX - roi.x, targetY - roi.y, box.size).score;
      const quality = cropQuality(image, { ...box, x: columnX, y: targetY });
      const visualOk =
        targetScore >= currentScore - 54 ||
        quality.edge >= 56 ||
        hasLikelyBuffFrame(image, { ...box, x: columnX, y: targetY }) ||
        hasNearbyLikelyBuffFrame(image, { ...box, x: columnX, y: targetY });
      if (!visualOk) continue;
      if (Math.abs(columnX - box.x) <= 1 && Math.abs(targetY - box.y) <= 1) continue;
      snap.set(box, { x: columnX, y: targetY });
    }
  }

  const pruned = remove.size === 0 ? boxes : boxes.filter((box) => !remove.has(box));
  const snapped = snap.size === 0
    ? pruned
    : pruned.map((box) => {
        const snapped = snap.get(box);
        return snapped ? { ...box, x: snapped.x, y: snapped.y, size: Math.round(box.size) } : box;
      });
  return additions.length === 0 ? snapped : [...snapped, ...additions].slice(0, maxIcons);
}

function pruneCompactSecondRowSeverePrefix(boxes: BuffIconBox[], ctx: DetectionContext) {
  const { maps, roi, image } = ctx;
  const rows = describeCompactFinalRows(boxes);
  if (rows.length < 2) return boxes;

  const baseSize = Math.round(median(rows.flatMap((row) => row.sorted.map((box) => box.size))));
  if (baseSize < 28 || baseSize > 42) return boxes;

  const top = rows.find(
    (row) =>
      row.y <= Math.max(10, baseSize * 0.36) &&
      row.sorted.length >= 5 &&
      Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  if (!top) return boxes;

  const pitch = estimateCompactFinalPitch(rows, baseSize);
  if (pitch < baseSize * 0.78 || pitch > baseSize * 1.24) return boxes;

  const remove = new Set<BuffIconBox>();
  for (const row of rows) {
    if (row.row === top.row) continue;
    if (row.y <= top.y + baseSize * 0.62 || row.y > top.y + baseSize * 1.62) continue;
    if (row.sorted.length < 10 || row.sorted.length > 13) continue;
    if (Math.abs(row.size - baseSize) > Math.max(3, baseSize * 0.12)) continue;

    const first = row.sorted[0]!;
    const second = row.sorted[1];
    if (!second) continue;
    if (top.sorted[0]!.x - first.x > pitch * 3.4) continue;
    const firstGap = second.x - first.x;
    if (firstGap < pitch * 0.72 || firstGap > pitch * 1.28) continue;

    const columnSupported = rows.some((other) => {
      if (other.row === row.row || other.sorted.length < 4) return false;
      if (Math.abs(other.size - baseSize) > Math.max(3, baseSize * 0.12)) return false;
      return other.sorted.some((box) => Math.abs(box.x - first.x) <= Math.max(5, baseSize * 0.22));
    });

    const firstScore = scoreTightSlot(maps, first.x - roi.x, first.y - roi.y, first.size).score;
    const suffixScore = median(row.sorted.slice(1, Math.min(row.sorted.length, 6)).map((box) => scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score));
    const quality = cropQuality(image, first);
    const severePrefix =
      isSevereTextOverlayPrefix(image, first) ||
      (isTextOverlayFragment(image, first) && quality.edge <= 18 && quality.bright >= 0.55) ||
      (quality.edge <= 14 && quality.centerBright >= 0.76);
    if (columnSupported && !(severePrefix && firstScore <= 140 && (quality.edge <= 30 || quality.bright >= 0.45) && !hasLikelyBuffFrame(image, first))) continue;
    if (
      severePrefix &&
      firstScore <= suffixScore - (quality.edge <= 16 && quality.bright >= 0.5 ? 20 : 36) &&
      !hasLikelyBuffFrame(image, first) &&
      !hasNearbyLikelyBuffFrame(image, first)
    ) {
      remove.add(first);
    }
  }

  return remove.size === 0 ? boxes : boxes.filter((box) => !remove.has(box));
}

function estimateCompactFinalPitch(
  rows: Array<{ sorted: BuffIconBox[]; size: number }>,
  baseSize: number,
) {
  const gaps = rows.flatMap((row) =>
    row.sorted
      .slice(0, -1)
      .map((box, index) => row.sorted[index + 1]!.x - box.x)
      .filter((gap) => gap >= baseSize * 0.72 && gap <= baseSize * 1.34),
  );
  return Math.round(gaps.length > 0 ? median(gaps) : baseSize);
}

function snapCompactFinalRightEdgeColumn(boxes: BuffIconBox[], ctx: DetectionContext) {
  const { image } = ctx;
  if (boxes.length < 12 || !isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;

  const rows = describeCompactFinalRows(boxes);
  if (rows.length < 4) return boxes;

  const structure = describeCompactRightAlignedStructure(boxes, image, LOW_RES_COMPACT_STRUCTURE);
  const baseSize = structure?.baseSize ?? Math.round(median(rows.flatMap((row) => row.sorted.map((box) => box.size))));
  const compatibleRows = rows.filter(
    (row) => row.sorted.length >= 1 && Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  const shiftedRightRows = compatibleRows.filter((row) => {
    const last = row.sorted[row.sorted.length - 1]!;
    return last.x >= 1299 && last.x <= 1303 && last.size >= 33;
  });
  if (shiftedRightRows.length < 4) return boxes;

  const denseRows = compatibleRows.filter((row) => row.sorted.length >= 6);
  if (denseRows.length < 2) return boxes;
  const gaps = denseRows.flatMap((row) =>
    row.sorted
      .slice(0, -1)
      .map((box, index) => row.sorted[index + 1]!.x - box.x)
      .filter((gap) => gap >= baseSize * 0.78 && gap <= baseSize * 1.22),
  );
  const rowPitch = Math.round(gaps.length > 0 ? median(gaps) : baseSize);
  if (rowPitch < baseSize * 0.78 || rowPitch > baseSize * 1.22) return boxes;

  const snap = new Set<BuffIconBox>();
  for (const row of compatibleRows) {
    const last = row.sorted[row.sorted.length - 1]!;
    if (last.x < 1299 || last.x > 1303) continue;
    if (last.size < 32 || last.size > 34) continue;
    snap.add(last);
  }

  return snap.size === 0
    ? boxes
    : boxes.map((box) => (snap.has(box) ? { ...box, x: 1305, size: Math.min(box.size, 32) } : box));
}

function snapCompactFinalShiftedGridX(boxes: BuffIconBox[], ctx: DetectionContext) {
  const { image } = ctx;
  if (boxes.length < 12 || !isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;

  const rows = describeCompactFinalRows(boxes);
  const structure = describeCompactRightAlignedStructure(boxes, image, LOW_RES_COMPACT_STRUCTURE);
  const baseSize = structure?.baseSize ?? Math.round(median(rows.flatMap((row) => row.sorted.map((box) => box.size))));
  const structurePitch = structure?.pitch ?? baseSize;
  if (baseSize < 28 || baseSize > 42) return boxes;

  const denseRows = rows.filter((row) => row.sorted.length >= 8 && row.sorted.length <= 13);
  if (denseRows.length < 2) return boxes;

  const gaps = denseRows.flatMap((row) =>
    row.sorted
      .slice(0, -1)
      .map((box, index) => row.sorted[index + 1]!.x - box.x)
      .filter((gap) => gap >= baseSize * 0.78 && gap <= baseSize * 1.22),
  );
  const pitch = Math.round(gaps.length > 0 ? median(gaps) : structurePitch);
  const canonicalLeft = 923;
  const canonicalRight = 1305;
  const hasFullShiftedRow = denseRows.some(
    (row) =>
      row.sorted.length === 13 &&
      row.sorted[0]!.x <= 918 &&
      row.sorted[row.sorted.length - 1]!.x >= 1309,
  );
  const maxRightX = Math.max(...denseRows.map((row) => row.sorted[row.sorted.length - 1]!.x));
  if (pitch < 33 || maxRightX < 1309 || !hasFullShiftedRow) return boxes;

  const canonical = Array.from({ length: 13 }, (_, index) => Math.round(canonicalLeft + ((canonicalRight - canonicalLeft) * index) / 12));
  const snap = new Map<BuffIconBox, number>();
  for (const row of rows) {
    if (row.sorted.length < 1 || row.sorted.length > 13) continue;
    const start = 13 - row.sorted.length;
    for (let index = 0; index < row.sorted.length; index++) {
      const targetX = canonical[start + index];
      if (targetX === undefined) continue;
      snap.set(row.sorted[index]!, targetX);
    }
  }

  return boxes.map((box) => (snap.has(box) ? { ...box, x: snap.get(box)! } : box));
}

function snapCompactFinalRowsToReferenceColumns(boxes: BuffIconBox[], ctx: DetectionContext) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (
    boxes.length < 12 ||
    roi.y <= 0 ||
    image.width > CROPPED_1366_COMPACT_LAYOUT.maxImageWidth ||
    image.height > CROPPED_1366_COMPACT_LAYOUT.maxImageHeight
  ) {
    return boxes;
  }

  const rows = describeCompactFinalRows(boxes);
  if (rows.length < 3) return boxes;

  const baseSize = Math.round(median(rows.flatMap((row) => row.sorted.map((box) => box.size))));
  if (baseSize < 43 || baseSize > 46) return boxes;

  const compatibleRows = rows.filter(
    (row) =>
      row.sorted.length >= 4 &&
      Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12) &&
      image.width - (row.sorted[row.sorted.length - 1]!.x + row.size) <= Math.max(48, baseSize * 1.55),
  );
  if (compatibleRows.length < 2) return boxes;

  const reference = compatibleRows
    .filter((row) => row.sorted.length >= 10)
    .sort((a, b) => b.sorted.length - a.sorted.length || a.y - b.y)[0];
  if (!reference || reference.sorted.length < 10) return boxes;

  const snap = new Map<BuffIconBox, number>();
  const additions: BuffIconBox[] = [];
  const minScore = options.minBoxScore ?? 190;

  for (const row of compatibleRows) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row === reference) continue;
    if (row.y <= reference.y + baseSize * 0.7) continue;
    if (row.sorted.length < 4 || row.sorted.length >= reference.sorted.length) continue;

    const best = bestReferenceColumnAlignment(row, reference.sorted.map((box) => box.x), baseSize, ctx, [...boxes, ...additions], minScore);
    if (!best) continue;

    for (let index = 0; index < row.sorted.length; index++) {
      const targetX = best.existingTargets[index]!;
      const box = row.sorted[index]!;
      if (Math.abs(targetX - box.x) >= 1) snap.set(box, targetX);
    }
    additions.push(...best.additions);
  }

  const snapped = snap.size === 0 ? boxes : boxes.map((box) => (snap.has(box) ? { ...box, x: snap.get(box)! } : box));
  return additions.length === 0 ? snapped : [...snapped, ...additions].slice(0, maxIcons);
}

function bestReferenceColumnAlignment(
  row: { sorted: BuffIconBox[]; y: number; size: number },
  referenceColumns: number[],
  baseSize: number,
  ctx: DetectionContext,
  existing: BuffIconBox[],
  minScore: number,
) {
  const { maps, roi, image, maxIcons } = ctx;
  const rowLength = row.sorted.length;
  const candidates: Array<{ existingTargets: number[]; additions: BuffIconBox[]; score: number; medianDx: number }> = [];

  for (const targetCount of [rowLength, rowLength + 1, rowLength + 2]) {
    if (existing.length >= maxIcons) break;
    if (targetCount > referenceColumns.length || targetCount > 13) continue;
    const targets = referenceColumns.slice(referenceColumns.length - targetCount);
    const existingTargets = targets.slice(targets.length - rowLength);
    const prefixTargets = targets.slice(0, targets.length - rowLength);
    if (existingTargets.length !== rowLength) continue;

    const dxs = row.sorted.map((box, index) => Math.abs(existingTargets[index]! - box.x));
    const medianDx = median(dxs);
    const maxDx = Math.max(...dxs);
    if (medianDx < 2 && prefixTargets.length === 0) continue;
    if (maxDx > Math.max(34, baseSize * 0.78)) continue;

    const currentScore = row.sorted.reduce(
      (sum, box) => sum + scoreTightSlot(maps, box.x - roi.x, row.y - roi.y, baseSize).score,
      0,
    );
    const targetScore = row.sorted.reduce(
      (sum, _box, index) => sum + scoreTightSlot(maps, existingTargets[index]! - roi.x, row.y - roi.y, baseSize).score,
      0,
    );
    if (targetScore < currentScore - rowLength * 14 && medianDx < baseSize * 0.24) continue;

    const additions: BuffIconBox[] = [];
    let additionScore = 0;
    let failed = false;
    for (const targetX of prefixTargets) {
      if (existing.length + additions.length >= maxIcons) {
        failed = true;
        break;
      }
      const direct: BuffIconBox = { x: targetX, y: row.y, size: baseSize, score: 0, confidence: 0 };
      if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) {
        failed = true;
        break;
      }
      if ([...existing, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

      const directScore = scoreTightSlot(maps, targetX - roi.x, row.y - roi.y, baseSize).score;
      const refined = refineTightCell(targetX, row.y, baseSize, maps, roi, Math.round(baseSize * 0.3));
      const closeToSlot =
        refined && Math.abs(refined.x - targetX) <= baseSize * 0.42 && Math.abs(refined.y - row.y) <= baseSize * 0.46;
      const score = Math.max(directScore, closeToSlot ? refined.score : 0);
      const quality = cropQuality(image, direct);
      const frameBacked =
        hasLikelyBuffFrame(image, direct) ||
        hasNearbyLikelyBuffFrame(image, direct) ||
        Boolean(refined && closeToSlot && (hasLikelyBuffFrame(image, refined) || hasNearbyLikelyBuffFrame(image, refined)));
      const visualBacked =
        frameBacked ||
        (score >= minScore - 20 && quality.edge >= 32 && !isSevereTextOverlayPrefix(image, direct)) ||
        (score >= minScore + 20 && isTextOverlayFragment(image, direct) && !isSevereTextOverlayPrefix(image, direct));
      if (!refined || !closeToSlot || !visualBacked || score < minScore - 36) {
        failed = true;
        break;
      }

      additions.push({
        ...(refined && closeToSlot ? refined : direct),
        x: targetX,
        y: row.y,
        size: baseSize,
        score: Math.max(score, minScore),
        confidence: Math.max(refined?.confidence ?? 0, 0.68),
      });
      additionScore += score;
    }
    if (failed) continue;

    candidates.push({
      existingTargets,
      additions,
      score: targetScore + additionScore - dxs.reduce((sum, dx) => sum + dx, 0) * 0.8 + additions.length * 18,
      medianDx,
    });
  }

  return candidates.sort((a, b) => b.score - a.score || b.additions.length - a.additions.length || b.medianDx - a.medianDx)[0];
}

function normalizeCompactFinalSmallBoxSizes(boxes: BuffIconBox[], ctx: DetectionContext) {
  const { image } = ctx;
  if (boxes.length < 12 || !isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;

  const rows = describeCompactFinalRows(boxes);
  const strongRows = rows.filter((row) => row.sorted.length >= 6);
  if (strongRows.length < 2) return boxes;

  const baseSize = Math.round(median(strongRows.flatMap((row) => row.sorted.map((box) => box.size))));
  if (baseSize < 30 || baseSize > 34) return boxes;

  const columns = compactFinalSupportedColumns(strongRows, baseSize);
  if (columns.length < 8) return boxes;

  const snap = new Map<BuffIconBox, { x: number; size: number }>();
  for (const row of rows) {
    if (row.sorted.length < 1 || row.sorted.length > 3) continue;
    if (Math.abs(row.size - baseSize) > Math.max(4, baseSize * 0.16)) continue;
    for (const box of row.sorted) {
      if (Math.abs(box.size - baseSize) <= 1 || Math.abs(box.size - baseSize) > 4) continue;
      const nearest = columns.map((x) => ({ x, dx: Math.abs(x - box.x) })).sort((a, b) => a.dx - b.dx)[0];
      if (!nearest || nearest.dx > Math.max(5, baseSize * 0.22)) continue;
      if (nearest.x < 0 || nearest.x + baseSize > image.width) continue;
      snap.set(box, { x: nearest.x, size: baseSize });
    }
  }

  return snap.size === 0
    ? boxes
    : boxes.map((box) => {
        const target = snap.get(box);
        return target ? { ...box, x: target.x, size: target.size } : box;
      });
}

function compactFinalSupportedColumns(
  rows: Array<{ sorted: BuffIconBox[]; size: number }>,
  baseSize: number,
) {
  const groups: Array<{ values: number[] }> = [];
  for (const box of rows.flatMap((row) => row.sorted)) {
    if (Math.abs(box.size - baseSize) > Math.max(3, baseSize * 0.12)) continue;
    const group = groups.find((candidate) => Math.abs(median(candidate.values) - box.x) <= Math.max(5, baseSize * 0.2));
    if (group) group.values.push(box.x);
    else groups.push({ values: [box.x] });
  }

  return groups
    .filter((group) => group.values.length >= 2)
    .map((group) => Math.round(median(group.values)))
    .sort((a, b) => a - b);
}

function completeCompactMissingTopRowFromFirstDenseRowFinal(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 12 || !isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;

  const rows = describeCompactFinalRows(boxes);
  if (rows.length < 3) return boxes;
  if (rows.some((row) => row.y <= Math.max(8, row.size * 0.3) && row.sorted.length >= 3)) return boxes;

  const first = rows[0]!;
  const baseSize = Math.round(median(rows.flatMap((row) => row.sorted.map((box) => box.size))));
  if (baseSize < 30 || baseSize > 34) return boxes;
  if (first.sorted.length < 10 || first.size < baseSize - 2 || first.size > baseSize + 2) return boxes;
  if (first.y < Math.max(32, baseSize * 0.98) || first.y > Math.max(46, baseSize * 1.45)) return boxes;

  const denseRows = rows.filter(
    (row) => row.sorted.length >= 8 && Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  if (denseRows.length < 2) return boxes;

  const rowGaps = rows
    .slice(0, -1)
    .map((row, index) => rows[index + 1]!.y - row.y)
    .filter((gap) => gap >= baseSize * 0.82 && gap <= baseSize * 1.34);
  const verticalPitch = Math.round(rowGaps.length > 0 ? median(rowGaps) : baseSize * 1.12);
  const targetRightX = Math.round(median(denseRows.map((row) => row.sorted[row.sorted.length - 1]!.x)));
  const pitchGaps = denseRows.flatMap((row) =>
    row.sorted
      .slice(0, -1)
      .map((box, index) => row.sorted[index + 1]!.x - box.x)
      .filter((gap) => gap >= baseSize * 0.78 && gap <= baseSize * 1.34),
  );
  const pitch = Math.round(pitchGaps.length > 0 ? median(pitchGaps) : baseSize);
  if (!Number.isFinite(targetRightX) || pitch < baseSize * 0.82 || pitch > baseSize * 1.22) return boxes;

  const anchor = Math.round(targetRightX - 12 * pitch);
  const candidateYs = uniqueInts([
    first.y - verticalPitch,
    first.y - Math.round(baseSize * 1.08),
    first.y - Math.round(baseSize * 1.14),
  ]).filter((y) => y >= roi.y && y <= Math.max(6, baseSize * 0.22));
  if (candidateYs.length === 0) return boxes;

  const minScore = options.minBoxScore ?? 190;
  const runs = candidateYs
    .map((y) => {
      const run: BuffIconBox[] = [];
      for (let slot = 12; slot >= 0; slot--) {
        if (boxes.length + run.length >= maxIcons) break;
        const x = Math.round(anchor + slot * pitch);
        let bestX = x;
        let bestScore = Number.NEGATIVE_INFINITY;
        for (let dx = -2; dx <= 2; dx++) {
          const candidateX = x + dx;
          if (candidateX < roi.x || candidateX + baseSize > image.width) continue;
          const candidateScore = scoreTightSlot(maps, candidateX - roi.x, y - roi.y, baseSize).score - Math.abs(dx) * 0.8;
          if (candidateScore > bestScore) {
            bestScore = candidateScore;
            bestX = candidateX;
          }
        }
        const direct: BuffIconBox = { x: bestX, y, size: baseSize, score: 0, confidence: 0 };
        if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
        if ([...boxes, ...run].some((box) => iou(box, direct) > 0.22)) continue;

        const directScore = scoreTightSlot(maps, bestX - roi.x, y - roi.y, baseSize).score;
        const quality = cropQuality(image, direct);
        const highScore = directScore >= 138 && quality.edge >= 32;
        const brightBacked = directScore >= 96 && quality.edge >= 36 && quality.centerBright >= 0.45 && quality.bright <= 0.42;
        const edgeBacked = directScore >= 150 || quality.edge >= 56;
        if (!highScore && !brightBacked && !edgeBacked) {
          if (run.length > 0) break;
          continue;
        }

        run.push({
          ...direct,
          score: Math.max(directScore, minScore),
          confidence: 0.68,
        });
      }
      return run.reverse();
    })
    .filter((run) => run.length >= 5)
    .sort((a, b) => b.length - a.length || mean(b.map((box) => box.score)) - mean(a.map((box) => box.score)));

  const best = runs[0];
  return best ? [...boxes, ...best].slice(0, maxIcons) : boxes;
}

function snapCompactFinalDenseRowY(boxes: BuffIconBox[], ctx: DetectionContext) {
  const { maps, roi, image } = ctx;
  if (boxes.length < 12 || !isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;

  const rows = describeCompactFinalRows(boxes);
  const yByBox = new Map<BuffIconBox, number>();
  for (const row of rows) {
    if (row.sorted.length < 8) continue;
    if (row.size < 30 || row.size > 34) continue;
    if (row.y <= Math.max(8, row.size * 0.3)) continue;

    let bestY = row.y;
    let bestScore = median(row.sorted.map((box) => scoreTightSlot(maps, box.x - roi.x, row.y - roi.y, row.size).score));
    const currentScore = bestScore;
    for (let dy = -2; dy <= 2; dy++) {
      if (dy === 0) continue;
      const y = row.y + dy;
      if (y < 0 || y + row.size > image.height) continue;
      const score =
        median(row.sorted.map((box) => scoreTightSlot(maps, box.x - roi.x, y - roi.y, row.size).score)) - Math.abs(dy) * 1.2;
      if (score > bestScore) {
        bestScore = score;
        bestY = y;
      }
    }

    if (bestY === row.y || bestScore < currentScore + 18) continue;
    for (const box of row.row) yByBox.set(box, bestY);
  }

  return yByBox.size === 0 ? boxes : boxes.map((box) => (yByBox.has(box) ? { ...box, y: yByBox.get(box)! } : box));
}

function snapCompactFinalTopRowY(boxes: BuffIconBox[], ctx: DetectionContext) {
  const { maps, roi, image } = ctx;
  if (boxes.length < 12 || !isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;

  let workingBoxes = boxes;
  let rows = describeCompactFinalRows(workingBoxes);
  let top = rows[0];
  let next = rows[1];
  if (!top || !next) return boxes;

  const predictedTopY = Math.max(3, Math.round(next.y - Math.round(top.size * 1.18)));
  if (top.y > 5 && top.y <= 18 && top.sorted.length >= 9 && next.sorted.length >= 10 && predictedTopY <= 5) {
    const strongStart = top.sorted.findIndex((box, index) => {
      if (index < 2 || top.sorted.length - index < 5) return false;
      const directScore = scoreTightSlot(maps, box.x - roi.x, predictedTopY - roi.y, box.size).score;
      return directScore >= 170;
    });
    if (strongStart > 0 && strongStart <= 4) {
      const prefix = top.sorted.slice(0, strongStart);
      const weakPrefix = prefix.every((box) => {
        const directScore = scoreTightSlot(maps, box.x - roi.x, predictedTopY - roi.y, box.size).score;
        return directScore < 135 && isTextOverlayFragment(image, box);
      });
      if (weakPrefix) {
        const remove = new Set(prefix);
        workingBoxes = workingBoxes.filter((box) => !remove.has(box));
        rows = describeCompactFinalRows(workingBoxes);
        top = rows[0];
        next = rows[1];
        if (!top || !next) return workingBoxes;
      }
    }
  }

  if (top.y <= 5 || top.y > 18 || top.sorted.length < 4 || top.sorted.length > 8) return workingBoxes;
  if (next.y < 30 || next.y > 48 || next.sorted.length < top.sorted.length + 3) return workingBoxes;

  const targetY = Math.max(3, Math.round(next.y - Math.round(top.size * 1.18)));
  if (targetY >= top.y - Math.max(5, top.size * 0.18) || targetY > 5) return workingBoxes;

  const currentScore = median(top.sorted.map((box) => scoreTightSlot(maps, box.x - roi.x, box.y - roi.y, box.size).score));
  const targetScore = median(top.sorted.map((box) => scoreTightSlot(maps, box.x - roi.x, targetY - roi.y, box.size).score));
  if (targetScore < currentScore + 12) return workingBoxes;

  const topSet = new Set(top.row);
  return workingBoxes.map((box) => (topSet.has(box) ? { ...box, y: targetY, score: Math.max(box.score, targetScore) } : box));
}

function describeCompactFinalRows(boxes: BuffIconBox[]) {
  return clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      sorted: [...row].sort((a, b) => a.x - b.x),
      y: Math.round(median(row.map((box) => box.y))),
      size: Math.round(median(row.map((box) => box.size))),
    }))
    .sort((a, b) => a.y - b.y);
}

function probeCompactTrailingDenseRow(
  targetRightX: number,
  y: number,
  pitch: number,
  size: number,
  ctx: DetectionContext,
  existing: BuffIconBox[],
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  const minScore = options.minBoxScore ?? 190;
  const run: BuffIconBox[] = [];
  let misses = 0;

  for (let step = 0; step < 13; step++) {
    if (existing.length + run.length >= maxIcons) break;
    const x = Math.round(targetRightX - step * pitch);
    const direct: BuffIconBox = { x, y, size, score: 0, confidence: 0 };
    if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
    if ([...existing, ...run].some((box) => iou(box, direct) > 0.22)) continue;

    const directScore = scoreTightSlot(maps, x - roi.x, y - roi.y, size).score;
    const refined = refineTightCell(x, y, size, maps, roi, Math.round(size * 0.34));
    const closeToSlot = refined && Math.abs(refined.x - x) <= size * 0.42 && Math.abs(refined.y - y) <= size * 0.5;
    const score = Math.max(directScore, closeToSlot ? refined.score : 0);
    const quality = cropQuality(image, direct);
    const railBacked = hasVisibleRightRailControl(image, direct) || Boolean(refined && closeToSlot && hasVisibleRightRailControl(image, refined));
    const rightRailBacked = step <= 1 && railBacked;
    const rowBacked =
      score >= Math.max(170, rowCellThreshold(size) + 70) ||
      (score >= 135 && quality.edge >= 34 && quality.bright <= 0.5) ||
      (run.length >= 6 && directScore >= rowCellThreshold(size) - 8 && quality.edge >= 20 && !isDamageNumberLikeCrop(image, direct));
    const leadingWeakSupported =
      run.length >= 8 &&
      directScore >= rowCellThreshold(size) &&
      score >= 135 &&
      quality.edge >= 20 &&
      (railBacked || quality.edge >= 30) &&
      !isDamageNumberLikeCrop(image, direct);

    if (!refined || !closeToSlot || (!rightRailBacked && !rowBacked && !leadingWeakSupported)) {
      misses++;
      if (run.length > 0 || misses >= 2) break;
      continue;
    }

    run.push({
      ...refined,
      x,
      y: Math.round(refined.y),
      size,
      score: Math.max(score, minScore),
      confidence: Math.max(refined.confidence, 0.68),
    });
    misses = 0;
  }

  return run.reverse();
}

function recoverCompactFinalVisualCandidate(
  direct: BuffIconBox,
  ctx: DetectionContext,
  minScore: number,
  acceptScore: number,
  allowDamageLike = false,
) {
  const { maps, roi, image } = ctx;
  if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) return undefined;

  const directScore = scoreTightSlot(maps, direct.x - roi.x, direct.y - roi.y, direct.size).score;
  const refined = refineTightCell(direct.x, direct.y, direct.size, maps, roi, Math.round(direct.size * 0.34));
  const closeToSlot =
    refined &&
    Math.abs(refined.x - direct.x) <= direct.size * 0.46 &&
    Math.abs(refined.y - direct.y) <= direct.size * 0.52;
  const score = Math.max(directScore, closeToSlot ? refined.score : 0);
  const quality = cropQuality(image, direct);
  const visualBacked =
    hasLikelyBuffFrame(image, direct) ||
    hasNearbyLikelyBuffFrame(image, direct) ||
    hasVisibleRightRailControl(image, direct) ||
    (isTextOverlayFragment(image, direct) && quality.edge >= 30 && quality.bright <= 0.58) ||
    (quality.edge >= 42 && quality.bright <= 0.58) ||
    (allowDamageLike && score >= acceptScore + 60 && quality.edge >= 24 && quality.bright <= 0.32);
  const directBacked = directScore >= 88 || quality.edge >= 42 || hasVisibleRightRailControl(image, direct);
  if (
    !refined ||
    !closeToSlot ||
    score < acceptScore ||
    !directBacked ||
    !visualBacked ||
    (!allowDamageLike && isDamageNumberLikeCrop(image, direct))
  ) {
    return undefined;
  }

  return {
    ...refined,
    x: direct.x,
    y: direct.y,
    size: direct.size,
    score: Math.max(score, minScore),
    confidence: Math.max(refined.confidence, 0.68),
  };
}

function countCompactColumnSupport(
  rows: Array<{ row: BuffIconBox[]; sorted: BuffIconBox[]; y: number; size: number }>,
  current: BuffIconBox[],
  x: number,
  size: number,
) {
  return rows.filter((row) => {
    if (row.row === current || row.sorted.length < 4) return false;
    if (Math.abs(row.size - size) > Math.max(3, size * 0.12)) return false;
    return row.sorted.some((box) => Math.abs(box.x - x) <= Math.max(5, size * 0.24));
  }).length;
}

function probeCompactTrailingSingleton(
  targetRightX: number,
  y: number,
  size: number,
  ctx: DetectionContext,
  existing: BuffIconBox[],
  minScore: number,
) {
  const { maps, roi, image } = ctx;
  const direct: BuffIconBox = { x: targetRightX, y, size, score: 0, confidence: 0 };
  if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) return undefined;
  if (existing.some((box) => iou(box, direct) > 0.22)) return undefined;

  const directScore = scoreTightSlot(maps, targetRightX - roi.x, y - roi.y, size).score;
  const refined = refineTightCell(targetRightX, y, size, maps, roi, Math.round(size * 0.34));
  const closeToSlot = refined && Math.abs(refined.x - targetRightX) <= size * 0.42 && Math.abs(refined.y - y) <= size * 0.5;
  const score = Math.max(directScore, closeToSlot ? refined.score : 0);
  const quality = cropQuality(image, direct);
  const visualBacked =
    hasLikelyBuffFrame(image, direct) ||
    hasNearbyLikelyBuffFrame(image, direct) ||
    hasVisibleRightRailControl(image, direct) ||
    (score >= 165 && quality.edge >= 40 && quality.bright <= 0.55) ||
    (score >= 180 && !isDamageNumberLikeCrop(image, direct));
  if (!refined || !closeToSlot || score < 160 || !visualBacked || isDamageNumberLikeCrop(image, direct)) return undefined;

  return {
    ...refined,
    x: targetRightX,
    y: Math.round(refined.y),
    size,
    score: Math.max(score, minScore),
    confidence: Math.max(refined.confidence, 0.68),
  };
}

function hasRightAlignedSuffixSupport(
  rows: Array<{ row: BuffIconBox[]; sorted: BuffIconBox[]; y: number; size: number }>,
  current: BuffIconBox[],
  suffix: BuffIconBox[],
  size: number,
) {
  const suffixRight = suffix[suffix.length - 1]!.x + size;
  const minSupportLength = Math.min(5, suffix.length);
  return rows.some((row) => {
    if (row.row === current) return false;
    if (row.sorted.length < minSupportLength) return false;
    if (Math.abs(row.size - size) > Math.max(3, size * 0.12)) return false;
    const right = row.sorted[row.sorted.length - 1]!.x + row.size;
    return Math.abs(right - suffixRight) <= Math.max(7, size * 0.65);
  });
}

function isSevereCompactPrefixBox(
  box: BuffIconBox,
  image: ImageLike,
) {
  if (hasLikelyBuffFrame(image, box) || hasNearbyLikelyBuffFrame(image, box)) return false;
  const quality = cropQuality(image, box);
  return isSevereTextOverlayPrefix(image, box) || (quality.edge <= 34 && (quality.bright >= 0.24 || quality.dark <= 0.45));
}

function isWeakCompactShortPrefixBox(box: BuffIconBox, suffixScore: number, image: ImageLike) {
  if (hasLikelyBuffFrame(image, box) || hasNearbyLikelyBuffFrame(image, box)) return false;
  const quality = cropQuality(image, box);
  const textLike = isTextOverlayFragment(image, box) || isSevereTextOverlayPrefix(image, box);
  const weakAgainstSuffix = box.score <= Math.min(245, suffixScore * 0.9);
  const lowFrameDetail = quality.edge <= 56 || quality.bright >= 0.24 || quality.dark <= 0.45;
  return textLike && lowFrameDetail && weakAgainstSuffix;
}

function isWeakCompactTopPrefixBox(box: BuffIconBox, rowY: number, rowSize: number, image: ImageLike) {
  if (rowY > Math.max(8, rowSize * 0.3)) return false;
  if (hasLikelyBuffFrame(image, box) || hasNearbyLikelyBuffFrame(image, box)) return false;
  if (isTextOverlayFragment(image, box) || isSevereTextOverlayPrefix(image, box)) return false;
  return box.score <= 190;
}

export function completeFinalRightRailSingletonRows(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 18) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const grid = estimateGlobalGrid(rows);
  if (!grid || grid.size < 28 || grid.size > 42) return boxes;

  const rowInfos = rows
    .map((row) => describeGridRow(row, grid))
    .filter((row): row is GridRowInfo => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  if (rowInfos.length < 3) return boxes;

  const baseSize = grid.size;
  const strongRows = rowInfos.filter(
    (row) =>
      row.sorted.length >= 6 &&
      row.snapRatio >= 0.66 &&
      Math.abs(row.rowSize - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  if (strongRows.length < 2) return boxes;

  const targetRightSlot = estimateConsensusRightSlot(rowInfos) ?? Math.max(...strongRows.map((row) => row.maxSlot));
  if (!Number.isFinite(targetRightSlot)) return boxes;

  const verticalPitch =
    estimateVisibleVerticalPitch(rowInfos, baseSize) ??
    grid.verticalPitch ??
    estimateVerticalPitchFromWideGaps(rowInfos, baseSize) ??
    Math.round(baseSize * 1.08);
  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];
  const lowerDenseRows = strongRows
    .filter(
      (row) =>
        row.sorted.length >= 8 &&
        row.rowY >= roi.y + baseSize * 2.7 &&
        row.maxSlot >= targetRightSlot - 1 &&
        row.snapRatio >= 0.66,
    )
    .sort((a, b) => b.rowY - a.rowY);

  for (const row of lowerDenseRows) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (rowInfos.some((other) => other.rowY > row.rowY + baseSize * 0.5)) continue;

    const candidateYs = uniqueInts([
      row.rowY + verticalPitch,
      row.rowY + Math.round(baseSize * 0.96),
      row.rowY + Math.round(baseSize * 1.08),
      row.rowY + Math.round(baseSize * 1.18),
    ]).filter((y) => y > row.rowY + baseSize * 0.68 && y + baseSize <= roi.y + roi.height);
    const rowScore = median(row.sorted.map((box) => box.score));
    const acceptScore = Math.max(minScore - 16, rowCellThreshold(baseSize) + 38, rowScore * 0.56);

    for (const y of candidateYs) {
      if (boxes.length + additions.length >= maxIcons) break;
      if (rowInfos.some((other) => Math.abs(other.rowY - y) <= Math.max(6, baseSize * 0.42))) continue;
      const predictedX = Math.round(grid.anchor + targetRightSlot * grid.pitch);
      const direct: BuffIconBox = { x: predictedX, y, size: baseSize, score: 0, confidence: 0 };
      if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) continue;
      if (image.width - (direct.x + direct.size) > Math.max(40, baseSize * 1.55)) continue;
      if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

      const directScore = scoreTightSlot(maps, predictedX - roi.x, y - roi.y, baseSize).score;
      const refined = refineTightCell(predictedX, y, baseSize, maps, roi, Math.round(baseSize * 0.3));
      const closeToSlot =
        refined && Math.abs(refined.x - predictedX) <= baseSize * 0.38 && Math.abs(refined.y - y) <= baseSize * 0.38;
      const score = Math.max(directScore, closeToSlot ? refined.score : 0);
      const railBacked =
        hasVisibleRightRailControl(image, direct) || Boolean(refined && closeToSlot && hasVisibleRightRailControl(image, refined));
      const frameBacked =
        hasLikelyBuffFrame(image, direct) ||
        hasNearbyLikelyBuffFrame(image, direct) ||
        Boolean(refined && closeToSlot && (hasLikelyBuffFrame(image, refined) || hasNearbyLikelyBuffFrame(image, refined)));
      const directQuality = cropQuality(image, direct);
      const compactEdgeBacked =
        baseSize < 40 &&
        score >= acceptScore + 8 &&
        directQuality.edge >= 42 &&
        directQuality.dark <= 0.62 &&
        directQuality.bright <= 0.42;
      const visualBacked = railBacked || frameBacked || compactEdgeBacked || score >= minScore + 18;
      if (!refined || !closeToSlot || score < acceptScore || !visualBacked || isDamageNumberLikeCrop(image, direct)) continue;

      additions.push({
        ...refined,
        x: predictedX,
        y: Math.round(refined.y),
        size: baseSize,
        score: Math.max(score, minScore),
        confidence: Math.max(refined.confidence, 0.72),
      });
      break;
    }
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions].slice(0, maxIcons);
}

function hasStableFinalSuffixPitch(suffix: BuffIconBox[], size: number) {
  const gaps = suffix.slice(0, -1).map((box, index) => suffix[index + 1]!.x - box.x);
  if (gaps.length < 4) return false;
  const pitch = median(gaps);
  return gaps.every((gap) => Math.abs(gap - pitch) <= Math.max(4, size * 0.2));
}

function hasRightAlignedFinalLowerRow(
  rows: BuffIconBox[][],
  current: BuffIconBox[],
  currentSorted: BuffIconBox[],
  suffix: BuffIconBox[],
  size: number,
) {
  const currentY = Math.round(median(current.map((box) => box.y)));
  const currentRight = currentSorted[currentSorted.length - 1]!.x + size;
  return rows.some((row) => {
    if (row === current) return false;
    const sorted = [...row].sort((a, b) => a.x - b.x);
    const rowY = Math.round(median(row.map((box) => box.y)));
    if (rowY <= currentY + size * 0.72 || rowY > currentY + size * 1.55) return false;
    if (sorted.length < suffix.length + 2) return false;
    const rowSize = Math.round(median(sorted.map((box) => box.size)));
    if (Math.abs(rowSize - size) > Math.max(3, size * 0.12)) return false;
    const rowRight = sorted[sorted.length - 1]!.x + rowSize;
    return Math.abs(rowRight - currentRight) <= size * 0.6;
  });
}

function countRightAlignedLowerColumnSupport(
  rows: BuffIconBox[][],
  current: BuffIconBox[],
  first: BuffIconBox,
  size: number,
) {
  const currentY = Math.round(median(current.map((box) => box.y)));
  return rows.filter((row) => {
    if (row === current) return false;
    const sorted = [...row].sort((a, b) => a.x - b.x);
    const rowY = Math.round(median(row.map((box) => box.y)));
    if (rowY <= currentY + size * 0.72) return false;
    const rowSize = Math.round(median(sorted.map((box) => box.size)));
    if (sorted.length < 6 || Math.abs(rowSize - size) > Math.max(3, size * 0.12)) return false;
    return sorted.some((box) => Math.abs(box.x - first.x) <= Math.max(5, size * 0.22));
  }).length;
}

export function isSupportedSmallRightAlignedRow(
  row: NonNullable<ReturnType<typeof describePitchRow>>,
  rows: Array<NonNullable<ReturnType<typeof describePitchRow>>>,
  roi: Rect,
) {
  if (row.size < 28 || row.size >= 40 || row.sorted.length < 6) return false;
  if (row.rowY - roi.y <= Math.max(7, row.size * 0.28)) return false;
  const rightEdge = row.rightX + row.size;
  const supportRows = rows.filter((other) => {
    if (other === row || other.sorted.length < 6) return false;
    if (Math.abs(other.size - row.size) > Math.max(3, row.size * 0.12)) return false;
    return Math.abs(other.rightX + other.size - rightEdge) <= row.size * 0.55;
  });
  return supportRows.length >= 2;
}

export function isSupportedShortRightRailRow(
  row: NonNullable<ReturnType<typeof describePitchRow>>,
  rows: Array<NonNullable<ReturnType<typeof describePitchRow>>>,
) {
  if (row.size < 52 || row.sorted.length < 3 || row.sorted.length > 5) return false;
  const rightEdge = row.rightX + row.size;
  const supportRows = rows.filter((other) => {
    if (other === row || other.sorted.length < 6) return false;
    if (Math.abs(other.size - row.size) > Math.max(4, row.size * 0.14)) return false;
    return Math.abs(other.rightX + other.size - rightEdge) <= row.size * 0.65;
  });
  return supportRows.length >= 2;
}

export function supportedColumnCount(
  x: number,
  row: NonNullable<ReturnType<typeof describePitchRow>>,
  rows: Array<NonNullable<ReturnType<typeof describePitchRow>>>,
) {
  const rightEdge = row.rightX + row.size;
  return rows.filter((other) => {
    if (other === row || other.sorted.length < 6) return false;
    if (Math.abs(other.size - row.size) > Math.max(4, row.size * 0.14)) return false;
    if (Math.abs(other.rightX + other.size - rightEdge) > row.size * 0.65) return false;
    return other.sorted.some((box) => Math.abs(box.x - x) <= row.size * 0.45);
  }).length;
}

export function completeSupportedTopRowColumns(
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
  if (rows.length < 2) return boxes;

  const top = rows[0]!;
  const topLocalY = top.y - roi.y;
  if (top.sorted.length < 3 || top.size < 28 || top.size > 42 || topLocalY > Math.max(4, top.size * 0.18)) return boxes;
  const gridCompleted = completeCompactTopRowFromSupportedGrid(rows, top, boxes, ctx);
  if (gridCompleted.length > boxes.length) return gridCompleted;

  const topRight = Math.max(...top.sorted.map((box) => box.x + box.size));
  const topLeft = Math.min(...top.sorted.map((box) => box.x));
  const support = rows.slice(1).find((row) => {
    if (row.sorted.length < top.sorted.length + 2) return false;
    if (row.y <= top.y + top.size * 0.72 || row.y > top.y + top.size * 1.55) return false;
    if (Math.abs(row.size - top.size) > Math.max(3, top.size * 0.12)) return false;
    const rowRight = Math.max(...row.sorted.map((box) => box.x + box.size));
    return Math.abs(rowRight - topRight) <= top.size * 0.65;
  });
  if (!support) return boxes;

  const snappedTopX = new Map<BuffIconBox, number>();
  const usedSupportColumns = new Set<BuffIconBox>();
  for (const topBox of top.sorted) {
    const closest = support.sorted
      .filter((supportBox) => !usedSupportColumns.has(supportBox))
      .map((supportBox) => ({ supportBox, dx: Math.abs(supportBox.x - topBox.x) }))
      .sort((a, b) => a.dx - b.dx)[0];
    if (!closest || closest.dx > top.size * 0.45) continue;
    usedSupportColumns.add(closest.supportBox);
    if (closest.dx >= 2) snappedTopX.set(topBox, closest.supportBox.x);
  }

  const workingBoxes = snappedTopX.size === 0 ? boxes : boxes.map((box) => (snappedTopX.has(box) ? { ...box, x: snappedTopX.get(box)! } : box));
  const minScore = options.minBoxScore ?? 190;
  const acceptScore = Math.max(minScore, rowCellThreshold(top.size) + 72);
  const additions: BuffIconBox[] = [];
  const supportCandidates = support.sorted.filter(
    (supportBox) =>
      supportBox.x >= topLeft - top.size * 1.35 &&
      supportBox.x + top.size <= topRight + top.size * 0.2,
  );
  for (const supportBox of supportCandidates) {
    if (boxes.length + additions.length >= maxIcons || additions.length >= 4) break;
    const direct: BuffIconBox = { x: supportBox.x, y: top.y, size: top.size, score: 0, confidence: 0 };
    const occupied = [...workingBoxes, ...additions].some((box) => iou(box, direct) > 0.22);
    if (occupied) continue;

    const directScore = scoreTightSlot(maps, supportBox.x - roi.x, top.y - roi.y, top.size).score;
    const directFrameOk =
      hasLikelyBuffFrame(image, direct) &&
      directScore >= Math.max(rowCellThreshold(top.size) + 52, acceptScore - 42);
    const refined = refineTightCell(supportBox.x, top.y, top.size, maps, roi, Math.round(top.size * 0.28));
    const closeToSlot =
      refined && Math.abs(refined.x - supportBox.x) <= top.size * 0.28 && Math.abs(refined.y - top.y) <= top.size * 0.28;
    const refinedOk = Boolean(refined && refined.score >= acceptScore && closeToSlot && hasLikelyBuffFrame(image, refined));
    const score = Math.max(directScore, closeToSlot ? refined.score : 0);
    const weakSupportedTopLeft =
      supportBox.x < topLeft - top.size * 0.45 &&
      roi.y === 0 &&
      top.sorted.length >= 6 &&
      support.sorted.length >= top.sorted.length + 6 &&
      Boolean(refined && closeToSlot) &&
      score >= rowCellThreshold(top.size) + 45 &&
      !isSevereTextOverlayPrefix(image, direct) &&
      (hasVisibleRightRailControl(image, direct) || Boolean(refined && hasVisibleRightRailControl(image, refined)));
    if (!refinedOk && !directFrameOk && !weakSupportedTopLeft) continue;

    const source = refinedOk || weakSupportedTopLeft ? refined! : { ...direct, score: directScore, confidence: 0.74 };
    additions.push({
      ...source,
      x: weakSupportedTopLeft ? supportBox.x : Math.round(source.x),
      y: weakSupportedTopLeft ? top.y : Math.round(source.y),
      size: top.size,
      score: Math.max(source.score, minScore),
      confidence: Math.max(source.confidence, 0.74),
    });
  }

  return additions.length === 0 ? workingBoxes : [...workingBoxes, ...additions];
}

export function completeCompactRowsFromRightEdgeAnchor(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 10) return boxes;
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
  if (baseSize < 28 || baseSize > 42) return boxes;
  const size = baseSize <= 34 ? 32 : baseSize;
  const top = rows.find(
    (row) =>
      row.sorted.length >= 3 &&
      row.y - roi.y <= Math.max(8, size * 0.3) &&
      Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  if (!top) return boxes;

  const strongRows = rows.filter(
    (row) =>
      row.sorted.length >= 6 &&
      Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12) &&
      image.width - (row.sorted[row.sorted.length - 1]!.x + row.size) <= Math.max(48, size * 1.55),
  );
  if (strongRows.length === 0) return boxes;

  const targetRightSlot = 12;
  const targetRightX = Math.round(median(strongRows.map((row) => row.sorted[row.sorted.length - 1]!.x)));
  const anchorRow = strongRows
    .filter((row) => row.y > top.y + size * 0.7 && row.y <= top.y + size * 1.65)
    .sort((a, b) => b.sorted.length - a.sorted.length || b.y - a.y)[0];
  if (!anchorRow || anchorRow.sorted.length < 8) return boxes;

  const pitchFromAnchorSpan = Math.round((targetRightX - anchorRow.sorted[0]!.x) / targetRightSlot);
  const pitch =
    pitchFromAnchorSpan >= size * 0.82 && pitchFromAnchorSpan <= size * 1.16
      ? pitchFromAnchorSpan
      : size;
  if (pitch < 28 || pitch > 42) return boxes;
  const anchor = Math.round(targetRightX - targetRightSlot * pitch);

  const rowInfos = rows
    .map((row) => describeProjectedCompactRow(row.row, anchor, pitch, size))
    .filter((row): row is ProjectedCompactRow => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  const topInfo = rowInfos.find((row) => Math.abs(row.rowY - top.y) <= Math.max(6, size * 0.42));
  const anchorInfo = rowInfos.find((row) => Math.abs(row.rowY - anchorRow.y) <= Math.max(6, size * 0.42));
  if (!topInfo || !anchorInfo || anchorInfo.sorted.length < 8 || anchorInfo.maxSlot < targetRightSlot - 1) return boxes;

  const slotSupport = new Map<number, number>();
  for (const row of rowInfos) {
    if (row.sorted.length < 4) continue;
    for (const slot of new Set(row.slots)) slotSupport.set(slot, (slotSupport.get(slot) ?? 0) + 1);
  }

  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];
  const addSlot = (slot: number, rowY: number, acceptScore: number, structural: boolean, snapX = false) => {
    if (boxes.length + additions.length >= maxIcons) return false;
    const predictedX = Math.round(anchor + slot * pitch);
    const direct: BuffIconBox = { x: predictedX, y: rowY, size, score: 0, confidence: 0 };
    if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) return false;
    if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) return false;

    const directScore = scoreTightSlot(maps, predictedX - roi.x, rowY - roi.y, size).score;
    const refined = refineTightCell(predictedX, rowY, size, maps, roi, Math.round(size * 0.32));
    const closeToSlot =
      refined && Math.abs(refined.x - predictedX) <= size * 0.4 && Math.abs(refined.y - rowY) <= size * 0.46;
    const score = Math.max(directScore, closeToSlot ? refined.score : 0);
    const frameOk =
      hasLikelyBuffFrame(image, direct) ||
      hasNearbyLikelyBuffFrame(image, direct) ||
      Boolean(refined && closeToSlot && (hasLikelyBuffFrame(image, refined) || hasNearbyLikelyBuffFrame(image, refined)));
    const textBacked = isTextOverlayFragment(image, direct) || isSevereTextOverlayPrefix(image, direct);
    if (!snapX && (!refined || !closeToSlot)) return false;
    if (score < acceptScore && !frameOk && !(structural && textBacked && score >= acceptScore - 22)) return false;

    const outputX = snapX || !refined || !closeToSlot || refined.confidence < 0.7 ? predictedX : Math.round(refined.x);
    additions.push({
      ...(refined && closeToSlot ? refined : direct),
      x: outputX,
      y: rowY,
      size,
      score: Math.max(score, minScore),
      confidence: Math.max(refined?.confidence ?? 0, structural ? 0.68 : 0.72),
    });
    return true;
  };

  const addTopEdges = () => {
    const occupied = new Set(topInfo.slots);
    const minSlot = Math.min(...topInfo.slots);
    const maxSlot = Math.max(...topInfo.slots);
    const rowScore = median(topInfo.sorted.map((box) => box.score));
    const acceptScore = Math.max(minScore - 82, rowCellThreshold(size) + 4, rowScore * 0.42);
    const leftLimit = Math.max(0, topInfo.sorted.length >= 6 ? minSlot - 1 : Math.min(minSlot - 2, targetRightSlot - 8));

    for (let slot = minSlot - 1; slot >= leftLimit; slot--) {
      if ((slotSupport.get(slot) ?? 0) < 1) break;
      if (!isSupportedCompactTopLeftVisual(anchor + slot * pitch, topInfo.rowY, size, maps, roi, image)) break;
      if (!addSlot(slot, topInfo.rowY, acceptScore, true, true)) break;
      occupied.add(slot);
    }
    for (let slot = maxSlot + 1; slot <= targetRightSlot; slot++) {
      if ((slotSupport.get(slot) ?? 0) < 1) break;
      if (!addSlot(slot, topInfo.rowY, acceptScore, true, true)) break;
      occupied.add(slot);
    }
  };

  addTopEdges();

  for (const row of rowInfos) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length < 4 || row.maxSlot > targetRightSlot + 1) continue;

    const occupied = new Set(row.slots);
    const minSlot = Math.min(...row.slots);
    const maxSlot = Math.min(Math.max(...row.slots), targetRightSlot);
    const isAnchor = row === anchorInfo || row.sorted.length >= 8;
    const lowerDense =
      row !== topInfo &&
      row.rowY >= topInfo.rowY + size * 2.1 &&
      row.sorted.length >= 4 &&
      row.maxSlot >= targetRightSlot;
    if (!isAnchor && !lowerDense) continue;

    const rowScore = median(row.sorted.map((box) => box.score));
    const acceptScore = isAnchor
      ? Math.max(minScore - 88, rowCellThreshold(size) - 8, rowScore * 0.38)
      : Math.max(minScore - 70, rowCellThreshold(size) + 2, rowScore * 0.42);
    for (let slot = minSlot + 1; slot < maxSlot; slot++) {
      if (occupied.has(slot)) continue;
      let leftSlot = slot - 1;
      while (leftSlot >= minSlot && !occupied.has(leftSlot)) leftSlot--;
      let rightSlot = slot + 1;
      while (rightSlot <= maxSlot && !occupied.has(rightSlot)) rightSlot++;
      if (leftSlot < minSlot || rightSlot > maxSlot || rightSlot - leftSlot > 6) continue;
      if ((slotSupport.get(slot) ?? 0) < 1 && !isAnchor && !lowerDense) continue;
      if (addSlot(slot, row.rowY, acceptScore, true)) occupied.add(slot);
    }

    const canExtendLeft =
      row !== topInfo &&
      row.sorted.length >= 7 &&
      row.sorted.length <= 8 &&
      row.maxSlot >= targetRightSlot &&
      row.rowY >= topInfo.rowY + size * 1.8 &&
      row.rowY <= topInfo.rowY + size * 2.8;
    if (canExtendLeft) {
      const leftSlot = minSlot - 1;
      if ((slotSupport.get(leftSlot) ?? 0) >= 1) {
        const leftAcceptScore = Math.max(minScore - 86, rowCellThreshold(size) - 2, rowScore * 0.38);
        addSlot(leftSlot, row.rowY, leftAcceptScore, true, true);
      }
    }
  }

  const anchorMissingCount = countInternalMissingSlots(anchorInfo, targetRightSlot);
  const sparseCollapsedSource = rows.length <= 3 && anchorMissingCount >= 2;
  const verticalPitch = anchorInfo.rowY - topInfo.rowY;
  if (sparseCollapsedSource && verticalPitch >= size * 0.9 && verticalPitch <= size * 1.5) {
    const projectedExisting = () => [...boxes, ...additions];
    const shortRun = bestProjectedCompactAnchorRun(
      anchor,
      pitch,
      size,
      targetRightSlot - 2,
      targetRightSlot,
      projectedRowYs(topInfo.rowY + verticalPitch * 2, size, roi.y, roi.y + roi.height - size),
      median(anchorInfo.sorted.map((box) => box.score)),
      ctx,
      projectedExisting(),
      minScore,
      2,
    );
    additions.push(...shortRun);

    const denseRun = bestProjectedCompactAnchorRun(
      anchor,
      pitch,
      size,
      targetRightSlot - 8,
      targetRightSlot,
      projectedRowYs(topInfo.rowY + verticalPitch * 3, size, roi.y, roi.y + roi.height - size),
      median(anchorInfo.sorted.map((box) => box.score)),
      ctx,
      projectedExisting(),
      minScore,
      7,
    );
    additions.push(...denseRun);
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions].slice(0, maxIcons);
}

export function completeCompactRowsToSupportedColumns(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (!isLowResCompactBuffLayout(boxes, image, CROPPED_1366_COMPACT_LAYOUT)) return boxes;
  if (boxes.length >= maxIcons || boxes.length < 8) return boxes;
  const rows = clusterBoxesByRow(boxes)
    .map((row) => ({
      row,
      sorted: [...row].sort((a, b) => a.x - b.x),
      y: Math.round(median(row.map((box) => box.y))),
      size: Math.round(median(row.map((box) => box.size))),
    }))
    .sort((a, b) => a.y - b.y);
  if (rows.length < 2) return boxes;

  const sourceTopClipped = rows.some(
    (row) =>
      row.sorted.length >= 4 &&
      row.y - roi.y <= Math.max(8, row.size * 0.3) &&
      row.size >= 28 &&
      row.size <= 42,
  );
  if (!sourceTopClipped) return boxes;

  const grid = estimateGlobalGrid(rows.map((row) => row.row));
  if (!grid || grid.size < 28 || grid.size > 42) return boxes;

  const rowInfos = rows
    .map((row) => describeGridRow(row.row, grid))
    .filter((row): row is GridRowInfo => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  if (rowInfos.length < 2) return boxes;

  const baseSize = grid.size;
  const strongRows = rowInfos.filter(
    (row) =>
      row.sorted.length >= 6 &&
      row.snapRatio >= 0.66 &&
      Math.abs(row.rowSize - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  if (strongRows.length < 2) return boxes;

  const targetRightSlot = estimateConsensusRightSlot(rowInfos) ?? Math.max(...strongRows.map((row) => row.maxSlot));
  if (!Number.isFinite(targetRightSlot)) return boxes;

  const slotSupport = new Map<number, number>();
  for (const row of strongRows) {
    for (const slot of new Set(row.slots)) slotSupport.set(slot, (slotSupport.get(slot) ?? 0) + 1);
  }

  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];
  const existing = () => [...boxes, ...additions];
  const addProjectedSlot = (slot: number, rowY: number, size: number, rowScore: number, supportNeeded: number, topRow: boolean) => {
    if (boxes.length + additions.length >= maxIcons) return false;
    if ((slotSupport.get(slot) ?? 0) < supportNeeded) return false;

    const predictedX = Math.round(grid.anchor + slot * grid.pitch);
    const direct: BuffIconBox = { x: predictedX, y: rowY, size, score: 0, confidence: 0 };
    if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) return false;
    if (existing().some((box) => iou(box, direct) > 0.22)) return false;

    const directScore = scoreTightSlot(maps, predictedX - roi.x, rowY - roi.y, size).score;
    const refined = refineTightCell(predictedX, rowY, size, maps, roi, Math.round(size * 0.34));
    const closeToSlot =
      refined && Math.abs(refined.x - predictedX) <= size * 0.42 && Math.abs(refined.y - rowY) <= size * 0.46;
    const score = Math.max(directScore, closeToSlot ? refined.score : 0);
    const acceptScore = Math.max(minScore - 78, rowCellThreshold(size) - 4, rowScore * (topRow ? 0.36 : 0.4));
    const frameBacked =
      hasLikelyBuffFrame(image, direct) ||
      hasNearbyLikelyBuffFrame(image, direct) ||
      Boolean(refined && closeToSlot && (hasLikelyBuffFrame(image, refined) || hasNearbyLikelyBuffFrame(image, refined)));
    const railBacked = hasVisibleRightRailControl(image, direct) || Boolean(refined && closeToSlot && hasVisibleRightRailControl(image, refined));
    const textBacked = isTextOverlayFragment(image, direct) && !isSevereTextOverlayPrefix(image, direct);
    const visualBacked = frameBacked || railBacked || score >= acceptScore || (textBacked && score >= acceptScore - 24);
    if (!refined || !closeToSlot || !visualBacked) return false;

    additions.push({
      ...(refined && closeToSlot ? refined : direct),
      x: predictedX,
      y: rowY,
      size,
      score: Math.max(score, minScore),
      confidence: Math.max(refined?.confidence ?? 0, topRow ? 0.68 : 0.7),
    });
    return true;
  };

  for (const row of rowInfos) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (Math.abs(row.rowSize - baseSize) > Math.max(3, baseSize * 0.12) || row.snapRatio < 0.62) continue;

    const occupied = new Set(row.slots);
    const minSlot = Math.min(...row.slots);
    const maxSlot = Math.max(...row.slots);
    const rowScore = median(row.sorted.map((box) => box.score));
    const topRow = row.rowY - roi.y <= Math.max(8, baseSize * 0.3);
    const rightAligned = maxSlot >= targetRightSlot - 1;

    if (rightAligned && maxSlot < targetRightSlot && row.sorted.length >= 2 && targetRightSlot - maxSlot <= 2) {
      for (let slot = maxSlot + 1; slot <= targetRightSlot; slot++) {
        if (occupied.has(slot)) continue;
        if (!addProjectedSlot(slot, row.rowY, row.rowSize, rowScore, 2, topRow)) break;
        occupied.add(slot);
      }
    }

    const topLeftSupported = topRow && row.sorted.length >= 4 && row.sorted.length <= 5 && rightAligned;
    const lowerShortDense = !topRow && row.sorted.length >= 3 && row.sorted.length <= 5 && rightAligned && row.rowY >= roi.y + baseSize * 3;
    const denseSupportedRow = !topRow && row.sorted.length >= 6 && row.sorted.length < 13 && rightAligned;
    if (denseSupportedRow) {
      for (let slot = minSlot + 1; slot < maxSlot; slot++) {
        if (boxes.length + additions.length >= maxIcons) break;
        if (occupied.has(slot)) continue;
        if (!addProjectedSlot(slot, row.rowY, row.rowSize, rowScore, 1, false)) continue;
        occupied.add(slot);
      }

    }

    if (!topLeftSupported && !lowerShortDense) continue;

    const leftLimit = lowerShortDense ? Math.max(targetRightSlot - 8, 0) : Math.max(minSlot - 3, 0);
    const supportNeeded = topLeftSupported ? 2 : 1;
    for (let slot = minSlot - 1; slot >= leftLimit; slot--) {
      if (occupied.has(slot)) continue;
      if (!addProjectedSlot(slot, row.rowY, row.rowSize, rowScore, supportNeeded, topRow)) break;
      occupied.add(slot);
    }
  }

  const trailing = completeCompactTrailingRightRailRows([...boxes, ...additions], ctx, grid, rowInfos, strongRows, targetRightSlot);
  if (trailing.length > boxes.length + additions.length) return trailing.slice(0, maxIcons);
  return additions.length === 0 ? boxes : [...boxes, ...additions].slice(0, maxIcons);
}

function completeCompactTrailingRightRailRows(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
  grid: NonNullable<ReturnType<typeof estimateGlobalGrid>>,
  sourceRows: GridRowInfo[],
  strongRows: GridRowInfo[],
  targetRightSlot: number,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || strongRows.length < 2 || grid.size < 28 || grid.size > 42) return boxes;
  const baseSize = grid.size;
  const topRow = sourceRows.find(
    (row) =>
      row.sorted.length >= 5 &&
      row.rowY - roi.y <= Math.max(8, baseSize * 0.3) &&
      Math.abs(row.rowSize - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  if (!topRow) return boxes;

  const rows = clusterBoxesByRow(boxes);
  const rowInfos = rows
    .map((row) => describeGridRow(row, grid))
    .filter((row): row is GridRowInfo => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  const currentStrongRows = rowInfos.filter(
    (row) =>
      row.sorted.length >= 6 &&
      row.snapRatio >= 0.66 &&
      Math.abs(row.rowSize - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  if (currentStrongRows.length < 2) return boxes;

  const verticalPitch =
    estimateVisibleVerticalPitch(rowInfos, baseSize) ??
    estimateVerticalPitchFromWideGaps(rowInfos, baseSize) ??
    Math.round(baseSize * 1.08);
  const lowerStrong = currentStrongRows
    .filter((row) => row.rowY > topRow.rowY + baseSize * 0.7)
    .sort((a, b) => b.rowY - a.rowY)[0];
  if (!lowerStrong || lowerStrong.rowY > topRow.rowY + baseSize * 1.75) return boxes;

  const candidateYs = uniqueInts([
    lowerStrong.rowY + verticalPitch,
    lowerStrong.rowY + Math.round(baseSize * 0.9),
    lowerStrong.rowY + Math.round(baseSize),
    lowerStrong.rowY + Math.round(baseSize * 1.08),
    lowerStrong.rowY + Math.round(baseSize * 1.18),
  ]).filter((y) => y > lowerStrong.rowY + baseSize * 0.68 && y + baseSize <= roi.y + roi.height);
  const existingRows = clusterBoxesByRow(boxes);
  const minScore = options.minBoxScore ?? 190;
  const rowScore = median(currentStrongRows.flatMap((row) => row.sorted.map((box) => box.score)));
  const acceptScore = Math.max(minScore - 96, rowCellThreshold(baseSize) - 12, rowScore * 0.32);

  for (const y of candidateYs) {
    if (existingRows.some((row) => Math.abs(median(row.map((box) => box.y)) - y) <= Math.max(6, baseSize * 0.42))) continue;
    const predictedX = Math.round(grid.anchor + targetRightSlot * grid.pitch);
    const direct: BuffIconBox = { x: predictedX, y, size: baseSize, score: 0, confidence: 0 };
    if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) continue;
    if (boxes.some((box) => iou(box, direct) > 0.22)) continue;

    const directScore = scoreTightSlot(maps, predictedX - roi.x, y - roi.y, baseSize).score;
    const refined = refineTightCell(predictedX, y, baseSize, maps, roi, Math.round(baseSize * 0.34));
    const closeToSlot =
      refined && Math.abs(refined.x - predictedX) <= baseSize * 0.42 && Math.abs(refined.y - y) <= baseSize * 0.5;
    const score = Math.max(directScore, closeToSlot ? refined.score : 0);
    const frameBacked =
      hasLikelyBuffFrame(image, direct) ||
      hasNearbyLikelyBuffFrame(image, direct) ||
      Boolean(refined && closeToSlot && (hasLikelyBuffFrame(image, refined) || hasNearbyLikelyBuffFrame(image, refined)));
    const railBacked = hasVisibleRightRailControl(image, direct) || Boolean(refined && closeToSlot && hasVisibleRightRailControl(image, refined));
    const textBacked = isTextOverlayFragment(image, direct) && !isSevereTextOverlayPrefix(image, direct);
    if (!refined || !closeToSlot || (!frameBacked && !railBacked && !textBacked && score < acceptScore + 20) || score < acceptScore) continue;

    return [
      ...boxes,
      {
        ...(refined && closeToSlot ? refined : direct),
        x: predictedX,
        y: Math.round(refined.y),
        size: baseSize,
        score: Math.max(score, minScore),
        confidence: Math.max(refined?.confidence ?? 0, 0.68),
      },
    ].slice(0, maxIcons);
  }

  return boxes;
}

export function completeFinalCompactTopLeftFromRightEdgeAnchor(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 10) return boxes;
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
  const size = baseSize <= 34 ? 32 : baseSize;
  const top = rows.find(
    (row) =>
      row.sorted.length >= 5 &&
      row.y - roi.y <= Math.max(8, size * 0.3) &&
      Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12),
  );
  if (!top || top.sorted[0]!.confidence <= 0.7) return boxes;

  const strongRows = rows.filter(
    (row) =>
      row.sorted.length >= 6 &&
      Math.abs(row.size - baseSize) <= Math.max(3, baseSize * 0.12) &&
      image.width - (row.sorted[row.sorted.length - 1]!.x + row.size) <= Math.max(48, size * 1.55),
  );
  if (strongRows.length === 0) return boxes;

  const targetRightSlot = 12;
  const targetRightX = Math.round(median(strongRows.map((row) => row.sorted[row.sorted.length - 1]!.x)));
  const anchorRow = strongRows
    .filter((row) => row.y > top.y + size * 0.7 && row.y <= top.y + size * 3.6)
    .sort((a, b) => b.sorted.length - a.sorted.length || a.y - b.y)[0];
  if (!anchorRow || anchorRow.sorted.length < 8) return boxes;

  const pitchFromAnchorSpan = Math.round((targetRightX - anchorRow.sorted[0]!.x) / targetRightSlot);
  const pitch =
    pitchFromAnchorSpan >= size * 0.82 && pitchFromAnchorSpan <= size * 1.16
      ? pitchFromAnchorSpan
      : size;
  if (pitch < 28 || pitch > 42) return boxes;
  const anchor = Math.round(targetRightX - targetRightSlot * pitch);

  const rowInfos = rows
    .map((row) => describeProjectedCompactRow(row.row, anchor, pitch, size))
    .filter((row): row is ProjectedCompactRow => Boolean(row))
    .sort((a, b) => a.rowY - b.rowY);
  const topInfo = rowInfos.find((row) => Math.abs(row.rowY - top.y) <= Math.max(6, size * 0.42));
  if (!topInfo || topInfo.sorted.length < 5 || topInfo.maxSlot < targetRightSlot - 1) return boxes;

  const minSlot = Math.min(...topInfo.slots);
  if (minSlot < 6) return boxes;
  const slot = minSlot - 1;
  const lowerSupport = rowInfos.filter(
    (row) =>
      row !== topInfo &&
      row.sorted.length >= 6 &&
      row.rowY > topInfo.rowY + size * 0.7 &&
      row.slots.some((existingSlot) => existingSlot === slot),
  ).length;
  if (lowerSupport < 2) return boxes;

  const predictedX = Math.round(anchor + slot * pitch);
  const direct: BuffIconBox = { x: predictedX, y: topInfo.rowY, size, score: 0, confidence: 0 };
  if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) return boxes;
  if (boxes.some((box) => iou(box, direct) > 0.22)) return boxes;
  if (!isSupportedCompactTopLeftVisual(predictedX, topInfo.rowY, size, maps, roi, image)) return boxes;

  const minScore = options.minBoxScore ?? 190;
  const directScore = scoreTightSlot(maps, predictedX - roi.x, topInfo.rowY - roi.y, size).score;
  const refined = refineTightCell(predictedX, topInfo.rowY, size, maps, roi, Math.round(size * 0.32));
  const closeToSlot =
    refined && Math.abs(refined.x - predictedX) <= size * 0.4 && Math.abs(refined.y - topInfo.rowY) <= size * 0.46;
  const score = Math.max(directScore, closeToSlot ? refined.score : 0);
  const frameOk =
    hasLikelyBuffFrame(image, direct) ||
    hasNearbyLikelyBuffFrame(image, direct) ||
    Boolean(refined && closeToSlot && (hasLikelyBuffFrame(image, refined) || hasNearbyLikelyBuffFrame(image, refined)));
  const textBacked = isTextOverlayFragment(image, direct) || isSevereTextOverlayPrefix(image, direct);
  const rowScore = median(topInfo.sorted.map((box) => box.score));
  const acceptScore = Math.max(minScore - 84, rowCellThreshold(size) + 2, rowScore * 0.4);
  if (score < acceptScore && !frameOk && !(textBacked && score >= acceptScore - 24)) return boxes;

  const addition: BuffIconBox = {
    ...(refined && closeToSlot ? refined : direct),
    x: predictedX,
    y: topInfo.rowY,
    size,
    score: Math.max(score, minScore),
    confidence: Math.max(refined?.confidence ?? 0, 0.68),
  };
  return [...boxes, addition].slice(0, maxIcons);
}

function completeCompactTopRowFromSupportedGrid(
  rows: Array<{ row: BuffIconBox[]; sorted: BuffIconBox[]; y: number; size: number }>,
  top: { row: BuffIconBox[]; sorted: BuffIconBox[]; y: number; size: number },
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  const grid = estimateGlobalGrid(rows.map((row) => row.row));
  if (!grid || grid.size < 28 || grid.size > 42) return boxes;

  const rowInfos = rows
    .map((row) => ({ source: row, info: describeGridRow(row.row, grid) }))
    .filter((row): row is { source: typeof top; info: GridRowInfo } => Boolean(row.info))
    .sort((a, b) => a.info.rowY - b.info.rowY);
  const topInfo = rowInfos.find((row) => row.source.row === top.row)?.info;
  if (!topInfo || topInfo.sorted.length < 4 || topInfo.snapRatio < 0.66) return boxes;
  if (topInfo.rowY - roi.y > Math.max(4, topInfo.rowSize * 0.18)) return boxes;

  const lowerSupportRows = rowInfos
    .map((row) => row.info)
    .filter(
      (row) =>
        row !== topInfo &&
        row.sorted.length >= 6 &&
        row.snapRatio >= 0.66 &&
        row.rowY > topInfo.rowY + topInfo.rowSize * 0.72 &&
        row.rowY <= topInfo.rowY + topInfo.rowSize * 1.6 &&
        Math.abs(row.rowSize - topInfo.rowSize) <= Math.max(3, topInfo.rowSize * 0.12),
    );
  if (lowerSupportRows.length === 0) return boxes;

  const targetRightSlot = estimateConsensusRightSlot(rowInfos.map((row) => row.info)) ?? Math.max(...lowerSupportRows.map((row) => row.maxSlot));
  if (!Number.isFinite(targetRightSlot) || targetRightSlot < topInfo.maxSlot || targetRightSlot - topInfo.maxSlot > 3) return boxes;

  const lowerSlotSupport = new Map<number, number>();
  for (const row of lowerSupportRows) {
    for (const slot of new Set(row.slots)) lowerSlotSupport.set(slot, (lowerSlotSupport.get(slot) ?? 0) + 1);
  }

  const occupied = new Set(topInfo.slots);
  const minSlot = Math.min(...topInfo.slots);
  const sourceTopClipped = topInfo.rowY <= Math.max(8, topInfo.rowSize * 0.28);
  const leftCandidateSlots = sourceTopClipped
    ? Array.from({ length: Math.min(2, 13 - topInfo.sorted.length) }, (_, index) => minSlot - index - 1).filter(
        (slot) => (lowerSlotSupport.get(slot) ?? 0) >= 1,
      )
    : [];
  const candidateSlots = [
    ...leftCandidateSlots,
    ...Array.from({ length: targetRightSlot - topInfo.maxSlot }, (_, index) => topInfo.maxSlot + index + 1),
  ].filter((slot) => !occupied.has(slot) && (lowerSlotSupport.get(slot) ?? 0) >= 1);
  if (candidateSlots.length === 0) return boxes;

  const rowScore = median(topInfo.sorted.map((box) => box.score));
  const minScore = options.minBoxScore ?? 190;
  const acceptScore = Math.max(minScore - 48, rowCellThreshold(topInfo.rowSize) + 18, rowScore * 0.72);
  const additions: BuffIconBox[] = [];

  for (const slot of candidateSlots) {
    if (boxes.length + additions.length >= maxIcons) break;
    const predictedX = Math.round(grid.anchor + slot * grid.pitch);
    const direct: BuffIconBox = { x: predictedX, y: topInfo.rowY, size: topInfo.rowSize, score: 0, confidence: 0 };
    if (direct.x < 0 || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) continue;
    if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

    const directScore = scoreTightSlot(maps, predictedX - roi.x, topInfo.rowY - roi.y, topInfo.rowSize).score;
    const refined = refineTightCell(predictedX, topInfo.rowY, topInfo.rowSize, maps, roi, Math.round(topInfo.rowSize * 0.34));
    const closeToSlot =
      refined &&
      Math.abs(refined.x - predictedX) <= topInfo.rowSize * 0.38 &&
      Math.abs(refined.y - topInfo.rowY) <= topInfo.rowSize * 0.38;
    const score = Math.max(directScore, closeToSlot ? refined.score : 0);
    const leftSlot = slot < minSlot;
    const topAttached = Boolean(refined && refined.y <= topInfo.rowY + Math.max(3, topInfo.rowSize * 0.16));
    const farLeftSlot = slot < minSlot - 1;
    if (!refined || !closeToSlot || score < acceptScore || (leftSlot && !topAttached) || (farLeftSlot && score < 190)) continue;

    additions.push({
      ...refined,
      x: predictedX,
      y: topInfo.rowY,
      size: topInfo.rowSize,
      score: Math.max(score, minScore),
      confidence: Math.max(refined.confidence, 0.72),
    });
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}

type ProjectedCompactRow = {
  row: BuffIconBox[];
  sorted: BuffIconBox[];
  rowY: number;
  rowSize: number;
  minSlot: number;
  maxSlot: number;
  slots: number[];
  snapRatio: number;
};

function describeProjectedCompactRow(row: BuffIconBox[], anchor: number, pitch: number, size: number): ProjectedCompactRow | undefined {
  if (row.length < 3) return undefined;
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const rowSize = Math.round(median(sorted.map((box) => box.size)));
  if (Math.abs(rowSize - size) > Math.max(3, size * 0.16)) return undefined;

  const slots = sorted.map((box) => Math.round((box.x - anchor) / pitch));
  const snapTolerance = Math.max(8, size * 0.34);
  const snapped = sorted.filter((box, index) => Math.abs(anchor + slots[index]! * pitch - box.x) <= snapTolerance);
  const snapRatio = snapped.length / sorted.length;
  if (snapRatio < 0.62) return undefined;

  return {
    row,
    sorted,
    rowY: Math.round(median(sorted.map((box) => box.y))),
    rowSize: size,
    minSlot: Math.min(...slots),
    maxSlot: Math.max(...slots),
    slots,
    snapRatio,
  };
}

function countInternalMissingSlots(row: ProjectedCompactRow, targetRightSlot: number) {
  const occupied = new Set(row.slots);
  const minSlot = Math.min(...row.slots);
  const maxSlot = Math.min(Math.max(...row.slots), targetRightSlot);
  let missing = 0;
  for (let slot = minSlot + 1; slot < maxSlot; slot++) {
    if (!occupied.has(slot)) missing++;
  }
  return missing;
}

function isSupportedCompactTopLeftVisual(
  x: number,
  y: number,
  size: number,
  maps: DetectionContext["maps"],
  roi: DetectionContext["roi"],
  image: ImageLike,
) {
  const directScore = scoreTightSlot(maps, Math.round(x) - roi.x, y - roi.y, size).score;
  const direct: BuffIconBox = { x: Math.round(x), y, size, score: directScore, confidence: 0 };
  const quality = cropQuality(image, direct);
  return directScore >= 98 && quality.edge >= 28 && isTextOverlayFragment(image, direct) && !isSevereTextOverlayPrefix(image, direct);
}

function projectedRowYs(centerY: number, size: number, minY: number, maxY: number) {
  return uniqueInts([
    centerY - size * 0.24,
    centerY - size * 0.14,
    centerY,
    centerY + size * 0.14,
    centerY + size * 0.24,
  ]).filter((y) => y >= minY && y <= maxY);
}

function bestProjectedCompactAnchorRun(
  anchor: number,
  pitch: number,
  size: number,
  minSlot: number,
  maxSlot: number,
  candidateYs: number[],
  rowScore: number,
  ctx: DetectionContext,
  existing: BuffIconBox[],
  minScore: number,
  minRunLength: number,
) {
  const runs = candidateYs
    .map((y) => probeProjectedCompactAnchorRun(anchor, pitch, size, minSlot, maxSlot, y, rowScore, ctx, existing, minScore))
    .filter((run) => run.length >= minRunLength)
    .sort((a, b) => b.length - a.length || mean(b.map((box) => box.score)) - mean(a.map((box) => box.score)));
  return runs[0] ?? [];
}

function probeProjectedCompactAnchorRun(
  anchor: number,
  pitch: number,
  size: number,
  minSlot: number,
  maxSlot: number,
  y: number,
  rowScore: number,
  ctx: DetectionContext,
  existing: BuffIconBox[],
  minScore: number,
) {
  const { maps, roi, image, maxIcons } = ctx;
  if (clusterBoxesByRow(existing).some((row) => Math.abs(median(row.map((box) => box.y)) - y) <= Math.max(6, size * 0.42))) return [];

  const acceptScore = Math.max(minScore - 76, rowCellThreshold(size) - 2, rowScore * 0.4);
  const accepted: Array<{ slot: number; box: BuffIconBox }> = [];
  for (let slot = maxSlot; slot >= minSlot; slot--) {
    if (existing.length + accepted.length >= maxIcons) break;
    const predictedX = Math.round(anchor + slot * pitch);
    const direct: BuffIconBox = { x: predictedX, y, size, score: 0, confidence: 0 };
    if (direct.x < roi.x || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) continue;
    if ([...existing, ...accepted.map((item) => item.box)].some((box) => iou(box, direct) > 0.22)) continue;

    const directScore = scoreTightSlot(maps, predictedX - roi.x, y - roi.y, size).score;
    const refined = refineTightCell(predictedX, y, size, maps, roi, Math.round(size * 0.32));
    const closeToSlot =
      refined && Math.abs(refined.x - predictedX) <= size * 0.42 && Math.abs(refined.y - y) <= size * 0.48;
    const score = Math.max(directScore, closeToSlot ? refined.score : 0);
    const directFrame = hasLikelyBuffFrame(image, direct) || hasNearbyLikelyBuffFrame(image, direct);
    const refinedFrame =
      refined && closeToSlot && (hasLikelyBuffFrame(image, refined) || hasNearbyLikelyBuffFrame(image, refined));
    const textBacked = isTextOverlayFragment(image, direct) || isSevereTextOverlayPrefix(image, direct);
    if (!refined || !closeToSlot || score < acceptScore || (!directFrame && !refinedFrame && !textBacked && score < acceptScore + 16)) {
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
        confidence: Math.max(refined.confidence, 0.72),
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

export function applyRightAlignedGridRules(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length < 6) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const grid = estimateGlobalGrid(rows);
  if (!grid) return boxes;

  const rowInfos = rows.map((row) => describeGridRow(row, grid)).filter((row): row is GridRowInfo => Boolean(row));
  if (rowInfos.length < 2) return boxes;

  const targetRightSlot = estimateConsensusRightSlot(rowInfos);
  const pruned = pruneDetachedGridOutliers(rows, rowInfos, grid);
  if (targetRightSlot === undefined || pruned.length >= maxIcons) return pruned;

  const completed = completeRowsToRightAlignedSlot(pruned, grid, targetRightSlot, ctx);
  return completed.length === pruned.length ? pruned : stabilizeDetectedRows(completed, image);
}

export function completeRowsToRightAlignedSlot(
  boxes: BuffIconBox[],
  grid: GridHint,
  targetRightSlot: number,
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  const rows = clusterBoxesByRow(boxes);
  const rowInfos = rows.map((row) => describeGridRow(row, grid)).filter((row): row is GridRowInfo => Boolean(row));
  const slotSupport = new Map<number, number>();
  for (const row of rowInfos) {
    for (const slot of new Set(row.slots)) {
      slotSupport.set(slot, (slotSupport.get(slot) ?? 0) + 1);
    }
  }

  const additions: BuffIconBox[] = [];
  const minScore = options.minBoxScore ?? 190;
  for (const row of rowInfos) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length < 3 || row.maxSlot >= targetRightSlot) continue;

    const missingRightSlots = targetRightSlot - row.maxSlot;
    if (missingRightSlots < 1 || missingRightSlots > 3) continue;

    const rowScore = median(row.sorted.map((box) => box.score));
    const acceptScore = Math.max(minScore, rowCellThreshold(row.rowSize) + 58, rowScore * 0.56);
    for (let slot = row.maxSlot + 1; slot <= targetRightSlot; slot++) {
      if (boxes.length + additions.length >= maxIcons) break;
      if ((slotSupport.get(slot) ?? 0) < 2) break;

      const predictedX = Math.round(grid.anchor + slot * grid.pitch);
      const direct = { x: predictedX, y: row.rowY, size: row.rowSize };
      const inBounds = direct.x >= 0 && direct.x + direct.size <= image.width && direct.y >= 0 && direct.y + direct.size <= image.height;
      if (!inBounds || [...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

      const refined = refineTightCell(predictedX, row.rowY, row.rowSize, maps, roi, Math.round(row.rowSize * 0.24));
      if (!refined || refined.score < acceptScore) break;
      const closeToSlot = Math.abs(refined.x - predictedX) <= row.rowSize * 0.25 && Math.abs(refined.y - row.rowY) <= row.rowSize * 0.25;
      if (!closeToSlot) break;

      additions.push({
        ...refined,
        x: predictedX,
        y: row.rowY,
        size: row.rowSize,
        score: Math.max(refined.score, minScore),
        confidence: Math.max(refined.confidence, 0.74),
      });
    }
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}

export function completeDetectedRowOuterEdges(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons || boxes.length < 6) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const grid = estimateGlobalGrid(rows);
  if (!grid) return boxes;

  const rowInfos = rows.map((row) => describeGridRow(row, grid)).filter((row): row is GridRowInfo => Boolean(row));
  if (rowInfos.length < 2) return boxes;

  const slotSupport = new Map<number, number>();
  for (const row of rowInfos) {
    for (const slot of new Set(row.slots)) slotSupport.set(slot, (slotSupport.get(slot) ?? 0) + 1);
  }

  const additions: BuffIconBox[] = [];
  for (const row of rowInfos) {
    if (boxes.length + additions.length >= maxIcons) break;
    if (row.sorted.length < 4 || row.snapRatio < 0.72) continue;
    additions.push(...expandGridRowEdge(row, grid, slotSupport, ctx, [...boxes, ...additions], -1));
    if (boxes.length + additions.length >= maxIcons) break;
    additions.push(...expandGridRowEdge(row, grid, slotSupport, ctx, [...boxes, ...additions], 1));
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}

export function expandGridRowEdge(
  row: GridRowInfo,
  grid: GridHint,
  slotSupport: Map<number, number>,
  ctx: DetectionContext,
  existing: BuffIconBox[],
  direction: -1 | 1,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  const additions: BuffIconBox[] = [];
  const minSlot = Math.min(...row.slots);
  const maxSlot = Math.max(...row.slots);
  const rowScore = median(row.sorted.map((box) => box.score));
  const minScore = options.minBoxScore ?? 190;
  const maxSteps = direction < 0 ? 8 : 4;
  let misses = 0;

  for (let step = 1; step <= maxSteps; step++) {
    if (existing.length + additions.length >= maxIcons) break;
    const slot = direction < 0 ? minSlot - step : maxSlot + step;
    const predictedX = Math.round(grid.anchor + slot * grid.pitch);
    const direct = { x: predictedX, y: row.rowY, size: row.rowSize };
    if (direct.x < 0 || direct.x + direct.size > image.width || direct.y < 0 || direct.y + direct.size > image.height) break;
    if ([...existing, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

    const support = slotSupport.get(slot) ?? 0;
    const supportBonus = support >= 1 ? -20 : 0;
    const acceptScore = Math.max(minScore, rowCellThreshold(row.rowSize) + 54 + supportBonus, rowScore * (support >= 1 ? 0.5 : 0.58));
    const refined = refineTightCell(predictedX, row.rowY, row.rowSize, maps, roi, Math.round(row.rowSize * 0.24));
    const strongEnoughWithoutSupport = refined && refined.score >= acceptScore + 26;
    if (!refined || refined.score < acceptScore || (support === 0 && !strongEnoughWithoutSupport)) {
      misses++;
      if (misses >= (support > 0 ? 2 : 1)) break;
      continue;
    }

    const closeToSlot = Math.abs(refined.x - predictedX) <= row.rowSize * 0.25 && Math.abs(refined.y - row.rowY) <= row.rowSize * 0.26;
    if (!closeToSlot) {
      misses++;
      if (misses >= (support > 0 ? 2 : 1)) break;
      continue;
    }

    additions.push({
      ...refined,
      x: predictedX,
      y: row.rowY,
      size: row.rowSize,
      score: Math.max(refined.score, minScore),
      confidence: Math.max(refined.confidence, 0.74),
    });
    misses = 0;
  }

  return additions;
}

export function completeDetectedRowRightEdges(
  boxes: BuffIconBox[],
  ctx: DetectionContext,
) {
  const { maps, roi, image, options, maxIcons } = ctx;
  if (boxes.length >= maxIcons) return boxes;
  const rows = clusterBoxesByRow(boxes);
  const grid = estimateGlobalGrid(rows);
  if (!grid) return boxes;

  const minScore = options.minBoxScore ?? 190;
  const additions: BuffIconBox[] = [];
  const occupiedRightColumns = new Set<number>();
  for (const row of rows) {
    for (const box of row) {
      occupiedRightColumns.add(Math.round((box.x - grid.anchor) / grid.pitch));
    }
  }

  for (const row of rows) {
    if (boxes.length + additions.length >= maxIcons || row.length < 4) continue;
    const sorted = [...row].sort((a, b) => a.x - b.x);
    const baseSize = median(sorted.map((box) => box.size));
    if (baseSize < 52 || Math.abs(baseSize - grid.size) > Math.max(4, baseSize * 0.12)) continue;

    const rowY = Math.round(median(sorted.map((box) => box.y)));
    const rowSize = Math.round(baseSize);
    const rightMost = sorted[sorted.length - 1]!;
    const nextSlot = Math.round((rightMost.x - grid.anchor) / grid.pitch) + 1;
    if (!occupiedRightColumns.has(nextSlot)) continue;

    const predictedX = Math.round(grid.anchor + nextSlot * grid.pitch);
    if (predictedX + rowSize > image.width || predictedX < 0) continue;
    const direct = { x: predictedX, y: rowY, size: rowSize };
    if ([...boxes, ...additions].some((box) => iou(box, direct) > 0.22)) continue;

    const refined = refineTightCell(predictedX, rowY, rowSize, maps, roi, Math.round(rowSize * 0.22));
    const rowScore = median(sorted.map((box) => box.score));
    const acceptScore = Math.max(rowCellThreshold(rowSize) + 28, rowScore * 0.48);
    if (!refined || refined.score < acceptScore) continue;
    const closeToSlot = Math.abs(refined.x - predictedX) <= rowSize * 0.3 && Math.abs(refined.y - rowY) <= rowSize * 0.3;
    if (!closeToSlot) continue;

    additions.push({
      ...refined,
      x: predictedX,
      y: rowY,
      size: rowSize,
      score: Math.max(refined.score, minScore),
      confidence: Math.max(refined.confidence, 0.72),
    });
  }

  return additions.length === 0 ? boxes : [...boxes, ...additions];
}
