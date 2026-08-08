import type {
  BuffExpiryBox,
  BuffExpiryPendingTrack,
  BuffExpiryTrackedBuff,
} from "../../../domain/buff-expiry/precisionTrackingTypes";
import {
  getBuffExpiryPrecisionAlertClusters,
  markDueBuffExpiryPrecisionClustersAlerted,
} from "../../../domain/buff-expiry/precisionAlertClusters";

export type DebugReplayStatus = "pass" | "warn" | "fail" | "info";

export type DebugReplayCause = {
  status: DebugReplayStatus;
  title: string;
  detail: string;
};

export type BuffExpiryPrecisionReplayCluster = {
  id: string;
  dueAt: number;
  minExpiresAt: number;
  maxExpiresAt: number;
  trackCount: number;
  trackNames: string[];
  remainingSecondsUntilAlert: number;
};

export type BuffExpiryPrecisionReplayResult = {
  engine: "buff-expiry-precision";
  supported: boolean;
  reason: string | null;
  alertLeadSeconds: number | null;
  sampledAt: number;
  trackCount: number;
  pendingTrackCount: number;
  clusters: BuffExpiryPrecisionReplayCluster[];
  dueDecision: {
    shouldAlert: boolean;
    reason: string;
    dueTrackCount: number;
    newAlertTrackIds: string[];
    suppressedTrackIds: string[];
    markedTrackIds: string[];
  } | null;
  causes: DebugReplayCause[];
};

type UnknownRecord = Record<string, unknown>;

type AnalyzeOptions = {
  now?: number;
};

export function analyzeBuffExpiryPrecisionReplaySample(
  sample: unknown,
  options: AnalyzeOptions = {},
): BuffExpiryPrecisionReplayResult {
  const body = getSampleBody(sample);
  const buff = asRecord(body.buffExpiry);
  const sampleNode = asRecord(body.sample);
  const lastSnapshot = asRecord(buff.lastSnapshot);
  const state = asRecord(buff.state);
  const summary = asRecord(buff.summary);
  const config = asRecord(buff.config);
  const result = asRecord(sampleNode.result);
  const sampledAt = pickTimestamp(
    options.now,
    lastSnapshot.sampledAt,
    state.lastSampledAt,
    summary.sampledAt,
    result.sampledAt,
    body.submittedAt,
    body.createdAt,
    asRecord(sample).createdAt,
  );
  const rawMode = firstString(
    buff.engineMode,
    summary.engineMode,
    state.engineMode,
    sampleNode.engineMode,
    result.engineMode,
  );
  const hasBuffExpiryPayload = Boolean(body.buffExpiry || sampleNode.buffExpiry || result.buffExpiry);
  const supported =
    rawMode !== "legacy" &&
    (rawMode === "next" ||
      rawMode === "precision" ||
      hasBuffExpiryPayload ||
      Boolean(buff.next) ||
      Boolean(sampleNode.next) ||
      Array.isArray(lastSnapshot.nextIconObservations) ||
      Array.isArray(lastSnapshot.nextBestByGroup));
  const alertLeadSeconds = pickNumber(
    config.alertLeadSeconds,
    summary.alertLeadSeconds,
    result.alertLeadSeconds,
    10,
  ) ?? 10;
  const tracks = normalizeTrackedBuffs(
    firstArray(state.tracks, lastSnapshot.tracks, sampleNode.tracks, result.tracks),
    sampledAt,
  );
  const pendingTracks = normalizePendingTracks(
    firstArray(state.pendingTracks, lastSnapshot.pendingTracks, sampleNode.pendingTracks, result.pendingTracks),
    sampledAt,
  );

  if (!supported) {
    return createResult({
      supported: false,
      reason: "정밀 감지 샘플이 아니어서 현재 adapter를 실행하지 않았습니다.",
      alertLeadSeconds,
      sampledAt,
      tracks,
      pendingTracks,
      clusters: [],
      dueDecision: null,
      causes: [
        {
          status: "info",
          title: "정밀 감지 샘플 아님",
          detail: "정밀 감지 payload가 아니거나 다른 알림 유형인 샘플입니다.",
        },
      ],
    });
  }

  const clusters = getBuffExpiryPrecisionAlertClusters({ tracks, alertLeadSeconds, now: sampledAt }).map((cluster) => ({
    id: cluster.id,
    dueAt: cluster.dueAt,
    minExpiresAt: cluster.minExpiresAt,
    maxExpiresAt: cluster.maxExpiresAt,
    trackCount: cluster.tracks.length,
    trackNames: [...new Set(cluster.tracks.map((track) => track.name))],
    remainingSecondsUntilAlert: Math.ceil((cluster.dueAt - sampledAt) / 1000),
  }));
  const marked = markDueBuffExpiryPrecisionClustersAlerted({
    tracks,
    now: sampledAt,
    alertLeadSeconds,
    requireFreshness: true,
  });
  const causes = buildCauses({
    tracks,
    pendingTracks,
    clusters,
    shouldAlert: marked.shouldAlert,
    decisionReason: marked.alertDecision.reason,
  });

  return createResult({
    supported: true,
    reason: null,
    alertLeadSeconds,
    sampledAt,
    tracks,
    pendingTracks,
    clusters,
    dueDecision: {
      shouldAlert: marked.shouldAlert,
      reason: marked.alertDecision.reason,
      dueTrackCount: marked.alertDecision.dueTracks.length,
      newAlertTrackIds: marked.alertDecision.newAlertTrackIds,
      suppressedTrackIds: marked.alertDecision.suppressedTrackIds,
      markedTrackIds: marked.alertDecision.markedTrackIds,
    },
    causes,
  });
}

