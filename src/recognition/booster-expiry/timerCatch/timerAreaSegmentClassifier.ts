import { SEVEN_SEGMENT_DIGIT_TO_MASK } from "./timerTypes";

export const AREA_SEGMENT_ZONES = Object.freeze([
  Object.freeze({ x1: 0.25, y1: 0.0, x2: 0.75, y2: 0.18, bit: 0 }),
  Object.freeze({ x1: 0.0, y1: 0.08, x2: 0.25, y2: 0.5, bit: 1 }),
  Object.freeze({ x1: 0.75, y1: 0.08, x2: 1.0, y2: 0.5, bit: 2 }),
  Object.freeze({ x1: 0.28, y1: 0.4, x2: 0.72, y2: 0.58, bit: 3 }),
  Object.freeze({ x1: 0.0, y1: 0.5, x2: 0.25, y2: 0.92, bit: 4 }),
  Object.freeze({ x1: 0.75, y1: 0.5, x2: 1.0, y2: 0.92, bit: 5 }),
  Object.freeze({ x1: 0.25, y1: 0.82, x2: 0.75, y2: 1.0, bit: 6 }),
]);

export type AreaSegmentZone = (typeof AREA_SEGMENT_ZONES)[number];

export type AreaDigitCandidate = {
  digit: number;
  mask: number;
  score: number;
};

export type AreaDigitFuzzySettings = {
  allowFuzzyCandidateFallback: boolean;
  minFuzzyMargin: number;
  requireFuzzyHorizontalSignal: boolean;
  fuzzyTopSignalRatio: number;
  fuzzyMiddleSignalRatio: number;
  fuzzyBottomSignalRatio: number;
  fuzzyVerticalSignalRatio: number;
};

export type AreaDigitDirectCorrectionSettings = AreaDigitFuzzySettings & {
  minDirectCorrectionMargin: number;
};

export function areaSegmentThreshold(bit: number): number {
  if (bit === 3) return 0.18;
  if (bit === 0 || bit === 6) return 0.16;
  return 0.25;
}

export function mergePreprocessedAreaDensity(
  rawDensity: number,
  binaryDensity: number,
  bit: number,
): number {
  const minRawSignal = bit === 0 || bit === 6 ? 0.05 : 0.08;
  if (rawDensity < minRawSignal) return rawDensity;
  return Math.max(rawDensity, binaryDensity);
}

export function classifyAreaSevenSegmentDensities(
  densities: number[],
  minMargin = 0.35,
  candidates = classifyAreaSevenSegmentDensityCandidates(densities),
): AreaDigitCandidate | null {
  const best = candidates[0] ?? null;
  const secondScore = candidates[1]?.score ?? -Infinity;

  if (!best || best.score < 5.5 || best.score - secondScore < minMargin)
    return null;
  return best;
}

export function readFuzzyAreaDigit(
  densities: number[],
  directMask: number,
  settings: AreaDigitFuzzySettings,
  candidates: AreaDigitCandidate[],
): AreaDigitCandidate | null {
  const fuzzy = settings.allowFuzzyCandidateFallback
    ? selectFuzzyAreaDigit(densities, directMask, settings, candidates)
    : classifyAreaSevenSegmentDensities(
        densities,
        settings.minFuzzyMargin,
        candidates,
      );
  if (!fuzzy) return null;
  if (
    settings.requireFuzzyHorizontalSignal &&
    !canUseFuzzyAreaDigit(densities, directMask, fuzzy, settings)
  )
    return null;
  return fuzzy;
}

export function selectFuzzyAreaDigit(
  densities: number[],
  directMask: number,
  settings: AreaDigitFuzzySettings,
  candidates = classifyAreaSevenSegmentDensityCandidates(densities),
): AreaDigitCandidate | null {
  if (!settings.requireFuzzyHorizontalSignal) {
    return classifyAreaSevenSegmentDensities(
      densities,
      settings.minFuzzyMargin,
      candidates,
    );
  }

  const usableCandidates = candidates.filter((candidate) =>
    canUseFuzzyAreaDigit(densities, directMask, candidate, settings),
  );
  return classifyAreaSevenSegmentDensities(
    densities,
    settings.minFuzzyMargin,
    usableCandidates,
  );
}

