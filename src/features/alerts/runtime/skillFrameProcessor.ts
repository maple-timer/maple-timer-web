import type { RgbaImageSnapshot, SkillSnapshot, SkillTraceSample } from "../../../alertTypes";
import type { BuffSlotEvidenceSource } from "../../../lib/buffSlotParser/buffSlotFrameCapture";
import { getSkillRegionForLayout, hasUsableRegion } from "../../../lib/regions";
import {
  getSkillBuffDurationTargetForSkill,
  isSkillBuffDurationRemainingCountTarget,
} from "../../../lib/skillBuffDuration/skillBuffDurationTargets";
import {
  applyInitialAlertDelay,
  applyRecognitionResult,
  createRuntimeState,
  getEstimatedRemainingSeconds,
  getSkillAlertInRemainingCount,
  getSkillAlertInSeconds,
  markAlerted,
  markRepeatedAlert,
  shouldFireRemainingCountAlert,
  shouldFireAlert,
  shouldRepeatAlert,
} from "../../../lib/timer";
import type { RecognitionResult, SkillConfig, SkillRuntimeState } from "../../../types";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import type { PrecisionParserRuntimeProvenance } from "../../../contracts/recognition/precisionParserRuntime";
import type { BuffSlotAnalysisPerformance } from "../../../runtime/buff-slot/analysis/buffSlotAnalysisRuntime";
import type { RuntimeParserFailureEvidence } from "../../../contracts/reporting/runtimeReportEvidence";
import { advanceSkillRemainingCountFlow } from "./skillRemainingCountFlow";
import { createRuntimeAnalysisFailureEvidence } from "./runtimeAnalysisFailure";

const EMPTY_READING: RecognitionResult = {
  value: null,
  confidence: 0,
  debug: { reason: "no-region" },
};

const BUFF_DURATION_EXPIRES_AT_TOLERANCE_MS = 3_000;
const BUFF_DURATION_PENDING_MAX_AGE_MS = 15_000;
const BUFF_DURATION_PENDING_MIN_OBSERVATIONS = 6;
const BUFF_DURATION_TRUSTED_MAX_SECONDS_EXCLUSIVE = 120;

export type SkillFrameAlertDecision = "initial" | "repeat" | null;

export type SkillFrameProcessResult = {
  skillId: string;
  state: SkillRuntimeState;
  snapshot: SkillSnapshot;
  traceSample: SkillTraceSample;
  alertDecision: SkillFrameAlertDecision;
  alertCycleStartedAt: number | null;
};

export type SkillBuffDurationFrameResult = {
  evidenceSource?: BuffSlotEvidenceSource | null;
  rawPreviewUrl: string | null;
  previewUrl: string | null;
  previewImageData?: RgbaImageSnapshot | null;
  regionLabel: string | null;
  parserRuntime?: PrecisionParserRuntimeProvenance | null;
  parserPerformance?: BuffSlotAnalysisPerformance | null;
  parserFailure?: RuntimeParserFailureEvidence | null;
  snapshot: NonNullable<SkillSnapshot["buffDuration"]>;
};

