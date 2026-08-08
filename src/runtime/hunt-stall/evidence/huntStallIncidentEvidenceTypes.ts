export const HUNT_STALL_INCIDENT_BOUNDARY_SCHEMA_VERSION =
  "hunt-stall-incident-boundary-v1" as const;

export const HUNT_STALL_INCIDENT_EVIDENCE_SCHEMA_VERSION =
  "hunt-stall-incident-evidence-v1" as const;

export type HuntStallIncidentMode =
  | "manual-experience"
  | "cooldown-presence";

export type HuntStallIncidentResetReason =
  | "initialized"
  | "disabled"
  | "enabled"
  | "mode-changed"
  | "layout-changed"
  | "region-changed"
  | "stream-replaced"
  | "profile-replaced"
  | "preset-replaced"
  | "global-disabled"
  | "worker-reset";

export type HuntStallIncidentContinuity = {
  captureGeneration: number;
  featureGeneration: number;
  workerGeneration: number;
  mode: HuntStallIncidentMode;
  layoutKey: string;
  regionRevision: string;
};

export type HuntStallIncidentConfiguration = {
  enabled: boolean;
  mode: HuntStallIncidentMode;
  thresholdSeconds: number;
  repeatAlertEnabled: boolean;
  repeatAlertIntervalSeconds: number | null;
  repeatAlertMaxCount: number | null;
  soundId: string;
  featureVolume: number;
  masterVolume: number;
  effectiveVolume: number;
};

export type HuntStallIncidentResetEpoch = {
  id: string;
  sessionId: string;
  sequence: number;
  startedAt: number;
  reason: HuntStallIncidentResetReason;
  continuity: HuntStallIncidentContinuity;
};

export type HuntStallIncidentConfigurationRevision = {
  id: string;
  resetEpochId: string;
  sequence: number;
  capturedAt: number;
  fingerprint: string;
  values: HuntStallIncidentConfiguration;
};

export type HuntStallIncidentFrameSource =
  | "runtime"
  | "runtime-error"
  | "report-time";

export type HuntStallIncidentRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HuntStallIncidentRuntimeFailure = {
  stage:
    | "capture"
    | "crop"
    | "worker-load"
    | "recognition"
    | "timeout"
    | "stale-response"
    | "publish"
    | "playback";
  code: string;
  message: string | null;
  durationMs: number | null;
  recovered: boolean;
};

export type HuntStallIncidentRecognizerProvenance = {
  engine: string;
  modelId: string | null;
  modelVersion: string | null;
  workerVersion: string | null;
  provider: string | null;
};

export type HuntStallIncidentRuntimeStateSnapshot = {
  capturedAt: number;
  enabled: boolean;
  mode: HuntStallIncidentMode;
  status: string;
  decision: string;
  armed: boolean;
  lastChangedAt: number | null;
  lastAlertAt: number | null;
  initialAlertCount: number;
  repeatAlertCount: number;
  latestReading: string | number | null;
};

export type HuntStallIncidentFrame = {
  id: string;
  resetEpochId: string;
  configRevisionId: string;
  sequence: number;
  sampledAt: number;
  mode: HuntStallIncidentMode;
  layoutKey: string;
  regionRevision: string;
  source?: HuntStallIncidentFrameSource;
  sourceDimensions?: { width: number; height: number } | null;
  region?: HuntStallIncidentRegion | null;
  sourceToCrop?: {
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
  } | null;
  stateBefore?: HuntStallIncidentRuntimeStateSnapshot | null;
  stateAfter?: HuntStallIncidentRuntimeStateSnapshot | null;
  recognizer?: HuntStallIncidentRecognizerProvenance | null;
  runtimeFailure?: HuntStallIncidentRuntimeFailure | null;
  timings?: {
    captureMs: number | null;
    cropMs: number | null;
    recognitionMs: number | null;
    transitionMs: number | null;
    totalMs: number | null;
  } | null;
};

export type HuntStallIncidentRecognition = {
  decision: "accepted" | "rejected" | "missing" | "error";
  reason: string | null;
  rawText: string | null;
  rawValue: number | null;
  correctedValue: number | null;
  fingerprint: string | null;
  confidence: number | null;
  foregroundRatio: number | null;
  visualActivityScore: number | null;
  visualChangeScore: number | null;
  usedVisualFallback: boolean;
  readableStreak: number;
  visualActivityStreak: number;
  failure: HuntStallIncidentRuntimeFailure | null;
};

