import type {
  BuffExpiryAlertConfig,
  BoosterExpiryAlertConfig,
  CountdownSource,
  HuntStallAlertConfig,
  RuneAlertConfig,
  SpecialCoreAlertConfig,
  SkillConfig,
  SkillDetectionSource,
  UltimaRaidEquipmentAlertConfig,
  UltimaRaidBossAlertConfig,
} from "../types";
import { hasUsableRegion, normalizeRegion } from "./regions";
import {
  DEFAULT_ALERT_VOLUME,
  DEFAULT_BOOSTER_EXPIRY_ALERT_LEAD_SECONDS,
  DEFAULT_HUNT_STALL_COOLDOWN_MISSING_THRESHOLD_SECONDS,
  DEFAULT_HUNT_STALL_THRESHOLD_SECONDS,
  MAX_BOOSTER_EXPIRY_ALERT_LEAD_SECONDS,
  MIN_BOOSTER_EXPIRY_ALERT_LEAD_SECONDS,
} from "./profileStorageConstants";
import {
  clampBuffExpiryAlertLeadSeconds,
  DEFAULT_BUFF_EXPIRY_ALERT_LEAD_SECONDS,
} from "../domain/buff-expiry/alertLeadPolicy";
import { clampAlertVolume, clampMasterVolume, DEFAULT_MASTER_VOLUME } from "./volume";
import {
  DEFAULT_HUNT_STALL_ALERT_SOUND_ID,
  DEFAULT_RUNE_ALERT_SOUND_ID,
  DEFAULT_SPECIAL_CORE_ALERT_SOUND_ID,
  getBuffExpiryAlertSounds,
  getHuntStallAlertSounds,
  getRuneAlertSounds,
  DEFAULT_ALERT_SOUND_ID,
  getBoosterExpiryAlertSounds,
  getSpecialCoreAlertSounds,
  normalizeAlertSoundId,
  normalizeAlertSoundIdForList,
} from "./sounds";
import {
  DEFAULT_REPEAT_ALERT_INTERVAL_SECONDS,
  DEFAULT_REPEAT_ALERT_MAX_COUNT,
  normalizeRepeatAlertEnabled,
  normalizeRepeatAlertIntervalSeconds,
  normalizeRepeatAlertMaxCount,
} from "./repeatAlerts";
import { normalizeBuffExpirySelectedBuffIds } from "../domain/buff-expiry/catalog";
import { normalizeBuffExpiryPrecisionTargetGroups } from "../domain/buff-expiry/precisionTrackingPolicy";
import {
  clampSpecialCoreAlertLeadSeconds,
  clampSpecialCoreCooldownSeconds,
} from "./specialCore/specialCoreAlertConfig";
import {
  DEFAULT_SPECIAL_CORE_ALERT_LEAD_SECONDS,
  DEFAULT_SPECIAL_CORE_COOLDOWN_SECONDS,
} from "./specialCore/specialCoreAlertTypes";

export function normalizeCountdownSource(value: unknown): CountdownSource {
  return value === "cooldown" ? "cooldown" : "duration";
}

export function normalizeSkillDetectionSource(value: unknown): SkillDetectionSource {
  return value === "buff-duration" ? "buff-duration" : "quickslot";
}

function normalizeHuntStallMode(value: unknown): HuntStallAlertConfig["mode"] {
  if (value === "cooldown-presence" || value === "manual-experience") {
    return value;
  }

  return "manual-experience";
}

const LEGACY_HUNT_STALL_COOLDOWN_MISSING_THRESHOLD_SECONDS = 12;

export function normalizePositiveSeconds(value: unknown): number | undefined {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? Math.round(next) : undefined;
}

export function normalizeVolume(value: unknown, fallback = DEFAULT_ALERT_VOLUME): number {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return fallback;
  }
  return clampAlertVolume(next, fallback);
}

export function normalizeMasterVolume(value: unknown): number {
  return clampMasterVolume(Number(value), DEFAULT_MASTER_VOLUME);
}

