import type {
  BuffExpiryPrecisionCountdownModelStatus,
  BuffExpiryPrecisionMatcherBundleStatus,
  BuffExpiryPrecisionMatcherModelStatus,
  BuffExpiryPrecisionModuleVersions,
  BuffExpiryPrecisionSampleRequest,
  BuffExpiryPrecisionSampleResponse,
} from "../../../runtime/buff-expiry/analysis/buffExpiryPrecisionAnalysisRuntime";

export type BuffExpiryPrecisionWorkerProcessRequest = BuffExpiryPrecisionSampleRequest & {
  requestId: number;
  type: "process";
};

export type BuffExpiryPrecisionWorkerPreloadRequest = {
  requestId: number;
  type: "preload";
  activeGroups: BuffExpiryPrecisionSampleRequest["activeGroups"];
};

export type BuffExpiryPrecisionWorkerProcessResponse = BuffExpiryPrecisionSampleResponse & {
  requestId: number;
};

export type BuffExpiryPrecisionWorkerPreloadResponse = {
  countdownModelStatus: BuffExpiryPrecisionCountdownModelStatus;
  matcherModelStatus: BuffExpiryPrecisionMatcherModelStatus;
  matcherBundleStatuses: BuffExpiryPrecisionMatcherBundleStatus[];
  moduleVersions: BuffExpiryPrecisionModuleVersions;
};

export type BuffExpiryPrecisionWorkerRequest =
  | BuffExpiryPrecisionWorkerProcessRequest
  | BuffExpiryPrecisionWorkerPreloadRequest;

export type BuffExpiryPrecisionWorkerResponse =
  | {
      requestId: number;
      ok: true;
      response: BuffExpiryPrecisionWorkerProcessResponse | BuffExpiryPrecisionWorkerPreloadResponse;
    }
  | {
      requestId: number;
      ok: false;
      error: string;
    };
