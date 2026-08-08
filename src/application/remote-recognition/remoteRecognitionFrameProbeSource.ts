import type { RemoteRecognitionFrameProbePayload } from "../../contracts/remote-recognition/remoteRecognitionControlContract";
import type { PixelRegion } from "../../contracts/geometry/pixelRegion";

export type RemoteRecognitionFrameCapture = {
  frame: RemoteRecognitionFrameProbePayload;
  timings: {
    captureMs: number;
    compressionMs: number;
  };
};

export type RemoteRecognitionFrameProbeSourceFailureCode =
  | "screen-share-unavailable"
  | "game-viewport-unavailable"
  | "video-not-ready"
  | "canvas-unavailable"
  | "compression-unavailable"
  | "frame-too-large";

export type RemoteRecognitionFrameProbeReadiness =
  | "ready"
  | "screen-share-required"
  | "game-viewport-required";

export type RemoteRecognitionSharedFrameOffer = {
  sampledAt: number;
  capture(): {
    imageData: ImageData;
    roi: PixelRegion;
  };
};

export class RemoteRecognitionFrameProbeSourceError extends Error {
  constructor(
    readonly code: RemoteRecognitionFrameProbeSourceFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "RemoteRecognitionFrameProbeSourceError";
  }
}

export interface RemoteRecognitionFrameProbeSource {
  captureFrame(
    sequence: number,
    options?: { signal?: AbortSignal },
  ): Promise<RemoteRecognitionFrameCapture>;
}
