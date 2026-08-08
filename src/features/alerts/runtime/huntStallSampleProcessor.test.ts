import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HuntStallSnapshot } from "../../../alertTypes";
import { sampleSkill } from "../../../lib/capture";
import { createHuntStallRuntimeState } from "../../../lib/huntStall";
import type { HuntStallCooldownWorkerClient } from "../../../platform/runtime-workers/hunt-stall-cooldown/huntStallCooldownWorkerClient";
import type { HuntStallOcrEngine } from "../../../lib/huntStallOcrEngine";
import { createDefaultHuntStallAlert } from "../../../lib/storage";
import { createMonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import type { HuntStallAlertConfig } from "../../../types";
import {
  createHuntStallSampleProcessorPreviewState,
  processHuntStallActiveSample,
  processHuntStallSampleError,
  processHuntStallUnavailableSample,
} from "./huntStallSampleProcessor";
import { shouldIncludeHuntStallPreview } from "./huntStallSampleProcessorShared";

const manualExperienceCaptureMock = vi.hoisted(() => vi.fn());
const imageDataToUrlMock = vi.hoisted(() =>
  vi.fn((imageData: ImageData) => {
    if (imageData.data.byteLength === 0) {
      throw new Error("detached-image-data");
    }
    return `data:image/png;base64,${imageData.width}x${imageData.height}`;
  }),
);

vi.mock("../../../lib/imageData", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/imageData")>(
    "../../../lib/imageData",
  );
  return {
    ...actual,
    imageDataToUrl: imageDataToUrlMock,
  };
});

vi.mock("../../../lib/capture", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/capture")>(
    "../../../lib/capture",
  );
  return {
    ...actual,
    sampleSkill: vi.fn(),
  };
});

vi.mock("../../../lib/huntStallManualExperienceSampling", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/huntStallManualExperienceSampling")>(
    "../../../lib/huntStallManualExperienceSampling",
  );
  return {
    ...actual,
    captureManualExperienceCropFromVideo: manualExperienceCaptureMock,
  };
});

const sampleSkillMock = vi.mocked(sampleSkill);

