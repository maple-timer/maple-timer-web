import { RUNTIME_EVIDENCE_ROLLING_MEDIA_BUDGET_CHARS } from "../../../contracts/reporting/runtimeEvidenceMediaPolicy";
import type {
  BuffExpiryIncidentConfigurationRevision,
  BuffExpiryIncidentCycle,
  BuffExpiryIncidentCycleEvent,
  BuffExpiryIncidentEpisode,
  BuffExpiryIncidentEpisodeTransition,
  BuffExpiryIncidentEvidenceArchive,
  BuffExpiryIncidentEvidenceOmission,
  BuffExpiryIncidentEvidenceOmissionReason,
  BuffExpiryIncidentEpoch,
  BuffExpiryIncidentFrame,
  BuffExpiryIncidentFrozenState,
  BuffExpiryIncidentMedia,
  BuffExpiryIncidentObservation,
  BuffExpiryIncidentPlaybackAttempt,
  BuffExpiryIncidentRuntimeEvent,
  FrozenBuffExpiryIncidentEvidence,
} from "./buffExpiryIncidentEvidenceTypes";
import { BUFF_EXPIRY_INCIDENT_EVIDENCE_SCHEMA_VERSION } from "./buffExpiryIncidentEvidenceTypes";

export const BUFF_EXPIRY_INCIDENT_RETENTION_MS = 60_000;
export const BUFF_EXPIRY_INCIDENT_CURRENT_WINDOW_MS = 10_000;
export const BUFF_EXPIRY_INCIDENT_MAX_FRAMES = 72;
export const BUFF_EXPIRY_INCIDENT_MAX_OBSERVATIONS = 360;
export const BUFF_EXPIRY_INCIDENT_MAX_TERMINAL_EPISODES = 12;
export const BUFF_EXPIRY_INCIDENT_MAX_TRANSITIONS = 240;
export const BUFF_EXPIRY_INCIDENT_MAX_CYCLE_ATTEMPT_RECORDS = 24;
export const BUFF_EXPIRY_INCIDENT_MAX_CYCLE_EVENTS = 96;
export const BUFF_EXPIRY_INCIDENT_MAX_RUNTIME_EVENTS = 192;
export const BUFF_EXPIRY_INCIDENT_MAX_CONFIGURATION_REVISIONS = 8;
export const BUFF_EXPIRY_INCIDENT_MAX_OMISSIONS = 32;
export const BUFF_EXPIRY_INCIDENT_MEDIA_MAX_FRAMES = 8;
export const BUFF_EXPIRY_INCIDENT_MEDIA_MAX_FRAME_CHARS = 512_000;
export const BUFF_EXPIRY_INCIDENT_MEDIA_MAX_TOTAL_CHARS =
  RUNTIME_EVIDENCE_ROLLING_MEDIA_BUDGET_CHARS.buffExpiry;

export type BuffExpiryIncidentEvidencePatch = {
  frames?: BuffExpiryIncidentFrame[];
  observations?: BuffExpiryIncidentObservation[];
  episodes?: BuffExpiryIncidentEpisode[];
  transitions?: BuffExpiryIncidentEpisodeTransition[];
  cycles?: BuffExpiryIncidentCycle[];
  cycleEvents?: BuffExpiryIncidentCycleEvent[];
  attempts?: BuffExpiryIncidentPlaybackAttempt[];
  runtimeEvents?: BuffExpiryIncidentRuntimeEvent[];
  configurationRevisions?: BuffExpiryIncidentConfigurationRevision[];
  frozenState?: BuffExpiryIncidentFrozenState | null;
  media?: BuffExpiryIncidentMedia[];
  omissions?: BuffExpiryIncidentEvidenceOmission[];
};

export function createBuffExpiryIncidentEvidenceArchive({
  epoch,
  now = epoch.createdAt,
}: {
  epoch: BuffExpiryIncidentEpoch;
  now?: number;
}): BuffExpiryIncidentEvidenceArchive {
  return {
    schemaVersion: BUFF_EXPIRY_INCIDENT_EVIDENCE_SCHEMA_VERSION,
    epoch,
    updatedAt: now,
    frames: [],
    observations: [],
    episodes: [],
    transitions: [],
    cycles: [],
    cycleEvents: [],
    attempts: [],
    runtimeEvents: [],
    configurationRevisions: [],
    frozenState: null,
    media: [],
    omissions: [],
  };
}

