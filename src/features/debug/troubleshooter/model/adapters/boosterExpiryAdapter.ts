import { analyzeBoosterExpiryReplaySample } from "../../../replay/boosterExpiryReplay";
import {
  assessStateAlertPlayback,
  getAlertPlaybackDiagnostic,
  getAlertPlaybackStageStatus,
  getAlertPlaybackSummary,
} from "../alertPlayback";
import {
  asArray,
  asRecord,
  firstNumber,
  formatConfidence,
  formatCount,
  formatMilliseconds,
  formatSeconds,
  formatTimestamp,
} from "../sample";
import {
  addCommonEvidence,
  buildVerdict,
  createEvidenceCollector,
  decisionStageStatus,
  diagnostic,
  diagnosticsFromReplayCauses,
  evidenceIdsForStage,
  metric,
  stage,
  stageStatusFromCount,
} from "../shared";
import type { FeatureAdapter, TroubleshooterDiagnostic } from "../types";
import {
  getRuntimeAnalysisFailureDetail,
  getRuntimeAnalysisFailureTitle,
  readSavedRuntimeAnalysisFailure,
} from "../runtimeAnalysisFailure";
import { analyzeBoosterExpiryIncidentEvidence } from "./boosterExpiryIncidentAdapter";

export const boosterExpiryAdapter: FeatureAdapter = {
  feature: "booster-expiry",
  analyze(sample, now) {
    const incidentAnalysis = analyzeBoosterExpiryIncidentEvidence(sample);
    if (incidentAnalysis) return incidentAnalysis;
    const { body } = sample;
    const sampleNode = asRecord(body.sample);
    const result = asRecord(sampleNode.result);
    const booster = asRecord(body.boosterExpiry);
    const state = asRecord(booster.state);
    const performance = asRecord(result.performance);
    const timerEvidence = asArray(sampleNode.timerEvidence);
    const confirmationEvidence = asArray(sampleNode.confirmationEvidence);
    const runtimeTrace = asArray(sampleNode.runtimeTrace);
    const latestTrace = asRecord(runtimeTrace[runtimeTrace.length - 1]);
    const runtimeFailure = readSavedRuntimeAnalysisFailure(
      result.runtimeFailure ?? latestTrace.runtimeFailure,
    );
    const replay = analyzeBoosterExpiryReplaySample(sample.root, now ? { now } : {});
    const collector = createEvidenceCollector(sample);
    addCommonEvidence(sample, collector, "부스터 타이머 원본");
    addBoosterEvidence(sample, collector);

    const diagnostics: TroubleshooterDiagnostic[] = [];
    const playback = assessStateAlertPlayback(state);
    if (typeof result.error === "string" && result.error) {
      diagnostics.push(
        diagnostic(
          "booster-report-frame-error",
          "critical",
          "제보 프레임 분석 실패",
          result.error,
          "reading",
        ),
      );
    } else if (runtimeFailure) {
      diagnostics.push(
        diagnostic(
          "booster-runtime-analysis-failed",
          "critical",
          getRuntimeAnalysisFailureTitle(runtimeFailure),
          getRuntimeAnalysisFailureDetail(runtimeFailure),
          runtimeFailure.stage === "frame-capture" ? "input" : "reading",
        ),
      );
    }
    if (timerEvidence.length > 0 && replay.confirmedExpiresAt === null) {
      diagnostics.push(
        diagnostic(
          "booster-no-schedule",
          "warning",
          "시간 판독은 있으나 종료 시각이 확정되지 않음",
          `${timerEvidence.length}개 판독 기록이 있지만 자연스러운 감소 흐름을 확정하지 못했습니다.`,
          "runtime",
        ),
      );
    }
    diagnostics.push(...diagnosticsFromReplayCauses(replay.causes));
    const playbackDiagnostic = getAlertPlaybackDiagnostic(playback);
    if (playbackDiagnostic) diagnostics.push(playbackDiagnostic);
    const verdict = buildVerdict(diagnostics, {
      title: "부스터 종료 상태 확인 필요",
      detail: "저장된 판독 흐름에서 명확한 결론을 만들지 못했습니다.",
    });
    const confidence = firstNumber(result.confidence);

    return {
      feature: "booster-expiry",
      featureLabel: "부스터 종료 알림",
      modeLabel: "타이머 OCR",
      title: sample.id === "unknown" ? "부스터 종료 제보" : `부스터 종료 제보 ${sample.id.slice(0, 8)}`,
      verdict,
      summaryMetrics: [
        metric("reading", "제보 프레임 판독", String(result.value ?? "없음")),
        metric("confidence", "OCR 신뢰도", formatConfidence(confidence)),
        metric("evidence", "판독 기록", `${timerEvidence.length}개`),
        metric("schedule", "확정 종료", formatTimestamp(replay.confirmedExpiresAt)),
        metric("processing", "처리 시간", formatMilliseconds(performance.totalMs)),
        metric("playback", "실제 재생", playback.label, playback.detail, playback.tone),
      ],
      diagnostics,
      stages: [
        stage({
          id: "input",
          label: "입력 화면",
          status: runtimeFailure?.stage === "frame-capture"
            ? "blocked"
            : collector.evidence.some((item) => item.stageId === "input")
              ? "complete"
              : "warning",
          summary: collector.evidence.some((item) => item.stageId === "input") ? "타이머 화면 있음" : "화면 증거 없음",
          detail: "제보 시점 부스터 타이머 영역을 확인합니다.",
          evidenceIds: evidenceIdsForStage(collector.evidence, "input"),
        }),
        stage({
          id: "reading",
          label: "시간 판독",
          status: runtimeFailure
            ? "blocked"
            : stageStatusFromCount(timerEvidence.length, { zero: "blocked" }),
          summary: runtimeFailure ? "분석 실행 실패" : `${timerEvidence.length}개 판독 기록`,
          detail: runtimeFailure
            ? getRuntimeAnalysisFailureDetail(runtimeFailure)
            : "타이머에서 읽은 원문과 초 단위 값을 확인합니다.",
          metrics: [
            metric("value", "최근 값", String(result.value ?? "없음")),
            metric("confidence", "신뢰도", formatConfidence(confidence)),
            metric("recognizer", "저장 인식기", String(result.recognizerVersion ?? "없음")),
          ],
          evidenceIds: evidenceIdsForStage(collector.evidence, "reading"),
        }),
        stage({
          id: "runtime",
          label: "감소 흐름 확인",
          status: runtimeFailure
            ? "blocked"
            : replay.confirmedExpiresAt !== null
              ? "complete"
              : confirmationEvidence.length > 0
                ? "warning"
                : "blocked",
          summary: replay.locked ? "종료 시각 확정" : "확정 전",
          detail: "여러 판독값이 시간 흐름에 맞게 감소하는지 검증합니다.",
          metrics: [
            metric("trace", "상태 기록", `${runtimeTrace.length}개`),
            metric("confirmations", "확인 근거", `${confirmationEvidence.length}개`),
            metric("flow", "흐름 출처", replay.flowSource ?? "없음"),
          ],
          evidenceIds: evidenceIdsForStage(collector.evidence, "runtime"),
        }),
        stage({
          id: "alert",
          label: "알림 판정 재현",
          status: getAlertPlaybackStageStatus(playback, decisionStageStatus(verdict.tone)),
          summary: getAlertPlaybackSummary(
            playback,
            replay.dueDecision.shouldAlert ? "현재 알림 대상" : "현재 알림 대상 아님",
          ),
          detail: playback.status === "none" ? replay.dueDecision.reason : playback.detail,
          replayCoverage: "decision-replayed",
          metrics: [
            metric("remaining", "종료까지", formatSeconds(replay.secondsUntilExpiry)),
            metric("alert-in", "알림까지", formatSeconds(replay.secondsUntilAlert)),
          ],
          evidenceIds: evidenceIdsForStage(collector.evidence, "alert"),
        }),
      ],
      evidence: collector.evidence,
    };
  },
};

