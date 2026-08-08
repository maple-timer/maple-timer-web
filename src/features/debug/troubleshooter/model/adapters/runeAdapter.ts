import { analyzeRuneReplaySample } from "../../../replay/runeReplay";
import {
  asArray,
  asRecord,
  firstNumber,
  firstString,
  formatConfidence,
  formatCount,
  formatMilliseconds,
  formatTimestamp,
} from "../sample";
import {
  addCommonEvidence,
  buildVerdict,
  createEvidenceCollector,
  diagnostic,
  diagnosticsFromReplayCauses,
  evidenceIdsForStage,
  metric,
  stage,
} from "../shared";
import type {
  FeatureAdapter,
  PipelineStageStatus,
  TroubleshooterDiagnostic,
  TroubleshooterTone,
} from "../types";

export const runeAdapter: FeatureAdapter = {
  feature: "rune",
  analyze(sample, now) {
    const { body } = sample;
    const sampleNode = asRecord(body.sample);
    const result = asRecord(sampleNode.result);
    const rune = asRecord(body.rune);
    const runeEvidence = asRecord(sampleNode.runeEvidence);
    const runeSelection = asRecord(runeEvidence.selection);
    const runeMediaBudget = asRecord(runeEvidence.mediaBudget);
    const runtimeIncidents = asArray(runeEvidence.runtimeIncidents).map(asRecord);
    const episodes = asArray(runeEvidence.episodes).map(asRecord);
    const alertAttempts = asArray(runeEvidence.alertAttempts).map(asRecord);
    const runtimeIncident = asRecord(
      runeEvidence.runtimeIncident ??
        runtimeIncidents[runtimeIncidents.length - 1] ??
        rune.runtimeIncident,
    );
    const runtimeIncidentFrames = asArray(runtimeIncident.frames);
    const runtimeIncidentSignalFrames = runtimeIncidentFrames.filter(
      (entry) => firstString(asRecord(entry).phase) === "signal",
    );
    const runtimeIncidentDetected = runtimeIncidentSignalFrames.some(
      (entry) => asRecord(entry).detected === true,
    );
    const runtimeIncidentNearThreshold = runtimeIncidentSignalFrames.some(
      (entry) => firstString(asRecord(entry).outcome) === "near-threshold",
    );
    const runtimeIncidentError = runtimeIncidentSignalFrames.some(
      (entry) => firstString(asRecord(entry).outcome) === "error",
    );
    const runtimeEnabled = asRecord(rune.config).enabled !== false;
    const state = asRecord(rune.state);
    const payloadTrace = asArray(rune.runtimeTrace);
    const trace = payloadTrace.length > 0 ? payloadTrace : asArray(state.recentSamples);
    const lastSnapshot = asRecord(rune.lastSnapshot);
    const runtimeAssets = asRecord(asRecord(body.diagnostics).runtimeAssets);
    const latestTraceSample = asRecord(trace[trace.length - 1]);
    const lastDetectionError = asRecord(
      state.lastDetectionError ?? lastSnapshot.detectionError ?? latestTraceSample.error,
    );
    const detectionDebug = {
      ...asRecord(lastSnapshot.detectionDebug),
      ...asRecord(asRecord(rune.detection).debug),
    };
    const replay = analyzeRuneReplaySample(sample.root, now ? { now } : {});
    const collector = createEvidenceCollector(sample);
    addCommonEvidence(sample, collector, "미니맵 원본");
    addRuneEvidence(sample, collector);
    const reportFrameDetected = Boolean(result.detected ?? lastSnapshot.detected);
    const runtimeDetected = replay.metrics.detected === true;
    const hasRuntimeDetectionError = replay.metrics.hasDetectionError === true;
    const reportConfidence = firstNumber(result.confidence, lastSnapshot.confidence);
    const reportCandidateCount =
      firstNumber(result.candidateCount, lastSnapshot.candidateCount) ?? 0;
    const reportDetectorKind = firstString(detectionDebug.detectorKind);
    const usesFullFrameOnnx = reportDetectorKind === "onnx-full-frame";
    const usesCascadeOnnx = reportDetectorKind === "onnx-cascade";
    const usesOnnx = usesFullFrameOnnx || usesCascadeOnnx;
    const reportProposalScore = firstNumber(detectionDebug.proposalScore);
    const reportProposalRank = firstNumber(detectionDebug.selectedProposalRank);
    const reportShapeScore = firstNumber(detectionDebug.shapeScore);
    const reportShapeThreshold = firstNumber(detectionDebug.shapeThreshold);
    const reportShapePass = detectionDebug.shapePass === true;
    const reportAppearanceScore = firstNumber(detectionDebug.appearanceScore);
    const reportAppearanceThreshold = firstNumber(detectionDebug.appearanceThreshold);
    const reportAppearancePass = detectionDebug.appearancePass === true;
    const reportModelScore = firstNumber(
      detectionDebug.modelScore,
      result.confidence,
      lastSnapshot.confidence,
    );
    const reportModelThreshold = firstNumber(detectionDebug.modelThreshold);
    const hasReportLocation =
      reportCandidateCount > 0 ||
      Object.keys(asRecord(lastSnapshot.candidate)).length > 0 ||
      Object.keys(asRecord(detectionDebug.modelCandidate)).length > 0;
    const runtimeCandidateCount = firstNumber(replay.metrics.candidateCount) ?? 0;
    const reportDetectorVersion = firstString(
      result.detectorVersion,
      lastSnapshot.detectorVersion,
      detectionDebug.classifier,
    );
    const runtimeDetectorVersion = firstString(state.detectorVersion);
    const savedDetectorVersion = getSavedDetectorVersionView({
      reportDetectorVersion,
      runtimeDetectorVersion,
    });
    const playbackEffectiveVolume = firstNumber(replay.metrics.playbackEffectiveVolume);
    const alertOutcome = getRuneAlertOutcomeView(
      replay.metrics.alertOutcome,
      replay.shouldAlert,
      playbackEffectiveVolume,
      runtimeEnabled,
    );
    const stableCount = firstNumber(replay.metrics.stableCount) ?? 0;
    const scenePolicyVersion = firstString(replay.metrics.scenePolicyVersion);
    const sceneEpoch = firstNumber(replay.metrics.sceneEpoch) ?? 0;
    const alertedSceneEpoch = firstNumber(replay.metrics.alertedSceneEpoch);
    const sceneChangeCount = firstNumber(replay.metrics.sceneChangeCount) ?? 0;
    const latestSceneChangedAt = firstNumber(replay.metrics.latestSceneChangedAt);
    const latestSceneChangeScore = firstNumber(replay.metrics.latestSceneChangeScore);
    const consecutiveMissCount = firstNumber(replay.metrics.consecutiveMissCount) ?? 0;
    const confirmedAbsenceCount = trace.filter(
      (entry) => firstString(asRecord(entry).reason) === "confirmed-absent",
    ).length;
    const requiredStableFrames =
      firstNumber(replay.metrics.requiredStableFrames) ?? 3;
    const requiredStableMilliseconds =
      firstNumber(replay.metrics.requiredStableMilliseconds) ?? 900;
    const confirmationPolicyVersion =
      firstString(replay.metrics.confirmationPolicyVersion) ?? "rune-confirmation-v1";
    const confirmationPolicyMode =
      firstString(replay.metrics.confirmationPolicyMode) === "all" ? "all" : "any";
    const confirmationPolicyJoiner = confirmationPolicyMode === "all" ? "그리고" : "또는";
    const confirmationPolicySummary =
      `${requiredStableFrames}회 ${confirmationPolicyJoiner} ${requiredStableMilliseconds}ms`;
    const runtimeStable = replay.metrics.runtimeStable === true;
    const alertTriggerDetected = replay.metrics.alertTriggerDetected === true;
    const alertTriggerSampledAt = firstNumber(replay.metrics.alertTriggerSampledAt);
    const alertTriggerConfidence = firstNumber(replay.metrics.alertTriggerConfidence);
    const alertTriggerStableCount = firstNumber(replay.metrics.alertTriggerStableCount);
    const alertTriggerStableDurationMs = firstNumber(
      replay.metrics.alertTriggerStableDurationMs,
    );
    const alertTriggerSatisfiedBy = firstString(
      replay.metrics.alertTriggerSatisfiedBy,
    );
    const alertTriggerSatisfiedLabel = formatRuneConfirmationSatisfiedBy(
      alertTriggerSatisfiedBy,
    );
    const alertTriggerFrameCount = firstNumber(
      replay.metrics.alertTriggerFrameCount,
    ) ?? 0;
    const alertTriggerDetectorVersion = firstString(
      replay.metrics.alertTriggerDetectorVersion,
    );
    const hasAlertTrigger = alertTriggerDetected && alertTriggerSampledAt !== null;
    const hasRuntimeEvidence =
      trace.length > 0 ||
      runtimeIncidentFrames.length > 0 ||
      episodes.length > 0 ||
      alertAttempts.length > 0 ||
      alertTriggerFrameCount > 0 ||
      hasAlertTrigger ||
      hasRuntimeDetectionError ||
      firstString(replay.metrics.lastAlertPlaybackStatus) !== null ||
      firstNumber(replay.metrics.lastAlertedAt) !== null;
    const issueReason = firstString(asRecord(body.reportIssue).reason);
    const issueScenario = firstString(asRecord(body.reportIssue).scenario);
    const alertTimelineDiagnostics =
      hasAlertTrigger && !reportFrameDetected
        ? [
            diagnostic(
              "rune-alert-report-frame-timeline",
              issueReason === "rune-false-positive" ? "critical" : "warning",
              issueReason === "rune-false-positive"
                ? "알림 프레임에서 모델 오감지 확인"
                : "알림 프레임과 제보 프레임이 다름",
              `알림 프레임은 ${formatTimestamp(alertTriggerSampledAt)}에 ${formatConfidence(alertTriggerConfidence)}로 감지됐고, 제보 프레임은 ${formatTimestamp(replay.metrics.reportFrameSampledAt)}에 ${formatConfidence(reportConfidence)}로 미감지됐습니다.`,
              "runtime",
            ),
          ]
        : [];
    const diagnostics = [
      ...(!runtimeEnabled
        ? [
            diagnostic(
              "rune-alert-disabled",
              "warning",
              "제보 당시 룬 알림이 꺼져 있었습니다",
              "룬 알림이 꺼진 상태라 실제 감지 루프와 알림 재생이 실행되지 않았습니다. 제보 이미지 판정은 제보용 단일 프레임 분석 결과입니다.",
              "runtime",
            ),
          ]
        : []),
      ...buildRuneSelectionDiagnostics({
        selection: runeSelection,
        mediaBudget: runeMediaBudget,
        runtimeFrameCount: asArray(runeEvidence.runtimeFrames).length,
      }),
      ...buildRuneMissingRuntimeEvidenceDiagnostics({
        runtimeEnabled,
        hasRuntimeEvidence,
      }),
      ...buildRuneProvenanceDiagnostics({
        runtimeEnabled,
        reportFrameDetected,
        runtimeDetected,
        trace,
        reportFrameSampledAt: firstNumber(replay.metrics.reportFrameSampledAt),
        runtimeSampledAt: firstNumber(replay.metrics.runtimeSampledAt),
        reportDetectorVersion,
        runtimeDetectorVersion,
        hasRuntimeDetectionError,
        detectionError: lastDetectionError,
      }),
      ...alertTimelineDiagnostics,
      ...buildRuneSceneDiagnostics({
        scenePolicyVersion,
        sceneEpoch,
        sceneChangeCount,
        latestSceneChangedAt,
        latestSceneChangeScore,
        confirmedAbsenceCount,
      }),
      ...buildRuneRuntimeIncidentDiagnostics({
        issueReason,
        reportFrameDetected,
        frames: runtimeIncidentFrames,
      }),
      ...buildRuneEpisodeAttemptDiagnostics({
        scenario: issueScenario,
        episodes,
        alertAttempts,
      }),
      ...buildRuntimeAssetDiagnostics(runtimeAssets),
      ...(runtimeEnabled && hasRuntimeEvidence
        ? diagnosticsFromReplayCauses(replay.causes)
        : []),
    ];
    const verdict = runtimeEnabled
      ? buildVerdict(diagnostics, {
          title: "룬 감지 상태 확인 필요",
          detail: "저장된 후보와 runtime 상태에서 명확한 결론을 만들지 못했습니다.",
        })
      : {
          tone: "warning" as const,
          title: "제보 당시 룬 알림이 꺼져 있었습니다",
          detail: "룬 알림이 꺼진 상태라 실제 감지와 알림 재생이 진행되지 않았습니다.",
        };

    return {
      feature: "rune",
      featureLabel: "룬 알림",
      modeLabel: "미니맵 감지",
      title: sample.id === "unknown" ? "룬 감지 제보" : `룬 감지 제보 ${sample.id.slice(0, 8)}`,
      verdict,
      summaryMetrics: [
        metric(
          "report-frame",
          "제보 이미지 판정",
          reportFrameDetected ? "룬 감지" : "룬 없음",
          undefined,
          reportFrameDetected ? "positive" : "neutral",
        ),
        metric(
          "saved-model",
          runtimeEnabled ? "저장 모델" : "제보 이미지 모델",
          savedDetectorVersion.label,
          savedDetectorVersion.detail,
        ),
        metric(
          "runtime-detected",
          "런타임 판정",
          !runtimeEnabled
            ? "알림 꺼짐"
            : !hasRuntimeEvidence
              ? "기록 없음"
            : hasRuntimeDetectionError
              ? "감지 오류"
              : hasAlertTrigger
              ? "알림 당시 감지"
              : runtimeDetected
                ? "룬 감지"
                : "미감지",
          undefined,
          !runtimeEnabled
            ? "neutral"
            : !hasRuntimeEvidence
              ? "neutral"
            : hasRuntimeDetectionError
              ? "critical"
              : hasAlertTrigger || runtimeDetected
              ? "positive"
              : "neutral",
        ),
        metric(
          "stable",
          !runtimeEnabled ? "연속 감지" : hasAlertTrigger ? "확정 근거" : "연속 감지",
          !runtimeEnabled
            ? "확인 안 함"
            : !hasRuntimeEvidence
              ? "확인 불가"
            : hasAlertTrigger
              ? `${alertTriggerStableCount ?? 0}회 · ${formatMilliseconds(alertTriggerStableDurationMs)}${alertTriggerSatisfiedLabel ? ` · ${alertTriggerSatisfiedLabel}` : ""}`
              : `${stableCount}/${requiredStableFrames}회`,
        ),
        metric(
          "actual-alert",
          "실제 알림",
          alertOutcome.label,
          alertOutcome.detail,
          alertOutcome.tone,
        ),
        ...(episodes.length > 0 || alertAttempts.length > 0
          ? [
              metric(
                "selected-episodes-attempts",
                "선택 구간/알림 시도",
                `${episodes.length}개 / ${alertAttempts.length}개`,
              ),
            ]
          : []),
      ],
      diagnostics,
      stages: [
        stage({
          id: "input",
          label: "제보 이미지 입력",
          status: collector.evidence.some((item) => item.stageId === "input")
            ? "complete"
            : "blocked",
          summary: collector.evidence.some((item) => item.stageId === "input")
            ? "미니맵 화면 있음"
            : "화면 증거 없음",
          detail: "제보 버튼을 누른 시점에 별도로 캡처한 미니맵 원본과 마스크입니다.",
          evidenceIds: evidenceIdsForStage(collector.evidence, "input"),
        }),
        stage({
          id: "detection",
          label: usesCascadeOnnx
            ? "제보 이미지 후보 위치 탐색"
            : usesFullFrameOnnx
              ? "제보 이미지 전체 분석"
              : "제보 이미지 후보 탐색",
          status: usesOnnx
            ? reportDetectorVersion ? "complete" : "warning"
            : reportCandidateCount > 0 ? "complete" : "warning",
          summary: usesCascadeOnnx
            ? `${firstNumber(detectionDebug.proposalCount) ?? 0}개 후보`
            : usesFullFrameOnnx
            ? hasReportLocation ? "분석 위치 저장됨" : "분석 완료"
            : `${reportCandidateCount}개 후보`,
          detail: usesCascadeOnnx
            ? "제보 프레임 전체에서 가능성이 높은 위치를 최대 5개까지 찾았습니다. 후보 자체는 룬 확정이 아닙니다."
            : usesFullFrameOnnx
            ? "제보 시점의 운영 전처리와 ONNX 모델이 미니맵 전체에서 가장 유력한 룬 위치를 계산한 결과입니다."
            : "제보 이미지 한 장에서 모델에 전달할 보라색 후보를 찾은 결과입니다.",
          metrics: usesCascadeOnnx
            ? [
                metric(
                  "selected-proposal-rank",
                  "선택 후보",
                  reportProposalRank === null ? "기록 없음" : `${reportProposalRank}순위`,
                ),
                metric(
                  "proposal-score",
                  "후보 점수",
                  formatConfidence(reportProposalScore),
                ),
              ]
            : usesFullFrameOnnx
            ? [
                metric("model-score", "모델 점수", formatConfidence(reportModelScore)),
                metric(
                  "model-threshold",
                  "판정 기준",
                  formatConfidence(reportModelThreshold),
                ),
                metric("accepted-locations", "확정 위치", `${reportCandidateCount}개`),
              ]
            : [metric("candidates", "후보", `${reportCandidateCount}개`)],
          evidenceIds: evidenceIdsForStage(collector.evidence, "detection"),
        }),
        ...(usesCascadeOnnx
          ? [
              stage({
                id: "shape-gate",
                label: "반듯한 마름모 형태 확인",
                status: reportShapePass ? "complete" : "warning",
                summary: reportShapePass ? "형태 통과" : "형태 탈락",
                detail: "색상 정보를 쓰지 않는 독립 형태 게이트 결과입니다.",
                metrics: [
                  metric(
                    "shape-score",
                    "형태 점수",
                    formatConfidence(reportShapeScore),
                  ),
                  metric(
                    "shape-threshold",
                    "형태 기준",
                    formatConfidence(reportShapeThreshold),
                  ),
                ],
                evidenceIds: evidenceIdsForStage(collector.evidence, "recognition"),
              }),
              stage({
                id: "appearance-gate",
                label: "룬 색감·외형 확인",
                status: reportAppearancePass ? "complete" : "warning",
                summary: reportAppearancePass ? "외형 통과" : "외형 탈락",
                detail: "형태 정보를 쓰지 않는 독립 색감·외형 게이트 결과입니다.",
                metrics: [
                  metric(
                    "appearance-score",
                    "색감·외형 점수",
                    formatConfidence(reportAppearanceScore),
                  ),
                  metric(
                    "appearance-threshold",
                    "외형 기준",
                    formatConfidence(reportAppearanceThreshold),
                  ),
                ],
                evidenceIds: evidenceIdsForStage(collector.evidence, "recognition"),
              }),
            ]
          : []),
        stage({
          id: "recognition",
          label: usesCascadeOnnx ? "두 조건 결합" : "제보 이미지 모델 판정",
          status: reportFrameDetected
            ? "complete"
            : usesOnnx || reportCandidateCount > 0
              ? "warning"
              : "blocked",
          summary: reportFrameDetected
            ? `룬 · ${formatConfidence(reportConfidence)}`
            : "룬 아님",
          detail: usesCascadeOnnx
            ? "같은 후보가 형태와 색감·외형 조건을 모두 통과한 경우에만 단일 프레임 룬 판정으로 기록합니다."
            : usesFullFrameOnnx
            ? `제보 이미지의 모델 점수 ${formatConfidence(reportModelScore)}와 판정 기준 ${formatConfidence(reportModelThreshold)}를 비교한 단일 프레임 결과입니다.`
            : "제보 이미지 한 장을 저장 당시 모델로 판정한 결과이며 실제 런타임 흐름과는 별도입니다.",
          metrics: [
            metric("confidence", "신뢰도", formatConfidence(reportConfidence)),
            metric(
              "model",
              "저장 모델",
              reportDetectorVersion ?? "기록 없음",
              reportDetectorVersion ?? undefined,
            ),
          ],
          evidenceIds: evidenceIdsForStage(collector.evidence, "recognition"),
        }),
        stage({
          id: "runtime",
          label: "실제 런타임 연속 감지",
          status: !runtimeEnabled
            ? "unavailable"
            : !hasRuntimeEvidence
              ? "unavailable"
            : hasRuntimeDetectionError
              ? "blocked"
              : hasAlertTrigger || runtimeStable
              ? "complete"
              : trace.length > 0
                ? "warning"
                : "unavailable",
          summary: !runtimeEnabled
            ? "알림 꺼짐"
            : !hasRuntimeEvidence
              ? "기록 없음"
            : hasRuntimeDetectionError
              ? "감지기 실행 오류"
              : hasAlertTrigger
              ? `알림 당시 ${alertTriggerStableCount ?? 0}회 · ${formatMilliseconds(alertTriggerStableDurationMs)}`
              : runtimeIncidentError
                ? "고정 프레임에서 감지 오류"
                : runtimeIncidentDetected
                  ? "고정 프레임에서 룬 감지"
                  : runtimeIncidentNearThreshold
                    ? "고정 프레임에서 기준 근처"
                    : `${stableCount}/${requiredStableFrames}회`,
          detail: !runtimeEnabled
            ? "제보 당시 룬 알림이 꺼져 있어 실제 감지 루프가 실행되지 않았습니다. 제보 이미지의 모델 판정과는 별도입니다."
            : !hasRuntimeEvidence
              ? "구형 제보에는 실제 감지 루프의 프레임과 상태 흐름이 없습니다. 제보 시점의 단일 이미지로 당시 런타임 판정이나 알림 여부를 대신 판단할 수 없습니다."
            : hasRuntimeDetectionError
              ? `룬 감지기가 정상 결과를 반환하지 못했습니다.${
                  firstString(lastDetectionError.message)
                    ? ` 오류: ${firstString(lastDetectionError.message)}`
                    : ""
                }`
              : hasAlertTrigger
              ? `${alertTriggerFrameCount > 0 ? `실제 알림을 확정한 ${alertTriggerFrameCount}개 프레임` : "실제 알림 트리거 기록"}과 이후 제보 시점을 분리해 보여줍니다. 알림 당시 ${confirmationPolicySummary} 조건(${confirmationPolicyVersion})을 적용했습니다.`
              : `실제 감지 루프의 저장 기록입니다. ${confirmationPolicySummary} 조건을 충족하면 알림합니다.${
                  runtimeIncidentFrames.length > 0
                    ? ` 제보 직전 런타임 원본 ${runtimeIncidentFrames.length}개를 별도로 보관했습니다.`
                    : ""
                }`,
          metrics: [
            metric(
              "confirmation-policy",
              "확정 정책",
              hasRuntimeEvidence
                ? `${confirmationPolicySummary} · ${confirmationPolicyVersion}`
                : "기록 없음",
            ),
            ...(!runtimeEnabled
              ? [metric("stable", "연속 감지", "확인 안 함")]
              : !hasRuntimeEvidence
                ? [metric("stable", "연속 감지", "확인 불가")]
              : hasAlertTrigger
              ? [
                  metric(
                    "alert-trigger-confidence",
                    "알림 당시 점수",
                    formatConfidence(alertTriggerConfidence),
                  ),
                  metric(
                    "alert-trigger-at",
                    "알림 트리거",
                    formatTimestamp(alertTriggerSampledAt),
                  ),
                  metric(
                    "alert-trigger-stable",
                    "알림 당시 연속 감지",
                    `${alertTriggerStableCount ?? 0}회`,
                  ),
                  metric(
                    "alert-trigger-duration",
                    "알림 당시 유지",
                    formatMilliseconds(alertTriggerStableDurationMs),
                  ),
                  metric(
                    "alert-trigger-satisfied-by",
                    "충족 경로",
                    alertTriggerSatisfiedLabel || "기록 없음",
                  ),
                  metric(
                    "alert-trigger-frames",
                    "고정 프레임",
                    alertTriggerFrameCount > 0
                      ? `${alertTriggerFrameCount}개`
                      : "구버전 기록 없음",
                  ),
                  metric(
                    "alert-trigger-model",
                    "알림 당시 모델",
                    alertTriggerDetectorVersion ?? runtimeDetectorVersion ?? "기록 없음",
                  ),
                ]
              : [metric("stable", "연속 감지", `${stableCount}회`)]),
            metric(
              "runtime-detected",
              runtimeEnabled && hasAlertTrigger ? "제보 직전 마지막 판정" : "마지막 판정",
              !runtimeEnabled
                ? "알림 꺼짐"
                : !hasRuntimeEvidence
                  ? "기록 없음"
                : hasRuntimeDetectionError
                  ? "감지 오류"
                  : runtimeDetected
                    ? "룬 감지"
                    : "미감지",
            ),
            metric(
              "runtime-candidates",
              "마지막 후보",
              hasRuntimeEvidence ? formatCount(runtimeCandidateCount) : "기록 없음",
            ),
            metric(
              "runtime-model",
              "런타임 모델",
              !runtimeEnabled ? "실행 안 함" : runtimeDetectorVersion ?? "기록 없음",
              runtimeDetectorVersion ?? undefined,
            ),
            metric("trace", "상태 기록", `${trace.length}개`),
            ...(episodes.length > 0 || alertAttempts.length > 0
              ? [
                  metric(
                    "selected-episodes-attempts",
                    "선택 구간/알림 시도",
                    `${episodes.length}개 / ${alertAttempts.length}개`,
                  ),
                ]
              : []),
            metric(
              "runtime-incident-frames",
              "고정 런타임 프레임",
              runtimeIncidentFrames.length > 0
                ? `${runtimeIncidentFrames.length}개 · 신호 ${runtimeIncidentSignalFrames.length}개`
                : "기록 없음",
              firstNumber(runtimeIncident.lastSignalAt) === null
                ? undefined
                : `마지막 신호 ${formatTimestamp(runtimeIncident.lastSignalAt)}`,
            ),
            metric(
              "scene-epoch",
              "장면 주기",
              scenePolicyVersion ? `${sceneEpoch} · ${scenePolicyVersion}` : "구버전 기록 없음",
              alertedSceneEpoch === null
                ? undefined
                : `최근 알림 장면 주기 ${alertedSceneEpoch}`,
            ),
            metric(
              "scene-change",
              "장면 전환",
              scenePolicyVersion ? `${sceneChangeCount}회` : "기록 없음",
              latestSceneChangedAt === null
                ? undefined
                : `${formatTimestamp(latestSceneChangedAt)} · 변화 ${formatConfidence(latestSceneChangeScore)}`,
            ),
            metric(
              "consecutive-miss",
              "연속 미감지",
              scenePolicyVersion ? `${consecutiveMissCount}회` : "기록 없음",
              confirmedAbsenceCount > 0
                ? `저장 구간에서 이전 룬 주기 종료 ${confirmedAbsenceCount}회`
                : undefined,
            ),
            metric(
              "detector-error",
              "감지 오류",
              hasRuntimeDetectionError
                ? firstString(lastDetectionError.phase) ?? "기록 있음"
                : hasRuntimeEvidence
                  ? "없음"
                  : "확인 불가",
              firstString(lastDetectionError.message) ?? undefined,
            ),
          ],
          evidenceIds: evidenceIdsForStage(collector.evidence, "runtime"),
        }),
        stage({
          id: "alert",
          label: "실제 알림 기록",
          status: alertOutcome.status,
          summary: alertOutcome.label,
          detail: alertOutcome.detail,
          replayCoverage: hasRuntimeEvidence
            ? "decision-replayed"
            : "recognition-not-run",
          metrics: [
            metric(
              "playback",
              "재생 상태",
              runtimeEnabled
                ? String(replay.metrics.lastAlertPlaybackStatus ?? "기록 없음")
                : "실행 안 함",
            ),
            metric(
              "playback-cycle",
              "재생 주기",
              firstString(replay.metrics.playbackCycleId) ?? "구버전 기록 없음",
              firstNumber(replay.metrics.playbackSceneEpoch) === null
                ? undefined
                : `장면 주기 ${firstNumber(replay.metrics.playbackSceneEpoch)}`,
            ),
            metric(
              "playback-requested-at",
              "재생 요청",
              formatTimestamp(replay.metrics.playbackRequestedAt),
            ),
            metric(
              "playback-started-at",
              "브라우저 재생 시작",
              formatTimestamp(replay.metrics.playbackStartedAt),
            ),
            metric(
              "playback-finished-at",
              "브라우저 재생 종료",
              formatTimestamp(replay.metrics.playbackFinishedAt),
            ),
            metric(
              "playback-volume",
              "최종 볼륨",
              playbackEffectiveVolume === null
                ? "구버전 기록 없음"
                : formatConfidence(playbackEffectiveVolume),
              [
                firstNumber(replay.metrics.playbackAlertVolume) === null
                  ? null
                  : `기능 ${formatConfidence(replay.metrics.playbackAlertVolume)}`,
                firstNumber(replay.metrics.playbackMasterVolume) === null
                  ? null
                  : `마스터 ${formatConfidence(replay.metrics.playbackMasterVolume)}`,
                firstString(replay.metrics.playbackSoundId)
                  ? `음성 ${firstString(replay.metrics.playbackSoundId)}`
                  : null,
              ].filter(Boolean).join(" · ") || undefined,
            ),
            metric("last-alert", "최근 알림", formatTimestamp(replay.metrics.lastAlertedAt)),
            metric(
              "repeat",
              "반복 횟수",
              hasRuntimeEvidence ? String(state.repeatedAlertCount ?? 0) : "기록 없음",
            ),
          ],
          evidenceIds: evidenceIdsForStage(collector.evidence, "alert"),
        }),
      ],
      evidence: collector.evidence,
    };
  },
};

