import { normalizeDetectedBuffCrop } from "./normalize.js";

const DEFAULT_COUNTDOWN_MATCH_OPTIONS = {
  minAcceptedScore: 0.94,
  minAcceptedBuffMargin: 0.01,
  minAcceptedSecondMargin: 0.004,
  timerAreaWeight: 1.75,
  digitWeight: 2.35,
  colorWeight: 0.68,
  lumaWeight: 0.32,
  topN: 5,
};

const DEFAULT_INITIAL_COUNTDOWN_MATCH_OPTIONS = {
  initialMinSeconds: 21,
  initialMaxSeconds: 59,
  stage1TopBuffs: 2,
};

export function normalizeCountdownReferenceCrop(imageData, options = {}) {
  return normalizeDetectedBuffCrop(
    imageData,
    { x: 0, y: 0, width: imageData.width, height: imageData.height },
    options,
  ).normalizedIcon;
}

export function prepareCountdownSamples(samples) {
  return samples.map((sample) => {
    if (!sample.normalizedIcon) {
      throw new TypeError(`Countdown sample is missing normalizedIcon: ${sample.file ?? sample.buffId ?? "unknown"}`);
    }
    assertComparableSize(sample.normalizedIcon);
    return {
      ...sample,
      kind: sample.kind ?? (Number.isFinite(sample.seconds) ? "second" : "expiring_lt_005"),
    };
  });
}

export function prepareInitialCountdownMatcher(samples, options = {}) {
  const settings = { ...DEFAULT_INITIAL_COUNTDOWN_MATCH_OPTIONS, ...options };
  const activeSamples = samples.filter((sample) => isInitialCountdownSample(sample, settings));
  const samplesByBuff = groupSamplesByBuff(activeSamples);
  const prototypes = [...samplesByBuff.entries()].map(([buffId, buffSamples]) => ({
    buffId,
    normalizedIcon: makeAverageIcon(buffSamples.map((sample) => sample.normalizedIcon)),
    sampleCount: buffSamples.length,
  }));

  return {
    mode: "initial-countdown",
    initialMinSeconds: settings.initialMinSeconds,
    initialMaxSeconds: settings.initialMaxSeconds,
    stage1TopBuffs: settings.stage1TopBuffs,
    samples: activeSamples,
    samplesByBuff,
    prototypes,
    sourceSampleCount: samples.length,
    activeSampleCount: activeSamples.length,
  };
}

export function matchInitialCountdownIcon(detectedIcon, matcher, options = {}) {
  if (Array.isArray(matcher)) {
    return matchCountdownIcon(detectedIcon, matcher, options);
  }

  const settings = {
    ...DEFAULT_COUNTDOWN_MATCH_OPTIONS,
    ...DEFAULT_INITIAL_COUNTDOWN_MATCH_OPTIONS,
    ...(matcher
      ? {
          initialMinSeconds: matcher.initialMinSeconds,
          initialMaxSeconds: matcher.initialMaxSeconds,
          stage1TopBuffs: matcher.stage1TopBuffs,
        }
      : {}),
    ...options,
  };
  assertComparableSize(detectedIcon);

  if (!matcher?.samples?.length) {
    return {
      ...emptyMatch(settings, "no-initial-samples"),
      stage1Matches: [],
      stage1CandidateBuffIds: [],
      candidateSampleCount: 0,
    };
  }

  const stage1Matches = matcher.prototypes
    .map((prototype) => ({
      reference: prototype,
      ...compareCountdownIcons(detectedIcon, prototype.normalizedIcon, settings),
    }))
    .sort((a, b) => b.score - a.score);
  const stage1CandidateBuffIds = stage1Matches
    .slice(0, settings.stage1TopBuffs)
    .map((match) => match.reference.buffId);
  const candidates = stage1CandidateBuffIds.flatMap((buffId) => matcher.samplesByBuff.get(buffId) ?? []);
  const result = matchCountdownIcon(detectedIcon, candidates, settings);

  return {
    ...result,
    stage1Matches,
    stage1CandidateBuffIds,
    candidateSampleCount: candidates.length,
    initialMinSeconds: matcher.initialMinSeconds,
    initialMaxSeconds: matcher.initialMaxSeconds,
  };
}

