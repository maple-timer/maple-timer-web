import {
  RemoteRecognitionFrameProbeSourceError,
  type RemoteRecognitionFrameCapture,
  type RemoteRecognitionFrameProbeSource,
  type RemoteRecognitionSharedFrameOffer,
} from "../../application/remote-recognition/remoteRecognitionFrameProbeSource";

const MAX_FRAME_WIDTH = 2_048;
const MAX_FRAME_HEIGHT = 1_152;
const MAX_COMPRESSED_BYTES = 12 * 1024 * 1024;
const SHARED_FRAME_WAIT_TIMEOUT_MS = 12_000;

type PendingCapture = {
  sequence: number;
  signal: AbortSignal | undefined;
  resolve(value: RemoteRecognitionFrameCapture): void;
  reject(error: unknown): void;
  handleAbort(): void;
  timeoutId: ReturnType<typeof setTimeout>;
  encoding: boolean;
};

/**
 * Bridges setup/readiness to the product's existing 1000 ms monitoring frame.
 * Offers are lazy: no pixel is sampled unless a consented readiness request is
 * currently waiting for a distinct monitoring tick.
 */
export class SharedMonitoringRemoteRecognitionFrameProbeSource
  implements RemoteRecognitionFrameProbeSource
{
  private readonly monotonicNow: () => number;
  private pending: PendingCapture | null = null;
  private lastSampledAt = Number.NEGATIVE_INFINITY;

  constructor(options: { monotonicNow?: () => number } = {}) {
    this.monotonicNow = options.monotonicNow ?? defaultMonotonicNow;
  }

  offerFrame(offer: RemoteRecognitionSharedFrameOffer): void {
    const pending = this.pending;
    if (
      !pending ||
      pending.encoding ||
      !Number.isFinite(offer.sampledAt) ||
      offer.sampledAt <= this.lastSampledAt
    ) {
      return;
    }
    pending.encoding = true;
    this.lastSampledAt = offer.sampledAt;
    void this.encodeOffer(pending.sequence, offer, pending.signal).then(
      (capture) => this.settlePending(pending, () => pending.resolve(capture)),
      (error) => this.settlePending(pending, () => pending.reject(error)),
    );
  }

  captureFrame(
    sequence: number,
    options?: { signal?: AbortSignal },
  ): Promise<RemoteRecognitionFrameCapture> {
    throwIfAborted(options?.signal);
    if (this.pending) {
      return Promise.reject(
        new RemoteRecognitionFrameProbeSourceError(
          "video-not-ready",
          "remote-recognition-shared-frame-request-already-pending",
        ),
      );
    }

    return new Promise((resolve, reject) => {
      const handleAbort = () => {
        if (this.pending?.handleAbort !== handleAbort) {
          return;
        }
        const pending = this.pending;
        this.settlePending(pending, () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      };
      const timeoutId = setTimeout(() => {
        const pending = this.pending;
        if (!pending || pending.handleAbort !== handleAbort) {
          return;
        }
        this.settlePending(pending, () =>
          reject(
            new RemoteRecognitionFrameProbeSourceError(
              "video-not-ready",
              "remote-recognition-shared-frame-timeout",
            ),
          ),
        );
      }, SHARED_FRAME_WAIT_TIMEOUT_MS);
      this.pending = {
        sequence,
        signal: options?.signal,
        resolve,
        reject,
        handleAbort,
        timeoutId,
        encoding: false,
      };
      options?.signal?.addEventListener("abort", handleAbort, { once: true });
    });
  }

  clear(): void {
    const pending = this.pending;
    if (pending) {
      this.settlePending(pending, () =>
        pending.reject(new DOMException("aborted", "AbortError")),
      );
    }
  }

  private settlePending(pending: PendingCapture, settle: () => void): void {
    if (this.pending !== pending) {
      return;
    }
    this.pending = null;
    clearTimeout(pending.timeoutId);
    pending.signal?.removeEventListener("abort", pending.handleAbort);
    settle();
  }

  private async encodeOffer(
    sequence: number,
    offer: RemoteRecognitionSharedFrameOffer,
    signal: AbortSignal | undefined,
  ): Promise<RemoteRecognitionFrameCapture> {
    throwIfAborted(signal);
    const captureStartedAt = this.monotonicNow();
    let captured: ReturnType<RemoteRecognitionSharedFrameOffer["capture"]>;
    try {
      captured = offer.capture();
    } catch (error) {
      throw new RemoteRecognitionFrameProbeSourceError(
        "canvas-unavailable",
        error instanceof Error
          ? error.message
          : "remote-recognition-shared-frame-capture-failed",
      );
    }
    throwIfAborted(signal);
    const rgba = cropRgba(captured.imageData, captured.roi);
    const captureFinishedAt = this.monotonicNow();
    const encodedRgba = await gzipRgba(rgba);
    throwIfAborted(signal);
    const compressionFinishedAt = this.monotonicNow();
    if (encodedRgba.byteLength > MAX_COMPRESSED_BYTES) {
      throw new RemoteRecognitionFrameProbeSourceError(
        "frame-too-large",
        "remote-recognition-compressed-frame-too-large",
      );
    }
    return {
      frame: {
        sequence,
        sampledAt: offer.sampledAt,
        width: captured.roi.width,
        height: captured.roi.height,
        encodedRgba,
      },
      timings: {
        captureMs: elapsedMs(captureStartedAt, captureFinishedAt),
        compressionMs: elapsedMs(captureFinishedAt, compressionFinishedAt),
      },
    };
  }
}

function cropRgba(image: ImageData, roi: { x: number; y: number; width: number; height: number }): Uint8ClampedArray {
  if (
    !Number.isInteger(roi.x) ||
    !Number.isInteger(roi.y) ||
    !Number.isInteger(roi.width) ||
    !Number.isInteger(roi.height) ||
    roi.x < 0 ||
    roi.y < 0 ||
    roi.width <= 0 ||
    roi.height <= 0 ||
    roi.width > MAX_FRAME_WIDTH ||
    roi.height > MAX_FRAME_HEIGHT ||
    roi.x + roi.width > image.width ||
    roi.y + roi.height > image.height
  ) {
    throw new RemoteRecognitionFrameProbeSourceError(
      "frame-too-large",
      "remote-recognition-shared-frame-region-invalid",
    );
  }
  const output = new Uint8ClampedArray(roi.width * roi.height * 4);
  const sourceStride = image.width * 4;
  const rowBytes = roi.width * 4;
  for (let row = 0; row < roi.height; row += 1) {
    const sourceOffset = (roi.y + row) * sourceStride + roi.x * 4;
    output.set(
      image.data.subarray(sourceOffset, sourceOffset + rowBytes),
      row * rowBytes,
    );
  }
  return output;
}

async function gzipRgba(rgba: Uint8ClampedArray): Promise<ArrayBuffer> {
  if (typeof CompressionStream === "undefined") {
    throw new RemoteRecognitionFrameProbeSourceError(
      "compression-unavailable",
      "remote-recognition-compression-unavailable",
    );
  }
  const bytes = new Uint8Array(rgba.byteLength);
  bytes.set(rgba);
  const compression = new CompressionStream("gzip");
  const output = new Response(compression.readable).arrayBuffer();
  const writer = compression.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return output;
}

function defaultMonotonicNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function elapsedMs(startedAt: number, finishedAt: number): number {
  return Math.max(0, finishedAt - startedAt);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("aborted", "AbortError");
  }
}
