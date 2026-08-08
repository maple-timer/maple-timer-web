import type {
  FrozenSkillIncidentEvidence,
  SkillIncidentAlertDecision,
  SkillIncidentConfigurationRevision,
  SkillIncidentCycle,
  SkillIncidentEpoch,
  SkillIncidentEvidenceArchive,
  SkillIncidentEvidenceOmission,
  SkillIncidentEvidenceOmissionReason,
  SkillIncidentFrame,
  SkillIncidentLifecycleEvent,
  SkillIncidentMedia,
  SkillIncidentObservation,
  SkillIncidentPlaybackAttempt,
  SkillIncidentTargetArbitration,
} from "./skillIncidentEvidenceTypes";
import { SKILL_INCIDENT_EVIDENCE_SCHEMA_VERSION } from "./skillIncidentEvidenceTypes";

export const SKILL_INCIDENT_RETENTION_MS = 60_000;
export const SKILL_INCIDENT_CURRENT_WINDOW_MS = 10_000;
export const SKILL_INCIDENT_MAX_EVENTS = 768;
export const SKILL_INCIDENT_MAX_ORDINARY_FRAMES_PER_SKILL = 96;
export const SKILL_INCIDENT_MAX_CYCLES = 64;
export const SKILL_INCIDENT_MAX_ATTEMPTS = 96;
export const SKILL_INCIDENT_MAX_CONFIGURATION_REVISIONS = 64;
export const SKILL_INCIDENT_MAX_OMISSIONS = 64;
export const SKILL_INCIDENT_MEDIA_MAX_ENTRIES = 24;
export const SKILL_INCIDENT_MEDIA_MAX_ENTRY_CHARS = 1_200_000;
export const SKILL_INCIDENT_MEDIA_MAX_TOTAL_CHARS = 1_250_000;
export const SKILL_INCIDENT_METADATA_MAX_CHARS = 256 * 1024;

export type SkillIncidentEvidencePatch = {
  currentEpochIds?: Record<string, string | null | undefined>;
  epochs?: SkillIncidentEpoch[];
  frames?: SkillIncidentFrame[];
  observations?: SkillIncidentObservation[];
  cycles?: SkillIncidentCycle[];
  decisions?: SkillIncidentAlertDecision[];
  arbitrations?: SkillIncidentTargetArbitration[];
  attempts?: SkillIncidentPlaybackAttempt[];
  lifecycleEvents?: SkillIncidentLifecycleEvent[];
  configurationRevisions?: SkillIncidentConfigurationRevision[];
  media?: SkillIncidentMedia[];
  omissions?: SkillIncidentEvidenceOmission[];
};

export type SkillIncidentMediaBudgetResult = {
  media: SkillIncidentMedia[];
  aliases: Map<string, string>;
  omissions: SkillIncidentEvidenceOmission[];
  retainedChars: number;
  deduplicatedCount: number;
};

export function createSkillIncidentEvidenceArchive(
  now = Date.now(),
): SkillIncidentEvidenceArchive {
  return {
    schemaVersion: SKILL_INCIDENT_EVIDENCE_SCHEMA_VERSION,
    updatedAt: now,
    currentEpochIds: {},
    epochs: [],
    frames: [],
    observations: [],
    cycles: [],
    decisions: [],
    arbitrations: [],
    attempts: [],
    lifecycleEvents: [],
    configurationRevisions: [],
    media: [],
    omissions: [],
  };
}

export function updateSkillIncidentEvidenceArchive({
  previous,
  patch,
  now,
}: {
  previous: SkillIncidentEvidenceArchive | null | undefined;
  patch: SkillIncidentEvidencePatch;
  now: number;
}): SkillIncidentEvidenceArchive {
  const base = previous ?? createSkillIncidentEvidenceArchive(now);
  const currentEpochIds = { ...base.currentEpochIds };
  for (const [skillId, epochId] of Object.entries(
    patch.currentEpochIds ?? {},
  )) {
    if (typeof epochId === "string" && epochId) {
      currentEpochIds[skillId] = epochId;
    } else {
      delete currentEpochIds[skillId];
    }
  }

  return compactSkillIncidentEvidenceArchive(
    {
      ...base,
      updatedAt: now,
      currentEpochIds,
      epochs: mergeById(base.epochs, patch.epochs),
      frames: mergeById(base.frames, patch.frames),
      observations: mergeById(base.observations, patch.observations),
      cycles: mergeById(base.cycles, patch.cycles),
      decisions: mergeById(base.decisions, patch.decisions),
      arbitrations: mergeById(base.arbitrations, patch.arbitrations),
      attempts: mergeById(base.attempts, patch.attempts),
      lifecycleEvents: mergeById(
        base.lifecycleEvents,
        patch.lifecycleEvents,
      ),
      configurationRevisions: mergeById(
        base.configurationRevisions,
        patch.configurationRevisions,
      ),
      media: mergeMedia(base.media, patch.media),
      omissions: mergeById(base.omissions, patch.omissions),
    },
    now,
  );
}

