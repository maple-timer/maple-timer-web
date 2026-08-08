import { describe, expect, it } from "vitest";
import type { SkillTraceSample } from "../../../alertTypes";
import { createRuntimeState } from "../../../lib/timer";
import {
  createSkillIncidentRuntimeRecorder,
  recordSkillIncidentSample,
} from "../../../runtime/skill-alert/evidence/skillIncidentRuntimeRecorder";
import type { Profile, SkillConfig, SkillRuntimeState } from "../../../types";
import type {
  SkillBuffDurationFrameResult,
  SkillFrameProcessResult,
} from "./skillFrameProcessor";
import {
  createSkillIncidentRuntimeSampleInput,
  getSkillIncidentConfiguration,
} from "./skillIncidentEvidenceAdapter";

const PROFILE = {
  id: "profile-a",
  skillAlertInitialJitterEnabled: true,
} satisfies Pick<Profile, "id" | "skillAlertInitialJitterEnabled">;

describe("skill incident evidence adapter", () => {
  it("maps a quick-slot initial decision, exact due time, state, and bounded media", () => {
    const skill = createSkill();
    const stateBefore = createRuntimeState(skill.id);
    const stateAfter = runtimeState(skill.id, {
      status: "alerted",
      observedRemainingSeconds: 10,
      observedAt: 12_500,
      estimatedExpiresAt: 22_500,
      alertedAt: 12_500,
      lastAlertCycleStartedAt: 1_000,
      initialAlertDelaySeconds: 1.5,
      initialAlertDelayCycleStartedAt: 1_000,
    });
    const processed = quickProcessed({
      skill,
      sampledAt: 12_500,
      state: stateAfter,
      value: 10,
      alertDecision: "initial",
      shouldFireAlert: true,
      alertInSeconds: 0,
    });

    const input = createSkillIncidentRuntimeSampleInput({
      recorder: createSkillIncidentRuntimeRecorder({ now: 0 }),
      profile: PROFILE,
      skill,
      masterVolume: 0.5,
      frameLayoutKey: "layout-a",
      precisionParserRuntimeKey: undefined,
      quickRecognizerId: "digit-template",
      sampledAt: 12_500,
      monotonicAt: 2_500,
      stateBefore,
      processed,
      rawBuffDurationFrameResult: null,
    });

    expect(input).toMatchObject({
      mode: "quickslot-countdown",
      targetId: `quickslot:${skill.id}`,
      provider: "main-thread",
      recognizerVersion: "digit-template",
      recognitionDecision: "accepted",
      value: { rawValue: 10, decision: "accepted" },
      stateAfter: {
        alertedAt: 12_500,
        lastAlertCycleStartedAt: 1_000,
        initialAlertDelaySeconds: 1.5,
      },
      alertDecision: {
        kind: "initial",
        dueAt: 14_000,
        dueMonotonicAt: 4_000,
      },
    });
    expect(input.frameReasons).toEqual(
      expect.arrayContaining(["periodic", "alert-decision", "threshold"]),
    );
    expect(input.media?.map((entry) => entry.variant)).toEqual([
      "quickslot-raw",
      "quickslot-processed",
    ]);
    expect(input.configuration).toMatchObject({
      profileId: "profile-a",
      masterVolume: 0.5,
      effectiveVolume: 0.4,
      initialAlertJitterEnabled: true,
    });
  });

  it("keeps ordinary descending quick-slot metadata without retaining another image", () => {
    const skill = createSkill();
    const firstState = runtimeState(skill.id, {
      status: "running",
      observedRemainingSeconds: 30,
      observedAt: 1_000,
      estimatedExpiresAt: 31_000,
      lastAlertCycleStartedAt: 1_000,
    });
    const emptyRecorder = createSkillIncidentRuntimeRecorder({ now: 0 });
    const firstInput = createSkillIncidentRuntimeSampleInput({
      recorder: emptyRecorder,
      profile: PROFILE,
      skill,
      masterVolume: 1,
      frameLayoutKey: null,
      precisionParserRuntimeKey: undefined,
      quickRecognizerId: "digit-template",
      sampledAt: 1_000,
      monotonicAt: 1_000,
      stateBefore: createRuntimeState(skill.id),
      processed: quickProcessed({
        skill,
        sampledAt: 1_000,
        state: firstState,
        value: 30,
      }),
      rawBuffDurationFrameResult: null,
    });
    const recorder = recordSkillIncidentSample({
      previous: emptyRecorder,
      input: firstInput,
    }).recorder;
    const secondState = runtimeState(skill.id, {
      ...firstState,
      observedRemainingSeconds: 29,
      observedAt: 2_000,
    });
    const second = createSkillIncidentRuntimeSampleInput({
      recorder,
      profile: PROFILE,
      skill,
      masterVolume: 1,
      frameLayoutKey: null,
      precisionParserRuntimeKey: undefined,
      quickRecognizerId: "digit-template",
      sampledAt: 2_000,
      monotonicAt: 2_000,
      stateBefore: firstState,
      processed: quickProcessed({
        skill,
        sampledAt: 2_000,
        state: secondState,
        value: 29,
      }),
      rawBuffDurationFrameResult: null,
    });

    expect(second.frameReasons).toContain("value-change");
    expect(second.media).toBeUndefined();

    const soundChanged = getSkillIncidentConfiguration({
      frameLayoutKey: null,
      masterVolume: 1,
      precisionParserRuntimeKey: undefined,
      profile: PROFILE,
      skill: { ...skill, soundId: "another-sound" },
    });
    expect(soundChanged.soundId).toBe("another-sound");
    expect(second.cycleConfigurationKey).toBe(firstInput.cycleConfigurationKey);
    expect(second.epochIdentityKey).toBe(firstInput.epochIdentityKey);
  });

  it("maps accepted precision parser, matcher, countdown, provider, and source/candidate media", () => {
    const skill = createSkill({
      presetId: "sol-janus-dawn-deep-v2",
      detectionSource: "buff-duration",
      region: null,
    });
    const frame = precisionFrame({
      detected: true,
      countdownSeconds: 30,
      executionProvider: "remote",
    });
    const stateAfter = runtimeState(skill.id, {
      status: "running",
      observedRemainingSeconds: 30,
      observedAt: 6_000,
      estimatedExpiresAt: 36_000,
      lastAlertCycleStartedAt: 6_000,
    });
    const processed = precisionProcessed({
      skill,
      sampledAt: 6_000,
      state: stateAfter,
      frame,
    });

    const input = createSkillIncidentRuntimeSampleInput({
      recorder: createSkillIncidentRuntimeRecorder({ now: 0 }),
      profile: PROFILE,
      skill,
      masterVolume: 1,
      frameLayoutKey: "layout-a",
      precisionParserRuntimeKey: "remote:user-opt-in:default:vp8-preview-v1",
      quickRecognizerId: "digit-template",
      sampledAt: 6_000,
      monotonicAt: 6_000,
      stateBefore: createRuntimeState(skill.id),
      processed,
      rawBuffDurationFrameResult: frame,
    });

    expect(input).toMatchObject({
      mode: "precision-countdown",
      targetId: "precision:janusDeepV2",
      provider: "remote",
      recognitionDecision: "accepted",
      parser: {
        boxCount: 3,
        rowCount: 2,
        candidateCount: 1,
      },
      matcher: {
        accepted: true,
        bundleId: "skill-deep-v2",
        modelVersion: "matcher-v1",
        score: 0.96,
      },
      value: {
        kind: "countdown",
        rawValue: 30,
        decision: "accepted",
      },
    });
    expect(input.media?.map((entry) => entry.variant)).toEqual([
      "precision-source",
      "precision-candidate",
    ]);
    expect(input.recognizerVersion).toContain("parser-v1");
    expect(input.recognizerVersion).toContain("matcher-v1");
  });

  it("preserves a parser failure as an error stage instead of a matcher miss", () => {
    const skill = createSkill({
      presetId: "sol-janus-dawn-deep-v2",
      detectionSource: "buff-duration",
      region: null,
    });
    const frame = precisionFrame({
      detected: false,
      countdownSeconds: null,
      parserFailure: true,
    });
    const processed = precisionProcessed({
      skill,
      sampledAt: 1_000,
      state: runtimeState(skill.id, { status: "detecting" }),
      frame,
    });
    const input = createSkillIncidentRuntimeSampleInput({
      recorder: createSkillIncidentRuntimeRecorder({ now: 0 }),
      profile: PROFILE,
      skill,
      masterVolume: 1,
      frameLayoutKey: null,
      precisionParserRuntimeKey: "wasm:user-opt-in:active",
      quickRecognizerId: "digit-template",
      sampledAt: 1_000,
      monotonicAt: 1_000,
      stateBefore: createRuntimeState(skill.id),
      processed,
      rawBuffDurationFrameResult: frame,
    });

    expect(input.recognitionDecision).toBe("error");
    expect(input.matcher).toBeNull();
    expect(input.runtimeFailure).toMatchObject({
      stage: "model-session",
      code: "model-session-create-failed",
      provider: "wasm",
    });
    expect(input.source).toBe("runtime-error");
  });

  it("maps Yein range quarantine and the production cycle-reset reason", () => {
    const skill = createSkill({
      presetId: "maehwa-yein-vi",
      detectionSource: "buff-duration",
      region: null,
    });
    const frame = precisionFrame({
      detected: true,
      countdownSeconds: null,
      remainingCount: 3,
    });
    const stateBefore = runtimeState(skill.id, {
      status: "running",
      observedRemainingCount: 8,
      countObservedAt: 1_000,
      lastAlertCycleStartedAt: 1_000,
    });
    const stateAfter = runtimeState(skill.id, {
      ...stateBefore,
      observedRemainingCount: 8,
      rejectedReading: 3,
      pendingRemainingCountDrop: {
        observedRemainingCount: 3,
        observedAt: 2_000,
        lastObservedAt: 2_000,
        count: 1,
        fromRemainingCount: 8,
        minReachableCount: 7,
      },
    });
    const processed = precisionProcessed({
      skill,
      sampledAt: 2_000,
      state: stateAfter,
      frame,
      trace: {
        remainingCountDecision: "implausible-drop",
        remainingCountExpectedMin: 7,
        remainingCountExpectedMax: 8,
        pendingRemainingCountDropObservations: 1,
      },
    });
    const input = createSkillIncidentRuntimeSampleInput({
      recorder: createSkillIncidentRuntimeRecorder({ now: 0 }),
      profile: PROFILE,
      skill,
      masterVolume: 1,
      frameLayoutKey: null,
      precisionParserRuntimeKey: "webgpu:default:default",
      quickRecognizerId: "digit-template",
      sampledAt: 2_000,
      monotonicAt: 2_000,
      stateBefore,
      processed,
      rawBuffDurationFrameResult: frame,
    });

    expect(input).toMatchObject({
      mode: "precision-remaining-count",
      value: { rawValue: 3, decision: "implausible" },
      flow: {
        confirmedValue: 8,
        expectedMin: 7,
        expectedMax: 8,
        decisionReason: "implausible-drop",
        pendingDropObservations: 1,
      },
      stateAfter: {
        observedValue: 8,
        rejectedValue: 3,
        pendingReason: "remaining-count-drop:1",
      },
    });

    const resetProcessed = precisionProcessed({
      skill,
      sampledAt: 3_000,
      state: runtimeState(skill.id, {
        status: "running",
        observedRemainingCount: 10,
        countObservedAt: 3_000,
        lastAlertCycleStartedAt: 2_000,
      }),
      frame: precisionFrame({
        detected: true,
        countdownSeconds: null,
        remainingCount: 10,
      }),
      trace: { remainingCountDecision: "cycle-reset" },
    });
    expect(resetProcessed.traceSample.remainingCountDecision).toBe(
      "cycle-reset",
    );
  });

  it("derives repeat due time from the previous playback finish", () => {
    const skill = createSkill({
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 5,
    });
    const stateBefore = runtimeState(skill.id, {
      status: "alerted",
      observedRemainingSeconds: 0,
      estimatedExpiresAt: 5_000,
      alertedAt: 5_000,
      lastRepeatedAlertAt: 10_000,
      lastAlertCycleStartedAt: 1_000,
    });
    const stateAfter = runtimeState(skill.id, {
      ...stateBefore,
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 1,
    });
    const processed = quickProcessed({
      skill,
      sampledAt: 15_100,
      state: stateAfter,
      value: null,
      alertDecision: "repeat",
      shouldRepeatAlert: true,
    });
    const input = createSkillIncidentRuntimeSampleInput({
      recorder: createSkillIncidentRuntimeRecorder({ now: 0 }),
      profile: PROFILE,
      skill,
      masterVolume: 1,
      frameLayoutKey: null,
      precisionParserRuntimeKey: undefined,
      quickRecognizerId: "digit-template",
      sampledAt: 15_100,
      monotonicAt: 5_100,
      stateBefore,
      processed,
      rawBuffDurationFrameResult: null,
    });
    expect(input.alertDecision).toMatchObject({
      kind: "repeat",
      dueAt: 15_000,
      dueMonotonicAt: 5_000,
    });
  });
});

