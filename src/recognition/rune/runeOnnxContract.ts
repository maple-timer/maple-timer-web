import type { RuneCandidate, RuneDetectionResult } from "./runeDetectionTypes";

export const RUNE_ONNX_MODEL_VERSION = "rune-cascade-v14";
export const RUNE_ONNX_MODEL_DIRECTORY = `/models/${RUNE_ONNX_MODEL_VERSION}`;
export const RUNE_ONNX_PROPOSAL_MODEL_PATH = `${RUNE_ONNX_MODEL_DIRECTORY}/proposal.onnx`;
export const RUNE_ONNX_GATE_MODEL_PATH = `${RUNE_ONNX_MODEL_DIRECTORY}/gate.onnx`;
export const RUNE_ONNX_METADATA_PATH = `${RUNE_ONNX_MODEL_DIRECTORY}/metadata.json`;
// Compatibility alias for tooling that historically treated the proposal model as the whole detector.
export const RUNE_ONNX_MODEL_PATH = RUNE_ONNX_PROPOSAL_MODEL_PATH;

export const RUNE_ONNX_INPUT_NAME = "image";
export const RUNE_ONNX_HEATMAP_OUTPUT_NAME = "heatmap_logits";
export const RUNE_ONNX_SIDE_OUTPUT_NAME = "side_logits";
export const RUNE_ONNX_OFFSET_OUTPUT_NAME = "offset_logits";
export const RUNE_ONNX_GATE_INPUT_NAME = "patches";
export const RUNE_ONNX_SHAPE_OUTPUT_NAME = "shape_logits";
export const RUNE_ONNX_APPEARANCE_OUTPUT_NAME = "appearance_logits";

export const RUNE_ONNX_INPUT_WIDTH = 320;
export const RUNE_ONNX_INPUT_HEIGHT = 192;
export const RUNE_ONNX_OUTPUT_WIDTH = 80;
export const RUNE_ONNX_OUTPUT_HEIGHT = 48;
export const RUNE_ONNX_OUTPUT_STRIDE = 4;
export const RUNE_ONNX_PROPOSAL_TOP_K = 5;
export const RUNE_ONNX_PROPOSAL_NMS_IOU = 0.5;
export const RUNE_ONNX_GATE_PATCH_SIZE = 48;
export const RUNE_ONNX_GATE_CONTEXT_SCALE = 1.25;
export const RUNE_ONNX_SHAPE_THRESHOLD = 0.89;
export const RUNE_ONNX_APPEARANCE_THRESHOLD = 0.88;
// The compatibility score is normalized so 0.5 means both independent gates passed.
export const RUNE_ONNX_THRESHOLD = 0.5;

const INPUT_AREA = RUNE_ONNX_INPUT_WIDTH * RUNE_ONNX_INPUT_HEIGHT;
const OUTPUT_AREA = RUNE_ONNX_OUTPUT_WIDTH * RUNE_ONNX_OUTPUT_HEIGHT;
const GATE_PATCH_AREA = RUNE_ONNX_GATE_PATCH_SIZE * RUNE_ONNX_GATE_PATCH_SIZE;
const LETTERBOX_FILL = [16, 22, 18] as const;
const NORMALIZED_LETTERBOX_FILL = LETTERBOX_FILL.map(normalizeChannel);
const SIDE_MINIMUM = 8;
const SIDE_RANGE = 24;

export type RuneOnnxImageLike = {
  width: number;
  height: number;
  data: ArrayLike<number>;
};

export type RuneOnnxTransform = {
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
  resizedWidth: number;
  resizedHeight: number;
  padX: number;
  padY: number;
};

export type RuneOnnxPreprocessResult = RuneOnnxTransform & {
  input: Float32Array;
};

export type RuneOnnxRawOutputs = {
  heatmapLogits: Float32Array;
  sideLogits: Float32Array;
  offsetLogits: Float32Array;
};

export type RuneOnnxGateRawOutputs = {
  shapeLogits: Float32Array;
  appearanceLogits: Float32Array;
};

