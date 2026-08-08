import type {
  HuntStallExperienceProcessInput,
  HuntStallExperienceProcessResult,
  HuntStallExperienceProcessor,
} from "../../../runtime/hunt-stall/experience/huntStallExperienceRuntime";
import {
  createRuntimeWorkerFailure,
  markRuntimeWorkerReady,
} from "../runtimeWorkerHealth";
import type {
  HuntStallOcrWorkerProcessRequest,
  HuntStallOcrWorkerProcessResponse,
  HuntStallOcrWorkerResponse,
} from "./huntStallOcrWorkerTypes";

export const HUNT_STALL_OCR_WORKER_TIMEOUT_MS = 15000;
const RUNTIME_WORKER_FEATURE = "hunt-stall-ocr";

type HuntStallOcrFallbackProcessor = Pick<HuntStallExperienceProcessor, "process" | "reset">;

export type HuntStallOcrWorkerClientOptions = {
  fallbackProcessor?: HuntStallOcrFallbackProcessor;
  createWorker?: () => Worker | null;
  isWorkerAvailable?: () => boolean;
  timeoutMs?: number;
};

export class HuntStallOcrWorkerClient {
  private worker: Worker | null = null;
  private fallbackProcessor: HuntStallOcrFallbackProcessor | null;
  private nextRequestId = 1;
  private pending = new Map<
    number,
    {
      resolve: (result: HuntStallExperienceProcessResult) => void;
      reject: (error: Error) => void;
      timeoutId: number;
    }
  >();
  private createWorker: () => Worker | null;
  private isWorkerAvailable: () => boolean;
  private timeoutMs: number;

  constructor(options: HuntStallOcrWorkerClientOptions = {}) {
    this.fallbackProcessor = options.fallbackProcessor ?? null;
    this.createWorker = options.createWorker ?? createBrowserWorker;
    this.isWorkerAvailable = options.isWorkerAvailable ?? (() => typeof Worker !== "undefined");
    this.timeoutMs = options.timeoutMs ?? HUNT_STALL_OCR_WORKER_TIMEOUT_MS;
  }

  reset(): void {
    this.fallbackProcessor?.reset();
    this.nextRequestId += 1;
    this.terminateWorker();
  }

  process(input: HuntStallExperienceProcessInput): Promise<HuntStallExperienceProcessResult> {
    if (!this.isWorkerAvailable()) {
      return this.processWithFallback(
        input,
        "사냥 멈춤 OCR은 Web Worker를 지원하는 브라우저에서만 사용할 수 있습니다.",
      );
    }

    const worker = this.ensureWorker();
    if (!worker) {
      return this.processWithFallback(input, "사냥 멈춤 OCR Worker를 시작하지 못했습니다.");
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const request: HuntStallOcrWorkerProcessRequest = {
      ...input,
      type: "process",
      id,
    };

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pending.delete(id);
        this.terminateWorker();
        reject(createRuntimeWorkerFailure({
          feature: RUNTIME_WORKER_FEATURE,
          code: "worker-timeout",
          fallbackMessage: "hunt-stall-worker-timeout",
        }));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timeoutId });
      try {
        worker.postMessage(request, getHuntStallOcrWorkerTransferList(input));
      } catch (error) {
        window.clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(createRuntimeWorkerFailure({
          feature: RUNTIME_WORKER_FEATURE,
          code: "worker-post-failed",
          error,
          fallbackMessage: "hunt-stall-worker-post-failed",
        }));
      }
    });
  }

  private processWithFallback(
    input: HuntStallExperienceProcessInput,
    errorMessage: string,
  ): Promise<HuntStallExperienceProcessResult> {
    if (!this.fallbackProcessor) {
      return Promise.reject(createRuntimeWorkerFailure({
        feature: RUNTIME_WORKER_FEATURE,
        code: "worker-unavailable",
        fallbackMessage: errorMessage,
      }));
    }
    return Promise.resolve(this.fallbackProcessor.process(input));
  }

  private ensureWorker(): Worker | null {
    if (this.worker) {
      return this.worker;
    }

    try {
      this.worker = this.createWorker();
    } catch {
      this.worker = null;
      return null;
    }

    if (!this.worker) {
      return null;
    }

    this.worker.onmessage = (event: MessageEvent<HuntStallOcrWorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) {
        return;
      }
      window.clearTimeout(pending.timeoutId);
      this.pending.delete(response.id);
      if (response.type === "processed") {
        markRuntimeWorkerReady(RUNTIME_WORKER_FEATURE);
        pending.resolve(toProcessResult(response));
        return;
      }
      if (response.type === "error") {
        pending.reject(createRuntimeWorkerFailure({
          feature: RUNTIME_WORKER_FEATURE,
          code: "worker-response-failed",
          error: response.message,
          fallbackMessage: "hunt-stall-worker-response-failed",
        }));
      }
    };
    this.worker.onerror = (event) => {
      const error = createRuntimeWorkerFailure({
        feature: RUNTIME_WORKER_FEATURE,
        code: "worker-runtime-failed",
        error: event.message,
        fallbackMessage: "hunt-stall-worker-error",
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
      pending.reject(new Error("hunt-stall-worker-reset"));
      this.pending.delete(id);
    }
  }
}

export function getHuntStallOcrWorkerTransferList(
  input: HuntStallExperienceProcessInput,
): Transferable[] {
  return [
    ...input.barStrips.map((strip) => strip.imageData.data.buffer),
    ...input.candidates.map((candidate) => candidate.imageData.data.buffer),
  ];
}

function createBrowserWorker(): Worker {
  return new Worker(new URL("./huntStallOcr.worker.ts", import.meta.url), {
    type: "module",
  });
}

function toProcessResult(
  response: HuntStallOcrWorkerProcessResponse,
): HuntStallExperienceProcessResult {
  return {
    selectedIndex: response.selectedIndex,
    reading: response.reading,
    barEstimate: response.barEstimate,
    candidates: response.candidates,
    performance: response.performance,
  };
}
