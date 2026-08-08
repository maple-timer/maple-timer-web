import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPrecisionParserDiagnosticEvent,
  PrecisionParserDiagnosticError,
} from "../../../contracts/recognition/precisionParserDiagnostics";
import { PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW } from "../../../contracts/recognition/precisionParserInputTransport";
import { BuffSlotAnalysisSampleDroppedError } from "../../../runtime/buff-slot/analysis/buffSlotAnalysisRuntime";
import {
  createRemoteRecognitionControlMarker,
  RemoteRecognitionParserFrameDroppedError,
} from "../../../contracts/remote-recognition/remoteRecognitionControlContract";
import {
  attachRemoteRecognitionWarmTraceHandle,
  getRemoteRecognitionWarmTraceHandle,
} from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import { RemoteRecognitionWarmTraceCollector } from "../../../application/remote-recognition/remoteRecognitionWarmTraceCollector";
import { useSharedBuffSlotAnalysis } from "./useSharedBuffSlotAnalysis";

const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  reset: vi.fn(),
  sampleFrame: vi.fn(),
  trackReadiness: vi.fn(),
  setDiagnosticListener: vi.fn(),
  runCpuBenchmark: vi.fn(),
  encodeVp8: vi.fn(),
}));

vi.mock(
  "../../../platform/runtime-workers/buff-slot-analysis/buffSlotAnalysisWorkerClient",
  () => ({
    createBuffSlotAnalysisEngine: (options?: {
      onDiagnostic?: (event: unknown) => void;
    }) => {
      mocks.setDiagnosticListener(options?.onDiagnostic);
      return {
        process: mocks.process,
        reset: mocks.reset,
      };
    },
  }),
);

vi.mock("../../../lib/buffSlotParser/buffSlotFrameCapture", () => ({
  sampleBuffSlotVideoFrame: mocks.sampleFrame,
}));

vi.mock("../../../lib/analyticsEvents", () => ({
  trackPrecisionParserReadiness: mocks.trackReadiness,
}));

vi.mock(
  "../../../platform/runtime-workers/buff-slot-analysis/precisionParserCpuBenchmark",
  () => ({
    runPrecisionParserCpuBenchmark: mocks.runCpuBenchmark,
  }),
);

vi.mock("../../../platform/remote-recognition/vp8ParserPreviewCodec", () => ({
  encodeVp8ParserFrame: mocks.encodeVp8,
}));

