import {
  getRemoteRecognitionWarmTraceHandle,
  getRemoteRecognitionWarmTraceTargetOwner,
  type RemoteRecognitionWarmTraceFeatureClaim,
  type RemoteRecognitionWarmTraceFeaturePort,
  type RemoteRecognitionWarmTraceFeatureStage,
  type RemoteRecognitionWarmTraceTarget,
  type RemoteRecognitionWarmTraceTerminalOutcome,
} from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import {
  getSkillMatcherBundleDescriptorForSkill,
  type SkillMatcherBundleSkillId,
} from "../../../recognition/skill-precision/skillMatcherBundleRegistry";
import type {
  SkillBuffDurationDetectedIcon,
  SkillBuffDurationSampleResponse,
} from "../../../runtime/skill-precision/analysis/skillPrecisionAnalysisRuntime";
import {
  getSkillBuffDurationTargetForSkill,
  type SkillBuffDurationTarget,
  type SkillBuffDurationTargetSkillId,
} from "../../../lib/skillBuffDuration/skillBuffDurationTargets";
import type { Profile, SkillConfig, SkillRuntimeState } from "../../../types";
import type {
  SkillBuffDurationFrameResult,
  SkillFrameProcessResult,
} from "./skillFrameProcessor";

type SkillWarmTraceTarget = Extract<
  RemoteRecognitionWarmTraceTarget,
  "janus" | "hologram-graffiti-barrier" | "fountain" | "yein"
>;

type SkillWarmTraceCountdownTarget = Exclude<SkillWarmTraceTarget, "yein">;

type SkillWarmTraceTargetSpec =
  | {
      readonly target: SkillWarmTraceCountdownTarget;
      readonly targetSkillId: Exclude<
        SkillBuffDurationTargetSkillId,
        "maehwaYeinDeepV1"
      >;
      readonly matcherSkillId: Exclude<SkillMatcherBundleSkillId, "maehwaYein">;
      readonly detectorId: string;
      readonly bundleId: "skill-deep-v2";
      readonly modelVersion: string;
      readonly valueKind: "countdown";
    }
  | {
      readonly target: "yein";
      readonly targetSkillId: "maehwaYeinDeepV1";
      readonly matcherSkillId: "maehwaYein";
      readonly detectorId: "skill-maehwa-yein-deep-v1";
      readonly bundleId: "skill-maehwa-yein-deep-v1";
      readonly modelVersion: string;
      readonly valueKind: "remaining-count";
    };

type SkillWarmTraceMatcherEvidence =
  | {
      readonly kind: "countdown";
      readonly value: number;
      readonly observation: NonNullable<
        SkillBuffDurationDetectedIcon["countdown"]
      >;
      readonly detectedIcon: SkillBuffDurationDetectedIcon;
    }
  | {
      readonly kind: "remaining-count";
      readonly value: number;
      readonly observation: NonNullable<
        SkillBuffDurationDetectedIcon["remainingCount"]
      >;
      readonly detectedIcon: SkillBuffDurationDetectedIcon;
    };

export type SkillWarmTraceClaim = {
  readonly target: SkillWarmTraceTarget;
  readonly spec: SkillWarmTraceTargetSpec;
  readonly claim: RemoteRecognitionWarmTraceFeatureClaim;
  readonly featurePort: RemoteRecognitionWarmTraceFeaturePort;
  readonly profileIdentity: Profile;
  readonly ownerSkill: SkillConfig;
  readonly ownerSkillId: string;
  readonly precisionParserRuntimeKey: string | undefined;
  readonly gameViewportRevision: number;
  phase: "matcher" | "temporal" | "schedule" | "playback" | "terminal";
  matcherEvidence: SkillWarmTraceMatcherEvidence | null;
};

const skillDeepDescriptor = getSkillMatcherBundleDescriptorForSkill("janus");
const yeinDescriptor = getSkillMatcherBundleDescriptorForSkill("maehwaYein");

