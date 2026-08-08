import type {
  BuffExpiryAlertConfig,
  BoosterExpiryAlertConfig,
  GeneralTimerConfig,
  HuntStallAlertConfig,
  Profile,
  RuneAlertConfig,
  SpecialCoreAlertConfig,
  SkillConfig,
  UltimaRaidEquipmentAlertConfig,
  UltimaRaidBossAlertConfig,
} from "../types";
import {
  createDefaultGeneralTimers,
  createGeneralTimer,
} from "../domain/general-timer/generalTimers";
import {
  getSkillPreset,
  clampRemainingCountAlertThreshold,
  inferSkillPresetId,
  isErdaFountainPresetId,
  isRemainingCountSkillPresetId,
  isSolJanusPresetId,
  normalizeLegacyBuffDurationPresetId,
  normalizeSkillPresetIdForSkill,
} from "./skillPresets";
import { getSkillBuffDurationTargetForPresetId } from "./skillBuffDuration/skillBuffDurationTargets";
import {
  DEFAULT_ALERT_SOUND_ID,
  DEFAULT_HUNT_STALL_ALERT_SOUND_ID,
  DEFAULT_RUNE_ALERT_SOUND_ID,
  DEFAULT_SPECIAL_CORE_ALERT_SOUND_ID,
  getErdaFountainAlertSounds,
  getSolJanusAlertSounds,
  normalizeAlertSoundIdForList,
  normalizeAlertSoundId,
} from "./sounds";
import { clampAlertThresholdSeconds } from "./timer";
import {
  DEFAULT_ALERT_THRESHOLD_SECONDS,
  DEFAULT_ALERT_VOLUME,
  DEFAULT_BOOSTER_EXPIRY_ALERT_LEAD_SECONDS,
  DEFAULT_HUNT_STALL_COOLDOWN_MISSING_THRESHOLD_SECONDS,
  DEFAULT_HUNT_STALL_THRESHOLD_SECONDS,
  PREVIOUS_SOL_JANUS_ALERT_SOUND_IDS,
} from "./profileStorageConstants";
import { DEFAULT_BUFF_EXPIRY_ALERT_LEAD_SECONDS } from "../domain/buff-expiry/alertLeadPolicy";
import {
  normalizeCountdownSource,
  normalizeSkillDetectionSource,
  normalizePositiveSeconds,
  normalizeRegionsByLayout,
  normalizeVolume,
} from "./profileNormalization";
import {
  DEFAULT_REPEAT_ALERT_INTERVAL_SECONDS,
  DEFAULT_REPEAT_ALERT_MAX_COUNT,
  normalizeRepeatAlertEnabled,
  normalizeRepeatAlertIntervalSeconds,
  normalizeRepeatAlertMaxCount,
} from "./repeatAlerts";
import { DEFAULT_MASTER_VOLUME } from "./volume";
import { SUPPORTED_BUFF_EXPIRY_BUFF_IDS } from "../domain/buff-expiry/catalog";
import { BUFF_EXPIRY_PRECISION_TARGET_GROUPS } from "../domain/buff-expiry/precisionTrackingPolicy";
import { createDefaultPipTimerConfig } from "./pipTimerSettings";
import {
  DEFAULT_SPECIAL_CORE_ALERT_LEAD_SECONDS,
  DEFAULT_SPECIAL_CORE_COOLDOWN_SECONDS,
} from "./specialCore/specialCoreAlertTypes";

export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

