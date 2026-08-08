import { getBuffExpiryEffectiveAlertLeadSeconds } from "../../../domain/buff-expiry/alertLeadPolicy";
import {
  getBuffExpiryPrecisionGroupFromBuffId,
  getBuffExpiryPrecisionSelectedTargetGroups,
} from "../../../domain/buff-expiry/precisionTrackingPolicy";
import type {
  BuffExpiryPrecisionConfirmedTransition,
  BuffExpiryTrackedBuff,
} from "../../../domain/buff-expiry/precisionTrackingTypes";
import type { BuffExpiryTargetGroup } from "../../../contracts/recognition/buffExpiryRecognition";
import {
  REMOTE_RECOGNITION_WARM_TRACE_BUFF_WAIT_LIMITS_US,
  getRemoteRecognitionWarmTraceHandle,
  getRemoteRecognitionWarmTraceTargetOwner,
  type RemoteRecognitionWarmTraceBuffScheduleDeclaration,
  type RemoteRecognitionWarmTraceBuffScheduledWait,
  type RemoteRecognitionWarmTraceBuffSchedulerPort,
  type RemoteRecognitionWarmTraceBuffTemporalPort,
  type RemoteRecognitionWarmTraceBuffWaitAuthorization,
  type RemoteRecognitionWarmTraceBuffWaitPreparation,
  type RemoteRecognitionWarmTraceFeatureClaim,
  type RemoteRecognitionWarmTraceFeaturePort,
  type RemoteRecognitionWarmTraceTarget,
  type RemoteRecognitionWarmTraceTerminalOutcome,
} from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import type { BuffExpiryAlertConfig } from "../../../types";

type BuffExpiryWarmTraceTarget = Extract<
  RemoteRecognitionWarmTraceTarget,
  "union-wealth" | "union-luck" | "potion" | "exp-coupon"
>;

const BUFF_EXPIRY_WARM_TRACE_GROUP_BY_TARGET = Object.freeze({
  "union-wealth": "unionWealth",
  "union-luck": "unionLuck",
  potion: "potion",
  "exp-coupon": "expCoupon",
} satisfies Record<BuffExpiryWarmTraceTarget, BuffExpiryTargetGroup>);

export type BuffExpiryWarmTraceClaim = {
  readonly target: BuffExpiryWarmTraceTarget;
  readonly group: BuffExpiryTargetGroup;
  readonly claim: RemoteRecognitionWarmTraceFeatureClaim;
  readonly featurePort: RemoteRecognitionWarmTraceFeaturePort;
  readonly temporalPort: RemoteRecognitionWarmTraceBuffTemporalPort;
  readonly schedulerPort: RemoteRecognitionWarmTraceBuffSchedulerPort;
  phase: "matcher" | "temporal" | "delegated" | "terminal";
};

export type BuffExpiryWarmTraceScheduleCandidate = {
  readonly target: BuffExpiryWarmTraceTarget;
  readonly trackId: string;
  readonly sampledAtMs: number;
  readonly dueAtMs: number;
  readonly authorization: RemoteRecognitionWarmTraceBuffWaitAuthorization;
  readonly claim: RemoteRecognitionWarmTraceFeatureClaim;
  readonly featurePort: RemoteRecognitionWarmTraceFeaturePort;
  readonly schedulerPort: RemoteRecognitionWarmTraceBuffSchedulerPort;
  active: boolean;
};

export type BuffExpiryWarmTraceWaitSlot = {
  current: BuffExpiryWarmTraceScheduledContext | null;
};

export type BuffExpiryWarmTracePlaybackContext = {
  readonly trackId: string;
  readonly scheduledWait: RemoteRecognitionWarmTraceBuffScheduledWait;
  readonly schedulerPort: RemoteRecognitionWarmTraceBuffSchedulerPort;
  active: boolean;
};

type BuffExpiryWarmTracePreparationContext = {
  readonly trackId: string;
  readonly preparation: RemoteRecognitionWarmTraceBuffWaitPreparation;
  readonly claim: RemoteRecognitionWarmTraceFeatureClaim;
  readonly featurePort: RemoteRecognitionWarmTraceFeaturePort;
  readonly schedulerPort: RemoteRecognitionWarmTraceBuffSchedulerPort;
  active: boolean;
};

type BuffExpiryWarmTraceScheduledContext = {
  readonly trackId: string;
  readonly scheduledWait: RemoteRecognitionWarmTraceBuffScheduledWait;
  readonly schedulerPort: RemoteRecognitionWarmTraceBuffSchedulerPort;
  active: boolean;
};

