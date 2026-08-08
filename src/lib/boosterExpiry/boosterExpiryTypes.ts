import type { Rect } from "../../recognition/booster-expiry/timerCatch/timer";
import type {
  BoosterExpiryCompactTime,
  BoosterExpiryWorkerFlow,
  BoosterExpiryWorkerPerformance,
  BoosterExpiryWorkerResult,
  BoosterExpiryWorkerTimerRect,
} from "../../recognition/booster-expiry/boosterExpiryRecognitionContract";
import type { AlertPlaybackDiagnostic } from "../alertPlaybackDiagnostics";
import type { RuntimeAnalysisFailureEvidence } from "../../contracts/reporting/runtimeReportEvidence";

export type {
  BoosterExpiryCompactTime,
  BoosterExpiryWorkerFlow,
  BoosterExpiryWorkerPerformance,
  BoosterExpiryWorkerResult,
  BoosterExpiryWorkerTimerRect,
} from "../../recognition/booster-expiry/boosterExpiryRecognitionContract";

export type BoosterExpiryRuntimeStatus =
  | "paused"
  | "no-stream"
  | "waiting"
  | "confirming"
  | "armed"
  | "alerted"
  | "lost";

export type BoosterExpiryReadDecision =
  | "disabled"
  | "no-stream"
  | "timer-waiting"
  | "raw-pending"
  | "raw-locked"
  | "flow-predicted"
  | "flow-reset-pending"
  | "alerted"
  | "schedule-cancelled"
  | "lost";

export type BoosterExpiryRuntimeState = {
  status: BoosterExpiryRuntimeStatus;
  lastSampledAt: number | null;
  lastDetectedAt: number | null;
  lastRawDetectedAt: number | null;
  lastMissedAt: number | null;
  rawText: string | null;
  displayText: string | null;
  remainingSeconds: number | null;
  rawRemainingSeconds: number | null;
  estimatedExpiresAt: number | null;
  alertAt: number | null;
  alertedAt: number | null;
  lastAlertPlayback?: AlertPlaybackDiagnostic | null;
  cycleCandidateStartedAt: number | null;
  cycleCandidateLastSeenAt: number | null;
  cycleCandidateExpiresAt: number | null;
  cycleCandidateExpiresAtMin: number | null;
  cycleCandidateExpiresAtMax: number | null;
  cycleCandidateFirstRemainingSeconds: number | null;
  cycleCandidateLastRemainingSeconds: number | null;
  cycleCandidateObservationCount: number;
  confirmedAt: number | null;
  confirmedExpiresAt: number | null;
  confirmedLastSupportedAt: number | null;
  confirmedContradictionCount: number;
  flowSource: string | null;
  locked: boolean;
  confidence: number;
  consecutiveRawDetections: number;
  consecutiveMisses: number;
  lastDecision: BoosterExpiryReadDecision;
};

export type BoosterExpiryRuntimeTraceFrame = {
  sampledAt: number;
  status: BoosterExpiryRuntimeStatus;
  rawText: string | null;
  displayText: string | null;
  rawRemainingSeconds: number | null;
  remainingSeconds: number | null;
  estimatedExpiresAt: number | null;
  alertAt: number | null;
  cycleCandidateObservationCount: number;
  cycleCandidateDecreaseSeconds: number | null;
  confirmedAt: number | null;
  confirmedExpiresAt: number | null;
  confirmedLastSupportedAt: number | null;
  confirmedContradictionCount: number;
  alerted: boolean;
  flowSource: string | null;
  locked: boolean;
  decision: BoosterExpiryReadDecision;
  rect: Rect | null;
  performance: BoosterExpiryWorkerPerformance | null;
  runtimeFailure?: RuntimeAnalysisFailureEvidence | null;
};

export type BoosterExpiryTimerEvidence = {
  sampledAt: number;
  eventType?:
    | "flow-lock"
    | "flow-conflict"
    | "flow-reset"
    | "flow-relock"
    | "confirmed"
    | "alerted"
    | "interval"
    | null;
  dataUrl: string | null;
  rect: Rect | null;
  rawText: string | null;
  displayText: string | null;
  rawRemainingSeconds: number | null;
  remainingSeconds: number | null;
  predictedExpiresAt: number | null;
  confirmedExpiresAt: number | null;
  alertAt: number | null;
  flowSource: string | null;
  locked: boolean;
  decision: BoosterExpiryReadDecision;
  format: BoosterExpiryCompactTime["format"] | null;
  selectedBy: string | null;
  stateBefore?: BoosterExpiryTimerEvidenceState;
  stateAfter?: BoosterExpiryTimerEvidenceState;
};

export type BoosterExpiryTimerEvidenceState = {
  status: BoosterExpiryRuntimeStatus;
  decision: BoosterExpiryReadDecision;
  rawRemainingSeconds: number | null;
  remainingSeconds: number | null;
  estimatedExpiresAt: number | null;
  alertAt: number | null;
  alertedAt: number | null;
  confirmedAt: number | null;
  confirmedExpiresAt: number | null;
  locked: boolean;
  flowSource: string | null;
};

export type BoosterExpirySnapshot = {
  sampledAt: number;
  error?: string | null;
  recognizerVersion?: string | null;
  rawPreviewUrl: string | null;
  timerPreviewUrl: string | null;
  regionLabel: string | null;
  rawTime: BoosterExpiryCompactTime | null;
  time: BoosterExpiryCompactTime | null;
  timeRect: BoosterExpiryWorkerTimerRect | null;
  flow: BoosterExpiryWorkerFlow | null;
  performance: BoosterExpiryWorkerPerformance | null;
  runtimeTrace?: BoosterExpiryRuntimeTraceFrame[];
  timerEvidence?: BoosterExpiryTimerEvidence[];
  confirmationEvidence?: BoosterExpiryTimerEvidence[];
  runtimeFailure?: RuntimeAnalysisFailureEvidence | null;
};
