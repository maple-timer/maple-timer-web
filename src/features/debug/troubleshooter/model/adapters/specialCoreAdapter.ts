import { analyzeSpecialCoreReplaySample } from "../../../replay/specialCoreReplay";
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
  firstString,
  formatCount,
  formatMilliseconds,
  formatPrecisionParserExecutionProvider,
  formatScore,
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
} from "../shared";
import type { FeatureAdapter, TroubleshooterDiagnostic } from "../types";
import { formatSpecialCoreDecisionReason } from "../../specialCoreDecision";
import {
  getPrecisionParserFailureDetail,
  getPrecisionParserFailureMetrics,
  getPrecisionParserFailureTitle,
  readSavedPrecisionParserFailure,
} from "../precisionParserFailure";
import { analyzeSpecialCoreIncidentEvidence } from "./specialCoreIncidentAdapter";

export const specialCoreAdapter: FeatureAdapter = {
  feature: "special-core",
  analyze(sample, now) {
    const incidentAnalysis = analyzeSpecialCoreIncidentEvidence(sample);
    if (incidentAnalysis) {
      return incidentAnalysis;
    }
    const { body } = sample;
    const sampleNode = asRecord(body.sample);
    const savedParser = asRecord(sampleNode.parser);
    const savedParserRuntime = asRecord(savedParser.runtime);
    const savedParserPerformance = asRecord(savedParser.performance);
    const parserFailure = readSavedPrecisionParserFailure(savedParser);
    const specialCoreSample = asRecord(sampleNode.specialCore);
    const specialCore = asRecord(body.specialCore);
    const state = asRecord(specialCore.state);
    const timeline = asRecord(specialCore.timeline);
    const runtimeSamples = asArray(timeline.samples);
    const playbackEvents = asArray(timeline.playbackEvents);
    const result = asRecord(sampleNode.result);
    const resultDebug = asRecord(result.debug);
    const performance = asRecord(specialCoreSample.performance);
    const candidates = asArray(specialCoreSample.candidateIcons);
    const bestCandidate = asRecord(candidates[0]);
    const bestMatch = asRecord(bestCandidate.match);
    const pending = asArray(state.pendingDetections);
    const activationEvidence = asRecord(specialCore.activationEvidence);
    const confirmationIcons = asArray(activationEvidence.confirmationIcons);
    const replay = analyzeSpecialCoreReplaySample(sample.root, now ? { now } : {});
    const collector = createEvidenceCollector(sample);
    addCommonEvidence(sample, collector, "버프칸 원본");
    addSpecialCoreEvidence(sample, collector);
    const latestPlaybackEvent = asRecord(playbackEvents[playbackEvents.length - 1]);
    const playback = playbackEvents.length > 0
      ? assessStateAlertPlayback({
          lastAlertPlayback: latestPlaybackEvent,
          alertedAt: state.alertedAt,
        })
      : assessStateAlertPlayback(state);
    const diagnostics: TroubleshooterDiagnostic[] = [];
    if (parserFailure) {
      diagnostics.push(
        diagnostic(
          "special-core-parser-runtime-failed",
          "critical",
          getPrecisionParserFailureTitle(parserFailure),
          getPrecisionParserFailureDetail(parserFailure),
          "detection",
        ),
      );
    } else if (typeof resultDebug.error === "string" && resultDebug.error) {
      diagnostics.push(
        diagnostic(
          "special-core-report-frame-error",
          "critical",
          "제보 프레임 분석 실패",
          resultDebug.error,
          "recognition",
        ),
      );
    }
    diagnostics.push(...diagnosticsFromReplayCauses(replay.causes));
    const playbackDiagnostic = getAlertPlaybackDiagnostic(playback);
    if (playbackDiagnostic) diagnostics.push(playbackDiagnostic);
    const verdict = buildVerdict(diagnostics, {
      title: "특수 코어 상태 확인 필요",
      detail: "저장된 후보와 활성화 상태에서 명확한 결론을 만들지 못했습니다.",
    });
    const boxCount = firstNumber(
      resultDebug.boxCount,
      performance.boxCount,
      replay.metrics.boxCount,
      state.boxCount,
    ) ?? 0;
    const detectedCount = firstNumber(
      resultDebug.detectedCount,
      replay.metrics.detectedCount,
      state.detectedCount,
    ) ?? 0;
    const bestScore = firstNumber(
      replay.metrics.bestScore,
      resultDebug.bestScore,
      bestMatch.score,
      result.confidence,
    );
    const bestGateScore = firstNumber(
      replay.metrics.bestGateScore,
      resultDebug.bestGateScore,
      bestMatch.gateScore,
    );
    const matcherDecision = firstString(
      replay.metrics.matcherDecision,
      resultDebug.decisionReason,
      bestMatch.decisionReason,
    );
    const matcherBundle = firstString(
      replay.metrics.matcherBundle,
      resultDebug.bundleId,
      bestMatch.bundleId,
    );
    const matcherModel = firstString(
      replay.metrics.matcherModel,
      resultDebug.modelVersion,
      bestMatch.modelVersion,
    );
    const alertDueAt = firstNumber(replay.metrics.alertDueAt);
    const alertedAt = firstNumber(replay.metrics.alertedAt);

    return {
      feature: "special-core",
      featureLabel: "특수 코어 알림",
      modeLabel: "버프칸 정밀 감지",
      title: sample.id === "unknown" ? "특수 코어 제보" : `특수 코어 제보 ${sample.id.slice(0, 8)}`,
      verdict,
      summaryMetrics: [
        metric("boxes", "버프칸", formatCount(boxCount)),
        metric("detected", "일치 후보", formatCount(detectedCount)),
        metric("score", "최고 일치 점수", formatScore(bestScore), "matcher 원점수이며 확률이 아닙니다."),
        metric("gate-score", "형태 점수", formatScore(bestGateScore), "아이콘 형태 기준과 비교한 점수입니다."),
        metric("matcher-decision", "matcher 판정", formatSpecialCoreDecisionReason(matcherDecision)),
        metric("activation", "활성화 확정", formatTimestamp(replay.metrics.activationConfirmedAt)),
        metric("alert", "예상 알림", formatTimestamp(alertDueAt)),
        metric("playback", "실제 재생", playback.label, playback.detail, playback.tone),
      ],
      diagnostics,
      stages: [
        stage({
          id: "input",
          label: "버프칸 입력",
          status: collector.evidence.some((item) => item.stageId === "input") ? "complete" : "blocked",
          summary: collector.evidence.some((item) => item.stageId === "input") ? "버프칸 화면 있음" : "화면 증거 없음",
          detail: "제보 시점 특수 코어 버프칸 영역을 확인합니다.",
          evidenceIds: evidenceIdsForStage(collector.evidence, "input"),
        }),
        stage({
          id: "detection",
          label: "버프칸 탐색",
          status: parserFailure ? "blocked" : boxCount > 0 ? "complete" : "blocked",
          summary: parserFailure ? "parser 실행 실패" : `${boxCount}개 칸`,
          detail: parserFailure
            ? getPrecisionParserFailureDetail(parserFailure)
            : "공유 parser가 화면에서 버프 아이콘 칸을 찾은 결과입니다.",
          metrics: [
            metric("boxes", "버프칸", `${boxCount}개`),
            ...(parserFailure
              ? getPrecisionParserFailureMetrics(parserFailure)
              : []),
          ],
          evidenceIds: evidenceIdsForStage(collector.evidence, "detection"),
        }),
        stage({
          id: "recognition",
          label: "특수 코어 판정",
          status: parserFailure
            ? "unavailable"
            : detectedCount > 0
              ? "complete"
              : candidates.length > 0
                ? "warning"
                : "blocked",
          summary: parserFailure
            ? "앞 단계 실패로 확인 불가"
            : detectedCount > 0
              ? `${detectedCount}개 일치`
              : candidates.length > 0
                ? formatSpecialCoreDecisionReason(matcherDecision)
                : "비교할 후보 없음",
          detail: parserFailure
            ? "parser 결과가 없어 특수 코어 matcher를 실행할 후보가 없습니다."
            : `각 버프 아이콘의 1차 점수와 형태 검증을 함께 판정합니다. ${formatSpecialCoreDecisionReason(matcherDecision)}`,
          metrics: [
            metric("candidates", "저장 후보", `${candidates.length}개`),
            metric("decision", "판정", formatSpecialCoreDecisionReason(matcherDecision)),
            metric("score", "1차 점수", formatScore(bestScore)),
            metric(
              "threshold",
              "1차 기준",
              formatScore(firstNumber(resultDebug.baseThreshold, bestMatch.threshold)),
            ),
            metric("gate-score", "형태 점수", formatScore(bestGateScore)),
            metric(
              "gate-threshold",
              "형태 기준",
              formatScore(firstNumber(resultDebug.gateThreshold, bestMatch.gateThreshold)),
            ),
            metric("processing", "처리 시간", formatMilliseconds(performance.totalMs)),
            metric("parser-engine", "parser 방식", firstString(savedParser.engine, resultDebug.parserEngine) ?? "미기록"),
            metric(
              "parser-provider",
              "저장 실행 방식",
              formatPrecisionParserExecutionProvider(
                savedParserRuntime.executionProvider,
              ),
            ),
            metric("parser-performance", "공유 parser 처리", formatMilliseconds(savedParserPerformance.detectMs)),
            metric("parser-version", "저장 parser", firstString(savedParser.version, resultDebug.parserVersion) ?? "없음"),
            metric("parser-fallback", "fallback 사유", firstString(savedParser.fallbackReason, resultDebug.parserFallbackReason) ?? "없음"),
            metric("bundle-version", "저장 번들", matcherBundle ?? "없음"),
            metric("model-version", "저장 모델", matcherModel ?? "없음"),
          ],
          evidenceIds: evidenceIdsForStage(collector.evidence, "recognition"),
        }),
        stage({
          id: "runtime",
          label: "활성화 연속 확인",
          status: parserFailure
            ? "unavailable"
            : confirmationIcons.length >= 2
              ? "complete"
              : pending.length > 0
                ? "warning"
                : "pending",
          summary: parserFailure
            ? "앞 단계 실패로 확인 불가"
            : confirmationIcons.length >= 2
              ? "활성화 확정"
              : `확인 중 ${pending.length}/2회`,
          detail: parserFailure
            ? "이번 프레임에는 연속 확인에 전달할 인식 결과가 생성되지 않았습니다."
            : "단일 프레임 오감지를 막기 위해 3초 안에 두 번 감지됐는지 확인합니다.",
          metrics: [
            metric("pending", "확인 중", `${pending.length}회`),
            metric("confirmations", "확정 근거", `${confirmationIcons.length}개`),
            metric("runtime-samples", "저장 샘플", `${runtimeSamples.length}개`),
          ],
          evidenceIds: evidenceIdsForStage(collector.evidence, "runtime"),
        }),
        stage({
          id: "alert",
          label: "쿨타임·알림 재현",
          status: getAlertPlaybackStageStatus(playback, decisionStageStatus(verdict.tone)),
          summary: getAlertPlaybackSummary(
            playback,
            alertedAt !== null ? "알림 처리 기록 있음" : replay.shouldAlert ? "현재 알림 대상" : "알림 예약 또는 대기",
          ),
          detail: playback.status === "none" ? replay.decisionReason : playback.detail,
          replayCoverage: "decision-replayed",
          metrics: [
            metric("due", "예상 알림", formatTimestamp(alertDueAt)),
            metric(
              "remaining",
              "알림까지",
              alertDueAt === null ? "없음" : formatSeconds(Math.ceil((alertDueAt - replay.sampledAt) / 1000)),
            ),
            metric("playback-events", "재생 기록", `${playbackEvents.length}개`),
          ],
          evidenceIds: evidenceIdsForStage(collector.evidence, "alert"),
        }),
      ],
      evidence: collector.evidence,
    };
  },
};

