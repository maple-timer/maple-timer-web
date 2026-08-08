import type {
  BuffExpiryPrecisionContinuityCandidate,
  BuffExpiryTrackedBuff,
} from "./precisionTrackingTypes";
import {
  BUFF_EXPIRY_PRECISION_ASSIST_MAX_EXPIRES_DRIFT_MS,
  getBuffExpiryPrecisionGroupFromBuffId,
} from "./precisionTrackingPolicy";
import { getDerivedRemainingSeconds } from "./precisionTrackingObservations";
import {
  isActiveAlertedBuffExpiryPrecisionTrack,
  isBuffExpiryPrecisionNearbyBox,
} from "./precisionTrackingMatching";

export function applyBuffExpiryPrecisionContinuityAssist(
  tracks: BuffExpiryTrackedBuff[],
  candidates: BuffExpiryPrecisionContinuityCandidate[],
  now: number,
): BuffExpiryTrackedBuff[] {
  return tracks.map((track) => {
    if (isActiveAlertedBuffExpiryPrecisionTrack(track, now)) {
      return track;
    }
    const group = getBuffExpiryPrecisionGroupFromBuffId(track.buffId);
    if (!group) {
      return track;
    }
    const candidate = candidates
      .filter((item) => item.group === group)
      .filter((item) => item.accepted)
      .filter((item) => isBuffExpiryPrecisionNearbyBox(track.box, item.box))
      .filter(
        (item): item is BuffExpiryPrecisionContinuityCandidate & { seconds: number } =>
          item.seconds !== null,
      )
      .filter(
        (item) =>
          Math.abs(now + item.seconds * 1000 - track.expiresAt) <=
          BUFF_EXPIRY_PRECISION_ASSIST_MAX_EXPIRES_DRIFT_MS,
      )
      .sort(
        (left, right) =>
          (right.gateMargin ?? Number.NEGATIVE_INFINITY) -
            (left.gateMargin ?? Number.NEGATIVE_INFINITY) ||
          right.margin - left.margin,
      )[0];
    if (!candidate) {
      return track;
    }
    return {
      ...track,
      box: candidate.box,
      detectedSeconds: getDerivedRemainingSeconds(track.expiresAt, now),
      detectedAt: now,
      lastSeenAt: now,
      score: Math.max(track.score, candidate.score),
    };
  });
}
