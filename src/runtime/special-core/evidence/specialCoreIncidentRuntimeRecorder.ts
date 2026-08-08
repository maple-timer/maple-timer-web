import type {
  SpecialCoreRuntimeState,
  SpecialCoreSnapshot,
} from "../../../lib/specialCore";
import {
  collectSpecialCoreIncidentConfirmation,
  completeSpecialCoreIncidentSchedule,
  createSpecialCoreIncidentBoundary,
  getSpecialCoreIncidentContinuityResetReason,
  recordSpecialCoreIncidentActivationSighting,
  recordSpecialCoreIncidentFrame,
  recordSpecialCoreIncidentObservation,
  registerSpecialCoreIncidentSchedule,
  requestSpecialCoreIncidentPlayback,
  resetSpecialCoreIncidentBoundary,
  reviseSpecialCoreIncidentConfiguration,
  transitionSpecialCoreIncidentPlayback,
} from "./specialCoreIncidentBoundary";
import {
  createSpecialCoreIncidentEvidenceArchive,
  updateSpecialCoreIncidentEvidenceArchive,
  type SpecialCoreIncidentEvidencePatch,
} from "./specialCoreIncidentEvidenceArchive";
import type {
  SpecialCoreIncidentActivation,
  SpecialCoreIncidentBoundaryRejectReason,
  SpecialCoreIncidentBoundaryState,
  SpecialCoreIncidentCandidate,
  SpecialCoreIncidentConfiguration,
  SpecialCoreIncidentContinuity,
  SpecialCoreIncidentEvidenceArchive,
  SpecialCoreIncidentFrame,
  SpecialCoreIncidentFrameSource,
  SpecialCoreIncidentFrameTimings,
  SpecialCoreIncidentFrozenState,
  SpecialCoreIncidentLifecycleEvent,
  SpecialCoreIncidentMediaFrame,
  SpecialCoreIncidentMediaReason,
  SpecialCoreIncidentObservation,
  SpecialCoreIncidentObservationDecision,
  SpecialCoreIncidentParser,
  SpecialCoreIncidentResetReason,
  SpecialCoreIncidentRowGroup,
  SpecialCoreIncidentRuntimeFailure,
  SpecialCoreIncidentRuntimeStateSnapshot,
} from "./specialCoreIncidentEvidenceTypes";

const SPECIAL_CORE_PERIODIC_MEDIA_INTERVAL_MS = 15_000;

type PendingReset = {
  reason: Exclude<SpecialCoreIncidentResetReason, "initialized">;
  requestedAt: number;
};

export type SpecialCoreIncidentRuntimeRecorder = {
  boundary: SpecialCoreIncidentBoundaryState | null;
  archive: SpecialCoreIncidentEvidenceArchive;
  captureGeneration: number;
  featureGeneration: number;
  matcherWorkerGeneration: number;
  lifecycleSequence: number;
  presentationSequence: number;
  latestPresentationRevision: string | null;
  latestMediaAt: number | null;
  pendingReset: PendingReset | null;
};

export type SpecialCoreIncidentRuntimeSampleInput = {
  sampledAt: number;
  configuration: SpecialCoreIncidentConfiguration;
  parserRuntimeGeneration: string;
  layoutKey: string;
  sourceGeometryRevision: string;
  stateBefore: SpecialCoreRuntimeState;
  stateAfter: SpecialCoreRuntimeState;
  snapshot: SpecialCoreSnapshot;
  source: SpecialCoreIncidentFrameSource | null;
  parser: SpecialCoreIncidentParser | null;
  parsedBoxes: SpecialCoreIncidentFrame["parsedBoxes"];
  rowGroups: SpecialCoreIncidentRowGroup[];
  eligibleBoxIndexes: number[];
  timings: SpecialCoreIncidentFrameTimings | null;
  runtimeFailure: SpecialCoreIncidentRuntimeFailure | null;
  media?: {
    imageDataUrl: string | null;
    reason?: SpecialCoreIncidentMediaReason | null;
  } | null;
  recordFrame?: boolean;
  unavailableAction?: string | null;
};

export type SpecialCoreIncidentRuntimeRecordResult = {
  recorder: SpecialCoreIncidentRuntimeRecorder;
  rejectedReason: SpecialCoreIncidentBoundaryRejectReason | null;
};

export type SpecialCoreIncidentPlaybackRecordResult =
  SpecialCoreIncidentRuntimeRecordResult & {
    attemptId: string | null;
  };

export function createSpecialCoreIncidentRuntimeRecorder(
  now = Date.now(),
): SpecialCoreIncidentRuntimeRecorder {
  return {
    boundary: null,
    archive: createSpecialCoreIncidentEvidenceArchive(now),
    captureGeneration: 1,
    featureGeneration: 1,
    matcherWorkerGeneration: 1,
    lifecycleSequence: 0,
    presentationSequence: 0,
    latestPresentationRevision: null,
    latestMediaAt: null,
    pendingReset: null,
  };
}

