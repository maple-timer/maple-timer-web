import type { KeyboardEvent, SyntheticEvent } from "react";
import type {
  HuntStallReadDecision,
  HuntStallRuntimeState,
  HuntStallRuntimeStatus,
} from "../../../alertTypes";
import type { HuntStallAlertConfig } from "../../../types";

export const HUNT_STALL_STATUS_LABELS: Record<HuntStallRuntimeStatus, string> = {
  paused: "꺼짐",
  "no-stream": "화면 공유 필요",
  "no-region": "영역 필요",
  detecting: "읽기 대기",
  watching: "시작 대기",
  active: "감시 중",
  stalled: "멈춤 의심",
  alerted: "알림 완료",
  unavailable: "경험치 없음",
};

export function stopHuntStallRowClick(event: SyntheticEvent) {
  event.stopPropagation();
}

export function isHuntStallToggleKey(event: KeyboardEvent): boolean {
  return event.key === "Enter" || event.key === " ";
}

export function isHuntStallInteractiveTarget(target: EventTarget): boolean {
  return target instanceof Element && Boolean(target.closest("button, input, select, textarea, a"));
}

export function isTrustedCooldownReadingDecision(decision: HuntStallReadDecision): boolean {
  return (
    decision === "cooldown-readable" ||
    decision === "cooldown-arming" ||
    decision === "cooldown-unchanged" ||
    decision === "cooldown-alerted"
  );
}

export function getHuntStallStatusView(
  displayStatus: HuntStallRuntimeStatus,
  state: HuntStallRuntimeState,
  mode: HuntStallAlertConfig["mode"] = "manual-experience",
): { label: string; detail: string | null; className: string } {
  if (displayStatus === "no-region") {
    return {
      label: HUNT_STALL_STATUS_LABELS["no-region"],
      detail:
        mode === "cooldown-presence"
          ? "쿨타임 숫자 영역 선택 필요"
          : "경험치바 높이 선택 필요",
      className: "no-region",
    };
  }

  if (displayStatus === "detecting") {
    return {
      label: HUNT_STALL_STATUS_LABELS.detecting,
      detail:
        mode === "cooldown-presence"
          ? isTrustedCooldownReadingDecision(state.lastDecision) && state.recognizedText
            ? `마지막 숫자 ${state.recognizedText}`
            : "쿨타임 숫자 확인 중"
          : state.recognizedText
            ? "마지막 값 유지 중"
            : "경험치 숫자 확인 중",
      className: "detecting",
    };
  }

  if (displayStatus === "unavailable") {
    return {
      label: HUNT_STALL_STATUS_LABELS.unavailable,
      detail: "경험치 숫자 영역 확인 필요",
      className: "unavailable",
    };
  }

  if (displayStatus === "active" && state.lastChangedAt) {
    return {
      label: HUNT_STALL_STATUS_LABELS.active,
      detail:
        mode === "cooldown-presence"
          ? state.unchangedSeconds > 0
            ? `변화 없음 ${state.unchangedSeconds}초`
            : "쿨타임 변화 감시 중"
          : state.unchangedSeconds > 0
            ? `마지막 변화 ${state.unchangedSeconds}초 전`
            : "마지막 변화 0초 전",
      className: "active",
    };
  }

  if (displayStatus === "watching" && state.lastChangedAt) {
    return {
      label: HUNT_STALL_STATUS_LABELS.watching,
      detail:
        mode === "cooldown-presence"
          ? "쿨타임 숫자 재확인 중"
          : "경험치 변화 대기",
      className: "watching",
    };
  }

  if (displayStatus === "alerted" && mode === "cooldown-presence") {
    const elapsedSeconds =
      state.alertedAt === null
        ? 0
        : Math.max(0, Math.floor(((state.lastSampledAt ?? state.alertedAt) - state.alertedAt) / 1000));

    return {
      label: HUNT_STALL_STATUS_LABELS.alerted,
      detail: `알림 후 ${elapsedSeconds}초`,
      className: "alerted",
    };
  }

  if (displayStatus === "stalled" || displayStatus === "alerted") {
    return {
      label: HUNT_STALL_STATUS_LABELS[displayStatus],
      detail: `${state.unchangedSeconds}초 변화 없음`,
      className: displayStatus,
    };
  }

  return {
    label: HUNT_STALL_STATUS_LABELS[displayStatus],
    detail: null,
    className: displayStatus,
  };
}

export function normalizeHuntStallCooldownText(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  if (!trimmed || !/^\d{1,3}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}
