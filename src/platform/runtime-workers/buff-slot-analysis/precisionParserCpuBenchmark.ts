import {
  PRECISION_PARSER_CPU_BENCHMARK_POLICY,
  type PrecisionParserCpuBenchmarkResult,
} from "../../../contracts/recognition/precisionParserRuntime";
import { sampleBuffSlotVideoFrame } from "../../../lib/buffSlotParser/buffSlotFrameCapture";
import {
  createBuffSlotAnalysisEngine,
  type BuffSlotAnalysisEngine,
} from "./buffSlotAnalysisWorkerClient";

type PrecisionParserCpuBenchmarkDependencies = {
  createEngine?: () => BuffSlotAnalysisEngine;
  now?: () => number;
  measuredAt?: () => number;
  sampleFrame?: (video: HTMLVideoElement) => ImageData;
  signal?: AbortSignal;
};

export async function runPrecisionParserCpuBenchmark(
  video: HTMLVideoElement,
  dependencies: PrecisionParserCpuBenchmarkDependencies = {},
): Promise<PrecisionParserCpuBenchmarkResult> {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new Error("precision-parser-cpu-benchmark-video-unavailable");
  }

  const createEngine =
    dependencies.createEngine ?? (() => createBuffSlotAnalysisEngine());
  const now = dependencies.now ?? (() => performance.now());
  const measuredAt = dependencies.measuredAt ?? (() => Date.now());
  const sampleFrame =
    dependencies.sampleFrame ??
    ((currentVideo) =>
      sampleBuffSlotVideoFrame(currentVideo, { includePreview: false })
        .imageData);
  const source = sampleFrame(video);
  const engine = createEngine();
  const signal = dependencies.signal;
  let didResetEngine = false;
  const resetEngine = () => {
    if (didResetEngine) {
      return;
    }
    didResetEngine = true;
    engine.reset();
  };
  const abortBenchmark = () => resetEngine();
  signal?.addEventListener("abort", abortBenchmark, { once: true });

  try {
    throwIfBenchmarkAborted(signal);
    for (
      let index = 0;
      index < PRECISION_PARSER_CPU_BENCHMARK_POLICY.warmupRuns;
      index += 1
    ) {
      await processBenchmarkSample(engine, source, measuredAt(), signal);
    }

    const parserSamplesMs: number[] = [];
    const requestSamplesMs: number[] = [];
    let measurementDurationMs = 0;
    while (
      measurementDurationMs <
        PRECISION_PARSER_CPU_BENCHMARK_POLICY.measurementDurationMs &&
      requestSamplesMs.length <
        PRECISION_PARSER_CPU_BENCHMARK_POLICY.maxMeasuredRuns
    ) {
      const startedAt = now();
      const response = await processBenchmarkSample(
        engine,
        source,
        measuredAt() + requestSamplesMs.length,
        signal,
      );
      const requestDurationMs = Math.max(0, now() - startedAt);
      measurementDurationMs += requestDurationMs;
      requestSamplesMs.push(roundMs(requestDurationMs));
      parserSamplesMs.push(response.performance.detectMs);
    }

    return evaluatePrecisionParserCpuBenchmark({
      parserSamplesMs,
      requestSamplesMs,
      measurementDurationMs: roundMs(measurementDurationMs),
      measuredAt: measuredAt(),
    });
  } finally {
    signal?.removeEventListener("abort", abortBenchmark);
    resetEngine();
  }
}

export function evaluatePrecisionParserCpuBenchmark({
  parserSamplesMs,
  requestSamplesMs,
  measurementDurationMs,
  measuredAt,
}: {
  parserSamplesMs: number[];
  requestSamplesMs: number[];
  measurementDurationMs: number;
  measuredAt: number;
}): PrecisionParserCpuBenchmarkResult {
  if (
    parserSamplesMs.length === 0 ||
    parserSamplesMs.length !== requestSamplesMs.length
  ) {
    throw new Error("precision-parser-cpu-benchmark-sample-count-invalid");
  }

  const parserAverageMs = average(parserSamplesMs);
  const requestAverageMs = average(requestSamplesMs);
  const parserP95Ms = percentile95(parserSamplesMs);
  const requestP95Ms = percentile95(requestSamplesMs);
  return {
    accepted:
      parserAverageMs <=
        PRECISION_PARSER_CPU_BENCHMARK_POLICY.maxParserP95Ms &&
      requestAverageMs <=
        PRECISION_PARSER_CPU_BENCHMARK_POLICY.maxRequestP95Ms &&
      parserP95Ms <= PRECISION_PARSER_CPU_BENCHMARK_POLICY.maxParserP95Ms &&
      requestP95Ms <= PRECISION_PARSER_CPU_BENCHMARK_POLICY.maxRequestP95Ms,
    parserSamplesMs,
    requestSamplesMs,
    measurementDurationMs,
    parserAverageMs,
    requestAverageMs,
    parserP95Ms,
    requestP95Ms,
    maxParserP95Ms: PRECISION_PARSER_CPU_BENCHMARK_POLICY.maxParserP95Ms,
    maxRequestP95Ms: PRECISION_PARSER_CPU_BENCHMARK_POLICY.maxRequestP95Ms,
    measuredAt,
  };
}

async function processBenchmarkSample(
  engine: BuffSlotAnalysisEngine,
  source: ImageData,
  sampledAt: number,
  signal?: AbortSignal,
) {
  throwIfBenchmarkAborted(signal);
  const processPromise = engine.process({
    imageData: cloneImageData(source),
    sampledAt,
    runtimeSelection: {
      executionProvider: "wasm",
      selectionSource: "benchmark",
    },
  });
  if (!signal) {
    return processPromise;
  }
  return raceWithAbort(processPromise, signal);
}

function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(createBenchmarkAbortError());
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(createBenchmarkAbortError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function throwIfBenchmarkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createBenchmarkAbortError();
  }
}

function createBenchmarkAbortError(): Error {
  const error = new Error("precision-parser-cpu-benchmark-aborted");
  error.name = "AbortError";
  return error;
}

function cloneImageData(source: ImageData): ImageData {
  return new ImageData(
    new Uint8ClampedArray(source.data),
    source.width,
    source.height,
  );
}

function percentile95(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return roundMs(sorted[index] ?? 0);
}

function average(samples: number[]): number {
  return roundMs(
    samples.reduce((total, sample) => total + sample, 0) / samples.length,
  );
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}
