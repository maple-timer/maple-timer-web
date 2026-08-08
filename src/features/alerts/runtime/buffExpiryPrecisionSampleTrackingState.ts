import type {
  BuffExpiryBox,
  BuffExpiryPendingTrack,
  BuffExpiryPrecisionConfirmedTransition,
  BuffExpiryTrackedBuff,
} from "../../../domain/buff-expiry/precisionTrackingTypes";
import { preserveBuffExpiryPrecisionAlertMarkers } from "./buffExpiryPrecisionRuntimeDiagnostics";
import {
  createBuffExpiryPrecisionDiagnosticRoiPreview,
} from "../../../platform/frame-capture/buff-expiry/buffExpiryPrecisionCapture";
import {
  appendBuffExpiryPrecisionRecentRoiFrame,
  createBuffExpiryPrecisionRecentRoiFrame,
  selectBuffExpiryPrecisionRoiFrameReason,
} from "../../../runtime/buff-expiry/evidence/buffExpiryPrecisionRoiHistory";
import { reconcileBuffExpiryPrecisionTracks } from "./buffExpiryPrecisionTracking";
import {
  getBuffExpiryPrecisionGroupFromBuffId,
  getBuffExpiryPrecisionSelectedTargetGroupSet,
} from "../../../domain/buff-expiry/precisionTrackingPolicy";
import type {
  BuffExpiryPrecisionSampleResponse,
  BuffExpiryPrecisionTargetGroup,
} from "../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import type { BuffExpiryAlertConfig } from "../../../types";
import type { BuffExpiryPrecisionSampleProcessorContext } from "./buffExpirySampleProcessorContext";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";

export type BuffExpiryPrecisionTrackingUpdate = {
  previousTracks: BuffExpiryTrackedBuff[];
  nextTracks: BuffExpiryTrackedBuff[];
  pendingTracks: BuffExpiryPendingTrack[];
  confirmationCandidateCount: number;
  confirmedTransitions: BuffExpiryPrecisionConfirmedTransition[];
};

export function updateBuffExpiryPrecisionDisplayBoxes({
  boxes,
}: {
  boxes: BuffExpiryBox[];
}): BuffExpiryBox[] {
  return boxes;
}

export function applyBuffExpiryPrecisionSampleTracking({
  sampledAt,
  response,
  config,
  context,
  boxes,
  boxPreviewUrls,
}: {
  sampledAt: number;
  response: BuffExpiryPrecisionSampleResponse;
  config: BuffExpiryAlertConfig;
  context: BuffExpiryPrecisionSampleProcessorContext;
  boxes: BuffExpiryBox[];
  boxPreviewUrls: Record<string, string>;
}): BuffExpiryPrecisionTrackingUpdate {
  const selectedGroups = getBuffExpiryPrecisionSelectedTargetGroupSet(config);
  const previousTracks = preserveBuffExpiryPrecisionAlertMarkers(
    context.precisionTrackedBuffsRef.current,
    context.buffExpiryRuntimeRef.current.tracks,
  ).filter((track) => isSelectedBuffExpiryPrecisionTrack(track, selectedGroups));
  const previousPendingTracks = context.precisionPendingTracksRef.current.filter((track) =>
    isSelectedBuffExpiryPrecisionTrack(track, selectedGroups),
  );
  const reconciled = reconcileBuffExpiryPrecisionTracks({
    previousTracks,
    previousPendingTracks,
    observations: response.iconObservations.filter(
      (observation) =>
        observation.identity.kind !== "target" ||
        (observation.identity.group !== null && selectedGroups.has(observation.identity.group)),
    ),
    bestByGroup: response.bestByGroup.filter((candidate) => selectedGroups.has(candidate.group)),
    now: sampledAt,
    boxes,
    boxPreviewUrls,
  });
  const nextTracks = preserveBuffExpiryPrecisionAlertMarkers(
    reconciled.tracks,
    context.buffExpiryRuntimeRef.current.tracks,
  );
  context.precisionTrackedBuffsRef.current = nextTracks;
  context.precisionPendingTracksRef.current = reconciled.pendingTracks;
  return {
    previousTracks,
    nextTracks,
    pendingTracks: reconciled.pendingTracks,
    confirmationCandidateCount: reconciled.confirmationCandidateCount,
    confirmedTransitions: reconciled.confirmedTransitions,
  };
}

function isSelectedBuffExpiryPrecisionTrack(
  track: Pick<BuffExpiryTrackedBuff | BuffExpiryPendingTrack, "buffId">,
  selectedGroups: Set<BuffExpiryPrecisionTargetGroup>,
): boolean {
  const group = getBuffExpiryPrecisionGroupFromBuffId(track.buffId);
  return group !== null && selectedGroups.has(group);
}

export function updateBuffExpiryPrecisionRoiHistory({
  sampledAt,
  frameContext,
  response,
  tracking,
  context,
}: {
  sampledAt: number;
  frameContext: MonitoringFrameContext;
  response: BuffExpiryPrecisionSampleResponse;
  tracking: BuffExpiryPrecisionTrackingUpdate;
  context: BuffExpiryPrecisionSampleProcessorContext;
}) {
  const previousTargetObservationCount =
    context.buffExpirySnapshotRef.current?.nextIconObservations?.filter(
      (observation) => observation.identity.kind === "target",
    ).length ?? 0;
  const currentTargetObservationCount = response.iconObservations.filter(
    (observation) => observation.identity.kind === "target",
  ).length;
  const roiFrameReason = selectBuffExpiryPrecisionRoiFrameReason({
    sampledAt,
    lastPeriodicAt: context.lastPrecisionPeriodicRoiFrameAtRef.current,
    lastNearMissAt: context.lastPrecisionNearMissRoiFrameAtRef.current,
    lastCapturedAlertedAt: context.lastPrecisionAlertRoiFrameAtRef.current,
    currentLastAlertedAt: context.buffExpiryRuntimeRef.current.lastAlertedAt,
    previousTargetObservationCount,
    currentTargetObservationCount,
    previousTracks: tracking.previousTracks,
    currentTracks: tracking.nextTracks,
    bestByGroup: response.bestByGroup,
  });
  if (!roiFrameReason) {
    return;
  }

  try {
    const preview =
      frameContext.gameViewport?.mode === "calibrated"
        ? createBuffExpiryPrecisionDiagnosticRoiPreview(
            frameContext.video,
            0.82,
            frameContext.gameViewport.region,
          )
        : createBuffExpiryPrecisionDiagnosticRoiPreview(frameContext.video);
    context.precisionRecentRoiFramesRef.current = appendBuffExpiryPrecisionRecentRoiFrame(
      context.precisionRecentRoiFramesRef.current,
      createBuffExpiryPrecisionRecentRoiFrame({
        sampledAt,
        reason: roiFrameReason,
        preview,
        response,
        tracks: tracking.nextTracks,
        pendingTracks: tracking.pendingTracks,
      }),
    );
    if (roiFrameReason === "periodic") {
      context.lastPrecisionPeriodicRoiFrameAtRef.current = sampledAt;
    } else if (roiFrameReason === "near-miss") {
      context.lastPrecisionNearMissRoiFrameAtRef.current = sampledAt;
    } else if (roiFrameReason === "alert-fired") {
      context.lastPrecisionAlertRoiFrameAtRef.current =
        context.buffExpiryRuntimeRef.current.lastAlertedAt;
    }
  } catch {
    // Diagnostic snapshots must never interrupt live alert monitoring.
  }
}
