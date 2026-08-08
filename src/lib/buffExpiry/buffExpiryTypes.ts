import type { PixelRegion } from "../../contracts/geometry/pixelRegion";
import type { AlertPlaybackDiagnostic } from "../alertPlaybackDiagnostics";
import type { RuntimeAnalysisFailureEvidence } from "../../contracts/reporting/runtimeReportEvidence";
import type { BuffExpiryAlertDecision } from "../../domain/buff-expiry/precisionAlertTypes";
import type {
  BuffExpiryBox,
  BuffExpiryExpiryCluster,
  BuffExpiryExpiryClusterObservation,
  BuffExpiryPendingObservation,
  BuffExpiryPendingTrack,
  BuffExpiryTemporalCandidateTrack,
  BuffExpiryTrackedBuff,
} from "../../domain/buff-expiry/precisionTrackingTypes";
import type {
  BuffExpiryPrecisionBestGroupCandidate,
  BuffExpiryPrecisionBuffSlotLocalization,
  BuffExpiryPrecisionIconObservation,
  BuffExpiryPrecisionModuleVersions,
  BuffExpiryPrecisionTargetGroup,
} from "../buffExpiryPrecision/buffExpiryPrecisionTypes";
import type { BuffExpiryPrecisionRecentRoiFrame } from "../../runtime/buff-expiry/evidence/buffExpiryPrecisionRoiHistory";

export type {
  BuffExpiryBox,
  BuffExpiryExpiryCluster,
  BuffExpiryExpiryClusterObservation,
  BuffExpiryPendingObservation,
  BuffExpiryPendingTrack,
  BuffExpiryTemporalCandidateTrack,
  BuffExpiryTrackedBuff,
} from "../../domain/buff-expiry/precisionTrackingTypes";
export type {
  BuffExpiryAlertDecision,
  BuffExpiryAlertDecisionExistingGroup,
  BuffExpiryAlertDecisionReason,
  BuffExpiryAlertDecisionTrack,
} from "../../domain/buff-expiry/precisionAlertTypes";

export type BuffExpiryTopMatch = {
  buffId: string;
  name: string;
  kind: string;
  seconds: number | null;
  file: string | null;
  score: number;
  distance: number;
  timerPixels: number;
  digitPixels: number;
};

export type BuffExpiryAcceptedMatch = {
  box: BuffExpiryBox;
  buffId: string;
  name: string;
  seconds: number;
  score: number;
  buffMargin: number;
  secondMargin: number;
  reason: string;
  strength: "strong" | "weak";
  topMatches: BuffExpiryTopMatch[];
};

export type BuffExpiryTemporalCandidateMatch = BuffExpiryAcceptedMatch & {
  reason: "temporal-low-score";
  strength: "weak";
};

export type BuffExpiryRejectedMatch = {
  box: BuffExpiryBox;
  candidateBuffId: string | null;
  candidateName: string | null;
  candidateSeconds: number | null;
  score: number;
  reason: string;
  topMatches: BuffExpiryTopMatch[];
};

export type BuffExpiryIconImageData = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type BuffExpiryNormalizedBoxIcon = {
  box: BuffExpiryBox;
  imageData: BuffExpiryIconImageData;
};

export type BuffExpiryIconEvidenceSource =
  | "accepted"
  | "temporal"
  | "near-miss"
  | "confirmed"
  | "alerted";

export type BuffExpiryIconEvidence = {
  sampledAt: number;
  source: BuffExpiryIconEvidenceSource;
  slotKey: string;
  buffId: string | null;
  name: string | null;
  seconds: number | null;
  score: number;
  reason: string;
  box: BuffExpiryBox;
  topMatches: BuffExpiryTopMatch[];
  normalizedIconDataUrl: string | null;
};

export type BuffExpiryDebugDetectionBox = {
  box: BuffExpiryBox;
  previewDataUrl: string | null;
  acceptedMatch: BuffExpiryAcceptedMatch | null;
  rejectedMatch: BuffExpiryRejectedMatch | null;
  topMatches: BuffExpiryTopMatch[];
};

