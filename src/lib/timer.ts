import type { RecognitionResult, SkillConfig, SkillRuntimeState } from "../types";
import {
  COOLDOWN_REARM_MINIMUM_JUMP_SECONDS,
  NORMAL_DOWNWARD_TOLERANCE_SECONDS,
  NORMAL_UPWARD_TOLERANCE_SECONDS,
  TRUSTED_CONFIDENCE,
  getAutomaticTrackingWindowSeconds,
  getCooldownDerivedRemainingSeconds,
  getCooldownDurationSeconds,
  getDurationSeconds,
  getNextEffectiveCooldownDurationSeconds,
  isDenseCooldownVisualNoise,
  isCooldownSource,
  isInitialAnchorReading,
} from "./timerRules";
import {
  updateShortAnchorCandidate,
  updateStableAnchorCandidate,
} from "./timerAnchors";
import {
  hasCooldownCycleRecovered,
  isCooldownRearmCandidate,
  isFreshCooldownStartCandidate,
} from "./timerCooldown";
import {
  getEstimatedRemainingSeconds,
  getSignedEstimatedRemainingSeconds,
} from "./timerEstimates";
import {
  getRepeatAlertIntervalSeconds,
  getRepeatAlertMaxCount,
  isRepeatAlertEnabled,
} from "./repeatAlerts";

export const INITIAL_ALERT_JITTER_MAX_SECONDS = 2;
export const INITIAL_ALERT_JITTER_STEP_SECONDS = 0.5;

export {
  ALERT_THRESHOLD_MAX_SECONDS,
  ALERT_THRESHOLD_MIN_SECONDS,
  CLASS_INSTALL_ALERT_THRESHOLD_MIN_SECONDS,
  clampAlertThresholdSeconds,
  formatAlertThresholdSeconds,
  getAlertThresholdMinSeconds,
  getAutomaticTrackingWindowSeconds,
} from "./timerRules";
export {
  getEstimatedRemainingSeconds,
  getSignedEstimatedRemainingSeconds,
} from "./timerEstimates";

export function createRuntimeState(skillId: string): SkillRuntimeState {
  return {
    skillId,
    observedRemainingSeconds: null,
    observedAt: null,
    observedRemainingCount: null,
    countObservedAt: null,
    estimatedExpiresAt: null,
    confidence: 0,
    status: "idle",
    alertedAt: null,
    lastRepeatedAlertAt: null,
    repeatedAlertCount: 0,
    lastAlertCycleStartedAt: null,
    initialAlertDelaySeconds: null,
    initialAlertDelayCycleStartedAt: null,
    rejectedReading: null,
    effectiveCooldownDurationSeconds: null,
    pendingShortAnchor: null,
    pendingRemainingCountIncrease: null,
    pendingRemainingCountDrop: null,
    pendingRemainingCountAlert: null,
    buffDurationCountdownMissingSinceAt: null,
    buffDurationTimingEvent: null,
  };
}

