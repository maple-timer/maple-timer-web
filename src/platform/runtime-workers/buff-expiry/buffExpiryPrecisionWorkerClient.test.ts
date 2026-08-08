import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BuffExpiryPrecisionSampleResponse,
  BuffExpiryPrecisionTargetGroup,
} from "../../../runtime/buff-expiry/analysis/buffExpiryPrecisionAnalysisRuntime";
import {
  BUFF_EXPIRY_PRECISION_WORKER_PRELOAD_TIMEOUT_MS,
  BUFF_EXPIRY_PRECISION_WORKER_PROCESS_TIMEOUT_MS,
  BuffExpiryPrecisionWorkerClient,
} from "./buffExpiryPrecisionWorkerClient";
import type {
  BuffExpiryPrecisionWorkerPreloadRequest,
  BuffExpiryPrecisionWorkerPreloadResponse,
  BuffExpiryPrecisionWorkerRequest,
  BuffExpiryPrecisionWorkerResponse,
} from "./buffExpiryPrecisionWorkerTypes";

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
  onmessage: ((event: MessageEvent<BuffExpiryPrecisionWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn<
    (request: BuffExpiryPrecisionWorkerRequest, transfer?: Transferable[]) => void
  >();
  terminate = vi.fn();

  respond(response: BuffExpiryPrecisionWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<BuffExpiryPrecisionWorkerResponse>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

describe("BuffExpiryPrecisionWorkerClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("transfers one sampled image buffer and normalizes selected groups", async () => {
    const worker = new FakeWorker();
    const client = createClient([worker]);
    const imageData = createImageData();
    const pending = client.process({
      imageData,
      sampledAt: 12_345,
      activeGroups: ["potion", "potion"],
    });
    const request = worker.postMessage.mock.calls[0][0];

    expect(request).toMatchObject({
      type: "process",
      requestId: 1,
      imageData,
      sampledAt: 12_345,
      activeGroups: ["potion"],
    });
    expect(worker.postMessage.mock.calls[0][1]).toEqual([imageData.data.buffer]);

    const response = createSampleResponse();
    worker.respond({
      requestId: request.requestId,
      ok: true,
      response: {
        ...response,
        requestId: request.requestId,
      },
    });

    await expect(pending).resolves.toMatchObject(response);
    expect(runtimeWorkerHealthMocks.markRuntimeWorkerReady).toHaveBeenCalledWith(
      "buff-expiry",
    );
  });

  it("matches concurrent process responses by request id", async () => {
    const worker = new FakeWorker();
    const client = createClient([worker]);
    const first = client.process({ imageData: createImageData(), sampledAt: 1_000 });
    const second = client.process({ imageData: createImageData(), sampledAt: 2_000 });
    const firstRequest = worker.postMessage.mock.calls[0][0];
    const secondRequest = worker.postMessage.mock.calls[1][0];

    worker.respond({
      requestId: secondRequest.requestId,
      ok: true,
      response: {
        ...createSampleResponse(),
        requestId: secondRequest.requestId,
      },
    });
    await expect(second).resolves.toMatchObject({ requestId: secondRequest.requestId });

    worker.respond({
      requestId: firstRequest.requestId,
      ok: true,
      response: {
        ...createSampleResponse(),
        requestId: firstRequest.requestId,
      },
    });
    await expect(first).resolves.toMatchObject({ requestId: firstRequest.requestId });
  });

  it("reuses the Worker for the same group order and replaces it when groups change", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const client = createClient([firstWorker, secondWorker]);

    const first = client.preload(["potion"]);
    respondToPreload(firstWorker);
    await first;

    const same = client.preload(["potion"]);
    respondToPreload(firstWorker);
    await same;
    expect(firstWorker.terminate).not.toHaveBeenCalled();

    const changed = client.preload(["unionLuck"]);
    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    expect(secondWorker.postMessage.mock.calls[0][0]).toMatchObject({
      type: "preload",
      activeGroups: ["unionLuck"],
    });
    respondToPreload(secondWorker);
    await changed;
  });

  it("rejects pending work when a changed group configuration replaces the Worker", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const client = createClient([firstWorker, secondWorker]);
    const pending = client.preload(["potion"]);
    const rejection = pending.then(
      () => null,
      (error: unknown) => error,
    );

    const replacement = client.preload(["unionLuck"]);
    const error = await rejection;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("버프 종료 정밀 감지 Worker가 종료되었습니다.");
    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    respondToPreload(secondWorker);
    await replacement;
  });

  it("reports an unsupported Worker environment without creating one", async () => {
    const createWorker = vi.fn(() => null);
    const client = new BuffExpiryPrecisionWorkerClient({
      createWorker,
      isWorkerAvailable: () => false,
    });

    await expect(client.preload()).rejects.toThrow(
      "버프 종료 정밀 감지는 Web Worker를 지원하는 브라우저에서만 사용할 수 있습니다.",
    );
    expect(createWorker).not.toHaveBeenCalled();
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "buff-expiry",
        code: "worker-unsupported",
      }),
    );
  });

  it("reports Worker creation failure", async () => {
    const client = new BuffExpiryPrecisionWorkerClient({
      createWorker: () => null,
      isWorkerAvailable: () => true,
    });

    await expect(client.preload()).rejects.toThrow(
      "버프 종료 정밀 감지 Worker를 시작하지 못했습니다.",
    );
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "buff-expiry",
        code: "worker-create-failed",
      }),
    );
  });

  it("reports Worker postMessage failure", async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => {
      throw new Error("transfer-failed");
    });
    const client = createClient([worker]);

    await expect(client.process({ imageData: createImageData() })).rejects.toThrow(
      "transfer-failed",
    );
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "buff-expiry",
        code: "worker-post-failed",
      }),
    );
  });

  it("reports an error response from the Worker", async () => {
    const worker = new FakeWorker();
    const client = createClient([worker]);
    const pending = client.preload(["potion"]);
    const request = worker.postMessage.mock.calls[0][0];

    worker.respond({
      requestId: request.requestId,
      ok: false,
      error: "matcher-failed",
    });

    await expect(pending).rejects.toThrow("matcher-failed");
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "buff-expiry",
        code: "worker-response-failed",
      }),
    );
  });

  it("rejects pending work and terminates after a Worker runtime error", async () => {
    const worker = new FakeWorker();
    const client = createClient([worker]);
    const pending = client.preload(["potion"]);

    worker.fail("worker-crashed");

    await expect(pending).rejects.toThrow("worker-crashed");
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "buff-expiry",
        code: "worker-runtime-failed",
      }),
    );
  });

  it("rejects pending work when reset releases the Worker", async () => {
    const worker = new FakeWorker();
    const client = createClient([worker]);
    const pending = client.preload(["potion"]);

    client.reset();

    await expect(pending).rejects.toThrow(
      "버프 종료 정밀 감지 Worker가 종료되었습니다.",
    );
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("keeps the existing five-second process timeout", async () => {
    const worker = new FakeWorker();
    const client = createClient([worker]);
    const pending = client.process({ imageData: createImageData() }).then(
      () => null,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(
      BUFF_EXPIRY_PRECISION_WORKER_PROCESS_TIMEOUT_MS - 1,
    );
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("buff-expiry-precision-worker-timeout");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("keeps the existing thirty-second preload timeout", async () => {
    const worker = new FakeWorker();
    const client = createClient([worker]);
    const pending = client.preload(["potion"]).then(
      () => null,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(
      BUFF_EXPIRY_PRECISION_WORKER_PRELOAD_TIMEOUT_MS - 1,
    );
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("buff-expiry-precision-worker-timeout");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});

function createClient(workers: FakeWorker[]): BuffExpiryPrecisionWorkerClient {
  let workerIndex = 0;
  return new BuffExpiryPrecisionWorkerClient({
    createWorker: () => workers[workerIndex++] as unknown as Worker,
    isWorkerAvailable: () => true,
  });
}

function respondToPreload(worker: FakeWorker): void {
  const calls = worker.postMessage.mock.calls;
  const request = calls[calls.length - 1]?.[0];
  if (!request || request.type !== "preload") {
    throw new Error("missing-preload-request");
  }
  worker.respond({
    requestId: request.requestId,
    ok: true,
    response: createPreloadResponse(request),
  });
}

function createPreloadResponse(
  request: BuffExpiryPrecisionWorkerPreloadRequest,
): BuffExpiryPrecisionWorkerPreloadResponse {
  return {
    countdownModelStatus: "ready",
    matcherModelStatus: "ready",
    matcherBundleStatuses: request.activeGroups?.map((group: BuffExpiryPrecisionTargetGroup) => ({
      group,
      bundleId: "test-" + group,
      modelVersion: "test-" + group,
      status: "ready",
      error: null,
    })) ?? [],
    moduleVersions: {
      runtime: "test",
      parser: "test",
      matcher: "test",
      matcherModel: "test",
      countdown: "test",
    },
  };
}

function createImageData(): ImageData {
  return {
    width: 4,
    height: 4,
    data: new Uint8ClampedArray(4 * 4 * 4),
    colorSpace: "srgb",
  } as ImageData;
}

function createSampleResponse(): BuffExpiryPrecisionSampleResponse {
  return {
    boxes: [],
    icons: [],
    iconObservations: [],
    bestByGroup: [],
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
      totalMs: 4,
      detectMs: 3,
      boxCount: 0,
    },
  };
}
