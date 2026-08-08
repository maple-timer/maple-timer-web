import { describe, expect, it, vi } from "vitest";
import { createSkill } from "../../../lib/profileFactory";
import { createRuntimeState } from "../../../lib/timer";
import type { RecognitionResult, SkillConfig, SkillRuntimeState } from "../../../types";
import {
  processSkillFrameSample,
  type SkillBuffDurationFrameResult,
} from "./skillFrameProcessor";

describe("processSkillFrameSample", () => {
  it("records a no-region reading when the enabled skill has no usable region", () => {
    const skill = createTestSkill({ region: null });
    const sampleSkill = vi.fn();
    const recognize = vi.fn();

    const result = processSkillFrameSample({
      frameLayoutKey: null,
      previousState: undefined,
      recognize,
      sampleSkill,
      sampledAt: 10_000,
      skill,
    });

    expect(sampleSkill).not.toHaveBeenCalled();
    expect(recognize).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      skillId: skill.id,
      alertDecision: null,
      alertCycleStartedAt: null,
      state: {
        skillId: skill.id,
        status: "detecting",
        rejectedReading: null,
      },
      snapshot: {
        sampledAt: 10_000,
        rawPreviewUrl: null,
        previewUrl: null,
        regionLabel: null,
        result: {
          value: null,
          confidence: 0,
          debug: { reason: "no-region" },
        },
      },
      traceSample: {
        sampledAt: 10_000,
        ocrValue: null,
        reason: "no-region",
        statusBefore: "idle",
        statusAfter: "detecting",
        shouldFireAlert: false,
        shouldRepeatAlert: false,
        alertDecision: null,
      },
    });
  });

  it("samples the selected layout region and builds snapshot and trace data", () => {
    const skill = createTestSkill({
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
      regionsByLayout: {
        "1280x720": { x: 0.3, y: 0.4, width: 0.06, height: 0.06 },
      },
    });
    const sampleSkill = vi.fn(() => ({
      imageData: createImageData(),
      rawPreviewUrl: "raw-preview",
      previewUrl: "processed-preview",
      region: { x: 384, y: 288, width: 77, height: 43 },
    }));
    const recognize = vi.fn(() => createReading({
      value: 42,
      confidence: 0.95,
      debug: {
        recognizedText: "42",
        digitCount: 2,
        foregroundRatio: 0.12,
        reason: "ok",
      },
    }));

    const result = processSkillFrameSample({
      frameLayoutKey: "1280x720",
      previousState: undefined,
      recognize,
      sampleSkill,
      sampledAt: 12_000,
      skill,
    });

    expect(sampleSkill).toHaveBeenCalledWith(
      { x: 0.3, y: 0.4, width: 0.06, height: 0.06 },
      true,
    );
    expect(recognize).toHaveBeenCalledWith(expect.any(ImageData));
    expect(result.snapshot).toMatchObject({
      sampledAt: 12_000,
      rawPreviewUrl: "raw-preview",
      previewUrl: "processed-preview",
      regionLabel: "77x43",
      result: {
        value: 42,
        confidence: 0.95,
        debug: {
          recognizedText: "42",
          digitCount: 2,
          foregroundRatio: 0.12,
          reason: "ok",
        },
      },
    });
    expect(result.traceSample).toMatchObject({
      sampledAt: 12_000,
      ocrValue: 42,
      confidence: 0.95,
      recognizedText: "42",
      digitCount: 2,
      foregroundRatio: 0.12,
      reason: "ok",
      statusBefore: "idle",
      alertDecision: null,
    });
  });

  it("maps sampling errors to a snapshot reading without throwing", () => {
    const skill = createTestSkill();
    const sampleSkill = vi.fn(() => {
      throw new Error("canvas-context-unavailable");
    });
    const recognize = vi.fn();

    const result = processSkillFrameSample({
      frameLayoutKey: null,
      previousState: undefined,
      recognize,
      sampleSkill,
      sampledAt: 13_000,
      skill,
    });

    expect(recognize).not.toHaveBeenCalled();
    expect(result.snapshot).toMatchObject({
      rawPreviewUrl: null,
      previewUrl: null,
      regionLabel: null,
      result: {
        value: null,
        confidence: 0,
        debug: { reason: "canvas-context-unavailable" },
      },
      runtimeFailure: {
        stage: "frame-capture",
        code: "canvas-context-unavailable",
        technicalMessage: "canvas-context-unavailable",
        occurredAt: 13_000,
      },
    });
    expect(result.traceSample).toMatchObject({
      reason: "canvas-context-unavailable",
      shouldFireAlert: false,
      shouldRepeatAlert: false,
      runtimeFailure: {
        stage: "frame-capture",
        code: "canvas-context-unavailable",
      },
    });
  });

  it("keeps recognizer execution failures separate from a valid empty reading", () => {
    const skill = createTestSkill();
    const sampleSkill = vi.fn(() => ({
      imageData: createImageData(),
      rawPreviewUrl: "raw-preview",
      previewUrl: "processed-preview",
      region: { x: 0, y: 0, width: 32, height: 32 },
    }));
    const recognize = vi.fn(() => {
      throw new Error("recognizer-session-crashed");
    });

    const result = processSkillFrameSample({
      frameLayoutKey: null,
      previousState: undefined,
      recognize,
      sampleSkill,
      sampledAt: 14_000,
      skill,
    });

    expect(result.snapshot).toMatchObject({
      rawPreviewUrl: "raw-preview",
      runtimeFailure: {
        stage: "recognizer",
        code: "recognizer-failed",
        technicalMessage: "recognizer-session-crashed",
        occurredAt: 14_000,
      },
      result: {
        value: null,
        debug: { reason: "recognizer-failed" },
      },
    });
    expect(result.traceSample.runtimeFailure).toMatchObject({
      stage: "recognizer",
      code: "recognizer-failed",
    });
  });

  it("uses the shared buff-slot detection result for Sol Janus buff-duration mode", () => {
    const skill = createTestSkill({
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const sampleSkill = vi.fn();
    const recognize = vi.fn();

    const result = processSkillFrameSample({
      buffDurationFrameResult: {
        rawPreviewUrl: "buff-slot-quadrant-preview",
        previewUrl: "janus-buff-preview",
        regionLabel: "32px · 18개 버프칸",
        snapshot: {
          detected: true,
          boxCount: 18,
          detectedCount: 1,
          score: 0.996,
          margin: 0.041,
          decisionReason: "matched",
          countdown: makeCountdown(41, "41", 0.93),
          countdownModelStatus: "ready",
          performanceMs: 12.4,
          error: null,
        },
      },
      frameLayoutKey: null,
      previousState: createRuntimeState(skill.id),
      recognize,
      sampleSkill,
      sampledAt: 14_000,
      skill,
    });

    expect(sampleSkill).not.toHaveBeenCalled();
    expect(recognize).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      alertDecision: null,
      alertCycleStartedAt: null,
      state: {
        status: "detecting",
        observedRemainingSeconds: 41,
        observedAt: 14_000,
        estimatedExpiresAt: null,
        pendingShortAnchor: {
          count: 1,
          estimatedExpiresAt: 55_000,
          observedAt: 14_000,
          observedRemainingSeconds: 41,
        },
      },
      snapshot: {
        rawPreviewUrl: "buff-slot-quadrant-preview",
        previewUrl: "janus-buff-preview",
        regionLabel: "32px · 18개 버프칸",
        result: {
          value: 41,
          confidence: 0.93,
          debug: { reason: "buff-duration-countdown-detected" },
        },
        buffDuration: {
          detected: true,
          boxCount: 18,
          detectedCount: 1,
          score: 0.996,
          margin: 0.041,
          decisionReason: "matched",
          countdown: makeCountdown(41, "41", 0.93),
        },
      },
      traceSample: {
        ocrValue: 41,
        confidence: 0.93,
        recognizedText: "41",
        observedRemainingSeconds: 41,
        estimatedRemainingSeconds: null,
        reason: "buff-duration-countdown-detected",
        statusBefore: "idle",
        statusAfter: "detecting",
        alertInSeconds: null,
        estimatedExpiresAt: null,
        pendingShortAnchorCount: 1,
        shouldFireAlert: false,
        shouldRepeatAlert: false,
      },
    });
  });

  it("uses the shared buff-slot detection result for Hologram Graffiti buff-duration mode", () => {
    const skill = createTestSkill({
      presetId: "hologram-graffiti-barrier-vi",
      detectionSource: "buff-duration",
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const sampleSkill = vi.fn();
    const recognize = vi.fn();

    const result = processSkillFrameSample({
      buffDurationFrameResult: {
        rawPreviewUrl: "buff-slot-quadrant-preview",
        previewUrl: "hologram-buff-preview",
        regionLabel: "32px · 18개 버프칸",
        snapshot: {
          targetSkillId: "hologramGraffitiBarrierVi",
          targetDisplayName: "홀로그램 그래피티: 역장 VI",
          detected: true,
          boxCount: 18,
          detectedCount: 1,
          score: 0.991,
          margin: 0.05,
          decisionReason: "matched",
          countdown: makeCountdown(44, "44", 0.92),
          countdownModelStatus: "ready",
          performanceMs: 13.2,
          error: null,
        },
      },
      frameLayoutKey: null,
      previousState: createRuntimeState(skill.id),
      recognize,
      sampleSkill,
      sampledAt: 15_000,
      skill,
    });

    expect(sampleSkill).not.toHaveBeenCalled();
    expect(recognize).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      snapshot: {
        previewUrl: "hologram-buff-preview",
        result: {
          value: 44,
          confidence: 0.92,
          debug: { reason: "buff-duration-countdown-detected" },
        },
        buffDuration: {
          targetSkillId: "hologramGraffitiBarrierVi",
          targetDisplayName: "홀로그램 그래피티: 역장 VI",
          detected: true,
          detectedCount: 1,
          countdown: makeCountdown(44, "44", 0.92),
        },
      },
      traceSample: {
        ocrValue: 44,
        reason: "buff-duration-countdown-detected",
      },
    });
  });

  it("uses a bottom-right remaining count result for Maehwa Yein buff-duration mode", () => {
    const skill = createTestSkill({
      alertThresholdSeconds: 3,
      presetId: "maehwa-yein-vi",
      detectionSource: "buff-duration",
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const sampleSkill = vi.fn();
    const recognize = vi.fn();

    const result = processSkillFrameSample({
      buffDurationFrameResult: createRemainingCountFrameResult(5, 0.94),
      frameLayoutKey: null,
      previousState: createRuntimeState(skill.id),
      recognize,
      sampleSkill,
      sampledAt: 14_000,
      skill,
    });

    expect(sampleSkill).not.toHaveBeenCalled();
    expect(recognize).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      alertDecision: null,
      state: {
        status: "running",
        observedRemainingCount: 5,
        countObservedAt: 14_000,
        estimatedExpiresAt: null,
      },
      snapshot: {
        result: {
          value: 5,
          confidence: 0.94,
          debug: { reason: "remaining-count-detected" },
        },
        buffDuration: {
          detected: true,
          remainingCount: makeRemainingCount(5, "5", 0.94),
        },
      },
      traceSample: {
        ocrValue: 5,
        observedRemainingCount: 5,
        alertInCount: 2,
        alertInSeconds: null,
        shouldFireAlert: false,
      },
    });
  });

  it("confirms Maehwa Yein threshold entry before firing the remaining-count alert", () => {
    const skill = createTestSkill({
      alertThresholdSeconds: 3,
      presetId: "maehwa-yein-vi",
      detectionSource: "buff-duration",
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const previousState = createRunningState(skill.id, {
      observedRemainingCount: 4,
      countObservedAt: 12_000,
      observedRemainingSeconds: null,
      observedAt: null,
      estimatedExpiresAt: null,
    });

    const pending = processSkillFrameSample({
      buffDurationFrameResult: createRemainingCountFrameResult(3, 0.94),
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 14_000,
      skill,
    });

    expect(pending).toMatchObject({
      alertDecision: null,
      state: {
        status: "running",
        alertedAt: null,
        observedRemainingCount: 3,
        countObservedAt: 14_000,
        pendingRemainingCountAlert: {
          observedRemainingCount: 3,
          count: 1,
        },
      },
      traceSample: {
        ocrValue: 3,
        observedRemainingCount: 3,
        remainingCountDecision: "alert-threshold-pending",
        pendingRemainingCountAlertObservations: 1,
        shouldFireAlert: false,
      },
    });

    const result = processSkillFrameSample({
      buffDurationFrameResult: createRemainingCountFrameResult(3, 0.94),
      frameLayoutKey: null,
      previousState: pending.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 15_000,
      skill,
    });

    expect(result).toMatchObject({
      alertDecision: "initial",
      alertCycleStartedAt: 15_000,
      state: {
        status: "alerted",
        alertedAt: 15_000,
        observedRemainingCount: 3,
        countObservedAt: 15_000,
        pendingRemainingCountAlert: null,
      },
      traceSample: {
        ocrValue: 3,
        observedRemainingCount: 3,
        alertInCount: 0,
        remainingCountDecision: "alert-threshold-confirmed",
        pendingRemainingCountAlertObservations: null,
        shouldFireAlert: true,
        alertDecision: "initial",
      },
    });
  });

  it("confirms a Sol Janus buff-duration timer from matching expiry readings with gaps", () => {
    const skill = createTestSkill({
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const first = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(40, 0.93),
      frameLayoutKey: null,
      previousState: createRuntimeState(skill.id),
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 0,
      skill,
    });

    const missing = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(null, 0),
      frameLayoutKey: null,
      previousState: first.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 2_000,
      skill,
    });

    const second = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(35, 0.92),
      frameLayoutKey: null,
      previousState: missing.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 5_000,
      skill,
    });
    const third = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(34, 0.92),
      frameLayoutKey: null,
      previousState: second.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 6_000,
      skill,
    });
    const fourth = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(33, 0.92),
      frameLayoutKey: null,
      previousState: third.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 7_000,
      skill,
    });
    const fifth = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(32, 0.92),
      frameLayoutKey: null,
      previousState: fourth.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 8_000,
      skill,
    });
    const confirmed = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(31, 0.92),
      frameLayoutKey: null,
      previousState: fifth.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 9_000,
      skill,
    });

    expect(first.state).toMatchObject({
      status: "detecting",
      estimatedExpiresAt: null,
      pendingShortAnchor: { count: 1, estimatedExpiresAt: 40_000 },
    });
    expect(missing.state).toMatchObject({
      status: "detecting",
      estimatedExpiresAt: null,
      pendingShortAnchor: { count: 1, estimatedExpiresAt: 40_000 },
    });
    expect(fifth).toMatchObject({
      alertDecision: null,
      state: {
        status: "detecting",
        estimatedExpiresAt: null,
        pendingShortAnchor: { count: 5, estimatedExpiresAt: 40_000 },
      },
      traceSample: {
        pendingShortAnchorCount: 5,
      },
    });
    expect(confirmed).toMatchObject({
      alertDecision: null,
      state: {
        status: "running",
        observedRemainingSeconds: 31,
        observedAt: 9_000,
        estimatedExpiresAt: 40_000,
        pendingShortAnchor: null,
      },
      traceSample: {
        statusAfter: "running",
        estimatedRemainingSeconds: 31,
        alertInSeconds: 21,
        estimatedExpiresAt: 40_000,
        pendingShortAnchorCount: null,
      },
    });
  });

  it("fires an initial alert from Sol Janus buff-duration countdown when the threshold is reached", () => {
    const skill = createTestSkill({
      alertThresholdSeconds: 10,
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const sampleSkill = vi.fn();
    const recognize = vi.fn();

    const result = processSkillFrameSample({
      buffDurationFrameResult: {
        rawPreviewUrl: "buff-slot-quadrant-preview",
        previewUrl: "janus-buff-preview",
        regionLabel: "32px · 18개 버프칸",
        snapshot: {
          detected: true,
          boxCount: 18,
          detectedCount: 1,
          score: 0.99,
          margin: 0.041,
          decisionReason: "matched",
          countdown: makeCountdown(10, "10", 0.91),
          countdownModelStatus: "ready",
          performanceMs: 12.4,
          error: null,
        },
      },
      frameLayoutKey: null,
      previousState: createRunningState(skill.id, {
        observedAt: 10_000,
        observedRemainingSeconds: 20,
        estimatedExpiresAt: 30_000,
      }),
      recognize,
      sampleSkill,
      sampledAt: 20_000,
      skill,
    });

    expect(sampleSkill).not.toHaveBeenCalled();
    expect(recognize).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      alertDecision: "initial",
      alertCycleStartedAt: 20_000,
      state: {
        status: "alerted",
        observedRemainingSeconds: 10,
        observedAt: 20_000,
        estimatedExpiresAt: 30_000,
        alertedAt: 20_000,
      },
      traceSample: {
        ocrValue: 10,
        confidence: 0.91,
        recognizedText: "10",
        observedRemainingSeconds: 10,
        estimatedRemainingSeconds: 10,
        alertInSeconds: 0,
        estimatedExpiresAt: 30_000,
        statusBefore: "running",
        statusAfter: "alerted",
        shouldFireAlert: true,
        shouldRepeatAlert: false,
        alertDecision: "initial",
      },
    });
  });

  it("keeps an alerted Sol Janus buff-duration cycle while the countdown remains inside the threshold", () => {
    const skill = createTestSkill({
      alertThresholdSeconds: 10,
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const previousState = createRunningState(skill.id, {
      observedAt: 20_000,
      observedRemainingSeconds: 10,
      estimatedExpiresAt: 30_000,
      status: "alerted",
      alertedAt: 20_000,
      lastAlertCycleStartedAt: 20_000,
    });

    const result = processSkillFrameSample({
      buffDurationFrameResult: {
        rawPreviewUrl: "buff-slot-quadrant-preview",
        previewUrl: "janus-buff-preview",
        regionLabel: "32px · 18개 버프칸",
        snapshot: {
          detected: true,
          boxCount: 18,
          detectedCount: 1,
          score: 0.99,
          margin: 0.041,
          decisionReason: "matched",
          countdown: makeCountdown(9, "9", 0.92),
          countdownModelStatus: "ready",
          performanceMs: 12.4,
          error: null,
        },
      },
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 21_000,
      skill,
    });

    expect(result).toMatchObject({
      alertDecision: null,
      alertCycleStartedAt: null,
      state: {
        status: "alerted",
        observedRemainingSeconds: 9,
        observedAt: 21_000,
        estimatedExpiresAt: 30_000,
        alertedAt: 20_000,
      },
      traceSample: {
        shouldFireAlert: false,
        shouldRepeatAlert: false,
        alertDecision: null,
        statusBefore: "alerted",
        statusAfter: "alerted",
        alertInSeconds: 0,
      },
    });
  });

  it("waits for matching expiry evidence before extending a Sol Janus buff-duration timer", () => {
    const skill = createTestSkill({
      alertThresholdSeconds: 10,
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const previousState = createRunningState(skill.id, {
      observedAt: 0,
      observedRemainingSeconds: 40,
      estimatedExpiresAt: 40_000,
    });

    const pending = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(50, 0.93),
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 10_000,
      skill,
    });

    const second = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(49, 0.92),
      frameLayoutKey: null,
      previousState: pending.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 11_000,
      skill,
    });
    const third = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(48, 0.92),
      frameLayoutKey: null,
      previousState: second.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 12_000,
      skill,
    });
    const fourth = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(47, 0.92),
      frameLayoutKey: null,
      previousState: third.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 13_000,
      skill,
    });
    const fifth = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(46, 0.92),
      frameLayoutKey: null,
      previousState: fourth.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 14_000,
      skill,
    });
    const extended = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(45, 0.92),
      frameLayoutKey: null,
      previousState: fifth.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 15_000,
      skill,
    });

    expect(pending).toMatchObject({
      alertDecision: null,
      state: {
        status: "running",
        observedRemainingSeconds: 50,
        observedAt: 10_000,
        estimatedExpiresAt: 40_000,
        pendingShortAnchor: { count: 1, estimatedExpiresAt: 60_000 },
      },
      traceSample: {
        estimatedRemainingSeconds: 30,
        alertInSeconds: 20,
        pendingShortAnchorCount: 1,
      },
    });
    expect(fifth).toMatchObject({
      alertDecision: null,
      state: {
        status: "running",
        observedRemainingSeconds: 46,
        observedAt: 14_000,
        estimatedExpiresAt: 40_000,
        pendingShortAnchor: { count: 5, estimatedExpiresAt: 60_000 },
      },
      traceSample: {
        estimatedRemainingSeconds: 26,
        alertInSeconds: 16,
        pendingShortAnchorCount: 5,
      },
    });
    expect(extended).toMatchObject({
      alertDecision: null,
      state: {
        status: "running",
        observedRemainingSeconds: 45,
        observedAt: 15_000,
        estimatedExpiresAt: 60_000,
        pendingShortAnchor: null,
      },
      traceSample: {
        estimatedRemainingSeconds: 45,
        alertInSeconds: 35,
        estimatedExpiresAt: 60_000,
      },
    });
  });

  it("does not fire from a stale Sol Janus buff-duration estimate after a long refreshed reading", () => {
    const skill = createTestSkill({
      alertThresholdSeconds: 10,
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const previousState = createRunningState(skill.id, {
      observedAt: 0,
      observedRemainingSeconds: 10,
      estimatedExpiresAt: 10_000,
    });

    const result = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(180, 0.94),
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 9_000,
      skill,
    });

    expect(result).toMatchObject({
      alertDecision: null,
      alertCycleStartedAt: null,
      state: {
        status: "detecting",
        observedRemainingSeconds: 180,
        observedAt: 9_000,
        estimatedExpiresAt: null,
        alertedAt: null,
        pendingShortAnchor: null,
      },
      traceSample: {
        ocrValue: 180,
        estimatedRemainingSeconds: null,
        alertInSeconds: null,
        estimatedExpiresAt: null,
        shouldFireAlert: false,
        shouldRepeatAlert: false,
        alertDecision: null,
      },
    });
  });

  it("rejects Erda Fountain buff-duration readings at 60 seconds or above", () => {
    const skill = createTestSkill({
      alertThresholdSeconds: 10,
      presetId: "erda-fountain",
      detectionSource: "buff-duration",
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const previousState = createRuntimeState(skill.id);

    const result = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(60, 0.94),
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 9_000,
      skill,
    });

    expect(result).toMatchObject({
      alertDecision: null,
      alertCycleStartedAt: null,
      state: {
        status: "detecting",
        observedRemainingSeconds: 60,
        observedAt: 9_000,
        estimatedExpiresAt: null,
        alertedAt: null,
      },
      traceSample: {
        ocrValue: 60,
        estimatedRemainingSeconds: null,
        alertInSeconds: null,
        shouldFireAlert: false,
      },
    });
  });

  it("rejects deep-v2 Erda Fountain buff-duration readings at 60 seconds or above", () => {
    const skill = createTestSkill({
      alertThresholdSeconds: 10,
      presetId: "erda-fountain-deep-v2",
      detectionSource: "buff-duration",
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const previousState = createRuntimeState(skill.id);

    const result = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(60, 0.94),
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 9_000,
      skill,
    });

    expect(result).toMatchObject({
      alertDecision: null,
      alertCycleStartedAt: null,
      state: {
        status: "detecting",
        observedRemainingSeconds: 60,
        observedAt: 9_000,
        estimatedExpiresAt: null,
        alertedAt: null,
      },
      traceSample: {
        ocrValue: 60,
        estimatedRemainingSeconds: null,
        alertInSeconds: null,
        shouldFireAlert: false,
      },
    });
  });

  it("keeps a confirmed Erda Fountain buff-duration timer when an untrusted reading appears", () => {
    const skill = createTestSkill({
      alertThresholdSeconds: 10,
      presetId: "erda-fountain",
      detectionSource: "buff-duration",
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const previousState = createRunningState(skill.id, {
      observedAt: 10_000,
      observedRemainingSeconds: 30,
      estimatedExpiresAt: 40_000,
    });

    const result = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(60, 0.94),
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 20_000,
      skill,
    });

    expect(result).toMatchObject({
      alertDecision: null,
      alertCycleStartedAt: null,
      state: {
        status: "running",
        observedRemainingSeconds: 60,
        observedAt: 20_000,
        estimatedExpiresAt: 40_000,
        alertedAt: null,
        rejectedReading: 60,
      },
      traceSample: {
        ocrValue: 60,
        estimatedRemainingSeconds: 20,
        alertInSeconds: 10,
        estimatedExpiresAt: 40_000,
        rejectedReading: 60,
        shouldFireAlert: false,
      },
    });
  });

  it("keeps an alerted deep-v2 Erda Fountain buff-duration cycle when an untrusted reading appears", () => {
    const skill = createTestSkill({
      alertThresholdSeconds: 10,
      presetId: "erda-fountain-deep-v2",
      detectionSource: "buff-duration",
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: 2,
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const previousState = createRunningState(skill.id, {
      observedAt: 25_000,
      observedRemainingSeconds: 5,
      estimatedExpiresAt: 30_000,
      status: "alerted",
      alertedAt: 20_000,
      lastRepeatedAlertAt: 23_500,
      repeatedAlertCount: 1,
      lastAlertCycleStartedAt: 20_000,
    });

    const result = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(60, 0.94),
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 26_000,
      skill,
    });

    expect(result).toMatchObject({
      alertDecision: null,
      alertCycleStartedAt: null,
      state: {
        status: "alerted",
        observedRemainingSeconds: 60,
        observedAt: 26_000,
        estimatedExpiresAt: 30_000,
        alertedAt: 20_000,
        lastRepeatedAlertAt: 23_500,
        repeatedAlertCount: 1,
        rejectedReading: 60,
      },
      traceSample: {
        ocrValue: 60,
        estimatedRemainingSeconds: 4,
        alertInSeconds: 0,
        estimatedExpiresAt: 30_000,
        rejectedReading: 60,
        shouldFireAlert: false,
      },
    });
  });

  it("fires a positive-threshold Sol Janus buff-duration alert when the countdown disappears", () => {
    const skill = createTestSkill({
      alertThresholdSeconds: 10,
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const previousState = createRunningState(skill.id, {
      observedAt: 0,
      observedRemainingSeconds: 20,
      estimatedExpiresAt: 20_000,
    });

    const missingStarted = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(null, 0),
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 11_000,
      skill,
    });

    const afterAlertMissing = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(null, 0),
      frameLayoutKey: null,
      previousState: missingStarted.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 15_000,
      skill,
    });

    expect(missingStarted).toMatchObject({
      alertDecision: "initial",
      state: {
        status: "alerted",
        estimatedExpiresAt: 20_000,
        alertedAt: 11_000,
        buffDurationCountdownMissingSinceAt: 11_000,
      },
      traceSample: {
        estimatedRemainingSeconds: 9,
        alertInSeconds: 0,
        shouldFireAlert: true,
        shouldRepeatAlert: false,
        alertDecision: "initial",
      },
    });
    expect(afterAlertMissing).toMatchObject({
      alertDecision: null,
      state: {
        status: "alerted",
        estimatedExpiresAt: 20_000,
        alertedAt: 11_000,
        buffDurationCountdownMissingSinceAt: 11_000,
      },
      traceSample: {
        estimatedRemainingSeconds: 5,
        alertInSeconds: 0,
        shouldFireAlert: false,
        shouldRepeatAlert: false,
      },
    });
  });

  it("delays only the first quick-slot alert by the sampled initial alert delay", () => {
    const skill = createTestSkill({ alertThresholdSeconds: 10 });
    const previousState = createRunningState(skill.id, {
      observedAt: 0,
      observedRemainingSeconds: 20,
      estimatedExpiresAt: 20_000,
    });
    const sampleSkill = vi.fn(() => ({
      imageData: createImageData(),
      rawPreviewUrl: "raw-preview",
      previewUrl: "processed-preview",
      region: { x: 0, y: 0, width: 32, height: 32 },
    }));
    const recognize = vi.fn(() => createReading({ value: null, confidence: 0 }));

    const beforeDelayedAlert = processSkillFrameSample({
      frameLayoutKey: null,
      previousState,
      recognize,
      sampleSkill,
      sampledAt: 11_000,
      skill,
      initialAlertJitterEnabled: true,
      getInitialAlertDelaySeconds: () => 1.5,
    });

    expect(beforeDelayedAlert).toMatchObject({
      alertDecision: null,
      state: {
        status: "running",
        initialAlertDelaySeconds: 1.5,
        initialAlertDelayCycleStartedAt: 0,
      },
      traceSample: {
        estimatedRemainingSeconds: 9,
        alertInSeconds: 0.5,
        shouldFireAlert: false,
      },
    });

    const dueAfterDelay = processSkillFrameSample({
      frameLayoutKey: null,
      previousState: beforeDelayedAlert.state,
      recognize,
      sampleSkill,
      sampledAt: 11_500,
      skill,
      initialAlertJitterEnabled: true,
      getInitialAlertDelaySeconds: () => 1.5,
    });

    expect(dueAfterDelay).toMatchObject({
      alertDecision: "initial",
      state: {
        status: "alerted",
        alertedAt: 11_500,
        initialAlertDelaySeconds: 1.5,
        initialAlertDelayCycleStartedAt: 0,
      },
      traceSample: {
        estimatedRemainingSeconds: 8,
        alertInSeconds: 0,
        shouldFireAlert: true,
      },
    });
  });

  it("does not delay repeat alerts after the first quick-slot alert", () => {
    const skill = createTestSkill({
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 5,
      repeatAlertMaxCount: 2,
    });
    const previousState = {
      ...createRuntimeState(skill.id),
      status: "alerted",
      alertedAt: 1_000,
      lastRepeatedAlertAt: 2_000,
      repeatedAlertCount: 0,
      lastAlertCycleStartedAt: 0,
      initialAlertDelaySeconds: 2,
      initialAlertDelayCycleStartedAt: 0,
    } satisfies SkillRuntimeState;

    const result = processSkillFrameSample({
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(() => createReading({ value: null, confidence: 0 })),
      sampleSkill: vi.fn(() => ({
        imageData: createImageData(),
        rawPreviewUrl: "raw-preview",
        previewUrl: "processed-preview",
        region: { x: 0, y: 0, width: 32, height: 32 },
      })),
      sampledAt: 7_000,
      skill,
      initialAlertJitterEnabled: true,
      getInitialAlertDelaySeconds: () => 2,
    });

    expect(result).toMatchObject({
      alertDecision: "repeat",
      alertCycleStartedAt: 1_000,
      traceSample: {
        shouldFireAlert: false,
        shouldRepeatAlert: true,
        alertDecision: "repeat",
      },
    });
  });

  it("keeps a Sol Janus buff-duration post-expiry alert when the countdown disappears near expiry", () => {
    const skill = createTestSkill({
      alertThresholdSeconds: -2,
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const previousState = createRunningState(skill.id, {
      observedAt: 10_000,
      observedRemainingSeconds: 10,
      estimatedExpiresAt: 20_000,
    });

    const missingStarted = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(null, 0.9, true),
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 16_000,
      skill,
    });
    const stillWaiting = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(null, 0.9, true),
      frameLayoutKey: null,
      previousState: missingStarted.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 20_000,
      skill,
    });
    const due = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(null, 0.9, true),
      frameLayoutKey: null,
      previousState: stillWaiting.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 22_000,
      skill,
    });

    expect(missingStarted).toMatchObject({
      alertDecision: null,
      state: {
        status: "running",
        estimatedExpiresAt: 20_000,
        buffDurationCountdownMissingSinceAt: 16_000,
      },
      traceSample: {
        estimatedRemainingSeconds: 4,
        alertInSeconds: 6,
        shouldFireAlert: false,
      },
    });
    expect(stillWaiting).toMatchObject({
      alertDecision: null,
      state: {
        status: "running",
        estimatedExpiresAt: 20_000,
        buffDurationCountdownMissingSinceAt: 16_000,
      },
      traceSample: {
        estimatedRemainingSeconds: 0,
        alertInSeconds: 2,
        shouldFireAlert: false,
      },
    });
    expect(due).toMatchObject({
      alertDecision: "initial",
      state: {
        status: "alerted",
        estimatedExpiresAt: 20_000,
        alertedAt: 22_000,
        buffDurationCountdownMissingSinceAt: 16_000,
      },
      traceSample: {
        estimatedRemainingSeconds: 0,
        alertInSeconds: 0,
        shouldFireAlert: true,
        alertDecision: "initial",
      },
    });
  });

  it("repeats a Sol Janus buff-duration alert until the configured count after the countdown is hidden", () => {
    const skill = createTestSkill({
      alertThresholdSeconds: -2,
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: 2,
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const previousState = createRunningState(skill.id, {
      observedAt: 10_000,
      observedRemainingSeconds: 10,
      estimatedExpiresAt: 20_000,
      status: "alerted",
      alertedAt: 22_000,
      lastRepeatedAlertAt: 22_400,
      lastAlertCycleStartedAt: 22_000,
      buffDurationCountdownMissingSinceAt: 16_000,
    });

    const result = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(null, 0.9, true),
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 25_400,
      skill,
    });

    expect(result).toMatchObject({
      alertDecision: "repeat",
      alertCycleStartedAt: 22_000,
      state: {
        status: "alerted",
        estimatedExpiresAt: 20_000,
        alertedAt: 22_000,
        lastRepeatedAlertAt: null,
        repeatedAlertCount: 1,
        buffDurationCountdownMissingSinceAt: 16_000,
      },
      traceSample: {
        estimatedRemainingSeconds: 0,
        alertInSeconds: 0,
        shouldFireAlert: false,
        shouldRepeatAlert: true,
        alertDecision: "repeat",
      },
    });

    const firstRepeatFinished = {
      ...result.state,
      lastRepeatedAlertAt: 25_800,
    };
    const secondRepeat = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(null, 0.9, true),
      frameLayoutKey: null,
      previousState: firstRepeatFinished,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 28_800,
      skill,
    });
    const secondRepeatFinished = {
      ...secondRepeat.state,
      lastRepeatedAlertAt: 29_200,
    };
    const exhausted = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(null, 0.9, true),
      frameLayoutKey: null,
      previousState: secondRepeatFinished,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 32_200,
      skill,
    });

    expect(secondRepeat).toMatchObject({
      alertDecision: "repeat",
      alertCycleStartedAt: 22_000,
      state: {
        status: "alerted",
        estimatedExpiresAt: 20_000,
        alertedAt: 22_000,
        lastRepeatedAlertAt: null,
        repeatedAlertCount: 2,
        buffDurationCountdownMissingSinceAt: 16_000,
      },
      traceSample: {
        shouldFireAlert: false,
        shouldRepeatAlert: true,
        alertDecision: "repeat",
      },
    });
    expect(exhausted).toMatchObject({
      alertDecision: null,
      state: {
        status: "alerted",
        estimatedExpiresAt: 20_000,
        alertedAt: 22_000,
        repeatedAlertCount: 2,
        buffDurationCountdownMissingSinceAt: 16_000,
      },
      traceSample: {
        shouldFireAlert: false,
        shouldRepeatAlert: false,
        alertDecision: null,
      },
    });
  });

  it("repeats a positive-threshold Sol Janus buff-duration alert after playback", () => {
    const skill = createTestSkill({
      alertThresholdSeconds: 5,
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: 2,
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const previousState = createRunningState(skill.id, {
      observedAt: 10_000,
      observedRemainingSeconds: 10,
      estimatedExpiresAt: 20_000,
      status: "alerted",
      alertedAt: 15_000,
      lastRepeatedAlertAt: 15_400,
      lastAlertCycleStartedAt: 15_000,
      buffDurationCountdownMissingSinceAt: 16_000,
    });

    const beforeIntervalRepeat = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(null, 0.9, true),
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 18_399,
      skill,
    });
    const firstRepeat = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(null, 0.9, true),
      frameLayoutKey: null,
      previousState: beforeIntervalRepeat.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 18_400,
      skill,
    });
    const firstRepeatFinished = {
      ...firstRepeat.state,
      lastRepeatedAlertAt: 18_800,
    };
    const secondRepeat = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(null, 0.9, true),
      frameLayoutKey: null,
      previousState: firstRepeatFinished,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 21_800,
      skill,
    });

    expect(beforeIntervalRepeat).toMatchObject({
      alertDecision: null,
      state: {
        status: "alerted",
        estimatedExpiresAt: 20_000,
        alertedAt: 15_000,
        repeatedAlertCount: 0,
        buffDurationCountdownMissingSinceAt: 16_000,
      },
      traceSample: {
        shouldRepeatAlert: false,
        alertDecision: null,
      },
    });
    expect(firstRepeat).toMatchObject({
      alertDecision: "repeat",
      alertCycleStartedAt: 15_000,
      state: {
        status: "alerted",
        estimatedExpiresAt: 20_000,
        alertedAt: 15_000,
        repeatedAlertCount: 1,
        buffDurationCountdownMissingSinceAt: 16_000,
      },
      traceSample: {
        shouldRepeatAlert: true,
        alertDecision: "repeat",
      },
    });
    expect(secondRepeat).toMatchObject({
      alertDecision: "repeat",
      alertCycleStartedAt: 15_000,
      state: {
        status: "alerted",
        estimatedExpiresAt: 20_000,
        alertedAt: 15_000,
        repeatedAlertCount: 2,
        buffDurationCountdownMissingSinceAt: 16_000,
      },
      traceSample: {
        shouldRepeatAlert: true,
        alertDecision: "repeat",
      },
    });
  });

  it("keeps an alerted Sol Janus buff-duration cycle when a same-expiry reading jitters above the threshold", () => {
    const skill = createTestSkill({
      alertThresholdSeconds: 5,
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: 2,
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const previousState = createRunningState(skill.id, {
      observedAt: 14_500,
      observedRemainingSeconds: 6,
      estimatedExpiresAt: 20_000,
      status: "alerted",
      alertedAt: 15_000,
      lastAlertCycleStartedAt: 15_000,
    });

    const result = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(6, 0.94),
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 15_450,
      skill,
    });

    expect(result).toMatchObject({
      alertDecision: null,
      alertCycleStartedAt: null,
      state: {
        status: "alerted",
        estimatedExpiresAt: 20_000,
        alertedAt: 15_000,
        lastRepeatedAlertAt: null,
        repeatedAlertCount: 0,
      },
      traceSample: {
        estimatedRemainingSeconds: 4,
        shouldFireAlert: false,
        shouldRepeatAlert: false,
        alertDecision: null,
      },
    });
  });

  it("keeps a Sol Janus buff-duration estimate when the countdown disappears before post-expiry alerting", () => {
    const skill = createTestSkill({
      alertThresholdSeconds: -2,
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    });
    const previousState = createRunningState(skill.id, {
      observedAt: 10_000,
      observedRemainingSeconds: 50,
      estimatedExpiresAt: 60_000,
    });

    const missingStarted = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(null, 0.9, true),
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 20_000,
      skill,
    });
    const missingHeld = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(null, 0.9, true),
      frameLayoutKey: null,
      previousState: missingStarted.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 24_000,
      skill,
    });
    const missingExpired = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(null, 0.9, true),
      frameLayoutKey: null,
      previousState: missingHeld.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 26_000,
      skill,
    });
    const due = processSkillFrameSample({
      buffDurationFrameResult: createBuffDurationFrameResult(null, 0.9, true),
      frameLayoutKey: null,
      previousState: missingExpired.state,
      recognize: vi.fn(),
      sampleSkill: vi.fn(),
      sampledAt: 62_000,
      skill,
    });

    expect(missingStarted).toMatchObject({
      alertDecision: null,
      state: {
        status: "running",
        estimatedExpiresAt: 60_000,
        buffDurationCountdownMissingSinceAt: 20_000,
      },
    });
    expect(missingHeld).toMatchObject({
      alertDecision: null,
      state: {
        status: "running",
        estimatedExpiresAt: 60_000,
        buffDurationCountdownMissingSinceAt: 20_000,
      },
    });
    expect(missingExpired).toMatchObject({
      alertDecision: null,
      state: {
        status: "running",
        estimatedExpiresAt: 60_000,
        alertedAt: null,
        buffDurationCountdownMissingSinceAt: 20_000,
      },
      traceSample: {
        estimatedRemainingSeconds: 34,
        alertInSeconds: 36,
        shouldFireAlert: false,
      },
    });
    expect(due).toMatchObject({
      alertDecision: "initial",
      state: {
        status: "alerted",
        estimatedExpiresAt: 60_000,
        alertedAt: 62_000,
        buffDurationCountdownMissingSinceAt: 20_000,
      },
      traceSample: {
        estimatedRemainingSeconds: 0,
        alertInSeconds: 0,
        shouldFireAlert: true,
      },
    });
  });

  it("marks an initial alert decision when a running timer reaches the threshold", () => {
    const skill = createTestSkill({ alertThresholdSeconds: 10 });
    const previousState = createRunningState(skill.id, {
      observedAt: 0,
      observedRemainingSeconds: 20,
      estimatedExpiresAt: 20_000,
    });

    const result = processSkillFrameSample({
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(() => createReading({ value: null, confidence: 0 })),
      sampleSkill: vi.fn(() => ({
        imageData: createImageData(),
        rawPreviewUrl: "raw-preview",
        previewUrl: "processed-preview",
        region: { x: 0, y: 0, width: 32, height: 32 },
      })),
      sampledAt: 11_000,
      skill,
    });

    expect(result).toMatchObject({
      alertDecision: "initial",
      alertCycleStartedAt: 11_000,
      state: {
        status: "alerted",
        alertedAt: 11_000,
      },
      traceSample: {
        shouldFireAlert: true,
        shouldRepeatAlert: false,
        alertDecision: "initial",
        estimatedRemainingSeconds: 9,
        alertInSeconds: 0,
      },
    });
  });

  it("waits until after expiry for a negative alert threshold", () => {
    const skill = createTestSkill({ alertThresholdSeconds: -2 });
    const previousState = createRunningState(skill.id, {
      observedAt: 0,
      observedRemainingSeconds: 20,
      estimatedExpiresAt: 20_000,
    });

    const beforeResult = processSkillFrameSample({
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(() => createReading({ value: null, confidence: 0 })),
      sampleSkill: vi.fn(() => ({
        imageData: createImageData(),
        rawPreviewUrl: "raw-preview",
        previewUrl: "processed-preview",
        region: { x: 0, y: 0, width: 32, height: 32 },
      })),
      sampledAt: 21_000,
      skill,
    });

    expect(beforeResult).toMatchObject({
      alertDecision: null,
      traceSample: {
        shouldFireAlert: false,
        estimatedRemainingSeconds: 0,
        alertInSeconds: 1,
      },
    });

    const dueResult = processSkillFrameSample({
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(() => createReading({ value: null, confidence: 0 })),
      sampleSkill: vi.fn(() => ({
        imageData: createImageData(),
        rawPreviewUrl: "raw-preview",
        previewUrl: "processed-preview",
        region: { x: 0, y: 0, width: 32, height: 32 },
      })),
      sampledAt: 22_000,
      skill,
    });

    expect(dueResult).toMatchObject({
      alertDecision: "initial",
      state: {
        status: "alerted",
        alertedAt: 22_000,
      },
      traceSample: {
        shouldFireAlert: true,
        estimatedRemainingSeconds: 0,
        alertInSeconds: 0,
      },
    });
  });

  it("marks a repeat alert decision using the original alert cycle", () => {
    const skill = createTestSkill({
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 5,
    });
    const previousState = {
      ...createRuntimeState(skill.id),
      status: "alerted",
      alertedAt: 1_000,
      lastRepeatedAlertAt: 2_000,
      lastAlertCycleStartedAt: 1_000,
    } satisfies SkillRuntimeState;

    const result = processSkillFrameSample({
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(() => createReading({ value: null, confidence: 0 })),
      sampleSkill: vi.fn(() => ({
        imageData: createImageData(),
        rawPreviewUrl: "raw-preview",
        previewUrl: "processed-preview",
        region: { x: 0, y: 0, width: 32, height: 32 },
      })),
      sampledAt: 7_000,
      skill,
    });

    expect(result).toMatchObject({
      alertDecision: "repeat",
      alertCycleStartedAt: 1_000,
      state: {
        status: "alerted",
        alertedAt: 1_000,
        lastRepeatedAlertAt: null,
      },
      traceSample: {
        shouldFireAlert: false,
        shouldRepeatAlert: true,
        alertDecision: "repeat",
      },
    });
  });

  it("does not mark a repeat decision when repeat alerts are disabled", () => {
    const skill = createTestSkill({
      repeatAlertEnabled: false,
      repeatAlertIntervalSeconds: 5,
    });
    const previousState = {
      ...createRuntimeState(skill.id),
      status: "alerted",
      alertedAt: 1_000,
      lastRepeatedAlertAt: 2_000,
      lastAlertCycleStartedAt: 1_000,
    } satisfies SkillRuntimeState;

    const result = processSkillFrameSample({
      frameLayoutKey: null,
      previousState,
      recognize: vi.fn(() => createReading({ value: null, confidence: 0 })),
      sampleSkill: vi.fn(() => ({
        imageData: createImageData(),
        rawPreviewUrl: "raw-preview",
        previewUrl: "processed-preview",
        region: { x: 0, y: 0, width: 32, height: 32 },
      })),
      sampledAt: 60_000,
      skill,
    });

    expect(result).toMatchObject({
      alertDecision: null,
      alertCycleStartedAt: null,
      state: {
        status: "alerted",
        alertedAt: 1_000,
        lastRepeatedAlertAt: 2_000,
      },
      traceSample: {
        shouldFireAlert: false,
        shouldRepeatAlert: false,
        alertDecision: null,
      },
    });
  });
});

