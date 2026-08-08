import type {
  BoosterExpiryRuntimeState,
  BoosterExpiryWorkerPerformance,
  BoosterExpiryWorkerResult,
} from "../../../lib/boosterExpiry/boosterExpiryTypes";
import {
  collectBoosterExpiryIncidentCycleObservation,
  completeBoosterExpiryIncidentSchedule,
  createBoosterExpiryIncidentBoundary,
  freezeBoosterExpiryIncidentBoundary,
  getBoosterExpiryIncidentContinuityResetReason,
  recordBoosterExpiryIncidentCycleSupport,
  recordBoosterExpiryIncidentFrame,
  recordBoosterExpiryIncidentObservation,
  registerBoosterExpiryIncidentSchedule,
  requestBoosterExpiryIncidentPlayback,
  resetBoosterExpiryIncidentBoundary,
  restartBoosterExpiryIncidentFlow,
  reviseBoosterExpiryIncidentConfiguration,
  transitionBoosterExpiryIncidentPlayback,
} from "./boosterExpiryIncidentBoundary";
import {
  createBoosterExpiryIncidentEvidenceArchive,
  updateBoosterExpiryIncidentEvidenceArchive,
  type BoosterExpiryIncidentEvidencePatch,
} from "./boosterExpiryIncidentEvidenceArchive";
import type {
  BoosterExpiryIncidentBoundaryRejectReason,
  BoosterExpiryIncidentBoundaryState,
  BoosterExpiryIncidentConfiguration,
  BoosterExpiryIncidentContinuity,
  BoosterExpiryIncidentEvidenceArchive,
  BoosterExpiryIncidentFlowRestartReason,
  BoosterExpiryIncidentFrame,
  BoosterExpiryIncidentFrameSource,
  BoosterExpiryIncidentFrozenState,
  BoosterExpiryIncidentLifecycleEvent,
  BoosterExpiryIncidentMediaFrame,
  BoosterExpiryIncidentMediaReason,
  BoosterExpiryIncidentObservation,
  BoosterExpiryIncidentObservationDecision,
  BoosterExpiryIncidentResetReason,
  BoosterExpiryIncidentRuntimeFailure,
  BoosterExpiryIncidentRuntimeStateSnapshot,
  BoosterExpiryIncidentTimerRead,
} from "./boosterExpiryIncidentEvidenceTypes";

const BOOSTER_EXPIRY_PERIODIC_MEDIA_INTERVAL_MS = 15_000;

type PendingReset = {
  reason: Exclude<BoosterExpiryIncidentResetReason, "initialized">;
  requestedAt: number;
};

type PendingFlowRestart = {
  reason: Exclude<BoosterExpiryIncidentFlowRestartReason, "initialized">;
  requestedAt: number;
};

export type BoosterExpiryIncidentRuntimeRecorder = {
  boundary: BoosterExpiryIncidentBoundaryState | null;
  archive: BoosterExpiryIncidentEvidenceArchive;
  captureGeneration: number;
  featureGeneration: number;
  workerGeneration: number;
  lifecycleSequence: number;
  presentationSequence: number;
  latestPresentationRevision: string | null;
  latestMediaAt: number | null;
  pendingReset: PendingReset | null;
  pendingFlowRestart: PendingFlowRestart | null;
};

export type BoosterExpiryIncidentRuntimeSampleInput = {
  sampledAt: number;
  configuration: BoosterExpiryIncidentConfiguration;
  monitoringGeneration: number;
  layoutKey: string;
  sourceGeometryRevision: string;
  stateBefore: BoosterExpiryRuntimeState;
  stateAfter: BoosterExpiryRuntimeState;
  result: BoosterExpiryWorkerResult | null;
  performance: BoosterExpiryWorkerPerformance | null;
  source: BoosterExpiryIncidentFrameSource | null;
  runtimeFailure: BoosterExpiryIncidentRuntimeFailure | null;
  media?: {
    imageDataUrl: string | null;
    reason?: BoosterExpiryIncidentMediaReason | null;
  } | null;
  recordFrame?: boolean;
  unavailableAction?: string | null;
};

export type BoosterExpiryIncidentRuntimeRecordResult = {
  recorder: BoosterExpiryIncidentRuntimeRecorder;
  rejectedReason: BoosterExpiryIncidentBoundaryRejectReason | null;
};

export type BoosterExpiryIncidentPlaybackRecordResult =
  BoosterExpiryIncidentRuntimeRecordResult & {
    attemptId: string | null;
  };

export function createBoosterExpiryIncidentRuntimeRecorder(
  now = Date.now(),
): BoosterExpiryIncidentRuntimeRecorder {
  return {
    boundary: null,
    archive: createBoosterExpiryIncidentEvidenceArchive(now),
    captureGeneration: 1,
    featureGeneration: 1,
    workerGeneration: 1,
    lifecycleSequence: 0,
    presentationSequence: 0,
    latestPresentationRevision: null,
    latestMediaAt: null,
    pendingReset: null,
    pendingFlowRestart: null,
  };
}

