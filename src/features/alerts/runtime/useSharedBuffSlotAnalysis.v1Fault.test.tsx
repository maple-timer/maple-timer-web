import { useCallback, useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteRecognitionControlPort } from "../../../application/remote-recognition/remoteRecognitionControlPort";
import type { RemoteRecognitionFrameProbeSource } from "../../../application/remote-recognition/remoteRecognitionFrameProbeSource";
import { RemoteRecognitionSessionController } from "../../../application/remote-recognition/remoteRecognitionSessionController";
import { createRemoteRecognitionV1ClientFaultDecorator } from "../../../application/remote-recognition/remoteRecognitionV1ClientFaultDecorator";
import {
  DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT,
  PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
  type PrecisionParserInputTransport,
} from "../../../contracts/recognition/precisionParserInputTransport";
import {
  REMOTE_RECOGNITION_READINESS_CONSENT_VERSION,
  createRemoteRecognitionControlMarker,
} from "../../../contracts/remote-recognition/remoteRecognitionControlContract";
import {
  SharedBuffSlotAnalysisDroppedError,
  SharedBuffSlotAnalysisUnavailableError,
  useSharedBuffSlotAnalysis,
} from "./useSharedBuffSlotAnalysis";

const mocks = vi.hoisted(() => ({
  encodeVp8: vi.fn(),
  process: vi.fn(),
  reset: vi.fn(),
  runCpuBenchmark: vi.fn(),
  sampleFrame: vi.fn(),
  trackReadiness: vi.fn(),
}));

