import { describe, expect, it } from "vitest";
import type { HuntStallRuntimeState, RuneRuntimeState } from "../../alertTypes";
import type {
  BuffExpiryRuntimeState,
  BuffExpiryTrackedBuff,
} from "../../lib/buffExpiry/buffExpiryTypes";
import type {
  BuffExpiryAlertConfig,
  GeneralTimerConfig,
  HuntStallAlertConfig,
  RuneAlertConfig,
  SkillConfig,
  SkillRuntimeState,
  SpecialCoreAlertConfig,
} from "../../types";
import { DEFAULT_ALERT_SOUND_ID } from "../../lib/sounds";
import { createRuntimeState } from "../../lib/timer";
import {
  getPipTimerDisplay,
  getSpecialCorePipTimerDisplay,
} from "./pipTimerPresentation";
import {
  createBuffExpiryRuntimeState,
} from "../../lib/buffExpiry/buffExpiryRuntimeState";
import { createSpecialCoreRuntimeState } from "../../lib/specialCore";

const now = 1_000_000;

function createSkill(partial: Partial<SkillConfig> = {}): SkillConfig {
  return {
    id: partial.id ?? "skill_a",
    name: partial.name ?? "테스트 스킬",
    presetId: partial.presetId,
    detectionSource: partial.detectionSource ?? "quickslot",
    countdownSource: partial.countdownSource ?? "duration",
    durationSeconds: partial.durationSeconds ?? 60,
    cooldownDurationSeconds: partial.cooldownDurationSeconds,
    alertThresholdSeconds: partial.alertThresholdSeconds ?? 10,
    recognitionStartSeconds: partial.recognitionStartSeconds ?? 60,
    region: partial.region ?? null,
    regionsByLayout: partial.regionsByLayout,
    recognitionMode: partial.recognitionMode ?? "digit-template",
    soundId: partial.soundId ?? DEFAULT_ALERT_SOUND_ID,
    volume: partial.volume ?? 1,
    repeat: partial.repeat,
    enabled: partial.enabled ?? true,
  };
}

function createRunningState(skillId: string, estimatedRemainingSeconds: number): SkillRuntimeState {
  return {
    ...createRuntimeState(skillId),
    estimatedExpiresAt: now + estimatedRemainingSeconds * 1000,
    observedRemainingSeconds: estimatedRemainingSeconds,
    observedAt: now,
    status: "running",
    confidence: 0.9,
  };
}

function createRuneState(partial: Partial<RuneRuntimeState> = {}): RuneRuntimeState {
  return {
    status: partial.status ?? "waiting",
    confidence: partial.confidence ?? 0,
    stableCount: partial.stableCount ?? 0,
    firstDetectedAt: partial.firstDetectedAt ?? null,
    lastDetectedAt: partial.lastDetectedAt ?? null,
    lastFoundAt: partial.lastFoundAt ?? null,
    alertedAt: partial.alertedAt ?? null,
    lastRepeatedAlertAt: partial.lastRepeatedAlertAt ?? null,
    repeatedAlertCount: partial.repeatedAlertCount ?? 0,
    lastAlertedAt: partial.lastAlertedAt ?? null,
    candidateCount: partial.candidateCount ?? 0,
  };
}

const runeConfig: RuneAlertConfig = {
  enabled: true,
  region: null,
  regionsByLayout: {},
  soundId: DEFAULT_ALERT_SOUND_ID,
  volume: 1,
};

const huntStallConfig: HuntStallAlertConfig = {
  enabled: true,
  mode: "manual-experience",
  stallThresholdSeconds: 20,
  cooldownRegion: null,
  cooldownRegionsByLayout: {},
  cooldownMissingThresholdSeconds: 12,
  soundId: DEFAULT_ALERT_SOUND_ID,
  volume: 1,
};

const buffExpiryConfig: BuffExpiryAlertConfig = {
  enabled: true,
  alertLeadSeconds: 30,
  selectedBuffIds: ["union_wealth_group"],
  soundId: DEFAULT_ALERT_SOUND_ID,
  volume: 1,
};

