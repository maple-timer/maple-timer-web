import type {
  RuneAlertTriggerEvidence,
  RuneAlertTriggerFrame,
  RuneEvidenceArchive,
  RuneRuntimeIncidentEvidence,
} from "../alertTypes";
import { enforceRuneEvidenceMediaBudget } from "./runeEvidenceMediaBudget";

export const RUNE_EVIDENCE_ARCHIVE_RETENTION_MS = 60_000;
export const RUNE_LAST_ALERT_TRIGGER_RETENTION_MS = 3 * 60_000;
export const RUNE_EVIDENCE_ARCHIVE_MAX_INCIDENTS = 3;
export const RUNE_EVIDENCE_ARCHIVE_MAX_EPISODES = 3;
export const RUNE_EVIDENCE_ARCHIVE_MAX_ALERT_TRIGGERS = 6;

export type RuneEvidenceArchiveUpdate = {
  archive: RuneEvidenceArchive | null;
  runtimeIncident: RuneRuntimeIncidentEvidence | null;
  pendingAlertTriggerFrames: RuneAlertTriggerFrame[];
  lastAlertTrigger: RuneAlertTriggerEvidence | null;
};

export function updateRuneEvidenceArchive({
  previousArchive,
  runtimeIncident,
  pendingAlertTriggerFrames,
  lastAlertTrigger,
  sampledAt,
}: {
  previousArchive: RuneEvidenceArchive | null | undefined;
  runtimeIncident: RuneRuntimeIncidentEvidence | null;
  pendingAlertTriggerFrames: RuneAlertTriggerFrame[];
  lastAlertTrigger: RuneAlertTriggerEvidence | null;
  sampledAt: number;
}): RuneEvidenceArchiveUpdate {
  const cutoff = sampledAt - RUNE_EVIDENCE_ARCHIVE_RETENTION_MS;
  const lastTriggerCutoff = sampledAt - RUNE_LAST_ALERT_TRIGGER_RETENTION_MS;
  const runtimeIncidents = mergeByKey(
    [
      ...(previousArchive?.runtimeIncidents ?? []),
      runtimeIncident,
    ].filter((entry): entry is RuneRuntimeIncidentEvidence => Boolean(entry)),
    (entry) => entry.id,
  )
    .filter(
      (entry) =>
        entry.startedAt <= sampledAt &&
        entry.lastSignalAt >= cutoff &&
        entry.lastSignalAt <= sampledAt,
    )
    .sort(
      (left, right) =>
        left.lastSignalAt - right.lastSignalAt || left.updatedAt - right.updatedAt,
    )
    .slice(-RUNE_EVIDENCE_ARCHIVE_MAX_INCIDENTS);
  const mergedAlertTriggers = mergeByKey(
    [
      ...(previousArchive?.alertTriggers ?? []),
      lastAlertTrigger,
    ].filter((entry): entry is RuneAlertTriggerEvidence => Boolean(entry)),
    (entry) => entry.cycleId,
  ).sort((left, right) => left.triggeredAt - right.triggeredAt);
  const latestAlertTrigger = mergedAlertTriggers[mergedAlertTriggers.length - 1] ?? null;
  const alertTriggers = limitAlertTriggersToRecentEpisodes(mergedAlertTriggers
    .filter(
      (entry) =>
        entry.triggeredAt <= sampledAt &&
        (entry.triggeredAt >= cutoff ||
          (entry.cycleId === latestAlertTrigger?.cycleId &&
            entry.triggeredAt >= lastTriggerCutoff)),
    )
    .slice(-RUNE_EVIDENCE_ARCHIVE_MAX_ALERT_TRIGGERS));
  const retainedRuntimeIncident = runtimeIncident
    ? runtimeIncidents.find((entry) => entry.id === runtimeIncident.id) ?? null
    : null;
  const retainedLastAlertTrigger = lastAlertTrigger
    ? alertTriggers.find((entry) => entry.cycleId === lastAlertTrigger.cycleId) ?? null
    : null;

  const bounded = enforceRuneEvidenceMediaBudget({
    runtimeIncident: retainedRuntimeIncident,
    runtimeIncidents,
    pendingAlertTriggerFrames,
    lastAlertTrigger: retainedLastAlertTrigger,
    alertTriggers,
  });
  const boundedRuntimeIncident = retainedRuntimeIncident
    ? bounded.runtimeIncidents.find((entry) => entry.id === retainedRuntimeIncident.id) ?? null
    : null;
  const boundedLastAlertTrigger = retainedLastAlertTrigger
    ? bounded.alertTriggers.find(
        (entry) => entry.cycleId === retainedLastAlertTrigger.cycleId,
      ) ?? null
    : null;
  const hasArchiveEvidence =
    bounded.runtimeIncidents.length > 0 || bounded.alertTriggers.length > 0;

  return {
    archive: hasArchiveEvidence
      ? {
          policy: "rune-recent-evidence-v2",
          retainedAt: sampledAt,
          runtimeIncidents: bounded.runtimeIncidents,
          alertTriggers: bounded.alertTriggers,
          mediaBudget: bounded.budget,
        }
      : null,
    runtimeIncident: boundedRuntimeIncident,
    pendingAlertTriggerFrames: bounded.pendingAlertTriggerFrames,
    lastAlertTrigger: boundedLastAlertTrigger,
  };
}

function mergeByKey<T>(items: T[], getKey: (item: T) => string) {
  const merged = new Map<string, T>();
  items.forEach((item) => merged.set(getKey(item), item));
  return [...merged.values()];
}

function limitAlertTriggersToRecentEpisodes(
  triggers: RuneAlertTriggerEvidence[],
) {
  const retainedEpisodeIds = new Set<string>();
  for (let index = triggers.length - 1; index >= 0; index -= 1) {
    const episodeId = triggers[index]?.episodeId;
    if (episodeId) {
      retainedEpisodeIds.add(episodeId);
      if (retainedEpisodeIds.size >= RUNE_EVIDENCE_ARCHIVE_MAX_EPISODES) {
        break;
      }
    }
  }
  if (retainedEpisodeIds.size === 0) {
    return triggers;
  }
  return triggers.filter(
    (trigger) => !trigger.episodeId || retainedEpisodeIds.has(trigger.episodeId),
  );
}
