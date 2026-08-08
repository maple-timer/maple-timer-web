import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBoosterExpiryRuntimeState } from "../../../lib/boosterExpiry/boosterExpiryRuntime";
import type {
  BoosterExpiryCompactTime,
  BoosterExpiryRuntimeState,
  BoosterExpiryWorkerResult,
} from "../../../lib/boosterExpiry/boosterExpiryTypes";
import type { BoosterExpiryWorkerClientResult } from "../../../platform/runtime-workers/booster-expiry/boosterExpiryWorkerClient";
import { createDefaultBoosterExpiryAlert } from "../../../lib/storage";
import type { BoosterExpiryAlertConfig } from "../../../types";
import {
  createBoosterExpirySampleProcessorState,
  processBoosterExpirySampleError,
  processBoosterExpiryUnavailableSample,
  processBoosterExpiryWorkerSample,
  resetBoosterExpirySampleProcessorState,
  shouldIncludeBoosterExpiryPreview,
} from "./boosterExpirySampleProcessor";

const captureMock = vi.hoisted(() => ({
  createBoosterExpiryTimerPreviewUrl: vi.fn(),
}));

vi.mock("../../../lib/boosterExpiry/boosterExpiryCapture", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/boosterExpiry/boosterExpiryCapture")
  >("../../../lib/boosterExpiry/boosterExpiryCapture");
  return {
    ...actual,
    createBoosterExpiryTimerPreviewUrl:
      captureMock.createBoosterExpiryTimerPreviewUrl,
  };
});

