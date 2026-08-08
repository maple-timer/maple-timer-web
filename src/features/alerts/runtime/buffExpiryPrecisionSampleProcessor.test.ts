import type { MutableRefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBuffExpiryRuntimeState } from "../../../lib/buffExpiry/buffExpiryRuntimeState";
import { createDefaultBuffExpiryAlert } from "../../../lib/storage";
import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
  BuffExpiryTrackedBuff,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryPrecisionPreloadStatus } from "../../../platform/runtime-workers/buff-expiry/buffExpiryPrecisionWorkerClient";
import type { BuffExpiryPrecisionSampleResponse } from "../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import { processBuffExpiryPrecisionSample } from "./buffExpiryPrecisionSampleProcessor";
import type { BuffExpiryPrecisionSampleProcessorContext } from "./buffExpirySampleProcessorContext";
import { createMonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import type { SharedBuffSlotAnalysisResult } from "./useSharedBuffSlotAnalysis";
import {
  updateBuffExpiryPrecisionPreloadStatusFromSampleResponse,
  updateBuffExpiryPrecisionPreviewState,
} from "./buffExpiryPrecisionSampleProcessorState";

const captureMock = vi.hoisted(() => ({
  createBuffExpiryPrecisionDiagnosticRoiPreview: vi.fn(),
  sampleBuffExpiryPrecisionVideoFrame: vi.fn(),
}));

const previewMock = vi.hoisted(() => ({
  createBuffExpiryNormalizedBoxPreviewImageData: vi.fn(),
  createBuffExpiryNormalizedBoxPreviewUrls: vi.fn(),
  createBuffExpiryProcessedPreview: vi.fn(),
}));

vi.mock("../../../platform/frame-capture/buff-expiry/buffExpiryPrecisionCapture", () => ({
  createBuffExpiryPrecisionDiagnosticRoiPreview: captureMock.createBuffExpiryPrecisionDiagnosticRoiPreview,
  sampleBuffExpiryPrecisionVideoFrame: captureMock.sampleBuffExpiryPrecisionVideoFrame,
}));

vi.mock("../../../lib/buffExpiry/buffExpiryPreview", () => ({
  createBuffExpiryNormalizedBoxPreviewImageData:
    previewMock.createBuffExpiryNormalizedBoxPreviewImageData,
  createBuffExpiryNormalizedBoxPreviewUrls: previewMock.createBuffExpiryNormalizedBoxPreviewUrls,
  createBuffExpiryProcessedPreview: previewMock.createBuffExpiryProcessedPreview,
}));

describe("processBuffExpiryPrecisionSample", () => {
  beforeEach(() => {
    captureMock.sampleBuffExpiryPrecisionVideoFrame.mockReset();
    captureMock.sampleBuffExpiryPrecisionVideoFrame.mockReturnValue({
      imageData: createImageData(),
      roi: { x: 1, y: 2, width: 100, height: 80 },
      rawPreviewUrl: "raw-preview",
      fullFramePreviewUrl: "full-preview",
    });
    captureMock.createBuffExpiryPrecisionDiagnosticRoiPreview.mockReset();
    captureMock.createBuffExpiryPrecisionDiagnosticRoiPreview.mockReturnValue({
      sourceSize: { width: 1280, height: 720 },
      roi: { x: 0, y: 0, width: 300, height: 120 },
      imageDataUrl: "roi-preview",
    });
    previewMock.createBuffExpiryNormalizedBoxPreviewUrls.mockReset();
    previewMock.createBuffExpiryNormalizedBoxPreviewUrls.mockReturnValue({
      "10:20:32:32": "box-preview",
    });
    previewMock.createBuffExpiryNormalizedBoxPreviewImageData.mockReset();
    previewMock.createBuffExpiryNormalizedBoxPreviewImageData.mockReturnValue({
      "10:20:32:32": {
        width: 32,
        height: 32,
        data: new Uint8ClampedArray(32 * 32 * 4),
      },
    });
    previewMock.createBuffExpiryProcessedPreview.mockReset();
    previewMock.createBuffExpiryProcessedPreview.mockReturnValue("processed-preview");
  });

  it("samples while the precision engine preload is still loading", async () => {
    const context = createContext({
      preloadStatus: "loading",
      response: createResponse({ seconds: 41, countdownModelStatus: "loading" }),
    });
    context.buffExpiryRuntimeRef.current = {
      ...createBuffExpiryRuntimeState(),
      status: "paused",
    };

    await processBuffExpiryPrecisionSample({
      sampledAt: 10_000,
      frameContext: createFrameContext(10_000),
      shouldIncludeDebugPreview: true,
      showDebugColumns: true,
      config: createDefaultBuffExpiryAlert(),
      context,
    });

    expect(captureMock.sampleBuffExpiryPrecisionVideoFrame).toHaveBeenCalled();
    expect(context.precisionEngineRef.current.process).toHaveBeenCalled();
    expect(context.trackMonitoringStarted).toHaveBeenCalledTimes(1);
    expect(context.updatePrecisionEnginePreloadStatusFromSample).toHaveBeenCalledWith("loading");
    expect(context.publishState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "tracking",
        lastSampledAt: 10_000,
      }),
      expect.objectContaining({
        performance: expect.objectContaining({
          countdownModelStatus: "loading",
        }),
      }),
    );
  });

  it("publishes the product sample when warm-trace boundary listeners throw", async () => {
    const context = createContext({
      response: createResponse({ seconds: 41, countdownModelStatus: "ready" }),
    });
    const boundaryOrder: string[] = [];
    const onMatcherOcrCompleted = vi.fn(() => {
      boundaryOrder.push("matcher");
      throw new Error("matcher-trace-failed");
    });
    const onTemporalDecisionCompleted = vi.fn(() => {
      boundaryOrder.push("temporal");
      throw new Error("temporal-trace-failed");
    });

    const result = await processBuffExpiryPrecisionSample({
      sampledAt: 15_000,
      frameContext: createFrameContext(15_000),
      shouldIncludeDebugPreview: false,
      showDebugColumns: false,
      config: createDefaultBuffExpiryAlert(),
      context,
      onMatcherOcrCompleted,
      onTemporalDecisionCompleted,
    });

    expect(boundaryOrder).toEqual(["matcher", "temporal"]);
    expect(onMatcherOcrCompleted).toHaveBeenCalledTimes(1);
    expect(onTemporalDecisionCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ confirmedTransitions: [] }),
    );
    expect(result.state).toMatchObject({
      status: "tracking",
      lastSampledAt: 15_000,
    });
    expect(context.publishState).toHaveBeenCalledTimes(1);
  });

  it("publishes precision runtime, snapshot, trace, debug history, and preload status from a response", async () => {
    const context = createContext({
      response: createResponse({ seconds: 41, countdownModelStatus: "ready" }),
    });

    await processBuffExpiryPrecisionSample({
      sampledAt: 20_000,
      frameContext: createFrameContext(20_000),
      shouldIncludeDebugPreview: true,
      showDebugColumns: true,
      config: createDefaultBuffExpiryAlert(),
      context,
    });

    expect(context.trackMonitoringStarted).toHaveBeenCalledTimes(1);
    expect(context.precisionEngineRef.current.process).toHaveBeenCalledWith({
      imageData: expect.any(ImageData),
      sampledAt: 20_000,
      buffSlotAnalysis: undefined,
      sourceSize: { width: 4, height: 4 },
      activeGroups: ["unionWealth", "unionLuck", "potion", "expCoupon"],
    });
    expect(context.updatePrecisionEnginePreloadStatusFromSample).toHaveBeenCalledWith("ready");
    expect(context.lastPreviewAtRef.current).toBe(20_000);
    expect(context.lastPreviewUrlsRef.current).toEqual({
      rawPreviewUrl: "raw-preview",
      processedPreviewUrl: "processed-preview",
      fullFramePreviewUrl: "full-preview",
    });
    expect(context.debugDetectionHistoryRef.current).toHaveLength(1);
    expect(context.runtimeTraceRef.current).toHaveLength(1);
    expect(context.publishState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "tracking",
        boxCount: 1,
        acceptedMatchCount: 1,
        lastSampledAt: 20_000,
        lastDetectedAt: 20_000,
      }),
      expect.objectContaining({
        sampledAt: 20_000,
        parserEngine: "dl",
        parserFallbackReason: null,
        boxes: [expect.objectContaining({ x: 10, y: 20, width: 32, height: 32 })],
        displayBoxes: [expect.objectContaining({ x: 10, y: 20, width: 32, height: 32 })],
        boxPreviewUrls: {
          "10:20:32:32": "box-preview",
        },
        boxPreviewImageData: {
          "10:20:32:32": expect.objectContaining({
            width: 32,
            height: 32,
            data: expect.any(Uint8ClampedArray),
          }),
        },
        nextIconObservations: [expect.objectContaining({ id: "slot:0" })],
        runtimeTrace: [expect.objectContaining({ status: "tracking", acceptedMatchCount: 1 })],
      }),
    );
  });

  it("keeps unselected precision groups out of tracking while preserving raw observations", async () => {
    const context = createContext({
      response: createResponse({ seconds: 41, countdownModelStatus: "ready" }),
    });
    const previousTrack = createTrackedBuff();
    context.precisionTrackedBuffsRef.current = [previousTrack];
    context.buffExpiryRuntimeRef.current = {
      ...context.buffExpiryRuntimeRef.current,
      tracks: [previousTrack],
    };

    await processBuffExpiryPrecisionSample({
      sampledAt: 21_000,
      frameContext: createFrameContext(21_000),
      shouldIncludeDebugPreview: false,
      showDebugColumns: false,
      config: {
        ...createDefaultBuffExpiryAlert(),
        enabled: true,
        selectedPrecisionTargetGroups: ["potion"],
      },
      context,
    });

    expect(context.precisionTrackedBuffsRef.current).toEqual([]);
    expect(context.publishState).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedMatchCount: 0,
        pendingTracks: [],
        tracks: [],
      }),
      expect.objectContaining({
        nextIconObservations: [expect.objectContaining({ id: "slot:0" })],
      }),
    );
  });

  it("uses the shared parser result without recapturing the decision frame", async () => {
    const context = createContext({
      response: createResponse({ seconds: 41, countdownModelStatus: "ready" }),
    });
    const sharedBuffSlotAnalysis = createSharedBuffSlotAnalysis(23_000);

    const result = await processBuffExpiryPrecisionSample({
      sampledAt: 23_000,
      frameContext: createFrameContext(23_000),
      shouldIncludeDebugPreview: false,
      showDebugColumns: false,
      config: createDefaultBuffExpiryAlert(),
      context,
      sharedBuffSlotAnalysis,
    });

    expect(captureMock.sampleBuffExpiryPrecisionVideoFrame).not.toHaveBeenCalled();
    expect(context.precisionEngineRef.current.process).toHaveBeenCalledWith(
      expect.objectContaining({
        imageData: expect.objectContaining({ width: 1, height: 1 }),
        sampledAt: 23_000,
        buffSlotAnalysis: sharedBuffSlotAnalysis.analysis,
      }),
    );
    expect(result.evidenceSource).toMatchObject({
      dataUrl: "data:image/png;base64,buff-slot-source",
      sourceSize: { width: 1280, height: 720 },
    });
  });

  it("creates normalized previews for current display boxes during live processing", async () => {
    const selectedBox = {
      x: 10,
      y: 20,
      size: 32,
      row: 0,
      col: 0,
      confidence: 0.99,
      score: 0.98,
    };
    const unselectedBox = {
      x: 50,
      y: 20,
      size: 32,
      row: 0,
      col: 1,
      confidence: 0.97,
      score: 0.96,
    };
    const context = createContext({
      response: createResponse({
        seconds: 41,
        countdownModelStatus: "ready",
        boxes: [selectedBox, unselectedBox],
        icons: [
          {
            width: 1,
            height: 1,
            data: new Uint8ClampedArray([1, 1, 1, 255]),
          },
          {
            width: 1,
            height: 1,
            data: new Uint8ClampedArray([2, 2, 2, 255]),
          },
        ],
        iconObservations: [
          makeObservationForBox({
            id: "selected",
            box: selectedBox,
            boxIndex: 0,
            group: "unionWealth",
          }),
          makeObservationForBox({
            id: "unselected",
            box: unselectedBox,
            boxIndex: 1,
            group: "potion",
          }),
        ],
      }),
    });

    await processBuffExpiryPrecisionSample({
      sampledAt: 22_000,
      frameContext: createFrameContext(22_000),
      shouldIncludeDebugPreview: false,
      showDebugColumns: false,
      config: {
        ...createDefaultBuffExpiryAlert(),
        enabled: true,
        selectedPrecisionTargetGroups: ["unionWealth"],
      },
      context,
    });

    expect(previewMock.createBuffExpiryNormalizedBoxPreviewUrls).toHaveBeenCalledWith({
      normalizedBoxIcons: [
        expect.objectContaining({
          box: expect.objectContaining({ x: 10, y: 20, width: 32, height: 32 }),
          imageData: expect.objectContaining({
            data: new Uint8ClampedArray([1, 1, 1, 255]),
          }),
        }),
        expect.objectContaining({
          box: expect.objectContaining({ x: 50, y: 20, width: 32, height: 32 }),
          imageData: expect.objectContaining({
            data: new Uint8ClampedArray([2, 2, 2, 255]),
          }),
        }),
      ],
    });
    expect(previewMock.createBuffExpiryNormalizedBoxPreviewImageData).toHaveBeenCalledWith({
      normalizedBoxIcons: [
        expect.objectContaining({
          box: expect.objectContaining({ x: 10, y: 20, width: 32, height: 32 }),
        }),
        expect.objectContaining({
          box: expect.objectContaining({ x: 50, y: 20, width: 32, height: 32 }),
        }),
      ],
    });
  });

  it("keeps live monitoring running when diagnostic ROI capture fails", async () => {
    const context = createContext({
      response: createResponse({ seconds: 41, countdownModelStatus: "ready" }),
    });
    captureMock.createBuffExpiryPrecisionDiagnosticRoiPreview.mockImplementation(() => {
      throw new Error("diagnostic-capture-failed");
    });

    const frameContext = createFrameContext(31_000);
    await processBuffExpiryPrecisionSample({
      sampledAt: 31_000,
      frameContext,
      shouldIncludeDebugPreview: false,
      showDebugColumns: false,
      config: createDefaultBuffExpiryAlert(),
      context,
    });

    expect(captureMock.createBuffExpiryPrecisionDiagnosticRoiPreview).toHaveBeenCalledWith(
      frameContext.video,
    );
    expect(context.precisionRecentRoiFramesRef.current).toEqual([]);
    expect(context.publishState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "tracking",
        lastSampledAt: 31_000,
      }),
      expect.objectContaining({
        nextRecentRoiFrames: [],
      }),
    );
  });
});

