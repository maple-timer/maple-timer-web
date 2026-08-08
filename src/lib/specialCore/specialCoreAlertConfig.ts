import type { SpecialCoreAlertConfig } from "../../types";
import {
  DEFAULT_SPECIAL_CORE_ALERT_LEAD_SECONDS,
  DEFAULT_SPECIAL_CORE_COOLDOWN_SECONDS,
  MAX_SPECIAL_CORE_ALERT_LEAD_SECONDS,
  MAX_SPECIAL_CORE_COOLDOWN_SECONDS,
  MIN_SPECIAL_CORE_ALERT_LEAD_SECONDS,
  MIN_SPECIAL_CORE_COOLDOWN_SECONDS,
} from "./specialCoreAlertTypes";

export const SPECIAL_CORE_COUNTDOWN_AUDIO_SECONDS = 10;

export function clampSpecialCoreCooldownSeconds(value: unknown): number {
  const next = Math.round(Number(value));
  if (!Number.isFinite(next)) {
    return DEFAULT_SPECIAL_CORE_COOLDOWN_SECONDS;
  }
  return Math.min(
    MAX_SPECIAL_CORE_COOLDOWN_SECONDS,
    Math.max(MIN_SPECIAL_CORE_COOLDOWN_SECONDS, next),
  );
}

export function clampSpecialCoreAlertLeadSeconds(value: unknown): number {
  const next = Math.round(Number(value));
  if (!Number.isFinite(next)) {
    return DEFAULT_SPECIAL_CORE_ALERT_LEAD_SECONDS;
  }
  return Math.min(
    MAX_SPECIAL_CORE_ALERT_LEAD_SECONDS,
    Math.max(MIN_SPECIAL_CORE_ALERT_LEAD_SECONDS, next),
  );
}

export function getSpecialCoreAlertDueAt({
  activationStartedAt,
  cooldownSeconds,
  alertLeadSeconds,
}: {
  activationStartedAt: number;
  cooldownSeconds: number;
  alertLeadSeconds: number;
}): number {
  const cooldownEndsAt = activationStartedAt + cooldownSeconds * 1000;
  return Math.max(activationStartedAt, cooldownEndsAt - alertLeadSeconds * 1000);
}

export function getSpecialCoreCountdownAudioStartOffsetSeconds(countdownSeconds: unknown): number {
  const remainingSeconds = Number(countdownSeconds);
  if (!Number.isFinite(remainingSeconds)) {
    return 0;
  }

  const audibleLeadSeconds = Math.min(
    SPECIAL_CORE_COUNTDOWN_AUDIO_SECONDS,
    Math.max(1, remainingSeconds),
  );
  return SPECIAL_CORE_COUNTDOWN_AUDIO_SECONDS - audibleLeadSeconds;
}

export function getSpecialCoreRemainingSecondsForDisplay({
  cooldownEndsAt,
  now,
}: {
  cooldownEndsAt: number | null;
  now: number;
}): number | null {
  if (cooldownEndsAt === null) {
    return null;
  }
  return Math.max(0, Math.floor((cooldownEndsAt - now) / 1000));
}

export function normalizeSpecialCoreAlertTiming(
  config: Pick<SpecialCoreAlertConfig, "cooldownSeconds" | "alertLeadSeconds">,
): Pick<SpecialCoreAlertConfig, "cooldownSeconds" | "alertLeadSeconds"> {
  return {
    cooldownSeconds: clampSpecialCoreCooldownSeconds(config.cooldownSeconds),
    alertLeadSeconds: clampSpecialCoreAlertLeadSeconds(config.alertLeadSeconds),
  };
}