const SKILL_WARM_TRACE_TARGET_SPECS = Object.freeze({
  janus: {
    target: "janus",
    targetSkillId: "janusDeepV2",
    matcherSkillId: "janus",
    detectorId: "skill-deep-v2:janus",
    bundleId: "skill-deep-v2",
    modelVersion: skillDeepDescriptor.expectedModelVersion,
    valueKind: "countdown",
  },
  "hologram-graffiti-barrier": {
    target: "hologram-graffiti-barrier",
    targetSkillId: "hologramGraffitiBarrierVi",
    matcherSkillId: "barrier",
    detectorId: "hologramGraffitiBarrierVi",
    bundleId: "skill-deep-v2",
    modelVersion: skillDeepDescriptor.expectedModelVersion,
    valueKind: "countdown",
  },
  fountain: {
    target: "fountain",
    targetSkillId: "fountainDeepV2",
    matcherSkillId: "fountain",
    detectorId: "skill-deep-v2:fountain",
    bundleId: "skill-deep-v2",
    modelVersion: skillDeepDescriptor.expectedModelVersion,
    valueKind: "countdown",
  },
  yein: {
    target: "yein",
    targetSkillId: "maehwaYeinDeepV1",
    matcherSkillId: "maehwaYein",
    detectorId: "skill-maehwa-yein-deep-v1",
    bundleId: "skill-maehwa-yein-deep-v1",
    modelVersion: yeinDescriptor.expectedModelVersion,
    valueKind: "remaining-count",
  },
} satisfies Record<SkillWarmTraceTarget, SkillWarmTraceTargetSpec>);

export function claimSkillWarmTrace({
  carrier,
  activeTargets,
  profile,
  featurePort,
  precisionParserRuntimeKey,
  gameViewportRevision,
}: {
  carrier: unknown;
  activeTargets: readonly SkillBuffDurationTarget[];
  profile: Profile;
  featurePort?: RemoteRecognitionWarmTraceFeaturePort;
  precisionParserRuntimeKey?: string;
  gameViewportRevision: number;
}): SkillWarmTraceClaim | null {
  if (!featurePort) {
    return null;
  }
  const handle = getRemoteRecognitionWarmTraceHandle(carrier);
  if (!handle) {
    return null;
  }

  let claimed: RemoteRecognitionWarmTraceFeatureClaim | null = null;
  try {
    const series = featurePort.getSeries(handle);
    if (
      !series ||
      getRemoteRecognitionWarmTraceTargetOwner(series.target) !== "skill"
    ) {
      return null;
    }
    claimed = featurePort.claimFeatureOwner(handle, "skill");
    if (!claimed) {
      return null;
    }
    const spec = getSkillWarmTraceTargetSpec(series.target);
    const owner = spec
      ? getCanonicalSkillWarmTraceOwner({ activeTargets, profile, spec })
      : null;
    if (!spec || !owner) {
      safelyTerminateFeatureStage(
        featurePort,
        claimed,
        "matcherOcrUs",
        "suppressed",
      );
      return null;
    }
    return {
      target: spec.target,
      spec,
      claim: claimed,
      featurePort,
      profileIdentity: profile,
      ownerSkill: owner,
      ownerSkillId: owner.id,
      precisionParserRuntimeKey,
      gameViewportRevision,
      phase: "matcher",
      matcherEvidence: null,
    };
  } catch {
    if (claimed) {
      safelyTerminateFeatureCurrentStageByParts(featurePort, claimed, "failed");
    }
    return null;
  }
}

