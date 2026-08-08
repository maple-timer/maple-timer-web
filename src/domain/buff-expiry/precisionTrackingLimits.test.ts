import { describe, expect, it } from "vitest";
import type {
  BuffExpiryPendingTrack,
  BuffExpiryTrackedBuff,
} from "./precisionTrackingTypes";
import {
  capBuffExpiryPrecisionPendingTracks,
  capBuffExpiryPrecisionTracks,
} from "./precisionTrackingLimits";

const NOW = 100_000;

function createTrack(
  id: string,
  buffId: string,
  lastSeenAt: number,
  overrides: Partial<BuffExpiryTrackedBuff> = {},
): BuffExpiryTrackedBuff {
  return {
    id,
    buffId,
    name: buffId,
    box: { x: 0, y: 0, width: 32, height: 32, confidence: 1 },
    detectedSeconds: 30,
    detectedAt: lastSeenAt,
    expiresAt: NOW + 30_000,
    lastSeenAt,
    alertedAt: null,
    score: 1,
    ...overrides,
  };
}

function createPendingTrack(
  id: string,
  buffId: string,
  lastSeenAt: number,
): BuffExpiryPendingTrack {
  return {
    id,
    buffId,
    name: buffId,
    box: { x: 0, y: 0, width: 32, height: 32, confidence: 1 },
    firstSeenAt: lastSeenAt - 1_000,
    lastSeenAt,
    observations: [],
    score: 1,
  };
}

describe("buff expiry precision tracking limits", () => {
  it("keeps an active alerted single-slot track ahead of a newer track", () => {
    const result = capBuffExpiryPrecisionTracks([
      createTrack("alerted", "next:unionLuck", NOW - 10_000, { alertedAt: NOW - 9_000 }),
      createTrack("newer", "next:unionLuck", NOW),
    ], NOW);

    expect(result.map((track) => track.id)).toEqual(["alerted"]);
  });

  it("keeps the two newest potion tracks in chronological order", () => {
    const result = capBuffExpiryPrecisionTracks([
      createTrack("old", "next:potion", NOW - 2_000),
      createTrack("middle", "next:potion", NOW - 1_000),
      createTrack("new", "next:potion", NOW),
    ], NOW);

    expect(result.map((track) => track.id)).toEqual(["middle", "new"]);
  });

  it("caps pending tracks by group and leaves unknown identifiers intact", () => {
    const result = capBuffExpiryPrecisionPendingTracks([
      createPendingTrack("old", "next:expCoupon", NOW - 1_000),
      createPendingTrack("new", "next:expCoupon", NOW),
      createPendingTrack("unknown-old", "legacy:a", NOW - 2_000),
      createPendingTrack("unknown-new", "legacy:b", NOW + 1_000),
    ]);

    expect(result.map((track) => track.id)).toEqual([
      "unknown-old",
      "new",
      "unknown-new",
    ]);
  });
});
