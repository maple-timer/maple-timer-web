import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuneSnapshot } from "../../../alertTypes";
import { createDefaultProfile } from "../../../lib/profileFactory";
import { createRuneRuntimeState } from "../../../lib/runeAlert";
import { createDefaultRuneAlert } from "../../../lib/storage";
import { RuneDetectionWorkerClientError } from "../../../platform/runtime-workers/rune/runeDetectionWorkerClient";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import {
  createRuneFramePreviewState,
  processRuneFrameSample,
} from "./runeFrameProcessor";

const imageDataMock = vi.hoisted(() => ({
  cropRuneCandidateToImageData: vi.fn(),
  cropRuneCandidateToUrl: vi.fn(),
  imageDataToUrl: vi.fn(),
}));
const runeDetectionMock = vi.hoisted(() => ({
  createRuneMaskPreview: vi.fn(),
  detect: vi.fn(),
}));

vi.mock("../../../lib/imageData", () => ({
  cropRuneCandidateToImageData: imageDataMock.cropRuneCandidateToImageData,
  cropRuneCandidateToUrl: imageDataMock.cropRuneCandidateToUrl,
  imageDataToUrl: imageDataMock.imageDataToUrl,
}));

vi.mock("../../../lib/runeDetection", () => ({
  createRuneMaskPreview: runeDetectionMock.createRuneMaskPreview,
}));