describe("boosterExpirySampleProcessor", () => {
  beforeEach(() => {
    captureMock.createBoosterExpiryTimerPreviewUrl.mockReset();
    captureMock.createBoosterExpiryTimerPreviewUrl.mockImplementation(
      (
        _imageData: ImageData,
        rect: { x: number; y: number; width: number; height: number } | null,
      ) =>
        rect ? `timer:${rect.x}:${rect.y}:${rect.width}:${rect.height}` : null,
    );
  });

  it("throttles debug previews", () => {
    const diagnostics = {
      ...createBoosterExpirySampleProcessorState(),
      lastPreviewAt: 1_000,
    };

    expect(
      shouldIncludeBoosterExpiryPreview({ diagnostics, sampledAt: 2_999 }),
    ).toBe(false);
    expect(
      shouldIncludeBoosterExpiryPreview({ diagnostics, sampledAt: 3_000 }),
    ).toBe(true);
  });

  it("builds the current runtime snapshot without duplicate evidence history", () => {
    const diagnostics = createBoosterExpirySampleProcessorState();
    const result = processBoosterExpiryWorkerSample({
      config: createConfig(),
      currentState: createBoosterExpiryRuntimeState(),
      diagnostics,
      previousState: createBoosterExpiryRuntimeState(),
      previewImageData: createImageData(),
      processed: createProcessed(70),
      sample: createSample(),
      sampledAt: 10_000,
      shouldIncludePreview: true,
    });

    expect(result).toMatchObject({
      shouldAlertNow: false,
      alreadyAlertedForSameSchedule: false,
      errorMessage: null,
      state: {
        status: "confirming",
        rawText: "1:10",
        displayText: "1:10",
        rawRemainingSeconds: 70,
        remainingSeconds: 70,
        lastDecision: "raw-locked",
      },
      snapshot: {
        sampledAt: 10_000,
        rawPreviewUrl: "raw-preview",
        timerPreviewUrl: "timer:100:20:120:36",
        regionLabel: "640x180",
        rawTime: expect.objectContaining({ seconds: 70 }),
        time: expect.objectContaining({ seconds: 70 }),
        runtimeTrace: [
          expect.objectContaining({
            sampledAt: 10_000,
            status: "confirming",
            rawRemainingSeconds: 70,
            remainingSeconds: 70,
            rect: { x: 100, y: 20, width: 120, height: 36 },
          }),
        ],
        timerEvidence: [],
        confirmationEvidence: [],
      },
      diagnostics: {
        lastPreviewAt: 10_000,
        previewUrls: {
          rawPreviewUrl: "raw-preview",
          timerPreviewUrl: "timer:100:20:120:36",
        },
      },
    });
  });

  it("keeps constant memory across five minutes of normal samples", () => {
    let diagnostics = createBoosterExpirySampleProcessorState();
    let state = createBoosterExpiryRuntimeState();

    for (let index = 0; index < 300; index += 1) {
      const result = processBoosterExpiryWorkerSample({
        config: createConfig(),
        currentState: state,
        diagnostics,
        previousState: state,
        previewImageData: null,
        processed: createProcessed(70),
        sample: createSample(),
        sampledAt: 10_000 + index * 1_000,
        shouldIncludePreview: false,
      });
      diagnostics = result.diagnostics;
      state = result.state;
    }

    expect(diagnostics.trace).toHaveLength(1);
    expect(diagnostics).not.toHaveProperty("timerEvidence");
    expect(diagnostics).not.toHaveProperty("confirmationEvidence");
    expect(diagnostics.snapshot).toMatchObject({
      runtimeTrace: [expect.objectContaining({ sampledAt: 309_000 })],
      timerEvidence: [],
      confirmationEvidence: [],
    });
  });

  it("does not create legacy interval media when no timer is detected", () => {
    const result = processBoosterExpiryWorkerSample({
      config: createConfig(),
      currentState: createBoosterExpiryRuntimeState(),
      diagnostics: createBoosterExpirySampleProcessorState(),
      previousState: createBoosterExpiryRuntimeState(),
      previewImageData: createImageData(),
      processed: createProcessed(null),
      sample: {
        ...createSample(),
        rawPreviewUrl: "data:image/png;base64,no-timer-frame",
      },
      sampledAt: 10_000,
      shouldIncludePreview: false,
    });

    expect(result.snapshot.timerEvidence).toEqual([]);
    expect(result.snapshot.confirmationEvidence).toEqual([]);
    expect(captureMock.createBoosterExpiryTimerPreviewUrl).not.toHaveBeenCalled();
  });

  it("keeps previous preview urls without storing a second evidence copy", () => {
    const diagnostics = {
      ...createBoosterExpirySampleProcessorState(),
      lastPreviewAt: 10_000,
      previewUrls: {
        rawPreviewUrl: "previous-raw-preview",
        timerPreviewUrl: "previous-timer-preview",
      },
    };
    const result = processBoosterExpiryWorkerSample({
      config: createConfig(),
      currentState: createBoosterExpiryRuntimeState(),
      diagnostics,
      previousState: createBoosterExpiryRuntimeState(),
      previewImageData: createImageData(),
      processed: createProcessed(70),
      sample: {
        ...createSample(),
        rawPreviewUrl: "new-raw-preview",
      },
      sampledAt: 10_500,
      shouldIncludePreview: false,
    });

    expect(result.diagnostics.previewUrls).toEqual({
      rawPreviewUrl: "previous-raw-preview",
      timerPreviewUrl: "previous-timer-preview",
    });
    expect(result.snapshot).toMatchObject({
      rawPreviewUrl: "previous-raw-preview",
      timerPreviewUrl: "previous-timer-preview",
      timerEvidence: [],
      confirmationEvidence: [],
    });
  });

  it("keeps previous diagnostics and records no-stream samples when the frame is unavailable", () => {
    const first = processBoosterExpiryWorkerSample({
      config: createConfig(),
      currentState: createBoosterExpiryRuntimeState(),
      diagnostics: createBoosterExpirySampleProcessorState(),
      previousState: createBoosterExpiryRuntimeState(),
      previewImageData: createImageData(),
      processed: createProcessed(70),
      sample: createSample(),
      sampledAt: 10_000,
      shouldIncludePreview: true,
    });

    const unavailable = processBoosterExpiryUnavailableSample({
      config: createConfig(),
      diagnostics: first.diagnostics,
      previousState: first.state,
      sampledAt: 11_000,
      hasStream: false,
    });

    expect(unavailable).toMatchObject({
      shouldAlertNow: false,
      errorMessage: null,
      state: {
        status: "no-stream",
        lastDecision: "no-stream",
      },
      snapshot: {
        sampledAt: 11_000,
        rawPreviewUrl: "raw-preview",
        timerPreviewUrl: "timer:100:20:120:36",
        runtimeTrace: [
          expect.objectContaining({ sampledAt: 11_000, status: "no-stream" }),
        ],
      },
    });
  });

  it("does not fire a duplicate immediate alert when the same schedule was already alerted", () => {
    const armed = createArmedState({
      alertAt: 90_000,
      confirmedExpiresAt: 100_000,
      confirmedLastSupportedAt: 80_000,
      alertedAt: null,
    });
    const alreadyAlerted = createArmedState({
      alertAt: 90_000,
      confirmedExpiresAt: 100_000,
      confirmedLastSupportedAt: 80_000,
      alertedAt: 90_000,
    });
    alreadyAlerted.lastAlertPlayback = {
      status: "started",
      cycleId: "100000",
      soundId: "test-sound",
      requestedAt: 90_000,
      startedAt: 90_010,
      finishedAt: null,
      failedAt: null,
      error: null,
    };

    const result = processBoosterExpiryWorkerSample({
      config: createConfig({ alertLeadSeconds: 10 }),
      currentState: alreadyAlerted,
      diagnostics: createBoosterExpirySampleProcessorState(),
      previousState: armed,
      previewImageData: null,
      processed: createProcessed(null),
      sample: createSample(),
      sampledAt: 90_000,
      shouldIncludePreview: false,
    });

    expect(result.alreadyAlertedForSameSchedule).toBe(true);
    expect(result.shouldAlertNow).toBe(false);
    expect(result.state).toMatchObject({
      status: "alerted",
      alertedAt: 90_000,
      alertAt: 90_000,
      confirmedExpiresAt: 100_000,
      lastAlertPlayback: {
        status: "started",
        requestedAt: 90_000,
      },
    });
  });

  it("maps canvas context errors to the booster expiry message", () => {
    const result = processBoosterExpirySampleError({
      config: createConfig(),
      diagnostics: createBoosterExpirySampleProcessorState(),
      previousState: createBoosterExpiryRuntimeState(),
      sampledAt: 10_000,
      error: new Error("canvas-context-unavailable"),
    });

    expect(result).toMatchObject({
      shouldAlertNow: false,
      errorMessage: "부스터 종료 감지용 캔버스를 준비하지 못했습니다.",
      state: {
        status: "waiting",
        lastDecision: "timer-waiting",
      },
      snapshot: {
        sampledAt: 10_000,
        runtimeFailure: {
          stage: "frame-capture",
          code: "canvas-context-unavailable",
          technicalMessage: "canvas-context-unavailable",
          occurredAt: 10_000,
        },
      },
    });
    expect(result.snapshot.runtimeTrace).toHaveLength(1);
    expect(result.snapshot.runtimeTrace?.[0]).toMatchObject({
      sampledAt: 10_000,
      status: "waiting",
      decision: "timer-waiting",
      runtimeFailure: {
        stage: "frame-capture",
        code: "canvas-context-unavailable",
      },
    });
  });

  it("preserves only the current panel preview and latest trace when resetting", () => {
    const processed = processBoosterExpiryWorkerSample({
      config: createConfig(),
      currentState: createBoosterExpiryRuntimeState(),
      diagnostics: createBoosterExpirySampleProcessorState(),
      previousState: createBoosterExpiryRuntimeState(),
      previewImageData: createImageData(),
      processed: createProcessed(70),
      sample: createSample(),
      sampledAt: 10_000,
      shouldIncludePreview: true,
    });

    const reset = resetBoosterExpirySampleProcessorState({
      clearDiagnostics: false,
      previous: processed.diagnostics,
    });

    expect(reset.lastPreviewAt).toBe(0);
    expect(reset.previewUrls).toEqual(processed.diagnostics.previewUrls);
    expect(reset.trace).toEqual(processed.diagnostics.trace);
  });
});