function buildRuneMissingRuntimeEvidenceDiagnostics({
  runtimeEnabled,
  hasRuntimeEvidence,
}: {
  runtimeEnabled: boolean;
  hasRuntimeEvidence: boolean;
}): TroubleshooterDiagnostic[] {
  if (!runtimeEnabled || hasRuntimeEvidence) {
    return [];
  }
  return [
    diagnostic(
      "rune-runtime-evidence-unavailable",
      "warning",
      "실제 런타임 기록이 없는 구버전 제보",
      "제보 버튼 시점의 한 프레임은 확인할 수 있지만 당시 감지 흐름과 알림 재생 여부는 확정할 수 없습니다.",
      "runtime",
    ),
  ];
}

function buildRuneSelectionDiagnostics({
  selection,
  mediaBudget,
  runtimeFrameCount,
}: {
  selection: Record<string, unknown>;
  mediaBudget: Record<string, unknown>;
  runtimeFrameCount: number;
}): TroubleshooterDiagnostic[] {
  if (Object.keys(selection).length === 0) {
    return [];
  }
  const diagnostics: TroubleshooterDiagnostic[] = [];
  const status = firstString(selection.status);
  const selectionPolicy = firstString(selection.policy);
  const usesIncidentCandidates = selectionPolicy === "rune-scenario-incident-v2";
  const candidateCount = firstNumber(selection.candidateCount) ?? 0;
  const sampleCount = firstNumber(selection.sampleCount);
  const selectedFrameCount = asArray(selection.frameIds).length;
  const degradationReason = firstString(selection.degradationReason);
  if (status === "outside-retention") {
    diagnostics.push(
      diagnostic(
        "rune-selection-outside-retention",
        "warning",
        "선택한 사건은 런타임 증거 보관 기간을 지났습니다",
        "제보 시점 화면은 현재 상태의 참고 자료일 뿐, 과거 감지나 알림 여부를 증명하지 않습니다.",
        "runtime",
      ),
    );
  } else if (status === "unavailable") {
    diagnostics.push(
      degradationReason === "journal-expired-trigger-retained"
        ? diagnostic(
            "rune-selection-trigger-retained",
            "warning",
            "사건 기록은 지났지만 마지막 알림 원본은 남아 있습니다",
            "최근 사건 목록은 만료됐지만 같은 알림 주기의 트리거 프레임을 별도 보관해 현재 모델과 비교할 수 있습니다. 재생 단계의 상세 기록은 일부 없을 수 있습니다.",
            "runtime",
          )
        : diagnostic(
            "rune-selection-unavailable",
            "warning",
            "제보 사유와 일치하는 런타임 사건을 찾지 못했습니다",
            sampleCount !== null && sampleCount > 0
              ? `${sampleCount}개 런타임 샘플을 확인했지만 보관된 근접 판정이나 실행 오류 사건은 없었습니다. 제보 시점 화면을 과거 사건의 원본으로 대신 사용하지 않았습니다.`
              : "다른 시점의 화면이나 알림 기록을 선택 사건의 증거로 대신 사용하지 않았습니다.",
            "runtime",
          ),
    );
  }
  if (selection.ambiguous === true) {
    diagnostics.push(
      usesIncidentCandidates
        ? diagnostic(
            "rune-selection-ambiguous",
            "warning",
            "제보 시간에 맞는 사건이 여러 개 있습니다",
            `${sampleCount === null ? "" : `${sampleCount}개 런타임 샘플에서 `}사건 후보 ${candidateCount}개를 찾았으며 가장 최근 사건을 선택했습니다.`,
            "runtime",
          )
        : diagnostic(
            "rune-selection-ambiguous",
            "warning",
            "이전 제보 방식이 여러 음성 기록을 후보로 선택했습니다",
            `${candidateCount}개 후보 기록 중 마지막 기록이 선택됐습니다. 실제 사건 수를 뜻하지 않으며 당시 원본이 없으면 정확히 재현할 수 없습니다.`,
            "runtime",
          ),
    );
  }
  if (selectedFrameCount > 0 && runtimeFrameCount === 0) {
    diagnostics.push(
      diagnostic(
        "rune-selection-media-unavailable",
        "warning",
        "선택 사건의 런타임 원본이 남아 있지 않습니다",
        "판정과 상태 기록은 확인할 수 있지만 당시 미니맵 원본을 다시 검사할 수는 없습니다.",
        "runtime",
      ),
    );
  }
  const omittedCapacity = firstNumber(mediaBudget.omittedCapacity) ?? 0;
  const omittedOversized = firstNumber(mediaBudget.omittedOversized) ?? 0;
  if (omittedCapacity > 0 || omittedOversized > 0) {
    diagnostics.push(
      diagnostic(
        "rune-selection-media-compacted",
        "warning",
        "일부 런타임 원본이 보관 한도로 제외됐습니다",
        `용량 한도 ${omittedCapacity}개, 프레임 크기 한도 ${omittedOversized}개가 제외됐습니다. 선택 사건 원본이 표시되면 해당 원본은 정상 보관된 것입니다.`,
        "runtime",
      ),
    );
  }
  return diagnostics;
}

