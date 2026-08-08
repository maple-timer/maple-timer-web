import type { HuntStallRuntimeState } from "../alertTypes";

export type HuntStallRuntimeUpdate = {
  state: HuntStallRuntimeState;
  shouldAlert: boolean;
  shouldResetOcrState?: boolean;
};

export function createHuntStallRuntimeState(): HuntStallRuntimeState {
  return {
    status: "paused",
    lastChangedAt: null,
    lastSampledAt: null,
    lastReadableAt: null,
    lastReadFailureAt: null,
    unreadableSinceAt: null,
    alertedAt: null,
    lastRepeatedAlertAt: null,
    repeatedAlertCount: 0,
    lastAlertedAt: null,
    lastAlertPlayback: null,
    stableSampleCount: 0,
    unchangedSeconds: 0,
    fingerprint: null,
    recognizedText: null,
    alertedRecognizedText: null,
    pendingRecognizedText: null,
    pendingRecognizedCount: 0,
    manualExperiencePendingFingerprint: null,
    manualExperienceAlertedFingerprint: null,
    lastRejectedRecognizedText: null,
    lastReadFailureReason: null,
    lastDecision: "idle",
    hasObservedExperienceChange: false,
    hasObservedCooldownPresence: false,
    cooldownLastDetectedAt: null,
    cooldownMissingSinceAt: null,
    cooldownMissingSeconds: 0,
    cooldownConsecutiveReadableCount: 0,
    cooldownVisualFingerprint: null,
    cooldownVisualChangeScore: null,
    cooldownVisualChangedAt: null,
    cooldownConsecutiveVisualActivityCount: 0,
    cooldownUsedVisualActivity: false,
    confidence: 0,
    changeScore: 0,
    experienceTotalEstimate: null,
    experienceTotalSampleCount: 0,
  };
}
export function getPreservedCooldownPresenceState(previous: HuntStallRuntimeState) {
  return {
    hasObservedCooldownPresence: previous.hasObservedCooldownPresence,
    cooldownLastDetectedAt: previous.cooldownLastDetectedAt,
    cooldownMissingSinceAt: previous.cooldownMissingSinceAt,
    cooldownMissingSeconds: previous.cooldownMissingSeconds,
    cooldownConsecutiveReadableCount: previous.cooldownConsecutiveReadableCount,
    cooldownVisualFingerprint: previous.cooldownVisualFingerprint ?? null,
    cooldownVisualChangeScore: previous.cooldownVisualChangeScore ?? null,
    cooldownVisualChangedAt: previous.cooldownVisualChangedAt ?? null,
    cooldownConsecutiveVisualActivityCount:
      previous.cooldownConsecutiveVisualActivityCount ?? 0,
    cooldownUsedVisualActivity: previous.cooldownUsedVisualActivity ?? false,
  };
}

export function markHuntStallAlertPlaybackFinished(
  state: HuntStallRuntimeState,
  alertCycleStartedAt: number,
  finishedAt: number,
): HuntStallRuntimeState {
  if (state.alertedAt !== alertCycleStartedAt) {
    return state;
  }

  return {
    ...state,
    lastRepeatedAlertAt: finishedAt,
    lastAlertedAt: finishedAt,
  };
}
