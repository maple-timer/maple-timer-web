import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPrecisionParserDiagnosticEvent,
  getPrecisionParserDiagnosticEvent,
  type PrecisionParserDiagnosticEvent,
} from "../../../contracts/recognition/precisionParserDiagnostics";
import {
  BuffSlotAnalysisSampleDroppedError,
  type BuffSlotAnalysisSampleResponse,
} from "../../../runtime/buff-slot/analysis/buffSlotAnalysisRuntime";
import {
  BUFF_SLOT_ANALYSIS_WORKER_RESPONSE_GRACE_MS,
  BUFF_SLOT_ANALYSIS_WORKER_STARTUP_TIMEOUT_MS,
  BUFF_SLOT_ANALYSIS_WORKER_TIMEOUT_MS,
  BuffSlotAnalysisWorkerClient,
} from "./buffSlotAnalysisWorkerClient";
import type {
  BuffSlotAnalysisWorkerRequest,
  BuffSlotAnalysisWorkerResponse,
} from "./buffSlotAnalysisWorkerTypes";

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
  onmessage: ((event: MessageEvent<BuffSlotAnalysisWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn<
    (request: BuffSlotAnalysisWorkerRequest, transfer?: Transferable[]) => void
  >();
  terminate = vi.fn();

  respond(response: BuffSlotAnalysisWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<BuffSlotAnalysisWorkerResponse>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

describe("BuffSlotAnalysisWorkerClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("transfers the parser input and resolves the matching response", async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const imageData = createImageData();
    const pending = client.process({
      imageData,
      sampledAt: 12_345,
      buffSlotInputMode: "topRightQuadrant",
    });
    const request = worker.postMessage.mock.calls[0][0];

    expect(request).toMatchObject({
      type: "process",
      requestId: 1,
      imageData,
      sampledAt: 12_345,
      buffSlotInputMode: "topRightQuadrant",
    });
    expect(worker.postMessage.mock.calls[0][1]).toEqual([imageData.data.buffer]);

    const response = createResponse(12_345);
    worker.respond({
      type: "process",
      requestId: request.requestId,
      ok: true,
      response,
    });

    await expect(pending).resolves.toMatchObject(response);
    expect(runtimeWorkerHealthMocks.markRuntimeWorkerReady).toHaveBeenCalledWith(
      "buff-slot-analysis",
    );
  });

  it("runs one parser request at a time and starts the queued sample next", async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const first = client.process({ imageData: createImageData(), sampledAt: 1_000 });
    const second = client.process({ imageData: createImageData(), sampledAt: 2_000 });
    const firstRequest = worker.postMessage.mock.calls[0][0];
    expect(worker.postMessage).toHaveBeenCalledTimes(1);

    worker.respond({
      type: "process",
      requestId: firstRequest.requestId,
      ok: true,
      response: createResponse(1_000),
    });
    await expect(first).resolves.toMatchObject(createResponse(1_000));

    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    const secondRequest = worker.postMessage.mock.calls[1][0];
    worker.respond({
      type: "process",
      requestId: secondRequest.requestId,
      ok: true,
      response: createResponse(2_000),
    });
    await expect(second).resolves.toMatchObject({
      ...createResponse(2_000),
      performance: {
        ...createResponse(2_000).performance,
        droppedSampleCount: 0,
        sampleIntervalMs: 1_000,
      },
    });
  });

  it("drops an older queued sample instead of building a parser backlog", async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const first = client.process({ imageData: createImageData(), sampledAt: 1_000 });
    const second = client.process({ imageData: createImageData(), sampledAt: 2_000 });
    const third = client.process({ imageData: createImageData(), sampledAt: 3_000 });
    const firstRequest = worker.postMessage.mock.calls[0][0];

    await expect(second).rejects.toBeInstanceOf(BuffSlotAnalysisSampleDroppedError);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);

    worker.respond({
      type: "process",
      requestId: firstRequest.requestId,
      ok: true,
      response: createResponse(1_000),
    });
    await expect(first).resolves.toMatchObject(createResponse(1_000));

    const thirdRequest = worker.postMessage.mock.calls[1][0];
    expect(thirdRequest.sampledAt).toBe(3_000);
    worker.respond({
      type: "process",
      requestId: thirdRequest.requestId,
      ok: true,
      response: createResponse(3_000),
    });
    await expect(third).resolves.toMatchObject({
      performance: {
        droppedSampleCount: 1,
        sampleIntervalMs: 2_000,
      },
    });
  });

  it("reports an unsupported Worker environment without creating one", async () => {
    const createWorker = vi.fn(() => null);
    const client = new BuffSlotAnalysisWorkerClient({
      createWorker,
      isWorkerAvailable: () => false,
    });

    await expect(client.process({ imageData: createImageData() })).rejects.toThrow(
      "버프칸 분석은 Web Worker를 지원하는 브라우저에서만 사용할 수 있습니다.",
    );
    expect(createWorker).not.toHaveBeenCalled();
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "buff-slot-analysis",
        code: "worker-unsupported",
      }),
    );
  });

  it("reports Worker creation failure", async () => {
    const client = new BuffSlotAnalysisWorkerClient({
      createWorker: () => null,
      isWorkerAvailable: () => true,
    });

    await expect(client.process({ imageData: createImageData() })).rejects.toThrow(
      "버프칸 분석 Worker를 시작하지 못했습니다.",
    );
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "buff-slot-analysis",
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
        feature: "buff-slot-analysis",
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
      type: "process",
      requestId: request.requestId,
      ok: false,
      error: {
        message: "parser-failed",
        diagnostic: null,
      },
    });

    await expect(pending).rejects.toThrow("parser-failed");
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "buff-slot-analysis",
        code: "worker-response-failed",
      }),
    );
  });

  it("forwards staged diagnostics and preserves the failed stage on rejection", async () => {
    const worker = new FakeWorker();
    const onDiagnostic = vi.fn();
    const client = new BuffSlotAnalysisWorkerClient({
      createWorker: () => worker as unknown as Worker,
      isWorkerAvailable: () => true,
      onDiagnostic,
    });
    const pending = client.process({ imageData: createImageData() }).then(
      () => null,
      (error: unknown) => error,
    );
    const request = worker.postMessage.mock.calls[0][0];
    const diagnostic = createPrecisionParserDiagnosticEvent({
      stage: "gpu-adapter",
      status: "failed",
      code: "gpu-adapter-unavailable",
      technicalMessage: "requestAdapter returned null",
    });

    worker.respond({
      type: "diagnostic",
      requestId: request.requestId,
      diagnostic,
    });
    worker.respond({
      type: "process",
      requestId: request.requestId,
      ok: false,
      error: {
        message: "requestAdapter returned null",
        diagnostic,
      },
    });

    const error = await pending;
    expect(onDiagnostic.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({
        stage: "analysis-worker",
        status: "checking",
      }),
      expect.objectContaining({
        stage: "analysis-worker",
        status: "passed",
      }),
      expect.objectContaining({
        ...diagnostic,
        details: expect.objectContaining({
          requestElapsedMs: 0,
          visibilityState: "visible",
        }),
      }),
    ]);
    expect(getPrecisionParserDiagnosticEvent(error)).toEqual(diagnostic);
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
        feature: "buff-slot-analysis",
        code: "worker-runtime-failed",
      }),
    );
  });

  it("rejects pending work when reset releases the Worker", async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const pending = client.process({ imageData: createImageData() });

    client.reset();

    await expect(pending).rejects.toThrow("버프칸 분석 Worker가 종료되었습니다.");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("uses the longer startup timeout before the first successful response", async () => {
    const worker = new FakeWorker();
    const onDiagnostic = vi.fn();
    const client = createClient(worker, onDiagnostic);
    const pending = client.process({ imageData: createImageData() }).then(
      () => null,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(
      BUFF_SLOT_ANALYSIS_WORKER_STARTUP_TIMEOUT_MS - 1,
    );
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("buff-slot-analysis-worker-timeout");
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "buff-slot-analysis",
        code: "worker-timeout",
      }),
    );
    expect(onDiagnostic).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: "analysis-worker",
        status: "failed",
        details: expect.objectContaining({
          timeoutMs: BUFF_SLOT_ANALYSIS_WORKER_STARTUP_TIMEOUT_MS,
          timeoutPhase: "startup-idle",
          requestMode: "startup",
          progressCount: 0,
          lastProgressStage: null,
        }),
      }),
    );
  });

  it("refreshes the startup watchdog when diagnostic progress arrives", async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const pending = client.process({ imageData: createImageData(), sampledAt: 4_000 });
    const request = worker.postMessage.mock.calls[0][0];

    await vi.advanceTimersByTimeAsync(
      BUFF_SLOT_ANALYSIS_WORKER_STARTUP_TIMEOUT_MS - 1,
    );
    worker.respond({
      type: "diagnostic",
      requestId: request.requestId,
      diagnostic: createPrecisionParserDiagnosticEvent({
        stage: "model-session",
        status: "passed",
      }),
    });
    await vi.advanceTimersByTimeAsync(
      BUFF_SLOT_ANALYSIS_WORKER_STARTUP_TIMEOUT_MS - 1,
    );
    expect(worker.terminate).not.toHaveBeenCalled();

    worker.respond({
      type: "diagnostic",
      requestId: request.requestId,
      diagnostic: createPrecisionParserDiagnosticEvent({
        stage: "first-inference",
        status: "passed",
        details: { boxCount: 14 },
      }),
    });
    await vi.advanceTimersByTimeAsync(
      BUFF_SLOT_ANALYSIS_WORKER_RESPONSE_GRACE_MS - 1,
    );
    expect(worker.terminate).not.toHaveBeenCalled();

    worker.respond({
      type: "process",
      requestId: request.requestId,
      ok: true,
      response: createResponse(4_000),
    });

    await expect(pending).resolves.toMatchObject(createResponse(4_000));
  });

  it("reports the last progress stage when the final response does not arrive", async () => {
    const worker = new FakeWorker();
    const onDiagnostic = vi.fn();
    const client = createClient(worker, onDiagnostic);
    const pending = client.process({ imageData: createImageData() }).then(
      () => null,
      (error: unknown) => error,
    );
    const request = worker.postMessage.mock.calls[0][0];

    worker.respond({
      type: "diagnostic",
      requestId: request.requestId,
      diagnostic: createPrecisionParserDiagnosticEvent({
        stage: "first-inference",
        status: "passed",
        details: { boxCount: 14 },
      }),
    });
    await vi.advanceTimersByTimeAsync(BUFF_SLOT_ANALYSIS_WORKER_RESPONSE_GRACE_MS);

    await expect(pending).resolves.toBeInstanceOf(Error);
    expect(onDiagnostic).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: "analysis-worker",
        status: "failed",
        details: expect.objectContaining({
          timeoutMs: BUFF_SLOT_ANALYSIS_WORKER_RESPONSE_GRACE_MS,
          timeoutPhase: "final-response",
          progressCount: 1,
          lastProgressStage: "first-inference",
          lastProgressStatus: "passed",
        }),
      }),
    );
  });

  it("keeps the existing 15-second timeout for warm inference", async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const warmup = client.process({ imageData: createImageData(), sampledAt: 1_000 });
    const warmupRequest = worker.postMessage.mock.calls[0][0];
    worker.respond({
      type: "process",
      requestId: warmupRequest.requestId,
      ok: true,
      response: createResponse(1_000),
    });
    await expect(warmup).resolves.toMatchObject(createResponse(1_000));

    const pending = client.process({ imageData: createImageData(), sampledAt: 2_000 }).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(BUFF_SLOT_ANALYSIS_WORKER_TIMEOUT_MS - 1);
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toBeInstanceOf(Error);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});

function createClient(
  worker: FakeWorker,
  onDiagnostic?: (event: PrecisionParserDiagnosticEvent) => void,
): BuffSlotAnalysisWorkerClient {
  return new BuffSlotAnalysisWorkerClient({
    createWorker: () => worker as unknown as Worker,
    isWorkerAvailable: () => true,
    onDiagnostic,
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

function createResponse(sampledAt: number): BuffSlotAnalysisSampleResponse {
  return {
    sampledAt,
    analysis: {
      icons: [],
      boxes: [],
      engine: "dl",
      parserVersion: "test-parser",
    },
    performance: {
      totalMs: 4,
      detectMs: 3.5,
      boxCount: 0,
    },
    unsupported: false,
    unsupportedReason: null,
  };
}
