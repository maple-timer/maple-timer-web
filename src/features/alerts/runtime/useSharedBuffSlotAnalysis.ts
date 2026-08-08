import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createBuffSlotAnalysisEngine,
  type BuffSlotAnalysisEngine,
} from "../../../platform/runtime-workers/buff-slot-analysis/buffSlotAnalysisWorkerClient";
import type { BuffSlotAnalysisPerformance } from "../../../runtime/buff-slot/analysis/buffSlotAnalysisRuntime";
import { BuffSlotAnalysisSampleDroppedError } from "../../../runtime/buff-slot/analysis/buffSlotAnalysisRuntime";
import {
  sampleBuffSlotVideoFrame,
  type BuffSlotVideoFrameSample,
} from "../../../lib/buffSlotParser/buffSlotFrameCapture";
import type { BuffSlotAnalysis } from "../../../recognition/buff-slot/parser/parseBuffSlots";
import {
  createInitialPrecisionParserReadiness,
  normalizePrecisionParserError,
  PrecisionParserUnavailableError,
  type PrecisionParserReadiness,
} from "../../../lib/buffSlotParser/precisionParserAvailability";
import {
  applyPrecisionParserDiagnosticEvent,
  createPrecisionParserDiagnosticEvent,
  getFailedPrecisionParserDiagnosticStep,
  type PrecisionParserDiagnosticEvent,
} from "../../../contracts/recognition/precisionParserDiagnostics";
import { trackPrecisionParserReadiness } from "../../../lib/analyticsEvents";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import { useLazyRef } from "./useLazyRef";
import {
  DEFAULT_PRECISION_PARSER_RUNTIME_SELECTION,
  PRECISION_PARSER_ONNX_RUNTIME_VERSION,
  PRECISION_PARSER_CPU_BENCHMARK_POLICY,
  type PrecisionParserCpuFallbackState,
  type PrecisionParserRuntimeSelection,
} from "../../../contracts/recognition/precisionParserRuntime";
import {
  attachRemoteRecognitionWarmTraceHandle,
  getRemoteRecognitionWarmTraceHandle,
  type RemoteRecognitionWarmTraceHandle,
  type RemoteRecognitionWarmTraceSharedPort,
  type RemoteRecognitionWarmTraceSharedStage,
  type RemoteRecognitionWarmTraceTerminalOutcome,
} from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import {
  RemoteRecognitionControlContractError,
  RemoteRecognitionParserFrameDroppedError,
  type RemoteRecognitionParserFrameProvider,
} from "../../../contracts/remote-recognition/remoteRecognitionControlContract";
import type { RuntimeParserFailureEvidence } from "../../../contracts/reporting/runtimeReportEvidence";
import { runPrecisionParserCpuBenchmark } from "../../../platform/runtime-workers/buff-slot-analysis/precisionParserCpuBenchmark";
import {
  createPrecisionParserInputTransportDiagnostics,
  DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT,
  PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
  type PrecisionParserInputTransport,
  type PrecisionParserInputTransportDiagnostics,
} from "../../../contracts/recognition/precisionParserInputTransport";
import { encodeVp8ParserFrame } from "../../../platform/remote-recognition/vp8ParserPreviewCodec";
import {
  cropPrecisionParserInput,
  projectTransportAnalysisToSourcePixels,
} from "../../../runtime/buff-slot/analysis/precisionParserInputTransport";

export type SharedBuffSlotFrameSample = Pick<
  BuffSlotVideoFrameSample,
  | "rawPreviewUrl"
  | "regionLabel"
  | "sourceSize"
  | "captureSize"
  | "coordinateSpace"
  | "sourceRegion"
  | "roi"
>;

export type SharedBuffSlotAnalysisResult = {
  sampledAt: number;
  frame: SharedBuffSlotFrameSample;
  analysis: BuffSlotAnalysis;
  performance: BuffSlotAnalysisPerformance;
};

export class SharedBuffSlotAnalysisUnavailableError extends Error {
  readonly frame: SharedBuffSlotFrameSample;
  readonly failureReason: PrecisionParserUnavailableError["failureReason"];
  readonly technicalMessage: string;
  readonly diagnostic: PrecisionParserUnavailableError["diagnostic"];

  constructor(
    error: PrecisionParserUnavailableError,
    frame: SharedBuffSlotFrameSample,
  ) {
    super(error.message);
    this.name = "SharedBuffSlotAnalysisUnavailableError";
    this.frame = frame;
    this.failureReason = error.failureReason;
    this.technicalMessage = error.technicalMessage;
    this.diagnostic = error.diagnostic;
  }
}

export class SharedBuffSlotAnalysisDroppedError extends Error {
  readonly sampledAt: number | null;
  readonly replacedBySampledAt: number | null;

  constructor(error: BuffSlotAnalysisSampleDroppedError) {
    super(error.message);
    this.name = "SharedBuffSlotAnalysisDroppedError";
    this.sampledAt = error.sampledAt;
    this.replacedBySampledAt = error.replacedBySampledAt;
  }
}

export function isSharedBuffSlotAnalysisDroppedError(
  error: unknown,
): error is SharedBuffSlotAnalysisDroppedError {
  return error instanceof SharedBuffSlotAnalysisDroppedError;
}