export function requestSpecialCoreIncidentRuntimeReset({
  previous,
  reason,
  requestedAt = Date.now(),
}: {
  previous: SpecialCoreIncidentRuntimeRecorder;
  reason: Exclude<SpecialCoreIncidentResetReason, "initialized">;
  requestedAt?: number;
}): SpecialCoreIncidentRuntimeRecorder {
  const next = { ...previous };
  if (reason === "stream-replaced") {
    next.captureGeneration += 1;
  } else if (reason === "matcher-worker-reset") {
    next.matcherWorkerGeneration += 1;
  } else if (reason !== "parser-runtime-changed") {
    next.featureGeneration += 1;
  }
  next.pendingReset = { reason, requestedAt };
  return next;
}

export function recordSpecialCoreIncidentRuntimeSample({
  previous,
  input,
}: {
  previous: SpecialCoreIncidentRuntimeRecorder;
  input: SpecialCoreIncidentRuntimeSampleInput;
}): SpecialCoreIncidentRuntimeRecorder {
  let recorder = synchronizeBoundary(previous, input);
  let boundary = recorder.boundary;
  if (!boundary) return recorder;

  if (!input.configuration.enabled || input.recordFrame === false) {
    if (input.unavailableAction) {
      recorder = appendLifecycleEvent(recorder, {
        occurredAt: input.sampledAt,
        category: input.runtimeFailure ? "runtime-error" : "lifecycle",
        action: input.unavailableAction,
        details: input.runtimeFailure
          ? {
              stage: input.runtimeFailure.stage,
              code: input.runtimeFailure.code,
            }
          : {},
      });
    }
    return recorder;
  }

  const frameResult = recordSpecialCoreIncidentFrame({
    previous: boundary,
    sampledAt: input.sampledAt,
  });
  if (!frameResult.accepted) {
    return appendBoundaryRejection(recorder, input.sampledAt, frameResult.reason, {
      operation: "record-frame",
    });
  }

  const mediaReason = getMediaReason(input);
  const mediaFrameId = input.media?.imageDataUrl
    ? `special-core-media:${frameResult.value.id}`
    : null;
  const frame: SpecialCoreIncidentFrame = {
    ...frameResult.value,
    source: input.source,
    parser: input.parser,
    parsedBoxes: input.parsedBoxes.map((box) => ({ ...box })),
    rowGroups: input.rowGroups.map((row) => ({
      ...row,
      boxIndexes: [...row.boxIndexes],
    })),
    eligibleBoxIndexes: [...input.eligibleBoxIndexes],
    timings: input.timings ? { ...input.timings } : null,
    runtimeFailure: input.runtimeFailure
      ? {
          ...input.runtimeFailure,
          details: { ...input.runtimeFailure.details },
        }
      : null,
    mediaFrameId,
  };
  boundary = { ...frameResult.state, latestFrame: frame };

  const decision = getObservationDecision(input);
  const observationResult = recordSpecialCoreIncidentObservation({
    previous: boundary,
    frame,
    decision: decision.decision,
    reason: decision.reason,
  });
  if (!observationResult.accepted) {
    return appendBoundaryRejection(
      recorder,
      input.sampledAt,
      observationResult.reason,
      { operation: "record-observation", frameId: frame.id },
    );
  }

  const observation: SpecialCoreIncidentObservation = {
    ...observationResult.value,
    candidates: input.snapshot.candidateIcons.map(toIncidentCandidate),
    selectedCandidateBoxIndex:
      input.snapshot.detectedIcon?.boxIndex ??
      input.snapshot.candidateIcons[0]?.boxIndex ??
      null,
    stateBefore: toIncidentStateSnapshot(input.stateBefore, input.sampledAt),
    stateAfter: toIncidentStateSnapshot(input.stateAfter, input.sampledAt),
  };
  boundary = { ...observationResult.state, latestObservation: observation };

  const patch: SpecialCoreIncidentEvidencePatch = {
    frames: [frame],
    observations: [observation],
  };
  if (mediaFrameId && input.media?.imageDataUrl) {
    const media: SpecialCoreIncidentMediaFrame = {
      id: mediaFrameId,
      frameId: frame.id,
      resetEpochId: frame.resetEpochId,
      sampledAt: frame.sampledAt,
      reason: input.media.reason ?? mediaReason,
      imageDataUrl: input.media.imageDataUrl,
    };
    patch.media = [media];
    recorder = { ...recorder, latestMediaAt: input.sampledAt };
  } else if (isRequiredMediaReason(mediaReason)) {
    patch.omissions = [
      {
        id: `special-core-omission:${frame.id}:${mediaReason}`,
        occurredAt: input.sampledAt,
        kind: "media",
        reason: "never-produced",
        subjectIds: [frame.id],
        count: 1,
      },
    ];
  }

  const transition = recordRecognitionTransition({
    recorder,
    boundary,
    frame,
    observation,
    input,
    patch,
  });
  recorder = transition.recorder;
  boundary = transition.boundary;

  recorder = appendLifecycleEvent(recorder, {
    occurredAt: input.sampledAt,
    category: input.runtimeFailure ? "runtime-error" : "presentation",
    action: input.runtimeFailure
      ? "runtime-sample-failed"
      : "runtime-state-published",
    configRevisionId: boundary.configurationRevision.id,
    frameId: frame.id,
    observationId: observation.id,
    confirmationAttemptId: boundary.activeConfirmationAttempt?.id ?? null,
    activationId: boundary.activeActivation?.id ?? null,
    scheduleId: boundary.activeSchedule?.id ?? null,
    decisionId: boundary.latestDecision?.id ?? null,
    playbackAttemptId: boundary.latestPlaybackAttempt?.id ?? null,
    details: input.runtimeFailure
      ? {
          stage: input.runtimeFailure.stage,
          code: input.runtimeFailure.code,
        }
      : {
          status: input.stateAfter.status,
          detectedCount: input.snapshot.detectedCount,
        },
  });

  const presentationSequence = recorder.presentationSequence + 1;
  const latestPresentationRevision =
    `special-core-presentation:${boundary.resetEpoch.id}:${presentationSequence}`;
  return {
    ...recorder,
    boundary,
    presentationSequence,
    latestPresentationRevision,
    archive: updateSpecialCoreIncidentEvidenceArchive({
      previous: recorder.archive,
      patch: { ...patch, boundaryState: boundary },
      now: input.sampledAt,
    }),
  };
}