export function processSkillFrameSample({
  buffDurationFrameResult,
  frameLayoutKey,
  previousState,
  recognize,
  sampleSkill,
  sampledAt,
  skill,
  initialAlertJitterEnabled = false,
  getInitialAlertDelaySeconds,
}: {
  buffDurationFrameResult?: SkillBuffDurationFrameResult | null;
  frameLayoutKey: string | null;
  previousState: SkillRuntimeState | undefined;
  recognize: (imageData: ImageData) => RecognitionResult;
  sampleSkill: MonitoringFrameContext["sampleSkill"];
  sampledAt: number;
  skill: SkillConfig;
  initialAlertJitterEnabled?: boolean;
  getInitialAlertDelaySeconds?: () => number;
}): SkillFrameProcessResult {
  const previous = previousState ?? createRuntimeState(skill.id);
  if (isSkillBuffDurationMode(skill)) {
    return processSkillBuffDurationFrameSample({
      buffDurationFrameResult,
      getInitialAlertDelaySeconds,
      initialAlertJitterEnabled,
      previous,
      sampledAt,
      skill,
    });
  }

  let result = EMPTY_READING;
  let rawPreviewUrl: string | null = null;
  let previewUrl: string | null = null;
  let regionLabel: string | null = null;
  let runtimeFailure: SkillSnapshot["runtimeFailure"] = null;
  const region = getSkillRegionForLayout(skill, frameLayoutKey);

  if (skill.enabled && hasUsableRegion(region)) {
    let sample: ReturnType<typeof sampleSkill> | null = null;
    try {
      sample = sampleSkill(region, true);
      rawPreviewUrl = sample.rawPreviewUrl;
      previewUrl = sample.previewUrl;
      regionLabel = `${sample.region.width}x${sample.region.height}`;
    } catch (error) {
      runtimeFailure = createRuntimeAnalysisFailureEvidence({
        error,
        occurredAt: sampledAt,
        stage: "frame-capture",
      });
      result = {
        value: null,
        confidence: 0,
        debug: { reason: runtimeFailure.code },
      };
    }
    if (sample) {
      try {
        result = recognize(sample.imageData);
      } catch (error) {
        runtimeFailure = createRuntimeAnalysisFailureEvidence({
          error,
          occurredAt: sampledAt,
          stage: "recognizer",
        });
        result = {
          value: null,
          confidence: 0,
          debug: { reason: runtimeFailure.code },
        };
      }
    }
  }

  let nextState = applyInitialAlertDelay(
    applyRecognitionResult(previous, result, skill, sampledAt),
    initialAlertJitterEnabled && skill.enabled,
    getInitialAlertDelaySeconds,
  );
  const shouldPlayInitialAlert = shouldFireAlert(nextState, skill, sampledAt);
  const shouldPlayRepeatAlert =
    !shouldPlayInitialAlert && shouldRepeatAlert(nextState, skill, sampledAt);
  let alertDecision: SkillFrameAlertDecision = null;
  let alertCycleStartedAt: number | null = null;

  if (shouldPlayInitialAlert) {
    nextState = markAlerted(nextState, sampledAt);
    alertDecision = "initial";
    alertCycleStartedAt = sampledAt;
  } else if (shouldPlayRepeatAlert) {
    nextState = markRepeatedAlert(nextState, sampledAt);
    if (nextState.alertedAt !== null) {
      alertDecision = "repeat";
      alertCycleStartedAt = nextState.alertedAt;
    }
  }

  const estimatedRemainingSeconds = getEstimatedRemainingSeconds(nextState, sampledAt);
  const alertInSeconds = getSkillAlertInSeconds(nextState, skill, sampledAt);
  const traceSample: SkillTraceSample = {
    sampledAt,
    ocrValue: result.value,
    confidence: result.confidence,
    recognizedText: result.debug?.recognizedText ?? null,
    reason: result.debug?.reason ?? null,
    digitCount: result.debug?.digitCount ?? null,
    foregroundRatio: result.debug?.foregroundRatio ?? null,
    statusBefore: previous.status,
    statusAfter: nextState.status,
    observedRemainingSeconds: nextState.observedRemainingSeconds,
    estimatedRemainingSeconds,
    alertThresholdSeconds: skill.alertThresholdSeconds,
    alertInSeconds,
    estimatedExpiresAt: nextState.estimatedExpiresAt,
    rejectedReading: nextState.rejectedReading,
    pendingShortAnchorCount: nextState.pendingShortAnchor?.count ?? null,
    shouldFireAlert: shouldPlayInitialAlert,
    shouldRepeatAlert: shouldPlayRepeatAlert,
    alertDecision,
    runtimeFailure,
  };

  return {
    skillId: skill.id,
    state: nextState,
    snapshot: {
      result,
      sampledAt,
      rawPreviewUrl,
      previewUrl,
      regionLabel,
      runtimeFailure,
    },
    traceSample,
    alertDecision,
    alertCycleStartedAt,
  };
}

