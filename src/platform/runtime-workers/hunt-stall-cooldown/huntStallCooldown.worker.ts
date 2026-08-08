import { createHuntStallCooldownVisualActivity } from "../../../recognition/hunt-stall/cooldown/huntStallCooldownActivity";
import { recognizeCooldownDigits } from "../../../recognition/cooldown-digit/recognizeCooldownDigits";
import type {
  HuntStallCooldownWorkerRequest,
  HuntStallCooldownWorkerResponse,
} from "./huntStallCooldownWorkerTypes";

self.onmessage = (event: MessageEvent<HuntStallCooldownWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "reset") {
      postResponse({ type: "reset", id: request.id });
      return;
    }

    const totalStartedAt = performance.now();
    const recognitionStartedAt = performance.now();
    const result = recognizeCooldownDigits(request.imageData);
    const recognitionMs = Math.round((performance.now() - recognitionStartedAt) * 10) / 10;
    const activity = createHuntStallCooldownVisualActivity(request.imageData);
    const totalMs = Math.round((performance.now() - totalStartedAt) * 10) / 10;

    postResponse({
      type: "processed",
      id: request.id,
      result,
      activity,
      performance: {
        recognitionMs,
        totalMs,
      },
    });
  } catch (error) {
    postResponse({
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : "hunt-stall-cooldown-worker-error",
    });
  }
};

function postResponse(response: HuntStallCooldownWorkerResponse): void {
  self.postMessage(response);
}
