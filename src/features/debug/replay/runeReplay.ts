import type { RuneRuntimeState } from "../../../alertTypes";
import {
  evaluateRuneConfirmation,
  parseRuneConfirmationPolicy,
} from "../../../lib/runeAlertPolicy";
import type { RuneAlertConfig } from "../../../types";
import type { DebugReplayCause } from "./buffExpiryPrecisionReplay";
import {
  asRecord,
  createSimpleReplayResult,
  getHasStream,
  getSampleBody,
  pickNumber,
  pickPositiveNumber,
  pickTimestamp,
  pickTimestampOrNull,
  unsupportedCauses,
  type AnalyzeOptions,
  type SimpleAlertReplayResult,
} from "./simpleReplayShared";

export function analyzeRuneReplaySample(
  sample: unknown,
  options: AnalyzeOptions = {},
): SimpleAlertReplayResult {
  const body = getSampleBody(sample);
  const rune = asRecord(body.rune);
  const confirmationPolicy = parseRuneConfirmationPolicy(rune.confirmationPolicy);
  const sampleNode = asRecord(body.sample);
  const result = asRecord(sampleNode.result);
  const config = asRecord(rune.config) as Partial<RuneAlertConfig>;
  const state = asRecord(rune.state) as Partial<RuneRuntimeState>;
  const runtimeTraceSource = Array.isArray(rune.runtimeTrace)
    ? rune.runtimeTrace
    : Array.isArray(state.recentSamples)
      ? state.recentSamples
      : [];
  const alertTrigger = asRecord(
    rune.alertTrigger ?? asRecord(asRecord(sampleNode.runeEvidence).alertTrigger),
  );
  const alertTriggerFrames = Array.isArray(alertTrigger.frames)
    ? alertTrigger.frames
    : [];
  const latestRuntimeSample = asRecord(
    runtimeTraceSource[runtimeTraceSource.length - 1],
  );
  const latestDecisionSample = asRecord(
    [...runtimeTraceSource]
      .reverse()
      .find((entry) => {
        const record = asRecord(entry);
        return record.outcome !== "error" && record.reason !== "detector-error";
      }),
  );
  const alertTriggerIndex = findLastAlertTriggerIndex(runtimeTraceSource);
  const traceAlertTriggerSample = asRecord(runtimeTraceSource[alertTriggerIndex]);
  const alertTriggerSample = alertTriggerFrames.length > 0
    ? asRecord(alertTriggerFrames[alertTriggerFrames.length - 1])
    : traceAlertTriggerSample;
  const alertTriggerSampledAt = pickTimestampOrNull(
    alertTrigger.triggeredAt,
    alertTriggerSample.sampledAt,
  );
  const alertTriggerFirstDetectedAt =
    pickTimestampOrNull(alertTriggerSample.firstDetectedAt) ??
    pickTimestampOrNull(asRecord(alertTriggerFrames[0]).sampledAt) ??
    findAlertSequenceStartedAt(runtimeTraceSource, alertTriggerIndex);
  const alertTriggerStableDurationMs =
    pickNumber(alertTriggerSample.stableDurationMs) ??
    (alertTriggerSampledAt !== null && alertTriggerFirstDetectedAt !== null
      ? Math.max(0, alertTriggerSampledAt - alertTriggerFirstDetectedAt)
      : null);
  const alertTriggerSatisfiedBy =
    typeof alertTriggerSample.confirmationSatisfiedBy === "string"
      ? alertTriggerSample.confirmationSatisfiedBy
      : inferConfirmationSatisfiedBy({
          stableCount: pickNumber(alertTriggerSample.stableCount) ?? 0,
          stableDurationMs: alertTriggerStableDurationMs,
          policy: confirmationPolicy,
        });
  const lastDetectionError = asRecord(
    state.lastDetectionError ??
      asRecord(rune.lastSnapshot).detectionError ??
      latestRuntimeSample.error,
  );
  const hasDetectionError =
    Object.keys(lastDetectionError).length > 0 ||
    state.status === "unavailable" ||
    latestRuntimeSample.outcome === "error" ||
    latestRuntimeSample.reason === "detector-error";
  const lastAlertPlayback = asRecord(state.lastAlertPlayback ?? rune.lastAlertPlayback);
  const lastAlertPlaybackStatus =
    typeof lastAlertPlayback.status === "string" ? lastAlertPlayback.status : null;
  const lastAlertPlaybackError =
    typeof lastAlertPlayback.error === "string" ? lastAlertPlayback.error : null;
  const playbackFailed = lastAlertPlaybackStatus === "failed";
  const playbackRequestedAt = pickTimestampOrNull(lastAlertPlayback.requestedAt);
  const playbackStartedAt = pickTimestampOrNull(lastAlertPlayback.startedAt);
  const playbackFinishedAt = pickTimestampOrNull(lastAlertPlayback.finishedAt);
  const playbackEffectiveVolume = pickNumber(lastAlertPlayback.effectiveVolume);
  const supported = Boolean(
    rune.config || rune.state || body.kind === "rune-issue" || body.kind === "rune",
  );
  const sampledAt = pickTimestamp(
    options.now,
    sampleNode.sampledAt,
    asRecord(rune.lastSnapshot).sampledAt,
    result.sampledAt,
    body.submittedAt,
    body.createdAt,
    asRecord(sample).createdAt,
  );
  const hasStream = getHasStream(body);
  const hasRegion = Boolean(rune.currentRegion || config.region || sampleNode.pixelRegion);
  const reportFrameDetected = Boolean(
    result.detected ?? asRecord(rune.lastSnapshot).detected,
  );
  const stateCandidateCount = pickNumber(state.candidateCount);
  const detected =
    pickBoolean(latestDecisionSample.detected) ??
    (stateCandidateCount !== null ? stateCandidateCount > 0 : reportFrameDetected);
  const confidence =
    pickNumber(
      latestDecisionSample.confidence,
      state.confidence,
      result.confidence,
      asRecord(rune.lastSnapshot).confidence,
    ) ??
    0;
  const stableCount = pickPositiveNumber(state.stableCount, 0) ?? 0;
  const firstDetectedAt = pickTimestampOrNull(state.firstDetectedAt);
  const runtimeConfirmation = evaluateRuneConfirmation({
    stableCount,
    firstDetectedAt,
    now: sampledAt,
    policy: confirmationPolicy,
  });
  const runtimeStable = runtimeConfirmation.satisfied;
  const lastRepeatedAlertAt = pickTimestampOrNull(state.lastRepeatedAlertAt);
  const repeatIntervalSeconds = pickPositiveNumber(config.repeatAlertIntervalSeconds, 0) ?? 0;
  const repeatedAlertCount = pickNumber(state.repeatedAlertCount) ?? 0;
  const repeatMaxCount = pickPositiveNumber(config.repeatAlertMaxCount) ?? null;
  const repeatDue =
    state.status === "alerted" &&
    config.repeatAlertEnabled === true &&
    lastRepeatedAlertAt !== null &&
    repeatIntervalSeconds > 0 &&
    (repeatMaxCount === null || repeatedAlertCount < repeatMaxCount) &&
    sampledAt - lastRepeatedAlertAt >= repeatIntervalSeconds * 1000;
  const dueNow =
    config.enabled !== false &&
    hasStream &&
    hasRegion &&
    !hasDetectionError &&
    detected &&
    state.status !== "alerted" &&
    runtimeStable;
  const shouldAlert = Boolean(!playbackFailed && (dueNow || repeatDue));
  const alertOutcome = getRuneAlertOutcome({
    state,
    runtimeTrace: runtimeTraceSource,
    lastAlertPlaybackStatus,
    hasAlertTrigger: alertTriggerFrames.length > 0,
  });
  const sceneChangeSamples = runtimeTraceSource
    .map(asRecord)
    .filter((entry) => entry.sceneChanged === true);
  const latestSceneChange = sceneChangeSamples[sceneChangeSamples.length - 1] ?? {};
  const sceneEpoch = pickNumber(latestDecisionSample.sceneEpoch, state.sceneEpoch) ?? 0;
  const consecutiveMissCount =
    pickNumber(latestDecisionSample.consecutiveMissCount, state.consecutiveMissCount) ?? 0;
  const decisionReason = getRuneDecisionReason({
    supported,
    enabled: config.enabled !== false,
    hasStream,
    hasRegion,
    detected,
    status: String(state.status ?? "unknown"),
    stableCount,
    playbackFailed,
    hasDetectionError,
    repeatDue,
    shouldAlert,
  });

  return createSimpleReplayResult({
    engine: "rune",
    supported,
    reason: supported ? null : "룬 알림 샘플이 아니어서 현재 adapter를 실행하지 않았습니다.",
    sampledAt,
    status: String(state.status ?? "unknown"),
    shouldAlert,
    decisionReason,
    metrics: {
      detected,
      hasDetectionError,
      detectionErrorCode:
        typeof lastDetectionError.code === "string" ? lastDetectionError.code : null,
      detectionErrorPhase:
        typeof lastDetectionError.phase === "string" ? lastDetectionError.phase : null,
      detectionErrorMessage:
        typeof lastDetectionError.message === "string" ? lastDetectionError.message : null,
      detectionErrorRetryCount: pickNumber(lastDetectionError.retryCount),
      reportFrameDetected,
      confidence,
      stableCount,
      runtimeStable,
      confirmationPolicyVersion: confirmationPolicy.version,
      confirmationPolicyMode: confirmationPolicy.mode,
      requiredStableFrames: confirmationPolicy.requiredStableFrames,
      requiredStableMilliseconds: confirmationPolicy.requiredStableMilliseconds,
      confirmationSatisfiedBy: runtimeConfirmation.satisfiedBy,
      scenePolicyVersion:
        typeof latestDecisionSample.scenePolicyVersion === "string"
          ? latestDecisionSample.scenePolicyVersion
          : typeof state.scenePolicyVersion === "string"
            ? state.scenePolicyVersion
            : null,
      sceneEpoch,
      alertedSceneEpoch: pickNumber(state.alertedSceneEpoch),
      sceneChangeCount: sceneChangeSamples.length,
      latestSceneChangedAt: pickTimestampOrNull(
        latestSceneChange.sampledAt,
        state.sceneChangedAt,
      ),
      latestSceneChangeScore: pickNumber(
        latestSceneChange.sceneChangeScore,
        state.sceneChangeScore,
      ),
      scenePendingStableCount:
        pickNumber(
          latestDecisionSample.scenePendingStableCount,
          state.scenePendingStableCount,
        ) ?? 0,
      consecutiveMissCount,
      candidateCount: pickNumber(
        latestDecisionSample.candidateCount,
        state.candidateCount,
        result.candidateCount,
        asRecord(rune.lastSnapshot).candidateCount,
      ),
      runtimeSampledAt: pickTimestampOrNull(latestRuntimeSample.sampledAt),
      reportFrameSampledAt: pickTimestampOrNull(
        sampleNode.sampledAt,
        asRecord(rune.lastSnapshot).sampledAt,
      ),
      alertOutcome,
      alertTriggerDetected:
        alertTriggerFrames.length > 0 || alertTriggerIndex >= 0
          ? alertTriggerSample.detected === true
          : null,
      alertTriggerFrameCount: alertTriggerFrames.length,
      alertTriggerCycleId:
        typeof alertTrigger.cycleId === "string" ? alertTrigger.cycleId : null,
      alertTriggerDetectorVersion:
        typeof alertTrigger.detectorVersion === "string"
          ? alertTrigger.detectorVersion
          : typeof alertTriggerSample.detectorVersion === "string"
            ? alertTriggerSample.detectorVersion
            : null,
      alertTriggerSampledAt,
      alertTriggerFirstDetectedAt,
      alertTriggerStableDurationMs,
      alertTriggerSatisfiedBy,
      alertTriggerConfidence: pickNumber(alertTriggerSample.confidence),
      alertTriggerStableCount: pickNumber(alertTriggerSample.stableCount),
      alertTriggerCandidateCount: pickNumber(alertTriggerSample.candidateCount),
      alertTriggerReason:
        typeof alertTriggerSample.reason === "string" ? alertTriggerSample.reason : null,
      lastDetectedAt: pickTimestampOrNull(state.lastDetectedAt),
      alertedAt: pickTimestampOrNull(state.alertedAt),
      lastAlertedAt: pickTimestampOrNull(state.lastAlertedAt),
      lastAlertPlaybackStatus,
      lastAlertPlaybackError,
      playbackCycleId:
        typeof lastAlertPlayback.cycleId === "string" ? lastAlertPlayback.cycleId : null,
      playbackSceneEpoch: pickNumber(lastAlertPlayback.sceneEpoch),
      playbackRequestedAt,
      playbackStartedAt,
      playbackFinishedAt,
      playbackSoundId:
        typeof lastAlertPlayback.soundId === "string" ? lastAlertPlayback.soundId : null,
      playbackAlertVolume: pickNumber(lastAlertPlayback.alertVolume),
      playbackMasterVolume: pickNumber(lastAlertPlayback.masterVolume),
      playbackEffectiveVolume,
    },
    causes: buildRuneCauses({
      supported,
      decisionReason,
      detected,
      confidence,
      stableCount,
      status: String(state.status ?? "unknown"),
      hasDetectionError,
      detectionErrorMessage:
        typeof lastDetectionError.message === "string" ? lastDetectionError.message : null,
      lastAlertPlaybackError,
      playbackEffectiveVolume,
      shouldAlert,
    }),
  });
}

