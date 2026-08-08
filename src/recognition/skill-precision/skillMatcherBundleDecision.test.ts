import { describe, expect, it } from "vitest";
import {
  decideSkillMatcherBundleBatch,
  mergeSkillMatcherBundleDecisions,
  type SkillMatcherBundlePolicy,
  type SkillMatcherPositiveGate,
} from "./skillMatcherBundleDecision";
import {
  buildSkillMatcherBundleAssetUrl,
  getRequiredSkillMatcherBundleDescriptors,
  getSkillMatcherBundleDescriptor,
} from "./skillMatcherBundleRegistry";

describe("skill matcher bundle registry", () => {
  it("deduplicates active skills by bundle", () => {
    expect(
      getRequiredSkillMatcherBundleDescriptors(["janus", "barrier", "fountain"])
        .map((descriptor) => descriptor.bundleId),
    ).toEqual(["skill-deep-v2"]);
    expect(
      getRequiredSkillMatcherBundleDescriptors(["janus", "maehwaYein"])
        .map((descriptor) => descriptor.bundleId),
    ).toEqual(["skill-deep-v2", "skill-maehwa-yein-deep-v1"]);
  });

  it("adds the expected model version as an asset cache key", () => {
    const descriptor = getSkillMatcherBundleDescriptor("skill-deep-v2");
    expect(descriptor.rootPath).toBe("/models/skill-deep-v2-positive-gates-v3");
    expect(buildSkillMatcherBundleAssetUrl(descriptor, "policy.json")).toContain(
      "confirmed-bg-v1-seed20260632-r2-positive-gates-v3",
    );
    expect(() => buildSkillMatcherBundleAssetUrl(descriptor, "../policy.json")).toThrow(
      "invalid-skill-matcher-asset-path",
    );
  });
});

describe("skill matcher bundle decisions", () => {
  it("does not fall back to an active second-best target when the base target is disabled", () => {
    const decisions = decideSkillMatcherBundleBatch({
      policy: createSharedPolicy(),
      logits: new Float32Array([3, 1, 0]),
      embeddings: new Float32Array([1, 0]),
      imageCount: 1,
      activeSkillIds: new Set(["barrier"]),
      gates: new Map([["barrier", createGate("barrier", [0, 1], 0.5)]]),
    });

    expect(decisions[0]).toMatchObject({
      kind: "unknown",
      baseSkillId: "janus",
      decisionReason: "base_target_disabled",
    });
    expect(decisions[0]?.bestMatch).toMatchObject({
      skillId: "janus",
      matched: false,
      decisionReason: "base_target_disabled",
    });
  });

  it("requires both the base classifier and positive gate to accept a target", () => {
    const policy = createSharedPolicy();
    const failed = decideSkillMatcherBundleBatch({
      policy,
      logits: new Float32Array([3, 1, 0]),
      embeddings: new Float32Array([1, 0]),
      imageCount: 1,
      activeSkillIds: new Set(["janus"]),
      gates: new Map([["janus", createGate("janus", [0, 1], 0.5)]]),
    });
    const accepted = decideSkillMatcherBundleBatch({
      policy,
      logits: new Float32Array([3, 1, 0]),
      embeddings: new Float32Array([1, 0]),
      imageCount: 1,
      activeSkillIds: new Set(["janus"]),
      gates: new Map([["janus", createGate("janus", [1, 0], 0.5)]]),
    });

    expect(failed[0]).toMatchObject({
      kind: "unknown",
      baseSkillId: "janus",
      decisionReason: "positive_gate_below_threshold",
    });
    expect(failed[0]?.bestMatch).toMatchObject({
      gateScore: 0,
      gateThreshold: 0.5,
      gateMargin: -0.5,
    });
    expect(accepted[0]).toMatchObject({
      kind: "target",
      skillId: "janus",
      decisionReason: "target_accepted",
    });
    expect(accepted[0]?.bestMatch).toMatchObject({
      matched: true,
      gateScore: 1,
      gateMargin: 0.5,
    });
  });

  it("rejects an icon when two independent bundles accept it", () => {
    const shared = decideSkillMatcherBundleBatch({
      policy: createSharedPolicy(),
      logits: new Float32Array([3, 1, 0]),
      embeddings: new Float32Array([1, 0]),
      imageCount: 1,
      activeSkillIds: new Set(["janus"]),
      gates: new Map([["janus", createGate("janus", [1, 0], 0.5)]]),
    });
    const yein = decideSkillMatcherBundleBatch({
      policy: createYeinPolicy(),
      logits: new Float32Array([7, 0]),
      embeddings: new Float32Array([1, 0]),
      imageCount: 1,
      activeSkillIds: new Set(["maehwaYein"]),
      gates: new Map([["maehwaYein", createGate("maehwaYein", [1, 0], 0.5)]]),
    });

    const [result] = mergeSkillMatcherBundleDecisions([shared, yein], 12.5);

    expect(result).toMatchObject({
      kind: "unknown",
      matched: false,
      decisionReason: "cross_bundle_conflict",
      bestMatch: null,
      elapsedMs: 12.5,
    });
    expect(result?.candidates.filter((candidate) => candidate.baseSelected)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ skillId: "janus", matched: false, decisionReason: "cross_bundle_conflict" }),
        expect.objectContaining({ skillId: "maehwaYein", matched: false, decisionReason: "cross_bundle_conflict" }),
      ]),
    );
  });
});

