import type { RefObject } from "react";
import type { AlertIssueReportTarget } from "../../application/reporting/alertIssueReportAvailability";
import type { AlertIssueReportGuidance } from "../../contracts/reporting/alertIssueReportGuidance";
import type {
  HuntStallRuntimeState,
  HuntStallSnapshot,
  RuneSnapshot,
  SkillSnapshot,
} from "../../alertTypes";
import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../lib/buffExpiry/buffExpiryTypes";
import type {
  BoosterExpiryRuntimeState,
  BoosterExpirySnapshot,
} from "../../lib/boosterExpiry/boosterExpiryTypes";
import type {
  SpecialCoreRuntimeState,
  SpecialCoreSnapshot,
} from "../../lib/specialCore";
import type { UltimaRaidEquipmentRuntimeState } from "../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import type { UltimaRaidEquipmentSnapshot } from "../../runtime/ultima-raid-equipment/ultimaRaidEquipmentSnapshot";
import { encodeUltimaRaidEquipmentEvidenceFrame } from "../../platform/frame-capture/ultima-raid-equipment/ultimaRaidEquipmentEvidenceCapture";
import type { AlertIssueReportContext } from "./AlertIssueReportDialog";
import { createOneRowBuffSlotReportPreflight } from "./alertIssueReportPreflight";
import type { Profile, SkillConfig, SkillRuntimeState } from "../../types";
import { sampleSkill, sampleVideoRegion } from "../../lib/capture";
import { sampleBuffSlotVideoFrame } from "../../lib/buffSlotParser/buffSlotFrameCapture";
import { createBuffExpiryPrecisionDiagnosticRoiPreview } from "../../platform/frame-capture/buff-expiry/buffExpiryPrecisionCapture";
import {
  sampleGameViewportSkill,
  sampleGameViewportVideoRegion,
} from "../../platform/frame-capture/gameViewportSampling";
import { getSkillRegionForLayout, hasUsableRegion } from "../../lib/regions";
import { getSkillBuffDurationTargetForSkill } from "../../lib/skillBuffDuration/skillBuffDurationTargets";
import type { SkillBuffDurationTarget } from "../../lib/skillBuffDuration/skillBuffDurationTargets";
import type {
  GameViewportCalibrationState,
  ResolvedGameViewport,
} from "../../contracts/geometry/frameSource";
type CaptureSize = { width: number; height: number };

