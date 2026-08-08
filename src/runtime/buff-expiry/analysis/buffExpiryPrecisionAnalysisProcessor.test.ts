import { describe, expect, it, vi } from "vitest";
import { assignBuffExpiryPrecisionBoxLayout } from "./buffExpiryPrecisionLayout";
import { orderBuffIconBoxes } from "../../../recognition/buff-slot/parser/resultOrder";
import {
  applyBottomFirstTargetEligibility,
  applyUpperRowTargetExclusion,
  BuffExpiryPrecisionAnalysisProcessor,
  type BuffExpiryPrecisionMatcherObservation,
  selectBestGroupCandidateDescriptors,
} from "./buffExpiryPrecisionAnalysisProcessor";
import type { BuffSlotAnalysis } from "../../../recognition/buff-slot/parser/parseBuffSlots";
import { getBuffGroupMatcherBundleDescriptor } from "../../../recognition/buff-expiry/group-matcher/buffGroupMatcherBundleRegistry";

describe("buff expiry precision analysis processor", () => {
  it("runs parser-only on a full frame shape", async () => {
    const processor = createProcessor();
    const response = await processor.process({
      imageData: makeBlankFrameImageData(128, 96) as unknown as ImageData,
    });

    expect(response.unsupported).toBe(false);
    expect(response.unsupportedReason).toBeNull();
    expect(response.boxes).toEqual([]);
    expect(response.icons).toEqual([]);
    expect(response.iconObservations).toEqual([]);
    expect(response.bestByGroup).toEqual([]);
    expect(response.performance.boxCount).toBe(0);
    expect(response.buffSlotLocalization).toMatchObject({
      status: "empty",
      parserBoxCount: 0,
      localizedBoxCount: 0,
    });
    expect(response.performance.detectMs).toBeGreaterThanOrEqual(0);
    expect(response.performance.matchMs).toBe(0);
  });

  it("uses injected buff slot analysis without reparsing the frame", async () => {
    const processor = createProcessor();
    const response = await processor.process({
      imageData: null as unknown as ImageData,
      sampledAt: 12_000,
      buffSlotAnalysis: makeEmptyBuffSlotAnalysis(),
    });

    expect(response.boxes).toEqual([]);
    expect(response.icons).toEqual([]);
    expect(response.iconObservations).toEqual([]);
    expect(response.bestByGroup).toEqual([]);
    expect(response.parserEngine).toBe("dl");
    expect(response.parserFallbackReason).toBe("test-fallback");
    expect(response.moduleVersions.parser).toBe("test-shared-parser");
    expect(response.performance).toMatchObject({
      detectMs: expect.any(Number),
      boxCount: 0,
      matchMs: 0,
    });
  });

  it("sends only the localized top-right buff-slot cluster to the matcher", async () => {
    const matchBatchIfReady = vi.fn().mockResolvedValue({
      results: [],
      status: "ready",
      bundleStatuses: [],
    });
    const processor = new BuffExpiryPrecisionAnalysisProcessor({
      now: () => 1,
      matcher: {
        preload: vi.fn(),
        matchBatchIfReady,
        getBundleStatuses: vi.fn(() => []),
      } as never,
    });
    const analysis = makeBuffSlotAnalysis([
      ...makeParserRow({ y: 3, right: 1888, count: 4 }),
      ...makeParserRow({ y: 56, right: 1888, count: 3 }),
      ...makeParserRow({ y: 343, right: 1384, count: 3 }),
      ...makeParserRow({ y: 388, right: 1295, count: 1 }),
    ]);

    const response = await processor.process({
      imageData: makeBlankFrameImageData(1920, 1080),
      sourceSize: { width: 1920, height: 1080 },
      buffSlotAnalysis: analysis,
      activeGroups: ["potion"],
    });

    expect(matchBatchIfReady).toHaveBeenCalledOnce();
    expect(matchBatchIfReady.mock.calls[0]?.[0]).toHaveLength(7);
    expect(response.boxes).toHaveLength(7);
    expect(response.icons).toHaveLength(7);
    expect(response.buffSlotLocalization).toMatchObject({
      status: "selected",
      parserBoxCount: 11,
      parserRowCount: 4,
      localizedBoxCount: 7,
      localizedRowCount: 2,
      spatialExcludedBoxCount: 4,
    });
    expect(response.performance).toMatchObject({
      boxCount: 11,
      localizedBoxCount: 7,
    });
  });

  it("applies lower-row eligibility only inside the localized buff-slot cluster", async () => {
    const target = createIdentityObservation("slot:2", "potion").identity;
    const matchBatchIfReady = vi.fn().mockResolvedValue({
      results: [
        createUnknownIdentityObservation("slot:0").identity,
        createUnknownIdentityObservation("slot:1").identity,
        target,
      ],
      status: "ready",
      bundleStatuses: [],
    });
    const processor = new BuffExpiryPrecisionAnalysisProcessor({
      now: () => 1,
      matcher: {
        preload: vi.fn(),
        matchBatchIfReady,
        getBundleStatuses: vi.fn(() => []),
      } as never,
    });
    const analysis = makeBuffSlotAnalysis([
      ...makeParserRow({ y: 3, right: 1888, count: 1 }),
      ...makeParserRow({ y: 56, right: 1888, count: 1 }),
      ...makeParserRow({ y: 108, right: 1888, count: 1 }),
      ...makeParserRow({ y: 343, right: 1384, count: 1 }),
      ...makeParserRow({ y: 388, right: 1295, count: 1 }),
      ...makeParserRow({ y: 434, right: 1340, count: 1 }),
    ]);

    const response = await processor.process({
      imageData: makeBlankFrameImageData(1920, 1080),
      sourceSize: { width: 1920, height: 1080 },
      buffSlotAnalysis: analysis,
      activeGroups: ["potion"],
    });

    expect(response.boxes).toHaveLength(3);
    expect(response.buffSlotLocalization).toMatchObject({
      parserRowCount: 6,
      localizedRowCount: 3,
      spatialExcludedBoxCount: 3,
    });
    expect(response.iconObservations[2]?.identity).toMatchObject({
      kind: "target",
      group: "potion",
      decisionReason: "target_accepted",
    });
  });
});

