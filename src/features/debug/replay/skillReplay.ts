import {
  getEstimatedRemainingSeconds,
  getSkillAlertInRemainingCount,
  getSkillAlertInSeconds,
  shouldFireAlert,
  shouldFireRemainingCountAlert,
  shouldRepeatAlert,
} from "../../../lib/timer";
import { getSkillBuffDurationTargetForPresetId } from "../../../lib/skillBuffDuration/skillBuffDurationTargets";
import type { SkillConfig, SkillRuntimeState } from "../../../types";
import type { DebugReplayCause } from "./buffExpiryPrecisionReplay";
import {
  asRecord,
  createSimpleReplayResult,
  firstMetricValue,
  firstString,
  getHasStream,
  getSampleBody,
  pickNumber,
  pickPositiveNumber,
  pickTimestamp,
  pickTimestampOrNull,
  unsupportedCauses,
  type AnalyzeOptions,
  type SimpleAlertReplayResult,
  type UnknownRecord,
} from "./simpleReplayShared";

const SKILL_PRESET_LABELS: Partial<Record<string, string>> = {
  "erda-fountain": "에르다 파운틴",
  "sol-janus-dawn-2min": "솔 야누스: 새벽 (2분)",
  "sol-janus-dawn-80s": "솔 야누스: 새벽 (80초)",
  "sol-janus-dawn-70s": "솔 야누스: 새벽 (70초)",
  "sol-janus-dawn-1min": "솔 야누스: 새벽 (1분)",
  "sol-janus-dawn-deep-v2": "솔 야누스: 새벽 (정밀)",
  "hologram-graffiti-barrier-vi": "홀로그램 그래피티: 역장 VI",
  "erda-fountain-deep-v2": "에르다 파운틴 (정밀)",
  "class-install": "직업 설치기",
};

export function analyzeSkillReplaySample(
  sample: unknown,
  options: AnalyzeOptions = {},
): SimpleAlertReplayResult {
  const body = getSampleBody(sample);
  const skill = asRecord(body.skill);
  const sampleNode = asRecord(body.sample);
  const result = asRecord(sampleNode.result);
  const config = buildSkillConfig(asRecord(skill.config));
  const state = buildSkillRuntimeState(asRecord(skill.state), skill.id);
  const supported = Boolean(skill.config || skill.state || body.kind === "skill-issue");
  const buffDuration = asRecord(sampleNode.buffDuration);
  const isBuffDurationMode =
    config.detectionSource === "buff-duration" || Object.keys(buffDuration).length > 0;
  const sampledAt = pickTimestamp(
    options.now,
    sampleNode.sampledAt,
    asRecord(skill.lastSnapshot).sampledAt,
    result.sampledAt,
    state.observedAt,
    body.submittedAt,
    body.createdAt,
    asRecord(sample).createdAt,
  );
  const hasStream = getHasStream(body);
  const hasRegion = Boolean(skill.currentRegion || sampleNode.pixelRegion || sampleNode.rawDataUrl);
  if (isBuffDurationMode) {
    return analyzeSkillBuffDurationReplaySample({
      supported,
      config,
      state,
      skillNode: skill,
      sampleNode,
      buffDuration,
      sampledAt,
      hasStream,
      hasRegion,
    });
  }

  const remainingSeconds = getEstimatedRemainingSeconds(state, sampledAt);
  const initialDue = supported && hasStream && hasRegion && shouldFireAlert(state, config, sampledAt);
  const repeatDue = supported && hasStream && hasRegion && shouldRepeatAlert(state, config, sampledAt);
  const shouldAlert = Boolean(initialDue || repeatDue);
  const decisionReason = getSkillDecisionReason({
    supported,
    enabled: config.enabled,
    hasStream,
    hasRegion,
    alreadyAlerted: state.alertedAt !== null,
    remainingSeconds,
    thresholdSeconds: config.alertThresholdSeconds,
    repeatDue,
    shouldAlert,
  });

  return createSimpleReplayResult({
    engine: "skill",
    supported,
    reason: supported ? null : "스킬 알림 샘플이 아니어서 현재 adapter를 실행하지 않았습니다.",
    sampledAt,
    status: state.status,
    shouldAlert,
    decisionReason,
    metrics: {
      skillName: config.name,
      presetId: config.presetId ?? null,
      presetLabel: getSkillPresetLabel(config),
      detectionSource: config.detectionSource ?? "quickslot",
      detectionMode: getSkillDetectionSourceLabel(config),
      countdownSource: config.countdownSource,
      countdownMode: getSkillCountdownSourceLabel(config),
      durationSeconds: config.durationSeconds,
      cooldownDurationSeconds: config.cooldownDurationSeconds ?? null,
      value: firstMetricValue(result.value),
      confidence: pickNumber(result.confidence, state.confidence),
      remainingSeconds,
      alertThresholdSeconds: config.alertThresholdSeconds,
      alertInSeconds: getSkillAlertInSeconds(state, config, sampledAt),
      alertedAt: state.alertedAt,
      estimatedExpiresAt: state.estimatedExpiresAt,
    },
    causes: buildSkillCauses({
      supported,
      decisionReason,
      remainingSeconds,
      thresholdSeconds: config.alertThresholdSeconds,
      shouldAlert,
      status: state.status,
    }),
  });
}