export function normalizeRegionsByLayout(value: unknown): SkillConfig["regionsByLayout"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, region]) => {
        if (!region || typeof region !== "object" || Array.isArray(region)) {
          return null;
        }

        const candidate = region as Partial<NonNullable<SkillConfig["region"]>>;
        const normalized = normalizeRegion({
          x: Number(candidate.x),
          y: Number(candidate.y),
          width: Number(candidate.width),
          height: Number(candidate.height),
        });

        return hasUsableRegion(normalized) ? [key, normalized] : null;
      })
      .filter((entry): entry is [string, NonNullable<SkillConfig["region"]>] => Boolean(entry)),
  );
}

export function normalizeRuneAlert(value: unknown, fallbackVolume = DEFAULT_ALERT_VOLUME): RuneAlertConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      enabled: true,
      region: null,
      regionsByLayout: {},
      soundId: DEFAULT_RUNE_ALERT_SOUND_ID,
      volume: fallbackVolume,
      repeatAlertEnabled: false,
      repeatAlertIntervalSeconds: DEFAULT_REPEAT_ALERT_INTERVAL_SECONDS,
      repeatAlertMaxCount: null,
    };
  }

  const partial = value as Partial<RuneAlertConfig>;
  return {
    enabled: partial.enabled ?? true,
    region: partial.region ?? null,
    regionsByLayout: normalizeRegionsByLayout(partial.regionsByLayout),
    soundId: normalizeAlertSoundIdForList(
      partial.soundId ?? DEFAULT_RUNE_ALERT_SOUND_ID,
      getRuneAlertSounds(),
      DEFAULT_RUNE_ALERT_SOUND_ID,
    ),
    volume: normalizeVolume(partial.volume, fallbackVolume),
    repeatAlertEnabled: normalizeRepeatAlertEnabled(partial.repeatAlertEnabled),
    repeatAlertIntervalSeconds: normalizeRepeatAlertIntervalSeconds(
      partial.repeatAlertIntervalSeconds,
    ),
    repeatAlertMaxCount: normalizeRepeatAlertMaxCount(partial.repeatAlertMaxCount),
  };
}

export function normalizeUltimaRaidEquipmentAlert(
  value: unknown,
  fallbackVolume = DEFAULT_ALERT_VOLUME,
): UltimaRaidEquipmentAlertConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      enabled: false,
      region: null,
      regionsByLayout: {},
      soundId: DEFAULT_ALERT_SOUND_ID,
      volume: fallbackVolume,
      repeatAlertEnabled: false,
      repeatAlertIntervalSeconds: DEFAULT_REPEAT_ALERT_INTERVAL_SECONDS,
      repeatAlertMaxCount: DEFAULT_REPEAT_ALERT_MAX_COUNT,
      bossAlert: normalizeUltimaRaidBossAlert(null, fallbackVolume),
    };
  }

  const partial = value as Partial<UltimaRaidEquipmentAlertConfig>;
  return {
    enabled: partial.enabled === true,
    region: partial.region ?? null,
    regionsByLayout: normalizeRegionsByLayout(partial.regionsByLayout),
    soundId: normalizeAlertSoundId(partial.soundId ?? DEFAULT_ALERT_SOUND_ID),
    volume: normalizeVolume(partial.volume, fallbackVolume),
    repeatAlertEnabled: normalizeRepeatAlertEnabled(
      partial.repeatAlertEnabled,
    ),
    repeatAlertIntervalSeconds: normalizeRepeatAlertIntervalSeconds(
      partial.repeatAlertIntervalSeconds,
    ),
    repeatAlertMaxCount:
      normalizeRepeatAlertMaxCount(
        partial.repeatAlertMaxCount,
        DEFAULT_REPEAT_ALERT_MAX_COUNT,
      ) ?? DEFAULT_REPEAT_ALERT_MAX_COUNT,
    bossAlert: normalizeUltimaRaidBossAlert(
      partial.bossAlert,
      fallbackVolume,
    ),
  };
}

