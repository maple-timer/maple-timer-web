import type { RecognitionResult } from "./types";
import type {
  BuffSlotCountdownModelStatus,
  BuffSlotCountdownObservation,
} from "./recognition/buff-slot/countdown-number";
import type {
  BottomRightRemainingCountModelStatus,
  BottomRightRemainingCountObservation,
} from "./recognition/skill-precision/remaining-count/bottomRightRemainingCountContract";
import type { AlertPlaybackDiagnostic } from "./lib/alertPlaybackDiagnostics";
import type {
  HuntStallCandidatePerformanceMetrics,
  HuntStallPerformanceMetrics,
} from "./runtime/hunt-stall/experience/huntStallExperienceRuntime";
import type { RuntimeAnalysisFailureEvidence } from "./contracts/reporting/runtimeReportEvidence";

export type {
  HuntStallCandidatePerformanceMetrics,
  HuntStallPerformanceMetrics,
} from "./runtime/hunt-stall/experience/huntStallExperienceRuntime";

export type RgbaImageSnapshot = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type SkillBuffDurationSnapshot = {
  targetSkillId?: string | null;
  targetDisplayName?: string | null;
  detected: boolean;
  boxCount: number;
  parserRowCount?: number | null;
  parserEngine?: "rule" | "dl" | null;
  parserVersion?: string | null;
  parserFallbackReason?: string | null;
  detectedCount: number;
  displayStatus?: "detected" | "checking" | "missing";
  displayLastSeenAt?: number | null;
  matcherEngine?: string | null;
  bundleId?: string | null;
  modelVersion?: string | null;
  baseSkillId?: string | null;
  rawSkillId?: string | null;
  score: number | null;
  threshold?: number | null;
  margin: number | null;
  gateScore?: number | null;
  gateThreshold?: number | null;
  gateMargin?: number | null;
  decisionReason: string | null;
  countdown?: BuffSlotCountdownObservation | null;
  countdownModelStatus?: BuffSlotCountdownModelStatus;
  remainingCount?: BottomRightRemainingCountObservation | null;
  remainingCountModelStatus?: BottomRightRemainingCountModelStatus;
  performanceMs: number | null;
  error: string | null;
  candidateIcons?: SkillBuffDurationCandidateIconSnapshot[];
};

export type SkillBuffDurationCandidateIconSnapshot = {
  boxIndex: number;
  box: {
    x: number;
    y: number;
    size: number;
    confidence: number;
    score: number;
  };
  match: {
    matched: boolean;
    skillId?: string | null;
    displayName?: string | null;
    detectorId?: string | null;
    matcherEngine?: string | null;
    bundleId?: string | null;
    modelVersion?: string | null;
    baseSkillId?: string | null;
    rawSkillId?: string | null;
    score: number;
    threshold: number;
    margin: number;
    gateScore?: number | null;
    gateThreshold?: number | null;
    gateMargin?: number | null;
    decisionReason: string;
  };
  countdown?: BuffSlotCountdownObservation | null;
  remainingCount?: BottomRightRemainingCountObservation | null;
  imageDataUrl: string | null;
};

export type SkillSnapshot = {
  result: RecognitionResult;
  sampledAt: number;
  rawPreviewUrl: string | null;
  previewUrl: string | null;
  previewImageData?: RgbaImageSnapshot | null;
  regionLabel: string | null;
  buffDuration?: SkillBuffDurationSnapshot | null;
  runtimeFailure?: RuntimeAnalysisFailureEvidence | null;
};

export type SkillTraceSample = {
  sampledAt: number;
  ocrValue: number | null;
  confidence: number;
  recognizedText: string | null;
  reason: string | null;
  digitCount: number | null;
  foregroundRatio: number | null;
  statusBefore: string;
  statusAfter: string;
  observedRemainingSeconds: number | null;
  observedRemainingCount?: number | null;
  estimatedRemainingSeconds: number | null;
  alertThresholdSeconds: number;
  alertInSeconds: number | null;
  alertInCount?: number | null;
  estimatedExpiresAt: number | null;
  rejectedReading: number | null;
  pendingShortAnchorCount: number | null;
  remainingCountDecision?: string | null;
  remainingCountExpectedMin?: number | null;
  remainingCountExpectedMax?: number | null;
  pendingRemainingCountDropObservations?: number | null;
  pendingRemainingCountAlertObservations?: number | null;
  shouldFireAlert: boolean;
  shouldRepeatAlert: boolean;
  alertDecision: "initial" | "repeat" | null;
  runtimeFailure?: RuntimeAnalysisFailureEvidence | null;
};