function analyzeSkillBuffDurationReplaySample({
  supported,
  config,
  state,
  skillNode,
  sampleNode,
  buffDuration,
  sampledAt,
  hasStream,
  hasRegion,
}: {
  supported: boolean;
  config: SkillConfig;
  state: SkillRuntimeState;
  skillNode: UnknownRecord;
  sampleNode: UnknownRecord;
  buffDuration: UnknownRecord;
  sampledAt: number;
  hasStream: boolean;
  hasRegion: boolean;
}): SimpleAlertReplayResult {
  const candidateIcons = Array.isArray(buffDuration.candidateIcons)
    ? buffDuration.candidateIcons
    : [];
  const bestCandidateMatch = asRecord(asRecord(candidateIcons[0]).match);
  const detected = buffDuration.detected === true;
  const boxCount = pickNumber(buffDuration.boxCount) ?? 0;
  const detectedCount = pickNumber(buffDuration.detectedCount) ?? 0;
  const countdown = asRecord(buffDuration.countdown);
  const countdownSeconds = pickNumber(countdown.totalSeconds);
  const countdownText = firstString(countdown.text);
  const countdownConfidence = pickNumber(countdown.confidence);
  const remainingCount = asRecord(buffDuration.remainingCount);
  const rawRemainingCount = pickNumber(
    remainingCount.count,
    asRecord(sampleNode.result).value,
  );
  const remainingCountText = firstString(remainingCount.text);
  const remainingCountConfidence = pickNumber(remainingCount.confidence);
  const target = getSkillBuffDurationTargetForPresetId(config.presetId);
  const isRemainingCountMode =
    target?.valueKind === "remaining-count" ||
    firstString(remainingCount.format) === "remaining-count";
  const latestTrace = getLastSkillTraceSample(skillNode);
  const remainingCountFlowDecision = firstString(latestTrace.remainingCountDecision);
  const remainingCountExpectedMin = pickNumber(latestTrace.remainingCountExpectedMin);
  const remainingCountExpectedMax = pickNumber(latestTrace.remainingCountExpectedMax);
  const targetSkillId = firstString(buffDuration.targetSkillId);
  const targetDisplayName = getSkillTargetDisplayName(config, buffDuration);
  const matcherDecision = firstString(
    buffDuration.decisionReason,
    bestCandidateMatch.decisionReason,
  );
  const baseSkillId = firstString(buffDuration.baseSkillId, bestCandidateMatch.baseSkillId);
  const gateScore = pickNumber(buffDuration.gateScore, bestCandidateMatch.gateScore);
  const gateThreshold = pickNumber(
    buffDuration.gateThreshold,
    bestCandidateMatch.gateThreshold,
  );
  const remainingSeconds = isRemainingCountMode
    ? null
    : getEstimatedRemainingSeconds(state, sampledAt);
  const initialDue =
    supported &&
    hasStream &&
    hasRegion &&
    (isRemainingCountMode
      ? shouldFireRemainingCountAlert(state, config)
      : shouldFireAlert(state, config, sampledAt));
  const repeatDue = supported && hasStream && hasRegion && shouldRepeatAlert(state, config, sampledAt);
  const shouldAlert = Boolean(initialDue || repeatDue);
  const decisionReason = isRemainingCountMode
    ? getSkillRemainingCountDecisionReason({
        supported,
        enabled: config.enabled,
        hasStream,
        hasRegion,
        candidateCount: candidateIcons.length,
        detected,
        rawRemainingCount,
        confirmedRemainingCount: state.observedRemainingCount,
        hasPendingDrop: state.pendingRemainingCountDrop !== null,
        hasPendingAlert: state.pendingRemainingCountAlert !== null,
        alreadyAlerted: state.alertedAt !== null,
        repeatDue,
        shouldAlert,
      })
    : getSkillBuffDurationDecisionReason({
        supported,
        enabled: config.enabled,
        hasStream,
        hasRegion,
        candidateCount: candidateIcons.length,
        detected,
        countdownSeconds,
        hasEstimatedSchedule: state.estimatedExpiresAt !== null,
        alreadyAlerted: state.alertedAt !== null,
        remainingSeconds,
        thresholdSeconds: config.alertThresholdSeconds,
        repeatDue,
        shouldAlert,
      });

  return createSimpleReplayResult({
    engine: "skill-buff-duration",
    supported,
    reason: supported ? null : "스킬 알림 샘플이 아니어서 현재 adapter를 실행하지 않았습니다.",
    sampledAt,
    status: state.status,
    shouldAlert,
    decisionReason,
    metrics: {
      skillName: config.name,
      presetId: config.presetId ?? null,
      presetLabel: getSkillPresetLabel(config),
      detectionSource: config.detectionSource ?? "buff-duration",
      detectionMode: "버프칸",
      countdownSource: config.countdownSource,
      countdownMode: getSkillCountdownSourceLabel(config),
      durationSeconds: config.durationSeconds,
      cooldownDurationSeconds: config.cooldownDurationSeconds ?? null,
      valueKind: isRemainingCountMode ? "remaining-count" : "countdown",
      targetSkillId,
      targetDisplayName,
      detected,
      boxCount,
      candidateCount: candidateIcons.length,
      detectedCount,
      displayStatus: firstString(buffDuration.displayStatus),
      displayLastSeenAt: pickTimestampOrNull(buffDuration.displayLastSeenAt),
      matcherEngine: firstString(buffDuration.matcherEngine, bestCandidateMatch.matcherEngine),
      bundleId: firstString(buffDuration.bundleId, bestCandidateMatch.bundleId),
      modelVersion: firstString(buffDuration.modelVersion, bestCandidateMatch.modelVersion),
      baseSkillId,
      rawSkillId: firstString(buffDuration.rawSkillId, bestCandidateMatch.rawSkillId),
      score: pickNumber(buffDuration.score, bestCandidateMatch.score),
      threshold: pickNumber(buffDuration.threshold, bestCandidateMatch.threshold),
      margin: pickNumber(buffDuration.margin, bestCandidateMatch.margin),
      gateScore,
      gateThreshold,
      gateMargin: pickNumber(buffDuration.gateMargin, bestCandidateMatch.gateMargin),
      matcherDecision,
      countdownSeconds,
      countdownText,
      countdownConfidence,
      countdownStatus: firstString(countdown.status),
      countdownModelStatus: firstString(buffDuration.countdownModelStatus),
      rawRemainingCount,
      remainingCountText,
      remainingCountConfidence,
      remainingCountModelStatus: firstString(buffDuration.remainingCountModelStatus),
      confirmedRemainingCount: state.observedRemainingCount,
      remainingCountFlowDecision,
      remainingCountExpectedMin,
      remainingCountExpectedMax,
      hasPendingRemainingCountDrop: state.pendingRemainingCountDrop !== null,
      hasPendingRemainingCountAlert: state.pendingRemainingCountAlert !== null,
      recognizerVersion: firstString(asRecord(sampleNode.result).recognizerVersion),
      performanceMs: pickNumber(buffDuration.performanceMs),
      remainingSeconds,
      alertThresholdSeconds: config.alertThresholdSeconds,
      alertInSeconds: isRemainingCountMode
        ? null
        : getSkillAlertInSeconds(state, config, sampledAt),
      alertInCount: isRemainingCountMode
        ? getSkillAlertInRemainingCount(state, config)
        : null,
      alertedAt: state.alertedAt,
      estimatedExpiresAt: state.estimatedExpiresAt,
    },
    causes: buildSkillBuffDurationCauses({
      supported,
      decisionReason,
      targetDisplayName,
      candidateCount: candidateIcons.length,
      detected,
      matcherDecision,
      baseSkillId,
      gateScore,
      gateThreshold,
      countdownSeconds,
      isRemainingCountMode,
      rawRemainingCount,
      confirmedRemainingCount: state.observedRemainingCount,
      remainingCountExpectedMin,
      remainingCountExpectedMax,
      pendingRemainingCountDrop: state.pendingRemainingCountDrop,
      pendingRemainingCountAlert: state.pendingRemainingCountAlert,
      remainingSeconds,
      thresholdSeconds: config.alertThresholdSeconds,
      shouldAlert,
      status: state.status,
    }),
  });
}

