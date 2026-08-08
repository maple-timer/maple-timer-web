const ALERT_DISABLE_SNAPSHOT_STORAGE_KEY = "maple-timer.alert-disable.snapshot.v1";

export type AlertDisableSnapshot = {
  skills: Record<string, boolean>;
  runeEnabled: boolean;
  ultimaRaidEquipmentEnabled?: boolean;
  ultimaRaidBossEnabled?: boolean;
  huntStallEnabled?: boolean;
  buffExpiryEnabled?: boolean;
  boosterExpiryEnabled?: boolean;
  specialCoreEnabled?: boolean;
  generalTimers?: Record<string, boolean>;
  generalTimerRunning?: Record<string, boolean>;
  createdAt: number;
};

export function loadAlertDisableSnapshot(): AlertDisableSnapshot | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(ALERT_DISABLE_SNAPSHOT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<AlertDisableSnapshot>;
    if (!parsed.skills || typeof parsed.skills !== "object" || Array.isArray(parsed.skills)) {
      return null;
    }

    return {
      skills: Object.fromEntries(
        Object.entries(parsed.skills).map(([skillId, enabled]) => [skillId, Boolean(enabled)]),
      ),
      runeEnabled: Boolean(parsed.runeEnabled),
      ultimaRaidEquipmentEnabled: Boolean(parsed.ultimaRaidEquipmentEnabled),
      ultimaRaidBossEnabled: Boolean(parsed.ultimaRaidBossEnabled),
      huntStallEnabled: Boolean(parsed.huntStallEnabled),
      buffExpiryEnabled: Boolean(parsed.buffExpiryEnabled),
      boosterExpiryEnabled: Boolean(parsed.boosterExpiryEnabled),
      specialCoreEnabled: Boolean(parsed.specialCoreEnabled),
      generalTimers:
        parsed.generalTimers && typeof parsed.generalTimers === "object" && !Array.isArray(parsed.generalTimers)
          ? Object.fromEntries(
              Object.entries(parsed.generalTimers).map(([timerId, enabled]) => [
                timerId,
                Boolean(enabled),
              ]),
            )
          : {},
      // A stored snapshot always comes from an earlier page load, so its
      // running timers belong to a session the user has already left.
      // Refreshing must not keep timers running, and re-enabling alerts is an
      // alert switch rather than a play button, so the running marks are
      // dropped here: enabled state still restores, and the user presses play.
      generalTimerRunning: {},
      createdAt: Number(parsed.createdAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveAlertDisableSnapshot(snapshot: AlertDisableSnapshot): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(ALERT_DISABLE_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
}

export function clearAlertDisableSnapshot(): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.removeItem(ALERT_DISABLE_SNAPSHOT_STORAGE_KEY);
}
