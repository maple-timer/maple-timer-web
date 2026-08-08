import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  BuffExpiryBox,
  BuffExpiryExpiryCluster,
  BuffExpiryPendingTrack,
  BuffExpiryTemporalCandidateTrack,
  BuffExpiryTrackedBuff,
} from "./precisionTrackingTypes";

const box = {
  x: 12,
  y: 34,
  width: 40,
  height: 40,
  confidence: 0.98,
  side: 40,
  row: 2,
  col: 3,
} satisfies BuffExpiryBox;

describe("buff expiry precision tracking types", () => {
  it("keeps the pending and confirmed track data contract", () => {
    const pendingTrack = {
      id: "pending:potion:2:3",
      buffId: "next:potion",
      name: "비약",
      box,
      normalizedIconDataUrl: null,
      firstSeenAt: 1_000,
      lastSeenAt: 5_000,
      observations: [
        {
          seconds: 55,
          observedAt: 1_000,
          score: 0.99,
          strength: "strong",
          reason: "target_accepted",
          predictedExpiresAt: 56_000,
          weight: 1,
        },
      ],
      score: 0.99,
    } satisfies BuffExpiryPendingTrack;
    const trackedBuff = {
      id: "track:potion:2:3",
      buffId: "next:potion",
      name: "비약",
      box,
      normalizedIconDataUrl: null,
      detectedSeconds: 55,
      detectedAt: 1_000,
      expiresAt: 56_000,
      lastSeenAt: 5_000,
      alertedAt: null,
      score: 0.99,
    } satisfies BuffExpiryTrackedBuff;

    expect(pendingTrack.observations[0]).toMatchObject({
      seconds: 55,
      strength: "strong",
      predictedExpiresAt: 56_000,
    });
    expect(trackedBuff).toMatchObject({
      buffId: "next:potion",
      expiresAt: 56_000,
      alertedAt: null,
    });
  });

  it("keeps expiry-cluster evidence and temporal-track compatibility", () => {
    const cluster = {
      id: "cluster:56000",
      firstSeenAt: 1_000,
      lastSeenAt: 5_000,
      centerExpiresAt: 56_000,
      observations: [
        {
          observedAt: 1_000,
          buffId: "next:potion",
          name: "비약",
          slotKey: "2:3",
          seconds: 55,
          predictedExpiresAt: 56_000,
          score: 0.99,
          strength: "strong",
          reason: "target_accepted",
          source: "accepted",
          box,
        },
      ],
      confirmedAt: 5_000,
    } satisfies BuffExpiryExpiryCluster;

    expect(cluster.observations[0]).toMatchObject({
      slotKey: "2:3",
      source: "accepted",
    });
    expectTypeOf<BuffExpiryTemporalCandidateTrack>().toEqualTypeOf<BuffExpiryPendingTrack>();
  });
});