export type HuntStallIncidentObservationTransition = {
  kind:
    | "baseline-established"
    | "pending-progress"
    | "presence-pending"
    | "activity-confirmed"
    | "unchanged"
    | "unreadable"
    | "armed"
    | "rearmed"
    | "rejected"
    | "threshold-reached"
    | "error";
  reason: string | null;
  elapsedMs: number | null;
  thresholdMs: number | null;
  shouldAlert: boolean;
};

export type HuntStallIncidentObservation = {
  id: string;
  resetEpochId: string;
  frameId: string;
  frameSequence: number;
  sampledAt: number;
  mode: HuntStallIncidentMode;
  recognition?: HuntStallIncidentRecognition | null;
  transition?: HuntStallIncidentObservationTransition | null;
};

export type HuntStallIncidentActivityReason =
  | "manual-progress-confirmed"
  | "cooldown-presence-confirmed"
  | "cooldown-digit-changed"
  | "cooldown-visual-activity"
  | "cooldown-rearmed-readable"
  | "cooldown-rearmed-visual";

export type HuntStallIncidentTerminalReason =
  | "activity-accepted"
  | "reset-epoch";

export type HuntStallIncidentActivityEpoch = {
  id: string;
  resetEpochId: string;
  sequence: number;
  mode: HuntStallIncidentMode;
  startedAt: number;
  anchorFrameId: string;
  anchorFrameSequence: number;
  anchorObservationId: string;
  reason: HuntStallIncidentActivityReason;
  endedAt: number | null;
  terminalReason: HuntStallIncidentTerminalReason | null;
};

export type HuntStallIncidentStallEpisode = {
  id: string;
  resetEpochId: string;
  activityEpochId: string;
  sequence: number;
  mode: HuntStallIncidentMode;
  startedAt: number;
  status: "active" | "alerted" | "terminal";
  alertCycleId: string | null;
  endedAt: number | null;
  terminalReason: HuntStallIncidentTerminalReason | null;
  lastEvaluation?: {
    frameId: string;
    observationId: string;
    evaluatedAt: number;
    elapsedMs: number;
    thresholdMs: number;
    excludedUnreadableMs: number;
    thresholdReached: boolean;
    outcome: "not-due" | "alert" | "suppressed" | "stale" | "blocked";
    reason: string | null;
  } | null;
};

export type HuntStallIncidentAlertCycle = {
  id: string;
  resetEpochId: string;
  activityEpochId: string;
  stallEpisodeId: string;
  sequence: number;
  mode: HuntStallIncidentMode;
  startedAt: number;
  initialDecisionId: string;
  status: "active" | "terminal";
  endedAt: number | null;
  terminalReason: HuntStallIncidentTerminalReason | null;
};

export type HuntStallIncidentAlertDecision = {
  id: string;
  resetEpochId: string;
  activityEpochId: string;
  stallEpisodeId: string;
  cycleId: string;
  sequence: number;
  kind: "initial" | "repeat";
  occurredAt: number;
  frameId: string;
  observationId: string;
  configRevisionId: string;
  dueAt?: number | null;
  evaluation?: {
    outcome: "alert" | "suppressed" | "stale" | "blocked";
    reason: string | null;
  } | null;
};

export type HuntStallIncidentPlaybackAttempt = {
  id: string;
  resetEpochId: string;
  activityEpochId: string;
  stallEpisodeId: string;
  cycleId: string;
  decisionId: string;
  sequence: number;
  requestedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  failedAt: number | null;
  status: "requested" | "started" | "finished" | "failed";
  error: string | null;
  configRevisionId: string;
  soundId: string;
  featureVolume: number;
  masterVolume: number;
  effectiveVolume: number;
  visibilityState?: "visible" | "hidden" | "prerender" | null;
};

export type HuntStallIncidentRelatedPlayback = {
  id: string;
  feature: string;
  requestedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  failedAt: number | null;
  status: "requested" | "started" | "finished" | "failed";
};

