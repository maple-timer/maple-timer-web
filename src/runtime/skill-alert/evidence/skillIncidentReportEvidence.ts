import type { SkillReportIncidentSelection } from "./skillIncidentEvidenceSelection";
import {
  SKILL_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
  SKILL_INCIDENT_METADATA_MAX_CHARS,
} from "./skillIncidentEvidenceArchive";
import type {
  FrozenSkillIncidentEvidence,
  SkillIncidentAlertDecision,
  SkillIncidentConfigurationRevision,
  SkillIncidentCycle,
  SkillIncidentEpoch,
  SkillIncidentEvidenceOmission,
  SkillIncidentFrame,
  SkillIncidentLifecycleEvent,
  SkillIncidentMedia,
  SkillIncidentObservation,
  SkillIncidentPlaybackAttempt,
  SkillIncidentTargetArbitration,
} from "./skillIncidentEvidenceTypes";

export type SkillIncidentReportTimeFrame = {
  id: string;
  source: "report-time";
  sampledAt: number;
  sourcePath: "sample.source";
  parserPath: "sample.parser";
  stateBeforePath: "skill.stateBefore";
  stateAfterPath: "skill.state";
};

export const SKILL_INCIDENT_REPORT_MAX_MEDIA = 12;
export const SKILL_INCIDENT_REPORT_REQUEST_TARGET_CHARS = 2 * 1024 * 1024;

export type SkillIncidentReportBudget = {
  version: 1;
  metadataLimitChars: number;
  metadataChars: number;
  mediaLimitCount: number;
  mediaCount: number;
  mediaLimitChars: number;
  mediaChars: number;
  requestTargetChars: number;
  requestChars: number;
  droppedMediaIds: string[];
  overMetadataLimit: boolean;
  overMediaLimit: boolean;
  overRequestTarget: boolean;
};

export type SkillIncidentReportEvidence = {
  schemaVersion: FrozenSkillIncidentEvidence["schemaVersion"];
  archiveUpdatedAt: number;
  frozenAt: number;
  selectedSkillId: string;
  leaseId: string;
  selection: SkillReportIncidentSelection;
  epochs: SkillIncidentEpoch[];
  frames: SkillIncidentFrame[];
  observations: SkillIncidentObservation[];
  cycles: SkillIncidentCycle[];
  decisions: SkillIncidentAlertDecision[];
  arbitrations: SkillIncidentTargetArbitration[];
  playbackAttempts: SkillIncidentPlaybackAttempt[];
  lifecycle: SkillIncidentLifecycleEvent[];
  configurations: SkillIncidentConfigurationRevision[];
  media: SkillIncidentMedia[];
  omissions: SkillIncidentEvidenceOmission[];
  reportFrame: SkillIncidentReportTimeFrame;
  budget: SkillIncidentReportBudget;
};

