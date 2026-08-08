import {
  createSkillIncidentEvidenceArchive,
  updateSkillIncidentEvidenceArchive,
} from "./skillIncidentEvidenceArchive";
import type {
  SkillIncidentAlertDecision,
  SkillIncidentConfigurationRevision,
  SkillIncidentCycle,
  SkillIncidentEpoch,
  SkillIncidentEvidenceArchive,
  SkillIncidentFlowDecision,
  SkillIncidentFrame,
  SkillIncidentLifecycleEvent,
  SkillIncidentMatcherDecision,
  SkillIncidentMedia,
  SkillIncidentMediaReason,
  SkillIncidentMediaVariant,
  SkillIncidentMode,
  SkillIncidentObservation,
  SkillIncidentParserDecision,
  SkillIncidentPlaybackAttempt,
  SkillIncidentRuntimeFailure,
  SkillIncidentRuntimeState,
  SkillIncidentTargetArbitration,
  SkillIncidentValueDecision,
} from "./skillIncidentEvidenceTypes";
import {
  createSkillIncidentArbitrationId,
  createSkillIncidentAttemptId,
  createSkillIncidentCycleId,
  createSkillIncidentDecisionId,
  createSkillIncidentEpochId,
  createSkillIncidentFrameId,
  createSkillIncidentObservationId,
} from "./skillIncidentEvidenceTypes";

const SKILL_INCIDENT_PERIODIC_MEDIA_INTERVAL_MS = 15_000;
const COUNTDOWN_REARM_TOLERANCE_MS = 3_000;

type SkillRuntimeBinding = {
  epochId: string;
  epochIdentityKey: string;
  cycleConfigurationKey: string;
  mode: SkillIncidentMode;
  targetId: string;
  activeCycleId: string | null;
  pendingObservationIds: string[];
  configurationRevisionId: string;
};

export type SkillIncidentRuntimeRecorder = {
  archive: SkillIncidentEvidenceArchive;
  captureGeneration: number;
  sourceFrameSequence: number;
  latestSourceSampledAt: number | null;
  latestSourceFrameId: string | null;
  epochSequenceBySkill: Record<string, number>;
  frameSequenceByEpoch: Record<string, number>;
  cycleSequenceByEpoch: Record<string, number>;
  decisionSequenceByCycleKind: Record<string, number>;
  attemptSequenceByDecision: Record<string, number>;
  lifecycleSequence: number;
  configurationSequenceBySkill: Record<string, number>;
  configurationHashBySkill: Record<string, string>;
  bindingsBySkill: Record<string, SkillRuntimeBinding>;
};

export type SkillIncidentSampleMediaInput = {
  reason: SkillIncidentMediaReason;
  variant: SkillIncidentMediaVariant;
  mimeType: SkillIncidentMedia["mimeType"];
  dataUrl: string;
};

export type SkillIncidentSampleInput = {
  sampledAt: number;
  monotonicAt: number | null;
  skillId: string;
  enabled: boolean;
  mode: SkillIncidentMode;
  targetId: string;
  epochIdentityKey: string;
  cycleConfigurationKey: string;
  epochReason: string;
  provider: string | null;
  recognizerVersion: string | null;
  source?: SkillIncidentFrame["source"];
  stateBefore: SkillIncidentRuntimeState;
  stateAfter: SkillIncidentRuntimeState;
  recognitionDecision: SkillIncidentObservation["recognitionDecision"];
  parser: SkillIncidentParserDecision | null;
  matcher: SkillIncidentMatcherDecision | null;
  value: SkillIncidentValueDecision;
  flow: SkillIncidentFlowDecision | null;
  runtimeFailure: SkillIncidentRuntimeFailure | null;
  configuration: Record<string, unknown>;
  frameReasons: string[];
  media?: SkillIncidentSampleMediaInput[];
  alertDecision?: {
    kind: SkillIncidentAlertDecision["kind"];
    outcome: SkillIncidentAlertDecision["outcome"];
    dueAt: number | null;
    dueMonotonicAt: number | null;
    reason: string | null;
  } | null;
};

export type SkillIncidentSampleRecordResult = {
  recorder: SkillIncidentRuntimeRecorder;
  sourceFrameId: string | null;
  frameId: string | null;
  observationId: string | null;
  cycleId: string | null;
  decisionId: string | null;
};

export function createSkillIncidentRuntimeRecorder({
  now = Date.now(),
  captureGeneration = 1,
}: {
  now?: number;
  captureGeneration?: number;
} = {}): SkillIncidentRuntimeRecorder {
  return {
    archive: createSkillIncidentEvidenceArchive(now),
    captureGeneration,
    sourceFrameSequence: 0,
    latestSourceSampledAt: null,
    latestSourceFrameId: null,
    epochSequenceBySkill: {},
    frameSequenceByEpoch: {},
    cycleSequenceByEpoch: {},
    decisionSequenceByCycleKind: {},
    attemptSequenceByDecision: {},
    lifecycleSequence: 0,
    configurationSequenceBySkill: {},
    configurationHashBySkill: {},
    bindingsBySkill: {},
  };
}

