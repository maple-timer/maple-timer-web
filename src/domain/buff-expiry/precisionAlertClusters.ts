import type {
  BuffExpiryAlertDecision,
  BuffExpiryAlertDecisionExistingGroup,
  BuffExpiryPrecisionAlertCluster,
} from "./precisionAlertTypes";
import type {
  BuffExpiryBox,
  BuffExpiryTrackedBuff,
} from "./precisionTrackingTypes";
import { BUFF_EXPIRY_PRECISION_ALERT_MAX_STALE_MS } from "./precisionTrackingPolicy";

export type { BuffExpiryPrecisionAlertCluster } from "./precisionAlertTypes";

export const BUFF_EXPIRY_PRECISION_ALERT_CLUSTER_WINDOW_MS = 15_000;

export function getBuffExpiryPrecisionAlertClusters({
  tracks,
  alertLeadSeconds,
  now,
}: {
  tracks: BuffExpiryTrackedBuff[];
  alertLeadSeconds: number;
  now?: number;
}): BuffExpiryPrecisionAlertCluster[] {
  const alertedTracks = tracks.filter((track) => track.alertedAt !== null);
  const candidates = tracks
    .filter((track) => track.alertedAt === null)
    .filter(
      (track) =>
        now === undefined ||
        isBuffExpiryPrecisionTrackEligibleForAlertCluster(track, alertLeadSeconds, now),
    )
    .filter((track) => !isNearAnyBuffExpiryPrecisionAlertedTrack(track, alertedTracks))
    .sort((left, right) => left.expiresAt - right.expiresAt || left.id.localeCompare(right.id));
  const clusters: BuffExpiryPrecisionAlertCluster[] = [];
  const consumedTrackIds = new Set<string>();

  for (const anchor of candidates) {
    if (consumedTrackIds.has(anchor.id)) {
      continue;
    }
    const clusterTracks = candidates.filter(
      (track) =>
        !consumedTrackIds.has(track.id) &&
        track.expiresAt - anchor.expiresAt <= BUFF_EXPIRY_PRECISION_ALERT_CLUSTER_WINDOW_MS,
    );
    for (const track of clusterTracks) {
      consumedTrackIds.add(track.id);
    }
    const minExpiresAt = Math.min(...clusterTracks.map((track) => track.expiresAt));
    const maxExpiresAt = Math.max(...clusterTracks.map((track) => track.expiresAt));
    const dueAt = minExpiresAt - alertLeadSeconds * 1000;
    clusters.push({
      id: getBuffExpiryPrecisionAlertClusterId(clusterTracks, dueAt, minExpiresAt),
      dueAt,
      minExpiresAt,
      maxExpiresAt,
      tracks: clusterTracks,
    });
  }

  return clusters;
}

export function markDueBuffExpiryPrecisionClustersAlerted({
  tracks,
  now,
  alertLeadSeconds,
  requireFreshness = false,
}: {
  tracks: BuffExpiryTrackedBuff[];
  now: number;
  alertLeadSeconds: number;
  requireFreshness?: boolean;
}): { tracks: BuffExpiryTrackedBuff[]; shouldAlert: boolean; alertDecision: BuffExpiryAlertDecision } {
  const alertedTracks = tracks.filter((track) => track.alertedAt !== null);
  const dueSuppressedTracks = tracks.filter(
    (track) =>
      track.alertedAt === null &&
      isBuffExpiryPrecisionTrackDue(track, alertLeadSeconds, now) &&
      (
        !requireFreshness ||
        isBuffExpiryPrecisionTrackEligibleForAlertCluster(track, alertLeadSeconds, now)
      ) &&
      isNearAnyBuffExpiryPrecisionAlertedTrack(track, alertedTracks),
  );
  const staleDueTrackIds = requireFreshness
    ? tracks
      .filter(
        (track) =>
          track.alertedAt === null &&
          isBuffExpiryPrecisionTrackDue(track, alertLeadSeconds, now) &&
          !isBuffExpiryPrecisionTrackEligibleForAlertCluster(track, alertLeadSeconds, now),
      )
      .map((track) => track.id)
    : [];
  const dueCluster = getBuffExpiryPrecisionAlertClusters({
    tracks,
    alertLeadSeconds,
    now: requireFreshness ? now : undefined,
  })
    .filter((cluster) => cluster.dueAt <= now)
    .sort((left, right) => left.dueAt - right.dueAt || left.minExpiresAt - right.minExpiresAt)[0] ?? null;

  if (!dueCluster && !dueSuppressedTracks.length) {
    return {
      tracks,
      shouldAlert: false,
      alertDecision: createBuffExpiryPrecisionAlertDecision({
        now,
        alertLeadSeconds,
        shouldAlert: false,
        reason: "no-due-tracks",
        dueTracks: [],
        newAlertTrackIds: [],
        suppressedTrackIds: [],
        deferredTrackIds: staleDueTrackIds,
        markedTrackIds: [],
        dueGroupExpiresAt: null,
        nearestExistingAlertGroup: null,
      }),
    };
  }

  const newAlertTrackIds = dueCluster?.tracks.map((track) => track.id) ?? [];
  const suppressedTrackIds = dueSuppressedTracks.map((track) => track.id);
  const markedTrackIds = [...newAlertTrackIds, ...suppressedTrackIds];
  const markedTrackIdSet = new Set(markedTrackIds);
  const dueTracks = [
    ...(dueCluster?.tracks ?? []),
    ...dueSuppressedTracks.filter((track) => !markedTrackIdSet.has(track.id) || !newAlertTrackIds.includes(track.id)),
  ];
  const nextTracks = tracks.map((track) =>
    markedTrackIdSet.has(track.id) ? { ...track, alertedAt: now } : track,
  );

  return {
    tracks: nextTracks,
    shouldAlert: Boolean(dueCluster),
    alertDecision: createBuffExpiryPrecisionAlertDecision({
      now,
      alertLeadSeconds,
      shouldAlert: Boolean(dueCluster),
      reason: dueCluster ? "new-alert-group" : "existing-alert-group",
      dueTracks,
      newAlertTrackIds,
      suppressedTrackIds,
      deferredTrackIds: staleDueTrackIds,
      markedTrackIds,
      dueGroupExpiresAt: dueCluster?.minExpiresAt ?? null,
      nearestExistingAlertGroup: findNearestBuffExpiryPrecisionExistingAlertGroup(dueSuppressedTracks, alertedTracks),
    }),
  };
}