function inferConfirmationSatisfiedBy({
  stableCount,
  stableDurationMs,
  policy,
}: {
  stableCount: number;
  stableDurationMs: number | null;
  policy: ReturnType<typeof parseRuneConfirmationPolicy>;
}) {
  const framesSatisfied = stableCount >= policy.requiredStableFrames;
  const durationSatisfied =
    stableDurationMs !== null &&
    stableDurationMs >= policy.requiredStableMilliseconds;
  if (framesSatisfied && durationSatisfied) {
    return "frames-and-duration";
  }
  if (framesSatisfied) {
    return "frames";
  }
  if (durationSatisfied) {
    return "duration";
  }
  return null;
}

function findLastAlertTriggerIndex(trace: unknown[]): number {
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    if (asRecord(trace[index]).shouldAlert === true) {
      return index;
    }
  }
  return -1;
}

function findAlertSequenceStartedAt(trace: unknown[], alertIndex: number): number | null {
  if (alertIndex < 0) {
    return null;
  }
  const alertSample = asRecord(trace[alertIndex]);
  const alertCandidate = asRecord(alertSample.candidate);
  let startedAt = pickTimestampOrNull(alertSample.sampledAt);
  for (let index = alertIndex - 1; index >= 0; index -= 1) {
    const sample = asRecord(trace[index]);
    if (sample.detected !== true || !isSameTraceCandidate(alertCandidate, asRecord(sample.candidate))) {
      break;
    }
    const sampledAt = pickTimestampOrNull(sample.sampledAt);
    if (sampledAt === null) {
      break;
    }
    startedAt = sampledAt;
  }
  return startedAt;
}

