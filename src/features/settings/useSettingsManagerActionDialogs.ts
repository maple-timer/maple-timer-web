import { useState } from "react";
import type { SettingsPreset } from "./settingsPresets";

export function useSettingsManagerActionDialogs({
  presets,
  selectedPreset,
  onSaveNewPreset,
  onRenamePreset,
  onOverwritePreset,
  onDeletePreset,
  onResetSettings,
}: {
  presets: SettingsPreset[];
  selectedPreset: SettingsPreset | null;
  onSaveNewPreset: (name: string) => void;
  onRenamePreset: (presetId: string, name: string) => void;
  onOverwritePreset: (presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
  onResetSettings: () => void;
}) {
  const [newPresetInitialName, setNewPresetInitialName] = useState<string | null>(null);
  const [renamePreset, setRenamePreset] = useState<SettingsPreset | null>(null);
  const [overwritePreset, setOverwritePreset] = useState<SettingsPreset | null>(null);
  const [deletePreset, setDeletePreset] = useState<SettingsPreset | null>(null);
  const [isResetConfirmOpen, setResetConfirmOpen] = useState(false);

  const isDuplicatePresetName = (name: string, exceptPresetId?: string) =>
    presets.some((preset) => preset.id !== exceptPresetId && preset.name === name.trim());

  const requestSaveNewPreset = () => {
    const suggestedName = selectedPreset ? `${selectedPreset.name} 복사본` : "사냥 프리셋";
    setNewPresetInitialName(suggestedName);
  };

  return {
    requestSaveNewPreset,
    requestRenamePreset: setRenamePreset,
    requestOverwritePreset: setOverwritePreset,
    requestDeletePreset: setDeletePreset,
    requestReset: () => setResetConfirmOpen(true),
    actionDialogProps: {
      newPresetInitialName,
      renamePreset,
      overwritePreset,
      deletePreset,
      isResetConfirmOpen,
      onCancelNewPreset: () => setNewPresetInitialName(null),
      onConfirmNewPreset: (name: string) => {
        if (isDuplicatePresetName(name)) {
          return "이미 같은 이름의 프리셋이 있습니다.";
        }
        onSaveNewPreset(name);
        setNewPresetInitialName(null);
        return undefined;
      },
      onCancelRenamePreset: () => setRenamePreset(null),
      onConfirmRenamePreset: (name: string) => {
        if (!renamePreset) {
          return undefined;
        }
        if (isDuplicatePresetName(name, renamePreset.id)) {
          return "이미 같은 이름의 프리셋이 있습니다.";
        }
        onRenamePreset(renamePreset.id, name);
        setRenamePreset(null);
        return undefined;
      },
      onCancelOverwritePreset: () => setOverwritePreset(null),
      onConfirmOverwritePreset: () => {
        if (!overwritePreset) {
          return;
        }
        onOverwritePreset(overwritePreset.id);
        setOverwritePreset(null);
      },
      onCancelDeletePreset: () => setDeletePreset(null),
      onConfirmDeletePreset: () => {
        if (!deletePreset) {
          return;
        }
        onDeletePreset(deletePreset.id);
        setDeletePreset(null);
      },
      onCancelReset: () => setResetConfirmOpen(false),
      onConfirmReset: () => {
        onResetSettings();
        setResetConfirmOpen(false);
      },
    },
  };
}
