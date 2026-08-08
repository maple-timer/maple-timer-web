import type {
  BuffExpiryExpiryCluster,
  BuffExpiryExpiryClusterObservation,
} from "../buffExpiry/buffExpiryTypes";
import {
  BUFF_EXPIRY_CLUSTER_CONFIRM_MIN_DECREASE,
  BUFF_EXPIRY_CLUSTER_CONFIRM_MIN_OBSERVATIONS,
  BUFF_EXPIRY_CLUSTER_CONFIRM_MIN_SPAN_MS,
  BUFF_EXPIRY_CLUSTER_CONFIRM_SPREAD_MS,
  BUFF_EXPIRY_CLUSTER_FAST_CONFIRM_MIN_DISTINCT_SLOTS,
  BUFF_EXPIRY_CLUSTER_FAST_CONFIRM_MIN_OBSERVATIONS,
  BUFF_EXPIRY_CLUSTER_FAST_CONFIRM_MIN_SPAN_MS,
  BUFF_EXPIRY_CLUSTER_FAST_CONFIRM_STRONG_MIN_DISTINCT_SLOTS,
  BUFF_EXPIRY_CLUSTER_MERGE_WINDOW_MS,
  BUFF_EXPIRY_CLUSTER_STRONG_DIVERSE_MIN_DISTINCT_BUFFS,
  BUFF_EXPIRY_CLUSTER_STRONG_DIVERSE_MIN_DISTINCT_SLOTS,
  BUFF_EXPIRY_CLUSTER_STRONG_DIVERSE_MIN_OBSERVATIONS,
  BUFF_EXPIRY_CLUSTER_STRONG_DIVERSE_MIN_SPAN_MS,
  BUFF_EXPIRY_CLUSTER_WEAK_ONLY_MIN_DISTINCT_BUFFS,
  BUFF_EXPIRY_CLUSTER_WEAK_ONLY_TWO_BUFF_MEMBER_MIN_AVERAGE_SCORE,
  BUFF_EXPIRY_CLUSTER_WEAK_ONLY_TWO_BUFF_MEMBER_MIN_DECREASE,
  BUFF_EXPIRY_CLUSTER_WEAK_ONLY_TWO_BUFF_MEMBER_MIN_OBSERVATIONS,
  BUFF_EXPIRY_CLUSTER_WEAK_ONLY_TWO_BUFF_MEMBER_MIN_SPAN_MS,
  BUFF_EXPIRY_CLUSTER_WEAK_ONLY_TWO_BUFF_MIN_DECREASE,
  BUFF_EXPIRY_CLUSTER_WEAK_ONLY_TWO_BUFF_MIN_OBSERVATIONS,
  BUFF_EXPIRY_CLUSTER_WEAK_ONLY_TWO_BUFF_MIN_SECONDS,
  BUFF_EXPIRY_CLUSTER_WEAK_ONLY_TWO_BUFF_MIN_SPAN_MS,
  BUFF_EXPIRY_CLUSTER_WINDOW_MS,
  BUFF_EXPIRY_SINGLE_COUPON_CLUSTER_MAX_GAP_MS,
  BUFF_EXPIRY_SINGLE_COUPON_CLUSTER_MAX_SPREAD_MS,
  BUFF_EXPIRY_SINGLE_COUPON_CLUSTER_MIN_AVERAGE_SCORE,
  BUFF_EXPIRY_SINGLE_COUPON_CLUSTER_MIN_DECREASE,
  BUFF_EXPIRY_SINGLE_COUPON_CLUSTER_MIN_OBSERVATIONS,
  BUFF_EXPIRY_SINGLE_COUPON_CLUSTER_MIN_SPAN_MS,
  BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MAX_LATEST_SECONDS,
  BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MAX_SPREAD_MS,
  BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MAX_TIMING_DRIFT_SECONDS,
  BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MIN_DECREASE,
  BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MIN_SPAN_MS,
  BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_ACCEPTED_PAIR_MIN_SPAN_MS,
  BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MAX_SPREAD_MS,
  BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MIN_ACCEPTED_OBSERVATIONS,
  BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MIN_ACCEPTED_SCORE,
  BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MIN_AVERAGE_SCORE,
  BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MIN_DECREASE,
  BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MIN_OBSERVATIONS,
  BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MIN_SPAN_MS,
} from "./buffExpiryExpiryClusterConfig";
import {
  getAverageExpiryClusterObservationScore,
  getCountdownDecrease,
  getDistinctBuffCount,
  getDistinctSlotCount,
  getExpiryClusterInlierObservations,
  getExpiryClusterObservationCenterDistance,
  getMaxExpiryClusterObservationGapMs,
  getMedian,
  getObservationSpanMs,
  getPredictedExpiresSpreadMs,
  isMonotonicExpiryClusterCountdown,
} from "./buffExpiryExpiryClusterStats";
import { selectExpiryClusterMembers } from "./buffExpiryExpiryClusterTracks";
import {
  BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID,
  BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
  BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
} from "./buffExpiryRuntimeConstants";
import { BUFF_EXPIRY_ALERT_GROUP_WINDOW_MS } from "../buffExpiry/buffExpiryRuntimeTiming";

