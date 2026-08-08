import type { HuntStallRuntimeState } from "../alertTypes";
import type { HuntStallReading } from "../contracts/recognition/huntStallExperienceRecognition";
import { getFingerprintDifference } from "../recognition/hunt-stall/experience/experienceOcrFingerprint";
import type { HuntStallAlertConfig } from "../types";
import {
  createHuntStallRuntimeState,
  getPreservedCooldownPresenceState,
  type HuntStallRuntimeUpdate,
} from "./huntStallRuntimeState";
import {
  getRepeatAlertIntervalSeconds,
  getRepeatAlertMaxCount,
  isRepeatAlertEnabled,
} from "./repeatAlerts";

const MIN_MANUAL_EXPERIENCE_FOREGROUND_RATIO = 0.0015;
const MAX_MANUAL_EXPERIENCE_FOREGROUND_RATIO = 0.55;
const MANUAL_EXPERIENCE_CHANGE_CONFIRMATION_COUNT = 2;
const MANUAL_EXPERIENCE_FINGERPRINT_CHANGE_THRESHOLD = 0.015;
const MANUAL_EXPERIENCE_SAME_FINGERPRINT_THRESHOLD = 0.006;
const MANUAL_EXPERIENCE_PENDING_ALERT_GRACE_SECONDS = 1;

function hasHuntStallAlertPlaybackInFlight(state: HuntStallRuntimeState): boolean {
  const status = state.lastAlertPlayback?.status;
  return status === "requested" || status === "started";
}

