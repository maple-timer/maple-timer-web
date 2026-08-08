import {
  asArray,
  asRecord,
  firstNumber,
  firstString,
  formatConfidence,
  formatMilliseconds,
  formatTimestamp,
} from "../sample";
import {
  buildVerdict,
  collectIncidentDegradationReasons,
  createEvidenceCollector,
  diagnostic,
  metric,
  selectIncidentFrame,
  selectIncidentRecord,
  stage,
} from "../shared";
import type {
  FeatureAnalysis,
  NormalizedDebugSample,
  PipelineStageStatus,
  TroubleshooterDiagnostic,
} from "../types";

const INCIDENT_SCHEMA = "hunt-stall-incident-evidence-v1";

export function analyzeHuntStallIncidentEvidence(
  sample: NormalizedDebugSample,
): FeatureAnalysis | null {
  const sampleNode = asRecord(sample.body.sample);
  const evidence = asRecord(sampleNode.huntStallEvidence);
  if (firstString(evidence.schemaVersion) !== INCIDENT_SCHEMA) {
    return null;
  }

  const hunt = asRecord(sample.body.huntStall);
  const reportIssue = asRecord(sample.body.reportIssue);
  const currentConfig = asRecord(hunt.config);
  const selection = asRecord(evidence.selection);
  const frames = asArray(evidence.frames).map(asRecord);
  const observations = asArray(evidence.observations).map(asRecord);
  const activityEpochs = asArray(evidence.activityEpochs).map(asRecord);
  const episodes = asArray(evidence.stallEpisodes).map(asRecord);
  const cycles = asArray(evidence.alertCycles).map(asRecord);
  const decisions = asArray(evidence.decisions).map(asRecord);
  const attempts = asArray(evidence.playbackAttempts).map(asRecord);
  const configurations = asArray(evidence.configurations).map(asRecord);
  const lifecycle = asArray(evidence.lifecycle).map(asRecord);
  const media = asArray(evidence.media).map(asRecord);
  const omissions = asArray(evidence.omissions).map(asRecord);
  const relatedPlayback = asArray(evidence.relatedPlayback).map(asRecord);
  const selectedEventAt = firstNumber(selection.selectedEventAt);
  const primaryObservation = selectIncidentRecord({
    records: observations,
    selectedIds: asArray(selection.observationIds),
    selectedEventAt,
    timeKey: "sampledAt",
  });
  const primaryFrame = selectIncidentFrame({
    frames,
    frameId: firstString(primaryObservation?.frameId),
    selectedIds: asArray(selection.frameIds),
    selectedEventAt,
  });
  const activityEpoch = selectIncidentRecord({
    records: activityEpochs,
    selectedIds: asArray(selection.activityEpochIds),
    selectedEventAt,
    timeKey: "startedAt",
  });
  const episode = selectIncidentRecord({
    records: episodes,
    selectedIds: asArray(selection.stallEpisodeIds),
    selectedEventAt,
    timeKey: "startedAt",
  });
  const cycle = selectIncidentRecord({
    records: cycles,
    selectedIds: asArray(selection.cycleIds),
    selectedEventAt,
    timeKey: "startedAt",
  });
  const decision = selectIncidentRecord({
    records: decisions,
    selectedIds: asArray(selection.decisionIds),
    selectedEventAt,
    timeKey: "occurredAt",
  });
  const attempt = selectIncidentRecord({
    records: attempts,
    selectedIds: asArray(selection.attemptIds),
    selectedEventAt,
    timeKey: "requestedAt",
  });
  const selectedConfiguration = selectConfiguration({
    configurations,
    frame: primaryFrame,
    decision,
    selection,
  });
  const recognition = asRecord(primaryObservation?.recognition);
  const transition = asRecord(primaryObservation?.transition);
  const runtimeFailure = Object.keys(asRecord(primaryFrame?.runtimeFailure)).length
    ? asRecord(primaryFrame?.runtimeFailure)
    : asRecord(recognition.failure);
  const mode = firstString(
    selection.mode,
    primaryFrame?.mode,
    selectedConfiguration.values && asRecord(selectedConfiguration.values).mode,
    currentConfig.mode,
  );
  const degradationReasons = collectIncidentDegradationReasons(selection, omissions);
  const collector = createEvidenceCollector(sample);
  const incidentMedia = addIncidentMedia({
    collector,
    media,
    frames,
    selectedFrameIds: [
      ...asArray(selection.mediaFrameIds),
      ...asArray(selection.frameIds),
    ],
  });
  const frozenContextIds = addFrozenContextEvidence(sample, collector);
  const playback = summarizePlayback(attempt, decision);
  const conclusion = firstString(selection.operatorConclusion);
  const diagnostics = createIncidentDiagnostics({
    selection,
    scenario: firstString(reportIssue.scenario),
    conclusion,
    runtimeFailure,
    recognition,
    transition,
    episode,
    decision,
    attempt,
    degradationReasons,
    relatedPlayback,
  });
  const verdict = buildVerdict(diagnostics, {
    title: "선택한 사냥 멈춤 사건 증거를 확인했습니다",
    detail:
      "제보 창을 열기 전에 정상 감지 루프가 저장한 사건만 표시합니다.",
  });
  const selectionSummary = formatSelection(selection);
  const recognitionSummary = formatRecognition(recognition);
  const transitionSummary = formatTransition(transition);
  const episodeSummary = formatEpisode(episode);
  const decisionSummary = formatDecision(decision, cycle);

  return {
    feature: "hunt-stall",
    featureLabel: "사냥 멈춤 알림",
    modeLabel: formatMode(mode),
    title:
      sample.id === "unknown"
        ? "사냥 멈춤 제보"
        : `사냥 멈춤 제보 ${sample.id.slice(0, 8)}`,
    verdict,
    summaryMetrics: [
      metric("hunt-incident-selection", "선택 사건", selectionSummary),
      metric(
        "hunt-incident-conclusion",
        "저장 결론",
        formatOperatorConclusion(conclusion),
      ),
      metric("hunt-incident-reading", "당시 판독", recognitionSummary),
      metric("hunt-incident-transition", "변화 판정", transitionSummary),
      metric("hunt-incident-episode", "정지 구간", episodeSummary),
      metric("hunt-incident-decision", "알림 판정", decisionSummary),
      metric("hunt-incident-playback", "브라우저 재생", playback.label),
    ],
    diagnostics,
    stages: [
      stage({
        id: "input",
        label: "선택 사건 입력",
        status: getInputStatus(selection, incidentMedia.rawIds.length, degradationReasons),
        summary:
          incidentMedia.rawIds.length > 0
            ? `원본 ${incidentMedia.rawIds.length}개 · 전처리 ${incidentMedia.processedIds.length}개`
            : "선택 사건 원본 없음",
        detail:
          "제보 창을 열기 전에 정상 1000ms 감지 루프가 실제로 분석한 영역입니다. 동결 시점 보조 화면과 섞지 않습니다.",
        metrics: [
          metric("hunt-selection-status", "선택 상태", selectionSummary),
          metric("hunt-frame-count", "선택 프레임", `${frames.length}개`),
          metric("hunt-media-record-count", "미디어 기록", `${media.length}개`),
          metric(
            "hunt-selected-time",
            "사건 시각",
            formatTimestamp(selection.selectedEventAt),
          ),
          metric(
            "hunt-region",
            "분석 영역",
            formatRegion(asRecord(primaryFrame?.region)),
          ),
        ],
        evidenceIds: incidentMedia.rawIds,
      }),
      stage({
        id: "recognition",
        label:
          mode === "cooldown-presence"
            ? "사건 쿨타임 판독"
            : "사건 경험치 판독",
        status: getRecognitionStatus(recognition, runtimeFailure, primaryObservation),
        summary: recognitionSummary,
        detail:
          "선택 프레임에서 인식기가 반환한 원시 값과 런타임이 실제로 채택한 보정값을 함께 표시합니다.",
        metrics: [
          metric(
            "hunt-recognition-decision",
            "채택 여부",
            formatRecognitionDecision(firstString(recognition.decision)),
          ),
          metric(
            "hunt-recognition-raw",
            "원시 값",
            formatReadingValue(recognition.rawValue, recognition.rawText),
          ),
          metric(
            "hunt-recognition-corrected",
            "사용 값",
            formatReadingValue(recognition.correctedValue),
          ),
          metric(
            "hunt-recognition-confidence",
            "신뢰도",
            formatConfidence(recognition.confidence),
          ),
          metric(
            "hunt-recognition-reason",
            "판정 사유",
            firstString(recognition.reason) ?? "없음",
          ),
          metric(
            "hunt-recognizer",
            "저장 인식기",
            formatRecognizer(asRecord(primaryFrame?.recognizer)),
          ),
          metric(
            "hunt-recognition-time",
            "인식 처리",
            formatMilliseconds(asRecord(primaryFrame?.timings).recognitionMs),
          ),
        ],
        evidenceIds: [...incidentMedia.rawIds, ...incidentMedia.processedIds],
      }),
      stage({
        id: "runtime",
        label: "사건 변화 흐름",
        status: getTransitionStatus(transition, runtimeFailure, primaryObservation),
        summary: transitionSummary,
        detail:
          "한 프레임의 판독만 보지 않고 같은 활동 구간에서 기준값 설정, 변화 확인, 보류, 재감시를 어떻게 처리했는지 표시합니다.",
        metrics: [
          metric(
            "hunt-activity",
            "활동 기준",
            formatActivityEpoch(activityEpoch),
          ),
          metric(
            "hunt-transition-kind",
            "상태 변화",
            formatTransitionKind(firstString(transition.kind)),
          ),
          metric(
            "hunt-transition-elapsed",
            "변화 없음",
            formatDurationMs(firstNumber(transition.elapsedMs)),
          ),
          metric(
            "hunt-transition-threshold",
            "알림 기준",
            formatDurationMs(firstNumber(transition.thresholdMs)),
          ),
        ],
        evidenceIds: incidentMedia.allIds,
      }),
      stage({
        id: "episode",
        label: "사건 정지 구간",
        status: getEpisodeStatus(episode),
        summary: episodeSummary,
        detail:
          "확인된 활동 기준에서 시작한 한 정지 구간과 마지막 임계값 평가를 표시합니다.",
        metrics: [
          metric("hunt-episode-status", "구간 상태", firstString(episode?.status) ?? "없음"),
          metric(
            "hunt-episode-evaluation",
            "마지막 평가",
            formatEpisodeEvaluation(asRecord(episode?.lastEvaluation)),
          ),
        ],
        evidenceIds: incidentMedia.allIds,
      }),
      stage({
        id: "alert-decision",
        label: "사건 알림 판정",
        status: getDecisionStatus(decision, episode),
        summary: decisionSummary,
        detail:
          "같은 정지 구간과 알림 주기에 연결된 첫 알림 또는 반복 판정을 저장된 결정 ID로 확인합니다.",
        metrics: [
          metric(
            "hunt-decision-kind",
            "종류",
            decision?.kind === "repeat" ? "반복" : decision ? "첫 알림" : "없음",
          ),
          metric(
            "hunt-decision-outcome",
            "판정",
            firstString(asRecord(decision?.evaluation).outcome) ?? "미기록",
          ),
          metric(
            "hunt-decision-reason",
            "사유",
            firstString(asRecord(decision?.evaluation).reason) ?? "없음",
          ),
        ],
        evidenceIds: incidentMedia.allIds,
      }),
      stage({
        id: "alert",
        label: "사건 브라우저 재생 기록",
        status: getPlaybackStatus(attempt, decision),
        summary: playback.label,
        detail: playback.detail,
        replayCoverage: "stored-evidence",
        metrics: [
          metric("hunt-playback-attempts", "재생 시도", `${attempts.length}개`),
          metric("hunt-playback-result", "브라우저 결과", playback.label),
          metric(
            "hunt-effective-volume",
            "최종 볼륨",
            formatConfidence(attempt?.effectiveVolume),
          ),
          metric("hunt-audibility", "실제 청취", "확인 불가"),
          metric(
            "hunt-related-playback",
            "다른 기능 재생",
            relatedPlayback.length > 0 ? `${relatedPlayback.length}개 · 별도 참고` : "없음",
          ),
        ],
        evidenceIds: incidentMedia.allIds,
      }),
      stage({
        id: "report-time",
        label: "제보 창 동결 시점 참고",
        status: frozenContextIds.length > 0 ? "complete" : "unavailable",
        summary:
          frozenContextIds.length > 0
            ? "보조 화면 있음 · 독립 분석 없음"
            : "독립 분석 없음",
        detail:
          "사냥 멈춤 제보는 버튼을 누른 뒤 새 인식기를 실행하지 않습니다. 이 보조 화면이 있더라도 위 선택 사건의 인식·흐름·알림 판정을 대신하지 않습니다.",
        replayCoverage: "recognition-not-run",
        metrics: [
          metric(
            "hunt-report-frame",
            "reportFrame",
            evidence.reportFrame === null ? "없음" : "이전 형식",
          ),
          metric(
            "hunt-lifecycle-events",
            "선택 런타임 이벤트",
            `${lifecycle.length}개`,
          ),
        ],
        evidenceIds: frozenContextIds,
      }),
    ],
    evidence: collector.evidence,
  };
}

