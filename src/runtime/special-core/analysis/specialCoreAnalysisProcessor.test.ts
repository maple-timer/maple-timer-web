import { describe, expect, it } from "vitest";
import {
  getTopBuffRowBoxIndexes,
  SpecialCoreAnalysisProcessor,
} from "./specialCoreAnalysisProcessor";
import type { BuffSlotAnalysis } from "../../../recognition/buff-slot/parser/parseBuffSlots";
import type { SpecialCoreMatcherResult } from "../../../recognition/special-core/specialCoreMatcherTypes";

describe("SpecialCoreAnalysisProcessor", () => {
  it("uses injected buff slot analysis without reparsing the frame or loading the matcher", async () => {
    const parse = async () => {
      throw new Error("unexpected-parser-call");
    };
    const createMatcher = async () => {
      throw new Error("unexpected-matcher-call");
    };
    const processor = new SpecialCoreAnalysisProcessor({
      now: createMonotonicClock(),
      parse,
      createMatcher,
    });
    const response = await processor.process({
      imageData: null as unknown as ImageData,
      sampledAt: 13_000,
      buffSlotAnalysis: makeEmptyBuffSlotAnalysis(),
    });

    expect(response).toMatchObject({
      sampledAt: 13_000,
      parserEngine: "dl",
      parserVersion: "test-shared-parser",
      parserFallbackReason: "test-fallback",
      parserRuntime: null,
      boxCount: 0,
      parsedBoxes: [],
      rowGroups: [],
      eligibleBoxIndexes: [],
      detectedCount: 0,
      detectedIcon: null,
      candidateIcons: [],
    });
    expect(response.performance).toMatchObject({
      detectMs: expect.any(Number),
      matchMs: 0,
      boxCount: 0,
    });
  });

  it("preserves the direct parser input contract used by current-recognizer troubleshooting", async () => {
    const parseCalls: Array<{ imageData: unknown; options: unknown }> = [];
    const parsed = makeEmptyBuffSlotAnalysis();
    const processor = new SpecialCoreAnalysisProcessor({
      now: createMonotonicClock(),
      parse: async (imageData, options) => {
        parseCalls.push({ imageData, options });
        return parsed;
      },
    });
    const imageData = { width: 4, height: 4 } as ImageData;

    await processor.process({
      imageData,
      sampledAt: 13_500,
      buffSlotInputMode: "topRightQuadrant",
    });

    expect(parseCalls).toEqual([
      {
        imageData,
        options: {
          outputSize: 32,
          inputMode: "topRightQuadrant",
        },
      },
    ]);
  });

  it("uses the final V2 identity and keeps rescue evidence ahead of raw base score", async () => {
    const results = [
      makeMatcherResult({ kind: "target", score: 1.2, gateScore: 0.95 }),
      makeMatcherResult({ kind: "unknown", score: 4.8, gateScore: 0.91 }),
      makeMatcherResult({
        kind: "target",
        score: -1.6,
        gateScore: 0.9995,
        decisionReason: "near_exact_positive_prototype_rescue",
        rescuePassed: true,
      }),
    ];
    const processor = new SpecialCoreAnalysisProcessor({
      now: createMonotonicClock(),
      createMatcher: async () => ({
        version: "special-core-deep-v2@special-core-20260711-v2:test",
        matchBatch: async () => results,
      }),
    });

    const response = await processor.process({
      imageData: null as unknown as ImageData,
      sampledAt: 14_000,
      buffSlotAnalysis: makeBuffSlotAnalysis(3),
    });

    expect(response.detectedCount).toBe(2);
    expect(response.detectedIcon).toMatchObject({
      boxIndex: 2,
      match: {
        matched: true,
        score: -1.6,
        gateScore: 1,
        rescuePassed: true,
        decisionReason: "near_exact_positive_prototype_rescue",
      },
    });
    expect(response.candidateIcons.map((candidate) => candidate.boxIndex)).toEqual([2, 0, 1]);
    expect(response.parsedBoxes).toHaveLength(3);
    expect(response.rowGroups).toEqual([
      {
        rowIndex: 0,
        y: 4,
        size: 32,
        boxIndexes: [0, 1, 2],
        eligible: true,
      },
    ]);
    expect(response.eligibleBoxIndexes).toEqual([0, 1, 2]);
  });
});

function createMonotonicClock(): () => number {
  let current = 0;
  return () => {
    current += 1;
    return current;
  };
}

describe("getTopBuffRowBoxIndexes", () => {
  it.each([
    { rowCount: 1, expected: [0, 1] },
    { rowCount: 2, expected: [0, 1] },
    { rowCount: 3, expected: [0, 1, 2, 3] },
    { rowCount: 4, expected: [0, 1, 2, 3] },
    { rowCount: 5, expected: [0, 1, 2, 3, 4, 5] },
  ])("keeps only the top half for $rowCount buff rows", ({ rowCount, expected }) => {
    const boxes = makeRows(rowCount);

    expect(getTopBuffRowBoxIndexes(boxes)).toEqual(expected);
  });
});

function makeRows(rowCount: number) {
  return Array.from({ length: rowCount }).flatMap((_, rowIndex) => [
    makeBox(100, 4 + rowIndex * 39),
    makeBox(140, 5 + rowIndex * 39),
  ]);
}

function makeBox(x: number, y: number) {
  return {
    x,
    y,
    size: 32,
    confidence: 1,
    score: 1,
  };
}

function makeEmptyBuffSlotAnalysis(): BuffSlotAnalysis {
  return {
    icons: [],
    boxes: [],
    engine: "dl",
    parserVersion: "test-shared-parser",
    fallbackReason: "test-fallback",
  };
}

function makeBuffSlotAnalysis(count: number): BuffSlotAnalysis {
  return {
    icons: Array.from({ length: count }, () => ({
      width: 32,
      height: 32,
      data: new Uint8ClampedArray(32 * 32 * 4),
    })),
    boxes: Array.from({ length: count }, (_, index) => makeBox(100 + index * 40, 4)),
    engine: "dl",
    parserVersion: "test-shared-parser",
    fallbackReason: "test-fallback",
  };
}

function makeMatcherResult({
  kind,
  score,
  gateScore,
  decisionReason = kind === "target"
    ? "base_and_positive_gate_passed"
    : "below_positive_gate_threshold",
  rescuePassed = false,
}: {
  kind: "target" | "unknown";
  score: number;
  gateScore: number;
  decisionReason?: SpecialCoreMatcherResult["decisionReason"];
  rescuePassed?: boolean;
}): SpecialCoreMatcherResult {
  return {
    kind,
    matched: kind === "target",
    targetId: kind === "target" ? "specialCore" : null,
    bundleId: "special-core-deep-v2",
    modelId: "special-core-deep-v2",
    modelVersion: "special-core-20260711-v2",
    variantId: "test",
    gateVersion: 2,
    score,
    threshold: 0,
    margin: score,
    gateScore,
    gateThreshold: 0.94,
    gateMargin: gateScore - 0.94,
    rescueThreshold: 0.999,
    rescueMargin: gateScore - 0.999,
    basePassed: score >= 0,
    positiveGatePassed: gateScore >= 0.94,
    primaryPassed: score >= 0 && gateScore >= 0.94,
    rescuePassed,
    decisionReason,
    elapsedMs: 1,
  } as SpecialCoreMatcherResult;
}
