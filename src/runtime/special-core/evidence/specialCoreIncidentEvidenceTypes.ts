export const SPECIAL_CORE_INCIDENT_BOUNDARY_SCHEMA_VERSION =
  "special-core-incident-boundary-v1" as const;
export const SPECIAL_CORE_INCIDENT_EVIDENCE_SCHEMA_VERSION =
  "special-core-incident-evidence-v1" as const;

export const SPECIAL_CORE_INCIDENT_CONFIRM_WINDOW_MS = 3_000;
export const SPECIAL_CORE_INCIDENT_EPISODE_ABSENT_MS = 5_000;
export const SPECIAL_CORE_INCIDENT_REACQUIRE_EARLY_MS = 4_000;
export const SPECIAL_CORE_INCIDENT_REACQUIRE_MIN_AGE_MS = 10_000;

export type SpecialCoreIncidentResetReason =
  | "initialized"
  | "disabled"
  | "enabled"
  | "stream-replaced"
  | "layout-changed"
  | "source-geometry-changed"
  | "parser-runtime-changed"
  | "matcher-worker-reset"
  | "profile-replaced"
  | "preset-replaced"
  | "global-disabled";

export type SpecialCoreIncidentContinuity = {
  captureGeneration: number;
  featureGeneration: number;
  parserRuntimeGeneration: string;
  matcherWorkerGeneration: number;
  layoutKey: string;
  sourceGeometryRevision: string;
};

export type SpecialCoreIncidentConfiguration = {
  enabled: boolean;
  cooldownSeconds: number;
  alertLeadSeconds: number;
  soundId: string;
  featureVolume: number;
  masterVolume: number;
  effectiveVolume: number;
};

export type SpecialCoreIncidentResetEpoch = {
  id: string;
  sessionId: string;
  sequence: number;
  startedAt: number;
  reason: SpecialCoreIncidentResetReason;
  continuity: SpecialCoreIncidentContinuity;
};

export type SpecialCoreIncidentConfigurationRevision = {
  id: string;
  resetEpochId: string;
  sequence: number;
  capturedAt: number;
  fingerprint: string;
  timingFingerprint: string;
  values: SpecialCoreIncidentConfiguration;
};

export type SpecialCoreIncidentRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SpecialCoreIncidentSourceDimensions = {
  width: number;
  height: number;
};

export type SpecialCoreIncidentFrameSource = {
  kind: "normal-shared-parser" | "normal-direct-parser" | "runtime-error";
  parserInputMode: "fullFrame" | "topRightQuadrant" | "croppedRoi" | null;
  coordinateSpace:
    | "capture-pixels"
    | "game-viewport-pixels"
    | null;
  sourceDimensions: SpecialCoreIncidentSourceDimensions | null;
  captureDimensions?: SpecialCoreIncidentSourceDimensions | null;
  sourceRegion?: SpecialCoreIncidentRegion | null;
  parserInputRegion: SpecialCoreIncidentRegion | null;
  storedMediaKind: "buff-slot-top-right-quadrant-v1" | "candidate-icon-v1" | null;
  storedMediaRegion: SpecialCoreIncidentRegion | null;
  regionLabel: string | null;
};

export type SpecialCoreIncidentParserRuntime = {
  recognitionEngine: string;
  parserVersion: string;
  modelId: string;
  modelInputWidth: number;
  modelInputHeight: number;
  onnxRuntimeVersion: string;
  executionProvider: string;
  selectionSource: string;
  wasmThreads: number | null;
};

export type SpecialCoreIncidentParser = {
  engine: "rule" | "dl" | null;
  version: string | null;
  fallbackReason: string | null;
  runtime: SpecialCoreIncidentParserRuntime | null;
};

export type SpecialCoreIncidentBox = {
  x: number;
  y: number;
  size: number;
  confidence: number;
  score: number;
};

export type SpecialCoreIncidentRowGroup = {
  rowIndex: number;
  y: number;
  size: number;
  boxIndexes: number[];
  eligible: boolean;
};

export type SpecialCoreIncidentFrameTimings = {
  totalMs: number;
  detectMs: number;
  matchMs: number;
  sharedParserTotalMs: number | null;
  sharedParserDetectMs: number | null;
  resultAgeMs: number | null;
  droppedSampleCount: number | null;
};

export type SpecialCoreIncidentRuntimeFailure = {
  stage:
    | "capture"
    | "shared-parser"
    | "matcher-worker"
    | "state-transition"
    | "unknown";
  code: string;
  technicalMessage: string | null;
  details: Record<string, string | number | boolean | null>;
};