export { buildBuffExpiryClusterObservations } from "./buffExpiryExpiryClusterObservations";
export { applyConfirmedExpiryClusters } from "./buffExpiryExpiryClusterTracks";

export function updateBuffExpiryClusters(
  previousClusters: BuffExpiryExpiryCluster[],
  observations: BuffExpiryExpiryClusterObservation[],
  now: number,
): BuffExpiryExpiryCluster[] {
  return suppressNearbyConfirmedExpiryClusters(
    updateExpiryClusters(previousClusters, observations, now),
  );
}

function updateExpiryClusters(
  previousClusters: BuffExpiryExpiryCluster[],
  observations: BuffExpiryExpiryClusterObservation[],
  now: number,
): BuffExpiryExpiryCluster[] {
  let clusters = previousClusters
    .map((cluster) => refreshExpiryCluster(cluster, now))
    .filter((cluster): cluster is BuffExpiryExpiryCluster => cluster !== null);

  for (const observation of observations) {
    const nearest = clusters
      .map((cluster, index) => ({
        cluster,
        index,
        distance: Math.abs(
          cluster.centerExpiresAt - observation.predictedExpiresAt,
        ),
      }))
      .filter(({ distance }) => distance <= BUFF_EXPIRY_CLUSTER_MERGE_WINDOW_MS)
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          b.cluster.lastSeenAt - a.cluster.lastSeenAt,
      )[0];

    if (nearest) {
      clusters[nearest.index] =
        refreshExpiryCluster(
          {
            ...nearest.cluster,
            observations: [...nearest.cluster.observations, observation],
          },
          now,
        ) ?? nearest.cluster;
      continue;
    }

    const cluster = refreshExpiryCluster(
      {
        id: `expiry:${Math.round(observation.predictedExpiresAt / 1000)}:${observation.slotKey}`,
        firstSeenAt: observation.observedAt,
        lastSeenAt: observation.observedAt,
        centerExpiresAt: observation.predictedExpiresAt,
        observations: [observation],
        confirmedAt: null,
      },
      now,
    );
    if (cluster) {
      clusters = [...clusters, cluster];
    }
  }

  return clusters;
}

function suppressNearbyConfirmedExpiryClusters(
  clusters: BuffExpiryExpiryCluster[],
): BuffExpiryExpiryCluster[] {
  const keptConfirmedClusters: BuffExpiryExpiryCluster[] = [];
  return [...clusters]
    .sort(
      (a, b) =>
        (a.confirmedAt ?? Number.POSITIVE_INFINITY) -
          (b.confirmedAt ?? Number.POSITIVE_INFINITY) ||
        a.centerExpiresAt - b.centerExpiresAt ||
        a.firstSeenAt - b.firstSeenAt,
    )
    .map((cluster) => {
      if (cluster.confirmedAt === null) {
        return cluster;
      }
      const nearbyConfirmed = keptConfirmedClusters.some(
        (kept) =>
          Math.abs(kept.centerExpiresAt - cluster.centerExpiresAt) <=
          BUFF_EXPIRY_ALERT_GROUP_WINDOW_MS,
      );
      if (nearbyConfirmed) {
        return { ...cluster, confirmedAt: null };
      }
      keptConfirmedClusters.push(cluster);
      return cluster;
    });
}