export function getSharedBuffSlotAnalysisFailureFrame(
  error: unknown,
): SharedBuffSlotFrameSample | null {
  return error instanceof SharedBuffSlotAnalysisUnavailableError
    ? error.frame
    : null;
}

export function getSharedBuffSlotAnalysisFailureEvidence(
  error: unknown,
): RuntimeParserFailureEvidence | null {
  const failure =
    error instanceof SharedBuffSlotAnalysisUnavailableError ||
    error instanceof PrecisionParserUnavailableError
      ? error
      : null;
  if (!failure) {
    return null;
  }
  return {
    reason: failure.failureReason,
    technicalMessage: limitParserFailureText(failure.technicalMessage),
    diagnostic: failure.diagnostic
      ? {
          ...failure.diagnostic,
          technicalMessage: limitParserFailureText(
            failure.diagnostic.technicalMessage,
          ),
          details: Object.fromEntries(
            Object.entries(failure.diagnostic.details)
              .slice(0, 16)
              .map(([key, value]) => [
                key,
                typeof value === "string"
                  ? limitParserFailureText(value, 240)
                  : value,
              ]),
          ),
        }
      : null,
  };
}

export type GetSharedBuffSlotAnalysis = (options: {
  sampledAt: number;
  video: HTMLVideoElement;
  sampleBuffSlotFrame?: MonitoringFrameContext["sampleBuffSlotFrame"];
  includePreview?: boolean;
}) => Promise<SharedBuffSlotAnalysisResult>;

type CacheEntry = {
  key: CacheKey;
  promise: Promise<SharedBuffSlotAnalysisResult>;
};

type CacheKey = {
  sampledAt: number;
  video: HTMLVideoElement;
  videoWidth: number;
  videoHeight: number;
  sampleBuffSlotFrame: MonitoringFrameContext["sampleBuffSlotFrame"] | null;
  executionProvider: PrecisionParserRuntimeSelection["executionProvider"];
  selectionSource: PrecisionParserRuntimeSelection["selectionSource"];
  inputTransport: PrecisionParserInputTransport;
};

