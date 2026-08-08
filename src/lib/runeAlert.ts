import type {
  RuneAlertDecisionReason,
  RuneAlertPlaybackState,
  RuneDetectionRuntimeError,
  RuneRuntimeCandidate,
  RuneRuntimeState,
} from "../alertTypes";
import type { RuneAlertConfig } from "../types";
import type { RuneSceneObservation } from "./runeSceneIdentity";
import {
  evaluateRuneConfirmation,
  RUNE_CONFIRMATION_POLICY,
} from "./runeAlertPolicy";
import {
  getRepeatAlertIntervalSeconds,
  getRepeatAlertMaxCount,
  isRepeatAlertEnabled,
} from "./repeatAlerts";
import type { RuneDetectionResult } from "./runeDetection";

const DETECTION_GAP_GRACE_MILLISECONDS = 1400;
const ALERT_RESET_MILLISECONDS = 5000;
const CONFIRMED_ABSENCE_FRAME_COUNT = 2;
const MIN_SAME_RUNE_CENTER_DISTANCE_PX = 10;
const SAME_RUNE_SIZE_RATIO = 0.85;
const RUNE_RUNTIME_TRACE_LIMIT = 72;

export function createRuneRuntimeState(): RuneRuntimeState {
  return {
    status: "paused",
    detectorVersion: null,
    confidence: 0,
    stableCount: 0,
    consecutiveMissCount: 0,
    scenePolicyVersion: null,
    sceneEpoch: 0,
    sceneChangedAt: null,
    sceneChangeScore: null,
    scenePendingStableCount: 0,
    firstDetectedAt: null,
    lastDetectedAt: null,
    lastFoundAt: null,
    alertedAt: null,
    alertedSceneEpoch: null,
    lastDetectedCandidate: null,
    alertedCandidate: null,
    lastRepeatedAlertAt: null,
    repeatedAlertCount: 0,
    lastAlertedAt: null,
    candidateCount: 0,
    lastDecisionReason: null,
    lastAlertPlayback: null,
    lastDetectionError: null,
    recentSamples: [],
  };
}