export function compactSkillIncidentEvidenceArchive(
  archive: SkillIncidentEvidenceArchive,
  now: number,
): SkillIncidentEvidenceArchive {
  const cutoff = now - SKILL_INCIDENT_RETENTION_MS;
  const omissions = archive.omissions.filter(
    (entry) => entry.occurredAt >= cutoff && entry.occurredAt <= now,
  );
  const currentEpochIds = new Set(Object.values(archive.currentEpochIds));

  const eligibleCycles = archive.cycles.filter(
    (cycle) =>
      cycle.startedAt <= now &&
      (cycle.status !== "terminal" || cycle.lastEventAt >= cutoff),
  );
  const cycles = selectCycles(eligibleCycles);
  appendDroppedOmission({
    omissions,
    kind: "cycle",
    reason: "metadata-budget",
    candidates: eligibleCycles,
    retained: cycles,
    occurredAt: now,
  });
  const cycleIds = new Set(cycles.map((entry) => entry.id));
  const requiredObservationIds = new Set(
    cycles.flatMap((cycle) => cycle.anchorObservationIds),
  );

  const eligibleEpochs = archive.epochs.filter(
    (epoch) =>
      epoch.createdAt <= now &&
      (epoch.closedAt === null ||
        epoch.closedAt >= cutoff ||
        currentEpochIds.has(epoch.id) ||
        cycles.some((cycle) => cycle.epochId === epoch.id)),
  );
  const epochIds = new Set(eligibleEpochs.map((entry) => entry.id));

  const eligibleObservations = archive.observations.filter(
    (entry) =>
      entry.sampledAt <= now &&
      epochIds.has(entry.epochId) &&
      (entry.sampledAt >= cutoff || requiredObservationIds.has(entry.id)),
  );
  const eligibleObservationIds = new Set(
    eligibleObservations.map((entry) => entry.id),
  );
  const requiredFrameIds = new Set(
    eligibleObservations
      .filter((entry) => requiredObservationIds.has(entry.id))
      .map((entry) => entry.frameId),
  );
  const frameCap = capOrdinaryFramesPerSkill(
    archive.frames.filter(
      (entry) =>
        entry.sampledAt <= now &&
        epochIds.has(entry.epochId) &&
        (entry.sampledAt >= cutoff || requiredFrameIds.has(entry.id)),
    ),
  );
  const eligibleFrames = frameCap.frames;
  if (frameCap.dropped.length > 0) {
    omissions.push(
      createOmission({
        kind: "frame",
        reason: "metadata-budget",
        subjectIds: frameCap.dropped.map((entry) => entry.id).slice(0, 24),
        count: frameCap.dropped.length,
        occurredAt: now,
      }),
    );
  }
  const eligibleFrameIds = new Set(eligibleFrames.map((entry) => entry.id));
  const observationsWithFrames = eligibleObservations.filter((entry) =>
    eligibleFrameIds.has(entry.frameId),
  );

  const eligibleDecisions = archive.decisions.filter(
    (entry) =>
      cycleIds.has(entry.cycleId) &&
      entry.occurredAt <= now &&
      (entry.occurredAt >= cutoff || cycleIds.has(entry.cycleId)),
  );
  const eligibleDecisionIds = new Set(
    eligibleDecisions.map((entry) => entry.id),
  );
  const eligibleArbitrations = archive.arbitrations.filter(
    (entry) =>
      entry.occurredAt <= now &&
      (entry.occurredAt >= cutoff ||
        entry.decisionIds.some((id) => eligibleDecisionIds.has(id))),
  );
  const eligibleLifecycleEvents = archive.lifecycleEvents.filter(
    (entry) =>
      entry.occurredAt >= cutoff &&
      entry.occurredAt <= now &&
      (!entry.epochId || epochIds.has(entry.epochId)),
  );

  const eventSelection = selectAggregateEvents({
    frames: eligibleFrames,
    observations: observationsWithFrames,
    decisions: eligibleDecisions,
    arbitrations: eligibleArbitrations,
    lifecycleEvents: eligibleLifecycleEvents,
    requiredObservationIds,
  });
  omissions.push(...eventSelection.omissions);

  const frameIds = new Set(eventSelection.frames.map((entry) => entry.id));
  const observationIds = new Set(
    eventSelection.observations.map((entry) => entry.id),
  );
  const decisionIds = new Set(
    eventSelection.decisions.map((entry) => entry.id),
  );
  const arbitrationIds = new Set(
    eventSelection.arbitrations.map((entry) => entry.id),
  );

  const attempts = archive.attempts
    .filter(
      (entry) =>
        cycleIds.has(entry.cycleId) &&
        decisionIds.has(entry.decisionId) &&
        entry.requestedAt <= now,
    )
    .sort(compareByTimeAndId((entry) => entry.requestedAt))
    .slice(-SKILL_INCIDENT_MAX_ATTEMPTS);
  appendDroppedOmission({
    omissions,
    kind: "attempt",
    reason: "metadata-budget",
    candidates: archive.attempts.filter(
      (entry) => cycleIds.has(entry.cycleId) && entry.requestedAt <= now,
    ),
    retained: attempts,
    occurredAt: now,
  });
  const attemptIds = new Set(attempts.map((entry) => entry.id));

  const normalizedFrames = eventSelection.frames.map((entry) => ({
    ...entry,
    observationIds: entry.observationIds.filter((id) => observationIds.has(id)),
  }));
  const normalizedCycles = cycles.map((entry) => ({
    ...entry,
    anchorObservationIds: entry.anchorObservationIds.filter((id) =>
      observationIds.has(id),
    ),
    observationIds: entry.observationIds.filter((id) =>
      observationIds.has(id),
    ),
    decisionIds: entry.decisionIds.filter((id) => decisionIds.has(id)),
  }));
  const normalizedDecisions = eventSelection.decisions.map((entry) => ({
    ...entry,
    frameId: entry.frameId && frameIds.has(entry.frameId) ? entry.frameId : null,
    observationId:
      entry.observationId && observationIds.has(entry.observationId)
        ? entry.observationId
        : null,
    arbitrationId:
      entry.arbitrationId && arbitrationIds.has(entry.arbitrationId)
        ? entry.arbitrationId
        : null,
    attemptId:
      entry.attemptId && attemptIds.has(entry.attemptId)
        ? entry.attemptId
        : null,
  }));
  const normalizedArbitrations = eventSelection.arbitrations.map((entry) => ({
    ...entry,
    decisionIds: entry.decisionIds.filter((id) => decisionIds.has(id)),
  }));

  const referencedConfigurationIds = new Set([
    ...normalizedFrames.map((entry) => entry.configRevisionId),
    ...normalizedCycles.flatMap((entry) => entry.configRevisionIds),
    ...normalizedDecisions.map((entry) => entry.configRevisionId),
    ...eventSelection.lifecycleEvents.flatMap((entry) =>
      entry.configRevisionId ? [entry.configRevisionId] : [],
    ),
  ]);
  const configurationCandidates = archive.configurationRevisions
    .filter(
      (entry) =>
        entry.capturedAt <= now &&
        (entry.capturedAt >= cutoff || referencedConfigurationIds.has(entry.id)),
    )
    .sort(compareByTimeAndId((entry) => entry.capturedAt));
  const configurationRevisions = preserveReferencedThenNewest(
    configurationCandidates,
    referencedConfigurationIds,
    SKILL_INCIDENT_MAX_CONFIGURATION_REVISIONS,
  );
  appendDroppedOmission({
    omissions,
    kind: "configuration",
    reason: "metadata-budget",
    candidates: configurationCandidates,
    retained: configurationRevisions,
    occurredAt: now,
  });

  const referencedMedia = archive.media.filter(
    (entry) =>
      entry.capturedAt <= now &&
      (frameIds.has(entry.frameId) ||
        Boolean(entry.observationId && observationIds.has(entry.observationId))),
  );
  const expiredMedia = referencedMedia.filter(
    (entry) => entry.capturedAt < cutoff,
  );
  if (expiredMedia.length > 0) {
    omissions.push(
      createOmission({
        kind: "media",
        reason: "outside-retention",
        subjectIds: expiredMedia.map((entry) => entry.id).slice(0, 24),
        count: expiredMedia.length,
        occurredAt: now,
      }),
    );
  }
  const mediaResult = enforceSkillIncidentMediaBudget({
    media: referencedMedia.filter((entry) => entry.capturedAt >= cutoff),
    now,
  });
  omissions.push(...mediaResult.omissions);
  const normalizeMediaIds = (ids: string[]) =>
    unique(ids.map((id) => mediaResult.aliases.get(id) ?? id));

  let result: SkillIncidentEvidenceArchive = {
    ...archive,
    updatedAt: now,
    currentEpochIds: Object.fromEntries(
      Object.entries(archive.currentEpochIds).filter(([, id]) => epochIds.has(id)),
    ),
    epochs: eligibleEpochs.sort(compareByTimeAndId((entry) => entry.createdAt)),
    frames: normalizedFrames
      .map((entry) => ({ ...entry, mediaIds: normalizeMediaIds(entry.mediaIds) }))
      .sort(compareByTimeAndId((entry) => entry.sampledAt)),
    observations: eventSelection.observations
      .map((entry) => ({ ...entry, mediaIds: normalizeMediaIds(entry.mediaIds) }))
      .sort(compareByTimeAndId((entry) => entry.sampledAt)),
    cycles: normalizedCycles.sort(
      compareByTimeAndId((entry) => entry.lastEventAt),
    ),
    decisions: normalizedDecisions.sort(
      compareByTimeAndId((entry) => entry.occurredAt),
    ),
    arbitrations: normalizedArbitrations.sort(
      compareByTimeAndId((entry) => entry.occurredAt),
    ),
    attempts,
    lifecycleEvents: eventSelection.lifecycleEvents.sort(
      compareByTimeAndId((entry) => entry.occurredAt),
    ),
    configurationRevisions,
    media: mediaResult.media,
    omissions: [],
  };

  const metadataResult = enforceMetadataBudget(result, now);
  result = metadataResult.archive;
  omissions.push(...metadataResult.omissions);
  result.omissions = uniqueById(omissions)
    .sort(compareByTimeAndId((entry) => entry.occurredAt))
    .slice(-SKILL_INCIDENT_MAX_OMISSIONS);
  return result;
}

