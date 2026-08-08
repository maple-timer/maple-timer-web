import type {
  BuffExpiryBox,
  BuffExpiryPendingTrack,
  BuffExpiryPrecisionTrackingObservation,
  BuffExpiryPrecisionTrackingResult,
  BuffExpiryTrackedBuff,
} from "../../../domain/buff-expiry/precisionTrackingTypes";
import { reconcileBuffExpiryPrecisionTracking } from "../../../domain/buff-expiry/precisionTrackingReconciliation";
import { BUFF_EXPIRY_PRECISION_GROUP_MAX_TRACKS } from "../../../domain/buff-expiry/precisionTrackingPolicy";
import { getBuffExpiryBoxPreviewDataUrlForBox } from "../../../lib/buffExpiry/buffExpiryEvidence";
import type {
  BuffExpiryPrecisionBestGroupCandidate,
  BuffExpiryPrecisionIconObservation,
  BuffExpiryPrecisionTargetGroup,
} from "../../../runtime/buff-expiry/analysis/buffExpiryPrecisionAnalysisRuntime";
import {
  toAcceptedExactObservation,
  toBuffExpiryPrecisionContinuityCandidates,
} from "./buffExpiryPrecisionTrackingObservations";

export type { BuffExpiryPrecisionTrackingResult } from "../../../domain/buff-expiry/precisionTrackingTypes";

export function reconcileBuffExpiryPrecisionTracks({
  previousTracks,
  previousPendingTracks,
  observations,
  bestByGroup,
  now,
  boxes = [],
  boxPreviewUrls = null,
}: {
  previousTracks: BuffExpiryTrackedBuff[];
  previousPendingTracks: BuffExpiryPendingTrack[];
  observations: BuffExpiryPrecisionIconObservation[];
  bestByGroup: BuffExpiryPrecisionBestGroupCandidate[];
  now: number;
  boxes?: BuffExpiryBox[];
  boxPreviewUrls?: Record<string, string> | null;
}): BuffExpiryPrecisionTrackingResult {
  const positionExcludedGroups = getPositionExcludedSingleSlotGroups(bestByGroup);
  const trackingObservations = observations
    .flatMap((observation) => toAcceptedExactObservation(observation, now))
    .filter((observation) => !positionExcludedGroups.has(observation.group))
    .map((observation): BuffExpiryPrecisionTrackingObservation => ({
      ...observation,
      normalizedIconDataUrl: getBuffExpiryBoxPreviewDataUrlForBox({
        box: observation.box,
        boxes,
        boxPreviewUrls,
      }),
    }));

  return reconcileBuffExpiryPrecisionTracking({
    previousTracks,
    previousPendingTracks,
    observations: trackingObservations,
    continuityCandidates: toBuffExpiryPrecisionContinuityCandidates(bestByGroup),
    positionExcludedGroups,
    now,
  });
}

function getPositionExcludedSingleSlotGroups(
  bestByGroup: BuffExpiryPrecisionBestGroupCandidate[],
): Set<BuffExpiryPrecisionTargetGroup> {
  const groups = new Set<BuffExpiryPrecisionTargetGroup>();
  for (const candidate of bestByGroup) {
    if (BUFF_EXPIRY_PRECISION_GROUP_MAX_TRACKS[candidate.group] !== 1) {
      continue;
    }
    if (!isPositionExcludedDecisionReason(candidate.decisionReason)) {
      continue;
    }
    if (candidate.matcherAccepted !== true) {
      continue;
    }
    groups.add(candidate.group);
  }
  return groups;
}

function isPositionExcludedDecisionReason(decisionReason: string): boolean {
  return (
    decisionReason.startsWith("upper_rows_target_excluded:") ||
    decisionReason.startsWith("first_row_target_excluded:") ||
    decisionReason.startsWith("bottom_first_target_excluded:")
  );
}
