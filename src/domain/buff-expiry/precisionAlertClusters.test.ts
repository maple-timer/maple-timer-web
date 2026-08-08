import { describe, expect, it } from "vitest";
import type { BuffExpiryTrackedBuff } from "./precisionTrackingTypes";
import {
  getBuffExpiryPrecisionAlertClusters,
  markDueBuffExpiryPrecisionClustersAlerted,
} from "./precisionAlertClusters";

describe("precisionAlertClusters", () => {
  it("does not schedule stale tracks that have not been seen recently", () => {
    const now = 25_000;
    const staleTrack = makeTrack({
      id: "next:unionLuck:r1:c12",
      buffId: "next:unionLuck",
      name: "유니온의 행운",
      expiresAt: 30_000,
      lastSeenAt: 5_000,
    });

    expect(getBuffExpiryPrecisionAlertClusters({
      tracks: [staleTrack],
      alertLeadSeconds: 10,
      now,
    })).toEqual([]);

    const result = markDueBuffExpiryPrecisionClustersAlerted({
      tracks: [staleTrack],
      alertLeadSeconds: 10,
      now,
      requireFreshness: true,
    });

    expect(result.shouldAlert).toBe(false);
    expect(result.tracks[0].alertedAt).toBeNull();
    expect(result.alertDecision).toMatchObject({
      reason: "no-due-tracks",
      dueTracks: [],
      deferredTrackIds: [staleTrack.id],
      markedTrackIds: [],
    });
  });

  it("still alerts a due track that was seen recently", () => {
    const now = 25_000;
    const freshTrack = makeTrack({
      id: "next:unionLuck:r1:c12",
      buffId: "next:unionLuck",
      name: "유니온의 행운",
      expiresAt: 30_000,
      lastSeenAt: 20_000,
    });

    const result = markDueBuffExpiryPrecisionClustersAlerted({
      tracks: [freshTrack],
      alertLeadSeconds: 10,
      now,
      requireFreshness: true,
    });

    expect(result.shouldAlert).toBe(true);
    expect(result.tracks[0].alertedAt).toBe(now);
    expect(result.alertDecision).toMatchObject({
      reason: "new-alert-group",
      newAlertTrackIds: [freshTrack.id],
      deferredTrackIds: [],
      markedTrackIds: [freshTrack.id],
    });
  });

  it("schedules negative alert leads after the tracked buff expires", () => {
    const track = makeTrack({
      id: "next:unionLuck:r1:c12",
      buffId: "next:unionLuck",
      name: "유니온의 행운",
      expiresAt: 30_000,
      lastSeenAt: 28_000,
    });

    expect(getBuffExpiryPrecisionAlertClusters({
      tracks: [track],
      alertLeadSeconds: -3,
      now: 28_000,
    })).toMatchObject([
      {
        dueAt: 33_000,
        minExpiresAt: 30_000,
      },
    ]);

    const beforeExpiry = markDueBuffExpiryPrecisionClustersAlerted({
      tracks: [track],
      alertLeadSeconds: -3,
      now: 32_999,
      requireFreshness: true,
    });
    expect(beforeExpiry.shouldAlert).toBe(false);
    expect(beforeExpiry.tracks[0].alertedAt).toBeNull();

    const afterExpiry = markDueBuffExpiryPrecisionClustersAlerted({
      tracks: [track],
      alertLeadSeconds: -3,
      now: 33_000,
      requireFreshness: true,
    });
    expect(afterExpiry.shouldAlert).toBe(true);
    expect(afterExpiry.tracks[0].alertedAt).toBe(33_000);
  });

  it("keeps post-expiry alert clusters after the buff is no longer freshly observed", () => {
    const track = makeTrack({
      id: "next:unionLuck:r1:c12",
      buffId: "next:unionLuck",
      name: "유니온의 행운",
      expiresAt: 30_000,
      lastSeenAt: 20_000,
    });

    expect(getBuffExpiryPrecisionAlertClusters({
      tracks: [track],
      alertLeadSeconds: -5,
      now: 34_000,
    })).toMatchObject([
      {
        dueAt: 35_000,
        minExpiresAt: 30_000,
      },
    ]);

    const due = markDueBuffExpiryPrecisionClustersAlerted({
      tracks: [track],
      alertLeadSeconds: -5,
      now: 35_000,
      requireFreshness: true,
    });
    expect(due.shouldAlert).toBe(true);
    expect(due.tracks[0].alertedAt).toBe(35_000);
    expect(due.alertDecision.deferredTrackIds).toEqual([]);
  });

  it("clusters tracks through the inclusive 15-second window and splits the next track", () => {
    const first = makeTrack({ id: "first", expiresAt: 30_000 });
    const boundary = makeTrack({ id: "boundary", expiresAt: 45_000 });
    const outside = makeTrack({ id: "outside", expiresAt: 45_001 });

    const clusters = getBuffExpiryPrecisionAlertClusters({
      tracks: [outside, boundary, first],
      alertLeadSeconds: 10,
    });

    expect(clusters).toHaveLength(2);
    expect(clusters[0].tracks.map((track) => track.id)).toEqual(["first", "boundary"]);
    expect(clusters[0]).toMatchObject({
      dueAt: 20_000,
      minExpiresAt: 30_000,
      maxExpiresAt: 45_000,
    });
    expect(clusters[1].tracks.map((track) => track.id)).toEqual(["outside"]);
  });

  it("marks a due track without replaying an alert near an existing alerted group", () => {
    const alreadyAlerted = makeTrack({
      id: "already-alerted",
      expiresAt: 30_000,
      lastSeenAt: 29_000,
      alertedAt: 20_000,
    });
    const nearbyDue = makeTrack({
      id: "nearby-due",
      expiresAt: 40_000,
      lastSeenAt: 29_000,
    });

    const result = markDueBuffExpiryPrecisionClustersAlerted({
      tracks: [alreadyAlerted, nearbyDue],
      alertLeadSeconds: 10,
      now: 30_000,
      requireFreshness: true,
    });

    expect(result.shouldAlert).toBe(false);
    expect(result.tracks.find((track) => track.id === nearbyDue.id)?.alertedAt).toBe(30_000);
    expect(result.alertDecision).toMatchObject({
      reason: "existing-alert-group",
      newAlertTrackIds: [],
      suppressedTrackIds: [nearbyDue.id],
      markedTrackIds: [nearbyDue.id],
      nearestExistingAlertGroup: {
        trackId: alreadyAlerted.id,
        distanceMs: 10_000,
      },
    });
  });
});

function makeTrack(patch: Partial<BuffExpiryTrackedBuff>): BuffExpiryTrackedBuff {
  return {
    id: "next:unionWealth:r0:c0",
    buffId: "next:unionWealth",
    name: "유니온의 부",
    box: {
      x: 100,
      y: 40,
      width: 32,
      height: 32,
      side: 32,
      row: 0,
      col: 0,
      confidence: 1,
    },
    detectedSeconds: 30,
    detectedAt: 0,
    expiresAt: 30_000,
    lastSeenAt: 0,
    alertedAt: null,
    score: 1,
    ...patch,
  };
}
