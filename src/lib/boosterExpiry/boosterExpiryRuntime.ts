import type { BoosterExpiryAlertConfig } from "../../types";
import type {
  BoosterExpiryReadDecision,
  BoosterExpiryRuntimeState,
  BoosterExpiryWorkerResult,
} from "./boosterExpiryTypes";

const NEW_CYCLE_MIN_EXPIRES_EXTENSION_MS = 5_000;
const MIN_CYCLE_CONFIRMATION_SECONDS = 60;
const MIN_CYCLE_CONFIRMATION_OBSERVATIONS = 6;
const MIN_CYCLE_CONFIRMATION_SPAN_MS = 5_000;
const MIN_CYCLE_CONFIRMATION_DECREASE_SECONDS = 4;
const CYCLE_CONFIRMATION_EXPIRES_TOLERANCE_MS = 2_500;
const CYCLE_CONFIRMATION_MAX_EXPIRES_SPREAD_MS = 3_000;
const CYCLE_CONFIRMATION_MAX_GAP_MS = 12_000;
const CONFIRMED_SUPPORT_TOLERANCE_MS = 3_500;
const CONFIRMED_MAX_UNSUPPORTED_MS = 20_000;
const CONFIRMED_CONTRADICTION_TOLERANCE_MS = 8_000;
const CONFIRMED_CONTRADICTION_LIMIT = 2;

export type BoosterExpiryRuntimeUpdate = {
  state: BoosterExpiryRuntimeState;
  shouldAlert: boolean;
};

export function createBoosterExpiryRuntimeState(): BoosterExpiryRuntimeState {
  return {
    status: "paused",
    lastSampledAt: null,
    lastDetectedAt: null,
    lastRawDetectedAt: null,
    lastMissedAt: null,
    rawText: null,
    displayText: null,
    remainingSeconds: null,
    rawRemainingSeconds: null,
    estimatedExpiresAt: null,
    alertAt: null,
    alertedAt: null,
    lastAlertPlayback: null,
    cycleCandidateStartedAt: null,
    cycleCandidateLastSeenAt: null,
    cycleCandidateExpiresAt: null,
    cycleCandidateExpiresAtMin: null,
    cycleCandidateExpiresAtMax: null,
    cycleCandidateFirstRemainingSeconds: null,
    cycleCandidateLastRemainingSeconds: null,
    cycleCandidateObservationCount: 0,
    confirmedAt: null,
    confirmedExpiresAt: null,
    confirmedLastSupportedAt: null,
    confirmedContradictionCount: 0,
    flowSource: null,
    locked: false,
    confidence: 0,
    consecutiveRawDetections: 0,
    consecutiveMisses: 0,
    lastDecision: "disabled",
  };
}

