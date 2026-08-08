import { runDetectionPipeline } from "./pipeline.js?v=row-detector-v3-20260524";

export const DEFAULT_OPTIONS = {
  maxDetectWidth: 10000,
  minSide: 26,
  maxSide: 112,
  detectorMode: "v3",
};

export function detectBuffs(imageData, options = {}) {
  return runDetectionPipeline(imageData, { ...DEFAULT_OPTIONS, ...options });
}