export function matchCountdownIcon(detectedIcon, samples, options = {}) {
  const settings = { ...DEFAULT_COUNTDOWN_MATCH_OPTIONS, ...options };
  assertComparableSize(detectedIcon);

  if (!samples.length) {
    return emptyMatch(settings, "no-samples");
  }

  const matches = samples
    .map((sample) => ({
      reference: sample,
      ...compareCountdownIcons(detectedIcon, sample.normalizedIcon, settings),
    }))
    .sort((a, b) => b.score - a.score);

  const best = matches[0] ?? null;
  const nearestDifferentBuff = findNearestDifferentBuff(matches, best);
  const nearestDifferentSecond = findNearestDifferentSecond(matches, best);
  const score = best?.score ?? 0;
  const buffMargin = best && nearestDifferentBuff ? score - nearestDifferentBuff.score : score;
  const secondMargin = best && nearestDifferentSecond ? score - nearestDifferentSecond.score : score;
  const accepted = score >= settings.minAcceptedScore && buffMargin >= settings.minAcceptedBuffMargin;
  const secondsAccepted =
    accepted &&
    (best.reference.seconds == null || secondMargin >= settings.minAcceptedSecondMargin);

  return {
    best,
    nearestDifferentBuff,
    nearestDifferentSecond,
    accepted,
    secondsAccepted,
    reason: acceptanceReason({ best, accepted, secondsAccepted, score, buffMargin, secondMargin, settings }),
    score,
    buffMargin,
    secondMargin,
    minAcceptedScore: settings.minAcceptedScore,
    minAcceptedBuffMargin: settings.minAcceptedBuffMargin,
    minAcceptedSecondMargin: settings.minAcceptedSecondMargin,
    matches,
  };
}

export function rankCountdownMatches(detectedItems, samples, options = {}) {
  return detectedItems.map((item) => {
    const result = matchCountdownIcon(item.normalizedIcon, samples, options);
    const reference = result.best?.reference ?? null;
    return {
      ...item,
      countdownMatch: result.accepted ? reference : null,
      countdownCandidate: reference,
      countdownStatus: {
        accepted: result.accepted,
        secondsAccepted: result.secondsAccepted,
        reason: result.reason,
        score: round(result.score),
        buffMargin: round(result.buffMargin),
        secondMargin: round(result.secondMargin),
        minAcceptedScore: result.minAcceptedScore,
        minAcceptedBuffMargin: result.minAcceptedBuffMargin,
        minAcceptedSecondMargin: result.minAcceptedSecondMargin,
      },
      countdownTopMatches: result.matches
        .slice(0, options.topN ?? DEFAULT_COUNTDOWN_MATCH_OPTIONS.topN)
        .map((match) => serializeCountdownMatch(match)),
    };
  });
}

export function rankInitialCountdownMatches(detectedItems, matcher, options = {}) {
  return detectedItems.map((item) => {
    const result = matchInitialCountdownIcon(item.normalizedIcon, matcher, options);
    const reference = result.best?.reference ?? null;
    return {
      ...item,
      countdownMatch: result.accepted ? reference : null,
      countdownCandidate: reference,
      countdownStatus: {
        accepted: result.accepted,
        secondsAccepted: result.secondsAccepted,
        reason: result.reason,
        score: round(result.score),
        buffMargin: round(result.buffMargin),
        secondMargin: round(result.secondMargin),
        minAcceptedScore: result.minAcceptedScore,
        minAcceptedBuffMargin: result.minAcceptedBuffMargin,
        minAcceptedSecondMargin: result.minAcceptedSecondMargin,
        candidateSampleCount: result.candidateSampleCount,
        stage1CandidateBuffIds: result.stage1CandidateBuffIds,
      },
      countdownTopMatches: result.matches
        .slice(0, options.topN ?? DEFAULT_COUNTDOWN_MATCH_OPTIONS.topN)
        .map((match) => serializeCountdownMatch(match)),
    };
  });
}

export function compareCountdownIcons(detectedIcon, referenceIcon, options = {}) {
  const settings = { ...DEFAULT_COUNTDOWN_MATCH_OPTIONS, ...options };
  assertComparable(detectedIcon, referenceIcon);

  let weightedDistance = 0;
  let totalWeight = 0;
  let timerPixels = 0;
  let digitPixels = 0;
  const width = detectedIcon.width;
  const height = detectedIcon.height;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const detectedAlpha = detectedIcon.data[offset + 3] / 255;
      const referenceAlpha = referenceIcon.data[offset + 3] / 255;
      if (detectedAlpha <= 0.01 && referenceAlpha <= 0.01) continue;

      let weight = 0.25 + Math.max(detectedAlpha, referenceAlpha) * 0.75;
      if (isCountdownTimerArea(x, y, width, height)) {
        weight *= settings.timerAreaWeight;
        timerPixels += 1;
      }
      if (isDigitLike(detectedIcon.data, offset) || isDigitLike(referenceIcon.data, offset)) {
        weight *= settings.digitWeight;
        digitPixels += 1;
      }

      const colorDistance = rgbDistance(detectedIcon.data, referenceIcon.data, offset);
      const lumaDistance = Math.abs(lumaAt(detectedIcon.data, offset) - lumaAt(referenceIcon.data, offset)) / 255;
      const distance = colorDistance * settings.colorWeight + lumaDistance * settings.lumaWeight;
      weightedDistance += distance * weight;
      totalWeight += weight;
    }
  }

  const averageDistance = totalWeight ? weightedDistance / totalWeight : 1;
  const score = clamp(1 - averageDistance, 0, 1);
  return {
    score,
    distance: averageDistance,
    totalWeight,
    timerPixels,
    digitPixels,
  };
}

