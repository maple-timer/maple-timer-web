import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRuneDetectionWorkerClient,
  RUNE_DETECTION_WORKER_TIMEOUT_MS,
  RUNE_DETECTION_WORKER_WARMUP_TIMEOUT_MS,
} from "./runeDetectionWorkerClient";
import {
  RUNE_ONNX_MODEL_VERSION,
  RUNE_ONNX_THRESHOLD,
} from "../../../recognition/rune/runeOnnxContract";
import type {
  RuneDetectionWorkerRequest,
  RuneDetectionWorkerResponse,
} from "../../../recognition/rune/runeDetectionWorkerTypes";

class FakeWorker {
  onmessage: ((event: MessageEvent<RuneDetectionWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn<(request: RuneDetectionWorkerRequest) => void>();
  terminate = vi.fn();

  respond(response: RuneDetectionWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<RuneDetectionWorkerResponse>);
  }
}

let workers: FakeWorker[];

describe("runeDetectionWorkerClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
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

  it("allows model warm-up once, then uses the short inference timeout", async () => {
    const client = createRuneDetectionWorkerClient();
    const first = client.detect(createImageData());
    const firstRequest = workers[0].postMessage.mock.calls[0][0];

    await vi.advanceTimersByTimeAsync(RUNE_DETECTION_WORKER_TIMEOUT_MS);
    expect(workers[0].terminate).not.toHaveBeenCalled();
    workers[0].respond({
      type: "detected",
      id: firstRequest.id,
      result: createDetectionResult(),
    });
    await expect(first).resolves.toMatchObject({ detected: false });

    const second = client.detect(createImageData()).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(RUNE_DETECTION_WORKER_TIMEOUT_MS);
    const secondError = await second;
    expect(secondError).toBeInstanceOf(Error);
    expect((secondError as Error).message).toBe("rune-detection-worker-timeout");
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });

  it("terminates a first request only after the warm-up timeout", async () => {
    const client = createRuneDetectionWorkerClient();
    const pending = client.detect(createImageData()).then(
      () => null,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(RUNE_DETECTION_WORKER_WARMUP_TIMEOUT_MS - 1);
    expect(workers[0].terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("rune-detection-worker-timeout");
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });

  it("rejects pending work when reset releases the worker", async () => {
    const client = createRuneDetectionWorkerClient();
    const pending = client.detect(createImageData()).then(
      () => null,
      (error: unknown) => error,
    );

    client.reset();

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("rune-detection-worker-reset");
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
});

function createImageData(): ImageData {
  return new ImageData(new Uint8ClampedArray(4 * 4 * 4), 4, 4);
}

function createDetectionResult() {
  return {
    detected: false,
    confidence: 0.1,
    candidates: [],
    debug: {
      classifier: RUNE_ONNX_MODEL_VERSION,
      detectorKind: "onnx-full-frame" as const,
      modelScore: 0.1,
      modelThreshold: RUNE_ONNX_THRESHOLD,
    },
  };
}