export type BuffExpiryDebugDetectionFrame = {
  sampledAt: number;
  boxCount: number;
  acceptedMatchCount: number;
  boxes: BuffExpiryDebugDetectionBox[];
  performance: BuffExpiryPerformanceMetrics | null;
};

export type BuffExpiryPerformanceMetrics = {
  totalMs: number;
  detectMs: number;
  normalizeAndMatchMs: number;
  countdownMs?: number;
  countdownCount?: number;
  countdownModelStatus?: "idle" | "loading" | "ready" | "error";
  matcherModelStatus?: "idle" | "loading" | "ready" | "error";
  boxCount: number;
  acceptedMatchCount: number;
  activeSampleCount: number;
};

export type BuffExpirySampleResponse = {
  boxes: BuffExpiryBox[];
  acceptedMatches: BuffExpiryAcceptedMatch[];
  hypothesisMatches?: BuffExpiryAcceptedMatch[];
  temporalCandidateMatches?: BuffExpiryTemporalCandidateMatch[];
  rejectedMatches: BuffExpiryRejectedMatch[];
  unsupported: boolean;
  unsupportedReason: string | null;
  inferredSide: number | null;
  roi: PixelRegion;
  normalizedBoxIcons?: BuffExpiryNormalizedBoxIcon[];
  performance: BuffExpiryPerformanceMetrics;
};

export type BuffExpirySampleRequest = {
  imageData: ImageData;
  roi: PixelRegion;
  sideCandidates: number[];
  selectedBuffIds: string[];
};

export type BuffExpiryLastAlertEvidenceTrack = {
  id: string;
  buffId: string;
  name: string;
  box: BuffExpiryBox;
  expiresAt: number;
  remainingSeconds: number;
  normalizedIconDataUrl: string | null;
};

export type BuffExpiryLastAlertEvidence = {
  alertedAt: number;
  alertLeadSeconds: number;
  clusterId: string | null;
  dueAt: number | null;
  triggeredTracks: BuffExpiryLastAlertEvidenceTrack[];
};

export type BuffExpiryRuntimeStatus =
  | "paused"
  | "no-stream"
  | "unsupported"
  | "waiting"
  | "tracking"
  | "alerted"
  | "unavailable";

export type BuffExpiryRuntimeState = {
  status: BuffExpiryRuntimeStatus;
  tracks: BuffExpiryTrackedBuff[];
  pendingTracks: BuffExpiryPendingTrack[];
  confirmationCandidateCount?: number;
  lastSampledAt: number | null;
  lastDetectedAt: number | null;
  lastAlertedAt: number | null;
  lastAlertPlayback?: AlertPlaybackDiagnostic | null;
  lastAlertEvidence?: BuffExpiryLastAlertEvidence | null;
  boxCount: number;
  acceptedMatchCount: number;
  unsupportedReason: string | null;
  performance: BuffExpiryPerformanceMetrics | null;
};

export type BuffExpiryRuntimeTraceTopMatch = BuffExpiryTopMatch;

export type BuffExpiryRuntimeTraceAcceptedMatch = Omit<BuffExpiryAcceptedMatch, "topMatches"> & {
  topMatches: BuffExpiryRuntimeTraceTopMatch[];
};

export type BuffExpiryRuntimeTraceRejectedMatch = Omit<BuffExpiryRejectedMatch, "topMatches"> & {
  topMatches: BuffExpiryRuntimeTraceTopMatch[];
};

export type BuffExpiryRuntimeTraceNextCandidate = {
  group: BuffExpiryPrecisionTargetGroup;
  boxIndex: number;
  accepted: boolean;
  winningGroup: BuffExpiryPrecisionTargetGroup | null;
  score: number;
  margin: number;
  decisionReason: string;
  countdownText: string | null;
  countdownSeconds: number | null;
  countdownStatus: string | null;
};

