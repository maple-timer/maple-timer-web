import type { MutableRefObject } from "react";
import type { BuffExpiryDisplayBoxTrack } from "../../../lib/buffExpiry/buffExpiryDisplayBoxes";
import type {
  BuffExpiryDebugDetectionFrame,
  BuffExpiryIconEvidence,
  BuffExpiryRuntimeState,
  BuffExpiryRuntimeTraceFrame,
  BuffExpirySnapshot,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryAlertDecision } from "../../../domain/buff-expiry/precisionAlertTypes";
import type {
  BuffExpiryExpiryCluster,
  BuffExpiryPendingTrack,
  BuffExpiryTemporalCandidateTrack,
  BuffExpiryTrackedBuff,
} from "../../../domain/buff-expiry/precisionTrackingTypes";
import type { BuffExpiryPrecisionPreloadStatus } from "../../../platform/runtime-workers/buff-expiry/buffExpiryPrecisionWorkerClient";
import type {
  BuffExpiryPrecisionEngine,
  BuffExpiryPrecisionSampleProcessorContext,
  BuffExpiryPreviewUrls,
  BuffExpirySampleProcessorCommonContext,
} from "./buffExpirySampleProcessorContext";

export type BuffExpirySampleLoopRefs = {
  precisionEngineRef: MutableRefObject<BuffExpiryPrecisionEngine>;
  buffExpiryRuntimeRef: MutableRefObject<BuffExpiryRuntimeState>;
  buffExpirySnapshotRef: MutableRefObject<BuffExpirySnapshot | null>;
  lastAlertErrorRef: MutableRefObject<string | null>;
  lastPreviewAtRef: MutableRefObject<number>;
  lastPreviewUrlsRef: MutableRefObject<BuffExpiryPreviewUrls>;
  displayBoxTracksRef: MutableRefObject<BuffExpiryDisplayBoxTrack[]>;
  precisionTrackedBuffsRef: MutableRefObject<BuffExpiryTrackedBuff[]>;
  precisionPendingTracksRef: MutableRefObject<BuffExpiryPendingTrack[]>;
  precisionRecentRoiFramesRef: MutableRefObject<NonNullable<BuffExpirySnapshot["nextRecentRoiFrames"]>>;
  lastPrecisionPeriodicRoiFrameAtRef: MutableRefObject<number>;
  lastPrecisionNearMissRoiFrameAtRef: MutableRefObject<number>;
  lastPrecisionAlertRoiFrameAtRef: MutableRefObject<number | null>;
  debugDetectionHistoryRef: MutableRefObject<BuffExpiryDebugDetectionFrame[]>;
  runtimeTraceRef: MutableRefObject<BuffExpiryRuntimeTraceFrame[]>;
  alertDecisionHistoryRef: MutableRefObject<BuffExpiryAlertDecision[]>;
  iconEvidenceRef: MutableRefObject<BuffExpiryIconEvidence[]>;
  temporalCandidateTracksRef: MutableRefObject<BuffExpiryTemporalCandidateTrack[]>;
  expiryClustersRef: MutableRefObject<BuffExpiryExpiryCluster[]>;
};

export function resetBuffExpirySampleLoopState({
  refs,
  resetPrecisionEngine = true,
  clearBuffExpiryAlertTimers,
  resetPrecisionEnginePreload,
}: {
  refs: BuffExpirySampleLoopRefs;
  resetPrecisionEngine?: boolean;
  clearBuffExpiryAlertTimers: () => void;
  resetPrecisionEnginePreload: () => void;
}) {
  clearBuffExpiryAlertTimers();
  if (resetPrecisionEngine) {
    refs.precisionEngineRef.current.reset();
    resetPrecisionEnginePreload();
  }
  refs.lastPreviewAtRef.current = 0;
  refs.displayBoxTracksRef.current = [];
  refs.precisionTrackedBuffsRef.current = [];
  refs.precisionPendingTracksRef.current = [];
  refs.precisionRecentRoiFramesRef.current = [];
  refs.lastPrecisionPeriodicRoiFrameAtRef.current = 0;
  refs.lastPrecisionNearMissRoiFrameAtRef.current = 0;
  refs.lastPrecisionAlertRoiFrameAtRef.current = null;
  refs.debugDetectionHistoryRef.current = [];
  refs.runtimeTraceRef.current = [];
  refs.alertDecisionHistoryRef.current = [];
  refs.iconEvidenceRef.current = [];
  refs.temporalCandidateTracksRef.current = [];
  refs.expiryClustersRef.current = [];
  refs.lastPreviewUrlsRef.current = {
    rawPreviewUrl: null,
    processedPreviewUrl: null,
    fullFramePreviewUrl: null,
  };
}

export function createBuffExpirySampleProcessorCommonContext({
  refs,
  trackMonitoringStarted,
  publishState,
}: {
  refs: BuffExpirySampleLoopRefs;
  trackMonitoringStarted: () => void;
  publishState: (state: BuffExpiryRuntimeState, snapshot: BuffExpirySnapshot | null) => void;
}): BuffExpirySampleProcessorCommonContext {
  return {
    buffExpiryRuntimeRef: refs.buffExpiryRuntimeRef,
    buffExpirySnapshotRef: refs.buffExpirySnapshotRef,
    lastPreviewAtRef: refs.lastPreviewAtRef,
    lastPreviewUrlsRef: refs.lastPreviewUrlsRef,
    displayBoxTracksRef: refs.displayBoxTracksRef,
    debugDetectionHistoryRef: refs.debugDetectionHistoryRef,
    runtimeTraceRef: refs.runtimeTraceRef,
    alertDecisionHistoryRef: refs.alertDecisionHistoryRef,
    iconEvidenceRef: refs.iconEvidenceRef,
    temporalCandidateTracksRef: refs.temporalCandidateTracksRef,
    expiryClustersRef: refs.expiryClustersRef,
    trackMonitoringStarted,
    publishState,
  };
}

export function createBuffExpiryPrecisionSampleProcessorContext({
  commonContext,
  refs,
  precisionEnginePreloadStatusRef,
  updatePrecisionEnginePreloadStatusFromSample,
}: {
  commonContext: BuffExpirySampleProcessorCommonContext;
  refs: BuffExpirySampleLoopRefs;
  precisionEnginePreloadStatusRef: MutableRefObject<BuffExpiryPrecisionPreloadStatus>;
  updatePrecisionEnginePreloadStatusFromSample: (nextStatus: BuffExpiryPrecisionPreloadStatus) => void;
}): BuffExpiryPrecisionSampleProcessorContext {
  return {
    ...commonContext,
    precisionEngineRef: refs.precisionEngineRef,
    precisionEnginePreloadStatusRef,
    updatePrecisionEnginePreloadStatusFromSample,
    precisionTrackedBuffsRef: refs.precisionTrackedBuffsRef,
    precisionPendingTracksRef: refs.precisionPendingTracksRef,
    precisionRecentRoiFramesRef: refs.precisionRecentRoiFramesRef,
    lastPrecisionPeriodicRoiFrameAtRef: refs.lastPrecisionPeriodicRoiFrameAtRef,
    lastPrecisionNearMissRoiFrameAtRef: refs.lastPrecisionNearMissRoiFrameAtRef,
    lastPrecisionAlertRoiFrameAtRef: refs.lastPrecisionAlertRoiFrameAtRef,
  };
}
