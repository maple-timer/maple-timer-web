import { describe, expect, it } from "vitest";
import {
  appendBuffExpiryPrecisionRecentRoiFrame,
  BUFF_EXPIRY_PRECISION_ROI_HISTORY_LIMIT,
  pruneBuffExpiryPrecisionRecentRoiFrames,
  selectBuffExpiryPrecisionRoiFrameReason,
} from "./buffExpiryPrecisionRoiHistory";
import type { BuffExpiryPrecisionRecentRoiFrame } from "./buffExpiryPrecisionRoiHistory";
import type { BuffExpiryTrackedBuff } from "../../../domain/buff-expiry/precisionTrackingTypes";
import type { BuffExpiryPrecisionBestGroupCandidate } from "../analysis/buffExpiryPrecisionAnalysisRuntime";

describe("buffExpiryPrecisionRoiHistory", () => {
  it("captures periodic frames every 30 seconds", () => {
    expect(
      selectBuffExpiryPrecisionRoiFrameReason({
        sampledAt: 29_000,
        lastPeriodicAt: 0,
        lastNearMissAt: 0,
        lastCapturedAlertedAt: null,
        currentLastAlertedAt: null,
        previousTargetObservationCount: 0,
        currentTargetObservationCount: 0,
        previousTracks: [],
        currentTracks: [],
        bestByGroup: [],
      }),
    ).toBeNull();

    expect(
      selectBuffExpiryPrecisionRoiFrameReason({
        sampledAt: 30_000,
        lastPeriodicAt: 0,
        lastNearMissAt: 0,
        lastCapturedAlertedAt: null,
        currentLastAlertedAt: null,
        previousTargetObservationCount: 0,
        currentTargetObservationCount: 0,
        previousTracks: [],
        currentTracks: [],
        bestByGroup: [],
      }),
    ).toBe("periodic");
  });

  it("prioritizes alert snapshots over periodic snapshots", () => {
    expect(
      selectBuffExpiryPrecisionRoiFrameReason({
        sampledAt: 30_000,
        lastPeriodicAt: 0,
        lastNearMissAt: 0,
        lastCapturedAlertedAt: null,
        currentLastAlertedAt: 29_500,
        previousTargetObservationCount: 0,
        currentTargetObservationCount: 0,
        previousTracks: [],
        currentTracks: [],
        bestByGroup: [],
      }),
    ).toBe("alert-fired");
  });

  it("keeps the recent history bounded", () => {
    const frames = Array.from(
      { length: BUFF_EXPIRY_PRECISION_ROI_HISTORY_LIMIT + 4 },
      (_, index) => createFrame(index * 1_000),
    ).reduce<BuffExpiryPrecisionRecentRoiFrame[]>(
      (history, frame) => appendBuffExpiryPrecisionRecentRoiFrame(history, frame),
      [],
    );

    expect(frames).toHaveLength(BUFF_EXPIRY_PRECISION_ROI_HISTORY_LIMIT);
    expect(frames[0]?.sampledAt).toBe(4_000);
  });

  it("prioritizes track lifecycle evidence over target and near-miss evidence", () => {
    expect(
      selectBuffExpiryPrecisionRoiFrameReason({
        sampledAt: 30_000,
        lastPeriodicAt: 0,
        lastNearMissAt: 0,
        lastCapturedAlertedAt: null,
        currentLastAlertedAt: null,
        previousTargetObservationCount: 0,
        currentTargetObservationCount: 1,
        previousTracks: [],
        currentTracks: [createTrack("track")],
        bestByGroup: [createNearMissCandidate()],
      }),
    ).toBe("track-started");
  });

  it("uses the inclusive 8-second near-miss gap before the periodic fallback", () => {
    const input = {
      lastPeriodicAt: 0,
      lastNearMissAt: 23_000,
      lastCapturedAlertedAt: null,
      currentLastAlertedAt: null,
      previousTargetObservationCount: 0,
      currentTargetObservationCount: 0,
      previousTracks: [],
      currentTracks: [],
      bestByGroup: [createNearMissCandidate()],
    };

    expect(selectBuffExpiryPrecisionRoiFrameReason({ ...input, sampledAt: 30_000 })).toBe(
      "periodic",
    );
    expect(selectBuffExpiryPrecisionRoiFrameReason({ ...input, sampledAt: 31_000 })).toBe(
      "near-miss",
    );
  });

  it("drops frames outside the five-minute history window", () => {
    expect(
      pruneBuffExpiryPrecisionRecentRoiFrames(
        [createFrame(0), createFrame(300_001)],
        300_001,
      ).map((frame) => frame.sampledAt),
    ).toEqual([300_001]);
  });

  it("removes periodic evidence first under the data budget", () => {
    const periodic = {
      ...createFrame(10_000),
      imageDataUrl: "p".repeat(800_000),
    };
    const alert = {
      ...createFrame(11_000),
      reason: "alert-fired" as const,
      imageDataUrl: "a".repeat(800_000),
    };

    expect(pruneBuffExpiryPrecisionRecentRoiFrames([periodic, alert], 11_000)).toEqual([
      alert,
    ]);
  });
});

function createFrame(sampledAt: number): BuffExpiryPrecisionRecentRoiFrame {
  return {
    sampledAt,
    reason: "periodic",
    sourceSize: { width: 1920, height: 1080 },
    roi: { x: 900, y: 0, width: 1020, height: 389 },
    imageDataUrl: "data:image/webp;base64,AA==",
    boxCount: 0,
    targetObservationCount: 0,
    countdownObservationCount: 0,
    bestByGroup: [],
    trackCount: 0,
    pendingTrackCount: 0,
  };
}

function createTrack(id: string): BuffExpiryTrackedBuff {
  return {
    id,
    buffId: "next:unionLuck",
    name: "유니온의 행운",
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
    lastSeenAt: 30_000,
    alertedAt: null,
    score: 1,
  };
}

function createNearMissCandidate(): BuffExpiryPrecisionBestGroupCandidate {
  return {
    group: "unionLuck",
    boxIndex: 0,
    box: {
      x: 100,
      y: 40,
      size: 32,
      row: 0,
      col: 0,
      confidence: 1,
      score: 1,
    },
    accepted: false,
    winningGroup: "unionLuck",
    score: 0.5,
    margin: 0,
    decisionReason: "below-threshold",
    countdown: null,
  };
}
