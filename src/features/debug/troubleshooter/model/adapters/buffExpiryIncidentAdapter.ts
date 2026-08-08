import {
  asArray,
  asRecord,
  firstNumber,
  firstString,
  formatCount,
  formatPrecisionParserExecutionProvider,
  formatScore,
} from "../sample";
import {
  buildVerdict,
  collectIncidentDegradationReasons,
  createEvidenceCollector,
  diagnostic,
  metric,
  stage,
} from "../shared";
import type {
  FeatureAnalysis,
  NormalizedDebugSample,
  PipelineStageStatus,
  TroubleshooterDiagnostic,
} from "../types";

const INCIDENT_SCHEMA = "buff-expiry-incident-evidence-v1";

export function analyzeBuffExpiryIncidentEvidence(
  sample: NormalizedDebugSample,
): FeatureAnalysis | null {
  const sampleNode = asRecord(sample.body.sample);
  const evidence = asRecord(sampleNode.buffExpiryEvidence);
  if (firstString(evidence.schemaVersion) !== INCIDENT_SCHEMA) {
    return null;
  }

  const selection = asRecord(evidence.selection);
  const frames = asArray(evidence.frames).map(asRecord);
  const observations = asArray(evidence.observations).map(asRecord);
  const episodes = asArray(evidence.episodes).map(asRecord);
  const transitions = asArray(evidence.transitions).map(asRecord);
  const cycles = asArray(evidence.cycles).map(asRecord);
  const cycleEvents = asArray(evidence.cycleEvents).map(asRecord);
  const attempts = asArray(evidence.attempts).map(asRecord);
  const omissions = asArray(evidence.omissions).map(asRecord);
  const media = asArray(evidence.media).map(asRecord);
  const primaryFrame = selectPrimaryFrame(frames, selection.selectedEventAt);
  const recognition = asRecord(primaryFrame?.recognition);
  const runtimeFailure = asRecord(primaryFrame?.runtimeFailure);
  const parser = asRecord(primaryFrame?.parser);
  const acceptedObservations = observations.filter(
    (entry) => entry.targetAccepted === true,
  );
  const rejectedObservations = observations.filter(
    (entry) => entry.targetAccepted !== true,
  );
  const countdowns = acceptedObservations.map((entry) =>
    asRecord(entry.countdown),
  );
  const acceptedCountdownCount = countdowns.filter(
    (entry) => entry.decision === "accepted",
  ).length;
  const rejectedCountdownCount = countdowns.filter(
    (entry) =>
      entry.decision === "missing" ||
      entry.decision === "rejected" ||
      entry.decision === "implausible",
  ).length;
  const confirmedEpisodeCount = episodes.filter(
    (entry) => entry.confirmedAt !== null && entry.confirmedAt !== undefined,
  ).length;
  const pendingEpisodeCount = episodes.filter(
    (entry) => entry.status === "pending",
  ).length;
  const parserBoxCount = firstNumber(recognition.parserBoxCount);
  const localizedBoxCount = firstNumber(
    recognition.localizedBoxCount,
    parserBoxCount,
  );
  const spatialExcludedBoxCount = firstNumber(
    recognition.spatialExcludedBoxCount,
    0,
  );
  const eligibleBoxCount = firstNumber(recognition.eligibleBoxCount);
  const selectedCandidateCount = firstNumber(
    recognition.selectedCandidateCount,
  );
  const acceptedTargetCount = firstNumber(
    recognition.acceptedTargetCount,
    acceptedObservations.length,
  );
  const scenario = firstString(asRecord(sample.body.reportIssue).scenario);
  const degradationReasons = collectIncidentDegradationReasons(selection, omissions);
  const collector = createEvidenceCollector(sample);
  const incidentEvidenceIds = addIncidentMedia({
    collector,
    media,
    frames,
  });
  addReportTimeEvidence(sample, collector);

  const diagnostics = createIncidentDiagnostics({
    selection,
    scenario,
    runtimeFailure,
    parserBoxCount,
    localizedBoxCount,
    eligibleBoxCount,
    selectedCandidateCount,
    acceptedObservations,
    rejectedObservations,
    acceptedCountdownCount,
    rejectedCountdownCount,
    confirmedEpisodeCount,
    pendingEpisodeCount,
    cycles,
    attempts,
    degradationReasons,
  });
  const verdict = buildVerdict(diagnostics, {
    title: "선택한 사건 증거를 확인했습니다",
    detail:
      "제보 당시 선택된 사건 체인과 제보 전송 시점 참고 자료를 분리해 표시합니다.",
  });
  const playback = summarizePlayback(cycles, attempts);
  const cycleSummary = summarizeCycles(cycles, cycleEvents);
  const reportTime = readReportTimeContext(sample);

  const stages = [
    stage({
      id: "input",
      label: "사건 입력 화면",
      status: incidentEvidenceIds.length > 0
        ? degradationReasons.some(isMediaDegradationReason)
          ? "warning"
          : "complete"
        : "unavailable",
      summary: incidentEvidenceIds.length > 0
        ? `선택 사건 이미지 ${incidentEvidenceIds.length}개`
        : "선택 사건 이미지 없음",
      detail:
        "제보 창을 열기 전에 실제 런타임이 분석한 사건 프레임입니다. 아래 전송 시점 화면과 구분해서 해석합니다.",
      metrics: [
        metric("incident-frames", "선택 프레임", `${frames.length}개`),
        metric("incident-media", "보관 이미지", `${media.length}개`),
        metric(
          "incident-selection",
          "선택 상태",
          formatSelectionStatus(selection.status, selection.support),
        ),
      ],
      evidenceIds: incidentEvidenceIds,
    }),
    stage({
      id: "detection",
      label: "사건 버프칸 탐색",
      status: getDetectionStatus({
        hasFrame: Boolean(primaryFrame),
        hasRuntimeFailure: Object.keys(runtimeFailure).length > 0,
        parserBoxCount,
        localizedBoxCount,
        eligibleBoxCount,
      }),
      summary: Object.keys(runtimeFailure).length > 0
        ? `실행 오류 · ${String(runtimeFailure.code ?? "원인 미기록")}`
        : parserBoxCount === null
          ? "parser 결과 미기록"
          : `${parserBoxCount}개 후보 · 실제 버프칸 ${formatCount(localizedBoxCount)} · 행 규칙 통과 ${formatCount(eligibleBoxCount)}`,
      detail: Object.keys(runtimeFailure).length > 0
        ? formatRuntimeFailure(runtimeFailure)
        : "동일한 사건 프레임에서 parser 후보, 실제 버프칸 묶음 분리, 상단 절반 제외 결과를 순서대로 확인합니다.",
      metrics: [
        metric("incident-parser-boxes", "parser 후보", formatCount(parserBoxCount)),
        metric(
          "incident-parser-rows",
          "parser 후보 행",
          formatCount(recognition.parsedRowCount),
        ),
        metric(
          "incident-localized-boxes",
          "실제 버프칸",
          formatCount(localizedBoxCount),
        ),
        metric(
          "incident-localized-rows",
          "실제 버프칸 행",
          formatCount(recognition.localizedRowCount),
        ),
        metric(
          "incident-spatial-excluded",
          "외부 UI 제외",
          formatCount(spatialExcludedBoxCount),
        ),
        metric(
          "incident-upper-excluded",
          "상단 제외",
          formatCount(recognition.upperExcludedBoxCount),
        ),
        metric("incident-eligible-boxes", "행 규칙 통과", formatCount(eligibleBoxCount)),
        metric("incident-parser-engine", "사건 parser", firstString(parser.engine) ?? "미기록"),
        metric(
          "incident-parser-provider",
          "사건 실행 방식",
          formatPrecisionParserExecutionProvider(parser.provider),
        ),
        metric(
          "incident-parser-version",
          "사건 parser 버전",
          firstString(parser.version, parser.modelVersion) ?? "미기록",
        ),
      ],
      evidenceIds: incidentEvidenceIds,
    }),
    stage({
      id: "identity",
      label: "사건 대상 버프 판정",
      status: acceptedObservations.length > 0
        ? "complete"
        : rejectedObservations.length > 0 || (selectedCandidateCount ?? 0) > 0
          ? "warning"
          : parserBoxCount === 0
            ? "unavailable"
            : "blocked",
      summary: `일치 ${acceptedObservations.length}개 · 탈락 ${rejectedObservations.length}개`,
      detail:
        "선택된 대상 그룹에 대해 당시 독립 matcher 번들이 내린 결과만 표시합니다.",
      metrics: [
        metric("incident-selected-group", "문제 대상", formatBuffGroup(selection.affectedGroup)),
        metric("incident-candidates", "선택 그룹 후보", formatCount(selectedCandidateCount)),
        metric("incident-accepted", "대상 일치", `${acceptedObservations.length}개`),
        metric(
          "incident-decision",
          "대표 판정",
          formatIncidentDecisionReason(getPrimaryDecisionReason(observations)),
        ),
        ...getBundleDecisionMetrics(observations),
      ],
      evidenceIds: incidentEvidenceIds,
    }),
    stage({
      id: "reading",
      label: "사건 남은 시간 판독",
      status: acceptedObservations.length === 0
        ? "unavailable"
        : acceptedCountdownCount > 0
          ? rejectedCountdownCount > 0
            ? "warning"
            : "complete"
          : "blocked",
      summary: `사용 ${acceptedCountdownCount}개 · 미사용 ${rejectedCountdownCount}개`,
      detail:
        "대상 아이콘과 같은 프레임에서 숫자 인식기가 반환한 값과 채택 여부입니다.",
      metrics: [
        metric("incident-countdown-accepted", "사용한 값", `${acceptedCountdownCount}개`),
        metric("incident-countdown-rejected", "미사용 값", `${rejectedCountdownCount}개`),
        metric(
          "incident-countdown-values",
          "판독 값",
          formatCountdownValues(countdowns),
        ),
      ],
      evidenceIds: incidentEvidenceIds,
    }),
    stage({
      id: "runtime",
      label: "사건 종료 시각 추적",
      status: confirmedEpisodeCount > 0
        ? "complete"
        : pendingEpisodeCount > 0
          ? "warning"
          : acceptedCountdownCount > 0
            ? "blocked"
            : "unavailable",
      summary: `확정 ${confirmedEpisodeCount}개 · 확인 중 ${pendingEpisodeCount}개`,
      detail:
        "같은 아이콘 세대의 확인, 갱신, 일시 누락, 소실 기록을 안정된 episode ID로 연결합니다.",
      metrics: [
        metric("incident-episodes", "감지 구간", `${episodes.length}개`),
        metric("incident-confirmed", "확정", `${confirmedEpisodeCount}개`),
        metric("incident-pending", "확인 중", `${pendingEpisodeCount}개`),
        metric("incident-transitions", "상태 변화", summarizeTransitions(transitions)),
      ],
      evidenceIds: incidentEvidenceIds,
    }),
    stage({
      id: "alert",
      label: "사건 알림 예약·재생 기록",
      status: getAlertStageStatus({ cycles, attempts, confirmedEpisodeCount }),
      summary: playback.label,
      detail: playback.detail,
      replayCoverage: "stored-evidence",
      metrics: [
        metric("incident-cycles", "알림 주기", cycleSummary),
        metric("incident-attempts", "재생 시도", `${attempts.length}개`),
        metric("incident-playback", "브라우저 재생", playback.label),
      ],
      evidenceIds: incidentEvidenceIds,
    }),
    stage({
      id: "report-time",
      label: "제보 전송 시점 참고",
      status: reportTime.hasContext ? "complete" : "unavailable",
      summary: reportTime.hasContext
        ? `후보 ${formatCount(reportTime.parserBoxCount)} · 실제 버프칸 ${formatCount(reportTime.localizedBoxCount)} · 대상 ${formatCount(reportTime.targetCount)}`
        : "전송 시점 분석 미기록",
      detail:
        "제보 버튼을 누른 뒤 다음 1000ms 샘플에서 수집한 참고 자료입니다. 위 사건의 인식·추적·알림 결과를 대신하거나 덮어쓰지 않습니다.",
      replayCoverage: "stored-evidence",
      metrics: [
        metric("report-time-parser", "전송 시점 parser 후보", formatCount(reportTime.parserBoxCount)),
        metric(
          "report-time-localized",
          "전송 시점 실제 버프칸",
          formatCount(reportTime.localizedBoxCount),
        ),
        metric(
          "report-time-spatial-excluded",
          "전송 시점 외부 UI 제외",
          formatCount(reportTime.spatialExcludedBoxCount),
        ),
        metric("report-time-target", "전송 시점 대상", formatCount(reportTime.targetCount)),
        metric("report-time-source", "별도 시점", "예"),
      ],
      evidenceIds: collector.evidence
        .filter((entry) => entry.stageId === "report-time")
        .map((entry) => entry.id),
    }),
  ];

  return {
    feature: "buff-expiry",
    featureLabel: "버프 종료 알림",
    modeLabel: "정밀 감지",
    title:
      sample.id === "unknown"
        ? "버프 종료 제보"
        : `버프 종료 제보 ${sample.id.slice(0, 8)}`,
    verdict,
    summaryMetrics: [
      metric(
        "incident-selection-summary",
        "선택 사건",
        formatSelectionStatus(selection.status, selection.support),
      ),
      metric("incident-parser-summary", "버프칸", formatCount(parserBoxCount)),
      metric("incident-target-summary", "대상 일치", `${acceptedObservations.length}개`),
      metric("incident-countdown-summary", "유효 시간", `${acceptedCountdownCount}개`),
      metric("incident-tracking-summary", "확정 추적", `${confirmedEpisodeCount}개`),
      metric("incident-playback-summary", "실제 재생", playback.label),
    ],
    diagnostics,
    stages,
    evidence: collector.evidence,
  };
}

