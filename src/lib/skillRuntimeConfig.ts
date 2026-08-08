import type { SkillConfig } from "../types";

type RuntimeRelevantSkillConfig = Pick<
  SkillConfig,
  "presetId" | "detectionSource" | "countdownSource" | "durationSeconds" | "cooldownDurationSeconds"
>;

export function getSkillRuntimeConfigKey(skill: RuntimeRelevantSkillConfig): string {
  return [
    skill.presetId ?? "",
    skill.detectionSource ?? "quickslot",
    skill.countdownSource,
    skill.durationSeconds,
    skill.cooldownDurationSeconds ?? "",
  ].join("|");
}
