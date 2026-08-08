import type { HuntStallRuntimeState } from "../alertTypes";
import type { HuntStallAlertConfig, RecognitionResult } from "../types";
import { TRUSTED_CONFIDENCE } from "./timerRules";
import {
  getHuntStallCooldownVisualChangeScore,
  isHuntStallCooldownVisualActivity,
  type HuntStallCooldownVisualActivity,
} from "../recognition/hunt-stall/cooldown/huntStallCooldownActivity";
import {
  createHuntStallRuntimeState,
  getPreservedCooldownPresenceState,
  type HuntStallRuntimeUpdate,
} from "./huntStallRuntimeState";

const COOLDOWN_PRESENCE_VISUAL_ARMING_SAMPLES = 2;

function clampCooldownActivityThresholdSeconds(config: HuntStallAlertConfig): number {
  return Math.max(1, Math.min(60, config.cooldownMissingThresholdSeconds));
}

function isCooldownReadableDecision(decision: HuntStallRuntimeState["lastDecision"]): boolean {
  return (
    decision === "cooldown-readable" ||
    decision === "cooldown-arming" ||
    decision === "cooldown-visual-active" ||
    decision === "cooldown-unchanged"
  );
}

function wasCooldownUnreadableDecision(decision: HuntStallRuntimeState["lastDecision"]): boolean {
  return (
    decision === "cooldown-empty" ||
    decision === "cooldown-missing" ||
    decision === "cooldown-alerted"
  );
}

function isTrustedCooldownPresenceReading(result: RecognitionResult | null): boolean {
  return Boolean(
    result &&
      result.value !== null &&
      result.value >= 0 &&
      result.confidence >= TRUSTED_CONFIDENCE,
  );
}

