import type { BoosterExpiryReportIncidentSelection } from "./boosterExpiryIncidentEvidenceSelection";
import {
  BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_FRAMES,
  BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
  BOOSTER_EXPIRY_INCIDENT_METADATA_MAX_CHARS,
  BOOSTER_EXPIRY_INCIDENT_REPORT_REQUEST_TARGET_BYTES,
} from "./boosterExpiryIncidentEvidenceArchive";
import type {
  BoosterExpiryIncidentAlertDecision,
  BoosterExpiryIncidentCandidateAttempt,
  BoosterExpiryIncidentConfigurationRevision,
  BoosterExpiryIncidentConfirmedCycle,
  BoosterExpiryIncidentEvidenceOmission,
  BoosterExpiryIncidentFlowEpoch,
  BoosterExpiryIncidentFrame,
  BoosterExpiryIncidentFrozenState,
  BoosterExpiryIncidentLifecycleEvent,
  BoosterExpiryIncidentMediaFrame,
  BoosterExpiryIncidentObservation,
  BoosterExpiryIncidentPlaybackAttempt,
  BoosterExpiryIncidentRelatedPlayback,
  BoosterExpiryIncidentReportLease,
  BoosterExpiryIncidentResetEpoch,
  BoosterExpiryIncidentSchedule,
  FrozenBoosterExpiryIncidentEvidence,
} from "./boosterExpiryIncidentEvidenceTypes";

