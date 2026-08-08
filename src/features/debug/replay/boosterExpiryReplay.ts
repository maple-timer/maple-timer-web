import type {
  BoosterExpiryReadDecision,
  BoosterExpiryRuntimeStatus,
  BoosterExpiryRuntimeTraceFrame,
  BoosterExpiryTimerEvidence,
} from "../../../lib/boosterExpiry/boosterExpiryTypes";
import type { DebugReplayCause, DebugReplayStatus } from "./buffExpiryPrecisionReplay";

export type BoosterExpiryReplayResult = {
  engine: "booster-expiry";
  supported: boolean;
  reason: string | null;
  alertLeadSeconds: number | null;
  sampledAt: number;
  status: BoosterExpiryRuntimeStatus | "unknown";
  confirmedExpiresAt: number | null;
  alertAt: number | null;
  alertedAt: number | null;
  secondsUntilAlert: number | null;
  secondsUntilExpiry: number | null;
  remainingSeconds: number | null;
  rawRemainingSeconds: number | null;
  flowSource: string | null;
  locked: boolean;
  traceFrameCount: number;
  timerEvidenceCount: number;
  confirmationEvidenceCount: number;
  dueDecision: {
    shouldAlert: boolean;
    reason:
      | "unsupported"
      | "disabled"
      | "no-stream"
      | "no-confirmed-schedule"
      | "scheduled-future"
      | "due-now"
      | "overdue"
      | "already-alerted"
      | "expired-without-alert"
      | "schedule-lost";
    scheduleSource: "state" | "trace" | "none";
  };
  causes: DebugReplayCause[];
};

type UnknownRecord = Record<string, unknown>;

type AnalyzeOptions = {
  now?: number;
};

export function analyzeBoosterExpiryReplaySample(
  sample: unknown,
  options: AnalyzeOptions = {},
): BoosterExpiryReplayResult {
  const body = getSampleBody(sample);
  const booster = asRecord(body.boosterExpiry);
  const config = asRecord(booster.config);
  const state = asRecord(booster.state);
  const lastSnapshot = asRecord(booster.lastSnapshot);
  const sampleNode = asRecord(body.sample);
  const result = asRecord(sampleNode.result);
  const supported = Boolean(booster.config || booster.state || body.kind === "booster-expiry-issue");
  const trace = normalizeTraceFrames(firstArray(lastSnapshot.runtimeTrace, state.runtimeTrace, sampleNode.runtimeTrace));
  const timerEvidence = normalizeTimerEvidence(firstArray(lastSnapshot.timerEvidence, sampleNode.timerEvidence));
  const confirmationEvidence = normalizeTimerEvidence(
    firstArray(lastSnapshot.confirmationEvidence, sampleNode.confirmationEvidence),
  );
  const latestTrace = getLatestBySampledAt(trace);
  const latestEvidence = getLatestBySampledAt(timerEvidence);
  const sampledAt = pickTimestamp(
    options.now,
    sampleNode.sampledAt,
    state.lastSampledAt,
    lastSnapshot.sampledAt,
    latestTrace?.sampledAt,
    latestEvidence?.sampledAt,
    body.submittedAt,
    body.createdAt,
    asRecord(sample).createdAt,
  );
  const alertLeadSeconds = pickPositiveNumber(config.alertLeadSeconds, result.alertLeadSeconds, 10);
  const scheduleFromState = pickTimestampOrNull(state.confirmedExpiresAt, state.estimatedExpiresAt);
  const scheduleFromTrace = pickTimestampOrNull(latestTrace?.confirmedExpiresAt, latestTrace?.estimatedExpiresAt);
  const confirmedExpiresAt = scheduleFromState ?? scheduleFromTrace;
  const alertAt =
    pickTimestampOrNull(state.alertAt, latestTrace?.alertAt) ??
    (confirmedExpiresAt !== null ? confirmedExpiresAt - alertLeadSeconds * 1000 : null);
  const alertedAt = pickTimestampOrNull(
    state.alertedAt,
    latestTrace?.alerted ? latestTrace.sampledAt : null,
    findLatestAlertedTrace(trace)?.sampledAt,
    findLatestAlertedEvidence(timerEvidence)?.sampledAt,
  );
  const status = (firstString(state.status, latestTrace?.status) ?? "unknown") as BoosterExpiryReplayResult["status"];
  const remainingSeconds = pickNumber(state.remainingSeconds, latestTrace?.remainingSeconds, result.value);
  const rawRemainingSeconds = pickNumber(state.rawRemainingSeconds, latestTrace?.rawRemainingSeconds);
  const flowSource = firstString(state.flowSource, latestTrace?.flowSource, asRecord(lastSnapshot.flow).source);
  const locked = Boolean(state.locked ?? latestTrace?.locked ?? asRecord(lastSnapshot.flow).locked);
  const scheduleSource = scheduleFromState !== null ? "state" : scheduleFromTrace !== null ? "trace" : "none";
  const secondsUntilAlert = alertAt !== null ? Math.ceil((alertAt - sampledAt) / 1000) : null;
  const secondsUntilExpiry =
    confirmedExpiresAt !== null ? Math.ceil((confirmedExpiresAt - sampledAt) / 1000) : null;
  const dueDecision = buildDueDecision({
    supported,
    enabled: config.enabled !== false,
    hasStream: asRecord(body.diagnostics).capture
      ? Boolean(asRecord(asRecord(body.diagnostics).capture).hasStream)
      : true,
    status,
    sampledAt,
    confirmedExpiresAt,
    alertAt,
    alertedAt,
    scheduleSource,
  });

  return {
    engine: "booster-expiry",
    supported,
    reason: supported ? null : "부스터 종료 알림 샘플이 아니어서 현재 adapter를 실행하지 않았습니다.",
    alertLeadSeconds,
    sampledAt,
    status,
    confirmedExpiresAt,
    alertAt,
    alertedAt,
    secondsUntilAlert,
    secondsUntilExpiry,
    remainingSeconds,
    rawRemainingSeconds,
    flowSource,
    locked,
    traceFrameCount: trace.length,
    timerEvidenceCount: timerEvidence.length,
    confirmationEvidenceCount: confirmationEvidence.length,
    dueDecision,
    causes: buildCauses({
      supported,
      dueDecision,
      status,
      flowSource,
      locked,
      confirmedExpiresAt,
      alertAt,
      alertedAt,
      secondsUntilAlert,
      secondsUntilExpiry,
      traceFrameCount: trace.length,
      timerEvidenceCount: timerEvidence.length,
      confirmationEvidenceCount: confirmationEvidence.length,
      cycleCandidateObservationCount: pickPositiveNumber(
        state.cycleCandidateObservationCount,
        latestTrace?.cycleCandidateObservationCount,
        0,
      ),
      confirmedContradictionCount: pickPositiveNumber(
        state.confirmedContradictionCount,
        latestTrace?.confirmedContradictionCount,
        0,
      ),
    }),
  };
}

