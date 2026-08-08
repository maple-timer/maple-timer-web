import type { RecognitionResult, SkillConfig, SkillRuntimeState } from "../types";

export const TRUSTED_CONFIDENCE = 0.55;
export const NORMAL_UPWARD_TOLERANCE_SECONDS = 2;
export const NORMAL_DOWNWARD_TOLERANCE_SECONDS = 3;
export const INITIAL_ANCHOR_MIN_SECONDS = 45;
export const INITIAL_ANCHOR_MAX_SECONDS = 59;
export const MINIMUM_INITIAL_ANCHOR_LEAD_SECONDS = 5;
export const SHORT_ANCHOR_REQUIRED_READINGS = 3;
export const SHORT_ANCHOR_UPWARD_TOLERANCE_SECONDS = 1;
export const SHORT_ANCHOR_DOWNWARD_TOLERANCE_SECONDS = 2;
export const COOLDOWN_REARM_MINIMUM_JUMP_SECONDS = 8;
export const COOLDOWN_REARM_MIN_READING_SECONDS = INITIAL_ANCHOR_MIN_SECONDS;
export const COOLDOWN_SHORT_ANCHOR_MIN_READING_SECONDS = 15;
export const COOLDOWN_REARM_RECOVERY_TOLERANCE_SECONDS = 8;
export const STRICT_COOLDOWN_REARM_START_TOLERANCE_SECONDS = 3;
export const COOLDOWN_VISUAL_NOISE_FOREGROUND_RATIO = 0.14;
export const DEFAULT_DURATION_SECONDS = 60;

export const ALERT_THRESHOLD_MIN_SECONDS = -5;
export const CLASS_INSTALL_ALERT_THRESHOLD_MIN_SECONDS = -20;
export const ALERT_THRESHOLD_MAX_SECONDS =
  INITIAL_ANCHOR_MAX_SECONDS - MINIMUM_INITIAL_ANCHOR_LEAD_SECONDS;

export function getAlertThresholdMinSeconds(
  config?: Pick<SkillConfig, "presetId">,
): number {
  return config?.presetId === "class-install"
    ? CLASS_INSTALL_ALERT_THRESHOLD_MIN_SECONDS
    : ALERT_THRESHOLD_MIN_SECONDS;
}

export function clampAlertThresholdSeconds(
  value: number,
  config?: Pick<SkillConfig, "presetId">,
): number {
  const minSeconds = getAlertThresholdMinSeconds(config);
  if (!Number.isFinite(value)) {
    return minSeconds;
  }

  return Math.min(
    ALERT_THRESHOLD_MAX_SECONDS,
    Math.max(minSeconds, Math.round(value)),
  );
}

export function formatAlertThresholdSeconds(value: number): {
  value: number;
  suffix: string;
  label: string;
} {
  const rounded = Math.round(value);
  const absoluteSeconds = Math.abs(rounded);
  const suffix = rounded < 0 ? "초 후" : "초 전";
  return {
    value: absoluteSeconds,
    suffix,
    label: `${absoluteSeconds}${suffix}`,
  };
}

