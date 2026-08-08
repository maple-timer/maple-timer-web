import type { SpecialCoreReportIncidentSelection } from "./specialCoreIncidentEvidenceSelection";
import {
  SPECIAL_CORE_INCIDENT_MEDIA_MAX_FRAMES,
  SPECIAL_CORE_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
  SPECIAL_CORE_INCIDENT_METADATA_MAX_CHARS,
  SPECIAL_CORE_INCIDENT_REPORT_REQUEST_TARGET_BYTES,
} from "./specialCoreIncidentEvidenceArchive";
import type {
  FrozenSpecialCoreIncidentEvidence,
  SpecialCoreIncidentActivation,
  SpecialCoreIncidentAlertDecision,
  SpecialCoreIncidentConfigurationRevision,
  SpecialCoreIncidentConfirmationAttempt,
  SpecialCoreIncidentEvidenceOmission,
  SpecialCoreIncidentFrame,
  SpecialCoreIncidentFrozenState,
  SpecialCoreIncidentLifecycleEvent,
  SpecialCoreIncidentMediaFrame,
  SpecialCoreIncidentObservation,
  SpecialCoreIncidentPlaybackAttempt,
  SpecialCoreIncidentRelatedPlayback,
  SpecialCoreIncidentReportLease,
  SpecialCoreIncidentResetEpoch,
  SpecialCoreIncidentSchedule,
} from "./specialCoreIncidentEvidenceTypes";

export type SpecialCoreIncidentReportBudget = {
  version: 1;
  metadataLimitChars: number;
  metadataChars: number;
  mediaLimitCount: number;
  mediaCount: number;
  mediaLimitChars: number;
  mediaChars: number;
  requestTargetBytes: number;
  requestBytes: number;
  droppedMediaFrameIds: string[];
  overMetadataLimit: boolean;
  overMediaLimit: boolean;
  overRequestTarget: boolean;
};

export type SpecialCoreIncidentReportEvidence = {
  schemaVersion: FrozenSpecialCoreIncidentEvidence["schemaVersion"];
  archiveUpdatedAt: number;
  frozenAt: number;
  leaseId: string;
  lease: SpecialCoreIncidentReportLease;
  frozenState: SpecialCoreIncidentFrozenState | null;
  selection: SpecialCoreReportIncidentSelection;
  resetEpochs: SpecialCoreIncidentResetEpoch[];
  configurations: SpecialCoreIncidentConfigurationRevision[];
  frames: SpecialCoreIncidentFrame[];
  observations: SpecialCoreIncidentObservation[];
  confirmationAttempts: SpecialCoreIncidentConfirmationAttempt[];
  activations: SpecialCoreIncidentActivation[];
  schedules: SpecialCoreIncidentSchedule[];
  decisions: SpecialCoreIncidentAlertDecision[];
  playbackAttempts: SpecialCoreIncidentPlaybackAttempt[];
  lifecycle: SpecialCoreIncidentLifecycleEvent[];
  media: SpecialCoreIncidentMediaFrame[];
  relatedPlayback: SpecialCoreIncidentRelatedPlayback[];
  omissions: SpecialCoreIncidentEvidenceOmission[];
  reportFrame: null;
  budget: SpecialCoreIncidentReportBudget;
};