function createSkill(overrides: Partial<SkillConfig> = {}): SkillConfig {
  return {
    id: "skill-a",
    name: "테스트 스킬",
    detectionSource: "quickslot",
    countdownSource: "duration",
    durationSeconds: 60,
    cooldownDurationSeconds: 60,
    alertThresholdSeconds: 10,
    recognitionStartSeconds: 40,
    region: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
    recognitionMode: "digit-template",
    soundId: "default",
    volume: 0.8,
    repeatAlertEnabled: false,
    repeatAlertIntervalSeconds: 5,
    repeatAlertMaxCount: 2,
    enabled: true,
    ...overrides,
  };
}

function runtimeState(
  skillId: string,
  overrides: Partial<SkillRuntimeState> = {},
): SkillRuntimeState {
  return { ...createRuntimeState(skillId), ...overrides };
}

function quickProcessed({
  skill,
  sampledAt,
  state,
  value,
  alertDecision = null,
  shouldFireAlert = false,
  shouldRepeatAlert = false,
  alertInSeconds = 5,
}: {
  skill: SkillConfig;
  sampledAt: number;
  state: SkillRuntimeState;
  value: number | null;
  alertDecision?: "initial" | "repeat" | null;
  shouldFireAlert?: boolean;
  shouldRepeatAlert?: boolean;
  alertInSeconds?: number | null;
}): SkillFrameProcessResult {
  return {
    skillId: skill.id,
    state,
    snapshot: {
      result: {
        value,
        confidence: value === null ? 0 : 0.99,
        debug: { reason: value === null ? "no-digits" : "accepted" },
      },
      sampledAt,
      rawPreviewUrl: "data:image/png;base64,quick-raw",
      previewUrl: "data:image/png;base64,quick-processed",
      regionLabel: "32x32",
      runtimeFailure: null,
    },
    traceSample: traceSample({
      sampledAt,
      ocrValue: value,
      confidence: value === null ? 0 : 0.99,
      reason: value === null ? "no-digits" : "accepted",
      statusAfter: state.status,
      observedRemainingSeconds: state.observedRemainingSeconds,
      estimatedRemainingSeconds: state.observedRemainingSeconds,
      estimatedExpiresAt: state.estimatedExpiresAt,
      rejectedReading: state.rejectedReading,
      alertInSeconds,
      shouldFireAlert,
      shouldRepeatAlert,
      alertDecision,
    }),
    alertDecision,
    alertCycleStartedAt: alertDecision ? state.alertedAt : null,
  };
}

