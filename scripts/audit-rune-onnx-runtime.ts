import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import * as ort from "onnxruntime-web/wasm";
import { PNG } from "pngjs";
import {
  createRuneOnnxGateInput,
  createRuneOnnxInputData,
  decodeRuneOnnxGateOutputs,
  decodeRuneOnnxProposals,
  RUNE_ONNX_APPEARANCE_OUTPUT_NAME,
  RUNE_ONNX_APPEARANCE_THRESHOLD,
  RUNE_ONNX_GATE_INPUT_NAME,
  RUNE_ONNX_GATE_PATCH_SIZE,
  RUNE_ONNX_HEATMAP_OUTPUT_NAME,
  RUNE_ONNX_INPUT_HEIGHT,
  RUNE_ONNX_INPUT_NAME,
  RUNE_ONNX_INPUT_WIDTH,
  RUNE_ONNX_MODEL_VERSION,
  RUNE_ONNX_OFFSET_OUTPUT_NAME,
  RUNE_ONNX_PROPOSAL_TOP_K,
  RUNE_ONNX_SHAPE_OUTPUT_NAME,
  RUNE_ONNX_SHAPE_THRESHOLD,
  RUNE_ONNX_SIDE_OUTPUT_NAME,
} from "../src/recognition/rune/runeOnnxContract";

type OwnedPrediction = {
  id: string;
  split: string;
  expected: "rune" | "no-rune";
  target: [number, number, number, number] | null;
  candidates: Array<{
    rank: number;
    bbox: [number, number, number, number];
    proposalScore: number;
    shapeScore: number;
    appearanceScore: number;
    targetIou: number;
  }>;
};

type BundleMetadata = {
  modelVersion: string;
  groundTruthVersion: string;
  groundTruthSha256: string;
  files: {
    proposal: { path: string; sha256: string; bytes: number };
    gate: { path: string; sha256: string; bytes: number };
  };
  proposal: {
    topK: number;
    decode: { threshold: null };
  };
  gate: {
    input: { shape: [string, number, number, number] };
    shapeGate: { threshold: number };
    appearanceGate: { threshold: number };
  };
};

type ImageIndexRecord = { path: string; expectedSha256?: string };

const labRoot = resolveLabRoot();
const modelDirectory = resolve(`public/models/${RUNE_ONNX_MODEL_VERSION}`);
const metadata = JSON.parse(
  readFileSync(resolve(modelDirectory, "metadata.json"), "utf8"),
) as BundleMetadata;
const proposalBytes = readFileSync(resolve(modelDirectory, metadata.files.proposal.path));
const gateBytes = readFileSync(resolve(modelDirectory, metadata.files.gate.path));
const groundTruthBytes = readFileSync(
  resolve(labRoot, "dataset/ground-truth", `${metadata.groundTruthVersion}.json`),
);
const ownedPredictions = loadOwnedPredictions();
const imageIndex = buildImageIndex();

assertBundleProvenance();
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

const failures: Array<Record<string, unknown>> = [];
const suiteStats = new Map<string, {
  total: number;
  positives: number;
  negatives: number;
  detected: number;
  passed: number;
}>();
const proposalDurations: number[] = [];
const gateDurations: number[] = [];
const totalDurations: number[] = [];
let maximumProposalScoreError = 0;
let maximumGateScoreError = 0;
let maximumProposalBoxError = 0;
let backgroundCandidateCount = 0;
let backgroundFinalPassCount = 0;
let coexistencePositiveCount = 0;
let coexistenceTargetSelectedCount = 0;
let selectedRankDriftCount = 0;
let nonGatingProbeDetectedCount = 0;
let nonGatingProbeCount = 0;