export function updateRuneRuntimeState({
  previous,
  detection,
  now,
  enabled,
  hasStream,
  hasRegion,
  config,
  scene,
}: {
  previous: RuneRuntimeState;
  detection: RuneDetectionResult | null;
  now: number;
  enabled: boolean;
  hasStream: boolean;
  hasRegion: boolean;
  config?: Pick<
    RuneAlertConfig,
    "repeatAlertEnabled" | "repeatAlertIntervalSeconds" | "repeatAlertMaxCount"
  >;
  scene?: RuneSceneObservation | null;
}): {
  state: RuneRuntimeState;
  shouldAlert: boolean;
  alertDecision: "initial" | "repeat" | null;
} {
  const sceneEpoch = scene?.sceneEpoch ?? previous.sceneEpoch ?? 0;
  const sceneChanged = scene?.changed ?? false;
  const scenePolicyVersion = scene?.policyVersion ?? previous.scenePolicyVersion ?? null;
  const sceneChangedAt = sceneChanged
    ? scene?.changedAt ?? now
    : previous.sceneChangedAt ?? null;
  const sceneChangeScore = scene?.changeScore ?? previous.sceneChangeScore ?? null;
  const scenePendingStableCount = scene?.pendingStableCount ?? 0;
  const sameSceneAsPrevious =
    !sceneChanged && (previous.sceneEpoch ?? sceneEpoch) === sceneEpoch;

  if (!enabled) {
    const state = {
      ...createRuneRuntimeState(),
      status: "paused" as const,
      detectorVersion: previous.detectorVersion ?? null,
      lastFoundAt: previous.lastFoundAt,
      lastAlertedAt: previous.lastAlertedAt,
    };
    return {
      state: appendRuneRuntimeTrace(previous, state, {
        now,
        detection,
        candidate: null,
        shouldAlert: false,
        reason: "paused",
      }),
      shouldAlert: false,
      alertDecision: null,
    };
  }

  if (!hasStream) {
    const state = {
      ...createRuneRuntimeState(),
      status: "no-stream" as const,
      detectorVersion: previous.detectorVersion ?? null,
      lastFoundAt: previous.lastFoundAt,
      lastAlertedAt: previous.lastAlertedAt,
    };
    return {
      state: appendRuneRuntimeTrace(previous, state, {
        now,
        detection,
        candidate: null,
        shouldAlert: false,
        reason: "no-stream",
      }),
      shouldAlert: false,
      alertDecision: null,
    };
  }

  if (!hasRegion) {
    const state = {
      ...createRuneRuntimeState(),
      status: "no-region" as const,
      detectorVersion: previous.detectorVersion ?? null,
      lastFoundAt: previous.lastFoundAt,
      lastAlertedAt: previous.lastAlertedAt,
    };
    return {
      state: appendRuneRuntimeTrace(previous, state, {
        now,
        detection,
        candidate: null,
        shouldAlert: false,
        reason: "no-region",
      }),
      shouldAlert: false,
      alertDecision: null,
    };
  }

  if (!detection?.detected) {
    const consecutiveMissCount = sameSceneAsPrevious
      ? (previous.consecutiveMissCount ?? 0) + 1
      : 1;
    const confirmedAbsent = consecutiveMissCount >= CONFIRMED_ABSENCE_FRAME_COUNT;
    const recentDetection =
      sameSceneAsPrevious &&
      !confirmedAbsent &&
      previous.lastDetectedAt !== null &&
      now - previous.lastDetectedAt <= DETECTION_GAP_GRACE_MILLISECONDS;
    const keepAlerted =
      sameSceneAsPrevious &&
      !confirmedAbsent &&
      previous.status === "alerted" &&
      previous.lastDetectedAt !== null &&
      now - previous.lastDetectedAt <= ALERT_RESET_MILLISECONDS;

    const state = {
      ...previous,
      status: keepAlerted ? "alerted" as const : recentDetection ? "candidate" as const : "waiting" as const,
      detectorVersion: detection?.debug.classifier ?? previous.detectorVersion ?? null,
      confidence: detection?.confidence ?? 0,
      consecutiveMissCount,
      scenePolicyVersion,
      sceneEpoch,
      sceneChangedAt,
      sceneChangeScore,
      scenePendingStableCount,
      stableCount: recentDetection ? previous.stableCount : 0,
      firstDetectedAt: recentDetection ? previous.firstDetectedAt : null,
      lastDetectedAt: recentDetection ? previous.lastDetectedAt : null,
      lastFoundAt: previous.lastFoundAt,
      alertedAt: keepAlerted ? previous.alertedAt : null,
      alertedSceneEpoch: keepAlerted ? previous.alertedSceneEpoch ?? sceneEpoch : null,
      lastDetectedCandidate: recentDetection ? previous.lastDetectedCandidate ?? null : null,
      alertedCandidate: keepAlerted ? previous.alertedCandidate ?? null : null,
      lastRepeatedAlertAt: keepAlerted ? previous.lastRepeatedAlertAt : null,
      repeatedAlertCount: keepAlerted ? previous.repeatedAlertCount : 0,
      lastAlertedAt: previous.lastAlertedAt,
      candidateCount: detection?.candidates.length ?? 0,
      lastDetectionError: null,
    };
    return {
      state: appendRuneRuntimeTrace(previous, state, {
        now,
        detection,
        candidate: null,
        shouldAlert: false,
        reason: sceneChanged
          ? "scene-changed"
          : confirmedAbsent
            ? "confirmed-absent"
            : keepAlerted
              ? "alert-cycle-grace"
              : recentDetection
                ? "detection-gap-grace"
                : "waiting",
        sceneChanged,
      }),
      shouldAlert: false,
      alertDecision: null,
    };
  }

  const currentCandidate = toRuneRuntimeCandidate(detection.candidates[0] ?? null);
  const continuesDetection =
    sameSceneAsPrevious &&
    previous.lastDetectedAt !== null &&
    now - previous.lastDetectedAt <= DETECTION_GAP_GRACE_MILLISECONDS &&
    isSameRuneCandidate(currentCandidate, previous.lastDetectedCandidate ?? null);
  const firstDetectedAt = continuesDetection ? previous.firstDetectedAt ?? now : now;
  const stableCount = continuesDetection ? previous.stableCount + 1 : 1;
  const confirmation = evaluateRuneConfirmation({
    stableCount,
    firstDetectedAt,
    now,
  });
  const isStable = confirmation.satisfied;
  const isExpiredAlertCycle =
    previous.lastDetectedAt !== null && now - previous.lastDetectedAt > ALERT_RESET_MILLISECONDS;
  const isSameAlertScene =
    (previous.alertedSceneEpoch ?? previous.sceneEpoch ?? sceneEpoch) === sceneEpoch;
  const hasActiveAlertCycle =
    !sceneChanged &&
    isSameAlertScene &&
    (previous.consecutiveMissCount ?? 0) < CONFIRMED_ABSENCE_FRAME_COUNT &&
    previous.status === "alerted" &&
    previous.alertedAt !== null &&
    !isExpiredAlertCycle;
  const isSameAsAlertedRune = previous.alertedCandidate
    ? hasActiveAlertCycle && isSameRuneCandidate(currentCandidate, previous.alertedCandidate)
    : hasActiveAlertCycle;
  const wasAlerted = isSameAsAlertedRune;
  const canRepeatCurrentRune = hasActiveAlertCycle && isSameAsAlertedRune;
  const repeatReferenceAt = previous.lastRepeatedAlertAt;
  const repeatMaxCount = getRepeatAlertMaxCount(config ?? {});
  const shouldInitialAlert = isStable && !wasAlerted;
  const shouldRepeatAlert =
    isStable &&
    canRepeatCurrentRune &&
    isRepeatAlertEnabled(config ?? {}) &&
    repeatReferenceAt !== null &&
    (repeatMaxCount === null || previous.repeatedAlertCount < repeatMaxCount) &&
    now - repeatReferenceAt >= getRepeatAlertIntervalSeconds(config ?? {}) * 1000;
  const shouldAlert = shouldInitialAlert || shouldRepeatAlert;
  const alertDecision = shouldInitialAlert ? "initial" : shouldRepeatAlert ? "repeat" : null;
  const lastAlertedAt = shouldAlert ? now : previous.lastAlertedAt;
  const lastFoundAt = shouldInitialAlert ? firstDetectedAt : previous.lastFoundAt;
  const alertedAt = shouldInitialAlert
    ? now
    : hasActiveAlertCycle
      ? previous.alertedAt
      : null;
  const alertedCandidate = shouldInitialAlert
    ? currentCandidate
    : hasActiveAlertCycle
      ? previous.alertedCandidate ?? null
      : null;
  const alertedSceneEpoch = shouldInitialAlert
    ? sceneEpoch
    : hasActiveAlertCycle
      ? previous.alertedSceneEpoch ?? sceneEpoch
      : null;
  const lastAlertPlayback = shouldAlert
    ? createRequestedPlaybackState(alertDecision, now, sceneEpoch)
    : previous.lastAlertPlayback ?? null;

  const state = {
    status: isStable || hasActiveAlertCycle ? "alerted" as const : "candidate" as const,
    detectorVersion: detection.debug.classifier ?? previous.detectorVersion ?? null,
    confidence: detection.confidence,
    stableCount,
    consecutiveMissCount: 0,
    scenePolicyVersion,
    sceneEpoch,
    sceneChangedAt,
    sceneChangeScore,
    scenePendingStableCount,
    firstDetectedAt,
    lastDetectedAt: now,
    lastFoundAt,
    alertedAt,
    alertedSceneEpoch,
    lastDetectedCandidate: currentCandidate,
    alertedCandidate,
    lastRepeatedAlertAt: shouldAlert
      ? null
      : hasActiveAlertCycle
        ? previous.lastRepeatedAlertAt
        : null,
    repeatedAlertCount: shouldRepeatAlert
      ? previous.repeatedAlertCount + 1
      : hasActiveAlertCycle && !shouldInitialAlert
        ? previous.repeatedAlertCount
        : 0,
    lastAlertedAt,
    candidateCount: detection.candidates.length,
    lastDecisionReason: previous.lastDecisionReason ?? null,
    lastAlertPlayback,
    lastDetectionError: null,
    recentSamples: previous.recentSamples ?? [],
  };

  return {
    state: appendRuneRuntimeTrace(previous, state, {
      now,
      detection,
      candidate: currentCandidate,
      shouldAlert,
      reason: getRuneAlertDecisionReason({
        alertDecision,
        canRepeatCurrentRune,
        isStable,
        previous,
        repeatEnabled: isRepeatAlertEnabled(config ?? {}),
        repeatMaxCount,
        repeatReferenceAt,
        shouldInitialAlert,
      }),
      sceneChanged,
    }),
    shouldAlert,
    alertDecision,
  };
}

