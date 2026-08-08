import {
  asArray,
  asRecord,
  firstNumber,
  firstString,
  formatConfidence,
  formatTimestamp,
} from "../sample";
import {
  buildVerdict,
  createEvidenceCollector,
  diagnostic,
  evidenceIdsForStage,
  metric,
  stage,
} from "../shared";
import type { FeatureAdapter } from "../types";

const INCIDENT_SCHEMAS = new Set([
  "ultima-raid-equipment-incident-evidence-v1",
  "ultima-raid-equipment-incident-evidence-v2",
]);
const LEGACY_WRONG_TARGET_SELECTION_POLICY =
  "ultima-raid-equipment-scenario-selection-v1";

export const ultimaRaidEquipmentAdapter: FeatureAdapter = {
  feature: "ultima-raid-equipment",
  analyze(sample) {
    const sampleNode = asRecord(sample.body.sample);
    const evidence = asRecord(
      sampleNode.ultimaRaidEquipmentEvidence,
    );
    const selection = asRecord(evidence.selection);
    const reportNode = asRecord(sample.body.ultimaRaidEquipment);
    const reportIssue = asRecord(sample.body.reportIssue);
    const target =
      firstString(selection.target) === "boss" ||
      firstString(reportNode.alertTarget) === "boss" ||
      firstString(reportIssue.reason)?.startsWith("ultima-raid-boss-")
        ? "boss"
        : "equipment";
    const isBoss = target === "boss";
    const frames = asArray(evidence.frames).map(asRecord);
    const media = asArray(evidence.media).map(asRecord);
    const playbacks = asArray(evidence.playbackAttempts).map(asRecord);
    const scenario = firstString(selection.scenario);
    const reportConfig = asRecord(reportNode.config);
    const targetConfig = isBoss
      ? asRecord(reportConfig.bossAlert)
      : reportConfig;
    const targetPlaybacks = playbacks.filter(
      (entry) => (firstString(entry.target) ?? "equipment") === target,
    );
    const { frame: selectedFrame, correctedLegacySelection } =
      resolveSelectedFrame(selection, frames, playbacks, target);
    const selectedBagSignal = selectedFrame?.bagFullDetected === true;
    const selectedBannerSignal = selectedFrame?.fullBannerDetected === true;
    const selectedCombinedSignal = selectedFrame?.detected === true;
    const selectedPlayback = resolveSelectedPlayback(
      playbacks,
      selectedFrame,
      target,
      scenario,
    );
    const repeatContext = resolveRepeatPlaybackContext({
      playbacks: targetPlaybacks,
      selectedPlayback,
      fallbackConfig: targetConfig,
    });
    const {
      playbacks: repeatPlaybacks,
      repeatEnabled,
      repeatIntervalSeconds,
      repeatMaxCount,
    } = repeatContext;
    const detectedFrames = frames.filter(
      (entry) =>
        isBoss
          ? firstString(entry.bossProgressState) === "boss"
          : entry.detected === true,
    ).length;
    const alertFrames = frames.filter(
      (entry) =>
        isBoss ? entry.bossShouldAlert === true : entry.shouldAlert === true,
    ).length;
    const firstBossFrame = isBoss
      ? frames.find(
          (entry) => firstString(entry.bossProgressState) === "boss",
        )
      : null;
    const firstBossStateBefore = asRecord(
      asRecord(firstBossFrame?.stateBefore).boss,
    );
    const startedWithUnarmedBoss =
      isBoss &&
      firstBossFrame === frames[0] &&
      firstBossStateBefore.armed === false &&
      alertFrames === 0;
    const collector = createEvidenceCollector(sample);

    media.forEach((entry, index) => {
      collector.add({
        id: `ultima-raid-equipment-incident-${firstString(entry.id) ?? index}`,
        group: "source",
        label: `감지 화면 ${index + 1}`,
        description: formatMediaReason(firstString(entry.reason), target),
        value: entry.dataUrl,
        capturedAt: entry.sampledAt,
        stageId: "input",
        metadata: [
          metric(
            `ultima-media-frame-${index}`,
            "프레임",
            firstString(entry.frameId) ?? "미기록",
          ),
        ],
      });
    });

    const diagnostics = createDiagnostics({
      schemaVersion: firstString(evidence.schemaVersion),
      scenario,
      support: firstString(selection.support),
      selectedFrame,
      selectedPlayback,
      targetPlaybacks: repeatPlaybacks,
      repeatEnabled,
      repeatIntervalSeconds,
      repeatMaxCount,
      correctedLegacySelection,
      startedWithUnarmedBoss,
      target,
      frameCount: frames.length,
      mediaCount: media.length,
    });
    const verdict = buildVerdict(diagnostics, {
      title: isBoss
        ? "울티마 스쿼드 보스 감지 기록을 확인했습니다"
        : "울티마 스쿼드 장비 감지 기록을 확인했습니다",
      detail:
        "제보 창을 열기 전 정상 감지 루프에서 저장한 판정과 알림 재생 기록입니다.",
    });
    const selectedAlertRequested =
      (isBoss
        ? selectedFrame?.bossShouldAlert
        : selectedFrame?.shouldAlert) === true;

    return {
      feature: "ultima-raid-equipment",
      featureLabel: isBoss
        ? "울티마 스쿼드 보스 알림"
        : "울티마 스쿼드 장비 알림",
      modeLabel: isBoss ? "보스 등장 감지" : "장비 가방 가득 참 감지",
      title:
        sample.id === "unknown"
          ? isBoss
            ? "울티마 스쿼드 보스 감지 제보"
            : "울티마 스쿼드 장비 감지 제보"
          : `${isBoss ? "울티마 스쿼드 보스" : "울티마 스쿼드 장비"} 감지 제보 ${sample.id.slice(0, 8)}`,
      verdict,
      summaryMetrics: [
        metric(
          "ultima-selection-support",
          "증거 상태",
          firstString(selection.support) ?? "기록 없음",
        ),
        metric(
          "ultima-selected-at",
          "선택 사건",
          formatTimestamp(
            firstNumber(selectedFrame?.sampledAt) ??
              firstNumber(selection.selectedEventAt),
          ),
        ),
        metric(
          "ultima-detected-frames",
          "감지 프레임",
          `${detectedFrames}/${frames.length}개`,
        ),
        metric("ultima-alert-frames", "알림 요청", `${alertFrames}개`),
        metric(
          "ultima-playback",
          "실제 재생",
          formatPlayback(selectedPlayback),
        ),
        metric(
          "ultima-repeat-playback",
          "반복 재생",
          formatRepeatPlaybackSummary({
            repeatEnabled,
            repeatIntervalSeconds,
            repeatMaxCount,
            playbacks: repeatPlaybacks,
          }),
        ),
      ],
      diagnostics,
      stages: [
        stage({
          id: "input",
          label: "울티마 스쿼드 화면 입력",
          status:
            collector.evidence.length > 0
              ? "complete"
              : frames.length > 0
                ? "warning"
                : "blocked",
          summary:
            collector.evidence.length > 0
              ? `이미지 ${collector.evidence.length}개`
              : "저장 이미지 없음",
          detail:
            "정상 1000ms 감지 루프가 실제로 분석한 화면 중 최대 4장을 보관합니다.",
          metrics: [
            metric("ultima-frame-count", "메타데이터", `${frames.length}프레임`),
            metric("ultima-media-count", "이미지", `${media.length}개`),
          ],
          evidenceIds: evidenceIdsForStage(collector.evidence, "input"),
        }),
        stage({
          id: "recognition",
          label: isBoss ? "보스 진행도 판정" : "가방 가득 참 판정",
          status:
            isBoss
              ? firstString(selectedFrame?.bossProgressState) === "boss"
                ? "complete"
                : selectedFrame
                ? "warning"
                : "blocked"
              : selectedBagSignal
                ? "complete"
                : selectedCombinedSignal
                  ? "warning"
                  : selectedFrame
                    ? "warning"
                    : "blocked",
          summary:
            isBoss
              ? firstString(selectedFrame?.bossProgressState) === "boss"
                ? "보스 등장 진행 바 감지"
                : firstString(selectedFrame?.bossProgressState) === "normal"
                  ? "일반 스테이지 진행 바"
                  : "진행 바 확인 불가"
              : selectedBagSignal
                ? "가방 숫자 신호 감지"
                : selectedBannerSignal
                  ? "상단 안내만 감지"
                  : "감지 없음",
          detail:
            isBoss
              ? "하단 진행 바가 100%의 자홍색 보스 상태로 바뀌었는지 확인합니다."
              : "왼쪽 장비 가방의 따뜻한 색 비율과 상단 가득 참 안내를 함께 판정합니다.",
          metrics: isBoss
            ? [
                metric(
                  "ultima-boss-progress",
                  "진행도 상태",
                  firstString(selectedFrame?.bossProgressState) ?? "미기록",
                ),
                metric(
                  "ultima-boss-signal",
                  "보스 진행 바",
                  formatSignal(selectedFrame?.bossBarDetected),
                ),
                metric(
                  "ultima-normal-progress",
                  "일반 진행 바",
                  formatSignal(selectedFrame?.normalProgressBarDetected),
                ),
                metric(
                  "ultima-boss-width",
                  "보스 바 너비",
                  formatConfidence(selectedFrame?.bossBarWidthRatio),
                ),
                metric(
                  "ultima-boss-fill",
                  "보스 바 채움",
                  formatConfidence(selectedFrame?.bossBarFillRatio),
                ),
                metric(
                  "ultima-boss-detector",
                  "감지기",
                  firstString(selectedFrame?.bossDetectorVersion) ?? "미기록",
                ),
              ]
            : [
                metric(
                  "ultima-confidence",
                  "전체 신호 강도",
                  formatConfidence(selectedFrame?.confidence),
                ),
                metric(
                  "ultima-source",
                  "판정 방식",
                  firstString(selectedFrame?.detectionSource) ?? "미기록",
                ),
                metric(
                  "ultima-bag-signal",
                  "가방 숫자 신호",
                  formatSignal(selectedFrame?.bagFullDetected),
                ),
                metric(
                  "ultima-bag-count-state",
                  "가방 숫자 판독",
                  formatBagCountState(selectedFrame?.bagCountState),
                ),
                metric(
                  "ultima-bag-occluded",
                  "숫자 영역 가림",
                  formatSignal(selectedFrame?.bagCountOccluded),
                ),
                metric(
                  "ultima-banner-signal",
                  "상단 안내 신호",
                  formatSignal(selectedFrame?.fullBannerDetected),
                ),
                metric(
                  "ultima-bag-warm-ratio",
                  "따뜻한 색 비율",
                  formatConfidence(selectedFrame?.bagWarmPixelRatio),
                ),
                metric(
                  "ultima-bag-warm-pixels",
                  "따뜻한 색 픽셀",
                  formatPixelFraction(
                    selectedFrame?.bagWarmPixelCount,
                    selectedFrame?.bagForegroundPixelCount,
                  ),
                ),
                metric(
                  "ultima-bag-readable-pixels",
                  "읽을 수 있는 숫자 픽셀",
                  formatPixelCount(selectedFrame?.bagReadablePixelCount),
                ),
                metric(
                  "ultima-bag-warm-cluster",
                  "연결된 따뜻한 색",
                  formatPixelCount(selectedFrame?.largestBagWarmClusterSize),
                ),
                metric(
                  "ultima-bag-warm-shape",
                  "연결 영역 크기",
                  formatPixelDimensions(
                    selectedFrame?.largestBagWarmClusterWidth,
                    selectedFrame?.largestBagWarmClusterHeight,
                  ),
                ),
                metric(
                  "ultima-bag-warm-boundary",
                  "영역 경계 접촉",
                  formatSignal(
                    selectedFrame?.bagWarmComponentTouchesBoundary,
                  ),
                ),
                metric(
                  "ultima-bag-count-row",
                  "숫자 행 위치",
                  formatRelativeBand(
                    selectedFrame?.bagCountRowTopRatio,
                    selectedFrame?.bagCountRowHeightRatio,
                  ),
                ),
                metric(
                  "ultima-bag-warm-position",
                  "색 영역 시작 위치",
                  formatRelativePosition(
                    selectedFrame?.largestBagWarmClusterXRatio,
                    selectedFrame?.largestBagWarmClusterYRatio,
                  ),
                ),
                metric(
                  "ultima-detector",
                  "감지기",
                  firstString(selectedFrame?.detectorVersion) ?? "미기록",
                ),
              ],
          evidenceIds: evidenceIdsForStage(collector.evidence, "input"),
        }),
        stage({
          id: "confirmation",
          label: "연속 감지 확인",
          status:
            selectedAlertRequested
              ? "complete"
              : frames.length > 1
                ? "warning"
                : "unavailable",
          summary:
            selectedAlertRequested
              ? "알림 조건 충족"
              : "알림 조건 미충족",
          detail:
            isBoss
              ? "최근 3프레임 중 보스 진행 바가 2회 나타나야 알림을 요청합니다. 일반 진행 바는 다음 보스 알림을 준비할 때 사용합니다."
              : "최근 3프레임 중 가방 숫자 신호가 2회 확인돼야 알림을 요청합니다. 상단 안내는 보조 증거로만 사용합니다.",
          metrics: [
            metric("ultima-detected-total", "감지", `${detectedFrames}개`),
            metric("ultima-alert-total", "알림 요청", `${alertFrames}개`),
          ],
        }),
        stage({
          id: "alert",
          label: "알림 재생",
          status: getPlaybackStageStatus(selectedPlayback),
          summary: formatPlayback(selectedPlayback),
          detail:
            "알림 요청, 브라우저 재생 시작, 완료 또는 실패를 별도 기록합니다.",
          metrics: [
            metric(
              "ultima-playback-requested",
              "요청 시각",
              formatTimestamp(firstNumber(selectedPlayback?.requestedAt)),
            ),
            metric(
              "ultima-playback-kind",
              "재생 구분",
              formatPlaybackKind(selectedPlayback),
            ),
            metric(
              "ultima-repeat-summary",
              "반복 기록",
              formatRepeatPlaybackSummary({
                repeatEnabled,
                repeatIntervalSeconds,
                repeatMaxCount,
                playbacks: repeatPlaybacks,
              }),
            ),
          ],
        }),
      ],
      evidence: collector.evidence,
    };
  },
};

