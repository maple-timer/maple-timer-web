import {
  processBoosterExpiryFrame,
  resetBoosterExpiryWorkerCore,
} from "../../../recognition/booster-expiry/boosterExpiryWorkerCore";
import type {
  BoosterExpiryWorkerRequest,
  BoosterExpiryWorkerResponse,
} from "./boosterExpiryWorkerTypes";

self.onmessage = (event: MessageEvent<BoosterExpiryWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "reset") {
      resetBoosterExpiryWorkerCore();
      postResponse({ type: "reset", id: request.id });
      return;
    }

    const totalStartedAt = performance.now();
    const recognitionStartedAt = performance.now();
    const result = processBoosterExpiryFrame(request.imageData, request.timestampMs);
    const recognitionMs = Math.round((performance.now() - recognitionStartedAt) * 10) / 10;
    const totalMs = Math.round((performance.now() - totalStartedAt) * 10) / 10;

    postResponse({
      type: "processed",
      id: request.id,
      result,
      performance: {
        recognitionMs,
        totalMs,
      },
    });
  } catch (error) {
    postResponse({
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : "booster-expiry-worker-error",
    });
  }
};

function postResponse(response: BoosterExpiryWorkerResponse): void {
  self.postMessage(response);
}
