import { RUNTIME_EVIDENCE_ROLLING_MEDIA_BUDGET_CHARS } from "../../../contracts/reporting/runtimeEvidenceMediaPolicy";
import {
  HUNT_STALL_INCIDENT_EVIDENCE_SCHEMA_VERSION,
  type FrozenHuntStallIncidentEvidence,
  type HuntStallIncidentActivityEpoch,
  type HuntStallIncidentAlertCycle,
  type HuntStallIncidentAlertDecision,
  type HuntStallIncidentConfigurationRevision,
  type HuntStallIncidentEvidenceArchive,
  type HuntStallIncidentEvidenceOmission,
  type HuntStallIncidentEvidenceOmissionReason,
  type HuntStallIncidentFrame,
  type HuntStallIncidentLifecycleEvent,
  type HuntStallIncidentMediaFrame,
  type HuntStallIncidentMediaReason,
  type HuntStallIncidentObservation,
  type HuntStallIncidentPlaybackAttempt,
  type HuntStallIncidentFrozenState,
  type HuntStallIncidentRelatedPlayback,
  type HuntStallIncidentReportLease,
  type HuntStallIncidentResetEpoch,
  type HuntStallIncidentStallEpisode,
} from "./huntStallIncidentEvidenceTypes";

export const HUNT_STALL_INCIDENT_RETENTION_MS = 60_000;
export const HUNT_STALL_INCIDENT_CURRENT_WINDOW_MS = 10_000;
export const HUNT_STALL_INCIDENT_MAX_RESET_EPOCHS = 8;
export const HUNT_STALL_INCIDENT_MAX_CONFIGURATION_REVISIONS = 32;
export const HUNT_STALL_INCIDENT_MAX_FRAMES = 72;
export const HUNT_STALL_INCIDENT_MAX_OBSERVATIONS = 72;
export const HUNT_STALL_INCIDENT_MAX_ACTIVITY_EPOCHS = 64;
export const HUNT_STALL_INCIDENT_MAX_STALL_EPISODES = 64;
export const HUNT_STALL_INCIDENT_MAX_ALERT_CYCLES = 64;
export const HUNT_STALL_INCIDENT_MAX_DECISIONS = 64;
export const HUNT_STALL_INCIDENT_MAX_PLAYBACK_ATTEMPTS = 64;
export const HUNT_STALL_INCIDENT_MAX_LIFECYCLE_EVENTS = 128;
export const HUNT_STALL_INCIDENT_MAX_OMISSIONS = 64;
export const HUNT_STALL_INCIDENT_MAX_RELATED_PLAYBACK = 16;
export const HUNT_STALL_INCIDENT_EVENT_DETAILS_MAX_CHARS = 256;
export const HUNT_STALL_INCIDENT_METADATA_MAX_CHARS = 256 * 1024;
export const HUNT_STALL_INCIDENT_MEDIA_MAX_FRAMES = 8;
export const HUNT_STALL_INCIDENT_MEDIA_MAX_FRAME_CHARS = 256_000;
export const HUNT_STALL_INCIDENT_MEDIA_MAX_TOTAL_CHARS =
  RUNTIME_EVIDENCE_ROLLING_MEDIA_BUDGET_CHARS.huntStall;
export const HUNT_STALL_INCIDENT_REPORT_REQUEST_TARGET_BYTES = 2 * 1024 * 1024;

export type HuntStallIncidentEvidencePatch = {
  currentResetEpochId?: string | null;
  currentConfigurationRevisionId?: string | null;
  resetEpochs?: HuntStallIncidentResetEpoch[];
  configurationRevisions?: HuntStallIncidentConfigurationRevision[];
  frames?: HuntStallIncidentFrame[];
  observations?: HuntStallIncidentObservation[];
  activityEpochs?: HuntStallIncidentActivityEpoch[];
  stallEpisodes?: HuntStallIncidentStallEpisode[];
  alertCycles?: HuntStallIncidentAlertCycle[];
  decisions?: HuntStallIncidentAlertDecision[];
  playbackAttempts?: HuntStallIncidentPlaybackAttempt[];
  lifecycleEvents?: HuntStallIncidentLifecycleEvent[];
  media?: HuntStallIncidentMediaFrame[];
  omissions?: HuntStallIncidentEvidenceOmission[];
};

export type HuntStallIncidentEvidenceProtection = {
  resetEpochIds?: string[];
  configurationRevisionIds?: string[];
  frameIds?: string[];
  observationIds?: string[];
  activityEpochIds?: string[];
  stallEpisodeIds?: string[];
  cycleIds?: string[];
  decisionIds?: string[];
  attemptIds?: string[];
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
  activityEpochIds: Set<string>;
  stallEpisodeIds: Set<string>;
  cycleIds: Set<string>;
  decisionIds: Set<string>;
  attemptIds: Set<string>;
  eventIds: Set<string>;
  mediaFrameIds: Set<string>;
};

export function createHuntStallIncidentEvidenceArchive(
  now = Date.now(),
): HuntStallIncidentEvidenceArchive {
  return {
    schemaVersion: HUNT_STALL_INCIDENT_EVIDENCE_SCHEMA_VERSION,
    updatedAt: now,
    currentResetEpochId: null,
    currentConfigurationRevisionId: null,
    resetEpochs: [],
    configurationRevisions: [],
    frames: [],
    observations: [],
    activityEpochs: [],
    stallEpisodes: [],
    alertCycles: [],
    decisions: [],
    playbackAttempts: [],
    lifecycleEvents: [],
    media: [],
    omissions: [],
  };
}