function refreshExpiryCluster(
  cluster: BuffExpiryExpiryCluster,
  now: number,
): BuffExpiryExpiryCluster | null {
  const observations = cluster.observations
    .filter(
      (observation) =>
        now - observation.observedAt <= BUFF_EXPIRY_CLUSTER_WINDOW_MS,
    )
    .sort(
      (a, b) =>
        a.observedAt - b.observedAt ||
        a.predictedExpiresAt - b.predictedExpiresAt,
    );
  if (!observations.length) {
    return null;
  }

  const centerExpiresAt = getMedian(
    observations.map((observation) => observation.predictedExpiresAt),
  );
  const nextCluster: BuffExpiryExpiryCluster = {
    ...cluster,
    firstSeenAt: observations[0].observedAt,
    lastSeenAt: observations.reduce(
      (latest, observation) => Math.max(latest, observation.observedAt),
      observations[0].observedAt,
    ),
    centerExpiresAt,
    observations,
  };
  return {
    ...nextCluster,
    confirmedAt:
      nextCluster.confirmedAt ??
      (isExpiryClusterConfirmed(nextCluster) ? now : null),
  };
}

function isExpiryClusterConfirmed(cluster: BuffExpiryExpiryCluster): boolean {
  const inliers = getExpiryClusterInlierObservations(cluster);
  if (isSingleSmallPotionExpiryClusterConfirmed(inliers)) {
    return true;
  }
  if (isSingleCouponExpiryClusterConfirmed(inliers)) {
    return true;
  }
  if (!hasDiverseExpiryClusterEvidence(inliers)) {
    return false;
  }
  const members = selectExpiryClusterMembers(cluster);

  const spanMs = getObservationSpanMs(inliers);
  const spreadMs = getPredictedExpiresSpreadMs(inliers);
  const distinctSlotCount = getDistinctSlotCount(inliers);
  const distinctBuffCount = getDistinctBuffCount(inliers);
  const hasStrongAcceptedEvidence =
    hasStrongAcceptedExpiryClusterEvidence(inliers);
  const hasTightExpiry = spreadMs <= BUFF_EXPIRY_CLUSTER_CONFIRM_SPREAD_MS;
  if (
    members.length < 2 &&
    !hasStrongDiverseExpiryClusterConfirmationEvidence({
      observations: inliers,
      memberCount: members.length,
      spanMs,
      distinctSlotCount,
      distinctBuffCount,
    })
  ) {
    return false;
  }
  const hasStrictTwoBuffWeakEvidence =
    !hasStrongAcceptedEvidence &&
    hasTightExpiry &&
    hasStrictTwoBuffWeakOnlyExpiryClusterEvidence(cluster, inliers);
  if (
    !hasStrongAcceptedEvidence &&
    distinctBuffCount < BUFF_EXPIRY_CLUSTER_WEAK_ONLY_MIN_DISTINCT_BUFFS &&
    !hasStrictTwoBuffWeakEvidence
  ) {
    return false;
  }

  const fastConfirmMinDistinctSlots = hasStrongAcceptedEvidence
    ? BUFF_EXPIRY_CLUSTER_FAST_CONFIRM_STRONG_MIN_DISTINCT_SLOTS
    : BUFF_EXPIRY_CLUSTER_FAST_CONFIRM_MIN_DISTINCT_SLOTS;
  const hasBasicConfirmation =
    inliers.length >= BUFF_EXPIRY_CLUSTER_CONFIRM_MIN_OBSERVATIONS &&
    spanMs >= BUFF_EXPIRY_CLUSTER_CONFIRM_MIN_SPAN_MS &&
    getCountdownDecrease(inliers) >= BUFF_EXPIRY_CLUSTER_CONFIRM_MIN_DECREASE;
  const hasFastConfirmation =
    inliers.length >= BUFF_EXPIRY_CLUSTER_FAST_CONFIRM_MIN_OBSERVATIONS &&
    spanMs >= BUFF_EXPIRY_CLUSTER_FAST_CONFIRM_MIN_SPAN_MS &&
    distinctSlotCount >= fastConfirmMinDistinctSlots;
  return (
    hasTightExpiry &&
    (hasBasicConfirmation ||
      hasFastConfirmation ||
      hasStrictTwoBuffWeakEvidence)
  );
}