export function updateBuffExpiryIncidentEvidenceArchive({
  previous,
  epoch,
  patch,
  now,
}: {
  previous: BuffExpiryIncidentEvidenceArchive | null | undefined;
  epoch: BuffExpiryIncidentEpoch;
  patch: BuffExpiryIncidentEvidencePatch;
  now: number;
}): BuffExpiryIncidentEvidenceArchive {
  const epochChanged = Boolean(previous && previous.epoch.id !== epoch.id);
  const base =
    previous && !epochChanged
      ? previous
      : createBuffExpiryIncidentEvidenceArchive({ epoch, now });
  const resetOmission = epochChanged
    ? createOmission({
        kind: "event",
        reason: "reset-epoch",
        subjectIds: [previous?.epoch.id ?? "unknown"],
        count: 1,
        occurredAt: now,
      })
    : null;

  return compactBuffExpiryIncidentEvidenceArchive(
    {
      ...base,
      epoch,
      updatedAt: now,
      frames: mergeById(base.frames, patch.frames),
      observations: mergeById(base.observations, patch.observations),
      episodes: mergeById(base.episodes, patch.episodes),
      transitions: mergeById(base.transitions, patch.transitions),
      cycles: mergeById(base.cycles, patch.cycles),
      cycleEvents: mergeById(base.cycleEvents, patch.cycleEvents),
      attempts: mergeById(base.attempts, patch.attempts),
      runtimeEvents: mergeById(base.runtimeEvents, patch.runtimeEvents),
      configurationRevisions: mergeById(
        base.configurationRevisions,
        patch.configurationRevisions,
      ),
      frozenState:
        patch.frozenState === undefined ? base.frozenState : patch.frozenState,
      media: mergeByKey(base.media, patch.media, (entry) => entry.frameId),
      omissions: mergeById(
        base.omissions,
        [
          ...(patch.omissions ?? []),
          ...(resetOmission ? [resetOmission] : []),
        ],
      ),
    },
    now,
  );
}