export function claimBuffExpiryWarmTrace({
  carrier,
  config,
  featurePort,
  temporalPort,
  schedulerPort,
}: {
  carrier: unknown;
  config: BuffExpiryAlertConfig;
  featurePort?: RemoteRecognitionWarmTraceFeaturePort;
  temporalPort?: RemoteRecognitionWarmTraceBuffTemporalPort;
  schedulerPort?: RemoteRecognitionWarmTraceBuffSchedulerPort;
}): BuffExpiryWarmTraceClaim | null {
  if (!featurePort) {
    return null;
  }
  const handle = getRemoteRecognitionWarmTraceHandle(carrier);
  if (!handle) {
    return null;
  }

  try {
    const series = featurePort.getSeries(handle);
    if (
      !series ||
      getRemoteRecognitionWarmTraceTargetOwner(series.target) !== "buff-expiry"
    ) {
      return null;
    }
    const claim = featurePort.claimFeatureOwner(handle, "buff-expiry");
    if (!claim) {
      return null;
    }
    const group = getBuffExpiryWarmTraceGroup(series.target);
    if (
      !group ||
      !temporalPort ||
      !schedulerPort ||
      !isCanonicalBuffExpiryWarmTraceConfig(config, group)
    ) {
      safelyTerminateFeatureStage(
        featurePort,
        claim,
        "matcherOcrUs",
        "suppressed",
      );
      return null;
    }
    return {
      target: series.target as BuffExpiryWarmTraceTarget,
      group,
      claim,
      featurePort,
      temporalPort,
      schedulerPort,
      phase: "matcher",
    };
  } catch {
    return null;
  }
}

export function completeBuffExpiryWarmTraceMatcher(
  warmTrace: BuffExpiryWarmTraceClaim | null,
): boolean {
  if (!warmTrace || warmTrace.phase !== "matcher") {
    return false;
  }
  try {
    if (
      warmTrace.featurePort.completeFeatureStage(
        warmTrace.claim,
        "matcherOcrUs",
      )
    ) {
      warmTrace.phase = "temporal";
      return true;
    }
  } catch {
    // The product matcher result remains authoritative when instrumentation fails.
  }
  safelyTerminateFeatureCurrentStage(warmTrace, "failed");
  return false;
}

export function authorizeBuffExpiryWarmTraceWait({
  warmTrace,
  confirmedTransitions,
  tracks,
  sampledAt,
}: {
  warmTrace: BuffExpiryWarmTraceClaim | null;
  confirmedTransitions: readonly BuffExpiryPrecisionConfirmedTransition[];
  tracks: readonly BuffExpiryTrackedBuff[];
  sampledAt: number;
}): BuffExpiryWarmTraceScheduleCandidate | null {
  if (!warmTrace || warmTrace.phase !== "temporal") {
    return null;
  }
  const transition = findCanonicalBuffExpiryWarmTraceTransition({
    warmTrace,
    confirmedTransitions,
    tracks,
    sampledAt,
  });
  if (!transition) {
    safelyTerminateFeatureStage(
      warmTrace.featurePort,
      warmTrace.claim,
      "temporalDecisionUs",
      "suppressed",
    );
    warmTrace.phase = "terminal";
    return null;
  }

  try {
    if (
      !warmTrace.featurePort.completeFeatureStage(
        warmTrace.claim,
        "temporalDecisionUs",
      )
    ) {
      safelyTerminateFeatureCurrentStage(warmTrace, "failed");
      return null;
    }
  } catch {
    safelyTerminateFeatureCurrentStage(warmTrace, "failed");
    return null;
  }

  try {
    const authorization = warmTrace.temporalPort.authorizeBuffExpiryPlannedWait(
      warmTrace.claim,
      {
        target: warmTrace.target,
        trackId: transition.trackId,
        transition: "pending-to-confirmed",
        acceptedSeconds: 21,
        derivedSeconds: 21,
        sampledAtMs: sampledAt,
        detectedAtMs: sampledAt,
        expiresAtMs: transition.expiresAt,
        alertLeadSeconds: 20,
        alertedAtMs: null,
      },
    );
    if (!authorization) {
      safelyTerminateFeatureStage(
        warmTrace.featurePort,
        warmTrace.claim,
        "scheduleUs",
        "failed",
      );
      warmTrace.phase = "terminal";
      return null;
    }
    warmTrace.phase = "delegated";
    return {
      target: warmTrace.target,
      trackId: transition.trackId,
      sampledAtMs: sampledAt,
      dueAtMs: transition.expiresAt - 20_000,
      authorization,
      claim: warmTrace.claim,
      featurePort: warmTrace.featurePort,
      schedulerPort: warmTrace.schedulerPort,
      active: true,
    };
  } catch {
    safelyTerminateFeatureStage(
      warmTrace.featurePort,
      warmTrace.claim,
      "scheduleUs",
      "failed",
    );
    warmTrace.phase = "terminal";
    return null;
  }
}

