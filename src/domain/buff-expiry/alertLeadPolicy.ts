export const MIN_BUFF_EXPIRY_ALERT_LEAD_SECONDS = -5;
export const MAX_BUFF_EXPIRY_PRECISION_ALERT_LEAD_SECONDS = 20;
export const DEFAULT_BUFF_EXPIRY_ALERT_LEAD_SECONDS = 20;

export type BuffExpiryAlertLeadBounds = {
  min: number;
  max: number;
};

export type BuffExpiryAlertLeadConfig = {
  alertLeadSeconds: number;
};

export function getBuffExpiryAlertLeadBounds(): BuffExpiryAlertLeadBounds {
  return {
    min: MIN_BUFF_EXPIRY_ALERT_LEAD_SECONDS,
    max: MAX_BUFF_EXPIRY_PRECISION_ALERT_LEAD_SECONDS,
  };
}

export function clampBuffExpiryAlertLeadSeconds(seconds: number): number {
  const bounds = getBuffExpiryAlertLeadBounds();
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(seconds)));
}

export function getBuffExpiryEffectiveAlertLeadSeconds(
  config: BuffExpiryAlertLeadConfig,
): number {
  return clampBuffExpiryAlertLeadSeconds(config.alertLeadSeconds);
}

export function formatBuffExpiryAlertLeadSeconds(value: number): {
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
