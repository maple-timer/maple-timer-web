import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryBox,
  BuffExpiryExpiryCluster,
  BuffExpiryPendingTrack,
  BuffExpiryTemporalCandidateMatch,
  BuffExpiryTemporalCandidateTrack,
  BuffExpiryTrackedBuff,
} from "../buffExpiry/buffExpiryTypes";
import {
  applyConfirmedExpiryClusters,
  buildBuffExpiryClusterObservations,
  updateBuffExpiryClusters,
} from "./buffExpiryExpiryClusters";
import {
  BUFF_EXPIRY_PENDING_WINDOW_MS,
  dedupePendingTracksBySlot,
  dedupeTemporalCandidateTracks,
  findMatchingPendingTrack,
  findMatchingTemporalCandidateTrack,
  getLatestPendingObservationAt,
  maybeConfirmPendingTrack,
  maybeConfirmTemporalCandidateTrack,
  updatePendingTrack,
  updateTemporalCandidateTrack,
} from "./buffExpiryPendingTracks";
import {
  dedupeAcceptedMatchesBySlot,
  dedupeRuntimeMatchesByBoxAndBuff,
} from "./buffExpiryRuntimeMatches";
import {
  dedupeTracksByBuff,
  dedupeTracksBySlot,
  findMatchingTrack,
  findNearestBox,
  hasActiveTrackForBuff,
  hasActiveTrackForSlot,
  shouldKeepPreviousTrack,
} from "./buffExpiryActiveTracks";