export function compactBuffExpiryIncidentEvidenceArchive(
  archive: BuffExpiryIncidentEvidenceArchive,
  now: number,
): BuffExpiryIncidentEvidenceArchive {
  const cutoff = now - BUFF_EXPIRY_INCIDENT_RETENTION_MS;
  const omissions = [...archive.omissions].filter(
    (entry) => entry.occurredAt <= now && entry.occurredAt >= cutoff,
  );

  const frameCandidates = archive.frames
    .filter(
      (frame) =>
        frame.epochId === archive.epoch.id &&
        frame.sampledAt >= cutoff &&
        frame.sampledAt <= now,
    )
    .sort(compareByTimeAndId((entry) => entry.sampledAt));
  const frames = frameCandidates.slice(-BUFF_EXPIRY_INCIDENT_MAX_FRAMES);
  appendCapOmission({
    omissions,
    kind: "frame",
    candidates: frameCandidates,
    retained: frames,
    now,
  });
  const retainedFrameIds = new Set(frames.map((entry) => entry.id));

  const episodes = compactEpisodes(archive.episodes, archive.epoch.id, cutoff, now);
  appendCountOmission({
    omissions,
    kind: "episode",
    reason: "metadata-cap",
    count: Math.max(
      0,
      archive.episodes.filter(
        (entry) =>
          entry.epochId === archive.epoch.id &&
          entry.status === "terminal" &&
          entry.lastEventAt >= cutoff &&
          entry.lastEventAt <= now,
      ).length - BUFF_EXPIRY_INCIDENT_MAX_TERMINAL_EPISODES,
    ),
    now,
  });
  const retainedEpisodeIds = new Set(episodes.map((entry) => entry.id));

  const transitions = compactTransitions({
    transitions: archive.transitions,
    episodes,
    cutoff,
    now,
  });
  appendCapOmission({
    omissions,
    kind: "transition",
    candidates: archive.transitions.filter(
      (entry) =>
        retainedEpisodeIds.has(entry.episodeId) && entry.occurredAt <= now,
    ),
    retained: transitions,
    now,
  });
  const retainedTransitionIds = new Set(transitions.map((entry) => entry.id));

  const observationCandidates = archive.observations
    .filter(
      (entry) =>
        entry.epochId === archive.epoch.id &&
        entry.sampledAt >= cutoff &&
        entry.sampledAt <= now &&
        retainedFrameIds.has(entry.frameId),
    )
    .sort(compareByTimeAndId((entry) => entry.sampledAt));
  const observations = observationCandidates.slice(
    -BUFF_EXPIRY_INCIDENT_MAX_OBSERVATIONS,
  );
  appendCapOmission({
    omissions,
    kind: "observation",
    candidates: observationCandidates,
    retained: observations,
    now,
  });
  const retainedObservationIds = new Set(observations.map((entry) => entry.id));

  const compactCycleData = compactCyclesAndAttempts({
    cycles: archive.cycles,
    attempts: archive.attempts,
    epochId: archive.epoch.id,
    cutoff,
    now,
  });
  const cycles = compactCycleData.cycles;
  const attempts = compactCycleData.attempts;
  appendCountOmission({
    omissions,
    kind: "cycle",
    reason: "metadata-cap",
    count: compactCycleData.omittedCount,
    now,
  });
  const retainedCycleIds = new Set(cycles.map((entry) => entry.id));
  const cycleEventCandidates = archive.cycleEvents
    .filter(
      (entry) =>
        retainedCycleIds.has(entry.cycleId) &&
        entry.occurredAt <= now &&
        (entry.occurredAt >= cutoff ||
          cycles.some(
            (cycle) =>
              cycle.id === entry.cycleId &&
              (cycle.status === "registered" || cycle.status === "rescheduled"),
          )),
    )
    .sort(compareByTimeAndId((entry) => entry.occurredAt));
  const cycleEvents = cycleEventCandidates.slice(
    -BUFF_EXPIRY_INCIDENT_MAX_CYCLE_EVENTS,
  );
  appendCapOmission({
    omissions,
    kind: "event",
    candidates: cycleEventCandidates,
    retained: cycleEvents,
    now,
  });

  const runtimeEventCandidates = archive.runtimeEvents
    .filter(
      (entry) =>
        entry.epochId === archive.epoch.id &&
        entry.occurredAt >= cutoff &&
        entry.occurredAt <= now,
    )
    .sort(compareByTimeAndId((entry) => entry.occurredAt));
  const runtimeEvents = runtimeEventCandidates.slice(
    -BUFF_EXPIRY_INCIDENT_MAX_RUNTIME_EVENTS,
  );
  appendCapOmission({
    omissions,
    kind: "event",
    candidates: runtimeEventCandidates,
    retained: runtimeEvents,
    now,
  });

  const referencedConfigIds = new Set<string>([
    ...cycles.map((entry) => entry.configRevision),
    ...runtimeEvents.flatMap((entry) =>
      entry.configRevision ? [entry.configRevision] : [],
    ),
    ...(archive.frozenState?.configRevision
      ? [archive.frozenState.configRevision]
      : []),
  ]);
  const configurationRevisions = archive.configurationRevisions
    .filter(
      (entry) =>
        entry.capturedAt <= now &&
        (entry.capturedAt >= cutoff || referencedConfigIds.has(entry.id)),
    )
    .sort(compareByTimeAndId((entry) => entry.capturedAt))
    .slice(-BUFF_EXPIRY_INCIDENT_MAX_CONFIGURATION_REVISIONS);

  const mediaBudget = enforceBuffExpiryIncidentMediaBudget({
    media: archive.media.filter((entry) => retainedFrameIds.has(entry.frameId)),
    now,
  });
  omissions.push(...mediaBudget.omissions);

  const retainedCycleIdSet = new Set(cycles.map((entry) => entry.id));
  const normalizedEpisodes = episodes.map((episode) => ({
    ...episode,
    observationIds: episode.observationIds.filter((id) =>
      retainedObservationIds.has(id),
    ),
    transitionIds: episode.transitionIds.filter((id) =>
      retainedTransitionIds.has(id),
    ),
    cycleIds: episode.cycleIds.filter((id) => retainedCycleIdSet.has(id)),
  }));

  return {
    ...archive,
    updatedAt: now,
    frames,
    observations,
    episodes: normalizedEpisodes,
    transitions,
    cycles,
    cycleEvents,
    attempts,
    runtimeEvents,
    configurationRevisions,
    frozenState:
      archive.frozenState?.epochId === archive.epoch.id &&
      archive.frozenState.capturedAt <= now
        ? archive.frozenState
        : null,
    media: mediaBudget.media,
    omissions: uniqueById(omissions)
      .sort(compareByTimeAndId((entry) => entry.occurredAt))
      .slice(-BUFF_EXPIRY_INCIDENT_MAX_OMISSIONS),
  };
}

