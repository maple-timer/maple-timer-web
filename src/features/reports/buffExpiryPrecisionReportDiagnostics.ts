import { SUPPORTED_BUFF_EXPIRY_BUFF_IDS } from "../../domain/buff-expiry/catalog";
import { getBuffExpiryEffectiveAlertLeadSeconds } from "../../domain/buff-expiry/alertLeadPolicy";
import { getBuffExpiryPrecisionSelectedTargetGroups } from "../../domain/buff-expiry/precisionTrackingPolicy";
import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryAlertConfig } from "../../types";

export function buildBuffExpiryPrecisionAlertTimingDiagnostics(
  config: BuffExpiryAlertConfig,
  snapshot: BuffExpirySnapshot,
  state: BuffExpiryRuntimeState,
) {
  const sampledAt = snapshot.sampledAt;
  const alertLeadSeconds = getBuffExpiryEffectiveAlertLeadSeconds(config);
  const trackSummaries = snapshot.tracks
    .map((track) => {
      const alertAt = track.expiresAt - alertLeadSeconds * 1000;
      return {
        id: track.id,
        buffId: track.buffId,
        name: track.name,
        expiresAt: track.expiresAt,
        alertAt,
        alertInMs: alertAt - sampledAt,
        remainingSeconds: Math.max(0, Math.ceil((track.expiresAt - sampledAt) / 1000)),
        alertedAt: track.alertedAt,
      };
    })
    .sort((a, b) => a.alertAt - b.alertAt);
  const unalertedTracks = trackSummaries.filter((track) => track.alertedAt === null);
  const dueTracks = unalertedTracks.filter((track) => track.alertAt <= sampledAt);
  const nextAlertTrack = unalertedTracks.find((track) => track.alertAt > sampledAt) ?? null;
  const latestAlertDecision = snapshot.alertDecisionHistory?.length
    ? snapshot.alertDecisionHistory[snapshot.alertDecisionHistory.length - 1]
    : null;

  return {
    alertLeadSeconds,
    sampledAt,
    runtimeStatus: state.status,
    trackCount: trackSummaries.length,
    unalertedTrackCount: unalertedTracks.length,
    dueTrackCount: dueTracks.length,
    overdueTrackCount: dueTracks.filter((track) => track.alertInMs < -1000).length,
    nextAlertAt: nextAlertTrack?.alertAt ?? null,
    nextAlertInMs: nextAlertTrack?.alertInMs ?? null,
    nextAlertTrack: nextAlertTrack
      ? {
          id: nextAlertTrack.id,
          buffId: nextAlertTrack.buffId,
          name: nextAlertTrack.name,
          remainingSeconds: nextAlertTrack.remainingSeconds,
          expiresAt: nextAlertTrack.expiresAt,
        }
      : null,
    lastAlertedAt: state.lastAlertedAt,
    latestAlertDecision: latestAlertDecision
      ? {
          sampledAt: latestAlertDecision.sampledAt,
          shouldAlert: latestAlertDecision.shouldAlert,
          reason: latestAlertDecision.reason,
          dueTrackCount: latestAlertDecision.dueTracks.length,
          newAlertTrackIds: latestAlertDecision.newAlertTrackIds,
          markedTrackIds: latestAlertDecision.markedTrackIds,
        }
      : null,
  };
}

export function getBuffExpiryPrecisionConfigSnapshot(config: BuffExpiryAlertConfig) {
  return {
    enabled: config.enabled,
    alertLeadSeconds: getBuffExpiryEffectiveAlertLeadSeconds(config),
    supportedBuffIds: [...SUPPORTED_BUFF_EXPIRY_BUFF_IDS],
    selectedBuffIds: config.selectedBuffIds,
    selectedPrecisionTargetGroups: getBuffExpiryPrecisionSelectedTargetGroups(config),
    soundId: config.soundId,
    volume: config.volume,
  };
}