export function buildIssueReportContext({
  target,
  guidance,
  profile,
  runtimeStates,
  snapshots,
  runeSnapshot,
  ultimaRaidEquipmentRuntime,
  ultimaRaidEquipmentSnapshot,
  huntStallRuntime,
  huntStallSnapshot,
  buffExpiryRuntime,
  buffExpirySnapshot,
  boosterExpiryRuntime,
  boosterExpirySnapshot,
  specialCoreRuntime,
  specialCoreSnapshot,
  stream,
  captureSize,
  videoRef,
  captureLayoutKey,
  gameLayoutKey,
  gameViewport,
  gameViewportState,
  currentLayoutKey,
}: {
  target: AlertIssueReportTarget;
  guidance: AlertIssueReportGuidance;
  profile: Profile;
  runtimeStates: Record<string, SkillRuntimeState>;
  snapshots: Record<string, SkillSnapshot>;
  runeSnapshot: RuneSnapshot | null;
  ultimaRaidEquipmentRuntime?: UltimaRaidEquipmentRuntimeState;
  ultimaRaidEquipmentSnapshot?: UltimaRaidEquipmentSnapshot | null;
  huntStallRuntime: HuntStallRuntimeState;
  huntStallSnapshot: HuntStallSnapshot | null;
  buffExpiryRuntime: BuffExpiryRuntimeState;
  buffExpirySnapshot: BuffExpirySnapshot | null;
  boosterExpiryRuntime: BoosterExpiryRuntimeState;
  boosterExpirySnapshot: BoosterExpirySnapshot | null;
  specialCoreRuntime: SpecialCoreRuntimeState;
  specialCoreSnapshot: SpecialCoreSnapshot | null;
  stream: MediaStream | null;
  captureSize: CaptureSize | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  captureLayoutKey?: string | null;
  gameLayoutKey?: string | null;
  gameViewport?: ResolvedGameViewport | null;
  gameViewportState?: GameViewportCalibrationState;
  /** @deprecated Use explicit captureLayoutKey and gameLayoutKey. */
  currentLayoutKey?: string | null;
}): AlertIssueReportContext {
  const hasStream = Boolean(stream && captureSize);
  const resolvedCaptureLayoutKey =
    captureLayoutKey ?? currentLayoutKey ?? null;
  const resolvedGameLayoutKey = gameLayoutKey ?? currentLayoutKey ?? null;
  const reportGameViewport =
    gameViewport === undefined && captureSize
      ? {
          mode: "legacy-passthrough" as const,
          sourceSize: captureSize,
          gameResolution: captureSize,
          region: {
            x: 0,
            y: 0,
            width: captureSize.width,
            height: captureSize.height,
          },
          layoutKey:
            resolvedGameLayoutKey ??
            `${captureSize.width}x${captureSize.height}`,
          revision: 0,
        }
      : gameViewport ?? null;
  const reportGameViewportState =
    gameViewportState ??
    ({
      status: "legacy-passthrough",
      revision: reportGameViewport?.revision ?? 0,
    } satisfies GameViewportCalibrationState);
  const needsGameViewportSetup =
    hasStream &&
    (!reportGameViewport || reportGameViewportState.status === "stale");
  const video = videoRef.current;

  if (target.kind === "rune") {
    const runeConfig = profile.runeAlert;
    const currentRegion = runeConfig
      ? getSkillRegionForLayout(runeConfig, resolvedCaptureLayoutKey)
      : null;
    const hasRegion = hasUsableRegion(currentRegion);

    const sampledPreviewUrl = hasRegion
      ? sampleCurrentRegionPreview(video, currentRegion, "rectangle")
      : null;

    return {
      previewUrl: sampledPreviewUrl ?? runeSnapshot?.rawPreviewUrl ?? null,
      previewLabel: "현재 선택한 미니맵 영역",
      emptyPreviewLabel: hasStream ? "미니맵 영역 대기" : "화면 공유 필요",
      statusText: getRuneIssueStatusText({
        hasStream,
        hasRegion,
        hasCandidate: Boolean(runeSnapshot?.candidatePreviewUrl),
        detected: Boolean(runeSnapshot?.detected),
      }),
      checklist: [
        "미니맵 내부 지도만 선택됐는지 확인해주세요.",
        "마을이나 이벤트 UI처럼 사냥터가 아닌 화면은 오작동할 수 있습니다.",
        "보라색 배경이나 특수한 맵 구조물이 많으면 결과가 흔들릴 수 있습니다.",
      ],
      guideVideoSrc: "/media/rune-minimap-crop-guide.mp4",
      guideVideoLabel: "미니맵 영역 선택 예시 영상",
      guideTitle: "미니맵 선택 예시",
    };
  }

  if (
    target.kind === "ultima-raid-equipment" ||
    target.kind === "ultima-raid-boss"
  ) {
    const config = profile.ultimaRaidEquipmentAlert;
    const region = config
      ? getSkillRegionForLayout(config, resolvedCaptureLayoutKey)
      : null;
    const hasRegion = hasUsableRegion(region);
    return {
      previewUrl: encodeUltimaRaidEquipmentEvidenceFrame(
        ultimaRaidEquipmentSnapshot?.previewImageData,
      ),
      previewLabel: "최근 울티마 스쿼드 감지 화면",
      emptyPreviewLabel: hasStream
        ? "울티마 스쿼드 감지 화면 대기"
        : "화면 공유 필요",
      statusText: !hasStream
        ? "화면 공유가 필요합니다."
        : !hasRegion
          ? "울티마 스쿼드 화면 영역을 먼저 선택해주세요."
          : target.kind === "ultima-raid-boss"
            ? ultimaRaidEquipmentRuntime?.boss.status === "active"
              ? "보스 등장을 감지해 알림을 처리했습니다."
              : ultimaRaidEquipmentRuntime?.boss.status === "candidate"
                ? "보스 등장 상태인지 확인 중입니다."
                : "하단 스테이지 진행도를 확인 중입니다."
            : ultimaRaidEquipmentRuntime?.status === "alerted"
              ? "장비 가방 가득 참을 감지해 알림을 처리했습니다."
              : ultimaRaidEquipmentRuntime?.status === "candidate"
                ? "장비 가방이 가득 찼는지 확인 중입니다."
                : "장비 가방 상태를 확인 중입니다.",
      checklist:
        target.kind === "ultima-raid-boss"
          ? [
              "울티마 스쿼드 화면의 바깥 테두리 전체가 선택됐는지 확인해주세요.",
              "하단 스테이지 진행도와 100% 표시가 화면에 보이는지 확인해주세요.",
              "문제가 생긴 뒤 1분 안에 제보하면 최근 보스 등장 흐름을 함께 확인할 수 있습니다.",
            ]
          : [
              "울티마 스쿼드 화면의 바깥 테두리 전체가 선택됐는지 확인해주세요.",
              "왼쪽 장비 가방과 상단 가득 참 안내가 화면에 보이는지 확인해주세요.",
              "문제가 생긴 뒤 1분 안에 제보하면 최근 감지 흐름을 함께 확인할 수 있습니다.",
            ],
      guideVideoSrc: "/media/ultima-raid-equipment-crop-guide.mp4",
      guideVideoLabel: "울티마 스쿼드 화면 영역 선택 예시 영상",
      guideTitle: "울티마 스쿼드 화면 선택 예시",
    };
  }

  if (target.kind === "hunt-stall") {
    const config = profile.huntStallAlert;
    const mode = config?.mode ?? "manual-experience";
    const isCooldownPresenceMode = mode === "cooldown-presence";
    const currentCooldownRegion =
      isCooldownPresenceMode && config
        ? getSkillRegionForLayout(
            {
              region: config.cooldownRegion,
              regionsByLayout: config.cooldownRegionsByLayout,
            },
            resolvedGameLayoutKey,
          )
        : null;
    const currentManualExperienceRegion =
      mode === "manual-experience" && config
        ? getSkillRegionForLayout(
            {
              region: config.manualExperienceRegion ?? null,
              regionsByLayout: config.manualExperienceRegionsByLayout,
            },
            resolvedGameLayoutKey,
          )
        : null;
    const sampledPreviewUrl =
      isCooldownPresenceMode && hasUsableRegion(currentCooldownRegion)
        ? sampleCurrentRegionPreview(
            video,
            currentCooldownRegion,
            "square",
            reportGameViewport,
          )
        : hasUsableRegion(currentManualExperienceRegion)
          ? sampleCurrentRegionPreview(
              video,
              currentManualExperienceRegion,
              "rectangle",
              reportGameViewport,
            )
          : null;
    const hasSnapshot = Boolean(
      huntStallSnapshot?.rawPreviewUrl && huntStallSnapshot.processedPreviewUrl,
    );

    return {
      previewUrl: needsGameViewportSetup
        ? null
        : sampledPreviewUrl ?? huntStallSnapshot?.rawPreviewUrl ?? null,
      previewLabel:
        isCooldownPresenceMode
          ? "현재 쿨타임 숫자 감시 영역"
          : "현재 경험치바 감시 영역",
      emptyPreviewLabel:
        isCooldownPresenceMode
          ? hasStream
            ? "쿨타임 숫자 영역 대기"
            : "화면 공유 필요"
          : hasStream
            ? "경험치바 영역 대기"
            : "화면 공유 필요",
      statusText: needsGameViewportSetup
        ? "게임 영역을 먼저 설정해주세요."
        : getHuntStallIssueStatusText({
            hasStream,
            hasSnapshot: hasSnapshot || Boolean(sampledPreviewUrl),
            mode,
            status: huntStallRuntime.status,
          }),
      checklist: isCooldownPresenceMode
        ? guidance.getHuntStallCooldownPresenceChecklist()
        : guidance.getHuntStallManualExperienceChecklist(),
      guideVideoSrc: isCooldownPresenceMode
        ? "/media/quickslot-crop-guide.mp4"
        : "/media/manual-experience-band-guide.mp4",
      guideVideoLabel: isCooldownPresenceMode
        ? "쿨타임 아이콘 영역 선택 예시 영상"
        : "경험치바 높이 선택 예시 영상",
      guideTitle: isCooldownPresenceMode ? "쿨타임 아이콘 선택 예시" : "경험치바 선택 예시",
    };
  }

  if (target.kind === "buff-expiry") {
    const sampledPreviewUrl =
      hasStream && reportGameViewport
        ? sampleBuffExpiryRoiPreview(video, reportGameViewport)
        : null;
    const hasSnapshot = Boolean(sampledPreviewUrl ?? buffExpirySnapshot?.rawPreviewUrl);

    return {
      previewUrl: needsGameViewportSetup
        ? null
        : sampledPreviewUrl ?? buffExpirySnapshot?.rawPreviewUrl ?? null,
      previewLabel: "현재 우상단 버프 감지 영역",
      emptyPreviewLabel: hasStream ? "버프 감지 대기" : "화면 공유 필요",
      statusText: needsGameViewportSetup
        ? "게임 영역을 먼저 설정해주세요."
        : getBuffExpiryIssueStatusText({
            hasStream,
            hasSnapshot,
            status: buffExpiryRuntime.status,
          }),
      checklist: getBuffExpiryReportChecklist(),
      guideVideoSrc: "",
      guideVideoLabel: "버프 종료 감지 제보",
      guideTitle: "버프 종료 감지 제보",
      preflight: createOneRowBuffSlotReportPreflight({
        boxes: buffExpirySnapshot?.boxes ?? null,
      }),
    };
  }

  if (target.kind === "booster-expiry") {
    const hasSnapshot = Boolean(boosterExpirySnapshot?.rawPreviewUrl);

    return {
      previewUrl: needsGameViewportSetup
        ? null
        : boosterExpirySnapshot?.timerPreviewUrl ??
          boosterExpirySnapshot?.rawPreviewUrl ??
          null,
      previewLabel: "현재 부스터 타이머 감지 영역",
      emptyPreviewLabel: hasStream ? "부스터 타이머 감지 대기" : "화면 공유 필요",
      statusText: needsGameViewportSetup
        ? "게임 영역을 먼저 설정해주세요."
        : getBoosterExpiryIssueStatusText({
            hasStream,
            hasSnapshot,
            status: boosterExpiryRuntime.status,
          }),
      checklist: [
        "화면 중상단 타이머가 보이는지 확인해주세요.",
        "타이머가 UI에 가려지지 않는지 확인해주세요.",
        "판독값과 흐름 정보 전송을 확인해주세요.",
      ],
      guideVideoSrc: "",
      guideVideoLabel: "부스터 종료 감지 제보",
      guideTitle: "부스터 종료 감지 제보",
    };
  }

  if (target.kind === "special-core") {
    const sampledPreviewUrl =
      hasStream && reportGameViewport
        ? sampleBuffSlotPreview(video, reportGameViewport)
        : null;
    const hasSnapshot = Boolean(sampledPreviewUrl ?? specialCoreSnapshot);

    return {
      previewUrl: needsGameViewportSetup ? null : sampledPreviewUrl,
      previewLabel: "현재 우상단 버프칸 분석 화면",
      emptyPreviewLabel: hasStream ? "버프칸 분석 화면 대기" : "화면 공유 필요",
      statusText: needsGameViewportSetup
        ? "게임 영역을 먼저 설정해주세요."
        : getSpecialCoreIssueStatusText({
            hasStream,
            hasSnapshot,
            status: specialCoreRuntime.status,
          }),
      checklist: getSpecialCoreReportChecklist(),
      guideVideoSrc: "",
      guideVideoLabel: "특수코어 감지 제보",
      guideTitle: "특수코어 감지 제보",
    };
  }

  const skill = profile.skills.find((item) => item.id === target.skillId);
  const state = runtimeStates[target.skillId];
  const snapshot = snapshots[target.skillId];
  const currentRegion = skill
    ? getSkillRegionForLayout(skill, resolvedGameLayoutKey)
    : null;
  const hasRegion = hasUsableRegion(currentRegion);
  const buffDurationTarget = skill ? getSkillBuffDurationTargetForSkill(skill) : null;
  const isBuffDurationDetection = Boolean(buffDurationTarget);
  const sampledBuffSlotPreviewUrl =
    isBuffDurationDetection && reportGameViewport
      ? sampleBuffSlotPreview(video, reportGameViewport)
      : null;
  const sampledPreviewUrl = !isBuffDurationDetection && hasRegion
    ? sampleCurrentRegionPreview(
        video,
        currentRegion,
        "square",
        reportGameViewport,
      )
    : null;

  if (isBuffDurationDetection) {
    return {
      previewUrl: needsGameViewportSetup
        ? null
        : sampledBuffSlotPreviewUrl ??
          snapshot?.rawPreviewUrl ??
          snapshot?.previewUrl ??
          null,
      previewLabel: "현재 우상단 버프칸 분석 화면",
      emptyPreviewLabel: hasStream ? "버프칸 분석 화면 대기" : "화면 공유 필요",
      statusText: needsGameViewportSetup
        ? "게임 영역을 먼저 설정해주세요."
        : getSkillBuffDurationIssueStatusText({
            hasStream,
            hasSnapshot: Boolean(
              sampledBuffSlotPreviewUrl ??
                snapshot?.rawPreviewUrl ??
                snapshot?.previewUrl,
            ),
            detected: Boolean(snapshot?.buffDuration?.detected),
            targetName: buffDurationTarget?.shortName ?? "버프칸 스킬",
          }),
      checklist: guidance.getSkillBuffDurationChecklist(
        buffDurationTarget?.shortName ?? "버프칸 스킬",
        buffDurationTarget?.valueKind === "remaining-count" ? "남은 횟수가" : "시간이",
      ),
      guideVideoSrc: getSkillBuffDurationReportGuideVideoSrc(buffDurationTarget),
      guideVideoLabel: "버프 즐겨찾기 설정 예시 영상",
      guideTitle: "버프 즐겨찾기 확인",
      preflight: createOneRowBuffSlotReportPreflight({
        boxCount: snapshot?.buffDuration?.boxCount ?? null,
        rowCount: snapshot?.buffDuration?.parserRowCount ?? null,
      }),
    };
  }

  return {
    previewUrl: needsGameViewportSetup
      ? null
      : sampledPreviewUrl ?? snapshot?.rawPreviewUrl ?? null,
    previewLabel: "현재 선택한 스킬 영역",
    emptyPreviewLabel: hasStream ? "스킬 영역 대기" : "화면 공유 필요",
    statusText: needsGameViewportSetup
      ? "게임 영역을 먼저 설정해주세요."
      : getSkillIssueStatusText({
          hasStream,
          hasRegion,
          hasValue:
            snapshot?.result.value !== null &&
            snapshot?.result.value !== undefined,
          status: state?.status ?? "detecting",
        }),
    checklist: guidance.getSkillQuickslotChecklist(),
    guideVideoSrc: "/media/quickslot-crop-guide.mp4",
    guideVideoLabel: "퀵슬롯 스킬 아이콘 영역 선택 예시 영상",
    guideTitle: "퀵슬롯 선택 예시",
  };
}

