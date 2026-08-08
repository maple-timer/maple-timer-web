import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryBox } from "../../../domain/buff-expiry/precisionTrackingTypes";
import { createBuffExpiryRuntimeState } from "../../../lib/buffExpiry/buffExpiryRuntimeState";
import {
  appendBuffExpiryDebugDetectionFrame,
  appendBuffExpiryRuntimeTraceFrame,
  compactBuffExpiryPrecisionRuntimeFrame,
  getBuffExpiryBoxKey,
} from "./buffExpiryPrecisionRuntimeDiagnostics";
import type { BuffExpiryPrecisionSampleResponse } from "../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import type { sampleBuffExpiryPrecisionVideoFrame } from "../../../platform/frame-capture/buff-expiry/buffExpiryPrecisionCapture";
import type { BuffExpiryPrecisionSampleProcessorContext } from "./buffExpirySampleProcessorContext";
import type { BuffExpiryPrecisionTrackingUpdate } from "./buffExpiryPrecisionSampleTrackingState";

const BUFF_EXPIRY_DEBUG_BOX_LIMIT = 40;

export function publishBuffExpiryPrecisionSampleState({
  sampledAt,
  frame,
  response,
  boxes,
  displayBoxes,
  boxPreviewUrls,
  boxPreviewImageData,
  processedPreviewUrl,
  acceptedMatchCount,
  performance,
  nextStatus,
  tracking,
  lastAlertEvidence,
  showDebugColumns,
  context,
}: {
  sampledAt: number;
  frame: ReturnType<typeof sampleBuffExpiryPrecisionVideoFrame>;
  response: BuffExpiryPrecisionSampleResponse;
  boxes: BuffExpiryBox[];
  displayBoxes: BuffExpiryBox[];
  boxPreviewUrls: Record<string, string>;
  boxPreviewImageData: NonNullable<BuffExpirySnapshot["boxPreviewImageData"]>;
  processedPreviewUrl: string | null;
  acceptedMatchCount: number;
  performance: NonNullable<BuffExpiryRuntimeState["performance"]>;
  nextStatus: BuffExpiryRuntimeState["status"];
  tracking: BuffExpiryPrecisionTrackingUpdate;
  lastAlertEvidence: BuffExpiryRuntimeState["lastAlertEvidence"];
  showDebugColumns: boolean;
  context: BuffExpiryPrecisionSampleProcessorContext;
}): {
  state: BuffExpiryRuntimeState;
  snapshot: BuffExpirySnapshot;
} {
  context.displayBoxTracksRef.current = [];
  context.temporalCandidateTracksRef.current = [];
  context.expiryClustersRef.current = [];
  context.alertDecisionHistoryRef.current = [];
  context.runtimeTraceRef.current = appendBuffExpiryRuntimeTraceFrame(
    context.runtimeTraceRef.current,
    {
      sampledAt,
      status: nextStatus,
      boxCount: boxes.length,
      acceptedMatchCount,
      acceptedMatches: [],
      rejectedMatches: [],
      tracks: tracking.nextTracks,
      pendingTracks: tracking.pendingTracks,
      expiryClusterCount: 0,
      confirmedExpiryClusterCount: 0,
      expiryClusters: [],
      shouldAlert: false,
      alertedTrackIds: [],
      next: compactBuffExpiryPrecisionRuntimeFrame(response),
      unsupportedReason: null,
      performance,
    },
  );
  if (showDebugColumns) {
    context.debugDetectionHistoryRef.current = appendBuffExpiryDebugDetectionFrame(
      context.debugDetectionHistoryRef.current,
      {
        sampledAt,
        boxCount: boxes.length,
        acceptedMatchCount,
        boxes: boxes.slice(0, BUFF_EXPIRY_DEBUG_BOX_LIMIT).map((box) => ({
          box,
          previewDataUrl: boxPreviewUrls[getBuffExpiryBoxKey(box)] ?? null,
          acceptedMatch: null,
          rejectedMatch: null,
          topMatches: [],
        })),
        performance,
      },
    );
  } else {
    context.debugDetectionHistoryRef.current = [];
  }

  const state: BuffExpiryRuntimeState = {
    ...createBuffExpiryRuntimeState(),
    status: nextStatus,
    tracks: tracking.nextTracks,
    pendingTracks: tracking.pendingTracks,
    confirmationCandidateCount: tracking.confirmationCandidateCount,
    lastSampledAt: sampledAt,
    lastDetectedAt: acceptedMatchCount
      ? sampledAt
      : context.buffExpiryRuntimeRef.current.lastDetectedAt,
    lastAlertedAt: context.buffExpiryRuntimeRef.current.lastAlertedAt,
    lastAlertPlayback: context.buffExpiryRuntimeRef.current.lastAlertPlayback ?? null,
    lastAlertEvidence,
    boxCount: boxes.length,
    acceptedMatchCount,
    unsupportedReason: null,
    performance,
  };
  const snapshot: BuffExpirySnapshot = {
    sampledAt,
    parserEngine: response.parserEngine ?? null,
    parserFallbackReason: response.parserFallbackReason ?? null,
    roi: frame.roi,
    rawPreviewUrl:
      frame.rawPreviewUrl ?? context.lastPreviewUrlsRef.current.rawPreviewUrl,
    processedPreviewUrl,
    fullFramePreviewUrl:
      frame.fullFramePreviewUrl ??
      context.lastPreviewUrlsRef.current.fullFramePreviewUrl,
    boxes,
    displayBoxes,
    boxPreviewUrls,
    boxPreviewImageData,
    nextIconObservations: response.iconObservations,
    nextBestByGroup: response.bestByGroup,
    nextBuffSlotLocalization: response.buffSlotLocalization,
    nextModuleVersions: response.moduleVersions,
    nextRecentRoiFrames: context.precisionRecentRoiFramesRef.current,
    acceptedMatches: [],
    rejectedMatches: [],
    tracks: tracking.nextTracks,
    pendingTracks: tracking.pendingTracks,
    unsupportedReason: null,
    performance,
    runtimeTrace: context.runtimeTraceRef.current,
    alertDecisionHistory: [],
    iconEvidence: [],
    lastAlertEvidence,
  };

  context.publishState(state, snapshot);
  return { state, snapshot };
}
