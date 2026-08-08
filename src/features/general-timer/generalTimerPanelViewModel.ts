import type { GeneralTimerConfig } from "../../types";
import {
  type GeneralTimerStatus,
  getGeneralTimerPreset,
} from "../../domain/general-timer/generalTimers";

export type GeneralTimerStatusView = {
  label: string;
  className: string;
};

export type GeneralTimerActionView = {
  label: string;
  title: string;
  icon: "play" | "pause";
};

export function getGeneralTimerStatusView(status: GeneralTimerStatus): GeneralTimerStatusView {
  switch (status) {
    case "disabled":
      return { label: "꺼짐", className: "paused" };
    case "running":
      return { label: "진행 중", className: "active" };
    case "paused":
      return { label: "일시정지", className: "paused" };
    case "done":
      return { label: "알림 완료", className: "alerted" };
    case "idle":
    default:
      return { label: "대기", className: "waiting" };
  }
}

export function getGeneralTimerActionView(status: GeneralTimerStatus): GeneralTimerActionView {
  if (status === "running") {
    return { label: "일시정지", title: "일시정지", icon: "pause" };
  }
  if (status === "paused") {
    return { label: "재개", title: "재개", icon: "play" };
  }
  return { label: "시작", title: "시작", icon: "play" };
}

export function getGeneralTimerRowClassName({
  isEnabled,
  isExpanded,
}: {
  isEnabled: boolean;
  isExpanded: boolean;
}): string {
  return [
    "dashboard-row",
    "general-timer-row",
    !isEnabled ? "is-disabled-row" : "",
    isExpanded ? "expanded-row" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function getCustomTimerParts(timer: GeneralTimerConfig): {
  minutes: number;
  seconds: number;
} {
  const seconds = timer.customDurationSeconds ?? getGeneralTimerPreset("custom").durationSeconds;
  return {
    minutes: Math.floor(seconds / 60),
    seconds: seconds % 60,
  };
}

export function isGeneralTimerInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    ? Boolean(target.closest("button, input, select, textarea, label, [data-interactive='true']"))
    : false;
}

export function isGeneralTimerToggleKey(key: string): boolean {
  return key === "Enter" || key === " ";
}