export function getFallbackIssueReportContext(
  target: AlertIssueReportTarget,
  guidance: AlertIssueReportGuidance,
): AlertIssueReportContext {
  if (target.kind === "rune") {
    return {
      previewUrl: null,
      previewLabel: "현재 선택한 미니맵 영역",
      emptyPreviewLabel: "미니맵 영역 대기",
      statusText: "아직 룬 후보를 찾지 못했습니다.",
      checklist: [
        "미니맵 내부 지도만 선택됐는지 확인해주세요.",
        "마을이나 이벤트 UI처럼 사냥터가 아닌 화면은 오작동할 수 있습니다.",
        "보라색 배경이나 특수한 맵 구조물이 많으면 결과가 흔들릴 수 있습니다.",
      ],
      guideVideoSrc: "/media/rune-minimap-crop-guide.mp4",
      guideVideoLabel: "미니맵 영역 선택 예시 영상",
      guideTitle: "미니맵 선택 예시",
    };
  }

  if (
    target.kind === "ultima-raid-equipment" ||
    target.kind === "ultima-raid-boss"
  ) {
    return {
      previewUrl: null,
      previewLabel: "최근 울티마 스쿼드 감지 화면",
      emptyPreviewLabel: "울티마 스쿼드 감지 화면 대기",
      statusText:
        target.kind === "ultima-raid-boss"
          ? "제보 시 최근 1분의 보스 등장 감지 흐름을 함께 보냅니다."
          : "제보 시 최근 1분의 장비 가방 감지 흐름을 함께 보냅니다.",
      checklist:
        target.kind === "ultima-raid-boss"
          ? [
              "울티마 스쿼드 화면의 바깥 테두리 전체가 선택됐는지 확인해주세요.",
              "하단 스테이지 진행도와 100% 표시가 화면에 보이는지 확인해주세요.",
              "문제가 생긴 뒤 1분 안에 제보하면 최근 보스 등장 흐름을 함께 확인할 수 있습니다.",
            ]
          : [
              "울티마 스쿼드 화면의 바깥 테두리 전체가 선택됐는지 확인해주세요.",
              "왼쪽 장비 가방과 상단 가득 참 안내가 화면에 보이는지 확인해주세요.",
              "문제가 생긴 뒤 1분 안에 제보하면 최근 감지 흐름을 함께 확인할 수 있습니다.",
            ],
      guideVideoSrc: "/media/ultima-raid-equipment-crop-guide.mp4",
      guideVideoLabel: "울티마 스쿼드 화면 영역 선택 예시 영상",
      guideTitle: "울티마 스쿼드 화면 선택 예시",
    };
  }

  if (target.kind === "hunt-stall") {
    return {
      previewUrl: null,
      previewLabel: "현재 사냥 멈춤 감지 영역",
      emptyPreviewLabel: "감지 대기",
      statusText: "제보 시 현재 설정된 감시 방식으로 화면을 다시 판독합니다.",
      checklist: guidance.getHuntStallManualExperienceChecklist(),
      guideVideoSrc: "/media/manual-experience-band-guide.mp4",
      guideVideoLabel: "경험치바 높이 선택 예시 영상",
      guideTitle: "경험치바 선택 예시",
    };
  }

  if (target.kind === "buff-expiry") {
    return {
      previewUrl: null,
      previewLabel: "현재 우상단 버프 감지 영역",
      emptyPreviewLabel: "버프 감지 대기",
      statusText: "제보 시 최근 버프 감지 상태를 함께 보냅니다.",
      checklist: getBuffExpiryReportChecklist(),
      guideVideoSrc: "",
      guideVideoLabel: "버프 종료 감지 제보",
      guideTitle: "버프 종료 감지 제보",
    };
  }

  if (target.kind === "booster-expiry") {
    return {
      previewUrl: null,
      previewLabel: "현재 부스터 타이머 감지 영역",
      emptyPreviewLabel: "부스터 타이머 감지 대기",
      statusText: "제보 시 최근 부스터 타이머 감지 상태를 함께 보냅니다.",
      checklist: [
        "화면 중상단 타이머가 보이는지 확인해주세요.",
        "타이머가 UI에 가려지지 않는지 확인해주세요.",
        "판독값과 흐름 정보 전송을 확인해주세요.",
      ],
      guideVideoSrc: "",
      guideVideoLabel: "부스터 종료 감지 제보",
      guideTitle: "부스터 종료 감지 제보",
    };
  }

  if (target.kind === "special-core") {
    return {
      previewUrl: null,
      previewLabel: "현재 우상단 버프칸 분석 화면",
      emptyPreviewLabel: "버프칸 분석 화면 대기",
      statusText: "제보 시 최근 특수코어 감지 상태를 함께 보냅니다.",
      checklist: getSpecialCoreReportChecklist(),
      guideVideoSrc: "",
      guideVideoLabel: "특수코어 감지 제보",
      guideTitle: "특수코어 감지 제보",
    };
  }

  return {
    previewUrl: null,
    previewLabel: "현재 선택한 스킬 영역",
    emptyPreviewLabel: "스킬 영역 대기",
    statusText: "아직 숫자를 찾지 못했습니다.",
    checklist: guidance.getSkillQuickslotChecklist(),
    guideVideoSrc: "/media/quickslot-crop-guide.mp4",
    guideVideoLabel: "퀵슬롯 스킬 아이콘 영역 선택 예시 영상",
    guideTitle: "퀵슬롯 선택 예시",
  };
}

