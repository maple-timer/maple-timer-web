export const BOOSTER_EXPIRY_INCIDENT_BOUNDARY_SCHEMA_VERSION =
  "booster-expiry-incident-boundary-v1" as const;
export const BOOSTER_EXPIRY_INCIDENT_EVIDENCE_SCHEMA_VERSION =
  "booster-expiry-incident-evidence-v1" as const;

export const BOOSTER_EXPIRY_INCIDENT_MIN_REMAINING_SECONDS = 60;
export const BOOSTER_EXPIRY_INCIDENT_CONFIRMATION_OBSERVATIONS = 6;
export const BOOSTER_EXPIRY_INCIDENT_CONFIRMATION_SPAN_MS = 5_000;
export const BOOSTER_EXPIRY_INCIDENT_CONFIRMATION_DECREASE_SECONDS = 4;
export const BOOSTER_EXPIRY_INCIDENT_EXPIRES_TOLERANCE_MS = 2_500;
export const BOOSTER_EXPIRY_INCIDENT_EXPIRES_SPREAD_MS = 3_000;
export const BOOSTER_EXPIRY_INCIDENT_MAX_OBSERVATION_GAP_MS = 12_000;
export const BOOSTER_EXPIRY_INCIDENT_NEW_CYCLE_EXTENSION_MS = 5_000;
export const BOOSTER_EXPIRY_INCIDENT_SUPPORT_TOLERANCE_MS = 3_500;
export const BOOSTER_EXPIRY_INCIDENT_CONTRADICTION_TOLERANCE_MS = 8_000;
export const BOOSTER_EXPIRY_INCIDENT_CONTRADICTION_LIMIT = 2;
export const BOOSTER_EXPIRY_INCIDENT_MAX_UNSUPPORTED_MS = 20_000;

export type BoosterExpiryIncidentResetReason =
  | "initialized"
  | "disabled"
  | "enabled"
  | "stream-replaced"
  | "layout-changed"
  | "source-geometry-changed"
  | "monitoring-generation-changed"
  | "profile-replaced"
  | "preset-replaced"
  | "global-disabled"
  | "manual-reset";

export type BoosterExpiryIncidentFlowRestartReason =
  | "initialized"
  | "worker-reset"
  | "worker-timeout"
  | "worker-runtime-failed"
  | "worker-recovered";

export type BoosterExpiryIncidentContinuity = {
  captureGeneration: number;
  featureGeneration: number;
  monitoringGeneration: number;
  layoutKey: string;
  sourceGeometryRevision: string;
};

export type BoosterExpiryIncidentConfiguration = {
  enabled: boolean;
  alertLeadSeconds: number;
  soundId: string;
  featureVolume: number;
  masterVolume: number;
  effectiveVolume: number;
};

export type BoosterExpiryIncidentResetEpoch = {
  id: string;
  sessionId: string;
  sequence: number;
  startedAt: number;
  reason: BoosterExpiryIncidentResetReason;
  continuity: BoosterExpiryIncidentContinuity;
};

export type BoosterExpiryIncidentConfigurationRevision = {
  id: string;
  resetEpochId: string;
  sequence: number;
  capturedAt: number;
  fingerprint: string;
  timingFingerprint: string;
  playbackFingerprint: string;
  values: BoosterExpiryIncidentConfiguration;
};

export type BoosterExpiryIncidentFlowEpoch = {
  id: string;
  resetEpochId: string;
  sequence: number;
  workerGeneration: number;
  startedAt: number;
  reason: BoosterExpiryIncidentFlowRestartReason;
};

export type BoosterExpiryIncidentRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BoosterExpiryIncidentSourceDimensions = {
  width: number;
  height: number;
};

export type BoosterExpiryIncidentFrameSource = {
  kind: "normal-monitoring-top-quarter" | "runtime-error";
  coordinateSpace: "capture-pixels" | "game-viewport-pixels";
  sourceDimensions: BoosterExpiryIncidentSourceDimensions;
  captureDimensions?: BoosterExpiryIncidentSourceDimensions;
  sourceRegion?: BoosterExpiryIncidentRegion;
  sampledRegion: BoosterExpiryIncidentRegion;
  maxCaptureWidth: number;
  regionLabel: string;
};