function createResult({
  supported,
  reason,
  alertLeadSeconds,
  sampledAt,
  tracks,
  pendingTracks,
  clusters,
  dueDecision,
  causes,
}: {
  supported: boolean;
  reason: string | null;
  alertLeadSeconds: number | null;
  sampledAt: number;
  tracks: BuffExpiryTrackedBuff[];
  pendingTracks: BuffExpiryPendingTrack[];
  clusters: BuffExpiryPrecisionReplayCluster[];
  dueDecision: BuffExpiryPrecisionReplayResult["dueDecision"];
  causes: DebugReplayCause[];
}): BuffExpiryPrecisionReplayResult {
  return {
    engine: "buff-expiry-precision",
    supported,
    reason,
    alertLeadSeconds,
    sampledAt,
    trackCount: tracks.length,
    pendingTrackCount: pendingTracks.length,
    clusters,
    dueDecision,
    causes,
  };
}

function buildCauses({
  tracks,
  pendingTracks,
  clusters,
  shouldAlert,
  decisionReason,
}: {
  tracks: BuffExpiryTrackedBuff[];
  pendingTracks: BuffExpiryPendingTrack[];
  clusters: BuffExpiryPrecisionReplayCluster[];
  shouldAlert: boolean;
  decisionReason: string;
}): DebugReplayCause[] {
  if (!tracks.length && pendingTracks.length) {
    return [
      {
        status: "warn",
        title: "확인 중 후보만 있음",
        detail: "현재 payload 기준으로는 추적 track이 없어 알림 cluster 계산까지 가지 못했습니다.",
      },
    ];
  }

  if (!tracks.length) {
    return [
      {
        status: "fail",
        title: "추적 track 없음",
        detail: "parser/matcher/숫자 흐름 중 하나가 부족해 정밀 감지 runtime이 버프를 확정하지 못한 상태입니다.",
      },
    ];
  }

  if (shouldAlert) {
    return [
      {
        status: "pass",
        title: "현재 코드 기준 알림 대상",
        detail: "저장된 track과 sampledAt으로 현재 cluster 함수를 실행했을 때 알림 대상 cluster가 있습니다.",
      },
    ];
  }

  if (!clusters.length) {
    return [
      {
        status: "info",
        title: "새 알림 cluster 없음",
        detail:
          decisionReason === "existing-alert-group"
            ? "이미 알림 처리된 종료 시각 근처라 새 알림은 suppression됩니다."
            : "모든 track이 알림 완료 상태이거나 새로 알릴 종료 묶음이 없습니다.",
      },
    ];
  }

  const nearest = clusters
    .map((cluster) => cluster.remainingSecondsUntilAlert)
    .sort((left, right) => left - right)[0];
  return [
    {
      status: "info",
      title: "알림 예정 시각 전",
      detail: `가장 빠른 cluster는 현재 코드 기준 ${Math.max(0, nearest)}초 뒤 알림 대상입니다.`,
    },
  ];
}

