import { useCallback, useMemo, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { PendingSettingsApply } from "./SettingsApplyConfirmDialog";
import {
  trackPresetApply,
  trackPresetDelete,
  trackPresetExport,
  trackPresetImport,
  trackPresetSave,
  trackPresetUpdate,
  trackSettingsOpen,
} from "../../lib/analyticsEvents";
import {
  createSettingsPreset,
  findMatchingSettingsPreset,
  loadSettingsPresets,
  renameSettingsPreset,
  saveSettingsPresets,
  updateSettingsPresetProfile,
  type SettingsPreset,
} from "./settingsPresets";
import {
  createImportedSettingsPresets,
  downloadSettingsJson,
  formatSettingsTimestamp,
  normalizeSettingsFileNameSegment,
} from "./settingsPresetFiles";
import { parseSettingsBundle, serializeSettingsBundle } from "./settingsTransfer";
import { createDefaultProfile } from "../../lib/storage";
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
  type PendingSettingsReplacementAction,
} from "./settingsPresetControllerModel";
import type { Profile } from "../../types";
import type { HuntStallIncidentResetReason } from "../../runtime/hunt-stall/evidence/huntStallIncidentEvidenceTypes";
import type { BoosterExpiryIncidentResetReason } from "../../runtime/booster-expiry/evidence/boosterExpiryIncidentEvidenceTypes";
import type { SpecialCoreIncidentResetReason } from "../../runtime/special-core/evidence/specialCoreIncidentEvidenceTypes";

export type {
  PendingSettingsPresetImport,
  PendingSettingsReplacementAction,
} from "./settingsPresetControllerModel";

