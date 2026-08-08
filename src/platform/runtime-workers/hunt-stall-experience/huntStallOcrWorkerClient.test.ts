import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HuntStallExperienceProcessInput,
  HuntStallExperienceProcessResult,
} from "../../../runtime/hunt-stall/experience/huntStallExperienceRuntime";
import {
  getHuntStallOcrWorkerTransferList,
  HUNT_STALL_OCR_WORKER_TIMEOUT_MS,
  HuntStallOcrWorkerClient,
} from "./huntStallOcrWorkerClient";
import type {
  HuntStallOcrWorkerProcessRequest,
  HuntStallOcrWorkerResponse,
} from "./huntStallOcrWorkerTypes";

const runtimeWorkerHealthMocks = vi.hoisted(() => ({
  createRuntimeWorkerFailure: vi.fn(
    ({ error, fallbackMessage }: { error?: unknown; fallbackMessage: string }) =>
      error instanceof Error
        ? error
        : new Error(typeof error === "string" && error ? error : fallbackMessage),
  ),
  markRuntimeWorkerReady: vi.fn(),
}));

vi.mock("../runtimeWorkerHealth", () => runtimeWorkerHealthMocks);

function makeInput(): HuntStallExperienceProcessInput {
  return {
    sampleIndex: 1,
    sourceWidth: 1368,
    sourceHeight: 807,
    barStrips: [{ sourceLabel: "bar", y: 10, height: 1, imageData: new ImageData(2, 1) }],
    candidates: [
      {
        label: "candidate",
        regionPixels: { x: 1, y: 2, width: 3, height: 4 },
        imageData: new ImageData(3, 4),
      },
    ],
    includePreview: false,
    includeReportDiagnostics: false,
  };
}

function makeResult(): HuntStallExperienceProcessResult {
  return {
    selectedIndex: 0,
    reading: {
      fingerprint: "fingerprint",
      recognizedText: "123 [1.23%]",
      confidence: 0.8,
      foregroundRatio: 0.1,
    },
    barEstimate: null,
    candidates: [
      {
        label: "candidate",
        regionPixels: { x: 1, y: 2, width: 3, height: 4 },
        reading: {
          fingerprint: "candidate",
          recognizedText: "123 [1.23%]",
          confidence: 0.8,
          foregroundRatio: 0.1,
        },
        score: 0.9,
        performance: {
          totalMs: 1,
          frameReadMs: 0,
          ocrMs: 0.8,
          previewMs: 0,
        },
        barPercent: null,
        barConfidence: null,
        barCoverage: "unknown",
      },
    ],
    performance: {
      totalMs: 1,
      barEstimateMs: null,
      candidateCount: 1,
      candidateMs: 1,
      selectedCandidateMs: 1,
      selectedFrameReadMs: null,
      selectedOcrMs: 0.8,
      selectedPreviewMs: 0,
      fullFramePreviewMs: null,
    },
  };
}

function makeFallback(result = makeResult()) {
  return {
    process: vi.fn(() => result),
    reset: vi.fn(),
  };
}

function makeWorker(overrides: Partial<Worker> = {}): Worker {
  return {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
    ...overrides,
  } as unknown as Worker;
}

describe("HuntStallOcrWorkerClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the fallback processor when browser workers are unavailable", async () => {
    const input = makeInput();
    const result = makeResult();
    const fallback = makeFallback(result);
    const client = new HuntStallOcrWorkerClient({
      fallbackProcessor: fallback,
      isWorkerAvailable: () => false,
    });

    await expect(client.process(input)).resolves.toBe(result);
    expect(fallback.process).toHaveBeenCalledWith(input);

    client.reset();
    expect(fallback.reset).toHaveBeenCalledTimes(1);
  });

  it("rejects when browser workers are unavailable and no fallback was injected", async () => {
    const client = new HuntStallOcrWorkerClient({
      isWorkerAvailable: () => false,
    });

    await expect(client.process(makeInput())).rejects.toThrow(
      "사냥 멈춤 OCR은 Web Worker를 지원하는 브라우저에서만 사용할 수 있습니다.",
    );
  });

  it("transfers bar strips and candidates before resolving the matching response", async () => {
    const input = makeInput();
    const result = makeResult();
    const worker = makeWorker();
    const client = new HuntStallOcrWorkerClient({
      isWorkerAvailable: () => true,
      createWorker: () => worker,
    });

    const pending = client.process(input);
    const [request, transfer] = vi.mocked(worker.postMessage).mock.calls[0] as [
      HuntStallOcrWorkerProcessRequest,
      Transferable[],
    ];

    expect(request).toMatchObject({
      ...input,
      type: "process",
      id: 1,
    });
    expect(transfer).toEqual(getHuntStallOcrWorkerTransferList(input));

    worker.onmessage?.({
      data: { type: "processed", id: request.id, ...result },
    } as MessageEvent<HuntStallOcrWorkerResponse>);

    await expect(pending).resolves.toEqual(result);
    expect(runtimeWorkerHealthMocks.markRuntimeWorkerReady).toHaveBeenCalledWith(
      "hunt-stall-ocr",
    );
  });

  it("rejects worker error responses with the shared runtime failure", async () => {
    const worker = makeWorker();
    const client = new HuntStallOcrWorkerClient({
      isWorkerAvailable: () => true,
      createWorker: () => worker,
    });
    const pending = client.process(makeInput());
    const request = vi.mocked(worker.postMessage).mock.calls[0][0] as HuntStallOcrWorkerProcessRequest;

    worker.onmessage?.({
      data: { type: "error", id: request.id, message: "recognition failed" },
    } as MessageEvent<HuntStallOcrWorkerResponse>);

    await expect(pending).rejects.toThrow("recognition failed");
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "hunt-stall-ocr",
        code: "worker-response-failed",
      }),
    );
  });

  it("rejects and clears pending requests when postMessage fails", async () => {
    const worker = makeWorker({
      postMessage: vi.fn(() => {
        throw new Error("post failed");
      }),
    });
    const client = new HuntStallOcrWorkerClient({
      fallbackProcessor: makeFallback(),
      isWorkerAvailable: () => true,
      createWorker: () => worker,
    });

    await expect(client.process(makeInput())).rejects.toThrow("post failed");
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("rejects pending requests when reset terminates the worker", async () => {
    const worker = makeWorker();
    const fallback = makeFallback();
    const client = new HuntStallOcrWorkerClient({
      fallbackProcessor: fallback,
      isWorkerAvailable: () => true,
      createWorker: () => worker,
    });

    const pending = client.process(makeInput());
    client.reset();

    await expect(pending).rejects.toThrow("hunt-stall-worker-reset");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(fallback.reset).toHaveBeenCalledTimes(1);
  });

  it("rejects all pending work when the worker runtime fails", async () => {
    const worker = makeWorker();
    const client = new HuntStallOcrWorkerClient({
      isWorkerAvailable: () => true,
      createWorker: () => worker,
    });
    const pending = client.process(makeInput());

    worker.onerror?.({ message: "worker crashed" } as ErrorEvent);

    await expect(pending).rejects.toThrow("worker crashed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects and terminates the worker when a request times out", async () => {
    vi.useFakeTimers();
    const worker = makeWorker();
    const client = new HuntStallOcrWorkerClient({
      fallbackProcessor: makeFallback(),
      isWorkerAvailable: () => true,
      createWorker: () => worker,
      timeoutMs: 25,
    });

    const pending = client.process(makeInput());
    vi.advanceTimersByTime(25);

    await expect(pending).rejects.toThrow("hunt-stall-worker-timeout");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("uses the existing 15-second recognition-worker timeout by default", async () => {
    vi.useFakeTimers();
    const worker = makeWorker();
    const client = new HuntStallOcrWorkerClient({
      fallbackProcessor: makeFallback(),
      isWorkerAvailable: () => true,
      createWorker: () => worker,
    });

    const pending = client.process(makeInput()).then(
      () => null,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(HUNT_STALL_OCR_WORKER_TIMEOUT_MS - 1);
    expect(worker.terminate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("hunt-stall-worker-timeout");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