export function applyRecognitionResult(
  previous: SkillRuntimeState,
  result: RecognitionResult,
  config: SkillConfig,
  now: number,
): SkillRuntimeState {
  if (!config.enabled) {
    return {
      ...previous,
      status: "paused",
      pendingShortAnchor: null,
      pendingRemainingCountIncrease: null,
      pendingRemainingCountDrop: null,
      pendingRemainingCountAlert: null,
    };
  }

  const estimatedRemaining = getEstimatedRemainingSeconds(previous, now);
  const candidate = result.value;
  const hasTrustedReading =
    candidate !== null &&
    result.confidence >= TRUSTED_CONFIDENCE &&
    candidate >= 0;

  if (!hasTrustedReading) {
    return {
      ...previous,
      confidence: result.confidence,
      status: previous.alertedAt ? "alerted" : previous.estimatedExpiresAt ? "running" : "detecting",
      rejectedReading: candidate,
      pendingShortAnchor: null,
    };
  }

  const hasLockedTimer = previous.estimatedExpiresAt !== null && previous.alertedAt === null;
  const trackingWindowSeconds = getAutomaticTrackingWindowSeconds(config);
  const shortAnchor = !previous.estimatedExpiresAt || previous.alertedAt
    ? updateShortAnchorCandidate(previous, candidate, config, now)
    : { pendingShortAnchor: null, ready: false };
  const hasInitialAnchorReading = isInitialAnchorReading(candidate, config) || shortAnchor.ready;

  if (isCooldownSource(config)) {
    if (isDenseCooldownVisualNoise(result, config)) {
      return {
        ...previous,
        confidence: result.confidence,
        status: previous.alertedAt ? "alerted" : previous.estimatedExpiresAt ? "running" : "detecting",
        rejectedReading: candidate,
        pendingShortAnchor: null,
      };
    }

    if (hasLockedTimer) {
      if (candidate > trackingWindowSeconds) {
        return {
          ...previous,
          confidence: result.confidence,
          status: "running",
          rejectedReading: null,
          pendingShortAnchor: null,
        };
      }

      if (!isCooldownRearmCandidate(candidate, config)) {
        return {
          ...previous,
          confidence: result.confidence,
          status: "running",
          rejectedReading: null,
          pendingShortAnchor: null,
        };
      }

      const candidateAnchor = updateStableAnchorCandidate(previous, candidate, now);
      const nextEffectiveCooldownDurationSeconds = getNextEffectiveCooldownDurationSeconds(
        candidate,
        previous,
        config,
        candidateAnchor.pendingShortAnchor,
      );

      if (
        !nextEffectiveCooldownDurationSeconds ||
        !isFreshCooldownStartCandidate(
          candidate,
          config,
          nextEffectiveCooldownDurationSeconds,
        ) ||
        !hasCooldownCycleRecovered(previous, config, nextEffectiveCooldownDurationSeconds, now)
      ) {
        return {
          ...previous,
          confidence: result.confidence,
          status: "running",
          rejectedReading: null,
          pendingShortAnchor: null,
        };
      }

      const derivedRemainingSeconds = getCooldownDerivedRemainingSeconds(
        candidate,
        config,
        nextEffectiveCooldownDurationSeconds,
      );

      if (
        estimatedRemaining === null ||
        derivedRemainingSeconds <=
          estimatedRemaining + COOLDOWN_REARM_MINIMUM_JUMP_SECONDS
      ) {
        return {
          ...previous,
          confidence: result.confidence,
          status: "running",
          rejectedReading: null,
          pendingShortAnchor: null,
        };
      }

      if (!candidateAnchor.ready) {
        return {
          ...previous,
          confidence: result.confidence,
          status: "running",
          rejectedReading: null,
          pendingShortAnchor: candidateAnchor.pendingShortAnchor,
        };
      }

      const remainingSeconds = getCooldownDerivedRemainingSeconds(
        candidate,
        config,
        nextEffectiveCooldownDurationSeconds,
      );

      return {
        ...previous,
        observedRemainingSeconds: remainingSeconds,
        observedAt: now,
        estimatedExpiresAt: now + remainingSeconds * 1000,
        confidence: result.confidence,
        status: "running",
        alertedAt: null,
        lastRepeatedAlertAt: null,
        repeatedAlertCount: 0,
        lastAlertCycleStartedAt: now,
        rejectedReading: null,
        effectiveCooldownDurationSeconds: nextEffectiveCooldownDurationSeconds,
        pendingShortAnchor: null,
      };
    }

    if (candidate > trackingWindowSeconds) {
      return {
        ...previous,
        confidence: result.confidence,
        status: previous.alertedAt ? "alerted" : "detecting",
        rejectedReading: candidate,
        pendingShortAnchor: null,
      };
    }

    if (
      previous.alertedAt &&
      !isCooldownRearmCandidate(candidate, config) &&
      !shortAnchor.pendingShortAnchor &&
      !shortAnchor.ready
    ) {
      return {
        ...previous,
        confidence: result.confidence,
        status: "alerted",
        rejectedReading: candidate,
        pendingShortAnchor: null,
      };
    }

    if (!hasInitialAnchorReading) {
      return {
        ...previous,
        confidence: result.confidence,
        status: previous.alertedAt ? "alerted" : "detecting",
        rejectedReading: candidate,
        pendingShortAnchor: shortAnchor.pendingShortAnchor,
      };
    }

    const candidateAnchor = isInitialAnchorReading(candidate, config)
      ? updateStableAnchorCandidate(previous, candidate, now)
      : shortAnchor;

    if (!candidateAnchor.ready) {
      return {
        ...previous,
        confidence: result.confidence,
        status: previous.alertedAt ? "alerted" : "detecting",
        rejectedReading: candidate,
        pendingShortAnchor: candidateAnchor.pendingShortAnchor,
      };
    }

    const effectiveCooldownDurationSeconds = getNextEffectiveCooldownDurationSeconds(
      candidate,
      previous,
      config,
      candidateAnchor.pendingShortAnchor,
    );

    if (
      previous.alertedAt !== null &&
      (
        !effectiveCooldownDurationSeconds ||
        !hasCooldownCycleRecovered(
          previous,
          config,
          effectiveCooldownDurationSeconds,
          now,
        )
      )
    ) {
      return {
        ...previous,
        confidence: result.confidence,
        status: "alerted",
        rejectedReading: null,
        pendingShortAnchor: null,
      };
    }

    const remainingSeconds = getCooldownDerivedRemainingSeconds(
      candidate,
      config,
      effectiveCooldownDurationSeconds,
    );

    return {
      ...previous,
      observedRemainingSeconds: remainingSeconds,
      observedAt: now,
      estimatedExpiresAt: now + remainingSeconds * 1000,
      confidence: result.confidence,
      status: "running",
      alertedAt: null,
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 0,
      lastAlertCycleStartedAt: now,
      rejectedReading: null,
      effectiveCooldownDurationSeconds,
      pendingShortAnchor: null,
    };
  }

  const shouldRearm = previous.alertedAt !== null && hasInitialAnchorReading;
  const canStartTimerFromReading =
    hasLockedTimer || shouldRearm || hasInitialAnchorReading;

  const normalCountdown =
    estimatedRemaining === null ||
    (candidate <= estimatedRemaining + NORMAL_UPWARD_TOLERANCE_SECONDS &&
      candidate >= estimatedRemaining - NORMAL_DOWNWARD_TOLERANCE_SECONDS);

  if (candidate > trackingWindowSeconds) {
    if (hasLockedTimer || previous.alertedAt) {
      return {
        ...previous,
        confidence: result.confidence,
        status: previous.alertedAt ? "alerted" : previous.estimatedExpiresAt ? "running" : "detecting",
        rejectedReading: candidate,
        pendingShortAnchor: null,
      };
    }

    return {
      ...previous,
      observedRemainingSeconds: null,
      observedAt: null,
      estimatedExpiresAt: null,
      confidence: result.confidence,
      status: shouldRearm ? "detecting" : previous.alertedAt ? "alerted" : "detecting",
      alertedAt: shouldRearm ? null : previous.alertedAt,
      lastAlertCycleStartedAt: shouldRearm ? now : previous.lastAlertCycleStartedAt,
      rejectedReading: candidate,
      pendingShortAnchor: null,
    };
  }

  if (!canStartTimerFromReading) {
    return {
      ...previous,
      confidence: result.confidence,
      status: previous.alertedAt ? "alerted" : previous.estimatedExpiresAt ? "running" : "detecting",
      rejectedReading: candidate,
      pendingShortAnchor: shortAnchor.pendingShortAnchor,
    };
  }

  if (!normalCountdown && !shouldRearm) {
    return {
      ...previous,
      confidence: result.confidence,
      status: previous.alertedAt ? "alerted" : previous.estimatedExpiresAt ? "running" : "detecting",
      rejectedReading: candidate,
      pendingShortAnchor: null,
    };
  }

  const estimatedExpiresAt = now + candidate * 1000;

  return {
    ...previous,
    observedRemainingSeconds: candidate,
    observedAt: now,
    estimatedExpiresAt,
    confidence: result.confidence,
    status: candidate <= config.alertThresholdSeconds && previous.alertedAt ? "alerted" : "running",
    alertedAt: shouldRearm ? null : previous.alertedAt,
    lastRepeatedAlertAt: shouldRearm ? null : previous.lastRepeatedAlertAt,
    repeatedAlertCount: shouldRearm ? 0 : previous.repeatedAlertCount,
    lastAlertCycleStartedAt: shouldRearm ? now : previous.lastAlertCycleStartedAt ?? now,
    rejectedReading: null,
    effectiveCooldownDurationSeconds: null,
    pendingShortAnchor: null,
  };
}

