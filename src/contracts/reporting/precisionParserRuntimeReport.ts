import type {
  PrecisionParserCpuBenchmarkResult,
  PrecisionParserCpuFallbackState,
  PrecisionParserRuntimeExecutionProvider,
  PrecisionParserRuntimeSelection,
} from "../recognition/precisionParserRuntime";

export const PRECISION_PARSER_RUNTIME_REPORT_SCHEMA =
  "maple-timer.precision-parser-runtime";
export const PRECISION_PARSER_RUNTIME_REPORT_VERSION = 1;

export type PrecisionParserCpuBenchmarkReport = Pick<
  PrecisionParserCpuBenchmarkResult,
  | "accepted"
  | "measurementDurationMs"
  | "parserAverageMs"
  | "requestAverageMs"
  | "parserP95Ms"
  | "requestP95Ms"
  | "maxParserP95Ms"
  | "maxRequestP95Ms"
  | "measuredAt"
> & {
  parserSampleCount: number;
  requestSampleCount: number;
};

export type PrecisionParserRemoteProviderReport = {
  status: "inactive" | "active" | "failed";
  controlPhase: string;
  consentVersion: string | null;
  generation: number;
  successfulFrames: number;
  failedFrames: number;
  droppedFrames: number;
  lastE2eMs: number | null;
  lastServerTotalMs: number | null;
  lastEncodedBytes: number | null;
  lastSampledAt: number | null;
  lastError: string | null;
  failure: {
    code: string;
    phase: string;
    retryable: boolean;
    technicalMessage: string;
  } | null;
};

export type PrecisionParserRemoteProviderReportInput = {
  phase: string;
  active: boolean;
  consentVersion: string | null;
  generation: number;
  parserFrames: Omit<
    PrecisionParserRemoteProviderReport,
    "status" | "controlPhase" | "consentVersion" | "generation" | "failure"
  >;
  failure: PrecisionParserRemoteProviderReport["failure"];
};

export type PrecisionParserRuntimeReport = Omit<
  PrecisionParserRuntimeSelection,
  "executionProvider"
> & {
  executionProvider: PrecisionParserRuntimeExecutionProvider;
  schema: typeof PRECISION_PARSER_RUNTIME_REPORT_SCHEMA;
  version: typeof PRECISION_PARSER_RUNTIME_REPORT_VERSION;
  cpuFallbackStatus: PrecisionParserCpuFallbackState["status"];
  cpuFallbackPhase: "benchmark" | "runtime" | null;
  cpuBenchmark: PrecisionParserCpuBenchmarkReport | null;
  consecutiveSlowSamples: number | null;
  technicalMessage: string | null;
  remoteProvider: PrecisionParserRemoteProviderReport | null;
};

export function buildPrecisionParserRuntimeReport(
  selection: PrecisionParserRuntimeSelection,
  fallback: PrecisionParserCpuFallbackState,
  remoteProviderInput?: PrecisionParserRemoteProviderReportInput | null,
): PrecisionParserRuntimeReport {
  const benchmark = "benchmark" in fallback ? fallback.benchmark : null;
  const technicalMessage =
    "technicalMessage" in fallback
      ? fallback.technicalMessage.trim().slice(0, 500) || null
      : null;

  return {
    schema: PRECISION_PARSER_RUNTIME_REPORT_SCHEMA,
    version: PRECISION_PARSER_RUNTIME_REPORT_VERSION,
    ...selection,
    executionProvider: remoteProviderInput?.active
      ? "remote"
      : selection.executionProvider,
    selectionSource: remoteProviderInput?.active
      ? "user-opt-in"
      : selection.selectionSource,
    cpuFallbackStatus: fallback.status,
    cpuFallbackPhase:
      fallback.status === "failed" ? fallback.phase : null,
    cpuBenchmark: benchmark ? summarizeBenchmark(benchmark) : null,
    consecutiveSlowSamples:
      fallback.status === "overloaded" ? fallback.consecutiveSlowSamples : null,
    technicalMessage,
    remoteProvider: remoteProviderInput
      ? summarizeRemoteProvider(remoteProviderInput)
      : null,
  };
}

function summarizeRemoteProvider(
  input: PrecisionParserRemoteProviderReportInput,
): PrecisionParserRemoteProviderReport {
  const failure = input.failure
    ? {
        code: input.failure.code.trim().slice(0, 120),
        phase: input.failure.phase.trim().slice(0, 120),
        retryable: input.failure.retryable,
        technicalMessage: input.failure.technicalMessage.trim().slice(0, 500),
      }
    : null;
  return {
    status: input.active ? "active" : failure ? "failed" : "inactive",
    controlPhase: input.phase.trim().slice(0, 120) || "unknown",
    consentVersion: input.consentVersion?.trim().slice(0, 120) || null,
    generation: Math.max(0, Math.trunc(input.generation)),
    successfulFrames: Math.max(0, Math.trunc(input.parserFrames.successfulFrames)),
    failedFrames: Math.max(0, Math.trunc(input.parserFrames.failedFrames)),
    droppedFrames: Math.max(0, Math.trunc(input.parserFrames.droppedFrames)),
    lastE2eMs: finiteOrNull(input.parserFrames.lastE2eMs),
    lastServerTotalMs: finiteOrNull(input.parserFrames.lastServerTotalMs),
    lastEncodedBytes: finiteOrNull(input.parserFrames.lastEncodedBytes),
    lastSampledAt: finiteOrNull(input.parserFrames.lastSampledAt),
    lastError: input.parserFrames.lastError?.trim().slice(0, 500) || null,
    failure,
  };
}

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

function summarizeBenchmark(
  benchmark: PrecisionParserCpuBenchmarkResult,
): PrecisionParserCpuBenchmarkReport {
  return {
    accepted: benchmark.accepted,
    measurementDurationMs: benchmark.measurementDurationMs,
    parserSampleCount: benchmark.parserSamplesMs.length,
    requestSampleCount: benchmark.requestSamplesMs.length,
    parserAverageMs: benchmark.parserAverageMs,
    requestAverageMs: benchmark.requestAverageMs,
    parserP95Ms: benchmark.parserP95Ms,
    requestP95Ms: benchmark.requestP95Ms,
    maxParserP95Ms: benchmark.maxParserP95Ms,
    maxRequestP95Ms: benchmark.maxRequestP95Ms,
    measuredAt: benchmark.measuredAt,
  };
}
