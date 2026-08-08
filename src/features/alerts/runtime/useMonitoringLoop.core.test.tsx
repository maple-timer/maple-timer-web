import { act, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuffExpiryBox, BuffExpiryAcceptedMatch } from "../../../lib/buffExpiry/buffExpiryTypes";
import { SUPPORTED_BUFF_EXPIRY_BUFF_IDS } from "../../../lib/buffExpiry/buffExpiryCatalog";
import { getBuffExpiryRemainingSeconds } from "../../../lib/buffExpiry/buffExpiryRuntimeTiming";
import { createDefaultBuffExpiryAlert, createDefaultBoosterExpiryAlert, createDefaultHuntStallAlert, createDefaultRuneAlert, createDefaultSpecialCoreAlert } from "../../../lib/storage";
import { createSkill } from "../../../lib/profileFactory";
import { createRuntimeState } from "../../../lib/timer";
import {
  BUFF_EXPIRY_BOX,
  MonitoringHarness,
  buffExpiryPrecisionEngineMock,
  buffSlotAnalysisEngineMock,
  buffExpiryPreviewMock,
  boosterExpiryWorkerMock,
  cleanupMonitoringLoopTestHarness,
  createBoosterExpiryWorkerResult,
  createBoosterExpiryWorkerClientMock,
  createBuffExpiryMatch,
  createBuffExpiryPrecisionSampleResponse,
  createBuffExpiryPrecisionEngineMock,
  createHuntStallCooldownWorkerClientMock,
  createHuntStallOcrEngineMock,
  createBuffExpiryTemporalCandidateMatch,
  createProfile,
  createRecognitionEngine,
  createSpecialCoreAlertEngineMock,
  createTestImageData,
  cropRuneCandidateToUrlMock,
  detectRuneInMinimapMock,
  getRecognitionEngineMock,
  huntStallCooldownWorkerMock,
  huntStallOcrEngineMock,
  imageDataToUrlMock,
  playAlertMock,
  playAlertFromOffsetMock,
  playAlertUntilEndedMock,
  encodeVp8ParserFrameMock,
  sampleBuffSlotVideoFrameMock,
  resetMonitoringLoopTestMocks,
  sampleSkillMock,
  sampleVideoRegionMock,
  skillBuffDurationEngineMock,
  specialCoreAlertEngineMock,
  type HarnessApi,
} from "./useMonitoringLoopTestHarness";
import { createAlertIncidentJournal } from "../../../application/reporting/alertIncidentJournal";
import {
  DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT,
  PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
  type PrecisionParserInputTransport,
} from "../../../contracts/recognition/precisionParserInputTransport";
import { createRemoteRecognitionControlMarker } from "../../../contracts/remote-recognition/remoteRecognitionControlContract";
import { RemoteRecognitionWarmTraceCollector } from "../../../application/remote-recognition/remoteRecognitionWarmTraceCollector";
import {
  REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US,
  type RemoteRecognitionWarmTraceRecord,
} from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import type {
  SpecialCoreDetectedIcon,
  SpecialCoreSampleResponse,
} from "../../../lib/specialCore";