export function useSharedBuffSlotAnalysis({
  stream,
  shouldIncludeEvidenceSource,
  inputTransport = DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT,
  remoteParserProvider,
  onRemoteParserUnavailable,
  remoteRecognitionWarmTracePort,
}: {
  stream: MediaStream | null;
  shouldIncludeEvidenceSource?: (sampledAt: number) => boolean;
  inputTransport?: PrecisionParserInputTransport;
  remoteParserProvider?: RemoteRecognitionParserFrameProvider;
  onRemoteParserUnavailable?: (error: unknown, sampledAt: number) => void;
  remoteRecognitionWarmTracePort?: RemoteRecognitionWarmTraceSharedPort;
}): {
  getSharedBuffSlotAnalysis: GetSharedBuffSlotAnalysis;
  resetSharedBuffSlotAnalysis: () => void;
  precisionParserReadiness: PrecisionParserReadiness;
  precisionParserRuntimeSelection: PrecisionParserRuntimeSelection;
  precisionParserRuntimeKey: string;
  precisionParserCpuFallback: PrecisionParserCpuFallbackState;
  retryPrecisionParser: () => void;
  startPrecisionParserCpuFallback: () => Promise<void>;
  cancelPrecisionParserCpuFallbackBenchmark: () => void;
  stopPrecisionParserCpuFallback: () => void;
  precisionParserInputTransportDiagnostics: PrecisionParserInputTransportDiagnostics;
} {
  const cacheRef = useRef<CacheEntry | null>(null);
  const analysisGenerationRef = useRef(0);
  const unavailableErrorRef = useRef<PrecisionParserUnavailableError | null>(
    null,
  );
  const latestVideoRef = useRef<HTMLVideoElement | null>(null);
  const benchmarkGenerationRef = useRef(0);
  const benchmarkPromiseRef = useRef<Promise<void> | null>(null);
  const benchmarkAbortControllerRef = useRef<AbortController | null>(null);
  const consecutiveSlowCpuSamplesRef = useRef(0);
  const [precisionParserCpuFallback, setPrecisionParserCpuFallback] =
    useState<PrecisionParserCpuFallbackState>({ status: "idle" });
  const runtimeSelection = useMemo<PrecisionParserRuntimeSelection>(
    () => getPrecisionParserRuntimeSelection(precisionParserCpuFallback),
    [precisionParserCpuFallback],
  );
  const runtimeSelectionKey =
    inputTransport === PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW
      ? "remote:user-opt-in"
      : `${runtimeSelection.executionProvider}:${runtimeSelection.selectionSource}`;
  const inputTransportKey =
    inputTransport === DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT
      ? ""
      : `:${inputTransport}`;
  const precisionParserRuntimeKey = `${runtimeSelectionKey}:${getPrecisionParserRuntimeLifecycle(precisionParserCpuFallback)}${inputTransportKey}`;
  const [precisionParserInputTransportDiagnostics, setInputTransportDiagnostics] =
    useState(() => createPrecisionParserInputTransportDiagnostics(inputTransport));
  const [precisionParserReadiness, setPrecisionParserReadiness] = useState(
    createInitialPrecisionParserReadiness,
  );
  const diagnosticListenerRef = useRef<
    (event: PrecisionParserDiagnosticEvent) => void
  >(() => undefined);
  diagnosticListenerRef.current = (event) => {
    setPrecisionParserReadiness((current) => ({
      ...current,
      diagnostic: applyPrecisionParserDiagnosticEvent(
        current.diagnostic,
        event,
      ),
    }));
  };
  const engineRef = useLazyRef<BuffSlotAnalysisEngine>(() =>
    createBuffSlotAnalysisEngine({
      onDiagnostic: (event) => diagnosticListenerRef.current(event),
    }),
  );

  const resetSharedBuffSlotAnalysis = useCallback(() => {
    analysisGenerationRef.current += 1;
    cacheRef.current = null;
    unavailableErrorRef.current = null;
    consecutiveSlowCpuSamplesRef.current = 0;
    engineRef.current.reset();
    setPrecisionParserReadiness(createInitialPrecisionParserReadiness());
  }, [engineRef]);

  const cancelPrecisionParserCpuFallbackBenchmark = useCallback(() => {
    benchmarkGenerationRef.current += 1;
    benchmarkAbortControllerRef.current?.abort();
    benchmarkAbortControllerRef.current = null;
    benchmarkPromiseRef.current = null;
    setPrecisionParserCpuFallback({ status: "idle" });
  }, []);

  const retryPrecisionParser = useCallback(() => {
    cancelPrecisionParserCpuFallbackBenchmark();
    resetSharedBuffSlotAnalysis();
  }, [cancelPrecisionParserCpuFallbackBenchmark, resetSharedBuffSlotAnalysis]);

  const stopPrecisionParserCpuFallback = useCallback(() => {
    cancelPrecisionParserCpuFallbackBenchmark();
    resetSharedBuffSlotAnalysis();
  }, [cancelPrecisionParserCpuFallbackBenchmark, resetSharedBuffSlotAnalysis]);

  const startPrecisionParserCpuFallback = useCallback(async () => {
    if (benchmarkPromiseRef.current) {
      return benchmarkPromiseRef.current;
    }
    const generation = benchmarkGenerationRef.current + 1;
    benchmarkGenerationRef.current = generation;
    const video = latestVideoRef.current;
    if (!video) {
      setPrecisionParserCpuFallback({
        status: "failed",
        phase: "benchmark",
        technicalMessage: "precision-parser-cpu-benchmark-video-unavailable",
      });
      return;
    }

    const abortController = new AbortController();
    benchmarkAbortControllerRef.current = abortController;
    setPrecisionParserCpuFallback({ status: "benchmarking" });
    const benchmarkPromise = runPrecisionParserCpuBenchmark(video, {
      signal: abortController.signal,
    })
      .then((benchmark) => {
        if (benchmarkGenerationRef.current !== generation) {
          return;
        }
        if (!benchmark.accepted) {
          setPrecisionParserCpuFallback({ status: "rejected", benchmark });
          return;
        }
        cacheRef.current = null;
        unavailableErrorRef.current = null;
        consecutiveSlowCpuSamplesRef.current = 0;
        engineRef.current.reset();
        setPrecisionParserReadiness(createInitialPrecisionParserReadiness());
        setPrecisionParserCpuFallback({ status: "active", benchmark });
      })
      .catch((error) => {
        if (
          benchmarkGenerationRef.current !== generation ||
          abortController.signal.aborted
        ) {
          return;
        }
        setPrecisionParserCpuFallback({
          status: "failed",
          phase: "benchmark",
          technicalMessage:
            error instanceof Error
              ? error.message
              : "precision-parser-cpu-benchmark-failed",
        });
      })
      .finally(() => {
        if (benchmarkGenerationRef.current === generation) {
          benchmarkPromiseRef.current = null;
          if (benchmarkAbortControllerRef.current === abortController) {
            benchmarkAbortControllerRef.current = null;
          }
        }
      });
    benchmarkPromiseRef.current = benchmarkPromise;
    return benchmarkPromise;
  }, [engineRef]);

  const getSharedBuffSlotAnalysis = useCallback<GetSharedBuffSlotAnalysis>(
    ({ sampledAt, video, sampleBuffSlotFrame, includePreview = false }) => {
      latestVideoRef.current = video;
      const key = createCacheKey({
        sampledAt,
        video,
        sampleBuffSlotFrame: sampleBuffSlotFrame ?? null,
        runtimeSelection,
        inputTransport,
      });
      const cached = cacheRef.current;
      if (cached && isSameCacheKey(cached.key, key)) {
        return cached.promise;
      }
      const sampleFrame =
        sampleBuffSlotFrame ??
        ((options) => sampleBuffSlotVideoFrame(video, options));
      if (unavailableErrorRef.current) {
        if (shouldIncludeEvidenceSource?.(sampledAt) !== true) {
          safelyCancelWarmTrace(
            remoteRecognitionWarmTracePort,
            "fallback",
          );
          return Promise.reject(unavailableErrorRef.current);
        }
        const failedSample = sampleFrame({ includePreview: true });
        const failedWarmTrace = createWarmTraceScope({
          carrier: failedSample,
          inputTransport,
          port: remoteRecognitionWarmTracePort,
        });
        terminateWarmTraceStage(
          failedWarmTrace,
          "captureCropUs",
          "fallback",
        );
        const promise = Promise.reject(
          new SharedBuffSlotAnalysisUnavailableError(
            unavailableErrorRef.current,
            toSharedBuffSlotFrameSample(failedSample),
          ),
        );
        cacheRef.current = { key, promise };
        return promise;
      }

      setPrecisionParserReadiness((current) =>
        current.status === "ready"
          ? current
          : {
              status: "checking",
              failureReason: null,
              diagnostic: current.diagnostic,
            },
      );

      const sampledFrame = sampleFrame({
        includePreview:
          includePreview || shouldIncludeEvidenceSource?.(sampledAt) === true,
      });
      const warmTrace = createWarmTraceScope({
        carrier: sampledFrame,
        inputTransport,
        port: remoteRecognitionWarmTracePort,
      });
      const frame = toSharedBuffSlotFrameSample(sampledFrame);
      const analysisGeneration = analysisGenerationRef.current;
      const preparedInputPromise = preparePrecisionParserInput({
        inputTransport,
        sampledFrame,
        sampledAt,
        remoteParserProvider,
        warmTrace,
      })
        .then((prepared) => {
          const transportMetrics = prepared.transportMetrics;
          if (transportMetrics) {
            setInputTransportDiagnostics((current) =>
              recordSuccessfulTransportSample(
                current,
                sampledAt,
                transportMetrics,
              ),
            );
          }
          return prepared;
        })
        .catch((error) => {
          if (inputTransport === PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW) {
            setInputTransportDiagnostics((current) =>
              error instanceof RemoteRecognitionParserFrameDroppedError
                ? recordDroppedTransportSample(current, sampledAt)
                : recordFailedTransportSample(current, sampledAt, error),
            );
          }
          throw error;
        });
      const promise = preparedInputPromise
        .then(async (prepared) => ({
          prepared,
          response:
            prepared.remoteResponse ??
            (await engineRef.current.process({
              imageData: prepared.imageData,
              sampledAt,
              runtimeSelection,
              ...(prepared.buffSlotInputMode
                ? { buffSlotInputMode: prepared.buffSlotInputMode }
                : {}),
            })),
        }))
        .then(({ prepared, response }) => {
          if (analysisGenerationRef.current !== analysisGeneration) {
            terminateWarmTraceStage(
              warmTrace,
              "responseProjectionUs",
              "replaced",
            );
            throw new BuffSlotAnalysisSampleDroppedError({
              sampledAt,
              replacedBySampledAt: null,
            });
          }
          if (
            runtimeSelection.executionProvider === "wasm" &&
            precisionParserCpuFallback.status === "active"
          ) {
            const isSlow = isSlowCpuSample(response.performance);
            consecutiveSlowCpuSamplesRef.current = isSlow
              ? consecutiveSlowCpuSamplesRef.current + 1
              : 0;
            if (consecutiveSlowCpuSamplesRef.current >= 3) {
              setPrecisionParserCpuFallback({
                status: "overloaded",
                benchmark: precisionParserCpuFallback.benchmark,
                consecutiveSlowSamples: consecutiveSlowCpuSamplesRef.current,
              });
              engineRef.current.reset();
              throw new PrecisionParserUnavailableError({
                failureReason: "runtime-failed",
                technicalMessage: "precision-parser-cpu-runtime-too-slow",
                diagnostic: createPrecisionParserDiagnosticEvent({
                  stage: "first-inference",
                  status: "failed",
                  code: "cpu-runtime-too-slow",
                  technicalMessage: "precision-parser-cpu-runtime-too-slow",
                  details: {
                    totalMs: response.performance.totalMs,
                    detectMs: response.performance.detectMs,
                    resultAgeMs: response.performance.resultAgeMs ?? null,
                    droppedSampleCount:
                      response.performance.droppedSampleCount ?? 0,
                  },
                }),
              });
            }
          }
          setPrecisionParserReadiness((current) => ({
            status: "ready",
            failureReason: null,
            diagnostic: current.diagnostic,
          }));
          trackPrecisionParserReadiness("ready");
          const analysis = prepared.projectToSource
            ? projectTransportAnalysisToSourcePixels({
                analysis: response.analysis,
                source: sampledFrame.imageData,
                roi: sampledFrame.roi,
              })
            : response.analysis;
          const performance = prepared.remoteResponse
            ? response.performance
            : prepared.transportMetrics
            ? {
                ...response.performance,
                totalMs: roundMs(
                  response.performance.totalMs +
                    prepared.transportMetrics.encodeMs +
                    prepared.transportMetrics.decodeMs,
                ),
                inputTransport,
                transportEncodedBytes:
                  prepared.transportMetrics.encodedBytes,
                transportEncodeMs: roundMs(
                  prepared.transportMetrics.encodeMs,
                ),
                transportDecodeMs: roundMs(
                  prepared.transportMetrics.decodeMs,
                ),
                remoteServerTotalMs: roundMs(
                  prepared.transportMetrics.serverTotalMs,
                ),
                remoteRoundTripMs: roundMs(
                  Math.max(
                    0,
                    prepared.transportMetrics.e2eMs -
                      prepared.transportMetrics.encodeMs,
                  ),
                ),
              }
            : response.performance;
          const result = {
            sampledAt,
            frame,
            analysis,
            performance,
          };
          if (warmTrace) {
            if (
              !attachRemoteRecognitionWarmTraceHandle(
                result,
                warmTrace.handle,
              )
            ) {
              terminateWarmTraceStage(
                warmTrace,
                "responseProjectionUs",
                "failed",
              );
            } else {
              completeWarmTraceStage(warmTrace, "responseProjectionUs");
            }
          }
          return result;
        })
        .catch((error) => {
          if (analysisGenerationRef.current !== analysisGeneration) {
            terminateWarmTraceStage(
              warmTrace,
              "responseProjectionUs",
              "replaced",
            );
            throw new SharedBuffSlotAnalysisDroppedError(
              error instanceof BuffSlotAnalysisSampleDroppedError
                ? error
                : new BuffSlotAnalysisSampleDroppedError({
                    sampledAt,
                    replacedBySampledAt: null,
                  }),
            );
          }
          if (cacheRef.current?.key === key) {
            cacheRef.current = null;
          }
          if (error instanceof BuffSlotAnalysisSampleDroppedError) {
            terminateWarmTraceStage(
              warmTrace,
              "responseProjectionUs",
              "replaced",
            );
            throw new SharedBuffSlotAnalysisDroppedError(error);
          }
          if (error instanceof RemoteRecognitionParserFrameDroppedError) {
            terminateWarmTraceStage(
              warmTrace,
              "remoteRoundTripUs",
              error.replacedBySampledAt === null ? "dropped" : "replaced",
            );
            throw new SharedBuffSlotAnalysisDroppedError(
              new BuffSlotAnalysisSampleDroppedError({
                sampledAt: error.sampledAt,
                replacedBySampledAt: error.replacedBySampledAt,
              }),
            );
          }
          const normalizedError = normalizeSharedPrecisionParserError(
            error,
            inputTransport,
          );
          terminateWarmTraceAtCurrentStage(
            warmTrace,
            error,
            inputTransport === PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW
              ? "fallback"
              : "failed",
          );
          if (inputTransport === PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW) {
            onRemoteParserUnavailable?.(error, sampledAt);
          }
          if (
            runtimeSelection.executionProvider === "wasm" &&
            precisionParserCpuFallback.status === "active" &&
            normalizedError.technicalMessage !==
              "precision-parser-cpu-runtime-too-slow"
          ) {
            engineRef.current.reset();
            setPrecisionParserCpuFallback({
              status: "failed",
              phase: "runtime",
              benchmark: precisionParserCpuFallback.benchmark,
              technicalMessage: normalizedError.technicalMessage,
            });
          }
          unavailableErrorRef.current = normalizedError;
          setPrecisionParserReadiness((current) => {
            let diagnostic = current.diagnostic;
            if (normalizedError.diagnostic) {
              diagnostic = applyPrecisionParserDiagnosticEvent(
                diagnostic,
                normalizedError.diagnostic,
              );
            } else if (!getFailedPrecisionParserDiagnosticStep(diagnostic)) {
              diagnostic = applyPrecisionParserDiagnosticEvent(
                diagnostic,
                createPrecisionParserDiagnosticEvent({
                  stage: fallbackStageForReason(normalizedError.failureReason),
                  status: "failed",
                  code: normalizedError.failureReason,
                  technicalMessage: normalizedError.technicalMessage,
                }),
              );
            }
            return {
              status: "unavailable",
              failureReason: normalizedError.failureReason,
              diagnostic,
            };
          });
          trackPrecisionParserReadiness(
            "unavailable",
            normalizedError.failureReason,
            normalizedError.diagnostic?.stage,
          );
          throw new SharedBuffSlotAnalysisUnavailableError(
            normalizedError,
            frame,
          );
        });

      cacheRef.current = { key, promise };
      return promise;
    },
    [
      engineRef,
      precisionParserCpuFallback,
      inputTransport,
      runtimeSelection,
      shouldIncludeEvidenceSource,
      remoteParserProvider,
      onRemoteParserUnavailable,
      remoteRecognitionWarmTracePort,
    ],
  );

  useEffect(() => {
    resetSharedBuffSlotAnalysis();
    setInputTransportDiagnostics(
      createPrecisionParserInputTransportDiagnostics(inputTransport),
    );
  }, [
    inputTransport,
    resetSharedBuffSlotAnalysis,
    runtimeSelectionKey,
    stream,
  ]);

  useEffect(() => {
    cancelPrecisionParserCpuFallbackBenchmark();
    latestVideoRef.current = null;
  }, [cancelPrecisionParserCpuFallbackBenchmark, stream]);

  useEffect(
    () => () => {
      benchmarkGenerationRef.current += 1;
      benchmarkAbortControllerRef.current?.abort();
      benchmarkAbortControllerRef.current = null;
      benchmarkPromiseRef.current = null;
    },
    [],
  );

  return {
    getSharedBuffSlotAnalysis,
    resetSharedBuffSlotAnalysis,
    precisionParserReadiness,
    precisionParserRuntimeSelection: runtimeSelection,
    precisionParserRuntimeKey,
    precisionParserCpuFallback,
    retryPrecisionParser,
    startPrecisionParserCpuFallback,
    cancelPrecisionParserCpuFallbackBenchmark,
    stopPrecisionParserCpuFallback,
    precisionParserInputTransportDiagnostics,
  };
}