describe("huntStallSampleProcessor", () => {
  beforeEach(() => {
    sampleSkillMock.mockReset();
    manualExperienceCaptureMock.mockReset();
    imageDataToUrlMock.mockClear();
    manualExperienceCaptureMock.mockReturnValue({
      imageData: createImageData(),
      frameReadMs: 0.7,
      fullFramePreviewMs: null,
      fullFramePreviewUrl: null,
      rawPreviewUrl: "manual-raw",
      regionLabel: "manual-region",
      regionPixels: { x: 422, y: 691, width: 435, height: 7 },
    });
    vi.spyOn(performance, "now").mockReturnValueOnce(10).mockReturnValue(18.4);
  });

  it("marks unavailable hunt stall samples without touching preview or history refs", () => {
    const previewState = createHuntStallSampleProcessorPreviewState();
    const result = processHuntStallUnavailableSample({
      config: createConfig({ enabled: true }),
      previousState: createHuntStallRuntimeState(),
      previewState,
      runtimeTrace: [],
      cropHistory: [],
      sampledAt: 1_000,
      hasStream: false,
    });

    expect(result).toMatchObject({
      state: {
        status: "no-stream",
        lastDecision: "no-stream",
      },
      snapshot: null,
      shouldAlert: false,
      shouldResetOcrState: false,
      previewState,
      runtimeTrace: [],
      cropHistory: [],
      errorMessage: null,
    });
    expect(sampleSkillMock).not.toHaveBeenCalled();
  });

  it("keeps manual experience crop previews alive without requiring debug mode", () => {
    expect(
      shouldIncludeHuntStallPreview({
        previousPreviewAt: 1_000,
        requiresPreview: true,
        sampledAt: 3_100,
        showDebugColumns: false,
      }),
    ).toBe(true);
    expect(
      shouldIncludeHuntStallPreview({
        previousPreviewAt: 1_000,
        requiresPreview: true,
        sampledAt: 2_000,
        showDebugColumns: false,
      }),
    ).toBe(false);
    expect(
      shouldIncludeHuntStallPreview({
        previousPreviewAt: 1_000,
        sampledAt: 3_100,
        showDebugColumns: false,
      }),
    ).toBe(false);
  });

  it("processes manual experience crops through the hunt stall OCR worker", async () => {
    const ocrEngine = createOcrEngine({
      detachCandidateImageData: true,
      workerReading: {
        fingerprint: "manual-fingerprint",
        recognizedText: "manual-baseline",
        debugText: "manual-worker",
        confidence: 0.87,
        foregroundRatio: 0.19,
      },
    });
    const result = await processHuntStallActiveSample({
      config: createConfig({
        mode: "manual-experience",
        manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
      }),
      cooldownWorker: createCooldownWorker(),
      cropHistory: [],
      ocrEngine,
      previousState: createHuntStallRuntimeState(),
      previewState: createHuntStallSampleProcessorPreviewState(),
      runtimeTrace: [],
      sampledAt: 3_100,
      showDebugColumns: false,
      context: createFrameContext(),
    });

    expect(ocrEngine.processCrop).toHaveBeenCalledWith(
      expect.objectContaining({
        applyStreamingCorrection: false,
        barStrips: [],
        candidates: [
          expect.objectContaining({
            label: "manual-experience",
          }),
        ],
        includePreview: true,
        sourceHeight: 720,
        sourceWidth: 1280,
      }),
    );
    expect(result.snapshot).toMatchObject({
      mode: "manual-experience",
      rawPreviewUrl: "manual-raw",
      rawPreviewImageData: expect.objectContaining({ width: 4, height: 4 }),
      recognizedText: "manual-baseline",
      debugText: expect.stringContaining("manual-worker"),
      performance: expect.objectContaining({
        selectedFrameReadMs: expect.any(Number),
        selectedOcrMs: 1.5,
      }),
    });
  });

  it("samples manual experience inside the calibrated game viewport", async () => {
    const video = {
      videoWidth: 1766,
      videoHeight: 968,
    } as HTMLVideoElement;
    const gameRegion = { x: 0.3, y: 0.95, width: 0.4, height: 0.02 };
    const context = createMonitoringFrameContext({
      masterVolume: 100,
      sampledAt: 3_200,
      video,
      gameViewport: {
        mode: "calibrated",
        sourceSize: { width: 1766, height: 968 },
        gameResolution: { width: 1366, height: 768 },
        region: { x: 200, y: 100, width: 1366, height: 768 },
        layoutKey: "game:1366x768",
        revision: 2,
      },
    });
    const ocrEngine = createOcrEngine();

    const result = await processHuntStallActiveSample({
      config: createConfig({
        mode: "manual-experience",
        manualExperienceRegion: null,
        manualExperienceRegionsByLayout: {
          "game:1366x768": gameRegion,
        },
      }),
      cooldownWorker: createCooldownWorker(),
      cropHistory: [],
      ocrEngine,
      previousState: createHuntStallRuntimeState(),
      previewState: createHuntStallSampleProcessorPreviewState(),
      runtimeTrace: [],
      sampledAt: 3_200,
      showDebugColumns: false,
      context,
    });

    expect(manualExperienceCaptureMock).toHaveBeenCalledWith({
      video,
      region: gameRegion,
      includePreview: true,
      sourceRegion: { x: 200, y: 100, width: 1366, height: 768 },
    });
    expect(ocrEngine.processCrop).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceWidth: 1366,
        sourceHeight: 768,
      }),
    );
    expect(result.incidentEvidence).toMatchObject({
      layoutKey: "game:1366x768",
      sourceDimensions: { width: 1366, height: 768 },
    });
  });

  it("keeps the previous preview urls for manual experience samples when preview is throttled", async () => {
    const ocrEngine = createOcrEngine({
      snapshot: createManualExperienceSnapshot(),
    });
    const result = await processHuntStallActiveSample({
      config: createConfig({
        mode: "manual-experience",
        manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
      }),
      cooldownWorker: createCooldownWorker(),
      cropHistory: [],
      ocrEngine,
      previousState: createHuntStallRuntimeState(),
      previewState: {
        lastPreviewAt: 1_000,
        urls: {
          displayPreviewUrl: "previous-display",
          rawPreviewUrl: "previous-raw",
          processedPreviewUrl: "previous-processed",
        },
      },
      runtimeTrace: [],
      sampledAt: 1_500,
      showDebugColumns: false,
      context: createFrameContext(),
    });

    expect(ocrEngine.processCrop).toHaveBeenCalledWith(
      expect.objectContaining({
        includePreview: false,
        candidates: [
          expect.objectContaining({
            label: "manual-experience",
          }),
        ],
      }),
    );
    expect(result.snapshot).toMatchObject({
      displayPreviewUrl: "previous-display",
      rawPreviewUrl: "previous-raw",
      processedPreviewUrl: "previous-processed",
      sampledAt: 1_500,
      mode: "manual-experience",
      debugText: expect.stringMatching(/^ocr \| ocrMs=\d+\.\d$/),
      runtimeTrace: [
        expect.objectContaining({
          mode: "manual-experience",
          snapshotRecognizedText: "1,000 [1.000%]",
        }),
      ],
      cropHistory: [
        expect.objectContaining({
          mode: "manual-experience",
          rawDataUrl: "manual-raw",
          processedDataUrl: "manual-raw",
          recognizedText: "1,000 [1.000%]",
          stateBefore: expect.objectContaining({ status: "paused" }),
          stateAfter: expect.objectContaining({ status: "watching" }),
        }),
      ],
    });
    expect(result.previewState).toEqual({
      lastPreviewAt: 1_000,
      urls: {
        displayPreviewUrl: "previous-display",
        rawPreviewUrl: "previous-raw",
        processedPreviewUrl: "previous-processed",
      },
    });
  });

  it("retains the current manual experience crop when the worker detaches a non-preview input", async () => {
    const sourceImageData = createImageData();
    manualExperienceCaptureMock.mockReturnValue({
      imageData: sourceImageData,
      displayPreviewImageData: null,
      frameReadMs: 0.7,
      fullFramePreviewMs: null,
      fullFramePreviewUrl: null,
      rawPreviewUrl: null,
      displayPreviewUrl: null,
      regionLabel: "manual-region",
      regionPixels: { x: 422, y: 691, width: 435, height: 7 },
    });

    const result = await processHuntStallActiveSample({
      config: createConfig({
        mode: "manual-experience",
        manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
      }),
      cooldownWorker: createCooldownWorker(),
      cropHistory: [],
      ocrEngine: createOcrEngine({ detachCandidateImageData: true }),
      previousState: createHuntStallRuntimeState(),
      previewState: {
        lastPreviewAt: 1_000,
        urls: {
          displayPreviewUrl: "previous-display",
          rawPreviewUrl: "previous-raw",
          processedPreviewUrl: "previous-processed",
        },
      },
      runtimeTrace: [],
      sampledAt: 1_500,
      showDebugColumns: false,
      context: createFrameContext(),
    });

    expect(sourceImageData.data.byteLength).toBe(4 * 4 * 4);
    expect(imageDataToUrlMock).toHaveBeenCalledWith(sourceImageData);
    expect(result).toMatchObject({
      state: { status: "watching", lastDecision: "stable" },
      cropHistory: [
        expect.objectContaining({
          rawDataUrl: "data:image/png;base64,4x4",
          processedDataUrl: "data:image/png;base64,4x4",
        }),
      ],
      incidentEvidence: {
        media: {
          rawDataUrl: "data:image/png;base64,4x4",
          processedDataUrl: "data:image/png;base64,4x4",
        },
      },
    });
  });

  it("does not sample cooldown crops until a cooldown region exists", async () => {
    const worker = createCooldownWorker();
    const result = await processHuntStallActiveSample({
      config: createCooldownConfig({ cooldownRegion: null }),
      cooldownWorker: worker,
      cropHistory: [],
      ocrEngine: createOcrEngine(),
      previousState: createHuntStallRuntimeState(),
      previewState: createHuntStallSampleProcessorPreviewState(),
      runtimeTrace: [],
      sampledAt: 2_000,
      showDebugColumns: true,
      context: createFrameContext(),
    });

    expect(sampleSkillMock).not.toHaveBeenCalled();
    expect(worker.process).not.toHaveBeenCalled();
    expect(result.state).toMatchObject({
      status: "no-region",
      lastDecision: "cooldown-no-region",
    });
    expect(result.snapshot).toBeNull();
    expect(result.runtimeTrace).toEqual([
      expect.objectContaining({
        mode: "cooldown-presence",
        status: "no-region",
        snapshotRecognizedText: null,
      }),
    ]);
  });

  it("builds cooldown snapshots, trace, and crop history from worker results", async () => {
    sampleSkillMock.mockReturnValue({
      imageData: createImageData(),
      rawPreviewUrl: "cooldown-raw",
      previewUrl: "cooldown-processed",
      region: { x: 10, y: 20, width: 32, height: 32 },
    });
    const result = await processHuntStallActiveSample({
      config: createCooldownConfig(),
      cooldownWorker: createCooldownWorker({
        result: {
          value: 7,
          confidence: 0.95,
          debug: { recognizedText: "7", reason: "ok", foregroundRatio: 0.11 },
        },
      }),
      cropHistory: [],
      ocrEngine: createOcrEngine(),
      previousState: createHuntStallRuntimeState(),
      previewState: createHuntStallSampleProcessorPreviewState(),
      runtimeTrace: [],
      sampledAt: 20_000,
      showDebugColumns: true,
      context: createFrameContext(),
    });

    expect(sampleSkillMock).toHaveBeenCalledWith(
      createVideo(),
      { x: 0.1, y: 0.2, width: 0.03, height: 0.04 },
      true,
    );
    expect(result.snapshot).toMatchObject({
      rawPreviewUrl: "cooldown-raw",
      processedPreviewUrl: "cooldown-processed",
      mode: "cooldown-presence",
      regionLabel: "32x32",
      recognizedText: "7",
      debugText: "ok | workerMs=3.2 | loopMs=8.4",
      runtimeTrace: [
        expect.objectContaining({
          mode: "cooldown-presence",
          snapshotRecognizedText: "7",
        }),
      ],
      cropHistory: [
        expect.objectContaining({
          mode: "cooldown-presence",
          reasons: expect.arrayContaining([
            "interval",
            "status-change",
            "decision-change",
          ]),
          rawDataUrl: "cooldown-raw",
          processedDataUrl: "cooldown-processed",
          recognizedText: "7",
        }),
      ],
    });
    expect(result.previewState).toMatchObject({
      lastPreviewAt: 20_000,
      urls: {
        displayPreviewUrl: null,
        rawPreviewUrl: "cooldown-raw",
        processedPreviewUrl: "cooldown-processed",
      },
      imageData: {
        displayPreviewImageData: null,
        rawPreviewImageData: expect.objectContaining({ width: 4, height: 4 }),
        processedPreviewImageData: expect.objectContaining({ width: 4, height: 4 }),
      },
    });
  });

  it("retains cooldown preview evidence when the worker detaches its input", async () => {
    const imageData = createImageData();
    sampleSkillMock.mockReturnValue({
      imageData,
      rawPreviewUrl: "cooldown-raw",
      previewUrl: "cooldown-processed",
      region: { x: 10, y: 20, width: 32, height: 32 },
    });

    const result = await processHuntStallActiveSample({
      config: createCooldownConfig(),
      cooldownWorker: createCooldownWorker(
        {
          result: {
            value: 7,
            confidence: 0.95,
            debug: { recognizedText: "7", reason: "ok", foregroundRatio: 0.11 },
          },
        },
        { detachImageData: true },
      ),
      cropHistory: [],
      ocrEngine: createOcrEngine(),
      previousState: createHuntStallRuntimeState(),
      previewState: createHuntStallSampleProcessorPreviewState(),
      runtimeTrace: [],
      sampledAt: 20_000,
      showDebugColumns: true,
      context: createFrameContext(),
    });

    expect(imageData.data.byteLength).toBe(0);
    expect(result.previewState.imageData?.rawPreviewImageData?.data).toHaveLength(64);
    expect(result.previewState.imageData?.processedPreviewImageData?.data).toHaveLength(64);
    expect(result.snapshot).toMatchObject({ recognizedText: "7" });
    expect(result.state.lastDecision).not.toBe("analysis-error");
  });

  it("uses the current cooldown crop for snapshots when debug preview is throttled", async () => {
    sampleSkillMock.mockReturnValue({
      imageData: createImageData(),
      rawPreviewUrl: "new-cooldown-raw",
      previewUrl: "new-cooldown-processed",
      region: { x: 10, y: 20, width: 32, height: 32 },
    });
    const previewState = {
      lastPreviewAt: 10_000,
      urls: {
        displayPreviewUrl: "previous-manual-display",
        rawPreviewUrl: "previous-manual-raw",
        processedPreviewUrl: "previous-manual-processed",
      },
    };
    const result = await processHuntStallActiveSample({
      config: createCooldownConfig(),
      cooldownWorker: createCooldownWorker({
        result: {
          value: 6,
          confidence: 0.91,
          debug: { recognizedText: "6", reason: "ok", foregroundRatio: 0.12 },
        },
      }),
      cropHistory: [],
      ocrEngine: createOcrEngine(),
      previousState: createHuntStallRuntimeState(),
      previewState,
      runtimeTrace: [],
      sampledAt: 10_500,
      showDebugColumns: false,
      context: createFrameContext(),
    });

    expect(sampleSkillMock).toHaveBeenCalledWith(
      createVideo(),
      { x: 0.1, y: 0.2, width: 0.03, height: 0.04 },
      true,
    );
    expect(result.previewState).toBe(previewState);
    expect(result.snapshot).toMatchObject({
      rawPreviewUrl: "new-cooldown-raw",
      processedPreviewUrl: "new-cooldown-processed",
      mode: "cooldown-presence",
      recognizedText: "6",
      runtimeTrace: [
        expect.objectContaining({
          mode: "cooldown-presence",
          snapshotRecognizedText: "6",
        }),
      ],
      cropHistory: [
        expect.objectContaining({
          rawDataUrl: "new-cooldown-raw",
          processedDataUrl: "new-cooldown-processed",
          recognizedText: "6",
        }),
      ],
    });
  });

  it("maps canvas context failures to a user-facing message", () => {
    const result = processHuntStallSampleError({
      config: createConfig(),
      previousState: createHuntStallRuntimeState(),
      previewState: createHuntStallSampleProcessorPreviewState(),
      runtimeTrace: [],
      cropHistory: [],
      sampledAt: 3_000,
      error: new Error("canvas-context-unavailable"),
    });

    expect(result).toMatchObject({
      snapshot: {
        sampledAt: 3_000,
        runtimeFailure: {
          stage: "frame-capture",
          code: "canvas-context-unavailable",
          technicalMessage: "canvas-context-unavailable",
          occurredAt: 3_000,
        },
      },
      shouldAlert: false,
      errorMessage: "사냥 멈춤 감지용 캔버스를 준비하지 못했습니다.",
    });
    expect(result.runtimeTrace).toHaveLength(1);
    expect(result.runtimeTrace[0]).toMatchObject({
      sampledAt: 3_000,
      runtimeFailure: {
        stage: "frame-capture",
        code: "canvas-context-unavailable",
      },
    });
  });
});