export type HuntStallIncidentReportLease = {
  id: string;
  resetEpochId: string;
  configRevisionId: string;
  sequence: number;
  frozenAt: number;
  leasedThroughFrameSequence: number;
  mode: HuntStallIncidentMode;
  layoutKey: string;
  regionRevision: string;
  activityEpochId: string | null;
  stallEpisodeId: string | null;
  alertCycleId: string | null;
  playbackAttemptId: string | null;
};

export type HuntStallIncidentLifecycleEvent = {
  id: string;
  resetEpochId: string;
  occurredAt: number;
  category:
    | "lifecycle"
    | "configuration"
    | "recognition"
    | "decision"
    | "playback"
    | "runtime-error"
    | "presentation"
    | "interaction";
  action: string;
  frameId: string | null;
  observationId: string | null;
  activityEpochId: string | null;
  stallEpisodeId: string | null;
  cycleId: string | null;
  attemptId: string | null;
  configRevisionId: string | null;
  details: Record<string, unknown>;
};

export type HuntStallIncidentMediaReason =
  | "playback-failed"
  | "alert-decision"
  | "threshold"
  | "activity-anchor"
  | "runtime-error"
  | "value-transition"
  | "rejected-observation"
  | "rearm"
  | "current"
  | "periodic";

export type HuntStallIncidentMediaFrame = {
  id: string;
  frameId: string;
  resetEpochId: string;
  sampledAt: number;
  reason: HuntStallIncidentMediaReason;
  rawDataUrl: string | null;
  processedDataUrl: string | null;
};

export type HuntStallIncidentEvidenceOmissionReason =
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

export type HuntStallIncidentEvidenceOmission = {
  id: string;
  occurredAt: number;
  kind:
    | "reset-epoch"
    | "configuration"
    | "frame"
    | "observation"
    | "activity-epoch"
    | "stall-episode"
    | "cycle"
    | "decision"
    | "attempt"
    | "event"
    | "media"
    | "asset";
  reason: HuntStallIncidentEvidenceOmissionReason;
  subjectIds: string[];
  count: number;
};

export type HuntStallIncidentEvidenceArchive = {
  schemaVersion: typeof HUNT_STALL_INCIDENT_EVIDENCE_SCHEMA_VERSION;
  updatedAt: number;
  currentResetEpochId: string | null;
  currentConfigurationRevisionId: string | null;
  resetEpochs: HuntStallIncidentResetEpoch[];
  configurationRevisions: HuntStallIncidentConfigurationRevision[];
  frames: HuntStallIncidentFrame[];
  observations: HuntStallIncidentObservation[];
  activityEpochs: HuntStallIncidentActivityEpoch[];
  stallEpisodes: HuntStallIncidentStallEpisode[];
  alertCycles: HuntStallIncidentAlertCycle[];
  decisions: HuntStallIncidentAlertDecision[];
  playbackAttempts: HuntStallIncidentPlaybackAttempt[];
  lifecycleEvents: HuntStallIncidentLifecycleEvent[];
  media: HuntStallIncidentMediaFrame[];
  omissions: HuntStallIncidentEvidenceOmission[];
};

export type HuntStallIncidentFrozenState = {
  capturedAt: number;
  resetEpochId: string;
  configRevisionId: string;
  mode: HuntStallIncidentMode;
  enabled: boolean;
  status: string;
  decision: string;
  presentationRevision: string | null;
  latestFrameId: string | null;
  latestObservationId: string | null;
  activityEpochId: string | null;
  stallEpisodeId: string | null;
  alertCycleId: string | null;
  playbackAttemptId: string | null;
};

export type FrozenHuntStallIncidentEvidence =
  HuntStallIncidentEvidenceArchive & {
    frozenAt: number;
    leaseId: string;
    lease: HuntStallIncidentReportLease;
    frozenState: HuntStallIncidentFrozenState | null;
    relatedPlayback: HuntStallIncidentRelatedPlayback[];
  };

export type HuntStallIncidentSelectionDegradationReason =
  | HuntStallIncidentEvidenceOmissionReason
  | "legacy-unavailable"
  | "report-time-only"
  | "not-applicable"
  | "sequence-incomplete"
  | "physical-audibility-unknown";

