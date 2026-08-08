import type { KeyboardEvent, MouseEvent } from "react";
import type { RgbaImageSnapshot, SkillSnapshot } from "../../../alertTypes";
import {
  getSkillRegionForLayout,
  hasAnySkillRegion,
  hasUsableRegion,
} from "../../../lib/regions";
import {
  getSkillBuffDurationTargetForSkill,
  isSkillBuffDurationRemainingCountTarget,
  type SkillBuffDurationTarget,
} from "../../../lib/skillBuffDuration/skillBuffDurationTargets";
import {
  getEstimatedRemainingSeconds,
  getSkillAlertInRemainingCount,
  getSkillAlertInSeconds,
  getSkillInitialAlertCountdownParts,
  getSignedEstimatedRemainingSeconds,
  type SkillInitialAlertCountdownParts,
} from "../../../lib/timer";
import type { RecognitionResult, SkillConfig, SkillRuntimeState } from "../../../types";

export const TRUSTED_READING_CONFIDENCE = 0.55;
export const TIMER_VALUE_MIN_SECONDS = 1;
export const TIMER_VALUE_MAX_SECONDS = 600;
export const MISSING_CURRENT_LAYOUT_REGION_LABEL = "스킬 영역 다시 선택";
export const MISSING_CURRENT_LAYOUT_REGION_TOOLTIP =
  "화면 해상도가 바뀌면 기존 crop 위치가 달라질 수 있어 해상도별로 영역을 저장합니다.";

export const SKILL_STATUS_LABELS: Record<SkillRuntimeState["status"], string> = {
  idle: "대기",
  detecting: "감지",
  running: "진행",
  alerted: "알림 완료",
  lost: "유실",
  paused: "중지",
};

export type SkillDisplayStatusView = {
  className: SkillRuntimeState["status"] | "no-stream" | "warning";
  label: string;
};

export function getSkillStatusView(
  skill: Pick<SkillConfig, "enabled">,
  state: SkillRuntimeState,
  hasStream: boolean,
  isGloballyDisabled = false,
  isGameViewportReady = true,
): SkillDisplayStatusView {
  if (isGloballyDisabled || !skill.enabled || state.status === "paused") {
    return { className: "paused", label: SKILL_STATUS_LABELS.paused };
  }

  if (!hasStream) {
    return { className: "no-stream", label: "화면 공유 필요" };
  }

  if (!isGameViewportReady) {
    return { className: "warning", label: "게임 영역 설정 필요" };
  }

  return { className: state.status, label: SKILL_STATUS_LABELS[state.status] };
}

export type SkillRowVisualState =
  | {
      kind: "thumbnail";
      url?: string | null;
      imageData?: RgbaImageSnapshot | null;
      variant?: "buff-duration";
      label?: string;
      description?: string;
      tone?: "detected" | "checking" | "extended" | "pending" | "searching" | "error";
      badgeLabel?: string;
      tooltip?: string;
    }
  | {
      kind: "placeholder";
      label: string;
      description?: string;
      tone?: "detected" | "checking" | "extended" | "pending" | "searching" | "error";
      tooltip?: string;
      variant?: "buff-duration";
    };

