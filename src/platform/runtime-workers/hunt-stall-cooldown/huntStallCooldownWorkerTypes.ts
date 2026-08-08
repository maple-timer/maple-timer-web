import type { CooldownDigitRecognitionResult } from "../../../contracts/recognition/cooldownDigitRecognition";
import type { HuntStallCooldownVisualActivity } from "../../../recognition/hunt-stall/cooldown/huntStallCooldownActivity";

export type HuntStallCooldownWorkerProcessRequest = {
  type: "process";
  id: number;
  imageData: ImageData;
};

export type HuntStallCooldownWorkerResetRequest = {
  type: "reset";
  id: number;
};

export type HuntStallCooldownWorkerRequest =
  | HuntStallCooldownWorkerProcessRequest
  | HuntStallCooldownWorkerResetRequest;

export type HuntStallCooldownWorkerPerformance = {
  recognitionMs: number;
  totalMs: number;
};

export type HuntStallCooldownWorkerProcessResponse = {
  type: "processed";
  id: number;
  result: CooldownDigitRecognitionResult;
  activity: HuntStallCooldownVisualActivity;
  performance: HuntStallCooldownWorkerPerformance;
};

export type HuntStallCooldownWorkerResetResponse = {
  type: "reset";
  id: number;
};

export type HuntStallCooldownWorkerErrorResponse = {
  type: "error";
  id: number;
  message: string;
};

export type HuntStallCooldownWorkerResponse =
  | HuntStallCooldownWorkerProcessResponse
  | HuntStallCooldownWorkerResetResponse
  | HuntStallCooldownWorkerErrorResponse;