function hasStrongDiverseExpiryClusterConfirmationEvidence({
  observations,
  memberCount,
  spanMs,
  distinctSlotCount,
  distinctBuffCount,
}: {
  observations: BuffExpiryExpiryClusterObservation[];
  memberCount: number;
  spanMs: number;
  distinctSlotCount: number;
  distinctBuffCount: number;
}): boolean {
  if (memberCount < 1) {
    return false;
  }
  const strongAcceptedCount = observations.filter(
    (observation) =>
      observation.source === "accepted" && observation.strength === "strong",
  ).length;
  return (
    strongAcceptedCount >=
      BUFF_EXPIRY_CLUSTER_STRONG_DIVERSE_MIN_OBSERVATIONS &&
    spanMs >= BUFF_EXPIRY_CLUSTER_STRONG_DIVERSE_MIN_SPAN_MS &&
    distinctSlotCount >=
      BUFF_EXPIRY_CLUSTER_STRONG_DIVERSE_MIN_DISTINCT_SLOTS &&
    distinctBuffCount >= BUFF_EXPIRY_CLUSTER_STRONG_DIVERSE_MIN_DISTINCT_BUFFS
  );
}

function hasStrictTwoBuffWeakOnlyExpiryClusterEvidence(
  cluster: BuffExpiryExpiryCluster,
  observations: BuffExpiryExpiryClusterObservation[],
): boolean {
  if (
    getDistinctBuffCount(observations) !== 2 ||
    getDistinctSlotCount(observations) < 2
  ) {
    return false;
  }
  if (
    observations.some(
      (observation) =>
        observation.seconds <
        BUFF_EXPIRY_CLUSTER_WEAK_ONLY_TWO_BUFF_MIN_SECONDS,
    )
  ) {
    return false;
  }
  if (
    observations.length <
      BUFF_EXPIRY_CLUSTER_WEAK_ONLY_TWO_BUFF_MIN_OBSERVATIONS ||
    getObservationSpanMs(observations) <
      BUFF_EXPIRY_CLUSTER_WEAK_ONLY_TWO_BUFF_MIN_SPAN_MS ||
    getCountdownDecrease(observations) <
      BUFF_EXPIRY_CLUSTER_WEAK_ONLY_TWO_BUFF_MIN_DECREASE
  ) {
    return false;
  }

  const members = selectExpiryClusterMembers(cluster);
  if (members.length < 2) {
    return false;
  }

  return members.every(
    (member) =>
      member.observationCount >=
        BUFF_EXPIRY_CLUSTER_WEAK_ONLY_TWO_BUFF_MEMBER_MIN_OBSERVATIONS &&
      member.observationSpanMs >=
        BUFF_EXPIRY_CLUSTER_WEAK_ONLY_TWO_BUFF_MEMBER_MIN_SPAN_MS &&
      member.predictedExpiresSpreadMs <=
        BUFF_EXPIRY_CLUSTER_CONFIRM_SPREAD_MS &&
      member.countdownDecrease >=
        BUFF_EXPIRY_CLUSTER_WEAK_ONLY_TWO_BUFF_MEMBER_MIN_DECREASE &&
      member.averageScore >=
        BUFF_EXPIRY_CLUSTER_WEAK_ONLY_TWO_BUFF_MEMBER_MIN_AVERAGE_SCORE,
  );
}

function isSingleSmallPotionExpiryClusterConfirmed(
  observations: BuffExpiryExpiryClusterObservation[],
): boolean {
  if (
    getDistinctSlotCount(observations) !== 1 ||
    getDistinctBuffCount(observations) !== 1
  ) {
    return false;
  }
  if (observations[0]?.buffId !== BUFF_EXPIRY_SMALL_POTION_GROUP_ID) {
    return false;
  }

  const acceptedObservations = observations.filter(
    (observation) =>
      observation.source === "accepted" &&
      observation.score >=
        BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MIN_ACCEPTED_SCORE,
  );
  if (
    acceptedObservations.length <
    BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MIN_ACCEPTED_OBSERVATIONS
  ) {
    return false;
  }
  if (hasTightAcceptedSingleSmallPotionCountdownPair(acceptedObservations)) {
    return true;
  }
  if (
    observations.length <
    BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MIN_OBSERVATIONS
  ) {
    return false;
  }
  if (!isMonotonicExpiryClusterCountdown(observations)) {
    return false;
  }

  return (
    getObservationSpanMs(observations) >=
      BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MIN_SPAN_MS &&
    getPredictedExpiresSpreadMs(observations) <=
      BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MAX_SPREAD_MS &&
    getCountdownDecrease(observations) >=
      BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MIN_DECREASE &&
    getAverageExpiryClusterObservationScore(observations) >=
      BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MIN_AVERAGE_SCORE
  );
}

