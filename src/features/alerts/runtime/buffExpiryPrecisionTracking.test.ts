import { describe, expect, it } from "vitest";
import { reconcileBuffExpiryPrecisionTracks } from "./buffExpiryPrecisionTracking";
import type {
  BuffExpiryPrecisionBestGroupCandidate,
  BuffExpiryPrecisionCountdownObservation,
  BuffExpiryPrecisionIconObservation,
  BuffExpiryPrecisionTargetGroup,
} from "../../../runtime/buff-expiry/analysis/buffExpiryPrecisionAnalysisRuntime";

describe("buffExpiryPrecisionTracking", () => {
  it("keeps a single accepted observation pending instead of confirming a track", () => {
    const result = reconcileBuffExpiryPrecisionTracks({
      previousTracks: [],
      previousPendingTracks: [],
      observations: [makeObservation("unionWealth", 41, 0)],
      bestByGroup: [],
      now: 1_000,
    });

    expect(result.tracks).toEqual([]);
    expect(result.pendingTracks).toHaveLength(1);
    expect(result.confirmationCandidateCount).toBe(1);
  });

  it("keeps two accepted countdown observations pending instead of confirming too early", () => {
    const result = reconcileBuffExpiryPrecisionSequence("unionWealth", [41, 40]);

    expect(result.pendingTracks).toHaveLength(1);
    expect(result.tracks).toEqual([]);
  });

  it("keeps five accepted countdown observations pending when the time span is still too short", () => {
    const result = reconcileBuffExpiryPrecisionSequence("unionWealth", [41, 40, 39, 38, 37]);

    expect(result.pendingTracks).toHaveLength(1);
    expect(result.tracks).toEqual([]);
  });

  it("confirms a group after multiple accepted countdown observations with a stable end time", () => {
    const result = reconcileBuffExpiryPrecisionSequence("unionWealth", [42, 41, 40, 39, 38, 37]);

    expect(result.pendingTracks).toEqual([]);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      buffId: "next:unionWealth",
      name: "유니온의 부",
      detectedSeconds: 37,
      expiresAt: 43_000,
      lastSeenAt: 6_000,
    });
  });

  it("confirms a gapped countdown flow when reads still align with elapsed time", () => {
    const result = reconcileBuffExpiryPrecisionTimedSequence("unionLuck", [
      { seconds: 41, now: 1_000 },
      { seconds: 36, now: 6_000 },
      { seconds: 32, now: 10_000 },
      { seconds: 31, now: 11_000 },
      { seconds: 30, now: 12_000 },
      { seconds: 29, now: 13_000 },
    ]);

    expect(result.pendingTracks).toEqual([]);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      buffId: "next:unionLuck",
      detectedSeconds: 29,
      expiresAt: 42_000,
      lastSeenAt: 13_000,
    });
  });

  it("confirms after five readings when four inliers point to the same expiry", () => {
    const result = reconcileBuffExpiryPrecisionTimedSequence("potion", [
      { seconds: 41, now: 1_000 },
      { seconds: 40, now: 2_000 },
      { seconds: 22, now: 3_000 },
      { seconds: 37, now: 5_000 },
      { seconds: 36, now: 6_000 },
    ]);

    expect(result.pendingTracks).toEqual([]);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      buffId: "next:potion",
      detectedSeconds: 36,
      expiresAt: 42_000,
      lastSeenAt: 6_000,
    });
  });

  it("tracks adjacent potion observations as separate simultaneous targets", () => {
    const result = [42, 41, 40, 39, 38, 37].reduce(
      (previous, seconds, index) =>
        reconcileBuffExpiryPrecisionTracks({
          previousTracks: previous.tracks,
          previousPendingTracks: previous.pendingTracks,
          observations: [
            makeObservation("potion", seconds, 0),
            makeObservation("potion", seconds, 1),
          ],
          bestByGroup: [],
          now: (index + 1) * 1_000,
        }),
      {
        tracks: [],
        pendingTracks: [],
        confirmationCandidateCount: 0,
        confirmedTransitions: [],
      } as ReturnType<typeof reconcileBuffExpiryPrecisionTracks>,
    );

    expect(result.pendingTracks).toEqual([]);
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks.map((track) => track.box.col)).toEqual([0, 1]);
    expect(result.tracks.every((track) => track.buffId === "next:potion")).toBe(true);
  });

  it("stores the latest normalized icon on a confirmed track", () => {
    const result = [42, 41, 40, 39, 38, 37].reduce(
      (previous, seconds, index) =>
        reconcileBuffExpiryPrecisionTracks({
          previousTracks: previous.tracks,
          previousPendingTracks: previous.pendingTracks,
          observations: [makeObservation("unionWealth", seconds, 0)],
          bestByGroup: [],
          now: (index + 1) * 1_000,
          boxes: [
            {
              x: 100,
              y: 40,
              width: 32,
              height: 32,
              side: 32,
              row: 0,
              col: 0,
              confidence: 1,
            },
          ],
          boxPreviewUrls: {
            "100:40:32:32": `data:image/png;base64,icon-${index + 1}`,
          },
        }),
      {
        tracks: [],
        pendingTracks: [],
        confirmationCandidateCount: 0,
        confirmedTransitions: [],
      } as ReturnType<typeof reconcileBuffExpiryPrecisionTracks>,
    );

    expect(result.tracks[0]?.normalizedIconDataUrl).toBe("data:image/png;base64,icon-6");
  });

  it("does not confirm a track when repeated countdown reads do not actually decrease", () => {
    const result = reconcileBuffExpiryPrecisionSequence("unionWealth", [46, 46, 46, 46, 46, 46]);

    expect(result.tracks).toEqual([]);
    expect(result.pendingTracks).toHaveLength(1);
  });

  it("rejects fca41dd8-style sticky false reads that do not form a linear countdown", () => {
    const result = reconcileBuffExpiryPrecisionTimedSequence("unionWealth", [
      { seconds: 54, now: 1_000 },
      { seconds: 48, now: 2_000 },
      { seconds: 48, now: 3_000 },
      { seconds: 48, now: 4_000 },
      { seconds: 46, now: 5_000 },
      { seconds: 45, now: 6_000 },
      { seconds: 44, now: 7_000 },
    ]);

    expect(result.tracks).toEqual([]);
    expect(result.pendingTracks).toHaveLength(1);
  });

  it("rejects locally impossible countdown drops even when the expiry estimate is stable", () => {
    const result = reconcileBuffExpiryPrecisionTimedSequence("unionWealth", [
      { seconds: 42, now: 1_000 },
      { seconds: 39, now: 2_000 },
      { seconds: 39, now: 3_000 },
      { seconds: 38, now: 4_000 },
      { seconds: 37, now: 5_000 },
      { seconds: 36, now: 6_000 },
    ]);

    expect(result.tracks).toEqual([]);
    expect(result.pendingTracks).toHaveLength(1);
  });

  it("ignores one countdown outlier while confirming a stable expiry flow", () => {
    const result = reconcileBuffExpiryPrecisionSequence("potion", [41, 40, 22, 38, 37, 36], 0);

    expect(result.pendingTracks).toEqual([]);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      buffId: "next:potion",
      detectedSeconds: 36,
      expiresAt: 42_000,
      lastSeenAt: 6_000,
    });
  });

  it("accepts a bundle-approved observation without applying the retired global score scale", () => {
    const first = reconcileBuffExpiryPrecisionTracks({
      previousTracks: [],
      previousPendingTracks: [],
      observations: [makeObservation("potion", 41, 0, "seconds", -0.2)],
      bestByGroup: [],
      now: 1_000,
    });
    const second = reconcileBuffExpiryPrecisionTracks({
      previousTracks: first.tracks,
      previousPendingTracks: first.pendingTracks,
      observations: [makeObservation("potion", 40, 0, "seconds", -0.1)],
      bestByGroup: [],
      now: 2_000,
    });

    expect(first.pendingTracks).toHaveLength(1);
    expect(second.pendingTracks).toHaveLength(1);
    expect(second.tracks).toEqual([]);
    expect(second.confirmationCandidateCount).toBe(1);
  });

  it("does not accept exact countdown observations when countdown confidence is low or missing", () => {
    const low = reconcileBuffExpiryPrecisionTracks({
      previousTracks: [],
      previousPendingTracks: [],
      observations: [makeObservation("potion", 41, 0, "seconds", 2, 1, "low")],
      bestByGroup: [],
      now: 1_000,
    });
    const missing = reconcileBuffExpiryPrecisionTracks({
      previousTracks: low.tracks,
      previousPendingTracks: low.pendingTracks,
      observations: [makeObservation("potion", 40, 0, "seconds", 2, 1, "missing")],
      bestByGroup: [],
      now: 2_000,
    });

    expect(low.pendingTracks).toEqual([]);
    expect(missing.pendingTracks).toEqual([]);
    expect(missing.tracks).toEqual([]);
    expect(missing.confirmationCandidateCount).toBe(0);
  });

  it("does not create pending tracks from bundle-rejected union wealth candidates", () => {
    const result = [
      { seconds: 24, score: 0.526, margin: 0.074 },
      { seconds: 23, score: 0.816, margin: 0.128 },
      { seconds: 22, score: 0.492, margin: 0.04 },
      { seconds: 21, score: 0.557, margin: 0.105 },
      { seconds: 20, score: 0.68, margin: 0.228 },
      { seconds: 19, score: 0.464, margin: 0.012 },
    ].reduce(
      (previous, observation, index) =>
        reconcileBuffExpiryPrecisionTracks({
          previousTracks: previous.tracks,
          previousPendingTracks: previous.pendingTracks,
          observations: [
            makeRejectedObservation(
              "unionWealth",
              observation.seconds,
              4,
              "seconds",
              observation.score,
              observation.margin,
            ),
          ],
          bestByGroup: [],
          now: (index + 1) * 1_000,
        }),
      {
        tracks: [],
        pendingTracks: [],
        confirmationCandidateCount: 0,
        confirmedTransitions: [],
      } as ReturnType<typeof reconcileBuffExpiryPrecisionTracks>,
    );

    expect(result.tracks).toEqual([]);
    expect(result.pendingTracks).toEqual([]);
    expect(result.confirmationCandidateCount).toBe(0);
  });

  it("still confirms a high-confidence true union wealth flow", () => {
    const result = [42, 41, 40, 39, 38, 37].reduce(
      (previous, seconds, index) =>
        reconcileBuffExpiryPrecisionTracks({
          previousTracks: previous.tracks,
          previousPendingTracks: previous.pendingTracks,
          observations: [makeObservation("unionWealth", seconds, 7, "seconds", 3.097, 2.645)],
          bestByGroup: [],
          now: (index + 1) * 1_000,
        }),
      {
        tracks: [],
        pendingTracks: [],
        confirmationCandidateCount: 0,
        confirmedTransitions: [],
      } as ReturnType<typeof reconcileBuffExpiryPrecisionTracks>,
    );

    expect(result.pendingTracks).toEqual([]);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      buffId: "next:unionWealth",
      name: "유니온의 부",
      detectedSeconds: 37,
      expiresAt: 43_000,
    });
  });

  it("does not create a new track from a best-by-group near miss", () => {
    const result = reconcileBuffExpiryPrecisionTracks({
      previousTracks: [],
      previousPendingTracks: [],
      observations: [],
      bestByGroup: [makeBestCandidate("unionLuck", 38, 0, false)],
      now: 1_000,
    });

    expect(result.tracks).toEqual([]);
    expect(result.pendingTracks).toEqual([]);
  });

  it("does not use a rejected best-by-group candidate to keep a confirmed track alive", () => {
    const withTrack = reconcileBuffExpiryPrecisionSequence("unionLuck", [42, 41, 40, 39, 38, 37]);
    const assisted = reconcileBuffExpiryPrecisionTracks({
      previousTracks: withTrack.tracks,
      previousPendingTracks: withTrack.pendingTracks,
      observations: [],
      bestByGroup: [makeBestCandidate("unionLuck", 36, 0, false, -0.1)],
      now: 7_000,
    });

    expect(assisted.tracks).toHaveLength(1);
    expect(assisted.tracks[0].lastSeenAt).toBe(6_000);
    expect(assisted.tracks[0].detectedSeconds).toBe(37);
  });

  it("uses an accepted best-by-group candidate to refresh a compatible confirmed track", () => {
    const withTrack = reconcileBuffExpiryPrecisionSequence("unionLuck", [42, 41, 40, 39, 38, 37]);
    const assisted = reconcileBuffExpiryPrecisionTracks({
      previousTracks: withTrack.tracks,
      previousPendingTracks: withTrack.pendingTracks,
      observations: [],
      bestByGroup: [makeBestCandidate("unionLuck", 36, 0, true)],
      now: 7_000,
    });

    expect(assisted.tracks).toHaveLength(1);
    expect(assisted.tracks[0].lastSeenAt).toBe(7_000);
    expect(assisted.tracks[0].detectedSeconds).toBe(36);
  });

  it("keeps a confirmed track alive until its predicted expiry even when later frames miss it", () => {
    const withTrack = reconcileBuffExpiryPrecisionSequence("unionWealth", [42, 41, 40, 39, 38, 37]);
    const missedFrames = reconcileBuffExpiryPrecisionTracks({
      previousTracks: withTrack.tracks,
      previousPendingTracks: withTrack.pendingTracks,
      observations: [],
      bestByGroup: [],
      now: 20_000,
    });

    expect(missedFrames.tracks).toHaveLength(1);
    expect(missedFrames.tracks[0]).toMatchObject({
      buffId: "next:unionWealth",
      expiresAt: 43_000,
      lastSeenAt: 6_000,
    });
  });

  it("drops an unalerted single-slot track when the same group returns as an upper-row target", () => {
    const withTrack = reconcileBuffExpiryPrecisionSequence("unionLuck", [42, 41, 40, 39, 38, 37]);
    const upperRowsExcluded = reconcileBuffExpiryPrecisionTracks({
      previousTracks: withTrack.tracks,
      previousPendingTracks: withTrack.pendingTracks,
      observations: [makeObservation("unionLuck", 36, 0)],
      bestByGroup: [makeUpperRowsExcludedBestCandidate("unionLuck", 36, 0)],
      now: 7_000,
    });

    expect(upperRowsExcluded.tracks).toEqual([]);
    expect(upperRowsExcluded.pendingTracks).toEqual([]);
    expect(upperRowsExcluded.confirmationCandidateCount).toBe(0);
  });

  it("drops pending single-slot observations when the same group returns as an upper-row target", () => {
    const pending = reconcileBuffExpiryPrecisionSequence("unionLuck", [42, 41, 40, 39]);
    const upperRowsExcluded = reconcileBuffExpiryPrecisionTracks({
      previousTracks: pending.tracks,
      previousPendingTracks: pending.pendingTracks,
      observations: [makeObservation("unionLuck", 38, 0)],
      bestByGroup: [makeUpperRowsExcludedBestCandidate("unionLuck", 38, 0)],
      now: 5_000,
    });

    expect(upperRowsExcluded.tracks).toEqual([]);
    expect(upperRowsExcluded.pendingTracks).toEqual([]);
    expect(upperRowsExcluded.confirmationCandidateCount).toBe(0);
  });

  it("drops an unalerted single-slot track when the same group is superseded by a lower row target", () => {
    const withTrack = reconcileBuffExpiryPrecisionSequence("expCoupon", [42, 41, 40, 39, 38, 37]);
    const bottomFirstExcluded = reconcileBuffExpiryPrecisionTracks({
      previousTracks: withTrack.tracks,
      previousPendingTracks: withTrack.pendingTracks,
      observations: [makeObservation("expCoupon", 36, 0)],
      bestByGroup: [makeBottomFirstExcludedBestCandidate("expCoupon", 36, 0)],
      now: 7_000,
    });

    expect(bottomFirstExcluded.tracks).toEqual([]);
    expect(bottomFirstExcluded.pendingTracks).toEqual([]);
    expect(bottomFirstExcluded.confirmationCandidateCount).toBe(0);
  });

  it("keeps an already alerted track when the same group later appears in an upper row", () => {
    const alerted = makeAlertedTrack("unionLuck", 0, 6_000, 43_000);
    const result = reconcileBuffExpiryPrecisionTracks({
      previousTracks: [alerted],
      previousPendingTracks: [],
      observations: [makeObservation("unionLuck", 36, 0)],
      bestByGroup: [makeUpperRowsExcludedBestCandidate("unionLuck", 36, 0)],
      now: 7_000,
    });

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      buffId: "next:unionLuck",
      alertedAt: 7_000,
    });
    expect(result.pendingTracks).toEqual([]);
  });

  it("drops an unalerted confirmed track after its predicted expiry grace window", () => {
    const result = reconcileBuffExpiryPrecisionTracks({
      previousTracks: [
        {
          ...makeTrack("unionWealth", 0, 2_000),
          detectedSeconds: 40,
          detectedAt: 2_000,
          expiresAt: 42_000,
          lastSeenAt: 2_000,
          alertedAt: null,
        },
      ],
      previousPendingTracks: [],
      observations: [],
      bestByGroup: [],
      now: 52_001,
    });

    expect(result.tracks).toEqual([]);
  });

  it("prunes stale pending observations before deciding whether a track can be confirmed", () => {
    const stalePending = reconcileBuffExpiryPrecisionSequence("unionWealth", [42, 41, 40, 39, 38]);
    const afterGap = reconcileBuffExpiryPrecisionTracks({
      previousTracks: stalePending.tracks,
      previousPendingTracks: stalePending.pendingTracks,
      observations: [makeObservation("unionWealth", 37, 0)],
      bestByGroup: [],
      now: 40_000,
    });

    expect(afterGap.tracks).toEqual([]);
    expect(afterGap.pendingTracks).toHaveLength(1);
    expect(afterGap.pendingTracks[0].observations).toHaveLength(1);
    expect(afterGap.pendingTracks[0].observations[0]).toMatchObject({
      seconds: 37,
      observedAt: 40_000,
    });
  });

  it("does not overwrite an active confirmed track or create a pending track from a large expiry drift", () => {
    const previousTrack = {
      ...makeTrack("unionWealth", 0, 2_000),
      detectedSeconds: 40,
      detectedAt: 2_000,
      expiresAt: 42_000,
      lastSeenAt: 2_000,
      alertedAt: null,
    };
    const result = reconcileBuffExpiryPrecisionTracks({
      previousTracks: [previousTrack],
      previousPendingTracks: [],
      observations: [makeObservation("unionWealth", 59, 0)],
      bestByGroup: [],
      now: 5_000,
    });

    expect(result.pendingTracks).toEqual([]);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      detectedSeconds: 40,
      expiresAt: 42_000,
      lastSeenAt: 2_000,
    });
  });

  it("does not treat long minute-second countdowns as confirmation candidates", () => {
    const result = reconcileBuffExpiryPrecisionTracks({
      previousTracks: [],
      previousPendingTracks: [],
      observations: [makeObservation("expCoupon", 579, 1, "minutes-seconds")],
      bestByGroup: [],
      now: 1_000,
    });

    expect(result.tracks).toEqual([]);
    expect(result.pendingTracks).toEqual([]);
    expect(result.confirmationCandidateCount).toBe(0);
  });

  it("caps potion tracks at two and single-slot groups at one", () => {
    const result = reconcileBuffExpiryPrecisionTracks({
      previousTracks: [
        makeTrack("potion", 0, 1_000),
        makeTrack("potion", 1, 2_000),
        makeTrack("potion", 2, 3_000),
        makeTrack("expCoupon", 3, 1_000),
        makeTrack("expCoupon", 4, 2_000),
      ],
      previousPendingTracks: [],
      observations: [],
      bestByGroup: [],
      now: 3_000,
    });

    expect(result.tracks.filter((track) => track.buffId === "next:potion")).toHaveLength(2);
    expect(result.tracks.filter((track) => track.buffId === "next:expCoupon")).toHaveLength(1);
  });

  it("suppresses a single-slot group after an active alerted track until expiry", () => {
    const result = reconcileBuffExpiryPrecisionTracks({
      previousTracks: [makeAlertedTrack("unionWealth", 0, 6_000, 43_000)],
      previousPendingTracks: [],
      observations: [makeObservation("unionWealth", 41, 3)],
      bestByGroup: [],
      now: 20_000,
    });

    expect(result.tracks).toHaveLength(1);
    expect(result.pendingTracks).toEqual([]);
    expect(result.confirmationCandidateCount).toBe(0);
  });

  it("removes existing pending candidates that are now suppressed by an active alerted same-slot track", () => {
    const stalePending = reconcileBuffExpiryPrecisionTracks({
      previousTracks: [],
      previousPendingTracks: [],
      observations: [makeObservation("unionWealth", 41, 0)],
      bestByGroup: [],
      now: 1_000,
    });
    const suppressed = reconcileBuffExpiryPrecisionTracks({
      previousTracks: [makeAlertedTrack("unionWealth", 0, 6_000, 43_000)],
      previousPendingTracks: stalePending.pendingTracks,
      observations: [],
      bestByGroup: [],
      now: 20_000,
    });

    expect(suppressed.tracks).toHaveLength(1);
    expect(suppressed.pendingTracks).toEqual([]);
    expect(suppressed.confirmationCandidateCount).toBe(0);
  });

  it("keeps an active alerted track ahead of newer false tracks when applying group caps", () => {
    const result = reconcileBuffExpiryPrecisionTracks({
      previousTracks: [
        makeAlertedTrack("unionWealth", 0, 6_000, 43_000),
        {
          ...makeTrack("unionWealth", 3, 19_000),
          detectedSeconds: 41,
          expiresAt: 60_000,
          lastSeenAt: 19_000,
        },
      ],
      previousPendingTracks: [],
      observations: [],
      bestByGroup: [],
      now: 20_000,
    });

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      buffId: "next:unionWealth",
      box: expect.objectContaining({ col: 0 }),
      alertedAt: 7_000,
    });
  });

  it("allows a second potion slot while one active alerted potion remains", () => {
    const result = reconcileBuffExpiryPrecisionTracks({
      previousTracks: [makeAlertedTrack("potion", 0, 6_000, 43_000)],
      previousPendingTracks: [],
      observations: [makeObservation("potion", 41, 2)],
      bestByGroup: [],
      now: 20_000,
    });

    expect(result.tracks).toHaveLength(1);
    expect(result.pendingTracks).toHaveLength(1);
    expect(result.pendingTracks[0]).toMatchObject({
      buffId: "next:potion",
      box: expect.objectContaining({ col: 2 }),
    });
  });

  it("suppresses potion candidates once both potion slots have active alerted tracks", () => {
    const result = reconcileBuffExpiryPrecisionTracks({
      previousTracks: [
        makeAlertedTrack("potion", 0, 6_000, 43_000),
        makeAlertedTrack("potion", 2, 7_000, 44_000),
      ],
      previousPendingTracks: [],
      observations: [makeObservation("potion", 41, 4)],
      bestByGroup: [],
      now: 20_000,
    });

    expect(result.tracks).toHaveLength(2);
    expect(result.pendingTracks).toEqual([]);
    expect(result.confirmationCandidateCount).toBe(0);
  });

  it("allows a group to be reacquired after an alerted track actually expires", () => {
    const result = reconcileBuffExpiryPrecisionTracks({
      previousTracks: [makeAlertedTrack("unionWealth", 0, 6_000, 42_000)],
      previousPendingTracks: [],
      observations: [makeObservation("unionWealth", 41, 0)],
      bestByGroup: [],
      now: 43_000,
    });

    expect(result.tracks).toHaveLength(1);
    expect(result.pendingTracks).toHaveLength(1);
    expect(result.pendingTracks[0]).toMatchObject({
      buffId: "next:unionWealth",
      box: expect.objectContaining({ col: 0 }),
    });
  });
});

