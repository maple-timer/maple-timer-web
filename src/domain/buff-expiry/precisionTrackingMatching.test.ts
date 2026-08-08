import { describe, expect, it } from "vitest";
import type {
  BuffExpiryBox,
  BuffExpiryPendingTrack,
  BuffExpiryPrecisionExactObservation,
  BuffExpiryTrackedBuff,
} from "./precisionTrackingTypes";
import {
  findMatchingBuffExpiryPrecisionTrack,
  hasActiveConflictingBuffExpiryPrecisionTrack,
  isBuffExpiryPrecisionNearbyBox,
  pruneBuffExpiryPrecisionPendingTracks,
  pruneBuffExpiryPrecisionTracks,
} from "./precisionTrackingMatching";

const NOW = 100_000;

function createBox(overrides: Partial<BuffExpiryBox> = {}): BuffExpiryBox {
  return {
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    confidence: 1,
    side: 32,
    row: 2,
    col: 4,
    ...overrides,
  };
}

function createTrack(overrides: Partial<BuffExpiryTrackedBuff> = {}): BuffExpiryTrackedBuff {
  return {
    id: "track",
    buffId: "next:unionLuck",
    name: "유니온의 행운",
    box: createBox(),
    detectedSeconds: 30,
    detectedAt: NOW,
    expiresAt: NOW + 30_000,
    lastSeenAt: NOW,
    alertedAt: null,
    score: 1,
    ...overrides,
  };
}

function createObservation(
  overrides: Partial<BuffExpiryPrecisionExactObservation> = {},
): BuffExpiryPrecisionExactObservation {
  return {
    group: "unionLuck",
    box: createBox(),
    seconds: 30,
    observedAt: NOW,
    score: 1,
    margin: 1,
    reason: "target_accepted",
    countdownConfidence: 1,
    countdownStatus: "high",
    ...overrides,
  };
}

function createPendingTrack(overrides: Partial<BuffExpiryPendingTrack> = {}): BuffExpiryPendingTrack {
  return {
    id: "pending",
    buffId: "next:unionLuck",
    name: "유니온의 행운",
    box: createBox(),
    firstSeenAt: NOW - 20_000,
    lastSeenAt: NOW,
    observations: [
      {
        seconds: 30,
        observedAt: NOW,
        score: 1,
        strength: "strong",
        reason: "target_accepted",
      },
    ],
    score: 1,
    ...overrides,
  };
}

describe("buff expiry precision tracking matching", () => {
  it("keeps confirmed tracks only through their alert-specific expiry grace", () => {
    const tracks = [
      createTrack({ id: "active", expiresAt: NOW }),
      createTrack({ id: "unalerted-boundary", expiresAt: NOW - 10_000 }),
      createTrack({ id: "unalerted-expired", expiresAt: NOW - 10_001 }),
      createTrack({ id: "alerted-boundary", expiresAt: NOW - 15_000, alertedAt: NOW - 16_000 }),
      createTrack({ id: "alerted-expired", expiresAt: NOW - 15_001, alertedAt: NOW - 16_000 }),
    ];

    expect(pruneBuffExpiryPrecisionTracks(tracks, NOW).map((track) => track.id)).toEqual([
      "active",
      "unalerted-boundary",
      "alerted-boundary",
    ]);
  });

  it("prunes stale pending observations and removes empty pending tracks", () => {
    const result = pruneBuffExpiryPrecisionPendingTracks([
      createPendingTrack({
        id: "mixed",
        observations: [
          { seconds: 31, observedAt: NOW - 20_001, score: 1, strength: "strong", reason: "old" },
          { seconds: 30, observedAt: NOW - 20_000, score: 1, strength: "strong", reason: "boundary" },
        ],
      }),
      createPendingTrack({
        id: "stale",
        observations: [
          { seconds: 31, observedAt: NOW - 20_001, score: 1, strength: "strong", reason: "old" },
        ],
      }),
    ], NOW);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("mixed");
    expect(result[0].observations.map((observation) => observation.reason)).toEqual(["boundary"]);
  });

  it("matches the nearest compatible track and honors exclusions", () => {
    const tracks = [
      createTrack({ id: "left", box: createBox({ x: 0, col: 4 }) }),
      createTrack({ id: "right", box: createBox({ x: 40, col: 5 }) }),
      createTrack({ id: "wrong-group", buffId: "next:potion", box: createBox({ x: 42, col: 5 }) }),
      createTrack({ id: "drifted", box: createBox({ x: 41, col: 5 }), expiresAt: NOW + 34_001 }),
    ];
    const observation = createObservation({ box: createBox({ x: 36, col: 5 }) });

    expect(findMatchingBuffExpiryPrecisionTrack(tracks, observation)?.id).toBe("right");
    expect(findMatchingBuffExpiryPrecisionTrack(tracks, observation, new Set(["right"]))?.id).toBe("left");
  });

  it("applies single-slot and potion multi-slot conflict limits", () => {
    const unionTrack = createTrack();
    expect(hasActiveConflictingBuffExpiryPrecisionTrack(
      [unionTrack],
      createObservation({ box: createBox({ x: 500, row: 9, col: 9 }) }),
      NOW,
    )).toBe(true);

    const potionObservation = createObservation({ group: "potion" });
    const potionTracks = [
      createTrack({ id: "potion-1", buffId: "next:potion" }),
      createTrack({ id: "potion-2", buffId: "next:potion", box: createBox({ x: 64, col: 6 }) }),
    ];
    expect(hasActiveConflictingBuffExpiryPrecisionTrack(potionTracks.slice(0, 1), potionObservation, NOW)).toBe(false);
    expect(hasActiveConflictingBuffExpiryPrecisionTrack(potionTracks, potionObservation, NOW)).toBe(true);
  });

  it("treats adjacent columns on the same row or nearby centers as the same slot", () => {
    expect(isBuffExpiryPrecisionNearbyBox(
      createBox({ x: 0, row: 2, col: 4 }),
      createBox({ x: 500, row: 2, col: 5 }),
    )).toBe(true);
    expect(isBuffExpiryPrecisionNearbyBox(
      createBox({ x: 0, row: 2, col: 4 }),
      createBox({ x: 40, row: 3, col: 9 }),
    )).toBe(true);
    expect(isBuffExpiryPrecisionNearbyBox(
      createBox({ x: 0, row: 2, col: 4 }),
      createBox({ x: 200, row: 3, col: 9 }),
    )).toBe(false);
  });
});