function buildSkillCauses({
  supported,
  decisionReason,
  remainingSeconds,
  thresholdSeconds,
  shouldAlert,
  status,
}: {
  supported: boolean;
  decisionReason: string;
  remainingSeconds: number | null;
  thresholdSeconds: number;
  shouldAlert: boolean;
  status: string;
}): DebugReplayCause[] {
  if (!supported) return unsupportedCauses("스킬 알림");
  if (shouldAlert) {
    return [
      {
        status: "fail",
        title: "현재 알림 대상",
        detail: "남은 시간이 알림 기준 이하라 현재 코드 기준 알림이 울려야 하는 상태입니다.",
      },
    ];
  }
  if (decisionReason === "already-alerted") {
    return [
      {
        status: "pass",
        title: "알림 처리 기록 있음",
        detail: "payload에 스킬 알림 조건을 처리한 시각이 있습니다. 실제 소리 재생 성공 여부는 별도 재생 기록으로 확인해야 합니다.",
      },
    ];
  }
  if (remainingSeconds === null) {
    return [
      {
        status: "warn",
        title: "남은 시간 없음",
        detail: "현재 state에서 남은 시간을 계산할 수 없습니다.",
      },
    ];
  }
  return [
    {
      status: "pass",
      title: "알림 기준 전",
      detail: `남은 시간 ${Math.round(remainingSeconds)}초, 알림 기준 ${thresholdSeconds}초입니다. 상태: ${status}`,
    },
  ];
}

