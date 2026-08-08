import { clamp } from "../geometry.js?v=row-detector-v3-20260524";

export function horizontalLineEvidence(features, x, y, length) {
  return lineEvidence(features, "horizontal", x, y, length);
}

export function verticalLineEvidence(features, x, y, length) {
  return lineEvidence(features, "vertical", x, y, length);
}

export function quickHorizontalDarkEvidence(features, stride, x, y, length) {
  const area = Math.max(1, length);
  const borderDarkRatio = horizontalIntegralMean(features.borderDarkIntegral, stride, x, y, length, area);
  const midDarkRatio = horizontalIntegralMean(features.midDarkIntegral, stride, x, y, length, area);
  const softDarkRatio = horizontalIntegralMean(features.softDarkIntegral, stride, x, y, length, area);
  return Math.max(borderDarkRatio, midDarkRatio * 0.92, softDarkRatio * 0.78);
}

export function quickVerticalDarkEvidence(features, stride, x, y, length) {
  const area = Math.max(1, length);
  const borderDarkRatio = verticalIntegralMean(features.borderDarkIntegral, stride, x, y, length, area);
  const midDarkRatio = verticalIntegralMean(features.midDarkIntegral, stride, x, y, length, area);
  const softDarkRatio = verticalIntegralMean(features.softDarkIntegral, stride, x, y, length, area);
  return Math.max(borderDarkRatio, midDarkRatio * 0.92, softDarkRatio * 0.78);
}

export function quickHorizontalEdgeByte(features, stride, x, y, length) {
  const edgeMean = horizontalIntegralMean(features.edgeIntegral, stride, x, y, length, Math.max(1, length));
  return Math.max(0, Math.min(255, Math.round((edgeMean / 85) * 255)));
}

export function strictHorizontalRatio(features, x1, x2, y) {
  return strictHorizontalHits(features, x1, x2, y) / Math.max(1, x2 - x1);
}

export function strictVerticalRatio(features, x, y1, y2) {
  return strictVerticalHits(features, x, y1, y2) / Math.max(1, y2 - y1);
}

export function strictMinHorizontalAdjacentRatio(features, x1, x2, y) {
  let best = 1;
  for (const offset of [-2, -1, 1, 2]) {
    const adjacentY = y + offset;
    if (adjacentY < 0 || adjacentY >= features.height) continue;
    best = Math.min(best, strictHorizontalRatio(features, x1, x2, adjacentY));
  }
  return best;
}

export function strictMinVerticalAdjacentRatio(features, x, y1, y2) {
  let best = 1;
  for (const offset of [-2, -1, 1, 2]) {
    const adjacentX = x + offset;
    if (adjacentX < 0 || adjacentX >= features.width) continue;
    best = Math.min(best, strictVerticalRatio(features, adjacentX, y1, y2));
  }
  return best;
}

function lineEvidence(features, orientation, x, y, length) {
  const line = lineStats(features, orientation, x, y, length, 0);
  let adjacentDarkMin = 1;
  let adjacentLumaDelta = 0;
  let adjacentEdgeDelta = 0;
  let adjacentCount = 0;

  for (const offset of [-2, -1, 1, 2]) {
    const adjacent = lineStats(features, orientation, x, y, length, offset);
    if (!adjacent) continue;
    adjacentCount += 1;
    adjacentDarkMin = Math.min(adjacentDarkMin, adjacent.borderDarkRatio);
    adjacentLumaDelta = Math.max(adjacentLumaDelta, Math.abs(adjacent.lumaMean - line.lumaMean));
    adjacentEdgeDelta = Math.max(adjacentEdgeDelta, Math.abs(adjacent.edgeMean - line.edgeMean));
  }

  if (!adjacentCount) {
    adjacentDarkMin = 0;
  }

  const darkEvidence = Math.max(line.borderDarkRatio, line.midDarkRatio * 0.92, line.softDarkRatio * 0.78);
  const edgeScore = clamp(line.edgeMean / 85, 0, 1);
  const contrastScore = clamp(Math.max(adjacentLumaDelta / 58, adjacentEdgeDelta / 95), 0, 1);
  const thinScore = clamp(1 - adjacentDarkMin, 0, 1);
  const structureScore = Math.max(edgeScore, contrastScore, thinScore);
  const score = darkEvidence * 0.62 + structureScore * 0.38;

  return {
    score,
    darkEvidence,
    structureScore,
    edgeScore,
    contrastScore,
    thinScore,
    borderDarkRatio: line.borderDarkRatio,
    midDarkRatio: line.midDarkRatio,
    softDarkRatio: line.softDarkRatio,
    edgeMean: line.edgeMean,
    lumaMean: line.lumaMean,
    adjacentDarkMin,
    mode: line.borderDarkRatio >= 0.72 ? "strict-dark" : "soft-contrast",
  };
}

function lineStats(features, orientation, x, y, length, offset) {
  const px = orientation === "vertical" ? x + offset : x;
  const py = orientation === "horizontal" ? y + offset : y;
  if (px < 0 || py < 0 || px >= features.width || py >= features.height) return null;

  const width = orientation === "horizontal" ? length : 1;
  const height = orientation === "vertical" ? length : 1;
  if (px + width > features.width || py + height > features.height) return null;

  const area = Math.max(1, width * height);
  const stride = features.width + 1;
  return {
    borderDarkRatio: integralMean(features.borderDarkIntegral, stride, px, py, width, height, area),
    midDarkRatio: integralMean(features.midDarkIntegral, stride, px, py, width, height, area),
    softDarkRatio: integralMean(features.softDarkIntegral, stride, px, py, width, height, area),
    edgeMean: integralMean(features.edgeIntegral, stride, px, py, width, height, area),
    lumaMean: integralMean(features.lumaIntegral, stride, px, py, width, height, area),
  };
}

function strictHorizontalHits(features, x1, x2, y) {
  const stride = features.width + 1;
  const integral = features.borderDarkIntegral;
  const y1 = y;
  const y2 = y + 1;
  return integral[y2 * stride + x2] - integral[y1 * stride + x2] - integral[y2 * stride + x1] + integral[y1 * stride + x1];
}

function strictVerticalHits(features, x, y1, y2) {
  const stride = features.width + 1;
  const integral = features.borderDarkIntegral;
  const x1 = x;
  const x2 = x + 1;
  return integral[y2 * stride + x2] - integral[y1 * stride + x2] - integral[y2 * stride + x1] + integral[y1 * stride + x1];
}

function horizontalIntegralMean(integral, stride, x, y, length, area) {
  const y1 = y;
  const y2 = y + 1;
  const x2 = x + length;
  return (integral[y2 * stride + x2] - integral[y1 * stride + x2] - integral[y2 * stride + x] + integral[y1 * stride + x]) / area;
}

function verticalIntegralMean(integral, stride, x, y, length, area) {
  const x2 = x + 1;
  const y2 = y + length;
  return (integral[y2 * stride + x2] - integral[y * stride + x2] - integral[y2 * stride + x] + integral[y * stride + x]) / area;
}

function integralMean(integral, stride, x, y, width, height, area) {
  const x1 = x;
  const y1 = y;
  const x2 = x + width;
  const y2 = y + height;
  return (integral[y2 * stride + x2] - integral[y1 * stride + x2] - integral[y2 * stride + x1] + integral[y1 * stride + x1]) / area;
}