export type SpecialCoreIncidentFrame = {
  id: string;
  resetEpochId: string;
  configRevisionId: string;
  sequence: number;
  sampledAt: number;
  layoutKey: string;
  sourceGeometryRevision: string;
  source: SpecialCoreIncidentFrameSource | null;
  parser: SpecialCoreIncidentParser | null;
  parsedBoxes: SpecialCoreIncidentBox[];
  rowGroups: SpecialCoreIncidentRowGroup[];
  eligibleBoxIndexes: number[];
  timings: SpecialCoreIncidentFrameTimings | null;
  runtimeFailure: SpecialCoreIncidentRuntimeFailure | null;
  mediaFrameId: string | null;
};

export type SpecialCoreIncidentObservationDecision =
  | "accepted"
  | "rejected"
  | "missing"
  | "error";

export type SpecialCoreIncidentMatcherEvidence = {
  matched: boolean;
  targetId: string | null;
  bundleId: string;
  modelId: string;
  modelVersion: string;
  variantId: string;
  gateVersion: number;
  score: number;
  threshold: number;
  margin: number;
  gateScore: number;
  gateThreshold: number;
  gateMargin: number;
  rescueThreshold: number;
  rescueMargin: number;
  basePassed: boolean;
  positiveGatePassed: boolean;
  primaryPassed: boolean;
  rescuePassed: boolean;
  decisionReason: string;
  elapsedMs: number;
};

export type SpecialCoreIncidentCandidate = {
  boxIndex: number;
  box: SpecialCoreIncidentBox;
  match: SpecialCoreIncidentMatcherEvidence;
};

export type SpecialCoreIncidentRuntimeStateSnapshot = {
  capturedAt: number;
  status: string;
  unsupportedReason: string | null;
  boxCount: number;
  detectedCount: number;
  pendingConfirmationCount: number;
  runtimeActivationId: number;
  activationStartedAt: number | null;
  activationConfirmedAt: number | null;
  activationLastSeenAt: number | null;
  cooldownEndsAt: number | null;
  alertDueAt: number | null;
  alertedAt: number | null;
  lastAlertedAt: number | null;
  playbackStatus: string | null;
  playbackRequestedAt: number | null;
};

export type SpecialCoreIncidentObservation = {
  id: string;
  resetEpochId: string;
  frameId: string;
  frameSequence: number;
  configRevisionId: string;
  sampledAt: number;
  decision: SpecialCoreIncidentObservationDecision;
  reason: string | null;
  candidates: SpecialCoreIncidentCandidate[];
  selectedCandidateBoxIndex: number | null;
  stateBefore: SpecialCoreIncidentRuntimeStateSnapshot | null;
  stateAfter: SpecialCoreIncidentRuntimeStateSnapshot | null;
};

export type SpecialCoreIncidentConfirmationKind =
  | "new-activation"
  | "cooldown-reacquire";

export type SpecialCoreIncidentConfirmationAttempt = {
  id: string;
  resetEpochId: string;
  sequence: number;
  kind: SpecialCoreIncidentConfirmationKind;
  startedAt: number;
  lastObservedAt: number;
  observationIds: string[];
  status: "collecting" | "confirmed" | "expired" | "terminal";
  activationId: string | null;
  endedAt: number | null;
  terminalReason:
    | "confirmed"
    | "window-expired"
    | "reset-epoch"
    | "activation-replaced"
    | null;
};

export type SpecialCoreIncidentActivation = {
  id: string;
  resetEpochId: string;
  sequence: number;
  runtimeActivationId: number | null;
  confirmationAttemptId: string;
  confirmationKind: SpecialCoreIncidentConfirmationKind;
  observationIds: string[];
  startedAt: number;
  confirmedAt: number;
  lastSeenAt: number;
  timingConfigRevisionId: string;
  cooldownEndsAt: number;
  alertDueAt: number;
  status: "active" | "terminal";
  endedAt: number | null;
  terminalReason:
    | "next-activation"
    | "cooldown-reacquired"
    | "reset-epoch"
    | null;
};

export type SpecialCoreIncidentScheduleReason =
  | "activation-confirmed"
  | "configuration-retimed"
  | "browser-rescheduled";

export type SpecialCoreIncidentSchedule = {
  id: string;
  resetEpochId: string;
  activationId: string;
  sequence: number;
  reason: SpecialCoreIncidentScheduleReason;
  registeredAt: number;
  alertDueAt: number;
  timingConfigRevisionId: string;
  status:
    | "registered"
    | "replaced"
    | "cancelled"
    | "suppressed"
    | "fired";
  endedAt: number | null;
  outcomeReason: string | null;
};

export type SpecialCoreIncidentAlertDecision = {
  id: string;
  resetEpochId: string;
  activationId: string;
  scheduleId: string;
  sequence: number;
  occurredAt: number;
  dueAt: number;
  schedulerDelayMs: number;
  timingConfigRevisionId: string;
  firedConfigRevisionId: string;
};

export type SpecialCoreIncidentPlaybackAttempt = {
  id: string;
  resetEpochId: string;
  activationId: string;
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
  startOffsetSeconds: number;
};

