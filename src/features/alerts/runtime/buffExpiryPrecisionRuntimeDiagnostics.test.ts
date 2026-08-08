import { describe, expect, it } from "vitest";
import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryBox,
  BuffExpiryExpiryCluster,
  BuffExpiryIconEvidence,
  BuffExpiryPendingTrack,
  BuffExpiryRejectedMatch,
  BuffExpiryRuntimeTraceFrame,
  BuffExpiryTemporalCandidateMatch,
  BuffExpiryTrackedBuff,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import {
  appendBuffExpiryAlertDecision,
  appendBuffExpiryDebugDetectionFrame,
  appendBuffExpiryIconEvidence,
  appendBuffExpiryRuntimeTraceFrame,
  compactBuffExpiryAcceptedMatch,
  compactBuffExpiryExpiryCluster,
  compactBuffExpiryPrecisionRuntimeFrame,
  compactBuffExpiryRejectedMatch,
  createBuffExpiryDebugDetectionFrame,
  getBuffExpiryAlertedTrackIds,
  getBuffExpiryConfirmationCandidateCount,
  preserveBuffExpiryPrecisionAlertMarkers,
  pruneBuffExpiryIconEvidence,
} from "./buffExpiryPrecisionRuntimeDiagnostics";

const BOX: BuffExpiryBox = {
  x: 10,
  y: 20,
  width: 34,
  height: 34,
  confidence: 0.95,
  side: 34,
};

function makeMatch(
  overrides: Partial<BuffExpiryAcceptedMatch> = {},
): BuffExpiryAcceptedMatch {
  return {
    box: BOX,
    buffId: "union_wealth_i",
    name: "유니온의 부",
    seconds: 45,
    score: 0.97,
    buffMargin: 0.2,
    secondMargin: 0.2,
    reason: "accepted",
    strength: "strong",
    topMatches: [0, 1, 2, 3].map((index) => ({
      buffId: `candidate-${index}`,
      name: `candidate-${index}`,
      kind: "countdown",
      seconds: 45 - index,
      file: `candidate-${index}.png`,
      score: 0.9 - index * 0.01,
      distance: 0.1 + index * 0.01,
      timerPixels: 20,
      digitPixels: 10,
    })),
    ...overrides,
  };
}

function makeTemporalMatch(
  overrides: Partial<BuffExpiryTemporalCandidateMatch> = {},
): BuffExpiryTemporalCandidateMatch {
  return {
    ...makeMatch({
      reason: "temporal-low-score",
      strength: "weak",
      score: 0.9,
    }),
    ...overrides,
    reason: "temporal-low-score",
    strength: "weak",
  };
}

function makeRejectedMatch(overrides: Partial<BuffExpiryRejectedMatch> = {}): BuffExpiryRejectedMatch {
  return {
    box: { ...BOX, x: 50 },
    candidateBuffId: "mvp_exp_coupon_70",
    candidateName: "MVP 70% 추가 경험치 쿠폰",
    candidateSeconds: 33,
    score: 0.79,
    reason: "minute-label",
    topMatches: makeMatch().topMatches,
    ...overrides,
  };
}

function makeTrack(overrides: Partial<BuffExpiryTrackedBuff> = {}): BuffExpiryTrackedBuff {
  return {
    id: "track-1",
    buffId: "union_wealth_group",
    name: "유니온의 부",
    box: BOX,
    detectedSeconds: 45,
    detectedAt: 1_000,
    expiresAt: 46_000,
    lastSeenAt: 1_000,
    alertedAt: null,
    score: 0.96,
    ...overrides,
  };
}

function makePendingTrack(observations: BuffExpiryPendingTrack["observations"]): BuffExpiryPendingTrack {
  return {
    id: "pending-1",
    buffId: "union_wealth_group",
    name: "유니온의 부",
    box: BOX,
    firstSeenAt: observations[0]?.observedAt ?? 0,
    lastSeenAt: observations[observations.length - 1]?.observedAt ?? 0,
    observations,
    score: 0.9,
  };
}

function makeTemporalObservation(observedAt: number, seconds: number) {
  return {
    observedAt,
    seconds,
    score: 0.9,
    strength: "weak" as const,
    reason: "temporal-low-score",
  };
}

