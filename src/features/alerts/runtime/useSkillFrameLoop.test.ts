import { describe, expect, it } from "vitest";
import { createRuntimeState } from "../../../lib/timer";
import { mergeSkillFrameLoopRuntimeStates } from "./useSkillFrameLoop";

describe("mergeSkillFrameLoopRuntimeStates", () => {
  it("preserves alert playback finish timing from the latest runtime state", () => {
    const skillId = "skill_erda_fountain";
    const latestState = {
      ...createRuntimeState(skillId),
      status: "alerted" as const,
      estimatedExpiresAt: 20_000,
      alertedAt: 15_000,
      lastRepeatedAlertAt: 20_400,
      lastAlertCycleStartedAt: 15_000,
    };
    const staleFrameState = {
      ...latestState,
      lastRepeatedAlertAt: null,
    };

    const merged = mergeSkillFrameLoopRuntimeStates(
      { [skillId]: latestState },
      { [skillId]: staleFrameState },
    );

    expect(merged[skillId]).toMatchObject({
      alertedAt: 15_000,
      lastRepeatedAlertAt: 20_400,
      repeatedAlertCount: 0,
    });
  });

  it("preserves an active repeated alert over an older frame result", () => {
    const skillId = "skill_erda_fountain";
    const latestState = {
      ...createRuntimeState(skillId),
      status: "alerted" as const,
      estimatedExpiresAt: 20_000,
      alertedAt: 15_000,
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 1,
      lastAlertCycleStartedAt: 15_000,
    };
    const staleFrameState = {
      ...latestState,
      lastRepeatedAlertAt: 20_400,
      repeatedAlertCount: 0,
    };

    const merged = mergeSkillFrameLoopRuntimeStates(
      { [skillId]: latestState },
      { [skillId]: staleFrameState },
    );

    expect(merged[skillId]).toMatchObject({
      alertedAt: 15_000,
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 1,
    });
  });

  it("preserves a newly started repeated alert over previous playback timing", () => {
    const skillId = "skill_erda_fountain";
    const latestState = {
      ...createRuntimeState(skillId),
      status: "alerted" as const,
      estimatedExpiresAt: 20_000,
      alertedAt: 15_000,
      lastRepeatedAlertAt: 20_400,
      repeatedAlertCount: 0,
      lastAlertCycleStartedAt: 15_000,
    };
    const newlyRepeatedFrameState = {
      ...latestState,
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 1,
    };

    const merged = mergeSkillFrameLoopRuntimeStates(
      { [skillId]: latestState },
      { [skillId]: newlyRepeatedFrameState },
    );

    expect(merged[skillId]).toMatchObject({
      alertedAt: 15_000,
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 1,
    });
  });

  it("does not carry playback timing into a new alert cycle", () => {
    const skillId = "skill_erda_fountain";
    const latestState = {
      ...createRuntimeState(skillId),
      status: "alerted" as const,
      estimatedExpiresAt: 20_000,
      alertedAt: 15_000,
      lastRepeatedAlertAt: 20_400,
      lastAlertCycleStartedAt: 15_000,
    };
    const rearmedFrameState = {
      ...createRuntimeState(skillId),
      status: "running" as const,
      estimatedExpiresAt: 60_000,
      alertedAt: null,
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 0,
      lastAlertCycleStartedAt: 30_000,
    };

    const merged = mergeSkillFrameLoopRuntimeStates(
      { [skillId]: latestState },
      { [skillId]: rearmedFrameState },
    );

    expect(merged[skillId]).toMatchObject({
      alertedAt: null,
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 0,
      estimatedExpiresAt: 60_000,
    });
  });
});
