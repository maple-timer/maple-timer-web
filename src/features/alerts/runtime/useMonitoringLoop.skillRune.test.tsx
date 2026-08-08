import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BuffExpiryBox,
  BuffExpiryAcceptedMatch,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import { SUPPORTED_BUFF_EXPIRY_BUFF_IDS } from "../../../lib/buffExpiry/buffExpiryCatalog";
import { getBuffExpiryRemainingSeconds } from "../../../lib/buffExpiry/buffExpiryRuntimeTiming";
import {
  createDefaultBuffExpiryAlert,
  createDefaultBoosterExpiryAlert,
  createDefaultHuntStallAlert,
  createDefaultRuneAlert,
} from "../../../lib/storage";
import { createSkill } from "../../../lib/profileFactory";
import { createRuntimeState } from "../../../lib/timer";
import { RuneDetectionWorkerClientError } from "../../../platform/runtime-workers/rune/runeDetectionWorkerClient";
import {
  RUNE_ONNX_MODEL_VERSION,
  RUNE_ONNX_THRESHOLD,
} from "../../../recognition/rune/runeOnnxContract";
import { createRuntimeReportEvidenceCoordinator } from "../../../application/reporting/runtimeReportEvidenceCoordinator";
import { createAlertIncidentJournal } from "../../../application/reporting/alertIncidentJournal";
import type { SkillBuffDurationRuntimeReportPayload } from "../../../contracts/reporting/runtimeReportEvidencePayloads";
import {
  PRECISION_PARSER_INPUT_TRANSPORT_SOURCE,
  PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
} from "../../../contracts/recognition/precisionParserInputTransport";
import {
  createRemoteRecognitionControlMarker,
  RemoteRecognitionParserFrameDroppedError,
} from "../../../contracts/remote-recognition/remoteRecognitionControlContract";
import { RemoteRecognitionWarmTraceCollector } from "../../../application/remote-recognition/remoteRecognitionWarmTraceCollector";
import type { RemoteRecognitionWarmTraceTarget } from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import {
  BUFF_EXPIRY_BOX,
  MonitoringHarness,
  buffSlotAnalysisEngineMock,
  buffExpiryPrecisionEngineMock,
  buffExpiryPreviewMock,
  boosterExpiryWorkerMock,
  cleanupMonitoringLoopTestHarness,
  createBoosterExpiryWorkerResult,
  createBuffExpiryMatch,
  createBuffExpiryPrecisionSampleResponse,
  createSkillBuffDurationSampleResponse,
  createBuffExpiryTemporalCandidateMatch,
  createProfile,
  createRecognitionEngine,
  createRuneMaskPreviewMock,
  createTestImageData,
  cropRuneCandidateToUrlMock,
  detectRuneInMinimapMock,
  encodeVp8ParserFrameMock,
  getRecognitionEngineMock,
  huntStallCooldownWorkerMock,
  imageDataToUrlMock,
  playAlertMock,
  playAlertUntilEndedMock,
  resetMonitoringLoopTestMocks,
  runeDetectionWorkerClientMock,
  sampleSkillMock,
  sampleBuffSlotVideoFrameMock,
  sampleVideoRegionMock,
  skillBuffDurationEngineMock,
  type HarnessApi,
} from "./useMonitoringLoopTestHarness";

const SKILL_WARM_VERTICAL_FIXTURES = [
  {
    label: "Janus",
    target: "janus",
    presetId: "sol-janus-dawn-deep-v2",
    threshold: 5,
    valueKind: "countdown",
    values: [8, 7, 6, 5, 4, 3],
    workerTarget: {
      skillId: "janusDeepV2",
      detectorId: "skill-deep-v2:janus",
      matcherEngine: "skill-bundle-v1",
      matcherSkillId: "janus",
      maxBuffRowIndex: 1,
      valueKind: "countdown",
    },
    workerTargetBundleId: "skill-deep-v2",
    workerTargetModelVersion:
      "confirmed-bg-v1-seed20260632-r2-positive-gates-v3",
  },
  {
    label: "Hologram Graffiti Barrier",
    target: "hologram-graffiti-barrier",
    presetId: "hologram-graffiti-barrier-vi",
    threshold: 5,
    valueKind: "countdown",
    values: [8, 7, 6, 5, 4, 3],
    workerTarget: {
      skillId: "hologramGraffitiBarrierVi",
      detectorId: "hologramGraffitiBarrierVi",
      matcherEngine: "skill-bundle-v1",
      matcherSkillId: "barrier",
      maxBuffRowIndex: 1,
      valueKind: "countdown",
    },
    workerTargetBundleId: "skill-deep-v2",
    workerTargetModelVersion:
      "confirmed-bg-v1-seed20260632-r2-positive-gates-v3",
  },
  {
    label: "Fountain",
    target: "fountain",
    presetId: "erda-fountain-deep-v2",
    threshold: 5,
    valueKind: "countdown",
    values: [8, 7, 6, 5, 4, 3],
    workerTarget: {
      skillId: "fountainDeepV2",
      detectorId: "skill-deep-v2:fountain",
      matcherEngine: "skill-bundle-v1",
      matcherSkillId: "fountain",
      maxBuffRowIndex: 1,
      valueKind: "countdown",
    },
    workerTargetBundleId: "skill-deep-v2",
    workerTargetModelVersion:
      "confirmed-bg-v1-seed20260632-r2-positive-gates-v3",
  },
  {
    label: "Yein",
    target: "yein",
    presetId: "maehwa-yein-vi",
    threshold: 3,
    valueKind: "remaining-count",
    values: [4, 3, 2],
    workerTarget: {
      skillId: "maehwaYeinDeepV1",
      detectorId: "skill-maehwa-yein-deep-v1",
      matcherEngine: "skill-bundle-v1",
      matcherSkillId: "maehwaYein",
      maxBuffRowIndex: 1,
      valueKind: "remaining-count",
    },
    workerTargetBundleId: "skill-maehwa-yein-deep-v1",
    workerTargetModelVersion: "maehwa-yein-20260710-v3-runtime-bundle",
  },
] as const;

const SKILL_WARM_FEATURE_INSTRUMENTATION_FAULTS = [
  {
    label: "matcher completion returns false",
    kind: "stage",
    stage: "matcherOcrUs",
    mode: "false",
  },
  {
    label: "matcher completion throws",
    kind: "stage",
    stage: "matcherOcrUs",
    mode: "throw",
  },
  {
    label: "temporal completion returns false",
    kind: "stage",
    stage: "temporalDecisionUs",
    mode: "false",
  },
  {
    label: "temporal completion throws",
    kind: "stage",
    stage: "temporalDecisionUs",
    mode: "throw",
  },
  {
    label: "schedule completion returns false",
    kind: "stage",
    stage: "scheduleUs",
    mode: "false",
  },
  {
    label: "schedule completion throws",
    kind: "stage",
    stage: "scheduleUs",
    mode: "throw",
  },
  {
    label: "playback completion returns false",
    kind: "feature",
    stage: "playbackAcceptanceUs",
    mode: "false",
  },
  {
    label: "playback completion throws",
    kind: "feature",
    stage: "playbackAcceptanceUs",
    mode: "throw",
  },
] as const;