function getBuffExpiryReportChecklist(): string[] {
  return [
    "우상단 버프칸이 보이는지 확인해주세요.",
    "버프 시간 표시가 [분+초]인지 확인해주세요.",
    "버프 정렬 옵션이 켜져 있는지 확인해주세요.",
    "버프칸이 UI에 가려지지 않는지 확인해주세요.",
  ];
}

function getSpecialCoreReportChecklist(): string[] {
  return [
    "우상단 버프칸이 보이는지 확인해주세요.",
    "특수코어가 실제로 발동한 상황인지 확인해주세요.",
    "버프칸이 UI에 가려지지 않는지 확인해주세요.",
  ];
}

function getSkillBuffDurationReportGuideVideoSrc(
  target: SkillBuffDurationTarget | null,
): string {
  if (target?.skillId === "fountainDeepV2") {
    return "/media/erda-fountain-buff-duration-settings-guide.mp4";
  }
  if (target?.skillId === "maehwaYeinDeepV1") {
    return "/media/maehwa-yein-buff-duration-settings-guide.mp4";
  }
  return "/media/janus-buff-duration-settings-guide.mp4";
}

function getHuntStallIssueStatusText({
  hasStream,
  hasSnapshot,
  mode,
  status,
}: {
  hasStream: boolean;
  hasSnapshot: boolean;
  mode: "manual-experience" | "cooldown-presence";
  status: HuntStallRuntimeState["status"];
}): string {
  if (!hasStream) {
    return "화면 공유가 필요합니다.";
  }
  if (status === "paused") {
    return "현재 알림이 꺼져 있습니다.";
  }
  if (status === "no-region") {
    return mode === "manual-experience"
      ? "경험치바 높이를 먼저 선택해야 합니다."
      : "쿨타임 숫자 영역을 먼저 선택해야 합니다.";
  }
  if (hasSnapshot) {
    return mode === "cooldown-presence"
      ? "쿨타임 숫자 영역과 상태를 함께 보낼 수 있습니다."
      : "경험치바 영역과 상태를 함께 보낼 수 있습니다.";
  }
  return mode === "cooldown-presence"
      ? "제보 시 현재 화면에서 쿨타임 숫자 영역을 다시 판독합니다."
      : "제보 시 현재 화면에서 경험치바 영역을 다시 판독합니다.";
}

