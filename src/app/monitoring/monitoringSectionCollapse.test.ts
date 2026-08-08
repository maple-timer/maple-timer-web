import { beforeEach, describe, expect, it } from "vitest";
import {
  MONITORING_SECTION_COLLAPSE_STORAGE_KEY,
  MONITORING_SECTION_IDS,
  createDefaultMonitoringSectionCollapseState,
  loadMonitoringSectionCollapseState,
  saveMonitoringSectionCollapseState,
} from "./monitoringSectionCollapse";

describe("monitoringSectionCollapse", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("preserves the workspace identities and existing storage key", () => {
    expect(MONITORING_SECTION_IDS).toEqual([
      "skills",
      "rune",
      "ultimaRaidEquipment",
      "hunt",
      "buffExpiry",
      "specialCore",
      "boosterExpiry",
      "timers",
    ]);
    expect(MONITORING_SECTION_COLLAPSE_STORAGE_KEY).toBe(
      "maple-timer.alert-sections.collapsed.v1",
    );
  });

  it("defaults every monitoring section to expanded", () => {
    expect(loadMonitoringSectionCollapseState()).toEqual(
      createDefaultMonitoringSectionCollapseState(),
    );
  });

  it("restores saved collapsed monitoring sections", () => {
    saveMonitoringSectionCollapseState({
      skills: true,
      rune: false,
      ultimaRaidEquipment: false,
      hunt: true,
      buffExpiry: false,
      specialCore: false,
      boosterExpiry: false,
      timers: false,
    });

    expect(loadMonitoringSectionCollapseState()).toEqual({
      skills: true,
      rune: false,
      ultimaRaidEquipment: false,
      hunt: true,
      buffExpiry: false,
      specialCore: false,
      boosterExpiry: false,
      timers: false,
    });
  });

  it("ignores malformed storage", () => {
    localStorage.setItem(MONITORING_SECTION_COLLAPSE_STORAGE_KEY, "{");

    expect(loadMonitoringSectionCollapseState()).toEqual(
      createDefaultMonitoringSectionCollapseState(),
    );
  });
});
