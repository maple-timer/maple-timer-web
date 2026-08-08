import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TroubleshooterViewModel } from "../../model";
import { runSpecialCoreRecognition } from "./specialCore";

const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  reset: vi.fn(),
}));

vi.mock(
  "../../../../../platform/runtime-workers/special-core/specialCoreAlertWorkerClient",
  () => ({
    createSpecialCoreAlertEngine: () => ({
      process: mocks.process,
      reset: mocks.reset,
    }),
  }),
);

vi.mock("../imageData", () => ({
  iconToDataUrl: () => "data:image/png;base64,icon",
}));

describe("runSpecialCoreRecognition", () => {
  beforeEach(() => {
    mocks.process.mockReset();
    mocks.reset.mockReset();
  });

  it("shows the V2 bundle and positive-gate rejection without claiming an alert", async () => {
    mocks.process.mockResolvedValue({
      boxCount: 18,
      parserVersion: "parser-current",
      detectedCount: 0,
      detectedIcon: null,
      candidateIcons: [
        {
          icon: { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) },
          match: {
            matched: false,
            targetId: null,
            bundleId: "special-core-deep-v2",
            modelId: "special-core-deep-v2",
            modelVersion: "special-core-20260711-v2",
            variantId: "default",
            gateVersion: 2,
            score: 1.2,
            threshold: 0,
            margin: 1.2,
            gateScore: 0.91,
            gateThreshold: 0.94,
            gateMargin: -0.03,
            rescueThreshold: 0.999,
            rescueMargin: -0.089,
            basePassed: true,
            positiveGatePassed: false,
            primaryPassed: false,
            rescuePassed: false,
            decisionReason: "below_positive_gate_threshold",
            elapsedMs: 1,
          },
        },
      ],
    });

    const result = await runSpecialCoreRecognition({
      imageData: {} as ImageData,
      startedAt: performance.now(),
      buffSlotInputMode: "topRightQuadrant",
      view: {} as TroubleshooterViewModel,
    });

    expect(result.tone).toBe("warning");
    expect(result.title).toContain("형태 검증 기준 미달");
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "matcher 판정", value: "형태 검증 기준 미달" }),
        expect.objectContaining({ label: "1차 점수", value: "1.2" }),
        expect.objectContaining({ label: "형태 점수", value: "0.91" }),
        expect.objectContaining({ label: "matcher 번들", value: "special-core-deep-v2" }),
        expect.objectContaining({ label: "matcher 모델", value: "special-core-20260711-v2" }),
      ]),
    );
    expect(result.stages.find((stage) => stage.id === "matcher")).toMatchObject({
      status: "warning",
      summary: "형태 검증 기준 미달",
    });
    expect(result.stages.find((stage) => stage.id === "confirmation")).toMatchObject({
      status: "unavailable",
      summary: "연속 프레임 필요",
    });
    expect(mocks.process).toHaveBeenCalledWith(
      expect.objectContaining({ buffSlotInputMode: "topRightQuadrant" }),
    );
    expect(mocks.reset).toHaveBeenCalledOnce();
  });
});