function buildRuneEpisodeAttemptDiagnostics({
  scenario,
  episodes,
  alertAttempts,
}: {
  scenario: string | null;
  episodes: Record<string, unknown>[];
  alertAttempts: Record<string, unknown>[];
}): TroubleshooterDiagnostic[] {
  if (scenario !== "duplicate-alert") {
    return [];
  }
  if (alertAttempts.length < 2) {
    return [
      diagnostic(
        "rune-duplicate-attempt-evidence-missing",
        "warning",
        "중복 알림을 비교할 두 시도가 남아 있지 않습니다",
        `선택된 감지 구간 ${episodes.length}개와 알림 시도 ${alertAttempts.length}개만 확인됩니다. 두 번째 알림이 반복인지 새 룬인지 확정할 수 없습니다.`,
        "alert",
      ),
    ];
  }
  const parentEpisodeIds = new Set(
    alertAttempts
      .map((attempt) => firstString(attempt.parentEpisodeId, attempt.episodeId))
      .filter((value): value is string => Boolean(value)),
  );
  const playbackEventCount = alertAttempts.reduce(
    (count, attempt) => count + asArray(attempt.playbackEvents).length,
    0,
  );
  return [
    diagnostic(
      "rune-duplicate-attempts-correlated",
      "positive",
      parentEpisodeIds.size === 1
        ? "두 알림 시도가 같은 감지 구간에 연결됐습니다"
        : "두 알림 시도가 서로 다른 감지 구간에 연결됐습니다",
      `${alertAttempts.length}개 알림 시도와 ${playbackEventCount}개 브라우저 재생 이벤트가 ${parentEpisodeIds.size || episodes.length}개 감지 구간에 결합되어 있습니다. 반복 설정과 장면 전환 기록을 함께 비교할 수 있습니다.`,
      "alert",
    ),
  ];
}

