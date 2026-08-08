import { bevelForSide, diagonalBevelScore } from "./bevel.js?v=row-detector-v3-20260524";
import {
  horizontalLineEvidence,
  quickHorizontalDarkEvidence,
  quickHorizontalEdgeByte,
  quickVerticalDarkEvidence,
  strictHorizontalRatio,
  strictMinHorizontalAdjacentRatio,
  strictMinVerticalAdjacentRatio,
  strictVerticalRatio,
  verticalLineEvidence,
} from "./line-evidence.js?v=row-detector-v3-20260524";
import { nonMaxSuppressSpatial } from "./nms.js?v=row-detector-v3-20260524";

const DEFAULTS = {
  minSeedScore: 0.67,
  minLineScore: 0.66,
  minAverageLineScore: 0.73,
  minStructureScore: 0.08,
  scanStep: 2,
  scanStepX: 3,
  scanStepY: 1,
  maxCandidates: 2200,
};

export function findBeveledSquareCandidates(features, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const sides = normalizeSideCandidates(settings.sideCandidates ?? settings.calibratedSides ?? []);
  if (!sides.length) return [];

  const candidates = [];
  for (const side of sides) {
    const scanned = [];
    scanCalibratedSide(features, side, settings, scanned);
    candidates.push(...nonMaxSuppressSpatial(scanned, 0.42, side));
  }

  return candidates.sort((a, b) => a.y - b.y || a.x - b.x || b.score - a.score).slice(0, settings.maxCandidates);
}

export function findStrictBeveledSquareCandidates(features, options = {}) {
  const settings = {
    minEdgeRatio: 0.88,
    minAverageEdgeRatio: 0.93,
    maxAdjacentDarkRatio: 0.72,
    maxCandidates: 600,
    ...options,
  };
  const sides = normalizeSideCandidates(settings.sideCandidates ?? settings.calibratedSides ?? []);
  if (!sides.length) return [];

  const candidates = [];
  for (const side of sides) {
    const scanned = [];
    scanStrictCalibratedSide(features, side, settings, scanned);
    candidates.push(...nonMaxSuppressSpatial(scanned, 0.42, side));
  }

  return candidates.sort((a, b) => a.y - b.y || a.x - b.x || b.score - a.score).slice(0, settings.maxCandidates);
}

function normalizeSideCandidates(values) {
  return [...new Set(values.map((value) => Math.round(value)).filter((value) => Number.isFinite(value) && value > 0))].sort(
    (a, b) => a - b,
  );
}

function scanStrictCalibratedSide(features, side, settings, candidates) {
  const { roi } = features;
  const bevel = bevelForSide(side);
  const lineLength = side - bevel * 2;
  if (lineLength < 8) return;

  const startX = Math.max(roi.x + 2, 2);
  const edgeMargin = settings.allowFrameEdgeCandidates ? 0 : 3;
  const endX = Math.min(roi.x + roi.width - side - edgeMargin, features.width - side - edgeMargin);
  const startY = Math.max(roi.y, 0);
  const endY = Math.min(roi.y + roi.height - side - edgeMargin, features.height - side - edgeMargin);
  if (endX < startX || endY < startY) return;

  for (let y = startY; y <= endY; y += 1) {
    const topY = y + 1;
    const bottomY = y + side - 2;

    for (let x = startX; x <= endX; x += 1) {
      const top = strictHorizontalRatio(features, x + bevel, x + side - bevel, topY);
      if (top < settings.minEdgeRatio) continue;

      const bottom = strictHorizontalRatio(features, x + bevel, x + side - bevel, bottomY);
      if (bottom < settings.minEdgeRatio) continue;

      const topAdjacent = strictMinHorizontalAdjacentRatio(features, x + bevel, x + side - bevel, topY);
      if (topAdjacent > settings.maxAdjacentDarkRatio) continue;

      const bottomAdjacent = strictMinHorizontalAdjacentRatio(features, x + bevel, x + side - bevel, bottomY);
      if (bottomAdjacent > settings.maxAdjacentDarkRatio) continue;

      const left = strictVerticalRatio(features, x + 1, y + bevel, y + side - bevel);
      if (left < settings.minEdgeRatio) continue;

      const right = strictVerticalRatio(features, x + side - 2, y + bevel, y + side - bevel);
      if (right < settings.minEdgeRatio) continue;

      const leftAdjacent = strictMinVerticalAdjacentRatio(features, x + 1, y + bevel, y + side - bevel);
      if (leftAdjacent > settings.maxAdjacentDarkRatio) continue;

      const rightAdjacent = strictMinVerticalAdjacentRatio(features, x + side - 2, y + bevel, y + side - bevel);
      if (rightAdjacent > settings.maxAdjacentDarkRatio) continue;

      const edgeAverage = (top + bottom + left + right) / 4;
      if (edgeAverage < settings.minAverageEdgeRatio) continue;

      const adjacentAverage = (topAdjacent + bottomAdjacent + leftAdjacent + rightAdjacent) / 4;
      const diagonal = diagonalBevelScore(features, x, y, side, bevel);
      const score = edgeAverage * 0.58 + (1 - adjacentAverage) * 0.3 + diagonal * 0.12;

      candidates.push({
        x,
        y,
        width: side,
        height: side,
        side,
        score,
        accepted: true,
        reason: "strict-four-inner-edges",
        top,
        bottom,
        left,
        right,
        diagonal,
      });
    }
  }
}

