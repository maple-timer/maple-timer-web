import { analyzeHuntStallReplaySample } from "../../../replay/huntStallReplay";
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
  formatMilliseconds,
  formatSeconds,
} from "../sample";
import {
  addCommonEvidence,
  buildVerdict,
  createEvidenceCollector,
  decisionStageStatus,
  diagnosticsFromReplayCauses,
  diagnostic,
  evidenceIdsForStage,
  metric,
  stage,
} from "../shared";
import type { FeatureAdapter } from "../types";
import {
  getRuntimeAnalysisFailureDetail,
  getRuntimeAnalysisFailureTitle,
  readSavedRuntimeAnalysisFailure,
} from "../runtimeAnalysisFailure";
import { analyzeHuntStallIncidentEvidence } from "./huntStallIncidentAdapter";

export const huntStallAdapter: FeatureAdapter = {
  feature: "hunt-stall",
  analyze(sample, now) {
    const incidentAnalysis = analyzeHuntStallIncidentEvidence(sample);
    if (incidentAnalysis) {
      return incidentAnalysis;
    }
    const { body } = sample;
    const sampleNode = asRecord(body.sample);
    const result = asRecord(sampleNode.result);
    const hunt = asRecord(body.huntStall);
    const config = asRecord(hunt.config);
    const state = asRecord(hunt.state);
    const trace = asArray(sampleNode.runtimeTrace);
    const latestTrace = asRecord(trace[trace.length - 1]);
    const runtimeFailure = readSavedRuntimeAnalysisFailure(
      result.runtimeFailure ?? latestTrace.runtimeFailure,
    );
    const history = asArray(sampleNode.cropHistory);
    const candidates = asArray(sampleNode.cropCandidates);
    const mode = String(config.mode ?? sampleNode.mode ?? "manual-experience");
    const isCooldownMode = mode === "cooldown-presence";
    const replay = analyzeHuntStallReplaySample(sample.root, now ? { now } : {});
    const collector = createEvidenceCollector(sample);
    addCommonEvidence(sample, collector, isCooldownMode ? "쿨타임 아이콘 원본" : "경험치 원본");
    addHuntEvidence(sample, collector);
    const playback = assessStateAlertPlayback(state);
    const diagnostics = diagnosticsFromReplayCauses(replay.causes);
    if (runtimeFailure) {
      diagnostics.unshift(
        diagnostic(
          "hunt-stall-runtime-analysis-failed",
          "critical",
          getRuntimeAnalysisFailureTitle(runtimeFailure),
          getRuntimeAnalysisFailureDetail(runtimeFailure),
          runtimeFailure.stage === "frame-capture" ? "input" : "recognition",
        ),
      );
    }
    const playbackDiagnostic = getAlertPlaybackDiagnostic(playback);
    if (playbackDiagnostic) diagnostics.push(playbackDiagnostic);
    const verdict = buildVerdict(diagnostics, {
      title: "사냥 멈춤 상태 확인 필요",
      detail: "저장된 변화 기록에서 명확한 결론을 만들지 못했습니다.",
    });
    const confidence = firstNumber(result.confidence, replay.metrics.confidence);
    const unchangedSeconds = firstNumber(replay.metrics.unchangedSeconds) ?? 0;
    const thresholdSeconds = firstNumber(replay.metrics.thresholdSeconds) ?? 0;
    const repeatIntervalSeconds = firstNumber(replay.metrics.repeatIntervalSeconds) ?? 3;
    const repeatedAlertCount = firstNumber(replay.metrics.repeatedAlertCount) ?? 0;
    const repeatMaxCount = firstNumber(replay.metrics.repeatMaxCount);
    const repeatAlertEnabled = replay.metrics.repeatAlertEnabled === true;
    const repeatSummary = isCooldownMode
      ? "해당 없음"
      : !repeatAlertEnabled
        ? "사용 안 함"
        : `${repeatedAlertCount}회 · ${repeatIntervalSeconds}초 간격 · ${repeatMaxCount === null ? "계속" : `최대 ${repeatMaxCount}회`}`;
    const performance = asRecord(result.performance);

    return {
      feature: "hunt-stall",
      featureLabel: "사냥 멈춤 알림",
      modeLabel: isCooldownMode ? "쿨타임 아이콘 감지" : "경험치 인식",
      title: sample.id === "unknown" ? "사냥 멈춤 제보" : `사냥 멈춤 제보 ${sample.id.slice(0, 8)}`,
      verdict,
      summaryMetrics: [
        metric("reading", isCooldownMode ? "아이콘 상태" : "인식 값", String(replay.metrics.recognizedText ?? result.value ?? "없음")),
        metric("confidence", "인식 신뢰도", formatConfidence(confidence)),
        metric("unchanged", "변화 없음", formatSeconds(unchangedSeconds)),
        metric("threshold", "알림 기준", formatSeconds(thresholdSeconds)),
        metric("repeat", "반복", repeatSummary),
        metric("processing", "처리 시간", formatMilliseconds(performance.totalMs)),
        metric("recognizer", "저장 인식기", String(result.recognizerVersion ?? "없음")),
        metric("playback", "실제 재생", playback.label, playback.detail, playback.tone),
      ],
      diagnostics,
      stages: [
        stage({
          id: "input",
          label: "화면 입력",
          status: runtimeFailure?.stage === "frame-capture"
            ? "blocked"
            : collector.evidence.some((item) => item.stageId === "input")
              ? "complete"
              : "blocked",
          summary: collector.evidence.some((item) => item.stageId === "input") ? "분석 화면 있음" : "화면 증거 없음",
          detail: isCooldownMode ? "쿨타임 아이콘 영역을 확인합니다." : "경험치 숫자 영역을 확인합니다.",
          evidenceIds: evidenceIdsForStage(collector.evidence, "input"),
        }),
        stage({
          id: "detection",
          label: isCooldownMode ? "아이콘 영역 탐색" : "경험치 영역 선택",
          status: candidates.length > 0 || collector.evidence.some((item) => item.stageId === "detection") ? "complete" : "warning",
          summary: candidates.length > 0 ? `${candidates.length}개 후보` : "저장 영역 사용",
          detail: "화면에서 실제 판독에 사용할 영역을 선택한 결과입니다.",
          metrics: [metric("candidates", "영역 후보", `${candidates.length}개`)],
          evidenceIds: evidenceIdsForStage(collector.evidence, "detection"),
        }),
        stage({
          id: "recognition",
          label: isCooldownMode ? "아이콘 존재 판정" : "경험치 숫자 판독",
          status: runtimeFailure
            ? "blocked"
            : replay.metrics.recognizedText !== null || confidence !== null
              ? "complete"
              : "warning",
          summary: runtimeFailure
            ? "분석 실행 실패"
            : String(replay.metrics.recognizedText ?? result.value ?? "판독 없음"),
          detail: runtimeFailure
            ? getRuntimeAnalysisFailureDetail(runtimeFailure)
            : isCooldownMode
              ? "쿨타임 아이콘이 화면에 있는지 판정합니다."
              : "현재 경험치 끝자리 숫자를 읽습니다.",
          metrics: [metric("confidence", "신뢰도", formatConfidence(confidence))],
          evidenceIds: evidenceIdsForStage(collector.evidence, "recognition"),
        }),
        stage({
          id: "runtime",
          label: "변화 흐름 확인",
          status: runtimeFailure
            ? "blocked"
            : unchangedSeconds >= thresholdSeconds
              ? "warning"
              : trace.length > 0
                ? "complete"
                : "pending",
          summary: `${Math.round(unchangedSeconds)}/${Math.round(thresholdSeconds)}초`,
          detail: "단일 판독이 아니라 시간에 따른 변화 여부를 확인합니다.",
          metrics: [
            metric("trace", "상태 기록", `${trace.length}개`),
            metric("history", "화면 기록", `${history.length}개`),
            metric("repeat-count", "반복 횟수", `${repeatedAlertCount}회`),
            metric("repeat-interval", "반복 간격", formatSeconds(repeatIntervalSeconds)),
          ],
          evidenceIds: evidenceIdsForStage(collector.evidence, "runtime"),
        }),
        stage({
          id: "alert",
          label: "정지 알림 재현",
          status: getAlertPlaybackStageStatus(playback, decisionStageStatus(verdict.tone)),
          summary: getAlertPlaybackSummary(
            playback,
            replay.shouldAlert ? "현재 알림 대상" : "현재 알림 대상 아님",
          ),
          detail: playback.status === "none" ? replay.decisionReason : playback.detail,
          replayCoverage: "decision-replayed",
          metrics: [
            metric("unchanged", "변화 없음", formatSeconds(unchangedSeconds)),
            metric("threshold", "기준", formatSeconds(thresholdSeconds)),
            metric("repeat", "반복", repeatSummary),
          ],
          evidenceIds: evidenceIdsForStage(collector.evidence, "alert"),
        }),
      ],
      evidence: collector.evidence,
    };
  },
};