function selectConfiguration({
  configurations,
  frame,
  decision,
  selection,
}: {
  configurations: Record<string, unknown>[];
  frame: Record<string, unknown> | null;
  decision: Record<string, unknown> | null;
  selection: Record<string, unknown>;
}) {
  const ids = [
    firstString(frame?.configRevisionId),
    firstString(decision?.configRevisionId),
    ...asArray(selection.configurationRevisionIds).filter(
      (entry): entry is string => typeof entry === "string",
    ),
  ].filter((entry): entry is string => Boolean(entry));
  for (const id of ids) {
    const match = configurations.find((entry) => firstString(entry.id) === id);
    if (match) return match;
  }
  return configurations[configurations.length - 1] ?? {};
}

function addIncidentMedia({
  collector,
  media,
  frames,
  selectedFrameIds,
}: {
  collector: ReturnType<typeof createEvidenceCollector>;
  media: Record<string, unknown>[];
  frames: Record<string, unknown>[];
  selectedFrameIds: unknown[];
}) {
  const frameById = new Map(
    frames.map((entry) => [firstString(entry.id), entry]),
  );
  const rawIds: string[] = [];
  const processedIds: string[] = [];
  const selectedIds = new Set(
    selectedFrameIds.filter(
      (entry): entry is string => typeof entry === "string",
    ),
  );
  const selectedMedia = selectedIds.size > 0
    ? media.filter((entry) => selectedIds.has(firstString(entry.frameId) ?? ""))
    : media;
  selectedMedia.slice(0, 12).forEach((entry, index) => {
    const stableId = (firstString(entry.id) ?? `media-${index}`).replace(
      /[^a-zA-Z0-9_-]/g,
      "-",
    );
    const frame = frameById.get(firstString(entry.frameId)) ?? {};
    const rawId = `hunt-stall-incident-${stableId}-raw`;
    const processedId = `hunt-stall-incident-${stableId}-processed`;
    collector.add({
      id: rawId,
      group: "source",
      label: `선택 사건 원본 ${index + 1}`,
      description: `${formatMediaReason(firstString(entry.reason))} · 정상 감지 루프 입력`,
      value: entry.rawDataUrl,
      capturedAt: entry.sampledAt,
      stageId: "input",
      metadata: [
        metric(
          `hunt-media-region-${index}`,
          "분석 영역",
          formatRegion(asRecord(frame.region)),
        ),
      ],
    });
    collector.add({
      id: processedId,
      group: "recognition",
      label: `선택 사건 전처리 ${index + 1}`,
      description: `${formatMediaReason(firstString(entry.reason))} · 저장된 인식기 전처리`,
      value: entry.processedDataUrl,
      capturedAt: entry.sampledAt,
      stageId: "recognition",
    });
    if (collector.evidence.some((asset) => asset.id === rawId)) rawIds.push(rawId);
    if (collector.evidence.some((asset) => asset.id === processedId)) {
      processedIds.push(processedId);
    }
  });
  return {
    rawIds,
    processedIds,
    allIds: [...rawIds, ...processedIds],
  };
}