export function freezeSkillIncidentEvidence({
  archive,
  selectedSkillId,
  frozenAt,
  leaseId = `skill-report-lease:${selectedSkillId}:${Math.round(frozenAt)}`,
}: {
  archive: SkillIncidentEvidenceArchive;
  selectedSkillId: string;
  frozenAt: number;
  leaseId?: string;
}): FrozenSkillIncidentEvidence {
  const compacted = compactSkillIncidentEvidenceArchive(archive, frozenAt);
  const projected = projectArchiveForSkill(compacted, selectedSkillId);
  return {
    ...cloneArchiveMetadata(projected),
    media: projected.media.map((entry) => ({ ...entry })),
    frozenAt,
    selectedSkillId,
    leaseId,
  };
}

export function enforceSkillIncidentMediaBudget({
  media,
  now,
}: {
  media: SkillIncidentMedia[];
  now: number;
}): SkillIncidentMediaBudgetResult {
  const sorted = [...media].sort(
    (left, right) =>
      getMediaPriority(right) - getMediaPriority(left) ||
      right.capturedAt - left.capturedAt ||
      left.id.localeCompare(right.id),
  );
  const canonicalByContent = new Map<string, SkillIncidentMedia>();
  const aliases = new Map<string, string>();
  for (const entry of sorted) {
    const contentKey = `${entry.mimeType}:${entry.dataUrl}`;
    const canonical = canonicalByContent.get(contentKey);
    if (canonical) {
      aliases.set(entry.id, canonical.id);
    } else {
      canonicalByContent.set(contentKey, entry);
      aliases.set(entry.id, entry.id);
    }
  }

  const retained: SkillIncidentMedia[] = [];
  const oversized: string[] = [];
  const exhausted: string[] = [];
  let retainedChars = 0;
  const deduplicated = [...canonicalByContent.values()].sort(
    (left, right) =>
      getMediaPriority(right) - getMediaPriority(left) ||
      right.capturedAt - left.capturedAt ||
      left.id.localeCompare(right.id),
  );
  for (const entry of deduplicated) {
    if (entry.dataUrl.length > SKILL_INCIDENT_MEDIA_MAX_ENTRY_CHARS) {
      oversized.push(entry.id);
      continue;
    }
    if (
      retained.length >= SKILL_INCIDENT_MEDIA_MAX_ENTRIES ||
      retainedChars + entry.dataUrl.length > SKILL_INCIDENT_MEDIA_MAX_TOTAL_CHARS
    ) {
      exhausted.push(entry.id);
      continue;
    }
    retained.push(entry);
    retainedChars += entry.dataUrl.length;
  }

  return {
    media: retained.sort(
      compareByTimeAndId((entry) => entry.capturedAt),
    ),
    aliases,
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
              reason: "media-budget",
              subjectIds: exhausted,
              count: exhausted.length,
              occurredAt: now,
            }),
          ]
        : []),
    ],
    retainedChars,
    deduplicatedCount: media.length - deduplicated.length,
  };
}

