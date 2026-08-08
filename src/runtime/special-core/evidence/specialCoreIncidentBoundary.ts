import {
  SPECIAL_CORE_INCIDENT_BOUNDARY_SCHEMA_VERSION,
  SPECIAL_CORE_INCIDENT_CONFIRM_WINDOW_MS,
  SPECIAL_CORE_INCIDENT_EPISODE_ABSENT_MS,
  SPECIAL_CORE_INCIDENT_REACQUIRE_EARLY_MS,
  SPECIAL_CORE_INCIDENT_REACQUIRE_MIN_AGE_MS,
  createSpecialCoreIncidentActivationId,
  createSpecialCoreIncidentAlertDecisionId,
  createSpecialCoreIncidentConfigurationRevisionId,
  createSpecialCoreIncidentConfirmationAttemptId,
  createSpecialCoreIncidentFrameId,
  createSpecialCoreIncidentObservationId,
  createSpecialCoreIncidentPlaybackAttemptId,
  createSpecialCoreIncidentReportLeaseId,
  createSpecialCoreIncidentResetEpochId,
  createSpecialCoreIncidentScheduleId,
  type SpecialCoreIncidentActivation,
  type SpecialCoreIncidentAlertDecision,
  type SpecialCoreIncidentBoundaryRejectReason,
  type SpecialCoreIncidentBoundaryResult,
  type SpecialCoreIncidentBoundaryState,
  type SpecialCoreIncidentClosedBoundary,
  type SpecialCoreIncidentConfiguration,
  type SpecialCoreIncidentConfigurationRevision,
  type SpecialCoreIncidentConfirmationAttempt,
  type SpecialCoreIncidentConfirmationKind,
  type SpecialCoreIncidentContinuity,
  type SpecialCoreIncidentFrame,
  type SpecialCoreIncidentObservation,
  type SpecialCoreIncidentObservationDecision,
  type SpecialCoreIncidentPlaybackAttempt,
  type SpecialCoreIncidentReportLease,
  type SpecialCoreIncidentResetEpoch,
  type SpecialCoreIncidentResetReason,
  type SpecialCoreIncidentSchedule,
  type SpecialCoreIncidentScheduleReason,
} from "./specialCoreIncidentEvidenceTypes";

export function createSpecialCoreIncidentBoundary({
  sessionId,
  continuity,
  configuration,
  now,
}: {
  sessionId: string;
  continuity: SpecialCoreIncidentContinuity;
  configuration: SpecialCoreIncidentConfiguration;
  now: number;
}): SpecialCoreIncidentBoundaryState {
  const resetEpoch = createResetEpoch({
    sessionId,
    sequence: 1,
    continuity,
    now,
    reason: "initialized",
  });
  const configurationRevision = createConfigurationRevision({
    resetEpochId: resetEpoch.id,
    sequence: 1,
    configuration,
    now,
  });

  return {
    schemaVersion: SPECIAL_CORE_INCIDENT_BOUNDARY_SCHEMA_VERSION,
    sessionId,
    resetSequence: 1,
    configurationSequence: 1,
    frameSequence: 0,
    confirmationSequence: 0,
    activationSequence: 0,
    scheduleSequenceByActivation: {},
    decisionSequenceByActivation: {},
    attemptSequenceByActivation: {},
    leaseSequence: 0,
    resetEpoch,
    configurationRevision,
    latestFrame: null,
    latestObservation: null,
    activeConfirmationAttempt: null,
    activeActivation: null,
    activeSchedule: null,
    latestSchedule: null,
    latestDecision: null,
    activePlaybackAttempt: null,
    latestPlaybackAttempt: null,
  };
}