export function requestBoosterExpiryIncidentRuntimeReset({
  previous,
  reason,
  requestedAt = Date.now(),
}: {
  previous: BoosterExpiryIncidentRuntimeRecorder;
  reason: Exclude<BoosterExpiryIncidentResetReason, "initialized">;
  requestedAt?: number;
}): BoosterExpiryIncidentRuntimeRecorder {
  const next = { ...previous };
  if (reason === "stream-replaced") {
    next.captureGeneration += 1;
  } else if (
    reason !== "layout-changed" &&
    reason !== "source-geometry-changed" &&
    reason !== "monitoring-generation-changed"
  ) {
    next.featureGeneration += 1;
  }
  next.pendingReset = { reason, requestedAt };
  return next;
}

export function requestBoosterExpiryIncidentFlowRestart({
  previous,
  reason,
  requestedAt = Date.now(),
}: {
  previous: BoosterExpiryIncidentRuntimeRecorder;
  reason: Exclude<BoosterExpiryIncidentFlowRestartReason, "initialized">;
  requestedAt?: number;
}): BoosterExpiryIncidentRuntimeRecorder {
  return {
    ...previous,
    workerGeneration: previous.workerGeneration + 1,
    pendingFlowRestart: { reason, requestedAt },
  };
}

export function recordBoosterExpiryIncidentRuntimeSample({
  previous,
  input,
}: {
  previous: BoosterExpiryIncidentRuntimeRecorder;
  input: BoosterExpiryIncidentRuntimeSampleInput;
}): BoosterExpiryIncidentRuntimeRecorder {
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

  const frameResult = recordBoosterExpiryIncidentFrame({
    previous: boundary,
    sampledAt: input.sampledAt,
  });
  if (!frameResult.accepted) {
    return appendBoundaryRejection(
      recorder,
      input.sampledAt,
      frameResult.reason,
      {
        operation: "record-frame",
      },
    );
  }

  const mediaReason = getMediaReason(input);
  const mediaFrameId = input.media?.imageDataUrl
    ? `booster-expiry-media:${frameResult.value.id}`
    : null;
  const frame: BoosterExpiryIncidentFrame = {
    ...frameResult.value,
    source: input.source ? cloneFrameSource(input.source) : null,
    runtimeFailure: input.runtimeFailure ? { ...input.runtimeFailure } : null,
    mediaFrameId,
  };
  boundary = { ...frameResult.state, latestFrame: frame };

  const observationDecision = getObservationDecision(input);
  const observationResult = recordBoosterExpiryIncidentObservation({
    previous: boundary,
    frame,
    decision: observationDecision.decision,
    reason: observationDecision.reason,
    recognizerVersion: input.result?.recognizerVersion ?? null,
    rawTime: toTimerRead(input.result?.rawTime ?? null),
    selectedTime: toTimerRead(input.result?.time ?? null),
    timerRect: input.result?.timeRect.rect
      ? { ...input.result.timeRect.rect }
      : null,
    timerCandidateCount: input.result?.timeRect.candidateCount ?? 0,
    timerMatchCount: input.result?.timeRect.matchCount ?? 0,
    flow: input.result?.flow
      ? {
          locked: input.result.flow.locked,
          source: input.result.flow.source,
          predictedSeconds: input.result.flow.predictedSeconds,
          rawDeltaSeconds: input.result.flow.rawDeltaSeconds,
        }
      : null,
    recognitionMs: input.performance?.recognitionMs ?? null,
    totalMs: input.performance?.totalMs ?? null,
    stateBefore: toIncidentStateSnapshot(input.stateBefore, input.sampledAt),
    stateAfter: toIncidentStateSnapshot(input.stateAfter, input.sampledAt),
  });
  if (!observationResult.accepted) {
    return appendBoundaryRejection(
      recorder,
      input.sampledAt,
      observationResult.reason,
      { operation: "record-observation", frameId: frame.id },
    );
  }
  const observation = observationResult.value;
  boundary = observationResult.state;

  const patch: BoosterExpiryIncidentEvidencePatch = {
    frames: [frame],
    observations: [observation],
  };
  if (mediaFrameId && input.media?.imageDataUrl) {
    const media: BoosterExpiryIncidentMediaFrame = {
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
        id: `booster-expiry-omission:${frame.id}:${mediaReason}`,
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
    flowEpochId: boundary.flowEpoch.id,
    frameId: frame.id,
    observationId: observation.id,
    candidateAttemptId: boundary.activeCandidateAttempt?.id ?? null,
    cycleId: boundary.activeCycle?.id ?? null,
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
          decision: input.stateAfter.lastDecision,
        },
  });

  const presentationSequence = recorder.presentationSequence + 1;
  const latestPresentationRevision = `booster-expiry-presentation:${boundary.resetEpoch.id}:${presentationSequence}`;
  return {
    ...recorder,
    boundary,
    presentationSequence,
    latestPresentationRevision,
    archive: updateBoosterExpiryIncidentEvidenceArchive({
      previous: recorder.archive,
      patch: { ...patch, boundaryState: boundary },
      now: input.sampledAt,
    }),
  };
}