export type RuneOnnxProposal = {
  rank: number;
  modelX: number;
  modelY: number;
  modelWidth: number;
  modelHeight: number;
  proposalScore: number;
  candidate: RuneCandidate;
};

export type RuneOnnxCandidateDecision = RuneOnnxProposal & {
  shapeScore: number;
  appearanceScore: number;
  shapePass: boolean;
  appearancePass: boolean;
  finalPass: boolean;
  decisionScore: number;
};

export type RuneOnnxInferenceTiming = {
  proposalInferenceMs?: number;
  gateInferenceMs?: number;
};

export function createRuneOnnxInputData(image: RuneOnnxImageLike): RuneOnnxPreprocessResult {
  assertImage(image);
  const scale = Math.min(
    RUNE_ONNX_INPUT_WIDTH / image.width,
    RUNE_ONNX_INPUT_HEIGHT / image.height,
  );
  const resizedWidth = Math.max(1, Math.round(image.width * scale));
  const resizedHeight = Math.max(1, Math.round(image.height * scale));
  const padX = Math.floor((RUNE_ONNX_INPUT_WIDTH - resizedWidth) / 2);
  const padY = Math.floor((RUNE_ONNX_INPUT_HEIGHT - resizedHeight) / 2);
  const input = new Float32Array(INPUT_AREA * 3);
  fillChannel(input, 0, NORMALIZED_LETTERBOX_FILL[0] ?? 0);
  fillChannel(input, 1, NORMALIZED_LETTERBOX_FILL[1] ?? 0);
  fillChannel(input, 2, NORMALIZED_LETTERBOX_FILL[2] ?? 0);

  for (let targetY = 0; targetY < resizedHeight; targetY += 1) {
    const sourceY = (targetY + 0.5) * image.height / resizedHeight - 0.5;
    const outputY = targetY + padY;
    for (let targetX = 0; targetX < resizedWidth; targetX += 1) {
      const sourceX = (targetX + 0.5) * image.width / resizedWidth - 0.5;
      const outputX = targetX + padX;
      const pixel = sampleBilinearRgb(image, sourceX, sourceY);
      const index = outputY * RUNE_ONNX_INPUT_WIDTH + outputX;
      input[index] = normalizeChannel(Math.round(pixel.r));
      input[INPUT_AREA + index] = normalizeChannel(Math.round(pixel.g));
      input[INPUT_AREA * 2 + index] = normalizeChannel(Math.round(pixel.b));
    }
  }

  return {
    input,
    sourceWidth: image.width,
    sourceHeight: image.height,
    scale,
    resizedWidth,
    resizedHeight,
    padX,
    padY,
  };
}

export function decodeRuneOnnxProposals(
  outputs: RuneOnnxRawOutputs,
  transform: RuneOnnxTransform,
): RuneOnnxProposal[] {
  assertOutputs(outputs);
  const localMaxima: Omit<RuneOnnxProposal, "rank">[] = [];

  for (let gridY = 0; gridY < RUNE_ONNX_OUTPUT_HEIGHT; gridY += 1) {
    for (let gridX = 0; gridX < RUNE_ONNX_OUTPUT_WIDTH; gridX += 1) {
      const index = gridY * RUNE_ONNX_OUTPUT_WIDTH + gridX;
      const score = sigmoid(outputs.heatmapLogits[index] ?? Number.NEGATIVE_INFINITY);
      if (!isLocalMaximum(outputs.heatmapLogits, gridX, gridY, score)) {
        continue;
      }
      const offsetX = sigmoid(outputs.offsetLogits[index] ?? 0);
      const offsetY = sigmoid(outputs.offsetLogits[OUTPUT_AREA + index] ?? 0);
      const modelCenterX = (gridX + offsetX) * RUNE_ONNX_OUTPUT_STRIDE;
      const modelCenterY = (gridY + offsetY) * RUNE_ONNX_OUTPUT_STRIDE;
      const modelSide = SIDE_MINIMUM + sigmoid(outputs.sideLogits[index] ?? 0) * SIDE_RANGE;
      const modelX = modelCenterX - modelSide / 2;
      const modelY = modelCenterY - modelSide / 2;
      localMaxima.push({
        modelX,
        modelY,
        modelWidth: modelSide,
        modelHeight: modelSide,
        proposalScore: score,
        candidate: toIntegerCandidate(
          (modelX - transform.padX) / transform.scale,
          (modelY - transform.padY) / transform.scale,
          modelSide / transform.scale,
          transform,
          score,
        ),
      });
    }
  }

  localMaxima.sort((left, right) => right.proposalScore - left.proposalScore);
  const selected: Omit<RuneOnnxProposal, "rank">[] = [];
  for (const candidate of localMaxima) {
    if (selected.some((kept) => boxIou(candidate, kept) >= RUNE_ONNX_PROPOSAL_NMS_IOU)) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= RUNE_ONNX_PROPOSAL_TOP_K) {
      break;
    }
  }
  return selected.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