export function terminateBuffExpiryWarmTraceClaim(
  warmTrace: BuffExpiryWarmTraceClaim | null,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): void {
  if (!warmTrace || warmTrace.phase === "terminal" || warmTrace.phase === "delegated") {
    return;
  }
  safelyTerminateFeatureCurrentStage(warmTrace, outcome);
}

export function terminateBuffExpiryWarmTraceCandidate(
  candidate: BuffExpiryWarmTraceScheduleCandidate | null,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): void {
  if (!candidate || !candidate.active) {
    return;
  }
  candidate.active = false;
  safelyTerminateFeatureStage(
    candidate.featurePort,
    candidate.claim,
    "scheduleUs",
    outcome,
  );
}

export function prepareBuffExpiryWarmTraceWait(
  candidate: BuffExpiryWarmTraceScheduleCandidate | null,
  declaration: RemoteRecognitionWarmTraceBuffScheduleDeclaration,
): BuffExpiryWarmTracePreparationContext | null {
  if (!candidate || !candidate.active) {
    return null;
  }
  candidate.active = false;
  try {
    const preparation = candidate.schedulerPort.prepareBuffExpiryPlannedWait(
      candidate.authorization,
      declaration,
    );
    if (preparation) {
      return {
        trackId: candidate.trackId,
        preparation,
        claim: candidate.claim,
        featurePort: candidate.featurePort,
        schedulerPort: candidate.schedulerPort,
        active: true,
      };
    }
  } catch {
    // The existing product timer is still registered by the caller.
  }
  safelyTerminateFeatureStage(
    candidate.featurePort,
    candidate.claim,
    "scheduleUs",
    "failed",
  );
  return null;
}

export function abandonBuffExpiryWarmTracePreparation(
  prepared: BuffExpiryWarmTracePreparationContext | null,
): void {
  if (!prepared || !prepared.active) {
    return;
  }
  prepared.active = false;
  safelyTerminateFeatureStage(
    prepared.featurePort,
    prepared.claim,
    "scheduleUs",
    "failed",
  );
}

export function commitBuffExpiryWarmTraceWait(
  prepared: BuffExpiryWarmTracePreparationContext | null,
): BuffExpiryWarmTraceScheduledContext | null {
  if (!prepared || !prepared.active) {
    return null;
  }
  prepared.active = false;
  try {
    const scheduledWait = prepared.schedulerPort.commitBuffExpiryPlannedWait(
      prepared.preparation,
    );
    if (scheduledWait) {
      return {
        trackId: prepared.trackId,
        scheduledWait,
        schedulerPort: prepared.schedulerPort,
        active: true,
      };
    }
  } catch {
    // The product timer remains valid even when the trace cannot be committed.
  }
  safelyTerminateFeatureStage(
    prepared.featurePort,
    prepared.claim,
    "scheduleUs",
    "failed",
  );
  return null;
}

export function resumeBuffExpiryWarmTraceWait(
  slot: BuffExpiryWarmTraceWaitSlot,
): BuffExpiryWarmTracePlaybackContext | null {
  const scheduled = slot.current;
  slot.current = null;
  if (!scheduled || !scheduled.active) {
    return null;
  }
  scheduled.active = false;
  try {
    if (scheduled.schedulerPort.resumeBuffExpiryPlannedWait(scheduled.scheduledWait)) {
      return {
        trackId: scheduled.trackId,
        scheduledWait: scheduled.scheduledWait,
        schedulerPort: scheduled.schedulerPort,
        active: true,
      };
    }
  } catch {
    // Termination below is best effort; product due checks continue.
  }
  safelyTerminateScheduledWait(
    scheduled.schedulerPort,
    scheduled.scheduledWait,
    "failed",
  );
  return null;
}

export function terminateBuffExpiryWarmTraceWaitSlot(
  slot: BuffExpiryWarmTraceWaitSlot,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): void {
  const scheduled = slot.current;
  slot.current = null;
  if (!scheduled || !scheduled.active) {
    return;
  }
  scheduled.active = false;
  safelyTerminateScheduledWait(
    scheduled.schedulerPort,
    scheduled.scheduledWait,
    outcome,
  );
}

export function completeBuffExpiryWarmTracePlayback(
  playback: BuffExpiryWarmTracePlaybackContext | null,
): void {
  if (!playback || !playback.active) {
    return;
  }
  playback.active = false;
  try {
    if (
      playback.schedulerPort.completeBuffExpiryPlannedWait(
        playback.scheduledWait,
      )
    ) {
      return;
    }
  } catch {
    // Termination below is best effort; product playback remains accepted.
  }
  safelyTerminateScheduledWait(
    playback.schedulerPort,
    playback.scheduledWait,
    "failed",
  );
}

