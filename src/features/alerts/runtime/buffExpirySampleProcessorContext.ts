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
import {
  createBuffExpiryPrecisionEngine,
  type BuffExpiryPrecisionPreloadStatus,
} from "../../../platform/runtime-workers/buff-expiry/buffExpiryPrecisionWorkerClient";

export type BuffExpiryPrecisionEngine = ReturnType<typeof createBuffExpiryPrecisionEngine>;

export type BuffExpiryPreviewUrls = {
  rawPreviewUrl: string | null;
  processedPreviewUrl: string | null;
  fullFramePreviewUrl: string | null;
};

export type BuffExpirySampleProcessorCommonContext = {
  buffExpiryRuntimeRef: MutableRefObject<BuffExpiryRuntimeState>;
  buffExpirySnapshotRef: MutableRefObject<BuffExpirySnapshot | null>;
  lastPreviewAtRef: MutableRefObject<number>;
  lastPreviewUrlsRef: MutableRefObject<BuffExpiryPreviewUrls>;
  displayBoxTracksRef: MutableRefObject<BuffExpiryDisplayBoxTrack[]>;
  debugDetectionHistoryRef: MutableRefObject<BuffExpiryDebugDetectionFrame[]>;
  runtimeTraceRef: MutableRefObject<BuffExpiryRuntimeTraceFrame[]>;
  alertDecisionHistoryRef: MutableRefObject<BuffExpiryAlertDecision[]>;
  iconEvidenceRef: MutableRefObject<BuffExpiryIconEvidence[]>;
  temporalCandidateTracksRef: MutableRefObject<BuffExpiryTemporalCandidateTrack[]>;
  expiryClustersRef: MutableRefObject<BuffExpiryExpiryCluster[]>;
  trackMonitoringStarted: () => void;
  publishState: (state: BuffExpiryRuntimeState, snapshot: BuffExpirySnapshot | null) => void;
};

export type BuffExpiryPrecisionSampleProcessorContext = BuffExpirySampleProcessorCommonContext & {
  precisionEngineRef: MutableRefObject<BuffExpiryPrecisionEngine>;
  precisionEnginePreloadStatusRef: MutableRefObject<BuffExpiryPrecisionPreloadStatus>;
  updatePrecisionEnginePreloadStatusFromSample: (nextStatus: BuffExpiryPrecisionPreloadStatus) => void;
  precisionTrackedBuffsRef: MutableRefObject<BuffExpiryTrackedBuff[]>;
  precisionPendingTracksRef: MutableRefObject<BuffExpiryPendingTrack[]>;
  precisionRecentRoiFramesRef: MutableRefObject<NonNullable<BuffExpirySnapshot["nextRecentRoiFrames"]>>;
  lastPrecisionPeriodicRoiFrameAtRef: MutableRefObject<number>;
  lastPrecisionNearMissRoiFrameAtRef: MutableRefObject<number>;
  lastPrecisionAlertRoiFrameAtRef: MutableRefObject<number | null>;
};