function getPrecisionParserRuntimeSelection(
  state: PrecisionParserCpuFallbackState,
): PrecisionParserRuntimeSelection {
  if (
    state.status === "active" ||
    state.status === "overloaded" ||
    (state.status === "failed" && state.phase === "runtime")
  ) {
    return {
      executionProvider: "wasm",
      selectionSource: "user-opt-in",
    };
  }
  return DEFAULT_PRECISION_PARSER_RUNTIME_SELECTION;
}

function getPrecisionParserRuntimeLifecycle(
  state: PrecisionParserCpuFallbackState,
): "default" | "active" | "overloaded" | "runtime-failed" {
  if (state.status === "active") {
    return "active";
  }
  if (state.status === "overloaded") {
    return "overloaded";
  }
  if (state.status === "failed" && state.phase === "runtime") {
    return "runtime-failed";
  }
  return "default";
}

function isSlowCpuSample(performance: BuffSlotAnalysisPerformance): boolean {
  return (
    performance.detectMs >
      PRECISION_PARSER_CPU_BENCHMARK_POLICY.maxParserP95Ms ||
    performance.totalMs >
      PRECISION_PARSER_CPU_BENCHMARK_POLICY.maxRequestP95Ms ||
    (performance.resultAgeMs ?? 0) > 1_500 ||
    (performance.droppedSampleCount ?? 0) > 1
  );
}

