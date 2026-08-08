import { describe, expect, it } from "vitest";
import { getSkillRuntimeConfigKey } from "./skillRuntimeConfig";
import { createSkill } from "./profileFactory";

describe("skill runtime config key", () => {
  it("ignores settings that do not affect timer calculation", () => {
    const skill = createSkill({
      presetId: "sol-janus-dawn-2min",
      alertThresholdSeconds: 10,
      soundId: "야누스 랜덤",
      volume: 1,
    });
    const alertChangedSkill = { ...skill, alertThresholdSeconds: 30 };
    const soundChangedSkill = { ...skill, soundId: "띵동", volume: 0.4 };

    expect(getSkillRuntimeConfigKey(alertChangedSkill)).toBe(getSkillRuntimeConfigKey(skill));
    expect(getSkillRuntimeConfigKey(soundChangedSkill)).toBe(getSkillRuntimeConfigKey(skill));
  });

  it("changes when timer calculation settings change", () => {
    const skill = createSkill({ presetId: "sol-janus-dawn-2min" });
    const key = getSkillRuntimeConfigKey(skill);

    expect(getSkillRuntimeConfigKey({ ...skill, presetId: "sol-janus-dawn-1min" })).not.toBe(
      key,
    );
    expect(getSkillRuntimeConfigKey({ ...skill, durationSeconds: 60 })).not.toBe(key);
    expect(getSkillRuntimeConfigKey({ ...skill, cooldownDurationSeconds: 60 })).not.toBe(key);
    expect(getSkillRuntimeConfigKey({ ...skill, countdownSource: "duration" })).not.toBe(key);
    expect(getSkillRuntimeConfigKey({ ...skill, detectionSource: "buff-duration" })).not.toBe(
      key,
    );
  });
});
