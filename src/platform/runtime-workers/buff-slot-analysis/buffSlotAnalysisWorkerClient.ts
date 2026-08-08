import type {
  BuffSlotAnalysisSampleRequest,
  BuffSlotAnalysisSampleResponse,
} from "../../../runtime/buff-slot/analysis/buffSlotAnalysisRuntime";
import { BuffSlotAnalysisSampleDroppedError } from "../../../runtime/buff-slot/analysis/buffSlotAnalysisRuntime";
import {
  createRuntimeWorkerFailure,
  markRuntimeWorkerReady,
} from "../runtimeWorkerHealth";
import type {
  BuffSlotAnalysisWorkerProcessRequest,
  BuffSlotAnalysisWorkerResponse,
} from "./buffSlotAnalysisWorkerTypes";
import {
  createPrecisionParserDiagnosticEvent,
  PrecisionParserDiagnosticError,
  type PrecisionParserDiagnosticEvent,
} from "../../../contracts/recognition/precisionParserDiagnostics";

export const BUFF_SLOT_ANALYSIS_WORKER_STARTUP_TIMEOUT_MS = 60_000;
export const BUFF_SLOT_ANALYSIS_WORKER_TIMEOUT_MS = 15_000;
export const BUFF_SLOT_ANALYSIS_WORKER_RESPONSE_GRACE_MS = 5_000;
const RUNTIME_WORKER_FEATURE = "buff-slot-analysis";

type PendingTimeoutPhase =
  | "startup-idle"
  | "warm-inference"
  | "final-response";

type QueuedRequest = {
  workerRequest: BuffSlotAnalysisWorkerProcessRequest;
  transfer: Transferable[];
  resolve: (response: BuffSlotAnalysisSampleResponse) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
  droppedSampleCount: number;
};

export type BuffSlotAnalysisEngine = {
  process(request: BuffSlotAnalysisSampleRequest): Promise<BuffSlotAnalysisSampleResponse>;
  reset(): void;
};

export type BuffSlotAnalysisWorkerClientOptions = {
  createWorker?: () => Worker | null;
  isWorkerAvailable?: () => boolean;
  startupTimeoutMs?: number;
  timeoutMs?: number;
  responseGraceMs?: number;
  onDiagnostic?: (event: PrecisionParserDiagnosticEvent) => void;
};

export function createBuffSlotAnalysisEngine(
  options: BuffSlotAnalysisWorkerClientOptions = {},
): BuffSlotAnalysisEngine {
  return new BuffSlotAnalysisWorkerClient(options);
}

export class BuffSlotAnalysisWorkerClient implements BuffSlotAnalysisEngine {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private pending = new Map<
    number,
    {
      resolve: (response: BuffSlotAnalysisSampleResponse) => void;
      reject: (error: Error) => void;
      timeoutId: number | null;
      timeoutMs: number;
      timeoutPhase: PendingTimeoutPhase;
      startedAt: number;
      isStartup: boolean;
      progressCount: number;
      lastProgressStage: PrecisionParserDiagnosticEvent["stage"] | null;
      lastProgressStatus: PrecisionParserDiagnosticEvent["status"] | null;
      visibilityStateAtStart: string;
      queueWaitMs: number;
      droppedSampleCount: number;
    }
  >();
  private activeRequestId: number | null = null;
  private queuedRequest: QueuedRequest | null = null;
  private lastCompletedSampledAt: number | null = null;
  private readonly createWorker: () => Worker | null;
  private readonly isWorkerAvailable: () => boolean;
  private readonly startupTimeoutMs: number;
  private readonly timeoutMs: number;
  private readonly responseGraceMs: number;
  private readonly onDiagnostic?: (event: PrecisionParserDiagnosticEvent) => void;
  private workerReady = false;
  private warmedUp = false;