export function getSkillIncidentProjectedMetadataChars(
  archive: SkillIncidentEvidenceArchive,
): number {
  return JSON.stringify({
    ...archive,
    media: archive.media.map(({ dataUrl: _dataUrl, ...entry }) => entry),
  }).length;
}

function selectCycles(cycles: SkillIncidentCycle[]): SkillIncidentCycle[] {
  return [...cycles]
    .sort(
      (left, right) =>
        Number(right.status !== "terminal") -
          Number(left.status !== "terminal") ||
        right.lastEventAt - left.lastEventAt ||
        left.id.localeCompare(right.id),
    )
    .slice(0, SKILL_INCIDENT_MAX_CYCLES)
    .sort(compareByTimeAndId((entry) => entry.lastEventAt));
}

function capOrdinaryFramesPerSkill(
  frames: SkillIncidentFrame[],
): { frames: SkillIncidentFrame[]; dropped: SkillIncidentFrame[] } {
  const required = frames.filter((entry) => !isOrdinaryFrame(entry));
  const ordinaryBySkill = new Map<string, SkillIncidentFrame[]>();
  for (const frame of frames.filter(isOrdinaryFrame)) {
    const entries = ordinaryBySkill.get(frame.skillId) ?? [];
    entries.push(frame);
    ordinaryBySkill.set(frame.skillId, entries);
  }
  const ordinary = [...ordinaryBySkill.values()].flatMap((entries) =>
    entries
      .sort(compareByTimeAndId((entry) => entry.sampledAt))
      .slice(-SKILL_INCIDENT_MAX_ORDINARY_FRAMES_PER_SKILL),
  );
  const retained = uniqueById([...required, ...ordinary]);
  const retainedIds = new Set(retained.map((entry) => entry.id));
  return {
    frames: retained,
    dropped: frames.filter((entry) => !retainedIds.has(entry.id)),
  };
}