function createDiagnostics({
  schemaVersion,
  scenario,
  support,
  selectedFrame,
  selectedPlayback,
  targetPlaybacks,
  repeatEnabled,
  repeatIntervalSeconds,
  repeatMaxCount,
  correctedLegacySelection,
  startedWithUnarmedBoss,
  target,
  frameCount,
  mediaCount,
}: {
  schemaVersion: string | null;
  scenario: string | null;
  support: string | null;
  selectedFrame: Record<string, unknown> | null;
  selectedPlayback: Record<string, unknown> | null;
  targetPlaybacks: Record<string, unknown>[];
  repeatEnabled: boolean;
  repeatIntervalSeconds: number | null;
  repeatMaxCount: number | null;
  correctedLegacySelection: boolean;
  startedWithUnarmedBoss: boolean;
  target: "equipment" | "boss";
  frameCount: number;
  mediaCount: number;
}) {
  if (!schemaVersion || !INCIDENT_SCHEMAS.has(schemaVersion)) {
    return [
      diagnostic(
        "ultima-legacy-evidence",
        "warning",
        "이전 제보 형식입니다",
        "최근 1분의 감지 흐름과 재생 기록이 없어 현재 화면만 확인할 수 있습니다.",
        "input",
      ),
    ];
  }
  if (support === "unsupported" || frameCount === 0) {
    return [
      diagnostic(
        "ultima-no-runtime-frames",
        "critical",
        "선택할 최근 감지 기록이 없습니다",
        "문제가 발생한 뒤 1분이 지나 제보했거나 정상 감지 루프가 실행되지 않았습니다.",
        "input",
      ),
    ];
  }
  const diagnostics = [];
  if (startedWithUnarmedBoss) {
    diagnostics.push(
      diagnostic(
        "ultima-boss-started-unarmed",
        "critical",
        "보스 상태에서 감지가 시작됐지만 알림을 요청하지 않았습니다",
        "저장된 실행은 일반 진행 바를 보기 전에 보스 진행 바를 먼저 확인해 당시 시작 정책이 알림을 억제했습니다.",
        "confirmation",
      ),
    );
  }
  if (correctedLegacySelection) {
    diagnostics.push(
      diagnostic(
        "ultima-legacy-selection-corrected",
        "info",
        "실제 알림 프레임으로 보정했습니다",
        "이전 선택 정책이 제보 직전 화면을 가리켜 알림 요청과 연결된 프레임을 대신 표시합니다.",
        "input",
      ),
    );
  }
  if (mediaCount === 0) {
    diagnostics.push(
      diagnostic(
        "ultima-no-media",
        "warning",
        "화면 이미지는 보관되지 않았습니다",
        "판정 흐름은 남아 있지만 당시 화면을 눈으로 대조할 수 없습니다.",
        "input",
      ),
    );
  }
  if (scenario === "repeat-timing") {
    const repeatAttempts = targetPlaybacks.filter(
      (entry) => firstString(entry.kind) === "repeat",
    );
    const finishedRepeatCount = repeatAttempts.filter(
      (entry) => firstString(entry.status) === "finished",
    ).length;
    const failedRepeatCount = repeatAttempts.filter(
      (entry) => firstString(entry.status) === "failed",
    ).length;
    if (!repeatEnabled) {
      diagnostics.push(
        diagnostic(
          "ultima-repeat-disabled",
          "warning",
          "제보 당시 반복 알림이 꺼져 있었습니다",
          "첫 알림만 재생하는 설정으로 저장되어 있습니다.",
          "alert",
        ),
      );
    } else if (repeatMaxCount === null) {
      diagnostics.push(
        diagnostic(
          "ultima-repeat-config-missing",
          "warning",
          "반복 횟수 설정이 기록되지 않았습니다",
          "이전 제보 형식이거나 설정 스냅샷이 누락되어 기대 횟수와 비교할 수 없습니다.",
          "alert",
        ),
      );
    } else if (
      failedRepeatCount > 0 ||
      finishedRepeatCount < repeatMaxCount
    ) {
      diagnostics.push(
        diagnostic(
          "ultima-repeat-incomplete",
          "critical",
          "설정한 반복 재생을 모두 확인하지 못했습니다",
          formatRepeatPlaybackSummary({
            repeatEnabled,
            repeatIntervalSeconds,
            repeatMaxCount,
            playbacks: targetPlaybacks,
          }),
          "alert",
        ),
      );
    } else if (repeatAttempts.length > repeatMaxCount) {
      diagnostics.push(
        diagnostic(
          "ultima-repeat-exceeded",
          "warning",
          "설정 횟수보다 많은 반복 재생이 기록됐습니다",
          formatRepeatPlaybackSummary({
            repeatEnabled,
            repeatIntervalSeconds,
            repeatMaxCount,
            playbacks: targetPlaybacks,
          }),
          "alert",
        ),
      );
    } else {
      diagnostics.push(
        diagnostic(
          "ultima-repeat-complete",
          "info",
          "설정한 반복 재생이 모두 기록됐습니다",
          formatRepeatPlaybackSummary({
            repeatEnabled,
            repeatIntervalSeconds,
            repeatMaxCount,
            playbacks: targetPlaybacks,
          }),
          "alert",
        ),
      );
    }
  }
  if (target === "boss") {
    if (
      scenario === "not-recognized" &&
      firstString(selectedFrame?.bossProgressState) !== "boss"
    ) {
      diagnostics.push(
        diagnostic(
          "ultima-boss-not-recognized",
          "warning",
          "당시 감지기가 보스 진행 바로 판정하지 않았습니다",
          "저장 화면을 현재 감지기에 다시 넣어 하단 진행 바 판정 변화를 비교할 수 있습니다.",
          "recognition",
        ),
      );
    } else if (
      scenario === "recognized-no-alert" &&
      firstString(selectedFrame?.bossProgressState) === "boss" &&
      selectedFrame?.bossShouldAlert !== true
    ) {
      diagnostics.push(
        diagnostic(
          "ultima-boss-confirmation-missed",
          "warning",
          "보스 진행 바는 찾았지만 등장 알림 조건까지 이어지지 않았습니다",
          "일반 진행 바에서 보스 진행 바로 바뀐 흐름과 이미 알림한 스테이지인지 확인해야 합니다.",
          "confirmation",
        ),
      );
    }
    if (
      scenario === "playback-missing" &&
      firstString(selectedPlayback?.status) !== "finished"
    ) {
      diagnostics.push(
        diagnostic(
          "ultima-boss-playback-missing",
          "critical",
          "보스 알림 재생 완료를 확인하지 못했습니다",
          `저장된 재생 상태: ${formatPlayback(selectedPlayback)}`,
          "alert",
        ),
      );
    }
    if (
      scenario === "wrong-target" &&
      firstString(selectedFrame?.bossProgressState) === "boss"
    ) {
      diagnostics.push(
        diagnostic(
          "ultima-boss-false-positive",
          "warning",
          "당시 감지기가 보스 등장 진행 바로 판정했습니다",
          "저장 화면에서 하단 진행도가 실제로 100%의 자홍색 상태였는지 확인해주세요.",
          "recognition",
        ),
      );
    }
    return diagnostics;
  }
  if (
    scenario === "not-recognized" &&
    selectedFrame?.bagFullDetected !== true &&
    selectedFrame?.fullBannerDetected === true
  ) {
    diagnostics.push(
      diagnostic(
        "ultima-bag-signal-missed",
        "warning",
        "상단 안내는 찾았지만 가방 숫자 신호를 확정하지 못했습니다",
        `따뜻한 색 비율 ${formatConfidence(selectedFrame?.bagWarmPixelRatio)} · 현재 감지기로 다시 분석해 변경 전후를 비교할 수 있습니다.`,
        "recognition",
      ),
    );
  } else if (
    scenario === "not-recognized" &&
    selectedFrame?.detected !== true
  ) {
    diagnostics.push(
      diagnostic(
        "ultima-not-recognized",
        "warning",
        "당시 감지기가 가득 참으로 판정하지 않았습니다",
        "저장 화면을 현재 감지기에 다시 넣어 모델 변경 전후 결과를 비교할 수 있습니다.",
        "recognition",
      ),
    );
  } else if (
    scenario === "recognized-no-alert" &&
    selectedFrame?.detected === true &&
    selectedFrame?.shouldAlert !== true
  ) {
    diagnostics.push(
      diagnostic(
        "ultima-confirmation-missed",
        "warning",
        "한 프레임은 감지했지만 알림 조건까지 이어지지 않았습니다",
        "3프레임 연속 흐름과 이미 알림한 가방 상태인지 확인해야 합니다.",
        "confirmation",
      ),
    );
  }
  if (
    scenario === "playback-missing" &&
    firstString(selectedPlayback?.status) !== "finished"
  ) {
    diagnostics.push(
      diagnostic(
        "ultima-playback-missing",
        "critical",
        "알림 재생 완료를 확인하지 못했습니다",
        `저장된 재생 상태: ${formatPlayback(selectedPlayback)}`,
        "alert",
      ),
    );
  }
  if (
    scenario === "wrong-target" &&
    selectedFrame?.detected === true
  ) {
    diagnostics.push(
      diagnostic(
        "ultima-false-positive",
        "warning",
        "당시 감지기가 가득 참으로 판정했습니다",
        "저장 화면에서 가방 수량과 상단 안내가 실제로 보였는지 확인해주세요.",
        "recognition",
      ),
    );
  }
  return diagnostics;
}