export function createSkillIncidentReportEvidence({
  evidence,
  selection,
  reportSampledAt,
}: {
  evidence: FrozenSkillIncidentEvidence;
  selection: SkillReportIncidentSelection;
  reportSampledAt: number;
}): SkillIncidentReportEvidence {
  const frameIds = new Set(selection.frameIds);
  const observationIds = new Set(selection.observationIds);
  const cycleIds = new Set(selection.cycleIds);
  const decisionIds = new Set(selection.decisionIds);
  const arbitrationIds = new Set(selection.arbitrationIds);
  const attemptIds = new Set(selection.attemptIds);
  const eventIds = new Set(selection.eventIds);
  const configurationRevisionIds = new Set(
    selection.configurationRevisionIds,
  );
  const mediaIds = new Set(selection.mediaIds);
  const epochIds = new Set(selection.epochId ? [selection.epochId] : []);

  for (let pass = 0; pass < 8; pass += 1) {
    const sizeBefore = getSelectionSetSize([
      epochIds,
      frameIds,
      observationIds,
      cycleIds,
      decisionIds,
      arbitrationIds,
      attemptIds,
      eventIds,
      configurationRevisionIds,
      mediaIds,
    ]);
    for (const attempt of evidence.attempts) {
      if (!attemptIds.has(attempt.id)) continue;
      decisionIds.add(attempt.decisionId);
      cycleIds.add(attempt.cycleId);
      epochIds.add(attempt.epochId);
    }
    for (const arbitration of evidence.arbitrations) {
      if (!arbitrationIds.has(arbitration.id)) continue;
      arbitration.decisionIds.forEach((id) => decisionIds.add(id));
    }
    for (const decision of evidence.decisions) {
      if (!decisionIds.has(decision.id)) continue;
      cycleIds.add(decision.cycleId);
      epochIds.add(decision.epochId);
      if (decision.frameId) frameIds.add(decision.frameId);
      if (decision.observationId) observationIds.add(decision.observationId);
      if (decision.arbitrationId) arbitrationIds.add(decision.arbitrationId);
      if (decision.attemptId) attemptIds.add(decision.attemptId);
      configurationRevisionIds.add(decision.configRevisionId);
    }
    for (const cycle of evidence.cycles) {
      if (!cycleIds.has(cycle.id)) continue;
      epochIds.add(cycle.epochId);
      cycle.observationIds.forEach((id) => observationIds.add(id));
      cycle.anchorObservationIds.forEach((id) => observationIds.add(id));
      cycle.decisionIds.forEach((id) => decisionIds.add(id));
      cycle.configRevisionIds.forEach((id) =>
        configurationRevisionIds.add(id),
      );
    }
    for (const observation of evidence.observations) {
      if (!observationIds.has(observation.id)) continue;
      epochIds.add(observation.epochId);
      frameIds.add(observation.frameId);
      observation.mediaIds.forEach((id) => mediaIds.add(id));
    }
    for (const frame of evidence.frames) {
      if (!frameIds.has(frame.id)) continue;
      epochIds.add(frame.epochId);
      frame.observationIds.forEach((id) => observationIds.add(id));
      frame.mediaIds.forEach((id) => mediaIds.add(id));
      configurationRevisionIds.add(frame.configRevisionId);
    }
    for (const event of evidence.lifecycleEvents) {
      if (!eventIds.has(event.id)) continue;
      if (event.epochId) epochIds.add(event.epochId);
      if (event.frameId) frameIds.add(event.frameId);
      if (event.cycleId) cycleIds.add(event.cycleId);
      if (event.configRevisionId) {
        configurationRevisionIds.add(event.configRevisionId);
      }
    }
    const sizeAfter = getSelectionSetSize([
      epochIds,
      frameIds,
      observationIds,
      cycleIds,
      decisionIds,
      arbitrationIds,
      attemptIds,
      eventIds,
      configurationRevisionIds,
      mediaIds,
    ]);
    if (sizeAfter === sizeBefore) {
      break;
    }
  }

  const selectedIds = new Set([
    ...epochIds,
    ...frameIds,
    ...observationIds,
    ...cycleIds,
    ...decisionIds,
    ...arbitrationIds,
    ...attemptIds,
    ...eventIds,
    ...configurationRevisionIds,
    ...mediaIds,
  ]);

  const selectedMedia = evidence.media.filter((entry) => mediaIds.has(entry.id));
  const retainedMedia = [...selectedMedia]
    .sort(compareSkillIncidentMediaPriority)
    .slice(0, SKILL_INCIDENT_REPORT_MAX_MEDIA)
    .sort(
      (left, right) =>
        left.capturedAt - right.capturedAt || left.id.localeCompare(right.id),
    );
  const retainedMediaIds = new Set(retainedMedia.map((entry) => entry.id));
  const droppedMediaIds = selectedMedia
    .filter((entry) => !retainedMediaIds.has(entry.id))
    .map((entry) => entry.id);
  const reportSelection = droppedMediaIds.length
    ? {
        ...selection,
        support: "partial" as const,
        degradationReasons: unique([
          ...selection.degradationReasons,
          "payload-compacted" as const,
        ]),
      }
    : selection;
  const reportFrame: SkillIncidentReportTimeFrame = {
    id: `skill-report-time:${Math.round(reportSampledAt)}`,
    source: "report-time",
    sampledAt: reportSampledAt,
    sourcePath: "sample.source",
    parserPath: "sample.parser",
    stateBeforePath: "skill.stateBefore",
    stateAfterPath: "skill.state",
  };
  const omissions = evidence.omissions.filter(
    (entry) =>
      entry.subjectIds.length === 0 ||
      entry.subjectIds.some((id) => selectedIds.has(id)),
  );
  if (droppedMediaIds.length > 0) {
    omissions.push({
      id: `skill-report-payload-compacted:${evidence.leaseId}`,
      occurredAt: evidence.frozenAt,
      kind: "media",
      reason: "payload-compacted",
      subjectIds: droppedMediaIds,
      count: droppedMediaIds.length,
    });
  }
  const report = {
    schemaVersion: evidence.schemaVersion,
    archiveUpdatedAt: evidence.updatedAt,
    frozenAt: evidence.frozenAt,
    selectedSkillId: evidence.selectedSkillId,
    leaseId: evidence.leaseId,
    selection: reportSelection,
    epochs: evidence.epochs.filter((entry) => epochIds.has(entry.id)),
    frames: evidence.frames.filter((entry) => frameIds.has(entry.id)),
    observations: evidence.observations.filter((entry) =>
      observationIds.has(entry.id),
    ),
    cycles: evidence.cycles.filter((entry) => cycleIds.has(entry.id)),
    decisions: evidence.decisions.filter((entry) =>
      decisionIds.has(entry.id),
    ),
    arbitrations: evidence.arbitrations.filter((entry) =>
      arbitrationIds.has(entry.id),
    ),
    playbackAttempts: evidence.attempts.filter((entry) =>
      attemptIds.has(entry.id),
    ),
    lifecycle: evidence.lifecycleEvents.filter((entry) =>
      eventIds.has(entry.id),
    ),
    configurations: evidence.configurationRevisions.filter((entry) =>
      configurationRevisionIds.has(entry.id),
    ),
    media: retainedMedia,
    omissions,
    reportFrame,
  };
  const metadataChars = getReportMetadataChars(report);
  const mediaChars = retainedMedia.reduce(
    (total, entry) => total + entry.dataUrl.length,
    0,
  );
  const requestChars = JSON.stringify(report).length;
  return {
    ...report,
    budget: {
      version: 1,
      metadataLimitChars: SKILL_INCIDENT_METADATA_MAX_CHARS,
      metadataChars,
      mediaLimitCount: SKILL_INCIDENT_REPORT_MAX_MEDIA,
      mediaCount: retainedMedia.length,
      mediaLimitChars: SKILL_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
      mediaChars,
      requestTargetChars: SKILL_INCIDENT_REPORT_REQUEST_TARGET_CHARS,
      requestChars,
      droppedMediaIds,
      overMetadataLimit: metadataChars > SKILL_INCIDENT_METADATA_MAX_CHARS,
      overMediaLimit:
        retainedMedia.length > SKILL_INCIDENT_REPORT_MAX_MEDIA ||
        mediaChars > SKILL_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
      overRequestTarget:
        requestChars > SKILL_INCIDENT_REPORT_REQUEST_TARGET_CHARS,
    },
  };
}

function getSelectionSetSize(sets: Array<Set<string>>): number {
  return sets.reduce((total, set) => total + set.size, 0);
}

function getReportMetadataChars(report: Record<string, unknown>): number {
  return JSON.stringify(report, (key, value) =>
    key === "dataUrl" && typeof value === "string" ? undefined : value,
  ).length;
}

function compareSkillIncidentMediaPriority(
  left: SkillIncidentMedia,
  right: SkillIncidentMedia,
): number {
  return (
    getSkillIncidentMediaPriority(right) - getSkillIncidentMediaPriority(left) ||
    right.capturedAt - left.capturedAt ||
    left.id.localeCompare(right.id)
  );
}

function getSkillIncidentMediaPriority(entry: SkillIncidentMedia): number {
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

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
