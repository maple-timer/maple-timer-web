import type { BuffExpiryRuntimeState } from "./buffExpiryTypes";

export function createBuffExpiryRuntimeState(): BuffExpiryRuntimeState {
  return {
    status: "paused",
    tracks: [],
    pendingTracks: [],
    confirmationCandidateCount: 0,
    lastSampledAt: null,
    lastDetectedAt: null,
    lastAlertedAt: null,
    lastAlertPlayback: null,
    lastAlertEvidence: null,
    boxCount: 0,
    acceptedMatchCount: 0,
    unsupportedReason: null,
    performance: null,
  };
}
