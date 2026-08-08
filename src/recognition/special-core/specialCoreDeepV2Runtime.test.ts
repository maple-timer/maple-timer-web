import { describe, expect, it, vi } from "vitest";
import {
  createRuntimeSpecialCoreMatcherV2,
  type SpecialCoreDeepV2InferenceRunner,
  type SpecialCoreDeepV2PolicyArtifact,
  type SpecialCorePositiveGateArtifact,
  type SpecialCoreRuntimeImageSource,
} from "./specialCoreDeepV2Runtime";

describe("RuntimeSpecialCoreMatcherV2", () => {
  it("applies primary, positive-gate rejection, rescue, and base rejection in one batch", async () => {
    const runInference = vi.fn<SpecialCoreDeepV2InferenceRunner>(async (request) => {
      expect(request.dims).toEqual([4, 3, 32, 32]);
      return {
        logits: Float32Array.from([
          1, 0,
          1, 0,
          -1, 1,
          -1, 1,
        ]),
        embedding: Float32Array.from([
          1, 0, 0,
          0, 0, 1,
          1, 0, 0,
          0, 0, 1,
        ]),
      };
    });
    const matcher = createRuntimeSpecialCoreMatcherV2({
      policy: makePolicy(),
      positiveGate: makeGate(),
      runInference,
    });

    const observations = await matcher.observeBatch([
      { id: "primary", image: makeImage(), capturedAtMs: 10, slot: { index: 0, x: 100, y: 20 } },
      { id: "gate-reject", image: makeImage(), capturedAtMs: 10, slot: { index: 1 } },
      { id: "rescue", image: makeImage(), capturedAtMs: 10, slot: { index: 2 } },
      { id: "base-reject", image: makeImage(), capturedAtMs: 10, slot: { index: 3 } },
    ]);

    expect(runInference).toHaveBeenCalledTimes(1);
    expect(observations.map((item) => item.identity.kind)).toEqual(["target", "unknown", "target", "unknown"]);
    expect(observations.map((item) => item.identity.decisionReason)).toEqual([
      "base_and_positive_gate_passed",
      "below_positive_gate_threshold",
      "near_exact_positive_prototype_rescue",
      "below_base_threshold",
    ]);
    expect(observations[0].identity.targetId).toBe("specialCore");
    expect(observations[1].identity.basePassed).toBe(true);
    expect(observations[1].identity.positiveGatePassed).toBe(false);
    expect(observations[2].identity.basePassed).toBe(false);
    expect(observations[2].identity.rescuePassed).toBe(true);
    expect(observations[0].slot).toEqual({ index: 0, x: 100, y: 20 });
  });

  it("normalizes RGBA to RGB CHW and ignores alpha", async () => {
    let captured: Float32Array | undefined;
    const matcher = createRuntimeSpecialCoreMatcherV2({
      policy: makePolicy(),
      positiveGate: makeGate(),
      runInference: async (request) => {
        captured = request.data;
        return {
          logits: Float32Array.from([1, 0]),
          embedding: Float32Array.from([1, 0, 0]),
        };
      },
    });

    await matcher.matchIcon(makeImage([0, 127, 255, 0]));

    expect(captured?.length).toBe(3 * 32 * 32);
    expect(captured?.[0]).toBe(-1);
    expect(captured?.[32 * 32]).toBeCloseTo(127 / 127.5 - 1, 7);
    expect(captured?.[2 * 32 * 32]).toBe(1);
  });

  it("rejects malformed inference output instead of making a partial decision", async () => {
    const matcher = createRuntimeSpecialCoreMatcherV2({
      policy: makePolicy(),
      positiveGate: makeGate(),
      runInference: async () => ({ logits: [1], embedding: [1, 0, 0] }),
    });

    await expect(matcher.matchIcon(makeImage())).rejects.toThrow("Expected 2 logits, got 1");
  });

  it("validates policy and positive-gate thresholds at initialization", () => {
    const gate = makeGate();
    gate.threshold = 0.95;

    expect(() => createRuntimeSpecialCoreMatcherV2({
      policy: makePolicy(),
      positiveGate: gate,
      runInference: async () => ({ logits: [], embedding: [] }),
    })).toThrow("gate thresholds do not match policy");
  });
});

function makePolicy(): SpecialCoreDeepV2PolicyArtifact {
  return {
    contractVersion: 1,
    bundleId: "special-core-deep-v2",
    modelId: "special-core-deep-v2",
    modelVersion: "test-v2",
    variantId: "test",
    files: {
      onnx: "special-core-deep-v2.onnx",
      onnxData: "special-core-deep-v2.onnx.data",
      policy: "policy.json",
      positiveGate: "special-core-positive-gate.json",
    },
    labels: ["specialCore", "background"],
    targetId: "specialCore",
    backgroundLabel: "background",
    scoreKind: "logitMargin",
    thresholds: { specialCore: 0 },
    input: {
      name: "input",
      shape: [1, 3, 32, 32],
      layout: "CHW",
      color: "RGB",
      normalization: "test",
    },
    output: {
      logits: { name: "logits", shape: [1, 2], order: ["specialCore", "background"] },
      embedding: { name: "embedding", shape: [1, 3], normalization: "L2" },
    },
    postGates: {
      specialCore: {
        kind: "positivePrototypeCosine",
        artifact: "special-core-positive-gate.json",
        score: "max cosine",
        threshold: 0.94,
        rescueThreshold: 0.999,
        prototypeCount: 2,
        embeddingDim: 3,
        rescueIgnoresBaseThreshold: true,
        failureDecision: "unknown",
      },
    },
  };
}

function makeGate(): SpecialCorePositiveGateArtifact {
  return {
    kind: "special-core-positive-embedding-gate",
    version: 2,
    modelId: "special-core-deep-v2",
    targetId: "specialCore",
    embeddingDim: 3,
    scoreKind: "max-cosine-to-positive-prototypes",
    threshold: 0.94,
    rescueThreshold: 0.999,
    prototypeCount: 2,
    prototypes: [
      [1, 0, 0],
      [0, 1, 0],
    ],
  };
}

function makeImage(
  color: [number, number, number, number] = [90, 120, 150, 255],
): SpecialCoreRuntimeImageSource {
  const data = new Uint8ClampedArray(32 * 32 * 4);
  for (let index = 0; index < 32 * 32; index += 1) data.set(color, index * 4);
  return { width: 32, height: 32, data };
}
