import type { HuntStallReportIncidentSelection } from "./huntStallIncidentEvidenceSelection";
import {
  HUNT_STALL_INCIDENT_MEDIA_MAX_FRAMES,
  HUNT_STALL_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
  HUNT_STALL_INCIDENT_METADATA_MAX_CHARS,
  HUNT_STALL_INCIDENT_REPORT_REQUEST_TARGET_BYTES,
} from "./huntStallIncidentEvidenceArchive";
import type {
  FrozenHuntStallIncidentEvidence,
  HuntStallIncidentActivityEpoch,
  HuntStallIncidentAlertCycle,
  HuntStallIncidentAlertDecision,
  HuntStallIncidentConfigurationRevision,
  HuntStallIncidentEvidenceOmission,
  HuntStallIncidentFrame,
  HuntStallIncidentFrozenState,
  HuntStallIncidentLifecycleEvent,
  HuntStallIncidentMediaFrame,
  HuntStallIncidentObservation,
  HuntStallIncidentPlaybackAttempt,
  HuntStallIncidentRelatedPlayback,
  HuntStallIncidentReportLease,
  HuntStallIncidentResetEpoch,
  HuntStallIncidentStallEpisode,
} from "./huntStallIncidentEvidenceTypes";

export type HuntStallIncidentReportBudget = {
  version: 1;
  metadataLimitChars: number;
  metadataChars: number;
  mediaLimitCount: number;
  mediaCount: number;
  mediaLimitChars: number;
  mediaChars: number;
  requestTargetBytes: number;
  requestChars: number;
  droppedMediaFrameIds: string[];
  overMetadataLimit: boolean;
  overMediaLimit: boolean;
  overRequestTarget: boolean;
};

export type HuntStallIncidentReportEvidence = {
  schemaVersion: FrozenHuntStallIncidentEvidence["schemaVersion"];
  archiveUpdatedAt: number;
  frozenAt: number;
  leaseId: string;
  lease: HuntStallIncidentReportLease;
  frozenState: HuntStallIncidentFrozenState | null;
  selection: HuntStallReportIncidentSelection;
  resetEpochs: HuntStallIncidentResetEpoch[];
  configurations: HuntStallIncidentConfigurationRevision[];
  frames: HuntStallIncidentFrame[];
  observations: HuntStallIncidentObservation[];
  activityEpochs: HuntStallIncidentActivityEpoch[];
  stallEpisodes: HuntStallIncidentStallEpisode[];
  alertCycles: HuntStallIncidentAlertCycle[];
  decisions: HuntStallIncidentAlertDecision[];
  playbackAttempts: HuntStallIncidentPlaybackAttempt[];
  lifecycle: HuntStallIncidentLifecycleEvent[];
  media: HuntStallIncidentMediaFrame[];
  relatedPlayback: HuntStallIncidentRelatedPlayback[];
  omissions: HuntStallIncidentEvidenceOmission[];
  reportFrame: null;
  budget: HuntStallIncidentReportBudget;
};