function buildSkillBuffDurationCauses({
  supported,
  decisionReason,
  targetDisplayName,
  candidateCount,
  detected,
  matcherDecision,
  baseSkillId,
  gateScore,
  gateThreshold,
  countdownSeconds,
  isRemainingCountMode,
  rawRemainingCount,
  confirmedRemainingCount,
  remainingCountExpectedMin,
  remainingCountExpectedMax,
  pendingRemainingCountDrop,
  pendingRemainingCountAlert,
  remainingSeconds,
  thresholdSeconds,
  shouldAlert,
  status,
}: {
  supported: boolean;
  decisionReason: string;
  targetDisplayName: string;
  candidateCount: number;
  detected: boolean;
  matcherDecision: string | null;
  baseSkillId: string | null;
  gateScore: number | null;
  gateThreshold: number | null;
  countdownSeconds: number | null;
  isRemainingCountMode: boolean;
  rawRemainingCount: number | null;
  confirmedRemainingCount: number | null;
  remainingCountExpectedMin: number | null;
  remainingCountExpectedMax: number | null;
  pendingRemainingCountDrop: SkillRuntimeState["pendingRemainingCountDrop"];
  pendingRemainingCountAlert: SkillRuntimeState["pendingRemainingCountAlert"];
  remainingSeconds: number | null;
  thresholdSeconds: number;
  shouldAlert: boolean;
  status: string;
}): DebugReplayCause[] {
  if (!supported) return unsupportedCauses("스킬 버프칸 알림");
  if (shouldAlert) {
    return [
      {
        status: "fail",
        title: "현재 알림 대상",
        detail: "저장된 버프칸 runtime 상태 기준으로 알림 조건에 도달했습니다.",
      },
    ];
  }
  if (decisionReason === "already-alerted") {
    return [
      {
        status: "pass",
        title: "알림 처리 기록 있음",
        detail: "payload에 버프칸 스킬 알림 조건을 처리한 시각이 있습니다. 실제 소리 재생 성공 여부는 별도 재생 기록으로 확인해야 합니다.",
      },
    ];
  }
  if (candidateCount <= 0) {
    return [
      {
        status: "warn",
        title: "버프칸 후보 없음",
        detail: "parser가 저장한 후보 아이콘이 없어 matcher/숫자 판독을 재검토하기 어렵습니다.",
      },
    ];
  }
  if (!detected) {
    if (matcherDecision === "positive_gate_below_threshold") {
      return [
        {
          status: "warn",
          title: `${targetDisplayName} 아이콘 형태 검증 미통과`,
          detail: `${formatMatcherGateEvidence(gateScore, gateThreshold)}1차 분류는 대상을 선택했지만 최종 형태 검증 기준을 넘지 못했습니다.`,
        },
      ];
    }
    if (matcherDecision === "base_target_disabled") {
      return [
        {
          status: "warn",
          title: "다른 비활성 스킬을 우선 판정함",
          detail: `1차 분류가 ${baseSkillId ?? "다른 스킬"}을 선택해 현재 대상의 대체 판정을 막았습니다.`,
        },
      ];
    }
    if (matcherDecision === "cross_bundle_conflict") {
      return [
        {
          status: "warn",
          title: "스킬 모델 간 판정 충돌",
          detail: "서로 다른 matcher 번들이 같은 아이콘을 동시에 통과시켜 오감지를 막기 위해 대상을 확정하지 않았습니다.",
        },
      ];
    }
    return [
      {
        status: "warn",
        title: `${targetDisplayName} matcher 미확정`,
        detail: `버프칸 후보는 있지만 ${targetDisplayName} 아이콘으로 확정되지 않았습니다. 후보 이미지와 matcher 점수를 비교해야 합니다.`,
      },
    ];
  }
  if (isRemainingCountMode) {
    if (pendingRemainingCountDrop) {
      return [
        {
          status: "warn",
          title: "불가능한 횟수 변화를 보류함",
          detail: `원시 판독 ${rawRemainingCount ?? pendingRemainingCountDrop.observedRemainingCount}회는 확정값 ${confirmedRemainingCount ?? pendingRemainingCountDrop.fromRemainingCount}회에서 도달 가능한 범위 ${formatRemainingCountRange(remainingCountExpectedMin, remainingCountExpectedMax)}를 벗어나 알림에 사용하지 않았습니다.`,
        },
      ];
    }
    if (pendingRemainingCountAlert) {
      return [
        {
          status: "warn",
          title: "알림 기준 재확인 중",
          detail: `확정값 ${confirmedRemainingCount ?? pendingRemainingCountAlert.observedRemainingCount}회가 알림 기준 ${thresholdSeconds}회 이하에 들어와 다음 정상 판독을 기다리고 있습니다.`,
        },
      ];
    }
    if (confirmedRemainingCount === null) {
      return [
        {
          status: "warn",
          title: "남은 횟수 미확정",
          detail: `${targetDisplayName} 아이콘은 찾았지만 알림에 사용할 남은 횟수를 확정하지 못했습니다.`,
        },
      ];
    }
    return [
      {
        status: "pass",
        title: "알림 기준 전",
        detail: `확정 횟수 ${confirmedRemainingCount}회, 알림 기준 ${thresholdSeconds}회입니다. 상태: ${status}`,
      },
    ];
  }
  if (countdownSeconds === null) {
    return [
      {
        status: "warn",
        title: "숫자 판독 없음",
        detail: `${targetDisplayName} 아이콘은 찾았지만 남은 시간 숫자를 확정하지 못했습니다.`,
      },
    ];
  }
  if (remainingSeconds === null) {
    return [
      {
        status: "warn",
        title: "종료 시각 미확정",
        detail: "숫자 판독은 있으나 runtime 상태에서 종료 시각을 계산할 수 없습니다.",
      },
    ];
  }
  return [
    {
      status: "pass",
      title: "알림 기준 전",
      detail: `남은 시간 ${Math.round(remainingSeconds)}초, 알림 기준 ${thresholdSeconds}초입니다. 상태: ${status}`,
    },
  ];
}

