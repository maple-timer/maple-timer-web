import { DEFAULT_MAX_ICONS, DEFAULT_OUTPUT_SIZE } from "./detector/constants.js";
import { cropAndResize } from "./detector/crop.js";
import { clamp, nms } from "./detector/math.js";
import { orderBuffIconBoxes } from "./resultOrder.js";
import type {
  BuffIconBox,
  Candidate,
  ExtractBuffIconsOptions,
  ExtractBuffIconsResult,
  ImageLike,
  Rect,
} from "./types.js";
import {
  createPrecisionParserDiagnosticEvent,
  getPrecisionParserDiagnosticEvent,
  PrecisionParserDiagnosticError,
  type PrecisionParserDiagnosticEvent,
  type PrecisionParserDiagnosticStage,
} from "../../../contracts/recognition/precisionParserDiagnostics.js";
import { requestPrecisionWebGpuDevice } from "./precisionWebGpuDevice.js";
import {
  BUFF_SLOT_DL_FP16_MODEL,
  BUFF_SLOT_DL_FP32_MODEL,
  BUFF_SLOT_DL_MODEL,
  selectBuffSlotDlWebGpuModel,
  type BuffSlotDlModel,
} from "./dlBuffIconModel.js";
import type { PrecisionParserExecutionProvider } from "../../../contracts/recognition/precisionParserRuntime.js";

export { BUFF_SLOT_DL_MODEL } from "./dlBuffIconModel.js";

type OrtModule = typeof import("onnxruntime-web/webgpu");
type OrtInferenceSession = Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>;

const CONFIDENCE_THRESHOLD = 0.5;
const NMS_IOU_THRESHOLD = 0.5;
const FILL_VALUE = 114 / 255;

type LetterboxInfo = {
  crop: Rect;
  scale: number;
  padX: number;
  padY: number;
};

type DlPreprocessResult = LetterboxInfo & {
  input: Float32Array;
};

export type ExtractBuffIconsWithDlResult = ExtractBuffIconsResult & {
  model: BuffSlotDlModel;
};

const WASM_PATH = "/vendor/onnxruntime-web/ort-wasm-simd-threaded.wasm";
const runtimePromises = new Map<
  PrecisionParserExecutionProvider,
  Promise<DlBuffIconDetectorRuntime>
>();

export async function extractBuffIconsWithDl(
  image: ImageLike,
  options: ExtractBuffIconsOptions = {},
  executionProvider: PrecisionParserExecutionProvider = "webgpu",
  onDiagnostic?: (event: PrecisionParserDiagnosticEvent) => void,
): Promise<ExtractBuffIconsWithDlResult> {
  assertDlSupportedOptions(options);
  assertImage(image);
  const runtime = await getRuntime(executionProvider, onDiagnostic);
  return runtime.extract(image, options, onDiagnostic);
}

export function isBuffSlotDlParserEnvironmentSupported(
  executionProvider: PrecisionParserExecutionProvider = "webgpu",
): boolean {
  if (executionProvider === "wasm") {
    return typeof WebAssembly !== "undefined";
  }
  const navigatorWithGpu = globalThis.navigator as (Navigator & { gpu?: unknown }) | undefined;
  return Boolean(navigatorWithGpu?.gpu);
}

export function invalidateBuffSlotDlParserRuntime(
  executionProvider?: PrecisionParserExecutionProvider,
): void {
  const staleRuntimePromises = executionProvider
    ? [runtimePromises.get(executionProvider)].filter(Boolean)
    : [...runtimePromises.values()];
  if (executionProvider) {
    runtimePromises.delete(executionProvider);
  } else {
    runtimePromises.clear();
  }
  if (staleRuntimePromises.length <= 0) {
    return;
  }

  staleRuntimePromises.forEach((runtimePromise) => {
    void runtimePromise
      ?.then((runtime) => runtime.release())
      .catch(() => undefined);
  });
}