function getBuffExpiryIssueStatusText({
  hasStream,
  hasSnapshot,
  status,
}: {
  hasStream: boolean;
  hasSnapshot: boolean;
  status: BuffExpiryRuntimeState["status"];
}): string {
  if (!hasStream) {
    return "화면 공유가 필요합니다.";
  }
  if (status === "paused") {
    return "버프 종료 알림이 꺼져 있습니다.";
  }
  if (status === "unsupported") {
    return "현재 해상도에서는 버프칸 위치를 확정하지 못했습니다.";
  }
  if (hasSnapshot) {
    return "버프칸 감지 결과와 추적 상태를 함께 보낼 수 있습니다.";
  }
  return "지원 버프의 남은 시간을 찾는 중입니다.";
}

function getBoosterExpiryIssueStatusText({
  hasStream,
  hasSnapshot,
  status,
}: {
  hasStream: boolean;
  hasSnapshot: boolean;
  status: BoosterExpiryRuntimeState["status"];
}): string {
  if (!hasStream) {
    return "화면 공유가 필요합니다.";
  }
  if (status === "paused") {
    return "부스터 종료 알림이 꺼져 있습니다.";
  }
  if (hasSnapshot) {
    return "부스터 타이머 판독 결과와 흐름 보정 상태를 함께 보낼 수 있습니다.";
  }
  return "화면 중상단에서 부스터 타이머를 찾는 중입니다.";
}

