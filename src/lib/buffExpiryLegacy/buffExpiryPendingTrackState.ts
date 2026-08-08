import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryPendingObservation,
  BuffExpiryPendingTrack,
  BuffExpiryTemporalCandidateMatch,
  BuffExpiryTemporalCandidateTrack,
  BuffExpiryTrackedBuff,
} from "../buffExpiry/buffExpiryTypes";
import { BUFF_EXPIRY_EXPIRES_MATCH_MS } from "./buffExpiryRuntimeConstants";
import { getBuffExpirySlotKey } from "../buffExpiry/buffExpiryRuntimeTiming";
import {
  getAverageObservationScore,
  getPredictedExpiresSpread,
  isMonotonicCountdown,
  selectConsistentPendingCountdownWindow,
} from "./buffExpiryPendingObservationUtils";

export const BUFF_EXPIRY_PENDING_WINDOW_MS = 35_000;
const BUFF_EXPIRY_CONFIRM_EXPIRES_SPREAD_MS = 3000;

export function findMatchingPendingTrack(
  tracks: BuffExpiryPendingTrack[],
  buffId: string,
  match: BuffExpiryAcceptedMatch,
  now: number,
  consumedTrackIds: Set<string>,
): BuffExpiryPendingTrack | null {
  const predictedExpiresAt = now + match.seconds * 1000;
  const candidates = tracks
    .filter(
      (track) => track.buffId === buffId && !consumedTrackIds.has(track.id),
    )
    .map((track) => ({
      track,
      expiresDistance: Math.abs(
        getPredictedPendingExpiresAt(track) - predictedExpiresAt,
      ),
    }))
    .filter(
      ({ expiresDistance }) => expiresDistance <= BUFF_EXPIRY_EXPIRES_MATCH_MS,
    )
    .sort(
      (a, b) =>
        a.expiresDistance - b.expiresDistance ||
        b.track.lastSeenAt - a.track.lastSeenAt,
    );

  return candidates[0]?.track ?? null;
}

export function findMatchingTemporalCandidateTrack(
  tracks: BuffExpiryTemporalCandidateTrack[],
  match: BuffExpiryTemporalCandidateMatch,
  now: number,
  consumedTrackIds: Set<string>,
): BuffExpiryTemporalCandidateTrack | null {
  const predictedExpiresAt = now + match.seconds * 1000;
  const slotKey = getBuffExpirySlotKey(match.box);
  const candidates = tracks
    .filter(
      (track) =>
        track.buffId === match.buffId &&
        getBuffExpirySlotKey(track.box) === slotKey &&
        !consumedTrackIds.has(track.id),
    )
    .map((track) => ({
      track,
      expiresDistance: Math.abs(
        getPredictedPendingExpiresAt(track) - predictedExpiresAt,
      ),
    }))
    .filter(
      ({ expiresDistance }) => expiresDistance <= BUFF_EXPIRY_EXPIRES_MATCH_MS,
    )
    .sort(
      (a, b) =>
        a.expiresDistance - b.expiresDistance ||
        b.track.lastSeenAt - a.track.lastSeenAt,
    );

  return candidates[0]?.track ?? null;
}

export function updatePendingTrack(
  previous: BuffExpiryPendingTrack | null,
  match: BuffExpiryAcceptedMatch,
  now: number,
): BuffExpiryPendingTrack {
  const observation: BuffExpiryPendingObservation = {
    seconds: match.seconds,
    observedAt: now,
    score: match.score,
    strength: match.strength,
    reason: match.reason,
  };
  const observations = [...(previous?.observations ?? []), observation].filter(
    (item) => now - item.observedAt <= BUFF_EXPIRY_PENDING_WINDOW_MS,
  );

  return {
    id:
      previous?.id ??
      `${match.buffId}:${Math.round((now + match.seconds * 1000) / 1000)}`,
    buffId: match.buffId,
    name: match.name,
    box: match.box,
    firstSeenAt: previous?.firstSeenAt ?? now,
    lastSeenAt: now,
    observations,
    score: match.score,
  };
}

export function updateTemporalCandidateTrack(
  previous: BuffExpiryTemporalCandidateTrack | null,
  match: BuffExpiryTemporalCandidateMatch,
  now: number,
): BuffExpiryTemporalCandidateTrack {
  const next = updatePendingTrack(previous, match, now);
  if (previous) {
    return next;
  }
  return {
    ...next,
    id: [
      match.buffId,
      getBuffExpirySlotKey(match.box),
      Math.round((now + match.seconds * 1000) / 1000),
    ].join(":"),
  };
}