function selectPrimaryFrame(
  frames: Record<string, unknown>[],
  selectedEventAt: unknown,
) {
  const eventAt = firstNumber(selectedEventAt);
  return [...frames].sort((left, right) => {
    const leftAt = firstNumber(left.sampledAt) ?? 0;
    const rightAt = firstNumber(right.sampledAt) ?? 0;
    if (eventAt !== null) {
      const distance = Math.abs(leftAt - eventAt) - Math.abs(rightAt - eventAt);
      if (distance !== 0) return distance;
    }
    return rightAt - leftAt;
  })[0] ?? null;
}

function addIncidentMedia({
  collector,
  media,
  frames,
}: {
  collector: ReturnType<typeof createEvidenceCollector>;
  media: Record<string, unknown>[];
  frames: Record<string, unknown>[];
}) {
  const frameById = new Map(
    frames.map((frame) => [firstString(frame.id), frame]),
  );
  const ids: string[] = [];
  media.slice(0, 8).forEach((entry, index) => {
    const frameId = firstString(entry.frameId);
    const frame = frameById.get(frameId) ?? {};
    const recognition = asRecord(frame.recognition);
    const id = `buff-incident-frame-${index}`;
    collector.add({
      id,
      group: "source",
      label: `선택 사건 프레임 ${index + 1}`,
      description: `보관 이유: ${formatMediaReason(firstString(entry.reason))}`,
      value: entry.dataUrl,
      capturedAt: entry.sampledAt,
      stageId: "input",
      metadata: [
        metric("incident-media-boxes", "버프칸", formatCount(recognition.parserBoxCount)),
        metric("incident-media-targets", "대상", formatCount(recognition.acceptedTargetCount)),
      ],
    });
    if (collector.evidence.some((asset) => asset.id === id)) ids.push(id);
  });
  return ids;
}

