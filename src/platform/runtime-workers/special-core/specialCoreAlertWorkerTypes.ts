import type {
  SpecialCoreSampleRequest,
  SpecialCoreSampleResponse,
} from "../../../runtime/special-core/analysis/specialCoreAnalysisRuntime";

export type SpecialCoreAlertWorkerProcessRequest = SpecialCoreSampleRequest & {
  type: "process";
  requestId: number;
};

export type SpecialCoreAlertWorkerRequest = SpecialCoreAlertWorkerProcessRequest;

export type SpecialCoreAlertWorkerResponse =
  | {
      requestId: number;
      ok: true;
      response: SpecialCoreSampleResponse;
    }
  | {
      requestId: number;
      ok: false;
      error: string;
    };