export function completeSkillWarmTraceMatcher({
  warmTrace,
  response,
  sampledAt,
}: {
  warmTrace: SkillWarmTraceClaim | null;
  response: SkillBuffDurationSampleResponse;
  sampledAt: number;
}): boolean {
  if (!warmTrace || warmTrace.phase !== "matcher") {
    return false;
  }
  const evidence = getCanonicalSkillWarmTraceMatcherEvidence({
    response,
    sampledAt,
    spec: warmTrace.spec,
  });
  if (!evidence) {
    terminateSkillWarmTraceCurrentStage(warmTrace, "suppressed");
    return false;
  }

  try {
    if (
      warmTrace.featurePort.completeFeatureStage(
        warmTrace.claim,
        "matcherOcrUs",
      )
    ) {
      warmTrace.matcherEvidence = evidence;
      warmTrace.phase = "temporal";
      return true;
    }
  } catch {
    // Instrumentation is deliberately observational.
  }
  failSkillWarmTraceCompletion(warmTrace);
  return false;
}

export function completeSkillWarmTraceTemporal({
  warmTrace,
  frame,
  stateBefore,
  processed,
  sampledAt,
  skill,
}: {
  warmTrace: SkillWarmTraceClaim | null;
  frame: SkillBuffDurationFrameResult | null;
  stateBefore: SkillRuntimeState;
  processed: SkillFrameProcessResult;
  sampledAt: number;
  skill: SkillConfig;
}): boolean {
  if (
    !warmTrace ||
    warmTrace.phase !== "temporal" ||
    !warmTrace.matcherEvidence
  ) {
    return false;
  }
  if (
    !isCanonicalSkillWarmTraceTemporalTransition({
      warmTrace,
      frame,
      stateBefore,
      processed,
      sampledAt,
      skill,
    })
  ) {
    terminateSkillWarmTraceCurrentStage(warmTrace, "suppressed");
    return false;
  }

  try {
    if (
      warmTrace.featurePort.completeFeatureStage(
        warmTrace.claim,
        "temporalDecisionUs",
      )
    ) {
      warmTrace.phase = "schedule";
      return true;
    }
  } catch {
    // Instrumentation is deliberately observational.
  }
  failSkillWarmTraceCompletion(warmTrace);
  return false;
}

export function completeSkillWarmTraceSchedule(
  warmTrace: SkillWarmTraceClaim | null,
): boolean {
  if (!warmTrace || warmTrace.phase !== "schedule") {
    return false;
  }
  try {
    if (
      warmTrace.featurePort.completeFeatureStage(warmTrace.claim, "scheduleUs")
    ) {
      warmTrace.phase = "playback";
      return true;
    }
  } catch {
    // Instrumentation is deliberately observational.
  }
  failSkillWarmTraceCompletion(warmTrace);
  return false;
}

export function completeSkillWarmTracePlayback(
  warmTrace: SkillWarmTraceClaim | null,
): boolean {
  if (!warmTrace || warmTrace.phase !== "playback") {
    return false;
  }
  warmTrace.phase = "terminal";
  try {
    if (warmTrace.featurePort.completeFeature(warmTrace.claim)) {
      return true;
    }
  } catch {
    // Instrumentation is deliberately observational.
  }
  safelyTerminateFeatureCurrentStageByParts(
    warmTrace.featurePort,
    warmTrace.claim,
    "failed",
  );
  return false;
}

export function terminateSkillWarmTraceStage(
  warmTrace: SkillWarmTraceClaim | null,
  stage: RemoteRecognitionWarmTraceFeatureStage,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): boolean {
  if (!warmTrace || warmTrace.phase === "terminal") {
    return false;
  }
  warmTrace.phase = "terminal";
  let terminated = false;
  try {
    terminated = warmTrace.featurePort.terminateFeatureStage(
      warmTrace.claim,
      stage,
      outcome,
    );
  } catch {
    // Fall through to the current-stage cleanup below.
  }
  if (!terminated) {
    safelyTerminateFeatureCurrentStageByParts(
      warmTrace.featurePort,
      warmTrace.claim,
      "failed",
    );
  }
  return terminated;
}