export function markRuneDetectorUnavailable({
  previous,
  error,
}: {
  previous: RuneRuntimeState;
  error: RuneDetectionRuntimeError;
}): RuneRuntimeState {
  const state: RuneRuntimeState = {
    ...previous,
    status: "unavailable",
    confidence: 0,
    candidateCount: 0,
    lastDecisionReason: "detector-error",
    lastDetectionError: error,
  };
  const sample = {
    sampledAt: error.occurredAt,
    detected: false,
    outcome: "error" as const,
    confidence: 0,
    candidateCount: 0,
    candidate: null,
    status: state.status,
    stableCount: state.stableCount,
    consecutiveMissCount: state.consecutiveMissCount ?? 0,
    scenePolicyVersion: state.scenePolicyVersion ?? undefined,
    sceneEpoch: state.sceneEpoch ?? 0,
    sceneChanged: false,
    sceneChangeScore: state.sceneChangeScore ?? null,
    scenePendingStableCount: state.scenePendingStableCount ?? 0,
    firstDetectedAt: state.firstDetectedAt,
    stableDurationMs:
      state.firstDetectedAt === null
        ? 0
        : Math.max(0, error.occurredAt - state.firstDetectedAt),
    confirmationPolicyVersion: RUNE_CONFIRMATION_POLICY.version,
    confirmationPolicyMode: RUNE_CONFIRMATION_POLICY.mode,
    confirmationSatisfied: false,
    confirmationSatisfiedBy: null,
    shouldAlert: false,
    reason: "detector-error" as const,
    error,
  };

  return {
    ...state,
    recentSamples: [...(previous.recentSamples ?? []), sample].slice(-RUNE_RUNTIME_TRACE_LIMIT),
  };
}