export function updateBoosterExpiryRuntimeState({
  previous,
  result,
  config,
  now,
  hasStream,
}: {
  previous: BoosterExpiryRuntimeState;
  result: BoosterExpiryWorkerResult | null;
  config: BoosterExpiryAlertConfig;
  now: number;
  hasStream: boolean;
}): BoosterExpiryRuntimeUpdate {
  if (!config.enabled) {
    return {
      state: {
        ...createBoosterExpiryRuntimeState(),
        lastSampledAt: now,
      },
      shouldAlert: false,
    };
  }

  if (!hasStream) {
    return {
      state: {
        ...previous,
        status: "no-stream",
        lastSampledAt: now,
        lastDecision: "no-stream",
      },
      shouldAlert: false,
    };
  }

  const rawTime = result?.rawTime ?? null;
  const time = result?.time ?? null;
  const hasRawTime = rawTime?.ok === true && rawTime.seconds !== null;
  const hasTime = time?.ok === true && time.seconds !== null;
  const locked = Boolean(result?.flow.locked);
  const flowSource = result?.flow.source ?? null;
  const isResetPending = flowSource === "raw-reset-pending";
  const nextRawDetectionCount = hasRawTime ? previous.consecutiveRawDetections + 1 : 0;
  const nextMissCount = hasTime ? 0 : previous.consecutiveMisses + 1;
  const isStrongRawObservation = hasRawTime && isStrongRawTimerFlowSource(flowSource);
  const rawObservedExpiresAt =
    isStrongRawObservation && rawTime.seconds !== null ? now + rawTime.seconds * 1000 : null;
  const nextCandidate = getNextCycleCandidate(
    previous,
    rawObservedExpiresAt,
    isStrongRawObservation ? rawTime.seconds : null,
    now,
  );
  const previousConfirmedExpiresAt = previous.confirmedExpiresAt ?? previous.estimatedExpiresAt;
  const shouldAcceptConfirmedCandidate = Boolean(
    nextCandidate.confirmedExpiresAt !== null &&
      (previousConfirmedExpiresAt === null ||
        nextCandidate.confirmedExpiresAt - previousConfirmedExpiresAt >= NEW_CYCLE_MIN_EXPIRES_EXTENSION_MS),
  );
  const isConfirmedNewCycle = Boolean(
    shouldAcceptConfirmedCandidate &&
      nextCandidate.confirmedExpiresAt !== null &&
      previousConfirmedExpiresAt !== null &&
      nextCandidate.confirmedExpiresAt - previousConfirmedExpiresAt >= NEW_CYCLE_MIN_EXPIRES_EXTENSION_MS,
  );
  const confirmedAt = shouldAcceptConfirmedCandidate ? nextCandidate.confirmedAt : previous.confirmedAt;
  let confirmedExpiresAt = shouldAcceptConfirmedCandidate
    ? nextCandidate.confirmedExpiresAt
    : previous.confirmedExpiresAt;
  let confirmedLastSupportedAt = shouldAcceptConfirmedCandidate
    ? now
    : previous.confirmedLastSupportedAt;
  let confirmedContradictionCount = shouldAcceptConfirmedCandidate
    ? 0
    : previous.confirmedContradictionCount;
  let isScheduleCancelled = false;

  if (
    !shouldAcceptConfirmedCandidate &&
    confirmedExpiresAt !== null &&
    previous.alertedAt === null
  ) {
    const support = getConfirmedScheduleSupport({
      confirmedExpiresAt,
      observedExpiresAt: rawObservedExpiresAt,
      hasStrongRawObservation: isStrongRawObservation,
    });

    if (support === "supported") {
      confirmedLastSupportedAt = now;
      confirmedContradictionCount = 0;
    } else if (support === "contradicted") {
      confirmedContradictionCount += 1;
    }

    const unsupportedTooLong =
      confirmedLastSupportedAt !== null &&
      now - confirmedLastSupportedAt > CONFIRMED_MAX_UNSUPPORTED_MS;
    const contradictedTooOften = confirmedContradictionCount >= CONFIRMED_CONTRADICTION_LIMIT;
    isScheduleCancelled = unsupportedTooLong || contradictedTooOften;
    if (isScheduleCancelled) {
      confirmedExpiresAt = null;
      confirmedLastSupportedAt = null;
      confirmedContradictionCount = 0;
    }
  }

  const estimatedExpiresAt = confirmedExpiresAt;
  const alertAt =
    confirmedExpiresAt !== null ? confirmedExpiresAt - config.alertLeadSeconds * 1000 : null;
  const previousAlertedAt = isConfirmedNewCycle || isScheduleCancelled ? null : previous.alertedAt;
  const lastAlertPlayback =
    isConfirmedNewCycle || isScheduleCancelled ? null : previous.lastAlertPlayback ?? null;
  const shouldAlert = Boolean(
    confirmedExpiresAt !== null &&
      alertAt !== null &&
      previousAlertedAt === null &&
      now >= alertAt,
  );
  const alertedAt = shouldAlert ? now : previousAlertedAt;
  const decision = getBoosterExpiryDecision({
    hasTime,
    hasRawTime,
    locked,
    isResetPending,
    shouldAlert,
    isScheduleCancelled,
  });

  return {
    state: {
      status: getBoosterExpiryStatus({
        hasTime,
        hasRawTime,
        locked,
        now,
        alertedAt,
        confirmedExpiresAt,
        cycleCandidateObservationCount: nextCandidate.cycleCandidateObservationCount,
        isResetPending,
        isScheduleCancelled,
      }),
      lastSampledAt: now,
      lastDetectedAt: hasTime ? now : previous.lastDetectedAt,
      lastRawDetectedAt: hasRawTime ? now : previous.lastRawDetectedAt,
      lastMissedAt: hasTime ? previous.lastMissedAt : now,
      rawText: rawTime?.text ?? (hasRawTime ? null : previous.rawText),
      displayText: time?.text ?? (hasTime ? null : previous.displayText),
      remainingSeconds: hasTime ? time.seconds : null,
      rawRemainingSeconds: hasRawTime ? rawTime.seconds : null,
      estimatedExpiresAt,
      alertAt,
      alertedAt,
      lastAlertPlayback,
      cycleCandidateStartedAt: nextCandidate.cycleCandidateStartedAt,
      cycleCandidateLastSeenAt: nextCandidate.cycleCandidateLastSeenAt,
      cycleCandidateExpiresAt: nextCandidate.cycleCandidateExpiresAt,
      cycleCandidateExpiresAtMin: nextCandidate.cycleCandidateExpiresAtMin,
      cycleCandidateExpiresAtMax: nextCandidate.cycleCandidateExpiresAtMax,
      cycleCandidateFirstRemainingSeconds: nextCandidate.cycleCandidateFirstRemainingSeconds,
      cycleCandidateLastRemainingSeconds: nextCandidate.cycleCandidateLastRemainingSeconds,
      cycleCandidateObservationCount: nextCandidate.cycleCandidateObservationCount,
      confirmedAt: isScheduleCancelled ? null : confirmedAt,
      confirmedExpiresAt,
      confirmedLastSupportedAt,
      confirmedContradictionCount,
      flowSource,
      locked,
      confidence: confirmedExpiresAt !== null ? 1 : 0,
      consecutiveRawDetections: nextRawDetectionCount,
      consecutiveMisses: nextMissCount,
      lastDecision: decision,
    },
    shouldAlert,
  };
}