function createTestSkill(partial: Partial<SkillConfig> = {}): SkillConfig {
  return createSkill({
    id: "skill_test",
    name: "테스트 스킬",
    durationSeconds: 60,
    alertThresholdSeconds: 10,
    recognitionStartSeconds: 60,
    region: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    enabled: true,
    ...partial,
  });
}

function createRunningState(
  skillId: string,
  partial: Partial<SkillRuntimeState> = {},
): SkillRuntimeState {
  return {
    ...createRuntimeState(skillId),
    observedRemainingSeconds: 20,
    observedAt: 0,
    estimatedExpiresAt: 20_000,
    confidence: 0.95,
    status: "running",
    lastAlertCycleStartedAt: 0,
    ...partial,
  };
}

function createReading(partial: Partial<RecognitionResult> = {}): RecognitionResult {
  return {
    value: null,
    confidence: 0,
    debug: { reason: "empty" },
    ...partial,
  };
}

function makeCountdown(totalSeconds: number, text = String(totalSeconds), confidence = 0.9) {
  return {
    kind: "exact" as const,
    text,
    totalSeconds,
    format: "seconds" as const,
    textRegion: "center" as const,
    confidence,
    status: "high" as const,
    routerTarget: "center",
    routerConfidence: 0.95,
    routerStatus: "high",
  };
}