describe("processRuneFrameSample", () => {
  beforeEach(() => {
    imageDataMock.cropRuneCandidateToUrl.mockReset();
    imageDataMock.cropRuneCandidateToImageData.mockReset();
    imageDataMock.imageDataToUrl.mockReset();
    imageDataMock.imageDataToUrl.mockReturnValue("mask-preview");
    runeDetectionMock.createRuneMaskPreview.mockReset();
    runeDetectionMock.createRuneMaskPreview.mockReturnValue(createImageData());
    runeDetectionMock.detect.mockReset();
  });

  it("marks enabled rune alerts without a region as no-region without sampling", async () => {
    const context = createContext();
    const previousState = createRuneRuntimeState();
    const result = await processRuneFrameSample({
      context,
      previewState: createRuneFramePreviewState(),
      profile: {
        ...createDefaultProfile(),
        runeAlert: {
          ...createDefaultRuneAlert(),
          enabled: true,
          region: null,
        },
      },
      previousState,
      previousSnapshot: null,
      showDebugColumns: false,
      detector: { detect: runeDetectionMock.detect },
    });

    expect(context.sampleVideoRegion).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      state: {
        status: "no-region",
        confidence: 0,
        candidateCount: 0,
      },
      snapshot: null,
      shouldAlert: false,
      errorMessage: null,
    });
  });

  it("preserves the previous alerted candidate preview until a new alert is fired", async () => {
    const context = createContext();
    const previousState = createRuneRuntimeState();
    const previousSnapshot = createPreviousSnapshot();
    runeDetectionMock.detect.mockResolvedValue({
      detected: true,
      confidence: 0.8,
      candidates: [
        {
          x: 5,
          y: 6,
          width: 12,
          height: 14,
          pixelCount: 40,
          confidence: 0.8,
        },
      ],
      debug: {
        purplePixelRatio: 0.1,
        componentCount: 1,
      },
    });
    imageDataMock.cropRuneCandidateToUrl.mockReturnValue(null);
    imageDataMock.cropRuneCandidateToImageData.mockReturnValue(null);

    const result = await processRuneFrameSample({
      context,
      previewState: createRuneFramePreviewState(),
      profile: createProfileWithRegion(),
      previousState,
      previousSnapshot,
      showDebugColumns: false,
      detector: { detect: runeDetectionMock.detect },
    });

    expect(result.shouldAlert).toBe(false);
    expect(result.snapshot).toMatchObject({
      rawPreviewUrl: "rune-raw",
      maskPreviewUrl: null,
      candidatePreviewUrl: "previous-candidate",
      candidateRawPreviewUrl: "previous-raw",
      candidateMaskPreviewUrl: "previous-mask",
      candidateRegionLabel: "18x20",
      candidateSampledAt: 700,
      candidate: previousSnapshot.candidate,
      detected: true,
      confidence: 0.8,
      candidateCount: 1,
    });
    expect(imageDataMock.cropRuneCandidateToUrl).not.toHaveBeenCalled();
  });

  it("stores alerted candidate previews when a stable detection becomes an alert", async () => {
    const context = createContext({ sampledAt: 4_000 });
    const previousState = {
      ...createRuneRuntimeState(),
      status: "candidate" as const,
      stableCount: 3,
      firstDetectedAt: 1_000,
      lastDetectedAt: 3_000,
    };
    runeDetectionMock.detect.mockResolvedValue({
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
        classifier: "rune-v13",
      },
    });
    imageDataMock.cropRuneCandidateToUrl.mockReturnValue("new-candidate");
    imageDataMock.cropRuneCandidateToImageData.mockReturnValue(createImageData());

    const previousSnapshot = createPreviousSnapshot();
    previousSnapshot.pendingAlertTriggerFrames = [
      createTriggerFrame(1_000, 1, false),
      createTriggerFrame(2_000, 2, false),
      createTriggerFrame(3_000, 3, false),
    ];
    const result = await processRuneFrameSample({
      context,
      previewState: createRuneFramePreviewState(),
      profile: createProfileWithRegion(),
      previousState,
      previousSnapshot,
      showDebugColumns: true,
      detector: { detect: runeDetectionMock.detect },
    });

    expect(result.shouldAlert).toBe(true);
    expect(result.state.detectorVersion).toBe("rune-v13");
    expect(result.alertCycleStartedAt).toBe(4_000);
    expect(result.alertPlaybackId).toBe("0:4000:initial");
    expect(result.state.lastAlertPlayback).toMatchObject({
      status: "requested",
      cycleId: "0:4000:initial",
      soundId: "떳어요 룬 떳어요",
      alertVolume: 1,
      masterVolume: 1,
      effectiveVolume: 1,
    });
    expect(result.snapshot).toMatchObject({
      rawPreviewUrl: "rune-raw",
      detectorVersion: "rune-v13",
      maskPreviewUrl: "mask-preview",
      candidatePreviewUrl: "new-candidate",
      candidateRawPreviewUrl: "rune-raw",
      candidateMaskPreviewUrl: "mask-preview",
      candidateRegionLabel: "18x20",
      candidateSampledAt: 4_000,
      candidate: {
        x: 7,
        y: 9,
        width: 18,
        height: 20,
        confidence: 0.91,
      },
      detected: true,
      confidence: 0.91,
      candidateCount: 1,
      lastAlertTrigger: {
        schemaVersion: "rune-alert-trigger-v1",
        cycleId: "0:4000:initial",
        episodeId: "rune-episode:0:1000",
        decision: "initial",
        triggeredAt: 4_000,
        detectorVersion: "rune-v13",
        frames: [
          { sampledAt: 1_000, stableCount: 1, shouldAlert: false },
          { sampledAt: 2_000, stableCount: 2, shouldAlert: false },
          { sampledAt: 3_000, stableCount: 3, shouldAlert: false },
          {
            sampledAt: 4_000,
            detectorVersion: "rune-v13",
            stableCount: 4,
            stableDurationMs: 3_000,
            confirmationSatisfied: true,
            shouldAlert: true,
            reason: "initial-alert",
            rawDataUrl: "rune-raw",
          },
        ],
      },
      evidenceArchive: {
        policy: "rune-recent-evidence-v2",
        alertTriggers: [
          {
            cycleId: "0:4000:initial",
            episodeId: "rune-episode:0:1000",
          },
        ],
      },
    });
  });

  it("keeps previous candidate evidence when sampling fails", async () => {
    const context = createContext();
    context.sampleVideoRegion.mockImplementation(() => {
      throw new Error("canvas-context-unavailable");
    });
    const previousSnapshot = createPreviousSnapshot();

    const result = await processRuneFrameSample({
      context,
      previewState: createRuneFramePreviewState(),
      profile: createProfileWithRegion(),
      previousState: createRuneRuntimeState(),
      previousSnapshot,
      showDebugColumns: false,
      detector: { detect: runeDetectionMock.detect },
    });

    expect(result).toMatchObject({
      state: {
        status: "waiting",
        confidence: 0,
        candidateCount: 0,
      },
      snapshot: {
        rawPreviewUrl: null,
        maskPreviewUrl: null,
        candidatePreviewUrl: "previous-candidate",
        candidateRawPreviewUrl: "previous-raw",
        candidateMaskPreviewUrl: "previous-mask",
        candidateRegionLabel: "18x20",
        candidateSampledAt: 700,
        candidate: previousSnapshot.candidate,
        detected: false,
        confidence: 0,
        candidateCount: 0,
      },
      shouldAlert: false,
      errorMessage: "룬 감지용 캔버스를 준비하지 못했습니다.",
      detectorOutcome: "frame-error",
    });
  });

  it("does not re-encode trigger frames after the current rune already alerted", async () => {
    const context = createContext({ sampledAt: 5_000 });
    const previousState = {
      ...createRuneRuntimeState(),
      status: "alerted" as const,
      stableCount: 4,
      firstDetectedAt: 1_000,
      lastDetectedAt: 4_000,
      alertedAt: 4_000,
      alertedSceneEpoch: 0,
      alertedCandidate: { x: 7, y: 9, width: 18, height: 20 },
    };
    const previousSnapshot = createPreviousSnapshot();
    previousSnapshot.pendingAlertTriggerFrames = [
      createTriggerFrame(1_000, 1, false),
      createTriggerFrame(2_000, 2, false),
      createTriggerFrame(3_000, 3, false),
      createTriggerFrame(4_000, 4, true),
    ];
    previousSnapshot.lastAlertTrigger = {
      schemaVersion: "rune-alert-trigger-v1",
      cycleId: "0:4000:initial",
      decision: "initial",
      triggeredAt: 4_000,
      detectorVersion: "rune-v13",
      sceneEpoch: 0,
      frames: previousSnapshot.pendingAlertTriggerFrames,
    };
    runeDetectionMock.detect.mockResolvedValue({
      detected: true,
      confidence: 0.92,
      candidates: [
        {
          x: 7,
          y: 9,
          width: 18,
          height: 20,
          pixelCount: 64,
          confidence: 0.92,
        },
      ],
      debug: { classifier: "rune-v13" },
    });

    const result = await processRuneFrameSample({
      context,
      previewState: {
        ...createRuneFramePreviewState(),
        lastPreviewAt: 5_000,
        rawPreviewUrl: "existing-live-raw",
      },
      profile: createProfileWithRegion(),
      previousState,
      previousSnapshot,
      showDebugColumns: false,
      detector: { detect: runeDetectionMock.detect },
    });

    expect(result.shouldAlert).toBe(false);
    expect(result.snapshot?.lastAlertTrigger).toBe(previousSnapshot.lastAlertTrigger);
    expect(result.snapshot?.pendingAlertTriggerFrames).toBe(
      previousSnapshot.pendingAlertTriggerFrames,
    );
    expect(imageDataMock.imageDataToUrl).not.toHaveBeenCalled();
  });

  it("records worker failures separately without resetting prior detection evidence", async () => {
    const context = createContext({ sampledAt: 2_000 });
    const previousState = {
      ...createRuneRuntimeState(),
      status: "candidate" as const,
      stableCount: 2,
      firstDetectedAt: 1_000,
      lastDetectedAt: 1_500,
    };
    const previousSnapshot = createPreviousSnapshot();
    runeDetectionMock.detect.mockRejectedValue(
      new RuneDetectionWorkerClientError(
        "rune-detection-worker-runtime-failed",
        "worker-runtime",
        "Failed to load worker module",
      ),
    );

    const result = await processRuneFrameSample({
      context,
      previewState: createRuneFramePreviewState(),
      profile: createProfileWithRegion(),
      previousState,
      previousSnapshot,
      showDebugColumns: false,
      detectorRetryCount: 2,
      detector: { detect: runeDetectionMock.detect },
    });

    expect(result).toMatchObject({
      state: {
        status: "unavailable",
        stableCount: 2,
        firstDetectedAt: 1_000,
        lastDetectedAt: 1_500,
        lastDecisionReason: "detector-error",
        lastDetectionError: {
          code: "rune-detection-worker-runtime-failed",
          phase: "worker-runtime",
          message: "Failed to load worker module",
          occurredAt: 2_000,
          retryCount: 2,
        },
      },
      snapshot: {
        detectionError: {
          code: "rune-detection-worker-runtime-failed",
          retryCount: 2,
        },
        candidatePreviewUrl: "previous-candidate",
        detected: false,
      },
      detectorOutcome: "error",
      shouldAlert: false,
    });
    const recentSamples = result.state.recentSamples ?? [];
    expect(recentSamples[recentSamples.length - 1]).toMatchObject({
      outcome: "error",
      reason: "detector-error",
      stableCount: 2,
      error: {
        phase: "worker-runtime",
      },
    });
  });
});

