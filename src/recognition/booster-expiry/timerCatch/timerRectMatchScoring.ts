import { clampNumber } from "./timerImage";
import type {
  ImageDataLike,
  Rect,
  SevenSegmentDigitResult,
  TimeReadResult,
  TimerRectMatch,
} from "./timerTypes";

export function scoreTimeRect(
  rect: Rect,
  time: TimeReadResult,
  imageData?: ImageDataLike,
): number {
  const aspect = rect.width / Math.max(1, rect.height);
  const targetAspect = time.format === "m:ss" ? 4.42 : 4;
  const aspectScore = Math.max(
    0,
    1 - Math.abs(aspect - targetAspect) / targetAspect,
  );
  const centerXRatio = imageData
    ? (rect.x + rect.width / 2) / imageData.width
    : 0.5;
  const centerScore = Math.max(0, 1 - Math.abs(centerXRatio - 0.5) / 0.17);
  const digitScore = time.digitResults.filter((digit) => digit.ok).length;
  const confidenceScore =
    time.format === "m:ss"
      ? time.digitResults.reduce(
          (sum, digit) => sum + scoreTimeDigitConfidence(digit),
          0,
        )
      : 0;
  const directScore = time.digitResults.reduce(
    (sum, digit) => sum + (digit.selectedBy === "direct" ? 0.12 : 0),
    0,
  );
  const saturationPenalty = time.digitResults.reduce(
    (sum, digit) => sum + scoreTimeDigitSaturationPenalty(digit),
    0,
  );
  return (
    digitScore * 10 +
    confidenceScore * 0.25 +
    directScore +
    aspectScore +
    centerScore -
    saturationPenalty
  );
}

function scoreTimeDigitConfidence(digit: SevenSegmentDigitResult): number {
  const confidence = digit.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return 0;
  return clampNumber((confidence - 6) / 4, -1, 1.25);
}

function scoreTimeDigitSaturationPenalty(
  digit: SevenSegmentDigitResult,
): number {
  const densities = digit.densities;
  if (!densities?.length) return 0;
  const saturatedSegments = densities.filter(
    (density) => density >= 0.9,
  ).length;
  if (saturatedSegments >= 5) return 2.5;
  if (saturatedSegments >= 4) return 1.25;
  return 0;
}

export function rerankAmbiguousMapleDecimalMatches(
  matches: TimerRectMatch[],
): void {
  const top = matches[0];
  if (!top || !isMapleDecimalFormat(top.time.format)) return;

  const replacement = matches
    .slice(1, 24)
    .filter((match) => isMapleDecimalFormat(match.time.format))
    .filter((match) => match.score >= top.score - 0.01)
    .filter((match) => rectOverlapRatio(top.rect, match.rect) >= 0.75)
    .sort(
      (a, b) =>
        scoreMapleDecimalTieBreak(b.time) - scoreMapleDecimalTieBreak(a.time),
    )[0];
  if (!replacement) return;

  if (
    scoreMapleDecimalTieBreak(replacement.time) <
    scoreMapleDecimalTieBreak(top.time) + 2
  )
    return;
  const index = matches.indexOf(replacement);
  matches.splice(index, 1);
  matches.unshift(replacement);
}

function isMapleDecimalFormat(
  format: TimeReadResult["format"] | undefined,
): boolean {
  return format === "ss.cc" || format === "s.cc";
}

function scoreMapleDecimalTieBreak(time: TimeReadResult): number {
  return time.digitResults.reduce((sum, digit) => {
    const confidence = digit.confidence ?? 0;
    const margin = digit.scoreMargin ?? 0;
    const methodBonus = digit.selectedBy === "direct" ? 0.15 : 0;
    return sum + confidence + clampNumber(margin, -1.5, 1.5) + methodBonus;
  }, 0);
}

function rectOverlapRatio(a: Rect, b: Rect): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return smallerArea > 0 ? intersection / smallerArea : 0;
}

export function rerankAmbiguousMapleMinuteSecondMatches(
  matches: TimerRectMatch[],
): void {
  const top = matches[0];
  if (!top || top.time.format !== "m:ss" || isSyntheticTemplateTime(top.time))
    return;
  if (lastDigitScoreMargin(top.time) > 0.55) return;

  const replacement = matches.find(
    (match) =>
      match !== top &&
      match.time.format === "m:ss" &&
      isSyntheticTemplateTime(match.time) &&
      hasSameMinuteSecondPrefix(top.time, match.time) &&
      top.time.text !== match.time.text &&
      lastDigitScoreMargin(match.time) >= 0.04 &&
      rectDistance(top.rect, match.rect) <=
        Math.max(8, Math.round(top.rect.height * 0.35)),
  );
  if (!replacement) return;

  const index = matches.indexOf(replacement);
  matches.splice(index, 1);
  matches.unshift(replacement);
}

function isSyntheticTemplateTime(time: TimeReadResult): boolean {
  return (
    time.selectedBy === "synthetic-template" ||
    time.digitResults.some((digit) => digit.selectedBy === "synthetic-template")
  );
}

function hasSameMinuteSecondPrefix(
  a: TimeReadResult,
  b: TimeReadResult,
): boolean {
  return a.digits[0] === b.digits[0] && a.digits[1] === b.digits[1];
}

function lastDigitScoreMargin(time: TimeReadResult): number {
  const digit = time.digitResults[time.digitResults.length - 1];
  return digit?.scoreMargin ?? -Infinity;
}

function rectDistance(a: Rect, b: Rect): number {
  return (
    Math.abs(a.x - b.x) +
    Math.abs(a.y - b.y) +
    Math.abs(a.width - b.width) +
    Math.abs(a.height - b.height)
  );
}
