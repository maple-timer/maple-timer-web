import type { BoosterExpiryRuntimeState } from "../../../lib/boosterExpiry/boosterExpiryTypes";

export type BoosterExpiryStatusView = {
  label: string;
  detail: string | null;
  className: string;
  alertCountdownSeconds?: number;
};

export function getBoosterExpiryStatusView(
  state: BoosterExpiryRuntimeState,
  hasStream: boolean,
  enabled: boolean,
  isGameViewportReady = true,
): BoosterExpiryStatusView {
  if (!enabled) {
    return { label: "꺼짐", detail: "알림 꺼짐", className: "paused" };
  }
  if (!hasStream || state.status === "no-stream") {
    return {
      label: "화면 공유 필요",
      detail: "화면 공유 후 타이머 확인",
      className: "no-stream",
    };
  }
  if (!isGameViewportReady) {
    return {
      label: "게임 영역 설정 필요",
      detail: "화면 공유 메뉴에서 게임 영역 설정",
      className: "warning",
    };
  }

  switch (state.status) {
    case "confirming":
      return {
        label: "시간 확인 중",
        detail: "타이머인지 확인 중",
        className: "candidate",
      };
    case "armed":
      return {
        label: "알림 대기",
        detail: "알림 시각 확보됨",
        className: "active",
        alertCountdownSeconds: getBoosterExpiryAlertCountdownSeconds(state) ?? undefined,
      };
    case "alerted":
      return {
        label: "알림 완료",
        detail: "이번 부스터 알림 완료",
        className: "alerted",
      };
    case "lost":
      return {
        label: "타이머 놓침",
        detail: "타이머가 다시 보이면 재확인합니다.",
        className: "warning",
      };
    case "waiting":
    default:
      if (state.alertedAt !== null) {
        return {
          label: "다음 부스터 대기",
          detail: "새 부스터 타이머 대기 중",
          className: "waiting",
        };
      }
      return {
        label: "타이머 대기",
        detail: "부스터 타이머를 찾는 중입니다",
        className: "waiting",
      };
  }
}

export function getBoosterExpiryReadingLabel(state: BoosterExpiryRuntimeState): {
  primary: string;
  secondary: string;
} {
  if (state.status === "waiting" && state.alertedAt !== null) {
    return {
      primary: "--",
      secondary: "다음 부스터 대기",
    };
  }
  if (state.flowSource === "predicted-rejected-raw") {
    if (state.rawText && state.consecutiveRawDetections >= 2) {
      return {
        primary: state.rawText,
        secondary: "시간 확인 중",
      };
    }
    return {
      primary: "--",
      secondary: "시간 확인 중",
    };
  }
  if (state.locked && state.displayText) {
    return {
      primary: state.displayText,
      secondary: getReadingSourceLabel(state),
    };
  }
  return {
    primary: "--",
    secondary: "타이머 대기",
  };
}

function getReadingSourceLabel(state: BoosterExpiryRuntimeState): string {
  if (!state.locked) {
    return "확인 중";
  }
  if (state.flowSource?.startsWith("predicted")) {
    return "흐름 보정";
  }
  return "확정";
}

export function getBoosterExpiryAlertCountdownSeconds(
  state: BoosterExpiryRuntimeState,
): number | null {
  if (state.alertAt === null || state.lastSampledAt === null) {
    return null;
  }
  return Math.max(0, Math.ceil((state.alertAt - state.lastSampledAt) / 1000));
}