export function freezeBuffExpiryIncidentEvidence({
  archive,
  capturedAt,
  frozenState,
}: {
  archive: BuffExpiryIncidentEvidenceArchive;
  capturedAt: number;
  frozenState?: BuffExpiryIncidentFrozenState | null;
}): FrozenBuffExpiryIncidentEvidence {
  const compacted = compactBuffExpiryIncidentEvidenceArchive(
    {
      ...archive,
      frozenState:
        frozenState === undefined ? archive.frozenState : frozenState,
    },
    capturedAt,
  );
  return cloneEvidence({ ...compacted, frozenAt: capturedAt });
}

export function enforceBuffExpiryIncidentMediaBudget({
  media,
  now,
}: {
  media: BuffExpiryIncidentMedia[];
  now: number;
}): {
  media: BuffExpiryIncidentMedia[];
  omissions: BuffExpiryIncidentEvidenceOmission[];
  retainedChars: number;
} {
  const deduplicated = mergeByKey([], media, (entry) => entry.frameId).sort(
    (left, right) =>
      getMediaPriority(right) - getMediaPriority(left) ||
      right.sampledAt - left.sampledAt ||
      left.frameId.localeCompare(right.frameId),
  );
  const retained: BuffExpiryIncidentMedia[] = [];
  const oversized: string[] = [];
  const exhausted: string[] = [];
  let retainedChars = 0;

  for (const entry of deduplicated) {
    if (entry.dataUrl.length > BUFF_EXPIRY_INCIDENT_MEDIA_MAX_FRAME_CHARS) {
      oversized.push(entry.frameId);
      continue;
    }
    if (
      retained.length >= BUFF_EXPIRY_INCIDENT_MEDIA_MAX_FRAMES ||
      retainedChars + entry.dataUrl.length >
        BUFF_EXPIRY_INCIDENT_MEDIA_MAX_TOTAL_CHARS
    ) {
      exhausted.push(entry.frameId);
      continue;
    }
    retained.push(entry);
    retainedChars += entry.dataUrl.length;
  }

  return {
    media: retained.sort(
      (left, right) =>
        left.sampledAt - right.sampledAt ||
        left.frameId.localeCompare(right.frameId),
    ),
    omissions: [
      ...(oversized.length
        ? [
            createOmission({
              kind: "media",
              reason: "media-oversize",
              subjectIds: oversized,
              count: oversized.length,
              occurredAt: now,
            }),
          ]
        : []),
      ...(exhausted.length
        ? [
            createOmission({
              kind: "media",
              reason: "media-budget-exhausted",
              subjectIds: exhausted,
              count: exhausted.length,
              occurredAt: now,
            }),
          ]
        : []),
    ],
    retainedChars,
  };
}