export function createSkill(partial: Partial<SkillConfig> = {}): SkillConfig {
  const hasExplicitPreset = "presetId" in partial;
  const normalizedPresetId = hasExplicitPreset
    ? normalizeSkillPresetIdForSkill({
        name: partial.name ?? "",
        presetId: partial.presetId,
        durationSeconds: partial.durationSeconds,
      })
    : inferSkillPresetId({
        name: partial.name ?? "",
        presetId: partial.presetId,
      });
  const presetId = normalizeLegacyBuffDurationPresetId(
    normalizedPresetId,
    partial.detectionSource,
  );
  const preset = getSkillPreset(presetId);
  const shouldUsePresetDuration = hasExplicitPreset && !preset.durationEditable;
  const durationSeconds = shouldUsePresetDuration
    ? preset.durationSeconds
    : partial.durationSeconds ?? (hasExplicitPreset ? preset.durationSeconds : 60);
  const defaultName = preset.defaultName ?? "새 스킬";
  const shouldUsePresetName = !partial.name;
  const buffDurationTarget = getSkillBuffDurationTargetForPresetId(presetId);
  const detectionSource = buffDurationTarget
    ? buffDurationTarget.quickslotSupported
      ? normalizeSkillDetectionSource(partial.detectionSource)
      : "buff-duration"
    : "quickslot";

  return {
    id: partial.id ?? createId("skill"),
    name: shouldUsePresetName ? defaultName : partial.name ?? defaultName,
    presetId,
    detectionSource,
    countdownSource: normalizeCountdownSource(
      partial.countdownSource ?? (hasExplicitPreset ? preset.countdownSource : "duration"),
    ),
    durationSeconds,
    cooldownDurationSeconds:
      normalizePositiveSeconds(partial.cooldownDurationSeconds) ?? preset.cooldownDurationSeconds,
    alertThresholdSeconds: isRemainingCountSkillPresetId(presetId)
      ? clampRemainingCountAlertThreshold(
          partial.alertThresholdSeconds ?? preset.defaultAlertThresholdSeconds ?? 3,
        )
      : clampAlertThresholdSeconds(
          partial.alertThresholdSeconds ?? DEFAULT_ALERT_THRESHOLD_SECONDS,
          { presetId },
        ),
    recognitionStartSeconds: partial.recognitionStartSeconds ?? 60,
    region: partial.region ?? null,
    regionsByLayout: normalizeRegionsByLayout(partial.regionsByLayout),
    recognitionMode: partial.recognitionMode ?? "digit-template",
    soundId: normalizeSkillAlertSoundId(
      partial.soundId,
      preset.id,
      preset.defaultSoundId ?? DEFAULT_ALERT_SOUND_ID,
    ),
    volume: normalizeVolume(partial.volume),
    repeatAlertEnabled: normalizeRepeatAlertEnabled(partial.repeatAlertEnabled),
    repeatAlertIntervalSeconds: normalizeRepeatAlertIntervalSeconds(
      partial.repeatAlertIntervalSeconds,
    ),
    repeatAlertMaxCount: normalizeRepeatAlertMaxCount(partial.repeatAlertMaxCount),
    repeat: partial.repeat,
    enabled: partial.enabled ?? true,
  };
}

function normalizeSkillAlertSoundId(
  soundId: string | undefined,
  presetId: SkillConfig["presetId"],
  fallbackSoundId: string,
): string {
  const candidate =
    PREVIOUS_SOL_JANUS_ALERT_SOUND_IDS.has(soundId ?? "") && fallbackSoundId
      ? fallbackSoundId
      : soundId ?? fallbackSoundId;

  if (isSolJanusPresetId(presetId)) {
    return normalizeAlertSoundIdForList(candidate, getSolJanusAlertSounds(), fallbackSoundId);
  }

  if (isErdaFountainPresetId(presetId)) {
    return normalizeAlertSoundIdForList(candidate, getErdaFountainAlertSounds(), fallbackSoundId);
  }

  return normalizeAlertSoundId(candidate);
}

export function createDefaultRuneAlert(): RuneAlertConfig {
  return {
    enabled: true,
    region: null,
    regionsByLayout: {},
    soundId: DEFAULT_RUNE_ALERT_SOUND_ID,
    volume: DEFAULT_ALERT_VOLUME,
    repeatAlertEnabled: false,
    repeatAlertIntervalSeconds: DEFAULT_REPEAT_ALERT_INTERVAL_SECONDS,
    repeatAlertMaxCount: null,
  };
}

export function createDefaultUltimaRaidEquipmentAlert(): UltimaRaidEquipmentAlertConfig {
  return {
    enabled: false,
    region: null,
    regionsByLayout: {},
    soundId: DEFAULT_ALERT_SOUND_ID,
    volume: DEFAULT_ALERT_VOLUME,
    repeatAlertEnabled: false,
    repeatAlertIntervalSeconds: DEFAULT_REPEAT_ALERT_INTERVAL_SECONDS,
    repeatAlertMaxCount: DEFAULT_REPEAT_ALERT_MAX_COUNT,
    bossAlert: createDefaultUltimaRaidBossAlert(),
  };
}

