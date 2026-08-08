import { describe, expect, it } from "vitest";
import type { HuntStallReading } from "../contracts/recognition/huntStallExperienceRecognition";
import type { HuntStallAlertConfig } from "../types";
import { updateHuntStallManualExperienceRuntimeState } from "./huntStallManualExperienceRuntime";
import {
  createHuntStallRuntimeState,
  markHuntStallAlertPlaybackFinished,
} from "./huntStallRuntimeState";

function makeConfig(partial: Partial<HuntStallAlertConfig> = {}): HuntStallAlertConfig {
  return {
    enabled: partial.enabled ?? true,
    mode: "manual-experience",
    stallThresholdSeconds: partial.stallThresholdSeconds ?? 10,
    manualExperienceRegion: partial.manualExperienceRegion ?? { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
    manualExperienceRegionsByLayout: partial.manualExperienceRegionsByLayout ?? {},
    cooldownRegion: partial.cooldownRegion ?? null,
    cooldownRegionsByLayout: partial.cooldownRegionsByLayout ?? {},
    cooldownMissingThresholdSeconds: partial.cooldownMissingThresholdSeconds ?? 5,
    soundId: partial.soundId ?? "띵동띵동",
    volume: partial.volume ?? 1,
    repeatAlertEnabled: partial.repeatAlertEnabled ?? false,
    repeatAlertIntervalSeconds: partial.repeatAlertIntervalSeconds ?? 3,
    repeatAlertMaxCount: partial.repeatAlertMaxCount ?? null,
  };
}

function makeReading(
  text: string | null,
  partial: Partial<HuntStallReading> = {},
): HuntStallReading {
  return {
    fingerprint: partial.fingerprint ?? text ?? "empty",
    recognizedText: text,
    confidence: partial.confidence ?? (text ? 0.9 : 0),
    foregroundRatio: partial.foregroundRatio ?? 0.04,
    debugText: partial.debugText,
    ocrCandidates: partial.ocrCandidates,
    rawRecognizedText: partial.rawRecognizedText,
    correctedRecognizedText: partial.correctedRecognizedText,
    correctionApplied: partial.correctionApplied,
    correctionReason: partial.correctionReason,
    barPercent: partial.barPercent,
    barConfidence: partial.barConfidence,
    barCoverage: partial.barCoverage,
    oneFrameRecognizedText: partial.oneFrameRecognizedText,
  };
}

describe("updateHuntStallManualExperienceRuntimeState", () => {
  it("does not arm from mask-only changes before a readable value changes", () => {
    const config = makeConfig({ stallThresholdSeconds: 5 });
    const baseline = updateHuntStallManualExperienceRuntimeState({
      previous: createHuntStallRuntimeState(),
      reading: makeReading(null, { fingerprint: "mask-a", confidence: 0.1 }),
      config,
      now: 1_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(baseline.state.status).toBe("watching");
    expect(baseline.state.hasObservedExperienceChange).toBe(false);

    const pending = updateHuntStallManualExperienceRuntimeState({
      previous: baseline.state,
      reading: makeReading(null, { fingerprint: "mask-b", confidence: 0.1 }),
      config,
      now: 2_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(pending.state.lastDecision).toBe("stable");
    expect(pending.state.hasObservedExperienceChange).toBe(false);
    expect(pending.state.manualExperiencePendingFingerprint).toBeNull();

    const repeatedMask = updateHuntStallManualExperienceRuntimeState({
      previous: pending.state,
      reading: makeReading(null, { fingerprint: "mask-b", confidence: 0.1 }),
      config,
      now: 3_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(repeatedMask.state.lastDecision).toBe("stable");
    expect(repeatedMask.state.hasObservedExperienceChange).toBe(false);
    expect(repeatedMask.state.manualExperiencePendingFingerprint).toBeNull();
  });

  it("arms only after a readable baseline changes and the new value repeats", () => {
    const config = makeConfig({ stallThresholdSeconds: 5 });
    let state = createHuntStallRuntimeState();
    for (const [now, text, fingerprint] of [
      [1_000, null, "black"],
      [2_000, "1,000 [10.000%]", "a"],
    ] as const) {
      state = updateHuntStallManualExperienceRuntimeState({
        previous: state,
        reading: makeReading(text, { fingerprint, confidence: text ? 0.9 : 0.1 }),
        config,
        now,
        hasStream: true,
        hasRegion: true,
      }).state;
    }
    expect(state.lastDecision).toBe("stable");
    expect(state.hasObservedExperienceChange).toBe(false);
    expect(state.recognizedText).toBe("1,000 [10.000%]");

    const pending = updateHuntStallManualExperienceRuntimeState({
      previous: state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 3_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(pending.state.lastDecision).toBe("pending");
    expect(pending.state.hasObservedExperienceChange).toBe(false);

    const confirmed = updateHuntStallManualExperienceRuntimeState({
      previous: pending.state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 4_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(confirmed.state.lastDecision).toBe("confirmed-progress");
    expect(confirmed.state.hasObservedExperienceChange).toBe(true);
    expect(confirmed.state.lastChangedAt).toBe(4_000);
    expect(confirmed.state.recognizedText).toBe("1,100 [11.000%]");
  });

  it("alerts and suppresses repeats for the same confirmed value", () => {
    const config = makeConfig({ stallThresholdSeconds: 5 });
    let state = createHuntStallRuntimeState();
    for (const [now, text, fingerprint] of [
      [1_000, "1,000 [10.000%]", "a"],
      [2_000, "1,100 [11.000%]", "b"],
      [3_000, "1,100 [11.000%]", "b"],
    ] as const) {
      state = updateHuntStallManualExperienceRuntimeState({
        previous: state,
        reading: makeReading(text, { fingerprint }),
        config,
        now,
        hasStream: true,
        hasRegion: true,
      }).state;
    }

    const alerted = updateHuntStallManualExperienceRuntimeState({
      previous: state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 8_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(alerted.shouldAlert).toBe(true);
    expect(alerted.state.manualExperienceAlertedFingerprint).toBe("b");

    const repeated = updateHuntStallManualExperienceRuntimeState({
      previous: alerted.state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 14_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(repeated.shouldAlert).toBe(false);
    expect(repeated.state.status).toBe("alerted");
  });

  it("treats a changed readable value as immediate progress after monitoring is armed", () => {
    const config = makeConfig({ stallThresholdSeconds: 5 });
    let state = createHuntStallRuntimeState();
    for (const [now, text, fingerprint] of [
      [1_000, "1,000 [10.000%]", "a"],
      [2_000, "1,100 [11.000%]", "b"],
      [3_000, "1,100 [11.000%]", "b"],
    ] as const) {
      state = updateHuntStallManualExperienceRuntimeState({
        previous: state,
        reading: makeReading(text, { fingerprint }),
        config,
        now,
        hasStream: true,
        hasRegion: true,
      }).state;
    }

    const progressed = updateHuntStallManualExperienceRuntimeState({
      previous: state,
      reading: makeReading("1,200 [12.000%]", { fingerprint: "c" }),
      config,
      now: 8_000,
      hasStream: true,
      hasRegion: true,
    });

    expect(progressed.shouldAlert).toBe(false);
    expect(progressed.state.lastDecision).toBe("confirmed-progress");
    expect(progressed.state.lastChangedAt).toBe(8_000);
    expect(progressed.state.unchangedSeconds).toBe(0);
    expect(progressed.state.recognizedText).toBe("1,200 [12.000%]");
    expect(progressed.state.pendingRecognizedCount).toBe(0);
  });

  it("repeats manual experience alerts after the initial alert up to the configured count", () => {
    const config = makeConfig({
      stallThresholdSeconds: 5,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: 2,
    });
    let state = createHuntStallRuntimeState();
    for (const [now, text, fingerprint] of [
      [1_000, "1,000 [10.000%]", "a"],
      [2_000, "1,100 [11.000%]", "b"],
      [3_000, "1,100 [11.000%]", "b"],
    ] as const) {
      state = updateHuntStallManualExperienceRuntimeState({
        previous: state,
        reading: makeReading(text, { fingerprint }),
        config,
        now,
        hasStream: true,
        hasRegion: true,
      }).state;
    }

    const initialAlert = updateHuntStallManualExperienceRuntimeState({
      previous: state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 8_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(initialAlert.shouldAlert).toBe(true);
    expect(initialAlert.state.alertedAt).toBe(8_000);
    expect(initialAlert.state.repeatedAlertCount).toBe(0);
    expect(initialAlert.state.lastRepeatedAlertAt).toBeNull();
    expect(initialAlert.state.lastAlertedAt).toBe(8_000);

    const duringInitialPlayback = updateHuntStallManualExperienceRuntimeState({
      previous: initialAlert.state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 11_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(duringInitialPlayback.shouldAlert).toBe(false);
    expect(duringInitialPlayback.state.repeatedAlertCount).toBe(0);
    expect(duringInitialPlayback.state.lastRepeatedAlertAt).toBeNull();

    const initialPlaybackFinished = markHuntStallAlertPlaybackFinished(
      initialAlert.state,
      8_000,
      8_400,
    );
    expect(initialPlaybackFinished.lastRepeatedAlertAt).toBe(8_400);
    expect(initialPlaybackFinished.lastAlertedAt).toBe(8_400);

    const beforeFirstRepeat = updateHuntStallManualExperienceRuntimeState({
      previous: initialPlaybackFinished,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 11_399,
      hasStream: true,
      hasRegion: true,
    });
    expect(beforeFirstRepeat.shouldAlert).toBe(false);

    const firstRepeat = updateHuntStallManualExperienceRuntimeState({
      previous: beforeFirstRepeat.state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 11_400,
      hasStream: true,
      hasRegion: true,
    });
    expect(firstRepeat.shouldAlert).toBe(true);
    expect(firstRepeat.state.alertedAt).toBe(8_000);
    expect(firstRepeat.state.repeatedAlertCount).toBe(1);
    expect(firstRepeat.state.lastRepeatedAlertAt).toBeNull();
    expect(firstRepeat.state.lastAlertedAt).toBe(11_400);

    const firstRepeatFinished = markHuntStallAlertPlaybackFinished(
      firstRepeat.state,
      8_000,
      11_800,
    );
    expect(firstRepeatFinished.lastRepeatedAlertAt).toBe(11_800);

    const secondRepeat = updateHuntStallManualExperienceRuntimeState({
      previous: firstRepeatFinished,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 14_800,
      hasStream: true,
      hasRegion: true,
    });
    expect(secondRepeat.shouldAlert).toBe(true);
    expect(secondRepeat.state.repeatedAlertCount).toBe(2);
    expect(secondRepeat.state.lastRepeatedAlertAt).toBeNull();

    const secondRepeatFinished = markHuntStallAlertPlaybackFinished(
      secondRepeat.state,
      8_000,
      15_100,
    );
    expect(secondRepeatFinished.lastRepeatedAlertAt).toBe(15_100);

    const exhausted = updateHuntStallManualExperienceRuntimeState({
      previous: secondRepeatFinished,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 18_100,
      hasStream: true,
      hasRegion: true,
    });
    expect(exhausted.shouldAlert).toBe(false);
    expect(exhausted.state.repeatedAlertCount).toBe(2);
  });

  it("keeps the manual experience repeat cycle through a temporary unreadable sample", () => {
    const config = makeConfig({
      stallThresholdSeconds: 5,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: 1,
    });
    let state = createHuntStallRuntimeState();
    for (const [now, text, fingerprint] of [
      [1_000, "1,000 [10.000%]", "a"],
      [2_000, "1,100 [11.000%]", "b"],
      [3_000, "1,100 [11.000%]", "b"],
    ] as const) {
      state = updateHuntStallManualExperienceRuntimeState({
        previous: state,
        reading: makeReading(text, { fingerprint }),
        config,
        now,
        hasStream: true,
        hasRegion: true,
      }).state;
    }

    const initialAlert = updateHuntStallManualExperienceRuntimeState({
      previous: state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 8_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(initialAlert.shouldAlert).toBe(true);
    const playbackFinished = markHuntStallAlertPlaybackFinished(
      initialAlert.state,
      8_000,
      8_400,
    );

    const unreadable = updateHuntStallManualExperienceRuntimeState({
      previous: playbackFinished,
      reading: null,
      config,
      now: 10_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(unreadable.shouldAlert).toBe(false);
    expect(unreadable.state.alertedAt).toBe(8_000);
    expect(unreadable.state.lastRepeatedAlertAt).toBe(8_400);
    expect(unreadable.state.repeatedAlertCount).toBe(0);

    const repeated = updateHuntStallManualExperienceRuntimeState({
      previous: unreadable.state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 11_400,
      hasStream: true,
      hasRegion: true,
    });
    expect(repeated.shouldAlert).toBe(true);
    expect(repeated.state.alertedAt).toBe(8_000);
    expect(repeated.state.lastRepeatedAlertAt).toBeNull();
    expect(repeated.state.repeatedAlertCount).toBe(1);
  });

  it("records playback completion while the active alert cycle is temporarily unreadable", () => {
    const state = {
      ...createHuntStallRuntimeState(),
      status: "unavailable" as const,
      alertedAt: 8_000,
      lastRepeatedAlertAt: null,
      lastAlertedAt: 8_000,
    };

    expect(markHuntStallAlertPlaybackFinished(state, 8_000, 8_400)).toMatchObject({
      status: "unavailable",
      alertedAt: 8_000,
      lastRepeatedAlertAt: 8_400,
      lastAlertedAt: 8_400,
    });
  });

  it("does not confirm one-frame OCR text jitter when the extracted number mask barely changes", () => {
    const config = makeConfig({ stallThresholdSeconds: 5 });
    const stableMask = "0".repeat(120);
    const jitterMask = `${"0".repeat(119)}1`;
    const baseline = updateHuntStallManualExperienceRuntimeState({
      previous: createHuntStallRuntimeState(),
      reading: makeReading("1,000 [10.000%]", { fingerprint: stableMask }),
      config,
      now: 1_000,
      hasStream: true,
      hasRegion: true,
    });

    const jitter = updateHuntStallManualExperienceRuntimeState({
      previous: baseline.state,
      reading: makeReading("1,001 [10.001%]", { fingerprint: jitterMask }),
      config,
      now: 2_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(jitter.state.lastDecision).toBe("pending");
    expect(jitter.state.hasObservedExperienceChange).toBe(false);
    expect(jitter.state.pendingRecognizedCount).toBe(1);
    expect(jitter.state.recognizedText).toBe("1,000 [10.000%]");

    const recovered = updateHuntStallManualExperienceRuntimeState({
      previous: jitter.state,
      reading: makeReading("1,000 [10.000%]", { fingerprint: stableMask }),
      config,
      now: 3_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(recovered.state.lastDecision).toBe("stable");
    expect(recovered.state.hasObservedExperienceChange).toBe(false);
    expect(recovered.state.pendingRecognizedCount).toBe(0);
  });

  it("confirms progress from repeated OCR text changes even when the mask barely changes", () => {
    const config = makeConfig({ stallThresholdSeconds: 5 });
    const stableMask = "0".repeat(120);
    const changedMask = `${"0".repeat(119)}1`;
    const baseline = updateHuntStallManualExperienceRuntimeState({
      previous: createHuntStallRuntimeState(),
      reading: makeReading("1,000 [10.000%]", { fingerprint: stableMask }),
      config,
      now: 1_000,
      hasStream: true,
      hasRegion: true,
    });

    const pending = updateHuntStallManualExperienceRuntimeState({
      previous: baseline.state,
      reading: makeReading("1,001 [10.001%]", { fingerprint: changedMask }),
      config,
      now: 2_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(pending.state.lastDecision).toBe("pending");
    expect(pending.state.hasObservedExperienceChange).toBe(false);

    const confirmed = updateHuntStallManualExperienceRuntimeState({
      previous: pending.state,
      reading: makeReading("1,001 [10.001%]", { fingerprint: changedMask }),
      config,
      now: 3_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(confirmed.state.lastDecision).toBe("confirmed-progress");
    expect(confirmed.state.hasObservedExperienceChange).toBe(true);
    expect(confirmed.state.lastChangedAt).toBe(3_000);
    expect(confirmed.state.recognizedText).toBe("1,001 [10.001%]");
    expect(confirmed.shouldAlert).toBe(false);
  });

  it("does not let unconfirmed pending changes suppress a stall alert indefinitely", () => {
    const config = makeConfig({ stallThresholdSeconds: 5 });
    let state = createHuntStallRuntimeState();
    for (const [now, text, fingerprint] of [
      [1_000, "1,000 [10.000%]", "a"],
      [2_000, "1,100 [11.000%]", "b"],
      [3_000, "1,100 [11.000%]", "b"],
    ] as const) {
      state = updateHuntStallManualExperienceRuntimeState({
        previous: state,
        reading: makeReading(text, { fingerprint }),
        config,
        now,
        hasStream: true,
        hasRegion: true,
      }).state;
    }

    const firstPending = updateHuntStallManualExperienceRuntimeState({
      previous: state,
      reading: makeReading(null, { fingerprint: "c", confidence: 0.1 }),
      config,
      now: 8_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(firstPending.shouldAlert).toBe(false);
    expect(firstPending.state.lastDecision).toBe("pending");
    expect(firstPending.state.unchangedSeconds).toBe(5);
    expect(firstPending.state.recognizedText).toBe("1,100 [11.000%]");

    const unresolvedPending = updateHuntStallManualExperienceRuntimeState({
      previous: firstPending.state,
      reading: makeReading(null, { fingerprint: "d", confidence: 0.1 }),
      config,
      now: 9_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(unresolvedPending.shouldAlert).toBe(true);
    expect(unresolvedPending.state.status).toBe("alerted");
    expect(unresolvedPending.state.unchangedSeconds).toBe(6);
    expect(unresolvedPending.state.alertedRecognizedText).toBe("1,100 [11.000%]");
    expect(unresolvedPending.state.manualExperienceAlertedFingerprint).toBe("b");
  });

  it("ignores mask-only changes when the stable recognized value is unchanged", () => {
    const config = makeConfig({ stallThresholdSeconds: 5 });
    let state = createHuntStallRuntimeState();
    for (const [now, text, fingerprint] of [
      [1_000, "1,000 [10.000%]", "a"],
      [2_000, "1,100 [11.000%]", "b"],
      [3_000, "1,100 [11.000%]", "b"],
    ] as const) {
      state = updateHuntStallManualExperienceRuntimeState({
        previous: state,
        reading: makeReading(text, { fingerprint }),
        config,
        now,
        hasStream: true,
        hasRegion: true,
      }).state;
    }

    const ignored = updateHuntStallManualExperienceRuntimeState({
      previous: state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "visual-jitter" }),
      config,
      now: 7_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(ignored.shouldAlert).toBe(false);
    expect(ignored.state.lastDecision).toBe("ignored-jitter");
    expect(ignored.state.pendingRecognizedCount).toBe(0);
    expect(ignored.state.lastChangedAt).toBe(3_000);
    expect(ignored.state.recognizedText).toBe("1,100 [11.000%]");

    const alerted = updateHuntStallManualExperienceRuntimeState({
      previous: ignored.state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "another-visual-jitter" }),
      config,
      now: 8_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(alerted.shouldAlert).toBe(true);
    expect(alerted.state.unchangedSeconds).toBe(5);
    expect(alerted.state.alertedRecognizedText).toBe("1,100 [11.000%]");
  });

  it("clears a visual pending candidate when the recognized value returns unchanged", () => {
    const config = makeConfig({ stallThresholdSeconds: 5 });
    let state = createHuntStallRuntimeState();
    for (const [now, text, fingerprint] of [
      [1_000, "1,000 [10.000%]", "a"],
      [2_000, "1,100 [11.000%]", "b"],
      [3_000, "1,100 [11.000%]", "b"],
    ] as const) {
      state = updateHuntStallManualExperienceRuntimeState({
        previous: state,
        reading: makeReading(text, { fingerprint }),
        config,
        now,
        hasStream: true,
        hasRegion: true,
      }).state;
    }

    const pendingWithoutText = updateHuntStallManualExperienceRuntimeState({
      previous: state,
      reading: makeReading(null, { fingerprint: "visual-jitter", confidence: 0.1 }),
      config,
      now: 4_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(pendingWithoutText.state.lastDecision).toBe("pending");
    expect(pendingWithoutText.state.pendingRecognizedCount).toBe(1);

    const recoveredSameText = updateHuntStallManualExperienceRuntimeState({
      previous: pendingWithoutText.state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "visual-jitter" }),
      config,
      now: 5_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(recoveredSameText.shouldAlert).toBe(false);
    expect(recoveredSameText.state.lastDecision).toBe("ignored-jitter");
    expect(recoveredSameText.state.pendingRecognizedCount).toBe(0);
    expect(recoveredSameText.state.hasObservedExperienceChange).toBe(true);
    expect(recoveredSameText.state.lastChangedAt).toBe(3_000);
  });

  it("confirms repeated mask-only pending progress during the alert grace window", () => {
    const config = makeConfig({ stallThresholdSeconds: 5 });
    let state = createHuntStallRuntimeState();
    for (const [now, text, fingerprint] of [
      [1_000, "1,000 [10.000%]", "a"],
      [2_000, "1,100 [11.000%]", "b"],
      [3_000, "1,100 [11.000%]", "b"],
    ] as const) {
      state = updateHuntStallManualExperienceRuntimeState({
        previous: state,
        reading: makeReading(text, { fingerprint }),
        config,
        now,
        hasStream: true,
        hasRegion: true,
      }).state;
    }

    const pending = updateHuntStallManualExperienceRuntimeState({
      previous: state,
      reading: makeReading(null, { fingerprint: "c", confidence: 0.1 }),
      config,
      now: 8_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(pending.shouldAlert).toBe(false);

    const confirmed = updateHuntStallManualExperienceRuntimeState({
      previous: pending.state,
      reading: makeReading(null, { fingerprint: "c", confidence: 0.1 }),
      config,
      now: 9_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(confirmed.shouldAlert).toBe(false);
    expect(confirmed.state.lastDecision).toBe("confirmed-progress");
    expect(confirmed.state.lastChangedAt).toBe(9_000);
    expect(confirmed.state.recognizedText).toBe("1,100 [11.000%]");
  });

  it("arms only after a changed experience value is confirmed twice", () => {
    const config = makeConfig({ stallThresholdSeconds: 5 });
    const baseline = updateHuntStallManualExperienceRuntimeState({
      previous: createHuntStallRuntimeState(),
      reading: makeReading("1,000 [10.000%]", { fingerprint: "a" }),
      config,
      now: 1_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(baseline.state.status).toBe("watching");
    expect(baseline.state.hasObservedExperienceChange).toBe(false);

    const pending = updateHuntStallManualExperienceRuntimeState({
      previous: baseline.state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 2_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(pending.state.lastDecision).toBe("pending");
    expect(pending.state.hasObservedExperienceChange).toBe(false);

    const confirmed = updateHuntStallManualExperienceRuntimeState({
      previous: pending.state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 3_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(confirmed.state.lastDecision).toBe("confirmed-progress");
    expect(confirmed.state.hasObservedExperienceChange).toBe(true);
    expect(confirmed.state.lastChangedAt).toBe(3_000);
  });

  it("alerts after the confirmed value stays unchanged for the threshold", () => {
    const config = makeConfig({ stallThresholdSeconds: 5 });
    let state = createHuntStallRuntimeState();
    for (const [now, text, fingerprint] of [
      [1_000, "1,000 [10.000%]", "a"],
      [2_000, "1,100 [11.000%]", "b"],
      [3_000, "1,100 [11.000%]", "b"],
    ] as const) {
      state = updateHuntStallManualExperienceRuntimeState({
        previous: state,
        reading: makeReading(text, { fingerprint }),
        config,
        now,
        hasStream: true,
        hasRegion: true,
      }).state;
    }

    const result = updateHuntStallManualExperienceRuntimeState({
      previous: state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 8_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(result.shouldAlert).toBe(true);
    expect(result.state.status).toBe("alerted");
    expect(result.state.alertedRecognizedText).toBe("1,100 [11.000%]");
  });

  it("does not count unreadable time as unchanged time", () => {
    const config = makeConfig({ stallThresholdSeconds: 5 });
    let state = createHuntStallRuntimeState();
    for (const [now, text, fingerprint] of [
      [1_000, "1,000 [10.000%]", "a"],
      [2_000, "1,100 [11.000%]", "b"],
      [3_000, "1,100 [11.000%]", "b"],
    ] as const) {
      state = updateHuntStallManualExperienceRuntimeState({
        previous: state,
        reading: makeReading(text, { fingerprint }),
        config,
        now,
        hasStream: true,
        hasRegion: true,
      }).state;
    }

    state = updateHuntStallManualExperienceRuntimeState({
      previous: state,
      reading: makeReading(null, { foregroundRatio: 0.0001, fingerprint: "noise" }),
      config,
      now: 6_000,
      hasStream: true,
      hasRegion: true,
    }).state;
    const recovered = updateHuntStallManualExperienceRuntimeState({
      previous: state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 10_000,
      hasStream: true,
      hasRegion: true,
    });

    expect(recovered.shouldAlert).toBe(false);
    expect(recovered.state.unchangedSeconds).toBe(3);
  });

  it("does not alert again for the same stalled value", () => {
    const config = makeConfig({ stallThresholdSeconds: 5 });
    let state = createHuntStallRuntimeState();
    for (const [now, text, fingerprint] of [
      [1_000, "1,000 [10.000%]", "a"],
      [2_000, "1,100 [11.000%]", "b"],
      [3_000, "1,100 [11.000%]", "b"],
      [8_000, "1,100 [11.000%]", "b"],
    ] as const) {
      state = updateHuntStallManualExperienceRuntimeState({
        previous: state,
        reading: makeReading(text, { fingerprint }),
        config,
        now,
        hasStream: true,
        hasRegion: true,
      }).state;
    }

    const repeated = updateHuntStallManualExperienceRuntimeState({
      previous: state,
      reading: makeReading("1,100 [11.000%]", { fingerprint: "b" }),
      config,
      now: 14_000,
      hasStream: true,
      hasRegion: true,
    });
    expect(repeated.shouldAlert).toBe(false);
    expect(repeated.state.status).toBe("alerted");
  });
});