function isSkillBuffDurationMode(skill: SkillConfig): boolean {
  return Boolean(getSkillBuffDurationTargetForSkill(skill));
}

function processSkillBuffDurationFrameSample({
  buffDurationFrameResult,
  getInitialAlertDelaySeconds,
  initialAlertJitterEnabled = false,
  previous,
  sampledAt,
  skill,
}: {
  buffDurationFrameResult?: SkillBuffDurationFrameResult | null;
  getInitialAlertDelaySeconds?: () => number;
  initialAlertJitterEnabled?: boolean;
  previous: SkillRuntimeState;
  sampledAt: number;
  skill: SkillConfig;
}): SkillFrameProcessResult {
  const target = getSkillBuffDurationTargetForSkill(skill);
  if (isSkillBuffDurationRemainingCountTarget(target)) {
    return processSkillRemainingCountFrameSample({
      buffDurationFrameResult,
      previous,
      sampledAt,
      skill,
    });
  }

  const countdown = buffDurationFrameResult?.snapshot.countdown ?? null;
  const countdownSeconds = getSkillBuffDurationCountdownSeconds(countdown);
  const baseConfidence = buffDurationFrameResult?.snapshot.score ?? 0;
  const confidence = countdownSeconds === null
    ? baseConfidence
    : Math.min(baseConfidence, countdown?.confidence ?? baseConfidence);
  const result: RecognitionResult = {
    value: countdownSeconds,
    confidence,
    debug: {
      reason: getSkillBuffDurationReason(buffDurationFrameResult),
    },
  };
  let nextState = applyInitialAlertDelay(
    getSkillBuffDurationRuntimeState({
      countdownSeconds,
      confidence,
      previous,
      sampledAt,
      skill,
    }),
    initialAlertJitterEnabled && skill.enabled,
    getInitialAlertDelaySeconds,
  );
  const isCountdownMissing = nextState.buffDurationCountdownMissingSinceAt !== null;
  const canAlertWhileCountdownMissing = canAlertWithMissingBuffDurationCountdown(nextState);
  const shouldPlayInitialAlert =
    (!isCountdownMissing || canAlertWhileCountdownMissing) &&
    shouldFireAlert(nextState, skill, sampledAt);
  const shouldPlayRepeatAlert =
    !shouldPlayInitialAlert && shouldRepeatAlert(nextState, skill, sampledAt);
  let alertDecision: SkillFrameAlertDecision = null;
  let alertCycleStartedAt: number | null = null;

  if (shouldPlayInitialAlert) {
    nextState = markAlerted(nextState, sampledAt);
    alertDecision = "initial";
    alertCycleStartedAt = sampledAt;
  } else if (shouldPlayRepeatAlert) {
    nextState = markRepeatedAlert(nextState, sampledAt);
    if (nextState.alertedAt !== null) {
      alertDecision = "repeat";
      alertCycleStartedAt = nextState.alertedAt;
    }
  }

  const estimatedRemainingSeconds = getEstimatedRemainingSeconds(nextState, sampledAt);
  const alertInSeconds = getSkillAlertInSeconds(nextState, skill, sampledAt);
  const traceSample: SkillTraceSample = {
    sampledAt,
    ocrValue: countdownSeconds,
    confidence,
    recognizedText: countdown?.text ?? null,
    reason: result.debug?.reason ?? null,
    digitCount: countdown?.text?.replace(/\D/g, "").length ?? null,
    foregroundRatio: null,
    statusBefore: previous.status,
    statusAfter: nextState.status,
    observedRemainingSeconds: nextState.observedRemainingSeconds,
    estimatedRemainingSeconds,
    alertThresholdSeconds: skill.alertThresholdSeconds,
    alertInSeconds,
    estimatedExpiresAt: nextState.estimatedExpiresAt,
    rejectedReading: nextState.rejectedReading,
    pendingShortAnchorCount: nextState.pendingShortAnchor?.count ?? null,
    shouldFireAlert: shouldPlayInitialAlert,
    shouldRepeatAlert: shouldPlayRepeatAlert,
    alertDecision,
  };

  return {
    skillId: skill.id,
    state: nextState,
    snapshot: {
      result,
      sampledAt,
      rawPreviewUrl: buffDurationFrameResult?.rawPreviewUrl ?? null,
      previewUrl: buffDurationFrameResult?.previewUrl ?? null,
      previewImageData: buffDurationFrameResult?.previewImageData ?? null,
      regionLabel: buffDurationFrameResult?.regionLabel ?? null,
      buffDuration: buffDurationFrameResult?.snapshot ?? null,
    },
    traceSample,
    alertDecision,
    alertCycleStartedAt,
  };
}

