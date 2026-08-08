import type { Profile } from "../../types";
import { createSettingsPreset, type SettingsPreset } from "./settingsPresets";

export function formatSettingsTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export function downloadSettingsJson(fileName: string, json: string) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function createImportedSettingsPresets(
  profile: Profile,
  importedPresets: SettingsPreset[],
  fileName: string,
  existingPresets: SettingsPreset[],
): SettingsPreset[] {
  const usedNames = new Set(existingPresets.map((preset) => preset.name));
  const imported: SettingsPreset[] = [];

  if (importedPresets.length === 0) {
    const profilePresetName = createUniquePresetName(
      normalizeImportedPresetName(fileName.replace(/\.json$/i, "")),
      usedNames,
    );
    imported.push(createSettingsPreset(profilePresetName, profile));
    return imported;
  }

  for (const preset of importedPresets) {
    const presetName = createUniquePresetName(normalizeImportedPresetName(preset.name), usedNames);
    imported.push(createSettingsPreset(presetName, preset.profile));
  }

  return imported;
}

export function normalizeSettingsFileNameSegment(name: string): string {
  const normalized = name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[\\/:*?"<>|]+/g, "")
    .slice(0, 40);
  return normalized || "preset";
}

function createUniquePresetName(preferredName: string, usedNames: Set<string>): string {
  const baseName = normalizeImportedPresetName(preferredName);
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName);
    return baseName;
  }

  for (let index = 2; index < 1000; index += 1) {
    const suffix = ` (${index})`;
    const candidate = `${baseName.slice(0, 60 - suffix.length)}${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }

  const fallback = `${baseName.slice(0, 47)} (${Date.now().toString(36)})`;
  usedNames.add(fallback);
  return fallback;
}

function normalizeImportedPresetName(name: unknown): string {
  const normalized = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  return (normalized || "불러온 설정").slice(0, 60);
}
