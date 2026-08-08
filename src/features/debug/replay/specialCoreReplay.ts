import type { DebugReplayCause } from "./buffExpiryPrecisionReplay";
import {
  asRecord,
  createSimpleReplayResult,
  firstString,
  getHasStream,
  getSampleBody,
  pickNumber,
  pickTimestamp,
  pickTimestampOrNull,
  unsupportedCauses,
  type AnalyzeOptions,
  type SimpleAlertReplayResult,
} from "./simpleReplayShared";

export function analyzeSpecialCoreReplaySample(
  sample: unknown,
  options: AnalyzeOptions = {},
): SimpleAlertReplayResult {
  const body = getSampleBody(sample);
  const specialCore = asRecord(body.specialCore);
  const sampleNode = asRecord(body.sample);
  const specialCoreSample = asRecord(sampleNode.specialCore);
  const config = asRecord(specialCore.config);
  const state = asRecord(specialCore.state);
  const lastSnapshot = asRecord(specialCore.lastSnapshot);
  const result = asRecord(sampleNode.result);
  const supported = Boolean(
    specialCore.config ||
      specialCore.state ||
      body.kind === "special-core-issue",
  );
  const sampledAt = pickTimestamp(
    options.now,
    sampleNode.sampledAt,
    state.lastSampledAt,
    lastSnapshot.sampledAt,
    body.submittedAt,
    body.createdAt,
    asRecord(sample).createdAt,
  );
  const enabled = config.enabled !== false;
  const hasStream = getHasStream(body);
  const status = String(state.status ?? "unknown");
  const candidateIcons = Array.isArray(specialCoreSample.candidateIcons)
    ? specialCoreSample.candidateIcons
    : [];
  const resultDebug = asRecord(result.debug);
  const firstCandidateMatch = asRecord(asRecord(candidateIcons[0]).match);
  const lastSnapshotBestMatch = asRecord(lastSnapshot.bestMatch);
  const pendingDetections = Array.isArray(state.pendingDetections)
    ? state.pendingDetections
    : [];
  const boxCount = pickNumber(state.boxCount, lastSnapshot.boxCount) ?? 0;
  const detectedCount = pickNumber(
    state.detectedCount,
    lastSnapshot.detectedCount,
    asRecord(result.debug).detectedCount,
  ) ?? 0;
  const activationConfirmedAt = pickTimestampOrNull(state.activationConfirmedAt);
  const cooldownEndsAt = pickTimestampOrNull(state.cooldownEndsAt);
  const alertDueAt = pickTimestampOrNull(state.alertDueAt);
  const alertedAt = pickTimestampOrNull(state.alertedAt);
  const shouldAlert = Boolean(
    supported &&
      enabled &&
      hasStream &&
      alertDueAt !== null &&
      alertedAt === null &&
      sampledAt >= alertDueAt,
  );
  const decisionReason = getDecisionReason({
    supported,
    enabled,
    hasStream,
    status,
    pendingCount: pendingDetections.length,
    activationConfirmedAt,
    alertDueAt,
    alertedAt,
    sampledAt,
  });

  return createSimpleReplayResult({
    engine: "special-core",
    supported,
    reason: supported
      ? null
      : "특수 코어 알림 샘플이 아니어서 현재 adapter를 실행하지 않았습니다.",
    sampledAt,
    status,
    shouldAlert,
    decisionReason,
    metrics: {
      boxCount,
      detectedCount,
      candidateCount: candidateIcons.length,
      pendingCount: pendingDetections.length,
      bestScore: pickNumber(
        resultDebug.bestScore,
        firstCandidateMatch.score,
        result.confidence,
        lastSnapshotBestMatch.score,
      ),
      bestGateScore: pickNumber(
        resultDebug.bestGateScore,
        firstCandidateMatch.gateScore,
        lastSnapshotBestMatch.gateScore,
      ),
      matcherDecision: firstString(
        resultDebug.decisionReason,
        firstCandidateMatch.decisionReason,
        lastSnapshotBestMatch.decisionReason,
      ),
      matcherBundle: firstString(
        resultDebug.bundleId,
        firstCandidateMatch.bundleId,
        lastSnapshotBestMatch.bundleId,
      ),
      matcherModel: firstString(
        resultDebug.modelVersion,
        firstCandidateMatch.modelVersion,
        lastSnapshotBestMatch.modelVersion,
      ),
      activationConfirmedAt,
      cooldownEndsAt,
      alertDueAt,
      alertedAt,
    },
    causes: buildCauses({
      supported,
      decisionReason,
      status,
      pendingCount: pendingDetections.length,
      candidateCount: candidateIcons.length,
      alertDueAt,
      sampledAt,
    }),
  });
}