export function createDefaultUltimaRaidBossAlert(): UltimaRaidBossAlertConfig {
  return {
    enabled: false,
    soundId: DEFAULT_ALERT_SOUND_ID,
    volume: DEFAULT_ALERT_VOLUME,
    repeatAlertEnabled: false,
    repeatAlertIntervalSeconds: DEFAULT_REPEAT_ALERT_INTERVAL_SECONDS,
    repeatAlertMaxCount: DEFAULT_REPEAT_ALERT_MAX_COUNT,
  };
}

export function createDefaultHuntStallAlert(): HuntStallAlertConfig {
  return {
    enabled: false,
    mode: "manual-experience",
    stallThresholdSeconds: DEFAULT_HUNT_STALL_THRESHOLD_SECONDS,
    manualExperienceRegion: null,
    manualExperienceRegionsByLayout: {},
    cooldownRegion: null,
    cooldownRegionsByLayout: {},
    cooldownMissingThresholdSeconds: DEFAULT_HUNT_STALL_COOLDOWN_MISSING_THRESHOLD_SECONDS,
    soundId: DEFAULT_HUNT_STALL_ALERT_SOUND_ID,
    volume: DEFAULT_ALERT_VOLUME,
    repeatAlertEnabled: false,
    repeatAlertIntervalSeconds: DEFAULT_REPEAT_ALERT_INTERVAL_SECONDS,
    repeatAlertMaxCount: null,
  };
}

export function createDefaultBuffExpiryAlert(): BuffExpiryAlertConfig {
  return {
    enabled: false,
    alertLeadSeconds: DEFAULT_BUFF_EXPIRY_ALERT_LEAD_SECONDS,
    selectedBuffIds: [...SUPPORTED_BUFF_EXPIRY_BUFF_IDS],
    selectedPrecisionTargetGroups: [...BUFF_EXPIRY_PRECISION_TARGET_GROUPS],
    soundId: DEFAULT_ALERT_SOUND_ID,
    volume: DEFAULT_ALERT_VOLUME,
  };
}

export function createDefaultBoosterExpiryAlert(): BoosterExpiryAlertConfig {
  return {
    enabled: false,
    alertLeadSeconds: DEFAULT_BOOSTER_EXPIRY_ALERT_LEAD_SECONDS,
    soundId: DEFAULT_ALERT_SOUND_ID,
    volume: DEFAULT_ALERT_VOLUME,
  };
}

export function createDefaultSpecialCoreAlert(): SpecialCoreAlertConfig {
  return {
    enabled: false,
    cooldownSeconds: DEFAULT_SPECIAL_CORE_COOLDOWN_SECONDS,
    alertLeadSeconds: DEFAULT_SPECIAL_CORE_ALERT_LEAD_SECONDS,
    soundId: DEFAULT_SPECIAL_CORE_ALERT_SOUND_ID,
    volume: DEFAULT_ALERT_VOLUME,
  };
}

export function createDefaultGeneralTimer(partial: Partial<GeneralTimerConfig> = {}): GeneralTimerConfig {
  return createGeneralTimer(partial);
}

export function createDefaultProfile(): Profile {
  const now = new Date().toISOString();
  return {
    id: createId("profile"),
    name: "사냥 프로필",
    createdAt: now,
    updatedAt: now,
    captureHint: "window",
    displayMode: "center-large",
    skillAlertInitialJitterEnabled: false,
    skills: [
      createSkill({ presetId: "sol-janus-dawn-deep-v2" }),
      createSkill({ presetId: "erda-fountain-deep-v2" }),
    ],
    runeAlert: createDefaultRuneAlert(),
    ultimaRaidEquipmentAlert: createDefaultUltimaRaidEquipmentAlert(),
    huntStallAlert: createDefaultHuntStallAlert(),
    buffExpiryAlert: createDefaultBuffExpiryAlert(),
    boosterExpiryAlert: createDefaultBoosterExpiryAlert(),
    specialCoreAlert: createDefaultSpecialCoreAlert(),
    pipTimer: createDefaultPipTimerConfig(),
    generalTimers: createDefaultGeneralTimers(),
    masterVolume: DEFAULT_MASTER_VOLUME,
    alertDefaults: {
      volume: DEFAULT_ALERT_VOLUME,
      soundId: DEFAULT_ALERT_SOUND_ID,
    },
  };
}