export function createSpecialCoreIncidentReportEvidence({
  evidence,
  selection,
}: {
  evidence: FrozenSpecialCoreIncidentEvidence;
  selection: SpecialCoreReportIncidentSelection;
}): SpecialCoreIncidentReportEvidence {
  const resetEpochIds = new Set(
    selection.resetEpochId ? [selection.resetEpochId] : [],
  );
  const configurationRevisionIds = new Set(
    selection.configurationRevisionIds,
  );
  const frameIds = new Set(selection.frameIds);
  const observationIds = new Set(selection.observationIds);
  const confirmationAttemptIds = new Set(
    selection.confirmationAttemptIds,
  );
  const activationIds = new Set(selection.activationIds);
  const scheduleIds = new Set(selection.scheduleIds);
  const decisionIds = new Set(selection.decisionIds);
  const playbackAttemptIds = new Set(selection.playbackAttemptIds);
  const eventIds = new Set(selection.eventIds);
  const mediaFrameIds = new Set(selection.mediaFrameIds);
  const relatedPlaybackIds = new Set(selection.relatedPlaybackIds);

  if (
    selection.resetEpochId === null ||
    evidence.lease.resetEpochId === selection.resetEpochId
  ) {
    resetEpochIds.add(evidence.lease.resetEpochId);
    configurationRevisionIds.add(evidence.lease.configRevisionId);
  }
  if (
    evidence.frozenState &&
    (selection.resetEpochId === null ||
      evidence.frozenState.resetEpochId === selection.resetEpochId)
  ) {
    resetEpochIds.add(evidence.frozenState.resetEpochId);
    configurationRevisionIds.add(evidence.frozenState.configRevisionId);
  }
  mediaFrameIds.forEach((frameId) => frameIds.add(frameId));

  for (let pass = 0; pass < 8; pass += 1) {
    const sizeBefore = getSelectionSetSize([
      resetEpochIds,
      configurationRevisionIds,
      frameIds,
      observationIds,
      confirmationAttemptIds,
      activationIds,
      scheduleIds,
      decisionIds,
      playbackAttemptIds,
      eventIds,
      mediaFrameIds,
    ]);

    for (const attempt of evidence.playbackAttempts) {
      if (!playbackAttemptIds.has(attempt.id)) continue;
      resetEpochIds.add(attempt.resetEpochId);
      activationIds.add(attempt.activationId);
      scheduleIds.add(attempt.scheduleId);
      decisionIds.add(attempt.decisionId);
      configurationRevisionIds.add(attempt.configRevisionId);
    }
    for (const decision of evidence.decisions) {
      if (!decisionIds.has(decision.id)) continue;
      resetEpochIds.add(decision.resetEpochId);
      activationIds.add(decision.activationId);
      scheduleIds.add(decision.scheduleId);
      configurationRevisionIds.add(decision.timingConfigRevisionId);
      configurationRevisionIds.add(decision.firedConfigRevisionId);
    }
    for (const schedule of evidence.schedules) {
      if (!scheduleIds.has(schedule.id)) continue;
      resetEpochIds.add(schedule.resetEpochId);
      activationIds.add(schedule.activationId);
      configurationRevisionIds.add(schedule.timingConfigRevisionId);
    }
    for (const activation of evidence.activations) {
      if (!activationIds.has(activation.id)) continue;
      resetEpochIds.add(activation.resetEpochId);
      confirmationAttemptIds.add(activation.confirmationAttemptId);
      activation.observationIds.forEach((id) => observationIds.add(id));
      configurationRevisionIds.add(activation.timingConfigRevisionId);
    }
    for (const confirmation of evidence.confirmationAttempts) {
      if (!confirmationAttemptIds.has(confirmation.id)) continue;
      resetEpochIds.add(confirmation.resetEpochId);
      confirmation.observationIds.forEach((id) => observationIds.add(id));
      if (confirmation.activationId) {
        activationIds.add(confirmation.activationId);
      }
    }
    for (const observation of evidence.observations) {
      if (!observationIds.has(observation.id)) continue;
      resetEpochIds.add(observation.resetEpochId);
      frameIds.add(observation.frameId);
      configurationRevisionIds.add(observation.configRevisionId);
    }
    for (const frame of evidence.frames) {
      if (!frameIds.has(frame.id)) continue;
      resetEpochIds.add(frame.resetEpochId);
      configurationRevisionIds.add(frame.configRevisionId);
    }
    for (const configuration of evidence.configurationRevisions) {
      if (configurationRevisionIds.has(configuration.id)) {
        resetEpochIds.add(configuration.resetEpochId);
      }
    }
    for (const event of evidence.lifecycleEvents) {
      if (
        eventIds.has(event.id) ||
        isEventLinkedToSelectedIncident(event, {
          resetEpochIds,
          frameIds,
          observationIds,
          confirmationAttemptIds,
          activationIds,
          scheduleIds,
          decisionIds,
          playbackAttemptIds,
        })
      ) {
        eventIds.add(event.id);
        resetEpochIds.add(event.resetEpochId);
        if (event.configRevisionId) {
          configurationRevisionIds.add(event.configRevisionId);
        }
        if (event.frameId) frameIds.add(event.frameId);
        if (event.observationId) observationIds.add(event.observationId);
        if (event.confirmationAttemptId) {
          confirmationAttemptIds.add(event.confirmationAttemptId);
        }
        if (event.activationId) activationIds.add(event.activationId);
        if (event.scheduleId) scheduleIds.add(event.scheduleId);
        if (event.decisionId) decisionIds.add(event.decisionId);
        if (event.playbackAttemptId) {
          playbackAttemptIds.add(event.playbackAttemptId);
        }
      }
    }
    for (const media of evidence.media) {
      if (!mediaFrameIds.has(media.frameId)) continue;
      frameIds.add(media.frameId);
      resetEpochIds.add(media.resetEpochId);
    }

    const sizeAfter = getSelectionSetSize([
      resetEpochIds,
      configurationRevisionIds,
      frameIds,
      observationIds,
      confirmationAttemptIds,
      activationIds,
      scheduleIds,
      decisionIds,
      playbackAttemptIds,
      eventIds,
      mediaFrameIds,
    ]);
    if (sizeAfter === sizeBefore) break;
  }

  const selectedMedia = evidence.media.filter((entry) =>
    mediaFrameIds.has(entry.frameId),
  );
  const retainedMedia: SpecialCoreIncidentMediaFrame[] = [];
  const droppedMedia: SpecialCoreIncidentMediaFrame[] = [];
  let retainedMediaChars = 0;
  for (const entry of [...selectedMedia].sort(compareMediaPriority)) {
    const entryChars = entry.imageDataUrl.length;
    if (
      retainedMedia.length >= SPECIAL_CORE_INCIDENT_MEDIA_MAX_FRAMES ||
      retainedMediaChars + entryChars >
        SPECIAL_CORE_INCIDENT_MEDIA_MAX_TOTAL_CHARS
    ) {
      droppedMedia.push(entry);
      continue;
    }
    retainedMedia.push(entry);
    retainedMediaChars += entryChars;
  }
  retainedMedia.sort(
    (left, right) =>
      left.sampledAt - right.sampledAt || left.id.localeCompare(right.id),
  );
  const closedSelection: SpecialCoreReportIncidentSelection = {
    ...selection,
    frameIds: evidence.frames
      .filter((entry) => frameIds.has(entry.id))
      .map((entry) => entry.id),
    observationIds: evidence.observations
      .filter((entry) => observationIds.has(entry.id))
      .map((entry) => entry.id),
    confirmationAttemptIds: evidence.confirmationAttempts
      .filter((entry) => confirmationAttemptIds.has(entry.id))
      .map((entry) => entry.id),
    activationIds: evidence.activations
      .filter((entry) => activationIds.has(entry.id))
      .map((entry) => entry.id),
    scheduleIds: evidence.schedules
      .filter((entry) => scheduleIds.has(entry.id))
      .map((entry) => entry.id),
    decisionIds: evidence.decisions
      .filter((entry) => decisionIds.has(entry.id))
      .map((entry) => entry.id),
    playbackAttemptIds: evidence.playbackAttempts
      .filter((entry) => playbackAttemptIds.has(entry.id))
      .map((entry) => entry.id),
    eventIds: evidence.lifecycleEvents
      .filter((entry) => eventIds.has(entry.id))
      .map((entry) => entry.id),
    configurationRevisionIds: evidence.configurationRevisions
      .filter((entry) => configurationRevisionIds.has(entry.id))
      .map((entry) => entry.id),
    mediaFrameIds: evidence.media
      .filter((entry) => mediaFrameIds.has(entry.frameId))
      .map((entry) => entry.frameId),
    relatedPlaybackIds: evidence.relatedPlayback
      .filter((entry) => relatedPlaybackIds.has(entry.id))
      .map((entry) => entry.id),
  };
  const reportSelection = droppedMedia.length
    ? {
        ...closedSelection,
        support: "partial" as const,
        degradationReasons: unique([
          ...closedSelection.degradationReasons,
          "payload-compacted" as const,
        ]),
      }
    : closedSelection;

  const selectedIds = new Set([
    ...resetEpochIds,
    ...configurationRevisionIds,
    ...frameIds,
    ...observationIds,
    ...confirmationAttemptIds,
    ...activationIds,
    ...scheduleIds,
    ...decisionIds,
    ...playbackAttemptIds,
    ...eventIds,
    ...mediaFrameIds,
    ...relatedPlaybackIds,
  ]);
  const omissions = evidence.omissions.filter(
    (entry) =>
      entry.subjectIds.length === 0 ||
      entry.subjectIds.some((id) => selectedIds.has(id)),
  );
  if (droppedMedia.length > 0) {
    omissions.push({
      id: `special-core-report-payload-compacted:${evidence.leaseId}`,
      occurredAt: evidence.frozenAt,
      kind: "media",
      reason: "payload-compacted",
      subjectIds: droppedMedia.map((entry) => entry.frameId),
      count: droppedMedia.length,
    });
  }

  const report = {
    schemaVersion: evidence.schemaVersion,
    archiveUpdatedAt: evidence.updatedAt,
    frozenAt: evidence.frozenAt,
    leaseId: evidence.leaseId,
    lease: evidence.lease,
    frozenState: evidence.frozenState,
    selection: reportSelection,
    resetEpochs: evidence.resetEpochs.filter((entry) =>
      resetEpochIds.has(entry.id),
    ),
    configurations: evidence.configurationRevisions.filter((entry) =>
      configurationRevisionIds.has(entry.id),
    ),
    frames: evidence.frames.filter((entry) => frameIds.has(entry.id)),
    observations: evidence.observations.filter((entry) =>
      observationIds.has(entry.id),
    ),
    confirmationAttempts: evidence.confirmationAttempts.filter((entry) =>
      confirmationAttemptIds.has(entry.id),
    ),
    activations: evidence.activations.filter((entry) =>
      activationIds.has(entry.id),
    ),
    schedules: evidence.schedules.filter((entry) =>
      scheduleIds.has(entry.id),
    ),
    decisions: evidence.decisions.filter((entry) =>
      decisionIds.has(entry.id),
    ),
    playbackAttempts: evidence.playbackAttempts.filter((entry) =>
      playbackAttemptIds.has(entry.id),
    ),
    lifecycle: evidence.lifecycleEvents.filter((entry) =>
      eventIds.has(entry.id),
    ),
    media: retainedMedia,
    relatedPlayback: evidence.relatedPlayback.filter((entry) =>
      relatedPlaybackIds.has(entry.id),
    ),
    omissions,
    reportFrame: null,
  };
  const metadataChars = getReportMetadataChars(report);
  const mediaChars = retainedMedia.reduce(
    (total, entry) => total + entry.imageDataUrl.length,
    0,
  );
  const requestBytes = new TextEncoder().encode(JSON.stringify(report)).byteLength;

  return {
    ...report,
    budget: {
      version: 1,
      metadataLimitChars: SPECIAL_CORE_INCIDENT_METADATA_MAX_CHARS,
      metadataChars,
      mediaLimitCount: SPECIAL_CORE_INCIDENT_MEDIA_MAX_FRAMES,
      mediaCount: retainedMedia.length,
      mediaLimitChars: SPECIAL_CORE_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
      mediaChars,
      requestTargetBytes: SPECIAL_CORE_INCIDENT_REPORT_REQUEST_TARGET_BYTES,
      requestBytes,
      droppedMediaFrameIds: droppedMedia.map((entry) => entry.frameId),
      overMetadataLimit:
        metadataChars > SPECIAL_CORE_INCIDENT_METADATA_MAX_CHARS,
      overMediaLimit:
        retainedMedia.length > SPECIAL_CORE_INCIDENT_MEDIA_MAX_FRAMES ||
        mediaChars > SPECIAL_CORE_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
      overRequestTarget:
        requestBytes > SPECIAL_CORE_INCIDENT_REPORT_REQUEST_TARGET_BYTES,
    },
  };
}