export function recordSpecialCoreIncidentScheduleRegistered({
  previous,
  runtimeActivationId,
  registeredAt,
  reason,
}: {
  previous: SpecialCoreIncidentRuntimeRecorder;
  runtimeActivationId: number;
  registeredAt: number;
  reason: "activation-confirmed" | "configuration-retimed" | "browser-rescheduled";
}): SpecialCoreIncidentRuntimeRecordResult {
  const boundary = previous.boundary;
  const activation = boundary?.activeActivation ?? null;
  if (!boundary || !activation || activation.runtimeActivationId !== runtimeActivationId) {
    return rejectedRuntimeResult(previous, registeredAt, "stale-activation", {
      operation: "register-schedule",
      runtimeActivationId,
    });
  }
  const result = registerSpecialCoreIncidentSchedule({
    previous: boundary,
    activation,
    registeredAt,
    reason,
  });
  if (!result.accepted) {
    return rejectedRuntimeResult(previous, registeredAt, result.reason, {
      operation: "register-schedule",
      runtimeActivationId,
    });
  }
  let recorder: SpecialCoreIncidentRuntimeRecorder = {
    ...previous,
    boundary: result.state,
  };
  recorder = appendLifecycleEvent(recorder, {
    occurredAt: registeredAt,
    category: "schedule",
    action: result.value.replacedSchedule
      ? "schedule-replaced"
      : "schedule-registered",
    configRevisionId: result.value.schedule.timingConfigRevisionId,
    activationId: activation.id,
    scheduleId: result.value.schedule.id,
    details: {
      alertDueAt: result.value.schedule.alertDueAt,
      reason,
    },
  });
  recorder = {
    ...recorder,
    archive: updateSpecialCoreIncidentEvidenceArchive({
      previous: recorder.archive,
      patch: {
        boundaryState: result.state,
        activations: [result.value.activation],
        schedules: [
          ...(result.value.replacedSchedule
            ? [result.value.replacedSchedule]
            : []),
          result.value.schedule,
        ],
      },
      now: registeredAt,
    }),
  };
  return { recorder, rejectedReason: null };
}

export function recordSpecialCoreIncidentConfigurationObserved({
  previous,
  configuration,
  occurredAt,
}: {
  previous: SpecialCoreIncidentRuntimeRecorder;
  configuration: SpecialCoreIncidentConfiguration;
  occurredAt: number;
}): SpecialCoreIncidentRuntimeRecordResult {
  const boundary = previous.boundary;
  if (!boundary) {
    return {
      recorder: previous,
      rejectedReason: null,
    };
  }
  const revision = reviseSpecialCoreIncidentConfiguration({
    previous: boundary,
    configuration,
    now: occurredAt,
  });
  if (!revision.accepted) {
    return rejectedRuntimeResult(previous, occurredAt, revision.reason, {
      operation: "observe-configuration",
    });
  }
  if (!revision.value.changed) {
    return {
      recorder: { ...previous, boundary: revision.state },
      rejectedReason: null,
    };
  }
  let recorder: SpecialCoreIncidentRuntimeRecorder = {
    ...previous,
    boundary: revision.state,
    archive: updateSpecialCoreIncidentEvidenceArchive({
      previous: previous.archive,
      patch: { boundaryState: revision.state },
      now: occurredAt,
    }),
  };
  recorder = appendLifecycleEvent(recorder, {
    occurredAt,
    category: "configuration",
    action: "configuration-revised",
    configRevisionId: revision.value.configurationRevision.id,
    activationId: revision.state.activeActivation?.id ?? null,
    scheduleId: revision.state.activeSchedule?.id ?? null,
    details: {
      timingChanged: revision.value.timingChanged,
      fingerprint: revision.value.configurationRevision.fingerprint,
      source: "scheduler",
    },
  });
  return { recorder, rejectedReason: null };
}