vi.mock(
  "../../../platform/runtime-workers/buff-slot-analysis/buffSlotAnalysisWorkerClient",
  () => ({
    createBuffSlotAnalysisEngine: () => ({
      process: mocks.process,
      reset: mocks.reset,
    }),
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

const ACCESS_CODE = "preview-23AHK";
const CLIENT_INSTANCE_ID = "11111111-1111-4111-8111-111111111111";
const REVIEWED_COMMIT = "a".repeat(40);
const REVIEWED_BRANCH = "codex/remote-recognition-v1-owner-gate";

describe("useSharedBuffSlotAnalysis V1 client fault integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    mocks.sampleFrame.mockReturnValue(sampledFrame());
    mocks.encodeVp8.mockResolvedValue({
      encodedVp8: new Uint8Array([1, 2, 3]).buffer,
      encodedBytes: 3,
      encodeMs: 2,
    });
    mocks.process.mockImplementation(async ({ sampledAt }) =>
      localAnalysisResponse(sampledAt),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps two injected failures as missing samples, then records terminal remote failure before local processing", async () => {
    const port = createPort();
    const controller = createController(port);
    await completeSetup(controller);
    controller.setParserProviderConsent(true);
    controller.setParserProviderEnabled(true);

    const onRemoteParserUnavailable = vi.fn(
      (error: unknown, _sampledAt: number) => {
        expect(error).toMatchObject({
          name: "RemoteRecognitionControlContractError",
          code: "network-error",
          phase: "transport",
          retryable: true,
          retryAfterMs: null,
        });
        expect(controller.getSnapshot()).toMatchObject({
          phase: "failed",
          failure: { code: "network-error", phase: "transport" },
          parserProvider: { active: false, consentVersion: null },
        });
      },
    );
    const { result } = renderHook(() => {
      const [inputTransport, setInputTransport] =
        useState<PrecisionParserInputTransport>(
          PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
        );
      const remoteParserProvider = useCallback(
        (request: Parameters<typeof controller.analyzeParserFrame>[0]) =>
          controller.analyzeParserFrame(request),
        [],
      );
      const handleRemoteParserUnavailable = useCallback(
        (error: unknown, sampledAt: number) => {
          onRemoteParserUnavailable(error, sampledAt);
          setInputTransport(DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT);
        },
        [],
      );
      return {
        inputTransport,
        shared: useSharedBuffSlotAnalysis({
          stream: null,
          inputTransport,
          remoteParserProvider,
          onRemoteParserUnavailable: handleRemoteParserUnavailable,
        }),
      };
    });
    const video = { videoWidth: 4, videoHeight: 4 } as HTMLVideoElement;

    for (const sampledAt of [1_000, 2_000]) {
      let droppedError: unknown;
      await act(async () => {
        try {
          await result.current.shared.getSharedBuffSlotAnalysis({
            sampledAt,
            video,
          });
        } catch (error) {
          droppedError = error;
        }
      });

      expect(droppedError).toBeInstanceOf(SharedBuffSlotAnalysisDroppedError);
      expect(droppedError).toMatchObject({
        sampledAt,
        replacedBySampledAt: null,
      });
      expect(result.current.shared.precisionParserReadiness.status).not.toBe(
        "unavailable",
      );
      expect(
        result.current.shared.precisionParserInputTransportDiagnostics,
      ).toMatchObject({
        successfulSamples: 0,
        failedSamples: 0,
        droppedSamples: sampledAt / 1_000,
      });
      expect(onRemoteParserUnavailable).not.toHaveBeenCalled();
      expect(mocks.process).not.toHaveBeenCalled();
    }

    let terminalError: unknown;
    await act(async () => {
      try {
        await result.current.shared.getSharedBuffSlotAnalysis({
          sampledAt: 3_000,
          video,
        });
      } catch (error) {
        terminalError = error;
      }
    });

    expect(terminalError).toBeInstanceOf(
      SharedBuffSlotAnalysisUnavailableError,
    );
    expect(terminalError).toMatchObject({
      technicalMessage: "remote-recognition-v1-parser-frame-failure-injected",
      diagnostic: {
        code: "remote-transport-network-error",
        details: {
          executionProvider: "remote",
          inputTransport: PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
          remoteFailurePhase: "transport",
          remoteFailureCode: "network-error",
        },
      },
    });
    expect(onRemoteParserUnavailable).toHaveBeenCalledOnce();
    expect(onRemoteParserUnavailable).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "network-error",
        phase: "transport",
      }),
      3_000,
    );
    expect(result.current.inputTransport).toBe(
      DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT,
    );
    expect(port.analyzeSessionParserFrame).not.toHaveBeenCalled();
    expect(port.stopSession).toHaveBeenCalledOnce();
    expect(port.stopSession).toHaveBeenCalledWith(
      "session-1",
      "session-secret",
      {
        clientTelemetry: {
          version: 1,
          reportSequence: 4,
          counters: {
            acceptedResults: 0,
            unavailableSamples: 3,
            pendingReplacements: 0,
            retryableFailures: 3,
            terminalFallbacks: 1,
          },
          recentTransportE2e: [],
        },
      },
    );

    let localResult: Awaited<
      ReturnType<typeof result.current.shared.getSharedBuffSlotAnalysis>
    >;
    await act(async () => {
      localResult = await result.current.shared.getSharedBuffSlotAnalysis({
        sampledAt: 4_000,
        video,
      });
    });

    expect(localResult!.analysis).toMatchObject({
      engine: "dl",
      parserVersion: "local-v1-fallback-test",
      boxes: [expect.objectContaining({ x: 1, y: 1, size: 2 })],
    });
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(mocks.process).toHaveBeenCalledWith({
      imageData: mocks.sampleFrame.mock.results[3]?.value.imageData,
      sampledAt: 4_000,
      runtimeSelection: {
        executionProvider: "webgpu",
        selectionSource: "default",
      },
    });
    expect(mocks.encodeVp8).toHaveBeenCalledTimes(3);
    expect(port.stopSession).toHaveBeenCalledOnce();
  });
});