function buildDueDecision({
  supported,
  enabled,
  hasStream,
  status,
  sampledAt,
  confirmedExpiresAt,
  alertAt,
  alertedAt,
  scheduleSource,
}: {
  supported: boolean;
  enabled: boolean;
  hasStream: boolean;
  status: BoosterExpiryReplayResult["status"];
  sampledAt: number;
  confirmedExpiresAt: number | null;
  alertAt: number | null;
  alertedAt: number | null;
  scheduleSource: BoosterExpiryReplayResult["dueDecision"]["scheduleSource"];
}): BoosterExpiryReplayResult["dueDecision"] {
  if (!supported) {
    return { shouldAlert: false, reason: "unsupported", scheduleSource };
  }
  if (!enabled) {
    return { shouldAlert: false, reason: "disabled", scheduleSource };
  }
  if (!hasStream || status === "no-stream") {
    return { shouldAlert: false, reason: "no-stream", scheduleSource };
  }
  if (status === "lost") {
    return { shouldAlert: false, reason: "schedule-lost", scheduleSource };
  }
  if (confirmedExpiresAt === null || alertAt === null) {
    return { shouldAlert: false, reason: "no-confirmed-schedule", scheduleSource };
  }
  if (alertedAt !== null) {
    return { shouldAlert: false, reason: "already-alerted", scheduleSource };
  }
  if (sampledAt >= confirmedExpiresAt) {
    return { shouldAlert: true, reason: "expired-without-alert", scheduleSource };
  }
  if (sampledAt >= alertAt) {
    return {
      shouldAlert: true,
      reason: sampledAt - alertAt > 2000 ? "overdue" : "due-now",
      scheduleSource,
    };
  }
  return { shouldAlert: false, reason: "scheduled-future", scheduleSource };
}

