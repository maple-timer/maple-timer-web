import type { BuffExpiryAlertDecision } from "../../domain/buff-expiry/precisionAlertTypes";
import type {
  BuffExpiryPendingTrack,
  BuffExpiryTrackedBuff,
} from "../../domain/buff-expiry/precisionTrackingTypes";
import type { BuffExpiryRuntimeTraceFrame } from "../../lib/buffExpiry/buffExpiryTypes";
import {
  BUFF_EXPIRY_PRECISION_REPORT_ALERT_DECISION_LIMIT,
  BUFF_EXPIRY_PRECISION_REPORT_PENDING_OBSERVATION_LIMIT,
  BUFF_EXPIRY_PRECISION_REPORT_RUNTIME_TRACE_LIMIT,
  BUFF_EXPIRY_PRECISION_REPORT_TRACK_LIMIT,
} from "./buffExpiryPrecisionReportConstants";
import { serializeBuffExpiryPrecisionBox } from "./buffExpiryPrecisionReportBoxes";

export function serializeBuffExpiryPrecisionTracks(tracks: BuffExpiryTrackedBuff[]) {
  return tracks.slice(0, BUFF_EXPIRY_PRECISION_REPORT_TRACK_LIMIT).map((track) => ({
    id: track.id,
    buffId: track.buffId,
    name: track.name,
    box: serializeBuffExpiryPrecisionBox(track.box),
    detectedSeconds: track.detectedSeconds,
    detectedAt: track.detectedAt,
    expiresAt: track.expiresAt,
    lastSeenAt: track.lastSeenAt,
    alertedAt: track.alertedAt,
    score: track.score,
  }));
}

export function serializeBuffExpiryPrecisionPendingTracks(pendingTracks: BuffExpiryPendingTrack[]) {
  return pendingTracks.slice(0, BUFF_EXPIRY_PRECISION_REPORT_TRACK_LIMIT).map((track) => ({
    id: track.id,
    buffId: track.buffId,
    name: track.name,
    box: serializeBuffExpiryPrecisionBox(track.box),
    firstSeenAt: track.firstSeenAt,
    lastSeenAt: track.lastSeenAt,
    observations: track.observations.slice(-BUFF_EXPIRY_PRECISION_REPORT_PENDING_OBSERVATION_LIMIT),
    score: track.score,
  }));
}

export function serializeBuffExpiryPrecisionAlertDecisionHistory(history: BuffExpiryAlertDecision[]) {
  return history
    .slice(-BUFF_EXPIRY_PRECISION_REPORT_ALERT_DECISION_LIMIT)
    .map((decision) => ({
      sampledAt: decision.sampledAt,
      alertLeadSeconds: decision.alertLeadSeconds,
      shouldAlert: decision.shouldAlert,
      reason: decision.reason,
      dueTracks: decision.dueTracks,
      newAlertTrackIds: decision.newAlertTrackIds,
      suppressedTrackIds: decision.suppressedTrackIds,
      deferredTrackIds: decision.deferredTrackIds,
      markedTrackIds: decision.markedTrackIds,
      dueGroupExpiresAt: decision.dueGroupExpiresAt,
      nearestExistingAlertGroup: decision.nearestExistingAlertGroup,
    }));
}

export function serializeBuffExpiryPrecisionRuntimeTrace(history: BuffExpiryRuntimeTraceFrame[]) {
  return history
    .slice(-BUFF_EXPIRY_PRECISION_REPORT_RUNTIME_TRACE_LIMIT)
    .map((frame) => ({
      sampledAt: frame.sampledAt,
      status: frame.status,
      boxCount: frame.boxCount,
      acceptedMatchCount: frame.acceptedMatchCount,
      trackCount: frame.tracks.length,
      pendingTrackCount: frame.pendingTracks.length,
      shouldAlert: frame.shouldAlert,
      alertedTrackIds: frame.alertedTrackIds,
      alertDecision: frame.alertDecision
        ? {
            sampledAt: frame.alertDecision.sampledAt,
            shouldAlert: frame.alertDecision.shouldAlert,
            reason: frame.alertDecision.reason,
            dueTrackCount: frame.alertDecision.dueTracks.length,
            newAlertTrackIds: frame.alertDecision.newAlertTrackIds,
            markedTrackIds: frame.alertDecision.markedTrackIds,
          }
        : null,
      next: frame.next
        ? {
            targetObservationCount: frame.next.targetObservationCount,
            countdownObservationCount: frame.next.countdownObservationCount,
            bestByGroup: frame.next.bestByGroup,
            targetObservations: frame.next.targetObservations,
            moduleVersions: frame.next.moduleVersions,
          }
        : null,
      unsupportedReason: frame.unsupportedReason,
      performance: frame.performance,
    }));
}