export function resetSpecialCoreIncidentBoundary({
  previous,
  continuity,
  configuration,
  now,
  reason,
}: {
  previous: SpecialCoreIncidentBoundaryState;
  continuity: SpecialCoreIncidentContinuity;
  configuration: SpecialCoreIncidentConfiguration;
  now: number;
  reason: Exclude<SpecialCoreIncidentResetReason, "initialized">;
}): SpecialCoreIncidentBoundaryResult<{
  resetEpoch: SpecialCoreIncidentResetEpoch;
  configurationRevision: SpecialCoreIncidentConfigurationRevision;
  closed: SpecialCoreIncidentClosedBoundary;
}> {
  const resetSequence = previous.resetSequence + 1;
  const resetEpoch = createResetEpoch({
    sessionId: previous.sessionId,
    sequence: resetSequence,
    continuity,
    now,
    reason,
  });
  const configurationSequence = previous.configurationSequence + 1;
  const configurationRevision = createConfigurationRevision({
    resetEpochId: resetEpoch.id,
    sequence: configurationSequence,
    configuration,
    now,
  });
  const closed = closeActiveBoundary(previous, now, "reset-epoch");

  return accept(
    {
      ...previous,
      resetSequence,
      configurationSequence,
      resetEpoch,
      configurationRevision,
      latestFrame: null,
      latestObservation: null,
      activeConfirmationAttempt: null,
      activeActivation: null,
      activeSchedule: null,
      latestSchedule: null,
      latestDecision: null,
      activePlaybackAttempt: null,
      latestPlaybackAttempt: null,
    },
    { resetEpoch, configurationRevision, closed },
  );
}

export function reviseSpecialCoreIncidentConfiguration({
  previous,
  configuration,
  now,
}: {
  previous: SpecialCoreIncidentBoundaryState;
  configuration: SpecialCoreIncidentConfiguration;
  now: number;
}): SpecialCoreIncidentBoundaryResult<{
  changed: boolean;
  timingChanged: boolean;
  configurationRevision: SpecialCoreIncidentConfigurationRevision;
}> {
  if (configuration.enabled !== previous.configurationRevision.values.enabled) {
    return reject(previous, "continuity-reset-required");
  }

  const fingerprint = fingerprintConfiguration(configuration);
  if (fingerprint === previous.configurationRevision.fingerprint) {
    return accept(previous, {
      changed: false,
      timingChanged: false,
      configurationRevision: previous.configurationRevision,
    });
  }

  const sequence = previous.configurationSequence + 1;
  const configurationRevision = createConfigurationRevision({
    resetEpochId: previous.resetEpoch.id,
    sequence,
    configuration,
    now,
  });
  return accept(
    {
      ...previous,
      configurationSequence: sequence,
      configurationRevision,
    },
    {
      changed: true,
      timingChanged:
        configurationRevision.timingFingerprint !==
        previous.configurationRevision.timingFingerprint,
      configurationRevision,
    },
  );
}

export function recordSpecialCoreIncidentFrame({
  previous,
  sampledAt,
}: {
  previous: SpecialCoreIncidentBoundaryState;
  sampledAt: number;
}): SpecialCoreIncidentBoundaryResult<SpecialCoreIncidentFrame> {
  if (!previous.configurationRevision.values.enabled) {
    return reject(previous, "feature-disabled");
  }

  const sequence = previous.frameSequence + 1;
  const continuity = previous.resetEpoch.continuity;
  const frame: SpecialCoreIncidentFrame = {
    id: createSpecialCoreIncidentFrameId(previous.resetEpoch.id, sequence),
    resetEpochId: previous.resetEpoch.id,
    configRevisionId: previous.configurationRevision.id,
    sequence,
    sampledAt,
    layoutKey: continuity.layoutKey,
    sourceGeometryRevision: continuity.sourceGeometryRevision,
    source: null,
    parser: null,
    parsedBoxes: [],
    rowGroups: [],
    eligibleBoxIndexes: [],
    timings: null,
    runtimeFailure: null,
    mediaFrameId: null,
  };
  return accept(
    {
      ...previous,
      frameSequence: sequence,
      latestFrame: frame,
      latestObservation: null,
    },
    frame,
  );
}

