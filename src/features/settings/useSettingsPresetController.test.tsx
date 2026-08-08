import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackPresetImport, trackPresetSave } from "../../lib/analyticsEvents";
import { createDefaultProfile } from "../../lib/storage";
import type { Profile } from "../../types";
import { createSettingsPreset, saveSettingsPresets } from "./settingsPresets";
import { serializeSettingsBundle } from "./settingsTransfer";
import { useSettingsPresetController } from "./useSettingsPresetController";

vi.mock("../../lib/analyticsEvents", async () => {
  const actual = await vi.importActual<typeof import("../../lib/analyticsEvents")>(
    "../../lib/analyticsEvents",
  );
  return {
    ...actual,
    trackPresetImport: vi.fn(),
    trackPresetSave: vi.fn(),
  };
});

type HookApi = ReturnType<typeof useSettingsPresetController>;

type SettingsTransactionActions = {
  clearAlertDisableSnapshotState: ReturnType<typeof vi.fn>;
  resetRuneDetection: ReturnType<typeof vi.fn>;
  resetHuntStallDetection: ReturnType<typeof vi.fn>;
  resetBuffExpiryDetection: ReturnType<typeof vi.fn>;
  resetBoosterExpiryDetection: ReturnType<typeof vi.fn>;
  resetSpecialCoreDetection: ReturnType<typeof vi.fn>;
  closeRegionPickers: ReturnType<typeof vi.fn>;
};

type HarnessState = {
  profile: Profile;
  profileRef: { current: Profile };
  lastAlertErrorRef: { current: string | null };
};

const trackPresetSaveMock = vi.mocked(trackPresetSave);
const trackPresetImportMock = vi.mocked(trackPresetImport);