export type BoosterExpiryIncidentRuntimeFailure = {
  stage:
    | "capture"
    | "worker-create"
    | "worker-post"
    | "worker-timeout"
    | "worker-runtime"
    | "recognition"
    | "state-transition"
    | "unknown";
  code: string;
  technicalMessage: string | null;
};

export type BoosterExpiryIncidentFrame = {
  id: string;
  resetEpochId: string;
  flowEpochId: string;
  configRevisionId: string;
  sequence: number;
  sampledAt: number;
  layoutKey: string;
  sourceGeometryRevision: string;
  source: BoosterExpiryIncidentFrameSource | null;
  runtimeFailure: BoosterExpiryIncidentRuntimeFailure | null;
  mediaFrameId: string | null;
};

export type BoosterExpiryIncidentTimerRead = {
  ok: boolean;
  reason: string;
  text: string | null;
  seconds: number | null;
  format: string | null;
  selectedBy: string | null;
  rect: BoosterExpiryIncidentRegion | null;
  digitCount: number;
};

export type BoosterExpiryIncidentFlowSnapshot = {
  locked: boolean;
  source: string;
  predictedSeconds: number | null;
  rawDeltaSeconds: number | null;
};

export type BoosterExpiryIncidentObservationDecision =
  "accepted" | "rejected" | "missing" | "error";

export type BoosterExpiryIncidentRuntimeStateSnapshot = {
  capturedAt: number;
  status: string;
  decision: string;
  rawRemainingSeconds: number | null;
  remainingSeconds: number | null;
  candidateObservationCount: number;
  confirmedExpiresAt: number | null;
  alertAt: number | null;
  alertedAt: number | null;
  flowSource: string | null;
  locked: boolean;
};

export type BoosterExpiryIncidentObservation = {
  id: string;
  resetEpochId: string;
  flowEpochId: string;
  frameId: string;
  frameSequence: number;
  configRevisionId: string;
  sampledAt: number;
  decision: BoosterExpiryIncidentObservationDecision;
  reason: string | null;
  recognizerVersion: string | null;
  rawTime: BoosterExpiryIncidentTimerRead | null;
  selectedTime: BoosterExpiryIncidentTimerRead | null;
  timerRect: BoosterExpiryIncidentRegion | null;
  timerCandidateCount: number;
  timerMatchCount: number;
  flow: BoosterExpiryIncidentFlowSnapshot | null;
  strongForConfirmation: boolean;
  observedExpiresAt: number | null;
  recognitionMs: number | null;
  totalMs: number | null;
  stateBefore: BoosterExpiryIncidentRuntimeStateSnapshot | null;
  stateAfter: BoosterExpiryIncidentRuntimeStateSnapshot | null;
};

export type BoosterExpiryIncidentCandidateAttempt = {
  id: string;
  resetEpochId: string;
  flowEpochId: string;
  sequence: number;
  startedAt: number;
  lastObservedAt: number;
  observationIds: string[];
  firstRemainingSeconds: number;
  lastRemainingSeconds: number;
  expiresAt: number;
  expiresAtMin: number;
  expiresAtMax: number;
  status:
    | "collecting"
    | "confirmed"
    | "expired"
    | "replaced"
    | "rejected"
    | "terminal";
  confirmedCycleId: string | null;
  endedAt: number | null;
  terminalReason:
    | "confirmed"
    | "window-expired"
    | "incompatible-expiry"
    | "flow-restarted"
    | "reset-epoch"
    | "not-new-cycle"
    | null;
};

export type BoosterExpiryIncidentConfirmedCycle = {
  id: string;
  resetEpochId: string;
  sequence: number;
  candidateAttemptId: string;
  confirmationFlowEpochId: string;
  observationIds: string[];
  confirmedAt: number;
  expiresAt: number;
  timingConfigRevisionId: string;
  lastSupportedAt: number;
  contradictionCount: number;
  status: "active" | "alerted" | "cancelled" | "replaced" | "terminal";
  endedAt: number | null;
  terminalReason:
    | "unsupported-too-long"
    | "contradicted"
    | "next-cycle"
    | "reset-epoch"
    | null;
};

