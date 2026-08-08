import type { AlertPlaybackDiagnostic } from "../alertPlaybackDiagnostics";
import type {
  SpecialCoreBox,
  SpecialCoreCandidateIcon,
  SpecialCoreDetectedIcon,
  SpecialCorePerformance,
} from "../../runtime/special-core/analysis/specialCoreAnalysisRuntime";

export type {
  SpecialCoreIcon,
  SpecialCoreMatcher,
  SpecialCoreMatcherEvidence,
  SpecialCoreMatcherResult,
} from "../../recognition/special-core/specialCoreMatcherTypes";
export type {
  SpecialCoreBox,
  SpecialCoreCandidateIcon,
  SpecialCoreDetectedIcon,
  SpecialCoreMatch,
  SpecialCorePerformance,
  SpecialCoreSampleRequest,
  SpecialCoreSampleResponse,
} from "../../runtime/special-core/analysis/specialCoreAnalysisRuntime";

export const SPECIAL_CORE_TARGET_ID = "specialCore";

export const SPECIAL_CORE_MODEL_ID = "special-core-deep-v2";

export const DEFAULT_SPECIAL_CORE_COOLDOWN_SECONDS = 30;
export const MIN_SPECIAL_CORE_COOLDOWN_SECONDS = 11;
export const MAX_SPECIAL_CORE_COOLDOWN_SECONDS = 180;
export const DEFAULT_SPECIAL_CORE_ALERT_LEAD_SECONDS = 5;
export const MIN_SPECIAL_CORE_ALERT_LEAD_SECONDS = 0;
export const MAX_SPECIAL_CORE_ALERT_LEAD_SECONDS = 10;

export type SpecialCoreRuntimeStatus =
  | "idle"
  | "needs-stream"
  | "loading"
  | "waiting"
  | "confirming"
  | "cooldown"
  | "alerted"
  | "unavailable";

export type SpecialCoreDetectionObservation = {
  observedAt: number;
  boxIndex: number;
  box: SpecialCoreBox;
  score: number;
  margin: number;
};

export type SpecialCoreActivationEvidence = {
  activationId: number;
  activationStartedAt: number;
  activationConfirmedAt: number;
  confirmationIcons: SpecialCoreDetectedIcon[];
};

export type SpecialCoreRuntimeState = {
  status: SpecialCoreRuntimeStatus;
  lastSampledAt: number | null;
  unsupportedReason: string | null;
  boxCount: number;
  detectedCount: number;
  pendingDetections: SpecialCoreDetectionObservation[];
  pendingDetectionIcons: SpecialCoreDetectedIcon[];
  activationId: number;
  activationStartedAt: number | null;
  activationConfirmedAt: number | null;
  activationLastSeenAt: number | null;
  cooldownEndsAt: number | null;
  alertDueAt: number | null;
  alertedAt: number | null;
  lastAlertedAt: number | null;
  lastAlertPlayback?: AlertPlaybackDiagnostic | null;
  lastDetectedIcon: SpecialCoreDetectedIcon | null;
  activationEvidence: SpecialCoreActivationEvidence | null;
};

export type SpecialCoreSnapshot = {
  sampledAt: number | null;
  error?: string | null;
  parserEngine?: "rule" | "dl" | null;
  parserVersion?: string | null;
  parserFallbackReason?: string | null;
  boxCount: number;
  detectedCount: number;
  detectedIcon: SpecialCoreDetectedIcon | null;
  candidateIcons: SpecialCoreCandidateIcon[];
  performance: SpecialCorePerformance;
};
