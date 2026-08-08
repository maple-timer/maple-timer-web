import {
  HUNT_STALL_INCIDENT_BOUNDARY_SCHEMA_VERSION,
  createHuntStallIncidentActivityEpochId,
  createHuntStallIncidentAlertCycleId,
  createHuntStallIncidentAlertDecisionId,
  createHuntStallIncidentConfigurationRevisionId,
  createHuntStallIncidentFrameId,
  createHuntStallIncidentObservationId,
  createHuntStallIncidentPlaybackAttemptId,
  createHuntStallIncidentReportLeaseId,
  createHuntStallIncidentResetEpochId,
  createHuntStallIncidentStallEpisodeId,
  type HuntStallIncidentActivityEpoch,
  type HuntStallIncidentActivityReason,
  type HuntStallIncidentAlertCycle,
  type HuntStallIncidentAlertDecision,
  type HuntStallIncidentBoundaryRejectReason,
  type HuntStallIncidentBoundaryResult,
  type HuntStallIncidentBoundaryState,
  type HuntStallIncidentClosedBoundary,
  type HuntStallIncidentConfiguration,
  type HuntStallIncidentConfigurationRevision,
  type HuntStallIncidentContinuity,
  type HuntStallIncidentFrame,
  type HuntStallIncidentObservation,
  type HuntStallIncidentPlaybackAttempt,
  type HuntStallIncidentReportLease,
  type HuntStallIncidentResetEpoch,
  type HuntStallIncidentResetReason,
  type HuntStallIncidentStallEpisode,
  type HuntStallIncidentTerminalReason,
} from "./huntStallIncidentEvidenceTypes";

export function createHuntStallIncidentBoundary({
  sessionId,
  continuity,
  configuration,
  now,
}: {
  sessionId: string;
  continuity: HuntStallIncidentContinuity;
  configuration: HuntStallIncidentConfiguration;
  now: number;
}): HuntStallIncidentBoundaryState {
  assertConfigurationMode(continuity, configuration);

  const resetSequence = 1;
  const resetEpoch = createResetEpoch({
    sessionId,
    sequence: resetSequence,
    continuity,
    now,
    reason: "initialized",
  });
  const configurationSequence = 1;
  const configurationRevision = createConfigurationRevision({
    resetEpochId: resetEpoch.id,
    sequence: configurationSequence,
    configuration,
    now,
  });

  return {
    schemaVersion: HUNT_STALL_INCIDENT_BOUNDARY_SCHEMA_VERSION,
    sessionId,
    resetSequence,
    configurationSequence,
    frameSequence: 0,
    activitySequence: 0,
    episodeSequence: 0,
    cycleSequence: 0,
    decisionSequenceByCycle: {},
    attemptSequenceByCycle: {},
    leaseSequence: 0,
    resetEpoch,
    configurationRevision,
    latestFrame: null,
    latestObservation: null,
    activeActivityEpoch: null,
    activeStallEpisode: null,
    activeAlertCycle: null,
    latestDecision: null,
    activePlaybackAttempt: null,
    latestPlaybackAttempt: null,
  };
}

export function resetHuntStallIncidentBoundary({
  previous,
  continuity,
  configuration,
  now,
  reason,
}: {
  previous: HuntStallIncidentBoundaryState;
  continuity: HuntStallIncidentContinuity;
  configuration: HuntStallIncidentConfiguration;
  now: number;
  reason: Exclude<HuntStallIncidentResetReason, "initialized">;
}): HuntStallIncidentBoundaryResult<{
  resetEpoch: HuntStallIncidentResetEpoch;
  configurationRevision: HuntStallIncidentConfigurationRevision;
  closed: HuntStallIncidentClosedBoundary;
}> {
  if (continuity.mode !== configuration.mode) {
    return reject(previous, "configuration-mode-mismatch");
  }

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
  const state: HuntStallIncidentBoundaryState = {
    ...previous,
    resetSequence,
    configurationSequence,
    resetEpoch,
    configurationRevision,
    latestFrame: null,
    latestObservation: null,
    activeActivityEpoch: null,
    activeStallEpisode: null,
    activeAlertCycle: null,
    latestDecision: null,
    activePlaybackAttempt: null,
    latestPlaybackAttempt: null,
  };

  return accept(state, { resetEpoch, configurationRevision, closed });
}

