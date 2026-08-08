import type {
  BuffExpiryExpiryCluster,
  BuffExpiryPendingTrack,
  BuffExpiryTemporalCandidateTrack,
} from "./buffExpiryTypes";

const BUFF_EXPIRY_TEMPORAL_DISPLAY_MIN_OBSERVATIONS = 4;
const BUFF_EXPIRY_TEMPORAL_DISPLAY_MIN_SPAN_MS = 6_000;
const BUFF_EXPIRY_TEMPORAL_DISPLAY_MAX_EXPIRES_SPREAD_MS = 3_000;
const BUFF_EXPIRY_TEMPORAL_DISPLAY_MIN_SECONDS = 21;
const BUFF_EXPIRY_TEMPORAL_DISPLAY_MAX_SECONDS = 59;
const BUFF_EXPIRY_CLUSTER_DISPLAY_MIN_OBSERVATIONS = 3;
const BUFF_EXPIRY_CLUSTER_DISPLAY_MIN_SPAN_MS = 3_000;
const BUFF_EXPIRY_CLUSTER_DISPLAY_MIN_TEMPORAL_DISTINCT_SLOTS = 3;
const BUFF_EXPIRY_CLUSTER_DISPLAY_MIN_TEMPORAL_DISTINCT_BUFFS = 3;
const BUFF_EXPIRY_CLUSTER_DISPLAY_MIN_STRONG_DISTINCT_SLOTS = 2;
const BUFF_EXPIRY_CLUSTER_DISPLAY_INLIER_WINDOW_MS = 4_000;

export function getBuffExpiryConfirmationCandidateCount({
  pendingTracks,
  temporalCandidateTracks,
  expiryClusters,
}: {
  pendingTracks: BuffExpiryPendingTrack[];
  temporalCandidateTracks: BuffExpiryTemporalCandidateTrack[];
  expiryClusters: BuffExpiryExpiryCluster[];
}): number {
  const trackCandidateCount = [
    ...pendingTracks,
    ...temporalCandidateTracks,
  ].filter(isDisplayableBuffExpiryCandidateTrack).length;
  const clusterCandidateCount = expiryClusters.filter(
    isDisplayableBuffExpiryCluster,
  ).length;
  return Math.max(trackCandidateCount, clusterCandidateCount);
}

function isDisplayableBuffExpiryCandidateTrack(
  track: BuffExpiryPendingTrack,
): boolean {
  if (
    track.observations.some(
      (observation) => observation.strength === "strong",
    )
  ) {
    return true;
  }
  const temporalObservations = track.observations
    .filter(isDisplayableTemporalObservation)
    .sort((a, b) => a.observedAt - b.observedAt);
  return (
    temporalObservations.length >=
      BUFF_EXPIRY_TEMPORAL_DISPLAY_MIN_OBSERVATIONS &&
    getObservationSpanMs(temporalObservations) >=
      BUFF_EXPIRY_TEMPORAL_DISPLAY_MIN_SPAN_MS &&
    getPredictedExpiresSpreadMs(temporalObservations) <=
      BUFF_EXPIRY_TEMPORAL_DISPLAY_MAX_EXPIRES_SPREAD_MS &&
    isMonotonicCountdown(temporalObservations)
  );
}

function isDisplayableBuffExpiryCluster(
  cluster: BuffExpiryExpiryCluster,
): boolean {
  if (cluster.confirmedAt !== null) {
    return true;
  }
  const inliers = cluster.observations.filter(
    (observation) =>
      Math.abs(observation.predictedExpiresAt - cluster.centerExpiresAt) <=
      BUFF_EXPIRY_CLUSTER_DISPLAY_INLIER_WINDOW_MS,
  );
  if (
    inliers.length < BUFF_EXPIRY_CLUSTER_DISPLAY_MIN_OBSERVATIONS ||
    getObservationSpanMs(inliers) < BUFF_EXPIRY_CLUSTER_DISPLAY_MIN_SPAN_MS
  ) {
    return false;
  }
  const distinctSlotCount = new Set(
    inliers.map((observation) => observation.slotKey),
  ).size;
  const hasStrongAcceptedEvidence = inliers.some(
    (observation) =>
      observation.source === "accepted" && observation.strength === "strong",
  );
  if (hasStrongAcceptedEvidence) {
    return (
      distinctSlotCount >= BUFF_EXPIRY_CLUSTER_DISPLAY_MIN_STRONG_DISTINCT_SLOTS
    );
  }
  const distinctBuffCount = new Set(
    inliers.map((observation) => observation.buffId),
  ).size;
  return (
    distinctSlotCount >=
      BUFF_EXPIRY_CLUSTER_DISPLAY_MIN_TEMPORAL_DISTINCT_SLOTS &&
    distinctBuffCount >= BUFF_EXPIRY_CLUSTER_DISPLAY_MIN_TEMPORAL_DISTINCT_BUFFS
  );
}

function isDisplayableTemporalObservation(observation: {
  seconds: number;
  strength: string;
  reason: string;
}): boolean {
  return (
    observation.reason === "temporal-low-score" &&
    observation.strength === "weak" &&
    observation.seconds >= BUFF_EXPIRY_TEMPORAL_DISPLAY_MIN_SECONDS &&
    observation.seconds <= BUFF_EXPIRY_TEMPORAL_DISPLAY_MAX_SECONDS
  );
}

function getObservationSpanMs(observations: Array<{ observedAt: number }>): number {
  if (!observations.length) {
    return 0;
  }
  const observedAt = observations.map((observation) => observation.observedAt);
  return Math.max(...observedAt) - Math.min(...observedAt);
}

function getPredictedExpiresSpreadMs(
  observations: Array<{ observedAt: number; seconds: number }>,
): number {
  if (!observations.length) {
    return 0;
  }
  const predictedExpiresAt = observations.map(
    (observation) => observation.observedAt + observation.seconds * 1000,
  );
  return Math.max(...predictedExpiresAt) - Math.min(...predictedExpiresAt);
}

function isMonotonicCountdown(observations: Array<{ seconds: number }>): boolean {
  return observations.every(
    (observation, index) =>
      index === 0 || observation.seconds <= observations[index - 1].seconds,
  );
}