function compactEpisodes(
  episodes: BuffExpiryIncidentEpisode[],
  epochId: string,
  cutoff: number,
  now: number,
) {
  const inEpoch = episodes.filter(
    (episode) => episode.epochId === epochId && episode.startedAt <= now,
  );
  const active = inEpoch
    .filter((episode) => episode.status !== "terminal")
    .sort(compareByTimeAndId((entry) => entry.lastEventAt));
  const terminal = inEpoch
    .filter(
      (episode) =>
        episode.status === "terminal" && episode.lastEventAt >= cutoff,
    )
    .sort(compareByTimeAndId((entry) => entry.lastEventAt))
    .slice(-BUFF_EXPIRY_INCIDENT_MAX_TERMINAL_EPISODES);
  return uniqueById([...active, ...terminal]).sort(
    compareByTimeAndId((entry) => entry.lastEventAt),
  );
}

function compactTransitions({
  transitions,
  episodes,
  cutoff,
  now,
}: {
  transitions: BuffExpiryIncidentEpisodeTransition[];
  episodes: BuffExpiryIncidentEpisode[];
  cutoff: number;
  now: number;
}) {
  const retainedEpisodeIds = new Set(episodes.map((entry) => entry.id));
  const eligible = transitions
    .filter(
      (entry) =>
        retainedEpisodeIds.has(entry.episodeId) && entry.occurredAt <= now,
    )
    .sort(compareByTimeAndId((entry) => entry.occurredAt));
  const activeEpisodeIds = new Set(
    episodes.filter((entry) => entry.status !== "terminal").map((entry) => entry.id),
  );
  const required = new Map<string, BuffExpiryIncidentEpisodeTransition>();
  for (const episodeId of activeEpisodeIds) {
    const latest = [...eligible]
      .reverse()
      .find((entry) => entry.episodeId === episodeId);
    if (latest) {
      required.set(latest.id, latest);
    }
  }
  const recent = eligible.filter((entry) => entry.occurredAt >= cutoff);
  const selected = new Map(required);
  for (const entry of [...recent].reverse()) {
    if (selected.size >= BUFF_EXPIRY_INCIDENT_MAX_TRANSITIONS) {
      break;
    }
    selected.set(entry.id, entry);
  }
  return [...selected.values()].sort(
    compareByTimeAndId((entry) => entry.occurredAt),
  );
}

function compactCyclesAndAttempts({
  cycles,
  attempts,
  epochId,
  cutoff,
  now,
}: {
  cycles: BuffExpiryIncidentCycle[];
  attempts: BuffExpiryIncidentPlaybackAttempt[];
  epochId: string;
  cutoff: number;
  now: number;
}) {
  const eligibleCycles = cycles
    .filter(
      (cycle) =>
        cycle.epochId === epochId &&
        cycle.createdAt <= now &&
        (cycle.updatedAt >= cutoff ||
          cycle.status === "registered" ||
          cycle.status === "rescheduled"),
    )
    .sort(compareByTimeAndId((entry) => entry.updatedAt));
  const eligibleAttempts = attempts
    .filter(
      (attempt) =>
        attempt.requestedAt >= cutoff &&
        attempt.requestedAt <= now &&
        eligibleCycles.some((cycle) => cycle.id === attempt.cycleId),
    )
    .sort(compareByTimeAndId((entry) => entry.requestedAt));
  const units = eligibleCycles
    .map((cycle) => ({
      cycle,
      attempts: eligibleAttempts.filter((attempt) => attempt.cycleId === cycle.id),
      active: cycle.status === "registered" || cycle.status === "rescheduled",
    }))
    .sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        right.cycle.updatedAt - left.cycle.updatedAt ||
        left.cycle.id.localeCompare(right.cycle.id),
    );
  const selectedCycles: BuffExpiryIncidentCycle[] = [];
  const selectedAttempts: BuffExpiryIncidentPlaybackAttempt[] = [];
  let descriptorCount = 0;
  for (const unit of units) {
    if (descriptorCount >= BUFF_EXPIRY_INCIDENT_MAX_CYCLE_ATTEMPT_RECORDS) {
      break;
    }
    selectedCycles.push(unit.cycle);
    descriptorCount += 1;
    for (const attempt of [...unit.attempts].reverse()) {
      if (descriptorCount >= BUFF_EXPIRY_INCIDENT_MAX_CYCLE_ATTEMPT_RECORDS) {
        break;
      }
      selectedAttempts.push(attempt);
      descriptorCount += 1;
    }
  }
  return {
    cycles: selectedCycles.sort(compareByTimeAndId((entry) => entry.updatedAt)),
    attempts: selectedAttempts.sort(
      compareByTimeAndId((entry) => entry.requestedAt),
    ),
    omittedCount: Math.max(
      0,
      eligibleCycles.length + eligibleAttempts.length - descriptorCount,
    ),
  };
}