export function dedupePendingTracksBySlot(
  pendingTracks: BuffExpiryPendingTrack[],
  activeTracks: BuffExpiryTrackedBuff[],
): BuffExpiryPendingTrack[] {
  const activeSlots = new Set(
    activeTracks.map((track) => getBuffExpirySlotKey(track.box)),
  );
  const activeBuffIds = new Set(activeTracks.map((track) => track.buffId));
  const bySlot = new Map<string, BuffExpiryPendingTrack>();
  for (const track of pendingTracks) {
    const slotKey = getBuffExpirySlotKey(track.box);
    if (activeSlots.has(slotKey) || activeBuffIds.has(track.buffId)) {
      continue;
    }
    const previous = bySlot.get(slotKey);
    if (!previous || isBetterPendingTrackForSlot(track, previous)) {
      bySlot.set(slotKey, track);
    }
  }
  return [...bySlot.values()];
}

export function dedupeTemporalCandidateTracks(
  candidateTracks: BuffExpiryTemporalCandidateTrack[],
  activeTracks: BuffExpiryTrackedBuff[],
): BuffExpiryTemporalCandidateTrack[] {
  const activeSlots = new Set(
    activeTracks.map((track) => getBuffExpirySlotKey(track.box)),
  );
  const activeBuffIds = new Set(activeTracks.map((track) => track.buffId));
  const bySlotAndBuff = new Map<string, BuffExpiryTemporalCandidateTrack>();
  for (const track of candidateTracks) {
    const slotKey = getBuffExpirySlotKey(track.box);
    if (activeSlots.has(slotKey) || activeBuffIds.has(track.buffId)) {
      continue;
    }
    const key = `${slotKey}:${track.buffId}`;
    const previous = bySlotAndBuff.get(key);
    if (!previous || isBetterPendingTrackForSlot(track, previous)) {
      bySlotAndBuff.set(key, track);
    }
  }
  return [...bySlotAndBuff.values()];
}

export function getLatestPendingObservationAt(
  track: BuffExpiryPendingTrack,
): number | null {
  return track.observations.reduce<number | null>(
    (latest, observation) =>
      latest === null
        ? observation.observedAt
        : Math.max(latest, observation.observedAt),
    null,
  );
}

function isBetterPendingTrackForSlot(
  candidate: BuffExpiryPendingTrack,
  previous: BuffExpiryPendingTrack,
): boolean {
  const candidateTier = getPendingTrackSelectionTier(candidate);
  const previousTier = getPendingTrackSelectionTier(previous);
  if (candidateTier !== previousTier) {
    return candidateTier > previousTier;
  }
  if (candidate.observations.length !== previous.observations.length) {
    return candidate.observations.length > previous.observations.length;
  }
  if (candidate.lastSeenAt !== previous.lastSeenAt) {
    return candidate.lastSeenAt > previous.lastSeenAt;
  }
  return (
    getAveragePendingTrackScore(candidate) >
    getAveragePendingTrackScore(previous)
  );
}

function getPendingTrackSelectionTier(track: BuffExpiryPendingTrack): number {
  const observations = [...track.observations].sort(
    (a, b) => a.observedAt - b.observedAt,
  );
  const hasStrongObservation = observations.some(
    (observation) => observation.strength === "strong",
  );
  const hasCountdownFlow = hasUsefulPendingCountdownFlow(observations);

  if (hasCountdownFlow && hasStrongObservation) {
    return 3;
  }
  if (hasCountdownFlow) {
    return 2;
  }
  if (hasStrongObservation) {
    return 1;
  }
  return 0;
}

function hasUsefulPendingCountdownFlow(
  observations: BuffExpiryPendingObservation[],
): boolean {
  const confirmingObservations = selectConsistentPendingCountdownWindow(
    observations,
    {
      maxPredictedExpiresSpreadMs: BUFF_EXPIRY_CONFIRM_EXPIRES_SPREAD_MS,
    },
  );
  if (confirmingObservations.length < 2) {
    return false;
  }
  return (
    isMonotonicCountdown(confirmingObservations) &&
    confirmingObservations[0].seconds >
      confirmingObservations[confirmingObservations.length - 1].seconds &&
    getPredictedExpiresSpread(confirmingObservations) <=
      BUFF_EXPIRY_CONFIRM_EXPIRES_SPREAD_MS
  );
}

function getPredictedPendingExpiresAt(track: BuffExpiryPendingTrack): number {
  const predictedExpiresAt = track.observations.map(
    (observation) => observation.observedAt + observation.seconds * 1000,
  );
  return (
    predictedExpiresAt.reduce((sum, value) => sum + value, 0) /
    predictedExpiresAt.length
  );
}

function getAveragePendingTrackScore(track: BuffExpiryPendingTrack): number {
  return getAverageObservationScore(track.observations);
}