function resolveSelectedFrame(
  selection: Record<string, unknown>,
  frames: Record<string, unknown>[],
  playbacks: Record<string, unknown>[],
  target: "equipment" | "boss",
): {
  frame: Record<string, unknown> | null;
  correctedLegacySelection: boolean;
} {
  const selectedFrameId = firstString(selection.selectedFrameId);
  const storedSelection = selectedFrameId
    ? frames.find((entry) => firstString(entry.id) === selectedFrameId) ?? null
    : frames[frames.length - 1] ?? null;
  const shouldCorrectLegacyWrongTarget =
    target === "equipment" &&
    firstString(selection.policy) === LEGACY_WRONG_TARGET_SELECTION_POLICY &&
    firstString(selection.scenario) === "wrong-target" &&
    storedSelection?.shouldAlert !== true;
  if (!shouldCorrectLegacyWrongTarget) {
    return { frame: storedSelection, correctedLegacySelection: false };
  }

  const playbackFrameIds = new Set(
    playbacks
      .map((entry) => firstString(entry.frameId))
      .filter((value): value is string => value !== null),
  );
  const reversedFrames = [...frames].reverse();
  const alertFrame =
    reversedFrames.find(
      (entry) =>
        entry.shouldAlert === true &&
        playbackFrameIds.has(firstString(entry.id) ?? ""),
    ) ??
    reversedFrames.find((entry) => entry.shouldAlert === true) ??
    null;

  return alertFrame
    ? { frame: alertFrame, correctedLegacySelection: true }
    : { frame: storedSelection, correctedLegacySelection: false };
}