for (const expected of ownedPredictions) {
  const image = imageIndex.get(expected.id);
  if (!image) {
    throw new Error(`rune-onnx-audit-image-missing:${expected.id}`);
  }
  const bytes = readFileSync(image.path);
  if (image.expectedSha256 && sha256(bytes) !== image.expectedSha256) {
    throw new Error(`rune-onnx-audit-image-hash-mismatch:${expected.id}`);
  }
  const png = PNG.sync.read(bytes);
  const totalStartedAt = performance.now();
  const prepared = createRuneOnnxInputData(png);
  const proposalInput = new ort.Tensor("float32", prepared.input, [
    1,
    3,
    RUNE_ONNX_INPUT_HEIGHT,
    RUNE_ONNX_INPUT_WIDTH,
  ]);
  const proposalStartedAt = performance.now();
  const proposalOutputs = await proposalSession.run(
    { [RUNE_ONNX_INPUT_NAME]: proposalInput },
    [
      RUNE_ONNX_HEATMAP_OUTPUT_NAME,
      RUNE_ONNX_SIDE_OUTPUT_NAME,
      RUNE_ONNX_OFFSET_OUTPUT_NAME,
    ],
  );
  const proposalInferenceMs = performance.now() - proposalStartedAt;
  proposalDurations.push(proposalInferenceMs);
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
  const gateStartedAt = performance.now();
  const gateOutputs = await gateSession.run(
    { [RUNE_ONNX_GATE_INPUT_NAME]: gateInput },
    [RUNE_ONNX_SHAPE_OUTPUT_NAME, RUNE_ONNX_APPEARANCE_OUTPUT_NAME],
  );
  const gateInferenceMs = performance.now() - gateStartedAt;
  gateDurations.push(gateInferenceMs);
  const rawShapeLogits = readOutput(gateOutputs, RUNE_ONNX_SHAPE_OUTPUT_NAME);
  const rawAppearanceLogits = readOutput(gateOutputs, RUNE_ONNX_APPEARANCE_OUTPUT_NAME);
  const shapeScores = [...rawShapeLogits].map(sigmoid);
  const appearanceScores = [...rawAppearanceLogits].map(sigmoid);
  const detection = decodeRuneOnnxGateOutputs(
    proposals,
    {
      shapeLogits: rawShapeLogits,
      appearanceLogits: rawAppearanceLogits,
    },
    { proposalInferenceMs, gateInferenceMs },
  );
  gateInput.dispose();
  disposeOutputs(gateOutputs);
  totalDurations.push(performance.now() - totalStartedAt);

  const expectedSelected = selectExpectedCandidate(expected.candidates);
  const expectedDetected = expected.expected === "rune";
  const isNonGatingProbe = expected.split === "legacy-synthetic" && expectedDetected;
  const mismatchReasons: string[] = [];
  if (!isNonGatingProbe && detection.detected !== expectedDetected) {
    mismatchReasons.push("classification");
  }
  const actualAcceptedRank = detection.detected
    ? detection.debug.selectedProposalRank ?? null
    : null;
  if (actualAcceptedRank !== (expectedSelected?.rank ?? null)) {
    selectedRankDriftCount += 1;
  }
  if (!isNonGatingProbe && actualAcceptedRank !== (expectedSelected?.rank ?? null)) {
    mismatchReasons.push("selected-candidate");
  }
  if (proposals.length !== expected.candidates.length) {
    mismatchReasons.push("proposal-count");
  }
  if (isNonGatingProbe) {
    nonGatingProbeCount += 1;
    nonGatingProbeDetectedCount += detection.detected ? 1 : 0;
  }

  for (let index = 0; index < Math.min(proposals.length, expected.candidates.length); index += 1) {
    const actualProposal = proposals[index];
    const expectedCandidate = expected.candidates[index];
    if (!actualProposal || !expectedCandidate) {
      continue;
    }
    const proposalScoreError = Math.abs(
      actualProposal.proposalScore - expectedCandidate.proposalScore,
    );
    const shapeScoreError = Math.abs(
      (shapeScores[index] ?? 0) - expectedCandidate.shapeScore,
    );
    const appearanceScoreError = Math.abs(
      (appearanceScores[index] ?? 0) - expectedCandidate.appearanceScore,
    );
    const boxError = Math.max(
      Math.abs(actualProposal.modelX - expectedCandidate.bbox[0]),
      Math.abs(actualProposal.modelY - expectedCandidate.bbox[1]),
      Math.abs(actualProposal.modelWidth - expectedCandidate.bbox[2]),
      Math.abs(actualProposal.modelHeight - expectedCandidate.bbox[3]),
    );
    maximumProposalScoreError = Math.max(maximumProposalScoreError, proposalScoreError);
    maximumGateScoreError = Math.max(
      maximumGateScoreError,
      shapeScoreError,
      appearanceScoreError,
    );
    maximumProposalBoxError = Math.max(maximumProposalBoxError, boxError);
    if (expected.target) {
      const actualTargetIou = boxIou(expected.target, [
        actualProposal.modelX,
        actualProposal.modelY,
        actualProposal.modelWidth,
        actualProposal.modelHeight,
      ]);
      if (actualTargetIou >= 0.1) {
        continue;
      }
      backgroundCandidateCount += 1;
      if (
        (shapeScores[index] ?? 0) >= RUNE_ONNX_SHAPE_THRESHOLD &&
        (appearanceScores[index] ?? 0) >= RUNE_ONNX_APPEARANCE_THRESHOLD
      ) {
        backgroundFinalPassCount += 1;
      }
    }
  }

  if (expectedDetected && expected.target) {
    coexistencePositiveCount += 1;
    const selectedProposal = actualAcceptedRank === null
      ? null
      : proposals[actualAcceptedRank - 1] ?? null;
    const selectedTargetIou = selectedProposal
      ? boxIou(expected.target, [
        selectedProposal.modelX,
        selectedProposal.modelY,
        selectedProposal.modelWidth,
        selectedProposal.modelHeight,
      ])
      : 0;
    if (selectedTargetIou >= 0.4) {
      coexistenceTargetSelectedCount += 1;
    } else {
      mismatchReasons.push("coexistence-target-not-selected");
    }
  }

  const stats = suiteStats.get(expected.split) ?? {
    total: 0,
    positives: 0,
    negatives: 0,
    detected: 0,
    passed: 0,
  };
  stats.total += 1;
  stats.positives += expectedDetected ? 1 : 0;
  stats.negatives += expectedDetected ? 0 : 1;
  stats.detected += detection.detected ? 1 : 0;
  stats.passed += mismatchReasons.length === 0 ? 1 : 0;
  suiteStats.set(expected.split, stats);

  if (mismatchReasons.length > 0) {
    failures.push({
      id: expected.id,
      suite: expected.split,
      expected: expected.expected,
      detected: detection.detected,
      expectedSelectedRank: expectedSelected?.rank ?? null,
      actualSelectedRank: detection.debug.selectedProposalRank ?? null,
      reasons: [...new Set(mismatchReasons)],
      debug: detection.debug,
    });
  }
}