export type SkillAlertPlaybackEvent = {
  startedAt: number;
  alertCycleStartedAt: number;
  soundId: string;
  status: "started" | "finished" | "failed";
  finishedAt: number | null;
  failedAt: number | null;
  error: string | null;
};

export type SkillRuntimeEvidenceState = {
  status: string;
  observedRemainingSeconds: number | null;
  observedRemainingCount: number | null;
  estimatedExpiresAt: number | null;
  alertedAt: number | null;
  lastRepeatedAlertAt: number | null;
  repeatedAlertCount: number;
  rejectedReading: number | null;
};

export type SkillRuntimeEvidenceFrame = {
  sampledAt: number;
  reasons: string[];
  rawDataUrl: string | null;
  processedDataUrl: string | null;
  recognition: {
    value: number | null;
    confidence: number;
    reason: string | null;
  };
  decision: SkillTraceSample["alertDecision"];
  stateBefore: SkillRuntimeEvidenceState;
  stateAfter: SkillRuntimeEvidenceState;
};

export type SkillReportTimeline = {
  samples: SkillTraceSample[];
  alertEvents: SkillAlertPlaybackEvent[];
  frames?: SkillRuntimeEvidenceFrame[];
};

export type RuneRuntimeStatus =
  | "paused"
  | "no-stream"
  | "no-region"
  | "loading"
  | "waiting"
  | "candidate"
  | "alerted"
  | "unavailable";

export type RuneRuntimeCandidate = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RuneAlertDecisionReason =
  | "paused"
  | "no-stream"
  | "no-region"
  | "waiting"
  | "detection-gap-grace"
  | "alert-cycle-grace"
  | "confirmed-absent"
  | "scene-changed"
  | "stabilizing"
  | "initial-alert"
  | "repeat-alert"
  | "already-alerted-same-rune"
  | "repeat-disabled"
  | "repeat-playback-pending"
  | "repeat-maxed"
  | "repeat-interval-waiting"
  | "detector-error"
  | "playback-failed";

export type RuneDetectionErrorPhase =
  | "unsupported"
  | "worker-create"
  | "worker-post"
  | "worker-timeout"
  | "worker-runtime"
  | "worker-response"
  | "worker-unavailable";

export type RuneDetectionRuntimeError = {
  code: string;
  phase: RuneDetectionErrorPhase;
  message: string;
  occurredAt: number;
  retryCount: number;
};

export type RuneAlertPlaybackStatus = "requested" | "started" | "finished" | "failed";

export type RuneAlertPlaybackState = {
  status: RuneAlertPlaybackStatus;
  decision: "initial" | "repeat";
  cycleId: string;
  sceneEpoch: number;
  requestedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  failedAt: number | null;
  error: string | null;
  soundId: string | null;
  alertVolume: number | null;
  masterVolume: number | null;
  effectiveVolume: number | null;
};

export type RuneRuntimeTraceSample = {
  sampledAt: number;
  detected: boolean;
  outcome?: "detected" | "not-detected" | "error";
  confidence: number;
  candidateCount: number;
  candidate: RuneRuntimeCandidate | null;
  status: RuneRuntimeStatus;
  stableCount: number;
  consecutiveMissCount?: number;
  scenePolicyVersion?: "rune-scene-v1";
  sceneEpoch?: number;
  sceneChanged?: boolean;
  sceneChangeScore?: number | null;
  scenePendingStableCount?: number;
  firstDetectedAt?: number | null;
  stableDurationMs?: number;
  confirmationPolicyVersion?:
    | "rune-confirmation-v1"
    | "rune-confirmation-v2"
    | "rune-confirmation-v3";
  confirmationPolicyMode?: "any" | "all";
  confirmationSatisfied?: boolean;
  confirmationSatisfiedBy?: "frames" | "duration" | "frames-and-duration" | null;
  shouldAlert: boolean;
  reason: RuneAlertDecisionReason;
  error?: RuneDetectionRuntimeError | null;
};

