import {
  normalizeBuffExpiryTargetGroups,
} from "../../../contracts/recognition/buffExpiryRecognition";
import type {
  BuffExpiryPrecisionSampleRequest,
  BuffExpiryPrecisionSampleResponse,
  BuffExpiryPrecisionTargetGroup,
} from "../../../runtime/buff-expiry/analysis/buffExpiryPrecisionAnalysisRuntime";
import {
  createRuntimeWorkerFailure,
  markRuntimeWorkerReady,
} from "../runtimeWorkerHealth";
import type {
  BuffExpiryPrecisionWorkerPreloadRequest,
  BuffExpiryPrecisionWorkerPreloadResponse,
  BuffExpiryPrecisionWorkerProcessRequest,
  BuffExpiryPrecisionWorkerRequest,
  BuffExpiryPrecisionWorkerResponse,
} from "./buffExpiryPrecisionWorkerTypes";

export const BUFF_EXPIRY_PRECISION_WORKER_PROCESS_TIMEOUT_MS = 5000;
export const BUFF_EXPIRY_PRECISION_WORKER_PRELOAD_TIMEOUT_MS = 30000;
const RUNTIME_WORKER_FEATURE = "buff-expiry";

export type BuffExpiryPrecisionPreloadStatus = "idle" | "loading" | "ready" | "error";

export type BuffExpiryPrecisionEngine = {
  preload(activeGroups?: BuffExpiryPrecisionTargetGroup[]): Promise<BuffExpiryPrecisionWorkerPreloadResponse>;
  process(request: BuffExpiryPrecisionSampleRequest): Promise<BuffExpiryPrecisionSampleResponse>;
  reset(): void;
};

export type BuffExpiryPrecisionWorkerClientOptions = {
  createWorker?: () => Worker | null;
  isWorkerAvailable?: () => boolean;
  processTimeoutMs?: number;
  preloadTimeoutMs?: number;
};

export function createBuffExpiryPrecisionEngine(
  options: BuffExpiryPrecisionWorkerClientOptions = {},
): BuffExpiryPrecisionEngine {
  return new BuffExpiryPrecisionWorkerClient(options);
}

export class BuffExpiryPrecisionWorkerClient implements BuffExpiryPrecisionEngine {
  private worker: Worker | null = null;
  private workerConfigKey: string | null = null;
  private nextRequestId = 1;
  private pending = new Map<
    number,
    {
      resolve: (
        response: BuffExpiryPrecisionSampleResponse | BuffExpiryPrecisionWorkerPreloadResponse,
      ) => void;
      reject: (error: Error) => void;
      timeoutId: number;
    }
  >();
  private readonly createWorker: () => Worker | null;
  private readonly isWorkerAvailable: () => boolean;
  private readonly processTimeoutMs: number;
  private readonly preloadTimeoutMs: number;

  constructor(options: BuffExpiryPrecisionWorkerClientOptions = {}) {
    this.createWorker = options.createWorker ?? createBrowserWorker;
    this.isWorkerAvailable =
      options.isWorkerAvailable ?? (() => typeof Worker !== "undefined");
    this.processTimeoutMs =
      options.processTimeoutMs ?? BUFF_EXPIRY_PRECISION_WORKER_PROCESS_TIMEOUT_MS;
    this.preloadTimeoutMs =
      options.preloadTimeoutMs ?? BUFF_EXPIRY_PRECISION_WORKER_PRELOAD_TIMEOUT_MS;
  }

  reset(): void {
    this.terminateWorker();
  }