export function recordSpecialCoreIncidentObservation({
  previous,
  frame,
  decision,
  reason = null,
}: {
  previous: SpecialCoreIncidentBoundaryState;
  frame: SpecialCoreIncidentFrame;
  decision: SpecialCoreIncidentObservationDecision;
  reason?: string | null;
}): SpecialCoreIncidentBoundaryResult<SpecialCoreIncidentObservation> {
  if (frame.resetEpochId !== previous.resetEpoch.id) {
    return reject(previous, "stale-reset-epoch");
  }
  if (previous.latestFrame?.id !== frame.id) {
    return reject(previous, "stale-frame");
  }

  const observation: SpecialCoreIncidentObservation = {
    id: createSpecialCoreIncidentObservationId(frame.id),
    resetEpochId: frame.resetEpochId,
    frameId: frame.id,
    frameSequence: frame.sequence,
    configRevisionId: frame.configRevisionId,
    sampledAt: frame.sampledAt,
    decision,
    reason,
    candidates: [],
    selectedCandidateBoxIndex: null,
    stateBefore: null,
    stateAfter: null,
  };
  return accept({ ...previous, latestObservation: observation }, observation);
}

export function collectSpecialCoreIncidentConfirmation({
  previous,
  frame,
  observation,
  kind,
}: {
  previous: SpecialCoreIncidentBoundaryState;
  frame: SpecialCoreIncidentFrame;
  observation: SpecialCoreIncidentObservation;
  kind: SpecialCoreIncidentConfirmationKind;
}): SpecialCoreIncidentBoundaryResult<{
  attempt: SpecialCoreIncidentConfirmationAttempt;
  activation: SpecialCoreIncidentActivation | null;
  expiredAttempt: SpecialCoreIncidentConfirmationAttempt | null;
  closed: SpecialCoreIncidentClosedBoundary | null;
}> {
  const invalid = validateCurrentObservation(previous, frame, observation);
  if (invalid) {
    return reject(previous, invalid);
  }
  if (observation.decision !== "accepted") {
    return reject(previous, "observation-not-accepted");
  }

  let state = previous;
  let attempt = previous.activeConfirmationAttempt;
  let expiredAttempt: SpecialCoreIncidentConfirmationAttempt | null = null;
  if (attempt) {
    if (attempt.kind !== kind) {
      return reject(previous, "confirmation-kind-mismatch");
    }
    if (attempt.observationIds.includes(observation.id)) {
      return reject(previous, "duplicate-confirmation-observation");
    }
    if (
      observation.sampledAt - attempt.startedAt >
      SPECIAL_CORE_INCIDENT_CONFIRM_WINDOW_MS
    ) {
      expiredAttempt = {
        ...attempt,
        status: "expired",
        endedAt: observation.sampledAt,
        terminalReason: "window-expired",
      };
      attempt = null;
      state = { ...state, activeConfirmationAttempt: null };
    }
  }

  if (!attempt) {
    const kindError = validateConfirmationKind(
      state,
      kind,
      observation.sampledAt,
    );
    if (kindError) {
      return reject(previous, kindError);
    }
    const sequence = state.confirmationSequence + 1;
    attempt = {
      id: createSpecialCoreIncidentConfirmationAttemptId(
        state.resetEpoch.id,
        sequence,
      ),
      resetEpochId: state.resetEpoch.id,
      sequence,
      kind,
      startedAt: observation.sampledAt,
      lastObservedAt: observation.sampledAt,
      observationIds: [observation.id],
      status: "collecting",
      activationId: null,
      endedAt: null,
      terminalReason: null,
    };
    return accept(
      {
        ...state,
        confirmationSequence: sequence,
        activeConfirmationAttempt: attempt,
      },
      { attempt, activation: null, expiredAttempt, closed: null },
    );
  }

  const confirmationAttempt: SpecialCoreIncidentConfirmationAttempt = {
    ...attempt,
    lastObservedAt: observation.sampledAt,
    observationIds: [...attempt.observationIds, observation.id],
  };
  const activationSequence = state.activationSequence + 1;
  const activationId = createSpecialCoreIncidentActivationId(
    state.resetEpoch.id,
    activationSequence,
  );
  const configuration = state.configurationRevision.values;
  const startedAt = confirmationAttempt.startedAt;
  const cooldownEndsAt = startedAt + configuration.cooldownSeconds * 1_000;
  const alertDueAt = cooldownEndsAt - configuration.alertLeadSeconds * 1_000;
  const activation: SpecialCoreIncidentActivation = {
    id: activationId,
    resetEpochId: state.resetEpoch.id,
    sequence: activationSequence,
    runtimeActivationId: null,
    confirmationAttemptId: confirmationAttempt.id,
    confirmationKind: kind,
    observationIds: confirmationAttempt.observationIds,
    startedAt,
    confirmedAt: observation.sampledAt,
    lastSeenAt: observation.sampledAt,
    timingConfigRevisionId: state.configurationRevision.id,
    cooldownEndsAt,
    alertDueAt,
    status: "active",
    endedAt: null,
    terminalReason: null,
  };
  const confirmedAttempt: SpecialCoreIncidentConfirmationAttempt = {
    ...confirmationAttempt,
    status: "confirmed",
    activationId,
    endedAt: observation.sampledAt,
    terminalReason: "confirmed",
  };
  const closed = closeActiveBoundary(
    { ...state, activeConfirmationAttempt: null },
    observation.sampledAt,
    kind === "cooldown-reacquire" ? "cooldown-reacquired" : "next-activation",
  );

  return accept(
    {
      ...state,
      activationSequence,
      activeConfirmationAttempt: null,
      activeActivation: activation,
      activeSchedule: null,
      latestSchedule: null,
      latestDecision: null,
      activePlaybackAttempt: null,
    },
    { attempt: confirmedAttempt, activation, expiredAttempt, closed },
  );
}

