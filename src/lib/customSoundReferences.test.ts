import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "./storage";
import {
  collectCustomAlertSoundReferences,
  findMissingCustomAlertSoundReferences,
  replaceCustomAlertSoundReferences,
  replaceMissingCustomAlertSoundReferences,
} from "./customSoundReferences";
import { DEFAULT_ALERT_SOUND_ID } from "./sounds";

describe("custom sound references", () => {
  it("replaces deleted custom sound references across the profile", () => {
    const profile = createDefaultProfile();
    const customSoundId = "custom:abc";
    const nextGeneralTimer = { ...profile.generalTimers![0], soundId: customSoundId };
    const result = replaceCustomAlertSoundReferences(
      {
        ...profile,
        alertDefaults: { ...profile.alertDefaults, soundId: customSoundId },
        skills: profile.skills.map((skill, index) => ({
          ...skill,
          soundId: index === 0 ? customSoundId : skill.soundId,
        })),
        runeAlert: { ...profile.runeAlert!, soundId: customSoundId },
        ultimaRaidEquipmentAlert: {
          ...profile.ultimaRaidEquipmentAlert!,
          soundId: customSoundId,
          bossAlert: {
            ...profile.ultimaRaidEquipmentAlert!.bossAlert,
            soundId: customSoundId,
          },
        },
        huntStallAlert: { ...profile.huntStallAlert!, soundId: customSoundId },
        buffExpiryAlert: { ...profile.buffExpiryAlert!, soundId: customSoundId },
        generalTimers: [nextGeneralTimer],
      },
      customSoundId,
    );

    expect(result.replacedCount).toBe(8);
    expect(result.profile.alertDefaults.soundId).toBe(DEFAULT_ALERT_SOUND_ID);
    expect(result.profile.skills[0].soundId).toBe(DEFAULT_ALERT_SOUND_ID);
    expect(result.profile.runeAlert?.soundId).toBe(DEFAULT_ALERT_SOUND_ID);
    expect(result.profile.ultimaRaidEquipmentAlert?.soundId).toBe(
      DEFAULT_ALERT_SOUND_ID,
    );
    expect(result.profile.ultimaRaidEquipmentAlert?.bossAlert.soundId).toBe(
      DEFAULT_ALERT_SOUND_ID,
    );
    expect(result.profile.huntStallAlert?.soundId).toBe(DEFAULT_ALERT_SOUND_ID);
    expect(result.profile.buffExpiryAlert?.soundId).toBe(DEFAULT_ALERT_SOUND_ID);
    expect(result.profile.generalTimers?.[0].soundId).toBe(DEFAULT_ALERT_SOUND_ID);
  });

  it("collects and groups custom sound references that are missing from this browser", () => {
    const profile = createDefaultProfile();
    profile.alertDefaults.soundId = "custom:shared";
    profile.skills[0].soundId = "custom:shared";
    profile.runeAlert = { ...profile.runeAlert!, soundId: "custom:rune" };
    profile.huntStallAlert = { ...profile.huntStallAlert!, soundId: "띵동띵동" };

    expect(collectCustomAlertSoundReferences(profile)).toEqual([
      { soundId: "custom:shared", label: "기본 알림음" },
      { soundId: "custom:shared", label: `스킬: ${profile.skills[0].name}` },
      { soundId: "custom:rune", label: "룬 알림" },
    ]);

    expect(findMissingCustomAlertSoundReferences(profile, ["shared"])).toEqual([
      { soundId: "custom:rune", labels: ["룬 알림"] },
    ]);
  });

  it("replaces multiple missing custom sound references with the default sound", () => {
    const profile = createDefaultProfile();
    profile.skills[0].soundId = "custom:first";
    profile.runeAlert = { ...profile.runeAlert!, soundId: "custom:second" };
    profile.huntStallAlert = { ...profile.huntStallAlert!, soundId: "custom:kept" };

    const result = replaceMissingCustomAlertSoundReferences(profile, [
      "custom:first",
      "custom:second",
    ]);

    expect(result.replacedCount).toBe(2);
    expect(result.profile.skills[0].soundId).toBe(DEFAULT_ALERT_SOUND_ID);
    expect(result.profile.runeAlert?.soundId).toBe(DEFAULT_ALERT_SOUND_ID);
    expect(result.profile.huntStallAlert?.soundId).toBe("custom:kept");
  });
});