function resolveSelectedPlayback(
  playbacks: Record<string, unknown>[],
  selectedFrame: Record<string, unknown> | null,
  target: "equipment" | "boss",
  scenario: string | null,
): Record<string, unknown> | null {
  const targetPlaybacks = playbacks.filter(
    (entry) => (firstString(entry.target) ?? "equipment") === target,
  );
  const selectedFrameId = firstString(selectedFrame?.id);
  if (scenario === "repeat-timing") {
    const repeatPlayback = [...targetPlaybacks]
      .reverse()
      .find(
        (entry) =>
          firstString(entry.kind) === "repeat" &&
          (!selectedFrameId ||
            firstString(entry.frameId) === selectedFrameId),
      );
    if (repeatPlayback) {
      return repeatPlayback;
    }
  }
  const linkedPlayback = selectedFrameId
    ? [...targetPlaybacks]
        .reverse()
        .find((entry) => firstString(entry.frameId) === selectedFrameId)
    : null;
  if (linkedPlayback) {
    return linkedPlayback;
  }

  const hasFrameLink = targetPlaybacks.some(
    (entry) => firstString(entry.frameId) !== null,
  );
  const shouldAlert =
    target === "boss"
      ? selectedFrame?.bossShouldAlert === true
      : selectedFrame?.shouldAlert === true;
  return shouldAlert && !hasFrameLink
    ? targetPlaybacks[targetPlaybacks.length - 1] ?? null
    : null;
}