describe("buffExpiryPrecisionSampleProcessorState", () => {
  beforeEach(() => {
    previewMock.createBuffExpiryProcessedPreview.mockReset();
    previewMock.createBuffExpiryProcessedPreview.mockReturnValue("processed-preview");
  });

  it("updates preload status only for active countdown model states", () => {
    const context = createContext();

    updateBuffExpiryPrecisionPreloadStatusFromSampleResponse({
      response: createResponse({ seconds: 41, countdownModelStatus: "loading" }),
      context,
    });
    updateBuffExpiryPrecisionPreloadStatusFromSampleResponse({
      response: createResponse({ seconds: 41, countdownModelStatus: "ready" }),
      context,
    });
    updateBuffExpiryPrecisionPreloadStatusFromSampleResponse({
      response: createResponse({ seconds: 41, countdownModelStatus: "error" }),
      context,
    });
    updateBuffExpiryPrecisionPreloadStatusFromSampleResponse({
      response: createResponse({ seconds: 41, countdownModelStatus: "idle" }),
      context,
    });

    expect(context.updatePrecisionEnginePreloadStatusFromSample).toHaveBeenCalledTimes(3);
    expect(context.updatePrecisionEnginePreloadStatusFromSample).toHaveBeenNthCalledWith(1, "loading");
    expect(context.updatePrecisionEnginePreloadStatusFromSample).toHaveBeenNthCalledWith(2, "ready");
    expect(context.updatePrecisionEnginePreloadStatusFromSample).toHaveBeenNthCalledWith(3, "error");
  });

  it("keeps previous processed preview when debug preview is not requested", () => {
    const context = createContext();
    const frame = {
      imageData: createImageData(),
      roi: { x: 1, y: 2, width: 100, height: 80 },
      rawPreviewUrl: null,
      fullFramePreviewUrl: "new-full-preview",
    };

    const processedPreviewUrl = updateBuffExpiryPrecisionPreviewState({
      sampledAt: 20_000,
      frame,
      previewImageData: createImageData(),
      boxes: [],
      shouldIncludeDebugPreview: false,
      context,
    });

    expect(previewMock.createBuffExpiryProcessedPreview).not.toHaveBeenCalled();
    expect(processedPreviewUrl).toBe("previous-processed");
    expect(context.lastPreviewAtRef.current).toBe(0);
    expect(context.lastPreviewUrlsRef.current).toEqual({
      rawPreviewUrl: "previous-raw",
      processedPreviewUrl: "previous-processed",
      fullFramePreviewUrl: "new-full-preview",
    });
  });
});