export function createRuneOnnxGateInput(
  letterboxedInput: Float32Array,
  proposals: RuneOnnxProposal[],
): Float32Array {
  if (letterboxedInput.length !== INPUT_AREA * 3) {
    throw new Error("rune-onnx-invalid-letterboxed-input");
  }
  if (proposals.length === 0) {
    return new Float32Array();
  }
  const patches = new Float32Array(proposals.length * GATE_PATCH_AREA * 3);
  proposals.forEach((proposal, batchIndex) => {
    const centerX = proposal.modelX + proposal.modelWidth / 2;
    const centerY = proposal.modelY + proposal.modelHeight / 2;
    const side = Math.max(proposal.modelWidth, proposal.modelHeight) *
      RUNE_ONNX_GATE_CONTEXT_SCALE;
    const left = centerX - side / 2;
    const top = centerY - side / 2;

    for (let targetY = 0; targetY < RUNE_ONNX_GATE_PATCH_SIZE; targetY += 1) {
      const sourceY = top +
        (targetY + 0.5) * side / RUNE_ONNX_GATE_PATCH_SIZE -
        0.5;
      for (let targetX = 0; targetX < RUNE_ONNX_GATE_PATCH_SIZE; targetX += 1) {
        const sourceX = left +
          (targetX + 0.5) * side / RUNE_ONNX_GATE_PATCH_SIZE -
          0.5;
        const targetIndex = targetY * RUNE_ONNX_GATE_PATCH_SIZE + targetX;
        for (let channel = 0; channel < 3; channel += 1) {
          const batchOffset = batchIndex * GATE_PATCH_AREA * 3;
          const channelOffset = channel * GATE_PATCH_AREA;
          patches[batchOffset + channelOffset + targetIndex] =
            sampleLetterboxedChannel(letterboxedInput, sourceX, sourceY, channel);
        }
      }
    }
  });
  return patches;
}

export function decodeRuneOnnxGateOutputs(
  proposals: RuneOnnxProposal[],
  outputs: RuneOnnxGateRawOutputs,
  timing: RuneOnnxInferenceTiming = {},
): RuneDetectionResult {
  assertGateOutputs(outputs, proposals.length);
  const decisions = proposals.map((proposal, index): RuneOnnxCandidateDecision => {
    const shapeScore = sigmoid(outputs.shapeLogits[index] ?? Number.NEGATIVE_INFINITY);
    const appearanceScore = sigmoid(
      outputs.appearanceLogits[index] ?? Number.NEGATIVE_INFINITY,
    );
    const shapePass = shapeScore >= RUNE_ONNX_SHAPE_THRESHOLD;
    const appearancePass = appearanceScore >= RUNE_ONNX_APPEARANCE_THRESHOLD;
    return {
      ...proposal,
      shapeScore,
      appearanceScore,
      shapePass,
      appearancePass,
      finalPass: shapePass && appearancePass,
      decisionScore: Math.min(
        normalizeGateScore(shapeScore, RUNE_ONNX_SHAPE_THRESHOLD),
        normalizeGateScore(appearanceScore, RUNE_ONNX_APPEARANCE_THRESHOLD),
      ),
    };
  });
  const accepted = decisions.filter((candidate) => candidate.finalPass);
  const selected = selectRuneOnnxDecision(accepted) ?? selectRuneOnnxDecision(decisions);
  if (!selected) {
    return createNoProposalResult(timing);
  }
  const detected = accepted.length > 0;
  const candidate = {
    ...selected.candidate,
    confidence: selected.decisionScore,
    source: "onnx-cascade" as const,
  };
  const inferenceMs = sumInferenceTiming(timing);

  return {
    detected,
    confidence: selected.decisionScore,
    candidates: detected ? [candidate] : [],
    debug: {
      proposalCount: proposals.length,
      classifier: RUNE_ONNX_MODEL_VERSION,
      detectorKind: "onnx-cascade",
      proposalScore: selected.proposalScore,
      selectedProposalRank: selected.rank,
      shapeScore: selected.shapeScore,
      shapeThreshold: RUNE_ONNX_SHAPE_THRESHOLD,
      shapePass: selected.shapePass,
      appearanceScore: selected.appearanceScore,
      appearanceThreshold: RUNE_ONNX_APPEARANCE_THRESHOLD,
      appearancePass: selected.appearancePass,
      modelScore: selected.decisionScore,
      modelThreshold: RUNE_ONNX_THRESHOLD,
      modelCandidate: candidate,
      proposalInferenceMs: timing.proposalInferenceMs,
      gateInferenceMs: timing.gateInferenceMs,
      inferenceMs,
      reason: detected ? "shape-and-appearance-passed" : rejectionReason(selected),
    },
  };
}