async function getRuntime(
  executionProvider: PrecisionParserExecutionProvider,
  onDiagnostic?: (event: PrecisionParserDiagnosticEvent) => void,
): Promise<DlBuffIconDetectorRuntime> {
  const existingRuntimePromise = runtimePromises.get(executionProvider);
  if (existingRuntimePromise) {
    return existingRuntimePromise;
  }

  const nextRuntimePromise = initializeRuntime(executionProvider, onDiagnostic);
  runtimePromises.set(executionProvider, nextRuntimePromise);
  void nextRuntimePromise.catch(() => {
    if (runtimePromises.get(executionProvider) === nextRuntimePromise) {
      runtimePromises.delete(executionProvider);
    }
  });
  return nextRuntimePromise;
}

async function initializeRuntime(
  executionProvider: PrecisionParserExecutionProvider,
  onDiagnostic?: (event: PrecisionParserDiagnosticEvent) => void,
): Promise<DlBuffIconDetectorRuntime> {
  if (executionProvider === "wasm") {
    return initializeWasmRuntime(onDiagnostic);
  }
  const gpu = await requestPrecisionWebGpuDevice({
    optionalFeatures: BUFF_SLOT_DL_FP16_MODEL.requiredWebGpuFeatures,
    onDiagnostic,
  });
  let ortRuntime: OrtModule;
  try {
    ortRuntime = await runDiagnosticStage(
      "onnx-runtime",
      "onnx-runtime-import-failed",
      () => import("onnxruntime-web/webgpu"),
      onDiagnostic,
    );
  } catch (error) {
    gpu.device.destroy?.();
    throw error;
  }

  configureOrtWebGpu(ortRuntime);
  ortRuntime.env.webgpu.device = gpu.device as never;
  let runtime: { session: OrtInferenceSession; model: BuffSlotDlModel };
  try {
    runtime = await createWebGpuModelSession(
      ortRuntime,
      gpu.features.shaderF16Enabled,
      onDiagnostic,
      gpu.adapterDetails,
    );
  } catch (error) {
    gpu.device.destroy?.();
    throw error;
  }
  return new DlBuffIconDetectorRuntime(
    ortRuntime,
    runtime.session,
    gpu.device,
    runtime.model,
  );
}

export async function createWebGpuModelSession(
  ortRuntime: OrtModule,
  shaderF16Enabled: boolean,
  onDiagnostic: ((event: PrecisionParserDiagnosticEvent) => void) | undefined,
  adapterDetails: PrecisionParserDiagnosticEvent["details"],
): Promise<{ session: OrtInferenceSession; model: BuffSlotDlModel }> {
  const primaryModel = selectBuffSlotDlWebGpuModel({ shaderF16Enabled });
  const primaryDetails = modelDiagnosticDetails(primaryModel, adapterDetails);
  emitDiagnostic(onDiagnostic, {
    stage: "model-session",
    status: "checking",
    details: primaryDetails,
  });

  try {
    const session = await createWebGpuSession(ortRuntime, primaryModel);
    emitDiagnostic(onDiagnostic, {
      stage: "model-session",
      status: "passed",
      details: primaryDetails,
    });
    return { session, model: primaryModel };
  } catch (error) {
    if (primaryModel.precision === "fp16" && isShaderF16CompatibilityError(error)) {
      const fallbackDetails = modelDiagnosticDetails(BUFF_SLOT_DL_FP32_MODEL, {
        ...adapterDetails,
        fallbackFromModelId: primaryModel.id,
      });
      emitDiagnostic(onDiagnostic, {
        stage: "model-session",
        status: "checking",
        details: fallbackDetails,
      });
      try {
        const session = await createWebGpuSession(ortRuntime, BUFF_SLOT_DL_FP32_MODEL);
        emitDiagnostic(onDiagnostic, {
          stage: "model-session",
          status: "passed",
          details: fallbackDetails,
        });
        return { session, model: BUFF_SLOT_DL_FP32_MODEL };
      } catch (fallbackError) {
        throwModelSessionDiagnostic(fallbackError, fallbackDetails, onDiagnostic);
      }
    }
    throwModelSessionDiagnostic(error, primaryDetails, onDiagnostic);
  }
}

