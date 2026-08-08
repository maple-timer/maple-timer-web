import type { PixelRegion } from "../../../contracts/geometry/pixelRegion";
import type { BuffExpiryTargetGroup } from "../../../contracts/recognition/buffExpiryRecognition";

export const BUFF_EXPIRY_INCIDENT_EVIDENCE_SCHEMA_VERSION =
  "buff-expiry-incident-evidence-v1" as const;

export type BuffExpiryIncidentEpoch = {
  id: string;
  captureGeneration: number;
  featureGeneration: number;
  createdAt: number;
  reason: string;
};

export type BuffExpiryIncidentRuntimeState = {
  status: string;
  activeEpisodeIds: string[];
  pendingEpisodeIds: string[];
  scheduledCycleIds: string[];
};

export type BuffExpiryIncidentRuntimeFailure = {
  stage: string;
  code: string;
  message: string | null;
  provider: string | null;
  recoverable: boolean | null;
};

export type BuffExpiryIncidentRecognitionSummary = {
  parserBoxCount: number | null;
  parsedRowCount: number | null;
  localizedBoxCount?: number | null;
  localizedRowCount?: number | null;
  spatialExcludedBoxCount?: number | null;
  localizationStatus?: string | null;
  localizationReason?: string | null;
  localizationVersion?: string | null;
  upperExcludedBoxCount: number | null;
  eligibleBoxCount: number | null;
  matcherObservationCount: number;
  selectedCandidateCount: number;
  acceptedTargetCount: number;
};

export type BuffExpiryIncidentFrame = {
  id: string;
  epochId: string;
  sequence: number;
  sampledAt: number;
  source: "runtime" | "runtime-error" | "report-time";
  parser: {
    engine: string | null;
    version: string | null;
    provider: string | null;
    modelVersion: string | null;
  };
  recognition: BuffExpiryIncidentRecognitionSummary;
  selectedGroups: BuffExpiryTargetGroup[];
  observationIds: string[];
  stateBefore: BuffExpiryIncidentRuntimeState;
  stateAfter: BuffExpiryIncidentRuntimeState;
  runtimeFailure: BuffExpiryIncidentRuntimeFailure | null;
  mediaFrameId: string | null;
};

export type BuffExpiryIncidentBundleDecision = {
  group: BuffExpiryTargetGroup;
  accepted: boolean;
  score: number | null;
  margin: number | null;
  gateMargin: number | null;
  reason: string;
};

export type BuffExpiryIncidentCountdownDecision = {
  text: string | null;
  seconds: number | null;
  status: string | null;
  confidence: number | null;
  decision: "accepted" | "missing" | "implausible" | "rejected";
  reason: string | null;
};

export type BuffExpiryIncidentObservation = {
  id: string;
  frameId: string;
  epochId: string;
  episodeId: string | null;
  sampledAt: number;
  group: BuffExpiryTargetGroup;
  boxIndex: number;
  row: number | null;
  col: number | null;
  targetAccepted: boolean;
  winningGroup: BuffExpiryTargetGroup | null;
  decisionReason: string;
  bundleDecisions: BuffExpiryIncidentBundleDecision[];
  countdown: BuffExpiryIncidentCountdownDecision | null;
};

export type BuffExpiryIncidentEpisodeTransitionKind =
  | "pending"
  | "confirmed"
  | "observed"
  | "countdown-rejected"
  | "refreshed"
  | "temporarily-missed"
  | "scheduled"
  | "alerted"
  | "lost"
  | "replaced"
  | "reset";

export type BuffExpiryIncidentEpisodeTransition = {
  id: string;
  episodeId: string;
  occurredAt: number;
  kind: BuffExpiryIncidentEpisodeTransitionKind;
  frameId: string | null;
  observationId: string | null;
  countdownSeconds: number | null;
  reason: string | null;
};

export type BuffExpiryIncidentEpisode = {
  id: string;
  epochId: string;
  group: BuffExpiryTargetGroup;
  sequence: number;
  status: "pending" | "confirmed" | "terminal";
  startedAt: number;
  confirmedAt: number | null;
  lastEventAt: number;
  endedAt: number | null;
  terminalReason: string | null;
  observationIds: string[];
  transitionIds: string[];
  cycleIds: string[];
};

export type BuffExpiryIncidentCycleEventStatus =
  | "registered"
  | "rescheduled"
  | "cancelled"
  | "suppressed"
  | "fired";

export type BuffExpiryIncidentCycleEvent = {
  id: string;
  cycleId: string;
  occurredAt: number;
  status: BuffExpiryIncidentCycleEventStatus;
  reason: string | null;
  frameId: string | null;
};

export type BuffExpiryIncidentCycle = {
  id: string;
  epochId: string;
  episodeIds: string[];
  dueAt: number;
  configRevision: string;
  createdAt: number;
  updatedAt: number;
  status: BuffExpiryIncidentCycleEventStatus;
  eventIds: string[];
};

export type BuffExpiryIncidentPlaybackAttempt = {
  id: string;
  cycleId: string;
  sequence: number;
  requestedAt: number;
  startedAt: number | null;
  failedAt: number | null;
  status: "requested" | "started" | "failed";
  error: string | null;
  soundId: string;
  featureVolume: number;
  masterVolume: number;
  effectiveVolume: number;
  visibilityState: string | null;
};