function addFrozenContextEvidence(
  sample: NormalizedDebugSample,
  collector: ReturnType<typeof createEvidenceCollector>,
) {
  const sampleNode = asRecord(sample.body.sample);
  const ids: string[] = [];
  for (const [id, label, value] of [
    ["hunt-stall-frozen-context-raw", "동결 시점 보조 원본", sampleNode.rawDataUrl],
    [
      "hunt-stall-frozen-context-processed",
      "동결 시점 보조 전처리",
      sampleNode.processedDataUrl,
    ],
  ] as const) {
    collector.add({
      id,
      group: "runtime",
      label,
      description:
        "제보 창을 연 시점의 보조 화면입니다. 선택 사건 입력이나 별도 인식 결과로 해석하지 않습니다.",
      value,
      capturedAt: sampleNode.sampledAt,
      stageId: "report-time",
    });
    if (collector.evidence.some((asset) => asset.id === id)) ids.push(id);
  }
  return ids;
}

function createIncidentDiagnostics({
  selection,
  scenario,
  conclusion,
  runtimeFailure,
  recognition,
  transition,
  episode,
  decision,
  attempt,
  degradationReasons,
  relatedPlayback,
}: {
  selection: Record<string, unknown>;
  scenario: string | null;
  conclusion: string | null;
  runtimeFailure: Record<string, unknown>;
  recognition: Record<string, unknown>;
  transition: Record<string, unknown>;
  episode: Record<string, unknown> | null;
  decision: Record<string, unknown> | null;
  attempt: Record<string, unknown> | null;
  degradationReasons: string[];
  relatedPlayback: Record<string, unknown>[];
}): TroubleshooterDiagnostic[] {
  const diagnostics = degradationReasons.map(createOmissionDiagnostic);
  if (selection.support === "unsupported") {
    diagnostics.push(
      diagnostic(
        "hunt-incident-selection-unavailable",
        "critical",
        "선택한 사냥 멈춤 사건을 찾지 못했습니다",
        "보관 범위와 발생 시점에 맞는 런타임 사건이 없어 당시 원인을 확정할 수 없습니다.",
        "input",
      ),
    );
    return diagnostics;
  }
  if (conclusion) {
    diagnostics.push(createConclusionDiagnostic(conclusion));
  }
  if (Object.keys(runtimeFailure).length > 0 && conclusion !== "runtime-failure") {
    diagnostics.push(
      diagnostic(
        "hunt-incident-runtime-failed",
        "critical",
        "사건 분석 실행 중 오류가 발생했습니다",
        formatRuntimeFailure(runtimeFailure),
        "recognition",
      ),
    );
  }
  if (Object.keys(recognition).length === 0) {
    diagnostics.push(
      diagnostic(
        "hunt-incident-recognition-missing",
        "warning",
        "선택 프레임과 연결된 판독 기록이 없습니다",
        "프레임은 보관됐지만 같은 ID로 연결된 인식 결과를 찾지 못했습니다.",
        "recognition",
      ),
    );
  }
  if (
    Object.keys(transition).length === 0 &&
    ["recognized-no-alert", "wrong-value", "unstable-value"].includes(
      scenario ?? "",
    )
  ) {
    diagnostics.push(
      diagnostic(
        "hunt-incident-transition-missing",
        "warning",
        "판독과 연결된 변화 흐름 기록이 없습니다",
        "원시 판독은 있지만 런타임이 이를 활동 또는 정지로 처리한 기록이 없습니다.",
        "runtime",
      ),
    );
  }
  if (decision && asRecord(decision.evaluation).outcome === "alert" && !attempt) {
    diagnostics.push(
      diagnostic(
        "hunt-incident-playback-not-requested",
        "critical",
        "알림 판정 뒤 브라우저 재생 시도가 없습니다",
        "같은 결정 ID에서 알림 판정은 있었지만 연결된 재생 요청을 찾지 못했습니다.",
        "alert",
      ),
    );
  }
  if (attempt?.status === "failed" && conclusion !== "playback-failed") {
    diagnostics.push(
      diagnostic(
        "hunt-incident-playback-failed",
        "critical",
        "브라우저 소리 재생이 실패했습니다",
        firstString(attempt.error) ?? "재생 실패 원인은 기록되지 않았습니다.",
        "alert",
      ),
    );
  }
  if (
    (attempt?.status === "started" || attempt?.status === "finished") &&
    selection.physicalAudibility === "unknown"
  ) {
    diagnostics.push(
      diagnostic(
        "hunt-incident-audibility-unknown",
        "info",
        "브라우저 재생은 시작됐지만 실제 청취 여부는 알 수 없습니다",
        "브라우저 재생 수락까지만 확인할 수 있으며 OS 출력 장치와 실제 소리는 수집하지 않습니다.",
        "alert",
      ),
    );
  }
  if (relatedPlayback.length > 0) {
    diagnostics.push(
      diagnostic(
        "hunt-incident-related-playback",
        "info",
        "같은 시간대의 다른 기능 재생은 별도로 보관했습니다",
        `${relatedPlayback.length}개 다른 기능 재생이 있지만 사냥 멈춤 재생 시도로 합치지 않았습니다.`,
        "alert",
      ),
    );
  }
  if (!episode && ["threshold-not-reached", "decision-missing"].includes(conclusion ?? "")) {
    diagnostics.push(
      diagnostic(
        "hunt-incident-episode-missing",
        "warning",
        "선택 사건과 연결된 정지 구간이 없습니다",
        "활동 확인 뒤 시작되는 정지 구간을 찾지 못해 임계값 흐름을 완전히 설명할 수 없습니다.",
        "episode",
      ),
    );
  }
  return diagnostics;
}

