import type { AlertReportContract } from "../../../../contracts/reporting/alertReportContract";

export type TroubleshooterFeature =
  | "buff-expiry"
  | "booster-expiry"
  | "rune"
  | "ultima-raid-equipment"
  | "hunt-stall"
  | "skill"
  | "special-core"
  | "unknown";

export type TroubleshooterTone =
  | "positive"
  | "warning"
  | "critical"
  | "info"
  | "neutral";

export type PipelineStageStatus =
  | "complete"
  | "warning"
  | "blocked"
  | "pending"
  | "unavailable";

export type ReplayCoverage =
  | "stored-evidence"
  | "decision-replayed"
  | "recognition-not-run"
  | "not-applicable";

export type EvidenceGroup =
  | "source"
  | "detection"
  | "recognition"
  | "runtime"
  | "alert";

export type TroubleshooterMetric = {
  id: string;
  label: string;
  value: string;
  detail?: string;
  tone?: TroubleshooterTone;
};

export type TroubleshooterDiagnostic = {
  id: string;
  tone: TroubleshooterTone;
  title: string;
  detail: string;
  stageId?: string;
};

export type EvidenceAsset = {
  id: string;
  group: EvidenceGroup;
  label: string;
  description: string;
  src: string;
  capturedAt: number | null;
  stageId?: string;
  metadata: TroubleshooterMetric[];
};

export type PipelineStage = {
  id: string;
  label: string;
  status: PipelineStageStatus;
  summary: string;
  detail: string;
  replayCoverage: ReplayCoverage;
  metrics: TroubleshooterMetric[];
  evidenceIds: string[];
};

export type TroubleshooterVerdict = {
  tone: TroubleshooterTone;
  title: string;
  detail: string;
};

export type TroubleshooterIncidentMetadata = {
  id: string;
  scenario: string | null;
  scenarioLabel: string | null;
  occurrence: string | null;
  affectedTargetLabel: string | null;
  evidenceSource: string | null;
  sampledAt: number | null;
  ageMs: number | null;
  windowStartedAt: number | null;
  windowEndedAt: number | null;
  frameCount: number;
  mediaCount: number;
  stateBinding: string | null;
  completeness: Record<string, boolean>;
  journalStatus: string | null;
  journalCapturedAt: number | null;
  journalEntryCount: number;
  journalLifecycleEntryCount?: number;
  relatedPlaybackEntryCount?: number;
  journalSelectedEventAt: number | null;
  correlation: {
    frameCount: number;
    cycleCount: number;
    playbackCount: number;
    relatedPlaybackCount?: number;
    configRevisionCount: number;
  };
  evidenceManifest: {
    referenceCount: number;
    producedReferenceCount: number;
    retainedReferenceCount: number;
    missingReferenceIds: string[];
    droppedReferenceIds: string[];
    unavailableReferenceIds: string[];
  };
};

export type TroubleshooterMetadata = {
  sampleId: string;
  kind: string;
  reportContract: AlertReportContract | null;
  schemaVersion: number | null;
  submittedAt: number | null;
  storedAt: number | null;
  issueReason: string;
  issueLabel: string;
  issueOtherCategory?: string | null;
  issueOtherCategoryLabel?: string | null;
  incident: TroubleshooterIncidentMetadata | null;
  sourceUrl: string;
  appBuildLabel: string;
  environmentLabel: string;
  captureLabel: string;
  frameSourceLabel: string;
  gameViewportLabel: string;
  viewportLabel: string;
};

export type TroubleshooterViewModel = {
  feature: TroubleshooterFeature;
  featureLabel: string;
  modeLabel: string;
  title: string;
  metadata: TroubleshooterMetadata;
  verdict: TroubleshooterVerdict;
  summaryMetrics: TroubleshooterMetric[];
  diagnostics: TroubleshooterDiagnostic[];
  stages: PipelineStage[];
  evidence: EvidenceAsset[];
  rawSample: unknown;
};

export type NormalizedDebugSample = {
  root: Record<string, unknown>;
  body: Record<string, unknown>;
  id: string;
  storedAt: number | null;
  kind: string;
  reportContract: AlertReportContract | null;
  schemaVersion: number | null;
  feature: TroubleshooterFeature;
};

export type FeatureAnalysis = Omit<
  TroubleshooterViewModel,
  "metadata" | "rawSample"
>;

export type FeatureAdapter = {
  feature: TroubleshooterFeature;
  analyze(sample: NormalizedDebugSample, now?: number): FeatureAnalysis;
};
