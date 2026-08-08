import type { SkillConfig, SkillRuntimeState } from "../types";
import {
  COOLDOWN_REARM_MIN_READING_SECONDS,
  COOLDOWN_REARM_RECOVERY_TOLERANCE_SECONDS,
  STRICT_COOLDOWN_REARM_START_TOLERANCE_SECONDS,
  getDurationSeconds,
  isInitialAnchorReading,
  usesStrictCooldownRearm,
} from "./timerRules";

export function hasCooldownCycleRecovered(
  previous: SkillRuntimeState,
  config: Pick<SkillConfig, "durationSeconds" | "presetId">,
  effectiveCooldownDurationSeconds: number,
  now: number,
): boolean {
  if (previous.estimatedExpiresAt === null) {
    return false;
  }

  const elapsedSeconds =
    previous.lastAlertCycleStartedAt === null
      ? getDurationSeconds(config) -
        Math.max(0, (previous.estimatedExpiresAt - now) / 1000)
      : Math.max(0, (now - previous.lastAlertCycleStartedAt) / 1000);
  const recoveryToleranceSeconds = usesStrictCooldownRearm(config)
    ? 0
    : COOLDOWN_REARM_RECOVERY_TOLERANCE_SECONDS;
  const minimumElapsedSeconds = Math.max(
    0,
    effectiveCooldownDurationSeconds - recoveryToleranceSeconds,
  );

  return elapsedSeconds >= minimumElapsedSeconds;
}

export function isFreshCooldownStartCandidate(
  candidate: number,
  config: Pick<SkillConfig, "presetId">,
  effectiveCooldownDurationSeconds: number,
): boolean {
  if (!usesStrictCooldownRearm(config)) {
    return true;
  }

  return (
    candidate >=
    effectiveCooldownDurationSeconds - STRICT_COOLDOWN_REARM_START_TOLERANCE_SECONDS
  );
}

export function isCooldownRearmCandidate(
  candidate: number,
  config: Pick<
    SkillConfig,
    "alertThresholdSeconds" | "countdownSource" | "durationSeconds" | "cooldownDurationSeconds"
  >,
): boolean {
  return (
    candidate >= COOLDOWN_REARM_MIN_READING_SECONDS &&
    isInitialAnchorReading(candidate, config)
  );
}
