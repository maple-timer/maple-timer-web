import { describe, expect, it } from "vitest";
import type { HuntStallAlertConfig, RecognitionResult } from "../types";
import type { HuntStallCooldownVisualActivity } from "../recognition/hunt-stall/cooldown/huntStallCooldownActivity";
import { updateHuntStallCooldownPresenceRuntimeState } from "./huntStallCooldownPresenceRuntime";
import { createHuntStallRuntimeState } from "./huntStallRuntimeState";

function makeCooldownPresenceConfig(
  partial: Partial<HuntStallAlertConfig> = {},
): HuntStallAlertConfig {
  return {
    enabled: partial.enabled ?? true,
    mode: "cooldown-presence",
    stallThresholdSeconds: partial.stallThresholdSeconds ?? 10,
    cooldownRegion: partial.cooldownRegion ?? null,
    cooldownRegionsByLayout: partial.cooldownRegionsByLayout ?? {},
    cooldownMissingThresholdSeconds: partial.cooldownMissingThresholdSeconds ?? 12,
    soundId: partial.soundId ?? "띵동띵동",
    volume: partial.volume ?? 0.8,
  };
}

function makeCooldownResult(
  value: number | null,
  partial: Partial<RecognitionResult> = {},
): RecognitionResult {
  return {
    value,
    confidence: partial.confidence ?? (value === null ? 0 : 0.9),
    debug: {
      recognizedText: value === null ? undefined : String(value),
      reason: value === null ? "ocr-empty" : undefined,
      ...partial.debug,
    },
  };
}

function makeCooldownVisualActivity(level: string): HuntStallCooldownVisualActivity {
  return {
    fingerprint: level.repeat(16 * 16),
    gridColumns: 16,
    gridRows: 16,
    foregroundRatio: level === "0" ? 0.1 : 0.2,
  };
}

