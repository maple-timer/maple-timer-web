import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "../../lib/storage";
import { createSettingsPreset } from "./settingsPresets";
import {
  buildPendingSettingsApplyForPresetAction,
  getImportedSettingsPresetIds,
  getImportedSettingsPresetSelectionAfterToggle,
  getSelectedImportedSettingsPresets,
  getSelectedSettingsPreset,
  getSelectedSettingsPresetApplyHintVisible,
  getSettingsManagerPresetIdOnOpen,
  shouldPromptBeforeSettingsReplacement,
  type PendingSettingsPresetImport,
} from "./settingsPresetControllerModel";

describe("settingsPresetControllerModel", () => {
  it("selects presets and decides whether the apply hint should be visible", () => {
    const profile = createDefaultProfile();
    const preset = createSettingsPreset("현재", profile);
    const changedProfile = { ...profile, masterVolume: 0.5 };

    expect(getSelectedSettingsPreset({ presets: [preset], selectedPresetId: preset.id })).toBe(
      preset,
    );
    expect(getSelectedSettingsPreset({ presets: [preset], selectedPresetId: "missing" })).toBeNull();
    expect(
      getSelectedSettingsPresetApplyHintVisible({
        selectedPreset: preset,
        profile,
      }),
    ).toBe(false);
    expect(
      getSelectedSettingsPresetApplyHintVisible({
        selectedPreset: preset,
        profile: changedProfile,
      }),
    ).toBe(true);
  });

  it("chooses the preset selected when opening the settings manager", () => {
    const profile = createDefaultProfile();
    const first = createSettingsPreset("첫 번째", profile);
    const second = createSettingsPreset("두 번째", profile);

    expect(
      getSettingsManagerPresetIdOnOpen({
        currentSettingsPreset: second,
        settingsPresets: [first, second],
        selectedSettingsPresetId: first.id,
      }),
    ).toBe(second.id);
    expect(
      getSettingsManagerPresetIdOnOpen({
        currentSettingsPreset: null,
        settingsPresets: [first, second],
        selectedSettingsPresetId: second.id,
      }),
    ).toBe(second.id);
    expect(
      getSettingsManagerPresetIdOnOpen({
        currentSettingsPreset: null,
        settingsPresets: [first, second],
        selectedSettingsPresetId: "missing",
      }),
    ).toBe(first.id);
  });

  it("detects when replacement should pause for unsaved settings", () => {
    const profile = createDefaultProfile();
    const preset = createSettingsPreset("저장된 설정", profile);

    expect(
      shouldPromptBeforeSettingsReplacement({
        settingsPresets: [preset],
        currentProfile: profile,
      }),
    ).toBe(false);
    expect(
      shouldPromptBeforeSettingsReplacement({
        settingsPresets: [preset],
        currentProfile: { ...profile, masterVolume: 0.4 },
      }),
    ).toBe(true);
  });

  it("builds pending apply data and fallback copy for missing custom sounds", () => {
    const profile = createDefaultProfile();
    profile.skills[0].soundId = "custom:missing-sound";

    const pending = buildPendingSettingsApplyForPresetAction({
      action: {
        kind: "apply-preset",
        presetId: "preset-1",
        presetName: "커스텀 누락",
        profile,
      },
      availableCustomSoundIds: [],
    });

    expect(pending).toMatchObject({
      title: "\"커스텀 누락\" 프리셋 적용",
      description:
        "현재 설정을 선택한 프리셋으로 교체합니다. 없는 사용자 알림음은 기본 알림음으로 바꿔 적용합니다.",
      confirmLabel: "기본 알림음으로 적용",
      presetId: "preset-1",
    });
    expect(pending.profile.skills[0].soundId).toBe("띵동띵동");
    expect(pending.customSoundFallbackNotice).toEqual({
      missingSoundCount: 1,
      replacedReferenceCount: 1,
      fallbackSoundLabel: "띵동띵동",
      affectedLabels: [`스킬: ${profile.skills[0].name}`],
    });
  });

  it("keeps imported preset selection ordered by the imported list", () => {
    const profile = createDefaultProfile();
    const first = createSettingsPreset("첫 번째", profile);
    const second = createSettingsPreset("두 번째", profile);
    const pendingImport: PendingSettingsPresetImport = {
      fileName: "settings.json",
      presets: [first, second],
      selectedPresetIds: [second.id],
    };

    expect(getImportedSettingsPresetIds(pendingImport)).toEqual([first.id, second.id]);
    expect(getSelectedImportedSettingsPresets(pendingImport)).toEqual([second]);
    expect(
      getImportedSettingsPresetSelectionAfterToggle({
        pendingImport,
        presetId: first.id,
        isSelected: true,
      }),
    ).toEqual([first.id, second.id]);
    expect(
      getImportedSettingsPresetSelectionAfterToggle({
        pendingImport,
        presetId: second.id,
        isSelected: false,
      }),
    ).toEqual([]);
  });
});