function reconcileBuffExpiryPrecisionSequence(
  group: BuffExpiryPrecisionTargetGroup,
  secondsList: number[],
  col = 0,
) {
  return secondsList.reduce(
    (previous, seconds, index) =>
      reconcileBuffExpiryPrecisionTracks({
        previousTracks: previous.tracks,
        previousPendingTracks: previous.pendingTracks,
        observations: [makeObservation(group, seconds, col)],
        bestByGroup: [],
        now: (index + 1) * 1_000,
      }),
    {
      tracks: [],
      pendingTracks: [],
      confirmationCandidateCount: 0,
      confirmedTransitions: [],
    } as ReturnType<typeof reconcileBuffExpiryPrecisionTracks>,
  );
}

function reconcileBuffExpiryPrecisionTimedSequence(
  group: BuffExpiryPrecisionTargetGroup,
  observations: Array<{ seconds: number; now: number }>,
  col = 0,
) {
  return observations.reduce(
    (previous, observation) =>
      reconcileBuffExpiryPrecisionTracks({
        previousTracks: previous.tracks,
        previousPendingTracks: previous.pendingTracks,
        observations: [makeObservation(group, observation.seconds, col)],
        bestByGroup: [],
        now: observation.now,
      }),
    {
      tracks: [],
      pendingTracks: [],
      confirmationCandidateCount: 0,
      confirmedTransitions: [],
    } as ReturnType<typeof reconcileBuffExpiryPrecisionTracks>,
  );
}

