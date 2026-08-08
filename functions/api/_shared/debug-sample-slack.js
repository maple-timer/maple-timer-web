import {
  formatAppBuild,
  formatBuffExpiryStatus,
  formatConfidence,
  formatCount,
  formatCountRange,
  formatHuntStallMode,
  formatNullable,
  formatRemainingCountFlowDecision,
  formatSeconds,
  formatSkillClassInstallSettings,
  formatSkillDetectionEngine,
  formatSkillDetectionSource,
  formatSkillMatcherDecision,
  formatSpecialCoreMatcherDecision,
  formatSkillPreset,
  formatSkillReportSettings,
  formatStatus,
  formatTimestamp,
  isRemainingCountSkill,
  MAX_NOTIFICATION_LENGTH,
  REPORT_KIND_LABELS,
  summarizeBuffExpiryPrecisionGroups,
  summarizeBuffExpiryPrecisionModules,
  truncate,
} from "./debug-sample-format.js";
import { buildDebugSampleLinks } from "./debug-sample-links.js";

function escapeSlackMrkdwn(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function slackField(label, value) {
  return {
    type: "mrkdwn",
    text: `*${escapeSlackMrkdwn(label)}*\n${escapeSlackMrkdwn(formatNullable(value))}`,
  };
}

function formatDetectionSignal(value) {
  if (value === true) return "감지";
  if (value === false) return "감지 없음";
  return "미기록";
}

function formatUltimaRaidBagCountState(value) {
  if (value === "full") return "가득 참";
  if (value === "clear") return "여유 있음";
  if (value === "unreadable") return "판독 불가";
  return "미기록";
}

function formatUltimaRaidRelativeBand(top, height) {
  const resolvedTop = toFiniteNumber(top);
  const resolvedHeight = toFiniteNumber(height);
  if (resolvedTop === null || resolvedHeight === null) return "미기록";
  return `${Math.round(resolvedTop * 100)}~${Math.round(
    (resolvedTop + resolvedHeight) * 100,
  )}%`;
}

function formatUltimaRaidRelativePosition(x, y) {
  const resolvedX = toFiniteNumber(x);
  const resolvedY = toFiniteNumber(y);
  if (resolvedX === null || resolvedY === null) return "미기록";
  return `가로 ${Math.round(resolvedX * 100)}% · 세로 ${Math.round(
    resolvedY * 100,
  )}%`;
}

function pushSlackFieldSections(blocks, fields) {
  for (let index = 0; index < fields.length; index += 10) {
    blocks.push({
      type: "section",
      fields: fields.slice(index, index + 10),
    });
  }
}

function pushSlackTextSection(blocks, text) {
  if (!text) {
    return;
  }
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: escapeSlackMrkdwn(truncate(text, 2800)),
    },
  });
}

function getReportSlackColor(kind) {
  const colors = {
    "rune-false-positive": "#8b5cf6",
    "skill-misread": "#14b8a6",
    "rune-issue": "#8b5cf6",
    "skill-issue": "#14b8a6",
    "hunt-stall-issue": "#10b981",
    "buff-expiry-issue": "#f59e0b",
    "booster-expiry-issue": "#0ea5e9",
    "special-core-issue": "#a855f7",
    "ultima-raid-equipment-issue": "#f97316",
    "ultima-raid-boss-issue": "#db2777",
  };
  return colors[kind] ?? "#2f855a";
}

function formatRuntimeParser(sample) {
  const parser = sample?.parser ?? {};
  const engine = parser.engine || "미기록";
  const version = parser.version || "버전 없음";
  const provider = parser.runtime?.executionProvider;
  const latency = Number(parser.performance?.detectMs);
  const summary = [
    engine,
    version,
    provider ? `실행: ${formatExecutionProvider(provider)}` : null,
    Number.isFinite(latency) ? `parser: ${Math.round(latency)}ms` : null,
    parser.fallbackReason ? `fallback: ${parser.fallbackReason}` : null,
  ].filter(Boolean).join(" · ");
  const failure = parser.failure;
  if (!failure || typeof failure !== "object") {
    return summary;
  }
  const diagnostic = failure.diagnostic ?? {};
  const failureSummary = [
    formatParserFailureReason(failure.reason),
    formatParserFailureStage(diagnostic.stage),
    diagnostic.code || null,
  ].filter(Boolean).join(" · ");
  const technicalMessage = failure.technicalMessage || diagnostic.technicalMessage;
  return [
    summary,
    failureSummary ? `실패: ${failureSummary}` : "실패 기록 있음",
    technicalMessage ? `기술 오류: ${truncate(String(technicalMessage), 180)}` : null,
  ].filter(Boolean).join(" · ");
}

function formatRuntimeAnalysisFailure(body) {
  const failure = getLatestRuntimeAnalysisFailure(body);
  if (!failure) return null;
  const stages = {
    "frame-capture": "화면 준비",
    recognizer: "인식기 실행",
    "feature-analysis": "기능 분석",
  };
  return [
    stages[failure.stage] || failure.stage || "단계 미기록",
    failure.code || "코드 미기록",
    failure.technicalMessage
      ? truncate(String(failure.technicalMessage), 180)
      : null,
  ].filter(Boolean).join(" · ");
}

function getLatestRuntimeAnalysisFailure(body) {
  const sample = body?.sample ?? {};
  if (sample?.result?.runtimeFailure) {
    return sample.result.runtimeFailure;
  }
  const traces = [sample.runtimeTrace, body?.skill?.runtimeTimeline?.samples];
  for (const trace of traces) {
    if (!Array.isArray(trace) || trace.length === 0) continue;
    const failure = trace[trace.length - 1]?.runtimeFailure;
    if (failure) return failure;
  }
  return null;
}

function formatParserFailureReason(reason) {
  if (reason === "webgpu-unavailable") return "그래픽 장치 사용 불가";
  if (reason === "model-load-failed") return "모델 준비 실패";
  if (reason === "worker-failed") return "분석 작업 실패";
  if (reason === "runtime-failed") return "모델 실행 실패";
  return reason || null;
}

function formatParserFailureStage(stage) {
  const labels = {
    "analysis-worker": "분석 작업 시작",
    "webgpu-api": "브라우저 WebGPU 지원",
    "gpu-adapter": "그래픽 장치 연결",
    "gpu-device": "그래픽 연산 준비",
    "onnx-runtime": "정밀 감지 실행 엔진",
    "model-session": "정밀 감지 모델 준비",
    "first-inference": "실제 모델 분석",
  };
  return stage ? labels[stage] || stage : null;
}

function formatExecutionProvider(provider) {
  if (provider === "webgpu") return "GPU (WebGPU)";
  if (provider === "wasm") return "CPU (WASM)";
  if (provider === "remote") return "원격 서버";
  return provider;
}

function formatPlaybackStatus(playback) {
  if (!playback) return "기록 없음";
  if (playback.status === "failed") {
    return playback.error ? `재생 실패 (${playback.error})` : "재생 실패";
  }
  if (
    playback.effectiveVolume !== null &&
    playback.effectiveVolume !== undefined &&
    Number(playback.effectiveVolume) === 0
  ) {
    return "무음 설정";
  }
  if (playback.status === "finished") return "브라우저 재생 종료";
  if (playback.status === "started") return "브라우저 재생 시작";
  if (playback.status === "requested") return "재생 요청만 기록";
  return "기록 없음";
}

function formatUltimaRaidPlaybackStatus(playback) {
  const status = formatPlaybackStatus(playback);
  if (!playback || status === "기록 없음") return status;
  if (playback.kind === "initial") return `첫 알림 · ${status}`;
  if (playback.kind !== "repeat") return status;
  const repeatIndex = toFiniteNumber(playback.repeatIndex);
  const repeatMaxCount = toFiniteNumber(playback.repeatMaxCount);
  const label =
    repeatIndex === null
      ? "반복 알림"
      : `반복 ${Math.round(repeatIndex)}${repeatMaxCount === null ? "" : `/${Math.round(repeatMaxCount)}`}회`;
  return `${label} · ${status}`;
}

function formatUltimaRaidRepeatSetting(config) {
  if (config?.repeatAlertEnabled !== true) return "사용 안 함";
  const repeatIntervalSeconds = toFiniteNumber(
    config?.repeatAlertIntervalSeconds,
  );
  const repeatMaxCount = toFiniteNumber(config?.repeatAlertMaxCount);
  const interval = repeatIntervalSeconds !== null
    ? `${repeatIntervalSeconds}초 간격`
    : "간격 미기록";
  const count = repeatMaxCount !== null
    ? `${Math.round(repeatMaxCount)}회`
    : "횟수 미기록";
  return `${interval} · ${count}`;
}