function addHuntEvidence(
  sample: Parameters<typeof createEvidenceCollector>[0],
  collector: ReturnType<typeof createEvidenceCollector>,
) {
  const sampleNode = asRecord(sample.body.sample);
  asArray(sampleNode.cropCandidates).slice(0, 12).forEach((entry, index) => {
    const candidate = asRecord(entry);
    collector.add({
      id: `hunt-candidate-${index}-raw`,
      group: "detection",
      label: `${String(candidate.label ?? `후보 ${index + 1}`)} 원본`,
      description: candidate.selected ? "실제 판독에 선택된 영역입니다." : "자동 탐색 후보입니다.",
      value: candidate.rawDataUrl,
      stageId: "detection",
      metadata: [metric("score", "영역 점수", String(candidate.score ?? "없음"))],
    });
    collector.add({
      id: `hunt-candidate-${index}-processed`,
      group: "recognition",
      label: `${String(candidate.label ?? `후보 ${index + 1}`)} 전처리`,
      description: `판독값: ${String(candidate.recognizedText ?? "없음")}`,
      value: candidate.processedDataUrl,
      stageId: "recognition",
      metadata: [metric("confidence", "신뢰도", formatConfidence(candidate.confidence))],
    });
  });
  asArray(sampleNode.cropHistory).slice(-12).forEach((entry, index) => {
    const frame = asRecord(entry);
    const stateBefore = asRecord(frame.stateBefore);
    const stateAfter = asRecord(frame.stateAfter ?? frame.state);
    collector.add({
      id: `hunt-history-${index}`,
      group: "runtime",
      label: `최근 화면 ${index + 1}`,
      description: `판독값: ${String(frame.recognizedText ?? "없음")}`,
      value: frame.rawDataUrl ?? frame.processedDataUrl,
      capturedAt: frame.sampledAt,
      stageId: "runtime",
      metadata: [
        metric(
          "state",
          "상태 전후",
          `${String(stateBefore.status ?? "없음")} → ${String(stateAfter.status ?? "없음")}`,
        ),
        metric("reason", "보관 이유", asArray(frame.reasons).join(", ") || "없음"),
      ],
    });
  });
}