export function freezeHuntStallIncidentEvidence({
  archive,
  lease,
  frozenState = null,
  relatedPlayback = [],
}: {
  archive: HuntStallIncidentEvidenceArchive;
  lease: HuntStallIncidentReportLease;
  frozenState?: HuntStallIncidentFrozenState | null;
  relatedPlayback?: HuntStallIncidentRelatedPlayback[];
}): FrozenHuntStallIncidentEvidence {
  const protection = createLeaseProtection(archive, lease);
  const compacted = compactHuntStallIncidentEvidenceArchive({
    archive,
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
      frozenState.configRevisionId === lease.configRevisionId &&
      frozenState.mode === lease.mode
        ? frozenState
        : null,
    relatedPlayback: relatedPlayback
      .filter(
        (entry) =>
          entry.requestedAt <= lease.frozenAt &&
          (entry.finishedAt ??
            entry.failedAt ??
            entry.startedAt ??
            entry.requestedAt) >=
            lease.frozenAt - HUNT_STALL_INCIDENT_RETENTION_MS,
      )
      .sort(
        (left, right) =>
          getRelatedPlaybackEventAt(left) - getRelatedPlaybackEventAt(right) ||
          left.id.localeCompare(right.id),
      )
      .slice(-HUNT_STALL_INCIDENT_MAX_RELATED_PLAYBACK),
  });
}

function createLeaseProtection(
  archive: HuntStallIncidentEvidenceArchive,
  lease: HuntStallIncidentReportLease,
): HuntStallIncidentEvidenceProtection {
  const frameIds = new Set<string>();
  const observationIds = new Set<string>();
  const decisionIds = new Set<string>();
  const eventIds = new Set<string>();
  const mediaFrameIds = new Set<string>();

  const eligibleFrames = archive.frames.filter(
    (entry) =>
      entry.resetEpochId === lease.resetEpochId &&
      entry.sequence <= lease.leasedThroughFrameSequence &&
      entry.sampledAt <= lease.frozenAt,
  );
  const latestFrame = [...eligibleFrames].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.sampledAt - right.sampledAt ||
      left.id.localeCompare(right.id),
  )[eligibleFrames.length - 1];
  if (latestFrame) frameIds.add(latestFrame.id);

  if (lease.activityEpochId) {
    const activity = archive.activityEpochs.find(
      (entry) => entry.id === lease.activityEpochId,
    );
    if (activity) {
      frameIds.add(activity.anchorFrameId);
      observationIds.add(activity.anchorObservationId);
    }
  }
  if (lease.alertCycleId) {
    const cycle = archive.alertCycles.find(
      (entry) => entry.id === lease.alertCycleId,
    );
    if (cycle) decisionIds.add(cycle.initialDecisionId);
  }
  if (lease.playbackAttemptId) {
    const attempt = archive.playbackAttempts.find(
      (entry) => entry.id === lease.playbackAttemptId,
    );
    if (attempt) decisionIds.add(attempt.decisionId);
  }
  for (const decision of archive.decisions) {
    if (!decisionIds.has(decision.id)) continue;
    frameIds.add(decision.frameId);
    observationIds.add(decision.observationId);
  }
  for (const event of archive.lifecycleEvents) {
    if (event.occurredAt > lease.frozenAt) continue;
    if (
      event.resetEpochId === lease.resetEpochId &&
      ((lease.activityEpochId !== null &&
        event.activityEpochId === lease.activityEpochId) ||
        (lease.stallEpisodeId !== null &&
          event.stallEpisodeId === lease.stallEpisodeId) ||
        (lease.alertCycleId !== null && event.cycleId === lease.alertCycleId) ||
        (lease.playbackAttemptId !== null &&
          event.attemptId === lease.playbackAttemptId))
    ) {
      eventIds.add(event.id);
    }
  }
  for (const frameId of frameIds) mediaFrameIds.add(frameId);

  return {
    resetEpochIds: [lease.resetEpochId],
    configurationRevisionIds: [lease.configRevisionId],
    frameIds: [...frameIds],
    observationIds: [...observationIds],
    activityEpochIds: lease.activityEpochId ? [lease.activityEpochId] : [],
    stallEpisodeIds: lease.stallEpisodeId ? [lease.stallEpisodeId] : [],
    cycleIds: lease.alertCycleId ? [lease.alertCycleId] : [],
    decisionIds: [...decisionIds],
    attemptIds: lease.playbackAttemptId ? [lease.playbackAttemptId] : [],
    eventIds: [...eventIds],
    mediaFrameIds: [...mediaFrameIds],
  };
}