export function recordSpecialCoreIncidentActivationSighting({
  previous,
  frame,
  observation,
}: {
  previous: SpecialCoreIncidentBoundaryState;
  frame: SpecialCoreIncidentFrame;
  observation: SpecialCoreIncidentObservation;
}): SpecialCoreIncidentBoundaryResult<SpecialCoreIncidentActivation> {
  const invalid = validateCurrentObservation(previous, frame, observation);
  if (invalid) {
    return reject(previous, invalid);
  }
  if (observation.decision !== "accepted") {
    return reject(previous, "observation-not-accepted");
  }
  const activation = previous.activeActivation;
  if (!activation) {
    return reject(previous, "no-active-activation");
  }

  const nextActivation = {
    ...activation,
    lastSeenAt: Math.max(activation.lastSeenAt, observation.sampledAt),
  };
  return accept({ ...previous, activeActivation: nextActivation }, nextActivation);
}

export function registerSpecialCoreIncidentSchedule({
  previous,
  activation,
  registeredAt,
  reason,
}: {
  previous: SpecialCoreIncidentBoundaryState;
  activation: SpecialCoreIncidentActivation;
  registeredAt: number;
  reason: SpecialCoreIncidentScheduleReason;
}): SpecialCoreIncidentBoundaryResult<{
  schedule: SpecialCoreIncidentSchedule;
  replacedSchedule: SpecialCoreIncidentSchedule | null;
  activation: SpecialCoreIncidentActivation;
}> {
  if (
    activation.resetEpochId !== previous.resetEpoch.id ||
    previous.activeActivation?.id !== activation.id
  ) {
    return reject(previous, "stale-activation");
  }

  const configuration = previous.configurationRevision.values;
  const alertDueAt =
    activation.startedAt +
    (configuration.cooldownSeconds - configuration.alertLeadSeconds) * 1_000;
  const activeSchedule = previous.activeSchedule;
  if (
    activeSchedule?.activationId === activation.id &&
    activeSchedule.alertDueAt === alertDueAt &&
    activeSchedule.timingConfigRevisionId === previous.configurationRevision.id &&
    reason !== "browser-rescheduled"
  ) {
    return reject(previous, "schedule-already-registered");
  }

  const replacedSchedule = activeSchedule
    ? {
        ...activeSchedule,
        status: "replaced" as const,
        endedAt: registeredAt,
        outcomeReason: reason,
      }
    : null;
  const sequence =
    (previous.scheduleSequenceByActivation[activation.id] ?? 0) + 1;
  const schedule: SpecialCoreIncidentSchedule = {
    id: createSpecialCoreIncidentScheduleId(activation.id, sequence),
    resetEpochId: previous.resetEpoch.id,
    activationId: activation.id,
    sequence,
    reason,
    registeredAt,
    alertDueAt,
    timingConfigRevisionId: previous.configurationRevision.id,
    status: "registered",
    endedAt: null,
    outcomeReason: null,
  };
  const nextActivation: SpecialCoreIncidentActivation = {
    ...activation,
    timingConfigRevisionId: previous.configurationRevision.id,
    cooldownEndsAt:
      activation.startedAt + configuration.cooldownSeconds * 1_000,
    alertDueAt,
  };
  return accept(
    {
      ...previous,
      scheduleSequenceByActivation: {
        ...previous.scheduleSequenceByActivation,
        [activation.id]: sequence,
      },
      activeActivation: nextActivation,
      activeSchedule: schedule,
      latestSchedule: schedule,
      latestDecision: null,
    },
    { schedule, replacedSchedule, activation: nextActivation },
  );
}

