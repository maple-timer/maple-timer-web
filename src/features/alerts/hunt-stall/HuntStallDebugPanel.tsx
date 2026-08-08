import { Send } from "lucide-react";
import type { SyntheticEvent } from "react";
import type { HuntStallPerformanceMetrics, RgbaImageSnapshot } from "../../../alertTypes";
import { ImageDataCanvas } from "../../../shared/components/ImageDataCanvas";

function stopDebugClick(event: SyntheticEvent) {
  event.stopPropagation();
}

function formatDebugTime(timestamp: number | null): string {
  if (timestamp === null) {
    return "--";
  }

  const secondsAgo = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  return `${secondsAgo}초 전`;
}

function formatDebugValue(value: string | number | null): string {
  if (value === null || value === "") {
    return "--";
  }

  return String(value);
}

function formatDebugMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }

  return `${Math.round(value * 10) / 10}ms`;
}

const DECISION_LABELS: Record<string, string> = {
  idle: "대기",
  disabled: "꺼짐",
  "no-stream": "화면 없음",
  "sample-error": "샘플 실패",
  "foreground-ratio": "글자 비율 실패",
  "ocr-empty": "OCR 실패",
  "ignored-jitter": "흔들림 무시",
  stable: "안정값 유지",
  "stable-after-read-failure": "실패 후 복구",
  pending: "변화 후보",
  "pending-progress": "증가 후보",
  "confirmed-progress": "증가 확정",
  "level-reset": "레벨업 전환",
  "baseline-reset": "기준값 전환",
  "cooldown-no-region": "쿨타임 영역 없음",
  "cooldown-empty": "쿨타임 숫자 없음",
  "cooldown-readable": "쿨타임 숫자 확인",
  "cooldown-arming": "쿨타임 재확인",
  "cooldown-visual-active": "쿨타임 화면 변화",
  "cooldown-unchanged": "쿨타임 변화 없음",
  "cooldown-missing": "쿨타임 숫자 끊김",
  "cooldown-alerted": "쿨타임 알림 완료",
};

const FAILURE_LABELS: Record<string, string> = {
  "sample-error": "샘플 실패",
  "foreground-ratio": "글자 비율",
  "ocr-empty": "OCR 실패",
  "cooldown-visual-active": "화면 변화",
};