describe("buff expiry precision box layout", () => {
  it("can order parser boxes in stable UI reading order", () => {
    expect(
      orderBuffIconBoxes([
        { x: 1584, y: 72, size: 32, confidence: 1, score: 1 },
        { x: 1584, y: 38, size: 32, confidence: 1, score: 1 },
        { x: 1550, y: 38, size: 32, confidence: 1, score: 1 },
      ]).map((box) => ({ x: box.x, y: box.y })),
    ).toEqual([
      { x: 1550, y: 38 },
      { x: 1584, y: 38 },
      { x: 1584, y: 72 },
    ]);
  });

  it("assigns stable row and column positions from source-frame coordinates", () => {
    const boxes = assignBuffExpiryPrecisionBoxLayout([
      { x: 1550, y: 38, size: 32 },
      { x: 1584, y: 38, size: 32 },
      { x: 1550, y: 72, size: 32 },
      { x: 1584, y: 72, size: 32 },
    ]);

    expect(boxes.map((box) => ({ row: box.row, col: box.col }))).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ]);
  });

  it("keeps the original box order while assigning layout metadata", () => {
    const boxes = assignBuffExpiryPrecisionBoxLayout([
      { x: 1584, y: 72, size: 32 },
      { x: 1550, y: 38, size: 32 },
    ]);

    expect(boxes).toMatchObject([
      { x: 1584, y: 72, row: 1, col: 1 },
      { x: 1550, y: 38, row: 0, col: 0 },
    ]);
  });
});

