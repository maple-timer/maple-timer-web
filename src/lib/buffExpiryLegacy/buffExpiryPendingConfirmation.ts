import type {
  BuffExpiryPendingObservation,
  BuffExpiryPendingTrack,
  BuffExpiryTrackedBuff,
} from "../buffExpiry/buffExpiryTypes";
import { BUFF_EXPIRY_SMALL_POTION_GROUP_ID } from "./buffExpiryRuntimeConstants";
import {
  getAverageObservationScore,
  getExpectedWeakCountdownDecrease,
  getMaxObservationGapMs,
  getPendingObservationSpanMs,
  getPredictedExpiresSpread,
  hasSufficientCountdownProgression,
  isHypothesisObservation,
  isMonotonicCountdown,
  isWeakObservation,
  selectConsistentPendingCountdownWindow,
} from "./buffExpiryPendingObservationUtils";

const BUFF_EXPIRY_CONFIRM_MIN_OBSERVATIONS = 3;
const BUFF_EXPIRY_CONFIRM_MIN_OBSERVATION_SPAN_MS = 5_500;
const BUFF_EXPIRY_CONFIRM_MIN_SECOND_DECREASE = 6;
const BUFF_EXPIRY_WEAK_CONFIRM_MIN_OBSERVATIONS = 4;
const BUFF_EXPIRY_WEAK_CONFIRM_MIN_OBSERVATION_SPAN_MS = 10_000;
const BUFF_EXPIRY_WEAK_CONFIRM_MIN_SPARSE_OBSERVATIONS = 3;
const BUFF_EXPIRY_WEAK_CONFIRM_MIN_SPARSE_OBSERVATION_SPAN_MS = 20_000;
const BUFF_EXPIRY_SMALL_POTION_IDENTITY_CONFIRM_MIN_OBSERVATIONS = 3;
const BUFF_EXPIRY_SMALL_POTION_IDENTITY_CONFIRM_MIN_SPAN_MS = 8_000;
const BUFF_EXPIRY_SMALL_POTION_IDENTITY_CONFIRM_MIN_DECREASE = 8;
const BUFF_EXPIRY_SMALL_POTION_IDENTITY_CONFIRM_MAX_SPREAD_MS = 2_000;
const BUFF_EXPIRY_SMALL_POTION_IDENTITY_CONFIRM_MIN_AVERAGE_SCORE = 0.92;
const BUFF_EXPIRY_CONFIRM_EXPIRES_SPREAD_MS = 3000;
const BUFF_EXPIRY_CONFIRM_MIN_AVERAGE_SCORE = 0.9;
const BUFF_EXPIRY_HYPOTHESIS_ONLY_CONFIRM_MIN_AVERAGE_SCORE = 0.92;
const BUFF_EXPIRY_STRONG_FAST_CONFIRM_MIN_OBSERVATIONS = 3;
const BUFF_EXPIRY_STRONG_FAST_CONFIRM_MIN_SPAN_MS = 1_800;
const BUFF_EXPIRY_STRONG_FAST_CONFIRM_MIN_DECREASE = 2;
const BUFF_EXPIRY_STRONG_FAST_CONFIRM_MAX_SPREAD_MS = 1_500;
const BUFF_EXPIRY_STRONG_FAST_CONFIRM_MAX_GAP_MS = 2_200;
const BUFF_EXPIRY_STRONG_FAST_CONFIRM_MIN_AVERAGE_SCORE = 0.94;
const BUFF_EXPIRY_STRONG_PAIR_FAST_CONFIRM_MIN_SPAN_MS = 900;
const BUFF_EXPIRY_STRONG_PAIR_FAST_CONFIRM_MIN_DECREASE = 1;
const BUFF_EXPIRY_STRONG_PAIR_FAST_CONFIRM_MAX_SPREAD_MS = 600;
const BUFF_EXPIRY_STRONG_PAIR_FAST_CONFIRM_MAX_GAP_MS = 1_500;
const BUFF_EXPIRY_STRONG_PAIR_FAST_CONFIRM_MIN_AVERAGE_SCORE = 0.96;
const BUFF_EXPIRY_STRONG_PAIR_FAST_CONFIRM_MIN_LATEST_SECONDS = 31;
const BUFF_EXPIRY_STRONG_PAIR_FAST_CONFIRM_MAX_LATEST_SECONDS = 39;
const BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MIN_ACCEPTED_SCORE = 0.92;
const BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MIN_SPAN_MS = 8_000;
const BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MIN_DECREASE = 3;
const BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MAX_SPREAD_MS = 1_000;
const BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MAX_LATEST_SECONDS = 40;
const BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MAX_TIMING_DRIFT_SECONDS = 1.25;
const BUFF_EXPIRY_CONFIRM_MIN_RELIABLE_SECONDS = 21;

