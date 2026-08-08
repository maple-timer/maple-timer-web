/**
 * Dumps the letterboxed proposal list and the exact 48px gate-crop tensor for
 * one stored rune report frame so the detector-lab preprocessing can be
 * compared value-for-value.
 *
 * Usage: npx tsx scripts/dump-rune-gate-crop.ts <frame.png> <outPrefix>
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as ort from "onnxruntime-web/wasm";
import { PNG } from "pngjs";
import {
  createRuneOnnxGateInput,
  createRuneOnnxInputData,
  decodeRuneOnnxProposals,
  RUNE_ONNX_GATE_INPUT_NAME,
  RUNE_ONNX_GATE_PATCH_SIZE,
  RUNE_ONNX_HEATMAP_OUTPUT_NAME,
  RUNE_ONNX_INPUT_HEIGHT,
  RUNE_ONNX_INPUT_NAME,
  RUNE_ONNX_INPUT_WIDTH,
  RUNE_ONNX_MODEL_VERSION,
  RUNE_ONNX_OFFSET_OUTPUT_NAME,
  RUNE_ONNX_SIDE_OUTPUT_NAME,
} from "../src/recognition/rune/runeOnnxContract";

const [framePath, outPrefix] = process.argv.slice(2);
if (!framePath || !outPrefix) {
  console.error("usage: npx tsx scripts/dump-rune-gate-crop.ts <frame.png> <outPrefix>");
  process.exit(1);
}

const modelDirectory = `public/models/${RUNE_ONNX_MODEL_VERSION}`;
const metadata = JSON.parse(readFileSync(`${modelDirectory}/metadata.json`, "utf8"));
const proposalBytes = readFileSync(`${modelDirectory}/${metadata.files.proposal.path}`);

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
const proposalSession = await ort.InferenceSession.create(proposalBytes, {
  executionProviders: ["wasm"],
  graphOptimizationLevel: "all",
});

const png = PNG.sync.read(readFileSync(framePath));
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
    heatmapLogits: proposalOutputs[RUNE_ONNX_HEATMAP_OUTPUT_NAME].data as Float32Array,
    sideLogits: proposalOutputs[RUNE_ONNX_SIDE_OUTPUT_NAME].data as Float32Array,
    offsetLogits: proposalOutputs[RUNE_ONNX_OFFSET_OUTPUT_NAME].data as Float32Array,
  },
  prepared,
);

const gateData = createRuneOnnxGateInput(prepared.input, proposals);

writeFileSync(
  `${outPrefix}-proposals.json`,
  JSON.stringify(
    {
      modelVersion: RUNE_ONNX_MODEL_VERSION,
      letterbox: {
        scale: prepared.scale,
        resizedWidth: prepared.resizedWidth,
        resizedHeight: prepared.resizedHeight,
        padX: (prepared as unknown as { padX?: number }).padX,
        padY: (prepared as unknown as { padY?: number }).padY,
      },
      proposals: proposals.map((proposal) => ({ ...proposal })),
    },
    null,
    2,
  ),
);

const patchArea = RUNE_ONNX_GATE_PATCH_SIZE * RUNE_ONNX_GATE_PATCH_SIZE;
proposals.forEach((_, index) => {
  const patch = gateData.slice(index * patchArea * 3, (index + 1) * patchArea * 3);
  writeFileSync(
    `${outPrefix}-gate-${index + 1}.json`,
    JSON.stringify([...patch]),
  );
});
console.log(
  JSON.stringify({
    letterbox: {
      scale: prepared.scale,
      resizedWidth: prepared.resizedWidth,
      resizedHeight: prepared.resizedHeight,
    },
    proposalCount: proposals.length,
    gateValuesPerPatch: patchArea * 3,
    sampleGateValues: [...gateData.slice(0, 6)],
  }),
);
await proposalSession.release();