function normalizeTrackedBuffs(values: unknown[], now: number): BuffExpiryTrackedBuff[] {
  return values
    .map((value, index) => normalizeTrackedBuff(value, index, now))
    .filter((track): track is BuffExpiryTrackedBuff => Boolean(track));
}

function normalizeTrackedBuff(value: unknown, index: number, now: number): BuffExpiryTrackedBuff | null {
  const record = asRecord(value);
  const expiresAt = pickTimestampOrNull(record.expiresAt);
  const remainingSeconds = pickNumber(record.remainingSeconds, record.detectedSeconds, record.seconds);
  const inferredExpiresAt =
    expiresAt ?? (remainingSeconds !== null ? now + remainingSeconds * 1000 : null);
  if (inferredExpiresAt === null) {
    return null;
  }
  const box = normalizeBox(record.box);
  const detectedAt = pickTimestamp(record.detectedAt, record.firstSeenAt, record.lastSeenAt, now);
  return {
    id: firstString(record.id) ?? `debug-track-${index}`,
    buffId: firstString(record.buffId, record.group, record.id) ?? "unknown",
    name: firstString(record.name, record.buffName, record.label) ?? "알 수 없는 버프",
    box,
    detectedSeconds: pickPositiveNumber(record.detectedSeconds, remainingSeconds, 0),
    detectedAt,
    expiresAt: inferredExpiresAt,
    lastSeenAt: pickTimestamp(record.lastSeenAt, detectedAt),
    alertedAt: pickTimestampOrNull(record.alertedAt),
    score: pickPositiveNumber(record.score, record.confidence, 0),
  };
}

function normalizePendingTracks(values: unknown[], now: number): BuffExpiryPendingTrack[] {
  return values
    .map((value, index) => normalizePendingTrack(value, index, now))
    .filter((track): track is BuffExpiryPendingTrack => Boolean(track));
}

function normalizePendingTrack(value: unknown, index: number, now: number): BuffExpiryPendingTrack | null {
  const record = asRecord(value);
  const box = normalizeBox(record.box);
  const observations = firstArray(record.observations).map((observation) => {
    const item = asRecord(observation);
    const strength: "weak" | "strong" = firstString(item.strength) === "weak" ? "weak" : "strong";
    return {
      seconds: pickPositiveNumber(item.seconds, item.remainingSeconds, 0),
      observedAt: pickTimestamp(item.observedAt, item.detectedAt, now),
      score: pickPositiveNumber(item.score, item.confidence, 0),
      strength,
      reason: firstString(item.reason) ?? "sample",
      predictedExpiresAt: pickTimestampOrNull(item.predictedExpiresAt) ?? undefined,
      weight: pickNumber(item.weight) ?? undefined,
    };
  });
  return {
    id: firstString(record.id) ?? `debug-pending-${index}`,
    buffId: firstString(record.buffId, record.group, record.id) ?? "unknown",
    name: firstString(record.name, record.buffName, record.label) ?? "확인 중 버프",
    box,
    firstSeenAt: pickTimestamp(record.firstSeenAt, record.detectedAt, now),
    lastSeenAt: pickTimestamp(record.lastSeenAt, record.detectedAt, now),
    observations,
    score: pickPositiveNumber(record.score, record.confidence, 0),
  };
}

function getSampleBody(sample: unknown): UnknownRecord {
  const record = asRecord(sample);
  const body = asRecord(record.body);
  return Object.keys(body).length ? body : record;
}

function normalizeBox(value: unknown): BuffExpiryBox {
  const record = asRecord(value);
  const width = pickPositiveNumber(record.width, record.side, 0);
  const height = pickPositiveNumber(record.height, record.side, width);
  return {
    x: pickPositiveNumber(record.x, 0),
    y: pickPositiveNumber(record.y, 0),
    width,
    height,
    confidence: pickPositiveNumber(record.confidence, 0),
    side: pickNumber(record.side) ?? width,
    row: pickNumber(record.row) ?? undefined,
    col: pickNumber(record.col) ?? undefined,
  };
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