export type RuneRuntimeState = {
  status: RuneRuntimeStatus;
  detectorVersion?: string | null;
  confidence: number;
  stableCount: number;
  consecutiveMissCount?: number;
  scenePolicyVersion?: "rune-scene-v1" | null;
  sceneEpoch?: number;
  sceneChangedAt?: number | null;
  sceneChangeScore?: number | null;
  scenePendingStableCount?: number;
  firstDetectedAt: number | null;
  lastDetectedAt: number | null;
  lastFoundAt: number | null;
  alertedAt: number | null;
  alertedSceneEpoch?: number | null;
  lastDetectedCandidate?: RuneRuntimeCandidate | null;
  alertedCandidate?: RuneRuntimeCandidate | null;
  lastRepeatedAlertAt: number | null;
  repeatedAlertCount: number;
  lastAlertedAt: number | null;
  candidateCount: number;
  lastDecisionReason?: RuneAlertDecisionReason | null;
  lastAlertPlayback?: RuneAlertPlaybackState | null;
  lastDetectionError?: RuneDetectionRuntimeError | null;
  recentSamples?: RuneRuntimeTraceSample[];
};

export type RuneSnapshotDetectionDebug = {
  detectorKind: string | null;
  classifier: string | null;
  proposalCount?: number | null;
  proposalScore?: number | null;
  selectedProposalRank?: number | null;
  shapeScore?: number | null;
  shapeThreshold?: number | null;
  shapePass?: boolean | null;
  appearanceScore?: number | null;
  appearanceThreshold?: number | null;
  appearancePass?: boolean | null;
  modelScore: number | null;
  modelThreshold: number | null;
  proposalInferenceMs?: number | null;
  gateInferenceMs?: number | null;
  inferenceMs: number | null;
  reason: string | null;
};

export type RuneSnapshotCandidate = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  source?: string | null;
};

export type RuneAlertTriggerFrame = {
  sampledAt: number;
  detectorVersion: string | null;
  detectionDebug: RuneSnapshotDetectionDebug | null;
  rawDataUrl: string;
  detected: boolean;
  confidence: number;
  candidateCount: number;
  candidate: RuneSnapshotCandidate | null;
  status: RuneRuntimeStatus;
  stableCount: number;
  firstDetectedAt: number | null;
  stableDurationMs: number;
  confirmationSatisfied: boolean;
  confirmationSatisfiedBy: RuneRuntimeTraceSample["confirmationSatisfiedBy"];
  shouldAlert: boolean;
  reason: RuneAlertDecisionReason;
  sceneEpoch: number;
};

export type RuneAlertTriggerEvidence = {
  schemaVersion: "rune-alert-trigger-v1";
  cycleId: string;
  episodeId?: string | null;
  decision: "initial" | "repeat";
  triggeredAt: number;
  detectorVersion: string | null;
  sceneEpoch: number;
  frames: RuneAlertTriggerFrame[];
};

export type RuneRuntimeIncidentFrame = {
  source: "runtime";
  phase: "before" | "signal" | "after";
  outcome: "detected" | "near-threshold" | "not-detected" | "error";
  sampledAt: number;
  detectorVersion: string | null;
  detectionDebug: RuneSnapshotDetectionDebug | null;
  detectionError: RuneDetectionRuntimeError | null;
  rawDataUrl: string;
  detected: boolean;
  confidence: number;
  candidateCount: number;
  candidate: RuneSnapshotCandidate | null;
  status: RuneRuntimeStatus;
  stableCount: number;
  firstDetectedAt: number | null;
  stableDurationMs: number;
  confirmationSatisfied: boolean;
  confirmationSatisfiedBy: RuneRuntimeTraceSample["confirmationSatisfiedBy"];
  shouldAlert: boolean;
  reason: RuneAlertDecisionReason;
  sceneEpoch: number;
  sceneChanged: boolean;
  sceneChangeScore: number | null;
  stateBefore?: RuneRuntimeIncidentFrameState;
  stateAfter?: RuneRuntimeIncidentFrameState;
};

export type RuneRuntimeIncidentFrameState = {
  status: RuneRuntimeStatus;
  stableCount: number;
  consecutiveMissCount: number;
  firstDetectedAt: number | null;
  alertedAt: number | null;
  lastRepeatedAlertAt: number | null;
  repeatedAlertCount: number;
  sceneEpoch: number;
  lastDecisionReason: RuneAlertDecisionReason | null;
};

export type RuneRuntimeIncidentEvidence = {
  schemaVersion: "rune-runtime-incident-v1";
  id: string;
  episodeId?: string | null;
  startedAt: number;
  lastSignalAt: number;
  updatedAt: number;
  expiresAt: number;
  detectorVersion: string | null;
  sceneEpoch: number;
  frames: RuneRuntimeIncidentFrame[];
};

export type RuneEvidenceMediaBudget = {
  policy: "rune-shared-media-v1";
  retainedFrameIds: string[];
  retainedChars: number;
  omittedOversized: number;
  omittedCapacity: number;
};