function resolveRepeatPlaybackContext({
  playbacks,
  selectedPlayback,
  fallbackConfig,
}: {
  playbacks: Record<string, unknown>[];
  selectedPlayback: Record<string, unknown> | null;
  fallbackConfig: Record<string, unknown>;
}): {
  playbacks: Record<string, unknown>[];
  repeatEnabled: boolean;
  repeatIntervalSeconds: number | null;
  repeatMaxCount: number | null;
} {
  const selectedCycleId = firstNumber(selectedPlayback?.cycleId);
  const cyclePlaybacks =
    selectedCycleId === null
      ? playbacks
      : playbacks.filter(
          (entry) => firstNumber(entry.cycleId) === selectedCycleId,
        );
  const hasRecordedRepeatConfig =
    selectedPlayback !== null &&
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
      repeatEnabled: fallbackConfig.repeatAlertEnabled === true,
      repeatIntervalSeconds: firstNumber(
        fallbackConfig.repeatAlertIntervalSeconds,
      ),
      repeatMaxCount: firstNumber(fallbackConfig.repeatAlertMaxCount),
    };
  }

  const repeatIntervalSeconds = firstNumber(
    selectedPlayback.repeatIntervalSeconds,
  );
  const repeatMaxCount = firstNumber(selectedPlayback.repeatMaxCount);
  return {
    playbacks: cyclePlaybacks,
    repeatEnabled:
      firstString(selectedPlayback.kind) === "repeat" ||
      repeatIntervalSeconds !== null ||
      repeatMaxCount !== null,
    repeatIntervalSeconds,
    repeatMaxCount,
  };
}