const specialCoreConfig: SpecialCoreAlertConfig = {
  enabled: true,
  cooldownSeconds: 30,
  alertLeadSeconds: 5,
  soundId: DEFAULT_ALERT_SOUND_ID,
  volume: 1,
};

function createHuntStallState(
  partial: Partial<HuntStallRuntimeState> = {},
): HuntStallRuntimeState {
  return {
    status: partial.status ?? "active",
    lastChangedAt: partial.lastChangedAt ?? now - 2_000,
    lastSampledAt: partial.lastSampledAt ?? now - 1_000,
    lastReadableAt: partial.lastReadableAt ?? now - 1_000,
    lastReadFailureAt: partial.lastReadFailureAt ?? null,
    unreadableSinceAt: partial.unreadableSinceAt ?? null,
    alertedAt: partial.alertedAt ?? null,
    lastRepeatedAlertAt: partial.lastRepeatedAlertAt ?? null,
    repeatedAlertCount: partial.repeatedAlertCount ?? 0,
    lastAlertedAt: partial.lastAlertedAt ?? null,
    stableSampleCount: partial.stableSampleCount ?? 4,
    unchangedSeconds: partial.unchangedSeconds ?? 2,
    fingerprint: partial.fingerprint ?? "exp-fingerprint",
    recognizedText: partial.recognizedText ?? "86,649,656,544 [46.441%]",
    alertedRecognizedText: partial.alertedRecognizedText ?? null,
    pendingRecognizedText: partial.pendingRecognizedText ?? null,
    pendingRecognizedCount: partial.pendingRecognizedCount ?? 0,
    lastRejectedRecognizedText: partial.lastRejectedRecognizedText ?? null,
    lastReadFailureReason: partial.lastReadFailureReason ?? null,
    lastDecision: partial.lastDecision ?? "confirmed-progress",
    hasObservedExperienceChange: partial.hasObservedExperienceChange ?? true,
    hasObservedCooldownPresence: partial.hasObservedCooldownPresence ?? false,
    cooldownLastDetectedAt: partial.cooldownLastDetectedAt ?? null,
    cooldownMissingSinceAt: partial.cooldownMissingSinceAt ?? null,
    cooldownMissingSeconds: partial.cooldownMissingSeconds ?? 0,
    cooldownConsecutiveReadableCount: partial.cooldownConsecutiveReadableCount ?? 0,
    confidence: partial.confidence ?? 0.98,
    changeScore: partial.changeScore ?? 1,
    experienceTotalEstimate: partial.experienceTotalEstimate,
    experienceTotalSampleCount: partial.experienceTotalSampleCount,
  };
}

function createGeneralTimer(partial: Partial<GeneralTimerConfig> = {}): GeneralTimerConfig {
  return {
    id: partial.id ?? "timer_a",
    name: partial.name,
    presetId: partial.presetId ?? "30m",
    customDurationSeconds: partial.customDurationSeconds,
    soundId: partial.soundId ?? DEFAULT_ALERT_SOUND_ID,
    volume: partial.volume ?? 1,
    enabled: partial.enabled ?? true,
    startedAt: partial.startedAt ?? null,
    endsAt: partial.endsAt ?? null,
    remainingSecondsAtPause: partial.remainingSecondsAtPause ?? null,
    alertedAt: partial.alertedAt ?? null,
  };
}

function createBuffExpiryTrack(
  partial: Partial<BuffExpiryTrackedBuff> = {},
): BuffExpiryTrackedBuff {
  return {
    id: partial.id ?? "track_a",
    buffId: partial.buffId ?? "union_wealth_group",
    name: partial.name ?? "유니온의 부",
    box: partial.box ?? { x: 10, y: 10, width: 32, height: 32, confidence: 0.95 },
    detectedSeconds: partial.detectedSeconds ?? 40,
    detectedAt: partial.detectedAt ?? now - 10_000,
    expiresAt: partial.expiresAt ?? now + 45_000,
    lastSeenAt: partial.lastSeenAt ?? now - 1_000,
    alertedAt: partial.alertedAt ?? null,
    score: partial.score ?? 0.96,
  };
}