export function markBoosterExpiryRuntimeAlerted(
  previous: BoosterExpiryRuntimeState,
  alertedAt: number,
): BoosterExpiryRuntimeState {
  const confirmedExpiresAt = previous.confirmedExpiresAt ?? previous.estimatedExpiresAt;
  return {
    ...previous,
    status: getBoosterExpiryStatus({
      hasTime: previous.remainingSeconds !== null,
      hasRawTime: previous.rawRemainingSeconds !== null,
      locked: previous.locked,
      now: alertedAt,
      alertedAt,
      confirmedExpiresAt,
      cycleCandidateObservationCount: previous.cycleCandidateObservationCount,
      isResetPending: previous.flowSource === "raw-reset-pending",
      isScheduleCancelled: false,
    }),
    alertedAt,
    lastDecision: "alerted",
  };
}

function getBoosterExpiryStatus({
  hasTime,
  hasRawTime,
  locked,
  now,
  alertedAt,
  confirmedExpiresAt,
  cycleCandidateObservationCount,
  isResetPending,
  isScheduleCancelled,
}: {
  hasTime: boolean;
  hasRawTime: boolean;
  locked: boolean;
  now: number;
  alertedAt: number | null;
  confirmedExpiresAt: number | null;
  cycleCandidateObservationCount: number;
  isResetPending: boolean;
  isScheduleCancelled: boolean;
}): BoosterExpiryRuntimeState["status"] {
  if (isScheduleCancelled) {
    return "lost";
  }
  if (alertedAt !== null && confirmedExpiresAt !== null && now < confirmedExpiresAt) {
    return "alerted";
  }
  if (confirmedExpiresAt !== null && alertedAt === null) {
    return "armed";
  }
  if (alertedAt !== null && confirmedExpiresAt !== null && now >= confirmedExpiresAt) {
    return cycleCandidateObservationCount > 0 || isResetPending ? "confirming" : "waiting";
  }
  if (isResetPending || hasRawTime || hasTime || cycleCandidateObservationCount > 0) {
    return "confirming";
  }
  return "waiting";
}

