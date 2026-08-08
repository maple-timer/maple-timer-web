import type { RuneDetectionResult } from "./runeDetectionTypes";

export type RuneDetectionWorkerProcessRequest = {
  type: "detect";
  id: number;
  imageData: ImageData;
};

export type RuneDetectionWorkerRequest = RuneDetectionWorkerProcessRequest;

export type RuneDetectionWorkerProcessResponse = {
  type: "detected";
  id: number;
  result: RuneDetectionResult;
};

export type RuneDetectionWorkerErrorResponse = {
  type: "error";
  id: number;
  message: string;
};

export type RuneDetectionWorkerResponse =
  | RuneDetectionWorkerProcessResponse
  | RuneDetectionWorkerErrorResponse;