export function terminateSkillWarmTraceCurrentStage(
  warmTrace: SkillWarmTraceClaim | null,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): boolean {
  if (!warmTrace || warmTrace.phase === "terminal") {
    return false;
  }
  warmTrace.phase = "terminal";
  return safelyTerminateFeatureCurrentStageByParts(
    warmTrace.featurePort,
    warmTrace.claim,
    outcome,
  );
}

export function isSkillWarmTraceLifecycleCurrent(
  warmTrace: SkillWarmTraceClaim | null,
  {
    profile,
    precisionParserRuntimeKey,
    gameViewportRevision,
  }: {
    profile: Profile;
    precisionParserRuntimeKey?: string;
    gameViewportRevision: number;
  },
): boolean {
  if (
    !warmTrace ||
    warmTrace.phase === "terminal" ||
    profile !== warmTrace.profileIdentity ||
    precisionParserRuntimeKey !== warmTrace.precisionParserRuntimeKey ||
    gameViewportRevision !== warmTrace.gameViewportRevision
  ) {
    return false;
  }
  const enabledSkills = profile.skills.filter((skill) => skill.enabled);
  return (
    enabledSkills.length === 1 &&
    enabledSkills[0] === warmTrace.ownerSkill &&
    enabledSkills[0]?.id === warmTrace.ownerSkillId &&
    isCanonicalSkillWarmTraceConfig(
      profile,
      enabledSkills[0],
      warmTrace.spec,
    ) &&
    doesCatalogTargetMatchSpec(
      getSkillBuffDurationTargetForSkill(enabledSkills[0]),
      warmTrace.spec,
    )
  );
}

function getSkillWarmTraceTargetSpec(
  target: RemoteRecognitionWarmTraceTarget,
): SkillWarmTraceTargetSpec | null {
  return target in SKILL_WARM_TRACE_TARGET_SPECS
    ? SKILL_WARM_TRACE_TARGET_SPECS[target as SkillWarmTraceTarget]
    : null;
}

function getCanonicalSkillWarmTraceOwner({
  activeTargets,
  profile,
  spec,
}: {
  activeTargets: readonly SkillBuffDurationTarget[];
  profile: Profile;
  spec: SkillWarmTraceTargetSpec;
}): SkillConfig | null {
  const enabledSkills = profile.skills.filter((skill) => skill.enabled);
  if (
    enabledSkills.length !== 1 ||
    activeTargets.length !== 1 ||
    !doesCatalogTargetMatchSpec(activeTargets[0] ?? null, spec)
  ) {
    return null;
  }
  const owner = enabledSkills[0];
  return owner &&
    isCanonicalSkillWarmTraceConfig(profile, owner, spec) &&
    doesCatalogTargetMatchSpec(getSkillBuffDurationTargetForSkill(owner), spec)
    ? owner
    : null;
}

function isCanonicalSkillWarmTraceConfig(
  profile: Profile,
  skill: SkillConfig,
  spec: SkillWarmTraceTargetSpec,
): boolean {
  return (
    profile.skillAlertInitialJitterEnabled !== true &&
    skill.repeatAlertEnabled === false &&
    skill.alertThresholdSeconds ===
      (spec.valueKind === "remaining-count" ? 3 : 5)
  );
}

function doesCatalogTargetMatchSpec(
  target: SkillBuffDurationTarget | null | undefined,
  spec: SkillWarmTraceTargetSpec,
): boolean {
  return Boolean(
    target &&
    target.skillId === spec.targetSkillId &&
    target.matcherEngine === "skill-bundle-v1" &&
    target.matcherSkillId === spec.matcherSkillId &&
    target.detectorId === spec.detectorId &&
    (target.valueKind ?? "countdown") === spec.valueKind,
  );
}