export function reviseHuntStallIncidentConfiguration({
  previous,
  configuration,
  now,
}: {
  previous: HuntStallIncidentBoundaryState;
  configuration: HuntStallIncidentConfiguration;
  now: number;
}): HuntStallIncidentBoundaryResult<{
  changed: boolean;
  configurationRevision: HuntStallIncidentConfigurationRevision;
}> {
  const current = previous.configurationRevision.values;
  if (
    configuration.mode !== previous.resetEpoch.continuity.mode ||
    configuration.mode !== current.mode ||
    configuration.enabled !== current.enabled
  ) {
    return reject(previous, "continuity-reset-required");
  }

  const fingerprint = fingerprintConfiguration(configuration);
  if (fingerprint === previous.configurationRevision.fingerprint) {
    return accept(previous, {
      changed: false,
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
    { changed: true, configurationRevision },
  );
}

export function recordHuntStallIncidentFrame({
  previous,
  sampledAt,
}: {
  previous: HuntStallIncidentBoundaryState;
  sampledAt: number;
}): HuntStallIncidentBoundaryResult<HuntStallIncidentFrame> {
  if (!previous.configurationRevision.values.enabled) {
    return reject(previous, "feature-disabled");
  }

  const sequence = previous.frameSequence + 1;
  const continuity = previous.resetEpoch.continuity;
  const frame: HuntStallIncidentFrame = {
    id: createHuntStallIncidentFrameId(previous.resetEpoch.id, sequence),
    resetEpochId: previous.resetEpoch.id,
    configRevisionId: previous.configurationRevision.id,
    sequence,
    sampledAt,
    mode: continuity.mode,
    layoutKey: continuity.layoutKey,
    regionRevision: continuity.regionRevision,
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

export function recordHuntStallIncidentObservation({
  previous,
  frame,
}: {
  previous: HuntStallIncidentBoundaryState;
  frame: HuntStallIncidentFrame;
}): HuntStallIncidentBoundaryResult<HuntStallIncidentObservation> {
  if (frame.resetEpochId !== previous.resetEpoch.id) {
    return reject(previous, "stale-reset-epoch");
  }
  if (previous.latestFrame?.id !== frame.id) {
    return reject(previous, "stale-frame");
  }

  const observation: HuntStallIncidentObservation = {
    id: createHuntStallIncidentObservationId(frame.id),
    resetEpochId: frame.resetEpochId,
    frameId: frame.id,
    frameSequence: frame.sequence,
    sampledAt: frame.sampledAt,
    mode: frame.mode,
  };
  return accept({ ...previous, latestObservation: observation }, observation);
}

export function acceptHuntStallIncidentActivity({
  previous,
  frame,
  observation,
  occurredAt,
  reason,
}: {
  previous: HuntStallIncidentBoundaryState;
  frame: HuntStallIncidentFrame;
  observation: HuntStallIncidentObservation;
  occurredAt: number;
  reason: HuntStallIncidentActivityReason;
}): HuntStallIncidentBoundaryResult<{
  activityEpoch: HuntStallIncidentActivityEpoch;
  stallEpisode: HuntStallIncidentStallEpisode;
  closed: HuntStallIncidentClosedBoundary;
}> {
  const invalid = validateCurrentObservation(previous, frame, observation);
  if (invalid) {
    return reject(previous, invalid);
  }
  if (!isActivityReasonForMode(reason, previous.resetEpoch.continuity.mode)) {
    return reject(previous, "activity-reason-mode-mismatch");
  }
  if (
    previous.activeActivityEpoch?.anchorObservationId === observation.id
  ) {
    return reject(previous, "duplicate-activity-observation");
  }

  const closed = closeActiveBoundary(previous, occurredAt, "activity-accepted");
  const activitySequence = previous.activitySequence + 1;
  const activityEpoch: HuntStallIncidentActivityEpoch = {
    id: createHuntStallIncidentActivityEpochId(
      previous.resetEpoch.id,
      activitySequence,
    ),
    resetEpochId: previous.resetEpoch.id,
    sequence: activitySequence,
    mode: previous.resetEpoch.continuity.mode,
    startedAt: occurredAt,
    anchorFrameId: frame.id,
    anchorFrameSequence: frame.sequence,
    anchorObservationId: observation.id,
    reason,
    endedAt: null,
    terminalReason: null,
  };
  const episodeSequence = previous.episodeSequence + 1;
  const stallEpisode: HuntStallIncidentStallEpisode = {
    id: createHuntStallIncidentStallEpisodeId(
      activityEpoch.id,
      episodeSequence,
    ),
    resetEpochId: previous.resetEpoch.id,
    activityEpochId: activityEpoch.id,
    sequence: episodeSequence,
    mode: previous.resetEpoch.continuity.mode,
    startedAt: occurredAt,
    status: "active",
    alertCycleId: null,
    endedAt: null,
    terminalReason: null,
  };
  const state: HuntStallIncidentBoundaryState = {
    ...previous,
    activitySequence,
    episodeSequence,
    activeActivityEpoch: activityEpoch,
    activeStallEpisode: stallEpisode,
    activeAlertCycle: null,
    latestDecision: null,
    activePlaybackAttempt: null,
    latestPlaybackAttempt: null,
  };
  return accept(state, { activityEpoch, stallEpisode, closed });
}

export function recordHuntStallIncidentAlertDecision({
  previous,
  frame,
  observation,
  occurredAt,
  kind,
}: {
  previous: HuntStallIncidentBoundaryState;
  frame: HuntStallIncidentFrame;
  observation: HuntStallIncidentObservation;
  occurredAt: number;
  kind: "initial" | "repeat";
}): HuntStallIncidentBoundaryResult<{
  decision: HuntStallIncidentAlertDecision;
  cycle: HuntStallIncidentAlertCycle;
}> {
  const invalid = validateCurrentObservation(previous, frame, observation);
  if (invalid) {
    return reject(previous, invalid);
  }
  const activityEpoch = previous.activeActivityEpoch;
  const stallEpisode = previous.activeStallEpisode;
  if (!activityEpoch || !stallEpisode) {
    return reject(previous, "no-active-activity");
  }
  if (frame.sequence < activityEpoch.anchorFrameSequence) {
    return reject(previous, "frame-before-active-activity");
  }

  let cycle = previous.activeAlertCycle;
  let cycleSequence = previous.cycleSequence;
  if (kind === "initial") {
    if (cycle) {
      return reject(previous, "initial-cycle-already-created");
    }
    cycleSequence += 1;
    const cycleId = createHuntStallIncidentAlertCycleId(
      stallEpisode.id,
      cycleSequence,
    );
    const decisionId = createHuntStallIncidentAlertDecisionId(
      cycleId,
      kind,
      1,
    );
    cycle = {
      id: cycleId,
      resetEpochId: previous.resetEpoch.id,
      activityEpochId: activityEpoch.id,
      stallEpisodeId: stallEpisode.id,
      sequence: cycleSequence,
      mode: activityEpoch.mode,
      startedAt: occurredAt,
      initialDecisionId: decisionId,
      status: "active",
      endedAt: null,
      terminalReason: null,
    };
  } else {
    if (activityEpoch.mode !== "manual-experience") {
      return reject(previous, "repeat-not-supported");
    }
    if (!cycle || cycle.stallEpisodeId !== stallEpisode.id) {
      return reject(previous, "no-active-alert-cycle");
    }
    if (
      !previous.latestPlaybackAttempt ||
      previous.latestPlaybackAttempt.cycleId !== cycle.id ||
      previous.latestPlaybackAttempt.status !== "finished"
    ) {
      return reject(previous, "repeat-playback-not-finished");
    }
  }

  const decisionSequence =
    (previous.decisionSequenceByCycle[cycle.id] ?? 0) + 1;
  const decision: HuntStallIncidentAlertDecision = {
    id: createHuntStallIncidentAlertDecisionId(
      cycle.id,
      kind,
      decisionSequence,
    ),
    resetEpochId: previous.resetEpoch.id,
    activityEpochId: activityEpoch.id,
    stallEpisodeId: stallEpisode.id,
    cycleId: cycle.id,
    sequence: decisionSequence,
    kind,
    occurredAt,
    frameId: frame.id,
    observationId: observation.id,
    configRevisionId: previous.configurationRevision.id,
  };
  const nextEpisode: HuntStallIncidentStallEpisode = {
    ...stallEpisode,
    status: "alerted",
    alertCycleId: cycle.id,
  };
  const state: HuntStallIncidentBoundaryState = {
    ...previous,
    cycleSequence,
    decisionSequenceByCycle: {
      ...previous.decisionSequenceByCycle,
      [cycle.id]: decisionSequence,
    },
    activeStallEpisode: nextEpisode,
    activeAlertCycle: cycle,
    latestDecision: decision,
  };
  return accept(state, { decision, cycle });
}

export function requestHuntStallIncidentPlayback({
  previous,
  decision,
  requestedAt,
}: {
  previous: HuntStallIncidentBoundaryState;
  decision: HuntStallIncidentAlertDecision;
  requestedAt: number;
}): HuntStallIncidentBoundaryResult<HuntStallIncidentPlaybackAttempt> {
  if (decision.resetEpochId !== previous.resetEpoch.id) {
    return reject(previous, "stale-reset-epoch");
  }
  if (previous.latestDecision?.id !== decision.id) {
    return reject(previous, "stale-alert-decision");
  }
  if (
    !previous.activeAlertCycle ||
    previous.activeAlertCycle.id !== decision.cycleId ||
    previous.activeStallEpisode?.id !== decision.stallEpisodeId
  ) {
    return reject(previous, "stale-alert-cycle");
  }
  if (decision.configRevisionId !== previous.configurationRevision.id) {
    return reject(previous, "configuration-revised-after-decision");
  }
  if (
    previous.activePlaybackAttempt?.status === "requested" ||
    previous.activePlaybackAttempt?.status === "started"
  ) {
    return reject(previous, "playback-in-flight");
  }
  if (previous.latestPlaybackAttempt?.decisionId === decision.id) {
    return reject(previous, "decision-playback-already-requested");
  }

  const sequence =
    (previous.attemptSequenceByCycle[decision.cycleId] ?? 0) + 1;
  const configuration = previous.configurationRevision.values;
  const attempt: HuntStallIncidentPlaybackAttempt = {
    id: createHuntStallIncidentPlaybackAttemptId(decision.cycleId, sequence),
    resetEpochId: previous.resetEpoch.id,
    activityEpochId: decision.activityEpochId,
    stallEpisodeId: decision.stallEpisodeId,
    cycleId: decision.cycleId,
    decisionId: decision.id,
    sequence,
    requestedAt,
    startedAt: null,
    finishedAt: null,
    failedAt: null,
    status: "requested",
    error: null,
    configRevisionId: decision.configRevisionId,
    soundId: configuration.soundId,
    featureVolume: configuration.featureVolume,
    masterVolume: configuration.masterVolume,
    effectiveVolume: configuration.effectiveVolume,
  };
  return accept(
    {
      ...previous,
      attemptSequenceByCycle: {
        ...previous.attemptSequenceByCycle,
        [decision.cycleId]: sequence,
      },
      activePlaybackAttempt: attempt,
      latestPlaybackAttempt: attempt,
    },
    attempt,
  );
}

export function transitionHuntStallIncidentPlayback({
  previous,
  attemptId,
  status,
  occurredAt,
  error = null,
}: {
  previous: HuntStallIncidentBoundaryState;
  attemptId: string;
  status: "started" | "finished" | "failed";
  occurredAt: number;
  error?: string | null;
}): HuntStallIncidentBoundaryResult<HuntStallIncidentPlaybackAttempt> {
  const attempt = previous.activePlaybackAttempt;
  if (!attempt || attempt.id !== attemptId) {
    return reject(previous, "stale-playback-attempt");
  }
  if (!isValidPlaybackTransition(attempt.status, status)) {
    return reject(previous, "invalid-playback-transition");
  }

  const nextAttempt: HuntStallIncidentPlaybackAttempt = {
    ...attempt,
    status,
    startedAt: status === "started" ? occurredAt : attempt.startedAt,
    finishedAt: status === "finished" ? occurredAt : attempt.finishedAt,
    failedAt: status === "failed" ? occurredAt : attempt.failedAt,
    error: status === "failed" ? error : attempt.error,
  };
  const isTerminal = status === "finished" || status === "failed";
  return accept(
    {
      ...previous,
      activePlaybackAttempt: isTerminal ? null : nextAttempt,
      latestPlaybackAttempt: nextAttempt,
    },
    nextAttempt,
  );
}

export function freezeHuntStallIncidentBoundary({
  previous,
  frozenAt,
}: {
  previous: HuntStallIncidentBoundaryState;
  frozenAt: number;
}): {
  state: HuntStallIncidentBoundaryState;
  lease: HuntStallIncidentReportLease;
} {
  const sequence = previous.leaseSequence + 1;
  const continuity = previous.resetEpoch.continuity;
  const lease: HuntStallIncidentReportLease = {
    id: createHuntStallIncidentReportLeaseId(previous.sessionId, sequence),
    resetEpochId: previous.resetEpoch.id,
    configRevisionId: previous.configurationRevision.id,
    sequence,
    frozenAt,
    leasedThroughFrameSequence: previous.frameSequence,
    mode: continuity.mode,
    layoutKey: continuity.layoutKey,
    regionRevision: continuity.regionRevision,
    activityEpochId: previous.activeActivityEpoch?.id ?? null,
    stallEpisodeId: previous.activeStallEpisode?.id ?? null,
    alertCycleId: previous.activeAlertCycle?.id ?? null,
    playbackAttemptId: previous.latestPlaybackAttempt?.id ?? null,
  };
  return {
    state: { ...previous, leaseSequence: sequence },
    lease,
  };
}

export function isHuntStallIncidentFrameWithinLease(
  lease: HuntStallIncidentReportLease,
  frame: HuntStallIncidentFrame,
): boolean {
  return (
    frame.resetEpochId === lease.resetEpochId &&
    frame.sequence <= lease.leasedThroughFrameSequence &&
    frame.sampledAt <= lease.frozenAt &&
    frame.mode === lease.mode &&
    frame.layoutKey === lease.layoutKey &&
    frame.regionRevision === lease.regionRevision
  );
}

export function getHuntStallIncidentContinuityResetReason(
  previous: HuntStallIncidentContinuity,
  next: HuntStallIncidentContinuity,
): Exclude<HuntStallIncidentResetReason, "initialized"> | null {
  if (previous.captureGeneration !== next.captureGeneration) {
    return "stream-replaced";
  }
  if (previous.mode !== next.mode) {
    return "mode-changed";
  }
  if (previous.layoutKey !== next.layoutKey) {
    return "layout-changed";
  }
  if (previous.regionRevision !== next.regionRevision) {
    return "region-changed";
  }
  if (previous.workerGeneration !== next.workerGeneration) {
    return "worker-reset";
  }
  if (previous.featureGeneration !== next.featureGeneration) {
    return "profile-replaced";
  }
  return null;
}

function validateCurrentObservation(
  state: HuntStallIncidentBoundaryState,
  frame: HuntStallIncidentFrame,
  observation: HuntStallIncidentObservation,
): HuntStallIncidentBoundaryRejectReason | null {
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
  if (
    frame.mode !== state.resetEpoch.continuity.mode ||
    observation.mode !== state.resetEpoch.continuity.mode
  ) {
    return "stale-reset-epoch";
  }
  return null;
}

function closeActiveBoundary(
  state: HuntStallIncidentBoundaryState,
  occurredAt: number,
  terminalReason: HuntStallIncidentTerminalReason,
): HuntStallIncidentClosedBoundary {
  return {
    activityEpoch: state.activeActivityEpoch
      ? {
          ...state.activeActivityEpoch,
          endedAt: occurredAt,
          terminalReason,
        }
      : null,
    stallEpisode: state.activeStallEpisode
      ? {
          ...state.activeStallEpisode,
          status: "terminal",
          endedAt: occurredAt,
          terminalReason,
        }
      : null,
    alertCycle: state.activeAlertCycle
      ? {
          ...state.activeAlertCycle,
          status: "terminal",
          endedAt: occurredAt,
          terminalReason,
        }
      : null,
    playbackAttempt: state.activePlaybackAttempt ?? null,
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
  continuity: HuntStallIncidentContinuity;
  now: number;
  reason: HuntStallIncidentResetReason;
}): HuntStallIncidentResetEpoch {
  return {
    id: createHuntStallIncidentResetEpochId(sessionId, sequence),
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
  configuration: HuntStallIncidentConfiguration;
  now: number;
}): HuntStallIncidentConfigurationRevision {
  const values = { ...configuration };
  return {
    id: createHuntStallIncidentConfigurationRevisionId(
      resetEpochId,
      sequence,
    ),
    resetEpochId,
    sequence,
    capturedAt: now,
    fingerprint: fingerprintConfiguration(values),
    values,
  };
}

function fingerprintConfiguration(
  configuration: HuntStallIncidentConfiguration,
): string {
  const canonical = stableStringify(configuration);
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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

function assertConfigurationMode(
  continuity: HuntStallIncidentContinuity,
  configuration: HuntStallIncidentConfiguration,
): void {
  if (continuity.mode !== configuration.mode) {
    throw new Error("hunt-stall-incident-configuration-mode-mismatch");
  }
}

function isActivityReasonForMode(
  reason: HuntStallIncidentActivityReason,
  mode: HuntStallIncidentContinuity["mode"],
): boolean {
  if (mode === "manual-experience") {
    return reason === "manual-progress-confirmed";
  }
  return reason !== "manual-progress-confirmed";
}

function isValidPlaybackTransition(
  previous: HuntStallIncidentPlaybackAttempt["status"],
  next: "started" | "finished" | "failed",
): boolean {
  if (previous === "requested") {
    return next === "started" || next === "failed";
  }
  return previous === "started" && (next === "finished" || next === "failed");
}

function accept<T>(
  state: HuntStallIncidentBoundaryState,
  value: T,
): HuntStallIncidentBoundaryResult<T> {
  return { accepted: true, state, value };
}

function reject<T>(
  state: HuntStallIncidentBoundaryState,
  reason: HuntStallIncidentBoundaryRejectReason,
): HuntStallIncidentBoundaryResult<T> {
  return { accepted: false, state, reason };
}
