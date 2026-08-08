import type {
  BuffExpiryBox,
  BuffExpiryPendingObservation,
  BuffExpiryPendingTrack,
  BuffExpiryPrecisionExactObservation,
  BuffExpiryTrackedBuff,
} from "./precisionTrackingTypes";
import type { BuffExpiryTargetGroup } from "../../contracts/recognition/buffExpiryRecognition";
import {
  BUFF_EXPIRY_PRECISION_CONFIRM_MAD_SCALE,
  BUFF_EXPIRY_PRECISION_CONFIRM_MAX_EXPIRES_RESIDUAL_MS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MAX_COUNTDOWN_RATE,
  BUFF_EXPIRY_PRECISION_CONFIRM_MAX_SAME_SECOND_SPAN_MS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MAX_TRANSITION_RESIDUAL_SECONDS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MIN_DISTINCT_SECONDS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MIN_COUNTDOWN_RATE,
  BUFF_EXPIRY_PRECISION_CONFIRM_MIN_EXPIRES_RESIDUAL_MS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MIN_INLIER_OBSERVATIONS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MIN_OBSERVATIONS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MIN_SPAN_MS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MIN_TOTAL_DECREASE_SECONDS,
  BUFF_EXPIRY_PRECISION_GROUP_LABELS,
  BUFF_EXPIRY_PRECISION_PENDING_WINDOW_MS,
  getBuffExpiryPrecisionBuffId,
} from "./precisionTrackingPolicy";
import {
  getBuffExpiryPrecisionObservationWeight,
  getDerivedRemainingSeconds,
  getPredictedExpiresAt,
  isBuffExpiryPrecisionConfirmationSecond,
} from "./precisionTrackingObservations";

export function appendBuffExpiryPrecisionPendingObservation(
  pendingTrack: BuffExpiryPendingTrack | null,
  observation: BuffExpiryPrecisionExactObservation,
  normalizedIconDataUrl: string | null = null,
): BuffExpiryPendingTrack {
  const nextObservation: BuffExpiryPendingObservation = {
    seconds: observation.seconds,
    observedAt: observation.observedAt,
    score: observation.score,
    strength: "strong",
    reason: observation.reason,
    predictedExpiresAt: getPredictedExpiresAt(observation),
    weight: getBuffExpiryPrecisionObservationWeight(observation),
  };
  if (!pendingTrack) {
    return {
      id: createBuffExpiryPrecisionTrackId(observation.group, observation.box),
      buffId: getBuffExpiryPrecisionBuffId(observation.group),
      name: BUFF_EXPIRY_PRECISION_GROUP_LABELS[observation.group],
      box: observation.box,
      normalizedIconDataUrl,
      firstSeenAt: observation.observedAt,
      lastSeenAt: observation.observedAt,
      observations: [nextObservation],
      score: observation.score,
    };
  }
  return {
    ...pendingTrack,
    box: observation.box,
    normalizedIconDataUrl: normalizedIconDataUrl ?? pendingTrack.normalizedIconDataUrl ?? null,
    lastSeenAt: observation.observedAt,
    observations: [...pendingTrack.observations, nextObservation].filter(
      (item) => observation.observedAt - item.observedAt <= BUFF_EXPIRY_PRECISION_PENDING_WINDOW_MS,
    ),
    score: Math.max(pendingTrack.score, observation.score),
  };
}

export function confirmBuffExpiryPrecisionPendingTrack(pendingTrack: BuffExpiryPendingTrack): BuffExpiryTrackedBuff | null {
  const observations = pendingTrack.observations
    .filter((observation) => isBuffExpiryPrecisionConfirmationSecond(observation.seconds))
    .sort((left, right) => left.observedAt - right.observedAt);
  if (observations.length < BUFF_EXPIRY_PRECISION_CONFIRM_MIN_OBSERVATIONS) {
    return null;
  }
  const stableEstimate = estimateStableBuffExpiryPrecisionExpiresAt(observations);
  if (!stableEstimate) {
    return null;
  }
  const lastObservation = stableEstimate.inliers[stableEstimate.inliers.length - 1]!;
  const expiresAt = stableEstimate.expiresAt;
  return {
    id: pendingTrack.id,
    buffId: pendingTrack.buffId,
    name: pendingTrack.name,
    box: pendingTrack.box,
    normalizedIconDataUrl: pendingTrack.normalizedIconDataUrl ?? null,
    detectedSeconds: getDerivedRemainingSeconds(expiresAt, lastObservation.observedAt),
    detectedAt: lastObservation.observedAt,
    expiresAt,
    lastSeenAt: pendingTrack.lastSeenAt,
    alertedAt: null,
    score: pendingTrack.score,
  };
}