function getDecisionReason({
  supported,
  enabled,
  hasStream,
  status,
  pendingCount,
  activationConfirmedAt,
  alertDueAt,
  alertedAt,
  sampledAt,
}: {
  supported: boolean;
  enabled: boolean;
  hasStream: boolean;
  status: string;
  pendingCount: number;
  activationConfirmedAt: number | null;
  alertDueAt: number | null;
  alertedAt: number | null;
  sampledAt: number;
}) {
  if (!supported) return "unsupported";
  if (!enabled) return "disabled";
  if (!hasStream) return "no-stream";
  if (status === "unavailable") return "unavailable";
  if (status === "loading") return "loading";
  if (alertedAt !== null) return "already-alerted";
  if (pendingCount > 0 && activationConfirmedAt === null) return "confirming";
  if (activationConfirmedAt === null || alertDueAt === null) return "no-activation";
  if (sampledAt >= alertDueAt) return "due-now";
  return "scheduled-future";
}

function buildCauses({
  supported,
  decisionReason,
  status,
  pendingCount,
  candidateCount,
  alertDueAt,
  sampledAt,
}: {
  supported: boolean;
  decisionReason: string;
  status: string;
  pendingCount: number;
  candidateCount: number;
  alertDueAt: number | null;
  sampledAt: number;
}): DebugReplayCause[] {
  if (!supported) return unsupportedCauses("특수 코어 알림");
  if (decisionReason === "due-now") {
    return [
      {
        status: "fail",
        title: "알림 시각이 지났지만 완료 기록이 없음",
        detail: "확정된 활성화와 알림 시각은 있으나 payload에 알림 완료 시각이 없습니다.",
      },
    ];
  }
  if (decisionReason === "already-alerted") {
    return [
      {
        status: "pass",
        title: "특수 코어 알림 처리 기록 있음",
        detail: "payload에 해당 활성화의 알림 처리 시각이 있습니다. 실제 소리 재생 성공 여부는 별도 재생 기록으로 확인해야 합니다.",
      },
    ];
  }
  if (decisionReason === "confirming") {
    return [
      {
        status: "warn",
        title: "특수 코어 후보 확인 중",
        detail: `확정에 필요한 연속 감지 전이며 현재 후보 기록은 ${pendingCount}개입니다.`,
      },
    ];
  }
  if (decisionReason === "scheduled-future") {
    return [
      {
        status: "pass",
        title: "알림 예약 정상",
        detail: `알림까지 ${Math.max(0, Math.ceil(((alertDueAt ?? sampledAt) - sampledAt) / 1000))}초 남은 상태입니다.`,
      },
    ];
  }
  if (decisionReason === "no-activation") {
    return [
      {
        status: candidateCount > 0 ? "warn" : "info",
        title: candidateCount > 0 ? "후보는 있으나 활성화 미확정" : "특수 코어 감지 기록 없음",
        detail:
          candidateCount > 0
            ? "matcher 후보는 저장됐지만 연속 감지 조건을 만족한 활성화 기록은 없습니다."
            : "제보 시점 payload에 특수 코어 후보 또는 확정 활성화가 없습니다.",
      },
    ];
  }
  if (decisionReason === "loading") {
    return [
      {
        status: "info",
        title: "특수 코어 모델 준비 중",
        detail: "제보 시점에 모델 파일을 불러오는 중이었습니다.",
      },
    ];
  }
  return [
    {
      status: decisionReason === "unavailable" ? "fail" : "info",
      title: "특수 코어 상태",
      detail: `${status} 상태입니다. 결정 사유: ${decisionReason}`,
    },
  ];
}