function buildCauses({
  supported,
  dueDecision,
  status,
  flowSource,
  locked,
  confirmedExpiresAt,
  alertAt,
  alertedAt,
  secondsUntilAlert,
  secondsUntilExpiry,
  traceFrameCount,
  timerEvidenceCount,
  confirmationEvidenceCount,
  cycleCandidateObservationCount,
  confirmedContradictionCount,
}: {
  supported: boolean;
  dueDecision: BoosterExpiryReplayResult["dueDecision"];
  status: BoosterExpiryReplayResult["status"];
  flowSource: string | null;
  locked: boolean;
  confirmedExpiresAt: number | null;
  alertAt: number | null;
  alertedAt: number | null;
  secondsUntilAlert: number | null;
  secondsUntilExpiry: number | null;
  traceFrameCount: number;
  timerEvidenceCount: number;
  confirmationEvidenceCount: number;
  cycleCandidateObservationCount: number;
  confirmedContradictionCount: number;
}): DebugReplayCause[] {
  if (!supported) {
    return [
      {
        status: "info",
        title: "부스터 종료 샘플 아님",
        detail: "다른 알림 유형은 별도 replay adapter가 필요합니다.",
      },
    ];
  }

  const causes: DebugReplayCause[] = [];
  if (dueDecision.reason === "already-alerted") {
    causes.push({
      status: "pass",
      title: "알림 처리 기록 있음",
      detail: alertedAt !== null
        ? `payload상 ${formatRelativeMs(alertedAt, "알림 시각")}에 알림 조건을 처리했습니다. 실제 소리 재생 성공 여부는 별도 재생 기록으로 확인해야 합니다.`
        : "payload에 알림 처리 기록이 있습니다. 실제 소리 재생 성공 여부는 별도 재생 기록으로 확인해야 합니다.",
    });
  } else if (dueDecision.reason === "scheduled-future") {
    causes.push({
      status: "pass",
      title: "알림 예정",
      detail: `현재 코드 기준 알림까지 ${formatNullableSeconds(secondsUntilAlert)} 남았습니다.`,
    });
  } else if (dueDecision.reason === "due-now" || dueDecision.reason === "overdue") {
    causes.push({
      status: "fail",
      title: dueDecision.reason === "overdue" ? "알림 시각 지남" : "현재 알림 대상",
      detail: "확정 종료시각과 알림 기준을 적용하면 현재 코드 기준 알림이 울려야 하는 상태입니다.",
    });
  } else if (dueDecision.reason === "expired-without-alert") {
    causes.push({
      status: "fail",
      title: "종료시각 이후까지 미알림",
      detail: "확정 종료시각이 이미 지났는데 payload에는 알림 완료 시각이 없습니다.",
    });
  } else if (dueDecision.reason === "no-confirmed-schedule") {
    causes.push({
      status: timerEvidenceCount > 0 ? "warn" : "fail",
      title: "확정 종료시각 없음",
      detail:
        timerEvidenceCount > 0
          ? `타이머 증거 ${timerEvidenceCount}개가 있지만 충분한 60초 이상 흐름으로 확정하지 못했습니다.`
          : "타이머 증거가 없어 알림 시각을 계산할 수 없습니다.",
    });
  } else if (dueDecision.reason === "schedule-lost") {
    causes.push({
      status: "warn",
      title: "스케줄 유실",
      detail: "확정된 부스터 타이머가 이후 관측과 충돌하거나 오래 지원되지 않아 취소된 상태입니다.",
    });
  } else if (dueDecision.reason === "disabled" || dueDecision.reason === "no-stream") {
    causes.push({
      status: "info",
      title: dueDecision.reason === "disabled" ? "알림 꺼짐" : "화면 공유 없음",
      detail: "이 상태에서는 부스터 종료 알림을 재생하지 않습니다.",
    });
  }

  if (confirmedExpiresAt !== null && alertAt !== null) {
    causes.push({
      status: "info",
      title: "확정 스케줄",
      detail: `종료까지 ${formatNullableSeconds(secondsUntilExpiry)}, 알림까지 ${formatNullableSeconds(secondsUntilAlert)}입니다.`,
    });
  }

  if (cycleCandidateObservationCount > 0 && confirmedExpiresAt === null) {
    causes.push({
      status: "info",
      title: "시간 확인 중",
      detail: `${cycleCandidateObservationCount}개 관측으로 새 부스터 타이머인지 확인하는 중입니다.`,
    });
  }

  if (confirmationEvidenceCount > 0) {
    causes.push({
      status: "pass",
      title: "확정 근거 있음",
      detail: `${confirmationEvidenceCount}개 확정 근거 프레임이 payload에 보관되어 있습니다.`,
    });
  }

  if (traceFrameCount > 0) {
    causes.push({
      status: "info",
      title: "상태 전환 trace 있음",
      detail: `${traceFrameCount}개 trace로 제보 전후 상태 전환을 확인할 수 있습니다.`,
    });
  }

  if (flowSource === "predicted-rejected-raw" || flowSource === "raw-reset-pending") {
    causes.push({
      status: "warn",
      title: "흐름 보정 충돌",
      detail: `${flowSource} 상태라 raw 판독과 예측 흐름이 충돌했을 가능성이 있습니다.`,
    });
  } else if (locked) {
    causes.push({
      status: "info",
      title: "흐름 보정 잠김",
      detail: "타이머 흐름이 확정되어 일부 raw 판독은 보정값으로 대체될 수 있습니다.",
    });
  }

  return causes.length
    ? causes
    : [
        {
          status: "info",
          title: "명확한 부스터 원인 없음",
          detail: "저장된 상태와 evidence만으로는 알림 누락/오작동 원인을 확정하기 어렵습니다.",
        },
      ];
}

