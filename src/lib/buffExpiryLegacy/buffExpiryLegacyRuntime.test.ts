import { describe, expect, it } from "vitest";
import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryBox,
  BuffExpiryExpiryCluster,
  BuffExpiryTemporalCandidateMatch,
} from "../buffExpiry/buffExpiryTypes";
import {
  markDueBuffExpiryTracksAlerted,
  reconcileBuffExpiryTracks,
  selectBuffExpiryRuntimeMatches,
} from "./buffExpiryLegacyRuntime";
import { getBuffExpiryRemainingSeconds } from "../buffExpiry/buffExpiryRuntimeTiming";

const BOX: BuffExpiryBox = {
  x: 100,
  y: 40,
  width: 34,
  height: 34,
  confidence: 0.95,
  side: 34,
};

type RuntimeTestState = ReturnType<typeof reconcileBuffExpiryTracks>;

function makeMatch(
  seconds: number,
  box: BuffExpiryBox = BOX,
  strength: "strong" | "weak" = "strong",
  score = strength === "strong" ? 0.98 : 0.91,
  buffId = "exp-coupon",
): BuffExpiryAcceptedMatch {
  return {
    box,
    buffId,
    name: buffId,
    seconds,
    score,
    buffMargin: 0.2,
    secondMargin: 0.2,
    reason: "accepted",
    strength,
    topMatches: [],
  };
}

function confirmBuffExpiryTrack({
  state,
  buffId,
  box,
  firstSeenAt,
}: {
  state: RuntimeTestState;
  buffId: string;
  box: BuffExpiryBox;
  firstSeenAt: number;
}): RuntimeTestState {
  const first = reconcileBuffExpiryTracks({
    previousTracks: state.tracks,
    previousPendingTracks: state.pendingTracks,
    previousExpiryClusters: state.expiryClusters,
    acceptedMatches: [makeMatch(50, box, "strong", 0.98, buffId)],
    boxes: [box],
    now: firstSeenAt,
  });
  const second = reconcileBuffExpiryTracks({
    previousTracks: first.tracks,
    previousPendingTracks: first.pendingTracks,
    previousExpiryClusters: first.expiryClusters,
    acceptedMatches: [makeMatch(47, box, "strong", 0.98, buffId)],
    boxes: [box],
    now: firstSeenAt + 3_000,
  });
  return reconcileBuffExpiryTracks({
    previousTracks: second.tracks,
    previousPendingTracks: second.pendingTracks,
    previousExpiryClusters: second.expiryClusters,
    acceptedMatches: [makeMatch(44, box, "strong", 0.98, buffId)],
    boxes: [box],
    now: firstSeenAt + 6_000,
  });
}

function makeHypothesisMatch(
  seconds: number,
  box: BuffExpiryBox = BOX,
  score = 0.94,
  buffId = "exp-coupon",
): BuffExpiryAcceptedMatch {
  return {
    ...makeMatch(seconds, box, "weak", score, buffId),
    reason: "hypothesis-top-match",
  };
}

function makeTemporalCandidateMatch(
  seconds: number,
  box: BuffExpiryBox = BOX,
  score = 0.91,
  buffId = "exp-coupon",
): BuffExpiryTemporalCandidateMatch {
  return {
    ...makeMatch(seconds, box, "weak", score, buffId),
    reason: "temporal-low-score",
    strength: "weak",
  };
}

function makeConfirmedExpiryCluster({
  buffId = "union_wealth_group",
  name = buffId,
  box = BOX,
  centerExpiresAt = 59_000,
  confirmedAt = 4_000,
}: {
  buffId?: string;
  name?: string;
  box?: BuffExpiryBox;
  centerExpiresAt?: number;
  confirmedAt?: number;
} = {}): BuffExpiryExpiryCluster {
  return {
    id: `expiry:${Math.round(centerExpiresAt / 1000)}:${buffId}`,
    firstSeenAt: 0,
    lastSeenAt: 1_000,
    centerExpiresAt,
    confirmedAt,
    observations: [
      {
        observedAt: 0,
        buffId,
        name,
        slotKey: "pos:15:7",
        seconds: Math.round(centerExpiresAt / 1000),
        predictedExpiresAt: centerExpiresAt,
        score: 0.98,
        strength: "strong",
        reason: "accepted",
        source: "accepted",
        box,
      },
      {
        observedAt: 1_000,
        buffId,
        name,
        slotKey: "pos:15:7",
        seconds: Math.round(centerExpiresAt / 1000) - 1,
        predictedExpiresAt: centerExpiresAt,
        score: 0.98,
        strength: "strong",
        reason: "accepted",
        source: "accepted",
        box,
      },
    ],
  };
}

