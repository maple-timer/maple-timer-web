import { analyzeSkillReplaySample } from "../../../replay/skillReplay";
import {
  assessSkillAlertPlayback,
  getAlertPlaybackDiagnostic,
  getAlertPlaybackStageStatus,
  getAlertPlaybackSummary,
  type AlertPlaybackAssessment,
} from "../alertPlayback";
import {
  asArray,
  asRecord,
  firstNumber,
  firstString,
  formatConfidence,
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
import type { FeatureAdapter } from "../types";
import {
  getPrecisionParserFailureDetail,
  getPrecisionParserFailureMetrics,
  getPrecisionParserFailureTitle,
  readSavedPrecisionParserFailure,
  type SavedPrecisionParserFailure,
} from "../precisionParserFailure";
import {
  getRuntimeAnalysisFailureDetail,
  getRuntimeAnalysisFailureTitle,
  readSavedRuntimeAnalysisFailure,
  type SavedRuntimeAnalysisFailure,
} from "../runtimeAnalysisFailure";
import { analyzeSkillIncidentEvidence } from "./skillIncidentAdapter";

export const skillAdapter: FeatureAdapter = {
  feature: "skill",
  analyze(sample, now) {
    const incidentAnalysis = analyzeSkillIncidentEvidence(sample);
    if (incidentAnalysis) {
      return incidentAnalysis;
    }
    const { body } = sample;
    const sampleNode = asRecord(body.sample);
    const savedParser = asRecord(sampleNode.parser);
    const parserFailure = readSavedPrecisionParserFailure(savedParser);
    const resultNode = asRecord(sampleNode.result);
    const runtimeFailure = readSavedRuntimeAnalysisFailure(
      resultNode.runtimeFailure,
    );
    const buffDuration = asRecord(sampleNode.buffDuration);
    const replay = analyzeSkillReplaySample(sample.root, now ? { now } : {});
    const isBuffDuration = replay.engine === "skill-buff-duration";
    const isRemainingCount = replay.metrics.valueKind === "remaining-count";
    const collector = createEvidenceCollector(sample);
    addCommonEvidence(sample, collector, isBuffDuration ? "버프칸 원본" : "퀵슬롯 원본");
    addSkillEvidence(sample, collector);
    const playback = assessSkillAlertPlayback(body);
    const diagnostics = [];
    if (parserFailure) {
      diagnostics.push(
        diagnostic(
          "skill-parser-runtime-failed",
          "critical",
          getPrecisionParserFailureTitle(parserFailure),
          getPrecisionParserFailureDetail(parserFailure),
          "detection",
        ),
      );
    } else if (typeof buffDuration.error === "string" && buffDuration.error) {
      diagnostics.push(
        diagnostic(
          "skill-report-frame-error",
          "critical",
          "제보 프레임 분석 실패",
          buffDuration.error,
          "recognition",
        ),
      );
    } else if (runtimeFailure) {
      diagnostics.push(
        diagnostic(
          "skill-runtime-analysis-failed",
          "critical",
          getRuntimeAnalysisFailureTitle(runtimeFailure),
          getRuntimeAnalysisFailureDetail(runtimeFailure),
          runtimeFailure.stage === "frame-capture" ? "input" : "recognition",
        ),
      );
    }
    diagnostics.push(...diagnosticsFromReplayCauses(replay.causes));
    const playbackDiagnostic = getAlertPlaybackDiagnostic(playback);
    if (playbackDiagnostic) diagnostics.push(playbackDiagnostic);
    const verdict = buildVerdict(diagnostics, {
      title: "스킬 알림 상태 확인 필요",
      detail: "저장된 인식 결과와 타이머 상태에서 명확한 결론을 만들지 못했습니다.",
    });
    const candidateCount = firstNumber(replay.metrics.candidateCount) ?? 0;
    const detected = Boolean(replay.metrics.detected);
    const countdownSeconds = firstNumber(replay.metrics.countdownSeconds);
    const remainingSeconds = firstNumber(replay.metrics.remainingSeconds);
    const alertThresholdSeconds = firstNumber(replay.metrics.alertThresholdSeconds);
    const rawRemainingCount = firstNumber(replay.metrics.rawRemainingCount);
    const confirmedRemainingCount = firstNumber(replay.metrics.confirmedRemainingCount);
    const remainingCountExpectedMin = firstNumber(replay.metrics.remainingCountExpectedMin);
    const remainingCountExpectedMax = firstNumber(replay.metrics.remainingCountExpectedMax);
    const alertInCount = firstNumber(replay.metrics.alertInCount);

    return {
      feature: "skill",
      featureLabel: "스킬 알림",
      modeLabel: isBuffDuration ? "버프칸 정밀 감지" : "퀵슬롯 감지",
      title: String(replay.metrics.presetLabel ?? replay.metrics.skillName ?? "스킬 제보"),
      verdict,
      summaryMetrics: isBuffDuration
        ? isRemainingCount
          ? [
              metric("target", "대상", String(replay.metrics.targetDisplayName ?? replay.metrics.presetLabel ?? "없음")),
              metric("raw-count", "원시 판독", formatCount(rawRemainingCount)),
              metric("confirmed-count", "확정 횟수", formatCount(confirmedRemainingCount)),
              metric(
                "flow",
                "흐름 판정",
                formatRemainingCountFlowDecision(replay.metrics.remainingCountFlowDecision),
              ),
              metric("alert-in", "알림까지", formatCount(alertInCount)),
              metric("playback", "실제 재생", playback.label, playback.detail, playback.tone),
            ]
          : [
            metric("target", "대상", String(replay.metrics.targetDisplayName ?? replay.metrics.presetLabel ?? "없음")),
            metric("match-score", "아이콘 점수", formatScore(replay.metrics.score), "matcher 원점수이며 확률이 아닙니다."),
            metric("countdown", "판독 시간", formatSeconds(countdownSeconds)),
            metric("remaining", "계산된 남은 시간", formatSeconds(remainingSeconds)),
            metric("alert-in", "알림까지", formatSeconds(replay.metrics.alertInSeconds)),
            metric("playback", "실제 재생", playback.label, playback.detail, playback.tone),
          ]
        : [
            metric("target", "대상", String(replay.metrics.presetLabel ?? replay.metrics.skillName ?? "없음")),
            metric("reading", "최근 판독", String(replay.metrics.value ?? "없음")),
            metric("confidence", "인식 신뢰도", formatConfidence(replay.metrics.confidence)),
            metric("recognizer", "저장 인식기", String(asRecord(sampleNode.result).recognizerVersion ?? "없음")),
            metric("remaining", "계산된 남은 시간", formatSeconds(remainingSeconds)),
            metric("alert-in", "알림까지", formatSeconds(replay.metrics.alertInSeconds)),
            metric("playback", "실제 재생", playback.label, playback.detail, playback.tone),
          ],
      diagnostics,
      stages: isBuffDuration
        ? buildBuffDurationStages({
            collector,
            replay,
            verdictTone: verdict.tone,
            buffDuration,
            candidateCount,
            detected,
            countdownSeconds,
            isRemainingCount,
            rawRemainingCount,
            confirmedRemainingCount,
            remainingCountExpectedMin,
            remainingCountExpectedMax,
            alertInCount,
            remainingSeconds,
            alertThresholdSeconds,
            playback,
            savedParser,
            parserFailure,
          })
        : buildQuickslotStages({
            collector,
            replay,
            verdictTone: verdict.tone,
            remainingSeconds,
            alertThresholdSeconds,
            playback,
            runtimeFailure,
          }),
      evidence: collector.evidence,
    };
  },
};

function buildBuffDurationStages({
  collector,
  replay,
  verdictTone,
  buffDuration,
  candidateCount,
  detected,
  countdownSeconds,
  isRemainingCount,
  rawRemainingCount,
  confirmedRemainingCount,
  remainingCountExpectedMin,
  remainingCountExpectedMax,
  alertInCount,
  remainingSeconds,
  alertThresholdSeconds,
  playback,
  savedParser,
  parserFailure,
}: {
  collector: ReturnType<typeof createEvidenceCollector>;
  replay: ReturnType<typeof analyzeSkillReplaySample>;
  verdictTone: ReturnType<typeof buildVerdict>["tone"];
  buffDuration: Record<string, unknown>;
  candidateCount: number;
  detected: boolean;
  countdownSeconds: number | null;
  isRemainingCount: boolean;
  rawRemainingCount: number | null;
  confirmedRemainingCount: number | null;
  remainingCountExpectedMin: number | null;
  remainingCountExpectedMax: number | null;
  alertInCount: number | null;
  remainingSeconds: number | null;
  alertThresholdSeconds: number | null;
  playback: AlertPlaybackAssessment;
  savedParser: Record<string, unknown>;
  parserFailure: SavedPrecisionParserFailure | null;
}) {
  return [
    stage({
      id: "input",
      label: "버프칸 입력",
      status: collector.evidence.some((item) => item.stageId === "input") ? "complete" : "blocked",
      summary: collector.evidence.some((item) => item.stageId === "input") ? "버프칸 화면 있음" : "화면 증거 없음",
      detail: "제보 시점 버프칸 화면을 확인합니다.",
      evidenceIds: evidenceIdsForStage(collector.evidence, "input"),
    }),
    stage({
      id: "detection",
      label: "버프칸 탐색",
      status: parserFailure
        ? "blocked"
        : firstNumber(buffDuration.boxCount)
          ? "complete"
          : "blocked",
      summary: parserFailure
        ? "parser 실행 실패"
        : `${firstNumber(buffDuration.boxCount) ?? 0}개 칸`,
      detail: parserFailure
        ? getPrecisionParserFailureDetail(parserFailure)
        : "parser가 화면에서 버프 아이콘 칸을 찾은 결과입니다.",
      metrics: [
        metric("boxes", "버프칸", `${firstNumber(buffDuration.boxCount) ?? 0}개`),
        ...(parserFailure
          ? getPrecisionParserFailureMetrics(parserFailure)
          : []),
      ],
      evidenceIds: evidenceIdsForStage(collector.evidence, "detection"),
    }),
    stage({
      id: "recognition",
      label: "대상 스킬 판정",
      status: parserFailure
        ? "unavailable"
        : detected
          ? "complete"
          : candidateCount > 0
            ? "warning"
            : "blocked",
      summary: parserFailure
        ? "앞 단계 실패로 확인 불가"
        : detected
          ? "대상 아이콘 일치"
          : formatSkillMatcherDecision(replay.metrics.matcherDecision),
      detail: parserFailure
        ? "parser 결과가 없어 matcher를 실행할 후보가 없습니다."
        : `후보 아이콘이 설정된 스킬인지 matcher로 판정합니다. ${formatSkillMatcherDecision(replay.metrics.matcherDecision)}`,
      metrics: [
        metric("candidates", "후보", `${candidateCount}개`),
        metric("decision", "판정", formatSkillMatcherDecision(replay.metrics.matcherDecision)),
        metric("base-skill", "1차 대상", String(replay.metrics.baseSkillId ?? "없음")),
        metric("score", "1차 점수", formatScore(replay.metrics.score)),
        metric("threshold", "1차 기준", formatScore(replay.metrics.threshold)),
        metric("margin", "1차 여유", formatScore(replay.metrics.margin)),
        metric("gate-score", "형태 점수", formatScore(replay.metrics.gateScore)),
        metric("gate-threshold", "형태 기준", formatScore(replay.metrics.gateThreshold)),
        metric("gate-margin", "형태 여유", formatScore(replay.metrics.gateMargin)),
        metric("bundle", "저장 번들", String(replay.metrics.bundleId ?? "없음")),
        metric("model-version", "저장 matcher", String(replay.metrics.modelVersion ?? "없음")),
      ],
      evidenceIds: evidenceIdsForStage(collector.evidence, "recognition"),
    }),
    stage({
      id: "reading",
      label: isRemainingCount ? "남은 횟수 판독" : "남은 시간 판독",
      status: parserFailure
        ? "unavailable"
        : isRemainingCount
        ? rawRemainingCount !== null
          ? "complete"
          : detected
            ? "warning"
            : "pending"
        : countdownSeconds !== null
          ? "complete"
          : detected
            ? "warning"
            : "pending",
      summary: parserFailure
        ? "앞 단계 실패로 확인 불가"
        : isRemainingCount
          ? formatCount(rawRemainingCount)
          : formatSeconds(countdownSeconds),
      detail: parserFailure
        ? "parser 결과가 없어 대상 아이콘의 숫자 판독이 실행되지 않았습니다."
        : isRemainingCount
          ? "대상 아이콘에서 원시 남은 횟수를 읽습니다. 이 값은 흐름 검증 전 관측값입니다."
          : "대상 아이콘의 숫자를 읽어 남은 시간을 계산합니다.",
      metrics: isRemainingCount
        ? [
            metric("count", "원시 판독", formatCount(rawRemainingCount)),
            metric(
              "confidence",
              "신뢰도",
              formatConfidence(replay.metrics.remainingCountConfidence),
            ),
            metric(
              "recognizer",
              "저장 인식기",
              String(replay.metrics.recognizerVersion ?? "없음"),
            ),
            metric(
              "model",
              "모델 상태",
              String(replay.metrics.remainingCountModelStatus ?? "없음"),
            ),
          ]
        : [
            metric("countdown", "판독값", String(replay.metrics.countdownText ?? "없음")),
            metric("confidence", "신뢰도", formatConfidence(replay.metrics.countdownConfidence)),
            metric("model", "모델 상태", String(replay.metrics.countdownModelStatus ?? "없음")),
          ],
      evidenceIds: evidenceIdsForStage(collector.evidence, "reading"),
    }),
    stage({
      id: "runtime",
      label: isRemainingCount ? "횟수 흐름 추적" : "종료 시각 추적",
      status: parserFailure
        ? "unavailable"
        : isRemainingCount
        ? replay.metrics.hasPendingRemainingCountDrop
          ? "warning"
          : confirmedRemainingCount !== null
            ? "complete"
            : rawRemainingCount !== null
              ? "warning"
              : "pending"
        : remainingSeconds !== null
          ? "complete"
          : countdownSeconds !== null
            ? "warning"
            : "pending",
      summary: parserFailure
        ? "앞 단계 실패로 확인 불가"
        : isRemainingCount
          ? replay.metrics.hasPendingRemainingCountDrop
            ? "불가능한 감소 보류"
            : `확정 ${formatCount(confirmedRemainingCount)}`
          : `남은 시간 ${formatSeconds(remainingSeconds)}`,
      detail: parserFailure
        ? "이번 프레임에는 추적에 전달할 인식 결과가 생성되지 않았습니다."
        : isRemainingCount
          ? "원시 판독이 마지막 확정값에서 정상적으로 도달 가능한 흐름인지 확인합니다."
          : "판독값과 이전 상태를 이용해 실제 종료 시각을 유지합니다.",
      metrics: [
        ...(isRemainingCount
          ? [
              metric("confirmed", "확정 횟수", formatCount(confirmedRemainingCount)),
              metric(
                "range",
                "도달 가능 범위",
                formatCountRange(remainingCountExpectedMin, remainingCountExpectedMax),
              ),
              metric(
                "decision",
                "흐름 판정",
                formatRemainingCountFlowDecision(replay.metrics.remainingCountFlowDecision),
              ),
            ]
          : [metric("remaining", "남은 시간", formatSeconds(remainingSeconds))]),
        metric("sampled", "최근 확인", formatTimestamp(replay.sampledAt)),
        metric("processing", "처리 시간", formatMilliseconds(replay.metrics.performanceMs)),
        metric("parser-engine", "parser 방식", firstString(savedParser.engine) ?? "미기록"),
        metric(
          "parser-provider",
          "저장 실행 방식",
          formatPrecisionParserExecutionProvider(
            asRecord(savedParser.runtime).executionProvider,
          ),
        ),
        metric(
          "parser-performance",
          "공유 parser 처리",
          formatMilliseconds(asRecord(savedParser.performance).detectMs),
        ),
        metric(
          "parser-version",
          "저장 parser",
          firstString(savedParser.version, buffDuration.parserVersion) ?? "없음",
        ),
        metric(
          "parser-fallback",
          "fallback 사유",
          firstString(savedParser.fallbackReason, buffDuration.parserFallbackReason) ?? "없음",
        ),
      ],
      evidenceIds: evidenceIdsForStage(collector.evidence, "runtime"),
    }),
    stage({
      id: "alert",
      label: "스킬 알림 재현",
      status: getAlertPlaybackStageStatus(playback, decisionStageStatus(verdictTone)),
      summary: getAlertPlaybackSummary(
        playback,
        replay.shouldAlert ? "현재 알림 대상" : "현재 알림 대상 아님",
      ),
      detail: playback.status === "none" ? replay.decisionReason : playback.detail,
      replayCoverage: "decision-replayed",
      metrics: isRemainingCount
        ? [
            metric("remaining", "확정 횟수", formatCount(confirmedRemainingCount)),
            metric("threshold", "알림 기준", formatCount(alertThresholdSeconds)),
            metric("alert-in", "알림까지", formatCount(alertInCount)),
          ]
        : [
            metric("remaining", "남은 시간", formatSeconds(remainingSeconds)),
            metric("threshold", "알림 기준", formatSeconds(alertThresholdSeconds)),
          ],
      evidenceIds: evidenceIdsForStage(collector.evidence, "alert"),
    }),
  ];
}

function buildQuickslotStages({
  collector,
  replay,
  verdictTone,
  remainingSeconds,
  alertThresholdSeconds,
  playback,
  runtimeFailure,
}: {
  collector: ReturnType<typeof createEvidenceCollector>;
  replay: ReturnType<typeof analyzeSkillReplaySample>;
  verdictTone: ReturnType<typeof buildVerdict>["tone"];
  remainingSeconds: number | null;
  alertThresholdSeconds: number | null;
  playback: AlertPlaybackAssessment;
  runtimeFailure: SavedRuntimeAnalysisFailure | null;
}) {
  return [
    stage({
      id: "input",
      label: "퀵슬롯 입력",
      status: runtimeFailure?.stage === "frame-capture"
        ? "blocked"
        : collector.evidence.some((item) => item.stageId === "input")
          ? "complete"
          : "blocked",
      summary: collector.evidence.some((item) => item.stageId === "input") ? "퀵슬롯 화면 있음" : "화면 증거 없음",
      detail: "사용자가 지정한 퀵슬롯 영역을 확인합니다.",
      evidenceIds: evidenceIdsForStage(collector.evidence, "input"),
    }),
    stage({
      id: "recognition",
      label: "숫자 판독",
      status: runtimeFailure ? "blocked" : replay.metrics.value !== null ? "complete" : "warning",
      summary: runtimeFailure ? "인식기 실행 실패" : String(replay.metrics.value ?? "판독 없음"),
      detail: runtimeFailure
        ? getRuntimeAnalysisFailureDetail(runtimeFailure)
        : "퀵슬롯에 표시된 남은 시간을 읽습니다.",
      metrics: [
        metric("value", "판독값", String(replay.metrics.value ?? "없음")),
        metric("confidence", "신뢰도", formatConfidence(replay.metrics.confidence)),
      ],
      evidenceIds: evidenceIdsForStage(collector.evidence, "recognition"),
    }),
    stage({
      id: "runtime",
      label: "종료 시각 추적",
      status: runtimeFailure ? "blocked" : remainingSeconds !== null ? "complete" : "warning",
      summary: `남은 시간 ${formatSeconds(remainingSeconds)}`,
      detail: "판독값과 기준 시간을 이용해 종료 시각을 계산합니다.",
      metrics: [metric("remaining", "남은 시간", formatSeconds(remainingSeconds))],
      evidenceIds: evidenceIdsForStage(collector.evidence, "runtime"),
    }),
    stage({
      id: "alert",
      label: "스킬 알림 재현",
      status: getAlertPlaybackStageStatus(playback, decisionStageStatus(verdictTone)),
      summary: getAlertPlaybackSummary(
        playback,
        replay.shouldAlert ? "현재 알림 대상" : "현재 알림 대상 아님",
      ),
      detail: playback.status === "none" ? replay.decisionReason : playback.detail,
      replayCoverage: "decision-replayed",
      metrics: [
        metric("remaining", "남은 시간", formatSeconds(remainingSeconds)),
        metric("threshold", "알림 기준", formatSeconds(alertThresholdSeconds)),
      ],
      evidenceIds: evidenceIdsForStage(collector.evidence, "alert"),
    }),
  ];
}

function addSkillEvidence(
  sample: Parameters<typeof createEvidenceCollector>[0],
  collector: ReturnType<typeof createEvidenceCollector>,
) {
  const sampleNode = asRecord(sample.body.sample);
  const skillNode = asRecord(sample.body.skill);
  const runtimeTimeline = asRecord(skillNode.runtimeTimeline);
  const buffDuration = asRecord(sampleNode.buffDuration);
  asArray(buffDuration.candidateIcons).slice(0, 24).forEach((entry, index) => {
    const candidate = asRecord(entry);
    const match = asRecord(candidate.match);
    const countdown = asRecord(candidate.countdown);
    const remainingCount = asRecord(candidate.remainingCount);
    collector.add({
      id: `skill-candidate-${index}`,
      group: "recognition",
      label: String(candidate.name ?? `스킬 후보 ${index + 1}`),
      description: match.matched ? "대상 스킬로 일치한 후보입니다." : "matcher가 비교한 후보입니다.",
      value: candidate.imageDataUrl,
      stageId: "recognition",
      metadata: [
        metric("decision", "판정", formatSkillMatcherDecision(match.decisionReason)),
        metric("score", "일치 점수", formatScore(match.score)),
        metric("margin", "1차 여유", formatScore(match.margin)),
        metric("gate-score", "형태 점수", formatScore(match.gateScore)),
        metric("bundle", "번들", String(match.bundleId ?? "없음")),
        metric("model", "모델", String(match.modelVersion ?? "없음")),
        metric("countdown", "남은 시간", formatSeconds(countdown.totalSeconds)),
        metric("remaining-count", "남은 횟수", formatCount(remainingCount.count)),
      ],
    });
  });
  asArray(runtimeTimeline.frames).slice(-8).forEach((entry, index) => {
    const frame = asRecord(entry);
    const recognition = asRecord(frame.recognition);
    const stateBefore = asRecord(frame.stateBefore);
    const stateAfter = asRecord(frame.stateAfter);
    collector.add({
      id: `skill-runtime-frame-${index}`,
      group: "runtime",
      label: `퀵슬롯 런타임 ${index + 1}`,
      description: `실제 감지 루프 판독값: ${String(recognition.value ?? "없음")}`,
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
        metric("confidence", "신뢰도", formatConfidence(recognition.confidence)),
      ],
    });
  });
}