function getBoosterExpiryDecision({
  hasTime,
  hasRawTime,
  locked,
  isResetPending,
  shouldAlert,
  isScheduleCancelled,
}: {
  hasTime: boolean;
  hasRawTime: boolean;
  locked: boolean;
  isResetPending: boolean;
  shouldAlert: boolean;
  isScheduleCancelled: boolean;
}): BoosterExpiryReadDecision {
  if (isScheduleCancelled) {
    return "schedule-cancelled";
  }
  if (shouldAlert) {
    return "alerted";
  }
  if (isResetPending) {
    return "flow-reset-pending";
  }
  if (locked && hasTime && !hasRawTime) {
    return "flow-predicted";
  }
  if (locked && hasTime) {
    return "raw-locked";
  }
  if (hasRawTime || hasTime) {
    return "raw-pending";
  }
  return "timer-waiting";
}

function getNextCycleCandidate(
  previous: BoosterExpiryRuntimeState,
  observedExpiresAt: number | null,
  remainingSeconds: number | null,
  now: number,
): Pick<
  BoosterExpiryRuntimeState,
  | "cycleCandidateStartedAt"
  | "cycleCandidateLastSeenAt"
  | "cycleCandidateExpiresAt"
  | "cycleCandidateExpiresAtMin"
  | "cycleCandidateExpiresAtMax"
  | "cycleCandidateFirstRemainingSeconds"
  | "cycleCandidateLastRemainingSeconds"
  | "cycleCandidateObservationCount"
  | "confirmedAt"
  | "confirmedExpiresAt"