export type BoosterExpiryIncidentScheduleReason =
  "cycle-confirmed" | "configuration-retimed" | "browser-rescheduled";

export type BoosterExpiryIncidentSchedule = {
  id: string;
  resetEpochId: string;
  cycleId: string;
  sequence: number;
  reason: BoosterExpiryIncidentScheduleReason;
  registeredAt: number;
  alertDueAt: number;
  confirmedExpiresAt: number;
  timingConfigRevisionId: string;
  status: "registered" | "replaced" | "cancelled" | "suppressed" | "fired";
  endedAt: number | null;
  outcomeReason: string | null;
};

export type BoosterExpiryIncidentAlertDecision = {
  id: string;
  resetEpochId: string;
  cycleId: string;
  scheduleId: string;
  sequence: number;
  occurredAt: number;
  dueAt: number;
  schedulerDelayMs: number;
  timingConfigRevisionId: string;
  firedConfigRevisionId: string;
};

export type BoosterExpiryIncidentPlaybackAttempt = {
  id: string;
  resetEpochId: string;
  cycleId: string;
  scheduleId: string;
  decisionId: string;
  sequence: number;
  requestedAt: number;
  browserAcceptedAt: number | null;
  finishedAt: number | null;
  failedAt: number | null;
  status: "requested" | "browser-play-accepted" | "finished" | "failed";
  error: string | null;
  configRevisionId: string;
  soundId: string;
  featureVolume: number;
  masterVolume: number;
  effectiveVolume: number;
};

export type BoosterExpiryIncidentReportLease = {
  id: string;
  resetEpochId: string;
  flowEpochId: string;
  configRevisionId: string;
  sequence: number;
  frozenAt: number;
  leasedThroughFrameSequence: number;
  layoutKey: string;
  sourceGeometryRevision: string;
  candidateAttemptId: string | null;
  cycleId: string | null;
  scheduleId: string | null;
  decisionId: string | null;
  playbackAttemptId: string | null;
};

export type BoosterExpiryIncidentClosedBoundary = {
  candidateAttempt: BoosterExpiryIncidentCandidateAttempt | null;
  cycle: BoosterExpiryIncidentConfirmedCycle | null;
  schedule: BoosterExpiryIncidentSchedule | null;
  playbackAttempt: BoosterExpiryIncidentPlaybackAttempt | null;
};

export type BoosterExpiryIncidentLifecycleEvent = {
  id: string;
  resetEpochId: string;
  occurredAt: number;
  category:
    | "lifecycle"
    | "configuration"
    | "worker-flow"
    | "recognition"
    | "confirmation"
    | "cycle"
    | "schedule"
    | "decision"
    | "playback"
    | "presentation"
    | "interaction"
    | "runtime-error";
  action: string;
  configRevisionId: string | null;
  flowEpochId: string | null;
  frameId: string | null;
  observationId: string | null;
  candidateAttemptId: string | null;
  cycleId: string | null;
  scheduleId: string | null;
  decisionId: string | null;
  playbackAttemptId: string | null;
  details: Record<string, unknown>;
};

export type BoosterExpiryIncidentMediaReason =
  | "playback-failed"
  | "alert-decision"
  | "cycle-confirmation"
  | "runtime-error"
  | "rejected-observation"
  | "current"
  | "periodic";

export type BoosterExpiryIncidentMediaFrame = {
  id: string;
  frameId: string;
  resetEpochId: string;
  sampledAt: number;
  reason: BoosterExpiryIncidentMediaReason;
  imageDataUrl: string;
};

export type BoosterExpiryIncidentEvidenceOmissionReason =
  | "never-produced"
  | "outside-retention"
  | "reset-epoch"
  | "metadata-cap"
  | "media-budget"
  | "media-oversize"
  | "payload-compacted"
  | "asset-persist-failed"
  | "asset-missing"
  | "ambiguous-incident";

