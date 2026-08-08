import { describe, expect, it } from "vitest";
import {
  createPositiveGatedInputData,
  getMaximumPositivePrototypeCosine,
  parsePositivePrototypeGate,
} from "./positiveGatedOnnxRuntime";

describe("positive gated ONNX runtime helpers", () => {
  it("converts 32x32 RGBA pixels to normalized RGB CHW data", () => {
    const data = new Uint8ClampedArray(32 * 32 * 4);
    data.set([0, 127.5, 255, 255], 0);
    const input = createPositiveGatedInputData([{ width: 32, height: 32, data }]);

    expect(input).toHaveLength(3 * 32 * 32);
    expect(input[0]).toBe(-1);
    expect(input[32 * 32]).toBeCloseTo((128 / 255 - 0.5) / 0.5, 5);
    expect(input[32 * 32 * 2]).toBe(1);
  });

  it("validates and flattens positive prototype gates", () => {
    const policy = {
      kind: "positivePrototypeCosine" as const,
      artifact: "gate.json",
      threshold: 0.8,
      prototypeCount: 2,
      embeddingDim: 2,
      failureDecision: "unknown" as const,
    };
    const gate = parsePositivePrototypeGate({
      targetId: "target",
      policy,
      errorPrefix: "test",
      value: {
        targetId: "target",
        threshold: 0.8,
        prototypeCount: 2,
        embeddingDim: 2,
        prototypes: [[1, 0], [0, 1]],
      },
    });

    expect([...gate.prototypes]).toEqual([1, 0, 0, 1]);
    expect(getMaximumPositivePrototypeCosine(Float32Array.from([0.6, 0.8]), 0, gate)).toBeCloseTo(0.8);
  });

  it("rejects gate metadata that differs from policy", () => {
    expect(() => parsePositivePrototypeGate({
      targetId: "target",
      policy: {
        kind: "positivePrototypeCosine",
        artifact: "gate.json",
        threshold: 0.9,
        prototypeCount: 1,
        embeddingDim: 2,
        failureDecision: "unknown",
      },
      errorPrefix: "test",
      value: {
        targetId: "target",
        threshold: 0.8,
        prototypeCount: 1,
        embeddingDim: 2,
        prototypes: [[1, 0]],
      },
    })).toThrow("test-gate-policy-mismatch:target");
  });
});