function normalizeTraceFrames(values: unknown[]): BoosterExpiryRuntimeTraceFrame[] {
  const frames: BoosterExpiryRuntimeTraceFrame[] = [];
  for (const value of values) {
    const item = asRecord(value);
    const sampledAt = pickTimestampOrNull(item.sampledAt);
    if (sampledAt === null) {
      continue;
    }
    frames.push({
      sampledAt,
      status: (firstString(item.status) ?? "waiting") as BoosterExpiryRuntimeStatus,
      rawText: firstString(item.rawText),
      displayText: firstString(item.displayText),
      rawRemainingSeconds: pickNumber(item.rawRemainingSeconds),
      remainingSeconds: pickNumber(item.remainingSeconds),
      estimatedExpiresAt: pickTimestampOrNull(item.estimatedExpiresAt),
      alertAt: pickTimestampOrNull(item.alertAt),
      cycleCandidateObservationCount: pickPositiveNumber(item.cycleCandidateObservationCount, 0),
      cycleCandidateDecreaseSeconds: pickNumber(item.cycleCandidateDecreaseSeconds),
      confirmedAt: pickTimestampOrNull(item.confirmedAt),
      confirmedExpiresAt: pickTimestampOrNull(item.confirmedExpiresAt),
      confirmedLastSupportedAt: pickTimestampOrNull(item.confirmedLastSupportedAt),
      confirmedContradictionCount: pickPositiveNumber(item.confirmedContradictionCount, 0),
      alerted: Boolean(item.alerted),
      flowSource: firstString(item.flowSource),
      locked: Boolean(item.locked),
      decision: (firstString(item.decision) ?? "timer-waiting") as BoosterExpiryReadDecision,
      rect: null,
      performance: null,
    });
  }
  return frames.sort((left, right) => left.sampledAt - right.sampledAt);
}

function normalizeTimerEvidence(values: unknown[]): BoosterExpiryTimerEvidence[] {
  const evidenceItems: BoosterExpiryTimerEvidence[] = [];
  for (const value of values) {
    const item = asRecord(value);
    const sampledAt = pickTimestampOrNull(item.sampledAt);
    if (sampledAt === null) {
      continue;
    }
    evidenceItems.push({
      sampledAt,
      eventType: firstString(item.eventType) as BoosterExpiryTimerEvidence["eventType"],
      dataUrl: firstString(item.dataUrl),
      rect: null,
      rawText: firstString(item.rawText),
      displayText: firstString(item.displayText),
      rawRemainingSeconds: pickNumber(item.rawRemainingSeconds),
      remainingSeconds: pickNumber(item.remainingSeconds),
      predictedExpiresAt: pickTimestampOrNull(item.predictedExpiresAt),
      confirmedExpiresAt: pickTimestampOrNull(item.confirmedExpiresAt),
      alertAt: pickTimestampOrNull(item.alertAt),
      flowSource: firstString(item.flowSource),
      locked: Boolean(item.locked),
      decision: (firstString(item.decision) ?? "timer-waiting") as BoosterExpiryReadDecision,
      format: firstString(item.format) as BoosterExpiryTimerEvidence["format"],
      selectedBy: firstString(item.selectedBy),
    });
  }
  return evidenceItems.sort((left, right) => left.sampledAt - right.sampledAt);
}

function getLatestBySampledAt<T extends { sampledAt: number }>(values: T[]): T | null {
  return values.length ? values[values.length - 1] : null;
}

function findLatestAlertedTrace(values: BoosterExpiryRuntimeTraceFrame[]): BoosterExpiryRuntimeTraceFrame | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index].alerted || values[index].decision === "alerted") {
      return values[index];
    }
  }
  return null;
}

function findLatestAlertedEvidence(values: BoosterExpiryTimerEvidence[]): BoosterExpiryTimerEvidence | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index].eventType === "alerted" || values[index].decision === "alerted") {
      return values[index];
    }
  }
  return null;
}

function getSampleBody(sample: unknown): UnknownRecord {
  const record = asRecord(sample);
  const body = asRecord(record.body);
  return Object.keys(body).length ? body : record;
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function pickPositiveNumber(...values: unknown[]): number {
  const numeric = pickNumber(...values);
  return numeric !== null && numeric >= 0 ? numeric : 0;
}

function pickTimestamp(...values: unknown[]): number {
  return pickTimestampOrNull(...values) ?? Date.now();
}

function pickTimestampOrNull(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
  }
  return null;
}

function formatNullableSeconds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "없음";
  }
  return `${Math.max(0, Math.round(value))}초`;
}

function formatRelativeMs(value: number, fallback: string): string {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return new Date(value).toISOString();
}
