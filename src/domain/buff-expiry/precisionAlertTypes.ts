import type { BuffExpiryTrackedBuff } from "./precisionTrackingTypes";

export type BuffExpiryAlertDecisionReason =
  | "no-due-tracks"
  | "new-alert-group"
  | "existing-alert-group";

export type BuffExpiryAlertDecisionTrack = {
  id: string;
  buffId: string;
  name: string;
  slotKey: string;
  remainingSeconds: number;
  expiresAt: number;
  alertedAt: number | null;
};

export type BuffExpiryAlertDecisionExistingGroup = {
  trackId: string;
  buffId: string;
  name: string;
  expiresAt: number;
  alertedAt: number;
  distanceMs: number;
};

export type BuffExpiryAlertDecision = {
  sampledAt: number;
  alertLeadSeconds: number;
  shouldAlert: boolean;
  reason: BuffExpiryAlertDecisionReason;
  dueTracks: BuffExpiryAlertDecisionTrack[];
  newAlertTrackIds: string[];
  suppressedTrackIds: string[];
  deferredTrackIds: string[];
  markedTrackIds: string[];
  dueGroupExpiresAt: number | null;
  nearestExistingAlertGroup: BuffExpiryAlertDecisionExistingGroup | null;
};

export type BuffExpiryPrecisionAlertCluster = {
  id: string;
  dueAt: number;
  minExpiresAt: number;
  maxExpiresAt: number;
  tracks: BuffExpiryTrackedBuff[];
};