export type BuffExpiryIncidentRuntimeEvent = {
  id: string;
  epochId: string;
  occurredAt: number;
  category:
    | "lifecycle"
    | "configuration"
    | "runtime-error"
    | "presentation"
    | "interaction";
  action: string;
  frameId: string | null;
  episodeId: string | null;
  cycleId: string | null;
  configRevision: string | null;
  details: Record<string, unknown>;
};

export type BuffExpiryIncidentConfigurationRevision = {
  id: string;
  capturedAt: number;
  values: Record<string, unknown>;
};

export type BuffExpiryIncidentFrozenState = {
  capturedAt: number;
  epochId: string;
  status: string;
  activeEpisodeIds: string[];
  pendingEpisodeIds: string[];
  scheduledCycleIds: string[];
  configRevision: string | null;
  provider: string | null;
};

export type BuffExpiryIncidentMediaReason =
  | "playback-failed"
  | "fired-trigger"
  | "pre-due"
  | "confirmation"
  | "accepted-observation"
  | "rejected-observation"
  | "track-loss"
  | "track-replacement"
  | "current"
  | "periodic";

export type BuffExpiryIncidentMedia = {
  frameId: string;
  sampledAt: number;
  reason: BuffExpiryIncidentMediaReason;
  dataUrl: string;
  sourceSize: { width: number; height: number };
  roi: PixelRegion;
};

export type BuffExpiryIncidentEvidenceOmissionReason =
  | "never-produced"
  | "outside-retention"
  | "reset-epoch"
  | "media-oversize"
  | "media-budget-exhausted"
  | "metadata-cap"
  | "payload-compacted"
  | "asset-persist-failed"
  | "asset-missing"
  | "ambiguous-target";

export type BuffExpiryIncidentEvidenceOmission = {
  id: string;
  occurredAt: number;
  kind:
    | "frame"
    | "observation"
    | "episode"
    | "transition"
    | "cycle"
    | "attempt"
    | "event"
    | "media"
    | "asset";
  reason: BuffExpiryIncidentEvidenceOmissionReason;
  subjectIds: string[];
  count: number;
};

export type BuffExpiryIncidentEvidenceArchive = {
  schemaVersion: typeof BUFF_EXPIRY_INCIDENT_EVIDENCE_SCHEMA_VERSION;
  epoch: BuffExpiryIncidentEpoch;
  updatedAt: number;
  frames: BuffExpiryIncidentFrame[];
  observations: BuffExpiryIncidentObservation[];
  episodes: BuffExpiryIncidentEpisode[];
  transitions: BuffExpiryIncidentEpisodeTransition[];
  cycles: BuffExpiryIncidentCycle[];
  cycleEvents: BuffExpiryIncidentCycleEvent[];
  attempts: BuffExpiryIncidentPlaybackAttempt[];
  runtimeEvents: BuffExpiryIncidentRuntimeEvent[];
  configurationRevisions: BuffExpiryIncidentConfigurationRevision[];
  frozenState: BuffExpiryIncidentFrozenState | null;
  media: BuffExpiryIncidentMedia[];
  omissions: BuffExpiryIncidentEvidenceOmission[];
};

export type FrozenBuffExpiryIncidentEvidence =
  BuffExpiryIncidentEvidenceArchive & {
    frozenAt: number;
  };

export function createBuffExpiryIncidentEpochId({
  captureGeneration,
  featureGeneration,
}: {
  captureGeneration: number;
  featureGeneration: number;
}): string {
  return `buff-expiry-epoch:${captureGeneration}:${featureGeneration}`;
}

export function createBuffExpiryIncidentFrameId(
  epochId: string,
  sequence: number,
): string {
  return `buff-expiry-frame:${epochId}:${sequence}`;
}

export function createBuffExpiryIncidentObservationId({
  frameId,
  group,
  boxIndex,
}: {
  frameId: string;
  group: BuffExpiryTargetGroup;
  boxIndex: number;
}): string {
  return `${frameId}:observation:${group}:${boxIndex}`;
}

export function createBuffExpiryIncidentEpisodeId({
  epochId,
  group,
  sequence,
}: {
  epochId: string;
  group: BuffExpiryTargetGroup;
  sequence: number;
}): string {
  return `buff-expiry-episode:${epochId}:${group}:${sequence}`;
}

export function createBuffExpiryIncidentCycleId({
  epochId,
  dueAt,
  episodeIds,
  configRevision,
}: {
  epochId: string;
  dueAt: number;
  episodeIds: string[];
  configRevision: string;
}): string {
  const key = [
    epochId,
    Math.round(dueAt),
    [...episodeIds].sort().join(","),
    configRevision,
  ].join("|");
  return `buff-expiry-cycle:${epochId}:${Math.round(dueAt)}:${hashToken(key)}`;
}

export function createBuffExpiryIncidentAttemptId(
  cycleId: string,
  sequence: number,
): string {
  return `buff-expiry-playback:${cycleId}:${sequence}`;
}

function hashToken(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
