import { analyzeBuffExpiryPrecisionReplaySample } from "../../../replay/buffExpiryPrecisionReplay";
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
} from "../sample";
import {
  addCommonEvidence,
  arrayLength,
  buildVerdict,
  createEvidenceCollector,
  decisionStageStatus,
  diagnostic,
  evidenceIdsForStage,
  metric,
  stage,
  stageStatusFromCount,
} from "../shared";
import type { FeatureAdapter, TroubleshooterDiagnostic } from "../types";
import {
  getPrecisionParserFailureDetail,
  getPrecisionParserFailureMetrics,
  getPrecisionParserFailureTitle,
  readSavedPrecisionParserFailure,
} from "../precisionParserFailure";
import {
  getRuntimeAnalysisFailureDetail,
  getRuntimeAnalysisFailureTitle,
  readSavedRuntimeAnalysisFailure,
} from "../runtimeAnalysisFailure";
import { analyzeBuffExpiryIncidentEvidence } from "./buffExpiryIncidentAdapter";

export const buffExpiryAdapter: FeatureAdapter = {
  feature: "buff-expiry",
  analyze(sample, now) {
    const incidentAnalysis = analyzeBuffExpiryIncidentEvidence(sample);
    if (incidentAnalysis) {
      return incidentAnalysis;
    }
    const { body } = sample;
    const sampleNode = asRecord(body.sample);
    const savedParser = asRecord(sampleNode.parser);
    const savedParserRuntime = asRecord(savedParser.runtime);
    const savedParserPerformance = asRecord(savedParser.performance);
    const parserFailure = readSavedPrecisionParserFailure(savedParser);
    const result = asRecord(sampleNode.result);
    const runtimeFailure = readSavedRuntimeAnalysisFailure(
      result.runtimeFailure,
    );
    const next = asRecord(sampleNode.next);
    const parser = asRecord(next.parser);
    const identity = asRecord(next.identity);
    const countdown = asRecord(next.countdown);
    const tracking = asRecord(next.tracking);
    const performance = asRecord(next.performance);
    const moduleVersions = asRecord(next.moduleVersions);
    const matcherEvidence = getBuffExpiryMatcherEvidence(identity);
    const buff = asRecord(body.buffExpiry);
    const state = asRecord(buff.state);
    const playback = assessStateAlertPlayback(state);
    const replay = analyzeBuffExpiryPrecisionReplaySample(sample.root, now ? { now } : {});
    const parserCount = firstNumber(parser.boxCount, asRecord(buff.summary).snapshotBoxCount, sampleNode.boxes && arrayLength(sampleNode.boxes));
    const targetCount = firstNumber(
      identity.targetObservations && arrayLength(identity.targetObservations),
      asRecord(buff.summary).targetObservationCount,
    );
    const countdownObservations = asArray(countdown.observations);
    const usableCountdownCount = countdownObservations.filter((entry) => {
      const value = asRecord(asRecord(entry).countdown).totalSeconds;
      return typeof value === "number" && Number.isFinite(value);
    }).length;
    const trackCount = asArray(state.tracks).length || asArray(tracking.tracks).length;
    const pendingTrackCount = asArray(state.pendingTracks).length || asArray(tracking.pendingTracks).length;
    const collector = createEvidenceCollector(sample);
    addCommonEvidence(sample, collector, "버프칸 원본");
    addBuffExpiryEvidence(sample, collector);

    const diagnostics: TroubleshooterDiagnostic[] = [];
    if (parserFailure) {
      diagnostics.push(
        diagnostic(
          "buff-parser-runtime-failed",
          "critical",
          getPrecisionParserFailureTitle(parserFailure),
          getPrecisionParserFailureDetail(parserFailure),
          "detection",
        ),
      );
    } else if (runtimeFailure) {
      diagnostics.push(
        diagnostic(
          "buff-runtime-analysis-failed",
          "critical",
          getRuntimeAnalysisFailureTitle(runtimeFailure),
          getRuntimeAnalysisFailureDetail(runtimeFailure),
          runtimeFailure.stage === "frame-capture" ? "input" : "identity",
        ),
      );
    } else if ((parserCount ?? 0) <= 0) {
      diagnostics.push(
        diagnostic(
          "buff-no-boxes",
          "critical",
          "버프칸을 찾지 못함",
          "parser 결과가 없어 이후 아이콘 판정과 남은 시간 판독을 진행할 수 없습니다.",
          "detection",
        ),
      );
    } else if ((targetCount ?? 0) <= 0) {
      const matcherDiagnosis = getBuffExpiryMatcherDiagnosis(matcherEvidence.decisionReason);
      diagnostics.push(
        diagnostic(
          "buff-no-target",
          "warning",
          matcherDiagnosis.title,
          matcherDiagnosis.detail ??
            `${parserCount}개 칸을 찾았지만 사용자가 선택한 대상과 일치한 아이콘이 없습니다.`,
          "identity",
        ),
      );
    } else if (usableCountdownCount <= 0) {
      diagnostics.push(
        diagnostic(
          "buff-no-countdown",
          "critical",
          "대상 버프는 찾았지만 남은 시간을 읽지 못함",
          `${targetCount}개 대상 아이콘이 일치했지만 추적에 사용할 수 있는 시간 값이 없습니다.`,
          "reading",
        ),
      );
    } else if (trackCount <= 0 && pendingTrackCount <= 0) {
      diagnostics.push(
        diagnostic(
          "buff-no-track",
          "critical",
          "판독 결과가 추적으로 이어지지 않음",
          `대상 ${targetCount}개와 시간 값 ${usableCountdownCount}개가 있지만 runtime track이 생성되지 않았습니다.`,
          "runtime",
        ),
      );
    }
    diagnostics.push(
      diagnostic(
        "buff-legacy-temporal-evidence-unavailable",
        "warning",
        "이전 제보 형식이라 당시 알림 흐름은 확인할 수 없습니다",
        "아래 판정 비교는 저장된 상태를 현재 코드에 한 번 적용한 결과입니다. 제보 당시 시간 흐름, 예약, 재생 실행을 재현한 결과가 아닙니다.",
        "alert",
      ),
    );
    const playbackDiagnostic = getAlertPlaybackDiagnostic(playback);
    if (playbackDiagnostic) diagnostics.push(playbackDiagnostic);
    const verdict = buildVerdict(diagnostics, {
      title: "버프 종료 상태 확인 필요",
      detail: "저장된 증거만으로 명확한 판정을 만들지 못했습니다.",
    });

    const stages = [
      stage({
        id: "input",
        label: "입력 화면",
        status: runtimeFailure?.stage === "frame-capture"
          ? "blocked"
          : collector.evidence.some((item) => item.stageId === "input")
            ? "complete"
            : "warning",
        summary: collector.evidence.some((item) => item.stageId === "input") ? "화면 증거 있음" : "화면 증거 없음",
        detail: "제보 시점 버프칸 입력과 전체 화면을 확인합니다.",
        evidenceIds: evidenceIdsForStage(collector.evidence, "input"),
      }),
      stage({
        id: "detection",
        label: "버프칸 탐색",
        status: parserFailure || runtimeFailure
          ? "blocked"
          : stageStatusFromCount(parserCount, { zero: "blocked" }),
        summary: parserFailure
          ? "parser 실행 실패"
          : runtimeFailure
            ? "분석 실행 실패"
          : `${formatCount(parserCount)} 검출`,
        detail: parserFailure
          ? getPrecisionParserFailureDetail(parserFailure)
          : runtimeFailure
            ? getRuntimeAnalysisFailureDetail(runtimeFailure)
          : "parser가 화면에서 버프 아이콘 칸을 찾은 결과입니다.",
        metrics: [
          metric("parser-boxes", "검출 칸", formatCount(parserCount)),
          metric("parser-engine", "parser 방식", firstString(savedParser.engine) ?? "미기록"),
          metric(
            "parser-provider",
            "저장 실행 방식",
            formatPrecisionParserExecutionProvider(
              savedParserRuntime.executionProvider,
            ),
          ),
          metric(
            "parser-performance",
            "공유 parser 처리",
            formatMilliseconds(savedParserPerformance.detectMs),
          ),
          metric(
            "parser-version",
            "저장 parser",
            firstString(savedParser.version, moduleVersions.parser) ?? "없음",
          ),
          metric(
            "parser-fallback",
            "fallback 사유",
            firstString(savedParser.fallbackReason) ?? "없음",
          ),
          ...(parserFailure
            ? getPrecisionParserFailureMetrics(parserFailure)
            : []),
        ],
        evidenceIds: evidenceIdsForStage(collector.evidence, "detection"),
      }),
      stage({
        id: "identity",
        label: "대상 버프 판정",
        status: parserFailure || runtimeFailure
          ? "unavailable"
          : stageStatusFromCount(targetCount, { zero: "warning" }),
        summary: parserFailure || runtimeFailure ? "앞 단계 실패로 확인 불가" : `${formatCount(targetCount)} 일치`,
        detail: parserFailure || runtimeFailure
          ? "앞 단계의 분석 결과가 없어 matcher 판정을 확인할 수 없습니다."
          : "각 아이콘을 선택된 버프 그룹과 비교한 결과입니다.",
        metrics: [
          metric("targets", "대상 일치", formatCount(targetCount)),
          metric(
            "matcher-decision",
            "저장 판정",
            formatBuffExpiryMatcherDecision(matcherEvidence.decisionReason),
          ),
          ...getSavedBuffExpiryMatcherMetrics(moduleVersions),
        ],
        evidenceIds: evidenceIdsForStage(collector.evidence, "identity"),
      }),
      stage({
        id: "reading",
        label: "남은 시간 판독",
        status: parserFailure || runtimeFailure
          ? "unavailable"
          : stageStatusFromCount(usableCountdownCount, { zero: "blocked" }),
        summary: parserFailure || runtimeFailure
          ? "앞 단계 실패로 확인 불가"
          : `${usableCountdownCount}개 유효 시간`,
        detail: parserFailure || runtimeFailure
          ? "앞 단계의 분석 결과가 없어 남은 시간 판독을 확인할 수 없습니다."
          : "일치한 아이콘에서 추적에 사용할 수 있는 숫자를 읽은 결과입니다.",
        metrics: [
          metric("countdowns", "유효 시간", `${usableCountdownCount}개`),
          metric(
            "countdown-version",
            "저장 숫자 인식기",
            String(moduleVersions.countdown ?? moduleVersions.countdownModel ?? "없음"),
          ),
        ],
        evidenceIds: evidenceIdsForStage(collector.evidence, "reading"),
      }),
      stage({
        id: "runtime",
        label: "종료 시각 추적",
        status: parserFailure || runtimeFailure
          ? "unavailable"
          : trackCount > 0
            ? "complete"
            : pendingTrackCount > 0
              ? "warning"
              : "blocked",
        summary: parserFailure || runtimeFailure
          ? "앞 단계 실패로 확인 불가"
          : `추적 ${trackCount}개 · 확인 중 ${pendingTrackCount}개`,
        detail: parserFailure || runtimeFailure
          ? "이번 프레임에는 추적에 전달할 인식 결과가 생성되지 않았습니다."
          : "시간 흐름이 자연스럽게 감소하는지 확인하고 종료 시각을 확정합니다.",
        metrics: [
          metric("tracks", "추적", `${trackCount}개`),
          metric("pending", "확인 중", `${pendingTrackCount}개`),
        ],
        evidenceIds: evidenceIdsForStage(collector.evidence, "runtime"),
      }),
      stage({
        id: "alert",
        label: "현재 코드 판정 비교",
        status: getAlertPlaybackStageStatus(playback, decisionStageStatus(verdict.tone)),
        summary: getAlertPlaybackSummary(
          playback,
          replay.dueDecision?.shouldAlert ? "현재 코드에서 대상" : "현재 코드에서 대상 아님",
        ),
        detail: playback.status === "none"
          ? `${replay.dueDecision?.reason ?? replay.reason ?? "저장된 상태를 현재 코드에 적용했습니다."} 이 결과는 제보 당시 실행 기록이 아닙니다.`
          : playback.detail,
        replayCoverage: "decision-replayed",
        metrics: [
          metric("clusters", "종료 묶음", `${replay.clusters.length}개`),
          metric("lead", "알림 기준", `${replay.alertLeadSeconds ?? 0}초 전`),
        ],
        evidenceIds: evidenceIdsForStage(collector.evidence, "alert"),
      }),
    ];

    return {
      feature: "buff-expiry",
      featureLabel: "버프 종료 알림",
      modeLabel: "정밀 감지",
      title: sample.id === "unknown" ? "버프 종료 제보" : `버프 종료 제보 ${sample.id.slice(0, 8)}`,
      verdict,
      summaryMetrics: [
        metric("parser", "버프칸", formatCount(parserCount)),
        metric("target", "대상 일치", formatCount(targetCount)),
        metric("countdown", "유효 시간", `${usableCountdownCount}개`),
        metric("tracking", "추적", `${trackCount}개`),
        metric("processing", "처리 시간", formatMilliseconds(performance.totalMs)),
        metric("playback", "실제 재생", playback.label, playback.detail, playback.tone),
      ],
      diagnostics,
      stages,
      evidence: collector.evidence,
    };
  },
};