function getSpecialCoreIssueStatusText({
  hasStream,
  hasSnapshot,
  status,
}: {
  hasStream: boolean;
  hasSnapshot: boolean;
  status: SpecialCoreRuntimeState["status"];
}): string {
  if (!hasStream) {
    return "화면 공유가 필요합니다.";
  }
  if (status === "idle") {
    return "특수 코어 알림이 꺼져 있습니다.";
  }
  if (status === "unavailable") {
    return "현재 화면에서는 특수코어 감지를 완료하지 못했습니다.";
  }
  if (hasSnapshot) {
    return "버프칸 분석 화면과 특수코어 후보 상태를 함께 보낼 수 있습니다.";
  }
  return "버프칸에서 특수코어 발동을 찾는 중입니다.";
}

function sampleCurrentRegionPreview(
  video: HTMLVideoElement | null,
  region: SkillConfig["region"],
  shape: "square" | "rectangle",
  gameViewport?: ResolvedGameViewport | null,
): string | null {
  if (
    !video ||
    !hasUsableRegion(region) ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    !video.videoWidth ||
    !video.videoHeight
  ) {
    return null;
  }

  try {
    const sample =
      gameViewport
        ? shape === "rectangle"
          ? sampleGameViewportVideoRegion(
              video,
              gameViewport,
              region,
              true,
              420,
            )
          : sampleGameViewportSkill(video, gameViewport, region, true)
        : shape === "rectangle"
          ? sampleVideoRegion(video, region, true, 420)
          : sampleSkill(video, region, true);
    return sample.rawPreviewUrl;
  } catch {
    return null;
  }
}

