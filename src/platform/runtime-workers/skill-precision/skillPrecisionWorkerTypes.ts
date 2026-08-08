import type {
  SkillBuffDurationSampleRequest,
  SkillBuffDurationSampleResponse,
} from "../../../runtime/skill-precision/analysis/skillPrecisionAnalysisRuntime";

export type SkillBuffDurationWorkerProcessRequest = SkillBuffDurationSampleRequest & {
  requestId: number;
  type: "process";
};

export type SkillBuffDurationWorkerProcessResponse = SkillBuffDurationSampleResponse & {
  requestId: number;
};

export type SkillBuffDurationWorkerRequest = SkillBuffDurationWorkerProcessRequest;

export type SkillBuffDurationWorkerResponse =
  | {
      requestId: number;
      ok: true;
      response: SkillBuffDurationWorkerProcessResponse;
    }
  | {
      requestId: number;
      ok: false;
      error: string;
    };