  preload(
    activeGroups?: BuffExpiryPrecisionTargetGroup[],
  ): Promise<BuffExpiryPrecisionWorkerPreloadResponse> {
    if (!this.isWorkerAvailable()) {
      return Promise.reject(this.createUnsupportedFailure());
    }

    const normalizedActiveGroups = normalizeBuffExpiryTargetGroups(activeGroups);
    const worker = this.ensureWorker(normalizedActiveGroups);
    if (!worker) {
      return Promise.reject(this.createWorkerStartFailure());
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const workerRequest: BuffExpiryPrecisionWorkerPreloadRequest = {
      requestId,
      type: "preload",
      activeGroups: normalizedActiveGroups,
    };

    return this.postWorkerRequest(worker, workerRequest, this.preloadTimeoutMs).then(
      (response) => response as BuffExpiryPrecisionWorkerPreloadResponse,
    );
  }

  process(request: BuffExpiryPrecisionSampleRequest): Promise<BuffExpiryPrecisionSampleResponse> {
    if (!this.isWorkerAvailable()) {
      return Promise.reject(this.createUnsupportedFailure());
    }

    const normalizedActiveGroups = normalizeBuffExpiryTargetGroups(request.activeGroups);
    const worker = this.ensureWorker(normalizedActiveGroups);
    if (!worker) {
      return Promise.reject(this.createWorkerStartFailure());
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const workerRequest: BuffExpiryPrecisionWorkerProcessRequest = {
      ...request,
      activeGroups: normalizedActiveGroups,
      requestId,
      type: "process",
    };

    return this.postWorkerRequest(
      worker,
      workerRequest,
      this.processTimeoutMs,
      [request.imageData.data.buffer],
    ).then((response) => response as BuffExpiryPrecisionSampleResponse);
  }

  private postWorkerRequest(
    worker: Worker,
    workerRequest: BuffExpiryPrecisionWorkerRequest,
    timeoutMs: number,
    transfer?: Transferable[],
  ): Promise<BuffExpiryPrecisionSampleResponse | BuffExpiryPrecisionWorkerPreloadResponse> {
    const requestId = workerRequest.requestId;
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pending.delete(requestId);
        this.terminateWorker();
        reject(
          createRuntimeWorkerFailure({
            feature: RUNTIME_WORKER_FEATURE,
            code: "worker-timeout",
            fallbackMessage: "buff-expiry-precision-worker-timeout",
          }),
        );
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeoutId });
      try {
        if (transfer) {
          worker.postMessage(workerRequest, transfer);
        } else {
          worker.postMessage(workerRequest);
        }
      } catch (error) {
        window.clearTimeout(timeoutId);
        this.pending.delete(requestId);
        reject(
          createRuntimeWorkerFailure({
            feature: RUNTIME_WORKER_FEATURE,
            code: "worker-post-failed",
            error,
            fallbackMessage: "버프 종료 정밀 감지 Worker 전송에 실패했습니다.",
          }),
        );
      }
    });
  }

  private ensureWorker(activeGroups: BuffExpiryPrecisionTargetGroup[]): Worker | null {
    const configKey = activeGroups.join("|");
    if (this.worker && this.workerConfigKey === configKey) {
      return this.worker;
    }
    if (this.worker) {
      this.terminateWorker();
    }

    try {
      this.worker = this.createWorker();
    } catch {
      this.worker = null;
      this.workerConfigKey = null;
      return null;
    }
    if (!this.worker) {
      this.workerConfigKey = null;
      return null;
    }
    this.workerConfigKey = configKey;

    this.worker.onmessage = (event: MessageEvent<BuffExpiryPrecisionWorkerResponse>) => {
      const message = event.data;
      const pending = this.pending.get(message.requestId);
      if (!pending) {
        return;
      }
      window.clearTimeout(pending.timeoutId);
      this.pending.delete(message.requestId);
      if (message.ok) {
        markRuntimeWorkerReady(RUNTIME_WORKER_FEATURE);
        pending.resolve(message.response);
      } else {
        pending.reject(
          createRuntimeWorkerFailure({
            feature: RUNTIME_WORKER_FEATURE,
            code: "worker-response-failed",
            error: message.error,
            fallbackMessage: "버프 종료 정밀 감지 Worker 응답 오류가 발생했습니다.",
          }),
        );
      }
    };

    this.worker.onerror = (event) => {
      const error = createRuntimeWorkerFailure({
        feature: RUNTIME_WORKER_FEATURE,
        code: "worker-runtime-failed",
        error: event.message,
        fallbackMessage: "버프 종료 정밀 감지 Worker 오류가 발생했습니다.",
      });
      for (const pending of this.pending.values()) {
        window.clearTimeout(pending.timeoutId);
        pending.reject(error);
      }
      this.pending.clear();
      this.terminateWorker();
    };

    return this.worker;
  }

  private terminateWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    this.workerConfigKey = null;
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(new Error("버프 종료 정밀 감지 Worker가 종료되었습니다."));
    }
    this.pending.clear();
  }

  private createUnsupportedFailure(): Error {
    return createRuntimeWorkerFailure({
      feature: RUNTIME_WORKER_FEATURE,
      code: "worker-unsupported",
      fallbackMessage:
        "버프 종료 정밀 감지는 Web Worker를 지원하는 브라우저에서만 사용할 수 있습니다.",
    });
  }

  private createWorkerStartFailure(): Error {
    return createRuntimeWorkerFailure({
      feature: RUNTIME_WORKER_FEATURE,
      code: "worker-create-failed",
      fallbackMessage: "버프 종료 정밀 감지 Worker를 시작하지 못했습니다.",
    });
  }
}

function createBrowserWorker(): Worker {
  return new Worker(new URL("./buffExpiryPrecision.worker.ts", import.meta.url), {
    type: "module",
  });
}
