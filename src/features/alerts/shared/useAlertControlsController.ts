import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { SkillSnapshot } from "../../../alertTypes";
import {
  shouldResetBuffExpiryDetectionForPatch,
  shouldResetBoosterExpiryDetectionForPatch,
  shouldResetHuntStallDetectionForPatch,
  shouldResetRuneDetectionForPatch,
  shouldResetSpecialCoreDetectionForPatch,
  shouldResetUltimaRaidEquipmentDetectionForPatch,
  shouldRetimeSpecialCoreDetectionForPatch,
} from "../../../lib/alertConfigReset";
import type { AlertDisableSnapshot } from "../../../lib/alertDisableSnapshot";
import { trackFeatureToggle } from "../../../lib/analyticsEvents";
import {
  createDefaultBuffExpiryAlert,
  createDefaultBoosterExpiryAlert,
  createDefaultHuntStallAlert,
  createDefaultRuneAlert,
  createDefaultSpecialCoreAlert,
  createDefaultUltimaRaidEquipmentAlert,
} from "../../../lib/storage";
import {
  applySkillRuntimeSettingsPatch,
  shouldClearSkillSnapshotForSettingsPatch,
} from "../../../lib/skillRuntimeSettings";
import { createRuntimeState } from "../../../lib/timer";
import { clampMasterVolume } from "../../../lib/volume";
import type {
  GeneralTimerConfig,
  BoosterExpiryAlertConfig,
  BuffExpiryAlertConfig,
  HuntStallAlertConfig,
  Profile,
  RuneAlertConfig,
  SpecialCoreAlertConfig,
  SkillConfig,
  SkillRuntimeState,
  UltimaRaidEquipmentAlertConfig,
} from "../../../types";
import type { HuntStallIncidentResetReason } from "../../../runtime/hunt-stall/evidence/huntStallIncidentEvidenceTypes";
import type { BoosterExpiryIncidentResetReason } from "../../../runtime/booster-expiry/evidence/boosterExpiryIncidentEvidenceTypes";
import type { SpecialCoreIncidentResetReason } from "../../../runtime/special-core/evidence/specialCoreIncidentEvidenceTypes";

function getGeneralTimerRemainingSecondsAt(timer: GeneralTimerConfig, now: number): number {
  if (timer.endsAt !== null) {
    return Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
  }

  if (timer.remainingSecondsAtPause !== null) {
    return Math.max(0, timer.remainingSecondsAtPause);
  }

  return 0;
}

function isGeneralTimerRunningAt(timer: GeneralTimerConfig, now: number): boolean {
  return timer.enabled && timer.endsAt !== null && getGeneralTimerRemainingSecondsAt(timer, now) > 0;
}

/**
 * Restores one general timer from the global alert-disable snapshot.
 *
 * Disabling every alert pauses running timers instead of letting them run in
 * the background, so re-enabling has to resume exactly those timers with the
 * time they had left. Timers the user had already paused or finished stay as
 * they are; a timer whose end time passed while alerts were off is marked
 * alerted instead of firing late.
 */
function restoreGeneralTimerFromSnapshot(
  timer: GeneralTimerConfig,
  snapshot: AlertDisableSnapshot,
  restoredAt: number,
): GeneralTimerConfig {
  if (!Object.prototype.hasOwnProperty.call(snapshot.generalTimers ?? {}, timer.id)) {
    return timer;
  }

  const enabled = Boolean(snapshot.generalTimers?.[timer.id]);
  const wasRunning = Boolean(snapshot.generalTimerRunning?.[timer.id]);
  const remainingSecondsAtPause = timer.remainingSecondsAtPause;

  if (
    enabled &&
    wasRunning &&
    timer.endsAt === null &&
    remainingSecondsAtPause !== null &&
    remainingSecondsAtPause > 0
  ) {
    return {
      ...timer,
      enabled,
      startedAt: restoredAt,
      endsAt: restoredAt + remainingSecondsAtPause * 1000,
      remainingSecondsAtPause: null,
      alertedAt: null,
    };
  }

  return {
    ...timer,
    enabled,
    alertedAt:
      timer.endsAt !== null && timer.endsAt <= restoredAt && !timer.alertedAt
        ? restoredAt
        : timer.alertedAt,
  };
}