function precisionProcessed({
  skill,
  sampledAt,
  state,
  frame,
  trace = {},
}: {
  skill: SkillConfig;
  sampledAt: number;
  state: SkillRuntimeState;
  frame: SkillBuffDurationFrameResult;
  trace?: Partial<SkillTraceSample>;
}): SkillFrameProcessResult {
  const value =
    frame.snapshot.remainingCount?.count ??
    frame.snapshot.countdown?.totalSeconds ??
    null;
  return {
    skillId: skill.id,
    state,
    snapshot: {
      result: {
        value,
        confidence: value === null ? 0 : 0.99,
        debug: { reason: frame.snapshot.decisionReason ?? undefined },
      },
      sampledAt,
      rawPreviewUrl: frame.rawPreviewUrl,
      previewUrl: frame.previewUrl,
      previewImageData: frame.previewImageData,
      regionLabel: frame.regionLabel,
      buffDuration: frame.snapshot,
      runtimeFailure: null,
    },
    traceSample: traceSample({
      sampledAt,
      ocrValue: value,
      confidence: value === null ? 0 : 0.99,
      reason: frame.snapshot.decisionReason,
      statusAfter: state.status,
      observedRemainingSeconds: state.observedRemainingSeconds,
      observedRemainingCount: state.observedRemainingCount,
      estimatedRemainingSeconds: state.observedRemainingSeconds,
      estimatedExpiresAt: state.estimatedExpiresAt,
      rejectedReading: state.rejectedReading,
      ...trace,
    }),
    alertDecision: null,
    alertCycleStartedAt: null,
  };
}