function getCanonicalSkillWarmTraceMatcherEvidence({
  response,
  sampledAt,
  spec,
}: {
  response: SkillBuffDurationSampleResponse;
  sampledAt: number;
  spec: SkillWarmTraceTargetSpec;
}): SkillWarmTraceMatcherEvidence | null {
  const detections = response.detectionsBySkillId;
  if (
    response.sampledAt !== sampledAt ||
    response.unsupported !== false ||
    response.unsupportedReason !== null ||
    response.parserEngine !== "dl" ||
    response.parserFallbackReason !== null ||
    response.detectedCount !== 1 ||
    !response.detectedIcon ||
    !detections ||
    !hasExactOwnKeys(detections, [spec.targetSkillId])
  ) {
    return null;
  }
  const targetDetection = detections[spec.targetSkillId];
  if (
    !targetDetection ||
    targetDetection.skillId !== spec.targetSkillId ||
    targetDetection.detectedCount !== 1 ||
    !targetDetection.detectedIcon ||
    response.detectedIcon !== targetDetection.detectedIcon
  ) {
    return null;
  }
  const acceptedTargetCandidates = targetDetection.candidateIcons.filter(
    (candidate) =>
      candidate.match.matched && candidate.match.skillId === spec.targetSkillId,
  );
  const acceptedTopLevelCandidates = response.candidateIcons.filter(
    (candidate) => candidate.match.matched,
  );
  if (
    acceptedTargetCandidates.length !== 1 ||
    acceptedTargetCandidates[0] !== targetDetection.detectedIcon ||
    acceptedTopLevelCandidates.length !== 1 ||
    acceptedTopLevelCandidates[0] !== response.detectedIcon ||
    !isCanonicalAcceptedSkillMatch(targetDetection.detectedIcon, spec)
  ) {
    return null;
  }

  const detectedIcon = targetDetection.detectedIcon;
  if (spec.valueKind === "countdown") {
    const countdown = detectedIcon.countdown;
    const target = getCatalogTargetBySkillId(spec.targetSkillId);
    if (
      !countdown ||
      countdown.kind !== "exact" ||
      !isFiniteNonnegative(countdown.totalSeconds) ||
      !Number.isInteger(countdown.totalSeconds) ||
      countdown.text !== String(countdown.totalSeconds) ||
      countdown.format !== "seconds" ||
      countdown.textRegion !== "center" ||
      (countdown.status !== "medium" && countdown.status !== "high") ||
      !isFiniteNonnegative(countdown.confidence) ||
      detectedIcon.remainingCount != null ||
      response.performance.countdownCount !== 1 ||
      response.performance.remainingCountCount !== 0 ||
      response.performance.countdownModelStatus !== "ready" ||
      (target?.maxTrustedCountdownSecondsExclusive !== undefined &&
        countdown.totalSeconds >= target.maxTrustedCountdownSecondsExclusive)
    ) {
      return null;
    }
    return {
      kind: "countdown",
      value: countdown.totalSeconds,
      observation: countdown,
      detectedIcon,
    };
  }

  const remainingCount = detectedIcon.remainingCount;
  if (
    !remainingCount ||
    remainingCount.kind !== "exact" ||
    !isFiniteNonnegative(remainingCount.count) ||
    !Number.isInteger(remainingCount.count) ||
    remainingCount.count < 1 ||
    remainingCount.count > 28 ||
    remainingCount.expectedCount !== remainingCount.count ||
    remainingCount.text !== String(remainingCount.count) ||
    remainingCount.format !== "remaining-count" ||
    remainingCount.textRegion !== "bottom-right" ||
    !isFiniteNonnegative(remainingCount.confidence) ||
    remainingCount.confidence < 0.62 ||
    (remainingCount.status !== "medium" && remainingCount.status !== "high") ||
    detectedIcon.countdown != null ||
    response.performance.remainingCountCount !== 1 ||
    response.performance.countdownCount !== 0 ||
    response.performance.remainingCountModelStatus !== "ready"
  ) {
    return null;
  }
  return {
    kind: "remaining-count",
    value: remainingCount.count,
    observation: remainingCount,
    detectedIcon,
  };
}

