import type { BuffSlotEvidenceSource } from "../../lib/buffSlotParser/buffSlotFrameCapture";
import type {
  PrecisionParserDiagnosticEvent,
} from "../recognition/precisionParserDiagnostics";
import type {
  PrecisionParserRuntimePerformance,
  PrecisionParserRuntimeProvenance,
} from "../recognition/precisionParserRuntime";
import type { PrecisionParserFailureReason } from "../../lib/buffSlotParser/precisionParserAvailability";

export type RuntimeReportEvidenceFeature =
  | "skill-buff-duration"
  | "buff-expiry"
  | "special-core";

export type RuntimeReportEvidenceTarget = {
  feature: RuntimeReportEvidenceFeature;
  targetId?: string | null;
};

export type RuntimeParserEvidence = {
  engine: "rule" | "dl" | null;
  version: string | null;
  fallbackReason: string | null;
  runtime?: PrecisionParserRuntimeProvenance | null;
  performance?: PrecisionParserRuntimePerformance | null;
  failure?: RuntimeParserFailureEvidence | null;
};

export type RuntimeParserFailureEvidence = {
  reason: PrecisionParserFailureReason;
  technicalMessage: string;
  diagnostic: PrecisionParserDiagnosticEvent | null;
};

export type RuntimeAnalysisFailureStage =
  | "frame-capture"
  | "recognizer"
  | "feature-analysis";

export type RuntimeAnalysisFailureEvidence = {
  stage: RuntimeAnalysisFailureStage;
  code: string;
  technicalMessage: string;
  occurredAt: number;
};

export type RuntimeReportEvidenceEnvelope<TPayload = unknown> = {
  target: RuntimeReportEvidenceTarget;
  sampledAt: number;
  source: BuffSlotEvidenceSource;
  parser: RuntimeParserEvidence;
  payload: TPayload;
};

export type RuntimeReportEvidenceMetadata = Pick<
  RuntimeReportEvidenceEnvelope,
  "source" | "parser"
> & {
  sampledAt?: number;
};

export type RuntimeReportEvidenceCoordinator = {
  hasPending(target?: RuntimeReportEvidenceTarget): boolean;
  request<TPayload>(
    target: RuntimeReportEvidenceTarget,
    options?: { timeoutMs?: number },
  ): Promise<RuntimeReportEvidenceEnvelope<TPayload>>;
  publish<TPayload>(evidence: RuntimeReportEvidenceEnvelope<TPayload>): boolean;
  cancelAll(reason?: string): void;
};