function formatRuneConfirmationSatisfiedBy(value: string | null) {
  if (value === "frames-and-duration") {
    return "횟수+시간 조건";
  }
  if (value === "frames") {
    return "횟수 조건";
  }
  if (value === "duration") {
    return "시간 조건";
  }
  return null;
}

function addRuneEvidence(
  sample: Parameters<typeof createEvidenceCollector>[0],
  collector: ReturnType<typeof createEvidenceCollector>,
) {
  const sampleNode = asRecord(sample.body.sample);
  const evidence = asRecord(sampleNode.runeEvidence);
  const runtimeFrames = asArray(evidence.runtimeFrames).map(asRecord);
  const runtimeFrameMedia = new Map(
    runtimeFrames
      .map((frame) => [firstString(frame.frameId), frame.rawDataUrl] as const)
      .filter(
        (entry): entry is readonly [string, unknown] => Boolean(entry[0]),
      ),
  );
  const getRuntimeFrameValue = (frame: Record<string, unknown>) =>
    frame.rawDataUrl ??
    runtimeFrameMedia.get(firstString(frame.frameId) ?? "") ??
    null;
  const resolveRuneMedia = ({
    value,
    frameId,
    mediaPath,
  }: {
    value: unknown;
    frameId?: unknown;
    mediaPath?: unknown;
  }) => {
    if (value) return value;
    const referencedFrameId = firstString(frameId);
    if (referencedFrameId) {
      return runtimeFrameMedia.get(referencedFrameId) ?? null;
    }
    if (mediaPath === "sample.rawDataUrl") return sampleNode.rawDataUrl;
    if (mediaPath === "sample.processedDataUrl") return sampleNode.processedDataUrl;
    if (mediaPath === "sample.candidateDataUrl") return sampleNode.candidateDataUrl;
    return null;
  };
  const current = asRecord(evidence.current);
  const lastAlert = asRecord(evidence.lastAlert);
  const runtimeIncidentRecords = asArray(evidence.runtimeIncidents).map(asRecord);
  const legacyRuntimeIncident = asRecord(evidence.runtimeIncident);
  const runtimeIncidentFrames = (
    runtimeIncidentRecords.length > 0
      ? runtimeIncidentRecords.flatMap((incident) => asArray(incident.frames))
      : asArray(legacyRuntimeIncident.frames)
  ).map(asRecord);
  const alertAttemptRecords = asArray(evidence.alertAttempts).map(asRecord);
  const alertTrigger = asRecord(evidence.alertTrigger);
  const alertTriggerFrames = (
    alertAttemptRecords.length > 0
      ? alertAttemptRecords.flatMap((attempt) => asArray(attempt.frames))
      : asArray(alertTrigger.frames)
  ).map(asRecord);
  collector.add({
    id: "rune-current-candidate",
    group: "recognition",
    label: "현재 룬 후보",
    description: "제보 시점 모델이 평가한 후보입니다.",
    value: resolveRuneMedia({
      value: current.candidateDataUrl,
      mediaPath: current.candidateMediaPath,
    }),
    capturedAt: current.candidateSampledAt ?? current.sampledAt,
    stageId: "recognition",
    metadata: [
      metric("confidence", "신뢰도", formatConfidence(current.confidence)),
      metric("model", "저장 모델", firstString(current.detectorVersion) ?? "기록 없음"),
    ],
  });
  collector.add({
    id: "rune-last-alert-raw",
    group: "alert",
    label: "최근 알림 원본",
    description: "마지막 룬 알림을 발생시킨 후보 원본입니다.",
    value: resolveRuneMedia({
      value: lastAlert.rawDataUrl,
      frameId: lastAlert.rawFrameId,
    }),
    capturedAt: lastAlert.candidateSampledAt ?? lastAlert.sampledAt,
    stageId: "alert",
  });
  collector.add({
    id: "rune-last-alert-processed",
    group: "alert",
    label: "최근 알림 마스크",
    description: "마지막 룬 알림 후보의 전처리 결과입니다.",
    value: resolveRuneMedia({
      value: lastAlert.processedDataUrl,
      mediaPath: lastAlert.processedMediaPath,
    }),
    capturedAt: lastAlert.candidateSampledAt ?? lastAlert.sampledAt,
    stageId: "alert",
  });
  collector.add({
    id: "rune-last-alert-candidate",
    group: "alert",
    label: "최근 알림 후보",
    description: "마지막 알림에서 모델이 룬으로 판단한 위치입니다.",
    value: resolveRuneMedia({
      value: lastAlert.candidateDataUrl,
      mediaPath: lastAlert.candidateMediaPath,
    }),
    capturedAt: lastAlert.candidateSampledAt ?? lastAlert.sampledAt,
    stageId: "alert",
    metadata: [metric("confidence", "신뢰도", formatConfidence(lastAlert.confidence))],
  });
  const runtimeMetadataByFrameId = new Map(
    runtimeIncidentFrames
      .map((frame) => [firstString(frame.frameId), frame] as const)
      .filter(
        (entry): entry is readonly [string, Record<string, unknown>] =>
          Boolean(entry[0]),
      ),
  );
  const displayedFrameIds = new Set<string>();
  alertTriggerFrames.slice(-6).forEach((triggerFrame, index) => {
    const frameId = firstString(triggerFrame.frameId);
    const frame = {
      ...(frameId ? runtimeMetadataByFrameId.get(frameId) : null),
      ...triggerFrame,
    };
    const value = getRuntimeFrameValue(frame);
    if (frameId && typeof value === "string" && value.startsWith("data:image/")) {
      displayedFrameIds.add(frameId);
    }
    collector.add({
      id: `rune-alert-trigger-frame-${normalizeRuneEvidenceId(frameId, index)}`,
      group: "alert",
      label: `알림 시도 프레임 ${index + 1}/${alertTriggerFrames.length}`,
      description: "선택된 룬 알림 시도의 감지 확정에 참여한 미니맵 원본입니다.",
      value,
      capturedAt: frame.sampledAt,
      stageId: "alert",
      metadata: [
        metric("confidence", "모델 점수", formatConfidence(frame.confidence)),
        metric("stable-count", "연속 감지", `${firstNumber(frame.stableCount) ?? 0}회`),
        metric("decision", "결정", firstString(frame.reason) ?? "기록 없음"),
        metric("model", "저장 모델", firstString(frame.detectorVersion) ?? "기록 없음"),
      ],
    });
  });
  runtimeIncidentFrames.slice(-6).forEach((frame, index) => {
    const frameId = firstString(frame.frameId);
    if (frameId && displayedFrameIds.has(frameId)) {
      return;
    }
    const debug = asRecord(frame.detectionDebug);
    const stateBefore = asRecord(frame.stateBefore);
    const stateAfter = asRecord(frame.stateAfter);
    const phase = firstString(frame.phase);
    collector.add({
      id: `rune-runtime-incident-frame-${normalizeRuneEvidenceId(frameId, index)}`,
      group: "runtime",
      label: `${formatRuneIncidentPhase(phase)} ${index + 1}/${runtimeIncidentFrames.length}`,
      description:
        "제보 버튼 시점에 새로 분석한 화면이 아니라 실제 감지 루프가 사용한 미니맵 원본입니다.",
      value: getRuntimeFrameValue(frame),
      capturedAt: frame.sampledAt,
      stageId: "runtime",
      metadata: [
        metric("outcome", "저장 판정", formatRuneIncidentOutcome(firstString(frame.outcome))),
        metric(
          "model-score",
          "모델 점수",
          formatConfidence(firstNumber(debug.modelScore, frame.confidence)),
        ),
        metric("model-threshold", "판정 기준", formatConfidence(debug.modelThreshold)),
        metric("stable-count", "연속 감지", `${firstNumber(frame.stableCount) ?? 0}회`),
        metric("decision", "결정", firstString(frame.reason) ?? "기록 없음"),
        metric("model", "저장 모델", firstString(frame.detectorVersion) ?? "기록 없음"),
        metric(
          "state",
          "상태 전후",
          `${String(stateBefore.status ?? "없음")} → ${String(stateAfter.status ?? "없음")}`,
        ),
      ],
    });
  });
}