export function updateHuntStallManualExperienceRuntimeState({
  previous,
  reading,
  config,
  now,
  hasStream,
  hasRegion,
}: {
  previous: HuntStallRuntimeState;
  reading: HuntStallReading | null;
  config: HuntStallAlertConfig;
  now: number;
  hasStream: boolean;
  hasRegion: boolean;
}): HuntStallRuntimeUpdate {
  if (!config.enabled) {
    return {
      state: { ...createHuntStallRuntimeState(), status: "paused", lastDecision: "disabled" },
      shouldAlert: false,
    };
  }

  if (!hasStream) {
    return {
      state: { ...createHuntStallRuntimeState(), status: "no-stream", lastDecision: "no-stream" },
      shouldAlert: false,
    };
  }

  if (!hasRegion) {
    return {
      state: {
        ...createHuntStallRuntimeState(),
        ...getPreservedCooldownPresenceState(previous),
        status: "no-region",
        lastDecision: "cooldown-no-region",
      },
      shouldAlert: false,
    };
  }

  if (
    !reading ||
    reading.foregroundRatio < MIN_MANUAL_EXPERIENCE_FOREGROUND_RATIO ||
    reading.foregroundRatio > MAX_MANUAL_EXPERIENCE_FOREGROUND_RATIO
  ) {
    return {
      state: {
        ...previous,
        status: "unavailable",
        lastSampledAt: now,
        lastReadFailureAt: now,
        unreadableSinceAt: previous.unreadableSinceAt ?? now,
        stableSampleCount: 0,
        pendingRecognizedText: null,
        pendingRecognizedCount: 0,
        manualExperiencePendingFingerprint: null,
        lastRejectedRecognizedText: reading?.recognizedText ?? null,
        lastReadFailureReason: reading ? "foreground-ratio" : "sample-error",
        lastDecision: reading ? "foreground-ratio" : "sample-error",
        confidence: reading?.confidence ?? 0,
        changeScore: 0,
      },
      shouldAlert: false,
    };
  }

  if (!previous.fingerprint) {
    return {
      state: {
        ...previous,
        status: "watching",
        lastSampledAt: now,
        lastReadableAt: now,
        lastReadFailureAt: null,
        unreadableSinceAt: null,
        stableSampleCount: 1,
        unchangedSeconds: 0,
        fingerprint: reading.fingerprint,
        recognizedText: reading.recognizedText,
        alertedRecognizedText: null,
        pendingRecognizedText: null,
        pendingRecognizedCount: 0,
        manualExperiencePendingFingerprint: null,
        manualExperienceAlertedFingerprint: null,
        lastRejectedRecognizedText: null,
        lastReadFailureReason: null,
        lastDecision: "stable",
        hasObservedExperienceChange: false,
        confidence: reading.confidence,
        changeScore: 0,
      },
      shouldAlert: false,
    };
  }

  const fingerprintDifference = previous.fingerprint
    ? getFingerprintDifference(previous.fingerprint, reading.fingerprint)
    : 1;
  const sameAsStable =
    fingerprintDifference < MANUAL_EXPERIENCE_FINGERPRINT_CHANGE_THRESHOLD;
  const recognizedTextChanged =
    reading.recognizedText !== null &&
    previous.recognizedText !== null &&
    reading.recognizedText !== previous.recognizedText;
  const hasComparableRecognizedText =
    reading.recognizedText !== null && previous.recognizedText !== null;
  const ignoredSameTextMaskChange =
    !sameAsStable && hasComparableRecognizedText && !recognizedTextChanged;
  const shouldTrackChangeCandidate = hasComparableRecognizedText
    ? recognizedTextChanged
    : previous.hasObservedExperienceChange && !sameAsStable;

  if (previous.hasObservedExperienceChange && recognizedTextChanged) {
    return {
      state: {
        ...previous,
        status: "active",
        lastChangedAt: now,
        lastSampledAt: now,
        lastReadableAt: now,
        lastReadFailureAt: null,
        unreadableSinceAt: null,
        alertedAt: null,
        lastRepeatedAlertAt: null,
        repeatedAlertCount: 0,
        stableSampleCount: 1,
        unchangedSeconds: 0,
        fingerprint: reading.fingerprint,
        recognizedText: reading.recognizedText,
        alertedRecognizedText: null,
        pendingRecognizedText: null,
        pendingRecognizedCount: 0,
        manualExperiencePendingFingerprint: null,
        manualExperienceAlertedFingerprint: null,
        lastRejectedRecognizedText: null,
        lastReadFailureReason: null,
        lastDecision: "confirmed-progress",
        hasObservedExperienceChange: true,
        confidence: reading.confidence,
        changeScore: fingerprintDifference,
      },
      shouldAlert: false,
    };
  }

  if (shouldTrackChangeCandidate) {
    const pendingFingerprintDifference = previous.manualExperiencePendingFingerprint
      ? getFingerprintDifference(previous.manualExperiencePendingFingerprint, reading.fingerprint)
      : 1;
    const isSamePendingFingerprint =
      previous.manualExperiencePendingFingerprint !== null &&
      previous.manualExperiencePendingFingerprint !== undefined &&
      pendingFingerprintDifference <= MANUAL_EXPERIENCE_SAME_FINGERPRINT_THRESHOLD;
    const isSamePendingText =
      reading.recognizedText !== null && previous.pendingRecognizedText === reading.recognizedText;
    const pendingCount =
      isSamePendingFingerprint || isSamePendingText
      ? previous.pendingRecognizedCount + 1
      : 1;
    const isConfirmedChange = pendingCount >= MANUAL_EXPERIENCE_CHANGE_CONFIRMATION_COUNT;
    const nextRecognizedText =
      reading.recognizedText ?? previous.pendingRecognizedText ?? previous.recognizedText;

    if (isConfirmedChange) {
      return {
        state: {
          ...previous,
          status: "active",
          lastChangedAt: now,
          lastSampledAt: now,
          lastReadableAt: now,
          lastReadFailureAt: null,
          unreadableSinceAt: null,
          alertedAt: null,
          lastRepeatedAlertAt: null,
          repeatedAlertCount: 0,
          stableSampleCount: 1,
          unchangedSeconds: 0,
          fingerprint: reading.fingerprint,
          recognizedText: nextRecognizedText,
          alertedRecognizedText: null,
          pendingRecognizedText: null,
          pendingRecognizedCount: 0,
          manualExperiencePendingFingerprint: null,
          manualExperienceAlertedFingerprint: null,
          lastRejectedRecognizedText: null,
          lastReadFailureReason: null,
          lastDecision: "confirmed-progress",
          hasObservedExperienceChange: true,
          confidence: reading.confidence,
          changeScore: fingerprintDifference,
        },
        shouldAlert: false,
      };
    }

    const lastChangedAt = previous.lastChangedAt ?? now;
    const baselineAt = previous.unreadableSinceAt !== null ? now : lastChangedAt;
    const unchangedSeconds = previous.hasObservedExperienceChange
      ? Math.max(0, Math.floor((now - baselineAt) / 1000))
      : 0;
    const threshold = Math.max(5, Math.min(120, config.stallThresholdSeconds));
    const stableSampleCount = previous.stableSampleCount + 1;
    const isAlreadyAlertedForValue =
      previous.alertedAt !== null &&
      previous.manualExperienceAlertedFingerprint !== null &&
      previous.manualExperienceAlertedFingerprint === previous.fingerprint;
    const shouldHoldForCandidateConfirmation =
      pendingCount > 0 &&
      unchangedSeconds < threshold + MANUAL_EXPERIENCE_PENDING_ALERT_GRACE_SECONDS;
    const visibleStalled =
      previous.hasObservedExperienceChange &&
      unchangedSeconds >= threshold &&
      !shouldHoldForCandidateConfirmation;
    const shouldInitialAlert =
      visibleStalled &&
      !isAlreadyAlertedForValue &&
      stableSampleCount >= 2;
    const repeatReferenceAt = previous.lastRepeatedAlertAt;
    const repeatMaxCount = getRepeatAlertMaxCount(config);
    const shouldRepeatAlert =
      !shouldInitialAlert &&
      isAlreadyAlertedForValue &&
      isRepeatAlertEnabled(config) &&
      !hasHuntStallAlertPlaybackInFlight(previous) &&
      repeatReferenceAt !== null &&
      (repeatMaxCount === null || previous.repeatedAlertCount < repeatMaxCount) &&
      now - repeatReferenceAt >= getRepeatAlertIntervalSeconds(config) * 1000;
    const shouldAlert = shouldInitialAlert || shouldRepeatAlert;

    return {
      state: {
        ...previous,
        status: shouldAlert
          ? "alerted"
          : isAlreadyAlertedForValue
            ? "alerted"
            : visibleStalled
              ? "stalled"
              : previous.hasObservedExperienceChange
                ? "active"
                : "watching",
        lastChangedAt: baselineAt,
        lastSampledAt: now,
        lastReadableAt: now,
        lastReadFailureAt: null,
        unreadableSinceAt: null,
        alertedAt: shouldInitialAlert ? now : previous.alertedAt,
        lastRepeatedAlertAt: shouldAlert ? null : previous.lastRepeatedAlertAt,
        repeatedAlertCount: shouldRepeatAlert
          ? previous.repeatedAlertCount + 1
          : shouldInitialAlert
            ? 0
            : previous.repeatedAlertCount,
        lastAlertedAt: shouldAlert ? now : previous.lastAlertedAt,
        stableSampleCount,
        unchangedSeconds,
        pendingRecognizedText: reading.recognizedText ?? previous.pendingRecognizedText,
        pendingRecognizedCount: pendingCount,
        manualExperiencePendingFingerprint: reading.fingerprint,
        manualExperienceAlertedFingerprint: shouldAlert
          ? previous.fingerprint
          : previous.manualExperienceAlertedFingerprint ?? null,
        alertedRecognizedText: shouldAlert
          ? previous.recognizedText
          : previous.alertedRecognizedText,
        lastRejectedRecognizedText:
          reading.recognizedText ?? (recognizedTextChanged ? "text-change" : "mask-change"),
        lastReadFailureReason: null,
        lastDecision: pendingCount > 1 ? "pending-progress" : "pending",
        confidence: reading.confidence,
        changeScore: fingerprintDifference,
      },
      shouldAlert,
    };
  }

  const adjustedLastChangedAt =
    previous.hasObservedExperienceChange &&
    previous.lastChangedAt !== null &&
    previous.unreadableSinceAt !== null
      ? previous.lastChangedAt + Math.max(0, now - previous.unreadableSinceAt)
      : previous.lastChangedAt;
  const unchangedSeconds = previous.hasObservedExperienceChange && adjustedLastChangedAt !== null
    ? Math.max(0, Math.floor((now - adjustedLastChangedAt) / 1000))
    : 0;
  const threshold = Math.max(5, Math.min(120, config.stallThresholdSeconds));
  const stableSampleCount = previous.stableSampleCount + 1;
  const isAlreadyAlertedForValue =
    previous.alertedAt !== null &&
    previous.manualExperienceAlertedFingerprint !== null &&
    previous.manualExperienceAlertedFingerprint === previous.fingerprint;
  const shouldInitialAlert =
    previous.hasObservedExperienceChange &&
    !isAlreadyAlertedForValue &&
    stableSampleCount >= 2 &&
    unchangedSeconds >= threshold;
  const repeatReferenceAt = previous.lastRepeatedAlertAt;
  const repeatMaxCount = getRepeatAlertMaxCount(config);
  const shouldRepeatAlert =
    !shouldInitialAlert &&
    isAlreadyAlertedForValue &&
    isRepeatAlertEnabled(config) &&
    !hasHuntStallAlertPlaybackInFlight(previous) &&
    repeatReferenceAt !== null &&
    (repeatMaxCount === null || previous.repeatedAlertCount < repeatMaxCount) &&
    now - repeatReferenceAt >= getRepeatAlertIntervalSeconds(config) * 1000;
  const shouldAlert = shouldInitialAlert || shouldRepeatAlert;
  const shouldRefreshUnarmedBaseline =
    !previous.hasObservedExperienceChange &&
    reading.recognizedText !== null &&
    !recognizedTextChanged;

  return {
    state: {
      ...previous,
      status: shouldAlert
        ? "alerted"
        : isAlreadyAlertedForValue
          ? "alerted"
          : previous.hasObservedExperienceChange
            ? unchangedSeconds >= threshold
              ? "stalled"
              : "active"
            : "watching",
      lastSampledAt: now,
      lastReadableAt: now,
      lastChangedAt: adjustedLastChangedAt,
      lastReadFailureAt: null,
      unreadableSinceAt: null,
      alertedAt: shouldInitialAlert ? now : previous.alertedAt,
      lastRepeatedAlertAt: shouldAlert ? null : previous.lastRepeatedAlertAt,
      repeatedAlertCount: shouldRepeatAlert
        ? previous.repeatedAlertCount + 1
        : shouldInitialAlert
          ? 0
          : previous.repeatedAlertCount,
      lastAlertedAt: shouldAlert ? now : previous.lastAlertedAt,
      stableSampleCount,
      unchangedSeconds,
      fingerprint: shouldRefreshUnarmedBaseline
        ? reading.fingerprint
        : previous.fingerprint ?? reading.fingerprint,
      recognizedText: previous.recognizedText ?? reading.recognizedText,
      alertedRecognizedText: shouldAlert ? previous.recognizedText : previous.alertedRecognizedText,
      pendingRecognizedText: null,
      pendingRecognizedCount: 0,
      manualExperiencePendingFingerprint: null,
      manualExperienceAlertedFingerprint: shouldAlert
        ? previous.fingerprint
        : previous.manualExperienceAlertedFingerprint ?? null,
      lastRejectedRecognizedText: null,
      lastReadFailureReason: null,
      lastDecision: ignoredSameTextMaskChange
        ? "ignored-jitter"
        : previous.lastReadFailureAt
          ? "stable-after-read-failure"
          : "stable",
      confidence: reading.confidence,
      changeScore: fingerprintDifference,
    },
    shouldAlert,
  };
}
