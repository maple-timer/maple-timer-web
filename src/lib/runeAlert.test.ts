import { describe, expect, it } from "vitest";
import type { RuneAlertPlaybackState, RuneRuntimeState } from "../alertTypes";
import {
  createRuneRuntimeState,
  markRuneAlertPlaybackFailed,
  markRuneAlertPlaybackFinished,
  markRuneAlertPlaybackStarted,
  mergeRuneRuntimePlaybackProgress,
  updateRuneRuntimeState,
} from "./runeAlert";
import type { RuneDetectionResult } from "./runeDetection";

const detected = makeDetected(10, 10);

const missing: RuneDetectionResult = {
  detected: false,
  confidence: 0,
  candidates: [],
  debug: { purplePixelRatio: 0, componentCount: 0 },
};

describe("runeAlert", () => {
  it("requires stable detections before alerting", () => {
    let state = createRuneRuntimeState();

    let update = updateRuneRuntimeState({
      previous: state,
      detection: detected,
      now: 1000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(false);
    expect(update.state.status).toBe("candidate");
    expect(update.state.lastDecisionReason).toBe("stabilizing");
    expect(update.state.recentSamples).toHaveLength(1);
    state = update.state;

    update = updateRuneRuntimeState({
      previous: state,
      detection: detected,
      now: 2_000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(false);
    state = update.state;

    update = updateRuneRuntimeState({
      previous: state,
      detection: detected,
      now: 3_000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(false);
    state = update.state;

    update = updateRuneRuntimeState({
      previous: state,
      detection: detected,
      now: 4_000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(true);
    expect(update.state.status).toBe("alerted");
    expect(update.state.lastFoundAt).toBe(1000);
    expect(update.state.lastAlertedAt).toBe(4_000);
    expect(update.state.lastDecisionReason).toBe("initial-alert");
    expect(update.state.lastAlertPlayback).toMatchObject({
      status: "requested",
      decision: "initial",
      requestedAt: 4_000,
      startedAt: null,
    });
    const started = markRuneAlertPlaybackStarted(
      update.state,
      update.state.lastAlertPlayback?.cycleId ?? "missing",
      4_025,
    );
    expect(started.lastAlertPlayback).toMatchObject({
      status: "started",
      requestedAt: 4_000,
      startedAt: 4_025,
    });
  });

  it("does not alert from only three 1000ms samples", () => {
    let state = createRuneRuntimeState();

    let update = updateRuneRuntimeState({
      previous: state,
      detection: detected,
      now: 1_000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    state = update.state;

    update = updateRuneRuntimeState({
      previous: state,
      detection: detected,
      now: 2_001,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });

    expect(update.shouldAlert).toBe(false);
    expect(update.state.lastDecisionReason).toBe("stabilizing");
    expect(update.state.recentSamples?.slice(-1)[0]).toMatchObject({
      stableCount: 2,
      stableDurationMs: 1_001,
      confirmationPolicyVersion: "rune-confirmation-v3",
      confirmationPolicyMode: "all",
      confirmationSatisfied: false,
      confirmationSatisfiedBy: null,
    });

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: detected,
      now: 3_002,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });

    expect(update.shouldAlert).toBe(false);
    expect(update.state.recentSamples?.slice(-1)[0]).toMatchObject({
      stableCount: 3,
      stableDurationMs: 2_002,
      confirmationSatisfied: false,
      confirmationSatisfiedBy: null,
    });

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: detected,
      now: 4_003,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });

    expect(update.shouldAlert).toBe(true);
    expect(update.state.recentSamples?.slice(-1)[0]).toMatchObject({
      stableCount: 4,
      stableDurationMs: 3_003,
      confirmationPolicyVersion: "rune-confirmation-v3",
      confirmationSatisfied: true,
      confirmationSatisfiedBy: "frames-and-duration",
    });
  });

  it("does not repeat while the same rune remains visible", () => {
    const alerted = {
      ...createRuneRuntimeState(),
      status: "alerted" as const,
      alertedAt: 1000,
      lastRepeatedAlertAt: null,
      lastAlertedAt: 1000,
      lastDetectedAt: 1000,
      lastFoundAt: 1000,
      firstDetectedAt: 1000,
      stableCount: 3,
    };

    const update = updateRuneRuntimeState({
      previous: alerted,
      detection: detected,
      now: 1300,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });

    expect(update.shouldAlert).toBe(false);
    expect(update.state.status).toBe("alerted");
  });

  it("re-arms the same coordinate after a confirmed scene change", () => {
    const alerted = {
      ...createRuneRuntimeState(),
      status: "alerted" as const,
      scenePolicyVersion: "rune-scene-v1" as const,
      sceneEpoch: 0,
      alertedSceneEpoch: 0,
      alertedAt: 1_000,
      lastDetectedAt: 1_400,
      lastFoundAt: 1_000,
      firstDetectedAt: 1_000,
      stableCount: 3,
      lastDetectedCandidate: { x: 10, y: 10, width: 14, height: 14 },
      alertedCandidate: { x: 10, y: 10, width: 14, height: 14 },
    };

    let update = updateRuneRuntimeState({
      previous: alerted,
      detection: detected,
      now: 1_700,
      enabled: true,
      hasStream: true,
      hasRegion: true,
      scene: {
        policyVersion: "rune-scene-v1",
        sceneEpoch: 1,
        changed: true,
        changeScore: 0.31,
        pendingStableCount: 0,
        changedAt: 1_700,
      },
    });
    expect(update.shouldAlert).toBe(false);
    expect(update.state).toMatchObject({
      status: "candidate",
      sceneEpoch: 1,
      alertedAt: null,
      alertedSceneEpoch: null,
      stableCount: 1,
    });
    expect(update.state.recentSamples?.slice(-1)[0]).toMatchObject({
      sceneChanged: true,
      sceneEpoch: 1,
    });

    for (const now of [2_700, 3_700, 4_700]) {
      update = updateRuneRuntimeState({
        previous: update.state,
        detection: detected,
        now,
        enabled: true,
        hasStream: true,
        hasRegion: true,
        scene: {
          policyVersion: "rune-scene-v1",
          sceneEpoch: 1,
          changed: false,
          changeScore: 0.02,
          pendingStableCount: 0,
          changedAt: 1_700,
        },
      });
    }

    expect(update.shouldAlert).toBe(true);
    expect(update.state.alertedAt).toBe(4_700);
    expect(update.state.alertedSceneEpoch).toBe(1);
  });

  it("re-arms after two consecutive non-detections", () => {
    let state: RuneRuntimeState = {
      ...createRuneRuntimeState(),
      status: "alerted" as const,
      alertedAt: 1_000,
      lastDetectedAt: 1_000,
      firstDetectedAt: 100,
      stableCount: 3,
      lastDetectedCandidate: { x: 10, y: 10, width: 14, height: 14 },
      alertedCandidate: { x: 10, y: 10, width: 14, height: 14 },
    };

    let update = updateRuneRuntimeState({
      previous: state,
      detection: missing,
      now: 2_000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.state.status).toBe("alerted");
    expect(update.state.consecutiveMissCount).toBe(1);

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: missing,
      now: 3_000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.state).toMatchObject({
      status: "waiting",
      consecutiveMissCount: 2,
      alertedAt: null,
      alertedCandidate: null,
      lastDecisionReason: "confirmed-absent",
    });

    state = update.state;
    for (const now of [4_000, 5_000, 6_000, 7_000]) {
      update = updateRuneRuntimeState({
        previous: state,
        detection: detected,
        now,
        enabled: true,
        hasStream: true,
        hasRegion: true,
      });
      state = update.state;
    }

    expect(update.shouldAlert).toBe(true);
    expect(update.state.alertedAt).toBe(7_000);
  });

  it("re-arms a different coordinate during the active alert cycle", () => {
    const alerted = {
      ...createRuneRuntimeState(),
      status: "alerted" as const,
      alertedAt: 1000,
      lastRepeatedAlertAt: 1400,
      lastAlertedAt: 1400,
      lastDetectedAt: 1400,
      lastFoundAt: 1000,
      firstDetectedAt: 1000,
      stableCount: 3,
      lastDetectedCandidate: { x: 10, y: 10, width: 14, height: 14 },
      alertedCandidate: { x: 10, y: 10, width: 14, height: 14 },
    };

    let update = updateRuneRuntimeState({
      previous: alerted,
      detection: makeDetected(58, 12),
      now: 1700,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(false);
    expect(update.state.alertedAt).toBe(1000);
    expect(update.state.stableCount).toBe(1);

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: makeDetected(59, 11),
      now: 2_700,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(false);

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: makeDetected(58, 12),
      now: 3_700,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(false);

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: makeDetected(58, 12),
      now: 4_700,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(true);
    expect(update.state.alertedAt).toBe(4_700);
    expect(update.state.alertedCandidate).toEqual({ x: 58, y: 12, width: 14, height: 14 });
    expect(update.state.repeatedAlertCount).toBe(0);
  });

  it("re-arms the same coordinate after a long detection gap", () => {
    const alerted = {
      ...createRuneRuntimeState(),
      status: "alerted" as const,
      alertedAt: 1000,
      lastRepeatedAlertAt: 1400,
      lastAlertedAt: 1400,
      lastDetectedAt: 1400,
      lastFoundAt: 1000,
      firstDetectedAt: 1000,
      stableCount: 3,
      lastDetectedCandidate: { x: 10, y: 10, width: 14, height: 14 },
      alertedCandidate: { x: 10, y: 10, width: 14, height: 14 },
    };

    let update = updateRuneRuntimeState({
      previous: alerted,
      detection: makeDetected(10, 10),
      now: 7000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(false);
    expect(update.state.stableCount).toBe(1);
    expect(update.state.alertedAt).toBeNull();

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: makeDetected(10, 10),
      now: 8_000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(false);

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: makeDetected(10, 10),
      now: 9_000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(false);

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: makeDetected(10, 10),
      now: 10_000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(true);
    expect(update.state.alertedAt).toBe(10_000);
    expect(update.state.alertedCandidate).toEqual({ x: 10, y: 10, width: 14, height: 14 });
    expect(update.state.lastAlertedAt).toBe(10_000);
    expect(update.state.lastFoundAt).toBe(7000);
    expect(update.state.repeatedAlertCount).toBe(0);
  });

  it("re-arms the same rune candidate when the initial playback fails", () => {
    let state = createRuneRuntimeState();

    for (const now of [1_000, 2_000, 3_000, 4_000]) {
      const update = updateRuneRuntimeState({
        previous: state,
        detection: detected,
        now,
        enabled: true,
        hasStream: true,
        hasRegion: true,
      });
      state = update.state;
    }

    expect(state.status).toBe("alerted");
    expect(state.alertedAt).toBe(4_000);

    state = markRuneAlertPlaybackFailed(
      state,
      state.lastAlertPlayback?.cycleId ?? "missing",
      4_050,
      "blocked",
    );

    expect(state.status).toBe("candidate");
    expect(state.alertedAt).toBeNull();
    expect(state.alertedCandidate).toBeNull();
    expect(state.stableCount).toBe(0);
    expect(state.lastDecisionReason).toBe("playback-failed");
    expect(state.lastAlertPlayback).toMatchObject({
      status: "failed",
      decision: "initial",
      error: "blocked",
    });

    let update = updateRuneRuntimeState({
      previous: state,
      detection: detected,
      now: 5_000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(false);

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: detected,
      now: 6_000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(false);

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: detected,
      now: 7_000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(false);

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: detected,
      now: 8_000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(true);
    expect(update.state.alertedAt).toBe(8_000);
  });

  it("re-arms a different coordinate after a long detection gap", () => {
    const alerted = {
      ...createRuneRuntimeState(),
      status: "alerted" as const,
      alertedAt: 1000,
      lastRepeatedAlertAt: 1400,
      lastAlertedAt: 1400,
      lastDetectedAt: 1400,
      lastFoundAt: 1000,
      firstDetectedAt: 1000,
      stableCount: 3,
      lastDetectedCandidate: { x: 10, y: 10, width: 14, height: 14 },
      alertedCandidate: { x: 10, y: 10, width: 14, height: 14 },
    };

    let update = updateRuneRuntimeState({
      previous: alerted,
      detection: makeDetected(42, 32),
      now: 7000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(false);
    expect(update.state.stableCount).toBe(1);

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: makeDetected(43, 31),
      now: 8_000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(false);

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: makeDetected(42, 32),
      now: 9_000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(false);

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: makeDetected(42, 32),
      now: 10_000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    expect(update.shouldAlert).toBe(true);
    expect(update.state.alertedAt).toBe(10_000);
    expect(update.state.alertedCandidate).toEqual({ x: 42, y: 32, width: 14, height: 14 });
    expect(update.state.repeatedAlertCount).toBe(0);
  });

  it("repeats when enabled and the rune is still detected after the interval", () => {
    const alerted = {
      ...createRuneRuntimeState(),
      status: "alerted" as const,
      alertedAt: 1000,
      lastRepeatedAlertAt: null,
      lastDetectedAt: 1000,
      lastFoundAt: 1000,
      firstDetectedAt: 1000,
      stableCount: 4,
      lastAlertPlayback: makePlayback("initial", 1000, "started"),
    };

    let update = updateRuneRuntimeState({
      previous: alerted,
      detection: detected,
      now: 5900,
      enabled: true,
      hasStream: true,
      hasRegion: true,
      config: { repeatAlertEnabled: true, repeatAlertIntervalSeconds: 5 },
    });

    expect(update.shouldAlert).toBe(false);

    const playbackFinished = markRuneAlertPlaybackFinished(
      update.state,
      "0:1000:initial",
      1800,
    );
    expect(playbackFinished.lastAlertedAt).toBe(1800);
    expect(playbackFinished.repeatedAlertCount).toBe(0);

    update = updateRuneRuntimeState({
      previous: playbackFinished,
      detection: detected,
      now: 6_800,
      enabled: true,
      hasStream: true,
      hasRegion: true,
      config: { repeatAlertEnabled: true, repeatAlertIntervalSeconds: 5 },
    });

    expect(update.shouldAlert).toBe(false);

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: detected,
      now: 7_700,
      enabled: true,
      hasStream: true,
      hasRegion: true,
      config: { repeatAlertEnabled: true, repeatAlertIntervalSeconds: 5 },
    });

    expect(update.shouldAlert).toBe(false);

    update = updateRuneRuntimeState({
      previous: update.state,
      detection: detected,
      now: 8_600,
      enabled: true,
      hasStream: true,
      hasRegion: true,
      config: { repeatAlertEnabled: true, repeatAlertIntervalSeconds: 5 },
    });

    expect(update.shouldAlert).toBe(true);
    expect(update.state.alertedAt).toBe(1000);
    expect(update.state.lastRepeatedAlertAt).toBeNull();
    expect(update.state.repeatedAlertCount).toBe(1);
    expect(update.state.lastFoundAt).toBe(1000);
    expect(update.state.lastAlertedAt).toBe(8_600);

    const repeatedPlaybackFinished = markRuneAlertPlaybackFinished(
      update.state,
      update.state.lastAlertPlayback?.cycleId ?? "missing",
      9_000,
    );
    expect(repeatedPlaybackFinished.lastAlertedAt).toBe(9_000);
    expect(repeatedPlaybackFinished.repeatedAlertCount).toBe(1);

    const next = updateRuneRuntimeState({
      previous: repeatedPlaybackFinished,
      detection: detected,
      now: 12_999,
      enabled: true,
      hasStream: true,
      hasRegion: true,
      config: { repeatAlertEnabled: true, repeatAlertIntervalSeconds: 5 },
    });
    expect(next.shouldAlert).toBe(false);
  });

  it("stops repeating after the configured repeat count", () => {
    const alerted = {
      ...createRuneRuntimeState(),
      status: "alerted" as const,
      alertedAt: 1000,
      lastRepeatedAlertAt: 1800,
      lastDetectedAt: 1800,
      lastFoundAt: 1000,
      firstDetectedAt: 1000,
      stableCount: 3,
      repeatedAlertCount: 1,
    };

    const update = updateRuneRuntimeState({
      previous: alerted,
      detection: detected,
      now: 6800,
      enabled: true,
      hasStream: true,
      hasRegion: true,
      config: {
        repeatAlertEnabled: true,
        repeatAlertIntervalSeconds: 5,
        repeatAlertMaxCount: 1,
      },
    });

    expect(update.shouldAlert).toBe(false);
    expect(update.state.repeatedAlertCount).toBe(1);
  });

  it("does not repeat when the rune is no longer detected", () => {
    const alerted = {
      ...createRuneRuntimeState(),
      status: "alerted" as const,
      alertedAt: 1000,
      lastRepeatedAlertAt: null,
      lastAlertedAt: 1000,
      lastDetectedAt: 1000,
      lastFoundAt: 1000,
      firstDetectedAt: 1000,
      stableCount: 3,
    };

    const update = updateRuneRuntimeState({
      previous: alerted,
      detection: missing,
      now: 6000,
      enabled: true,
      hasStream: true,
      hasRegion: true,
      config: { repeatAlertEnabled: true, repeatAlertIntervalSeconds: 5 },
    });

    expect(update.shouldAlert).toBe(false);
    expect(update.state.lastAlertedAt).toBe(1000);
    expect(update.state.lastFoundAt).toBe(1000);
  });

  it("resets detection state while preserving the last alert display time", () => {
    const alerted = {
      ...createRuneRuntimeState(),
      status: "alerted" as const,
      alertedAt: 1000,
      lastRepeatedAlertAt: null,
      lastAlertedAt: 1000,
      lastDetectedAt: 1000,
      lastFoundAt: 1000,
      firstDetectedAt: 1000,
      stableCount: 3,
    };

    const update = updateRuneRuntimeState({
      previous: alerted,
      detection: missing,
      now: 7001,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });

    expect(update.state.status).toBe("waiting");
    expect(update.state.alertedAt).toBeNull();
    expect(update.state.lastRepeatedAlertAt).toBeNull();
    expect(update.state.lastAlertedAt).toBe(1000);
    expect(update.state.lastFoundAt).toBe(1000);
  });

  it("preserves finished repeat playback when a stale frame result still says pending", () => {
    const repeatStarted = {
      ...createRuneRuntimeState(),
      status: "alerted" as const,
      alertedAt: 1000,
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 1,
      lastAlertedAt: 6800,
      lastDetectedAt: 6800,
      lastFoundAt: 1000,
      firstDetectedAt: 1000,
      stableCount: 12,
      lastAlertPlayback: makePlayback("repeat", 6800, "started"),
      lastDecisionReason: "repeat-alert" as const,
    };
    const finished = markRuneAlertPlaybackFinished(
      repeatStarted,
      "0:6800:repeat",
      7200,
    );
    const staleFrameResult = {
      ...repeatStarted,
      lastDetectedAt: 9000,
      stableCount: 18,
      lastDecisionReason: "repeat-playback-pending" as const,
    };

    const merged = mergeRuneRuntimePlaybackProgress(staleFrameResult, finished);

    expect(merged.lastRepeatedAlertAt).toBe(7200);
    expect(merged.lastAlertedAt).toBe(7200);
    expect(merged.repeatedAlertCount).toBe(1);
    expect(merged.lastDecisionReason).toBe("repeat-alert");
    expect(merged.lastAlertPlayback).toMatchObject({
      status: "finished",
      decision: "repeat",
      startedAt: 6800,
      finishedAt: 7200,
    });

    const nextRepeat = updateRuneRuntimeState({
      previous: merged,
      detection: detected,
      now: 9300,
      enabled: true,
      hasStream: true,
      hasRegion: true,
      config: { repeatAlertEnabled: true, repeatAlertIntervalSeconds: 2 },
    });

    expect(nextRepeat.shouldAlert).toBe(true);
    expect(nextRepeat.alertDecision).toBe("repeat");
    expect(nextRepeat.state.repeatedAlertCount).toBe(2);
  });

  it("does not carry an old repeat finish into a newly started repeat alert", () => {
    const previousRepeatFinished = {
      ...createRuneRuntimeState(),
      status: "alerted" as const,
      alertedAt: 1000,
      lastRepeatedAlertAt: 7200,
      repeatedAlertCount: 1,
      lastAlertedAt: 7200,
      lastDetectedAt: 9200,
      lastFoundAt: 1000,
      firstDetectedAt: 1000,
      stableCount: 18,
      lastAlertPlayback: makePlayback("repeat", 6800, "finished", 7200),
      lastDecisionReason: "repeat-alert" as const,
    };
    const nextRepeatStarted = {
      ...previousRepeatFinished,
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 2,
      lastAlertedAt: 9200,
      lastAlertPlayback: makePlayback("repeat", 9200, "started"),
    };

    const merged = mergeRuneRuntimePlaybackProgress(
      nextRepeatStarted,
      previousRepeatFinished,
    );

    expect(merged.lastRepeatedAlertAt).toBeNull();
    expect(merged.lastAlertedAt).toBe(9200);
    expect(merged.repeatedAlertCount).toBe(2);
    expect(merged.lastAlertPlayback).toMatchObject({
      status: "started",
      decision: "repeat",
      startedAt: 9200,
    });
  });
});

function makeDetected(x: number, y: number): RuneDetectionResult {
  return {
    detected: true,
    confidence: 0.72,
    candidates: [{ x, y, width: 14, height: 14, pixelCount: 80, confidence: 0.72 }],
    debug: { purplePixelRatio: 0.02, componentCount: 1 },
  };
}

function makePlayback(
  decision: RuneAlertPlaybackState["decision"],
  requestedAt: number,
  status: RuneAlertPlaybackState["status"],
  finishedAt: number | null = null,
): RuneAlertPlaybackState {
  return {
    status,
    decision,
    cycleId: `0:${requestedAt}:${decision}`,
    sceneEpoch: 0,
    requestedAt,
    startedAt: status === "requested" ? null : requestedAt,
    finishedAt,
    failedAt: null,
    error: null,
    soundId: null,
    alertVolume: null,
    masterVolume: null,
    effectiveVolume: null,
  };
}