export function completeSpecialCoreIncidentSchedule({
  previous,
  scheduleId,
  outcome,
  occurredAt,
  reason = null,
}: {
  previous: SpecialCoreIncidentBoundaryState;
  scheduleId: string;
  outcome: "cancelled" | "suppressed" | "fired";
  occurredAt: number;
  reason?: string | null;
}): SpecialCoreIncidentBoundaryResult<{
  schedule: SpecialCoreIncidentSchedule;
  decision: SpecialCoreIncidentAlertDecision | null;
}> {
  const schedule = previous.activeSchedule;
  if (!schedule || schedule.id !== scheduleId) {
    return reject(previous, "stale-schedule");
  }
  if (previous.activeActivation?.id !== schedule.activationId) {
    return reject(previous, "stale-activation");
  }

  if (outcome === "fired") {
    const configuration = previous.configurationRevision.values;
    const currentDueAt =
      previous.activeActivation.startedAt +
      (configuration.cooldownSeconds - configuration.alertLeadSeconds) * 1_000;
    if (currentDueAt !== schedule.alertDueAt) {
      return reject(previous, "schedule-timing-revised");
    }
    if (occurredAt < schedule.alertDueAt) {
      return reject(previous, "schedule-not-due");
    }
  }

  const completedSchedule: SpecialCoreIncidentSchedule = {
    ...schedule,
    status: outcome,
    endedAt: occurredAt,
    outcomeReason: reason,
  };
  if (outcome !== "fired") {
    return accept(
      {
        ...previous,
        activeSchedule: null,
        latestSchedule: completedSchedule,
      },
      { schedule: completedSchedule, decision: null },
    );
  }

  const sequence =
    (previous.decisionSequenceByActivation[schedule.activationId] ?? 0) + 1;
  const decision: SpecialCoreIncidentAlertDecision = {
    id: createSpecialCoreIncidentAlertDecisionId(
      schedule.activationId,
      sequence,
    ),
    resetEpochId: previous.resetEpoch.id,
    activationId: schedule.activationId,
    scheduleId: schedule.id,
    sequence,
    occurredAt,
    dueAt: schedule.alertDueAt,
    schedulerDelayMs: occurredAt - schedule.alertDueAt,
    timingConfigRevisionId: schedule.timingConfigRevisionId,
    firedConfigRevisionId: previous.configurationRevision.id,
  };
  return accept(
    {
      ...previous,
      decisionSequenceByActivation: {
        ...previous.decisionSequenceByActivation,
        [schedule.activationId]: sequence,
      },
      activeSchedule: null,
      latestSchedule: completedSchedule,
      latestDecision: decision,
    },
    { schedule: completedSchedule, decision },
  );
}