function createConclusionDiagnostic(conclusion: string): TroubleshooterDiagnostic {
  const entries: Record<
    string,
    { tone: TroubleshooterDiagnostic["tone"]; title: string; detail: string; stage: string }
  > = {
    "recognition-rejected": {
      tone: "warning",
      title: "당시 판독값이 런타임에서 거절됐습니다",
      detail: "저장된 인식 결과와 거절 사유를 선택 사건 판독 단계에서 확인하세요.",
      stage: "recognition",
    },
    "recognition-missing": {
      tone: "critical",
      title: "당시 화면에서 값을 읽지 못했습니다",
      detail: "선택 사건 프레임에는 인식 가능한 값이 기록되지 않았습니다.",
      stage: "recognition",
    },
    "recognition-unconfirmed": {
      tone: "warning",
      title: "판독은 있었지만 감시 시작 조건을 확정하지 못했습니다",
      detail: "한 프레임 값은 있었지만 활동 또는 쿨타임 존재 확인이 끝나지 않았습니다.",
      stage: "runtime",
    },
    "runtime-failure": {
      tone: "critical",
      title: "사건 분석 실행 중 오류가 발생했습니다",
      detail: "선택 프레임의 실행 단계와 오류 코드를 확인하세요.",
      stage: "recognition",
    },
    "episode-not-armed": {
      tone: "warning",
      title: "사냥 시작 또는 쿨타임 존재를 아직 확인하지 못했습니다",
      detail: "정지 시간을 세기 전 필요한 활동 기준이 만들어지지 않았습니다.",
      stage: "runtime",
    },
    "episode-reset-before-threshold": {
      tone: "warning",
      title: "알림 기준에 도달하기 전에 감지 구간이 재시작됐습니다",
      detail: "모드, 영역, 화면 공유 또는 기능 상태 변경으로 이전 정지 구간이 끝났습니다.",
      stage: "episode",
    },
    "threshold-not-reached": {
      tone: "positive",
      title: "선택 사건은 설정한 알림 기준 전이었습니다",
      detail: "저장된 정지 구간의 경과 시간이 당시 설정 기준에 도달하지 않았습니다.",
      stage: "episode",
    },
    "decision-suppressed": {
      tone: "warning",
      title: "알림 판정이 런타임 정책에서 억제됐습니다",
      detail: "같은 사건의 저장된 억제 사유를 알림 판정 단계에서 확인하세요.",
      stage: "alert-decision",
    },
    "decision-stale": {
      tone: "warning",
      title: "지난 프레임의 알림 판정이 폐기됐습니다",
      detail: "결과가 도착하기 전에 사건 경계나 최신 프레임이 바뀌었습니다.",
      stage: "alert-decision",
    },
    "decision-blocked": {
      tone: "critical",
      title: "알림 판정이 실행 조건에서 차단됐습니다",
      detail: "저장된 차단 사유와 당시 설정을 확인하세요.",
      stage: "alert-decision",
    },
    "decision-missing": {
      tone: "critical",
      title: "정지 구간과 연결된 알림 판정이 없습니다",
      detail: "임계값 평가 뒤 같은 사건 ID의 알림 판정이 생성되지 않았습니다.",
      stage: "alert-decision",
    },
    "decision-without-playback": {
      tone: "critical",
      title: "알림 판정 뒤 브라우저 재생 시도가 없습니다",
      detail: "알림 판정은 기록됐지만 같은 결정 ID의 재생 요청이 없습니다.",
      stage: "alert",
    },
    "playback-requested-only": {
      tone: "warning",
      title: "브라우저 재생 요청 뒤 결과가 기록되지 않았습니다",
      detail: "재생 요청은 있었지만 시작, 종료 또는 실패 결과가 없습니다.",
      stage: "alert",
    },
    "playback-failed": {
      tone: "critical",
      title: "브라우저 소리 재생이 실패했습니다",
      detail: "선택 사건의 재생 시도와 오류를 확인하세요.",
      stage: "alert",
    },
    "physical-audibility-unverifiable": {
      tone: "info",
      title: "브라우저 재생 이후 실제 청취 여부는 확인할 수 없습니다",
      detail: "OS 출력 장치, 음소거, 실제 소리는 수집하지 않습니다.",
      stage: "alert",
    },
    "repeat-disabled": {
      tone: "positive",
      title: "당시 반복 알림이 꺼져 있었습니다",
      detail: "첫 알림 뒤 반복 재생을 요청하지 않는 설정입니다.",
      stage: "alert-decision",
    },
    "repeat-not-due": {
      tone: "positive",
      title: "다음 반복 알림 간격이 아직 지나지 않았습니다",
      detail: "이전 재생 완료와 당시 반복 간격을 기준으로 대기 중이었습니다.",
      stage: "alert-decision",
    },
    "repeat-limit-reached": {
      tone: "positive",
      title: "설정한 반복 횟수를 모두 사용했습니다",
      detail: "같은 정지 구간에서 추가 반복을 요청하지 않는 상태입니다.",
      stage: "alert-decision",
    },
    "repeat-blocked-by-playback": {
      tone: "positive",
      title: "이전 소리 재생 중이라 다음 반복을 기다렸습니다",
      detail: "재생이 끝나기 전에 같은 알림을 겹쳐 실행하지 않습니다.",
      stage: "alert-decision",
    },
    "repeat-decision-missing": {
      tone: "warning",
      title: "반복 시점과 연결된 판정 기록이 없습니다",
      detail: "반복 간격 계산은 가능하지만 같은 주기의 반복 판정을 찾지 못했습니다.",
      stage: "alert-decision",
    },
    "repeat-not-applicable": {
      tone: "info",
      title: "이 감지 모드에는 반복 알림이 적용되지 않습니다",
      detail: "쿨타임 존재 모드는 새 활동 구간을 다시 확인한 뒤 별도 알림 주기를 만듭니다.",
      stage: "alert-decision",
    },
    "false-alert-chain-found": {
      tone: "warning",
      title: "선택 사건에서 실제 알림 체인을 찾았습니다",
      detail: "판독부터 정지 구간, 알림 판정, 재생 시도까지 같은 ID로 연결돼 있습니다.",
      stage: "alert",
    },
    "same-cycle-alerts-found": {
      tone: "critical",
      title: "같은 알림 주기에서 여러 재생 시도가 확인됐습니다",
      detail: "반복 간격과 이전 재생 종료 시각을 함께 확인해야 합니다.",
      stage: "alert",
    },
    "separate-episode-alerts-found": {
      tone: "info",
      title: "알림들이 서로 다른 정지 구간에 속합니다",
      detail: "활동 확인 또는 재시작으로 구분된 별도 사건입니다.",
      stage: "alert",
    },
    "playback-presentation-mismatch": {
      tone: "warning",
      title: "화면 상태와 재생 기록이 서로 맞지 않습니다",
      detail: "같은 사건의 화면 게시 이벤트와 브라우저 재생 시점을 확인하세요.",
      stage: "alert",
    },
    "playback-presentation-consistent": {
      tone: "positive",
      title: "화면 상태와 브라우저 재생 기록이 일치합니다",
      detail: "실제 청취 여부는 별도로 확인할 수 없습니다.",
      stage: "alert",
    },
    "unrelated-feature-playback-found": {
      tone: "info",
      title: "같은 시간대에 다른 기능의 재생이 있었습니다",
      detail: "다른 기능 재생은 사냥 멈춤 알림 시도로 합치지 않았습니다.",
      stage: "alert",
    },
    "sampled-region-found": {
      tone: "positive",
      title: "당시 실제로 분석한 화면 영역을 찾았습니다",
      detail: "저장된 픽셀 영역과 원본 프레임을 입력 단계에서 확인하세요.",
      stage: "input",
    },
    "sampled-region-unavailable": {
      tone: "critical",
      title: "당시 분석 영역을 확인할 수 없습니다",
      detail: "선택 프레임에 픽셀 영역 또는 원본 이미지가 남아 있지 않습니다.",
      stage: "input",
    },
    "recognizer-output-found": {
      tone: "positive",
      title: "당시 인식기의 원시 결과를 찾았습니다",
      detail: "원시 값, 보정값, 채택 여부를 판독 단계에서 확인하세요.",
      stage: "recognition",
    },
    "temporal-correction-found": {
      tone: "info",
      title: "시간 흐름 보정이 적용된 판독을 찾았습니다",
      detail: "원시 값과 런타임 사용 값이 어떻게 달라졌는지 확인하세요.",
      stage: "runtime",
    },
    "unstable-sequence-found": {
      tone: "warning",
      title: "연속 판독이 안정적으로 이어지지 않았습니다",
      detail: "선택된 여러 관측의 보류, 거절, 활동 확인 순서를 확인하세요.",
      stage: "runtime",
    },
    "presentation-event-found": {
      tone: "info",
      title: "선택 사건의 화면 상태 변경 기록을 찾았습니다",
      detail: "런타임 결과 게시와 화면 표시 이벤트가 같은 사건에 연결돼 있습니다.",
      stage: "runtime",
    },
    "presentation-state-only": {
      tone: "warning",
      title: "화면 상태만 있고 연결된 게시 이벤트는 없습니다",
      detail: "현재 표시 상태를 당시 런타임 결과로 단정할 수 없습니다.",
      stage: "runtime",
    },
    "audio-configuration-found": {
      tone: "info",
      title: "당시 알림 소리와 볼륨 설정을 찾았습니다",
      detail: "선택 재생 시도에 고정된 소리, 기능 볼륨, 마스터 볼륨을 확인하세요.",
      stage: "alert",
    },
    "configuration-transition-found": {
      tone: "info",
      title: "선택 사건 주변의 설정 변경을 찾았습니다",
      detail: "모드, 영역, 임계값 또는 반복 설정의 변경 경계를 확인하세요.",
      stage: "runtime",
    },
    "runtime-error-found": {
      tone: "critical",
      title: "선택 사건의 실행 오류를 찾았습니다",
      detail: "저장된 단계, 오류 코드, 복구 여부를 확인하세요.",
      stage: "recognition",
    },
    "interaction-event-found": {
      tone: "info",
      title: "선택 사건과 연결된 사용자 조작 기록을 찾았습니다",
      detail: "조작 뒤 설정 및 런타임 경계가 어떻게 바뀌었는지 확인하세요.",
      stage: "runtime",
    },
    "unsupported-other": {
      tone: "warning",
      title: "기타 사유를 구체적인 사건 유형으로 분류하지 못했습니다",
      detail: "메모만으로 광범위한 화면이나 설정을 추가 수집하지 않습니다.",
      stage: "input",
    },
    "ambiguous-incident": {
      tone: "warning",
      title: "문제 시점의 사건을 하나로 좁히지 못했습니다",
      detail: "같은 조건의 후보 사건이 둘 이상 있어 임의로 합치지 않았습니다.",
      stage: "input",
    },
    "evidence-outside-retention": {
      tone: "critical",
      title: "문제 시점이 브라우저 보관 범위보다 이전입니다",
      detail: "1분보다 이전 사건은 자동 증거로 재현할 수 없습니다.",
      stage: "input",
    },
    "evidence-unavailable": {
      tone: "critical",
      title: "선택 조건에 맞는 사건 증거가 없습니다",
      detail: "기능이 켜져 있었더라도 해당 시점의 정상 런타임 체인을 찾지 못했습니다.",
      stage: "input",
    },
    "legacy-evidence-unavailable": {
      tone: "warning",
      title: "이전 제보 형식이라 사건 체인을 확인할 수 없습니다",
      detail: "구형 제보는 최신 상태와 일부 화면만 참고할 수 있습니다.",
      stage: "input",
    },
    "report-time-context-only": {
      tone: "warning",
      title: "동결 시점 참고 화면만 있고 선택 사건 증거가 없습니다",
      detail: "참고 화면을 과거 사건의 인식 또는 알림 판정으로 사용하지 않습니다.",
      stage: "input",
    },
  };
  const entry = entries[conclusion] ?? {
    tone: "info" as const,
    title: formatOperatorConclusion(conclusion),
    detail: "저장된 선택 사건 결론입니다.",
    stage: "runtime",
  };
  return diagnostic(
    `hunt-incident-conclusion-${conclusion}`,
    entry.tone,
    entry.title,
    entry.detail,
    entry.stage,
  );
}

