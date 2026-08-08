import type { SpecialCoreRuntimeState } from "../../../lib/specialCore";

export type SpecialCoreStatusView = {
  label: string;
  detail: string;
  className: string;
};

export function getSpecialCoreStatusView({
  state,
  hasStream,
  enabled,
  isGameViewportReady = true,
}: {
  state: SpecialCoreRuntimeState;
  hasStream: boolean;
  enabled: boolean;
  isGameViewportReady?: boolean;
}): SpecialCoreStatusView {
  if (!enabled) {
    return {
      label: "꺼짐",
      detail: "알림 꺼짐",
      className: "paused",
    };
  }

  if (!hasStream || state.status === "needs-stream") {
    return {
      label: "화면 공유 필요",
      detail: "화면 공유 후 버프칸 확인",
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

  if (state.status === "unavailable") {
    return {
      label: "감지 오류",
      detail: state.unsupportedReason ?? "특수코어 감지 오류",
      className: "warning",
    };
  }

  if (state.status === "loading") {
    return {
      label: "준비 중",
      detail: "특수코어 정밀 감지 준비 중",
      className: "loading",
    };
  }

  if (state.status === "confirming") {
    return {
      label: "확인 중",
      detail: "특수코어 후보 확인 중",
      className: "candidate",
    };
  }

  if (state.status === "cooldown") {
    return {
      label: "쿨타임 진행",
      detail: "알림 예정",
      className: "active",
    };
  }

  if (state.status === "alerted") {
    return {
      label: "알림 완료",
      detail: "다음 특수코어를 기다리는 중",
      className: "alerted",
    };
  }

  return {
    label: "감지 대기",
    detail: "특수코어 찾는 중",
    className: "waiting",
  };
}