function createRequestedPlaybackState(
  decision: "initial" | "repeat" | null,
  requestedAt: number,
  sceneEpoch: number,
): RuneAlertPlaybackState | null {
  if (!decision) {
    return null;
  }

  return {
    status: "requested",
    decision,
    cycleId: `${sceneEpoch}:${requestedAt}:${decision}`,
    sceneEpoch,
    requestedAt,
    startedAt: null,
    finishedAt: null,
    failedAt: null,
    error: null,
    soundId: null,
    alertVolume: null,
    masterVolume: null,
    effectiveVolume: null,
  };
}

function getRuneAlertDecisionReason({
  alertDecision,
  canRepeatCurrentRune,
  isStable,
  previous,
  repeatEnabled,
  repeatMaxCount,
  repeatReferenceAt,
  shouldInitialAlert,
}: {
  alertDecision: "initial" | "repeat" | null;
  canRepeatCurrentRune: boolean;
  isStable: boolean;
  previous: RuneRuntimeState;
  repeatEnabled: boolean;
  repeatMaxCount: number | null;
  repeatReferenceAt: number | null;
  shouldInitialAlert: boolean;
}): RuneAlertDecisionReason {
  if (alertDecision === "initial") {
    return "initial-alert";
  }
  if (alertDecision === "repeat") {
    return "repeat-alert";
  }
  if (!isStable) {
    return "stabilizing";
  }
  if (!canRepeatCurrentRune) {
    return shouldInitialAlert ? "initial-alert" : "already-alerted-same-rune";
  }
  if (!repeatEnabled) {
    return "repeat-disabled";
  }
  if (repeatReferenceAt === null) {
    return "repeat-playback-pending";
  }
  if (repeatMaxCount !== null && previous.repeatedAlertCount >= repeatMaxCount) {
    return "repeat-maxed";
  }
  return "repeat-interval-waiting";
}

function appendRuneRuntimeTrace(
  previous: RuneRuntimeState,
  state: RuneRuntimeState,
  {
    now,
    detection,
    candidate,
    shouldAlert,
    reason,
    sceneChanged = false,
  }: {
    now: number;
    detection: RuneDetectionResult | null;
    candidate: RuneRuntimeCandidate | null;
    shouldAlert: boolean;
    reason: RuneAlertDecisionReason;
    sceneChanged?: boolean;
  },
): RuneRuntimeState {
  const confirmation = evaluateRuneConfirmation({
    stableCount: state.stableCount,
    firstDetectedAt: state.firstDetectedAt,
    now,
  });
  const sample = {
    sampledAt: now,
    detected: Boolean(detection?.detected),
    outcome: detection?.detected ? "detected" as const : "not-detected" as const,
    confidence: detection?.confidence ?? 0,
    candidateCount: detection?.candidates.length ?? 0,
    candidate,
    status: state.status,
    stableCount: state.stableCount,
    consecutiveMissCount: state.consecutiveMissCount ?? 0,
    scenePolicyVersion: state.scenePolicyVersion ?? undefined,
    sceneEpoch: state.sceneEpoch ?? 0,
    sceneChanged,
    sceneChangeScore: state.sceneChangeScore ?? null,
    scenePendingStableCount: state.scenePendingStableCount ?? 0,
    firstDetectedAt: state.firstDetectedAt,
    stableDurationMs: confirmation.stableDurationMs,
    confirmationPolicyVersion: RUNE_CONFIRMATION_POLICY.version,
    confirmationPolicyMode: RUNE_CONFIRMATION_POLICY.mode,
    confirmationSatisfied: Boolean(detection?.detected && confirmation.satisfied),
    confirmationSatisfiedBy: detection?.detected ? confirmation.satisfiedBy : null,
    shouldAlert,
    reason,
  };

  return {
    ...state,
    lastDecisionReason: reason,
    recentSamples: [...(previous.recentSamples ?? []), sample].slice(-RUNE_RUNTIME_TRACE_LIMIT),
  };
}