describe("huntStall cooldown presence runtime", () => {
  it("requires a confirmed cooldown change before arming cooldown activity alerts", () => {
    const config = makeCooldownPresenceConfig({ cooldownMissingThresholdSeconds: 10 });

    const first = updateHuntStallCooldownPresenceRuntimeState({
      previous: createHuntStallRuntimeState(),
      result: makeCooldownResult(7),
      config,
      now: 1_000,
      hasStream: true,
      hasRegion: true,
    });
    const second = updateHuntStallCooldownPresenceRuntimeState({
      previous: first.state,
      result: makeCooldownResult(6),
      config,
      now: 2_000,
      hasStream: true,
      hasRegion: true,
    });

    expect(first.shouldAlert).toBe(false);
    expect(first.state.status).toBe("watching");
    expect(first.state.hasObservedCooldownPresence).toBe(false);
    expect(second.shouldAlert).toBe(false);
    expect(second.state.status).toBe("active");
    expect(second.state.hasObservedCooldownPresence).toBe(true);
  });

  it("does not arm cooldown activity alerts from repeated identical numbers", () => {
    const config = makeCooldownPresenceConfig({ cooldownMissingThresholdSeconds: 3 });

    const first = updateHuntStallCooldownPresenceRuntimeState({
      previous: createHuntStallRuntimeState(),
      result: makeCooldownResult(7),
      config,
      now: 1_000,
      hasStream: true,
      hasRegion: true,
    });
    const second = updateHuntStallCooldownPresenceRuntimeState({
      previous: first.state,
      result: makeCooldownResult(7),
      config,
      now: 2_000,
      hasStream: true,
      hasRegion: true,
    });
    const stale = updateHuntStallCooldownPresenceRuntimeState({
      previous: second.state,
      result: makeCooldownResult(7),
      config,
      now: 8_000,
      hasStream: true,
      hasRegion: true,
    });

    expect(second.shouldAlert).toBe(false);
    expect(second.state.status).toBe("watching");
    expect(second.state.hasObservedCooldownPresence).toBe(false);
    expect(stale.shouldAlert).toBe(false);
    expect(stale.state.status).toBe("watching");
    expect(stale.state.hasObservedCooldownPresence).toBe(false);
  });

  it("alerts once when an armed cooldown number stays unreadable for the configured threshold", () => {
    const config = makeCooldownPresenceConfig({ cooldownMissingThresholdSeconds: 10 });
    const armed = updateHuntStallCooldownPresenceRuntimeState({
      previous: {
        ...createHuntStallRuntimeState(),
        status: "active",
        lastReadableAt: 2_000,
        recognizedText: "6",
        hasObservedCooldownPresence: true,
        cooldownLastDetectedAt: 2_000,
        cooldownConsecutiveReadableCount: 2,
      },
      result: null,
      config,
      now: 8_000,
      hasStream: true,
      hasRegion: true,
    });
    const alerted = updateHuntStallCooldownPresenceRuntimeState({
      previous: armed.state,
      result: makeCooldownResult(null),
      config,
      now: 12_000,
      hasStream: true,
      hasRegion: true,
    });
    const repeated = updateHuntStallCooldownPresenceRuntimeState({
      previous: alerted.state,
      result: null,
      config,
      now: 20_000,
      hasStream: true,
      hasRegion: true,
    });

    expect(armed.shouldAlert).toBe(false);
    expect(armed.state.cooldownMissingSeconds).toBe(6);
    expect(alerted.shouldAlert).toBe(true);
    expect(alerted.state.status).toBe("alerted");
    expect(alerted.state.alertedAt).toBe(12_000);
    expect(repeated.shouldAlert).toBe(false);
    expect(repeated.state.alertedAt).toBe(12_000);
  });

  it("alerts once when an armed cooldown number stays unchanged for the configured threshold", () => {
    const config = makeCooldownPresenceConfig({ cooldownMissingThresholdSeconds: 10 });
    const armed = updateHuntStallCooldownPresenceRuntimeState({
      previous: {
        ...createHuntStallRuntimeState(),
        status: "active",
        lastChangedAt: 2_000,
        lastReadableAt: 2_000,
        recognizedText: "7",
        hasObservedCooldownPresence: true,
        cooldownLastDetectedAt: 2_000,
        cooldownConsecutiveReadableCount: 2,
        lastDecision: "cooldown-readable",
      },
      result: makeCooldownResult(7),
      config,
      now: 8_000,
      hasStream: true,
      hasRegion: true,
    });
    const alerted = updateHuntStallCooldownPresenceRuntimeState({
      previous: armed.state,
      result: makeCooldownResult(7),
      config,
      now: 12_000,
      hasStream: true,
      hasRegion: true,
    });

    expect(armed.shouldAlert).toBe(false);
    expect(armed.state.status).toBe("active");
    expect(armed.state.unchangedSeconds).toBe(6);
    expect(armed.state.lastDecision).toBe("cooldown-unchanged");
    expect(alerted.shouldAlert).toBe(true);
    expect(alerted.state.status).toBe("alerted");
    expect(alerted.state.unchangedSeconds).toBe(10);
    expect(alerted.state.alertedAt).toBe(12_000);
  });

  it("treats cooldown number changes as activity even after the threshold elapsed", () => {
    const config = makeCooldownPresenceConfig({ cooldownMissingThresholdSeconds: 10 });
    const update = updateHuntStallCooldownPresenceRuntimeState({
      previous: {
        ...createHuntStallRuntimeState(),
        status: "active",
        lastChangedAt: 2_000,
        lastReadableAt: 10_000,
        recognizedText: "7",
        hasObservedCooldownPresence: true,
        cooldownLastDetectedAt: 10_000,
        cooldownConsecutiveReadableCount: 8,
        lastDecision: "cooldown-readable",
      },
      result: makeCooldownResult(6),
      config,
      now: 12_000,
      hasStream: true,
      hasRegion: true,
    });

    expect(update.shouldAlert).toBe(false);
    expect(update.state.status).toBe("active");
    expect(update.state.lastChangedAt).toBe(12_000);
    expect(update.state.unchangedSeconds).toBe(0);
    expect(update.state.recognizedText).toBe("6");
  });

  it("treats cooldown visual changes as activity after a trusted number was seen", () => {
    const config = makeCooldownPresenceConfig({ cooldownMissingThresholdSeconds: 5 });
    const first = updateHuntStallCooldownPresenceRuntimeState({
      previous: createHuntStallRuntimeState(),
      result: makeCooldownResult(7),
      activity: makeCooldownVisualActivity("0"),
      config,
      now: 1_000,
      hasStream: true,
      hasRegion: true,
    });
    const visualOne = updateHuntStallCooldownPresenceRuntimeState({
      previous: first.state,
      result: makeCooldownResult(null),
      activity: makeCooldownVisualActivity("f"),
      config,
      now: 2_000,
      hasStream: true,
      hasRegion: true,
    });
    const visualTwo = updateHuntStallCooldownPresenceRuntimeState({
      previous: visualOne.state,
      result: makeCooldownResult(null),
      activity: makeCooldownVisualActivity("0"),
      config,
      now: 3_000,
      hasStream: true,
      hasRegion: true,
    });
    const alerted = updateHuntStallCooldownPresenceRuntimeState({
      previous: visualTwo.state,
      result: makeCooldownResult(null),
      activity: makeCooldownVisualActivity("0"),
      config,
      now: 8_000,
      hasStream: true,
      hasRegion: true,
    });

    expect(visualOne.shouldAlert).toBe(false);
    expect(visualOne.state.hasObservedCooldownPresence).toBe(false);
    expect(visualOne.state.lastDecision).toBe("cooldown-visual-active");
    expect(visualTwo.state.hasObservedCooldownPresence).toBe(true);
    expect(visualTwo.state.lastChangedAt).toBe(3_000);
    expect(visualTwo.state.cooldownUsedVisualActivity).toBe(true);
    expect(alerted.shouldAlert).toBe(true);
    expect(alerted.state.unchangedSeconds).toBe(5);
  });

  it("does not alert while cooldown visual activity continues through unreadable OCR", () => {
    const config = makeCooldownPresenceConfig({ cooldownMissingThresholdSeconds: 5 });
    const update = updateHuntStallCooldownPresenceRuntimeState({
      previous: {
        ...createHuntStallRuntimeState(),
        status: "active",
        lastChangedAt: 2_000,
        lastReadableAt: 2_000,
        recognizedText: "6",
        hasObservedCooldownPresence: true,
        cooldownLastDetectedAt: 2_000,
        cooldownVisualFingerprint: makeCooldownVisualActivity("0").fingerprint,
      },
      result: makeCooldownResult(null),
      activity: makeCooldownVisualActivity("f"),
      config,
      now: 12_000,
      hasStream: true,
      hasRegion: true,
    });

    expect(update.shouldAlert).toBe(false);
    expect(update.state.status).toBe("active");
    expect(update.state.lastChangedAt).toBe(12_000);
    expect(update.state.unchangedSeconds).toBe(0);
    expect(update.state.lastDecision).toBe("cooldown-visual-active");
    expect(update.state.cooldownUsedVisualActivity).toBe(true);
  });

  it("does not arm cooldown alerts from visual changes before any trusted number", () => {
    const config = makeCooldownPresenceConfig({ cooldownMissingThresholdSeconds: 5 });
    const first = updateHuntStallCooldownPresenceRuntimeState({
      previous: createHuntStallRuntimeState(),
      result: makeCooldownResult(null),
      activity: makeCooldownVisualActivity("0"),
      config,
      now: 1_000,
      hasStream: true,
      hasRegion: true,
    });
    const second = updateHuntStallCooldownPresenceRuntimeState({
      previous: first.state,
      result: makeCooldownResult(null),
      activity: makeCooldownVisualActivity("f"),
      config,
      now: 10_000,
      hasStream: true,
      hasRegion: true,
    });

    expect(second.shouldAlert).toBe(false);
    expect(second.state.hasObservedCooldownPresence).toBe(false);
    expect(second.state.status).toBe("detecting");
    expect(second.state.cooldownUsedVisualActivity).toBe(false);
  });

  it("re-arms cooldown alerts after a new cooldown number is confirmed", () => {
    const config = makeCooldownPresenceConfig({ cooldownMissingThresholdSeconds: 10 });
    const previous = {
      ...createHuntStallRuntimeState(),
      status: "alerted" as const,
      lastChangedAt: 2_000,
      lastReadableAt: 2_000,
      alertedAt: 12_000,
      recognizedText: "6",
      alertedRecognizedText: "6",
      hasObservedCooldownPresence: true,
      cooldownLastDetectedAt: 2_000,
      cooldownMissingSinceAt: 2_000,
      cooldownMissingSeconds: 10,
      cooldownConsecutiveReadableCount: 0,
    };

    const candidate = updateHuntStallCooldownPresenceRuntimeState({
      previous,
      result: makeCooldownResult(7),
      config,
      now: 14_000,
      hasStream: true,
      hasRegion: true,
    });
    const confirmed = updateHuntStallCooldownPresenceRuntimeState({
      previous: candidate.state,
      result: makeCooldownResult(7),
      config,
      now: 15_000,
      hasStream: true,
      hasRegion: true,
    });
    const repeated = updateHuntStallCooldownPresenceRuntimeState({
      previous: confirmed.state,
      result: makeCooldownResult(7),
      config,
      now: 25_000,
      hasStream: true,
      hasRegion: true,
    });

    expect(candidate.shouldAlert).toBe(false);
    expect(candidate.state.status).toBe("alerted");
    expect(candidate.state.alertedAt).toBe(12_000);
    expect(candidate.state.pendingRecognizedText).toBe("7");
    expect(candidate.state.pendingRecognizedCount).toBe(1);
    expect(confirmed.shouldAlert).toBe(false);
    expect(confirmed.state.status).toBe("active");
    expect(confirmed.state.alertedAt).toBeNull();
    expect(confirmed.state.alertedRecognizedText).toBeNull();
    expect(confirmed.state.pendingRecognizedText).toBeNull();
    expect(confirmed.state.lastChangedAt).toBe(15_000);
    expect(confirmed.state.unchangedSeconds).toBe(0);
    expect(repeated.shouldAlert).toBe(true);
    expect(repeated.state.status).toBe("alerted");
    expect(repeated.state.alertedAt).toBe(25_000);
  });

  it("re-arms cooldown alerts after a new decreasing countdown sequence is confirmed", () => {
    const config = makeCooldownPresenceConfig({ cooldownMissingThresholdSeconds: 3 });
    const previous = {
      ...createHuntStallRuntimeState(),
      status: "alerted" as const,
      lastChangedAt: 35_000,
      lastReadableAt: 35_000,
      alertedAt: 38_000,
      recognizedText: "1",
      alertedRecognizedText: "1",
      hasObservedCooldownPresence: true,
      cooldownLastDetectedAt: 35_000,
      cooldownConsecutiveReadableCount: 0,
    };

    const first = updateHuntStallCooldownPresenceRuntimeState({
      previous,
      result: makeCooldownResult(13),
      config,
      now: 50_000,
      hasStream: true,
      hasRegion: true,
    });
    const second = updateHuntStallCooldownPresenceRuntimeState({
      previous: first.state,
      result: makeCooldownResult(12),
      config,
      now: 51_000,
      hasStream: true,
      hasRegion: true,
    });

    expect(first.shouldAlert).toBe(false);
    expect(first.state.status).toBe("alerted");
    expect(first.state.pendingRecognizedText).toBe("13");
    expect(first.state.pendingRecognizedCount).toBe(1);
    expect(second.shouldAlert).toBe(false);
    expect(second.state.status).toBe("active");
    expect(second.state.alertedAt).toBeNull();
    expect(second.state.alertedRecognizedText).toBeNull();
    expect(second.state.pendingRecognizedText).toBeNull();
    expect(second.state.lastChangedAt).toBe(51_000);
    expect(second.state.unchangedSeconds).toBe(0);
  });

  it("keeps cooldown alerted elapsed time advancing through visual activity", () => {
    const config = makeCooldownPresenceConfig({ cooldownMissingThresholdSeconds: 10 });
    const previous = {
      ...createHuntStallRuntimeState(),
      status: "alerted" as const,
      lastChangedAt: 2_000,
      lastReadableAt: 2_000,
      alertedAt: 12_000,
      recognizedText: "6",
      alertedRecognizedText: "6",
      hasObservedCooldownPresence: true,
      cooldownLastDetectedAt: 2_000,
      cooldownVisualFingerprint: makeCooldownVisualActivity("0").fingerprint,
    };

    const update = updateHuntStallCooldownPresenceRuntimeState({
      previous,
      result: makeCooldownResult(null),
      activity: makeCooldownVisualActivity("f"),
      config,
      now: 16_000,
      hasStream: true,
      hasRegion: true,
    });

    expect(update.shouldAlert).toBe(false);
    expect(update.state.status).toBe("alerted");
    expect(update.state.alertedAt).toBe(12_000);
    expect(update.state.lastChangedAt).toBe(2_000);
    expect(update.state.unchangedSeconds).toBe(14);
  });

  it("re-arms cooldown alerts after repeated visual activity when OCR stays unreadable", () => {
    const config = makeCooldownPresenceConfig({ cooldownMissingThresholdSeconds: 10 });
    const previous = {
      ...createHuntStallRuntimeState(),
      status: "alerted" as const,
      lastChangedAt: 2_000,
      lastReadableAt: 2_000,
      alertedAt: 12_000,
      recognizedText: "1",
      alertedRecognizedText: "1",
      hasObservedCooldownPresence: true,
      cooldownLastDetectedAt: 2_000,
      cooldownVisualFingerprint: makeCooldownVisualActivity("0").fingerprint,
      cooldownConsecutiveVisualActivityCount: 0,
    };

    const first = updateHuntStallCooldownPresenceRuntimeState({
      previous,
      result: makeCooldownResult(null),
      activity: makeCooldownVisualActivity("f"),
      config,
      now: 16_000,
      hasStream: true,
      hasRegion: true,
    });
    const second = updateHuntStallCooldownPresenceRuntimeState({
      previous: first.state,
      result: makeCooldownResult(null),
      activity: makeCooldownVisualActivity("0"),
      config,
      now: 17_000,
      hasStream: true,
      hasRegion: true,
    });

    expect(first.shouldAlert).toBe(false);
    expect(first.state.status).toBe("alerted");
    expect(first.state.alertedAt).toBe(12_000);
    expect(first.state.cooldownConsecutiveVisualActivityCount).toBe(1);
    expect(second.shouldAlert).toBe(false);
    expect(second.state.status).toBe("active");
    expect(second.state.alertedAt).toBeNull();
    expect(second.state.alertedRecognizedText).toBeNull();
    expect(second.state.lastChangedAt).toBe(17_000);
    expect(second.state.unchangedSeconds).toBe(0);
    expect(second.state.cooldownUsedVisualActivity).toBe(true);
  });

  it("does not alert for cooldown mode until a region is selected", () => {
    const update = updateHuntStallCooldownPresenceRuntimeState({
      previous: createHuntStallRuntimeState(),
      result: makeCooldownResult(7),
      config: makeCooldownPresenceConfig(),
      now: 1_000,
      hasStream: true,
      hasRegion: false,
    });

    expect(update.shouldAlert).toBe(false);
    expect(update.state.status).toBe("no-region");
    expect(update.state.lastDecision).toBe("cooldown-no-region");
  });
});
