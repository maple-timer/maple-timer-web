import { describe, expect, it } from "vitest";
import { createDefaultBoosterExpiryAlert } from "../storage";
import {
  createBoosterExpiryRuntimeState,
  markBoosterExpiryRuntimeAlerted,
  updateBoosterExpiryRuntimeState,
} from "./boosterExpiryRuntime";
import type {
  BoosterExpiryCompactTime,
  BoosterExpiryRuntimeState,
  BoosterExpiryWorkerResult,
} from "./boosterExpiryTypes";

function makeTime(seconds: number, text = String(seconds)): BoosterExpiryCompactTime {
  return {
    ok: true,
    reason: "ok",
    rect: { x: 100, y: 20, width: 120, height: 36 },
    digitCount: text.replace(/\D/g, "").length,
    seconds,
    text,
    format: seconds >= 60 ? "m:ss" : "ss.cc",
    selectedBy: "test",
  };
}

function makeResult({
  seconds,
  rawSeconds = seconds,
  locked,
  source = locked ? "raw-lock" : "raw-pending",
}: {
  seconds: number | null;
  rawSeconds?: number | null;
  locked: boolean;
  source?: string;
}): BoosterExpiryWorkerResult {
  return {
    rawTime: rawSeconds === null ? null : makeTime(rawSeconds),
    time: seconds === null ? null : makeTime(seconds),
    timeRect: {
      ok: seconds !== null || rawSeconds !== null,
      reason: seconds !== null || rawSeconds !== null ? "ok" : "no-timer",
      rect: seconds !== null || rawSeconds !== null ? { x: 100, y: 20, width: 120, height: 36 } : null,
      matchCount: seconds !== null || rawSeconds !== null ? 1 : 0,
      candidateCount: seconds !== null || rawSeconds !== null ? 1 : 0,
    },
    flow: {
      locked,
      source,
      predictedSeconds: seconds,
      rawDeltaSeconds: null,
      timestampMs: 0,
    },
  };
}

function update(
  previous: BoosterExpiryRuntimeState,
  seconds: number | null,
  now: number,
  options: {
    locked?: boolean;
    rawSeconds?: number | null;
    source?: string;
    alertLeadSeconds?: number;
  } = {},
) {
  return updateBoosterExpiryRuntimeState({
    previous,
    result: makeResult({
      seconds,
      rawSeconds: options.rawSeconds,
      locked: options.locked ?? seconds !== null,
      source: options.source,
    }),
    config: {
      ...createDefaultBoosterExpiryAlert(),
      enabled: true,
      alertLeadSeconds: options.alertLeadSeconds ?? 10,
    },
    now,
    hasStream: true,
  });
}

