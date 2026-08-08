import { getBuffExpiryBoxPreviewDataUrlForBox } from "../../../lib/buffExpiry/buffExpiryEvidence";
import type {
  BuffExpiryLastAlertEvidence,
  BuffExpirySnapshot,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryAlertDecision } from "../../../domain/buff-expiry/precisionAlertTypes";
import type { BuffExpiryTrackedBuff } from "../../../domain/buff-expiry/precisionTrackingTypes";

export type ScheduledBuffExpiryAlert = {
  dueAt: number;
  timerId: number;
  cycleId: string;
  episodeIds: string[];
};

export function buildBuffExpiryLastAlertEvidence({
  alertedAt,
  alertLeadSeconds,
  clusterId,
  dueAt,
  alertDecision,
  tracks,
  snapshot,
}: {
  alertedAt: number;
  alertLeadSeconds: number;
  clusterId: string | null;
  dueAt: number | null;
  alertDecision: BuffExpiryAlertDecision;
  tracks: BuffExpiryTrackedBuff[];
  snapshot: BuffExpirySnapshot | null;
}): BuffExpiryLastAlertEvidence | null {
  const triggeredTrackIds = new Set(alertDecision.newAlertTrackIds);
  const triggeredTracks = tracks
    .filter((track) => triggeredTrackIds.has(track.id))
    .map((track) => ({
      id: track.id,
      buffId: track.buffId,
      name: track.name,
      box: track.box,
      expiresAt: track.expiresAt,
      remainingSeconds: Math.max(
        0,
        Math.ceil((track.expiresAt - alertedAt) / 1000),
      ),
      normalizedIconDataUrl:
        track.normalizedIconDataUrl ??
        getBuffExpiryBoxPreviewDataUrlForBox({
          box: track.box,
          boxes: snapshot?.boxes ?? [],
          boxPreviewUrls: snapshot?.boxPreviewUrls,
        }),
    }));

  if (!triggeredTracks.length) {
    return null;
  }

  return {
    alertedAt,
    alertLeadSeconds,
    clusterId,
    dueAt,
    triggeredTracks,
  };
}

export function getBuffExpiryAlertDueAt(
  track: BuffExpiryTrackedBuff,
  alertLeadSeconds: number,
): number {
  return track.expiresAt - alertLeadSeconds * 1000;
}

export function getBuffExpiryScheduledAlertKey(
  track: BuffExpiryTrackedBuff,
  dueAt: number,
): string {
  return [
    track.id,
    Math.round(track.expiresAt / 1000),
    Math.round(dueAt / 1000),
  ].join(":");
}
