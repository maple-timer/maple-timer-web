import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultHuntStallAlert } from "../../../lib/storage";
import {
  MonitoringHarness,
  cleanupMonitoringLoopTestHarness,
  createProfile,
  huntStallOcrEngineMock,
  playAlertUntilEndedMock,
  resetMonitoringLoopTestMocks,
  type HarnessApi,
} from "./useMonitoringLoopTestHarness";

function createManualExperienceResponse(recognizedText: string, fingerprint: string) {
  const reading = {
    fingerprint,
    recognizedText,
    confidence: 0.9,
    foregroundRatio: 0.1,
  };

  return {
    type: "processed" as const,
    id: 0,
    selectedIndex: 0,
    reading,
    barEstimate: null,
    candidates: [
      {
        label: "manual-experience",
        regionPixels: { x: 0, y: 0, width: 4, height: 4 },
        reading,
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
}

describe("useMonitoringLoop hunt stall repeats", () => {
  beforeEach(() => {
    resetMonitoringLoopTestMocks();
  });

  afterEach(() => {
    cleanupMonitoringLoopTestHarness();
  });

  it("waits for playback completion and the configured interval before another repeat", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    let sampleCount = 0;
    huntStallOcrEngineMock.processCrop.mockImplementation(() => {
      sampleCount += 1;
      return Promise.resolve(
        sampleCount === 1
          ? createManualExperienceResponse("10.000%", "baseline")
          : createManualExperienceResponse("10.001%", "progress"),
      );
    });

    let finishInitialPlayback!: () => void;
    let finishFirstRepeat!: () => void;
    const initialPlayback = new Promise<void>((resolve) => {
      finishInitialPlayback = resolve;
    });
    const firstRepeatPlayback = new Promise<void>((resolve) => {
      finishFirstRepeat = resolve;
    });
    playAlertUntilEndedMock
      .mockImplementationOnce((_soundId, _volume, options) => {
        options?.onStarted?.();
        return initialPlayback;
      })
      .mockImplementationOnce((_soundId, _volume, options) => {
        options?.onStarted?.();
        return firstRepeatPlayback;
      })
      .mockImplementation((_soundId, _volume, options) => {
        options?.onStarted?.();
        return Promise.resolve();
      });

    const profile = createProfile({
      huntStallAlert: {
        ...createDefaultHuntStallAlert(),
        enabled: true,
        mode: "manual-experience",
        manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
        stallThresholdSeconds: 5,
        repeatAlertEnabled: true,
        repeatAlertIntervalSeconds: 5,
        repeatAlertMaxCount: null,
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
      await vi.advanceTimersByTimeAsync(7_000);
    });
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
    expect(api.current?.huntStallRuntimeRef.current).toMatchObject({
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 0,
      lastAlertPlayback: { status: "started" },
    });
    const initialArchive = api.current?.huntStallIncidentRecorderRef.current.archive;
    expect(initialArchive?.decisions).toHaveLength(1);
    expect(initialArchive?.decisions[0]).toMatchObject({ kind: "initial" });
    expect(initialArchive?.playbackAttempts[0]).toMatchObject({
      decisionId: initialArchive?.decisions[0]?.id,
      cycleId: initialArchive?.decisions[0]?.cycleId,
      status: "started",
    });

    await act(async () => {
      finishInitialPlayback();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(2);
    expect(api.current?.huntStallRuntimeRef.current).toMatchObject({
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 1,
      lastAlertPlayback: { status: "started" },
    });
    const repeatArchive = api.current?.huntStallIncidentRecorderRef.current.archive;
    expect(repeatArchive?.decisions).toHaveLength(2);
    expect(repeatArchive?.decisions[1]).toMatchObject({
      kind: "repeat",
      cycleId: repeatArchive?.decisions[0]?.cycleId,
    });
    expect(repeatArchive?.playbackAttempts[1]).toMatchObject({
      decisionId: repeatArchive?.decisions[1]?.id,
      status: "started",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(2);
    expect(api.current?.huntStallRuntimeRef.current.repeatedAlertCount).toBe(1);

    await act(async () => {
      finishFirstRepeat();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(2);
    expect(api.current?.huntStallRuntimeRef.current).toMatchObject({
      repeatedAlertCount: 1,
      lastAlertPlayback: { status: "finished" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(3);
  });
});