function processSkillRemainingCountFrameSample({
  buffDurationFrameResult,
  previous,
  sampledAt,
  skill,
}: {
  buffDurationFrameResult?: SkillBuffDurationFrameResult | null;
  previous: SkillRuntimeState;
  sampledAt: number;
  skill: SkillConfig;
}): SkillFrameProcessResult {
  const remainingCount = buffDurationFrameResult?.snapshot.remainingCount ?? null;
  const count = getSkillBuffDurationRemainingCount(remainingCount);
  const baseConfidence = buffDurationFrameResult?.snapshot.score ?? 0;
  const confidence = count === null
    ? baseConfidence
    : Math.min(baseConfidence, remainingCount?.confidence ?? baseConfidence);
  const result: RecognitionResult = {
    value: count,
    confidence,
    debug: {
      reason: getSkillRemainingCountReason(buffDurationFrameResult),
    },
  };
  const remainingCountFlow = advanceSkillRemainingCountFlow({
    confidence,
    count,
    previous,
    sampledAt,
    skill,
  });
  let nextState = remainingCountFlow.state;
  const shouldPlayInitialAlert = shouldFireRemainingCountAlert(nextState, skill);
  const shouldPlayRepeatAlert =
    !shouldPlayInitialAlert && shouldRepeatAlert(nextState, skill, sampledAt);
  let alertDecision: SkillFrameAlertDecision = null;
  let alertCycleStartedAt: number | null = null;

  if (shouldPlayInitialAlert) {
    nextState = markAlerted(nextState, sampledAt);
    alertDecision = "initial";
    alertCycleStartedAt = sampledAt;
  } else if (shouldPlayRepeatAlert) {
    nextState = markRepeatedAlert(nextState, sampledAt);
    if (nextState.alertedAt !== null) {
      alertDecision = "repeat";
      alertCycleStartedAt = nextState.alertedAt;
    }
  }

  const alertInCount = getSkillAlertInRemainingCount(nextState, skill);
  const traceSample: SkillTraceSample = {
    sampledAt,
    ocrValue: count,
    confidence,
    recognizedText: remainingCount?.text ?? null,
    reason: result.debug?.reason ?? null,
    digitCount: remainingCount?.text?.replace(/\D/g, "").length ?? null,
    foregroundRatio: null,
    statusBefore: previous.status,
    statusAfter: nextState.status,
    observedRemainingSeconds: null,
    observedRemainingCount: nextState.observedRemainingCount,
    estimatedRemainingSeconds: null,
    alertThresholdSeconds: skill.alertThresholdSeconds,
    alertInSeconds: null,
    alertInCount,
    estimatedExpiresAt: null,
    rejectedReading: nextState.rejectedReading,
    pendingShortAnchorCount: nextState.pendingRemainingCountIncrease?.count ?? null,
    remainingCountDecision: remainingCountFlow.evidence.reason,
    remainingCountExpectedMin: remainingCountFlow.evidence.expectedMinCount,
    remainingCountExpectedMax: remainingCountFlow.evidence.expectedMaxCount,
    pendingRemainingCountDropObservations:
      remainingCountFlow.evidence.pendingDropObservations,
    pendingRemainingCountAlertObservations:
      remainingCountFlow.evidence.pendingAlertObservations,
    shouldFireAlert: shouldPlayInitialAlert,
    shouldRepeatAlert: shouldPlayRepeatAlert,
    alertDecision,
  };

  return {
    skillId: skill.id,
    state: nextState,
    snapshot: {
      result,
      sampledAt,
      rawPreviewUrl: buffDurationFrameResult?.rawPreviewUrl ?? null,
      previewUrl: buffDurationFrameResult?.previewUrl ?? null,
      previewImageData: buffDurationFrameResult?.previewImageData ?? null,
      regionLabel: buffDurationFrameResult?.regionLabel ?? null,
      buffDuration: buffDurationFrameResult?.snapshot ?? null,
    },
    traceSample,
    alertDecision,
    alertCycleStartedAt,
  };
}

