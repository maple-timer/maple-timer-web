import type { SkillConfig, SkillRuntimeState } from "../types";
import { getEstimatedRemainingSeconds } from "./timerEstimates";
import {
  SHORT_ANCHOR_DOWNWARD_TOLERANCE_SECONDS,
  SHORT_ANCHOR_REQUIRED_READINGS,
  SHORT_ANCHOR_UPWARD_TOLERANCE_SECONDS,
  isShortAnchorCandidate,
} from "./timerRules";

type AnchorResult = Pick<SkillRuntimeState, "pendingShortAnchor"> & { ready: boolean };

type AnchorConfig = Pick<
  SkillConfig,
  "alertThresholdSeconds" | "countdownSource" | "durationSeconds" | "cooldownDurationSeconds"
>;

function updateStableAnchor(previous: SkillRuntimeState, candidate: number, now: number): AnchorResult {
  const pending = previous.pendingShortAnchor;
  if (!pending) {
    return {
      pendingShortAnchor: {
        observedRemainingSeconds: candidate,
        maxObservedRemainingSeconds: candidate,
        observedAt: now,
        estimatedExpiresAt: now + candidate * 1000,
        count: 1,
      },
      ready: false,
    };
  }

  const expectedRemaining = getEstimatedRemainingSeconds(pending, now);
  const stable =
    expectedRemaining !== null &&
    candidate <= expectedRemaining + SHORT_ANCHOR_UPWARD_TOLERANCE_SECONDS &&
    candidate >= expectedRemaining - SHORT_ANCHOR_DOWNWARD_TOLERANCE_SECONDS;

  if (!stable) {
    return {
      pendingShortAnchor: {
        observedRemainingSeconds: candidate,
        maxObservedRemainingSeconds: candidate,
        observedAt: now,
        estimatedExpiresAt: now + candidate * 1000,
        count: 1,
      },
      ready: false,
    };
  }

  const nextAnchor = {
    observedRemainingSeconds: candidate,
    maxObservedRemainingSeconds: Math.max(
      pending.maxObservedRemainingSeconds ?? pending.observedRemainingSeconds,
      candidate,
    ),
    observedAt: now,
    estimatedExpiresAt: now + candidate * 1000,
    count: pending.count + 1,
  };

  return {
    pendingShortAnchor: nextAnchor,
    ready: nextAnchor.count >= SHORT_ANCHOR_REQUIRED_READINGS,
  };
}

export function updateShortAnchorCandidate(
  previous: SkillRuntimeState,
  candidate: number,
  config: AnchorConfig,
  now: number,
): AnchorResult {
  if (!isShortAnchorCandidate(candidate, config)) {
    return { pendingShortAnchor: null, ready: false };
  }

  return updateStableAnchor(previous, candidate, now);
}

export function updateStableAnchorCandidate(
  previous: SkillRuntimeState,
  candidate: number,
  now: number,
): AnchorResult {
  return updateStableAnchor(previous, candidate, now);
}
