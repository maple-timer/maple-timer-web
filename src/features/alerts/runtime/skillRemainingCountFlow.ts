import type { SkillConfig, SkillRuntimeState } from "../../../types";

const REMAINING_COUNT_SAMPLE_INTERVAL_MS = 1_000;
const REMAINING_COUNT_MAX_DROP_PER_SAMPLE = 1;
const REMAINING_COUNT_PENDING_MAX_AGE_MS = 3_000;
const REMAINING_COUNT_PENDING_MIN_OBSERVATIONS = 2;

export type SkillRemainingCountFlowReason =
  | "disabled"
  | "missing-reading"
  | "accepted-initial"
  | "accepted-steady"
  | "accepted-decrease"
  | "increase-pending"
  | "cycle-reset"
  | "implausible-drop"
  | "implausible-drop-held"
  | "implausible-drop-recovered"
  | "alert-threshold-pending"
  | "alert-threshold-confirmed";

export type SkillRemainingCountFlowEvidence = {
  reason: SkillRemainingCountFlowReason;
  rawCount: number | null;
  confirmedCount: number | null;
  expectedMinCount: number | null;
  expectedMaxCount: number | null;
  pendingDropObservations: number | null;
  pendingAlertObservations: number | null;
};

export type SkillRemainingCountFlowResult = {
  state: SkillRuntimeState;
  evidence: SkillRemainingCountFlowEvidence;
};

export function advanceSkillRemainingCountFlow({
  confidence,
  count,
  previous,
  sampledAt,
  skill,
}: {
  confidence: number;
  count: number | null;
  previous: SkillRuntimeState;
  sampledAt: number;
  skill: Pick<SkillConfig, "alertThresholdSeconds" | "enabled">;
}): SkillRemainingCountFlowResult {
  const reachableRange = getReachableCountRange(previous, sampledAt);

  if (!skill.enabled) {
    return withEvidence({
      state: {
        ...previous,
        confidence,
        status: "paused",
        pendingRemainingCountIncrease: null,
        pendingRemainingCountDrop: null,
        pendingRemainingCountAlert: null,
      },
      count,
      reachableRange,
      reason: "disabled",
    });
  }

  if (count === null) {
    const pendingRemainingCountIncrease = isFreshPending(
      previous.pendingRemainingCountIncrease,
      sampledAt,
    )
      ? previous.pendingRemainingCountIncrease
      : null;
    const pendingRemainingCountAlert = isFreshPending(
      previous.pendingRemainingCountAlert,
      sampledAt,
    )
      ? previous.pendingRemainingCountAlert
      : null;
    return withEvidence({
      state: {
        ...previous,
        confidence,
        status: previous.alertedAt
          ? "alerted"
          : previous.observedRemainingCount !== null
            ? "running"
            : "detecting",
        pendingRemainingCountIncrease,
        pendingRemainingCountAlert,
      },
      count,
      reachableRange,
      reason: "missing-reading",
    });
  }

  const activePendingIncrease = isFreshPending(
    previous.pendingRemainingCountIncrease,
    sampledAt,
  )
    ? previous.pendingRemainingCountIncrease
    : null;
  if (
    activePendingIncrease &&
    Math.abs(count - activePendingIncrease.observedRemainingCount) <= 1
  ) {
    const nextPendingIncrease = {
      observedRemainingCount: count,
      observedAt: activePendingIncrease.observedAt,
      count: activePendingIncrease.count + 1,
    };
    if (nextPendingIncrease.count < REMAINING_COUNT_PENDING_MIN_OBSERVATIONS) {
      return withEvidence({
        state: {
          ...previous,
          confidence,
          status: previous.alertedAt ? "alerted" : "running",
          rejectedReading: null,
          pendingRemainingCountIncrease: nextPendingIncrease,
          pendingRemainingCountDrop: null,
          pendingRemainingCountAlert: null,
        },
        count,
        reachableRange,
        reason: "increase-pending",
      });
    }

    return acceptCount({
      confidence,
      count,
      previous,
      sampledAt,
      skill,
      reachableRange,
      reason: "cycle-reset",
      cycleStartedAt: nextPendingIncrease.observedAt,
    });
  }

  if (
    previous.observedRemainingCount !== null &&
    count > previous.observedRemainingCount
  ) {
    const pendingRemainingCountIncrease = updatePendingIncrease({
      count,
      previous,
      sampledAt,
    });
    if (pendingRemainingCountIncrease.count < REMAINING_COUNT_PENDING_MIN_OBSERVATIONS) {
      return withEvidence({
        state: {
          ...previous,
          confidence,
          status: previous.alertedAt ? "alerted" : "running",
          rejectedReading: null,
          pendingRemainingCountIncrease,
          pendingRemainingCountDrop: null,
          pendingRemainingCountAlert: null,
        },
        count,
        reachableRange,
        reason: "increase-pending",
      });
    }

    return acceptCount({
      confidence,
      count,
      previous,
      sampledAt,
      skill,
      reachableRange,
      reason: "cycle-reset",
      cycleStartedAt: pendingRemainingCountIncrease.observedAt,
    });
  }

  if (
    previous.pendingRemainingCountDrop &&
    count === previous.pendingRemainingCountDrop.observedRemainingCount
  ) {
    return holdImplausibleDrop({
      confidence,
      count,
      previous,
      sampledAt,
      reachableRange,
      reason: "implausible-drop-held",
    });
  }

  if (reachableRange && count < reachableRange.min) {
    return holdImplausibleDrop({
      confidence,
      count,
      previous,
      sampledAt,
      reachableRange,
      reason: "implausible-drop",
    });
  }

  const acceptedReason: SkillRemainingCountFlowReason =
    previous.pendingRemainingCountDrop
      ? "implausible-drop-recovered"
      : previous.observedRemainingCount === null
        ? "accepted-initial"
        : count === previous.observedRemainingCount
          ? "accepted-steady"
          : "accepted-decrease";
  return acceptCount({
    confidence,
    count,
    previous,
    sampledAt,
    skill,
    reachableRange,
    reason: acceptedReason,
    cycleStartedAt: previous.lastAlertCycleStartedAt ?? sampledAt,
  });
}