function formatSignal(value: unknown): string {
  if (value === true) return "감지";
  if (value === false) return "감지 없음";
  return "미기록";
}

function formatBagCountState(value: unknown): string {
  if (value === "full") return "가득 참";
  if (value === "clear") return "여유 있음";
  if (value === "unreadable") return "판독 불가";
  return "미기록";
}

function formatPixelDimensions(width: unknown, height: unknown): string {
  const resolvedWidth = firstNumber(width);
  const resolvedHeight = firstNumber(height);
  if (resolvedWidth === null || resolvedHeight === null) {
    return "미기록";
  }
  return `${Math.round(resolvedWidth)}×${Math.round(resolvedHeight)}픽셀`;
}

function formatPixelFraction(value: unknown, total: unknown): string {
  const count = firstNumber(value);
  const totalCount = firstNumber(total);
  if (count === null || totalCount === null) {
    return "미기록";
  }
  return `${Math.round(count)}/${Math.round(totalCount)}픽셀`;
}

function formatPixelCount(value: unknown): string {
  const count = firstNumber(value);
  return count === null ? "미기록" : `${Math.round(count)}픽셀`;
}

function formatRelativeBand(top: unknown, height: unknown): string {
  const resolvedTop = firstNumber(top);
  const resolvedHeight = firstNumber(height);
  if (resolvedTop === null || resolvedHeight === null) {
    return "미기록";
  }
  return `${Math.round(resolvedTop * 100)}~${Math.round(
    (resolvedTop + resolvedHeight) * 100,
  )}%`;
}