function emptyMatch(settings, reason) {
  return {
    best: null,
    nearestDifferentBuff: null,
    nearestDifferentSecond: null,
    accepted: false,
    secondsAccepted: false,
    reason,
    score: 0,
    buffMargin: 0,
    secondMargin: 0,
    minAcceptedScore: settings.minAcceptedScore,
    minAcceptedBuffMargin: settings.minAcceptedBuffMargin,
    minAcceptedSecondMargin: settings.minAcceptedSecondMargin,
    matches: [],
  };
}

function findNearestDifferentBuff(matches, best) {
  if (!best) return null;
  return matches.find((match) => match.reference.buffId !== best.reference.buffId) ?? null;
}

function findNearestDifferentSecond(matches, best) {
  if (!best) return null;
  return matches.find((match) => {
    if (match.reference.buffId !== best.reference.buffId) return false;
    return sampleTimeKey(match.reference) !== sampleTimeKey(best.reference);
  }) ?? null;
}

function sampleTimeKey(sample) {
  return sample.seconds == null ? sample.kind : `sec_${sample.seconds}`;
}

function isInitialCountdownSample(sample, settings) {
  return (
    sample.kind === "second" &&
    sample.seconds >= settings.initialMinSeconds &&
    sample.seconds <= settings.initialMaxSeconds
  );
}

function groupSamplesByBuff(samples) {
  const samplesByBuff = new Map();
  for (const sample of samples) {
    if (!samplesByBuff.has(sample.buffId)) samplesByBuff.set(sample.buffId, []);
    samplesByBuff.get(sample.buffId).push(sample);
  }
  return samplesByBuff;
}

function makeAverageIcon(icons) {
  if (!icons.length) {
    throw new TypeError("Cannot build a countdown prototype from an empty icon list.");
  }
  const width = icons[0].width;
  const height = icons[0].height;
  const sums = new Float64Array(width * height * 4);
  for (const icon of icons) {
    assertComparableSize(icon);
    if (icon.width !== width || icon.height !== height) {
      throw new TypeError("Expected prototype icons with matching dimensions.");
    }
    for (let index = 0; index < icon.data.length; index += 1) {
      sums[index] += icon.data[index];
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.round(sums[index] / icons.length);
  }
  return { width, height, data };
}

function acceptanceReason({ best, accepted, secondsAccepted, score, buffMargin, secondMargin, settings }) {
  if (!best) return "no-candidates";
  if (score < settings.minAcceptedScore) return "low-score";
  if (buffMargin < settings.minAcceptedBuffMargin) return "low-buff-margin";
  if (!accepted) return "rejected";
  if (!secondsAccepted) {
    return secondMargin < settings.minAcceptedSecondMargin ? "low-second-margin" : "seconds-rejected";
  }
  return "accepted";
}

function serializeCountdownMatch(match) {
  return {
    buffId: match.reference.buffId,
    name: match.reference.name,
    kind: match.reference.kind,
    seconds: match.reference.seconds,
    file: match.reference.file,
    score: round(match.score),
    distance: round(match.distance),
    timerPixels: match.timerPixels,
    digitPixels: match.digitPixels,
  };
}

function isCountdownTimerArea(x, y, width, height) {
  return x > width * 0.05 && x < width * 0.95 && y > height * 0.25 && y < height * 0.82;
}

function isDigitLike(data, offset) {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const yellow = r > 120 && g > 115 && b < 125 && r + g > b * 2.15;
  const white = max > 178 && max - min < 78;
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
  assertComparableSize(a);
  assertComparableSize(b);
  if (a.width !== b.width || a.height !== b.height) {
    throw new TypeError("Expected countdown icons with matching dimensions.");
  }
}

function assertComparableSize(imageData) {
  if (!imageData || !Number.isFinite(imageData.width) || !Number.isFinite(imageData.height) || !imageData.data) {
    throw new TypeError("Expected an ImageData-like object with width, height, and data.");
  }
  if (imageData.data.length < imageData.width * imageData.height * 4) {
    throw new RangeError("ImageData-like data is shorter than width * height * 4.");
  }
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