const report = {
  modelVersion: RUNE_ONNX_MODEL_VERSION,
  resources: {
    total: ownedPredictions.length,
    passed: ownedPredictions.length - failures.length,
    failed: failures.length,
    gatingPositives: ownedPredictions.filter((item) => (
      item.expected === "rune" && item.split !== "legacy-synthetic"
    )).length,
    negatives: ownedPredictions.filter((item) => item.expected === "no-rune").length,
    nonGatingSyntheticPositiveProbes: {
      detected: nonGatingProbeDetectedCount,
      total: nonGatingProbeCount,
    },
  },
  independentGateSafety: {
    backgroundCandidates: backgroundCandidateCount,
    backgroundFinalPasses: backgroundFinalPassCount,
    coexistencePositiveFrames: coexistencePositiveCount,
    coexistenceTargetSelected: coexistenceTargetSelectedCount,
  },
  parity: {
    note: "Raw score and low-ranked proposal drift is informational because the browser uses deterministic JS bilinear preprocessing instead of Pillow. Gating outcomes and selected targets are enforced.",
    maximumProposalScoreError,
    maximumGateScoreError,
    maximumProposalBoxError,
    selectedRankDriftCount,
  },
  suites: Object.fromEntries(suiteStats),
  proposalInferenceMs: summarizeDurations(proposalDurations),
  gateInferenceMs: summarizeDurations(gateDurations),
  totalMs: summarizeDurations(totalDurations),
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (
  failures.length > 0 ||
  backgroundFinalPassCount > 0 ||
  coexistenceTargetSelectedCount !== coexistencePositiveCount
) {
  process.exitCode = 1;
}

function resolveLabRoot(): string {
  const explicit = process.argv[2] ?? process.env.RUNE_DETECTOR_LAB_ROOT;
  if (!explicit) {
    throw new Error(
      "usage: npm run audit:rune-onnx -- /absolute/path/to/maple-timer-rune-detector-lab",
    );
  }
  return resolve(explicit);
}

function loadOwnedPredictions(): OwnedPrediction[] {
  const root = resolve(
    labRoot,
    `reports/${RUNE_ONNX_MODEL_VERSION}/all-owned-resources`,
  );
  return readdirSync(root)
    .filter((filename) => filename.endsWith("-predictions.json"))
    .sort()
    .flatMap((filename) => (
      JSON.parse(readFileSync(resolve(root, filename), "utf8")) as OwnedPrediction[]
    ));
}

function buildImageIndex(): Map<string, ImageIndexRecord> {
  const index = new Map<string, ImageIndexRecord>();
  const groundTruth = JSON.parse(groundTruthBytes.toString("utf8")) as {
    samples: Array<{ id: string; imageFile: string }>;
  };
  for (const sample of groundTruth.samples) {
    index.set(sample.id, {
      path: resolve(labRoot, "dataset/samples", sample.imageFile),
    });
  }

  const datasetManifest = JSON.parse(
    readFileSync(resolve(labRoot, "dataset/manifest.json"), "utf8"),
  ) as {
    samples: Array<{
      id: string;
      imageFile: string;
      sourceKind: string;
      sha256?: string;
    }>;
  };
  for (const sample of datasetManifest.samples.filter(
    (item) => item.sourceKind === "synthetic-regression",
  )) {
    index.set(sample.id, {
      path: resolve(labRoot, "dataset/samples", sample.imageFile),
      expectedSha256: sample.sha256,
    });
  }

  const acceptanceRoot = resolve(
    labRoot,
    "source/acceptance/rune-v3-post-freeze-20260712",
  );
  const acceptanceManifest = JSON.parse(
    readFileSync(resolve(acceptanceRoot, "manifest.json"), "utf8"),
  ) as {
    samples: Array<{ id: string; imageFile: string; sha256?: string }>;
  };
  for (const sample of acceptanceManifest.samples) {
    index.set(sample.id, {
      path: resolve(acceptanceRoot, sample.imageFile),
      expectedSha256: sample.sha256,
    });
  }

  const qualificationRoot = resolve(
    labRoot,
    "source/qualification/rune-cascade-v8-v7-false-positive-incidents",
  );
  const qualificationManifest = JSON.parse(
    readFileSync(resolve(qualificationRoot, "manifest.json"), "utf8"),
  ) as {
    samples: Array<{ id: string; file: string; sha256?: string }>;
  };
  for (const sample of qualificationManifest.samples) {
    index.set(sample.id, {
      path: resolve(qualificationRoot, sample.file),
      expectedSha256: sample.sha256,
    });
  }

  for (const suite of new Set(ownedPredictions.map((item) => item.split))) {
    const suiteRoot = resolve(labRoot, "source/qualification", suite);
    const manifestPath = resolve(suiteRoot, "manifest.json");
    if (!existsSync(manifestPath)) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      samples?: Array<{
        id: string;
        file?: string;
        imageFile?: string;
        sha256?: string;
      }>;
    };
    for (const sample of manifest.samples ?? []) {
      const file = sample.file ?? sample.imageFile;
      if (!file) {
        continue;
      }
      index.set(sample.id, {
        path: resolve(suiteRoot, file),
        expectedSha256: sample.sha256,
      });
    }
  }
  return index;
}

