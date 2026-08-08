import {
  BOOSTER_EXPIRY_INCIDENT_BOUNDARY_SCHEMA_VERSION,
  BOOSTER_EXPIRY_INCIDENT_CONFIRMATION_DECREASE_SECONDS,
  BOOSTER_EXPIRY_INCIDENT_CONFIRMATION_OBSERVATIONS,
  BOOSTER_EXPIRY_INCIDENT_CONFIRMATION_SPAN_MS,
  BOOSTER_EXPIRY_INCIDENT_CONTRADICTION_LIMIT,
  BOOSTER_EXPIRY_INCIDENT_CONTRADICTION_TOLERANCE_MS,
  BOOSTER_EXPIRY_INCIDENT_EXPIRES_SPREAD_MS,
  BOOSTER_EXPIRY_INCIDENT_EXPIRES_TOLERANCE_MS,
  BOOSTER_EXPIRY_INCIDENT_MAX_OBSERVATION_GAP_MS,
  BOOSTER_EXPIRY_INCIDENT_MAX_UNSUPPORTED_MS,
  BOOSTER_EXPIRY_INCIDENT_MIN_REMAINING_SECONDS,
  BOOSTER_EXPIRY_INCIDENT_NEW_CYCLE_EXTENSION_MS,
  BOOSTER_EXPIRY_INCIDENT_SUPPORT_TOLERANCE_MS,
  createBoosterExpiryIncidentAlertDecisionId,
  createBoosterExpiryIncidentCandidateAttemptId,
  createBoosterExpiryIncidentConfigurationRevisionId,
  createBoosterExpiryIncidentCycleId,
  createBoosterExpiryIncidentFlowEpochId,
  createBoosterExpiryIncidentFrameId,
  createBoosterExpiryIncidentObservationId,
  createBoosterExpiryIncidentPlaybackAttemptId,
  createBoosterExpiryIncidentReportLeaseId,
  createBoosterExpiryIncidentResetEpochId,
  createBoosterExpiryIncidentScheduleId,
  type BoosterExpiryIncidentAlertDecision,
  type BoosterExpiryIncidentBoundaryRejectReason,
  type BoosterExpiryIncidentBoundaryResult,
  type BoosterExpiryIncidentBoundaryState,
  type BoosterExpiryIncidentCandidateAttempt,
  type BoosterExpiryIncidentClosedBoundary,
  type BoosterExpiryIncidentConfiguration,
  type BoosterExpiryIncidentConfigurationRevision,
  type BoosterExpiryIncidentConfirmedCycle,
  type BoosterExpiryIncidentContinuity,
  type BoosterExpiryIncidentFlowEpoch,
  type BoosterExpiryIncidentFlowRestartReason,
  type BoosterExpiryIncidentFlowSnapshot,
  type BoosterExpiryIncidentFrame,
  type BoosterExpiryIncidentObservation,
  type BoosterExpiryIncidentObservationDecision,
  type BoosterExpiryIncidentPlaybackAttempt,
  type BoosterExpiryIncidentRegion,
  type BoosterExpiryIncidentReportLease,
  type BoosterExpiryIncidentResetEpoch,
  type BoosterExpiryIncidentResetReason,
  type BoosterExpiryIncidentRuntimeStateSnapshot,
  type BoosterExpiryIncidentSchedule,
  type BoosterExpiryIncidentScheduleReason,
  type BoosterExpiryIncidentTimerRead,
} from "./boosterExpiryIncidentEvidenceTypes";

export function createBoosterExpiryIncidentBoundary({
  sessionId,
  continuity,
  configuration,
  workerGeneration,
  now,
}: {
  sessionId: string;
  continuity: BoosterExpiryIncidentContinuity;
  configuration: BoosterExpiryIncidentConfiguration;
  workerGeneration: number;
  now: number;
}): BoosterExpiryIncidentBoundaryState {
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
  const flowEpoch = createFlowEpoch({
    resetEpochId: resetEpoch.id,
    sequence: 1,
    workerGeneration,
    now,
    reason: "initialized",
  });

  return {
    schemaVersion: BOOSTER_EXPIRY_INCIDENT_BOUNDARY_SCHEMA_VERSION,
    sessionId,
    resetSequence: 1,
    configurationSequence: 1,
    flowSequence: 1,
    frameSequence: 0,
    candidateSequence: 0,
    cycleSequence: 0,
    scheduleSequenceByCycle: {},
    decisionSequenceByCycle: {},
    playbackSequenceByCycle: {},
    leaseSequence: 0,
    resetEpoch,
    configurationRevision,
    flowEpoch,
    latestFrame: null,
    latestObservation: null,
    activeCandidateAttempt: null,
    activeCycle: null,
    activeSchedule: null,
    latestSchedule: null,
    latestDecision: null,
    activePlaybackAttempt: null,
    latestPlaybackAttempt: null,
  };
}

