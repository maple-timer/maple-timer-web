import type { SkillConfig, SkillRuntimeState } from "../types";
import { createRuntimeState } from "./timer";

export function applySkillRuntimeSettingsPatch(
  previous: SkillRuntimeState,
  skillId: string,
  patch: Partial<SkillConfig>,
  now: number,
): SkillRuntimeState {
  if (
    patch.enabled !== undefined ||
    patch.detectionSource !== undefined ||
    patch.region !== undefined ||
    patch.regionsByLayout !== undefined
  ) {
    return createRuntimeState(skillId);
  }

  if (patch.repeatAlertEnabled === true && previous.alertedAt !== null) {
    return {
      ...previous,
      lastRepeatedAlertAt: now,
      repeatedAlertCount: 0,
    };
  }

  if (
    (patch.repeatAlertIntervalSeconds !== undefined ||
      patch.repeatAlertMaxCount !== undefined) &&
    previous.alertedAt !== null
  ) {
    return {
      ...previous,
      lastRepeatedAlertAt: now,
    };
  }

  return previous;
}

export function shouldClearSkillSnapshotForSettingsPatch(patch: Partial<SkillConfig>): boolean {
  return (
    patch.enabled !== undefined ||
    patch.detectionSource !== undefined ||
    patch.region !== undefined ||
    patch.regionsByLayout !== undefined
  );
}
