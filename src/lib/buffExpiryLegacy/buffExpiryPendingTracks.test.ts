import { describe, expect, it } from "vitest";
import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryBox,
  BuffExpiryPendingObservation,
  BuffExpiryPendingTrack,
  BuffExpiryTemporalCandidateMatch,
  BuffExpiryTrackedBuff,
} from "../buffExpiry/buffExpiryTypes";
import {
  BUFF_EXPIRY_PENDING_WINDOW_MS,
  dedupePendingTracksBySlot,
  dedupeTemporalCandidateTracks,
  findMatchingPendingTrack,
  findMatchingTemporalCandidateTrack,
  getLatestPendingObservationAt,
  maybeConfirmPendingTrack,
  maybeConfirmTemporalCandidateTrack,
  updatePendingTrack,
  updateTemporalCandidateTrack,
} from "./buffExpiryPendingTracks";
import {
  BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
  BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
} from "./buffExpiryRuntimeConstants";

const BOX: BuffExpiryBox = {
  x: 100,
  y: 40,
  width: 34,
  height: 34,
  confidence: 0.95,
  side: 34,
};

function makeMatch({
  seconds,
  box = BOX,
  buffId = "exp-coupon",
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

function makeTemporalMatch({
  seconds,
  box = BOX,
  buffId = BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
  score = 0.91,
}: {
  seconds: number;
  box?: BuffExpiryBox;
  buffId?: string;
  score?: number;
}): BuffExpiryTemporalCandidateMatch {
  return {
    ...makeMatch({
      seconds,
      box,
      buffId,
      strength: "weak",
      score,
      reason: "temporal-low-score",
    }),
    reason: "temporal-low-score",
    strength: "weak",
  };
}

function makeTrack({
  id = "track",
  buffId = "exp-coupon",
  box = BOX,
  expiresAt = 60_000,
  lastSeenAt = 0,
}: Partial<BuffExpiryTrackedBuff> = {}): BuffExpiryTrackedBuff {
  return {
    id,
    buffId,
    name: buffId,
    box,
    detectedSeconds: Math.max(0, Math.round((expiresAt - lastSeenAt) / 1000)),
    detectedAt: lastSeenAt,
    expiresAt,
    lastSeenAt,
    alertedAt: null,
    score: 0.98,
  };
}

function makePendingTrack({
  id = "pending",
  buffId = "exp-coupon",
  box = BOX,
  observations,
  firstSeenAt = observations[0]?.observedAt ?? 0,
  lastSeenAt = observations[observations.length - 1]?.observedAt ?? firstSeenAt,
  score = observations[observations.length - 1]?.score ?? 0.91,
}: {
  id?: string;
  buffId?: string;
  box?: BuffExpiryBox;
  observations: BuffExpiryPendingObservation[];
  firstSeenAt?: number;
  lastSeenAt?: number;
  score?: number;
}): BuffExpiryPendingTrack {
  return {
    id,
    buffId,
    name: buffId,
    box,
    firstSeenAt,
    lastSeenAt,
    observations,
    score,
  };
}

function observation(
  observedAt: number,
  seconds: number,
  {
    strength = "strong",
    score = strength === "strong" ? 0.98 : 0.91,
    reason = "accepted",
  }: {
    strength?: "strong" | "weak";
    score?: number;
    reason?: string;
  } = {},
): BuffExpiryPendingObservation {
  return {
    observedAt,
    seconds,
    score,
    strength,
    reason,
  };
}

describe("buffExpiryPendingTracks", () => {
  it("updates a pending track and prunes observations outside the pending window", () => {
    const previous = makePendingTrack({
      id: "exp-coupon:59",
      observations: [
        observation(0, 59),
        observation(BUFF_EXPIRY_PENDING_WINDOW_MS - 1_000, 25),
      ],
      lastSeenAt: BUFF_EXPIRY_PENDING_WINDOW_MS - 1_000,
    });

    const updated = updatePendingTrack(
      previous,
      makeMatch({ seconds: 20, score: 0.99 }),
      BUFF_EXPIRY_PENDING_WINDOW_MS + 1,
    );

    expect(updated.id).toBe(previous.id);
    expect(updated.firstSeenAt).toBe(previous.firstSeenAt);
    expect(updated.lastSeenAt).toBe(BUFF_EXPIRY_PENDING_WINDOW_MS + 1);
    expect(updated.observations.map((item) => item.seconds)).toEqual([25, 20]);
  });

  it("finds the closest unconsumed pending track by predicted expiry", () => {
    const consumedTrack = makePendingTrack({
      id: "consumed",
      observations: [observation(0, 59)],
    });
    const closeTrack = makePendingTrack({
      id: "close",
      observations: [observation(0, 58)],
      lastSeenAt: 1_000,
    });
    const farTrack = makePendingTrack({
      id: "far",
      observations: [observation(0, 50)],
    });

    expect(
      findMatchingPendingTrack(
        [consumedTrack, farTrack, closeTrack],
        "exp-coupon",
        makeMatch({ seconds: 57 }),
        1_000,
        new Set(["consumed"]),
      )?.id,
    ).toBe("close");
  });

  it("dedupes pending tracks by slot while excluding active slots and buffs", () => {
    const sameSlotWeak = makePendingTrack({
      id: "same-slot-weak",
      observations: [observation(0, 59, { strength: "weak", score: 0.95 })],
    });
    const sameSlotFlow = makePendingTrack({
      id: "same-slot-flow",
      observations: [
        observation(0, 59, { strength: "weak", score: 0.91 }),
        observation(10_000, 49, { strength: "weak", score: 0.91 }),
      ],
      lastSeenAt: 10_000,
    });
    const activeSlotTrack = makePendingTrack({
      id: "active-slot",
      buffId: "other-buff",
      observations: [observation(0, 59)],
      box: { ...BOX, x: BOX.x + 80 },
    });
    const activeBuffTrack = makePendingTrack({
      id: "active-buff",
      buffId: "active-buff",
      observations: [observation(0, 59)],
      box: { ...BOX, x: BOX.x + 160 },
    });

    const deduped = dedupePendingTracksBySlot(
      [sameSlotWeak, sameSlotFlow, activeSlotTrack, activeBuffTrack],
      [
        makeTrack({
          id: "active-slot-track",
          buffId: "active-slot-buff",
          box: activeSlotTrack.box,
        }),
        makeTrack({
          id: "active-buff-track",
          buffId: "active-buff",
          box: { ...BOX, x: BOX.x + 240 },
        }),
      ],
    );

    expect(deduped.map((track) => track.id)).toEqual(["same-slot-flow"]);
  });

  it("confirms a strong accepted pending track from a tight low-thirties pair", () => {
    const track = makePendingTrack({
      observations: [
        observation(0, 39, { score: 0.97 }),
        observation(1_000, 38, { score: 0.97 }),
      ],
      lastSeenAt: 1_000,
    });

    const confirmed = maybeConfirmPendingTrack(track);

    expect(confirmed).toMatchObject({
      id: track.id,
      detectedSeconds: 38,
      detectedAt: 1_000,
      expiresAt: 39_000,
      alertedAt: null,
    });
  });

  it("does not confirm weak observations without enough countdown span", () => {
    const track = makePendingTrack({
      observations: [
        observation(0, 39, { strength: "weak", score: 0.93 }),
        observation(3_000, 36, { strength: "weak", score: 0.93 }),
        observation(6_000, 33, { strength: "weak", score: 0.93 }),
      ],
      lastSeenAt: 6_000,
    });

    expect(maybeConfirmPendingTrack(track)).toBeNull();
  });

  it("creates stable temporal candidate ids and finds matching candidates in the same slot", () => {
    const initial = updateTemporalCandidateTrack(
      null,
      makeTemporalMatch({ seconds: 59 }),
      0,
    );
    const updated = updateTemporalCandidateTrack(
      initial,
      makeTemporalMatch({ seconds: 55 }),
      4_000,
    );

    expect(updated.id).toBe(initial.id);
    expect(
      findMatchingTemporalCandidateTrack(
        [updated],
        makeTemporalMatch({ seconds: 51 }),
        8_000,
        new Set(),
      )?.id,
    ).toBe(initial.id);
  });

  it("dedupes temporal candidates by slot and buff while preserving separate buff identities", () => {
    const boxB = { ...BOX, x: BOX.x + 80 };
    const first = updateTemporalCandidateTrack(
      null,
      makeTemporalMatch({
        seconds: 59,
        buffId: BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
      }),
      0,
    );
    const newerSameBuffAndSlot = updateTemporalCandidateTrack(
      null,
      makeTemporalMatch({
        seconds: 58,
        buffId: BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
        score: 0.92,
      }),
      1_000,
    );
    const separateBuff = updateTemporalCandidateTrack(
      null,
      makeTemporalMatch({
        seconds: 58,
        box: boxB,
        buffId: BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
      }),
      1_000,
    );

    const deduped = dedupeTemporalCandidateTracks(
      [first, newerSameBuffAndSlot, separateBuff],
      [],
    );

    expect(deduped.map((track) => track.id).sort()).toEqual(
      [newerSameBuffAndSlot.id, separateBuff.id].sort(),
    );
  });

  it("confirms low-score small potion temporal candidates only after stable countdown flow", () => {
    const track = makePendingTrack({
      buffId: BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
      observations: [
        observation(0, 59, {
          strength: "weak",
          score: 0.91,
          reason: "temporal-low-score",
        }),
        observation(4_000, 55, {
          strength: "weak",
          score: 0.91,
          reason: "temporal-low-score",
        }),
        observation(8_000, 51, {
          strength: "weak",
          score: 0.91,
          reason: "temporal-low-score",
        }),
        observation(12_000, 47, {
          strength: "weak",
          score: 0.91,
          reason: "temporal-low-score",
        }),
      ],
      lastSeenAt: 12_000,
    });

    const confirmed = maybeConfirmTemporalCandidateTrack(track);

    expect(confirmed).toMatchObject({
      buffId: BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
      detectedSeconds: 47,
      detectedAt: 12_000,
      expiresAt: 59_000,
    });
  });

  it("reports the latest pending observation time", () => {
    expect(
      getLatestPendingObservationAt(
        makePendingTrack({
          observations: [
            observation(1_000, 59),
            observation(7_000, 53),
            observation(4_000, 56),
          ],
        }),
      ),
    ).toBe(7_000);
    expect(
      getLatestPendingObservationAt(
        makePendingTrack({
          observations: [],
        }),
      ),
    ).toBeNull();
  });
});