export function recordSpecialCoreIncidentScheduleOutcome({
  previous,
  runtimeActivationId,
  outcome,
  occurredAt,
  reason = null,
}: {
  previous: SpecialCoreIncidentRuntimeRecorder;
  runtimeActivationId: number;
  outcome: "cancelled" | "suppressed" | "fired";
  occurredAt: number;
  reason?: string | null;
}): SpecialCoreIncidentRuntimeRecordResult {
  const boundary = previous.boundary;
  const schedule = boundary?.activeSchedule ?? null;
  if (
    !boundary ||
    !schedule ||
    boundary.activeActivation?.runtimeActivationId !== runtimeActivationId
  ) {
    return rejectedRuntimeResult(previous, occurredAt, "stale-schedule", {
      operation: `complete-schedule-${outcome}`,
      runtimeActivationId,
    });
  }
  const result = completeSpecialCoreIncidentSchedule({
    previous: boundary,
    scheduleId: schedule.id,
    outcome,
    occurredAt,
    reason,
  });
  if (!result.accepted) {
    return rejectedRuntimeResult(previous, occurredAt, result.reason, {
      operation: `complete-schedule-${outcome}`,
      scheduleId: schedule.id,
    });
  }
  let recorder: SpecialCoreIncidentRuntimeRecorder = {
    ...previous,
    boundary: result.state,
  };
  recorder = appendLifecycleEvent(recorder, {
    occurredAt,
    category: outcome === "fired" ? "decision" : "schedule",
    action: `schedule-${outcome}`,
    configRevisionId:
      result.value.decision?.firedConfigRevisionId ??
      result.value.schedule.timingConfigRevisionId,
    activationId: result.value.schedule.activationId,
    scheduleId: result.value.schedule.id,
    decisionId: result.value.decision?.id ?? null,
    details: {
      reason,
      schedulerDelayMs: result.value.decision?.schedulerDelayMs ?? null,
    },
  });
  recorder = {
    ...recorder,
    archive: updateSpecialCoreIncidentEvidenceArchive({
      previous: recorder.archive,
      patch: {
        boundaryState: result.state,
        schedules: [result.value.schedule],
        decisions: result.value.decision ? [result.value.decision] : undefined,
      },
      now: occurredAt,
    }),
  };
  return { recorder, rejectedReason: null };
}

export function recordSpecialCoreIncidentPlaybackRequested({
  previous,
  runtimeActivationId,
  requestedAt,
  startOffsetSeconds,
}: {
  previous: SpecialCoreIncidentRuntimeRecorder;
  runtimeActivationId: number;
  requestedAt: number;
  startOffsetSeconds: number;
}): SpecialCoreIncidentPlaybackRecordResult {
  const boundary = previous.boundary;
  const decision = boundary?.latestDecision ?? null;
  if (
    !boundary ||
    !decision ||
    boundary.activeActivation?.runtimeActivationId !== runtimeActivationId
  ) {
    return {
      ...rejectedRuntimeResult(previous, requestedAt, "stale-alert-decision", {
        operation: "request-playback",
        runtimeActivationId,
      }),
      attemptId: null,
    };
  }
  const result = requestSpecialCoreIncidentPlayback({
    previous: boundary,
    decision,
    requestedAt,
    startOffsetSeconds,
  });
  if (!result.accepted) {
    return {
      ...rejectedRuntimeResult(previous, requestedAt, result.reason, {
        operation: "request-playback",
        decisionId: decision.id,
      }),
      attemptId: null,
    };
  }
  let recorder: SpecialCoreIncidentRuntimeRecorder = {
    ...previous,
    boundary: result.state,
  };
  recorder = appendLifecycleEvent(recorder, {
    occurredAt: requestedAt,
    category: "playback",
    action: "playback-requested",
    configRevisionId: result.value.configRevisionId,
    activationId: result.value.activationId,
    scheduleId: result.value.scheduleId,
    decisionId: result.value.decisionId,
    playbackAttemptId: result.value.id,
    details: {
      soundId: result.value.soundId,
      effectiveVolume: result.value.effectiveVolume,
      startOffsetSeconds,
    },
  });
  recorder = {
    ...recorder,
    archive: updateSpecialCoreIncidentEvidenceArchive({
      previous: recorder.archive,
      patch: {
        boundaryState: result.state,
        playbackAttempts: [result.value],
      },
      now: requestedAt,
    }),
  };
  return {
    recorder,
    attemptId: result.value.id,
    rejectedReason: null,
  };
}

