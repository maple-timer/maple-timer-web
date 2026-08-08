/**
 * Replays stored rune report trigger/report frames through the current
 * production ONNX cascade (public/models/<RUNE_ONNX_MODEL_VERSION>).
 *
 * Usage:
 *   npx tsx scripts/replay-rune-report-frames.ts <framesRoot>
 *
 * <framesRoot> contains one directory per report (short id) with extracted
 * PNG frames. Every *.png in each directory is run through the exact frozen
 * proposal + gate contract; per-frame accepted candidates and the strongest
 * rejected proposal are printed as JSON lines.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import * as ort from "onnxruntime-web/wasm";
import { PNG } from "pngjs";
import {
  createRuneOnnxGateInput,
  createRuneOnnxInputData,
  decodeRuneOnnxGateOutputs,
  decodeRuneOnnxProposals,
  RUNE_ONNX_APPEARANCE_OUTPUT_NAME,
  RUNE_ONNX_GATE_INPUT_NAME,
  RUNE_ONNX_GATE_PATCH_SIZE,
  RUNE_ONNX_HEATMAP_OUTPUT_NAME,
  RUNE_ONNX_INPUT_HEIGHT,
  RUNE_ONNX_INPUT_NAME,
  RUNE_ONNX_INPUT_WIDTH,
  RUNE_ONNX_MODEL_VERSION,
  RUNE_ONNX_OFFSET_OUTPUT_NAME,
  RUNE_ONNX_SHAPE_OUTPUT_NAME,
  RUNE_ONNX_SIDE_OUTPUT_NAME,
} from "../src/recognition/rune/runeOnnxContract";

const framesRoot = process.argv[2];
if (!framesRoot) {
  console.error("usage: npx tsx scripts/replay-rune-report-frames.ts <framesRoot>");
  process.exit(1);
}

type BundleMetadata = {
  modelVersion: string;
  files: {
    proposal: { path: string };
    gate: { path: string };
  };
};

const modelDirectory = resolve(`public/models/${RUNE_ONNX_MODEL_VERSION}`);
const metadata = JSON.parse(
  readFileSync(resolve(modelDirectory, "metadata.json"), "utf8"),
) as BundleMetadata;
const proposalBytes = readFileSync(resolve(modelDirectory, metadata.files.proposal.path));
const gateBytes = readFileSync(resolve(modelDirectory, metadata.files.gate.path));

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
const [proposalSession, gateSession] = await Promise.all([
  ort.InferenceSession.create(proposalBytes, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  }),
  ort.InferenceSession.create(gateBytes, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  }),
]);

function readOutput(outputs: ort.InferenceSession.OnnxValueMapType, name: string): Float32Array {
  const tensor = outputs[name];
  if (!tensor) {
    throw new Error(`missing-output:${name}`);
  }
  return tensor.data as Float32Array;
}

function disposeOutputs(outputs: ort.InferenceSession.OnnxValueMapType): void {
  for (const value of Object.values(outputs)) {
    value.dispose();
  }
}

async function runFrame(path: string) {
  const png = PNG.sync.read(readFileSync(path));
  const prepared = createRuneOnnxInputData(png);
  const proposalInput = new ort.Tensor("float32", prepared.input, [
    1,
    3,
    RUNE_ONNX_INPUT_HEIGHT,
    RUNE_ONNX_INPUT_WIDTH,
  ]);
  const proposalOutputs = await proposalSession.run(
    { [RUNE_ONNX_INPUT_NAME]: proposalInput },
    [
      RUNE_ONNX_HEATMAP_OUTPUT_NAME,
      RUNE_ONNX_SIDE_OUTPUT_NAME,
      RUNE_ONNX_OFFSET_OUTPUT_NAME,
    ],
  );
  const proposals = decodeRuneOnnxProposals(
    {
      heatmapLogits: readOutput(proposalOutputs, RUNE_ONNX_HEATMAP_OUTPUT_NAME),
      sideLogits: readOutput(proposalOutputs, RUNE_ONNX_SIDE_OUTPUT_NAME),
      offsetLogits: readOutput(proposalOutputs, RUNE_ONNX_OFFSET_OUTPUT_NAME),
    },
    prepared,
  );
  proposalInput.dispose();
  disposeOutputs(proposalOutputs);

  const gateData = createRuneOnnxGateInput(prepared.input, proposals);
  const gateInput = new ort.Tensor("float32", gateData, [
    proposals.length,
    3,
    RUNE_ONNX_GATE_PATCH_SIZE,
    RUNE_ONNX_GATE_PATCH_SIZE,
  ]);
  const gateOutputs = await gateSession.run(
    { [RUNE_ONNX_GATE_INPUT_NAME]: gateInput },
    [RUNE_ONNX_SHAPE_OUTPUT_NAME, RUNE_ONNX_APPEARANCE_OUTPUT_NAME],
  );
  const detection = decodeRuneOnnxGateOutputs(
    proposals,
    {
      shapeLogits: readOutput(gateOutputs, RUNE_ONNX_SHAPE_OUTPUT_NAME),
      appearanceLogits: readOutput(gateOutputs, RUNE_ONNX_APPEARANCE_OUTPUT_NAME),
    },
    { proposalInferenceMs: 0, gateInferenceMs: 0 },
  );
  gateInput.dispose();
  disposeOutputs(gateOutputs);
  return detection;
}

const reportDirs = readdirSync(framesRoot).filter((name) =>
  statSync(join(framesRoot, name)).isDirectory(),
);

for (const dir of reportDirs.sort()) {
  const files = readdirSync(join(framesRoot, dir)).filter(
    (name) => name.endsWith(".png") && !name.includes("8x"),
  );
  for (const file of files.sort()) {
    const path = join(framesRoot, dir, file);
    try {
      const detection = await runFrame(path);
      const debug = detection.debug;
      console.log(
        JSON.stringify({
          report: dir,
          frame: basename(file),
          modelVersion: RUNE_ONNX_MODEL_VERSION,
          detected: detection.detected,
          candidate: detection.candidates[0] ?? null,
          selectedProposalRank: debug.selectedProposalRank ?? null,
          shapeScore: debug.shapeScore,
          appearanceScore: debug.appearanceScore,
          modelScore: debug.modelScore,
          reason: debug.reason,
          modelCandidate: debug.modelCandidate ?? null,
        }),
      );
    } catch (error) {
      console.log(
        JSON.stringify({ report: dir, frame: basename(file), error: String(error) }),
      );
    }
  }
}

await proposalSession.release();
await gateSession.release();