function createOmissionDiagnostic(reason: string): TroubleshooterDiagnostic {
  const entries: Record<
    string,
    { tone: TroubleshooterDiagnostic["tone"]; title: string; detail: string }
  > = {
    "never-produced": {
      tone: "warning",
      title: "필요한 사건 증거가 생성되지 않았습니다",
      detail: "해당 런타임 단계에서 원본 또는 메타데이터가 만들어지지 않았습니다.",
    },
    "outside-retention": {
      tone: "critical",
      title: "문제 시점이 보관 범위보다 이전입니다",
      detail: "일반 사건은 최근 1분까지만 브라우저 메모리에 유지됩니다.",
    },
    "reset-epoch": {
      tone: "warning",
      title: "화면 공유 또는 기능 재시작 경계를 넘었습니다",
      detail: "서로 다른 감지 세대의 증거는 하나의 사건으로 합치지 않습니다.",
    },
    "metadata-cap": {
      tone: "warning",
      title: "사건 메타데이터 보관 한도에 도달했습니다",
      detail: "오래되거나 우선순위가 낮은 사건 기록이 제외됐습니다.",
    },
    "media-budget": {
      tone: "warning",
      title: "브라우저 이미지 보관 한도에 도달했습니다",
      detail: "사건 메타데이터는 남아 있지만 일부 원본 또는 전처리 이미지가 제외됐습니다.",
    },
    "media-oversize": {
      tone: "warning",
      title: "사건 이미지 한 장이 보관 한도를 넘었습니다",
      detail: "큰 이미지를 다른 프레임으로 바꾸지 않고 누락으로 기록했습니다.",
    },
    "payload-compacted": {
      tone: "warning",
      title: "전송 크기 조정으로 사건 이미지가 제외됐습니다",
      detail: "선택 메타데이터는 유지하고 우선순위가 낮은 이미지만 제거했습니다.",
    },
    "asset-persist-failed": {
      tone: "critical",
      title: "사건 이미지를 영구 저장하지 못했습니다",
      detail: "임시 KV 사본에는 남을 수 있지만 D1/R2 영구 저장은 실패했습니다.",
    },
    "asset-missing": {
      tone: "critical",
      title: "저장된 사건 이미지 파일을 찾지 못했습니다",
      detail: "D1 메타데이터는 있지만 연결된 R2 파일이 없어 다른 화면으로 대체하지 않았습니다.",
    },
    "ambiguous-incident": {
      tone: "warning",
      title: "문제 사건을 하나로 좁히지 못했습니다",
      detail: "후보 증거를 임의로 합치지 않고 일부 증거로 표시합니다.",
    },
    "legacy-unavailable": {
      tone: "warning",
      title: "이전 제보 형식의 사건 증거는 사용할 수 없습니다",
      detail: "구형 저장 필드는 선택 사건 체인으로 승격하지 않습니다.",
    },
    "report-time-only": {
      tone: "warning",
      title: "동결 시점 참고 자료만 남아 있습니다",
      detail: "정상 런타임 사건 증거가 없어 당시 판정을 재현할 수 없습니다.",
    },
  };
  const entry = entries[reason] ?? {
    tone: "warning" as const,
    title: `사건 증거 일부 누락: ${reason}`,
    detail: "선택 사건의 일부 증거가 보관 또는 전송 과정에서 제외됐습니다.",
  };
  return diagnostic(
    `hunt-incident-omission-${reason}`,
    entry.tone,
    entry.title,
    entry.detail,
    "input",
  );
}

