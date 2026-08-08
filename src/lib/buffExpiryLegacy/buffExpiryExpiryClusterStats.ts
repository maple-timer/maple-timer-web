import type {
  BuffExpiryExpiryCluster,
  BuffExpiryExpiryClusterObservation,
} from "../buffExpiry/buffExpiryTypes";
import { BUFF_EXPIRY_CLUSTER_INLIER_WINDOW_MS } from "./buffExpiryExpiryClusterConfig";

export function getExpiryClusterInlierObservations(
  cluster: BuffExpiryExpiryCluster,
): BuffExpiryExpiryClusterObservation[] {
  return cluster.observations.filter(
    (observation) =>
      Math.abs(observation.predictedExpiresAt - cluster.centerExpiresAt) <=
      BUFF_EXPIRY_CLUSTER_INLIER_WINDOW_MS,
  );
}

export function getObservationSpanMs(
  observations: BuffExpiryExpiryClusterObservation[],
): number {
  if (!observations.length) {
    return 0;
  }
  const observedAt = observations.map((observation) => observation.observedAt);
  return Math.max(...observedAt) - Math.min(...observedAt);
}

export function getMaxExpiryClusterObservationGapMs(
  observations: BuffExpiryExpiryClusterObservation[],
): number {
  const sorted = [...observations].sort(
    (a, b) => a.observedAt - b.observedAt || a.seconds - b.seconds,
  );
  return sorted.reduce((maxGap, observation, index) => {
    if (index === 0) {
      return maxGap;
    }
    return Math.max(
      maxGap,
      observation.observedAt - sorted[index - 1].observedAt,
    );
  }, 0);
}

export function getPredictedExpiresSpreadMs(
  observations: BuffExpiryExpiryClusterObservation[],
): number {
  if (!observations.length) {
    return 0;
  }
  const predictedExpiresAt = observations.map(
    (observation) => observation.predictedExpiresAt,
  );
  return Math.max(...predictedExpiresAt) - Math.min(...predictedExpiresAt);
}

export function getCountdownDecrease(
  observations: BuffExpiryExpiryClusterObservation[],
): number {
  let decrease = 0;
  for (const earlier of observations) {
    for (const later of observations) {
      if (later.observedAt > earlier.observedAt) {
        decrease = Math.max(decrease, earlier.seconds - later.seconds);
      }
    }
  }
  return decrease;
}

export function getDistinctSlotCount(
  observations: BuffExpiryExpiryClusterObservation[],
): number {
  return new Set(observations.map((observation) => observation.slotKey)).size;
}

export function getDistinctBuffCount(
  observations: BuffExpiryExpiryClusterObservation[],
): number {
  return new Set(observations.map((observation) => observation.buffId)).size;
}

export function getAverageExpiryClusterObservationScore(
  observations: BuffExpiryExpiryClusterObservation[],
): number {
  return (
    observations.reduce((sum, observation) => sum + observation.score, 0) /
    observations.length
  );
}

export function isMonotonicExpiryClusterCountdown(
  observations: BuffExpiryExpiryClusterObservation[],
): boolean {
  const sorted = [...observations].sort(
    (a, b) => a.observedAt - b.observedAt || a.seconds - b.seconds,
  );
  return sorted.every(
    (observation, index) =>
      index === 0 || observation.seconds <= sorted[index - 1].seconds,
  );
}

export function getExpiryClusterObservationCenterDistance(
  a: BuffExpiryExpiryClusterObservation,
  b: BuffExpiryExpiryClusterObservation,
): number {
  const ax = a.box.x + a.box.width / 2;
  const ay = a.box.y + a.box.height / 2;
  const bx = b.box.x + b.box.width / 2;
  const by = b.box.y + b.box.height / 2;
  return Math.hypot(ax - bx, ay - by);
}

export function groupBy<T>(
  items: T[],
  getKey: (item: T) => string,
): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    result.set(key, [...(result.get(key) ?? []), item]);
  }
  return result;
}

export function getMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : Math.round(sorted[middle]);
}