function makeObservation(
  group: BuffExpiryPrecisionTargetGroup,
  seconds: number,
  col: number,
  format: "seconds" | "minutes-seconds" = "seconds",
  score = 2,
  margin = 1,
  status: BuffExpiryPrecisionCountdownObservation["status"] = "high",
): BuffExpiryPrecisionIconObservation {
  return {
    id: `slot:${col}`,
    boxIndex: col,
    box: makeNextBox(col),
    identity: {
      kind: "target",
      group,
      score,
      margin,
      decisionReason: "target_accepted",
      bestTargetName: group,
      bestExcludedName: null,
    },
    countdown: makeCountdown(seconds, format, status),
  };
}

function makeRejectedObservation(
  group: BuffExpiryPrecisionTargetGroup,
  seconds: number,
  col: number,
  format: "seconds" | "minutes-seconds" = "seconds",
  score = 0,
  margin = -1,
): BuffExpiryPrecisionIconObservation {
  const observation = makeObservation(group, seconds, col, format, score, margin);
  return {
    ...observation,
    identity: {
      ...observation.identity,
      kind: "unknown",
      group: null,
      decisionReason: "base_below_threshold",
      bestTargetName: null,
    },
  };
}

function makeBestCandidate(
  group: BuffExpiryPrecisionTargetGroup,
  seconds: number,
  col: number,
  accepted: boolean,
  margin = 0.5,
): BuffExpiryPrecisionBestGroupCandidate {
  return {
    group,
    boxIndex: col,
    box: makeNextBox(col),
    accepted,
    matcherAccepted: accepted,
    winningGroup: accepted ? group : null,
    score: 1.5,
    margin,
    decisionReason: accepted ? "target_accepted" : "base_below_threshold",
    countdown: makeCountdown(seconds),
  };
}

