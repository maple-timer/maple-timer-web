import type { Profile } from "../../types";
import {
  createSettingsProfileSnapshot,
  type SettingsPresetSnapshot,
} from "./settingsTransfer";

const SETTINGS_PRESETS_KEY = "maple-timer.settings-presets.v1";
const SETTINGS_PRESETS_SCHEMA = "maple-timer.settings-presets";
const SETTINGS_PRESETS_VERSION = 1;

type StoredSettingsPresets = {
  schema: typeof SETTINGS_PRESETS_SCHEMA;
  version: number;
  presets: SettingsPresetSnapshot[];
};

export type SettingsPreset = SettingsPresetSnapshot;

export function loadSettingsPresets(): SettingsPreset[] {
  if (typeof localStorage === "undefined") {
    return [];
  }

  const raw = localStorage.getItem(SETTINGS_PRESETS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSettingsPresets> | SettingsPreset[];
    const presets = Array.isArray(parsed)
      ? parsed
      : parsed.schema === SETTINGS_PRESETS_SCHEMA && Array.isArray(parsed.presets)
        ? parsed.presets
        : [];
    return normalizePresetList(presets);
  } catch {
    return [];
  }
}

export function saveSettingsPresets(presets: SettingsPreset[]): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  const payload: StoredSettingsPresets = {
    schema: SETTINGS_PRESETS_SCHEMA,
    version: SETTINGS_PRESETS_VERSION,
    presets: normalizePresetList(presets),
  };
  try {
    localStorage.setItem(SETTINGS_PRESETS_KEY, JSON.stringify(payload));
  } catch {
    // Storage can fail in private browsing, quota exhaustion, or restricted environments.
  }
}

export function createSettingsPreset(name: string, profile: Profile): SettingsPreset {
  const now = new Date().toISOString();
  return {
    id: createPresetId(),
    name: normalizePresetName(name),
    createdAt: now,
    updatedAt: now,
    profile: createSettingsProfileSnapshot(profile),
  };
}

export function updateSettingsPresetProfile(
  preset: SettingsPreset,
  profile: Profile,
): SettingsPreset {
  return {
    ...preset,
    updatedAt: new Date().toISOString(),
    profile: createSettingsProfileSnapshot(profile),
  };
}

export function renameSettingsPreset(preset: SettingsPreset, name: string): SettingsPreset {
  return {
    ...preset,
    name: normalizePresetName(name),
    updatedAt: new Date().toISOString(),
  };
}

export function mergeSettingsPresets(
  current: SettingsPreset[],
  imported: SettingsPreset[],
): SettingsPreset[] {
  const merged = new Map<string, SettingsPreset>();
  for (const preset of current) {
    merged.set(preset.id, preset);
  }
  for (const preset of normalizePresetList(imported)) {
    merged.set(preset.id, preset);
  }
  return Array.from(merged.values()).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function findMatchingSettingsPreset(
  presets: SettingsPreset[],
  profile: Profile,
): SettingsPreset | null {
  return (
    normalizePresetList(presets).find((preset) =>
      profilesHaveSameSettings(preset.profile, profile),
    ) ?? null
  );
}

export function profilesHaveSameSettings(left: Profile, right: Profile): boolean {
  return createSettingsComparisonKey(left) === createSettingsComparisonKey(right);
}

function normalizePresetList(presets: unknown[]): SettingsPreset[] {
  return presets
    .map((preset) => normalizePreset(preset))
    .filter((preset): preset is SettingsPreset => Boolean(preset));
}

function normalizePreset(value: unknown): SettingsPreset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const preset = value as Partial<SettingsPreset>;
  if (!preset.profile || typeof preset.profile !== "object" || Array.isArray(preset.profile)) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: typeof preset.id === "string" && preset.id.trim() ? preset.id : createPresetId(),
    name: normalizePresetName(preset.name),
    createdAt:
      typeof preset.createdAt === "string" && preset.createdAt.trim() ? preset.createdAt : now,
    updatedAt:
      typeof preset.updatedAt === "string" && preset.updatedAt.trim() ? preset.updatedAt : now,
    profile: createSettingsProfileSnapshot(preset.profile),
  };
}

function normalizePresetName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed ? trimmed.slice(0, 60) : "새 프리셋";
}

function createSettingsComparisonKey(profile: Profile): string {
  const snapshot = createSettingsProfileSnapshot(profile);
  return JSON.stringify({
    ...snapshot,
    id: "",
    createdAt: "",
    updatedAt: "",
    skills: snapshot.skills.map((skill) => ({
      ...skill,
      id: "",
    })),
    generalTimers: (snapshot.generalTimers ?? []).map((timer) => ({
      ...timer,
      id: "",
    })),
  });
}

function createPresetId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `settings_preset_${crypto.randomUUID()}`;
  }
  return `settings_preset_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