function normalizeRuneEvidenceId(frameId: string | null, index: number) {
  return (frameId ?? String(index + 1).padStart(2, "0")).replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  );
}

function formatRuneIncidentPhase(value: string | null) {
  if (value === "before") return "신호 직전";
  if (value === "signal") return "런타임 신호";
  if (value === "after") return "신호 이후";
  return "런타임 프레임";
}

function formatRuneIncidentOutcome(value: string | null) {
  if (value === "detected") return "룬 감지";
  if (value === "near-threshold") return "판정 기준 근처";
  if (value === "error") return "감지 오류";
  if (value === "not-detected") return "미감지";
  return "기록 없음";
}

function getSavedDetectorVersionView({
  reportDetectorVersion,
  runtimeDetectorVersion,
}: {
  reportDetectorVersion: string | null;
  runtimeDetectorVersion: string | null;
}) {
  if (
    reportDetectorVersion &&
    runtimeDetectorVersion &&
    reportDetectorVersion !== runtimeDetectorVersion
  ) {
    return {
      label: "버전 불일치",
      detail: `제보 이미지 ${reportDetectorVersion} · 런타임 ${runtimeDetectorVersion}`,
    };
  }
  const version = reportDetectorVersion ?? runtimeDetectorVersion;
  return {
    label: version ?? "기록 없음",
    detail: version ?? "구버전 제보에는 정확한 모델 버전이 저장되지 않았습니다.",
  };
}