function makeCluster(overrides: Partial<BuffExpiryExpiryCluster> = {}): BuffExpiryExpiryCluster {
  const centerExpiresAt = 60_000;
  return {
    id: "cluster-1",
    firstSeenAt: 1_000,
    lastSeenAt: 7_000,
    centerExpiresAt,
    confirmedAt: null,
    observations: [0, 1, 2].map((index) => ({
      observedAt: 1_000 + index * 3_000,
      buffId: `buff-${index}`,
      name: `버프 ${index}`,
      slotKey: `slot-${index}`,
      seconds: 59 - index * 3,
      predictedExpiresAt: centerExpiresAt + index * 500,
      score: 0.9,
      strength: "weak",
      reason: "temporal-low-score",
      source: "temporal",
      box: { ...BOX, x: BOX.x + index * 40 },
    })),
    ...overrides,
  };
}

function makeRuntimeTraceFrame(sampledAt: number): BuffExpiryRuntimeTraceFrame {
  return {
    sampledAt,
    status: "waiting",
    boxCount: 0,
    acceptedMatchCount: 0,
    acceptedMatches: [],
    rejectedMatches: [],
    tracks: [],
    pendingTracks: [],
    shouldAlert: false,
    alertedTrackIds: [],
    unsupportedReason: null,
    performance: null,
  };
}