function getBuffExpiryPrecisionAlertClusterId(
  tracks: BuffExpiryTrackedBuff[],
  dueAt: number,
  minExpiresAt: number,
): string {
  const trackKey = tracks.map((track) => track.id).sort().join(",");
  return [
    "next-cluster",
    Math.round(minExpiresAt / 1000),
    Math.round(dueAt / 1000),
    trackKey,
  ].join(":");
}

function isNearAnyBuffExpiryPrecisionAlertedTrack(
  track: BuffExpiryTrackedBuff,
  alertedTracks: BuffExpiryTrackedBuff[],
): boolean {
  return alertedTracks.some(
    (alertedTrack) =>
      Math.abs(track.expiresAt - alertedTrack.expiresAt) <= BUFF_EXPIRY_PRECISION_ALERT_CLUSTER_WINDOW_MS,
  );
}

export function isFreshBuffExpiryPrecisionAlertTrack(
  track: Pick<BuffExpiryTrackedBuff, "lastSeenAt">,
  now: number,
): boolean {
  return now - track.lastSeenAt <= BUFF_EXPIRY_PRECISION_ALERT_MAX_STALE_MS;
}

function isBuffExpiryPrecisionTrackDue(
  track: Pick<BuffExpiryTrackedBuff, "expiresAt">,
  alertLeadSeconds: number,
  now: number,
): boolean {
  return getBuffExpiryPrecisionTrackDueAt(track, alertLeadSeconds) <= now;
}

function isBuffExpiryPrecisionTrackEligibleForAlertCluster(
  track: Pick<BuffExpiryTrackedBuff, "expiresAt" | "lastSeenAt">,
  alertLeadSeconds: number,
  now: number,
): boolean {
  if (isFreshBuffExpiryPrecisionAlertTrack(track, now)) {
    return true;
  }

  if (alertLeadSeconds >= 0) {
    return false;
  }

  const dueAt = getBuffExpiryPrecisionTrackDueAt(track, alertLeadSeconds);
  return now <= dueAt + BUFF_EXPIRY_PRECISION_ALERT_MAX_STALE_MS;
}

function getBuffExpiryPrecisionTrackDueAt(
  track: Pick<BuffExpiryTrackedBuff, "expiresAt">,
  alertLeadSeconds: number,
): number {
  return track.expiresAt - alertLeadSeconds * 1000;
}

function createBuffExpiryPrecisionAlertDecision({
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
      slotKey: getBuffExpiryPrecisionSlotKey(track.box),
      remainingSeconds: getBuffExpiryPrecisionRemainingSeconds(track, now),
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

function findNearestBuffExpiryPrecisionExistingAlertGroup(
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

function getBuffExpiryPrecisionSlotKey(box: BuffExpiryBox): string {
  if (Number.isFinite(box.row) && Number.isFinite(box.col)) {
    return `r${Math.round(box.row ?? 0)}:c${Math.round(box.col ?? 0)}`;
  }
  const side = box.side ?? box.width;
  return `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(side)}`;
}

function getBuffExpiryPrecisionRemainingSeconds(
  track: Pick<BuffExpiryTrackedBuff, "expiresAt">,
  now: number,
): number {
  return Math.max(0, Math.ceil((track.expiresAt - now) / 1000));
}
