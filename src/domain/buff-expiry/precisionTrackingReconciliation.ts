import type { BuffExpiryTargetGroup } from "../../contracts/recognition/buffExpiryRecognition";
import {
  appendBuffExpiryPrecisionPendingObservation,
  confirmBuffExpiryPrecisionPendingTrack,
} from "./precisionTrackingConfirmation";
import { applyBuffExpiryPrecisionContinuityAssist } from "./precisionTrackingContinuity";
import {
  capBuffExpiryPrecisionPendingTracks,
  capBuffExpiryPrecisionTracks,
} from "./precisionTrackingLimits";
import {
  findMatchingBuffExpiryPrecisionPendingTrack,
  findMatchingBuffExpiryPrecisionTrack,
  hasActiveConflictingBuffExpiryPrecisionTrack,
  isActiveAlertedBuffExpiryPrecisionTrack,
  isBuffExpiryPrecisionObservationSuppressedByActiveAlert,
  pruneBuffExpiryPrecisionPendingTracks,
  pruneBuffExpiryPrecisionTracks,
  removeSuppressedBuffExpiryPrecisionPendingTracks,
} from "./precisionTrackingMatching";
import {
  getDerivedRemainingSeconds,
  isBuffExpiryPrecisionConfirmationSecond,
} from "./precisionTrackingObservations";
import { getBuffExpiryPrecisionGroupFromBuffId } from "./precisionTrackingPolicy";
import type {
  BuffExpiryPendingTrack,
  BuffExpiryPrecisionConfirmedTransition,
  BuffExpiryPrecisionContinuityCandidate,
  BuffExpiryPrecisionTrackingObservation,
  BuffExpiryPrecisionTrackingResult,
  BuffExpiryTrackedBuff,
} from "./precisionTrackingTypes";

const NO_POSITION_EXCLUDED_GROUPS = new Set<BuffExpiryTargetGroup>();

export function reconcileBuffExpiryPrecisionTracking({
  previousTracks,
  previousPendingTracks,
  observations,
  continuityCandidates,
  positionExcludedGroups = NO_POSITION_EXCLUDED_GROUPS,
  now,
}: {
  previousTracks: BuffExpiryTrackedBuff[];
  previousPendingTracks: BuffExpiryPendingTrack[];
  observations: BuffExpiryPrecisionTrackingObservation[];
  continuityCandidates: BuffExpiryPrecisionContinuityCandidate[];
  positionExcludedGroups?: ReadonlySet<BuffExpiryTargetGroup>;
  now: number;
}): BuffExpiryPrecisionTrackingResult {
  let tracks = pruneBuffExpiryPrecisionTracks(previousTracks, now);
  let pendingTracks = pruneBuffExpiryPrecisionPendingTracks(previousPendingTracks, now);
  tracks = removePositionExcludedBuffExpiryPrecisionTracks(tracks, positionExcludedGroups);
  pendingTracks = removePositionExcludedBuffExpiryPrecisionPendingTracks(
    pendingTracks,
    positionExcludedGroups,
  );
  pendingTracks = removeSuppressedBuffExpiryPrecisionPendingTracks(pendingTracks, tracks, now);
  const matchedTrackIdsThisSample = new Set<string>();
  const matchedPendingTrackIdsThisSample = new Set<string>();
  const confirmedTransitions: BuffExpiryPrecisionConfirmedTransition[] = [];

  for (const observation of observations) {
    const existingTrack = findMatchingBuffExpiryPrecisionTrack(
      tracks,
      observation,
      matchedTrackIdsThisSample,
    );
    if (existingTrack) {
      if (isActiveAlertedBuffExpiryPrecisionTrack(existingTrack, now)) {
        continue;
      }
      matchedTrackIdsThisSample.add(existingTrack.id);
      tracks = replaceBuffExpiryPrecisionTrack(
        tracks,
        updateTrackFromExactObservation(existingTrack, observation),
      );
      continue;
    }

    if (isBuffExpiryPrecisionObservationSuppressedByActiveAlert(tracks, observation, now)) {
      continue;
    }

    if (hasActiveConflictingBuffExpiryPrecisionTrack(tracks, observation, now)) {
      continue;
    }

    if (!isBuffExpiryPrecisionConfirmationSecond(observation.seconds)) {
      continue;
    }

    const previousPending = findMatchingBuffExpiryPrecisionPendingTrack(
      pendingTracks,
      observation,
      matchedPendingTrackIdsThisSample,
    );
    const nextPending = appendBuffExpiryPrecisionPendingObservation(
      previousPending,
      observation,
      observation.normalizedIconDataUrl,
    );
    matchedPendingTrackIdsThisSample.add(nextPending.id);
    pendingTracks = replaceBuffExpiryPrecisionPendingTrack(pendingTracks, nextPending);
    const confirmedTrack = confirmBuffExpiryPrecisionPendingTrack(nextPending);
    if (confirmedTrack) {
      confirmedTransitions.push({
        transition: "pending-to-confirmed",
        group: observation.group,
        trackId: confirmedTrack.id,
        acceptedSeconds: observation.seconds,
        observedAt: observation.observedAt,
        derivedSeconds: confirmedTrack.detectedSeconds,
        detectedAt: confirmedTrack.detectedAt,
        expiresAt: confirmedTrack.expiresAt,
        alertedAt: confirmedTrack.alertedAt,
      });
      matchedTrackIdsThisSample.add(confirmedTrack.id);
      tracks = replaceBuffExpiryPrecisionTrack(tracks, confirmedTrack);
      pendingTracks = pendingTracks.filter((track) => track.id !== nextPending.id);
    }
  }

  tracks = applyBuffExpiryPrecisionContinuityAssist(tracks, continuityCandidates, now);
  tracks = capBuffExpiryPrecisionTracks(tracks, now);
  pendingTracks = capBuffExpiryPrecisionPendingTracks(pendingTracks);
  const survivingTrackIds = new Set(tracks.map((track) => track.id));

  return {
    tracks,
    pendingTracks,
    confirmationCandidateCount: pendingTracks.length,
    confirmedTransitions: confirmedTransitions.filter((transition) =>
      survivingTrackIds.has(transition.trackId),
    ),
  };
}