export function resetSkillIncidentRuntimeRecorder({
  previous,
  now = Date.now(),
  reason,
  captureChanged = false,
}: {
  previous: SkillIncidentRuntimeRecorder;
  now?: number;
  reason: string;
  captureChanged?: boolean;
}): SkillIncidentRuntimeRecorder {
  let recorder = previous;
  for (const skillId of Object.keys(previous.bindingsBySkill)) {
    recorder = closeSkillBinding({
      previous: recorder,
      skillId,
      now,
      reason,
    });
  }
  return {
    ...recorder,
    captureGeneration:
      recorder.captureGeneration + (captureChanged ? 1 : 0),
    sourceFrameSequence: 0,
    latestSourceSampledAt: null,
    latestSourceFrameId: null,
  };
}

export function syncSkillIncidentRuntimeSkills({
  previous,
  activeSkillIds,
  now,
  reason = "skill-removed-or-disabled",
}: {
  previous: SkillIncidentRuntimeRecorder;
  activeSkillIds: Iterable<string>;
  now: number;
  reason?: string;
}): SkillIncidentRuntimeRecorder {
  const active = new Set(activeSkillIds);
  let recorder = previous;
  for (const skillId of Object.keys(previous.bindingsBySkill)) {
    if (!active.has(skillId)) {
      recorder = closeSkillBinding({
        previous: recorder,
        skillId,
        now,
        reason,
      });
    }
  }
  return recorder;
}

export function recordSkillIncidentSample({
  previous,
  input,
}: {
  previous: SkillIncidentRuntimeRecorder;
  input: SkillIncidentSampleInput;
}): SkillIncidentSampleRecordResult {
  if (!input.enabled) {
    return {
      recorder: closeSkillBinding({
        previous,
        skillId: input.skillId,
        now: input.sampledAt,
        reason: "skill-disabled",
      }),
      sourceFrameId: null,
      frameId: null,
      observationId: null,
      cycleId: null,
      decisionId: null,
    };
  }

  let recorder = ensureSkillEpoch({ previous, input });
  recorder = ensureConfigurationRevision({ previous: recorder, input });
  recorder = invalidateCycleForConfigurationChange({ previous: recorder, input });
  const binding = recorder.bindingsBySkill[input.skillId];
  const source = ensureSourceFrame(recorder, input.sampledAt);
  recorder = source.recorder;
  const frameSequence = (recorder.frameSequenceByEpoch[binding.epochId] ?? 0) + 1;
  const frameId = createSkillIncidentFrameId(binding.epochId, frameSequence);
  const observationId = createSkillIncidentObservationId(
    input.mode === "quickslot-countdown" ? frameId : source.sourceFrameId,
    input.targetId,
  );
  const existingObservation = recorder.archive.observations.find(
    (entry) => entry.id === observationId,
  );
  const media = createSampleMedia({
    frameId,
    observationId,
    sourceFrameId: source.sourceFrameId,
    input,
  }).map((entry) => {
    const existingMedia = recorder.archive.media.find(
      (candidate) => candidate.id === entry.id,
    );
    return existingMedia
      ? {
          ...existingMedia,
          skillIds: unique([...existingMedia.skillIds, input.skillId]),
        }
      : entry;
  });
  const observation: SkillIncidentObservation = existingObservation
    ? {
        ...existingObservation,
        skillIds: unique([...existingObservation.skillIds, input.skillId]),
        mediaIds: unique([
          ...existingObservation.mediaIds,
          ...media.map((entry) => entry.id),
        ]),
      }
    : {
        id: observationId,
        frameId,
        epochId: binding.epochId,
        skillIds: [input.skillId],
        targetId: input.targetId,
        sampledAt: input.sampledAt,
        monotonicAt: input.monotonicAt,
        mode: input.mode,
        recognitionDecision: input.recognitionDecision,
        parser: input.parser,
        matcher: input.matcher,
        value: input.value,
        flow: input.flow,
        runtimeFailure: input.runtimeFailure,
        mediaIds: media.map((entry) => entry.id),
      };
  const frame: SkillIncidentFrame = {
    id: frameId,
    epochId: binding.epochId,
    skillId: input.skillId,
    sequence: frameSequence,
    sourceFrameId: source.sourceFrameId,
    sampledAt: input.sampledAt,
    monotonicAt: input.monotonicAt,
    source: input.source ?? "runtime",
    mode: input.mode,
    targetId: input.targetId,
    configRevisionId: binding.configurationRevisionId,
    provider: input.provider,
    recognizerVersion: input.recognizerVersion,
    observationIds: [observationId],
    stateBefore: input.stateBefore,
    stateAfter: input.stateAfter,
    runtimeFailure: input.runtimeFailure,
    mediaIds: media.map((entry) => entry.id),
    reasons: input.frameReasons,
  };

  recorder = {
    ...recorder,
    frameSequenceByEpoch: {
      ...recorder.frameSequenceByEpoch,
      [binding.epochId]: frameSequence,
    },
    archive: updateSkillIncidentEvidenceArchive({
      previous: recorder.archive,
      now: input.sampledAt,
      patch: {
        frames: [frame],
        observations: [observation],
        media,
      },
    }),
  };

  const cycleResult = updateSkillCycle({
    previous: recorder,
    input,
    observationId,
  });
  recorder = cycleResult.recorder;
  let decisionId: string | null = null;
  if (input.alertDecision && cycleResult.cycleId) {
    const decisionResult = recordSkillIncidentAlertDecision({
      previous: recorder,
      skillId: input.skillId,
      cycleId: cycleResult.cycleId,
      frameId,
      observationId,
      occurredAt: input.sampledAt,
      monotonicAt: input.monotonicAt,
      configRevisionId: binding.configurationRevisionId,
      ...input.alertDecision,
    });
    recorder = decisionResult.recorder;
    decisionId = decisionResult.decisionId;
  }

  return {
    recorder,
    sourceFrameId: source.sourceFrameId,
    frameId,
    observationId,
    cycleId: cycleResult.cycleId,
    decisionId,
  };
}