export function isRuneOnnxDetectionResult(result: RuneDetectionResult): boolean {
  return result.debug.detectorKind === "onnx-cascade" &&
    result.debug.classifier === RUNE_ONNX_MODEL_VERSION;
}

export function getRuneDetectionEvidenceCandidate(
  result: RuneDetectionResult,
): RuneCandidate | null {
  return result.candidates[0] ?? result.debug.modelCandidate ?? null;
}

export function selectRuneOnnxDecision(
  candidates: RuneOnnxCandidateDecision[],
): RuneOnnxCandidateDecision | null {
  let selected: RuneOnnxCandidateDecision | null = null;
  for (const candidate of candidates) {
    if (!selected || compareDecisionPriority(candidate, selected) > 0) {
      selected = candidate;
    }
  }
  return selected;
}

function createNoProposalResult(
  timing: RuneOnnxInferenceTiming,
): RuneDetectionResult {
  const inferenceMs = sumInferenceTiming(timing);
  return {
    detected: false,
    confidence: 0,
    candidates: [],
    debug: {
      proposalCount: 0,
      classifier: RUNE_ONNX_MODEL_VERSION,
      detectorKind: "onnx-cascade",
      modelScore: 0,
      modelThreshold: RUNE_ONNX_THRESHOLD,
      proposalInferenceMs: timing.proposalInferenceMs,
      gateInferenceMs: timing.gateInferenceMs,
      inferenceMs,
      reason: "no-proposal",
    },
  };
}

function isLocalMaximum(
  heatmapLogits: Float32Array,
  gridX: number,
  gridY: number,
  score: number,
): boolean {
  const left = Math.max(0, gridX - 1);
  const right = Math.min(RUNE_ONNX_OUTPUT_WIDTH - 1, gridX + 1);
  const top = Math.max(0, gridY - 1);
  const bottom = Math.min(RUNE_ONNX_OUTPUT_HEIGHT - 1, gridY + 1);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const neighbor = sigmoid(
        heatmapLogits[y * RUNE_ONNX_OUTPUT_WIDTH + x] ?? Number.NEGATIVE_INFINITY,
      );
      if (score + 1e-12 < neighbor) {
        return false;
      }
    }
  }
  return true;
}

