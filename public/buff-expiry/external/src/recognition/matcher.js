const DEFAULT_MATCH_OPTIONS = {
  alphaThreshold: 8,
  minReferenceAlphaWeight: 0.03,
  timerMaskWeight: 0.18,
  brightDigitWeight: 0.1,
  brightDigitDilatePx: 1,
  colorWeight: 0.78,
  lumaWeight: 0.22,
  hueWeight: 0.28,
  hueBins: 12,
  hueMinChroma: 12,
  hueMinValue: 35,
  minAcceptedScore: 0.7,
  minAcceptedMargin: 0.04,
  topN: 5,
};

export function matchNormalizedIcon(detectedIcon, references, options = {}) {
  const settings = { ...DEFAULT_MATCH_OPTIONS, ...options };
  if (!references.length) {
    return {
      best: null,
      nearestDifferentBuff: null,
      accepted: false,
      reason: "no-references",
      score: 0,
      margin: 0,
      minAcceptedScore: settings.minAcceptedScore,
      minAcceptedMargin: settings.minAcceptedMargin,
      matches: [],
    };
  }

  const matches = references
    .map((reference) => ({
      reference,
      ...compareNormalizedIcons(detectedIcon, reference.normalizedIcon, settings),
    }))
    .sort((a, b) => b.score - a.score);

  const best = matches[0] ?? null;
  const nearestDifferentBuff = findNearestDifferentBuff(matches, best);
  const score = best?.score ?? 0;
  const margin = best && nearestDifferentBuff ? best.score - nearestDifferentBuff.score : score;
  const accepted = score >= settings.minAcceptedScore && margin >= settings.minAcceptedMargin;

  return {
    best,
    nearestDifferentBuff,
    accepted,
    reason: acceptanceReason({ best, accepted, score, margin, settings }),
    score,
    margin,
    minAcceptedScore: settings.minAcceptedScore,
    minAcceptedMargin: settings.minAcceptedMargin,
    matches,
  };
}

export function compareNormalizedIcons(detectedIcon, referenceIcon, options = {}) {
  const settings = { ...DEFAULT_MATCH_OPTIONS, ...options };
  assertComparable(detectedIcon, referenceIcon);

  let weightedDistance = 0;
  let totalWeight = 0;
  let usedPixels = 0;
  let maskedPixels = 0;
  const width = detectedIcon.width;
  const height = detectedIcon.height;
  const digitMask = makeDigitMask(detectedIcon, settings);
  const detectedHue = makeHueHistogram(detectedIcon, settings, digitMask);
  const referenceHue = makeHueHistogram(referenceIcon, settings);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const offset = (y * width + x) * 4;
      const referenceAlpha = referenceIcon.data[offset + 3] / 255;
      const detectedAlpha = detectedIcon.data[offset + 3] / 255;
      const alphaWeight = Math.max(settings.minReferenceAlphaWeight, referenceAlpha);
      let weight = alphaWeight * (0.35 + detectedAlpha * 0.65);

      if (isLowerLeftTimerArea(x, y, width, height)) {
        weight *= settings.timerMaskWeight;
        maskedPixels += 1;
      }

      if (digitMask[pixelIndex]) {
        weight *= settings.brightDigitWeight;
        maskedPixels += 1;
      }

      if (weight <= 0) continue;

      const colorDistance = rgbDistance(detectedIcon.data, referenceIcon.data, offset);
      const lumaDistance = Math.abs(lumaAt(detectedIcon.data, offset) - lumaAt(referenceIcon.data, offset)) / 255;
      const distance = colorDistance * settings.colorWeight + lumaDistance * settings.lumaWeight;
      weightedDistance += distance * weight;
      totalWeight += weight;
      usedPixels += 1;
    }
  }

  const averageDistance = totalWeight ? weightedDistance / totalWeight : 1;
  const pixelScore = clamp(1 - averageDistance, 0, 1);
  const hueScore = compareHueHistograms(detectedHue, referenceHue);
  const score = Number.isFinite(hueScore)
    ? pixelScore * (1 - settings.hueWeight) + hueScore * settings.hueWeight
    : pixelScore;
  return {
    score: clamp(score, 0, 1),
    pixelScore,
    hueScore: Number.isFinite(hueScore) ? hueScore : null,
    distance: averageDistance,
    totalWeight,
    usedPixels,
    maskedPixels,
  };
}