> {
  const hasUsableObservation =
    observedExpiresAt !== null &&
    remainingSeconds !== null &&
    remainingSeconds >= MIN_CYCLE_CONFIRMATION_SECONDS;

  if (!hasUsableObservation) {
    if (
      previous.cycleCandidateLastSeenAt !== null &&
      now - previous.cycleCandidateLastSeenAt <= CYCLE_CONFIRMATION_MAX_GAP_MS
    ) {
      return {
        cycleCandidateStartedAt: previous.cycleCandidateStartedAt,
        cycleCandidateLastSeenAt: previous.cycleCandidateLastSeenAt,
        cycleCandidateExpiresAt: previous.cycleCandidateExpiresAt,
        cycleCandidateExpiresAtMin: previous.cycleCandidateExpiresAtMin,
        cycleCandidateExpiresAtMax: previous.cycleCandidateExpiresAtMax,
        cycleCandidateFirstRemainingSeconds: previous.cycleCandidateFirstRemainingSeconds,
        cycleCandidateLastRemainingSeconds: previous.cycleCandidateLastRemainingSeconds,
        cycleCandidateObservationCount: previous.cycleCandidateObservationCount,
        confirmedAt: null,
        confirmedExpiresAt: null,
      };
    }

    return {
      cycleCandidateStartedAt: null,
      cycleCandidateLastSeenAt: null,
      cycleCandidateExpiresAt: null,
      cycleCandidateExpiresAtMin: null,
      cycleCandidateExpiresAtMax: null,
      cycleCandidateFirstRemainingSeconds: null,
      cycleCandidateLastRemainingSeconds: null,
      cycleCandidateObservationCount: 0,
      confirmedAt: null,
      confirmedExpiresAt: null,
    };
  }

  const previousCandidateExpiresAt = previous.cycleCandidateExpiresAt;
  const isSameCandidate =
    previousCandidateExpiresAt !== null &&
    Math.abs(observedExpiresAt - previousCandidateExpiresAt) <= CYCLE_CONFIRMATION_EXPIRES_TOLERANCE_MS &&
    previous.cycleCandidateLastSeenAt !== null &&
    now - previous.cycleCandidateLastSeenAt <= CYCLE_CONFIRMATION_MAX_GAP_MS;

  const cycleCandidateObservationCount = isSameCandidate
    ? previous.cycleCandidateObservationCount + 1
    : 1;
  const cycleCandidateStartedAt = isSameCandidate
    ? previous.cycleCandidateStartedAt ?? now
    : now;
  const cycleCandidateExpiresAt = isSameCandidate
    ? Math.round(
        ((previousCandidateExpiresAt ?? observedExpiresAt) * previous.cycleCandidateObservationCount +
          observedExpiresAt) /
          cycleCandidateObservationCount,
      )
    : observedExpiresAt;
  const cycleCandidateExpiresAtMin = isSameCandidate
    ? Math.min(previous.cycleCandidateExpiresAtMin ?? observedExpiresAt, observedExpiresAt)
    : observedExpiresAt;
  const cycleCandidateExpiresAtMax = isSameCandidate
    ? Math.max(previous.cycleCandidateExpiresAtMax ?? observedExpiresAt, observedExpiresAt)
    : observedExpiresAt;
  const cycleCandidateFirstRemainingSeconds = isSameCandidate
    ? previous.cycleCandidateFirstRemainingSeconds ?? remainingSeconds
    : remainingSeconds;
  const cycleCandidateLastRemainingSeconds = remainingSeconds;
  const countdownDecreaseSeconds =
    cycleCandidateFirstRemainingSeconds - cycleCandidateLastRemainingSeconds;
  const expiresSpreadMs = cycleCandidateExpiresAtMax - cycleCandidateExpiresAtMin;
  const hasEnoughObservations =
    cycleCandidateObservationCount >= MIN_CYCLE_CONFIRMATION_OBSERVATIONS &&
    now - cycleCandidateStartedAt >= MIN_CYCLE_CONFIRMATION_SPAN_MS &&
    countdownDecreaseSeconds >= MIN_CYCLE_CONFIRMATION_DECREASE_SECONDS &&
    expiresSpreadMs <= CYCLE_CONFIRMATION_MAX_EXPIRES_SPREAD_MS;

  return {
    cycleCandidateStartedAt,
    cycleCandidateLastSeenAt: now,
    cycleCandidateExpiresAt,
    cycleCandidateExpiresAtMin,
    cycleCandidateExpiresAtMax,
    cycleCandidateFirstRemainingSeconds,
    cycleCandidateLastRemainingSeconds,
    cycleCandidateObservationCount,
    confirmedAt: hasEnoughObservations ? now : null,
    confirmedExpiresAt: hasEnoughObservations ? cycleCandidateExpiresAt : null,
  };
}

function isStrongRawTimerFlowSource(flowSource: string | null): boolean {
  return flowSource === "raw" || flowSource === "raw-lock" || flowSource === "raw-relock";
}

function getConfirmedScheduleSupport({
  confirmedExpiresAt,
  observedExpiresAt,
  hasStrongRawObservation,
}: {
  confirmedExpiresAt: number;
  observedExpiresAt: number | null;
  hasStrongRawObservation: boolean;
}): "supported" | "contradicted" | "none" {
  if (!hasStrongRawObservation || observedExpiresAt === null) {
    return "none";
  }

  const deltaMs = Math.abs(observedExpiresAt - confirmedExpiresAt);
  if (deltaMs <= CONFIRMED_SUPPORT_TOLERANCE_MS) {
    return "supported";
  }
  if (deltaMs >= CONFIRMED_CONTRADICTION_TOLERANCE_MS) {
    return "contradicted";
  }
  return "none";
}