export function getSkillRowVisualState(
  skill: SkillConfig,
  state: SkillRuntimeState,
  snapshot: SkillSnapshot | undefined,
  hasStream: boolean,
  currentLayoutKey: string | null = null,
  now: number | null = null,
  isGameViewportReady = true,
): SkillRowVisualState {
  const currentRegion = getSkillRegionForLayout(skill, currentLayoutKey);
  const buffDurationTarget = getSkillBuffDurationTargetForSkill(skill);

  if (!skill.enabled || state.status === "paused") {
    if (buffDurationTarget) {
      return {
        kind: "placeholder",
        label: "중지",
        description: "중지",
        variant: "buff-duration",
      };
    }
    return { kind: "placeholder", label: "중지" };
  }

  if (hasStream && !isGameViewportReady) {
    return {
      kind: "placeholder",
      label: "게임 영역 설정 필요",
      description: "화면 공유 메뉴에서 설정",
      tone: "error",
      ...(buffDurationTarget ? { variant: "buff-duration" as const } : {}),
    };
  }

  if (buffDurationTarget) {
    if (hasStream && (snapshot?.previewImageData || snapshot?.previewUrl)) {
      const isChecking = snapshot.buffDuration?.displayStatus === "checking";
      if (isChecking) {
        return {
          kind: "thumbnail",
          url: snapshot.previewUrl,
          ...(snapshot.previewImageData ? { imageData: snapshot.previewImageData } : {}),
          variant: "buff-duration",
          label: `${buffDurationTarget.shortName} 확인 중`,
          description: "찾는 중",
          tone: "checking",
          badgeLabel: "확인 중",
          tooltip: `최근 감지 이미지를 잠시 유지하며 ${buffDurationTarget.shortName} 버프칸을 다시 확인합니다.`,
        };
      }
      const countdownLabel = formatSkillBuffDurationCountdown(snapshot.buffDuration?.countdown);
      const remainingCountLabel = formatSkillBuffDurationRemainingCount(
        snapshot.buffDuration?.remainingCount,
      );
      const timingSummary = getSkillBuffDurationTimingSummary({
        countdownLabel,
        remainingCountLabel,
        now,
        snapshot,
        state,
        target: buffDurationTarget,
      });
      return {
        kind: "thumbnail",
        url: snapshot.previewUrl,
        ...(snapshot.previewImageData ? { imageData: snapshot.previewImageData } : {}),
        variant: "buff-duration",
        label: timingSummary.label,
        description: timingSummary.description,
        tone: timingSummary.tone,
        tooltip: countdownLabel
          ? `버프칸에서 읽은 ${buffDurationTarget.shortName} 남은 시간입니다.`
          : undefined,
      };
    }

    if (hasStream && snapshot?.buffDuration) {
      return getSkillBuffDurationPlaceholder(snapshot, buffDurationTarget);
    }

    return {
      kind: "placeholder",
      label: hasStream ? "버프칸 분석 준비 중" : "화면 공유 필요",
      description: hasStream ? "모듈 로딩 중" : undefined,
      variant: "buff-duration",
    };
  }

  if (!hasStream) {
    return { kind: "placeholder", label: "화면 공유 필요" };
  }

  if (!hasUsableRegion(currentRegion)) {
    if (currentLayoutKey && hasAnySkillRegion(skill)) {
      return {
        kind: "placeholder",
        label: MISSING_CURRENT_LAYOUT_REGION_LABEL,
        tooltip: MISSING_CURRENT_LAYOUT_REGION_TOOLTIP,
      };
    }

    return { kind: "placeholder", label: "스킬 영역 선택" };
  }

  if (state.status === "alerted") {
    return { kind: "placeholder", label: "알림 완료" };
  }

  if (
    snapshot?.previewUrl &&
    snapshot.result.value !== null &&
    snapshot.result.confidence >= TRUSTED_READING_CONFIDENCE
  ) {
    return { kind: "thumbnail", url: snapshot.previewUrl };
  }

  return { kind: "placeholder", label: "숫자 대기" };
}

function getSkillBuffDurationPlaceholder(
  snapshot: SkillSnapshot,
  target: SkillBuffDurationTarget,
): SkillRowVisualState {
  const buffDuration = snapshot.buffDuration;
  if (!buffDuration) {
    return {
      kind: "placeholder",
      label: "버프칸 분석 준비 중",
      description: "모듈 로딩 중",
      variant: "buff-duration",
    };
  }

  if (buffDuration.error) {
    return {
      kind: "placeholder",
      label: "버프칸 감지 오류",
      description: "다시 시도 필요",
      tone: "error",
      tooltip: buffDuration.error,
      variant: "buff-duration",
    };
  }

  if (buffDuration.boxCount <= 0) {
    return {
      kind: "placeholder",
      label: "버프칸을 찾는 중",
      description: "화면 확인 중",
      tone: "searching",
      tooltip: "parser가 현재 프레임에서 버프칸을 찾지 못했습니다.",
      variant: "buff-duration",
    };
  }

  return {
    kind: "placeholder",
    label:
      buffDuration.displayStatus === "checking"
        ? `${target.shortName} 버프칸 확인 중`
        : `${target.shortName} 아이콘 매칭 대기`,
    description: buffDuration.displayStatus === "checking" ? "찾는 중" : `${target.shortName} 감지 대기 중`,
    tone: buffDuration.displayStatus === "checking" ? "checking" : "searching",
    tooltip: `버프칸 ${buffDuration.boxCount}개 감지 · ${target.shortName} 매칭 ${buffDuration.detectedCount}개`,
    variant: "buff-duration",
  };
}

