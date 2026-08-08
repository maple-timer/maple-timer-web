import type {
  BuffExpiryBox,
  BuffExpiryExpiryCluster,
  BuffExpiryExpiryClusterObservation,
  BuffExpiryTrackedBuff,
} from "../buffExpiry/buffExpiryTypes";
import {
  BUFF_EXPIRY_CLUSTER_CONFIRM_SPREAD_MS,
  BUFF_EXPIRY_CLUSTER_MEMBER_MATCH_WINDOW_MS,
  BUFF_EXPIRY_CLUSTER_WEAK_MEMBER_MIN_OBSERVATIONS,
} from "./buffExpiryExpiryClusterConfig";
import {
  getCountdownDecrease,
  getExpiryClusterInlierObservations,
  getObservationSpanMs,
  getPredictedExpiresSpreadMs,
  groupBy,
} from "./buffExpiryExpiryClusterStats";
import {
  getBuffExpirySlotKey,
  isActiveOrRecentlyAlertedTrack,
} from "../buffExpiry/buffExpiryRuntimeTiming";

export function applyConfirmedExpiryClusters(
  tracks: BuffExpiryTrackedBuff[],
  clusters: BuffExpiryExpiryCluster[],
  now: number,
): BuffExpiryTrackedBuff[] {
  let nextTracks = tracks;
  for (const cluster of clusters) {
    if (cluster.confirmedAt === null) {
      continue;
    }
    for (const member of selectExpiryClusterMembers(cluster)) {
      nextTracks = upsertExpiryClusterMemberTrack(
        nextTracks,
        member,
        cluster,
        now,
      );
    }
  }
  return nextTracks;
}

type ExpiryClusterMember = {
  buffId: string;
  name: string;
  slotKey: string;
  box: BuffExpiryBox;
  latestObservation: BuffExpiryExpiryClusterObservation;
  observationCount: number;
  strongObservationCount: number;
  averageScore: number;
  observationSpanMs: number;
  predictedExpiresSpreadMs: number;
  countdownDecrease: number;
};

export function selectExpiryClusterMembers(
  cluster: BuffExpiryExpiryCluster,
): ExpiryClusterMember[] {
  const bySlot = groupBy(
    getExpiryClusterInlierObservations(cluster),
    (observation) => observation.slotKey,
  );
  const candidatesBySlot = new Map(
    [...bySlot.entries()].map(([slotKey, observations]) => [
      slotKey,
      selectExpiryClusterSlotMembers(observations, cluster.centerExpiresAt),
    ]),
  );
  const candidates = [...candidatesBySlot.values()]
    .flat()
    .sort(compareExpiryClusterMembers);
  const selected: ExpiryClusterMember[] = [];
  const usedBuffIds = new Set<string>();
  const usedSlotKeys = new Set<string>();

  for (const candidate of candidates) {
    if (
      usedBuffIds.has(candidate.buffId) ||
      usedSlotKeys.has(candidate.slotKey)
    ) {
      continue;
    }

    const remainingSlotCandidates = (
      candidatesBySlot.get(candidate.slotKey) ?? []
    )
      .filter((member) => !usedBuffIds.has(member.buffId))
      .sort(compareExpiryClusterMembers);
    if (remainingSlotCandidates[0] !== candidate) {
      continue;
    }
    if (
      remainingSlotCandidates[1] &&
      compareExpiryClusterMembers(candidate, remainingSlotCandidates[1]) === 0
    ) {
      usedSlotKeys.add(candidate.slotKey);
      continue;
    }

    selected.push(candidate);
    usedBuffIds.add(candidate.buffId);
    usedSlotKeys.add(candidate.slotKey);
  }

  return selected;
}

function selectExpiryClusterSlotMembers(
  observations: BuffExpiryExpiryClusterObservation[],
  centerExpiresAt: number,
): ExpiryClusterMember[] {
  return [
    ...groupBy(observations, (observation) => observation.buffId).values(),
  ]
    .map((items) => toExpiryClusterMember(items, centerExpiresAt))
    .filter((member): member is ExpiryClusterMember => member !== null)
    .filter(isEligibleExpiryClusterMember)
    .sort(compareExpiryClusterMembers);
}

