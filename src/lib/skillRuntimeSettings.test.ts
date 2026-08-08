import { describe, expect, it } from "vitest";
import type { SkillConfig } from "../types";
import { createRuntimeState, markAlerted, markRepeatedAlert, startManualCycle } from "./timer";
import { createSkill } from "./storage";
import {
  applySkillRuntimeSettingsPatch,
  shouldClearSkillSnapshotForSettingsPatch,
} from "./skillRuntimeSettings";

describe("skill runtime settings", () => {
  const skill: SkillConfig = createSkill({
    id: "skill-1",
    durationSeconds: 120,
    alertThresholdSeconds: 10,
    repeatAlertEnabled: true,
    repeatAlertIntervalSeconds: 3,
  });

  it("resets the runtime when the skill is toggled", () => {
    const running = startManualCycle(createRuntimeState(skill.id), skill, 1_000);
    const alerted = markRepeatedAlert(markAlerted(running, 2_000), 5_000);

    const reset = applySkillRuntimeSettingsPatch(alerted, skill.id, { enabled: false }, 6_000);

    expect(reset.status).toBe("idle");
    expect(reset.alertedAt).toBeNull();
    expect(reset.lastRepeatedAlertAt).toBeNull();
    expect(reset.estimatedExpiresAt).toBeNull();
    expect(shouldClearSkillSnapshotForSettingsPatch({ enabled: false })).toBe(true);
  });

  it("resets the runtime when the detection source changes", () => {
    const running = startManualCycle(createRuntimeState(skill.id), skill, 1_000);
    const alerted = markRepeatedAlert(markAlerted(running, 2_000), 5_000);

    const reset = applySkillRuntimeSettingsPatch(
      alerted,
      skill.id,
      { detectionSource: "buff-duration" },
      6_000,
    );

    expect(reset.status).toBe("idle");
    expect(reset.alertedAt).toBeNull();
    expect(reset.lastRepeatedAlertAt).toBeNull();
    expect(reset.estimatedExpiresAt).toBeNull();
    expect(
      shouldClearSkillSnapshotForSettingsPatch({ detectionSource: "buff-duration" }),
    ).toBe(true);
  });

  it("resets the runtime when the selected quick-slot region changes", () => {
    const running = startManualCycle(createRuntimeState(skill.id), skill, 1_000);
    const alerted = markRepeatedAlert(markAlerted(running, 2_000), 5_000);
    const region = { x: 0.1, y: 0.2, width: 0.03, height: 0.04 };

    const reset = applySkillRuntimeSettingsPatch(
      alerted,
      skill.id,
      {
        region,
        regionsByLayout: {
          "1920x1080": region,
        },
      },
      6_000,
    );

    expect(reset.status).toBe("idle");
    expect(reset.alertedAt).toBeNull();
    expect(reset.estimatedExpiresAt).toBeNull();
    expect(
      shouldClearSkillSnapshotForSettingsPatch({
        region,
        regionsByLayout: {
          "1920x1080": region,
        },
      }),
    ).toBe(true);
  });

  it("keeps the active timer when repeat alerts are disabled", () => {
    const running = startManualCycle(createRuntimeState(skill.id), skill, 1_000);
    const alerted = markAlerted(running, 2_000);

    const adjusted = applySkillRuntimeSettingsPatch(
      alerted,
      skill.id,
      { repeatAlertEnabled: false },
      6_000,
    );

    expect(adjusted).toBe(alerted);
    expect(adjusted.status).toBe("alerted");
    expect(adjusted.alertedAt).toBe(2_000);
    expect(adjusted.estimatedExpiresAt).toBe(alerted.estimatedExpiresAt);
    expect(shouldClearSkillSnapshotForSettingsPatch({ repeatAlertEnabled: false })).toBe(false);
  });

  it("keeps the active timer and defers repeat when repeat alerts are enabled after an alert", () => {
    const running = startManualCycle(createRuntimeState(skill.id), skill, 1_000);
    const alerted = markRepeatedAlert(markAlerted(running, 2_000), 5_000);

    const adjusted = applySkillRuntimeSettingsPatch(
      alerted,
      skill.id,
      { repeatAlertEnabled: true },
      6_000,
    );

    expect(adjusted.status).toBe("alerted");
    expect(adjusted.alertedAt).toBe(2_000);
    expect(adjusted.estimatedExpiresAt).toBe(alerted.estimatedExpiresAt);
    expect(adjusted.lastRepeatedAlertAt).toBe(6_000);
    expect(adjusted.repeatedAlertCount).toBe(0);
    expect(shouldClearSkillSnapshotForSettingsPatch({ repeatAlertEnabled: true })).toBe(false);
  });

  it("defers the next repeat when only the interval changes", () => {
    const running = startManualCycle(createRuntimeState(skill.id), skill, 1_000);
    const alerted = markRepeatedAlert(markAlerted(running, 2_000), 5_000);

    const adjusted = applySkillRuntimeSettingsPatch(
      alerted,
      skill.id,
      { repeatAlertIntervalSeconds: 5 },
      6_000,
    );

    expect(adjusted.alertedAt).toBe(2_000);
    expect(adjusted.lastRepeatedAlertAt).toBe(6_000);
    expect(shouldClearSkillSnapshotForSettingsPatch({ repeatAlertIntervalSeconds: 5 })).toBe(false);
  });

  it("defers the next repeat when only the repeat count changes", () => {
    const running = startManualCycle(createRuntimeState(skill.id), skill, 1_000);
    const alerted = markRepeatedAlert(markAlerted(running, 2_000), 5_000);

    const adjusted = applySkillRuntimeSettingsPatch(
      alerted,
      skill.id,
      { repeatAlertMaxCount: 2 },
      6_000,
    );

    expect(adjusted.alertedAt).toBe(2_000);
    expect(adjusted.lastRepeatedAlertAt).toBe(6_000);
    expect(shouldClearSkillSnapshotForSettingsPatch({ repeatAlertMaxCount: 2 })).toBe(false);
  });

  it("leaves unrelated settings changes alone", () => {
    const running = startManualCycle(createRuntimeState(skill.id), skill, 1_000);

    expect(applySkillRuntimeSettingsPatch(running, skill.id, { volume: 0.5 }, 2_000)).toBe(
      running,
    );
    expect(shouldClearSkillSnapshotForSettingsPatch({ volume: 0.5 })).toBe(false);
  });
});
