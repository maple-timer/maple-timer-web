export const SKILL_INCIDENT_EVIDENCE_SCHEMA_VERSION =
  "skill-incident-evidence-v1" as const;

export type SkillIncidentMode =
  | "quickslot-countdown"
  | "precision-countdown"
  | "precision-remaining-count";

export type SkillIncidentEpoch = {
  id: string;
  skillId: string;
  sequence: number;
  mode: SkillIncidentMode;
  targetId: string;
  createdAt: number;
  closedAt: number | null;
  reason: string;
};

export type SkillIncidentRuntimeState = {
  status: string;
  observedValue: number | null;
  estimatedExpiresAt: number | null;
  alertedAt: number | null;
  lastRepeatedAlertAt: number | null;
  repeatedAlertCount: number;
  lastAlertCycleStartedAt: number | null;
  initialAlertDelaySeconds: number | null;
  initialAlertDelayCycleStartedAt: number | null;
  rejectedValue: number | null;
  pendingReason: string | null;
};

export type SkillIncidentRuntimeFailure = {
  stage: string;
  code: string;
  message: string | null;
  provider: string | null;
  recoverable: boolean | null;
};

export type SkillIncidentFrame = {
  id: string;
  epochId: string;
  skillId: string;
  sequence: number;
  sourceFrameId: string;
  sampledAt: number;
  monotonicAt: number | null;
  source: "runtime" | "runtime-error" | "report-time";
  mode: SkillIncidentMode;
  targetId: string;
  configRevisionId: string;
  provider: string | null;
  recognizerVersion: string | null;
  observationIds: string[];
  stateBefore: SkillIncidentRuntimeState;
  stateAfter: SkillIncidentRuntimeState;
  runtimeFailure: SkillIncidentRuntimeFailure | null;
  mediaIds: string[];
  reasons: string[];
};

export type SkillIncidentParserDecision = {
  boxCount: number | null;
  rowCount: number | null;
  eligibleBoxCount: number | null;
  candidateCount: number;
  decisionReason: string | null;
};

export type SkillIncidentMatcherDecision = {
  accepted: boolean;
  candidateCount: number;
  decisionReason: string | null;
  bundleId: string | null;
  modelVersion: string | null;
  score: number | null;
  threshold: number | null;
  margin: number | null;
  gateMargin: number | null;
};

export type SkillIncidentValueDecision = {
  kind: "countdown" | "remaining-count";
  rawValue: number | null;
  text: string | null;
  confidence: number | null;
  decision: "accepted" | "missing" | "rejected" | "implausible";
  reason: string | null;
};

export type SkillIncidentFlowDecision = {
  confirmedValue: number | null;
  expectedMin: number | null;
  expectedMax: number | null;
  decisionReason: string | null;
  pendingDropObservations: number | null;
  pendingAlertObservations: number | null;
};

export type SkillIncidentObservation = {
  id: string;
  frameId: string;
  epochId: string;
  skillIds: string[];
  targetId: string;
  sampledAt: number;
  monotonicAt: number | null;
  mode: SkillIncidentMode;
  recognitionDecision: "accepted" | "rejected" | "missing" | "error";
  parser: SkillIncidentParserDecision | null;
  matcher: SkillIncidentMatcherDecision | null;
  value: SkillIncidentValueDecision;
  flow: SkillIncidentFlowDecision | null;
  runtimeFailure: SkillIncidentRuntimeFailure | null;
  mediaIds: string[];
};

export type SkillIncidentCycle = {
  id: string;
  epochId: string;
  skillId: string;
  targetId: string;
  sequence: number;
  mode: SkillIncidentMode;
  status: "pending" | "active" | "terminal";
  startedAt: number;
  confirmedAt: number | null;
  lastEventAt: number;
  endedAt: number | null;
  terminalReason: string | null;
  anchorObservationIds: string[];
  observationIds: string[];
  decisionIds: string[];
  configRevisionIds: string[];
  estimatedExpiresAt: number | null;
  confirmedCount: number | null;
  initialAlertDelaySeconds: number | null;
};

export type SkillIncidentDecisionOutcome =
  | "requested"
  | "suppressed-duplicate-target"
  | "pending-confirmation"
  | "not-due"
  | "already-alerted"
  | "reset"
  | "cancelled";

export type SkillIncidentAlertDecision = {
  id: string;
  epochId: string;
  skillId: string;
  targetId: string;
  cycleId: string;
  sequence: number;
  kind: "initial" | "repeat";
  occurredAt: number;
  monotonicAt: number | null;
  dueAt: number | null;
  dueMonotonicAt: number | null;
  frameId: string | null;
  observationId: string | null;
  configRevisionId: string;
  arbitrationId: string | null;
  outcome: SkillIncidentDecisionOutcome;
  reason: string | null;
  attemptId: string | null;
};

export type SkillIncidentTargetArbitration = {
  id: string;
  sourceFrameId: string;
  targetId: string;
  occurredAt: number;
  monotonicAt: number | null;
  dueSkillIds: string[];
  winnerSkillId: string | null;
  suppressedSkillIds: string[];
  decisionIds: string[];
};

