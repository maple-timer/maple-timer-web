import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "../../lib/storage";
import { createSettingsPreset } from "./settingsPresets";
import {
  createImportedSettingsPresets,
  formatSettingsTimestamp,
  normalizeSettingsFileNameSegment,
} from "./settingsPresetFiles";

describe("settingsPresetFiles", () => {
  it("formats export timestamps with local date and time parts", () => {
    expect(formatSettingsTimestamp(new Date(2026, 4, 6, 7, 8, 9))).toBe("20260506-070809");
  });

  it("normalizes preset names for download file names", () => {
    expect(normalizeSettingsFileNameSegment("  보스/사냥:프리셋?  ")).toBe("보스사냥프리셋");
    expect(normalizeSettingsFileNameSegment("   ")).toBe("preset");
  });

  it("creates a profile preset from a profile-only import and avoids existing names", () => {
    const profile = createDefaultProfile();
    const existing = createSettingsPreset("사냥 설정", profile);

    const imported = createImportedSettingsPresets(profile, [], "사냥 설정.json", [existing]);

    expect(imported).toHaveLength(1);
    expect(imported[0].name).toBe("사냥 설정 (2)");
    expect(imported[0].profile).toEqual(existing.profile);
  });

  it("renames imported presets when names collide within the existing and imported lists", () => {
    const profile = createDefaultProfile();
    const existing = createSettingsPreset("본캐", profile);
    const firstImported = createSettingsPreset("본캐", profile);
    const secondImported = createSettingsPreset("본캐", profile);

    const imported = createImportedSettingsPresets(
      profile,
      [firstImported, secondImported],
      "ignored.json",
      [existing],
    );

    expect(imported.map((preset) => preset.name)).toEqual(["본캐 (2)", "본캐 (3)"]);
  });
});
