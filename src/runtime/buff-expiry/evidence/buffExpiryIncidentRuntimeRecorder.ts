import type { BuffExpiryTargetGroup } from "../../../contracts/recognition/buffExpiryRecognition";
import {
  getBuffExpiryPrecisionGroupFromBuffId,
} from "../../../domain/buff-expiry/precisionTrackingPolicy";
import type {
  BuffExpiryBox,
  BuffExpiryPendingTrack,
  BuffExpiryTrackedBuff,
} from "../../../domain/buff-expiry/precisionTrackingTypes";
import type {
  BuffExpiryRuntimeState,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type {
  BuffExpiryPrecisionBox,
  BuffExpiryPrecisionBestGroupCandidate,
  BuffExpiryPrecisionBuffSlotLocalization,
  BuffExpiryPrecisionIconObservation,
  BuffExpiryPrecisionModuleVersions,
} from "../analysis/buffExpiryPrecisionAnalysisRuntime";
import { assignBuffExpiryPrecisionBoxLayout } from "../analysis/buffExpiryPrecisionLayout";
import type {
  BuffExpiryPrecisionRecentRoiFrame,
} from "./buffExpiryPrecisionRoiHistory";
import {
  createBuffExpiryIncidentEvidenceArchive,
  updateBuffExpiryIncidentEvidenceArchive,
} from "./buffExpiryIncidentEvidenceArchive";
import type {
  BuffExpiryIncidentConfigurationRevision,
  BuffExpiryIncidentCycle,
  BuffExpiryIncidentCycleEvent,
  BuffExpiryIncidentCycleEventStatus,
  BuffExpiryIncidentEpisode,
  BuffExpiryIncidentEpisodeTransition,
  BuffExpiryIncidentEvidenceArchive,
  BuffExpiryIncidentFrame,
  BuffExpiryIncidentMedia,
  BuffExpiryIncidentMediaReason,
  BuffExpiryIncidentObservation,
  BuffExpiryIncidentPlaybackAttempt,
  BuffExpiryIncidentRuntimeEvent,
  BuffExpiryIncidentRuntimeState,
} from "./buffExpiryIncidentEvidenceTypes";
import {
  createBuffExpiryIncidentAttemptId,
  createBuffExpiryIncidentCycleId,
  createBuffExpiryIncidentEpisodeId,
  createBuffExpiryIncidentEpochId,
  createBuffExpiryIncidentFrameId,
  createBuffExpiryIncidentObservationId,
} from "./buffExpiryIncidentEvidenceTypes";

type EpisodePhase = "pending" | "confirmed";

type RuntimeEpisodeBinding = {
  episodeId: string;
  group: BuffExpiryTargetGroup;
  phase: EpisodePhase;
  lineageStartedAt: number;
  missed: boolean;
};

type RuntimeTrackDescriptor = {
  runtimeId: string;
  group: BuffExpiryTargetGroup;
  phase: EpisodePhase;
  lineageStartedAt: number | null;
  lastSeenAt: number;
  expiresAt: number | null;
  alertedAt: number | null;
  box: BuffExpiryBox;
};

export type BuffExpiryIncidentRuntimeRecorder = {
  archive: BuffExpiryIncidentEvidenceArchive;
  frameSequence: number;
  episodeSequenceByGroup: Record<BuffExpiryTargetGroup, number>;
  transitionSequence: number;
  runtimeEventSequence: number;
  cycleEventSequence: number;
  attemptSequenceByCycle: Record<string, number>;
  bindingsByRuntimeId: Record<string, RuntimeEpisodeBinding>;
  activeConfigurationRevisionId: string | null;
};

export type BuffExpiryIncidentSampleParser = BuffExpiryIncidentFrame["parser"];

export type BuffExpiryIncidentSampleInput = {
  sampledAt: number;
  source?: BuffExpiryIncidentFrame["source"];
  selectedGroups: readonly BuffExpiryTargetGroup[];
  stateBefore: BuffExpiryRuntimeState;
  stateAfter: BuffExpiryRuntimeState;
  iconObservations: BuffExpiryPrecisionIconObservation[];
  bestByGroup: BuffExpiryPrecisionBestGroupCandidate[];
  parserBoxes?: Array<
    Pick<BuffExpiryPrecisionBox, "x" | "y" | "size"> &
      Partial<Pick<BuffExpiryPrecisionBox, "row" | "col">>
  >;
  buffSlotLocalization?: BuffExpiryPrecisionBuffSlotLocalization | null;
  moduleVersions?: BuffExpiryPrecisionModuleVersions | null;
  parser: BuffExpiryIncidentSampleParser;
  runtimeFailure?: BuffExpiryIncidentFrame["runtimeFailure"];
  configuration: Record<string, unknown>;
  recentRoiFrames?: BuffExpiryPrecisionRecentRoiFrame[];
};

export function createBuffExpiryIncidentRuntimeRecorder({
  now = Date.now(),
  captureGeneration = 1,
  featureGeneration = 1,
  reason = "runtime-created",
}: {
  now?: number;
  captureGeneration?: number;
  featureGeneration?: number;
  reason?: string;
} = {}): BuffExpiryIncidentRuntimeRecorder {
  const epoch = {
    id: createBuffExpiryIncidentEpochId({
      captureGeneration,
      featureGeneration,
    }),
    captureGeneration,
    featureGeneration,
    createdAt: now,
    reason,
  };
  return {
    archive: createBuffExpiryIncidentEvidenceArchive({ epoch, now }),
    frameSequence: 0,
    episodeSequenceByGroup: {
      unionWealth: 0,
      unionLuck: 0,
      potion: 0,
      expCoupon: 0,
    },
    transitionSequence: 0,
    runtimeEventSequence: 0,
    cycleEventSequence: 0,
    attemptSequenceByCycle: {},
    bindingsByRuntimeId: {},
    activeConfigurationRevisionId: null,
  };
}

export function resetBuffExpiryIncidentRuntimeRecorder({
  previous,
  now = Date.now(),
  reason,
  captureChanged = false,
}: {
  previous: BuffExpiryIncidentRuntimeRecorder;
  now?: number;
  reason: string;
  captureChanged?: boolean;
}): BuffExpiryIncidentRuntimeRecorder {
  const captureGeneration =
    previous.archive.epoch.captureGeneration + (captureChanged ? 1 : 0);
  const featureGeneration =
    previous.archive.epoch.featureGeneration + (captureChanged ? 0 : 1);
  const next = createBuffExpiryIncidentRuntimeRecorder({
    now,
    captureGeneration,
    featureGeneration,
    reason,
  });
  next.archive = updateBuffExpiryIncidentEvidenceArchive({
    previous: previous.archive,
    epoch: next.archive.epoch,
    patch: {},
    now,
  });
  return next;
}

export function recordBuffExpiryIncidentSample({
  previous,
  input,
}: {
  previous: BuffExpiryIncidentRuntimeRecorder;
  input: BuffExpiryIncidentSampleInput;
}): BuffExpiryIncidentRuntimeRecorder {
  const frameSequence = previous.frameSequence + 1;
  const frameId = createBuffExpiryIncidentFrameId(
    previous.archive.epoch.id,
    frameSequence,
  );
  const configuration = ensureConfigurationRevision({
    previous,
    capturedAt: input.sampledAt,
    values: input.configuration,
  });
  let recorder = configuration.recorder;
  const bindingsBefore = { ...recorder.bindingsByRuntimeId };
  const previousDescriptors = collectRuntimeTrackDescriptors(input.stateBefore);
  const nextDescriptors = collectRuntimeTrackDescriptors(input.stateAfter);
  const nextDescriptorById = new Map(
    nextDescriptors.map((descriptor) => [descriptor.runtimeId, descriptor]),
  );
  const episodesById = new Map(
    recorder.archive.episodes.map((episode) => [episode.id, { ...episode }]),
  );
  const transitions: BuffExpiryIncidentEpisodeTransition[] = [];
  const bindingsAfter: Record<string, RuntimeEpisodeBinding> = {};
  let transitionSequence = recorder.transitionSequence;
  let episodeSequenceByGroup = { ...recorder.episodeSequenceByGroup };

  const appendTransition = ({
    episode,
    occurredAt,
    kind,
    observationId = null,
    countdownSeconds = null,
    reason = null,
  }: {
    episode: BuffExpiryIncidentEpisode;
    occurredAt: number;
    kind: BuffExpiryIncidentEpisodeTransition["kind"];
    observationId?: string | null;
    countdownSeconds?: number | null;
    reason?: string | null;
  }) => {
    transitionSequence += 1;
    const transition: BuffExpiryIncidentEpisodeTransition = {
      id: `buff-expiry-transition:${recorder.archive.epoch.id}:${transitionSequence}`,
      episodeId: episode.id,
      occurredAt,
      kind,
      frameId,
      observationId,
      countdownSeconds,
      reason,
    };
    transitions.push(transition);
    episode.transitionIds = appendUnique(episode.transitionIds, transition.id);
    episode.lastEventAt = Math.max(episode.lastEventAt, occurredAt);
  };

  const terminateBinding = (
    binding: RuntimeEpisodeBinding,
    kind: "lost" | "replaced",
    reason: string,
  ) => {
    const episode = episodesById.get(binding.episodeId);
    if (!episode || episode.status === "terminal") {
      return;
    }
    episode.status = "terminal";
    episode.endedAt = input.sampledAt;
    episode.terminalReason = reason;
    appendTransition({
      episode,
      occurredAt: input.sampledAt,
      kind,
      reason,
    });
  };

  for (const [runtimeId, binding] of Object.entries(bindingsBefore)) {
    const nextDescriptor = nextDescriptorById.get(runtimeId);
    if (!nextDescriptor) {
      terminateBinding(binding, "lost", "runtime-track-removed");
      continue;
    }
    if (isReplacement(binding, nextDescriptor)) {
      terminateBinding(binding, "replaced", "runtime-track-generation-changed");
    }
  }

  for (const descriptor of nextDescriptors) {
    const existing = bindingsBefore[descriptor.runtimeId];
    const canReuse = existing && !isReplacement(existing, descriptor);
    let binding = canReuse ? { ...existing } : null;
    let episode = binding ? episodesById.get(binding.episodeId) ?? null : null;

    if (!binding || !episode || episode.status === "terminal") {
      const sequence = episodeSequenceByGroup[descriptor.group] + 1;
      episodeSequenceByGroup[descriptor.group] = sequence;
      const episodeId = createBuffExpiryIncidentEpisodeId({
        epochId: recorder.archive.epoch.id,
        group: descriptor.group,
        sequence,
      });
      binding = {
        episodeId,
        group: descriptor.group,
        phase: descriptor.phase,
        lineageStartedAt:
          descriptor.lineageStartedAt ?? descriptor.lastSeenAt,
        missed: false,
      };
      episode = {
        id: episodeId,
        epochId: recorder.archive.epoch.id,
        group: descriptor.group,
        sequence,
        status: descriptor.phase,
        startedAt: binding.lineageStartedAt,
        confirmedAt:
          descriptor.phase === "confirmed" ? input.sampledAt : null,
        lastEventAt: input.sampledAt,
        endedAt: null,
        terminalReason: null,
        observationIds: [],
        transitionIds: [],
        cycleIds: [],
      };
      episodesById.set(episodeId, episode);
      appendTransition({
        episode,
        occurredAt: input.sampledAt,
        kind: descriptor.phase,
        reason:
          descriptor.phase === "confirmed"
            ? "runtime-confirmed-adopted"
            : "runtime-pending-created",
      });
    } else if (binding.phase === "pending" && descriptor.phase === "confirmed") {
      binding.phase = "confirmed";
      binding.missed = false;
      episode.status = "confirmed";
      episode.confirmedAt = input.sampledAt;
      appendTransition({
        episode,
        occurredAt: input.sampledAt,
        kind: "confirmed",
        reason: "tracking-confirmed",
      });
    } else {
      const isObserved = descriptor.lastSeenAt === input.sampledAt;
      if (isObserved) {
        if (binding.missed) {
          appendTransition({
            episode,
            occurredAt: input.sampledAt,
            kind: "observed",
            reason: "tracking-resumed",
          });
        }
        binding.missed = false;
      } else if (!binding.missed) {
        binding.missed = true;
        appendTransition({
          episode,
          occurredAt: input.sampledAt,
          kind: "temporarily-missed",
          reason: "track-retained-without-current-observation",
        });
      }

      const previousDescriptor = previousDescriptors.find(
        (item) => item.runtimeId === descriptor.runtimeId,
      );
      if (
        descriptor.phase === "confirmed" &&
        previousDescriptor !== undefined &&
        previousDescriptor.expiresAt !== null &&
        descriptor.expiresAt !== null &&
        previousDescriptor.expiresAt !== descriptor.expiresAt
      ) {
        appendTransition({
          episode,
          occurredAt: input.sampledAt,
          kind: "refreshed",
          reason: "predicted-expiry-updated",
        });
      }
    }

    bindingsAfter[descriptor.runtimeId] = binding;
  }

  const observations = createIncidentObservations({
    frameId,
    epochId: recorder.archive.epoch.id,
    sampledAt: input.sampledAt,
    selectedGroups: [...input.selectedGroups],
    iconObservations: input.iconObservations,
    bestByGroup: input.bestByGroup,
    nextDescriptors,
    bindingsAfter,
  });

  for (const observation of observations) {
    if (!observation.episodeId) {
      continue;
    }
    const episode = episodesById.get(observation.episodeId);
    if (!episode) {
      continue;
    }
    episode.observationIds = appendUnique(
      episode.observationIds,
      observation.id,
    );
    const countdown = observation.countdown;
    if (
      observation.targetAccepted &&
      countdown &&
      countdown.decision !== "accepted"
    ) {
      appendTransition({
        episode,
        occurredAt: input.sampledAt,
        kind: "countdown-rejected",
        observationId: observation.id,
        countdownSeconds: countdown.seconds,
        reason: countdown.reason ?? countdown.decision,
      });
    }
  }

  const media = createIncidentMedia({
    frameId,
    sampledAt: input.sampledAt,
    recentRoiFrames: input.recentRoiFrames ?? [],
  });
  const frame: BuffExpiryIncidentFrame = {
    id: frameId,
    epochId: recorder.archive.epoch.id,
    sequence: frameSequence,
    sampledAt: input.sampledAt,
    source: input.source ?? "runtime",
    parser: withModuleVersions(input.parser, input.moduleVersions),
    recognition: createIncidentRecognitionSummary(input),
    selectedGroups: [...input.selectedGroups],
    observationIds: observations.map((observation) => observation.id),
    stateBefore: createIncidentRuntimeState({
      status: input.stateBefore.status,
      descriptors: previousDescriptors,
      bindings: bindingsBefore,
      archive: recorder.archive,
    }),
    stateAfter: createIncidentRuntimeState({
      status: input.stateAfter.status,
      descriptors: nextDescriptors,
      bindings: bindingsAfter,
      archive: recorder.archive,
    }),
    runtimeFailure: input.runtimeFailure ?? null,
    mediaFrameId: media ? frameId : null,
  };

  recorder = {
    ...recorder,
    frameSequence,
    episodeSequenceByGroup,
    transitionSequence,
    bindingsByRuntimeId: bindingsAfter,
    archive: updateBuffExpiryIncidentEvidenceArchive({
      previous: recorder.archive,
      epoch: recorder.archive.epoch,
      now: input.sampledAt,
      patch: {
        frames: [frame],
        observations,
        episodes: [...episodesById.values()],
        transitions,
        media: media ? [media] : [],
      },
    }),
  };
  return recorder;
}

function createIncidentRecognitionSummary(
  input: Pick<
    BuffExpiryIncidentSampleInput,
    | "parserBoxes"
    | "buffSlotLocalization"
    | "iconObservations"
    | "bestByGroup"
    | "selectedGroups"
  >,
): BuffExpiryIncidentFrame["recognition"] {
  const selectedGroups = new Set(input.selectedGroups);
  const selectedCandidates = input.bestByGroup.filter((candidate) =>
    selectedGroups.has(candidate.group),
  );
  if (input.parserBoxes === undefined) {
    return {
      parserBoxCount: null,
      parsedRowCount: null,
      localizedBoxCount:
        input.buffSlotLocalization?.localizedBoxCount ?? null,
      localizedRowCount:
        input.buffSlotLocalization?.localizedRowCount ?? null,
      spatialExcludedBoxCount:
        input.buffSlotLocalization?.spatialExcludedBoxCount ?? null,
      localizationStatus: input.buffSlotLocalization?.status ?? null,
      localizationReason: input.buffSlotLocalization?.reason ?? null,
      localizationVersion: input.buffSlotLocalization?.version ?? null,
      upperExcludedBoxCount: null,
      eligibleBoxCount: null,
      matcherObservationCount: input.iconObservations.length,
      selectedCandidateCount: selectedCandidates.length,
      acceptedTargetCount: selectedCandidates.filter((candidate) => candidate.accepted).length,
    };
  }

  const boxes = assignBuffExpiryPrecisionBoxLayout(
    input.parserBoxes.map((box) => ({
      x: box.x,
      y: box.y,
      size: box.size,
    })),
  );
  const rows = [...new Set(boxes.map((box) => Math.round(box.row)))].sort(
    (left, right) => left - right,
  );
  const excludedRows = new Set(rows.slice(0, Math.floor(rows.length / 2)));
  const upperExcludedBoxCount = boxes.filter((box) =>
    excludedRows.has(Math.round(box.row)),
  ).length;

  return {
    parserBoxCount:
      input.buffSlotLocalization?.parserBoxCount ?? boxes.length,
    parsedRowCount:
      input.buffSlotLocalization?.parserRowCount ?? rows.length,
    localizedBoxCount:
      input.buffSlotLocalization?.localizedBoxCount ?? boxes.length,
    localizedRowCount:
      input.buffSlotLocalization?.localizedRowCount ?? rows.length,
    spatialExcludedBoxCount:
      input.buffSlotLocalization?.spatialExcludedBoxCount ?? 0,
    localizationStatus: input.buffSlotLocalization?.status ?? null,
    localizationReason: input.buffSlotLocalization?.reason ?? null,
    localizationVersion: input.buffSlotLocalization?.version ?? null,
    upperExcludedBoxCount,
    eligibleBoxCount: boxes.length - upperExcludedBoxCount,
    matcherObservationCount: input.iconObservations.length,
    selectedCandidateCount: selectedCandidates.length,
    acceptedTargetCount: selectedCandidates.filter((candidate) => candidate.accepted).length,
  };
}

export function getBuffExpiryIncidentEpisodeIdsForTracks(
  recorder: BuffExpiryIncidentRuntimeRecorder,
  tracks: Array<Pick<BuffExpiryTrackedBuff, "id">>,
): string[] {
  return unique(
    tracks.flatMap((track) => {
      const episodeId = recorder.bindingsByRuntimeId[track.id]?.episodeId;
      return episodeId ? [episodeId] : [];
    }),
  ).sort();
}

export function registerBuffExpiryIncidentCycle({
  previous,
  episodeIds,
  dueAt,
  occurredAt,
  configuration,
  frameId = null,
}: {
  previous: BuffExpiryIncidentRuntimeRecorder;
  episodeIds: string[];
  dueAt: number;
  occurredAt: number;
  configuration: Record<string, unknown>;
  frameId?: string | null;
}): { recorder: BuffExpiryIncidentRuntimeRecorder; cycleId: string } {
  const configurationResult = ensureConfigurationRevision({
    previous,
    capturedAt: occurredAt,
    values: configuration,
  });
  let recorder = configurationResult.recorder;
  const sortedEpisodeIds = unique(episodeIds).sort();
  const cycleId = createBuffExpiryIncidentCycleId({
    epochId: recorder.archive.epoch.id,
    dueAt,
    episodeIds: sortedEpisodeIds,
    configRevision: configurationResult.revisionId,
  });
  const existing = recorder.archive.cycles.find((cycle) => cycle.id === cycleId);
  if (existing) {
    return { recorder, cycleId };
  }

  const eventResult = createCycleEvent({
    recorder,
    cycleId,
    occurredAt,
    status: "registered",
    reason: null,
    frameId,
  });
  recorder = eventResult.recorder;
  const cycle: BuffExpiryIncidentCycle = {
    id: cycleId,
    epochId: recorder.archive.epoch.id,
    episodeIds: sortedEpisodeIds,
    dueAt,
    configRevision: configurationResult.revisionId,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    status: "registered",
    eventIds: [eventResult.event.id],
  };
  const scheduledTransitions = appendSchedulerTransitions({
    recorder,
    episodes: recorder.archive.episodes
      .filter((episode) => sortedEpisodeIds.includes(episode.id))
      .map((episode) => ({
        ...episode,
        cycleIds: appendUnique(episode.cycleIds, cycleId),
      })),
    occurredAt,
    kind: "scheduled",
    reason: null,
  });
  recorder = {
    ...recorder,
    transitionSequence: scheduledTransitions.transitionSequence,
    archive: updateBuffExpiryIncidentEvidenceArchive({
      previous: recorder.archive,
      epoch: recorder.archive.epoch,
      patch: {
        cycles: [cycle],
        cycleEvents: [eventResult.event],
        episodes: scheduledTransitions.episodes,
        transitions: scheduledTransitions.transitions,
      },
      now: occurredAt,
    }),
  };
  return { recorder, cycleId };
}

export function recordBuffExpiryIncidentCycleStatus({
  previous,
  cycleId,
  occurredAt,
  status,
  reason = null,
  frameId = null,
}: {
  previous: BuffExpiryIncidentRuntimeRecorder;
  cycleId: string;
  occurredAt: number;
  status: Exclude<BuffExpiryIncidentCycleEventStatus, "registered">;
  reason?: string | null;
  frameId?: string | null;
}): BuffExpiryIncidentRuntimeRecorder {
  const cycle = previous.archive.cycles.find((entry) => entry.id === cycleId);
  if (!cycle) {
    // Timer cleanup may run after a reset has intentionally started a new epoch.
    if (status === "cancelled") {
      return previous;
    }
    return recordRuntimeEvent({
      previous,
      occurredAt,
      category: "runtime-error",
      action: "cycle-status-without-registration",
      cycleId,
      details: { status, reason },
    });
  }
  const eventResult = createCycleEvent({
    recorder: previous,
    cycleId,
    occurredAt,
    status,
    reason,
    frameId,
  });
  const nextCycle: BuffExpiryIncidentCycle = {
    ...cycle,
    updatedAt: occurredAt,
    status,
    eventIds: appendUnique(cycle.eventIds, eventResult.event.id),
  };
  const transitions = status === "fired"
    ? appendSchedulerTransitions({
        recorder: eventResult.recorder,
        episodes: previous.archive.episodes.filter((episode) =>
          cycle.episodeIds.includes(episode.id),
        ),
        occurredAt,
        kind: "alerted",
        reason,
      })
    : {
        episodes: [] as BuffExpiryIncidentEpisode[],
        transitions: [] as BuffExpiryIncidentEpisodeTransition[],
        transitionSequence: eventResult.recorder.transitionSequence,
      };
  return {
    ...eventResult.recorder,
    transitionSequence: transitions.transitionSequence,
    archive: updateBuffExpiryIncidentEvidenceArchive({
      previous: eventResult.recorder.archive,
      epoch: eventResult.recorder.archive.epoch,
      patch: {
        cycles: [nextCycle],
        cycleEvents: [eventResult.event],
        episodes: transitions.episodes,
        transitions: transitions.transitions,
      },
      now: occurredAt,
    }),
  };
}

export function recordBuffExpiryIncidentPlaybackRequested({
  previous,
  cycleId,
  requestedAt,
  soundId,
  featureVolume,
  masterVolume,
  effectiveVolume,
  visibilityState,
}: {
  previous: BuffExpiryIncidentRuntimeRecorder;
  cycleId: string;
  requestedAt: number;
  soundId: string;
  featureVolume: number;
  masterVolume: number;
  effectiveVolume: number;
  visibilityState: string | null;
}): {
  recorder: BuffExpiryIncidentRuntimeRecorder;
  attemptId: string;
} {
  const sequence = (previous.attemptSequenceByCycle[cycleId] ?? 0) + 1;
  const attemptId = createBuffExpiryIncidentAttemptId(cycleId, sequence);
  const attempt: BuffExpiryIncidentPlaybackAttempt = {
    id: attemptId,
    cycleId,
    sequence,
    requestedAt,
    startedAt: null,
    failedAt: null,
    status: "requested",
    error: null,
    soundId,
    featureVolume,
    masterVolume,
    effectiveVolume,
    visibilityState,
  };
  return {
    attemptId,
    recorder: {
      ...previous,
      attemptSequenceByCycle: {
        ...previous.attemptSequenceByCycle,
        [cycleId]: sequence,
      },
      archive: updateBuffExpiryIncidentEvidenceArchive({
        previous: previous.archive,
        epoch: previous.archive.epoch,
        patch: { attempts: [attempt] },
        now: requestedAt,
      }),
    },
  };
}

export function recordBuffExpiryIncidentPlaybackResult({
  previous,
  attemptId,
  occurredAt,
  status,
  error = null,
}: {
  previous: BuffExpiryIncidentRuntimeRecorder;
  attemptId: string;
  occurredAt: number;
  status: "started" | "failed";
  error?: string | null;
}): BuffExpiryIncidentRuntimeRecorder {
  const attempt = previous.archive.attempts.find((entry) => entry.id === attemptId);
  if (!attempt) {
    return recordRuntimeEvent({
      previous,
      occurredAt,
      category: "runtime-error",
      action: "playback-result-without-request",
      details: { attemptId, status, error },
    });
  }
  const nextAttempt: BuffExpiryIncidentPlaybackAttempt = {
    ...attempt,
    status,
    startedAt: status === "started" ? occurredAt : attempt.startedAt,
    failedAt: status === "failed" ? occurredAt : attempt.failedAt,
    error: status === "failed" ? error : attempt.error,
  };
  return {
    ...previous,
    archive: updateBuffExpiryIncidentEvidenceArchive({
      previous: previous.archive,
      epoch: previous.archive.epoch,
      patch: { attempts: [nextAttempt] },
      now: occurredAt,
    }),
  };
}

export function createBuffExpiryIncidentFrozenState({
  recorder,
  capturedAt,
  status,
  provider,
}: {
  recorder: BuffExpiryIncidentRuntimeRecorder;
  capturedAt: number;
  status: string;
  provider: string | null;
}) {
  const descriptors = Object.entries(recorder.bindingsByRuntimeId);
  return {
    capturedAt,
    epochId: recorder.archive.epoch.id,
    status,
    activeEpisodeIds: unique(
      descriptors
        .filter(([, binding]) => binding.phase === "confirmed")
        .map(([, binding]) => binding.episodeId),
    ),
    pendingEpisodeIds: unique(
      descriptors
        .filter(([, binding]) => binding.phase === "pending")
        .map(([, binding]) => binding.episodeId),
    ),
    scheduledCycleIds: getScheduledCycleIds(recorder.archive),
    configRevision: recorder.activeConfigurationRevisionId,
    provider,
  };
}

export function recordBuffExpiryIncidentConfiguration({
  previous,
  capturedAt,
  configuration,
}: {
  previous: BuffExpiryIncidentRuntimeRecorder;
  capturedAt: number;
  configuration: Record<string, unknown>;
}): BuffExpiryIncidentRuntimeRecorder {
  return ensureConfigurationRevision({
    previous,
    capturedAt,
    values: configuration,
  }).recorder;
}

function ensureConfigurationRevision({
  previous,
  capturedAt,
  values,
}: {
  previous: BuffExpiryIncidentRuntimeRecorder;
  capturedAt: number;
  values: Record<string, unknown>;
}): {
  recorder: BuffExpiryIncidentRuntimeRecorder;
  revisionId: string;
} {
  const canonical = stableStringify(values);
  const revisionId = `buff-expiry-config:${hashToken(canonical)}`;
  if (
    previous.activeConfigurationRevisionId === revisionId &&
    previous.archive.configurationRevisions.some((entry) => entry.id === revisionId)
  ) {
    return { recorder: previous, revisionId };
  }
  const revision: BuffExpiryIncidentConfigurationRevision = {
    id: revisionId,
    capturedAt,
    values,
  };
  return {
    revisionId,
    recorder: {
      ...previous,
      activeConfigurationRevisionId: revisionId,
      archive: updateBuffExpiryIncidentEvidenceArchive({
        previous: previous.archive,
        epoch: previous.archive.epoch,
        patch: { configurationRevisions: [revision] },
        now: capturedAt,
      }),
    },
  };
}

function collectRuntimeTrackDescriptors(
  state: BuffExpiryRuntimeState,
): RuntimeTrackDescriptor[] {
  return [
    ...state.pendingTracks.flatMap(toPendingDescriptor),
    ...state.tracks.flatMap(toConfirmedDescriptor),
  ];
}

function toPendingDescriptor(track: BuffExpiryPendingTrack): RuntimeTrackDescriptor[] {
  const group = getBuffExpiryPrecisionGroupFromBuffId(track.buffId);
  return group
    ? [{
        runtimeId: track.id,
        group,
        phase: "pending",
        lineageStartedAt: track.firstSeenAt,
        lastSeenAt: track.lastSeenAt,
        expiresAt: null,
        alertedAt: null,
        box: track.box,
      }]
    : [];
}

function toConfirmedDescriptor(track: BuffExpiryTrackedBuff): RuntimeTrackDescriptor[] {
  const group = getBuffExpiryPrecisionGroupFromBuffId(track.buffId);
  return group
    ? [{
        runtimeId: track.id,
        group,
        phase: "confirmed",
        lineageStartedAt: null,
        lastSeenAt: track.lastSeenAt,
        expiresAt: track.expiresAt,
        alertedAt: track.alertedAt,
        box: track.box,
      }]
    : [];
}

function isReplacement(
  binding: RuntimeEpisodeBinding,
  descriptor: RuntimeTrackDescriptor,
): boolean {
  if (binding.group !== descriptor.group) {
    return true;
  }
  if (binding.phase === "confirmed" && descriptor.phase === "pending") {
    return true;
  }
  return (
    descriptor.phase === "pending" &&
    descriptor.lineageStartedAt !== null &&
    descriptor.lineageStartedAt !== binding.lineageStartedAt
  );
}

function createIncidentObservations({
  frameId,
  epochId,
  sampledAt,
  selectedGroups,
  iconObservations,
  bestByGroup,
  nextDescriptors,
  bindingsAfter,
}: {
  frameId: string;
  epochId: string;
  sampledAt: number;
  selectedGroups: BuffExpiryTargetGroup[];
  iconObservations: BuffExpiryPrecisionIconObservation[];
  bestByGroup: BuffExpiryPrecisionBestGroupCandidate[];
  nextDescriptors: RuntimeTrackDescriptor[];
  bindingsAfter: Record<string, RuntimeEpisodeBinding>;
}): BuffExpiryIncidentObservation[] {
  const selected = new Set(selectedGroups);
  const iconByBoxIndex = new Map(
    iconObservations.map((observation) => [observation.boxIndex, observation]),
  );
  return bestByGroup
    .filter((candidate) => selected.has(candidate.group))
    .map((candidate) => {
      const icon = iconByBoxIndex.get(candidate.boxIndex) ?? null;
      const episodeId = candidate.accepted
        ? findEpisodeIdForCandidate({
            candidate,
            nextDescriptors,
            bindingsAfter,
          })
        : null;
      return {
        id: createBuffExpiryIncidentObservationId({
          frameId,
          group: candidate.group,
          boxIndex: candidate.boxIndex,
        }),
        frameId,
        epochId,
        episodeId,
        sampledAt,
        group: candidate.group,
        boxIndex: candidate.boxIndex,
        row: Number.isFinite(candidate.box.row) ? candidate.box.row : null,
        col: Number.isFinite(candidate.box.col) ? candidate.box.col : null,
        targetAccepted: candidate.accepted,
        winningGroup: candidate.winningGroup,
        decisionReason: candidate.decisionReason,
        bundleDecisions: createBundleDecisions(candidate, icon),
        countdown: createCountdownDecision(candidate),
      } satisfies BuffExpiryIncidentObservation;
    });
}

function findEpisodeIdForCandidate({
  candidate,
  nextDescriptors,
  bindingsAfter,
}: {
  candidate: BuffExpiryPrecisionBestGroupCandidate;
  nextDescriptors: RuntimeTrackDescriptor[];
  bindingsAfter: Record<string, RuntimeEpisodeBinding>;
}): string | null {
  const candidates = nextDescriptors
    .filter((descriptor) => descriptor.group === candidate.group)
    .map((descriptor) => ({
      descriptor,
      sameSlot:
        Math.round(descriptor.box.row ?? descriptor.box.y) ===
          Math.round(candidate.box.row) &&
        Math.round(descriptor.box.col ?? descriptor.box.x) ===
          Math.round(candidate.box.col),
      distance:
        (descriptor.box.x - candidate.box.x) ** 2 +
        (descriptor.box.y - candidate.box.y) ** 2,
    }))
    .sort(
      (left, right) =>
        Number(right.sameSlot) - Number(left.sameSlot) ||
        left.distance - right.distance,
    );
  const runtimeId = candidates[0]?.descriptor.runtimeId;
  return runtimeId ? bindingsAfter[runtimeId]?.episodeId ?? null : null;
}

function createBundleDecisions(
  candidate: BuffExpiryPrecisionBestGroupCandidate,
  icon: BuffExpiryPrecisionIconObservation | null,
) {
  const decisions = icon?.identity.candidates?.map((entry) => ({
    group: entry.group,
    accepted: entry.accepted,
    score: finiteOrNull(entry.score),
    margin: finiteOrNull(entry.margin),
    gateMargin: finiteOrNull(entry.gateMargin),
    reason: entry.decisionReason,
  }));
  if (decisions?.length) {
    return decisions;
  }
  return [{
    group: candidate.group,
    accepted: candidate.matcherAccepted ?? candidate.accepted,
    score: finiteOrNull(candidate.score),
    margin: finiteOrNull(candidate.margin),
    gateMargin: finiteOrNull(candidate.gateMargin),
    reason: candidate.decisionReason,
  }];
}

function createCountdownDecision(
  candidate: BuffExpiryPrecisionBestGroupCandidate,
): BuffExpiryIncidentObservation["countdown"] {
  const countdown = candidate.countdown;
  if (!countdown) {
    return candidate.accepted
      ? {
          text: null,
          seconds: null,
          status: "missing",
          confidence: null,
          decision: "missing" as const,
          reason: "countdown-not-produced",
        }
      : null;
  }
  const exactAccepted =
    countdown.kind === "exact" &&
    countdown.totalSeconds !== null &&
    countdown.status !== "missing" &&
    countdown.status !== "low";
  const decision: NonNullable<BuffExpiryIncidentObservation["countdown"]>["decision"] = exactAccepted
    ? "accepted"
    : countdown.kind === "none" || countdown.status === "missing"
      ? "missing"
      : countdown.kind === "not_supported"
        ? "implausible"
        : "rejected";
  return {
    text: countdown.text,
    seconds: countdown.totalSeconds,
    status: countdown.status,
    confidence: finiteOrNull(countdown.confidence),
    decision,
    reason: exactAccepted ? null : countdown.routerStatus || countdown.kind,
  };
}

function createIncidentMedia({
  frameId,
  sampledAt,
  recentRoiFrames,
}: {
  frameId: string;
  sampledAt: number;
  recentRoiFrames: BuffExpiryPrecisionRecentRoiFrame[];
}): BuffExpiryIncidentMedia | null {
  const source = [...recentRoiFrames]
    .reverse()
    .find((frame) => frame.sampledAt === sampledAt);
  if (!source) {
    return null;
  }
  return {
    frameId,
    sampledAt,
    reason: toIncidentMediaReason(source.reason),
    dataUrl: source.imageDataUrl,
    sourceSize: source.sourceSize,
    roi: source.roi,
  };
}

function toIncidentMediaReason(
  reason: BuffExpiryPrecisionRecentRoiFrame["reason"],
): BuffExpiryIncidentMediaReason {
  if (reason === "alert-fired") return "fired-trigger";
  if (reason === "track-started") return "confirmation";
  if (reason === "track-lost") return "track-loss";
  if (reason === "near-miss") return "rejected-observation";
  if (reason === "target-seen") return "accepted-observation";
  if (reason === "report-submitted") return "current";
  return "periodic";
}

function createIncidentRuntimeState({
  status,
  descriptors,
  bindings,
  archive,
}: {
  status: string;
  descriptors: RuntimeTrackDescriptor[];
  bindings: Record<string, RuntimeEpisodeBinding>;
  archive: BuffExpiryIncidentEvidenceArchive;
}): BuffExpiryIncidentRuntimeState {
  return {
    status,
    activeEpisodeIds: unique(
      descriptors
        .filter((descriptor) => descriptor.phase === "confirmed")
        .flatMap((descriptor) => {
          const id = bindings[descriptor.runtimeId]?.episodeId;
          return id ? [id] : [];
        }),
    ),
    pendingEpisodeIds: unique(
      descriptors
        .filter((descriptor) => descriptor.phase === "pending")
        .flatMap((descriptor) => {
          const id = bindings[descriptor.runtimeId]?.episodeId;
          return id ? [id] : [];
        }),
    ),
    scheduledCycleIds: getScheduledCycleIds(archive),
  };
}

function getScheduledCycleIds(archive: BuffExpiryIncidentEvidenceArchive): string[] {
  return archive.cycles
    .filter((cycle) => cycle.status === "registered" || cycle.status === "rescheduled")
    .map((cycle) => cycle.id)
    .sort();
}

function withModuleVersions(
  parser: BuffExpiryIncidentSampleParser,
  versions: BuffExpiryPrecisionModuleVersions | null | undefined,
): BuffExpiryIncidentSampleParser {
  return {
    ...parser,
    version: parser.version ?? versions?.parser ?? null,
    modelVersion: parser.modelVersion ?? versions?.runtime ?? null,
  };
}

function createCycleEvent({
  recorder,
  cycleId,
  occurredAt,
  status,
  reason,
  frameId,
}: {
  recorder: BuffExpiryIncidentRuntimeRecorder;
  cycleId: string;
  occurredAt: number;
  status: BuffExpiryIncidentCycleEventStatus;
  reason: string | null;
  frameId: string | null;
}): {
  recorder: BuffExpiryIncidentRuntimeRecorder;
  event: BuffExpiryIncidentCycleEvent;
} {
  const sequence = recorder.cycleEventSequence + 1;
  return {
    recorder: { ...recorder, cycleEventSequence: sequence },
    event: {
      id: `buff-expiry-cycle-event:${recorder.archive.epoch.id}:${sequence}`,
      cycleId,
      occurredAt,
      status,
      reason,
      frameId,
    },
  };
}

function appendSchedulerTransitions({
  recorder,
  episodes,
  occurredAt,
  kind,
  reason,
}: {
  recorder: BuffExpiryIncidentRuntimeRecorder;
  episodes: BuffExpiryIncidentEpisode[];
  occurredAt: number;
  kind: "scheduled" | "alerted";
  reason: string | null;
}) {
  let transitionSequence = recorder.transitionSequence;
  const transitions: BuffExpiryIncidentEpisodeTransition[] = [];
  const nextEpisodes = episodes.map((episode) => {
    transitionSequence += 1;
    const transition: BuffExpiryIncidentEpisodeTransition = {
      id: `buff-expiry-transition:${recorder.archive.epoch.id}:${transitionSequence}`,
      episodeId: episode.id,
      occurredAt,
      kind,
      frameId: null,
      observationId: null,
      countdownSeconds: null,
      reason,
    };
    transitions.push(transition);
    return {
      ...episode,
      lastEventAt: Math.max(episode.lastEventAt, occurredAt),
      transitionIds: appendUnique(episode.transitionIds, transition.id),
    };
  });
  return {
    transitionSequence,
    transitions,
    episodes: nextEpisodes,
  };
}

function recordRuntimeEvent({
  previous,
  occurredAt,
  category,
  action,
  cycleId = null,
  details,
}: {
  previous: BuffExpiryIncidentRuntimeRecorder;
  occurredAt: number;
  category: BuffExpiryIncidentRuntimeEvent["category"];
  action: string;
  cycleId?: string | null;
  details: Record<string, unknown>;
}): BuffExpiryIncidentRuntimeRecorder {
  const sequence = previous.runtimeEventSequence + 1;
  const event: BuffExpiryIncidentRuntimeEvent = {
    id: `buff-expiry-runtime-event:${previous.archive.epoch.id}:${sequence}`,
    epochId: previous.archive.epoch.id,
    occurredAt,
    category,
    action,
    frameId: null,
    episodeId: null,
    cycleId,
    configRevision: previous.activeConfigurationRevisionId,
    details,
  };
  return {
    ...previous,
    runtimeEventSequence: sequence,
    archive: updateBuffExpiryIncidentEvidenceArchive({
      previous: previous.archive,
      epoch: previous.archive.epoch,
      patch: { runtimeEvents: [event] },
      now: occurredAt,
    }),
  };
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function appendUnique<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values : [...values, value];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function hashToken(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