  constructor(options: BuffSlotAnalysisWorkerClientOptions = {}) {
    this.createWorker = options.createWorker ?? createBrowserWorker;
    this.isWorkerAvailable =
      options.isWorkerAvailable ?? (() => typeof Worker !== "undefined");
    this.startupTimeoutMs =
      options.startupTimeoutMs ?? BUFF_SLOT_ANALYSIS_WORKER_STARTUP_TIMEOUT_MS;
    this.timeoutMs = options.timeoutMs ?? BUFF_SLOT_ANALYSIS_WORKER_TIMEOUT_MS;
    this.responseGraceMs =
      options.responseGraceMs ?? BUFF_SLOT_ANALYSIS_WORKER_RESPONSE_GRACE_MS;
    this.onDiagnostic = options.onDiagnostic;
  }

  reset(): void {
    this.terminateWorker();
  }

  process(
    request: BuffSlotAnalysisSampleRequest,
  ): Promise<BuffSlotAnalysisSampleResponse> {
    if (!this.workerReady) {
      this.emitDiagnostic({
        stage: "analysis-worker",
        status: "checking",
      });
    }
    if (!this.isWorkerAvailable()) {
      return Promise.reject(
        this.createWorkerFailure({
          feature: RUNTIME_WORKER_FEATURE,
          code: "worker-unsupported",
          fallbackMessage:
            "버프칸 분석은 Web Worker를 지원하는 브라우저에서만 사용할 수 있습니다.",
        }),
      );
    }

    const worker = this.ensureWorker();
    if (!worker) {
      return Promise.reject(
        this.createWorkerFailure({
          feature: RUNTIME_WORKER_FEATURE,
          code: "worker-create-failed",
          fallbackMessage: "버프칸 분석 Worker를 시작하지 못했습니다.",
        }),
      );
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const workerRequest: BuffSlotAnalysisWorkerProcessRequest = {
      ...request,
      requestId,
      type: "process",
    };

    return new Promise((resolve, reject) => {
      const queuedRequest: QueuedRequest = {
        workerRequest,
        transfer: [request.imageData.data.buffer],
        resolve,
        reject,
        enqueuedAt: Date.now(),
        droppedSampleCount: 0,
      };
      if (this.activeRequestId === null) {
        this.startWorkerRequest(worker, queuedRequest);
        return;
      }

      const replaced = this.queuedRequest;
      queuedRequest.droppedSampleCount =
        (replaced?.droppedSampleCount ?? 0) + (replaced ? 1 : 0);
      if (replaced) {
        replaced.reject(new BuffSlotAnalysisSampleDroppedError({
          sampledAt: replaced.workerRequest.sampledAt ?? null,
          replacedBySampledAt: workerRequest.sampledAt ?? null,
        }));
      }
      this.queuedRequest = queuedRequest;
    });
  }

  private startWorkerRequest(
    worker: Worker,
    queued: QueuedRequest,
  ): void {
    const requestId = queued.workerRequest.requestId;
    const isStartup = !this.warmedUp;
    this.activeRequestId = requestId;
    this.pending.set(requestId, {
      resolve: queued.resolve,
      reject: queued.reject,
      timeoutId: null,
      timeoutMs: isStartup ? this.startupTimeoutMs : this.timeoutMs,
      timeoutPhase: isStartup ? "startup-idle" : "warm-inference",
      startedAt: Date.now(),
      isStartup,
      progressCount: 0,
      lastProgressStage: null,
      lastProgressStatus: null,
      visibilityStateAtStart: getVisibilityState(),
      queueWaitMs: getElapsedMs(queued.enqueuedAt),
      droppedSampleCount: queued.droppedSampleCount,
    });
    this.armTimeout(
      requestId,
      isStartup ? this.startupTimeoutMs : this.timeoutMs,
      isStartup ? "startup-idle" : "warm-inference",
    );
    try {
      worker.postMessage(queued.workerRequest, queued.transfer);
    } catch (error) {
      this.clearPendingTimeout(requestId);
      this.pending.delete(requestId);
      this.activeRequestId = null;
      queued.reject(
        this.createWorkerFailure({
          feature: RUNTIME_WORKER_FEATURE,
          code: "worker-post-failed",
          error,
          fallbackMessage: "버프칸 분석 Worker 전송에 실패했습니다.",
        }),
      );
      this.startQueuedRequest();
    }
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

    this.worker.onmessage = (event: MessageEvent<BuffSlotAnalysisWorkerResponse>) => {
      const message = event.data;
      const pending = this.pending.get(message.requestId);
      if (!pending) {
        return;
      }
      if (!this.workerReady) {
        this.workerReady = true;
        this.emitDiagnostic({
          stage: "analysis-worker",
          status: "passed",
          details: {
            requestElapsedMs: getElapsedMs(pending.startedAt),
            visibilityState: getVisibilityState(),
          },
        });
      }
      if (message.type === "diagnostic") {
        const diagnostic = this.recordProgress(
          message.requestId,
          message.diagnostic,
        );
        this.onDiagnostic?.(diagnostic);
        return;
      }
      this.clearPendingTimeout(message.requestId);
      this.pending.delete(message.requestId);
      this.activeRequestId = null;
      if (message.ok) {
        this.warmedUp = true;
        markRuntimeWorkerReady(RUNTIME_WORKER_FEATURE);
        const completedAt = Date.now();
        const sampledAt = message.response.sampledAt;
        const sampleIntervalMs =
          sampledAt !== null && this.lastCompletedSampledAt !== null
            ? Math.max(0, sampledAt - this.lastCompletedSampledAt)
            : null;
        if (sampledAt !== null) {
          this.lastCompletedSampledAt = sampledAt;
        }
        pending.resolve({
          ...message.response,
          performance: {
            ...message.response.performance,
            queueWaitMs: pending.queueWaitMs,
            resultAgeMs: sampledAt === null ? null : Math.max(0, completedAt - sampledAt),
            droppedSampleCount: pending.droppedSampleCount,
            sampleIntervalMs,
          },
        });
      } else {
        const responseError = message.error.diagnostic
          ? new PrecisionParserDiagnosticError(
              message.error.message,
              message.error.diagnostic,
            )
          : new Error(message.error.message);
        pending.reject(
          createRuntimeWorkerFailure({
            feature: RUNTIME_WORKER_FEATURE,
            code: "worker-response-failed",
            error: responseError,
            fallbackMessage: "버프칸 분석 Worker 응답 오류가 발생했습니다.",
          }),
        );
      }
      this.startQueuedRequest();
    };

    this.worker.onerror = (event) => {
      const error = this.createWorkerFailure({
        feature: RUNTIME_WORKER_FEATURE,
        code: "worker-runtime-failed",
        error: event.message,
        fallbackMessage: "버프칸 분석 Worker 오류가 발생했습니다.",
      });
      for (const pending of this.pending.values()) {
        if (pending.timeoutId !== null) {
          window.clearTimeout(pending.timeoutId);
        }
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
    this.workerReady = false;
    this.warmedUp = false;
    this.activeRequestId = null;
    this.lastCompletedSampledAt = null;
    for (const pending of this.pending.values()) {
      if (pending.timeoutId !== null) {
        window.clearTimeout(pending.timeoutId);
      }
      pending.reject(new Error("버프칸 분석 Worker가 종료되었습니다."));
    }
    this.pending.clear();
    this.queuedRequest?.reject(new Error("버프칸 분석 Worker가 종료되었습니다."));
    this.queuedRequest = null;
  }

  private startQueuedRequest(): void {
    if (this.activeRequestId !== null || !this.queuedRequest || !this.worker) {
      return;
    }
    const queued = this.queuedRequest;
    this.queuedRequest = null;
    this.startWorkerRequest(this.worker, queued);
  }

  private recordProgress(
    requestId: number,
    diagnostic: PrecisionParserDiagnosticEvent,
  ): PrecisionParserDiagnosticEvent {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return diagnostic;
    }

    pending.progressCount += 1;
    pending.lastProgressStage = diagnostic.stage;
    pending.lastProgressStatus = diagnostic.status;
    const isTerminalProgress =
      diagnostic.status === "failed" ||
      (diagnostic.stage === "first-inference" && diagnostic.status === "passed");
    this.armTimeout(
      requestId,
      isTerminalProgress
        ? this.responseGraceMs
        : pending.isStartup
          ? this.startupTimeoutMs
          : this.timeoutMs,
      isTerminalProgress
        ? "final-response"
        : pending.isStartup
          ? "startup-idle"
          : "warm-inference",
    );

    return {
      ...diagnostic,
      details: {
        ...diagnostic.details,
        requestElapsedMs: getElapsedMs(pending.startedAt),
        visibilityState: getVisibilityState(),
      },
    };
  }

  private armTimeout(
    requestId: number,
    timeoutMs: number,
    timeoutPhase: PendingTimeoutPhase,
  ): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    if (pending.timeoutId !== null) {
      window.clearTimeout(pending.timeoutId);
    }
    pending.timeoutMs = timeoutMs;
    pending.timeoutPhase = timeoutPhase;
    pending.timeoutId = window.setTimeout(() => {
      const timedOut = this.pending.get(requestId);
      if (!timedOut) {
        return;
      }
      this.pending.delete(requestId);
      const details = {
        requestElapsedMs: getElapsedMs(timedOut.startedAt),
        timeoutMs: timedOut.timeoutMs,
        timeoutPhase: timedOut.timeoutPhase,
        requestMode: timedOut.isStartup ? "startup" : "warm",
        progressCount: timedOut.progressCount,
        lastProgressStage: timedOut.lastProgressStage,
        lastProgressStatus: timedOut.lastProgressStatus,
        visibilityStateAtStart: timedOut.visibilityStateAtStart,
        visibilityStateAtTimeout: getVisibilityState(),
      };
      this.terminateWorker();
      timedOut.reject(
        this.createWorkerFailure(
          {
            feature: RUNTIME_WORKER_FEATURE,
            code: "worker-timeout",
            fallbackMessage: "buff-slot-analysis-worker-timeout",
          },
          details,
        ),
      );
    }, timeoutMs);
  }

  private clearPendingTimeout(requestId: number): void {
    const pending = this.pending.get(requestId);
    if (!pending || pending.timeoutId === null) {
      return;
    }
    window.clearTimeout(pending.timeoutId);
    pending.timeoutId = null;
  }

  private emitDiagnostic(
    event: Omit<PrecisionParserDiagnosticEvent, "code" | "technicalMessage" | "details"> &
      Partial<Pick<PrecisionParserDiagnosticEvent, "code" | "technicalMessage" | "details">>,
  ): PrecisionParserDiagnosticEvent {
    const diagnostic = createPrecisionParserDiagnosticEvent(event);
    this.onDiagnostic?.(diagnostic);
    return diagnostic;
  }

  private createWorkerFailure(
    options: Parameters<typeof createRuntimeWorkerFailure>[0],
    details: PrecisionParserDiagnosticEvent["details"] = {},
  ): Error {
    const technicalMessage =
      options.error instanceof Error
        ? options.error.message
        : typeof options.error === "string" && options.error
          ? options.error
          : options.fallbackMessage;
    const diagnostic = this.emitDiagnostic({
      stage: "analysis-worker",
      status: "failed",
      code: options.code,
      technicalMessage,
      details,
    });
    return createRuntimeWorkerFailure({
      ...options,
      error: new PrecisionParserDiagnosticError(technicalMessage, diagnostic),
    });
  }
}

function getElapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function getVisibilityState(): string {
  return typeof document === "undefined"
    ? "unknown"
    : document.visibilityState || "unknown";
}

function createBrowserWorker(): Worker {
  return new Worker(new URL("./buffSlotAnalysis.worker.ts", import.meta.url), {
    type: "module",
  });
}
