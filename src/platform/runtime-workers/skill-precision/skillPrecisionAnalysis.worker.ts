import { SkillPrecisionAnalysisProcessor } from "../../../runtime/skill-precision/analysis/skillPrecisionAnalysisProcessor";
import type {
  SkillBuffDurationWorkerProcessResponse,
  SkillBuffDurationWorkerRequest,
  SkillBuffDurationWorkerResponse,
} from "./skillPrecisionWorkerTypes";

const processor = new SkillPrecisionAnalysisProcessor({
  now: () => performance.now(),
});

self.onmessage = async (event: MessageEvent<SkillBuffDurationWorkerRequest>) => {
  const request = event.data;
  try {
    const result = await processor.process(request);
    const response: SkillBuffDurationWorkerResponse = {
      requestId: request.requestId,
      ok: true,
      response: {
        ...result,
        requestId: request.requestId,
      } satisfies SkillBuffDurationWorkerProcessResponse,
    };
    self.postMessage(response);
  } catch (error) {
    const response: SkillBuffDurationWorkerResponse = {
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : "스킬 버프칸 감지 Worker 처리에 실패했습니다.",
    };
    self.postMessage(response);
  }
};