export function recordSpecialCoreIncidentPlaybackTransition({
  previous,
  attemptId,
  status,
  occurredAt,
  error = null,
}: {
  previous: SpecialCoreIncidentRuntimeRecorder;
  attemptId: string;
  status: "browser-play-accepted" | "finished" | "failed";
  occurredAt: number;
  error?: string | null;
}): SpecialCoreIncidentPlaybackRecordResult {
  const boundary = previous.boundary;
  if (!boundary) {
    return {
      recorder: previous,
      attemptId: null,
      rejectedReason: "stale-playback-attempt",
    };
  }
  const result = transitionSpecialCoreIncidentPlayback({
    previous: boundary,
    attemptId,
    status,
    occurredAt,
    error,
  });
  if (!result.accepted) {
    return {
      ...rejectedRuntimeResult(previous, occurredAt, result.reason, {
        operation: `playback-${status}`,
        attemptId,
      }),
      attemptId: null,
    };
  }
  let recorder: SpecialCoreIncidentRuntimeRecorder = {
    ...previous,
    boundary: result.state,
  };
  recorder = appendLifecycleEvent(recorder, {
    occurredAt,
    category: "playback",
    action: `playback-${status}`,
    configRevisionId: result.value.configRevisionId,
    activationId: result.value.activationId,
    scheduleId: result.value.scheduleId,
    decisionId: result.value.decisionId,
    playbackAttemptId: result.value.id,
    details: error ? { error } : {},
  });
  recorder = {
    ...recorder,
    archive: updateSpecialCoreIncidentEvidenceArchive({
      previous: recorder.archive,
      patch: {
        boundaryState: result.state,
        playbackAttempts: [result.value],
      },
      now: occurredAt,
    }),
  };
  return {
    recorder,
    attemptId: result.value.id,
    rejectedReason: null,
  };
}

export function createSpecialCoreIncidentFrozenState({
  recorder,
  capturedAt,
  state,
}: {
  recorder: SpecialCoreIncidentRuntimeRecorder;
  capturedAt: number;
  state: SpecialCoreRuntimeState;
}): SpecialCoreIncidentFrozenState | null {
  const boundary = recorder.boundary;
  if (!boundary) return null;
  return {
    capturedAt,
    resetEpochId: boundary.resetEpoch.id,
    configRevisionId: boundary.configurationRevision.id,
    enabled: boundary.configurationRevision.values.enabled,
    status: state.status,
    decision: getRuntimeDecision(state),
    presentationRevision: recorder.latestPresentationRevision,
    latestFrameId: boundary.latestFrame?.id ?? null,
    latestObservationId: boundary.latestObservation?.id ?? null,
    confirmationAttemptId: boundary.activeConfirmationAttempt?.id ?? null,
    activationId: boundary.activeActivation?.id ?? null,
    scheduleId: boundary.activeSchedule?.id ?? boundary.latestSchedule?.id ?? null,
    decisionId: boundary.latestDecision?.id ?? null,
    playbackAttemptId: boundary.latestPlaybackAttempt?.id ?? null,
  };
}

export function shouldCaptureSpecialCoreIncidentMedia({
  recorder,
  sampledAt,
}: {
  recorder: SpecialCoreIncidentRuntimeRecorder;
  sampledAt: number;
}): boolean {
  if (recorder.boundary?.activeConfirmationAttempt) return true;
  if (recorder.latestMediaAt === null) return true;
  return sampledAt - recorder.latestMediaAt >= SPECIAL_CORE_PERIODIC_MEDIA_INTERVAL_MS;
}

export function createSpecialCoreSourceGeometryRevision({
  width,
  height,
  roi,
}: {
  width: number;
  height: number;
  roi: { x: number; y: number; width: number; height: number } | null;
}): string {
  const region = roi
    ? `${roi.x},${roi.y},${roi.width},${roi.height}`
    : "none";
  return hashToken(`${width}x${height}:${region}`);
}

