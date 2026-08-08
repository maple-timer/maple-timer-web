import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SKILL_PRECISION_WORKER_TIMEOUT_MS,
  SkillPrecisionWorkerClient,
} from "./skillPrecisionWorkerClient";
import type {
  SkillBuffDurationWorkerProcessResponse,
  SkillBuffDurationWorkerRequest,
  SkillBuffDurationWorkerResponse,
} from "./skillPrecisionWorkerTypes";

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
  onmessage: ((event: MessageEvent<SkillBuffDurationWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn<
    (request: SkillBuffDurationWorkerRequest, transfer?: Transferable[]) => void
  >();
  terminate = vi.fn();

  respond(response: SkillBuffDurationWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<SkillBuffDurationWorkerResponse>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

describe("SkillPrecisionWorkerClient", () => {
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
    const targets = [
      {
        skillId: "janusDeepV2",
        detectorId: "skill-deep-v2:janus",
        matcherEngine: "skill-bundle-v1" as const,
        matcherSkillId: "janus",
        maxBuffRowIndex: 1,
        valueKind: "countdown" as const,
      },
    ];
    const pending = client.process({
      imageData,
      sampledAt: 12_345,
      buffSlotAnalysis,
      buffSlotInputMode: "topRightQuadrant",
      targets,
    });
    const request = worker.postMessage.mock.calls[0][0];

    expect(request).toMatchObject({
      type: "process",
      requestId: 1,
      imageData,
      sampledAt: 12_345,
      buffSlotAnalysis,
      buffSlotInputMode: "topRightQuadrant",
      targets,
    });
    expect(worker.postMessage.mock.calls[0][1]).toEqual([imageData.data.buffer]);

    const response = createResponse(12_345, request.requestId);
    worker.respond({
      requestId: request.requestId,
      ok: true,
      response,
    });

    await expect(pending).resolves.toEqual(response);
    expect(runtimeWorkerHealthMocks.markRuntimeWorkerReady).toHaveBeenCalledWith(
      "skill-buff-duration",
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
      response: createResponse(2_000, secondRequest.requestId),
    });
    await expect(second).resolves.toEqual(createResponse(2_000, secondRequest.requestId));

    worker.respond({
      requestId: firstRequest.requestId,
      ok: true,
      response: createResponse(1_000, firstRequest.requestId),
    });
    await expect(first).resolves.toEqual(createResponse(1_000, firstRequest.requestId));
  });

  it("reports an unsupported Worker environment without creating one", async () => {
    const createWorker = vi.fn(() => null);
    const client = new SkillPrecisionWorkerClient({
      createWorker,
      isWorkerAvailable: () => false,
    });

    await expect(client.process({ imageData: createImageData() })).rejects.toThrow(
      "스킬 버프칸 감지는 Web Worker를 지원하는 브라우저에서만 사용할 수 있습니다.",
    );
    expect(createWorker).not.toHaveBeenCalled();
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "skill-buff-duration",
        code: "worker-unsupported",
      }),
    );
  });

  it("reports Worker creation failure", async () => {
    const client = new SkillPrecisionWorkerClient({
      createWorker: () => null,
      isWorkerAvailable: () => true,
    });

    await expect(client.process({ imageData: createImageData() })).rejects.toThrow(
      "스킬 버프칸 감지 Worker를 시작하지 못했습니다.",
    );
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "skill-buff-duration",
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
        feature: "skill-buff-duration",
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
        feature: "skill-buff-duration",
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
        feature: "skill-buff-duration",
        code: "worker-runtime-failed",
      }),
    );
  });

  it("rejects pending work when reset releases the Worker", async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const pending = client.process({ imageData: createImageData() });

    client.reset();

    await expect(pending).rejects.toThrow("스킬 버프칸 감지 Worker가 종료되었습니다.");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates and reports failure after the existing 15-second timeout", async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const pending = client.process({ imageData: createImageData() }).then(
      () => null,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(SKILL_PRECISION_WORKER_TIMEOUT_MS - 1);
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("skill-buff-duration-worker-timeout");
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(runtimeWorkerHealthMocks.createRuntimeWorkerFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "skill-buff-duration",
        code: "worker-timeout",
      }),
    );
  });
});

function createClient(worker: FakeWorker): SkillPrecisionWorkerClient {
  return new SkillPrecisionWorkerClient({
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

function createResponse(
  sampledAt: number,
  requestId: number,
): SkillBuffDurationWorkerProcessResponse {
  return {
    requestId,
    sampledAt,
    boxCount: 0,
    parserRowCount: 0,
    parserEngine: "dl",
    parserVersion: "test-parser",
    parserFallbackReason: null,
    detectedCount: 0,
    detectedIcon: null,
    candidateIcons: [],
    detectionsBySkillId: {},
    performance: {
      totalMs: 4,
      detectMs: 3,
      matchMs: 0,
      countdownMs: 0,
      countdownCount: 0,
      countdownModelStatus: "idle",
      remainingCountMs: 0,
      remainingCountCount: 0,
      remainingCountModelStatus: "idle",
      boxCount: 0,
    },
    unsupported: false,
    unsupportedReason: null,
  };
}