export function normalizeUltimaRaidBossAlert(
  value: unknown,
  fallbackVolume = DEFAULT_ALERT_VOLUME,
): UltimaRaidBossAlertConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      enabled: false,
      soundId: DEFAULT_ALERT_SOUND_ID,
      volume: fallbackVolume,
      repeatAlertEnabled: false,
      repeatAlertIntervalSeconds: DEFAULT_REPEAT_ALERT_INTERVAL_SECONDS,
      repeatAlertMaxCount: DEFAULT_REPEAT_ALERT_MAX_COUNT,
    };
  }

  const partial = value as Partial<UltimaRaidBossAlertConfig>;
  return {
    enabled: partial.enabled === true,
    soundId: normalizeAlertSoundId(partial.soundId ?? DEFAULT_ALERT_SOUND_ID),
    volume: normalizeVolume(partial.volume, fallbackVolume),
    repeatAlertEnabled: normalizeRepeatAlertEnabled(
      partial.repeatAlertEnabled,
    ),
    repeatAlertIntervalSeconds: normalizeRepeatAlertIntervalSeconds(
      partial.repeatAlertIntervalSeconds,
    ),
    repeatAlertMaxCount:
      normalizeRepeatAlertMaxCount(
        partial.repeatAlertMaxCount,
        DEFAULT_REPEAT_ALERT_MAX_COUNT,
      ) ?? DEFAULT_REPEAT_ALERT_MAX_COUNT,
  };
}

export function normalizeHuntStallAlert(
  value: unknown,
  fallbackVolume = DEFAULT_ALERT_VOLUME,
): HuntStallAlertConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
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
      volume: fallbackVolume,
      repeatAlertEnabled: false,
      repeatAlertIntervalSeconds: DEFAULT_REPEAT_ALERT_INTERVAL_SECONDS,
      repeatAlertMaxCount: null,
    };
  }

  const partial = value as Partial<HuntStallAlertConfig>;
  const threshold =
    normalizePositiveSeconds(partial.stallThresholdSeconds) ?? DEFAULT_HUNT_STALL_THRESHOLD_SECONDS;
  const normalizedCooldownMissingThreshold =
    normalizePositiveSeconds(partial.cooldownMissingThresholdSeconds) ??
    DEFAULT_HUNT_STALL_COOLDOWN_MISSING_THRESHOLD_SECONDS;
  const cooldownMissingThreshold =
    normalizedCooldownMissingThreshold === LEGACY_HUNT_STALL_COOLDOWN_MISSING_THRESHOLD_SECONDS
      ? DEFAULT_HUNT_STALL_COOLDOWN_MISSING_THRESHOLD_SECONDS
      : normalizedCooldownMissingThreshold;
  return {
    enabled: partial.enabled ?? false,
    mode: normalizeHuntStallMode(partial.mode),
    stallThresholdSeconds: Math.min(120, Math.max(5, threshold)),
    manualExperienceRegion: hasUsableRegion(partial.manualExperienceRegion ?? null)
      ? normalizeRegion(partial.manualExperienceRegion!)
      : null,
    manualExperienceRegionsByLayout: normalizeRegionsByLayout(
      partial.manualExperienceRegionsByLayout,
    ),
    cooldownRegion: hasUsableRegion(partial.cooldownRegion ?? null)
      ? normalizeRegion(partial.cooldownRegion!)
      : null,
    cooldownRegionsByLayout: normalizeRegionsByLayout(partial.cooldownRegionsByLayout),
    cooldownMissingThresholdSeconds: Math.min(60, cooldownMissingThreshold),
    soundId: normalizeAlertSoundIdForList(
      partial.soundId ?? DEFAULT_HUNT_STALL_ALERT_SOUND_ID,
      getHuntStallAlertSounds(),
      DEFAULT_HUNT_STALL_ALERT_SOUND_ID,
    ),
    volume: normalizeVolume(partial.volume, fallbackVolume),
    repeatAlertEnabled: normalizeRepeatAlertEnabled(partial.repeatAlertEnabled),
    repeatAlertIntervalSeconds: normalizeRepeatAlertIntervalSeconds(
      partial.repeatAlertIntervalSeconds,
    ),
    repeatAlertMaxCount: normalizeRepeatAlertMaxCount(partial.repeatAlertMaxCount),
  };
}