function isOrdinaryFrame(frame: SkillIncidentFrame): boolean {
  return (
    !frame.runtimeFailure &&
    (frame.reasons.length === 0 ||
      frame.reasons.every((reason) =>
        ["periodic", "no-change", "sample"].includes(reason),
      ))
  );
}

function selectAggregateEvents({
  frames,
  observations,
  decisions,
  arbitrations,
  lifecycleEvents,
  requiredObservationIds,
}: {
  frames: SkillIncidentFrame[];
  observations: SkillIncidentObservation[];
  decisions: SkillIncidentAlertDecision[];
  arbitrations: SkillIncidentTargetArbitration[];
  lifecycleEvents: SkillIncidentLifecycleEvent[];
  requiredObservationIds: Set<string>;
}) {
  type Unit = {
    id: string;
    time: number;
    priority: number;
    count: number;
    frame?: SkillIncidentFrame;
    observations?: SkillIncidentObservation[];
    decision?: SkillIncidentAlertDecision;
    arbitration?: SkillIncidentTargetArbitration;
    event?: SkillIncidentLifecycleEvent;
  };
  const observationsByFrame = new Map<string, SkillIncidentObservation[]>();
  for (const observation of observations) {
    const entries = observationsByFrame.get(observation.frameId) ?? [];
    entries.push(observation);
    observationsByFrame.set(observation.frameId, entries);
  }
  const units: Unit[] = [
    ...frames.map((frame) => {
      const frameObservations = observationsByFrame.get(frame.id) ?? [];
      return {
        id: `frame-unit:${frame.id}`,
        time: frame.sampledAt,
        priority: Math.max(
          getFramePriority(frame),
          ...frameObservations.map((entry) =>
            getObservationPriority(entry, requiredObservationIds),
          ),
        ),
        count: 1 + frameObservations.length,
        frame,
        observations: frameObservations,
      };
    }),
    ...decisions.map((decision) => ({
      id: `decision-unit:${decision.id}`,
      time: decision.occurredAt,
      priority: 110,
      count: 1,
      decision,
    })),
    ...arbitrations.map((arbitration) => ({
      id: `arbitration-unit:${arbitration.id}`,
      time: arbitration.occurredAt,
      priority: 115,
      count: 1,
      arbitration,
    })),
    ...lifecycleEvents.map((event) => ({
      id: `event-unit:${event.id}`,
      time: event.occurredAt,
      priority:
        event.category === "runtime-error"
          ? 105
          : event.category === "lifecycle"
            ? 75
            : 55,
      count: 1,
      event,
    })),
  ];
  units.sort(
    (left, right) =>
      right.priority - left.priority ||
      right.time - left.time ||
      left.id.localeCompare(right.id),
  );
  const retained: Unit[] = [];
  let retainedCount = 0;
  for (const unit of units) {
    if (retainedCount + unit.count > SKILL_INCIDENT_MAX_EVENTS) {
      continue;
    }
    retained.push(unit);
    retainedCount += unit.count;
  }
  const omitted = units.filter((entry) => !retained.includes(entry));
  return {
    frames: retained.flatMap((entry) => (entry.frame ? [entry.frame] : [])),
    observations: retained.flatMap((entry) => entry.observations ?? []),
    decisions: retained.flatMap((entry) =>
      entry.decision ? [entry.decision] : [],
    ),
    arbitrations: retained.flatMap((entry) =>
      entry.arbitration ? [entry.arbitration] : [],
    ),
    lifecycleEvents: retained.flatMap((entry) =>
      entry.event ? [entry.event] : [],
    ),
    omissions: omitted.length
      ? [
          createOmission({
            kind: "event",
            reason: "metadata-budget",
            subjectIds: omitted.map((entry) => entry.id).slice(0, 24),
            count: omitted.reduce((total, entry) => total + entry.count, 0),
            occurredAt: Math.max(...units.map((entry) => entry.time), 0),
          }),
        ]
      : [],
  };
}