function isCanonicalAcceptedSkillMatch(
  detectedIcon: SkillBuffDurationDetectedIcon,
  spec: SkillWarmTraceTargetSpec,
): boolean {
  const match = detectedIcon.match;
  return (
    match.matched === true &&
    match.skillId === spec.targetSkillId &&
    match.detectorId === spec.detectorId &&
    match.matcherEngine === "skill-bundle-v1" &&
    match.bundleId === spec.bundleId &&
    match.modelVersion === spec.modelVersion &&
    match.baseSkillId === spec.matcherSkillId &&
    match.rawSkillId === spec.matcherSkillId &&
    match.decisionReason === "target_accepted" &&
    Number.isFinite(match.score) &&
    Number.isFinite(match.threshold) &&
    Number.isFinite(match.margin) &&
    match.score >= match.threshold &&
    match.margin >= 0 &&
    isRoundedDifference(match.margin, match.score, match.threshold) &&
    isFiniteNonnegative(match.gateScore) &&
    isFiniteNonnegative(match.gateThreshold) &&
    isFiniteNonnegative(match.gateMargin) &&
    match.gateScore >= match.gateThreshold &&
    isRoundedDifference(
      match.gateMargin,
      match.gateScore,
      match.gateThreshold,
    )
  );
}

function isCanonicalSkillWarmTraceTemporalTransition({
  warmTrace,
  frame,
  stateBefore,
  processed,
  sampledAt,
  skill,
}: {
  warmTrace: SkillWarmTraceClaim;
  frame: SkillBuffDurationFrameResult | null;
  stateBefore: SkillRuntimeState;
  processed: SkillFrameProcessResult;
  sampledAt: number;
  skill: SkillConfig;
}): boolean {
  const evidence = warmTrace.matcherEvidence;
  const stateAfter = processed.state;
  if (
    !evidence ||
    skill !== warmTrace.ownerSkill ||
    skill.id !== warmTrace.ownerSkillId ||
    !skill.enabled ||
    !isCanonicalSkillWarmTraceConfig(
      warmTrace.profileIdentity,
      skill,
      warmTrace.spec,
    ) ||
    !doesCatalogTargetMatchSpec(
      getSkillBuffDurationTargetForSkill(skill),
      warmTrace.spec,
    ) ||
    !frame ||
    frame.parserFailure != null ||
    frame.snapshot.targetSkillId !== warmTrace.spec.targetSkillId ||
    frame.snapshot.error !== null ||
    frame.snapshot.detected !== true ||
    frame.snapshot.detectedCount !== 1 ||
    frame.snapshot.decisionReason !== "target_accepted" ||
    !isCanonicalProjectedSkillMatch(frame, evidence) ||
    processed.skillId !== skill.id ||
    processed.snapshot.sampledAt !== sampledAt ||
    processed.snapshot.buffDuration?.targetSkillId !==
      warmTrace.spec.targetSkillId ||
    processed.alertDecision !== "initial" ||
    processed.alertCycleStartedAt !== sampledAt ||
    processed.traceSample.alertDecision !== "initial" ||
    processed.traceSample.shouldFireAlert !== true ||
    processed.traceSample.shouldRepeatAlert !== false ||
    stateAfter === stateBefore ||
    stateBefore.alertedAt !== null ||
    stateAfter.status !== "alerted" ||
    stateAfter.alertedAt !== sampledAt ||
    stateAfter.rejectedReading !== null
  ) {
    return false;
  }

  return evidence.kind === "countdown"
    ? isCanonicalCountdownTransition({
        evidence,
        frame,
        stateBefore,
        stateAfter,
        processed,
        sampledAt,
        skill,
      })
    : isCanonicalRemainingCountTransition({
        evidence,
        frame,
        stateBefore,
        stateAfter,
        processed,
        sampledAt,
        skill,
      });
}

