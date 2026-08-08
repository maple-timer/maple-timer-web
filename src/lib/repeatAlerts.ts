export const REPEAT_ALERT_INTERVAL_OPTIONS = [2, 3, 5] as const;
export const REPEAT_ALERT_MAX_COUNT_OPTIONS = [1, 2, 3, 5] as const;
export const DEFAULT_REPEAT_ALERT_INTERVAL_SECONDS = 3;
export const DEFAULT_REPEAT_ALERT_MAX_COUNT = 3;

export function normalizeRepeatAlertEnabled(value: unknown): boolean {
  return value === true;
}

export function normalizeRepeatAlertIntervalSeconds(
  value: unknown,
  fallback = DEFAULT_REPEAT_ALERT_INTERVAL_SECONDS,
): number {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return fallback;
  }

  return REPEAT_ALERT_INTERVAL_OPTIONS.includes(
    Math.round(next) as (typeof REPEAT_ALERT_INTERVAL_OPTIONS)[number],
  )
    ? Math.round(next)
    : fallback;
}

export function normalizeRepeatAlertMaxCount(
  value: unknown,
  fallback: number | null = null,
): number | null {
  if (value === null || value === undefined) {
    return fallback;
  }

  const next = Number(value);
  if (!Number.isFinite(next)) {
    return fallback;
  }

  return REPEAT_ALERT_MAX_COUNT_OPTIONS.includes(
    Math.round(next) as (typeof REPEAT_ALERT_MAX_COUNT_OPTIONS)[number],
  )
    ? Math.round(next)
    : fallback;
}

export function isRepeatAlertEnabled(config: { repeatAlertEnabled?: boolean }): boolean {
  return config.repeatAlertEnabled === true;
}

export function getRepeatAlertIntervalSeconds(
  config: { repeatAlertIntervalSeconds?: number },
): number {
  return normalizeRepeatAlertIntervalSeconds(config.repeatAlertIntervalSeconds);
}

export function getRepeatAlertMaxCount(config: {
  repeatAlertMaxCount?: number | null;
}): number | null {
  return normalizeRepeatAlertMaxCount(config.repeatAlertMaxCount);
}