function formatRemainingCountRange(min: number | null, max: number | null): string {
  if (min === null || max === null) {
    return "미확정";
  }
  return `${min}~${max}회`;
}

function formatMatcherGateEvidence(
  score: number | null,
  threshold: number | null,
): string {
  if (score === null || threshold === null) {
    return "";
  }
  return `형태 점수 ${score.toFixed(3)}, 기준 ${threshold.toFixed(3)}. `;
}

function getSkillDecisionReason({
  supported,
  enabled,
  hasStream,
  hasRegion,
  alreadyAlerted,
  remainingSeconds,
  thresholdSeconds,
  repeatDue,
  shouldAlert,
}: {
  supported: boolean;
  enabled: boolean;
  hasStream: boolean;
  hasRegion: boolean;
  alreadyAlerted: boolean;
  remainingSeconds: number | null;
  thresholdSeconds: number;
  repeatDue: boolean;
  shouldAlert: boolean;
}) {
  if (!supported) return "unsupported";
  if (!enabled) return "disabled";
  if (!hasStream) return "no-stream";
  if (!hasRegion) return "no-region";
  if (repeatDue) return "repeat-due";
  if (alreadyAlerted) return "already-alerted";
  if (remainingSeconds === null) return "no-remaining";
  if (shouldAlert) return "due-now";
  if (remainingSeconds > thresholdSeconds) return "scheduled-future";
  return "waiting";
}

