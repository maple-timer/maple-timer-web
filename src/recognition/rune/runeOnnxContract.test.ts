import { describe, expect, it } from "vitest";
import {
  createRuneOnnxGateInput,
  createRuneOnnxInputData,
  decodeRuneOnnxGateOutputs,
  decodeRuneOnnxProposals,
  RUNE_ONNX_APPEARANCE_THRESHOLD,
  RUNE_ONNX_GATE_PATCH_SIZE,
  RUNE_ONNX_INPUT_HEIGHT,
  RUNE_ONNX_INPUT_WIDTH,
  RUNE_ONNX_OUTPUT_HEIGHT,
  RUNE_ONNX_OUTPUT_WIDTH,
  RUNE_ONNX_PROPOSAL_TOP_K,
  RUNE_ONNX_SHAPE_THRESHOLD,
  RUNE_ONNX_THRESHOLD,
  type RuneOnnxProposal,
} from "./runeOnnxContract";

const OUTPUT_AREA = RUNE_ONNX_OUTPUT_WIDTH * RUNE_ONNX_OUTPUT_HEIGHT;
const IDENTITY_TRANSFORM = {
  sourceWidth: RUNE_ONNX_INPUT_WIDTH,
  sourceHeight: RUNE_ONNX_INPUT_HEIGHT,
  scale: 1,
  resizedWidth: RUNE_ONNX_INPUT_WIDTH,
  resizedHeight: RUNE_ONNX_INPUT_HEIGHT,
  padX: 0,
  padY: 0,
};

