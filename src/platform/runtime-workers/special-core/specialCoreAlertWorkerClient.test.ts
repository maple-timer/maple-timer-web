import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpecialCoreSampleResponse } from "../../../runtime/special-core/analysis/specialCoreAnalysisRuntime";
import {
  SPECIAL_CORE_ALERT_WORKER_TIMEOUT_MS,
  SpecialCoreAlertWorkerClient,
} from "./specialCoreAlertWorkerClient";
import type {
  SpecialCoreAlertWorkerRequest,
  SpecialCoreAlertWorkerResponse,
} from "./specialCoreAlertWorkerTypes";

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

class FakeWorker {
  onmessage: ((event: MessageEvent<SpecialCoreAlertWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn<
    (request: SpecialCoreAlertWorkerRequest, transfer?: Transferable[]) => void
  >();
  terminate = vi.fn();

  respond(response: SpecialCoreAlertWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<SpecialCoreAlertWorkerResponse>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

describe("SpecialCoreAlertWorkerClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("transfers the sampled image and resolves the matching response", async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const imageData = createImageData();
    const buffSlotAnalysis = {
      icons: [],
      boxes: [],
      engine: "dl" as const,
      parserVersion: "test-shared-parser",
    };
    const pending = client.process({
      imageData,
      sampledAt: 12_345,
      buffSlotAnalysis,
      buffSlotInputMode: "topRightQuadrant",
    });
    const request = worker.postMessage.mock.calls[0][0];

    expect(request).toMatchObject({
      type: "process",
      requestId: 1,
      imageData,
      sampledAt: 12_345,
      buffSlotAnalysis,
      buffSlotInputMode: "topRightQuadrant",
    });
    expect(worker.postMessage.mock.calls[0][1]).toEqual([imageData.data.buffer]);

    const response = createResponse(12_345);
    worker.respond({
      requestId: request.requestId,
      ok: true,
      response,
    });

    await expect(pending).resolves.toEqual(response);
    expect(runtimeWorkerHealthMocks.markRuntimeWorkerReady).toHaveBeenCalledWith(
      "special-core",
    );
  });

  it("matches concurrent responses by request id", async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const first = client.process({ imageData: createImageData(), sampledAt: 1_000 });
    const second = client.process({ imageData: createImageData(), sampledAt: 2_000 });
    const firstRequest = worker.postMessage.mock.calls[0][0];
    const secondRequest = worker.postMessage.mock.calls[1][0];

    worker.respond({
      requestId: secondRequest.requestId,
      ok: true,
      response: createResponse(2_000),
    });
    await expect(second).resolves.toEqual(createResponse(2_000));

    worker.respond({
      requestId: firstRequest.requestId,
      ok: true,
      response: createResponse(1_000),
    });
    await expect(first).resolves.toEqual(createResponse(1_000));
  });

  it("reports an unsupported Worker environment without creating one", async () => {
    const createWorker = vi.fn(() => null);
    const client = new SpecialCoreAlertWorkerClient({
      createWorker,
      isWorkerAvailable: () => false,
    });

    await expect(client.process({ imageData: createImageData() })).rejects.toThrow(
      "특수코어 감지는 Web Worker를 지원하는 브라우저에서만 사용할 수 있습니다.",
    );
    expect(createWorker).not.toHaveBeenCalled();
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "special-core",
        code: "worker-unsupported",
      }),
    );
  });

  it("reports Worker creation failure", async () => {
    const client = new SpecialCoreAlertWorkerClient({
      createWorker: () => null,
      isWorkerAvailable: () => true,
    });

    await expect(client.process({ imageData: createImageData() })).rejects.toThrow(
      "특수코어 감지 Worker를 시작하지 못했습니다.",
    );
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "special-core",
        code: "worker-create-failed",
      }),
    );
  });

  it("reports Worker postMessage failure", async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => {
      throw new Error("transfer-failed");
    });
    const client = createClient(worker);

    await expect(client.process({ imageData: createImageData() })).rejects.toThrow(
      "transfer-failed",
    );
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "special-core",
        code: "worker-post-failed",
      }),
    );
  });

  it("reports an error response from the Worker", async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const pending = client.process({ imageData: createImageData() });
    const request = worker.postMessage.mock.calls[0][0];

    worker.respond({
      requestId: request.requestId,
      ok: false,
      error: "matcher-failed",
    });

    await expect(pending).rejects.toThrow("matcher-failed");
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "special-core",
        code: "worker-response-failed",
      }),
    );
  });

  it("rejects pending work and terminates after a Worker runtime error", async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const pending = client.process({ imageData: createImageData() });

    worker.fail("worker-crashed");

    await expect(pending).rejects.toThrow("worker-crashed");
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "special-core",
        code: "worker-runtime-failed",
      }),
    );
  });

  it("rejects pending work when reset releases the Worker", async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const pending = client.process({ imageData: createImageData() });

    client.reset();

    await expect(pending).rejects.toThrow("특수코어 감지 Worker가 종료되었습니다.");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates and reports failure after the existing 15-second timeout", async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const pending = client.process({ imageData: createImageData() }).then(
      () => null,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(SPECIAL_CORE_ALERT_WORKER_TIMEOUT_MS - 1);
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("special-core-alert-worker-timeout");
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "special-core",
        code: "worker-timeout",
      }),
    );
  });
});

function createClient(worker: FakeWorker): SpecialCoreAlertWorkerClient {
  return new SpecialCoreAlertWorkerClient({
    createWorker: () => worker as unknown as Worker,
    isWorkerAvailable: () => true,
  });
}

function createImageData(): ImageData {
  return {
    width: 4,
    height: 4,
    data: new Uint8ClampedArray(4 * 4 * 4),
    colorSpace: "srgb",
  } as ImageData;
}

function createResponse(sampledAt: number): SpecialCoreSampleResponse {
  return {
    sampledAt,
    parserEngine: "dl",
    parserVersion: "test-parser",
    parserFallbackReason: null,
    parserRuntime: null,
    boxCount: 0,
    parsedBoxes: [],
    rowGroups: [],
    eligibleBoxIndexes: [],
    detectedCount: 0,
    detectedIcon: null,
    candidateIcons: [],
    performance: {
      totalMs: 4,
      detectMs: 3,
      matchMs: 0,
      boxCount: 0,
    },
    unsupported: false,
    unsupportedReason: null,
  };
}