function createController(
  port: RemoteRecognitionControlPort,
): RemoteRecognitionSessionController {
  const parserFramePort = createRemoteRecognitionV1ClientFaultDecorator({
    port,
    compileTimeArm: true,
    buildInfo: {
      name: "maple-timer",
      version: "0.1.0",
      commitSha: REVIEWED_COMMIT,
      shortCommit: REVIEWED_COMMIT.slice(0, 7),
      branch: REVIEWED_BRANCH,
      deploymentUrl: "https://preview.maple-timer.pages.dev",
      buildTime: "2026-08-05T00:00:00.000Z",
      channel: "preview",
      remoteRecognitionV1TestArm: true,
    },
    reviewedCommit: REVIEWED_COMMIT,
    reviewedBranch: REVIEWED_BRANCH,
    labAvailable: true,
    search: "?remote-recognition-v1-parser-frame-failures=3",
  });
  if (!parserFramePort) {
    throw new Error("expected-v1-parser-frame-fault-port");
  }
  const frameSource: RemoteRecognitionFrameProbeSource = {
    captureFrame: vi.fn(async (sequence) => ({
      frame: framePayload(sequence),
      timings: { captureMs: 2, compressionMs: 3 },
    })),
  };
  let monotonicTime = 0;
  return new RemoteRecognitionSessionController(
    port,
    frameSource,
    {
      appBuild: `preview ${REVIEWED_BRANCH}@${REVIEWED_COMMIT.slice(0, 7)}`,
      channel: "preview",
      runtimeVersion: "browser-vp8-parser-provider-v1",
      getClientInstanceId: () => CLIENT_INSTANCE_ID,
      createAdmissionAttemptId: () => "22222222-2222-4222-8222-222222222222",
    },
    undefined,
    () => {
      const value = monotonicTime;
      monotonicTime += 40;
      return value;
    },
    parserFramePort,
  );
}

async function completeSetup(
  controller: RemoteRecognitionSessionController,
): Promise<void> {
  const setup = controller.start(
    ACCESS_CODE,
    REMOTE_RECOGNITION_READINESS_CONSENT_VERSION,
  );
  await vi.advanceTimersByTimeAsync(0);
  await setup;
  expect(controller.getSnapshot().phase).toBe("ready");
}

function createPort(): RemoteRecognitionControlPort {
  return {
    getStatus: vi.fn().mockResolvedValue({
      contract: createRemoteRecognitionControlMarker(),
      status: "ok",
      serviceState: "available",
      admissionAvailable: true,
      frameAnalysisEnabled: true,
      retryAfterMs: null,
    }),
    createAdmission: vi.fn().mockResolvedValue({
      contract: createRemoteRecognitionControlMarker(),
      status: "ok",
      admissionId: "admission-1",
      admissionToken: "admission-secret",
      betaAlias: "BETA-23AHK",
      connectionCode: "7HJK-9MNP",
      expiresAt: Date.now() + 15_000,
      probe: { requiredRounds: 5, intervalMs: 1_000 },
      capabilities: {
        frameAnalysisEnabled: true,
        entitlementLeaseVersion: 1,
      },
    }),
    probeAdmission: vi.fn().mockResolvedValue({
      contract: createRemoteRecognitionControlMarker(),
      status: "ok",
      admissionId: "admission-1",
      accepted: true,
      rounds: [],
      summary: {
        completedRounds: 5,
        successfulRounds: 5,
        medianMs: 1,
        maxMs: 1,
        totalElapsedMs: 5,
      },
    }),
    probeAdmissionFrame: vi
      .fn()
      .mockImplementation(async (_admissionId, _token, frame) =>
        frameProbeResponse(frame.sequence),
      ),
    promoteAdmission: vi.fn().mockResolvedValue({
      contract: createRemoteRecognitionControlMarker(),
      status: "ok",
      sessionId: "session-1",
      sessionToken: "session-secret",
      betaAlias: "BETA-23AHK",
      connectionCode: "7HJK-9MNP",
      expiresAt: Date.now() + 15_000,
      idleTimeoutMs: 15_000,
      heartbeatIntervalMs: 5_000,
      modelSetId: "studio-parser-provider-v1",
      capabilities: {
        frameAnalysisEnabled: true,
        entitlementLeaseVersion: 1,
        clientTelemetryVersion: 1,
      },
    }),
    cancelAdmission: vi.fn().mockResolvedValue(releaseResponse()),
    heartbeatSession: vi.fn().mockResolvedValue({
      contract: createRemoteRecognitionControlMarker(),
      status: "ok",
      sessionId: "session-1",
      expiresAt: Date.now() + 15_000,
    }),
    analyzeSessionParserFrame: vi.fn().mockResolvedValue(parserFrameResponse()),
    stopSession: vi.fn().mockResolvedValue(releaseResponse()),
  };
}