function scanCalibratedSide(features, side, settings, candidates) {
  const { roi } = features;
  const bevel = bevelForSide(side);
  const lineLength = side - bevel * 2;
  if (lineLength < 8) return;

  const startX = Math.max(roi.x + 2, 2);
  const edgeMargin = settings.allowFrameEdgeCandidates ? 0 : 3;
  const endX = Math.min(roi.x + roi.width - side - edgeMargin, features.width - side - edgeMargin);
  const startY = Math.max(roi.y, 0);
  const endY = Math.min(roi.y + roi.height - side - edgeMargin, features.height - side - edgeMargin);
  if (endX < startX || endY < startY) return;

  const stepX = Math.max(1, Math.round(settings.scanStepX ?? settings.scanStep));
  const stepY = Math.max(1, Math.round(settings.scanStepY ?? settings.scanStep));
  const seedRows = buildHorizontalSeedRows(features, startX, endX, startY, endY, side, bevel, lineLength, stepX);
  const visitedWidth = endX - startX + 1;
  const visited = new Uint8Array(visitedWidth * (endY - startY + 1));

  for (let y = startY; y <= endY; y += stepY) {
    const topY = y + 1;
    const bottomY = y + side - 2;
    const topOffset = (topY - seedRows.y0) * seedRows.xCount;
    const bottomOffset = (bottomY - seedRows.y0) * seedRows.xCount;

    for (let xIndex = 0; xIndex < seedRows.xCount; xIndex += 1) {
      if (!seedRows.pass[topOffset + xIndex] || !seedRows.pass[bottomOffset + xIndex]) continue;
      const topEdge = seedRows.edge[topOffset + xIndex];
      const bottomEdge = seedRows.edge[bottomOffset + xIndex];
      if (topEdge + bottomEdge < 153 && Math.max(topEdge, bottomEdge) < 140) continue;

      const x = startX + xIndex * stepX;
      verifyNeighborhood(
        features,
        x,
        y,
        side,
        bevel,
        lineLength,
        startX,
        endX,
        startY,
        endY,
        stepX,
        stepY,
        settings,
        candidates,
        visited,
        visitedWidth,
      );
    }
  }
}