describe("useSharedBuffSlotAnalysis", () => {
  beforeEach(() => {
    mocks.process.mockReset();
    mocks.reset.mockReset();
    mocks.sampleFrame.mockReset();
    mocks.trackReadiness.mockReset();
    mocks.setDiagnosticListener.mockReset();
    mocks.runCpuBenchmark.mockReset();
    mocks.encodeVp8.mockReset();
    mocks.sampleFrame.mockReturnValue({
      imageData: {
        width: 1920,
        height: 1080,
        data: new Uint8ClampedArray(4),
      },
      rawPreviewUrl: null,
      regionLabel: "960x540",
      sourceSize: { width: 1920, height: 1080 },
      roi: { x: 960, y: 0, width: 960, height: 540 },
    });
  });

  it("blocks silent retries after WebGPU failure until the user retries", async () => {
    mocks.process.mockRejectedValueOnce(
      new Error(
        "no available backend found. ERR: [webgpu] Failed to get GPU adapter",
      ),
    );
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({ stream: null }),
    );
    const video = {
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;

    await act(async () => {
      await expect(
        result.current.getSharedBuffSlotAnalysis({ sampledAt: 1_000, video }),
      ).rejects.toThrow("정밀 감지용 WebGPU를 사용할 수 없습니다.");
    });

    expect(result.current.precisionParserReadiness).toMatchObject({
      status: "unavailable",
      failureReason: "webgpu-unavailable",
      diagnostic: {
        steps: {
          "webgpu-api": {
            status: "failed",
          },
        },
      },
    });
    expect(mocks.process).toHaveBeenCalledTimes(1);
    expect(mocks.trackReadiness).toHaveBeenCalledWith(
      "unavailable",
      "webgpu-unavailable",
      undefined,
    );

    await act(async () => {
      await expect(
        result.current.getSharedBuffSlotAnalysis({ sampledAt: 2_000, video }),
      ).rejects.toThrow("정밀 감지용 WebGPU를 사용할 수 없습니다.");
    });
    expect(mocks.process).toHaveBeenCalledTimes(1);

    mocks.process.mockResolvedValueOnce({
      sampledAt: 3_000,
      analysis: {
        icons: [],
        boxes: [],
        engine: "dl",
        parserVersion: "test-dl-parser",
      },
      performance: { totalMs: 4, detectMs: 3, boxCount: 0 },
      unsupported: false,
      unsupportedReason: null,
    });
    act(() => {
      result.current.retryPrecisionParser();
    });
    await act(async () => {
      await result.current.getSharedBuffSlotAnalysis({
        sampledAt: 3_000,
        video,
      });
    });

    expect(mocks.process).toHaveBeenCalledTimes(2);
    expect(result.current.precisionParserReadiness).toMatchObject({
      status: "ready",
      failureReason: null,
    });
    expect(mocks.trackReadiness).toHaveBeenCalledWith("ready");
  });

  it("keeps an ONNX session failure separate from an adapter failure", async () => {
    const diagnostic = createPrecisionParserDiagnosticEvent({
      stage: "model-session",
      status: "failed",
      code: "model-session-create-failed",
      technicalMessage:
        "no available backend found. ERR: [webgpu] Failed to get GPU adapter",
    });
    mocks.process.mockRejectedValueOnce(
      new PrecisionParserDiagnosticError(
        diagnostic.technicalMessage ?? "session failed",
        diagnostic,
      ),
    );
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({ stream: null }),
    );

    await act(async () => {
      await expect(
        result.current.getSharedBuffSlotAnalysis({
          sampledAt: 5_000,
          video: {
            videoWidth: 1920,
            videoHeight: 1080,
          } as HTMLVideoElement,
        }),
      ).rejects.toThrow("정밀 감지를 시작하지 못했습니다.");
    });

    expect(result.current.precisionParserReadiness).toMatchObject({
      status: "unavailable",
      failureReason: "runtime-failed",
      diagnostic: {
        steps: {
          "model-session": {
            status: "failed",
            code: "model-session-create-failed",
          },
        },
      },
    });
    expect(mocks.trackReadiness).toHaveBeenCalledWith(
      "unavailable",
      "runtime-failed",
      "model-session",
    );
  });

  it("uses a frame-context sampler and shares its parser result within one tick", async () => {
    mocks.process.mockResolvedValue({
      sampledAt: 4_000,
      analysis: {
        icons: [],
        boxes: [],
        engine: "dl",
        parserVersion: "test-dl-parser",
      },
      performance: { totalMs: 4, detectMs: 3, boxCount: 0 },
      unsupported: false,
      unsupportedReason: null,
    });
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({ stream: null }),
    );
    const video = {
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const sampleBuffSlotFrame = vi.fn(() => mocks.sampleFrame());

    let firstResult: Awaited<
      ReturnType<typeof result.current.getSharedBuffSlotAnalysis>
    >;
    let secondResult: Awaited<
      ReturnType<typeof result.current.getSharedBuffSlotAnalysis>
    >;
    await act(async () => {
      [firstResult, secondResult] = await Promise.all([
        result.current.getSharedBuffSlotAnalysis({
          sampledAt: 4_000,
          video,
          sampleBuffSlotFrame,
        }),
        result.current.getSharedBuffSlotAnalysis({
          sampledAt: 4_000,
          video,
          sampleBuffSlotFrame,
        }),
      ]);
    });

    expect(firstResult!).toBe(secondResult!);
    expect(sampleBuffSlotFrame).toHaveBeenCalledTimes(1);
    expect(mocks.sampleFrame).toHaveBeenCalledTimes(1);
    expect(mocks.process).toHaveBeenCalledTimes(1);
    expect(mocks.process).toHaveBeenCalledWith({
      imageData: mocks.sampleFrame.mock.results[0]?.value.imageData,
      sampledAt: 4_000,
      runtimeSelection: {
        executionProvider: "webgpu",
        selectionSource: "default",
      },
    });
  });

  it("runs the parser remotely on a VP8 Q1 frame and restores source-space icons from the original frame", async () => {
    const source = createTestImageData(4, 4, (x, y) => [
      x * 40,
      y * 40,
      7,
      255,
    ]);
    const sampledFrame = {
      imageData: source,
      rawPreviewUrl: null,
      regionLabel: "2x2",
      sourceSize: { width: 4, height: 4 },
      roi: { x: 2, y: 0, width: 2, height: 2 },
    };
    mocks.sampleFrame.mockReturnValue(sampledFrame);
    mocks.encodeVp8.mockResolvedValue({
      encodedVp8: new Uint8Array([1, 2, 3]).buffer,
      encodedBytes: 1_234,
      encodeMs: 2.5,
    });
    const remoteParserProvider = vi.fn().mockResolvedValue({
      e2eMs: 82.5,
      response: {
        contract: createRemoteRecognitionControlMarker(),
        status: "ok",
        sessionId: "session-1",
        purpose: "parser-provider",
        expiresAt: Date.now() + 15_000,
        frame: {
          sequence: 1,
          sampledAt: 4_000,
          encodedBytes: 1_234,
          width: 2,
          height: 2,
          parser: {
            engine: "onnxruntime-native",
            modelId: "test-remote-parser",
            modelInputWidth: 544,
            modelInputHeight: 960,
            onnxRuntimeVersion: "1.24.4",
            executionProviders: ["CoreMLExecutionProvider"],
            boxCount: 1,
          },
          boxes: [{ x: 0, y: 0, size: 2, confidence: 0.99, score: 990 }],
          timings: {
            decodeMs: 1.5,
            preprocessMs: 7,
            inferenceMs: 42,
            postprocessMs: 4,
            serverTotalMs: 58,
          },
        },
      },
    });
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({
        stream: null,
        inputTransport: PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
        remoteParserProvider,
      }),
    );

    let analysisResult: Awaited<
      ReturnType<typeof result.current.getSharedBuffSlotAnalysis>
    >;
    await act(async () => {
      analysisResult = await result.current.getSharedBuffSlotAnalysis({
        sampledAt: 4_000,
        video: {
          videoWidth: 4,
          videoHeight: 4,
        } as HTMLVideoElement,
      });
    });

    const codecInput = mocks.encodeVp8.mock.calls[0]?.[0] as ImageData;
    expect(codecInput).toMatchObject({ width: 2, height: 2 });
    expect(Array.from(codecInput.data.slice(0, 8))).toEqual([
      80, 0, 7, 255, 120, 0, 7, 255,
    ]);
    expect(remoteParserProvider).toHaveBeenCalledWith({
      sampledAt: 4_000,
      width: 2,
      height: 2,
      encodedVp8: expect.any(ArrayBuffer),
      encodeMs: 2.5,
    });
    expect(mocks.process).not.toHaveBeenCalled();
    expect(analysisResult!.analysis.boxes[0]).toMatchObject({ x: 2, y: 0 });
    expect(
      Array.from(analysisResult!.analysis.icons[0].data.slice(0, 4)),
    ).toEqual([61, 21, 7, 255]);
    expect(result.current.precisionParserRuntimeKey).toBe(
      "remote:user-opt-in:default:vp8-preview-v1",
    );
    expect(analysisResult!.analysis.runtime).toMatchObject({
      executionProvider: "remote",
      selectionSource: "user-opt-in",
    });
    expect(
      result.current.precisionParserInputTransportDiagnostics,
    ).toMatchObject({
      successfulSamples: 1,
      failedSamples: 0,
      averageEncodedBytes: 1_234,
      averageEncodeMs: 2.5,
      averageDecodeMs: 1.5,
      averageE2eMs: 82.5,
      averageServerTotalMs: 58,
    });
    expect(analysisResult!.performance).toMatchObject({
      totalMs: 82.5,
      inputTransport: "vp8-preview-v1",
      transportEncodedBytes: 1_234,
      transportEncodeMs: 2.5,
      transportDecodeMs: 1.5,
      remoteServerTotalMs: 58,
      remoteRoundTripMs: 80,
    });
  });

  it("carries one armed remote trace through cached crop, encode, provider, and projection", async () => {
    const source = createTestImageData(4, 4, () => [10, 20, 30, 255]);
    const sampledFrame = {
      imageData: source,
      rawPreviewUrl: null,
      regionLabel: "2x2",
      sourceSize: { width: 4, height: 4 },
      roi: { x: 2, y: 0, width: 2, height: 2 },
    };
    const warmTrace = createAttachedWarmTrace(sampledFrame);
    mocks.sampleFrame.mockReturnValue(sampledFrame);
    mocks.encodeVp8.mockResolvedValue({
      encodedVp8: new Uint8Array([1, 2, 3]).buffer,
      encodedBytes: 3,
      encodeMs: 1,
    });
    const remoteParserProvider = vi
      .fn()
      .mockResolvedValue(createRemoteParserResult(4_000));
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({
        stream: null,
        inputTransport: PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
        remoteParserProvider,
        remoteRecognitionWarmTracePort: warmTrace.collector,
      }),
    );
    const video = {
      videoWidth: 4,
      videoHeight: 4,
    } as HTMLVideoElement;

    let first: Awaited<
      ReturnType<typeof result.current.getSharedBuffSlotAnalysis>
    >;
    let second: Awaited<
      ReturnType<typeof result.current.getSharedBuffSlotAnalysis>
    >;
    await act(async () => {
      [first, second] = await Promise.all([
        result.current.getSharedBuffSlotAnalysis({ sampledAt: 4_000, video }),
        result.current.getSharedBuffSlotAnalysis({ sampledAt: 4_000, video }),
      ]);
    });

    expect(first!).toBe(second!);
    expect(getRemoteRecognitionWarmTraceHandle(first!)).toBe(warmTrace.handle);
    expect(Object.keys(first!)).toEqual([
      "sampledAt",
      "frame",
      "analysis",
      "performance",
    ]);
    expect(JSON.stringify(first!)).not.toContain("warm-trace");
    expect(mocks.sampleFrame).toHaveBeenCalledTimes(1);
    expect(mocks.encodeVp8).toHaveBeenCalledTimes(1);
    expect(remoteParserProvider).toHaveBeenCalledTimes(1);
    expect(warmTrace.collector.snapshot()).toEqual([]);

    const featureClaim = warmTrace.collector.claimFeatureOwner(
      warmTrace.handle,
      "skill",
    );
    expect(featureClaim).not.toBeNull();
    warmTrace.collector.terminateFeatureStage(
      featureClaim!,
      "matcherOcrUs",
      "failed",
    );
    expect(warmTrace.collector.snapshot()[0]).toMatchObject({
      outcome: "failed",
      terminalStage: "matcherOcrUs",
      stageDurationsUs: {
        captureCropUs: 2_000,
        encodeUs: 1_000,
        remoteRoundTripUs: 1_000,
        responseProjectionUs: 1_000,
        matcherOcrUs: 2_000,
        temporalDecisionUs: null,
      },
    });
  });

  it.each([
    {
      name: "transient drop",
      error: new RemoteRecognitionParserFrameDroppedError({
        sampledAt: 4_000,
        replacedBySampledAt: null,
      }),
      outcome: "dropped",
      terminalStage: "remoteRoundTripUs",
    },
    {
      name: "replacement drop",
      error: new RemoteRecognitionParserFrameDroppedError({
        sampledAt: 4_000,
        replacedBySampledAt: 5_000,
      }),
      outcome: "replaced",
      terminalStage: "remoteRoundTripUs",
    },
  ] as const)(
    "terminalizes a provider $name before error translation",
    async ({ error, outcome, terminalStage }) => {
      const source = createTestImageData(4, 4, () => [10, 20, 30, 255]);
      const sampledFrame = {
        imageData: source,
        rawPreviewUrl: null,
        regionLabel: "2x2",
        sourceSize: { width: 4, height: 4 },
        roi: { x: 2, y: 0, width: 2, height: 2 },
      };
      const warmTrace = createAttachedWarmTrace(sampledFrame);
      mocks.sampleFrame.mockReturnValue(sampledFrame);
      mocks.encodeVp8.mockResolvedValue({
        encodedVp8: new Uint8Array([1]).buffer,
        encodedBytes: 1,
        encodeMs: 1,
      });
      const { result } = renderHook(() =>
        useSharedBuffSlotAnalysis({
          stream: null,
          inputTransport: PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
          remoteParserProvider: vi.fn().mockRejectedValue(error),
          remoteRecognitionWarmTracePort: warmTrace.collector,
        }),
      );

      await act(async () => {
        await expect(
          result.current.getSharedBuffSlotAnalysis({
            sampledAt: 4_000,
            video: { videoWidth: 4, videoHeight: 4 } as HTMLVideoElement,
          }),
        ).rejects.toMatchObject({
          name: "SharedBuffSlotAnalysisDroppedError",
        });
      });

      expect(warmTrace.collector.snapshot()[0]).toMatchObject({
        outcome,
        terminalStage,
      });
    },
  );

  it("terminalizes a codec failure as fallback before the unavailable callback", async () => {
    const source = createTestImageData(4, 4, () => [10, 20, 30, 255]);
    const sampledFrame = {
      imageData: source,
      rawPreviewUrl: null,
      regionLabel: "2x2",
      sourceSize: { width: 4, height: 4 },
      roi: { x: 2, y: 0, width: 2, height: 2 },
    };
    const warmTrace = createAttachedWarmTrace(sampledFrame);
    mocks.sampleFrame.mockReturnValue(sampledFrame);
    const codecError = new Error("vp8-failed");
    mocks.encodeVp8.mockRejectedValue(codecError);
    const onRemoteParserUnavailable = vi.fn(() => {
      expect(warmTrace.collector.snapshot()[0]).toMatchObject({
        outcome: "fallback",
        terminalStage: "encodeUs",
      });
    });
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({
        stream: null,
        inputTransport: PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
        remoteParserProvider: vi.fn(),
        onRemoteParserUnavailable,
        remoteRecognitionWarmTracePort: warmTrace.collector,
      }),
    );

    await act(async () => {
      await expect(
        result.current.getSharedBuffSlotAnalysis({
          sampledAt: 4_000,
          video: { videoWidth: 4, videoHeight: 4 } as HTMLVideoElement,
        }),
      ).rejects.toMatchObject({
        name: "SharedBuffSlotAnalysisUnavailableError",
      });
    });

    expect(onRemoteParserUnavailable).toHaveBeenCalledWith(codecError, 4_000);
  });

  it("does not let handle-less unavailable cleanup cancel a claimed feature trace", async () => {
    const source = createTestImageData(4, 4, () => [10, 20, 30, 255]);
    mocks.sampleFrame.mockReturnValue({
      imageData: source,
      rawPreviewUrl: null,
      regionLabel: "2x2",
      sourceSize: { width: 4, height: 4 },
      roi: { x: 2, y: 0, width: 2, height: 2 },
    });
    const codecError = new Error("vp8-unavailable");
    mocks.encodeVp8.mockRejectedValue(codecError);
    let nowMs = 0;
    const collector = new RemoteRecognitionWarmTraceCollector({
      browserClass: "chromium-local-headed",
      monotonicNowMs: () => {
        const current = nowMs;
        nowMs += 1;
        return current;
      },
      scheduleTimeout: () => () => undefined,
    });
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({
        stream: null,
        inputTransport: PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
        remoteParserProvider: vi.fn(),
        remoteRecognitionWarmTracePort: collector,
      }),
    );
    const video = { videoWidth: 4, videoHeight: 4 } as HTMLVideoElement;

    await act(async () => {
      await expect(
        result.current.getSharedBuffSlotAnalysis({
          sampledAt: 4_000,
          video,
        }),
      ).rejects.toThrow();
    });

    collector.armNextDecisiveTick({ target: "janus", provider: "remote" });
    const handle = collector.beginPhysicalSample();
    expect(handle).not.toBeNull();
    expect(collector.bindPhysicalSample(handle!, 4_000)).toBe(true);
    for (const stage of [
      "captureCropUs",
      "encodeUs",
      "remoteRoundTripUs",
      "responseProjectionUs",
    ] as const) {
      expect(collector.completeStage(handle!, stage)).toBe(true);
    }
    const featureClaim = collector.claimFeatureOwner(handle!, "skill");
    expect(featureClaim).not.toBeNull();

    await act(async () => {
      await expect(
        result.current.getSharedBuffSlotAnalysis({
          sampledAt: 5_000,
          video,
        }),
      ).rejects.toThrow();
    });

    expect(collector.snapshot()).toEqual([]);
    expect(collector.getSeries(handle!)).not.toBeNull();
    expect(
      collector.terminateFeatureStage(
        featureClaim!,
        "matcherOcrUs",
        "cancelled",
      ),
    ).toBe(true);
  });

  it("keeps the remote parser available when the provider drops one transient sample", async () => {
    const source = createTestImageData(4, 4, () => [10, 20, 30, 255]);
    mocks.sampleFrame.mockReturnValue({
      imageData: source,
      rawPreviewUrl: null,
      regionLabel: "2x2",
      sourceSize: { width: 4, height: 4 },
      roi: { x: 2, y: 0, width: 2, height: 2 },
    });
    mocks.encodeVp8.mockResolvedValue({
      encodedVp8: new Uint8Array([1, 2, 3]).buffer,
      encodedBytes: 3,
      encodeMs: 2,
    });
    const remoteParserProvider = vi.fn().mockRejectedValue(
      new RemoteRecognitionParserFrameDroppedError({
        sampledAt: 4_000,
        replacedBySampledAt: null,
      }),
    );
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({
        stream: null,
        inputTransport: PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
        remoteParserProvider,
      }),
    );

    await act(async () => {
      await expect(
        result.current.getSharedBuffSlotAnalysis({
          sampledAt: 4_000,
          video: {
            videoWidth: 4,
            videoHeight: 4,
          } as HTMLVideoElement,
        }),
      ).rejects.toMatchObject({
        name: "SharedBuffSlotAnalysisDroppedError",
        sampledAt: 4_000,
        replacedBySampledAt: null,
      });
    });

    expect(result.current.precisionParserReadiness.status).toBe("checking");
    expect(
      result.current.precisionParserInputTransportDiagnostics,
    ).toMatchObject({
      successfulSamples: 0,
      failedSamples: 0,
      droppedSamples: 1,
    });
    expect(mocks.trackReadiness).not.toHaveBeenCalledWith(
      "unavailable",
      expect.anything(),
      expect.anything(),
    );
  });

  it("publishes a terminal client transport failure for local fallback", async () => {
    const source = createTestImageData(4, 4, () => [10, 20, 30, 255]);
    mocks.sampleFrame.mockReturnValue({
      imageData: source,
      rawPreviewUrl: null,
      regionLabel: "2x2",
      sourceSize: { width: 4, height: 4 },
      roi: { x: 2, y: 0, width: 2, height: 2 },
    });
    const transportError = new Error(
      "vp8-parser-preview-webcodecs-unavailable",
    );
    mocks.encodeVp8.mockRejectedValue(transportError);
    const onRemoteParserUnavailable = vi.fn();
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({
        stream: null,
        inputTransport: PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
        remoteParserProvider: vi.fn(),
        onRemoteParserUnavailable,
      }),
    );

    await act(async () => {
      await expect(
        result.current.getSharedBuffSlotAnalysis({
          sampledAt: 4_000,
          video: {
            videoWidth: 4,
            videoHeight: 4,
          } as HTMLVideoElement,
        }),
      ).rejects.toMatchObject({
        name: "SharedBuffSlotAnalysisUnavailableError",
      });
    });

    expect(onRemoteParserUnavailable).toHaveBeenCalledWith(
      transportError,
      4_000,
    );
    expect(
      result.current.precisionParserInputTransportDiagnostics,
    ).toMatchObject({
      successfulSamples: 0,
      failedSamples: 1,
      lastError: "vp8-parser-preview-webcodecs-unavailable",
    });
  });

  it("does not reuse a same-tick parser result after the frame source changes", async () => {
    mocks.process.mockResolvedValue({
      sampledAt: 4_000,
      analysis: {
        icons: [],
        boxes: [],
        engine: "dl",
        parserVersion: "test-dl-parser",
      },
      performance: { totalMs: 4, detectMs: 3, boxCount: 0 },
      unsupported: false,
      unsupportedReason: null,
    });
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({ stream: null }),
    );
    const video = {
      videoWidth: 1766,
      videoHeight: 968,
    } as HTMLVideoElement;
    const firstSource = vi.fn(() => mocks.sampleFrame());
    const recalibratedSource = vi.fn(() => mocks.sampleFrame());

    await act(async () => {
      await result.current.getSharedBuffSlotAnalysis({
        sampledAt: 4_000,
        video,
        sampleBuffSlotFrame: firstSource,
      });
      await result.current.getSharedBuffSlotAnalysis({
        sampledAt: 4_000,
        video,
        sampleBuffSlotFrame: recalibratedSource,
      });
    });

    expect(firstSource).toHaveBeenCalledTimes(1);
    expect(recalibratedSource).toHaveBeenCalledTimes(1);
    expect(mocks.process).toHaveBeenCalledTimes(2);
  });

  it("does not mark the parser unavailable when a queued sample is superseded", async () => {
    mocks.process.mockRejectedValueOnce(
      new BuffSlotAnalysisSampleDroppedError({
        sampledAt: 1_000,
        replacedBySampledAt: 2_000,
      }),
    );
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({ stream: null }),
    );

    await act(async () => {
      await expect(
        result.current.getSharedBuffSlotAnalysis({
          sampledAt: 1_000,
          video: {
            videoWidth: 1920,
            videoHeight: 1080,
          } as HTMLVideoElement,
        }),
      ).rejects.toThrow("buff-slot-analysis-sample-dropped");
    });

    expect(result.current.precisionParserReadiness.status).toBe("checking");
    expect(mocks.trackReadiness).not.toHaveBeenCalledWith(
      "unavailable",
      expect.anything(),
      expect.anything(),
    );
  });

  it("discards an in-flight result after the runtime generation is reset", async () => {
    const deferred: { resolve?: (value: unknown) => void } = {};
    mocks.process.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deferred.resolve = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({ stream: null }),
    );
    const video = {
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    let pendingAnalysis: ReturnType<
      typeof result.current.getSharedBuffSlotAnalysis
    >;

    await act(async () => {
      pendingAnalysis = result.current.getSharedBuffSlotAnalysis({
        sampledAt: 1_000,
        video,
      });
      await Promise.resolve();
    });
    act(() => {
      result.current.retryPrecisionParser();
    });
    expect(deferred.resolve).toBeTypeOf("function");
    deferred.resolve?.({
      sampledAt: 1_000,
      analysis: {
        icons: [],
        boxes: [],
        engine: "dl",
        parserVersion: "stale-parser",
      },
      performance: { totalMs: 4, detectMs: 3, boxCount: 0 },
      unsupported: false,
      unsupportedReason: null,
    });

    await act(async () => {
      await expect(pendingAnalysis).rejects.toThrow(
        "buff-slot-analysis-sample-dropped",
      );
    });
    expect(result.current.precisionParserReadiness.status).toBe("idle");
    expect(mocks.trackReadiness).not.toHaveBeenCalledWith(
      "unavailable",
      expect.anything(),
      expect.anything(),
    );
  });

  it("enables session-only WASM only after the explicit CPU benchmark passes", async () => {
    mocks.process
      .mockRejectedValueOnce(
        new Error(
          "no available backend found. ERR: [webgpu] Failed to get GPU adapter",
        ),
      )
      .mockResolvedValueOnce({
        sampledAt: 2_000,
        analysis: {
          icons: [],
          boxes: [],
          engine: "dl",
          parserVersion: "test-dl-parser",
        },
        performance: { totalMs: 410, detectMs: 390, boxCount: 0 },
        unsupported: false,
        unsupportedReason: null,
      });
    mocks.runCpuBenchmark.mockResolvedValue({
      accepted: true,
      parserSamplesMs: [380, 390, 400, 410],
      requestSamplesMs: [400, 410, 420, 430],
      parserP95Ms: 410,
      requestP95Ms: 430,
      maxParserP95Ms: 500,
      maxRequestP95Ms: 900,
      measuredAt: 1_500,
    });
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({ stream: null }),
    );
    const video = {
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;

    await act(async () => {
      await expect(
        result.current.getSharedBuffSlotAnalysis({ sampledAt: 1_000, video }),
      ).rejects.toThrow();
      await result.current.startPrecisionParserCpuFallback();
    });

    expect(mocks.runCpuBenchmark).toHaveBeenCalledWith(video, {
      signal: expect.any(AbortSignal),
    });
    expect(result.current.precisionParserCpuFallback.status).toBe("active");
    expect(result.current.precisionParserRuntimeKey).toBe(
      "wasm:user-opt-in:active",
    );
    expect(result.current.precisionParserRuntimeSelection).toEqual({
      executionProvider: "wasm",
      selectionSource: "user-opt-in",
    });

    await act(async () => {
      await result.current.getSharedBuffSlotAnalysis({
        sampledAt: 2_000,
        video,
      });
    });
    expect(mocks.process).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runtimeSelection: {
          executionProvider: "wasm",
          selectionSource: "user-opt-in",
        },
      }),
    );
  });

  it("keeps WebGPU unavailable when the CPU benchmark is too slow", async () => {
    mocks.process.mockRejectedValueOnce(
      new Error(
        "no available backend found. ERR: [webgpu] Failed to get GPU adapter",
      ),
    );
    mocks.runCpuBenchmark.mockResolvedValue({
      accepted: false,
      parserSamplesMs: [900, 920, 940, 960],
      requestSamplesMs: [930, 950, 970, 990],
      parserP95Ms: 960,
      requestP95Ms: 990,
      maxParserP95Ms: 500,
      maxRequestP95Ms: 900,
      measuredAt: 1_500,
    });
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({ stream: null }),
    );
    const video = {
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;

    await act(async () => {
      await expect(
        result.current.getSharedBuffSlotAnalysis({ sampledAt: 1_000, video }),
      ).rejects.toThrow();
      await result.current.startPrecisionParserCpuFallback();
    });

    expect(result.current.precisionParserCpuFallback.status).toBe("rejected");
    expect(
      result.current.precisionParserRuntimeSelection.executionProvider,
    ).toBe("webgpu");
    expect(result.current.precisionParserReadiness.status).toBe("unavailable");
  });

  it("stops presenting CPU as active when the WASM runtime fails", async () => {
    mocks.process
      .mockRejectedValueOnce(
        new Error(
          "no available backend found. ERR: [webgpu] Failed to get GPU adapter",
        ),
      )
      .mockRejectedValueOnce(new Error("wasm-inference-failed"));
    mocks.runCpuBenchmark.mockResolvedValue(createAcceptedBenchmark());
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({ stream: null }),
    );
    const video = {
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;

    await act(async () => {
      await expect(
        result.current.getSharedBuffSlotAnalysis({ sampledAt: 1_000, video }),
      ).rejects.toThrow();
      await result.current.startPrecisionParserCpuFallback();
    });
    await act(async () => {
      await expect(
        result.current.getSharedBuffSlotAnalysis({ sampledAt: 2_000, video }),
      ).rejects.toThrow();
    });

    expect(result.current.precisionParserCpuFallback).toMatchObject({
      status: "failed",
      phase: "runtime",
      technicalMessage: "wasm-inference-failed",
    });
    expect(
      result.current.precisionParserRuntimeSelection.executionProvider,
    ).toBe("wasm");
    expect(result.current.precisionParserRuntimeKey).toBe(
      "wasm:user-opt-in:runtime-failed",
    );
    expect(result.current.precisionParserReadiness).toMatchObject({
      status: "unavailable",
      failureReason: "runtime-failed",
    });
  });

  it("terminates CPU analysis and changes the runtime generation after repeated slow samples", async () => {
    mocks.process.mockRejectedValueOnce(
      new Error(
        "no available backend found. ERR: [webgpu] Failed to get GPU adapter",
      ),
    );
    for (const sampledAt of [2_000, 3_000, 4_000]) {
      mocks.process.mockResolvedValueOnce({
        sampledAt,
        analysis: {
          icons: [],
          boxes: [],
          engine: "dl",
          parserVersion: "test-dl-parser",
        },
        performance: { totalMs: 950, detectMs: 510, boxCount: 0 },
        unsupported: false,
        unsupportedReason: null,
      });
    }
    mocks.runCpuBenchmark.mockResolvedValue(createAcceptedBenchmark());
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({ stream: null }),
    );
    const video = {
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;

    await act(async () => {
      await expect(
        result.current.getSharedBuffSlotAnalysis({ sampledAt: 1_000, video }),
      ).rejects.toThrow();
      await result.current.startPrecisionParserCpuFallback();
    });
    mocks.reset.mockClear();

    await act(async () => {
      await result.current.getSharedBuffSlotAnalysis({
        sampledAt: 2_000,
        video,
      });
      await result.current.getSharedBuffSlotAnalysis({
        sampledAt: 3_000,
        video,
      });
      await expect(
        result.current.getSharedBuffSlotAnalysis({ sampledAt: 4_000, video }),
      ).rejects.toThrow("정밀 감지를 시작하지 못했습니다.");
    });

    expect(result.current.precisionParserCpuFallback).toMatchObject({
      status: "overloaded",
      consecutiveSlowSamples: 3,
    });
    expect(result.current.precisionParserRuntimeKey).toBe(
      "wasm:user-opt-in:overloaded",
    );
    expect(mocks.reset).toHaveBeenCalled();
  });

  it("cancels an in-progress CPU benchmark without replacing the WebGPU failure", async () => {
    mocks.process.mockRejectedValueOnce(
      new Error(
        "no available backend found. ERR: [webgpu] Failed to get GPU adapter",
      ),
    );
    const benchmarkSignalRef: { current: AbortSignal | null } = {
      current: null,
    };
    mocks.runCpuBenchmark.mockImplementation(
      (_video: HTMLVideoElement, options: { signal: AbortSignal }) => {
        benchmarkSignalRef.current = options.signal;
        return new Promise((resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      },
    );
    const { result } = renderHook(() =>
      useSharedBuffSlotAnalysis({ stream: null }),
    );
    const video = {
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;

    await act(async () => {
      await expect(
        result.current.getSharedBuffSlotAnalysis({ sampledAt: 1_000, video }),
      ).rejects.toThrow();
    });
    await act(async () => {
      const benchmark = result.current.startPrecisionParserCpuFallback();
      await Promise.resolve();
      result.current.cancelPrecisionParserCpuFallbackBenchmark();
      await benchmark;
    });

    expect(benchmarkSignalRef.current?.aborted).toBe(true);
    expect(result.current.precisionParserCpuFallback.status).toBe("idle");
    expect(result.current.precisionParserReadiness.status).toBe("unavailable");
  });
});

function createAcceptedBenchmark() {
  return {
    accepted: true,
    parserSamplesMs: [380, 390, 400, 410],
    requestSamplesMs: [400, 410, 420, 430],
    parserP95Ms: 410,
    requestP95Ms: 430,
    maxParserP95Ms: 500,
    maxRequestP95Ms: 900,
    measuredAt: 1_500,
  };
}

function createAttachedWarmTrace(carrier: object, sampledAt = 4_000) {
  let nowMs = 0;
  const collector = new RemoteRecognitionWarmTraceCollector({
    browserClass: "chromium-local-headed",
    monotonicNowMs: () => {
      const current = nowMs;
      nowMs += 1;
      return current;
    },
    scheduleTimeout: () => () => undefined,
  });
  collector.armNextDecisiveTick({ target: "janus", provider: "remote" });
  const handle = collector.beginPhysicalSample();
  if (
    !handle ||
    !collector.bindPhysicalSample(handle, sampledAt) ||
    !attachRemoteRecognitionWarmTraceHandle(carrier, handle)
  ) {
    throw new Error("warm-trace-test-setup-failed");
  }
  return { collector, handle };
}

function createRemoteParserResult(sampledAt: number) {
  return {
    e2eMs: 8,
    response: {
      contract: createRemoteRecognitionControlMarker(),
      status: "ok" as const,
      sessionId: "session-1",
      purpose: "parser-provider" as const,
      expiresAt: Date.now() + 15_000,
      frame: {
        sequence: 1,
        sampledAt,
        encodedBytes: 3,
        width: 2,
        height: 2,
        parser: {
          engine: "onnxruntime-native" as const,
          modelId: "test-remote-parser",
          modelInputWidth: 544,
          modelInputHeight: 960,
          onnxRuntimeVersion: "1.24.4",
          executionProviders: ["CoreMLExecutionProvider"],
          boxCount: 0,
        },
        boxes: [],
        timings: {
          decodeMs: 1,
          preprocessMs: 1,
          inferenceMs: 3,
          postprocessMs: 1,
          serverTotalMs: 6,
        },
      },
    },
  };
}

function createTestImageData(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}
