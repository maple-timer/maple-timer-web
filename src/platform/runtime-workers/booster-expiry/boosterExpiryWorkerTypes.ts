import type {
  BoosterExpiryWorkerPerformance,
  BoosterExpiryWorkerResult,
} from "../../../recognition/booster-expiry/boosterExpiryRecognitionContract";

export type BoosterExpiryWorkerProcessRequest = {
  type: "process";
  id: number;
  imageData: ImageData;
  timestampMs: number;
};

export type BoosterExpiryWorkerResetRequest = {
  type: "reset";
  id: number;
};

export type BoosterExpiryWorkerRequest =
  | BoosterExpiryWorkerProcessRequest
  | BoosterExpiryWorkerResetRequest;

export type BoosterExpiryWorkerProcessResponse = {
  type: "processed";
  id: number;
  result: BoosterExpiryWorkerResult;
  performance: BoosterExpiryWorkerPerformance;
};

export type BoosterExpiryWorkerResetResponse = {
  type: "reset";
  id: number;
};

export type BoosterExpiryWorkerErrorResponse = {
  type: "error";
  id: number;
  message: string;
};

export type BoosterExpiryWorkerResponse =
  | BoosterExpiryWorkerProcessResponse
  | BoosterExpiryWorkerResetResponse
  | BoosterExpiryWorkerErrorResponse;