function recordRecognitionTransition({
  recorder,
  boundary,
  frame,
  observation,
  input,
  patch,
}: {
  recorder: SpecialCoreIncidentRuntimeRecorder;
  boundary: SpecialCoreIncidentBoundaryState;
  frame: SpecialCoreIncidentFrame;
  observation: SpecialCoreIncidentObservation;
  input: SpecialCoreIncidentRuntimeSampleInput;
  patch: SpecialCoreIncidentEvidencePatch;
}): {
  recorder: SpecialCoreIncidentRuntimeRecorder;
  boundary: SpecialCoreIncidentBoundaryState;
} {
  if (observation.decision !== "accepted") {
    return { recorder, boundary };
  }

  const confirmationKind = getConfirmationKind(input.stateBefore, input.sampledAt);
  const enteredPending = input.stateAfter.pendingDetections.some(
    (entry) => entry.observedAt === input.sampledAt,
  );
  const activated =
    input.stateAfter.activationId !== input.stateBefore.activationId &&
    input.stateAfter.activationConfirmedAt === input.sampledAt;

  if (enteredPending || activated) {
    const result = collectSpecialCoreIncidentConfirmation({
      previous: boundary,
      frame,
      observation,
      kind: confirmationKind,
    });
    if (!result.accepted) {
      return {
        recorder: appendBoundaryRejection(
          recorder,
          input.sampledAt,
          result.reason,
          {
            operation: "collect-confirmation",
            frameId: frame.id,
            runtimeActivationId: input.stateAfter.activationId,
          },
        ),
        boundary,
      };
    }
    boundary = result.state;
    if (result.value.expiredAttempt) {
      patch.confirmationAttempts = mergePatchById(
        patch.confirmationAttempts,
        result.value.expiredAttempt,
      );
    }
    let attempt = result.value.attempt;
    let activation = result.value.activation;
    if (activation) {
      activation = {
        ...activation,
        runtimeActivationId: input.stateAfter.activationId,
        startedAt:
          input.stateAfter.activationStartedAt ?? activation.startedAt,
        confirmedAt:
          input.stateAfter.activationConfirmedAt ?? activation.confirmedAt,
        lastSeenAt:
          input.stateAfter.activationLastSeenAt ?? activation.lastSeenAt,
        cooldownEndsAt:
          input.stateAfter.cooldownEndsAt ?? activation.cooldownEndsAt,
        alertDueAt: input.stateAfter.alertDueAt ?? activation.alertDueAt,
      };
      attempt = { ...attempt, activationId: activation.id };
      boundary = {
        ...boundary,
        activeActivation: activation,
      };
      patch.activations = mergePatchById(patch.activations, activation);
      appendClosedBoundary(patch, result.value.closed);
    }
    patch.confirmationAttempts = mergePatchById(
      patch.confirmationAttempts,
      attempt,
    );
    recorder = appendLifecycleEvent(
      { ...recorder, boundary },
      {
        occurredAt: input.sampledAt,
        category: activation ? "activation" : "confirmation",
        action: activation ? "activation-confirmed" : "confirmation-collected",
        configRevisionId: boundary.configurationRevision.id,
        frameId: frame.id,
        observationId: observation.id,
        confirmationAttemptId: attempt.id,
        activationId: activation?.id ?? null,
        details: {
          kind: confirmationKind,
          observationCount: attempt.observationIds.length,
          runtimeActivationId: input.stateAfter.activationId,
        },
      },
    );
    return { recorder, boundary };
  }

  const activation = boundary.activeActivation;
  const isCurrentActivation =
    activation?.runtimeActivationId === input.stateAfter.activationId;
  const wasSeen =
    input.stateAfter.activationLastSeenAt === input.sampledAt &&
    input.stateBefore.activationLastSeenAt !== input.stateAfter.activationLastSeenAt;
  if (!activation || !isCurrentActivation || !wasSeen) {
    return { recorder, boundary };
  }
  const sighting = recordSpecialCoreIncidentActivationSighting({
    previous: boundary,
    frame,
    observation,
  });
  if (!sighting.accepted) {
    return {
      recorder: appendBoundaryRejection(
        recorder,
        input.sampledAt,
        sighting.reason,
        { operation: "record-activation-sighting", frameId: frame.id },
      ),
      boundary,
    };
  }
  boundary = sighting.state;
  patch.activations = mergePatchById(patch.activations, sighting.value);
  return { recorder, boundary };
}

function synchronizeBoundary(
  previous: SpecialCoreIncidentRuntimeRecorder,
  input: SpecialCoreIncidentRuntimeSampleInput,
): SpecialCoreIncidentRuntimeRecorder {
  const continuity: SpecialCoreIncidentContinuity = {
    captureGeneration: previous.captureGeneration,
    featureGeneration: previous.featureGeneration,
    parserRuntimeGeneration: input.parserRuntimeGeneration,
    matcherWorkerGeneration: previous.matcherWorkerGeneration,
    layoutKey: input.layoutKey,
    sourceGeometryRevision: input.sourceGeometryRevision,
  };
  if (!previous.boundary) {
    const boundary = createSpecialCoreIncidentBoundary({
      sessionId: createSessionId(input.sampledAt),
      continuity,
      configuration: input.configuration,
      now: input.sampledAt,
    });
    let recorder: SpecialCoreIncidentRuntimeRecorder = {
      ...previous,
      boundary,
      pendingReset: null,
      archive: updateSpecialCoreIncidentEvidenceArchive({
        previous: previous.archive,
        patch: { boundaryState: boundary },
        now: input.sampledAt,
      }),
    };
    recorder = appendLifecycleEvent(recorder, {
      occurredAt: input.sampledAt,
      category: "lifecycle",
      action: "initialized",
      configRevisionId: boundary.configurationRevision.id,
      details: { enabled: input.configuration.enabled },
    });
    return recorder;
  }

  const current = previous.boundary;
  const continuityReason = getSpecialCoreIncidentContinuityResetReason(
    current.resetEpoch.continuity,
    continuity,
  );
  const enabledChanged =
    current.configurationRevision.values.enabled !== input.configuration.enabled;
  const reason = selectResetReason({
    enabledChanged,
    enabled: input.configuration.enabled,
    continuityReason,
    pendingReset: previous.pendingReset,
  });
  if (reason) {
    const result = resetSpecialCoreIncidentBoundary({
      previous: current,
      continuity,
      configuration: input.configuration,
      now: input.sampledAt,
      reason,
    });
    if (!result.accepted) {
      return appendBoundaryRejection(previous, input.sampledAt, result.reason, {
        operation: "reset-boundary",
        requestedReason: reason,
      });
    }
    const patch: SpecialCoreIncidentEvidencePatch = {
      boundaryState: result.state,
    };
    appendClosedBoundary(patch, result.value.closed);
    let recorder: SpecialCoreIncidentRuntimeRecorder = {
      ...previous,
      boundary: result.state,
      pendingReset: null,
      archive: updateSpecialCoreIncidentEvidenceArchive({
        previous: previous.archive,
        patch,
        now: input.sampledAt,
      }),
    };
    recorder = appendLifecycleEvent(recorder, {
      occurredAt: input.sampledAt,
      category:
        reason === "disabled" || reason === "enabled"
          ? "configuration"
          : "lifecycle",
      action:
        reason === "disabled"
          ? "disabled"
          : reason === "enabled"
            ? "enabled"
            : "reset",
      configRevisionId: result.value.configurationRevision.id,
      details: {
        reason,
        previousResetEpochId: current.resetEpoch.id,
        nextResetEpochId: result.value.resetEpoch.id,
      },
    });
    return recorder;
  }

  const revision = reviseSpecialCoreIncidentConfiguration({
    previous: current,
    configuration: input.configuration,
    now: input.sampledAt,
  });
  if (!revision.accepted) {
    return appendBoundaryRejection(previous, input.sampledAt, revision.reason, {
      operation: "revise-configuration",
    });
  }
  if (!revision.value.changed) {
    return { ...previous, boundary: revision.state, pendingReset: null };
  }
  let recorder: SpecialCoreIncidentRuntimeRecorder = {
    ...previous,
    boundary: revision.state,
    pendingReset: null,
    archive: updateSpecialCoreIncidentEvidenceArchive({
      previous: previous.archive,
      patch: { boundaryState: revision.state },
      now: input.sampledAt,
    }),
  };
  recorder = appendLifecycleEvent(recorder, {
    occurredAt: input.sampledAt,
    category: "configuration",
    action: "configuration-revised",
    configRevisionId: revision.value.configurationRevision.id,
    activationId: revision.state.activeActivation?.id ?? null,
    scheduleId: revision.state.activeSchedule?.id ?? null,
    details: {
      timingChanged: revision.value.timingChanged,
      fingerprint: revision.value.configurationRevision.fingerprint,
    },
  });
  return recorder;
}