export function maybeConfirmPendingTrack(
  track: BuffExpiryPendingTrack,
): BuffExpiryTrackedBuff | null {
  const observations = [...track.observations].sort(
    (a, b) => a.observedAt - b.observedAt,
  );
  const fastConfirmingObservations =
    track.buffId === BUFF_EXPIRY_SMALL_POTION_GROUP_ID
      ? null
      : getStrongFastConfirmingObservations(observations);
  if (fastConfirmingObservations) {
    return createConfirmedBuffExpiryTrack(track, fastConfirmingObservations);
  }

  const reliableObservations = observations.filter(
    isReliableConfirmationObservation,
  );
  const acceptedSmallPotionPair =
    track.buffId === BUFF_EXPIRY_SMALL_POTION_GROUP_ID &&
    reliableObservations.length < BUFF_EXPIRY_CONFIRM_MIN_OBSERVATIONS
      ? getTightAcceptedSmallPotionPendingPair(reliableObservations)
      : null;
  if (acceptedSmallPotionPair) {
    return createConfirmedBuffExpiryTrack(track, acceptedSmallPotionPair);
  }

  const confirmingObservations = selectConsistentPendingCountdownWindow(
    reliableObservations,
    {
      maxPredictedExpiresSpreadMs: BUFF_EXPIRY_CONFIRM_EXPIRES_SPREAD_MS,
    },
  );
  if (confirmingObservations.length < BUFF_EXPIRY_CONFIRM_MIN_OBSERVATIONS) {
    return null;
  }

  if (
    !hasSufficientCountdownProgression(confirmingObservations, {
      minObservationSpanMs: BUFF_EXPIRY_CONFIRM_MIN_OBSERVATION_SPAN_MS,
      minSecondDecrease: BUFF_EXPIRY_CONFIRM_MIN_SECOND_DECREASE,
    })
  ) {
    return null;
  }

  if (!isMonotonicCountdown(confirmingObservations)) {
    return null;
  }

  if (
    confirmingObservations.every(isWeakObservation) &&
    !hasSufficientWeakCountdownProgression(confirmingObservations) &&
    !hasSufficientSmallPotionIdentityCountdownProgression(
      track,
      confirmingObservations,
    )
  ) {
    return null;
  }

  const minAverageScore = confirmingObservations.every(isHypothesisObservation)
    ? BUFF_EXPIRY_HYPOTHESIS_ONLY_CONFIRM_MIN_AVERAGE_SCORE
    : BUFF_EXPIRY_CONFIRM_MIN_AVERAGE_SCORE;
  const averageScore = getAverageObservationScore(confirmingObservations);
  if (averageScore < minAverageScore) {
    return null;
  }

  if (
    getPredictedExpiresSpread(confirmingObservations) >
    BUFF_EXPIRY_CONFIRM_EXPIRES_SPREAD_MS
  ) {
    return null;
  }

  return createConfirmedBuffExpiryTrack(track, confirmingObservations);
}

export function createConfirmedBuffExpiryTrack(
  track: BuffExpiryPendingTrack,
  observations: BuffExpiryPendingObservation[],
): BuffExpiryTrackedBuff {
  const sorted = [...observations].sort((a, b) => a.observedAt - b.observedAt);
  const predictedExpiresAt = sorted.map(
    (observation) => observation.observedAt + observation.seconds * 1000,
  );
  const expiresAt = Math.round(
    predictedExpiresAt.reduce((sum, value) => sum + value, 0) /
      predictedExpiresAt.length,
  );
  const latestObservation = sorted[sorted.length - 1];
  return {
    id: track.id,
    buffId: track.buffId,
    name: track.name,
    box: track.box,
    detectedSeconds: latestObservation.seconds,
    detectedAt: latestObservation.observedAt,
    expiresAt,
    lastSeenAt: track.lastSeenAt,
    alertedAt: null,
    score: latestObservation.score,
  };
}