export type HuntStallIncidentBoundaryState = {
  schemaVersion: typeof HUNT_STALL_INCIDENT_BOUNDARY_SCHEMA_VERSION;
  sessionId: string;
  resetSequence: number;
  configurationSequence: number;
  frameSequence: number;
  activitySequence: number;
  episodeSequence: number;
  cycleSequence: number;
  decisionSequenceByCycle: Record<string, number>;
  attemptSequenceByCycle: Record<string, number>;
  leaseSequence: number;
  resetEpoch: HuntStallIncidentResetEpoch;
  configurationRevision: HuntStallIncidentConfigurationRevision;
  latestFrame: HuntStallIncidentFrame | null;
  latestObservation: HuntStallIncidentObservation | null;
  activeActivityEpoch: HuntStallIncidentActivityEpoch | null;
  activeStallEpisode: HuntStallIncidentStallEpisode | null;
  activeAlertCycle: HuntStallIncidentAlertCycle | null;
  latestDecision: HuntStallIncidentAlertDecision | null;
  activePlaybackAttempt: HuntStallIncidentPlaybackAttempt | null;
  latestPlaybackAttempt: HuntStallIncidentPlaybackAttempt | null;
};

export type HuntStallIncidentClosedBoundary = {
  activityEpoch: HuntStallIncidentActivityEpoch | null;
  stallEpisode: HuntStallIncidentStallEpisode | null;
  alertCycle: HuntStallIncidentAlertCycle | null;
  playbackAttempt: HuntStallIncidentPlaybackAttempt | null;
};

export type HuntStallIncidentBoundaryRejectReason =
  | "feature-disabled"
  | "continuity-reset-required"
  | "configuration-mode-mismatch"
  | "stale-reset-epoch"
  | "stale-frame"
  | "observation-frame-mismatch"
  | "activity-reason-mode-mismatch"
  | "duplicate-activity-observation"
  | "no-active-activity"
  | "frame-before-active-activity"
  | "initial-cycle-already-created"
  | "repeat-not-supported"
  | "no-active-alert-cycle"
  | "repeat-playback-not-finished"
  | "stale-alert-decision"
  | "stale-alert-cycle"
  | "configuration-revised-after-decision"
  | "playback-in-flight"
  | "decision-playback-already-requested"
  | "stale-playback-attempt"
  | "invalid-playback-transition";

export type HuntStallIncidentBoundaryResult<T> =
  | {
      accepted: true;
      state: HuntStallIncidentBoundaryState;
      value: T;
    }
  | {
      accepted: false;
      state: HuntStallIncidentBoundaryState;
      reason: HuntStallIncidentBoundaryRejectReason;
    };

export function createHuntStallIncidentResetEpochId(
  sessionId: string,
  sequence: number,
): string {
  return `hunt-stall-reset:${sessionId}:${sequence}`;
}

export function createHuntStallIncidentConfigurationRevisionId(
  resetEpochId: string,
  sequence: number,
): string {
  return `hunt-stall-config:${resetEpochId}:${sequence}`;
}

export function createHuntStallIncidentFrameId(
  resetEpochId: string,
  sequence: number,
): string {
  return `hunt-stall-frame:${resetEpochId}:${sequence}`;
}

export function createHuntStallIncidentObservationId(frameId: string): string {
  return `hunt-stall-observation:${frameId}`;
}

export function createHuntStallIncidentActivityEpochId(
  resetEpochId: string,
  sequence: number,
): string {
  return `hunt-stall-activity:${resetEpochId}:${sequence}`;
}

export function createHuntStallIncidentStallEpisodeId(
  activityEpochId: string,
  sequence: number,
): string {
  return `hunt-stall-episode:${activityEpochId}:${sequence}`;
}

export function createHuntStallIncidentAlertCycleId(
  stallEpisodeId: string,
  sequence: number,
): string {
  return `hunt-stall-cycle:${stallEpisodeId}:${sequence}`;
}

export function createHuntStallIncidentAlertDecisionId(
  cycleId: string,
  kind: "initial" | "repeat",
  sequence: number,
): string {
  return `hunt-stall-decision:${cycleId}:${kind}:${sequence}`;
}

export function createHuntStallIncidentPlaybackAttemptId(
  cycleId: string,
  sequence: number,
): string {
  return `hunt-stall-playback:${cycleId}:${sequence}`;
}

export function createHuntStallIncidentReportLeaseId(
  sessionId: string,
  sequence: number,
): string {
  return `hunt-stall-lease:${sessionId}:${sequence}`;
}