function getSkillBuffDurationRuntimeState({
  countdownSeconds,
  confidence,
  previous,
  sampledAt,
  skill,
}: {
  countdownSeconds: number | null;
  confidence: number;
  previous: SkillRuntimeState;
  sampledAt: number;
  skill: SkillConfig;
}): SkillRuntimeState {
  if (!skill.enabled) {
    return {
      ...previous,
      confidence,
      status: "paused",
      pendingShortAnchor: null,
      buffDurationCountdownMissingSinceAt: null,
      buffDurationTimingEvent: null,
    };
  }

  if (countdownSeconds === null) {
    const pendingShortAnchor = isFreshBuffDurationPendingAnchor(
      previous.pendingShortAnchor,
      sampledAt,
    )
      ? previous.pendingShortAnchor
      : null;
    const shouldTrackMissing =
      previous.estimatedExpiresAt !== null || previous.pendingShortAnchor !== null;
    const missingSinceAt = shouldTrackMissing
      ? previous.buffDurationCountdownMissingSinceAt ?? sampledAt
      : null;

    return {
      ...previous,
      confidence,
      status: previous.alertedAt
        ? "alerted"
        : previous.estimatedExpiresAt
          ? "running"
          : "detecting",
      rejectedReading: null,
      pendingShortAnchor,
      buffDurationCountdownMissingSinceAt: missingSinceAt,
    };
  }

  if (!isTrustedBuffDurationCountdown(countdownSeconds, skill)) {
    if (shouldPreserveUntrustedBuffDurationCountdown(previous, skill)) {
      const pendingShortAnchor = isFreshBuffDurationPendingAnchor(
        previous.pendingShortAnchor,
        sampledAt,
      )
        ? previous.pendingShortAnchor
        : null;

      return {
        ...previous,
        observedRemainingSeconds: countdownSeconds,
        observedAt: sampledAt,
        confidence,
        status: previous.alertedAt ? "alerted" : "running",
        rejectedReading: countdownSeconds,
        pendingShortAnchor,
      };
    }

    return {
      ...previous,
      observedRemainingSeconds: countdownSeconds,
      observedAt: sampledAt,
      estimatedExpiresAt: null,
      confidence,
      status: "detecting",
      alertedAt: null,
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 0,
      lastAlertCycleStartedAt: null,
      rejectedReading: null,
      effectiveCooldownDurationSeconds: null,
      pendingShortAnchor: null,
      buffDurationCountdownMissingSinceAt: null,
      buffDurationTimingEvent: null,
    };
  }

  const candidateExpiresAt = sampledAt + countdownSeconds * 1000;
  const previousExpiresAt = previous.estimatedExpiresAt;

  if (
    previousExpiresAt !== null &&
    isBuffDurationSameExpiresAt(candidateExpiresAt, previousExpiresAt)
  ) {
    return getConfirmedSkillBuffDurationRuntimeState({
      countdownSeconds,
      confidence,
      estimatedExpiresAt: previousExpiresAt,
      previous,
      sampledAt,
      skill,
    });
  }

  const pendingShortAnchor = updateBuffDurationPendingAnchor({
    candidateExpiresAt,
    countdownSeconds,
    previous,
    sampledAt,
  });

  if (pendingShortAnchor.count >= BUFF_DURATION_PENDING_MIN_OBSERVATIONS) {
    return getConfirmedSkillBuffDurationRuntimeState({
      countdownSeconds,
      confidence,
      estimatedExpiresAt: pendingShortAnchor.estimatedExpiresAt,
      previous,
      sampledAt,
      skill,
    });
  }

  return {
    ...previous,
    observedRemainingSeconds: countdownSeconds,
    observedAt: sampledAt,
    confidence,
    status: previous.alertedAt
      ? "alerted"
      : previous.estimatedExpiresAt
        ? "running"
        : "detecting",
    alertedAt: previous.alertedAt,
    lastRepeatedAlertAt: previous.lastRepeatedAlertAt,
    repeatedAlertCount: previous.repeatedAlertCount,
    lastAlertCycleStartedAt: previous.lastAlertCycleStartedAt,
    rejectedReading: null,
    pendingShortAnchor,
    buffDurationCountdownMissingSinceAt: null,
  };
}