export function resetBoosterExpiryIncidentBoundary({
  previous,
  continuity,
  configuration,
  workerGeneration,
  now,
  reason,
}: {
  previous: BoosterExpiryIncidentBoundaryState;
  continuity: BoosterExpiryIncidentContinuity;
  configuration: BoosterExpiryIncidentConfiguration;
  workerGeneration: number;
  now: number;
  reason: Exclude<BoosterExpiryIncidentResetReason, "initialized">;
}): BoosterExpiryIncidentBoundaryResult<{
  resetEpoch: BoosterExpiryIncidentResetEpoch;
  configurationRevision: BoosterExpiryIncidentConfigurationRevision;
  flowEpoch: BoosterExpiryIncidentFlowEpoch;
  closed: BoosterExpiryIncidentClosedBoundary;
}> {
  const resetSequence = previous.resetSequence + 1;
  const configurationSequence = previous.configurationSequence + 1;
  const flowSequence = previous.flowSequence + 1;
  const resetEpoch = createResetEpoch({
    sessionId: previous.sessionId,
    sequence: resetSequence,
    continuity,
    now,
    reason,
  });
  const configurationRevision = createConfigurationRevision({
    resetEpochId: resetEpoch.id,
    sequence: configurationSequence,
    configuration,
    now,
  });
  const flowEpoch = createFlowEpoch({
    resetEpochId: resetEpoch.id,
    sequence: flowSequence,
    workerGeneration,
    now,
    reason: "worker-reset",
  });
  const closed = closeBoundary(previous, now, "reset-epoch");

  return accept(
    {
      ...previous,
      resetSequence,
      configurationSequence,
      flowSequence,
      resetEpoch,
      configurationRevision,
      flowEpoch,
      latestFrame: null,
      latestObservation: null,
      activeCandidateAttempt: null,
      activeCycle: null,
      activeSchedule: null,
      latestSchedule: null,
      latestDecision: null,
      activePlaybackAttempt: null,
      latestPlaybackAttempt: null,
    },
    { resetEpoch, configurationRevision, flowEpoch, closed },
  );
}

export function restartBoosterExpiryIncidentFlow({
  previous,
  workerGeneration,
  now,
  reason,
}: {
  previous: BoosterExpiryIncidentBoundaryState;
  workerGeneration: number;
  now: number;
  reason: Exclude<BoosterExpiryIncidentFlowRestartReason, "initialized">;
}): BoosterExpiryIncidentBoundaryResult<{
  flowEpoch: BoosterExpiryIncidentFlowEpoch;
  closedCandidate: BoosterExpiryIncidentCandidateAttempt | null;
}> {
  const sequence = previous.flowSequence + 1;
  const flowEpoch = createFlowEpoch({
    resetEpochId: previous.resetEpoch.id,
    sequence,
    workerGeneration,
    now,
    reason,
  });
  const closedCandidate = previous.activeCandidateAttempt
    ? {
        ...previous.activeCandidateAttempt,
        status: "terminal" as const,
        endedAt: now,
        terminalReason: "flow-restarted" as const,
      }
    : null;

  return accept(
    {
      ...previous,
      flowSequence: sequence,
      flowEpoch,
      latestFrame: null,
      latestObservation: null,
      activeCandidateAttempt: null,
    },
    { flowEpoch, closedCandidate },
  );
}