function createContext({ sampledAt = 1_000 }: { sampledAt?: number } = {}) {
  return {
    sampledAt,
    video: {} as HTMLVideoElement,
    frameLayoutKey: "1280x720",
    masterVolume: 100,
    sampleSkill: vi.fn(),
    sampleVideoRegion: vi.fn(() => ({
      imageData: createImageData(),
      rawPreviewUrl: "rune-raw",
      region: { x: 0, y: 0, width: 200, height: 120 },
    })),
  } as unknown as MonitoringFrameContext & {
    sampleVideoRegion: ReturnType<typeof vi.fn>;
  };
}

function createProfileWithRegion() {
  return {
    ...createDefaultProfile(),
    runeAlert: {
      ...createDefaultRuneAlert(),
      enabled: true,
      region: { x: 0.02, y: 0.03, width: 0.2, height: 0.18 },
    },
  };
}

function createPreviousSnapshot(): RuneSnapshot {
  return {
    sampledAt: 700,
    rawPreviewUrl: "previous-live-raw",
    maskPreviewUrl: "previous-live-mask",
    candidatePreviewUrl: "previous-candidate",
    candidateRawPreviewUrl: "previous-raw",
    candidateMaskPreviewUrl: "previous-mask",
    candidateRegionLabel: "18x20",
    candidateSampledAt: 700,
    candidate: {
      x: 1,
      y: 2,
      width: 18,
      height: 20,
      confidence: 0.9,
    },
    detected: true,
    confidence: 0.9,
    candidateCount: 1,
  };
}

function createImageData(): ImageData {
  return new ImageData(new Uint8ClampedArray(4 * 4 * 4), 4, 4);
}

function createTriggerFrame(
  sampledAt: number,
  stableCount: number,
  shouldAlert: boolean,
): NonNullable<RuneSnapshot["pendingAlertTriggerFrames"]>[number] {
  return {
    sampledAt,
    detectorVersion: "rune-v13",
    detectionDebug: null,
    rawDataUrl: `trigger-${sampledAt}`,
    detected: true,
    confidence: 0.9,
    candidateCount: 1,
    candidate: {
      x: 7,
      y: 9,
      width: 18,
      height: 20,
      confidence: 0.9,
    },
    status: "candidate",
    stableCount,
    firstDetectedAt: 1_100,
    stableDurationMs: sampledAt - 1_100,
    confirmationSatisfied: shouldAlert,
    confirmationSatisfiedBy: shouldAlert ? "frames-and-duration" : null,
    shouldAlert,
    reason: shouldAlert ? "initial-alert" : "stabilizing",
    sceneEpoch: 0,
  };
}
