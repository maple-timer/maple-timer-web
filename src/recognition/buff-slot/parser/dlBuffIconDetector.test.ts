import { describe, expect, it, vi } from "vitest";
import {
  createWebGpuModelSession,
  preprocessBuffSlotDetectorInput,
} from "./dlBuffIconDetector";
import {
  BUFF_SLOT_DL_FP16_MODEL,
  BUFF_SLOT_DL_FP32_MODEL,
  BUFF_SLOT_DL_MODEL,
  selectBuffSlotDlWebGpuModel,
} from "./dlBuffIconModel";
import type { ImageLike } from "./types";
import type { PrecisionParserDiagnosticEvent } from "../../../contracts/recognition/precisionParserDiagnostics";

const FILL_VALUE = 114 / 255;

describe("buff-slot DL model contract", () => {
  it("uses the reviewed rectangular runtime artifact", () => {
    expect(BUFF_SLOT_DL_MODEL).toMatchObject({
      id: "buff-detector-yolov8n-q1-544x960-fp16",
      path: "/models/buff-detector-yolov8n-q1-544x960-fp16/best.onnx",
      inputWidth: 960,
      inputHeight: 544,
      inputChannels: 3,
      detectionCount: 10_710,
    });
  });

  it("uses FP32 on WebGPU devices without shader-f16", () => {
    expect(selectBuffSlotDlWebGpuModel({ shaderF16Enabled: true })).toBe(
      BUFF_SLOT_DL_FP16_MODEL,
    );
    expect(selectBuffSlotDlWebGpuModel({ shaderF16Enabled: false })).toBe(
      BUFF_SLOT_DL_FP32_MODEL,
    );
    expect(BUFF_SLOT_DL_FP32_MODEL).toMatchObject({
      id: "buff-detector-yolov8n-q1-544x960-fp32",
      inputWidth: 960,
      inputHeight: 544,
      detectionCount: 10_710,
      requiredWebGpuFeatures: [],
    });
  });

  it("retries an FP16 compatibility rejection with FP32 on the same WebGPU runtime", async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("Program Transpose requires f16"))
      .mockResolvedValueOnce({ inputNames: ["images"], outputNames: ["output0"] });
    const events: PrecisionParserDiagnosticEvent[] = [];

    const result = await createWebGpuModelSession(
      { InferenceSession: { create } } as never,
      true,
      (event) => events.push(event),
      { vendor: "nvidia", architecture: "pascal" },
    );

    expect(create).toHaveBeenNthCalledWith(
      1,
      BUFF_SLOT_DL_FP16_MODEL.path,
      expect.objectContaining({ executionProviders: ["webgpu"] }),
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      BUFF_SLOT_DL_FP32_MODEL.path,
      expect.objectContaining({ executionProviders: ["webgpu"] }),
    );
    expect(result.model).toBe(BUFF_SLOT_DL_FP32_MODEL);
    expect(events[events.length - 1]).toMatchObject({
      stage: "model-session",
      status: "passed",
      details: {
        modelId: BUFF_SLOT_DL_FP32_MODEL.id,
        fallbackFromModelId: BUFF_SLOT_DL_FP16_MODEL.id,
      },
    });
  });

  it("letterboxes a full-frame top-right quadrant without stretching it", () => {
    const image = createSolidImage(320, 180, [255, 0, 0, 255]);
    const result = preprocessBuffSlotDetectorInput(image, "fullFrame");
    const area = BUFF_SLOT_DL_MODEL.inputWidth * BUFF_SLOT_DL_MODEL.inputHeight;

    expect(result.crop).toEqual({ x: 160, y: 0, width: 160, height: 90 });
    expect(result.scale).toBe(6);
    expect(result.padX).toBe(0);
    expect(result.padY).toBe(2);
    expect(result.input).toHaveLength(BUFF_SLOT_DL_MODEL.inputChannels * area);
    expect(result.input[0]).toBeCloseTo(FILL_VALUE);

    const firstImagePixel = result.padY * BUFF_SLOT_DL_MODEL.inputWidth;
    expect(result.input[firstImagePixel]).toBe(1);
    expect(result.input[area + firstImagePixel]).toBe(0);
    expect(result.input[area * 2 + firstImagePixel]).toBe(0);
  });

  it("adds horizontal padding for a tall pre-cropped quadrant", () => {
    const image = createSolidImage(100, 100, [0, 255, 0, 255]);
    const result = preprocessBuffSlotDetectorInput(image, "topRightQuadrant");
    const area = BUFF_SLOT_DL_MODEL.inputWidth * BUFF_SLOT_DL_MODEL.inputHeight;

    expect(result.crop).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(result.padX).toBe(208);
    expect(result.padY).toBe(0);
    expect(result.input[0]).toBeCloseTo(FILL_VALUE);

    const firstImagePixel = result.padX;
    expect(result.input[firstImagePixel]).toBe(0);
    expect(result.input[area + firstImagePixel]).toBe(1);
    expect(result.input[area * 2 + firstImagePixel]).toBe(0);
  });
});

function createSolidImage(
  width: number,
  height: number,
  color: readonly [number, number, number, number],
): ImageLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = color[0];
    data[index + 1] = color[1];
    data[index + 2] = color[2];
    data[index + 3] = color[3];
  }
  return { width, height, data };
}
