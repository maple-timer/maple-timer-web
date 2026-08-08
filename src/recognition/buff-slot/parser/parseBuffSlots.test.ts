import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUFF_SLOT_DL_PARSER_VERSION,
  BUFF_SLOT_RULE_PARSER_VERSION,
  parseBuffSlots,
  resetBuffSlotDlParserFailureState,
} from "./parseBuffSlots";
import { extractBuffIcons } from "./extractBuffIcons";
import {
  BUFF_SLOT_DL_FP16_MODEL,
  BUFF_SLOT_DL_FP32_MODEL,
} from "./dlBuffIconModel";
import type { ImageLike } from "./types";

const dlMocks = vi.hoisted(() => ({
  extractBuffIconsWithDl: vi.fn(),
  invalidateBuffSlotDlParserRuntime: vi.fn(),
  isBuffSlotDlParserEnvironmentSupported: vi.fn(),
}));

vi.mock("./dlBuffIconDetector", () => dlMocks);

describe("parseBuffSlots", () => {
  beforeEach(() => {
    resetBuffSlotDlParserFailureState();
    vi.clearAllMocks();
    dlMocks.isBuffSlotDlParserEnvironmentSupported.mockReturnValue(false);
    dlMocks.extractBuffIconsWithDl.mockResolvedValue({
      icons: [],
      boxes: [],
      model: BUFF_SLOT_DL_FP16_MODEL,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the rule parser when explicitly requested", async () => {
    const image = createBlankImage(160, 90);
    const result = await parseBuffSlots(image, { engine: "rule", outputSize: 32 });
    const ruleResult = extractBuffIcons(image, { outputSize: 32 });

    expect(result.engine).toBe("rule");
    expect(result.parserVersion).toBe(BUFF_SLOT_RULE_PARSER_VERSION);
    expect(result.boxes).toEqual(ruleResult.boxes);
    expect(result.icons).toHaveLength(ruleResult.icons.length);
  });

  it("falls back to the rule parser when WebGPU is unavailable in auto mode", async () => {
    const result = await parseBuffSlots(createBlankImage(160, 90), { outputSize: 32 });

    expect(result.engine).toBe("rule");
    expect(result.parserVersion).toBe(BUFF_SLOT_RULE_PARSER_VERSION);
    expect(result.fallbackReason).toBe("dl-buff-parser-webgpu-unavailable");
  });

  it("accepts an already-cropped top-right quadrant as a DL-compatible input", async () => {
    const result = await parseBuffSlots(createBlankImage(80, 45), {
      inputMode: "topRightQuadrant",
      outputSize: 32,
    });

    expect(result.engine).toBe("rule");
    expect(result.fallbackReason).toBe("dl-buff-parser-webgpu-unavailable");
  });

  it("throws instead of falling back when DL is forced", async () => {
    await expect(
      parseBuffSlots(createBlankImage(160, 90), {
        engine: "dl",
        fallbackToRule: false,
        outputSize: 32,
      }),
    ).rejects.toThrow("dl-buff-parser-webgpu-unavailable");
  });

  it("runs explicit WASM and records provider provenance", async () => {
    dlMocks.isBuffSlotDlParserEnvironmentSupported.mockImplementation(
      (provider: string) => provider === "wasm",
    );

    const result = await parseBuffSlots(createBlankImage(160, 90), {
      engine: "dl",
      fallbackToRule: false,
      runtimeSelection: {
        executionProvider: "wasm",
        selectionSource: "user-opt-in",
      },
    });

    expect(dlMocks.extractBuffIconsWithDl).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "wasm",
      undefined,
    );
    expect(result.runtime).toMatchObject({
      executionProvider: "wasm",
      selectionSource: "user-opt-in",
      wasmThreads: 1,
      parserVersion: BUFF_SLOT_DL_PARSER_VERSION,
      modelInputWidth: 960,
      modelInputHeight: 544,
      onnxRuntimeVersion: "1.27.0",
    });
  });

  it("records the FP32 model selected by a WebGPU runtime without shader-f16", async () => {
    dlMocks.isBuffSlotDlParserEnvironmentSupported.mockReturnValue(true);
    dlMocks.extractBuffIconsWithDl.mockResolvedValueOnce({
      icons: [],
      boxes: [],
      model: BUFF_SLOT_DL_FP32_MODEL,
    });

    const result = await parseBuffSlots(createBlankImage(160, 90), {
      engine: "dl",
      fallbackToRule: false,
    });

    expect(result.parserVersion).toBe(BUFF_SLOT_DL_FP32_MODEL.id);
    expect(result.runtime).toMatchObject({
      executionProvider: "webgpu",
      parserVersion: BUFF_SLOT_DL_FP32_MODEL.id,
      modelId: BUFF_SLOT_DL_FP32_MODEL.id,
      modelInputWidth: 960,
      modelInputHeight: 544,
    });
  });

  it("does not let a WebGPU cooldown block an explicit WASM recovery", async () => {
    dlMocks.isBuffSlotDlParserEnvironmentSupported.mockReturnValue(true);
    dlMocks.extractBuffIconsWithDl
      .mockRejectedValueOnce(new Error("webgpu-device-lost"))
      .mockResolvedValueOnce({
        icons: [],
        boxes: [],
        model: BUFF_SLOT_DL_FP16_MODEL,
      });

    const webGpuResult = await parseBuffSlots(createBlankImage(160, 90));
    const wasmResult = await parseBuffSlots(createBlankImage(160, 90), {
      engine: "dl",
      fallbackToRule: false,
      runtimeSelection: {
        executionProvider: "wasm",
        selectionSource: "recovery",
      },
    });

    expect(webGpuResult.fallbackReason).toBe("webgpu-device-lost");
    expect(wasmResult.runtime?.executionProvider).toBe("wasm");
    expect(dlMocks.extractBuffIconsWithDl).toHaveBeenCalledTimes(2);
    expect(dlMocks.invalidateBuffSlotDlParserRuntime).toHaveBeenCalledWith("webgpu");
  });

  it("retries a transient DL runtime failure after the cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T00:00:00.000Z"));
    dlMocks.isBuffSlotDlParserEnvironmentSupported.mockReturnValue(true);
    dlMocks.extractBuffIconsWithDl
      .mockRejectedValueOnce(new Error("dl-buff-parser-device-lost"))
      .mockResolvedValueOnce({
        icons: [],
        boxes: [],
        model: BUFF_SLOT_DL_FP16_MODEL,
      });

    const firstResult = await parseBuffSlots(createBlankImage(160, 90));
    const coolingDownResult = await parseBuffSlots(createBlankImage(160, 90));

    expect(firstResult.engine).toBe("rule");
    expect(firstResult.fallbackReason).toBe("dl-buff-parser-device-lost");
    expect(coolingDownResult.engine).toBe("rule");
    expect(coolingDownResult.fallbackReason).toBe("dl-buff-parser-device-lost");
    expect(dlMocks.extractBuffIconsWithDl).toHaveBeenCalledTimes(1);
    expect(dlMocks.invalidateBuffSlotDlParserRuntime).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-07-11T00:00:05.000Z"));
    const recoveredResult = await parseBuffSlots(createBlankImage(160, 90));

    expect(recoveredResult.engine).toBe("dl");
    expect(recoveredResult.parserVersion).toBe(BUFF_SLOT_DL_PARSER_VERSION);
    expect(recoveredResult.fallbackReason).toBeUndefined();
    expect(dlMocks.extractBuffIconsWithDl).toHaveBeenCalledTimes(2);

    dlMocks.extractBuffIconsWithDl.mockRejectedValueOnce(
      new Error("dl-buff-parser-device-lost-again"),
    );
    vi.setSystemTime(new Date("2026-07-11T00:00:06.000Z"));
    await parseBuffSlots(createBlankImage(160, 90));
    vi.setSystemTime(new Date("2026-07-11T00:00:11.000Z"));

    const secondRecoveryResult = await parseBuffSlots(createBlankImage(160, 90));

    expect(secondRecoveryResult.engine).toBe("dl");
    expect(dlMocks.extractBuffIconsWithDl).toHaveBeenCalledTimes(4);
  });

  it("does not let an invalid input disable DL for the next frame", async () => {
    dlMocks.isBuffSlotDlParserEnvironmentSupported.mockReturnValue(true);
    dlMocks.extractBuffIconsWithDl
      .mockRejectedValueOnce(new Error("Invalid image dimensions."))
      .mockResolvedValueOnce({
        icons: [],
        boxes: [],
        model: BUFF_SLOT_DL_FP16_MODEL,
      });

    const invalidResult = await parseBuffSlots(createBlankImage(160, 90));
    const nextResult = await parseBuffSlots(createBlankImage(160, 90));

    expect(invalidResult.engine).toBe("rule");
    expect(invalidResult.fallbackReason).toBe("Invalid image dimensions.");
    expect(nextResult.engine).toBe("dl");
    expect(dlMocks.extractBuffIconsWithDl).toHaveBeenCalledTimes(2);
    expect(dlMocks.invalidateBuffSlotDlParserRuntime).not.toHaveBeenCalled();
  });
});

function createBlankImage(width: number, height: number): ImageLike {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}
