import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryBox,
  BuffExpiryTrackedBuff,
} from "../buffExpiry/buffExpiryTypes";
import { BUFF_EXPIRY_EXPIRES_MATCH_MS } from "./buffExpiryRuntimeConstants";
import {
  BUFF_EXPIRY_ALERT_GROUP_WINDOW_MS,
  getBuffExpirySlotKey,
  isActiveOrRecentlyAlertedTrack,
} from "../buffExpiry/buffExpiryRuntimeTiming";

export function hasActiveTrackForBuff(
  tracks: BuffExpiryTrackedBuff[],
  buffId: string,
  now: number,
): boolean {
  return tracks.some(
    (track) =>
      track.buffId === buffId && isActiveOrRecentlyAlertedTrack(track, now),
  );
}

export function hasActiveTrackForSlot(
  tracks: BuffExpiryTrackedBuff[],
  box: BuffExpiryBox,
  now: number,
): boolean {
  const slotKey = getBuffExpirySlotKey(box);
  return tracks.some(
    (track) =>
      getBuffExpirySlotKey(track.box) === slotKey &&
      isActiveOrRecentlyAlertedTrack(track, now),
  );
}

export function shouldKeepPreviousTrack(
  track: BuffExpiryTrackedBuff,
  now: number,
  hasVisibleBox: boolean,
): boolean {
  if (isActiveOrRecentlyAlertedTrack(track, now)) {
    return true;
  }

  // The sampler can occasionally skip past the exact due frame. If the same
  // buff slot is still visible, keep the unalerted track briefly so the next
  // alert check can fire instead of dropping it before markDue runs.
  return (
    hasVisibleBox &&
    track.alertedAt === null &&
    now <= track.expiresAt + BUFF_EXPIRY_ALERT_GROUP_WINDOW_MS
  );
}

export function findMatchingTrack(
  tracks: BuffExpiryTrackedBuff[],
  match: BuffExpiryAcceptedMatch,
  now: number,
  consumedTrackIds: Set<string>,
): BuffExpiryTrackedBuff | null {
  const predictedExpiresAt = now + match.seconds * 1000;
  const candidates = tracks
    .filter(
      (track) =>
        track.buffId === match.buffId && !consumedTrackIds.has(track.id),
    )
    .map((track) => ({
      track,
      expiresDistance: Math.abs(track.expiresAt - predictedExpiresAt),
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

export function dedupeTracksBySlot(
  tracks: BuffExpiryTrackedBuff[],
): BuffExpiryTrackedBuff[] {
  const bySlot = new Map<string, BuffExpiryTrackedBuff>();
  for (const track of tracks) {
    const slotKey = getBuffExpirySlotKey(track.box);
    const previous = bySlot.get(slotKey);
    if (!previous || isBetterTrackForSlot(track, previous)) {
      bySlot.set(slotKey, track);
    }
  }
  return [...bySlot.values()];
}

export function dedupeTracksByBuff(
  tracks: BuffExpiryTrackedBuff[],
): BuffExpiryTrackedBuff[] {
  const byBuff = new Map<string, BuffExpiryTrackedBuff>();
  for (const track of tracks) {
    const previous = byBuff.get(track.buffId);
    if (!previous || isBetterTrackForBuff(track, previous)) {
      byBuff.set(track.buffId, track);
    }
  }
  return [...byBuff.values()];
}

function isBetterTrackForSlot(
  candidate: BuffExpiryTrackedBuff,
  previous: BuffExpiryTrackedBuff,
): boolean {
  return (
    candidate.lastSeenAt > previous.lastSeenAt ||
    (candidate.lastSeenAt === previous.lastSeenAt &&
      candidate.score > previous.score) ||
    (candidate.lastSeenAt === previous.lastSeenAt &&
      candidate.score === previous.score &&
      candidate.expiresAt < previous.expiresAt)
  );
}

function isBetterTrackForBuff(
  candidate: BuffExpiryTrackedBuff,
  previous: BuffExpiryTrackedBuff,
): boolean {
  if ((candidate.alertedAt !== null) !== (previous.alertedAt !== null)) {
    return candidate.alertedAt !== null;
  }
  return isBetterTrackForSlot(candidate, previous);
}

export function findNearestBox(
  previousBox: BuffExpiryBox,
  boxes: BuffExpiryBox[],
): BuffExpiryBox | null {
  const candidates = boxes
    .map((box) => ({ box, distance: boxDistance(previousBox, box) }))
    .filter(
      ({ box, distance }) => distance <= getBoxMatchRadius(previousBox, box),
    )
    .sort((a, b) => a.distance - b.distance);

  return candidates[0]?.box ?? null;
}

function boxDistance(a: BuffExpiryBox, b: BuffExpiryBox): number {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return Math.hypot(ax - bx, ay - by);
}

function getBoxMatchRadius(a: BuffExpiryBox, b: BuffExpiryBox): number {
  return Math.max(12, Math.max(a.width, a.height, b.width, b.height) * 1.5);
}
