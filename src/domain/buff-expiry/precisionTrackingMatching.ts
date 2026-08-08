import type { BuffExpiryTargetGroup } from "../../contracts/recognition/buffExpiryRecognition";
import type {
  BuffExpiryBox,
  BuffExpiryPendingTrack,
  BuffExpiryPrecisionExactObservation,
  BuffExpiryTrackedBuff,
} from "./precisionTrackingTypes";
import {
  BUFF_EXPIRY_PRECISION_GROUP_MAX_TRACKS,
  BUFF_EXPIRY_PRECISION_PENDING_WINDOW_MS,
  BUFF_EXPIRY_PRECISION_TRACK_ALERTED_GRACE_MS,
  BUFF_EXPIRY_PRECISION_TRACK_POST_EXPIRY_ALERT_GRACE_MS,
  BUFF_EXPIRY_PRECISION_UPDATE_MAX_EXPIRES_DRIFT_MS,
  getBuffExpiryPrecisionBuffId,
  getBuffExpiryPrecisionGroupFromBuffId,
} from "./precisionTrackingPolicy";

export function pruneBuffExpiryPrecisionTracks(tracks: BuffExpiryTrackedBuff[], now: number): BuffExpiryTrackedBuff[] {
  return tracks.filter((track) => shouldKeepBuffExpiryPrecisionTrack(track, now));
}

function shouldKeepBuffExpiryPrecisionTrack(track: BuffExpiryTrackedBuff, now: number): boolean {
  if (now <= track.expiresAt) {
    return true;
  }
  if (track.alertedAt !== null) {
    return now <= track.expiresAt + BUFF_EXPIRY_PRECISION_TRACK_ALERTED_GRACE_MS;
  }
  return now <= track.expiresAt + BUFF_EXPIRY_PRECISION_TRACK_POST_EXPIRY_ALERT_GRACE_MS;
}

export function pruneBuffExpiryPrecisionPendingTracks(
  pendingTracks: BuffExpiryPendingTrack[],
  now: number,
): BuffExpiryPendingTrack[] {
  return pendingTracks
    .map((track) => ({
      ...track,
      observations: track.observations.filter(
        (observation) => now - observation.observedAt <= BUFF_EXPIRY_PRECISION_PENDING_WINDOW_MS,
      ),
    }))
    .filter((track) => track.observations.length > 0);
}

export function findMatchingBuffExpiryPrecisionTrack(
  tracks: BuffExpiryTrackedBuff[],
  observation: BuffExpiryPrecisionExactObservation,
  excludedTrackIds: ReadonlySet<string> = new Set(),
): BuffExpiryTrackedBuff | null {
  return findNearestMatchingTrack(
    tracks
      .filter((track) => !excludedTrackIds.has(track.id))
      .filter((track) => track.buffId === getBuffExpiryPrecisionBuffId(observation.group))
      .filter((track) => isBuffExpiryPrecisionExpiresAtCompatible(track, observation)),
    observation.box,
  );
}

export function removeSuppressedBuffExpiryPrecisionPendingTracks(
  pendingTracks: BuffExpiryPendingTrack[],
  tracks: BuffExpiryTrackedBuff[],
  now: number,
): BuffExpiryPendingTrack[] {
  return pendingTracks.filter((pendingTrack) => {
    const group = getBuffExpiryPrecisionGroupFromBuffId(pendingTrack.buffId);
    if (!group) {
      return true;
    }
    return !isBuffExpiryPrecisionBoxSuppressedByActiveAlert(tracks, group, pendingTrack.box, now);
  });
}

export function isBuffExpiryPrecisionObservationSuppressedByActiveAlert(
  tracks: BuffExpiryTrackedBuff[],
  observation: BuffExpiryPrecisionExactObservation,
  now: number,
): boolean {
  return isBuffExpiryPrecisionBoxSuppressedByActiveAlert(tracks, observation.group, observation.box, now);
}

function isBuffExpiryPrecisionBoxSuppressedByActiveAlert(
  tracks: BuffExpiryTrackedBuff[],
  group: BuffExpiryTargetGroup,
  box: BuffExpiryBox,
  now: number,
): boolean {
  const activeAlertedTracks = getActiveAlertedBuffExpiryPrecisionTracks(tracks, group, now);
  if (!activeAlertedTracks.length) {
    return false;
  }
  const maxTracks = BUFF_EXPIRY_PRECISION_GROUP_MAX_TRACKS[group] ?? 1;
  if (activeAlertedTracks.length >= maxTracks) {
    return true;
  }
  return activeAlertedTracks.some((track) => isBuffExpiryPrecisionNearbyBox(track.box, box));
}