function createWebGpuSession(
  ortRuntime: OrtModule,
  model: BuffSlotDlModel,
): Promise<OrtInferenceSession> {
  return ortRuntime.InferenceSession.create(model.path, {
    executionProviders: ["webgpu"],
    graphOptimizationLevel: "all",
  });
}

function throwModelSessionDiagnostic(
  error: unknown,
  details: PrecisionParserDiagnosticEvent["details"],
  onDiagnostic?: (event: PrecisionParserDiagnosticEvent) => void,
): never {
  const diagnostic = emitDiagnostic(onDiagnostic, {
    stage: "model-session",
    status: "failed",
    code: "model-session-create-failed",
    technicalMessage: getErrorMessage(error),
    details,
  });
  throw new PrecisionParserDiagnosticError(
    diagnostic.technicalMessage ?? "model-session-create-failed",
    diagnostic,
  );
}

function isShaderF16CompatibilityError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("requires f16") || message.includes("shader-f16");
}

function modelDiagnosticDetails(
  model: BuffSlotDlModel,
  details: PrecisionParserDiagnosticEvent["details"] = {},
): PrecisionParserDiagnosticEvent["details"] {
  return {
    ...details,
    modelId: model.id,
    modelPrecision: model.precision,
    modelInput: `${model.inputWidth}x${model.inputHeight}`,
  };
}

function configureOrtWebGpu(ortModule: OrtModule): void {
  ortModule.env.wasm.numThreads = 1;
  ortModule.env.wasm.proxy = false;
}

async function initializeWasmRuntime(
  onDiagnostic?: (event: PrecisionParserDiagnosticEvent) => void,
): Promise<DlBuffIconDetectorRuntime> {
  const model = BUFF_SLOT_DL_FP16_MODEL;
  const ortRuntime = await runDiagnosticStage(
    "onnx-runtime",
    "onnx-runtime-import-failed",
    () => import("onnxruntime-web/wasm"),
    onDiagnostic,
    { executionProvider: "wasm", wasmThreads: 1 },
  );
  ortRuntime.env.wasm.numThreads = 1;
  ortRuntime.env.wasm.proxy = false;
  ortRuntime.env.wasm.wasmPaths = { wasm: WASM_PATH };
  const session = await runDiagnosticStage(
    "model-session",
    "model-session-create-failed",
    () =>
      ortRuntime.InferenceSession.create(model.path, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      }),
    onDiagnostic,
    modelDiagnosticDetails(model, { executionProvider: "wasm", wasmThreads: 1 }),
  );
  return new DlBuffIconDetectorRuntime(ortRuntime, session, null, model);
}

class DlBuffIconDetectorRuntime {
  private readonly inputName: string;
  private readonly outputName: string;

  constructor(
    private readonly ort: OrtModule,
    private readonly session: OrtInferenceSession,
    private readonly device: { destroy?: () => void } | null,
    private readonly model: BuffSlotDlModel,
  ) {
    this.inputName = session.inputNames[0] ?? "images";
    this.outputName = session.outputNames[0] ?? "output0";
  }

  private hasCompletedInference = false;

