import type {
  BuffExpiryAlertDecision,
  BuffExpiryAlertDecisionExistingGroup,
  BuffExpiryTrackedBuff,
} from "../buffExpiry/buffExpiryTypes";
import {
  BUFF_EXPIRY_ALERT_GROUP_WINDOW_MS,
  getBuffExpiryRemainingSeconds,
  getBuffExpirySlotKey,
} from "../buffExpiry/buffExpiryRuntimeTiming";

export function markDueBuffExpiryTracksAlerted({
  tracks,
  now,
  alertLeadSeconds,
}: {
  tracks: BuffExpiryTrackedBuff[];
  now: number;
  alertLeadSeconds: number;
}): {
  tracks: BuffExpiryTrackedBuff[];
  shouldAlert: boolean;
  alertDecision: BuffExpiryAlertDecision;
} {
  const dueTracks = tracks.filter(
    (track) =>
      track.alertedAt === null &&
      getBuffExpiryRemainingSeconds(track, now) <= alertLeadSeconds,
  );
  const alertedTracks = tracks.filter((track) => track.alertedAt !== null);

  if (!dueTracks.length) {
    return {
      tracks,
      shouldAlert: false,
      alertDecision: createBuffExpiryAlertDecision({
        now,
        alertLeadSeconds,
        shouldAlert: false,
        reason: "no-due-tracks",
        dueTracks,
        newAlertTrackIds: [],
        suppressedTrackIds: [],
        deferredTrackIds: [],
        markedTrackIds: [],
        dueGroupExpiresAt: null,
        nearestExistingAlertGroup: null,
      }),
    };
  }

  const newDueTracks = dueTracks.filter(
    (track) => !isNearAnyAlertedTrack(track, alertedTracks),
  );
  const shouldAlert = newDueTracks.length > 0;
  const dueGroupExpiresAt = shouldAlert
    ? Math.min(...newDueTracks.map((track) => track.expiresAt))
    : null;
  const newAlertTrackIds: string[] = [];
  const suppressedTrackIds: string[] = [];
  const deferredTrackIds: string[] = [];
  const markedTrackIds: string[] = [];
  const nextTracks = tracks.map((track) => {
    if (track.alertedAt !== null) {
      return track;
    }
    const isDue = getBuffExpiryRemainingSeconds(track, now) <= alertLeadSeconds;
    const isAlreadyAlertedGroup = isNearAnyAlertedTrack(track, alertedTracks);
    const isNewAlertGroup =
      dueGroupExpiresAt !== null &&
      Math.abs(track.expiresAt - dueGroupExpiresAt) <=
        BUFF_EXPIRY_ALERT_GROUP_WINDOW_MS;
    if (!isDue) {
      return track;
    }
    if (isAlreadyAlertedGroup) {
      suppressedTrackIds.push(track.id);
      markedTrackIds.push(track.id);
      return { ...track, alertedAt: now };
    }
    if (isNewAlertGroup) {
      newAlertTrackIds.push(track.id);
      markedTrackIds.push(track.id);
      return { ...track, alertedAt: now };
    }
    deferredTrackIds.push(track.id);
    return track;
  });

  return {
    tracks: nextTracks,
    shouldAlert,
    alertDecision: createBuffExpiryAlertDecision({
      now,
      alertLeadSeconds,
      shouldAlert,
      reason: shouldAlert ? "new-alert-group" : "existing-alert-group",
      dueTracks,
      newAlertTrackIds,
      suppressedTrackIds,
      deferredTrackIds,
      markedTrackIds,
      dueGroupExpiresAt,
      nearestExistingAlertGroup: findNearestExistingAlertGroup(
        dueTracks,
        alertedTracks,
      ),
    }),
  };
}

function isNearAnyAlertedTrack(
  track: BuffExpiryTrackedBuff,
  alertedTracks: BuffExpiryTrackedBuff[],
): boolean {
  return alertedTracks.some(
    (alertedTrack) =>
      Math.abs(track.expiresAt - alertedTrack.expiresAt) <=
      BUFF_EXPIRY_ALERT_GROUP_WINDOW_MS,
  );
}

function createBuffExpiryAlertDecision({
  now,
  alertLeadSeconds,
  shouldAlert,
  reason,
  dueTracks,
  newAlertTrackIds,
  suppressedTrackIds,
  deferredTrackIds,
  markedTrackIds,
  dueGroupExpiresAt,
  nearestExistingAlertGroup,
}: {
  now: number;
  alertLeadSeconds: number;
  shouldAlert: boolean;
  reason: BuffExpiryAlertDecision["reason"];
  dueTracks: BuffExpiryTrackedBuff[];
  newAlertTrackIds: string[];
  suppressedTrackIds: string[];
  deferredTrackIds: string[];
  markedTrackIds: string[];
  dueGroupExpiresAt: number | null;
  nearestExistingAlertGroup: BuffExpiryAlertDecisionExistingGroup | null;
}): BuffExpiryAlertDecision {
  return {
    sampledAt: now,
    alertLeadSeconds,
    shouldAlert,
    reason,
    dueTracks: dueTracks.map((track) => ({
      id: track.id,
      buffId: track.buffId,
      name: track.name,
      slotKey: getBuffExpirySlotKey(track.box),
      remainingSeconds: getBuffExpiryRemainingSeconds(track, now),
      expiresAt: track.expiresAt,
      alertedAt: track.alertedAt,
    })),
    newAlertTrackIds,
    suppressedTrackIds,
    deferredTrackIds,
    markedTrackIds,
    dueGroupExpiresAt,
    nearestExistingAlertGroup,
  };
}

function findNearestExistingAlertGroup(
  dueTracks: BuffExpiryTrackedBuff[],
  alertedTracks: BuffExpiryTrackedBuff[],
): BuffExpiryAlertDecisionExistingGroup | null {
  let nearest: BuffExpiryAlertDecisionExistingGroup | null = null;

  for (const dueTrack of dueTracks) {
    for (const alertedTrack of alertedTracks) {
      if (alertedTrack.alertedAt === null) {
        continue;
      }
      const distanceMs = Math.abs(dueTrack.expiresAt - alertedTrack.expiresAt);
      if (!nearest || distanceMs < nearest.distanceMs) {
        nearest = {
          trackId: alertedTrack.id,
          buffId: alertedTrack.buffId,
          name: alertedTrack.name,
          expiresAt: alertedTrack.expiresAt,
          alertedAt: alertedTrack.alertedAt,
          distanceMs,
        };
      }
    }
  }

  return nearest;
}
