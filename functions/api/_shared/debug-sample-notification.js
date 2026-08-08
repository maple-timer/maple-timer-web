import {
  formatAppBuild,
  formatBuffExpiryStatus,
  formatConfidence,
  formatCount,
  formatCountRange,
  formatNullable,
  formatRemainingCountFlowDecision,
  formatSeconds,
  formatSkillClassInstallSettings,
  formatSkillDetectionEngine,
  formatSkillDetectionSource,
  formatSkillMatcherDecision,
  formatSkillPreset,
  formatSkillReportSettings,
  formatStatus,
  formatVolume,
  isRemainingCountSkill,
  MAX_NOTIFICATION_LENGTH,
  REPORT_KIND_LABELS,
  summarizeBuffExpiryPrecisionModules,
  truncate,
} from "./debug-sample-format.js";
import { buildDebugSampleLinks } from "./debug-sample-links.js";
import { buildDebugSampleSlackNotificationPayload } from "./debug-sample-slack.js";

export { buildDebugSampleLinks } from "./debug-sample-links.js";
export { REPORT_KIND_LABELS, truncate } from "./debug-sample-format.js";
export { buildDebugSampleSlackNotificationPayload } from "./debug-sample-slack.js";

function formatRuntimeParser(sample) {
  const parser = sample?.parser;
  if (!parser || typeof parser !== "object") {
    return null;
  }
  const provider = parser.runtime?.executionProvider;
  const summary = [
    parser.engine || "미기록",
    parser.version || "버전 없음",
    provider ? `실행: ${formatExecutionProvider(provider)}` : null,
  ].filter(Boolean).join(" · ");
  const fallbackSummary = parser.fallbackReason
    ? `${summary} · fallback: ${parser.fallbackReason}`
    : summary;
  const failure = parser.failure;
  if (!failure || typeof failure !== "object") {
    return fallbackSummary;
  }
  const diagnostic = failure.diagnostic ?? {};
  const failureSummary = [
    formatParserFailureReason(failure.reason),
    formatParserFailureStage(diagnostic.stage),
    diagnostic.code || null,
  ].filter(Boolean).join(" · ");
  const technicalMessage = failure.technicalMessage || diagnostic.technicalMessage;
  return [
    fallbackSummary,
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
  if (playback?.status === "failed") {
    return playback.error ? `재생 실패 (${playback.error})` : "재생 실패";
  }
  if (
    playback?.effectiveVolume !== null &&
    playback?.effectiveVolume !== undefined &&
    Number(playback.effectiveVolume) === 0
  ) {
    return "무음 설정";
  }
  if (playback?.status === "finished") return "브라우저 재생 종료";
  if (playback?.status === "started") return "브라우저 재생 시작";
  if (playback?.status === "requested") return "재생 요청만 기록";
  return "기록 없음";
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
    formatIncidentEvidenceSource(evidence.source),
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

function formatIncidentEvidenceSource(value) {
  if (value === "runtime-atomic") return "제보 후 첫 런타임 샘플";
  if (value === "runtime-snapshot") return "실제 런타임 스냅샷";
  if (value === "report-capture") return "제보 시점 재캡처";
  if (value === "mixed") return "런타임·제보 시점 혼합";
  return value || "출처 미기록";
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

export function buildDebugSampleNotificationContent({ id, key, metadata, body, requestUrl }) {
  const { sampleUrl, sampleViewerUrl } = buildDebugSampleLinks(requestUrl, id);
  const capture = body?.diagnostics?.capture ?? {};
  const issueNote = body?.reportIssue?.note ? truncate(body.reportIssue.note, 240) : null;
  const skillConfig = body?.skill?.config ?? null;
  const isSkillRemainingCount = isRemainingCountSkill(skillConfig, body?.sample);
  const huntStallConfig = body?.huntStall?.config ?? null;
  const buffExpiryConfig = body?.buffExpiry?.config ?? null;
  const boosterExpiryConfig = body?.boosterExpiry?.config ?? null;
  const specialCoreConfig = body?.specialCore?.config ?? null;
  const lines = [
    "새 Maple Timer 감지 제보",
    `ID: ${id}`,
    `유형: ${REPORT_KIND_LABELS[metadata.kind] ?? metadata.kind}`,
    `사유: ${metadata.issueLabel ?? metadata.issueReason ?? "없음"}`,
    `세부 상황: ${metadata.issueScenarioLabel ?? metadata.issueScenario ?? "기록 없음"}`,
    ...(metadata.issueOtherCategoryLabel || metadata.issueOtherCategory
      ? [
          `기타 분류: ${metadata.issueOtherCategoryLabel ?? metadata.issueOtherCategory}`,
        ]
      : []),
    `발생 시점: ${formatIssueOccurrence(metadata.issueOccurrence)}`,
    `대상: ${metadata.affectedTarget?.label ?? "기록 없음"}`,
    `증거 결합: ${formatIncidentEvidence(body?.incident)}`,
    `버전: ${formatAppBuild(body?.appBuild)}`,
    `주소: ${body?.url || "알 수 없음"}`,
    `화면 공유: ${capture.hasStream ? "있음" : "없음"}`,
  ];

  if (capture.size?.width && capture.size?.height) {
    lines.push(`캡처 크기: ${capture.size.width}x${capture.size.height}`);
  }
  const frameSourceLabel = formatReportFrameSource(capture.frameSource);
  if (frameSourceLabel) {
    lines.push(`분석 기준: ${frameSourceLabel}`);
  }
  const gameViewportLabel = formatReportGameViewport(
    capture.frameSource?.gameViewport,
  );
  if (gameViewportLabel) {
    lines.push(`게임 영역: ${gameViewportLabel}`);
  }
  const runtimeParser = formatRuntimeParser(body?.sample);
  if (runtimeParser) {
    lines.push(`runtime parser: ${runtimeParser}`);
  }
  const runtimeFailure = formatRuntimeAnalysisFailure(body);
  if (runtimeFailure) {
    lines.push(`분석 실행 오류: ${runtimeFailure}`);
  }

  if (skillConfig) {
    const skillDetectionEngine = formatSkillDetectionEngine(skillConfig, body?.sample);
    const skillMatcherDecision = formatSkillMatcherDecision(body?.sample);
    lines.push(
      `스킬: ${skillConfig.name || skillConfig.presetId || "알 수 없음"}`,
      `감지 방식: ${formatSkillDetectionSource(skillConfig)}`,
      `스킬 상세: ${formatSkillPreset(skillConfig)}`,
      `알림 기준: ${isSkillRemainingCount ? formatCount(skillConfig.alertThresholdSeconds) : `${formatNullable(skillConfig.alertThresholdSeconds)}초`}`,
      `알람음: ${formatNullable(skillConfig.soundId)}`,
      `볼륨: ${formatVolume(skillConfig.volume)}`,
    );
    if (skillDetectionEngine) {
      lines.push(`감지 엔진: ${skillDetectionEngine}`);
    }
    if (skillMatcherDecision) {
      lines.push(`matcher 판정: ${skillMatcherDecision}`);
    }
  }

  const sampleResult = body?.sample?.result ?? {};
  const skillState = body?.skill?.state ?? null;
  const huntStallState = body?.huntStall?.state ?? null;
  const buffExpiryState = body?.buffExpiry?.state ?? null;
  const boosterExpiryState = body?.boosterExpiry?.state ?? null;

  if (skillConfig) {
    const rejectedReading = skillState?.rejectedReading;
    const currentOcrValue = sampleResult.value;
    const timelineSamples = Array.isArray(body?.skill?.runtimeTimeline?.samples)
      ? body.skill.runtimeTimeline.samples
      : [];
    const latestSkillSample = timelineSamples[timelineSamples.length - 1] ?? null;
    const expectedCountRange = formatCountRange(
      latestSkillSample?.remainingCountExpectedMin,
      latestSkillSample?.remainingCountExpectedMax,
    );
    const isCurrentRejected =
      rejectedReading !== null &&
      rejectedReading !== undefined &&
      currentOcrValue !== null &&
      currentOcrValue !== undefined &&
      Number(rejectedReading) === Number(currentOcrValue);

    lines.push(
      `상태: ${formatStatus(metadata.status)}`,
      isSkillRemainingCount
        ? `원시 횟수: ${formatCount(currentOcrValue)}${isCurrentRejected ? " (반영 안 됨)" : ""}`
        : `현재 추정 남은 시간: ${formatSeconds(sampleResult.estimatedRemainingSeconds)}`,
      isSkillRemainingCount
        ? `확정 횟수: ${formatCount(skillState?.observedRemainingCount)}`
        : `현재 OCR 값: ${formatNullable(currentOcrValue)}${isCurrentRejected ? " (반영 안 됨)" : ""}`,
      isSkillRemainingCount
        ? `흐름 판정: ${formatRemainingCountFlowDecision(latestSkillSample?.remainingCountDecision)}`
        : `예상 알림까지: ${formatSeconds(sampleResult.alertInSeconds)}`,
      ...(isSkillRemainingCount ? [`도달 가능 범위: ${expectedCountRange}`] : []),
      `최근 알림: ${skillState?.alertedAt ? "있음" : "없음"}`,
      `보류 후보: ${
        skillState?.pendingShortAnchor ||
        skillState?.pendingRemainingCountIncrease ||
        skillState?.pendingRemainingCountDrop ||
        skillState?.pendingRemainingCountAlert
          ? "있음"
          : "없음"
      }`,
    );

    const skillSettings = formatSkillReportSettings(skillConfig);
    if (skillSettings) {
      lines.push(`스킬 설정: ${skillSettings}`);
    }

    const classInstallSettings = formatSkillClassInstallSettings(skillConfig);
    if (classInstallSettings) {
      lines.push(`설치기 설정: ${classInstallSettings}`);
    }

    if (
      skillState?.observedRemainingSeconds !== null &&
      skillState?.observedRemainingSeconds !== undefined &&
      Number(skillState.observedRemainingSeconds) !== Number(sampleResult.estimatedRemainingSeconds)
    ) {
      lines.push(`타이머 시작 반영값: ${formatSeconds(skillState.observedRemainingSeconds)}`);
    }

    if (rejectedReading !== null && rejectedReading !== undefined) {
      lines.push(`거부값: ${formatNullable(rejectedReading)}`);
    }

    const runtimeTimeline = body?.skill?.runtimeTimeline ?? null;
    const alertEvents = Array.isArray(runtimeTimeline?.alertEvents)
      ? runtimeTimeline.alertEvents
      : [];
    if (timelineSamples.length > 0) {
      lines.push(`최근 판독 기록: ${timelineSamples.length}개`);
    }
    if (alertEvents.length > 0) {
      const latestEvent = alertEvents[alertEvents.length - 1] ?? {};
      const eventLabel =
        latestEvent.status === "finished"
          ? "재생 완료"
          : latestEvent.status === "failed"
            ? "재생 실패"
            : "재생 시작";
      lines.push(`최근 알림 재생: ${eventLabel}`);
    }

    const relatedActiveSkills = Array.isArray(body?.skill?.relatedActiveSkills)
      ? body.skill.relatedActiveSkills
      : [];
    if (relatedActiveSkills.length > 1) {
      const labels = relatedActiveSkills
        .map((item) => item?.presetId || item?.name)
        .filter(Boolean)
        .slice(0, 4)
        .join(", ");
      lines.push(`동일 이름 활성 행: ${relatedActiveSkills.length}개${labels ? ` (${labels})` : ""}`);
    }
  } else if (huntStallConfig) {
    const huntStallMode = huntStallConfig.mode ?? "experience";
    const isCooldownPresenceMode = huntStallMode === "cooldown-presence";
    const huntStallThresholdSeconds = isCooldownPresenceMode
      ? huntStallConfig.cooldownMissingThresholdSeconds
      : huntStallConfig.stallThresholdSeconds;
    const huntStallReadingLabel = isCooldownPresenceMode ? "쿨타임 판독값" : "경험치 판독값";
    const huntStallObservedLabel = isCooldownPresenceMode ? "쿨타임 시작 감지" : "사냥 시작 감지";
    const hasObservedHuntStallActivity = isCooldownPresenceMode
      ? huntStallState?.hasObservedCooldownPresence
      : huntStallState?.hasObservedExperienceChange;
    lines.push(
      `알림 기준: ${formatNullable(huntStallThresholdSeconds)}초`,
      `알람음: ${formatNullable(huntStallConfig.soundId)}`,
      `볼륨: ${formatVolume(huntStallConfig.volume)}`,
      `상태: ${formatStatus(metadata.status)}`,
      `${huntStallReadingLabel}: ${formatNullable(sampleResult.value)}`,
      `변화 없음: ${formatSeconds(huntStallState?.unchangedSeconds)}`,
      `${huntStallObservedLabel}: ${hasObservedHuntStallActivity ? "있음" : "없음"}`,
      `반복: ${formatHuntStallRepeat(huntStallConfig, huntStallState)}`,
      `실제 재생: ${formatPlaybackStatus(huntStallState?.lastAlertPlayback)}`,
    );
  } else if (buffExpiryConfig) {
    const lastSnapshot = body?.buffExpiry?.lastSnapshot ?? null;
    const performance = sampleResult.performance ?? lastSnapshot?.performance ?? null;
    const supportedBuffCount = Array.isArray(buffExpiryConfig.supportedBuffIds)
      ? buffExpiryConfig.supportedBuffIds.length
      : Array.isArray(buffExpiryConfig.selectedBuffIds)
        ? buffExpiryConfig.selectedBuffIds.length
        : 0;
    const detectedBuffBoxCount =
      lastSnapshot?.displayBoxCount ??
      lastSnapshot?.boxCount ??
      buffExpiryState?.boxCount ??
      sampleResult.candidateCount;
    const acceptedMatchCount =
      lastSnapshot?.acceptedMatchCount ??
      buffExpiryState?.acceptedMatchCount ??
      (Array.isArray(body?.sample?.acceptedMatches) ? body.sample.acceptedMatches.length : null);
    const topRejectedMatch = Array.isArray(body?.sample?.rejectedMatches)
      ? [...body.sample.rejectedMatches].sort((a, b) => Number(b?.score ?? 0) - Number(a?.score ?? 0))[0]
      : null;
    lines.push(
      `알림 기준: ${formatNullable(buffExpiryConfig.alertLeadSeconds)}초`,
      `알람음: ${formatNullable(buffExpiryConfig.soundId)}`,
      `볼륨: ${formatVolume(buffExpiryConfig.volume)}`,
      `상태: ${formatBuffExpiryStatus(buffExpiryState?.status ?? metadata.status)}`,
      `지원 버프: ${supportedBuffCount}개`,
      `감지 버프칸: ${formatNullable(detectedBuffBoxCount)}`,
      `매칭: ${formatNullable(acceptedMatchCount)}`,
      `추적: ${Array.isArray(buffExpiryState?.tracks) ? buffExpiryState.tracks.length : 0}개`,
      `확인 중: ${Array.isArray(buffExpiryState?.pendingTracks) ? buffExpiryState.pendingTracks.length : 0}개`,
      `실제 재생: ${formatPlaybackStatus(buffExpiryState?.lastAlertPlayback)}`,
      `모듈: ${summarizeBuffExpiryPrecisionModules(body?.buffExpiry?.summary?.moduleVersions)}`,
    );
    if (topRejectedMatch?.reason && Number.isFinite(Number(topRejectedMatch.score))) {
      lines.push(`최고 거절: ${formatConfidence(topRejectedMatch.score)} (${topRejectedMatch.reason})`);
    }
    if (performance?.totalMs !== null && performance?.totalMs !== undefined) {
      lines.push(`처리 시간: ${formatNullable(performance.totalMs)}ms`);
    }
  } else if (boosterExpiryConfig) {
    const lastSnapshot = body?.boosterExpiry?.lastSnapshot ?? null;
    const performance = sampleResult.performance ?? lastSnapshot?.performance ?? null;
    lines.push(
      `알림 기준: ${formatNullable(boosterExpiryConfig.alertLeadSeconds)}초`,
      `알람음: ${formatNullable(boosterExpiryConfig.soundId)}`,
      `볼륨: ${formatVolume(boosterExpiryConfig.volume)}`,
      `상태: ${formatStatus(boosterExpiryState?.status ?? metadata.status)}`,
      `감지값: ${formatNullable(sampleResult.value)}`,
      `원본 감지값: ${formatNullable(boosterExpiryState?.rawText)}`,
      `확정 종료시각: ${formatNullable(boosterExpiryState?.confirmedExpiresAt)}`,
    );
    if (lastSnapshot?.flowSource) {
      lines.push(`흐름: ${formatNullable(lastSnapshot.flowSource)}`);
    }
    if (
      lastSnapshot?.timerEvidenceCount !== null &&
      lastSnapshot?.timerEvidenceCount !== undefined
    ) {
      lines.push(
        `타이머 증거: ${formatNullable(lastSnapshot.timerEvidenceCount)}개` +
          (lastSnapshot?.confirmationEvidenceCount !== null &&
          lastSnapshot?.confirmationEvidenceCount !== undefined
            ? ` (확정 ${formatNullable(lastSnapshot.confirmationEvidenceCount)}개)`
            : ""),
      );
    }
    if (performance?.totalMs !== null && performance?.totalMs !== undefined) {
      lines.push(`처리 시간: ${formatNullable(performance.totalMs)}ms`);
    }
  } else if (specialCoreConfig) {
    const specialCoreState = body?.specialCore?.state ?? null;
    const playbackEvents = body?.specialCore?.timeline?.playbackEvents;
    const latestPlayback = Array.isArray(playbackEvents)
      ? playbackEvents[playbackEvents.length - 1]
      : specialCoreState?.lastAlertPlayback;
    lines.push(
      `재사용 대기시간: ${formatSeconds(specialCoreConfig.cooldownSeconds)}`,
      `알림 기준: ${formatNullable(specialCoreConfig.alertLeadSeconds)}초 전`,
      `상태: ${formatStatus(specialCoreState?.status ?? metadata.status)}`,
      `감지 버프칸: ${formatNullable(specialCoreState?.boxCount)}`,
      `활성화 확정: ${formatNullable(specialCoreState?.activationConfirmedAt)}`,
      `예상 알림: ${formatNullable(specialCoreState?.alertDueAt)}`,
      `실제 재생: ${formatPlaybackStatus(latestPlayback)}`,
    );
  } else {
    lines.push(`상태: ${formatStatus(metadata.status)}`, `현재 OCR 값: ${formatNullable(metadata.value)}`);
  }

  lines.push(
    `신뢰도: ${formatConfidence(metadata.confidence)}`,
    `후보 수: ${formatNullable(metadata.candidateCount)}`,
  );

  if (issueNote) {
    lines.push(`메모: ${issueNote}`);
  }

  lines.push(
    `샘플 ID: ${id}`,
    `샘플 보기: ${sampleViewerUrl}`,
    `원본 JSON: ${sampleUrl}`,
    `KV Key: ${key}`,
  );

  return truncate(lines.join("\n"), MAX_NOTIFICATION_LENGTH);
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

export function buildDebugSampleNotificationPayload({ id, key, metadata, body, requestUrl }) {
  return {
    content: buildDebugSampleNotificationContent({ id, key, metadata, body, requestUrl }),
    slack: buildDebugSampleSlackNotificationPayload({ id, key, metadata, body, requestUrl }),
  };
}