function getMediaPriority(entry: BuffExpiryIncidentMedia): number {
  switch (entry.reason) {
    case "playback-failed":
      return 120;
    case "fired-trigger":
      return 115;
    case "pre-due":
      return 110;
    case "confirmation":
      return 100;
    case "accepted-observation":
      return 90;
    case "rejected-observation":
      return 80;
    case "track-loss":
      return 70;
    case "track-replacement":
      return 65;
    case "current":
      return 40;
    case "periodic":
      return 10;
  }
}

function mergeById<T extends { id: string }>(
  previous: T[],
  incoming: T[] | undefined,
) {
  return mergeByKey(previous, incoming, (entry) => entry.id);
}

function mergeByKey<T>(
  previous: T[],
  incoming: T[] | undefined,
  getKey: (entry: T) => string,
) {
  const merged = new Map(previous.map((entry) => [getKey(entry), entry]));
  for (const entry of incoming ?? []) {
    const key = getKey(entry);
    const current = merged.get(key);
    if (
      !current ||
      !isMediaEntry(current) ||
      !isMediaEntry(entry) ||
      getMediaPriority(entry) >= getMediaPriority(current)
    ) {
      merged.set(key, entry);
    }
  }
  return [...merged.values()];
}

function isMediaEntry(value: unknown): value is BuffExpiryIncidentMedia {
  return Boolean(
    value &&
      typeof value === "object" &&
      "frameId" in value &&
      "reason" in value &&
      "dataUrl" in value,
  );
}

function uniqueById<T extends { id: string }>(entries: T[]) {
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()];
}

function compareByTimeAndId<T extends { id?: string }>(
  getTime: (entry: T) => number,
) {
  return (left: T, right: T) =>
    getTime(left) - getTime(right) ||
    (left.id ?? "").localeCompare(right.id ?? "");
}

function appendCapOmission<T extends { id: string }>({
  omissions,
  kind,
  candidates,
  retained,
  now,
}: {
  omissions: BuffExpiryIncidentEvidenceOmission[];
  kind: BuffExpiryIncidentEvidenceOmission["kind"];
  candidates: T[];
  retained: T[];
  now: number;
}) {
  const retainedIds = new Set(retained.map((entry) => entry.id));
  const omitted = candidates.filter((entry) => !retainedIds.has(entry.id));
  appendCountOmission({
    omissions,
    kind,
    reason: "metadata-cap",
    count: omitted.length,
    subjectIds: omitted.map((entry) => entry.id),
    now,
  });
}

function appendCountOmission({
  omissions,
  kind,
  reason,
  count,
  subjectIds = [],
  now,
}: {
  omissions: BuffExpiryIncidentEvidenceOmission[];
  kind: BuffExpiryIncidentEvidenceOmission["kind"];
  reason: BuffExpiryIncidentEvidenceOmissionReason;
  count: number;
  subjectIds?: string[];
  now: number;
}) {
  if (count <= 0) {
    return;
  }
  omissions.push(
    createOmission({
      kind,
      reason,
      count,
      subjectIds: subjectIds.slice(0, 24),
      occurredAt: now,
    }),
  );
}

function createOmission({
  kind,
  reason,
  subjectIds,
  count,
  occurredAt,
}: Omit<BuffExpiryIncidentEvidenceOmission, "id">): BuffExpiryIncidentEvidenceOmission {
  const subjectToken = createOmissionSubjectToken(subjectIds, count);
  return {
    id: `buff-expiry-omission:${reason}:${kind}:${Math.round(occurredAt)}:${subjectToken}`,
    kind,
    reason,
    subjectIds,
    count,
    occurredAt,
  };
}

function createOmissionSubjectToken(subjectIds: string[], count: number): string {
  const value = `${count}|${subjectIds.join("|")}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function cloneEvidence<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
