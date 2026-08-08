import { describe, expect, it } from "vitest";
import {
  BUFF_EXPIRY_PRECISION_ALERT_MAX_STALE_MS,
  BUFF_EXPIRY_PRECISION_ASSIST_MAX_EXPIRES_DRIFT_MS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MAD_SCALE,
  BUFF_EXPIRY_PRECISION_CONFIRM_MAX_COUNTDOWN_RATE,
  BUFF_EXPIRY_PRECISION_CONFIRM_MAX_EXPIRES_RESIDUAL_MS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MAX_SAME_SECOND_SPAN_MS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MAX_SECONDS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MAX_TRANSITION_RESIDUAL_SECONDS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MIN_COUNTDOWN_RATE,
  BUFF_EXPIRY_PRECISION_CONFIRM_MIN_DISTINCT_SECONDS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MIN_EXPIRES_RESIDUAL_MS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MIN_INLIER_OBSERVATIONS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MIN_OBSERVATIONS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MIN_SECONDS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MIN_SPAN_MS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MIN_TOTAL_DECREASE_SECONDS,
  BUFF_EXPIRY_PRECISION_GROUP_LABELS,
  BUFF_EXPIRY_PRECISION_GROUP_MAX_TRACKS,
  BUFF_EXPIRY_PRECISION_PENDING_WINDOW_MS,
  BUFF_EXPIRY_PRECISION_TARGET_GROUPS,
  BUFF_EXPIRY_PRECISION_TRACK_ALERTED_GRACE_MS,
  BUFF_EXPIRY_PRECISION_TRACK_POST_EXPIRY_ALERT_GRACE_MS,
  BUFF_EXPIRY_PRECISION_UPDATE_MAX_EXPIRES_DRIFT_MS,
  getBuffExpiryPrecisionBuffId,
  getBuffExpiryPrecisionGroupFromBuffId,
  getBuffExpiryPrecisionSelectedTargetGroupSet,
  getBuffExpiryPrecisionSelectedTargetGroups,
  normalizeBuffExpiryPrecisionTargetGroups,
} from "./precisionTrackingPolicy";