export type BoosterExpiryIncidentReportBudget = {
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

export type BoosterExpiryIncidentReportEvidence = {
  schemaVersion: FrozenBoosterExpiryIncidentEvidence["schemaVersion"];
  archiveUpdatedAt: number;
  frozenAt: number;
  leaseId: string;
  lease: BoosterExpiryIncidentReportLease;
  frozenState: BoosterExpiryIncidentFrozenState | null;
  selection: BoosterExpiryReportIncidentSelection;
  resetEpochs: BoosterExpiryIncidentResetEpoch[];
  configurations: BoosterExpiryIncidentConfigurationRevision[];
  flowEpochs: BoosterExpiryIncidentFlowEpoch[];
  frames: BoosterExpiryIncidentFrame[];
  observations: BoosterExpiryIncidentObservation[];
  candidateAttempts: BoosterExpiryIncidentCandidateAttempt[];
  cycles: BoosterExpiryIncidentConfirmedCycle[];
  schedules: BoosterExpiryIncidentSchedule[];
  decisions: BoosterExpiryIncidentAlertDecision[];
  playbackAttempts: BoosterExpiryIncidentPlaybackAttempt[];
  lifecycle: BoosterExpiryIncidentLifecycleEvent[];
  media: BoosterExpiryIncidentMediaFrame[];
  relatedPlayback: BoosterExpiryIncidentRelatedPlayback[];
  omissions: BoosterExpiryIncidentEvidenceOmission[];
  reportFrame: null;
  budget: BoosterExpiryIncidentReportBudget;
};

export function createBoosterExpiryIncidentReportEvidence({
  evidence,
  selection,
}: {
  evidence: FrozenBoosterExpiryIncidentEvidence;
  selection: BoosterExpiryReportIncidentSelection;
}): BoosterExpiryIncidentReportEvidence {
  const resetEpochIds = new Set(
    selection.resetEpochId ? [selection.resetEpochId] : [],
  );
  const configurationRevisionIds = new Set(
    selection.configurationRevisionIds,
  );
  const flowEpochIds = new Set(selection.flowEpochIds);
  const frameIds = new Set(selection.frameIds);
  const observationIds = new Set(selection.observationIds);
  const candidateAttemptIds = new Set(selection.candidateAttemptIds);
  const cycleIds = new Set(selection.cycleIds);
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
    flowEpochIds.add(evidence.lease.flowEpochId);
  }
  if (
    evidence.frozenState &&
    (selection.resetEpochId === null ||
      evidence.frozenState.resetEpochId === selection.resetEpochId)
  ) {
    resetEpochIds.add(evidence.frozenState.resetEpochId);
    configurationRevisionIds.add(evidence.frozenState.configRevisionId);
    flowEpochIds.add(evidence.frozenState.flowEpochId);
  }
  mediaFrameIds.forEach((frameId) => frameIds.add(frameId));

  for (let pass = 0; pass < 8; pass += 1) {
    const sizeBefore = getSelectionSetSize([
      resetEpochIds,
      configurationRevisionIds,
      flowEpochIds,
      frameIds,
      observationIds,
      candidateAttemptIds,
      cycleIds,
      scheduleIds,
      decisionIds,
      playbackAttemptIds,
      eventIds,
      mediaFrameIds,
    ]);

    for (const attempt of evidence.playbackAttempts) {
      if (!playbackAttemptIds.has(attempt.id)) continue;
      resetEpochIds.add(attempt.resetEpochId);
      cycleIds.add(attempt.cycleId);
      scheduleIds.add(attempt.scheduleId);
      decisionIds.add(attempt.decisionId);
      configurationRevisionIds.add(attempt.configRevisionId);
    }
    for (const decision of evidence.decisions) {
      if (!decisionIds.has(decision.id)) continue;
      resetEpochIds.add(decision.resetEpochId);
      cycleIds.add(decision.cycleId);
      scheduleIds.add(decision.scheduleId);
      configurationRevisionIds.add(decision.timingConfigRevisionId);
      configurationRevisionIds.add(decision.firedConfigRevisionId);
    }
    for (const schedule of evidence.schedules) {
      if (!scheduleIds.has(schedule.id)) continue;
      resetEpochIds.add(schedule.resetEpochId);
      cycleIds.add(schedule.cycleId);
      configurationRevisionIds.add(schedule.timingConfigRevisionId);
    }
    for (const cycle of evidence.cycles) {
      if (!cycleIds.has(cycle.id)) continue;
      resetEpochIds.add(cycle.resetEpochId);
      candidateAttemptIds.add(cycle.candidateAttemptId);
      flowEpochIds.add(cycle.confirmationFlowEpochId);
      cycle.observationIds.forEach((id) => observationIds.add(id));
      configurationRevisionIds.add(cycle.timingConfigRevisionId);
    }
    for (const attempt of evidence.candidateAttempts) {
      if (!candidateAttemptIds.has(attempt.id)) continue;
      resetEpochIds.add(attempt.resetEpochId);
      flowEpochIds.add(attempt.flowEpochId);
      attempt.observationIds.forEach((id) => observationIds.add(id));
      if (attempt.confirmedCycleId) cycleIds.add(attempt.confirmedCycleId);
    }
    for (const observation of evidence.observations) {
      if (!observationIds.has(observation.id)) continue;
      resetEpochIds.add(observation.resetEpochId);
      flowEpochIds.add(observation.flowEpochId);
      frameIds.add(observation.frameId);
      configurationRevisionIds.add(observation.configRevisionId);
    }
    for (const frame of evidence.frames) {
      if (!frameIds.has(frame.id)) continue;
      resetEpochIds.add(frame.resetEpochId);
      flowEpochIds.add(frame.flowEpochId);
      configurationRevisionIds.add(frame.configRevisionId);
    }
    for (const flowEpoch of evidence.flowEpochs) {
      if (flowEpochIds.has(flowEpoch.id)) {
        resetEpochIds.add(flowEpoch.resetEpochId);
      }
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
          candidateAttemptIds,
          cycleIds,
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
        if (event.flowEpochId) flowEpochIds.add(event.flowEpochId);
        if (event.frameId) frameIds.add(event.frameId);
        if (event.observationId) observationIds.add(event.observationId);
        if (event.candidateAttemptId) {
          candidateAttemptIds.add(event.candidateAttemptId);
        }
        if (event.cycleId) cycleIds.add(event.cycleId);
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
      flowEpochIds,
      frameIds,
      observationIds,
      candidateAttemptIds,
      cycleIds,
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
  const retainedMedia: BoosterExpiryIncidentMediaFrame[] = [];
  const droppedMedia: BoosterExpiryIncidentMediaFrame[] = [];
  let retainedMediaChars = 0;
  for (const entry of [...selectedMedia].sort(compareMediaPriority)) {
    const entryChars = entry.imageDataUrl.length;
    if (
      retainedMedia.length >= BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_FRAMES ||
      retainedMediaChars + entryChars >
        BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_TOTAL_CHARS
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

  const closedSelection: BoosterExpiryReportIncidentSelection = {
    ...selection,
    flowEpochIds: evidence.flowEpochs
      .filter((entry) => flowEpochIds.has(entry.id))
      .map((entry) => entry.id),
    frameIds: evidence.frames
      .filter((entry) => frameIds.has(entry.id))
      .map((entry) => entry.id),
    observationIds: evidence.observations
      .filter((entry) => observationIds.has(entry.id))
      .map((entry) => entry.id),
    candidateAttemptIds: evidence.candidateAttempts
      .filter((entry) => candidateAttemptIds.has(entry.id))
      .map((entry) => entry.id),
    cycleIds: evidence.cycles
      .filter((entry) => cycleIds.has(entry.id))
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
    ...flowEpochIds,
    ...frameIds,
    ...observationIds,
    ...candidateAttemptIds,
    ...cycleIds,
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
      id: `booster-expiry-report-payload-compacted:${evidence.leaseId}`,
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
    flowEpochs: evidence.flowEpochs.filter((entry) =>
      flowEpochIds.has(entry.id),
    ),
    frames: evidence.frames.filter((entry) => frameIds.has(entry.id)),
    observations: evidence.observations.filter((entry) =>
      observationIds.has(entry.id),
    ),
    candidateAttempts: evidence.candidateAttempts.filter((entry) =>
      candidateAttemptIds.has(entry.id),
    ),
    cycles: evidence.cycles.filter((entry) => cycleIds.has(entry.id)),
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
      metadataLimitChars: BOOSTER_EXPIRY_INCIDENT_METADATA_MAX_CHARS,
      metadataChars,
      mediaLimitCount: BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_FRAMES,
      mediaCount: retainedMedia.length,
      mediaLimitChars: BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
      mediaChars,
      requestTargetBytes: BOOSTER_EXPIRY_INCIDENT_REPORT_REQUEST_TARGET_BYTES,
      requestBytes,
      droppedMediaFrameIds: droppedMedia.map((entry) => entry.frameId),
      overMetadataLimit:
        metadataChars > BOOSTER_EXPIRY_INCIDENT_METADATA_MAX_CHARS,
      overMediaLimit:
        retainedMedia.length > BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_FRAMES ||
        mediaChars > BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
      overRequestTarget:
        requestBytes > BOOSTER_EXPIRY_INCIDENT_REPORT_REQUEST_TARGET_BYTES,
    },
  };
}

function isEventLinkedToSelectedIncident(
  event: BoosterExpiryIncidentLifecycleEvent,
  ids: {
    resetEpochIds: Set<string>;
    frameIds: Set<string>;
    observationIds: Set<string>;
    candidateAttemptIds: Set<string>;
    cycleIds: Set<string>;
    scheduleIds: Set<string>;
    decisionIds: Set<string>;
    playbackAttemptIds: Set<string>;
  },
): boolean {
  if (!ids.resetEpochIds.has(event.resetEpochId)) return false;
  return Boolean(
    (event.frameId && ids.frameIds.has(event.frameId)) ||
      (event.observationId && ids.observationIds.has(event.observationId)) ||
      (event.candidateAttemptId &&
        ids.candidateAttemptIds.has(event.candidateAttemptId)) ||
      (event.cycleId && ids.cycleIds.has(event.cycleId)) ||
      (event.scheduleId && ids.scheduleIds.has(event.scheduleId)) ||
      (event.decisionId && ids.decisionIds.has(event.decisionId)) ||
      (event.playbackAttemptId &&
        ids.playbackAttemptIds.has(event.playbackAttemptId))
  );
}

function compareMediaPriority(
  left: BoosterExpiryIncidentMediaFrame,
  right: BoosterExpiryIncidentMediaFrame,
): number {
  return (
    getMediaPriority(right) - getMediaPriority(left) ||
    right.sampledAt - left.sampledAt ||
    left.id.localeCompare(right.id)
  );
}

function getMediaPriority(entry: BoosterExpiryIncidentMediaFrame): number {
  switch (entry.reason) {
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