function acceptCount({
  confidence,
  count,
  previous,
  sampledAt,
  skill,
  reachableRange,
  reason,
  cycleStartedAt,
}: {
  confidence: number;
  count: number;
  previous: SkillRuntimeState;
  sampledAt: number;
  skill: Pick<SkillConfig, "alertThresholdSeconds">;
  reachableRange: ReachableCountRange | null;
  reason: SkillRemainingCountFlowReason;
  cycleStartedAt: number;
}): SkillRemainingCountFlowResult {
  const isCycleReset = reason === "cycle-reset";
  const isAlreadyAlerted = !isCycleReset && previous.alertedAt !== null;
  const alertConfirmation = getAlertConfirmation({
    count,
    previous: isCycleReset
      ? { ...previous, pendingRemainingCountAlert: null }
      : previous,
    sampledAt,
    threshold: skill.alertThresholdSeconds,
    disabled: isAlreadyAlerted,
  });
  const evidenceReason = alertConfirmation.confirmed
    ? "alert-threshold-confirmed"
    : alertConfirmation.pending
      ? "alert-threshold-pending"
      : reason;
  const state: SkillRuntimeState = {
    ...previous,
    observedRemainingCount: count,
    countObservedAt: sampledAt,
    confidence,
    status: isCycleReset ? "running" : previous.alertedAt ? "alerted" : "running",
    alertedAt: isCycleReset ? null : previous.alertedAt,
    lastRepeatedAlertAt: isCycleReset ? null : previous.lastRepeatedAlertAt,
    repeatedAlertCount: isCycleReset ? 0 : previous.repeatedAlertCount,
    lastAlertCycleStartedAt: cycleStartedAt,
    rejectedReading: null,
    pendingRemainingCountIncrease: null,
    pendingRemainingCountDrop: null,
    pendingRemainingCountAlert: alertConfirmation.pending,
    observedRemainingSeconds: null,
    observedAt: null,
    estimatedExpiresAt: null,
    pendingShortAnchor: null,
    buffDurationCountdownMissingSinceAt: null,
    buffDurationTimingEvent: null,
  };
  return withEvidence({ state, count, reachableRange, reason: evidenceReason });
}