export function requestSpecialCoreIncidentPlayback({
  previous,
  decision,
  requestedAt,
  startOffsetSeconds,
}: {
  previous: SpecialCoreIncidentBoundaryState;
  decision: SpecialCoreIncidentAlertDecision;
  requestedAt: number;
  startOffsetSeconds: number;
}): SpecialCoreIncidentBoundaryResult<SpecialCoreIncidentPlaybackAttempt> {
  if (
    decision.resetEpochId !== previous.resetEpoch.id ||
    previous.latestDecision?.id !== decision.id
  ) {
    return reject(previous, "stale-alert-decision");
  }
  if (previous.activeActivation?.id !== decision.activationId) {
    return reject(previous, "stale-activation");
  }
  if (previous.activePlaybackAttempt) {
    return reject(previous, "playback-in-flight");
  }
  if (previous.latestPlaybackAttempt?.decisionId === decision.id) {
    return reject(previous, "decision-playback-already-requested");
  }

  const sequence =
    (previous.attemptSequenceByActivation[decision.activationId] ?? 0) + 1;
  const configuration = previous.configurationRevision.values;
  const attempt: SpecialCoreIncidentPlaybackAttempt = {
    id: createSpecialCoreIncidentPlaybackAttemptId(
      decision.activationId,
      sequence,
    ),
    resetEpochId: previous.resetEpoch.id,
    activationId: decision.activationId,
    scheduleId: decision.scheduleId,
    decisionId: decision.id,
    sequence,
    requestedAt,
    browserAcceptedAt: null,
    finishedAt: null,
    failedAt: null,
    status: "requested",
    error: null,
    configRevisionId: previous.configurationRevision.id,
    soundId: configuration.soundId,
    featureVolume: configuration.featureVolume,
    masterVolume: configuration.masterVolume,
    effectiveVolume: configuration.effectiveVolume,
    startOffsetSeconds,
  };
  return accept(
    {
      ...previous,
      attemptSequenceByActivation: {
        ...previous.attemptSequenceByActivation,
        [decision.activationId]: sequence,
      },
      activePlaybackAttempt: attempt,
      latestPlaybackAttempt: attempt,
    },
    attempt,
  );
}

export function transitionSpecialCoreIncidentPlayback({
  previous,
  attemptId,
  status,
  occurredAt,
  error = null,
}: {
  previous: SpecialCoreIncidentBoundaryState;
  attemptId: string;
  status: "browser-play-accepted" | "finished" | "failed";
  occurredAt: number;
  error?: string | null;
}): SpecialCoreIncidentBoundaryResult<SpecialCoreIncidentPlaybackAttempt> {
  const attempt = previous.activePlaybackAttempt;
  if (!attempt || attempt.id !== attemptId) {
    return reject(previous, "stale-playback-attempt");
  }
  if (!isValidPlaybackTransition(attempt.status, status)) {
    return reject(previous, "invalid-playback-transition");
  }

  const nextAttempt: SpecialCoreIncidentPlaybackAttempt = {
    ...attempt,
    status,
    browserAcceptedAt:
      status === "browser-play-accepted"
        ? occurredAt
        : attempt.browserAcceptedAt,
    finishedAt: status === "finished" ? occurredAt : attempt.finishedAt,
    failedAt: status === "failed" ? occurredAt : attempt.failedAt,
    error: status === "failed" ? error : attempt.error,
  };
  const terminal = status === "finished" || status === "failed";
  return accept(
    {
      ...previous,
      activePlaybackAttempt: terminal ? null : nextAttempt,
      latestPlaybackAttempt: nextAttempt,
    },
    nextAttempt,
  );
}

