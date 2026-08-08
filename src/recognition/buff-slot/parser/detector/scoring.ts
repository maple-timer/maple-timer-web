import type { BuffIconBox, FeatureMaps, Rect, Score } from "../types.js";
import { avg, clamp01 } from "./math.js";

export function scoreTightSlot(maps: FeatureMaps, x: number, y: number, size: number): Score {
  if (x < 0 || y < 0 || x + size > maps.width || y + size > maps.height) return { score: 0, confidence: 0 };
  const t = Math.max(1, Math.round(size * 0.055));
  const centerPad = Math.max(t + 1, Math.round(size * 0.14));
  const centerSize = size - centerPad * 2;
  if (centerSize <= 4) return { score: 0, confidence: 0 };

  const topEdge = avg(maps.gradYI, maps.width, x + t, y, size - t * 2, t);
  const bottomEdge = avg(maps.gradYI, maps.width, x + t, y + size - t, size - t * 2, t);
  const leftEdge = avg(maps.gradXI, maps.width, x, y + t, t, size - t * 2);
  const rightEdge = avg(maps.gradXI, maps.width, x + size - t, y + t, t, size - t * 2);
  const borderAvg = (topEdge + bottomEdge + leftEdge + rightEdge) / 4;
  const borderMin = Math.min(topEdge, bottomEdge, leftEdge, rightEdge);
  const borderBalance = borderMin / Math.max(1, borderAvg);

  const centerSat = avg(maps.satI, maps.width, x + centerPad, y + centerPad, centerSize, centerSize);
  const centerEdge = avg(maps.edgeI, maps.width, x + centerPad, y + centerPad, centerSize, centerSize);
  const internalSeam = maxInternalSeam(maps, x, y, size, t);
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

  const edgeScore = borderAvg * 0.95 + borderMin * 0.5 + borderBalance * 20;
  const contentScore = centerSat * 0.34 + centerEdge * 0.13;
  const frameToneScore = darkBorder * 46 + brightBorder * 28;
  const score = edgeScore + contentScore + frameToneScore - internalSeam * 0.82;
  return { score, confidence: clamp01((score - 70) / 160) };
}

function maxInternalSeam(maps: FeatureMaps, x: number, y: number, size: number, thickness: number) {
  const line = Math.max(1, Math.min(2, thickness));
  const spanPad = Math.max(thickness + 1, Math.round(size * 0.12));
  const span = size - spanPad * 2;
  if (span <= 4) return 0;
  let best = 0;
  for (const fraction of [0.25, 0.5, 0.75]) {
    const vx = x + Math.round(size * fraction);
    const hy = y + Math.round(size * fraction);
    if (vx > x + thickness && vx < x + size - thickness) {
      best = Math.max(best, avg(maps.gradXI, maps.width, vx, y + spanPad, line, span));
    }
    if (hy > y + thickness && hy < y + size - thickness) {
      best = Math.max(best, avg(maps.gradYI, maps.width, x + spanPad, hy, span, line));
    }
  }
  return best;
}

export function rowCellThreshold(size: number) {
  if (size <= 34) return 88;
  if (size <= 48) return 104;
  if (size <= 66) return 102;
  return 116;
}

export function rowFrameScore(row: BuffIconBox[], maps: FeatureMaps, roi: Rect, dy: number) {
  let score = 0;
  let used = 0;
  for (const box of row) {
    const size = box.size;
    const x = Math.round(box.x - roi.x);
    const y = Math.round(box.y + dy - roi.y);
    if (x < 0 || y < 0 || x + size > maps.width || y + size > maps.height) continue;
    const t = Math.max(1, Math.round(size * 0.045));
    const horizontalWidth = size - t * 2;
    const topGrad = avg(maps.gradYI, maps.width, x + t, y, horizontalWidth, t);
    const bottomGrad = avg(maps.gradYI, maps.width, x + t, y + size - t, horizontalWidth, t);
    const topDark = avg(maps.darkI, maps.width, x + t, y, horizontalWidth, t);
    const bottomDark = avg(maps.darkI, maps.width, x + t, y + size - t, horizontalWidth, t);
    const internalHorizontal = maxInternalHorizontalSeam(maps, x, y, size, t);
    score += topGrad * 0.9 + bottomGrad * 0.45 + topDark * 190 + bottomDark * 85 - internalHorizontal * 0.28;
    used++;
  }
  return used === 0 ? -Infinity : score / used;
}

function maxInternalHorizontalSeam(maps: FeatureMaps, x: number, y: number, size: number, thickness: number) {
  const line = Math.max(1, Math.min(2, thickness));
  const spanPad = Math.max(thickness + 1, Math.round(size * 0.12));
  const span = size - spanPad * 2;
  if (span <= 4) return 0;

  let best = 0;
  for (const fraction of [0.22, 0.32, 0.5, 0.68, 0.78]) {
    const hy = y + Math.round(size * fraction);
    if (hy > y + thickness && hy < y + size - thickness) {
      best = Math.max(best, avg(maps.gradYI, maps.width, x + spanPad, hy, span, line));
    }
  }
  return best;
}

function maxInternalVerticalSeam(maps: FeatureMaps, x: number, y: number, size: number, thickness: number) {
  const line = Math.max(1, Math.min(2, thickness));
  const spanPad = Math.max(thickness + 1, Math.round(size * 0.12));
  const span = size - spanPad * 2;
  if (span <= 4) return 0;

  let best = 0;
  for (const fraction of [0.22, 0.32, 0.5, 0.68, 0.78]) {
    const vx = x + Math.round(size * fraction);
    if (vx > x + thickness && vx < x + size - thickness) {
      best = Math.max(best, avg(maps.gradXI, maps.width, vx, y + spanPad, line, span));
    }
  }
  return best;
}

export function columnFrameScoreAt(column: BuffIconBox[], maps: FeatureMaps, roi: Rect, targetX: number) {
  let score = 0;
  let used = 0;
  for (const box of column) {
    const size = box.size;
    const x = Math.round(targetX - roi.x);
    const y = Math.round(box.y - roi.y);
    if (x < 0 || y < 0 || x + size > maps.width || y + size > maps.height) continue;
    const t = Math.max(1, Math.round(size * 0.045));
    const verticalHeight = size - t * 2;
    const leftGrad = avg(maps.gradXI, maps.width, x, y + t, t, verticalHeight);
    const rightGrad = avg(maps.gradXI, maps.width, x + size - t, y + t, t, verticalHeight);
    const leftDark = avg(maps.darkI, maps.width, x, y + t, t, verticalHeight);
    const rightDark = avg(maps.darkI, maps.width, x + size - t, y + t, t, verticalHeight);
    const internalVertical = maxInternalVerticalSeam(maps, x, y, size, t);
    score += leftGrad * 0.9 + rightGrad * 0.45 + leftDark * 170 + rightDark * 80 - internalVertical * 0.28;
    used++;
  }
  return used === 0 ? -Infinity : score / used;
}