function formatCount(value: unknown): string {
  const count = firstNumber(value);
  return count === null ? "없음" : `${count}회`;
}

function formatCountRange(min: number | null, max: number | null): string {
  if (min === null || max === null) {
    return "없음";
  }
  return `${min}~${max}회`;
}

function formatRemainingCountFlowDecision(value: unknown): string {
  const labels: Record<string, string> = {
    "accepted-initial": "초기값 확정",
    "accepted-steady": "동일 횟수 유지",
    "accepted-decrease": "정상 감소",
    "increase-pending": "새 사이클 확인 중",
    "cycle-reset": "새 사이클 확정",
    "implausible-drop": "불가능한 감소 보류",
    "implausible-drop-held": "불가능한 감소 계속 보류",
    "implausible-drop-recovered": "정상 흐름 복구",
    "alert-threshold-pending": "알림 기준 재확인 중",
    "alert-threshold-confirmed": "알림 기준 확정",
    "missing-reading": "판독 없음",
  };
  const reason = typeof value === "string" && value ? value : "없음";
  return labels[reason] ?? reason;
}

function formatSkillMatcherDecision(value: unknown): string {
  const labels: Record<string, string> = {
    target_accepted: "대상 일치",
    base_below_threshold: "1차 분류 기준 미달",
    base_target_disabled: "비활성 대상 우선 판정",
    positive_gate_below_threshold: "아이콘 형태 검증 기준 미달",
    cross_bundle_conflict: "모델 간 판정 충돌",
    other_skill_target: "다른 대상 판정",
    matched: "대상 일치",
    "below-threshold": "기준 미달",
  };
  const reason = typeof value === "string" && value ? value : "없음";
  return labels[reason] ?? reason;
}
