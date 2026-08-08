import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultProfile } from "../../lib/storage";
import {
  createSettingsBundle,
  createSettingsProfileSnapshot,
  parseSettingsBundle,
  serializeSettingsBundle,
} from "./settingsTransfer";
import {
  createSettingsPreset,
  findMatchingSettingsPreset,
  loadSettingsPresets,
  mergeSettingsPresets,
  profilesHaveSameSettings,
  renameSettingsPreset,
  saveSettingsPresets,
} from "./settingsPresets";

describe("settings transfer", () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("exports current settings without running timer state", () => {
    const profile = createDefaultProfile();
    profile.generalTimers = [
      {
        ...profile.generalTimers![0],
        startedAt: 1000,
        endsAt: 2000,
        remainingSecondsAtPause: 30,
        alertedAt: 3000,
      },
    ];

    const snapshot = createSettingsProfileSnapshot(profile);

    expect(snapshot.generalTimers?.[0]).toMatchObject({
      startedAt: null,
      endsAt: null,
      remainingSecondsAtPause: null,
      alertedAt: null,
    });
  });

  it("keeps custom sound references without embedding audio data", () => {
    const profile = createDefaultProfile();
    profile.alertDefaults.soundId = "custom:boss";
    profile.skills[0].soundId = "custom:boss";

    const json = serializeSettingsBundle(profile);

    expect(json).toContain("custom:boss");
    expect(json).not.toContain("data:audio");
    expect(json).not.toContain("blob");
  });

  it("parses the versioned JSON bundle and keeps included presets", () => {
    const profile = createDefaultProfile();
    const preset = createSettingsPreset("본캐", profile);
    const result = parseSettingsBundle(serializeSettingsBundle(profile, [preset]));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.profile.skills).toHaveLength(2);
    expect(result.presets).toHaveLength(1);
    expect(result.presets[0]).toMatchObject({ name: "본캐" });
  });

  it("accepts newer bundle versions by loading known fields with a warning", () => {
    const bundle = createSettingsBundle(createDefaultProfile());
    const result = parseSettingsBundle(JSON.stringify({ ...bundle, version: 99 }));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.warnings[0]).toMatch(/새로운 버전/);
    expect(result.profile.skills).toHaveLength(2);
  });

  it("rejects unrelated JSON files", () => {
    const result = parseSettingsBundle(JSON.stringify({ hello: "world" }));

    expect(result).toMatchObject({
      ok: false,
      error: "Maple Timer 설정 파일이 아닙니다.",
    });
  });

  it("stores presets in localStorage and drops invalid entries", () => {
    const profile = createDefaultProfile();
    const preset = createSettingsPreset("부캐", profile);

    localStorage.setItem(
      "maple-timer.settings-presets.v1",
      JSON.stringify({
        schema: "maple-timer.settings-presets",
        version: 1,
        presets: [preset, { id: "bad", name: "깨진 값" }],
      }),
    );

    expect(loadSettingsPresets()).toHaveLength(1);
    expect(loadSettingsPresets()[0]).toMatchObject({ name: "부캐" });
  });

  it("merges imported presets by id and persists normalized presets", () => {
    const profile = createDefaultProfile();
    const current = createSettingsPreset("현재", profile);
    const imported = { ...current, name: "가져온 값" };
    const merged = mergeSettingsPresets([current], [imported]);

    saveSettingsPresets(merged);

    expect(loadSettingsPresets()).toHaveLength(1);
    expect(loadSettingsPresets()[0]).toMatchObject({ name: "가져온 값" });
  });

  it("renames presets without changing their saved settings", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T00:00:00.000Z"));
    const preset = createSettingsPreset("기존 이름", createDefaultProfile());

    vi.setSystemTime(new Date("2026-05-16T01:00:00.000Z"));
    const renamed = renameSettingsPreset(preset, "  새 이름  ");

    expect(renamed).toMatchObject({
      id: preset.id,
      name: "새 이름",
      createdAt: preset.createdAt,
      updatedAt: "2026-05-16T01:00:00.000Z",
    });
    expect(renamed.profile).toEqual(preset.profile);
  });

  it("matches current settings against saved presets without timestamp noise", () => {
    const profile = createDefaultProfile();
    const preset = createSettingsPreset("현재 설정", profile);
    const sameSettings = {
      ...profile,
      id: "different-profile",
      updatedAt: "2099-01-01T00:00:00.000Z",
    };

    expect(profilesHaveSameSettings(preset.profile, sameSettings)).toBe(true);
    expect(findMatchingSettingsPreset([preset], sameSettings)).toMatchObject({
      name: "현재 설정",
    });
  });
});