export function freezeSpecialCoreIncidentBoundary({
  previous,
  frozenAt,
}: {
  previous: SpecialCoreIncidentBoundaryState;
  frozenAt: number;
}): {
  state: SpecialCoreIncidentBoundaryState;
  lease: SpecialCoreIncidentReportLease;
} {
  const sequence = previous.leaseSequence + 1;
  const continuity = previous.resetEpoch.continuity;
  const activationId = previous.activeActivation?.id ?? null;
  const scheduleId =
    previous.latestSchedule?.activationId === activationId
      ? previous.latestSchedule.id
      : null;
  const decisionId =
    previous.latestDecision?.activationId === activationId
      ? previous.latestDecision.id
      : null;
  const playbackAttemptId =
    previous.latestPlaybackAttempt?.activationId === activationId
      ? previous.latestPlaybackAttempt.id
      : null;
  const lease: SpecialCoreIncidentReportLease = {
    id: createSpecialCoreIncidentReportLeaseId(previous.sessionId, sequence),
    resetEpochId: previous.resetEpoch.id,
    configRevisionId: previous.configurationRevision.id,
    sequence,
    frozenAt,
    leasedThroughFrameSequence: previous.frameSequence,
    layoutKey: continuity.layoutKey,
    sourceGeometryRevision: continuity.sourceGeometryRevision,
    confirmationAttemptId: previous.activeConfirmationAttempt?.id ?? null,
    activationId,
    scheduleId,
    decisionId,
    playbackAttemptId,
  };
  return {
    state: { ...previous, leaseSequence: sequence },
    lease,
  };
}

export function isSpecialCoreIncidentFrameWithinLease(
  lease: SpecialCoreIncidentReportLease,
  frame: SpecialCoreIncidentFrame,
): boolean {
  return (
    frame.resetEpochId === lease.resetEpochId &&
    frame.sequence <= lease.leasedThroughFrameSequence &&
    frame.sampledAt <= lease.frozenAt &&
    frame.layoutKey === lease.layoutKey &&
    frame.sourceGeometryRevision === lease.sourceGeometryRevision
  );
}

export function getSpecialCoreIncidentContinuityResetReason(
  previous: SpecialCoreIncidentContinuity,
  next: SpecialCoreIncidentContinuity,
): Exclude<SpecialCoreIncidentResetReason, "initialized"> | null {
  if (previous.captureGeneration !== next.captureGeneration) {
    return "stream-replaced";
  }
  if (previous.layoutKey !== next.layoutKey) {
    return "layout-changed";
  }
  if (previous.sourceGeometryRevision !== next.sourceGeometryRevision) {
    return "source-geometry-changed";
  }
  if (previous.parserRuntimeGeneration !== next.parserRuntimeGeneration) {
    return "parser-runtime-changed";
  }
  if (previous.matcherWorkerGeneration !== next.matcherWorkerGeneration) {
    return "matcher-worker-reset";
  }
  if (previous.featureGeneration !== next.featureGeneration) {
    return "profile-replaced";
  }
  return null;
}

function validateCurrentObservation(
  state: SpecialCoreIncidentBoundaryState,
  frame: SpecialCoreIncidentFrame,
  observation: SpecialCoreIncidentObservation,
): SpecialCoreIncidentBoundaryRejectReason | null {
  if (
    frame.resetEpochId !== state.resetEpoch.id ||
    observation.resetEpochId !== state.resetEpoch.id
  ) {
    return "stale-reset-epoch";
  }
  if (state.latestFrame?.id !== frame.id) {
    return "stale-frame";
  }
  if (
    observation.frameId !== frame.id ||
    state.latestObservation?.id !== observation.id
  ) {
    return "observation-frame-mismatch";
  }
  return null;
}

function validateConfirmationKind(
  state: SpecialCoreIncidentBoundaryState,
  kind: SpecialCoreIncidentConfirmationKind,
  observedAt: number,
): SpecialCoreIncidentBoundaryRejectReason | null {
  const activation = state.activeActivation;
  if (!activation) {
    return kind === "new-activation" ? null : "no-active-activation";
  }
  if (kind === "new-activation") {
    return observedAt >= activation.cooldownEndsAt
      ? null
      : "active-activation-exists";
  }
  if (
    observedAt >= activation.cooldownEndsAt ||
    observedAt < activation.cooldownEndsAt - SPECIAL_CORE_INCIDENT_REACQUIRE_EARLY_MS ||
    observedAt - activation.startedAt < SPECIAL_CORE_INCIDENT_REACQUIRE_MIN_AGE_MS ||
    observedAt - activation.lastSeenAt <= SPECIAL_CORE_INCIDENT_EPISODE_ABSENT_MS
  ) {
    return "cooldown-reacquire-not-eligible";
  }
  return null;
}

