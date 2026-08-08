import { detectUltimaRaidInventoryFull } from "../../../../../recognition/ultima-raid-equipment/inventoryFullDetector";
import { detectUltimaRaidBossEncounter } from "../../../../../recognition/ultima-raid-equipment/bossEncounterDetector";
import {
  createUltimaRaidEquipmentRuntimeState,
  updateUltimaRaidEquipmentRuntimeState,
} from "../../../../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import {
  createUltimaRaidBossRuntimeState,
  updateUltimaRaidBossRuntimeState,
} from "../../../../../runtime/ultima-raid-equipment/ultimaRaidBossAlertState";
import { formatConfidence } from "../../model/sample";
import { metric } from "../../model/shared";
import {
  buildRecognitionResult,
  recognitionStage,
  type RecognitionContext,
} from "../helpers";

export async function runUltimaRaidEquipmentRecognition(
  context: RecognitionContext,
) {
  if (context.view.modeLabel.includes("보스")) {
    return runUltimaRaidBossRecognition(context);
  }

  const frames = context.sequenceFrames ?? [
    {
      imageData: context.imageData,
      sampledAt: Date.now(),
      label: "선택 화면",
      src: "",
    },
  ];
  let state = createUltimaRaidEquipmentRuntimeState();
  let shouldAlert = false;
  const results = frames.map((frame) => {
    const detection = detectUltimaRaidInventoryFull(frame.imageData);
    const update = updateUltimaRaidEquipmentRuntimeState({
      previous: state,
      detection,
      now: frame.sampledAt,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    state = update.state;
    shouldAlert ||= update.shouldAlert;
    return { frame, detection, shouldAlert: update.shouldAlert };
  });
  const last = results[results.length - 1];
  const detectedCount = results.filter(
    (entry) => entry.detection.detected,
  ).length;
  const bagSignalCount = results.filter(
    (entry) => entry.detection.bagFullDetected,
  ).length;
  const bannerSignalCount = results.filter(
    (entry) => entry.detection.fullBannerDetected,
  ).length;
  const unreadableCount = results.filter(
    (entry) => entry.detection.bagCountState === "unreadable",
  ).length;
  const isSequence = results.length > 1;

  return buildRecognitionResult({
    tone: shouldAlert
      ? "positive"
      : last.detection.detected
        ? "warning"
        : "info",
    title: shouldAlert
      ? "현재 코드도 알림 조건을 충족함"
      : last.detection.detected
        ? "현재 감지기는 인식했지만 알림 조건은 미충족"
        : "현재 감지기는 가방 가득 참을 인식하지 않음",
    detail: isSequence
      ? `${results.length}개 저장 화면을 시간순으로 현재 감지기와 3프레임 확정 로직에 다시 넣었습니다. 오디오는 재생하지 않습니다.`
      : "현재 감지기의 한 프레임 판정입니다. 저장 이미지가 한 장뿐이면 당시 3프레임 확정과 오디오 재생은 재현할 수 없습니다.",
    startedAt: context.startedAt,
    metrics: [
      metric(
        "ultima-current-detected",
        "현재 감지",
        `${detectedCount}/${results.length}개`,
      ),
      metric(
        "ultima-current-confidence",
        "마지막 신뢰도",
        formatConfidence(last.detection.confidence),
      ),
      metric(
        "ultima-current-bag-signal",
        "가방 숫자 신호",
        `${bagSignalCount}/${results.length}개`,
      ),
      metric(
        "ultima-current-bag-unreadable",
        "숫자 판독 불가",
        `${unreadableCount}/${results.length}개`,
      ),
      metric(
        "ultima-current-bag-state",
        "마지막 숫자 상태",
        formatBagCountState(last.detection.bagCountState),
      ),
      metric(
        "ultima-current-banner-signal",
        "상단 안내 신호",
        `${bannerSignalCount}/${results.length}개`,
      ),
      metric(
        "ultima-current-source",
        "판정 방식",
        last.detection.source,
      ),
      metric(
        "ultima-current-alert",
        "알림 조건",
        shouldAlert ? "충족" : "미충족",
      ),
      metric(
        "ultima-current-detector",
        "현재 감지기",
        last.detection.detectorVersion,
      ),
    ],
    stages: [
      recognitionStage(
        "ultima-layout",
        "선택 영역 확인",
        last.detection.layoutValid,
        last.detection.layoutValid ? "유효한 화면 비율" : "화면 비율 확인 필요",
        "울티마 스쿼드 화면 전체를 선택했는지 확인합니다.",
      ),
      recognitionStage(
        "ultima-detection",
        "가방 가득 참 판정",
        detectedCount > 0,
        `${detectedCount}/${results.length}개 감지`,
        "왼쪽 장비 가방 수량 색과 상단 가득 참 안내를 확인합니다.",
        "warning",
      ),
      recognitionStage(
        "ultima-confirmation",
        "연속 감지 확인",
        shouldAlert,
        shouldAlert ? "알림 조건 충족" : "알림 조건 미충족",
        isSequence
          ? "운영과 같은 최근 3프레임 확정 규칙을 적용했습니다."
          : "한 장만 저장되어 운영 당시 연속 흐름 전체는 확인할 수 없습니다.",
        isSequence ? "warning" : "unavailable",
      ),
    ],
    evidence: isSequence
      ? results.map((entry, index) => ({
          id: `current-ultima-raid-equipment-${index + 1}`,
          label: `${entry.frame.label} · ${entry.detection.detected ? "감지" : "미감지"}`,
          description: `숫자 ${formatBagCountState(entry.detection.bagCountState)} · 신뢰도 ${formatConfidence(entry.detection.confidence)} · ${entry.detection.source}`,
          src: entry.frame.src,
        }))
      : [],
  });
}

function formatBagCountState(
  state: "full" | "clear" | "unreadable",
): string {
  if (state === "full") return "가득 참";
  if (state === "clear") return "여유 있음";
  return "판독 불가";
}

async function runUltimaRaidBossRecognition(context: RecognitionContext) {
  const frames = context.sequenceFrames ?? [
    {
      imageData: context.imageData,
      sampledAt: Date.now(),
      label: "선택 화면",
      src: "",
    },
  ];
  let state = createUltimaRaidBossRuntimeState();
  let shouldAlert = false;
  const results = frames.map((frame) => {
    const detection = detectUltimaRaidBossEncounter(frame.imageData);
    const update = updateUltimaRaidBossRuntimeState({
      previous: state,
      detection,
      now: frame.sampledAt,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    state = update.state;
    shouldAlert ||= update.shouldAlert;
    return { frame, detection, shouldAlert: update.shouldAlert };
  });
  const last = results[results.length - 1];
  const bossCount = results.filter(
    (entry) => entry.detection.progressState === "boss",
  ).length;
  const normalCount = results.filter(
    (entry) => entry.detection.progressState === "normal",
  ).length;
  const isSequence = results.length > 1;

  return buildRecognitionResult({
    tone: shouldAlert
      ? "positive"
      : last.detection.progressState === "boss"
        ? "warning"
        : "info",
    title: shouldAlert
      ? "현재 코드도 보스 등장 알림 조건을 충족함"
      : last.detection.progressState === "boss"
        ? "현재 감지기는 보스 진행 바를 찾았지만 알림 조건은 미충족"
        : "현재 감지기는 보스 등장 진행 바를 인식하지 않음",
    detail: isSequence
      ? `${results.length}개 저장 화면을 시간순으로 현재 감지기와 보스 등장 확정 로직에 다시 넣었습니다. 오디오는 재생하지 않습니다.`
      : "현재 감지기의 한 프레임 판정입니다. 보스 진행 바를 연속 확인해야 하므로 한 장만으로 당시 알림 여부를 재현할 수 없습니다.",
    startedAt: context.startedAt,
    metrics: [
      metric(
        "ultima-current-boss",
        "보스 진행 바",
        `${bossCount}/${results.length}개`,
      ),
      metric(
        "ultima-current-normal-progress",
        "일반 진행 바",
        `${normalCount}/${results.length}개`,
      ),
      metric(
        "ultima-current-boss-width",
        "마지막 보스 바 너비",
        formatConfidence(last.detection.bossBarWidthRatio),
      ),
      metric(
        "ultima-current-boss-fill",
        "마지막 보스 바 채움",
        formatConfidence(last.detection.bossBarFillRatio),
      ),
      metric(
        "ultima-current-boss-alert",
        "알림 조건",
        shouldAlert ? "충족" : "미충족",
      ),
      metric(
        "ultima-current-boss-detector",
        "현재 감지기",
        last.detection.detectorVersion,
      ),
    ],
    stages: [
      recognitionStage(
        "ultima-layout",
        "선택 영역 확인",
        last.detection.layoutValid,
        last.detection.layoutValid ? "유효한 화면 비율" : "화면 비율 확인 필요",
        "울티마 스쿼드 화면 전체를 선택했는지 확인합니다.",
      ),
      recognitionStage(
        "ultima-boss-detection",
        "보스 진행도 판정",
        bossCount > 0,
        `${bossCount}/${results.length}개 보스 상태`,
        "하단 진행 바가 100%의 자홍색 보스 상태로 바뀌었는지 확인합니다.",
        "warning",
      ),
      recognitionStage(
        "ultima-boss-confirmation",
        "등장 전환 확인",
        shouldAlert,
        shouldAlert ? "알림 조건 충족" : "알림 조건 미충족",
        isSequence
          ? "최근 3프레임 중 보스 진행 바 2회를 확인합니다. 일반 진행 바는 다음 보스 알림을 준비할 때 사용합니다."
          : "한 장만 저장되어 보스 등장 전환 흐름 전체는 확인할 수 없습니다.",
        isSequence ? "warning" : "unavailable",
      ),
    ],
    evidence: isSequence
      ? results.map((entry, index) => ({
          id: `current-ultima-raid-boss-${index + 1}`,
          label: `${entry.frame.label} · ${entry.detection.progressState}`,
          description: `보스 바 너비 ${formatConfidence(entry.detection.bossBarWidthRatio)} · 채움 ${formatConfidence(entry.detection.bossBarFillRatio)}`,
          src: entry.frame.src,
        }))
      : [],
  });
}