function getActiveAlertedBuffExpiryPrecisionTracks(
  tracks: BuffExpiryTrackedBuff[],
  group: BuffExpiryTargetGroup,
  now: number,
): BuffExpiryTrackedBuff[] {
  return tracks.filter(
    (track) =>
      track.buffId === getBuffExpiryPrecisionBuffId(group) &&
      isActiveAlertedBuffExpiryPrecisionTrack(track, now),
  );
}

export function isActiveAlertedBuffExpiryPrecisionTrack(
  track: BuffExpiryTrackedBuff,
  now: number,
): boolean {
  return track.alertedAt !== null && now <= track.expiresAt;
}

export function hasActiveConflictingBuffExpiryPrecisionTrack(
  tracks: BuffExpiryTrackedBuff[],
  observation: BuffExpiryPrecisionExactObservation,
  now: number,
): boolean {
  const activeTracks = tracks
    .filter((track) => track.buffId === getBuffExpiryPrecisionBuffId(observation.group))
    .filter((track) => now <= track.expiresAt);
  const maxTracks = BUFF_EXPIRY_PRECISION_GROUP_MAX_TRACKS[observation.group] ?? 1;
  if (activeTracks.length >= maxTracks) {
    return true;
  }
  if (maxTracks > 1) {
    return false;
  }
  return activeTracks.some((track) => isBuffExpiryPrecisionNearbyBox(track.box, observation.box));
}

function isBuffExpiryPrecisionExpiresAtCompatible(
  track: BuffExpiryTrackedBuff,
  observation: BuffExpiryPrecisionExactObservation,
): boolean {
  const predictedExpiresAt = observation.observedAt + observation.seconds * 1000;
  return Math.abs(predictedExpiresAt - track.expiresAt) <= BUFF_EXPIRY_PRECISION_UPDATE_MAX_EXPIRES_DRIFT_MS;
}

export function findMatchingBuffExpiryPrecisionPendingTrack(
  pendingTracks: BuffExpiryPendingTrack[],
  observation: BuffExpiryPrecisionExactObservation,
  excludedTrackIds: ReadonlySet<string> = new Set(),
): BuffExpiryPendingTrack | null {
  return findNearestMatchingTrack(
    pendingTracks
      .filter((track) => !excludedTrackIds.has(track.id))
      .filter((track) => track.buffId === getBuffExpiryPrecisionBuffId(observation.group)),
    observation.box,
  );
}

function findNearestMatchingTrack<T extends { box: BuffExpiryBox }>(
  tracks: T[],
  box: BuffExpiryBox,
): T | null {
  let bestTrack: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const track of tracks) {
    if (!isBuffExpiryPrecisionNearbyBox(track.box, box)) {
      continue;
    }
    const distance = getBuffExpiryPrecisionBoxDistance(track.box, box);
    if (distance < bestDistance) {
      bestTrack = track;
      bestDistance = distance;
    }
  }
  return bestTrack;
}

export function isBuffExpiryPrecisionNearbyBox(left: BuffExpiryBox, right: BuffExpiryBox): boolean {
  if (Number.isFinite(left.row) && Number.isFinite(right.row) && Math.round(left.row ?? -1) === Math.round(right.row ?? -2)) {
    if (Math.abs(Math.round(left.col ?? 0) - Math.round(right.col ?? 0)) <= 1) {
      return true;
    }
  }
  const side = Math.max(left.side ?? left.width, right.side ?? right.width, 1);
  return getBuffExpiryPrecisionBoxDistance(left, right) <= side * 1.75;
}

function getBuffExpiryPrecisionBoxDistance(left: BuffExpiryBox, right: BuffExpiryBox): number {
  const leftX = left.x + left.width / 2;
  const leftY = left.y + left.height / 2;
  const rightX = right.x + right.width / 2;
  const rightY = right.y + right.height / 2;
  return Math.hypot(leftX - rightX, leftY - rightY);
}