export function shouldFireAlert(
  state: SkillRuntimeState,
  config: SkillConfig,
  now: number,
): boolean {
  if (!config.enabled || state.alertedAt || state.pendingShortAnchor) {
    return false;
  }

  if (hasActiveInitialAlertDelayCycle(state)) {
    const remainingMs = getSignedEstimatedRemainingMilliseconds(state, now);
    return (
      remainingMs !== null &&
      remainingMs <= getEffectiveAlertThresholdMilliseconds(state, config)
    );
  }

  const remaining = getSignedEstimatedRemainingSeconds(state, now);
  return (
    remaining !== null &&
    remaining <= getEffectiveAlertThresholdSeconds(state, config)
  );
}

export function shouldFireRemainingCountAlert(
  state: SkillRuntimeState,
  config: Pick<SkillConfig, "alertThresholdSeconds" | "enabled">,
): boolean {
  if (
    !config.enabled ||
    state.alertedAt ||
    state.pendingRemainingCountIncrease ||
    state.pendingRemainingCountDrop ||
    state.pendingRemainingCountAlert ||
    state.observedRemainingCount === null
  ) {
    return false;
  }

  return state.observedRemainingCount <= config.alertThresholdSeconds;
}

export function markAlerted(state: SkillRuntimeState, now: number): SkillRuntimeState {
  return {
    ...state,
    status: "alerted",
    alertedAt: now,
    lastRepeatedAlertAt: null,
    repeatedAlertCount: 0,
    pendingShortAnchor: null,
    pendingRemainingCountIncrease: null,
    pendingRemainingCountDrop: null,
    pendingRemainingCountAlert: null,
  };
}

