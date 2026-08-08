import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGeneralTimerTickerWorkerClient } from "./generalTimerTickerWorkerClient";
import type {
  GeneralTimerTickerRequest,
  GeneralTimerTickerResponse,
} from "./generalTimerTickerWorkerTypes";

const runtimeWorkerHealthMocks = vi.hoisted(() => ({
  createRuntimeWorkerFailure: vi.fn(
    ({ error, fallbackMessage }: { error?: unknown; fallbackMessage: string }) =>
      error instanceof Error ? error : new Error(fallbackMessage),
  ),
  markRuntimeWorkerReady: vi.fn(),
}));

vi.mock("../runtimeWorkerHealth", () => runtimeWorkerHealthMocks);

class FakeWorker {
  onmessage: ((event: MessageEvent<GeneralTimerTickerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn<(request: GeneralTimerTickerRequest) => void>();
  terminate = vi.fn();

  tick(now: number): void {
    this.onmessage?.({ data: { type: "tick", now } } as MessageEvent<GeneralTimerTickerResponse>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

let workers: FakeWorker[];

describe("generalTimerTickerWorkerClient", () => {
  beforeEach(() => {
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
    vi.unstubAllGlobals();
  });

  it("starts lazily, forwards ticks, and releases the worker on stop", () => {
    const onTick = vi.fn();
    const client = createGeneralTimerTickerWorkerClient();

    expect(client.start({ intervalMs: 250, onTick, onUnavailable: vi.fn() })).toBe(true);
    expect(workers).toHaveLength(1);
    expect(workers[0].postMessage).toHaveBeenCalledWith({ type: "start", intervalMs: 250 });

    workers[0].tick(12_345);
    expect(onTick).toHaveBeenCalledWith(12_345);
    expect(runtimeWorkerHealthMocks.markRuntimeWorkerReady).toHaveBeenCalledWith(
      "general-timer",
    );

    client.stop();
    expect(workers[0].postMessage).toHaveBeenLastCalledWith({ type: "stop" });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });

  it("reports a runtime failure and asks the feature to use its fallback", () => {
    const onUnavailable = vi.fn();
    const client = createGeneralTimerTickerWorkerClient();
    client.start({ intervalMs: 250, onTick: vi.fn(), onUnavailable });

    workers[0].fail("ticker failed");

    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "general-timer",
        code: "worker-runtime-failed",
        error: "ticker failed",
      }),
    );
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(onUnavailable).toHaveBeenCalledOnce();
  });

  it("returns false and releases a worker that rejects the start message", () => {
    const client = createGeneralTimerTickerWorkerClient();
    const postError = new Error("post failed");
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          const worker = new FakeWorker();
          worker.postMessage.mockImplementationOnce(() => {
            throw postError;
          });
          workers.push(worker);
          return worker;
        }
      },
    );

    expect(
      client.start({ intervalMs: 250, onTick: vi.fn(), onUnavailable: vi.fn() }),
    ).toBe(false);
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "general-timer",
        code: "worker-post-failed",
        error: postError,
      }),
    );
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });

  it("returns false without reporting when Web Workers are unsupported", () => {
    vi.stubGlobal("Worker", undefined);
    const client = createGeneralTimerTickerWorkerClient();

    expect(
      client.start({ intervalMs: 250, onTick: vi.fn(), onUnavailable: vi.fn() }),
    ).toBe(false);
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).not.toHaveBeenCalled();
  });

  it("reports creation failures before falling back", () => {
    const createError = new Error("create failed");
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw createError;
        }
      },
    );
    const client = createGeneralTimerTickerWorkerClient();

    expect(
      client.start({ intervalMs: 250, onTick: vi.fn(), onUnavailable: vi.fn() }),
    ).toBe(false);
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "general-timer",
        code: "worker-create-failed",
        error: createError,
      }),
    );
  });
});