function formatUltimaRaidRepeatPlayback(playbacks, target, config) {
  if (config?.repeatAlertEnabled !== true) return "사용 안 함";
  const repeats = playbacks.filter(
    (entry) =>
      (entry?.target ?? "equipment") === target && entry?.kind === "repeat",
  );
  const finished = repeats.filter((entry) => entry?.status === "finished").length;
  const failed = repeats.filter((entry) => entry?.status === "failed").length;
  const configuredMaxCount = toFiniteNumber(config?.repeatAlertMaxCount);
  const expected =
    configuredMaxCount === null ? null : Math.round(configuredMaxCount);
  return [
    expected === null ? `${finished}회 완료` : `${finished}/${expected}회 완료`,
    failed > 0 ? `실패 ${failed}회` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function resolveUltimaRaidRepeatContext({
  playbacks,
  target,
  selectedPlayback,
  fallbackConfig,
}) {
  const targetPlaybacks = playbacks.filter(
    (entry) => (entry?.target ?? "equipment") === target,
  );
  const selectedCycleId = toFiniteNumber(selectedPlayback?.cycleId);
  const cyclePlaybacks =
    selectedCycleId === null
      ? targetPlaybacks
      : targetPlaybacks.filter(
          (entry) => toFiniteNumber(entry?.cycleId) === selectedCycleId,
        );
  const hasRecordedRepeatConfig =
    selectedPlayback &&
    (Object.prototype.hasOwnProperty.call(
      selectedPlayback,
      "repeatIntervalSeconds",
    ) ||
      Object.prototype.hasOwnProperty.call(
        selectedPlayback,
        "repeatMaxCount",
      ));
  if (!hasRecordedRepeatConfig) {
    return {
      playbacks: cyclePlaybacks,
      config: fallbackConfig,
    };
  }

  const repeatIntervalSeconds = toFiniteNumber(
    selectedPlayback.repeatIntervalSeconds,
  );
  const repeatMaxCount = toFiniteNumber(selectedPlayback.repeatMaxCount);
  return {
    playbacks: cyclePlaybacks,
    config: {
      repeatAlertEnabled:
        selectedPlayback.kind === "repeat" ||
        repeatIntervalSeconds !== null ||
        repeatMaxCount !== null,
      repeatAlertIntervalSeconds: repeatIntervalSeconds,
      repeatAlertMaxCount: repeatMaxCount,
    },
  };
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatIssueOccurrence(value) {
  if (value === "current") return "제보 창을 열기 직전에도 재현";
  if (value === "recent") return "제보 창을 열기 전 1분 이내";
  if (value === "historical") return "제보 창을 열기 1분보다 이전";
  return value || "기록 없음";
}

function formatIncidentEvidence(incident) {
  if (!incident || typeof incident !== "object") return "이전 제보 형식";
  const evidence = incident.evidence ?? {};
  const journal = incident.journal ?? {};
  const relatedPlaybackCount = Array.isArray(journal.relatedPlaybackEntries)
    ? journal.relatedPlaybackEntries.length
    : 0;
  const lifecycleEventCount = Array.isArray(journal.entries)
    ? journal.entries.filter((entry) => entry?.kind === "lifecycle").length
    : 0;
  const correlation = incident.correlation ?? {};
  const references = Array.isArray(incident.evidenceManifest?.references)
    ? incident.evidenceManifest.references
    : [];
  const retainedReferences = references.filter((reference) => reference?.retained === true);
  const producedReferences = references.filter(isProducedEvidenceReference);
  const unavailableReferenceCount = Math.max(0, references.length - producedReferences.length);
  return [
    evidence.source || "출처 미기록",
    evidence.stateBinding || "상태 결합 미기록",
    Number.isFinite(evidence.frameCount) ? `${evidence.frameCount}프레임` : null,
    Number.isFinite(evidence.mediaCount) ? `이미지 ${evidence.mediaCount}개` : null,
    journal.status
      ? `사건 ${formatIncidentJournalStatus(journal.status)} ${Array.isArray(journal.entries) ? journal.entries.length : 0}개`
      : null,
    relatedPlaybackCount > 0 ? `다른 기능 재생 ${relatedPlaybackCount}` : null,
    lifecycleEventCount > 0 ? `예약 흐름 ${lifecycleEventCount}` : null,
    references.length > 0
      ? `증거 ${retainedReferences.length}/${producedReferences.length}${unavailableReferenceCount > 0 ? ` · 미생성 ${unavailableReferenceCount}` : ""}`
      : null,
    Array.isArray(correlation.playbackIds) || Array.isArray(correlation.configRevisions)
      ? `재생 ${Array.isArray(correlation.playbackIds) ? correlation.playbackIds.length : 0} · 설정 ${Array.isArray(correlation.configRevisions) ? correlation.configRevisions.length : 0}`
      : null,
  ].filter(Boolean).join(" · ");
}

function isProducedEvidenceReference(reference) {
  if (!reference || typeof reference !== "object") return false;
  if (reference.produced === true) return true;
  return !("produced" in reference) && reference.retained === true;
}

function formatIncidentJournalStatus(value) {
  if (value === "matched") return "연결";
  if (value === "current-snapshot") return "현재 연결";
  if (value === "outside-retention") return "범위 밖";
  if (value === "unavailable") return "없음";
  return value;
}

function formatHuntStallRepeat(config, state) {
  if (!config || config.mode === "cooldown-presence") return "해당 없음";
  if (config.repeatAlertEnabled !== true) {
    return Object.prototype.hasOwnProperty.call(config, "repeatAlertEnabled")
      ? "사용 안 함"
      : "기록 없음";
  }
  const interval = Number.isFinite(config.repeatAlertIntervalSeconds)
    ? config.repeatAlertIntervalSeconds
    : 3;
  const count = Number.isFinite(state?.repeatedAlertCount)
    ? state.repeatedAlertCount
    : 0;
  const maxCount = config.repeatAlertMaxCount;
  return maxCount === null || maxCount === undefined
    ? `${interval}초 간격 · ${count}회 · 계속`
    : `${interval}초 간격 · ${count}/${maxCount}회`;
}

function buildHuntStallIncidentSlackFields(body, config) {
  const evidence = body?.sample?.huntStallEvidence;
  if (evidence?.schemaVersion !== "hunt-stall-incident-evidence-v1") {
    return null;
  }
  const selection = evidence.selection ?? {};
  const frames = Array.isArray(evidence.frames) ? evidence.frames : [];
  const observations = Array.isArray(evidence.observations)
    ? evidence.observations
    : [];
  const episodes = Array.isArray(evidence.stallEpisodes)
    ? evidence.stallEpisodes
    : [];
  const cycles = Array.isArray(evidence.alertCycles)
    ? evidence.alertCycles
    : [];
  const decisions = Array.isArray(evidence.decisions)
    ? evidence.decisions
    : [];
  const attempts = Array.isArray(evidence.playbackAttempts)
    ? evidence.playbackAttempts
    : [];
  const media = Array.isArray(evidence.media) ? evidence.media : [];
  const relatedPlayback = Array.isArray(evidence.relatedPlayback)
    ? evidence.relatedPlayback
    : [];
  const primaryObservation = selectIncidentObservationById(
    observations,
    selection,
  );
  const primaryFrame = selectIncidentFrameById(
    frames,
    primaryObservation?.frameId,
    selection,
  );
  const primaryEpisode = selectIncidentRecordById(
    episodes,
    selection.stallEpisodeIds,
    "startedAt",
    selection.selectedEventAt,
  );
  const latestDecision = selectIncidentRecordById(
    decisions,
    selection.decisionIds,
    "occurredAt",
    selection.selectedEventAt,
  );
  const latestAttempt = selectIncidentRecordById(
    attempts,
    selection.attemptIds,
    "requestedAt",
    selection.selectedEventAt,
  );
  const mode = selection.mode ?? primaryFrame?.mode ?? config?.mode;

  return [
    slackField("모드", formatHuntStallMode(mode)),
    slackField(
      "선택 사건",
      formatHuntStallIncidentSelection(selection),
    ),
    slackField("사건 시각", formatTimestamp(selection.selectedEventAt)),
    slackField(
      "사건 프레임/이미지",
      `${frames.length}개 / ${countHuntStallIncidentMedia(media)}개`,
    ),
    slackField(
      "사건 판독",
      formatHuntStallIncidentRecognition(primaryObservation?.recognition),
    ),
    slackField(
      "사건 변화 판정",
      formatHuntStallIncidentTransition(primaryObservation?.transition),
    ),
    slackField(
      "사건 정지 구간",
      formatHuntStallIncidentEpisode(primaryEpisode),
    ),
    slackField(
      "사건 알림 판정",
      formatHuntStallIncidentDecision(latestDecision, cycles),
    ),
    slackField(
      "사건 브라우저 재생",
      formatHuntStallIncidentPlayback(latestAttempt, latestDecision),
    ),
    slackField("실제 청취", "확인 불가"),
    slackField(
      "사건 분석 영역",
      formatHuntStallIncidentRegion(primaryFrame),
    ),
    slackField(
      "사건 인식기",
      formatHuntStallIncidentRuntime(primaryFrame),
    ),
    slackField(
      "사건 증거 누락",
      formatHuntStallIncidentOmissions(evidence),
    ),
    slackField(
      "다른 기능 재생",
      relatedPlayback.length > 0 ? `${relatedPlayback.length}개 · 별도 참고` : "없음",
    ),
    slackField(
      "제보 전송 시점 참고",
      evidence.reportFrame === null
        ? "독립 분석 없음 · 선택 사건만 사용"
        : "이전 형식 참고 자료 · 선택 사건과 별도",
    ),
  ];
}

function selectIncidentObservationById(observations, selection) {
  const requestedIds = Array.isArray(selection?.observationIds)
    ? selection.observationIds
    : [];
  const selectedIds = new Set(requestedIds);
  const selected = observations.filter((entry) => selectedIds.has(entry?.id));
  if (requestedIds.length > 0 && selected.length === 0) return null;
  return selectIncidentRecordByTime(
    selected.length > 0 ? selected : observations,
    selection?.selectedEventAt,
    "sampledAt",
  );
}

function selectIncidentFrameById(frames, observationFrameId, selection) {
  const direct = frames.find((entry) => entry?.id === observationFrameId);
  if (direct) return direct;
  const requestedIds = Array.isArray(selection?.frameIds)
    ? selection.frameIds
    : [];
  const selectedIds = new Set(requestedIds);
  const selected = frames.filter((entry) => selectedIds.has(entry?.id));
  if (requestedIds.length > 0 && selected.length === 0) return null;
  return selectIncidentRecordByTime(
    selected.length > 0 ? selected : frames,
    selection?.selectedEventAt,
    "sampledAt",
  );
}

function selectIncidentRecordById(
  records,
  selectedIds,
  timeKey,
  selectedEventAt = null,
) {
  const requestedIds = Array.isArray(selectedIds) ? selectedIds : [];
  const ids = new Set(requestedIds);
  const selected = records.filter((entry) => ids.has(entry?.id));
  if (requestedIds.length > 0 && selected.length === 0) return null;
  return selectIncidentRecordByTime(
    selected.length > 0 ? selected : records,
    selectedEventAt,
    timeKey,
  );
}

function selectIncidentRecordByTime(records, selectedEventAt, timeKey) {
  const eventAt = Number(selectedEventAt);
  return [...records].sort((left, right) => {
    const leftAt = Number(left?.[timeKey] ?? 0);
    const rightAt = Number(right?.[timeKey] ?? 0);
    if (Number.isFinite(eventAt)) {
      const distance = Math.abs(leftAt - eventAt) - Math.abs(rightAt - eventAt);
      if (distance !== 0) return distance;
    }
    return rightAt - leftAt;
  })[0] ?? null;
}

function formatHuntStallIncidentSelection(selection) {
  const statuses = {
    matched: "최근 사건 일치",
    "current-snapshot": "현재 사건 일치",
    "outside-retention": "보관 범위 밖",
    unavailable: "일치 사건 없음",
    "not-applicable": "해당 없음",
  };
  const supports = {
    definitive: "판단 가능",
    partial: "일부 증거",
    unsupported: "판단 불가",
  };
  const anchors = {
    frame: "프레임",
    observation: "판독",
    episode: "정지 구간",
    cycle: "알림 주기",
    decision: "알림 판정",
    attempt: "재생 시도",
    event: "런타임 이벤트",
    configuration: "설정",
    state: "상태",
  };
  return [
    statuses[selection?.status] ?? selection?.status ?? "미기록",
    supports[selection?.support] ?? selection?.support ?? "미기록",
    anchors[selection?.anchorKind] ?? "기준 없음",
    formatHuntStallOperatorConclusion(selection?.operatorConclusion),
    selection?.ambiguous ? "사건 모호" : null,
  ].filter(Boolean).join(" · ");
}

function formatHuntStallOperatorConclusion(value) {
  const labels = {
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
  return labels[value] ?? value ?? null;
}

function formatHuntStallIncidentRecognition(recognition) {
  if (!recognition || typeof recognition !== "object") return "미기록";
  const decisions = {
    accepted: "채택",
    rejected: "거절",
    missing: "판독 없음",
    error: "오류",
  };
  const raw = recognition.rawValue ?? recognition.rawText;
  const corrected = recognition.correctedValue;
  const value = corrected !== null && corrected !== undefined
    ? raw !== null && raw !== undefined && String(raw) !== String(corrected)
      ? `${raw} → ${corrected}`
      : String(corrected)
    : raw;
  return [
    decisions[recognition.decision] ?? recognition.decision ?? "판정 미기록",
    value !== null && value !== undefined ? `값 ${value}` : null,
    Number.isFinite(Number(recognition.confidence))
      ? `신뢰도 ${Math.round(Number(recognition.confidence) * 100)}%`
      : null,
    recognition.reason,
  ].filter(Boolean).join(" · ");
}

function formatHuntStallIncidentTransition(transition) {
  if (!transition || typeof transition !== "object") return "미기록";
  const kinds = {
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
  return [
    kinds[transition.kind] ?? transition.kind ?? "미기록",
    Number.isFinite(Number(transition.elapsedMs))
      ? `${Math.round(Number(transition.elapsedMs) / 100) / 10}초`
      : null,
    transition.reason,
  ].filter(Boolean).join(" · ");
}

function formatHuntStallIncidentEpisode(episode) {
  if (!episode || typeof episode !== "object") return "기록 없음";
  const evaluation = episode.lastEvaluation ?? {};
  return [
    episode.status ?? "상태 미기록",
    Number.isFinite(Number(evaluation.elapsedMs)) &&
    Number.isFinite(Number(evaluation.thresholdMs))
      ? `${Math.round(Number(evaluation.elapsedMs) / 100) / 10}/${Math.round(Number(evaluation.thresholdMs) / 100) / 10}초`
      : null,
    evaluation.outcome,
    evaluation.reason,
  ].filter(Boolean).join(" · ");
}

function formatHuntStallIncidentDecision(decision, cycles) {
  if (!decision || typeof decision !== "object") {
    return cycles.length > 0 ? "알림 주기 있음 · 판정 없음" : "기록 없음";
  }
  const evaluation = decision.evaluation ?? {};
  return [
    decision.kind === "repeat" ? "반복" : "첫 알림",
    evaluation.outcome ?? "판정 미기록",
    evaluation.reason,
  ].filter(Boolean).join(" · ");
}

function formatHuntStallIncidentPlayback(attempt, decision) {
  if (!attempt || typeof attempt !== "object") {
    return decision?.evaluation?.outcome === "alert"
      ? "알림 판정 있음 · 재생 시도 없음"
      : "기록 없음";
  }
  if (attempt.status === "failed") {
    return attempt.error ? `재생 실패 (${attempt.error})` : "재생 실패";
  }
  if (attempt.status === "finished") return "브라우저 재생 종료";
  if (attempt.status === "started") return "브라우저 재생 시작";
  return "재생 요청만 기록";
}

function formatHuntStallIncidentRegion(frame) {
  const region = frame?.region;
  if (!region || typeof region !== "object") return "미기록";
  if (![region.x, region.y, region.width, region.height].every(Number.isFinite)) {
    return "미기록";
  }
  return `${Math.round(region.x)}:${Math.round(region.y)} · ${Math.round(region.width)}x${Math.round(region.height)}`;
}

function formatHuntStallIncidentRuntime(frame) {
  const recognizer = frame?.recognizer;
  if (!recognizer || typeof recognizer !== "object") return "미기록";
  return [
    recognizer.engine,
    recognizer.modelVersion ?? recognizer.modelId,
    recognizer.provider ? `실행: ${formatExecutionProvider(recognizer.provider)}` : null,
  ].filter(Boolean).join(" · ");
}

function formatHuntStallIncidentOmissions(evidence) {
  const reasons = [
    ...(Array.isArray(evidence?.selection?.degradationReasons)
      ? evidence.selection.degradationReasons
      : []),
    ...(Array.isArray(evidence?.omissions)
      ? evidence.omissions.map((entry) => entry?.reason)
      : []),
  ].filter(
    (entry, index, all) =>
      typeof entry === "string" && all.indexOf(entry) === index,
  );
  if (reasons.length === 0) return "없음";
  const labels = {
    "never-produced": "미생성",
    "outside-retention": "보관 범위 밖",
    "reset-epoch": "재시작 경계",
    "metadata-cap": "메타데이터 한도",
    "media-budget": "이미지 총 한도",
    "media-oversize": "이미지 단일 한도",
    "payload-compacted": "전송 크기 조정",
    "asset-persist-failed": "영구 저장 실패",
    "asset-missing": "저장 파일 없음",
    "ambiguous-incident": "사건 모호",
    "legacy-unavailable": "이전 형식",
    "report-time-only": "동결 시점 참고만 있음",
  };
  return reasons.map((reason) => labels[reason] ?? reason).join(" · ");
}

function countHuntStallIncidentMedia(media) {
  return media.reduce(
    (count, entry) =>
      count +
      (typeof entry?.rawDataUrl === "string" && entry.rawDataUrl.startsWith("data:image/") ? 1 : 0) +
      (typeof entry?.processedDataUrl === "string" && entry.processedDataUrl.startsWith("data:image/") ? 1 : 0),
    0,
  );
}

function formatRuneConfirmationPolicy(policy) {
  if (!policy) return null;
  const frames = Number(policy.requiredStableFrames);
  const milliseconds = Number(policy.requiredStableMilliseconds);
  if (!Number.isFinite(frames) || !Number.isFinite(milliseconds)) return null;
  const joiner = policy.mode === "all" ? "그리고" : "또는";
  const version = typeof policy.version === "string" ? ` (${policy.version})` : "";
  return `${frames}회 ${joiner} ${milliseconds}ms${version}`;
}

function formatRuneCascadeGate(debug) {
  if (debug?.detectorKind !== "onnx-cascade") return null;
  const proposalRank = Number.isFinite(debug.selectedProposalRank)
    ? `후보 ${debug.selectedProposalRank}/${debug.proposalCount ?? "?"}`
    : null;
  const shape = Number.isFinite(debug.shapeScore)
    ? `형태 ${formatConfidence(debug.shapeScore)}/${formatConfidence(debug.shapeThreshold)} ${debug.shapePass ? "통과" : "탈락"}`
    : null;
  const appearance = Number.isFinite(debug.appearanceScore)
    ? `외형 ${formatConfidence(debug.appearanceScore)}/${formatConfidence(debug.appearanceThreshold)} ${debug.appearancePass ? "통과" : "탈락"}`
    : null;
  return [proposalRank, shape, appearance].filter(Boolean).join(" · ");
}

function formatRuneIncidentSelection(selection) {
  if (!selection) return null;
  const usesIncidentCandidates = selection.policy === "rune-scenario-incident-v2";
  const status = {
    matched: "최근 사건 일치",
    "current-snapshot": "현재 사건 일치",
    "outside-retention": "보관 기간 밖",
    unavailable: "일치 사건 없음",
  }[selection.status] ?? selection.status;
  const anchor = {
    frame: "프레임",
    episode: "감지 구간",
    attempt: "알림 시도",
  }[selection.anchorKind] ?? "기준 없음";
  const candidates = Number.isFinite(selection.candidateCount)
    ? `${usesIncidentCandidates ? "사건 후보" : "후보 기록"} ${selection.candidateCount}개`
    : null;
  const samples = Number.isFinite(selection.sampleCount)
    ? `런타임 샘플 ${selection.sampleCount}개`
    : null;
  return [
    status,
    anchor,
    candidates,
    samples,
    selection.ambiguous
      ? usesIncidentCandidates
        ? "여러 사건 중 최신"
        : "여러 기록 중 마지막"
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatRuneEvidenceOmission(selection, mediaBudget) {
  const omittedCapacity = Number(mediaBudget?.omittedCapacity ?? 0);
  const omittedOversized = Number(mediaBudget?.omittedOversized ?? 0);
  const degradationReason = {
    "journal-expired-trigger-retained": "사건 기록 만료 · 마지막 알림 원본 보관",
  }[selection?.degradationReason] ?? selection?.degradationReason;
  const omissions = [
    degradationReason ? `사건: ${degradationReason}` : null,
    omittedCapacity > 0 ? `용량 제한 ${omittedCapacity}개` : null,
    omittedOversized > 0 ? `프레임 초과 ${omittedOversized}개` : null,
  ].filter(Boolean);
  return omissions.length > 0 ? omissions.join(" · ") : "없음";
}

function formatRuneAlertAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return null;
  const decisionLabels = {
    initial: "첫 알림",
    repeat: "반복",
  };
  const playbackLabels = {
    requested: "요청",
    started: "시작",
    finished: "종료",
    failed: "실패",
  };
  return attempts
    .slice(-3)
    .map((attempt) => {
      const events = Array.isArray(attempt?.playbackEvents)
        ? attempt.playbackEvents
        : [];
      const status = events[events.length - 1]?.status;
      return `${decisionLabels[attempt?.decision] ?? attempt?.decision ?? "시도"} ${playbackLabels[status] ?? status ?? "재생 기록 없음"}`;
    })
    .join(" · ");
}

function buildBuffExpiryIncidentSlackFields(body, config) {
  const evidence = body?.sample?.buffExpiryEvidence;
  if (evidence?.schemaVersion !== "buff-expiry-incident-evidence-v1") {
    return null;
  }
  const selection = evidence.selection ?? {};
  const frames = Array.isArray(evidence.frames) ? evidence.frames : [];
  const observations = Array.isArray(evidence.observations)
    ? evidence.observations
    : [];
  const episodes = Array.isArray(evidence.episodes) ? evidence.episodes : [];
  const transitions = Array.isArray(evidence.transitions)
    ? evidence.transitions
    : [];
  const cycles = Array.isArray(evidence.cycles) ? evidence.cycles : [];
  const cycleEvents = Array.isArray(evidence.cycleEvents)
    ? evidence.cycleEvents
    : [];
  const attempts = Array.isArray(evidence.attempts) ? evidence.attempts : [];
  const media = Array.isArray(evidence.media) ? evidence.media : [];
  const primaryFrame = selectBuffExpiryIncidentFrame(
    frames,
    selection.selectedEventAt,
  );
  const recognition = primaryFrame?.recognition ?? {};
  const acceptedObservations = observations.filter(
    (entry) => entry?.targetAccepted === true,
  );
  const rejectedObservations = observations.filter(
    (entry) => entry?.targetAccepted !== true,
  );
  const acceptedCountdownCount = acceptedObservations.filter(
    (entry) => entry?.countdown?.decision === "accepted",
  ).length;
  const rejectedCountdownCount = acceptedObservations.filter((entry) =>
    ["missing", "rejected", "implausible"].includes(entry?.countdown?.decision),
  ).length;
  const confirmedEpisodeCount = episodes.filter(
    (entry) => entry?.confirmedAt !== null && entry?.confirmedAt !== undefined,
  ).length;
  const pendingEpisodeCount = episodes.filter(
    (entry) => entry?.status === "pending",
  ).length;
  const reportTime = body?.sample?.next ?? {};

  return [
    slackField(
      "선택 사건",
      formatBuffExpiryIncidentSelection(selection),
    ),
    slackField("사건 시각", formatTimestamp(selection.selectedEventAt)),
    slackField(
      "사건 프레임/이미지",
      `${frames.length}개 / ${media.length}개`,
    ),
    slackField(
      "사건 parser/행 규칙",
      `후보 ${formatNullable(recognition.parserBoxCount)}칸/${formatNullable(recognition.parsedRowCount)}행 · 실제 버프칸 ${formatNullable(recognition.localizedBoxCount ?? recognition.parserBoxCount)}칸/${formatNullable(recognition.localizedRowCount ?? recognition.parsedRowCount)}행 · 외부 제외 ${formatNullable(recognition.spatialExcludedBoxCount ?? 0)} · 상단 제외 ${formatNullable(recognition.upperExcludedBoxCount)} · 통과 ${formatNullable(recognition.eligibleBoxCount)}`,
    ),
    slackField(
      "사건 대상 판정",
      `일치 ${acceptedObservations.length} · 탈락 ${rejectedObservations.length} · ${formatBuffExpiryIncidentDecision(getBuffExpiryIncidentDecisionReason(observations))}`,
    ),
    slackField(
      "사건 숫자 판독",
      `사용 ${acceptedCountdownCount} · 미사용 ${rejectedCountdownCount}`,
    ),
    slackField(
      "사건 추적",
      `구간 ${episodes.length} · 확정 ${confirmedEpisodeCount} · 확인 중 ${pendingEpisodeCount} · 상태 변화 ${transitions.length}`,
    ),
    slackField(
      "사건 예약 흐름",
      formatBuffExpiryIncidentCycles(cycles, cycleEvents),
    ),
    slackField("사건 실제 재생", formatBuffExpiryIncidentPlayback(attempts, cycles)),
    slackField(
      "사건 증거 누락",
      formatBuffExpiryIncidentOmissions(evidence),
    ),
    slackField(
      "사건 runtime parser",
      formatBuffExpiryIncidentParser(primaryFrame?.parser),
    ),
    slackField(
      "사건 실행 오류",
      formatBuffExpiryIncidentRuntimeFailure(primaryFrame?.runtimeFailure),
    ),
    slackField("알림 기준", `${formatNullable(config?.alertLeadSeconds)}초`),
    slackField(
      "제보 전송 시점 참고",
      `버프칸 ${formatNullable(reportTime?.parser?.boxCount)} · 대상 ${Array.isArray(reportTime?.identity?.targetObservations) ? reportTime.identity.targetObservations.length : "미기록"} · 사건 판정과 별도`,
    ),
  ];
}

function selectBuffExpiryIncidentFrame(frames, selectedEventAt) {
  const eventAt = Number(selectedEventAt);
  return [...frames].sort((left, right) => {
    const leftAt = Number(left?.sampledAt ?? 0);
    const rightAt = Number(right?.sampledAt ?? 0);
    if (Number.isFinite(eventAt)) {
      const distance = Math.abs(leftAt - eventAt) - Math.abs(rightAt - eventAt);
      if (distance !== 0) return distance;
    }
    return rightAt - leftAt;
  })[0] ?? null;
}

function formatBuffExpiryIncidentSelection(selection) {
  const statuses = {
    matched: "최근 사건 일치",
    "current-snapshot": "현재 사건 일치",
    "outside-retention": "보관 범위 밖",
    unavailable: "일치 사건 없음",
  };
  const supports = {
    definitive: "판단 가능",
    partial: "일부 증거",
    unsupported: "판단 불가",
  };
  const anchors = {
    frame: "프레임",
    observation: "인식",
    episode: "감지 구간",
    cycle: "알림 주기",
    attempt: "재생 시도",
    event: "런타임 이벤트",
    configuration: "설정",
    state: "상태",
  };
  return [
    statuses[selection?.status] ?? selection?.status ?? "미기록",
    supports[selection?.support] ?? selection?.support ?? "미기록",
    anchors[selection?.anchorKind] ?? "기준 없음",
    formatBuffExpiryIncidentGroup(selection?.affectedGroup),
    selection?.ambiguous ? "여러 후보 중 최신" : null,
  ].filter(Boolean).join(" · ");
}

function formatBuffExpiryIncidentGroup(group) {
  const labels = {
    unionWealth: "유니온의 부",
    unionLuck: "유니온의 행운",
    potion: "비약",
    expCoupon: "경험치 쿠폰",
  };
  return labels[group] ?? group ?? "대상 미선택";
}

function getBuffExpiryIncidentDecisionReason(observations) {
  const reasons = observations
    .map((entry) => entry?.decisionReason)
    .filter((entry) => typeof entry === "string");
  const priority = [
    "cross_bundle_conflict",
    "upper_rows_target_excluded",
    "bottom_first_target_excluded",
    "positive_gate_below_threshold",
    "base_below_threshold",
    "target_accepted",
  ];
  return priority.find((prefix) => reasons.some((reason) => reason.startsWith(prefix)))
    ?? reasons[0]
    ?? null;
}

function formatBuffExpiryIncidentDecision(reason) {
  if (!reason) return "판정 미기록";
  if (reason.startsWith("upper_rows_target_excluded")) return "상단 제외 행";
  if (reason.startsWith("bottom_first_target_excluded")) return "아래 행 우선";
  const labels = {
    target_accepted: "대상 일치",
    base_below_threshold: "1차 분류 미달",
    positive_gate_below_threshold: "형태 검증 미달",
    cross_bundle_conflict: "모델 간 충돌",
  };
  return labels[reason] ?? reason;
}

function formatBuffExpiryIncidentCycles(cycles, cycleEvents) {
  const statuses = [
    ...cycles.map((entry) => entry?.status),
    ...cycleEvents.map((entry) => entry?.status),
  ].filter((entry) => typeof entry === "string");
  if (statuses.length === 0) return "기록 없음";
  const labels = {
    registered: "예약",
    rescheduled: "재예약",
    cancelled: "취소",
    suppressed: "억제",
    fired: "실행",
  };
  return [...new Set(statuses)].map((status) => labels[status] ?? status).join(" · ");
}

function formatBuffExpiryIncidentPlayback(attempts, cycles) {
  const latest = [...attempts].sort(
    (left, right) => Number(right?.requestedAt ?? 0) - Number(left?.requestedAt ?? 0),
  )[0];
  if (latest?.status === "failed") {
    return latest.error ? `재생 실패 (${latest.error})` : "재생 실패";
  }
  if (latest?.status === "started") return "브라우저 재생 시작";
  if (latest?.status === "requested") return "재생 요청만 기록";
  if (cycles.some((entry) => entry?.status === "fired")) {
    return "알림 실행 · 재생 요청 없음";
  }
  if (cycles.some((entry) => entry?.status === "suppressed")) return "알림 억제";
  if (cycles.some((entry) => entry?.status === "cancelled")) return "알림 예약 취소";
  if (cycles.length > 0) return "알림 예약 중";
  return "기록 없음";
}

function formatBuffExpiryIncidentOmissions(evidence) {
  const reasons = [
    ...(Array.isArray(evidence?.selection?.degradationReasons)
      ? evidence.selection.degradationReasons
      : []),
    ...(Array.isArray(evidence?.omissions)
      ? evidence.omissions.map((entry) => entry?.reason)
      : []),
  ].filter((entry, index, all) => typeof entry === "string" && all.indexOf(entry) === index);
  if (reasons.length === 0) return "없음";
  const labels = {
    "never-produced": "미생성",
    "outside-retention": "보관 범위 밖",
    "reset-epoch": "재시작 경계",
    "media-oversize": "이미지 단일 한도",
    "media-budget-exhausted": "이미지 총 한도",
    "metadata-cap": "메타데이터 한도",
    "payload-compacted": "전송 크기 조정",
    "asset-persist-failed": "영구 저장 실패",
    "asset-missing": "저장 파일 없음",
    "ambiguous-target": "대상 모호",
  };
  return reasons.map((reason) => labels[reason] ?? reason).join(" · ");
}

function formatBuffExpiryIncidentParser(parser) {
  if (!parser || typeof parser !== "object") return "미기록";
  return [
    parser.engine || "방식 미기록",
    parser.version || parser.modelVersion || "버전 미기록",
    parser.provider ? `실행: ${formatExecutionProvider(parser.provider)}` : null,
  ].filter(Boolean).join(" · ");
}

function formatBuffExpiryIncidentRuntimeFailure(failure) {
  if (!failure || typeof failure !== "object") return "없음";
  return [failure.stage, failure.code, failure.message]
    .filter(Boolean)
    .join(" · ") || "상세 미기록";
}

function buildSkillIncidentSlackFields(body, config) {
  const evidence = body?.sample?.skillEvidence;
  if (evidence?.schemaVersion !== "skill-incident-evidence-v1") {
    return null;
  }
  const selection = evidence.selection ?? {};
  const frames = Array.isArray(evidence.frames) ? evidence.frames : [];
  const observations = Array.isArray(evidence.observations)
    ? evidence.observations
    : [];
  const cycles = Array.isArray(evidence.cycles) ? evidence.cycles : [];
  const decisions = Array.isArray(evidence.decisions) ? evidence.decisions : [];
  const arbitrations = Array.isArray(evidence.arbitrations)
    ? evidence.arbitrations
    : [];
  const attempts = Array.isArray(evidence.playbackAttempts)
    ? evidence.playbackAttempts
    : [];
  const media = Array.isArray(evidence.media) ? evidence.media : [];
  const configurations = Array.isArray(evidence.configurations)
    ? evidence.configurations
    : [];
  const primaryFrame = selectSkillIncidentFrame(
    frames,
    selection.selectedEventAt,
  );
  const primaryObservation = selectSkillIncidentObservation(
    observations,
    selection.selectedEventAt,
  );
  const reportTime = body?.sample ?? {};

  return [
    slackField("스킬", config?.name || config?.presetId || selection.selectedSkillId),
    slackField("선택 사건", formatSkillIncidentSelection(selection)),
    slackField("사건 시각", formatTimestamp(selection.selectedEventAt)),
    slackField("사건 프레임/이미지", `${frames.length}개 / ${media.length}개`),
    slackField(
      "사건 인식 경로",
      formatSkillIncidentRecognition(selection.mode, primaryObservation),
    ),
    slackField("사건 값 판정", formatSkillIncidentValue(primaryObservation)),
    slackField("사건 흐름", formatSkillIncidentFlow(primaryObservation, cycles)),
    slackField("사건 알림 판정", formatSkillIncidentDecisions(decisions)),
    slackField("중복 대상 조정", formatSkillIncidentArbitration(arbitrations)),
    slackField("사건 브라우저 재생", formatSkillIncidentPlayback(attempts, decisions)),
    slackField("실제 청취", "확인 불가 · OS 출력과 사용자의 청취 여부는 수집하지 않음"),
    slackField("사건 증거 누락", formatSkillIncidentOmissions(evidence)),
    slackField(
      "사건 실행 환경",
      formatSkillIncidentRuntime(primaryFrame, configurations),
    ),
    slackField(
      "제보 전송 시점 참고",
      formatSkillReportTimeContext(reportTime, evidence.reportFrame),
    ),
  ];
}

function selectSkillIncidentFrame(frames, selectedEventAt) {
  const eventAt = Number(selectedEventAt);
  return [...frames].sort((left, right) => {
    const leftAt = Number(left?.sampledAt ?? 0);
    const rightAt = Number(right?.sampledAt ?? 0);
    if (Number.isFinite(eventAt)) {
      const distance = Math.abs(leftAt - eventAt) - Math.abs(rightAt - eventAt);
      if (distance !== 0) return distance;
    }
    return rightAt - leftAt;
  })[0] ?? null;
}

function selectSkillIncidentObservation(observations, selectedEventAt) {
  const accepted = observations.filter(
    (entry) => entry?.recognitionDecision === "accepted",
  );
  return selectSkillIncidentFrame(
    accepted.length > 0 ? accepted : observations,
    selectedEventAt,
  );
}

function formatSkillIncidentSelection(selection) {
  const statuses = {
    matched: "최근 사건 일치",
    "current-snapshot": "현재 사건 일치",
    "outside-retention": "보관 범위 밖",
    unavailable: "일치 사건 없음",
  };
  const supports = {
    definitive: "판단 가능",
    partial: "일부 증거",
    unsupported: "판단 불가",
  };
  const anchors = {
    frame: "프레임",
    observation: "인식",
    cycle: "감지 주기",
    decision: "알림 판정",
    attempt: "재생 시도",
    event: "런타임 이벤트",
    configuration: "설정",
  };
  const modes = {
    "quickslot-countdown": "퀵슬롯",
    "precision-countdown": "정밀 시간",
    "precision-remaining-count": "정밀 횟수",
  };
  return [
    statuses[selection?.status] ?? selection?.status ?? "미기록",
    supports[selection?.support] ?? selection?.support ?? "미기록",
    anchors[selection?.anchorKind] ?? "기준 없음",
    modes[selection?.mode] ?? selection?.mode,
    selection?.ambiguous ? "여러 사건 중 최신" : null,
  ].filter(Boolean).join(" · ");
}

function formatSkillIncidentRecognition(mode, observation) {
  if (!observation) return "사건 인식 기록 없음";
  const parser = observation.parser ?? {};
  const matcher = observation.matcher ?? {};
  if (mode === "quickslot-countdown") {
    return `퀵슬롯 숫자 · ${formatSkillRecognitionDecision(observation.recognitionDecision)}`;
  }
  return [
    `parser ${formatNullable(parser.boxCount)}칸/${formatNullable(parser.rowCount)}행`,
    `행 규칙 통과 ${formatNullable(parser.eligibleBoxCount)}`,
    `matcher ${formatSkillMatcherOutcome(matcher)}`,
  ].join(" · ");
}

function formatSkillRecognitionDecision(value) {
  const labels = {
    accepted: "채택",
    rejected: "거절",
    missing: "판독 없음",
    error: "실행 오류",
  };
  return labels[value] ?? value ?? "미기록";
}

function formatSkillMatcherOutcome(matcher) {
  if (!matcher || typeof matcher !== "object") return "미기록";
  const decision = matcher.accepted === true ? "대상 일치" : "대상 탈락";
  return [decision, matcher.decisionReason, matcher.bundleId].filter(Boolean).join(" · ");
}

function formatSkillIncidentValue(observation) {
  const value = observation?.value;
  if (!value || typeof value !== "object") return "미기록";
  const labels = {
    accepted: "사용",
    missing: "없음",
    rejected: "거절",
    implausible: "흐름 불일치",
  };
  const unit = value.kind === "remaining-count" ? "회" : "초";
  const raw = Number.isFinite(value.rawValue)
    ? `${value.rawValue}${unit}`
    : value.text || "값 없음";
  return [raw, labels[value.decision] ?? value.decision, value.reason]
    .filter(Boolean)
    .join(" · ");
}

function formatSkillIncidentFlow(observation, cycles) {
  const flow = observation?.flow;
  const latestCycle = [...cycles].sort(
    (left, right) => Number(right?.lastEventAt ?? 0) - Number(left?.lastEventAt ?? 0),
  )[0];
  const confirmed = Number.isFinite(flow?.confirmedValue)
    ? `확정 ${flow.confirmedValue}`
    : null;
  const expected = Number.isFinite(flow?.expectedMin) && Number.isFinite(flow?.expectedMax)
    ? `예상 ${flow.expectedMin}~${flow.expectedMax}`
    : null;
  const cycle = latestCycle
    ? `주기 ${latestCycle.status}${latestCycle.terminalReason ? ` (${latestCycle.terminalReason})` : ""}`
    : "주기 없음";
  return [confirmed, expected, flow?.decisionReason, cycle].filter(Boolean).join(" · ");
}

function formatSkillIncidentDecisions(decisions) {
  if (decisions.length === 0) return "판정 기록 없음";
  const labels = {
    requested: "재생 요청",
    "suppressed-duplicate-target": "중복 대상 억제",
    "pending-confirmation": "추가 확인",
    "not-due": "아직 알림 전",
    "already-alerted": "이미 알림",
    reset: "초기화",
    cancelled: "취소",
  };
  return [...new Set(decisions.map((entry) => entry?.outcome).filter(Boolean))]
    .map((outcome) => labels[outcome] ?? outcome)
    .join(" · ");
}

function formatSkillIncidentArbitration(arbitrations) {
  if (arbitrations.length === 0) return "해당 없음";
  return arbitrations
    .slice(-2)
    .map((entry) => {
      const winner = entry?.winnerSkillId ? `선택 ${entry.winnerSkillId}` : "선택 없음";
      const suppressed = Array.isArray(entry?.suppressedSkillIds)
        ? `억제 ${entry.suppressedSkillIds.join(", ") || "없음"}`
        : "억제 미기록";
      return `${winner} · ${suppressed}`;
    })
    .join(" / ");
}

function formatSkillIncidentPlayback(attempts, decisions) {
  const latest = [...attempts].sort(
    (left, right) => Number(right?.requestedAt ?? 0) - Number(left?.requestedAt ?? 0),
  )[0];
  if (!latest) {
    return decisions.some((entry) => entry?.outcome === "requested")
      ? "알림 판정은 재생 요청 · 연결된 재생 시도 없음"
      : "재생 시도 기록 없음";
  }
  if (latest.status === "failed") {
    return latest.error ? `재생 실패 (${latest.error})` : "재생 실패";
  }
  if (latest.status === "finished") {
    return latest.startedMeaning === "browser-play-accepted"
      ? "브라우저 재생 수락 후 종료 · 실제 청취 확인 불가"
      : "이전 형식 재생 종료 기록 · 시작 여부 확인 불가";
  }
  if (latest.status === "started") {
    return latest.startedMeaning === "browser-play-accepted"
      ? "브라우저 play() 수락 · 실제 청취 확인 불가"
      : "이전 형식 재생 요청 기록 · 브라우저 시작 여부 확인 불가";
  }
  return "재생 요청 · 시작/실패 결과 없음";
}

function formatSkillIncidentOmissions(evidence) {
  const reasons = [
    ...(Array.isArray(evidence?.selection?.degradationReasons)
      ? evidence.selection.degradationReasons
      : []),
    ...(Array.isArray(evidence?.omissions)
      ? evidence.omissions.map((entry) => entry?.reason)
      : []),
  ].filter((entry, index, all) => typeof entry === "string" && all.indexOf(entry) === index);
  if (reasons.length === 0) return "없음";
  const labels = {
    "never-produced": "미생성",
    "outside-retention": "보관 범위 밖",
    "reset-epoch": "재시작 경계",
    "metadata-budget": "메타데이터 한도",
    "media-budget": "이미지 총 한도",
    "media-oversize": "이미지 단일 한도",
    "payload-compacted": "전송 크기 조정",
    "asset-persist-failed": "영구 저장 실패",
    "asset-missing": "저장 파일 없음",
    "ambiguous-cycle": "감지 주기 모호",
    "ambiguous-skill": "스킬 모호",
    "legacy-unavailable": "이전 형식",
    "report-time-only": "전송 시점 자료만 있음",
  };
  return reasons.map((reason) => labels[reason] ?? reason).join(" · ");
}

function formatSkillIncidentRuntime(frame, configurations) {
  if (!frame) return "미기록";
  return [
    frame.provider ? `실행: ${formatExecutionProvider(frame.provider)}` : null,
    frame.recognizerVersion ? `인식기: ${frame.recognizerVersion}` : null,
    frame.runtimeFailure
      ? `오류: ${[frame.runtimeFailure.stage, frame.runtimeFailure.code].filter(Boolean).join("/")}`
      : null,
    configurations.length > 0 ? `설정 ${configurations.length}개` : "설정 미기록",
  ].filter(Boolean).join(" · ");
}

function formatSkillReportTimeContext(sample, reportFrame) {
  const buffDuration = sample?.buffDuration ?? {};
  const result = sample?.result ?? {};
  const value = result.value ?? buffDuration?.countdown?.totalSeconds;
  return [
    reportFrame?.sampledAt ? formatTimestamp(reportFrame.sampledAt) : null,
    Number.isFinite(buffDuration?.boxCount) ? `버프칸 ${buffDuration.boxCount}` : null,
    value !== undefined && value !== null ? `판독 ${value}` : null,
    "선택 사건 판정과 별도",
  ].filter(Boolean).join(" · ");
}

function buildBoosterExpiryIncidentSlackFields(body) {
  const evidence = body?.sample?.boosterExpiryEvidence;
  if (evidence?.schemaVersion !== "booster-expiry-incident-evidence-v1") {
    return null;
  }
  const selection = evidence.selection ?? {};
  const frames = Array.isArray(evidence.frames) ? evidence.frames : [];
  const observations = Array.isArray(evidence.observations)
    ? evidence.observations
    : [];
  const candidates = Array.isArray(evidence.candidateAttempts)
    ? evidence.candidateAttempts
    : [];
  const cycles = Array.isArray(evidence.cycles) ? evidence.cycles : [];
  const schedules = Array.isArray(evidence.schedules) ? evidence.schedules : [];
  const decisions = Array.isArray(evidence.decisions) ? evidence.decisions : [];
  const attempts = Array.isArray(evidence.playbackAttempts)
    ? evidence.playbackAttempts
    : [];
  const configurations = Array.isArray(evidence.configurations)
    ? evidence.configurations
    : [];
  const media = Array.isArray(evidence.media) ? evidence.media : [];
  const relatedPlayback = Array.isArray(evidence.relatedPlayback)
    ? evidence.relatedPlayback
    : [];
  const observation = selectIncidentObservationById(observations, selection);
  const frame = selectIncidentFrameById(
    frames,
    observation?.frameId,
    selection,
  );
  const candidate = selectIncidentRecordById(
    candidates,
    selection.candidateAttemptIds,
    "lastObservedAt",
    selection.selectedEventAt,
  );
  const cycle = selectIncidentRecordById(
    cycles,
    selection.cycleIds,
    "confirmedAt",
    selection.selectedEventAt,
  );
  const schedule = selectIncidentRecordById(
    schedules,
    selection.scheduleIds,
    "registeredAt",
    selection.selectedEventAt,
  );
  const decision = selectIncidentRecordById(
    decisions,
    selection.decisionIds,
    "occurredAt",
    selection.selectedEventAt,
  );
  const playback = selectIncidentRecordById(
    attempts,
    selection.playbackAttemptIds,
    "requestedAt",
    selection.selectedEventAt,
  );
  const configuration = selectBoosterExpiryIncidentConfiguration({
    configurations,
    frame,
    cycle,
    decision,
    playback,
    selection,
  });
  const selectedFrameIds = new Set([
    ...(Array.isArray(selection.frameIds) ? selection.frameIds : []),
    ...(Array.isArray(selection.mediaFrameIds) ? selection.mediaFrameIds : []),
  ]);
  const selectedFrameCount = selectedFrameIds.size > 0
    ? frames.filter((entry) => selectedFrameIds.has(entry?.id)).length
    : frames.length;
  const selectedMediaCount = media.filter(
    (entry) =>
      (selectedFrameIds.size === 0 || selectedFrameIds.has(entry?.frameId)) &&
      typeof entry?.imageDataUrl === "string" &&
      entry.imageDataUrl.startsWith("data:image/"),
  ).length;

  return [
    slackField("선택 사건", formatBoosterExpiryIncidentSelection(selection)),
    slackField(
      "저장 결론",
      formatBoosterExpiryIncidentConclusion(selection.operatorConclusion),
    ),
    slackField("사건 시각", formatTimestamp(selection.selectedEventAt)),
    slackField(
      "사건 프레임/이미지",
      `${selectedFrameCount}개 / ${selectedMediaCount}개`,
    ),
    slackField("사건 시간 판독", formatBoosterExpiryIncidentReading(observation)),
    slackField(
      "사건 감소 흐름",
      formatBoosterExpiryIncidentFlow(observation, candidate, cycle),
    ),
    slackField("사건 알림 예약", formatBoosterExpiryIncidentSchedule(schedule, cycle)),
    slackField("사건 알림 판정", formatBoosterExpiryIncidentDecision(decision, schedule)),
    slackField("사건 브라우저 재생", formatBoosterExpiryIncidentPlayback(playback, decision)),
    slackField("실제 청취", "확인 불가 · OS 출력과 사용자의 청취 여부는 수집하지 않음"),
    slackField("사건 설정", formatBoosterExpiryIncidentConfiguration(configuration)),
    slackField("사건 실행 오류", formatBoosterExpiryIncidentRuntimeFailure(frame)),
    slackField("사건 증거 누락", formatBoosterExpiryIncidentOmissions(evidence)),
    slackField(
      "다른 기능 재생",
      relatedPlayback.length > 0 ? `${relatedPlayback.length}개 · 별도 참고` : "없음",
    ),
    slackField(
      "제보 전송 시점 참고",
      evidence.reportFrame === null
        ? "독립 분석 없음 · 선택 사건만 사용"
        : "이전 형식 참고 자료 · 선택 사건과 별도",
    ),
  ];
}

function selectBoosterExpiryIncidentConfiguration({
  configurations,
  frame,
  cycle,
  decision,
  playback,
  selection,
}) {
  const ids = [
    playback?.configRevisionId,
    decision?.firedConfigRevisionId,
    decision?.timingConfigRevisionId,
    cycle?.timingConfigRevisionId,
    frame?.configRevisionId,
    ...(Array.isArray(selection?.configurationRevisionIds)
      ? selection.configurationRevisionIds
      : []),
  ].filter(Boolean);
  for (const id of ids) {
    const match = configurations.find((entry) => entry?.id === id);
    if (match) return match;
  }
  return null;
}

function formatBoosterExpiryIncidentSelection(selection) {
  const statuses = {
    matched: "최근 사건 일치",
    "current-snapshot": "현재 사건 일치",
    "outside-retention": "보관 범위 밖",
    unavailable: "일치 사건 없음",
    "not-applicable": "해당 없음",
  };
  const supports = {
    definitive: "판단 가능",
    partial: "일부 증거",
    unsupported: "판단 불가",
  };
  const anchors = {
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
    statuses[selection?.status] ?? selection?.status,
    supports[selection?.support] ?? selection?.support,
    anchors[selection?.anchorKind] ?? selection?.anchorKind ?? "기준 없음",
    selection?.ambiguous === true ? "사건 후보 모호" : null,
  ].filter(Boolean).join(" · ") || "미기록";
}

function formatBoosterExpiryIncidentConclusion(value) {
  const labels = {
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
  return labels[value] ?? value ?? "미기록";
}

function formatBoosterExpiryIncidentReading(observation) {
  if (!observation) return "선택 관찰 없음";
  const reading = observation.selectedTime ?? observation.rawTime ?? {};
  const value = reading.text ??
    (Number.isFinite(reading.seconds) ? `${reading.seconds}초` : "판독 없음");
  const decisions = {
    accepted: "판독 채택",
    rejected: "판독 거절",
    missing: "타이머 없음",
    error: "판독 오류",
  };
  return [
    decisions[observation.decision] ?? observation.decision ?? "판정 미기록",
    value,
    Number.isFinite(observation.timerCandidateCount)
      ? `후보 ${observation.timerCandidateCount}개`
      : null,
    observation.recognizerVersion,
  ].filter(Boolean).join(" · ");
}

function formatBoosterExpiryIncidentFlow(observation, candidate, cycle) {
  const flow = observation?.flow ?? {};
  return [
    Object.keys(flow).length > 0
      ? [
          flow.locked === true ? "잠금" : "잠금 전",
          flow.source,
          Number.isFinite(flow.predictedSeconds)
            ? `예측 ${flow.predictedSeconds}초`
            : null,
        ].filter(Boolean).join("/")
      : null,
    candidate
      ? `후보 ${candidate.status ?? "상태 미기록"}/${Array.isArray(candidate.observationIds) ? candidate.observationIds.length : 0}회`
      : "후보 없음",
    cycle
      ? `주기 ${cycle.status ?? "상태 미기록"}/${formatTimestamp(cycle.expiresAt)}`
      : "확정 없음",
  ].filter(Boolean).join(" · ");
}

function formatBoosterExpiryIncidentSchedule(schedule, cycle) {
  if (!schedule) return cycle ? "확정 주기 있음 · 예약 없음" : "예약 없음";
  const statuses = {
    registered: "예약됨",
    replaced: "교체됨",
    cancelled: "취소됨",
    suppressed: "억제됨",
    fired: "실행됨",
  };
  return [
    statuses[schedule.status] ?? schedule.status ?? "상태 미기록",
    formatTimestamp(schedule.alertDueAt),
  ].filter(Boolean).join(" · ");
}

function formatBoosterExpiryIncidentDecision(decision, schedule) {
  if (!decision) {
    return schedule?.status === "fired"
      ? "예약 실행됨 · 알림 판정 없음"
      : "알림 판정 없음";
  }
  return [
    "알림 실행",
    formatTimestamp(decision.occurredAt),
    Number.isFinite(decision.schedulerDelayMs)
      ? `지연 ${decision.schedulerDelayMs}ms`
      : null,
  ].filter(Boolean).join(" · ");
}

function formatBoosterExpiryIncidentPlayback(playback, decision) {
  if (!playback) return decision ? "알림 판정 있음 · 재생 시도 없음" : "알림 판정 없음";
  if (playback.status === "failed") {
    return `재생 실패${playback.error ? ` (${playback.error})` : ""}`;
  }
  const labels = {
    requested: "재생 요청만 기록",
    started: "브라우저 재생 수락",
    finished: "브라우저 재생 종료",
  };
  return labels[playback.status] ?? playback.status ?? "상태 미기록";
}

function formatBoosterExpiryIncidentConfiguration(configuration) {
  if (!configuration) return "미기록";
  const values = configuration.values ?? {};
  return [
    Number.isFinite(values.alertLeadSeconds)
      ? `알림 ${values.alertLeadSeconds}초 전`
      : null,
    values.soundId ? `소리 ${values.soundId}` : null,
    Number.isFinite(values.effectiveVolume)
      ? `볼륨 ${Math.round(values.effectiveVolume * 100)}%`
      : null,
  ].filter(Boolean).join(" · ") || "미기록";
}

function formatBoosterExpiryIncidentRuntimeFailure(frame) {
  const failure = frame?.runtimeFailure;
  if (!failure) return "없음";
  return [failure.stage, failure.code, failure.technicalMessage]
    .filter(Boolean)
    .join(" · ") || "상세 미기록";
}

function formatBoosterExpiryIncidentOmissions(evidence) {
  const reasons = [
    ...(Array.isArray(evidence?.selection?.degradationReasons)
      ? evidence.selection.degradationReasons
      : []),
    ...(Array.isArray(evidence?.omissions)
      ? evidence.omissions.map((entry) => entry?.reason)
      : []),
  ].filter(
    (entry, index, all) =>
      typeof entry === "string" && all.indexOf(entry) === index,
  );
  if (reasons.length === 0) return "없음";
  const labels = {
    "never-produced": "미생성",
    "outside-retention": "보관 범위 밖",
    "reset-epoch": "재시작 경계",
    "metadata-cap": "메타데이터 한도",
    "media-budget": "이미지 총 한도",
    "media-oversize": "이미지 단일 한도",
    "payload-compacted": "전송 크기 조정",
    "asset-persist-failed": "영구 저장 실패",
    "asset-missing": "저장 파일 없음",
    "ambiguous-incident": "사건 모호",
  };
  return reasons.map((reason) => labels[reason] ?? reason).join(" · ");
}

function buildSpecialCoreIncidentSlackFields(body) {
  const evidence = body?.sample?.specialCoreEvidence;
  if (evidence?.schemaVersion !== "special-core-incident-evidence-v1") {
    return null;
  }
  const selection = evidence.selection ?? {};
  const frames = Array.isArray(evidence.frames) ? evidence.frames : [];
  const observations = Array.isArray(evidence.observations)
    ? evidence.observations
    : [];
  const confirmations = Array.isArray(evidence.confirmationAttempts)
    ? evidence.confirmationAttempts
    : [];
  const activations = Array.isArray(evidence.activations)
    ? evidence.activations
    : [];
  const schedules = Array.isArray(evidence.schedules) ? evidence.schedules : [];
  const decisions = Array.isArray(evidence.decisions) ? evidence.decisions : [];
  const attempts = Array.isArray(evidence.playbackAttempts)
    ? evidence.playbackAttempts
    : [];
  const configurations = Array.isArray(evidence.configurations)
    ? evidence.configurations
    : [];
  const media = Array.isArray(evidence.media) ? evidence.media : [];
  const relatedPlayback = Array.isArray(evidence.relatedPlayback)
    ? evidence.relatedPlayback
    : [];
  const observation = selectIncidentObservationById(
    observations,
    selection,
  );
  const frame = selectIncidentFrameById(
    frames,
    observation?.frameId,
    selection,
  );
  const confirmation = selectIncidentRecordById(
    confirmations,
    selection.confirmationAttemptIds,
    "lastObservedAt",
    selection.selectedEventAt,
  );
  const activation = selectIncidentRecordById(
    activations,
    selection.activationIds,
    "confirmedAt",
    selection.selectedEventAt,
  );
  const schedule = selectIncidentRecordById(
    schedules,
    selection.scheduleIds,
    "registeredAt",
    selection.selectedEventAt,
  );
  const decision = selectIncidentRecordById(
    decisions,
    selection.decisionIds,
    "occurredAt",
    selection.selectedEventAt,
  );
  const playback = selectIncidentRecordById(
    attempts,
    selection.playbackAttemptIds,
    "requestedAt",
    selection.selectedEventAt,
  );
  const selectedCandidate = selectSpecialCoreIncidentCandidate(observation);
  const matcher = selectedCandidate?.match ?? {};
  const configuration = selectSpecialCoreIncidentConfiguration({
    configurations,
    frame,
    activation,
    decision,
    playback,
    selection,
  });

  return [
    slackField("선택 사건", formatSpecialCoreIncidentSelection(selection)),
    slackField("저장 결론", formatSpecialCoreIncidentConclusion(selection.operatorConclusion)),
    slackField("사건 시각", formatTimestamp(selection.selectedEventAt)),
    slackField(
      "사건 프레임/이미지",
      `${frames.length}개 / ${media.filter((entry) => typeof entry?.imageDataUrl === "string" && entry.imageDataUrl.startsWith("data:image/")).length}개`,
    ),
    slackField("사건 버프칸", formatSpecialCoreIncidentDetection(frame)),
    slackField(
      "사건 matcher 판정",
      formatSpecialCoreIncidentRecognition(observation, matcher),
    ),
    slackField(
      "사건 연속 확인",
      formatSpecialCoreIncidentConfirmation(confirmation, activation),
    ),
    slackField("사건 활성화", formatSpecialCoreIncidentActivation(activation)),
    slackField("사건 알림 예약", formatSpecialCoreIncidentSchedule(schedule)),
    slackField("사건 알림 판정", formatSpecialCoreIncidentDecision(decision, schedule)),
    slackField("사건 브라우저 재생", formatSpecialCoreIncidentPlayback(playback, decision)),
    slackField("실제 청취", "확인 불가 · OS 출력과 사용자의 청취 여부는 수집하지 않음"),
    slackField("사건 설정", formatSpecialCoreIncidentConfiguration(configuration)),
    slackField("사건 실행 환경", formatSpecialCoreIncidentRuntime(frame)),
    slackField("사건 증거 누락", formatSpecialCoreIncidentOmissions(evidence)),
    slackField(
      "다른 기능 재생",
      relatedPlayback.length > 0 ? `${relatedPlayback.length}개 · 별도 참고` : "없음",
    ),
    slackField(
      "제보 전송 시점 참고",
      evidence.reportFrame === null
        ? "독립 분석 없음 · 선택 사건만 사용"
        : "이전 형식 참고 자료 · 선택 사건과 별도",
    ),
  ];
}

function selectSpecialCoreIncidentCandidate(observation) {
  const candidates = Array.isArray(observation?.candidates)
    ? observation.candidates
    : [];
  if (!Number.isFinite(observation?.selectedCandidateBoxIndex)) {
    return candidates[0] ?? null;
  }
  return candidates.find(
    (entry) => entry?.boxIndex === observation.selectedCandidateBoxIndex,
  ) ?? candidates[0] ?? null;
}

function selectSpecialCoreIncidentConfiguration({
  configurations,
  frame,
  activation,
  decision,
  playback,
  selection,
}) {
  const ids = [
    playback?.configRevisionId,
    decision?.firedConfigRevisionId,
    decision?.timingConfigRevisionId,
    activation?.timingConfigRevisionId,
    frame?.configRevisionId,
    ...(Array.isArray(selection?.configurationRevisionIds)
      ? selection.configurationRevisionIds
      : []),
  ].filter(Boolean);
  for (const id of ids) {
    const match = configurations.find((entry) => entry?.id === id);
    if (match) return match;
  }
  return null;
}

function formatSpecialCoreIncidentSelection(selection) {
  const statuses = {
    matched: "최근 사건 일치",
    "current-snapshot": "현재 사건 일치",
    "outside-retention": "보관 범위 밖",
    unavailable: "일치 사건 없음",
    "not-applicable": "해당 없음",
  };
  const supports = {
    definitive: "판단 가능",
    partial: "일부 증거",
    unsupported: "판단 불가",
  };
  const anchors = {
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
    statuses[selection?.status] ?? selection?.status,
    supports[selection?.support] ?? selection?.support,
    anchors[selection?.anchorKind] ?? "기준 없음",
    selection?.ambiguous ? "사건 후보 모호" : null,
  ].filter(Boolean).join(" · ");
}

function formatSpecialCoreIncidentConclusion(value) {
  const labels = {
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
  return labels[value] ?? value ?? "미기록";
}

function formatSpecialCoreIncidentDetection(frame) {
  if (!frame) return "선택 프레임 없음";
  if (frame.runtimeFailure) {
    return [frame.runtimeFailure.stage, frame.runtimeFailure.code]
      .filter(Boolean)
      .join(" · ") || "실행 오류";
  }
  return `${Array.isArray(frame.parsedBoxes) ? frame.parsedBoxes.length : 0}칸 · 후보 ${Array.isArray(frame.eligibleBoxIndexes) ? frame.eligibleBoxIndexes.length : 0}개`;
}

function formatSpecialCoreIncidentRecognition(observation, matcher) {
  if (!observation) return "관찰 기록 없음";
  const decisions = {
    accepted: "후보 채택",
    rejected: "후보 거절",
    missing: "후보 없음",
    error: "실행 오류",
  };
  const score = Number.isFinite(matcher?.score)
    ? `1차 ${formatNullable(matcher.score)}`
    : null;
  const gate = Number.isFinite(matcher?.gateScore)
    ? `형태 ${formatNullable(matcher.gateScore)}`
    : null;
  return [
    decisions[observation.decision] ?? observation.decision ?? "미기록",
    matcher?.decisionReason,
    score,
    gate,
  ].filter(Boolean).join(" · ");
}

function formatSpecialCoreIncidentConfirmation(confirmation, activation) {
  if (activation) {
    return `활성화 확정 · 관찰 ${Array.isArray(activation.observationIds) ? activation.observationIds.length : 0}개`;
  }
  if (!confirmation) return "기록 없음";
  const statuses = {
    collecting: "확인 중",
    confirmed: "확인 완료",
    expired: "확인 시간 만료",
    terminal: "확인 종료",
  };
  return `${statuses[confirmation.status] ?? confirmation.status ?? "미기록"} · 관찰 ${Array.isArray(confirmation.observationIds) ? confirmation.observationIds.length : 0}개`;
}

function formatSpecialCoreIncidentActivation(activation) {
  if (!activation) return "기록 없음";
  return [
    activation.confirmationKind === "cooldown-reacquire"
      ? "쿨타임 중 재감지"
      : "새 활성화",
    formatTimestamp(activation.confirmedAt),
    `종료 ${formatTimestamp(activation.cooldownEndsAt)}`,
  ].filter(Boolean).join(" · ");
}

function formatSpecialCoreIncidentSchedule(schedule) {
  if (!schedule) return "기록 없음";
  const statuses = {
    registered: "예약 중",
    replaced: "예약 교체",
    cancelled: "예약 취소",
    suppressed: "알림 억제",
    fired: "알림 실행",
  };
  return [
    statuses[schedule.status] ?? schedule.status,
    formatTimestamp(schedule.alertDueAt),
    schedule.outcomeReason,
  ].filter(Boolean).join(" · ");
}

function formatSpecialCoreIncidentDecision(decision, schedule) {
  if (decision) {
    return `알림 실행 · ${formatTimestamp(decision.occurredAt)} · 지연 ${formatNullable(decision.schedulerDelayMs)}ms`;
  }
  if (schedule?.status === "fired") return "예약 실행 · 판정 기록 없음";
  return "기록 없음";
}

function formatSpecialCoreIncidentPlayback(playback, decision) {
  if (!playback) {
    return decision ? "알림 판정 있음 · 재생 시도 없음" : "기록 없음";
  }
  if (playback.status === "failed") {
    return playback.error ? `재생 실패 (${playback.error})` : "재생 실패";
  }
  if (playback.status === "finished") return "브라우저 재생 종료 · 실제 청취 확인 불가";
  if (playback.status === "browser-play-accepted") {
    return "브라우저 play() 수락 · 실제 청취 확인 불가";
  }
  return "재생 요청만 기록";
}

function formatSpecialCoreIncidentConfiguration(configuration) {
  const values = configuration?.values ?? {};
  return [
    Number.isFinite(values.cooldownSeconds)
      ? `재사용 ${values.cooldownSeconds}초`
      : null,
    Number.isFinite(values.alertLeadSeconds)
      ? `알림 ${values.alertLeadSeconds}초 전`
      : null,
    values.soundId ? `소리 ${values.soundId}` : null,
    Number.isFinite(values.effectiveVolume)
      ? `최종 볼륨 ${Math.round(values.effectiveVolume * 100)}%`
      : null,
  ].filter(Boolean).join(" · ") || "미기록";
}

function formatSpecialCoreIncidentRuntime(frame) {
  if (!frame) return "미기록";
  const parser = frame.parser ?? {};
  const runtime = parser.runtime ?? {};
  return [
    parser.engine,
    parser.version,
    runtime.executionProvider
      ? `실행: ${formatExecutionProvider(runtime.executionProvider)}`
      : null,
    Number.isFinite(frame.timings?.totalMs)
      ? `전체 ${Math.round(frame.timings.totalMs)}ms`
      : null,
    frame.runtimeFailure
      ? `오류: ${[frame.runtimeFailure.stage, frame.runtimeFailure.code].filter(Boolean).join("/")}`
      : null,
  ].filter(Boolean).join(" · ") || "미기록";
}

function formatSpecialCoreIncidentOmissions(evidence) {
  const reasons = [
    ...(Array.isArray(evidence?.selection?.degradationReasons)
      ? evidence.selection.degradationReasons
      : []),
    ...(Array.isArray(evidence?.omissions)
      ? evidence.omissions.map((entry) => entry?.reason)
      : []),
  ].filter(
    (entry, index, all) =>
      typeof entry === "string" && all.indexOf(entry) === index,
  );
  if (reasons.length === 0) return "없음";
  const labels = {
    "never-produced": "미생성",
    "outside-retention": "보관 범위 밖",
    "reset-epoch": "재시작 경계",
    "metadata-cap": "메타데이터 한도",
    "media-budget": "이미지 총 한도",
    "media-oversize": "이미지 단일 한도",
    "payload-compacted": "전송 크기 조정",
    "asset-persist-failed": "영구 저장 실패",
    "asset-missing": "저장 파일 없음",
    "ambiguous-incident": "사건 모호",
    "legacy-unavailable": "이전 형식",
    "report-time-only": "동결 시점 참고만 있음",
  };
  return reasons.map((reason) => labels[reason] ?? reason).join(" · ");
}

function resolveUltimaRaidEquipmentSelectedFrame({
  selection,
  frames,
  playbacks,
  target = "equipment",
}) {
  const storedSelection = selection.selectedFrameId
    ? frames.find((entry) => entry?.id === selection.selectedFrameId) ?? null
    : frames[frames.length - 1] ?? null;
  const shouldCorrectLegacyWrongTarget =
    target === "equipment" &&
    selection.policy === "ultima-raid-equipment-scenario-selection-v1" &&
    selection.scenario === "wrong-target" &&
    storedSelection?.shouldAlert !== true;
  if (!shouldCorrectLegacyWrongTarget) {
    return storedSelection;
  }

  const playbackFrameIds = new Set(
    playbacks.map((entry) => entry?.frameId).filter(Boolean),
  );
  const reversedFrames = [...frames].reverse();
  return (
    reversedFrames.find(
      (entry) =>
        entry?.shouldAlert === true && playbackFrameIds.has(entry?.id),
    ) ??
    reversedFrames.find((entry) => entry?.shouldAlert === true) ??
    storedSelection
  );
}

function resolveUltimaRaidEquipmentSelectedPlayback({
  selectedFrame,
  playbacks,
  target = "equipment",
  scenario = null,
}) {
  const targetPlaybacks = playbacks.filter(
    (entry) => (entry?.target ?? "equipment") === target,
  );
  if (scenario === "repeat-timing") {
    const repeatPlayback = [...targetPlaybacks]
      .reverse()
      .find(
        (entry) =>
          entry?.kind === "repeat" &&
          (!selectedFrame?.id || entry?.frameId === selectedFrame.id),
      );
    if (repeatPlayback) {
      return repeatPlayback;
    }
  }
  const linkedPlayback = selectedFrame?.id
    ? [...targetPlaybacks]
        .reverse()
        .find((entry) => entry?.frameId === selectedFrame.id)
    : null;
  if (linkedPlayback) {
    return linkedPlayback;
  }

  const hasFrameLink = targetPlaybacks.some((entry) => Boolean(entry?.frameId));
  const shouldAlert =
    target === "boss"
      ? selectedFrame?.bossShouldAlert === true
      : selectedFrame?.shouldAlert === true;
  return shouldAlert && !hasFrameLink
    ? targetPlaybacks[targetPlaybacks.length - 1] ?? null
    : null;
}

function buildDebugSampleSlackFeatureFields({ metadata, body }) {
  const sampleResult = body?.sample?.result ?? {};
  const runeConfig = body?.rune?.config ?? null;
  const runeState = body?.rune?.state ?? null;
  const skillConfig = body?.skill?.config ?? null;
  const skillState = body?.skill?.state ?? null;
  const huntStallConfig = body?.huntStall?.config ?? null;
  const huntStallState = body?.huntStall?.state ?? null;
  const buffExpiryConfig = body?.buffExpiry?.config ?? null;
  const buffExpiryState = body?.buffExpiry?.state ?? null;
  const boosterExpiryConfig = body?.boosterExpiry?.config ?? null;
  const boosterExpiryState = body?.boosterExpiry?.state ?? null;
  const specialCoreConfig = body?.specialCore?.config ?? null;
  const specialCoreState = body?.specialCore?.state ?? null;
  const ultimaRaidEquipmentConfig =
    body?.ultimaRaidEquipment?.config ?? null;
  const ultimaRaidEquipmentState =
    body?.ultimaRaidEquipment?.state ?? null;

  if (ultimaRaidEquipmentConfig || ultimaRaidEquipmentState) {
    const evidence = body?.sample?.ultimaRaidEquipmentEvidence ?? {};
    const selection = evidence.selection ?? {};
    const frames = Array.isArray(evidence.frames)
      ? evidence.frames
      : [];
    const media = Array.isArray(evidence.media)
      ? evidence.media
      : [];
    const playbacks = Array.isArray(evidence.playbackAttempts)
      ? evidence.playbackAttempts
      : [];
    const alertTarget =
      selection.target ??
      body?.ultimaRaidEquipment?.alertTarget ??
      "equipment";
    const isBossAlert = alertTarget === "boss";
    const selectedFrame = resolveUltimaRaidEquipmentSelectedFrame({
      selection,
      frames,
      playbacks,
      target: alertTarget,
    });
    const selectedPlayback = resolveUltimaRaidEquipmentSelectedPlayback({
      selectedFrame,
      playbacks,
      target: alertTarget,
      scenario: selection.scenario,
    });
    const targetConfig = isBossAlert
      ? ultimaRaidEquipmentConfig?.bossAlert
      : ultimaRaidEquipmentConfig;
    const repeatContext = resolveUltimaRaidRepeatContext({
      playbacks,
      target: alertTarget,
      selectedPlayback,
      fallbackConfig: targetConfig,
    });
    if (isBossAlert) {
      return [
        slackField(
          "상태",
          formatStatus(
            ultimaRaidEquipmentState?.boss?.status ?? metadata.status,
          ),
        ),
        slackField(
          "선택 사건",
          selection.support
            ? `${selection.support} · ${selection.scenario ?? "상황 미기록"}`
            : "기록 없음",
        ),
        slackField("최근 감지 프레임", `${frames.length}개`),
        slackField("보관 이미지", `${media.length}개`),
        slackField(
          "하단 진행도",
          selectedFrame?.bossProgressState ??
            sampleResult.bossProgressState ??
            "미기록",
        ),
        slackField(
          "보스 진행 바",
          formatDetectionSignal(
            selectedFrame?.bossBarDetected ??
              sampleResult.bossBarDetected,
          ),
        ),
        slackField(
          "일반 진행 바",
          formatDetectionSignal(
            selectedFrame?.normalProgressBarDetected ??
              sampleResult.normalProgressBarDetected,
          ),
        ),
        slackField(
          "알림 요청",
          selectedFrame?.bossShouldAlert === true ? "있음" : "없음",
        ),
        slackField(
          "실제 재생",
          formatUltimaRaidPlaybackStatus(selectedPlayback),
        ),
        slackField(
          "반복 설정",
          formatUltimaRaidRepeatSetting(repeatContext.config),
        ),
        slackField(
          "반복 재생",
          formatUltimaRaidRepeatPlayback(
            repeatContext.playbacks,
            alertTarget,
            repeatContext.config,
          ),
        ),
        slackField(
          "감지기",
          selectedFrame?.bossDetectorVersion ??
            sampleResult.detectorVersion,
        ),
      ];
    }
    return [
      slackField(
        "상태",
        formatStatus(ultimaRaidEquipmentState?.status ?? metadata.status),
      ),
      slackField(
        "선택 사건",
        selection.support
          ? `${selection.support} · ${selection.scenario ?? "상황 미기록"}`
          : "기록 없음",
      ),
      slackField("최근 감지 프레임", `${frames.length}개`),
      slackField("보관 이미지", `${media.length}개`),
      slackField(
        "가방 숫자 신호",
        formatDetectionSignal(
          selectedFrame?.bagFullDetected ?? sampleResult.bagFullDetected,
        ),
      ),
      slackField(
        "가방 숫자 판독",
        formatUltimaRaidBagCountState(
          selectedFrame?.bagCountState ?? sampleResult.bagCountState,
        ),
      ),
      slackField(
        "숫자 행 위치",
        formatUltimaRaidRelativeBand(
          selectedFrame?.bagCountRowTopRatio ??
            sampleResult.bagCountRowTopRatio,
          selectedFrame?.bagCountRowHeightRatio ??
            sampleResult.bagCountRowHeightRatio,
        ),
      ),
      slackField(
        "색 영역 위치",
        formatUltimaRaidRelativePosition(
          selectedFrame?.largestBagWarmClusterXRatio ??
            sampleResult.largestBagWarmClusterXRatio,
          selectedFrame?.largestBagWarmClusterYRatio ??
            sampleResult.largestBagWarmClusterYRatio,
        ),
      ),
      slackField(
        "상단 안내 신호",
        formatDetectionSignal(
          selectedFrame?.fullBannerDetected ??
            sampleResult.fullBannerDetected,
        ),
      ),
      slackField(
        "판정 방식",
        selectedFrame?.detectionSource ?? sampleResult.detectionSource,
      ),
      slackField(
        "알림 요청",
        selectedFrame?.shouldAlert === true ? "있음" : "없음",
      ),
      slackField(
        "실제 재생",
        formatUltimaRaidPlaybackStatus(selectedPlayback),
      ),
      slackField(
        "반복 설정",
        formatUltimaRaidRepeatSetting(repeatContext.config),
      ),
      slackField(
        "반복 재생",
        formatUltimaRaidRepeatPlayback(
          repeatContext.playbacks,
          alertTarget,
          repeatContext.config,
        ),
      ),
      slackField(
        "감지기",
        selectedFrame?.detectorVersion ?? sampleResult.detectorVersion,
      ),
    ];
  }

  if (runeConfig || runeState) {
    const runeEvidence = body?.sample?.runeEvidence;
    const incidentSelection = runeEvidence?.selection;
    const runtimeFrames = Array.isArray(runeEvidence?.runtimeFrames)
      ? runeEvidence.runtimeFrames
      : [];
    const episodes = Array.isArray(runeEvidence?.episodes)
      ? runeEvidence.episodes
      : [];
    const alertAttempts = Array.isArray(runeEvidence?.alertAttempts)
      ? runeEvidence.alertAttempts
      : [];
    const mediaBudget = runeEvidence?.mediaBudget;
    const detectionError = runeState?.lastDetectionError ?? body?.rune?.lastSnapshot?.detectionError;
    const reportDetectionDebug = body?.rune?.lastSnapshot?.detectionDebug;
    const runtimeIncident =
      body?.rune?.runtimeIncident ?? body?.sample?.runeEvidence?.runtimeIncident;
    const runtimeAssets = body?.diagnostics?.runtimeAssets;
    const runtimeAssetStatus = runtimeAssets?.status;
    const runtimeAssetLabel =
      runtimeAssetStatus === "update-required"
        ? "새 버전 적용 필요"
        : runtimeAssetStatus === "update-available"
          ? "새 버전 준비됨"
          : "현재 버전";
    const playback = runeState?.lastAlertPlayback;
    return [
      slackField(
        "상태",
        runeState?.status === "unavailable" ? "감지 오류" : formatStatus(runeState?.status ?? metadata.status),
      ),
      slackField("런타임 모델", runeState?.detectorVersion),
      slackField("확정 정책", formatRuneConfirmationPolicy(body?.rune?.confirmationPolicy)),
      slackField("선택 사건", formatRuneIncidentSelection(incidentSelection)),
      slackField(
        "선택 런타임 원본",
        runtimeFrames.length > 0 ? `${runtimeFrames.length}개` : null,
      ),
      slackField(
        "선택 구간/알림 시도",
        episodes.length > 0 || alertAttempts.length > 0
          ? `${episodes.length}개 / ${alertAttempts.length}개`
          : null,
      ),
      slackField("시도별 재생", formatRuneAlertAttempts(alertAttempts)),
      slackField("증거 누락", formatRuneEvidenceOmission(incidentSelection, mediaBudget)),
      slackField(
        "고정된 알림 프레임",
        Number.isFinite(body?.rune?.alertTrigger?.frameCount)
          ? `${body.rune.alertTrigger.frameCount}개`
          : null,
      ),
      slackField(
        "고정된 런타임 프레임",
        Number.isFinite(runtimeIncident?.frameCount)
          ? `${runtimeIncident.frameCount}개 · 신호 ${formatNullable(runtimeIncident.signalFrameCount ?? 0)}개`
          : Array.isArray(runtimeIncident?.frames)
            ? `${runtimeIncident.frames.length}개`
            : null,
      ),
      slackField("런타임 신호 시각", formatTimestamp(runtimeIncident?.lastSignalAt)),
      slackField("제보 프레임 게이트", formatRuneCascadeGate(reportDetectionDebug)),
      slackField("연속 감지", `${formatNullable(runeState?.stableCount ?? 0)}회`),
      slackField("후보 수", runeState?.candidateCount ?? sampleResult.candidateCount),
      slackField("감지 오류 단계", detectionError?.phase),
      slackField("감지 오류", detectionError?.message),
      slackField("사이트 버전", runtimeAssetLabel),
      slackField("최근 알림", runeState?.lastAlertedAt ? "있음" : "없음"),
      slackField("실제 재생", formatPlaybackStatus(playback)),
      slackField("재생 요청", formatTimestamp(playback?.requestedAt)),
      slackField("재생 시작", formatTimestamp(playback?.startedAt)),
      slackField("재생 종료", formatTimestamp(playback?.finishedAt)),
      slackField("최종 볼륨", formatConfidence(playback?.effectiveVolume)),
      slackField(
        "장면 주기",
        runeState?.scenePolicyVersion
          ? `${formatNullable(runeState?.sceneEpoch ?? 0)} · ${runeState.scenePolicyVersion}`
          : null,
      ),
      slackField(
        "연속 미감지",
        runeState?.scenePolicyVersion
          ? `${formatNullable(runeState?.consecutiveMissCount ?? 0)}회`
          : null,
      ),
    ];
  }

  if (skillConfig) {
    const incidentFields = buildSkillIncidentSlackFields(body, skillConfig);
    if (incidentFields) {
      return incidentFields;
    }
    const skillDetectionEngine = formatSkillDetectionEngine(skillConfig, body?.sample);
    const skillMatcherDecision = formatSkillMatcherDecision(body?.sample);
    const isRemainingCount = isRemainingCountSkill(skillConfig, body?.sample);
    const skillSamples = body?.skill?.runtimeTimeline?.samples;
    const latestSkillSample = Array.isArray(skillSamples)
      ? skillSamples[skillSamples.length - 1]
      : null;
    const expectedCountRange = formatCountRange(
      latestSkillSample?.remainingCountExpectedMin,
      latestSkillSample?.remainingCountExpectedMax,
    );
    const fields = [
      slackField("스킬", skillConfig.name || skillConfig.presetId || "알 수 없음"),
      slackField("감지 방식", formatSkillDetectionSource(skillConfig)),
      slackField("스킬 상세", formatSkillPreset(skillConfig)),
      slackField("상태", formatStatus(metadata.status)),
      slackField(
        "알림 기준",
        isRemainingCount
          ? formatCount(skillConfig.alertThresholdSeconds)
          : `${formatNullable(skillConfig.alertThresholdSeconds)}초`,
      ),
      slackField(
        isRemainingCount ? "원시 횟수" : "현재 OCR",
        isRemainingCount ? formatCount(sampleResult.value) : sampleResult.value,
      ),
      slackField(
        isRemainingCount ? "확정 횟수" : "추정 남은 시간",
        isRemainingCount
          ? formatCount(skillState?.observedRemainingCount)
          : formatSeconds(sampleResult.estimatedRemainingSeconds),
      ),
      slackField(
        isRemainingCount ? "흐름 판정" : "예상 알림까지",
        isRemainingCount
          ? formatRemainingCountFlowDecision(latestSkillSample?.remainingCountDecision)
          : formatSeconds(sampleResult.alertInSeconds),
      ),
      slackField("도달 가능 범위", isRemainingCount ? expectedCountRange : null),
      slackField("최근 알림", skillState?.alertedAt ? "있음" : "없음"),
      slackField(
        "보류 후보",
        skillState?.pendingShortAnchor ||
          skillState?.pendingRemainingCountIncrease ||
          skillState?.pendingRemainingCountDrop ||
          skillState?.pendingRemainingCountAlert
          ? "있음"
          : "없음",
      ),
    ];
    if (skillConfig.detectionSource === "buff-duration") {
      fields.push(slackField("runtime parser", formatRuntimeParser(body?.sample)));
    }
    const skillEvents = body?.skill?.runtimeTimeline?.alertEvents;
    const latestSkillPlayback = Array.isArray(skillEvents)
      ? skillEvents[skillEvents.length - 1]
      : null;
    fields.push(slackField("실제 재생", formatPlaybackStatus(latestSkillPlayback)));
    if (skillDetectionEngine) {
      fields.splice(3, 0, slackField("감지 엔진", skillDetectionEngine));
    }
    if (skillMatcherDecision) {
      fields.splice(skillDetectionEngine ? 4 : 3, 0, slackField("matcher 판정", skillMatcherDecision));
    }
    const skillSettings = formatSkillReportSettings(skillConfig);
    if (skillSettings) {
      fields.push(slackField("스킬 설정", skillSettings));
    }
    const classInstallSettings = formatSkillClassInstallSettings(skillConfig);
    if (classInstallSettings) {
      fields.push(slackField("설치기 설정", classInstallSettings));
    }
    return fields;
  }

  if (huntStallConfig) {
    const incidentFields = buildHuntStallIncidentSlackFields(
      body,
      huntStallConfig,
    );
    if (incidentFields) {
      return incidentFields;
    }
    const mode = huntStallConfig.mode ?? "experience";
    const isCooldownPresenceMode = mode === "cooldown-presence";
    const thresholdSeconds = isCooldownPresenceMode
      ? huntStallConfig.cooldownMissingThresholdSeconds
      : huntStallConfig.stallThresholdSeconds;
    const observed = isCooldownPresenceMode
      ? huntStallState?.hasObservedCooldownPresence
      : huntStallState?.hasObservedExperienceChange;
    return [
      slackField("모드", formatHuntStallMode(mode)),
      slackField("상태", formatStatus(metadata.status)),
      slackField("알림 기준", `${formatNullable(thresholdSeconds)}초`),
      slackField(isCooldownPresenceMode ? "쿨타임 판독값" : "경험치 판독값", sampleResult.value),
      slackField("변화 없음", formatSeconds(huntStallState?.unchangedSeconds)),
      slackField(isCooldownPresenceMode ? "쿨타임 시작 감지" : "사냥 시작 감지", observed ? "있음" : "없음"),
      slackField("반복", formatHuntStallRepeat(huntStallConfig, huntStallState)),
      slackField("실제 재생", formatPlaybackStatus(huntStallState?.lastAlertPlayback)),
    ];
  }

  if (buffExpiryConfig) {
    const incidentFields = buildBuffExpiryIncidentSlackFields(
      body,
      buffExpiryConfig,
    );
    if (incidentFields) {
      return incidentFields;
    }
    const lastSnapshot = body?.buffExpiry?.lastSnapshot ?? null;
    const performance = sampleResult.performance ?? lastSnapshot?.performance ?? null;
    const summary = body?.buffExpiry?.summary ?? {};
    const next = body?.sample?.next ?? {};
    const alertEvidence = summary.lastAlertEvidence ?? lastSnapshot?.lastAlertEvidence ?? null;
    return [
      slackField("상태", formatBuffExpiryStatus(buffExpiryState?.status ?? metadata.status)),
      slackField("알림 기준", `${formatNullable(buffExpiryConfig.alertLeadSeconds)}초`),
      slackField("감지 버프칸", summary.snapshotDisplayBoxCount ?? next.parser?.displayBoxCount ?? sampleResult.candidateCount),
      slackField("대상 후보", summary.targetObservationCount ?? next.identity?.targetObservations?.length ?? 0),
      slackField("숫자 판독", summary.countdownObservationCount ?? next.countdown?.recognizedCount ?? 0),
      slackField(
        "추적/확인",
        `${formatNullable(summary.trackCount ?? buffExpiryState?.tracks?.length ?? 0)}개 / ${formatNullable(
          summary.pendingTrackCount ?? buffExpiryState?.pendingTracks?.length ?? 0,
        )}개`,
      ),
      slackField("최근 알림", alertEvidence ? `${formatNullable(alertEvidence.triggeredTrackCount)}개` : "없음"),
      slackField("ROI 보관", `${formatNullable(summary.recentRoiFrameCount ?? next.replay?.frameCount ?? 0)}개`),
      slackField("처리 시간", performance?.totalMs !== undefined ? `${formatNullable(performance.totalMs)}ms` : "없음"),
      slackField("runtime parser", formatRuntimeParser(body?.sample)),
      slackField("실제 재생", formatPlaybackStatus(buffExpiryState?.lastAlertPlayback)),
    ];
  }

  if (boosterExpiryConfig) {
    const incidentFields = buildBoosterExpiryIncidentSlackFields(body);
    if (incidentFields) {
      return incidentFields;
    }
    const lastSnapshot = body?.boosterExpiry?.lastSnapshot ?? null;
    const performance = sampleResult.performance ?? lastSnapshot?.performance ?? null;
    return [
      slackField("상태", formatStatus(boosterExpiryState?.status ?? metadata.status)),
      slackField("알림 기준", `${formatNullable(boosterExpiryConfig.alertLeadSeconds)}초`),
      slackField("감지값", sampleResult.value),
      slackField("원본 감지값", boosterExpiryState?.rawText),
      slackField("남은 시간", formatSeconds(boosterExpiryState?.remainingSeconds)),
      slackField("확정 종료", formatTimestamp(boosterExpiryState?.confirmedExpiresAt)),
      slackField("흐름", lastSnapshot?.flowSource),
      slackField("타이머 증거", `${formatNullable(lastSnapshot?.timerEvidenceCount)}개`),
      slackField("처리 시간", performance?.totalMs !== undefined ? `${formatNullable(performance.totalMs)}ms` : "없음"),
    ];
  }

  if (specialCoreConfig) {
    const incidentFields = buildSpecialCoreIncidentSlackFields(body);
    if (incidentFields) {
      return incidentFields;
    }
    const specialCoreSample = body?.sample?.specialCore ?? {};
    const specialCoreDebug = sampleResult.debug ?? {};
    const bestMatch = Array.isArray(specialCoreSample.candidateIcons)
      ? specialCoreSample.candidateIcons[0]?.match ?? {}
      : {};
    const performance = sampleResult.performance ?? specialCoreSample.performance ?? null;
    const playbackEvents = body?.specialCore?.timeline?.playbackEvents;
    const latestPlayback = Array.isArray(playbackEvents)
      ? playbackEvents[playbackEvents.length - 1]
      : specialCoreState?.lastAlertPlayback;
    return [
      slackField("상태", formatStatus(specialCoreState?.status ?? metadata.status)),
      slackField("재사용 대기시간", formatSeconds(specialCoreConfig.cooldownSeconds)),
      slackField("알림 기준", `${formatNullable(specialCoreConfig.alertLeadSeconds)}초 전`),
      slackField("감지 버프칸", specialCoreState?.boxCount ?? metadata.candidateCount),
      slackField("후보 수", sampleResult.candidateCount),
      slackField("matcher 판정", formatSpecialCoreMatcherDecision(body?.sample)),
      slackField("matcher 번들", specialCoreDebug.bundleId ?? bestMatch.bundleId),
      slackField("matcher 모델", specialCoreDebug.modelVersion ?? bestMatch.modelVersion),
      slackField(
        "1차 / 형태 점수",
        `${formatNullable(specialCoreDebug.bestScore ?? bestMatch.score)} / ${formatNullable(
          specialCoreDebug.bestGateScore ?? bestMatch.gateScore,
        )}`,
      ),
      slackField("확정 감지", formatTimestamp(specialCoreState?.activationConfirmedAt)),
      slackField("쿨타임 종료", formatTimestamp(specialCoreState?.cooldownEndsAt)),
      slackField("예상 알림", formatTimestamp(specialCoreState?.alertDueAt)),
      slackField("최근 알림", specialCoreState?.lastAlertedAt ? "있음" : "없음"),
      slackField("실제 재생", formatPlaybackStatus(latestPlayback)),
      slackField("runtime parser", formatRuntimeParser(body?.sample)),
      slackField("처리 시간", performance?.totalMs !== undefined ? `${formatNullable(performance.totalMs)}ms` : "없음"),
    ];
  }

  return [
    slackField("상태", formatStatus(metadata.status)),
    slackField("현재 OCR 값", metadata.value),
  ];
}

export function buildDebugSampleSlackNotificationPayload({ id, key, metadata, body, requestUrl }) {
  const { sampleUrl, sampleViewerUrl, troubleshooterUrl } = buildDebugSampleLinks(requestUrl, id);
  const capture = body?.diagnostics?.capture ?? {};
  const issueNote = body?.reportIssue?.note ? truncate(body.reportIssue.note, 240) : null;
  const kindLabel = REPORT_KIND_LABELS[metadata.kind] ?? metadata.kind;
  const issueLabel = metadata.issueLabel ?? metadata.issueReason ?? "없음";
  const commonFields = [
    slackField("ID", id),
    slackField("유형", kindLabel),
    slackField("사유", issueLabel),
    slackField("세부 상황", metadata.issueScenarioLabel ?? metadata.issueScenario ?? "기록 없음"),
    ...(metadata.issueOtherCategoryLabel || metadata.issueOtherCategory
      ? [
          slackField(
            "기타 분류",
            metadata.issueOtherCategoryLabel ?? metadata.issueOtherCategory,
          ),
        ]
      : []),
    slackField("발생 시점", formatIssueOccurrence(metadata.issueOccurrence)),
    slackField("대상", metadata.affectedTarget?.label ?? "기록 없음"),
    slackField("증거 결합", formatIncidentEvidence(body?.incident)),
    slackField("버전", formatAppBuild(body?.appBuild)),
    slackField("주소", body?.url || "알 수 없음"),
    slackField("화면 공유", capture.hasStream ? "있음" : "없음"),
  ];

  if (capture.size?.width && capture.size?.height) {
    commonFields.push(slackField("캡처", `${capture.size.width}x${capture.size.height}`));
  }
  const frameSourceLabel = formatReportFrameSource(capture.frameSource);
  if (frameSourceLabel) {
    commonFields.push(slackField("분석 기준", frameSourceLabel));
  }
  const gameViewportLabel = formatReportGameViewport(
    capture.frameSource?.gameViewport,
  );
  if (gameViewportLabel) {
    commonFields.push(slackField("게임 영역", gameViewportLabel));
  }

  const featureFields = buildDebugSampleSlackFeatureFields({ metadata, body });
  const sampleResult = body?.sample?.result ?? {};
  const diagnosticsFields = [
    slackField("신뢰도", formatConfidence(metadata.confidence)),
    slackField("후보 수", metadata.candidateCount),
  ];
  const runtimeFailure = formatRuntimeAnalysisFailure(body);
  if (runtimeFailure) {
    diagnosticsFields.push(slackField("분석 실행 오류", runtimeFailure));
  }

  if (body?.kind === "buff-expiry-issue") {
    diagnosticsFields.push(
      slackField("그룹", summarizeBuffExpiryPrecisionGroups(body?.buffExpiry?.summary?.groupSummary)),
      slackField("모듈", summarizeBuffExpiryPrecisionModules(body?.buffExpiry?.summary?.moduleVersions)),
    );
  } else if (sampleResult.performance?.totalMs !== undefined) {
    diagnosticsFields.push(slackField("처리 시간", `${formatNullable(sampleResult.performance.totalMs)}ms`));
  }

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "새 Maple Timer 감지 제보",
      },
    },
  ];
  pushSlackFieldSections(blocks, commonFields);
  blocks.push({ type: "divider" });
  pushSlackFieldSections(blocks, featureFields);
  blocks.push({ type: "divider" });
  pushSlackFieldSections(blocks, diagnosticsFields);
  if (issueNote) {
    pushSlackTextSection(blocks, `*메모*\n${issueNote}`);
  }
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "샘플 조회" },
        url: sampleViewerUrl,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "트러블슈팅" },
        url: troubleshooterUrl,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "원본 JSON" },
        url: sampleUrl,
      },
    ],
  });
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: escapeSlackMrkdwn(`샘플 ID: ${id} · KV Key: ${key}`),
      },
    ],
  });

  return {
    text: truncate(`${kindLabel}: ${issueLabel} (${formatAppBuild(body?.appBuild)})`, MAX_NOTIFICATION_LENGTH),
    attachments: [
      {
        color: getReportSlackColor(metadata.kind),
        fallback: truncate(`${kindLabel}: ${issueLabel}`, MAX_NOTIFICATION_LENGTH),
        blocks,
      },
    ],
    unfurl_links: false,
    unfurl_media: false,
  };
}