type UseAlertControlsControllerParams = {
  profileRef: MutableRefObject<Profile>;
  alertDisableSnapshotRef: MutableRefObject<AlertDisableSnapshot | null>;
  activateAlertDisableSnapshot: (snapshot: AlertDisableSnapshot) => void;
  clearAlertDisableSnapshotState: () => void;
  updateProfile: (updater: (current: Profile) => Profile) => void;
  updateSkill: (skillId: string, patch: Partial<SkillConfig>) => void;
  updateRuneAlert: (patch: Partial<RuneAlertConfig>) => void;
  updateUltimaRaidEquipmentAlert: (
    patch: Partial<UltimaRaidEquipmentAlertConfig>,
  ) => void;
  updateHuntStallAlert: (patch: Partial<HuntStallAlertConfig>) => void;
  updateBuffExpiryAlert: (patch: Partial<BuffExpiryAlertConfig>) => void;
  updateBoosterExpiryAlert: (patch: Partial<BoosterExpiryAlertConfig>) => void;
  updateSpecialCoreAlert: (patch: Partial<SpecialCoreAlertConfig>) => void;
  updateGeneralTimer: (timerId: string, patch: Partial<GeneralTimerConfig>) => void;
  runtimeRef: MutableRefObject<Record<string, SkillRuntimeState>>;
  setRuntimeStates: Dispatch<SetStateAction<Record<string, SkillRuntimeState>>>;
  setSnapshots: Dispatch<SetStateAction<Record<string, SkillSnapshot>>>;
  resetRuneDetection: () => void;
  resetUltimaRaidEquipmentDetection: () => void;
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
  retimeSpecialCoreDetection: (
    config: Pick<SpecialCoreAlertConfig, "cooldownSeconds" | "alertLeadSeconds">,
  ) => void;
  setMessage: (message: string) => void;
};

