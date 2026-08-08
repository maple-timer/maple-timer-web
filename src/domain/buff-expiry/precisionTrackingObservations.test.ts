import { describe, expect, it } from "vitest";
import type { BuffExpiryPrecisionExactObservation } from "./precisionTrackingTypes";
import {
  getBuffExpiryPrecisionObservationWeight,
  getDerivedRemainingSeconds,
  getPredictedExpiresAt,
  isBuffExpiryPrecisionConfirmationSecond,
} from "./precisionTrackingObservations";

function createObservation(
  overrides: Partial<BuffExpiryPrecisionExactObservation> = {},
): BuffExpiryPrecisionExactObservation {
  return {
    group: "unionLuck",
    box: { x: 0, y: 0, width: 32, height: 32, confidence: 1 },
    seconds: 30,
    observedAt: 100_000,
    score: 1,
    margin: 1,
    reason: "target_accepted",
    countdownConfidence: 1,
    countdownStatus: "high",
    ...overrides,
  };
}

describe("buff expiry precision tracking observations", () => {
  it("keeps the inclusive confirmation range", () => {
    expect([
      isBuffExpiryPrecisionConfirmationSecond(20),
      isBuffExpiryPrecisionConfirmationSecond(21),
      isBuffExpiryPrecisionConfirmationSecond(59),
      isBuffExpiryPrecisionConfirmationSecond(60),
    ]).toEqual([false, true, true, false]);
  });

  it("derives expiry and remaining seconds without going below zero", () => {
    const observation = createObservation({ seconds: 31, observedAt: 5_500 });
    expect(getPredictedExpiresAt(observation)).toBe(36_500);
    expect(getDerivedRemainingSeconds(36_500, 5_500)).toBe(31);
    expect(getDerivedRemainingSeconds(5_000, 5_500)).toBe(0);
  });

  it("keeps the countdown-status and clamped-confidence weights", () => {
    expect(getBuffExpiryPrecisionObservationWeight(createObservation())).toBe(1);
    expect(getBuffExpiryPrecisionObservationWeight(createObservation({
      countdownStatus: "medium",
      countdownConfidence: 0.5,
    }))).toBe(0.36);
    expect(getBuffExpiryPrecisionObservationWeight(createObservation({
      countdownStatus: "low",
      countdownConfidence: 0.1,
    }))).toBe(0.252);
  });
});