export function recordSkillIncidentAlertDecision({
  previous,
  skillId,
  cycleId,
  frameId,
  observationId,
  occurredAt,
  monotonicAt,
  configRevisionId,
  kind,
  outcome,
  dueAt,
  dueMonotonicAt,
  reason,
}: {
  previous: SkillIncidentRuntimeRecorder;
  skillId: string;
  cycleId: string;
  frameId: string | null;
  observationId: string | null;
  occurredAt: number;
  monotonicAt: number | null;
  configRevisionId: string;
  kind: SkillIncidentAlertDecision["kind"];
  outcome: SkillIncidentAlertDecision["outcome"];
  dueAt: number | null;
  dueMonotonicAt: number | null;
  reason: string | null;
}): { recorder: SkillIncidentRuntimeRecorder; decisionId: string } {
  const cycle = previous.archive.cycles.find((entry) => entry.id === cycleId);
  if (!cycle) {
    throw new Error(`skill-incident-cycle-not-found:${cycleId}`);
  }
  const sequenceKey = `${cycleId}:${kind}`;
  const sequence =
    (previous.decisionSequenceByCycleKind[sequenceKey] ?? 0) + 1;
  const decisionId = createSkillIncidentDecisionId({
    cycleId,
    kind,
    sequence,
  });
  const decision: SkillIncidentAlertDecision = {
    id: decisionId,
    epochId: cycle.epochId,
    skillId,
    targetId: cycle.targetId,
    cycleId,
    sequence,
    kind,
    occurredAt,
    monotonicAt,
    dueAt,
    dueMonotonicAt,
    frameId,
    observationId,
    configRevisionId,
    arbitrationId: null,
    outcome,
    reason,
    attemptId: null,
  };
  const updatedCycle: SkillIncidentCycle = {
    ...cycle,
    lastEventAt: Math.max(cycle.lastEventAt, occurredAt),
    decisionIds: unique([...cycle.decisionIds, decisionId]),
    configRevisionIds: unique([
      ...cycle.configRevisionIds,
      configRevisionId,
    ]),
  };
  return {
    recorder: {
      ...previous,
      decisionSequenceByCycleKind: {
        ...previous.decisionSequenceByCycleKind,
        [sequenceKey]: sequence,
      },
      archive: updateSkillIncidentEvidenceArchive({
        previous: previous.archive,
        now: occurredAt,
        patch: { cycles: [updatedCycle], decisions: [decision] },
      }),
    },
    decisionId,
  };
}

export function recordSkillIncidentTargetArbitration({
  previous,
  sourceFrameId,
  targetId,
  occurredAt,
  monotonicAt,
  dueSkillIds,
  winnerSkillId,
  decisionIds,
}: {
  previous: SkillIncidentRuntimeRecorder;
  sourceFrameId: string;
  targetId: string;
  occurredAt: number;
  monotonicAt: number | null;
  dueSkillIds: string[];
  winnerSkillId: string | null;
  decisionIds: string[];
}): SkillIncidentRuntimeRecorder {
  const arbitrationId = createSkillIncidentArbitrationId(
    sourceFrameId,
    targetId,
  );
  const existing = previous.archive.arbitrations.find(
    (entry) => entry.id === arbitrationId,
  );
  const allDueSkillIds = unique([...(existing?.dueSkillIds ?? []), ...dueSkillIds]);
  const allDecisionIds = unique([
    ...(existing?.decisionIds ?? []),
    ...decisionIds,
  ]);
  const arbitration: SkillIncidentTargetArbitration = {
    id: arbitrationId,
    sourceFrameId,
    targetId,
    occurredAt,
    monotonicAt,
    dueSkillIds: allDueSkillIds,
    winnerSkillId: existing?.winnerSkillId ?? winnerSkillId,
    suppressedSkillIds: allDueSkillIds.filter(
      (skillId) => skillId !== (existing?.winnerSkillId ?? winnerSkillId),
    ),
    decisionIds: allDecisionIds,
  };
  const decisions = previous.archive.decisions
    .filter((entry) => allDecisionIds.includes(entry.id))
    .map((entry) => ({
      ...entry,
      arbitrationId,
      outcome:
        arbitration.winnerSkillId === entry.skillId
          ? entry.outcome
          : ("suppressed-duplicate-target" as const),
      reason:
        arbitration.winnerSkillId === entry.skillId
          ? entry.reason
          : "shared-target-playback-won-by-another-skill-row",
    }));
  return {
    ...previous,
    archive: updateSkillIncidentEvidenceArchive({
      previous: previous.archive,
      now: occurredAt,
      patch: { arbitrations: [arbitration], decisions },
    }),
  };
}