export type SpecialCoreIncidentReportLease = {
  id: string;
  resetEpochId: string;
  configRevisionId: string;
  sequence: number;
  frozenAt: number;
  leasedThroughFrameSequence: number;
  layoutKey: string;
  sourceGeometryRevision: string;
  confirmationAttemptId: string | null;
  activationId: string | null;
  scheduleId: string | null;
  decisionId: string | null;
  playbackAttemptId: string | null;
};

export type SpecialCoreIncidentLifecycleEvent = {
  id: string;
  resetEpochId: string;
  occurredAt: number;
  category:
    | "lifecycle"
    | "configuration"
    | "recognition"
    | "confirmation"
    | "activation"
    | "schedule"
    | "decision"
    | "playback"
    | "presentation"
    | "interaction"
    | "runtime-error";
  action: string;
  configRevisionId: string | null;
  frameId: string | null;
  observationId: string | null;
  confirmationAttemptId: string | null;
  activationId: string | null;
  scheduleId: string | null;
  decisionId: string | null;
  playbackAttemptId: string | null;
  details: Record<string, unknown>;
};

export type SpecialCoreIncidentMediaReason =
  | "playback-failed"
  | "alert-decision"
  | "activation-confirmation"
  | "runtime-error"
  | "rejected-observation"
  | "current"
  | "periodic";

export type SpecialCoreIncidentMediaFrame = {
  id: string;
  frameId: string;
  resetEpochId: string;
  sampledAt: number;
  reason: SpecialCoreIncidentMediaReason;
  imageDataUrl: string;
};

export type SpecialCoreIncidentEvidenceOmissionReason =
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

export type SpecialCoreIncidentEvidenceOmission = {
  id: string;
  occurredAt: number;
  kind:
    | "reset-epoch"
    | "configuration"
    | "frame"
    | "observation"
    | "confirmation-attempt"
    | "activation"
    | "schedule"
    | "decision"
    | "playback-attempt"
    | "event"
    | "media"
    | "asset";
  reason: SpecialCoreIncidentEvidenceOmissionReason;
  subjectIds: string[];
  count: number;
};

export type SpecialCoreIncidentEvidencePointers = {
  currentResetEpochId: string | null;
  currentConfigurationRevisionId: string | null;
  latestFrameId: string | null;
  latestObservationId: string | null;
  activeConfirmationAttemptId: string | null;
  activeActivationId: string | null;
  activeScheduleId: string | null;
  activeDecisionId: string | null;
  activePlaybackAttemptId: string | null;
};

export type SpecialCoreIncidentEvidenceArchive = {
  schemaVersion: typeof SPECIAL_CORE_INCIDENT_EVIDENCE_SCHEMA_VERSION;
  updatedAt: number;
  pointers: SpecialCoreIncidentEvidencePointers;
  resetEpochs: SpecialCoreIncidentResetEpoch[];
  configurationRevisions: SpecialCoreIncidentConfigurationRevision[];
  frames: SpecialCoreIncidentFrame[];
  observations: SpecialCoreIncidentObservation[];
  confirmationAttempts: SpecialCoreIncidentConfirmationAttempt[];
  activations: SpecialCoreIncidentActivation[];
  schedules: SpecialCoreIncidentSchedule[];
  decisions: SpecialCoreIncidentAlertDecision[];
  playbackAttempts: SpecialCoreIncidentPlaybackAttempt[];
  lifecycleEvents: SpecialCoreIncidentLifecycleEvent[];
  media: SpecialCoreIncidentMediaFrame[];
  omissions: SpecialCoreIncidentEvidenceOmission[];
};

export type SpecialCoreIncidentFrozenState = {
  capturedAt: number;
  resetEpochId: string;
  configRevisionId: string;
  enabled: boolean;
  status: string;
  decision: string;
  presentationRevision: string | null;
  latestFrameId: string | null;
  latestObservationId: string | null;
  confirmationAttemptId: string | null;
  activationId: string | null;
  scheduleId: string | null;
  decisionId: string | null;
  playbackAttemptId: string | null;
};

export type SpecialCoreIncidentRelatedPlayback = {
  id: string;
  feature: string;
  requestedAt: number;
  browserAcceptedAt: number | null;
  finishedAt: number | null;
  failedAt: number | null;
  status: "requested" | "browser-play-accepted" | "finished" | "failed";
};

export type FrozenSpecialCoreIncidentEvidence =
  SpecialCoreIncidentEvidenceArchive & {
    frozenAt: number;
    leaseId: string;
    lease: SpecialCoreIncidentReportLease;
    frozenState: SpecialCoreIncidentFrozenState | null;
    relatedPlayback: SpecialCoreIncidentRelatedPlayback[];
  };