function sampleLetterboxedChannel(
  input: Float32Array,
  sourceX: number,
  sourceY: number,
  channel: number,
): number {
  if (
    sourceX < -0.5 ||
    sourceY < -0.5 ||
    sourceX >= RUNE_ONNX_INPUT_WIDTH - 0.5 ||
    sourceY >= RUNE_ONNX_INPUT_HEIGHT - 0.5
  ) {
    return NORMALIZED_LETTERBOX_FILL[channel] ?? 0;
  }
  const clampedX = clamp(sourceX, 0, RUNE_ONNX_INPUT_WIDTH - 1);
  const clampedY = clamp(sourceY, 0, RUNE_ONNX_INPUT_HEIGHT - 1);
  const x1 = Math.floor(clampedX);
  const y1 = Math.floor(clampedY);
  const x2 = Math.min(RUNE_ONNX_INPUT_WIDTH - 1, x1 + 1);
  const y2 = Math.min(RUNE_ONNX_INPUT_HEIGHT - 1, y1 + 1);
  const weightX = clampedX - x1;
  const weightY = clampedY - y1;
  const channelOffset = channel * INPUT_AREA;
  const topLeft = denormalizeChannel(input[channelOffset + y1 * RUNE_ONNX_INPUT_WIDTH + x1] ?? 0);
  const topRight = denormalizeChannel(input[channelOffset + y1 * RUNE_ONNX_INPUT_WIDTH + x2] ?? 0);
  const bottomLeft = denormalizeChannel(input[channelOffset + y2 * RUNE_ONNX_INPUT_WIDTH + x1] ?? 0);
  const bottomRight = denormalizeChannel(input[channelOffset + y2 * RUNE_ONNX_INPUT_WIDTH + x2] ?? 0);
  const topValue = topLeft * (1 - weightX) + topRight * weightX;
  const bottomValue = bottomLeft * (1 - weightX) + bottomRight * weightX;
  return normalizeChannel(Math.round(topValue * (1 - weightY) + bottomValue * weightY));
}

function compareDecisionPriority(
  left: RuneOnnxCandidateDecision,
  right: RuneOnnxCandidateDecision,
): number {
  const leftMargin = Math.min(
    left.shapeScore - RUNE_ONNX_SHAPE_THRESHOLD,
    left.appearanceScore - RUNE_ONNX_APPEARANCE_THRESHOLD,
  );
  const rightMargin = Math.min(
    right.shapeScore - RUNE_ONNX_SHAPE_THRESHOLD,
    right.appearanceScore - RUNE_ONNX_APPEARANCE_THRESHOLD,
  );
  if (leftMargin !== rightMargin) {
    return leftMargin - rightMargin;
  }
  return left.shapeScore + left.appearanceScore -
    (right.shapeScore + right.appearanceScore);
}

function rejectionReason(candidate: RuneOnnxCandidateDecision): string {
  if (!candidate.shapePass && !candidate.appearancePass) {
    return "shape-and-appearance-below-threshold";
  }
  return candidate.shapePass
    ? "appearance-below-threshold"
    : "shape-below-threshold";
}

function sumInferenceTiming(
  timing: RuneOnnxInferenceTiming,
): number | undefined {
  if (
    timing.proposalInferenceMs === undefined &&
    timing.gateInferenceMs === undefined
  ) {
    return undefined;
  }
  const total = (timing.proposalInferenceMs ?? 0) + (timing.gateInferenceMs ?? 0);
  return Number.isFinite(total) ? total : undefined;
}

function normalizeGateScore(score: number, threshold: number): number {
  if (score >= threshold) {
    return 0.5 + 0.5 * (score - threshold) / (1 - threshold);
  }
  return 0.5 * score / threshold;
}

function boxIou(
  left: Pick<RuneOnnxProposal, "modelX" | "modelY" | "modelWidth" | "modelHeight">,
  right: Pick<RuneOnnxProposal, "modelX" | "modelY" | "modelWidth" | "modelHeight">,
): number {
  const intersectionLeft = Math.max(left.modelX, right.modelX);
  const intersectionTop = Math.max(left.modelY, right.modelY);
  const intersectionRight = Math.min(
    left.modelX + left.modelWidth,
    right.modelX + right.modelWidth,
  );
  const intersectionBottom = Math.min(
    left.modelY + left.modelHeight,
    right.modelY + right.modelHeight,
  );
  const intersectionWidth = Math.max(0, intersectionRight - intersectionLeft);
  const intersectionHeight = Math.max(0, intersectionBottom - intersectionTop);
  const intersection = intersectionWidth * intersectionHeight;
  const union = left.modelWidth * left.modelHeight +
    right.modelWidth * right.modelHeight -
    intersection;
  return union > 0 ? intersection / union : 0;
}