export function recordSkillIncidentPlaybackRequested({
  previous,
  decisionId,
  requestedAt,
  requestedMonotonicAt,
  soundId,
  featureVolume,
  masterVolume,
  effectiveVolume,
  visibilityState,
}: {
  previous: SkillIncidentRuntimeRecorder;
  decisionId: string;
  requestedAt: number;
  requestedMonotonicAt: number | null;
  soundId: string;
  featureVolume: number;
  masterVolume: number;
  effectiveVolume: number;
  visibilityState: string | null;
}): { recorder: SkillIncidentRuntimeRecorder; attemptId: string } {
  const decision = previous.archive.decisions.find(
    (entry) => entry.id === decisionId,
  );
  if (!decision) {
    throw new Error(`skill-incident-decision-not-found:${decisionId}`);
  }
  const sequence = (previous.attemptSequenceByDecision[decisionId] ?? 0) + 1;
  const attemptId = createSkillIncidentAttemptId(decisionId, sequence);
  const attempt: SkillIncidentPlaybackAttempt = {
    id: attemptId,
    epochId: decision.epochId,
    skillId: decision.skillId,
    cycleId: decision.cycleId,
    decisionId,
    sequence,
    requestedAt,
    requestedMonotonicAt,
    startedAt: null,
    startedMonotonicAt: null,
    finishedAt: null,
    finishedMonotonicAt: null,
    failedAt: null,
    failedMonotonicAt: null,
    status: "requested",
    startedMeaning: null,
    error: null,
    soundId,
    featureVolume,
    masterVolume,
    effectiveVolume,
    visibilityState,
  };
  return {
    recorder: {
      ...previous,
      attemptSequenceByDecision: {
        ...previous.attemptSequenceByDecision,
        [decisionId]: sequence,
      },
      archive: updateSkillIncidentEvidenceArchive({
        previous: previous.archive,
        now: requestedAt,
        patch: {
          decisions: [{ ...decision, attemptId }],
          attempts: [attempt],
        },
      }),
    },
    attemptId,
  };
}

export function recordSkillIncidentPlaybackStarted({
  previous,
  attemptId,
  startedAt,
  startedMonotonicAt,
}: {
  previous: SkillIncidentRuntimeRecorder;
  attemptId: string;
  startedAt: number;
  startedMonotonicAt: number | null;
}): SkillIncidentRuntimeRecorder {
  return updatePlaybackAttempt({
    previous,
    attemptId,
    occurredAt: startedAt,
    patch: {
      status: "started",
      startedAt,
      startedMonotonicAt,
      startedMeaning: "browser-play-accepted",
    },
  });
}

export function recordSkillIncidentPlaybackFinished({
  previous,
  attemptId,
  finishedAt,
  finishedMonotonicAt,
}: {
  previous: SkillIncidentRuntimeRecorder;
  attemptId: string;
  finishedAt: number;
  finishedMonotonicAt: number | null;
}): SkillIncidentRuntimeRecorder {
  return updatePlaybackAttempt({
    previous,
    attemptId,
    occurredAt: finishedAt,
    patch: {
      status: "finished",
      finishedAt,
      finishedMonotonicAt,
      error: null,
    },
  });
}

export function recordSkillIncidentPlaybackFailed({
  previous,
  attemptId,
  failedAt,
  failedMonotonicAt,
  error,
}: {
  previous: SkillIncidentRuntimeRecorder;
  attemptId: string;
  failedAt: number;
  failedMonotonicAt: number | null;
  error: string;
}): SkillIncidentRuntimeRecorder {
  return updatePlaybackAttempt({
    previous,
    attemptId,
    occurredAt: failedAt,
    patch: {
      status: "failed",
      failedAt,
      failedMonotonicAt,
      error,
    },
  });
}