export function recordBoosterExpiryIncidentConfigurationObserved({
  previous,
  configuration,
  occurredAt,
}: {
  previous: BoosterExpiryIncidentRuntimeRecorder;
  configuration: BoosterExpiryIncidentConfiguration;
  occurredAt: number;
}): BoosterExpiryIncidentRuntimeRecordResult {
  const boundary = previous.boundary;
  if (!boundary) return { recorder: previous, rejectedReason: null };
  const revision = reviseBoosterExpiryIncidentConfiguration({
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
  let recorder: BoosterExpiryIncidentRuntimeRecorder = {
    ...previous,
    boundary: revision.state,
    archive: updateBoosterExpiryIncidentEvidenceArchive({
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
    cycleId: revision.state.activeCycle?.id ?? null,
    scheduleId: revision.state.activeSchedule?.id ?? null,
    details: {
      timingChanged: revision.value.timingChanged,
      playbackChanged: revision.value.playbackChanged,
      fingerprint: revision.value.configurationRevision.fingerprint,
      source: "scheduler",
    },
  });
  return { recorder, rejectedReason: null };
}

export function recordBoosterExpiryIncidentScheduleRegistered({
  previous,
  cycleId,
  registeredAt,
  reason,
}: {
  previous: BoosterExpiryIncidentRuntimeRecorder;
  cycleId: string;
  registeredAt: number;
  reason: "cycle-confirmed" | "configuration-retimed" | "browser-rescheduled";
}): BoosterExpiryIncidentRuntimeRecordResult {
  const boundary = previous.boundary;
  const cycle = boundary?.activeCycle ?? null;
  if (!boundary || !cycle || cycle.id !== cycleId) {
    return rejectedRuntimeResult(previous, registeredAt, "stale-cycle", {
      operation: "register-schedule",
      cycleId,
    });
  }
  const result = registerBoosterExpiryIncidentSchedule({
    previous: boundary,
    cycle,
    registeredAt,
    reason,
  });
  if (!result.accepted) {
    return rejectedRuntimeResult(previous, registeredAt, result.reason, {
      operation: "register-schedule",
      cycleId,
    });
  }
  let recorder: BoosterExpiryIncidentRuntimeRecorder = {
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
    cycleId,
    scheduleId: result.value.schedule.id,
    details: {
      alertDueAt: result.value.schedule.alertDueAt,
      reason,
    },
  });
  recorder = {
    ...recorder,
    archive: updateBoosterExpiryIncidentEvidenceArchive({
      previous: recorder.archive,
      patch: {
        boundaryState: result.state,
        cycles: [result.state.activeCycle!],
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

export function recordBoosterExpiryIncidentScheduleOutcome({
  previous,
  cycleId,
  outcome,
  occurredAt,
  reason = null,
}: {
  previous: BoosterExpiryIncidentRuntimeRecorder;
  cycleId: string;
  outcome: "cancelled" | "suppressed" | "fired";
  occurredAt: number;
  reason?: string | null;
}): BoosterExpiryIncidentRuntimeRecordResult {
  const boundary = previous.boundary;
  const schedule = boundary?.activeSchedule ?? null;
  if (!boundary || !schedule || schedule.cycleId !== cycleId) {
    return rejectedRuntimeResult(previous, occurredAt, "stale-schedule", {
      operation: `complete-schedule-${outcome}`,
      cycleId,
    });
  }
  const result = completeBoosterExpiryIncidentSchedule({
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
  let recorder: BoosterExpiryIncidentRuntimeRecorder = {
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
    cycleId,
    scheduleId: result.value.schedule.id,
    decisionId: result.value.decision?.id ?? null,
    details: {
      reason,
      schedulerDelayMs: result.value.decision?.schedulerDelayMs ?? null,
    },
  });
  recorder = {
    ...recorder,
    archive: updateBoosterExpiryIncidentEvidenceArchive({
      previous: recorder.archive,
      patch: {
        boundaryState: result.state,
        cycles: result.state.activeCycle
          ? [result.state.activeCycle]
          : undefined,
        schedules: [result.value.schedule],
        decisions: result.value.decision ? [result.value.decision] : undefined,
      },
      now: occurredAt,
    }),
  };
  return { recorder, rejectedReason: null };
}

export function recordBoosterExpiryIncidentPlaybackRequested({
  previous,
  cycleId,
  requestedAt,
}: {
  previous: BoosterExpiryIncidentRuntimeRecorder;
  cycleId: string;
  requestedAt: number;
}): BoosterExpiryIncidentPlaybackRecordResult {
  const boundary = previous.boundary;
  const decision = boundary?.latestDecision ?? null;
  if (!boundary || !decision || decision.cycleId !== cycleId) {
    return {
      ...rejectedRuntimeResult(previous, requestedAt, "stale-alert-decision", {
        operation: "request-playback",
        cycleId,
      }),
      attemptId: null,
    };
  }
  const result = requestBoosterExpiryIncidentPlayback({
    previous: boundary,
    decision,
    requestedAt,
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
  let recorder: BoosterExpiryIncidentRuntimeRecorder = {
    ...previous,
    boundary: result.state,
  };
  recorder = appendLifecycleEvent(recorder, {
    occurredAt: requestedAt,
    category: "playback",
    action: "playback-requested",
    configRevisionId: result.value.configRevisionId,
    cycleId,
    scheduleId: result.value.scheduleId,
    decisionId: result.value.decisionId,
    playbackAttemptId: result.value.id,
    details: {
      soundId: result.value.soundId,
      effectiveVolume: result.value.effectiveVolume,
    },
  });
  recorder = {
    ...recorder,
    archive: updateBoosterExpiryIncidentEvidenceArchive({
      previous: recorder.archive,
      patch: {
        boundaryState: result.state,
        playbackAttempts: [result.value],
      },
      now: requestedAt,
    }),
  };
  return { recorder, attemptId: result.value.id, rejectedReason: null };
}

export function recordBoosterExpiryIncidentPlaybackTransition({
  previous,
  attemptId,
  status,
  occurredAt,
  error = null,
}: {
  previous: BoosterExpiryIncidentRuntimeRecorder;
  attemptId: string;
  status: "browser-play-accepted" | "finished" | "failed";
  occurredAt: number;
  error?: string | null;
}): BoosterExpiryIncidentPlaybackRecordResult {
  const boundary = previous.boundary;
  if (!boundary) {
    return {
      recorder: previous,
      attemptId: null,
      rejectedReason: "stale-playback-attempt",
    };
  }
  const result = transitionBoosterExpiryIncidentPlayback({
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
  let recorder: BoosterExpiryIncidentRuntimeRecorder = {
    ...previous,
    boundary: result.state,
  };
  recorder = appendLifecycleEvent(recorder, {
    occurredAt,
    category: "playback",
    action: `playback-${status}`,
    configRevisionId: result.value.configRevisionId,
    cycleId: result.value.cycleId,
    scheduleId: result.value.scheduleId,
    decisionId: result.value.decisionId,
    playbackAttemptId: result.value.id,
    details: error ? { error } : {},
  });
  recorder = {
    ...recorder,
    archive: updateBoosterExpiryIncidentEvidenceArchive({
      previous: recorder.archive,
      patch: {
        boundaryState: result.state,
        playbackAttempts: [result.value],
      },
      now: occurredAt,
    }),
  };
  return { recorder, attemptId: result.value.id, rejectedReason: null };
}

export function recordBoosterExpiryIncidentPresentation({
  previous,
  occurredAt,
  action,
  details = {},
}: {
  previous: BoosterExpiryIncidentRuntimeRecorder;
  occurredAt: number;
  action: string;
  details?: Record<string, unknown>;
}): BoosterExpiryIncidentRuntimeRecorder {
  return appendLifecycleEvent(previous, {
    occurredAt,
    category: "presentation",
    action,
    details,
  });
}

export function recordBoosterExpiryIncidentInteraction({
  previous,
  occurredAt,
  action,
  details = {},
}: {
  previous: BoosterExpiryIncidentRuntimeRecorder;
  occurredAt: number;
  action: string;
  details?: Record<string, unknown>;
}): BoosterExpiryIncidentRuntimeRecorder {
  return appendLifecycleEvent(previous, {
    occurredAt,
    category: "interaction",
    action,
    details,
  });
}

export function createBoosterExpiryIncidentFrozenState({
  recorder,
  capturedAt,
  state,
}: {
  recorder: BoosterExpiryIncidentRuntimeRecorder;
  capturedAt: number;
  state: BoosterExpiryRuntimeState;
}): BoosterExpiryIncidentFrozenState | null {
  const boundary = recorder.boundary;
  if (!boundary) return null;
  return {
    capturedAt,
    resetEpochId: boundary.resetEpoch.id,
    flowEpochId: boundary.flowEpoch.id,
    configRevisionId: boundary.configurationRevision.id,
    enabled: boundary.configurationRevision.values.enabled,
    status: state.status,
    decision: state.lastDecision,
    presentationRevision: recorder.latestPresentationRevision,
    latestFrameId: boundary.latestFrame?.id ?? null,
    latestObservationId: boundary.latestObservation?.id ?? null,
    candidateAttemptId: boundary.activeCandidateAttempt?.id ?? null,
    cycleId: boundary.activeCycle?.id ?? null,
    scheduleId:
      boundary.activeSchedule?.id ?? boundary.latestSchedule?.id ?? null,
    decisionId: boundary.latestDecision?.id ?? null,
    playbackAttemptId: boundary.latestPlaybackAttempt?.id ?? null,
  };
}

export function freezeBoosterExpiryIncidentRuntimeRecorder({
  previous,
  frozenAt,
}: {
  previous: BoosterExpiryIncidentRuntimeRecorder;
  frozenAt: number;
}): {
  recorder: BoosterExpiryIncidentRuntimeRecorder;
  lease: ReturnType<typeof freezeBoosterExpiryIncidentBoundary>["lease"] | null;
} {
  if (!previous.boundary) return { recorder: previous, lease: null };
  const frozen = freezeBoosterExpiryIncidentBoundary({
    previous: previous.boundary,
    frozenAt,
  });
  return {
    recorder: { ...previous, boundary: frozen.state },
    lease: frozen.lease,
  };
}

export function shouldCaptureBoosterExpiryIncidentMedia({
  recorder,
  sampledAt,
}: {
  recorder: BoosterExpiryIncidentRuntimeRecorder;
  sampledAt: number;
}): boolean {
  if (recorder.boundary?.activeCandidateAttempt) return true;
  if (recorder.latestMediaAt === null) return true;
  return (
    sampledAt - recorder.latestMediaAt >=
    BOOSTER_EXPIRY_PERIODIC_MEDIA_INTERVAL_MS
  );
}

export function createBoosterExpirySourceGeometryRevision({
  width,
  height,
  region,
}: {
  width: number;
  height: number;
  region: { x: number; y: number; width: number; height: number } | null;
}): string {
  const sampledRegion = region
    ? `${region.x},${region.y},${region.width},${region.height}`
    : "none";
  return hashToken(`${width}x${height}:${sampledRegion}`);
}

function recordRecognitionTransition({
  recorder,
  boundary,
  frame,
  observation,
  input,
  patch,
}: {
  recorder: BoosterExpiryIncidentRuntimeRecorder;
  boundary: BoosterExpiryIncidentBoundaryState;
  frame: BoosterExpiryIncidentFrame;
  observation: BoosterExpiryIncidentObservation;
  input: BoosterExpiryIncidentRuntimeSampleInput;
  patch: BoosterExpiryIncidentEvidencePatch;
}): {
  recorder: BoosterExpiryIncidentRuntimeRecorder;
  boundary: BoosterExpiryIncidentBoundaryState;
} {
  const canCollect =
    observation.decision === "accepted" &&
    observation.strongForConfirmation &&
    (observation.rawTime?.seconds ?? 0) >= 60;
  let acceptedNewCycle = false;

  if (canCollect) {
    const result = collectBoosterExpiryIncidentCycleObservation({
      previous: boundary,
      frame,
      observation,
    });
    if (!result.accepted) {
      recorder = appendBoundaryRejection(
        recorder,
        input.sampledAt,
        result.reason,
        { operation: "collect-cycle", observationId: observation.id },
      );
    } else {
      boundary = result.state;
      patch.candidateAttempts = mergePatchById(
        patch.candidateAttempts,
        result.value.attempt,
      );
      if (result.value.expiredAttempt) {
        patch.candidateAttempts = mergePatchById(
          patch.candidateAttempts,
          result.value.expiredAttempt,
        );
      }
      appendClosedBoundary(patch, result.value.closed);
      if (result.value.cycle) {
        acceptedNewCycle = true;
        patch.cycles = mergePatchById(patch.cycles, result.value.cycle);
        recorder = appendLifecycleEvent(recorder, {
          occurredAt: input.sampledAt,
          category: "cycle",
          action: "cycle-confirmed",
          configRevisionId: result.value.cycle.timingConfigRevisionId,
          flowEpochId: observation.flowEpochId,
          frameId: frame.id,
          observationId: observation.id,
          candidateAttemptId: result.value.attempt.id,
          cycleId: result.value.cycle.id,
          details: {
            expiresAt: result.value.cycle.expiresAt,
            observationCount: result.value.cycle.observationIds.length,
          },
        });
      } else {
        recorder = appendLifecycleEvent(recorder, {
          occurredAt: input.sampledAt,
          category: "confirmation",
          action:
            result.value.attempt.status === "rejected"
              ? "candidate-rejected"
              : "candidate-observed",
          configRevisionId: observation.configRevisionId,
          flowEpochId: observation.flowEpochId,
          frameId: frame.id,
          observationId: observation.id,
          candidateAttemptId: result.value.attempt.id,
          cycleId: boundary.activeCycle?.id ?? null,
          details: {
            status: result.value.attempt.status,
            observationCount: result.value.attempt.observationIds.length,
            terminalReason: result.value.attempt.terminalReason,
          },
        });
      }
    }
  }

  if (!acceptedNewCycle && boundary.activeCycle) {
    const cycleId = boundary.activeCycle.id;
    const support = recordBoosterExpiryIncidentCycleSupport({
      previous: boundary,
      cycleId,
      observation,
      occurredAt: input.sampledAt,
    });
    if (!support.accepted) {
      recorder = appendBoundaryRejection(
        recorder,
        input.sampledAt,
        support.reason,
        { operation: "record-cycle-support", cycleId },
      );
    } else {
      boundary = support.state;
      patch.cycles = mergePatchById(patch.cycles, support.value.cycle);
      if (support.value.closedSchedule) {
        patch.schedules = mergePatchById(
          patch.schedules,
          support.value.closedSchedule,
        );
      }
      recorder = appendLifecycleEvent(recorder, {
        occurredAt: input.sampledAt,
        category: "cycle",
        action: `cycle-${support.value.support}`,
        configRevisionId: observation.configRevisionId,
        flowEpochId: observation.flowEpochId,
        frameId: frame.id,
        observationId: observation.id,
        cycleId,
        scheduleId:
          support.value.closedSchedule?.id ??
          boundary.activeSchedule?.id ??
          null,
        details: {
          contradictionCount: support.value.cycle.contradictionCount,
          lastSupportedAt: support.value.cycle.lastSupportedAt,
          terminalReason: support.value.cycle.terminalReason,
        },
      });
    }
  }

  return { recorder, boundary };
}

function synchronizeBoundary(
  previous: BoosterExpiryIncidentRuntimeRecorder,
  input: BoosterExpiryIncidentRuntimeSampleInput,
): BoosterExpiryIncidentRuntimeRecorder {
  const continuity: BoosterExpiryIncidentContinuity = {
    captureGeneration: previous.captureGeneration,
    featureGeneration: previous.featureGeneration,
    monitoringGeneration: input.monitoringGeneration,
    layoutKey: input.layoutKey,
    sourceGeometryRevision: input.sourceGeometryRevision,
  };
  if (!previous.boundary) {
    const boundary = createBoosterExpiryIncidentBoundary({
      sessionId: createSessionId(input.sampledAt),
      continuity,
      configuration: input.configuration,
      workerGeneration: previous.workerGeneration,
      now: input.sampledAt,
    });
    let recorder: BoosterExpiryIncidentRuntimeRecorder = {
      ...previous,
      boundary,
      pendingReset: null,
      pendingFlowRestart: null,
      archive: updateBoosterExpiryIncidentEvidenceArchive({
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
      flowEpochId: boundary.flowEpoch.id,
      details: { enabled: input.configuration.enabled },
    });
    return recorder;
  }

  const current = previous.boundary;
  const continuityReason = getBoosterExpiryIncidentContinuityResetReason(
    current.resetEpoch.continuity,
    continuity,
  );
  const enabledChanged =
    current.configurationRevision.values.enabled !==
    input.configuration.enabled;
  const resetReason = selectResetReason({
    enabledChanged,
    enabled: input.configuration.enabled,
    continuityReason,
    pendingReset: previous.pendingReset,
  });
  if (resetReason) {
    const result = resetBoosterExpiryIncidentBoundary({
      previous: current,
      continuity,
      configuration: input.configuration,
      workerGeneration: previous.workerGeneration,
      now: input.sampledAt,
      reason: resetReason,
    });
    if (!result.accepted) {
      return appendBoundaryRejection(previous, input.sampledAt, result.reason, {
        operation: "reset-boundary",
        requestedReason: resetReason,
      });
    }
    const patch: BoosterExpiryIncidentEvidencePatch = {
      boundaryState: result.state,
    };
    appendClosedBoundary(patch, result.value.closed);
    let recorder: BoosterExpiryIncidentRuntimeRecorder = {
      ...previous,
      boundary: result.state,
      pendingReset: null,
      pendingFlowRestart: null,
      archive: updateBoosterExpiryIncidentEvidenceArchive({
        previous: previous.archive,
        patch,
        now: input.sampledAt,
      }),
    };
    recorder = appendLifecycleEvent(recorder, {
      occurredAt: input.sampledAt,
      category:
        resetReason === "disabled" || resetReason === "enabled"
          ? "configuration"
          : "lifecycle",
      action:
        resetReason === "disabled"
          ? "disabled"
          : resetReason === "enabled"
            ? "enabled"
            : "reset",
      configRevisionId: result.value.configurationRevision.id,
      flowEpochId: result.value.flowEpoch.id,
      details: {
        reason: resetReason,
        previousResetEpochId: current.resetEpoch.id,
        nextResetEpochId: result.value.resetEpoch.id,
      },
    });
    return recorder;
  }

  let recorder: BoosterExpiryIncidentRuntimeRecorder = {
    ...previous,
    pendingReset: null,
  };
  let boundary = current;
  if (previous.pendingFlowRestart) {
    const flow = restartBoosterExpiryIncidentFlow({
      previous: boundary,
      workerGeneration: previous.workerGeneration,
      now: input.sampledAt,
      reason: previous.pendingFlowRestart.reason,
    });
    if (!flow.accepted) {
      return appendBoundaryRejection(previous, input.sampledAt, flow.reason, {
        operation: "restart-worker-flow",
      });
    }
    boundary = flow.state;
    const patch: BoosterExpiryIncidentEvidencePatch = {
      boundaryState: flow.state,
      candidateAttempts: flow.value.closedCandidate
        ? [flow.value.closedCandidate]
        : undefined,
    };
    recorder = {
      ...recorder,
      boundary,
      pendingFlowRestart: null,
      archive: updateBoosterExpiryIncidentEvidenceArchive({
        previous: recorder.archive,
        patch,
        now: input.sampledAt,
      }),
    };
    recorder = appendLifecycleEvent(recorder, {
      occurredAt: input.sampledAt,
      category: "worker-flow",
      action: "worker-flow-restarted",
      configRevisionId: boundary.configurationRevision.id,
      flowEpochId: boundary.flowEpoch.id,
      cycleId: boundary.activeCycle?.id ?? null,
      details: {
        reason: previous.pendingFlowRestart.reason,
        workerGeneration: previous.workerGeneration,
      },
    });
  }

  const revision = reviseBoosterExpiryIncidentConfiguration({
    previous: boundary,
    configuration: input.configuration,
    now: input.sampledAt,
  });
  if (!revision.accepted) {
    return appendBoundaryRejection(recorder, input.sampledAt, revision.reason, {
      operation: "revise-configuration",
    });
  }
  if (!revision.value.changed) {
    return { ...recorder, boundary: revision.state, pendingFlowRestart: null };
  }
  recorder = {
    ...recorder,
    boundary: revision.state,
    pendingFlowRestart: null,
    archive: updateBoosterExpiryIncidentEvidenceArchive({
      previous: recorder.archive,
      patch: { boundaryState: revision.state },
      now: input.sampledAt,
    }),
  };
  return appendLifecycleEvent(recorder, {
    occurredAt: input.sampledAt,
    category: "configuration",
    action: "configuration-revised",
    configRevisionId: revision.value.configurationRevision.id,
    flowEpochId: revision.state.flowEpoch.id,
    cycleId: revision.state.activeCycle?.id ?? null,
    scheduleId: revision.state.activeSchedule?.id ?? null,
    details: {
      timingChanged: revision.value.timingChanged,
      playbackChanged: revision.value.playbackChanged,
      fingerprint: revision.value.configurationRevision.fingerprint,
    },
  });
}

function appendLifecycleEvent(
  previous: BoosterExpiryIncidentRuntimeRecorder,
  input: Pick<
    BoosterExpiryIncidentLifecycleEvent,
    "occurredAt" | "category" | "action" | "details"
  > &
    Partial<
      Pick<
        BoosterExpiryIncidentLifecycleEvent,
        | "configRevisionId"
        | "flowEpochId"
        | "frameId"
        | "observationId"
        | "candidateAttemptId"
        | "cycleId"
        | "scheduleId"
        | "decisionId"
        | "playbackAttemptId"
      >
    >,
): BoosterExpiryIncidentRuntimeRecorder {
  const boundary = previous.boundary;
  if (!boundary) return previous;
  const lifecycleSequence = previous.lifecycleSequence + 1;
  const event: BoosterExpiryIncidentLifecycleEvent = {
    id: `booster-expiry-event:${boundary.sessionId}:${lifecycleSequence}`,
    resetEpochId: boundary.resetEpoch.id,
    occurredAt: input.occurredAt,
    category: input.category,
    action: input.action,
    configRevisionId: input.configRevisionId ?? null,
    flowEpochId: input.flowEpochId ?? null,
    frameId: input.frameId ?? null,
    observationId: input.observationId ?? null,
    candidateAttemptId: input.candidateAttemptId ?? null,
    cycleId: input.cycleId ?? null,
    scheduleId: input.scheduleId ?? null,
    decisionId: input.decisionId ?? null,
    playbackAttemptId: input.playbackAttemptId ?? null,
    details: input.details,
  };
  return {
    ...previous,
    lifecycleSequence,
    archive: updateBoosterExpiryIncidentEvidenceArchive({
      previous: previous.archive,
      patch: { lifecycleEvents: [event] },
      now: input.occurredAt,
    }),
  };
}

function appendBoundaryRejection(
  previous: BoosterExpiryIncidentRuntimeRecorder,
  occurredAt: number,
  reason: BoosterExpiryIncidentBoundaryRejectReason,
  details: Record<string, unknown>,
): BoosterExpiryIncidentRuntimeRecorder {
  return appendLifecycleEvent(previous, {
    occurredAt,
    category: "runtime-error",
    action: "boundary-rejected",
    details: { ...details, reason },
  });
}

function rejectedRuntimeResult(
  previous: BoosterExpiryIncidentRuntimeRecorder,
  occurredAt: number,
  reason: BoosterExpiryIncidentBoundaryRejectReason,
  details: Record<string, unknown>,
): BoosterExpiryIncidentRuntimeRecordResult {
  return {
    recorder: appendBoundaryRejection(previous, occurredAt, reason, details),
    rejectedReason: reason,
  };
}

function appendClosedBoundary(
  patch: BoosterExpiryIncidentEvidencePatch,
  closed: {
    candidateAttempt:
      | NonNullable<
          BoosterExpiryIncidentEvidencePatch["candidateAttempts"]
        >[number]
      | null;
    cycle:
      NonNullable<BoosterExpiryIncidentEvidencePatch["cycles"]>[number] | null;
    schedule:
      | NonNullable<BoosterExpiryIncidentEvidencePatch["schedules"]>[number]
      | null;
    playbackAttempt:
      | NonNullable<
          BoosterExpiryIncidentEvidencePatch["playbackAttempts"]
        >[number]
      | null;
  } | null,
): void {
  if (!closed) return;
  if (closed.candidateAttempt) {
    patch.candidateAttempts = mergePatchById(
      patch.candidateAttempts,
      closed.candidateAttempt,
    );
  }
  if (closed.cycle) {
    patch.cycles = mergePatchById(patch.cycles, closed.cycle);
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
  input: BoosterExpiryIncidentRuntimeSampleInput,
): {
  decision: BoosterExpiryIncidentObservationDecision;
  reason: string | null;
} {
  if (input.runtimeFailure) {
    return { decision: "error", reason: input.runtimeFailure.code };
  }
  const rawTime = input.result?.rawTime ?? null;
  const selectedTime = input.result?.time ?? null;
  if (rawTime?.ok || selectedTime?.ok) {
    return {
      decision: "accepted",
      reason: rawTime?.ok ? rawTime.reason : (selectedTime?.reason ?? null),
    };
  }
  if (input.result) {
    return {
      decision: "rejected",
      reason:
        rawTime?.reason ??
        selectedTime?.reason ??
        input.result.timeRect.reason ??
        "timer-rejected",
    };
  }
  return { decision: "missing", reason: "worker-result-missing" };
}

function toTimerRead(
  value: BoosterExpiryWorkerResult["rawTime"] | null,
): BoosterExpiryIncidentTimerRead | null {
  if (!value) return null;
  return {
    ok: value.ok,
    reason: value.reason,
    text: value.text,
    seconds: value.seconds,
    format: value.format ?? null,
    selectedBy: value.selectedBy ?? null,
    rect: value.rect ? { ...value.rect } : null,
    digitCount: value.digitCount,
  };
}

function toIncidentStateSnapshot(
  state: BoosterExpiryRuntimeState,
  capturedAt: number,
): BoosterExpiryIncidentRuntimeStateSnapshot {
  return {
    capturedAt,
    status: state.status,
    decision: state.lastDecision,
    rawRemainingSeconds: state.rawRemainingSeconds,
    remainingSeconds: state.remainingSeconds,
    candidateObservationCount: state.cycleCandidateObservationCount,
    confirmedExpiresAt: state.confirmedExpiresAt,
    alertAt: state.alertAt,
    alertedAt: state.alertedAt,
    flowSource: state.flowSource,
    locked: state.locked,
  };
}

function getMediaReason(
  input: BoosterExpiryIncidentRuntimeSampleInput,
): BoosterExpiryIncidentMediaReason {
  if (input.runtimeFailure) return "runtime-error";
  if (
    input.stateAfter.confirmedAt !== null &&
    input.stateAfter.confirmedAt !== input.stateBefore.confirmedAt
  ) {
    return "cycle-confirmation";
  }
  if (input.stateAfter.lastDecision === "alerted") return "alert-decision";
  if (input.result && !input.result.rawTime?.ok && !input.result.time?.ok) {
    return "rejected-observation";
  }
  return "periodic";
}

function isRequiredMediaReason(
  reason: BoosterExpiryIncidentMediaReason,
): boolean {
  return (
    reason === "runtime-error" ||
    reason === "cycle-confirmation" ||
    reason === "alert-decision" ||
    reason === "playback-failed"
  );
}

function selectResetReason({
  enabledChanged,
  enabled,
  continuityReason,
  pendingReset,
}: {
  enabledChanged: boolean;
  enabled: boolean;
  continuityReason: Exclude<
    BoosterExpiryIncidentResetReason,
    "initialized"
  > | null;
  pendingReset: PendingReset | null;
}): Exclude<BoosterExpiryIncidentResetReason, "initialized"> | null {
  if (enabledChanged) {
    if (pendingReset?.reason === "global-disabled") return "global-disabled";
    return enabled ? "enabled" : "disabled";
  }
  if (continuityReason && continuityReason !== "profile-replaced") {
    return continuityReason;
  }
  return pendingReset?.reason ?? continuityReason;
}

function cloneFrameSource(
  source: BoosterExpiryIncidentFrameSource,
): BoosterExpiryIncidentFrameSource {
  return {
    ...source,
    sourceDimensions: { ...source.sourceDimensions },
    sampledRegion: { ...source.sampledRegion },
  };
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