export function useAlertControlsController({
  profileRef,
  alertDisableSnapshotRef,
  activateAlertDisableSnapshot,
  clearAlertDisableSnapshotState,
  updateProfile,
  updateSkill,
  updateRuneAlert,
  updateUltimaRaidEquipmentAlert,
  updateHuntStallAlert,
  updateBuffExpiryAlert,
  updateBoosterExpiryAlert,
  updateSpecialCoreAlert,
  updateGeneralTimer,
  runtimeRef,
  setRuntimeStates,
  setSnapshots,
  resetRuneDetection,
  resetUltimaRaidEquipmentDetection,
  resetHuntStallDetection,
  resetBuffExpiryDetection,
  resetBoosterExpiryDetection,
  resetSpecialCoreDetection,
  retimeSpecialCoreDetection,
  setMessage,
}: UseAlertControlsControllerParams) {
  const updateMasterVolume = useCallback(
    (masterVolume: number) => {
      updateProfile((current) => ({
        ...current,
        masterVolume: clampMasterVolume(masterVolume),
      }));
    },
    [updateProfile],
  );

  const updateDefaultAlertVolume = useCallback(
    (volume: number) =>
      updateProfile((current) => ({
        ...current,
        alertDefaults: {
          ...current.alertDefaults,
          volume,
        },
      })),
    [updateProfile],
  );

  const changeSkill = useCallback(
    (skillId: string, patch: Partial<SkillConfig>) => {
      updateSkill(skillId, patch);
      if (typeof patch.enabled === "boolean") {
        trackFeatureToggle("skill", patch.enabled);
      }

      setRuntimeStates((previous) => {
        const previousState = previous[skillId] ?? createRuntimeState(skillId);
        const nextState = applySkillRuntimeSettingsPatch(
          previousState,
          skillId,
          patch,
          Date.now(),
        );

        if (nextState === previousState) {
          return previous;
        }

        const next = {
          ...previous,
          [skillId]: nextState,
        };
        runtimeRef.current = next;
        return next;
      });

      if (shouldClearSkillSnapshotForSettingsPatch(patch)) {
        setSnapshots((previous) => {
          if (!previous[skillId]) {
            return previous;
          }

          const next = { ...previous };
          delete next[skillId];
          return next;
        });
      }
    },
    [runtimeRef, setRuntimeStates, setSnapshots, updateSkill],
  );

  const changeRuneAlert = useCallback(
    (patch: Partial<RuneAlertConfig>) => {
      updateRuneAlert(patch);
      if (typeof patch.enabled === "boolean") {
        trackFeatureToggle("rune", patch.enabled);
      }
      if (shouldResetRuneDetectionForPatch(patch)) {
        resetRuneDetection();
      }
    },
    [resetRuneDetection, updateRuneAlert],
  );

  const changeUltimaRaidEquipmentAlert = useCallback(
    (patch: Partial<UltimaRaidEquipmentAlertConfig>) => {
      const currentConfig =
        profileRef.current.ultimaRaidEquipmentAlert ??
        createDefaultUltimaRaidEquipmentAlert();
      const equipmentEnabledChanged =
        typeof patch.enabled === "boolean" &&
        patch.enabled !== currentConfig.enabled;
      const bossEnabledChanged =
        typeof patch.bossAlert?.enabled === "boolean" &&
        patch.bossAlert.enabled !== currentConfig.bossAlert.enabled;
      updateUltimaRaidEquipmentAlert(patch);
      if (equipmentEnabledChanged) {
        trackFeatureToggle("ultima_raid_equipment", patch.enabled === true);
      }
      if (bossEnabledChanged && patch.bossAlert) {
        trackFeatureToggle(
          "ultima_raid_boss",
          patch.bossAlert.enabled === true,
        );
      }
      if (
        shouldResetUltimaRaidEquipmentDetectionForPatch(
          patch,
          currentConfig,
        )
      ) {
        resetUltimaRaidEquipmentDetection();
      }
    },
    [
      profileRef,
      resetUltimaRaidEquipmentDetection,
      updateUltimaRaidEquipmentAlert,
    ],
  );

  const changeHuntStallAlert = useCallback(
    (patch: Partial<HuntStallAlertConfig>) => {
      updateHuntStallAlert(patch);
      if (typeof patch.enabled === "boolean") {
        trackFeatureToggle("hunt_stall", patch.enabled);
      }
      if (shouldResetHuntStallDetectionForPatch(patch)) {
        resetHuntStallDetection(getHuntStallResetReasonForPatch(patch));
      }
    },
    [resetHuntStallDetection, updateHuntStallAlert],
  );

  const changeBuffExpiryAlert = useCallback(
    (patch: Partial<BuffExpiryAlertConfig>) => {
      updateBuffExpiryAlert(patch);
      if (typeof patch.enabled === "boolean") {
        trackFeatureToggle("buff_expiry", patch.enabled);
      }
      if (shouldResetBuffExpiryDetectionForPatch(patch)) {
        resetBuffExpiryDetection();
      }
    },
    [resetBuffExpiryDetection, updateBuffExpiryAlert],
  );

  const changeBoosterExpiryAlert = useCallback(
    (patch: Partial<BoosterExpiryAlertConfig>) => {
      updateBoosterExpiryAlert(patch);
      if (typeof patch.enabled === "boolean") {
        trackFeatureToggle("booster_expiry", patch.enabled);
      }
      if (shouldResetBoosterExpiryDetectionForPatch(patch)) {
        resetBoosterExpiryDetection();
      }
    },
    [resetBoosterExpiryDetection, updateBoosterExpiryAlert],
  );

  const changeSpecialCoreAlert = useCallback(
    (patch: Partial<SpecialCoreAlertConfig>) => {
      const previousConfig =
        profileRef.current.specialCoreAlert ?? createDefaultSpecialCoreAlert();
      const nextConfig = {
        ...previousConfig,
        ...patch,
      };
      updateSpecialCoreAlert(patch);
      if (typeof patch.enabled === "boolean") {
        trackFeatureToggle("special_core", patch.enabled);
      }
      if (shouldResetSpecialCoreDetectionForPatch(patch)) {
        resetSpecialCoreDetection(patch.enabled ? "enabled" : "disabled");
      } else if (shouldRetimeSpecialCoreDetectionForPatch(patch)) {
        retimeSpecialCoreDetection(nextConfig);
      }
    },
    [profileRef, resetSpecialCoreDetection, retimeSpecialCoreDetection, updateSpecialCoreAlert],
  );

  const changeGeneralTimer = useCallback(
    (timerId: string, patch: Partial<GeneralTimerConfig>) => {
      updateGeneralTimer(timerId, patch);
      if (typeof patch.enabled === "boolean") {
        trackFeatureToggle("general_timer", patch.enabled);
      }
    },
    [updateGeneralTimer],
  );

  const setAllAlertsDisabled = useCallback(
    (disabled: boolean) => {
      if (disabled) {
        if (alertDisableSnapshotRef.current) {
          return;
        }

        const currentProfile = profileRef.current;
        const currentRuneAlert = currentProfile.runeAlert ?? createDefaultRuneAlert();
        const currentUltimaRaidEquipmentAlert =
          currentProfile.ultimaRaidEquipmentAlert ??
          createDefaultUltimaRaidEquipmentAlert();
        const currentHuntStallAlert =
          currentProfile.huntStallAlert ?? createDefaultHuntStallAlert();
        const currentBuffExpiryAlert =
          currentProfile.buffExpiryAlert ?? createDefaultBuffExpiryAlert();
        const currentBoosterExpiryAlert =
          currentProfile.boosterExpiryAlert ?? createDefaultBoosterExpiryAlert();
        const currentSpecialCoreAlert =
          currentProfile.specialCoreAlert ?? createDefaultSpecialCoreAlert();
        const currentGeneralTimers = currentProfile.generalTimers ?? [];
        const disabledAt = Date.now();
        const snapshot: AlertDisableSnapshot = {
          skills: Object.fromEntries(
            currentProfile.skills.map((skill) => [skill.id, skill.enabled]),
          ),
          runeEnabled: currentRuneAlert.enabled,
          ultimaRaidEquipmentEnabled: currentUltimaRaidEquipmentAlert.enabled,
          ultimaRaidBossEnabled:
            currentUltimaRaidEquipmentAlert.bossAlert.enabled,
          huntStallEnabled: currentHuntStallAlert.enabled,
          buffExpiryEnabled: currentBuffExpiryAlert.enabled,
          boosterExpiryEnabled: currentBoosterExpiryAlert.enabled,
          specialCoreEnabled: currentSpecialCoreAlert.enabled,
          generalTimers: Object.fromEntries(
            currentGeneralTimers.map((timer) => [timer.id, timer.enabled]),
          ),
          generalTimerRunning: Object.fromEntries(
            currentGeneralTimers.map((timer) => [
              timer.id,
              isGeneralTimerRunningAt(timer, disabledAt),
            ]),
          ),
          createdAt: disabledAt,
        };
        activateAlertDisableSnapshot(snapshot);
        updateProfile((current) => ({
          ...current,
          skills: current.skills.map((skill) =>
            skill.enabled ? { ...skill, enabled: false } : skill,
          ),
          runeAlert: {
            ...createDefaultRuneAlert(),
            ...(current.runeAlert ?? {}),
            enabled: false,
          },
          ultimaRaidEquipmentAlert: {
            ...createDefaultUltimaRaidEquipmentAlert(),
            ...(current.ultimaRaidEquipmentAlert ?? {}),
            enabled: false,
            bossAlert: {
              ...createDefaultUltimaRaidEquipmentAlert().bossAlert,
              ...(current.ultimaRaidEquipmentAlert?.bossAlert ?? {}),
              enabled: false,
            },
          },
          huntStallAlert: {
            ...createDefaultHuntStallAlert(),
            ...(current.huntStallAlert ?? {}),
            enabled: false,
          },
          buffExpiryAlert: {
            ...createDefaultBuffExpiryAlert(),
            ...(current.buffExpiryAlert ?? {}),
            enabled: false,
          },
          boosterExpiryAlert: {
            ...createDefaultBoosterExpiryAlert(),
            ...(current.boosterExpiryAlert ?? {}),
            enabled: false,
          },
          specialCoreAlert: {
            ...createDefaultSpecialCoreAlert(),
            ...(current.specialCoreAlert ?? {}),
            enabled: false,
          },
          generalTimers: (current.generalTimers ?? []).map((timer) => {
            const remainingSeconds = getGeneralTimerRemainingSecondsAt(timer, disabledAt);
            const wasRunning = isGeneralTimerRunningAt(timer, disabledAt);
            return {
              ...timer,
              enabled: false,
              ...(wasRunning
                ? {
                    endsAt: null,
                    remainingSecondsAtPause: remainingSeconds,
                  }
                : {}),
            };
          }),
        }));
        setMessage("모든 알림을 비활성화했습니다.");
      } else {
        const snapshot = alertDisableSnapshotRef.current;
        if (!snapshot) {
          return;
        }

        clearAlertDisableSnapshotState();
        const restoredAt = Date.now();
        updateProfile((current) => ({
          ...current,
          skills: current.skills.map((skill) =>
            Object.prototype.hasOwnProperty.call(snapshot.skills, skill.id)
              ? { ...skill, enabled: snapshot.skills[skill.id] }
              : skill,
          ),
          runeAlert: {
            ...createDefaultRuneAlert(),
            ...(current.runeAlert ?? {}),
            enabled: snapshot.runeEnabled,
          },
          ultimaRaidEquipmentAlert: {
            ...createDefaultUltimaRaidEquipmentAlert(),
            ...(current.ultimaRaidEquipmentAlert ?? {}),
            enabled: snapshot.ultimaRaidEquipmentEnabled ?? false,
            bossAlert: {
              ...createDefaultUltimaRaidEquipmentAlert().bossAlert,
              ...(current.ultimaRaidEquipmentAlert?.bossAlert ?? {}),
              enabled: snapshot.ultimaRaidBossEnabled ?? false,
            },
          },
          huntStallAlert: {
            ...createDefaultHuntStallAlert(),
            ...(current.huntStallAlert ?? {}),
            enabled: snapshot.huntStallEnabled ?? false,
          },
          buffExpiryAlert: {
            ...createDefaultBuffExpiryAlert(),
            ...(current.buffExpiryAlert ?? {}),
            enabled: snapshot.buffExpiryEnabled ?? false,
          },
          boosterExpiryAlert: {
            ...createDefaultBoosterExpiryAlert(),
            ...(current.boosterExpiryAlert ?? {}),
            enabled: snapshot.boosterExpiryEnabled ?? false,
          },
          specialCoreAlert: {
            ...createDefaultSpecialCoreAlert(),
            ...(current.specialCoreAlert ?? {}),
            enabled: snapshot.specialCoreEnabled ?? false,
          },
          generalTimers: (current.generalTimers ?? []).map((timer) =>
            restoreGeneralTimerFromSnapshot(timer, snapshot, restoredAt),
          ),
        }));
        setMessage("비활성화 전 상태로 복구했습니다.");
      }

      trackFeatureToggle("all_alerts", !disabled);

      setRuntimeStates((previous) => {
        const next = Object.fromEntries(
          profileRef.current.skills.map((skill) => [
            skill.id,
            disabled
              ? {
                  ...(previous[skill.id] ?? createRuntimeState(skill.id)),
                  status: "paused" as const,
                  pendingShortAnchor: null,
                }
              : createRuntimeState(skill.id),
          ]),
        );
        runtimeRef.current = next;
        return next;
      });
      setSnapshots({});
      resetRuneDetection();
      resetUltimaRaidEquipmentDetection();
      resetHuntStallDetection(disabled ? "global-disabled" : "enabled");
      resetBuffExpiryDetection();
      resetBoosterExpiryDetection(disabled ? "global-disabled" : "enabled");
      resetSpecialCoreDetection(disabled ? "global-disabled" : "enabled");
    },
    [
      activateAlertDisableSnapshot,
      alertDisableSnapshotRef,
      clearAlertDisableSnapshotState,
      profileRef,
      resetHuntStallDetection,
      resetBuffExpiryDetection,
      resetBoosterExpiryDetection,
      resetSpecialCoreDetection,
      resetRuneDetection,
      resetUltimaRaidEquipmentDetection,
      runtimeRef,
      setMessage,
      setRuntimeStates,
      setSnapshots,
      updateProfile,
    ],
  );

  return {
    updateMasterVolume,
    updateDefaultAlertVolume,
    changeSkill,
    changeRuneAlert,
    changeUltimaRaidEquipmentAlert,
    changeHuntStallAlert,
    changeBuffExpiryAlert,
    changeBoosterExpiryAlert,
    changeSpecialCoreAlert,
    changeGeneralTimer,
    setAllAlertsDisabled,
  };
}

function getHuntStallResetReasonForPatch(
  patch: Partial<HuntStallAlertConfig>,
): Exclude<HuntStallIncidentResetReason, "initialized"> {
  if (typeof patch.enabled === "boolean") {
    return patch.enabled ? "enabled" : "disabled";
  }
  if ("mode" in patch) {
    return "mode-changed";
  }
  if (
    "manualExperienceRegion" in patch ||
    "manualExperienceRegionsByLayout" in patch ||
    "cooldownRegion" in patch ||
    "cooldownRegionsByLayout" in patch
  ) {
    return "region-changed";
  }
  return "profile-replaced";
}
