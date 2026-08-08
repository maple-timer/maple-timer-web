import { SpecialCoreAnalysisProcessor } from "../../../runtime/special-core/analysis/specialCoreAnalysisProcessor";
import type {
  SpecialCoreAlertWorkerRequest,
  SpecialCoreAlertWorkerResponse,
} from "./specialCoreAlertWorkerTypes";

const processor = new SpecialCoreAnalysisProcessor({
  now: () => performance.now(),
});

self.onmessage = (event: MessageEvent<SpecialCoreAlertWorkerRequest>) => {
  const request = event.data;
  if (request.type !== "process") {
    return;
  }

  void processor
    .process({
      imageData: request.imageData,
      sampledAt: request.sampledAt,
      buffSlotAnalysis: request.buffSlotAnalysis,
      buffSlotInputMode: request.buffSlotInputMode,
    })
    .then((response) => {
      self.postMessage({
        requestId: request.requestId,
        ok: true,
        response,
      } satisfies SpecialCoreAlertWorkerResponse);
    })
    .catch((error) => {
      self.postMessage({
        requestId: request.requestId,
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "특수코어 감지 Worker 처리에 실패했습니다.",
      } satisfies SpecialCoreAlertWorkerResponse);
    });
};