function toIntegerCandidate(
  x: number,
  y: number,
  side: number,
  transform: RuneOnnxTransform,
  confidence: number,
): RuneCandidate {
  const left = clamp(Math.floor(x), 0, Math.max(0, transform.sourceWidth - 1));
  const top = clamp(Math.floor(y), 0, Math.max(0, transform.sourceHeight - 1));
  const right = clamp(Math.ceil(x + side), left + 1, transform.sourceWidth);
  const bottom = clamp(Math.ceil(y + side), top + 1, transform.sourceHeight);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    pixelCount: 0,
    confidence,
    source: "onnx-cascade",
  };
}

function assertImage(image: RuneOnnxImageLike): void {
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    throw new Error("rune-onnx-invalid-image-size");
  }
  if (image.data.length < image.width * image.height * 4) {
    throw new Error("rune-onnx-invalid-image-data");
  }
}

function assertOutputs(outputs: RuneOnnxRawOutputs): void {
  if (outputs.heatmapLogits.length !== OUTPUT_AREA) {
    throw new Error("rune-onnx-invalid-heatmap-output");
  }
  if (outputs.sideLogits.length !== OUTPUT_AREA) {
    throw new Error("rune-onnx-invalid-side-output");
  }
  if (outputs.offsetLogits.length !== OUTPUT_AREA * 2) {
    throw new Error("rune-onnx-invalid-offset-output");
  }
}

function assertGateOutputs(outputs: RuneOnnxGateRawOutputs, candidateCount: number): void {
  if (outputs.shapeLogits.length !== candidateCount) {
    throw new Error("rune-onnx-invalid-shape-output");
  }
  if (outputs.appearanceLogits.length !== candidateCount) {
    throw new Error("rune-onnx-invalid-appearance-output");
  }
}

function fillChannel(input: Float32Array, channel: number, value: number): void {
  input.fill(value, channel * INPUT_AREA, (channel + 1) * INPUT_AREA);
}

function sampleBilinearRgb(
  image: RuneOnnxImageLike,
  sourceX: number,
  sourceY: number,
): { r: number; g: number; b: number } {
  const x1 = Math.floor(clamp(sourceX, 0, image.width - 1));
  const y1 = Math.floor(clamp(sourceY, 0, image.height - 1));
  const x2 = Math.min(image.width - 1, x1 + 1);
  const y2 = Math.min(image.height - 1, y1 + 1);
  const weightX = clamp(sourceX - x1, 0, 1);
  const weightY = clamp(sourceY - y1, 0, 1);
  const topLeft = (y1 * image.width + x1) * 4;
  const topRight = (y1 * image.width + x2) * 4;
  const bottomLeft = (y2 * image.width + x1) * 4;
  const bottomRight = (y2 * image.width + x2) * 4;
  return {
    r: interpolateChannel(image.data, topLeft, topRight, bottomLeft, bottomRight, weightX, weightY, 0),
    g: interpolateChannel(image.data, topLeft, topRight, bottomLeft, bottomRight, weightX, weightY, 1),
    b: interpolateChannel(image.data, topLeft, topRight, bottomLeft, bottomRight, weightX, weightY, 2),
  };
}

function interpolateChannel(
  data: ArrayLike<number>,
  topLeft: number,
  topRight: number,
  bottomLeft: number,
  bottomRight: number,
  weightX: number,
  weightY: number,
  channel: number,
): number {
  const top = (data[topLeft + channel] ?? 0) * (1 - weightX) +
    (data[topRight + channel] ?? 0) * weightX;
  const bottom = (data[bottomLeft + channel] ?? 0) * (1 - weightX) +
    (data[bottomRight + channel] ?? 0) * weightX;
  return top * (1 - weightY) + bottom * weightY;
}

function normalizeChannel(value: number): number {
  return (value / 255 - 0.5) / 0.5;
}

function denormalizeChannel(value: number): number {
  return (value * 0.5 + 0.5) * 255;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
