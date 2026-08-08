import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBoosterExpiryWorkerClient,
  type BoosterExpiryWorkerClientResult,
} from "./boosterExpiryWorkerClient";
import type {
  BoosterExpiryWorkerRequest,
  BoosterExpiryWorkerResponse,
} from "./boosterExpiryWorkerTypes";

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
  onmessage: ((event: MessageEvent<BoosterExpiryWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn<
    (request: BoosterExpiryWorkerRequest, transfer?: Transferable[]) => void
  >();
  terminate = vi.fn();

  respond(response: BoosterExpiryWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<BoosterExpiryWorkerResponse>);
  }
}

let workers: FakeWorker[];

describe("boosterExpiryWorkerClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    workers = [];
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          const worker = new FakeWorker();
          workers.push(worker);
          return worker;
        }
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("transfers the frame and resolves the matching worker response", async () => {
    const client = createBoosterExpiryWorkerClient();
    const imageData = createImageData();
    const pending = client.process(imageData, 12_345);
    const request = workers[0].postMessage.mock.calls[0][0];

    expect(request).toMatchObject({
      type: "process",
      id: 1,
      imageData,
      timestampMs: 12_345,
    });
    expect(workers[0].postMessage.mock.calls[0][1]).toEqual([
      imageData.data.buffer,
    ]);

    const response = createWorkerResult();
    workers[0].respond({
      type: "processed",
      id: request.id,
      ...response,
    });

    await expect(pending).resolves.toEqual(response);
    expect(runtimeWorkerHealthMocks.markRuntimeWorkerReady).toHaveBeenCalledWith(
      "booster-expiry",
    );
  });

  it("terminates the worker and reports a failure after the fixed timeout", async () => {
    const client = createBoosterExpiryWorkerClient();
    const pending = client.process(createImageData(), 12_345).then(
      () => null,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(999);
    expect(workers[0].terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("booster-expiry-worker-timeout");
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "booster-expiry",
        code: "worker-timeout",
      }),
    );
  });

  it("rejects pending work when reset releases the worker", async () => {
    const client = createBoosterExpiryWorkerClient();
    const pending = client.process(createImageData(), 12_345).then(
      () => null,
      (error: unknown) => error,
    );

    client.reset();

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("booster-expiry-worker-reset");
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
});

function createImageData(): ImageData {
  return new ImageData(new Uint8ClampedArray(4 * 4 * 4), 4, 4);
}

function createWorkerResult(): BoosterExpiryWorkerClientResult {
  return {
    result: {
      recognizerVersion: "booster-test",
      rawTime: null,
      time: null,
      timeRect: {
        ok: false,
        reason: "not-found",
        rect: null,
        matchCount: 0,
        candidateCount: 0,
      },
      flow: {
        locked: false,
        source: "none",
        predictedSeconds: null,
        rawDeltaSeconds: null,
        timestampMs: 12_345,
      },
    },
    performance: {
      recognitionMs: 2.5,
      totalMs: 3,
    },
  };
}