function addReportTimeEvidence(
  sample: NormalizedDebugSample,
  collector: ReturnType<typeof createEvidenceCollector>,
) {
  const sampleNode = asRecord(sample.body.sample);
  const source = asRecord(sampleNode.source);
  collector.add({
    id: "buff-report-time-source",
    group: "source",
    label: "제보 전송 시점 입력",
    description:
      "제보 요청 뒤 다음 정상 샘플에서 받은 참고 화면이며 선택 사건 프레임이 아닙니다.",
    value: firstString(source.dataUrl, sampleNode.rawDataUrl),
    capturedAt: sampleNode.sampledAt,
    stageId: "report-time",
  });
  collector.add({
    id: "buff-report-time-full-frame",
    group: "source",
    label: "제보 전송 시점 전체 화면",
    description: "제보 전송 시점의 위치 참고용 전체 화면입니다.",
    value: sampleNode.fullFrameDataUrl,
    capturedAt: sampleNode.sampledAt,
    stageId: "report-time",
  });
}

function createIncidentDiagnostics({
  selection,
  scenario,
  runtimeFailure,
  parserBoxCount,
  localizedBoxCount,
  eligibleBoxCount,
  selectedCandidateCount,
  acceptedObservations,
  rejectedObservations,
  acceptedCountdownCount,
  rejectedCountdownCount,
  confirmedEpisodeCount,
  pendingEpisodeCount,
  cycles,
  attempts,
  degradationReasons,
}: {
  selection: Record<string, unknown>;
  scenario: string | null;
  runtimeFailure: Record<string, unknown>;
  parserBoxCount: number | null;
  localizedBoxCount: number | null;
  eligibleBoxCount: number | null;
  selectedCandidateCount: number | null;
  acceptedObservations: Record<string, unknown>[];
  rejectedObservations: Record<string, unknown>[];
  acceptedCountdownCount: number;
  rejectedCountdownCount: number;
  confirmedEpisodeCount: number;
  pendingEpisodeCount: number;
  cycles: Record<string, unknown>[];
  attempts: Record<string, unknown>[];
  degradationReasons: string[];
}): TroubleshooterDiagnostic[] {
  const diagnostics = degradationReasons.map((reason) =>
    createOmissionDiagnostic(reason),
  );
  if (selection.support === "unsupported") {
    diagnostics.push(
      diagnostic(
        "buff-incident-selection-unavailable",
        "critical",
        "선택한 사건 기록을 찾지 못했습니다",
        "보관 범위와 대상 조건에 맞는 런타임 사건이 없어 제보 당시 원인을 확정할 수 없습니다.",
        "input",
      ),
    );
    return diagnostics;
  }
  if (Object.keys(runtimeFailure).length > 0) {
    diagnostics.push(
      diagnostic(
        "buff-incident-runtime-failed",
        "critical",
        "사건 분석 실행 중 오류가 발생했습니다",
        formatRuntimeFailure(runtimeFailure),
        runtimeFailure.stage === "frame-capture" ? "input" : "detection",
      ),
    );
    return diagnostics;
  }
  if (parserBoxCount === 0) {
    diagnostics.push(
      diagnostic(
        "buff-incident-no-boxes",
        "critical",
        "사건 프레임에서 버프칸을 찾지 못했습니다",
        "제보 당시 parser 결과가 0칸이어서 matcher와 숫자 판독으로 이어지지 않았습니다.",
        "detection",
      ),
    );
    return diagnostics;
  }
  if (
    parserBoxCount !== null &&
    parserBoxCount > 0 &&
    localizedBoxCount === 0
  ) {
    diagnostics.push(
      diagnostic(
        "buff-incident-localization-unavailable",
        "critical",
        "parser 후보에서 실제 버프칸 묶음을 확정하지 못했습니다",
        "화면의 사각형 후보는 찾았지만 우상단에 연결된 버프칸으로 판정할 묶음이 없어 matcher로 전달하지 않았습니다.",
        "detection",
      ),
    );
    return diagnostics;
  }
  if (parserBoxCount !== null && eligibleBoxCount === 0) {
    diagnostics.push(
      diagnostic(
        "buff-incident-row-ineligible",
        "warning",
        "찾은 버프칸이 모두 제외 행에 있었습니다",
        "제보 당시 버프칸은 있었지만 버프 종료 알림의 하단 행 검색 범위에 남은 칸이 없습니다.",
        "detection",
      ),
    );
  }
  if (
    acceptedObservations.length === 0 &&
    (rejectedObservations.length > 0 || (selectedCandidateCount ?? 0) > 0)
  ) {
    const reason = getPrimaryDecisionReason(rejectedObservations);
    const diagnosis = getIncidentMatcherDiagnosis(reason);
    diagnostics.push(
      diagnostic(
        "buff-incident-no-target",
        "warning",
        diagnosis.title,
        diagnosis.detail,
        "identity",
      ),
    );
  }
  if (acceptedObservations.length > 0 && acceptedCountdownCount === 0) {
    diagnostics.push(
      diagnostic(
        "buff-incident-no-countdown",
        "critical",
        "대상은 찾았지만 사용할 남은 시간이 없었습니다",
        rejectedCountdownCount > 0
          ? `제보 당시 숫자 판독 ${rejectedCountdownCount}개가 누락, 거절 또는 비정상 흐름으로 처리됐습니다.`
          : "제보 당시 대상 아이콘에 숫자 판독 결과가 생성되지 않았습니다.",
        "reading",
      ),
    );
  }
  if (
    acceptedCountdownCount > 0 &&
    confirmedEpisodeCount === 0 &&
    pendingEpisodeCount === 0
  ) {
    diagnostics.push(
      diagnostic(
        "buff-incident-no-track",
        "critical",
        "판독 결과가 추적 구간으로 이어지지 않았습니다",
        "대상과 숫자는 있었지만 같은 사건에 pending 또는 confirmed episode가 생성되지 않았습니다.",
        "runtime",
      ),
    );
  }
  const firedCycles = cycles.filter((entry) => entry.status === "fired");
  if (scenario === "recognized-no-alert" && confirmedEpisodeCount > 0 && cycles.length === 0) {
    diagnostics.push(
      diagnostic(
        "buff-incident-not-scheduled",
        "critical",
        "감지는 확정됐지만 알림 주기가 생성되지 않았습니다",
        "확정된 episode와 연결된 예약·취소·실행 주기가 없습니다.",
        "alert",
      ),
    );
  }
  if (
    (scenario === "playback-missing" || firedCycles.length > 0) &&
    firedCycles.length > 0 &&
    attempts.length === 0
  ) {
    diagnostics.push(
      diagnostic(
        "buff-incident-playback-not-requested",
        "critical",
        "알림 시각은 도달했지만 소리 재생 요청이 없습니다",
        "같은 사건의 fired 주기는 있으나 연결된 브라우저 재생 시도가 기록되지 않았습니다.",
        "alert",
      ),
    );
  }
  const failedAttempt = attempts.find((entry) => entry.status === "failed");
  if (failedAttempt) {
    diagnostics.push(
      diagnostic(
        "buff-incident-playback-failed",
        "critical",
        "브라우저 소리 재생이 실패했습니다",
        firstString(failedAttempt.error) ?? "재생 실패 원인은 기록되지 않았습니다.",
        "alert",
      ),
    );
  }
  if (
    scenario === "duplicate-alert" &&
    attempts.filter((entry) => entry.status === "started").length > 1
  ) {
    diagnostics.push(
      diagnostic(
        "buff-incident-duplicate-playback",
        "critical",
        "같은 사건에서 재생이 여러 번 시작됐습니다",
        "선택된 사건 체인에 시작된 재생 시도가 둘 이상 연결돼 있습니다.",
        "alert",
      ),
    );
  }
  return diagnostics;
}