function makeUpperRowsExcludedBestCandidate(
  group: BuffExpiryPrecisionTargetGroup,
  seconds: number,
  col: number,
): BuffExpiryPrecisionBestGroupCandidate {
  return {
    ...makeBestCandidate(group, seconds, col, false, 1.4),
    matcherAccepted: true,
    score: 3.2,
    decisionReason: "upper_rows_target_excluded:target_accepted",
    countdown: null,
  };
}

function makeBottomFirstExcludedBestCandidate(
  group: BuffExpiryPrecisionTargetGroup,
  seconds: number,
  col: number,
): BuffExpiryPrecisionBestGroupCandidate {
  return {
    ...makeUpperRowsExcludedBestCandidate(group, seconds, col),
    decisionReason: "bottom_first_target_excluded:target_accepted",
  };
}

function makeCountdown(
  seconds: number,
  format: "seconds" | "minutes-seconds" = "seconds",
  status: BuffExpiryPrecisionCountdownObservation["status"] = "high",
): BuffExpiryPrecisionCountdownObservation {
  return {
    kind: "exact",
    text: format === "minutes-seconds"
      ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
      : String(seconds),
    totalSeconds: seconds,
    format,
    textRegion: "center",
    confidence: 0.95,
    status,
    routerTarget: "center",
    routerConfidence: 0.95,
    routerStatus: "ready",
  };
}

function makeNextBox(col: number) {
  return {
    x: 100 + col * 34,
    y: 40,
    size: 32,
    row: 0,
    col,
    confidence: 0.9,
    score: 1,
  };
}

function makeTrack(group: BuffExpiryPrecisionTargetGroup, col: number, lastSeenAt: number) {
  return {
    id: `next:${group}:r0:c${col}`,
    buffId: `next:${group}`,
    name: group,
    box: {
      x: 100 + col * 34,
      y: 40,
      width: 32,
      height: 32,
      side: 32,
      row: 0,
      col,
      confidence: 1,
    },
    detectedSeconds: 40,
    detectedAt: lastSeenAt,
    expiresAt: lastSeenAt + 40_000,
    lastSeenAt,
    alertedAt: null,
    score: lastSeenAt,
  };
}

function makeAlertedTrack(
  group: BuffExpiryPrecisionTargetGroup,
  col: number,
  lastSeenAt: number,
  expiresAt: number,
) {
  return {
    ...makeTrack(group, col, lastSeenAt),
    detectedSeconds: Math.max(0, Math.round((expiresAt - lastSeenAt) / 1000)),
    expiresAt,
    alertedAt: lastSeenAt + 1_000,
  };
}