function isSameTraceCandidate(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const leftX = pickNumber(left.x);
  const leftY = pickNumber(left.y);
  const leftWidth = pickNumber(left.width);
  const leftHeight = pickNumber(left.height);
  const rightX = pickNumber(right.x);
  const rightY = pickNumber(right.y);
  const rightWidth = pickNumber(right.width);
  const rightHeight = pickNumber(right.height);
  if (
    leftX === null || leftY === null || leftWidth === null || leftHeight === null ||
    rightX === null || rightY === null || rightWidth === null || rightHeight === null
  ) {
    return true;
  }
  const centerDistance = Math.hypot(
    leftX + leftWidth / 2 - (rightX + rightWidth / 2),
    leftY + leftHeight / 2 - (rightY + rightHeight / 2),
  );
  const sizeRatio = Math.min(leftWidth, rightWidth) / Math.max(leftWidth, rightWidth);
  return centerDistance <= 10 && sizeRatio >= 0.85;
}

type RuneAlertOutcome =
  | "finished"
  | "failed"
  | "started"
  | "requested"
  | "triggered"
  | "not-triggered"
  | "unknown";

function getRuneAlertOutcome({
  state,
  runtimeTrace,
  lastAlertPlaybackStatus,
  hasAlertTrigger,
}: {
  state: Partial<RuneRuntimeState>;
  runtimeTrace: unknown[];
  lastAlertPlaybackStatus: string | null;
  hasAlertTrigger: boolean;
}): RuneAlertOutcome {
  if (lastAlertPlaybackStatus === "finished") return "finished";
  if (lastAlertPlaybackStatus === "failed") return "failed";
  if (lastAlertPlaybackStatus === "started") return "started";
  if (lastAlertPlaybackStatus === "requested") return "requested";
  if (
    pickTimestampOrNull(state.lastAlertedAt, state.alertedAt) !== null ||
    state.status === "alerted" ||
    hasAlertTrigger ||
    runtimeTrace.some((entry) => asRecord(entry).shouldAlert === true)
  ) {
    return "triggered";
  }
  if (runtimeTrace.length > 0) {
    return "not-triggered";
  }
  return "unknown";
}

function pickBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function buildRuneCauses({
  supported,
  decisionReason,
  detected,
  confidence,
  stableCount,
  status,
  lastAlertPlaybackError,
  hasDetectionError,
  detectionErrorMessage,
  playbackEffectiveVolume,
  shouldAlert,
}: {
  supported: boolean;
  decisionReason: string;
  detected: boolean;
  confidence: number;
  stableCount: number;
  status: string;
  lastAlertPlaybackError: string | null;
  hasDetectionError: boolean;
  detectionErrorMessage: string | null;
  playbackEffectiveVolume: number | null;
  shouldAlert: boolean;
}): DebugReplayCause[] {
  if (!supported) return unsupportedCauses("룬 알림");
  if (decisionReason === "disabled") {
    return [
      {
        status: "warn",
        title: "제보 당시 룬 알림이 꺼져 있었습니다",
        detail:
          "룬 알림이 꺼진 상태라 실제 감지 루프와 알림 재생이 실행되지 않았습니다. 제보 이미지 판정은 제보용 단일 프레임 분석 결과입니다.",
      },
    ];
  }
  if (hasDetectionError) {
    return [
      {
        status: "fail",
        title: "룬 감지기 실행 오류",
        detail: detectionErrorMessage
          ? `룬 감지 Worker가 정상 결과를 반환하지 못했습니다. 오류: ${detectionErrorMessage}`
          : "룬 감지 Worker가 정상 결과를 반환하지 못했습니다.",
      },
    ];
  }
  if (decisionReason === "playback-failed") {
    return [
      {
        status: "fail",
        title: "룬 알림 재생 실패",
        detail: lastAlertPlaybackError
          ? `룬은 알림 조건에 도달했지만 브라우저 오디오 재생이 실패했습니다. 오류: ${lastAlertPlaybackError}`
          : "룬은 알림 조건에 도달했지만 브라우저 오디오 재생이 실패했습니다.",
      },
    ];
  }
  if (playbackEffectiveVolume !== null && playbackEffectiveVolume <= 0) {
    return [
      {
        status: "fail",
        title: "룬 알림 볼륨이 0",
        detail: "브라우저 재생 기록과 관계없이 기능 볼륨과 마스터 볼륨을 합친 최종 볼륨이 0이라 소리가 나지 않습니다.",
      },
    ];
  }
  if (shouldAlert) {
    return [
      {
        status: "fail",
        title: "현재 알림 대상",
        detail: "감지 안정 조건을 만족해 현재 코드 기준 알림이 울려야 하는 상태입니다.",
      },
    ];
  }
  if (decisionReason === "already-alerted") {
    return [
      {
        status: "pass",
        title: "알림 완료 상태",
        detail: "payload상 이미 룬 알림이 완료된 상태입니다.",
      },
    ];
  }
  if (decisionReason === "arming") {
    return [
      {
        status: "warn",
        title: "룬 후보 안정화 중",
        detail: `룬 후보는 보였지만 안정 프레임이 ${stableCount}개라 아직 알림 조건 전입니다.`,
      },
    ];
  }
  if (!detected) {
    return [
      {
        status: "warn",
        title: "룬 후보 없음",
        detail: `마지막 판정 신뢰도는 ${Math.round(confidence * 100)}%이며 감지 조건을 넘지 못했습니다.`,
      },
    ];
  }
  return [
    {
      status: "info",
      title: "룬 상태",
      detail: `${status} 상태입니다. 결정 사유: ${decisionReason}`,
    },
  ];
}

function getRuneDecisionReason({
  supported,
  enabled,
  hasStream,
  hasRegion,
  detected,
  status,
  stableCount,
  playbackFailed,
  hasDetectionError,
  repeatDue,
  shouldAlert,
}: {
  supported: boolean;
  enabled: boolean;
  hasStream: boolean;
  hasRegion: boolean;
  detected: boolean;
  status: string;
  stableCount: number;
  playbackFailed: boolean;
  hasDetectionError: boolean;
  repeatDue: boolean;
  shouldAlert: boolean;
}) {
  if (!supported) return "unsupported";
  if (!enabled) return "disabled";
  if (!hasStream) return "no-stream";
  if (!hasRegion) return "no-region";
  if (hasDetectionError) return "detector-error";
  if (playbackFailed) return "playback-failed";
  if (repeatDue) return "repeat-due";
  if (status === "alerted") return "already-alerted";
  if (shouldAlert) return "due-now";
  if (detected && stableCount > 0) return "arming";
  return "waiting";
}