function Harness({
  initialProfile,
  resetSkillRuntime,
  setMessage,
  availableCustomSoundIds,
  transactionActions,
  initialLastAlertError = null,
  onReady,
}: {
  initialProfile: Profile;
  resetSkillRuntime: (nextProfile: Profile) => void;
  setMessage: (message: string) => void;
  availableCustomSoundIds?: string[];
  transactionActions?: SettingsTransactionActions;
  initialLastAlertError?: string | null;
  onReady: (api: HookApi, state: HarnessState) => void;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const profileRef = useRef(profile);
  const lastAlertErrorRef = useRef<string | null>(initialLastAlertError);
  const fallbackTransactionActions = useRef<SettingsTransactionActions>({
    clearAlertDisableSnapshotState: vi.fn(),
    resetRuneDetection: vi.fn(),
    resetHuntStallDetection: vi.fn(),
    resetBuffExpiryDetection: vi.fn(),
    resetBoosterExpiryDetection: vi.fn(),
    resetSpecialCoreDetection: vi.fn(),
    closeRegionPickers: vi.fn(),
  }).current;
  const actions = transactionActions ?? fallbackTransactionActions;
  profileRef.current = profile;

  const api = useSettingsPresetController({
    profile,
    profileRef,
    setProfile,
    resetSkillRuntime,
    clearAlertDisableSnapshotState: actions.clearAlertDisableSnapshotState,
    resetRuneDetection: actions.resetRuneDetection,
    resetHuntStallDetection: actions.resetHuntStallDetection,
    resetBuffExpiryDetection: actions.resetBuffExpiryDetection,
    resetBoosterExpiryDetection: actions.resetBoosterExpiryDetection,
    resetSpecialCoreDetection: actions.resetSpecialCoreDetection,
    closeRegionPickers: actions.closeRegionPickers,
    setMessage,
    lastAlertErrorRef,
    availableCustomSoundIds,
  });

  useEffect(() => {
    onReady(api, { profile, profileRef, lastAlertErrorRef });
  }, [api, onReady, profile]);

  return null;
}

describe("useSettingsPresetController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("saves the current profile as a preset and persists it to localStorage", async () => {
    const setMessage = vi.fn();
    const apiRef: { current: HookApi | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) {
        throw new Error("hook api is not ready");
      }
      return apiRef.current;
    };

    render(
      <Harness
        initialProfile={createDefaultProfile()}
        resetSkillRuntime={vi.fn()}
        setMessage={setMessage}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getApi().settingsManagerDialogProps.onSaveNewPreset("사냥 프리셋");
    });

    await waitFor(() => {
      expect(getApi().settingsManagerDialogProps.presets).toHaveLength(1);
    });

    const stored = JSON.parse(localStorage.getItem("maple-timer.settings-presets.v1") ?? "{}");
    expect(stored.presets[0].name).toBe("사냥 프리셋");
    expect(getApi().settingsManagerDialogProps.selectedPresetId).toBe(stored.presets[0].id);
    expect(setMessage).toHaveBeenCalledWith("\"사냥 프리셋\" 프리셋을 저장했습니다.");
    expect(trackPresetSaveMock).toHaveBeenCalledTimes(1);
  });

  it("warns and falls back to the default sound before applying a preset with missing custom sounds", async () => {
    const setMessage = vi.fn();
    const apiRef: { current: HookApi | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) {
        throw new Error("hook api is not ready");
      }
      return apiRef.current;
    };
    const profile = createDefaultProfile();
    profile.skills[0].soundId = "custom:missing-sound";
    saveSettingsPresets([createSettingsPreset("커스텀 누락 프리셋", profile)]);

    render(
      <Harness
        initialProfile={profile}
        resetSkillRuntime={vi.fn()}
        setMessage={setMessage}
        availableCustomSoundIds={[]}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    await waitFor(() => {
      expect(getApi().settingsManagerDialogProps.presets).toHaveLength(1);
    });

    act(() => {
      getApi().settingsManagerDialogProps.onApplyPreset(
        getApi().settingsManagerDialogProps.presets[0].id,
      );
    });

    await waitFor(() => {
      expect(getApi().pendingSettingsApply?.confirmLabel).toBe("기본 알림음으로 적용");
    });
    expect(getApi().pendingSettingsApply?.profile.skills[0].soundId).toBe("띵동띵동");
    expect(getApi().pendingSettingsApply?.customSoundFallbackNotice).toEqual({
      missingSoundCount: 1,
      replacedReferenceCount: 1,
      fallbackSoundLabel: "띵동띵동",
      affectedLabels: [`스킬: ${profile.skills[0].name}`],
    });
  });

  it("prompts to save unsaved settings before replacing them with a preset", async () => {
    const setMessage = vi.fn();
    const apiRef: { current: HookApi | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) {
        throw new Error("hook api is not ready");
      }
      return apiRef.current;
    };
    const currentProfile = createDefaultProfile();
    currentProfile.masterVolume = 0.42;
    const presetProfile = createDefaultProfile();
    presetProfile.masterVolume = 0.91;
    const preset = createSettingsPreset("저장된 프리셋", presetProfile);
    saveSettingsPresets([preset]);

    render(
      <Harness
        initialProfile={currentProfile}
        resetSkillRuntime={vi.fn()}
        setMessage={setMessage}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    await waitFor(() => {
      expect(getApi().settingsManagerDialogProps.presets).toHaveLength(1);
    });

    act(() => {
      getApi().settingsManagerDialogProps.onApplyPreset(preset.id);
    });

    await waitFor(() => {
      expect(getApi().pendingSettingsReplacementAction).toMatchObject({
        kind: "apply-preset",
        presetId: preset.id,
      });
    });
    expect(getApi().pendingSettingsApply).toBeNull();

    act(() => {
      getApi().saveCurrentSettingsBeforeReplacement("현재 설정 보관");
    });

    await waitFor(() => {
      expect(getApi().pendingSettingsReplacementAction).toBeNull();
    });
    expect(getApi().settingsManagerDialogProps.presets.map((item) => item.name)).toEqual([
      "현재 설정 보관",
      "저장된 프리셋",
    ]);
    expect(getApi().pendingSettingsApply).toMatchObject({
      title: "\"저장된 프리셋\" 프리셋 적용",
      confirmLabel: "프리셋 적용",
      presetId: preset.id,
    });
    expect(trackPresetSaveMock).toHaveBeenCalledTimes(1);
  });

  it("imports selected presets from a settings bundle", async () => {
    const setMessage = vi.fn();
    const apiRef: { current: HookApi | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) {
        throw new Error("hook api is not ready");
      }
      return apiRef.current;
    };
    const profile = createDefaultProfile();
    const firstPreset = createSettingsPreset("첫 번째", profile);
    const secondPreset = createSettingsPreset("두 번째", profile);
    const bundle = serializeSettingsBundle(profile, [firstPreset, secondPreset]);
    const file = {
      name: "settings.json",
      text: vi.fn().mockResolvedValue(bundle),
    } as unknown as File;

    render(
      <Harness
        initialProfile={profile}
        resetSkillRuntime={vi.fn()}
        setMessage={setMessage}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    await act(async () => {
      await getApi().settingsManagerDialogProps.onImportSettings(file);
    });

    await waitFor(() => {
      expect(getApi().pendingSettingsPresetImport?.presets.map((preset) => preset.name)).toEqual([
        "첫 번째",
        "두 번째",
      ]);
    });

    act(() => {
      getApi().clearImportedSettingsPresetSelection();
    });
    expect(getApi().pendingSettingsPresetImport?.selectedPresetIds).toEqual([]);

    const importedFirstId = getApi().pendingSettingsPresetImport?.presets[0].id;
    if (!importedFirstId) {
      throw new Error("expected imported preset");
    }

    act(() => {
      getApi().toggleImportedSettingsPreset(importedFirstId, true);
    });
    expect(getApi().pendingSettingsPresetImport?.selectedPresetIds).toEqual([importedFirstId]);

    act(() => {
      getApi().confirmSettingsPresetImport();
    });

    await waitFor(() => {
      expect(getApi().pendingSettingsPresetImport).toBeNull();
    });
    expect(getApi().settingsManagerDialogProps.presets).toHaveLength(1);
    expect(getApi().settingsManagerDialogProps.presets[0].name).toBe("첫 번째");
    expect(setMessage).toHaveBeenCalledWith(
      "1개 프리셋을 불러왔습니다. 현재 설정에 반영하려면 적용을 눌러주세요.",
    );
    expect(trackPresetImportMock).toHaveBeenCalledWith(1);
  });

  it("applies a preset as one profile and runtime replacement transaction", async () => {
    const currentProfile = createDefaultProfile();
    currentProfile.masterVolume = 0.25;
    const targetProfile = createDefaultProfile();
    targetProfile.masterVolume = 0.8;
    targetProfile.buffExpiryAlert = {
      ...targetProfile.buffExpiryAlert!,
      enabled: true,
    };
    const currentPreset = createSettingsPreset("현재", currentProfile);
    const targetPreset = createSettingsPreset("대상", targetProfile);
    saveSettingsPresets([currentPreset, targetPreset]);

    const resetSkillRuntime = vi.fn();
    const setMessage = vi.fn();
    const transactionActions: SettingsTransactionActions = {
      clearAlertDisableSnapshotState: vi.fn(),
      resetRuneDetection: vi.fn(),
      resetHuntStallDetection: vi.fn(),
      resetBuffExpiryDetection: vi.fn(),
      resetBoosterExpiryDetection: vi.fn(),
      resetSpecialCoreDetection: vi.fn(),
      closeRegionPickers: vi.fn(),
    };
    const apiRef: { current: HookApi | null } = { current: null };
    const stateRef: { current: HarnessState | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) throw new Error("hook api is not ready");
      return apiRef.current;
    };

    render(
      <Harness
        initialProfile={currentProfile}
        resetSkillRuntime={resetSkillRuntime}
        setMessage={setMessage}
        transactionActions={transactionActions}
        initialLastAlertError="previous-error"
        onReady={(next, state) => {
          apiRef.current = next;
          stateRef.current = state;
        }}
      />,
    );

    await waitFor(() => {
      expect(getApi().settingsManagerDialogProps.presets).toHaveLength(2);
    });
    act(() => {
      getApi().settingsManagerDialogProps.onApplyPreset(targetPreset.id);
    });
    await waitFor(() => {
      expect(getApi().pendingSettingsApply?.presetId).toBe(targetPreset.id);
    });
    act(() => {
      getApi().confirmSettingsApply();
    });

    await waitFor(() => {
      expect(stateRef.current?.profile.masterVolume).toBe(0.8);
    });
    const appliedProfile = stateRef.current?.profile;
    expect(appliedProfile?.buffExpiryAlert?.enabled).toBe(true);
    expect(stateRef.current?.profileRef.current).toBe(appliedProfile);
    expect(resetSkillRuntime).toHaveBeenCalledWith(appliedProfile);
    for (const action of Object.values(transactionActions)) {
      expect(action).toHaveBeenCalledTimes(1);
    }
    expect(transactionActions.resetHuntStallDetection).toHaveBeenCalledWith(
      "preset-replaced",
    );
    expect(transactionActions.resetBoosterExpiryDetection).toHaveBeenCalledWith(
      "preset-replaced",
    );
    expect(stateRef.current?.lastAlertErrorRef.current).toBeNull();
    expect(getApi().pendingSettingsApply).toBeNull();
    expect(setMessage).toHaveBeenCalledWith("설정을 적용했습니다.");
  });

  it("resets settings through the same coordinated runtime cleanup", async () => {
    const profile = createDefaultProfile();
    profile.masterVolume = 0.41;
    const currentPreset = createSettingsPreset("현재", profile);
    saveSettingsPresets([currentPreset]);

    const resetSkillRuntime = vi.fn();
    const transactionActions: SettingsTransactionActions = {
      clearAlertDisableSnapshotState: vi.fn(),
      resetRuneDetection: vi.fn(),
      resetHuntStallDetection: vi.fn(),
      resetBuffExpiryDetection: vi.fn(),
      resetBoosterExpiryDetection: vi.fn(),
      resetSpecialCoreDetection: vi.fn(),
      closeRegionPickers: vi.fn(),
    };
    const apiRef: { current: HookApi | null } = { current: null };
    const stateRef: { current: HarnessState | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) throw new Error("hook api is not ready");
      return apiRef.current;
    };

    render(
      <Harness
        initialProfile={profile}
        resetSkillRuntime={resetSkillRuntime}
        setMessage={vi.fn()}
        transactionActions={transactionActions}
        initialLastAlertError="previous-error"
        onReady={(next, state) => {
          apiRef.current = next;
          stateRef.current = state;
        }}
      />,
    );

    await waitFor(() => {
      expect(getApi().settingsManagerDialogProps.presets).toHaveLength(1);
    });
    act(() => {
      getApi().settingsManagerDialogProps.onResetSettings();
    });

    await waitFor(() => {
      expect(stateRef.current?.profile.masterVolume).toBe(createDefaultProfile().masterVolume);
    });
    const resetProfile = stateRef.current?.profile;
    expect(stateRef.current?.profileRef.current).toBe(resetProfile);
    expect(resetSkillRuntime).toHaveBeenCalledWith(resetProfile);
    for (const action of Object.values(transactionActions)) {
      expect(action).toHaveBeenCalledTimes(1);
    }
    expect(transactionActions.resetBoosterExpiryDetection).toHaveBeenCalledWith(
      "profile-replaced",
    );
    expect(stateRef.current?.lastAlertErrorRef.current).toBeNull();
  });
});