function createBuffExpiryState(
  partial: Partial<BuffExpiryRuntimeState> = {},
): BuffExpiryRuntimeState {
  return {
    ...createBuffExpiryRuntimeState(),
    status: partial.status ?? "tracking",
    tracks: partial.tracks ?? [],
    pendingTracks: partial.pendingTracks ?? [],
    confirmationCandidateCount: partial.confirmationCandidateCount ?? 0,
    lastSampledAt: partial.lastSampledAt ?? now,
    lastDetectedAt: partial.lastDetectedAt ?? null,
    lastAlertedAt: partial.lastAlertedAt ?? null,
    boxCount: partial.boxCount ?? 0,
    acceptedMatchCount: partial.acceptedMatchCount ?? 0,
    unsupportedReason: partial.unsupportedReason ?? null,
    performance: partial.performance ?? null,
  };
}

describe("pip timer display", () => {
  it("uses the earliest upcoming alert as the main item", () => {
    const farSkill = createSkill({
      id: "skill_far",
      name: "먼 스킬",
      alertThresholdSeconds: 10,
    });
    const nearSkill = createSkill({
      id: "skill_near",
      name: "가까운 스킬",
      alertThresholdSeconds: 5,
    });

    const display = getPipTimerDisplay({
      skills: [farSkill, nearSkill],
      states: {
        [farSkill.id]: createRunningState(farSkill.id, 50),
        [nearSkill.id]: createRunningState(nearSkill.id, 18),
      },
      runeConfig: null,
      runeState: createRuneState(),
      now,
    });

    expect(display.main?.id).toBe(nearSkill.id);
    expect(display.main?.secondsUntilAlert).toBe(13);
    expect(display.items.map((item) => item.id)).toEqual([nearSkill.id, farSkill.id]);
  });

  it("prioritizes an alerted skill over running timers", () => {
    const runningSkill = createSkill({ id: "skill_running", name: "진행 중" });
    const alertedSkill = createSkill({ id: "skill_alerted", name: "알림 스킬" });

    const display = getPipTimerDisplay({
      skills: [runningSkill, alertedSkill],
      states: {
        [runningSkill.id]: createRunningState(runningSkill.id, 12),
        [alertedSkill.id]: {
          ...createRunningState(alertedSkill.id, 3),
          status: "alerted",
          alertedAt: now,
        },
      },
      runeConfig: null,
      runeState: createRuneState(),
      now,
    });

    expect(display.main?.id).toBe(alertedSkill.id);
    expect(display.main?.tone).toBe("alert");
    expect(display.main?.secondsUntilAlert).toBe(0);
  });

  it("shows rune alerts in the same priority group as skill alerts", () => {
    const runningSkill = createSkill({ id: "skill_running", name: "진행 중" });

    const display = getPipTimerDisplay({
      skills: [runningSkill],
      states: {
        [runningSkill.id]: createRunningState(runningSkill.id, 20),
      },
      runeConfig,
      runeState: createRuneState({ status: "alerted", alertedAt: now, confidence: 0.93 }),
      now,
    });

    expect(display.main?.id).toBe("rune");
    expect(display.main?.statusLabel).toBe("룬 등장");
    expect(display.main?.tone).toBe("alert");
  });

  it("keeps items visible while waiting for a usable recognition estimate", () => {
    const waitingSkill = createSkill({ id: "skill_waiting", name: "대기 스킬" });

    const display = getPipTimerDisplay({
      skills: [waitingSkill],
      states: {
        [waitingSkill.id]: {
          ...createRuntimeState(waitingSkill.id),
          status: "detecting",
        },
      },
      runeConfig: null,
      runeState: createRuneState(),
      now,
    });

    expect(display.main?.id).toBe(waitingSkill.id);
    expect(display.main?.tone).toBe("waiting");
    expect(display.main?.secondsUntilAlert).toBeNull();
  });

  it("shows buff-slot duration skills such as Janus and Hologram in PiP", () => {
    const janusSkill = createSkill({
      id: "skill_janus",
      name: "솔 야누스: 새벽",
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      alertThresholdSeconds: -3,
    });
    const hologramSkill = createSkill({
      id: "skill_hologram",
      name: "홀로그램 그래피티:역장 VI",
      presetId: "hologram-graffiti-barrier-vi",
      detectionSource: "buff-duration",
      alertThresholdSeconds: 5,
    });

    const display = getPipTimerDisplay({
      skills: [janusSkill, hologramSkill],
      states: {
        [janusSkill.id]: createRunningState(janusSkill.id, 42),
        [hologramSkill.id]: createRunningState(hologramSkill.id, 24),
      },
      runeConfig: null,
      runeState: createRuneState(),
      now,
    });

    expect(display.main).toMatchObject({
      id: hologramSkill.id,
      label: "홀로그램 그래피티:역장 VI",
      secondsUntilAlert: 19,
      tone: "running",
    });
    expect(display.items.map((item) => item.id)).toEqual([
      hologramSkill.id,
      janusSkill.id,
    ]);
    expect(display.items.find((item) => item.id === janusSkill.id)).toMatchObject({
      label: "솔 야누스: 새벽",
      secondsUntilAlert: 45,
    });
  });

  it("includes running general timers in the PiP priority list", () => {
    const skill = createSkill({
      id: "skill_running",
      name: "스킬",
      alertThresholdSeconds: 10,
    });
    const timer = createGeneralTimer({
      id: "timer_running",
      presetId: "30m",
      startedAt: now - 1000,
      endsAt: now + 7_000,
    });

    const display = getPipTimerDisplay({
      skills: [skill],
      states: {
        [skill.id]: createRunningState(skill.id, 80),
      },
      runeConfig: null,
      runeState: createRuneState(),
      generalTimers: [timer],
      now,
    });

    expect(display.main?.id).toBe("general-timer:timer_running");
    expect(display.main?.kind).toBe("general-timer");
    expect(display.main?.label).toBe("30분");
    expect(display.main?.iconPaths).toEqual([
      "/timer-icons/timer-30-small-wealth.png",
      "/timer-icons/timer-30-exp-accumulation.png",
    ]);
    expect(display.main?.statusLabel).toBe("진행 중");
    expect(display.main?.secondsUntilAlert).toBe(7);
  });

  it("prefers the saved general timer name over the preset label in PiP", () => {
    const named = createGeneralTimer({
      id: "timer_named",
      presetId: "custom",
      customDurationSeconds: 90,
      name: "재획비",
      startedAt: now - 1000,
      endsAt: now + 7_000,
    });
    const unnamed = createGeneralTimer({
      id: "timer_unnamed",
      presetId: "custom",
      customDurationSeconds: 90,
      startedAt: now - 1000,
      endsAt: now + 12_000,
    });

    const display = getPipTimerDisplay({
      skills: [],
      states: {},
      runeConfig: null,
      runeState: createRuneState(),
      generalTimers: [named, unnamed],
      now,
    });

    const labels = new Map(display.items.map((item) => [item.id, item.label]));
    expect(labels.get("general-timer:timer_named")).toBe("재획비");
    expect(labels.get("general-timer:timer_unnamed")).toBe("사용자 타이머");
  });

  it("shows completed general timers as alert items", () => {
    const timer = createGeneralTimer({
      id: "timer_done",
      presetId: "custom",
      customDurationSeconds: 90,
      startedAt: now - 100_000,
      endsAt: now - 1_000,
      alertedAt: now - 500,
    });

    const display = getPipTimerDisplay({
      skills: [],
      states: {},
      runeConfig: null,
      runeState: createRuneState(),
      generalTimers: [timer],
      now,
    });

    expect(display.main).toMatchObject({
      id: "general-timer:timer_done",
      kind: "general-timer",
      label: "사용자 타이머",
      statusLabel: "완료",
      secondsUntilAlert: 0,
      tone: "alert",
    });
  });

  it("includes hunt stall cooldown mode as supplemental PiP info", () => {
    const display = getPipTimerDisplay({
      skills: [],
      states: {},
      runeConfig: null,
      runeState: createRuneState(),
      huntStallConfig: {
        ...huntStallConfig,
        mode: "cooldown-presence",
        cooldownMissingThresholdSeconds: 5,
      },
      huntStallState: createHuntStallState({
        status: "active",
        recognizedText: "7",
        unchangedSeconds: 3,
        hasObservedCooldownPresence: true,
      }),
      now,
    });

    expect(display.huntStall).toEqual({
      mode: "cooldown-presence",
      badgeLabel: "쿨타임",
      primaryLabel: "숫자 7",
      secondaryLabel: "변화 없음 3초",
      progressPercent: 60,
      statusLabel: "감시 중",
      isStale: false,
      ariaLabel: "쿨타임 인식 숫자 7 변화 없음 3초",
    });
  });

  it("includes manual hunt stall experience mode as supplemental PiP info", () => {
    const display = getPipTimerDisplay({
      skills: [],
      states: {},
      runeConfig: null,
      runeState: createRuneState(),
      huntStallConfig: {
        ...huntStallConfig,
        mode: "manual-experience",
        stallThresholdSeconds: 7,
      },
      huntStallState: createHuntStallState({
        status: "active",
        recognizedText: null,
        unchangedSeconds: 3,
        hasObservedExperienceChange: true,
      }),
      now,
    });

    expect(display.huntStall).toEqual({
      mode: "manual-experience",
      badgeLabel: "EXP",
      primaryLabel: "변화 없음",
      secondaryLabel: "3초",
      progressPercent: (3 / 7) * 100,
      statusLabel: "감시 중",
      isStale: false,
      ariaLabel: "수동 경험치 인식 변화 없음 3초",
    });
  });

  it("promotes alerted hunt stall monitoring to a PiP alert item", () => {
    const display = getPipTimerDisplay({
      skills: [],
      states: {},
      runeConfig: null,
      runeState: createRuneState(),
      huntStallConfig: {
        ...huntStallConfig,
        mode: "cooldown-presence",
      },
      huntStallState: createHuntStallState({
        status: "alerted",
        alertedAt: now - 2_000,
        recognizedText: "7",
      }),
      now,
    });

    expect(display.main).toMatchObject({
      id: "hunt-stall",
      kind: "hunt-stall",
      label: "사냥 멈춤",
      statusLabel: "알림 완료",
      secondsUntilAlert: 0,
      tone: "alert",
    });
    expect(display.huntStall).toMatchObject({
      secondaryLabel: "알림 후 2초",
      statusLabel: "알림 완료",
    });
  });

  it("includes confirmed buff expiry tracks as one PiP alert item", () => {
    const display = getPipTimerDisplay({
      skills: [],
      states: {},
      runeConfig: null,
      runeState: createRuneState(),
      buffExpiryConfig,
      buffExpiryState: createBuffExpiryState({
        tracks: [
          createBuffExpiryTrack({
            id: "track_near",
            expiresAt: now + 45_000,
          }),
          createBuffExpiryTrack({
            id: "track_far",
            expiresAt: now + 80_000,
          }),
        ],
      }),
      now,
    });

    expect(display.main).toMatchObject({
      id: "buff-expiry",
      kind: "buff-expiry",
      label: "버프 종료",
      statusLabel: "2개 알림 대기",
      secondsUntilAlert: 25,
      tone: "running",
    });
  });

  it("uses the precision buff expiry alert lead clamp in PiP", () => {
    const display = getPipTimerDisplay({
      skills: [],
      states: {},
      runeConfig: null,
      runeState: createRuneState(),
      buffExpiryConfig: {
        ...buffExpiryConfig,
        alertLeadSeconds: 30,
      },
      buffExpiryState: createBuffExpiryState({
        tracks: [
          createBuffExpiryTrack({
            expiresAt: now + 45_000,
          }),
        ],
      }),
      now,
    });

    expect(display.main).toMatchObject({
      id: "buff-expiry",
      kind: "buff-expiry",
      label: "버프 종료",
      statusLabel: "알림 대기",
      secondsUntilAlert: 25,
      tone: "running",
    });
  });

  it("shows a recently alerted buff expiry item briefly", () => {
    const display = getPipTimerDisplay({
      skills: [],
      states: {},
      runeConfig: null,
      runeState: createRuneState(),
      buffExpiryConfig,
      buffExpiryState: createBuffExpiryState({
        status: "alerted",
        lastAlertedAt: now - 2_000,
        tracks: [
          createBuffExpiryTrack({
            alertedAt: now - 2_000,
            expiresAt: now + 28_000,
          }),
        ],
      }),
      now,
    });

    expect(display.main).toMatchObject({
      id: "buff-expiry",
      statusLabel: "알림 완료",
      secondsUntilAlert: 0,
      tone: "alert",
    });
  });

  it("marks manual hunt stall experience as stale when the mode is inactive", () => {
    const display = getPipTimerDisplay({
      skills: [],
      states: {},
      runeConfig: null,
      runeState: createRuneState(),
      huntStallConfig,
      huntStallState: createHuntStallState({
        status: "no-region",
      }),
      now,
    });

    expect(display.huntStall).toMatchObject({
      statusLabel: "영역 필요",
      isStale: true,
    });
  });

  it("does not include hunt stall experience when the feature is disabled", () => {
    const display = getPipTimerDisplay({
      skills: [],
      states: {},
      runeConfig: null,
      runeState: createRuneState(),
      huntStallConfig: { ...huntStallConfig, enabled: false },
      huntStallState: createHuntStallState(),
      now,
    });

    expect(display.huntStall).toBeNull();
  });

  it("hides PiP sections disabled in the display settings", () => {
    const skill = createSkill({
      id: "skill_running",
      name: "스킬",
    });
    const timer = createGeneralTimer({
      id: "timer_running",
      presetId: "30m",
      startedAt: now - 1000,
      endsAt: now + 7_000,
    });

    const display = getPipTimerDisplay({
      skills: [skill],
      states: {
        [skill.id]: createRunningState(skill.id, 12),
      },
      runeConfig,
      runeState: createRuneState({ status: "alerted", alertedAt: now }),
      generalTimers: [timer],
      huntStallConfig,
      huntStallState: createHuntStallState({
        recognizedText: "1,154,226,067 [52.298%]",
      }),
      visibleItems: {
        skills: false,
        rune: false,
        generalTimers: true,
        buffExpiry: false,
        experience: false,
      },
      now,
    });

    expect(display.items.map((item) => item.id)).toEqual(["general-timer:timer_running"]);
    expect(display.main?.id).toBe("general-timer:timer_running");
    expect(display.huntStall).toBeNull();
  });
});