describe("buff expiry precision tracking policy", () => {
  it("keeps the canonical group order, labels, and per-group track caps", () => {
    expect(BUFF_EXPIRY_PRECISION_TARGET_GROUPS).toEqual([
      "unionWealth",
      "unionLuck",
      "potion",
      "expCoupon",
    ]);
    expect(BUFF_EXPIRY_PRECISION_GROUP_LABELS).toEqual({
      unionWealth: "유니온의 부",
      unionLuck: "유니온의 행운",
      potion: "비약",
      expCoupon: "경험치 쿠폰",
    });
    expect(BUFF_EXPIRY_PRECISION_GROUP_MAX_TRACKS).toEqual({
      unionWealth: 1,
      unionLuck: 1,
      potion: 2,
      expCoupon: 1,
    });
  });

  it("keeps saved target normalization and buff-id compatibility", () => {
    expect(normalizeBuffExpiryPrecisionTargetGroups(undefined)).toEqual(
      BUFF_EXPIRY_PRECISION_TARGET_GROUPS,
    );
    expect(normalizeBuffExpiryPrecisionTargetGroups([])).toEqual(
      BUFF_EXPIRY_PRECISION_TARGET_GROUPS,
    );
    expect(normalizeBuffExpiryPrecisionTargetGroups([
      "potion",
      "potion",
      "invalid",
      "unionLuck",
    ])).toEqual(["potion", "unionLuck"]);
    expect(getBuffExpiryPrecisionSelectedTargetGroups({
      selectedPrecisionTargetGroups: ["expCoupon"],
    })).toEqual(["expCoupon"]);
    expect([...getBuffExpiryPrecisionSelectedTargetGroupSet({
      selectedPrecisionTargetGroups: ["unionLuck", "potion"],
    })]).toEqual(["unionLuck", "potion"]);
    expect(getBuffExpiryPrecisionBuffId("potion")).toBe("next:potion");
    expect(getBuffExpiryPrecisionGroupFromBuffId("next:potion")).toBe("potion");
    expect(getBuffExpiryPrecisionGroupFromBuffId("potion")).toBe("potion");
    expect(getBuffExpiryPrecisionGroupFromBuffId("next:unknown")).toBeNull();
  });

  it("keeps the temporal confirmation and lifecycle thresholds", () => {
    expect({
      confirmMinSeconds: BUFF_EXPIRY_PRECISION_CONFIRM_MIN_SECONDS,
      confirmMaxSeconds: BUFF_EXPIRY_PRECISION_CONFIRM_MAX_SECONDS,
      pendingWindowMs: BUFF_EXPIRY_PRECISION_PENDING_WINDOW_MS,
      postExpiryGraceMs: BUFF_EXPIRY_PRECISION_TRACK_POST_EXPIRY_ALERT_GRACE_MS,
      alertedGraceMs: BUFF_EXPIRY_PRECISION_TRACK_ALERTED_GRACE_MS,
      alertMaxStaleMs: BUFF_EXPIRY_PRECISION_ALERT_MAX_STALE_MS,
      minObservations: BUFF_EXPIRY_PRECISION_CONFIRM_MIN_OBSERVATIONS,
      minInliers: BUFF_EXPIRY_PRECISION_CONFIRM_MIN_INLIER_OBSERVATIONS,
      maxExpiresResidualMs: BUFF_EXPIRY_PRECISION_CONFIRM_MAX_EXPIRES_RESIDUAL_MS,
      minExpiresResidualMs: BUFF_EXPIRY_PRECISION_CONFIRM_MIN_EXPIRES_RESIDUAL_MS,
      madScale: BUFF_EXPIRY_PRECISION_CONFIRM_MAD_SCALE,
      minSpanMs: BUFF_EXPIRY_PRECISION_CONFIRM_MIN_SPAN_MS,
      minDistinctSeconds: BUFF_EXPIRY_PRECISION_CONFIRM_MIN_DISTINCT_SECONDS,
      minTotalDecreaseSeconds: BUFF_EXPIRY_PRECISION_CONFIRM_MIN_TOTAL_DECREASE_SECONDS,
      minCountdownRate: BUFF_EXPIRY_PRECISION_CONFIRM_MIN_COUNTDOWN_RATE,
      maxCountdownRate: BUFF_EXPIRY_PRECISION_CONFIRM_MAX_COUNTDOWN_RATE,
      maxTransitionResidualSeconds:
        BUFF_EXPIRY_PRECISION_CONFIRM_MAX_TRANSITION_RESIDUAL_SECONDS,
      maxSameSecondSpanMs: BUFF_EXPIRY_PRECISION_CONFIRM_MAX_SAME_SECOND_SPAN_MS,
      updateMaxExpiresDriftMs: BUFF_EXPIRY_PRECISION_UPDATE_MAX_EXPIRES_DRIFT_MS,
      assistMaxExpiresDriftMs: BUFF_EXPIRY_PRECISION_ASSIST_MAX_EXPIRES_DRIFT_MS,
    }).toEqual({
      confirmMinSeconds: 21,
      confirmMaxSeconds: 59,
      pendingWindowMs: 20_000,
      postExpiryGraceMs: 10_000,
      alertedGraceMs: 15_000,
      alertMaxStaleMs: 8_000,
      minObservations: 5,
      minInliers: 4,
      maxExpiresResidualMs: 3_000,
      minExpiresResidualMs: 1_500,
      madScale: 2.5,
      minSpanMs: 5_000,
      minDistinctSeconds: 4,
      minTotalDecreaseSeconds: 4,
      minCountdownRate: 0.7,
      maxCountdownRate: 1.3,
      maxTransitionResidualSeconds: 1.5,
      maxSameSecondSpanMs: 1_500,
      updateMaxExpiresDriftMs: 4_000,
      assistMaxExpiresDriftMs: 3_000,
    });
  });
});
