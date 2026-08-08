import type { HuntStallRuntimeState } from "../../../alertTypes";
import {
  getRepeatAlertIntervalSeconds,
  getRepeatAlertMaxCount,
  isRepeatAlertEnabled,
} from "../../../lib/repeatAlerts";
import type { HuntStallAlertConfig } from "../../../types";
import type { DebugReplayCause } from "./buffExpiryPrecisionReplay";
import {
  asRecord,
  clampNumber,
  createSimpleReplayResult,
  firstMetricValue,
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

export function analyzeHuntStallReplaySample(
  sample: unknown,
  options: AnalyzeOptions = {},
): SimpleAlertReplayResult {
  const body = getSampleBody(sample);
  const hunt = asRecord(body.huntStall);
  const sampleNode = asRecord(body.sample);
  const result = asRecord(sampleNode.result);
  const config = asRecord(hunt.config) as Partial<HuntStallAlertConfig>;
  const state = asRecord(hunt.state) as Partial<HuntStallRuntimeState>;
  const lastSnapshot = asRecord(hunt.lastSnapshot);
  const supported = Boolean(hunt.config || hunt.state || String(body.kind ?? "").includes("hunt-stall"));
  const sampledAt = pickTimestamp(
    sampleNode.sampledAt,
    state.lastSampledAt,
    lastSnapshot.sampledAt,
    result.sampledAt,
    body.submittedAt,
    body.createdAt,
    asRecord(sample).createdAt,
    options.now,
  );
  const mode = String(config.mode ?? lastSnapshot.mode ?? sampleNode.mode ?? "manual-experience");
  const supportsRepeat = mode !== "cooldown-presence";
  const hasStream = getHasStream(body);
  const hasRegion =
    mode === "cooldown-presence"
      ? Boolean(config.cooldownRegion || sampleNode.pixelRegion || sampleNode.rawDataUrl)
      : Boolean(sampleNode.rawDataUrl || lastSnapshot.regionLabel || sampleNode.regionLabel);
  const enabled = config.enabled !== false;
  const thresholdSeconds =
    mode === "cooldown-presence"
      ? clampNumber(config.cooldownMissingThresholdSeconds, 1, 60, 5)
      : clampNumber(config.stallThresholdSeconds, 5, 120, 10);
  const unchangedSeconds = pickPositiveNumber(state.unchangedSeconds, 0) ?? 0;
  const hasObservedActivity =
    mode === "cooldown-presence"
      ? Boolean(state.hasObservedCooldownPresence || state.alertedAt)
      : Boolean(state.hasObservedExperienceChange || state.alertedAt);
  const alreadyAlerted = pickTimestampOrNull(state.alertedAt) !== null || state.status === "alerted";
  const shouldInitialAlert =
    enabled &&
    hasStream &&
    hasRegion &&
    hasObservedActivity &&
    !alreadyAlerted &&
    unchangedSeconds >= thresholdSeconds;
  const repeatConfigKnown =
    typeof config.repeatAlertEnabled === "boolean" ||
    config.repeatAlertIntervalSeconds !== undefined ||
    config.repeatAlertMaxCount !== undefined;
  const repeatAlertEnabled = supportsRepeat && isRepeatAlertEnabled(config);
  const repeatIntervalSeconds = getRepeatAlertIntervalSeconds(config);
  const repeatIntervalMs = repeatIntervalSeconds * 1000;
  const repeatMaxCount = getRepeatAlertMaxCount(config);
  const repeatedAlertCount = pickPositiveNumber(state.repeatedAlertCount, 0) ?? 0;
  const lastRepeatedAlertAt = pickTimestampOrNull(state.lastRepeatedAlertAt);
  const playback = asRecord(state.lastAlertPlayback);
  const lastAlertPlaybackStatus =
    typeof playback.status === "string" ? playback.status : null;
  const playbackInFlight =
    lastAlertPlaybackStatus === "requested" || lastAlertPlaybackStatus === "started";
  const repeatLimitReached =
    repeatMaxCount !== null && repeatedAlertCount >= repeatMaxCount;
  const repeatElapsedMs =
    lastRepeatedAlertAt === null ? null : Math.max(0, sampledAt - lastRepeatedAlertAt);
  const repeatRemainingMs =
    repeatElapsedMs === null ? null : Math.max(0, repeatIntervalMs - repeatElapsedMs);
  const shouldRepeatAlert =
    enabled &&
    hasStream &&
    hasRegion &&
    supportsRepeat &&
    alreadyAlerted &&
    repeatAlertEnabled &&
    !playbackInFlight &&
    !repeatLimitReached &&
    lastRepeatedAlertAt !== null &&
    repeatElapsedMs !== null &&
    repeatElapsedMs >= repeatIntervalMs;
  const shouldAlert = shouldInitialAlert || shouldRepeatAlert;
  const traceAnalysis = analyzeHuntStallAlertTrace(
    sampleNode.runtimeTrace,
    mode,
    repeatIntervalMs,
  );
  const decisionReason = getHuntDecisionReason({
    supported,
    enabled,
    hasStream,
    hasRegion,
    hasObservedActivity,
    alreadyAlerted,
    supportsRepeat,
    repeatConfigKnown,
    repeatAlertEnabled,
    playbackInFlight,
    repeatLimitReached,
    lastRepeatedAlertAt,
    repeatRemainingMs,
    shouldInitialAlert,
    shouldRepeatAlert,
    unchangedSeconds,
    thresholdSeconds,
    shouldAlert,
  });

  return createSimpleReplayResult({
    engine: "hunt-stall",
    supported,
    reason: supported ? null : "사냥 멈춤 알림 샘플이 아니어서 현재 adapter를 실행하지 않았습니다.",
    sampledAt,
    status: String(state.status ?? "unknown"),
    shouldAlert,
    decisionReason,
    metrics: {
      mode,
      thresholdSeconds,
      unchangedSeconds,
      recognizedText: firstMetricValue(state.recognizedText, result.value, lastSnapshot.recognizedText),
      confidence: pickNumber(result.confidence, lastSnapshot.confidence, state.confidence),
      changeScore: pickNumber(result.changeScore, lastSnapshot.changeScore, state.changeScore),
      lastDecision: state.lastDecision ?? null,
      alertedAt: pickTimestampOrNull(state.alertedAt),
      repeatAlertEnabled,
      repeatIntervalSeconds,
      repeatMaxCount,
      repeatedAlertCount,
      lastRepeatedAlertAt,
      repeatRemainingMs,
      lastAlertPlaybackStatus,
      rapidRepeatDetected: traceAnalysis.rapidRepeatDetected,
      minimumAlertGapMs: traceAnalysis.minimumAlertGapMs,
    },
    causes: buildHuntCauses({
      supported,
      decisionReason,
      mode,
      thresholdSeconds,
      unchangedSeconds,
      hasObservedActivity,
      status: String(state.status ?? "unknown"),
      shouldAlert,
      rapidRepeatDetected: traceAnalysis.rapidRepeatDetected,
      minimumAlertGapMs: traceAnalysis.minimumAlertGapMs,
      repeatIntervalSeconds,
      repeatRemainingMs,
      repeatedAlertCount,
      repeatMaxCount,
    }),
  });
}

function buildHuntCauses({
  supported,
  decisionReason,
  mode,
  thresholdSeconds,
  unchangedSeconds,
  hasObservedActivity,
  status,
  shouldAlert,
  rapidRepeatDetected,
  minimumAlertGapMs,
  repeatIntervalSeconds,
  repeatRemainingMs,
  repeatedAlertCount,
  repeatMaxCount,
}: {
  supported: boolean;
  decisionReason: string;
  mode: string;
  thresholdSeconds: number;
  unchangedSeconds: number;
  hasObservedActivity: boolean;
  status: string;
  shouldAlert: boolean;
  rapidRepeatDetected: boolean;
  minimumAlertGapMs: number | null;
  repeatIntervalSeconds: number;
  repeatRemainingMs: number | null;
  repeatedAlertCount: number;
  repeatMaxCount: number | null;
}): DebugReplayCause[] {
  if (!supported) return unsupportedCauses("사냥 멈춤 알림");
  if (rapidRepeatDetected) {
    return [
      {
        status: "fail",
        title: "반복 간격보다 빠른 알림 요청",
        detail: `저장 기록에서 최소 ${Math.round((minimumAlertGapMs ?? 0) / 100) / 10}초 간격의 알림 요청을 확인했습니다. 설정 간격은 ${repeatIntervalSeconds}초입니다.`,
      },
    ];
  }
  if (shouldAlert) {
    return [
      {
        status: "fail",
        title: decisionReason === "repeat-due" ? "현재 반복 알림 대상" : "현재 알림 대상",
        detail:
          decisionReason === "repeat-due"
            ? `${repeatIntervalSeconds}초 반복 간격이 지나 현재 코드 기준 다음 알림이 울려야 하는 상태입니다.`
            : `${unchangedSeconds}초 동안 변화가 없어 현재 코드 기준 알림이 울려야 하는 상태입니다.`,
      },
    ];
  }
  if (decisionReason === "repeat-playback-pending") {
    return [
      {
        status: "pass",
        title: "알림 재생 중",
        detail: "현재 음성 재생이 끝나기 전이므로 다음 반복을 예약하지 않습니다.",
      },
    ];
  }
  if (decisionReason === "repeat-interval-waiting") {
    return [
      {
        status: "pass",
        title: "반복 간격 대기 중",
        detail: `다음 반복까지 약 ${Math.ceil((repeatRemainingMs ?? 0) / 1000)}초 남았습니다.`,
      },
    ];
  }
  if (decisionReason === "repeat-limit-reached") {
    return [
      {
        status: "pass",
        title: "설정한 반복 횟수 완료",
        detail: `${repeatedAlertCount}/${repeatMaxCount ?? repeatedAlertCount}회 반복을 완료했습니다.`,
      },
    ];
  }
  if (decisionReason === "repeat-reference-missing") {
    return [
      {
        status: "warn",
        title: "재생 완료 시각 없음",
        detail: "알림 주기는 유지 중이지만 다음 반복을 계산할 재생 완료 시각이 없습니다.",
      },
    ];
  }
  if (decisionReason === "repeat-disabled") {
    return [
      {
        status: "pass",
        title: "반복 알림 사용 안 함",
        detail: "최초 알림은 처리됐고 반복 알림은 설정에서 꺼져 있습니다.",
      },
    ];
  }
  if (decisionReason === "already-alerted") {
    return [
      {
        status: "pass",
        title: "알림 처리 기록 있음",
        detail: "payload에 사냥 멈춤 알림 조건을 처리한 시각이 있습니다. 실제 소리 재생 성공 여부는 별도 재생 기록으로 확인해야 합니다.",
      },
    ];
  }
  if (!hasObservedActivity) {
    return [
      {
        status: "warn",
        title: "감시 시작 전",
        detail:
          mode === "cooldown-presence"
            ? "쿨타임 변화가 아직 충분히 확인되지 않았습니다."
            : "경험치 증가가 아직 확인되지 않았습니다.",
      },
    ];
  }
  if (unchangedSeconds < thresholdSeconds) {
    return [
      {
        status: "pass",
        title: "알림 기준 전",
        detail: `변화 없음 ${unchangedSeconds}초로 알림 기준 ${thresholdSeconds}초 전입니다.`,
      },
    ];
  }
  return [
    {
      status: "info",
      title: "사냥 멈춤 상태",
      detail: `${status} 상태입니다. 결정 사유: ${decisionReason}`,
    },
  ];
}

function getHuntDecisionReason({
  supported,
  enabled,
  hasStream,
  hasRegion,
  hasObservedActivity,
  alreadyAlerted,
  supportsRepeat,
  repeatConfigKnown,
  repeatAlertEnabled,
  playbackInFlight,
  repeatLimitReached,
  lastRepeatedAlertAt,
  repeatRemainingMs,
  shouldInitialAlert,
  shouldRepeatAlert,
  unchangedSeconds,
  thresholdSeconds,
  shouldAlert,
}: {
  supported: boolean;
  enabled: boolean;
  hasStream: boolean;
  hasRegion: boolean;
  hasObservedActivity: boolean;
  alreadyAlerted: boolean;
  supportsRepeat: boolean;
  repeatConfigKnown: boolean;
  repeatAlertEnabled: boolean;
  playbackInFlight: boolean;
  repeatLimitReached: boolean;
  lastRepeatedAlertAt: number | null;
  repeatRemainingMs: number | null;
  shouldInitialAlert: boolean;
  shouldRepeatAlert: boolean;
  unchangedSeconds: number;
  thresholdSeconds: number;
  shouldAlert: boolean;
}) {
  if (!supported) return "unsupported";
  if (!enabled) return "disabled";
  if (!hasStream) return "no-stream";
  if (!hasRegion) return "no-region";
  if (shouldRepeatAlert) return "repeat-due";
  if (shouldInitialAlert) return "due-now";
  if (alreadyAlerted) {
    if (!supportsRepeat || !repeatConfigKnown) return "already-alerted";
    if (!repeatAlertEnabled) return "repeat-disabled";
    if (playbackInFlight) return "repeat-playback-pending";
    if (repeatLimitReached) return "repeat-limit-reached";
    if (lastRepeatedAlertAt === null) return "repeat-reference-missing";
    if (repeatRemainingMs !== null && repeatRemainingMs > 0) {
      return "repeat-interval-waiting";
    }
    return "already-alerted";
  }
  if (!hasObservedActivity) return "not-armed";
  if (shouldAlert) return "due-now";
  if (unchangedSeconds < thresholdSeconds) return "below-threshold";
  return "waiting";
}

function analyzeHuntStallAlertTrace(
  value: unknown,
  mode: string,
  repeatIntervalMs: number,
): { rapidRepeatDetected: boolean; minimumAlertGapMs: number | null } {
  const alertTimes = (Array.isArray(value) ? value : [])
    .map((entry) => asRecord(entry))
    .filter(
      (entry) =>
        entry.shouldAlert === true &&
        (entry.mode === undefined || String(entry.mode) === mode),
    )
    .map((entry) => pickTimestampOrNull(entry.sampledAt))
    .filter((timestamp): timestamp is number => timestamp !== null)
    .sort((left, right) => left - right);
  let minimumAlertGapMs: number | null = null;
  for (let index = 1; index < alertTimes.length; index += 1) {
    const gap = alertTimes[index] - alertTimes[index - 1];
    minimumAlertGapMs = minimumAlertGapMs === null ? gap : Math.min(minimumAlertGapMs, gap);
  }

  return {
    minimumAlertGapMs,
    rapidRepeatDetected:
      minimumAlertGapMs !== null && minimumAlertGapMs < repeatIntervalMs,
  };
}