function createSharedPolicy(): SkillMatcherBundlePolicy {
  return {
    contractVersion: 1,
    bundleId: "skill-deep-v2",
    modelId: "skill-deep-v2",
    modelVersion: "shared-test",
    variantId: "test",
    files: {
      onnx: "model.onnx",
      onnxData: "model.onnx.data",
      policy: "policy.json",
    },
    labels: ["janus", "barrier", "background"],
    skills: ["janus", "barrier"],
    backgroundLabel: "background",
    scoreKind: "logitMargin",
    thresholds: { janus: 0, barrier: 0 },
    input: {
      shape: [1, 3, 32, 32],
      layout: "CHW",
      color: "RGB",
      normalization: "test",
    },
    output: {
      logits: { name: "logits", shape: [1, 3], order: ["janus", "barrier", "background"] },
      embedding: { name: "embedding", shape: [1, 2], normalization: "L2" },
    },
    modelConfig: { embeddingDim: 2, logitScale: 1 },
    postGates: {
      janus: createGatePolicy("janus", 0.5),
      barrier: createGatePolicy("barrier", 0.5),
    },
  };
}

function createYeinPolicy(): SkillMatcherBundlePolicy {
  return {
    contractVersion: 1,
    bundleId: "skill-maehwa-yein-deep-v1",
    modelId: "skill-maehwa-yein-deep-v1",
    modelVersion: "yein-test",
    variantId: "test",
    files: {
      onnx: "model.onnx",
      onnxData: "model.onnx.data",
      policy: "policy.json",
    },
    labels: ["maehwaYein", "background"],
    skills: ["maehwaYein"],
    backgroundLabel: "background",
    scoreKind: "logitMargin",
    thresholds: { maehwaYein: 6 },
    input: {
      shape: [1, 3, 32, 32],
      layout: "CHW",
      color: "RGB",
      normalization: "test",
    },
    output: {
      logits: { name: "logits", shape: [1, 2], order: ["maehwaYein", "background"] },
      embedding: { name: "embedding", shape: [1, 2], normalization: "L2" },
    },
    modelConfig: { embeddingDim: 2, logitScale: 1 },
    postGates: {
      maehwaYein: createGatePolicy("maehwaYein", 0.5),
    },
  };
}

function createGatePolicy(skillId: "janus" | "barrier" | "maehwaYein", threshold: number) {
  return {
    kind: "positivePrototypeCosine" as const,
    artifact: `${skillId}.json`,
    threshold,
    prototypeCount: 1,
    embeddingDim: 2,
    failureDecision: "unknown" as const,
  };
}

function createGate(
  targetId: "janus" | "barrier" | "maehwaYein",
  prototype: [number, number],
  threshold: number,
): SkillMatcherPositiveGate {
  return {
    targetId,
    threshold,
    prototypeCount: 1,
    embeddingDim: 2,
    prototypes: new Float32Array(prototype),
  };
}