  async extract(
    image: ImageLike,
    options: ExtractBuffIconsOptions,
    onDiagnostic?: (event: PrecisionParserDiagnosticEvent) => void,
  ): Promise<ExtractBuffIconsWithDlResult> {
    const outputSize = options.outputSize ?? DEFAULT_OUTPUT_SIZE;
    const maxIcons = options.maxIcons ?? DEFAULT_MAX_ICONS;
    const preprocessed = preprocessBuffSlotDetectorInput(
      image,
      options.inputMode,
      this.model,
    );
    const inputTensor = new this.ort.Tensor("float32", preprocessed.input, [
      1,
      this.model.inputChannels,
      this.model.inputHeight,
      this.model.inputWidth,
    ]);
    let outputs: Awaited<ReturnType<OrtInferenceSession["run"]>> | null = null;

    const isReadinessInference = !this.hasCompletedInference;
    if (isReadinessInference) {
      emitDiagnostic(onDiagnostic, {
        stage: "first-inference",
        status: "checking",
        details: modelDiagnosticDetails(this.model),
      });
    }
    try {
      outputs = await this.session.run({ [this.inputName]: inputTensor });
      const output = outputs[this.outputName] ?? outputs[this.session.outputNames[0] ?? ""];
      const outputData = output?.data;
      if (!(outputData instanceof Float32Array)) {
        throw new Error("dl-buff-parser-invalid-output");
      }

      const boxes = orderBuffIconBoxes(
        nms(
          decodeYoloOutput(outputData, output.dims, preprocessed, image, this.model)
            .sort((left, right) => right.score - left.score)
            .slice(0, Math.max(maxIcons * 3, maxIcons)),
          NMS_IOU_THRESHOLD,
        ).slice(0, maxIcons),
      );
      const icons = boxes.map((box) => cropAndResize(image, box.x, box.y, box.size, outputSize));
      const result = {
        icons,
        boxes,
        model: this.model,
        debug: options.includeDebug
          ? {
              roi: preprocessed.crop,
              slotSize: undefined,
              pitch: undefined,
              candidates: boxes.map(toDebugCandidate),
              supportedCandidates: boxes.map(toDebugCandidate),
            }
          : undefined,
      };
      if (isReadinessInference) {
        this.hasCompletedInference = true;
        emitDiagnostic(onDiagnostic, {
          stage: "first-inference",
          status: "passed",
          details: modelDiagnosticDetails(this.model, { boxCount: boxes.length }),
        });
      }
      return result;
    } catch (error) {
      const diagnostic = emitDiagnostic(onDiagnostic, {
        stage: "first-inference",
        status: "failed",
        code: "model-inference-failed",
        technicalMessage: getErrorMessage(error),
        details: modelDiagnosticDetails(this.model),
      });
      throw new PrecisionParserDiagnosticError(
        diagnostic.technicalMessage ?? "model inference failed",
        diagnostic,
      );
    } finally {
      disposeTensor(inputTensor);
      disposeOutputs(outputs);
    }
  }

  async release(): Promise<void> {
    try {
      await this.session.release();
    } finally {
      this.device?.destroy?.();
    }
  }
}

async function runDiagnosticStage<T>(
  stage: PrecisionParserDiagnosticStage,
  code: string,
  action: () => Promise<T>,
  onDiagnostic?: (event: PrecisionParserDiagnosticEvent) => void,
  details: PrecisionParserDiagnosticEvent["details"] = {},
): Promise<T> {
  emitDiagnostic(onDiagnostic, { stage, status: "checking", details });
  try {
    const result = await action();
    emitDiagnostic(onDiagnostic, { stage, status: "passed", details });
    return result;
  } catch (error) {
    const existing = getPrecisionParserDiagnosticEvent(error);
    if (existing) {
      throw error;
    }
    const diagnostic = emitDiagnostic(onDiagnostic, {
      stage,
      status: "failed",
      code,
      technicalMessage: getErrorMessage(error),
      details,
    });
    throw new PrecisionParserDiagnosticError(
      diagnostic.technicalMessage ?? code,
      diagnostic,
    );
  }
}

function emitDiagnostic(
  onDiagnostic: ((event: PrecisionParserDiagnosticEvent) => void) | undefined,
  event: Omit<PrecisionParserDiagnosticEvent, "code" | "technicalMessage" | "details"> &
    Partial<Pick<PrecisionParserDiagnosticEvent, "code" | "technicalMessage" | "details">>,
): PrecisionParserDiagnosticEvent {
  const normalized = createPrecisionParserDiagnosticEvent(event);
  onDiagnostic?.(normalized);
  return normalized;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return typeof error === "string" && error ? error : "precision parser runtime error";
}