function readReportTimeContext(sample: NormalizedDebugSample) {
  const sampleNode = asRecord(sample.body.sample);
  const next = asRecord(sampleNode.next);
  const parser = asRecord(next.parser);
  const localization = asRecord(parser.localization);
  const identity = asRecord(next.identity);
  const source = asRecord(sampleNode.source);
  const localizedBoxCount = firstNumber(
    localization.localizedBoxCount,
    parser.boxCount,
  );
  const parserBoxCount = firstNumber(
    localization.parserBoxCount,
    parser.boxCount,
  );
  const spatialExcludedBoxCount = firstNumber(
    localization.spatialExcludedBoxCount,
    parserBoxCount !== null && localizedBoxCount !== null
      ? Math.max(0, parserBoxCount - localizedBoxCount)
      : null,
  );
  const targetCount = identity.targetObservations
    ? asArray(identity.targetObservations).length
    : null;
  return {
    hasContext:
      Boolean(firstString(source.dataUrl, sampleNode.rawDataUrl)) ||
      parserBoxCount !== null ||
      targetCount !== null,
    parserBoxCount,
    localizedBoxCount,
    spatialExcludedBoxCount,
    targetCount,
  };
}

function getDetectionStatus({
  hasFrame,
  hasRuntimeFailure,
  parserBoxCount,
  localizedBoxCount,
  eligibleBoxCount,
}: {
  hasFrame: boolean;
  hasRuntimeFailure: boolean;
  parserBoxCount: number | null;
  localizedBoxCount: number | null;
  eligibleBoxCount: number | null;
}): PipelineStageStatus {
  if (!hasFrame) return "unavailable";
  if (hasRuntimeFailure || parserBoxCount === 0) return "blocked";
  if (parserBoxCount === null) return "unavailable";
  if (localizedBoxCount === 0) return "blocked";
  if (eligibleBoxCount === 0) return "warning";
  return "complete";
}