function fallbackStageForReason(
  reason: PrecisionParserUnavailableError["failureReason"],
): PrecisionParserDiagnosticEvent["stage"] {
  if (reason === "worker-failed") {
    return "analysis-worker";
  }
  if (reason === "webgpu-unavailable") {
    return "webgpu-api";
  }
  if (reason === "model-load-failed") {
    return "model-session";
  }
  return "first-inference";
}

function normalizeSharedPrecisionParserError(
  error: unknown,
  inputTransport: PrecisionParserInputTransport,
): PrecisionParserUnavailableError {
  if (inputTransport !== PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW) {
    return normalizePrecisionParserError(error);
  }
  const failurePhase =
    error instanceof RemoteRecognitionControlContractError
      ? error.phase
      : "client-transport";
  const failureCode =
    error instanceof RemoteRecognitionControlContractError
      ? error.code
      : "runtime-failed";
  const technicalMessage =
    error instanceof Error && error.message
      ? error.message
      : "remote-recognition-parser-provider-failed";
  return new PrecisionParserUnavailableError({
    failureReason: "runtime-failed",
    technicalMessage,
    diagnostic: createPrecisionParserDiagnosticEvent({
      stage: "first-inference",
      status: "failed",
      code: `remote-${failurePhase}-${failureCode}`,
      technicalMessage,
      details: {
        executionProvider: "remote",
        inputTransport,
        remoteFailurePhase: failurePhase,
        remoteFailureCode: failureCode,
      },
    }),
  });
}