function buildHorizontalSeedRows(features, startX, endX, startY, endY, side, bevel, lineLength, stepX) {
  const xCount = Math.floor((endX - startX) / stepX) + 1;
  const y0 = startY + 1;
  const y1 = endY + side - 2;
  const yCount = y1 - y0 + 1;
  const pass = new Uint8Array(xCount * yCount);
  const edge = new Uint8Array(xCount * yCount);
  const stride = features.width + 1;

  for (let y = y0; y <= y1; y += 1) {
    const rowOffset = (y - y0) * xCount;
    for (let xIndex = 0; xIndex < xCount; xIndex += 1) {
      const lineX = startX + xIndex * stepX + bevel;
      const darkEvidence = quickHorizontalDarkEvidence(features, stride, lineX, y, lineLength);
      if (darkEvidence < 0.54) continue;
      pass[rowOffset + xIndex] = 1;
      edge[rowOffset + xIndex] = quickHorizontalEdgeByte(features, stride, lineX, y, lineLength);
    }
  }

  return {
    xCount,
    y0,
    pass,
    edge,
  };
}

function verifyNeighborhood(
  features,
  seedX,
  seedY,
  side,
  bevel,
  lineLength,
  startX,
  endX,
  startY,
  endY,
  stepX,
  stepY,
  settings,
  candidates,
  visited,
  visitedWidth,
) {
  const radiusX = Math.max(1, Math.floor(stepX / 2));
  const radiusY = Math.max(0, Math.floor(stepY / 2));
  for (let dy = -radiusY; dy <= radiusY; dy += 1) {
    const y = seedY + dy;
    if (y < startY || y > endY) continue;
    for (let dx = -radiusX; dx <= radiusX; dx += 1) {
      const x = seedX + dx;
      if (x < startX || x > endX) continue;
      const visitedIndex = (y - startY) * visitedWidth + (x - startX);
      if (visited[visitedIndex]) continue;
      visited[visitedIndex] = 1;
      const candidate = verifyCandidate(features, x, y, side, bevel, lineLength, settings);
      if (candidate) candidates.push(candidate);
    }
  }
}

function verifyCandidate(features, x, y, side, bevel, lineLength, settings) {
  const stride = features.width + 1;
  if (quickVerticalDarkEvidence(features, stride, x + 1, y + bevel, lineLength) < 0.54) return null;
  if (quickVerticalDarkEvidence(features, stride, x + side - 2, y + bevel, lineLength) < 0.54) return null;

  const top = horizontalLineEvidence(features, x + bevel, y + 1, lineLength);
  const bottom = horizontalLineEvidence(features, x + bevel, y + side - 2, lineLength);
  if (!isSeed(top, bottom, settings)) return null;

  const left = verticalLineEvidence(features, x + 1, y + bevel, lineLength);
  if (!linePasses(left, settings)) return null;

  const right = verticalLineEvidence(features, x + side - 2, y + bevel, lineLength);
  if (!linePasses(right, settings)) return null;

  const lines = [top, bottom, left, right];
  const averageLine = lines.reduce((sum, line) => sum + line.score, 0) / lines.length;
  const minimumLine = Math.min(...lines.map((line) => line.score));
  if (averageLine < settings.minAverageLineScore) return null;

  const diagonal = diagonalBevelScore(features, x, y, side, bevel);
  if (diagonal < (settings.minDiagonalScore ?? 0.52)) return null;
  const structure = lines.reduce((sum, line) => sum + line.structureScore, 0) / lines.length;
  const score = averageLine * 0.72 + minimumLine * 0.12 + diagonal * 0.1 + structure * 0.06;

  return {
    x,
    y,
    width: side,
    height: side,
    side,
    score,
    accepted: true,
    reason: evidenceReason(lines),
    top: top.score,
    bottom: bottom.score,
    left: left.score,
    right: right.score,
    diagonal,
    edgeBorder: {
      top,
      bottom,
      left,
      right,
    },
  };
}

function isSeed(top, bottom, settings) {
  if (!linePasses(top, settings) || !linePasses(bottom, settings)) return false;
  return (top.score + bottom.score) / 2 >= settings.minSeedScore;
}

function linePasses(line, settings) {
  return (
    line.score >= settings.minLineScore &&
    line.darkEvidence >= 0.54 &&
    line.structureScore >= settings.minStructureScore
  );
}

function evidenceReason(lines) {
  const hasSoft = lines.some((line) => line.mode === "soft-contrast");
  return hasSoft ? "four-side-soft-contrast-evidence" : "four-side-dark-line-evidence";
}