describe("buffExpiryPrecisionRuntimeDiagnostics", () => {
  it("keeps bounded debug, runtime trace, and alert decision histories", () => {
    const debugHistory = Array.from({ length: 13 }, (_, index) =>
      appendBuffExpiryDebugDetectionFrame([], {
        sampledAt: index,
        boxCount: 0,
        acceptedMatchCount: 0,
        boxes: [],
        performance: null,
      }),
    ).flat();
    expect(
      appendBuffExpiryDebugDetectionFrame(debugHistory, {
        sampledAt: 99,
        boxCount: 0,
        acceptedMatchCount: 0,
        boxes: [],
        performance: null,
      }).map((frame) => frame.sampledAt),
    ).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 99]);

    const traceHistory = Array.from({ length: 61 }, (_, index) =>
      makeRuntimeTraceFrame(index),
    );
    expect(
      appendBuffExpiryRuntimeTraceFrame(
        traceHistory,
        makeRuntimeTraceFrame(99),
      ).map((frame) => frame.sampledAt),
    ).toEqual([...Array.from({ length: 59 }, (_, index) => index + 2), 99]);

    const noDueDecision = {
      sampledAt: 1,
      alertLeadSeconds: 30,
      shouldAlert: false,
      reason: "no-due-tracks" as const,
      dueTracks: [],
      newAlertTrackIds: [],
      suppressedTrackIds: [],
      deferredTrackIds: [],
      markedTrackIds: [],
      dueGroupExpiresAt: null,
      nearestExistingAlertGroup: null,
    };
    expect(appendBuffExpiryAlertDecision([], noDueDecision)).toEqual([]);
    expect(
      appendBuffExpiryAlertDecision([], {
        ...noDueDecision,
        shouldAlert: true,
        reason: "new-alert-group",
      }),
    ).toHaveLength(1);
  });

  it("compacts precision engine runtime frames and trace matches", () => {
    const next = compactBuffExpiryPrecisionRuntimeFrame({
      boxes: [],
      icons: [],
      unsupported: false,
      unsupportedReason: null,
      performance: {
        totalMs: 1,
        detectMs: 1,
        boxCount: 0,
      },
      moduleVersions: {
        runtime: "runtime",
        parser: "parser",
        matcher: "matcher",
        matcherModel: "model",
        countdown: "countdown",
      },
      bestByGroup: [
        {
          group: "unionWealth",
          boxIndex: 0,
          box: { x: 0, y: 0, size: 32, row: 0, col: 0, confidence: 1, score: 1 },
          accepted: true,
          winningGroup: "unionWealth",
          score: 0.99,
          margin: 0.2,
          decisionReason: "accepted",
          countdown: {
            kind: "exact",
            text: "29",
            totalSeconds: 29,
            format: "seconds",
            textRegion: "center",
            confidence: 0.9,
            status: "high",
            routerTarget: "center",
            routerConfidence: 0.9,
            routerStatus: "ok",
          },
        },
      ],
      iconObservations: [
        {
          id: "target",
          boxIndex: 0,
          box: { x: 0, y: 0, size: 32, row: 0, col: 0, confidence: 1, score: 1 },
          identity: {
            kind: "target",
            group: "unionWealth",
            score: 0.99,
            margin: 0.2,
            decisionReason: "accepted",
            bestTargetName: "유니온의 부",
            bestExcludedName: null,
          },
          countdown: {
            kind: "exact",
            text: "29",
            totalSeconds: 29,
            format: "seconds",
            textRegion: "center",
            confidence: 0.9,
            status: "high",
            routerTarget: "center",
            routerConfidence: 0.9,
            routerStatus: "ok",
          },
        },
        {
          id: "unknown",
          boxIndex: 1,
          box: { x: 32, y: 0, size: 32, row: 0, col: 1, confidence: 1, score: 1 },
          identity: {
            kind: "unknown",
            group: null,
            score: 0.2,
            margin: 0,
            decisionReason: "unknown",
            bestTargetName: null,
            bestExcludedName: null,
          },
          countdown: null,
        },
      ],
    });

    expect(next).toMatchObject({
      targetObservationCount: 1,
      countdownObservationCount: 1,
      bestByGroup: [
        {
          group: "unionWealth",
          countdownText: "29",
          countdownSeconds: 29,
          countdownStatus: "high",
        },
      ],
      targetObservations: [
        {
          boxIndex: 0,
          group: "unionWealth",
          countdownText: "29",
          countdownSeconds: 29,
        },
      ],
    });

    expect(compactBuffExpiryAcceptedMatch(makeMatch()).topMatches).toHaveLength(3);
    expect(compactBuffExpiryRejectedMatch(makeRejectedMatch()).topMatches).toHaveLength(3);
    expect(compactBuffExpiryExpiryCluster(makeCluster())).toMatchObject({
      id: "cluster-1",
      observationCount: 3,
      inlierCount: 3,
      distinctSlotCount: 3,
      distinctBuffCount: 3,
    });
  });

  it("creates compact debug detection boxes with normalized previews first", () => {
    const accepted = makeMatch();
    const rejected = makeRejectedMatch({
      box: { ...BOX, x: 50 },
      topMatches: makeMatch().topMatches.slice(0, 2),
    });

    const frame = createBuffExpiryDebugDetectionFrame({
      sampledAt: 10_000,
      boxes: [BOX, rejected.box, { ...BOX, x: 90 }],
      acceptedMatches: [accepted],
      rejectedMatches: [rejected],
      normalizedBoxPreviewUrls: {
        "10:20:34:34": "data:normalized",
      },
      rawBoxPreviewUrls: {
        "10:20:34:34": "data:raw",
        "50:20:34:34": "data:rejected-raw",
      },
      performance: null,
      boxLimit: 2,
    });

    expect(frame).toMatchObject({
      sampledAt: 10_000,
      boxCount: 3,
      acceptedMatchCount: 1,
    });
    expect(frame.boxes).toHaveLength(2);
    expect(frame.boxes[0]).toMatchObject({
      previewDataUrl: "data:normalized",
      acceptedMatch: accepted,
      rejectedMatch: null,
      topMatches: accepted.topMatches,
    });
    expect(frame.boxes[1]).toMatchObject({
      previewDataUrl: "data:rejected-raw",
      acceptedMatch: null,
      rejectedMatch: rejected,
      topMatches: rejected.topMatches,
    });
  });

  it("derives alerted track ids for report diagnostics", () => {
    expect(getBuffExpiryAlertedTrackIds({
      tracks: [
        makeTrack({ id: "a", alertedAt: 20_000 }),
        makeTrack({ id: "b", alertedAt: 19_000 }),
      ],
      sampledAt: 20_000,
      shouldAlert: true,
    })).toEqual(["a"]);
    expect(getBuffExpiryAlertedTrackIds({
      tracks: [makeTrack({ id: "a", alertedAt: 20_000 })],
      sampledAt: 20_000,
      shouldAlert: false,
    })).toEqual([]);
  });

  it("stores accepted and diagnostic rejected icon evidence with compact top matches", () => {
    const accepted = makeMatch();
    const temporal = makeTemporalMatch({
      box: { ...BOX, x: 90 },
      buffId: "small_exp_accumulation_potion",
      name: "소형 경험축적의 비약",
      seconds: 42,
    });
    const rejected = makeRejectedMatch();

    const history = appendBuffExpiryIconEvidence({
      history: [],
      sampledAt: 10_000,
      acceptedMatches: [accepted],
      temporalCandidateMatches: [temporal],
      rejectedMatches: [
        rejected,
        makeRejectedMatch({
          box: { ...BOX, x: 130 },
          candidateBuffId: "unknown-buff",
          score: 0.99,
          reason: "low-score",
        }),
      ],
      previousTracks: [],
      tracks: [],
      alertedTrackIds: [],
      normalizedBoxPreviewUrls: {
        "10:20:34:34": "data:accepted",
        "50:20:34:34": "data:rejected",
        "90:20:34:34": "data:temporal",
      },
    });

    expect(history).toHaveLength(3);
    expect(history.map((entry) => entry.source)).toEqual(["accepted", "temporal", "near-miss"]);
    expect(history[0]).toMatchObject({
      buffId: "union_wealth_group",
      normalizedIconDataUrl: "data:accepted",
    });
    expect(history[1]).toMatchObject({
      buffId: "small_wealth_exp_potion_group",
      normalizedIconDataUrl: "data:temporal",
    });
    expect(history[2]).toMatchObject({
      buffId: "bonus_exp_coupon_group",
      reason: "minute-label",
      normalizedIconDataUrl: "data:rejected",
    });
    expect(history[0].topMatches).toHaveLength(3);
  });

  it("throttles repeated non-terminal icon evidence but always keeps alert evidence", () => {
    const first = appendBuffExpiryIconEvidence({
      history: [],
      sampledAt: 1_000,
      acceptedMatches: [makeMatch()],
      temporalCandidateMatches: [],
      rejectedMatches: [],
      previousTracks: [],
      tracks: [],
      alertedTrackIds: [],
      normalizedBoxPreviewUrls: {},
    });
    const repeatedAccepted = appendBuffExpiryIconEvidence({
      history: first,
      sampledAt: 3_000,
      acceptedMatches: [makeMatch()],
      temporalCandidateMatches: [],
      rejectedMatches: [],
      previousTracks: [],
      tracks: [],
      alertedTrackIds: [],
      normalizedBoxPreviewUrls: {},
    });
    const alerted = appendBuffExpiryIconEvidence({
      history: repeatedAccepted,
      sampledAt: 3_000,
      acceptedMatches: [],
      temporalCandidateMatches: [],
      rejectedMatches: [],
      previousTracks: [],
      tracks: [makeTrack({ alertedAt: 3_000 })],
      alertedTrackIds: ["track-1"],
      normalizedBoxPreviewUrls: {},
    });

    expect(repeatedAccepted).toHaveLength(1);
    expect(alerted.map((entry) => entry.source)).toEqual(["accepted", "confirmed", "alerted"]);
  });

  it("prunes icon evidence outside the rolling five minute window", () => {
    const oldEntry: BuffExpiryIconEvidence = {
      sampledAt: 0,
      source: "accepted",
      slotKey: "old",
      buffId: "union_wealth_group",
      name: "유니온의 부",
      seconds: 40,
      score: 0.9,
      reason: "accepted",
      box: BOX,
      topMatches: [],
      normalizedIconDataUrl: null,
    };
    const recentEntry = { ...oldEntry, sampledAt: 1_000, slotKey: "recent" };

    expect(pruneBuffExpiryIconEvidence([oldEntry, recentEntry], 5 * 60_000 + 500)).toEqual([
      recentEntry,
    ]);
  });

  it("keeps precision engine alerted markers from the current runtime tracks", () => {
    const nextTracks = [
      makeTrack({ id: "track-1", alertedAt: null }),
      makeTrack({ id: "track-2", alertedAt: null }),
    ];
    const runtimeTracks = [
      makeTrack({ id: "track-1", alertedAt: 12_000 }),
    ];

    expect(preserveBuffExpiryPrecisionAlertMarkers(nextTracks, runtimeTracks)).toEqual([
      { ...nextTracks[0], alertedAt: 12_000 },
      nextTracks[1],
    ]);
  });

  it("counts displayable temporal candidates only after stable countdown evidence", () => {
    const stable = makePendingTrack([
      makeTemporalObservation(0, 50),
      makeTemporalObservation(2_000, 48),
      makeTemporalObservation(4_000, 46),
      makeTemporalObservation(6_000, 44),
    ]);
    const unstable = makePendingTrack([
      makeTemporalObservation(0, 50),
      makeTemporalObservation(2_000, 48),
      makeTemporalObservation(4_000, 49),
      makeTemporalObservation(6_000, 44),
    ]);

    expect(getBuffExpiryConfirmationCandidateCount({
      pendingTracks: [stable],
      temporalCandidateTracks: [],
      expiryClusters: [],
    })).toBe(1);
    expect(getBuffExpiryConfirmationCandidateCount({
      pendingTracks: [unstable],
      temporalCandidateTracks: [],
      expiryClusters: [],
    })).toBe(0);
  });

  it("counts confirmed or sufficiently diverse expiry clusters", () => {
    expect(getBuffExpiryConfirmationCandidateCount({
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [makeCluster({ confirmedAt: 8_000 })],
    })).toBe(1);
    expect(getBuffExpiryConfirmationCandidateCount({
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [makeCluster()],
    })).toBe(1);
    expect(getBuffExpiryConfirmationCandidateCount({
      pendingTracks: [],
      temporalCandidateTracks: [],
      expiryClusters: [
        makeCluster({
          observations: makeCluster().observations.map((observation) => ({
            ...observation,
            slotKey: "same-slot",
          })),
        }),
      ],
    })).toBe(0);
  });
});