function formatRelativePosition(x: unknown, y: unknown): string {
  const resolvedX = firstNumber(x);
  const resolvedY = firstNumber(y);
  if (resolvedX === null || resolvedY === null) {
    return "미기록";
  }
  return `가로 ${Math.round(resolvedX * 100)}% · 세로 ${Math.round(
    resolvedY * 100,
  )}%`;
}

function formatPlayback(entry: Record<string, unknown> | null): string {
  const status = firstString(entry?.status);
  const kind = formatPlaybackKind(entry);
  const prefix = kind === "미기록" ? "" : `${kind} · `;
  if (status === "finished") return `${prefix}재생 완료`;
  if (status === "started") return `${prefix}재생 시작`;
  if (status === "requested") return `${prefix}재생 요청`;
  if (status === "failed") {
    return `${prefix}재생 실패${firstString(entry?.error) ? ` · ${firstString(entry?.error)}` : ""}`;
  }
  return "기록 없음";
}

function formatPlaybackKind(
  entry: Record<string, unknown> | null,
): string {
  const kind = firstString(entry?.kind);
  if (kind === "initial") return "첫 알림";
  if (kind !== "repeat") return "미기록";
  const repeatIndex = firstNumber(entry?.repeatIndex);
  const repeatMaxCount = firstNumber(entry?.repeatMaxCount);
  return repeatIndex === null
    ? "반복 알림"
    : `반복 ${Math.round(repeatIndex)}${repeatMaxCount === null ? "" : `/${Math.round(repeatMaxCount)}`}회`;
}