describe("boosterExpiryRuntime", () => {
  it("creates a paused runtime state", () => {
    expect(createBoosterExpiryRuntimeState()).toMatchObject({
      status: "paused",
      lastSampledAt: null,
      remainingSeconds: null,
      estimatedExpiresAt: null,
      alertAt: null,
      alertedAt: null,
      cycleCandidateObservationCount: 0,
      confirmedAt: null,
      confirmedExpiresAt: null,
      locked: false,
      lastDecision: "disabled",
    });
  });

  it("waits for a stable 60+ second timer before arming", () => {
    const pending = update(createBoosterExpiryRuntimeState(), 12, 0);

    expect(pending.shouldAlert).toBe(false);
    expect(pending.state.status).toBe("confirming");
    expect(pending.state.estimatedExpiresAt).toBeNull();
    expect(pending.state.alertAt).toBeNull();
    expect(pending.state.confirmedExpiresAt).toBeNull();
  });

  it("confirms the cycle from 60+ second raw readings and alerts from the fixed expiry after recent support", () => {
    const first = update(createBoosterExpiryRuntimeState(), 100, 0);
    const second = update(first.state, 99, 1_000);
    const third = update(second.state, 98, 2_000);
    const fourth = update(third.state, 97, 3_000);
    const fifth = update(fourth.state, 96, 4_000);
    const confirmed = update(fifth.state, 95, 5_000);

    expect(first.state.status).toBe("confirming");
    expect(second.state.status).toBe("confirming");
    expect(fifth.state.status).toBe("confirming");
    expect(confirmed.shouldAlert).toBe(false);
    expect(confirmed.state.status).toBe("armed");
    expect(confirmed.state.confirmedAt).toBe(5_000);
    expect(confirmed.state.confirmedExpiresAt).toBe(100_000);
    expect(confirmed.state.alertAt).toBe(90_000);

    const supportedNearAlert = update(confirmed.state, 20, 80_000, {
      source: "raw",
    });
    const missedAtAlertTime = update(supportedNearAlert.state, null, 90_000, {
      locked: false,
      rawSeconds: null,
      source: "none",
    });

    expect(missedAtAlertTime.shouldAlert).toBe(true);
    expect(missedAtAlertTime.state.status).toBe("alerted");
    expect(missedAtAlertTime.state.alertedAt).toBe(90_000);
    expect(missedAtAlertTime.state.confirmedExpiresAt).toBe(100_000);

    const afterExpiry = update(missedAtAlertTime.state, null, 101_000, {
      locked: false,
      rawSeconds: null,
      source: "none",
    });

    expect(afterExpiry.shouldAlert).toBe(false);
    expect(afterExpiry.state.status).toBe("waiting");
    expect(afterExpiry.state.alertedAt).toBe(90_000);
    expect(afterExpiry.state.confirmedExpiresAt).toBe(100_000);
  });

  it("does not alert from a timer first seen below 60 seconds", () => {
    let state = createBoosterExpiryRuntimeState();
    state = update(state, 12, 0).state;
    state = update(state, 11, 1_000).state;
    const nearExpiry = update(state, 10, 2_000);

    expect(nearExpiry.shouldAlert).toBe(false);
    expect(nearExpiry.state.status).toBe("confirming");
    expect(nearExpiry.state.confirmedExpiresAt).toBeNull();
    expect(nearExpiry.state.alertAt).toBeNull();
  });

  it("does not confirm from flow-predicted readings without raw OCR support", () => {
    let state = createBoosterExpiryRuntimeState();
    state = update(state, 100, 0, {
      rawSeconds: null,
      source: "predicted-missing-raw",
    }).state;
    state = update(state, 99, 1_000, {
      rawSeconds: null,
      source: "predicted-missing-raw",
    }).state;
    state = update(state, 98, 2_000, {
      rawSeconds: null,
      source: "predicted-missing-raw",
    }).state;
    state = update(state, 97, 3_000, {
      rawSeconds: null,
      source: "predicted-missing-raw",
    }).state;
    state = update(state, 96, 4_000, {
      rawSeconds: null,
      source: "predicted-missing-raw",
    }).state;
    const predicted = update(state, 95, 5_000, {
      rawSeconds: null,
      source: "predicted-missing-raw",
    });

    expect(predicted.shouldAlert).toBe(false);
    expect(predicted.state.status).toBe("confirming");
    expect(predicted.state.confirmedExpiresAt).toBeNull();
    expect(predicted.state.cycleCandidateObservationCount).toBe(0);
  });

  it("uses relocked raw readings as confirmation evidence after stale flow recovery", () => {
    let state = createBoosterExpiryRuntimeState();
    state = update(state, 96.67, 11_000, {
      rawSeconds: 96.67,
      source: "raw-relock",
    }).state;
    state = update(state, 95.65, 12_000, {
      rawSeconds: 95.65,
      source: "raw",
    }).state;
    state = update(state, 94.66, 13_000, {
      rawSeconds: 94.66,
      source: "raw",
    }).state;
    state = update(state, 93.66, 14_000, {
      rawSeconds: 93.66,
      source: "raw",
    }).state;
    state = update(state, 92.66, 15_000, {
      rawSeconds: 92.66,
      source: "raw",
    }).state;
    const confirmed = update(state, 91.66, 16_000, {
      rawSeconds: 91.66,
      source: "raw",
    });

    expect(confirmed.shouldAlert).toBe(false);
    expect(confirmed.state.status).toBe("armed");
    expect(confirmed.state.confirmedExpiresAt).toBeGreaterThan(107_000);
    expect(confirmed.state.confirmedExpiresAt).toBeLessThan(109_000);
    expect(confirmed.state.alertAt).toBeGreaterThan(97_000);
    expect(confirmed.state.alertAt).toBeLessThan(99_000);
  });

  it("does not confirm from a static false reading that does not count down", () => {
    let state = createBoosterExpiryRuntimeState();
    for (let index = 0; index < 8; index += 1) {
      state = update(state, 88.3, index * 1_000, {
        source: "raw",
      }).state;
    }

    expect(state.status).toBe("confirming");
    expect(state.confirmedExpiresAt).toBeNull();
    expect(state.cycleCandidateLastRemainingSeconds).toBe(88.3);
  });

  it("keeps the fixed alert schedule through short misses before the alert time", () => {
    const first = update(createBoosterExpiryRuntimeState(), 70, 0);
    const second = update(first.state, 69, 1_000);
    const third = update(second.state, 68, 2_000);
    const fourth = update(third.state, 67, 3_000);
    const fifth = update(fourth.state, 66, 4_000);
    const confirmed = update(fifth.state, 65, 5_000);
    const missed = update(confirmed.state, null, 5_000, {
      locked: false,
      rawSeconds: null,
      source: "none",
    });

    expect(missed.shouldAlert).toBe(false);
    expect(missed.state.status).toBe("armed");
    expect(missed.state.alertAt).toBe(60_000);
    expect(missed.state.confirmedExpiresAt).toBe(70_000);
  });

  it("cancels an armed schedule after raw support is missing for too long", () => {
    const first = update(createBoosterExpiryRuntimeState(), 100, 0);
    const second = update(first.state, 99, 1_000);
    const third = update(second.state, 98, 2_000);
    const fourth = update(third.state, 97, 3_000);
    const fifth = update(fourth.state, 96, 4_000);
    const confirmed = update(fifth.state, 95, 5_000);
    const lost = update(confirmed.state, null, 26_000, {
      locked: false,
      rawSeconds: null,
      source: "none",
    });

    expect(confirmed.state.status).toBe("armed");
    expect(lost.shouldAlert).toBe(false);
    expect(lost.state.status).toBe("lost");
    expect(lost.state.alertAt).toBeNull();
    expect(lost.state.confirmedExpiresAt).toBeNull();
    expect(lost.state.lastDecision).toBe("schedule-cancelled");
  });

  it("cancels an armed schedule after repeated contradictory raw readings", () => {
    const first = update(createBoosterExpiryRuntimeState(), 100, 0);
    const second = update(first.state, 99, 1_000);
    const third = update(second.state, 98, 2_000);
    const fourth = update(third.state, 97, 3_000);
    const fifth = update(fourth.state, 96, 4_000);
    const confirmed = update(fifth.state, 95, 5_000);
    const contradictionOne = update(confirmed.state, 120, 10_000, {
      source: "raw",
    });
    const contradictionTwo = update(contradictionOne.state, 119, 11_000, {
      source: "raw",
    });

    expect(contradictionOne.state.status).toBe("armed");
    expect(contradictionOne.state.confirmedContradictionCount).toBe(1);
    expect(contradictionTwo.state.status).toBe("lost");
    expect(contradictionTwo.state.confirmedExpiresAt).toBeNull();
  });

  it("marks a scheduled alert without waiting for another OCR sample", () => {
    const first = update(createBoosterExpiryRuntimeState(), 70, 0);
    const second = update(first.state, 69, 1_000);
    const third = update(second.state, 68, 2_000);
    const fourth = update(third.state, 67, 3_000);
    const fifth = update(fourth.state, 66, 4_000);
    const confirmed = update(fifth.state, 65, 5_000);
    const alerted = markBoosterExpiryRuntimeAlerted(confirmed.state, 60_000);

    expect(alerted.status).toBe("alerted");
    expect(alerted.alertedAt).toBe(60_000);
    expect(alerted.lastDecision).toBe("alerted");
    expect(alerted.confirmedExpiresAt).toBe(70_000);
  });

  it("rearms only after a later 60+ second timer is stable", () => {
    const first = update(createBoosterExpiryRuntimeState(), 70, 0);
    const second = update(first.state, 69, 1_000);
    const third = update(second.state, 68, 2_000);
    const fourth = update(third.state, 67, 3_000);
    const fifth = update(fourth.state, 66, 4_000);
    const confirmed = update(fifth.state, 65, 5_000);
    const supported = update(confirmed.state, 20, 50_000, {
      source: "raw",
    });
    const alerted = update(supported.state, null, 60_000, {
      locked: false,
      rawSeconds: null,
      source: "none",
    });

    const newPendingOne = update(alerted.state, 100, 65_000);
    const newPendingTwo = update(newPendingOne.state, 99, 66_000);
    const newPendingThree = update(newPendingTwo.state, 98, 67_000);
    const newPendingFour = update(newPendingThree.state, 97, 68_000);
    const newPendingFive = update(newPendingFour.state, 96, 69_000);
    const rearmed = update(newPendingFive.state, 95, 70_000);
    const secondSupported = update(rearmed.state, 20, 145_000, {
      source: "raw",
    });
    const secondAlert = update(secondSupported.state, null, 155_000, {
      locked: false,
      rawSeconds: null,
      source: "none",
    });

    expect(alerted.shouldAlert).toBe(true);
    expect(newPendingOne.shouldAlert).toBe(false);
    expect(newPendingOne.state.alertedAt).toBe(60_000);
    expect(newPendingTwo.state.alertedAt).toBe(60_000);
    expect(newPendingFive.state.alertedAt).toBe(60_000);
    expect(rearmed.shouldAlert).toBe(false);
    expect(rearmed.state.status).toBe("armed");
    expect(rearmed.state.alertedAt).toBeNull();
    expect(rearmed.state.confirmedExpiresAt).toBe(165_000);
    expect(secondAlert.shouldAlert).toBe(true);
    expect(secondAlert.state.alertedAt).toBe(155_000);
  });
});
