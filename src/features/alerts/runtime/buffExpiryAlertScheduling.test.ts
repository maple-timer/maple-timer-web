import { describe, expect, it } from "vitest";
import type { BuffExpiryAlertDecision } from "../../../domain/buff-expiry/precisionAlertTypes";
import type { BuffExpiryTrackedBuff } from "../../../domain/buff-expiry/precisionTrackingTypes";
import type {
  BuffExpirySnapshot,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import {
  buildBuffExpiryLastAlertEvidence,
  getBuffExpiryAlertDueAt,
  getBuffExpiryScheduledAlertKey,
} from "./buffExpiryAlertScheduling";

function makeTrack(
  patch: Partial<BuffExpiryTrackedBuff> = {},
): BuffExpiryTrackedBuff {
  return {
    id: "next:unionWealth:r1:c7",
    buffId: "next:unionWealth",
    name: "유니온의 부",
    box: {
      x: 1279,
      y: 147,
      width: 32,
      height: 32,
      side: 32,
      row: 1,
      col: 7,
      confidence: 0.99,
    },
    detectedSeconds: 30,
    detectedAt: 10_000,
    expiresAt: 40_000,
    lastSeenAt: 10_000,
    alertedAt: null,
    score: 0.98,
    ...patch,
  };
}

function makeDecision(
  patch: Partial<BuffExpiryAlertDecision> = {},
): BuffExpiryAlertDecision {
  return {
    sampledAt: 30_000,
    alertLeadSeconds: 10,
    shouldAlert: true,
    reason: "new-alert-group",
    dueTracks: [],
    newAlertTrackIds: ["next:unionWealth:r1:c7"],
    suppressedTrackIds: [],
    deferredTrackIds: [],
    markedTrackIds: ["next:unionWealth:r1:c7"],
    dueGroupExpiresAt: 40_000,
    nearestExistingAlertGroup: null,
    ...patch,
  };
}

function makeSnapshot(
  track: BuffExpiryTrackedBuff,
  boxX = track.box.x,
): BuffExpirySnapshot {
  const box = {
    ...track.box,
    x: boxX,
  };
  return {
    sampledAt: 20_000,
    roi: null,
    rawPreviewUrl: null,
    processedPreviewUrl: null,
    fullFramePreviewUrl: null,
    boxes: [box],
    boxPreviewUrls: {
      [`${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.width)}:${Math.round(box.height)}`]:
        "data:image/png;base64,icon",
    },
    acceptedMatches: [],
    rejectedMatches: [],
    tracks: [track],
    pendingTracks: [],
    unsupportedReason: null,
    performance: null,
  };
}

describe("buffExpiryAlertScheduling", () => {
  it("builds last alert evidence for triggered tracks with nearest preview fallback", () => {
    const track = makeTrack();

    expect(
      buildBuffExpiryLastAlertEvidence({
        alertedAt: 30_000,
        alertLeadSeconds: 10,
        clusterId: "cluster:1",
        dueAt: 30_000,
        alertDecision: makeDecision(),
        tracks: [track],
        snapshot: makeSnapshot(track, track.box.x + 1),
      }),
    ).toMatchObject({
      alertedAt: 30_000,
      alertLeadSeconds: 10,
      clusterId: "cluster:1",
      dueAt: 30_000,
      triggeredTracks: [
        {
          id: track.id,
          buffId: track.buffId,
          name: track.name,
          expiresAt: 40_000,
          remainingSeconds: 10,
          normalizedIconDataUrl: "data:image/png;base64,icon",
        },
      ],
    });
  });

  it("prefers the last tracked icon over the current snapshot slot image", () => {
    const track = makeTrack({
      normalizedIconDataUrl: "data:image/png;base64,tracked-icon",
    });

    expect(
      buildBuffExpiryLastAlertEvidence({
        alertedAt: 43_000,
        alertLeadSeconds: -3,
        clusterId: "cluster:post-expiry",
        dueAt: 43_000,
        alertDecision: makeDecision(),
        tracks: [track],
        snapshot: makeSnapshot(track),
      })?.triggeredTracks[0]?.normalizedIconDataUrl,
    ).toBe("data:image/png;base64,tracked-icon");
  });

  it("returns null when the alert decision has no matching triggered track", () => {
    expect(
      buildBuffExpiryLastAlertEvidence({
        alertedAt: 30_000,
        alertLeadSeconds: 10,
        clusterId: "cluster:1",
        dueAt: 30_000,
        alertDecision: makeDecision({ newAlertTrackIds: ["missing"] }),
        tracks: [makeTrack()],
        snapshot: null,
      }),
    ).toBeNull();
  });

  it("computes legacy schedule due time and stable schedule key", () => {
    const track = makeTrack({ id: "buff:42", expiresAt: 65_432 });
    const dueAt = getBuffExpiryAlertDueAt(track, 7);

    expect(dueAt).toBe(58_432);
    expect(getBuffExpiryScheduledAlertKey(track, dueAt)).toBe("buff:42:65:58");
  });

  it("computes post-expiry due time for negative alert lead seconds", () => {
    const track = makeTrack({ id: "buff:42", expiresAt: 65_432 });
    const dueAt = getBuffExpiryAlertDueAt(track, -3);

    expect(dueAt).toBe(68_432);
    expect(getBuffExpiryScheduledAlertKey(track, dueAt)).toBe("buff:42:65:68");
  });
});
