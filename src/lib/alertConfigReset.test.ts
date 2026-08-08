import { describe, expect, it } from "vitest";
import {
  shouldResetBuffExpiryDetectionForPatch,
  shouldResetBoosterExpiryDetectionForPatch,
  shouldResetHuntStallDetectionForPatch,
  shouldResetRuneDetectionForPatch,
  shouldResetSpecialCoreDetectionForPatch,
  shouldResetUltimaRaidEquipmentDetectionForPatch,
  shouldRetimeSpecialCoreDetectionForPatch,
} from "./alertConfigReset";
import { createDefaultUltimaRaidEquipmentAlert } from "./profileFactory";

describe("alert config reset conditions", () => {
  it("does not reset rune detection when only sound or volume changes", () => {
    expect(shouldResetRuneDetectionForPatch({ volume: 1.5 })).toBe(false);
    expect(shouldResetRuneDetectionForPatch({ soundId: "미스터리" })).toBe(false);
  });

  it("resets rune detection when detection inputs change", () => {
    expect(shouldResetRuneDetectionForPatch({ enabled: false })).toBe(true);
    expect(shouldResetRuneDetectionForPatch({ region: null })).toBe(true);
    expect(shouldResetRuneDetectionForPatch({ regionsByLayout: {} })).toBe(true);
  });

  it("keeps Ultima Squad detection state when playback settings change", () => {
    const current = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: true,
      region: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
      regionsByLayout: {
        "1920x1080": { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
      },
      bossAlert: {
        ...createDefaultUltimaRaidEquipmentAlert().bossAlert,
        enabled: true,
      },
    };

    expect(
      shouldResetUltimaRaidEquipmentDetectionForPatch(
        { soundId: "미스터리", volume: 0.8 },
        current,
      ),
    ).toBe(false);
    expect(
      shouldResetUltimaRaidEquipmentDetectionForPatch(
        {
          ...current,
          soundId: "미스터리",
          region: { ...current.region! },
          regionsByLayout: {
            "1920x1080": { ...current.regionsByLayout!["1920x1080"] },
          },
        },
        current,
      ),
    ).toBe(false);
    expect(
      shouldResetUltimaRaidEquipmentDetectionForPatch(
        {
          bossAlert: {
            ...current.bossAlert,
            soundId: "미스터리",
            volume: 0.8,
          },
        },
        current,
      ),
    ).toBe(false);
  });

  it("resets Ultima Squad detection only when a detection input changes", () => {
    const current = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: true,
      region: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
      bossAlert: {
        ...createDefaultUltimaRaidEquipmentAlert().bossAlert,
        enabled: true,
      },
    };

    expect(
      shouldResetUltimaRaidEquipmentDetectionForPatch(
        { enabled: false },
        current,
      ),
    ).toBe(true);
    expect(
      shouldResetUltimaRaidEquipmentDetectionForPatch(
        {
          bossAlert: {
            ...current.bossAlert,
            enabled: false,
          },
        },
        current,
      ),
    ).toBe(true);
    expect(
      shouldResetUltimaRaidEquipmentDetectionForPatch(
        { region: null },
        current,
      ),
    ).toBe(true);
  });

  it("does not reset hunt stall detection when only threshold, sound, or volume changes", () => {
    expect(shouldResetHuntStallDetectionForPatch({ stallThresholdSeconds: 7 })).toBe(false);
    expect(shouldResetHuntStallDetectionForPatch({ volume: 1.5 })).toBe(false);
    expect(shouldResetHuntStallDetectionForPatch({ soundId: "미스터리" })).toBe(false);
  });

  it("resets hunt stall detection only when the feature is toggled", () => {
    expect(shouldResetHuntStallDetectionForPatch({ enabled: false })).toBe(true);
  });

  it("resets buff expiry detection when selected buffs change", () => {
    expect(shouldResetBuffExpiryDetectionForPatch({ selectedBuffIds: ["unionWealth"] })).toBe(true);
    expect(shouldResetBuffExpiryDetectionForPatch({ volume: 1.5 })).toBe(false);
  });

  it("does not reset buff expiry detection when precision target groups change", () => {
    expect(shouldResetBuffExpiryDetectionForPatch({ selectedPrecisionTargetGroups: ["potion"] })).toBe(false);
  });

  it("does not reset buff expiry detection when only the alert timing changes", () => {
    expect(shouldResetBuffExpiryDetectionForPatch({ alertLeadSeconds: 20 })).toBe(false);
  });

  it("preserves booster expiry diagnostics when only toggling the feature", () => {
    expect(shouldResetBoosterExpiryDetectionForPatch({ enabled: false })).toBe(false);
    expect(shouldResetBoosterExpiryDetectionForPatch({ enabled: true })).toBe(false);
  });

  it("resets booster expiry detection when timing inputs change", () => {
    expect(shouldResetBoosterExpiryDetectionForPatch({ alertLeadSeconds: 10 })).toBe(true);
  });

  it("retimes special core detection instead of resetting when timing inputs change", () => {
    expect(shouldResetSpecialCoreDetectionForPatch({ cooldownSeconds: 45 })).toBe(false);
    expect(shouldResetSpecialCoreDetectionForPatch({ alertLeadSeconds: 7 })).toBe(false);
    expect(shouldRetimeSpecialCoreDetectionForPatch({ cooldownSeconds: 45 })).toBe(true);
    expect(shouldRetimeSpecialCoreDetectionForPatch({ alertLeadSeconds: 7 })).toBe(true);
  });

  it("resets special core detection when toggling the feature", () => {
    expect(shouldResetSpecialCoreDetectionForPatch({ enabled: false })).toBe(true);
    expect(shouldRetimeSpecialCoreDetectionForPatch({ enabled: false })).toBe(false);
  });
});
