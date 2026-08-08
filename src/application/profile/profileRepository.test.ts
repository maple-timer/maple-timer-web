import { afterEach, describe, expect, it } from "vitest";
import type {
  KeyValueStorage,
} from "../../contracts/persistence/keyValueStorage";
import {
  LEGACY_PROFILE_STORAGE_KEY,
  PROFILE_STORAGE_SCHEMA,
  VERSIONED_PROFILE_STORAGE_KEY,
  createProfileStorageEnvelope,
} from "../../contracts/persistence/profileStorageContract";
import {
  createDefaultPipTimerConfig,
  createDefaultProfile,
  createSkill,
} from "../../lib/storage";
import {
  DEFAULT_BUFF_EXPIRY_ALERT_LEAD_SECONDS,
} from "../../lib/profileStorageConstants";
import { createProfileRepository } from "./profileRepository";

const { load: loadProfile, save: saveProfile } = createProfileRepository({
  getStorage: () => localStorage,
});

function createStorageThatFailsOnSet(failedKey: string): KeyValueStorage {
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => {
      if (key === failedKey) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      localStorage.setItem(key, value);
    },
    removeItem: (key) => localStorage.removeItem(key),
  };
}

describe("profile storage normalization", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("uses a default profile when browser storage is unavailable", () => {
    const unavailableRepository = createProfileRepository({
      getStorage: () => null,
    });

    expect(unavailableRepository.load()).toMatchObject({
      name: "사냥 프로필",
      masterVolume: 1,
    });
  });

  it("ignores saves when browser storage is unavailable", () => {
    const unavailableRepository = createProfileRepository({
      getStorage: () => null,
    });

    expect(() => unavailableRepository.save(createDefaultProfile())).not.toThrow();
  });

  it("prefers the versioned profile envelope over the legacy copy", () => {
    const legacyProfile = {
      ...createDefaultProfile(),
      id: "legacy",
      name: "기존 복사본",
      updatedAt: "2026-07-15T00:00:00.000Z",
    };
    const versionedProfile = {
      ...createDefaultProfile(),
      id: "versioned",
      name: "현재 프로필",
      updatedAt: "2026-07-16T00:00:00.000Z",
    };
    localStorage.setItem(LEGACY_PROFILE_STORAGE_KEY, JSON.stringify(legacyProfile));
    localStorage.setItem(
      VERSIONED_PROFILE_STORAGE_KEY,
      JSON.stringify(
        createProfileStorageEnvelope(versionedProfile, "2026-07-16T00:00:00.000Z"),
      ),
    );

    expect(loadProfile()).toMatchObject({ id: "versioned", name: "현재 프로필" });
  });

  it("prefers the versioned copy when both generations have the same timestamp", () => {
    const updatedAt = "2026-07-16T00:00:00.000Z";
    const legacyProfile = {
      ...createDefaultProfile(),
      id: "legacy-equal",
      name: "동일 시각 v1",
      updatedAt,
    };
    const versionedProfile = {
      ...createDefaultProfile(),
      id: "versioned-equal",
      name: "동일 시각 v2",
      updatedAt,
    };
    localStorage.setItem(LEGACY_PROFILE_STORAGE_KEY, JSON.stringify(legacyProfile));
    localStorage.setItem(
      VERSIONED_PROFILE_STORAGE_KEY,
      JSON.stringify(createProfileStorageEnvelope(versionedProfile, updatedAt)),
    );

    expect(loadProfile()).toMatchObject({
      id: "versioned-equal",
      name: "동일 시각 v2",
    });
  });

  it("uses a newer legacy copy written by an older app build", () => {
    const versionedProfile = {
      ...createDefaultProfile(),
      id: "versioned-old",
      name: "이전 v2",
      updatedAt: "2026-07-15T00:00:00.000Z",
    };
    const legacyProfile = {
      ...createDefaultProfile(),
      id: "legacy-new",
      name: "구버전 앱에서 변경",
      updatedAt: "2026-07-16T00:00:00.000Z",
    };
    localStorage.setItem(
      VERSIONED_PROFILE_STORAGE_KEY,
      JSON.stringify(
        createProfileStorageEnvelope(versionedProfile, "2026-07-15T00:00:00.000Z"),
      ),
    );
    localStorage.setItem(LEGACY_PROFILE_STORAGE_KEY, JSON.stringify(legacyProfile));

    expect(loadProfile()).toMatchObject({
      id: "legacy-new",
      name: "구버전 앱에서 변경",
    });
  });

  it("falls back to the legacy copy when the versioned envelope is malformed", () => {
    const legacyProfile = { ...createDefaultProfile(), id: "legacy", name: "복구 프로필" };
    localStorage.setItem(LEGACY_PROFILE_STORAGE_KEY, JSON.stringify(legacyProfile));
    localStorage.setItem(
      VERSIONED_PROFILE_STORAGE_KEY,
      JSON.stringify({ schema: PROFILE_STORAGE_SCHEMA, version: 1, data: {} }),
    );

    expect(loadProfile()).toMatchObject({ id: "legacy", name: "복구 프로필" });
  });

  it("reads known profile fields from a future envelope version", () => {
    const profile = { ...createDefaultProfile(), id: "future", name: "미래 프로필" };
    localStorage.setItem(
      VERSIONED_PROFILE_STORAGE_KEY,
      JSON.stringify({
        schema: PROFILE_STORAGE_SCHEMA,
        version: 2,
        savedAt: "2026-07-16T00:00:00.000Z",
        data: { profile: { ...profile, futureSetting: true } },
      }),
    );

    expect(loadProfile()).toMatchObject({ id: "future", name: "미래 프로필" });
  });

  it("writes the same stored profile to the new envelope and legacy key", () => {
    saveProfile({ ...createDefaultProfile(), id: "dual-write", name: "동시 저장" });

    const legacy = JSON.parse(localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY) ?? "null");
    const versioned = JSON.parse(localStorage.getItem(VERSIONED_PROFILE_STORAGE_KEY) ?? "null");
    expect(versioned).toMatchObject({
      schema: PROFILE_STORAGE_SCHEMA,
      version: 1,
      savedAt: legacy.updatedAt,
      data: { profile: legacy },
    });
    expect(legacy).toMatchObject({ id: "dual-write", name: "동시 저장" });
  });

  it("restores the previous envelope when the legacy rollback copy cannot be written", () => {
    const oldProfile = { ...createDefaultProfile(), id: "old", name: "이전 프로필" };
    const oldEnvelope = JSON.stringify(
      createProfileStorageEnvelope(oldProfile, "2026-07-15T00:00:00.000Z"),
    );
    localStorage.setItem(LEGACY_PROFILE_STORAGE_KEY, JSON.stringify(oldProfile));
    localStorage.setItem(VERSIONED_PROFILE_STORAGE_KEY, oldEnvelope);

    const repository = createProfileRepository({
      getStorage: () => createStorageThatFailsOnSet(LEGACY_PROFILE_STORAGE_KEY),
    });

    expect(() =>
      repository.save({
        ...createDefaultProfile(),
        id: "new",
        name: "새 프로필",
      }),
    ).toThrow("quota");
    expect(localStorage.getItem(VERSIONED_PROFILE_STORAGE_KEY)).toBe(oldEnvelope);
    expect(JSON.parse(localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY) ?? "null")).toMatchObject({
      id: "old",
      name: "이전 프로필",
    });
  });

  it("removes a newly written envelope when the legacy rollback copy cannot be written", () => {
    const oldProfile = { ...createDefaultProfile(), id: "old", name: "이전 프로필" };
    localStorage.setItem(LEGACY_PROFILE_STORAGE_KEY, JSON.stringify(oldProfile));

    const repository = createProfileRepository({
      getStorage: () => createStorageThatFailsOnSet(LEGACY_PROFILE_STORAGE_KEY),
    });

    expect(() =>
      repository.save({
        ...createDefaultProfile(),
        id: "new",
        name: "새 프로필",
      }),
    ).toThrow("quota");
    expect(localStorage.getItem(VERSIONED_PROFILE_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY) ?? "null")).toMatchObject({
      id: "old",
      name: "이전 프로필",
    });
  });

  it("leaves the legacy copy unchanged when the versioned write fails first", () => {
    const oldProfile = { ...createDefaultProfile(), id: "old", name: "이전 프로필" };
    localStorage.setItem(LEGACY_PROFILE_STORAGE_KEY, JSON.stringify(oldProfile));

    const repository = createProfileRepository({
      getStorage: () => createStorageThatFailsOnSet(VERSIONED_PROFILE_STORAGE_KEY),
    });

    expect(() =>
      repository.save({
        ...createDefaultProfile(),
        id: "new",
        name: "새 프로필",
      }),
    ).toThrow("quota");
    expect(localStorage.getItem(VERSIONED_PROFILE_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY) ?? "null")).toMatchObject({
      id: "old",
      name: "이전 프로필",
    });
  });

  it("uses precision buff-slot skill presets by default", () => {
    const profile = createDefaultProfile();

    expect(profile.skills[0]).toMatchObject({
      presetId: "sol-janus-dawn-deep-v2",
      detectionSource: "buff-duration",
      durationSeconds: 120,
      cooldownDurationSeconds: 56,
      alertThresholdSeconds: 10,
      soundId: "야누스 랜덤",
      volume: 1,
      repeatAlertEnabled: false,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: null,
    });
    expect(profile.skills[1]).toMatchObject({
      presetId: "erda-fountain-deep-v2",
      detectionSource: "buff-duration",
      cooldownDurationSeconds: 56,
      alertThresholdSeconds: 10,
      soundId: "파운틴 랜덤",
      volume: 1,
    });
    expect(profile.runeAlert).toMatchObject({
      enabled: true,
      region: null,
      regionsByLayout: {},
      soundId: "떳어요 룬 떳어요",
      volume: 1,
      repeatAlertEnabled: false,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: null,
    });
    expect(profile.huntStallAlert).toMatchObject({
      enabled: false,
      stallThresholdSeconds: 7,
      cooldownMissingThresholdSeconds: 5,
      soundId: "사냥 멈춘것 같애요 1",
      volume: 1,
    });
    expect(profile.masterVolume).toBe(1);
    expect(profile.pipTimer).toMatchObject({
      size: "default",
      alertColor: "amber",
      emphasis: "balanced",
      itemAlertColors: {
        skills: "amber",
        rune: "cyan",
        experience: "violet",
        buffExpiry: "red",
        generalTimers: "white",
      },
      visibleItems: {
        skills: true,
        rune: true,
        generalTimers: true,
        buffExpiry: true,
        experience: true,
      },
    });
  });

  it("uses 10 seconds as the default alert threshold for newly created skills", () => {
    expect(createSkill({ presetId: "class-install" })).toMatchObject({
      durationSeconds: 60,
      cooldownDurationSeconds: 60,
      alertThresholdSeconds: 10,
      soundId: "띵동띵동",
      volume: 1,
      repeatAlertEnabled: false,
      repeatAlertIntervalSeconds: 3,
    });
  });

  it("keeps class install alert thresholds in the extended after-expiry range", () => {
    const profile = createDefaultProfile();
    profile.skills = [
      createSkill({
        id: "class-install-1",
        presetId: "class-install",
        alertThresholdSeconds: -20,
      }),
      createSkill({
        id: "erda-fountain-1",
        presetId: "erda-fountain",
        alertThresholdSeconds: -20,
      }),
    ];

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));

    expect(loadProfile().skills).toEqual([
      expect.objectContaining({
        id: "class-install-1",
        presetId: "class-install",
        alertThresholdSeconds: -20,
      }),
      expect.objectContaining({
        id: "erda-fountain-1",
        presetId: "erda-fountain",
        alertThresholdSeconds: -5,
      }),
    ]);
  });

  it("migrates legacy buff-slot skill presets to precision presets", () => {
    expect(
      createSkill({
        presetId: "sol-janus-dawn-2min",
        detectionSource: "buff-duration",
      }),
    ).toMatchObject({
      presetId: "sol-janus-dawn-deep-v2",
      detectionSource: "buff-duration",
    });

    expect(
      createSkill({
        presetId: "sol-janus-dawn-2min",
        detectionSource: "quickslot",
      }),
    ).toMatchObject({
      presetId: "sol-janus-dawn-2min",
      detectionSource: "quickslot",
    });

    expect(
      createSkill({
        presetId: "hologram-graffiti-barrier-vi",
      }),
    ).toMatchObject({
      detectionSource: "buff-duration",
    });

    expect(
      createSkill({
        presetId: "hologram-graffiti-barrier-vi",
        detectionSource: "quickslot",
      }),
    ).toMatchObject({
      detectionSource: "buff-duration",
    });

    expect(
      createSkill({
        presetId: "sol-janus-dawn-deep-v2",
        detectionSource: "quickslot",
      }),
    ).toMatchObject({
      detectionSource: "buff-duration",
    });

    expect(
      createSkill({
        presetId: "erda-fountain-deep-v2",
        detectionSource: "quickslot",
      }),
    ).toMatchObject({
      detectionSource: "buff-duration",
    });

    expect(
      createSkill({
        presetId: "erda-fountain",
        detectionSource: "buff-duration",
      }),
    ).toMatchObject({
      presetId: "erda-fountain-deep-v2",
      detectionSource: "buff-duration",
    });

    expect(
      createSkill({
        presetId: "erda-fountain",
        detectionSource: "quickslot",
      }),
    ).toMatchObject({
      presetId: "erda-fountain",
      detectionSource: "quickslot",
    });
  });

  it("normalizes skill repeat alert settings", () => {
    expect(
      createSkill({
        presetId: "sol-janus-dawn-2min",
        repeatAlertEnabled: true,
        repeatAlertIntervalSeconds: 5,
        repeatAlertMaxCount: 1,
      }),
    ).toMatchObject({
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 5,
      repeatAlertMaxCount: 1,
    });

    expect(
      createSkill({
        presetId: "sol-janus-dawn-2min",
        repeatAlertEnabled: true,
        repeatAlertIntervalSeconds: 99,
        repeatAlertMaxCount: 99,
      }),
    ).toMatchObject({
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: null,
    });
  });

  it("normalizes rune repeat alert settings", () => {
    const profile = createDefaultProfile();
    profile.runeAlert = {
      ...profile.runeAlert!,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 5,
      repeatAlertMaxCount: 1,
    };

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));

    expect(loadProfile().runeAlert).toMatchObject({
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 5,
      repeatAlertMaxCount: 1,
    });

    profile.runeAlert = {
      ...profile.runeAlert!,
      repeatAlertIntervalSeconds: 99,
      repeatAlertMaxCount: 99,
    };
    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));

    expect(loadProfile().runeAlert).toMatchObject({
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: null,
    });
  });

  it("normalizes general timer auto restart settings", () => {
    const profile = createDefaultProfile();
    profile.generalTimers = [
      {
        id: "timer-1",
        presetId: "30m",
        soundId: "띵동띵동",
        volume: 1,
        autoRestartEnabled: true,
        enabled: true,
        startedAt: null,
        endsAt: null,
        remainingSecondsAtPause: null,
        alertedAt: null,
      },
      {
        id: "timer-2",
        presetId: "20m",
        soundId: "띵동띵동",
        volume: 1,
        autoRestartEnabled: "true" as never,
        enabled: true,
        startedAt: null,
        endsAt: null,
        remainingSecondsAtPause: null,
        alertedAt: null,
      },
    ];

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));

    expect(loadProfile().generalTimers).toEqual([
      expect.objectContaining({ id: "timer-1", autoRestartEnabled: true }),
      expect.objectContaining({ id: "timer-2", autoRestartEnabled: false }),
    ]);
  });

  it("fills missing legacy class install cooldown settings with the default cooldown", () => {
    const profile = createDefaultProfile();
    profile.skills = [
      {
        ...createSkill({
          presetId: "class-install",
          durationSeconds: 120,
          cooldownDurationSeconds: undefined,
        }),
        cooldownDurationSeconds: undefined,
      },
    ];

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));

    expect(loadProfile().skills[0]).toMatchObject({
      presetId: "class-install",
      durationSeconds: 120,
      cooldownDurationSeconds: 60,
    });
  });

  it("uses the configured duration and random alert sound for new Sol Janus skills", () => {
    expect(createSkill({ presetId: "sol-janus-dawn-1min" })).toMatchObject({
      durationSeconds: 60,
      cooldownDurationSeconds: 56,
      soundId: "야누스 랜덤",
    });
    expect(createSkill({ presetId: "sol-janus-dawn-70s" })).toMatchObject({
      durationSeconds: 70,
      cooldownDurationSeconds: 56,
      soundId: "야누스 랜덤",
    });
    expect(createSkill({ presetId: "sol-janus-dawn-80s" })).toMatchObject({
      durationSeconds: 80,
      cooldownDurationSeconds: 56,
      soundId: "야누스 랜덤",
    });
    expect(createSkill({ presetId: "sol-janus-dawn-2min" })).toMatchObject({
      durationSeconds: 120,
      cooldownDurationSeconds: 56,
      soundId: "야누스 랜덤",
    });
    expect(createSkill({ presetId: "sol-janus-dawn-deep-v2" })).toMatchObject({
      durationSeconds: 120,
      cooldownDurationSeconds: 56,
      soundId: "야누스 랜덤",
      detectionSource: "buff-duration",
    });
    expect(createSkill({ presetId: "erda-fountain-deep-v2" })).toMatchObject({
      durationSeconds: 60,
      cooldownDurationSeconds: 56,
      soundId: "파운틴 랜덤",
      detectionSource: "buff-duration",
    });
    expect(createSkill({ presetId: "maehwa-yein-vi" })).toMatchObject({
      durationSeconds: 28,
      cooldownDurationSeconds: 28,
      soundId: "띵동띵동",
      detectionSource: "buff-duration",
    });
  });

  it("keeps explicitly selected valid sounds for rune, Sol Janus, and Erda Fountain", () => {
    const profile = createDefaultProfile();
    profile.skills = [
      { ...profile.skills[0], soundId: "띵동띵동" },
      { ...profile.skills[1], soundId: "띵동띵동" },
    ];
    profile.runeAlert = {
      ...profile.runeAlert!,
      soundId: "미스터리",
    };

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));

    const loaded = loadProfile();
    expect(loaded.skills[0]).toMatchObject({ soundId: "띵동띵동" });
    expect(loaded.skills[1]).toMatchObject({ soundId: "띵동띵동" });
    expect(loaded.runeAlert).toMatchObject({ soundId: "미스터리" });
  });

  it("keeps an explicitly selected hunt stall alert sound", () => {
    const profile = createDefaultProfile();
    profile.huntStallAlert = {
      ...profile.huntStallAlert!,
      soundId: "띵동띵동",
    };

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));

    expect(loadProfile().huntStallAlert).toMatchObject({ soundId: "띵동띵동" });
  });

  it("preserves explicit hunt stall cooldown thresholds", () => {
    const profile = createDefaultProfile();
    profile.huntStallAlert = {
      ...profile.huntStallAlert!,
      cooldownMissingThresholdSeconds: 2,
    };

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));

    expect(loadProfile().huntStallAlert).toMatchObject({
      cooldownMissingThresholdSeconds: 2,
    });

    profile.huntStallAlert = {
      ...profile.huntStallAlert!,
      cooldownMissingThresholdSeconds: 7,
    };
    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));

    expect(loadProfile().huntStallAlert).toMatchObject({
      cooldownMissingThresholdSeconds: 7,
    });
  });

  it("normalizes buff expiry alert lead seconds into the supported -5-20 second range", () => {
    const profile = createDefaultProfile();
    profile.buffExpiryAlert = {
      ...profile.buffExpiryAlert!,
      alertLeadSeconds: 99,
    };

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));
    expect(loadProfile().buffExpiryAlert).toMatchObject({ alertLeadSeconds: 20 });

    profile.buffExpiryAlert = {
      ...profile.buffExpiryAlert!,
      alertLeadSeconds: -5,
    };
    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));
    expect(loadProfile().buffExpiryAlert).toMatchObject({ alertLeadSeconds: -5 });

    profile.buffExpiryAlert = {
      ...profile.buffExpiryAlert!,
      alertLeadSeconds: -99,
    };
    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));
    expect(loadProfile().buffExpiryAlert).toMatchObject({ alertLeadSeconds: -5 });

    profile.buffExpiryAlert = {
      ...profile.buffExpiryAlert!,
      alertLeadSeconds: 0.4,
    };
    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));
    expect(loadProfile().buffExpiryAlert).toMatchObject({ alertLeadSeconds: 0 });
  });

  it("keeps saved precision buff expiry alert lead seconds within the supported range", () => {
    const profile = createDefaultProfile();
    profile.buffExpiryAlert = {
      ...profile.buffExpiryAlert!,
      alertLeadSeconds: 30,
    };

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));

    expect(loadProfile().buffExpiryAlert).toMatchObject({
      alertLeadSeconds: 20,
    });
  });

  it("drops obsolete buff expiry engine mode from saved profiles", () => {
    const profile = createDefaultProfile();

    localStorage.setItem(
      "maple-hunt-timer.profile.v1",
      JSON.stringify({
        ...profile,
        buffExpiryAlert: {
          ...profile.buffExpiryAlert,
          engineMode: "legacy",
        },
      }),
    );

    expect(loadProfile().buffExpiryAlert).toEqual(
      expect.not.objectContaining({ engineMode: expect.anything() }),
    );
    expect(loadProfile().buffExpiryAlert).toMatchObject({
      alertLeadSeconds: DEFAULT_BUFF_EXPIRY_ALERT_LEAD_SECONDS,
    });
  });

  it("normalizes context-specific Adam sounds while preserving non-Adam choices", () => {
    const profile = createDefaultProfile();
    profile.skills = [
      { ...profile.skills[0], soundId: "파운틴 곧 꺼져요" },
      { ...profile.skills[1], soundId: "야누스 곧 꺼져요" },
    ];
    profile.runeAlert = {
      ...profile.runeAlert!,
      soundId: "야누스 곧 꺼져요",
    };
    profile.huntStallAlert = {
      ...profile.huntStallAlert!,
      soundId: "야누스 곧 꺼져요",
    };

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));

    const loaded = loadProfile();
    expect(loaded.skills[0]).toMatchObject({ soundId: "야누스 랜덤" });
    expect(loaded.skills[1]).toMatchObject({ soundId: "파운틴 랜덤" });
    expect(loaded.runeAlert).toMatchObject({ soundId: "떳어요 룬 떳어요" });
    expect(loaded.huntStallAlert).toMatchObject({ soundId: "사냥 멈춘것 같애요 1" });
  });

  it("migrates legacy global volume into each alert target", () => {
    const profile = createDefaultProfile();
    profile.alertDefaults.volume = 0.35;
    const legacySkills = profile.skills.map(({ volume, ...skill }) => skill);
    const { volume, ...legacyRuneAlert } = profile.runeAlert!;

    localStorage.setItem(
      "maple-hunt-timer.profile.v1",
      JSON.stringify({
        ...profile,
        skills: legacySkills,
        runeAlert: legacyRuneAlert,
      }),
    );

    const loaded = loadProfile();
    expect(loaded.skills.map((skill) => skill.volume)).toEqual([0.35, 0.35]);
    expect(loaded.runeAlert?.volume).toBe(0.35);
  });

  it("keeps boosted volume settings up to 200 percent", () => {
    const profile = createDefaultProfile();
    profile.skills = [{ ...profile.skills[0], volume: 1.75 }];
    profile.runeAlert = { ...profile.runeAlert!, volume: 2 };
    profile.huntStallAlert = { ...profile.huntStallAlert!, volume: 2.5 };

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));

    const loaded = loadProfile();
    expect(loaded.skills[0].volume).toBe(1.75);
    expect(loaded.runeAlert?.volume).toBe(2);
    expect(loaded.huntStallAlert?.volume).toBe(2);
  });

  it("defaults missing legacy master volume to 100 percent", () => {
    const profile = createDefaultProfile();
    const { masterVolume, ...legacyProfile } = profile;

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(legacyProfile));

    expect(masterVolume).toBe(1);
    expect(loadProfile().masterVolume).toBe(1);
  });

  it("keeps master volume independent from per-alert volumes", () => {
    const profile = createDefaultProfile();
    profile.masterVolume = 0.45;
    profile.skills = [{ ...profile.skills[0], volume: 1.5 }];
    profile.runeAlert = { ...profile.runeAlert!, volume: 0.35 };

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));

    const loaded = loadProfile();
    expect(loaded.masterVolume).toBe(0.45);
    expect(loaded.skills[0].volume).toBe(1.5);
    expect(loaded.runeAlert?.volume).toBe(0.35);
  });

  it("normalizes PiP timer visual settings", () => {
    const profile = createDefaultProfile();
    profile.pipTimer = {
      ...createDefaultPipTimerConfig(),
      mode: "specialCore",
      size: "focus",
      alertColor: "cyan",
      emphasis: "flash",
      itemAlertColors: {
        skills: "red",
        rune: "cyan",
        experience: "violet",
        buffExpiry: "white",
        generalTimers: "amber",
      },
      visibleItems: {
        skills: false,
        rune: true,
        generalTimers: false,
        buffExpiry: true,
        experience: true,
      },
      showScreenPreview: true,
    };

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));

    expect(loadProfile().pipTimer).toMatchObject({
      mode: "specialCore",
      size: "focus",
      alertColor: "cyan",
      emphasis: "flash",
      itemAlertColors: {
        skills: "red",
        rune: "cyan",
        experience: "violet",
        buffExpiry: "white",
        generalTimers: "amber",
      },
      visibleItems: {
        skills: false,
        rune: true,
        generalTimers: false,
        buffExpiry: true,
        experience: true,
      },
      showScreenPreview: true,
    });

    localStorage.setItem(
      "maple-hunt-timer.profile.v1",
      JSON.stringify({
        ...profile,
        pipTimer: {
          mode: "boss",
          size: "full-screen",
          alertColor: "green",
          emphasis: "maximum",
          itemAlertColors: {
            skills: "purple",
            rune: "red",
            experience: "gold",
            buffExpiry: "white",
            generalTimers: 10,
          },
          visibleItems: {
            skills: "yes",
            rune: false,
            generalTimers: false,
            buffExpiry: false,
            experience: 1,
          },
          showScreenPreview: "yes",
        },
      }),
    );

    expect(loadProfile().pipTimer).toMatchObject({
      mode: "hunting",
      size: "default",
      alertColor: "amber",
      emphasis: "balanced",
      itemAlertColors: {
        skills: "amber",
        rune: "red",
        experience: "violet",
        buffExpiry: "white",
        generalTimers: "white",
      },
      visibleItems: {
        skills: true,
        rune: false,
        generalTimers: false,
        buffExpiry: false,
        experience: true,
      },
      showScreenPreview: false,
    });
  });

  it("migrates removed Janus voice ids to the new default Janus alert sound", () => {
    const profile = createDefaultProfile();
    profile.skills = [
      {
        ...profile.skills[0],
        soundId: "야누스 꺼졌어요. 빨리 다시 설치해주세요 신남",
      },
    ];

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));

    expect(loadProfile().skills[0]).toMatchObject({ soundId: "야누스 랜덤" });
  });

  it("keeps an explicitly disabled rune alert setting", () => {
    const profile = createDefaultProfile();
    const runeAlert = profile.runeAlert!;
    profile.runeAlert = {
      ...runeAlert,
      enabled: false,
    };

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(profile));

    expect(loadProfile().runeAlert).toMatchObject({
      enabled: false,
      soundId: "떳어요 룬 떳어요",
    });
  });

  it("migrates legacy one-minute Sol Janus settings by duration", () => {
    const skill = createSkill({
      name: "솔 야누스 : 새벽",
      presetId: "sol-janus-dawn" as never,
      durationSeconds: 60,
    });

    expect(skill).toMatchObject({
      presetId: "sol-janus-dawn-1min",
      durationSeconds: 60,
      cooldownDurationSeconds: 56,
    });
  });

  it("migrates legacy two-minute Sol Janus settings by duration", () => {
    const skill = createSkill({
      name: "솔 야누스 : 새벽",
      presetId: "sol-janus-dawn" as never,
      durationSeconds: 120,
    });

    expect(skill).toMatchObject({
      presetId: "sol-janus-dawn-2min",
      durationSeconds: 120,
      cooldownDurationSeconds: 56,
    });
  });

  it("migrates legacy 70 and 80 second Sol Janus settings by duration", () => {
    expect(
      createSkill({
        name: "솔 야누스 : 새벽",
        presetId: "sol-janus-dawn" as never,
        durationSeconds: 70,
      }),
    ).toMatchObject({
      presetId: "sol-janus-dawn-70s",
      durationSeconds: 70,
      cooldownDurationSeconds: 56,
    });

    expect(
      createSkill({
        name: "솔 야누스 : 새벽",
        presetId: "sol-janus-dawn" as never,
        durationSeconds: 80,
      }),
    ).toMatchObject({
      presetId: "sol-janus-dawn-80s",
      durationSeconds: 80,
      cooldownDurationSeconds: 56,
    });
  });

  it("loads legacy stored Sol Janus settings without losing regions", () => {
    const legacyProfile = createDefaultProfile();
    legacyProfile.skills = [
      {
        ...legacyProfile.skills[0],
        presetId: "sol-janus-dawn" as never,
        detectionSource: "quickslot",
        durationSeconds: 60,
        region: { x: 0.1, y: 0.2, width: 0.03, height: 0.03 },
      },
    ];

    localStorage.setItem("maple-hunt-timer.profile.v1", JSON.stringify(legacyProfile));

    const loaded = loadProfile();
    expect(loaded.skills[0]).toMatchObject({
      presetId: "sol-janus-dawn-1min",
      durationSeconds: 60,
      region: { x: 0.1, y: 0.2, width: 0.03, height: 0.03 },
    });
  });
});
