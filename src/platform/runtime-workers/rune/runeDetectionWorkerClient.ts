import type { RuneDetectionResult } from "../../../recognition/rune/runeDetectionTypes";
import type {
  RuneDetectionWorkerProcessRequest,
  RuneDetectionWorkerResponse,
} from "../../../recognition/rune/runeDetectionWorkerTypes";

export const RUNE_DETECTION_WORKER_WARMUP_TIMEOUT_MS = 10_000;
export const RUNE_DETECTION_WORKER_TIMEOUT_MS = 1500;

export type RuneDetectionWorkerClientErrorPhase =
  | "unsupported"
  | "worker-create"
  | "worker-post"
  | "worker-timeout"
  | "worker-runtime"
  | "worker-response";

export type RuneDetectionWorkerClient = {
  detect: (imageData: ImageData) => Promise<RuneDetectionResult>;
  reset: () => void;
};

export class RuneDetectionWorkerClientError extends Error {
  readonly code: string;
  readonly phase: RuneDetectionWorkerClientErrorPhase;

  constructor(
    code: string,
    phase: RuneDetectionWorkerClientErrorPhase,
    message = code,
  ) {
    super(message);
    this.name = "RuneDetectionWorkerClientError";
    this.code = code;
    this.phase = phase;
  }
}

export function getRuneDetectionWorkerErrorDetails(error: unknown): {
  code: string;
  phase: RuneDetectionWorkerClientErrorPhase;
  message: string;
} {
  if (error instanceof RuneDetectionWorkerClientError) {
    return {
      code: error.code,
      phase: error.phase,
      message: error.message,
    };
  }
  const message =
    error instanceof Error ? error.message : String(error || "rune-detection-error");
  return {
    code: "rune-detection-worker-runtime-failed",
    phase: "worker-runtime",
    message,
  };
}

export function createRuneDetectionWorkerClient(): RuneDetectionWorkerClient {
  return new BrowserRuneDetectionWorkerClient();
}

class BrowserRuneDetectionWorkerClient implements RuneDetectionWorkerClient {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private warmedUp = false;
  private pending = new Map<
    number,
    {
      resolve: (response: RuneDetectionResult) => void;
      reject: (error: Error) => void;
      timeoutId: number;
    }
  >();

  reset(): void {
    this.nextRequestId += 1;
    this.terminateWorker();
  }

  detect(imageData: ImageData): Promise<RuneDetectionResult> {
    if (typeof Worker === "undefined") {
      return Promise.reject(
        new RuneDetectionWorkerClientError(
          "rune-detection-worker-unsupported",
          "unsupported",
          "룬 감지는 Web Worker를 지원하는 브라우저에서만 사용할 수 있습니다.",
        ),
      );
    }

    const worker = this.ensureWorker();
    if (!worker) {
      return Promise.reject(
        new RuneDetectionWorkerClientError(
          "rune-detection-worker-create-failed",
          "worker-create",
          "룬 감지 Worker를 시작하지 못했습니다.",
        ),
      );
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const request: RuneDetectionWorkerProcessRequest = {
      type: "detect",
      id,
      imageData: cloneImageDataForWorker(imageData),
    };

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pending.delete(id);
        this.terminateWorker();
        reject(
          new RuneDetectionWorkerClientError(
            "rune-detection-worker-timeout",
            "worker-timeout",
          ),
        );
      }, this.warmedUp
        ? RUNE_DETECTION_WORKER_TIMEOUT_MS
        : RUNE_DETECTION_WORKER_WARMUP_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeoutId });
      try {
        worker.postMessage(request, [request.imageData.data.buffer]);
      } catch (error) {
        window.clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(
          new RuneDetectionWorkerClientError(
            "rune-detection-worker-post-failed",
            "worker-post",
            error instanceof Error ? error.message : "rune-detection-worker-post-failed",
          ),
        );
      }
    });
  }

  private ensureWorker(): Worker | null {
    if (this.worker) {
      return this.worker;
    }

    try {
      this.worker = new Worker(
        new URL(
          "../../../recognition/rune/runeDetection.worker.ts",
          import.meta.url,
        ),
        {
          type: "module",
        },
      );
    } catch {
      this.worker = null;
      return null;
    }

    this.worker.onmessage = (event: MessageEvent<RuneDetectionWorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) {
        return;
      }
      window.clearTimeout(pending.timeoutId);
      this.pending.delete(response.id);
      if (response.type === "detected") {
        this.warmedUp = true;
        pending.resolve(response.result);
        return;
      }
      pending.reject(
        new RuneDetectionWorkerClientError(
          "rune-detection-worker-response-failed",
          "worker-response",
          response.message,
        ),
      );
    };

    this.worker.onerror = (event) => {
      const error = new RuneDetectionWorkerClientError(
        "rune-detection-worker-runtime-failed",
        "worker-runtime",
        event.message || "rune-detection-worker-error",
      );
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
    this.worker?.terminate();
    this.worker = null;
    this.warmedUp = false;
    for (const [id, pending] of this.pending) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(new Error("rune-detection-worker-reset"));
      this.pending.delete(id);
    }
  }
}

function cloneImageDataForWorker(imageData: ImageData): ImageData {
  return new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );
}
