import { BuffExpiryPrecisionAnalysisProcessor } from "../../../runtime/buff-expiry/analysis/buffExpiryPrecisionAnalysisProcessor";
import type {
  BuffExpiryPrecisionWorkerProcessRequest,
  BuffExpiryPrecisionWorkerProcessResponse,
  BuffExpiryPrecisionWorkerRequest,
  BuffExpiryPrecisionWorkerResponse,
} from "./buffExpiryPrecisionWorkerTypes";

const processor = new BuffExpiryPrecisionAnalysisProcessor({
  now: () => performance.now(),
});

self.onmessage = async (event: MessageEvent<BuffExpiryPrecisionWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "preload") {
      const result = await processor.preload(request.activeGroups);
      const response: BuffExpiryPrecisionWorkerResponse = {
        requestId: request.requestId,
        ok: true,
        response: result,
      };
      self.postMessage(response);
      return;
    }

    const result = await processor.process(request);
    const response: BuffExpiryPrecisionWorkerResponse = {
      requestId: request.requestId,
      ok: true,
      response: {
        ...result,
        requestId: request.requestId,
      } satisfies BuffExpiryPrecisionWorkerProcessResponse,
    };
    self.postMessage(response);
  } catch (error) {
    const response: BuffExpiryPrecisionWorkerResponse = {
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : "버프 종료 정밀 감지 Worker 처리에 실패했습니다.",
    };
    self.postMessage(response);
  }
};