function formatReportFrameSource(frameSource) {
  const coordinateSpace = frameSource?.coordinateSpace;
  if (!coordinateSpace) return null;
  const label =
    coordinateSpace === "game-viewport"
      ? "설정한 게임 영역"
      : coordinateSpace === "capture"
        ? "전체 공유 화면"
        : String(coordinateSpace);
  return frameSource.layoutKey
    ? `${label} · ${frameSource.layoutKey}`
    : label;
}

function formatReportGameViewport(gameViewport) {
  if (!gameViewport?.state) return null;
  const verificationLabel =
    gameViewport.verification === "known-capture"
      ? "알려진 화면 자동 확인"
      : gameViewport.verification === "user-confirmed"
        ? "전체 화면 사용자 확인"
        : gameViewport.verification === "calibrated"
          ? "게임 영역 사용자 설정"
          : gameViewport.verification === "unverified"
            ? "게임 화면 미확인"
            : gameViewport.verification === "stale"
              ? "다시 설정 필요"
              : gameViewport.verification === "unavailable"
                ? "사용 불가"
                : null;
  const stateLabel =
    verificationLabel ??
    (gameViewport.state === "calibrated"
      ? "보정됨"
      : gameViewport.state === "stale"
        ? "다시 설정 필요"
        : gameViewport.state === "legacy-passthrough"
          ? "기존 전체 화면"
          : String(gameViewport.state));
  const resolution =
    Number.isFinite(gameViewport.gameResolution?.width) &&
    Number.isFinite(gameViewport.gameResolution?.height)
      ? `${gameViewport.gameResolution.width}x${gameViewport.gameResolution.height}`
      : null;
  const region =
    Number.isFinite(gameViewport.region?.x) &&
    Number.isFinite(gameViewport.region?.y) &&
    Number.isFinite(gameViewport.region?.width) &&
    Number.isFinite(gameViewport.region?.height)
      ? `(${gameViewport.region.x}, ${gameViewport.region.y}) ${gameViewport.region.width}x${gameViewport.region.height}`
      : null;
  const revision = Number.isFinite(gameViewport.revision)
    ? `r${gameViewport.revision}`
    : null;
  return [stateLabel, resolution, region, revision].filter(Boolean).join(" · ");
}