function appendLifecycleEvent(
  previous: SpecialCoreIncidentRuntimeRecorder,
  input: Pick<
    SpecialCoreIncidentLifecycleEvent,
    "occurredAt" | "category" | "action" | "details"
  > &
    Partial<
      Pick<
        SpecialCoreIncidentLifecycleEvent,
        | "configRevisionId"
        | "frameId"
        | "observationId"
        | "confirmationAttemptId"
        | "activationId"
        | "scheduleId"
        | "decisionId"
        | "playbackAttemptId"
      >
    >,
): SpecialCoreIncidentRuntimeRecorder {
  const boundary = previous.boundary;
  if (!boundary) return previous;
  const lifecycleSequence = previous.lifecycleSequence + 1;
  const event: SpecialCoreIncidentLifecycleEvent = {
    id: `special-core-event:${boundary.sessionId}:${lifecycleSequence}`,
    resetEpochId: boundary.resetEpoch.id,
    occurredAt: input.occurredAt,
    category: input.category,
    action: input.action,
    configRevisionId: input.configRevisionId ?? null,
    frameId: input.frameId ?? null,
    observationId: input.observationId ?? null,
    confirmationAttemptId: input.confirmationAttemptId ?? null,
    activationId: input.activationId ?? null,
    scheduleId: input.scheduleId ?? null,
    decisionId: input.decisionId ?? null,
    playbackAttemptId: input.playbackAttemptId ?? null,
    details: input.details,
  };
  return {
    ...previous,
    lifecycleSequence,
    archive: updateSpecialCoreIncidentEvidenceArchive({
      previous: previous.archive,
      patch: { lifecycleEvents: [event] },
      now: input.occurredAt,
    }),
  };
}

function appendBoundaryRejection(
  previous: SpecialCoreIncidentRuntimeRecorder,
  occurredAt: number,
  reason: SpecialCoreIncidentBoundaryRejectReason,
  details: Record<string, unknown>,
): SpecialCoreIncidentRuntimeRecorder {
  return appendLifecycleEvent(previous, {
    occurredAt,
    category: "runtime-error",
    action: "boundary-rejected",
    details: { ...details, reason },
  });
}

function rejectedRuntimeResult(
  previous: SpecialCoreIncidentRuntimeRecorder,
  occurredAt: number,
  reason: SpecialCoreIncidentBoundaryRejectReason,
  details: Record<string, unknown>,
): SpecialCoreIncidentRuntimeRecordResult {
  return {
    recorder: appendBoundaryRejection(previous, occurredAt, reason, details),
    rejectedReason: reason,
  };
}

function appendClosedBoundary(
  patch: SpecialCoreIncidentEvidencePatch,
  closed: {
    confirmationAttempt: NonNullable<
      SpecialCoreIncidentEvidencePatch["confirmationAttempts"]
    >[number] | null;
    activation: NonNullable<
      SpecialCoreIncidentEvidencePatch["activations"]
    >[number] | null;
    schedule: NonNullable<SpecialCoreIncidentEvidencePatch["schedules"]>[number] | null;
    playbackAttempt: NonNullable<
      SpecialCoreIncidentEvidencePatch["playbackAttempts"]
    >[number] | null;
  } | null,
): void {
  if (!closed) return;
  if (closed.confirmationAttempt) {
    patch.confirmationAttempts = mergePatchById(
      patch.confirmationAttempts,
      closed.confirmationAttempt,
    );
  }
  if (closed.activation) {
    patch.activations = mergePatchById(patch.activations, closed.activation);
  }
  if (closed.schedule) {
    patch.schedules = mergePatchById(patch.schedules, closed.schedule);
  }
  if (closed.playbackAttempt) {
    patch.playbackAttempts = mergePatchById(
      patch.playbackAttempts,
      closed.playbackAttempt,
    );
  }
}

