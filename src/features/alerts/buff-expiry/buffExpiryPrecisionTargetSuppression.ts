import type {
  BuffExpiryBox,
  BuffExpirySnapshot,
  BuffExpiryTrackedBuff,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryPrecisionTargetGroup } from "../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import { BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_VISIBLE } from "./buffExpiryPrecisionTargetConfig";
import {
  getBuffExpiryPrecisionViewGroup,
  type BuffExpiryDetectedBoxView,
} from "./buffExpiryPrecisionTargetViewModel";

export function isBuffExpiryPrecisionViewSuppressedByActiveAlert(
  snapshot: BuffExpirySnapshot | null,
  view: BuffExpiryDetectedBoxView,
): boolean {
  if (!snapshot) {
    return false;
  }
  const group = getBuffExpiryPrecisionViewGroup(view);
  if (!group) {
    return false;
  }
  return isBuffExpiryPrecisionBoxSuppressedByActiveAlert(snapshot, group, view.box, snapshot.sampledAt);
}

export function isBuffExpiryPrecisionGroupFullySuppressedByActiveAlert(
  snapshot: BuffExpirySnapshot | null,
  group: BuffExpiryPrecisionTargetGroup,
  sampledAt: number,
): boolean {
  return getActiveAlertedBuffExpiryPrecisionTracks(snapshot, group, sampledAt).length >=
    BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_VISIBLE[group];
}

export function isBuffExpiryPrecisionBoxSuppressedByActiveAlert(
  snapshot: BuffExpirySnapshot | null,
  group: BuffExpiryPrecisionTargetGroup,
  box: BuffExpiryBox,
  sampledAt: number,
): boolean {
  const activeAlertedTracks = getActiveAlertedBuffExpiryPrecisionTracks(snapshot, group, sampledAt);
  if (!activeAlertedTracks.length) {
    return false;
  }
  if (activeAlertedTracks.length >= BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_VISIBLE[group]) {
    return true;
  }
  return activeAlertedTracks.some((track) => areBuffExpiryPrecisionTargetBoxesSameSlot(track.box, box));
}

function areBuffExpiryPrecisionTargetBoxesSameSlot(left: BuffExpiryBox, right: BuffExpiryBox): boolean {
  if (
    Number.isFinite(left.row) &&
    Number.isFinite(left.col) &&
    Number.isFinite(right.row) &&
    Number.isFinite(right.col)
  ) {
    return (
      Math.round(left.row ?? 0) === Math.round(right.row ?? 0) &&
      Math.round(left.col ?? 0) === Math.round(right.col ?? 0)
    );
  }

  const leftCenterX = left.x + left.width / 2;
  const leftCenterY = left.y + left.height / 2;
  const rightCenterX = right.x + right.width / 2;
  const rightCenterY = right.y + right.height / 2;
  const side = Math.max(1, left.side ?? left.width, right.side ?? right.width, left.height, right.height);
  return Math.hypot(leftCenterX - rightCenterX, leftCenterY - rightCenterY) <= side * 0.72;
}

function getActiveAlertedBuffExpiryPrecisionTracks(
  snapshot: BuffExpirySnapshot | null,
  group: BuffExpiryPrecisionTargetGroup,
  sampledAt: number,
): BuffExpiryTrackedBuff[] {
  return (snapshot?.tracks ?? []).filter(
    (track) =>
      track.buffId === `next:${group}` &&
      track.alertedAt !== null &&
      sampledAt <= track.expiresAt,
  );
}