function createContext({
  preloadStatus = "ready",
  response = createResponse({ seconds: 41, countdownModelStatus: "ready" }),
}: {
  preloadStatus?: BuffExpiryPrecisionPreloadStatus;
  response?: BuffExpiryPrecisionSampleResponse;
} = {}): BuffExpiryPrecisionSampleProcessorContext {
  const runtimeRef = ref<BuffExpiryRuntimeState>(createBuffExpiryRuntimeState());
  const snapshotRef = ref<BuffExpirySnapshot | null>(null);
  const publishState = vi.fn((state: BuffExpiryRuntimeState, snapshot: BuffExpirySnapshot | null) => {
    runtimeRef.current = state;
    snapshotRef.current = snapshot;
  });

  return {
    precisionEngineRef: ref({
      process: vi.fn().mockResolvedValue(response),
      reset: vi.fn(),
      preload: vi.fn(),
    }),
    precisionEnginePreloadStatusRef: ref(preloadStatus),
    updatePrecisionEnginePreloadStatusFromSample: vi.fn(),
    buffExpiryRuntimeRef: runtimeRef,
    buffExpirySnapshotRef: snapshotRef,
    lastPreviewAtRef: ref(0),
    lastPreviewUrlsRef: ref({
      rawPreviewUrl: "previous-raw",
      processedPreviewUrl: "previous-processed",
      fullFramePreviewUrl: "previous-full",
    }),
    displayBoxTracksRef: ref([]),
    precisionTrackedBuffsRef: ref([]),
    precisionPendingTracksRef: ref([]),
    precisionRecentRoiFramesRef: ref([]),
    lastPrecisionPeriodicRoiFrameAtRef: ref(0),
    lastPrecisionNearMissRoiFrameAtRef: ref(0),
    lastPrecisionAlertRoiFrameAtRef: ref(null),
    debugDetectionHistoryRef: ref([]),
    runtimeTraceRef: ref([]),
    alertDecisionHistoryRef: ref([]),
    iconEvidenceRef: ref([]),
    temporalCandidateTracksRef: ref([]),
    expiryClustersRef: ref([]),
    trackMonitoringStarted: vi.fn(),
    publishState,
  };
}