export function rankBuffMatches(detectedItems, references, options = {}) {
  return detectedItems.map((item) => {
    const result = matchNormalizedIcon(item.normalizedIcon, references, options);
    return {
      ...item,
      match: result.accepted ? result.best : null,
      acceptedMatch: result.accepted ? result.best : null,
      candidateMatch: result.best,
      matchStatus: {
        accepted: result.accepted,
        reason: result.reason,
        score: result.score,
        margin: result.margin,
        minAcceptedScore: result.minAcceptedScore,
        minAcceptedMargin: result.minAcceptedMargin,
      },
      matches: result.matches.slice(0, options.topN ?? DEFAULT_MATCH_OPTIONS.topN),
    };
  });
}

function findNearestDifferentBuff(matches, best) {
  if (!best) return null;
  return matches.find((match) => match.reference.buffId !== best.reference.buffId) ?? null;
}

function acceptanceReason({ best, accepted, score, margin, settings }) {
  if (!best) return "no-candidates";
  if (accepted) return "accepted";
  if (score < settings.minAcceptedScore) return "low-score";
  if (margin < settings.minAcceptedMargin) return "low-margin";
  return "rejected";
}

function isLowerLeftTimerArea(x, y, width, height) {
  return x < width * 0.48 && y > height * 0.48;
}

function isCenterTimerArea(x, y, width, height) {
  return x > width * 0.08 && x < width * 0.92 && y > height * 0.34 && y < height * 0.78;
}

function makeDigitMask(imageData, settings) {
  const mask = new Uint8Array(imageData.width * imageData.height);
  const radius = Math.max(0, Math.round(settings.brightDigitDilatePx));

  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      if (!isLowerLeftTimerArea(x, y, imageData.width, imageData.height) && !isCenterTimerArea(x, y, imageData.width, imageData.height)) {
        continue;
      }
      const offset = (y * imageData.width + x) * 4;
      if (!isBrightDigitLike(imageData.data, offset)) continue;
      markMask(mask, imageData.width, imageData.height, x, y, radius);
    }
  }

  return mask;
}

function markMask(mask, width, height, centerX, centerY, radius) {
  for (let y = Math.max(0, centerY - radius); y <= Math.min(height - 1, centerY + radius); y += 1) {
    for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x += 1) {
      mask[y * width + x] = 1;
    }
  }
}

function makeHueHistogram(imageData, settings, skipMask = null) {
  const bins = new Array(settings.hueBins).fill(0);
  let total = 0;

  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const pixelIndex = y * imageData.width + x;
      if (skipMask?.[pixelIndex]) continue;
      const offset = pixelIndex * 4;
      const alpha = imageData.data[offset + 3] / 255;
      if (alpha <= 0.03) continue;
      const r = imageData.data[offset];
      const g = imageData.data[offset + 1];
      const b = imageData.data[offset + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const chroma = max - min;
      if (max < settings.hueMinValue || chroma < settings.hueMinChroma) continue;
      const hue = rgbHue(r, g, b, max, chroma);
      const saturation = chroma / max;
      const value = max / 255;
      const weight = saturation * value * alpha;
      const bin = Math.floor(hue * settings.hueBins) % settings.hueBins;
      bins[bin] += weight;
      total += weight;
    }
  }

  if (total <= 0) return null;
  return bins.map((value) => value / total);
}

function compareHueHistograms(a, b) {
  if (!a || !b) return NaN;
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    distance += Math.abs(a[index] - b[index]);
  }
  return clamp(1 - distance / 2, 0, 1);
}

function rgbHue(r, g, b, max, chroma) {
  let hue;
  if (chroma === 0) {
    hue = 0;
  } else if (max === r) {
    hue = ((g - b) / chroma) % 6;
  } else if (max === g) {
    hue = (b - r) / chroma + 2;
  } else {
    hue = (r - g) / chroma + 4;
  }
  return ((hue / 6) + 1) % 1;
}

function isBrightDigitLike(data, offset) {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const yellow = r > 125 && g > 120 && b < 115 && r + g > b * 2.4;
  const white = max > 178 && max - min < 74;
  return yellow || white;
}

function rgbDistance(a, b, offset) {
  const dr = a[offset] - b[offset];
  const dg = a[offset + 1] - b[offset + 1];
  const db = a[offset + 2] - b[offset + 2];
  return Math.sqrt(dr * dr + dg * dg + db * db) / 441.6729559300637;
}

function lumaAt(data, offset) {
  return data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
}

function assertComparable(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) {
    throw new TypeError("Expected normalized icons with matching dimensions.");
  }
  if (a.data.length < a.width * a.height * 4 || b.data.length < b.width * b.height * 4) {
    throw new RangeError("Normalized icon data is shorter than width * height * 4.");
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