export function terminateBuffExpiryWarmTracePlayback(
  playback: BuffExpiryWarmTracePlaybackContext | null,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): void {
  if (!playback || !playback.active) {
    return;
  }
  playback.active = false;
  safelyTerminateScheduledWait(
    playback.schedulerPort,
    playback.scheduledWait,
    outcome,
  );
}

function getBuffExpiryWarmTraceGroup(
  target: RemoteRecognitionWarmTraceTarget,
): BuffExpiryTargetGroup | null {
  return target in BUFF_EXPIRY_WARM_TRACE_GROUP_BY_TARGET
    ? BUFF_EXPIRY_WARM_TRACE_GROUP_BY_TARGET[target as BuffExpiryWarmTraceTarget]
    : null;
}

function isCanonicalBuffExpiryWarmTraceConfig(
  config: BuffExpiryAlertConfig,
  group: BuffExpiryTargetGroup,
): boolean {
  const selectedGroups = getBuffExpiryPrecisionSelectedTargetGroups(config);
  return (
    config.enabled &&
    config.alertLeadSeconds === 20 &&
    getBuffExpiryEffectiveAlertLeadSeconds(config) === 20 &&
    selectedGroups.length === 1 &&
    selectedGroups[0] === group
  );
}

function findCanonicalBuffExpiryWarmTraceTransition({
  warmTrace,
  confirmedTransitions,
  tracks,
  sampledAt,
}: {
  warmTrace: BuffExpiryWarmTraceClaim;
  confirmedTransitions: readonly BuffExpiryPrecisionConfirmedTransition[];
  tracks: readonly BuffExpiryTrackedBuff[];
  sampledAt: number;
}): BuffExpiryPrecisionConfirmedTransition | null {
  const candidates = confirmedTransitions.filter((transition) => {
    const remainingMs = transition.expiresAt - sampledAt;
    const scheduledWaitMs = remainingMs - 20_000;
    if (
      transition.transition !== "pending-to-confirmed" ||
      transition.group !== warmTrace.group ||
      transition.acceptedSeconds !== 21 ||
      transition.observedAt !== sampledAt ||
      transition.derivedSeconds !== 21 ||
      transition.detectedAt !== sampledAt ||
      !Number.isSafeInteger(transition.expiresAt) ||
      Math.round(remainingMs / 1_000) !== 21 ||
      !Number.isSafeInteger(scheduledWaitMs) ||
      scheduledWaitMs <
        REMOTE_RECOGNITION_WARM_TRACE_BUFF_WAIT_LIMITS_US.minimumScheduled /
          1_000 ||
      scheduledWaitMs >=
        REMOTE_RECOGNITION_WARM_TRACE_BUFF_WAIT_LIMITS_US.maximumScheduledExclusive /
          1_000 ||
      transition.alertedAt !== null
    ) {
      return false;
    }
    const track = tracks.find((candidate) => candidate.id === transition.trackId);
    return Boolean(
      track &&
        getBuffExpiryPrecisionGroupFromBuffId(track.buffId) ===
          warmTrace.group &&
        track.detectedSeconds === 21 &&
        track.detectedAt === sampledAt &&
        track.lastSeenAt === sampledAt &&
        track.expiresAt === transition.expiresAt &&
        track.alertedAt === null,
    );
  });
  return candidates.length === 1 ? candidates[0] ?? null : null;
}

function safelyTerminateFeatureCurrentStage(
  warmTrace: BuffExpiryWarmTraceClaim,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): void {
  if (warmTrace.phase === "terminal" || warmTrace.phase === "delegated") {
    return;
  }
  warmTrace.phase = "terminal";
  try {
    warmTrace.featurePort.terminateFeatureCurrentStage(warmTrace.claim, outcome);
  } catch {
    // Instrumentation cleanup is deliberately fail-open.
  }
}

function safelyTerminateFeatureStage(
  port: RemoteRecognitionWarmTraceFeaturePort,
  claim: RemoteRecognitionWarmTraceFeatureClaim,
  stage: "matcherOcrUs" | "temporalDecisionUs" | "scheduleUs",
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): void {
  try {
    port.terminateFeatureStage(claim, stage, outcome);
  } catch {
    // Instrumentation cleanup is deliberately fail-open.
  }
}

function safelyTerminateScheduledWait(
  port: RemoteRecognitionWarmTraceBuffSchedulerPort,
  scheduledWait: RemoteRecognitionWarmTraceBuffScheduledWait,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): void {
  try {
    port.terminateBuffExpiryPlannedWait(scheduledWait, outcome);
  } catch {
    // Instrumentation cleanup is deliberately fail-open.
  }
}
