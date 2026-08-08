import { describe, expect, it } from "vitest";
import { createRuntimeState, shouldFireRemainingCountAlert } from "../../../lib/timer";
import type { SkillRuntimeState } from "../../../types";
import { advanceSkillRemainingCountFlow } from "./skillRemainingCountFlow";

const skill = {
  enabled: true,
  alertThresholdSeconds: 3,
};

describe("skillRemainingCountFlow", () => {
  it("quarantines the reported 11-to-3 misread sequence and recovers at 8", () => {
    let state = createRuntimeState("skill-yein");
    const reasons: string[] = [];
    [11, 11, 11, null, null, 3, 3, 3, null, 8].forEach((count, index) => {
      const result = advanceSkillRemainingCountFlow({
        confidence: count === null ? 0 : 0.91,
        count,
        previous: state,
        sampledAt: index * 1_000,
        skill,
      });
      state = result.state;
      reasons.push(result.evidence.reason);
    });

    expect(reasons.slice(5, 8)).toEqual([
      "implausible-drop",
      "implausible-drop-held",
      "implausible-drop-held",
    ]);
    expect(reasons[reasons.length - 1]).toBe("implausible-drop-recovered");
    expect(state).toMatchObject({
      observedRemainingCount: 8,
      countObservedAt: 9_000,
      alertedAt: null,
      rejectedReading: null,
      pendingRemainingCountDrop: null,
      pendingRemainingCountAlert: null,
    });
    expect(shouldFireRemainingCountAlert(state, skill)).toBe(false);
  });

  it("requires a second normal observation after entering the alert threshold", () => {
    let state = createRuntimeState("skill-yein");
    state = step(state, 5, 0).state;
    state = step(state, 4, 1_000).state;

    const firstThreshold = step(state, 3, 2_000);
    expect(firstThreshold.evidence.reason).toBe("alert-threshold-pending");
    expect(firstThreshold.state.pendingRemainingCountAlert).toMatchObject({
      observedRemainingCount: 3,
      count: 1,
    });
    expect(shouldFireRemainingCountAlert(firstThreshold.state, skill)).toBe(false);

    const confirmedThreshold = step(firstThreshold.state, 3, 3_000);
    expect(confirmedThreshold.evidence.reason).toBe("alert-threshold-confirmed");
    expect(confirmedThreshold.state.pendingRemainingCountAlert).toBeNull();
    expect(shouldFireRemainingCountAlert(confirmedThreshold.state, skill)).toBe(true);
  });

  it("allows a reachable decrease across missing frames", () => {
    let state = createRuntimeState("skill-yein");
    state = step(state, 11, 0).state;
    state = step(state, null, 1_000).state;
    state = step(state, null, 2_000).state;

    const result = step(state, 8, 3_000);
    expect(result.evidence).toMatchObject({
      reason: "accepted-decrease",
      expectedMinCount: 8,
      expectedMaxCount: 11,
      confirmedCount: 8,
    });
    expect(result.state.pendingRemainingCountDrop).toBeNull();
  });

  it("does not promote a repeated impossible value when elapsed time catches up", () => {
    let state = step(createRuntimeState("skill-yein"), 11, 0).state;
    for (let second = 1; second <= 10; second += 1) {
      const result = step(state, 3, second * 1_000);
      state = result.state;
      expect(result.evidence.reason).toMatch(/implausible-drop/);
      expect(state.observedRemainingCount).toBe(11);
      expect(shouldFireRemainingCountAlert(state, skill)).toBe(false);
    }
    expect(state.pendingRemainingCountDrop?.count).toBe(10);
  });

  it("confirms an upward count as a new cycle without carrying the old alert", () => {
    let state: SkillRuntimeState = {
      ...createRuntimeState("skill-yein"),
      observedRemainingCount: 3,
      countObservedAt: 0,
      status: "alerted" as const,
      alertedAt: 0,
      lastAlertCycleStartedAt: 0,
    };

    const first = step(state, 11, 1_000);
    expect(first.evidence.reason).toBe("increase-pending");
    expect(first.state.alertedAt).toBe(0);

    const second = step(first.state, 11, 2_000);
    state = second.state;
    expect(second.evidence.reason).toBe("cycle-reset");
    expect(state).toMatchObject({
      observedRemainingCount: 11,
      alertedAt: null,
      status: "running",
      lastAlertCycleStartedAt: 1_000,
    });
  });

  it("requires confirmation when monitoring begins inside the alert threshold", () => {
    const first = step(createRuntimeState("skill-yein"), 3, 0);
    expect(first.evidence.reason).toBe("alert-threshold-pending");
    expect(shouldFireRemainingCountAlert(first.state, skill)).toBe(false);

    const second = step(first.state, 3, 1_000);
    expect(second.evidence.reason).toBe("alert-threshold-confirmed");
    expect(shouldFireRemainingCountAlert(second.state, skill)).toBe(true);
  });
});

function step(
  previous: SkillRuntimeState,
  count: number | null,
  sampledAt: number,
) {
  return advanceSkillRemainingCountFlow({
    confidence: count === null ? 0 : 0.95,
    count,
    previous,
    sampledAt,
    skill,
  });
}
