import { describe, expect, it } from "vitest";
import {
  applyConfirmedExpiryClusters,
  buildBuffExpiryClusterObservations,
  updateBuffExpiryClusters,
} from "./buffExpiryExpiryClusters";
import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryBox,
  BuffExpiryExpiryCluster,
  BuffExpiryTemporalCandidateMatch,
  BuffExpiryTrackedBuff,
} from "../buffExpiry/buffExpiryTypes";

const BOX: BuffExpiryBox = {
  x: 100,
  y: 40,
  width: 34,
  height: 34,
  confidence: 0.95,
  side: 34,
  row: 0,
  col: 0,
};

function makeBox(overrides: Partial<BuffExpiryBox> = {}): BuffExpiryBox {
  return {
    ...BOX,
    ...overrides,
  };
}

function makeMatch({
  seconds,
  box = BOX,
  buffId = "union_wealth_group",
  strength = "strong",
  score = strength === "strong" ? 0.98 : 0.91,
  reason = "accepted",
}: {
  seconds: number;
  box?: BuffExpiryBox;
  buffId?: string;
  strength?: "strong" | "weak";
  score?: number;
  reason?: string;
}): BuffExpiryAcceptedMatch {
  return {
    box,
    buffId,
    name: buffId,
    seconds,
    score,
    buffMargin: 0.2,
    secondMargin: 0.2,
    reason,
    strength,
    topMatches: [],
  };
}

function makeTemporalCandidateMatch(
  overrides: Parameters<typeof makeMatch>[0],
): BuffExpiryTemporalCandidateMatch {
  return {
    ...makeMatch({
      ...overrides,
      strength: "weak",
      score: overrides.score ?? 0.91,
      reason: "temporal-low-score",
    }),
    reason: "temporal-low-score",
    strength: "weak",
  };
}

function buildConfirmedCluster(): BuffExpiryExpiryCluster {
  const boxA = makeBox({ x: 100, col: 0 });
  const boxB = makeBox({ x: 148, col: 1 });
  let clusters: BuffExpiryExpiryCluster[] = [];

  for (const step of [
    {
      now: 0,
      match: makeMatch({
        seconds: 59,
        box: boxA,
        buffId: "union_wealth_group",
      }),
    },
    {
      now: 1_000,
      match: makeMatch({
        seconds: 58,
        box: boxB,
        buffId: "bonus_exp_coupon_group",
      }),
    },
    {
      now: 3_000,
      match: makeMatch({
        seconds: 56,
        box: boxA,
        buffId: "union_wealth_group",
      }),
    },
    {
      now: 4_000,
      match: makeMatch({
        seconds: 55,
        box: boxB,
        buffId: "bonus_exp_coupon_group",
      }),
    },
  ]) {
    clusters = updateBuffExpiryClusters(
      clusters,
      buildBuffExpiryClusterObservations([step.match], [], step.now),
      step.now,
    );
  }

  const confirmed = clusters.find((cluster) => cluster.confirmedAt !== null);
  if (!confirmed) {
    throw new Error("Expected a confirmed expiry cluster");
  }
  return confirmed;
}

describe("buffExpiryExpiryClusters", () => {
  it("builds cluster observations only for the supported 21-59 second window", () => {
    const now = 10_000;

    const observations = buildBuffExpiryClusterObservations(
      [
        makeMatch({ seconds: 20, buffId: "too-short" }),
        makeMatch({ seconds: 21, buffId: "min" }),
        makeMatch({ seconds: 59, buffId: "max" }),
        makeMatch({ seconds: 60, buffId: "too-long" }),
      ],
      [makeTemporalCandidateMatch({ seconds: 40, buffId: "temporal" })],
      now,
    );

    expect(
      observations.map((observation) => [
        observation.buffId,
        observation.source,
        observation.predictedExpiresAt,
      ]),
    ).toEqual([
      ["min", "accepted", 31_000],
      ["max", "accepted", 69_000],
      ["temporal", "temporal", 50_000],
    ]);
  });

  it("confirms a multi-buff cluster and promotes its members to tracked buffs", () => {
    const cluster = buildConfirmedCluster();

    expect(cluster).toMatchObject({
      centerExpiresAt: 59_000,
      confirmedAt: 4_000,
    });

    const tracks = applyConfirmedExpiryClusters([], [cluster], 4_000);

    expect(
      tracks.map((track) => [track.buffId, track.expiresAt]).sort(),
    ).toEqual([
      ["bonus_exp_coupon_group", 59_000],
      ["union_wealth_group", 59_000],
    ]);
  });

  it("preserves alertedAt when a confirmed cluster refreshes an existing member track", () => {
    const cluster = buildConfirmedCluster();
    const alertedTrack: BuffExpiryTrackedBuff = {
      id: "union_wealth_group:59",
      buffId: "union_wealth_group",
      name: "union_wealth_group",
      box: BOX,
      detectedSeconds: 29,
      detectedAt: 30_000,
      expiresAt: 59_000,
      lastSeenAt: 30_000,
      alertedAt: 30_000,
      score: 0.98,
    };

    const tracks = applyConfirmedExpiryClusters(
      [alertedTrack],
      [cluster],
      31_000,
    );

    expect(
      tracks.find((track) => track.buffId === "union_wealth_group"),
    ).toMatchObject({
      id: alertedTrack.id,
      expiresAt: 59_000,
      alertedAt: 30_000,
    });
  });

  it("does not add a blocked cluster member while the same buff has a different active expiry", () => {
    const cluster = buildConfirmedCluster();
    const blockingTrack: BuffExpiryTrackedBuff = {
      id: "union_wealth_group:120",
      buffId: "union_wealth_group",
      name: "union_wealth_group",
      box: BOX,
      detectedSeconds: 120,
      detectedAt: 0,
      expiresAt: 120_000,
      lastSeenAt: 1_000,
      alertedAt: null,
      score: 0.98,
    };

    const tracks = applyConfirmedExpiryClusters(
      [blockingTrack],
      [cluster],
      4_000,
    );

    expect(
      tracks.find((track) => track.buffId === "union_wealth_group"),
    ).toMatchObject({
      id: blockingTrack.id,
      expiresAt: blockingTrack.expiresAt,
      lastSeenAt: blockingTrack.lastSeenAt,
    });
    expect(
      tracks.find((track) => track.buffId === "bonus_exp_coupon_group"),
    ).toMatchObject({
      buffId: "bonus_exp_coupon_group",
      expiresAt: 59_000,
    });
  });
});