function assertBundleProvenance(): void {
  if (metadata.modelVersion !== RUNE_ONNX_MODEL_VERSION) {
    throw new Error("rune-onnx-model-version-mismatch");
  }
  if (sha256(proposalBytes) !== metadata.files.proposal.sha256) {
    throw new Error("rune-onnx-proposal-sha256-mismatch");
  }
  if (sha256(gateBytes) !== metadata.files.gate.sha256) {
    throw new Error("rune-onnx-gate-sha256-mismatch");
  }
  if (
    proposalBytes.byteLength !== metadata.files.proposal.bytes ||
    gateBytes.byteLength !== metadata.files.gate.bytes
  ) {
    throw new Error("rune-onnx-model-size-mismatch");
  }
  if (metadata.proposal.topK !== RUNE_ONNX_PROPOSAL_TOP_K) {
    throw new Error("rune-onnx-proposal-top-k-mismatch");
  }
  if (metadata.proposal.decode.threshold !== null) {
    throw new Error("rune-onnx-proposal-threshold-must-be-null");
  }
  if (metadata.gate.shapeGate.threshold !== RUNE_ONNX_SHAPE_THRESHOLD) {
    throw new Error("rune-onnx-shape-threshold-mismatch");
  }
  if (metadata.gate.appearanceGate.threshold !== RUNE_ONNX_APPEARANCE_THRESHOLD) {
    throw new Error("rune-onnx-appearance-threshold-mismatch");
  }
  if (
    metadata.gate.input.shape[2] !== RUNE_ONNX_GATE_PATCH_SIZE ||
    metadata.gate.input.shape[3] !== RUNE_ONNX_GATE_PATCH_SIZE
  ) {
    throw new Error("rune-onnx-gate-patch-size-mismatch");
  }
  if (sha256(groundTruthBytes) !== metadata.groundTruthSha256) {
    throw new Error("rune-onnx-ground-truth-sha256-mismatch");
  }
}

