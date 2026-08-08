export const SKILL_ALERT_EXTENDED_UI_GUIDE =
  "확장 UI를 사용한다면 화면 공유 메뉴에서 게임 영역을 설정해주세요.";

export const SKILL_ALERT_QUICKSLOT_DISPLAY_GUIDE =
  "퀵슬롯&버프 표시가 [중앙, 크게]인지 확인해주세요.";

export const SKILL_ALERT_BUFF_SORT_GUIDE =
  "버프 정렬 옵션이 모두 켜져 있는지 확인해주세요.";

export const SKILL_ALERT_BUFF_TIME_FORMAT_GUIDE =
  "퀵슬롯&버프표시방식이 [분+초]인지 확인해주세요.";

export const SKILL_ALERT_CHECKLIST_IMAGE_SRC = "/media/quickslot-buff-time-large-center.png";

export const SKILL_ALERT_CHECKLIST_IMAGE_ALT =
  "퀵슬롯과 버프 시간 표시가 중앙, 크게로 설정된 예시";

export const SKILL_ALERT_QUICKSLOT_REPORT_CHECKLIST = [
  SKILL_ALERT_EXTENDED_UI_GUIDE,
  SKILL_ALERT_QUICKSLOT_DISPLAY_GUIDE,
  "스킬 아이콘 하나만 선택됐는지 확인해주세요.",
  "우하단 퀵슬롯 영역인지 확인해주세요.",
  "배경없이 정확히 아이콘만 선택됐는지 확인해주세요.",
  "아이콘에 노란색이 섞일 경우 불안정합니다.",
] as const;

export function getSkillAlertQuickslotReportChecklist(): string[] {
  return [...SKILL_ALERT_QUICKSLOT_REPORT_CHECKLIST];
}

export function getSkillAlertBuffDurationReportChecklist(
  targetName: string,
  valueSubject = "시간이",
): string[] {
  return [
    SKILL_ALERT_EXTENDED_UI_GUIDE,
    SKILL_ALERT_QUICKSLOT_DISPLAY_GUIDE,
    SKILL_ALERT_BUFF_SORT_GUIDE,
    SKILL_ALERT_BUFF_TIME_FORMAT_GUIDE,
    `${targetName} 아이콘과 ${valueSubject} 보이는지 확인해주세요.`,
    "버프칸이 가려지지 않는지 확인해주세요.",
  ];
}
