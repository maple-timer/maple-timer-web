import {
  BOOSTER_EXPIRY_INCIDENT_EVIDENCE_SCHEMA_VERSION,
  type BoosterExpiryIncidentAlertDecision,
  type BoosterExpiryIncidentBoundaryState,
  type BoosterExpiryIncidentCandidateAttempt,
  type BoosterExpiryIncidentConfigurationRevision,
  type BoosterExpiryIncidentConfirmedCycle,
  type BoosterExpiryIncidentEvidenceArchive,
  type BoosterExpiryIncidentEvidenceOmission,
  type BoosterExpiryIncidentEvidenceOmissionReason,
  type BoosterExpiryIncidentEvidencePointers,
  type BoosterExpiryIncidentFlowEpoch,
  type BoosterExpiryIncidentFrozenState,
  type BoosterExpiryIncidentFrame,
  type BoosterExpiryIncidentLifecycleEvent,
  type BoosterExpiryIncidentMediaFrame,
  type BoosterExpiryIncidentMediaReason,
  type BoosterExpiryIncidentObservation,
  type BoosterExpiryIncidentPlaybackAttempt,
  type BoosterExpiryIncidentRelatedPlayback,
  type BoosterExpiryIncidentReportLease,
  type BoosterExpiryIncidentResetEpoch,
  type BoosterExpiryIncidentSchedule,
  type FrozenBoosterExpiryIncidentEvidence,
} from "./boosterExpiryIncidentEvidenceTypes";

export const BOOSTER_EXPIRY_INCIDENT_RETENTION_MS = 60_000;
export const BOOSTER_EXPIRY_INCIDENT_CURRENT_WINDOW_MS = 10_000;
export const BOOSTER_EXPIRY_INCIDENT_MAX_RESET_EPOCHS = 8;
export const BOOSTER_EXPIRY_INCIDENT_MAX_CONFIGURATION_REVISIONS = 32;
export const BOOSTER_EXPIRY_INCIDENT_MAX_FLOW_EPOCHS = 16;
export const BOOSTER_EXPIRY_INCIDENT_MAX_FRAMES = 72;
export const BOOSTER_EXPIRY_INCIDENT_MAX_OBSERVATIONS = 72;
export const BOOSTER_EXPIRY_INCIDENT_MAX_CANDIDATE_ATTEMPTS = 32;
export const BOOSTER_EXPIRY_INCIDENT_MAX_CYCLES = 16;
export const BOOSTER_EXPIRY_INCIDENT_MAX_SCHEDULES = 32;
export const BOOSTER_EXPIRY_INCIDENT_MAX_DECISIONS = 16;
export const BOOSTER_EXPIRY_INCIDENT_MAX_PLAYBACK_ATTEMPTS = 16;
export const BOOSTER_EXPIRY_INCIDENT_MAX_LIFECYCLE_EVENTS = 128;
export const BOOSTER_EXPIRY_INCIDENT_MAX_OMISSIONS = 64;
export const BOOSTER_EXPIRY_INCIDENT_MAX_RELATED_PLAYBACK = 16;
export const BOOSTER_EXPIRY_INCIDENT_EVENT_DETAILS_MAX_CHARS = 256;
export const BOOSTER_EXPIRY_INCIDENT_METADATA_MAX_CHARS = 192 * 1024;
export const BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_FRAMES = 8;
export const BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_FRAME_CHARS = 900_000;
export const BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_TOTAL_CHARS = 1_200_000;
export const BOOSTER_EXPIRY_INCIDENT_REPORT_REQUEST_TARGET_BYTES =
  2 * 1024 * 1024;

export type BoosterExpiryIncidentEvidencePatch = {
  boundaryState?: BoosterExpiryIncidentBoundaryState;
  pointers?: Partial<BoosterExpiryIncidentEvidencePointers>;
  resetEpochs?: BoosterExpiryIncidentResetEpoch[];
  configurationRevisions?: BoosterExpiryIncidentConfigurationRevision[];
  flowEpochs?: BoosterExpiryIncidentFlowEpoch[];
  frames?: BoosterExpiryIncidentFrame[];
  observations?: BoosterExpiryIncidentObservation[];
  candidateAttempts?: BoosterExpiryIncidentCandidateAttempt[];
  cycles?: BoosterExpiryIncidentConfirmedCycle[];
  schedules?: BoosterExpiryIncidentSchedule[];
  decisions?: BoosterExpiryIncidentAlertDecision[];
  playbackAttempts?: BoosterExpiryIncidentPlaybackAttempt[];
  lifecycleEvents?: BoosterExpiryIncidentLifecycleEvent[];
  media?: BoosterExpiryIncidentMediaFrame[];
  omissions?: BoosterExpiryIncidentEvidenceOmission[];
};

export type BoosterExpiryIncidentEvidenceProtection = {
  resetEpochIds?: string[];
  configurationRevisionIds?: string[];
  flowEpochIds?: string[];
  frameIds?: string[];
  observationIds?: string[];
  candidateAttemptIds?: string[];
  cycleIds?: string[];
  scheduleIds?: string[];
  decisionIds?: string[];
  playbackAttemptIds?: string[];
  eventIds?: string[];
  mediaFrameIds?: string[];
};

export type BoosterExpiryIncidentEvidenceSupport =
  "current" | "recent" | "unsupported";

type ProtectionSets = {
  resetEpochIds: Set<string>;
  configurationRevisionIds: Set<string>;
  flowEpochIds: Set<string>;
  frameIds: Set<string>;
  observationIds: Set<string>;
  candidateAttemptIds: Set<string>;
  cycleIds: Set<string>;
  scheduleIds: Set<string>;
  decisionIds: Set<string>;
  playbackAttemptIds: Set<string>;
  eventIds: Set<string>;
  mediaFrameIds: Set<string>;
};

type Selection<T> = {
  retained: T[];
  outsideRetention: T[];
  overCap: T[];
};

const EMPTY_POINTERS: BoosterExpiryIncidentEvidencePointers = {
  currentResetEpochId: null,
  currentConfigurationRevisionId: null,
  currentFlowEpochId: null,
  latestFrameId: null,
  latestObservationId: null,
  activeCandidateAttemptId: null,
  activeCycleId: null,
  activeScheduleId: null,
  activeDecisionId: null,
  activePlaybackAttemptId: null,
};

export function createBoosterExpiryIncidentEvidenceArchive(
  now = Date.now(),
): BoosterExpiryIncidentEvidenceArchive {
  return {
    schemaVersion: BOOSTER_EXPIRY_INCIDENT_EVIDENCE_SCHEMA_VERSION,
    updatedAt: now,
    pointers: { ...EMPTY_POINTERS },
    resetEpochs: [],
    configurationRevisions: [],
    flowEpochs: [],
    frames: [],
    observations: [],
    candidateAttempts: [],
    cycles: [],
    schedules: [],
    decisions: [],
    playbackAttempts: [],
    lifecycleEvents: [],
    media: [],
    omissions: [],
  };
}

export function freezeBoosterExpiryIncidentEvidence({
  archive,
  lease,
  frozenState = null,
  relatedPlayback = [],
}: {
  archive: BoosterExpiryIncidentEvidenceArchive;
  lease: BoosterExpiryIncidentReportLease;
  frozenState?: BoosterExpiryIncidentFrozenState | null;
  relatedPlayback?: BoosterExpiryIncidentRelatedPlayback[];
}): FrozenBoosterExpiryIncidentEvidence {
  const scoped = scopeArchiveToLease(archive, lease);
  const protection = createLeaseProtection(scoped, lease);
  const compacted = compactBoosterExpiryIncidentEvidenceArchive({
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
      frozenState.flowEpochId === lease.flowEpochId &&
      frozenState.configRevisionId === lease.configRevisionId
        ? scopeFrozenState(frozenState, compacted)
        : null,
    relatedPlayback: relatedPlayback
      .filter(
        (entry) =>
          entry.requestedAt <= lease.frozenAt &&
          getRelatedPlaybackEventAt(entry) >=
            lease.frozenAt - BOOSTER_EXPIRY_INCIDENT_RETENTION_MS,
      )
      .map((entry) => scopeRelatedPlayback(entry, lease.frozenAt))
      .sort(
        (left, right) =>
          getRelatedPlaybackEventAt(left) - getRelatedPlaybackEventAt(right) ||
          left.id.localeCompare(right.id),
      )
      .slice(-BOOSTER_EXPIRY_INCIDENT_MAX_RELATED_PLAYBACK),
  });
}