export function recordSkillIncidentLifecycle({
  previous,
  skillId = null,
  epochId = null,
  occurredAt,
  monotonicAt = null,
  category,
  action,
  frameId = null,
  cycleId = null,
  configRevisionId = null,
  details = {},
}: {
  previous: SkillIncidentRuntimeRecorder;
  skillId?: string | null;
  epochId?: string | null;
  occurredAt: number;
  monotonicAt?: number | null;
  category: SkillIncidentLifecycleEvent["category"];
  action: string;
  frameId?: string | null;
  cycleId?: string | null;
  configRevisionId?: string | null;
  details?: Record<string, unknown>;
}): SkillIncidentRuntimeRecorder {
  const sequence = previous.lifecycleSequence + 1;
  const event: SkillIncidentLifecycleEvent = {
    id: `skill-event:${previous.captureGeneration}:${sequence}`,
    skillId,
    epochId,
    occurredAt,
    monotonicAt,
    category,
    action,
    frameId,
    cycleId,
    configRevisionId,
    details,
  };
  return {
    ...previous,
    lifecycleSequence: sequence,
    archive: updateSkillIncidentEvidenceArchive({
      previous: previous.archive,
      now: occurredAt,
      patch: { lifecycleEvents: [event] },
    }),
  };
}

export function shouldCaptureSkillIncidentPrecisionMedia({
  recorder,
  sampledAt,
}: {
  recorder: SkillIncidentRuntimeRecorder;
  sampledAt: number;
}): boolean {
  const latest = [...recorder.archive.media]
    .filter((entry) => entry.variant === "precision-source")
    .sort((left, right) => right.capturedAt - left.capturedAt)[0];
  return (
    !latest ||
    sampledAt - latest.capturedAt >= SKILL_INCIDENT_PERIODIC_MEDIA_INTERVAL_MS
  );
}

export function shouldCaptureSkillIncidentQuickSlotMedia({
  recorder,
  sampledAt,
  skillId,
}: {
  recorder: SkillIncidentRuntimeRecorder;
  sampledAt: number;
  skillId: string;
}): boolean {
  const latest = [...recorder.archive.media]
    .filter(
      (entry) =>
        entry.skillIds.includes(skillId) &&
        (entry.variant === "quickslot-raw" ||
          entry.variant === "quickslot-processed"),
    )
    .sort((left, right) => right.capturedAt - left.capturedAt)[0];
  return (
    !latest ||
    sampledAt - latest.capturedAt >= SKILL_INCIDENT_PERIODIC_MEDIA_INTERVAL_MS
  );
}

function ensureSkillEpoch({
  previous,
  input,
}: {
  previous: SkillIncidentRuntimeRecorder;
  input: SkillIncidentSampleInput;
}): SkillIncidentRuntimeRecorder {
  const current = previous.bindingsBySkill[input.skillId];
  if (
    current &&
    current.epochIdentityKey === input.epochIdentityKey &&
    current.mode === input.mode &&
    current.targetId === input.targetId
  ) {
    return previous;
  }

  let recorder = current
    ? closeSkillBinding({
        previous,
        skillId: input.skillId,
        now: input.sampledAt,
        reason: "epoch-identity-changed",
      })
    : previous;
  const sequence = (recorder.epochSequenceBySkill[input.skillId] ?? 0) + 1;
  const epoch: SkillIncidentEpoch = {
    id: createSkillIncidentEpochId(input.skillId, sequence),
    skillId: input.skillId,
    sequence,
    mode: input.mode,
    targetId: input.targetId,
    createdAt: input.sampledAt,
    closedAt: null,
    reason: input.epochReason,
  };
  const configuration = createConfigurationRevision({
    recorder,
    skillId: input.skillId,
    epochId: epoch.id,
    capturedAt: input.sampledAt,
    values: input.configuration,
  });
  recorder = configuration.recorder;
  recorder = {
    ...recorder,
    epochSequenceBySkill: {
      ...recorder.epochSequenceBySkill,
      [input.skillId]: sequence,
    },
    bindingsBySkill: {
      ...recorder.bindingsBySkill,
      [input.skillId]: {
        epochId: epoch.id,
        epochIdentityKey: input.epochIdentityKey,
        cycleConfigurationKey: input.cycleConfigurationKey,
        mode: input.mode,
        targetId: input.targetId,
        activeCycleId: null,
        pendingObservationIds: [],
        configurationRevisionId: configuration.revision.id,
      },
    },
    archive: updateSkillIncidentEvidenceArchive({
      previous: recorder.archive,
      now: input.sampledAt,
      patch: {
        currentEpochIds: { [input.skillId]: epoch.id },
        epochs: [epoch],
        configurationRevisions: [configuration.revision],
      },
    }),
  };
  return recordSkillIncidentLifecycle({
    previous: recorder,
    skillId: input.skillId,
    epochId: epoch.id,
    occurredAt: input.sampledAt,
    monotonicAt: input.monotonicAt,
    category: "lifecycle",
    action: "epoch-started",
    configRevisionId: configuration.revision.id,
    details: {
      reason: input.epochReason,
      mode: input.mode,
      targetId: input.targetId,
      provider: input.provider,
      recognizerVersion: input.recognizerVersion,
    },
  });
}