function createCacheKey({
  sampledAt,
  video,
  sampleBuffSlotFrame,
  runtimeSelection,
  inputTransport,
}: {
  sampledAt: number;
  video: HTMLVideoElement;
  sampleBuffSlotFrame: MonitoringFrameContext["sampleBuffSlotFrame"] | null;
  runtimeSelection: PrecisionParserRuntimeSelection;
  inputTransport: PrecisionParserInputTransport;
}): CacheKey {
  return {
    sampledAt,
    video,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    sampleBuffSlotFrame,
    executionProvider: runtimeSelection.executionProvider,
    selectionSource: runtimeSelection.selectionSource,
    inputTransport,
  };
}

function isSameCacheKey(left: CacheKey, right: CacheKey): boolean {
  return (
    left.sampledAt === right.sampledAt &&
    left.video === right.video &&
    left.videoWidth === right.videoWidth &&
    left.videoHeight === right.videoHeight &&
    left.sampleBuffSlotFrame === right.sampleBuffSlotFrame &&
    left.executionProvider === right.executionProvider &&
    left.selectionSource === right.selectionSource &&
    left.inputTransport === right.inputTransport
  );
}

async function preparePrecisionParserInput({
  inputTransport,
  sampledFrame,
  sampledAt,
  remoteParserProvider,
  warmTrace,
}: {
  inputTransport: PrecisionParserInputTransport;
  sampledFrame: BuffSlotVideoFrameSample;
  sampledAt: number;
  remoteParserProvider?: RemoteRecognitionParserFrameProvider;
  warmTrace: RemoteRecognitionWarmTraceScope | null;
}): Promise<{
  imageData: ImageData;
  buffSlotInputMode: "topRightQuadrant" | null;
  projectToSource: boolean;
  remoteResponse: {
    sampledAt: number;
    analysis: BuffSlotAnalysis;
    performance: BuffSlotAnalysisPerformance;
    unsupported: false;
    unsupportedReason: null;
  } | null;
  transportMetrics: {
    encodedBytes: number;
    encodeMs: number;
    decodeMs: number;
    e2eMs: number;
    serverTotalMs: number;
  } | null;
}> {
  if (inputTransport !== PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW) {
    completeWarmTraceStage(warmTrace, "captureCropUs");
    completeZeroWarmTraceStage(warmTrace, "encodeUs");
    completeZeroWarmTraceStage(warmTrace, "remoteRoundTripUs");
    return {
      imageData: sampledFrame.imageData,
      buffSlotInputMode: null,
      projectToSource: false,
      remoteResponse: null,
      transportMetrics: null,
    };
  }

  let topRightInput: ImageData;
  try {
    topRightInput = cropPrecisionParserInput(
      sampledFrame.imageData,
      sampledFrame.roi,
    );
    completeWarmTraceStage(warmTrace, "captureCropUs");
  } catch (error) {
    terminateWarmTraceStage(warmTrace, "captureCropUs", "failed");
    throw error;
  }
  if (!remoteParserProvider) {
    terminateWarmTraceStage(warmTrace, "encodeUs", "fallback");
    throw new Error("remote-recognition-parser-provider-unavailable");
  }
  let encoded: Awaited<ReturnType<typeof encodeVp8ParserFrame>>;
  try {
    encoded = await encodeVp8ParserFrame(topRightInput);
    completeWarmTraceStage(warmTrace, "encodeUs");
  } catch (error) {
    terminateWarmTraceStage(warmTrace, "encodeUs", "fallback");
    throw error;
  }
  let remote: Awaited<ReturnType<RemoteRecognitionParserFrameProvider>>;
  try {
    remote = await remoteParserProvider({
      sampledAt,
      width: topRightInput.width,
      height: topRightInput.height,
      encodedVp8: encoded.encodedVp8,
      encodeMs: encoded.encodeMs,
    });
    completeWarmTraceStage(warmTrace, "remoteRoundTripUs");
  } catch (error) {
    terminateWarmTraceStage(
      warmTrace,
      "remoteRoundTripUs",
      getRemoteWarmTraceFailureOutcome(error),
    );
    throw error;
  }
  const frame = remote.response.frame;
  const analysis: BuffSlotAnalysis = {
    icons: [],
    boxes: frame.boxes,
    engine: "dl",
    parserVersion: frame.parser.modelId,
    runtime: {
      executionProvider: "remote",
      selectionSource: "user-opt-in",
      recognitionEngine: "dl",
      parserVersion: frame.parser.modelId,
      modelId: frame.parser.modelId,
      modelInputWidth: frame.parser.modelInputWidth,
      modelInputHeight: frame.parser.modelInputHeight,
      onnxRuntimeVersion:
        frame.parser.onnxRuntimeVersion || PRECISION_PARSER_ONNX_RUNTIME_VERSION,
      wasmThreads: null,
    },
  };
  return {
    imageData: topRightInput,
    buffSlotInputMode: "topRightQuadrant",
    projectToSource: true,
    remoteResponse: {
      sampledAt,
      analysis,
      performance: {
        totalMs: roundMs(remote.e2eMs),
        detectMs: roundMs(frame.timings.serverTotalMs),
        boxCount: frame.parser.boxCount,
        inputTransport,
        transportEncodedBytes: frame.encodedBytes,
        transportEncodeMs: roundMs(encoded.encodeMs),
        transportDecodeMs: roundMs(frame.timings.decodeMs),
        remoteServerTotalMs: roundMs(frame.timings.serverTotalMs),
        remoteRoundTripMs: roundMs(
          Math.max(0, remote.e2eMs - encoded.encodeMs),
        ),
      },
      unsupported: false,
      unsupportedReason: null,
    },
    transportMetrics: {
      encodedBytes: frame.encodedBytes,
      encodeMs: encoded.encodeMs,
      decodeMs: frame.timings.decodeMs,
      e2eMs: remote.e2eMs,
      serverTotalMs: frame.timings.serverTotalMs,
    },
  };
}

