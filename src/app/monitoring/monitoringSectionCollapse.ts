export const MONITORING_SECTION_COLLAPSE_STORAGE_KEY =
  "maple-timer.alert-sections.collapsed.v1";

export const MONITORING_SECTION_IDS = [
  "skills",
  "rune",
  "ultimaRaidEquipment",
  "hunt",
  "buffExpiry",
  "specialCore",
  "boosterExpiry",
  "timers",
] as const;

export type MonitoringSectionId = (typeof MONITORING_SECTION_IDS)[number];
export type MonitoringSectionCollapseState = Record<MonitoringSectionId, boolean>;

export function createDefaultMonitoringSectionCollapseState(): MonitoringSectionCollapseState {
  return {
    skills: false,
    rune: false,
    ultimaRaidEquipment: false,
    hunt: false,
    buffExpiry: false,
    specialCore: false,
    boosterExpiry: false,
    timers: false,
  };
}

export function loadMonitoringSectionCollapseState(): MonitoringSectionCollapseState {
  const fallback = createDefaultMonitoringSectionCollapseState();

  if (typeof localStorage === "undefined") {
    return fallback;
  }

  try {
    const raw = localStorage.getItem(MONITORING_SECTION_COLLAPSE_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as Partial<Record<MonitoringSectionId, unknown>>;
    return MONITORING_SECTION_IDS.reduce<MonitoringSectionCollapseState>((state, id) => {
      state[id] = parsed[id] === true;
      return state;
    }, fallback);
  } catch {
    return fallback;
  }
}

export function saveMonitoringSectionCollapseState(
  state: MonitoringSectionCollapseState,
): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(MONITORING_SECTION_COLLAPSE_STORAGE_KEY, JSON.stringify(state));
}