describe("buffExpiryLegacyRuntime", () => {
  it("tracks a 45 second detection and alerts once at the 30 second lead", () => {
    const detectedAt = 1_000;
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(50)],
      boxes: [BOX],
      now: detectedAt,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: first.tracks,
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(47)],
      boxes: [BOX],
      now: detectedAt + 3_000,
    });
    const confirmed = reconcileBuffExpiryTracks({
      previousTracks: second.tracks,
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(44)],
      boxes: [BOX],
      now: detectedAt + 6_000,
    });
    const tracks = confirmed.tracks;

    expect(tracks).toHaveLength(1);
    expect(getBuffExpiryRemainingSeconds(tracks[0], detectedAt + 19_000)).toBe(
      31,
    );
    expect(
      markDueBuffExpiryTracksAlerted({
        tracks,
        now: detectedAt + 19_000,
        alertLeadSeconds: 30,
      }).shouldAlert,
    ).toBe(false);

    const firstAlert = markDueBuffExpiryTracksAlerted({
      tracks,
      now: detectedAt + 20_000,
      alertLeadSeconds: 30,
    });
    expect(firstAlert.shouldAlert).toBe(true);
    expect(firstAlert.tracks[0].alertedAt).toBe(detectedAt + 20_000);

    const secondAlert = markDueBuffExpiryTracksAlerted({
      tracks: firstAlert.tracks,
      now: detectedAt + 21_000,
      alertLeadSeconds: 30,
    });
    expect(secondAlert.shouldAlert).toBe(false);
    expect(secondAlert.tracks[0].alertedAt).toBe(detectedAt + 20_000);
  });

  it("keeps a confirmed track briefly after expiry when sampling skips the due frame", () => {
    const state = confirmBuffExpiryTrack({
      state: reconcileBuffExpiryTracks({
        previousTracks: [],
        acceptedMatches: [],
        boxes: [],
        now: 0,
      }),
      buffId: "union_wealth_group",
      box: BOX,
      firstSeenAt: 0,
    });
    const track = state.tracks[0];

    expect(track.expiresAt).toBe(50_000);

    const afterSkippedDueFrame = reconcileBuffExpiryTracks({
      previousTracks: state.tracks,
      previousPendingTracks: state.pendingTracks,
      previousExpiryClusters: state.expiryClusters,
      acceptedMatches: [],
      boxes: [BOX],
      now: 55_000,
    });
    expect(afterSkippedDueFrame.tracks).toHaveLength(1);

    const lateAlert = markDueBuffExpiryTracksAlerted({
      tracks: afterSkippedDueFrame.tracks,
      now: 55_000,
      alertLeadSeconds: 10,
    });
    expect(lateAlert.shouldAlert).toBe(true);
    expect(lateAlert.tracks[0].alertedAt).toBe(55_000);

    const afterGraceWindow = reconcileBuffExpiryTracks({
      previousTracks: state.tracks,
      previousPendingTracks: state.pendingTracks,
      previousExpiryClusters: state.expiryClusters,
      acceptedMatches: [],
      boxes: [BOX],
      now: 81_000,
    });
    expect(afterGraceWindow.tracks).toHaveLength(0);
  });

  it("uses the configured alert lead instead of a fixed 30 second lead", () => {
    const track = {
      id: "a",
      buffId: "a",
      name: "A",
      box: BOX,
      detectedSeconds: 45,
      detectedAt: 0,
      expiresAt: 45_000,
      lastSeenAt: 15_000,
      alertedAt: null,
      score: 0.98,
    };

    const thirtySecondsRemaining = markDueBuffExpiryTracksAlerted({
      tracks: [track],
      now: 15_000,
      alertLeadSeconds: 15,
    });
    expect(thirtySecondsRemaining.shouldAlert).toBe(false);
    expect(thirtySecondsRemaining.tracks[0].alertedAt).toBeNull();

    const fifteenSecondsRemaining = markDueBuffExpiryTracksAlerted({
      tracks: [track],
      now: 30_000,
      alertLeadSeconds: 15,
    });
    expect(fifteenSecondsRemaining.shouldAlert).toBe(true);
    expect(fifteenSecondsRemaining.tracks[0].alertedAt).toBe(30_000);
  });

  it("does not confirm a single 21 second detection without stable observations", () => {
    const result = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(21)],
      boxes: [BOX],
      now: 10_000,
    });

    expect(result.tracks).toHaveLength(0);
    expect(result.pendingTracks).toHaveLength(1);
  });

  it("confirms after three descending observations with the same predicted expiry", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(50)],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(47)],
      boxes: [BOX],
      now: 3_000,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(44)],
      boxes: [BOX],
      now: 6_000,
    });

    expect(second.pendingTracks).toHaveLength(1);
    expect(second.tracks).toHaveLength(0);
    expect(third.pendingTracks).toHaveLength(0);
    expect(third.tracks).toHaveLength(1);
    expect(third.tracks[0]).toMatchObject({
      buffId: "exp-coupon",
      detectedSeconds: 44,
      expiresAt: 50_000,
    });
  });

  it("fast-confirms tight strong accepted observations from a short 1fps window", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [
        {
          ...makeMatch(46, BOX, "strong", 0.9575, "bonus_exp_coupon_group"),
          reason: "grouped-countdown",
        },
      ],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [
        makeMatch(45, BOX, "strong", 0.9571, "bonus_exp_coupon_group"),
      ],
      boxes: [BOX],
      now: 1_028,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [
        makeMatch(44, BOX, "strong", 0.9745, "bonus_exp_coupon_group"),
      ],
      boxes: [BOX],
      now: 1_999,
    });

    expect(third.pendingTracks).toHaveLength(0);
    expect(third.tracks).toHaveLength(1);
    expect(third.tracks[0]).toMatchObject({
      buffId: "bonus_exp_coupon_group",
      detectedSeconds: 44,
      expiresAt: 46_009,
    });
  });

  it("does not fast-confirm short strong observations when the predicted expiry drifts", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(46, BOX, "strong", 0.98)],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(45, BOX, "strong", 0.98)],
      boxes: [BOX],
      now: 1_000,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(40, BOX, "strong", 0.98)],
      boxes: [BOX],
      now: 2_000,
    });

    expect(third.tracks).toHaveLength(0);
    expect(third.pendingTracks).toHaveLength(1);
  });

  it("fast-confirms a high-confidence strong pair in the 31-39 second window", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [
        makeMatch(38, BOX, "strong", 0.962, "bonus_exp_coupon_group"),
      ],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [
        makeMatch(37, BOX, "strong", 0.9628, "bonus_exp_coupon_group"),
      ],
      boxes: [BOX],
      now: 1_032,
    });

    expect(second.pendingTracks).toHaveLength(0);
    expect(second.tracks).toHaveLength(1);
    expect(second.tracks[0]).toMatchObject({
      buffId: "bonus_exp_coupon_group",
      detectedSeconds: 37,
      expiresAt: 38_016,
    });
  });

  it("does not fast-confirm a strong pair outside the 31-39 second window", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(45, BOX, "strong", 0.98)],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(44, BOX, "strong", 0.98)],
      boxes: [BOX],
      now: 1_000,
    });

    expect(second.tracks).toHaveLength(0);
    expect(second.pendingTracks).toHaveLength(1);
  });

  it("does not fast-confirm a strong pair when the predicted expiry drifts", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(38, BOX, "strong", 0.98)],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(37, BOX, "strong", 0.98)],
      boxes: [BOX],
      now: 2_000,
    });

    expect(second.tracks).toHaveLength(0);
    expect(second.pendingTracks).toHaveLength(1);
  });

  it("keeps hypothesis-only evidence out of runtime tracking", () => {
    const selected = selectBuffExpiryRuntimeMatches({
      acceptedMatches: [],
      hypothesisMatches: [makeHypothesisMatch(45, BOX, 0.94, "union_luck")],
      previousTracks: [],
      previousPendingTracks: [],
      now: 0,
    });

    const result = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: selected,
      boxes: [BOX],
      now: 0,
    });

    expect(selected).toHaveLength(0);
    expect(result.tracks).toHaveLength(0);
    expect(result.pendingTracks).toHaveLength(0);
  });

  it("does not let hypothesis evidence reinforce an accepted pending countdown", () => {
    const firstMatches = selectBuffExpiryRuntimeMatches({
      acceptedMatches: [makeMatch(45, BOX, "strong", 0.96, "union_luck")],
      hypothesisMatches: [],
      previousTracks: [],
      previousPendingTracks: [],
      now: 0,
    });
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: firstMatches,
      boxes: [BOX],
      now: 0,
    });
    const secondMatches = selectBuffExpiryRuntimeMatches({
      acceptedMatches: [],
      hypothesisMatches: [
        makeHypothesisMatch(43, { ...BOX, x: BOX.x + 120 }, 0.94, "union_luck"),
      ],
      previousTracks: first.tracks,
      previousPendingTracks: first.pendingTracks,
      now: 2_000,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: first.tracks,
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: secondMatches,
      boxes: [{ ...BOX, x: BOX.x + 120 }],
      now: 2_000,
    });
    const thirdMatches = selectBuffExpiryRuntimeMatches({
      acceptedMatches: [],
      hypothesisMatches: [
        makeHypothesisMatch(41, { ...BOX, x: BOX.x + 240 }, 0.94, "union_luck"),
      ],
      previousTracks: second.tracks,
      previousPendingTracks: second.pendingTracks,
      now: 4_000,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: second.tracks,
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: thirdMatches,
      boxes: [{ ...BOX, x: BOX.x + 240 }],
      now: 4_000,
    });

    expect(secondMatches).toHaveLength(0);
    expect(thirdMatches).toHaveLength(0);
    expect(third.tracks).toHaveLength(0);
    expect(third.pendingTracks).toHaveLength(1);
    expect(third.pendingTracks[0].observations).toHaveLength(1);
  });

  it("keeps only the best second candidate for the same frame box and buff", () => {
    const selected = selectBuffExpiryRuntimeMatches({
      acceptedMatches: [
        makeMatch(34, BOX, "weak", 0.9113, "small_wealth_exp_potion_group"),
        makeMatch(53, BOX, "weak", 0.9315, "small_wealth_exp_potion_group"),
        makeMatch(37, BOX, "weak", 0.8975, "small_wealth_exp_potion_group"),
      ],
      hypothesisMatches: [],
      previousTracks: [],
      previousPendingTracks: [],
      now: 0,
    });

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      buffId: "small_wealth_exp_potion_group",
      seconds: 53,
      score: 0.9315,
    });
  });

  it("prefers a strong same-box match over a higher-scored weak match", () => {
    const selected = selectBuffExpiryRuntimeMatches({
      acceptedMatches: [
        makeMatch(34, BOX, "weak", 0.99, "small_wealth_exp_potion_group"),
        makeMatch(53, BOX, "strong", 0.94, "small_wealth_exp_potion_group"),
      ],
      hypothesisMatches: [],
      previousTracks: [],
      previousPendingTracks: [],
      now: 0,
    });

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      buffId: "small_wealth_exp_potion_group",
      seconds: 53,
      strength: "strong",
      score: 0.94,
    });
  });

  it("keeps separate best second candidates for different frame boxes", () => {
    const otherBox = { ...BOX, x: BOX.x + 40 };
    const selected = selectBuffExpiryRuntimeMatches({
      acceptedMatches: [
        makeMatch(34, BOX, "weak", 0.9113, "small_wealth_exp_potion_group"),
        makeMatch(53, BOX, "weak", 0.9315, "small_wealth_exp_potion_group"),
        makeMatch(51, otherBox, "weak", 0.9676, "bonus_exp_coupon_group"),
        makeMatch(31, otherBox, "weak", 0.9608, "bonus_exp_coupon_group"),
      ],
      hypothesisMatches: [],
      previousTracks: [],
      previousPendingTracks: [],
      now: 0,
    });

    expect(selected).toHaveLength(2);
    expect(
      selected.map((match) => `${match.buffId}:${match.seconds}`).sort(),
    ).toEqual([
      "bonus_exp_coupon_group:51",
      "small_wealth_exp_potion_group:53",
    ]);
  });

  it("does not merge hypothesis evidence that points to a different expiry time", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(45, BOX, "strong", 0.96, "event_exp_buff")],
      boxes: [BOX],
      now: 0,
    });
    const selected = selectBuffExpiryRuntimeMatches({
      acceptedMatches: [],
      hypothesisMatches: [makeHypothesisMatch(50, BOX, 0.94, "event_exp_buff")],
      previousTracks: first.tracks,
      previousPendingTracks: first.pendingTracks,
      now: 2_000,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: first.tracks,
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: selected,
      boxes: [BOX],
      now: 2_000,
    });

    expect(selected).toHaveLength(0);
    expect(second.tracks).toHaveLength(0);
    expect(second.pendingTracks).toHaveLength(1);
    expect(second.pendingTracks[0].observations).toHaveLength(1);
    expect(second.pendingTracks[0].observations[0].seconds).toBe(45);
  });

  it("requires a higher average score before confirming hypothesis-only observations", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeHypothesisMatch(45, BOX, 0.91, "event_exp_buff")],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeHypothesisMatch(43, BOX, 0.91, "event_exp_buff")],
      boxes: [BOX],
      now: 2_000,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeHypothesisMatch(41, BOX, 0.91, "event_exp_buff")],
      boxes: [BOX],
      now: 4_000,
    });

    expect(third.tracks).toHaveLength(0);
    expect(third.pendingTracks).toHaveLength(1);
  });

  it("waits for a longer weak countdown sequence before confirming", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(58, BOX, "weak")],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(55, BOX, "weak")],
      boxes: [BOX],
      now: 3_000,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(51, BOX, "weak")],
      boxes: [BOX],
      now: 7_000,
    });
    const fourth = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: third.pendingTracks,
      acceptedMatches: [makeMatch(48, BOX, "weak")],
      boxes: [BOX],
      now: 10_000,
    });

    expect(first.tracks).toHaveLength(0);
    expect(second.tracks).toHaveLength(0);
    expect(second.pendingTracks).toHaveLength(1);
    expect(third.tracks).toHaveLength(0);
    expect(third.pendingTracks).toHaveLength(1);
    expect(fourth.pendingTracks).toHaveLength(0);
    expect(fourth.tracks).toHaveLength(1);
    expect(fourth.tracks[0]).toMatchObject({
      detectedSeconds: 48,
      expiresAt: 58_000,
    });
  });

  it("confirms a consistent pending countdown window even when an outlier is present", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 0, seconds: 56, strength: "weak" as const, score: 0.93 },
      { now: 3_000, seconds: 53, strength: "weak" as const, score: 0.931 },
      { now: 7_000, seconds: 54, strength: "weak" as const, score: 0.932 },
      { now: 10_000, seconds: 46, strength: "strong" as const, score: 0.946 },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [
          makeMatch(
            step.seconds,
            BOX,
            step.strength,
            step.score,
            "exp_multiplier_coupon_group",
          ),
        ],
        boxes: [BOX],
        now: step.now,
      });
    }

    expect(state.pendingTracks).toHaveLength(0);
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0]).toMatchObject({
      buffId: "exp_multiplier_coupon_group",
      detectedSeconds: 46,
      expiresAt: 56_000,
    });
  });

  it("uses a consistent 31+ second strong observation to confirm a weak countdown sequence", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [
        makeMatch(57, BOX, "weak", 0.9308, "union_wealth_group"),
      ],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [
        makeMatch(50, BOX, "weak", 0.9333, "union_wealth_group"),
      ],
      boxes: [BOX],
      now: 7_020,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [
        makeMatch(43, BOX, "weak", 0.9221, "union_wealth_group"),
      ],
      boxes: [BOX],
      now: 16_064,
    });
    const fourth = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: third.pendingTracks,
      acceptedMatches: [
        makeMatch(34, BOX, "strong", 0.9408, "union_wealth_group"),
      ],
      boxes: [BOX],
      now: 23_099,
    });

    expect(third.tracks).toHaveLength(0);
    expect(third.pendingTracks).toHaveLength(1);
    expect(fourth.pendingTracks).toHaveLength(0);
    expect(fourth.tracks).toHaveLength(1);
    expect(fourth.tracks[0]).toMatchObject({
      buffId: "union_wealth_group",
      detectedSeconds: 34,
      detectedAt: 23_099,
      expiresAt: 57_546,
    });
  });

  it("replaces an inconsistent pending candidate in the same slot", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(58, BOX, "weak")],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(42, BOX, "weak")],
      boxes: [BOX],
      now: 3_000,
    });

    expect(second.tracks).toHaveLength(0);
    expect(second.pendingTracks).toHaveLength(1);
    expect(second.pendingTracks[0].observations[0].seconds).toBe(42);
  });

  it("lets a consistent same-slot countdown replace stale non-progressing pending evidence", () => {
    const wealthBox = { ...BOX, x: 1087, y: 146, row: 3, col: 1 };
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 0, seconds: 39, strength: "weak" as const, score: 0.9227 },
      { now: 2_000, seconds: 39, strength: "weak" as const, score: 0.9351 },
      { now: 5_000, seconds: 57, strength: "strong" as const, score: 0.973 },
      { now: 6_000, seconds: 56, strength: "strong" as const, score: 0.964 },
      { now: 7_000, seconds: 55, strength: "strong" as const, score: 0.974 },
      { now: 11_000, seconds: 51, strength: "strong" as const, score: 0.949 },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [
          makeMatch(
            step.seconds,
            wealthBox,
            step.strength,
            step.score,
            "union_wealth_group",
          ),
        ],
        boxes: [wealthBox],
        now: step.now,
      });
    }

    expect(state.pendingTracks).toHaveLength(0);
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0]).toMatchObject({
      buffId: "union_wealth_group",
      detectedSeconds: 51,
      expiresAt: 62_000,
    });
  });

  it("does not promote a later same-slot cluster when an active track already explains the countdown", () => {
    const wealthBox = { ...BOX, x: 1087, y: 146, row: 3, col: 1 };
    const luckBox = { ...BOX, x: 1055, y: 146, row: 3, col: 0 };
    let state: RuntimeTestState = {
      tracks: [
        {
          id: "union_wealth_group:62",
          buffId: "union_wealth_group",
          name: "유니온의 부",
          box: wealthBox,
          detectedSeconds: 51,
          detectedAt: 11_000,
          expiresAt: 62_000,
          lastSeenAt: 11_000,
          alertedAt: null,
          score: 0.949,
        },
        {
          id: "union_luck_group:62",
          buffId: "union_luck_group",
          name: "유니온의 행운",
          box: luckBox,
          detectedSeconds: 51,
          detectedAt: 11_000,
          expiresAt: 62_000,
          lastSeenAt: 11_000,
          alertedAt: null,
          score: 0.949,
        },
      ],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 42_000, seconds: 50 },
      { now: 45_000, seconds: 47 },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [
          makeMatch(
            step.seconds,
            wealthBox,
            "strong",
            0.94,
            "union_wealth_group",
          ),
          makeMatch(step.seconds, luckBox, "strong", 0.94, "union_luck_group"),
        ],
        boxes: [wealthBox, luckBox],
        now: step.now,
      });
    }

    expect(
      state.tracks.map((track) => [track.buffId, track.expiresAt]).sort(),
    ).toEqual([
      ["union_luck_group", 62_000],
      ["union_wealth_group", 62_000],
    ]);
  });

  it("does not confirm weak observations when a stable minute label only looks like seconds", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(33, BOX, "weak", 0.93)],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(33, BOX, "weak", 0.93)],
      boxes: [BOX],
      now: 1_000,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(33, BOX, "weak", 0.93)],
      boxes: [BOX],
      now: 2_000,
    });

    expect(third.tracks).toHaveLength(0);
    expect(third.pendingTracks).toHaveLength(1);
    expect(third.pendingTracks[0].observations).toHaveLength(3);
  });

  it("does not confirm strong observations when a stable minute label only looks like seconds", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(33, BOX, "strong", 0.98)],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(33, BOX, "strong", 0.98)],
      boxes: [BOX],
      now: 1_000,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(33, BOX, "strong", 0.98)],
      boxes: [BOX],
      now: 2_000,
    });

    expect(third.tracks).toHaveLength(0);
    expect(third.pendingTracks).toHaveLength(1);
    expect(third.pendingTracks[0].observations).toHaveLength(3);
  });

  it("does not confirm countdown observations that move back upward", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(55, BOX, "strong", 0.98)],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(47, BOX, "strong", 0.98)],
      boxes: [BOX],
      now: 8_000,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(48, BOX, "strong", 0.98)],
      boxes: [BOX],
      now: 10_000,
    });

    expect(third.tracks).toHaveLength(0);
    expect(third.pendingTracks).toHaveLength(1);
    expect(
      third.pendingTracks[0].observations.map(
        (observation) => observation.seconds,
      ),
    ).toEqual([55, 47, 48]);
  });

  it("confirms strong countdown observations down to the 21 second floor", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(27, BOX, "strong", 0.98)],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(24, BOX, "strong", 0.98)],
      boxes: [BOX],
      now: 3_000,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(21, BOX, "strong", 0.98)],
      boxes: [BOX],
      now: 6_000,
    });

    expect(third.pendingTracks).toHaveLength(0);
    expect(third.tracks).toHaveLength(1);
    expect(third.tracks[0]).toMatchObject({
      detectedSeconds: 21,
      expiresAt: 27_000,
    });
  });

  it("confirms a real sample style sequence once 31+ second observations have enough progression", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [
        makeMatch(48, BOX, "strong", 0.9469, "small_wealth_exp_potion_group"),
      ],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [
        makeMatch(47, BOX, "strong", 0.9547, "small_wealth_exp_potion_group"),
      ],
      boxes: [BOX],
      now: 2_004,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [
        makeMatch(46, BOX, "strong", 0.9579, "small_wealth_exp_potion_group"),
      ],
      boxes: [BOX],
      now: 3_018,
    });
    const fourth = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: third.pendingTracks,
      acceptedMatches: [
        makeMatch(39, BOX, "strong", 0.9595, "small_wealth_exp_potion_group"),
      ],
      boxes: [BOX],
      now: 10_087,
    });

    expect(third.tracks).toHaveLength(0);
    expect(third.pendingTracks).toHaveLength(1);
    expect(fourth.pendingTracks).toHaveLength(0);
    expect(fourth.tracks).toHaveLength(1);
    expect(fourth.tracks[0]).toMatchObject({
      buffId: "small_wealth_exp_potion_group",
      detectedSeconds: 39,
      expiresAt: 48_777,
    });
  });

  it("confirms a tight small potion pending pair when only two long-spaced accepted observations are available", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [
        {
          ...makeMatch(
            45,
            BOX,
            "weak",
            0.9231,
            "small_wealth_exp_potion_group",
          ),
          reason: "small-potion-compressed-countdown",
        },
      ],
      boxes: [BOX],
      now: 111_000,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [
        {
          ...makeMatch(
            32,
            BOX,
            "weak",
            0.9234,
            "small_wealth_exp_potion_group",
          ),
          reason: "small-potion-compressed-countdown",
        },
      ],
      boxes: [BOX],
      now: 124_000,
    });

    expect(second.pendingTracks).toHaveLength(0);
    expect(second.tracks).toHaveLength(1);
    expect(second.tracks[0]).toMatchObject({
      buffId: "small_wealth_exp_potion_group",
      detectedSeconds: 32,
      expiresAt: 156_000,
    });
  });

  it("confirms small potion identity-backed weak countdowns before the 30 second alert lead", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };
    const steps = [
      { now: 18_000, seconds: 48, score: 0.924 },
      { now: 24_000, seconds: 42, score: 0.9231 },
      { now: 28_000, seconds: 38, score: 0.9213 },
    ];

    for (const step of steps) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [
          {
            ...makeMatch(
              step.seconds,
              BOX,
              "weak",
              step.score,
              "small_wealth_exp_potion_group",
            ),
            reason: "small-potion-identity-countdown",
          },
        ],
        boxes: [BOX],
        now: step.now,
      });
    }

    expect(state.pendingTracks).toHaveLength(0);
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0]).toMatchObject({
      buffId: "small_wealth_exp_potion_group",
      detectedSeconds: 38,
      detectedAt: 28_000,
      expiresAt: 66_000,
    });

    const early = markDueBuffExpiryTracksAlerted({
      tracks: state.tracks,
      now: 35_000,
      alertLeadSeconds: 30,
    });
    expect(early.shouldAlert).toBe(false);

    const due = markDueBuffExpiryTracksAlerted({
      tracks: state.tracks,
      now: 36_000,
      alertLeadSeconds: 30,
    });
    expect(due.shouldAlert).toBe(true);
    expect(due.tracks[0].alertedAt).toBe(36_000);
  });

  it("confirms sparse strong observations that resume in the low-thirties window", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(47, BOX, "strong", 0.9479, "event_exp_buff")],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(34, BOX, "strong", 0.9511, "event_exp_buff")],
      boxes: [BOX],
      now: 13_126,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(33, BOX, "strong", 0.9518, "event_exp_buff")],
      boxes: [BOX],
      now: 14_126,
    });

    expect(second.tracks).toHaveLength(0);
    expect(second.pendingTracks).toHaveLength(1);
    expect(third.pendingTracks).toHaveLength(0);
    expect(third.tracks).toHaveLength(1);
    expect(third.tracks[0]).toMatchObject({
      buffId: "event_exp_buff",
      detectedSeconds: 33,
      expiresAt: 47_084,
    });
  });

  it("does not confirm three weak low-second observations before the weak confirmation window", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(39, BOX, "weak", 0.93)],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(36, BOX, "weak", 0.93)],
      boxes: [BOX],
      now: 3_000,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(33, BOX, "weak", 0.93)],
      boxes: [BOX],
      now: 6_000,
    });

    expect(third.tracks).toHaveLength(0);
    expect(third.pendingTracks).toHaveLength(1);
    expect(third.pendingTracks[0].observations).toHaveLength(3);
  });

  it("drops an unconfirmed pending track after the hypothesis window expires even if the slot stays visible", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(45)],
      boxes: [BOX],
      now: 0,
    });

    expect(
      reconcileBuffExpiryTracks({
        previousTracks: [],
        previousPendingTracks: first.pendingTracks,
        acceptedMatches: [],
        boxes: [BOX],
        now: 5_000,
      }).pendingTracks,
    ).toHaveLength(1);
    expect(
      reconcileBuffExpiryTracks({
        previousTracks: [],
        previousPendingTracks: first.pendingTracks,
        acceptedMatches: [],
        boxes: [BOX],
        now: 35_001,
      }).pendingTracks,
    ).toHaveLength(0);
  });

  it("confirms sparse weak observations across a longer countdown window", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(59, BOX, "weak", 0.91)],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(50, BOX, "weak", 0.91)],
      boxes: [BOX],
      now: 9_000,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(45, BOX, "weak", 0.91)],
      boxes: [BOX],
      now: 14_000,
    });
    const fourth = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: third.pendingTracks,
      acceptedMatches: [makeMatch(40, BOX, "weak", 0.91)],
      boxes: [BOX],
      now: 19_000,
    });

    expect(third.tracks).toHaveLength(0);
    expect(third.pendingTracks).toHaveLength(1);
    expect(fourth.pendingTracks).toHaveLength(0);
    expect(fourth.tracks).toHaveLength(1);
    expect(fourth.tracks[0]).toMatchObject({
      detectedSeconds: 40,
      expiresAt: 59_000,
    });
  });

  it("confirms small potion low-score temporal candidates only after a stable countdown window", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [],
      temporalCandidateMatches: [
        makeTemporalCandidateMatch(
          59,
          BOX,
          0.91,
          "small_wealth_exp_potion_group",
        ),
      ],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousTemporalCandidateTracks: first.temporalCandidateTracks,
      acceptedMatches: [],
      temporalCandidateMatches: [
        makeTemporalCandidateMatch(
          55,
          BOX,
          0.91,
          "small_wealth_exp_potion_group",
        ),
      ],
      boxes: [BOX],
      now: 4_000,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousTemporalCandidateTracks: second.temporalCandidateTracks,
      acceptedMatches: [],
      temporalCandidateMatches: [
        makeTemporalCandidateMatch(
          51,
          BOX,
          0.91,
          "small_wealth_exp_potion_group",
        ),
      ],
      boxes: [BOX],
      now: 8_000,
    });
    const fourth = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousTemporalCandidateTracks: third.temporalCandidateTracks,
      acceptedMatches: [],
      temporalCandidateMatches: [
        makeTemporalCandidateMatch(
          47,
          BOX,
          0.91,
          "small_wealth_exp_potion_group",
        ),
      ],
      boxes: [BOX],
      now: 12_000,
    });

    expect(first.tracks).toHaveLength(0);
    expect(first.pendingTracks).toHaveLength(0);
    expect(first.temporalCandidateTracks).toHaveLength(1);
    expect(third.tracks).toHaveLength(0);
    expect(third.pendingTracks).toHaveLength(0);
    expect(third.temporalCandidateTracks).toHaveLength(1);
    expect(fourth.temporalCandidateTracks).toHaveLength(0);
    expect(fourth.pendingTracks).toHaveLength(0);
    expect(fourth.tracks).toHaveLength(1);
    expect(fourth.tracks[0]).toMatchObject({
      buffId: "small_wealth_exp_potion_group",
      detectedSeconds: 47,
      expiresAt: 59_000,
      score: 0.91,
    });
  });

  it("keeps unmatched temporal candidates within the observation window and drops them after it expires", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [],
      temporalCandidateMatches: [
        makeTemporalCandidateMatch(
          59,
          BOX,
          0.91,
          "small_wealth_exp_potion_group",
        ),
      ],
      boxes: [BOX],
      now: 0,
    });

    expect(
      reconcileBuffExpiryTracks({
        previousTracks: [],
        previousTemporalCandidateTracks: first.temporalCandidateTracks,
        acceptedMatches: [],
        temporalCandidateMatches: [],
        boxes: [BOX],
        now: 5_000,
      }).temporalCandidateTracks,
    ).toHaveLength(1);
    expect(
      reconcileBuffExpiryTracks({
        previousTracks: [],
        previousTemporalCandidateTracks: first.temporalCandidateTracks,
        acceptedMatches: [],
        temporalCandidateMatches: [],
        boxes: [BOX],
        now: 35_001,
      }).temporalCandidateTracks,
    ).toHaveLength(0);
  });

  it("confirms exp coupon temporal candidates only after a longer stable countdown window", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 0, seconds: 57, score: 0.912 },
      { now: 3_000, seconds: 54, score: 0.923 },
      { now: 7_000, seconds: 50, score: 0.914 },
      { now: 10_000, seconds: 47, score: 0.924 },
      { now: 11_000, seconds: 46, score: 0.932 },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [],
        temporalCandidateMatches: [
          makeTemporalCandidateMatch(
            step.seconds,
            BOX,
            step.score,
            "exp_multiplier_coupon_group",
          ),
        ],
        boxes: [BOX],
        now: step.now,
      });
    }

    expect(state.temporalCandidateTracks).toHaveLength(0);
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0]).toMatchObject({
      buffId: "exp_multiplier_coupon_group",
      detectedSeconds: 46,
      expiresAt: 57_000,
      score: 0.932,
    });
  });

  it("confirms bonus exp coupon temporal candidates in the 21 to 30 second window", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 0, seconds: 29, score: 0.906 },
      { now: 2_000, seconds: 27, score: 0.907 },
      { now: 4_000, seconds: 25, score: 0.906 },
      { now: 6_000, seconds: 23, score: 0.907 },
      { now: 8_000, seconds: 21, score: 0.908 },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [],
        temporalCandidateMatches: [
          makeTemporalCandidateMatch(
            step.seconds,
            BOX,
            step.score,
            "bonus_exp_coupon_group",
          ),
        ],
        boxes: [BOX],
        now: step.now,
      });
    }

    expect(state.temporalCandidateTracks).toHaveLength(0);
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0]).toMatchObject({
      buffId: "bonus_exp_coupon_group",
      detectedSeconds: 21,
      expiresAt: 29_000,
    });
    expect(
      markDueBuffExpiryTracksAlerted({
        tracks: state.tracks,
        now: 23_000,
        alertLeadSeconds: 6,
      }).shouldAlert,
    ).toBe(true);
  });

  it("does not confirm early coupon temporal candidates when the predicted expiry time drifts", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 0, seconds: 30 },
      { now: 2_000, seconds: 30 },
      { now: 4_000, seconds: 28 },
      { now: 6_000, seconds: 23 },
      { now: 8_000, seconds: 21 },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [],
        temporalCandidateMatches: [
          makeTemporalCandidateMatch(
            step.seconds,
            BOX,
            0.908,
            "bonus_exp_coupon_group",
          ),
        ],
        boxes: [BOX],
        now: step.now,
      });
    }

    expect(state.tracks).toHaveLength(0);
    expect(state.temporalCandidateTracks).toHaveLength(1);
  });

  it("does not confirm single union temporal candidates in the 21 to 30 second window", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 0, seconds: 29 },
      { now: 4_000, seconds: 25 },
      { now: 8_000, seconds: 21 },
      { now: 10_000, seconds: 19 },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [],
        temporalCandidateMatches: [
          makeTemporalCandidateMatch(
            step.seconds,
            BOX,
            0.91,
            "union_wealth_group",
          ),
        ],
        boxes: [BOX],
        now: step.now,
      });
    }

    expect(state.tracks).toHaveLength(0);
    expect(state.temporalCandidateTracks).toHaveLength(1);
  });

  it("does not confirm low-score temporal candidates across a long observation gap", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 0, seconds: 50 },
      { now: 1_000, seconds: 49 },
      { now: 11_000, seconds: 39 },
      { now: 17_000, seconds: 33 },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [],
        temporalCandidateMatches: [
          makeTemporalCandidateMatch(
            step.seconds,
            BOX,
            0.91,
            "union_luck_group",
          ),
        ],
        boxes: [BOX],
        now: step.now,
      });
    }

    expect(state.tracks).toHaveLength(0);
    expect(state.temporalCandidateTracks).toHaveLength(1);
  });

  it("does not confirm low-score temporal candidates without real countdown progress", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [],
      temporalCandidateMatches: [
        makeTemporalCandidateMatch(41, BOX, 0.91, "union_wealth_group"),
      ],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousTemporalCandidateTracks: first.temporalCandidateTracks,
      acceptedMatches: [],
      temporalCandidateMatches: [
        makeTemporalCandidateMatch(41, BOX, 0.91, "union_wealth_group"),
      ],
      boxes: [BOX],
      now: 4_000,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousTemporalCandidateTracks: second.temporalCandidateTracks,
      acceptedMatches: [],
      temporalCandidateMatches: [
        makeTemporalCandidateMatch(41, BOX, 0.91, "union_wealth_group"),
      ],
      boxes: [BOX],
      now: 8_000,
    });
    const fourth = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousTemporalCandidateTracks: third.temporalCandidateTracks,
      acceptedMatches: [],
      temporalCandidateMatches: [
        makeTemporalCandidateMatch(41, BOX, 0.91, "union_wealth_group"),
      ],
      boxes: [BOX],
      now: 12_000,
    });

    expect(fourth.tracks).toHaveLength(0);
    expect(fourth.pendingTracks).toHaveLength(0);
    expect(fourth.temporalCandidateTracks).toHaveLength(1);
  });

  it("does not merge low-score temporal candidates across slots", () => {
    const movedBox = { ...BOX, x: BOX.x + 120 };
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [],
      temporalCandidateMatches: [
        makeTemporalCandidateMatch(59, BOX, 0.91, "union_wealth_group"),
      ],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousTemporalCandidateTracks: first.temporalCandidateTracks,
      acceptedMatches: [],
      temporalCandidateMatches: [
        makeTemporalCandidateMatch(55, movedBox, 0.89, "union_wealth_group"),
      ],
      boxes: [movedBox],
      now: 4_000,
    });

    expect(second.tracks).toHaveLength(0);
    expect(second.pendingTracks).toHaveLength(0);
    expect(second.temporalCandidateTracks).toHaveLength(2);
  });

  it("keeps sparse but consistent pending countdown observations long enough to confirm", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(48)],
      boxes: [BOX],
      now: 33_500,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(42)],
      boxes: [BOX],
      now: 39_500,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(41)],
      boxes: [BOX],
      now: 40_500,
    });

    expect(second.pendingTracks).toHaveLength(1);
    expect(second.tracks).toHaveLength(0);
    expect(third.pendingTracks).toHaveLength(0);
    expect(third.tracks).toHaveLength(1);
    expect(third.tracks[0]).toMatchObject({
      detectedSeconds: 41,
      expiresAt: 81_500,
    });
  });

  it("merges pending observations for the same buff and expiry even when the slot changes", () => {
    const movedBoxA = { ...BOX, x: BOX.x + 140 };
    const movedBoxB = { ...BOX, x: BOX.x + 280 };
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(50, BOX)],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(47, movedBoxA)],
      boxes: [movedBoxA],
      now: 3_000,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(44, movedBoxB)],
      boxes: [movedBoxB],
      now: 6_000,
    });

    expect(second.pendingTracks).toHaveLength(1);
    expect(second.tracks).toHaveLength(0);
    expect(third.pendingTracks).toHaveLength(0);
    expect(third.tracks).toHaveLength(1);
    expect(third.tracks[0]).toMatchObject({
      detectedSeconds: 44,
      expiresAt: 50_000,
      box: movedBoxB,
    });
  });

  it("does not merge moved pending observations when the expiry time is inconsistent", () => {
    const movedBox = { ...BOX, x: BOX.x + 140 };
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(45, BOX)],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(50, movedBox)],
      boxes: [movedBox],
      now: 1_000,
    });

    expect(second.tracks).toHaveLength(0);
    expect(second.pendingTracks).toHaveLength(2);
  });

  it("keeps only one pending identity for the same slot", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(45, BOX, "weak", 0.93, "union_wealth")],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [
        makeMatch(44, BOX, "weak", 0.94, "bonus_exp_coupon_group"),
      ],
      boxes: [BOX],
      now: 1_000,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [
        makeMatch(43, BOX, "weak", 0.95, "exp_multiplier_coupon_group"),
      ],
      boxes: [BOX],
      now: 2_000,
    });

    expect(second.tracks).toHaveLength(0);
    expect(second.pendingTracks).toHaveLength(1);
    expect(second.pendingTracks[0].buffId).toBe("bonus_exp_coupon_group");
    expect(third.tracks).toHaveLength(0);
    expect(third.pendingTracks).toHaveLength(1);
    expect(third.pendingTracks[0].buffId).toBe("exp_multiplier_coupon_group");
  });

  it("updates a confirmed track from a different slot when the buff and expiry are consistent", () => {
    const movedBoxC = { ...BOX, x: BOX.x + 420 };
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(50, BOX)],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(47, BOX)],
      boxes: [BOX],
      now: 3_000,
    });
    const confirmed = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(44, BOX)],
      boxes: [BOX],
      now: 6_000,
    });
    const next = reconcileBuffExpiryTracks({
      previousTracks: confirmed.tracks,
      acceptedMatches: [makeMatch(43, movedBoxC)],
      boxes: [movedBoxC],
      now: 7_000,
    });

    expect(next.pendingTracks).toHaveLength(0);
    expect(next.tracks).toHaveLength(1);
    expect(next.tracks[0]).toMatchObject({
      detectedSeconds: 43,
      expiresAt: 50_000,
      box: movedBoxC,
    });
  });

  it("does not start a new pending cycle for the same buff while an earlier track is still active", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(50)],
      boxes: [BOX],
      now: 0,
    });
    const confirmed = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(47)],
      boxes: [BOX],
      now: 3_000,
    });
    const third = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: confirmed.pendingTracks,
      acceptedMatches: [makeMatch(44)],
      boxes: [BOX],
      now: 6_000,
    });
    const falseRestart = reconcileBuffExpiryTracks({
      previousTracks: third.tracks,
      acceptedMatches: [makeMatch(59, { ...BOX, x: BOX.x + 160 })],
      boxes: [{ ...BOX, x: BOX.x + 160 }],
      now: 20_000,
    });

    expect(falseRestart.pendingTracks).toHaveLength(0);
    expect(falseRestart.tracks).toHaveLength(1);
    expect(falseRestart.tracks[0]).toMatchObject({
      detectedSeconds: 44,
      expiresAt: 50_000,
    });
  });

  it("does not keep a temporal candidate for the same buff while an earlier track is still active", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(50)],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(47)],
      boxes: [BOX],
      now: 3_000,
    });
    const confirmed = reconcileBuffExpiryTracks({
      previousTracks: [],
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(44)],
      boxes: [BOX],
      now: 6_000,
    });
    const falseTemporalRestart = reconcileBuffExpiryTracks({
      previousTracks: confirmed.tracks,
      acceptedMatches: [],
      temporalCandidateMatches: [
        makeTemporalCandidateMatch(59, { ...BOX, x: BOX.x + 160 }, 0.9),
      ],
      boxes: [{ ...BOX, x: BOX.x + 160 }],
      now: 20_000,
    });

    expect(falseTemporalRestart.tracks).toHaveLength(1);
    expect(falseTemporalRestart.pendingTracks).toHaveLength(0);
    expect(falseTemporalRestart.temporalCandidateTracks).toHaveLength(0);
    expect(falseTemporalRestart.tracks[0]).toMatchObject({
      detectedSeconds: 44,
      expiresAt: 50_000,
    });
  });

  it("keeps a confirmed track alive until expiry and only uses slot visibility to refresh its box", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(50)],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: first.tracks,
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(47)],
      boxes: [BOX],
      now: 3_000,
    });
    const confirmed = reconcileBuffExpiryTracks({
      previousTracks: second.tracks,
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(44)],
      boxes: [BOX],
      now: 6_000,
    });
    const visibleBox = { ...BOX, x: BOX.x + 2, y: BOX.y + 1 };

    const next = reconcileBuffExpiryTracks({
      previousTracks: confirmed.tracks,
      acceptedMatches: [],
      boxes: [visibleBox],
      now: 21_000,
    });

    const nextTracks = next.tracks;
    expect(nextTracks).toHaveLength(1);
    expect(nextTracks[0].box).toEqual(visibleBox);
    expect(nextTracks[0].expiresAt).toBe(50_000);
    expect(getBuffExpiryRemainingSeconds(nextTracks[0], 21_000)).toBe(29);
  });

  it("keeps a confirmed track without slot visibility until the buff expiry time", () => {
    const first = reconcileBuffExpiryTracks({
      previousTracks: [],
      acceptedMatches: [makeMatch(50)],
      boxes: [BOX],
      now: 0,
    });
    const second = reconcileBuffExpiryTracks({
      previousTracks: first.tracks,
      previousPendingTracks: first.pendingTracks,
      acceptedMatches: [makeMatch(47)],
      boxes: [BOX],
      now: 3_000,
    });
    const confirmed = reconcileBuffExpiryTracks({
      previousTracks: second.tracks,
      previousPendingTracks: second.pendingTracks,
      acceptedMatches: [makeMatch(44)],
      boxes: [BOX],
      now: 6_000,
    });

    expect(
      reconcileBuffExpiryTracks({
        previousTracks: confirmed.tracks,
        acceptedMatches: [],
        boxes: [],
        now: 49_999,
      }).tracks,
    ).toHaveLength(1);
    expect(
      reconcileBuffExpiryTracks({
        previousTracks: confirmed.tracks,
        acceptedMatches: [],
        boxes: [],
        now: 50_001,
      }).tracks,
    ).toHaveLength(0);
  });

  it("keeps an alerted track over a newer unalerted track for the same buff", () => {
    const alertedTrack = {
      id: "same-buff:alerted",
      buffId: "same-buff",
      name: "Same Buff",
      box: BOX,
      detectedSeconds: 45,
      detectedAt: 0,
      expiresAt: 45_000,
      lastSeenAt: 10_000,
      alertedAt: 15_000,
      score: 0.98,
    };
    const newerUnalertedTrack = {
      ...alertedTrack,
      id: "same-buff:newer",
      box: { ...BOX, x: BOX.x + 160 },
      expiresAt: 49_000,
      lastSeenAt: 20_000,
      alertedAt: null,
      score: 0.99,
    };

    const result = reconcileBuffExpiryTracks({
      previousTracks: [newerUnalertedTrack, alertedTrack],
      acceptedMatches: [],
      boxes: [],
      now: 20_000,
    });

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      id: alertedTrack.id,
      buffId: "same-buff",
      alertedAt: 15_000,
    });
  });

  it("preserves alertedAt when an accepted match refreshes an existing track", () => {
    const alertedTrack = {
      id: "same-buff:45",
      buffId: "same-buff",
      name: "Same Buff",
      box: BOX,
      detectedSeconds: 45,
      detectedAt: 0,
      expiresAt: 45_000,
      lastSeenAt: 10_000,
      alertedAt: 15_000,
      score: 0.98,
    };
    const refreshedBox = { ...BOX, x: BOX.x + 2, y: BOX.y + 1 };

    const result = reconcileBuffExpiryTracks({
      previousTracks: [alertedTrack],
      acceptedMatches: [
        makeMatch(25, refreshedBox, "strong", 0.99, "same-buff"),
      ],
      boxes: [refreshedBox],
      now: 20_000,
    });

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      id: alertedTrack.id,
      buffId: "same-buff",
      box: refreshedBox,
      detectedSeconds: 25,
      expiresAt: 45_000,
      alertedAt: 15_000,
    });
  });

  it("marks near-expiry tracks in the same group without a second alert decision", () => {
    const trackA = {
      id: "a",
      buffId: "a",
      name: "A",
      box: BOX,
      detectedSeconds: 45,
      detectedAt: 0,
      expiresAt: 45_000,
      lastSeenAt: 10_000,
      alertedAt: null,
      score: 0.98,
    };
    const trackB = {
      ...trackA,
      id: "b",
      buffId: "b",
      name: "B",
      box: { ...BOX, x: 150 },
      expiresAt: 49_000,
    };
    const trackC = {
      ...trackA,
      id: "c",
      buffId: "c",
      name: "C",
      box: { ...BOX, x: 220 },
      expiresAt: 80_000,
    };

    const result = markDueBuffExpiryTracksAlerted({
      tracks: [trackA, trackB, trackC],
      now: 15_000,
      alertLeadSeconds: 30,
    });

    expect(result.shouldAlert).toBe(true);
    expect(result.tracks.map((track) => track.alertedAt)).toEqual([
      15_000,
      null,
      null,
    ]);

    const nextResult = markDueBuffExpiryTracksAlerted({
      tracks: result.tracks,
      now: 19_000,
      alertLeadSeconds: 30,
    });

    expect(nextResult.shouldAlert).toBe(false);
    expect(nextResult.tracks.map((track) => track.alertedAt)).toEqual([
      15_000,
      19_000,
      null,
    ]);
  });

  it("suppresses a later buff inside the fixed alert group window even with a shorter alert lead", () => {
    const trackA = {
      id: "a",
      buffId: "a",
      name: "A",
      box: BOX,
      detectedSeconds: 45,
      detectedAt: 0,
      expiresAt: 45_000,
      lastSeenAt: 10_000,
      alertedAt: null,
      score: 0.98,
    };
    const trackB = {
      ...trackA,
      id: "b",
      buffId: "b",
      name: "B",
      box: { ...BOX, x: 150 },
      expiresAt: 70_000,
    };

    const firstAlert = markDueBuffExpiryTracksAlerted({
      tracks: [trackA, trackB],
      now: 30_000,
      alertLeadSeconds: 15,
    });

    expect(firstAlert.shouldAlert).toBe(true);
    expect(firstAlert.tracks.map((track) => track.alertedAt)).toEqual([
      30_000,
      null,
    ]);

    const secondAlert = markDueBuffExpiryTracksAlerted({
      tracks: firstAlert.tracks,
      now: 55_000,
      alertLeadSeconds: 15,
    });

    expect(secondAlert.shouldAlert).toBe(false);
    expect(secondAlert.tracks.map((track) => track.alertedAt)).toEqual([
      30_000, 55_000,
    ]);
  });

  it("does not play a second alert for a late-confirmed track in an already alerted expiry group", () => {
    const alertedTrack = {
      id: "a",
      buffId: "a",
      name: "A",
      box: BOX,
      detectedSeconds: 45,
      detectedAt: 0,
      expiresAt: 45_000,
      lastSeenAt: 15_000,
      alertedAt: 15_000,
      score: 0.98,
    };
    const lateConfirmedTrack = {
      ...alertedTrack,
      id: "b",
      buffId: "b",
      name: "B",
      box: { ...BOX, x: 150 },
      expiresAt: 55_000,
      alertedAt: null,
    };

    const result = markDueBuffExpiryTracksAlerted({
      tracks: [alertedTrack, lateConfirmedTrack],
      now: 25_000,
      alertLeadSeconds: 30,
    });

    expect(result.shouldAlert).toBe(false);
    expect(result.tracks.map((track) => track.alertedAt)).toEqual([
      15_000, 25_000,
    ]);
    expect(result.alertDecision).toMatchObject({
      sampledAt: 25_000,
      alertLeadSeconds: 30,
      shouldAlert: false,
      reason: "existing-alert-group",
      dueTracks: [
        {
          id: "b",
          buffId: "b",
          remainingSeconds: 30,
          expiresAt: 55_000,
        },
      ],
      newAlertTrackIds: [],
      suppressedTrackIds: ["b"],
      deferredTrackIds: [],
      markedTrackIds: ["b"],
      dueGroupExpiresAt: null,
      nearestExistingAlertGroup: {
        trackId: "a",
        distanceMs: 10_000,
      },
    });
  });

  it("plays a new alert for a distant expiry group", () => {
    const alertedTrack = {
      id: "a",
      buffId: "a",
      name: "A",
      box: BOX,
      detectedSeconds: 45,
      detectedAt: 0,
      expiresAt: 45_000,
      lastSeenAt: 15_000,
      alertedAt: 15_000,
      score: 0.98,
    };
    const distantTrack = {
      ...alertedTrack,
      id: "b",
      buffId: "b",
      name: "B",
      box: { ...BOX, x: 150 },
      expiresAt: 600_000,
      alertedAt: null,
    };

    const result = markDueBuffExpiryTracksAlerted({
      tracks: [alertedTrack, distantTrack],
      now: 570_000,
      alertLeadSeconds: 30,
    });

    expect(result.shouldAlert).toBe(true);
    expect(result.tracks.map((track) => track.alertedAt)).toEqual([
      15_000, 570_000,
    ]);
  });

  it("alerts only the earliest due group and defers distant due tracks", () => {
    const firstDueTrack = {
      id: "a",
      buffId: "a",
      name: "A",
      box: BOX,
      detectedSeconds: 45,
      detectedAt: 0,
      expiresAt: 45_000,
      lastSeenAt: 10_000,
      alertedAt: null,
      score: 0.98,
    };
    const sameGroupTrack = {
      ...firstDueTrack,
      id: "b",
      buffId: "b",
      name: "B",
      box: { ...BOX, x: 150 },
      expiresAt: 55_000,
    };
    const distantDueTrack = {
      ...firstDueTrack,
      id: "c",
      buffId: "c",
      name: "C",
      box: { ...BOX, x: 220 },
      expiresAt: 90_000,
    };

    const result = markDueBuffExpiryTracksAlerted({
      tracks: [distantDueTrack, firstDueTrack, sameGroupTrack],
      now: 40_000,
      alertLeadSeconds: 60,
    });

    expect(result.shouldAlert).toBe(true);
    expect(result.tracks.map((track) => [track.id, track.alertedAt])).toEqual([
      ["c", null],
      ["a", 40_000],
      ["b", 40_000],
    ]);
    expect(result.alertDecision).toMatchObject({
      sampledAt: 40_000,
      alertLeadSeconds: 60,
      shouldAlert: true,
      reason: "new-alert-group",
      newAlertTrackIds: ["a", "b"],
      suppressedTrackIds: [],
      deferredTrackIds: ["c"],
      markedTrackIds: ["a", "b"],
      dueGroupExpiresAt: 45_000,
      nearestExistingAlertGroup: null,
    });
  });

  it("confirms an expiry cluster from multiple buffs with the same predicted expiry", () => {
    const boxA = BOX;
    const boxB = { ...BOX, x: BOX.x + 48, col: 1 };
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      {
        now: 0,
        match: makeMatch(59, boxA, "strong", 0.98, "union_wealth_group"),
      },
      {
        now: 1_000,
        match: makeMatch(58, boxB, "strong", 0.98, "bonus_exp_coupon_group"),
      },
      {
        now: 3_000,
        match: makeMatch(56, boxA, "strong", 0.98, "union_wealth_group"),
      },
      {
        now: 4_000,
        match: makeMatch(55, boxB, "strong", 0.98, "bonus_exp_coupon_group"),
      },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [step.match],
        boxes: [boxA, boxB],
        now: step.now,
      });
    }

    expect(state.expiryClusters).toHaveLength(1);
    expect(state.expiryClusters[0]).toMatchObject({
      centerExpiresAt: 59_000,
      confirmedAt: 4_000,
    });
    expect(
      state.tracks.map((track) => [track.buffId, track.expiresAt]).sort(),
    ).toEqual([
      ["bonus_exp_coupon_group", 59_000],
      ["union_wealth_group", 59_000],
    ]);
  });

  it("keeps alertedAt when a confirmed expiry cluster refreshes an existing member track", () => {
    const alertedTrack = {
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

    const result = reconcileBuffExpiryTracks({
      previousTracks: [alertedTrack],
      previousExpiryClusters: [makeConfirmedExpiryCluster()],
      acceptedMatches: [],
      boxes: [BOX],
      now: 31_000,
    });

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      id: alertedTrack.id,
      buffId: "union_wealth_group",
      expiresAt: 59_000,
      alertedAt: 30_000,
    });
  });

  it("does not create a cluster member while the same buff has a different active expiry", () => {
    const blockingTrack = {
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

    const result = reconcileBuffExpiryTracks({
      previousTracks: [blockingTrack],
      previousExpiryClusters: [makeConfirmedExpiryCluster()],
      acceptedMatches: [],
      boxes: [BOX],
      now: 4_000,
    });

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      id: blockingTrack.id,
      buffId: blockingTrack.buffId,
      expiresAt: blockingTrack.expiresAt,
      lastSeenAt: 4_000,
    });
  });

  it("keeps expiry cluster center stable when a wrong countdown observation appears", () => {
    const boxA = BOX;
    const boxB = { ...BOX, x: BOX.x + 48, col: 1 };
    const boxC = { ...BOX, x: BOX.x + 96, col: 2 };
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      {
        now: 0,
        match: makeMatch(59, boxA, "strong", 0.98, "union_wealth_group"),
      },
      {
        now: 1_000,
        match: makeMatch(58, boxB, "strong", 0.98, "bonus_exp_coupon_group"),
      },
      {
        now: 2_000,
        match: makeMatch(31, boxC, "strong", 0.98, "event_exp_buff"),
      },
      {
        now: 3_000,
        match: makeMatch(56, boxA, "strong", 0.98, "union_wealth_group"),
      },
      {
        now: 4_000,
        match: makeMatch(55, boxB, "strong", 0.98, "bonus_exp_coupon_group"),
      },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [step.match],
        boxes: [boxA, boxB, boxC],
        now: step.now,
      });
    }

    const confirmedCluster = state.expiryClusters.find(
      (cluster) => cluster.confirmedAt !== null,
    );
    expect(confirmedCluster?.centerExpiresAt).toBe(59_000);
    expect(state.tracks.some((track) => track.expiresAt === 37_000)).toBe(
      false,
    );
  });

  it("does not confirm an expiry cluster from a temporal-only single slot", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 0, seconds: 59 },
      { now: 4_000, seconds: 55 },
      { now: 8_000, seconds: 51 },
      { now: 12_000, seconds: 47 },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [],
        temporalCandidateMatches: [
          makeTemporalCandidateMatch(
            step.seconds,
            BOX,
            0.91,
            "union_wealth_group",
          ),
        ],
        boxes: [BOX],
        now: step.now,
      });
    }

    expect(
      state.expiryClusters.every((cluster) => cluster.confirmedAt === null),
    ).toBe(true);
  });

  it("confirms a single-slot small potion cluster when countdown flow is stable", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      {
        now: 32_000,
        temporal: makeTemporalCandidateMatch(
          39,
          BOX,
          0.9123,
          "small_wealth_exp_potion_group",
        ),
      },
      {
        now: 33_000,
        accepted: makeMatch(
          39,
          BOX,
          "weak",
          0.9168,
          "small_wealth_exp_potion_group",
        ),
      },
      {
        now: 35_000,
        accepted: makeMatch(
          37,
          BOX,
          "weak",
          0.9374,
          "small_wealth_exp_potion_group",
        ),
      },
      {
        now: 38_000,
        accepted: makeMatch(
          34,
          BOX,
          "weak",
          0.9346,
          "small_wealth_exp_potion_group",
        ),
      },
      {
        now: 40_000,
        accepted: makeMatch(
          32,
          BOX,
          "weak",
          0.9078,
          "small_wealth_exp_potion_group",
        ),
      },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: step.accepted ? [step.accepted] : [],
        temporalCandidateMatches: step.temporal ? [step.temporal] : [],
        boxes: [BOX],
        now: step.now,
      });
    }

    expect(state.expiryClusters).toContainEqual(
      expect.objectContaining({
        centerExpiresAt: 72_000,
        confirmedAt: 38_000,
      }),
    );
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0]).toMatchObject({
      buffId: "small_wealth_exp_potion_group",
      detectedSeconds: 32,
      expiresAt: 72_000,
    });
    expect(state.pendingTracks).toHaveLength(0);
    expect(state.temporalCandidateTracks).toHaveLength(0);

    const alert = markDueBuffExpiryTracksAlerted({
      tracks: state.tracks,
      now: 62_000,
      alertLeadSeconds: 10,
    });
    expect(alert.shouldAlert).toBe(true);
    expect(alert.tracks[0]).toMatchObject({
      alertedAt: 62_000,
    });
  });

  it("confirms 88c7 preview feedback small potion evidence before a 30 second alert lead", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      {
        now: 31_242,
        seconds: 42,
        score: 0.9213,
        reason: "small-potion-identity-countdown",
      },
      {
        now: 37_279,
        seconds: 36,
        score: 0.9283,
        reason: "small-potion-identity-countdown",
      },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [
          {
            ...makeMatch(
              step.seconds,
              BOX,
              "weak",
              step.score,
              "small_wealth_exp_potion_group",
            ),
            reason: step.reason,
          },
        ],
        boxes: [BOX],
        now: step.now,
      });
    }

    expect(state.expiryClusters).toContainEqual(
      expect.objectContaining({
        centerExpiresAt: 73_261,
        confirmedAt: 37_279,
      }),
    );
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0]).toMatchObject({
      buffId: "small_wealth_exp_potion_group",
      detectedSeconds: 36,
      detectedAt: 37_279,
      expiresAt: 73_261,
    });

    expect(
      markDueBuffExpiryTracksAlerted({
        tracks: state.tracks,
        now: 43_260,
        alertLeadSeconds: 30,
      }).shouldAlert,
    ).toBe(false);
    expect(
      markDueBuffExpiryTracksAlerted({
        tracks: state.tracks,
        now: 43_261,
        alertLeadSeconds: 30,
      }).shouldAlert,
    ).toBe(true);
  });

  it("does not confirm a single-slot small potion cluster from an accepted pair without real-time countdown flow", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      {
        now: 35_000,
        match: makeMatch(
          37,
          BOX,
          "weak",
          0.9374,
          "small_wealth_exp_potion_group",
        ),
      },
      {
        now: 38_000,
        match: makeMatch(
          36,
          BOX,
          "weak",
          0.9346,
          "small_wealth_exp_potion_group",
        ),
      },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [step.match],
        boxes: [BOX],
        now: step.now,
      });
    }

    expect(state.tracks).toHaveLength(0);
    expect(
      state.expiryClusters.every((cluster) => cluster.confirmedAt === null),
    ).toBe(true);
  });

  it("does not confirm a single-slot small potion cluster from temporal evidence alone", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 32_000, seconds: 39, score: 0.9123 },
      { now: 33_000, seconds: 39, score: 0.9168 },
      { now: 35_000, seconds: 37, score: 0.9374 },
      { now: 38_000, seconds: 34, score: 0.9346 },
      { now: 40_000, seconds: 32, score: 0.9078 },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [],
        temporalCandidateMatches: [
          makeTemporalCandidateMatch(
            step.seconds,
            BOX,
            step.score,
            "small_wealth_exp_potion_group",
          ),
        ],
        boxes: [BOX],
        now: step.now,
      });
    }

    expect(state.tracks).toHaveLength(0);
    expect(
      state.expiryClusters.every((cluster) => cluster.confirmedAt === null),
    ).toBe(true);
  });

  it("does not confirm a single-slot cluster for union buff groups", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      {
        now: 32_000,
        temporal: makeTemporalCandidateMatch(
          39,
          BOX,
          0.9123,
          "union_wealth_group",
        ),
      },
      {
        now: 33_000,
        temporal: makeTemporalCandidateMatch(
          39,
          BOX,
          0.9168,
          "union_wealth_group",
        ),
      },
      {
        now: 35_000,
        accepted: makeMatch(37, BOX, "weak", 0.9374, "union_wealth_group"),
      },
      {
        now: 38_000,
        accepted: makeMatch(34, BOX, "weak", 0.9346, "union_wealth_group"),
      },
      {
        now: 40_000,
        temporal: makeTemporalCandidateMatch(
          32,
          BOX,
          0.9078,
          "union_wealth_group",
        ),
      },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: step.accepted ? [step.accepted] : [],
        temporalCandidateMatches: step.temporal ? [step.temporal] : [],
        boxes: [BOX],
        now: step.now,
      });
    }

    expect(state.tracks).toHaveLength(0);
    expect(
      state.expiryClusters.every((cluster) => cluster.confirmedAt === null),
    ).toBe(true);
  });

  it("does not confirm a single-slot small potion cluster when the buff id wobbles", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      {
        now: 32_000,
        temporal: makeTemporalCandidateMatch(
          39,
          BOX,
          0.9123,
          "small_wealth_exp_potion_group",
        ),
      },
      {
        now: 33_000,
        temporal: makeTemporalCandidateMatch(
          39,
          BOX,
          0.9168,
          "union_wealth_group",
        ),
      },
      {
        now: 35_000,
        accepted: makeMatch(
          37,
          BOX,
          "weak",
          0.9374,
          "small_wealth_exp_potion_group",
        ),
      },
      {
        now: 38_000,
        accepted: makeMatch(
          34,
          BOX,
          "weak",
          0.9346,
          "small_wealth_exp_potion_group",
        ),
      },
      {
        now: 40_000,
        temporal: makeTemporalCandidateMatch(
          32,
          BOX,
          0.9078,
          "union_wealth_group",
        ),
      },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: step.accepted ? [step.accepted] : [],
        temporalCandidateMatches: step.temporal ? [step.temporal] : [],
        boxes: [BOX],
        now: step.now,
      });
    }

    expect(state.tracks).toHaveLength(0);
    expect(
      state.expiryClusters.every((cluster) => cluster.confirmedAt === null),
    ).toBe(true);
  });

  it("does not treat jittery row and column labels as separate cluster slots", () => {
    const jitteredSlot = (row: number, col: number): BuffExpiryBox => ({
      ...BOX,
      x: 1247,
      y: 32,
      row,
      col,
    });
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      {
        now: 0,
        accepted: makeMatch(
          55,
          jitteredSlot(0, 5),
          "weak",
          0.9284,
          "union_wealth_group",
        ),
      },
      {
        now: 1_517,
        temporal: makeTemporalCandidateMatch(
          54,
          jitteredSlot(0, 5),
          0.9195,
          "union_wealth_group",
        ),
      },
      {
        now: 7_878,
        temporal: makeTemporalCandidateMatch(
          47,
          jitteredSlot(0, 4),
          0.9109,
          "union_wealth_group",
        ),
      },
      {
        now: 9_374,
        temporal: makeTemporalCandidateMatch(
          46,
          jitteredSlot(0, 6),
          0.9156,
          "union_wealth_group",
        ),
      },
      {
        now: 11_764,
        temporal: makeTemporalCandidateMatch(
          43,
          jitteredSlot(0, 6),
          0.9149,
          "union_luck_group",
        ),
      },
      {
        now: 12_940,
        temporal: makeTemporalCandidateMatch(
          42,
          jitteredSlot(0, 6),
          0.916,
          "union_luck_group",
        ),
      },
    ]) {
      const match = step.accepted ?? step.temporal;
      if (!match) {
        throw new Error("Expected jittered slot test step to include a match.");
      }
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: step.accepted ? [step.accepted] : [],
        temporalCandidateMatches: step.temporal ? [step.temporal] : [],
        boxes: [match.box],
        now: step.now,
      });
    }

    expect(state.tracks).toHaveLength(0);
    expect(
      state.expiryClusters.every((cluster) => cluster.confirmedAt === null),
    ).toBe(true);
  });

  it("does not fast-confirm a two-slot weak cluster from unsupported timer-label noise", () => {
    const boxA = BOX;
    const boxB = { ...BOX, x: BOX.x + 32, col: 1 };
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      {
        now: 0,
        accepted: [makeMatch(39, boxB, "weak", 0.927, "union_wealth_group")],
        temporal: [],
      },
      {
        now: 1_000,
        accepted: [makeMatch(39, boxB, "weak", 0.921, "union_wealth_group")],
        temporal: [],
      },
      {
        now: 3_000,
        accepted: [],
        temporal: [
          makeTemporalCandidateMatch(36, boxA, 0.925, "union_luck_group"),
          makeTemporalCandidateMatch(36, boxB, 0.912, "union_wealth_group"),
        ],
      },
      {
        now: 4_000,
        accepted: [],
        temporal: [
          makeTemporalCandidateMatch(35, boxA, 0.915, "union_luck_group"),
          makeTemporalCandidateMatch(35, boxB, 0.917, "union_wealth_group"),
        ],
      },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: step.accepted,
        temporalCandidateMatches: step.temporal,
        boxes: [boxA, boxB],
        now: step.now,
      });
    }

    expect(state.tracks).toHaveLength(0);
    expect(
      state.expiryClusters.every((cluster) => cluster.confirmedAt === null),
    ).toBe(true);
  });

  it("does not confirm a weak-only cluster from many slots when only two buff groups wobble", () => {
    const boxes = [
      BOX,
      { ...BOX, x: BOX.x + 32, col: 1 },
      { ...BOX, x: BOX.x + 64, col: 2 },
      { ...BOX, x: BOX.x + 96, col: 3 },
    ];
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 0, seconds: [39, 35, 39, 35] },
      { now: 3_000, seconds: [36, 36, 36, 36] },
      { now: 4_000, seconds: [35, 35, 35, 35] },
      { now: 10_000, seconds: [29, 29, 29, 29] },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [],
        temporalCandidateMatches: boxes.map((box, index) =>
          makeTemporalCandidateMatch(
            step.seconds[index],
            box,
            0.915,
            index % 2 === 0 ? "union_luck_group" : "union_wealth_group",
          ),
        ),
        boxes,
        now: step.now,
      });
    }

    expect(state.tracks).toHaveLength(0);
    expect(
      state.expiryClusters.every((cluster) => cluster.confirmedAt === null),
    ).toBe(true);
  });

  it("confirms a sustained weak-only cluster from two stable supported buff groups", () => {
    const boxA = BOX;
    const boxB = { ...BOX, x: BOX.x + 48, col: 1 };
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 0, seconds: 59 },
      { now: 5_000, seconds: 54 },
      { now: 10_000, seconds: 49 },
      { now: 15_000, seconds: 44 },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [],
        temporalCandidateMatches: [
          makeTemporalCandidateMatch(
            step.seconds,
            boxA,
            0.892,
            "exp_multiplier_coupon_group",
          ),
          makeTemporalCandidateMatch(
            step.seconds,
            boxB,
            0.887,
            "small_wealth_exp_potion_group",
          ),
        ],
        boxes: [boxA, boxB],
        now: step.now,
      });
    }

    expect(state.expiryClusters).toContainEqual(
      expect.objectContaining({
        centerExpiresAt: 59_000,
        confirmedAt: 15_000,
      }),
    );
    expect(
      state.tracks.map((track) => [track.buffId, track.expiresAt]).sort(),
    ).toEqual([
      ["exp_multiplier_coupon_group", 59_000],
      ["small_wealth_exp_potion_group", 59_000],
    ]);
    expect(
      markDueBuffExpiryTracksAlerted({
        tracks: state.tracks,
        now: 49_000,
        alertLeadSeconds: 10,
      }).shouldAlert,
    ).toBe(true);
  });

  it("confirms a single coupon temporal-only cluster when one slot shows a stable countdown", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 37_000, seconds: 39 },
      { now: 39_000, seconds: 37 },
      { now: 41_000, seconds: 35 },
      { now: 42_000, seconds: 34 },
      { now: 45_000, seconds: 31 },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [],
        temporalCandidateMatches: [
          makeTemporalCandidateMatch(
            step.seconds,
            BOX,
            0.895,
            "bonus_exp_coupon_group",
          ),
        ],
        boxes: [BOX],
        now: step.now,
      });
    }

    expect(state.expiryClusters).toContainEqual(
      expect.objectContaining({
        centerExpiresAt: 76_000,
        confirmedAt: 45_000,
      }),
    );
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0]).toMatchObject({
      buffId: "bonus_exp_coupon_group",
      detectedSeconds: 31,
      expiresAt: 76_000,
    });
  });

  it("allows a short missed-detection gap in a stable single coupon cluster", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };
    const adjacentSlot = { ...BOX, y: BOX.y + BOX.height, row: 1 };

    for (const step of [
      { now: 25_000, seconds: 56, score: 0.9369, source: "temporal" as const },
      { now: 29_000, seconds: 53, score: 0.9366, source: "temporal" as const },
      {
        now: 33_000,
        seconds: 48,
        score: 0.9266,
        source: "temporal" as const,
        box: adjacentSlot,
      },
      { now: 37_000, seconds: 44, score: 0.928, source: "temporal" as const },
      { now: 43_000, seconds: 38, score: 0.9532, source: "accepted" as const },
      { now: 45_000, seconds: 38, score: 0.922, source: "temporal" as const },
    ]) {
      const box = step.box ?? BOX;
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches:
          step.source === "accepted"
            ? [
                makeMatch(
                  step.seconds,
                  box,
                  "strong",
                  step.score,
                  "exp_multiplier_coupon_group",
                ),
              ]
            : [],
        temporalCandidateMatches:
          step.source === "temporal"
            ? [
                makeTemporalCandidateMatch(
                  step.seconds,
                  box,
                  step.score,
                  "exp_multiplier_coupon_group",
                ),
              ]
            : [],
        boxes: [BOX, adjacentSlot],
        now: step.now,
      });
    }

    expect(state.expiryClusters).toContainEqual(
      expect.objectContaining({
        centerExpiresAt: 81_000,
        confirmedAt: 43_000,
      }),
    );
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0]).toMatchObject({
      buffId: "exp_multiplier_coupon_group",
      expiresAt: 81_000,
    });
  });

  it("does not confirm a single coupon temporal-only cluster when the countdown wobbles", () => {
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 37_000, seconds: 39 },
      { now: 38_000, seconds: 38 },
      { now: 39_000, seconds: 39 },
      { now: 41_000, seconds: 35 },
      { now: 45_000, seconds: 31 },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [],
        temporalCandidateMatches: [
          makeTemporalCandidateMatch(
            step.seconds,
            BOX,
            0.895,
            "bonus_exp_coupon_group",
          ),
        ],
        boxes: [BOX],
        now: step.now,
      });
    }

    expect(state.tracks).toHaveLength(0);
    expect(
      state.expiryClusters.every((cluster) => cluster.confirmedAt === null),
    ).toBe(true);
  });

  it("does not confirm a weak-only two-buff cluster when one buff never repeats in a stable slot", () => {
    const stableBox = BOX;
    const noisyBoxes = [
      { ...BOX, x: BOX.x + 48, col: 1 },
      { ...BOX, x: BOX.x + 96, col: 2 },
      { ...BOX, x: BOX.x + 144, col: 3 },
      { ...BOX, x: BOX.x + 192, col: 4 },
      { ...BOX, x: BOX.x + 240, col: 5 },
    ];
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 0, stableSeconds: 59, noisySeconds: 59, noisyIndex: 0 },
      { now: 3_000, noisySeconds: 56, noisyIndex: 1 },
      { now: 6_000, noisySeconds: 53, noisyIndex: 2 },
      { now: 7_500, stableSeconds: 52 },
      { now: 9_000, noisySeconds: 50, noisyIndex: 3 },
      { now: 12_000, noisySeconds: 47, noisyIndex: 4 },
      { now: 15_000, stableSeconds: 44 },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [],
        temporalCandidateMatches: [
          ...(step.stableSeconds === undefined
            ? []
            : [
                makeTemporalCandidateMatch(
                  step.stableSeconds,
                  stableBox,
                  0.892,
                  "exp_multiplier_coupon_group",
                ),
              ]),
          ...(step.noisySeconds === undefined
            ? []
            : [
                makeTemporalCandidateMatch(
                  step.noisySeconds,
                  noisyBoxes[step.noisyIndex],
                  0.887,
                  "small_wealth_exp_potion_group",
                ),
              ]),
        ],
        boxes: [stableBox, ...noisyBoxes],
        now: step.now,
      });
    }

    expect(state.tracks).toHaveLength(0);
    expect(
      state.expiryClusters.every((cluster) => cluster.confirmedAt === null),
    ).toBe(true);
  });

  it("can confirm a weak-only cluster when at least three buff groups support the same expiry", () => {
    const boxes = [
      BOX,
      { ...BOX, x: BOX.x + 48, col: 1 },
      { ...BOX, x: BOX.x + 96, col: 2 },
    ];
    const buffIds = [
      "union_luck_group",
      "union_wealth_group",
      "bonus_exp_coupon_group",
    ];
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 0, seconds: 59 },
      { now: 3_000, seconds: 56 },
      { now: 6_000, seconds: 53 },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [],
        temporalCandidateMatches: boxes.map((box, index) =>
          makeTemporalCandidateMatch(step.seconds, box, 0.915, buffIds[index]),
        ),
        boxes,
        now: step.now,
      });
    }

    expect(
      state.expiryClusters.some((cluster) => cluster.confirmedAt !== null),
    ).toBe(true);
    expect(state.tracks.map((track) => track.buffId).sort()).toEqual([
      "bonus_exp_coupon_group",
      "union_luck_group",
      "union_wealth_group",
    ]);
  });

  it("does not promote an ambiguous same-slot buff member in a confirmed cluster", () => {
    const sharedSlot = BOX;
    const supportingSlot = { ...BOX, x: BOX.x + 48, col: 1 };
    const secondSupportingSlot = { ...BOX, x: BOX.x + 96, col: 2 };
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      {
        now: 0,
        match: makeMatch(59, sharedSlot, "strong", 0.98, "union_wealth_group"),
      },
      {
        now: 1_000,
        match: makeMatch(
          58,
          supportingSlot,
          "strong",
          0.98,
          "bonus_exp_coupon_group",
        ),
      },
      {
        now: 2_000,
        match: makeMatch(57, sharedSlot, "strong", 0.98, "union_luck_group"),
      },
      {
        now: 3_000,
        match: makeMatch(
          56,
          secondSupportingSlot,
          "strong",
          0.98,
          "exp_multiplier_coupon_group",
        ),
      },
      {
        now: 4_000,
        match: makeMatch(
          55,
          supportingSlot,
          "strong",
          0.98,
          "bonus_exp_coupon_group",
        ),
      },
      {
        now: 5_000,
        match: makeMatch(
          54,
          secondSupportingSlot,
          "strong",
          0.98,
          "exp_multiplier_coupon_group",
        ),
      },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [step.match],
        boxes: [sharedSlot, supportingSlot, secondSupportingSlot],
        now: step.now,
      });
    }

    expect(
      state.expiryClusters.some((cluster) => cluster.confirmedAt !== null),
    ).toBe(true);
    expect(state.tracks.map((track) => track.buffId).sort()).toEqual([
      "bonus_exp_coupon_group",
      "exp_multiplier_coupon_group",
    ]);
  });

  it("prefers strong accepted cluster members over repeated temporal same-slot noise", () => {
    const sharedSlot = BOX;
    const supportingSlot = { ...BOX, x: BOX.x + 48, col: 1 };
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      { now: 0, actualSeconds: 59, noisySeconds: 59, supportSeconds: 59 },
      { now: 1_000, noisySeconds: 58 },
      { now: 2_000, noisySeconds: 57 },
      { now: 3_000, actualSeconds: 56, noisySeconds: 56, supportSeconds: 56 },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [
          ...(step.actualSeconds === undefined
            ? []
            : [
                makeMatch(
                  step.actualSeconds,
                  sharedSlot,
                  "strong",
                  0.96,
                  "event_exp_buff",
                ),
              ]),
          ...(step.supportSeconds === undefined
            ? []
            : [
                makeMatch(
                  step.supportSeconds,
                  supportingSlot,
                  "strong",
                  0.98,
                  "bonus_exp_coupon_group",
                ),
              ]),
        ],
        temporalCandidateMatches: [
          makeTemporalCandidateMatch(
            step.noisySeconds,
            sharedSlot,
            0.91,
            "union_luck_group",
          ),
        ],
        boxes: [sharedSlot, supportingSlot],
        now: step.now,
      });
    }

    expect(
      state.expiryClusters.some((cluster) => cluster.confirmedAt !== null),
    ).toBe(true);
    expect(
      state.tracks.map((track) => [track.buffId, track.expiresAt]).sort(),
    ).toEqual([
      ["bonus_exp_coupon_group", 59_000],
      ["event_exp_buff", 59_000],
    ]);
  });

  it("confirms a diverse strong cluster when only one member repeats stably", () => {
    const bonusBox = BOX;
    const luckBox = { ...BOX, x: BOX.x + 48, col: 1 };
    const wealthBox = { ...BOX, x: BOX.x + 96, col: 2 };
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      {
        now: 0,
        matches: [
          makeMatch(39, wealthBox, "strong", 0.946, "union_wealth_group"),
        ],
      },
      {
        now: 2_000,
        matches: [
          makeMatch(39, bonusBox, "strong", 0.9435, "bonus_exp_coupon_group"),
        ],
      },
      {
        now: 4_000,
        matches: [
          makeMatch(22, bonusBox, "strong", 0.9466, "bonus_exp_coupon_group"),
          makeMatch(36, luckBox, "strong", 0.9449, "union_luck_group"),
        ],
      },
      {
        now: 6_000,
        matches: [
          makeMatch(25, bonusBox, "strong", 0.9532, "bonus_exp_coupon_group"),
          makeMatch(34, luckBox, "strong", 0.9428, "union_luck_group"),
        ],
      },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: step.matches,
        boxes: [bonusBox, luckBox, wealthBox],
        now: step.now,
      });
    }

    expect(
      state.expiryClusters.some((cluster) => cluster.confirmedAt !== null),
    ).toBe(true);
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0]).toMatchObject({
      buffId: "union_luck_group",
      expiresAt: 40_000,
    });
    expect(
      markDueBuffExpiryTracksAlerted({
        tracks: state.tracks,
        now: 38_000,
        alertLeadSeconds: 2,
      }).shouldAlert,
    ).toBe(true);
  });

  it("does not confirm a diverse strong cluster without any stable member", () => {
    const bonusBox = BOX;
    const luckBox = { ...BOX, x: BOX.x + 48, col: 1 };
    const wealthBox = { ...BOX, x: BOX.x + 96, col: 2 };
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      {
        now: 0,
        match: makeMatch(39, wealthBox, "strong", 0.946, "union_wealth_group"),
      },
      {
        now: 2_000,
        match: makeMatch(
          38,
          bonusBox,
          "strong",
          0.9435,
          "bonus_exp_coupon_group",
        ),
      },
      {
        now: 4_000,
        match: makeMatch(36, luckBox, "strong", 0.9449, "union_luck_group"),
      },
      {
        now: 6_000,
        match: makeMatch(
          34,
          { ...BOX, x: BOX.x + 144, col: 3 },
          "strong",
          0.9428,
          "exp_multiplier_coupon_group",
        ),
      },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [step.match],
        boxes: [bonusBox, luckBox, wealthBox],
        now: step.now,
      });
    }

    expect(
      state.expiryClusters.every((cluster) => cluster.confirmedAt === null),
    ).toBe(true);
    expect(state.tracks).toHaveLength(0);
  });

  it("alerts cluster-promoted tracks at the configured lead time", () => {
    const boxA = BOX;
    const boxB = { ...BOX, x: BOX.x + 48, col: 1 };
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    for (const step of [
      {
        now: 0,
        match: makeMatch(59, boxA, "strong", 0.98, "union_wealth_group"),
      },
      {
        now: 1_000,
        match: makeMatch(58, boxB, "strong", 0.98, "bonus_exp_coupon_group"),
      },
      {
        now: 3_000,
        match: makeMatch(56, boxA, "strong", 0.98, "union_wealth_group"),
      },
      {
        now: 4_000,
        match: makeMatch(55, boxB, "strong", 0.98, "bonus_exp_coupon_group"),
      },
    ]) {
      state = reconcileBuffExpiryTracks({
        previousTracks: state.tracks,
        previousPendingTracks: state.pendingTracks,
        previousTemporalCandidateTracks: state.temporalCandidateTracks,
        previousExpiryClusters: state.expiryClusters,
        acceptedMatches: [step.match],
        boxes: [boxA, boxB],
        now: step.now,
      });
    }

    expect(state.tracks.every((track) => track.expiresAt === 59_000)).toBe(
      true,
    );
    expect(
      markDueBuffExpiryTracksAlerted({
        tracks: state.tracks,
        now: 29_000,
        alertLeadSeconds: 30,
      }).shouldAlert,
    ).toBe(true);
    expect(
      markDueBuffExpiryTracksAlerted({
        tracks: state.tracks,
        now: 44_000,
        alertLeadSeconds: 15,
      }).shouldAlert,
    ).toBe(true);
  });

  it("alerts independently for mixed 10, 20, and 30 minute buff cycles", () => {
    const alertLeadSeconds = 30;
    let state: RuntimeTestState = {
      tracks: [],
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [],
    };

    state = confirmBuffExpiryTrack({
      state,
      buffId: "ten-minute-buff",
      box: BOX,
      firstSeenAt: 10 * 60_000 - 50_000,
    });

    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0]).toMatchObject({
      buffId: "ten-minute-buff",
      expiresAt: 10 * 60_000,
    });

    const tenMinuteAlert = markDueBuffExpiryTracksAlerted({
      tracks: state.tracks,
      now: 10 * 60_000 - alertLeadSeconds * 1000,
      alertLeadSeconds,
    });

    expect(tenMinuteAlert.shouldAlert).toBe(true);
    expect(tenMinuteAlert.tracks).toHaveLength(1);
    expect(tenMinuteAlert.tracks[0]).toMatchObject({
      buffId: "ten-minute-buff",
      alertedAt: 10 * 60_000 - alertLeadSeconds * 1000,
    });

    state = confirmBuffExpiryTrack({
      state: {
        tracks: tenMinuteAlert.tracks,
        pendingTracks: state.pendingTracks,
        temporalCandidateTracks: state.temporalCandidateTracks,
        expiryClusters: state.expiryClusters,
      },
      buffId: "twenty-minute-buff",
      box: { ...BOX, x: BOX.x + 48 },
      firstSeenAt: 20 * 60_000 - 50_000,
    });

    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0]).toMatchObject({
      buffId: "twenty-minute-buff",
      expiresAt: 20 * 60_000,
      alertedAt: null,
    });

    const twentyMinuteAlert = markDueBuffExpiryTracksAlerted({
      tracks: state.tracks,
      now: 20 * 60_000 - alertLeadSeconds * 1000,
      alertLeadSeconds,
    });

    expect(twentyMinuteAlert.shouldAlert).toBe(true);
    expect(twentyMinuteAlert.tracks).toHaveLength(1);
    expect(twentyMinuteAlert.tracks[0]).toMatchObject({
      buffId: "twenty-minute-buff",
      alertedAt: 20 * 60_000 - alertLeadSeconds * 1000,
    });

    state = confirmBuffExpiryTrack({
      state: {
        tracks: twentyMinuteAlert.tracks,
        pendingTracks: state.pendingTracks,
        temporalCandidateTracks: state.temporalCandidateTracks,
        expiryClusters: state.expiryClusters,
      },
      buffId: "thirty-minute-buff",
      box: { ...BOX, x: BOX.x + 96 },
      firstSeenAt: 30 * 60_000 - 50_000,
    });

    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0]).toMatchObject({
      buffId: "thirty-minute-buff",
      expiresAt: 30 * 60_000,
      alertedAt: null,
    });

    const thirtyMinuteAlert = markDueBuffExpiryTracksAlerted({
      tracks: state.tracks,
      now: 30 * 60_000 - alertLeadSeconds * 1000,
      alertLeadSeconds,
    });

    expect(thirtyMinuteAlert.shouldAlert).toBe(true);
    expect(thirtyMinuteAlert.tracks).toHaveLength(1);
    expect(thirtyMinuteAlert.tracks[0]).toMatchObject({
      buffId: "thirty-minute-buff",
      alertedAt: 30 * 60_000 - alertLeadSeconds * 1000,
    });
  });
});
