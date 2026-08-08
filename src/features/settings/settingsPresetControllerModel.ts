import type { PendingSettingsApply } from "./SettingsApplyConfirmDialog";
import {
  findMissingCustomAlertSoundReferences,
  replaceMissingCustomAlertSoundReferences,
} from "../../lib/customSoundReferences";
import { DEFAULT_ALERT_SOUND_ID, getAlertSound } from "../../lib/sounds";
import type { Profile } from "../../types";
import {
  findMatchingSettingsPreset,
  profilesHaveSameSettings,
  type SettingsPreset,
} from "./settingsPresets";

export type PendingSettingsPresetImport = {
  fileName: string;
  presets: SettingsPreset[];
  selectedPresetIds: string[];
  warnings?: string[];
};

export type PendingSettingsReplacementAction =
  | {
      kind: "apply-preset";
      presetId: string;
      presetName: string;
      profile: Profile;
    }
  | {
      kind: "reset";
    };

export function getSelectedSettingsPreset({
  presets,
  selectedPresetId,
}: {
  presets: SettingsPreset[];
  selectedPresetId: string;
}): SettingsPreset | null {
  return presets.find((preset) => preset.id === selectedPresetId) ?? null;
}

export function getSelectedSettingsPresetApplyHintVisible({
  selectedPreset,
  profile,
}: {
  selectedPreset: SettingsPreset | null;
  profile: Profile;
}): boolean {
  return Boolean(selectedPreset && !profilesHaveSameSettings(selectedPreset.profile, profile));
}

export function getSettingsManagerPresetIdOnOpen({
  currentSettingsPreset,
  settingsPresets,
  selectedSettingsPresetId,
}: {
  currentSettingsPreset: SettingsPreset | null;
  settingsPresets: SettingsPreset[];
  selectedSettingsPresetId: string;
}): string {
  return (
    currentSettingsPreset?.id ??
    (settingsPresets.some((preset) => preset.id === selectedSettingsPresetId)
      ? selectedSettingsPresetId
      : settingsPresets[0]?.id ?? "")
  );
}

export function shouldPromptBeforeSettingsReplacement({
  settingsPresets,
  currentProfile,
}: {
  settingsPresets: SettingsPreset[];
  currentProfile: Profile;
}): boolean {
  return !findMatchingSettingsPreset(settingsPresets, currentProfile);
}

export function buildPendingSettingsApplyForPresetAction({
  action,
  availableCustomSoundIds,
}: {
  action: Extract<PendingSettingsReplacementAction, { kind: "apply-preset" }>;
  availableCustomSoundIds?: string[];
}): PendingSettingsApply {
  const missingCustomSounds = findMissingCustomAlertSoundReferences(
    action.profile,
    availableCustomSoundIds ?? [],
  );
  const missingReferenceLabels = missingCustomSounds.flatMap((item) => item.labels);
  const fallbackResult =
    missingCustomSounds.length > 0
      ? replaceMissingCustomAlertSoundReferences(
          action.profile,
          missingCustomSounds.map((item) => item.soundId),
          DEFAULT_ALERT_SOUND_ID,
        )
      : { profile: action.profile, replacedCount: 0 };
  const defaultSoundLabel = getAlertSound(DEFAULT_ALERT_SOUND_ID).label.replace(
    /^\[[^\]]+\]\s*/,
    "",
  );

  return {
    title: `"${action.presetName}" 프리셋 적용`,
    description:
      missingCustomSounds.length > 0
        ? "현재 설정을 선택한 프리셋으로 교체합니다. 없는 사용자 알림음은 기본 알림음으로 바꿔 적용합니다."
        : "현재 설정을 선택한 프리셋으로 교체합니다.",
    confirmLabel: missingCustomSounds.length > 0 ? "기본 알림음으로 적용" : "프리셋 적용",
    presetId: action.presetId,
    profile: fallbackResult.profile,
    customSoundFallbackNotice:
      missingCustomSounds.length > 0
        ? {
            missingSoundCount: missingCustomSounds.length,
            replacedReferenceCount: fallbackResult.replacedCount,
            fallbackSoundLabel: defaultSoundLabel,
            affectedLabels: missingReferenceLabels,
          }
        : undefined,
  };
}

export function getSelectedImportedSettingsPresets(
  pendingImport: PendingSettingsPresetImport,
): SettingsPreset[] {
  const selectedIds = new Set(pendingImport.selectedPresetIds);
  return pendingImport.presets.filter((preset) => selectedIds.has(preset.id));
}

export function getImportedSettingsPresetIds(pendingImport: PendingSettingsPresetImport): string[] {
  return pendingImport.presets.map((preset) => preset.id);
}

export function getImportedSettingsPresetSelectionAfterToggle({
  pendingImport,
  presetId,
  isSelected,
}: {
  pendingImport: PendingSettingsPresetImport;
  presetId: string;
  isSelected: boolean;
}): string[] {
  const selectedIds = new Set(pendingImport.selectedPresetIds);
  if (isSelected) {
    selectedIds.add(presetId);
  } else {
    selectedIds.delete(presetId);
  }
  return pendingImport.presets.filter((item) => selectedIds.has(item.id)).map((item) => item.id);
}
