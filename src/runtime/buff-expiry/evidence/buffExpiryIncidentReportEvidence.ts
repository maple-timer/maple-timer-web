import type { BuffExpiryReportIncidentSelection } from "./buffExpiryIncidentEvidenceSelection";
import type {
  BuffExpiryIncidentConfigurationRevision,
  BuffExpiryIncidentCycle,
  BuffExpiryIncidentCycleEvent,
  BuffExpiryIncidentEpisode,
  BuffExpiryIncidentEpisodeTransition,
  BuffExpiryIncidentEvidenceOmission,
  BuffExpiryIncidentEpoch,
  BuffExpiryIncidentFrame,
  BuffExpiryIncidentFrozenState,
  BuffExpiryIncidentMedia,
  BuffExpiryIncidentObservation,
  BuffExpiryIncidentPlaybackAttempt,
  BuffExpiryIncidentRuntimeEvent,
  FrozenBuffExpiryIncidentEvidence,
} from "./buffExpiryIncidentEvidenceTypes";

export type BuffExpiryIncidentReportTimeFrame = {
  id: string;
  source: "report-time";
  sampledAt: number;
  sourcePath: "sample.source";
  parserPath: "sample.parser";
  stateBeforePath: "buffExpiry.stateBefore";
  stateAfterPath: "buffExpiry.state";
};

export type BuffExpiryIncidentReportEvidence = {
  schemaVersion: FrozenBuffExpiryIncidentEvidence["schemaVersion"];
  epoch: BuffExpiryIncidentEpoch;
  archiveUpdatedAt: number;
  frozenAt: number;
  frozenState: BuffExpiryIncidentFrozenState | null;
  selection: BuffExpiryReportIncidentSelection;
  frames: BuffExpiryIncidentFrame[];
  observations: BuffExpiryIncidentObservation[];
  episodes: BuffExpiryIncidentEpisode[];
  transitions: BuffExpiryIncidentEpisodeTransition[];
  cycles: BuffExpiryIncidentCycle[];
  cycleEvents: BuffExpiryIncidentCycleEvent[];
  attempts: BuffExpiryIncidentPlaybackAttempt[];
  runtimeEvents: BuffExpiryIncidentRuntimeEvent[];
  configurationRevisions: BuffExpiryIncidentConfigurationRevision[];
  media: BuffExpiryIncidentMedia[];
  omissions: BuffExpiryIncidentEvidenceOmission[];
  reportFrame: BuffExpiryIncidentReportTimeFrame;
};

export function createBuffExpiryIncidentReportEvidence({
  evidence,
  selection,
  reportSampledAt,
}: {
  evidence: FrozenBuffExpiryIncidentEvidence;
  selection: BuffExpiryReportIncidentSelection;
  reportSampledAt: number;
}): BuffExpiryIncidentReportEvidence {
  const frameIds = new Set(selection.frameIds);
  const observationIds = new Set(selection.observationIds);
  const episodeIds = new Set(selection.episodeIds);
  const cycleIds = new Set(selection.cycleIds);
  const attemptIds = new Set(selection.attemptIds);
  const eventIds = new Set(selection.eventIds);
  const configurationRevisionIds = new Set(
    selection.configurationRevisionIds,
  );
  const mediaFrameIds = new Set(selection.mediaFrameIds);

  for (const event of evidence.runtimeEvents) {
    if (!eventIds.has(event.id)) continue;
    if (event.frameId) frameIds.add(event.frameId);
    if (event.episodeId) episodeIds.add(event.episodeId);
    if (event.cycleId) cycleIds.add(event.cycleId);
    if (event.configRevision) {
      configurationRevisionIds.add(event.configRevision);
    }
  }

  for (const attempt of evidence.attempts) {
    if (attemptIds.has(attempt.id)) {
      cycleIds.add(attempt.cycleId);
    }
  }

  for (const cycle of evidence.cycles) {
    if (!cycleIds.has(cycle.id)) continue;
    cycle.episodeIds.forEach((id) => episodeIds.add(id));
    configurationRevisionIds.add(cycle.configRevision);
  }

  const transitionIds = new Set<string>();
  for (const episode of evidence.episodes) {
    if (!episodeIds.has(episode.id)) continue;
    episode.observationIds.forEach((id) => observationIds.add(id));
    episode.transitionIds.forEach((id) => transitionIds.add(id));
  }

  for (const transition of evidence.transitions) {
    if (!transitionIds.has(transition.id)) continue;
    if (transition.frameId) frameIds.add(transition.frameId);
    if (transition.observationId) {
      observationIds.add(transition.observationId);
    }
  }

  for (const observation of evidence.observations) {
    if (observationIds.has(observation.id)) {
      frameIds.add(observation.frameId);
    }
  }

  mediaFrameIds.forEach((id) => frameIds.add(id));
  if (evidence.frozenState?.configRevision) {
    configurationRevisionIds.add(evidence.frozenState.configRevision);
  }

  return {
    schemaVersion: evidence.schemaVersion,
    epoch: evidence.epoch,
    archiveUpdatedAt: evidence.updatedAt,
    frozenAt: evidence.frozenAt,
    frozenState: evidence.frozenState,
    selection,
    frames: evidence.frames.filter((entry) => frameIds.has(entry.id)),
    observations: evidence.observations.filter((entry) =>
      observationIds.has(entry.id),
    ),
    episodes: evidence.episodes.filter((entry) => episodeIds.has(entry.id)),
    transitions: evidence.transitions.filter((entry) =>
      transitionIds.has(entry.id),
    ),
    cycles: evidence.cycles.filter((entry) => cycleIds.has(entry.id)),
    cycleEvents: evidence.cycleEvents.filter((entry) =>
      cycleIds.has(entry.cycleId),
    ),
    attempts: evidence.attempts.filter((entry) => attemptIds.has(entry.id)),
    runtimeEvents: evidence.runtimeEvents.filter((entry) =>
      eventIds.has(entry.id),
    ),
    configurationRevisions: evidence.configurationRevisions.filter((entry) =>
      configurationRevisionIds.has(entry.id),
    ),
    media: evidence.media.filter((entry) => mediaFrameIds.has(entry.frameId)),
    omissions: evidence.omissions,
    reportFrame: {
      id: `buff-expiry-report-time:${Math.round(reportSampledAt)}`,
      source: "report-time",
      sampledAt: reportSampledAt,
      sourcePath: "sample.source",
      parserPath: "sample.parser",
      stateBeforePath: "buffExpiry.stateBefore",
      stateAfterPath: "buffExpiry.state",
    },
  };
}