function createResponse({
  seconds,
  countdownModelStatus,
  ...overrides
}: {
  seconds: number;
  countdownModelStatus: BuffExpiryPrecisionPreloadStatus;
} & Partial<BuffExpiryPrecisionSampleResponse>): BuffExpiryPrecisionSampleResponse {
  const box = {
    x: 10,
    y: 20,
    size: 32,
    row: 0,
    col: 0,
    confidence: 0.99,
    score: 0.98,
  };
  return {
    boxes: [box],
    icons: [
      {
        width: 32,
        height: 32,
        data: new Uint8ClampedArray(32 * 32 * 4),
      },
    ],
    iconObservations: [
      {
        id: "slot:0",
        boxIndex: 0,
        box,
        identity: {
          kind: "target",
          group: "unionWealth",
          score: 2,
          margin: 1,
          decisionReason: "target-accepted",
          bestTargetName: "유니온의 부",
          bestExcludedName: null,
        },
        countdown: {
          kind: "exact",
          text: String(seconds),
          totalSeconds: seconds,
          format: "seconds",
          textRegion: "center",
          confidence: 0.96,
          status: "high",
          routerTarget: "center",
          routerConfidence: 0.96,
          routerStatus: "high",
        },
      },
    ],
    bestByGroup: [],
    parserEngine: "dl",
    parserFallbackReason: null,
    moduleVersions: {
      runtime: "test",
      parser: "test",
      matcher: "test",
      matcherModel: "test",
      countdown: "test",
    },
    unsupported: false,
    unsupportedReason: null,
    performance: {
      totalMs: 11,
      detectMs: 3,
      matchMs: 4,
      countdownMs: 2,
      countdownCount: 1,
      countdownModelStatus,
      matcherModelStatus: countdownModelStatus,
      boxCount: 1,
    },
    ...overrides,
  };
}

