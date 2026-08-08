import { describe, expect, it } from "vitest";
import type { SkillConfig } from "../types";
import { DEFAULT_ALERT_SOUND_ID } from "./sounds";
import {
  ALERT_THRESHOLD_MAX_SECONDS,
  ALERT_THRESHOLD_MIN_SECONDS,
  CLASS_INSTALL_ALERT_THRESHOLD_MIN_SECONDS,
  applyInitialAlertDelay,
  applyRecognitionResult,
  clampAlertThresholdSeconds,
  createRuntimeState,
  getEstimatedRemainingSeconds,
  getSkillAlertInRemainingCount,
  getSkillAlertInSeconds,
  getSkillInitialAlertCountdownParts,
  markAlerted,
  markAlertPlaybackFinished,
  markRepeatedAlert,
  sampleInitialAlertDelaySeconds,
  shouldFireAlert,
  shouldFireRemainingCountAlert,
  shouldRepeatAlert,
  startManualCycle,
} from "./timer";

const skill: SkillConfig = {
  id: "skill_a",
  name: "test",
  countdownSource: "duration",
  durationSeconds: 60,
  alertThresholdSeconds: 5,
  recognitionStartSeconds: 60,
  region: null,
  recognitionMode: "digit-template",
  soundId: DEFAULT_ALERT_SOUND_ID,
  volume: 0.85,
  enabled: true,
};

const tenSecondAlertSkill: SkillConfig = {
  ...skill,
  id: "skill_b",
  alertThresholdSeconds: 10,
};

const cooldownSourceSkill: SkillConfig = {
  ...skill,
  id: "skill_c",
  countdownSource: "cooldown",
  durationSeconds: 120,
  recognitionStartSeconds: 55,
  alertThresholdSeconds: 5,
};

const solJanusSkill: SkillConfig = {
  ...skill,
  id: "skill_sol",
  name: "솔 야누스 : 새벽",
  presetId: "sol-janus-dawn-2min",
  countdownSource: "cooldown",
  durationSeconds: 120,
  cooldownDurationSeconds: 56,
  recognitionStartSeconds: 55,
  alertThresholdSeconds: 5,
};

const oneMinuteSolJanusSkill: SkillConfig = {
  ...solJanusSkill,
  id: "skill_sol_1min",
  presetId: "sol-janus-dawn-1min",
  durationSeconds: 60,
  alertThresholdSeconds: 5,
};

const seventySecondSolJanusSkill: SkillConfig = {
  ...solJanusSkill,
  id: "skill_sol_70s",
  presetId: "sol-janus-dawn-70s",
  durationSeconds: 70,
};

const eightySecondSolJanusSkill: SkillConfig = {
  ...solJanusSkill,
  id: "skill_sol_80s",
  presetId: "sol-janus-dawn-80s",
  durationSeconds: 80,
};

const cooldownOffsetSkill: SkillConfig = {
  ...skill,
  id: "skill_d",
  name: "쿨타임 보정 설치기",
  presetId: "class-install",
  countdownSource: "cooldown",
  durationSeconds: 120,
  cooldownDurationSeconds: 90,
  recognitionStartSeconds: 55,
  alertThresholdSeconds: 5,
};

const erdaFountainSkill: SkillConfig = {
  ...skill,
  id: "skill_erda",
  name: "에르다 파운틴",
  presetId: "erda-fountain",
  countdownSource: "cooldown",
  durationSeconds: 60,
  cooldownDurationSeconds: 56,
  recognitionStartSeconds: 55,
  alertThresholdSeconds: 5,
};

const customCooldownSourceSkill: SkillConfig = {
  ...skill,
  id: "skill_custom",
  name: "직업 설치기",
  presetId: "class-install",
  countdownSource: "cooldown",
  durationSeconds: 120,
  cooldownDurationSeconds: undefined,
  alertThresholdSeconds: 10,
};

const configuredClassInstallSkill: SkillConfig = {
  ...customCooldownSourceSkill,
  cooldownDurationSeconds: 60,
};

const shortDurationLongCooldownClassInstallSkill: SkillConfig = {
  ...customCooldownSourceSkill,
  id: "skill_short_duration_long_cooldown",
  name: "짧은 지속 긴 쿨 설치기",
  durationSeconds: 43,
  cooldownDurationSeconds: 114,
  alertThresholdSeconds: 1,
};

function applyRecognitionSequence(
  initialState: ReturnType<typeof createRuntimeState>,
  readings: number[],
  config: SkillConfig,
  startAt = 1_000,
): ReturnType<typeof createRuntimeState> {
  return readings.reduce(
    (state, value, index) =>
      applyRecognitionResult(state, { value, confidence: 0.95 }, config, startAt + index * 450),
    initialState,
  );
}

function startStableCooldownTimer(
  config: SkillConfig,
  readings: number[],
  startAt = 1_000,
): ReturnType<typeof createRuntimeState> {
  return applyRecognitionSequence(createRuntimeState(config.id), readings, config, startAt);
}

