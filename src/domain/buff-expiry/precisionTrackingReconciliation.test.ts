import { describe, expect, it } from "vitest";
import type {
  BuffExpiryBox,
  BuffExpiryPendingTrack,
  BuffExpiryPrecisionTrackingObservation,
  BuffExpiryTrackedBuff,
} from "./precisionTrackingTypes";
import { reconcileBuffExpiryPrecisionTracking } from "./precisionTrackingReconciliation";

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

function createObservation(
  overrides: Partial<BuffExpiryPrecisionTrackingObservation> = {},
): BuffExpiryPrecisionTrackingObservation {
  return {
    group: "unionLuck",
    box: createBox(),
    seconds: 30,
    observedAt: NOW,
    score: 2,
    margin: 1,
    reason: "target_accepted",
    countdownConfidence: 1,
    countdownStatus: "high",
    normalizedIconDataUrl: "data:image/png;base64,current",
    ...overrides,
  };
}

function createTrack(
  id: string,
  buffId = "next:unionLuck",
  overrides: Partial<BuffExpiryTrackedBuff> = {},
): BuffExpiryTrackedBuff {
  return {
    id,
    buffId,
    name: buffId,
    box: createBox(),
    detectedSeconds: 31,
    detectedAt: NOW - 1_000,
    expiresAt: NOW + 30_000,
    lastSeenAt: NOW - 1_000,
    alertedAt: null,
    score: 1,
    ...overrides,
  };
}

function createPendingTrack(id: string): BuffExpiryPendingTrack {
  return {
    id,
    buffId: "next:unionLuck",
    name: "unionLuck",
    box: createBox(),
    firstSeenAt: NOW - 1_000,
    lastSeenAt: NOW - 1_000,
    observations: [
      {
        seconds: 31,
        observedAt: NOW - 1_000,
        score: 1,
        strength: "strong",
        reason: "target_accepted",
      },
    ],
    score: 1,
  };
}

function runCountdownSequence(
  secondsSequence: readonly number[],
  observationOverrides: Partial<BuffExpiryPrecisionTrackingObservation> = {},
) {
  let tracks: BuffExpiryTrackedBuff[] = [];
  let pendingTracks: BuffExpiryPendingTrack[] = [];
  let latestResult: ReturnType<typeof reconcileBuffExpiryPrecisionTracking> = {
    tracks,
    pendingTracks,
    confirmationCandidateCount: 0,
    confirmedTransitions: [],
  };

  for (const [index, seconds] of secondsSequence.entries()) {
    const observedAt = NOW + index * 1_000;
    latestResult = reconcileBuffExpiryPrecisionTracking({
      previousTracks: tracks,
      previousPendingTracks: pendingTracks,
      observations: [
        createObservation({
          ...observationOverrides,
          seconds,
          observedAt,
        }),
      ],
      continuityCandidates: [],
      now: observedAt,
    });
    tracks = latestResult.tracks;
    pendingTracks = latestResult.pendingTracks;
  }

  return latestResult;
}

