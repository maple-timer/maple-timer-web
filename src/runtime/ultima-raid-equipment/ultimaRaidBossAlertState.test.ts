import { describe, expect, it } from "vitest";
import type { UltimaRaidBossDetection } from "../../recognition/ultima-raid-equipment/bossEncounterDetector";
import {
  createUltimaRaidBossRuntimeState,
  releaseUltimaRaidBossAlertAfterPlaybackFailure,
  updateUltimaRaidBossRuntimeState,
} from "./ultimaRaidBossAlertState";

describe("ultimaRaidBossAlertState", () => {
  it("arms from a normal progress frame and alerts after two boss signals", () => {
    const armed = update(createUltimaRaidBossRuntimeState(), normal, 1_000);
    const first = update(armed.state, boss, 2_000);
    const second = update(first.state, boss, 3_000);

    expect(armed.state.armed).toBe(true);
    expect(first.state.status).toBe("candidate");
    expect(first.shouldAlert).toBe(false);
    expect(second.state.status).toBe("active");
    expect(second.shouldAlert).toBe(true);
  });

  it("tolerates one unreadable frame while confirming the encounter", () => {
    const armed = update(createUltimaRaidBossRuntimeState(), normal, 1_000);
    const first = update(armed.state, boss, 2_000);
    const gap = update(first.state, unreadable, 3_000);
    const second = update(gap.state, boss, 4_000);

    expect(gap.state.status).toBe("candidate");
    expect(second.shouldAlert).toBe(true);
  });

  it("announces a confirmed boss that is already visible when detection starts", () => {
    const first = update(createUltimaRaidBossRuntimeState(), boss, 1_000);
    const second = update(first.state, boss, 2_000);
    const third = update(second.state, boss, 3_000);

    expect(first.state.status).toBe("candidate");
    expect(first.state.encounterActive).toBe(false);
    expect(first.state.armed).toBe(false);
    expect(first.shouldAlert).toBe(false);
    expect(second.state.encounterActive).toBe(true);
    expect(second.state.armed).toBe(true);
    expect(second.shouldAlert).toBe(true);
    expect(third.shouldAlert).toBe(false);
  });

  it("rearms only after three confirmed normal frames", () => {
    const armed = update(createUltimaRaidBossRuntimeState(), normal, 1_000);
    const first = update(armed.state, boss, 2_000);
    const alerted = update(first.state, boss, 3_000);
    const normal1 = update(alerted.state, normal, 4_000);
    const unreadableGap = update(normal1.state, unreadable, 5_000);
    const normal2 = update(unreadableGap.state, normal, 6_000);
    const normal3 = update(normal2.state, normal, 7_000);
    const normal4 = update(normal3.state, normal, 8_000);
    const nextFirst = update(normal4.state, boss, 9_000);
    const nextSecond = update(nextFirst.state, boss, 10_000);

    expect(normal1.state.encounterActive).toBe(true);
    expect(unreadableGap.state.encounterActive).toBe(true);
    expect(normal3.state.encounterActive).toBe(true);
    expect(normal4.state.encounterActive).toBe(false);
    expect(nextSecond.shouldAlert).toBe(true);
  });

  it("does not rearm from unreadable frames during a boss encounter", () => {
    const armed = update(createUltimaRaidBossRuntimeState(), normal, 1_000);
    const first = update(armed.state, boss, 2_000);
    const alerted = update(first.state, boss, 3_000);
    const gap1 = update(alerted.state, unreadable, 4_000);
    const gap2 = update(gap1.state, unreadable, 5_000);
    const gap3 = update(gap2.state, unreadable, 6_000);
    const bossAgain = update(gap3.state, boss, 7_000);

    expect(gap3.state.encounterActive).toBe(true);
    expect(bossAgain.shouldAlert).toBe(false);
  });

  it("releases the encounter lock after playback failure so the alert can retry", () => {
    const armed = update(createUltimaRaidBossRuntimeState(), normal, 1_000);
    const first = update(armed.state, boss, 2_000);
    const alerted = update(first.state, boss, 3_000);
    const released = releaseUltimaRaidBossAlertAfterPlaybackFailure(
      alerted.state,
      3_000,
      "autoplay-blocked",
    );
    const retryFirst = update(released, boss, 4_000);
    const retrySecond = update(retryFirst.state, boss, 5_000);

    expect(released.encounterActive).toBe(false);
    expect(retrySecond.shouldAlert).toBe(true);
  });

  it("reports invalid and inactive states without alerting", () => {
    const initial = createUltimaRaidBossRuntimeState();
    const invalid = update(initial, { ...normal, layoutValid: false }, 1_000);
    const paused = updateUltimaRaidBossRuntimeState({
      previous: initial,
      detection: null,
      now: 1_000,
      enabled: false,
      hasStream: true,
      hasRegion: true,
    });

    expect(invalid.state.status).toBe("invalid-region");
    expect(invalid.shouldAlert).toBe(false);
    expect(paused.state.status).toBe("paused");
  });
});

const boss: UltimaRaidBossDetection = {
  layoutValid: true,
  progressState: "boss",
  bossBarDetected: true,
  normalBarDetected: false,
  bossBarPixelCount: 1_100,
  bossBarWidthRatio: 0.31,
  bossBarHeightRatio: 0.065,
  bossBarFillRatio: 0.86,
  normalBarPixelCount: 0,
  normalBarWidthRatio: 0,
  detectorVersion: "ultima-raid-boss-progress-v1",
};

const normal: UltimaRaidBossDetection = {
  ...boss,
  progressState: "normal",
  bossBarDetected: false,
  bossBarPixelCount: 0,
  bossBarWidthRatio: 0,
  bossBarHeightRatio: 0,
  bossBarFillRatio: 0,
  normalBarDetected: true,
  normalBarPixelCount: 1_000,
  normalBarWidthRatio: 0.28,
};

const unreadable: UltimaRaidBossDetection = {
  ...normal,
  progressState: "unreadable",
  normalBarDetected: false,
  normalBarPixelCount: 0,
  normalBarWidthRatio: 0,
};

function update(
  previous: ReturnType<typeof createUltimaRaidBossRuntimeState>,
  detection: UltimaRaidBossDetection,
  now: number,
) {
  return updateUltimaRaidBossRuntimeState({
    previous,
    detection,
    now,
    enabled: true,
    hasStream: true,
    hasRegion: true,
  });
}
