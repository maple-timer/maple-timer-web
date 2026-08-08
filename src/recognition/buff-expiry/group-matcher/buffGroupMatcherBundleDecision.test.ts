import { describe, expect, it } from "vitest";
import type { PositivePrototypeGate } from "../../matching/positiveGatedOnnxRuntime";
import {
  decideBuffGroupMatcherBundleBatch,
  mergeBuffGroupMatcherBundleDecisions,
  type BuffGroupMatcherBundlePolicy,
} from "./buffGroupMatcherBundleDecision";

describe("buff group matcher bundle decisions", () => {
  it("requires both the base threshold and positive gate", () => {
    const policy = makePolicy("potion", 1);
    const gate = makeGate("potion", 0.8);
    const decisions = decideBuffGroupMatcherBundleBatch({
      policy,
      logits: Float32Array.from([2, 0, 2, 0, 0, 1]),
      embeddings: Float32Array.from([1, 0, 0.6, 0.2, 1, 0]),
      imageCount: 3,
      gate,
    });

    expect(decisions.map((decision) => decision.decisionReason)).toEqual([
      "target_accepted",
      "positive_gate_below_threshold",
      "base_below_threshold",
    ]);
  });

  it("returns a target only when exactly one independent bundle accepts", () => {
    const potion = decideOne("potion", true);
    const luck = decideOne("unionLuck", false);

    expect(mergeBuffGroupMatcherBundleDecisions([[potion], [luck]], 4)[0]).toMatchObject({
      kind: "target",
      group: "potion",
      decisionReason: "target_accepted",
    });
  });

  it("returns a conflict without ranking independently calibrated margins", () => {
    const potion = decideOne("potion", true, 0.1);
    const luck = decideOne("unionLuck", true, 100);
    const result = mergeBuffGroupMatcherBundleDecisions([[potion], [luck]], 4)[0];

    expect(result).toMatchObject({
      kind: "unknown",
      group: null,
      score: null,
      margin: null,
      decisionReason: "cross_bundle_conflict",
    });
    expect(result.candidates).toHaveLength(2);
  });
});

function decideOne(
  group: "unionWealth" | "unionLuck" | "potion" | "expCoupon",
  accepted: boolean,
  margin = 1,
) {
  return decideBuffGroupMatcherBundleBatch({
    policy: makePolicy(group, 1),
    logits: Float32Array.from([1 + margin, 0]),
    embeddings: Float32Array.from(accepted ? [1, 0] : [0, 1]),
    imageCount: 1,
    gate: makeGate(group, 0.8),
  })[0];
}

function makePolicy(
  group: "unionWealth" | "unionLuck" | "potion" | "expCoupon",
  threshold: number,
): BuffGroupMatcherBundlePolicy {
  const bundleId = `buff-group-${group.toLowerCase()}-deep-v1` as BuffGroupMatcherBundlePolicy["bundleId"];
  return {
    contractVersion: 1,
    bundleId,
    modelId: bundleId,
    modelVersion: `${group}-test`,
    variantId: "test",
    files: { onnx: "model.onnx", onnxData: "model.onnx.data" },
    labels: [group, "background"],
    groups: [group],
    backgroundLabel: "background",
    scoreKind: "logitMargin",
    thresholds: { [group]: threshold },
    input: {
      shape: [1, 3, 32, 32],
      layout: "CHW",
      color: "RGB",
      normalization: "test",
    },
    output: {
      logits: { name: "logits", shape: [1, 2], order: [group, "background"] },
      embedding: { name: "embedding", shape: [1, 2], normalization: "L2" },
    },
    postGates: {
      [group]: {
        kind: "positivePrototypeCosine",
        artifact: "gate.json",
        threshold: 0.8,
        prototypeCount: 1,
        embeddingDim: 2,
        failureDecision: "unknown",
      },
    },
  };
}

function makeGate(
  targetId: "unionWealth" | "unionLuck" | "potion" | "expCoupon",
  threshold: number,
): PositivePrototypeGate<typeof targetId> {
  return {
    targetId,
    threshold,
    prototypeCount: 1,
    embeddingDim: 2,
    prototypes: Float32Array.from([1, 0]),
  };
}