function addBoosterEvidence(
  sample: Parameters<typeof createEvidenceCollector>[0],
  collector: ReturnType<typeof createEvidenceCollector>,
) {
  const sampleNode = asRecord(sample.body.sample);
  asArray(sampleNode.timerEvidence).slice(-24).forEach((entry, index) => {
    const item = asRecord(entry);
    const stateBefore = asRecord(item.stateBefore);
    const stateAfter = asRecord(item.stateAfter);
    collector.add({
      id: `booster-reading-${index}`,
      group: "recognition",
      label: `시간 판독 ${index + 1}`,
      description: `원문 ${String(item.rawText ?? "없음")} · 선택 ${String(item.displayText ?? "없음")}`,
      value: item.dataUrl,
      capturedAt: item.sampledAt,
      stageId: "reading",
      metadata: [
        metric("remaining", "남은 시간", formatSeconds(item.remainingSeconds)),
        metric("source", "선택 근거", String(item.selectedBy ?? item.decision ?? "없음")),
        metric("event", "보관 이유", String(item.eventType ?? "판독 기록")),
        metric(
          "state",
          "상태 전후",
          `${String(stateBefore.status ?? "없음")} → ${String(stateAfter.status ?? "없음")}`,
        ),
      ],
    });
  });
  asArray(sampleNode.confirmationEvidence).slice(-12).forEach((entry, index) => {
    const item = asRecord(entry);
    collector.add({
      id: `booster-confirmation-${index}`,
      group: "runtime",
      label: `흐름 확인 ${index + 1}`,
      description: "종료 시각 확정에 사용된 판독 기록입니다.",
      value: item.dataUrl,
      capturedAt: item.sampledAt,
      stageId: "runtime",
      metadata: [metric("remaining", "남은 시간", formatSeconds(item.remainingSeconds))],
    });
  });
}