function traceSample(
  overrides: Partial<SkillTraceSample> & Pick<SkillTraceSample, "sampledAt">,
): SkillTraceSample {
  const { sampledAt, ...rest } = overrides;
  return {
    sampledAt,
    ocrValue: null,
    confidence: 0,
    recognizedText: null,
    reason: null,
    digitCount: null,
    foregroundRatio: null,
    statusBefore: "idle",
    statusAfter: "detecting",
    observedRemainingSeconds: null,
    observedRemainingCount: null,
    estimatedRemainingSeconds: null,
    alertThresholdSeconds: 10,
    alertInSeconds: null,
    alertInCount: null,
    estimatedExpiresAt: null,
    rejectedReading: null,
    pendingShortAnchorCount: null,
    remainingCountDecision: null,
    remainingCountExpectedMin: null,
    remainingCountExpectedMax: null,
    pendingRemainingCountDropObservations: null,
    pendingRemainingCountAlertObservations: null,
    shouldFireAlert: false,
    shouldRepeatAlert: false,
    alertDecision: null,
    runtimeFailure: null,
    ...rest,
  };
}

function precisionFrame({
  detected,
  countdownSeconds,
  remainingCount = null,
  parserFailure = false,
  executionProvider = "webgpu",
}: {
  detected: boolean;
  countdownSeconds: number | null;
  remainingCount?: number | null;
  parserFailure?: boolean;
  executionProvider?: "webgpu" | "wasm" | "remote";
}): SkillBuffDurationFrameResult {
  const countdown = countdownSeconds === null
    ? null
    : {
        kind: "exact" as const,
        text: String(countdownSeconds),
        totalSeconds: countdownSeconds,
        format: "seconds" as const,
        textRegion: "center" as const,
        confidence: 0.98,
        status: "high" as const,
        routerTarget: "center",
        routerConfidence: 0.99,
        routerStatus: "accepted",
      };
  const remaining = remainingCount === null
    ? null
    : {
        kind: "exact" as const,
        text: String(remainingCount),
        count: remainingCount,
        expectedCount: null,
        format: "remaining-count" as const,
        textRegion: "bottom-right" as const,
        confidence: 0.97,
        status: "high" as const,
        candidates: [],
      };
  const match = {
    matched: detected,
    skillId: "janus",
    displayName: "야누스",
    detectorId: "skill-deep-v2:janus",
    matcherEngine: "skill-bundle-v1",
    bundleId: "skill-deep-v2",
    modelVersion: "matcher-v1",
    baseSkillId: "janus",
    rawSkillId: "janus",
    score: 0.96,
    threshold: 0.8,
    margin: 0.16,
    gateScore: null,
    gateThreshold: null,
    gateMargin: null,
    decisionReason: detected ? "accepted" : "below-threshold",
  };
  return {
    evidenceSource: {
      kind: "buff-slot-top-right-quadrant-v1",
      parserInputMode: "topRightQuadrant",
      coordinateSpace: "capture-pixels",
      sourceSize: { width: 1920, height: 1080 },
      roi: { x: 960, y: 0, width: 960, height: 540 },
      dataUrl: "data:image/png;base64,precision-source",
    },
    rawPreviewUrl: "data:image/png;base64,precision-source",
    previewUrl: "data:image/png;base64,candidate",
    previewImageData: null,
    regionLabel: "960x540",
    parserRuntime: {
      executionProvider,
      selectionSource:
        executionProvider === "remote" ? "user-opt-in" : "default",
      recognitionEngine: "dl",
      parserVersion: "parser-v1",
      modelId: "parser-v1",
      modelInputWidth: 960,
      modelInputHeight: 544,
      onnxRuntimeVersion: "1.27.0",
      wasmThreads: null,
    },
    parserPerformance: null,
    parserFailure: parserFailure
      ? {
          reason: "model-load-failed",
          technicalMessage: "session failed",
          diagnostic: {
            stage: "model-session",
            status: "failed",
            code: "model-session-create-failed",
            technicalMessage: "session failed",
            details: {},
          },
        }
      : null,
    snapshot: {
      targetSkillId: "janusDeepV2",
      targetDisplayName: "야누스",
      detected,
      boxCount: parserFailure ? 0 : 3,
      parserRowCount: parserFailure ? 0 : 2,
      parserEngine: "dl",
      parserVersion: "parser-v1",
      parserFallbackReason: null,
      detectedCount: detected ? 1 : 0,
      matcherEngine: "skill-bundle-v1",
      bundleId: "skill-deep-v2",
      modelVersion: "matcher-v1",
      score: detected ? 0.96 : null,
      threshold: 0.8,
      margin: detected ? 0.16 : null,
      gateMargin: null,
      decisionReason: parserFailure
        ? "parser-failed"
        : detected
          ? "accepted"
          : "below-threshold",
      countdown,
      countdownModelStatus: "ready",
      remainingCount: remaining,
      remainingCountModelStatus: "ready",
      performanceMs: 10,
      error: parserFailure ? "session failed" : null,
      candidateIcons: parserFailure
        ? []
        : [
            {
              boxIndex: 0,
              box: {
                x: 10,
                y: 20,
                size: 32,
                confidence: 0.99,
                score: 0.99,
              },
              match,
              countdown,
              remainingCount: remaining,
              imageDataUrl: "data:image/png;base64,candidate",
            },
          ],
    },
  };
}