function createConfig(
  partial: Partial<HuntStallAlertConfig> = {},
): HuntStallAlertConfig {
  return {
    ...createDefaultHuntStallAlert(),
    enabled: true,
    ...partial,
  };
}

function createCooldownConfig(
  partial: Partial<HuntStallAlertConfig> = {},
): HuntStallAlertConfig {
  return createConfig({
    mode: "cooldown-presence",
    cooldownRegion: { x: 0.1, y: 0.2, width: 0.03, height: 0.04 },
    cooldownMissingThresholdSeconds: 5,
    ...partial,
  });
}

function createVideo(): HTMLVideoElement {
  return {
    videoWidth: 1280,
    videoHeight: 720,
  } as HTMLVideoElement;
}

function createFrameContext() {
  return createMonitoringFrameContext({
    masterVolume: 100,
    sampledAt: 0,
    video: createVideo(),
  });
}

function createImageData(): ImageData {
  return new ImageData(new Uint8ClampedArray(4 * 4 * 4), 4, 4);
}

function createManualExperienceSnapshot(
  partial: Partial<HuntStallSnapshot> = {},
): HuntStallSnapshot {
  return {
    sampledAt: 900,
    rawPreviewUrl: null,
    processedPreviewUrl: null,
    fullFramePreviewUrl: null,
    mode: "manual-experience",
    regionLabel: "exp",
    recognizedText: "1,000 [1.000%]",
    debugText: "ocr",
    confidence: 0.9,
    foregroundRatio: 0.1,
    changeScore: 0,
    performance: null,
    ...partial,
  };
}