type BuffExpiryPrecisionStableExpiryEstimate = {
  expiresAt: number;
  inliers: BuffExpiryPendingObservation[];
};

function estimateStableBuffExpiryPrecisionExpiresAt(
  observations: BuffExpiryPendingObservation[],
): BuffExpiryPrecisionStableExpiryEstimate | null {
  const centerExpiresAt = getWeightedMedianExpiresAt(observations);
  const coarseInliers = observations.filter(
    (observation) =>
      Math.abs(getPendingPredictedExpiresAt(observation) - centerExpiresAt) <=
      BUFF_EXPIRY_PRECISION_CONFIRM_MAX_EXPIRES_RESIDUAL_MS,
  );
  const residualLimitMs = getRobustExpiresResidualLimit(coarseInliers, centerExpiresAt);
  const inliers = coarseInliers.filter(
    (observation) =>
      Math.abs(getPendingPredictedExpiresAt(observation) - centerExpiresAt) <= residualLimitMs,
  );
  if (inliers.length < BUFF_EXPIRY_PRECISION_CONFIRM_MIN_INLIER_OBSERVATIONS) {
    return null;
  }
  const spanMs = inliers[inliers.length - 1]!.observedAt - inliers[0]!.observedAt;
  if (spanMs < BUFF_EXPIRY_PRECISION_CONFIRM_MIN_SPAN_MS) {
    return null;
  }
  if (!hasPlausibleCountdownFlow(inliers)) {
    return null;
  }
  return {
    expiresAt: Math.round(getWeightedAverageExpiresAt(inliers)),
    inliers,
  };
}

function getRobustExpiresResidualLimit(
  observations: BuffExpiryPendingObservation[],
  centerExpiresAt: number,
): number {
  if (!observations.length) {
    return BUFF_EXPIRY_PRECISION_CONFIRM_MIN_EXPIRES_RESIDUAL_MS;
  }

  const residuals = observations.map((observation) =>
    Math.abs(getPendingPredictedExpiresAt(observation) - centerExpiresAt),
  );
  const madMs = median(residuals);
  return Math.min(
    BUFF_EXPIRY_PRECISION_CONFIRM_MAX_EXPIRES_RESIDUAL_MS,
    Math.max(
      BUFF_EXPIRY_PRECISION_CONFIRM_MIN_EXPIRES_RESIDUAL_MS,
      madMs * BUFF_EXPIRY_PRECISION_CONFIRM_MAD_SCALE + 500,
    ),
  );
}

function getWeightedMedianExpiresAt(observations: BuffExpiryPendingObservation[]): number {
  const weighted = observations
    .map((observation) => ({
      expiresAt: getPendingPredictedExpiresAt(observation),
      weight: getPendingObservationWeight(observation),
    }))
    .sort((left, right) => left.expiresAt - right.expiresAt);
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  let accumulatedWeight = 0;
  for (const item of weighted) {
    accumulatedWeight += item.weight;
    if (accumulatedWeight >= totalWeight / 2) {
      return item.expiresAt;
    }
  }
  return weighted[weighted.length - 1]?.expiresAt ?? 0;
}

function getWeightedAverageExpiresAt(observations: BuffExpiryPendingObservation[]): number {
  const weightedSum = observations.reduce(
    (sum, observation) => sum + getPendingPredictedExpiresAt(observation) * getPendingObservationWeight(observation),
    0,
  );
  const totalWeight = observations.reduce((sum, observation) => sum + getPendingObservationWeight(observation), 0);
  return totalWeight > 0 ? weightedSum / totalWeight : getPendingPredictedExpiresAt(observations[0]!);
}

function getPendingPredictedExpiresAt(observation: BuffExpiryPendingObservation): number {
  return observation.predictedExpiresAt ?? observation.observedAt + observation.seconds * 1000;
}

function getPendingObservationWeight(observation: BuffExpiryPendingObservation): number {
  return observation.weight ?? 1;
}