export function classifyAreaSevenSegmentDensityCandidates(
  densities: number[],
): AreaDigitCandidate[] {
  return SEVEN_SEGMENT_DIGIT_TO_MASK.map((mask, digit) => ({
    digit,
    mask,
    score: scoreAreaSevenSegmentDensities(densities, mask),
  })).sort((a, b) => b.score - a.score || a.digit - b.digit);
}

export function chooseDirectAreaDigitCorrection(
  densities: number[],
  directMask: number,
  candidates: AreaDigitCandidate[],
  settings: AreaDigitDirectCorrectionSettings,
): AreaDigitCandidate | null {
  const best = candidates[0] ?? null;
  if (!best || best.mask === directMask) return null;

  const directScore = scoreAreaSevenSegmentDensities(densities, directMask);
  if (best.score - directScore < settings.minDirectCorrectionMargin)
    return null;

  const addedSegments = best.mask & ~directMask;
  const changedSegmentCount =
    countMaskBits(addedSegments) + countMaskBits(directMask & ~best.mask);
  if (countMaskBits(addedSegments) < 2 || changedSegmentCount < 2) return null;
  if (!canUseFuzzyAreaDigit(densities, directMask, best, settings)) return null;

  return best;
}

export function scoreSelectedAreaDigit(
  densities: number[],
  selectedMask: number,
  candidates: AreaDigitCandidate[],
  maskToDigit: Readonly<Record<number, number>>,
): { score: number; margin: number; value: number } {
  if (!hasDigitForMask(maskToDigit, selectedMask)) {
    return {
      score: -Infinity,
      margin: -Infinity,
      value: -Infinity,
    };
  }

  const score = scoreAreaSevenSegmentDensities(densities, selectedMask);
  const bestOther = candidates.find(
    (candidate) => candidate.mask !== selectedMask,
  );
  const margin = score - (bestOther?.score ?? -Infinity);
  return {
    score,
    margin,
    value: score + margin,
  };
}

export function canUseFuzzyAreaDigit(
  densities: number[],
  directMask: number,
  fuzzy: AreaDigitCandidate,
  settings: AreaDigitFuzzySettings,
): boolean {
  for (const bit of [0, 3, 6]) {
    if (
      fuzzy.mask & (1 << bit) &&
      !(directMask & (1 << bit)) &&
      (densities[bit] ?? 0) <
        areaSegmentThreshold(bit) * fuzzyHorizontalSignalRatio(bit, settings)
    ) {
      return false;
    }
  }
  for (const bit of [1, 2, 4, 5]) {
    if (
      fuzzy.mask & (1 << bit) &&
      !(directMask & (1 << bit)) &&
      (densities[bit] ?? 0) <
        areaSegmentThreshold(bit) * settings.fuzzyVerticalSignalRatio
    ) {
      return false;
    }
  }
  return true;
}

export function fuzzyHorizontalSignalRatio(
  bit: number,
  settings: AreaDigitFuzzySettings,
): number {
  if (bit === 3) return settings.fuzzyMiddleSignalRatio;
  if (bit === 0) return settings.fuzzyTopSignalRatio;
  return settings.fuzzyBottomSignalRatio;
}

export function scoreAreaSevenSegmentDensities(
  densities: number[],
  mask: number,
): number {
  let score = 0;
  for (let bit = 0; bit < AREA_SEGMENT_ZONES.length; bit += 1) {
    const density = densities[bit] ?? 0;
    if (mask & (1 << bit)) {
      score += Math.min(density / 0.16, 1.4);
    } else {
      score += Math.min(Math.max(0, 0.16 - density) / 0.16, 1);
    }
  }
  return score;
}

export function countMaskBits(mask: number): number {
  let count = 0;
  for (let value = mask; value > 0; value >>= 1) {
    if (value & 1) count += 1;
  }
  return count;
}

function hasDigitForMask(
  maskToDigit: Readonly<Record<number, number>>,
  mask: number | null,
): mask is number {
  return (
    mask !== null && Object.prototype.hasOwnProperty.call(maskToDigit, mask)
  );
}
