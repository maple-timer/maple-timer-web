import {
  assertImageData,
  clampNumber,
  emptyTimerRectResult,
  normalizeRoi,
} from "./timerImage";
import { readTimerCandidate, readTimerCatchTime } from "./timerDigitReader";
import { findDarkTimerPanelCandidates } from "./timerDarkPanelCandidates";
import {
  findEdgeRectCandidates,
  makeSobelEdgeMask,
} from "./timerEdgeRectCandidates";
import {
  makeTimerCandidateVariants,
  mergeRectCandidates,
} from "./timerRectCandidateVariants";
import {
  rerankAmbiguousMapleDecimalMatches,
  rerankAmbiguousMapleMinuteSecondMatches,
  scoreTimeRect,
} from "./timerRectMatchScoring";
import type {
  ImageDataLike,
  Rect,
  SevenSegmentOptions,
  TimerRectMatch,
  TimerRectOptions,
  TimerRectResult,
} from "./timerTypes";

export {
  findEdgeRectCandidates,
  makeSobelEdgeMask,
} from "./timerEdgeRectCandidates";

export function findTimerCatchTimeRect(
  imageData: ImageDataLike,
  options: TimerRectOptions = {},
): TimerRectResult {
  assertImageData(imageData);
  const settings = makeTimerRectSettings(options);
  const roi = normalizeRoi(settings.roi, imageData.width, imageData.height);
  if (!roi) return emptyTimerRectResult("invalid-roi");

  const darkCandidates = findDarkTimerPanelCandidates(
    imageData,
    roi,
    settings,
  ).slice(0, settings.maxCandidates);
  let candidates = darkCandidates;
  let candidateVariants = makeTimerCandidateVariants(
    candidates,
    imageData,
    settings,
  );
  let matches = findTimerCandidateMatches(
    imageData,
    candidateVariants,
    settings,
  );
  if (!matches.length) {
    candidateVariants = makeTimerCandidateVariants(
      candidates,
      imageData,
      settings,
      true,
    );
    matches = findTimerCandidateMatches(imageData, candidateVariants, settings);
  }

  if (!matches.length) {
    const edgeMask = makeSobelEdgeMask(imageData, roi, settings);
    const edgeCandidates = findEdgeRectCandidates(edgeMask, roi, settings)
      .filter((rect) => rect.x <= imageData.width * settings.maxRectLeftRatio)
      .slice(0, settings.maxCandidates);
    candidates = mergeRectCandidates([
      ...darkCandidates,
      ...edgeCandidates,
    ]).slice(0, settings.maxCandidates);
    candidateVariants = makeTimerCandidateVariants(
      candidates,
      imageData,
      settings,
    );
    matches = findTimerCandidateMatches(imageData, candidateVariants, settings);
    if (!matches.length) {
      candidateVariants = makeTimerCandidateVariants(
        candidates,
        imageData,
        settings,
        true,
      );
      matches = findTimerCandidateMatches(
        imageData,
        candidateVariants,
        settings,
      );
    }
  }

  matches.sort(
    (a, b) => b.score - a.score || a.rect.y - b.rect.y || a.rect.x - b.rect.x,
  );
  rerankAmbiguousMapleDecimalMatches(matches);
  rerankAmbiguousMapleMinuteSecondMatches(matches);

  return {
    ok: matches.length > 0,
    reason: matches.length ? "ok" : "not-found",
    rect: matches[0]?.rect ?? null,
    time: matches[0]?.time ?? null,
    matches,
    candidates: candidateVariants,
    roi,
  };
}

function findTimerCandidateMatches(
  imageData: ImageDataLike,
  candidateVariants: Rect[],
  settings: TimerRectSettings,
): TimerRectMatch[] {
  const matches: TimerRectMatch[] = [];
  for (const rect of candidateVariants) {
    const time = readTimerCandidate(imageData, rect, settings.timeReadOptions);
    if (!time.ok) continue;
    matches.push({
      rect,
      time,
      score: scoreTimeRect(rect, time, imageData),
    });
  }
  return matches;
}

type TimerRectSettings = Required<
  Omit<TimerRectOptions, "roi" | "timeReadOptions">
> & {
  roi?: TimerRectOptions["roi"];
  timeReadOptions: SevenSegmentOptions;
};

function makeTimerRectSettings(options: TimerRectOptions): TimerRectSettings {
  return {
    roi: options.roi,
    minRectWidth: Math.max(1, Math.round(options.minRectWidth ?? 10)),
    minRectHeight: Math.max(1, Math.round(options.minRectHeight ?? 10)),
    sobelThresholdRatio: clampNumber(options.sobelThresholdRatio ?? 0.3, 0, 1),
    maxRectLeftRatio: clampNumber(options.maxRectLeftRatio ?? 0.5, 0, 1),
    maxCandidates: Math.max(1, Math.round(options.maxCandidates ?? 256)),
    maxMatches: Math.max(1, Math.round(options.maxMatches ?? 16)),
    timeReadOptions: options.timeReadOptions ?? {},
  };
}

export function makeFixedTimerRectResult(
  imageData: ImageDataLike,
  rect: Rect,
  options: SevenSegmentOptions = {},
): TimerRectResult {
  const time = readTimerCatchTime(imageData, rect, options);
  const matches = time.ok
    ? [{ rect, time, score: scoreTimeRect(rect, time) }]
    : [];
  return {
    ok: time.ok,
    reason: time.ok ? "ok" : time.reason,
    rect: time.ok ? rect : null,
    time: time.ok ? time : null,
    matches,
    candidates: [rect],
    roi: rect,
  };
}