function ensureConfigurationRevision({
  previous,
  input,
}: {
  previous: SkillIncidentRuntimeRecorder;
  input: SkillIncidentSampleInput;
}): SkillIncidentRuntimeRecorder {
  const hash = hashValue(input.configuration);
  if (previous.configurationHashBySkill[input.skillId] === hash) {
    return previous;
  }
  const binding = previous.bindingsBySkill[input.skillId];
  const configuration = createConfigurationRevision({
    recorder: previous,
    skillId: input.skillId,
    epochId: binding.epochId,
    capturedAt: input.sampledAt,
    values: input.configuration,
  });
  return recordSkillIncidentLifecycle({
    previous: {
      ...configuration.recorder,
      bindingsBySkill: {
        ...configuration.recorder.bindingsBySkill,
        [input.skillId]: {
          ...binding,
          configurationRevisionId: configuration.revision.id,
        },
      },
      archive: updateSkillIncidentEvidenceArchive({
        previous: configuration.recorder.archive,
        now: input.sampledAt,
        patch: { configurationRevisions: [configuration.revision] },
      }),
    },
    skillId: input.skillId,
    epochId: binding.epochId,
    occurredAt: input.sampledAt,
    monotonicAt: input.monotonicAt,
    category: "configuration",
    action: "configuration-revised",
    configRevisionId: configuration.revision.id,
  });
}

function invalidateCycleForConfigurationChange({
  previous,
  input,
}: {
  previous: SkillIncidentRuntimeRecorder;
  input: SkillIncidentSampleInput;
}): SkillIncidentRuntimeRecorder {
  const binding = previous.bindingsBySkill[input.skillId];
  if (binding.cycleConfigurationKey === input.cycleConfigurationKey) {
    return previous;
  }
  let recorder = previous;
  if (binding.activeCycleId) {
    recorder = closeCycle({
      previous: recorder,
      cycleId: binding.activeCycleId,
      now: input.sampledAt,
      reason: "configuration-invalidated",
    });
  }
  const current = recorder.bindingsBySkill[input.skillId];
  recorder = {
    ...recorder,
    bindingsBySkill: {
      ...recorder.bindingsBySkill,
      [input.skillId]: {
        ...current,
        cycleConfigurationKey: input.cycleConfigurationKey,
        activeCycleId: null,
        pendingObservationIds: [],
      },
    },
  };
  return recordSkillIncidentLifecycle({
    previous: recorder,
    skillId: input.skillId,
    epochId: current.epochId,
    occurredAt: input.sampledAt,
    monotonicAt: input.monotonicAt,
    category: "configuration",
    action: "timer-cycle-invalidated",
    configRevisionId: current.configurationRevisionId,
  });
}

function updateSkillCycle({
  previous,
  input,
  observationId,
}: {
  previous: SkillIncidentRuntimeRecorder;
  input: SkillIncidentSampleInput;
  observationId: string;
}): { recorder: SkillIncidentRuntimeRecorder; cycleId: string | null } {
  let recorder = previous;
  let binding = recorder.bindingsBySkill[input.skillId];
  let activeCycle = binding.activeCycleId
    ? recorder.archive.cycles.find((entry) => entry.id === binding.activeCycleId) ?? null
    : null;
  const confirmed = isConfirmedRuntimeState(input.mode, input.stateAfter);
  const startsNewCycle = shouldStartNewCycle({ input, activeCycle });

  if (startsNewCycle && activeCycle) {
    recorder = closeCycle({
      previous: recorder,
      cycleId: activeCycle.id,
      now: input.sampledAt,
      reason: getCycleReplacementReason(input.mode),
    });
    binding = recorder.bindingsBySkill[input.skillId];
    activeCycle = null;
  }

  if (!activeCycle && confirmed) {
    const sequence = (recorder.cycleSequenceByEpoch[binding.epochId] ?? 0) + 1;
    const cycleId = createSkillIncidentCycleId(binding.epochId, sequence);
    const anchorObservationIds = unique([
      ...binding.pendingObservationIds,
      observationId,
    ]);
    activeCycle = {
      id: cycleId,
      epochId: binding.epochId,
      skillId: input.skillId,
      targetId: input.targetId,
      sequence,
      mode: input.mode,
      status: "active",
      startedAt: input.sampledAt,
      confirmedAt: input.sampledAt,
      lastEventAt: input.sampledAt,
      endedAt: null,
      terminalReason: null,
      anchorObservationIds,
      observationIds: anchorObservationIds,
      decisionIds: [],
      configRevisionIds: [binding.configurationRevisionId],
      estimatedExpiresAt: input.stateAfter.estimatedExpiresAt,
      confirmedCount:
        input.mode === "precision-remaining-count"
          ? input.stateAfter.observedValue
          : null,
      initialAlertDelaySeconds: input.stateAfter.initialAlertDelaySeconds,
    };
    recorder = {
      ...recorder,
      cycleSequenceByEpoch: {
        ...recorder.cycleSequenceByEpoch,
        [binding.epochId]: sequence,
      },
      bindingsBySkill: {
        ...recorder.bindingsBySkill,
        [input.skillId]: {
          ...binding,
          activeCycleId: cycleId,
          pendingObservationIds: [],
        },
      },
      archive: updateSkillIncidentEvidenceArchive({
        previous: recorder.archive,
        now: input.sampledAt,
        patch: { cycles: [activeCycle] },
      }),
    };
    return { recorder, cycleId };
  }

  if (!activeCycle) {
    const shouldRetainPending =
      input.recognitionDecision === "accepted" &&
      input.value.decision === "accepted";
    if (shouldRetainPending) {
      recorder = {
        ...recorder,
        bindingsBySkill: {
          ...recorder.bindingsBySkill,
          [input.skillId]: {
            ...binding,
            pendingObservationIds: unique([
              ...binding.pendingObservationIds,
              observationId,
            ]).slice(-12),
          },
        },
      };
    }
    return { recorder, cycleId: null };
  }

  const isRefresh = isCountdownRefresh(input, activeCycle);
  const updatedCycle: SkillIncidentCycle = {
    ...activeCycle,
    lastEventAt: input.sampledAt,
    observationIds: unique([...activeCycle.observationIds, observationId]),
    anchorObservationIds: isRefresh
      ? unique([...activeCycle.anchorObservationIds, observationId])
      : activeCycle.anchorObservationIds,
    configRevisionIds: unique([
      ...activeCycle.configRevisionIds,
      binding.configurationRevisionId,
    ]),
    estimatedExpiresAt: input.stateAfter.estimatedExpiresAt,
    confirmedCount:
      input.mode === "precision-remaining-count"
        ? input.stateAfter.observedValue
        : activeCycle.confirmedCount,
  };
  recorder = {
    ...recorder,
    archive: updateSkillIncidentEvidenceArchive({
      previous: recorder.archive,
      now: input.sampledAt,
      patch: { cycles: [updatedCycle] },
    }),
  };
  return { recorder, cycleId: updatedCycle.id };
}

