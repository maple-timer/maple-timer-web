import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryExpiryClusterObservation,
  BuffExpiryTemporalCandidateMatch,
} from "../buffExpiry/buffExpiryTypes";
import {
  BUFF_EXPIRY_CLUSTER_MAX_SECONDS,
  BUFF_EXPIRY_CLUSTER_MIN_SECONDS,
} from "./buffExpiryExpiryClusterConfig";
import { getBuffExpirySlotKey } from "../buffExpiry/buffExpiryRuntimeTiming";

export function buildBuffExpiryClusterObservations(
  acceptedMatches: BuffExpiryAcceptedMatch[],
  temporalCandidateMatches: BuffExpiryTemporalCandidateMatch[],
  now: number,
): BuffExpiryExpiryClusterObservation[] {
  return [
    ...acceptedMatches.map((match) =>
      makeExpiryClusterObservation(match, now, "accepted" as const),
    ),
    ...temporalCandidateMatches.map((match) =>
      makeExpiryClusterObservation(match, now, "temporal" as const),
    ),
  ].filter(
    (observation) =>
      observation.seconds >= BUFF_EXPIRY_CLUSTER_MIN_SECONDS &&
      observation.seconds <= BUFF_EXPIRY_CLUSTER_MAX_SECONDS,
  );
}

function makeExpiryClusterObservation(
  match: BuffExpiryAcceptedMatch,
  now: number,
  source: BuffExpiryExpiryClusterObservation["source"],
): BuffExpiryExpiryClusterObservation {
  return {
    observedAt: now,
    buffId: match.buffId,
    name: match.name,
    slotKey: getBuffExpirySlotKey(match.box),
    seconds: match.seconds,
    predictedExpiresAt: now + match.seconds * 1000,
    score: match.score,
    strength: match.strength,
    reason: match.reason,
    source,
    box: match.box,
  };
}
