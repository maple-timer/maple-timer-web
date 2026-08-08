import type {
  BuffExpiryPendingTrack,
  BuffExpiryTrackedBuff,
} from "./precisionTrackingTypes";
import {
  BUFF_EXPIRY_PRECISION_GROUP_MAX_TRACKS,
  getBuffExpiryPrecisionGroupFromBuffId,
} from "./precisionTrackingPolicy";
import { isActiveAlertedBuffExpiryPrecisionTrack } from "./precisionTrackingMatching";

export function capBuffExpiryPrecisionTracks(
  tracks: BuffExpiryTrackedBuff[],
  now: number,
): BuffExpiryTrackedBuff[] {
  return capBuffExpiryPrecisionGroupItems(
    tracks,
    (track) => isActiveAlertedBuffExpiryPrecisionTrack(track, now) ? 1 : 0,
  );
}

export function capBuffExpiryPrecisionPendingTracks(
  pendingTracks: BuffExpiryPendingTrack[],
): BuffExpiryPendingTrack[] {
  return capBuffExpiryPrecisionGroupItems(pendingTracks, () => 0);
}

function capBuffExpiryPrecisionGroupItems<
  T extends { buffId: string; lastSeenAt: number; score: number },
>(
  items: T[],
  getPriority: (item: T) => number,
): T[] {
  const selected: T[] = [];
  for (const item of [...items].sort(
    (left, right) =>
      getPriority(right) - getPriority(left) ||
      right.lastSeenAt - left.lastSeenAt ||
      right.score - left.score,
  )) {
    const group = getBuffExpiryPrecisionGroupFromBuffId(item.buffId);
    if (!group) {
      selected.push(item);
      continue;
    }
    const count = selected.filter((selectedItem) => selectedItem.buffId === item.buffId).length;
    if (count < BUFF_EXPIRY_PRECISION_GROUP_MAX_TRACKS[group]) {
      selected.push(item);
    }
  }
  return selected.sort((left, right) => left.lastSeenAt - right.lastSeenAt);
}