type RemoteRecognitionWarmTraceScope = {
  handle: RemoteRecognitionWarmTraceHandle;
  port: RemoteRecognitionWarmTraceSharedPort;
  nextStageIndex: number;
  terminal: boolean;
};

function createWarmTraceScope({
  carrier,
  inputTransport,
  port,
}: {
  carrier: object;
  inputTransport: PrecisionParserInputTransport;
  port?: RemoteRecognitionWarmTraceSharedPort;
}): RemoteRecognitionWarmTraceScope | null {
  if (!port) {
    return null;
  }
  const handle = getRemoteRecognitionWarmTraceHandle(carrier);
  if (!handle) {
    return null;
  }
  try {
    const series = port.getSeries(handle);
    if (!series) {
      return null;
    }
    const expectedProvider =
      inputTransport === PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW
        ? "remote"
        : "local";
    const scope = { handle, port, nextStageIndex: 0, terminal: false };
    if (series.provider !== expectedProvider) {
      terminateWarmTraceStage(scope, "captureCropUs", "fallback");
      return null;
    }
    return scope;
  } catch {
    return null;
  }
}

function completeWarmTraceStage(
  scope: RemoteRecognitionWarmTraceScope | null,
  stage: RemoteRecognitionWarmTraceSharedStage,
): boolean {
  if (!scope || scope.terminal) {
    return false;
  }
  try {
    const completed = scope.port.completeStage(scope.handle, stage);
    if (completed) {
      scope.nextStageIndex += 1;
    }
    if (!completed && scope.port.getSeries(scope.handle) === null) {
      scope.terminal = true;
    }
    return completed;
  } catch {
    return false;
  }
}

function completeZeroWarmTraceStage(
  scope: RemoteRecognitionWarmTraceScope | null,
  stage: "encodeUs" | "remoteRoundTripUs",
): boolean {
  if (!scope || scope.terminal) {
    return false;
  }
  try {
    const completed = scope.port.completeZeroStage(scope.handle, stage);
    if (completed) {
      scope.nextStageIndex += 1;
    }
    if (!completed && scope.port.getSeries(scope.handle) === null) {
      scope.terminal = true;
    }
    return completed;
  } catch {
    return false;
  }
}

