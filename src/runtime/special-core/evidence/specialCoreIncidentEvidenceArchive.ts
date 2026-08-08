import {
  SPECIAL_CORE_INCIDENT_EVIDENCE_SCHEMA_VERSION,
  type FrozenSpecialCoreIncidentEvidence,
  type SpecialCoreIncidentActivation,
  type SpecialCoreIncidentAlertDecision,
  type SpecialCoreIncidentBoundaryState,
  type SpecialCoreIncidentConfigurationRevision,
  type SpecialCoreIncidentConfirmationAttempt,
  type SpecialCoreIncidentEvidenceArchive,
  type SpecialCoreIncidentEvidenceOmission,
  type SpecialCoreIncidentEvidenceOmissionReason,
  type SpecialCoreIncidentEvidencePointers,
  type SpecialCoreIncidentFrame,
  type SpecialCoreIncidentFrozenState,
  type SpecialCoreIncidentLifecycleEvent,
  type SpecialCoreIncidentMediaFrame,
  type SpecialCoreIncidentMediaReason,
  type SpecialCoreIncidentObservation,
  type SpecialCoreIncidentPlaybackAttempt,
  type SpecialCoreIncidentRelatedPlayback,
  type SpecialCoreIncidentReportLease,
  type SpecialCoreIncidentResetEpoch,
  type SpecialCoreIncidentSchedule,
} from "./specialCoreIncidentEvidenceTypes";

export const SPECIAL_CORE_INCIDENT_RETENTION_MS = 60_000;
export const SPECIAL_CORE_INCIDENT_CURRENT_WINDOW_MS = 10_000;
export const SPECIAL_CORE_INCIDENT_MAX_RESET_EPOCHS = 8;
export const SPECIAL_CORE_INCIDENT_MAX_CONFIGURATION_REVISIONS = 32;
export const SPECIAL_CORE_INCIDENT_MAX_FRAMES = 72;
export const SPECIAL_CORE_INCIDENT_MAX_OBSERVATIONS = 72;
export const SPECIAL_CORE_INCIDENT_MAX_CONFIRMATION_ATTEMPTS = 32;
export const SPECIAL_CORE_INCIDENT_MAX_ACTIVATIONS = 16;
export const SPECIAL_CORE_INCIDENT_MAX_SCHEDULES = 32;
export const SPECIAL_CORE_INCIDENT_MAX_DECISIONS = 16;
export const SPECIAL_CORE_INCIDENT_MAX_PLAYBACK_ATTEMPTS = 16;
export const SPECIAL_CORE_INCIDENT_MAX_LIFECYCLE_EVENTS = 128;
export const SPECIAL_CORE_INCIDENT_MAX_OMISSIONS = 64;
export const SPECIAL_CORE_INCIDENT_MAX_RELATED_PLAYBACK = 16;
export const SPECIAL_CORE_INCIDENT_EVENT_DETAILS_MAX_CHARS = 256;
export const SPECIAL_CORE_INCIDENT_METADATA_MAX_CHARS = 192 * 1024;
export const SPECIAL_CORE_INCIDENT_MEDIA_MAX_FRAMES = 6;
export const SPECIAL_CORE_INCIDENT_MEDIA_MAX_FRAME_CHARS = 900_000;
export const SPECIAL_CORE_INCIDENT_MEDIA_MAX_TOTAL_CHARS = 1_650_000;
export const SPECIAL_CORE_INCIDENT_REPORT_REQUEST_TARGET_BYTES = 2 * 1024 * 1024;

export type SpecialCoreIncidentEvidenceSupport =
  | "current"
  | "recent"
  | "unsupported";

export type SpecialCoreIncidentEvidencePatch = {
  boundaryState?: SpecialCoreIncidentBoundaryState;
  pointers?: Partial<SpecialCoreIncidentEvidencePointers>;
  resetEpochs?: SpecialCoreIncidentResetEpoch[];
  configurationRevisions?: SpecialCoreIncidentConfigurationRevision[];
  frames?: SpecialCoreIncidentFrame[];
  observations?: SpecialCoreIncidentObservation[];
  confirmationAttempts?: SpecialCoreIncidentConfirmationAttempt[];
  activations?: SpecialCoreIncidentActivation[];
  schedules?: SpecialCoreIncidentSchedule[];
  decisions?: SpecialCoreIncidentAlertDecision[];
  playbackAttempts?: SpecialCoreIncidentPlaybackAttempt[];
  lifecycleEvents?: SpecialCoreIncidentLifecycleEvent[];
  media?: SpecialCoreIncidentMediaFrame[];
  omissions?: SpecialCoreIncidentEvidenceOmission[];
};

export type SpecialCoreIncidentEvidenceProtection = {
  resetEpochIds?: string[];
  configurationRevisionIds?: string[];
  frameIds?: string[];
  observationIds?: string[];
  confirmationAttemptIds?: string[];
  activationIds?: string[];
  scheduleIds?: string[];
  decisionIds?: string[];
  playbackAttemptIds?: string[];
  eventIds?: string[];
  mediaFrameIds?: string[];
};

type Selection<T> = {
  retained: T[];
  outsideRetention: T[];
  overCap: T[];
};

type ProtectionSets = {
  resetEpochIds: Set<string>;
  configurationRevisionIds: Set<string>;
  frameIds: Set<string>;
  observationIds: Set<string>;
  confirmationAttemptIds: Set<string>;
  activationIds: Set<string>;
  scheduleIds: Set<string>;
  decisionIds: Set<string>;
  playbackAttemptIds: Set<string>;
  eventIds: Set<string>;
  mediaFrameIds: Set<string>;
};

const EMPTY_POINTERS: SpecialCoreIncidentEvidencePointers = {
  currentResetEpochId: null,
  currentConfigurationRevisionId: null,
  latestFrameId: null,
  latestObservationId: null,
  activeConfirmationAttemptId: null,
  activeActivationId: null,
  activeScheduleId: null,
  activeDecisionId: null,
  activePlaybackAttemptId: null,
};

export function createSpecialCoreIncidentEvidenceArchive(
  now = Date.now(),
): SpecialCoreIncidentEvidenceArchive {
  return {
    schemaVersion: SPECIAL_CORE_INCIDENT_EVIDENCE_SCHEMA_VERSION,
    updatedAt: now,
    pointers: { ...EMPTY_POINTERS },
    resetEpochs: [],
    configurationRevisions: [],
    frames: [],
    observations: [],
    confirmationAttempts: [],
    activations: [],
    schedules: [],
    decisions: [],
    playbackAttempts: [],
    lifecycleEvents: [],
    media: [],
    omissions: [],
  };
}

export function freezeSpecialCoreIncidentEvidence({
  archive,
  lease,
  frozenState = null,
  relatedPlayback = [],
}: {
  archive: SpecialCoreIncidentEvidenceArchive;
  lease: SpecialCoreIncidentReportLease;
  frozenState?: SpecialCoreIncidentFrozenState | null;
  relatedPlayback?: SpecialCoreIncidentRelatedPlayback[];
}): FrozenSpecialCoreIncidentEvidence {
  const scoped = scopeArchiveToLease(archive, lease);
  const protection = createLeaseProtection(scoped, lease);
  const compacted = compactSpecialCoreIncidentEvidenceArchive({
    archive: scoped,
    now: lease.frozenAt,
    protection,
  });
  return cloneEvidence({
    ...compacted,
    frozenAt: lease.frozenAt,
    leaseId: lease.id,
    lease,
    frozenState:
      frozenState &&
      frozenState.capturedAt <= lease.frozenAt &&
      frozenState.resetEpochId === lease.resetEpochId &&
      frozenState.configRevisionId === lease.configRevisionId
        ? frozenState
        : null,
    relatedPlayback: relatedPlayback
      .filter(
        (entry) =>
          entry.requestedAt <= lease.frozenAt &&
          getRelatedPlaybackEventAt(entry) >=
            lease.frozenAt - SPECIAL_CORE_INCIDENT_RETENTION_MS,
      )
      .map((entry) => scopeRelatedPlayback(entry, lease.frozenAt))
      .sort(
        (left, right) =>
          getRelatedPlaybackEventAt(left) -
            getRelatedPlaybackEventAt(right) ||
          left.id.localeCompare(right.id),
      )
      .slice(-SPECIAL_CORE_INCIDENT_MAX_RELATED_PLAYBACK),
  });
}