function removePositionExcludedBuffExpiryPrecisionTracks(
  tracks: BuffExpiryTrackedBuff[],
  groups: ReadonlySet<BuffExpiryTargetGroup>,
): BuffExpiryTrackedBuff[] {
  if (!groups.size) {
    return tracks;
  }
  return tracks.filter((track) => {
    if (track.alertedAt !== null) {
      return true;
    }
    const group = getBuffExpiryPrecisionGroupFromBuffId(track.buffId);
    return !group || !groups.has(group);
  });
}

function removePositionExcludedBuffExpiryPrecisionPendingTracks(
  pendingTracks: BuffExpiryPendingTrack[],
  groups: ReadonlySet<BuffExpiryTargetGroup>,
): BuffExpiryPendingTrack[] {
  if (!groups.size) {
    return pendingTracks;
  }
  return pendingTracks.filter((track) => {
    const group = getBuffExpiryPrecisionGroupFromBuffId(track.buffId);
    return !group || !groups.has(group);
  });
}

function updateTrackFromExactObservation(
  track: BuffExpiryTrackedBuff,
  observation: BuffExpiryPrecisionTrackingObservation,
): BuffExpiryTrackedBuff {
  return {
    ...track,
    box: observation.box,
    normalizedIconDataUrl:
      observation.normalizedIconDataUrl ?? track.normalizedIconDataUrl ?? null,
    detectedSeconds: getDerivedRemainingSeconds(track.expiresAt, observation.observedAt),
    detectedAt: observation.observedAt,
    lastSeenAt: observation.observedAt,
    score: Math.max(track.score, observation.score),
  };
}

function replaceBuffExpiryPrecisionTrack(
  tracks: BuffExpiryTrackedBuff[],
  nextTrack: BuffExpiryTrackedBuff,
): BuffExpiryTrackedBuff[] {
  const existingIndex = tracks.findIndex((track) => track.id === nextTrack.id);
  if (existingIndex < 0) {
    return [...tracks, nextTrack];
  }
  const nextTracks = [...tracks];
  nextTracks[existingIndex] = nextTrack;
  return nextTracks;
}

function replaceBuffExpiryPrecisionPendingTrack(
  pendingTracks: BuffExpiryPendingTrack[],
  nextTrack: BuffExpiryPendingTrack,
): BuffExpiryPendingTrack[] {
  const existingIndex = pendingTracks.findIndex((track) => track.id === nextTrack.id);
  if (existingIndex < 0) {
    return [...pendingTracks, nextTrack];
  }
  const nextTracks = [...pendingTracks];
  nextTracks[existingIndex] = nextTrack;
  return nextTracks;
}
