import { useCallback, useEffect, useRef, useState } from "react";
import type { ProfileRepository } from "../../application/profile/profileRepository";
import {
  createDefaultBuffExpiryAlert,
  createDefaultBoosterExpiryAlert,
  createDefaultHuntStallAlert,
  createDefaultGeneralTimer,
  createDefaultPipTimerConfig,
  createDefaultRuneAlert,
  createDefaultSpecialCoreAlert,
  createDefaultUltimaRaidEquipmentAlert,
} from "../../lib/storage";
import type {
  BuffExpiryAlertConfig,
  BoosterExpiryAlertConfig,
  GeneralTimerConfig,
  HuntStallAlertConfig,
  PipTimerConfig,
  Profile,
  RuneAlertConfig,
  SpecialCoreAlertConfig,
  SkillConfig,
  UltimaRaidEquipmentAlertConfig,
} from "../../types";

export function useProfileState(profileRepository: ProfileRepository) {
  const [profile, setProfile] = useState<Profile>(() => profileRepository.load());
  const profileRef = useRef(profile);

  useEffect(() => {
    profileRef.current = profile;
    profileRepository.save(profile);
  }, [profile, profileRepository]);

  const updateProfile = useCallback((updater: (current: Profile) => Profile) => {
    setProfile((current) => ({
      ...updater(current),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const updateSkill = useCallback(
    (skillId: string, patch: Partial<SkillConfig>) => {
      updateProfile((current) => ({
        ...current,
        skills: current.skills.map((skill) =>
          skill.id === skillId ? { ...skill, ...patch } : skill,
        ),
      }));
    },
    [updateProfile],
  );

  const updateRuneAlert = useCallback(
    (patch: Partial<RuneAlertConfig>) => {
      updateProfile((current) => ({
        ...current,
        runeAlert: {
          ...createDefaultRuneAlert(),
          ...(current.runeAlert ?? {}),
          ...patch,
        },
      }));
    },
    [updateProfile],
  );

  const updateUltimaRaidEquipmentAlert = useCallback(
    (patch: Partial<UltimaRaidEquipmentAlertConfig>) => {
      updateProfile((current) => ({
        ...current,
        ultimaRaidEquipmentAlert: {
          ...createDefaultUltimaRaidEquipmentAlert(),
          ...(current.ultimaRaidEquipmentAlert ?? {}),
          ...patch,
        },
      }));
    },
    [updateProfile],
  );

  const updateHuntStallAlert = useCallback(
    (patch: Partial<HuntStallAlertConfig>) => {
      updateProfile((current) => ({
        ...current,
        huntStallAlert: {
          ...createDefaultHuntStallAlert(),
          ...(current.huntStallAlert ?? {}),
          ...patch,
        },
      }));
    },
    [updateProfile],
  );

  const updateBuffExpiryAlert = useCallback(
    (patch: Partial<BuffExpiryAlertConfig>) => {
      updateProfile((current) => ({
        ...current,
        buffExpiryAlert: {
          ...createDefaultBuffExpiryAlert(),
          ...(current.buffExpiryAlert ?? {}),
          ...patch,
        },
      }));
    },
    [updateProfile],
  );

  const updateBoosterExpiryAlert = useCallback(
    (patch: Partial<BoosterExpiryAlertConfig>) => {
      updateProfile((current) => ({
        ...current,
        boosterExpiryAlert: {
          ...createDefaultBoosterExpiryAlert(),
          ...(current.boosterExpiryAlert ?? {}),
          ...patch,
        },
      }));
    },
    [updateProfile],
  );

  const updateSpecialCoreAlert = useCallback(
    (patch: Partial<SpecialCoreAlertConfig>) => {
      updateProfile((current) => ({
        ...current,
        specialCoreAlert: {
          ...createDefaultSpecialCoreAlert(),
          ...(current.specialCoreAlert ?? {}),
          ...patch,
        },
      }));
    },
    [updateProfile],
  );

  const updatePipTimer = useCallback(
    (patch: Partial<PipTimerConfig>) => {
      updateProfile((current) => ({
        ...current,
        pipTimer: {
          ...createDefaultPipTimerConfig(),
          ...(current.pipTimer ?? {}),
          ...patch,
        },
      }));
    },
    [updateProfile],
  );

  const addGeneralTimer = useCallback(() => {
    const timer = createDefaultGeneralTimer();
    updateProfile((current) => ({
      ...current,
      generalTimers: [...(current.generalTimers ?? []), timer],
    }));
    return timer.id;
  }, [updateProfile]);

  const updateGeneralTimer = useCallback(
    (timerId: string, patch: Partial<GeneralTimerConfig>) => {
      updateProfile((current) => ({
        ...current,
        generalTimers: (current.generalTimers ?? []).map((timer) =>
          timer.id === timerId ? { ...timer, ...patch } : timer,
        ),
      }));
    },
    [updateProfile],
  );

  const removeGeneralTimer = useCallback(
    (timerId: string) => {
      updateProfile((current) => ({
        ...current,
        generalTimers: (current.generalTimers ?? []).filter((timer) => timer.id !== timerId),
      }));
    },
    [updateProfile],
  );

  return {
    profile,
    setProfile,
    profileRef,
    updateProfile,
    updateSkill,
    updateRuneAlert,
    updateUltimaRaidEquipmentAlert,
    updateHuntStallAlert,
    updateBuffExpiryAlert,
    updateBoosterExpiryAlert,
    updateSpecialCoreAlert,
    updatePipTimer,
    addGeneralTimer,
    updateGeneralTimer,
    removeGeneralTimer,
  };
}
