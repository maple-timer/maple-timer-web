import type {
  HuntStallExperienceProcessInput,
  HuntStallExperienceProcessResult,
} from "../../../runtime/hunt-stall/experience/huntStallExperienceRuntime";

export type HuntStallOcrWorkerProcessRequest = HuntStallExperienceProcessInput & {
  type: "process";
  id: number;
};

export type HuntStallOcrWorkerResetRequest = {
  type: "reset";
  id: number;
};

export type HuntStallOcrWorkerRequest =
  | HuntStallOcrWorkerProcessRequest
  | HuntStallOcrWorkerResetRequest;

export type HuntStallOcrWorkerProcessResponse = HuntStallExperienceProcessResult & {
  type: "processed";
  id: number;
};

export type HuntStallOcrWorkerResetResponse = {
  type: "reset";
  id: number;
};

export type HuntStallOcrWorkerErrorResponse = {
  type: "error";
  id: number;
  message: string;
};

export type HuntStallOcrWorkerResponse =
  | HuntStallOcrWorkerProcessResponse
  | HuntStallOcrWorkerResetResponse
  | HuntStallOcrWorkerErrorResponse;