function addBuffExpiryEvidence(
  sample: Parameters<typeof createEvidenceCollector>[0],
  collector: ReturnType<typeof createEvidenceCollector>,
) {
  const sampleNode = asRecord(sample.body.sample);
  const next = asRecord(sampleNode.next);
  asArray(asRecord(next.replay).frames).slice(-20).forEach((entry, index) => {
    const frame = asRecord(entry);
    collector.add({
      id: `buff-frame-${index}`,
      group: "runtime",
      label: `최근 버프칸 ${index + 1}`,
      description: `저장 이유: ${String(frame.reason ?? "frame")}`,
      value: frame.imageDataUrl,
      capturedAt: frame.sampledAt,
      stageId: "runtime",
      metadata: [
        metric("boxes", "버프칸", formatCount(frame.boxCount)),
        metric("targets", "대상", formatCount(frame.targetObservationCount)),
      ],
    });
  });
  asArray(next.iconEvidence).slice(0, 24).forEach((entry, index) => {
    const icon = asRecord(entry);
    collector.add({
      id: `buff-icon-${index}`,
      group: "recognition",
      label: String(icon.group ?? `아이콘 ${index + 1}`),
      description: "matcher에 입력된 정규화 아이콘입니다.",
      value: icon.normalizedIconDataUrl,
      stageId: "identity",
      metadata: [
        metric("score", "일치 점수", formatScore(icon.score)),
        metric("margin", "점수 차이", formatScore(icon.margin)),
        metric("bundle", "저장 번들", String(icon.bundleId ?? "없음")),
        metric("model", "저장 matcher", String(icon.modelVersion ?? "없음")),
        metric("gate-score", "형태 점수", formatScore(icon.gateScore)),
        metric("gate-margin", "형태 여유", formatScore(icon.gateMargin)),
        metric(
          "decision",
          "판정",
          formatBuffExpiryMatcherDecision(
            typeof icon.decisionReason === "string" ? icon.decisionReason : null,
          ),
        ),
      ],
    });
  });
}

