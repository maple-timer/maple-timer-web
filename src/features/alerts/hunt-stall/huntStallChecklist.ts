export const HUNT_STALL_EXTENDED_UI_GUIDE =
  "확장 UI를 사용한다면 화면 공유 메뉴에서 게임 영역을 설정해주세요.";

export const HUNT_STALL_SOL_HECATE_GUIDE = "솔 헤카테가 꺼져 있는지 확인해주세요.";

export const HUNT_STALL_UI_SIZE_GUIDE =
  "UI 크기가 [최적 비율]인지 확인해주세요.";

export const HUNT_STALL_UI_SIZE_IMAGE_SRC = "/media/ui-size-optimal-ratio.png";

export const HUNT_STALL_UI_SIZE_IMAGE_ALT = "UI 크기가 최적 비율로 설정된 예시";

const HUNT_STALL_COMMON_REPORT_CHECKLIST = [
  HUNT_STALL_EXTENDED_UI_GUIDE,
  HUNT_STALL_SOL_HECATE_GUIDE,
  HUNT_STALL_UI_SIZE_GUIDE,
] as const;

export function getHuntStallManualExperienceReportChecklist(): string[] {
  return [
    ...HUNT_STALL_COMMON_REPORT_CHECKLIST,
    "경험치바 윗선 위치를 확인해주세요.",
    "경험치 숫자가 가려지지 않는지 확인해주세요.",
    "해상도를 변경했다면 영역을 다시 선택했는지 확인해주세요.",
  ];
}

export function getHuntStallCooldownPresenceReportChecklist(): string[] {
  return [
    ...HUNT_STALL_COMMON_REPORT_CHECKLIST,
    "쿨타임 아이콘 하나만 선택됐는지 확인해주세요.",
    "배경없이 정확히 아이콘만 선택됐는지 확인해주세요.",
    "아이콘에 노란색이 섞일 경우 불안정합니다.",
  ];
}