function shouldPreserveUntrustedBuffDurationCountdown(
  previous: SkillRuntimeState,
  skill: SkillConfig,
): boolean {
  const target = getSkillBuffDurationTargetForSkill(skill);
  return (
    target?.maxTrustedCountdownSecondsExclusive !== undefined &&
    (previous.estimatedExpiresAt !== null || previous.alertedAt !== null)
  );
}

function getConfirmedSkillBuffDurationRuntimeState({
  countdownSeconds,
  confidence,
  estimatedExpiresAt,
  previous,
  sampledAt,
  skill,
}: {
  countdownSeconds: number;
  confidence: number;
  estimatedExpiresAt: number;
  previous: SkillRuntimeState;
  sampledAt: number;
  skill: SkillConfig;
}): SkillRuntimeState {
  const wasExtended =
    previous.estimatedExpiresAt !== null &&
    estimatedExpiresAt > previous.estimatedExpiresAt + BUFF_DURATION_EXPIRES_AT_TOLERANCE_MS;
  const shouldKeepCurrentAlertCycle = previous.alertedAt !== null && !wasExtended;

  return {
    ...previous,
    observedRemainingSeconds: countdownSeconds,
    observedAt: sampledAt,
    estimatedExpiresAt,
    confidence,
    status: shouldKeepCurrentAlertCycle ? "alerted" : "running",
    alertedAt: shouldKeepCurrentAlertCycle ? previous.alertedAt : null,
    lastRepeatedAlertAt: shouldKeepCurrentAlertCycle ? previous.lastRepeatedAlertAt : null,
    repeatedAlertCount: shouldKeepCurrentAlertCycle ? previous.repeatedAlertCount : 0,
    lastAlertCycleStartedAt: shouldKeepCurrentAlertCycle
      ? previous.lastAlertCycleStartedAt
      : previous.lastAlertCycleStartedAt ?? sampledAt,
    rejectedReading: null,
    effectiveCooldownDurationSeconds: null,
    pendingShortAnchor: null,
    buffDurationCountdownMissingSinceAt: null,
    buffDurationTimingEvent: wasExtended
      ? { type: "extended", occurredAt: sampledAt }
      : previous.buffDurationTimingEvent,
  };
}

function canAlertWithMissingBuffDurationCountdown(state: SkillRuntimeState): boolean {
  if (
    state.buffDurationCountdownMissingSinceAt === null ||
    state.estimatedExpiresAt === null
  ) {
    return false;
  }

  return true;
}

function updateBuffDurationPendingAnchor({
  candidateExpiresAt,
  countdownSeconds,
  previous,
  sampledAt,
}: {
  candidateExpiresAt: number;
  countdownSeconds: number;
  previous: SkillRuntimeState;
  sampledAt: number;
}): NonNullable<SkillRuntimeState["pendingShortAnchor"]> {
  const previousPending = isFreshBuffDurationPendingAnchor(
    previous.pendingShortAnchor,
    sampledAt,
  )
    ? previous.pendingShortAnchor
    : null;
  if (
    previousPending &&
    isBuffDurationSameExpiresAt(candidateExpiresAt, previousPending.estimatedExpiresAt)
  ) {
    const count = previousPending.count + 1;
    return {
      observedRemainingSeconds: countdownSeconds,
      maxObservedRemainingSeconds: Math.max(
        previousPending.maxObservedRemainingSeconds,
        countdownSeconds,
      ),
      observedAt: sampledAt,
      estimatedExpiresAt: Math.round(
        (previousPending.estimatedExpiresAt * previousPending.count + candidateExpiresAt) /
          count,
      ),
      count,
    };
  }

  return {
    observedRemainingSeconds: countdownSeconds,
    maxObservedRemainingSeconds: countdownSeconds,
    observedAt: sampledAt,
    estimatedExpiresAt: candidateExpiresAt,
    count: 1,
  };
}