function getStrongFastConfirmingObservations(
  observations: BuffExpiryPendingObservation[],
): BuffExpiryPendingObservation[] | null {
  const strongObservations = observations.filter(
    isStrongFastConfirmationObservation,
  );
  if (
    strongObservations.length < BUFF_EXPIRY_STRONG_FAST_CONFIRM_MIN_OBSERVATIONS
  ) {
    return getStrongPairFastConfirmingObservations(strongObservations);
  }

  const sorted = strongObservations.sort((a, b) => a.observedAt - b.observedAt);
  if (!isMonotonicCountdown(sorted)) {
    return getStrongPairFastConfirmingObservations([...sorted]);
  }
  if (
    !hasSufficientCountdownProgression(sorted, {
      minObservationSpanMs: BUFF_EXPIRY_STRONG_FAST_CONFIRM_MIN_SPAN_MS,
      minSecondDecrease: BUFF_EXPIRY_STRONG_FAST_CONFIRM_MIN_DECREASE,
    })
  ) {
    return getStrongPairFastConfirmingObservations([...sorted]);
  }
  if (
    getMaxObservationGapMs(sorted) > BUFF_EXPIRY_STRONG_FAST_CONFIRM_MAX_GAP_MS
  ) {
    return getStrongPairFastConfirmingObservations([...sorted]);
  }
  if (
    getPredictedExpiresSpread(sorted) >
    BUFF_EXPIRY_STRONG_FAST_CONFIRM_MAX_SPREAD_MS
  ) {
    return getStrongPairFastConfirmingObservations([...sorted]);
  }
  if (
    getAverageObservationScore(sorted) <
    BUFF_EXPIRY_STRONG_FAST_CONFIRM_MIN_AVERAGE_SCORE
  ) {
    return getStrongPairFastConfirmingObservations([...sorted]);
  }

  return sorted;
}

function getStrongPairFastConfirmingObservations(
  observations: BuffExpiryPendingObservation[],
): BuffExpiryPendingObservation[] | null {
  if (observations.length < 2) {
    return null;
  }
  const sorted = observations.sort((a, b) => a.observedAt - b.observedAt);
  const pair = sorted.slice(-2);
  const latestSeconds = pair[pair.length - 1].seconds;
  if (
    latestSeconds < BUFF_EXPIRY_STRONG_PAIR_FAST_CONFIRM_MIN_LATEST_SECONDS ||
    latestSeconds > BUFF_EXPIRY_STRONG_PAIR_FAST_CONFIRM_MAX_LATEST_SECONDS
  ) {
    return null;
  }
  if (!isMonotonicCountdown(pair)) {
    return null;
  }
  if (
    !hasSufficientCountdownProgression(pair, {
      minObservationSpanMs: BUFF_EXPIRY_STRONG_PAIR_FAST_CONFIRM_MIN_SPAN_MS,
      minSecondDecrease: BUFF_EXPIRY_STRONG_PAIR_FAST_CONFIRM_MIN_DECREASE,
    })
  ) {
    return null;
  }
  if (
    getMaxObservationGapMs(pair) >
    BUFF_EXPIRY_STRONG_PAIR_FAST_CONFIRM_MAX_GAP_MS
  ) {
    return null;
  }
  if (
    getPredictedExpiresSpread(pair) >
    BUFF_EXPIRY_STRONG_PAIR_FAST_CONFIRM_MAX_SPREAD_MS
  ) {
    return null;
  }
  if (
    getAverageObservationScore(pair) <
    BUFF_EXPIRY_STRONG_PAIR_FAST_CONFIRM_MIN_AVERAGE_SCORE
  ) {
    return null;
  }

  return pair;
}

function isStrongFastConfirmationObservation(
  observation: BuffExpiryPendingObservation,
): boolean {
  return (
    observation.strength === "strong" &&
    (observation.reason === "accepted" ||
      observation.reason === "grouped-countdown") &&
    !isHypothesisObservation(observation)
  );
}

function isReliableConfirmationObservation(
  observation: BuffExpiryPendingObservation,
): boolean {
  return observation.seconds >= BUFF_EXPIRY_CONFIRM_MIN_RELIABLE_SECONDS;
}