describe("runeOnnxContract", () => {
  it("creates planar normalized input without resizing an exact-size image", () => {
    const data = new Uint8ClampedArray(RUNE_ONNX_INPUT_WIDTH * RUNE_ONNX_INPUT_HEIGHT * 4);
    data.set([255, 128, 0, 255], 0);

    const result = createRuneOnnxInputData({
      width: RUNE_ONNX_INPUT_WIDTH,
      height: RUNE_ONNX_INPUT_HEIGHT,
      data,
    });

    expect(result).toMatchObject({
      scale: 1,
      resizedWidth: 320,
      resizedHeight: 192,
      padX: 0,
      padY: 0,
    });
    expect(result.input[0]).toBeCloseTo(1);
    expect(result.input[RUNE_ONNX_INPUT_WIDTH * RUNE_ONNX_INPUT_HEIGHT]).toBeCloseTo(
      (128 / 255 - 0.5) / 0.5,
    );
    expect(result.input[RUNE_ONNX_INPUT_WIDTH * RUNE_ONNX_INPUT_HEIGHT * 2]).toBeCloseTo(-1);
  });

  it("letterboxes a wide image with the frozen fill color", () => {
    const result = createRuneOnnxInputData({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]),
    });

    expect(result).toMatchObject({
      scale: 160,
      resizedWidth: 320,
      resizedHeight: 160,
      padX: 0,
      padY: 16,
    });
    expect(result.input[0]).toBeCloseTo((16 / 255 - 0.5) / 0.5);
    expect(result.input[RUNE_ONNX_INPUT_WIDTH * 16]).toBeCloseTo(1);
  });

  it("decodes five local maxima and suppresses overlapping proposals", () => {
    const outputs = createProposalOutputs();
    const peaks = [
      [10, 10, 10],
      [12, 10, 9],
      [25, 10, 8],
      [40, 10, 7],
      [55, 10, 6],
      [70, 10, 5],
    ] as const;
    for (const [gridX, gridY, logit] of peaks) {
      const index = gridY * RUNE_ONNX_OUTPUT_WIDTH + gridX;
      outputs.heatmapLogits[index] = logit;
      outputs.sideLogits[index] = 10;
    }

    const proposals = decodeRuneOnnxProposals(outputs, IDENTITY_TRANSFORM);

    expect(proposals).toHaveLength(RUNE_ONNX_PROPOSAL_TOP_K);
    expect(proposals.map((proposal) => proposal.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(proposals.map((proposal) => Math.round(proposal.modelX))).toEqual([
      26,
      86,
      146,
      206,
      266,
    ]);
  });

  it("extracts one normalized 48px patch for every proposal", () => {
    const input = new Float32Array(RUNE_ONNX_INPUT_WIDTH * RUNE_ONNX_INPUT_HEIGHT * 3);
    input.fill(-1);
    const centerIndex = 96 * RUNE_ONNX_INPUT_WIDTH + 160;
    input[centerIndex] = 1;
    const proposal = createProposal({ modelX: 152, modelY: 88, modelWidth: 16, modelHeight: 16 });

    const patches = createRuneOnnxGateInput(input, [proposal]);

    expect(patches).toHaveLength(RUNE_ONNX_GATE_PATCH_SIZE ** 2 * 3);
    expect(Math.max(...patches)).toBeGreaterThan(0);
  });

  it("requires both independent gates and selects the strongest accepted candidate", () => {
    const proposals = [
      createProposal({ rank: 1, proposalScore: 0.99, modelX: 20 }),
      createProposal({ rank: 2, proposalScore: 0.8, modelX: 80 }),
    ];
    const result = decodeRuneOnnxGateOutputs(
      proposals,
      {
        shapeLogits: new Float32Array([
          logit(0.98),
          logit(RUNE_ONNX_SHAPE_THRESHOLD + 0.03),
        ]),
        appearanceLogits: new Float32Array([
          logit(RUNE_ONNX_APPEARANCE_THRESHOLD - 0.2),
          logit(RUNE_ONNX_APPEARANCE_THRESHOLD + 0.04),
        ]),
      },
      { proposalInferenceMs: 1, gateInferenceMs: 2 },
    );

    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(RUNE_ONNX_THRESHOLD);
    expect(result.candidates[0]).toMatchObject({
      x: 80,
      source: "onnx-cascade",
    });
    expect(result.debug).toMatchObject({
      detectorKind: "onnx-cascade",
      selectedProposalRank: 2,
      shapePass: true,
      appearancePass: true,
      proposalInferenceMs: 1,
      gateInferenceMs: 2,
      inferenceMs: 3,
      reason: "shape-and-appearance-passed",
    });
  });

  it("keeps the strongest rejected proposal as evidence without producing an alert candidate", () => {
    const proposals = [
      createProposal({ rank: 1, proposalScore: 0.99 }),
      createProposal({ rank: 2, proposalScore: 0.8, modelX: 80 }),
    ];
    const result = decodeRuneOnnxGateOutputs(proposals, {
      shapeLogits: new Float32Array([logit(0.95), logit(0.5)]),
      appearanceLogits: new Float32Array([logit(0.4), logit(0.99)]),
    });

    expect(result.detected).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.confidence).toBeLessThan(RUNE_ONNX_THRESHOLD);
    expect(result.debug).toMatchObject({
      selectedProposalRank: 2,
      shapePass: false,
      appearancePass: true,
      reason: "shape-below-threshold",
    });
    expect(result.debug.modelCandidate).toBeDefined();
  });

  it("returns a no-proposal result without inventing an inference duration", () => {
    const withoutTiming = decodeRuneOnnxGateOutputs(
      [],
      {
        shapeLogits: new Float32Array(),
        appearanceLogits: new Float32Array(),
      },
    );
    const withProposalTiming = decodeRuneOnnxGateOutputs(
      [],
      {
        shapeLogits: new Float32Array(),
        appearanceLogits: new Float32Array(),
      },
      { proposalInferenceMs: 1.5 },
    );

    expect(withoutTiming).toMatchObject({
      detected: false,
      candidates: [],
      debug: {
        proposalCount: 0,
        reason: "no-proposal",
      },
    });
    expect(withoutTiming.debug.inferenceMs).toBeUndefined();
    expect(withProposalTiming.debug.inferenceMs).toBe(1.5);
  });
});

function createProposalOutputs() {
  const heatmapLogits = new Float32Array(OUTPUT_AREA);
  for (let index = 0; index < OUTPUT_AREA; index += 1) {
    heatmapLogits[index] = -50 - index * 0.001;
  }
  return {
    heatmapLogits,
    sideLogits: new Float32Array(OUTPUT_AREA),
    offsetLogits: new Float32Array(OUTPUT_AREA * 2),
  };
}

function createProposal(
  overrides: Partial<RuneOnnxProposal> = {},
): RuneOnnxProposal {
  const modelX = overrides.modelX ?? 20;
  const modelY = overrides.modelY ?? 20;
  const modelWidth = overrides.modelWidth ?? 16;
  const modelHeight = overrides.modelHeight ?? 16;
  return {
    rank: overrides.rank ?? 1,
    modelX,
    modelY,
    modelWidth,
    modelHeight,
    proposalScore: overrides.proposalScore ?? 0.9,
    candidate: {
      x: Math.floor(modelX),
      y: Math.floor(modelY),
      width: Math.ceil(modelWidth),
      height: Math.ceil(modelHeight),
      pixelCount: 0,
      confidence: overrides.proposalScore ?? 0.9,
      source: "onnx-cascade",
    },
  };
}

function logit(score: number): number {
  return Math.log(score / (1 - score));
}