export function updateHuntStallIncidentEvidenceArchive({
  previous,
  patch,
  now,
  protection,
}: {
  previous: HuntStallIncidentEvidenceArchive | null | undefined;
  patch: HuntStallIncidentEvidencePatch;
  now: number;
  protection?: HuntStallIncidentEvidenceProtection;
}): HuntStallIncidentEvidenceArchive {
  const base = previous ?? createHuntStallIncidentEvidenceArchive(now);
  return compactHuntStallIncidentEvidenceArchive({
    archive: {
      ...base,
      updatedAt: now,
      currentResetEpochId:
        patch.currentResetEpochId === undefined
          ? base.currentResetEpochId
          : patch.currentResetEpochId,
      currentConfigurationRevisionId:
        patch.currentConfigurationRevisionId === undefined
          ? base.currentConfigurationRevisionId
          : patch.currentConfigurationRevisionId,
      resetEpochs: mergeById(base.resetEpochs, patch.resetEpochs),
      configurationRevisions: mergeById(
        base.configurationRevisions,
        patch.configurationRevisions,
      ),
      frames: mergeById(base.frames, patch.frames),
      observations: mergeById(base.observations, patch.observations),
      activityEpochs: mergeById(base.activityEpochs, patch.activityEpochs),
      stallEpisodes: mergeById(base.stallEpisodes, patch.stallEpisodes),
      alertCycles: mergeById(base.alertCycles, patch.alertCycles),
      decisions: mergeById(base.decisions, patch.decisions),
      playbackAttempts: mergeById(
        base.playbackAttempts,
        patch.playbackAttempts,
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

export function compactHuntStallIncidentEvidenceArchive({
  archive,
  now,
  protection,
}: {
  archive: HuntStallIncidentEvidenceArchive;
  now: number;
  protection?: HuntStallIncidentEvidenceProtection;
}): HuntStallIncidentEvidenceArchive {
  const cutoff = now - HUNT_STALL_INCIDENT_RETENTION_MS;
  const protectedIds = createProtectionSets(protection);
  if (archive.currentResetEpochId) {
    protectedIds.resetEpochIds.add(archive.currentResetEpochId);
  }
  if (archive.currentConfigurationRevisionId) {
    protectedIds.configurationRevisionIds.add(
      archive.currentConfigurationRevisionId,
    );
  }
  deriveProtectionFromRecords(archive, protectedIds);
  const omissions = archive.omissions.filter(
    (entry) => entry.occurredAt >= cutoff && entry.occurredAt <= now,
  );

  const cycleSelection = selectRecords({
    items: archive.alertCycles,
    now,
    cutoff,
    max: HUNT_STALL_INCIDENT_MAX_ALERT_CYCLES,
    getTime: (entry) => entry.endedAt ?? entry.startedAt,
    isProtected: (entry) =>
      entry.status === "active" || protectedIds.cycleIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "cycle", cycleSelection, now);
  const alertCycles = cycleSelection.retained;
  const retainedCycleIds = new Set(alertCycles.map((entry) => entry.id));
  const activeCycleIds = new Set(
    alertCycles
      .filter((entry) => entry.status === "active")
      .map((entry) => entry.id),
  );
  const latestAttemptIds = findLatestAttemptIds(
    archive.playbackAttempts,
    activeCycleIds,
  );
  const latestAttemptDecisionIds = new Set(
    archive.playbackAttempts
      .filter((entry) => latestAttemptIds.has(entry.id))
      .map((entry) => entry.decisionId),
  );

  const initialDecisionIds = new Set(
    alertCycles.map((entry) => entry.initialDecisionId),
  );
  const decisionSelection = selectRecords({
    items: archive.decisions.filter((entry) =>
      retainedCycleIds.has(entry.cycleId),
    ),
    now,
    cutoff,
    max: HUNT_STALL_INCIDENT_MAX_DECISIONS,
    getTime: (entry) => entry.occurredAt,
    isProtected: (entry) =>
      initialDecisionIds.has(entry.id) ||
      latestAttemptDecisionIds.has(entry.id) ||
      protectedIds.decisionIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "decision", decisionSelection, now);
  const decisions = decisionSelection.retained;
  const retainedDecisionIds = new Set(decisions.map((entry) => entry.id));

  const attemptSelection = selectRecords({
    items: archive.playbackAttempts.filter(
      (entry) =>
        retainedCycleIds.has(entry.cycleId) &&
        (retainedDecisionIds.has(entry.decisionId) ||
          protectedIds.attemptIds.has(entry.id) ||
          latestAttemptIds.has(entry.id) ||
          entry.status === "requested" ||
          entry.status === "started"),
    ),
    now,
    cutoff,
    max: HUNT_STALL_INCIDENT_MAX_PLAYBACK_ATTEMPTS,
    getTime: (entry) =>
      entry.finishedAt ?? entry.failedAt ?? entry.startedAt ?? entry.requestedAt,
    isProtected: (entry) =>
      entry.status === "requested" ||
      entry.status === "started" ||
      latestAttemptIds.has(entry.id) ||
      protectedIds.attemptIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "attempt", attemptSelection, now);
  const playbackAttempts = attemptSelection.retained;

  const cycleEpisodeIds = new Set(
    alertCycles.map((entry) => entry.stallEpisodeId),
  );
  const episodeSelection = selectRecords({
    items: archive.stallEpisodes,
    now,
    cutoff,
    max: HUNT_STALL_INCIDENT_MAX_STALL_EPISODES,
    getTime: (entry) => entry.endedAt ?? entry.startedAt,
    isProtected: (entry) =>
      entry.status !== "terminal" ||
      cycleEpisodeIds.has(entry.id) ||
      protectedIds.stallEpisodeIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "stall-episode", episodeSelection, now);
  const stallEpisodes = episodeSelection.retained;

  const episodeActivityIds = new Set(
    stallEpisodes.map((entry) => entry.activityEpochId),
  );
  const activitySelection = selectRecords({
    items: archive.activityEpochs,
    now,
    cutoff,
    max: HUNT_STALL_INCIDENT_MAX_ACTIVITY_EPOCHS,
    getTime: (entry) => entry.endedAt ?? entry.startedAt,
    isProtected: (entry) =>
      entry.endedAt === null ||
      episodeActivityIds.has(entry.id) ||
      protectedIds.activityEpochIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "activity-epoch", activitySelection, now);
  const activityEpochs = activitySelection.retained;

  const requiredFrameIds = new Set(protectedIds.frameIds);
  const requiredObservationIds = new Set(protectedIds.observationIds);
  for (const activity of activityEpochs) {
    requiredFrameIds.add(activity.anchorFrameId);
    requiredObservationIds.add(activity.anchorObservationId);
  }
  for (const decision of decisions) {
    requiredFrameIds.add(decision.frameId);
    requiredObservationIds.add(decision.observationId);
  }
  for (const frameId of protectedIds.mediaFrameIds) {
    requiredFrameIds.add(frameId);
  }

  const frameSelection = selectRecords({
    items: archive.frames,
    now,
    cutoff,
    max: HUNT_STALL_INCIDENT_MAX_FRAMES,
    getTime: (entry) => entry.sampledAt,
    isProtected: (entry) => requiredFrameIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "frame", frameSelection, now);
  const frames = frameSelection.retained;
  const retainedFrameIds = new Set(frames.map((entry) => entry.id));

  const observationSelection = selectRecords({
    items: archive.observations.filter((entry) =>
      retainedFrameIds.has(entry.frameId),
    ),
    now,
    cutoff,
    max: HUNT_STALL_INCIDENT_MAX_OBSERVATIONS,
    getTime: (entry) => entry.sampledAt,
    isProtected: (entry) => requiredObservationIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "observation", observationSelection, now);
  const observations = observationSelection.retained;

  const normalizedEvents = normalizeLifecycleEvents(archive.lifecycleEvents);
  if (normalizedEvents.truncatedIds.length > 0) {
    omissions.push(
      createOmission({
        kind: "event",
        reason: "metadata-cap",
        subjectIds: normalizedEvents.truncatedIds,
        count: normalizedEvents.truncatedIds.length,
        now,
      }),
    );
  }
  const eventSelection = selectRecords({
    items: normalizedEvents.events,
    now,
    cutoff,
    max: HUNT_STALL_INCIDENT_MAX_LIFECYCLE_EVENTS,
    getTime: (entry) => entry.occurredAt,
    isProtected: (entry) => protectedIds.eventIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "event", eventSelection, now);
  const lifecycleEvents = eventSelection.retained;

  const referencedResetEpochIds = new Set<string>();
  if (archive.currentResetEpochId) {
    referencedResetEpochIds.add(archive.currentResetEpochId);
  }
  for (const entry of [
    ...frames,
    ...observations,
    ...activityEpochs,
    ...stallEpisodes,
    ...alertCycles,
    ...decisions,
    ...playbackAttempts,
    ...lifecycleEvents,
  ]) {
    referencedResetEpochIds.add(entry.resetEpochId);
  }
  const resetSelection = selectRecords({
    items: archive.resetEpochs,
    now,
    cutoff,
    max: HUNT_STALL_INCIDENT_MAX_RESET_EPOCHS,
    getTime: (entry) =>
      entry.id === archive.currentResetEpochId ||
      protectedIds.resetEpochIds.has(entry.id)
        ? now
        : entry.startedAt,
    isProtected: (entry) =>
      referencedResetEpochIds.has(entry.id) ||
      protectedIds.resetEpochIds.has(entry.id),
  });
  appendSelectionOmissions(omissions, "reset-epoch", resetSelection, now);
  const resetEpochs = resetSelection.retained;
  const retainedResetEpochIds = new Set(resetEpochs.map((entry) => entry.id));

  const scopedFrames = frames.filter((entry) =>
    retainedResetEpochIds.has(entry.resetEpochId),
  );
  const scopedFrameIds = new Set(scopedFrames.map((entry) => entry.id));
  const scopedObservations = observations.filter(
    (entry) =>
      retainedResetEpochIds.has(entry.resetEpochId) &&
      scopedFrameIds.has(entry.frameId),
  );
  const scopedActivityEpochs = activityEpochs.filter((entry) =>
    retainedResetEpochIds.has(entry.resetEpochId),
  );
  const scopedActivityEpochIds = new Set(
    scopedActivityEpochs.map((entry) => entry.id),
  );
  const scopedStallEpisodes = stallEpisodes.filter(
    (entry) =>
      retainedResetEpochIds.has(entry.resetEpochId) &&
      scopedActivityEpochIds.has(entry.activityEpochId),
  );
  const scopedStallEpisodeIds = new Set(
    scopedStallEpisodes.map((entry) => entry.id),
  );
  const scopedAlertCycles = alertCycles.filter(
    (entry) =>
      retainedResetEpochIds.has(entry.resetEpochId) &&
      scopedActivityEpochIds.has(entry.activityEpochId) &&
      scopedStallEpisodeIds.has(entry.stallEpisodeId),
  );
  const scopedCycleIds = new Set(scopedAlertCycles.map((entry) => entry.id));
  const scopedDecisions = decisions.filter(
    (entry) =>
      retainedResetEpochIds.has(entry.resetEpochId) &&
      scopedCycleIds.has(entry.cycleId) &&
      scopedFrameIds.has(entry.frameId),
  );
  const scopedDecisionIds = new Set(scopedDecisions.map((entry) => entry.id));
  const scopedPlaybackAttempts = playbackAttempts.filter(
    (entry) =>
      retainedResetEpochIds.has(entry.resetEpochId) &&
      scopedCycleIds.has(entry.cycleId) &&
      scopedDecisionIds.has(entry.decisionId),
  );
  const scopedLifecycleEvents = lifecycleEvents.filter((entry) =>
    retainedResetEpochIds.has(entry.resetEpochId),
  );

  const configurationLastReferenceAt = new Map<string, number>();
  for (const frame of scopedFrames) {
    recordLatestReference(
      configurationLastReferenceAt,
      frame.configRevisionId,
      frame.sampledAt,
    );
  }
  for (const decision of scopedDecisions) {
    recordLatestReference(
      configurationLastReferenceAt,
      decision.configRevisionId,
      decision.occurredAt,
    );
  }
  for (const attempt of scopedPlaybackAttempts) {
    recordLatestReference(
      configurationLastReferenceAt,
      attempt.configRevisionId,
      attempt.finishedAt ??
        attempt.failedAt ??
        attempt.startedAt ??
        attempt.requestedAt,
    );
  }
  for (const event of scopedLifecycleEvents) {
    if (event.configRevisionId) {
      recordLatestReference(
        configurationLastReferenceAt,
        event.configRevisionId,
        event.occurredAt,
      );
    }
  }
  const criticalConfigurationIds = new Set(
    protectedIds.configurationRevisionIds,
  );
  for (const frame of scopedFrames) {
    if (requiredFrameIds.has(frame.id)) {
      criticalConfigurationIds.add(frame.configRevisionId);
      recordLatestReference(
        configurationLastReferenceAt,
        frame.configRevisionId,
        now,
      );
    }
  }
  for (const decision of scopedDecisions) {
    criticalConfigurationIds.add(decision.configRevisionId);
  }
  for (const attempt of scopedPlaybackAttempts) {
    criticalConfigurationIds.add(attempt.configRevisionId);
  }
  for (const configurationId of protectedIds.configurationRevisionIds) {
    recordLatestReference(configurationLastReferenceAt, configurationId, now);
  }
  const configurationSelection = selectRecords({
    items: archive.configurationRevisions.filter((entry) =>
      retainedResetEpochIds.has(entry.resetEpochId),
    ),
    now,
    cutoff,
    max: HUNT_STALL_INCIDENT_MAX_CONFIGURATION_REVISIONS,
    getTime: (entry) =>
      Math.max(
        entry.capturedAt,
        configurationLastReferenceAt.get(entry.id) ?? entry.capturedAt,
      ),
    isProtected: (entry) => criticalConfigurationIds.has(entry.id),
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

  const framesWithoutConfiguration = scopedFrames.filter(
    (entry) => !retainedConfigurationIds.has(entry.configRevisionId),
  );
  appendDroppedOmission({
    omissions,
    kind: "frame",
    reason: "metadata-cap",
    entries: framesWithoutConfiguration,
    now,
  });
  const finalFrames = scopedFrames.filter((entry) =>
    retainedConfigurationIds.has(entry.configRevisionId),
  );
  const finalFrameIds = new Set(finalFrames.map((entry) => entry.id));
  const finalObservations = scopedObservations.filter((entry) =>
    finalFrameIds.has(entry.frameId),
  );
  const finalDecisions = scopedDecisions.filter(
    (entry) =>
      retainedConfigurationIds.has(entry.configRevisionId) &&
      finalFrameIds.has(entry.frameId),
  );
  const finalDecisionIds = new Set(finalDecisions.map((entry) => entry.id));
  const finalPlaybackAttempts = scopedPlaybackAttempts.filter(
    (entry) =>
      retainedConfigurationIds.has(entry.configRevisionId) &&
      finalDecisionIds.has(entry.decisionId),
  );
  const eventsWithoutConfiguration = scopedLifecycleEvents.filter(
    (entry) =>
      entry.configRevisionId !== null &&
      !retainedConfigurationIds.has(entry.configRevisionId),
  );
  appendDroppedOmission({
    omissions,
    kind: "event",
    reason: "metadata-cap",
    entries: eventsWithoutConfiguration,
    now,
  });
  const finalLifecycleEvents = scopedLifecycleEvents.filter(
    (entry) =>
      entry.configRevisionId === null ||
      retainedConfigurationIds.has(entry.configRevisionId),
  );

  const mediaResult = selectMedia({
    media: archive.media.filter((entry) => finalFrameIds.has(entry.frameId)),
    now,
    cutoff,
    requiredFrameIds,
    leasedFrameIds: protectedIds.mediaFrameIds,
  });
  omissions.push(...mediaResult.omissions);

  let compacted: HuntStallIncidentEvidenceArchive = {
    ...archive,
    updatedAt: now,
    currentResetEpochId:
      archive.currentResetEpochId &&
      retainedResetEpochIds.has(archive.currentResetEpochId)
        ? archive.currentResetEpochId
        : null,
    currentConfigurationRevisionId:
      archive.currentConfigurationRevisionId &&
      retainedConfigurationIds.has(archive.currentConfigurationRevisionId)
        ? archive.currentConfigurationRevisionId
        : null,
    resetEpochs,
    configurationRevisions,
    frames: finalFrames,
    observations: finalObservations,
    activityEpochs: scopedActivityEpochs,
    stallEpisodes: scopedStallEpisodes,
    alertCycles: scopedAlertCycles,
    decisions: finalDecisions,
    playbackAttempts: finalPlaybackAttempts,
    lifecycleEvents: finalLifecycleEvents,
    media: mediaResult.media,
    omissions: compactOmissions(omissions),
  };
  compacted = enforceMetadataBudget(compacted, protectedIds, now);
  return compacted;
}

export function getHuntStallIncidentEvidenceMetadataChars(
  archive: HuntStallIncidentEvidenceArchive,
): number {
  return JSON.stringify({
    ...archive,
    media: archive.media.map((entry) => ({
      ...entry,
      rawDataUrl: entry.rawDataUrl ? "[media]" : null,
      processedDataUrl: entry.processedDataUrl ? "[media]" : null,
    })),
  }).length;
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
  media: HuntStallIncidentMediaFrame[];
  now: number;
  cutoff: number;
  requiredFrameIds: Set<string>;
  leasedFrameIds: Set<string>;
}): {
  media: HuntStallIncidentMediaFrame[];
  omissions: HuntStallIncidentEvidenceOmission[];
} {
  const omissions: HuntStallIncidentEvidenceOmission[] = [];
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
    entries: outside,
    now,
  });

  const ordered = [...eligible].sort(
    (left, right) =>
      Number(leasedFrameIds.has(right.frameId)) -
        Number(leasedFrameIds.has(left.frameId)) ||
      getMediaPriority(right.reason) - getMediaPriority(left.reason) ||
      right.sampledAt - left.sampledAt ||
      left.id.localeCompare(right.id),
  );
  const retained: HuntStallIncidentMediaFrame[] = [];
  const oversized: HuntStallIncidentMediaFrame[] = [];
  const overBudget: HuntStallIncidentMediaFrame[] = [];
  let retainedChars = 0;

  for (const entry of ordered) {
    const chars = getMediaChars(entry);
    if (chars > HUNT_STALL_INCIDENT_MEDIA_MAX_FRAME_CHARS) {
      oversized.push(entry);
      continue;
    }
    if (
      retained.length >= HUNT_STALL_INCIDENT_MEDIA_MAX_FRAMES ||
      retainedChars + chars > HUNT_STALL_INCIDENT_MEDIA_MAX_TOTAL_CHARS
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
    entries: oversized,
    now,
  });
  appendDroppedOmission({
    omissions,
    kind: "media",
    reason: "media-budget",
    entries: overBudget,
    now,
  });
  return {
    media: retained.sort(compareByTimeAndId((entry) => entry.sampledAt)),
    omissions,
  };
}

function enforceMetadataBudget(
  archive: HuntStallIncidentEvidenceArchive,
  protection: ProtectionSets,
  now: number,
): HuntStallIncidentEvidenceArchive {
  let next: HuntStallIncidentEvidenceArchive = {
    ...archive,
    resetEpochs: [...archive.resetEpochs],
    configurationRevisions: [...archive.configurationRevisions],
    frames: [...archive.frames],
    observations: [...archive.observations],
    activityEpochs: [...archive.activityEpochs],
    stallEpisodes: [...archive.stallEpisodes],
    alertCycles: [...archive.alertCycles],
    decisions: [...archive.decisions],
    playbackAttempts: [...archive.playbackAttempts],
    lifecycleEvents: [...archive.lifecycleEvents],
    media: [...archive.media],
    omissions: [...archive.omissions],
  };
  const droppedEventIds: string[] = [];
  const droppedFrameIds: string[] = [];

  while (
    getHuntStallIncidentEvidenceMetadataChars(next) >
      HUNT_STALL_INCIDENT_METADATA_MAX_CHARS &&
    next.lifecycleEvents.length > 0
  ) {
    const removableIndex = next.lifecycleEvents.findIndex(
      (entry) => !protection.eventIds.has(entry.id),
    );
    if (removableIndex < 0) break;
    const index = removableIndex;
    const [removed] = next.lifecycleEvents.splice(index, 1);
    if (removed) droppedEventIds.push(removed.id);
  }

  while (
    getHuntStallIncidentEvidenceMetadataChars(next) >
      HUNT_STALL_INCIDENT_METADATA_MAX_CHARS &&
    next.frames.length > 0
  ) {
    const requiredFrameIds = new Set([
      ...protection.frameIds,
      ...next.activityEpochs.map((entry) => entry.anchorFrameId),
      ...next.decisions.map((entry) => entry.frameId),
    ]);
    const removableIndex = next.frames.findIndex(
      (entry) => !requiredFrameIds.has(entry.id),
    );
    if (removableIndex < 0) break;
    const [removed] = next.frames.splice(removableIndex, 1);
    if (!removed) break;
    droppedFrameIds.push(removed.id);
    next = {
      ...next,
      observations: next.observations.filter(
        (entry) => entry.frameId !== removed.id,
      ),
      media: next.media.filter((entry) => entry.frameId !== removed.id),
    };
  }

  const additions: HuntStallIncidentEvidenceOmission[] = [];
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
  if (additions.length > 0) {
    next = {
      ...next,
      omissions: compactOmissions([...next.omissions, ...additions]),
    };
  }

  while (
    getHuntStallIncidentEvidenceMetadataChars(next) >
      HUNT_STALL_INCIDENT_METADATA_MAX_CHARS &&
    next.omissions.length > 1
  ) {
    next = { ...next, omissions: next.omissions.slice(1) };
  }
  return next;
}

function deriveProtectionFromRecords(
  archive: HuntStallIncidentEvidenceArchive,
  protection: ProtectionSets,
): void {
  for (const event of archive.lifecycleEvents) {
    if (!protection.eventIds.has(event.id)) continue;
    protection.resetEpochIds.add(event.resetEpochId);
    if (event.configRevisionId) {
      protection.configurationRevisionIds.add(event.configRevisionId);
    }
    if (event.frameId) protection.frameIds.add(event.frameId);
    if (event.observationId) {
      protection.observationIds.add(event.observationId);
    }
    if (event.activityEpochId) {
      protection.activityEpochIds.add(event.activityEpochId);
    }
    if (event.stallEpisodeId) {
      protection.stallEpisodeIds.add(event.stallEpisodeId);
    }
    if (event.cycleId) protection.cycleIds.add(event.cycleId);
    if (event.attemptId) protection.attemptIds.add(event.attemptId);
  }
  for (const attempt of archive.playbackAttempts) {
    if (
      protection.attemptIds.has(attempt.id) ||
      attempt.status === "requested" ||
      attempt.status === "started"
    ) {
      protection.cycleIds.add(attempt.cycleId);
      protection.decisionIds.add(attempt.decisionId);
      protection.stallEpisodeIds.add(attempt.stallEpisodeId);
      protection.activityEpochIds.add(attempt.activityEpochId);
      protection.resetEpochIds.add(attempt.resetEpochId);
      protection.configurationRevisionIds.add(attempt.configRevisionId);
    }
  }

  protectReferencedDecisions(archive.decisions, protection);

  for (const cycle of archive.alertCycles) {
    if (cycle.status === "active" || protection.cycleIds.has(cycle.id)) {
      protection.stallEpisodeIds.add(cycle.stallEpisodeId);
      protection.activityEpochIds.add(cycle.activityEpochId);
      protection.decisionIds.add(cycle.initialDecisionId);
      protection.resetEpochIds.add(cycle.resetEpochId);
    }
  }

  protectReferencedDecisions(archive.decisions, protection);

  for (const episode of archive.stallEpisodes) {
    if (
      episode.status !== "terminal" ||
      protection.stallEpisodeIds.has(episode.id)
    ) {
      protection.activityEpochIds.add(episode.activityEpochId);
      protection.resetEpochIds.add(episode.resetEpochId);
    }
  }

  for (const activity of archive.activityEpochs) {
    if (
      activity.endedAt === null ||
      protection.activityEpochIds.has(activity.id)
    ) {
      protection.frameIds.add(activity.anchorFrameId);
      protection.observationIds.add(activity.anchorObservationId);
      protection.resetEpochIds.add(activity.resetEpochId);
    }
  }

  for (const observation of archive.observations) {
    if (protection.observationIds.has(observation.id)) {
      protection.frameIds.add(observation.frameId);
      protection.resetEpochIds.add(observation.resetEpochId);
    }
  }

  for (const frameId of protection.mediaFrameIds) {
    protection.frameIds.add(frameId);
  }
  for (const frame of archive.frames) {
    if (protection.frameIds.has(frame.id)) {
      protection.resetEpochIds.add(frame.resetEpochId);
      protection.configurationRevisionIds.add(frame.configRevisionId);
    }
  }
  for (const configuration of archive.configurationRevisions) {
    if (protection.configurationRevisionIds.has(configuration.id)) {
      protection.resetEpochIds.add(configuration.resetEpochId);
    }
  }
}

function protectReferencedDecisions(
  decisions: HuntStallIncidentAlertDecision[],
  protection: ProtectionSets,
): void {
  for (const decision of decisions) {
    if (protection.decisionIds.has(decision.id)) {
      protection.cycleIds.add(decision.cycleId);
      protection.stallEpisodeIds.add(decision.stallEpisodeId);
      protection.activityEpochIds.add(decision.activityEpochId);
      protection.frameIds.add(decision.frameId);
      protection.observationIds.add(decision.observationId);
      protection.resetEpochIds.add(decision.resetEpochId);
      protection.configurationRevisionIds.add(decision.configRevisionId);
    }
  }
}

function createProtectionSets(
  protection?: HuntStallIncidentEvidenceProtection,
): ProtectionSets {
  return {
    resetEpochIds: new Set(protection?.resetEpochIds ?? []),
    configurationRevisionIds: new Set(
      protection?.configurationRevisionIds ?? [],
    ),
    frameIds: new Set(protection?.frameIds ?? []),
    observationIds: new Set(protection?.observationIds ?? []),
    activityEpochIds: new Set(protection?.activityEpochIds ?? []),
    stallEpisodeIds: new Set(protection?.stallEpisodeIds ?? []),
    cycleIds: new Set(protection?.cycleIds ?? []),
    decisionIds: new Set(protection?.decisionIds ?? []),
    attemptIds: new Set(protection?.attemptIds ?? []),
    eventIds: new Set(protection?.eventIds ?? []),
    mediaFrameIds: new Set(protection?.mediaFrameIds ?? []),
  };
}

function normalizeLifecycleEvents(events: HuntStallIncidentLifecycleEvent[]): {
  events: HuntStallIncidentLifecycleEvent[];
  truncatedIds: string[];
} {
  const truncatedIds: string[] = [];
  return {
    events: events.map((entry) => {
      const chars = JSON.stringify(entry.details).length;
      if (chars <= HUNT_STALL_INCIDENT_EVENT_DETAILS_MAX_CHARS) {
        return entry;
      }
      truncatedIds.push(entry.id);
      return {
        ...entry,
        details: { omitted: "metadata-cap", originalChars: chars },
      };
    }),
    truncatedIds,
  };
}

function findLatestAttemptIds(
  attempts: HuntStallIncidentPlaybackAttempt[],
  cycleIds: Set<string>,
): Set<string> {
  const latestByCycle = new Map<string, HuntStallIncidentPlaybackAttempt>();
  for (const attempt of attempts) {
    if (!cycleIds.has(attempt.cycleId)) continue;
    const current = latestByCycle.get(attempt.cycleId);
    if (
      !current ||
      attempt.requestedAt > current.requestedAt ||
      (attempt.requestedAt === current.requestedAt &&
        attempt.id.localeCompare(current.id) > 0)
    ) {
      latestByCycle.set(attempt.cycleId, attempt);
    }
  }
  return new Set([...latestByCycle.values()].map((entry) => entry.id));
}

function recordLatestReference(
  references: Map<string, number>,
  id: string,
  occurredAt: number,
): void {
  references.set(id, Math.max(references.get(id) ?? occurredAt, occurredAt));
}

function appendSelectionOmissions<T extends { id: string }>(
  omissions: HuntStallIncidentEvidenceOmission[],
  kind: HuntStallIncidentEvidenceOmission["kind"],
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
  omissions: HuntStallIncidentEvidenceOmission[];
  kind: HuntStallIncidentEvidenceOmission["kind"];
  reason: HuntStallIncidentEvidenceOmissionReason;
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
  kind: HuntStallIncidentEvidenceOmission["kind"];
  reason: HuntStallIncidentEvidenceOmissionReason;
  subjectIds: string[];
  count: number;
  now: number;
}): HuntStallIncidentEvidenceOmission {
  const boundedIds = [...new Set(subjectIds)].sort().slice(0, 16);
  return {
    id: `hunt-stall-omission:${kind}:${reason}:${now}:${hashToken(
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
  omissions: HuntStallIncidentEvidenceOmission[],
): HuntStallIncidentEvidenceOmission[] {
  return mergeById([], omissions)
    .sort(compareByTimeAndId((entry) => entry.occurredAt))
    .slice(-HUNT_STALL_INCIDENT_MAX_OMISSIONS);
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
  current: HuntStallIncidentMediaFrame[],
  patch: HuntStallIncidentMediaFrame[] | undefined,
): HuntStallIncidentMediaFrame[] {
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
      reason:
        getMediaPriority(entry.reason) >= getMediaPriority(existing.reason)
          ? entry.reason
          : existing.reason,
      rawDataUrl: entry.rawDataUrl ?? existing.rawDataUrl,
      processedDataUrl:
        entry.processedDataUrl ?? existing.processedDataUrl,
    });
  }
  return [...byFrameId.values()];
}

function getMediaPriority(reason: HuntStallIncidentMediaReason): number {
  switch (reason) {
    case "playback-failed":
      return 100;
    case "alert-decision":
      return 90;
    case "threshold":
      return 80;
    case "activity-anchor":
      return 75;
    case "runtime-error":
      return 70;
    case "value-transition":
      return 60;
    case "rejected-observation":
      return 55;
    case "rearm":
      return 50;
    case "current":
      return 20;
    case "periodic":
      return 10;
  }
}

function getMediaChars(entry: HuntStallIncidentMediaFrame): number {
  return (
    (entry.rawDataUrl?.length ?? 0) +
    (entry.processedDataUrl?.length ?? 0)
  );
}

function getRelatedPlaybackEventAt(
  entry: HuntStallIncidentRelatedPlayback,
): number {
  return entry.finishedAt ?? entry.failedAt ?? entry.startedAt ?? entry.requestedAt;
}

function compareByTimeAndId<T>(
  getTime: (entry: T) => number,
): (left: T & { id: string }, right: T & { id: string }) => number {
  return (left, right) =>
    getTime(left) - getTime(right) || left.id.localeCompare(right.id);
}

function hashToken(value: string): string {
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