export type RuneEvidenceArchive = {
  policy: "rune-recent-evidence-v1" | "rune-recent-evidence-v2";
  retainedAt: number;
  runtimeIncidents: RuneRuntimeIncidentEvidence[];
  alertTriggers: RuneAlertTriggerEvidence[];
  mediaBudget: RuneEvidenceMediaBudget;
};

export type RuneSnapshot = {
  sampledAt: number;
  detectorVersion?: string | null;
  detectionDebug?: RuneSnapshotDetectionDebug | null;
  detectionError?: RuneDetectionRuntimeError | null;
  rawPreviewUrl: string | null;
  rawPreviewImageData?: RgbaImageSnapshot | null;
  maskPreviewUrl: string | null;
  maskPreviewImageData?: RgbaImageSnapshot | null;
  candidatePreviewUrl: string | null;
  candidatePreviewImageData?: RgbaImageSnapshot | null;
  candidateRawPreviewUrl: string | null;
  candidateRawPreviewImageData?: RgbaImageSnapshot | null;
  candidateMaskPreviewUrl: string | null;
  candidateMaskPreviewImageData?: RgbaImageSnapshot | null;
  candidateRegionLabel: string | null;
  candidateSampledAt: number | null;
  candidate: RuneSnapshotCandidate | null;
  detected: boolean;
  confidence: number;
  candidateCount: number;
  runtimeIncident?: RuneRuntimeIncidentEvidence | null;
  pendingAlertTriggerFrames?: RuneAlertTriggerFrame[];
  lastAlertTrigger?: RuneAlertTriggerEvidence | null;
  evidenceMediaBudget?: RuneEvidenceMediaBudget | null;
  evidenceArchive?: RuneEvidenceArchive | null;
};

export type HuntStallRuntimeStatus =
  | "paused"
  | "no-stream"
  | "no-region"
  | "detecting"
  | "watching"
  | "active"
  | "stalled"
  | "alerted"
  | "unavailable";

export type HuntStallReadDecision =
  | "idle"
  | "disabled"
  | "no-stream"
  | "sample-error"
  | "foreground-ratio"
  | "ocr-empty"
  | "ignored-jitter"
  | "stable"
  | "stable-after-read-failure"
  | "pending"
  | "pending-progress"
  | "confirmed-progress"
  | "level-reset"
  | "baseline-reset"
  | "cooldown-no-region"
  | "cooldown-empty"
  | "cooldown-readable"
  | "cooldown-arming"
  | "cooldown-visual-active"
  | "cooldown-unchanged"
  | "cooldown-missing"
  | "cooldown-alerted";

export type HuntStallRuntimeState = {
  status: HuntStallRuntimeStatus;
  lastChangedAt: number | null;
  lastSampledAt: number | null;
  lastReadableAt: number | null;
  lastReadFailureAt: number | null;
  unreadableSinceAt: number | null;
  alertedAt: number | null;
  lastRepeatedAlertAt: number | null;
  repeatedAlertCount: number;
  lastAlertedAt: number | null;
  lastAlertPlayback?: AlertPlaybackDiagnostic | null;
  stableSampleCount: number;
  unchangedSeconds: number;
  fingerprint: string | null;
  recognizedText: string | null;
  alertedRecognizedText: string | null;
  pendingRecognizedText: string | null;
  pendingRecognizedCount: number;
  manualExperiencePendingFingerprint?: string | null;
  manualExperienceAlertedFingerprint?: string | null;
  lastRejectedRecognizedText: string | null;
  lastReadFailureReason: string | null;
  lastDecision: HuntStallReadDecision;
  hasObservedExperienceChange: boolean;
  hasObservedCooldownPresence: boolean;
  cooldownLastDetectedAt: number | null;
  cooldownMissingSinceAt: number | null;
  cooldownMissingSeconds: number;
  cooldownConsecutiveReadableCount: number;
  cooldownVisualFingerprint?: string | null;
  cooldownVisualChangeScore?: number | null;
  cooldownVisualChangedAt?: number | null;
  cooldownConsecutiveVisualActivityCount?: number;
  cooldownUsedVisualActivity?: boolean;
  confidence: number;
  changeScore: number;
  experienceTotalEstimate?: number | null;
  experienceTotalSampleCount?: number;
};

