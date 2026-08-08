import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuffExpiryBox, BuffExpiryAcceptedMatch } from "../../../lib/buffExpiry/buffExpiryTypes";
import { SUPPORTED_BUFF_EXPIRY_BUFF_IDS } from "../../../lib/buffExpiry/buffExpiryCatalog";
import { getBuffExpiryRemainingSeconds } from "../../../lib/buffExpiry/buffExpiryRuntimeTiming";
import { createDefaultBuffExpiryAlert, createDefaultBoosterExpiryAlert, createDefaultHuntStallAlert, createDefaultRuneAlert } from "../../../lib/storage";
import { createSkill } from "../../../lib/profileFactory";
import { createRuntimeState } from "../../../lib/timer";
import {
  BUFF_EXPIRY_BOX,
  MonitoringHarness,
  buffExpiryPrecisionEngineMock,
  buffExpiryPreviewMock,
  boosterExpiryWorkerMock,
  cleanupMonitoringLoopTestHarness,
  createBoosterExpiryWorkerResult,
  createBuffExpiryMatch,
  createBuffExpiryPrecisionSampleResponse,
  createBuffExpiryTemporalCandidateMatch,
  createProfile,
  createRecognitionEngine,
  createTestImageData,
  cropRuneCandidateToUrlMock,
  detectRuneInMinimapMock,
  getRecognitionEngineMock,
  huntStallCooldownWorkerMock,
  huntStallOcrEngineMock,
  imageDataToUrlMock,
  playAlertMock,
  playAlertUntilEndedMock,
  resetMonitoringLoopTestMocks,
  sampleSkillMock,
  sampleVideoRegionMock,
  type HarnessApi,
} from "./useMonitoringLoopTestHarness";