function createOcrEngine({
  detachCandidateImageData = false,
  snapshot = createManualExperienceSnapshot(),
  workerReading,
}: {
  detachCandidateImageData?: boolean;
  snapshot?: HuntStallSnapshot;
  workerReading?: Awaited<ReturnType<HuntStallOcrEngine["processCrop"]>>["reading"];
} = {}): HuntStallOcrEngine {
  return {
    reset: vi.fn(),
    processCrop: vi.fn(async (request) => {
      const candidate = request.candidates[0];
      const reading = workerReading ?? {
        fingerprint: "worker-fingerprint",
        recognizedText: snapshot.recognizedText,
        debugText: snapshot.debugText,
        confidence: snapshot.confidence,
        foregroundRatio: snapshot.foregroundRatio,
      };
      const result = {
        type: "processed" as const,
        id: request.id,
        selectedIndex: 0,
        reading,
        barEstimate: null,
        candidates: [
          {
            label: candidate?.label ?? "candidate",
            regionPixels: candidate?.regionPixels ?? {
              x: 0,
              y: 0,
              width: 4,
              height: 4,
            },
            reading,
            processedImageData: undefined,
            score: 1,
            performance: {
              totalMs: 1.8,
              frameReadMs: 0,
              ocrMs: 1.5,
              previewMs: 0,
            },
            barPercent: null,
            barConfidence: null,
            barCoverage: "unknown" as const,
          },
        ],
        performance: {
          totalMs: 2.2,
          barEstimateMs: 0,
          candidateCount: 1,
          candidateMs: 1.8,
          selectedCandidateMs: 1.8,
          selectedFrameReadMs: null,
          selectedOcrMs: 1.5,
          selectedPreviewMs: 0,
          fullFramePreviewMs: null,
          barFrameReadMs: 0,
        },
      };
      if (detachCandidateImageData && candidate?.imageData) {
        structuredClone(candidate.imageData.data.buffer, {
          transfer: [candidate.imageData.data.buffer],
        });
      }
      return result;
    }),
    sample: vi.fn(async () => ({
      imageData: createImageData(),
      processedImageData: createImageData(),
      reading: {
        fingerprint: "fingerprint",
        recognizedText: snapshot.recognizedText,
        debugText: snapshot.debugText,
        confidence: snapshot.confidence,
        foregroundRatio: snapshot.foregroundRatio,
      },
      snapshot,
    })),
  };
}

function createCooldownWorker(
  partial: Partial<
    Awaited<ReturnType<HuntStallCooldownWorkerClient["process"]>>
  > = {},
  {
    detachImageData = false,
  }: {
    detachImageData?: boolean;
  } = {},
): HuntStallCooldownWorkerClient {
  return {
    reset: vi.fn(),
    process: vi.fn(async (imageData) => {
      const result = {
        result: {
          value: null,
          confidence: 0,
          debug: { reason: "empty", foregroundRatio: 0 },
        },
        activity: {
          fingerprint: "0".repeat(256),
          gridColumns: 16,
          gridRows: 16,
          foregroundRatio: 0.12,
        },
        performance: {
          recognitionMs: 2.4,
          totalMs: 3.2,
        },
        ...partial,
      };
      if (detachImageData) {
        structuredClone(imageData.data.buffer, {
          transfer: [imageData.data.buffer],
        });
      }
      return result;
    }),
  };
}