export function useSettingsPresetController({
  profile,
  profileRef,
  setProfile,
  resetSkillRuntime,
  clearAlertDisableSnapshotState,
  resetRuneDetection,
  resetHuntStallDetection,
  resetBuffExpiryDetection,
  resetBoosterExpiryDetection,
  resetSpecialCoreDetection,
  closeRegionPickers,
  setMessage,
  lastAlertErrorRef,
  availableCustomSoundIds,
}: {
  profile: Profile;
  profileRef: MutableRefObject<Profile>;
  setProfile: Dispatch<SetStateAction<Profile>>;
  resetSkillRuntime: (nextProfile: Profile) => void;
  clearAlertDisableSnapshotState: () => void;
  resetRuneDetection: () => void;
  resetHuntStallDetection: (
    reason?: Exclude<HuntStallIncidentResetReason, "initialized">,
  ) => void;
  resetBuffExpiryDetection: () => void;
  resetBoosterExpiryDetection: (
    reason?: Exclude<BoosterExpiryIncidentResetReason, "initialized">,
  ) => void;
  resetSpecialCoreDetection: (
    reason?: Exclude<SpecialCoreIncidentResetReason, "initialized">,
  ) => void;
  closeRegionPickers: () => void;
  setMessage: (message: string) => void;
  lastAlertErrorRef: MutableRefObject<string | null>;
  availableCustomSoundIds?: string[];
}) {
  const [isSettingsManagerOpen, setSettingsManagerOpen] = useState(false);
  const [settingsPresets, setSettingsPresets] = useState<SettingsPreset[]>(() =>
    loadSettingsPresets(),
  );
  const [selectedSettingsPresetId, setSelectedSettingsPresetId] = useState(
    () => loadSettingsPresets()[0]?.id ?? "",
  );
  const [pendingSettingsApply, setPendingSettingsApply] = useState<PendingSettingsApply | null>(
    null,
  );
  const [pendingSettingsReplacementAction, setPendingSettingsReplacementAction] =
    useState<PendingSettingsReplacementAction | null>(null);
  const [isUnsavedSettingsSavePromptOpen, setUnsavedSettingsSavePromptOpen] = useState(false);
  const [pendingSettingsPresetImport, setPendingSettingsPresetImport] =
    useState<PendingSettingsPresetImport | null>(null);

  const currentSettingsPreset = useMemo(
    () => findMatchingSettingsPreset(settingsPresets, profile),
    [profile, settingsPresets],
  );
  const selectedSettingsPreset = useMemo(
    () =>
      getSelectedSettingsPreset({
        presets: settingsPresets,
        selectedPresetId: selectedSettingsPresetId,
      }),
    [selectedSettingsPresetId, settingsPresets],
  );
  const isSelectedSettingsPresetApplyHintVisible = getSelectedSettingsPresetApplyHintVisible({
    selectedPreset: selectedSettingsPreset,
    profile,
  });

  const persistSettingsPresets = useCallback((nextPresets: SettingsPreset[]) => {
    saveSettingsPresets(nextPresets);
    setSettingsPresets(nextPresets);
    return nextPresets;
  }, []);

  const resetSettingsNow = useCallback(() => {
    const nextProfile = createDefaultProfile();

    profileRef.current = nextProfile;
    setProfile(nextProfile);
    resetSkillRuntime(nextProfile);
    clearAlertDisableSnapshotState();
    resetRuneDetection();
    resetHuntStallDetection("profile-replaced");
    resetBuffExpiryDetection();
    resetBoosterExpiryDetection("profile-replaced");
    resetSpecialCoreDetection("profile-replaced");
    closeRegionPickers();
    setSettingsManagerOpen(false);
    setMessage("설정을 초기화했습니다.");
    lastAlertErrorRef.current = null;
  }, [
    clearAlertDisableSnapshotState,
    closeRegionPickers,
    lastAlertErrorRef,
    profileRef,
    resetHuntStallDetection,
    resetBuffExpiryDetection,
    resetBoosterExpiryDetection,
    resetSpecialCoreDetection,
    resetRuneDetection,
    resetSkillRuntime,
    setMessage,
    setProfile,
  ]);

  const saveCurrentAsSettingsPreset = useCallback(
    (name: string) => {
      const preset = createSettingsPreset(name, profileRef.current);
      const nextPresets = [preset, ...settingsPresets];
      persistSettingsPresets(nextPresets);
      setSelectedSettingsPresetId(preset.id);
      setMessage(`"${preset.name}" 프리셋을 저장했습니다.`);
      trackPresetSave();
      return preset;
    },
    [persistSettingsPresets, profileRef, setMessage, settingsPresets],
  );

  const overwriteSelectedSettingsPreset = useCallback(
    (presetId: string) => {
      const preset = settingsPresets.find((item) => item.id === presetId);
      if (!preset) {
        setMessage("갱신할 프리셋을 찾지 못했습니다.");
        return;
      }

      const nextPresets = settingsPresets.map((item) =>
        item.id === presetId ? updateSettingsPresetProfile(item, profileRef.current) : item,
      );
      persistSettingsPresets(nextPresets);
      setMessage(`"${preset.name}" 프리셋을 현재 설정으로 갱신했습니다.`);
      trackPresetUpdate();
    },
    [persistSettingsPresets, profileRef, setMessage, settingsPresets],
  );

  const renameSelectedSettingsPreset = useCallback(
    (presetId: string, name: string) => {
      const preset = settingsPresets.find((item) => item.id === presetId);
      if (!preset) {
        setMessage("이름을 바꿀 프리셋을 찾지 못했습니다.");
        return;
      }

      const nextPresets = settingsPresets.map((item) =>
        item.id === presetId ? renameSettingsPreset(item, name) : item,
      );
      persistSettingsPresets(nextPresets);
      setMessage(`프리셋 이름을 "${name.trim()}"으로 변경했습니다.`);
    },
    [persistSettingsPresets, setMessage, settingsPresets],
  );

  const deleteSelectedSettingsPreset = useCallback(
    (presetId: string) => {
      const preset = settingsPresets.find((item) => item.id === presetId);
      if (!preset) {
        setMessage("삭제할 프리셋을 찾지 못했습니다.");
        return;
      }

      const nextPresets = settingsPresets.filter((item) => item.id !== presetId);
      persistSettingsPresets(nextPresets);
      setSelectedSettingsPresetId(nextPresets[0]?.id ?? "");
      setMessage(`"${preset.name}" 프리셋을 삭제했습니다. 현재 설정은 유지됩니다.`);
      trackPresetDelete();
    },
    [persistSettingsPresets, setMessage, settingsPresets],
  );

  const executeSettingsReplacementAction = useCallback(
    (action: PendingSettingsReplacementAction) => {
      if (action.kind === "reset") {
        resetSettingsNow();
        return;
      }

      setPendingSettingsApply(
        buildPendingSettingsApplyForPresetAction({
          action,
          availableCustomSoundIds,
        }),
      );
    },
    [availableCustomSoundIds, resetSettingsNow],
  );

  const requestSettingsReplacementAction = useCallback(
    (action: PendingSettingsReplacementAction) => {
      if (
        shouldPromptBeforeSettingsReplacement({
          settingsPresets,
          currentProfile: profileRef.current,
        })
      ) {
        setPendingSettingsReplacementAction(action);
        setUnsavedSettingsSavePromptOpen(false);
        return;
      }

      executeSettingsReplacementAction(action);
    },
    [executeSettingsReplacementAction, profileRef, settingsPresets],
  );

  const requestApplySettingsPreset = useCallback(
    (presetId: string) => {
      const preset = settingsPresets.find((item) => item.id === presetId);
      if (!preset) {
        setMessage("적용할 프리셋을 찾지 못했습니다.");
        return;
      }

      requestSettingsReplacementAction({
        kind: "apply-preset",
        presetId,
        presetName: preset.name,
        profile: preset.profile,
      });
    },
    [requestSettingsReplacementAction, setMessage, settingsPresets],
  );

  const requestResetSettings = useCallback(
    () => requestSettingsReplacementAction({ kind: "reset" }),
    [requestSettingsReplacementAction],
  );

  const exportAllSettingsPresets = useCallback(() => {
    if (settingsPresets.length === 0) {
      setMessage("내보낼 프리셋이 없습니다.");
      return;
    }

    const json = serializeSettingsBundle(profileRef.current, settingsPresets);
    downloadSettingsJson(`maple-timer-presets-${formatSettingsTimestamp(new Date())}.json`, json);
    setMessage(`${settingsPresets.length}개 프리셋을 JSON 파일로 내보냈습니다.`);
    trackPresetExport("all", settingsPresets.length);
  }, [profileRef, setMessage, settingsPresets]);

  const exportSelectedSettingsPreset = useCallback(
    (presetId: string) => {
      const preset = settingsPresets.find((item) => item.id === presetId);
      if (!preset) {
        setMessage("내보낼 프리셋을 찾지 못했습니다.");
        return;
      }

      const json = serializeSettingsBundle(preset.profile, [preset]);
      const fileNameSegment = normalizeSettingsFileNameSegment(preset.name);
      downloadSettingsJson(
        `maple-timer-preset-${fileNameSegment}-${formatSettingsTimestamp(new Date())}.json`,
        json,
      );
      setMessage(`"${preset.name}" 프리셋을 JSON 파일로 내보냈습니다.`);
      trackPresetExport("selected", 1);
    },
    [setMessage, settingsPresets],
  );

  const importSettings = useCallback(
    async (file: File) => {
      try {
        const result = parseSettingsBundle(await file.text());
        if (!result.ok) {
          setMessage(result.error);
          return;
        }

        const presets = createImportedSettingsPresets(
          result.profile,
          result.presets,
          file.name,
          settingsPresets,
        );

        setPendingSettingsPresetImport({
          fileName: file.name,
          presets,
          selectedPresetIds: presets.map((preset) => preset.id),
          warnings: result.warnings,
        });
      } catch {
        setMessage("설정 파일을 읽지 못했습니다.");
      }
    },
    [setMessage, settingsPresets],
  );

  const confirmSettingsApply = useCallback(() => {
    if (!pendingSettingsApply) {
      return;
    }

    const nextProfile = {
      ...pendingSettingsApply.profile,
      updatedAt: new Date().toISOString(),
    };
    profileRef.current = nextProfile;
    setProfile(nextProfile);
    resetSkillRuntime(nextProfile);
    clearAlertDisableSnapshotState();
    resetRuneDetection();
    resetHuntStallDetection(
      pendingSettingsApply.presetId ? "preset-replaced" : "profile-replaced",
    );
    resetBuffExpiryDetection();
    resetBoosterExpiryDetection(
      pendingSettingsApply.presetId ? "preset-replaced" : "profile-replaced",
    );
    resetSpecialCoreDetection(
      pendingSettingsApply.presetId ? "preset-replaced" : "profile-replaced",
    );
    closeRegionPickers();
    setSettingsManagerOpen(false);
    setPendingSettingsApply(null);
    if (pendingSettingsApply.presetId) {
      setSelectedSettingsPresetId(pendingSettingsApply.presetId);
    }
    lastAlertErrorRef.current = null;
    trackPresetApply();

    setMessage("설정을 적용했습니다.");
  }, [
    clearAlertDisableSnapshotState,
    closeRegionPickers,
    lastAlertErrorRef,
    pendingSettingsApply,
    profileRef,
    resetHuntStallDetection,
    resetBuffExpiryDetection,
    resetBoosterExpiryDetection,
    resetSpecialCoreDetection,
    resetRuneDetection,
    resetSkillRuntime,
    setMessage,
    setProfile,
  ]);

  const cancelSettingsApply = useCallback(() => {
    setPendingSettingsApply(null);
  }, []);

  const confirmSettingsPresetImport = useCallback(() => {
    if (!pendingSettingsPresetImport) {
      return;
    }

    const selectedPresets = getSelectedImportedSettingsPresets(pendingSettingsPresetImport);
    if (selectedPresets.length === 0) {
      setMessage("불러올 프리셋을 선택해야 합니다.");
      return;
    }

    const nextPresets = [...selectedPresets, ...settingsPresets];
    persistSettingsPresets(nextPresets);
    const nextPresetId = selectedPresets[0]?.id ?? nextPresets[0]?.id ?? "";
    setSelectedSettingsPresetId(nextPresetId);
    setPendingSettingsPresetImport(null);
    setMessage(
      `${selectedPresets.length}개 프리셋을 불러왔습니다. 현재 설정에 반영하려면 적용을 눌러주세요.`,
    );
    trackPresetImport(selectedPresets.length);
  }, [pendingSettingsPresetImport, persistSettingsPresets, setMessage, settingsPresets]);

  const cancelSettingsPresetImport = useCallback(() => {
    setPendingSettingsPresetImport(null);
  }, []);

  const selectAllImportedSettingsPresets = useCallback(() => {
    setPendingSettingsPresetImport((current) =>
      current
        ? {
            ...current,
            selectedPresetIds: getImportedSettingsPresetIds(current),
          }
        : current,
    );
  }, []);

  const clearImportedSettingsPresetSelection = useCallback(() => {
    setPendingSettingsPresetImport((current) =>
      current ? { ...current, selectedPresetIds: [] } : current,
    );
  }, []);

  const toggleImportedSettingsPreset = useCallback((presetId: string, isSelected: boolean) => {
    setPendingSettingsPresetImport((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        selectedPresetIds: getImportedSettingsPresetSelectionAfterToggle({
          pendingImport: current,
          presetId,
          isSelected,
        }),
      };
    });
  }, []);

  const openSettingsManager = useCallback(() => {
    const currentPresetId = getSettingsManagerPresetIdOnOpen({
      currentSettingsPreset,
      settingsPresets,
      selectedSettingsPresetId,
    });
    setSelectedSettingsPresetId(currentPresetId);
    setSettingsManagerOpen(true);
    trackSettingsOpen();
  }, [currentSettingsPreset, selectedSettingsPresetId, settingsPresets]);

  const closeSettingsManager = useCallback(() => {
    setSettingsManagerOpen(false);
  }, []);

  const cancelUnsavedSettingsReplacement = useCallback(() => {
    setPendingSettingsReplacementAction(null);
    setUnsavedSettingsSavePromptOpen(false);
  }, []);

  const confirmUnsavedSettingsReplacement = useCallback(() => {
    if (!pendingSettingsReplacementAction) {
      return;
    }

    const action = pendingSettingsReplacementAction;
    setPendingSettingsReplacementAction(null);
    setUnsavedSettingsSavePromptOpen(false);
    executeSettingsReplacementAction(action);
  }, [executeSettingsReplacementAction, pendingSettingsReplacementAction]);

  const openUnsavedSettingsSavePrompt = useCallback(() => {
    setUnsavedSettingsSavePromptOpen(true);
  }, []);

  const closeUnsavedSettingsSavePrompt = useCallback(() => {
    setUnsavedSettingsSavePromptOpen(false);
  }, []);

  const saveCurrentSettingsBeforeReplacement = useCallback(
    (name: string) => {
      if (settingsPresets.some((preset) => preset.name === name.trim())) {
        return "이미 같은 이름의 프리셋이 있습니다.";
      }
      if (!pendingSettingsReplacementAction) {
        return;
      }

      const action = pendingSettingsReplacementAction;
      saveCurrentAsSettingsPreset(name);
      setPendingSettingsReplacementAction(null);
      setUnsavedSettingsSavePromptOpen(false);
      executeSettingsReplacementAction(action);
    },
    [
      executeSettingsReplacementAction,
      pendingSettingsReplacementAction,
      saveCurrentAsSettingsPreset,
      settingsPresets,
    ],
  );

  return {
    isSettingsManagerOpen,
    settingsManagerDialogProps: {
      presets: settingsPresets,
      currentSettingsPresetName: currentSettingsPreset?.name ?? null,
      selectedPresetId: selectedSettingsPresetId,
      isApplyHintVisible: isSelectedSettingsPresetApplyHintVisible,
      onSelectedPresetChange: setSelectedSettingsPresetId,
      onSaveNewPreset: saveCurrentAsSettingsPreset,
      onRenamePreset: renameSelectedSettingsPreset,
      onOverwritePreset: overwriteSelectedSettingsPreset,
      onDeletePreset: deleteSelectedSettingsPreset,
      onApplyPreset: requestApplySettingsPreset,
      onExportAllPresets: exportAllSettingsPresets,
      onExportSelectedPreset: exportSelectedSettingsPreset,
      onImportSettings: importSettings,
      onResetSettings: requestResetSettings,
      onClose: closeSettingsManager,
    },
    pendingSettingsPresetImport,
    pendingSettingsReplacementAction,
    isUnsavedSettingsSavePromptOpen,
    pendingSettingsApply,
    openSettingsManager,
    cancelSettingsPresetImport,
    confirmSettingsPresetImport,
    selectAllImportedSettingsPresets,
    clearImportedSettingsPresetSelection,
    toggleImportedSettingsPreset,
    cancelUnsavedSettingsReplacement,
    confirmUnsavedSettingsReplacement,
    openUnsavedSettingsSavePrompt,
    closeUnsavedSettingsSavePrompt,
    saveCurrentSettingsBeforeReplacement,
    cancelSettingsApply,
    confirmSettingsApply,
  };
}
