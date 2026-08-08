export const STANDARD_ALERT_VOLUME = 1;
export const MAX_ALERT_VOLUME = 2;
export const DEFAULT_MASTER_VOLUME = 1;
export const MAX_MASTER_VOLUME = 1;
export const VOLUME_STEP = 0.05;
export const VOLUME_BOOST_WARNING_STORAGE_PREFIX = "maple-timer.volume-boost-warning.v2.";

const sessionVolumeBoostAcknowledgedKeys = new Set<string>();

export function clampAlertVolume(volume: number, fallback = STANDARD_ALERT_VOLUME): number {
  const next = Number(volume);
  if (!Number.isFinite(next)) {
    return fallback;
  }
  return Math.min(MAX_ALERT_VOLUME, Math.max(0, next));
}

export function getVolumePercentLabel(volume: number): string {
  return `${Math.round(clampAlertVolume(volume) * 100)}%`;
}

export function clampMasterVolume(
  volume: number | undefined,
  fallback = DEFAULT_MASTER_VOLUME,
): number {
  const next = Number(volume);
  if (!Number.isFinite(next)) {
    return fallback;
  }
  return Math.min(MAX_MASTER_VOLUME, Math.max(0, next));
}

export function getMasterVolumePercentLabel(volume: number | undefined): string {
  return `${Math.round(clampMasterVolume(volume) * 100)}%`;
}

export function applyMasterVolume(volume: number, masterVolume: number | undefined): number {
  return clampAlertVolume(clampAlertVolume(volume) * clampMasterVolume(masterVolume));
}

function getVolumeBoostWarningStorageKey(warningKey: string): string {
  return `${VOLUME_BOOST_WARNING_STORAGE_PREFIX}${encodeURIComponent(warningKey || "default")}`;
}

export function hasAcknowledgedVolumeBoostWarning(warningKey: string): boolean {
  const storageKey = getVolumeBoostWarningStorageKey(warningKey);
  if (sessionVolumeBoostAcknowledgedKeys.has(storageKey)) {
    return true;
  }

  try {
    return localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

export function acknowledgeVolumeBoostWarning(warningKey: string): void {
  const storageKey = getVolumeBoostWarningStorageKey(warningKey);
  sessionVolumeBoostAcknowledgedKeys.add(storageKey);
  try {
    localStorage.setItem(storageKey, "1");
  } catch {
    // Storage can be blocked in private or restricted contexts. Session memory still prevents loops.
  }
}

export function shouldWarnForBoostedVolume(volume: number, warningKey: string): boolean {
  return (
    clampAlertVolume(volume) > STANDARD_ALERT_VOLUME &&
    !hasAcknowledgedVolumeBoostWarning(warningKey)
  );
}

export function resetVolumeBoostWarningForTests(): void {
  sessionVolumeBoostAcknowledgedKeys.clear();
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(VOLUME_BOOST_WARNING_STORAGE_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Tests may run without localStorage.
  }
}