function sampleBuffSlotPreview(
  video: HTMLVideoElement | null,
  gameViewport: ResolvedGameViewport,
): string | null {
  if (
    !video ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    !video.videoWidth ||
    !video.videoHeight
  ) {
    return null;
  }

  try {
    return sampleBuffSlotVideoFrame(video, {
      sourceRegion:
        gameViewport.mode === "calibrated"
          ? gameViewport.region
          : undefined,
    }).rawPreviewUrl;
  } catch {
    return null;
  }
}

function sampleBuffExpiryRoiPreview(
  video: HTMLVideoElement | null,
  gameViewport: ResolvedGameViewport,
): string | null {
  if (
    !video ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    !video.videoWidth ||
    !video.videoHeight
  ) {
    return null;
  }

  try {
    return (
      gameViewport.mode === "calibrated"
        ? createBuffExpiryPrecisionDiagnosticRoiPreview(
            video,
            0.82,
            gameViewport.region,
          )
        : createBuffExpiryPrecisionDiagnosticRoiPreview(video)
    ).imageDataUrl;
  } catch {
    return null;
  }
}

function getSkillBuffDurationIssueStatusText({
  hasStream,
  hasSnapshot,
  detected,
  targetName,
}: {
  hasStream: boolean;
  hasSnapshot: boolean;
  detected: boolean;
  targetName: string;
}): string {
  if (!hasStream) {
    return "화면 공유가 필요합니다.";
  }
  if (detected) {
    return `버프칸에서 ${targetName} 아이콘을 확인한 상태입니다.`;
  }
  if (hasSnapshot) {
    return "버프칸 분석 화면과 후보 상태를 함께 보낼 수 있습니다.";
  }
  return `버프칸에서 ${targetName} 아이콘을 찾는 중입니다.`;
}