export type HuntStallCropCandidateSnapshot = {
  label: string;
  regionLabel: string;
  pixelRegion: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  score: number;
  selected: boolean;
  rawPreviewUrl: string | null;
  rawPreviewImageData?: RgbaImageSnapshot | null;
  processedPreviewUrl: string | null;
  processedPreviewImageData?: RgbaImageSnapshot | null;
  recognizedText: string | null;
  debugText?: string;
  confidence: number;
  foregroundRatio: number;
  barPercent: number | null;
  barConfidence: number | null;
  barCoverage: "no_bar" | "partial_bar" | "full_bar" | "unknown";
  performance?: HuntStallCandidatePerformanceMetrics | null;
};

export type HuntStallRuntimeTraceFrame = {
  sampledAt: number;
  mode: "manual-experience" | "cooldown-presence";
  status: HuntStallRuntimeStatus;
  lastDecision: HuntStallReadDecision;
  shouldAlert: boolean;
  recognizedText: string | null;
  snapshotRecognizedText: string | null;
  alertedRecognizedText: string | null;
  pendingRecognizedText: string | null;
  pendingRecognizedCount: number;
  lastRejectedRecognizedText: string | null;
  lastReadFailureReason: string | null;
  confidence: number;
  foregroundRatio: number | null;
  unchangedSeconds: number;
  stableSampleCount: number;
  lastChangedAt: number | null;
  lastReadableAt: number | null;
  lastReadFailureAt: number | null;
  alertedAt: number | null;
  alertDecision?: "initial" | "repeat" | null;
  lastRepeatedAlertAt?: number | null;
  repeatedAlertCount?: number;
  lastAlertedAt?: number | null;
  lastAlertPlaybackStatus?: AlertPlaybackDiagnostic["status"] | null;
  lastAlertPlaybackRequestedAt?: number | null;
  lastAlertPlaybackStartedAt?: number | null;
  lastAlertPlaybackFinishedAt?: number | null;
  hasObservedCooldownPresence: boolean;
  cooldownLastDetectedAt: number | null;
  cooldownMissingSeconds: number;
  cooldownConsecutiveReadableCount: number;
  cooldownVisualChangeScore: number | null;
  cooldownVisualChanged: boolean;
  cooldownUsedVisualActivity: boolean;
  runtimeFailure?: RuntimeAnalysisFailureEvidence | null;
};

export type HuntStallCropHistoryState = {
  status: HuntStallRuntimeStatus;
  lastDecision: HuntStallReadDecision;
  recognizedText: string | null;
  alertedRecognizedText: string | null;
  lastRejectedRecognizedText: string | null;
  lastReadFailureReason: string | null;
  unchangedSeconds: number;
  cooldownMissingSeconds: number;
  alertedAt: number | null;
};

export type HuntStallCropHistoryFrame = {
  sampledAt: number;
  mode: "manual-experience" | "cooldown-presence";
  reasons: string[];
  rawDataUrl: string | null;
  processedDataUrl: string | null;
  regionLabel: string | null;
  recognizedText: string | null;
  debugText?: string;
  confidence: number;
  foregroundRatio: number;
  changeScore: number;
  cooldownVisualChangeScore: number | null;
  cooldownVisualChanged: boolean;
  cooldownUsedVisualActivity: boolean;
  /** Legacy after-state alias retained for older troubleshooters. */
  state: HuntStallCropHistoryState;
  stateBefore?: HuntStallCropHistoryState;
  stateAfter?: HuntStallCropHistoryState;
};

export type HuntStallSnapshot = {
  sampledAt: number;
  rawPreviewUrl: string | null;
  rawPreviewImageData?: RgbaImageSnapshot | null;
  displayPreviewUrl?: string | null;
  displayPreviewImageData?: RgbaImageSnapshot | null;
  processedPreviewUrl: string | null;
  processedPreviewImageData?: RgbaImageSnapshot | null;
  fullFramePreviewUrl?: string | null;
  cropCandidates?: HuntStallCropCandidateSnapshot[];
  mode?: "experience" | "manual-experience" | "cooldown-presence";
  regionLabel: string | null;
  recognizedText: string | null;
  debugText?: string;
  confidence: number;
  foregroundRatio: number;
  changeScore: number;
  cooldownVisualChangeScore?: number | null;
  cooldownVisualChanged?: boolean;
  cooldownUsedVisualActivity?: boolean;
  performance?: HuntStallPerformanceMetrics | null;
  runtimeTrace?: HuntStallRuntimeTraceFrame[];
  cropHistory?: HuntStallCropHistoryFrame[];
  runtimeFailure?: RuntimeAnalysisFailureEvidence | null;
};