function buildRuneSceneDiagnostics({
  scenePolicyVersion,
  sceneEpoch,
  sceneChangeCount,
  latestSceneChangedAt,
  latestSceneChangeScore,
  confirmedAbsenceCount,
}: {
  scenePolicyVersion: string | null;
  sceneEpoch: number;
  sceneChangeCount: number;
  latestSceneChangedAt: number | null;
  latestSceneChangeScore: number | null;
  confirmedAbsenceCount: number;
}): TroubleshooterDiagnostic[] {
  if (!scenePolicyVersion) {
    return [];
  }

  const items: TroubleshooterDiagnostic[] = [];
  if (sceneChangeCount > 0) {
    items.push(
      diagnostic(
        "rune-scene-cycle-reset",
        "info",
        "맵 전환 뒤 새 룬 주기로 재설정됨",
        `장면 주기 ${sceneEpoch}에서 저장 구간 내 전환 ${sceneChangeCount}회를 확인했습니다.${
          latestSceneChangedAt === null
            ? ""
            : ` 최근 전환 ${formatTimestamp(latestSceneChangedAt)}, 변화 ${formatConfidence(latestSceneChangeScore)}.`
        }`,
        "runtime",
      ),
    );
  }
  if (confirmedAbsenceCount > 0) {
    items.push(
      diagnostic(
        "rune-confirmed-absence-reset",
        "info",
        "연속 미감지 뒤 이전 룬 주기가 종료됨",
        `저장된 런타임 구간에서 룬 미감지 2회가 확인되어 이전 좌표의 알림 억제를 ${confirmedAbsenceCount}회 해제했습니다.`,
        "runtime",
      ),
    );
  }
  return items;
}

