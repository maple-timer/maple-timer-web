import type { GeneralTimerConfig, Profile } from "../../types";
import { normalizeStoredProfile } from "../../lib/profileMigration";

export const SETTINGS_BUNDLE_SCHEMA = "maple-timer.settings";
export const SETTINGS_BUNDLE_VERSION = 1;

export type SettingsPresetSnapshot = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  profile: Profile;
};

export type SettingsBundle = {
  schema: typeof SETTINGS_BUNDLE_SCHEMA;
  version: number;
  exportedAt: string;
  data: {
    profile: Profile;
    presets?: SettingsPresetSnapshot[];
  };
};

export type SettingsImportSuccess = {
  ok: true;
  profile: Profile;
  presets: SettingsPresetSnapshot[];
  warnings: string[];
};

export type SettingsImportFailure = {
  ok: false;
  error: string;
};

export type SettingsImportResult = SettingsImportSuccess | SettingsImportFailure;

export function createSettingsProfileSnapshot(profile: Profile): Profile {
  const normalized = normalizeStoredProfile(profile);
  return {
    ...normalized,
    generalTimers: (normalized.generalTimers ?? []).map(stripGeneralTimerRuntime),
  };
}

export function createSettingsBundle(
  profile: Profile,
  presets: SettingsPresetSnapshot[] = [],
  now = new Date(),
): SettingsBundle {
  return {
    schema: SETTINGS_BUNDLE_SCHEMA,
    version: SETTINGS_BUNDLE_VERSION,
    exportedAt: now.toISOString(),
    data: {
      profile: createSettingsProfileSnapshot(profile),
      presets: presets.map((preset) => ({
        ...preset,
        profile: createSettingsProfileSnapshot(preset.profile),
      })),
    },
  };
}

export function serializeSettingsBundle(
  profile: Profile,
  presets: SettingsPresetSnapshot[] = [],
): string {
  return `${JSON.stringify(createSettingsBundle(profile, presets), null, 2)}\n`;
}

export function parseSettingsBundle(raw: string): SettingsImportResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "JSON 파일을 읽지 못했습니다." };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: "설정 파일 형식이 올바르지 않습니다." };
  }

  const warnings: string[] = [];
  if (parsed.schema === SETTINGS_BUNDLE_SCHEMA) {
    const version = Number(parsed.version);
    if (!Number.isFinite(version) || version < 1) {
      return { ok: false, error: "지원하지 않는 설정 파일 버전입니다." };
    }
    if (version > SETTINGS_BUNDLE_VERSION) {
      warnings.push("현재 앱보다 새로운 버전의 설정 파일입니다. 아는 값만 불러옵니다.");
    }

    const data = parsed.data;
    if (!isPlainObject(data) || !isPlainObject(data.profile)) {
      return { ok: false, error: "설정 파일 안에 프로필 정보가 없습니다." };
    }

    return {
      ok: true,
      profile: createSettingsProfileSnapshot(data.profile as Profile),
      presets: normalizeImportedPresets(data.presets),
      warnings,
    };
  }

  if (looksLikeProfile(parsed)) {
    warnings.push("직접 저장한 프로필 JSON으로 판단해 불러옵니다.");
    return {
      ok: true,
      profile: createSettingsProfileSnapshot(parsed as Profile),
      presets: [],
      warnings,
    };
  }

  return { ok: false, error: "Maple Timer 설정 파일이 아닙니다." };
}

export function getSettingsBundleSummary(profile: Profile, presets: SettingsPresetSnapshot[] = []) {
  return {
    skillCount: profile.skills.length,
    presetCount: presets.length,
    generalTimerCount: profile.generalTimers?.length ?? 0,
    hasRuneAlert: Boolean(profile.runeAlert),
    hasUltimaRaidEquipmentAlert: Boolean(profile.ultimaRaidEquipmentAlert),
    hasHuntStallAlert: Boolean(profile.huntStallAlert),
    hasBuffExpiryAlert: Boolean(profile.buffExpiryAlert),
    hasBoosterExpiryAlert: Boolean(profile.boosterExpiryAlert),
  };
}

function stripGeneralTimerRuntime(timer: GeneralTimerConfig): GeneralTimerConfig {
  return {
    ...timer,
    startedAt: null,
    endsAt: null,
    remainingSecondsAtPause: null,
    alertedAt: null,
  };
}

function normalizeImportedPresets(value: unknown): SettingsPresetSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((preset) => normalizeImportedPreset(preset))
    .filter((preset): preset is SettingsPresetSnapshot => Boolean(preset));
}

function normalizeImportedPreset(value: unknown): SettingsPresetSnapshot | null {
  if (!isPlainObject(value) || !isPlainObject(value.profile)) {
    return null;
  }

  const now = new Date().toISOString();
  const id = typeof value.id === "string" && value.id.trim() ? value.id : createSettingsId("preset");
  const name =
    typeof value.name === "string" && value.name.trim()
      ? value.name.trim().slice(0, 60)
      : "가져온 프리셋";
  const createdAt =
    typeof value.createdAt === "string" && value.createdAt.trim() ? value.createdAt : now;
  const updatedAt =
    typeof value.updatedAt === "string" && value.updatedAt.trim() ? value.updatedAt : now;

  return {
    id,
    name,
    createdAt,
    updatedAt,
    profile: createSettingsProfileSnapshot(value.profile as Profile),
  };
}

function looksLikeProfile(value: Record<string, unknown>): boolean {
  return Array.isArray(value.skills) && isPlainObject(value.alertDefaults);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function createSettingsId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