export function getEffectiveAlertThresholdSeconds(
  state: SkillRuntimeState,
  config: Pick<SkillConfig, "alertThresholdSeconds">,
): number {
  return config.alertThresholdSeconds - getInitialAlertDelaySeconds(state);
}

function getEffectiveAlertThresholdMilliseconds(
  state: SkillRuntimeState,
  config: Pick<SkillConfig, "alertThresholdSeconds">,
): number {
  return getEffectiveAlertThresholdSeconds(state, config) * 1000;
}

export function getInitialAlertDelaySeconds(
  state: Pick<SkillRuntimeState, "initialAlertDelaySeconds">,
): number {
  const value = state.initialAlertDelaySeconds;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? normalizeInitialAlertDelaySeconds(value)
    : 0;
}

export function getSkillAlertInSeconds(
  state: SkillRuntimeState,
  config: Pick<SkillConfig, "alertThresholdSeconds">,
  now: number,
): number | null {
  if (hasActiveInitialAlertDelayCycle(state)) {
    const remainingMs = getSignedEstimatedRemainingMilliseconds(state, now);
    if (remainingMs === null) {
      return null;
    }

    return roundUpToInitialAlertJitterStepSeconds(
      Math.max(
        0,
        (remainingMs - config.alertThresholdSeconds * 1000 +
          getInitialAlertDelaySeconds(state) * 1000) / 1000,
      ),
    );
  }

  const signedRemaining = getSignedEstimatedRemainingSeconds(state, now);
  if (signedRemaining === null) {
    return null;
  }

  return Math.max(
    0,
    signedRemaining - config.alertThresholdSeconds + getInitialAlertDelaySeconds(state),
  );
}

