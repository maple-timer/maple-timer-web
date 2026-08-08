import {
  getRemoteRecognitionWarmTraceHandle,
  getRemoteRecognitionWarmTraceTargetOwner,
  type RemoteRecognitionWarmTraceFeatureClaim,
  type RemoteRecognitionWarmTraceFeaturePort,
  type RemoteRecognitionWarmTraceTerminalOutcome,
} from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import {
  SPECIAL_CORE_CONFIRM_WINDOW_MS,
  type SpecialCoreRuntimeState,
  type SpecialCoreSampleResponse,
} from "../../../lib/specialCore";
import type { SpecialCoreAlertConfig } from "../../../types";

export type SpecialCoreWarmTraceClaim = {
  readonly claim: RemoteRecognitionWarmTraceFeatureClaim;
  readonly featurePort: RemoteRecognitionWarmTraceFeaturePort;
  phase: "matcher" | "temporal" | "delegated" | "terminal";
};

export type SpecialCoreWarmTraceScheduleCandidate = {
  readonly activationId: number;
  readonly activationStartedAt: number;
  readonly activationConfirmedAt: number;
  readonly alertDueAt: number;
  readonly claim: RemoteRecognitionWarmTraceFeatureClaim;
  readonly featurePort: RemoteRecognitionWarmTraceFeaturePort;
  phase: "schedule" | "playback" | "terminal";
};

const scheduleCandidateByRuntime = new WeakMap<
  SpecialCoreRuntimeState,
  SpecialCoreWarmTraceScheduleCandidate
>();

export function claimSpecialCoreWarmTrace({
  carrier,
  config,
  featurePort,
}: {
  carrier: unknown;
  config: SpecialCoreAlertConfig;
  featurePort?: RemoteRecognitionWarmTraceFeaturePort;
}): SpecialCoreWarmTraceClaim | null {
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
      getRemoteRecognitionWarmTraceTargetOwner(series.target) !== "special-core"
    ) {
      return null;
    }
    const claim = featurePort.claimFeatureOwner(handle, "special-core");
    if (!claim) {
      return null;
    }
    if (!isCanonicalSpecialCoreWarmTraceConfig(config)) {
      safelyTerminateFeatureStage(
        featurePort,
        claim,
        "matcherOcrUs",
        "suppressed",
      );
      return null;
    }
    return {
      claim,
      featurePort,
      phase: "matcher",
    };
  } catch {
    return null;
  }
}

export function completeSpecialCoreWarmTraceMatcher({
  warmTrace,
  response,
  sampledAt,
}: {
  warmTrace: SpecialCoreWarmTraceClaim | null;
  response: SpecialCoreSampleResponse;
  sampledAt: number;
}): boolean {
  if (!warmTrace || warmTrace.phase !== "matcher") {
    return false;
  }
  if (!isCanonicalSpecialCoreWarmTraceResponse(response, sampledAt)) {
    safelyTerminateFeatureCurrentStage(warmTrace, "suppressed");
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
    // The product matcher response remains authoritative when tracing fails.
  }
  safelyTerminateFeatureCurrentStage(warmTrace, "failed");
  return false;
}