export function reconcileBuffExpiryTracks({
  previousTracks,
  previousPendingTracks = [],
  previousTemporalCandidateTracks = [],
  previousExpiryClusters = [],
  acceptedMatches,
  temporalCandidateMatches = [],
  boxes,
  now,
}: {
  previousTracks: BuffExpiryTrackedBuff[];
  previousPendingTracks?: BuffExpiryPendingTrack[];
  previousTemporalCandidateTracks?: BuffExpiryTemporalCandidateTrack[];
  previousExpiryClusters?: BuffExpiryExpiryCluster[];
  acceptedMatches: BuffExpiryAcceptedMatch[];
  temporalCandidateMatches?: BuffExpiryTemporalCandidateMatch[];
  boxes: BuffExpiryBox[];
  now: number;
}): {
  tracks: BuffExpiryTrackedBuff[];
  pendingTracks: BuffExpiryPendingTrack[];
  temporalCandidateTracks: BuffExpiryTemporalCandidateTrack[];
  expiryClusters: BuffExpiryExpiryCluster[];
} {
  const consumedTrackIds = new Set<string>();
  const consumedPendingTrackIds = new Set<string>();
  const consumedTemporalCandidateTrackIds = new Set<string>();
  const nextTracks: BuffExpiryTrackedBuff[] = [];
  const nextPendingTracks: BuffExpiryPendingTrack[] = [];
  const nextTemporalCandidateTracks: BuffExpiryTemporalCandidateTrack[] = [];
  const runtimeMatches = dedupeAcceptedMatchesBySlot(acceptedMatches);
  const runtimeTemporalCandidateMatches = dedupeRuntimeMatchesByBoxAndBuff(
    temporalCandidateMatches,
  );
  const expiryClusterObservations = buildBuffExpiryClusterObservations(
    runtimeMatches,
    runtimeTemporalCandidateMatches,
    now,
  );

  for (const match of runtimeMatches) {
    const previous = findMatchingTrack(
      previousTracks,
      match,
      now,
      consumedTrackIds,
    );
    if (previous) {
      consumedTrackIds.add(previous.id);
      nextTracks.push({
        ...previous,
        name: match.name,
        box: match.box,
        detectedSeconds: match.seconds,
        detectedAt: now,
        expiresAt: now + match.seconds * 1000,
        lastSeenAt: now,
        score: match.score,
      });
      continue;
    }

    if (
      hasActiveTrackForBuff(previousTracks, match.buffId, now) ||
      hasActiveTrackForSlot(previousTracks, match.box, now)
    ) {
      continue;
    }

    const previousPending = findMatchingPendingTrack(
      previousPendingTracks,
      match.buffId,
      match,
      now,
      consumedPendingTrackIds,
    );
    const pendingTrack = updatePendingTrack(previousPending, match, now);
    consumedPendingTrackIds.add(pendingTrack.id);
    const confirmedTrack = maybeConfirmPendingTrack(pendingTrack);
    if (confirmedTrack) {
      nextTracks.push(confirmedTrack);
    } else {
      nextPendingTracks.push(pendingTrack);
    }
  }

  for (const match of runtimeTemporalCandidateMatches) {
    if (
      hasActiveTrackForBuff(
        [...previousTracks, ...nextTracks],
        match.buffId,
        now,
      ) ||
      hasActiveTrackForSlot([...previousTracks, ...nextTracks], match.box, now)
    ) {
      continue;
    }

    const previousTemporalCandidate = findMatchingTemporalCandidateTrack(
      previousTemporalCandidateTracks,
      match,
      now,
      consumedTemporalCandidateTrackIds,
    );
    const temporalCandidateTrack = updateTemporalCandidateTrack(
      previousTemporalCandidate,
      match,
      now,
    );
    consumedTemporalCandidateTrackIds.add(temporalCandidateTrack.id);
    const confirmedTrack = maybeConfirmTemporalCandidateTrack(
      temporalCandidateTrack,
    );
    if (confirmedTrack) {
      nextTracks.push(confirmedTrack);
    } else {
      nextTemporalCandidateTracks.push(temporalCandidateTrack);
    }
  }

  for (const track of previousTracks) {
    if (consumedTrackIds.has(track.id)) {
      continue;
    }
    if (nextTracks.some((item) => item.id === track.id)) {
      continue;
    }

    const visibleBox = findNearestBox(track.box, boxes);
    const updated = visibleBox
      ? { ...track, box: visibleBox, lastSeenAt: now }
      : track;
    if (shouldKeepPreviousTrack(updated, now, visibleBox !== null)) {
      nextTracks.push(updated);
    }
  }

  for (const pendingTrack of previousPendingTracks) {
    if (consumedPendingTrackIds.has(pendingTrack.id)) {
      continue;
    }
    if (nextPendingTracks.some((item) => item.id === pendingTrack.id)) {
      continue;
    }
    if (nextTracks.some((item) => item.id === pendingTrack.id)) {
      continue;
    }

    const latestObservationAt = getLatestPendingObservationAt(pendingTrack);
    if (
      latestObservationAt === null ||
      now - latestObservationAt > BUFF_EXPIRY_PENDING_WINDOW_MS
    ) {
      continue;
    }

    const visibleBox = findNearestBox(pendingTrack.box, boxes);
    nextPendingTracks.push(
      visibleBox
        ? { ...pendingTrack, box: visibleBox, lastSeenAt: now }
        : pendingTrack,
    );
  }

  for (const candidateTrack of previousTemporalCandidateTracks) {
    if (consumedTemporalCandidateTrackIds.has(candidateTrack.id)) {
      continue;
    }
    if (
      nextTemporalCandidateTracks.some((item) => item.id === candidateTrack.id)
    ) {
      continue;
    }
    if (nextTracks.some((item) => item.id === candidateTrack.id)) {
      continue;
    }

    const latestObservationAt = getLatestPendingObservationAt(candidateTrack);
    if (
      latestObservationAt === null ||
      now - latestObservationAt > BUFF_EXPIRY_PENDING_WINDOW_MS
    ) {
      continue;
    }

    nextTemporalCandidateTracks.push(candidateTrack);
  }

  const expiryClusters = updateBuffExpiryClusters(
    previousExpiryClusters,
    expiryClusterObservations,
    now,
  );
  const clusteredTracks = applyConfirmedExpiryClusters(
    nextTracks,
    expiryClusters,
    now,
  );
  const tracks = dedupeTracksByBuff(dedupeTracksBySlot(clusteredTracks));
  const pendingTracks = dedupePendingTracksBySlot(nextPendingTracks, tracks);
  const temporalCandidateTracks = dedupeTemporalCandidateTracks(
    nextTemporalCandidateTracks,
    tracks,
  );

  return {
    tracks: tracks.sort(
      (a, b) => a.expiresAt - b.expiresAt || a.box.x - b.box.x,
    ),
    pendingTracks: pendingTracks.sort(
      (a, b) => a.firstSeenAt - b.firstSeenAt || a.box.x - b.box.x,
    ),
    temporalCandidateTracks: temporalCandidateTracks.sort(
      (a, b) => a.firstSeenAt - b.firstSeenAt || a.box.x - b.box.x,
    ),
    expiryClusters: expiryClusters.sort(
      (a, b) =>
        a.centerExpiresAt - b.centerExpiresAt || a.firstSeenAt - b.firstSeenAt,
    ),
  };
}
