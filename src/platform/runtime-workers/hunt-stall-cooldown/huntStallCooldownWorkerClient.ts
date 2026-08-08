import type {
  HuntStallCooldownWorkerPerformance,
  HuntStallCooldownWorkerProcessRequest,
  HuntStallCooldownWorkerProcessResponse,
  HuntStallCooldownWorkerResponse,
} from "./huntStallCooldownWorkerTypes";
import {
  createRuntimeWorkerFailure,
  markRuntimeWorkerReady,
} from "../runtimeWorkerHealth";

const WORKER_TIMEOUT_MS = 1000;
const RUNTIME_WORKER_FEATURE = "hunt-stall-cooldown";

export type HuntStallCooldownWorkerResult = {
  result: HuntStallCooldownWorkerProcessResponse["result"];
  activity: HuntStallCooldownWorkerProcessResponse["activity"];
  performance: HuntStallCooldownWorkerPerformance;
};

export type HuntStallCooldownWorkerClient = {
  reset: () => void;
  process: (imageData: ImageData) => Promise<HuntStallCooldownWorkerResult>;
};

export function createHuntStallCooldownWorkerClient(): HuntStallCooldownWorkerClient {
  return new BrowserHuntStallCooldownWorkerClient();
}

class BrowserHuntStallCooldownWorkerClient implements HuntStallCooldownWorkerClient {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private pending = new Map<
    number,
    {
      resolve: (response: HuntStallCooldownWorkerResult) => void;
      reject: (error: Error) => void;
      timeoutId: number;
    }
  >();

  reset(): void {
    this.nextRequestId += 1;
    this.terminateWorker();
  }

  process(imageData: ImageData): Promise<HuntStallCooldownWorkerResult> {
    if (typeof Worker === "undefined") {
      return Promise.reject(
        createRuntimeWorkerFailure({
          feature: RUNTIME_WORKER_FEATURE,
          code: "worker-unsupported",
          fallbackMessage:
            "사냥 멈춤 쿨다운 감지는 Web Worker를 지원하는 브라우저에서만 사용할 수 있습니다.",
        }),
      );
    }

    const worker = this.ensureWorker();
    if (!worker) {
      return Promise.reject(
        createRuntimeWorkerFailure({
          feature: RUNTIME_WORKER_FEATURE,
          code: "worker-create-failed",
          fallbackMessage: "사냥 멈춤 쿨다운 감지 Worker를 시작하지 못했습니다.",
        }),
      );
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const request: HuntStallCooldownWorkerProcessRequest = {
      type: "process",
      id,
      imageData,
    };

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pending.delete(id);
        this.terminateWorker();
        reject(
          createRuntimeWorkerFailure({
            feature: RUNTIME_WORKER_FEATURE,
            code: "worker-timeout",
            fallbackMessage: "hunt-stall-cooldown-worker-timeout",
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
            fallbackMessage: "hunt-stall-cooldown-worker-post-failed",
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
      this.worker = new Worker(new URL("./huntStallCooldown.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      this.worker = null;
      return null;
    }

    this.worker.onmessage = (event: MessageEvent<HuntStallCooldownWorkerResponse>) => {
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
          activity: response.activity,
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
            fallbackMessage: "hunt-stall-cooldown-worker-response-failed",
          }),
        );
      }
    };
    this.worker.onerror = (event) => {
      const error = createRuntimeWorkerFailure({
        feature: RUNTIME_WORKER_FEATURE,
        code: "worker-runtime-failed",
        error: event.message,
        fallbackMessage: "hunt-stall-cooldown-worker-error",
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
      pending.reject(new Error("hunt-stall-cooldown-worker-reset"));
      this.pending.delete(id);
    }
  }
}
