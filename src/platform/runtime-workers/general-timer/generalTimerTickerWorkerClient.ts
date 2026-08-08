import {
  createRuntimeWorkerFailure,
  markRuntimeWorkerReady,
} from "../runtimeWorkerHealth";
import type {
  GeneralTimerTickerRequest,
  GeneralTimerTickerResponse,
} from "./generalTimerTickerWorkerTypes";

const RUNTIME_WORKER_FEATURE = "general-timer";

export type GeneralTimerTickerWorkerStartOptions = {
  intervalMs: number;
  onTick: (now: number) => void;
  onUnavailable: () => void;
};

export type GeneralTimerTickerWorkerClient = {
  start: (options: GeneralTimerTickerWorkerStartOptions) => boolean;
  stop: () => void;
};

export function createGeneralTimerTickerWorkerClient(): GeneralTimerTickerWorkerClient {
  return new BrowserGeneralTimerTickerWorkerClient();
}

class BrowserGeneralTimerTickerWorkerClient implements GeneralTimerTickerWorkerClient {
  private worker: Worker | null = null;
  private onTick: ((now: number) => void) | null = null;
  private onUnavailable: (() => void) | null = null;

  start(options: GeneralTimerTickerWorkerStartOptions): boolean {
    this.stop();
    if (typeof Worker === "undefined") {
      return false;
    }

    let worker: Worker;
    try {
      worker = new Worker(new URL("./generalTimerTicker.worker.ts", import.meta.url), {
        type: "module",
        name: "general-timer-ticker",
      });
    } catch (error) {
      createRuntimeWorkerFailure({
        feature: RUNTIME_WORKER_FEATURE,
        code: "worker-create-failed",
        error,
        fallbackMessage: "general-timer-worker-create-failed",
      });
      return false;
    }

    this.worker = worker;
    this.onTick = options.onTick;
    this.onUnavailable = options.onUnavailable;
    worker.onmessage = (event: MessageEvent<GeneralTimerTickerResponse>) => {
      if (this.worker !== worker || event.data.type !== "tick") {
        return;
      }
      markRuntimeWorkerReady(RUNTIME_WORKER_FEATURE);
      this.onTick?.(event.data.now);
    };
    worker.onerror = (event) => {
      if (this.worker !== worker) {
        return;
      }
      createRuntimeWorkerFailure({
        feature: RUNTIME_WORKER_FEATURE,
        code: "worker-runtime-failed",
        error: event.message,
        fallbackMessage: "general-timer-worker-error",
      });
      const onUnavailable = this.onUnavailable;
      this.releaseWorker(worker);
      onUnavailable?.();
    };

    const request: GeneralTimerTickerRequest = {
      type: "start",
      intervalMs: options.intervalMs,
    };
    try {
      worker.postMessage(request);
      return true;
    } catch (error) {
      createRuntimeWorkerFailure({
        feature: RUNTIME_WORKER_FEATURE,
        code: "worker-post-failed",
        error,
        fallbackMessage: "general-timer-worker-post-failed",
      });
      this.releaseWorker(worker);
      return false;
    }
  }

  stop(): void {
    const worker = this.worker;
    if (!worker) {
      this.clearCallbacks();
      return;
    }

    const request: GeneralTimerTickerRequest = { type: "stop" };
    try {
      worker.postMessage(request);
    } catch {
      // A failed Worker may already reject messages while it is being released.
    }
    this.releaseWorker(worker);
  }

  private releaseWorker(worker: Worker): void {
    if (this.worker === worker) {
      this.worker = null;
    }
    worker.terminate();
    this.clearCallbacks();
  }

  private clearCallbacks(): void {
    this.onTick = null;
    this.onUnavailable = null;
  }
}