function isSingleCouponExpiryClusterConfirmed(
  observations: BuffExpiryExpiryClusterObservation[],
): boolean {
  if (getDistinctBuffCount(observations) !== 1) {
    return false;
  }
  const buffId = observations[0]?.buffId;
  if (
    buffId !== BUFF_EXPIRY_EXP_COUPON_GROUP_ID &&
    buffId !== BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID
  ) {
    return false;
  }
  if (
    observations.length < BUFF_EXPIRY_SINGLE_COUPON_CLUSTER_MIN_OBSERVATIONS
  ) {
    return false;
  }
  if (!isSingleBuffExpiryClusterSpatiallyCompact(observations)) {
    return false;
  }
  if (!isMonotonicExpiryClusterCountdown(observations)) {
    return false;
  }

  return (
    getObservationSpanMs(observations) >=
      BUFF_EXPIRY_SINGLE_COUPON_CLUSTER_MIN_SPAN_MS &&
    getPredictedExpiresSpreadMs(observations) <=
      BUFF_EXPIRY_SINGLE_COUPON_CLUSTER_MAX_SPREAD_MS &&
    getCountdownDecrease(observations) >=
      BUFF_EXPIRY_SINGLE_COUPON_CLUSTER_MIN_DECREASE &&
    getMaxExpiryClusterObservationGapMs(observations) <=
      BUFF_EXPIRY_SINGLE_COUPON_CLUSTER_MAX_GAP_MS &&
    getAverageExpiryClusterObservationScore(observations) >=
      BUFF_EXPIRY_SINGLE_COUPON_CLUSTER_MIN_AVERAGE_SCORE
  );
}

function isSingleBuffExpiryClusterSpatiallyCompact(
  observations: BuffExpiryExpiryClusterObservation[],
): boolean {
  if (!observations.length) {
    return false;
  }
  const maxSide = Math.max(
    ...observations.map((observation) =>
      Math.max(
        observation.box.width,
        observation.box.height,
        observation.box.side ?? 0,
      ),
    ),
  );
  const maxAllowedDistance = Math.max(12, maxSide * 1.25);
  for (let left = 0; left < observations.length; left += 1) {
    for (let right = left + 1; right < observations.length; right += 1) {
      if (
        getExpiryClusterObservationCenterDistance(
          observations[left],
          observations[right],
        ) > maxAllowedDistance
      ) {
        return false;
      }
    }
  }
  return true;
}

function hasTightAcceptedSingleSmallPotionCountdownPair(
  observations: BuffExpiryExpiryClusterObservation[],
): boolean {
  if (
    observations.length <
    BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_MIN_ACCEPTED_OBSERVATIONS
  ) {
    return false;
  }

  const sorted = [...observations].sort(
    (a, b) => a.observedAt - b.observedAt || a.seconds - b.seconds,
  );
  const first = sorted[0];
  const latest = sorted[sorted.length - 1];
  const observedSpanSeconds = (latest.observedAt - first.observedAt) / 1000;
  const countdownDecrease = first.seconds - latest.seconds;
  const timingDrift = Math.abs(countdownDecrease - observedSpanSeconds);

  return (
    getObservationSpanMs(sorted) >=
      BUFF_EXPIRY_SINGLE_SMALL_POTION_CLUSTER_ACCEPTED_PAIR_MIN_SPAN_MS &&
    getPredictedExpiresSpreadMs(sorted) <=
      BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MAX_SPREAD_MS &&
    countdownDecrease >=
      BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MIN_DECREASE &&
    latest.seconds <=
      BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MAX_LATEST_SECONDS &&
    timingDrift <=
      BUFF_EXPIRY_SINGLE_SMALL_POTION_ACCEPTED_PAIR_MAX_TIMING_DRIFT_SECONDS &&
    isMonotonicExpiryClusterCountdown(sorted)
  );
}

function hasDiverseExpiryClusterEvidence(
  observations: BuffExpiryExpiryClusterObservation[],
): boolean {
  if (observations.length < 2) {
    return false;
  }
  return (
    new Set(observations.map((observation) => observation.slotKey)).size >= 2
  );
}

function hasStrongAcceptedExpiryClusterEvidence(
  observations: BuffExpiryExpiryClusterObservation[],
): boolean {
  return observations.some(
    (observation) =>
      observation.source === "accepted" && observation.strength === "strong",
  );
}