function createConfig(
  partial: Partial<BoosterExpiryAlertConfig> = {},
): BoosterExpiryAlertConfig {
  return {
    ...createDefaultBoosterExpiryAlert(),
    enabled: true,
    alertLeadSeconds: 10,
    ...partial,
  };
}

function createProcessed(
  seconds: number | null,
): BoosterExpiryWorkerClientResult {
  return {
    result: createWorkerResult(seconds),
    performance: {
      recognitionMs: 2.4,
      totalMs: 3.2,
    },
  };
}

function createWorkerResult(seconds: number | null): BoosterExpiryWorkerResult {
  const time = seconds === null ? null : createTime(seconds);
  return {
    rawTime: time,
    time,
    timeRect: {
      ok: seconds !== null,
      reason: seconds !== null ? "ok" : "no-timer",
      rect: time?.rect ?? null,
      matchCount: seconds !== null ? 1 : 0,
      candidateCount: seconds !== null ? 1 : 0,
    },
    flow: {
      locked: seconds !== null,
      source: seconds !== null ? "raw-lock" : "none",
      predictedSeconds: seconds,
      rawDeltaSeconds: null,
      timestampMs: 0,
    },
  };
}

function createTime(seconds: number): BoosterExpiryCompactTime {
  const minutes = Math.floor(seconds / 60);
  const secondsPart = Math.floor(seconds % 60);
  const text =
    seconds >= 60
      ? `${minutes}:${String(secondsPart).padStart(2, "0")}`
      : `${seconds}.00`;
  return {
    ok: true,
    reason: "ok",
    rect: { x: 100, y: 20, width: 120, height: 36 },
    digitCount: text.replace(/\D/g, "").length,
    seconds,
    text,
    format: seconds >= 60 ? "m:ss" : "ss.cc",
    selectedBy: "test",
  };
}