describe("special core pip timer display", () => {
  it("keeps a paused special core item visible when the alert is disabled", () => {
    const display = getSpecialCorePipTimerDisplay({
      specialCoreConfig: { ...specialCoreConfig, enabled: false },
      specialCoreState: createSpecialCoreRuntimeState({
        status: "cooldown",
        cooldownEndsAt: now + 20_000,
      }),
      now,
    });

    expect(display.main).toMatchObject({
      id: "special-core",
      kind: "special-core",
      label: "특수코어",
      statusLabel: "특수 코어 알림 꺼짐",
      secondsUntilAlert: null,
      tone: "paused",
    });
    expect(display.items).toHaveLength(1);
  });

  it("shows matcher initialization without a stale countdown", () => {
    const display = getSpecialCorePipTimerDisplay({
      specialCoreConfig,
      specialCoreState: createSpecialCoreRuntimeState({ status: "loading" }),
      now,
    });

    expect(display.main).toMatchObject({
      statusLabel: "감지 준비 중",
      secondsUntilAlert: null,
      tone: "waiting",
    });
  });

  it("shows the special core cooldown remaining time before the alert lead", () => {
    const display = getSpecialCorePipTimerDisplay({
      specialCoreConfig,
      specialCoreState: createSpecialCoreRuntimeState({
        status: "cooldown",
        cooldownEndsAt: now + 18_000,
      }),
      now,
    });

    expect(display.main).toMatchObject({
      statusLabel: "쿨타임",
      secondsUntilAlert: 18,
      tone: "running",
      isUrgent: false,
    });
  });

  it("marks the special core PiP display urgent during the alert lead window", () => {
    const display = getSpecialCorePipTimerDisplay({
      specialCoreConfig,
      specialCoreState: createSpecialCoreRuntimeState({
        status: "cooldown",
        cooldownEndsAt: now + 4_000,
      }),
      now,
    });

    expect(display.main).toMatchObject({
      statusLabel: "곧 사용 가능",
      secondsUntilAlert: 4,
      tone: "alert",
      isUrgent: true,
    });
  });
});
