import {
  asArray,
  asRecord,
  firstNumber,
  firstString,
  formatConfidence,
  formatPrecisionParserExecutionProvider,
  formatScore,
  formatTimestamp,
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

const INCIDENT_SCHEMA = "skill-incident-evidence-v1";

export function analyzeSkillIncidentEvidence(
  sample: NormalizedDebugSample,
): FeatureAnalysis | null {
  const sampleNode = asRecord(sample.body.sample);
  const evidence = asRecord(sampleNode.skillEvidence);
  if (firstString(evidence.schemaVersion) !== INCIDENT_SCHEMA) {
    return null;
  }

  const skill = asRecord(sample.body.skill);
  const config = asRecord(skill.config);
  const selection = asRecord(evidence.selection);
  const frames = asArray(evidence.frames).map(asRecord);
  const observations = asArray(evidence.observations).map(asRecord);
  const cycles = asArray(evidence.cycles).map(asRecord);
  const decisions = asArray(evidence.decisions).map(asRecord);
  const arbitrations = asArray(evidence.arbitrations).map(asRecord);
  const attempts = asArray(evidence.playbackAttempts).map(asRecord);
  const configurations = asArray(evidence.configurations).map(asRecord);
  const media = asArray(evidence.media).map(asRecord);
  const omissions = asArray(evidence.omissions).map(asRecord);
  const selectedEventAt = firstNumber(selection.selectedEventAt);
  const primaryObservation = selectPrimaryObservation(
    observations,
    selectedEventAt,
  );
  const primaryFrame = selectPrimaryFrame(
    frames,
    firstString(primaryObservation?.frameId),
    selectedEventAt,
  );
  const parser = asRecord(primaryObservation?.parser);
  const matcher = asRecord(primaryObservation?.matcher);
  const value = asRecord(primaryObservation?.value);
  const flow = asRecord(primaryObservation?.flow);
  const runtimeFailure = Object.keys(asRecord(primaryObservation?.runtimeFailure)).length
    ? asRecord(primaryObservation?.runtimeFailure)
    : asRecord(primaryFrame?.runtimeFailure);
  const mode = firstString(selection.mode, primaryFrame?.mode);
  const precision = mode === "precision-countdown" || mode === "precision-remaining-count";
  const degradationReasons = collectIncidentDegradationReasons(selection, omissions);
  const collector = createEvidenceCollector(sample);
  const incidentEvidenceIds = addIncidentMedia({ collector, media, frames });
  addReportTimeEvidence(sample, collector);
  const playback = summarizePlayback(attempts, decisions);
  const decisionSummary = summarizeDecisions(decisions);
  const arbitrationSummary = summarizeArbitrations(arbitrations);
  const cycleSummary = summarizeCycles(cycles);
  const reportTime = readReportTimeContext(sample, evidence);
  const diagnostics = createIncidentDiagnostics({
    selection,
    mode,
    scenario: firstString(asRecord(sample.body.reportIssue).scenario),
    runtimeFailure,
    primaryObservation,
    parser,
    matcher,
    value,
    flow,
    cycles,
    decisions,
    arbitrations,
    attempts,
    degradationReasons,
  });
  const verdict = buildVerdict(diagnostics, {
    title: "선택한 스킬 사건 증거를 확인했습니다",
    detail:
      "제보 창을 열기 전 선택된 런타임 사건과 제보 전송 시점 참고 자료를 분리해 표시합니다.",
  });
  const selectionStatus = formatSelectionStatus(
    selection.status,
    selection.support,
  );
  const recognitionStatus = getRecognitionStatus({
    mode,
    primaryObservation,
    parser,
    matcher,
    runtimeFailure,
  });
  const playbackStatus = getPlaybackStageStatus(attempts, decisions);

  return {
    feature: "skill",
    featureLabel: "스킬 알림",
    modeLabel: formatMode(mode),
    title:
      firstString(config.name, config.presetId, selection.selectedSkillId) ??
      "스킬 제보",
    verdict,
    summaryMetrics: [
      metric("skill-incident-selection", "선택 사건", selectionStatus),
      metric(
        "skill-incident-recognition",
        "당시 인식",
        formatRecognitionSummary(mode, primaryObservation, parser, matcher),
      ),
      metric("skill-incident-value", "당시 판독", formatValue(value)),
      metric("skill-incident-cycle", "감지 주기", cycleSummary),
      metric("skill-incident-decision", "알림 판정", decisionSummary),
      metric("skill-incident-playback", "브라우저 재생", playback.label),
    ],
    diagnostics,
    stages: [
      stage({
        id: "input",
        label: "선택 사건 입력",
        status:
          incidentEvidenceIds.length > 0
            ? degradationReasons.some(isMediaDegradationReason)
              ? "warning"
              : "complete"
            : selection.support === "unsupported"
              ? "blocked"
              : "unavailable",
        summary:
          incidentEvidenceIds.length > 0
            ? `사건 이미지 ${incidentEvidenceIds.length}개`
            : "사건 이미지 없음",
        detail:
          "제보 창을 열기 전에 정상 감지 루프가 실제로 분석한 화면입니다. 전송 시점 화면과 섞지 않습니다.",
        metrics: [
          metric("skill-selection-status", "선택 상태", selectionStatus),
          metric("skill-frame-count", "선택 프레임", `${frames.length}개`),
          metric("skill-media-count", "보관 이미지", `${media.length}개`),
          metric(
            "skill-selected-time",
            "사건 시각",
            formatTimestamp(selection.selectedEventAt),
          ),
        ],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "detection",
        label: precision ? "사건 버프칸 탐색" : "사건 퀵슬롯 입력",
        status: precision
          ? getParserStageStatus(parser, runtimeFailure, primaryObservation)
          : primaryObservation
            ? "complete"
            : "unavailable",
        summary: precision
          ? formatParserSummary(parser, runtimeFailure)
          : primaryObservation
            ? "퀵슬롯 프레임 분석됨"
            : "퀵슬롯 분석 기록 없음",
        detail: precision
          ? "선택 사건 프레임에서 parser가 찾은 버프칸과 스킬 알림 전용 행 필터 결과입니다."
          : "사용자가 지정한 퀵슬롯 영역을 정상 런타임에서 분석한 기록입니다.",
        metrics: precision
          ? [
              metric("skill-parser-boxes", "버프칸", formatCount(parser.boxCount)),
              metric("skill-parser-rows", "검출 행", formatCount(parser.rowCount)),
              metric(
                "skill-parser-eligible",
                "행 규칙 통과",
                formatCount(parser.eligibleBoxCount),
              ),
              metric(
                "skill-parser-candidates",
                "matcher 후보",
                formatCount(parser.candidateCount),
              ),
              metric(
                "skill-parser-reason",
                "parser 판정",
                firstString(parser.decisionReason) ?? "미기록",
              ),
            ]
          : [],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "recognition",
        label: precision ? "사건 대상 스킬 판정" : "사건 숫자 인식",
        status: recognitionStatus,
        summary: formatRecognitionSummary(
          mode,
          primaryObservation,
          parser,
          matcher,
        ),
        detail: precision
          ? "같은 사건 프레임에서 matcher가 대상 스킬을 채택하거나 거절한 결과입니다."
          : "같은 사건 프레임에서 숫자 인식기가 반환한 결과입니다.",
        metrics: precision
          ? [
              metric(
                "skill-matcher-decision",
                "판정",
                formatMatcherDecision(matcher),
              ),
              metric("skill-matcher-score", "점수", formatScore(matcher.score)),
              metric(
                "skill-matcher-threshold",
                "기준",
                formatScore(matcher.threshold),
              ),
              metric("skill-matcher-margin", "여유", formatScore(matcher.margin)),
              metric(
                "skill-matcher-gate-margin",
                "형태 여유",
                formatScore(matcher.gateMargin),
              ),
              metric(
                "skill-matcher-bundle",
                "번들",
                firstString(matcher.bundleId) ?? "미기록",
              ),
              metric(
                "skill-matcher-model",
                "모델",
                firstString(matcher.modelVersion) ?? "미기록",
              ),
            ]
          : [
              metric(
                "skill-quickslot-recognizer",
                "인식기",
                firstString(primaryFrame?.recognizerVersion) ?? "미기록",
              ),
              metric(
                "skill-quickslot-provider",
                "실행 방식",
                formatPrecisionParserExecutionProvider(primaryFrame?.provider),
              ),
            ],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "reading",
        label: value.kind === "remaining-count" ? "사건 남은 횟수 판독" : "사건 남은 시간 판독",
        status: getValueStageStatus(value, primaryObservation, runtimeFailure),
        summary: formatValue(value),
        detail:
          "당시 인식기의 원시 값과 런타임이 실제로 채택한 여부를 함께 표시합니다.",
        metrics: [
          metric("skill-value-raw", "원시 값", formatRawValue(value)),
          metric(
            "skill-value-confidence",
            "신뢰도",
            formatConfidence(value.confidence),
          ),
          metric(
            "skill-value-decision",
            "채택 여부",
            formatValueDecision(value.decision),
          ),
          metric(
            "skill-value-reason",
            "판정 사유",
            firstString(value.reason) ?? "없음",
          ),
        ],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "runtime",
        label: "사건 값 흐름·감지 주기",
        status: getRuntimeStageStatus(flow, cycles, value),
        summary: `${formatFlow(flow)} · ${cycleSummary}`,
        detail:
          "원시 판독이 정상 흐름으로 확정됐는지와 같은 스킬 세대의 감지 주기가 어떻게 끝났는지 확인합니다.",
        metrics: [
          metric("skill-flow-confirmed", "확정 값", formatConfirmedValue(flow, value)),
          metric("skill-flow-range", "예상 범위", formatExpectedRange(flow)),
          metric(
            "skill-flow-decision",
            "흐름 판정",
            firstString(flow.decisionReason) ?? "미기록",
          ),
          metric("skill-cycle-summary", "감지 주기", cycleSummary),
        ],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "alert-decision",
        label: "사건 알림 판정·중복 조정",
        status: getDecisionStageStatus(decisions, arbitrations, cycles),
        summary: `${decisionSummary} · ${arbitrationSummary}`,
        detail:
          "알림 시각 도달 여부와 같은 대상 스킬끼리의 중복 재생 조정 결과를 당시 결정 ID로 확인합니다.",
        metrics: [
          metric("skill-decisions", "알림 판정", decisionSummary),
          metric("skill-arbitration", "중복 대상 조정", arbitrationSummary),
          metric("skill-decision-count", "판정 기록", `${decisions.length}개`),
        ],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "alert",
        label: "사건 브라우저 재생 기록",
        status: playbackStatus,
        summary: playback.label,
        detail: playback.detail,
        replayCoverage: "stored-evidence",
        metrics: [
          metric("skill-playback-attempts", "재생 시도", `${attempts.length}개`),
          metric("skill-playback-result", "브라우저 결과", playback.label),
          metric("skill-audibility", "실제 청취", "확인 불가"),
        ],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "report-time",
        label: "제보 전송 시점 참고",
        status: reportTime.hasContext ? "complete" : "unavailable",
        summary: reportTime.summary,
        detail:
          "제보 버튼을 누른 뒤 다음 정상 1000ms 샘플에서 받은 참고 자료입니다. 위 사건의 인식·흐름·알림 판정을 대신하거나 덮어쓰지 않습니다.",
        replayCoverage: "stored-evidence",
        metrics: [
          metric(
            "skill-report-time-sampled",
            "전송 시점",
            formatTimestamp(reportTime.sampledAt),
          ),
          metric(
            "skill-report-time-reading",
            "전송 시점 판독",
            reportTime.value,
          ),
          metric("skill-report-time-source", "선택 사건과 별도", "예"),
        ],
        evidenceIds: collector.evidence
          .filter((entry) => entry.stageId === "report-time")
          .map((entry) => entry.id),
      }),
    ],
    evidence: collector.evidence,
  };
}

function selectPrimaryObservation(
  observations: Record<string, unknown>[],
  selectedEventAt: number | null,
) {
  const accepted = observations.filter(
    (entry) => entry.recognitionDecision === "accepted",
  );
  const candidates = accepted.length > 0 ? accepted : observations;
  return [...candidates].sort((left, right) => {
    const leftAt = firstNumber(left.sampledAt) ?? 0;
    const rightAt = firstNumber(right.sampledAt) ?? 0;
    if (selectedEventAt !== null) {
      const distance =
        Math.abs(leftAt - selectedEventAt) -
        Math.abs(rightAt - selectedEventAt);
      if (distance !== 0) return distance;
    }
    return rightAt - leftAt;
  })[0] ?? null;
}

function selectPrimaryFrame(
  frames: Record<string, unknown>[],
  observationFrameId: string | null,
  selectedEventAt: number | null,
) {
  const direct = observationFrameId
    ? frames.find((entry) => firstString(entry.id) === observationFrameId)
    : null;
  if (direct) return direct;
  return [...frames].sort((left, right) => {
    const leftAt = firstNumber(left.sampledAt) ?? 0;
    const rightAt = firstNumber(right.sampledAt) ?? 0;
    if (selectedEventAt !== null) {
      const distance =
        Math.abs(leftAt - selectedEventAt) -
        Math.abs(rightAt - selectedEventAt);
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
    frames.map((entry) => [firstString(entry.id), entry]),
  );
  const ids: string[] = [];
  media.slice(0, 12).forEach((entry, index) => {
    const stableId = firstString(entry.id) ?? `media-${index}`;
    const id = `skill-incident-${stableId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const frame = frameById.get(firstString(entry.frameId)) ?? {};
    collector.add({
      id,
      group: getMediaGroup(firstString(entry.reason)),
      label: `선택 사건 이미지 ${index + 1}`,
      description: `${formatMediaReason(firstString(entry.reason))} · ${formatMediaVariant(firstString(entry.variant))}`,
      value: entry.dataUrl,
      capturedAt: entry.capturedAt,
      stageId: "input",
      metadata: [
        metric(
          `skill-media-provider-${index}`,
          "실행 방식",
          formatPrecisionParserExecutionProvider(frame.provider),
        ),
        metric(
          `skill-media-recognizer-${index}`,
          "인식기",
          firstString(frame.recognizerVersion) ?? "미기록",
        ),
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
    id: "skill-report-time-source",
    group: "source",
    label: "제보 전송 시점 입력",
    description:
      "제보 요청 뒤 다음 정상 샘플에서 받은 참고 화면이며 선택 사건 프레임이 아닙니다.",
    value: firstString(source.dataUrl, sampleNode.rawDataUrl),
    capturedAt: sampleNode.sampledAt,
    stageId: "report-time",
  });
  collector.add({
    id: "skill-report-time-full-frame",
    group: "source",
    label: "제보 전송 시점 전체 화면",
    description: "제보 전송 시점의 위치 참고용 전체 화면입니다.",
    value: sampleNode.fullFrameDataUrl,
    capturedAt: sampleNode.sampledAt,
    stageId: "report-time",
  });
  collector.add({
    id: "skill-report-time-candidate",
    group: "recognition",
    label: "제보 전송 시점 후보",
    description:
      "제보 전송 시점 분석에서 선택된 후보이며 과거 사건 후보로 해석하지 않습니다.",
    value: sampleNode.candidateDataUrl,
    capturedAt: sampleNode.sampledAt,
    stageId: "report-time",
  });
}

function createIncidentDiagnostics({
  selection,
  mode,
  scenario,
  runtimeFailure,
  primaryObservation,
  parser,
  matcher,
  value,
  flow,
  cycles,
  decisions,
  arbitrations,
  attempts,
  degradationReasons,
}: {
  selection: Record<string, unknown>;
  mode: string | null;
  scenario: string | null;
  runtimeFailure: Record<string, unknown>;
  primaryObservation: Record<string, unknown> | null;
  parser: Record<string, unknown>;
  matcher: Record<string, unknown>;
  value: Record<string, unknown>;
  flow: Record<string, unknown>;
  cycles: Record<string, unknown>[];
  decisions: Record<string, unknown>[];
  arbitrations: Record<string, unknown>[];
  attempts: Record<string, unknown>[];
  degradationReasons: string[];
}): TroubleshooterDiagnostic[] {
  const diagnostics = degradationReasons.map(createOmissionDiagnostic);
  if (selection.support === "unsupported") {
    diagnostics.push(
      diagnostic(
        "skill-incident-selection-unavailable",
        "critical",
        "선택한 스킬 사건 기록을 찾지 못했습니다",
        "보관 범위와 선택 스킬 조건에 맞는 런타임 사건이 없어 당시 원인을 확정할 수 없습니다.",
        "input",
      ),
    );
    return diagnostics;
  }
  if (Object.keys(runtimeFailure).length > 0) {
    diagnostics.push(
      diagnostic(
        "skill-incident-runtime-failed",
        "critical",
        "사건 분석 실행 중 오류가 발생했습니다",
        formatRuntimeFailure(runtimeFailure),
        firstString(runtimeFailure.stage) === "frame-capture"
          ? "input"
          : "recognition",
      ),
    );
    return diagnostics;
  }
  if (!primaryObservation) {
    diagnostics.push(
      diagnostic(
        "skill-incident-observation-missing",
        "critical",
        "사건 프레임과 연결된 인식 기록이 없습니다",
        "선택 사건에는 프레임이 있지만 같은 ID로 연결된 parser, matcher 또는 숫자 판독 결과가 없습니다.",
        "recognition",
      ),
    );
    return diagnostics;
  }
  if (mode !== "quickslot-countdown" && firstNumber(parser.boxCount) === 0) {
    diagnostics.push(
      diagnostic(
        "skill-incident-no-boxes",
        "critical",
        "사건 프레임에서 버프칸을 찾지 못했습니다",
        "제보 당시 parser가 버프칸을 찾지 못해 대상 스킬 matcher로 이어지지 않았습니다.",
        "detection",
      ),
    );
  } else if (
    mode !== "quickslot-countdown" &&
    firstNumber(parser.boxCount) !== null &&
    firstNumber(parser.eligibleBoxCount) === 0
  ) {
    diagnostics.push(
      diagnostic(
        "skill-incident-row-ineligible",
        "warning",
        "찾은 버프칸이 스킬 알림 검색 행에 없었습니다",
        "버프칸은 있었지만 스킬 알림의 상단 행 필터를 통과한 후보가 없습니다.",
        "detection",
      ),
    );
  } else if (
    mode !== "quickslot-countdown" &&
    matcher.accepted !== true
  ) {
    diagnostics.push(
      diagnostic(
        "skill-incident-matcher-rejected",
        "warning",
        "대상 스킬 matcher가 후보를 채택하지 않았습니다",
        `저장 판정: ${formatMatcherDecision(matcher)}`,
        "recognition",
      ),
    );
  }
  if (value.decision !== "accepted") {
    diagnostics.push(
      diagnostic(
        "skill-incident-value-rejected",
        "critical",
        "인식값이 런타임 흐름에 사용되지 않았습니다",
        `${formatValueDecision(value.decision)}${firstString(value.reason) ? ` · ${firstString(value.reason)}` : ""}`,
        "reading",
      ),
    );
  }
  if (
    firstString(flow.decisionReason)?.includes("implausible") ||
    firstString(flow.decisionReason)?.includes("pending")
  ) {
    diagnostics.push(
      diagnostic(
        "skill-incident-flow-held",
        "warning",
        "판독값이 흐름 확인 단계에서 보류됐습니다",
        `저장 흐름 판정: ${firstString(flow.decisionReason)}`,
        "runtime",
      ),
    );
  }
  if (
    scenario === "recognized-no-alert" &&
    cycles.length > 0 &&
    decisions.length === 0
  ) {
    diagnostics.push(
      diagnostic(
        "skill-incident-decision-missing",
        "critical",
        "감지 주기는 있지만 알림 판정 기록이 없습니다",
        "같은 사건 주기와 연결된 알림 시각 판정이 생성되지 않았습니다.",
        "alert-decision",
      ),
    );
  }
  if (
    decisions.some((entry) => entry.outcome === "requested") &&
    attempts.length === 0
  ) {
    diagnostics.push(
      diagnostic(
        "skill-incident-playback-not-requested",
        "critical",
        "알림 판정 뒤 브라우저 재생 시도가 없습니다",
        "같은 결정 ID에서 재생 요청 판정은 있었지만 연결된 브라우저 재생 시도가 기록되지 않았습니다.",
        "alert",
      ),
    );
  }
  const failedAttempt = attempts.find((entry) => entry.status === "failed");
  if (failedAttempt) {
    diagnostics.push(
      diagnostic(
        "skill-incident-playback-failed",
        "critical",
        "브라우저 소리 재생이 실패했습니다",
        firstString(failedAttempt.error) ?? "재생 실패 원인은 기록되지 않았습니다.",
        "alert",
      ),
    );
  }
  if (
    scenario === "duplicate-alert" &&
    attempts.filter(hasBrowserPlaybackStarted).length > 1
  ) {
    diagnostics.push(
      diagnostic(
        "skill-incident-duplicate-playback",
        "critical",
        "같은 사건에서 브라우저 재생이 여러 번 시작됐습니다",
        "선택된 감지 주기에 브라우저가 수락한 재생 시도가 둘 이상 연결돼 있습니다.",
        "alert",
      ),
    );
  }
  if (
    arbitrations.some(
      (entry) => asArray(entry.suppressedSkillIds).length > 0,
    )
  ) {
    diagnostics.push(
      diagnostic(
        "skill-incident-target-arbitrated",
        "info",
        "같은 대상을 공유한 스킬의 중복 재생을 조정했습니다",
        summarizeArbitrations(arbitrations),
        "alert-decision",
      ),
    );
  }
  if (
    (scenario === "playback-missing" || scenario === "unexpected-playback") &&
    attempts.some(hasBrowserPlaybackStarted)
  ) {
    diagnostics.push(
      diagnostic(
        "skill-incident-audibility-unknown",
        "info",
        "브라우저 재생 시작은 확인됐지만 실제 청취 여부는 알 수 없습니다",
        "브라우저가 play()를 수락한 사실까지만 확인할 수 있으며 OS 출력 장치, 음소거, 실제 소리는 수집하지 않습니다.",
        "alert",
      ),
    );
  }
  return diagnostics;
}

function readReportTimeContext(
  sample: NormalizedDebugSample,
  evidence: Record<string, unknown>,
) {
  const sampleNode = asRecord(sample.body.sample);
  const reportFrame = asRecord(evidence.reportFrame);
  const source = asRecord(sampleNode.source);
  const result = asRecord(sampleNode.result);
  const buffDuration = asRecord(sampleNode.buffDuration);
  const value = firstNumber(
    result.value,
    asRecord(buffDuration.countdown).totalSeconds,
    asRecord(buffDuration.remainingCount).count,
  );
  const boxCount = firstNumber(buffDuration.boxCount);
  const sampledAt = firstNumber(reportFrame.sampledAt, sampleNode.sampledAt);
  return {
    hasContext:
      Boolean(firstString(source.dataUrl, sampleNode.rawDataUrl)) ||
      value !== null ||
      boxCount !== null ||
      sampledAt !== null,
    sampledAt,
    value: value === null ? "미기록" : String(value),
    summary: [
      boxCount !== null ? `버프칸 ${boxCount}개` : null,
      value !== null ? `판독 ${value}` : null,
      "선택 사건과 별도",
    ].filter(Boolean).join(" · "),
  };
}

function summarizePlayback(
  attempts: Record<string, unknown>[],
  decisions: Record<string, unknown>[],
) {
  const latest = [...attempts].sort(
    (left, right) =>
      (firstNumber(right.requestedAt) ?? 0) -
      (firstNumber(left.requestedAt) ?? 0),
  )[0];
  if (!latest) {
    if (decisions.some((entry) => entry.outcome === "requested")) {
      return {
        label: "판정은 재생 요청 · 시도 없음",
        detail:
          "알림 판정은 재생 요청이지만 같은 결정 ID와 연결된 브라우저 재생 시도가 없습니다.",
      };
    }
    return {
      label: "재생 시도 기록 없음",
      detail: "선택 사건과 연결된 브라우저 재생 요청이 없습니다.",
    };
  }
  if (latest.status === "failed") {
    return {
      label: "재생 실패",
      detail:
        firstString(latest.error) ?? "브라우저 재생 요청이 실패했습니다.",
    };
  }
  if (latest.status === "finished") {
    return latest.startedMeaning === "browser-play-accepted"
      ? {
          label: "브라우저 재생 수락 후 종료",
          detail:
            "브라우저가 play()를 수락하고 종료 이벤트까지 기록했습니다. 실제 청취와 OS 출력은 확인할 수 없습니다.",
        }
      : legacyPlaybackSummary("종료");
  }
  if (latest.status === "started") {
    return latest.startedMeaning === "browser-play-accepted"
      ? {
          label: "브라우저 play() 수락",
          detail:
            "브라우저가 play() 시작을 수락했습니다. 실제 청취와 OS 출력은 확인할 수 없습니다.",
        }
      : legacyPlaybackSummary("요청");
  }
  return {
    label: "재생 요청만 기록",
    detail: "재생 요청 뒤 시작 또는 실패 결과가 아직 기록되지 않았습니다.",
  };
}

function legacyPlaybackSummary(status: string) {
  return {
    label: `이전 형식 재생 ${status} 기록`,
    detail:
      "이 기록은 재생 요청 시점에 시작으로 저장된 이전 형식입니다. 브라우저의 play() 수락 여부와 실제 청취는 확인할 수 없습니다.",
  };
}

function hasBrowserPlaybackStarted(entry: Record<string, unknown>) {
  return (
    (entry.status === "started" || entry.status === "finished") &&
    entry.startedMeaning === "browser-play-accepted"
  );
}

function getPlaybackStageStatus(
  attempts: Record<string, unknown>[],
  decisions: Record<string, unknown>[],
): PipelineStageStatus {
  if (attempts.some((entry) => entry.status === "failed")) return "blocked";
  if (attempts.some(hasBrowserPlaybackStarted)) return "complete";
  if (attempts.some((entry) => entry.status === "started")) return "warning";
  if (attempts.some((entry) => entry.status === "requested")) return "warning";
  if (decisions.some((entry) => entry.outcome === "requested")) return "blocked";
  return "unavailable";
}

function getParserStageStatus(
  parser: Record<string, unknown>,
  runtimeFailure: Record<string, unknown>,
  observation: Record<string, unknown> | null,
): PipelineStageStatus {
  if (Object.keys(runtimeFailure).length > 0) return "blocked";
  if (!observation || Object.keys(parser).length === 0) return "unavailable";
  if (firstNumber(parser.boxCount) === 0) return "blocked";
  if (firstNumber(parser.eligibleBoxCount) === 0) return "warning";
  return "complete";
}

function getRecognitionStatus({
  mode,
  primaryObservation,
  parser,
  matcher,
  runtimeFailure,
}: {
  mode: string | null;
  primaryObservation: Record<string, unknown> | null;
  parser: Record<string, unknown>;
  matcher: Record<string, unknown>;
  runtimeFailure: Record<string, unknown>;
}): PipelineStageStatus {
  if (Object.keys(runtimeFailure).length > 0) return "blocked";
  if (!primaryObservation) return "unavailable";
  if (mode === "quickslot-countdown") {
    return primaryObservation.recognitionDecision === "accepted"
      ? "complete"
      : "warning";
  }
  if (firstNumber(parser.boxCount) === 0) return "unavailable";
  return matcher.accepted === true ? "complete" : "warning";
}

function getValueStageStatus(
  value: Record<string, unknown>,
  observation: Record<string, unknown> | null,
  runtimeFailure: Record<string, unknown>,
): PipelineStageStatus {
  if (Object.keys(runtimeFailure).length > 0) return "unavailable";
  if (!observation || Object.keys(value).length === 0) return "unavailable";
  if (value.decision === "accepted") return "complete";
  if (value.decision === "missing") return "blocked";
  return "warning";
}

function getRuntimeStageStatus(
  flow: Record<string, unknown>,
  cycles: Record<string, unknown>[],
  value: Record<string, unknown>,
): PipelineStageStatus {
  const reason = firstString(flow.decisionReason);
  if (reason?.includes("implausible") || reason?.includes("pending")) {
    return "warning";
  }
  if (cycles.some((entry) => entry.status === "active" || entry.status === "terminal")) {
    return "complete";
  }
  if (value.decision === "accepted") return "warning";
  return "unavailable";
}

function getDecisionStageStatus(
  decisions: Record<string, unknown>[],
  arbitrations: Record<string, unknown>[],
  cycles: Record<string, unknown>[],
): PipelineStageStatus {
  if (decisions.length === 0) return cycles.length > 0 ? "warning" : "unavailable";
  if (decisions.some((entry) => entry.outcome === "requested")) return "complete";
  if (
    decisions.every(
      (entry) => entry.outcome === "suppressed-duplicate-target",
    ) ||
    arbitrations.some((entry) => asArray(entry.suppressedSkillIds).length > 0)
  ) {
    return "warning";
  }
  return "complete";
}

function formatParserSummary(
  parser: Record<string, unknown>,
  runtimeFailure: Record<string, unknown>,
) {
  if (Object.keys(runtimeFailure).length > 0) {
    return `실행 오류 · ${firstString(runtimeFailure.code) ?? "원인 미기록"}`;
  }
  if (Object.keys(parser).length === 0) return "parser 결과 미기록";
  return `${formatCount(parser.boxCount)} · ${formatCount(parser.rowCount, "행")} · 행 규칙 통과 ${formatCount(parser.eligibleBoxCount)}`;
}

function formatRecognitionSummary(
  mode: string | null,
  observation: Record<string, unknown> | null,
  parser: Record<string, unknown>,
  matcher: Record<string, unknown>,
) {
  if (!observation) return "인식 기록 없음";
  if (mode === "quickslot-countdown") {
    return `퀵슬롯 숫자 · ${formatRecognitionDecision(observation.recognitionDecision)}`;
  }
  return `${formatCount(parser.boxCount)} · ${formatMatcherDecision(matcher)}`;
}

function formatMatcherDecision(matcher: Record<string, unknown>) {
  const reason = firstString(matcher.decisionReason);
  const labels: Record<string, string> = {
    target_accepted: "대상 일치",
    base_below_threshold: "1차 분류 기준 미달",
    base_target_disabled: "비활성 대상 우선 판정",
    positive_gate_below_threshold: "아이콘 형태 기준 미달",
    cross_bundle_conflict: "모델 간 판정 충돌",
    other_skill_target: "다른 대상 판정",
  };
  if (matcher.accepted === true) return labels[reason ?? ""] ?? "대상 일치";
  return labels[reason ?? ""] ?? reason ?? "대상 탈락";
}

function formatRecognitionDecision(value: unknown) {
  const labels: Record<string, string> = {
    accepted: "채택",
    rejected: "거절",
    missing: "판독 없음",
    error: "실행 오류",
  };
  return labels[String(value)] ?? String(value ?? "미기록");
}

function formatValue(value: Record<string, unknown>) {
  if (Object.keys(value).length === 0) return "미기록";
  return `${formatRawValue(value)} · ${formatValueDecision(value.decision)}`;
}

function formatRawValue(value: Record<string, unknown>) {
  const rawValue = firstNumber(value.rawValue);
  if (rawValue === null) return firstString(value.text) ?? "값 없음";
  return `${rawValue}${value.kind === "remaining-count" ? "회" : "초"}`;
}

function formatValueDecision(value: unknown) {
  const labels: Record<string, string> = {
    accepted: "흐름에 사용",
    missing: "판독 없음",
    rejected: "판독 거절",
    implausible: "비정상 흐름",
  };
  return labels[String(value)] ?? String(value ?? "미기록");
}

function formatFlow(flow: Record<string, unknown>) {
  if (Object.keys(flow).length === 0) return "흐름 미기록";
  return [
    firstNumber(flow.confirmedValue) !== null
      ? `확정 ${firstNumber(flow.confirmedValue)}`
      : null,
    firstString(flow.decisionReason),
  ].filter(Boolean).join(" · ") || "흐름 미기록";
}

function formatConfirmedValue(
  flow: Record<string, unknown>,
  value: Record<string, unknown>,
) {
  const confirmed = firstNumber(flow.confirmedValue);
  if (confirmed === null) return "미기록";
  return `${confirmed}${value.kind === "remaining-count" ? "회" : "초"}`;
}

function formatExpectedRange(flow: Record<string, unknown>) {
  const min = firstNumber(flow.expectedMin);
  const max = firstNumber(flow.expectedMax);
  return min === null || max === null ? "미기록" : `${min}~${max}`;
}

function summarizeCycles(cycles: Record<string, unknown>[]) {
  if (cycles.length === 0) return "기록 없음";
  const labels: Record<string, string> = {
    pending: "확인 중",
    active: "활성",
    terminal: "종료",
  };
  return [...new Set(cycles.map((entry) => firstString(entry.status)).filter(Boolean))]
    .map((value) => labels[value!] ?? value)
    .join(" · ");
}

function summarizeDecisions(decisions: Record<string, unknown>[]) {
  if (decisions.length === 0) return "기록 없음";
  const labels: Record<string, string> = {
    requested: "재생 요청",
    "suppressed-duplicate-target": "중복 대상 억제",
    "pending-confirmation": "추가 확인",
    "not-due": "아직 알림 전",
    "already-alerted": "이미 알림",
    reset: "초기화",
    cancelled: "취소",
  };
  return [...new Set(decisions.map((entry) => firstString(entry.outcome)).filter(Boolean))]
    .map((value) => labels[value!] ?? value)
    .join(" · ");
}

function summarizeArbitrations(arbitrations: Record<string, unknown>[]) {
  if (arbitrations.length === 0) return "해당 없음";
  return arbitrations
    .slice(-2)
    .map((entry) => {
      const winner = firstString(entry.winnerSkillId);
      const suppressed = asArray(entry.suppressedSkillIds).map(String);
      return `${winner ? `선택 ${winner}` : "선택 없음"} · 억제 ${suppressed.join(", ") || "없음"}`;
    })
    .join(" / ");
}

function createOmissionDiagnostic(reason: string): TroubleshooterDiagnostic {
  const copy = OMISSION_COPY[reason] ?? {
    title: "일부 스킬 사건 증거가 없습니다",
    detail: `누락 사유: ${reason}`,
  };
  return diagnostic(
    `skill-incident-omission-${reason}`,
    ["never-produced", "outside-retention", "legacy-unavailable"].includes(
      reason,
    )
      ? "critical"
      : "warning",
    copy.title,
    copy.detail,
    "input",
  );
}

const OMISSION_COPY: Record<string, { title: string; detail: string }> = {
  "never-produced": {
    title: "필요한 스킬 사건 증거가 생성되지 않았습니다",
    detail:
      "선택한 상황과 연결되는 프레임·인식·알림 기록이 정상 런타임에 만들어지지 않았습니다.",
  },
  "outside-retention": {
    title: "문제 시점이 보관 범위보다 이전입니다",
    detail:
      "최근 1분보다 이전 사건은 짧은 런타임 보관 범위 밖이라 당시 원인을 확정할 수 없습니다.",
  },
  "reset-epoch": {
    title: "화면 공유 또는 기능 재시작 경계를 넘었습니다",
    detail:
      "재시작 전후 사건을 섞지 않기 위해 이전 스킬 세대의 일부 증거가 제외됐습니다.",
  },
  "metadata-budget": {
    title: "사건 메타데이터 보관 한도에 도달했습니다",
    detail: "오래되거나 우선순위가 낮은 사건 항목이 제외됐습니다.",
  },
  "media-budget": {
    title: "브라우저 이미지 보관 한도에 도달했습니다",
    detail: "오류·알림·임계값 이미지부터 남기고 일부 주기 이미지가 제외됐습니다.",
  },
  "media-oversize": {
    title: "사건 이미지 한 장이 보관 한도를 넘었습니다",
    detail: "판정 메타데이터는 남아 있지만 해당 이미지는 보관되지 않았습니다.",
  },
  "payload-compacted": {
    title: "전송 크기 조정으로 사건 이미지가 제외됐습니다",
    detail: "서버 요청 크기를 맞추는 과정에서 일부 이미지가 제거됐습니다.",
  },
  "asset-persist-failed": {
    title: "사건 이미지를 영구 저장하지 못했습니다",
    detail: "임시 제보는 남았지만 장기 보관 저장소에 이미지를 기록하지 못했습니다.",
  },
  "asset-missing": {
    title: "저장된 사건 이미지 파일을 찾지 못했습니다",
    detail: "판정 메타데이터는 남아 있지만 연결된 영구 이미지 파일이 없습니다.",
  },
  "ambiguous-cycle": {
    title: "문제 감지 주기를 하나로 좁히지 못했습니다",
    detail: "같은 시점의 호환 주기가 여러 개라 최신 사건을 선택했습니다.",
  },
  "ambiguous-skill": {
    title: "문제 스킬을 하나로 좁히지 못했습니다",
    detail: "제보 대상과 런타임 사건의 스킬 ID를 유일하게 연결하지 못했습니다.",
  },
  "legacy-unavailable": {
    title: "이전 제보 형식에는 스킬 사건 체인이 없습니다",
    detail: "저장된 화면과 상태는 볼 수 있지만 같은 순간의 인식·알림 인과관계는 확정할 수 없습니다.",
  },
  "report-time-only": {
    title: "제보 전송 시점 자료만 있습니다",
    detail: "제보 버튼을 누른 뒤 수집한 화면은 과거 문제 사건을 대신할 수 없습니다.",
  },
};

function isMediaDegradationReason(reason: string) {
  return [
    "media-budget",
    "media-oversize",
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
  const statusLabels: Record<string, string> = {
    matched: "최근 사건 일치",
    "current-snapshot": "현재 사건 일치",
    "outside-retention": "보관 범위 밖",
    unavailable: "일치 사건 없음",
  };
  const supportLabels: Record<string, string> = {
    definitive: "판단 가능",
    partial: "일부 증거",
    unsupported: "판단 불가",
  };
  return `${statusLabels[String(status)] ?? String(status ?? "미기록")} · ${supportLabels[String(support)] ?? String(support ?? "미기록")}`;
}

function formatMode(mode: string | null) {
  const labels: Record<string, string> = {
    "quickslot-countdown": "퀵슬롯 감지",
    "precision-countdown": "버프칸 정밀 감지",
    "precision-remaining-count": "버프칸 정밀 횟수 감지",
  };
  return labels[mode ?? ""] ?? mode ?? "감지 방식 미기록";
}

function formatCount(value: unknown, suffix = "개") {
  const count = firstNumber(value);
  return count === null ? "미기록" : `${Math.round(count)}${suffix}`;
}

function getMediaGroup(reason: string | null) {
  if (reason === "playback-failed" || reason === "alert-decision") return "alert" as const;
  if (reason === "runtime-error" || reason === "value-rejected") return "recognition" as const;
  return "source" as const;
}

function formatMediaReason(reason: string | null) {
  const labels: Record<string, string> = {
    "playback-failed": "재생 실패",
    "alert-decision": "알림 판정",
    threshold: "알림 기준 도달",
    "runtime-error": "실행 오류",
    "value-rejected": "판독 거절",
    "value-change": "값 변화",
    "status-change": "상태 변화",
    anchor: "사건 기준",
    current: "현재",
    periodic: "주기 보관",
  };
  return reason ? labels[reason] ?? reason : "보관 이유 미기록";
}

function formatMediaVariant(variant: string | null) {
  const labels: Record<string, string> = {
    "quickslot-raw": "퀵슬롯 원본",
    "quickslot-processed": "퀵슬롯 전처리",
    "precision-source": "정밀 입력",
    "precision-candidate": "정밀 후보",
  };
  return variant ? labels[variant] ?? variant : "이미지 종류 미기록";
}
