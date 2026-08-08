import type {
  BuffExpiryPendingObservation,
  BuffExpiryTemporalCandidateTrack,
  BuffExpiryTrackedBuff,
} from "../buffExpiry/buffExpiryTypes";
import {
  BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID,
  BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
  BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
} from "./buffExpiryRuntimeConstants";
import {
  getAverageObservationScore,
  getExpectedWeakCountdownDecrease,
  getMaxObservationGapMs,
  getPredictedExpiresSpread,
  hasSufficientCountdownProgression,
  isMonotonicCountdown,
} from "./buffExpiryPendingObservationUtils";
import { createConfirmedBuffExpiryTrack } from "./buffExpiryPendingConfirmation";

const BUFF_EXPIRY_CONFIRM_EXPIRES_SPREAD_MS = 3000;
const BUFF_EXPIRY_CONFIRM_MIN_SECOND_DECREASE = 6;
const BUFF_EXPIRY_TEMPORAL_LOW_SCORE_CONFIRM_MIN_OBSERVATIONS = 4;
const BUFF_EXPIRY_TEMPORAL_LOW_SCORE_CONFIRM_MIN_OBSERVATION_SPAN_MS = 10_000;
const BUFF_EXPIRY_TEMPORAL_LOW_SCORE_CONFIRM_MAX_OBSERVATION_GAP_MS = 6_000;
const BUFF_EXPIRY_TEMPORAL_LOW_SCORE_CONFIRM_MIN_AVERAGE_SCORE = 0.88;
const BUFF_EXPIRY_TEMPORAL_LOW_SCORE_MIN_RELIABLE_SECONDS = 31;
const BUFF_EXPIRY_TEMPORAL_LOW_SCORE_MAX_RELIABLE_SECONDS = 59;
const BUFF_EXPIRY_SINGLE_EXP_COUPON_TEMPORAL_MIN_OBSERVATIONS = 5;
const BUFF_EXPIRY_SINGLE_EXP_COUPON_TEMPORAL_MIN_RELIABLE_SECONDS = 21;
const BUFF_EXPIRY_SINGLE_EXP_COUPON_TEMPORAL_MIN_SPAN_MS = 7_000;
const BUFF_EXPIRY_SINGLE_EXP_COUPON_TEMPORAL_MIN_DECREASE = 8;
const BUFF_EXPIRY_SINGLE_EXP_COUPON_TEMPORAL_MAX_OBSERVATION_GAP_MS = 5_000;
const BUFF_EXPIRY_SINGLE_EXP_COUPON_TEMPORAL_MAX_SPREAD_MS = 2_000;
const BUFF_EXPIRY_SINGLE_EXP_COUPON_TEMPORAL_MIN_AVERAGE_SCORE = 0.905;

export function maybeConfirmTemporalCandidateTrack(
  track: BuffExpiryTemporalCandidateTrack,
): BuffExpiryTrackedBuff | null {
  if (track.buffId === BUFF_EXPIRY_SMALL_POTION_GROUP_ID) {
    return maybeConfirmSingleSmallPotionTemporalCandidateTrack(track);
  }
  if (
    track.buffId === BUFF_EXPIRY_EXP_COUPON_GROUP_ID ||
    track.buffId === BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID
  ) {
    return maybeConfirmSingleExpCouponTemporalCandidateTrack(track);
  }
  return null;
}

function maybeConfirmSingleSmallPotionTemporalCandidateTrack(
  track: BuffExpiryTemporalCandidateTrack,
): BuffExpiryTrackedBuff | null {
  const confirmingObservations = [...track.observations]
    .sort((a, b) => a.observedAt - b.observedAt)
    .filter(isTemporalLowScoreObservation);
  if (
    confirmingObservations.length <
    BUFF_EXPIRY_TEMPORAL_LOW_SCORE_CONFIRM_MIN_OBSERVATIONS
  ) {
    return null;
  }

  if (
    !hasSufficientCountdownProgression(confirmingObservations, {
      minObservationSpanMs:
        BUFF_EXPIRY_TEMPORAL_LOW_SCORE_CONFIRM_MIN_OBSERVATION_SPAN_MS,
      minSecondDecrease: getExpectedWeakCountdownDecrease(
        confirmingObservations,
        BUFF_EXPIRY_CONFIRM_MIN_SECOND_DECREASE,
      ),
    })
  ) {
    return null;
  }

  if (!isMonotonicCountdown(confirmingObservations)) {
    return null;
  }

  if (
    getMaxObservationGapMs(confirmingObservations) >
    BUFF_EXPIRY_TEMPORAL_LOW_SCORE_CONFIRM_MAX_OBSERVATION_GAP_MS
  ) {
    return null;
  }

  if (
    getPredictedExpiresSpread(confirmingObservations) >
    BUFF_EXPIRY_CONFIRM_EXPIRES_SPREAD_MS
  ) {
    return null;
  }

  if (
    getAverageObservationScore(confirmingObservations) <
    BUFF_EXPIRY_TEMPORAL_LOW_SCORE_CONFIRM_MIN_AVERAGE_SCORE
  ) {
    return null;
  }

  return createConfirmedBuffExpiryTrack(track, confirmingObservations);
}

function maybeConfirmSingleExpCouponTemporalCandidateTrack(
  track: BuffExpiryTemporalCandidateTrack,
): BuffExpiryTrackedBuff | null {
  const confirmingObservations = [...track.observations]
    .sort((a, b) => a.observedAt - b.observedAt)
    .filter((observation) =>
      isTemporalLowScoreObservation(
        observation,
        BUFF_EXPIRY_SINGLE_EXP_COUPON_TEMPORAL_MIN_RELIABLE_SECONDS,
      ),
    );
  if (
    confirmingObservations.length <
    BUFF_EXPIRY_SINGLE_EXP_COUPON_TEMPORAL_MIN_OBSERVATIONS
  ) {
    return null;
  }

  if (
    !hasSufficientCountdownProgression(confirmingObservations, {
      minObservationSpanMs: BUFF_EXPIRY_SINGLE_EXP_COUPON_TEMPORAL_MIN_SPAN_MS,
      minSecondDecrease: BUFF_EXPIRY_SINGLE_EXP_COUPON_TEMPORAL_MIN_DECREASE,
    })
  ) {
    return null;
  }

  if (!isMonotonicCountdown(confirmingObservations)) {
    return null;
  }

  if (
    getMaxObservationGapMs(confirmingObservations) >
    BUFF_EXPIRY_SINGLE_EXP_COUPON_TEMPORAL_MAX_OBSERVATION_GAP_MS
  ) {
    return null;
  }

  if (
    getPredictedExpiresSpread(confirmingObservations) >
    BUFF_EXPIRY_SINGLE_EXP_COUPON_TEMPORAL_MAX_SPREAD_MS
  ) {
    return null;
  }

  if (
    getAverageObservationScore(confirmingObservations) <
    BUFF_EXPIRY_SINGLE_EXP_COUPON_TEMPORAL_MIN_AVERAGE_SCORE
  ) {
    return null;
  }

  return createConfirmedBuffExpiryTrack(track, confirmingObservations);
}

function isTemporalLowScoreObservation(
  observation: BuffExpiryPendingObservation,
  minReliableSeconds = BUFF_EXPIRY_TEMPORAL_LOW_SCORE_MIN_RELIABLE_SECONDS,
): boolean {
  return (
    observation.reason === "temporal-low-score" &&
    observation.strength === "weak" &&
    observation.seconds >= minReliableSeconds &&
    observation.seconds <= BUFF_EXPIRY_TEMPORAL_LOW_SCORE_MAX_RELIABLE_SECONDS
  );
}