export function preprocessBuffSlotDetectorInput(
  image: ImageLike,
  inputMode: ExtractBuffIconsOptions["inputMode"],
  model: BuffSlotDlModel = BUFF_SLOT_DL_MODEL,
): DlPreprocessResult {
  const crop: Rect = inputMode === "topRightQuadrant"
    ? { x: 0, y: 0, width: image.width, height: image.height }
    : {
        x: Math.floor(image.width / 2),
        y: 0,
        width: image.width - Math.floor(image.width / 2),
        height: Math.floor(image.height / 2),
      };
  const scale = Math.min(
    model.inputWidth / crop.width,
    model.inputHeight / crop.height,
  );
  const resizedWidth = Math.round(crop.width * scale);
  const resizedHeight = Math.round(crop.height * scale);
  const padX = Math.max(
    0,
    Math.round((model.inputWidth - resizedWidth) / 2 - 0.1),
  );
  const padY = Math.max(
    0,
    Math.round((model.inputHeight - resizedHeight) / 2 - 0.1),
  );
  const area = model.inputWidth * model.inputHeight;
  const input = new Float32Array(model.inputChannels * area);
  input.fill(FILL_VALUE);

  for (let resizedY = 0; resizedY < resizedHeight; resizedY += 1) {
    const targetY = padY + resizedY;
    const sourceY = (resizedY + 0.5) * crop.height / resizedHeight - 0.5 + crop.y;
    for (let resizedX = 0; resizedX < resizedWidth; resizedX += 1) {
      const targetX = padX + resizedX;
      const sourceX = (resizedX + 0.5) * crop.width / resizedWidth - 0.5 + crop.x;
      const pixel = sampleBilinearRgb(image, sourceX, sourceY);
      const index = targetY * model.inputWidth + targetX;
      input[index] = pixel.r / 255;
      input[area + index] = pixel.g / 255;
      input[area * 2 + index] = pixel.b / 255;
    }
  }

  return {
    crop,
    scale,
    padX,
    padY,
    input,
  };
}

function sampleBilinearRgb(image: ImageLike, x: number, y: number): { r: number; g: number; b: number } {
  const x1 = Math.floor(clamp(x, 0, image.width - 1));
  const y1 = Math.floor(clamp(y, 0, image.height - 1));
  const x2 = Math.min(image.width - 1, x1 + 1);
  const y2 = Math.min(image.height - 1, y1 + 1);
  const wx = clamp(x - x1, 0, 1);
  const wy = clamp(y - y1, 0, 1);
  const i11 = (y1 * image.width + x1) * 4;
  const i21 = (y1 * image.width + x2) * 4;
  const i12 = (y2 * image.width + x1) * 4;
  const i22 = (y2 * image.width + x2) * 4;

  return {
    r: interpolateChannel(image.data, i11, i21, i12, i22, wx, wy, 0),
    g: interpolateChannel(image.data, i11, i21, i12, i22, wx, wy, 1),
    b: interpolateChannel(image.data, i11, i21, i12, i22, wx, wy, 2),
  };
}

function interpolateChannel(
  data: ArrayLike<number>,
  i11: number,
  i21: number,
  i12: number,
  i22: number,
  wx: number,
  wy: number,
  channel: number,
): number {
  const top = (data[i11 + channel] ?? 0) * (1 - wx) + (data[i21 + channel] ?? 0) * wx;
  const bottom = (data[i12 + channel] ?? 0) * (1 - wx) + (data[i22 + channel] ?? 0) * wx;
  return top * (1 - wy) + bottom * wy;
}