export function updateSpecialCoreIncidentEvidenceArchive({
  previous,
  patch,
  now,
  protection,
}: {
  previous: SpecialCoreIncidentEvidenceArchive | null | undefined;
  patch: SpecialCoreIncidentEvidencePatch;
  now: number;
  protection?: SpecialCoreIncidentEvidenceProtection;
}): SpecialCoreIncidentEvidenceArchive {
  const base = previous ?? createSpecialCoreIncidentEvidenceArchive(now);
  const boundaryPatch = patch.boundaryState
    ? createBoundaryPatch(patch.boundaryState)
    : null;
  const pointers = {
    ...base.pointers,
    ...(boundaryPatch?.pointers ?? {}),
    ...(patch.pointers ?? {}),
  };

  return compactSpecialCoreIncidentEvidenceArchive({
    archive: {
      ...base,
      updatedAt: now,
      pointers,
      resetEpochs: mergeById(
        base.resetEpochs,
        mergePatch(boundaryPatch?.resetEpochs, patch.resetEpochs),
      ),
      configurationRevisions: mergeById(
        base.configurationRevisions,
        mergePatch(
          boundaryPatch?.configurationRevisions,
          patch.configurationRevisions,
        ),
      ),
      frames: mergeById(
        base.frames,
        mergePatch(boundaryPatch?.frames, patch.frames),
      ),
      observations: mergeById(
        base.observations,
        mergePatch(boundaryPatch?.observations, patch.observations),
      ),
      confirmationAttempts: mergeById(
        base.confirmationAttempts,
        mergePatch(
          boundaryPatch?.confirmationAttempts,
          patch.confirmationAttempts,
        ),
      ),
      activations: mergeById(
        base.activations,
        mergePatch(boundaryPatch?.activations, patch.activations),
      ),
      schedules: mergeById(
        base.schedules,
        mergePatch(boundaryPatch?.schedules, patch.schedules),
      ),
      decisions: mergeById(
        base.decisions,
        mergePatch(boundaryPatch?.decisions, patch.decisions),
      ),
      playbackAttempts: mergeById(
        base.playbackAttempts,
        mergePatch(
          boundaryPatch?.playbackAttempts,
          patch.playbackAttempts,
        ),
      ),
      lifecycleEvents: mergeById(
        base.lifecycleEvents,
        patch.lifecycleEvents,
      ),
      media: mergeMedia(base.media, patch.media),
      omissions: mergeById(base.omissions, patch.omissions),
    },
    now,
    protection,
  });
}