function getAlertStageStatus({
  cycles,
  attempts,
  confirmedEpisodeCount,
}: {
  cycles: Record<string, unknown>[];
  attempts: Record<string, unknown>[];
  confirmedEpisodeCount: number;
}): PipelineStageStatus {
  if (attempts.some((entry) => entry.status === "failed")) return "blocked";
  if (attempts.some((entry) => entry.status === "started")) return "complete";
  if (attempts.some((entry) => entry.status === "requested")) return "warning";
  if (cycles.some((entry) => entry.status === "fired")) return "blocked";
  if (cycles.some((entry) => entry.status === "registered" || entry.status === "rescheduled")) {
    return "pending";
  }
  if (cycles.length > 0) return "warning";
  return confirmedEpisodeCount > 0 ? "blocked" : "unavailable";
}

function summarizePlayback(
  cycles: Record<string, unknown>[],
  attempts: Record<string, unknown>[],
) {
  const latest = [...attempts].sort(
    (left, right) =>
      (firstNumber(right.requestedAt) ?? 0) - (firstNumber(left.requestedAt) ?? 0),
  )[0];
  if (latest?.status === "failed") {
    return {
      label: "재생 실패",
      detail: firstString(latest.error) ?? "브라우저 재생 요청이 실패했습니다.",
    };
  }
  if (latest?.status === "started") {
    return {
      label: "재생 시작 기록 있음",
      detail:
        "브라우저가 play() 시작을 수락했습니다. 사용자가 실제로 들었는지와 OS 출력 장치는 확인할 수 없습니다.",
    };
  }
  if (latest?.status === "requested") {
    return {
      label: "재생 요청만 기록",
      detail: "재생을 요청했지만 시작 또는 실패 결과가 보관 구간에 없습니다.",
    };
  }
  if (cycles.some((entry) => entry.status === "fired")) {
    return {
      label: "실행 주기 있음 · 재생 요청 없음",
      detail: "알림 시각 도달 기록은 있으나 같은 주기의 재생 시도가 없습니다.",
    };
  }
  if (cycles.some((entry) => entry.status === "suppressed")) {
    return {
      label: "알림 억제",
      detail: "런타임 정책에 따라 알림 주기가 억제됐습니다.",
    };
  }
  if (cycles.some((entry) => entry.status === "cancelled")) {
    return {
      label: "알림 예약 취소",
      detail: "등록된 알림 주기가 실행 전에 취소됐습니다.",
    };
  }
  if (cycles.length > 0) {
    return {
      label: "알림 예약 중",
      detail: "선택 사건의 알림 주기가 등록됐지만 아직 실행 기록은 없습니다.",
    };
  }
  return {
    label: "알림 주기 기록 없음",
    detail: "선택 사건과 연결된 예약 또는 재생 기록이 없습니다.",
  };
}