export function updateBoosterExpiryIncidentEvidenceArchive({
  previous,
  patch,
  now,
  protection,
}: {
  previous: BoosterExpiryIncidentEvidenceArchive | null | undefined;
  patch: BoosterExpiryIncidentEvidencePatch;
  now: number;
  protection?: BoosterExpiryIncidentEvidenceProtection;
}): BoosterExpiryIncidentEvidenceArchive {
  const base = previous ?? createBoosterExpiryIncidentEvidenceArchive(now);
  const boundaryPatch = patch.boundaryState
    ? createBoundaryPatch(patch.boundaryState)
    : null;
  const pointers = {
    ...base.pointers,
    ...(boundaryPatch?.pointers ?? {}),
    ...(patch.pointers ?? {}),
  };

  return compactBoosterExpiryIncidentEvidenceArchive({
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
      flowEpochs: mergeById(
        base.flowEpochs,
        mergePatch(boundaryPatch?.flowEpochs, patch.flowEpochs),
      ),
      frames: mergeById(
        base.frames,
        mergePatch(boundaryPatch?.frames, patch.frames),
      ),
      observations: mergeById(
        base.observations,
        mergePatch(boundaryPatch?.observations, patch.observations),
      ),
      candidateAttempts: mergeById(
        base.candidateAttempts,
        mergePatch(boundaryPatch?.candidateAttempts, patch.candidateAttempts),
      ),
      cycles: mergeById(
        base.cycles,
        mergePatch(boundaryPatch?.cycles, patch.cycles),
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
        mergePatch(boundaryPatch?.playbackAttempts, patch.playbackAttempts),
      ),
      lifecycleEvents: mergeById(base.lifecycleEvents, patch.lifecycleEvents),
      media: mergeMedia(base.media, patch.media),
      omissions: mergeById(base.omissions, patch.omissions),
    },
    now,
    protection,
  });
}

