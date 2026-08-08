import type { AlertPlaybackDiagnostic } from "../../lib/alertPlaybackDiagnostics";
import type { SpecialCoreRuntimeState } from "../../lib/specialCore";

export type SpecialCoreRuntimeTraceSample = {
  sampledAt: number;
  parserEngine: "rule" | "dl" | null;
  parserVersion: string | null;
  parserFallbackReason: string | null;
  boxCount: number;
  detectedCount: number;
  candidateCount: number;
  detected: boolean;
  bestMatch: {
    bundleId: string | null;
    modelVersion: string | null;
    score: number | null;
    threshold: number | null;
    margin: number | null;
    gateScore: number | null;
    gateThreshold: number | null;
    gateMargin: number | null;
    decisionReason: string | null;
  } | null;
  statusBefore: SpecialCoreRuntimeState["status"];
  statusAfter: SpecialCoreRuntimeState["status"];
  pendingDetectionCount: number;
  activationId: number;
  activationStartedAt: number | null;
  activationConfirmedAt: number | null;
  cooldownEndsAt: number | null;
  alertDueAt: number | null;
  alertedAt: number | null;
  error: string | null;
};

export type SpecialCoreAlertPlaybackEvent = AlertPlaybackDiagnostic & {
  recordedAt: number;
};

export type SpecialCoreReportTimeline = {
  samples: SpecialCoreRuntimeTraceSample[];
  playbackEvents: SpecialCoreAlertPlaybackEvent[];
};