function getSkillBuffDurationTimingSummary({
  countdownLabel,
  now,
  remainingCountLabel,
  snapshot,
  state,
  target,
}: {
  countdownLabel: string | null;
  remainingCountLabel: string | null;
  now: number | null;
  snapshot: SkillSnapshot;
  state: SkillRuntimeState;
  target: SkillBuffDurationTarget;
}): {
  label: string;
  description: string;
  tone: NonNullable<SkillRowVisualState["tone"]>;
} {
  if (isSkillBuffDurationRemainingCountTarget(target)) {
    if (state.pendingRemainingCountIncrease) {
      return {
        label: "갱신 확인 중",
        description: "횟수 확인 중",
        tone: "pending",
      };
    }

    if (state.pendingRemainingCountDrop) {
      return {
        label: "흐름 확인 중",
        description: "급격한 변화 재확인 중",
        tone: "pending",
      };
    }

    if (state.pendingRemainingCountAlert) {
      return {
        label: "알림 확인 중",
        description: "횟수 재확인 중",
        tone: "pending",
      };
    }

    if (state.observedRemainingCount === null) {
      return {
        label: "횟수 확인 중",
        description: remainingCountLabel ? `${remainingCountLabel} 읽음` : "횟수 확인 중",
        tone: "checking",
      };
    }

    return {
      label: `${target.shortName} 감지`,
      description: remainingCountLabel ? `${remainingCountLabel} 읽음` : "횟수 확인 중",
      tone: snapshot.buffDuration?.displayStatus === "checking" ? "checking" : "detected",
    };
  }

  const countdownSeconds = getSkillBuffDurationCountdownTotalSeconds(
    snapshot.buffDuration?.countdown,
  );
  if (countdownSeconds !== null && countdownSeconds >= 120) {
    return {
      label: "흐름 확인 중",
      description: "2분 미만 대기",
      tone: "checking",
    };
  }

  if (
    state.buffDurationTimingEvent?.type === "extended" &&
    now !== null &&
    now - state.buffDurationTimingEvent.occurredAt <= 10_000
  ) {
    return {
      label: "갱신됨",
      description: "갱신됨",
      tone: "extended",
    };
  }

  if (state.pendingShortAnchor && state.estimatedExpiresAt !== null) {
    return {
      label: "갱신 확인 중",
      description: "시간 확인 중",
      tone: "pending",
    };
  }

  if (state.pendingShortAnchor || state.estimatedExpiresAt === null) {
    return {
      label: "흐름 확인 중",
      description: countdownLabel ? `${countdownLabel} 읽음` : "시간 확인 중",
      tone: "checking",
    };
  }

  return {
    label: `${target.shortName} 감지`,
    description: countdownLabel ? `${countdownLabel} 읽음` : "시간 확인 중",
    tone: snapshot.buffDuration?.displayStatus === "checking" ? "checking" : "detected",
  };
}

function getSkillBuffDurationCountdownTotalSeconds(
  countdown: NonNullable<SkillSnapshot["buffDuration"]>["countdown"] | null | undefined,
): number | null {
  if (
    !countdown ||
    countdown.kind !== "exact" ||
    typeof countdown.totalSeconds !== "number" ||
    !Number.isFinite(countdown.totalSeconds)
  ) {
    return null;
  }
  return Math.max(0, Math.round(countdown.totalSeconds));
}

function formatSkillBuffDurationCountdown(
  countdown: NonNullable<SkillSnapshot["buffDuration"]>["countdown"] | null | undefined,
): string | null {
  const totalSeconds = getSkillBuffDurationCountdownTotalSeconds(countdown);
  if (totalSeconds === null) {
    return null;
  }
  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }
  return `${totalSeconds}초`;
}

function getSkillBuffDurationRemainingCountValue(
  remainingCount: NonNullable<SkillSnapshot["buffDuration"]>["remainingCount"] | null | undefined,
): number | null {
  if (
    !remainingCount ||
    remainingCount.kind !== "exact" ||
    typeof remainingCount.count !== "number" ||
    !Number.isFinite(remainingCount.count)
  ) {
    return null;
  }
  return Math.max(0, Math.round(remainingCount.count));
}

function formatSkillBuffDurationRemainingCount(
  remainingCount: NonNullable<SkillSnapshot["buffDuration"]>["remainingCount"] | null | undefined,
): string | null {
  const count = getSkillBuffDurationRemainingCountValue(remainingCount);
  return count === null ? null : `${count}회`;
}

export function formatReading(
  result?: RecognitionResult,
  valueKind: "seconds" | "remaining-count" = "seconds",
): string {
  if (!result || result.value === null) {
    return "--";
  }
  if (result.confidence < TRUSTED_READING_CONFIDENCE) {
    return "보류";
  }
  if (valueKind === "remaining-count") {
    return `${result.value}회`;
  }
  return `${result.value}s`;
}

export function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function getTimeUntilAlertSeconds(
  state: SkillRuntimeState,
  skill: Pick<SkillConfig, "alertThresholdSeconds" | "enabled">,
  now: number,
  isGloballyDisabled = false,
): number | null {
  if (isGloballyDisabled || !skill.enabled) {
    return null;
  }

  return getSkillAlertInSeconds(state, skill, now);
}

export function getTimeUntilAlertCountdownParts(
  state: SkillRuntimeState,
  skill: Pick<SkillConfig, "alertThresholdSeconds" | "enabled">,
  now: number,
  isGloballyDisabled = false,
): SkillInitialAlertCountdownParts | null {
  if (isGloballyDisabled || !skill.enabled) {
    return null;
  }

  return getSkillInitialAlertCountdownParts(state, skill, now);
}

export function getRemainingCountUntilAlert(
  state: SkillRuntimeState,
  skill: Pick<SkillConfig, "alertThresholdSeconds" | "enabled">,
  isGloballyDisabled = false,
): number | null {
  if (isGloballyDisabled || !skill.enabled) {
    return null;
  }

  return getSkillAlertInRemainingCount(state, skill);
}

export function stopRowClick(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

export function isToggleKey(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === "Enter" || event.key === " ";
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button,input,select,textarea,a"));
}