function selectExpectedCandidate(
  candidates: OwnedPrediction["candidates"],
): OwnedPrediction["candidates"][number] | null {
  return candidates
    .filter((candidate) => (
      candidate.shapeScore >= RUNE_ONNX_SHAPE_THRESHOLD &&
      candidate.appearanceScore >= RUNE_ONNX_APPEARANCE_THRESHOLD
    ))
    .reduce<OwnedPrediction["candidates"][number] | null>((selected, candidate) => {
      if (!selected) {
        return candidate;
      }
      const candidateMargin = Math.min(
        candidate.shapeScore - RUNE_ONNX_SHAPE_THRESHOLD,
        candidate.appearanceScore - RUNE_ONNX_APPEARANCE_THRESHOLD,
      );
      const selectedMargin = Math.min(
        selected.shapeScore - RUNE_ONNX_SHAPE_THRESHOLD,
        selected.appearanceScore - RUNE_ONNX_APPEARANCE_THRESHOLD,
      );
      if (candidateMargin !== selectedMargin) {
        return candidateMargin > selectedMargin ? candidate : selected;
      }
      return candidate.shapeScore + candidate.appearanceScore >
        selected.shapeScore + selected.appearanceScore
        ? candidate
        : selected;
    }, null);
}

function readOutput(
  outputs: Record<string, ort.Tensor>,
  name: string,
): Float32Array {
  const output = outputs[name];
  if (!(output?.data instanceof Float32Array)) {
    throw new Error(`rune-onnx-invalid-output:${name}`);
  }
  return output.data;
}

function disposeOutputs(outputs: Record<string, ort.Tensor>): void {
  Object.values(outputs).forEach((output) => output.dispose());
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function boxIou(
  left: [number, number, number, number],
  right: [number, number, number, number],
): number {
  const intersectionWidth = Math.max(
    0,
    Math.min(left[0] + left[2], right[0] + right[2]) -
      Math.max(left[0], right[0]),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(left[1] + left[3], right[1] + right[3]) -
      Math.max(left[1], right[1]),
  );
  const intersection = intersectionWidth * intersectionHeight;
  const union = left[2] * left[3] + right[2] * right[3] - intersection;
  return union > 0 ? intersection / union : 0;
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? 0;
}

function summarizeDurations(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    maximum: sorted.at(-1) ?? 0,
  };
}