function buildRuneRuntimeIncidentDiagnostics({
  issueReason,
  reportFrameDetected,
  frames,
}: {
  issueReason: string | null;
  reportFrameDetected: boolean;
  frames: unknown[];
}): TroubleshooterDiagnostic[] {
  if (frames.length === 0) {
    return [];
  }
  const signalFrames = frames
    .map(asRecord)
    .filter((frame) => firstString(frame.phase) === "signal");
  if (signalFrames.some((frame) => firstString(frame.outcome) === "error")) {
    return [
      diagnostic(
        "rune-runtime-incident-error",
        "critical",
        "실제 런타임에서 감지 오류가 발생함",
        "제보 직전 저장된 런타임 프레임 중 감지기가 정상 판정을 반환하지 못한 기록이 있습니다. 제보 이미지의 단일 프레임 판정과 별도로 확인해야 합니다.",
        "runtime",
      ),
    ];
  }
  if (issueReason !== "rune-missed" || !reportFrameDetected) {
    return [];
  }
  const detectedFrames = signalFrames.filter((frame) => frame.detected === true);
  if (detectedFrames.length > 0) {
    const stableCount = Math.max(
      ...detectedFrames.map((frame) => firstNumber(frame.stableCount) ?? 0),
    );
    const shouldAlert = detectedFrames.some((frame) => frame.shouldAlert === true);
    return [
      diagnostic(
        "rune-runtime-incident-detected",
        shouldAlert ? "info" : "warning",
        shouldAlert
          ? "실제 런타임에서 알림 조건까지 도달함"
          : "실제 런타임에서 룬은 감지했지만 확정 전이었음",
        shouldAlert
          ? "고정된 런타임 프레임에는 알림 결정이 있습니다. 실제 재생 기록을 함께 확인하세요."
          : `고정된 런타임 프레임은 룬을 감지했지만 연속 감지가 최대 ${stableCount}회라 알림 확정 전이었습니다.`,
        "runtime",
      ),
    ];
  }
  const nearFrames = signalFrames.filter(
    (frame) => firstString(frame.outcome) === "near-threshold",
  );
  if (nearFrames.length === 0) {
    return [];
  }
  const bestFrame = nearFrames.reduce((best, frame) => {
    const bestScore = firstNumber(asRecord(best.detectionDebug).modelScore, best.confidence) ?? 0;
    const score = firstNumber(asRecord(frame.detectionDebug).modelScore, frame.confidence) ?? 0;
    return score > bestScore ? frame : best;
  });
  const debug = asRecord(bestFrame.detectionDebug);
  return [
    diagnostic(
      "rune-runtime-incident-near-threshold",
      "warning",
      "실제 런타임에서는 판정 기준에 미치지 못함",
      `제보 이미지는 룬으로 판정됐지만 제보 직전 고정된 런타임 원본의 최고 점수는 ${formatConfidence(firstNumber(debug.modelScore, bestFrame.confidence))}, 판정 기준은 ${formatConfidence(debug.modelThreshold)}였습니다. 두 화면의 시점 차이를 직접 비교할 수 있습니다.`,
      "runtime",
    ),
  ];
}