function getBuffExpiryMatcherEvidence(identity: Record<string, unknown>) {
  const observations = asArray(identity.observations);
  const candidates = observations.flatMap((entry) =>
    asArray(asRecord(asRecord(entry).identity).candidates).map(asRecord)
  );
  const observationReasons = observations.flatMap((entry) => {
    const reason = asRecord(asRecord(entry).identity).decisionReason;
    return typeof reason === "string" ? [reason] : [];
  });
  const candidateReasons = candidates.flatMap((candidate) =>
    typeof candidate.decisionReason === "string" ? [candidate.decisionReason] : []
  );
  const reasons = [...observationReasons, ...candidateReasons];
  const decisionReason = [
    "cross_bundle_conflict",
    "positive_gate_below_threshold",
    "base_below_threshold",
    "target_accepted",
  ].find((reason) => reasons.includes(reason)) ?? reasons[0] ?? null;
  return { decisionReason };
}

function getBuffExpiryMatcherDiagnosis(decisionReason: string | null) {
  if (decisionReason === "positive_gate_below_threshold") {
    return {
      title: "대상 분류 후 아이콘 형태 검증 미통과",
      detail: "1차 대상 분류는 통과했지만 해당 버프의 형태 기준을 통과하지 못했습니다.",
    };
  }
  if (decisionReason === "cross_bundle_conflict") {
    return {
      title: "여러 버프 모델의 판정이 충돌함",
      detail: "둘 이상의 독립 모델이 같은 아이콘을 통과시켜 안전하게 대상을 확정하지 않았습니다.",
    };
  }
  if (decisionReason === "base_below_threshold") {
    return {
      title: "버프칸은 찾았지만 대상 분류 기준 미달",
      detail: "선택한 버프 모델의 1차 분류 기준을 통과한 아이콘이 없습니다.",
    };
  }
  return { title: "버프칸은 찾았지만 대상 버프가 없음", detail: null };
}

function getSavedBuffExpiryMatcherMetrics(moduleVersions: Record<string, unknown>) {
  const bundles = asArray(moduleVersions.matcherBundles).slice(0, 4);
  if (!bundles.length) {
    return [
      metric("matcher-version", "저장 matcher", String(moduleVersions.matcherModel ?? "없음")),
    ];
  }
  return bundles.map((entry, index) => {
    const bundle = asRecord(entry);
    const group = String(bundle.group ?? `모델 ${index + 1}`);
    const value = [bundle.bundleId, bundle.modelVersion].filter(Boolean).join(" · ") || "없음";
    return metric(`matcher-bundle-${index}`, `저장 모델 ${group}`, value);
  });
}

function formatBuffExpiryMatcherDecision(value: string | null): string {
  const labels: Record<string, string> = {
    target_accepted: "대상 일치",
    base_below_threshold: "1차 분류 기준 미달",
    positive_gate_below_threshold: "아이콘 형태 검증 기준 미달",
    cross_bundle_conflict: "모델 간 판정 충돌",
  };
  return value ? labels[value] ?? value : "없음";
}
