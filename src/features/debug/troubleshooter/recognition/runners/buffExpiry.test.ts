import { describe, expect, it, vi } from "vitest";
import type { TroubleshooterViewModel } from "../../model";
import { runBuffExpiryRecognition } from "./buffExpiry";

const mocks = vi.hoisted(() => ({
  preload: vi.fn(),
  process: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("../../../../../platform/runtime-workers/buff-expiry/buffExpiryPrecisionWorkerClient", () => ({
  createBuffExpiryPrecisionEngine: () => ({
    preload: mocks.preload,
    process: mocks.process,
    reset: mocks.reset,
  }),
}));

vi.mock("../imageData", () => ({
  iconToDataUrl: () => "data:image/png;base64,icon",
}));

describe("runBuffExpiryRecognition", () => {
  it("runs only selected bundles and explains a positive-gate rejection", async () => {
    mocks.preload.mockResolvedValue({
      countdownModelStatus: "ready",
      matcherModelStatus: "ready",
    });
    mocks.process.mockResolvedValue(createGateRejectedResponse());

    const result = await runBuffExpiryRecognition({
      imageData: {} as ImageData,
      startedAt: performance.now(),
      buffSlotInputMode: "topRightQuadrant",
      view: {
        rawSample: {
          body: {
            kind: "buff-expiry-issue",
            buffExpiry: {
              config: { selectedPrecisionTargetGroups: ["potion"] },
            },
          },
        },
      } as TroubleshooterViewModel,
    });

    expect(mocks.preload).toHaveBeenCalledWith(["potion"]);
    expect(mocks.process).toHaveBeenCalledWith(
      expect.objectContaining({
        activeGroups: ["potion"],
        buffSlotInputMode: "topRightQuadrant",
      }),
    );
    expect(result.title).toContain("아이콘 형태 검증이 기준에 미달");
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "검사 대상", value: "비약" }),
        expect.objectContaining({ label: "matcher 판정", value: "아이콘 형태 검증 기준 미달" }),
        expect.objectContaining({ label: "판정 번들", value: "buff-group-potion-deep-v1" }),
        expect.objectContaining({ label: "판정 모델", value: "potion-20260711-v1" }),
        expect.objectContaining({ label: "형태 점수", value: "0.91" }),
        expect.objectContaining({ label: "형태 기준", value: "0.93" }),
      ]),
    );
    expect(result.stages.find((stage) => stage.id === "matcher")).toMatchObject({
      status: "warning",
      summary: "아이콘 형태 검증 기준 미달",
    });
    expect(mocks.reset).toHaveBeenCalledOnce();
  });
});

function createGateRejectedResponse() {
  const box = {
    x: 10,
    y: 20,
    size: 32,
    row: 0,
    col: 0,
    confidence: 0.99,
    score: 0.98,
  };
  const candidate = {
    group: "potion" as const,
    bundleId: "buff-group-potion-deep-v1",
    modelVersion: "potion-20260711-v1",
    accepted: false,
    score: 2.4,
    threshold: 1.2,
    margin: 1.2,
    gateScore: 0.91,
    gateThreshold: 0.93,
    gateMargin: -0.02,
    decisionReason: "positive_gate_below_threshold",
  };
  return {
    boxes: [box],
    icons: [{ width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) }],
    iconObservations: [
      {
        id: "slot:0",
        boxIndex: 0,
        box,
        identity: {
          kind: "unknown",
          group: null,
          score: 0,
          margin: 0,
          bundleId: null,
          modelVersion: null,
          gateScore: null,
          gateMargin: null,
          decisionReason: "positive_gate_below_threshold",
          bestTargetName: null,
          bestExcludedName: null,
          candidates: [candidate],
        },
        countdown: null,
      },
    ],
    bestByGroup: [
      {
        group: "potion",
        boxIndex: 0,
        box,
        accepted: false,
        matcherAccepted: false,
        winningGroup: null,
        score: candidate.score,
        margin: candidate.margin,
        bundleId: candidate.bundleId,
        modelVersion: candidate.modelVersion,
        gateScore: candidate.gateScore,
        gateMargin: candidate.gateMargin,
        decisionReason: candidate.decisionReason,
        countdown: null,
      },
    ],
    moduleVersions: {
      runtime: "buff-expiry-precision-runtime-v2",
      parser: "parser-current",
      matcher: "buff-group-bundle-v1",
      matcherModel: "buff-group-bundles-20260711",
      matcherBundles: [
        {
          group: "potion",
          bundleId: candidate.bundleId,
          modelVersion: candidate.modelVersion,
        },
      ],
      countdown: "countdown-current",
    },
    unsupported: false,
    unsupportedReason: null,
    performance: {
      totalMs: 12,
      detectMs: 3,
      matchMs: 4,
      countdownMs: 0,
      countdownCount: 0,
      countdownModelStatus: "ready",
      matcherModelStatus: "ready",
      boxCount: 1,
    },
  };
}