function holdImplausibleDrop({
  confidence,
  count,
  previous,
  sampledAt,
  reachableRange,
  reason,
}: {
  confidence: number;
  count: number;
  previous: SkillRuntimeState;
  sampledAt: number;
  reachableRange: ReachableCountRange | null;
  reason: "implausible-drop" | "implausible-drop-held";
}): SkillRemainingCountFlowResult {
  const existing = previous.pendingRemainingCountDrop;
  const pendingRemainingCountDrop =
    existing && existing.observedRemainingCount === count
      ? {
          ...existing,
          lastObservedAt: sampledAt,
          count: existing.count + 1,
        }
      : {
          observedRemainingCount: count,
          observedAt: sampledAt,
          lastObservedAt: sampledAt,
          count: 1,
          fromRemainingCount: previous.observedRemainingCount ?? count,
          minReachableCount: reachableRange?.min ?? count,
        };
  return withEvidence({
    state: {
      ...previous,
      confidence,
      status: previous.alertedAt ? "alerted" : "running",
      rejectedReading: count,
      pendingRemainingCountIncrease: null,
      pendingRemainingCountDrop,
      pendingRemainingCountAlert: null,
    },
    count,
    reachableRange,
    reason,
  });
}

function getAlertConfirmation({
  count,
  previous,
  sampledAt,
  threshold,
  disabled,
}: {
  count: number;
  previous: SkillRuntimeState;
  sampledAt: number;
  threshold: number;
  disabled: boolean;
}): {
  pending: SkillRuntimeState["pendingRemainingCountAlert"];
  confirmed: boolean;
} {
  if (disabled || count > threshold) {
    return { pending: null, confirmed: false };
  }

  const activePending = isFreshPending(previous.pendingRemainingCountAlert, sampledAt)
    ? previous.pendingRemainingCountAlert
    : null;
  if (
    activePending &&
    Math.abs(count - activePending.observedRemainingCount) <= 1
  ) {
    const nextCount = activePending.count + 1;
    if (nextCount >= REMAINING_COUNT_PENDING_MIN_OBSERVATIONS) {
      return { pending: null, confirmed: true };
    }
    return {
      pending: {
        observedRemainingCount: count,
        observedAt: activePending.observedAt,
        count: nextCount,
      },
      confirmed: false,
    };
  }

  return {
    pending: {
      observedRemainingCount: count,
      observedAt: sampledAt,
      count: 1,
    },
    confirmed: false,
  };
}

function updatePendingIncrease({
  count,
  previous,
  sampledAt,
}: {
  count: number;
  previous: SkillRuntimeState;
  sampledAt: number;
}): NonNullable<SkillRuntimeState["pendingRemainingCountIncrease"]> {
  const previousPending = isFreshPending(
    previous.pendingRemainingCountIncrease,
    sampledAt,
  )
    ? previous.pendingRemainingCountIncrease
    : null;
  if (
    previousPending &&
    Math.abs(count - previousPending.observedRemainingCount) <= 1
  ) {
    return {
      observedRemainingCount: count,
      observedAt: previousPending.observedAt,
      count: previousPending.count + 1,
    };
  }

  return {
    observedRemainingCount: count,
    observedAt: sampledAt,
    count: 1,
  };
}

type ReachableCountRange = {
  min: number;
  max: number;
};

function getReachableCountRange(
  previous: SkillRuntimeState,
  sampledAt: number,
): ReachableCountRange | null {
  if (
    previous.observedRemainingCount === null ||
    previous.countObservedAt === null
  ) {
    return null;
  }
  const elapsedSamples = Math.max(
    1,
    Math.round(
      Math.max(0, sampledAt - previous.countObservedAt) /
        REMAINING_COUNT_SAMPLE_INTERVAL_MS,
    ),
  );
  return {
    min: Math.max(
      0,
      previous.observedRemainingCount -
        elapsedSamples * REMAINING_COUNT_MAX_DROP_PER_SAMPLE,
    ),
    max: previous.observedRemainingCount,
  };
}

function isFreshPending(
  pending:
    | SkillRuntimeState["pendingRemainingCountIncrease"]
    | SkillRuntimeState["pendingRemainingCountAlert"],
  sampledAt: number,
): pending is NonNullable<typeof pending> {
  return (
    pending !== null &&
    sampledAt - pending.observedAt <= REMAINING_COUNT_PENDING_MAX_AGE_MS
  );
}

function withEvidence({
  state,
  count,
  reachableRange,
  reason,
}: {
  state: SkillRuntimeState;
  count: number | null;
  reachableRange: ReachableCountRange | null;
  reason: SkillRemainingCountFlowReason;
}): SkillRemainingCountFlowResult {
  return {
    state,
    evidence: {
      reason,
      rawCount: count,
      confirmedCount: state.observedRemainingCount,
      expectedMinCount: reachableRange?.min ?? null,
      expectedMaxCount: reachableRange?.max ?? null,
      pendingDropObservations: state.pendingRemainingCountDrop?.count ?? null,
      pendingAlertObservations: state.pendingRemainingCountAlert?.count ?? null,
    },
  };
}