function getInputStatus(
  selection: Record<string, unknown>,
  rawCount: number,
  degradationReasons: string[],
): PipelineStageStatus {
  if (rawCount > 0) {
    return degradationReasons.some(isMediaDegradationReason)
      ? "warning"
      : "complete";
  }
  return selection.support === "unsupported" ? "blocked" : "unavailable";
}

function getRecognitionStatus(
  recognition: Record<string, unknown>,
  runtimeFailure: Record<string, unknown>,
  observation: Record<string, unknown> | null,
): PipelineStageStatus {
  if (Object.keys(runtimeFailure).length > 0) return "blocked";
  if (!observation || Object.keys(recognition).length === 0) return "unavailable";
  if (recognition.decision === "error") return "blocked";
  if (recognition.decision === "accepted") return "complete";
  return "warning";
}

function getTransitionStatus(
  transition: Record<string, unknown>,
  runtimeFailure: Record<string, unknown>,
  observation: Record<string, unknown> | null,
): PipelineStageStatus {
  if (Object.keys(runtimeFailure).length > 0) return "blocked";
  if (!observation || Object.keys(transition).length === 0) return "unavailable";
  if (transition.kind === "error") return "blocked";
  if (
    ["activity-confirmed", "armed", "rearmed", "threshold-reached"].includes(
      String(transition.kind),
    )
  ) {
    return "complete";
  }
  return "warning";
}

