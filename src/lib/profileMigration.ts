import type { Profile } from "../types";
import { normalizeGeneralTimers } from "../domain/general-timer/generalTimers";
import { createDefaultProfile, createSkill } from "./profileFactory";
import {
  normalizeBuffExpiryAlert,
  normalizeBoosterExpiryAlert,
  normalizeHuntStallAlert,
  normalizeMasterVolume,
  normalizeRuneAlert,
  normalizeSpecialCoreAlert,
  normalizeUltimaRaidEquipmentAlert,
  normalizeVolume,
} from "./profileNormalization";
import { normalizeAlertSoundId } from "./sounds";
import { normalizePipTimerConfig } from "./pipTimerSettings";

export function normalizeStoredProfile(parsed: Profile): Profile {
  const defaultProfile = createDefaultProfile();
  const alertDefaults = {
    ...defaultProfile.alertDefaults,
    ...parsed.alertDefaults,
    volume: normalizeVolume(
      parsed.alertDefaults?.volume,
      defaultProfile.alertDefaults.volume,
    ),
    soundId: normalizeAlertSoundId(parsed.alertDefaults?.soundId),
  };

  return {
    ...defaultProfile,
    ...parsed,
    masterVolume: normalizeMasterVolume(parsed.masterVolume),
    skillAlertInitialJitterEnabled: parsed.skillAlertInitialJitterEnabled === true,
    alertDefaults,
    skills: Array.isArray(parsed.skills)
      ? parsed.skills.map((skill) =>
          createSkill({
            ...skill,
            volume: normalizeVolume(skill.volume, alertDefaults.volume),
          }),
        )
      : [],
    runeAlert: normalizeRuneAlert(parsed.runeAlert, alertDefaults.volume),
    ultimaRaidEquipmentAlert: normalizeUltimaRaidEquipmentAlert(
      parsed.ultimaRaidEquipmentAlert,
      alertDefaults.volume,
    ),
    huntStallAlert: normalizeHuntStallAlert(parsed.huntStallAlert, alertDefaults.volume),
    buffExpiryAlert: normalizeBuffExpiryAlert(parsed.buffExpiryAlert, alertDefaults.volume),
    boosterExpiryAlert: normalizeBoosterExpiryAlert(
      parsed.boosterExpiryAlert,
      alertDefaults.volume,
    ),
    specialCoreAlert: normalizeSpecialCoreAlert(parsed.specialCoreAlert, alertDefaults.volume),
    pipTimer: normalizePipTimerConfig(parsed.pipTimer),
    generalTimers: normalizeGeneralTimers(parsed.generalTimers),
  };
}