describe("useMonitoringLoop core", () => {
  beforeEach(() => {
    resetMonitoringLoopTestMocks();
  });

  afterEach(() => {
    cleanupMonitoringLoopTestHarness();
  });

  it("calls the no-stream handler when capture is unavailable", async () => {
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <MonitoringHarness
        profile={createProfile()}
        stream={null}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    expect(api.current?.onNoStream).toHaveBeenCalledTimes(1);
  });

  it("publishes the scheduler-owned monitoring context without eagerly sampling pixels", async () => {
    const onMonitoringFrame = vi.fn();
    render(
      <MonitoringHarness
        profile={createProfile()}
        stream={{} as MediaStream}
        onMonitoringFrame={onMonitoringFrame}
        onReady={vi.fn()}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onMonitoringFrame).toHaveBeenCalledOnce();
    expect(sampleBuffSlotVideoFrameMock).not.toHaveBeenCalled();
    const context = onMonitoringFrame.mock.calls[0]?.[0];
    expect(context).not.toBeNull();

    const first = context!.sampleBuffSlotFrame({ includePreview: false });
    const second = context!.sampleBuffSlotFrame({ includePreview: false });

    expect(first).toBe(second);
    expect(sampleBuffSlotVideoFrameMock).toHaveBeenCalledOnce();
  });

  it("does not recreate worker-backed runtime clients across monitoring rerenders", () => {
    const api: { current: HarnessApi | null } = { current: null };
    const profile = createProfile();

    const { rerender } = render(
      <MonitoringHarness
        profile={profile}
        stream={null}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    const initialCallCounts = [
      createBoosterExpiryWorkerClientMock,
      createBuffExpiryPrecisionEngineMock,
      createHuntStallCooldownWorkerClientMock,
      createHuntStallOcrEngineMock,
      createSpecialCoreAlertEngineMock,
    ].map((factory) => factory.mock.calls.length);

    rerender(
      <MonitoringHarness
        profile={createProfile()}
        stream={null}
        showDebugColumns
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );
    rerender(
      <MonitoringHarness
        profile={createProfile()}
        stream={{} as MediaStream}
        showDebugColumns
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    expect([
      createBoosterExpiryWorkerClientMock,
      createBuffExpiryPrecisionEngineMock,
      createHuntStallCooldownWorkerClientMock,
      createHuntStallOcrEngineMock,
      createSpecialCoreAlertEngineMock,
    ].map((factory) => factory.mock.calls.length)).toEqual(initialCallCounts);
  });

  it("resets only game-viewport consumers when the calibrated viewport changes", () => {
    const api: { current: HarnessApi | null } = { current: null };
    const profile = createProfile();
    const onReady = (next: HarnessApi) => {
      api.current = next;
    };
    const { rerender } = render(
      <MonitoringHarness
        gameViewportRevision={0}
        profile={profile}
        stream={null}
        onReady={onReady}
      />,
    );
    const ready = api.current;
    expect(ready).not.toBeNull();

    const consumerSetterCalls = [
      ready!.setRuntimeStates.mock.calls.length,
      ready!.setHuntStallRuntime.mock.calls.length,
      ready!.setBuffExpiryRuntime.mock.calls.length,
      ready!.setBoosterExpiryRuntime.mock.calls.length,
      ready!.setSpecialCoreRuntime.mock.calls.length,
    ];
    const captureConsumerSetterCalls = [
      ready!.setRuneRuntime.mock.calls.length,
      ready!.setRuneSnapshot.mock.calls.length,
      ready!.setUltimaRaidEquipmentRuntime.mock.calls.length,
      ready!.setUltimaRaidEquipmentSnapshot.mock.calls.length,
    ];
    const workerResetCalls = [
      huntStallOcrEngineMock.reset.mock.calls.length,
      huntStallCooldownWorkerMock.reset.mock.calls.length,
      boosterExpiryWorkerMock.reset.mock.calls.length,
      specialCoreAlertEngineMock.reset.mock.calls.length,
    ];

    rerender(
      <MonitoringHarness
        gameViewportRevision={1}
        profile={profile}
        stream={null}
        onReady={onReady}
      />,
    );

    expect([
      ready!.setRuntimeStates.mock.calls.length,
      ready!.setHuntStallRuntime.mock.calls.length,
      ready!.setBuffExpiryRuntime.mock.calls.length,
      ready!.setBoosterExpiryRuntime.mock.calls.length,
      ready!.setSpecialCoreRuntime.mock.calls.length,
    ]).toEqual(consumerSetterCalls.map((count) => count + 1));
    expect([
      ready!.setRuneRuntime.mock.calls.length,
      ready!.setRuneSnapshot.mock.calls.length,
      ready!.setUltimaRaidEquipmentRuntime.mock.calls.length,
      ready!.setUltimaRaidEquipmentSnapshot.mock.calls.length,
    ]).toEqual(captureConsumerSetterCalls);
    expect([
      huntStallOcrEngineMock.reset.mock.calls.length,
      huntStallCooldownWorkerMock.reset.mock.calls.length,
      boosterExpiryWorkerMock.reset.mock.calls.length,
      specialCoreAlertEngineMock.reset.mock.calls.length,
    ]).toEqual(workerResetCalls.map((count) => count + 1));
  });

  it("samples special core frames without generating a buff-slot preview", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    const profile = createProfile({
      specialCoreAlert: {
        ...createDefaultSpecialCoreAlert(),
        enabled: true,
      },
    });

    render(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(sampleBuffSlotVideoFrameMock).toHaveBeenCalledWith(
      expect.any(HTMLVideoElement),
      { includePreview: false },
    );
    expect(buffSlotAnalysisEngineMock.process).toHaveBeenCalledWith({
      imageData: expect.any(ImageData),
      sampledAt: expect.any(Number),
      runtimeSelection: {
        executionProvider: "webgpu",
        selectionSource: "default",
      },
    });
    expect(specialCoreAlertEngineMock.process).toHaveBeenCalledWith(
      expect.objectContaining({
        imageData: expect.objectContaining({
          width: 1,
          height: 1,
        }),
        sampledAt: expect.any(Number),
        buffSlotAnalysis: expect.objectContaining({
          parserVersion: "test-shared-parser",
        }),
      }),
    );
    expect(api.current?.setSpecialCoreSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        boxCount: 0,
        detectedCount: 0,
      }),
    );
  });

  it("shares one buff-slot parser result across precision skill, buff expiry, and special core in the same tick", async () => {
    const skill = createSkill({
      id: "janus",
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      enabled: true,
    });
    const profile = createProfile({
      skills: [skill],
      buffExpiryAlert: {
        ...createDefaultBuffExpiryAlert(),
        enabled: true,
      },
      specialCoreAlert: {
        ...createDefaultSpecialCoreAlert(),
        enabled: true,
      },
    });

    render(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        onReady={vi.fn()}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(buffSlotAnalysisEngineMock.process).toHaveBeenCalledTimes(1);
    expect(sampleBuffSlotVideoFrameMock).toHaveBeenCalledTimes(1);
    expect(buffSlotAnalysisEngineMock.process.mock.calls[0]?.[0].imageData).toBe(
      sampleBuffSlotVideoFrameMock.mock.results[0]?.value.imageData,
    );
    const sharedAnalysisExpectation = expect.objectContaining({
      parserVersion: "test-shared-parser",
    });
    expect(skillBuffDurationEngineMock.process).toHaveBeenCalledWith(
      expect.objectContaining({
        imageData: expect.objectContaining({ width: 1, height: 1 }),
        buffSlotAnalysis: sharedAnalysisExpectation,
      }),
    );
    expect(buffExpiryPrecisionEngineMock.process).toHaveBeenCalledWith(
      expect.objectContaining({
        imageData: expect.objectContaining({ width: 1, height: 1 }),
        buffSlotAnalysis: sharedAnalysisExpectation,
      }),
    );
    expect(specialCoreAlertEngineMock.process).toHaveBeenCalledWith(
      expect.objectContaining({
        imageData: expect.objectContaining({ width: 1, height: 1 }),
        buffSlotAnalysis: sharedAnalysisExpectation,
      }),
    );
  });

  it("does not silently reparse with feature workers when shared WebGPU parsing fails", async () => {
    buffSlotAnalysisEngineMock.process.mockRejectedValueOnce(
      new Error("dl-buff-parser-webgpu-unavailable"),
    );
    const skill = createSkill({
      id: "janus",
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      enabled: true,
    });

    render(
      <MonitoringHarness
        profile={createProfile({
          skills: [skill],
          buffExpiryAlert: {
            ...createDefaultBuffExpiryAlert(),
            enabled: true,
          },
          specialCoreAlert: {
            ...createDefaultSpecialCoreAlert(),
            enabled: true,
          },
        })}
        stream={{} as MediaStream}
        onReady={vi.fn()}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(buffSlotAnalysisEngineMock.process).toHaveBeenCalledTimes(1);
    expect(skillBuffDurationEngineMock.process).not.toHaveBeenCalled();
    expect(buffExpiryPrecisionEngineMock.process).not.toHaveBeenCalled();
    expect(specialCoreAlertEngineMock.process).not.toHaveBeenCalled();
  });

  it("records one exact special-core runtime frame with its state transition", async () => {
    buffSlotAnalysisEngineMock.process.mockResolvedValueOnce({
      sampledAt: Date.now(),
      analysis: {
        icons: [],
        boxes: [],
        engine: "dl",
        parserVersion: "buff-detector-yolov8n-q1-544x960-fp16",
        fallbackReason: null,
        runtime: {
          recognitionEngine: "dl",
          parserVersion: "buff-detector-yolov8n-q1-544x960-fp16",
          modelId: "buff-detector-yolov8n-q1-544x960-fp16",
          modelInputWidth: 960,
          modelInputHeight: 544,
          onnxRuntimeVersion: "1.27.0",
          executionProvider: "wasm",
          selectionSource: "user-opt-in",
          wasmThreads: 1,
        },
      },
      performance: {
        totalMs: 321,
        detectMs: 300,
        boxCount: 0,
        queueWaitMs: 4,
        resultAgeMs: 335,
        droppedSampleCount: 0,
        sampleIntervalMs: 1_000,
      },
      unsupported: false,
      unsupportedReason: null,
    });
    specialCoreAlertEngineMock.process.mockResolvedValueOnce({
      sampledAt: Date.now(),
      parserEngine: "dl",
      parserVersion: "buff-detector-yolov8n-q1-544x960-fp16",
      parserFallbackReason: null,
      parserRuntime: {
        recognitionEngine: "dl",
        parserVersion: "buff-detector-yolov8n-q1-544x960-fp16",
        modelId: "buff-detector-yolov8n-q1-544x960-fp16",
        modelInputWidth: 960,
        modelInputHeight: 544,
        onnxRuntimeVersion: "1.27.0",
        executionProvider: "wasm",
        selectionSource: "user-opt-in",
        wasmThreads: 1,
      },
      boxCount: 0,
      parsedBoxes: [],
      rowGroups: [],
      eligibleBoxIndexes: [],
      detectedCount: 0,
      detectedIcon: null,
      candidateIcons: [],
      performance: {
        totalMs: 321,
        detectMs: 300,
        matchMs: 0,
        boxCount: 0,
      },
      unsupported: false,
      unsupportedReason: null,
    });
    const profile = createProfile({
      specialCoreAlert: {
        ...createDefaultSpecialCoreAlert(),
        enabled: true,
      },
    });
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const recordedFrame = api.current?.specialCoreIncidentRecorderRef.current.archive.frames[0];
    expect(recordedFrame).toMatchObject({
      sampledAt: expect.any(Number),
      source: expect.objectContaining({
        kind: "normal-shared-parser",
        parserInputMode: "fullFrame",
        sourceDimensions: { width: 4, height: 4 },
        parserInputRegion: { x: 0, y: 0, width: 4, height: 4 },
        storedMediaRegion: { x: 2, y: 0, width: 2, height: 2 },
      }),
      parser: expect.objectContaining({
        engine: "dl",
        runtime: expect.objectContaining({
          executionProvider: "wasm",
          wasmThreads: 1,
        }),
      }),
      timings: expect.objectContaining({
        sharedParserTotalMs: 321,
        resultAgeMs: 335,
      }),
      runtimeFailure: null,
    });
    expect(api.current?.specialCoreSnapshotRef.current).toMatchObject({
      sampledAt: recordedFrame?.sampledAt,
      parserEngine: "dl",
      parserVersion: "buff-detector-yolov8n-q1-544x960-fp16",
      boxCount: 0,
      detectedCount: 0,
    });
    expect(api.current?.specialCoreRuntimeRef.current).toMatchObject({
      status: "waiting",
      lastSampledAt: recordedFrame?.sampledAt,
    });
    expect(api.current?.specialCoreIncidentRecorderRef.current.archive.media).toEqual([
      expect.objectContaining({
        imageDataUrl: "data:image/png;base64,skill-buff-slot",
      }),
    ]);
  });

  it("records primary and rescue remote Special Core paths only after browser playback acceptance", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    const startedAt = Date.now();
    sampleBuffSlotVideoFrameMock.mockImplementation(() => ({
      imageData: createTestImageData(4, 4),
      rawPreviewUrl: "data:image/png;base64,special-core-warm",
      regionLabel: "2x2",
      sourceSize: { width: 4, height: 4 },
      roi: { x: 2, y: 0, width: 2, height: 2 },
    }));
    let sampleIndex = 0;
    specialCoreAlertEngineMock.process.mockImplementation(
      ({ sampledAt }: { sampledAt?: number }) => {
        const currentIndex = sampleIndex;
        sampleIndex += 1;
        const mode = currentIndex <= 1
          ? "primary"
          : currentIndex >= 10
            ? "rescue"
            : "empty";
        return Promise.resolve(
          createSpecialCoreWarmSampleResponse(sampledAt ?? null, mode),
        );
      },
    );
    const playbackResolvers: Array<() => void> = [];
    playAlertFromOffsetMock.mockImplementation(
      (_soundId, _volume, _offset, _options) =>
        new Promise((resolve) => {
          playbackResolvers.push(() => resolve(undefined));
        }),
    );
    const remoteParserProvider = vi.fn(({ sampledAt }: { sampledAt: number }) =>
      Promise.resolve(createSpecialCoreRemoteParserResult(sampledAt)),
    );
    const monotonicOriginMs = Date.now();
    let monotonicSubMillisecond = 0;
    const collector = new RemoteRecognitionWarmTraceCollector({
      browserClass: "chromium-local-headed",
      monotonicNowMs: () => {
        monotonicSubMillisecond += 0.001;
        return Date.now() - monotonicOriginMs + monotonicSubMillisecond;
      },
      scheduleTimeout: () => () => undefined,
    });
    const bindPhysicalSample = vi.spyOn(collector, "bindPhysicalSample");
    const completeFeatureStage = vi.spyOn(collector, "completeFeatureStage");
    const browserTimeout = vi.spyOn(window, "setTimeout");
    const profile = createProfile({
      specialCoreAlert: {
        ...createDefaultSpecialCoreAlert(),
        enabled: true,
        cooldownSeconds: 11,
        alertLeadSeconds: 10,
      },
    });

    render(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        precisionParserInputTransport={
          PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW
        }
        remoteParserProvider={remoteParserProvider}
        remoteRecognitionWarmTracePort={collector}
        withSpecialCoreAlertScheduler
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(api.current?.specialCoreRuntimeRef.current).toMatchObject({
      status: "confirming",
      activationId: 0,
      pendingDetections: [expect.objectContaining({ observedAt: startedAt })],
    });
    expect(collector.snapshot()).toEqual([]);

    collector.armNextDecisiveTick({
      target: "special-core",
      provider: "remote",
    });
    const beforePrimaryTick = getSpecialCoreWarmTickCounts({
      remoteParserProvider,
      bindPhysicalSample,
    });
    const timeoutCallCountBeforePrimary = browserTimeout.mock.calls.length;
    const featureStageCallCountBeforePrimary =
      completeFeatureStage.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    const primaryTimeoutCallIndex = browserTimeout.mock.calls.findIndex(
      (call, index) =>
        index >= timeoutCallCountBeforePrimary && call[1] === 0,
    );
    const primaryScheduleCallIndex = completeFeatureStage.mock.calls.findIndex(
      (call, index) =>
        index >= featureStageCallCountBeforePrimary && call[1] === "scheduleUs",
    );
    expect(primaryTimeoutCallIndex).toBeGreaterThanOrEqual(
      timeoutCallCountBeforePrimary,
    );
    expect(primaryScheduleCallIndex).toBeGreaterThanOrEqual(
      featureStageCallCountBeforePrimary,
    );
    expect(
      browserTimeout.mock.invocationCallOrder[primaryTimeoutCallIndex]!,
    ).toBeLessThan(
      completeFeatureStage.mock.invocationCallOrder[primaryScheduleCallIndex]!,
    );
    expect(playAlertFromOffsetMock).not.toHaveBeenCalled();
    expect(api.current?.specialCoreRuntimeRef.current).toMatchObject({
      status: "cooldown",
      alertedAt: null,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expectSpecialCoreWarmTickDelta(beforePrimaryTick, {
      remoteParserProvider,
      bindPhysicalSample,
    });
    expect(api.current?.specialCoreRuntimeRef.current).toMatchObject({
      status: "alerted",
      activationId: 1,
      activationStartedAt: startedAt,
      activationConfirmedAt: startedAt + 1_000,
      alertDueAt: startedAt + 1_000,
      alertedAt: startedAt + 1_000,
      lastAlertPlayback: expect.objectContaining({ status: "requested" }),
    });
    expect(playAlertFromOffsetMock).toHaveBeenCalledTimes(1);
    expect(
      completeFeatureStage.mock.invocationCallOrder[primaryScheduleCallIndex]!,
    ).toBeLessThan(playAlertFromOffsetMock.mock.invocationCallOrder[0]!);
    expect(collector.snapshot()).toEqual([]);

    act(() => {
      playAlertFromOffsetMock.mock.calls[0]?.[3]?.onStarted?.();
    });
    expectCanonicalSpecialCoreWarmRecord(collector.snapshot()[0]);
    expect(api.current?.specialCoreRuntimeRef.current.lastAlertPlayback).toMatchObject({
      status: "started",
    });

    await act(async () => {
      playbackResolvers[0]?.();
      await Promise.resolve();
    });
    expect(api.current?.specialCoreRuntimeRef.current.lastAlertPlayback).toMatchObject({
      status: "finished",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(specialCoreAlertEngineMock.process).toHaveBeenCalledTimes(10);
    expect(api.current?.specialCoreRuntimeRef.current.pendingDetections).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(specialCoreAlertEngineMock.process).toHaveBeenCalledTimes(11);
    expect(api.current?.specialCoreRuntimeRef.current).toMatchObject({
      activationId: 1,
      pendingDetections: [
        expect.objectContaining({ observedAt: startedAt + 10_000 }),
      ],
    });
    expect(collector.snapshot()).toHaveLength(1);

    collector.armNextDecisiveTick({
      target: "special-core",
      provider: "remote",
    });
    const beforeRescueTick = getSpecialCoreWarmTickCounts({
      remoteParserProvider,
      bindPhysicalSample,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expectSpecialCoreWarmTickDelta(beforeRescueTick, {
      remoteParserProvider,
      bindPhysicalSample,
    });
    expect(api.current?.specialCoreRuntimeRef.current).toMatchObject({
      status: "alerted",
      activationId: 2,
      activationStartedAt: startedAt + 10_000,
      activationConfirmedAt: startedAt + 11_000,
      alertDueAt: startedAt + 11_000,
      alertedAt: startedAt + 11_000,
      lastDetectedIcon: expect.objectContaining({
        match: expect.objectContaining({
          primaryPassed: false,
          rescuePassed: true,
          decisionReason: "near_exact_positive_prototype_rescue",
        }),
      }),
      lastAlertPlayback: expect.objectContaining({ status: "requested" }),
    });
    expect(playAlertFromOffsetMock).toHaveBeenCalledTimes(2);
    expect(collector.snapshot()).toHaveLength(1);

    act(() => {
      playAlertFromOffsetMock.mock.calls[1]?.[3]?.onStarted?.();
    });
    expect(collector.snapshot()).toHaveLength(2);
    expectCanonicalSpecialCoreWarmRecord(collector.snapshot()[1]);

    await act(async () => {
      playbackResolvers[1]?.();
      await Promise.resolve();
    });
    expect(api.current?.specialCoreRuntimeRef.current.lastAlertPlayback).toMatchObject({
      status: "finished",
    });
  });

  it("cancels a Special Core activation that is unmounted before scheduler handoff", async () => {
    sampleBuffSlotVideoFrameMock.mockImplementation(() => ({
      imageData: createTestImageData(4, 4),
      rawPreviewUrl: null,
      regionLabel: "2x2",
      sourceSize: { width: 4, height: 4 },
      roi: { x: 2, y: 0, width: 2, height: 2 },
    }));
    specialCoreAlertEngineMock.process.mockImplementation(
      ({ sampledAt }: { sampledAt?: number }) =>
        Promise.resolve(
          createSpecialCoreWarmSampleResponse(sampledAt ?? null, "primary"),
        ),
    );
    const remoteParserProvider = vi.fn(({ sampledAt }: { sampledAt: number }) =>
      Promise.resolve(createSpecialCoreRemoteParserResult(sampledAt)),
    );
    let monotonicNowMs = 0;
    const collector = new RemoteRecognitionWarmTraceCollector({
      browserClass: "chromium-local-headed",
      monotonicNowMs: () => {
        monotonicNowMs += 0.001;
        return monotonicNowMs;
      },
      scheduleTimeout: () => () => undefined,
    });
    const profile = createProfile({
      specialCoreAlert: {
        ...createDefaultSpecialCoreAlert(),
        enabled: true,
        cooldownSeconds: 11,
        alertLeadSeconds: 10,
      },
    });
    const rendered = render(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        precisionParserInputTransport={
          PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW
        }
        remoteParserProvider={remoteParserProvider}
        remoteRecognitionWarmTracePort={collector}
        onReady={vi.fn()}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    collector.armNextDecisiveTick({
      target: "special-core",
      provider: "remote",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(collector.snapshot()).toEqual([]);

    act(() => {
      rendered.unmount();
    });

    expect(collector.snapshot()).toEqual([
      expect.objectContaining({
        target: "special-core",
        outcome: "cancelled",
        terminalStage: "scheduleUs",
        stageDurationsUs: expect.objectContaining({
          matcherOcrUs: expect.any(Number),
          temporalDecisionUs: expect.any(Number),
          scheduleUs: expect.any(Number),
          playbackAcceptanceUs: null,
        }),
      }),
    ]);
  });

  it("records an explicit special-core worker error on the sampled frame", async () => {
    specialCoreAlertEngineMock.process.mockRejectedValueOnce(
      new Error("special-core-worker-crashed"),
    );
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <MonitoringHarness
        profile={createProfile({
          specialCoreAlert: {
            ...createDefaultSpecialCoreAlert(),
            enabled: true,
          },
        })}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(api.current?.specialCoreRuntimeRef.current).toMatchObject({
      status: "unavailable",
      unsupportedReason: "special-core-worker-crashed",
    });
    expect(
      api.current?.specialCoreIncidentRecorderRef.current.archive.frames[0],
    ).toMatchObject({
      source: expect.objectContaining({ kind: "runtime-error" }),
      runtimeFailure: {
        stage: "matcher-worker",
        code: "Error",
        technicalMessage: "special-core-worker-crashed",
      },
    });
  });

  it("records the sampled source when the required parser itself is unavailable", async () => {
    const journal = createAlertIncidentJournal();
    buffSlotAnalysisEngineMock.process.mockRejectedValueOnce(
      new Error("dl-buff-parser-webgpu-unavailable"),
    );
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <MonitoringHarness
        profile={createProfile({
          specialCoreAlert: {
            ...createDefaultSpecialCoreAlert(),
            enabled: true,
          },
        })}
        stream={{} as MediaStream}
        alertIncidentJournal={journal}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(specialCoreAlertEngineMock.process).not.toHaveBeenCalled();
    expect(
      api.current?.specialCoreIncidentRecorderRef.current.archive.frames[0],
    ).toMatchObject({
      source: expect.objectContaining({
        kind: "runtime-error",
        storedMediaRegion: { x: 2, y: 0, width: 2, height: 2 },
      }),
      runtimeFailure: {
        stage: "shared-parser",
        code: "webgpu-unavailable",
        technicalMessage: "dl-buff-parser-webgpu-unavailable",
      },
    });
    expect(journal.freeze({ feature: "special-core" }).entries[0]).toMatchObject({
      status: "unavailable",
      decision: "정밀 감지용 WebGPU를 사용할 수 없습니다.",
      details: {
        parserFailureReason: "webgpu-unavailable",
      },
    });
  });

  it("records a terminal remote parser failure before switching back to local processing", async () => {
    const onRemoteParserUnavailable = vi.fn();
    const api: { current: HarnessApi | null } = { current: null };
    const profile = createProfile({
      specialCoreAlert: {
        ...createDefaultSpecialCoreAlert(),
        enabled: true,
      },
    });

    function RemoteFallbackHarness() {
      const [transport, setTransport] =
        useState<PrecisionParserInputTransport>(
          PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
        );
      return (
        <MonitoringHarness
          profile={profile}
          stream={{} as MediaStream}
          precisionParserInputTransport={transport}
          onRemoteParserUnavailable={(error, sampledAt) => {
            onRemoteParserUnavailable(error, sampledAt);
            window.setTimeout(() => {
              setTransport(DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT);
            }, 0);
          }}
          onReady={(next) => {
            api.current = next;
          }}
        />
      );
    }

    render(<RemoteFallbackHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onRemoteParserUnavailable).toHaveBeenCalledOnce();
    expect(
      api.current?.specialCoreIncidentRecorderRef.current.archive.resetEpochs[0],
    ).toMatchObject({
      continuity: {
        parserRuntimeGeneration:
          "remote:user-opt-in:default:vp8-preview-v1",
      },
    });
    expect(
      api.current?.specialCoreIncidentRecorderRef.current.archive.frames[0],
    ).toMatchObject({
      source: expect.objectContaining({ kind: "runtime-error" }),
      runtimeFailure: {
        stage: "shared-parser",
        code: "remote-client-transport-runtime-failed",
        technicalMessage: "remote-recognition-parser-provider-unavailable",
        details: expect.objectContaining({
          executionProvider: "remote",
          remoteFailurePhase: "client-transport",
          remoteFailureCode: "runtime-failed",
        }),
      },
    });
  });
});

function createSpecialCoreWarmSampleResponse(
  sampledAt: number | null,
  mode: "primary" | "rescue" | "empty",
): SpecialCoreSampleResponse {
  const detectedIcon = mode === "empty"
    ? null
    : createSpecialCoreWarmDetectedIcon(mode);
  return {
    sampledAt,
    parserEngine: "dl",
    parserVersion: "test-remote-parser",
    parserFallbackReason: null,
    parserRuntime: null,
    boxCount: detectedIcon ? 1 : 0,
    parsedBoxes: detectedIcon ? [detectedIcon.box] : [],
    rowGroups: detectedIcon
      ? [{ rowIndex: 0, y: 10, size: 32, boxIndexes: [0], eligible: true }]
      : [],
    eligibleBoxIndexes: detectedIcon ? [0] : [],
    detectedCount: detectedIcon ? 1 : 0,
    detectedIcon,
    candidateIcons: detectedIcon ? [detectedIcon] : [],
    performance: {
      totalMs: 1,
      detectMs: 0,
      matchMs: detectedIcon ? 1 : 0,
      boxCount: detectedIcon ? 1 : 0,
    },
    unsupported: false,
    unsupportedReason: null,
  };
}

function createSpecialCoreWarmDetectedIcon(
  mode: "primary" | "rescue",
): SpecialCoreDetectedIcon {
  const primary = mode === "primary";
  return {
    boxIndex: 0,
    box: { x: 10, y: 10, size: 32, confidence: 0.99, score: 0.98 },
    icon: {
      width: 32,
      height: 32,
      data: new Uint8ClampedArray(32 * 32 * 4),
    },
    match: {
      matched: true,
      targetId: "specialCore",
      bundleId: "special-core-deep-v2",
      modelId: "special-core-deep-v2",
      modelVersion: "special-core-20260711-v2",
      variantId: "test",
      gateVersion: 2,
      score: primary ? 1 : -0.01,
      threshold: 0,
      margin: primary ? 1 : -0.01,
      gateScore: primary ? 0.98 : 1,
      gateThreshold: 0.94,
      gateMargin: primary ? 0.04 : 0.06,
      rescueThreshold: 0.999,
      rescueMargin: primary ? -0.019 : 0.001,
      basePassed: primary,
      positiveGatePassed: true,
      primaryPassed: primary,
      rescuePassed: !primary,
      decisionReason: primary
        ? "base_and_positive_gate_passed"
        : "near_exact_positive_prototype_rescue",
      elapsedMs: 1,
    },
  };
}

function createSpecialCoreRemoteParserResult(sampledAt: number) {
  return {
    e2eMs: 8,
    response: {
      contract: createRemoteRecognitionControlMarker(),
      status: "ok" as const,
      sessionId: "special-core-session",
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

type MockCallSource = {
  mock: { calls: unknown[][] };
};

function getSpecialCoreWarmTickCounts({
  remoteParserProvider,
  bindPhysicalSample,
}: {
  remoteParserProvider: MockCallSource;
  bindPhysicalSample: MockCallSource;
}) {
  return {
    samples: sampleBuffSlotVideoFrameMock.mock.calls.length,
    encodes: encodeVp8ParserFrameMock.mock.calls.length,
    providers: remoteParserProvider.mock.calls.length,
    featureProcesses: specialCoreAlertEngineMock.process.mock.calls.length,
    bindings: bindPhysicalSample.mock.calls.length,
  };
}

function expectSpecialCoreWarmTickDelta(
  before: ReturnType<typeof getSpecialCoreWarmTickCounts>,
  sources: Parameters<typeof getSpecialCoreWarmTickCounts>[0],
) {
  const after = getSpecialCoreWarmTickCounts(sources);
  expect(after).toEqual({
    samples: before.samples + 1,
    encodes: before.encodes + 1,
    providers: before.providers + 1,
    featureProcesses: before.featureProcesses + 1,
    bindings: before.bindings + 1,
  });
}

function expectCanonicalSpecialCoreWarmRecord(
  record: RemoteRecognitionWarmTraceRecord | undefined,
) {
  expect(record).toMatchObject({
    target: "special-core",
    provider: "remote",
    browserClass: "chromium-local-headed",
    loadTier: "v1-owner-one",
    outcome: "completed",
    terminalStage: "playbackAcceptanceUs",
    waitMode: "none",
    scheduledWaitUs: 0,
    excludedWaitUs: 0,
  });
  expect(Object.values(record?.stageDurationsUs ?? {})).toHaveLength(8);
  expect(
    Object.values(record?.stageDurationsUs ?? {}).every(
      (duration) => typeof duration === "number" && duration >= 0,
    ),
  ).toBe(true);
  expect(record?.totalUs).toBeLessThan(
    REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US.activeExclusive,
  );
  expect(record?.wallTotalUs).toBeLessThan(
    REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US.wallExclusive,
  );
}
