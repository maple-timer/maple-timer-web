import { describe, expect, it } from "vitest";
import { analyzeBuffExpiryPrecisionReplaySample } from "./buffExpiryPrecisionReplay";

const NOW = 1_000_000;

describe("analyzeBuffExpiryPrecisionReplaySample", () => {
  it("clusters tracked buffs and reports a future alert due time", () => {
    const result = analyzeBuffExpiryPrecisionReplaySample(
      createNextSample({
        tracks: [
          createTrack("wealth", "유니온의 부", NOW + 40_000),
          createTrack("wealth-2", "유니온의 부", NOW + 51_000),
        ],
      }),
      { now: NOW },
    );

    expect(result.supported).toBe(true);
    expect(result.trackCount).toBe(2);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]).toMatchObject({
      trackCount: 2,
      remainingSecondsUntilAlert: 33,
    });
    expect(result.dueDecision).toMatchObject({
      shouldAlert: false,
      reason: "no-due-tracks",
    });
  });

  it("replays the current due-cluster decision for tracked buffs", () => {
    const result = analyzeBuffExpiryPrecisionReplaySample(
      createNextSample({
        tracks: [
          createTrack("wealth", "유니온의 부", NOW + 6_000),
          createTrack("union-luck", "유니온의 행운", NOW + 18_000),
        ],
      }),
      { now: NOW },
    );

    expect(result.supported).toBe(true);
    expect(result.dueDecision).toMatchObject({
      shouldAlert: true,
      reason: "new-alert-group",
      dueTrackCount: 2,
      newAlertTrackIds: ["track-wealth", "track-union-luck"],
      markedTrackIds: ["track-wealth", "track-union-luck"],
    });
    expect(result.causes[0]).toMatchObject({
      status: "pass",
      title: "현재 코드 기준 알림 대상",
    });
  });

  it("keeps pending-only samples explainable without pretending to replay an alert", () => {
    const result = analyzeBuffExpiryPrecisionReplaySample(
      createNextSample({
        tracks: [],
        pendingTracks: [
          {
            id: "pending-wealth",
            buffId: "unionWealth",
            name: "유니온의 부",
            box: createBox(),
            firstSeenAt: NOW - 1000,
            lastSeenAt: NOW,
            observations: [{ seconds: 31, observedAt: NOW, score: 0.91, strength: "strong", reason: "test" }],
            score: 0.91,
          },
        ],
      }),
      { now: NOW },
    );

    expect(result.supported).toBe(true);
    expect(result.trackCount).toBe(0);
    expect(result.pendingTrackCount).toBe(1);
    expect(result.dueDecision).toMatchObject({
      shouldAlert: false,
      reason: "no-due-tracks",
    });
    expect(result.causes[0]).toMatchObject({
      status: "warn",
      title: "확인 중 후보만 있음",
    });
  });

  it("does not claim current-code replay for non-precision samples", () => {
    const result = analyzeBuffExpiryPrecisionReplaySample(
      {
        body: {
          buffExpiry: {
            engineMode: "legacy",
            state: { tracks: [createTrack("wealth", "유니온의 부", NOW + 6_000)] },
          },
        },
      },
      { now: NOW },
    );

    expect(result.supported).toBe(false);
    expect(result.reason).toBe("정밀 감지 샘플이 아니어서 현재 adapter를 실행하지 않았습니다.");
    expect(result.dueDecision).toBeNull();
  });
});

function createNextSample({
  tracks,
  pendingTracks = [],
}: {
  tracks: unknown[];
  pendingTracks?: unknown[];
}) {
  return {
    body: {
      buffExpiry: {
        config: { alertLeadSeconds: 7 },
        state: {
          status: "tracking",
          lastSampledAt: NOW,
          tracks,
          pendingTracks,
        },
      },
    },
  };
}

function createTrack(buffId: string, name: string, expiresAt: number) {
  return {
    id: `track-${buffId}`,
    buffId,
    name,
    box: createBox(),
    detectedSeconds: Math.ceil((expiresAt - NOW) / 1000),
    detectedAt: NOW - 1000,
    expiresAt,
    lastSeenAt: NOW,
    alertedAt: null,
    score: 0.95,
  };
}

function createBox() {
  return {
    x: 10,
    y: 20,
    width: 32,
    height: 32,
    confidence: 0.9,
  };
}