describe("useMonitoringLoop hunt Booster", () => {
  beforeEach(() => {
    resetMonitoringLoopTestMocks();
  });

  afterEach(() => {
    cleanupMonitoringLoopTestHarness();
  });

  it("samples the hunt stall cooldown region and alerts when an armed number disappears", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    huntStallCooldownWorkerMock.process
      .mockResolvedValueOnce({
        result: {
          value: 7,
          confidence: 0.9,
          debug: { digitCount: 1, foregroundRatio: 0.2, recognizedText: "7" },
        },
        performance: {
          recognitionMs: 0.8,
          totalMs: 1,
        },
      })
      .mockResolvedValueOnce({
        result: {
          value: 6,
          confidence: 0.9,
          debug: { digitCount: 1, foregroundRatio: 0.2, recognizedText: "6" },
        },
        performance: {
          recognitionMs: 0.8,
          totalMs: 1,
        },
      })
      .mockResolvedValue({
        result: {
          value: null,
          confidence: 0.1,
          debug: { reason: "ocr-empty", foregroundRatio: 0.02 },
        },
        performance: {
          recognitionMs: 0.8,
          totalMs: 1,
        },
      });
    sampleSkillMock.mockReturnValue({
      imageData: createTestImageData(),
      rawPreviewUrl: "data:image/png;base64,cooldown-raw",
      previewUrl: "data:image/png;base64,cooldown-processed",
      region: { x: 128, y: 144, width: 32, height: 32 },
    });
    const profile = createProfile({
      huntStallAlert: {
        ...createDefaultHuntStallAlert(),
        enabled: true,
        mode: "cooldown-presence",
        cooldownRegion: { x: 0.1, y: 0.2, width: 0.025, height: 0.045 },
        cooldownMissingThresholdSeconds: 5,
      },
    });

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
      await vi.advanceTimersByTimeAsync(7_000);
    });

    expect(sampleSkillMock).toHaveBeenCalledWith(
      expect.any(HTMLVideoElement),
      { x: 0.1, y: 0.2, width: 0.025, height: 0.045 },
      expect.any(Boolean),
    );
    expect(huntStallCooldownWorkerMock.process).toHaveBeenCalledWith(expect.any(ImageData));
    expect(playAlertMock).not.toHaveBeenCalled();
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
    expect(api.current?.huntStallRuntimeRef.current).toMatchObject({
      status: "alerted",
      hasObservedCooldownPresence: true,
      cooldownMissingSeconds: expect.any(Number),
      lastDecision: "cooldown-alerted",
    });
    expect(api.current?.setHuntStallSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: "cooldown-presence",
        rawPreviewUrl: "data:image/png;base64,cooldown-raw",
        processedPreviewUrl: "data:image/png;base64,cooldown-processed",
      }),
    );
  });

  it("keeps hunt stall cooldown trace and crop history while debug columns are off", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    huntStallCooldownWorkerMock.process.mockResolvedValue({
      result: {
        value: 7,
        confidence: 0.9,
        debug: { digitCount: 1, foregroundRatio: 0.2, recognizedText: "7" },
      },
      activity: {
        fingerprint: "7".repeat(256),
        gridColumns: 16,
        gridRows: 16,
        foregroundRatio: 0.2,
      },
      performance: {
        recognitionMs: 0.8,
        totalMs: 1,
      },
    });
    sampleSkillMock.mockReturnValue({
      imageData: createTestImageData(),
      rawPreviewUrl: "data:image/png;base64,cooldown-raw-history",
      previewUrl: "data:image/png;base64,cooldown-processed-history",
      region: { x: 128, y: 144, width: 32, height: 32 },
    });
    const profile = createProfile({
      huntStallAlert: {
        ...createDefaultHuntStallAlert(),
        enabled: true,
        mode: "cooldown-presence",
        cooldownRegion: { x: 0.1, y: 0.2, width: 0.025, height: 0.045 },
        cooldownMissingThresholdSeconds: 5,
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

    expect(sampleSkillMock).toHaveBeenCalledWith(
      expect.any(HTMLVideoElement),
      { x: 0.1, y: 0.2, width: 0.025, height: 0.045 },
      true,
    );
    const snapshotCalls = api.current?.setHuntStallSnapshot.mock.calls ?? [];
    const snapshot = snapshotCalls[snapshotCalls.length - 1]?.[0];
    expect(snapshot).toMatchObject({
      mode: "cooldown-presence",
      runtimeTrace: expect.arrayContaining([
        expect.objectContaining({
          sampledAt: expect.any(Number),
          status: "watching",
          lastDecision: "cooldown-arming",
          snapshotRecognizedText: "7",
        }),
      ]),
      cropHistory: expect.arrayContaining([
        expect.objectContaining({
          rawDataUrl: "data:image/png;base64,cooldown-raw-history",
          processedDataUrl: "data:image/png;base64,cooldown-processed-history",
          recognizedText: "7",
        }),
      ]),
    });
  });

  it("ignores stale hunt stall cooldown samples after the profile changes", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    let resolveCooldownSample!: (
      value: Awaited<ReturnType<typeof huntStallCooldownWorkerMock.process>>,
    ) => void;
    const pendingCooldownSample = new Promise<Awaited<ReturnType<typeof huntStallCooldownWorkerMock.process>>>(
      (resolve) => {
        resolveCooldownSample = resolve;
      },
    );
    huntStallCooldownWorkerMock.process.mockReturnValueOnce(pendingCooldownSample);
    sampleSkillMock.mockReturnValue({
      imageData: createTestImageData(),
      rawPreviewUrl: "data:image/png;base64,stale-cooldown-raw",
      previewUrl: "data:image/png;base64,stale-cooldown-processed",
      region: { x: 128, y: 144, width: 32, height: 32 },
    });
    const cooldownProfile = createProfile({
      huntStallAlert: {
        ...createDefaultHuntStallAlert(),
        enabled: true,
        mode: "cooldown-presence",
        cooldownRegion: { x: 0.1, y: 0.2, width: 0.025, height: 0.045 },
      },
    });
    const manualProfile = createProfile({
      huntStallAlert: {
        ...createDefaultHuntStallAlert(),
        enabled: true,
        mode: "manual-experience",
        manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
      },
    });

    const { rerender } = render(
      <MonitoringHarness
        profile={cooldownProfile}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(huntStallCooldownWorkerMock.process).toHaveBeenCalledTimes(1);

    rerender(
      <MonitoringHarness
        profile={manualProfile}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      resolveCooldownSample({
        result: {
          value: 7,
          confidence: 0.9,
          debug: { digitCount: 1, foregroundRatio: 0.2, recognizedText: "7" },
        },
        activity: {
          fingerprint: "7".repeat(256),
          gridColumns: 16,
          gridRows: 16,
          foregroundRatio: 0.2,
        },
        performance: {
          recognitionMs: 0.8,
          totalMs: 1,
        },
      });
      await Promise.resolve();
    });

    expect(api.current?.setHuntStallSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "cooldown-presence",
        rawPreviewUrl: "data:image/png;base64,stale-cooldown-raw",
      }),
    );
  });

  it("does not reset the hunt stall OCR worker again when the first manual sample is stale", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    let resolveManualSample!: (
      value: Awaited<ReturnType<typeof huntStallOcrEngineMock.processCrop>>,
    ) => void;
    const pendingManualSample = new Promise<Awaited<ReturnType<typeof huntStallOcrEngineMock.processCrop>>>(
      (resolve) => {
        resolveManualSample = resolve;
      },
    );
    const staleProfile = createProfile({
      huntStallAlert: {
        ...createDefaultHuntStallAlert(),
        enabled: true,
        mode: "manual-experience",
        manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
      },
    });
    const nextProfile = {
      ...staleProfile,
      updatedAt: "2026-05-20T00:00:01.000Z",
    };
    const stream = {} as MediaStream;
    const manualResponse = {
      type: "processed" as const,
      id: 0,
      selectedIndex: 0,
      reading: {
        fingerprint: "hunt-fingerprint",
        recognizedText: "12.345%",
        confidence: 0.9,
        foregroundRatio: 0.1,
      },
      barEstimate: null,
      candidates: [
        {
          label: "manual-experience",
          regionPixels: { x: 0, y: 0, width: 4, height: 4 },
          reading: {
            fingerprint: "hunt-fingerprint",
            recognizedText: "12.345%",
            confidence: 0.9,
            foregroundRatio: 0.1,
          },
          processedImageData: new ImageData(4, 4),
          score: 1,
          performance: {
            totalMs: 0,
            frameReadMs: 0,
            ocrMs: 0,
            previewMs: 0,
          },
          barPercent: null,
          barConfidence: null,
          barCoverage: "unknown" as const,
        },
      ],
      performance: {
        totalMs: 0,
        barEstimateMs: null,
        candidateCount: 1,
        candidateMs: 0,
        selectedCandidateMs: 0,
        selectedFrameReadMs: null,
        selectedOcrMs: 0,
        selectedPreviewMs: null,
        fullFramePreviewMs: null,
      },
    };
    huntStallOcrEngineMock.processCrop
      .mockReturnValueOnce(pendingManualSample)
      .mockResolvedValue(manualResponse);

    const { rerender } = render(
      <MonitoringHarness
        profile={staleProfile}
        stream={stream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(huntStallOcrEngineMock.processCrop).toHaveBeenCalledTimes(1);
    const resetCountAfterFirstSampleStarted = huntStallOcrEngineMock.reset.mock.calls.length;

    rerender(
      <MonitoringHarness
        profile={nextProfile}
        stream={stream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      resolveManualSample(manualResponse);
      await Promise.resolve();
    });

    expect(api.current?.huntStallRuntimeRef.current.lastSampledAt).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(huntStallOcrEngineMock.processCrop).toHaveBeenCalledTimes(2);
    expect(huntStallOcrEngineMock.reset).toHaveBeenCalledTimes(resetCountAfterFirstSampleStarted);
  });

  it("schedules booster expiry playback from the confirmed alert time", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    const profile = createProfile({
      masterVolume: 1,
      boosterExpiryAlert: {
        ...createDefaultBoosterExpiryAlert(),
        enabled: true,
        alertLeadSeconds: 10,
      },
    });
    let boosterStartedAt: number | null = null;
    boosterExpiryWorkerMock.process.mockImplementation(async () => {
      boosterStartedAt ??= Date.now();
      const elapsedSeconds = Math.floor((Date.now() - boosterStartedAt) / 1000);
      const seconds = Math.max(0, 100 - elapsedSeconds);
      return {
        result: createBoosterExpiryWorkerResult(seconds),
        performance: {
          recognitionMs: 0.5,
          totalMs: 1,
        },
      };
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

    for (let index = 0; index < 8; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(index === 0 ? 500 : 1_000);
      });
      if (api.current?.boosterExpiryRuntimeRef.current.status === "armed") {
        break;
      }
    }

    const alertAt = api.current?.boosterExpiryRuntimeRef.current.alertAt;
    expect(api.current?.boosterExpiryRuntimeRef.current.status).toBe("armed");
    expect(alertAt).toEqual(expect.any(Number));
    expect(playAlertMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.max(0, alertAt! - Date.now() - 1));
    });

    expect(playAlertMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(playAlertMock).toHaveBeenCalledTimes(1);
    expect(api.current?.boosterExpiryRuntimeRef.current).toMatchObject({
      status: "alerted",
      alertedAt: Date.now(),
      lastDecision: "alerted",
    });
    const incidentArchive =
      api.current?.boosterExpiryIncidentRecorderRef.current.archive;
    expect(incidentArchive?.cycles).toEqual([
      expect.objectContaining({
        status: "alerted",
        expiresAt:
          api.current?.boosterExpiryRuntimeRef.current.confirmedExpiresAt,
      }),
    ]);
    expect(incidentArchive?.schedules).toEqual([
      expect.objectContaining({
        alertDueAt: alertAt,
        status: "fired",
      }),
    ]);
    expect(incidentArchive?.decisions).toEqual([
      expect.objectContaining({
        occurredAt: alertAt,
        dueAt: alertAt,
      }),
    ]);
    expect(incidentArchive?.playbackAttempts).toEqual([
      expect.objectContaining({
        requestedAt: alertAt,
        status: "browser-play-accepted",
      }),
    ]);
  });

  it("samples booster expiry through the bound monitoring frame context", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    const sampledImageData = createTestImageData(8, 8);
    sampleVideoRegionMock.mockReturnValue({
      imageData: sampledImageData,
      rawPreviewUrl: "data:image/png;base64,booster-bound-frame",
      region: { x: 0, y: 0, width: 1280, height: 180 },
    });

    render(
      <MonitoringHarness
        profile={createProfile({
          boosterExpiryAlert: {
            ...createDefaultBoosterExpiryAlert(),
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

    expect(sampleVideoRegionMock).toHaveBeenCalledTimes(1);
    expect(sampleVideoRegionMock).toHaveBeenCalledWith(
      expect.any(HTMLVideoElement),
      { x: 0, y: 0, width: 1, height: 0.25 },
      true,
      1280,
    );
    expect(boosterExpiryWorkerMock.process).toHaveBeenCalledWith(
      sampledImageData,
      expect.any(Number),
    );
    expect(
      api.current?.boosterExpiryIncidentRecorderRef.current.archive.frames[0],
    ).toMatchObject({
      source: {
        kind: "normal-monitoring-top-quarter",
        coordinateSpace: "capture-pixels",
        sourceDimensions: { width: 1280, height: 720 },
        sampledRegion: { x: 0, y: 0, width: 1280, height: 180 },
        maxCaptureWidth: 1280,
      },
    });
    const incidentArchive =
      api.current?.boosterExpiryIncidentRecorderRef.current.archive;
    expect(incidentArchive?.media[0]).toMatchObject({
      imageDataUrl: "data:image/png;base64,booster-bound-frame",
      frameId: incidentArchive?.frames[0]?.id,
    });
    expect(incidentArchive?.frames[0]?.mediaFrameId).toBe(
      incidentArchive?.media[0]?.id,
    );
  });

  it("records a failed Worker request and starts a new flow before recovery", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    boosterExpiryWorkerMock.process
      .mockRejectedValueOnce(new Error("booster-expiry-worker-timeout"))
      .mockResolvedValue({
        result: createBoosterExpiryWorkerResult(100),
        performance: {
          recognitionMs: 0.5,
          totalMs: 1,
        },
      });

    render(
      <MonitoringHarness
        profile={createProfile({
          boosterExpiryAlert: {
            ...createDefaultBoosterExpiryAlert(),
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

    expect(
      api.current?.boosterExpiryIncidentRecorderRef.current.archive.frames[0]
        ?.runtimeFailure,
    ).toMatchObject({
      stage: "worker-timeout",
      code: "worker-timeout",
    });
    expect(
      api.current?.boosterExpiryIncidentRecorderRef.current.pendingFlowRestart,
    ).toMatchObject({ reason: "worker-timeout" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    const recorder = api.current?.boosterExpiryIncidentRecorderRef.current;
    expect(recorder?.pendingFlowRestart).toBeNull();
    expect(recorder?.archive.flowEpochs).toHaveLength(2);
    expect(recorder?.archive.flowEpochs[recorder.archive.flowEpochs.length - 1]).toMatchObject({
      reason: "worker-timeout",
    });
    expect(
      recorder?.archive.observations[recorder.archive.observations.length - 1],
    ).toMatchObject({
      decision: "accepted",
      selectedTime: expect.objectContaining({ seconds: 100 }),
    });
  });

  it("does not replay booster expiry when an in-flight sample resolves after the scheduled alert", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    const profile = createProfile({
      masterVolume: 1,
      boosterExpiryAlert: {
        ...createDefaultBoosterExpiryAlert(),
        enabled: true,
        alertLeadSeconds: 10,
      },
    });
    let boosterStartedAt: number | null = null;
    boosterExpiryWorkerMock.process.mockImplementation(async () => {
      boosterStartedAt ??= Date.now();
      const elapsedSeconds = Math.floor((Date.now() - boosterStartedAt) / 1000);
      const seconds = Math.max(0, 100 - elapsedSeconds);
      return {
        result: createBoosterExpiryWorkerResult(seconds),
        performance: {
          recognitionMs: 0.5,
          totalMs: 1,
        },
      };
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

    for (let index = 0; index < 8; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(index === 0 ? 500 : 1_000);
      });
      if (api.current?.boosterExpiryRuntimeRef.current.status === "armed") {
        break;
      }
    }

    const alertAt = api.current?.boosterExpiryRuntimeRef.current.alertAt;
    const confirmedExpiresAt = api.current?.boosterExpiryRuntimeRef.current.confirmedExpiresAt;
    expect(api.current?.boosterExpiryRuntimeRef.current.status).toBe("armed");
    expect(alertAt).toEqual(expect.any(Number));
    expect(confirmedExpiresAt).toEqual(expect.any(Number));
    expect(playAlertMock).not.toHaveBeenCalled();

    let resolvePendingSample:
      | ((response: Awaited<ReturnType<typeof boosterExpiryWorkerMock.process>>) => void)
      | null = null;
    let pendingSampledAt: number | null = null;
    boosterExpiryWorkerMock.process.mockImplementation(
      (_imageData: ImageData, timestampMs: number) =>
        new Promise((resolve) => {
          pendingSampledAt = timestampMs;
          resolvePendingSample = resolve;
        }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(resolvePendingSample).not.toBeNull();
    expect(pendingSampledAt).toEqual(expect.any(Number));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.max(0, alertAt! - Date.now()));
    });

    expect(playAlertMock).toHaveBeenCalledTimes(1);
    expect(api.current?.boosterExpiryRuntimeRef.current).toMatchObject({
      status: "alerted",
      alertedAt: Date.now(),
      lastDecision: "alerted",
    });

    await act(async () => {
      resolvePendingSample?.({
        result: createBoosterExpiryWorkerResult(
          Math.max(0, Math.round((confirmedExpiresAt! - pendingSampledAt!) / 1000)),
        ),
        performance: {
          recognitionMs: 0.5,
          totalMs: 1,
        },
      });
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(playAlertMock).toHaveBeenCalledTimes(1);
    expect(api.current?.boosterExpiryRuntimeRef.current).toMatchObject({
      status: "alerted",
      alertedAt: alertAt,
      lastDecision: "alerted",
    });
  });

  it("keeps recent booster expiry diagnostics after the feature is disabled", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    const stream = {} as MediaStream;
    const enabledProfile = createProfile({
      boosterExpiryAlert: {
        ...createDefaultBoosterExpiryAlert(),
        enabled: true,
        alertLeadSeconds: 10,
      },
    });
    const disabledProfile = createProfile({
      boosterExpiryAlert: {
        ...createDefaultBoosterExpiryAlert(),
        enabled: false,
        alertLeadSeconds: 10,
      },
    });
    boosterExpiryWorkerMock.process.mockResolvedValue({
      result: createBoosterExpiryWorkerResult(100),
      performance: {
        recognitionMs: 0.5,
        totalMs: 1,
      },
    });

    const { rerender } = render(
      <MonitoringHarness
        profile={enabledProfile}
        stream={stream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(api.current?.boosterExpirySnapshotRef.current).toMatchObject({
      rawPreviewUrl: "data:image/png;base64,booster-top",
      timerPreviewUrl: "data:image/png;base64,booster-timer",
      timerEvidence: [],
      confirmationEvidence: [],
    });

    rerender(
      <MonitoringHarness
        profile={disabledProfile}
        stream={stream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(api.current?.boosterExpiryRuntimeRef.current).toMatchObject({
      status: "paused",
      lastDecision: "disabled",
    });
    expect(api.current?.boosterExpirySnapshotRef.current).toMatchObject({
      rawPreviewUrl: "data:image/png;base64,booster-top",
      timerPreviewUrl: "data:image/png;base64,booster-timer",
      runtimeTrace: expect.arrayContaining([
        expect.objectContaining({
          decision: "disabled",
          status: "paused",
        }),
      ]),
      timerEvidence: [],
      confirmationEvidence: [],
    });
  });

  it("does not republish unchanged disabled hunt stall and booster expiry states", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    const profile = createProfile({
      huntStallAlert: {
        ...createDefaultHuntStallAlert(),
        enabled: false,
      },
      boosterExpiryAlert: {
        ...createDefaultBoosterExpiryAlert(),
        enabled: false,
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
      await vi.advanceTimersByTimeAsync(3_500);
    });

    expect(api.current?.setHuntStallRuntime).toHaveBeenCalledTimes(1);
    expect(api.current?.setHuntStallSnapshot).toHaveBeenCalledTimes(1);
    expect(api.current?.setHuntStallSnapshot).toHaveBeenLastCalledWith(null);
    expect(api.current?.setBoosterExpiryRuntime).toHaveBeenCalledTimes(1);
    expect(api.current?.setBoosterExpirySnapshot).toHaveBeenCalledTimes(1);
    expect(api.current?.boosterExpiryRuntimeRef.current).toMatchObject({
      status: "paused",
      lastDecision: "disabled",
    });
  });
});
