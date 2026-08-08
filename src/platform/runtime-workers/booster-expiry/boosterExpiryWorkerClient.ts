import type {
  BoosterExpiryWorkerPerformance,
  BoosterExpiryWorkerResult,
} from "../../../recognition/booster-expiry/boosterExpiryRecognitionContract";
import type {
  BoosterExpiryWorkerProcessRequest,
  BoosterExpiryWorkerResponse,
} from "./boosterExpiryWorkerTypes";
import {
  createRuntimeWorkerFailure,
  markRuntimeWorkerReady,
} from "../runtimeWorkerHealth";

const WORKER_TIMEOUT_MS = 1000;
const RUNTIME_WORKER_FEATURE = "booster-expiry";

export type BoosterExpiryWorkerClientResult = {
  result: BoosterExpiryWorkerResult;
  performance: BoosterExpiryWorkerPerformance;
};

export type BoosterExpiryWorkerClient = {
  reset: () => void;
  process: (imageData: ImageData, timestampMs: number) => Promise<BoosterExpiryWorkerClientResult>;
};

export function createBoosterExpiryWorkerClient(): BoosterExpiryWorkerClient {
  return new BrowserBoosterExpiryWorkerClient();
}

class BrowserBoosterExpiryWorkerClient implements BoosterExpiryWorkerClient {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private pending = new Map<
    number,
    {
      resolve: (response: BoosterExpiryWorkerClientResult) => void;
      reject: (error: Error) => void;
      timeoutId: number;
    }
  >();

  reset(): void {
    this.nextRequestId += 1;
    this.terminateWorker();
  }

  process(imageData: ImageData, timestampMs: number): Promise<BoosterExpiryWorkerClientResult> {
    if (typeof Worker === "undefined") {
      return Promise.reject(
        createRuntimeWorkerFailure({
          feature: RUNTIME_WORKER_FEATURE,
          code: "worker-unsupported",
          fallbackMessage:
            "부스터 종료 감지는 Web Worker를 지원하는 브라우저에서만 사용할 수 있습니다.",
        }),
      );
    }

    const worker = this.ensureWorker();
    if (!worker) {
      return Promise.reject(
        createRuntimeWorkerFailure({
          feature: RUNTIME_WORKER_FEATURE,
          code: "worker-create-failed",
          fallbackMessage: "부스터 종료 감지 Worker를 시작하지 못했습니다.",
        }),
      );
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const request: BoosterExpiryWorkerProcessRequest = {
      type: "process",
      id,
      imageData,
      timestampMs,
    };

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pending.delete(id);
        this.terminateWorker();
        reject(
          createRuntimeWorkerFailure({
            feature: RUNTIME_WORKER_FEATURE,
            code: "worker-timeout",
            fallbackMessage: "booster-expiry-worker-timeout",
          }),
        );
      }, WORKER_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeoutId });
      try {
        worker.postMessage(request, [request.imageData.data.buffer]);
      } catch (error) {
        window.clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(
          createRuntimeWorkerFailure({
            feature: RUNTIME_WORKER_FEATURE,
            code: "worker-post-failed",
            error,
            fallbackMessage: "booster-expiry-worker-post-failed",
          }),
        );
      }
    });
  }

  private ensureWorker(): Worker | null {
    if (this.worker) {
      return this.worker;
    }

    try {
      this.worker = new Worker(new URL("./boosterExpiry.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      this.worker = null;
      return null;
    }

    this.worker.onmessage = (event: MessageEvent<BoosterExpiryWorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) {
        return;
      }
      window.clearTimeout(pending.timeoutId);
      this.pending.delete(response.id);
      if (response.type === "processed") {
        markRuntimeWorkerReady(RUNTIME_WORKER_FEATURE);
        pending.resolve({
          result: response.result,
          performance: response.performance,
        });
        return;
      }
      if (response.type === "error") {
        pending.reject(
          createRuntimeWorkerFailure({
            feature: RUNTIME_WORKER_FEATURE,
            code: "worker-response-failed",
            error: response.message,
            fallbackMessage: "booster-expiry-worker-response-failed",
          }),
        );
      }
    };
    this.worker.onerror = (event) => {
      const error = createRuntimeWorkerFailure({
        feature: RUNTIME_WORKER_FEATURE,
        code: "worker-runtime-failed",
        error: event.message,
        fallbackMessage: "booster-expiry-worker-error",
      });
      for (const [id, pending] of this.pending) {
        window.clearTimeout(pending.timeoutId);
        pending.reject(error);
        this.pending.delete(id);
      }
      this.terminateWorker();
    };

    return this.worker;
  }

  private terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [id, pending] of this.pending) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(new Error("booster-expiry-worker-reset"));
      this.pending.delete(id);
    }
  }
}