function formatRepeatPlaybackSummary({
  repeatEnabled,
  repeatIntervalSeconds,
  repeatMaxCount,
  playbacks,
}: {
  repeatEnabled: boolean;
  repeatIntervalSeconds: number | null;
  repeatMaxCount: number | null;
  playbacks: Record<string, unknown>[];
}): string {
  if (!repeatEnabled) {
    return "사용 안 함";
  }
  const repeatAttempts = playbacks.filter(
    (entry) => firstString(entry.kind) === "repeat",
  );
  const finishedCount = repeatAttempts.filter(
    (entry) => firstString(entry.status) === "finished",
  ).length;
  const failedCount = repeatAttempts.filter(
    (entry) => firstString(entry.status) === "failed",
  ).length;
  const countLabel =
    repeatMaxCount === null
      ? `${finishedCount}회 완료`
      : `${finishedCount}/${Math.round(repeatMaxCount)}회 완료`;
  const intervalLabel =
    repeatIntervalSeconds === null
      ? "간격 미기록"
      : `${repeatIntervalSeconds}초 간격`;
  return [
    countLabel,
    failedCount > 0 ? `실패 ${failedCount}회` : null,
    intervalLabel,
  ]
    .filter(Boolean)
    .join(" · ");
}

function getPlaybackStageStatus(
  entry: Record<string, unknown> | null,
) {
  const status = firstString(entry?.status);
  if (status === "finished" || status === "started") return "complete";
  if (status === "failed") return "blocked";
  if (status === "requested") return "warning";
  return "unavailable";
}

function formatMediaReason(
  reason: string | null,
  target: "equipment" | "boss",
): string {
  const labels: Record<string, string> = {
    periodic: "20초 간격으로 보관한 정상 감지 화면입니다.",
    "signal-start":
      target === "boss"
        ? "보스 진행 바 신호가 처음 나타난 화면입니다."
        : "가득 참 신호가 처음 나타난 화면입니다.",
    alert: "알림 조건을 충족한 화면입니다.",
    "after-event": "감지 사건 직후 화면입니다.",
    rearmed:
      target === "boss"
        ? "다음 스테이지로 넘어가 보스 알림이 다시 준비된 화면입니다."
        : "가방을 비워 다음 알림이 준비된 화면입니다.",
    "report-open-latest-runtime": "제보 창을 열기 전 마지막 정상 감지 화면입니다.",
  };
  return reason ? labels[reason] ?? reason : "보관 사유 미기록";
}
