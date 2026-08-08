import { HuntStallExperienceProcessor } from "../../../runtime/hunt-stall/experience/huntStallExperienceProcessor";
import type {
  HuntStallOcrWorkerRequest,
  HuntStallOcrWorkerResponse,
} from "./huntStallOcrWorkerTypes";

const processor = new HuntStallExperienceProcessor(() => performance.now());

self.onmessage = (event: MessageEvent<HuntStallOcrWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "reset") {
      processor.reset();
      postResponse({ type: "reset", id: request.id });
      return;
    }

    postResponse({
      type: "processed",
      id: request.id,
      ...processor.process(request),
    });
  } catch (error) {
    postResponse({
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : "hunt-stall-worker-error",
    });
  }
};

function postResponse(response: HuntStallOcrWorkerResponse): void {
  self.postMessage(response);
}