function terminateWarmTraceStage(
  scope: RemoteRecognitionWarmTraceScope | null,
  stage: RemoteRecognitionWarmTraceSharedStage,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): boolean {
  if (!scope || scope.terminal) {
    return false;
  }
  try {
    const terminated = scope.port.terminateStage(scope.handle, stage, outcome);
    if (terminated || scope.port.getSeries(scope.handle) === null) {
      scope.terminal = true;
    }
    return terminated;
  } catch {
    return false;
  }
}

function terminateWarmTraceAtCurrentStage(
  scope: RemoteRecognitionWarmTraceScope | null,
  error: unknown,
  defaultOutcome: RemoteRecognitionWarmTraceTerminalOutcome,
): void {
  if (!scope || scope.terminal) {
    return;
  }
  const stages: RemoteRecognitionWarmTraceSharedStage[] = [
    "captureCropUs",
    "encodeUs",
    "remoteRoundTripUs",
    "responseProjectionUs",
  ];
  const outcome =
    error instanceof RemoteRecognitionParserFrameDroppedError
      ? getRemoteWarmTraceFailureOutcome(error)
      : defaultOutcome;
  const stage = stages[scope.nextStageIndex];
  if (stage) {
    terminateWarmTraceStage(scope, stage, outcome);
  }
}

function getRemoteWarmTraceFailureOutcome(
  error: unknown,
): RemoteRecognitionWarmTraceTerminalOutcome {
  if (error instanceof RemoteRecognitionParserFrameDroppedError) {
    return error.replacedBySampledAt === null ? "dropped" : "replaced";
  }
  return "fallback";
}

function safelyCancelWarmTrace(
  port: RemoteRecognitionWarmTraceSharedPort | undefined,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): void {
  try {
    port?.cancelSharedOpen(outcome);
  } catch {
    // Instrumentation must not change parser availability behavior.
  }
}

function recordSuccessfulTransportSample(
  current: PrecisionParserInputTransportDiagnostics,
  sampledAt: number,
  metrics: {
    encodedBytes: number;
    encodeMs: number;
    decodeMs: number;
    e2eMs: number;
    serverTotalMs: number;
  },
): PrecisionParserInputTransportDiagnostics {
  const successfulSamples = current.successfulSamples + 1;
  return {
    ...current,
    successfulSamples,
    averageEncodedBytes: updateAverage(
      current.averageEncodedBytes,
      current.successfulSamples,
      metrics.encodedBytes,
    ),
    averageEncodeMs: updateAverage(
      current.averageEncodeMs,
      current.successfulSamples,
      metrics.encodeMs,
    ),
    averageDecodeMs: updateAverage(
      current.averageDecodeMs,
      current.successfulSamples,
      metrics.decodeMs,
    ),
    averageE2eMs: updateAverage(
      current.averageE2eMs,
      current.successfulSamples,
      metrics.e2eMs,
    ),
    averageServerTotalMs: updateAverage(
      current.averageServerTotalMs,
      current.successfulSamples,
      metrics.serverTotalMs,
    ),
    lastEncodedBytes: metrics.encodedBytes,
    lastEncodeMs: metrics.encodeMs,
    lastDecodeMs: metrics.decodeMs,
    lastE2eMs: metrics.e2eMs,
    lastServerTotalMs: metrics.serverTotalMs,
    lastSampledAt: sampledAt,
    lastError: null,
  };
}

function recordFailedTransportSample(
  current: PrecisionParserInputTransportDiagnostics,
  sampledAt: number,
  error: unknown,
): PrecisionParserInputTransportDiagnostics {
  return {
    ...current,
    failedSamples: current.failedSamples + 1,
    lastSampledAt: sampledAt,
    lastError: limitParserFailureText(
      error instanceof Error && error.message
        ? error.message
        : "vp8-parser-preview-failed",
      240,
    ),
  };
}

function recordDroppedTransportSample(
  current: PrecisionParserInputTransportDiagnostics,
  sampledAt: number,
): PrecisionParserInputTransportDiagnostics {
  return {
    ...current,
    droppedSamples: current.droppedSamples + 1,
    lastSampledAt: sampledAt,
    lastError: null,
  };
}

function updateAverage(
  currentAverage: number | null,
  currentCount: number,
  next: number,
): number {
  if (currentAverage === null || currentCount <= 0) {
    return next;
  }
  return (currentAverage * currentCount + next) / (currentCount + 1);
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function toSharedBuffSlotFrameSample(
  frame: BuffSlotVideoFrameSample,
): SharedBuffSlotFrameSample {
  return {
    rawPreviewUrl: frame.rawPreviewUrl,
    regionLabel: frame.regionLabel,
    sourceSize: frame.sourceSize,
    ...(frame.captureSize ? { captureSize: frame.captureSize } : {}),
    ...(frame.coordinateSpace
      ? { coordinateSpace: frame.coordinateSpace }
      : {}),
    ...(frame.sourceRegion ? { sourceRegion: frame.sourceRegion } : {}),
    roi: frame.roi,
  };
}

function limitParserFailureText(value: string, maxLength?: number): string;
function limitParserFailureText(value: null, maxLength?: number): null;
function limitParserFailureText(
  value: string | null,
  maxLength?: number,
): string | null;
function limitParserFailureText(
  value: string | null,
  maxLength = 1_000,
): string | null {
  if (value === null) {
    return null;
  }
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