function shouldStartNewCycle({
  input,
  activeCycle,
}: {
  input: SkillIncidentSampleInput;
  activeCycle: SkillIncidentCycle | null;
}): boolean {
  if (!activeCycle) {
    return false;
  }
  if (input.mode === "quickslot-countdown") {
    return Boolean(
      input.stateAfter.lastAlertCycleStartedAt !== null &&
        input.stateAfter.lastAlertCycleStartedAt !==
          input.stateBefore.lastAlertCycleStartedAt,
    );
  }
  if (input.mode === "precision-countdown") {
    return Boolean(
      input.stateBefore.alertedAt !== null &&
        input.stateBefore.estimatedExpiresAt !== null &&
        input.stateAfter.estimatedExpiresAt !== null &&
        input.stateAfter.estimatedExpiresAt >
          input.stateBefore.estimatedExpiresAt + COUNTDOWN_REARM_TOLERANCE_MS,
    );
  }
  const reason = input.flow?.decisionReason?.toLowerCase() ?? "";
  return /new-cycle|increase-confirmed|cycle-reset/.test(reason);
}

function isCountdownRefresh(
  input: SkillIncidentSampleInput,
  cycle: SkillIncidentCycle,
): boolean {
  return Boolean(
    input.mode === "precision-countdown" &&
      input.stateAfter.estimatedExpiresAt !== null &&
      cycle.estimatedExpiresAt !== null &&
      Math.abs(input.stateAfter.estimatedExpiresAt - cycle.estimatedExpiresAt) >
        COUNTDOWN_REARM_TOLERANCE_MS,
  );
}

function isConfirmedRuntimeState(
  mode: SkillIncidentMode,
  state: SkillIncidentRuntimeState,
): boolean {
  return mode === "precision-remaining-count"
    ? state.observedValue !== null
    : state.estimatedExpiresAt !== null;
}

function getCycleReplacementReason(mode: SkillIncidentMode): string {
  return mode === "precision-remaining-count"
    ? "remaining-count-increase-confirmed"
    : "timer-rearmed";
}

function closeSkillBinding({
  previous,
  skillId,
  now,
  reason,
}: {
  previous: SkillIncidentRuntimeRecorder;
  skillId: string;
  now: number;
  reason: string;
}): SkillIncidentRuntimeRecorder {
  const binding = previous.bindingsBySkill[skillId];
  if (!binding) {
    return previous;
  }
  let recorder = binding.activeCycleId
    ? closeCycle({
        previous,
        cycleId: binding.activeCycleId,
        now,
        reason,
      })
    : previous;
  const epoch = recorder.archive.epochs.find(
    (entry) => entry.id === binding.epochId,
  );
  const bindingsBySkill = { ...recorder.bindingsBySkill };
  delete bindingsBySkill[skillId];
  const currentEpochIds = { [skillId]: null };
  recorder = {
    ...recorder,
    bindingsBySkill,
    archive: updateSkillIncidentEvidenceArchive({
      previous: recorder.archive,
      now,
      patch: {
        currentEpochIds,
        epochs: epoch ? [{ ...epoch, closedAt: now }] : [],
      },
    }),
  };
  return recordSkillIncidentLifecycle({
    previous: recorder,
    skillId,
    epochId: binding.epochId,
    occurredAt: now,
    category: "lifecycle",
    action: "epoch-closed",
    cycleId: binding.activeCycleId,
    configRevisionId: binding.configurationRevisionId,
    details: { reason },
  });
}