describe("buff expiry precision tracking reconciliation", () => {
  it("creates a pending track from a normalized observation and preserves its icon", () => {
    const result = reconcileBuffExpiryPrecisionTracking({
      previousTracks: [],
      previousPendingTracks: [],
      observations: [createObservation()],
      continuityCandidates: [],
      now: NOW,
    });

    expect(result.tracks).toEqual([]);
    expect(result.pendingTracks).toHaveLength(1);
    expect(result.pendingTracks[0].normalizedIconDataUrl).toBe(
      "data:image/png;base64,current",
    );
    expect(result.confirmationCandidateCount).toBe(1);
  });

  it("updates a matching track without discarding its previous icon", () => {
    const result = reconcileBuffExpiryPrecisionTracking({
      previousTracks: [
        createTrack("track", "next:unionLuck", {
          normalizedIconDataUrl: "data:image/png;base64,previous",
        }),
      ],
      previousPendingTracks: [],
      observations: [createObservation({ normalizedIconDataUrl: null })],
      continuityCandidates: [],
      now: NOW,
    });

    expect(result.tracks[0]).toMatchObject({
      id: "track",
      normalizedIconDataUrl: "data:image/png;base64,previous",
      detectedSeconds: 30,
      detectedAt: NOW,
      lastSeenAt: NOW,
      score: 2,
    });
  });

  it("removes excluded unalerted state while preserving alerted and unrelated tracks", () => {
    const result = reconcileBuffExpiryPrecisionTracking({
      previousTracks: [
        createTrack("unalerted"),
        createTrack("alerted", "next:unionLuck", { alertedAt: NOW - 1_000 }),
        createTrack("potion", "next:potion"),
      ],
      previousPendingTracks: [createPendingTrack("pending")],
      observations: [],
      continuityCandidates: [],
      positionExcludedGroups: new Set(["unionLuck"]),
      now: NOW,
    });

    expect(result.tracks.map((track) => track.id)).toEqual(["alerted", "potion"]);
    expect(result.pendingTracks).toEqual([]);
    expect(result.confirmationCandidateCount).toBe(0);
  });

  it("emits the exact pending-to-confirmed transition only on the decisive 21-second sample", () => {
    const pendingResult = runCountdownSequence([26, 25, 24, 23, 22], {
      group: "unionWealth",
    });

    expect(pendingResult.tracks).toEqual([]);
    expect(pendingResult.pendingTracks).toHaveLength(1);
    expect(pendingResult.confirmedTransitions).toEqual([]);

    const observedAt = NOW + 5_000;
    const confirmedResult = reconcileBuffExpiryPrecisionTracking({
      previousTracks: pendingResult.tracks,
      previousPendingTracks: pendingResult.pendingTracks,
      observations: [
        createObservation({
          group: "unionWealth",
          seconds: 21,
          observedAt,
        }),
      ],
      continuityCandidates: [],
      now: observedAt,
    });

    expect(confirmedResult.tracks).toHaveLength(1);
    expect(confirmedResult.confirmedTransitions).toEqual([
      {
        transition: "pending-to-confirmed",
        group: "unionWealth",
        trackId: confirmedResult.tracks[0]!.id,
        acceptedSeconds: 21,
        observedAt,
        derivedSeconds: 21,
        detectedAt: observedAt,
        expiresAt: NOW + 26_000,
        alertedAt: null,
      },
    ]);
  });

  it.each([
    {
      scheduledWaitMs: 500,
      seconds: [25, 24, 23, 23, 22, 21],
      observedAtOffsets: [0, 1_000, 2_000, 3_000, 4_000, 5_000],
    },
    {
      scheduledWaitMs: 1_499,
      seconds: [27, 26, 25, 23, 22, 21],
      observedAtOffsets: [0, 1_000, 2_000, 3_000, 4_000, 5_001],
    },
  ])(
    "preserves a natural confirmed transition with a $scheduledWaitMs ms lead-20 wait",
    ({ scheduledWaitMs, seconds, observedAtOffsets }) => {
      let tracks: BuffExpiryTrackedBuff[] = [];
      let pendingTracks: BuffExpiryPendingTrack[] = [];
      let result: ReturnType<typeof reconcileBuffExpiryPrecisionTracking> | null =
        null;

      for (const [index, observedSeconds] of seconds.entries()) {
        const observedAt = NOW + observedAtOffsets[index]!;
        result = reconcileBuffExpiryPrecisionTracking({
          previousTracks: tracks,
          previousPendingTracks: pendingTracks,
          observations: [
            createObservation({
              group: "unionWealth",
              seconds: observedSeconds,
              observedAt,
            }),
          ],
          continuityCandidates: [],
          now: observedAt,
        });
        tracks = result.tracks;
        pendingTracks = result.pendingTracks;
      }

      const sampledAt = NOW + observedAtOffsets[observedAtOffsets.length - 1]!;
      expect(result?.confirmedTransitions).toHaveLength(1);
      expect(result?.confirmedTransitions[0]).toMatchObject({
        acceptedSeconds: 21,
        observedAt: sampledAt,
        derivedSeconds: 21,
        detectedAt: sampledAt,
        expiresAt: sampledAt + 20_000 + scheduledWaitMs,
      });
    },
  );

  it("does not emit another transition for an already-confirmed non-21-second refresh", () => {
    const confirmedResult = runCountdownSequence([26, 25, 24, 23, 22, 21], {
      group: "unionWealth",
    });
    const observedAt = NOW + 6_000;

    const refreshedResult = reconcileBuffExpiryPrecisionTracking({
      previousTracks: confirmedResult.tracks,
      previousPendingTracks: confirmedResult.pendingTracks,
      observations: [
        createObservation({
          group: "unionWealth",
          seconds: 20,
          observedAt,
        }),
      ],
      continuityCandidates: [],
      now: observedAt,
    });

    expect(refreshedResult.tracks).toHaveLength(1);
    expect(refreshedResult.tracks[0]).toMatchObject({
      detectedSeconds: 20,
      detectedAt: observedAt,
    });
    expect(refreshedResult.pendingTracks).toEqual([]);
    expect(refreshedResult.confirmedTransitions).toEqual([]);
  });

  it("drops a transition when its newly-confirmed track does not survive the final cap", () => {
    const pendingResult = runCountdownSequence([26, 25, 24, 23, 22], {
      group: "unionWealth",
    });
    const observedAt = NOW + 5_000;
    const retainedTrack = createTrack("retained", "next:unionWealth", {
      box: createBox({ x: 128, col: 8 }),
      detectedSeconds: 0,
      detectedAt: observedAt - 1_000,
      expiresAt: observedAt - 1,
      lastSeenAt: observedAt,
      score: 99,
    });

    const result = reconcileBuffExpiryPrecisionTracking({
      previousTracks: [retainedTrack],
      previousPendingTracks: pendingResult.pendingTracks,
      observations: [
        createObservation({
          group: "unionWealth",
          seconds: 21,
          observedAt,
        }),
      ],
      continuityCandidates: [],
      now: observedAt,
    });

    expect(result.tracks.map((track) => track.id)).toEqual(["retained"]);
    expect(result.confirmedTransitions).toEqual([]);
  });
});