function getTightAcceptedSmallPotionPendingPair(
  observations: BuffExpiryPendingObservation[],
): BuffExpiryPendingObservation[] | null {
  const candidates = observations
    .filter(
      (observation) =>
        observation.score >=
          BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MIN_ACCEPTED_SCORE &&
        (observation.reason === "small-potion-compressed-countdown" ||
          observation.reason === "small-potion-identity-countdown" ||
          observation.reason === "accepted" ||
          observation.reason === "potion-rescue"),
    )
    .sort((a, b) => a.observedAt - b.observedAt || a.seconds - b.seconds);

  for (let start = 0; start < candidates.length; start += 1) {
    for (let end = start + 1; end < candidates.length; end += 1) {
      const pair = [candidates[start], candidates[end]];
      const first = pair[0];
      const latest = pair[1];
      const observedSpanSeconds = (latest.observedAt - first.observedAt) / 1000;
      const countdownDecrease = first.seconds - latest.seconds;
      const timingDrift = Math.abs(countdownDecrease - observedSpanSeconds);
      if (
        getPendingObservationSpanMs(pair) >=
          BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MIN_SPAN_MS &&
        getPredictedExpiresSpread(pair) <=
          BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MAX_SPREAD_MS &&
        countdownDecrease >=
          BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MIN_DECREASE &&
        latest.seconds <=
          BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MAX_LATEST_SECONDS &&
        timingDrift <=
          BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MAX_TIMING_DRIFT_SECONDS &&
        isMonotonicCountdown(pair)
      ) {
        return pair;
      }
    }
  }

  return null;
}

function hasSufficientWeakCountdownProgression(
  observations: BuffExpiryPendingObservation[],
): boolean {
  return (
    (observations.length >= BUFF_EXPIRY_WEAK_CONFIRM_MIN_OBSERVATIONS &&
      hasSufficientCountdownProgression(observations, {
        minObservationSpanMs: BUFF_EXPIRY_WEAK_CONFIRM_MIN_OBSERVATION_SPAN_MS,
        minSecondDecrease: getExpectedWeakCountdownDecrease(
          observations,
          BUFF_EXPIRY_CONFIRM_MIN_SECOND_DECREASE,
        ),
      })) ||
    (observations.length >= BUFF_EXPIRY_WEAK_CONFIRM_MIN_SPARSE_OBSERVATIONS &&
      hasSufficientCountdownProgression(observations, {
        minObservationSpanMs:
          BUFF_EXPIRY_WEAK_CONFIRM_MIN_SPARSE_OBSERVATION_SPAN_MS,
        minSecondDecrease: getExpectedWeakCountdownDecrease(
          observations,
          BUFF_EXPIRY_CONFIRM_MIN_SECOND_DECREASE,
        ),
      }))
  );
}

function hasSufficientSmallPotionIdentityCountdownProgression(
  track: BuffExpiryPendingTrack,
  observations: BuffExpiryPendingObservation[],
): boolean {
  return (
    track.buffId === BUFF_EXPIRY_SMALL_POTION_GROUP_ID &&
    observations.length >=
      BUFF_EXPIRY_SMALL_POTION_IDENTITY_CONFIRM_MIN_OBSERVATIONS &&
    observations.every(isSmallPotionIdentityCountdownObservation) &&
    hasSufficientCountdownProgression(observations, {
      minObservationSpanMs:
        BUFF_EXPIRY_SMALL_POTION_IDENTITY_CONFIRM_MIN_SPAN_MS,
      minSecondDecrease: BUFF_EXPIRY_SMALL_POTION_IDENTITY_CONFIRM_MIN_DECREASE,
    }) &&
    isMonotonicCountdown(observations) &&
    getPredictedExpiresSpread(observations) <=
      BUFF_EXPIRY_SMALL_POTION_IDENTITY_CONFIRM_MAX_SPREAD_MS &&
    getAverageObservationScore(observations) >=
      BUFF_EXPIRY_SMALL_POTION_IDENTITY_CONFIRM_MIN_AVERAGE_SCORE
  );
}

function isSmallPotionIdentityCountdownObservation(
  observation: BuffExpiryPendingObservation,
): boolean {
  return observation.reason === "small-potion-identity-countdown";
}