export type BoosterExpiryIncidentEvidenceOmission = {
  id: string;
  occurredAt: number;
  kind:
    | "reset-epoch"
    | "configuration"
    | "flow-epoch"
    | "frame"
    | "observation"
    | "candidate-attempt"
    | "cycle"
    | "schedule"
    | "decision"
    | "playback-attempt"
    | "event"
    | "media"
    | "asset";
  reason: BoosterExpiryIncidentEvidenceOmissionReason;
  subjectIds: string[];
  count: number;
};

export type BoosterExpiryIncidentEvidencePointers = {
  currentResetEpochId: string | null;
  currentConfigurationRevisionId: string | null;
  currentFlowEpochId: string | null;
  latestFrameId: string | null;
  latestObservationId: string | null;
  activeCandidateAttemptId: string | null;
  activeCycleId: string | null;
  activeScheduleId: string | null;
  activeDecisionId: string | null;
  activePlaybackAttemptId: string | null;
};

export type BoosterExpiryIncidentEvidenceArchive = {
  schemaVersion: typeof BOOSTER_EXPIRY_INCIDENT_EVIDENCE_SCHEMA_VERSION;
  updatedAt: number;
  pointers: BoosterExpiryIncidentEvidencePointers;
  resetEpochs: BoosterExpiryIncidentResetEpoch[];
  configurationRevisions: BoosterExpiryIncidentConfigurationRevision[];
  flowEpochs: BoosterExpiryIncidentFlowEpoch[];
  frames: BoosterExpiryIncidentFrame[];
  observations: BoosterExpiryIncidentObservation[];
  candidateAttempts: BoosterExpiryIncidentCandidateAttempt[];
  cycles: BoosterExpiryIncidentConfirmedCycle[];
  schedules: BoosterExpiryIncidentSchedule[];
  decisions: BoosterExpiryIncidentAlertDecision[];
  playbackAttempts: BoosterExpiryIncidentPlaybackAttempt[];
  lifecycleEvents: BoosterExpiryIncidentLifecycleEvent[];
  media: BoosterExpiryIncidentMediaFrame[];
  omissions: BoosterExpiryIncidentEvidenceOmission[];
};

export type BoosterExpiryIncidentFrozenState = {
  capturedAt: number;
  resetEpochId: string;
  flowEpochId: string;
  configRevisionId: string;
  enabled: boolean;
  status: string;
  decision: string;
  presentationRevision: string | null;
  latestFrameId: string | null;
  latestObservationId: string | null;
  candidateAttemptId: string | null;
  cycleId: string | null;
  scheduleId: string | null;
  decisionId: string | null;
  playbackAttemptId: string | null;
};

export type BoosterExpiryIncidentRelatedPlayback = {
  id: string;
  feature: string;
  requestedAt: number;
  browserAcceptedAt: number | null;
  finishedAt: number | null;
  failedAt: number | null;
  status: "requested" | "browser-play-accepted" | "finished" | "failed";
};

export type FrozenBoosterExpiryIncidentEvidence =
  BoosterExpiryIncidentEvidenceArchive & {
    frozenAt: number;
    leaseId: string;
    lease: BoosterExpiryIncidentReportLease;
    frozenState: BoosterExpiryIncidentFrozenState | null;
    relatedPlayback: BoosterExpiryIncidentRelatedPlayback[];
  };

export type BoosterExpiryIncidentSelectionDegradationReason =
  | BoosterExpiryIncidentEvidenceOmissionReason
  | "legacy-unavailable"
  | "report-time-only"
  | "not-applicable"
  | "physical-audibility-unknown"
  | "sequence-incomplete"
  | "selected-media-missing";

