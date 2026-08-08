import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryPendingTrack,
  BuffExpiryTrackedBuff,
} from "../buffExpiry/buffExpiryTypes";
import { getBuffExpirySlotKey } from "../buffExpiry/buffExpiryRuntimeTiming";

export function selectBuffExpiryRuntimeMatches({
  acceptedMatches,
  now,
}: {
  acceptedMatches: BuffExpiryAcceptedMatch[];
  hypothesisMatches?: BuffExpiryAcceptedMatch[];
  previousTracks: BuffExpiryTrackedBuff[];
  previousPendingTracks?: BuffExpiryPendingTrack[];
  now: number;
}): BuffExpiryAcceptedMatch[] {
  // Hypothesis matches are useful diagnostics, but they only mean "the countdown
  // digits look similar". They intentionally do not enter runtime tracking
  // because unrelated buff icons can share the same 59~21 second glyphs.
  return dedupeRuntimeMatchesByBuffAndExpiry(
    dedupeRuntimeMatchesByBoxAndBuff(acceptedMatches),
    now,
  );
}

export function dedupeAcceptedMatchesBySlot(
  matches: BuffExpiryAcceptedMatch[],
): BuffExpiryAcceptedMatch[] {
  const bySlot = new Map<string, BuffExpiryAcceptedMatch>();
  for (const match of matches) {
    const slotKey = getBuffExpirySlotKey(match.box);
    const previous = bySlot.get(slotKey);
    if (!previous || isBetterRuntimeMatch(match, previous)) {
      bySlot.set(slotKey, match);
    }
  }
  return [...bySlot.values()];
}

function dedupeRuntimeMatchesByBuffAndExpiry<T extends BuffExpiryAcceptedMatch>(
  matches: T[],
  now: number,
): T[] {
  const byBuffAndExpiresSecond = new Map<string, T>();
  for (const match of matches) {
    const expiresSecond = Math.round((now + match.seconds * 1000) / 1000);
    const key = `${match.buffId}:${expiresSecond}`;
    const previous = byBuffAndExpiresSecond.get(key);
    if (!previous || isBetterRuntimeEvidenceMatch(match, previous)) {
      byBuffAndExpiresSecond.set(key, match);
    }
  }
  return [...byBuffAndExpiresSecond.values()];
}

export function dedupeRuntimeMatchesByBoxAndBuff<
  T extends BuffExpiryAcceptedMatch,
>(matches: T[]): T[] {
  const byBoxAndBuff = new Map<string, T>();
  for (const match of matches) {
    const key = [
      match.buffId,
      Math.round(match.box.x),
      Math.round(match.box.y),
      Math.round(match.box.width),
      Math.round(match.box.height),
    ].join(":");
    const previous = byBoxAndBuff.get(key);
    if (!previous || isBetterRuntimeEvidenceMatch(match, previous)) {
      byBoxAndBuff.set(key, match);
    }
  }
  return [...byBoxAndBuff.values()];
}

function isBetterRuntimeEvidenceMatch(
  candidate: BuffExpiryAcceptedMatch,
  previous: BuffExpiryAcceptedMatch,
): boolean {
  const candidateIsHypothesis = isHypothesisMatch(candidate);
  const previousIsHypothesis = isHypothesisMatch(previous);
  if (candidateIsHypothesis !== previousIsHypothesis) {
    return !candidateIsHypothesis;
  }
  return isBetterRuntimeMatch(candidate, previous);
}

function isHypothesisMatch(match: BuffExpiryAcceptedMatch): boolean {
  return match.reason.startsWith("hypothesis");
}

function isBetterRuntimeMatch(
  candidate: BuffExpiryAcceptedMatch,
  previous: BuffExpiryAcceptedMatch,
): boolean {
  if (candidate.strength !== previous.strength) {
    return candidate.strength === "strong";
  }
  return (
    candidate.score > previous.score ||
    (candidate.score === previous.score &&
      candidate.secondMargin > previous.secondMargin)
  );
}