export function reviseBoosterExpiryIncidentConfiguration({
  previous,
  configuration,
  now,
}: {
  previous: BoosterExpiryIncidentBoundaryState;
  configuration: BoosterExpiryIncidentConfiguration;
  now: number;
}): BoosterExpiryIncidentBoundaryResult<{
  changed: boolean;
  timingChanged: boolean;
  playbackChanged: boolean;
  configurationRevision: BoosterExpiryIncidentConfigurationRevision;
}> {
  if (configuration.enabled !== previous.configurationRevision.values.enabled) {
    return reject(previous, "continuity-reset-required");
  }
  const fingerprint = fingerprintConfiguration(configuration);
  if (fingerprint === previous.configurationRevision.fingerprint) {
    return accept(previous, {
      changed: false,
      timingChanged: false,
      playbackChanged: false,
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
      playbackChanged:
        configurationRevision.playbackFingerprint !==
        previous.configurationRevision.playbackFingerprint,
      configurationRevision,
    },
  );
}

export function recordBoosterExpiryIncidentFrame({
  previous,
  sampledAt,
}: {
  previous: BoosterExpiryIncidentBoundaryState;
  sampledAt: number;
}): BoosterExpiryIncidentBoundaryResult<BoosterExpiryIncidentFrame> {
  if (!previous.configurationRevision.values.enabled) {
    return reject(previous, "feature-disabled");
  }
  if (
    previous.latestFrame &&
    sampledAt <= previous.latestFrame.sampledAt
  ) {
    return reject(previous, "non-monotonic-frame");
  }
  const sequence = previous.frameSequence + 1;
  const continuity = previous.resetEpoch.continuity;
  const frame: BoosterExpiryIncidentFrame = {
    id: createBoosterExpiryIncidentFrameId(previous.resetEpoch.id, sequence),
    resetEpochId: previous.resetEpoch.id,
    flowEpochId: previous.flowEpoch.id,
    configRevisionId: previous.configurationRevision.id,
    sequence,
    sampledAt,
    layoutKey: continuity.layoutKey,
    sourceGeometryRevision: continuity.sourceGeometryRevision,
    source: null,
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

export function recordBoosterExpiryIncidentObservation({
  previous,
  frame,
  decision,
  reason = null,
  recognizerVersion = null,
  rawTime = null,
  selectedTime = null,
  timerRect = null,
  timerCandidateCount = 0,
  timerMatchCount = 0,
  flow = null,
  recognitionMs = null,
  totalMs = null,
  stateBefore = null,
  stateAfter = null,
}: {
  previous: BoosterExpiryIncidentBoundaryState;
  frame: BoosterExpiryIncidentFrame;
  decision: BoosterExpiryIncidentObservationDecision;
  reason?: string | null;
  recognizerVersion?: string | null;
  rawTime?: BoosterExpiryIncidentTimerRead | null;
  selectedTime?: BoosterExpiryIncidentTimerRead | null;
  timerRect?: BoosterExpiryIncidentRegion | null;
  timerCandidateCount?: number;
  timerMatchCount?: number;
  flow?: BoosterExpiryIncidentFlowSnapshot | null;
  recognitionMs?: number | null;
  totalMs?: number | null;
  stateBefore?: BoosterExpiryIncidentRuntimeStateSnapshot | null;
  stateAfter?: BoosterExpiryIncidentRuntimeStateSnapshot | null;
}): BoosterExpiryIncidentBoundaryResult<BoosterExpiryIncidentObservation> {
  if (frame.resetEpochId !== previous.resetEpoch.id) {
    return reject(previous, "stale-reset-epoch");
  }
  if (frame.flowEpochId !== previous.flowEpoch.id) {
    return reject(previous, "stale-flow-epoch");
  }
  if (previous.latestFrame?.id !== frame.id) {
    return reject(previous, "stale-frame");
  }

  const rawSeconds = rawTime?.ok ? rawTime.seconds : null;
  const strongForConfirmation = Boolean(
    decision === "accepted" &&
      rawSeconds !== null &&
      isStrongFlowSource(flow?.source ?? null),
  );
  const observation: BoosterExpiryIncidentObservation = {
    id: createBoosterExpiryIncidentObservationId(frame.id),
    resetEpochId: frame.resetEpochId,
    flowEpochId: frame.flowEpochId,
    frameId: frame.id,
    frameSequence: frame.sequence,
    configRevisionId: frame.configRevisionId,
    sampledAt: frame.sampledAt,
    decision,
    reason,
    recognizerVersion,
    rawTime,
    selectedTime,
    timerRect,
    timerCandidateCount,
    timerMatchCount,
    flow,
    strongForConfirmation,
    observedExpiresAt:
      strongForConfirmation && rawSeconds !== null
        ? frame.sampledAt + rawSeconds * 1_000
        : null,
    recognitionMs,
    totalMs,
    stateBefore,
    stateAfter,
  };
  return accept({ ...previous, latestObservation: observation }, observation);
}

export function collectBoosterExpiryIncidentCycleObservation({
  previous,
  frame,
  observation,
}: {
  previous: BoosterExpiryIncidentBoundaryState;
  frame: BoosterExpiryIncidentFrame;
  observation: BoosterExpiryIncidentObservation;
}): BoosterExpiryIncidentBoundaryResult<{
  attempt: BoosterExpiryIncidentCandidateAttempt;
  cycle: BoosterExpiryIncidentConfirmedCycle | null;
  expiredAttempt: BoosterExpiryIncidentCandidateAttempt | null;
  closed: BoosterExpiryIncidentClosedBoundary | null;
}> {
  const invalid = validateCurrentObservation(previous, frame, observation);
  if (invalid) {
    return reject(previous, invalid);
  }
  if (observation.decision !== "accepted") {
    return reject(previous, "observation-not-accepted");
  }
  if (!observation.strongForConfirmation || observation.observedExpiresAt === null) {
    return reject(previous, "observation-not-strong");
  }
  const remainingSeconds = observation.rawTime?.seconds;
  if (
    remainingSeconds === null ||
    remainingSeconds === undefined ||
    remainingSeconds < BOOSTER_EXPIRY_INCIDENT_MIN_REMAINING_SECONDS
  ) {
    return reject(previous, "remaining-below-confirmation-floor");
  }

  let state = previous;
  let attempt = previous.activeCandidateAttempt;
  let expiredAttempt: BoosterExpiryIncidentCandidateAttempt | null = null;
  if (attempt?.observationIds.includes(observation.id)) {
    return reject(previous, "duplicate-candidate-observation");
  }
  if (attempt && !isCompatibleCandidateObservation(attempt, observation)) {
    expiredAttempt = {
      ...attempt,
      status:
        observation.sampledAt - attempt.lastObservedAt >
        BOOSTER_EXPIRY_INCIDENT_MAX_OBSERVATION_GAP_MS
          ? "expired"
          : "replaced",
      endedAt: observation.sampledAt,
      terminalReason:
        observation.sampledAt - attempt.lastObservedAt >
        BOOSTER_EXPIRY_INCIDENT_MAX_OBSERVATION_GAP_MS
          ? "window-expired"
          : "incompatible-expiry",
    };
    attempt = null;
    state = { ...state, activeCandidateAttempt: null };
  }

  if (!attempt) {
    const sequence = state.candidateSequence + 1;
    const nextAttempt: BoosterExpiryIncidentCandidateAttempt = {
      id: createBoosterExpiryIncidentCandidateAttemptId(
        state.resetEpoch.id,
        sequence,
      ),
      resetEpochId: state.resetEpoch.id,
      flowEpochId: state.flowEpoch.id,
      sequence,
      startedAt: observation.sampledAt,
      lastObservedAt: observation.sampledAt,
      observationIds: [observation.id],
      firstRemainingSeconds: remainingSeconds,
      lastRemainingSeconds: remainingSeconds,
      expiresAt: observation.observedExpiresAt,
      expiresAtMin: observation.observedExpiresAt,
      expiresAtMax: observation.observedExpiresAt,
      status: "collecting",
      confirmedCycleId: null,
      endedAt: null,
      terminalReason: null,
    };
    return accept(
      {
        ...state,
        candidateSequence: sequence,
        activeCandidateAttempt: nextAttempt,
      },
      { attempt: nextAttempt, cycle: null, expiredAttempt, closed: null },
    );
  }

  const observationCount = attempt.observationIds.length + 1;
  const expiresAt = Math.round(
    (attempt.expiresAt * attempt.observationIds.length +
      observation.observedExpiresAt) /
      observationCount,
  );
  const nextAttempt: BoosterExpiryIncidentCandidateAttempt = {
    ...attempt,
    lastObservedAt: observation.sampledAt,
    observationIds: [...attempt.observationIds, observation.id],
    lastRemainingSeconds: remainingSeconds,
    expiresAt,
    expiresAtMin: Math.min(attempt.expiresAtMin, observation.observedExpiresAt),
    expiresAtMax: Math.max(attempt.expiresAtMax, observation.observedExpiresAt),
  };
  if (!isCandidateConfirmed(nextAttempt)) {
    return accept(
      { ...state, activeCandidateAttempt: nextAttempt },
      { attempt: nextAttempt, cycle: null, expiredAttempt, closed: null },
    );
  }

  const previousCycle = state.activeCycle;
  if (
    previousCycle &&
    nextAttempt.expiresAt - previousCycle.expiresAt <
      BOOSTER_EXPIRY_INCIDENT_NEW_CYCLE_EXTENSION_MS
  ) {
    const rejectedAttempt: BoosterExpiryIncidentCandidateAttempt = {
      ...nextAttempt,
      status: "rejected",
      endedAt: observation.sampledAt,
      terminalReason: "not-new-cycle",
    };
    return accept(
      { ...state, activeCandidateAttempt: null },
      { attempt: rejectedAttempt, cycle: null, expiredAttempt, closed: null },
    );
  }

  const cycleSequence = state.cycleSequence + 1;
  const cycleId = createBoosterExpiryIncidentCycleId(
    state.resetEpoch.id,
    cycleSequence,
  );
  const confirmedAttempt: BoosterExpiryIncidentCandidateAttempt = {
    ...nextAttempt,
    status: "confirmed",
    confirmedCycleId: cycleId,
    endedAt: observation.sampledAt,
    terminalReason: "confirmed",
  };
  const cycle: BoosterExpiryIncidentConfirmedCycle = {
    id: cycleId,
    resetEpochId: state.resetEpoch.id,
    sequence: cycleSequence,
    candidateAttemptId: confirmedAttempt.id,
    confirmationFlowEpochId: confirmedAttempt.flowEpochId,
    observationIds: confirmedAttempt.observationIds,
    confirmedAt: observation.sampledAt,
    expiresAt: confirmedAttempt.expiresAt,
    timingConfigRevisionId: state.configurationRevision.id,
    lastSupportedAt: observation.sampledAt,
    contradictionCount: 0,
    status: "active",
    endedAt: null,
    terminalReason: null,
  };
  const closed = previousCycle
    ? closeBoundaryForNextCycle(state, observation.sampledAt)
    : null;

  return accept(
    {
      ...state,
      cycleSequence,
      activeCandidateAttempt: null,
      activeCycle: cycle,
      activeSchedule: null,
      latestSchedule: closed?.schedule ?? state.latestSchedule,
      latestDecision: null,
      activePlaybackAttempt: null,
    },
    { attempt: confirmedAttempt, cycle, expiredAttempt, closed },
  );
}

export function recordBoosterExpiryIncidentCycleSupport({
  previous,
  cycleId,
  observation,
  occurredAt = observation.sampledAt,
}: {
  previous: BoosterExpiryIncidentBoundaryState;
  cycleId: string;
  observation: BoosterExpiryIncidentObservation;
  occurredAt?: number;
}): BoosterExpiryIncidentBoundaryResult<{
  cycle: BoosterExpiryIncidentConfirmedCycle;
  support: "supported" | "contradicted" | "none" | "cancelled";
  closedSchedule: BoosterExpiryIncidentSchedule | null;
}> {
  const cycle = previous.activeCycle;
  if (!cycle) {
    return reject(previous, "no-active-cycle");
  }
  if (cycle.id !== cycleId || cycle.resetEpochId !== previous.resetEpoch.id) {
    return reject(previous, "stale-cycle");
  }
  if (observation.resetEpochId !== previous.resetEpoch.id) {
    return reject(previous, "stale-reset-epoch");
  }

  const delta =
    observation.strongForConfirmation && observation.observedExpiresAt !== null
      ? Math.abs(observation.observedExpiresAt - cycle.expiresAt)
      : null;
  const supported = delta !== null && delta <= BOOSTER_EXPIRY_INCIDENT_SUPPORT_TOLERANCE_MS;
  const contradicted =
    delta !== null && delta >= BOOSTER_EXPIRY_INCIDENT_CONTRADICTION_TOLERANCE_MS;
  const nextCycle: BoosterExpiryIncidentConfirmedCycle = {
    ...cycle,
    lastSupportedAt: supported ? occurredAt : cycle.lastSupportedAt,
    contradictionCount: supported
      ? 0
      : contradicted
        ? cycle.contradictionCount + 1
        : cycle.contradictionCount,
  };
  const unsupportedTooLong =
    occurredAt - nextCycle.lastSupportedAt >
    BOOSTER_EXPIRY_INCIDENT_MAX_UNSUPPORTED_MS;
  const contradictedTooOften =
    nextCycle.contradictionCount >= BOOSTER_EXPIRY_INCIDENT_CONTRADICTION_LIMIT;
  if (!unsupportedTooLong && !contradictedTooOften) {
    return accept(
      { ...previous, activeCycle: nextCycle },
      {
        cycle: nextCycle,
        support: supported ? "supported" : contradicted ? "contradicted" : "none",
        closedSchedule: null,
      },
    );
  }

  const cancelledCycle: BoosterExpiryIncidentConfirmedCycle = {
    ...nextCycle,
    status: "cancelled",
    endedAt: occurredAt,
    terminalReason: contradictedTooOften
      ? "contradicted"
      : "unsupported-too-long",
  };
  const closedSchedule = previous.activeSchedule
    ? {
        ...previous.activeSchedule,
        status: "cancelled" as const,
        endedAt: occurredAt,
        outcomeReason: cancelledCycle.terminalReason,
      }
    : null;
  return accept(
    {
      ...previous,
      activeCycle: null,
      activeSchedule: null,
      latestSchedule: closedSchedule ?? previous.latestSchedule,
      latestDecision: null,
      activePlaybackAttempt: null,
    },
    { cycle: cancelledCycle, support: "cancelled", closedSchedule },
  );
}

export function registerBoosterExpiryIncidentSchedule({
  previous,
  cycle,
  registeredAt,
  reason,
}: {
  previous: BoosterExpiryIncidentBoundaryState;
  cycle: BoosterExpiryIncidentConfirmedCycle;
  registeredAt: number;
  reason: BoosterExpiryIncidentScheduleReason;
}): BoosterExpiryIncidentBoundaryResult<{
  schedule: BoosterExpiryIncidentSchedule;
  replacedSchedule: BoosterExpiryIncidentSchedule | null;
}> {
  if (
    cycle.resetEpochId !== previous.resetEpoch.id ||
    previous.activeCycle?.id !== cycle.id
  ) {
    return reject(previous, "stale-cycle");
  }
  const alertDueAt =
    cycle.expiresAt -
    previous.configurationRevision.values.alertLeadSeconds * 1_000;
  const activeSchedule = previous.activeSchedule;
  if (
    activeSchedule?.cycleId === cycle.id &&
    activeSchedule.alertDueAt === alertDueAt &&
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
  const sequence = (previous.scheduleSequenceByCycle[cycle.id] ?? 0) + 1;
  const schedule: BoosterExpiryIncidentSchedule = {
    id: createBoosterExpiryIncidentScheduleId(cycle.id, sequence),
    resetEpochId: previous.resetEpoch.id,
    cycleId: cycle.id,
    sequence,
    reason,
    registeredAt,
    alertDueAt,
    confirmedExpiresAt: cycle.expiresAt,
    timingConfigRevisionId: previous.configurationRevision.id,
    status: "registered",
    endedAt: null,
    outcomeReason: null,
  };
  const nextCycle = {
    ...cycle,
    timingConfigRevisionId: previous.configurationRevision.id,
  };
  return accept(
    {
      ...previous,
      scheduleSequenceByCycle: {
        ...previous.scheduleSequenceByCycle,
        [cycle.id]: sequence,
      },
      activeCycle: nextCycle,
      activeSchedule: schedule,
      latestSchedule: schedule,
      latestDecision: null,
    },
    { schedule, replacedSchedule },
  );
}

export function completeBoosterExpiryIncidentSchedule({
  previous,
  scheduleId,
  outcome,
  occurredAt,
  reason = null,
}: {
  previous: BoosterExpiryIncidentBoundaryState;
  scheduleId: string;
  outcome: "cancelled" | "suppressed" | "fired";
  occurredAt: number;
  reason?: string | null;
}): BoosterExpiryIncidentBoundaryResult<{
  schedule: BoosterExpiryIncidentSchedule;
  decision: BoosterExpiryIncidentAlertDecision | null;
}> {
  const schedule = previous.activeSchedule;
  if (!schedule || schedule.id !== scheduleId) {
    return reject(previous, "stale-schedule");
  }
  const cycle = previous.activeCycle;
  if (!cycle || cycle.id !== schedule.cycleId) {
    return reject(previous, "stale-cycle");
  }
  if (outcome === "fired") {
    const currentDueAt =
      cycle.expiresAt -
      previous.configurationRevision.values.alertLeadSeconds * 1_000;
    if (currentDueAt !== schedule.alertDueAt) {
      return reject(previous, "schedule-timing-revised");
    }
    if (occurredAt < schedule.alertDueAt) {
      return reject(previous, "schedule-not-due");
    }
  }

  const completedSchedule: BoosterExpiryIncidentSchedule = {
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

  const sequence = (previous.decisionSequenceByCycle[cycle.id] ?? 0) + 1;
  const decision: BoosterExpiryIncidentAlertDecision = {
    id: createBoosterExpiryIncidentAlertDecisionId(cycle.id, sequence),
    resetEpochId: previous.resetEpoch.id,
    cycleId: cycle.id,
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
      decisionSequenceByCycle: {
        ...previous.decisionSequenceByCycle,
        [cycle.id]: sequence,
      },
      activeCycle: { ...cycle, status: "alerted" },
      activeSchedule: null,
      latestSchedule: completedSchedule,
      latestDecision: decision,
    },
    { schedule: completedSchedule, decision },
  );
}

export function requestBoosterExpiryIncidentPlayback({
  previous,
  decision,
  requestedAt,
}: {
  previous: BoosterExpiryIncidentBoundaryState;
  decision: BoosterExpiryIncidentAlertDecision;
  requestedAt: number;
}): BoosterExpiryIncidentBoundaryResult<BoosterExpiryIncidentPlaybackAttempt> {
  if (
    decision.resetEpochId !== previous.resetEpoch.id ||
    previous.latestDecision?.id !== decision.id
  ) {
    return reject(previous, "stale-alert-decision");
  }
  if (previous.activeCycle?.id !== decision.cycleId) {
    return reject(previous, "stale-cycle");
  }
  if (previous.activePlaybackAttempt) {
    return reject(previous, "playback-in-flight");
  }
  if (previous.latestPlaybackAttempt?.decisionId === decision.id) {
    return reject(previous, "decision-playback-already-requested");
  }

  const sequence = (previous.playbackSequenceByCycle[decision.cycleId] ?? 0) + 1;
  const configuration = previous.configurationRevision.values;
  const attempt: BoosterExpiryIncidentPlaybackAttempt = {
    id: createBoosterExpiryIncidentPlaybackAttemptId(decision.cycleId, sequence),
    resetEpochId: previous.resetEpoch.id,
    cycleId: decision.cycleId,
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
  };
  return accept(
    {
      ...previous,
      playbackSequenceByCycle: {
        ...previous.playbackSequenceByCycle,
        [decision.cycleId]: sequence,
      },
      activePlaybackAttempt: attempt,
      latestPlaybackAttempt: attempt,
    },
    attempt,
  );
}

export function transitionBoosterExpiryIncidentPlayback({
  previous,
  attemptId,
  status,
  occurredAt,
  error = null,
}: {
  previous: BoosterExpiryIncidentBoundaryState;
  attemptId: string;
  status: "browser-play-accepted" | "finished" | "failed";
  occurredAt: number;
  error?: string | null;
}): BoosterExpiryIncidentBoundaryResult<BoosterExpiryIncidentPlaybackAttempt> {
  const attempt = previous.activePlaybackAttempt;
  if (!attempt || attempt.id !== attemptId) {
    return reject(previous, "stale-playback-attempt");
  }
  if (!isValidPlaybackTransition(attempt.status, status)) {
    return reject(previous, "invalid-playback-transition");
  }
  const nextAttempt: BoosterExpiryIncidentPlaybackAttempt = {
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

export function freezeBoosterExpiryIncidentBoundary({
  previous,
  frozenAt,
}: {
  previous: BoosterExpiryIncidentBoundaryState;
  frozenAt: number;
}): {
  state: BoosterExpiryIncidentBoundaryState;
  lease: BoosterExpiryIncidentReportLease;
} {
  const sequence = previous.leaseSequence + 1;
  const continuity = previous.resetEpoch.continuity;
  const cycleId = previous.activeCycle?.id ?? null;
  const lease: BoosterExpiryIncidentReportLease = {
    id: createBoosterExpiryIncidentReportLeaseId(previous.sessionId, sequence),
    resetEpochId: previous.resetEpoch.id,
    flowEpochId: previous.flowEpoch.id,
    configRevisionId: previous.configurationRevision.id,
    sequence,
    frozenAt,
    leasedThroughFrameSequence: previous.frameSequence,
    layoutKey: continuity.layoutKey,
    sourceGeometryRevision: continuity.sourceGeometryRevision,
    candidateAttemptId: previous.activeCandidateAttempt?.id ?? null,
    cycleId,
    scheduleId:
      previous.latestSchedule?.cycleId === cycleId
        ? previous.latestSchedule.id
        : null,
    decisionId:
      previous.latestDecision?.cycleId === cycleId
        ? previous.latestDecision.id
        : null,
    playbackAttemptId:
      previous.latestPlaybackAttempt?.cycleId === cycleId
        ? previous.latestPlaybackAttempt.id
        : null,
  };
  return {
    state: { ...previous, leaseSequence: sequence },
    lease,
  };
}

export function isBoosterExpiryIncidentFrameWithinLease(
  lease: BoosterExpiryIncidentReportLease,
  frame: BoosterExpiryIncidentFrame,
): boolean {
  return (
    frame.resetEpochId === lease.resetEpochId &&
    frame.sequence <= lease.leasedThroughFrameSequence &&
    frame.sampledAt <= lease.frozenAt &&
    frame.layoutKey === lease.layoutKey &&
    frame.sourceGeometryRevision === lease.sourceGeometryRevision
  );
}

export function isBoosterExpiryIncidentObservationWithinLease(
  lease: BoosterExpiryIncidentReportLease,
  observation: BoosterExpiryIncidentObservation,
): boolean {
  return (
    observation.resetEpochId === lease.resetEpochId &&
    observation.frameSequence <= lease.leasedThroughFrameSequence &&
    observation.sampledAt <= lease.frozenAt
  );
}

export function getBoosterExpiryIncidentContinuityResetReason(
  previous: BoosterExpiryIncidentContinuity,
  next: BoosterExpiryIncidentContinuity,
): Exclude<BoosterExpiryIncidentResetReason, "initialized"> | null {
  if (previous.captureGeneration !== next.captureGeneration) {
    return "stream-replaced";
  }
  if (previous.layoutKey !== next.layoutKey) {
    return "layout-changed";
  }
  if (previous.sourceGeometryRevision !== next.sourceGeometryRevision) {
    return "source-geometry-changed";
  }
  if (previous.monitoringGeneration !== next.monitoringGeneration) {
    return "monitoring-generation-changed";
  }
  if (previous.featureGeneration !== next.featureGeneration) {
    return "profile-replaced";
  }
  return null;
}

function validateCurrentObservation(
  state: BoosterExpiryIncidentBoundaryState,
  frame: BoosterExpiryIncidentFrame,
  observation: BoosterExpiryIncidentObservation,
): BoosterExpiryIncidentBoundaryRejectReason | null {
  if (frame.resetEpochId !== state.resetEpoch.id) {
    return "stale-reset-epoch";
  }
  if (frame.flowEpochId !== state.flowEpoch.id) {
    return "stale-flow-epoch";
  }
  if (state.latestFrame?.id !== frame.id) {
    return "stale-frame";
  }
  if (
    observation.frameId !== frame.id ||
    observation.resetEpochId !== frame.resetEpochId ||
    observation.flowEpochId !== frame.flowEpochId ||
    state.latestObservation?.id !== observation.id
  ) {
    return "observation-frame-mismatch";
  }
  return null;
}

function isCompatibleCandidateObservation(
  attempt: BoosterExpiryIncidentCandidateAttempt,
  observation: BoosterExpiryIncidentObservation,
): boolean {
  return (
    attempt.flowEpochId === observation.flowEpochId &&
    observation.observedExpiresAt !== null &&
    observation.sampledAt - attempt.lastObservedAt <=
      BOOSTER_EXPIRY_INCIDENT_MAX_OBSERVATION_GAP_MS &&
    Math.abs(observation.observedExpiresAt - attempt.expiresAt) <=
      BOOSTER_EXPIRY_INCIDENT_EXPIRES_TOLERANCE_MS
  );
}

function isCandidateConfirmed(
  attempt: BoosterExpiryIncidentCandidateAttempt,
): boolean {
  return (
    attempt.observationIds.length >=
      BOOSTER_EXPIRY_INCIDENT_CONFIRMATION_OBSERVATIONS &&
    attempt.lastObservedAt - attempt.startedAt >=
      BOOSTER_EXPIRY_INCIDENT_CONFIRMATION_SPAN_MS &&
    attempt.firstRemainingSeconds - attempt.lastRemainingSeconds >=
      BOOSTER_EXPIRY_INCIDENT_CONFIRMATION_DECREASE_SECONDS &&
    attempt.expiresAtMax - attempt.expiresAtMin <=
      BOOSTER_EXPIRY_INCIDENT_EXPIRES_SPREAD_MS
  );
}

function isStrongFlowSource(source: string | null): boolean {
  return source === "raw" || source === "raw-lock" || source === "raw-relock";
}

function isValidPlaybackTransition(
  previous: BoosterExpiryIncidentPlaybackAttempt["status"],
  next: "browser-play-accepted" | "finished" | "failed",
): boolean {
  if (next === "failed") {
    return previous === "requested" || previous === "browser-play-accepted";
  }
  if (next === "browser-play-accepted") {
    return previous === "requested";
  }
  return previous === "browser-play-accepted";
}

function closeBoundary(
  state: BoosterExpiryIncidentBoundaryState,
  occurredAt: number,
  reason: "reset-epoch",
): BoosterExpiryIncidentClosedBoundary {
  return {
    candidateAttempt: state.activeCandidateAttempt
      ? {
          ...state.activeCandidateAttempt,
          status: "terminal",
          endedAt: occurredAt,
          terminalReason: reason,
        }
      : null,
    cycle: state.activeCycle
      ? {
          ...state.activeCycle,
          status: "terminal",
          endedAt: occurredAt,
          terminalReason: reason,
        }
      : null,
    schedule: state.activeSchedule
      ? {
          ...state.activeSchedule,
          status: "cancelled",
          endedAt: occurredAt,
          outcomeReason: reason,
        }
      : null,
    playbackAttempt: state.activePlaybackAttempt,
  };
}

function closeBoundaryForNextCycle(
  state: BoosterExpiryIncidentBoundaryState,
  occurredAt: number,
): BoosterExpiryIncidentClosedBoundary {
  return {
    candidateAttempt: null,
    cycle: state.activeCycle
      ? {
          ...state.activeCycle,
          status: "replaced",
          endedAt: occurredAt,
          terminalReason: "next-cycle",
        }
      : null,
    schedule: state.activeSchedule
      ? {
          ...state.activeSchedule,
          status: "replaced",
          endedAt: occurredAt,
          outcomeReason: "next-cycle",
        }
      : null,
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
  continuity: BoosterExpiryIncidentContinuity;
  now: number;
  reason: BoosterExpiryIncidentResetReason;
}): BoosterExpiryIncidentResetEpoch {
  return {
    id: createBoosterExpiryIncidentResetEpochId(sessionId, sequence),
    sessionId,
    sequence,
    startedAt: now,
    reason,
    continuity: { ...continuity },
  };
}

function createFlowEpoch({
  resetEpochId,
  sequence,
  workerGeneration,
  now,
  reason,
}: {
  resetEpochId: string;
  sequence: number;
  workerGeneration: number;
  now: number;
  reason: BoosterExpiryIncidentFlowRestartReason;
}): BoosterExpiryIncidentFlowEpoch {
  return {
    id: createBoosterExpiryIncidentFlowEpochId(resetEpochId, sequence),
    resetEpochId,
    sequence,
    workerGeneration,
    startedAt: now,
    reason,
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
  configuration: BoosterExpiryIncidentConfiguration;
  now: number;
}): BoosterExpiryIncidentConfigurationRevision {
  return {
    id: createBoosterExpiryIncidentConfigurationRevisionId(
      resetEpochId,
      sequence,
    ),
    resetEpochId,
    sequence,
    capturedAt: now,
    fingerprint: fingerprintConfiguration(configuration),
    timingFingerprint: String(configuration.alertLeadSeconds),
    playbackFingerprint: [
      configuration.soundId,
      configuration.featureVolume,
      configuration.masterVolume,
      configuration.effectiveVolume,
    ].join("|"),
    values: { ...configuration },
  };
}

function fingerprintConfiguration(
  configuration: BoosterExpiryIncidentConfiguration,
): string {
  return [
    configuration.enabled,
    configuration.alertLeadSeconds,
    configuration.soundId,
    configuration.featureVolume,
    configuration.masterVolume,
    configuration.effectiveVolume,
  ].join("|");
}

function accept<T>(
  state: BoosterExpiryIncidentBoundaryState,
  value: T,
): BoosterExpiryIncidentBoundaryResult<T> {
  return { accepted: true, state, value };
}

function reject<T>(
  state: BoosterExpiryIncidentBoundaryState,
  reason: BoosterExpiryIncidentBoundaryRejectReason,
): BoosterExpiryIncidentBoundaryResult<T> {
  return { accepted: false, state, reason };
}
