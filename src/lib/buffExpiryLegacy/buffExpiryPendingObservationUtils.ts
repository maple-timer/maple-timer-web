import type { BuffExpiryPendingObservation } from "../buffExpiry/buffExpiryTypes";

export function selectConsistentPendingCountdownWindow(
  observations: BuffExpiryPendingObservation[],
  {
    maxPredictedExpiresSpreadMs,
  }: {
    maxPredictedExpiresSpreadMs: number;
  },
): BuffExpiryPendingObservation[] {
  const sorted = [...observations].sort(
    (a, b) => a.observedAt - b.observedAt || b.score - a.score,
  );
  let best: BuffExpiryPendingObservation[] = [];

  for (const centerObservation of sorted) {
    const centerExpiresAt = getPredictedObservationExpiresAt(centerObservation);
    const inliers = sorted.filter(
      (observation) =>
        Math.abs(
          getPredictedObservationExpiresAt(observation) - centerExpiresAt,
        ) <= maxPredictedExpiresSpreadMs,
    );
    for (let start = 0; start < inliers.length; start += 1) {
      const sequence = [inliers[start]];
      for (let index = start + 1; index < inliers.length; index += 1) {
        const candidate = inliers[index];
        const previous = sequence[sequence.length - 1];
        if (
          candidate.observedAt <= previous.observedAt ||
          candidate.seconds > previous.seconds
        ) {
          continue;
        }
        sequence.push(candidate);
      }
      if (getPredictedExpiresSpread(sequence) > maxPredictedExpiresSpreadMs) {
        continue;
      }
      if (comparePendingObservationWindows(sequence, best) < 0) {
        best = sequence;
      }
    }
  }

  return best;
}

export function getPredictedObservationExpiresAt(
  observation: BuffExpiryPendingObservation,
): number {
  return observation.observedAt + observation.seconds * 1000;
}

export function getPendingObservationSpanMs(
  observations: BuffExpiryPendingObservation[],
): number {
  if (!observations.length) {
    return 0;
  }
  const observedAt = observations.map((observation) => observation.observedAt);
  return Math.max(...observedAt) - Math.min(...observedAt);
}

export function hasSufficientCountdownProgression(
  observations: BuffExpiryPendingObservation[],
  {
    minObservationSpanMs,
    minSecondDecrease,
  }: {
    minObservationSpanMs: number;
    minSecondDecrease: number;
  },
): boolean {
  const first = observations[0];
  const latest = observations[observations.length - 1];
  const observedSpan = latest.observedAt - first.observedAt;
  if (observedSpan < minObservationSpanMs) {
    return false;
  }

  return first.seconds - latest.seconds >= minSecondDecrease;
}

export function isMonotonicCountdown(
  observations: BuffExpiryPendingObservation[],
): boolean {
  return observations.every(
    (observation, index) =>
      index === 0 || observation.seconds <= observations[index - 1].seconds,
  );
}

export function isWeakObservation(
  observation: BuffExpiryPendingObservation,
): boolean {
  return observation.strength === "weak";
}

export function isHypothesisObservation(
  observation: BuffExpiryPendingObservation,
): boolean {
  return observation.reason.startsWith("hypothesis");
}

export function getPredictedExpiresSpread(
  observations: BuffExpiryPendingObservation[],
): number {
  const predictedExpiresAt = observations.map(getPredictedObservationExpiresAt);
  return Math.max(...predictedExpiresAt) - Math.min(...predictedExpiresAt);
}

export function getMaxObservationGapMs(
  observations: BuffExpiryPendingObservation[],
): number {
  return observations.reduce((maxGap, observation, index) => {
    if (index === 0) {
      return maxGap;
    }
    return Math.max(
      maxGap,
      observation.observedAt - observations[index - 1].observedAt,
    );
  }, 0);
}

export function getExpectedWeakCountdownDecrease(
  observations: BuffExpiryPendingObservation[],
  minSecondDecrease: number,
): number {
  const first = observations[0];
  const latest = observations[observations.length - 1];
  const observedSeconds = (latest.observedAt - first.observedAt) / 1000;
  return Math.max(minSecondDecrease, Math.floor(observedSeconds) - 2);
}

export function getAverageObservationScore(
  observations: BuffExpiryPendingObservation[],
): number {
  return (
    observations.reduce((sum, observation) => sum + observation.score, 0) /
    observations.length
  );
}

function comparePendingObservationWindows(
  a: BuffExpiryPendingObservation[],
  b: BuffExpiryPendingObservation[],
): number {
  const aStrongCount = a.filter(
    (observation) => observation.strength === "strong",
  ).length;
  const bStrongCount = b.filter(
    (observation) => observation.strength === "strong",
  ).length;
  if (a.length !== b.length) {
    return b.length - a.length;
  }
  if (aStrongCount !== bStrongCount) {
    return bStrongCount - aStrongCount;
  }
  const aDecrease = a.length ? a[0].seconds - a[a.length - 1].seconds : 0;
  const bDecrease = b.length ? b[0].seconds - b[b.length - 1].seconds : 0;
  if (aDecrease !== bDecrease) {
    return bDecrease - aDecrease;
  }
  const aSpan = getPendingObservationSpanMs(a);
  const bSpan = getPendingObservationSpanMs(b);
  if (aSpan !== bSpan) {
    return bSpan - aSpan;
  }
  const scoreDifference =
    getAverageObservationScore(b) - getAverageObservationScore(a);
  return Math.abs(scoreDifference) <= 0.0001 ? 0 : scoreDifference;
}