function summarizeCycles(
  cycles: Record<string, unknown>[],
  cycleEvents: Record<string, unknown>[],
) {
  if (!cycles.length && !cycleEvents.length) return "없음";
  const statuses = [
    ...cycles.map((entry) => firstString(entry.status)),
    ...cycleEvents.map((entry) => firstString(entry.status)),
  ].filter((entry): entry is string => Boolean(entry));
  return [...new Set(statuses)].map(formatCycleStatus).join(" · ") || `${cycles.length}개`;
}

function summarizeTransitions(transitions: Record<string, unknown>[]) {
  const counts = new Map<string, number>();
  transitions.forEach((entry) => {
    const kind = firstString(entry.kind) ?? "unknown";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  });
  if (!counts.size) return "없음";
  return [...counts.entries()]
    .map(([kind, count]) => `${formatTransitionKind(kind)} ${count}`)
    .join(" · ");
}

function getBundleDecisionMetrics(observations: Record<string, unknown>[]) {
  return observations
    .flatMap((entry) => asArray(entry.bundleDecisions).map(asRecord))
    .slice(0, 4)
    .map((entry, index) =>
      metric(
        `incident-bundle-${index}`,
        `모델 ${formatBuffGroup(entry.group)}`,
        `${entry.accepted === true ? "통과" : "탈락"} · 점수 ${formatScore(entry.score)} · 여유 ${formatScore(entry.margin)}`,
      ),
    );
}