function toRuneRuntimeCandidate(
  candidate: RuneDetectionResult["candidates"][number] | null,
): RuneRuntimeCandidate | null {
  if (!candidate) {
    return null;
  }

  return {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
  };
}

function isSameRuneCandidate(
  currentCandidate: RuneRuntimeCandidate | null,
  previousCandidate: RuneRuntimeCandidate | null,
) {
  if (!currentCandidate || !previousCandidate) {
    return true;
  }

  const currentCenterX = currentCandidate.x + currentCandidate.width / 2;
  const currentCenterY = currentCandidate.y + currentCandidate.height / 2;
  const previousCenterX = previousCandidate.x + previousCandidate.width / 2;
  const previousCenterY = previousCandidate.y + previousCandidate.height / 2;
  const centerDistance = Math.hypot(currentCenterX - previousCenterX, currentCenterY - previousCenterY);
  const averageSize =
    (currentCandidate.width +
      currentCandidate.height +
      previousCandidate.width +
      previousCandidate.height) /
    4;
  const sameRuneDistance = Math.max(
    MIN_SAME_RUNE_CENTER_DISTANCE_PX,
    averageSize * SAME_RUNE_SIZE_RATIO,
  );

  return centerDistance <= sameRuneDistance;
}

export function markRuneAlertPlaybackFinished(
  state: RuneRuntimeState,
  playbackCycleId: string,
  finishedAt: number,
): RuneRuntimeState {
  const playback = state.lastAlertPlayback;
  if (!playback || playback.cycleId !== playbackCycleId) {
    return state;
  }

  const belongsToActiveScene =
    state.status === "alerted" &&
    (state.alertedSceneEpoch ?? state.sceneEpoch ?? 0) === playback.sceneEpoch;

  return {
    ...state,
    lastRepeatedAlertAt: belongsToActiveScene ? finishedAt : state.lastRepeatedAlertAt,
    lastAlertedAt: finishedAt,
    lastAlertPlayback: {
      ...playback,
      status: "finished",
      finishedAt,
      failedAt: null,
      error: null,
    },
  };
}

export function attachRuneAlertPlaybackDetails(
  state: RuneRuntimeState,
  playbackCycleId: string,
  details: {
    soundId: string;
    alertVolume: number;
    masterVolume: number;
    effectiveVolume: number;
  },
): RuneRuntimeState {
  if (state.lastAlertPlayback?.cycleId !== playbackCycleId) {
    return state;
  }

  return {
    ...state,
    lastAlertPlayback: {
      ...state.lastAlertPlayback,
      ...details,
    },
  };
}

export function markRuneAlertPlaybackStarted(
  state: RuneRuntimeState,
  playbackCycleId: string,
  startedAt: number,
): RuneRuntimeState {
  const playback = state.lastAlertPlayback;
  if (!playback || playback.cycleId !== playbackCycleId || playback.status !== "requested") {
    return state;
  }

  return {
    ...state,
    lastAlertPlayback: {
      ...playback,
      status: "started",
      startedAt,
      finishedAt: null,
      failedAt: null,
      error: null,
    },
  };
}