function buildRuneProvenanceDiagnostics({
  runtimeEnabled,
  reportFrameDetected,
  runtimeDetected,
  trace,
  reportFrameSampledAt,
  runtimeSampledAt,
  reportDetectorVersion,
  runtimeDetectorVersion,
  hasRuntimeDetectionError,
  detectionError,
}: {
  runtimeEnabled: boolean;
  reportFrameDetected: boolean;
  runtimeDetected: boolean;
  trace: unknown[];
  reportFrameSampledAt: number | null;
  runtimeSampledAt: number | null;
  reportDetectorVersion: string | null;
  runtimeDetectorVersion: string | null;
  hasRuntimeDetectionError: boolean;
  detectionError: Record<string, unknown>;
}): TroubleshooterDiagnostic[] {
  const items: TroubleshooterDiagnostic[] = [];
  if (hasRuntimeDetectionError) {
    const phase = firstString(detectionError.phase);
    const message = firstString(detectionError.message);
    items.push(
      diagnostic(
        "rune-runtime-detector-error",
        "critical",
        "실제 룬 감지기가 정상 실행되지 않음",
        [phase ? `단계 ${phase}` : null, message ? `오류 ${message}` : null]
          .filter(Boolean)
          .join(" · ") || "Worker가 감지 결과를 반환하지 못했습니다.",
        "runtime",
      ),
    );
  }
  if (!runtimeEnabled) {
    return items;
  }
  if (
    reportDetectorVersion &&
    runtimeDetectorVersion &&
    reportDetectorVersion !== runtimeDetectorVersion
  ) {
    items.push(
      diagnostic(
        "rune-model-version-mismatch",
        "warning",
        "제보 시점 모델 버전이 일치하지 않음",
        `제보 이미지에는 ${reportDetectorVersion}, 실제 런타임에는 ${runtimeDetectorVersion}이 기록됐습니다.`,
        "recognition",
      ),
    );
  }

  if (
    !hasRuntimeDetectionError &&
    trace.length > 0 &&
    reportFrameDetected !== runtimeDetected &&
    (runtimeDetectorVersion !== null || !reportFrameDetected)
  ) {
    const detectedTraceCount = trace.filter(
      (entry) => asRecord(entry).detected === true,
    ).length;
    const frameGap =
      reportFrameSampledAt !== null && runtimeSampledAt !== null
        ? Math.abs(reportFrameSampledAt - runtimeSampledAt)
        : null;
    const reportFrameLabel = reportFrameDetected ? "룬 감지" : "미감지";
    const runtimeLabel = runtimeDetected ? "룬 감지" : "미감지";
    const frameGapDetail =
      frameGap === null
        ? ""
        : ` 두 마지막 프레임은 ${Math.round(frameGap)}ms 차이입니다.`;
    items.push(
      diagnostic(
        "rune-report-runtime-frame-mismatch",
        "warning",
        "제보 이미지와 런타임 판정이 다름",
        `제보 이미지 판정은 ${reportFrameLabel}지만 저장된 런타임 ${trace.length}개 중 감지는 ${detectedTraceCount}개이고 마지막 판정은 ${runtimeLabel}입니다.${frameGapDetail}`,
        "runtime",
      ),
    );
  }
  if (
    !hasRuntimeDetectionError &&
    reportFrameDetected &&
    !runtimeDetected &&
    trace.length > 0 &&
    !runtimeDetectorVersion
  ) {
    items.push(
      diagnostic(
        "rune-runtime-detector-may-not-have-run",
        "warning",
        "런타임 감지기 실행 여부 확인 필요",
        "제보 이미지는 룬으로 판정됐지만 실제 런타임에는 모델 버전과 감지 기록이 없습니다. 구버전 제보라 오류 원인은 확정할 수 없지만 감지기가 실행되지 않았을 가능성이 있습니다.",
        "runtime",
      ),
    );
  }
  return items;
}

function buildRuntimeAssetDiagnostics(
  runtimeAssets: Record<string, unknown>,
): TroubleshooterDiagnostic[] {
  const status = firstString(runtimeAssets.status);
  if (status !== "update-required" && status !== "update-available") {
    return [];
  }

  const runningBuild = asRecord(runtimeAssets.runningBuild);
  const latestBuild = asRecord(runtimeAssets.latestBuild);
  const runningVersion = firstString(runningBuild.shortCommit, runningBuild.commitSha) ?? "기록 없음";
  const latestVersion = firstString(latestBuild.shortCommit, latestBuild.commitSha) ?? "기록 없음";
  return [
    diagnostic(
      "runtime-build-version-skew",
      status === "update-required" ? "critical" : "warning",
      status === "update-required"
        ? "이전 사이트 버전에서 자원 로드 실패"
        : "제보 시점에 새 사이트 버전이 준비됨",
      `실행 중 ${runningVersion} · 최신 ${latestVersion}`,
      "runtime",
    ),
  ];
}

type RuneAlertOutcomeView = {
  label: string;
  detail: string;
  tone: TroubleshooterTone;
  status: PipelineStageStatus;
};

function getRuneAlertOutcomeView(
  value: unknown,
  shouldAlert: boolean,
  effectiveVolume: number | null,
  runtimeEnabled: boolean,
): RuneAlertOutcomeView {
  if (!runtimeEnabled) {
    return {
      label: "알림 꺼짐",
      detail: "제보 당시 룬 알림이 꺼져 있어 알림 트리거와 오디오 재생이 실행되지 않았습니다.",
      tone: "neutral",
      status: "unavailable",
    };
  }
  if (effectiveVolume !== null && effectiveVolume <= 0) {
    return {
      label: "무음 설정",
      detail: "기능 볼륨과 마스터 볼륨을 합친 최종 볼륨이 0이라 소리가 나지 않습니다.",
      tone: "critical",
      status: "blocked",
    };
  }
  if (value === "finished") {
    return {
      label: "브라우저 재생 종료",
      detail: "audio.play()가 성공했고 브라우저가 종료 이벤트를 보냈습니다. 이 기록만으로 사용자가 실제로 들었는지는 확정할 수 없습니다.",
      tone: "positive",
      status: "complete",
    };
  }
  if (value === "failed") {
    return {
      label: "재생 실패",
      detail: "알림 조건에는 도달했지만 오디오 재생이 실패했습니다.",
      tone: "critical",
      status: "blocked",
    };
  }
  if (value === "started") {
    return {
      label: "브라우저 재생 시작",
      detail: "audio.play()는 성공했지만 종료 또는 실패 결과는 아직 저장되지 않았습니다.",
      tone: "warning",
      status: "warning",
    };
  }
  if (value === "requested") {
    return {
      label: "재생 요청만 기록",
      detail: "알림 조건은 충족했지만 audio.play() 성공 콜백은 저장되지 않았습니다.",
      tone: "warning",
      status: "warning",
    };
  }
  if (value === "triggered") {
    return {
      label: "발생 기록 있음",
      detail: "알림 트리거 시각은 있지만 구버전 payload라 오디오 완료 여부는 알 수 없습니다.",
      tone: "positive",
      status: "complete",
    };
  }
  if (value === "not-triggered") {
    return shouldAlert
      ? {
          label: "발생 기록 없음",
          detail: "저장된 상태로는 알림 조건을 충족하지만 트리거 또는 재생 기록이 없습니다.",
          tone: "critical",
          status: "blocked",
        }
      : {
          label: "미발생",
          detail: "저장된 런타임에 알림 트리거와 오디오 재생 기록이 없습니다.",
          tone: "warning",
          status: "warning",
        };
  }
  return {
    label: "확인 불가",
    detail: "이 제보에는 실제 알림 결과를 판단할 런타임 기록이 없습니다.",
    tone: "neutral",
    status: "unavailable",
  };
}
