export type PrecisionParserExecutionProvider = "webgpu" | "wasm";
export type PrecisionParserRuntimeExecutionProvider =
  | PrecisionParserExecutionProvider
  | "remote";

export type PrecisionParserProviderSelectionSource =
  "default" | "user-opt-in" | "benchmark" | "recovery";

export type PrecisionParserRuntimeSelection = {
  executionProvider: PrecisionParserExecutionProvider;
  selectionSource: PrecisionParserProviderSelectionSource;
};

export type PrecisionParserRuntimeProvenance =
  Omit<PrecisionParserRuntimeSelection, "executionProvider"> & {
    executionProvider: PrecisionParserRuntimeExecutionProvider;
    recognitionEngine: "dl";
    parserVersion: string;
    modelId: string;
    modelInputWidth: number;
    modelInputHeight: number;
    onnxRuntimeVersion: string;
    wasmThreads: number | null;
  };

export type PrecisionParserRuntimePerformance = {
  totalMs: number;
  detectMs: number;
  boxCount: number;
  queueWaitMs?: number;
  resultAgeMs?: number | null;
  droppedSampleCount?: number;
  sampleIntervalMs?: number | null;
  inputTransport?: string;
  transportEncodedBytes?: number;
  transportEncodeMs?: number;
  transportDecodeMs?: number;
  remoteServerTotalMs?: number;
  remoteRoundTripMs?: number;
};

export const DEFAULT_PRECISION_PARSER_RUNTIME_SELECTION: PrecisionParserRuntimeSelection =
  {
    executionProvider: "webgpu",
    selectionSource: "default",
  };

export const PRECISION_PARSER_ONNX_RUNTIME_VERSION = "1.27.0";

export const PRECISION_PARSER_CPU_BENCHMARK_POLICY = {
  warmupRuns: 1,
  measurementDurationMs: 5_000,
  maxMeasuredRuns: 100,
  maxParserP95Ms: 500,
  maxRequestP95Ms: 900,
} as const;

export type PrecisionParserCpuBenchmarkResult = {
  accepted: boolean;
  parserSamplesMs: number[];
  requestSamplesMs: number[];
  measurementDurationMs: number;
  parserAverageMs: number;
  requestAverageMs: number;
  parserP95Ms: number;
  requestP95Ms: number;
  maxParserP95Ms: number;
  maxRequestP95Ms: number;
  measuredAt: number;
};

export type PrecisionParserCpuFallbackState =
  | { status: "idle" }
  | { status: "benchmarking" }
  | { status: "active"; benchmark: PrecisionParserCpuBenchmarkResult }
  | { status: "rejected"; benchmark: PrecisionParserCpuBenchmarkResult }
  | {
      status: "failed";
      phase: "benchmark";
      technicalMessage: string;
    }
  | {
      status: "failed";
      phase: "runtime";
      benchmark: PrecisionParserCpuBenchmarkResult;
      technicalMessage: string;
    }
  | {
      status: "overloaded";
      benchmark: PrecisionParserCpuBenchmarkResult;
      consecutiveSlowSamples: number;
    };
