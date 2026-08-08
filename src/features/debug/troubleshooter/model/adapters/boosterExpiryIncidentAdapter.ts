import {
  asArray,
  asRecord,
  firstNumber,
  firstString,
  formatMilliseconds,
  formatSeconds,
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

const INCIDENT_SCHEMA = "booster-expiry-incident-evidence-v1";

export function analyzeBoosterExpiryIncidentEvidence(
  sample: NormalizedDebugSample,
): FeatureAnalysis | null {
  const sampleNode = asRecord(sample.body.sample);
  const evidence = asRecord(sampleNode.boosterExpiryEvidence);
  if (firstString(evidence.schemaVersion) !== INCIDENT_SCHEMA) return null;

  const selection = asRecord(evidence.selection);
  const frames = asArray(evidence.frames).map(asRecord);
  const observations = asArray(evidence.observations).map(asRecord);
  const candidates = asArray(evidence.candidateAttempts).map(asRecord);
  const cycles = asArray(evidence.cycles).map(asRecord);
  const schedules = asArray(evidence.schedules).map(asRecord);
  const decisions = asArray(evidence.decisions).map(asRecord);
  const playbacks = asArray(evidence.playbackAttempts).map(asRecord);
  const configurations = asArray(evidence.configurations).map(asRecord);
  const lifecycle = asArray(evidence.lifecycle).map(asRecord);
  const media = asArray(evidence.media).map(asRecord);
  const omissions = asArray(evidence.omissions).map(asRecord);
  const relatedPlayback = asArray(evidence.relatedPlayback).map(asRecord);
  const selectedEventAt = firstNumber(selection.selectedEventAt);

  const observation = selectIncidentRecord({
    records: observations,
    selectedIds: asArray(selection.observationIds),
    timeKey: "sampledAt",
    selectedEventAt,
  });
  const frame = selectIncidentFrame({
    frames,
    frameId: firstString(observation?.frameId),
    selectedIds: asArray(selection.frameIds),
    selectedEventAt,
  });
  const candidate = selectIncidentRecord({
    records: candidates,
    selectedIds: asArray(selection.candidateAttemptIds),
    timeKey: "lastObservedAt",
    selectedEventAt,
  });
  const cycle = selectIncidentRecord({
    records: cycles,
    selectedIds: asArray(selection.cycleIds),
    timeKey: "confirmedAt",
    selectedEventAt,
  });
  const schedule = selectIncidentRecord({
    records: schedules,
    selectedIds: asArray(selection.scheduleIds),
    timeKey: "registeredAt",
    selectedEventAt,
  });
  const decision = selectIncidentRecord({
    records: decisions,
    selectedIds: asArray(selection.decisionIds),
    timeKey: "occurredAt",
    selectedEventAt,
  });
  const playback = selectIncidentRecord({
    records: playbacks,
    selectedIds: asArray(selection.playbackAttemptIds),
    timeKey: "requestedAt",
    selectedEventAt,
  });
  const configuration = selectConfiguration({
    configurations,
    frame,
    cycle,
    decision,
    playback,
    selection,
  });
  const configurationValues = asRecord(configuration?.values);
  const runtimeFailure = asRecord(frame?.runtimeFailure);
  const degradationReasons = collectIncidentDegradationReasons(selection, omissions);
  const collector = createEvidenceCollector(sample);
  const incidentEvidenceIds = addIncidentMedia({
    collector,
    frames,
    media,
    selection,
  });
  const reportTimeEvidenceIds = addReportTimeEvidence(sample, collector);
  const conclusion = firstString(selection.operatorConclusion);
  const diagnostics = createIncidentDiagnostics({
    selection,
    conclusion,
    runtimeFailure,
    observation,
    candidate,
    cycle,
    schedule,
    decision,
    playback,
    degradationReasons,
  });
  const verdict = buildVerdict(diagnostics, {
    title: "선택한 부스터 종료 사건 증거를 확인했습니다",
    detail:
      "제보 창을 열기 전에 정상 감지 루프가 저장한 사건만 판정 근거로 표시합니다.",
  });
  const selectionSummary = formatSelection(selection);
  const readingSummary = formatObservation(observation);
  const flowSummary = formatFlow(observation, candidate, cycle);
  const scheduleSummary = formatSchedule(schedule, decision);
  const playbackSummary = formatPlayback(playback, decision);

  return {
    feature: "booster-expiry",
    featureLabel: "부스터 종료 알림",
    modeLabel: "타이머 OCR",
    title:
      sample.id === "unknown"
        ? "부스터 종료 제보"
        : `부스터 종료 제보 ${sample.id.slice(0, 8)}`,
    verdict,
    summaryMetrics: [
      metric("booster-incident-selection", "선택 사건", selectionSummary),
      metric(
        "booster-incident-conclusion",
        "저장 결론",
        formatOperatorConclusion(conclusion),
      ),
      metric("booster-incident-reading", "당시 판독", readingSummary),
      metric("booster-incident-flow", "감소 흐름", flowSummary),
      metric("booster-incident-playback", "브라우저 재생", playbackSummary.label),
    ],
    diagnostics,
    stages: [
      stage({
        id: "input",
        label: "선택 사건 입력",
        status: getInputStatus(selection, incidentEvidenceIds.length, degradationReasons),
        summary:
          incidentEvidenceIds.length > 0
            ? `사건 이미지 ${incidentEvidenceIds.length}개`
            : "선택 사건 이미지 없음",
        detail:
          "제보 창을 열기 전에 정상 1000ms 감지 루프가 실제로 분석한 상단 화면입니다.",
        metrics: [
          metric("booster-selection-status", "선택 상태", selectionSummary),
          metric("booster-frame-count", "선택 프레임", `${frames.length}개`),
          metric("booster-media-count", "보관 이미지", `${media.length}개`),
          metric("booster-selected-time", "사건 시각", formatTimestamp(selectedEventAt)),
          metric(
            "booster-source-region",
            "분석 영역",
            formatSource(asRecord(frame?.source)),
          ),
        ],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "reading",
        label: "사건 시간 판독",
        status: getRecognitionStatus(observation, runtimeFailure),
        summary: readingSummary,
        detail:
          Object.keys(runtimeFailure).length > 0
            ? formatRuntimeFailure(runtimeFailure)
            : "선택 프레임과 같은 ID에 저장된 타이머 영역·숫자 판독 결과입니다. 최신 상태로 대체하지 않습니다.",
        metrics: [
          metric(
            "booster-observation-decision",
            "관찰 판정",
            formatObservationDecision(firstString(observation?.decision)),
          ),
          metric(
            "booster-observation-reason",
            "판정 사유",
            firstString(observation?.reason) ?? "없음",
          ),
          metric(
            "booster-timer-candidates",
            "타이머 후보",
            `${firstNumber(observation?.timerCandidateCount) ?? 0}개`,
          ),
          metric(
            "booster-timer-matches",
            "형식 일치",
            `${firstNumber(observation?.timerMatchCount) ?? 0}개`,
          ),
          metric(
            "booster-recognizer-version",
            "저장 인식기",
            firstString(observation?.recognizerVersion) ?? "미기록",
          ),
          metric(
            "booster-recognition-time",
            "인식 처리",
            formatMilliseconds(observation?.recognitionMs),
          ),
        ],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "runtime",
        label: "사건 감소 흐름·확정",
        status: getFlowStatus(observation, candidate, cycle),
        summary: flowSummary,
        detail:
          "같은 Worker 흐름의 판독값, 후보 시도, 여섯 프레임 확인과 확정 주기를 분리해 표시합니다.",
        metrics: [
          metric("booster-flow", "Worker 흐름", formatWorkerFlow(asRecord(observation?.flow))),
          metric("booster-candidate", "확인 후보", formatCandidate(candidate)),
          metric("booster-cycle", "확정 주기", formatCycle(cycle)),
          metric(
            "booster-cycle-expires",
            "확정 종료",
            formatTimestamp(cycle?.expiresAt),
          ),
        ],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "schedule",
        label: "사건 알림 예약",
        status: getScheduleStatus(cycle, schedule),
        summary: scheduleSummary,
        detail:
          "확정 주기와 같은 ID에 연결된 알림 시각, 교체, 취소 또는 실행 결과입니다.",
        metrics: [
          metric("booster-schedule-status", "예약 상태", formatScheduleStatus(schedule)),
          metric("booster-alert-due", "알림 시각", formatTimestamp(schedule?.alertDueAt)),
          metric(
            "booster-confirmed-expires",
            "확정 종료",
            formatTimestamp(schedule?.confirmedExpiresAt ?? cycle?.expiresAt),
          ),
          metric(
            "booster-alert-setting",
            "알림 기준",
            formatLeadSeconds(configurationValues.alertLeadSeconds),
          ),
        ],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "alert-decision",
        label: "사건 알림 판정",
        status: getDecisionStatus(decision, schedule),
        summary: decision
          ? `알림 실행 · ${formatTimestamp(decision.occurredAt)}`
          : "알림 판정 없음",
        detail:
          "예약 ID와 확정 주기 ID가 모두 같은 알림 판정만 당시 실행 근거로 사용합니다.",
        metrics: [
          metric("booster-decision-time", "판정 시각", formatTimestamp(decision?.occurredAt)),
          metric("booster-decision-due", "예약 시각", formatTimestamp(decision?.dueAt)),
          metric(
            "booster-scheduler-delay",
            "스케줄러 지연",
            formatMilliseconds(decision?.schedulerDelayMs),
          ),
        ],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "alert",
        label: "사건 브라우저 재생 기록",
        status: getPlaybackStatus(playback, decision),
        summary: playbackSummary.label,
        detail: playbackSummary.detail,
        replayCoverage: "stored-evidence",
        metrics: [
          metric("booster-playback-result", "브라우저 결과", playbackSummary.label),
          metric("booster-playback-requested", "요청 시각", formatTimestamp(playback?.requestedAt)),
          metric(
            "booster-playback-accepted",
            "브라우저 수락",
            formatTimestamp(playback?.browserAcceptedAt),
          ),
          metric("booster-playback-finished", "재생 종료", formatTimestamp(playback?.finishedAt)),
          metric("booster-effective-volume", "최종 볼륨", formatVolume(playback?.effectiveVolume)),
          metric("booster-audibility", "실제 청취", "확인 불가"),
          metric(
            "booster-related-playback",
            "다른 기능 재생",
            relatedPlayback.length > 0 ? `${relatedPlayback.length}개 · 별도 참고` : "없음",
          ),
        ],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "report-time",
        label: "제보 창 동결 시점 참고",
        status: reportTimeEvidenceIds.length > 0 ? "warning" : "unavailable",
        summary:
          reportTimeEvidenceIds.length > 0
            ? "참고 화면 있음 · 독립 분석 없음"
            : "독립 분석 없음",
        detail:
          "부스터 종료 제보는 창을 연 뒤 별도 캡처나 Worker 인식을 실행하지 않습니다. 참고 화면은 선택 사건의 판독·확정·알림 판정을 대신하지 않습니다.",
        replayCoverage: "recognition-not-run",
        metrics: [
          metric(
            "booster-report-frame",
            "reportFrame",
            evidence.reportFrame === null ? "없음" : "이전 형식",
          ),
          metric("booster-lifecycle", "선택 런타임 이벤트", `${lifecycle.length}개`),
        ],
        evidenceIds: reportTimeEvidenceIds,
      }),
    ],
    evidence: collector.evidence,
  };
}

function selectConfiguration({
  configurations,
  frame,
  cycle,
  decision,
  playback,
  selection,
}: {
  configurations: Record<string, unknown>[];
  frame: Record<string, unknown> | null;
  cycle: Record<string, unknown> | null;
  decision: Record<string, unknown> | null;
  playback: Record<string, unknown> | null;
  selection: Record<string, unknown>;
}) {
  const ids = [
    firstString(playback?.configRevisionId),
    firstString(decision?.firedConfigRevisionId, decision?.timingConfigRevisionId),
    firstString(cycle?.timingConfigRevisionId),
    firstString(frame?.configRevisionId),
    ...asArray(selection.configurationRevisionIds).filter(
      (entry): entry is string => typeof entry === "string",
    ),
  ].filter((entry): entry is string => Boolean(entry));
  for (const id of ids) {
    const match = configurations.find((entry) => firstString(entry.id) === id);
    if (match) return match;
  }
  return null;
}

function addIncidentMedia({
  collector,
  frames,
  media,
  selection,
}: {
  collector: ReturnType<typeof createEvidenceCollector>;
  frames: Record<string, unknown>[];
  media: Record<string, unknown>[];
  selection: Record<string, unknown>;
}) {
  const selectedFrameIds = new Set(
    [...asArray(selection.mediaFrameIds), ...asArray(selection.frameIds)].filter(
      (entry): entry is string => typeof entry === "string",
    ),
  );
  const selectedMedia = selectedFrameIds.size > 0
    ? media.filter((entry) => selectedFrameIds.has(firstString(entry.frameId) ?? ""))
    : media;
  const frameById = new Map(frames.map((entry) => [firstString(entry.id), entry]));
  const ids: string[] = [];
  selectedMedia.slice(0, 12).forEach((entry, index) => {
    const stableId = (firstString(entry.id) ?? `media-${index}`).replace(
      /[^a-zA-Z0-9_-]/g,
      "-",
    );
    const id = `booster-expiry-incident-${stableId}`;
    const frame = frameById.get(firstString(entry.frameId)) ?? {};
    collector.add({
      id,
      group: "source",
      label: `선택 사건 상단 화면 ${index + 1}`,
      description: `${formatMediaReason(firstString(entry.reason))} · 정상 감지 루프 입력`,
      value: entry.imageDataUrl,
      capturedAt: entry.sampledAt,
      stageId: "input",
      metadata: [
        metric(
          `booster-media-source-${index}`,
          "분석 영역",
          formatSource(asRecord(frame.source)),
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
  const ids: string[] = [];
  for (const [id, label, value] of [
    ["booster-report-time-raw", "동결 시점 참고 원본", sampleNode.rawDataUrl],
    ["booster-report-time-timer", "동결 시점 참고 타이머", sampleNode.timerDataUrl],
  ] as const) {
    collector.add({
      id,
      group: "runtime",
      label,
      description:
        "제보 창을 연 시점의 구형 참고 화면입니다. 선택 사건 입력이나 독립 인식 결과로 해석하지 않습니다.",
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
  conclusion,
  runtimeFailure,
  observation,
  candidate,
  cycle,
  schedule,
  decision,
  playback,
  degradationReasons,
}: {
  selection: Record<string, unknown>;
  conclusion: string | null;
  runtimeFailure: Record<string, unknown>;
  observation: Record<string, unknown> | null;
  candidate: Record<string, unknown> | null;
  cycle: Record<string, unknown> | null;
  schedule: Record<string, unknown> | null;
  decision: Record<string, unknown> | null;
  playback: Record<string, unknown> | null;
  degradationReasons: string[];
}): TroubleshooterDiagnostic[] {
  const diagnostics: TroubleshooterDiagnostic[] = [];
  if (selection.support === "unsupported") {
    diagnostics.push(...degradationReasons.map(createOmissionDiagnostic));
    diagnostics.push(
      diagnostic(
        "booster-incident-selection-unavailable",
        "critical",
        "선택한 부스터 종료 사건을 찾지 못했습니다",
        "보관 범위와 발생 시점에 맞는 정상 런타임 사건이 없어 당시 원인을 확정할 수 없습니다.",
        "input",
      ),
    );
    return diagnostics;
  }
  if (conclusion) diagnostics.push(createConclusionDiagnostic(conclusion));
  diagnostics.push(...degradationReasons.map(createOmissionDiagnostic));
  if (Object.keys(runtimeFailure).length > 0 && conclusion !== "runtime-failure") {
    diagnostics.push(
      diagnostic(
        "booster-incident-runtime-failed",
        "critical",
        "선택 사건 분석 중 오류가 발생했습니다",
        formatRuntimeFailure(runtimeFailure),
        "reading",
      ),
    );
  }
  for (const [idsKey, record, label, stageId] of [
    ["observationIds", observation, "관찰", "reading"],
    ["candidateAttemptIds", candidate, "확인 후보", "runtime"],
    ["cycleIds", cycle, "확정 주기", "runtime"],
    ["scheduleIds", schedule, "예약", "schedule"],
    ["decisionIds", decision, "알림 판정", "alert-decision"],
    ["playbackAttemptIds", playback, "재생 시도", "alert"],
  ] as const) {
    if (asArray(selection[idsKey]).length > 0 && !record) {
      diagnostics.push(
        diagnostic(
          `booster-incident-link-missing-${idsKey}`,
          "critical",
          `선택 사건의 ${label} 기록을 찾지 못했습니다`,
          "선택 ID는 남아 있지만 연결된 저장 레코드가 없어 다른 최신 상태로 대체하지 않았습니다.",
          stageId,
        ),
      );
    }
  }
  return diagnostics;
}

function createConclusionDiagnostic(conclusion: string): TroubleshooterDiagnostic {
  const critical = new Set([
    "runtime-failure",
    "cycle-missing",
    "schedule-missing",
    "decision-missing",
    "decision-without-playback",
    "playback-failed",
    "false-cycle-chain-found",
    "same-cycle-duplicate-found",
    "unexpected-booster-playback-found",
    "runtime-error-found",
    "evidence-outside-retention",
    "evidence-unavailable",
  ]);
  const positive = new Set([
    "browser-playback-accepted",
    "separate-cycle-alerts-found",
    "valid-new-cycle-found",
  ]);
  const informational = new Set([
    "schedule-not-due",
    "physical-audibility-unverifiable",
    "unrelated-feature-playback-found",
    "audio-configuration-found",
    "configuration-transition-found",
    "presentation-event-found",
    "interaction-event-found",
  ]);
  const tone = critical.has(conclusion)
    ? "critical"
    : positive.has(conclusion)
      ? "positive"
      : informational.has(conclusion)
        ? "info"
        : "warning";
  return diagnostic(
    `booster-incident-conclusion-${conclusion}`,
    tone,
    formatOperatorConclusion(conclusion),
    getConclusionDetail(conclusion),
    getConclusionStage(conclusion),
  );
}

function createOmissionDiagnostic(reason: string): TroubleshooterDiagnostic {
  const critical = reason === "asset-persist-failed" ||
    reason === "asset-missing" ||
    reason === "outside-retention";
  const titles: Record<string, string> = {
    "never-produced": "필요한 사건 증거가 생성되지 않았습니다",
    "outside-retention": "문제 시점이 보관 범위보다 이전입니다",
    "reset-epoch": "화면 공유 또는 기능 재시작 경계를 넘었습니다",
    "metadata-cap": "사건 메타데이터 보관 한도에 도달했습니다",
    "media-budget": "브라우저 이미지 보관 한도에 도달했습니다",
    "media-oversize": "사건 이미지 한 장이 보관 한도를 넘었습니다",
    "payload-compacted": "전송 크기 조정으로 사건 이미지가 제외됐습니다",
    "asset-persist-failed": "사건 이미지를 영구 저장하지 못했습니다",
    "asset-missing": "저장된 사건 이미지 파일을 찾지 못했습니다",
    "ambiguous-incident": "문제 사건을 하나로 좁히지 못했습니다",
  };
  return diagnostic(
    `booster-incident-omission-${reason}`,
    critical ? "critical" : "warning",
    titles[reason] ?? `사건 증거 일부 누락: ${reason}`,
    "선택 사건의 메타데이터는 유지하고, 누락된 증거를 다른 최신 화면으로 대체하지 않았습니다.",
    "input",
  );
}

function getInputStatus(
  selection: Record<string, unknown>,
  mediaCount: number,
  degradationReasons: string[],
): PipelineStageStatus {
  if (selection.support === "unsupported") return "blocked";
  if (mediaCount > 0) return degradationReasons.length > 0 ? "warning" : "complete";
  return degradationReasons.some(isMediaDegradationReason) ? "warning" : "unavailable";
}

function getRecognitionStatus(
  observation: Record<string, unknown> | null,
  runtimeFailure: Record<string, unknown>,
): PipelineStageStatus {
  if (Object.keys(runtimeFailure).length > 0) return "blocked";
  if (!observation) return "unavailable";
  if (observation.decision === "accepted") return "complete";
  if (observation.decision === "error") return "blocked";
  return "warning";
}

function getFlowStatus(
  observation: Record<string, unknown> | null,
  candidate: Record<string, unknown> | null,
  cycle: Record<string, unknown> | null,
): PipelineStageStatus {
  if (cycle) return cycle.status === "cancelled" ? "warning" : "complete";
  if (candidate) {
    if (candidate.status === "collecting") return "pending";
    return "warning";
  }
  return observation?.decision === "accepted" ? "pending" : "unavailable";
}

function getScheduleStatus(
  cycle: Record<string, unknown> | null,
  schedule: Record<string, unknown> | null,
): PipelineStageStatus {
  if (!schedule) return cycle ? "blocked" : "unavailable";
  if (schedule.status === "fired") return "complete";
  if (schedule.status === "registered") return "pending";
  return "warning";
}

function getDecisionStatus(
  decision: Record<string, unknown> | null,
  schedule: Record<string, unknown> | null,
): PipelineStageStatus {
  if (decision) return "complete";
  if (schedule?.status === "fired") return "blocked";
  return schedule ? "pending" : "unavailable";
}

function getPlaybackStatus(
  playback: Record<string, unknown> | null,
  decision: Record<string, unknown> | null,
): PipelineStageStatus {
  if (!playback) return decision ? "blocked" : "unavailable";
  if (playback.status === "failed") return "blocked";
  if (playback.status === "requested") return "warning";
  return "complete";
}

function formatSelection(selection: Record<string, unknown>) {
  const statuses: Record<string, string> = {
    matched: "최근 사건 일치",
    "current-snapshot": "현재 사건 일치",
    "outside-retention": "보관 기간 밖",
    unavailable: "일치 사건 없음",
    "not-applicable": "해당 없음",
  };
  const supports: Record<string, string> = {
    definitive: "판단 가능",
    partial: "일부 증거",
    unsupported: "판단 불가",
  };
  const anchors: Record<string, string> = {
    frame: "프레임",
    observation: "관찰",
    "candidate-attempt": "확인 후보",
    cycle: "확정 주기",
    schedule: "알림 예약",
    decision: "알림 판정",
    "playback-attempt": "재생 시도",
    "related-playback": "다른 기능 재생",
    event: "런타임 이벤트",
    configuration: "설정",
    state: "화면 상태",
  };
  return [
    statuses[firstString(selection.status) ?? ""] ?? firstString(selection.status),
    supports[firstString(selection.support) ?? ""] ?? firstString(selection.support),
    anchors[firstString(selection.anchorKind) ?? ""] ?? "기준 없음",
    selection.ambiguous === true ? "사건 후보 모호" : null,
  ].filter(Boolean).join(" · ") || "미기록";
}

function formatObservation(observation: Record<string, unknown> | null) {
  if (!observation) return "선택 관찰 없음";
  const selected = asRecord(observation.selectedTime);
  const raw = asRecord(observation.rawTime);
  const reading = Object.keys(selected).length > 0 ? selected : raw;
  const value = firstString(reading.text) ??
    (firstNumber(reading.seconds) !== null ? `${firstNumber(reading.seconds)}초` : "판독 없음");
  return `${formatObservationDecision(firstString(observation.decision))} · ${value}`;
}

function formatFlow(
  observation: Record<string, unknown> | null,
  candidate: Record<string, unknown> | null,
  cycle: Record<string, unknown> | null,
) {
  if (cycle) return `확정 ${formatTimestamp(cycle.expiresAt)} · ${String(cycle.status ?? "상태 미기록")}`;
  if (candidate) return formatCandidate(candidate);
  const flow = asRecord(observation?.flow);
  return Object.keys(flow).length > 0 ? formatWorkerFlow(flow) : "확정 흐름 없음";
}

function formatWorkerFlow(flow: Record<string, unknown>) {
  if (Object.keys(flow).length === 0) return "미기록";
  return [
    flow.locked === true ? "잠금" : "잠금 전",
    firstString(flow.source),
    firstNumber(flow.predictedSeconds) !== null
      ? `예측 ${formatSeconds(flow.predictedSeconds)}`
      : null,
  ].filter(Boolean).join(" · ");
}

function formatCandidate(candidate: Record<string, unknown> | null) {
  if (!candidate) return "후보 없음";
  return [
    firstString(candidate.status),
    `${asArray(candidate.observationIds).length}회 관찰`,
    firstString(candidate.terminalReason),
  ].filter(Boolean).join(" · ");
}

function formatCycle(cycle: Record<string, unknown> | null) {
  if (!cycle) return "확정 없음";
  return [
    firstString(cycle.status),
    `${asArray(cycle.observationIds).length}회 확인`,
    firstNumber(cycle.contradictionCount) !== null
      ? `충돌 ${firstNumber(cycle.contradictionCount)}회`
      : null,
  ].filter(Boolean).join(" · ");
}

function formatSchedule(
  schedule: Record<string, unknown> | null,
  decision: Record<string, unknown> | null,
) {
  if (!schedule) return "예약 없음";
  return [
    formatScheduleStatus(schedule),
    formatTimestamp(schedule.alertDueAt),
    decision ? "실행 판정 있음" : null,
  ].filter(Boolean).join(" · ");
}

function formatScheduleStatus(schedule: Record<string, unknown> | null) {
  if (!schedule) return "없음";
  const labels: Record<string, string> = {
    registered: "예약됨",
    replaced: "교체됨",
    cancelled: "취소됨",
    suppressed: "억제됨",
    fired: "실행됨",
  };
  return labels[firstString(schedule.status) ?? ""] ?? firstString(schedule.status) ?? "미기록";
}

function formatPlayback(
  playback: Record<string, unknown> | null,
  decision: Record<string, unknown> | null,
) {
  if (!playback) {
    return {
      label: decision ? "재생 시도 없음" : "알림 판정 없음",
      detail: decision
        ? "알림 판정과 같은 ID의 브라우저 재생 요청이 없습니다."
        : "알림 판정이 없어 브라우저 재생 단계에 도달하지 않았습니다.",
    };
  }
  if (playback.status === "failed") {
    return {
      label: `재생 실패${playback.error ? ` · ${String(playback.error)}` : ""}`,
      detail: "브라우저가 재생을 완료하지 못했습니다. 저장된 오류와 당시 볼륨을 확인하세요.",
    };
  }
  if (playback.status === "requested") {
    return {
      label: "재생 요청만 기록",
      detail: "브라우저 play() 수락이나 실패 결과가 이어지지 않았습니다.",
    };
  }
  return {
    label:
      playback.status === "finished"
        ? "브라우저 재생 종료"
        : "브라우저 재생 수락",
    detail:
      "브라우저 수락은 기록됐지만 실제 스피커 출력과 사용자의 청취 여부는 확인할 수 없습니다.",
  };
}

function formatObservationDecision(value: string | null) {
  const labels: Record<string, string> = {
    accepted: "판독 채택",
    rejected: "판독 거절",
    missing: "타이머 없음",
    error: "판독 오류",
  };
  return value ? labels[value] ?? value : "미기록";
}

function formatRuntimeFailure(failure: Record<string, unknown>) {
  return [
    firstString(failure.stage),
    firstString(failure.code),
    firstString(failure.technicalMessage),
  ].filter(Boolean).join(" · ") || "상세 미기록";
}

function formatSource(source: Record<string, unknown>) {
  const dimensions = asRecord(source.sourceDimensions);
  const region = asRecord(source.sampledRegion);
  const sourceSize = firstNumber(dimensions.width) !== null &&
    firstNumber(dimensions.height) !== null
    ? `${firstNumber(dimensions.width)}x${firstNumber(dimensions.height)}`
    : null;
  const regionSize = firstNumber(region.width) !== null && firstNumber(region.height) !== null
    ? `${firstNumber(region.width)}x${firstNumber(region.height)}`
    : firstString(source.regionLabel);
  return [firstString(source.kind), sourceSize, regionSize].filter(Boolean).join(" · ") || "미기록";
}

function formatMediaReason(value: string | null) {
  const labels: Record<string, string> = {
    "playback-failed": "재생 실패",
    "alert-decision": "알림 판정",
    "cycle-confirmation": "주기 확정",
    "runtime-error": "실행 오류",
    "rejected-observation": "거절 관찰",
    current: "현재 사건",
    periodic: "주기 보관",
  };
  return value ? labels[value] ?? value : "보관 사유 미기록";
}

function formatOperatorConclusion(value: string | null) {
  const labels: Record<string, string> = {
    "recognition-rejected": "시간 판독 거절",
    "recognition-missing": "타이머 후보 없음",
    "recognition-unconfirmed": "감소 흐름 확인 중",
    "runtime-failure": "분석 오류",
    "flow-substitution-found": "흐름 값 대체 확인",
    "wrong-target-observation-found": "잘못된 타이머 영역 판독",
    "wrong-value-chain-found": "잘못된 시간 흐름 판독",
    "unstable-sequence-found": "불안정한 감소 흐름",
    "candidate-collecting": "확정 후보 수집 중",
    "candidate-expired": "확정 후보 만료",
    "candidate-rejected": "확정 후보 거절",
    "candidate-replaced": "확정 후보 교체",
    "not-new-cycle": "새 주기 아님",
    "cycle-missing": "확정 주기 없음",
    "schedule-missing": "예약 없음",
    "schedule-not-due": "알림 시각 전",
    "schedule-replaced": "예약 교체",
    "schedule-cancelled": "예약 취소",
    "decision-suppressed": "알림 억제",
    "decision-missing": "알림 판정 없음",
    "decision-without-playback": "재생 시도 없음",
    "playback-requested-only": "재생 요청만 있음",
    "playback-failed": "재생 실패",
    "browser-playback-accepted": "브라우저 재생 수락",
    "physical-audibility-unverifiable": "실제 청취 확인 불가",
    "false-cycle-chain-found": "오감지 주기 체인",
    "same-cycle-duplicate-found": "같은 주기 중복 알림",
    "separate-cycle-alerts-found": "별도 주기 알림",
    "valid-new-cycle-found": "정상 새 주기",
    "unexpected-booster-playback-found": "예상 밖 부스터 재생",
    "unrelated-feature-playback-found": "다른 기능 재생",
    "playback-source-unavailable": "재생 출처 없음",
    "presentation-event-found": "화면 상태 변경",
    "presentation-state-only": "화면 상태만 있음",
    "audio-configuration-found": "소리 설정 확인",
    "configuration-transition-found": "설정 변경 확인",
    "runtime-error-found": "실행 오류 확인",
    "interaction-event-found": "사용자 조작 확인",
    "unsupported-other": "분류되지 않은 기타",
    "ambiguous-incident": "사건 모호",
    "evidence-outside-retention": "보관 기간 밖",
    "evidence-unavailable": "사건 증거 없음",
    "legacy-evidence-unavailable": "이전 형식",
    "report-time-context-only": "동결 시점 참고만 있음",
  };
  return value ? labels[value] ?? value : "미기록";
}

function getConclusionDetail(conclusion: string) {
  if (conclusion === "browser-playback-accepted") {
    return "브라우저는 재생을 수락했지만 실제 스피커 출력과 청취 여부는 확인할 수 없습니다.";
  }
  if (conclusion === "playback-failed") {
    return "같은 알림 판정 ID에 연결된 브라우저 재생 실패와 오류를 확인하세요.";
  }
  if (conclusion === "decision-without-playback") {
    return "알림 판정은 기록됐지만 같은 ID의 브라우저 재생 요청이 없습니다.";
  }
  if (conclusion === "wrong-value-chain-found" || conclusion === "unstable-sequence-found") {
    return "같은 Worker 흐름에 연결된 판독값과 확정 후보의 감소 순서를 확인하세요.";
  }
  if (conclusion === "runtime-failure" || conclusion === "runtime-error-found") {
    return "저장된 실행 단계, 오류 코드와 같은 프레임의 판독 결과를 확인하세요.";
  }
  return "저장된 선택 사건 ID 체인과 각 단계의 결과를 확인하세요.";
}

function getConclusionStage(conclusion: string) {
  if (conclusion.includes("playback") || conclusion === "physical-audibility-unverifiable") {
    return "alert";
  }
  if (conclusion.includes("schedule")) return "schedule";
  if (conclusion.includes("decision") || conclusion.includes("cycle")) {
    return "alert-decision";
  }
  if (
    conclusion.includes("recognition") ||
    conclusion.includes("target") ||
    conclusion.includes("value") ||
    conclusion.includes("flow") ||
    conclusion.includes("sequence") ||
    conclusion.includes("candidate")
  ) {
    return "reading";
  }
  return "input";
}

function formatLeadSeconds(value: unknown) {
  const seconds = firstNumber(value);
  return seconds === null ? "미기록" : `${seconds}초 전`;
}

function formatVolume(value: unknown) {
  const parsed = firstNumber(value);
  return parsed === null ? "미기록" : `${Math.round(parsed * 100)}%`;
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