function isEventLinkedToSelectedIncident(
  event: SpecialCoreIncidentLifecycleEvent,
  ids: {
    resetEpochIds: Set<string>;
    frameIds: Set<string>;
    observationIds: Set<string>;
    confirmationAttemptIds: Set<string>;
    activationIds: Set<string>;
    scheduleIds: Set<string>;
    decisionIds: Set<string>;
    playbackAttemptIds: Set<string>;
  },
): boolean {
  if (!ids.resetEpochIds.has(event.resetEpochId)) return false;
  return Boolean(
    (event.frameId && ids.frameIds.has(event.frameId)) ||
      (event.observationId && ids.observationIds.has(event.observationId)) ||
      (event.confirmationAttemptId &&
        ids.confirmationAttemptIds.has(event.confirmationAttemptId)) ||
      (event.activationId && ids.activationIds.has(event.activationId)) ||
      (event.scheduleId && ids.scheduleIds.has(event.scheduleId)) ||
      (event.decisionId && ids.decisionIds.has(event.decisionId)) ||
      (event.playbackAttemptId &&
        ids.playbackAttemptIds.has(event.playbackAttemptId))
  );
}

function compareMediaPriority(
  left: SpecialCoreIncidentMediaFrame,
  right: SpecialCoreIncidentMediaFrame,
): number {
  return (
    getMediaPriority(right) - getMediaPriority(left) ||
    right.sampledAt - left.sampledAt ||
    left.id.localeCompare(right.id)
  );
}

function getMediaPriority(entry: SpecialCoreIncidentMediaFrame): number {
  switch (entry.reason) {
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

function getSelectionSetSize(sets: Array<Set<string>>): number {
  return sets.reduce((total, set) => total + set.size, 0);
}

function getReportMetadataChars(report: Record<string, unknown>): number {
  return JSON.stringify(report, (key, value) =>
    key === "imageDataUrl" && typeof value === "string" ? undefined : value,
  ).length;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