function getEpisodeStatus(
  episode: Record<string, unknown> | null,
): PipelineStageStatus {
  if (!episode) return "unavailable";
  const evaluation = asRecord(episode.lastEvaluation);
  if (evaluation.outcome === "blocked") return "blocked";
  if (["suppressed", "stale"].includes(String(evaluation.outcome))) {
    return "warning";
  }
  return "complete";
}

function getDecisionStatus(
  decision: Record<string, unknown> | null,
  episode: Record<string, unknown> | null,
): PipelineStageStatus {
  if (!decision) return episode ? "warning" : "unavailable";
  const outcome = asRecord(decision.evaluation).outcome;
  if (outcome === "blocked") return "blocked";
  if (["suppressed", "stale"].includes(String(outcome))) return "warning";
  return "complete";
}

function getPlaybackStatus(
  attempt: Record<string, unknown> | null,
  decision: Record<string, unknown> | null,
): PipelineStageStatus {
  if (attempt?.status === "failed") return "blocked";
  if (attempt?.status === "started" || attempt?.status === "finished") {
    return "complete";
  }
  if (attempt?.status === "requested") return "warning";
  return asRecord(decision?.evaluation).outcome === "alert"
    ? "blocked"
    : "unavailable";
}

function summarizePlayback(
  attempt: Record<string, unknown> | null,
  decision: Record<string, unknown> | null,
) {
  if (!attempt) {
    if (asRecord(decision?.evaluation).outcome === "alert") {
      return {
        label: "알림 판정 있음 · 재생 시도 없음",
        detail:
          "같은 결정 ID에서 알림 판정은 있었지만 브라우저 재생 요청이 없습니다.",
      };
    }
    return {
      label: "재생 시도 기록 없음",
      detail: "선택 사건과 연결된 브라우저 재생 요청이 없습니다.",
    };
  }
  if (attempt.status === "failed") {
    return {
      label: "재생 실패",
      detail:
        firstString(attempt.error) ?? "브라우저 재생 요청이 실패했습니다.",
    };
  }
  if (attempt.status === "finished") {
    return {
      label: "브라우저 재생 종료",
      detail:
        "브라우저 재생 시작과 종료가 기록됐습니다. 실제 청취와 OS 출력은 확인할 수 없습니다.",
    };
  }
  if (attempt.status === "started") {
    return {
      label: "브라우저 재생 시작",
      detail:
        "브라우저가 재생 시작을 수락했습니다. 실제 청취와 OS 출력은 확인할 수 없습니다.",
    };
  }
  return {
    label: "재생 요청만 기록",
    detail: "재생 요청 뒤 시작, 종료 또는 실패 결과가 아직 없습니다.",
  };
}

function formatSelection(selection: Record<string, unknown>) {
  const statuses: Record<string, string> = {
    matched: "최근 사건 일치",
    "current-snapshot": "현재 사건 일치",
    "outside-retention": "보관 범위 밖",
    unavailable: "일치 사건 없음",
    "not-applicable": "해당 없음",
  };
  const supports: Record<string, string> = {
    definitive: "판단 가능",
    partial: "일부 증거",
    unsupported: "판단 불가",
  };
  return [
    statuses[String(selection.status)] ?? String(selection.status ?? "미기록"),
    supports[String(selection.support)] ?? String(selection.support ?? "미기록"),
    selection.ambiguous === true ? "사건 모호" : null,
  ].filter(Boolean).join(" · ");
}

function formatMode(mode: string | null) {
  if (mode === "cooldown-presence") return "쿨타임 아이콘 감지";
  if (mode === "manual-experience") return "경험치 인식";
  return mode ?? "감지 방식 미기록";
}

function formatRecognition(recognition: Record<string, unknown>) {
  if (Object.keys(recognition).length === 0) return "판독 기록 없음";
  const raw = formatReadingValue(recognition.rawValue, recognition.rawText);
  const corrected = formatReadingValue(recognition.correctedValue);
  const value = corrected !== "없음"
    ? raw !== "없음" && raw !== corrected
      ? `${raw} → ${corrected}`
      : corrected
    : raw;
  return [
    formatRecognitionDecision(firstString(recognition.decision)),
    value !== "없음" ? value : null,
    firstNumber(recognition.confidence) !== null
      ? formatConfidence(recognition.confidence)
      : null,
  ].filter(Boolean).join(" · ");
}

function formatRecognitionDecision(value: string | null) {
  const labels: Record<string, string> = {
    accepted: "채택",
    rejected: "거절",
    missing: "판독 없음",
    error: "실행 오류",
  };
  return value ? labels[value] ?? value : "판정 미기록";
}

function formatReadingValue(...values: unknown[]) {
  const value = values.find(
    (entry) => entry !== null && entry !== undefined && entry !== "",
  );
  return value === undefined ? "없음" : String(value);
}

function formatTransition(transition: Record<string, unknown>) {
  if (Object.keys(transition).length === 0) return "변화 판정 없음";
  return [
    formatTransitionKind(firstString(transition.kind)),
    formatDurationMs(firstNumber(transition.elapsedMs)),
    firstString(transition.reason),
  ].filter(Boolean).join(" · ");
}

function formatTransitionKind(value: string | null) {
  const labels: Record<string, string> = {
    "baseline-established": "기준값 설정",
    "pending-progress": "변화 확인 중",
    "presence-pending": "쿨타임 확인 중",
    "activity-confirmed": "활동 확인",
    unchanged: "변화 없음",
    unreadable: "판독 불가",
    armed: "감시 시작",
    rearmed: "감시 재시작",
    rejected: "흐름 거절",
    "threshold-reached": "알림 기준 도달",
    error: "처리 오류",
  };
  return value ? labels[value] ?? value : "미기록";
}