function getFramePriority(frame: SkillIncidentFrame): number {
  if (frame.runtimeFailure || frame.source === "runtime-error") {
    return 105;
  }
  if (!isOrdinaryFrame(frame)) {
    return 80;
  }
  return 10;
}

function getObservationPriority(
  observation: SkillIncidentObservation,
  requiredObservationIds: Set<string>,
): number {
  if (requiredObservationIds.has(observation.id)) {
    return 120;
  }
  if (observation.runtimeFailure || observation.recognitionDecision === "error") {
    return 105;
  }
  if (
    observation.recognitionDecision !== "accepted" ||
    observation.value.decision !== "accepted"
  ) {
    return 90;
  }
  return 45;
}

function getMediaPriority(entry: SkillIncidentMedia): number {
  switch (entry.reason) {
    case "playback-failed":
      return 120;
    case "alert-decision":
      return 115;
    case "threshold":
      return 110;
    case "runtime-error":
      return 105;
    case "value-rejected":
      return 100;
    case "value-change":
      return 90;
    case "status-change":
      return 80;
    case "anchor":
      return 70;
    case "current":
      return 40;
    case "periodic":
      return 10;
  }
}

function enforceMetadataBudget(
  initial: SkillIncidentEvidenceArchive,
  now: number,
): {
  archive: SkillIncidentEvidenceArchive;
  omissions: SkillIncidentEvidenceOmission[];
} {
  let archive = initial;
  const dropped: string[] = [];
  while (
    getSkillIncidentProjectedMetadataChars(archive) >
    SKILL_INCIDENT_METADATA_MAX_CHARS - 4_096
  ) {
    const oldestEvent = [...archive.lifecycleEvents].sort(
      compareByTimeAndId((entry) => entry.occurredAt),
    )[0];
    if (oldestEvent) {
      archive = {
        ...archive,
        lifecycleEvents: archive.lifecycleEvents.filter(
          (entry) => entry.id !== oldestEvent.id,
        ),
      };
      dropped.push(oldestEvent.id);
      continue;
    }

    const anchoredObservationIds = new Set(
      archive.cycles.flatMap((entry) => entry.anchorObservationIds),
    );
    const removableFrame = [...archive.frames]
      .filter(
        (frame) =>
          isOrdinaryFrame(frame) &&
          !frame.observationIds.some((id) => anchoredObservationIds.has(id)),
      )
      .sort(compareByTimeAndId((entry) => entry.sampledAt))[0];
    if (removableFrame) {
      const removedObservationIds = new Set(removableFrame.observationIds);
      archive = {
        ...archive,
        frames: archive.frames.filter((entry) => entry.id !== removableFrame.id),
        observations: archive.observations.filter(
          (entry) => entry.frameId !== removableFrame.id,
        ),
        cycles: archive.cycles.map((entry) => ({
          ...entry,
          observationIds: entry.observationIds.filter(
            (id) => !removedObservationIds.has(id),
          ),
          anchorObservationIds: entry.anchorObservationIds.filter(
            (id) => !removedObservationIds.has(id),
          ),
        })),
        decisions: archive.decisions.map((entry) => ({
          ...entry,
          frameId:
            entry.frameId === removableFrame.id ? null : entry.frameId,
          observationId:
            entry.observationId && removedObservationIds.has(entry.observationId)
              ? null
              : entry.observationId,
        })),
        media: archive.media.filter(
          (entry) =>
            entry.frameId !== removableFrame.id &&
            (!entry.observationId || !removedObservationIds.has(entry.observationId)),
        ),
      };
      dropped.push(removableFrame.id, ...removedObservationIds);
      continue;
    }

    const unreferencedConfiguration = [...archive.configurationRevisions]
      .filter(
        (entry) =>
          !archive.frames.some((frame) => frame.configRevisionId === entry.id) &&
          !archive.cycles.some((cycle) =>
            cycle.configRevisionIds.includes(entry.id),
          ) &&
          !archive.decisions.some(
            (decision) => decision.configRevisionId === entry.id,
          ),
      )
      .sort(compareByTimeAndId((entry) => entry.capturedAt))[0];
    if (unreferencedConfiguration) {
      archive = {
        ...archive,
        configurationRevisions: archive.configurationRevisions.filter(
          (entry) => entry.id !== unreferencedConfiguration.id,
        ),
      };
      dropped.push(unreferencedConfiguration.id);
      continue;
    }
    break;
  }

  return {
    archive,
    omissions: dropped.length
      ? [
          createOmission({
            kind: "event",
            reason: "payload-compacted",
            subjectIds: dropped.slice(0, 24),
            count: dropped.length,
            occurredAt: now,
          }),
        ]
      : [],
  };
}