export type BoosterExpiryIncidentBoundaryState = {
  schemaVersion: typeof BOOSTER_EXPIRY_INCIDENT_BOUNDARY_SCHEMA_VERSION;
  sessionId: string;
  resetSequence: number;
  configurationSequence: number;
  flowSequence: number;
  frameSequence: number;
  candidateSequence: number;
  cycleSequence: number;
  scheduleSequenceByCycle: Record<string, number>;
  decisionSequenceByCycle: Record<string, number>;
  playbackSequenceByCycle: Record<string, number>;
  leaseSequence: number;
  resetEpoch: BoosterExpiryIncidentResetEpoch;
  configurationRevision: BoosterExpiryIncidentConfigurationRevision;
  flowEpoch: BoosterExpiryIncidentFlowEpoch;
  latestFrame: BoosterExpiryIncidentFrame | null;
  latestObservation: BoosterExpiryIncidentObservation | null;
  activeCandidateAttempt: BoosterExpiryIncidentCandidateAttempt | null;
  activeCycle: BoosterExpiryIncidentConfirmedCycle | null;
  activeSchedule: BoosterExpiryIncidentSchedule | null;
  latestSchedule: BoosterExpiryIncidentSchedule | null;
  latestDecision: BoosterExpiryIncidentAlertDecision | null;
  activePlaybackAttempt: BoosterExpiryIncidentPlaybackAttempt | null;
  latestPlaybackAttempt: BoosterExpiryIncidentPlaybackAttempt | null;
};

export type BoosterExpiryIncidentBoundaryRejectReason =
  | "feature-disabled"
  | "continuity-reset-required"
  | "stale-reset-epoch"
  | "stale-flow-epoch"
  | "stale-frame"
  | "non-monotonic-frame"
  | "observation-frame-mismatch"
  | "observation-not-accepted"
  | "observation-not-strong"
  | "remaining-below-confirmation-floor"
  | "duplicate-candidate-observation"
  | "no-active-cycle"
  | "stale-cycle"
  | "schedule-already-registered"
  | "stale-schedule"
  | "schedule-timing-revised"
  | "schedule-not-due"
  | "stale-alert-decision"
  | "playback-in-flight"
  | "decision-playback-already-requested"
  | "stale-playback-attempt"
  | "invalid-playback-transition";

export type BoosterExpiryIncidentBoundaryResult<T> =
  | { accepted: true; state: BoosterExpiryIncidentBoundaryState; value: T }
  | {
      accepted: false;
      state: BoosterExpiryIncidentBoundaryState;
      reason: BoosterExpiryIncidentBoundaryRejectReason;
    };

export function createBoosterExpiryIncidentResetEpochId(
  sessionId: string,
  sequence: number,
): string {
  return `booster-expiry-reset:${sessionId}:${sequence}`;
}

export function createBoosterExpiryIncidentConfigurationRevisionId(
  resetEpochId: string,
  sequence: number,
): string {
  return `booster-expiry-config:${resetEpochId}:${sequence}`;
}

export function createBoosterExpiryIncidentFlowEpochId(
  resetEpochId: string,
  sequence: number,
): string {
  return `booster-expiry-flow:${resetEpochId}:${sequence}`;
}

export function createBoosterExpiryIncidentFrameId(
  resetEpochId: string,
  sequence: number,
): string {
  return `booster-expiry-frame:${resetEpochId}:${sequence}`;
}

export function createBoosterExpiryIncidentObservationId(
  frameId: string,
): string {
  return `booster-expiry-observation:${frameId}`;
}

export function createBoosterExpiryIncidentCandidateAttemptId(
  resetEpochId: string,
  sequence: number,
): string {
  return `booster-expiry-candidate:${resetEpochId}:${sequence}`;
}

export function createBoosterExpiryIncidentCycleId(
  resetEpochId: string,
  sequence: number,
): string {
  return `booster-expiry-cycle:${resetEpochId}:${sequence}`;
}

export function createBoosterExpiryIncidentScheduleId(
  cycleId: string,
  sequence: number,
): string {
  return `booster-expiry-schedule:${cycleId}:${sequence}`;
}

export function createBoosterExpiryIncidentAlertDecisionId(
  cycleId: string,
  sequence: number,
): string {
  return `booster-expiry-decision:${cycleId}:${sequence}`;
}

export function createBoosterExpiryIncidentPlaybackAttemptId(
  cycleId: string,
  sequence: number,
): string {
  return `booster-expiry-playback:${cycleId}:${sequence}`;
}

export function createBoosterExpiryIncidentReportLeaseId(
  sessionId: string,
  sequence: number,
): string {
  return `booster-expiry-lease:${sessionId}:${sequence}`;
}