function addSpecialCoreEvidence(
  sample: Parameters<typeof createEvidenceCollector>[0],
  collector: ReturnType<typeof createEvidenceCollector>,
) {
  const sampleNode = asRecord(sample.body.sample);
  const specialCoreSample = asRecord(sampleNode.specialCore);
  const specialCore = asRecord(sample.body.specialCore);
  asArray(specialCoreSample.candidateIcons).slice(0, 30).forEach((entry, index) => {
    const candidate = asRecord(entry);
    const match = asRecord(candidate.match);
    collector.add({
      id: `special-core-candidate-${index}`,
      group: "recognition",
      label: `특수 코어 후보 ${index + 1}`,
      description: match.matched ? "특수 코어로 일치한 후보입니다." : "모델이 비교한 상위 후보입니다.",
      value: candidate.imageDataUrl,
      stageId: "recognition",
      metadata: [
        metric("decision", "판정", formatSpecialCoreDecisionReason(match.decisionReason)),
        metric("score", "1차 점수", formatScore(match.score)),
        metric("threshold", "1차 기준", formatScore(match.threshold)),
        metric("margin", "1차 점수 차이", formatScore(match.margin)),
        metric("gate-score", "형태 점수", formatScore(match.gateScore)),
        metric("gate-threshold", "형태 기준", formatScore(match.gateThreshold)),
        metric("model", "모델", String(match.modelVersion ?? "없음")),
      ],
    });
  });
  const activation = asRecord(specialCore.activationEvidence);
  asArray(activation.confirmationIcons).slice(0, 10).forEach((entry, index) => {
    const candidate = asRecord(entry);
    const match = asRecord(candidate.match);
    collector.add({
      id: `special-core-confirmation-${index}`,
      group: "runtime",
      label: `활성화 확정 ${index + 1}`,
      description: "동일 활성화를 확정하는 데 사용된 연속 감지 증거입니다.",
      value: candidate.imageDataUrl,
      capturedAt: activation.activationConfirmedAt,
      stageId: "runtime",
      metadata: [
        metric("decision", "판정", formatSpecialCoreDecisionReason(match.decisionReason)),
        metric("score", "1차 점수", formatScore(match.score)),
        metric("gate-score", "형태 점수", formatScore(match.gateScore)),
      ],
    });
  });
  asArray(specialCore.recentEvidence).slice(-30).forEach((entry, index) => {
    const recent = asRecord(entry);
    const candidate = asRecord(recent.evidenceIcon);
    const match = asRecord(candidate.match);
    collector.add({
      id: `special-core-recent-${index}`,
      group: "runtime",
      label: `최근 후보 ${index + 1}`,
      description: `출처: ${String(recent.source ?? "candidate")}`,
      value: candidate.imageDataUrl,
      capturedAt: recent.sampledAt,
      stageId: "runtime",
      metadata: [
        metric("decision", "판정", formatSpecialCoreDecisionReason(match.decisionReason)),
        metric("score", "1차 점수", formatScore(match.score)),
        metric("gate-score", "형태 점수", formatScore(match.gateScore)),
      ],
    });
  });
}
