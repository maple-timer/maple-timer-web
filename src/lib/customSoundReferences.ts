import type { Profile } from "../types";
import { createCustomAlertSoundId, isCustomAlertSoundId } from "./customSoundIds";
import { DEFAULT_ALERT_SOUND_ID } from "./sounds";

export type CustomAlertSoundReference = {
  soundId: string;
  label: string;
};

export type MissingCustomAlertSoundReference = {
  soundId: string;
  labels: string[];
};

export function replaceCustomAlertSoundReferences(
  profile: Profile,
  customSoundId: string,
  fallbackSoundId = DEFAULT_ALERT_SOUND_ID,
): { profile: Profile; replacedCount: number } {
  let replacedCount = 0;
  const replaceSoundId = (soundId: string) => {
    if (soundId !== customSoundId) {
      return soundId;
    }
    replacedCount += 1;
    return fallbackSoundId;
  };

  const nextProfile: Profile = {
    ...profile,
    alertDefaults: {
      ...profile.alertDefaults,
      soundId: replaceSoundId(profile.alertDefaults.soundId),
    },
    skills: profile.skills.map((skill) => ({
      ...skill,
      soundId: replaceSoundId(skill.soundId),
    })),
    runeAlert: profile.runeAlert
      ? {
          ...profile.runeAlert,
          soundId: replaceSoundId(profile.runeAlert.soundId),
        }
      : profile.runeAlert,
    ultimaRaidEquipmentAlert: profile.ultimaRaidEquipmentAlert
      ? {
          ...profile.ultimaRaidEquipmentAlert,
          soundId: replaceSoundId(profile.ultimaRaidEquipmentAlert.soundId),
          bossAlert: {
            ...profile.ultimaRaidEquipmentAlert.bossAlert,
            soundId: replaceSoundId(
              profile.ultimaRaidEquipmentAlert.bossAlert.soundId,
            ),
          },
        }
      : profile.ultimaRaidEquipmentAlert,
    huntStallAlert: profile.huntStallAlert
      ? {
          ...profile.huntStallAlert,
          soundId: replaceSoundId(profile.huntStallAlert.soundId),
        }
      : profile.huntStallAlert,
    buffExpiryAlert: profile.buffExpiryAlert
      ? {
          ...profile.buffExpiryAlert,
          soundId: replaceSoundId(profile.buffExpiryAlert.soundId),
        }
      : profile.buffExpiryAlert,
    boosterExpiryAlert: profile.boosterExpiryAlert
      ? {
          ...profile.boosterExpiryAlert,
          soundId: replaceSoundId(profile.boosterExpiryAlert.soundId),
        }
      : profile.boosterExpiryAlert,
    generalTimers: profile.generalTimers?.map((timer) => ({
      ...timer,
      soundId: replaceSoundId(timer.soundId),
    })),
  };

  return { profile: nextProfile, replacedCount };
}

export function replaceMissingCustomAlertSoundReferences(
  profile: Profile,
  missingCustomSoundIds: Iterable<string>,
  fallbackSoundId = DEFAULT_ALERT_SOUND_ID,
): { profile: Profile; replacedCount: number } {
  let nextProfile = profile;
  let replacedCount = 0;

  for (const soundId of missingCustomSoundIds) {
    const result = replaceCustomAlertSoundReferences(nextProfile, soundId, fallbackSoundId);
    nextProfile = result.profile;
    replacedCount += result.replacedCount;
  }

  return { profile: nextProfile, replacedCount };
}

export function collectCustomAlertSoundReferences(profile: Profile): CustomAlertSoundReference[] {
  const references: CustomAlertSoundReference[] = [];
  const collect = (soundId: string | null | undefined, label: string) => {
    if (isCustomAlertSoundId(soundId)) {
      references.push({ soundId, label });
    }
  };

  collect(profile.alertDefaults.soundId, "기본 알림음");
  profile.skills.forEach((skill) => collect(skill.soundId, `스킬: ${skill.name}`));
  collect(profile.runeAlert?.soundId, "룬 알림");
  collect(profile.ultimaRaidEquipmentAlert?.soundId, "울티마 스쿼드 장비 알림");
  collect(
    profile.ultimaRaidEquipmentAlert?.bossAlert.soundId,
    "울티마 스쿼드 보스 등장 알림",
  );
  collect(profile.huntStallAlert?.soundId, "사냥 멈춤 알림");
  collect(profile.buffExpiryAlert?.soundId, "버프 종료 알림");
  collect(profile.boosterExpiryAlert?.soundId, "부스터 종료 알림");
  profile.generalTimers?.forEach((timer, index) =>
    collect(timer.soundId, `일반 타이머 ${index + 1}`),
  );

  return references;
}

export function findMissingCustomAlertSoundReferences(
  profile: Profile,
  availableCustomSoundIds: Iterable<string>,
): MissingCustomAlertSoundReference[] {
  const availableIds = new Set(
    Array.from(availableCustomSoundIds, (soundId) =>
      isCustomAlertSoundId(soundId) ? soundId : createCustomAlertSoundId(soundId),
    ),
  );
  const missingById = new Map<string, string[]>();

  for (const reference of collectCustomAlertSoundReferences(profile)) {
    if (availableIds.has(reference.soundId)) {
      continue;
    }
    const labels = missingById.get(reference.soundId) ?? [];
    labels.push(reference.label);
    missingById.set(reference.soundId, labels);
  }

  return Array.from(missingById, ([soundId, labels]) => ({ soundId, labels }));
}