export function bindSpecialCoreWarmTraceActivation({
  warmTrace,
  response,
  stateBefore,
  stateAfter,
  sampledAt,
}: {
  warmTrace: SpecialCoreWarmTraceClaim | null;
  response: SpecialCoreSampleResponse;
  stateBefore: SpecialCoreRuntimeState;
  stateAfter: SpecialCoreRuntimeState;
  sampledAt: number;
}): SpecialCoreWarmTraceScheduleCandidate | null {
  if (!warmTrace || warmTrace.phase !== "temporal") {
    return null;
  }
  if (
    !isCanonicalSpecialCoreWarmTraceResponse(response, sampledAt) ||
    !isCanonicalSpecialCoreActivationTransition({
      response,
      stateBefore,
      stateAfter,
      sampledAt,
    })
  ) {
    safelyTerminateFeatureCurrentStage(warmTrace, "suppressed");
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

  const candidate: SpecialCoreWarmTraceScheduleCandidate = {
    activationId: stateAfter.activationId,
    activationStartedAt: stateAfter.activationStartedAt!,
    activationConfirmedAt: stateAfter.activationConfirmedAt!,
    alertDueAt: stateAfter.alertDueAt!,
    claim: warmTrace.claim,
    featurePort: warmTrace.featurePort,
    phase: "schedule",
  };
  const existing = scheduleCandidateByRuntime.get(stateAfter) ?? null;
  if (existing) {
    terminateSpecialCoreWarmTraceCandidate(existing, "replaced");
  }
  scheduleCandidateByRuntime.set(stateAfter, candidate);
  warmTrace.phase = "delegated";
  return candidate;
}

export function takeSpecialCoreWarmTraceActivation(
  state: SpecialCoreRuntimeState,
): SpecialCoreWarmTraceScheduleCandidate | null {
  const candidate = scheduleCandidateByRuntime.get(state) ?? null;
  scheduleCandidateByRuntime.delete(state);
  if (!candidate || candidate.phase !== "schedule") {
    return null;
  }
  if (!matchesSpecialCoreWarmTraceActivation(candidate, state)) {
    terminateSpecialCoreWarmTraceCandidate(candidate, "suppressed");
    return null;
  }
  return candidate;
}

export function terminateSpecialCoreWarmTraceForState(
  state: SpecialCoreRuntimeState,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): void {
  const candidate = scheduleCandidateByRuntime.get(state) ?? null;
  scheduleCandidateByRuntime.delete(state);
  terminateSpecialCoreWarmTraceCandidate(candidate, outcome);
}

export function completeSpecialCoreWarmTraceSchedule(
  candidate: SpecialCoreWarmTraceScheduleCandidate | null,
): boolean {
  if (!candidate || candidate.phase !== "schedule") {
    return false;
  }
  try {
    if (
      candidate.featurePort.completeFeatureStage(
        candidate.claim,
        "scheduleUs",
      )
    ) {
      candidate.phase = "playback";
      return true;
    }
  } catch {
    // The product timeout remains registered when tracing fails.
  }
  terminateSpecialCoreWarmTraceCandidate(candidate, "failed");
  return false;
}

export function completeSpecialCoreWarmTracePlayback(
  candidate: SpecialCoreWarmTraceScheduleCandidate | null,
): boolean {
  if (!candidate || candidate.phase !== "playback") {
    return false;
  }
  candidate.phase = "terminal";
  try {
    if (candidate.featurePort.completeFeature(candidate.claim)) {
      return true;
    }
  } catch {
    // Product playback acceptance remains authoritative.
  }
  safelyTerminateFeatureCurrentStageByParts(
    candidate.featurePort,
    candidate.claim,
    "failed",
  );
  return false;
}

export function terminateSpecialCoreWarmTraceClaim(
  warmTrace: SpecialCoreWarmTraceClaim | null,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): void {
  if (
    !warmTrace ||
    warmTrace.phase === "terminal" ||
    warmTrace.phase === "delegated"
  ) {
    return;
  }
  safelyTerminateFeatureCurrentStage(warmTrace, outcome);
}

export function terminateSpecialCoreWarmTraceCandidate(
  candidate: SpecialCoreWarmTraceScheduleCandidate | null,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): void {
  if (!candidate || candidate.phase === "terminal") {
    return;
  }
  candidate.phase = "terminal";
  safelyTerminateFeatureCurrentStageByParts(
    candidate.featurePort,
    candidate.claim,
    outcome,
  );
}

function isCanonicalSpecialCoreWarmTraceConfig(
  config: SpecialCoreAlertConfig,
): boolean {
  return (
    config.enabled &&
    config.cooldownSeconds === 11 &&
    config.alertLeadSeconds === 10
  );
}

function isCanonicalSpecialCoreWarmTraceResponse(
  response: SpecialCoreSampleResponse,
  sampledAt: number,
): boolean {
  if (
    response.sampledAt !== sampledAt ||
    response.detectedCount !== 1 ||
    !response.detectedIcon
  ) {
    return false;
  }
  const accepted = response.candidateIcons.filter(
    (candidate) =>
      candidate.match.matched && candidate.match.targetId === "specialCore",
  );
  if (accepted.length !== 1 || accepted[0] !== response.detectedIcon) {
    return false;
  }
  const match = response.detectedIcon.match;
  if (
    match.bundleId !== "special-core-deep-v2" ||
    match.modelId !== "special-core-deep-v2" ||
    match.gateVersion !== 2 ||
    !match.matched ||
    match.targetId !== "specialCore"
  ) {
    return false;
  }
  const primary =
    match.basePassed &&
    match.positiveGatePassed &&
    match.primaryPassed &&
    match.decisionReason === "base_and_positive_gate_passed";
  const rescue =
    !match.basePassed &&
    match.positiveGatePassed &&
    !match.primaryPassed &&
    match.rescuePassed &&
    match.decisionReason === "near_exact_positive_prototype_rescue";
  return primary !== rescue;
}

function isCanonicalSpecialCoreActivationTransition({
  response,
  stateBefore,
  stateAfter,
  sampledAt,
}: {
  response: SpecialCoreSampleResponse;
  stateBefore: SpecialCoreRuntimeState;
  stateAfter: SpecialCoreRuntimeState;
  sampledAt: number;
}): boolean {
  const firstObservedAt =
    stateBefore.pendingDetections[0]?.observedAt ?? null;
  const confirmationGapMs =
    firstObservedAt === null ? null : sampledAt - firstObservedAt;
  const firstIcon = stateBefore.pendingDetectionIcons[0] ?? null;
  const currentIcon = response.detectedIcon;
  return Boolean(
    currentIcon &&
      firstObservedAt !== null &&
      confirmationGapMs !== null &&
      confirmationGapMs > 0 &&
      confirmationGapMs <= SPECIAL_CORE_CONFIRM_WINDOW_MS &&
      stateBefore.pendingDetections.length === 1 &&
      stateBefore.pendingDetectionIcons.length === 1 &&
      firstIcon &&
      stateAfter !== stateBefore &&
      stateAfter.status === "cooldown" &&
      stateAfter.lastSampledAt === sampledAt &&
      stateAfter.detectedCount === 1 &&
      stateAfter.activationId === stateBefore.activationId + 1 &&
      stateAfter.activationStartedAt === firstObservedAt &&
      stateAfter.activationConfirmedAt === sampledAt &&
      stateAfter.activationLastSeenAt === sampledAt &&
      stateAfter.cooldownEndsAt === firstObservedAt + 11_000 &&
      stateAfter.alertDueAt === firstObservedAt + 1_000 &&
      stateAfter.alertDueAt <= sampledAt &&
      stateAfter.alertedAt === null &&
      stateAfter.pendingDetections.length === 0 &&
      stateAfter.pendingDetectionIcons.length === 0 &&
      stateAfter.lastDetectedIcon === currentIcon &&
      stateAfter.activationEvidence?.activationId === stateAfter.activationId &&
      stateAfter.activationEvidence.activationStartedAt === firstObservedAt &&
      stateAfter.activationEvidence.activationConfirmedAt === sampledAt &&
      stateAfter.activationEvidence.confirmationIcons.length === 2 &&
      stateAfter.activationEvidence.confirmationIcons[0] === firstIcon &&
      stateAfter.activationEvidence.confirmationIcons[1] === currentIcon,
  );
}

function matchesSpecialCoreWarmTraceActivation(
  candidate: SpecialCoreWarmTraceScheduleCandidate,
  state: SpecialCoreRuntimeState,
): boolean {
  return (
    state.activationId === candidate.activationId &&
    state.activationStartedAt === candidate.activationStartedAt &&
    state.activationConfirmedAt === candidate.activationConfirmedAt &&
    state.alertDueAt === candidate.alertDueAt &&
    state.alertedAt === null
  );
}

function safelyTerminateFeatureCurrentStage(
  warmTrace: SpecialCoreWarmTraceClaim,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): void {
  if (warmTrace.phase === "terminal" || warmTrace.phase === "delegated") {
    return;
  }
  warmTrace.phase = "terminal";
  safelyTerminateFeatureCurrentStageByParts(
    warmTrace.featurePort,
    warmTrace.claim,
    outcome,
  );
}

function safelyTerminateFeatureCurrentStageByParts(
  featurePort: RemoteRecognitionWarmTraceFeaturePort,
  claim: RemoteRecognitionWarmTraceFeatureClaim,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): void {
  try {
    featurePort.terminateFeatureCurrentStage(claim, outcome);
  } catch {
    // Instrumentation cleanup is deliberately fail-open.
  }
}

function safelyTerminateFeatureStage(
  featurePort: RemoteRecognitionWarmTraceFeaturePort,
  claim: RemoteRecognitionWarmTraceFeatureClaim,
  stage: "matcherOcrUs",
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): void {
  try {
    featurePort.terminateFeatureStage(claim, stage, outcome);
  } catch {
    // Instrumentation cleanup is deliberately fail-open.
  }
}