describe("timer state", () => {
  it("clamps alert threshold to the supported sub-minute range", () => {
    expect(clampAlertThresholdSeconds(-999)).toBe(ALERT_THRESHOLD_MIN_SECONDS);
    expect(clampAlertThresholdSeconds(999)).toBe(ALERT_THRESHOLD_MAX_SECONDS);
    expect(clampAlertThresholdSeconds(-2.4)).toBe(-2);
    expect(clampAlertThresholdSeconds(10.4)).toBe(10);
    expect(clampAlertThresholdSeconds(Number.NaN)).toBe(ALERT_THRESHOLD_MIN_SECONDS);
  });

  it("allows class install alerts farther after expiry", () => {
    expect(clampAlertThresholdSeconds(-999, { presetId: "class-install" })).toBe(
      CLASS_INSTALL_ALERT_THRESHOLD_MIN_SECONDS,
    );
    expect(clampAlertThresholdSeconds(-18.4, { presetId: "class-install" })).toBe(-18);
    expect(clampAlertThresholdSeconds(Number.NaN, { presetId: "class-install" })).toBe(
      CLASS_INSTALL_ALERT_THRESHOLD_MIN_SECONDS,
    );
  });

  it("does not start from a near-alert first recognition", () => {
    const next = applyRecognitionResult(
      createRuntimeState(skill.id),
      { value: 12, confidence: 0.9 },
      skill,
      1_000,
    );

    expect(next.status).toBe("detecting");
    expect(next.observedRemainingSeconds).toBeNull();
    expect(next.rejectedReading).toBe(12);
    expect(next.estimatedExpiresAt).toBeNull();
  });

  it("uses trusted sub-minute anchor recognition as the estimated expiry", () => {
    const next = applyRecognitionResult(
      createRuntimeState(skill.id),
      { value: 58, confidence: 0.9 },
      skill,
      1_000,
    );

    expect(next.status).toBe("running");
    expect(next.observedRemainingSeconds).toBe(58);
    expect(getEstimatedRemainingSeconds(next, 6_000)).toBe(53);
  });

  it("fires only once per countdown cycle", () => {
    const running = startManualCycle(createRuntimeState(skill.id), skill, 1_000);
    const nearExpiry = { ...running, estimatedExpiresAt: 5_000 };

    expect(shouldFireAlert(nearExpiry, skill, 1_000)).toBe(true);

    const alerted = markAlerted(nearExpiry, 1_000);
    expect(shouldFireAlert(alerted, skill, 2_000)).toBe(false);
  });

  it("supports alerting after expiry with a negative threshold", () => {
    const afterExpirySkill = { ...skill, alertThresholdSeconds: -2 };
    const running = startManualCycle(createRuntimeState(skill.id), afterExpirySkill, 1_000);
    const nearExpiry = { ...running, estimatedExpiresAt: 5_000 };

    expect(shouldFireAlert(nearExpiry, afterExpirySkill, 5_000)).toBe(false);
    expect(shouldFireAlert(nearExpiry, afterExpirySkill, 6_999)).toBe(false);
    expect(shouldFireAlert(nearExpiry, afterExpirySkill, 7_000)).toBe(true);
  });

  it("delays the first alert by the sampled initial alert delay", () => {
    const running = startManualCycle(createRuntimeState(skill.id), skill, 1_000);
    const delayed = applyInitialAlertDelay(
      { ...running, estimatedExpiresAt: 10_000 },
      true,
      () => 1.5,
    );

    expect(delayed.initialAlertDelaySeconds).toBe(1.5);
    expect(delayed.initialAlertDelayCycleStartedAt).toBe(1_000);
    expect(shouldFireAlert(delayed, skill, 6_499)).toBe(false);
    expect(shouldFireAlert(delayed, skill, 6_500)).toBe(true);
    expect(getSkillAlertInSeconds(delayed, skill, 1_000)).toBe(5.5);
    expect(getSkillInitialAlertCountdownParts(delayed, skill, 1_000)).toEqual({
      baseSeconds: 4,
      delaySeconds: 1.5,
      hasInitialDelay: true,
    });
  });

  it("counts the base threshold before the sampled initial alert delay", () => {
    const running = startManualCycle(createRuntimeState(skill.id), skill, 1_000);
    const delayed = applyInitialAlertDelay(
      { ...running, estimatedExpiresAt: 10_000 },
      true,
      () => 1.5,
    );

    expect(getSkillInitialAlertCountdownParts(delayed, skill, 1_000)).toEqual({
      baseSeconds: 4,
      delaySeconds: 1.5,
      hasInitialDelay: true,
    });
    expect(getSkillInitialAlertCountdownParts(delayed, skill, 1_500)).toEqual({
      baseSeconds: 3,
      delaySeconds: 1.5,
      hasInitialDelay: true,
    });
    expect(getSkillInitialAlertCountdownParts(delayed, skill, 5_000)).toEqual({
      baseSeconds: 0,
      delaySeconds: 1.5,
      hasInitialDelay: true,
    });
    expect(getSkillInitialAlertCountdownParts(delayed, skill, 6_000)).toEqual({
      baseSeconds: 0,
      delaySeconds: 0.5,
      hasInitialDelay: true,
    });
  });

  it("samples initial alert delay in half-second buckets", () => {
    expect(sampleInitialAlertDelaySeconds(() => 0)).toBe(0);
    expect(sampleInitialAlertDelaySeconds(() => 0.2)).toBe(0.5);
    expect(sampleInitialAlertDelaySeconds(() => 0.4)).toBe(1);
    expect(sampleInitialAlertDelaySeconds(() => 0.6)).toBe(1.5);
    expect(sampleInitialAlertDelaySeconds(() => 0.8)).toBe(2);
    expect(sampleInitialAlertDelaySeconds(() => 1)).toBe(2);
  });

  it("does not fire alerts for disabled skills even when the estimate is due", () => {
    const running = startManualCycle(createRuntimeState(skill.id), skill, 1_000);
    const due = { ...running, estimatedExpiresAt: 2_000 };

    expect(shouldFireAlert(due, { ...skill, enabled: false }, 2_000)).toBe(false);
  });

  it("repeats an early alert after the playback interval", () => {
    const repeatSkill = {
      ...skill,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
    };
    const running = startManualCycle(createRuntimeState(skill.id), repeatSkill, 1_000);
    const alerted = markAlerted({ ...running, estimatedExpiresAt: 3_000 }, 1_500);

    const playbackFinished = markAlertPlaybackFinished(alerted, 1_500, 1_900);
    const delayedPlaybackFinished = applyInitialAlertDelay(
      playbackFinished,
      true,
      () => 2,
    );
    expect(delayedPlaybackFinished.lastRepeatedAlertAt).toBe(1_900);
    expect(shouldRepeatAlert(delayedPlaybackFinished, repeatSkill, 4_899)).toBe(false);
    expect(shouldRepeatAlert(delayedPlaybackFinished, repeatSkill, 4_900)).toBe(true);

    const repeated = markRepeatedAlert(delayedPlaybackFinished, 4_900);
    expect(shouldRepeatAlert(repeated, repeatSkill, 8_299)).toBe(false);

    const repeatedFinished = markAlertPlaybackFinished(repeated, 1_500, 5_300);
    expect(shouldRepeatAlert(repeatedFinished, repeatSkill, 8_299)).toBe(false);
    expect(shouldRepeatAlert(repeatedFinished, repeatSkill, 8_300)).toBe(true);

    const rearmed = applyRecognitionResult(
      repeatedFinished,
      { value: 58, confidence: 0.95 },
      repeatSkill,
      8_400,
    );
    expect(rearmed.alertedAt).toBeNull();
    expect(shouldRepeatAlert(rearmed, repeatSkill, 11_000)).toBe(false);
  });

  it("does not repeat an alert when repeat alerts are disabled", () => {
    const running = startManualCycle(createRuntimeState(skill.id), skill, 1_000);
    const alerted = markAlerted({ ...running, estimatedExpiresAt: 3_000 }, 1_500);
    const playbackFinished = markAlertPlaybackFinished(alerted, 1_500, 1_900);

    expect(playbackFinished.lastRepeatedAlertAt).toBe(1_900);
    expect(shouldRepeatAlert(playbackFinished, skill, 60_000)).toBe(false);
  });

  it("repeats an alert after a negative alert threshold fires", () => {
    const repeatSkill = {
      ...skill,
      alertThresholdSeconds: -2,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
    };
    const running = startManualCycle(createRuntimeState(skill.id), repeatSkill, 1_000);
    const nearExpiry = { ...running, estimatedExpiresAt: 5_000 };

    expect(shouldFireAlert(nearExpiry, repeatSkill, 6_999)).toBe(false);
    expect(shouldFireAlert(nearExpiry, repeatSkill, 7_000)).toBe(true);

    const alerted = markAlerted(nearExpiry, 7_000);
    const playbackFinished = markAlertPlaybackFinished(alerted, 7_000, 7_400);

    expect(shouldRepeatAlert(playbackFinished, repeatSkill, 10_399)).toBe(false);
    expect(shouldRepeatAlert(playbackFinished, repeatSkill, 10_400)).toBe(true);
  });

  it("stops repeating after the configured repeat count", () => {
    const repeatSkill = {
      ...skill,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 2,
      repeatAlertMaxCount: 2,
    };
    const running = startManualCycle(createRuntimeState(skill.id), repeatSkill, 1_000);
    const alerted = markAlerted({ ...running, estimatedExpiresAt: 3_000 }, 1_500);
    const firstFinished = markAlertPlaybackFinished(alerted, 1_500, 1_900);

    expect(shouldRepeatAlert(firstFinished, repeatSkill, 3_899)).toBe(false);
    expect(shouldRepeatAlert(firstFinished, repeatSkill, 3_900)).toBe(true);
    const firstRepeat = markRepeatedAlert(firstFinished, 3_900);
    expect(firstRepeat.repeatedAlertCount).toBe(1);

    const secondFinished = markAlertPlaybackFinished(firstRepeat, 1_500, 4_300);
    expect(shouldRepeatAlert(secondFinished, repeatSkill, 6_299)).toBe(false);
    expect(shouldRepeatAlert(secondFinished, repeatSkill, 6_300)).toBe(true);
    const secondRepeat = markRepeatedAlert(secondFinished, 6_300);
    expect(secondRepeat.repeatedAlertCount).toBe(2);

    const exhausted = markAlertPlaybackFinished(secondRepeat, 1_500, 6_700);
    expect(shouldRepeatAlert(exhausted, repeatSkill, 8_700)).toBe(false);

    const rearmed = applyRecognitionResult(
      exhausted,
      { value: 58, confidence: 0.95 },
      repeatSkill,
      8_800,
    );
    expect(rearmed.alertedAt).toBeNull();
    expect(rearmed.repeatedAlertCount).toBe(0);
  });

  it("does not start a timer or fire from a single first reading at the alert threshold", () => {
    const state = applyRecognitionResult(
      createRuntimeState(tenSecondAlertSkill.id),
      { value: 10, confidence: 0.98 },
      tenSecondAlertSkill,
      1_000,
    );

    expect(state.status).toBe("detecting");
    expect(state.rejectedReading).toBe(10);
    expect(state.estimatedExpiresAt).toBeNull();
    expect(shouldFireAlert(state, tenSecondAlertSkill, 1_000)).toBe(false);
  });

  it("locks the countdown from an early enough OCR reading and alerts from the local estimate", () => {
    const locked = applyRecognitionResult(
      createRuntimeState(tenSecondAlertSkill.id),
      { value: 50, confidence: 0.95 },
      tenSecondAlertSkill,
      1_000,
    );

    expect(locked.status).toBe("running");
    expect(locked.observedRemainingSeconds).toBe(50);
    expect(shouldFireAlert(locked, tenSecondAlertSkill, 40_000)).toBe(false);
    expect(shouldFireAlert(locked, tenSecondAlertSkill, 41_000)).toBe(true);
  });

  it("uses a cooldown reading as an install start signal", () => {
    const first = applyRecognitionResult(
      createRuntimeState(cooldownSourceSkill.id),
      { value: 55, confidence: 0.95 },
      cooldownSourceSkill,
      1_000,
    );
    const second = applyRecognitionResult(
      first,
      { value: 55, confidence: 0.95 },
      cooldownSourceSkill,
      1_450,
    );
    const locked = applyRecognitionResult(
      second,
      { value: 55, confidence: 0.95 },
      cooldownSourceSkill,
      1_900,
    );

    expect(first.status).toBe("detecting");
    expect(second.status).toBe("detecting");
    expect(locked.status).toBe("running");
    expect(locked.observedRemainingSeconds).toBe(120);
    expect(getEstimatedRemainingSeconds(locked, 6_900)).toBe(115);
    expect(shouldFireAlert(locked, cooldownSourceSkill, 115_900)).toBe(false);
    expect(shouldFireAlert(locked, cooldownSourceSkill, 116_900)).toBe(true);
  });

  it("does not start a cooldown timer from dense icon-like visual noise", () => {
    const noisyResult = {
      value: 55,
      confidence: 0.95,
      debug: { digitCount: 2, foregroundRatio: 0.38, recognizedText: "55" },
    };
    const first = applyRecognitionResult(
      createRuntimeState(solJanusSkill.id),
      noisyResult,
      solJanusSkill,
      1_000,
    );
    const second = applyRecognitionResult(first, noisyResult, solJanusSkill, 1_450);
    const third = applyRecognitionResult(second, noisyResult, solJanusSkill, 1_900);

    expect(third.status).toBe("detecting");
    expect(third.observedRemainingSeconds).toBeNull();
    expect(third.estimatedExpiresAt).toBeNull();
    expect(third.rejectedReading).toBe(55);
  });

  it("still starts a cooldown timer from sparse cooldown digit readings", () => {
    const sparseResult = {
      value: 55,
      confidence: 0.95,
      debug: { digitCount: 2, foregroundRatio: 0.06, recognizedText: "55" },
    };
    const first = applyRecognitionResult(
      createRuntimeState(solJanusSkill.id),
      sparseResult,
      solJanusSkill,
      1_000,
    );
    const second = applyRecognitionResult(first, sparseResult, solJanusSkill, 1_450);
    const locked = applyRecognitionResult(second, sparseResult, solJanusSkill, 1_900);

    expect(locked.status).toBe("running");
    expect(locked.observedRemainingSeconds).toBe(119);
    expect(locked.rejectedReading).toBeNull();
  });

  it("keeps the first cooldown-source install expiry while the cooldown keeps counting", () => {
    const first = startStableCooldownTimer(cooldownSourceSkill, [55, 55, 55]);
    const next = applyRecognitionResult(
      first,
      { value: 52, confidence: 0.95 },
      cooldownSourceSkill,
      4_000,
    );

    expect(next.rejectedReading).toBeNull();
    expect(next.observedRemainingSeconds).toBe(120);
    expect(next.estimatedExpiresAt).toBe(121_900);
    expect(getEstimatedRemainingSeconds(next, 4_000)).toBe(117);
  });

  it("rejects cooldown-source readings above the supported start window", () => {
    const next = applyRecognitionResult(
      createRuntimeState(cooldownSourceSkill.id),
      { value: 82, confidence: 0.95 },
      cooldownSourceSkill,
      1_000,
    );

    expect(next.status).toBe("detecting");
    expect(next.rejectedReading).toBe(82);
    expect(next.estimatedExpiresAt).toBeNull();
  });

  it("keeps a locked cooldown-source timer when the ready icon produces an out-of-range OCR value", () => {
    const locked = startStableCooldownTimer(cooldownSourceSkill, [55, 55, 55]);
    const next = applyRecognitionResult(
      locked,
      { value: 120, confidence: 0.95 },
      cooldownSourceSkill,
      56_000,
    );

    expect(next.status).toBe("running");
    expect(next.rejectedReading).toBeNull();
    expect(next.estimatedExpiresAt).toBe(121_900);
    expect(getEstimatedRemainingSeconds(next, 56_000)).toBe(65);
  });

  it("rearms an alerted cooldown-source timer from the next cooldown reading", () => {
    const alerted = markAlerted(
      {
        ...startManualCycle(createRuntimeState(cooldownSourceSkill.id), cooldownSourceSkill, 1_000),
        estimatedExpiresAt: 3_000,
      },
      1_500,
    );
    const first = applyRecognitionResult(
      alerted,
      { value: 55, confidence: 0.95 },
      cooldownSourceSkill,
      50_000,
    );
    const second = applyRecognitionResult(first, { value: 55, confidence: 0.95 }, cooldownSourceSkill, 50_450);
    const next = applyRecognitionResult(second, { value: 55, confidence: 0.95 }, cooldownSourceSkill, 50_900);

    expect(next.status).toBe("running");
    expect(next.alertedAt).toBeNull();
    expect(next.observedRemainingSeconds).toBe(120);
    expect(next.estimatedExpiresAt).toBe(170_900);
  });

  it("derives install remaining time from a longer cooldown preset", () => {
    const locked = startStableCooldownTimer(cooldownOffsetSkill, [59, 59, 59]);

    expect(locked.status).toBe("running");
    expect(locked.observedRemainingSeconds).toBe(89);
    expect(getEstimatedRemainingSeconds(locked, 6_900)).toBe(84);
    expect(shouldFireAlert(locked, cooldownOffsetSkill, 84_900)).toBe(false);
    expect(shouldFireAlert(locked, cooldownOffsetSkill, 85_900)).toBe(true);
  });

  it("accepts full 90 second cooldown readings for the cooldown-offset preset", () => {
    const locked = startStableCooldownTimer(cooldownOffsetSkill, [90, 90, 90]);

    expect(locked.status).toBe("running");
    expect(locked.observedRemainingSeconds).toBe(120);
    expect(getEstimatedRemainingSeconds(locked, 6_900)).toBe(115);
  });

  it("uses derived install remaining time for the cooldown-offset alert lead check", () => {
    const highThresholdSkill = {
      ...cooldownOffsetSkill,
      alertThresholdSeconds: 54,
    };
    const locked = startStableCooldownTimer(highThresholdSkill, [55, 55, 55]);

    expect(locked.status).toBe("running");
    expect(locked.observedRemainingSeconds).toBe(85);
  });

  it("uses Sol Janus effective 56 second cooldown to derive install remaining time", () => {
    const locked = startStableCooldownTimer(solJanusSkill, [56, 56, 56]);

    expect(locked.status).toBe("running");
    expect(locked.effectiveCooldownDurationSeconds).toBe(56);
    expect(locked.observedRemainingSeconds).toBe(120);
    expect(getEstimatedRemainingSeconds(locked, 6_900)).toBe(115);
  });

  it("derives install remaining time for 70 and 80 second Sol Janus presets", () => {
    const seventySecondLocked = startStableCooldownTimer(seventySecondSolJanusSkill, [56, 56, 56]);
    const eightySecondLocked = startStableCooldownTimer(eightySecondSolJanusSkill, [56, 56, 56]);

    expect(seventySecondLocked.status).toBe("running");
    expect(seventySecondLocked.effectiveCooldownDurationSeconds).toBe(56);
    expect(seventySecondLocked.observedRemainingSeconds).toBe(70);
    expect(getEstimatedRemainingSeconds(seventySecondLocked, 6_900)).toBe(65);

    expect(eightySecondLocked.status).toBe("running");
    expect(eightySecondLocked.effectiveCooldownDurationSeconds).toBe(56);
    expect(eightySecondLocked.observedRemainingSeconds).toBe(80);
    expect(getEstimatedRemainingSeconds(eightySecondLocked, 6_900)).toBe(75);
  });

  it("uses a mid-cycle Sol Janus cooldown reading when setup starts after install", () => {
    const first = applyRecognitionResult(
      createRuntimeState(solJanusSkill.id),
      { value: 30, confidence: 0.95 },
      solJanusSkill,
      1_000,
    );
    const second = applyRecognitionResult(first, { value: 30, confidence: 0.95 }, solJanusSkill, 1_450);
    const locked = applyRecognitionResult(second, { value: 29, confidence: 0.95 }, solJanusSkill, 1_900);

    expect(first.estimatedExpiresAt).toBeNull();
    expect(second.estimatedExpiresAt).toBeNull();
    expect(locked.status).toBe("running");
    expect(locked.effectiveCooldownDurationSeconds).toBe(56);
    expect(locked.observedRemainingSeconds).toBe(93);
    expect(getEstimatedRemainingSeconds(locked, 6_900)).toBe(88);
  });

  it("does not start Sol Janus from repeated ready-icon OCR noise", () => {
    const first = applyRecognitionResult(
      createRuntimeState(solJanusSkill.id),
      { value: 0, confidence: 0.95 },
      solJanusSkill,
      1_000,
    );
    const second = applyRecognitionResult(first, { value: 0, confidence: 0.95 }, solJanusSkill, 1_450);
    const third = applyRecognitionResult(second, { value: 0, confidence: 0.95 }, solJanusSkill, 1_900);

    expect(third.status).toBe("detecting");
    expect(third.observedRemainingSeconds).toBeNull();
    expect(third.estimatedExpiresAt).toBeNull();
    expect(third.pendingShortAnchor).toBeNull();
    expect(third.rejectedReading).toBe(0);
  });

  it("does not start Sol Janus from repeated static hotkey labels", () => {
    const first = applyRecognitionResult(
      createRuntimeState(solJanusSkill.id),
      { value: 9, confidence: 0.95 },
      solJanusSkill,
      1_000,
    );
    const second = applyRecognitionResult(first, { value: 9, confidence: 0.95 }, solJanusSkill, 1_450);
    const third = applyRecognitionResult(second, { value: 8, confidence: 0.95 }, solJanusSkill, 1_900);

    expect(third.status).toBe("detecting");
    expect(third.observedRemainingSeconds).toBeNull();
    expect(third.estimatedExpiresAt).toBeNull();
    expect(third.pendingShortAnchor).toBeNull();
    expect(third.rejectedReading).toBe(8);
  });

  it("auto-calibrates Sol Janus when the visible cooldown starts above the default", () => {
    const locked = startStableCooldownTimer(solJanusSkill, [58, 58, 58]);

    expect(locked.status).toBe("running");
    expect(locked.effectiveCooldownDurationSeconds).toBe(58);
    expect(locked.observedRemainingSeconds).toBe(120);
  });

  it("does not start Erda Fountain from a single initial-window OCR spike", () => {
    const next = applyRecognitionResult(
      createRuntimeState(erdaFountainSkill.id),
      { value: 50, confidence: 0.95 },
      erdaFountainSkill,
      1_000,
    );

    expect(next.status).toBe("detecting");
    expect(next.estimatedExpiresAt).toBeNull();
    expect(next.pendingShortAnchor?.count).toBe(1);
    expect(next.rejectedReading).toBe(50);
  });

  it("does not start Erda Fountain from repeated ready-icon or hotkey OCR noise", () => {
    const next = applyRecognitionSequence(
      createRuntimeState(erdaFountainSkill.id),
      [0, 8, 9, 10],
      erdaFountainSkill,
    );

    expect(next.status).toBe("detecting");
    expect(next.observedRemainingSeconds).toBeNull();
    expect(next.estimatedExpiresAt).toBeNull();
    expect(next.pendingShortAnchor).toBeNull();
    expect(next.rejectedReading).toBe(10);
  });

  it("does not start Erda Fountain when an initial-window spike is followed by recognition failure", () => {
    const first = applyRecognitionResult(
      createRuntimeState(erdaFountainSkill.id),
      { value: 50, confidence: 0.95 },
      erdaFountainSkill,
      1_000,
    );
    const failed = applyRecognitionResult(
      first,
      { value: null, confidence: 0 },
      erdaFountainSkill,
      1_450,
    );

    expect(first.pendingShortAnchor?.count).toBe(1);
    expect(failed.status).toBe("detecting");
    expect(failed.estimatedExpiresAt).toBeNull();
    expect(failed.pendingShortAnchor).toBeNull();
  });

  it("does not start Erda Fountain when initial-window readings are unstable", () => {
    const next = applyRecognitionSequence(
      createRuntimeState(erdaFountainSkill.id),
      [50, 0, 50],
      erdaFountainSkill,
    );

    expect(next.status).toBe("detecting");
    expect(next.observedRemainingSeconds).toBeNull();
    expect(next.estimatedExpiresAt).toBeNull();
    expect(next.pendingShortAnchor?.count).toBe(1);
    expect(next.rejectedReading).toBe(50);
  });

  it("starts Erda Fountain from stable mid-cooldown readings", () => {
    const first = applyRecognitionResult(
      createRuntimeState(erdaFountainSkill.id),
      { value: 50, confidence: 0.95 },
      erdaFountainSkill,
      1_000,
    );
    const second = applyRecognitionResult(first, { value: 50, confidence: 0.95 }, erdaFountainSkill, 1_450);
    const locked = applyRecognitionResult(second, { value: 49, confidence: 0.95 }, erdaFountainSkill, 1_900);

    expect(locked.status).toBe("running");
    expect(locked.effectiveCooldownDurationSeconds).toBe(56);
    expect(locked.observedRemainingSeconds).toBe(53);
    expect(getEstimatedRemainingSeconds(locked, 6_900)).toBe(48);
  });

  it("starts custom cooldown-source skills from stable readings without a preset cooldown", () => {
    const first = applyRecognitionResult(
      createRuntimeState(customCooldownSourceSkill.id),
      { value: 58, confidence: 0.95 },
      customCooldownSourceSkill,
      1_000,
    );
    const second = applyRecognitionResult(
      first,
      { value: 58, confidence: 0.95 },
      customCooldownSourceSkill,
      1_450,
    );
    const locked = applyRecognitionResult(
      second,
      { value: 57, confidence: 0.95 },
      customCooldownSourceSkill,
      1_900,
    );

    expect(first.estimatedExpiresAt).toBeNull();
    expect(second.estimatedExpiresAt).toBeNull();
    expect(locked.status).toBe("running");
    expect(locked.effectiveCooldownDurationSeconds).toBe(58);
    expect(locked.observedRemainingSeconds).toBe(119);
  });

  it("derives class install remaining time from a configured cooldown after mid-cycle sharing", () => {
    const locked = startStableCooldownTimer(configuredClassInstallSkill, [30, 30, 30]);

    expect(locked.status).toBe("running");
    expect(locked.effectiveCooldownDurationSeconds).toBe(60);
    expect(locked.observedRemainingSeconds).toBe(90);
    expect(locked.estimatedExpiresAt).toBe(91_900);
  });

  it("accepts class install cooldown readings above the old sub-minute tracking window", () => {
    const longCooldownClassInstallSkill: SkillConfig = {
      ...configuredClassInstallSkill,
      durationSeconds: 180,
      cooldownDurationSeconds: 90,
    };

    const locked = startStableCooldownTimer(longCooldownClassInstallSkill, [80, 80, 80]);

    expect(locked.status).toBe("running");
    expect(locked.rejectedReading).toBeNull();
    expect(locked.effectiveCooldownDurationSeconds).toBe(90);
    expect(locked.observedRemainingSeconds).toBe(170);
  });

  it("rearms a short-duration class install after its longer cooldown recovers", () => {
    const locked = startStableCooldownTimer(
      shortDurationLongCooldownClassInstallSkill,
      [114, 114, 113],
    );
    const alerted = markAlerted(
      {
        ...locked,
        estimatedExpiresAt: 43_900,
      },
      42_900,
    );

    const earlyFirst = applyRecognitionResult(
      alerted,
      { value: 114, confidence: 0.95 },
      shortDurationLongCooldownClassInstallSkill,
      60_000,
    );
    const earlySecond = applyRecognitionResult(
      earlyFirst,
      { value: 114, confidence: 0.95 },
      shortDurationLongCooldownClassInstallSkill,
      60_450,
    );
    const earlyThird = applyRecognitionResult(
      earlySecond,
      { value: 113, confidence: 0.95 },
      shortDurationLongCooldownClassInstallSkill,
      60_900,
    );

    expect(earlyThird.alertedAt).toBe(42_900);
    expect(earlyThird.estimatedExpiresAt).toBe(43_900);

    const recoveredFirst = applyRecognitionResult(
      earlyThird,
      { value: 114, confidence: 0.95 },
      shortDurationLongCooldownClassInstallSkill,
      110_000,
    );
    const recoveredSecond = applyRecognitionResult(
      recoveredFirst,
      { value: 114, confidence: 0.95 },
      shortDurationLongCooldownClassInstallSkill,
      110_450,
    );
    const rearmed = applyRecognitionResult(
      recoveredSecond,
      { value: 113, confidence: 0.95 },
      shortDurationLongCooldownClassInstallSkill,
      110_900,
    );

    expect(rearmed.alertedAt).toBeNull();
    expect(rearmed.status).toBe("running");
    expect(rearmed.effectiveCooldownDurationSeconds).toBe(114);
    expect(rearmed.observedRemainingSeconds).toBe(42);
    expect(rearmed.estimatedExpiresAt).toBe(152_900);
  });

  it("does not rearm a short-duration class install from stale low cooldown readings", () => {
    const alerted = {
      ...markAlerted(
        {
          ...startStableCooldownTimer(
            shortDurationLongCooldownClassInstallSkill,
            [114, 114, 113],
          ),
          estimatedExpiresAt: 43_900,
        },
        42_900,
      ),
      effectiveCooldownDurationSeconds: 114,
    };

    const next = applyRecognitionResult(
      alerted,
      { value: 42, confidence: 0.95 },
      shortDurationLongCooldownClassInstallSkill,
      600_000,
    );

    expect(next.alertedAt).toBe(42_900);
    expect(next.status).toBe("alerted");
    expect(next.estimatedExpiresAt).toBe(43_900);
    expect(next.rejectedReading).toBe(42);
  });

  it("keeps class install duration and cooldown independent when calculating remaining time", () => {
    const offsetClassInstallSkill: SkillConfig = {
      ...configuredClassInstallSkill,
      durationSeconds: 120,
      cooldownDurationSeconds: 55,
    };

    const locked = startStableCooldownTimer(offsetClassInstallSkill, [54, 54, 54]);

    expect(locked.status).toBe("running");
    expect(locked.effectiveCooldownDurationSeconds).toBe(55);
    expect(locked.observedRemainingSeconds).toBe(119);
  });

  it("does not rearm Sol Janus from a single suspicious high cooldown reading", () => {
    const locked = {
      ...startStableCooldownTimer(solJanusSkill, [56, 56, 56]),
      estimatedExpiresAt: 121_000,
    };

    const next = applyRecognitionResult(
      locked,
      { value: 56, confidence: 0.95 },
      solJanusSkill,
      101_000,
    );

    expect(next.status).toBe("running");
    expect(next.estimatedExpiresAt).toBe(121_000);
    expect(next.pendingShortAnchor?.count).toBe(1);
    expect(getEstimatedRemainingSeconds(next, 101_000)).toBe(20);
  });

  it("keeps Sol Janus locked when low OCR readings appear near the alert window", () => {
    const locked = {
      ...startStableCooldownTimer(solJanusSkill, [56, 56, 56]),
      estimatedExpiresAt: 121_000,
    };

    const first = applyRecognitionResult(locked, { value: 10, confidence: 0.95 }, solJanusSkill, 110_000);
    const second = applyRecognitionResult(first, { value: 10, confidence: 0.95 }, solJanusSkill, 110_450);
    const third = applyRecognitionResult(second, { value: 9, confidence: 0.95 }, solJanusSkill, 110_900);

    expect(third.pendingShortAnchor).toBeNull();
    expect(third.estimatedExpiresAt).toBe(121_000);
    expect(getEstimatedRemainingSeconds(third, 110_900)).toBe(10);
    expect(shouldFireAlert(third, solJanusSkill, 116_000)).toBe(true);
  });

  it("does not rearm Sol Janus before the current cooldown could have recovered", () => {
    const locked = {
      ...startStableCooldownTimer(solJanusSkill, [56, 56, 56]),
      estimatedExpiresAt: 121_000,
    };

    const first = applyRecognitionResult(locked, { value: 56, confidence: 0.95 }, solJanusSkill, 30_000);
    const second = applyRecognitionResult(first, { value: 56, confidence: 0.95 }, solJanusSkill, 30_450);
    const third = applyRecognitionResult(second, { value: 55, confidence: 0.95 }, solJanusSkill, 30_900);

    expect(third.pendingShortAnchor).toBeNull();
    expect(third.estimatedExpiresAt).toBe(121_000);
    expect(getEstimatedRemainingSeconds(third, 30_900)).toBe(90);
  });

  it("rearms Sol Janus only after stable repeated cooldown readings", () => {
    const locked = {
      ...startStableCooldownTimer(solJanusSkill, [56, 56, 56]),
      estimatedExpiresAt: 121_000,
    };

    const first = applyRecognitionResult(locked, { value: 56, confidence: 0.95 }, solJanusSkill, 101_000);
    const second = applyRecognitionResult(first, { value: 56, confidence: 0.95 }, solJanusSkill, 101_450);
    const rearmed = applyRecognitionResult(second, { value: 55, confidence: 0.95 }, solJanusSkill, 101_900);

    expect(rearmed.pendingShortAnchor).toBeNull();
    expect(rearmed.observedRemainingSeconds).toBe(119);
    expect(getEstimatedRemainingSeconds(rearmed, 106_900)).toBe(114);
    expect(rearmed.estimatedExpiresAt).toBe(220_900);
  });

  it("rearms alerted Sol Janus from stable mid-cooldown readings after the previous alert", () => {
    const alerted = {
      ...markAlerted(
        {
          ...startStableCooldownTimer(solJanusSkill, [56, 56, 56]),
          estimatedExpiresAt: 121_000,
        },
        116_000,
      ),
      effectiveCooldownDurationSeconds: 56,
    };

    const first = applyRecognitionResult(alerted, { value: 34, confidence: 0.95 }, solJanusSkill, 180_000);
    const second = applyRecognitionResult(first, { value: 34, confidence: 0.95 }, solJanusSkill, 180_450);
    const rearmed = applyRecognitionResult(second, { value: 33, confidence: 0.95 }, solJanusSkill, 180_900);

    expect(first.alertedAt).toBe(116_000);
    expect(second.alertedAt).toBe(116_000);
    expect(rearmed.alertedAt).toBeNull();
    expect(rearmed.status).toBe("running");
    expect(rearmed.observedRemainingSeconds).toBe(97);
    expect(rearmed.estimatedExpiresAt).toBe(277_900);
  });

  it("rearms one-minute Sol Janus near the alert window when cooldown readings stabilize", () => {
    const locked = {
      ...startStableCooldownTimer(oneMinuteSolJanusSkill, [56, 56, 56]),
      estimatedExpiresAt: 61_000,
    };

    const first = applyRecognitionResult(
      locked,
      { value: 56, confidence: 0.95 },
      oneMinuteSolJanusSkill,
      53_000,
    );
    const second = applyRecognitionResult(
      first,
      { value: 56, confidence: 0.95 },
      oneMinuteSolJanusSkill,
      53_450,
    );
    const rearmed = applyRecognitionResult(
      second,
      { value: 55, confidence: 0.95 },
      oneMinuteSolJanusSkill,
      53_900,
    );

    expect(first.estimatedExpiresAt).toBe(61_000);
    expect(second.estimatedExpiresAt).toBe(61_000);
    expect(rearmed.pendingShortAnchor).toBeNull();
    expect(rearmed.observedRemainingSeconds).toBe(59);
    expect(rearmed.estimatedExpiresAt).toBe(112_900);
  });

  it("rearms a locked cooldown-source timer before alert from stable repeated start readings", () => {
    const locked = {
      ...startStableCooldownTimer(customCooldownSourceSkill, [58, 58, 58]),
      estimatedExpiresAt: 121_000,
    };

    const first = applyRecognitionResult(
      locked,
      { value: 58, confidence: 0.95 },
      customCooldownSourceSkill,
      80_000,
    );
    const second = applyRecognitionResult(
      first,
      { value: 58, confidence: 0.95 },
      customCooldownSourceSkill,
      80_450,
    );
    const rearmed = applyRecognitionResult(
      second,
      { value: 57, confidence: 0.95 },
      customCooldownSourceSkill,
      80_900,
    );

    expect(first.estimatedExpiresAt).toBe(121_000);
    expect(second.estimatedExpiresAt).toBe(121_000);
    expect(rearmed.pendingShortAnchor).toBeNull();
    expect(rearmed.effectiveCooldownDurationSeconds).toBe(58);
    expect(rearmed.observedRemainingSeconds).toBe(119);
    expect(rearmed.estimatedExpiresAt).toBe(199_900);
  });

  it("does not rearm a cooldown-source timer before alert from a single start reading", () => {
    const locked = {
      ...startStableCooldownTimer(customCooldownSourceSkill, [58, 58, 58]),
      estimatedExpiresAt: 121_000,
    };

    const next = applyRecognitionResult(
      locked,
      { value: 58, confidence: 0.95 },
      customCooldownSourceSkill,
      80_000,
    );

    expect(next.estimatedExpiresAt).toBe(121_000);
    expect(next.pendingShortAnchor?.count).toBe(1);
  });

  it("does not rearm Erda Fountain before the cooldown has actually recovered", () => {
    const locked = {
      ...startStableCooldownTimer(erdaFountainSkill, [56, 56, 56]),
      estimatedExpiresAt: 61_000,
    };

    const first = applyRecognitionResult(
      locked,
      { value: 56, confidence: 0.95 },
      erdaFountainSkill,
      50_000,
    );
    const second = applyRecognitionResult(
      first,
      { value: 56, confidence: 0.95 },
      erdaFountainSkill,
      50_450,
    );
    const third = applyRecognitionResult(
      second,
      { value: 55, confidence: 0.95 },
      erdaFountainSkill,
      50_900,
    );

    expect(third.pendingShortAnchor).toBeNull();
    expect(third.estimatedExpiresAt).toBe(61_000);
    expect(getEstimatedRemainingSeconds(third, 50_900)).toBe(10);
  });

  it("does not rearm alerted Erda Fountain before the cooldown has actually recovered", () => {
    const alerted = markAlerted(
      {
        ...startStableCooldownTimer(erdaFountainSkill, [56, 56, 56]),
        estimatedExpiresAt: 61_000,
        effectiveCooldownDurationSeconds: 56,
      },
      55_000,
    );

    const first = applyRecognitionResult(
      alerted,
      { value: 56, confidence: 0.95 },
      erdaFountainSkill,
      55_000,
    );
    const second = applyRecognitionResult(
      first,
      { value: 56, confidence: 0.95 },
      erdaFountainSkill,
      55_450,
    );
    const third = applyRecognitionResult(
      second,
      { value: 55, confidence: 0.95 },
      erdaFountainSkill,
      55_900,
    );

    expect(third.alertedAt).toBe(55_000);
    expect(third.estimatedExpiresAt).toBe(61_000);
    expect(shouldFireAlert(third, erdaFountainSkill, 55_900)).toBe(false);
  });

  it("rearms alerted Erda Fountain from stable mid-cooldown readings after cooldown recovery", () => {
    const alerted = markAlerted(
      {
        ...startStableCooldownTimer(erdaFountainSkill, [56, 56, 56]),
        estimatedExpiresAt: 61_000,
        effectiveCooldownDurationSeconds: 56,
      },
      59_000,
    );

    const first = applyRecognitionResult(
      alerted,
      { value: 41, confidence: 0.95 },
      erdaFountainSkill,
      70_000,
    );
    const second = applyRecognitionResult(
      first,
      { value: 41, confidence: 0.95 },
      erdaFountainSkill,
      70_450,
    );
    const rearmed = applyRecognitionResult(
      second,
      { value: 40, confidence: 0.95 },
      erdaFountainSkill,
      70_900,
    );

    expect(first.alertedAt).toBe(59_000);
    expect(second.alertedAt).toBe(59_000);
    expect(rearmed.alertedAt).toBeNull();
    expect(rearmed.status).toBe("running");
    expect(rearmed.pendingShortAnchor).toBeNull();
    expect(rearmed.observedRemainingSeconds).toBe(44);
    expect(rearmed.estimatedExpiresAt).toBe(114_900);
  });

  it("rearms alerted Erda Fountain with a negative alert threshold from recovered readings", () => {
    const delayedAlertSkill = {
      ...erdaFountainSkill,
      alertThresholdSeconds: -3,
    };
    const alerted = markAlerted(
      {
        ...startStableCooldownTimer(delayedAlertSkill, [56, 56, 56]),
        estimatedExpiresAt: 61_000,
        effectiveCooldownDurationSeconds: 56,
      },
      62_000,
    );

    const first = applyRecognitionResult(
      alerted,
      { value: 23, confidence: 0.95 },
      delayedAlertSkill,
      70_000,
    );
    const second = applyRecognitionResult(
      first,
      { value: 23, confidence: 0.95 },
      delayedAlertSkill,
      70_450,
    );
    const rearmed = applyRecognitionResult(
      second,
      { value: 22, confidence: 0.95 },
      delayedAlertSkill,
      70_900,
    );

    expect(rearmed.alertedAt).toBeNull();
    expect(rearmed.status).toBe("running");
    expect(rearmed.observedRemainingSeconds).toBe(26);
    expect(rearmed.estimatedExpiresAt).toBe(96_900);
    expect(shouldFireAlert(rearmed, delayedAlertSkill, 70_900)).toBe(false);
  });

  it("rearms Erda Fountain before alert only after the cooldown has recovered", () => {
    const lowThresholdSkill = {
      ...erdaFountainSkill,
      alertThresholdSeconds: 3,
    };
    const locked = {
      ...startStableCooldownTimer(lowThresholdSkill, [56, 56, 56]),
      estimatedExpiresAt: 61_000,
    };

    const first = applyRecognitionResult(
      locked,
      { value: 56, confidence: 0.95 },
      lowThresholdSkill,
      58_000,
    );
    const second = applyRecognitionResult(
      first,
      { value: 56, confidence: 0.95 },
      lowThresholdSkill,
      58_450,
    );
    const rearmed = applyRecognitionResult(
      second,
      { value: 55, confidence: 0.95 },
      lowThresholdSkill,
      58_900,
    );

    expect(first.estimatedExpiresAt).toBe(61_000);
    expect(second.estimatedExpiresAt).toBe(61_000);
    expect(rearmed.pendingShortAnchor).toBeNull();
    expect(rearmed.observedRemainingSeconds).toBe(59);
    expect(rearmed.estimatedExpiresAt).toBe(117_900);
  });

  it("does not rearm Erda Fountain from a delayed mid-cooldown value before alert", () => {
    const lowThresholdSkill = {
      ...erdaFountainSkill,
      alertThresholdSeconds: 3,
    };
    const locked = {
      ...startStableCooldownTimer(lowThresholdSkill, [56, 56, 56]),
      estimatedExpiresAt: 61_000,
    };

    const first = applyRecognitionResult(
      locked,
      { value: 52, confidence: 0.95 },
      lowThresholdSkill,
      57_000,
    );
    const second = applyRecognitionResult(
      first,
      { value: 52, confidence: 0.95 },
      lowThresholdSkill,
      57_450,
    );
    const third = applyRecognitionResult(
      second,
      { value: 51, confidence: 0.95 },
      lowThresholdSkill,
      57_900,
    );

    expect(third.pendingShortAnchor).toBeNull();
    expect(third.estimatedExpiresAt).toBe(61_000);
  });

  it("holds the stale alert while a cooldown rearm candidate is being confirmed", () => {
    const fiveSecondAlertSkill = {
      ...customCooldownSourceSkill,
      alertThresholdSeconds: 5,
    };
    const locked = {
      ...startStableCooldownTimer(fiveSecondAlertSkill, [58, 58, 58]),
      estimatedExpiresAt: 121_000,
    };
    const first = applyRecognitionResult(
      locked,
      { value: 58, confidence: 0.95 },
      fiveSecondAlertSkill,
      115_000,
    );
    const second = applyRecognitionResult(
      first,
      { value: 58, confidence: 0.95 },
      fiveSecondAlertSkill,
      115_450,
    );
    const failedConfirmation = applyRecognitionResult(
      second,
      { value: null, confidence: 0 },
      fiveSecondAlertSkill,
      115_900,
    );

    expect(getEstimatedRemainingSeconds(second, 115_450)).toBe(5);
    expect(second.pendingShortAnchor?.count).toBe(2);
    expect(shouldFireAlert(second, fiveSecondAlertSkill, 115_450)).toBe(false);
    expect(shouldFireAlert(failedConfirmation, fiveSecondAlertSkill, 115_900)).toBe(true);
  });

  it("keeps Sol Janus locked when an out-of-range OCR value appears after cooldown ends", () => {
    const locked = {
      ...startStableCooldownTimer(solJanusSkill, [56, 56, 56]),
      estimatedExpiresAt: 121_000,
    };
    const next = applyRecognitionResult(
      locked,
      { value: 88, confidence: 0.95 },
      solJanusSkill,
      60_000,
    );

    expect(next.status).toBe("running");
    expect(next.rejectedReading).toBeNull();
    expect(next.estimatedExpiresAt).toBe(121_000);
  });

  it("keeps a locked duration-source timer when a later OCR value is outside the tracking window", () => {
    const locked = applyRecognitionResult(
      createRuntimeState(skill.id),
      { value: 58, confidence: 0.95 },
      skill,
      1_000,
    );
    const next = applyRecognitionResult(
      locked,
      { value: 82, confidence: 0.95 },
      skill,
      10_000,
    );

    expect(next.status).toBe("running");
    expect(next.rejectedReading).toBe(82);
    expect(next.estimatedExpiresAt).toBe(59_000);
  });

  it("rejects a sudden threshold reading that disagrees with an existing countdown estimate", () => {
    const locked = applyRecognitionResult(
      createRuntimeState(tenSecondAlertSkill.id),
      { value: 50, confidence: 0.95 },
      tenSecondAlertSkill,
      1_000,
    );

    const next = applyRecognitionResult(
      locked,
      { value: 10, confidence: 0.98 },
      tenSecondAlertSkill,
      10_000,
    );

    expect(next.rejectedReading).toBe(10);
    expect(getEstimatedRemainingSeconds(next, 10_000)).toBe(41);
    expect(shouldFireAlert(next, tenSecondAlertSkill, 10_000)).toBe(false);
  });

  it("keeps alert state when a mid-countdown reading is observed after alert", () => {
    const alerted = markAlerted(
      { ...startManualCycle(createRuntimeState(skill.id), skill, 1_000), estimatedExpiresAt: 3_000 },
      1_500,
    );

    const reset = applyRecognitionResult(alerted, { value: 20, confidence: 0.95 }, skill, 2_000);
    expect(reset.alertedAt).toBe(1_500);
    expect(reset.status).toBe("alerted");
    expect(reset.rejectedReading).toBe(20);
  });

  it("clears alert state when a sub-minute anchor is observed after alert", () => {
    const alerted = markAlerted(
      { ...startManualCycle(createRuntimeState(skill.id), skill, 1_000), estimatedExpiresAt: 3_000 },
      1_500,
    );

    const reset = applyRecognitionResult(alerted, { value: 58, confidence: 0.95 }, skill, 2_000);
    expect(reset.alertedAt).toBeNull();
    expect(reset.status).toBe("running");
    expect(reset.rejectedReading).toBeNull();
  });

  it("ignores far readings outside the automatic tracking window", () => {
    const next = applyRecognitionResult(
      createRuntimeState(skill.id),
      { value: 60, confidence: 0.9 },
      skill,
      2_000,
    );

    expect(next.status).toBe("detecting");
    expect(next.rejectedReading).toBe(60);
    expect(next.estimatedExpiresAt).toBeNull();
  });

  it("ignores mid-countdown first readings before a timer is locked", () => {
    const next = applyRecognitionResult(
      createRuntimeState(skill.id),
      { value: 30, confidence: 0.95 },
      skill,
      1_000,
    );

    expect(next.status).toBe("detecting");
    expect(next.rejectedReading).toBe(30);
    expect(next.estimatedExpiresAt).toBeNull();
    expect(next.pendingShortAnchor?.count).toBe(1);
  });

  it("starts short cooldown timers only after stable repeated readings", () => {
    const first = applyRecognitionResult(
      createRuntimeState(skill.id),
      { value: 20, confidence: 0.95 },
      skill,
      1_000,
    );
    const second = applyRecognitionResult(first, { value: 20, confidence: 0.95 }, skill, 1_450);
    const third = applyRecognitionResult(second, { value: 19, confidence: 0.95 }, skill, 1_900);

    expect(first.estimatedExpiresAt).toBeNull();
    expect(second.estimatedExpiresAt).toBeNull();
    expect(second.pendingShortAnchor?.count).toBe(2);
    expect(third.status).toBe("running");
    expect(third.observedRemainingSeconds).toBe(19);
    expect(third.pendingShortAnchor).toBeNull();
    expect(shouldFireAlert(third, skill, 15_900)).toBe(true);
  });

  it("restarts short cooldown anchoring when the repeated readings jump", () => {
    const first = applyRecognitionResult(
      createRuntimeState(skill.id),
      { value: 20, confidence: 0.95 },
      skill,
      1_000,
    );
    const jumped = applyRecognitionResult(first, { value: 30, confidence: 0.95 }, skill, 1_450);

    expect(jumped.estimatedExpiresAt).toBeNull();
    expect(jumped.pendingShortAnchor).toMatchObject({
      observedRemainingSeconds: 30,
      count: 1,
    });
  });

  it("rearms an alerted short cooldown only after stable repeated readings", () => {
    const alerted = markAlerted(
      { ...startManualCycle(createRuntimeState(skill.id), skill, 1_000), estimatedExpiresAt: 3_000 },
      1_500,
    );
    const first = applyRecognitionResult(alerted, { value: 20, confidence: 0.95 }, skill, 2_000);
    const second = applyRecognitionResult(first, { value: 20, confidence: 0.95 }, skill, 2_450);
    const third = applyRecognitionResult(second, { value: 19, confidence: 0.95 }, skill, 2_900);

    expect(first.alertedAt).toBe(1_500);
    expect(second.alertedAt).toBe(1_500);
    expect(third.alertedAt).toBeNull();
    expect(third.status).toBe("running");
  });

  it("rejects suspicious downward OCR jumps", () => {
    const running = startManualCycle(createRuntimeState(skill.id), skill, 1_000);
    const next = applyRecognitionResult(
      { ...running, estimatedExpiresAt: 19_000 },
      { value: 8, confidence: 0.95 },
      skill,
      2_000,
    );

    expect(next.rejectedReading).toBe(8);
    expect(getEstimatedRemainingSeconds(next, 2_000)).toBe(17);
  });

  it("ignores OCR readings before the automatic tracking window", () => {
    const next = applyRecognitionResult(
      createRuntimeState(skill.id),
      { value: 82, confidence: 0.95 },
      skill,
      1_000,
    );

    expect(next.status).toBe("detecting");
    expect(next.rejectedReading).toBe(82);
    expect(next.estimatedExpiresAt).toBeNull();
  });

  it("pauses disabled skills", () => {
    const next = applyRecognitionResult(
      createRuntimeState(skill.id),
      { value: 30, confidence: 1 },
      { ...skill, enabled: false },
      1_000,
    );
    expect(next.status).toBe("paused");
  });

  it("keeps the effective cooldown duration when starting a manual cooldown cycle", () => {
    const previous = {
      ...createRuntimeState(solJanusSkill.id),
      effectiveCooldownDurationSeconds: 58,
    };
    const next = startManualCycle(previous, solJanusSkill, 1_000);

    expect(next.observedRemainingSeconds).toBe(120);
    expect(next.effectiveCooldownDurationSeconds).toBe(58);
  });

  it("fires remaining-count alerts when the observed count reaches the threshold", () => {
    const state = {
      ...createRuntimeState("skill_maehwa"),
      observedRemainingCount: 3,
      countObservedAt: 1_000,
      status: "running" as const,
    };

    expect(shouldFireRemainingCountAlert(state, { enabled: true, alertThresholdSeconds: 3 })).toBe(true);
    expect(getSkillAlertInRemainingCount(state, { enabled: true, alertThresholdSeconds: 3 })).toBe(0);
  });

  it("holds remaining-count alerts while a higher count is still being confirmed", () => {
    const state = {
      ...createRuntimeState("skill_maehwa"),
      observedRemainingCount: 2,
      countObservedAt: 1_000,
      pendingRemainingCountIncrease: {
        observedRemainingCount: 20,
        observedAt: 10_000,
        count: 1,
      },
      status: "running" as const,
    };

    expect(shouldFireRemainingCountAlert(state, { enabled: true, alertThresholdSeconds: 3 })).toBe(false);
    expect(getSkillAlertInRemainingCount(state, { enabled: true, alertThresholdSeconds: 3 })).toBe(0);
  });
});
