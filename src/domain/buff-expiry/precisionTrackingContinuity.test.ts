import { describe, expect, it } from "vitest";
import type {
  BuffExpiryBox,
  BuffExpiryPrecisionContinuityCandidate,
  BuffExpiryTrackedBuff,
} from "./precisionTrackingTypes";
import { applyBuffExpiryPrecisionContinuityAssist } from "./precisionTrackingContinuity";

const NOW = 100_000;

function createBox(overrides: Partial<BuffExpiryBox> = {}): BuffExpiryBox {
  return {
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    confidence: 1,
    side: 32,
    row: 1,
    col: 2,
    ...overrides,
  };
}

function createTrack(overrides: Partial<BuffExpiryTrackedBuff> = {}): BuffExpiryTrackedBuff {
  return {
    id: "track",
    buffId: "next:unionLuck",
    name: "unionLuck",
    box: createBox(),
    detectedSeconds: 30,
    detectedAt: NOW - 1_000,
    expiresAt: NOW + 30_000,
    lastSeenAt: NOW - 1_000,
    alertedAt: null,
    score: 1,
    ...overrides,
  };
}

function createCandidate(
  overrides: Partial<BuffExpiryPrecisionContinuityCandidate> = {},
): BuffExpiryPrecisionContinuityCandidate {
  return {
    group: "unionLuck",
    box: createBox({ x: 4 }),
    accepted: true,
    seconds: 30,
    score: 2,
    margin: 0.5,
    gateMargin: 0.4,
    ...overrides,
  };
}

describe("buff expiry precision tracking continuity", () => {
  it("refreshes a compatible track from an accepted continuity candidate", () => {
    const result = applyBuffExpiryPrecisionContinuityAssist(
      [createTrack()],
      [createCandidate()],
      NOW,
    );

    expect(result[0]).toMatchObject({
      box: createBox({ x: 4 }),
      detectedSeconds: 30,
      detectedAt: NOW,
      lastSeenAt: NOW,
      score: 2,
    });
  });

  it("ignores rejected, missing-countdown, and expiry-drifted candidates", () => {
    const track = createTrack();
    const result = applyBuffExpiryPrecisionContinuityAssist(
      [track],
      [
        createCandidate({ accepted: false }),
        createCandidate({ seconds: null }),
        createCandidate({ seconds: 34 }),
      ],
      NOW,
    );

    expect(result[0]).toBe(track);
  });

  it("selects the strongest gate margin before the matcher margin", () => {
    const result = applyBuffExpiryPrecisionContinuityAssist(
      [createTrack()],
      [
        createCandidate({ box: createBox({ x: 1 }), gateMargin: 0.2, margin: 5, score: 2 }),
        createCandidate({ box: createBox({ x: 2 }), gateMargin: 0.3, margin: 1, score: 3 }),
      ],
      NOW,
    );

    expect(result[0].box.x).toBe(2);
    expect(result[0].score).toBe(3);
  });

  it("does not refresh a still-active alerted track", () => {
    const track = createTrack({ alertedAt: NOW - 1_000 });
    const result = applyBuffExpiryPrecisionContinuityAssist(
      [track],
      [createCandidate()],
      NOW,
    );

    expect(result[0]).toBe(track);
  });
});
