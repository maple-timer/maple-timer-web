import type { BuffExpiryBox, BuffExpiryTrackedBuff } from "./buffExpiryTypes";

export const BUFF_EXPIRY_ALERT_GROUP_WINDOW_MS = 30_000;
export const BUFF_EXPIRY_SLOT_GRID_SIZE = 8;

export function getBuffExpiryRemainingSeconds(
  track: BuffExpiryTrackedBuff,
  now: number,
): number {
  return Math.max(0, Math.ceil((track.expiresAt - now) / 1000));
}

export function getBuffExpirySlotKey(box: BuffExpiryBox): string {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  return [
    "pos",
    Math.round(centerX / BUFF_EXPIRY_SLOT_GRID_SIZE),
    Math.round(centerY / BUFF_EXPIRY_SLOT_GRID_SIZE),
  ].join(":");
}

export function isActiveOrRecentlyAlertedTrack(
  track: BuffExpiryTrackedBuff,
  now: number,
): boolean {
  return (
    now <= track.expiresAt ||
    (track.alertedAt !== null &&
      now <= track.expiresAt + BUFF_EXPIRY_ALERT_GROUP_WINDOW_MS)
  );
}