export type SpecialCoreIncidentSelectionDegradationReason =
  | SpecialCoreIncidentEvidenceOmissionReason
  | "legacy-unavailable"
  | "report-time-only"
  | "not-applicable"
  | "physical-audibility-unknown"
  | "sequence-incomplete"
  | "selected-media-missing";

export type SpecialCoreIncidentClosedBoundary = {
  confirmationAttempt: SpecialCoreIncidentConfirmationAttempt | null;
  activation: SpecialCoreIncidentActivation | null;
  schedule: SpecialCoreIncidentSchedule | null;
  playbackAttempt: SpecialCoreIncidentPlaybackAttempt | null;
};

export type SpecialCoreIncidentBoundaryState = {
  schemaVersion: typeof SPECIAL_CORE_INCIDENT_BOUNDARY_SCHEMA_VERSION;
  sessionId: string;
  resetSequence: number;
  configurationSequence: number;
  frameSequence: number;
  confirmationSequence: number;
  activationSequence: number;
  scheduleSequenceByActivation: Record<string, number>;
  decisionSequenceByActivation: Record<string, number>;
  attemptSequenceByActivation: Record<string, number>;
  leaseSequence: number;
  resetEpoch: SpecialCoreIncidentResetEpoch;
  configurationRevision: SpecialCoreIncidentConfigurationRevision;
  latestFrame: SpecialCoreIncidentFrame | null;
  latestObservation: SpecialCoreIncidentObservation | null;
  activeConfirmationAttempt: SpecialCoreIncidentConfirmationAttempt | null;
  activeActivation: SpecialCoreIncidentActivation | null;
  activeSchedule: SpecialCoreIncidentSchedule | null;
  latestSchedule: SpecialCoreIncidentSchedule | null;
  latestDecision: SpecialCoreIncidentAlertDecision | null;
  activePlaybackAttempt: SpecialCoreIncidentPlaybackAttempt | null;
  latestPlaybackAttempt: SpecialCoreIncidentPlaybackAttempt | null;
};

export type SpecialCoreIncidentBoundaryRejectReason =
  | "feature-disabled"
  | "continuity-reset-required"
  | "stale-reset-epoch"
  | "stale-frame"
  | "observation-frame-mismatch"
  | "observation-not-accepted"
  | "duplicate-confirmation-observation"
  | "confirmation-kind-mismatch"
  | "active-activation-exists"
  | "no-active-activation"
  | "cooldown-reacquire-not-eligible"
  | "stale-activation"
  | "schedule-already-registered"
  | "stale-schedule"
  | "schedule-timing-revised"
  | "schedule-not-due"
  | "stale-alert-decision"
  | "playback-in-flight"
  | "decision-playback-already-requested"
  | "stale-playback-attempt"
  | "invalid-playback-transition";

export type SpecialCoreIncidentBoundaryResult<T> =
  | {
      accepted: true;
      state: SpecialCoreIncidentBoundaryState;
      value: T;
    }
  | {
      accepted: false;
      state: SpecialCoreIncidentBoundaryState;
      reason: SpecialCoreIncidentBoundaryRejectReason;
    };

export function createSpecialCoreIncidentResetEpochId(
  sessionId: string,
  sequence: number,
): string {
  return `special-core-reset:${sessionId}:${sequence}`;
}

export function createSpecialCoreIncidentConfigurationRevisionId(
  resetEpochId: string,
  sequence: number,
): string {
  return `special-core-config:${resetEpochId}:${sequence}`;
}

export function createSpecialCoreIncidentFrameId(
  resetEpochId: string,
  sequence: number,
): string {
  return `special-core-frame:${resetEpochId}:${sequence}`;
}

export function createSpecialCoreIncidentObservationId(frameId: string): string {
  return `special-core-observation:${frameId}`;
}

export function createSpecialCoreIncidentConfirmationAttemptId(
  resetEpochId: string,
  sequence: number,
): string {
  return `special-core-confirmation:${resetEpochId}:${sequence}`;
}

export function createSpecialCoreIncidentActivationId(
  resetEpochId: string,
  sequence: number,
): string {
  return `special-core-activation:${resetEpochId}:${sequence}`;
}

export function createSpecialCoreIncidentScheduleId(
  activationId: string,
  sequence: number,
): string {
  return `special-core-schedule:${activationId}:${sequence}`;
}

export function createSpecialCoreIncidentAlertDecisionId(
  activationId: string,
  sequence: number,
): string {
  return `special-core-decision:${activationId}:${sequence}`;
}

export function createSpecialCoreIncidentPlaybackAttemptId(
  activationId: string,
  sequence: number,
): string {
  return `special-core-playback:${activationId}:${sequence}`;
}

export function createSpecialCoreIncidentReportLeaseId(
  sessionId: string,
  sequence: number,
): string {
  return `special-core-lease:${sessionId}:${sequence}`;
}
