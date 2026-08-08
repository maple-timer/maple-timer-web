import type { PixelRegion } from "../../contracts/geometry/pixelRegion";
import type { BuffExpiryTargetGroup } from "../../contracts/recognition/buffExpiryRecognition";

export type BuffExpiryBox = PixelRegion & {
  confidence: number;
  side?: number;
  row?: number;
  col?: number;
};

export type BuffExpiryPendingObservation = {
  seconds: number;
  observedAt: number;
  score: number;
  strength: "strong" | "weak";
  reason: string;
  predictedExpiresAt?: number;
  weight?: number;
};

export type BuffExpiryPendingTrack = {
  id: string;
  buffId: string;
  name: string;
  box: BuffExpiryBox;
  normalizedIconDataUrl?: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  observations: BuffExpiryPendingObservation[];
  score: number;
};

export type BuffExpiryTemporalCandidateTrack = BuffExpiryPendingTrack;

export type BuffExpiryExpiryClusterObservation = {
  observedAt: number;
  buffId: string;
  name: string;
  slotKey: string;
  seconds: number;
  predictedExpiresAt: number;
  score: number;
  strength: "strong" | "weak";
  reason: string;
  source: "accepted" | "temporal";
  box: BuffExpiryBox;
};

export type BuffExpiryExpiryCluster = {
  id: string;
  firstSeenAt: number;
  lastSeenAt: number;
  centerExpiresAt: number;
  observations: BuffExpiryExpiryClusterObservation[];
  confirmedAt: number | null;
};

export type BuffExpiryTrackedBuff = {
  id: string;
  buffId: string;
  name: string;
  box: BuffExpiryBox;
  normalizedIconDataUrl?: string | null;
  detectedSeconds: number;
  detectedAt: number;
  expiresAt: number;
  lastSeenAt: number;
  alertedAt: number | null;
  score: number;
};

export type BuffExpiryPrecisionExactObservation = {
  group: BuffExpiryTargetGroup;
  box: BuffExpiryBox;
  seconds: number;
  observedAt: number;
  score: number;
  margin: number;
  reason: string;
  countdownConfidence: number;
  countdownStatus: "high" | "medium" | "low" | "missing";
};

export type BuffExpiryPrecisionContinuityCandidate = {
  group: BuffExpiryTargetGroup;
  box: BuffExpiryBox;
  accepted: boolean;
  seconds: number | null;
  score: number;
  margin: number;
  gateMargin?: number | null;
};

export type BuffExpiryPrecisionConfirmedTransition = {
  transition: "pending-to-confirmed";
  group: BuffExpiryTargetGroup;
  trackId: string;
  acceptedSeconds: number;
  observedAt: number;
  derivedSeconds: number;
  detectedAt: number;
  expiresAt: number;
  alertedAt: number | null;
};

export type BuffExpiryPrecisionTrackingObservation = BuffExpiryPrecisionExactObservation & {
  normalizedIconDataUrl: string | null;
};

export type BuffExpiryPrecisionTrackingResult = {
  tracks: BuffExpiryTrackedBuff[];
  pendingTracks: BuffExpiryPendingTrack[];
  confirmationCandidateCount: number;
  confirmedTransitions: BuffExpiryPrecisionConfirmedTransition[];
};
