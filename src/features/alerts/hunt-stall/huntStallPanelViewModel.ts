import type {
  HuntStallRuntimeState,
  HuntStallRuntimeStatus,
  HuntStallSnapshot,
  RgbaImageSnapshot,
} from "../../../alertTypes";
import {
  getSkillRegionForLayout,
  hasAnySkillRegion,
  hasUsableRegion,
} from "../../../lib/regions";
import type { HuntStallAlertConfig } from "../../../types";
import {
  getHuntStallStatusView,
  isTrustedCooldownReadingDecision,
  normalizeHuntStallCooldownText,
} from "./huntStallUtils";

export type HuntStallPanelViewModel = {
  mode: HuntStallAlertConfig["mode"];
  isCooldownPresenceMode: boolean;
  isManualExperienceMode: boolean;
  usesManualCrop: boolean;
  displayStatus: HuntStallRuntimeStatus;
  statusView: ReturnType<typeof getHuntStallStatusView>;
  hasCurrentCooldownRegion: boolean;
  hasCurrentManualExperienceRegion: boolean;
  cooldownCropLabel: string;
  manualExperienceCropLabel: string;
  cropLabel: string;
  thresholdValue: number;
  thresholdAriaLabel: string;
  thresholdRangeHint: string;
  thresholdMin: number;
  thresholdMax: number;
  editorColSpan: number;
  lastActivityLabel: string;
  lastActivityAt: number | null;
  lastActivityNow: number;
  cooldownValueLabel: string;
  cooldownPreviewUrl: string | null;
  cooldownPreviewImageData: RgbaImageSnapshot | null;
  manualExperiencePreviewUrl: string | null;
  manualExperiencePreviewImageData: RgbaImageSnapshot | null;
  cooldownStatusDetail: string;
  manualExperienceStatusDetail: string;
};