function getPrimaryDecisionReason(observations: Record<string, unknown>[]) {
  const reasons = observations
    .map((entry) => firstString(entry.decisionReason))
    .filter((entry): entry is string => Boolean(entry));
  const priority = [
    "cross_bundle_conflict",
    "upper_rows_target_excluded",
    "bottom_first_target_excluded",
    "positive_gate_below_threshold",
    "base_below_threshold",
    "target_accepted",
  ];
  return priority.find((prefix) => reasons.some((reason) => reason.startsWith(prefix))) ?? reasons[0] ?? null;
}

function getIncidentMatcherDiagnosis(reason: string | null) {
  if (reason?.startsWith("upper_rows_target_excluded")) {
    return {
      title: "대상이 상단 제외 행에 있었습니다",
      detail: "matcher는 대상을 찾았지만 버프 종료 알림의 상단 절반 제외 규칙으로 채택하지 않았습니다.",
    };
  }
  if (reason?.startsWith("bottom_first_target_excluded")) {
    return {
      title: "더 아래 행의 대상을 우선 선택했습니다",
      detail: "같은 그룹의 더 아래 행 후보가 우선되어 이 후보는 채택되지 않았습니다.",
    };
  }
  if (reason === "cross_bundle_conflict") {
    return {
      title: "여러 버프 모델의 판정이 충돌했습니다",
      detail: "둘 이상의 독립 모델이 같은 아이콘을 통과시켜 대상을 확정하지 않았습니다.",
    };
  }
  if (reason === "positive_gate_below_threshold") {
    return {
      title: "대상 분류 후 아이콘 형태 검증을 통과하지 못했습니다",
      detail: "1차 분류는 통과했지만 해당 버프의 형태 기준을 통과하지 못했습니다.",
    };
  }
  if (reason === "base_below_threshold") {
    return {
      title: "대상 버프 분류 기준을 통과하지 못했습니다",
      detail: "선택한 그룹의 이진 matcher 기준을 통과한 아이콘이 없습니다.",
    };
  }
  return {
    title: "선택한 대상 버프가 확정되지 않았습니다",
    detail: reason ? `저장 판정: ${formatIncidentDecisionReason(reason)}` : "정확한 matcher 판정 사유가 없습니다.",
  };
}

function createOmissionDiagnostic(reason: string): TroubleshooterDiagnostic {
  const copy = OMISSION_COPY[reason] ?? {
    title: "일부 사건 증거가 없습니다",
    detail: `누락 사유: ${reason}`,
  };
  return diagnostic(
    `buff-incident-omission-${reason}`,
    reason === "never-produced" || reason === "outside-retention" ? "critical" : "warning",
    copy.title,
    copy.detail,
    "input",
  );
}

const OMISSION_COPY: Record<string, { title: string; detail: string }> = {
  "never-produced": {
    title: "필요한 사건 증거가 생성되지 않았습니다",
    detail: "선택한 상황과 연결되는 프레임·판정·알림 기록이 런타임에 만들어지지 않았습니다.",
  },
  "outside-retention": {
    title: "문제 시점이 보관 범위보다 이전입니다",
    detail: "짧게 보관하는 런타임 사건 기록 밖의 문제라 당시 원인을 재현할 수 없습니다.",
  },
  "reset-epoch": {
    title: "화면 공유 또는 기능 재시작 경계를 넘었습니다",
    detail: "재시작 전후 사건은 섞지 않도록 분리되며 이전 세대의 일부 증거가 제외됐습니다.",
  },
  "media-oversize": {
    title: "사건 이미지 한 장이 보관 한도를 넘었습니다",
    detail: "판정 메타데이터는 남아 있지만 해당 이미지가 보관되지 않았습니다.",
  },
  "media-budget-exhausted": {
    title: "브라우저 이미지 보관 한도에 도달했습니다",
    detail: "중요도 순서에 따라 일부 사건 이미지만 남았습니다.",
  },
  "metadata-cap": {
    title: "사건 메타데이터 보관 한도에 도달했습니다",
    detail: "오래되거나 우선순위가 낮은 사건 항목이 제외됐습니다.",
  },
  "payload-compacted": {
    title: "전송 크기 조정으로 사건 이미지가 제외됐습니다",
    detail: "서버 요청 크기를 맞추는 과정에서 해당 이미지가 제거됐고 판정 메타데이터만 남았습니다.",
  },
  "asset-persist-failed": {
    title: "사건 이미지를 영구 저장하지 못했습니다",
    detail: "임시 제보는 남았지만 장기 보관 저장소에 이미지를 기록하지 못했습니다.",
  },
  "asset-missing": {
    title: "저장된 사건 이미지 파일을 찾지 못했습니다",
    detail: "메타데이터는 남아 있지만 연결된 영구 이미지 파일이 없어 화면을 표시할 수 없습니다.",
  },
  "ambiguous-target": {
    title: "문제 대상을 하나로 좁히지 못했습니다",
    detail: "같은 시점에 조건을 만족한 후보가 여러 개라 최신 호환 사건을 선택했습니다.",
  },
};

