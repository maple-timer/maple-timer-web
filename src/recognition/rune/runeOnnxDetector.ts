import {
  createRuneOnnxGateInput,
  createRuneOnnxInputData,
  decodeRuneOnnxGateOutputs,
  decodeRuneOnnxProposals,
  RUNE_ONNX_APPEARANCE_OUTPUT_NAME,
  RUNE_ONNX_GATE_INPUT_NAME,
  RUNE_ONNX_GATE_MODEL_PATH,
  RUNE_ONNX_GATE_PATCH_SIZE,
  RUNE_ONNX_HEATMAP_OUTPUT_NAME,
  RUNE_ONNX_INPUT_HEIGHT,
  RUNE_ONNX_INPUT_NAME,
  RUNE_ONNX_INPUT_WIDTH,
  RUNE_ONNX_OFFSET_OUTPUT_NAME,
  RUNE_ONNX_PROPOSAL_MODEL_PATH,
  RUNE_ONNX_SHAPE_OUTPUT_NAME,
  RUNE_ONNX_SIDE_OUTPUT_NAME,
} from "./runeOnnxContract";
import type { RuneDetectionResult } from "./runeDetectionTypes";

type OrtModule = typeof import("onnxruntime-web/wasm");
type OrtInferenceSession = Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>;

type RuneOnnxRuntime = {
  ort: OrtModule;
  proposalSession: OrtInferenceSession;
  gateSession: OrtInferenceSession;
};

const WASM_PATH = "/vendor/onnxruntime-web/ort-wasm-simd-threaded.wasm";
const PROPOSAL_OUTPUT_NAMES = [
  RUNE_ONNX_HEATMAP_OUTPUT_NAME,
  RUNE_ONNX_SIDE_OUTPUT_NAME,
  RUNE_ONNX_OFFSET_OUTPUT_NAME,
] as const;
const GATE_OUTPUT_NAMES = [
  RUNE_ONNX_SHAPE_OUTPUT_NAME,
  RUNE_ONNX_APPEARANCE_OUTPUT_NAME,
] as const;

let runtimePromise: Promise<RuneOnnxRuntime> | null = null;

export async function detectRuneInMinimapWithOnnx(
  imageData: ImageData,
): Promise<RuneDetectionResult> {
  const prepared = createRuneOnnxInputData(imageData);
  const runtime = await getRuneOnnxRuntime();
  const input = new runtime.ort.Tensor("float32", prepared.input, [
    1,
    3,
    RUNE_ONNX_INPUT_HEIGHT,
    RUNE_ONNX_INPUT_WIDTH,
  ]);
  let proposalOutputs: Awaited<ReturnType<OrtInferenceSession["run"]>> | null = null;
  let gateOutputs: Awaited<ReturnType<OrtInferenceSession["run"]>> | null = null;
  let gateInput: InstanceType<OrtModule["Tensor"]> | null = null;
  let proposalInferenceMs = 0;
  let gateInferenceMs = 0;
  try {
    const proposalStartedAt = now();
    proposalOutputs = await runtime.proposalSession.run(
      { [RUNE_ONNX_INPUT_NAME]: input },
      [...PROPOSAL_OUTPUT_NAMES],
    );
    proposalInferenceMs = now() - proposalStartedAt;
    const proposals = decodeRuneOnnxProposals(
      {
        heatmapLogits: readFloatOutput(proposalOutputs, RUNE_ONNX_HEATMAP_OUTPUT_NAME),
        sideLogits: readFloatOutput(proposalOutputs, RUNE_ONNX_SIDE_OUTPUT_NAME),
        offsetLogits: readFloatOutput(proposalOutputs, RUNE_ONNX_OFFSET_OUTPUT_NAME),
      },
      prepared,
    );
    if (proposals.length === 0) {
      return decodeRuneOnnxGateOutputs(
        proposals,
        {
          shapeLogits: new Float32Array(),
          appearanceLogits: new Float32Array(),
        },
        { proposalInferenceMs },
      );
    }
    const gateData = createRuneOnnxGateInput(prepared.input, proposals);
    gateInput = new runtime.ort.Tensor("float32", gateData, [
      proposals.length,
      3,
      RUNE_ONNX_GATE_PATCH_SIZE,
      RUNE_ONNX_GATE_PATCH_SIZE,
    ]);
    const gateStartedAt = now();
    gateOutputs = await runtime.gateSession.run(
      { [RUNE_ONNX_GATE_INPUT_NAME]: gateInput },
      [...GATE_OUTPUT_NAMES],
    );
    gateInferenceMs = now() - gateStartedAt;
    return decodeRuneOnnxGateOutputs(
      proposals,
      {
        shapeLogits: readFloatOutput(gateOutputs, RUNE_ONNX_SHAPE_OUTPUT_NAME),
        appearanceLogits: readFloatOutput(gateOutputs, RUNE_ONNX_APPEARANCE_OUTPUT_NAME),
      },
      { proposalInferenceMs, gateInferenceMs },
    );
  } finally {
    input.dispose();
    gateInput?.dispose();
    disposeOutputs(proposalOutputs);
    disposeOutputs(gateOutputs);
  }
}

async function getRuneOnnxRuntime(): Promise<RuneOnnxRuntime> {
  runtimePromise = runtimePromise ?? loadRuneOnnxRuntime().catch((error) => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

async function loadRuneOnnxRuntime(): Promise<RuneOnnxRuntime> {
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: WASM_PATH };
  const [proposalSession, gateSession] = await Promise.all([
    ort.InferenceSession.create(RUNE_ONNX_PROPOSAL_MODEL_PATH, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    }),
    ort.InferenceSession.create(RUNE_ONNX_GATE_MODEL_PATH, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    }),
  ]);
  assertSessionContract(
    proposalSession,
    RUNE_ONNX_INPUT_NAME,
    PROPOSAL_OUTPUT_NAMES,
    "proposal",
  );
  assertSessionContract(
    gateSession,
    RUNE_ONNX_GATE_INPUT_NAME,
    GATE_OUTPUT_NAMES,
    "gate",
  );
  return { ort, proposalSession, gateSession };
}

function assertSessionContract(
  session: OrtInferenceSession,
  inputName: string,
  outputNames: readonly string[],
  label: string,
): void {
  if (!session.inputNames.includes(inputName)) {
    throw new Error(`rune-onnx-${label}-input-contract-mismatch`);
  }
  for (const outputName of outputNames) {
    if (!session.outputNames.includes(outputName)) {
      throw new Error(`rune-onnx-${label}-output-contract-mismatch:${outputName}`);
    }
  }
}

function readFloatOutput(
  outputs: Awaited<ReturnType<OrtInferenceSession["run"]>>,
  name: string,
): Float32Array {
  const output = outputs[name];
  if (!(output?.data instanceof Float32Array)) {
    throw new Error(`rune-onnx-invalid-output:${name}`);
  }
  return output.data;
}

function disposeOutputs(
  outputs: Awaited<ReturnType<OrtInferenceSession["run"]>> | null,
): void {
  if (!outputs) {
    return;
  }
  Object.values(outputs).forEach((output) => output.dispose());
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