function getObservationDecision(
  input: SpecialCoreIncidentRuntimeSampleInput,
): {
  decision: SpecialCoreIncidentObservationDecision;
  reason: string | null;
} {
  if (input.runtimeFailure || input.snapshot.error) {
    return {
      decision: "error",
      reason:
        input.runtimeFailure?.code ?? input.snapshot.error ?? "runtime-error",
    };
  }
  if (input.snapshot.detectedIcon) {
    return {
      decision: "accepted",
      reason: input.snapshot.detectedIcon.match.decisionReason,
    };
  }
  if (input.snapshot.candidateIcons.length > 0) {
    return {
      decision: "rejected",
      reason: input.snapshot.candidateIcons[0]?.match.decisionReason ?? null,
    };
  }
  return { decision: "missing", reason: "no-eligible-candidate" };
}

function toIncidentCandidate(
  candidate: SpecialCoreSnapshot["candidateIcons"][number],
): SpecialCoreIncidentCandidate {
  return {
    boxIndex: candidate.boxIndex,
    box: { ...candidate.box },
    match: { ...candidate.match },
  };
}

function toIncidentStateSnapshot(
  state: SpecialCoreRuntimeState,
  capturedAt: number,
): SpecialCoreIncidentRuntimeStateSnapshot {
  return {
    capturedAt,
    status: state.status,
    unsupportedReason: state.unsupportedReason,
    boxCount: state.boxCount,
    detectedCount: state.detectedCount,
    pendingConfirmationCount: state.pendingDetections.length,
    runtimeActivationId: state.activationId,
    activationStartedAt: state.activationStartedAt,
    activationConfirmedAt: state.activationConfirmedAt,
    activationLastSeenAt: state.activationLastSeenAt,
    cooldownEndsAt: state.cooldownEndsAt,
    alertDueAt: state.alertDueAt,
    alertedAt: state.alertedAt,
    lastAlertedAt: state.lastAlertedAt,
    playbackStatus: state.lastAlertPlayback?.status ?? null,
    playbackRequestedAt: state.lastAlertPlayback?.requestedAt ?? null,
  };
}

function getConfirmationKind(
  stateBefore: SpecialCoreRuntimeState,
  sampledAt: number,
): "new-activation" | "cooldown-reacquire" {
  return stateBefore.cooldownEndsAt !== null && sampledAt < stateBefore.cooldownEndsAt
    ? "cooldown-reacquire"
    : "new-activation";
}

function getMediaReason(
  input: SpecialCoreIncidentRuntimeSampleInput,
): SpecialCoreIncidentMediaReason {
  if (input.runtimeFailure || input.snapshot.error) return "runtime-error";
  if (
    input.stateAfter.activationId !== input.stateBefore.activationId ||
    input.stateAfter.pendingDetections.some(
      (entry) => entry.observedAt === input.sampledAt,
    )
  ) {
    return "activation-confirmation";
  }
  if (input.snapshot.candidateIcons.length > 0) return "rejected-observation";
  return "periodic";
}

function isRequiredMediaReason(reason: SpecialCoreIncidentMediaReason): boolean {
  return (
    reason === "runtime-error" ||
    reason === "activation-confirmation" ||
    reason === "alert-decision" ||
    reason === "playback-failed"
  );
}

function getRuntimeDecision(state: SpecialCoreRuntimeState): string {
  if (state.unsupportedReason) return state.unsupportedReason;
  if (state.alertedAt !== null) return "alerted";
  if (state.pendingDetections.length > 0) return "confirmation-pending";
  if (state.activationId > 0) return "activation-active";
  return state.status;
}

function selectResetReason({
  enabledChanged,
  enabled,
  continuityReason,
  pendingReset,
}: {
  enabledChanged: boolean;
  enabled: boolean;
  continuityReason: Exclude<SpecialCoreIncidentResetReason, "initialized"> | null;
  pendingReset: PendingReset | null;
}): Exclude<SpecialCoreIncidentResetReason, "initialized"> | null {
  if (enabledChanged) {
    if (pendingReset?.reason === "global-disabled") return "global-disabled";
    return enabled ? "enabled" : "disabled";
  }
  if (continuityReason && continuityReason !== "profile-replaced") {
    return continuityReason;
  }
  return pendingReset?.reason ?? continuityReason;
}

function mergePatchById<T extends { id: string }>(
  current: T[] | undefined,
  entry: T,
): T[] {
  return [...(current ?? []).filter((item) => item.id !== entry.id), entry];
}

function createSessionId(now: number): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${Math.max(0, Math.floor(now)).toString(36)}-${random}`;
}

function hashToken(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