export function normalizeBuffExpiryAlert(
  value: unknown,
  fallbackVolume = DEFAULT_ALERT_VOLUME,
): BuffExpiryAlertConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      enabled: false,
      alertLeadSeconds: DEFAULT_BUFF_EXPIRY_ALERT_LEAD_SECONDS,
      selectedBuffIds: normalizeBuffExpirySelectedBuffIds(undefined),
      selectedPrecisionTargetGroups: normalizeBuffExpiryPrecisionTargetGroups(undefined),
      soundId: DEFAULT_ALERT_SOUND_ID,
      volume: fallbackVolume,
    };
  }

  const partial = value as Partial<BuffExpiryAlertConfig>;
  const alertLeadSeconds = Number.isFinite(Number(partial.alertLeadSeconds))
    ? Number(partial.alertLeadSeconds)
    : DEFAULT_BUFF_EXPIRY_ALERT_LEAD_SECONDS;

  return {
    enabled: partial.enabled ?? false,
    alertLeadSeconds: clampBuffExpiryAlertLeadSeconds(alertLeadSeconds),
    selectedBuffIds: normalizeBuffExpirySelectedBuffIds(partial.selectedBuffIds),
    selectedPrecisionTargetGroups: normalizeBuffExpiryPrecisionTargetGroups(
      partial.selectedPrecisionTargetGroups,
    ),
    soundId: normalizeAlertSoundIdForList(
      partial.soundId ?? DEFAULT_ALERT_SOUND_ID,
      getBuffExpiryAlertSounds(),
      DEFAULT_ALERT_SOUND_ID,
    ),
    volume: normalizeVolume(partial.volume, fallbackVolume),
  };
}

export function normalizeBoosterExpiryAlert(
  value: unknown,
  fallbackVolume = DEFAULT_ALERT_VOLUME,
): BoosterExpiryAlertConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      enabled: false,
      alertLeadSeconds: DEFAULT_BOOSTER_EXPIRY_ALERT_LEAD_SECONDS,
      soundId: DEFAULT_ALERT_SOUND_ID,
      volume: fallbackVolume,
    };
  }

  const partial = value as Partial<BoosterExpiryAlertConfig>;
  const alertLeadSeconds =
    normalizePositiveSeconds(partial.alertLeadSeconds) ??
    DEFAULT_BOOSTER_EXPIRY_ALERT_LEAD_SECONDS;

  return {
    enabled: partial.enabled ?? false,
    alertLeadSeconds: Math.min(
      MAX_BOOSTER_EXPIRY_ALERT_LEAD_SECONDS,
      Math.max(MIN_BOOSTER_EXPIRY_ALERT_LEAD_SECONDS, alertLeadSeconds),
    ),
    soundId: normalizeAlertSoundIdForList(
      partial.soundId ?? DEFAULT_ALERT_SOUND_ID,
      getBoosterExpiryAlertSounds(),
      DEFAULT_ALERT_SOUND_ID,
    ),
    volume: normalizeVolume(partial.volume, fallbackVolume),
  };
}

export function normalizeSpecialCoreAlert(
  value: unknown,
  fallbackVolume = DEFAULT_ALERT_VOLUME,
): SpecialCoreAlertConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      enabled: false,
      cooldownSeconds: DEFAULT_SPECIAL_CORE_COOLDOWN_SECONDS,
      alertLeadSeconds: DEFAULT_SPECIAL_CORE_ALERT_LEAD_SECONDS,
      soundId: DEFAULT_SPECIAL_CORE_ALERT_SOUND_ID,
      volume: fallbackVolume,
    };
  }

  const partial = value as Partial<SpecialCoreAlertConfig>;
  return {
    enabled: partial.enabled ?? false,
    cooldownSeconds: clampSpecialCoreCooldownSeconds(partial.cooldownSeconds),
    alertLeadSeconds: clampSpecialCoreAlertLeadSeconds(partial.alertLeadSeconds),
    soundId: normalizeAlertSoundIdForList(
      partial.soundId ?? DEFAULT_SPECIAL_CORE_ALERT_SOUND_ID,
      getSpecialCoreAlertSounds(),
      DEFAULT_SPECIAL_CORE_ALERT_SOUND_ID,
    ),
    volume: normalizeVolume(partial.volume, fallbackVolume),
  };
}
