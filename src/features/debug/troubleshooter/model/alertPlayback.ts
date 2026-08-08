import { asArray, asRecord, readTimestamp } from "./sample";
import { diagnostic } from "./shared";
import type {
  PipelineStageStatus,
  TroubleshooterDiagnostic,
  TroubleshooterTone,
} from "./types";

export type AlertPlaybackAssessment = {
  status: "none" | "legacy" | "requested" | "started" | "finished" | "failed";
  label: string;
  detail: string;
  tone: TroubleshooterTone;
  occurredAt: number | null;
  soundId: string | null;
  error: string | null;
};

export function assessStateAlertPlayback(
  state: Record<string, unknown>,
): AlertPlaybackAssessment {
  const playback = asRecord(state.lastAlertPlayback);
  const status = normalizeStatus(playback.status);
  if (status) {
    return buildAssessment(status, playback);
  }
  if (readTimestamp(state.alertedAt) !== null) {
    return {
      status: "legacy",
      label: "재생 결과 기록 없음",
      detail: "알림 조건을 처리한 시각은 있지만 실제 소리 재생 성공 여부는 저장되지 않은 제보입니다.",
      tone: "info",
      occurredAt: readTimestamp(state.alertedAt),
      soundId: null,
      error: null,
    };
  }
  return noPlaybackAssessment();
}

export function assessSkillAlertPlayback(
  body: Record<string, unknown>,
): AlertPlaybackAssessment {
  const timeline = asRecord(asRecord(body.skill).runtimeTimeline);
  const events = asArray(timeline.alertEvents);
  const latest = asRecord(events[events.length - 1]);
  const status = normalizeStatus(latest.status);
  if (status) {
    return buildAssessment(status, latest);
  }
  return assessStateAlertPlayback(asRecord(asRecord(body.skill).state));
}

export function getAlertPlaybackDiagnostic(
  playback: AlertPlaybackAssessment,
): TroubleshooterDiagnostic | null {
  if (playback.status === "none") {
    return null;
  }
  return diagnostic(
    `alert-playback-${playback.status}`,
    playback.tone,
    playback.label,
    playback.detail,
    "alert",
  );
}

export function getAlertPlaybackStageStatus(
  playback: AlertPlaybackAssessment,
  fallback: PipelineStageStatus,
): PipelineStageStatus {
  if (playback.status === "failed") return "blocked";
  if (playback.status === "requested") return "warning";
  if (playback.status === "started" || playback.status === "finished") return "complete";
  if (playback.status === "legacy") return "pending";
  return fallback;
}

export function getAlertPlaybackSummary(
  playback: AlertPlaybackAssessment,
  fallback: string,
): string {
  return playback.status === "none" ? fallback : playback.label;
}

function buildAssessment(
  status: "requested" | "started" | "finished" | "failed",
  playback: Record<string, unknown>,
): AlertPlaybackAssessment {
  const error = typeof playback.error === "string" ? playback.error : null;
  const soundId = typeof playback.soundId === "string" ? playback.soundId : null;
  if (status === "failed") {
    return {
      status,
      label: "소리 재생 실패",
      detail: error
        ? `알림 조건에는 도달했지만 소리를 재생하지 못했습니다. 오류: ${error}`
        : "알림 조건에는 도달했지만 소리를 재생하지 못했습니다.",
      tone: "critical",
      occurredAt: readTimestamp(playback.failedAt),
      soundId,
      error,
    };
  }
  if (status === "finished") {
    return {
      status,
      label: "소리 재생 완료 확인",
      detail: "브라우저에서 알림 소리가 끝까지 재생된 기록이 있습니다.",
      tone: "positive",
      occurredAt: readTimestamp(playback.finishedAt),
      soundId,
      error: null,
    };
  }
  if (status === "started") {
    return {
      status,
      label: "소리 재생 시작 확인",
      detail: "브라우저가 알림 소리 재생 요청을 정상적으로 시작했습니다.",
      tone: "positive",
      occurredAt: readTimestamp(playback.startedAt),
      soundId,
      error: null,
    };
  }
  return {
    status,
    label: "소리 재생 결과 대기",
    detail: "알림 소리 재생을 요청했지만 성공 또는 실패 결과가 아직 기록되지 않았습니다.",
    tone: "warning",
    occurredAt: readTimestamp(playback.requestedAt),
    soundId,
    error: null,
  };
}

function normalizeStatus(
  value: unknown,
): "requested" | "started" | "finished" | "failed" | null {
  return value === "requested" ||
    value === "started" ||
    value === "finished" ||
    value === "failed"
    ? value
    : null;
}

function noPlaybackAssessment(): AlertPlaybackAssessment {
  return {
    status: "none",
    label: "재생 기록 없음",
    detail: "저장된 실제 소리 재생 기록이 없습니다.",
    tone: "neutral",
    occurredAt: null,
    soundId: null,
    error: null,
  };
}