function framePayload(sequence: number) {
  return {
    sequence,
    sampledAt: 1_785_600_000_000 + sequence,
    width: 683,
    height: 384,
    encodedRgba: new Uint8Array([sequence]).buffer,
  };
}

function frameProbeResponse(sequence: number) {
  const frame = framePayload(sequence);
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok" as const,
    admissionId: "admission-1",
    accepted: sequence === 5,
    requiredRounds: 5,
    round: {
      round: sequence,
      status: "ok" as const,
      elapsedMs: 35,
      sampledAt: frame.sampledAt,
      encodedBytes: frame.encodedRgba.byteLength,
      width: frame.width,
      height: frame.height,
      parser: {
        engine: "onnxruntime-native" as const,
        modelId: "buff-detector-test",
        executionProviders: ["CoreMLExecutionProvider"],
        boxCount: 0,
      },
      timings: {
        decodeMs: 1,
        preprocessMs: 4,
        inferenceMs: 28,
        postprocessMs: 2,
        serverTotalMs: 35,
      },
    },
    summary: {
      completedRounds: sequence,
      successfulRounds: sequence,
      medianMs: 35,
      maxMs: 35,
      totalElapsedMs: sequence * 35,
    },
  };
}

function parserFrameResponse() {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok" as const,
    sessionId: "session-1",
    purpose: "parser-provider" as const,
    expiresAt: Date.now() + 15_000,
    frame: {
      sequence: 4,
      sampledAt: 4_000,
      encodedBytes: 3,
      width: 2,
      height: 2,
      parser: {
        engine: "onnxruntime-native" as const,
        modelId: "remote-parser-test",
        modelInputWidth: 544,
        modelInputHeight: 960,
        onnxRuntimeVersion: "1.24.4",
        executionProviders: ["CoreMLExecutionProvider"],
        boxCount: 0,
      },
      boxes: [],
      timings: {
        decodeMs: 1,
        preprocessMs: 4,
        inferenceMs: 28,
        postprocessMs: 2,
        serverTotalMs: 35,
      },
    },
  };
}

function releaseResponse() {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok" as const,
    released: true as const,
  };
}

function sampledFrame() {
  return {
    imageData: {
      width: 4,
      height: 4,
      data: new Uint8ClampedArray(4 * 4 * 4),
    },
    rawPreviewUrl: null,
    regionLabel: "2x2",
    sourceSize: { width: 4, height: 4 },
    roi: { x: 2, y: 0, width: 2, height: 2 },
  };
}

function localAnalysisResponse(sampledAt: number) {
  const box = { x: 1, y: 1, size: 2, confidence: 0.99, score: 990 };
  return {
    sampledAt,
    analysis: {
      icons: [
        {
          width: 2,
          height: 2,
          data: new Uint8ClampedArray(2 * 2 * 4),
        },
      ],
      boxes: [box],
      engine: "dl" as const,
      parserVersion: "local-v1-fallback-test",
    },
    performance: { totalMs: 4, detectMs: 3, boxCount: 1 },
    unsupported: false,
    unsupportedReason: null,
  };
}
