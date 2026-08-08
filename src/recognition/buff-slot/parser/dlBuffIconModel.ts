export type BuffSlotDlModel = {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly precision: "fp16" | "fp32";
  readonly requiredWebGpuFeatures: readonly string[];
  readonly inputWidth: number;
  readonly inputHeight: number;
  readonly inputChannels: number;
  readonly detectionCount: number;
};

export const BUFF_SLOT_DL_FP16_MODEL = {
  id: "buff-detector-yolov8n-q1-544x960-fp16",
  path: "/models/buff-detector-yolov8n-q1-544x960-fp16/best.onnx",
  sha256: "3049a67710201cf43d81fe273730adbfef17967158e48af041f0fce41f5afe13",
  precision: "fp16",
  requiredWebGpuFeatures: ["shader-f16"],
  inputWidth: 960,
  inputHeight: 544,
  inputChannels: 3,
  detectionCount: 10_710,
} as const satisfies BuffSlotDlModel;

export const BUFF_SLOT_DL_FP32_MODEL = {
  id: "buff-detector-yolov8n-q1-544x960-fp32",
  path: "/models/buff-detector-yolov8n-q1-544x960-fp32/best.onnx",
  sha256: "a7215fcc2b1cc5ab37d61082835a1a2203f956fbe572386586e0a0211265e0e9",
  precision: "fp32",
  requiredWebGpuFeatures: [],
  inputWidth: 960,
  inputHeight: 544,
  inputChannels: 3,
  detectionCount: 10_710,
} as const satisfies BuffSlotDlModel;

export const BUFF_SLOT_DL_MODEL = BUFF_SLOT_DL_FP16_MODEL;

export function selectBuffSlotDlWebGpuModel({
  shaderF16Enabled,
}: {
  shaderF16Enabled: boolean;
}): BuffSlotDlModel {
  return shaderF16Enabled
    ? BUFF_SLOT_DL_FP16_MODEL
    : BUFF_SLOT_DL_FP32_MODEL;
}