export function createHuntStallIncidentReportEvidence({
  evidence,
  selection,
}: {
  evidence: FrozenHuntStallIncidentEvidence;
  selection: HuntStallReportIncidentSelection;
}): HuntStallIncidentReportEvidence {
  const resetEpochIds = new Set(
    selection.resetEpochId ? [selection.resetEpochId] : [],
  );
  const configurationRevisionIds = new Set(
    selection.configurationRevisionIds,
  );
  const frameIds = new Set(selection.frameIds);
  const observationIds = new Set(selection.observationIds);
  const activityEpochIds = new Set(selection.activityEpochIds);
  const stallEpisodeIds = new Set(selection.stallEpisodeIds);
  const cycleIds = new Set(selection.cycleIds);
  const decisionIds = new Set(selection.decisionIds);
  const attemptIds = new Set(selection.attemptIds);
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
      activityEpochIds,
      stallEpisodeIds,
      cycleIds,
      decisionIds,
      attemptIds,
      eventIds,
      mediaFrameIds,
    ]);

    for (const attempt of evidence.playbackAttempts) {
      if (!attemptIds.has(attempt.id)) continue;
      resetEpochIds.add(attempt.resetEpochId);
      activityEpochIds.add(attempt.activityEpochId);
      stallEpisodeIds.add(attempt.stallEpisodeId);
      cycleIds.add(attempt.cycleId);
      decisionIds.add(attempt.decisionId);
      configurationRevisionIds.add(attempt.configRevisionId);
    }
    for (const decision of evidence.decisions) {
      if (!decisionIds.has(decision.id)) continue;
      resetEpochIds.add(decision.resetEpochId);
      activityEpochIds.add(decision.activityEpochId);
      stallEpisodeIds.add(decision.stallEpisodeId);
      cycleIds.add(decision.cycleId);
      frameIds.add(decision.frameId);
      observationIds.add(decision.observationId);
      configurationRevisionIds.add(decision.configRevisionId);
    }
    for (const cycle of evidence.alertCycles) {
      if (!cycleIds.has(cycle.id)) continue;
      resetEpochIds.add(cycle.resetEpochId);
      activityEpochIds.add(cycle.activityEpochId);
      stallEpisodeIds.add(cycle.stallEpisodeId);
      decisionIds.add(cycle.initialDecisionId);
    }
    for (const episode of evidence.stallEpisodes) {
      if (!stallEpisodeIds.has(episode.id)) continue;
      resetEpochIds.add(episode.resetEpochId);
      activityEpochIds.add(episode.activityEpochId);
      if (episode.alertCycleId) cycleIds.add(episode.alertCycleId);
      if (episode.lastEvaluation) {
        frameIds.add(episode.lastEvaluation.frameId);
        observationIds.add(episode.lastEvaluation.observationId);
      }
    }
    for (const activity of evidence.activityEpochs) {
      if (!activityEpochIds.has(activity.id)) continue;
      resetEpochIds.add(activity.resetEpochId);
      frameIds.add(activity.anchorFrameId);
      observationIds.add(activity.anchorObservationId);
    }
    for (const observation of evidence.observations) {
      if (!observationIds.has(observation.id)) continue;
      resetEpochIds.add(observation.resetEpochId);
      frameIds.add(observation.frameId);
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
          frameIds,
          observationIds,
          activityEpochIds,
          stallEpisodeIds,
          cycleIds,
          attemptIds,
        })
      ) {
        eventIds.add(event.id);
        resetEpochIds.add(event.resetEpochId);
        if (event.frameId) frameIds.add(event.frameId);
        if (event.observationId) observationIds.add(event.observationId);
        if (event.activityEpochId) activityEpochIds.add(event.activityEpochId);
        if (event.stallEpisodeId) stallEpisodeIds.add(event.stallEpisodeId);
        if (event.cycleId) cycleIds.add(event.cycleId);
        if (event.attemptId) attemptIds.add(event.attemptId);
        if (event.configRevisionId) {
          configurationRevisionIds.add(event.configRevisionId);
        }
      }
    }
    for (const media of evidence.media) {
      if (mediaFrameIds.has(media.frameId)) {
        frameIds.add(media.frameId);
        resetEpochIds.add(media.resetEpochId);
      }
    }

    const sizeAfter = getSelectionSetSize([
      resetEpochIds,
      configurationRevisionIds,
      frameIds,
      observationIds,
      activityEpochIds,
      stallEpisodeIds,
      cycleIds,
      decisionIds,
      attemptIds,
      eventIds,
      mediaFrameIds,
    ]);
    if (sizeAfter === sizeBefore) break;
  }

  const selectedMedia = evidence.media.filter((entry) =>
    mediaFrameIds.has(entry.frameId),
  );
  const retainedMedia = [...selectedMedia]
    .sort(compareHuntStallIncidentMediaPriority)
    .slice(0, HUNT_STALL_INCIDENT_MEDIA_MAX_FRAMES)
    .sort(
      (left, right) =>
        left.sampledAt - right.sampledAt || left.id.localeCompare(right.id),
    );
  const retainedMediaIds = new Set(retainedMedia.map((entry) => entry.id));
  const droppedMedia = selectedMedia.filter(
    (entry) => !retainedMediaIds.has(entry.id),
  );
  const reportSelection = droppedMedia.length
    ? {
        ...selection,
        support: "partial" as const,
        degradationReasons: unique([
          ...selection.degradationReasons,
          "payload-compacted" as const,
        ]),
      }
    : selection;
  const selectedIds = new Set([
    ...resetEpochIds,
    ...configurationRevisionIds,
    ...frameIds,
    ...observationIds,
    ...activityEpochIds,
    ...stallEpisodeIds,
    ...cycleIds,
    ...decisionIds,
    ...attemptIds,
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
      id: `hunt-stall-report-payload-compacted:${evidence.leaseId}`,
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
    activityEpochs: evidence.activityEpochs.filter((entry) =>
      activityEpochIds.has(entry.id),
    ),
    stallEpisodes: evidence.stallEpisodes.filter((entry) =>
      stallEpisodeIds.has(entry.id),
    ),
    alertCycles: evidence.alertCycles.filter((entry) => cycleIds.has(entry.id)),
    decisions: evidence.decisions.filter((entry) => decisionIds.has(entry.id)),
    playbackAttempts: evidence.playbackAttempts.filter((entry) =>
      attemptIds.has(entry.id),
    ),
    lifecycle: evidence.lifecycleEvents.filter((entry) => eventIds.has(entry.id)),
    media: retainedMedia,
    relatedPlayback: evidence.relatedPlayback.filter((entry) =>
      relatedPlaybackIds.has(entry.id),
    ),
    omissions,
    reportFrame: null,
  };
  const metadataChars = getReportMetadataChars(report);
  const mediaChars = retainedMedia.reduce(
    (total, entry) =>
      total +
      (entry.rawDataUrl?.length ?? 0) +
      (entry.processedDataUrl?.length ?? 0),
    0,
  );
  const requestChars = JSON.stringify(report).length;

  return {
    ...report,
    budget: {
      version: 1,
      metadataLimitChars: HUNT_STALL_INCIDENT_METADATA_MAX_CHARS,
      metadataChars,
      mediaLimitCount: HUNT_STALL_INCIDENT_MEDIA_MAX_FRAMES,
      mediaCount: retainedMedia.length,
      mediaLimitChars: HUNT_STALL_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
      mediaChars,
      requestTargetBytes: HUNT_STALL_INCIDENT_REPORT_REQUEST_TARGET_BYTES,
      requestChars,
      droppedMediaFrameIds: droppedMedia.map((entry) => entry.frameId),
      overMetadataLimit: metadataChars > HUNT_STALL_INCIDENT_METADATA_MAX_CHARS,
      overMediaLimit:
        retainedMedia.length > HUNT_STALL_INCIDENT_MEDIA_MAX_FRAMES ||
        mediaChars > HUNT_STALL_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
      overRequestTarget:
        requestChars > HUNT_STALL_INCIDENT_REPORT_REQUEST_TARGET_BYTES,
    },
  };
}

