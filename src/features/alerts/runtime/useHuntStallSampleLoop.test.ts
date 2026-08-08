import { describe, expect, it } from "vitest";
import { createHuntStallRuntimeState } from "../../../lib/huntStallRuntimeState";
import { preserveConcurrentHuntStallPlayback } from "./useHuntStallSampleLoop";

describe("preserveConcurrentHuntStallPlayback", () => {
  it("keeps a playback completion that arrived while the next frame was processing", () => {
    const current = {
      ...createHuntStallRuntimeState(),
      status: "alerted" as const,
      alertedAt: 10_000,
      lastAlertedAt: 11_000,
      lastRepeatedAlertAt: 11_000,
      lastAlertPlayback: {
        status: "finished" as const,
        cycleId: "10000",
        soundId: "test-sound",
        requestedAt: 10_000,
        startedAt: 10_000,
        finishedAt: 11_000,
        failedAt: null,
        error: null,
      },
    };
    const staleFrame = {
      ...current,
      lastAlertedAt: null,
      lastRepeatedAlertAt: null,
      lastAlertPlayback: {
        ...current.lastAlertPlayback,
        status: "requested" as const,
        finishedAt: null,
      },
    };

    expect(preserveConcurrentHuntStallPlayback(current, staleFrame)).toMatchObject({
      lastAlertedAt: 11_000,
      lastRepeatedAlertAt: 11_000,
      lastAlertPlayback: {
        status: "finished",
        finishedAt: 11_000,
      },
    });
  });

  it("does not carry playback evidence into a different alert cycle", () => {
    const current = {
      ...createHuntStallRuntimeState(),
      status: "alerted" as const,
      alertedAt: 10_000,
      lastAlertPlayback: {
        status: "finished" as const,
        cycleId: "10000",
        soundId: "test-sound",
        requestedAt: 10_000,
        startedAt: 10_000,
        finishedAt: 11_000,
        failedAt: null,
        error: null,
      },
    };
    const nextCycle = {
      ...createHuntStallRuntimeState(),
      status: "alerted" as const,
      alertedAt: 20_000,
    };

    expect(preserveConcurrentHuntStallPlayback(current, nextCycle)).toBe(nextCycle);
  });

  it("does not restore the previous repeat reference for a newly requested repeat", () => {
    const current = {
      ...createHuntStallRuntimeState(),
      status: "alerted" as const,
      alertedAt: 10_000,
      lastAlertedAt: 11_000,
      lastRepeatedAlertAt: 11_000,
      repeatedAlertCount: 0,
      lastAlertPlayback: {
        status: "finished" as const,
        cycleId: "10000",
        soundId: "test-sound",
        requestedAt: 10_000,
        startedAt: 10_000,
        finishedAt: 11_000,
        failedAt: null,
        error: null,
      },
    };
    const repeatRequested = {
      ...current,
      lastAlertedAt: 16_000,
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 1,
    };

    expect(preserveConcurrentHuntStallPlayback(current, repeatRequested)).toMatchObject({
      lastAlertedAt: 16_000,
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 1,
    });
  });
});