function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function hasPlausibleCountdownFlow(observations: BuffExpiryPendingObservation[]): boolean {
  const firstObservation = observations[0];
  const lastObservation = observations[observations.length - 1];
  if (!firstObservation || !lastObservation) {
    return false;
  }
  for (let index = 1; index < observations.length; index += 1) {
    const previous = observations[index - 1];
    const current = observations[index];
    if (current.seconds > previous.seconds) {
      return false;
    }
  }
  const distinctSecondCount = new Set(observations.map((observation) => observation.seconds)).size;
  return (
    distinctSecondCount >= BUFF_EXPIRY_PRECISION_CONFIRM_MIN_DISTINCT_SECONDS &&
    firstObservation.seconds - lastObservation.seconds >=
      BUFF_EXPIRY_PRECISION_CONFIRM_MIN_TOTAL_DECREASE_SECONDS &&
    hasPlausibleCountdownRate(observations) &&
    hasPlausibleCountdownTransitions(observations) &&
    !hasLongSameSecondPlateau(observations)
  );
}

function hasPlausibleCountdownTransitions(observations: BuffExpiryPendingObservation[]): boolean {
  for (let index = 1; index < observations.length; index += 1) {
    const previous = observations[index - 1];
    const current = observations[index];
    const elapsedSeconds = (current.observedAt - previous.observedAt) / 1000;
    if (elapsedSeconds <= 0) {
      return false;
    }

    const observedDecreaseSeconds = previous.seconds - current.seconds;
    const residualSeconds = Math.abs(observedDecreaseSeconds - elapsedSeconds);
    if (residualSeconds > BUFF_EXPIRY_PRECISION_CONFIRM_MAX_TRANSITION_RESIDUAL_SECONDS) {
      return false;
    }
  }
  return true;
}

function hasPlausibleCountdownRate(observations: BuffExpiryPendingObservation[]): boolean {
  if (observations.length < 2) {
    return false;
  }

  const firstObservedAt = observations[0]!.observedAt;
  const weighted = observations.map((observation) => ({
    x: (observation.observedAt - firstObservedAt) / 1000,
    y: observation.seconds,
    weight: getPendingObservationWeight(observation),
  }));
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    return false;
  }
  const meanX = weighted.reduce((sum, item) => sum + item.x * item.weight, 0) / totalWeight;
  const meanY = weighted.reduce((sum, item) => sum + item.y * item.weight, 0) / totalWeight;
  const denominator = weighted.reduce(
    (sum, item) => sum + (item.x - meanX) ** 2 * item.weight,
    0,
  );
  if (denominator <= 0) {
    return false;
  }
  const slope = weighted.reduce(
    (sum, item) => sum + (item.x - meanX) * (item.y - meanY) * item.weight,
    0,
  ) / denominator;
  const countdownRate = -slope;
  return (
    countdownRate >= BUFF_EXPIRY_PRECISION_CONFIRM_MIN_COUNTDOWN_RATE &&
    countdownRate <= BUFF_EXPIRY_PRECISION_CONFIRM_MAX_COUNTDOWN_RATE
  );
}

function hasLongSameSecondPlateau(observations: BuffExpiryPendingObservation[]): boolean {
  const spansBySecond = new Map<number, { firstObservedAt: number; lastObservedAt: number }>();
  for (const observation of observations) {
    const span = spansBySecond.get(observation.seconds);
    if (!span) {
      spansBySecond.set(observation.seconds, {
        firstObservedAt: observation.observedAt,
        lastObservedAt: observation.observedAt,
      });
      continue;
    }
    span.firstObservedAt = Math.min(span.firstObservedAt, observation.observedAt);
    span.lastObservedAt = Math.max(span.lastObservedAt, observation.observedAt);
  }
  return [...spansBySecond.values()].some(
    (span) => span.lastObservedAt - span.firstObservedAt > BUFF_EXPIRY_PRECISION_CONFIRM_MAX_SAME_SECOND_SPAN_MS,
  );
}

function createBuffExpiryPrecisionTrackId(group: BuffExpiryTargetGroup, box: BuffExpiryBox): string {
  return `next:${group}:r${Math.round(box.row ?? box.y)}:c${Math.round(box.col ?? box.x)}`;
}