function isEventLinkedToSelectedIncident(
  event: HuntStallIncidentLifecycleEvent,
  ids: {
    frameIds: Set<string>;
    observationIds: Set<string>;
    activityEpochIds: Set<string>;
    stallEpisodeIds: Set<string>;
    cycleIds: Set<string>;
    attemptIds: Set<string>;
  },
): boolean {
  return Boolean(
    (event.frameId && ids.frameIds.has(event.frameId)) ||
      (event.observationId && ids.observationIds.has(event.observationId)) ||
      (event.activityEpochId && ids.activityEpochIds.has(event.activityEpochId)) ||
      (event.stallEpisodeId && ids.stallEpisodeIds.has(event.stallEpisodeId)) ||
      (event.cycleId && ids.cycleIds.has(event.cycleId)) ||
      (event.attemptId && ids.attemptIds.has(event.attemptId)),
  );
}

function compareHuntStallIncidentMediaPriority(
  left: HuntStallIncidentMediaFrame,
  right: HuntStallIncidentMediaFrame,
): number {
  return (
    getHuntStallIncidentMediaPriority(right) -
      getHuntStallIncidentMediaPriority(left) ||
    right.sampledAt - left.sampledAt ||
    left.id.localeCompare(right.id)
  );
}

function getHuntStallIncidentMediaPriority(
  entry: HuntStallIncidentMediaFrame,
): number {
  switch (entry.reason) {
    case "playback-failed":
      return 120;
    case "alert-decision":
      return 115;
    case "threshold":
      return 110;
    case "runtime-error":
      return 105;
    case "value-transition":
      return 100;
    case "rejected-observation":
      return 95;
    case "rearm":
      return 90;
    case "activity-anchor":
      return 80;
    case "current":
      return 40;
    case "periodic":
      return 10;
  }
}

function getSelectionSetSize(sets: Array<Set<string>>): number {
  return sets.reduce((total, set) => total + set.size, 0);
}

function getReportMetadataChars(report: Record<string, unknown>): number {
  return JSON.stringify(report, (key, value) =>
    (key === "rawDataUrl" || key === "processedDataUrl") &&
    typeof value === "string"
      ? undefined
      : value,
  ).length;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