export function getPositiveSeconds(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

export function getDurationSeconds(config: Pick<SkillConfig, "durationSeconds">): number {
  return getPositiveSeconds(config.durationSeconds, DEFAULT_DURATION_SECONDS);
}

export function getCooldownDurationSeconds(
  config: Pick<SkillConfig, "cooldownDurationSeconds">,
): number | null {
  return config.cooldownDurationSeconds
    ? getPositiveSeconds(config.cooldownDurationSeconds, config.cooldownDurationSeconds)
    : null;
}

export function isCooldownSource(config: Pick<SkillConfig, "countdownSource">): boolean {
  return config.countdownSource === "cooldown";
}

export function usesStrictCooldownRearm(config: Pick<SkillConfig, "presetId">): boolean {
  return config.presetId === "erda-fountain" || config.presetId === "erda-fountain-deep-v2";
}

export function getAutomaticTrackingWindowSeconds(
  config: Pick<SkillConfig, "countdownSource" | "cooldownDurationSeconds">,
): number {
  return Math.max(INITIAL_ANCHOR_MAX_SECONDS, getCooldownDurationSeconds(config) ?? 0);
}

export function getCooldownDerivedRemainingSeconds(
  candidate: number,
  config: Pick<SkillConfig, "durationSeconds" | "cooldownDurationSeconds">,
  effectiveCooldownDurationSeconds = getCooldownDurationSeconds(config),
): number {
  const durationSeconds = getDurationSeconds(config);

  if (!effectiveCooldownDurationSeconds) {
    return durationSeconds;
  }

  const cooldownRemainingSeconds = Math.min(candidate, effectiveCooldownDurationSeconds);
  const elapsedSeconds = Math.max(0, effectiveCooldownDurationSeconds - cooldownRemainingSeconds);
  return Math.max(0, durationSeconds - elapsedSeconds);
}

export function getNextEffectiveCooldownDurationSeconds(
  candidate: number,
  previous: Pick<SkillRuntimeState, "effectiveCooldownDurationSeconds">,
  config: Pick<SkillConfig, "cooldownDurationSeconds">,
  pending?: SkillRuntimeState["pendingShortAnchor"],
): number | null {
  const configuredCooldownDurationSeconds = getCooldownDurationSeconds(config);
  const observedCooldownDurationSeconds = Math.max(
    pending?.maxObservedRemainingSeconds ?? candidate,
    candidate,
  );

  if (!configuredCooldownDurationSeconds) {
    const learnedCooldownDurationSeconds =
      observedCooldownDurationSeconds >= INITIAL_ANCHOR_MIN_SECONDS
        ? observedCooldownDurationSeconds
        : null;
    return Math.max(
      previous.effectiveCooldownDurationSeconds ?? 0,
      learnedCooldownDurationSeconds ?? 0,
    ) || null;
  }

  return Math.max(
    configuredCooldownDurationSeconds,
    previous.effectiveCooldownDurationSeconds ?? configuredCooldownDurationSeconds,
    observedCooldownDurationSeconds,
  );
}

export function getAnchorLeadBasisSeconds(
  candidate: number,
  config: Pick<
    SkillConfig,
    "countdownSource" | "durationSeconds" | "cooldownDurationSeconds"
  >,
): number {
  if (isCooldownSource(config) && getCooldownDurationSeconds(config)) {
    return getCooldownDerivedRemainingSeconds(candidate, config);
  }

  return candidate;
}

export function hasMinimumAlertLead(
  candidate: number,
  config: Pick<
    SkillConfig,
    "alertThresholdSeconds" | "countdownSource" | "durationSeconds" | "cooldownDurationSeconds"
  >,
): boolean {
  return (
    getAnchorLeadBasisSeconds(candidate, config) >=
    config.alertThresholdSeconds + MINIMUM_INITIAL_ANCHOR_LEAD_SECONDS
  );
}

export function isInitialAnchorReading(
  candidate: number,
  config: Pick<
    SkillConfig,
    "alertThresholdSeconds" | "countdownSource" | "durationSeconds" | "cooldownDurationSeconds"
  >,
): boolean {
  return (
    candidate >= INITIAL_ANCHOR_MIN_SECONDS &&
    candidate <= getAutomaticTrackingWindowSeconds(config) &&
    hasMinimumAlertLead(candidate, config)
  );
}

export function isShortAnchorCandidate(
  candidate: number,
  config: Pick<
    SkillConfig,
    "alertThresholdSeconds" | "countdownSource" | "durationSeconds" | "cooldownDurationSeconds"
  >,
): boolean {
  if (isCooldownSource(config) && candidate < COOLDOWN_SHORT_ANCHOR_MIN_READING_SECONDS) {
    return false;
  }

  return (
    candidate <= getAutomaticTrackingWindowSeconds(config) &&
    candidate < INITIAL_ANCHOR_MIN_SECONDS &&
    hasMinimumAlertLead(candidate, config)
  );
}

export function isDenseCooldownVisualNoise(
  result: Pick<RecognitionResult, "debug">,
  config: Pick<SkillConfig, "countdownSource">,
): boolean {
  if (!isCooldownSource(config)) {
    return false;
  }

  const foregroundRatio = result.debug?.foregroundRatio;
  return (
    Number.isFinite(foregroundRatio) &&
    Number(foregroundRatio) > COOLDOWN_VISUAL_NOISE_FOREGROUND_RATIO
  );
}