function getSkillRemainingCountDecisionReason({
  supported,
  enabled,
  hasStream,
  hasRegion,
  candidateCount,
  detected,
  rawRemainingCount,
  confirmedRemainingCount,
  hasPendingDrop,
  hasPendingAlert,
  alreadyAlerted,
  repeatDue,
  shouldAlert,
}: {
  supported: boolean;
  enabled: boolean;
  hasStream: boolean;
  hasRegion: boolean;
  candidateCount: number;
  detected: boolean;
  rawRemainingCount: number | null;
  confirmedRemainingCount: number | null;
  hasPendingDrop: boolean;
  hasPendingAlert: boolean;
  alreadyAlerted: boolean;
  repeatDue: boolean;
  shouldAlert: boolean;
}) {
  if (!supported) return "unsupported";
  if (!enabled) return "disabled";
  if (!hasStream) return "no-stream";
  if (!hasRegion) return "no-buff-slot-input";
  if (candidateCount <= 0) return "no-candidates";
  if (!detected) return "no-target-match";
  if (repeatDue) return "repeat-due";
  if (alreadyAlerted) return "already-alerted";
  if (hasPendingDrop) return "implausible-count-drop";
  if (rawRemainingCount === null && confirmedRemainingCount === null) {
    return "no-remaining-count";
  }
  if (hasPendingAlert) return "count-alert-confirming";
  if (shouldAlert) return "due-now";
  if (confirmedRemainingCount === null) return "no-confirmed-count";
  return "scheduled-count";
}

function getSkillBuffDurationDecisionReason({
  supported,
  enabled,
  hasStream,
  hasRegion,
  candidateCount,
  detected,
  countdownSeconds,
  hasEstimatedSchedule,
  alreadyAlerted,
  remainingSeconds,
  thresholdSeconds,
  repeatDue,
  shouldAlert,
}: {
  supported: boolean;
  enabled: boolean;
  hasStream: boolean;
  hasRegion: boolean;
  candidateCount: number;
  detected: boolean;
  countdownSeconds: number | null;
  hasEstimatedSchedule: boolean;
  alreadyAlerted: boolean;
  remainingSeconds: number | null;
  thresholdSeconds: number;
  repeatDue: boolean;
  shouldAlert: boolean;
}) {
  if (!supported) return "unsupported";
  if (!enabled) return "disabled";
  if (!hasStream) return "no-stream";
  if (!hasRegion) return "no-buff-slot-input";
  if (candidateCount <= 0) return "no-candidates";
  if (!detected) return "no-target-match";
  if (countdownSeconds === null && !hasEstimatedSchedule) return "no-countdown";
  if (repeatDue) return "repeat-due";
  if (alreadyAlerted) return "already-alerted";
  if (remainingSeconds === null) return "no-remaining";
  if (shouldAlert) return "due-now";
  if (remainingSeconds > thresholdSeconds) return "scheduled-future";
  return "waiting";
}