export type BuffExpiryRuntimeTraceNextObservation = {
  boxIndex: number;
  group: BuffExpiryPrecisionTargetGroup | null;
  score: number;
  margin: number;
  decisionReason: string;
  countdownText: string | null;
  countdownSeconds: number | null;
  countdownStatus: string | null;
};

export type BuffExpiryRuntimeTraceNextFrame = {
  targetObservationCount: number;
  countdownObservationCount: number;
  bestByGroup: BuffExpiryRuntimeTraceNextCandidate[];
  targetObservations: BuffExpiryRuntimeTraceNextObservation[];
  moduleVersions?: BuffExpiryPrecisionModuleVersions;
};

export type BuffExpiryRuntimeTraceFrame = {
  sampledAt: number;
  status: BuffExpiryRuntimeStatus;
  boxCount: number;
  acceptedMatchCount: number;
  temporalCandidateMatchCount?: number;
  temporalCandidateTrackCount?: number;
  expiryClusterCount?: number;
  confirmedExpiryClusterCount?: number;
  expiryClusters?: BuffExpiryRuntimeTraceExpiryCluster[];
  acceptedMatches: BuffExpiryRuntimeTraceAcceptedMatch[];
  rejectedMatches: BuffExpiryRuntimeTraceRejectedMatch[];
  tracks: BuffExpiryTrackedBuff[];
  pendingTracks: BuffExpiryPendingTrack[];
  shouldAlert: boolean;
  alertedTrackIds: string[];
  alertDecision?: BuffExpiryAlertDecision;
  next?: BuffExpiryRuntimeTraceNextFrame;
  unsupportedReason: string | null;
  performance: BuffExpiryPerformanceMetrics | null;
};

export type BuffExpiryRuntimeTraceExpiryCluster = {
  id: string;
  firstSeenAt: number;
  lastSeenAt: number;
  centerExpiresAt: number;
  confirmedAt: number | null;
  observationCount: number;
  inlierCount: number;
  distinctSlotCount: number;
  distinctBuffCount: number;
};

export type BuffExpirySnapshot = {
  sampledAt: number;
  parserEngine?: "rule" | "dl" | null;
  parserFallbackReason?: string | null;
  roi: PixelRegion | null;
  rawPreviewUrl: string | null;
  processedPreviewUrl: string | null;
  fullFramePreviewUrl: string | null;
  boxes: BuffExpiryBox[];
  displayBoxes?: BuffExpiryBox[];
  boxPreviewUrls?: Record<string, string>;
  boxPreviewImageData?: Record<string, BuffExpiryIconImageData>;
  nextIconObservations?: BuffExpiryPrecisionIconObservation[];
  nextBestByGroup?: BuffExpiryPrecisionBestGroupCandidate[];
  nextBuffSlotLocalization?: BuffExpiryPrecisionBuffSlotLocalization;
  nextModuleVersions?: BuffExpiryPrecisionModuleVersions;
  nextRecentRoiFrames?: BuffExpiryPrecisionRecentRoiFrame[];
  acceptedMatches: BuffExpiryAcceptedMatch[];
  hypothesisMatches?: BuffExpiryAcceptedMatch[];
  temporalCandidateMatches?: BuffExpiryTemporalCandidateMatch[];
  rejectedMatches: BuffExpiryRejectedMatch[];
  tracks: BuffExpiryTrackedBuff[];
  pendingTracks: BuffExpiryPendingTrack[];
  unsupportedReason: string | null;
  performance: BuffExpiryPerformanceMetrics | null;
  debugDetectionHistory?: BuffExpiryDebugDetectionFrame[];
  runtimeTrace?: BuffExpiryRuntimeTraceFrame[];
  alertDecisionHistory?: BuffExpiryAlertDecision[];
  iconEvidence?: BuffExpiryIconEvidence[];
  lastAlertEvidence?: BuffExpiryLastAlertEvidence | null;
  runtimeFailure?: RuntimeAnalysisFailureEvidence | null;
};