function formatActivityEpoch(activity: Record<string, unknown> | null) {
  if (!activity) return "없음";
  const labels: Record<string, string> = {
    "manual-progress-confirmed": "경험치 변화 확인",
    "cooldown-presence-confirmed": "쿨타임 존재 확인",
    "cooldown-digit-changed": "쿨타임 숫자 변화",
    "cooldown-visual-activity": "쿨타임 화면 변화",
    "cooldown-rearmed-readable": "숫자로 재감시",
    "cooldown-rearmed-visual": "화면 변화로 재감시",
  };
  const reason = firstString(activity.reason);
  return reason ? labels[reason] ?? reason : "활동 구간 있음";
}

function formatEpisode(episode: Record<string, unknown> | null) {
  if (!episode) return "정지 구간 없음";
  const evaluation = asRecord(episode.lastEvaluation);
  return [
    firstString(episode.status) ?? "상태 미기록",
    formatEpisodeEvaluation(evaluation),
  ].filter(Boolean).join(" · ");
}

function formatEpisodeEvaluation(evaluation: Record<string, unknown>) {
  if (Object.keys(evaluation).length === 0) return "평가 없음";
  const elapsed = formatDurationMs(firstNumber(evaluation.elapsedMs));
  const threshold = formatDurationMs(firstNumber(evaluation.thresholdMs));
  return [
    elapsed !== "미기록" || threshold !== "미기록"
      ? `${elapsed}/${threshold}`
      : null,
    firstString(evaluation.outcome),
    firstString(evaluation.reason),
  ].filter(Boolean).join(" · ");
}

function formatDecision(
  decision: Record<string, unknown> | null,
  cycle: Record<string, unknown> | null,
) {
  if (!decision) return cycle ? "알림 주기 있음 · 판정 없음" : "알림 판정 없음";
  const evaluation = asRecord(decision.evaluation);
  return [
    decision.kind === "repeat" ? "반복" : "첫 알림",
    firstString(evaluation.outcome) ?? "판정 미기록",
    firstString(evaluation.reason),
  ].filter(Boolean).join(" · ");
}

function formatOperatorConclusion(value: string | null) {
  const labels: Record<string, string> = {
    "recognition-rejected": "인식 거절",
    "recognition-missing": "판독 없음",
    "recognition-unconfirmed": "판독 확인 중",
    "runtime-failure": "분석 오류",
    "episode-not-armed": "감시 시작 전",
    "episode-reset-before-threshold": "기준 전 재시작",
    "threshold-not-reached": "알림 기준 전",
    "decision-suppressed": "알림 억제",
    "decision-stale": "지난 판정",
    "decision-blocked": "알림 차단",
    "decision-missing": "알림 판정 없음",
    "decision-without-playback": "재생 시도 없음",
    "playback-requested-only": "재생 요청만 있음",
    "playback-failed": "재생 실패",
    "physical-audibility-unverifiable": "실제 청취 확인 불가",
    "repeat-disabled": "반복 꺼짐",
    "repeat-not-due": "반복 간격 전",
    "repeat-limit-reached": "반복 횟수 완료",
    "repeat-blocked-by-playback": "이전 재생 진행 중",
    "repeat-decision-missing": "반복 판정 없음",
    "repeat-not-applicable": "반복 해당 없음",
    "false-alert-chain-found": "오감지 체인 확인",
    "same-cycle-alerts-found": "같은 주기 중복",
    "separate-episode-alerts-found": "별도 구간 알림",
    "playback-presentation-mismatch": "화면·재생 불일치",
    "playback-presentation-consistent": "화면·재생 일치",
    "unrelated-feature-playback-found": "다른 기능 재생 확인",
    "sampled-region-found": "분석 영역 확인",
    "sampled-region-unavailable": "분석 영역 없음",
    "recognizer-output-found": "인식 결과 확인",
    "temporal-correction-found": "시간 흐름 보정 확인",
    "unstable-sequence-found": "불안정 흐름 확인",
    "presentation-event-found": "화면 상태 변경 확인",
    "presentation-state-only": "화면 상태만 있음",
    "audio-configuration-found": "소리 설정 확인",
    "configuration-transition-found": "설정 변경 확인",
    "runtime-error-found": "실행 오류 확인",
    "interaction-event-found": "조작 기록 확인",
    "unsupported-other": "분류되지 않은 기타",
    "ambiguous-incident": "사건을 좁히지 못함",
    "evidence-outside-retention": "보관 기간 밖",
    "evidence-unavailable": "사건 증거 없음",
    "legacy-evidence-unavailable": "이전 형식",
    "report-time-context-only": "동결 시점 참고만 있음",
  };
  return value ? labels[value] ?? value : "미기록";
}

function formatRecognizer(recognizer: Record<string, unknown>) {
  if (Object.keys(recognizer).length === 0) return "미기록";
  return [
    firstString(recognizer.engine),
    firstString(recognizer.modelVersion, recognizer.modelId),
    formatProvider(firstString(recognizer.provider)),
  ].filter(Boolean).join(" · ");
}

function formatProvider(value: string | null) {
  if (value === "webgpu") return "GPU (WebGPU)";
  if (value === "wasm") return "CPU (WASM)";
  return value;
}

function formatRegion(region: Record<string, unknown>) {
  const x = firstNumber(region.x);
  const y = firstNumber(region.y);
  const width = firstNumber(region.width);
  const height = firstNumber(region.height);
  return [x, y, width, height].every((entry) => entry !== null)
    ? `${Math.round(x!)}:${Math.round(y!)} · ${Math.round(width!)}x${Math.round(height!)}`
    : "미기록";
}

function formatDurationMs(value: number | null) {
  return value === null ? "미기록" : `${Math.round(value / 100) / 10}초`;
}

function formatMediaReason(value: string | null) {
  const labels: Record<string, string> = {
    "playback-failed": "재생 실패",
    "alert-decision": "알림 판정",
    threshold: "알림 기준",
    "activity-anchor": "활동 기준",
    "runtime-error": "실행 오류",
    "value-transition": "값 변화",
    "rejected-observation": "거절 판독",
    rearm: "재감시",
    current: "현재",
    periodic: "주기 보관",
  };
  return value ? labels[value] ?? value : "보관 사유 미기록";
}

function formatRuntimeFailure(failure: Record<string, unknown>) {
  return [
    firstString(failure.stage),
    firstString(failure.code),
    firstString(failure.message),
  ].filter(Boolean).join(" · ") || "상세 미기록";
}

function isMediaDegradationReason(reason: string) {
  return [
    "media-budget",
    "media-oversize",
    "payload-compacted",
    "asset-persist-failed",
    "asset-missing",
  ].includes(reason);
}