function createSample() {
  return {
    imageData: createImageData(640, 180),
    rawPreviewUrl: "raw-preview",
    region: { x: 0, y: 0, width: 640, height: 180 },
  };
}

function createImageData(width = 4, height = 4): ImageData {
  return new ImageData(
    new Uint8ClampedArray(width * height * 4),
    width,
    height,
  );
}

function createArmedState({
  alertAt,
  alertedAt,
  confirmedExpiresAt,
  confirmedLastSupportedAt,
}: {
  alertAt: number;
  alertedAt: number | null;
  confirmedExpiresAt: number;
  confirmedLastSupportedAt: number;
}): BoosterExpiryRuntimeState {
  return {
    ...createBoosterExpiryRuntimeState(),
    status: alertedAt === null ? "armed" : "alerted",
    lastSampledAt: confirmedLastSupportedAt,
    lastDetectedAt: confirmedLastSupportedAt,
    lastRawDetectedAt: confirmedLastSupportedAt,
    rawText: "0:20",
    displayText: "0:20",
    remainingSeconds: 20,
    rawRemainingSeconds: 20,
    estimatedExpiresAt: confirmedExpiresAt,
    alertAt,
    alertedAt,
    confirmedAt: 5_000,
    confirmedExpiresAt,
    confirmedLastSupportedAt,
    flowSource: "raw",
    locked: true,
    confidence: 1,
    consecutiveRawDetections: 6,
    lastDecision: alertedAt === null ? "raw-locked" : "alerted",
  };
}