function getSkillIssueStatusText({
  hasStream,
  hasRegion,
  hasValue,
  status,
}: {
  hasStream: boolean;
  hasRegion: boolean;
  hasValue: boolean;
  status: SkillRuntimeState["status"];
}): string {
  if (!hasStream) {
    return "화면 공유가 필요합니다.";
  }
  if (!hasRegion) {
    return "스킬 영역을 먼저 선택해주세요.";
  }
  if (status === "paused") {
    return "현재 알림이 꺼져 있습니다.";
  }
  if (status === "alerted") {
    return "알림이 이미 한 번 울린 상태입니다.";
  }
  if (hasValue) {
    return "숫자를 읽고 알림 시간을 계산 중입니다.";
  }
  return "아직 숫자를 찾지 못했습니다.";
}

function getRuneIssueStatusText({
  hasStream,
  hasRegion,
  hasCandidate,
  detected,
}: {
  hasStream: boolean;
  hasRegion: boolean;
  hasCandidate: boolean;
  detected: boolean;
}): string {
  if (!hasStream) {
    return "화면 공유가 필요합니다.";
  }
  if (!hasRegion) {
    return "미니맵 영역을 먼저 선택해주세요.";
  }
  if (detected) {
    return "최근 룬 후보를 감지한 상태입니다.";
  }
  if (hasCandidate) {
    return "룬 후보처럼 보이는 부분을 확인 중입니다.";
  }
  return "아직 룬 후보를 찾지 못했습니다.";
}
