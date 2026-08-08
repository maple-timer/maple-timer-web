import {
  asArray,
  asRecord,
  firstNumber,
  firstString,
  formatCount,
  formatMilliseconds,
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
import { formatSpecialCoreDecisionReason } from "../../specialCoreDecision";

const INCIDENT_SCHEMA = "special-core-incident-evidence-v1";

export function analyzeSpecialCoreIncidentEvidence(
  sample: NormalizedDebugSample,
): FeatureAnalysis | null {
  const sampleNode = asRecord(sample.body.sample);
  const evidence = asRecord(sampleNode.specialCoreEvidence);
  if (firstString(evidence.schemaVersion) !== INCIDENT_SCHEMA) {
    return null;
  }

  const selection = asRecord(evidence.selection);
  const frames = asArray(evidence.frames).map(asRecord);
  const observations = asArray(evidence.observations).map(asRecord);
  const confirmations = asArray(evidence.confirmationAttempts).map(asRecord);
  const activations = asArray(evidence.activations).map(asRecord);
  const schedules = asArray(evidence.schedules).map(asRecord);
  const decisions = asArray(evidence.decisions).map(asRecord);
  const attempts = asArray(evidence.playbackAttempts).map(asRecord);
  const configurations = asArray(evidence.configurations).map(asRecord);
  const lifecycle = asArray(evidence.lifecycle).map(asRecord);
  const media = asArray(evidence.media).map(asRecord);
  const omissions = asArray(evidence.omissions).map(asRecord);
  const relatedPlayback = asArray(evidence.relatedPlayback).map(asRecord);
  const selectedEventAt = firstNumber(selection.selectedEventAt);

  const observation = selectIncidentRecord({
    records: observations,
    selectedIds: asArray(selection.observationIds),
    selectedEventAt,
    timeKey: "sampledAt",
  });
  const frame = selectIncidentFrame({
    frames,
    frameId: firstString(observation?.frameId),
    selectedIds: asArray(selection.frameIds),
    selectedEventAt,
  });
  const confirmation = selectIncidentRecord({
    records: confirmations,
    selectedIds: asArray(selection.confirmationAttemptIds),
    selectedEventAt,
    timeKey: "lastObservedAt",
  });
  const activation = selectIncidentRecord({
    records: activations,
    selectedIds: asArray(selection.activationIds),
    selectedEventAt,
    timeKey: "confirmedAt",
  });
  const schedule = selectIncidentRecord({
    records: schedules,
    selectedIds: asArray(selection.scheduleIds),
    selectedEventAt,
    timeKey: "registeredAt",
  });
  const decision = selectIncidentRecord({
    records: decisions,
    selectedIds: asArray(selection.decisionIds),
    selectedEventAt,
    timeKey: "occurredAt",
  });
  const playback = selectIncidentRecord({
    records: attempts,
    selectedIds: asArray(selection.playbackAttemptIds),
    selectedEventAt,
    timeKey: "requestedAt",
  });
  const configuration = selectConfiguration({
    configurations,
    frame,
    activation,
    decision,
    playback,
    selection,
  });
  const parser = asRecord(frame?.parser);
  const source = asRecord(frame?.source);
  const timings = asRecord(frame?.timings);
  const configurationValues = asRecord(configuration?.values);
  const runtimeFailure = asRecord(frame?.runtimeFailure);
  const candidates = asArray(observation?.candidates).map(asRecord);
  const candidate = selectCandidate(candidates, observation);
  const matcher = asRecord(candidate?.match);
  const degradationReasons = collectIncidentDegradationReasons(selection, omissions);
  const collector = createEvidenceCollector(sample);
  const incidentEvidenceIds = addIncidentMedia({
    collector,
    media,
    frames,
    selection,
  });
  const reportTimeEvidenceIds = addReportTimeEvidence(sample, collector);
  const conclusion = firstString(selection.operatorConclusion);
  const diagnostics = createIncidentDiagnostics({
    selection,
    conclusion,
    runtimeFailure,
    observation,
    confirmation,
    activation,
    schedule,
    decision,
    playback,
    degradationReasons,
  });
  const verdict = buildVerdict(diagnostics, {
    title: "선택한 특수 코어 사건 증거를 확인했습니다",
    detail:
      "제보 창을 열기 전에 정상 감지 루프가 저장한 사건만 판정 근거로 표시합니다.",
  });
  const selectionSummary = formatSelection(selection);
  const observationSummary = formatObservation(observation, matcher);
  const confirmationSummary = formatConfirmation(confirmation, activation);
  const scheduleSummary = formatSchedule(schedule, decision);
  const playbackSummary = formatPlayback(playback, decision);

  return {
    feature: "special-core",
    featureLabel: "특수 코어 알림",
    modeLabel: "버프칸 정밀 감지",
    title:
      sample.id === "unknown"
        ? "특수 코어 제보"
        : `특수 코어 제보 ${sample.id.slice(0, 8)}`,
    verdict,
    summaryMetrics: [
      metric("special-core-incident-selection", "선택 사건", selectionSummary),
      metric(
        "special-core-incident-conclusion",
        "저장 결론",
        formatOperatorConclusion(conclusion),
      ),
      metric("special-core-incident-observation", "당시 인식", observationSummary),
      metric("special-core-incident-confirmation", "연속 확인", confirmationSummary),
      metric("special-core-incident-playback", "브라우저 재생", playbackSummary.label),
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
          "제보 창을 열기 전에 정상 1000ms 감지 루프가 실제로 분석한 버프칸 입력입니다.",
        metrics: [
          metric("special-core-selection-status", "선택 상태", selectionSummary),
          metric("special-core-frame-count", "선택 프레임", `${frames.length}개`),
          metric("special-core-media-count", "보관 이미지", `${media.length}개`),
          metric(
            "special-core-selected-time",
            "사건 시각",
            formatTimestamp(selection.selectedEventAt),
          ),
          metric(
            "special-core-input-mode",
            "parser 입력",
            firstString(source.parserInputMode) ?? "미기록",
          ),
        ],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "detection",
        label: "사건 버프칸 탐색",
        status: getDetectionStatus(frame, runtimeFailure),
        summary: formatDetection(frame, runtimeFailure),
        detail:
          Object.keys(runtimeFailure).length > 0
            ? formatRuntimeFailure(runtimeFailure)
            : "선택 사건 프레임에서 공유 parser가 찾은 버프칸과 특수 코어 후보 행을 표시합니다.",
        metrics: [
          metric("special-core-parser-boxes", "검출 칸", formatCount(asArray(frame?.parsedBoxes).length)),
          metric("special-core-parser-rows", "검출 행", formatCount(asArray(frame?.rowGroups).length)),
          metric("special-core-eligible-boxes", "후보 칸", formatCount(asArray(frame?.eligibleBoxIndexes).length)),
          metric("special-core-parser-engine", "사건 parser", firstString(parser.engine) ?? "미기록"),
          metric("special-core-parser-version", "사건 parser 버전", firstString(parser.version) ?? "미기록"),
          metric(
            "special-core-parser-provider",
            "사건 실행 방식",
            formatPrecisionParserExecutionProvider(asRecord(parser.runtime).executionProvider),
          ),
          metric("special-core-parser-time", "parser 처리", formatMilliseconds(timings.detectMs)),
        ],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "recognition",
        label: "사건 특수 코어 판정",
        status: getRecognitionStatus(observation, runtimeFailure),
        summary: observationSummary,
        detail:
          "선택 프레임과 동일한 관찰 ID에 저장된 matcher 판정입니다. 최신 상태나 제보 시점 재분석으로 대체하지 않습니다.",
        metrics: [
          metric("special-core-observation-decision", "관찰 판정", formatObservationDecision(firstString(observation?.decision))),
          metric("special-core-observation-reason", "판정 사유", firstString(observation?.reason) ?? "없음"),
          metric("special-core-candidates", "비교 후보", `${candidates.length}개`),
          metric("special-core-matcher-decision", "matcher 판정", formatSpecialCoreDecisionReason(firstString(matcher.decisionReason))),
          metric("special-core-matcher-score", "1차 점수", formatScore(matcher.score)),
          metric("special-core-matcher-threshold", "1차 기준", formatScore(matcher.threshold)),
          metric("special-core-gate-score", "형태 점수", formatScore(matcher.gateScore)),
          metric("special-core-gate-threshold", "형태 기준", formatScore(matcher.gateThreshold)),
          metric("special-core-matcher-bundle", "저장 번들", firstString(matcher.bundleId) ?? "미기록"),
          metric("special-core-matcher-model", "저장 모델", firstString(matcher.modelVersion, matcher.modelId) ?? "미기록"),
          metric("special-core-match-time", "matcher 처리", formatMilliseconds(matcher.elapsedMs)),
        ],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "confirmation",
        label: "사건 연속 확인",
        status: getConfirmationStatus(confirmation, activation),
        summary: confirmationSummary,
        detail:
          "단일 프레임을 알림 근거로 승격하지 않고, 같은 확인 시도에 연결된 관찰 두 개와 확정 결과를 구분합니다.",
        metrics: [
          metric("special-core-confirmation-kind", "확인 종류", formatConfirmationKind(firstString(confirmation?.kind, activation?.confirmationKind))),
          metric("special-core-confirmation-status", "확인 상태", formatConfirmationStatus(firstString(confirmation?.status))),
          metric("special-core-confirmation-observations", "연결 관찰", `${asArray(confirmation?.observationIds).length}개`),
          metric("special-core-confirmed-at", "활성화 확정", formatTimestamp(activation?.confirmedAt)),
        ],
        evidenceIds: incidentEvidenceIds,
      }),
      stage({
        id: "schedule",
        label: "사건 활성화·예약",
        status: getScheduleStatus(activation, schedule),
        summary: scheduleSummary,
        detail:
          "확정된 활성화와 같은 ID로 연결된 쿨타임 종료 및 알림 예약을 표시합니다.",
        metrics: [
          metric("special-core-activation-status", "활성화", formatActivation(activation)),
          metric("special-core-cooldown-ends", "쿨타임 종료", formatTimestamp(activation?.cooldownEndsAt)),
          metric("special-core-alert-due", "예상 알림", formatTimestamp(schedule?.alertDueAt ?? activation?.alertDueAt)),
          metric("special-core-schedule-status", "예약 상태", formatScheduleStatus(firstString(schedule?.status))),
          metric("special-core-schedule-reason", "예약 사유", firstString(schedule?.reason, schedule?.outcomeReason) ?? "없음"),
          metric("special-core-cooldown-setting", "재사용 대기시간", formatSecondsValue(configurationValues.cooldownSeconds)),
          metric("special-core-alert-setting", "알림 기준", formatSecondsLead(configurationValues.alertLeadSeconds)),
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
          "예약 ID와 활성화 ID가 모두 같은 알림 판정만 당시 실행 근거로 사용합니다.",
        metrics: [
          metric("special-core-decision-time", "판정 시각", formatTimestamp(decision?.occurredAt)),
          metric("special-core-decision-due", "예약 시각", formatTimestamp(decision?.dueAt)),
          metric("special-core-scheduler-delay", "스케줄러 지연", formatMilliseconds(decision?.schedulerDelayMs)),
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
          metric("special-core-playback-result", "브라우저 결과", playbackSummary.label),
          metric("special-core-playback-requested", "요청 시각", formatTimestamp(playback?.requestedAt)),
          metric("special-core-playback-accepted", "브라우저 수락", formatTimestamp(playback?.browserAcceptedAt)),
          metric("special-core-playback-finished", "재생 종료", formatTimestamp(playback?.finishedAt)),
          metric("special-core-effective-volume", "최종 볼륨", formatVolume(playback?.effectiveVolume)),
          metric("special-core-audibility", "실제 청취", "확인 불가"),
          metric(
            "special-core-related-playback",
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
          "특수 코어 제보는 창을 연 뒤 별도 parser나 matcher를 실행하지 않습니다. 참고 화면이 있어도 선택 사건의 인식·확정·알림 판정을 대신하지 않습니다.",
        replayCoverage: "recognition-not-run",
        metrics: [
          metric(
            "special-core-report-frame",
            "reportFrame",
            evidence.reportFrame === null ? "없음" : "이전 형식",
          ),
          metric("special-core-lifecycle", "선택 런타임 이벤트", `${lifecycle.length}개`),
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
  activation,
  decision,
  playback,
  selection,
}: {
  configurations: Record<string, unknown>[];
  frame: Record<string, unknown> | null;
  activation: Record<string, unknown> | null;
  decision: Record<string, unknown> | null;
  playback: Record<string, unknown> | null;
  selection: Record<string, unknown>;
}) {
  const ids = [
    firstString(playback?.configRevisionId),
    firstString(decision?.firedConfigRevisionId, decision?.timingConfigRevisionId),
    firstString(activation?.timingConfigRevisionId),
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

function selectCandidate(
  candidates: Record<string, unknown>[],
  observation: Record<string, unknown> | null,
) {
  const selectedBoxIndex = firstNumber(observation?.selectedCandidateBoxIndex);
  return selectedBoxIndex === null
    ? candidates[0] ?? null
    : candidates.find(
        (entry) => firstNumber(entry.boxIndex) === selectedBoxIndex,
      ) ?? candidates[0] ?? null;
}

function addIncidentMedia({
  collector,
  media,
  frames,
  selection,
}: {
  collector: ReturnType<typeof createEvidenceCollector>;
  media: Record<string, unknown>[];
  frames: Record<string, unknown>[];
  selection: Record<string, unknown>;
}) {
  const selectedFrameIds = new Set(
    [
      ...asArray(selection.mediaFrameIds),
      ...asArray(selection.frameIds),
    ].filter((entry): entry is string => typeof entry === "string"),
  );
  const selectedMedia = selectedFrameIds.size > 0
    ? media.filter((entry) => selectedFrameIds.has(firstString(entry.frameId) ?? ""))
    : media;
  const frameById = new Map(
    frames.map((entry) => [firstString(entry.id), entry]),
  );
  const ids: string[] = [];
  selectedMedia.slice(0, 12).forEach((entry, index) => {
    const stableId = (firstString(entry.id) ?? `media-${index}`).replace(
      /[^a-zA-Z0-9_-]/g,
      "-",
    );
    const id = `special-core-incident-${stableId}`;
    const frame = frameById.get(firstString(entry.frameId)) ?? {};
    const source = asRecord(frame.source);
    collector.add({
      id,
      group: "source",
      label: `선택 사건 버프칸 ${index + 1}`,
      description: `${formatMediaReason(firstString(entry.reason))} · 정상 감지 루프 입력`,
      value: entry.imageDataUrl,
      capturedAt: entry.sampledAt,
      stageId: "input",
      metadata: [
        metric(
          `special-core-media-input-${index}`,
          "parser 입력",
          firstString(source.parserInputMode) ?? "미기록",
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
    ["special-core-report-time-raw", "동결 시점 참고 원본", sampleNode.rawDataUrl],
    ["special-core-report-time-processed", "동결 시점 참고 전처리", sampleNode.processedDataUrl],
  ] as const) {
    collector.add({
      id,
      group: "runtime",
      label,
      description:
        "제보 창을 연 시점의 참고 화면입니다. 선택 사건 입력이나 독립 인식 결과로 해석하지 않습니다.",
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
  confirmation,
  activation,
  schedule,
  decision,
  playback,
  degradationReasons,
}: {
  selection: Record<string, unknown>;
  conclusion: string | null;
  runtimeFailure: Record<string, unknown>;
  observation: Record<string, unknown> | null;
  confirmation: Record<string, unknown> | null;
  activation: Record<string, unknown> | null;
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
        "special-core-incident-selection-unavailable",
        "critical",
        "선택한 특수 코어 사건을 찾지 못했습니다",
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
        "special-core-incident-runtime-failed",
        "critical",
        "선택 사건 분석 중 오류가 발생했습니다",
        formatRuntimeFailure(runtimeFailure),
        "detection",
      ),
    );
  }
  for (const [idsKey, record, label, stageId] of [
    ["observationIds", observation, "관찰", "recognition"],
    ["confirmationAttemptIds", confirmation, "연속 확인", "confirmation"],
    ["activationIds", activation, "활성화", "confirmation"],
    ["scheduleIds", schedule, "예약", "schedule"],
    ["decisionIds", decision, "알림 판정", "alert-decision"],
    ["playbackAttemptIds", playback, "재생 시도", "alert"],
  ] as const) {
    if (asArray(selection[idsKey]).length > 0 && !record) {
      diagnostics.push(
        diagnostic(
          `special-core-incident-link-missing-${idsKey}`,
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
      detail: "사건 메타데이터는 남아 있지만 일부 이미지가 제외됐습니다.",
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
      detail: "메타데이터는 있지만 연결된 R2 파일이 없어 다른 화면으로 대체하지 않았습니다.",
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
    `special-core-incident-omission-${reason}`,
    entry.tone,
    entry.title,
    entry.detail,
    "input",
  );
}

function createConclusionDiagnostic(conclusion: string): TroubleshooterDiagnostic {
  const entries: Record<
    string,
    { tone: TroubleshooterDiagnostic["tone"]; title: string; detail: string; stage: string }
  > = {
    "recognition-rejected": { tone: "warning", title: "특수 코어 후보가 matcher에서 거절됐습니다", detail: "선택 사건의 저장 점수와 형태 검증 사유를 확인하세요.", stage: "recognition" },
    "recognition-missing": { tone: "warning", title: "선택 프레임에서 특수 코어 후보를 찾지 못했습니다", detail: "parser 후보와 matcher 입력이 같은 프레임에 연결됐는지 확인하세요.", stage: "recognition" },
    "recognition-unconfirmed": { tone: "warning", title: "특수 코어를 한 번 찾았지만 연속 확인되지 않았습니다", detail: "두 번째 관찰이 확인 창 안에 들어왔는지 확인하세요.", stage: "confirmation" },
    "runtime-failure": { tone: "critical", title: "선택 사건 분석 중 실행 오류가 발생했습니다", detail: "저장된 오류 단계와 코드를 확인하세요.", stage: "detection" },
    "confirmation-expired": { tone: "warning", title: "연속 확인 시간이 지나 활성화되지 않았습니다", detail: "같은 확인 시도에서 필요한 관찰 수를 채우지 못했습니다.", stage: "confirmation" },
    "activation-missing": { tone: "critical", title: "연속 확인은 끝났지만 활성화 기록이 없습니다", detail: "확인 시도와 활성화 ID 연결을 확인하세요.", stage: "confirmation" },
    "schedule-missing": { tone: "critical", title: "활성화는 확정됐지만 알림 예약이 없습니다", detail: "활성화 ID에 연결된 예약 생성을 확인하세요.", stage: "schedule" },
    "schedule-not-due": { tone: "info", title: "제보 시점에는 아직 알림 시각 전이었습니다", detail: "저장된 예상 알림 시각과 제보 시각을 비교하세요.", stage: "schedule" },
    "schedule-replaced": { tone: "warning", title: "기존 알림 예약이 새 예약으로 교체됐습니다", detail: "설정 변경 또는 재예약 사유를 확인하세요.", stage: "schedule" },
    "schedule-cancelled": { tone: "warning", title: "알림 예약이 취소됐습니다", detail: "저장된 취소 사유와 런타임 경계를 확인하세요.", stage: "schedule" },
    "decision-suppressed": { tone: "warning", title: "알림 실행이 억제됐습니다", detail: "예약 결과와 억제 사유를 확인하세요.", stage: "alert-decision" },
    "decision-missing": { tone: "critical", title: "알림 시각에 실행 판정이 없습니다", detail: "예약은 남아 있지만 같은 ID의 판정이 생성되지 않았습니다.", stage: "alert-decision" },
    "decision-without-playback": { tone: "critical", title: "알림 판정은 있지만 재생 시도가 없습니다", detail: "같은 판정 ID에 연결된 브라우저 재생 요청이 생성되지 않았습니다.", stage: "alert" },
    "playback-requested-only": { tone: "warning", title: "브라우저 재생 요청만 기록됐습니다", detail: "play() 수락이나 실패 결과가 이어졌는지 확인하세요.", stage: "alert" },
    "playback-failed": { tone: "critical", title: "브라우저가 알림 재생을 완료하지 못했습니다", detail: "저장된 브라우저 오류와 당시 볼륨 설정을 확인하세요.", stage: "alert" },
    "browser-playback-accepted": { tone: "positive", title: "브라우저가 알림 재생 요청을 수락했습니다", detail: "브라우저 수락은 기록됐지만 실제 스피커 출력과 청취 여부는 확인할 수 없습니다.", stage: "alert" },
    "physical-audibility-unverifiable": { tone: "info", title: "실제 소리가 들렸는지는 확인할 수 없습니다", detail: "브라우저 재생 수락 이후의 OS 출력 장치와 사용자 청취 여부는 수집하지 않습니다.", stage: "alert" },
    "false-activation-chain-found": { tone: "critical", title: "오감지 활성화 체인을 찾았습니다", detail: "선택 관찰부터 활성화와 예약까지 연결된 저장 증거를 확인하세요.", stage: "confirmation" },
    "same-activation-duplicate-found": { tone: "critical", title: "같은 활성화에서 중복 알림 판정을 찾았습니다", detail: "동일 활성화 ID의 판정과 재생 시도를 비교하세요.", stage: "alert-decision" },
    "separate-activation-alerts-found": { tone: "info", title: "서로 다른 활성화에서 각각 알림이 발생했습니다", detail: "중복이 아니라 별도 활성화인지 reset 및 확인 체인을 확인하세요.", stage: "alert-decision" },
    "valid-reacquire-found": { tone: "positive", title: "쿨타임 중 재감지가 별도 활성화로 확인됐습니다", detail: "재감지 확인 규칙과 새 예약이 일관되게 연결됐습니다.", stage: "confirmation" },
    "unexpected-special-core-playback-found": { tone: "critical", title: "예상하지 않은 특수 코어 재생 시도를 찾았습니다", detail: "선택 재생의 활성화·예약·판정 연결을 확인하세요.", stage: "alert" },
    "unrelated-feature-playback-found": { tone: "info", title: "같은 시점의 다른 기능 재생을 찾았습니다", detail: "특수 코어 재생과 섞지 않고 별도 참고로 표시합니다.", stage: "alert" },
    "playback-source-unavailable": { tone: "warning", title: "문제 시점의 재생 출처를 확인할 수 없습니다", detail: "특수 코어와 다른 기능 재생 기록이 모두 없습니다.", stage: "alert" },
    "early-alert-chain-found": { tone: "critical", title: "예약 시각보다 이른 알림 판정을 찾았습니다", detail: "판정 시각과 같은 예약 ID의 dueAt을 비교하세요.", stage: "alert-decision" },
    "late-alert-chain-found": { tone: "warning", title: "예약 시각보다 늦은 알림 판정을 찾았습니다", detail: "저장된 스케줄러 지연 시간을 확인하세요.", stage: "alert-decision" },
    "timing-chain-consistent": { tone: "positive", title: "알림 예약과 실행 시각이 일관됩니다", detail: "활성화부터 예약과 판정까지 같은 ID 체인으로 연결됐습니다.", stage: "alert-decision" },
    "presentation-event-found": { tone: "info", title: "선택 사건과 연결된 화면 상태 변경을 찾았습니다", detail: "화면 표시는 알림 판정과 별도로 해석합니다.", stage: "report-time" },
    "presentation-state-only": { tone: "warning", title: "화면 상태만 있고 연결된 런타임 사건은 없습니다", detail: "현재 표시 상태를 당시 인식 또는 알림 결과로 단정하지 않습니다.", stage: "report-time" },
    "audio-configuration-found": { tone: "info", title: "당시 알림 소리와 볼륨 설정을 찾았습니다", detail: "선택 재생 시도에 고정된 소리와 최종 볼륨을 확인하세요.", stage: "alert" },
    "configuration-transition-found": { tone: "info", title: "선택 사건 주변의 설정 변경을 찾았습니다", detail: "재사용 대기시간, 알림 기준 또는 볼륨 변경을 확인하세요.", stage: "schedule" },
    "runtime-error-found": { tone: "critical", title: "선택 사건의 실행 오류를 찾았습니다", detail: "저장된 단계, 오류 코드와 복구 여부를 확인하세요.", stage: "detection" },
    "interaction-event-found": { tone: "info", title: "선택 사건과 연결된 사용자 조작을 찾았습니다", detail: "조작 뒤 런타임 경계와 설정 변경을 확인하세요.", stage: "report-time" },
    "unsupported-other": { tone: "warning", title: "기타 사유를 구체적인 사건 유형으로 분류하지 못했습니다", detail: "메모만으로 광범위한 화면이나 설정을 추가 수집하지 않습니다.", stage: "input" },
    "ambiguous-incident": { tone: "warning", title: "문제 시점의 사건을 하나로 좁히지 못했습니다", detail: "같은 조건의 후보 사건을 임의로 합치지 않았습니다.", stage: "input" },
    "evidence-outside-retention": { tone: "critical", title: "문제 시점이 브라우저 보관 범위보다 이전입니다", detail: "1분보다 이전 사건은 자동 증거로 재현할 수 없습니다.", stage: "input" },
    "evidence-unavailable": { tone: "critical", title: "선택 조건에 맞는 사건 증거가 없습니다", detail: "해당 시점의 정상 런타임 체인을 찾지 못했습니다.", stage: "input" },
    "legacy-evidence-unavailable": { tone: "warning", title: "이전 제보 형식이라 사건 체인을 확인할 수 없습니다", detail: "구형 제보는 기존 참고 화면과 상태만 표시합니다.", stage: "input" },
    "report-time-context-only": { tone: "warning", title: "동결 시점 참고 화면만 있고 선택 사건 증거가 없습니다", detail: "참고 화면을 과거 사건의 인식 또는 알림 판정으로 사용하지 않습니다.", stage: "input" },
  };
  const entry = entries[conclusion] ?? {
    tone: "info" as const,
    title: formatOperatorConclusion(conclusion),
    detail: "저장된 선택 사건 결론입니다.",
    stage: "runtime",
  };
  return diagnostic(
    `special-core-incident-conclusion-${conclusion}`,
    entry.tone,
    entry.title,
    entry.detail,
    entry.stage,
  );
}

function getInputStatus(
  selection: Record<string, unknown>,
  mediaCount: number,
  degradationReasons: string[],
): PipelineStageStatus {
  if (selection.support === "unsupported") return "blocked";
  if (mediaCount === 0) return "unavailable";
  return degradationReasons.some(isMediaDegradationReason)
    ? "warning"
    : "complete";
}

function getDetectionStatus(
  frame: Record<string, unknown> | null,
  runtimeFailure: Record<string, unknown>,
): PipelineStageStatus {
  if (Object.keys(runtimeFailure).length > 0) return "blocked";
  if (!frame) return "unavailable";
  return asArray(frame.parsedBoxes).length > 0 ? "complete" : "warning";
}

function getRecognitionStatus(
  observation: Record<string, unknown> | null,
  runtimeFailure: Record<string, unknown>,
): PipelineStageStatus {
  if (Object.keys(runtimeFailure).length > 0) return "blocked";
  if (!observation) return "unavailable";
  const decision = firstString(observation.decision);
  if (decision === "accepted") return "complete";
  if (decision === "error") return "blocked";
  return "warning";
}

function getConfirmationStatus(
  confirmation: Record<string, unknown> | null,
  activation: Record<string, unknown> | null,
): PipelineStageStatus {
  if (activation) return "complete";
  if (!confirmation) return "unavailable";
  if (confirmation.status === "expired" || confirmation.status === "terminal") {
    return "warning";
  }
  return "pending";
}

function getScheduleStatus(
  activation: Record<string, unknown> | null,
  schedule: Record<string, unknown> | null,
): PipelineStageStatus {
  if (!activation) return "unavailable";
  if (!schedule) return "blocked";
  if (schedule.status === "registered") return "pending";
  if (schedule.status === "fired") return "complete";
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
    "confirmation-attempt": "연속 확인",
    activation: "활성화",
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

function formatObservation(
  observation: Record<string, unknown> | null,
  matcher: Record<string, unknown>,
) {
  if (!observation) return "관찰 기록 없음";
  const decision = formatObservationDecision(firstString(observation.decision));
  const matcherDecision = firstString(matcher.decisionReason)
    ? formatSpecialCoreDecisionReason(firstString(matcher.decisionReason))
    : null;
  return [decision, matcherDecision].filter(Boolean).join(" · ");
}

function formatObservationDecision(value: string | null) {
  const labels: Record<string, string> = {
    accepted: "후보 채택",
    rejected: "후보 거절",
    missing: "후보 없음",
    error: "실행 오류",
  };
  return value ? labels[value] ?? value : "미기록";
}

function formatConfirmation(
  confirmation: Record<string, unknown> | null,
  activation: Record<string, unknown> | null,
) {
  if (activation) {
    return `활성화 확정 · 관찰 ${asArray(activation.observationIds).length}개`;
  }
  if (!confirmation) return "연속 확인 기록 없음";
  return `${formatConfirmationStatus(firstString(confirmation.status))} · 관찰 ${asArray(confirmation.observationIds).length}개`;
}

function formatConfirmationStatus(value: string | null) {
  const labels: Record<string, string> = {
    collecting: "확인 중",
    confirmed: "확인 완료",
    expired: "확인 시간 만료",
    terminal: "확인 종료",
  };
  return value ? labels[value] ?? value : "미기록";
}

function formatConfirmationKind(value: string | null) {
  if (value === "new-activation") return "새 활성화";
  if (value === "cooldown-reacquire") return "쿨타임 중 재감지";
  return value ?? "미기록";
}

function formatActivation(activation: Record<string, unknown> | null) {
  if (!activation) return "없음";
  return activation.status === "terminal" ? "종료" : "활성";
}

function formatSchedule(
  schedule: Record<string, unknown> | null,
  decision: Record<string, unknown> | null,
) {
  if (decision) return `알림 실행 · ${formatTimestamp(decision.occurredAt)}`;
  if (!schedule) return "예약 기록 없음";
  return `${formatScheduleStatus(firstString(schedule.status))} · ${formatTimestamp(schedule.alertDueAt)}`;
}

function formatScheduleStatus(value: string | null) {
  const labels: Record<string, string> = {
    registered: "예약 중",
    replaced: "예약 교체",
    cancelled: "예약 취소",
    suppressed: "알림 억제",
    fired: "알림 실행",
  };
  return value ? labels[value] ?? value : "미기록";
}

function formatPlayback(
  playback: Record<string, unknown> | null,
  decision: Record<string, unknown> | null,
) {
  if (!playback) {
    return decision
      ? {
          label: "알림 판정 있음 · 재생 시도 없음",
          detail: "같은 알림 판정 ID에 연결된 브라우저 재생 요청이 없습니다.",
        }
      : { label: "재생 기록 없음", detail: "선택 사건에 연결된 재생 시도가 없습니다." };
  }
  if (playback.status === "failed") {
    return {
      label: playback.error ? `재생 실패 (${String(playback.error)})` : "재생 실패",
      detail: "브라우저 재생이 실패했습니다. 저장된 오류와 당시 볼륨 설정을 확인하세요.",
    };
  }
  if (playback.status === "finished") {
    return {
      label: "브라우저 재생 종료",
      detail: "브라우저 재생 lifecycle이 종료됐습니다. 실제 스피커 출력과 청취 여부는 확인할 수 없습니다.",
    };
  }
  if (playback.status === "browser-play-accepted") {
    return {
      label: "브라우저 play() 수락",
      detail: "브라우저가 play() 요청을 수락했습니다. 실제 스피커 출력과 청취 여부는 확인할 수 없습니다.",
    };
  }
  return {
    label: "재생 요청만 기록",
    detail: "브라우저 play() 수락 또는 실패 결과가 아직 기록되지 않았습니다.",
  };
}

function formatDetection(
  frame: Record<string, unknown> | null,
  runtimeFailure: Record<string, unknown>,
) {
  if (Object.keys(runtimeFailure).length > 0) {
    return `실행 오류 · ${firstString(runtimeFailure.code) ?? "원인 미기록"}`;
  }
  if (!frame) return "선택 프레임 없음";
  return `${asArray(frame.parsedBoxes).length}칸 · 후보 ${asArray(frame.eligibleBoxIndexes).length}개`;
}

function formatRuntimeFailure(failure: Record<string, unknown>) {
  return [
    firstString(failure.stage),
    firstString(failure.code),
    firstString(failure.technicalMessage),
  ].filter(Boolean).join(" · ") || "상세 미기록";
}

function formatMediaReason(value: string | null) {
  const labels: Record<string, string> = {
    "playback-failed": "재생 실패",
    "alert-decision": "알림 판정",
    "activation-confirmation": "활성화 확인",
    "runtime-error": "실행 오류",
    "rejected-observation": "거절 관찰",
    current: "현재 사건",
    periodic: "주기 보관",
  };
  return value ? labels[value] ?? value : "보관 사유 미기록";
}

function formatOperatorConclusion(value: string | null) {
  const labels: Record<string, string> = {
    "recognition-rejected": "인식 거절",
    "recognition-missing": "후보 없음",
    "recognition-unconfirmed": "연속 확인 중",
    "runtime-failure": "분석 오류",
    "confirmation-expired": "연속 확인 만료",
    "activation-missing": "활성화 없음",
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
    "false-activation-chain-found": "오감지 활성화 체인",
    "same-activation-duplicate-found": "같은 활성화 중복",
    "separate-activation-alerts-found": "별도 활성화 알림",
    "valid-reacquire-found": "정상 재감지",
    "unexpected-special-core-playback-found": "예상 밖 특수 코어 재생",
    "unrelated-feature-playback-found": "다른 기능 재생",
    "playback-source-unavailable": "재생 출처 없음",
    "early-alert-chain-found": "이른 알림",
    "late-alert-chain-found": "늦은 알림",
    "timing-chain-consistent": "알림 시각 일치",
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

function formatVolume(value: unknown) {
  const parsed = firstNumber(value);
  return parsed === null ? "미기록" : `${Math.round(parsed * 100)}%`;
}

function formatSecondsValue(value: unknown) {
  const parsed = firstNumber(value);
  return parsed === null ? "미기록" : `${parsed}초`;
}

function formatSecondsLead(value: unknown) {
  const parsed = firstNumber(value);
  return parsed === null ? "미기록" : `${parsed}초 전`;
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