export function compactSpecialCoreIncidentEvidenceArchive({
  archive,
  now,
  protection,
}: {
  archive: SpecialCoreIncidentEvidenceArchive;
  now: number;
  protection?: SpecialCoreIncidentEvidenceProtection;
}): SpecialCoreIncidentEvidenceArchive {
  const normalized = normalizeArchive(archive);
  const cutoff = now - SPECIAL_CORE_INCIDENT_RETENTION_MS;
  const protectedIds = createProtectionSets(protection);
  addPointerProtection(normalized, protectedIds);
  deriveProtectionFromRecords(normalized, protectedIds);
  const omissions = normalized.omissions.filter(
    (entry) => entry.occurredAt >= cutoff && entry.occurredAt <= now,
  );
  appendTruncationOmissions(archive, omissions, now);

  const activationSelection = selectRecords({
    items: normalized.activations,
    now,
    cutoff,
    max: SPECIAL_CORE_INCIDENT_MAX_ACTIVATIONS,
    getTime: (entry) => entry.endedAt ?? entry.lastSeenAt,
    isProtected: (entry) =>
      entry.status === "active" || protectedIds.activationIds.has(entry.id),
  });
  appendSelectionOmissions(
    omissions,
    "activation",
    activationSelection,
    now,
  );
  const activations = activationSelection.retained;
  for (const activation of activations) {
    protectedIds.confirmationAttemptIds.add(activation.confirmationAttemptId);
    activation.observationIds.forEach((id) =>
      protectedIds.observationIds.add(id),
    );
    protectedIds.configurationRevisionIds.add(
      activation.timingConfigRevisionId,
    );
  }

  const retainedActivationIds = new Set(
    activations.map((entry) => entry.id),
  );
  const scheduleSelection = selectRecords({
    items: normalized.schedules.filter((entry) =>
      retainedActivationIds.has(entry.activationId),
    ),
    now,
    cutoff,
    max: SPECIAL_CORE_INCIDENT_MAX_SCHEDULES,
    getTime: (entry) => entry.endedAt ?? entry.registeredAt,
    isProtected: (entry) =>
      entry.status === "registered" || protectedIds.scheduleIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "schedule", scheduleSelection, now);
  const schedules = scheduleSelection.retained;
  const retainedScheduleIds = new Set(schedules.map((entry) => entry.id));
  for (const schedule of schedules) {
    protectedIds.configurationRevisionIds.add(
      schedule.timingConfigRevisionId,
    );
  }

  const decisionSelection = selectRecords({
    items: normalized.decisions.filter(
      (entry) =>
        retainedActivationIds.has(entry.activationId) &&
        retainedScheduleIds.has(entry.scheduleId),
    ),
    now,
    cutoff,
    max: SPECIAL_CORE_INCIDENT_MAX_DECISIONS,
    getTime: (entry) => entry.occurredAt,
    isProtected: (entry) => protectedIds.decisionIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "decision", decisionSelection, now);
  const decisions = decisionSelection.retained;
  const retainedDecisionIds = new Set(decisions.map((entry) => entry.id));
  for (const decision of decisions) {
    protectedIds.configurationRevisionIds.add(
      decision.timingConfigRevisionId,
    );
    protectedIds.configurationRevisionIds.add(decision.firedConfigRevisionId);
  }

  const playbackSelection = selectRecords({
    items: normalized.playbackAttempts.filter(
      (entry) =>
        retainedActivationIds.has(entry.activationId) &&
        retainedScheduleIds.has(entry.scheduleId) &&
        retainedDecisionIds.has(entry.decisionId),
    ),
    now,
    cutoff,
    max: SPECIAL_CORE_INCIDENT_MAX_PLAYBACK_ATTEMPTS,
    getTime: getPlaybackEventAt,
    isProtected: (entry) =>
      entry.status === "requested" ||
      entry.status === "browser-play-accepted" ||
      protectedIds.playbackAttemptIds.has(entry.id),
  });
  appendSelectionOmissions(
    omissions,
    "playback-attempt",
    playbackSelection,
    now,
  );
  const playbackAttempts = playbackSelection.retained;
  for (const attempt of playbackAttempts) {
    protectedIds.configurationRevisionIds.add(attempt.configRevisionId);
  }

  const confirmationSelection = selectRecords({
    items: normalized.confirmationAttempts,
    now,
    cutoff,
    max: SPECIAL_CORE_INCIDENT_MAX_CONFIRMATION_ATTEMPTS,
    getTime: (entry) => entry.endedAt ?? entry.lastObservedAt,
    isProtected: (entry) =>
      entry.status === "collecting" ||
      protectedIds.confirmationAttemptIds.has(entry.id),
  });
  appendSelectionOmissions(
    omissions,
    "confirmation-attempt",
    confirmationSelection,
    now,
  );
  const confirmationAttempts = confirmationSelection.retained;
  for (const attempt of confirmationAttempts) {
    attempt.observationIds.forEach((id) =>
      protectedIds.observationIds.add(id),
    );
  }

  for (const observation of normalized.observations) {
    if (!protectedIds.observationIds.has(observation.id)) continue;
    protectedIds.frameIds.add(observation.frameId);
    protectedIds.configurationRevisionIds.add(observation.configRevisionId);
  }
  const frameSelection = selectRecords({
    items: normalized.frames,
    now,
    cutoff,
    max: SPECIAL_CORE_INCIDENT_MAX_FRAMES,
    getTime: (entry) => entry.sampledAt,
    isProtected: (entry) => protectedIds.frameIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "frame", frameSelection, now);
  const frames = frameSelection.retained;
  const retainedFrameIds = new Set(frames.map((entry) => entry.id));

  const observationSelection = selectRecords({
    items: normalized.observations.filter((entry) =>
      retainedFrameIds.has(entry.frameId),
    ),
    now,
    cutoff,
    max: SPECIAL_CORE_INCIDENT_MAX_OBSERVATIONS,
    getTime: (entry) => entry.sampledAt,
    isProtected: (entry) => protectedIds.observationIds.has(entry.id),
  });
  appendSelectionOmissions(
    omissions,
    "observation",
    observationSelection,
    now,
  );
  const observations = observationSelection.retained;

  const eventSelection = selectRecords({
    items: normalized.lifecycleEvents,
    now,
    cutoff,
    max: SPECIAL_CORE_INCIDENT_MAX_LIFECYCLE_EVENTS,
    getTime: (entry) => entry.occurredAt,
    isProtected: (entry) => protectedIds.eventIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "event", eventSelection, now);
  const lifecycleEvents = eventSelection.retained;

  const referencedResetEpochIds = collectReferencedResetEpochIds({
    pointers: normalized.pointers,
    frames,
    observations,
    confirmationAttempts,
    activations,
    schedules,
    decisions,
    playbackAttempts,
    lifecycleEvents,
  });
  protectedIds.resetEpochIds.forEach((id) =>
    referencedResetEpochIds.add(id),
  );
  const resetSelection = selectRecords({
    items: normalized.resetEpochs,
    now,
    cutoff,
    max: SPECIAL_CORE_INCIDENT_MAX_RESET_EPOCHS,
    getTime: (entry) =>
      entry.id === normalized.pointers.currentResetEpochId
        ? now
        : entry.startedAt,
    isProtected: (entry) => referencedResetEpochIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "reset-epoch", resetSelection, now);
  const resetEpochs = resetSelection.retained;
  const retainedResetEpochIds = new Set(resetEpochs.map((entry) => entry.id));

  const referencedConfigurationIds = collectReferencedConfigurationIds({
    pointers: normalized.pointers,
    frames,
    observations,
    activations,
    schedules,
    decisions,
    playbackAttempts,
    lifecycleEvents,
  });
  protectedIds.configurationRevisionIds.forEach((id) =>
    referencedConfigurationIds.add(id),
  );
  const configurationSelection = selectRecords({
    items: normalized.configurationRevisions.filter((entry) =>
      retainedResetEpochIds.has(entry.resetEpochId),
    ),
    now,
    cutoff,
    max: SPECIAL_CORE_INCIDENT_MAX_CONFIGURATION_REVISIONS,
    getTime: (entry) =>
      entry.id === normalized.pointers.currentConfigurationRevisionId
        ? now
        : entry.capturedAt,
    isProtected: (entry) => referencedConfigurationIds.has(entry.id),
  });
  appendSelectionOmissions(
    omissions,
    "configuration",
    configurationSelection,
    now,
  );
  const configurationRevisions = configurationSelection.retained;
  const retainedConfigurationIds = new Set(
    configurationRevisions.map((entry) => entry.id),
  );

  const resetScopedFrames = frames.filter((entry) =>
    retainedResetEpochIds.has(entry.resetEpochId),
  );
  appendDroppedOmission({
    omissions,
    kind: "frame",
    reason: "reset-epoch",
    entries: frames.filter((entry) => !resetScopedFrames.includes(entry)),
    now,
  });
  const scopedFrames = resetScopedFrames.filter((entry) =>
    retainedConfigurationIds.has(entry.configRevisionId),
  );
  appendDroppedOmission({
    omissions,
    kind: "frame",
    reason: "metadata-cap",
    entries: resetScopedFrames.filter(
      (entry) => !scopedFrames.includes(entry),
    ),
    now,
  });
  const scopedFrameIds = new Set(scopedFrames.map((entry) => entry.id));
  const resetScopedObservations = observations.filter((entry) =>
    retainedResetEpochIds.has(entry.resetEpochId),
  );
  appendDroppedOmission({
    omissions,
    kind: "observation",
    reason: "reset-epoch",
    entries: observations.filter(
      (entry) => !resetScopedObservations.includes(entry),
    ),
    now,
  });
  const scopedObservations = resetScopedObservations.filter(
    (entry) =>
      scopedFrameIds.has(entry.frameId) &&
      retainedConfigurationIds.has(entry.configRevisionId),
  );
  const scopedObservationIds = new Set(
    scopedObservations.map((entry) => entry.id),
  );
  const resetScopedConfirmationAttempts = confirmationAttempts.filter(
    (entry) => retainedResetEpochIds.has(entry.resetEpochId),
  );
  appendDroppedOmission({
    omissions,
    kind: "confirmation-attempt",
    reason: "reset-epoch",
    entries: confirmationAttempts.filter(
      (entry) => !resetScopedConfirmationAttempts.includes(entry),
    ),
    now,
  });
  const scopedConfirmationAttempts = resetScopedConfirmationAttempts.filter(
    (entry) =>
      entry.observationIds.every((id) => scopedObservationIds.has(id)),
  );
  const scopedConfirmationIds = new Set(
    scopedConfirmationAttempts.map((entry) => entry.id),
  );
  const resetScopedActivations = activations.filter((entry) =>
    retainedResetEpochIds.has(entry.resetEpochId),
  );
  appendDroppedOmission({
    omissions,
    kind: "activation",
    reason: "reset-epoch",
    entries: activations.filter(
      (entry) => !resetScopedActivations.includes(entry),
    ),
    now,
  });
  const scopedActivations = resetScopedActivations.filter(
    (entry) =>
      scopedConfirmationIds.has(entry.confirmationAttemptId) &&
      entry.observationIds.every((id) => scopedObservationIds.has(id)) &&
      retainedConfigurationIds.has(entry.timingConfigRevisionId),
  );
  const scopedActivationIds = new Set(scopedActivations.map((entry) => entry.id));
  const resetScopedSchedules = schedules.filter((entry) =>
    retainedResetEpochIds.has(entry.resetEpochId),
  );
  appendDroppedOmission({
    omissions,
    kind: "schedule",
    reason: "reset-epoch",
    entries: schedules.filter((entry) => !resetScopedSchedules.includes(entry)),
    now,
  });
  const scopedSchedules = resetScopedSchedules.filter(
    (entry) =>
      scopedActivationIds.has(entry.activationId) &&
      retainedConfigurationIds.has(entry.timingConfigRevisionId),
  );
  const scopedScheduleIds = new Set(scopedSchedules.map((entry) => entry.id));
  const resetScopedDecisions = decisions.filter((entry) =>
    retainedResetEpochIds.has(entry.resetEpochId),
  );
  appendDroppedOmission({
    omissions,
    kind: "decision",
    reason: "reset-epoch",
    entries: decisions.filter((entry) => !resetScopedDecisions.includes(entry)),
    now,
  });
  const scopedDecisions = resetScopedDecisions.filter(
    (entry) =>
      scopedActivationIds.has(entry.activationId) &&
      scopedScheduleIds.has(entry.scheduleId) &&
      retainedConfigurationIds.has(entry.timingConfigRevisionId) &&
      retainedConfigurationIds.has(entry.firedConfigRevisionId),
  );
  const scopedDecisionIds = new Set(scopedDecisions.map((entry) => entry.id));
  const resetScopedPlaybackAttempts = playbackAttempts.filter((entry) =>
    retainedResetEpochIds.has(entry.resetEpochId),
  );
  appendDroppedOmission({
    omissions,
    kind: "playback-attempt",
    reason: "reset-epoch",
    entries: playbackAttempts.filter(
      (entry) => !resetScopedPlaybackAttempts.includes(entry),
    ),
    now,
  });
  const scopedPlaybackAttempts = resetScopedPlaybackAttempts.filter(
    (entry) =>
      scopedActivationIds.has(entry.activationId) &&
      scopedScheduleIds.has(entry.scheduleId) &&
      scopedDecisionIds.has(entry.decisionId) &&
      retainedConfigurationIds.has(entry.configRevisionId),
  );
  const resetScopedLifecycleEvents = lifecycleEvents.filter((entry) =>
    retainedResetEpochIds.has(entry.resetEpochId),
  );
  appendDroppedOmission({
    omissions,
    kind: "event",
    reason: "reset-epoch",
    entries: lifecycleEvents.filter(
      (entry) => !resetScopedLifecycleEvents.includes(entry),
    ),
    now,
  });
  const scopedLifecycleEvents = resetScopedLifecycleEvents.filter(
    (entry) =>
      (entry.configRevisionId === null ||
        retainedConfigurationIds.has(entry.configRevisionId)),
  );

  const requiredFrameIds = new Set(protectedIds.frameIds);
  scopedActivations.forEach((entry) =>
    entry.observationIds.forEach((observationId) => {
      const observation = scopedObservations.find(
        (candidate) => candidate.id === observationId,
      );
      if (observation) requiredFrameIds.add(observation.frameId);
    }),
  );
  const mediaResult = selectMedia({
    media: normalized.media.filter((entry) =>
      scopedFrameIds.has(entry.frameId),
    ),
    now,
    cutoff,
    requiredFrameIds,
    leasedFrameIds: protectedIds.mediaFrameIds,
  });
  omissions.push(...mediaResult.omissions);

  let compacted: SpecialCoreIncidentEvidenceArchive = {
    ...normalized,
    updatedAt: now,
    pointers: normalizePointers(normalized.pointers, {
      resetEpochIds: retainedResetEpochIds,
      configurationRevisionIds: retainedConfigurationIds,
      frameIds: scopedFrameIds,
      observationIds: scopedObservationIds,
      confirmationAttemptIds: scopedConfirmationIds,
      activationIds: scopedActivationIds,
      scheduleIds: scopedScheduleIds,
      decisionIds: scopedDecisionIds,
      playbackAttemptIds: new Set(
        scopedPlaybackAttempts.map((entry) => entry.id),
      ),
    }),
    resetEpochs,
    configurationRevisions,
    frames: scopedFrames,
    observations: scopedObservations,
    confirmationAttempts: scopedConfirmationAttempts,
    activations: scopedActivations,
    schedules: scopedSchedules,
    decisions: scopedDecisions,
    playbackAttempts: scopedPlaybackAttempts,
    lifecycleEvents: scopedLifecycleEvents,
    media: mediaResult.media,
    omissions: compactOmissions(omissions),
  };
  compacted = enforceMetadataBudget(compacted, protectedIds, now);
  compacted = enforceRequestBudget(compacted, protectedIds, now);
  return compacted;
}

export function getSpecialCoreIncidentEvidenceSupport({
  now,
  occurredAt,
}: {
  now: number;
  occurredAt: number;
}): SpecialCoreIncidentEvidenceSupport {
  const age = now - occurredAt;
  if (age < 0 || age > SPECIAL_CORE_INCIDENT_RETENTION_MS) {
    return "unsupported";
  }
  return age <= SPECIAL_CORE_INCIDENT_CURRENT_WINDOW_MS ? "current" : "recent";
}

export function getSpecialCoreIncidentEvidenceMetadataChars(
  archive: SpecialCoreIncidentEvidenceArchive,
): number {
  return JSON.stringify({
    ...archive,
    media: archive.media.map((entry) => ({
      ...entry,
      imageDataUrl: "[media]",
    })),
  }).length;
}

export function getSpecialCoreIncidentEvidenceRequestBytes(
  archive: SpecialCoreIncidentEvidenceArchive,
): number {
  return new TextEncoder().encode(JSON.stringify(archive)).byteLength;
}

function scopeArchiveToLease(
  archive: SpecialCoreIncidentEvidenceArchive,
  lease: SpecialCoreIncidentReportLease,
): SpecialCoreIncidentEvidenceArchive {
  const resetEpochs = archive.resetEpochs.filter(
    (entry) => entry.startedAt <= lease.frozenAt,
  );
  const resetEpochIds = new Set(resetEpochs.map((entry) => entry.id));
  const configurationRevisions = archive.configurationRevisions.filter(
    (entry) =>
      resetEpochIds.has(entry.resetEpochId) &&
      entry.capturedAt <= lease.frozenAt,
  );
  const configurationRevisionIds = new Set(
    configurationRevisions.map((entry) => entry.id),
  );
  const frames = archive.frames.filter(
    (entry) =>
      resetEpochIds.has(entry.resetEpochId) &&
      configurationRevisionIds.has(entry.configRevisionId) &&
      entry.sampledAt <= lease.frozenAt &&
      (entry.resetEpochId !== lease.resetEpochId ||
        entry.sequence <= lease.leasedThroughFrameSequence),
  );
  const frameIds = new Set(frames.map((entry) => entry.id));
  const observations = archive.observations.filter(
    (entry) =>
      frameIds.has(entry.frameId) && entry.sampledAt <= lease.frozenAt,
  );
  const observationIds = new Set(observations.map((entry) => entry.id));
  const confirmationAttempts = archive.confirmationAttempts
    .filter(
      (entry) =>
        resetEpochIds.has(entry.resetEpochId) &&
        entry.startedAt <= lease.frozenAt,
    )
    .map((entry) => scopeConfirmationAttempt(entry, observations, lease.frozenAt))
    .filter((entry) => entry.observationIds.length > 0);
  const confirmationAttemptIds = new Set(
    confirmationAttempts.map((entry) => entry.id),
  );
  const activations = archive.activations
    .filter(
      (entry) =>
        resetEpochIds.has(entry.resetEpochId) &&
        confirmationAttemptIds.has(entry.confirmationAttemptId) &&
        entry.confirmedAt <= lease.frozenAt,
    )
    .map((entry) =>
      entry.endedAt !== null && entry.endedAt > lease.frozenAt
        ? {
            ...entry,
            observationIds: entry.observationIds.filter((id) =>
              observationIds.has(id),
            ),
            status: "active" as const,
            endedAt: null,
            terminalReason: null,
          }
        : {
            ...entry,
            observationIds: entry.observationIds.filter((id) =>
              observationIds.has(id),
            ),
          },
    );
  const activationIds = new Set(activations.map((entry) => entry.id));
  const schedules = archive.schedules
    .filter(
      (entry) =>
        activationIds.has(entry.activationId) &&
        entry.registeredAt <= lease.frozenAt,
    )
    .map((entry) =>
      entry.endedAt !== null && entry.endedAt > lease.frozenAt
        ? {
            ...entry,
            status: "registered" as const,
            endedAt: null,
            outcomeReason: null,
          }
        : entry,
    );
  const scheduleIds = new Set(schedules.map((entry) => entry.id));
  const decisions = archive.decisions.filter(
    (entry) =>
      activationIds.has(entry.activationId) &&
      scheduleIds.has(entry.scheduleId) &&
      entry.occurredAt <= lease.frozenAt,
  );
  const decisionIds = new Set(decisions.map((entry) => entry.id));
  const playbackAttempts = archive.playbackAttempts
    .filter(
      (entry) =>
        activationIds.has(entry.activationId) &&
        scheduleIds.has(entry.scheduleId) &&
        decisionIds.has(entry.decisionId) &&
        entry.requestedAt <= lease.frozenAt,
    )
    .map((entry) => scopePlaybackAttempt(entry, lease.frozenAt));
  const playbackAttemptIds = new Set(
    playbackAttempts.map((entry) => entry.id),
  );
  const lifecycleEvents = archive.lifecycleEvents.filter(
    (entry) =>
      resetEpochIds.has(entry.resetEpochId) &&
      entry.occurredAt <= lease.frozenAt,
  );
  const media = archive.media.filter(
    (entry) => frameIds.has(entry.frameId) && entry.sampledAt <= lease.frozenAt,
  );
  const latestFrame = [...frames]
    .filter((entry) => entry.resetEpochId === lease.resetEpochId)
    .sort(
      (left, right) =>
        left.sequence - right.sequence || left.id.localeCompare(right.id),
    )
    .pop();
  const latestObservation = [...observations]
    .filter((entry) => entry.resetEpochId === lease.resetEpochId)
    .sort(
      (left, right) =>
        left.frameSequence - right.frameSequence ||
        left.id.localeCompare(right.id),
    )
    .pop();

  return {
    ...archive,
    updatedAt: lease.frozenAt,
    pointers: {
      currentResetEpochId: resetEpochIds.has(lease.resetEpochId)
        ? lease.resetEpochId
        : null,
      currentConfigurationRevisionId: configurationRevisionIds.has(
        lease.configRevisionId,
      )
        ? lease.configRevisionId
        : null,
      latestFrameId: latestFrame?.id ?? null,
      latestObservationId: latestObservation?.id ?? null,
      activeConfirmationAttemptId: retainPointer(
        lease.confirmationAttemptId,
        confirmationAttemptIds,
      ),
      activeActivationId: retainPointer(lease.activationId, activationIds),
      activeScheduleId: retainPointer(lease.scheduleId, scheduleIds),
      activeDecisionId: retainPointer(lease.decisionId, decisionIds),
      activePlaybackAttemptId: retainPointer(
        lease.playbackAttemptId,
        playbackAttemptIds,
      ),
    },
    resetEpochs,
    configurationRevisions,
    frames,
    observations,
    confirmationAttempts,
    activations,
    schedules,
    decisions,
    playbackAttempts,
    lifecycleEvents,
    media,
    omissions: archive.omissions.filter(
      (entry) => entry.occurredAt <= lease.frozenAt,
    ),
  };
}

function createLeaseProtection(
  archive: SpecialCoreIncidentEvidenceArchive,
  lease: SpecialCoreIncidentReportLease,
): SpecialCoreIncidentEvidenceProtection {
  const latestFrame = [...archive.frames]
    .filter(
      (entry) =>
        entry.resetEpochId === lease.resetEpochId &&
        entry.sequence <= lease.leasedThroughFrameSequence &&
        entry.sampledAt <= lease.frozenAt,
    )
    .sort(
      (left, right) =>
        left.sequence - right.sequence || left.id.localeCompare(right.id),
    )
    .pop();
  return {
    resetEpochIds: [lease.resetEpochId],
    configurationRevisionIds: [lease.configRevisionId],
    frameIds: latestFrame ? [latestFrame.id] : [],
    observationIds: [],
    confirmationAttemptIds: lease.confirmationAttemptId
      ? [lease.confirmationAttemptId]
      : [],
    activationIds: lease.activationId ? [lease.activationId] : [],
    scheduleIds: lease.scheduleId ? [lease.scheduleId] : [],
    decisionIds: lease.decisionId ? [lease.decisionId] : [],
    playbackAttemptIds: lease.playbackAttemptId
      ? [lease.playbackAttemptId]
      : [],
    mediaFrameIds: latestFrame ? [latestFrame.id] : [],
  };
}

function scopeConfirmationAttempt(
  attempt: SpecialCoreIncidentConfirmationAttempt,
  observations: SpecialCoreIncidentObservation[],
  frozenAt: number,
): SpecialCoreIncidentConfirmationAttempt {
  const eligibleObservationIds = new Set(
    observations
      .filter((entry) => entry.sampledAt <= frozenAt)
      .map((entry) => entry.id),
  );
  const observationIds = attempt.observationIds.filter((id) =>
    eligibleObservationIds.has(id),
  );
  if (attempt.endedAt !== null && attempt.endedAt > frozenAt) {
    return {
      ...attempt,
      lastObservedAt: Math.min(attempt.lastObservedAt, frozenAt),
      observationIds,
      status: "collecting",
      activationId: null,
      endedAt: null,
      terminalReason: null,
    };
  }
  return { ...attempt, observationIds };
}

function scopePlaybackAttempt(
  attempt: SpecialCoreIncidentPlaybackAttempt,
  frozenAt: number,
): SpecialCoreIncidentPlaybackAttempt {
  if (
    attempt.browserAcceptedAt === null ||
    attempt.browserAcceptedAt > frozenAt
  ) {
    return {
      ...attempt,
      browserAcceptedAt: null,
      finishedAt: null,
      failedAt:
        attempt.failedAt !== null && attempt.failedAt <= frozenAt
          ? attempt.failedAt
          : null,
      status:
        attempt.failedAt !== null && attempt.failedAt <= frozenAt
          ? "failed"
          : "requested",
      error:
        attempt.failedAt !== null && attempt.failedAt <= frozenAt
          ? attempt.error
          : null,
    };
  }
  if (attempt.failedAt !== null && attempt.failedAt <= frozenAt) {
    return {
      ...attempt,
      finishedAt: null,
      status: "failed",
    };
  }
  if (attempt.finishedAt !== null && attempt.finishedAt <= frozenAt) {
    return { ...attempt, status: "finished" };
  }
  return {
    ...attempt,
    finishedAt: null,
    failedAt: null,
    status: "browser-play-accepted",
    error: null,
  };
}

function scopeRelatedPlayback(
  playback: SpecialCoreIncidentRelatedPlayback,
  frozenAt: number,
): SpecialCoreIncidentRelatedPlayback {
  if (
    playback.browserAcceptedAt === null ||
    playback.browserAcceptedAt > frozenAt
  ) {
    return {
      ...playback,
      browserAcceptedAt: null,
      finishedAt: null,
      failedAt:
        playback.failedAt !== null && playback.failedAt <= frozenAt
          ? playback.failedAt
          : null,
      status:
        playback.failedAt !== null && playback.failedAt <= frozenAt
          ? "failed"
          : "requested",
    };
  }
  if (playback.failedAt !== null && playback.failedAt <= frozenAt) {
    return { ...playback, finishedAt: null, status: "failed" };
  }
  if (playback.finishedAt !== null && playback.finishedAt <= frozenAt) {
    return { ...playback, status: "finished" };
  }
  return {
    ...playback,
    finishedAt: null,
    failedAt: null,
    status: "browser-play-accepted",
  };
}

function getRelatedPlaybackEventAt(
  entry: SpecialCoreIncidentRelatedPlayback,
): number {
  return (
    entry.finishedAt ??
    entry.failedAt ??
    entry.browserAcceptedAt ??
    entry.requestedAt
  );
}

function createBoundaryPatch(
  state: SpecialCoreIncidentBoundaryState,
): SpecialCoreIncidentEvidencePatch & {
  pointers: SpecialCoreIncidentEvidencePointers;
} {
  const activationId = state.activeActivation?.id ?? null;
  const latestSchedule =
    state.latestSchedule?.activationId === activationId
      ? state.latestSchedule
      : null;
  const latestDecision =
    state.latestDecision?.activationId === activationId
      ? state.latestDecision
      : null;
  const latestPlayback =
    state.latestPlaybackAttempt?.activationId === activationId
      ? state.latestPlaybackAttempt
      : null;
  return {
    pointers: {
      currentResetEpochId: state.resetEpoch.id,
      currentConfigurationRevisionId: state.configurationRevision.id,
      latestFrameId: state.latestFrame?.id ?? null,
      latestObservationId: state.latestObservation?.id ?? null,
      activeConfirmationAttemptId: state.activeConfirmationAttempt?.id ?? null,
      activeActivationId: activationId,
      activeScheduleId: latestSchedule?.id ?? null,
      activeDecisionId: latestDecision?.id ?? null,
      activePlaybackAttemptId: latestPlayback?.id ?? null,
    },
    resetEpochs: [state.resetEpoch],
    configurationRevisions: [state.configurationRevision],
    frames: state.latestFrame ? [state.latestFrame] : [],
    observations: state.latestObservation ? [state.latestObservation] : [],
    confirmationAttempts: state.activeConfirmationAttempt
      ? [state.activeConfirmationAttempt]
      : [],
    activations: state.activeActivation ? [state.activeActivation] : [],
    schedules: [state.activeSchedule, latestSchedule].filter(
      (entry): entry is SpecialCoreIncidentSchedule => entry !== null,
    ),
    decisions: latestDecision ? [latestDecision] : [],
    playbackAttempts: [state.activePlaybackAttempt, latestPlayback].filter(
      (entry): entry is SpecialCoreIncidentPlaybackAttempt => entry !== null,
    ),
  };
}

function normalizeArchive(
  archive: SpecialCoreIncidentEvidenceArchive,
): SpecialCoreIncidentEvidenceArchive {
  return {
    ...archive,
    observations: archive.observations.map((entry) => ({
      ...entry,
      reason: truncateText(entry.reason),
    })),
    schedules: archive.schedules.map((entry) => ({
      ...entry,
      outcomeReason: truncateText(entry.outcomeReason),
    })),
    playbackAttempts: archive.playbackAttempts.map((entry) => ({
      ...entry,
      error: truncateText(entry.error),
    })),
    lifecycleEvents: archive.lifecycleEvents.map((entry) => ({
      ...entry,
      action: truncateText(entry.action, 128) ?? "unknown",
      details:
        JSON.stringify(entry.details).length <=
        SPECIAL_CORE_INCIDENT_EVENT_DETAILS_MAX_CHARS
          ? entry.details
          : {
              omitted: "metadata-cap",
              originalChars: JSON.stringify(entry.details).length,
            },
    })),
  };
}

function addPointerProtection(
  archive: SpecialCoreIncidentEvidenceArchive,
  protection: ProtectionSets,
): void {
  const pointers = archive.pointers;
  addNullable(protection.resetEpochIds, pointers.currentResetEpochId);
  addNullable(
    protection.configurationRevisionIds,
    pointers.currentConfigurationRevisionId,
  );
  addNullable(
    protection.confirmationAttemptIds,
    pointers.activeConfirmationAttemptId,
  );
  addNullable(protection.activationIds, pointers.activeActivationId);
  addNullable(protection.scheduleIds, pointers.activeScheduleId);
  addNullable(protection.decisionIds, pointers.activeDecisionId);
  addNullable(
    protection.playbackAttemptIds,
    pointers.activePlaybackAttemptId,
  );
}

function deriveProtectionFromRecords(
  archive: SpecialCoreIncidentEvidenceArchive,
  protection: ProtectionSets,
): void {
  let changed = true;
  while (changed) {
    const before = getProtectionSize(protection);
    for (const attempt of archive.playbackAttempts) {
      if (
        !protection.playbackAttemptIds.has(attempt.id) &&
        attempt.status !== "requested" &&
        attempt.status !== "browser-play-accepted"
      ) {
        continue;
      }
      protection.activationIds.add(attempt.activationId);
      protection.scheduleIds.add(attempt.scheduleId);
      protection.decisionIds.add(attempt.decisionId);
      protection.configurationRevisionIds.add(attempt.configRevisionId);
      protection.resetEpochIds.add(attempt.resetEpochId);
    }
    for (const decision of archive.decisions) {
      if (!protection.decisionIds.has(decision.id)) continue;
      protection.activationIds.add(decision.activationId);
      protection.scheduleIds.add(decision.scheduleId);
      protection.configurationRevisionIds.add(
        decision.timingConfigRevisionId,
      );
      protection.configurationRevisionIds.add(decision.firedConfigRevisionId);
      protection.resetEpochIds.add(decision.resetEpochId);
    }
    for (const schedule of archive.schedules) {
      if (
        !protection.scheduleIds.has(schedule.id) &&
        schedule.status !== "registered"
      ) {
        continue;
      }
      protection.activationIds.add(schedule.activationId);
      protection.configurationRevisionIds.add(
        schedule.timingConfigRevisionId,
      );
      protection.resetEpochIds.add(schedule.resetEpochId);
    }
    for (const activation of archive.activations) {
      if (
        !protection.activationIds.has(activation.id) &&
        activation.status !== "active"
      ) {
        continue;
      }
      protection.confirmationAttemptIds.add(
        activation.confirmationAttemptId,
      );
      activation.observationIds.forEach((id) =>
        protection.observationIds.add(id),
      );
      protection.configurationRevisionIds.add(
        activation.timingConfigRevisionId,
      );
      protection.resetEpochIds.add(activation.resetEpochId);
    }
    for (const attempt of archive.confirmationAttempts) {
      if (
        !protection.confirmationAttemptIds.has(attempt.id) &&
        attempt.status !== "collecting"
      ) {
        continue;
      }
      attempt.observationIds.forEach((id) =>
        protection.observationIds.add(id),
      );
      protection.resetEpochIds.add(attempt.resetEpochId);
    }
    for (const observation of archive.observations) {
      if (!protection.observationIds.has(observation.id)) continue;
      protection.frameIds.add(observation.frameId);
      protection.configurationRevisionIds.add(observation.configRevisionId);
      protection.resetEpochIds.add(observation.resetEpochId);
    }
    for (const frame of archive.frames) {
      if (!protection.frameIds.has(frame.id)) continue;
      protection.configurationRevisionIds.add(frame.configRevisionId);
      protection.resetEpochIds.add(frame.resetEpochId);
    }
    for (const configuration of archive.configurationRevisions) {
      if (!protection.configurationRevisionIds.has(configuration.id)) continue;
      protection.resetEpochIds.add(configuration.resetEpochId);
    }
    for (const event of archive.lifecycleEvents) {
      if (!protection.eventIds.has(event.id)) continue;
      protection.resetEpochIds.add(event.resetEpochId);
      addNullable(
        protection.configurationRevisionIds,
        event.configRevisionId,
      );
      addNullable(protection.frameIds, event.frameId);
      addNullable(protection.observationIds, event.observationId);
      addNullable(
        protection.confirmationAttemptIds,
        event.confirmationAttemptId,
      );
      addNullable(protection.activationIds, event.activationId);
      addNullable(protection.scheduleIds, event.scheduleId);
      addNullable(protection.decisionIds, event.decisionId);
      addNullable(protection.playbackAttemptIds, event.playbackAttemptId);
    }
    protection.mediaFrameIds.forEach((id) => protection.frameIds.add(id));
    changed = getProtectionSize(protection) !== before;
  }
}

function selectRecords<T extends { id: string }>({
  items,
  now,
  cutoff,
  max,
  getTime,
  isProtected,
}: {
  items: T[];
  now: number;
  cutoff: number;
  max: number;
  getTime: (entry: T) => number;
  isProtected: (entry: T) => boolean;
}): Selection<T> {
  const ordered = [...items]
    .filter((entry) => getTime(entry) <= now)
    .sort(compareByTimeAndId(getTime));
  const eligible = ordered.filter(
    (entry) => getTime(entry) >= cutoff || isProtected(entry),
  );
  const outsideRetention = ordered.filter(
    (entry) => getTime(entry) < cutoff && !isProtected(entry),
  );
  const protectedEntries = eligible.filter(isProtected);
  const ordinaryEntries = eligible.filter((entry) => !isProtected(entry));
  const retainedProtected = protectedEntries.slice(-max);
  const remaining = Math.max(0, max - retainedProtected.length);
  const retainedOrdinary = ordinaryEntries.slice(-remaining);
  const retainedIds = new Set(
    [...retainedProtected, ...retainedOrdinary].map((entry) => entry.id),
  );
  return {
    retained: eligible
      .filter((entry) => retainedIds.has(entry.id))
      .sort(compareByTimeAndId(getTime)),
    outsideRetention,
    overCap: eligible.filter((entry) => !retainedIds.has(entry.id)),
  };
}

function selectMedia({
  media,
  now,
  cutoff,
  requiredFrameIds,
  leasedFrameIds,
}: {
  media: SpecialCoreIncidentMediaFrame[];
  now: number;
  cutoff: number;
  requiredFrameIds: Set<string>;
  leasedFrameIds: Set<string>;
}): {
  media: SpecialCoreIncidentMediaFrame[];
  omissions: SpecialCoreIncidentEvidenceOmission[];
} {
  const omissions: SpecialCoreIncidentEvidenceOmission[] = [];
  const eligible = media.filter(
    (entry) =>
      entry.sampledAt <= now &&
      (entry.sampledAt >= cutoff ||
        requiredFrameIds.has(entry.frameId) ||
        leasedFrameIds.has(entry.frameId)),
  );
  const outside = media.filter(
    (entry) =>
      entry.sampledAt <= now &&
      entry.sampledAt < cutoff &&
      !requiredFrameIds.has(entry.frameId) &&
      !leasedFrameIds.has(entry.frameId),
  );
  appendDroppedOmission({
    omissions,
    kind: "media",
    reason: "outside-retention",
    entries: outside.map((entry) => ({ id: entry.frameId })),
    now,
  });

  const ordered = [...eligible].sort(
    (left, right) =>
      Number(leasedFrameIds.has(right.frameId)) -
        Number(leasedFrameIds.has(left.frameId)) ||
      Number(requiredFrameIds.has(right.frameId)) -
        Number(requiredFrameIds.has(left.frameId)) ||
      getMediaPriority(right.reason) - getMediaPriority(left.reason) ||
      right.sampledAt - left.sampledAt ||
      left.id.localeCompare(right.id),
  );
  const retained: SpecialCoreIncidentMediaFrame[] = [];
  const oversized: SpecialCoreIncidentMediaFrame[] = [];
  const overBudget: SpecialCoreIncidentMediaFrame[] = [];
  let retainedChars = 0;
  for (const entry of ordered) {
    const chars = entry.imageDataUrl.length;
    if (chars > SPECIAL_CORE_INCIDENT_MEDIA_MAX_FRAME_CHARS) {
      oversized.push(entry);
      continue;
    }
    if (
      retained.length >= SPECIAL_CORE_INCIDENT_MEDIA_MAX_FRAMES ||
      retainedChars + chars > SPECIAL_CORE_INCIDENT_MEDIA_MAX_TOTAL_CHARS
    ) {
      overBudget.push(entry);
      continue;
    }
    retained.push(entry);
    retainedChars += chars;
  }
  appendDroppedOmission({
    omissions,
    kind: "media",
    reason: "media-oversize",
    entries: oversized.map((entry) => ({ id: entry.frameId })),
    now,
  });
  appendDroppedOmission({
    omissions,
    kind: "media",
    reason: "media-budget",
    entries: overBudget.map((entry) => ({ id: entry.frameId })),
    now,
  });
  return {
    media: retained.sort(compareByTimeAndId((entry) => entry.sampledAt)),
    omissions,
  };
}

function enforceMetadataBudget(
  archive: SpecialCoreIncidentEvidenceArchive,
  protection: ProtectionSets,
  now: number,
): SpecialCoreIncidentEvidenceArchive {
  let next = cloneArchive(archive);
  const droppedEventIds: string[] = [];
  const droppedFrameIds: string[] = [];

  while (
    getSpecialCoreIncidentEvidenceMetadataChars(next) >
      SPECIAL_CORE_INCIDENT_METADATA_MAX_CHARS &&
    next.lifecycleEvents.length > 0
  ) {
    const index = next.lifecycleEvents.findIndex(
      (entry) => !protection.eventIds.has(entry.id),
    );
    if (index < 0) break;
    const [removed] = next.lifecycleEvents.splice(index, 1);
    if (removed) droppedEventIds.push(removed.id);
  }
  while (
    getSpecialCoreIncidentEvidenceMetadataChars(next) >
      SPECIAL_CORE_INCIDENT_METADATA_MAX_CHARS &&
    next.frames.length > 0
  ) {
    const index = next.frames.findIndex(
      (entry) => !protection.frameIds.has(entry.id),
    );
    if (index < 0) break;
    const [removed] = next.frames.splice(index, 1);
    if (!removed) break;
    droppedFrameIds.push(removed.id);
    next.observations = next.observations.filter(
      (entry) => entry.frameId !== removed.id,
    );
    next.media = next.media.filter((entry) => entry.frameId !== removed.id);
  }
  const additions: SpecialCoreIncidentEvidenceOmission[] = [];
  appendDroppedOmission({
    omissions: additions,
    kind: "event",
    reason: "metadata-cap",
    entries: droppedEventIds.map((id) => ({ id })),
    now,
  });
  appendDroppedOmission({
    omissions: additions,
    kind: "frame",
    reason: "metadata-cap",
    entries: droppedFrameIds.map((id) => ({ id })),
    now,
  });
  next.omissions = compactOmissions([...next.omissions, ...additions]);
  while (
    getSpecialCoreIncidentEvidenceMetadataChars(next) >
      SPECIAL_CORE_INCIDENT_METADATA_MAX_CHARS &&
    next.omissions.length > 1
  ) {
    next.omissions = next.omissions.slice(1);
  }
  return next;
}

function enforceRequestBudget(
  archive: SpecialCoreIncidentEvidenceArchive,
  protection: ProtectionSets,
  now: number,
): SpecialCoreIncidentEvidenceArchive {
  let next = cloneArchive(archive);
  const droppedEventIds: string[] = [];
  const droppedFrameIds: string[] = [];
  const droppedMediaFrameIds: string[] = [];

  while (
    getSpecialCoreIncidentEvidenceRequestBytes(next) >
      SPECIAL_CORE_INCIDENT_REPORT_REQUEST_TARGET_BYTES &&
    next.lifecycleEvents.length > 0
  ) {
    const index = next.lifecycleEvents.findIndex(
      (entry) => !protection.eventIds.has(entry.id),
    );
    if (index < 0) break;
    const [removed] = next.lifecycleEvents.splice(index, 1);
    if (removed) droppedEventIds.push(removed.id);
  }
  while (
    getSpecialCoreIncidentEvidenceRequestBytes(next) >
      SPECIAL_CORE_INCIDENT_REPORT_REQUEST_TARGET_BYTES &&
    next.frames.length > 0
  ) {
    const index = next.frames.findIndex(
      (entry) => !protection.frameIds.has(entry.id),
    );
    if (index < 0) break;
    const [removed] = next.frames.splice(index, 1);
    if (!removed) break;
    droppedFrameIds.push(removed.id);
    next.observations = next.observations.filter(
      (entry) => entry.frameId !== removed.id,
    );
    next.media = next.media.filter((entry) => entry.frameId !== removed.id);
  }
  while (
    getSpecialCoreIncidentEvidenceRequestBytes(next) >
      SPECIAL_CORE_INCIDENT_REPORT_REQUEST_TARGET_BYTES &&
    next.media.length > 0
  ) {
    const ordered = [...next.media].sort(
      (left, right) =>
        Number(protection.mediaFrameIds.has(left.frameId)) -
          Number(protection.mediaFrameIds.has(right.frameId)) ||
        Number(protection.frameIds.has(left.frameId)) -
          Number(protection.frameIds.has(right.frameId)) ||
        getMediaPriority(left.reason) - getMediaPriority(right.reason) ||
        left.sampledAt - right.sampledAt ||
        left.id.localeCompare(right.id),
    );
    const removed = ordered[0];
    if (!removed) break;
    droppedMediaFrameIds.push(removed.frameId);
    next.media = next.media.filter((entry) => entry.id !== removed.id);
  }

  const additions: SpecialCoreIncidentEvidenceOmission[] = [];
  appendDroppedOmission({
    omissions: additions,
    kind: "event",
    reason: "payload-compacted",
    entries: droppedEventIds.map((id) => ({ id })),
    now,
  });
  appendDroppedOmission({
    omissions: additions,
    kind: "frame",
    reason: "payload-compacted",
    entries: droppedFrameIds.map((id) => ({ id })),
    now,
  });
  appendDroppedOmission({
    omissions: additions,
    kind: "media",
    reason: "payload-compacted",
    entries: droppedMediaFrameIds.map((id) => ({ id })),
    now,
  });
  next.omissions = compactOmissions([...next.omissions, ...additions]);
  while (
    getSpecialCoreIncidentEvidenceRequestBytes(next) >
      SPECIAL_CORE_INCIDENT_REPORT_REQUEST_TARGET_BYTES &&
    next.omissions.length > 1
  ) {
    next.omissions = next.omissions.slice(1);
  }
  return next;
}

function appendTruncationOmissions(
  archive: SpecialCoreIncidentEvidenceArchive,
  omissions: SpecialCoreIncidentEvidenceOmission[],
  now: number,
): void {
  appendDroppedOmission({
    omissions,
    kind: "observation",
    reason: "metadata-cap",
    entries: archive.observations.filter(
      (entry) => (entry.reason?.length ?? 0) > 256,
    ),
    now,
  });
  appendDroppedOmission({
    omissions,
    kind: "schedule",
    reason: "metadata-cap",
    entries: archive.schedules.filter(
      (entry) => (entry.outcomeReason?.length ?? 0) > 256,
    ),
    now,
  });
  appendDroppedOmission({
    omissions,
    kind: "playback-attempt",
    reason: "metadata-cap",
    entries: archive.playbackAttempts.filter(
      (entry) => (entry.error?.length ?? 0) > 256,
    ),
    now,
  });
  appendDroppedOmission({
    omissions,
    kind: "event",
    reason: "metadata-cap",
    entries: archive.lifecycleEvents.filter(
      (entry) =>
        entry.action.length > 128 ||
        JSON.stringify(entry.details).length >
          SPECIAL_CORE_INCIDENT_EVENT_DETAILS_MAX_CHARS,
    ),
    now,
  });
}

function collectReferencedResetEpochIds({
  pointers,
  frames,
  observations,
  confirmationAttempts,
  activations,
  schedules,
  decisions,
  playbackAttempts,
  lifecycleEvents,
}: Pick<
  SpecialCoreIncidentEvidenceArchive,
  | "pointers"
  | "frames"
  | "observations"
  | "confirmationAttempts"
  | "activations"
  | "schedules"
  | "decisions"
  | "playbackAttempts"
  | "lifecycleEvents"
>): Set<string> {
  const ids = new Set<string>();
  addNullable(ids, pointers.currentResetEpochId);
  for (const entry of [
    ...frames,
    ...observations,
    ...confirmationAttempts,
    ...activations,
    ...schedules,
    ...decisions,
    ...playbackAttempts,
    ...lifecycleEvents,
  ]) {
    ids.add(entry.resetEpochId);
  }
  return ids;
}

function collectReferencedConfigurationIds({
  pointers,
  frames,
  observations,
  activations,
  schedules,
  decisions,
  playbackAttempts,
  lifecycleEvents,
}: Pick<
  SpecialCoreIncidentEvidenceArchive,
  | "pointers"
  | "frames"
  | "observations"
  | "activations"
  | "schedules"
  | "decisions"
  | "playbackAttempts"
  | "lifecycleEvents"
>): Set<string> {
  const ids = new Set<string>();
  addNullable(ids, pointers.currentConfigurationRevisionId);
  frames.forEach((entry) => ids.add(entry.configRevisionId));
  observations.forEach((entry) => ids.add(entry.configRevisionId));
  activations.forEach((entry) => ids.add(entry.timingConfigRevisionId));
  schedules.forEach((entry) => ids.add(entry.timingConfigRevisionId));
  decisions.forEach((entry) => {
    ids.add(entry.timingConfigRevisionId);
    ids.add(entry.firedConfigRevisionId);
  });
  playbackAttempts.forEach((entry) => ids.add(entry.configRevisionId));
  lifecycleEvents.forEach((entry) =>
    addNullable(ids, entry.configRevisionId),
  );
  return ids;
}

function normalizePointers(
  pointers: SpecialCoreIncidentEvidencePointers,
  retained: {
    resetEpochIds: Set<string>;
    configurationRevisionIds: Set<string>;
    frameIds: Set<string>;
    observationIds: Set<string>;
    confirmationAttemptIds: Set<string>;
    activationIds: Set<string>;
    scheduleIds: Set<string>;
    decisionIds: Set<string>;
    playbackAttemptIds: Set<string>;
  },
): SpecialCoreIncidentEvidencePointers {
  return {
    currentResetEpochId: retainPointer(
      pointers.currentResetEpochId,
      retained.resetEpochIds,
    ),
    currentConfigurationRevisionId: retainPointer(
      pointers.currentConfigurationRevisionId,
      retained.configurationRevisionIds,
    ),
    latestFrameId: retainPointer(pointers.latestFrameId, retained.frameIds),
    latestObservationId: retainPointer(
      pointers.latestObservationId,
      retained.observationIds,
    ),
    activeConfirmationAttemptId: retainPointer(
      pointers.activeConfirmationAttemptId,
      retained.confirmationAttemptIds,
    ),
    activeActivationId: retainPointer(
      pointers.activeActivationId,
      retained.activationIds,
    ),
    activeScheduleId: retainPointer(
      pointers.activeScheduleId,
      retained.scheduleIds,
    ),
    activeDecisionId: retainPointer(
      pointers.activeDecisionId,
      retained.decisionIds,
    ),
    activePlaybackAttemptId: retainPointer(
      pointers.activePlaybackAttemptId,
      retained.playbackAttemptIds,
    ),
  };
}

function createProtectionSets(
  protection?: SpecialCoreIncidentEvidenceProtection,
): ProtectionSets {
  return {
    resetEpochIds: new Set(protection?.resetEpochIds ?? []),
    configurationRevisionIds: new Set(
      protection?.configurationRevisionIds ?? [],
    ),
    frameIds: new Set(protection?.frameIds ?? []),
    observationIds: new Set(protection?.observationIds ?? []),
    confirmationAttemptIds: new Set(
      protection?.confirmationAttemptIds ?? [],
    ),
    activationIds: new Set(protection?.activationIds ?? []),
    scheduleIds: new Set(protection?.scheduleIds ?? []),
    decisionIds: new Set(protection?.decisionIds ?? []),
    playbackAttemptIds: new Set(protection?.playbackAttemptIds ?? []),
    eventIds: new Set(protection?.eventIds ?? []),
    mediaFrameIds: new Set(protection?.mediaFrameIds ?? []),
  };
}

function getProtectionSize(protection: ProtectionSets): number {
  return Object.values(protection).reduce((sum, entries) => sum + entries.size, 0);
}

function appendSelectionOmissions<T extends { id: string }>(
  omissions: SpecialCoreIncidentEvidenceOmission[],
  kind: SpecialCoreIncidentEvidenceOmission["kind"],
  selection: Selection<T>,
  now: number,
): void {
  appendDroppedOmission({
    omissions,
    kind,
    reason: "outside-retention",
    entries: selection.outsideRetention,
    now,
  });
  appendDroppedOmission({
    omissions,
    kind,
    reason: "metadata-cap",
    entries: selection.overCap,
    now,
  });
}

function appendDroppedOmission<T extends { id: string }>({
  omissions,
  kind,
  reason,
  entries,
  now,
}: {
  omissions: SpecialCoreIncidentEvidenceOmission[];
  kind: SpecialCoreIncidentEvidenceOmission["kind"];
  reason: SpecialCoreIncidentEvidenceOmissionReason;
  entries: T[];
  now: number;
}): void {
  if (entries.length === 0) return;
  omissions.push(
    createOmission({
      kind,
      reason,
      subjectIds: entries.map((entry) => entry.id),
      count: entries.length,
      now,
    }),
  );
}

function createOmission({
  kind,
  reason,
  subjectIds,
  count,
  now,
}: {
  kind: SpecialCoreIncidentEvidenceOmission["kind"];
  reason: SpecialCoreIncidentEvidenceOmissionReason;
  subjectIds: string[];
  count: number;
  now: number;
}): SpecialCoreIncidentEvidenceOmission {
  const boundedIds = [...new Set(subjectIds)].sort().slice(0, 16);
  return {
    id: `special-core-omission:${kind}:${reason}:${now}:${hashToken(
      boundedIds.join("|"),
    )}`,
    occurredAt: now,
    kind,
    reason,
    subjectIds: boundedIds,
    count,
  };
}

function compactOmissions(
  omissions: SpecialCoreIncidentEvidenceOmission[],
): SpecialCoreIncidentEvidenceOmission[] {
  return mergeById([], omissions)
    .sort(compareByTimeAndId((entry) => entry.occurredAt))
    .slice(-SPECIAL_CORE_INCIDENT_MAX_OMISSIONS);
}

function mergePatch<T>(left: T[] | undefined, right: T[] | undefined): T[] {
  return [...(left ?? []), ...(right ?? [])];
}

function mergeById<T extends { id: string }>(
  current: T[],
  patch: T[] | undefined,
): T[] {
  if (!patch || patch.length === 0) return [...current];
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of patch) byId.set(entry.id, entry);
  return [...byId.values()];
}

function mergeMedia(
  current: SpecialCoreIncidentMediaFrame[],
  patch: SpecialCoreIncidentMediaFrame[] | undefined,
): SpecialCoreIncidentMediaFrame[] {
  if (!patch || patch.length === 0) return [...current];
  const byFrameId = new Map(current.map((entry) => [entry.frameId, entry]));
  for (const entry of patch) {
    const existing = byFrameId.get(entry.frameId);
    if (!existing) {
      byFrameId.set(entry.frameId, entry);
      continue;
    }
    byFrameId.set(entry.frameId, {
      ...existing,
      ...entry,
      id: existing.id,
      reason:
        getMediaPriority(entry.reason) >= getMediaPriority(existing.reason)
          ? entry.reason
          : existing.reason,
      imageDataUrl: entry.imageDataUrl || existing.imageDataUrl,
    });
  }
  return [...byFrameId.values()];
}

function getMediaPriority(reason: SpecialCoreIncidentMediaReason): number {
  switch (reason) {
    case "playback-failed":
      return 100;
    case "alert-decision":
      return 90;
    case "activation-confirmation":
      return 80;
    case "runtime-error":
      return 70;
    case "rejected-observation":
      return 55;
    case "current":
      return 20;
    case "periodic":
      return 10;
  }
}

function getPlaybackEventAt(entry: SpecialCoreIncidentPlaybackAttempt): number {
  return (
    entry.finishedAt ??
    entry.failedAt ??
    entry.browserAcceptedAt ??
    entry.requestedAt
  );
}

function cloneArchive(
  archive: SpecialCoreIncidentEvidenceArchive,
): SpecialCoreIncidentEvidenceArchive {
  return {
    ...archive,
    pointers: { ...archive.pointers },
    resetEpochs: [...archive.resetEpochs],
    configurationRevisions: [...archive.configurationRevisions],
    frames: [...archive.frames],
    observations: [...archive.observations],
    confirmationAttempts: [...archive.confirmationAttempts],
    activations: [...archive.activations],
    schedules: [...archive.schedules],
    decisions: [...archive.decisions],
    playbackAttempts: [...archive.playbackAttempts],
    lifecycleEvents: [...archive.lifecycleEvents],
    media: [...archive.media],
    omissions: [...archive.omissions],
  };
}

function truncateText(value: string | null, max = 256): string | null {
  if (value === null || value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function retainPointer(value: string | null, ids: Set<string>): string | null {
  return value !== null && ids.has(value) ? value : null;
}

function addNullable(ids: Set<string>, value: string | null): void {
  if (value !== null) ids.add(value);
}

function compareByTimeAndId<T>(
  getTime: (entry: T) => number,
): (left: T & { id: string }, right: T & { id: string }) => number {
  return (left, right) =>
    getTime(left) - getTime(right) || left.id.localeCompare(right.id);
}

function hashToken(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cloneEvidence<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