export function getHuntStallPanelViewModel({
  config,
  state,
  snapshot,
  hasStream,
  isGameViewportReady = true,
  currentLayoutKey,
  now = Date.now(),
}: {
  config: HuntStallAlertConfig;
  state: HuntStallRuntimeState;
  snapshot: HuntStallSnapshot | null;
  hasStream: boolean;
  isGameViewportReady?: boolean;
  currentLayoutKey: string | null;
  now?: number;
}): HuntStallPanelViewModel {
  const mode = config.mode;
  const isCooldownPresenceMode = mode === "cooldown-presence";
  const isManualExperienceMode = mode === "manual-experience";
  const usesManualCrop = isCooldownPresenceMode || isManualExperienceMode;
  const currentCooldownRegion = getSkillRegionForLayout(
    {
      region: config.cooldownRegion,
      regionsByLayout: config.cooldownRegionsByLayout,
    },
    currentLayoutKey,
  );
  const hasCurrentCooldownRegion = hasUsableRegion(currentCooldownRegion);
  const currentManualExperienceRegion = getSkillRegionForLayout(
    {
      region: config.manualExperienceRegion ?? null,
      regionsByLayout: config.manualExperienceRegionsByLayout,
    },
    currentLayoutKey,
  );
  const hasCurrentManualExperienceRegion = hasUsableRegion(currentManualExperienceRegion);
  const hasSavedOtherLayoutManualExperienceRegion =
    !hasCurrentManualExperienceRegion &&
    Boolean(currentLayoutKey) &&
    hasAnySkillRegion({
      region: config.manualExperienceRegion ?? null,
      regionsByLayout: config.manualExperienceRegionsByLayout,
    });
  const hasSavedOtherLayoutCooldownRegion =
    !hasCurrentCooldownRegion &&
    Boolean(currentLayoutKey) &&
    hasAnySkillRegion({
      region: config.cooldownRegion,
      regionsByLayout: config.cooldownRegionsByLayout,
    });
  const needsGameViewport = config.enabled && hasStream && !isGameViewportReady;
  const displayStatus: HuntStallRuntimeStatus = !config.enabled
    ? "paused"
    : !hasStream
      ? "no-stream"
      : needsGameViewport
        ? "no-region"
      : isCooldownPresenceMode && !hasCurrentCooldownRegion
        ? "no-region"
      : isManualExperienceMode && !hasCurrentManualExperienceRegion
        ? "no-region"
        : state.status;
  const statusView = needsGameViewport
    ? {
        label: "게임 영역 설정 필요",
        detail: "화면 공유 메뉴에서 설정",
        className: "warning",
      }
    : getHuntStallStatusView(displayStatus, state, mode);
  const cooldownCropLabel = !hasStream
    ? "화면 공유 필요"
    : needsGameViewport
      ? "게임 영역 설정 필요"
    : hasCurrentCooldownRegion
      ? "쿨타임 확인"
      : hasSavedOtherLayoutCooldownRegion
        ? "쿨타임 영역 다시 선택"
        : "쿨타임 영역 선택";
  const manualExperienceCropLabel = !hasStream
    ? "화면 공유 필요"
    : needsGameViewport
      ? "게임 영역 설정 필요"
    : hasCurrentManualExperienceRegion
      ? "경험치바 확인"
      : hasSavedOtherLayoutManualExperienceRegion
        ? "다시 선택 필요"
        : "영역 선택";
  const cropLabel = isCooldownPresenceMode ? cooldownCropLabel : manualExperienceCropLabel;
  const thresholdValue = isCooldownPresenceMode
    ? config.cooldownMissingThresholdSeconds
    : config.stallThresholdSeconds;
  const thresholdAriaLabel = isCooldownPresenceMode
    ? "쿨타임 변화 없음 멈춤 기준"
    : "사냥 멈춤 기준";
  const thresholdRangeHint = isCooldownPresenceMode ? "1-60초" : "5-120초";
  const thresholdMin = isCooldownPresenceMode ? 1 : 5;
  const thresholdMax = isCooldownPresenceMode ? 60 : 120;
  const editorColSpan = 8;
  const lastActivityLabel = isCooldownPresenceMode
    ? "마지막 변화"
    : "마지막 경험치 변화";
  const lastActivityAt = isCooldownPresenceMode
    ? state.hasObservedCooldownPresence
      ? state.lastChangedAt
      : null
    : state.hasObservedExperienceChange || state.alertedAt !== null
      ? state.lastChangedAt
      : null;
  const lastActivityNow =
    lastActivityAt !== null && state.unreadableSinceAt === null
      ? now
      : state.lastSampledAt ?? now;
  const cooldownSnapshotText =
    snapshot?.mode === "cooldown-presence"
      ? normalizeHuntStallCooldownText(snapshot.recognizedText)
      : null;
  const isTrustedCooldownReading = isTrustedCooldownReadingDecision(state.lastDecision);
  const cooldownCurrentText = isTrustedCooldownReading
    ? cooldownSnapshotText ?? normalizeHuntStallCooldownText(state.recognizedText)
    : null;
  const cooldownFallbackLabel = state.cooldownUsedVisualActivity
    ? "화면 변화"
    : state.hasObservedCooldownPresence
      ? "재확인 중"
      : "확인 중";
  const cooldownValueLabel =
    displayStatus === "paused" || displayStatus === "no-stream"
      ? "--"
      : displayStatus === "no-region"
        ? "영역 필요"
        : cooldownCurrentText ?? cooldownFallbackLabel;
  const cooldownPreviewUrl =
    snapshot?.mode === "cooldown-presence" && snapshot.rawPreviewUrl && hasCurrentCooldownRegion
      ? snapshot.rawPreviewUrl
      : null;
  const cooldownPreviewImageData =
    snapshot?.mode === "cooldown-presence" && hasCurrentCooldownRegion
      ? snapshot.rawPreviewImageData ?? null
      : null;
  const hasManualExperiencePreview =
    snapshot?.mode === "manual-experience" &&
    hasCurrentManualExperienceRegion &&
    Boolean(
      snapshot.displayPreviewUrl ||
        snapshot.displayPreviewImageData ||
        snapshot.rawPreviewUrl ||
        snapshot.rawPreviewImageData,
    );
  const manualExperiencePreviewUrl = hasManualExperiencePreview
    ? snapshot.displayPreviewUrl ?? snapshot.rawPreviewUrl ?? null
    : null;
  const manualExperiencePreviewImageData =
    hasManualExperiencePreview
      ? snapshot.displayPreviewImageData ?? snapshot.rawPreviewImageData ?? null
      : null;

  return {
    mode,
    isCooldownPresenceMode,
    isManualExperienceMode,
    usesManualCrop,
    displayStatus,
    statusView,
    hasCurrentCooldownRegion,
    hasCurrentManualExperienceRegion,
    cooldownCropLabel,
    manualExperienceCropLabel,
    cropLabel,
    thresholdValue,
    thresholdAriaLabel,
    thresholdRangeHint,
    thresholdMin,
    thresholdMax,
    editorColSpan,
    lastActivityLabel,
    lastActivityAt,
    lastActivityNow,
    cooldownValueLabel,
    cooldownPreviewUrl,
    cooldownPreviewImageData,
    manualExperiencePreviewUrl,
    manualExperiencePreviewImageData,
    cooldownStatusDetail: needsGameViewport
      ? "화면 공유 메뉴에서 게임 영역 설정"
      : getCooldownPresenceStatusDetail(displayStatus, statusView.detail),
    manualExperienceStatusDetail: needsGameViewport
      ? "화면 공유 메뉴에서 게임 영역 설정"
      : getManualExperienceStatusDetail(displayStatus, statusView.detail),
  };
}

export function getCooldownPresenceStatusDetail(
  displayStatus: HuntStallRuntimeStatus,
  statusDetail: string | null,
): string {
  if (displayStatus === "paused") {
    return "알림 꺼짐";
  }

  if (displayStatus === "no-stream") {
    return "화면 공유 후 쿨타임 확인";
  }

  if (displayStatus === "no-region") {
    return "쿨타임 아이콘 영역 필요";
  }

  if (displayStatus === "watching") {
    return "숫자 움직임 대기";
  }

  if (displayStatus === "active") {
    return "숫자/화면 변화 확인 중";
  }

  if (displayStatus === "alerted") {
    return "다음 쿨타임 변화 대기";
  }

  if (displayStatus === "stalled") {
    return "변화 없음 조건 확인";
  }

  return statusDetail ?? "쿨타임 숫자 확인 중";
}

export function getManualExperienceStatusDetail(
  displayStatus: HuntStallRuntimeStatus,
  statusDetail: string | null,
): string {
  if (displayStatus === "paused") {
    return "알림 꺼짐";
  }

  if (displayStatus === "no-stream") {
    return "화면 공유 후 경험치바 확인";
  }

  if (displayStatus === "no-region") {
    return "경험치바 높이 선택 필요";
  }

  if (displayStatus === "watching") {
    return "첫 경험치 변화 대기";
  }

  if (displayStatus === "active") {
    return "경험치 변화 감시 중";
  }

  if (displayStatus === "alerted") {
    return "다음 경험치 변화 대기";
  }

  if (displayStatus === "stalled") {
    return "변화 없음 조건 확인";
  }

  return statusDetail ?? "경험치 숫자 확인 중";
}
