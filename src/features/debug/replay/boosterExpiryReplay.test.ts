import { describe, expect, it } from "vitest";
import { analyzeBoosterExpiryReplaySample } from "./boosterExpiryReplay";

const NOW = 1_000_000;

describe("analyzeBoosterExpiryReplaySample", () => {
  it("reports a future booster expiry alert schedule", () => {
    const result = analyzeBoosterExpiryReplaySample(
      createBoosterSample({
        state: {
          status: "armed",
          lastSampledAt: NOW,
          confirmedExpiresAt: NOW + 100_000,
          alertAt: NOW + 90_000,
          alertedAt: null,
          remainingSeconds: 100,
        },
      }),
      { now: NOW },
    );

    expect(result.supported).toBe(true);
    expect(result.confirmedExpiresAt).toBe(NOW + 100_000);
    expect(result.secondsUntilAlert).toBe(90);
    expect(result.dueDecision).toMatchObject({
      shouldAlert: false,
      reason: "scheduled-future",
      scheduleSource: "state",
    });
    expect(result.causes[0]).toMatchObject({
      status: "pass",
      title: "알림 예정",
    });
  });

  it("marks a confirmed schedule as due when alertAt has passed", () => {
    const result = analyzeBoosterExpiryReplaySample(
      createBoosterSample({
        state: {
          status: "armed",
          lastSampledAt: NOW,
          confirmedExpiresAt: NOW + 8_000,
          alertAt: NOW - 2_000,
          alertedAt: null,
        },
      }),
      { now: NOW },
    );

    expect(result.dueDecision).toMatchObject({
      shouldAlert: true,
      reason: "due-now",
    });
    expect(result.causes[0]).toMatchObject({
      status: "fail",
      title: "현재 알림 대상",
    });
  });

  it("uses alert evidence to avoid claiming a duplicate alert", () => {
    const result = analyzeBoosterExpiryReplaySample(
      createBoosterSample({
        state: {
          status: "alerted",
          lastSampledAt: NOW,
          confirmedExpiresAt: NOW + 8_000,
          alertAt: NOW - 2_000,
          alertedAt: NOW - 2_000,
        },
      }),
      { now: NOW },
    );

    expect(result.dueDecision).toMatchObject({
      shouldAlert: false,
      reason: "already-alerted",
    });
    expect(result.causes[0]).toMatchObject({
      status: "pass",
      title: "알림 처리 기록 있음",
    });
  });

  it("explains timer evidence that never confirmed a schedule", () => {
    const result = analyzeBoosterExpiryReplaySample(
      createBoosterSample({
        state: {
          status: "confirming",
          lastSampledAt: NOW,
          cycleCandidateObservationCount: 3,
          confirmedExpiresAt: null,
          alertAt: null,
        },
        lastSnapshot: {
          timerEvidence: [
            {
              sampledAt: NOW - 2_000,
              rawRemainingSeconds: 80,
              predictedExpiresAt: NOW + 78_000,
              decision: "raw-pending",
            },
          ],
        },
      }),
      { now: NOW },
    );

    expect(result.dueDecision).toMatchObject({
      shouldAlert: false,
      reason: "no-confirmed-schedule",
    });
    expect(result.timerEvidenceCount).toBe(1);
    expect(result.causes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "warn",
          title: "확정 종료시각 없음",
        }),
        expect.objectContaining({
          status: "info",
          title: "시간 확인 중",
        }),
      ]),
    );
  });

  it("can derive the schedule from the latest runtime trace", () => {
    const result = analyzeBoosterExpiryReplaySample(
      createBoosterSample({
        state: {
          status: "armed",
          lastSampledAt: NOW,
        },
        lastSnapshot: {
          runtimeTrace: [
            {
              sampledAt: NOW - 1_000,
              status: "armed",
              confirmedExpiresAt: NOW + 30_000,
              alertAt: NOW + 20_000,
              alerted: false,
              decision: "flow-predicted",
            },
          ],
        },
      }),
      { now: NOW },
    );

    expect(result.confirmedExpiresAt).toBe(NOW + 30_000);
    expect(result.dueDecision).toMatchObject({
      shouldAlert: false,
      reason: "scheduled-future",
      scheduleSource: "trace",
    });
    expect(result.traceFrameCount).toBe(1);
  });
});

function createBoosterSample({
  state,
  lastSnapshot = {},
}: {
  state: Record<string, unknown>;
  lastSnapshot?: Record<string, unknown>;
}) {
  return {
    body: {
      kind: "booster-expiry-issue",
      diagnostics: {
        capture: {
          hasStream: true,
        },
      },
      sample: {
        result: {
          value: "01:40",
        },
      },
      boosterExpiry: {
        config: {
          enabled: true,
          alertLeadSeconds: 10,
        },
        state,
        lastSnapshot,
      },
    },
  };
}
