import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGeneralTimer,
  formatGeneralTimerTime,
  getGeneralTimerDurationSeconds,
  getGeneralTimerNextAutoRestartRange,
  getGeneralTimerRemainingSeconds,
  getGeneralTimerStatus,
  normalizeGeneralTimers,
} from "./generalTimers";

describe("generalTimers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses preset durations", () => {
    expect(getGeneralTimerDurationSeconds(createGeneralTimer({ presetId: "30m" }))).toBe(1800);
    expect(getGeneralTimerDurationSeconds(createGeneralTimer({ presetId: "20m" }))).toBe(1200);
    expect(getGeneralTimerDurationSeconds(createGeneralTimer({ presetId: "10m" }))).toBe(600);
    expect(getGeneralTimerDurationSeconds(createGeneralTimer({ presetId: "2h" }))).toBe(7200);
  });

  it("uses custom duration only for the custom preset", () => {
    expect(
      getGeneralTimerDurationSeconds(
        createGeneralTimer({ presetId: "custom", customDurationSeconds: 95 }),
      ),
    ).toBe(95);
    expect(
      getGeneralTimerDurationSeconds(
        createGeneralTimer({ presetId: "30m", customDurationSeconds: 95 }),
      ),
    ).toBe(1800);
  });

  it("normalizes timer names to eight trimmed characters", () => {
    expect(createGeneralTimer({ name: "  재획 물욕템  " }).name).toBe("재획 물욕템");
    expect(createGeneralTimer({ name: "가나다라마바사아자차" }).name).toBe("가나다라마바사아");
    expect(createGeneralTimer({ name: "   " }).name).toBeUndefined();
    expect(createGeneralTimer({ name: 12 as unknown as string }).name).toBeUndefined();
    expect(createGeneralTimer({}).name).toBeUndefined();
  });

  it("keeps persisted timer names through list normalization", () => {
    const [named, unnamed] = normalizeGeneralTimers([
      { presetId: "30m", name: "도핑" },
      { presetId: "20m" },
    ]);

    expect(named.name).toBe("도핑");
    expect(unnamed.name).toBeUndefined();
  });

  it("derives remaining seconds and status from persisted end time", () => {
    const timer = createGeneralTimer({
      presetId: "10m",
      startedAt: 1_000,
      endsAt: 11_000,
    });

    expect(getGeneralTimerRemainingSeconds(timer, 5_000)).toBe(6);
    expect(getGeneralTimerStatus(timer, 5_000)).toBe("running");
    expect(getGeneralTimerStatus(timer, 12_000)).toBe("done");
  });

  it("keeps automatic restart cadence anchored to the scheduled end time", () => {
    const timer = createGeneralTimer({
      presetId: "custom",
      customDurationSeconds: 180,
      startedAt: 0,
      endsAt: 180_000,
    });

    expect(getGeneralTimerNextAutoRestartRange(timer, 180_500)).toEqual({
      startedAt: 180_000,
      endsAt: 360_000,
    });
  });

  it("skips missed automatic restart cycles without drifting from the cadence", () => {
    const timer = createGeneralTimer({
      presetId: "custom",
      customDurationSeconds: 180,
      startedAt: 0,
      endsAt: 180_000,
    });

    expect(getGeneralTimerNextAutoRestartRange(timer, 540_500)).toEqual({
      startedAt: 540_000,
      endsAt: 720_000,
    });
  });

  it("normalizes missing lists to a default 30 minute timer", () => {
    const timers = normalizeGeneralTimers(undefined);

    expect(timers).toHaveLength(1);
    expect(timers[0].presetId).toBe("30m");
    expect(timers[0].autoRestartEnabled).toBe(false);
    expect(getGeneralTimerDurationSeconds(timers[0])).toBe(1800);
  });

  it("pauses persisted running timers on load", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const [loadedTimer] = normalizeGeneralTimers([
      {
        id: "timer-running",
        presetId: "custom",
        customDurationSeconds: 120,
        enabled: true,
        startedAt: 1_000,
        endsAt: 70_000,
        remainingSecondsAtPause: null,
        alertedAt: null,
      },
    ]);

    expect(loadedTimer).toMatchObject({
      id: "timer-running",
      endsAt: null,
      remainingSecondsAtPause: 60,
    });
    expect(getGeneralTimerStatus(loadedTimer, 10_000)).toBe("paused");
  });

  it("normalizes auto restart settings", () => {
    expect(createGeneralTimer({ autoRestartEnabled: true })).toMatchObject({
      autoRestartEnabled: true,
    });
    expect(createGeneralTimer({ autoRestartEnabled: "true" as never })).toMatchObject({
      autoRestartEnabled: false,
    });
  });

  it("keeps an explicit empty timer list empty", () => {
    expect(normalizeGeneralTimers([])).toEqual([]);
  });

  it("formats mm:ss and h:mm:ss values", () => {
    expect(formatGeneralTimerTime(65)).toBe("01:05");
    expect(formatGeneralTimerTime(7205)).toBe("2:00:05");
  });
});
