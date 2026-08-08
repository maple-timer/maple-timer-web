import type { KeyboardEvent, SyntheticEvent } from "react";
import type { RuneRuntimeState, RuneRuntimeStatus } from "../../../alertTypes";

export const RUNE_STATUS_LABELS: Record<RuneRuntimeStatus, string> = {
  paused: "꺼짐",
  "no-stream": "화면 공유 필요",
  "no-region": "미니맵 영역 필요",
  loading: "로딩 중",
  waiting: "룬 대기",
  candidate: "확인 중",
  alerted: "룬 감지",
  unavailable: "감지 오류",
};

export function stopRuneRowClick(event: SyntheticEvent) {
  event.stopPropagation();
}

export function isRuneToggleKey(event: KeyboardEvent): boolean {
  return event.key === "Enter" || event.key === " ";
}

export function isRuneInteractiveTarget(target: EventTarget): boolean {
  return target instanceof Element && Boolean(target.closest("button, input, select, textarea, a"));
}

export function getRuneStatusView(
  displayStatus: RuneRuntimeStatus,
  state: RuneRuntimeState,
): { label: string; className: string } {
  if (displayStatus === "alerted") {
    return {
      label: RUNE_STATUS_LABELS.alerted,
      className: "alerted",
    };
  }

  if (displayStatus === "candidate") {
    return {
      label: RUNE_STATUS_LABELS.candidate,
      className: "candidate",
    };
  }

  if (displayStatus === "unavailable") {
    return {
      label: RUNE_STATUS_LABELS.unavailable,
      className: "unavailable",
    };
  }

  if (displayStatus === "waiting" && state.lastDetectedAt) {
    return {
      label: "사라짐",
      className: "waiting",
    };
  }

  return {
    label: RUNE_STATUS_LABELS[displayStatus],
    className: displayStatus,
  };
}