function makeRemainingCount(count: number, text = String(count), confidence = 0.9) {
  return {
    kind: "exact" as const,
    text,
    count,
    expectedCount: count,
    format: "remaining-count" as const,
    textRegion: "bottom-right" as const,
    confidence,
    status: "high" as const,
    bestGuess: {
      text,
      count,
      probability: confidence,
    },
    candidates: [
      {
        text,
        count,
        probability: confidence,
      },
    ],
  };
}

function createBuffDurationFrameResult(
  countdownSeconds: number | null,
  confidence = 0.9,
  detected = countdownSeconds !== null,
): SkillBuffDurationFrameResult {
  return {
    rawPreviewUrl: "buff-slot-quadrant-preview",
    previewUrl: "janus-buff-preview",
    regionLabel: "32px · 18개 버프칸",
    snapshot: {
      detected,
      boxCount: 18,
      detectedCount: detected ? 1 : 0,
      score: confidence,
      margin: 0.041,
      decisionReason: detected ? "matched" : "searching",
      countdown: countdownSeconds === null
        ? null
        : makeCountdown(countdownSeconds, String(countdownSeconds), confidence),
      countdownModelStatus: "ready",
      performanceMs: 12.4,
      error: null,
    },
  };
}

function createRemainingCountFrameResult(
  count: number | null,
  confidence = 0.9,
  detected = count !== null,
): SkillBuffDurationFrameResult {
  return {
    rawPreviewUrl: "buff-slot-quadrant-preview",
    previewUrl: "maehwa-yein-buff-preview",
    regionLabel: "32px · 18개 버프칸",
    snapshot: {
      detected,
      boxCount: 18,
      detectedCount: detected ? 1 : 0,
      score: confidence,
      margin: 0.041,
      decisionReason: detected ? "matched" : "searching",
      countdown: null,
      countdownModelStatus: "idle",
      remainingCount: count === null
        ? null
        : makeRemainingCount(count, String(count), confidence),
      remainingCountModelStatus: "ready",
      performanceMs: 12.4,
      error: null,
    },
  };
}

function createImageData(): ImageData {
  return new ImageData(new Uint8ClampedArray(4 * 4 * 4), 4, 4);
}