export function compactBoosterExpiryIncidentEvidenceArchive({
  archive,
  now,
  protection,
}: {
  archive: BoosterExpiryIncidentEvidenceArchive;
  now: number;
  protection?: BoosterExpiryIncidentEvidenceProtection;
}): BoosterExpiryIncidentEvidenceArchive {
  const normalized = normalizeArchive(archive);
  const cutoff = now - BOOSTER_EXPIRY_INCIDENT_RETENTION_MS;
  const protectedIds = createProtectionSets(protection);
  addPointerProtection(normalized, protectedIds, now);
  deriveProtectionFromRecords(normalized, protectedIds);
  const omissions = normalized.omissions.filter(
    (entry) => entry.occurredAt >= cutoff && entry.occurredAt <= now,
  );
  appendNormalizationOmissions(archive, normalized, omissions, now);

  const cycleSelection = selectRecords({
    items: normalized.cycles,
    now,
    cutoff,
    max: BOOSTER_EXPIRY_INCIDENT_MAX_CYCLES,
    getTime: (entry) => entry.endedAt ?? entry.confirmedAt,
    isProtected: (entry) => protectedIds.cycleIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "cycle", cycleSelection, now);
  const cycles = cycleSelection.retained;
  const cycleIds = new Set(cycles.map((entry) => entry.id));
  for (const cycle of cycles) {
    protectedIds.candidateAttemptIds.add(cycle.candidateAttemptId);
    cycle.observationIds.forEach((id) => protectedIds.observationIds.add(id));
    protectedIds.flowEpochIds.add(cycle.confirmationFlowEpochId);
    protectedIds.configurationRevisionIds.add(cycle.timingConfigRevisionId);
  }
  for (const schedule of normalized.schedules) {
    if (cycleIds.has(schedule.cycleId))
      protectedIds.scheduleIds.add(schedule.id);
  }

  const candidateSelection = selectRecords({
    items: normalized.candidateAttempts,
    now,
    cutoff,
    max: BOOSTER_EXPIRY_INCIDENT_MAX_CANDIDATE_ATTEMPTS,
    getTime: (entry) => entry.endedAt ?? entry.lastObservedAt,
    isProtected: (entry) => protectedIds.candidateAttemptIds.has(entry.id),
  });
  appendSelectionOmissions(
    omissions,
    "candidate-attempt",
    candidateSelection,
    now,
  );
  const candidateAttempts = candidateSelection.retained;
  for (const candidate of candidateAttempts) {
    if (!protectedIds.candidateAttemptIds.has(candidate.id)) continue;
    candidate.observationIds.forEach((id) =>
      protectedIds.observationIds.add(id),
    );
    protectedIds.flowEpochIds.add(candidate.flowEpochId);
  }

  const scheduleSelection = selectRecords({
    items: normalized.schedules.filter((entry) => cycleIds.has(entry.cycleId)),
    now,
    cutoff,
    max: BOOSTER_EXPIRY_INCIDENT_MAX_SCHEDULES,
    getTime: (entry) => entry.endedAt ?? entry.registeredAt,
    isProtected: (entry) => protectedIds.scheduleIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "schedule", scheduleSelection, now);
  const schedules = scheduleSelection.retained;
  const scheduleIds = new Set(schedules.map((entry) => entry.id));
  for (const schedule of schedules) {
    protectedIds.configurationRevisionIds.add(schedule.timingConfigRevisionId);
  }
  for (const decision of normalized.decisions) {
    if (
      cycleIds.has(decision.cycleId) &&
      scheduleIds.has(decision.scheduleId)
    ) {
      protectedIds.decisionIds.add(decision.id);
    }
  }

  const decisionSelection = selectRecords({
    items: normalized.decisions.filter(
      (entry) =>
        cycleIds.has(entry.cycleId) && scheduleIds.has(entry.scheduleId),
    ),
    now,
    cutoff,
    max: BOOSTER_EXPIRY_INCIDENT_MAX_DECISIONS,
    getTime: (entry) => entry.occurredAt,
    isProtected: (entry) => protectedIds.decisionIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "decision", decisionSelection, now);
  const decisions = decisionSelection.retained;
  const decisionIds = new Set(decisions.map((entry) => entry.id));
  for (const decision of decisions) {
    protectedIds.configurationRevisionIds.add(decision.timingConfigRevisionId);
    protectedIds.configurationRevisionIds.add(decision.firedConfigRevisionId);
  }
  for (const attempt of normalized.playbackAttempts) {
    if (
      cycleIds.has(attempt.cycleId) &&
      scheduleIds.has(attempt.scheduleId) &&
      decisionIds.has(attempt.decisionId)
    ) {
      protectedIds.playbackAttemptIds.add(attempt.id);
    }
  }

  const playbackSelection = selectRecords({
    items: normalized.playbackAttempts.filter(
      (entry) =>
        cycleIds.has(entry.cycleId) &&
        scheduleIds.has(entry.scheduleId) &&
        decisionIds.has(entry.decisionId),
    ),
    now,
    cutoff,
    max: BOOSTER_EXPIRY_INCIDENT_MAX_PLAYBACK_ATTEMPTS,
    getTime: getPlaybackEventAt,
    isProtected: (entry) => protectedIds.playbackAttemptIds.has(entry.id),
  });
  appendSelectionOmissions(
    omissions,
    "playback-attempt",
    playbackSelection,
    now,
  );
  const playbackAttempts = playbackSelection.retained;

  deriveProtectionFromRecords(
    {
      ...normalized,
      candidateAttempts,
      cycles,
      schedules,
      decisions,
      playbackAttempts,
    },
    protectedIds,
  );

  const observationSelection = selectRecords({
    items: normalized.observations,
    now,
    cutoff,
    max: BOOSTER_EXPIRY_INCIDENT_MAX_OBSERVATIONS,
    getTime: (entry) => entry.sampledAt,
    isProtected: (entry) => protectedIds.observationIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "observation", observationSelection, now);
  const observations = observationSelection.retained;
  const observationIds = new Set(observations.map((entry) => entry.id));
  for (const observation of observations) {
    if (!protectedIds.observationIds.has(observation.id)) continue;
    protectedIds.frameIds.add(observation.frameId);
    protectedIds.configurationRevisionIds.add(observation.configRevisionId);
    protectedIds.flowEpochIds.add(observation.flowEpochId);
  }

  const frameSelection = selectRecords({
    items: normalized.frames,
    now,
    cutoff,
    max: BOOSTER_EXPIRY_INCIDENT_MAX_FRAMES,
    getTime: (entry) => entry.sampledAt,
    isProtected: (entry) => protectedIds.frameIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "frame", frameSelection, now);
  const frames = frameSelection.retained;
  const frameIds = new Set(frames.map((entry) => entry.id));

  const scopedObservations = observations.filter((entry) =>
    frameIds.has(entry.frameId),
  );
  const scopedObservationIds = new Set(
    scopedObservations.map((entry) => entry.id),
  );
  const scopedCandidates = candidateAttempts.filter((entry) =>
    entry.observationIds.some((id) => scopedObservationIds.has(id)),
  );
  const scopedCandidateIds = new Set(scopedCandidates.map((entry) => entry.id));
  const scopedCycles = cycles.filter(
    (entry) =>
      scopedCandidateIds.has(entry.candidateAttemptId) &&
      entry.observationIds.every((id) => scopedObservationIds.has(id)),
  );
  const scopedCycleIds = new Set(scopedCycles.map((entry) => entry.id));
  const scopedSchedules = schedules.filter((entry) =>
    scopedCycleIds.has(entry.cycleId),
  );
  const scopedScheduleIds = new Set(scopedSchedules.map((entry) => entry.id));
  const scopedDecisions = decisions.filter(
    (entry) =>
      scopedCycleIds.has(entry.cycleId) &&
      scopedScheduleIds.has(entry.scheduleId),
  );
  const scopedDecisionIds = new Set(scopedDecisions.map((entry) => entry.id));
  const scopedPlaybackAttempts = playbackAttempts.filter(
    (entry) =>
      scopedCycleIds.has(entry.cycleId) &&
      scopedScheduleIds.has(entry.scheduleId) &&
      scopedDecisionIds.has(entry.decisionId),
  );

  appendDependencyDropOmissions({
    original: candidateAttempts,
    retained: scopedCandidates,
    kind: "candidate-attempt",
    omissions,
    now,
  });
  appendDependencyDropOmissions({
    original: cycles,
    retained: scopedCycles,
    kind: "cycle",
    omissions,
    now,
  });
  appendDependencyDropOmissions({
    original: schedules,
    retained: scopedSchedules,
    kind: "schedule",
    omissions,
    now,
  });
  appendDependencyDropOmissions({
    original: decisions,
    retained: scopedDecisions,
    kind: "decision",
    omissions,
    now,
  });
  appendDependencyDropOmissions({
    original: playbackAttempts,
    retained: scopedPlaybackAttempts,
    kind: "playback-attempt",
    omissions,
    now,
  });

  const eventSelection = selectRecords({
    items: normalized.lifecycleEvents,
    now,
    cutoff,
    max: BOOSTER_EXPIRY_INCIDENT_MAX_LIFECYCLE_EVENTS,
    getTime: (entry) => entry.occurredAt,
    isProtected: (entry) =>
      protectedIds.eventIds.has(entry.id) ||
      eventReferencesRetainedChain(entry, {
        observationIds: scopedObservationIds,
        candidateIds: scopedCandidateIds,
        cycleIds: scopedCycleIds,
        scheduleIds: scopedScheduleIds,
        decisionIds: scopedDecisionIds,
        playbackIds: new Set(scopedPlaybackAttempts.map((item) => item.id)),
      }),
  });
  appendSelectionOmissions(omissions, "event", eventSelection, now);
  const lifecycleEvents = eventSelection.retained;

  const referencedConfigIds = new Set<string>();
  const referencedFlowIds = new Set<string>();
  addNullable(
    referencedConfigIds,
    normalized.pointers.currentConfigurationRevisionId,
  );
  addNullable(referencedFlowIds, normalized.pointers.currentFlowEpochId);
  for (const frame of frames) {
    referencedConfigIds.add(frame.configRevisionId);
    referencedFlowIds.add(frame.flowEpochId);
  }
  for (const observation of scopedObservations) {
    referencedConfigIds.add(observation.configRevisionId);
    referencedFlowIds.add(observation.flowEpochId);
  }
  for (const candidate of scopedCandidates) {
    referencedFlowIds.add(candidate.flowEpochId);
  }
  for (const cycle of scopedCycles) {
    referencedConfigIds.add(cycle.timingConfigRevisionId);
    referencedFlowIds.add(cycle.confirmationFlowEpochId);
  }
  for (const schedule of scopedSchedules) {
    referencedConfigIds.add(schedule.timingConfigRevisionId);
  }
  for (const decision of scopedDecisions) {
    referencedConfigIds.add(decision.timingConfigRevisionId);
    referencedConfigIds.add(decision.firedConfigRevisionId);
  }
  for (const attempt of scopedPlaybackAttempts) {
    referencedConfigIds.add(attempt.configRevisionId);
  }
  for (const event of lifecycleEvents) {
    addNullable(referencedConfigIds, event.configRevisionId);
    addNullable(referencedFlowIds, event.flowEpochId);
  }

  const resetSelection = selectRecords({
    items: normalized.resetEpochs,
    now,
    cutoff,
    max: BOOSTER_EXPIRY_INCIDENT_MAX_RESET_EPOCHS,
    getTime: (entry) => entry.startedAt,
    isProtected: (entry) =>
      protectedIds.resetEpochIds.has(entry.id) ||
      entry.id === normalized.pointers.currentResetEpochId,
  });
  appendSelectionOmissions(omissions, "reset-epoch", resetSelection, now);
  const resetEpochs = resetSelection.retained;
  const resetEpochIds = new Set(resetEpochs.map((entry) => entry.id));

  const configurationSelection = selectRecords({
    items: normalized.configurationRevisions.filter((entry) =>
      resetEpochIds.has(entry.resetEpochId),
    ),
    now,
    cutoff,
    max: BOOSTER_EXPIRY_INCIDENT_MAX_CONFIGURATION_REVISIONS,
    getTime: (entry) => entry.capturedAt,
    isProtected: (entry) =>
      protectedIds.configurationRevisionIds.has(entry.id) ||
      referencedConfigIds.has(entry.id),
  });
  appendSelectionOmissions(
    omissions,
    "configuration",
    configurationSelection,
    now,
  );
  const configurationRevisions = configurationSelection.retained;
  const configurationRevisionIds = new Set(
    configurationRevisions.map((entry) => entry.id),
  );

  const flowSelection = selectRecords({
    items: normalized.flowEpochs.filter((entry) =>
      resetEpochIds.has(entry.resetEpochId),
    ),
    now,
    cutoff,
    max: BOOSTER_EXPIRY_INCIDENT_MAX_FLOW_EPOCHS,
    getTime: (entry) => entry.startedAt,
    isProtected: (entry) =>
      protectedIds.flowEpochIds.has(entry.id) ||
      referencedFlowIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "flow-epoch", flowSelection, now);
  const flowEpochs = flowSelection.retained;
  const flowEpochIds = new Set(flowEpochs.map((entry) => entry.id));

  const finalFrames = frames.filter(
    (entry) =>
      resetEpochIds.has(entry.resetEpochId) &&
      configurationRevisionIds.has(entry.configRevisionId) &&
      flowEpochIds.has(entry.flowEpochId),
  );
  const finalFrameIds = new Set(finalFrames.map((entry) => entry.id));
  const finalObservations = scopedObservations.filter(
    (entry) =>
      finalFrameIds.has(entry.frameId) &&
      configurationRevisionIds.has(entry.configRevisionId) &&
      flowEpochIds.has(entry.flowEpochId),
  );
  const finalObservationIds = new Set(
    finalObservations.map((entry) => entry.id),
  );
  const finalCandidates = scopedCandidates.filter(
    (entry) =>
      resetEpochIds.has(entry.resetEpochId) &&
      flowEpochIds.has(entry.flowEpochId) &&
      entry.observationIds.some((id) => finalObservationIds.has(id)),
  );
  const finalCandidateIds = new Set(finalCandidates.map((entry) => entry.id));
  const finalCycles = scopedCycles.filter(
    (entry) =>
      resetEpochIds.has(entry.resetEpochId) &&
      finalCandidateIds.has(entry.candidateAttemptId) &&
      entry.observationIds.every((id) => finalObservationIds.has(id)) &&
      configurationRevisionIds.has(entry.timingConfigRevisionId) &&
      flowEpochIds.has(entry.confirmationFlowEpochId),
  );
  const finalCycleIds = new Set(finalCycles.map((entry) => entry.id));
  const finalSchedules = scopedSchedules.filter(
    (entry) =>
      finalCycleIds.has(entry.cycleId) &&
      configurationRevisionIds.has(entry.timingConfigRevisionId),
  );
  const finalScheduleIds = new Set(finalSchedules.map((entry) => entry.id));
  const finalDecisions = scopedDecisions.filter(
    (entry) =>
      finalCycleIds.has(entry.cycleId) &&
      finalScheduleIds.has(entry.scheduleId) &&
      configurationRevisionIds.has(entry.timingConfigRevisionId) &&
      configurationRevisionIds.has(entry.firedConfigRevisionId),
  );
  const finalDecisionIds = new Set(finalDecisions.map((entry) => entry.id));
  const finalPlaybackAttempts = scopedPlaybackAttempts.filter(
    (entry) =>
      finalCycleIds.has(entry.cycleId) &&
      finalScheduleIds.has(entry.scheduleId) &&
      finalDecisionIds.has(entry.decisionId) &&
      configurationRevisionIds.has(entry.configRevisionId),
  );
  const finalPlaybackIds = new Set(
    finalPlaybackAttempts.map((entry) => entry.id),
  );

  appendDependencyDropOmissions({
    original: frames,
    retained: finalFrames,
    kind: "frame",
    omissions,
    now,
  });
  appendDependencyDropOmissions({
    original: scopedObservations,
    retained: finalObservations,
    kind: "observation",
    omissions,
    now,
  });
  appendDependencyDropOmissions({
    original: scopedCandidates,
    retained: finalCandidates,
    kind: "candidate-attempt",
    omissions,
    now,
  });
  appendDependencyDropOmissions({
    original: scopedCycles,
    retained: finalCycles,
    kind: "cycle",
    omissions,
    now,
  });
  appendDependencyDropOmissions({
    original: scopedSchedules,
    retained: finalSchedules,
    kind: "schedule",
    omissions,
    now,
  });
  appendDependencyDropOmissions({
    original: scopedDecisions,
    retained: finalDecisions,
    kind: "decision",
    omissions,
    now,
  });
  appendDependencyDropOmissions({
    original: scopedPlaybackAttempts,
    retained: finalPlaybackAttempts,
    kind: "playback-attempt",
    omissions,
    now,
  });

  const requiredMediaFrameIds = new Set(protectedIds.mediaFrameIds);
  protectedIds.frameIds.forEach((id) => requiredMediaFrameIds.add(id));
  const mediaSelection = selectMedia({
    media: normalized.media,
    now,
    cutoff,
    requiredFrameIds: requiredMediaFrameIds,
    retainedFrameIds: finalFrameIds,
  });
  omissions.push(...mediaSelection.omissions);

  let compacted: BoosterExpiryIncidentEvidenceArchive = {
    schemaVersion: BOOSTER_EXPIRY_INCIDENT_EVIDENCE_SCHEMA_VERSION,
    updatedAt: now,
    pointers: compactPointers(normalized.pointers, {
      resetEpochIds,
      configurationRevisionIds,
      flowEpochIds,
      frameIds: finalFrameIds,
      observationIds: finalObservationIds,
      candidateIds: finalCandidateIds,
      cycleIds: finalCycleIds,
      scheduleIds: finalScheduleIds,
      decisionIds: finalDecisionIds,
      playbackIds: finalPlaybackIds,
    }),
    resetEpochs,
    configurationRevisions,
    flowEpochs,
    frames: finalFrames,
    observations: finalObservations,
    candidateAttempts: finalCandidates,
    cycles: finalCycles,
    schedules: finalSchedules,
    decisions: finalDecisions,
    playbackAttempts: finalPlaybackAttempts,
    lifecycleEvents: lifecycleEvents.filter(
      (entry) =>
        resetEpochIds.has(entry.resetEpochId) &&
        (entry.configRevisionId === null ||
          configurationRevisionIds.has(entry.configRevisionId)) &&
        (entry.flowEpochId === null || flowEpochIds.has(entry.flowEpochId)) &&
        (entry.frameId === null || finalFrameIds.has(entry.frameId)) &&
        (entry.observationId === null ||
          finalObservationIds.has(entry.observationId)) &&
        (entry.candidateAttemptId === null ||
          finalCandidateIds.has(entry.candidateAttemptId)) &&
        (entry.cycleId === null || finalCycleIds.has(entry.cycleId)) &&
        (entry.scheduleId === null || finalScheduleIds.has(entry.scheduleId)) &&
        (entry.decisionId === null || finalDecisionIds.has(entry.decisionId)) &&
        (entry.playbackAttemptId === null ||
          finalPlaybackIds.has(entry.playbackAttemptId)),
    ),
    media: mediaSelection.media,
    omissions: compactOmissions(omissions),
  };
  compacted = enforceMetadataBudget(compacted, protectedIds, now);
  compacted = enforceRequestBudget(compacted, protectedIds, now);
  return pruneDanglingEvidence(compacted);
}

export function getBoosterExpiryIncidentEvidenceSupport({
  now,
  occurredAt,
}: {
  now: number;
  occurredAt: number;
}): BoosterExpiryIncidentEvidenceSupport {
  const age = now - occurredAt;
  if (age < 0 || age > BOOSTER_EXPIRY_INCIDENT_RETENTION_MS) {
    return "unsupported";
  }
  return age <= BOOSTER_EXPIRY_INCIDENT_CURRENT_WINDOW_MS
    ? "current"
    : "recent";
}

export function getBoosterExpiryIncidentEvidenceMetadataChars(
  archive: BoosterExpiryIncidentEvidenceArchive,
): number {
  return JSON.stringify({
    ...archive,
    media: archive.media.map((entry) => ({
      ...entry,
      imageDataUrl: "[media]",
    })),
  }).length;
}

export function getBoosterExpiryIncidentEvidenceRequestBytes(
  archive: BoosterExpiryIncidentEvidenceArchive,
): number {
  return new TextEncoder().encode(JSON.stringify(archive)).byteLength;
}

function scopeArchiveToLease(
  archive: BoosterExpiryIncidentEvidenceArchive,
  lease: BoosterExpiryIncidentReportLease,
): BoosterExpiryIncidentEvidenceArchive {
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
  const flowEpochs = archive.flowEpochs.filter(
    (entry) =>
      resetEpochIds.has(entry.resetEpochId) &&
      entry.startedAt <= lease.frozenAt,
  );
  const flowEpochIds = new Set(flowEpochs.map((entry) => entry.id));
  const frames = archive.frames.filter(
    (entry) =>
      resetEpochIds.has(entry.resetEpochId) &&
      configurationRevisionIds.has(entry.configRevisionId) &&
      flowEpochIds.has(entry.flowEpochId) &&
      entry.sampledAt <= lease.frozenAt &&
      (entry.resetEpochId !== lease.resetEpochId ||
        (entry.sequence <= lease.leasedThroughFrameSequence &&
          entry.layoutKey === lease.layoutKey &&
          entry.sourceGeometryRevision === lease.sourceGeometryRevision)),
  );
  const frameIds = new Set(frames.map((entry) => entry.id));
  const observations = archive.observations.filter(
    (entry) =>
      frameIds.has(entry.frameId) &&
      flowEpochIds.has(entry.flowEpochId) &&
      entry.sampledAt <= lease.frozenAt,
  );
  const observationIds = new Set(observations.map((entry) => entry.id));
  const candidateAttempts = archive.candidateAttempts
    .filter(
      (entry) =>
        resetEpochIds.has(entry.resetEpochId) &&
        flowEpochIds.has(entry.flowEpochId) &&
        entry.startedAt <= lease.frozenAt,
    )
    .map((entry) =>
      scopeCandidateAttempt(entry, observationIds, lease.frozenAt),
    )
    .filter((entry) => entry.observationIds.length > 0);
  const candidateAttemptIds = new Set(
    candidateAttempts.map((entry) => entry.id),
  );
  let cycles = archive.cycles
    .filter(
      (entry) =>
        resetEpochIds.has(entry.resetEpochId) &&
        candidateAttemptIds.has(entry.candidateAttemptId) &&
        flowEpochIds.has(entry.confirmationFlowEpochId) &&
        entry.confirmedAt <= lease.frozenAt,
    )
    .map((entry) => scopeCycle(entry, observationIds, lease.frozenAt));
  const cycleIds = new Set(cycles.map((entry) => entry.id));
  const schedules = archive.schedules
    .filter(
      (entry) =>
        cycleIds.has(entry.cycleId) && entry.registeredAt <= lease.frozenAt,
    )
    .map((entry) => scopeSchedule(entry, lease.frozenAt));
  const scheduleIds = new Set(schedules.map((entry) => entry.id));
  const decisions = archive.decisions.filter(
    (entry) =>
      cycleIds.has(entry.cycleId) &&
      scheduleIds.has(entry.scheduleId) &&
      entry.occurredAt <= lease.frozenAt,
  );
  const decisionIds = new Set(decisions.map((entry) => entry.id));
  cycles = cycles.map((entry) =>
    entry.status === "alerted" &&
    !decisions.some((decision) => decision.cycleId === entry.id)
      ? { ...entry, status: "active" as const }
      : entry,
  );
  const playbackAttempts = archive.playbackAttempts
    .filter(
      (entry) =>
        cycleIds.has(entry.cycleId) &&
        scheduleIds.has(entry.scheduleId) &&
        decisionIds.has(entry.decisionId) &&
        entry.requestedAt <= lease.frozenAt,
    )
    .map((entry) => scopePlaybackAttempt(entry, lease.frozenAt));
  const playbackAttemptIds = new Set(playbackAttempts.map((entry) => entry.id));
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
      currentResetEpochId: retainPointer(lease.resetEpochId, resetEpochIds),
      currentConfigurationRevisionId: retainPointer(
        lease.configRevisionId,
        configurationRevisionIds,
      ),
      currentFlowEpochId: retainPointer(lease.flowEpochId, flowEpochIds),
      latestFrameId: latestFrame?.id ?? null,
      latestObservationId: latestObservation?.id ?? null,
      activeCandidateAttemptId: retainPointer(
        lease.candidateAttemptId,
        candidateAttemptIds,
      ),
      activeCycleId: retainPointer(lease.cycleId, cycleIds),
      activeScheduleId: retainPointer(lease.scheduleId, scheduleIds),
      activeDecisionId: retainPointer(lease.decisionId, decisionIds),
      activePlaybackAttemptId: retainPointer(
        lease.playbackAttemptId,
        playbackAttemptIds,
      ),
    },
    resetEpochs,
    configurationRevisions,
    flowEpochs,
    frames,
    observations,
    candidateAttempts,
    cycles,
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
  archive: BoosterExpiryIncidentEvidenceArchive,
  lease: BoosterExpiryIncidentReportLease,
): BoosterExpiryIncidentEvidenceProtection {
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
    flowEpochIds: [lease.flowEpochId],
    frameIds: latestFrame ? [latestFrame.id] : [],
    observationIds: [],
    candidateAttemptIds: lease.candidateAttemptId
      ? [lease.candidateAttemptId]
      : [],
    cycleIds: lease.cycleId ? [lease.cycleId] : [],
    scheduleIds: lease.scheduleId ? [lease.scheduleId] : [],
    decisionIds: lease.decisionId ? [lease.decisionId] : [],
    playbackAttemptIds: lease.playbackAttemptId
      ? [lease.playbackAttemptId]
      : [],
    mediaFrameIds: latestFrame ? [latestFrame.id] : [],
  };
}

function scopeCandidateAttempt(
  attempt: BoosterExpiryIncidentCandidateAttempt,
  observationIds: Set<string>,
  frozenAt: number,
): BoosterExpiryIncidentCandidateAttempt {
  const retainedObservationIds = attempt.observationIds.filter((id) =>
    observationIds.has(id),
  );
  if (attempt.endedAt !== null && attempt.endedAt > frozenAt) {
    return {
      ...attempt,
      lastObservedAt: Math.min(attempt.lastObservedAt, frozenAt),
      observationIds: retainedObservationIds,
      status: "collecting",
      confirmedCycleId: null,
      endedAt: null,
      terminalReason: null,
    };
  }
  return { ...attempt, observationIds: retainedObservationIds };
}

function scopeCycle(
  cycle: BoosterExpiryIncidentConfirmedCycle,
  observationIds: Set<string>,
  frozenAt: number,
): BoosterExpiryIncidentConfirmedCycle {
  const scoped = {
    ...cycle,
    observationIds: cycle.observationIds.filter((id) => observationIds.has(id)),
  };
  if (cycle.endedAt !== null && cycle.endedAt > frozenAt) {
    return {
      ...scoped,
      status: "active",
      endedAt: null,
      terminalReason: null,
    };
  }
  return scoped;
}

function scopeSchedule(
  schedule: BoosterExpiryIncidentSchedule,
  frozenAt: number,
): BoosterExpiryIncidentSchedule {
  if (schedule.endedAt !== null && schedule.endedAt > frozenAt) {
    return {
      ...schedule,
      status: "registered",
      endedAt: null,
      outcomeReason: null,
    };
  }
  return schedule;
}

function scopePlaybackAttempt(
  attempt: BoosterExpiryIncidentPlaybackAttempt,
  frozenAt: number,
): BoosterExpiryIncidentPlaybackAttempt {
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
    return { ...attempt, finishedAt: null, status: "failed" };
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
  playback: BoosterExpiryIncidentRelatedPlayback,
  frozenAt: number,
): BoosterExpiryIncidentRelatedPlayback {
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

function scopeFrozenState(
  state: BoosterExpiryIncidentFrozenState,
  archive: BoosterExpiryIncidentEvidenceArchive,
): BoosterExpiryIncidentFrozenState {
  return {
    ...state,
    latestFrameId: retainPointer(
      state.latestFrameId,
      new Set(archive.frames.map((entry) => entry.id)),
    ),
    latestObservationId: retainPointer(
      state.latestObservationId,
      new Set(archive.observations.map((entry) => entry.id)),
    ),
    candidateAttemptId: retainPointer(
      state.candidateAttemptId,
      new Set(archive.candidateAttempts.map((entry) => entry.id)),
    ),
    cycleId: retainPointer(
      state.cycleId,
      new Set(archive.cycles.map((entry) => entry.id)),
    ),
    scheduleId: retainPointer(
      state.scheduleId,
      new Set(archive.schedules.map((entry) => entry.id)),
    ),
    decisionId: retainPointer(
      state.decisionId,
      new Set(archive.decisions.map((entry) => entry.id)),
    ),
    playbackAttemptId: retainPointer(
      state.playbackAttemptId,
      new Set(archive.playbackAttempts.map((entry) => entry.id)),
    ),
  };
}

function getRelatedPlaybackEventAt(
  entry: BoosterExpiryIncidentRelatedPlayback,
): number {
  return (
    entry.finishedAt ??
    entry.failedAt ??
    entry.browserAcceptedAt ??
    entry.requestedAt
  );
}

function createBoundaryPatch(
  state: BoosterExpiryIncidentBoundaryState,
): BoosterExpiryIncidentEvidencePatch & {
  pointers: BoosterExpiryIncidentEvidencePointers;
} {
  const cycleId = state.activeCycle?.id ?? null;
  const latestSchedule =
    state.latestSchedule?.cycleId === cycleId ? state.latestSchedule : null;
  const latestDecision =
    state.latestDecision?.cycleId === cycleId ? state.latestDecision : null;
  const latestPlayback =
    state.latestPlaybackAttempt?.cycleId === cycleId
      ? state.latestPlaybackAttempt
      : null;
  return {
    pointers: {
      currentResetEpochId: state.resetEpoch.id,
      currentConfigurationRevisionId: state.configurationRevision.id,
      currentFlowEpochId: state.flowEpoch.id,
      latestFrameId: state.latestFrame?.id ?? null,
      latestObservationId: state.latestObservation?.id ?? null,
      activeCandidateAttemptId: state.activeCandidateAttempt?.id ?? null,
      activeCycleId: cycleId,
      activeScheduleId: latestSchedule?.id ?? null,
      activeDecisionId: latestDecision?.id ?? null,
      activePlaybackAttemptId: latestPlayback?.id ?? null,
    },
    resetEpochs: [state.resetEpoch],
    configurationRevisions: [state.configurationRevision],
    flowEpochs: [state.flowEpoch],
    frames: state.latestFrame ? [state.latestFrame] : [],
    observations: state.latestObservation ? [state.latestObservation] : [],
    candidateAttempts: state.activeCandidateAttempt
      ? [state.activeCandidateAttempt]
      : [],
    cycles: state.activeCycle ? [state.activeCycle] : [],
    schedules: [state.activeSchedule, latestSchedule].filter(
      (entry): entry is BoosterExpiryIncidentSchedule => entry !== null,
    ),
    decisions: latestDecision ? [latestDecision] : [],
    playbackAttempts: [state.activePlaybackAttempt, latestPlayback].filter(
      (entry): entry is BoosterExpiryIncidentPlaybackAttempt => entry !== null,
    ),
  };
}

function normalizeArchive(
  archive: BoosterExpiryIncidentEvidenceArchive,
): BoosterExpiryIncidentEvidenceArchive {
  return {
    ...archive,
    resetEpochs: archive.resetEpochs.map((entry) => ({
      ...entry,
      sessionId: truncateText(entry.sessionId, 128) ?? "unknown",
      continuity: {
        ...entry.continuity,
        layoutKey: truncateText(entry.continuity.layoutKey, 128) ?? "unknown",
        sourceGeometryRevision:
          truncateText(entry.continuity.sourceGeometryRevision, 128) ??
          "unknown",
      },
    })),
    configurationRevisions: archive.configurationRevisions.map((entry) => ({
      ...entry,
      fingerprint: truncateText(entry.fingerprint, 128) ?? "unknown",
      timingFingerprint:
        truncateText(entry.timingFingerprint, 128) ?? "unknown",
      playbackFingerprint:
        truncateText(entry.playbackFingerprint, 128) ?? "unknown",
      values: {
        ...entry.values,
        soundId: truncateText(entry.values.soundId, 128) ?? "unknown",
      },
    })),
    frames: archive.frames.map((entry) => ({
      ...entry,
      layoutKey: truncateText(entry.layoutKey, 128) ?? "unknown",
      sourceGeometryRevision:
        truncateText(entry.sourceGeometryRevision, 128) ?? "unknown",
      source: entry.source
        ? {
            ...entry.source,
            regionLabel:
              truncateText(entry.source.regionLabel, 128) ?? "unknown",
          }
        : null,
      runtimeFailure: entry.runtimeFailure
        ? {
            ...entry.runtimeFailure,
            code: truncateText(entry.runtimeFailure.code, 128) ?? "unknown",
            technicalMessage: truncateText(
              entry.runtimeFailure.technicalMessage,
            ),
          }
        : null,
    })),
    observations: archive.observations.map((entry) => ({
      ...entry,
      reason: truncateText(entry.reason),
      recognizerVersion: truncateText(entry.recognizerVersion, 128),
      rawTime: normalizeTimerRead(entry.rawTime),
      selectedTime: normalizeTimerRead(entry.selectedTime),
      stateBefore: normalizeRuntimeState(entry.stateBefore),
      stateAfter: normalizeRuntimeState(entry.stateAfter),
    })),
    schedules: archive.schedules.map((entry) => ({
      ...entry,
      outcomeReason: truncateText(entry.outcomeReason),
    })),
    playbackAttempts: archive.playbackAttempts.map((entry) => ({
      ...entry,
      error: truncateText(entry.error),
      soundId: truncateText(entry.soundId, 128) ?? "unknown",
    })),
    lifecycleEvents: archive.lifecycleEvents.map((entry) => {
      const details = JSON.stringify(entry.details);
      return {
        ...entry,
        action: truncateText(entry.action, 128) ?? "unknown",
        details:
          details.length <= BOOSTER_EXPIRY_INCIDENT_EVENT_DETAILS_MAX_CHARS
            ? entry.details
            : {
                omitted: "metadata-cap",
                originalChars: details.length,
              },
      };
    }),
  };
}

function normalizeRuntimeState(
  state: BoosterExpiryIncidentObservation["stateBefore"],
): BoosterExpiryIncidentObservation["stateBefore"] {
  if (!state) return null;
  return {
    ...state,
    status: truncateText(state.status, 128) ?? "unknown",
    decision: truncateText(state.decision, 128) ?? "unknown",
    flowSource: truncateText(state.flowSource, 128),
  };
}

function normalizeTimerRead(
  read: BoosterExpiryIncidentObservation["rawTime"],
): BoosterExpiryIncidentObservation["rawTime"] {
  if (!read) return null;
  return {
    ...read,
    reason: truncateText(read.reason, 128) ?? "unknown",
    text: truncateText(read.text, 64),
    format: truncateText(read.format, 64),
    selectedBy: truncateText(read.selectedBy, 64),
  };
}

function appendNormalizationOmissions(
  original: BoosterExpiryIncidentEvidenceArchive,
  normalized: BoosterExpiryIncidentEvidenceArchive,
  omissions: BoosterExpiryIncidentEvidenceOmission[],
  now: number,
): void {
  const eventIds = normalized.lifecycleEvents
    .filter(
      (entry, index) =>
        JSON.stringify(entry.details) !==
        JSON.stringify(original.lifecycleEvents[index]?.details),
    )
    .map((entry) => entry.id);
  appendDroppedOmission({
    omissions,
    kind: "event",
    reason: "metadata-cap",
    entries: eventIds.map((id) => ({ id })),
    now,
  });
}

function addPointerProtection(
  archive: BoosterExpiryIncidentEvidenceArchive,
  protection: ProtectionSets,
  now: number,
): void {
  addNullable(protection.resetEpochIds, archive.pointers.currentResetEpochId);
  addNullable(
    protection.configurationRevisionIds,
    archive.pointers.currentConfigurationRevisionId,
  );
  addNullable(protection.flowEpochIds, archive.pointers.currentFlowEpochId);

  const candidate = archive.candidateAttempts.find(
    (entry) => entry.id === archive.pointers.activeCandidateAttemptId,
  );
  if (
    candidate &&
    now - candidate.lastObservedAt <= BOOSTER_EXPIRY_INCIDENT_RETENTION_MS
  ) {
    protection.candidateAttemptIds.add(candidate.id);
  }

  const cycle = archive.cycles.find(
    (entry) => entry.id === archive.pointers.activeCycleId,
  );
  if (cycle && isCycleWithinProtectedLifetime(archive, cycle, now)) {
    protection.cycleIds.add(cycle.id);
    addNullable(protection.scheduleIds, archive.pointers.activeScheduleId);
    addNullable(protection.decisionIds, archive.pointers.activeDecisionId);
    addNullable(
      protection.playbackAttemptIds,
      archive.pointers.activePlaybackAttemptId,
    );
  }
}

function isCycleWithinProtectedLifetime(
  archive: BoosterExpiryIncidentEvidenceArchive,
  cycle: BoosterExpiryIncidentConfirmedCycle,
  now: number,
): boolean {
  if (cycle.endedAt !== null) {
    return now <= cycle.endedAt + BOOSTER_EXPIRY_INCIDENT_RETENTION_MS;
  }
  const configuration = archive.configurationRevisions.find(
    (entry) => entry.id === cycle.timingConfigRevisionId,
  );
  const negativeLeadTailMs = Math.max(
    0,
    -(configuration?.values.alertLeadSeconds ?? 0) * 1_000,
  );
  return (
    now <=
    cycle.expiresAt + negativeLeadTailMs + BOOSTER_EXPIRY_INCIDENT_RETENTION_MS
  );
}

function deriveProtectionFromRecords(
  archive: BoosterExpiryIncidentEvidenceArchive,
  protection: ProtectionSets,
): void {
  let changed = true;
  while (changed) {
    const before = getProtectionSize(protection);
    for (const playback of archive.playbackAttempts) {
      if (
        !protection.playbackAttemptIds.has(playback.id) &&
        playback.status !== "requested" &&
        playback.status !== "browser-play-accepted"
      ) {
        continue;
      }
      protection.cycleIds.add(playback.cycleId);
      protection.scheduleIds.add(playback.scheduleId);
      protection.decisionIds.add(playback.decisionId);
      protection.configurationRevisionIds.add(playback.configRevisionId);
      protection.resetEpochIds.add(playback.resetEpochId);
    }
    for (const decision of archive.decisions) {
      if (!protection.decisionIds.has(decision.id)) continue;
      protection.cycleIds.add(decision.cycleId);
      protection.scheduleIds.add(decision.scheduleId);
      protection.configurationRevisionIds.add(decision.timingConfigRevisionId);
      protection.configurationRevisionIds.add(decision.firedConfigRevisionId);
      protection.resetEpochIds.add(decision.resetEpochId);
    }
    for (const schedule of archive.schedules) {
      if (!protection.scheduleIds.has(schedule.id)) continue;
      protection.cycleIds.add(schedule.cycleId);
      protection.configurationRevisionIds.add(schedule.timingConfigRevisionId);
      protection.resetEpochIds.add(schedule.resetEpochId);
    }
    for (const cycle of archive.cycles) {
      if (!protection.cycleIds.has(cycle.id)) continue;
      protection.candidateAttemptIds.add(cycle.candidateAttemptId);
      cycle.observationIds.forEach((id) => protection.observationIds.add(id));
      protection.flowEpochIds.add(cycle.confirmationFlowEpochId);
      protection.configurationRevisionIds.add(cycle.timingConfigRevisionId);
      protection.resetEpochIds.add(cycle.resetEpochId);
    }
    for (const candidate of archive.candidateAttempts) {
      if (!protection.candidateAttemptIds.has(candidate.id)) continue;
      candidate.observationIds.forEach((id) =>
        protection.observationIds.add(id),
      );
      protection.flowEpochIds.add(candidate.flowEpochId);
      protection.resetEpochIds.add(candidate.resetEpochId);
    }
    for (const observation of archive.observations) {
      if (!protection.observationIds.has(observation.id)) continue;
      protection.frameIds.add(observation.frameId);
      protection.flowEpochIds.add(observation.flowEpochId);
      protection.configurationRevisionIds.add(observation.configRevisionId);
      protection.resetEpochIds.add(observation.resetEpochId);
    }
    for (const frame of archive.frames) {
      if (!protection.frameIds.has(frame.id)) continue;
      protection.flowEpochIds.add(frame.flowEpochId);
      protection.configurationRevisionIds.add(frame.configRevisionId);
      protection.resetEpochIds.add(frame.resetEpochId);
    }
    for (const flow of archive.flowEpochs) {
      if (!protection.flowEpochIds.has(flow.id)) continue;
      protection.resetEpochIds.add(flow.resetEpochId);
    }
    for (const configuration of archive.configurationRevisions) {
      if (!protection.configurationRevisionIds.has(configuration.id)) continue;
      protection.resetEpochIds.add(configuration.resetEpochId);
    }
    for (const event of archive.lifecycleEvents) {
      if (!protection.eventIds.has(event.id)) continue;
      protection.resetEpochIds.add(event.resetEpochId);
      addNullable(protection.configurationRevisionIds, event.configRevisionId);
      addNullable(protection.flowEpochIds, event.flowEpochId);
      addNullable(protection.frameIds, event.frameId);
      addNullable(protection.observationIds, event.observationId);
      addNullable(protection.candidateAttemptIds, event.candidateAttemptId);
      addNullable(protection.cycleIds, event.cycleId);
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
  const ordered = mergeById([], items)
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
  const retainedOrdinary = ordinaryEntries.slice(
    Math.max(0, max - retainedProtected.length) === 0
      ? ordinaryEntries.length
      : -Math.max(0, max - retainedProtected.length),
  );
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
  retainedFrameIds,
}: {
  media: BoosterExpiryIncidentMediaFrame[];
  now: number;
  cutoff: number;
  requiredFrameIds: Set<string>;
  retainedFrameIds: Set<string>;
}): {
  media: BoosterExpiryIncidentMediaFrame[];
  omissions: BoosterExpiryIncidentEvidenceOmission[];
} {
  const omissions: BoosterExpiryIncidentEvidenceOmission[] = [];
  const withoutFrame = media.filter(
    (entry) => entry.sampledAt <= now && !retainedFrameIds.has(entry.frameId),
  );
  appendDroppedOmission({
    omissions,
    kind: "media",
    reason: "reset-epoch",
    entries: withoutFrame.map((entry) => ({ id: entry.frameId })),
    now,
  });
  const eligible = media.filter(
    (entry) =>
      entry.sampledAt <= now &&
      retainedFrameIds.has(entry.frameId) &&
      (entry.sampledAt >= cutoff || requiredFrameIds.has(entry.frameId)),
  );
  const outside = media.filter(
    (entry) =>
      entry.sampledAt <= now &&
      retainedFrameIds.has(entry.frameId) &&
      entry.sampledAt < cutoff &&
      !requiredFrameIds.has(entry.frameId),
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
      Number(requiredFrameIds.has(right.frameId)) -
        Number(requiredFrameIds.has(left.frameId)) ||
      getMediaPriority(right.reason) - getMediaPriority(left.reason) ||
      right.sampledAt - left.sampledAt ||
      left.id.localeCompare(right.id),
  );
  const retained: BoosterExpiryIncidentMediaFrame[] = [];
  const oversized: BoosterExpiryIncidentMediaFrame[] = [];
  const overBudget: BoosterExpiryIncidentMediaFrame[] = [];
  let retainedChars = 0;
  for (const entry of ordered) {
    const chars = entry.imageDataUrl.length;
    if (chars > BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_FRAME_CHARS) {
      oversized.push(entry);
      continue;
    }
    if (
      retained.length >= BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_FRAMES ||
      retainedChars + chars > BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_TOTAL_CHARS
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
  archive: BoosterExpiryIncidentEvidenceArchive,
  protection: ProtectionSets,
  now: number,
): BoosterExpiryIncidentEvidenceArchive {
  const next = cloneArchive(archive);
  const droppedEvents: string[] = [];
  const droppedFrames: string[] = [];
  while (
    getBoosterExpiryIncidentEvidenceMetadataChars(next) >
      BOOSTER_EXPIRY_INCIDENT_METADATA_MAX_CHARS &&
    next.lifecycleEvents.length > 0
  ) {
    const index = next.lifecycleEvents.findIndex(
      (entry) => !protection.eventIds.has(entry.id),
    );
    if (index < 0) break;
    const [removed] = next.lifecycleEvents.splice(index, 1);
    if (removed) droppedEvents.push(removed.id);
  }
  while (
    getBoosterExpiryIncidentEvidenceMetadataChars(next) >
      BOOSTER_EXPIRY_INCIDENT_METADATA_MAX_CHARS &&
    next.frames.length > 0
  ) {
    const index = next.frames.findIndex(
      (entry) => !protection.frameIds.has(entry.id),
    );
    if (index < 0) break;
    const [removed] = next.frames.splice(index, 1);
    if (!removed) break;
    droppedFrames.push(removed.id);
    next.observations = next.observations.filter(
      (entry) => entry.frameId !== removed.id,
    );
    next.media = next.media.filter((entry) => entry.frameId !== removed.id);
  }
  appendDroppedOmission({
    omissions: next.omissions,
    kind: "event",
    reason: "metadata-cap",
    entries: droppedEvents.map((id) => ({ id })),
    now,
  });
  appendDroppedOmission({
    omissions: next.omissions,
    kind: "frame",
    reason: "metadata-cap",
    entries: droppedFrames.map((id) => ({ id })),
    now,
  });
  next.omissions = compactOmissions(next.omissions);
  while (
    getBoosterExpiryIncidentEvidenceMetadataChars(next) >
      BOOSTER_EXPIRY_INCIDENT_METADATA_MAX_CHARS &&
    next.omissions.length > 1
  ) {
    next.omissions = next.omissions.slice(1);
  }
  return next;
}

function enforceRequestBudget(
  archive: BoosterExpiryIncidentEvidenceArchive,
  protection: ProtectionSets,
  now: number,
): BoosterExpiryIncidentEvidenceArchive {
  const next = cloneArchive(archive);
  const droppedMedia: string[] = [];
  while (
    getBoosterExpiryIncidentEvidenceRequestBytes(next) >
      BOOSTER_EXPIRY_INCIDENT_REPORT_REQUEST_TARGET_BYTES &&
    next.media.length > 0
  ) {
    const ordered = [...next.media].sort(
      (left, right) =>
        Number(protection.mediaFrameIds.has(left.frameId)) -
          Number(protection.mediaFrameIds.has(right.frameId)) ||
        Number(protection.frameIds.has(left.frameId)) -
          Number(protection.frameIds.has(right.frameId)) ||
        getMediaPriority(left.reason) - getMediaPriority(right.reason) ||
        left.sampledAt - right.sampledAt,
    );
    const removable = ordered[0];
    if (!removable) break;
    next.media = next.media.filter((entry) => entry.id !== removable.id);
    droppedMedia.push(removable.frameId);
  }
  appendDroppedOmission({
    omissions: next.omissions,
    kind: "media",
    reason: "payload-compacted",
    entries: droppedMedia.map((id) => ({ id })),
    now,
  });
  next.omissions = compactOmissions(next.omissions);
  return next;
}

function compactPointers(
  pointers: BoosterExpiryIncidentEvidencePointers,
  ids: {
    resetEpochIds: Set<string>;
    configurationRevisionIds: Set<string>;
    flowEpochIds: Set<string>;
    frameIds: Set<string>;
    observationIds: Set<string>;
    candidateIds: Set<string>;
    cycleIds: Set<string>;
    scheduleIds: Set<string>;
    decisionIds: Set<string>;
    playbackIds: Set<string>;
  },
): BoosterExpiryIncidentEvidencePointers {
  return {
    currentResetEpochId: retainPointer(
      pointers.currentResetEpochId,
      ids.resetEpochIds,
    ),
    currentConfigurationRevisionId: retainPointer(
      pointers.currentConfigurationRevisionId,
      ids.configurationRevisionIds,
    ),
    currentFlowEpochId: retainPointer(
      pointers.currentFlowEpochId,
      ids.flowEpochIds,
    ),
    latestFrameId: retainPointer(pointers.latestFrameId, ids.frameIds),
    latestObservationId: retainPointer(
      pointers.latestObservationId,
      ids.observationIds,
    ),
    activeCandidateAttemptId: retainPointer(
      pointers.activeCandidateAttemptId,
      ids.candidateIds,
    ),
    activeCycleId: retainPointer(pointers.activeCycleId, ids.cycleIds),
    activeScheduleId: retainPointer(pointers.activeScheduleId, ids.scheduleIds),
    activeDecisionId: retainPointer(pointers.activeDecisionId, ids.decisionIds),
    activePlaybackAttemptId: retainPointer(
      pointers.activePlaybackAttemptId,
      ids.playbackIds,
    ),
  };
}

function eventReferencesRetainedChain(
  event: BoosterExpiryIncidentLifecycleEvent,
  ids: {
    observationIds: Set<string>;
    candidateIds: Set<string>;
    cycleIds: Set<string>;
    scheduleIds: Set<string>;
    decisionIds: Set<string>;
    playbackIds: Set<string>;
  },
): boolean {
  return (
    hasNullable(ids.observationIds, event.observationId) ||
    hasNullable(ids.candidateIds, event.candidateAttemptId) ||
    hasNullable(ids.cycleIds, event.cycleId) ||
    hasNullable(ids.scheduleIds, event.scheduleId) ||
    hasNullable(ids.decisionIds, event.decisionId) ||
    hasNullable(ids.playbackIds, event.playbackAttemptId)
  );
}

function appendSelectionOmissions<T extends { id: string }>(
  omissions: BoosterExpiryIncidentEvidenceOmission[],
  kind: BoosterExpiryIncidentEvidenceOmission["kind"],
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

function appendDependencyDropOmissions<T extends { id: string }>({
  original,
  retained,
  kind,
  omissions,
  now,
}: {
  original: T[];
  retained: T[];
  kind: BoosterExpiryIncidentEvidenceOmission["kind"];
  omissions: BoosterExpiryIncidentEvidenceOmission[];
  now: number;
}): void {
  const retainedIds = new Set(retained.map((entry) => entry.id));
  appendDroppedOmission({
    omissions,
    kind,
    reason: "reset-epoch",
    entries: original.filter((entry) => !retainedIds.has(entry.id)),
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
  omissions: BoosterExpiryIncidentEvidenceOmission[];
  kind: BoosterExpiryIncidentEvidenceOmission["kind"];
  reason: BoosterExpiryIncidentEvidenceOmissionReason;
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
  kind: BoosterExpiryIncidentEvidenceOmission["kind"];
  reason: BoosterExpiryIncidentEvidenceOmissionReason;
  subjectIds: string[];
  count: number;
  now: number;
}): BoosterExpiryIncidentEvidenceOmission {
  const boundedIds = [...new Set(subjectIds)].sort().slice(0, 16);
  return {
    id: `booster-expiry-omission:${kind}:${reason}:${now}:${hashToken(
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
  omissions: BoosterExpiryIncidentEvidenceOmission[],
): BoosterExpiryIncidentEvidenceOmission[] {
  return mergeById([], omissions)
    .sort(compareByTimeAndId((entry) => entry.occurredAt))
    .slice(-BOOSTER_EXPIRY_INCIDENT_MAX_OMISSIONS);
}

function createProtectionSets(
  protection?: BoosterExpiryIncidentEvidenceProtection,
): ProtectionSets {
  return {
    resetEpochIds: new Set(protection?.resetEpochIds),
    configurationRevisionIds: new Set(protection?.configurationRevisionIds),
    flowEpochIds: new Set(protection?.flowEpochIds),
    frameIds: new Set(protection?.frameIds),
    observationIds: new Set(protection?.observationIds),
    candidateAttemptIds: new Set(protection?.candidateAttemptIds),
    cycleIds: new Set(protection?.cycleIds),
    scheduleIds: new Set(protection?.scheduleIds),
    decisionIds: new Set(protection?.decisionIds),
    playbackAttemptIds: new Set(protection?.playbackAttemptIds),
    eventIds: new Set(protection?.eventIds),
    mediaFrameIds: new Set(protection?.mediaFrameIds),
  };
}

function getProtectionSize(protection: ProtectionSets): number {
  return Object.values(protection).reduce(
    (total, entries) => total + entries.size,
    0,
  );
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
  current: BoosterExpiryIncidentMediaFrame[],
  patch: BoosterExpiryIncidentMediaFrame[] | undefined,
): BoosterExpiryIncidentMediaFrame[] {
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

function getMediaPriority(reason: BoosterExpiryIncidentMediaReason): number {
  switch (reason) {
    case "playback-failed":
      return 100;
    case "alert-decision":
      return 90;
    case "cycle-confirmation":
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

function getPlaybackEventAt(
  entry: BoosterExpiryIncidentPlaybackAttempt,
): number {
  return (
    entry.finishedAt ??
    entry.failedAt ??
    entry.browserAcceptedAt ??
    entry.requestedAt
  );
}

function retainPointer(
  id: string | null,
  retained: Set<string>,
): string | null {
  return id !== null && retained.has(id) ? id : null;
}

function hasNullable(ids: Set<string>, id: string | null): boolean {
  return id !== null && ids.has(id);
}

function addNullable(ids: Set<string>, id: string | null): void {
  if (id !== null) ids.add(id);
}

function compareByTimeAndId<T>(
  getTime: (entry: T) => number,
): (left: T & { id: string }, right: T & { id: string }) => number {
  return (left, right) =>
    getTime(left) - getTime(right) || left.id.localeCompare(right.id);
}

function truncateText(value: string | null, max = 256): string | null {
  if (value === null || value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

function hashToken(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cloneArchive(
  archive: BoosterExpiryIncidentEvidenceArchive,
): BoosterExpiryIncidentEvidenceArchive {
  return {
    ...archive,
    pointers: { ...archive.pointers },
    resetEpochs: [...archive.resetEpochs],
    configurationRevisions: [...archive.configurationRevisions],
    flowEpochs: [...archive.flowEpochs],
    frames: [...archive.frames],
    observations: [...archive.observations],
    candidateAttempts: [...archive.candidateAttempts],
    cycles: [...archive.cycles],
    schedules: [...archive.schedules],
    decisions: [...archive.decisions],
    playbackAttempts: [...archive.playbackAttempts],
    lifecycleEvents: [...archive.lifecycleEvents],
    media: [...archive.media],
    omissions: [...archive.omissions],
  };
}

function cloneEvidence<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function pruneDanglingEvidence(
  archive: BoosterExpiryIncidentEvidenceArchive,
): BoosterExpiryIncidentEvidenceArchive {
  const resetEpochIds = new Set(archive.resetEpochs.map((entry) => entry.id));
  const configurationRevisionIds = new Set(
    archive.configurationRevisions.map((entry) => entry.id),
  );
  const flowEpochIds = new Set(archive.flowEpochs.map((entry) => entry.id));
  const frames = archive.frames.filter(
    (entry) =>
      resetEpochIds.has(entry.resetEpochId) &&
      configurationRevisionIds.has(entry.configRevisionId) &&
      flowEpochIds.has(entry.flowEpochId),
  );
  const frameIds = new Set(frames.map((entry) => entry.id));
  const observations = archive.observations.filter(
    (entry) =>
      frameIds.has(entry.frameId) &&
      configurationRevisionIds.has(entry.configRevisionId) &&
      flowEpochIds.has(entry.flowEpochId),
  );
  const observationIds = new Set(observations.map((entry) => entry.id));
  const candidateAttempts = archive.candidateAttempts.filter(
    (entry) =>
      resetEpochIds.has(entry.resetEpochId) &&
      flowEpochIds.has(entry.flowEpochId) &&
      entry.observationIds.some((id) => observationIds.has(id)),
  );
  const candidateIds = new Set(candidateAttempts.map((entry) => entry.id));
  const cycles = archive.cycles.filter(
    (entry) =>
      resetEpochIds.has(entry.resetEpochId) &&
      candidateIds.has(entry.candidateAttemptId) &&
      entry.observationIds.every((id) => observationIds.has(id)) &&
      configurationRevisionIds.has(entry.timingConfigRevisionId) &&
      flowEpochIds.has(entry.confirmationFlowEpochId),
  );
  const cycleIds = new Set(cycles.map((entry) => entry.id));
  const schedules = archive.schedules.filter(
    (entry) =>
      cycleIds.has(entry.cycleId) &&
      configurationRevisionIds.has(entry.timingConfigRevisionId),
  );
  const scheduleIds = new Set(schedules.map((entry) => entry.id));
  const decisions = archive.decisions.filter(
    (entry) =>
      cycleIds.has(entry.cycleId) &&
      scheduleIds.has(entry.scheduleId) &&
      configurationRevisionIds.has(entry.timingConfigRevisionId) &&
      configurationRevisionIds.has(entry.firedConfigRevisionId),
  );
  const decisionIds = new Set(decisions.map((entry) => entry.id));
  const playbackAttempts = archive.playbackAttempts.filter(
    (entry) =>
      cycleIds.has(entry.cycleId) &&
      scheduleIds.has(entry.scheduleId) &&
      decisionIds.has(entry.decisionId) &&
      configurationRevisionIds.has(entry.configRevisionId),
  );
  const playbackIds = new Set(playbackAttempts.map((entry) => entry.id));
  return {
    ...archive,
    pointers: compactPointers(archive.pointers, {
      resetEpochIds,
      configurationRevisionIds,
      flowEpochIds,
      frameIds,
      observationIds,
      candidateIds,
      cycleIds,
      scheduleIds,
      decisionIds,
      playbackIds,
    }),
    frames,
    observations,
    candidateAttempts,
    cycles,
    schedules,
    decisions,
    playbackAttempts,
    lifecycleEvents: archive.lifecycleEvents.filter(
      (entry) =>
        resetEpochIds.has(entry.resetEpochId) &&
        (entry.configRevisionId === null ||
          configurationRevisionIds.has(entry.configRevisionId)) &&
        (entry.flowEpochId === null || flowEpochIds.has(entry.flowEpochId)) &&
        (entry.frameId === null || frameIds.has(entry.frameId)) &&
        (entry.observationId === null ||
          observationIds.has(entry.observationId)) &&
        (entry.candidateAttemptId === null ||
          candidateIds.has(entry.candidateAttemptId)) &&
        (entry.cycleId === null || cycleIds.has(entry.cycleId)) &&
        (entry.scheduleId === null || scheduleIds.has(entry.scheduleId)) &&
        (entry.decisionId === null || decisionIds.has(entry.decisionId)) &&
        (entry.playbackAttemptId === null ||
          playbackIds.has(entry.playbackAttemptId)),
    ),
    media: archive.media.filter((entry) => frameIds.has(entry.frameId)),
  };
}