function getSkillPresetLabel(config: SkillConfig): string {
  const presetId = typeof config.presetId === "string" ? config.presetId : "";
  return firstString(SKILL_PRESET_LABELS[presetId], config.name, presetId) ?? "스킬";
}

function getSkillDetectionSourceLabel(config: SkillConfig): string {
  return config.detectionSource === "buff-duration" ? "버프칸" : "퀵슬롯";
}

function getSkillCountdownSourceLabel(config: SkillConfig): string {
  return config.countdownSource === "cooldown" ? "쿨타임 기준" : "남은 시간 기준";
}

function getSkillTargetDisplayName(
  config: SkillConfig,
  buffDuration: UnknownRecord,
): string {
  return firstString(buffDuration.targetDisplayName, getSkillPresetLabel(config)) ?? "대상 스킬";
}

function getLastSkillTraceSample(skillNode: UnknownRecord): UnknownRecord {
  const samples = asRecord(skillNode.runtimeTimeline).samples;
  if (!Array.isArray(samples) || samples.length === 0) {
    return {};
  }
  return asRecord(samples[samples.length - 1]);
}

function buildSkillConfig(config: UnknownRecord): SkillConfig {
  return {
    id: String(config.id ?? "debug-skill"),
    name: String(config.name ?? "스킬"),
    presetId: config.presetId as SkillConfig["presetId"],
    detectionSource: (config.detectionSource ?? "quickslot") as SkillConfig["detectionSource"],
    countdownSource: (config.countdownSource ?? "duration") as SkillConfig["countdownSource"],
    durationSeconds: pickPositiveNumber(config.durationSeconds, 60) ?? 60,
    cooldownDurationSeconds: pickPositiveNumber(config.cooldownDurationSeconds) ?? undefined,
    alertThresholdSeconds: pickNumber(config.alertThresholdSeconds) ?? 10,
    recognitionStartSeconds: pickPositiveNumber(config.recognitionStartSeconds, 20) ?? 20,
    region: null,
    regionsByLayout: {},
    recognitionMode: (config.recognitionMode ?? "hybrid") as SkillConfig["recognitionMode"],
    soundId: String(config.soundId ?? ""),
    volume: pickPositiveNumber(config.volume, 100) ?? 100,
    repeatAlertEnabled: Boolean(config.repeatAlertEnabled),
    repeatAlertIntervalSeconds: pickPositiveNumber(config.repeatAlertIntervalSeconds) ?? undefined,
    repeatAlertMaxCount: pickPositiveNumber(config.repeatAlertMaxCount) ?? null,
    enabled: config.enabled !== false,
  };
}

function buildSkillRuntimeState(state: UnknownRecord, skillId: unknown): SkillRuntimeState {
  return {
    skillId: String(skillId ?? state.skillId ?? "debug-skill"),
    observedRemainingSeconds: pickNumber(state.observedRemainingSeconds),
    observedAt: pickTimestampOrNull(state.observedAt),
    observedRemainingCount: pickNumber(state.observedRemainingCount),
    countObservedAt: pickTimestampOrNull(state.countObservedAt),
    estimatedExpiresAt: pickTimestampOrNull(state.estimatedExpiresAt),
    confidence: pickNumber(state.confidence) ?? 0,
    status: (firstString(state.status) ?? "idle") as SkillRuntimeState["status"],
    alertedAt: pickTimestampOrNull(state.alertedAt),
    lastRepeatedAlertAt: pickTimestampOrNull(state.lastRepeatedAlertAt),
    repeatedAlertCount: pickNumber(state.repeatedAlertCount) ?? 0,
    lastAlertCycleStartedAt: pickTimestampOrNull(state.lastAlertCycleStartedAt),
    initialAlertDelaySeconds: pickNumber(state.initialAlertDelaySeconds),
    initialAlertDelayCycleStartedAt: pickTimestampOrNull(
      state.initialAlertDelayCycleStartedAt,
    ),
    rejectedReading: pickNumber(state.rejectedReading),
    effectiveCooldownDurationSeconds: pickNumber(state.effectiveCooldownDurationSeconds),
    pendingShortAnchor: asPendingShortAnchor(state.pendingShortAnchor),
    pendingRemainingCountIncrease: asPendingRemainingCountIncrease(
      state.pendingRemainingCountIncrease,
    ),
    pendingRemainingCountDrop: asPendingRemainingCountDrop(
      state.pendingRemainingCountDrop,
    ),
    pendingRemainingCountAlert: asPendingRemainingCountAlert(
      state.pendingRemainingCountAlert,
    ),
    buffDurationCountdownMissingSinceAt: pickTimestampOrNull(
      state.buffDurationCountdownMissingSinceAt,
    ),
    buffDurationTimingEvent: asBuffDurationTimingEvent(state.buffDurationTimingEvent),
  };
}