export function getSkillAlertInRemainingCount(
  state: SkillRuntimeState,
  config: Pick<SkillConfig, "alertThresholdSeconds" | "enabled">,
): number | null {
  if (!config.enabled || state.observedRemainingCount === null) {
    return null;
  }

  return Math.max(0, state.observedRemainingCount - config.alertThresholdSeconds);
}

export type SkillInitialAlertCountdownParts = {
  baseSeconds: number;
  delaySeconds: number;
  hasInitialDelay: boolean;
};

export function getSkillInitialAlertCountdownParts(
  state: SkillRuntimeState,
  config: Pick<SkillConfig, "alertThresholdSeconds">,
  now: number,
): SkillInitialAlertCountdownParts | null {
  const signedRemaining = getSignedEstimatedRemainingSeconds(state, now);
  const remainingMs = getSignedEstimatedRemainingMilliseconds(state, now);
  if (signedRemaining === null || remainingMs === null) {
    return null;
  }

  const delaySeconds = getInitialAlertDelaySeconds(state);
  const hasInitialDelay = hasActiveInitialAlertDelayCycle(state);
  const preciseTotalSeconds = Math.max(
    0,
    (remainingMs - config.alertThresholdSeconds * 1000 + delaySeconds * 1000) / 1000,
  );
  const baseSeconds = hasInitialDelay
    ? Math.max(0, signedRemaining - config.alertThresholdSeconds)
    : Math.max(0, signedRemaining - config.alertThresholdSeconds);
  const totalSeconds = hasInitialDelay
    ? roundUpToInitialAlertJitterStepSeconds(preciseTotalSeconds)
    : Math.max(0, signedRemaining - config.alertThresholdSeconds + delaySeconds);
  return {
    baseSeconds,
    delaySeconds: baseSeconds > 0 ? delaySeconds : totalSeconds,
    hasInitialDelay,
  };
}

export function sampleInitialAlertDelaySeconds(random = Math.random): number {
  const raw = random();
  const bucketCount = Math.floor(
    INITIAL_ALERT_JITTER_MAX_SECONDS / INITIAL_ALERT_JITTER_STEP_SECONDS,
  ) + 1;
  const bucket = Number.isFinite(raw)
    ? Math.floor(raw * bucketCount)
    : 0;
  return normalizeInitialAlertDelaySeconds(bucket * INITIAL_ALERT_JITTER_STEP_SECONDS);
}

function normalizeInitialAlertDelaySeconds(value: number): number {
  const raw = value;
  if (!Number.isFinite(raw)) {
    return 0;
  }
  const clamped = Math.max(
    0,
    Math.min(
      INITIAL_ALERT_JITTER_MAX_SECONDS,
      raw,
    ),
  );
  return Math.round(clamped / INITIAL_ALERT_JITTER_STEP_SECONDS) *
    INITIAL_ALERT_JITTER_STEP_SECONDS;
}

function hasActiveInitialAlertDelayCycle(state: SkillRuntimeState): boolean {
  return (
    state.alertedAt === null &&
    state.initialAlertDelaySeconds !== null &&
    state.initialAlertDelayCycleStartedAt === state.lastAlertCycleStartedAt
  );
}

function getSignedEstimatedRemainingMilliseconds(
  state: Pick<SkillRuntimeState, "estimatedExpiresAt">,
  now: number,
): number | null {
  if (!state.estimatedExpiresAt) {
    return null;
  }

  return state.estimatedExpiresAt - now;
}

function roundUpToInitialAlertJitterStepSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.ceil(value / INITIAL_ALERT_JITTER_STEP_SECONDS) *
    INITIAL_ALERT_JITTER_STEP_SECONDS;
}

export function applyInitialAlertDelay(
  state: SkillRuntimeState,
  enabled: boolean,
  getDelaySeconds: () => number = sampleInitialAlertDelaySeconds,
): SkillRuntimeState {
  const shouldClear =
    !enabled ||
    state.estimatedExpiresAt === null ||
    state.lastAlertCycleStartedAt === null ||
    state.status === "paused";
  if (shouldClear) {
    if (
      state.initialAlertDelaySeconds === null &&
      state.initialAlertDelayCycleStartedAt === null
    ) {
      return state;
    }
    return {
      ...state,
      initialAlertDelaySeconds: null,
      initialAlertDelayCycleStartedAt: null,
    };
  }

  if (
    state.initialAlertDelayCycleStartedAt === state.lastAlertCycleStartedAt &&
    state.initialAlertDelaySeconds !== null
  ) {
    return state;
  }

  return {
    ...state,
    initialAlertDelaySeconds: normalizeInitialAlertDelaySeconds(getDelaySeconds()),
    initialAlertDelayCycleStartedAt: state.lastAlertCycleStartedAt,
  };
}

export function shouldRepeatAlert(
  state: SkillRuntimeState,
  config: SkillConfig,
  now: number,
): boolean {
  if (!config.enabled || !isRepeatAlertEnabled(config) || state.alertedAt === null) {
    return false;
  }

  const lastAlertAt = state.lastRepeatedAlertAt;
  if (lastAlertAt === null) {
    return false;
  }

  const maxRepeatCount = getRepeatAlertMaxCount(config);
  if (maxRepeatCount !== null && state.repeatedAlertCount >= maxRepeatCount) {
    return false;
  }

  return now - lastAlertAt >= getRepeatAlertIntervalSeconds(config) * 1000;
}

export function markRepeatedAlert(state: SkillRuntimeState, _now: number): SkillRuntimeState {
  return {
    ...state,
    status: "alerted",
    lastRepeatedAlertAt: null,
    repeatedAlertCount: state.repeatedAlertCount + 1,
  };
}

export function markAlertPlaybackFinished(
  state: SkillRuntimeState,
  alertCycleStartedAt: number,
  finishedAt: number,
): SkillRuntimeState {
  if (state.status !== "alerted" || state.alertedAt !== alertCycleStartedAt) {
    return state;
  }

  return {
    ...state,
    lastRepeatedAlertAt: finishedAt,
  };
}

export function startManualCycle(
  previous: SkillRuntimeState,
  config: SkillConfig,
  now: number,
): SkillRuntimeState {
  const remainingSeconds = isCooldownSource(config)
    ? getDurationSeconds(config)
    : getAutomaticTrackingWindowSeconds(config);
  const effectiveCooldownDurationSeconds = isCooldownSource(config)
    ? (previous.effectiveCooldownDurationSeconds ?? getCooldownDurationSeconds(config))
    : null;

  return {
    ...previous,
    observedRemainingSeconds: remainingSeconds,
    observedAt: now,
    estimatedExpiresAt: now + remainingSeconds * 1000,
    confidence: 1,
    status: "running",
    alertedAt: null,
    lastRepeatedAlertAt: null,
    repeatedAlertCount: 0,
    lastAlertCycleStartedAt: now,
    rejectedReading: null,
    effectiveCooldownDurationSeconds,
    pendingShortAnchor: null,
    observedRemainingCount: null,
    countObservedAt: null,
    pendingRemainingCountIncrease: null,
    pendingRemainingCountDrop: null,
    pendingRemainingCountAlert: null,
  };
}