function parseCooldownPresenceText(text: string | null): number | null {
  if (text === null) {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function isLikelyCooldownCountdownStep(previousText: string | null, currentText: string): boolean {
  const previous = parseCooldownPresenceText(previousText);
  const current = parseCooldownPresenceText(currentText);

  if (previous === null || current === null) {
    return false;
  }

  const delta = previous - current;
  return delta >= 1 && delta <= 4;
}

export function updateHuntStallCooldownPresenceRuntimeState({
  previous,
  result,
  activity,
  config,
  now,
  hasStream,
  hasRegion,
}: {
  previous: HuntStallRuntimeState;
  result: RecognitionResult | null;
  activity?: HuntStallCooldownVisualActivity | null;
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
        status: "no-region",
        lastSampledAt: now,
        lastDecision: "cooldown-no-region",
      },
      shouldAlert: false,
    };
  }

  const threshold = clampCooldownActivityThresholdSeconds(config);
  const recognizedText =
    result?.debug?.recognizedText ??
    (result?.value !== null && result?.value !== undefined ? String(result.value) : null);
  const trustedCooldownReading = result !== null && isTrustedCooldownPresenceReading(result);
  const visualChangeScore = getHuntStallCooldownVisualChangeScore(
    previous.cooldownVisualFingerprint,
    activity,
  );
  const canUseVisualActivity =
    Boolean(activity) &&
    (previous.hasObservedCooldownPresence ||
      previous.alertedAt !== null ||
      previous.cooldownLastDetectedAt !== null ||
      trustedCooldownReading);
  const usedVisualActivity =
    canUseVisualActivity && isHuntStallCooldownVisualActivity(visualChangeScore);
  const cooldownConsecutiveVisualActivityCount = usedVisualActivity
    ? (previous.cooldownConsecutiveVisualActivityCount ?? 0) + 1
    : 0;
  const cooldownVisualChangedAt = usedVisualActivity
    ? now
    : previous.cooldownVisualChangedAt ?? null;
  const cooldownVisualFingerprint =
    activity?.fingerprint ?? previous.cooldownVisualFingerprint ?? null;

  if (trustedCooldownReading && result !== null) {
    const currentText = String(result.value);
    const previousText = previous.recognizedText;
    const wasUnreadable =
      previous.cooldownMissingSinceAt !== null || wasCooldownUnreadableDecision(previous.lastDecision);
    const didCooldownChange = previousText !== null && currentText !== previousText;
    const consecutiveReadableCount = isCooldownReadableDecision(previous.lastDecision)
      ? previous.cooldownConsecutiveReadableCount + 1
      : 1;
    const alertedRearmCandidateText =
      previous.alertedAt !== null &&
      (previous.alertedRecognizedText === null || currentText !== previous.alertedRecognizedText)
        ? currentText
        : null;
    const alertedRearmCandidateCount =
      alertedRearmCandidateText === null
        ? 0
        : previous.pendingRecognizedText === alertedRearmCandidateText
          ? previous.pendingRecognizedCount + 1
          : 1;
    const hasConfirmedCountdownRearm =
      alertedRearmCandidateText !== null &&
      isLikelyCooldownCountdownStep(previous.pendingRecognizedText, alertedRearmCandidateText);
    const shouldRearmFromAlerted =
      previous.alertedAt !== null &&
      alertedRearmCandidateText !== null &&
      (alertedRearmCandidateCount >= 2 || hasConfirmedCountdownRearm);
    const hasConfirmedCooldownActivity =
      didCooldownChange ||
      (previous.cooldownLastDetectedAt !== null &&
        cooldownConsecutiveVisualActivityCount >= COOLDOWN_PRESENCE_VISUAL_ARMING_SAMPLES);
    const hasObservedCooldownPresence =
      previous.hasObservedCooldownPresence ||
      previous.alertedAt !== null ||
      hasConfirmedCooldownActivity;
    const isAlreadyAlerted = previous.alertedAt !== null;
    const activityDetected =
      !previous.hasObservedCooldownPresence ||
      previous.lastChangedAt === null ||
      didCooldownChange ||
      wasUnreadable ||
      usedVisualActivity;
    if (previous.alertedAt !== null) {
      const lastChangedAt = shouldRearmFromAlerted
        ? now
        : previous.lastChangedAt ?? previous.cooldownLastDetectedAt ?? previous.lastReadableAt ?? now;
      const unchangedSeconds = shouldRearmFromAlerted
        ? 0
        : Math.max(0, Math.floor((now - lastChangedAt) / 1000));

      return {
        state: {
          ...previous,
          status: shouldRearmFromAlerted ? "active" : "alerted",
          lastChangedAt,
          lastSampledAt: now,
          lastReadableAt: now,
          lastReadFailureAt: previous.lastReadFailureAt,
          unreadableSinceAt: null,
          alertedAt: shouldRearmFromAlerted ? null : previous.alertedAt,
          stableSampleCount: shouldRearmFromAlerted ? consecutiveReadableCount : 1,
          unchangedSeconds,
          fingerprint: null,
          recognizedText: currentText,
          alertedRecognizedText: shouldRearmFromAlerted ? null : previous.alertedRecognizedText,
          pendingRecognizedText: shouldRearmFromAlerted ? null : alertedRearmCandidateText,
          pendingRecognizedCount: shouldRearmFromAlerted ? 0 : alertedRearmCandidateCount,
          lastRejectedRecognizedText: null,
          lastReadFailureReason: previous.lastReadFailureReason,
          lastDecision: shouldRearmFromAlerted ? "cooldown-readable" : "cooldown-alerted",
          hasObservedExperienceChange: previous.hasObservedExperienceChange,
          hasObservedCooldownPresence: true,
          cooldownLastDetectedAt: now,
          cooldownMissingSinceAt: null,
          cooldownMissingSeconds: 0,
          cooldownConsecutiveReadableCount: shouldRearmFromAlerted
            ? consecutiveReadableCount
            : 1,
          cooldownVisualFingerprint,
          cooldownVisualChangeScore: visualChangeScore,
          cooldownVisualChangedAt,
          cooldownConsecutiveVisualActivityCount,
          cooldownUsedVisualActivity: usedVisualActivity,
          confidence: result.confidence,
          changeScore: visualChangeScore ?? 0,
          experienceTotalEstimate: previous.experienceTotalEstimate ?? null,
          experienceTotalSampleCount: previous.experienceTotalSampleCount ?? 0,
        },
        shouldAlert: false,
      };
    }
    const lastChangedAt = hasObservedCooldownPresence
      ? isAlreadyAlerted
        ? previous.lastChangedAt ?? previous.cooldownLastDetectedAt ?? previous.lastReadableAt ?? now
        : activityDetected
          ? now
          : previous.lastChangedAt
      : now;
    const unchangedSeconds =
      hasObservedCooldownPresence && lastChangedAt !== null
        ? Math.max(0, Math.floor((now - lastChangedAt) / 1000))
        : 0;
    const isInactiveTooLong = hasObservedCooldownPresence && unchangedSeconds >= threshold;
    const shouldAlert = isInactiveTooLong && previous.alertedAt === null;
    const alertedAt = previous.alertedAt ?? (shouldAlert ? now : null);

    return {
      state: {
        ...previous,
        status: hasObservedCooldownPresence ? (alertedAt ? "alerted" : "active") : "watching",
        lastChangedAt,
        lastSampledAt: now,
        lastReadableAt: now,
        lastReadFailureAt: previous.lastReadFailureAt,
        unreadableSinceAt: null,
        alertedAt,
        stableSampleCount: consecutiveReadableCount,
        unchangedSeconds,
        fingerprint: null,
        recognizedText: currentText,
        alertedRecognizedText: alertedAt ? (previous.alertedRecognizedText ?? currentText) : null,
        pendingRecognizedText: null,
        pendingRecognizedCount: 0,
        lastRejectedRecognizedText: null,
        lastReadFailureReason: previous.lastReadFailureReason,
        lastDecision: alertedAt
          ? "cooldown-alerted"
          : hasObservedCooldownPresence
            ? activityDetected
              ? didCooldownChange || wasUnreadable
                ? "cooldown-readable"
                : usedVisualActivity
                  ? "cooldown-visual-active"
                  : "cooldown-readable"
              : "cooldown-unchanged"
            : "cooldown-arming",
        hasObservedExperienceChange: previous.hasObservedExperienceChange,
        hasObservedCooldownPresence,
        cooldownLastDetectedAt: now,
        cooldownMissingSinceAt: null,
        cooldownMissingSeconds: 0,
        cooldownConsecutiveReadableCount: consecutiveReadableCount,
        cooldownVisualFingerprint,
        cooldownVisualChangeScore: visualChangeScore,
        cooldownVisualChangedAt,
        cooldownConsecutiveVisualActivityCount,
        cooldownUsedVisualActivity: usedVisualActivity,
        confidence: result.confidence,
        changeScore: visualChangeScore ?? 0,
        experienceTotalEstimate: previous.experienceTotalEstimate ?? null,
        experienceTotalSampleCount: previous.experienceTotalSampleCount ?? 0,
      },
      shouldAlert,
    };
  }

  const hasObservedCooldownPresence =
    previous.hasObservedCooldownPresence ||
    previous.alertedAt !== null ||
    (previous.cooldownLastDetectedAt !== null &&
      cooldownConsecutiveVisualActivityCount >= COOLDOWN_PRESENCE_VISUAL_ARMING_SAMPLES);
  if (usedVisualActivity) {
    const shouldRearmFromVisualActivity =
      previous.alertedAt !== null &&
      cooldownConsecutiveVisualActivityCount >= COOLDOWN_PRESENCE_VISUAL_ARMING_SAMPLES;
    const alertedAt = shouldRearmFromVisualActivity ? null : previous.alertedAt;
    const lastChangedAt = hasObservedCooldownPresence
      ? shouldRearmFromVisualActivity
        ? now
        : alertedAt
        ? previous.lastChangedAt ?? previous.cooldownLastDetectedAt ?? previous.lastReadableAt ?? now
        : now
      : previous.lastChangedAt ?? previous.cooldownLastDetectedAt ?? now;
    const unchangedSeconds =
      hasObservedCooldownPresence && lastChangedAt !== null
        ? Math.max(0, Math.floor((now - lastChangedAt) / 1000))
        : 0;

    return {
      state: {
        ...previous,
        status: hasObservedCooldownPresence ? (alertedAt ? "alerted" : "active") : "watching",
        lastChangedAt,
        lastSampledAt: now,
        lastReadableAt: previous.lastReadableAt,
        lastReadFailureAt: now,
        unreadableSinceAt: null,
        alertedAt,
        stableSampleCount: 0,
        unchangedSeconds,
        fingerprint: null,
        recognizedText: previous.recognizedText,
        alertedRecognizedText: shouldRearmFromVisualActivity
          ? null
          : previous.alertedRecognizedText,
        pendingRecognizedText: null,
        pendingRecognizedCount: 0,
        lastRejectedRecognizedText: recognizedText,
        lastReadFailureReason: result?.debug?.reason ?? "cooldown-visual-active",
        lastDecision: "cooldown-visual-active",
        hasObservedExperienceChange: previous.hasObservedExperienceChange,
        hasObservedCooldownPresence,
        cooldownLastDetectedAt: previous.cooldownLastDetectedAt,
        cooldownMissingSinceAt: null,
        cooldownMissingSeconds: 0,
        cooldownConsecutiveReadableCount: 0,
        cooldownVisualFingerprint,
        cooldownVisualChangeScore: visualChangeScore,
        cooldownVisualChangedAt,
        cooldownConsecutiveVisualActivityCount,
        cooldownUsedVisualActivity: true,
        confidence: result?.confidence ?? previous.confidence,
        changeScore: visualChangeScore ?? 0,
        experienceTotalEstimate: previous.experienceTotalEstimate ?? null,
        experienceTotalSampleCount: previous.experienceTotalSampleCount ?? 0,
      },
      shouldAlert: false,
    };
  }

  const missingSinceAt =
    hasObservedCooldownPresence
      ? previous.cooldownMissingSinceAt ??
        previous.cooldownLastDetectedAt ??
        previous.lastReadableAt ??
        previous.lastChangedAt ??
        now
      : null;
  const missingSeconds =
    missingSinceAt === null ? 0 : Math.max(0, Math.floor((now - missingSinceAt) / 1000));
  const lastChangedAt = previous.lastChangedAt ?? previous.cooldownLastDetectedAt ?? previous.lastReadableAt ?? now;
  const unchangedSeconds = hasObservedCooldownPresence
    ? Math.max(0, Math.floor((now - lastChangedAt) / 1000))
    : 0;
  const isInactiveTooLong = hasObservedCooldownPresence && unchangedSeconds >= threshold;
  const shouldAlert = isInactiveTooLong && previous.alertedAt === null;
  const alertedAt = previous.alertedAt ?? (shouldAlert ? now : null);

  return {
    state: {
      ...previous,
      status: hasObservedCooldownPresence
        ? alertedAt
          ? "alerted"
          : isInactiveTooLong
            ? "stalled"
            : "active"
        : "detecting",
      lastChangedAt,
      lastSampledAt: now,
      lastReadableAt: previous.lastReadableAt,
      lastReadFailureAt: now,
      unreadableSinceAt: missingSinceAt,
      alertedAt,
      stableSampleCount: 0,
      unchangedSeconds,
      fingerprint: null,
      recognizedText: previous.recognizedText,
      alertedRecognizedText: previous.alertedRecognizedText ?? (shouldAlert ? previous.recognizedText : null),
      pendingRecognizedText: null,
      pendingRecognizedCount: 0,
      lastRejectedRecognizedText: recognizedText,
      lastReadFailureReason: result?.debug?.reason ?? "cooldown-empty",
      lastDecision: hasObservedCooldownPresence
        ? alertedAt
          ? "cooldown-alerted"
          : "cooldown-missing"
        : "cooldown-empty",
      hasObservedExperienceChange: previous.hasObservedExperienceChange,
      hasObservedCooldownPresence,
      cooldownLastDetectedAt: previous.cooldownLastDetectedAt,
      cooldownMissingSinceAt: missingSinceAt,
      cooldownMissingSeconds: missingSeconds,
      cooldownConsecutiveReadableCount: 0,
      cooldownVisualFingerprint,
      cooldownVisualChangeScore: visualChangeScore,
      cooldownVisualChangedAt,
      cooldownConsecutiveVisualActivityCount: 0,
      cooldownUsedVisualActivity: false,
      confidence: result?.confidence ?? 0,
      changeScore: visualChangeScore ?? 0,
      experienceTotalEstimate: previous.experienceTotalEstimate ?? null,
      experienceTotalSampleCount: previous.experienceTotalSampleCount ?? 0,
    },
    shouldAlert,
  };
}