function toExpiryClusterMember(
  observations: BuffExpiryExpiryClusterObservation[],
  centerExpiresAt: number,
): ExpiryClusterMember | null {
  const sorted = observations
    .filter(
      (observation) =>
        Math.abs(observation.predictedExpiresAt - centerExpiresAt) <=
        BUFF_EXPIRY_CLUSTER_MEMBER_MATCH_WINDOW_MS,
    )
    .sort((a, b) => a.observedAt - b.observedAt || b.score - a.score);
  if (!sorted.length) {
    return null;
  }
  const latestObservation = sorted[sorted.length - 1];
  return {
    buffId: latestObservation.buffId,
    name: latestObservation.name,
    slotKey: latestObservation.slotKey,
    box: latestObservation.box,
    latestObservation,
    observationCount: sorted.length,
    strongObservationCount: sorted.filter(
      (observation) =>
        observation.source === "accepted" && observation.strength === "strong",
    ).length,
    averageScore:
      sorted.reduce((sum, observation) => sum + observation.score, 0) /
      sorted.length,
    observationSpanMs: getObservationSpanMs(sorted),
    predictedExpiresSpreadMs: getPredictedExpiresSpreadMs(sorted),
    countdownDecrease: getCountdownDecrease(sorted),
  };
}

function isEligibleExpiryClusterMember(member: ExpiryClusterMember): boolean {
  return (
    member.observationCount >=
      BUFF_EXPIRY_CLUSTER_WEAK_MEMBER_MIN_OBSERVATIONS &&
    member.observationSpanMs >= 1000 &&
    member.predictedExpiresSpreadMs <= BUFF_EXPIRY_CLUSTER_CONFIRM_SPREAD_MS &&
    member.countdownDecrease >= 1
  );
}

function compareExpiryClusterMembers(
  a: ExpiryClusterMember,
  b: ExpiryClusterMember,
): number {
  if (a.strongObservationCount !== b.strongObservationCount) {
    return b.strongObservationCount - a.strongObservationCount;
  }
  if (a.observationCount !== b.observationCount) {
    return b.observationCount - a.observationCount;
  }
  const scoreDifference = b.averageScore - a.averageScore;
  return Math.abs(scoreDifference) <= 0.0001 ? 0 : scoreDifference;
}

function upsertExpiryClusterMemberTrack(
  tracks: BuffExpiryTrackedBuff[],
  member: ExpiryClusterMember,
  cluster: BuffExpiryExpiryCluster,
  now: number,
): BuffExpiryTrackedBuff[] {
  const nearExistingIndex = tracks.findIndex(
    (track) =>
      isActiveOrRecentlyAlertedTrack(track, now) &&
      (track.buffId === member.buffId ||
        getBuffExpirySlotKey(track.box) === member.slotKey) &&
      Math.abs(track.expiresAt - cluster.centerExpiresAt) <=
        BUFF_EXPIRY_CLUSTER_MEMBER_MATCH_WINDOW_MS,
  );
  const blockingTrack = tracks.find(
    (track) =>
      isActiveOrRecentlyAlertedTrack(track, now) &&
      (track.buffId === member.buffId ||
        getBuffExpirySlotKey(track.box) === member.slotKey) &&
      Math.abs(track.expiresAt - cluster.centerExpiresAt) >
        BUFF_EXPIRY_CLUSTER_MEMBER_MATCH_WINDOW_MS,
  );
  if (nearExistingIndex === -1 && blockingTrack) {
    return tracks;
  }

  const previous = nearExistingIndex >= 0 ? tracks[nearExistingIndex] : null;
  const observation = member.latestObservation;
  const nextTrack: BuffExpiryTrackedBuff = {
    id:
      previous?.buffId === member.buffId
        ? previous.id
        : `${member.buffId}:${Math.round(cluster.centerExpiresAt / 1000)}`,
    buffId: member.buffId,
    name: member.name,
    box: member.box,
    detectedSeconds: observation.seconds,
    detectedAt: observation.observedAt,
    expiresAt: cluster.centerExpiresAt,
    lastSeenAt: Math.max(
      previous?.lastSeenAt ?? observation.observedAt,
      observation.observedAt,
    ),
    alertedAt: previous?.alertedAt ?? null,
    score: observation.score,
  };

  if (nearExistingIndex >= 0) {
    return tracks.map((track, index) =>
      index === nearExistingIndex ? nextTrack : track,
    );
  }
  return [...tracks, nextTrack];
}