function asPendingShortAnchor(value: unknown): SkillRuntimeState["pendingShortAnchor"] {
  const item = asRecord(value);
  const observedRemainingSeconds = pickNumber(item.observedRemainingSeconds);
  const maxObservedRemainingSeconds = pickNumber(item.maxObservedRemainingSeconds);
  const observedAt = pickTimestampOrNull(item.observedAt);
  const estimatedExpiresAt = pickTimestampOrNull(item.estimatedExpiresAt);
  const count = pickPositiveNumber(item.count);
  if (
    observedRemainingSeconds === null ||
    maxObservedRemainingSeconds === null ||
    observedAt === null ||
    estimatedExpiresAt === null ||
    count === null
  ) {
    return null;
  }
  return { observedRemainingSeconds, maxObservedRemainingSeconds, observedAt, estimatedExpiresAt, count };
}

function asPendingRemainingCountIncrease(
  value: unknown,
): SkillRuntimeState["pendingRemainingCountIncrease"] {
  const item = asRecord(value);
  const observedRemainingCount = pickNumber(item.observedRemainingCount);
  const observedAt = pickTimestampOrNull(item.observedAt);
  const count = pickPositiveNumber(item.count);
  if (observedRemainingCount === null || observedAt === null || count === null) {
    return null;
  }
  return { observedRemainingCount, observedAt, count };
}

function asPendingRemainingCountDrop(
  value: unknown,
): SkillRuntimeState["pendingRemainingCountDrop"] {
  const item = asRecord(value);
  const observedRemainingCount = pickNumber(item.observedRemainingCount);
  const observedAt = pickTimestampOrNull(item.observedAt);
  const lastObservedAt = pickTimestampOrNull(item.lastObservedAt);
  const count = pickPositiveNumber(item.count);
  const fromRemainingCount = pickNumber(item.fromRemainingCount);
  const minReachableCount = pickNumber(item.minReachableCount);
  if (
    observedRemainingCount === null ||
    observedAt === null ||
    lastObservedAt === null ||
    count === null ||
    fromRemainingCount === null ||
    minReachableCount === null
  ) {
    return null;
  }
  return {
    observedRemainingCount,
    observedAt,
    lastObservedAt,
    count,
    fromRemainingCount,
    minReachableCount,
  };
}

function asPendingRemainingCountAlert(
  value: unknown,
): SkillRuntimeState["pendingRemainingCountAlert"] {
  const item = asRecord(value);
  const observedRemainingCount = pickNumber(item.observedRemainingCount);
  const observedAt = pickTimestampOrNull(item.observedAt);
  const count = pickPositiveNumber(item.count);
  if (observedRemainingCount === null || observedAt === null || count === null) {
    return null;
  }
  return { observedRemainingCount, observedAt, count };
}

function asBuffDurationTimingEvent(value: unknown): SkillRuntimeState["buffDurationTimingEvent"] {
  const item = asRecord(value);
  const type = firstString(item.type);
  const occurredAt = pickTimestampOrNull(item.occurredAt);
  if (type !== "extended" || occurredAt === null) {
    return null;
  }
  return { type, occurredAt };
}