export function HuntStallDebugPanel({
  isManualExperienceMode,
  confidence,
  foregroundRatio,
  changeScore,
  recognizedText,
  processedPreviewUrl,
  processedPreviewImageData,
  rawPreviewUrl,
  rawPreviewImageData,
  cropLabel,
  lastSampledAt,
  lastReadableAt,
  lastReadFailureAt,
  unreadableSinceAt,
  lastReadFailureReason,
  lastDecision,
  lastRejectedRecognizedText,
  pendingRecognizedText,
  pendingRecognizedCount,
  stableSampleCount,
  unchangedSeconds,
  performance,
  hasDebugPayload,
  isSubmittingDebugSample,
  onSubmitDebugSample,
}: {
  isManualExperienceMode: boolean;
  confidence: number;
  foregroundRatio: number;
  changeScore: number;
  recognizedText: string | null;
  processedPreviewUrl: string | null;
  processedPreviewImageData: RgbaImageSnapshot | null;
  rawPreviewUrl: string | null;
  rawPreviewImageData: RgbaImageSnapshot | null;
  cropLabel: string;
  lastSampledAt: number | null;
  lastReadableAt: number | null;
  lastReadFailureAt: number | null;
  unreadableSinceAt: number | null;
  lastReadFailureReason: string | null;
  lastDecision: string;
  lastRejectedRecognizedText: string | null;
  pendingRecognizedText: string | null;
  pendingRecognizedCount: number;
  stableSampleCount: number;
  unchangedSeconds: number;
  performance: HuntStallPerformanceMetrics | null;
  hasDebugPayload: boolean;
  isSubmittingDebugSample: boolean;
  onSubmitDebugSample: () => void;
}) {
  const debugDecision = DECISION_LABELS[lastDecision] ?? lastDecision;
  const readingSummaryLabel = isManualExperienceMode ? "기준값" : "판독값";
  const pendingSummaryLabel = isManualExperienceMode ? "변화 후보" : "후보";
  const changeSignalLabel = isManualExperienceMode ? "변화 신호" : "변화";
  const debugFailure = lastReadFailureAt
    ? `${formatDebugTime(lastReadFailureAt)} · ${
        lastReadFailureReason ? FAILURE_LABELS[lastReadFailureReason] ?? lastReadFailureReason : "--"
      }`
    : "--";

  return (
    <section className="hunt-debug-panel" aria-label="사냥 멈춤 디버그 패널">
      <div className="hunt-debug-panel-heading">
        <div>
          <span>Debug</span>
          <strong>{debugDecision}</strong>
        </div>
        <button
          className="secondary-button hunt-debug-submit-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSubmitDebugSample();
          }}
          disabled={!hasDebugPayload || isSubmittingDebugSample}
        >
          <Send size={16} />
          {isSubmittingDebugSample ? "전송 중" : "디버그 전송"}
        </button>
      </div>

      <div className="hunt-debug-grid">
        <div className="hunt-debug-preview-stack" aria-label="전송될 화면">
          <div className="hunt-debug-preview-card">
            <span>원본</span>
            <div className="hunt-editor-crop-preview">
              {rawPreviewImageData ? (
                <ImageDataCanvas image={rawPreviewImageData} ariaLabel="경험치바 감지 영역" />
              ) : rawPreviewUrl ? (
                <img src={rawPreviewUrl} alt="경험치바 감지 영역" />
              ) : (
                <span className="crop-placeholder">{cropLabel}</span>
              )}
            </div>
          </div>
          <div className="hunt-debug-preview-card">
            <span>마스크</span>
            {processedPreviewImageData ? (
              <ImageDataCanvas
                className="hunt-debug-preview"
                image={processedPreviewImageData}
                ariaLabel="경험치 숫자 전처리 디버그"
              />
            ) : processedPreviewUrl ? (
              <img
                className="hunt-debug-preview"
                src={processedPreviewUrl}
                alt="경험치 숫자 전처리 디버그"
              />
            ) : (
              <div className="hunt-debug-preview placeholder">--</div>
            )}
          </div>
        </div>

        <div className="hunt-debug-summary" aria-label="사냥 멈춤 핵심 진단값">
          <span className="hunt-debug-chip primary">
            <em>{readingSummaryLabel}</em>
            <strong>{recognizedText ?? "--"}</strong>
          </span>
          <span className="hunt-debug-chip">
            <em>OCR</em>
            <strong>{Math.round(confidence * 100)}%</strong>
          </span>
          <span className="hunt-debug-chip">
            <em>유지</em>
            <strong>{unchangedSeconds}초</strong>
          </span>
          <span className="hunt-debug-chip">
            <em>{pendingSummaryLabel}</em>
            <strong>
              {pendingRecognizedText ? `${pendingRecognizedCount}회` : "--"}
            </strong>
          </span>
          <span className="hunt-debug-chip">
            <em>실패</em>
            <strong>{debugFailure}</strong>
          </span>
        </div>
      </div>

      <details className="hunt-debug-details" onClick={stopDebugClick}>
        <summary>상세 진단</summary>
        <div className="hunt-debug-diagnostics" aria-label="사냥 멈춤 상세 진단값">
          <span className="hunt-debug-chip">
            <em>샘플</em>
            <strong>{formatDebugTime(lastSampledAt)}</strong>
          </span>
          <span className="hunt-debug-chip">
            <em>판독</em>
            <strong>{formatDebugTime(lastReadableAt)}</strong>
          </span>
          <span className="hunt-debug-chip">
            <em>끊김</em>
            <strong>{formatDebugTime(unreadableSinceAt)}</strong>
          </span>
          <span className="hunt-debug-chip">
            <em>안정</em>
            <strong>{stableSampleCount}회</strong>
          </span>
          <span className="hunt-debug-chip">
            <em>{changeSignalLabel}</em>
            <strong>{Math.round(changeScore * 100)}%</strong>
          </span>
          <span className="hunt-debug-chip">
            <em>글자</em>
            <strong>{Math.round(foregroundRatio * 1000) / 10}%</strong>
          </span>
          <span className="hunt-debug-chip">
            <em>처리</em>
            <strong>{formatDebugMs(performance?.loopMs ?? performance?.totalMs)}</strong>
          </span>
          <span className="hunt-debug-chip">
            <em>프레임</em>
            <strong>{formatDebugMs(performance?.selectedFrameReadMs)}</strong>
          </span>
          <span className="hunt-debug-chip">
            <em>인식</em>
            <strong>{formatDebugMs(performance?.selectedOcrMs)}</strong>
          </span>
          <span className="hunt-debug-chip hunt-debug-wide-chip">
            <em>거부</em>
            <strong>{formatDebugValue(lastRejectedRecognizedText)}</strong>
          </span>
        </div>
      </details>
    </section>
  );
}