function decodeYoloOutput(
  data: Float32Array,
  dims: readonly number[],
  letterbox: LetterboxInfo,
  image: ImageLike,
  model: BuffSlotDlModel,
): BuffIconBox[] {
  if (dims.length !== 3) {
    throw new Error("dl-buff-parser-invalid-output-shape");
  }

  if (dims[1] === 5) {
    return decodeChannelFirstOutput(
      data,
      dims[2] ?? model.detectionCount,
      letterbox,
      image,
    );
  }
  if (dims[2] === 5) {
    return decodeChannelLastOutput(
      data,
      dims[1] ?? model.detectionCount,
      letterbox,
      image,
    );
  }

  throw new Error("dl-buff-parser-invalid-output-shape");
}

function decodeChannelFirstOutput(
  data: Float32Array,
  count: number,
  letterbox: LetterboxInfo,
  image: ImageLike,
): BuffIconBox[] {
  const boxes: BuffIconBox[] = [];
  for (let index = 0; index < count; index += 1) {
    const confidence = data[4 * count + index] ?? 0;
    if (confidence < CONFIDENCE_THRESHOLD) {
      continue;
    }
    const cx = data[index] ?? 0;
    const cy = data[count + index] ?? 0;
    const width = data[2 * count + index] ?? 0;
    const height = data[3 * count + index] ?? 0;
    boxes.push(toSourceSquareBox(cx, cy, width, height, confidence, letterbox, image));
  }
  return boxes.filter(isValidBox);
}

function decodeChannelLastOutput(
  data: Float32Array,
  count: number,
  letterbox: LetterboxInfo,
  image: ImageLike,
): BuffIconBox[] {
  const boxes: BuffIconBox[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = index * 5;
    const confidence = data[offset + 4] ?? 0;
    if (confidence < CONFIDENCE_THRESHOLD) {
      continue;
    }
    boxes.push(
      toSourceSquareBox(
        data[offset] ?? 0,
        data[offset + 1] ?? 0,
        data[offset + 2] ?? 0,
        data[offset + 3] ?? 0,
        confidence,
        letterbox,
        image,
      ),
    );
  }
  return boxes.filter(isValidBox);
}

function toSourceSquareBox(
  cx: number,
  cy: number,
  width: number,
  height: number,
  confidence: number,
  letterbox: LetterboxInfo,
  image: ImageLike,
): BuffIconBox {
  const sourceCx = (cx - letterbox.padX) / letterbox.scale + letterbox.crop.x;
  const sourceCy = (cy - letterbox.padY) / letterbox.scale + letterbox.crop.y;
  const sourceWidth = width / letterbox.scale;
  const sourceHeight = height / letterbox.scale;
  const rawSize = Math.max(sourceWidth, sourceHeight);
  const size = Math.max(1, Math.round(Math.min(rawSize, image.width, image.height)));
  const x = Math.round(clamp(sourceCx - size / 2, 0, Math.max(0, image.width - size)));
  const y = Math.round(clamp(sourceCy - size / 2, 0, Math.max(0, image.height - size)));

  return {
    x,
    y,
    size,
    confidence: round(confidence),
    score: Math.round(confidence * 1000),
  };
}

function isValidBox(box: BuffIconBox): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.size) &&
    box.size > 1
  );
}

function toDebugCandidate(box: BuffIconBox): Candidate {
  return {
    x: box.x,
    y: box.y,
    size: box.size,
    score: box.score,
    confidence: box.confidence,
    support: 1,
  };
}

function assertDlSupportedOptions(options: ExtractBuffIconsOptions): void {
  if (options.inputMode === "croppedRoi" || options.roi) {
    throw new Error("dl-buff-parser-full-frame-only");
  }
}

function assertImage(image: ImageLike): void {
  if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0) {
    throw new Error("Invalid image dimensions.");
  }
  if (!image.data || image.data.length < image.width * image.height * 4) {
    throw new Error("Image data must be RGBA data with width * height * 4 entries.");
  }
}

function disposeTensor(tensor: { dispose?: () => void } | undefined): void {
  tensor?.dispose?.();
}

function disposeOutputs(outputs: Record<string, unknown> | null): void {
  if (!outputs) {
    return;
  }
  for (const output of Object.values(outputs)) {
    disposeTensor(output as { dispose?: () => void });
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