function isCanonicalCountdownTransition({
  evidence,
  frame,
  stateBefore,
  stateAfter,
  processed,
  sampledAt,
  skill,
}: {
  evidence: Extract<SkillWarmTraceMatcherEvidence, { kind: "countdown" }>;
  frame: SkillBuffDurationFrameResult;
  stateBefore: SkillRuntimeState;
  stateAfter: SkillRuntimeState;
  processed: SkillFrameProcessResult;
  sampledAt: number;
  skill: SkillConfig;
}): boolean {
  const pending = stateBefore.pendingShortAnchor;
  if (
    !pending ||
    pending.count !== 5 ||
    stateBefore.estimatedExpiresAt !== null ||
    stateBefore.buffDurationCountdownMissingSinceAt !== null ||
    sampledAt <= pending.observedAt ||
    sampledAt - pending.observedAt > 15_000
  ) {
    return false;
  }
  const candidateExpiresAt = sampledAt + evidence.value * 1_000;
  const expectedExpiresAt = Math.round(
    (pending.estimatedExpiresAt * pending.count + candidateExpiresAt) /
      (pending.count + 1),
  );
  return (
    Math.abs(candidateExpiresAt - pending.estimatedExpiresAt) <= 3_000 &&
    evidence.value <= skill.alertThresholdSeconds &&
    frame.snapshot.countdown?.kind === "exact" &&
    frame.snapshot.countdown.totalSeconds === evidence.value &&
    frame.snapshot.remainingCount == null &&
    processed.snapshot.result.value === evidence.value &&
    processed.traceSample.ocrValue === evidence.value &&
    processed.traceSample.reason === "buff-duration-countdown-detected" &&
    processed.traceSample.observedRemainingSeconds === evidence.value &&
    processed.traceSample.estimatedExpiresAt === expectedExpiresAt &&
    processed.traceSample.pendingShortAnchorCount === null &&
    stateAfter.observedRemainingSeconds === evidence.value &&
    stateAfter.observedAt === sampledAt &&
    stateAfter.estimatedExpiresAt === expectedExpiresAt &&
    stateAfter.pendingShortAnchor === null &&
    stateAfter.buffDurationCountdownMissingSinceAt === null
  );
}

function isCanonicalProjectedSkillMatch(
  frame: SkillBuffDurationFrameResult,
  evidence: SkillWarmTraceMatcherEvidence,
): boolean {
  const projected = frame.snapshot;
  const raw = evidence.detectedIcon.match;
  return (
    projected.matcherEngine === raw.matcherEngine &&
    projected.bundleId === raw.bundleId &&
    projected.modelVersion === raw.modelVersion &&
    projected.baseSkillId === raw.baseSkillId &&
    projected.rawSkillId === raw.rawSkillId &&
    projected.score === raw.score &&
    projected.threshold === raw.threshold &&
    projected.margin === raw.margin &&
    projected.gateScore === raw.gateScore &&
    projected.gateThreshold === raw.gateThreshold &&
    projected.gateMargin === raw.gateMargin
  );
}