export function mergeRuneRuntimePlaybackProgress(
  next: RuneRuntimeState,
  latest: RuneRuntimeState,
): RuneRuntimeState {
  if (next === latest) {
    return next;
  }

  const nextPlayback = next.lastAlertPlayback ?? null;
  const latestPlayback = latest.lastAlertPlayback ?? null;
  const latestAdvancedSamePlayback =
    nextPlayback !== null &&
    latestPlayback !== null &&
    nextPlayback.cycleId === latestPlayback.cycleId &&
    getPlaybackStatusRank(latestPlayback.status) > getPlaybackStatusRank(nextPlayback.status);
  const latestStartedNewerPlayback =
    latestPlayback !== null &&
    (nextPlayback === null || latestPlayback.requestedAt > nextPlayback.requestedAt);
  const latestHasNewerRepeatCount =
    latest.repeatedAlertCount > next.repeatedAlertCount &&
    latestPlayback !== null &&
    (nextPlayback === null || latestPlayback.requestedAt >= nextPlayback.requestedAt);

  if (
    !latestAdvancedSamePlayback &&
    !latestStartedNewerPlayback &&
    !latestHasNewerRepeatCount
  ) {
    return next;
  }

  const preserveLatestPlayback =
    latestAdvancedSamePlayback || latestStartedNewerPlayback || latestHasNewerRepeatCount;
  const preserveLatestRepeatReference =
    preserveLatestPlayback &&
    latestPlayback !== null &&
    (nextPlayback === null || latestPlayback.requestedAt >= nextPlayback.requestedAt);
  const preserveLatestDecisionReason =
    next.lastDecisionReason === "repeat-playback-pending" &&
    preserveLatestRepeatReference &&
    latest.lastRepeatedAlertAt !== null;

  return {
    ...next,
    lastRepeatedAlertAt: preserveLatestRepeatReference
      ? latest.lastRepeatedAlertAt
      : next.lastRepeatedAlertAt,
    repeatedAlertCount: Math.max(next.repeatedAlertCount, latest.repeatedAlertCount),
    lastAlertedAt:
      latest.lastAlertedAt !== null &&
      (next.lastAlertedAt === null || latest.lastAlertedAt > next.lastAlertedAt)
        ? latest.lastAlertedAt
        : next.lastAlertedAt,
    lastDecisionReason: preserveLatestDecisionReason
      ? latest.lastDecisionReason ?? next.lastDecisionReason
      : next.lastDecisionReason,
    lastAlertPlayback: preserveLatestPlayback ? latestPlayback : next.lastAlertPlayback,
  };
}

function getPlaybackStatusRank(status: RuneAlertPlaybackState["status"]): number {
  if (status === "requested") return 0;
  if (status === "started") return 1;
  return 2;
}

export function markRuneAlertPlaybackFailed(
  state: RuneRuntimeState,
  playbackCycleId: string,
  failedAt: number,
  error: string,
): RuneRuntimeState {
  const playback = state.lastAlertPlayback;
  if (!playback || playback.cycleId !== playbackCycleId) {
    return state;
  }
  const failedPlayback: RuneAlertPlaybackState = {
    ...playback,
    status: "failed",
    finishedAt: null,
    failedAt,
    error,
  };

  if (failedPlayback.decision === "repeat") {
    const belongsToActiveScene =
      state.status === "alerted" &&
      (state.alertedSceneEpoch ?? state.sceneEpoch ?? 0) === failedPlayback.sceneEpoch;
    return {
      ...state,
      lastRepeatedAlertAt: belongsToActiveScene ? failedAt : state.lastRepeatedAlertAt,
      lastAlertedAt: failedAt,
      lastDecisionReason: "playback-failed",
      lastAlertPlayback: failedPlayback,
    };
  }

  const belongsToActiveAlert =
    state.status === "alerted" &&
    state.alertedAt === failedPlayback.requestedAt &&
    (state.alertedSceneEpoch ?? state.sceneEpoch ?? 0) === failedPlayback.sceneEpoch;
  if (!belongsToActiveAlert) {
    return {
      ...state,
      lastDecisionReason: "playback-failed",
      lastAlertPlayback: failedPlayback,
    };
  }

  const recentDetection =
    state.lastDetectedAt !== null &&
    failedAt - state.lastDetectedAt <= DETECTION_GAP_GRACE_MILLISECONDS;

  return {
    ...state,
    status: recentDetection ? "candidate" : "waiting",
    stableCount: 0,
    firstDetectedAt: null,
    lastDetectedAt: recentDetection ? state.lastDetectedAt : null,
    alertedAt: null,
    alertedSceneEpoch: null,
    alertedCandidate: null,
    lastRepeatedAlertAt: null,
    repeatedAlertCount: 0,
    lastDecisionReason: "playback-failed",
    lastAlertPlayback: failedPlayback,
  };
}