function makeObservationForBox({
  id,
  box,
  boxIndex,
  group,
}: {
  id: string;
  box: BuffExpiryPrecisionSampleResponse["boxes"][number];
  boxIndex: number;
  group: NonNullable<BuffExpiryPrecisionSampleResponse["iconObservations"][number]["identity"]["group"]>;
}): BuffExpiryPrecisionSampleResponse["iconObservations"][number] {
  return {
    id,
    boxIndex,
    box,
    identity: {
      kind: "target",
      group,
      score: 2,
      margin: 1,
      decisionReason: "target-accepted",
      bestTargetName: group,
      bestExcludedName: null,
    },
    countdown: {
      kind: "exact",
      text: "41",
      totalSeconds: 41,
      format: "seconds",
      textRegion: "center",
      confidence: 0.96,
      status: "high",
      routerTarget: "center",
      routerConfidence: 0.96,
      routerStatus: "high",
    },
  };
}

function ref<T>(current: T): MutableRefObject<T> {
  return { current };
}

function createImageData(): ImageData {
  return new ImageData(new Uint8ClampedArray(4 * 4 * 4), 4, 4);
}

function createVideo(): HTMLVideoElement {
  return {
    readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
    videoWidth: 1280,
    videoHeight: 720,
  } as HTMLVideoElement;
}

function createFrameContext(sampledAt: number) {
  return createMonitoringFrameContext({
    sampledAt,
    video: createVideo(),
    masterVolume: 1,
  });
}

function createSharedBuffSlotAnalysis(sampledAt: number): SharedBuffSlotAnalysisResult {
  return {
    sampledAt,
    frame: {
      rawPreviewUrl: "data:image/png;base64,buff-slot-source",
      regionLabel: "640x360",
      sourceSize: { width: 1280, height: 720 },
      roi: { x: 640, y: 0, width: 640, height: 360 },
    },
    analysis: {
      icons: [],
      boxes: [],
      engine: "dl",
      parserVersion: "test-shared-parser",
    },
    performance: {
      totalMs: 3,
      detectMs: 2,
      boxCount: 0,
    },
  };
}

function createTrackedBuff(): BuffExpiryTrackedBuff {
  return {
    id: "track:union-wealth",
    buffId: "union_wealth",
    name: "유니온의 부",
    box: { x: 10, y: 20, width: 32, height: 32, confidence: 0.99 },
    detectedSeconds: 41,
    detectedAt: 20_000,
    expiresAt: 61_000,
    lastSeenAt: 20_000,
    alertedAt: null,
    score: 2,
  };
}