function projectArchiveForSkill(
  archive: SkillIncidentEvidenceArchive,
  selectedSkillId: string,
): SkillIncidentEvidenceArchive {
  const frames = archive.frames.filter(
    (entry) => entry.skillId === selectedSkillId,
  );
  const frameIds = new Set(frames.map((entry) => entry.id));
  const referencedObservationIds = new Set(
    frames.flatMap((entry) => entry.observationIds),
  );
  const observations = archive.observations.filter(
    (entry) =>
      entry.skillIds.includes(selectedSkillId) &&
      (frameIds.has(entry.frameId) || referencedObservationIds.has(entry.id)),
  );
  const observationIds = new Set(observations.map((entry) => entry.id));
  const cycles = archive.cycles.filter(
    (entry) => entry.skillId === selectedSkillId,
  );
  const cycleIds = new Set(cycles.map((entry) => entry.id));
  const decisions = archive.decisions.filter(
    (entry) => entry.skillId === selectedSkillId && cycleIds.has(entry.cycleId),
  );
  const decisionIds = new Set(decisions.map((entry) => entry.id));
  const arbitrations = archive.arbitrations.filter(
    (entry) =>
      entry.dueSkillIds.includes(selectedSkillId) ||
      entry.winnerSkillId === selectedSkillId ||
      entry.suppressedSkillIds.includes(selectedSkillId) ||
      entry.decisionIds.some((id) => decisionIds.has(id)),
  );
  const arbitrationIds = new Set(arbitrations.map((entry) => entry.id));
  const attempts = archive.attempts.filter(
    (entry) =>
      entry.skillId === selectedSkillId &&
      cycleIds.has(entry.cycleId) &&
      decisionIds.has(entry.decisionId),
  );
  const attemptIds = new Set(attempts.map((entry) => entry.id));
  const lifecycleEvents = archive.lifecycleEvents.filter(
    (entry) => entry.skillId === null || entry.skillId === selectedSkillId,
  );
  const lifecycleConfigIds = lifecycleEvents.flatMap((entry) =>
    entry.configRevisionId ? [entry.configRevisionId] : [],
  );
  const configurationIds = new Set([
    ...frames.map((entry) => entry.configRevisionId),
    ...cycles.flatMap((entry) => entry.configRevisionIds),
    ...decisions.map((entry) => entry.configRevisionId),
    ...lifecycleConfigIds,
  ]);
  const mediaIds = new Set([
    ...frames.flatMap((entry) => entry.mediaIds),
    ...observations.flatMap((entry) => entry.mediaIds),
  ]);
  const epochs = archive.epochs.filter(
    (entry) => entry.skillId === selectedSkillId,
  );
  const epochIds = new Set(epochs.map((entry) => entry.id));

  return {
    ...archive,
    currentEpochIds: Object.fromEntries(
      Object.entries(archive.currentEpochIds).filter(
        ([skillId, epochId]) =>
          skillId === selectedSkillId && epochIds.has(epochId),
      ),
    ),
    epochs,
    frames: frames.map((entry) => ({
      ...entry,
      observationIds: entry.observationIds.filter((id) =>
        observationIds.has(id),
      ),
      mediaIds: entry.mediaIds.filter((id) => mediaIds.has(id)),
    })),
    observations: observations.map((entry) => ({
      ...entry,
      mediaIds: entry.mediaIds.filter((id) => mediaIds.has(id)),
    })),
    cycles: cycles.map((entry) => ({
      ...entry,
      observationIds: entry.observationIds.filter((id) =>
        observationIds.has(id),
      ),
      anchorObservationIds: entry.anchorObservationIds.filter((id) =>
        observationIds.has(id),
      ),
      decisionIds: entry.decisionIds.filter((id) => decisionIds.has(id)),
    })),
    decisions: decisions.map((entry) => ({
      ...entry,
      arbitrationId:
        entry.arbitrationId && arbitrationIds.has(entry.arbitrationId)
          ? entry.arbitrationId
          : null,
      attemptId:
        entry.attemptId && attemptIds.has(entry.attemptId)
          ? entry.attemptId
          : null,
    })),
    arbitrations,
    attempts,
    lifecycleEvents,
    configurationRevisions: archive.configurationRevisions.filter(
      (entry) =>
        entry.skillId === selectedSkillId && configurationIds.has(entry.id),
    ),
    media: archive.media.filter((entry) => mediaIds.has(entry.id)),
  };
}

function preserveReferencedThenNewest<T extends { id: string }>(
  entries: T[],
  referencedIds: Set<string>,
  limit: number,
): T[] {
  const referenced = entries.filter((entry) => referencedIds.has(entry.id));
  const selected = new Map(referenced.map((entry) => [entry.id, entry]));
  for (const entry of [...entries].reverse()) {
    if (selected.size >= limit) {
      break;
    }
    selected.set(entry.id, entry);
  }
  return [...selected.values()].slice(-limit);
}