describe("useMonitoringLoop skill Rune", () => {
  beforeEach(() => {
    resetMonitoringLoopTestMocks();
  });

  afterEach(() => {
    cleanupMonitoringLoopTestHarness();
  });

  it("samples enabled skill regions and records the recognition trace", async () => {
    const skill = createSkill({
      id: "skill_erda",
      enabled: true,
      region: { x: 0.1, y: 0.2, width: 0.08, height: 0.08 },
    });
    const profile = createProfile({ skills: [skill] });
    const recognize = vi.fn().mockReturnValue({
      value: 55,
      confidence: 0.99,
      debug: {
        digitCount: 2,
        foregroundRatio: 0.42,
        recognizedText: "55",
      },
    });
    getRecognitionEngineMock.mockReturnValue(
      createRecognitionEngine(recognize),
    );
    sampleSkillMock.mockReturnValue({
      imageData: createTestImageData(),
      rawPreviewUrl: "raw-skill",
      previewUrl: "processed-skill",
      region: { x: 12, y: 34, width: 56, height: 56 },
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
      vi.advanceTimersByTime(0);
    });

    expect(api.current?.handleMetadata).toHaveBeenCalledTimes(1);
    expect(sampleSkillMock).toHaveBeenCalledWith(
      expect.any(HTMLVideoElement),
      skill.region,
      true,
    );
    expect(recognize).toHaveBeenCalledWith(expect.any(ImageData));
    expect(api.current?.setRuntimeStates).toHaveBeenLastCalledWith(
      expect.objectContaining({
        [skill.id]: expect.objectContaining({
          confidence: 0.99,
          observedRemainingSeconds: 55,
        }),
      }),
    );
    expect(api.current?.setSnapshots).toHaveBeenLastCalledWith({
      [skill.id]: expect.objectContaining({
        rawPreviewUrl: "raw-skill",
        previewUrl: "processed-skill",
        regionLabel: "56x56",
        result: expect.objectContaining({ value: 55 }),
      }),
    });
    const samples =
      api.current?.skillReportTimelineRef.current[skill.id]?.samples ?? [];
    expect(samples[samples.length - 1]).toMatchObject({
      ocrValue: 55,
      confidence: 0.99,
      recognizedText: "55",
    });
    const incidentArchive =
      api.current?.skillIncidentRecorderRef.current.archive;
    expect(incidentArchive?.frames).toEqual([
      expect.objectContaining({
        skillId: skill.id,
        mode: "quickslot-countdown",
        provider: "main-thread",
        recognizerVersion: "test-recognition",
        source: "runtime",
      }),
    ]);
    expect(incidentArchive?.observations[0]).toMatchObject({
      skillIds: [skill.id],
      recognitionDecision: "accepted",
      value: { rawValue: 55, decision: "accepted" },
    });
    expect(incidentArchive?.media.map((entry) => entry.variant)).toEqual(
      expect.arrayContaining(["quickslot-raw", "quickslot-processed"]),
    );
  });

  it("closes the active skill incident epoch without discarding it when capture stops", async () => {
    const skill = createSkill({
      id: "skill_capture_reset",
      enabled: true,
      region: { x: 0.1, y: 0.2, width: 0.08, height: 0.08 },
    });
    sampleSkillMock.mockReturnValue({
      imageData: createTestImageData(),
      rawPreviewUrl: "raw-before-stop",
      previewUrl: "processed-before-stop",
      region: { x: 10, y: 20, width: 40, height: 40 },
    });
    const api: { current: HarnessApi | null } = { current: null };
    const profile = createProfile({ skills: [skill] });
    const stream = {} as MediaStream;
    const { rerender } = render(
      <MonitoringHarness
        profile={profile}
        stream={stream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    const openEpoch =
      api.current?.skillIncidentRecorderRef.current.archive.epochs[0];
    expect(openEpoch).toMatchObject({ skillId: skill.id, closedAt: null });

    rerender(
      <MonitoringHarness
        profile={profile}
        stream={null}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );
    await act(async () => undefined);

    const archive = api.current?.skillIncidentRecorderRef.current.archive;
    expect(archive?.epochs[0]).toMatchObject({
      id: openEpoch?.id,
      closedAt: expect.any(Number),
    });
    expect(archive?.frames).toHaveLength(1);
    expect(
      api.current?.skillIncidentRecorderRef.current.bindingsBySkill,
    ).toEqual({});
  });

  it("fires an initial skill alert when the tracked countdown reaches the threshold", async () => {
    const skill = createSkill({
      id: "skill_initial_alert",
      enabled: true,
      alertThresholdSeconds: 5,
      region: { x: 0.1, y: 0.2, width: 0.08, height: 0.08 },
    });
    const now = Date.now();
    const profile = createProfile({ skills: [skill] });
    const recognize = vi.fn().mockReturnValue({
      value: 3,
      confidence: 0.99,
      debug: {
        digitCount: 1,
        foregroundRatio: 0.36,
        recognizedText: "3",
      },
    });
    getRecognitionEngineMock.mockReturnValue(
      createRecognitionEngine(recognize),
    );
    playAlertUntilEndedMock.mockReturnValue(new Promise(() => {}));
    sampleSkillMock.mockReturnValue({
      imageData: createTestImageData(),
      rawPreviewUrl: "raw-alert",
      previewUrl: "processed-alert",
      region: { x: 10, y: 20, width: 40, height: 40 },
    });
    const initialRuntimeStates = {
      [skill.id]: {
        ...createRuntimeState(skill.id),
        observedRemainingSeconds: 8,
        observedAt: now - 5_000,
        estimatedExpiresAt: now + 3_000,
        confidence: 0.95,
        status: "running" as const,
      },
    };
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <MonitoringHarness
        initialRuntimeStates={initialRuntimeStates}
        profile={profile}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    const sampledAt = now;
    expect(playAlertUntilEndedMock).toHaveBeenCalledWith(
      skill.soundId,
      expect.any(Number),
      expect.objectContaining({ onStarted: expect.any(Function) }),
    );
    expect(api.current?.setRuntimeStates).toHaveBeenLastCalledWith({
      [skill.id]: expect.objectContaining({
        status: "alerted",
        alertedAt: sampledAt,
      }),
    });

    const timeline = api.current?.skillReportTimelineRef.current[skill.id];
    expect(timeline?.samples[timeline.samples.length - 1]).toMatchObject({
      ocrValue: 3,
      shouldFireAlert: true,
      shouldRepeatAlert: false,
      alertDecision: "initial",
    });
    expect(timeline?.alertEvents[0]).toMatchObject({
      alertCycleStartedAt: sampledAt,
      soundId: skill.soundId,
      status: "started",
    });
    expect(
      api.current?.skillIncidentRecorderRef.current.archive.attempts[0],
    ).toMatchObject({
      skillId: skill.id,
      status: "requested",
      startedAt: null,
      startedMeaning: null,
    });

    const playbackOptions = playAlertUntilEndedMock.mock.calls[0]?.[2];
    act(() => {
      playbackOptions?.onStarted?.();
    });
    expect(
      api.current?.skillIncidentRecorderRef.current.archive.attempts[0],
    ).toMatchObject({
      status: "started",
      startedAt: expect.any(Number),
      startedMeaning: "browser-play-accepted",
    });
  });

  it.each(SKILL_WARM_VERTICAL_FIXTURES)(
    "records the normal $label owner path only after browser playback acceptance",
    async (fixture) => {
      const startedAt = Date.now();
      const skill = createSkill({
        id: `${fixture.target}_remote_warm_trace`,
        presetId: fixture.presetId,
        detectionSource: "buff-duration",
        enabled: true,
        alertThresholdSeconds: fixture.threshold,
        repeatAlertEnabled: false,
      });
      const profile = createProfile({ skills: [skill] });
      let responseIndex = 0;
      skillBuffDurationEngineMock.process.mockImplementation(
        ({ sampledAt }: { sampledAt?: number }) => {
          const value = fixture.values[
            Math.min(responseIndex, fixture.values.length - 1)
          ];
          responseIndex += 1;
          return Promise.resolve({
            ...createSkillBuffDurationSampleResponse({
              remainingCount: fixture.valueKind === "remaining-count"
                ? value
                : undefined,
              seconds: fixture.valueKind === "countdown" ? value : null,
              target: fixture.target,
            }),
            sampledAt: sampledAt ?? null,
          });
        },
      );
      playAlertUntilEndedMock.mockReturnValue(new Promise(() => {}));
      const remoteParserProvider = vi.fn(
        ({ sampledAt }: { sampledAt: number }) =>
          Promise.resolve(createRemoteParserProviderResult(sampledAt)),
      );
      let monotonicNowMs = 0;
      const collector = new RemoteRecognitionWarmTraceCollector({
        browserClass: "chromium-local-headed",
        monotonicNowMs: () => {
          const value = monotonicNowMs;
          monotonicNowMs += 1;
          return value;
        },
        scheduleTimeout: () => () => undefined,
      });
      const bindPhysicalSample = vi.spyOn(collector, "bindPhysicalSample");
      const api: { current: HarnessApi | null } = { current: null };

      render(
        <MonitoringHarness
          profile={profile}
          stream={{} as MediaStream}
          precisionParserInputTransport={
            PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW
          }
          remoteParserProvider={remoteParserProvider}
          remoteRecognitionWarmTracePort={collector}
          onReady={(next) => {
            api.current = next;
          }}
        />,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
        for (let index = 1; index < fixture.values.length - 1; index += 1) {
          await vi.advanceTimersByTimeAsync(1_000);
        }
      });

      expect(playAlertUntilEndedMock).not.toHaveBeenCalled();
      expect(collector.snapshot()).toEqual([]);
      const countsBeforeDecisiveTick = {
        bind: bindPhysicalSample.mock.calls.length,
        capture: sampleBuffSlotVideoFrameMock.mock.calls.length,
        encode: encodeVp8ParserFrameMock.mock.calls.length,
        provider: remoteParserProvider.mock.calls.length,
        worker: skillBuffDurationEngineMock.process.mock.calls.length,
      };
      collector.armNextDecisiveTick({
        target: fixture.target,
        provider: "remote",
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });

      const decisiveSampledAt =
        startedAt + (fixture.values.length - 1) * 1_000;
      expect(sampleBuffSlotVideoFrameMock).toHaveBeenCalledTimes(
        countsBeforeDecisiveTick.capture + 1,
      );
      expect(bindPhysicalSample).toHaveBeenCalledTimes(
        countsBeforeDecisiveTick.bind + 1,
      );
      expect(bindPhysicalSample).toHaveBeenLastCalledWith(
        expect.any(Object),
        decisiveSampledAt,
      );
      expect(encodeVp8ParserFrameMock).toHaveBeenCalledTimes(
        countsBeforeDecisiveTick.encode + 1,
      );
      expect(remoteParserProvider).toHaveBeenCalledTimes(
        countsBeforeDecisiveTick.provider + 1,
      );
      expect(buffSlotAnalysisEngineMock.process).not.toHaveBeenCalled();
      expect(skillBuffDurationEngineMock.process).toHaveBeenCalledTimes(
        countsBeforeDecisiveTick.worker + 1,
      );
      const finalWorkerCall = skillBuffDurationEngineMock.process.mock.calls[
        skillBuffDurationEngineMock.process.mock.calls.length - 1
      ];
      expect(finalWorkerCall?.[0].targets).toEqual([fixture.workerTarget]);
      expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
      expect(collector.snapshot()).toEqual([]);

      const state = api.current?.runtimeRef.current[skill.id];
      expect(state).toMatchObject({
        status: "alerted",
        alertedAt: decisiveSampledAt,
        rejectedReading: null,
      });
      if (fixture.valueKind === "countdown") {
        const finalValue = fixture.values[fixture.values.length - 1];
        expect(state).toMatchObject({
          observedRemainingSeconds: finalValue,
          observedAt: decisiveSampledAt,
          estimatedExpiresAt: startedAt + 8_000,
          lastAlertCycleStartedAt: decisiveSampledAt,
          pendingShortAnchor: null,
        });
      } else {
        expect(state).toMatchObject({
          observedRemainingCount: 2,
          countObservedAt: decisiveSampledAt,
          lastAlertCycleStartedAt: startedAt,
          pendingRemainingCountAlert: null,
          pendingRemainingCountDrop: null,
          pendingRemainingCountIncrease: null,
        });
        const samples =
          api.current?.skillReportTimelineRef.current[skill.id]?.samples ?? [];
        expect(samples[samples.length - 1]).toMatchObject({
          remainingCountDecision: "alert-threshold-confirmed",
          remainingCountExpectedMin: 2,
          remainingCountExpectedMax: 3,
          shouldFireAlert: true,
          shouldRepeatAlert: false,
        });
      }
      expect(api.current?.setSnapshots).toHaveBeenLastCalledWith(
        expect.objectContaining({
          [skill.id]: expect.objectContaining({
            buffDuration: expect.objectContaining({
              targetSkillId: fixture.workerTarget.skillId,
              matcherEngine: "skill-bundle-v1",
              bundleId: fixture.workerTargetBundleId,
              modelVersion: fixture.workerTargetModelVersion,
              baseSkillId: fixture.workerTarget.matcherSkillId,
              rawSkillId: fixture.workerTarget.matcherSkillId,
              decisionReason: "target_accepted",
            }),
          }),
        }),
      );

      const playbackOptions = playAlertUntilEndedMock.mock.calls[0]?.[2];
      act(() => {
        playbackOptions?.onStarted?.();
        playbackOptions?.onStarted?.();
      });

      expect(collector.snapshot()).toEqual([
        expect.objectContaining({
          target: fixture.target,
          provider: "remote",
          outcome: "completed",
          terminalStage: "playbackAcceptanceUs",
          waitMode: "none",
          scheduledWaitUs: 0,
          excludedWaitUs: 0,
          totalUs: 10_000,
          wallTotalUs: 10_000,
          stageDurationsUs: {
            captureCropUs: 2_000,
            encodeUs: 1_000,
            remoteRoundTripUs: 1_000,
            responseProjectionUs: 1_000,
            matcherOcrUs: 2_000,
            temporalDecisionUs: 1_000,
            scheduleUs: 1_000,
            playbackAcceptanceUs: 1_000,
          },
        }),
      ]);
    },
  );

  it.each(["profile", "runtime-key", "viewport"] as const)(
    "replaces an old onStarted callback after the %s lifecycle changes",
    async (mutation) => {
      const test = renderRemoteJanusWarmTrace({ playback: "pending" });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(test.collector.snapshot()).toEqual([]);
      expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
      expect(
        test.api.current?.skillIncidentRecorderRef.current.archive.attempts[0],
      ).toMatchObject({
        status: "requested",
        startedAt: null,
      });
      const playbackOptions = playAlertUntilEndedMock.mock.calls[0]?.[2];

      act(() => {
        test.rerenderLifecycle(mutation);
      });
      expect(() => {
        act(() => {
          playbackOptions?.onStarted?.();
          playbackOptions?.onStarted?.();
        });
      }).not.toThrow();

      expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
      expect(test.collector.snapshot()).toEqual([
        expect.objectContaining({
          target: "janus",
          outcome: "replaced",
          terminalStage: "playbackAcceptanceUs",
        }),
      ]);
      expect(
        test.collector.snapshot().filter((record) => record.outcome === "completed"),
      ).toEqual([]);
      if (mutation === "profile") {
        expect(
          test.api.current?.skillIncidentRecorderRef.current.archive.attempts[0],
        ).toMatchObject({
          status: "started",
          startedAt: expect.any(Number),
          startedMeaning: "browser-play-accepted",
        });
      }
    },
  );

  it("replaces a pending worker rejection after the runtime key changes", async () => {
    const test = renderRemoteJanusWarmTrace({ playback: "pending" });
    let rejectWorker!: (reason?: unknown) => void;
    const pendingWorker = new Promise<never>((_resolve, reject) => {
      rejectWorker = reject;
    });
    skillBuffDurationEngineMock.process.mockReturnValueOnce(pendingWorker);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(skillBuffDurationEngineMock.process).toHaveBeenCalledTimes(1);
    expect(test.collector.snapshot()).toEqual([]);

    act(() => {
      test.rerenderLifecycle("runtime-key");
    });
    await act(async () => {
      rejectWorker(new Error("old-runtime-worker-rejected"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(playAlertUntilEndedMock).not.toHaveBeenCalled();
    expect(test.collector.snapshot()).toEqual([
      expect.objectContaining({
        target: "janus",
        outcome: "replaced",
        terminalStage: "matcherOcrUs",
      }),
    ]);
  });

  it.each(SKILL_WARM_FEATURE_INSTRUMENTATION_FAULTS)(
    "keeps the product alert alive when $label",
    async (fault) => {
      const test = renderRemoteJanusWarmTrace({ playback: "pending" });
      if (fault.kind === "stage") {
        const completeFeatureStage =
          test.collector.completeFeatureStage.bind(test.collector);
        vi.spyOn(test.collector, "completeFeatureStage").mockImplementation(
          (claim, stage) => {
            if (stage !== fault.stage) {
              return completeFeatureStage(claim, stage);
            }
            if (fault.mode === "throw") {
              throw new Error(`skill-warm-${fault.stage}-instrumentation`);
            }
            return false;
          },
        );
      } else {
        vi.spyOn(test.collector, "completeFeature").mockImplementation(() => {
          if (fault.mode === "throw") {
            throw new Error("skill-warm-playback-instrumentation");
          }
          return false;
        });
      }

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(test.api.current?.runtimeRef.current[test.skill.id]).toMatchObject({
        status: "alerted",
        alertedAt: Date.now(),
        rejectedReading: null,
      });
      expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
      const playbackOptions = playAlertUntilEndedMock.mock.calls[0]?.[2];
      act(() => {
        playbackOptions?.onStarted?.();
      });

      expect(test.collector.snapshot()).toEqual([
        expect.objectContaining({
          target: "janus",
          outcome: "failed",
          terminalStage: fault.stage,
        }),
      ]);
      expect(
        test.api.current?.skillIncidentRecorderRef.current.archive.attempts[0],
      ).toMatchObject({
        status: "started",
        startedAt: expect.any(Number),
        startedMeaning: "browser-play-accepted",
      });
    },
  );

  it("suppresses Fountain 60 from the trace while preserving its prior due product alert", async () => {
    const test = renderRemoteSkillWarmBoundary({
      armAtStart: true,
      fixture: SKILL_WARM_VERTICAL_FIXTURES[2],
      initialRuntimeState: (skillId, sampledAt) => ({
        ...createRuntimeState(skillId),
        observedRemainingSeconds: 8,
        observedAt: sampledAt - 5_000,
        estimatedExpiresAt: sampledAt + 3_000,
        confidence: 0.95,
        status: "running" as const,
        lastAlertCycleStartedAt: sampledAt - 5_000,
      }),
      values: [60],
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(test.collector.snapshot()).toEqual([
      expect.objectContaining({
        target: "fountain",
        outcome: "suppressed",
        terminalStage: "matcherOcrUs",
      }),
    ]);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
    expect(test.api.current?.runtimeRef.current[test.skill.id]).toMatchObject({
      status: "alerted",
      alertedAt: test.now,
      observedRemainingSeconds: 60,
      observedAt: test.now,
      estimatedExpiresAt: test.now + 3_000,
      rejectedReading: 60,
    });
    const samples =
      test.api.current?.skillReportTimelineRef.current[test.skill.id]?.samples ??
      [];
    const lastSample = samples[samples.length - 1];
    expect(lastSample).toMatchObject({
      ocrValue: 60,
      rejectedReading: 60,
      shouldFireAlert: true,
      shouldRepeatAlert: false,
      alertDecision: "initial",
    });

    const playbackOptions = playAlertUntilEndedMock.mock.calls[0]?.[2];
    act(() => {
      playbackOptions?.onStarted?.();
    });
    expect(test.collector.snapshot()).toHaveLength(1);
    expect(test.collector.snapshot()[0]?.outcome).toBe("suppressed");
    expect(
      test.api.current?.skillIncidentRecorderRef.current.archive.attempts[0],
    ).toMatchObject({
      status: "started",
      startedMeaning: "browser-play-accepted",
    });
  });

  it("suppresses the first normal Yein threshold observation as pending", async () => {
    const test = renderRemoteSkillWarmBoundary({
      fixture: SKILL_WARM_VERTICAL_FIXTURES[3],
      values: [4, 3],
    });
    const bindPhysicalSample = vi.spyOn(
      test.collector,
      "bindPhysicalSample",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(test.api.current?.runtimeRef.current[test.skill.id]).toMatchObject({
      observedRemainingCount: 4,
      pendingRemainingCountAlert: null,
    });
    test.collector.armNextDecisiveTick({
      target: "yein",
      provider: "remote",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(bindPhysicalSample).toHaveBeenCalledTimes(1);
    expect(bindPhysicalSample).toHaveBeenCalledWith(
      expect.any(Object),
      test.now + 1_000,
    );
    expect(playAlertUntilEndedMock).not.toHaveBeenCalled();
    expect(test.collector.snapshot()).toEqual([
      expect.objectContaining({
        target: "yein",
        outcome: "suppressed",
        terminalStage: "temporalDecisionUs",
      }),
    ]);
    expect(test.api.current?.runtimeRef.current[test.skill.id]).toMatchObject({
      status: "running",
      observedRemainingCount: 3,
      countObservedAt: test.now + 1_000,
      rejectedReading: null,
      pendingRemainingCountDrop: null,
      pendingRemainingCountAlert: {
        observedRemainingCount: 3,
        observedAt: test.now + 1_000,
        count: 1,
      },
    });
    const samples =
      test.api.current?.skillReportTimelineRef.current[test.skill.id]?.samples ??
      [];
    expect(samples[samples.length - 1]).toMatchObject({
      ocrValue: 3,
      remainingCountDecision: "alert-threshold-pending",
      pendingRemainingCountAlertObservations: 1,
      shouldFireAlert: false,
      alertDecision: null,
    });
  });

  it("suppresses an actual Yein implausible-drop quarantine", async () => {
    const test = renderRemoteSkillWarmBoundary({
      fixture: SKILL_WARM_VERTICAL_FIXTURES[3],
      values: [11, 3],
    });
    const bindPhysicalSample = vi.spyOn(
      test.collector,
      "bindPhysicalSample",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(test.api.current?.runtimeRef.current[test.skill.id]).toMatchObject({
      observedRemainingCount: 11,
      countObservedAt: test.now,
    });
    test.collector.armNextDecisiveTick({
      target: "yein",
      provider: "remote",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(bindPhysicalSample).toHaveBeenCalledTimes(1);
    expect(bindPhysicalSample).toHaveBeenCalledWith(
      expect.any(Object),
      test.now + 1_000,
    );
    expect(playAlertUntilEndedMock).not.toHaveBeenCalled();
    expect(test.collector.snapshot()).toEqual([
      expect.objectContaining({
        target: "yein",
        outcome: "suppressed",
        terminalStage: "temporalDecisionUs",
      }),
    ]);
    expect(test.api.current?.runtimeRef.current[test.skill.id]).toMatchObject({
      status: "running",
      observedRemainingCount: 11,
      countObservedAt: test.now,
      rejectedReading: 3,
      pendingRemainingCountAlert: null,
      pendingRemainingCountDrop: {
        observedRemainingCount: 3,
        observedAt: test.now + 1_000,
        lastObservedAt: test.now + 1_000,
        count: 1,
        fromRemainingCount: 11,
        minReachableCount: 10,
      },
    });
    const samples =
      test.api.current?.skillReportTimelineRef.current[test.skill.id]?.samples ??
      [];
    expect(samples[samples.length - 1]).toMatchObject({
      ocrValue: 3,
      observedRemainingCount: 11,
      remainingCountDecision: "implausible-drop",
      remainingCountExpectedMin: 10,
      remainingCountExpectedMax: 11,
      pendingRemainingCountDropObservations: 1,
      shouldFireAlert: false,
      alertDecision: null,
    });
  });

  it("terminalizes matcher failure before a prior countdown can look successful", async () => {
    const test = renderRemoteJanusWarmTrace({
      matcherError: new Error("janus-matcher-failed"),
      playback: "pending",
      stateMode: "confirmed-due",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(test.collector.snapshot()[0]).toMatchObject({
      outcome: "failed",
      terminalStage: "matcherOcrUs",
    });
    const playbackOptions = playAlertUntilEndedMock.mock.calls[0]?.[2];
    act(() => {
      playbackOptions?.onStarted?.();
    });
    expect(test.collector.snapshot()).toHaveLength(1);
    expect(test.collector.snapshot()[0].outcome).toBe("failed");
  });

  it("suppresses a stale-reading trace even when product state still requests playback", async () => {
    const test = renderRemoteJanusWarmTrace({
      seconds: null,
      playback: "pending",
      stateMode: "confirmed-due",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
    expect(test.collector.snapshot()[0]).toMatchObject({
      outcome: "suppressed",
      terminalStage: "matcherOcrUs",
    });
    const playbackOptions = playAlertUntilEndedMock.mock.calls[0]?.[2];
    act(() => {
      playbackOptions?.onStarted?.();
    });
    expect(test.collector.snapshot()).toHaveLength(1);
    expect(test.collector.snapshot()[0].outcome).toBe("suppressed");
  });

  it("suppresses a conflicting exact reading even when prior state still requests playback", async () => {
    const test = renderRemoteJanusWarmTrace({
      seconds: 6,
      playback: "pending",
      stateMode: "confirmed-due",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
    expect(test.collector.snapshot()).toEqual([
      expect.objectContaining({
        outcome: "suppressed",
        terminalStage: "temporalDecisionUs",
      }),
    ]);
    const playbackOptions = playAlertUntilEndedMock.mock.calls[0]?.[2];
    act(() => {
      playbackOptions?.onStarted?.();
    });
    expect(test.collector.snapshot()).toHaveLength(1);
    expect(test.collector.snapshot()[0].outcome).toBe("suppressed");
  });

  it("suppresses a fresh but non-decisive Janus transition at the temporal stage", async () => {
    const test = renderRemoteJanusWarmTrace({
      initialEstimatedRemainingSeconds: 10,
      seconds: 10,
      playback: "pending",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(playAlertUntilEndedMock).not.toHaveBeenCalled();
    expect(test.collector.snapshot()).toEqual([
      expect.objectContaining({
        outcome: "suppressed",
        terminalStage: "temporalDecisionUs",
      }),
    ]);
  });

  it("rejects a Janus qualifying series when another skill is enabled", async () => {
    const quickSlotSibling = createSkill({
      id: "quick_slot_sibling",
      enabled: true,
      region: { x: 0.1, y: 0.2, width: 0.08, height: 0.08 },
    });
    const test = renderRemoteJanusWarmTrace({
      additionalSkills: [quickSlotSibling],
      playback: "pending",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(test.collector.snapshot()).toEqual([
      expect.objectContaining({
        outcome: "suppressed",
        terminalStage: "matcherOcrUs",
      }),
    ]);
  });

  it("leaves a Buff Expiry series intact for its matching feature owner", async () => {
    const test = renderRemoteJanusWarmTrace({
      playback: "pending",
      target: "union-wealth",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(sampleBuffSlotVideoFrameMock).toHaveBeenCalledTimes(1);
    expect(encodeVp8ParserFrameMock).toHaveBeenCalledTimes(1);
    expect(test.remoteParserProvider).toHaveBeenCalledTimes(1);
    expect(buffSlotAnalysisEngineMock.process).not.toHaveBeenCalled();
    expect(skillBuffDurationEngineMock.process).toHaveBeenCalledTimes(1);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
    expect(test.collector.snapshot()).toEqual([]);
    const playbackOptions = playAlertUntilEndedMock.mock.calls[0]?.[2];
    act(() => {
      playbackOptions?.onStarted?.();
    });
    expect(test.collector.snapshot()).toEqual([]);

    expect(test.collector.cancelOpen("cancelled")).toBe(true);
    expect(test.collector.snapshot()).toEqual([
      expect.objectContaining({
        target: "union-wealth",
        outcome: "cancelled",
        terminalStage: "matcherOcrUs",
      }),
    ]);
  });

  it("records preview-upgraded pending capture as one replacement", async () => {
    sampleBuffSlotVideoFrameMock
      .mockReturnValueOnce({
        imageData: createTestImageData(),
        rawPreviewUrl: null,
        regionLabel: "1280x180",
        sourceSize: { width: 4, height: 4 },
        roi: { x: 2, y: 0, width: 2, height: 2 },
      })
      .mockReturnValueOnce({
        imageData: createTestImageData(),
        rawPreviewUrl: "data:image/png;base64,upgraded",
        regionLabel: "1280x180",
        sourceSize: { width: 4, height: 4 },
        roi: { x: 2, y: 0, width: 2, height: 2 },
      });
    const test = renderRemoteJanusWarmTrace({
      onMonitoringFrame: (context) => {
        context?.sampleBuffSlotFrame({ includePreview: false });
        context?.sampleBuffSlotFrame({ includePreview: true });
      },
      playback: "pending",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(sampleBuffSlotVideoFrameMock).toHaveBeenCalledTimes(2);
    expect(test.collector.snapshot()).toEqual([
      expect.objectContaining({
        outcome: "replaced",
        terminalStage: "captureCropUs",
      }),
    ]);
    const playbackOptions = playAlertUntilEndedMock.mock.calls[0]?.[2];
    act(() => {
      playbackOptions?.onStarted?.();
    });
    expect(test.collector.snapshot()).toHaveLength(1);
  });

  it("does not consume a newly armed trace on a same-tick preview upgrade", async () => {
    sampleBuffSlotVideoFrameMock
      .mockReturnValueOnce({
        imageData: createTestImageData(),
        rawPreviewUrl: null,
        regionLabel: "1280x180",
        sourceSize: { width: 4, height: 4 },
        roi: { x: 2, y: 0, width: 2, height: 2 },
      })
      .mockReturnValueOnce({
        imageData: createTestImageData(),
        rawPreviewUrl: "data:image/png;base64,upgraded",
        regionLabel: "1280x180",
        sourceSize: { width: 4, height: 4 },
        roi: { x: 2, y: 0, width: 2, height: 2 },
      });
    let test: ReturnType<typeof renderRemoteJanusWarmTrace>;
    test = renderRemoteJanusWarmTrace({
      onMonitoringFrame: (context) => {
        context?.sampleBuffSlotFrame({ includePreview: false });
        expect(test.collector.cancelOpen("cancelled")).toBe(true);
        test.collector.armNextDecisiveTick({
          target: "janus",
          provider: "remote",
        });
        context?.sampleBuffSlotFrame({ includePreview: true });
      },
      playback: "pending",
    });
    const beginPhysicalSample = vi.spyOn(test.collector, "beginPhysicalSample");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(sampleBuffSlotVideoFrameMock).toHaveBeenCalledTimes(2);
    expect(test.collector.snapshot()).toHaveLength(1);
    expect(beginPhysicalSample).toHaveBeenCalledTimes(1);
    const nextTickHandle = test.collector.beginPhysicalSample();
    expect(nextTickHandle).not.toBeNull();
    expect(test.collector.bindPhysicalSample(nextTickHandle!, Date.now())).toBe(
      true,
    );
  });

  it("records a physical sampler failure without replacing product handling", async () => {
    const captureError = new Error("physical-sample-failed");
    sampleBuffSlotVideoFrameMock.mockImplementation(() => {
      throw captureError;
    });
    const test = renderRemoteJanusWarmTrace({
      playback: "pending",
      stateMode: "confirmed-due",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(test.collector.snapshot()).toEqual([
      expect.objectContaining({
        outcome: "failed",
        terminalStage: "captureCropUs",
      }),
    ]);
    expect(skillBuffDurationEngineMock.process).not.toHaveBeenCalled();
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
  });

  it("keeps product processing alive when physical tick binding throws", async () => {
    const bindPhysicalSample = vi
      .spyOn(
        RemoteRecognitionWarmTraceCollector.prototype,
        "bindPhysicalSample",
      )
      .mockImplementationOnce(() => {
        throw new Error("warm-trace-bind-failed");
      });
    const test = renderRemoteJanusWarmTrace({ playback: "pending" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(sampleBuffSlotVideoFrameMock).toHaveBeenCalledTimes(1);
    expect(skillBuffDurationEngineMock.process).toHaveBeenCalledTimes(1);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
    expect(test.collector.snapshot()[0]).toMatchObject({
      outcome: "failed",
      terminalStage: "captureCropUs",
    });
    bindPhysicalSample.mockRestore();
  });

  it.each(["resolve", "reject"] as const)(
    "records playback %s without onStarted as a playback failure",
    async (playback) => {
      const test = renderRemoteJanusWarmTrace({ playback });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(test.collector.snapshot()[0]).toMatchObject({
        outcome: "failed",
        terminalStage: "playbackAcceptanceUs",
      });
    },
  );

  it("records a synchronous playback throw at the acceptance stage", async () => {
    const test = renderRemoteJanusWarmTrace({ playback: "throw" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(test.collector.snapshot()).toEqual([
      expect.objectContaining({
        outcome: "failed",
        terminalStage: "playbackAcceptanceUs",
      }),
    ]);
  });

  it("cancels an accepted-path trace when monitoring unmounts before playback starts", async () => {
    const test = renderRemoteJanusWarmTrace({ playback: "pending" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(test.collector.snapshot()).toEqual([]);

    act(() => {
      test.rendered.unmount();
    });

    expect(test.collector.snapshot()[0]).toMatchObject({
      outcome: "cancelled",
      terminalStage: "playbackAcceptanceUs",
    });
  });

  it("records a transient provider drop before stale-state playback can complete it", async () => {
    const test = renderRemoteJanusWarmTrace({
      providerError: new RemoteRecognitionParserFrameDroppedError({
        sampledAt: Date.now(),
        replacedBySampledAt: null,
      }),
      playback: "pending",
      stateMode: "confirmed-due",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(test.collector.snapshot()[0]).toMatchObject({
      outcome: "dropped",
      terminalStage: "remoteRoundTripUs",
    });
    expect(skillBuffDurationEngineMock.process).not.toHaveBeenCalled();
    const playbackOptions = playAlertUntilEndedMock.mock.calls[0]?.[2];
    act(() => {
      playbackOptions?.onStarted?.();
    });
    expect(test.collector.snapshot()).toHaveLength(1);
    expect(test.collector.snapshot()[0].outcome).toBe("dropped");
  });

  it("fires a repeated skill alert from the existing alert cycle", async () => {
    const skill = createSkill({
      id: "skill_repeat_alert",
      enabled: true,
      alertThresholdSeconds: 5,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
      region: { x: 0.1, y: 0.2, width: 0.08, height: 0.08 },
    });
    const now = Date.now();
    const alertCycleStartedAt = now - 10_000;
    const profile = createProfile({ skills: [skill] });
    getRecognitionEngineMock.mockReturnValue(
      createRecognitionEngine(
        vi.fn().mockReturnValue({
          value: null,
          confidence: 0,
          debug: { reason: "temporarily-unreadable" },
        }),
      ),
    );
    playAlertUntilEndedMock.mockReturnValue(new Promise(() => {}));
    sampleSkillMock.mockReturnValue({
      imageData: createTestImageData(),
      rawPreviewUrl: "raw-repeat",
      previewUrl: "processed-repeat",
      region: { x: 10, y: 20, width: 40, height: 40 },
    });
    const initialRuntimeStates = {
      [skill.id]: {
        ...createRuntimeState(skill.id),
        observedRemainingSeconds: 1,
        observedAt: now - 11_000,
        estimatedExpiresAt: now - 10_000,
        confidence: 0.95,
        status: "alerted" as const,
        alertedAt: alertCycleStartedAt,
        lastRepeatedAlertAt: now - 4_000,
        lastAlertCycleStartedAt: alertCycleStartedAt,
      },
    };
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <MonitoringHarness
        initialRuntimeStates={initialRuntimeStates}
        profile={profile}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(playAlertUntilEndedMock).toHaveBeenCalledWith(
      skill.soundId,
      expect.any(Number),
      expect.objectContaining({ onStarted: expect.any(Function) }),
    );
    expect(api.current?.setRuntimeStates).toHaveBeenLastCalledWith({
      [skill.id]: expect.objectContaining({
        status: "alerted",
        alertedAt: alertCycleStartedAt,
        lastRepeatedAlertAt: null,
        repeatedAlertCount: 1,
      }),
    });

    const timeline = api.current?.skillReportTimelineRef.current[skill.id];
    expect(timeline?.samples[timeline.samples.length - 1]).toMatchObject({
      shouldFireAlert: false,
      shouldRepeatAlert: true,
      alertDecision: "repeat",
    });
    expect(timeline?.alertEvents[0]).toMatchObject({
      alertCycleStartedAt,
      status: "started",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });

    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
  });

  it("plays only one skill alert when duplicate buff-slot rows hit the same target in one frame", async () => {
    const skillA = createSkill({
      id: "janus_a",
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      enabled: true,
      alertThresholdSeconds: 5,
    });
    const skillB = createSkill({
      id: "janus_b",
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      enabled: true,
      alertThresholdSeconds: 5,
    });
    const now = Date.now();
    const profile = createProfile({ skills: [skillA, skillB] });
    const initialRuntimeStates = {
      [skillA.id]: {
        ...createRuntimeState(skillA.id),
        observedRemainingSeconds: 3,
        observedAt: now,
        estimatedExpiresAt: now + 3_000,
        confidence: 0.95,
        status: "running" as const,
      },
      [skillB.id]: {
        ...createRuntimeState(skillB.id),
        observedRemainingSeconds: 3,
        observedAt: now,
        estimatedExpiresAt: now + 3_000,
        confidence: 0.95,
        status: "running" as const,
      },
    };
    skillBuffDurationEngineMock.process.mockResolvedValue(
      createSkillBuffDurationSampleResponse({ seconds: 3, skillId: "janus" }),
    );
    playAlertUntilEndedMock.mockReturnValue(new Promise(() => {}));
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <MonitoringHarness
        initialRuntimeStates={initialRuntimeStates}
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

    const sampledAt = now;
    expect(skillBuffDurationEngineMock.process).toHaveBeenCalledTimes(1);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
    expect(api.current?.setRuntimeStates).toHaveBeenLastCalledWith({
      [skillA.id]: expect.objectContaining({
        status: "alerted",
        alertedAt: sampledAt,
      }),
      [skillB.id]: expect.objectContaining({
        status: "alerted",
        alertedAt: sampledAt,
      }),
    });

    expect(
      api.current?.skillReportTimelineRef.current[skillA.id]?.alertEvents,
    ).toHaveLength(1);
    expect(
      api.current?.skillReportTimelineRef.current[skillB.id]?.alertEvents ?? [],
    ).toHaveLength(0);
    const incidentArchive =
      api.current?.skillIncidentRecorderRef.current.archive;
    expect(incidentArchive?.arbitrations).toEqual([
      expect.objectContaining({
        dueSkillIds: [skillA.id, skillB.id],
        winnerSkillId: skillA.id,
        suppressedSkillIds: [skillB.id],
      }),
    ]);
    expect(
      incidentArchive?.decisions.map((decision) => ({
        skillId: decision.skillId,
        outcome: decision.outcome,
        hasAttempt: decision.attemptId !== null,
      })),
    ).toEqual([
      { skillId: skillA.id, outcome: "requested", hasAttempt: true },
      {
        skillId: skillB.id,
        outcome: "suppressed-duplicate-target",
        hasAttempt: false,
      },
    ]);
  });

  it("resets the skill buff-duration engine when no precision targets remain active", async () => {
    const skill = createSkill({
      id: "janus_cleanup",
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      enabled: true,
    });
    const enabledProfile = createProfile({ skills: [skill] });
    const disabledProfile = createProfile({
      skills: [
        {
          ...skill,
          enabled: false,
        },
      ],
    });
    skillBuffDurationEngineMock.process.mockResolvedValue(
      createSkillBuffDurationSampleResponse({
        seconds: null,
        skillId: "janus",
      }),
    );
    const api: { current: HarnessApi | null } = { current: null };

    const { rerender } = render(
      <MonitoringHarness
        profile={enabledProfile}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(skillBuffDurationEngineMock.process).toHaveBeenCalledTimes(1);

    rerender(
      <MonitoringHarness
        profile={disabledProfile}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(skillBuffDurationEngineMock.reset).toHaveBeenCalledTimes(1);
    expect(skillBuffDurationEngineMock.process).toHaveBeenCalledTimes(1);
  });

  it("records skill sampling failures without playing an alert", async () => {
    const skill = createSkill({
      id: "skill_sample_failure",
      enabled: true,
      region: { x: 0.1, y: 0.2, width: 0.08, height: 0.08 },
    });
    const profile = createProfile({ skills: [skill] });
    sampleSkillMock.mockImplementation(() => {
      throw new Error("canvas-context-unavailable");
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
      vi.advanceTimersByTime(0);
    });

    expect(playAlertUntilEndedMock).not.toHaveBeenCalled();
    expect(api.current?.setRuntimeStates).toHaveBeenLastCalledWith({
      [skill.id]: expect.objectContaining({
        status: "detecting",
      }),
    });
    expect(api.current?.setSnapshots).toHaveBeenLastCalledWith({
      [skill.id]: expect.objectContaining({
        rawPreviewUrl: null,
        previewUrl: null,
        regionLabel: null,
        result: expect.objectContaining({
          value: null,
          confidence: 0,
          debug: { reason: "canvas-context-unavailable" },
        }),
      }),
    });
    const timeline = api.current?.skillReportTimelineRef.current[skill.id];
    expect(timeline?.samples[timeline.samples.length - 1]).toMatchObject({
      ocrValue: null,
      reason: "canvas-context-unavailable",
      shouldFireAlert: false,
      shouldRepeatAlert: false,
      alertDecision: null,
    });
  });

  it("publishes the real precision runtime frame for a pending skill report", async () => {
    const skill = createSkill({
      id: "janus-runtime-report",
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      enabled: true,
    });
    const coordinator = createRuntimeReportEvidenceCoordinator();
    const pending = coordinator.request<SkillBuffDurationRuntimeReportPayload>({
      feature: "skill-buff-duration",
      targetId: skill.id,
    });
    skillBuffDurationEngineMock.process.mockResolvedValue(
      createSkillBuffDurationSampleResponse({
        seconds: 12,
        skillId: "janusDeepV2",
      }),
    );

    render(
      <MonitoringHarness
        profile={createProfile({ skills: [skill] })}
        stream={{} as MediaStream}
        runtimeReportEvidenceCoordinator={coordinator}
        onReady={vi.fn()}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const evidence = await pending;

    expect(skillBuffDurationEngineMock.process).toHaveBeenCalledTimes(1);
    expect(evidence).toMatchObject({
      target: { feature: "skill-buff-duration", targetId: skill.id },
      source: {
        kind: "buff-slot-top-right-quadrant-v1",
        parserInputMode: "topRightQuadrant",
      },
      parser: {
        engine: "dl",
        version: "test-shared-parser",
        fallbackReason: null,
      },
      payload: {
        skillId: skill.id,
        snapshot: {
          sampledAt: expect.any(Number),
          buffDuration: {
            detected: true,
            countdown: { totalSeconds: 12 },
          },
        },
        traceSample: {
          sampledAt: expect.any(Number),
          ocrValue: 12,
        },
      },
    });
  });

  it("preserves shared parser failures for precision skill reports", async () => {
    const skill = createSkill({
      id: "janus-parser-failure-report",
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      enabled: true,
    });
    const coordinator = createRuntimeReportEvidenceCoordinator();
    const journal = createAlertIncidentJournal();
    buffSlotAnalysisEngineMock.process.mockRejectedValueOnce(
      new Error("dl-buff-parser-webgpu-unavailable"),
    );
    const pending = coordinator.request<SkillBuffDurationRuntimeReportPayload>({
      feature: "skill-buff-duration",
      targetId: skill.id,
    });

    render(
      <MonitoringHarness
        profile={createProfile({ skills: [skill] })}
        stream={{} as MediaStream}
        runtimeReportEvidenceCoordinator={coordinator}
        alertIncidentJournal={journal}
        onReady={vi.fn()}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const evidence = await pending;
    expect(evidence.parser.failure).toMatchObject({
      reason: "webgpu-unavailable",
      technicalMessage: "dl-buff-parser-webgpu-unavailable",
    });
    expect(
      journal.freeze({ feature: "skill", targetId: skill.id }).entries[0],
    ).toMatchObject({
      decision: expect.any(String),
      details: {
        parserFailureReason: "webgpu-unavailable",
      },
    });
  });

  it("keeps disabled skills out of image sampling and publishes a paused snapshot", async () => {
    const skill = createSkill({
      id: "skill_disabled",
      enabled: false,
      region: { x: 0.1, y: 0.2, width: 0.08, height: 0.08 },
    });
    const profile = createProfile({ skills: [skill] });
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
      vi.advanceTimersByTime(0);
    });

    expect(sampleSkillMock).not.toHaveBeenCalled();
    expect(getRecognitionEngineMock).not.toHaveBeenCalled();
    expect(api.current?.setRuntimeStates).toHaveBeenLastCalledWith({
      [skill.id]: expect.objectContaining({
        status: "paused",
      }),
    });
    expect(api.current?.setSnapshots).toHaveBeenLastCalledWith({
      [skill.id]: expect.objectContaining({
        rawPreviewUrl: null,
        previewUrl: null,
        regionLabel: null,
        result: expect.objectContaining({
          value: null,
          confidence: 0,
          debug: { reason: "no-region" },
        }),
      }),
    });
  });

  it("updates rune state and snapshot from minimap detection", async () => {
    const runeRegion = { x: 0.02, y: 0.03, width: 0.2, height: 0.18 };
    const profile = createProfile({
      runeAlert: {
        ...createDefaultRuneAlert(),
        enabled: true,
        region: runeRegion,
      },
    });
    const runeImageData = createTestImageData(6, 6);
    const maskImageData = createTestImageData(6, 6);
    sampleVideoRegionMock.mockReturnValue({
      imageData: runeImageData,
      rawPreviewUrl: "rune-raw",
      region: { x: 25, y: 30, width: 200, height: 120 },
    });
    detectRuneInMinimapMock.mockReturnValue({
      detected: true,
      confidence: 0.82,
      candidates: [
        {
          x: 7,
          y: 9,
          width: 18,
          height: 20,
          pixelCount: 64,
          confidence: 0.82,
        },
      ],
      debug: {
        purplePixelRatio: 0.12,
        componentCount: 1,
      },
    });
    createRuneMaskPreviewMock.mockReturnValue(maskImageData);
    imageDataToUrlMock.mockReturnValue("rune-mask");
    cropRuneCandidateToUrlMock.mockImplementation((_imageData, candidate) =>
      candidate ? "rune-candidate" : null,
    );
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <MonitoringHarness
        profile={profile}
        showDebugColumns
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(sampleVideoRegionMock).toHaveBeenCalledWith(
      expect.any(HTMLVideoElement),
      runeRegion,
      true,
      420,
    );
    expect(detectRuneInMinimapMock).toHaveBeenCalledWith(runeImageData);
    expect(createRuneMaskPreviewMock).toHaveBeenCalledWith(runeImageData, [
      expect.objectContaining({ width: 18, height: 20 }),
    ]);
    expect(api.current?.setRuneRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "candidate",
        confidence: 0.82,
        stableCount: 1,
        candidateCount: 1,
      }),
    );
    expect(api.current?.setRuneSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rawPreviewUrl: "rune-raw",
        maskPreviewUrl: "rune-mask",
        candidatePreviewUrl: null,
        detected: true,
        confidence: 0.82,
        candidateCount: 1,
      }),
    );
  });

  it("fires a rune alert and stores candidate previews after stable detections", async () => {
    const runeRegion = { x: 0.02, y: 0.03, width: 0.2, height: 0.18 };
    const profile = createProfile({
      runeAlert: {
        ...createDefaultRuneAlert(),
        enabled: true,
        region: runeRegion,
      },
    });
    const runeImageData = createTestImageData(6, 6);
    const maskImageData = createTestImageData(6, 6);
    sampleVideoRegionMock.mockReturnValue({
      imageData: runeImageData,
      rawPreviewUrl: "rune-alert-raw",
      region: { x: 25, y: 30, width: 200, height: 120 },
    });
    detectRuneInMinimapMock.mockReturnValue({
      detected: true,
      confidence: 0.91,
      candidates: [
        {
          x: 7,
          y: 9,
          width: 18,
          height: 20,
          pixelCount: 64,
          confidence: 0.91,
        },
      ],
      debug: {
        purplePixelRatio: 0.12,
        componentCount: 1,
      },
    });
    createRuneMaskPreviewMock.mockReturnValue(maskImageData);
    imageDataToUrlMock.mockImplementation((imageData) =>
      imageData === runeImageData ? "rune-alert-raw" : "rune-alert-mask",
    );
    cropRuneCandidateToUrlMock.mockImplementation((_imageData, candidate) =>
      candidate ? "rune-alert-candidate" : null,
    );
    playAlertUntilEndedMock.mockReturnValue(new Promise(() => {}));
    const journal = createAlertIncidentJournal();
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <MonitoringHarness
        profile={profile}
        showDebugColumns
        stream={{} as MediaStream}
        alertIncidentJournal={journal}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    const alertedAt = Date.now();
    expect(playAlertUntilEndedMock).toHaveBeenCalledWith(
      profile.runeAlert?.soundId,
      expect.any(Number),
      { onStarted: expect.any(Function) },
    );
    const playbackOptions = playAlertUntilEndedMock.mock.calls[0]?.[2] as
      { onStarted?: () => void } | undefined;
    act(() => {
      playbackOptions?.onStarted?.();
    });
    expect(api.current?.runeRuntimeRef.current.lastAlertPlayback).toMatchObject(
      {
        status: "started",
        requestedAt: alertedAt,
        startedAt: alertedAt,
      },
    );
    expect(api.current?.setRuneRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "alerted",
        alertedAt,
        stableCount: 4,
        candidateCount: 1,
      }),
    );
    expect(api.current?.setRuneSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rawPreviewUrl: "rune-alert-raw",
        maskPreviewUrl: "rune-alert-mask",
        candidatePreviewUrl: "rune-alert-candidate",
        candidateRawPreviewUrl: "rune-alert-raw",
        candidateMaskPreviewUrl: "rune-alert-mask",
        candidateRegionLabel: "18x20",
        candidateSampledAt: alertedAt,
        candidate: {
          x: 7,
          y: 9,
          width: 18,
          height: 20,
          confidence: 0.91,
          source: null,
        },
        detected: true,
        confidence: 0.91,
        candidateCount: 1,
      }),
    );
    const incidentEntries = journal.freeze({ feature: "rune" }).entries;
    const episodeIds = incidentEntries
      .map((entry) => entry.details.episodeId)
      .filter((entry): entry is string => typeof entry === "string");
    expect(episodeIds.length).toBeGreaterThan(1);
    expect(new Set(episodeIds).size).toBe(1);
    expect(
      incidentEntries.find((entry) => entry.kind === "playback"),
    ).toMatchObject({
      details: { episodeId: episodeIds[0] },
    });
  });

  it("resets the rune worker when rune detection is disabled", async () => {
    const runeRegion = { x: 0.02, y: 0.03, width: 0.2, height: 0.18 };
    const enabledProfile = createProfile({
      runeAlert: {
        ...createDefaultRuneAlert(),
        enabled: true,
        region: runeRegion,
      },
    });
    const disabledProfile = createProfile({
      runeAlert: {
        ...createDefaultRuneAlert(),
        enabled: false,
        region: runeRegion,
      },
    });
    sampleVideoRegionMock.mockReturnValue({
      imageData: createTestImageData(6, 6),
      rawPreviewUrl: "rune-cleanup",
      region: { x: 25, y: 30, width: 200, height: 120 },
    });
    detectRuneInMinimapMock.mockReturnValue({
      detected: false,
      confidence: 0,
      candidates: [],
      debug: {
        purplePixelRatio: 0,
        componentCount: 0,
      },
    });
    const api: { current: HarnessApi | null } = { current: null };

    const { rerender } = render(
      <MonitoringHarness
        profile={enabledProfile}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(runeDetectionWorkerClientMock.detect).toHaveBeenCalledTimes(1);

    rerender(
      <MonitoringHarness
        profile={disabledProfile}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(runeDetectionWorkerClientMock.reset).toHaveBeenCalledTimes(1);
    expect(runeDetectionWorkerClientMock.detect).toHaveBeenCalledTimes(1);
  });

  it("unlocks the rune candidate when initial alert playback fails", async () => {
    const runeRegion = { x: 0.02, y: 0.03, width: 0.2, height: 0.18 };
    const profile = createProfile({
      runeAlert: {
        ...createDefaultRuneAlert(),
        enabled: true,
        region: runeRegion,
      },
    });
    const runeImageData = createTestImageData(6, 6);
    sampleVideoRegionMock.mockReturnValue({
      imageData: runeImageData,
      rawPreviewUrl: "rune-alert-raw",
      region: { x: 25, y: 30, width: 200, height: 120 },
    });
    detectRuneInMinimapMock.mockReturnValue({
      detected: true,
      confidence: 0.91,
      candidates: [
        {
          x: 7,
          y: 9,
          width: 18,
          height: 20,
          pixelCount: 64,
          confidence: 0.91,
        },
      ],
      debug: {
        purplePixelRatio: 0.12,
        componentCount: 1,
      },
    });
    imageDataToUrlMock.mockReturnValue("rune-alert-raw");
    cropRuneCandidateToUrlMock.mockReturnValue("rune-alert-candidate");
    playAlertUntilEndedMock.mockRejectedValue(new Error("NotAllowedError"));
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <MonitoringHarness
        profile={profile}
        showDebugColumns
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      await Promise.resolve();
    });

    expect(playAlertUntilEndedMock).toHaveBeenCalled();
    expect(api.current?.onMessage).toHaveBeenCalledWith("NotAllowedError");
    expect(api.current?.runeRuntimeRef.current).toEqual(
      expect.objectContaining({
        status: "candidate",
        alertedAt: null,
        alertedCandidate: null,
        stableCount: 0,
        lastDecisionReason: "playback-failed",
        lastAlertPlayback: expect.objectContaining({
          status: "failed",
          decision: "initial",
          error: "NotAllowedError",
        }),
      }),
    );
  });

  it("reports rune sampling failures and publishes a failed snapshot", async () => {
    const runeRegion = { x: 0.02, y: 0.03, width: 0.2, height: 0.18 };
    const profile = createProfile({
      runeAlert: {
        ...createDefaultRuneAlert(),
        enabled: true,
        region: runeRegion,
      },
    });
    sampleVideoRegionMock.mockImplementation(() => {
      throw new Error("canvas-context-unavailable");
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
      vi.advanceTimersByTime(0);
    });

    expect(api.current?.onMessage).toHaveBeenCalledWith(
      "룬 감지용 캔버스를 준비하지 못했습니다.",
    );
    expect(playAlertUntilEndedMock).not.toHaveBeenCalled();
    expect(api.current?.setRuneRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "waiting",
        confidence: 0,
        candidateCount: 0,
      }),
    );
    expect(api.current?.setRuneSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rawPreviewUrl: null,
        maskPreviewUrl: null,
        candidatePreviewUrl: null,
        candidateRawPreviewUrl: null,
        candidateMaskPreviewUrl: null,
        candidateRegionLabel: null,
        candidateSampledAt: null,
        candidate: null,
        detected: false,
        confidence: 0,
        candidateCount: 0,
      }),
    );
  });

  it("keeps rune worker failures unavailable until a bounded retry succeeds", async () => {
    const runeRegion = { x: 0.02, y: 0.03, width: 0.2, height: 0.18 };
    const profile = createProfile({
      runeAlert: {
        ...createDefaultRuneAlert(),
        enabled: true,
        region: runeRegion,
      },
    });
    sampleVideoRegionMock.mockReturnValue({
      imageData: createTestImageData(6, 6),
      rawPreviewUrl: "rune-retry-raw",
      region: { x: 25, y: 30, width: 200, height: 120 },
    });
    runeDetectionWorkerClientMock.detect
      .mockRejectedValueOnce(
        new RuneDetectionWorkerClientError(
          "rune-detection-worker-runtime-failed",
          "worker-runtime",
          "Failed to load worker module",
        ),
      )
      .mockResolvedValueOnce({
        detected: false,
        confidence: 0.08,
        candidates: [],
        debug: {
          classifier: RUNE_ONNX_MODEL_VERSION,
          detectorKind: "onnx-full-frame",
          modelScore: 0.08,
          modelThreshold: RUNE_ONNX_THRESHOLD,
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

    expect(runeDetectionWorkerClientMock.detect).toHaveBeenCalledTimes(1);
    expect(runeDetectionWorkerClientMock.reset).toHaveBeenCalledTimes(1);
    expect(api.current?.runeRuntimeRef.current).toMatchObject({
      status: "unavailable",
      stableCount: 0,
      lastDecisionReason: "detector-error",
      lastDetectionError: {
        phase: "worker-runtime",
        retryCount: 0,
      },
    });
    const recentSamples =
      api.current?.runeRuntimeRef.current.recentSamples ?? [];
    expect(recentSamples[recentSamples.length - 1]).toMatchObject({
      outcome: "error",
      reason: "detector-error",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(runeDetectionWorkerClientMock.detect).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(runeDetectionWorkerClientMock.detect).toHaveBeenCalledTimes(2);
    expect(api.current?.runeRuntimeRef.current).toMatchObject({
      status: "waiting",
      detectorVersion: RUNE_ONNX_MODEL_VERSION,
      lastDetectionError: null,
    });
  });

  it("marks enabled rune alerts without a region as no-region without sampling", async () => {
    const profile = createProfile({
      runeAlert: {
        ...createDefaultRuneAlert(),
        enabled: true,
        region: null,
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
      vi.advanceTimersByTime(0);
    });

    expect(sampleVideoRegionMock).not.toHaveBeenCalled();
    expect(playAlertUntilEndedMock).not.toHaveBeenCalled();
    expect(api.current?.setRuneRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "no-region",
        confidence: 0,
        candidateCount: 0,
      }),
    );
    expect(api.current?.setRuneSnapshot).toHaveBeenLastCalledWith(null);
  });
});

function createRemoteParserProviderResult(sampledAt: number) {
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

function renderRemoteJanusWarmTrace({
  additionalSkills = [],
  initialEstimatedRemainingSeconds = 3,
  matcherError,
  onMonitoringFrame,
  playback,
  providerError,
  seconds = 3,
  stateMode = "canonical-pending",
  target = "janus",
}: {
  additionalSkills?: ReturnType<typeof createSkill>[];
  initialEstimatedRemainingSeconds?: number;
  matcherError?: Error;
  onMonitoringFrame?: Parameters<
    typeof MonitoringHarness
  >[0]["onMonitoringFrame"];
  playback: "pending" | "resolve" | "reject" | "throw";
  providerError?: Error;
  seconds?: number | null;
  stateMode?: "canonical-pending" | "confirmed-due";
  target?: RemoteRecognitionWarmTraceTarget;
}) {
  const now = Date.now();
  const skill = createSkill({
    id: "janus_remote_warm_failure",
    presetId: "sol-janus-dawn-deep-v2",
    detectionSource: "buff-duration",
    enabled: true,
    alertThresholdSeconds: 5,
    repeatAlertEnabled: false,
  });
  const profile = createProfile({ skills: [skill, ...additionalSkills] });
  const initialRuntimeStates = {
    [skill.id]:
      stateMode === "confirmed-due"
        ? {
            ...createRuntimeState(skill.id),
            observedRemainingSeconds: initialEstimatedRemainingSeconds + 5,
            observedAt: now - 5_000,
            estimatedExpiresAt: now + initialEstimatedRemainingSeconds * 1_000,
            confidence: 0.95,
            status: "running" as const,
          }
        : {
            ...createRuntimeState(skill.id),
            observedRemainingSeconds: initialEstimatedRemainingSeconds + 1,
            observedAt: now - 1_000,
            confidence: 0.95,
            status: "detecting" as const,
            pendingShortAnchor: {
              observedRemainingSeconds: initialEstimatedRemainingSeconds + 1,
              maxObservedRemainingSeconds: initialEstimatedRemainingSeconds + 5,
              observedAt: now - 1_000,
              estimatedExpiresAt:
                now + initialEstimatedRemainingSeconds * 1_000,
              count: 5,
            },
          },
  };
  if (matcherError) {
    skillBuffDurationEngineMock.process.mockRejectedValue(matcherError);
  } else {
    skillBuffDurationEngineMock.process.mockResolvedValue({
      ...createSkillBuffDurationSampleResponse({
        seconds,
        target: "janus",
      }),
      sampledAt: now,
    });
  }
  if (playback === "resolve") {
    playAlertUntilEndedMock.mockResolvedValue(undefined);
  } else if (playback === "reject") {
    playAlertUntilEndedMock.mockRejectedValue(new Error("playback-rejected"));
  } else if (playback === "throw") {
    playAlertUntilEndedMock.mockImplementation(() => {
      throw new Error("playback-threw-synchronously");
    });
  } else {
    playAlertUntilEndedMock.mockReturnValue(new Promise(() => {}));
  }
  const remoteParserProvider = providerError
    ? vi.fn().mockRejectedValue(providerError)
    : vi.fn(({ sampledAt }: { sampledAt: number }) =>
        Promise.resolve(createRemoteParserProviderResult(sampledAt)),
      );
  let monotonicNowMs = 0;
  const collector = new RemoteRecognitionWarmTraceCollector({
    browserClass: "chromium-local-headed",
    monotonicNowMs: () => {
      const value = monotonicNowMs;
      monotonicNowMs += 1;
      return value;
    },
    scheduleTimeout: () => () => undefined,
  });
  collector.armNextDecisiveTick({ target, provider: "remote" });

  const api: { current: HarnessApi | null } = { current: null };
  const stream = {} as MediaStream;
  const onReady = (next: HarnessApi) => {
    api.current = next;
  };
  const renderHarness = ({
    gameViewportRevision = 0,
    inputTransport = PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
    nextProfile = profile,
  }: {
    gameViewportRevision?: number;
    inputTransport?: Parameters<
      typeof MonitoringHarness
    >[0]["precisionParserInputTransport"];
    nextProfile?: typeof profile;
  } = {}) => (
    <MonitoringHarness
      gameViewportRevision={gameViewportRevision}
      initialRuntimeStates={initialRuntimeStates}
      profile={nextProfile}
      stream={stream}
      precisionParserInputTransport={inputTransport}
      remoteParserProvider={remoteParserProvider}
      remoteRecognitionWarmTracePort={collector}
      onMonitoringFrame={onMonitoringFrame}
      onReady={onReady}
    />
  );
  const rendered = render(renderHarness());
  const rerenderLifecycle = (
    mutation: "profile" | "runtime-key" | "viewport",
  ) => {
    rendered.rerender(
      renderHarness({
        gameViewportRevision: mutation === "viewport" ? 1 : 0,
        inputTransport:
          mutation === "runtime-key"
            ? PRECISION_PARSER_INPUT_TRANSPORT_SOURCE
            : PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
        nextProfile: mutation === "profile" ? { ...profile } : profile,
      }),
    );
  };
  return {
    api,
    collector,
    profile,
    remoteParserProvider,
    rendered,
    rerenderLifecycle,
    skill,
  };
}

function renderRemoteSkillWarmBoundary({
  armAtStart = false,
  fixture,
  initialRuntimeState,
  values,
}: {
  armAtStart?: boolean;
  fixture: (typeof SKILL_WARM_VERTICAL_FIXTURES)[number];
  initialRuntimeState?: (
    skillId: string,
    sampledAt: number,
  ) => ReturnType<typeof createRuntimeState>;
  values: readonly number[];
}) {
  const now = Date.now();
  const skill = createSkill({
    id: `${fixture.target}_remote_warm_boundary`,
    presetId: fixture.presetId,
    detectionSource: "buff-duration",
    enabled: true,
    alertThresholdSeconds: fixture.threshold,
    repeatAlertEnabled: false,
  });
  const profile = createProfile({ skills: [skill] });
  const initialRuntimeStates = initialRuntimeState
    ? { [skill.id]: initialRuntimeState(skill.id, now) }
    : undefined;
  let responseIndex = 0;
  skillBuffDurationEngineMock.process.mockImplementation(
    ({ sampledAt }: { sampledAt?: number }) => {
      const value = values[Math.min(responseIndex, values.length - 1)];
      responseIndex += 1;
      return Promise.resolve({
        ...createSkillBuffDurationSampleResponse({
          remainingCount:
            fixture.valueKind === "remaining-count" ? value : undefined,
          seconds: fixture.valueKind === "countdown" ? value : null,
          target: fixture.target,
        }),
        sampledAt: sampledAt ?? null,
      });
    },
  );
  playAlertUntilEndedMock.mockReturnValue(new Promise(() => {}));
  const remoteParserProvider = vi.fn(
    ({ sampledAt }: { sampledAt: number }) =>
      Promise.resolve(createRemoteParserProviderResult(sampledAt)),
  );
  let monotonicNowMs = 0;
  const collector = new RemoteRecognitionWarmTraceCollector({
    browserClass: "chromium-local-headed",
    monotonicNowMs: () => {
      const value = monotonicNowMs;
      monotonicNowMs += 1;
      return value;
    },
    scheduleTimeout: () => () => undefined,
  });
  if (armAtStart) {
    collector.armNextDecisiveTick({
      target: fixture.target,
      provider: "remote",
    });
  }
  const api: { current: HarnessApi | null } = { current: null };
  const rendered = render(
    <MonitoringHarness
      initialRuntimeStates={initialRuntimeStates}
      profile={profile}
      stream={{} as MediaStream}
      precisionParserInputTransport={
        PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW
      }
      remoteParserProvider={remoteParserProvider}
      remoteRecognitionWarmTracePort={collector}
      onReady={(next) => {
        api.current = next;
      }}
    />,
  );
  return {
    api,
    collector,
    now,
    profile,
    remoteParserProvider,
    rendered,
    skill,
  };
}
