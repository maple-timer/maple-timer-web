import { describe, expect, it } from "vitest";
import { analyzeSpecialCoreReplaySample } from "./specialCoreReplay";

const NOW = 1_000_000;

describe("analyzeSpecialCoreReplaySample", () => {
  it("replays an overdue confirmed activation as due", () => {
    const result = analyzeSpecialCoreReplaySample(
      {
        body: {
          kind: "special-core-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: { specialCore: { candidateIcons: [{}] } },
          specialCore: {
            config: { enabled: true },
            state: {
              status: "cooldown",
              lastSampledAt: NOW,
              activationConfirmedAt: NOW - 20_000,
              alertDueAt: NOW - 1_000,
              alertedAt: null,
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.supported).toBe(true);
    expect(result.shouldAlert).toBe(true);
    expect(result.decisionReason).toBe("due-now");
    expect(result.causes[0]).toMatchObject({
      status: "fail",
      title: "알림 시각이 지났지만 완료 기록이 없음",
    });
  });

  it("keeps a single detection in confirming state", () => {
    const result = analyzeSpecialCoreReplaySample(
      {
        body: {
          kind: "special-core-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: { specialCore: { candidateIcons: [{}] } },
          specialCore: {
            config: { enabled: true },
            state: {
              status: "confirming",
              lastSampledAt: NOW,
              pendingDetections: [{ observedAt: NOW }],
              activationConfirmedAt: null,
              alertDueAt: null,
              alertedAt: null,
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.shouldAlert).toBe(false);
    expect(result.decisionReason).toBe("confirming");
    expect(result.causes[0]).toMatchObject({ status: "warn" });
  });

  it("reads V2 matcher evidence without treating its raw score as confidence", () => {
    const result = analyzeSpecialCoreReplaySample(
      {
        body: {
          kind: "special-core-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            result: {
              confidence: null,
              debug: {
                bestScore: 1.2,
                bestGateScore: 0.91,
                decisionReason: "below_positive_gate_threshold",
                bundleId: "special-core-deep-v2",
                modelVersion: "special-core-20260711-v2",
              },
            },
            specialCore: { candidateIcons: [] },
          },
          specialCore: {
            config: { enabled: true },
            state: { status: "waiting", lastSampledAt: NOW },
          },
        },
      },
      { now: NOW },
    );

    expect(result.metrics).toMatchObject({
      bestScore: 1.2,
      bestGateScore: 0.91,
      matcherDecision: "below_positive_gate_threshold",
      matcherBundle: "special-core-deep-v2",
      matcherModel: "special-core-20260711-v2",
    });
  });

  it("keeps matcher initialization distinct from a recognition miss", () => {
    const result = analyzeSpecialCoreReplaySample(
      {
        body: {
          kind: "special-core-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: { specialCore: { candidateIcons: [] } },
          specialCore: {
            config: { enabled: true },
            state: { status: "loading", lastSampledAt: NOW },
          },
        },
      },
      { now: NOW },
    );

    expect(result.decisionReason).toBe("loading");
    expect(result.causes[0]).toMatchObject({ title: "특수 코어 모델 준비 중" });
  });
});