function appendDroppedOmission<T extends { id: string }>({
  omissions,
  kind,
  reason,
  candidates,
  retained,
  occurredAt,
}: {
  omissions: SkillIncidentEvidenceOmission[];
  kind: SkillIncidentEvidenceOmission["kind"];
  reason: SkillIncidentEvidenceOmissionReason;
  candidates: T[];
  retained: T[];
  occurredAt: number;
}) {
  const retainedIds = new Set(retained.map((entry) => entry.id));
  const dropped = candidates.filter((entry) => !retainedIds.has(entry.id));
  if (dropped.length === 0) {
    return;
  }
  omissions.push(
    createOmission({
      kind,
      reason,
      subjectIds: dropped.map((entry) => entry.id).slice(0, 24),
      count: dropped.length,
      occurredAt,
    }),
  );
}

function createOmission({
  kind,
  reason,
  subjectIds,
  count,
  occurredAt,
}: Omit<SkillIncidentEvidenceOmission, "id">): SkillIncidentEvidenceOmission {
  const token = hash(`${kind}|${reason}|${count}|${subjectIds.join("|")}`);
  return {
    id: `skill-omission:${reason}:${kind}:${Math.round(occurredAt)}:${token}`,
    occurredAt,
    kind,
    reason,
    subjectIds,
    count,
  };
}

function mergeById<T extends { id: string }>(
  previous: T[],
  incoming: T[] | undefined,
): T[] {
  const merged = new Map(previous.map((entry) => [entry.id, entry]));
  for (const entry of incoming ?? []) {
    merged.set(entry.id, entry);
  }
  return [...merged.values()];
}

function mergeMedia(
  previous: SkillIncidentMedia[],
  incoming: SkillIncidentMedia[] | undefined,
): SkillIncidentMedia[] {
  const merged = new Map(previous.map((entry) => [entry.id, entry]));
  for (const entry of incoming ?? []) {
    const current = merged.get(entry.id);
    if (!current || getMediaPriority(entry) >= getMediaPriority(current)) {
      merged.set(entry.id, entry);
    }
  }
  return [...merged.values()];
}

function cloneArchiveMetadata(
  archive: SkillIncidentEvidenceArchive,
): SkillIncidentEvidenceArchive {
  return {
    ...archive,
    currentEpochIds: { ...archive.currentEpochIds },
    epochs: archive.epochs.map((entry) => ({ ...entry })),
    frames: archive.frames.map((entry) => ({
      ...entry,
      observationIds: [...entry.observationIds],
      stateBefore: { ...entry.stateBefore },
      stateAfter: { ...entry.stateAfter },
      runtimeFailure: entry.runtimeFailure
        ? { ...entry.runtimeFailure }
        : null,
      mediaIds: [...entry.mediaIds],
      reasons: [...entry.reasons],
    })),
    observations: archive.observations.map((entry) => ({
      ...entry,
      skillIds: [...entry.skillIds],
      parser: entry.parser ? { ...entry.parser } : null,
      matcher: entry.matcher ? { ...entry.matcher } : null,
      value: { ...entry.value },
      flow: entry.flow ? { ...entry.flow } : null,
      runtimeFailure: entry.runtimeFailure
        ? { ...entry.runtimeFailure }
        : null,
      mediaIds: [...entry.mediaIds],
    })),
    cycles: archive.cycles.map((entry) => ({
      ...entry,
      anchorObservationIds: [...entry.anchorObservationIds],
      observationIds: [...entry.observationIds],
      decisionIds: [...entry.decisionIds],
      configRevisionIds: [...entry.configRevisionIds],
    })),
    decisions: archive.decisions.map((entry) => ({ ...entry })),
    arbitrations: archive.arbitrations.map((entry) => ({
      ...entry,
      dueSkillIds: [...entry.dueSkillIds],
      suppressedSkillIds: [...entry.suppressedSkillIds],
      decisionIds: [...entry.decisionIds],
    })),
    attempts: archive.attempts.map((entry) => ({ ...entry })),
    lifecycleEvents: archive.lifecycleEvents.map((entry) => ({
      ...entry,
      details: { ...entry.details },
    })),
    configurationRevisions: archive.configurationRevisions.map((entry) => ({
      ...entry,
      values: { ...entry.values },
    })),
    media: [],
    omissions: archive.omissions.map((entry) => ({
      ...entry,
      subjectIds: [...entry.subjectIds],
    })),
  };
}

function uniqueById<T extends { id: string }>(entries: T[]): T[] {
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()];
}

function unique(entries: string[]): string[] {
  return [...new Set(entries)];
}

function compareByTimeAndId<T extends { id?: string }>(
  getTime: (entry: T) => number,
) {
  return (left: T, right: T) =>
    getTime(left) - getTime(right) ||
    (left.id ?? "").localeCompare(right.id ?? "");
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}