export type SkillIncidentPlaybackAttempt = {
  id: string;
  epochId: string;
  skillId: string;
  cycleId: string;
  decisionId: string;
  sequence: number;
  requestedAt: number;
  requestedMonotonicAt: number | null;
  startedAt: number | null;
  startedMonotonicAt: number | null;
  finishedAt: number | null;
  finishedMonotonicAt: number | null;
  failedAt: number | null;
  failedMonotonicAt: number | null;
  status: "requested" | "started" | "finished" | "failed";
  startedMeaning:
    | "browser-play-accepted"
    | "legacy-request-recorded"
    | null;
  error: string | null;
  soundId: string;
  featureVolume: number;
  masterVolume: number;
  effectiveVolume: number;
  visibilityState: string | null;
};

export type SkillIncidentLifecycleEvent = {
  id: string;
  skillId: string | null;
  epochId: string | null;
  occurredAt: number;
  monotonicAt: number | null;
  category:
    | "lifecycle"
    | "configuration"
    | "runtime-error"
    | "presentation"
    | "interaction";
  action: string;
  frameId: string | null;
  cycleId: string | null;
  configRevisionId: string | null;
  details: Record<string, unknown>;
};

export type SkillIncidentConfigurationRevision = {
  id: string;
  skillId: string;
  epochId: string;
  capturedAt: number;
  values: Record<string, unknown>;
};

export type SkillIncidentMediaReason =
  | "playback-failed"
  | "alert-decision"
  | "threshold"
  | "runtime-error"
  | "value-rejected"
  | "value-change"
  | "status-change"
  | "anchor"
  | "current"
  | "periodic";

export type SkillIncidentMediaVariant =
  | "quickslot-raw"
  | "quickslot-processed"
  | "precision-source"
  | "precision-candidate";

export type SkillIncidentMedia = {
  id: string;
  frameId: string;
  observationId: string | null;
  skillIds: string[];
  targetId: string;
  capturedAt: number;
  reason: SkillIncidentMediaReason;
  variant: SkillIncidentMediaVariant;
  mimeType: "image/png" | "image/jpeg";
  dataUrl: string;
};

export type SkillIncidentEvidenceOmissionReason =
  | "never-produced"
  | "outside-retention"
  | "reset-epoch"
  | "metadata-budget"
  | "media-budget"
  | "media-oversize"
  | "payload-compacted"
  | "asset-persist-failed"
  | "asset-missing"
  | "ambiguous-cycle"
  | "ambiguous-skill"
  | "legacy-unavailable"
  | "report-time-only";

export type SkillIncidentEvidenceOmission = {
  id: string;
  occurredAt: number;
  kind:
    | "epoch"
    | "frame"
    | "observation"
    | "cycle"
    | "decision"
    | "arbitration"
    | "attempt"
    | "event"
    | "configuration"
    | "media"
    | "asset";
  reason: SkillIncidentEvidenceOmissionReason;
  subjectIds: string[];
  count: number;
};

export type SkillIncidentEvidenceArchive = {
  schemaVersion: typeof SKILL_INCIDENT_EVIDENCE_SCHEMA_VERSION;
  updatedAt: number;
  currentEpochIds: Record<string, string>;
  epochs: SkillIncidentEpoch[];
  frames: SkillIncidentFrame[];
  observations: SkillIncidentObservation[];
  cycles: SkillIncidentCycle[];
  decisions: SkillIncidentAlertDecision[];
  arbitrations: SkillIncidentTargetArbitration[];
  attempts: SkillIncidentPlaybackAttempt[];
  lifecycleEvents: SkillIncidentLifecycleEvent[];
  configurationRevisions: SkillIncidentConfigurationRevision[];
  media: SkillIncidentMedia[];
  omissions: SkillIncidentEvidenceOmission[];
};

export type FrozenSkillIncidentEvidence = SkillIncidentEvidenceArchive & {
  frozenAt: number;
  selectedSkillId: string;
  leaseId: string;
};

export function createSkillIncidentEpochId(
  skillId: string,
  sequence: number,
): string {
  return `skill-epoch:${skillId}:${sequence}`;
}

export function createSkillIncidentFrameId(
  epochId: string,
  sequence: number,
): string {
  return `skill-frame:${epochId}:${sequence}`;
}

export function createSkillIncidentObservationId(
  frameId: string,
  targetId: string,
): string {
  return `skill-observation:${frameId}:${targetId}`;
}

export function createSkillIncidentCycleId(
  epochId: string,
  sequence: number,
): string {
  return `skill-cycle:${epochId}:${sequence}`;
}

export function createSkillIncidentDecisionId({
  cycleId,
  kind,
  sequence,
}: {
  cycleId: string;
  kind: "initial" | "repeat";
  sequence: number;
}): string {
  return `skill-decision:${cycleId}:${kind}:${sequence}`;
}

export function createSkillIncidentArbitrationId(
  sourceFrameId: string,
  targetId: string,
): string {
  return `skill-arbitration:${sourceFrameId}:${targetId}`;
}

export function createSkillIncidentAttemptId(
  decisionId: string,
  sequence: number,
): string {
  return `skill-playback:${decisionId}:${sequence}`;
}
