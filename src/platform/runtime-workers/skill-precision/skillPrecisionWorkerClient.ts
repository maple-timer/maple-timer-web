import type {
  SkillBuffDurationSampleRequest,
  SkillBuffDurationSampleResponse,
} from "../../../runtime/skill-precision/analysis/skillPrecisionAnalysisRuntime";
import type {
  SkillBuffDurationWorkerProcessRequest,
  SkillBuffDurationWorkerRequest,
  SkillBuffDurationWorkerResponse,
} from "./skillPrecisionWorkerTypes";
import {
  createRuntimeWorkerFailure,
  markRuntimeWorkerReady,
} from "../runtimeWorkerHealth";

export const SKILL_PRECISION_WORKER_TIMEOUT_MS = 15000;
const RUNTIME_WORKER_FEATURE = "skill-buff-duration";

export type SkillBuffDurationEngine = {
  process(request: SkillBuffDurationSampleRequest): Promise<SkillBuffDurationSampleResponse>;
  reset(): void;
};

export type SkillPrecisionWorkerClientOptions = {
  createWorker?: () => Worker | null;
  isWorkerAvailable?: () => boolean;
  timeoutMs?: number;
};

export function createSkillBuffDurationEngine(
  options: SkillPrecisionWorkerClientOptions = {},
): SkillBuffDurationEngine {
  return new SkillPrecisionWorkerClient(options);
}

export class SkillPrecisionWorkerClient implements SkillBuffDurationEngine {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private pending = new Map<
    number,
    {
      resolve: (response: SkillBuffDurationSampleResponse) => void;
      reject: (error: Error) => void;
      timeoutId: number;
    }
  >();
  private readonly createWorker: () => Worker | null;
  private readonly isWorkerAvailable: () => boolean;
  private readonly timeoutMs: number;

  constructor(options: SkillPrecisionWorkerClientOptions = {}) {
    this.createWorker = options.createWorker ?? createBrowserWorker;
    this.isWorkerAvailable =
      options.isWorkerAvailable ?? (() => typeof Worker !== "undefined");
    this.timeoutMs = options.timeoutMs ?? SKILL_PRECISION_WORKER_TIMEOUT_MS;
  }

  reset(): void {
    this.terminateWorker();
  }

  process(request: SkillBuffDurationSampleRequest): Promise<SkillBuffDurationSampleResponse> {
    if (!this.isWorkerAvailable()) {
      return Promise.reject(createRuntimeWorkerFailure({
        feature: RUNTIME_WORKER_FEATURE,
        code: "worker-unsupported",
        fallbackMessage: "스킬 버프칸 감지는 Web Worker를 지원하는 브라우저에서만 사용할 수 있습니다.",
      }));
    }

    const worker = this.ensureWorker();
    if (!worker) {
      return Promise.reject(createRuntimeWorkerFailure({
        feature: RUNTIME_WORKER_FEATURE,
        code: "worker-create-failed",
        fallbackMessage: "스킬 버프칸 감지 Worker를 시작하지 못했습니다.",
      }));
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const workerRequest: SkillBuffDurationWorkerProcessRequest = {
      ...request,
      requestId,
      type: "process",
    };

    return this.postWorkerRequest(worker, workerRequest, [request.imageData.data.buffer]);
  }

  private postWorkerRequest(
    worker: Worker,
    workerRequest: SkillBuffDurationWorkerRequest,
    transfer?: Transferable[],
  ): Promise<SkillBuffDurationSampleResponse> {
    const requestId = workerRequest.requestId;
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pending.delete(requestId);
        this.terminateWorker();
        reject(createRuntimeWorkerFailure({
          feature: RUNTIME_WORKER_FEATURE,
          code: "worker-timeout",
          fallbackMessage: "skill-buff-duration-worker-timeout",
        }));
      }, this.timeoutMs);
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
        reject(createRuntimeWorkerFailure({
          feature: RUNTIME_WORKER_FEATURE,
          code: "worker-post-failed",
          error,
          fallbackMessage: "스킬 버프칸 감지 Worker 전송에 실패했습니다.",
        }));
      }
    });
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

    this.worker.onmessage = (event: MessageEvent<SkillBuffDurationWorkerResponse>) => {
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
        pending.reject(createRuntimeWorkerFailure({
          feature: RUNTIME_WORKER_FEATURE,
          code: "worker-response-failed",
          error: message.error,
          fallbackMessage: "스킬 버프칸 감지 Worker 응답 오류가 발생했습니다.",
        }));
      }
    };

    this.worker.onerror = (event) => {
      const error = createRuntimeWorkerFailure({
        feature: RUNTIME_WORKER_FEATURE,
        code: "worker-runtime-failed",
        error: event.message,
        fallbackMessage: "스킬 버프칸 감지 Worker 오류가 발생했습니다.",
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
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(new Error("스킬 버프칸 감지 Worker가 종료되었습니다."));
    }
    this.pending.clear();
  }
}

function createBrowserWorker(): Worker {
  return new Worker(new URL("./skillPrecisionAnalysis.worker.ts", import.meta.url), {
    type: "module",
  });
}