describe("buff expiry precision row eligibility", () => {
  it.each([
    { rowCount: 1, excludedRows: [] },
    { rowCount: 2, excludedRows: [0] },
    { rowCount: 3, excludedRows: [0] },
    { rowCount: 4, excludedRows: [0, 1] },
    { rowCount: 5, excludedRows: [0, 1] },
  ])("uses only the lower half of $rowCount visible buff rows", ({ rowCount, excludedRows }) => {
    const observations = Array.from({ length: rowCount }, (_, row) =>
      createIdentityObservation(`slot:${row}`, "unionWealth"),
    );
    const filtered = applyUpperRowTargetExclusion(observations, createRowBoxes(rowCount));

    for (let row = 0; row < rowCount; row += 1) {
      if (excludedRows.includes(row)) {
        expect(filtered[row].identity).toMatchObject({
          kind: "unknown",
          group: null,
          decisionReason: "upper_rows_target_excluded:target_accepted",
        });
      } else {
        expect(filtered[row].identity).toMatchObject({
          kind: "target",
          group: "unionWealth",
        });
      }
    }
  });

  it("keeps the lowest matching row for single-slot groups even when an upper row scores higher", () => {
    const observations = [
      createIdentityObservation("slot:upper-luck", "unionLuck", { score: 3, margin: 3 }),
      createIdentityObservation("slot:lower-luck", "unionLuck", { score: 1, margin: 1 }),
      createIdentityObservation("slot:upper-wealth", "unionWealth", { score: 1, margin: 1 }),
    ];
    const boxes = [
      createPositionedBox({ row: 1, col: 0 }),
      createPositionedBox({ row: 2, col: 0 }),
      createPositionedBox({ row: 1, col: 1 }),
    ];

    const filtered = applyBottomFirstTargetEligibility(observations, boxes);

    expect(filtered[0].identity).toMatchObject({
      kind: "unknown",
      group: null,
      decisionReason: "bottom_first_target_excluded:target_accepted",
    });
    expect(filtered[1].identity).toMatchObject({
      kind: "target",
      group: "unionLuck",
    });
    expect(filtered[2].identity).toMatchObject({
      kind: "target",
      group: "unionWealth",
    });

    const unionLuckBest = selectBestGroupCandidateDescriptors(filtered, boxes).find(
      (candidate) => candidate.group === "unionLuck",
    );
    expect(unionLuckBest).toMatchObject({
      accepted: true,
      boxIndex: 1,
      box: { row: 2 },
    });
  });

  it("keeps up to two potion targets while searching rows from bottom to top", () => {
    const observations = [
      createIdentityObservation("slot:potion-top", "potion", { score: 3, margin: 3 }),
      createIdentityObservation("slot:potion-middle", "potion", { score: 1, margin: 1 }),
      createIdentityObservation("slot:potion-bottom", "potion", { score: 1, margin: 1 }),
    ];
    const boxes = [
      createPositionedBox({ row: 1, col: 0 }),
      createPositionedBox({ row: 2, col: 0 }),
      createPositionedBox({ row: 3, col: 0 }),
    ];

    const filtered = applyBottomFirstTargetEligibility(observations, boxes);

    expect(filtered[0].identity).toMatchObject({
      kind: "unknown",
      group: null,
      decisionReason: "bottom_first_target_excluded:target_accepted",
    });
    expect(filtered[1].identity).toMatchObject({
      kind: "target",
      group: "potion",
    });
    expect(filtered[2].identity).toMatchObject({
      kind: "target",
      group: "potion",
    });
  });

  it("keeps a position-exclusion reason scoped to the bundle that actually accepted the icon", () => {
    const top = createIdentityObservation("slot:top", "unionLuck");
    const potionDescriptor = getBuffGroupMatcherBundleDescriptor("potion");
    top.identity.candidates.push({
      group: "potion",
      bundleId: potionDescriptor.bundleId,
      modelVersion: potionDescriptor.expectedModelVersion,
      accepted: false,
      score: -1,
      threshold: 0,
      margin: -1,
      gateScore: null,
      gateThreshold: 0.5,
      gateMargin: null,
      decisionReason: "base_below_threshold",
    });
    const filtered = applyUpperRowTargetExclusion(
      [top, createUnknownIdentityObservation("slot:bottom")],
      createRowBoxes(2),
    );
    const candidates = selectBestGroupCandidateDescriptors(filtered, createRowBoxes(2));

    expect(candidates.find((candidate) => candidate.group === "unionLuck")).toMatchObject({
      accepted: false,
      matcherAccepted: true,
      decisionReason: "upper_rows_target_excluded:target_accepted",
    });
    expect(candidates.find((candidate) => candidate.group === "potion")).toMatchObject({
      accepted: false,
      matcherAccepted: false,
      decisionReason: "base_below_threshold",
    });
  });
});

function makeBlankFrameImageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 20;
    data[offset + 1] = 20;
    data[offset + 2] = 20;
    data[offset + 3] = 255;
  }
  return { width, height, data } as ImageData;
}

function createProcessor(): BuffExpiryPrecisionAnalysisProcessor {
  let now = 0;
  return new BuffExpiryPrecisionAnalysisProcessor({
    now: () => {
      now += 0.1;
      return now;
    },
  });
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

function makeBuffSlotAnalysis(
  boxes: BuffSlotAnalysis["boxes"],
): BuffSlotAnalysis {
  return {
    icons: boxes.map(() => ({
      width: 32,
      height: 32,
      data: new Uint8ClampedArray(32 * 32 * 4),
    })),
    boxes,
    engine: "dl",
    parserVersion: "test-shared-parser",
  };
}

function makeParserRow({
  y,
  right,
  count,
  size = 45,
}: {
  y: number;
  right: number;
  count: number;
  size?: number;
}): BuffSlotAnalysis["boxes"] {
  return Array.from({ length: count }, (_, index) => ({
    x: right - size * (count - index),
    y,
    size,
    confidence: 1,
    score: 1,
  }));
}

function createIdentityObservation(
  id: string,
  group: "unionWealth" | "unionLuck" | "potion" | "expCoupon",
  options: { score?: number; margin?: number } = {},
): BuffExpiryPrecisionMatcherObservation {
  const score = options.score ?? 1;
  const margin = options.margin ?? 1;
  const descriptor = getBuffGroupMatcherBundleDescriptor(group);
  const candidate = {
    group,
    bundleId: descriptor.bundleId,
    modelVersion: `test-${group}`,
    accepted: true,
    score,
    threshold: score - margin,
    margin,
    gateScore: 1,
    gateThreshold: 0.5,
    gateMargin: 0.5,
    decisionReason: "target_accepted" as const,
  };
  return {
    id,
    identity: {
      kind: "target",
      group,
      bundleId: candidate.bundleId,
      modelVersion: candidate.modelVersion,
      score,
      margin,
      gateScore: candidate.gateScore,
      gateMargin: candidate.gateMargin,
      decisionReason: "target_accepted",
      candidates: [candidate],
      bundleDecisions: [{
        group,
        bundleId: candidate.bundleId,
        modelVersion: candidate.modelVersion,
        kind: "target",
        decisionReason: "target_accepted",
        candidate,
      }],
      elapsedMs: 0,
    },
  };
}

function createUnknownIdentityObservation(id: string): BuffExpiryPrecisionMatcherObservation {
  return {
    id,
    identity: {
      kind: "unknown",
      group: null,
      bundleId: null,
      modelVersion: null,
      score: null,
      margin: null,
      gateScore: null,
      gateMargin: null,
      decisionReason: "base_below_threshold",
      candidates: [],
      bundleDecisions: [],
      elapsedMs: 0,
    },
  };
}

function createRowBoxes(rowCount: number) {
  return Array.from({ length: rowCount }, (_, row) => createPositionedBox({ row, col: 0 }));
}

function createPositionedBox({ row, col }: { row: number; col: number }) {
  return {
    x: 100 + col * 38,
    y: 40 + row * 38,
    size: 32,
    row,
    col,
    confidence: 1,
    score: 1,
  };
}