function closeCycle({
  previous,
  cycleId,
  now,
  reason,
}: {
  previous: SkillIncidentRuntimeRecorder;
  cycleId: string;
  now: number;
  reason: string;
}): SkillIncidentRuntimeRecorder {
  const cycle = previous.archive.cycles.find((entry) => entry.id === cycleId);
  if (!cycle || cycle.status === "terminal") {
    return previous;
  }
  const binding = previous.bindingsBySkill[cycle.skillId];
  const updatedCycle: SkillIncidentCycle = {
    ...cycle,
    status: "terminal",
    lastEventAt: Math.max(cycle.lastEventAt, now),
    endedAt: now,
    terminalReason: reason,
  };
  return {
    ...previous,
    bindingsBySkill: binding
      ? {
          ...previous.bindingsBySkill,
          [cycle.skillId]: {
            ...binding,
            activeCycleId: null,
            pendingObservationIds: [],
          },
        }
      : previous.bindingsBySkill,
    archive: updateSkillIncidentEvidenceArchive({
      previous: previous.archive,
      now,
      patch: { cycles: [updatedCycle] },
    }),
  };
}

function ensureSourceFrame(
  previous: SkillIncidentRuntimeRecorder,
  sampledAt: number,
): { recorder: SkillIncidentRuntimeRecorder; sourceFrameId: string } {
  if (
    previous.latestSourceSampledAt === sampledAt &&
    previous.latestSourceFrameId
  ) {
    return { recorder: previous, sourceFrameId: previous.latestSourceFrameId };
  }
  const sequence = previous.sourceFrameSequence + 1;
  const sourceFrameId = `skill-source:${previous.captureGeneration}:${sequence}`;
  return {
    recorder: {
      ...previous,
      sourceFrameSequence: sequence,
      latestSourceSampledAt: sampledAt,
      latestSourceFrameId: sourceFrameId,
    },
    sourceFrameId,
  };
}

function createConfigurationRevision({
  recorder,
  skillId,
  epochId,
  capturedAt,
  values,
}: {
  recorder: SkillIncidentRuntimeRecorder;
  skillId: string;
  epochId: string;
  capturedAt: number;
  values: Record<string, unknown>;
}): {
  recorder: SkillIncidentRuntimeRecorder;
  revision: SkillIncidentConfigurationRevision;
} {
  const sequence = (recorder.configurationSequenceBySkill[skillId] ?? 0) + 1;
  const revision: SkillIncidentConfigurationRevision = {
    id: `skill-config:${skillId}:${sequence}`,
    skillId,
    epochId,
    capturedAt,
    values,
  };
  return {
    recorder: {
      ...recorder,
      configurationSequenceBySkill: {
        ...recorder.configurationSequenceBySkill,
        [skillId]: sequence,
      },
      configurationHashBySkill: {
        ...recorder.configurationHashBySkill,
        [skillId]: hashValue(values),
      },
    },
    revision,
  };
}

function createSampleMedia({
  frameId,
  observationId,
  sourceFrameId,
  input,
}: {
  frameId: string;
  observationId: string;
  sourceFrameId: string;
  input: SkillIncidentSampleInput;
}): SkillIncidentMedia[] {
  const sequenceByVariant = new Map<SkillIncidentMediaVariant, number>();
  return (input.media ?? []).map((entry) => {
    const sequence = sequenceByVariant.get(entry.variant) ?? 0;
    sequenceByVariant.set(entry.variant, sequence + 1);
    return {
      id: `skill-media:${
        input.mode === "quickslot-countdown" ? frameId : sourceFrameId
      }:${entry.variant}:${sequence}`,
      frameId,
      observationId,
      skillIds: [input.skillId],
      targetId: input.targetId,
      capturedAt: input.sampledAt,
      reason: entry.reason,
      variant: entry.variant,
      mimeType: entry.mimeType,
      dataUrl: entry.dataUrl,
    };
  });
}

function updatePlaybackAttempt({
  previous,
  attemptId,
  occurredAt,
  patch,
}: {
  previous: SkillIncidentRuntimeRecorder;
  attemptId: string;
  occurredAt: number;
  patch: Partial<SkillIncidentPlaybackAttempt>;
}): SkillIncidentRuntimeRecorder {
  const attempt = previous.archive.attempts.find(
    (entry) => entry.id === attemptId,
  );
  if (!attempt) {
    return previous;
  }
  const cycle = previous.archive.cycles.find(
    (entry) => entry.id === attempt.cycleId,
  );
  return {
    ...previous,
    archive: updateSkillIncidentEvidenceArchive({
      previous: previous.archive,
      now: occurredAt,
      patch: {
        attempts: [{ ...attempt, ...patch }],
        cycles: cycle
          ? [{ ...cycle, lastEventAt: Math.max(cycle.lastEventAt, occurredAt) }]
          : [],
      },
    }),
  };
}

function hashValue(value: unknown): string {
  const canonical = stableStringify(value);
  let result = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    result ^= canonical.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
