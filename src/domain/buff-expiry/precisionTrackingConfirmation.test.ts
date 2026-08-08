import { describe, expect, it } from "vitest";
import type {
  BuffExpiryPendingTrack,
  BuffExpiryPrecisionExactObservation,
} from "./precisionTrackingTypes";
import {
  appendBuffExpiryPrecisionPendingObservation,
  confirmBuffExpiryPrecisionPendingTrack,
} from "./precisionTrackingConfirmation";

const START = 100_000;

function createObservation(
  seconds: number,
  elapsedMs: number,
  overrides: Partial<BuffExpiryPrecisionExactObservation> = {},
): BuffExpiryPrecisionExactObservation {
  return {
    group: "unionLuck",
    box: {
      x: 128,
      y: 64,
      width: 32,
      height: 32,
      confidence: 1,
      side: 32,
      row: 2,
      col: 4,
    },
    seconds,
    observedAt: START + elapsedMs,
    score: 0.98,
    margin: 0.2,
    reason: "target_accepted",
    countdownConfidence: 1,
    countdownStatus: "high",
    ...overrides,
  };
}

function appendSequence(
  seconds: number[],
  elapsedMs: number[] = seconds.map((_, index) => index * 1_000),
): BuffExpiryPendingTrack {
  let pendingTrack: BuffExpiryPendingTrack | null = null;
  for (let index = 0; index < seconds.length; index += 1) {
    pendingTrack = appendBuffExpiryPrecisionPendingObservation(
      pendingTrack,
      createObservation(seconds[index]!, elapsedMs[index]!),
    );
  }
  return pendingTrack!;
}

describe("buff expiry precision tracking confirmation", () => {
  it("creates the canonical pending track and weighted observation", () => {
    const pendingTrack = appendBuffExpiryPrecisionPendingObservation(
      null,
      createObservation(30, 0, {
        countdownStatus: "medium",
        countdownConfidence: 0.5,
      }),
      "data:image/webp;base64,icon",
    );

    expect(pendingTrack).toMatchObject({
      id: "next:unionLuck:r2:c4",
      buffId: "next:unionLuck",
      name: "유니온의 행운",
      normalizedIconDataUrl: "data:image/webp;base64,icon",
      firstSeenAt: START,
      lastSeenAt: START,
      score: 0.98,
    });
    expect(pendingTrack.observations).toEqual([
      {
        seconds: 30,
        observedAt: START,
        score: 0.98,
        strength: "strong",
        reason: "target_accepted",
        predictedExpiresAt: START + 30_000,
        weight: 0.36,
      },
    ]);
  });

  it("prunes old observations while preserving an existing icon preview", () => {
    const existing = appendBuffExpiryPrecisionPendingObservation(
      null,
      createObservation(55, -20_001),
      "data:image/webp;base64,existing",
    );
    existing.observations.push({
      seconds: 54,
      observedAt: START - 20_000,
      score: 0.9,
      strength: "strong",
      reason: "boundary",
    });

    const next = appendBuffExpiryPrecisionPendingObservation(existing, createObservation(30, 0));

    expect(next.normalizedIconDataUrl).toBe("data:image/webp;base64,existing");
    expect(next.observations.map((observation) => observation.reason)).toEqual([
      "boundary",
      "target_accepted",
    ]);
  });

  it("requires enough observations across the full confirmation span", () => {
    expect(confirmBuffExpiryPrecisionPendingTrack(appendSequence([30, 29, 28, 27, 26]))).toBeNull();

    const confirmed = confirmBuffExpiryPrecisionPendingTrack(appendSequence([30, 29, 28, 27, 26, 25]));
    expect(confirmed).toMatchObject({
      id: "next:unionLuck:r2:c4",
      detectedSeconds: 25,
      detectedAt: START + 5_000,
      expiresAt: START + 30_000,
      alertedAt: null,
    });
  });

  it("ignores an isolated expiry outlier when the remaining flow is natural", () => {
    const confirmed = confirmBuffExpiryPrecisionPendingTrack(
      appendSequence([30, 29, 28, 20, 26, 25]),
    );

    expect(confirmed).toMatchObject({
      detectedSeconds: 25,
      detectedAt: START + 5_000,
      expiresAt: START + 30_000,
    });
  });

  it("rejects a countdown with an implausible one-frame drop", () => {
    expect(confirmBuffExpiryPrecisionPendingTrack(
      appendSequence([30, 29, 28, 25, 24, 23]),
    )).toBeNull();
  });
});