function isMediaDegradationReason(reason: string) {
  return [
    "media-oversize",
    "media-budget-exhausted",
    "payload-compacted",
    "asset-persist-failed",
    "asset-missing",
  ].includes(reason);
}

function formatRuntimeFailure(failure: Record<string, unknown>) {
  return [failure.stage, failure.code, failure.message]
    .filter((entry) => typeof entry === "string" && entry.length > 0)
    .join(" · ") || "분석 실행 오류의 상세 정보가 없습니다.";
}

function formatSelectionStatus(status: unknown, support: unknown) {
  const statusLabel: Record<string, string> = {
    matched: "최근 사건 일치",
    "current-snapshot": "현재 사건 일치",
    "outside-retention": "보관 범위 밖",
    unavailable: "일치 사건 없음",
  };
  const supportLabel: Record<string, string> = {
    definitive: "판단 가능",
    partial: "일부 증거",
    unsupported: "판단 불가",
  };
  return `${statusLabel[String(status)] ?? String(status ?? "미기록")} · ${supportLabel[String(support)] ?? String(support ?? "미기록")}`;
}

function formatBuffGroup(value: unknown) {
  const labels: Record<string, string> = {
    unionWealth: "유니온의 부",
    unionLuck: "유니온의 행운",
    potion: "비약",
    expCoupon: "경험치 쿠폰",
  };
  const key = String(value ?? "");
  return labels[key] ?? (key || "미선택");
}

function formatIncidentDecisionReason(value: string | null) {
  if (!value) return "미기록";
  if (value.startsWith("upper_rows_target_excluded")) return "상단 제외 행";
  if (value.startsWith("bottom_first_target_excluded")) return "아래 행 우선 선택";
  const labels: Record<string, string> = {
    target_accepted: "대상 일치",
    base_below_threshold: "1차 분류 기준 미달",
    positive_gate_below_threshold: "아이콘 형태 검증 기준 미달",
    cross_bundle_conflict: "모델 간 판정 충돌",
  };
  return labels[value] ?? value;
}

function formatCountdownValues(countdowns: Record<string, unknown>[]) {
  const values = countdowns.map((entry) => {
    const seconds = firstNumber(entry.seconds);
    const text = firstString(entry.text);
    const decision = firstString(entry.decision) ?? "미기록";
    return `${seconds !== null ? `${seconds}초` : text ?? "값 없음"} (${decision})`;
  });
  return values.length ? values.slice(0, 4).join(" · ") : "없음";
}

function formatMediaReason(value: string | null) {
  const labels: Record<string, string> = {
    "playback-failed": "재생 실패",
    "fired-trigger": "알림 실행",
    "pre-due": "알림 직전",
    confirmation: "감지 확정",
    "accepted-observation": "대상 일치",
    "rejected-observation": "대상 탈락",
    "track-loss": "추적 소실",
    "track-replacement": "추적 교체",
    current: "현재",
    periodic: "주기 보관",
  };
  return value ? labels[value] ?? value : "미기록";
}

function formatCycleStatus(value: string) {
  const labels: Record<string, string> = {
    registered: "예약",
    rescheduled: "재예약",
    cancelled: "취소",
    suppressed: "억제",
    fired: "실행",
  };
  return labels[value] ?? value;
}

function formatTransitionKind(value: string) {
  const labels: Record<string, string> = {
    pending: "확인 중",
    confirmed: "확정",
    observed: "재관측",
    "countdown-rejected": "숫자 거절",
    refreshed: "갱신",
    "temporarily-missed": "일시 누락",
    scheduled: "예약",
    alerted: "알림",
    lost: "소실",
    replaced: "교체",
    reset: "초기화",
  };
  return labels[value] ?? value;
}
