import { detectRuneInMinimapWithOnnx } from "./runeOnnxDetector";
import type {
  RuneDetectionWorkerRequest,
  RuneDetectionWorkerResponse,
} from "./runeDetectionWorkerTypes";

self.onmessage = async (event: MessageEvent<RuneDetectionWorkerRequest>) => {
  const request = event.data;
  try {
    const result = await detectRuneInMinimapWithOnnx(request.imageData);
    postResponse({
      type: "detected",
      id: request.id,
      result,
    });
  } catch (error) {
    postResponse({
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : "rune-detection-worker-error",
    });
  }
};

function postResponse(response: RuneDetectionWorkerResponse): void {
  self.postMessage(response);
}