function closeActiveBoundary(
  state: SpecialCoreIncidentBoundaryState,
  occurredAt: number,
  reason:
    | "reset-epoch"
    | "next-activation"
    | "cooldown-reacquired",
): SpecialCoreIncidentClosedBoundary {
  const confirmationAttempt = state.activeConfirmationAttempt
    ? {
        ...state.activeConfirmationAttempt,
        status: "terminal" as const,
        endedAt: occurredAt,
        terminalReason:
          reason === "reset-epoch"
            ? ("reset-epoch" as const)
            : ("activation-replaced" as const),
      }
    : null;
  const activation = state.activeActivation
    ? {
        ...state.activeActivation,
        status: "terminal" as const,
        endedAt: occurredAt,
        terminalReason: reason,
      }
    : null;
  const schedule = state.activeSchedule
    ? {
        ...state.activeSchedule,
        status: "cancelled" as const,
        endedAt: occurredAt,
        outcomeReason: reason,
      }
    : null;
  return {
    confirmationAttempt,
    activation,
    schedule,
    playbackAttempt: state.activePlaybackAttempt,
  };
}

function createResetEpoch({
  sessionId,
  sequence,
  continuity,
  now,
  reason,
}: {
  sessionId: string;
  sequence: number;
  continuity: SpecialCoreIncidentContinuity;
  now: number;
  reason: SpecialCoreIncidentResetReason;
}): SpecialCoreIncidentResetEpoch {
  return {
    id: createSpecialCoreIncidentResetEpochId(sessionId, sequence),
    sessionId,
    sequence,
    startedAt: now,
    reason,
    continuity: { ...continuity },
  };
}

function createConfigurationRevision({
  resetEpochId,
  sequence,
  configuration,
  now,
}: {
  resetEpochId: string;
  sequence: number;
  configuration: SpecialCoreIncidentConfiguration;
  now: number;
}): SpecialCoreIncidentConfigurationRevision {
  return {
    id: createSpecialCoreIncidentConfigurationRevisionId(
      resetEpochId,
      sequence,
    ),
    resetEpochId,
    sequence,
    capturedAt: now,
    fingerprint: fingerprintConfiguration(configuration),
    timingFingerprint: fingerprintTiming(configuration),
    values: { ...configuration },
  };
}

function fingerprintConfiguration(
  configuration: SpecialCoreIncidentConfiguration,
): string {
  return JSON.stringify([
    configuration.enabled,
    configuration.cooldownSeconds,
    configuration.alertLeadSeconds,
    configuration.soundId,
    configuration.featureVolume,
    configuration.masterVolume,
    configuration.effectiveVolume,
  ]);
}

function fingerprintTiming(
  configuration: SpecialCoreIncidentConfiguration,
): string {
  return JSON.stringify([
    configuration.cooldownSeconds,
    configuration.alertLeadSeconds,
  ]);
}

function isValidPlaybackTransition(
  previous: SpecialCoreIncidentPlaybackAttempt["status"],
  next: "browser-play-accepted" | "finished" | "failed",
): boolean {
  if (previous === "requested") {
    return next === "browser-play-accepted" || next === "failed";
  }
  if (previous === "browser-play-accepted") {
    return next === "finished" || next === "failed";
  }
  return false;
}

function accept<T>(
  state: SpecialCoreIncidentBoundaryState,
  value: T,
): SpecialCoreIncidentBoundaryResult<T> {
  return { accepted: true, state, value };
}

function reject<T>(
  state: SpecialCoreIncidentBoundaryState,
  reason: SpecialCoreIncidentBoundaryRejectReason,
): SpecialCoreIncidentBoundaryResult<T> {
  return { accepted: false, state, reason };
}