function isFreshBuffDurationPendingAnchor(
  pendingShortAnchor: SkillRuntimeState["pendingShortAnchor"],
  sampledAt: number,
): pendingShortAnchor is NonNullable<SkillRuntimeState["pendingShortAnchor"]> {
  return (
    pendingShortAnchor !== null &&
    sampledAt - pendingShortAnchor.observedAt <= BUFF_DURATION_PENDING_MAX_AGE_MS
  );
}

function isBuffDurationSameExpiresAt(a: number, b: number): boolean {
  return Math.abs(a - b) <= BUFF_DURATION_EXPIRES_AT_TOLERANCE_MS;
}

function isTrustedBuffDurationCountdown(countdownSeconds: number, skill: SkillConfig): boolean {
  const target = getSkillBuffDurationTargetForSkill(skill);
  const maxSecondsExclusive =
    target?.maxTrustedCountdownSecondsExclusive ?? BUFF_DURATION_TRUSTED_MAX_SECONDS_EXCLUSIVE;
  return countdownSeconds < maxSecondsExclusive;
}

function getSkillBuffDurationCountdownSeconds(
  countdown: NonNullable<SkillSnapshot["buffDuration"]>["countdown"] | null | undefined,
): number | null {
  if (
    !countdown ||
    countdown.kind !== "exact" ||
    typeof countdown.totalSeconds !== "number" ||
    !Number.isFinite(countdown.totalSeconds)
  ) {
    return null;
  }
  return countdown.totalSeconds;
}

function getSkillBuffDurationRemainingCount(
  remainingCount: NonNullable<SkillSnapshot["buffDuration"]>["remainingCount"] | null | undefined,
): number | null {
  if (
    !remainingCount ||
    remainingCount.kind !== "exact" ||
    typeof remainingCount.count !== "number" ||
    !Number.isFinite(remainingCount.count)
  ) {
    return null;
  }
  return Math.max(0, Math.round(remainingCount.count));
}

function getSkillBuffDurationReason(
  buffDurationFrameResult?: SkillBuffDurationFrameResult | null,
): string {
  if (!buffDurationFrameResult) {
    return "buff-duration-waiting";
  }
  if (buffDurationFrameResult.snapshot.error) {
    return buffDurationFrameResult.snapshot.error;
  }
  if (buffDurationFrameResult.snapshot.displayStatus === "checking") {
    return "buff-duration-checking";
  }
  if (getSkillBuffDurationCountdownSeconds(buffDurationFrameResult.snapshot.countdown) !== null) {
    return "buff-duration-countdown-detected";
  }
  return buffDurationFrameResult.snapshot.detected
    ? "buff-duration-detected"
    : "buff-duration-searching";
}

function getSkillRemainingCountReason(
  buffDurationFrameResult?: SkillBuffDurationFrameResult | null,
): string {
  if (!buffDurationFrameResult) {
    return "remaining-count-waiting";
  }
  if (buffDurationFrameResult.snapshot.error) {
    return buffDurationFrameResult.snapshot.error;
  }
  if (buffDurationFrameResult.snapshot.displayStatus === "checking") {
    return "remaining-count-checking";
  }
  if (getSkillBuffDurationRemainingCount(buffDurationFrameResult.snapshot.remainingCount) !== null) {
    return "remaining-count-detected";
  }
  return buffDurationFrameResult.snapshot.detected
    ? "remaining-count-icon-detected"
    : "remaining-count-searching";
}