function isCanonicalRemainingCountTransition({
  evidence,
  frame,
  stateBefore,
  stateAfter,
  processed,
  sampledAt,
  skill,
}: {
  evidence: Extract<SkillWarmTraceMatcherEvidence, { kind: "remaining-count" }>;
  frame: SkillBuffDurationFrameResult;
  stateBefore: SkillRuntimeState;
  stateAfter: SkillRuntimeState;
  processed: SkillFrameProcessResult;
  sampledAt: number;
  skill: SkillConfig;
}): boolean {
  const pending = stateBefore.pendingRemainingCountAlert;
  const previousCount = stateBefore.observedRemainingCount;
  const previousObservedAt = stateBefore.countObservedAt;
  if (
    !pending ||
    pending.count !== 1 ||
    previousCount === null ||
    previousObservedAt === null ||
    stateBefore.pendingRemainingCountIncrease !== null ||
    stateBefore.pendingRemainingCountDrop !== null ||
    sampledAt <= pending.observedAt ||
    sampledAt - pending.observedAt > 3_000 ||
    Math.abs(evidence.value - pending.observedRemainingCount) > 1
  ) {
    return false;
  }
  const elapsedSamples = Math.max(
    1,
    Math.round(Math.max(0, sampledAt - previousObservedAt) / 1_000),
  );
  const minimumReachableCount = Math.max(0, previousCount - elapsedSamples);
  return (
    evidence.value >= minimumReachableCount &&
    evidence.value <= previousCount &&
    evidence.value <= skill.alertThresholdSeconds &&
    frame.snapshot.remainingCount?.kind === "exact" &&
    frame.snapshot.remainingCount.count === evidence.value &&
    frame.snapshot.countdown == null &&
    processed.snapshot.result.value === evidence.value &&
    processed.traceSample.ocrValue === evidence.value &&
    processed.traceSample.observedRemainingCount === evidence.value &&
    processed.traceSample.remainingCountDecision ===
      "alert-threshold-confirmed" &&
    processed.traceSample.pendingRemainingCountAlertObservations === null &&
    stateAfter.observedRemainingCount === evidence.value &&
    stateAfter.countObservedAt === sampledAt &&
    stateAfter.pendingRemainingCountAlert === null &&
    stateAfter.pendingRemainingCountIncrease === null &&
    stateAfter.pendingRemainingCountDrop === null &&
    stateAfter.observedRemainingSeconds === null &&
    stateAfter.observedAt === null &&
    stateAfter.estimatedExpiresAt === null
  );
}

function getCatalogTargetBySkillId(
  skillId: SkillBuffDurationTargetSkillId,
): SkillBuffDurationTarget | null {
  const syntheticSkill = {
    presetId: getPresetIdForTargetSkillId(skillId),
    detectionSource: "buff-duration" as const,
  };
  return getSkillBuffDurationTargetForSkill(syntheticSkill);
}

function getPresetIdForTargetSkillId(
  skillId: SkillBuffDurationTargetSkillId,
): SkillConfig["presetId"] {
  switch (skillId) {
    case "janusDeepV2":
      return "sol-janus-dawn-deep-v2";
    case "hologramGraffitiBarrierVi":
      return "hologram-graffiti-barrier-vi";
    case "fountainDeepV2":
      return "erda-fountain-deep-v2";
    case "maehwaYeinDeepV1":
      return "maehwa-yein-vi";
  }
}

function hasExactOwnKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

function isFiniteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRoundedDifference(
  value: number,
  left: number,
  right: number,
): boolean {
  return Math.abs(value - (left - right)) <= 0.000_002;
}

function failSkillWarmTraceCompletion(warmTrace: SkillWarmTraceClaim): void {
  if (warmTrace.phase === "terminal") {
    return;
  }
  warmTrace.phase = "terminal";
  safelyTerminateFeatureCurrentStageByParts(
    warmTrace.featurePort,
    warmTrace.claim,
    "failed",
  );
}

function safelyTerminateFeatureStage(
  featurePort: RemoteRecognitionWarmTraceFeaturePort,
  claim: RemoteRecognitionWarmTraceFeatureClaim,
  stage: RemoteRecognitionWarmTraceFeatureStage,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): boolean {
  let terminated = false;
  try {
    terminated = featurePort.terminateFeatureStage(claim, stage, outcome);
  } catch {
    // Fall through to the current-stage cleanup below.
  }
  if (!terminated) {
    safelyTerminateFeatureCurrentStageByParts(featurePort, claim, "failed");
  }
  return terminated;
}

function safelyTerminateFeatureCurrentStageByParts(
  featurePort: RemoteRecognitionWarmTraceFeaturePort,
  claim: RemoteRecognitionWarmTraceFeatureClaim,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
): boolean {
  try {
    return featurePort.terminateFeatureCurrentStage(claim, outcome);
  } catch {
    return false;
  }
}
