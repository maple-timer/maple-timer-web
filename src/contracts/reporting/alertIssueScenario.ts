export type AlertIssueFeature =
  | "rune"
  | "ultima-raid-equipment"
  | "skill"
  | "hunt-stall"
  | "buff-expiry"
  | "booster-expiry"
  | "special-core";

export type AlertIssueScenario =
  | "not-recognized"
  | "recognized-no-alert"
  | "playback-missing"
  | "repeat-missing"
  | "wrong-target"
  | "duplicate-alert"
  | "unexpected-playback"
  | "wrong-value"
  | "unstable-value"
  | "early-alert"
  | "late-alert"
  | "repeat-timing"
  | "other";

export type AlertIssueOccurrence = "current" | "recent" | "historical";

export type AlertIssueOtherCategory =
  | "status-display"
  | "sound-volume"
  | "settings-preset"
  | "performance-error"
  | "interaction"
  | "other";

export type AlertIssueAffectedTarget = {
  id: string;
  label: string;
};

export type AlertIssueScenarioOption = {
  scenario: AlertIssueScenario;
  label: string;
};

export type AlertIssueOccurrenceOption = {
  occurrence: AlertIssueOccurrence;
  label: string;
};

export type AlertIssueOtherCategoryOption = {
  category: AlertIssueOtherCategory;
  label: string;
};

export type AlertIssueEvidenceKey =
  | "sourceImage"
  | "temporalTrace"
  | "stateBeforeAfter"
  | "decision"
  | "playback"
  | "affectedTarget";

export const ALERT_ISSUE_OCCURRENCE_OPTIONS: AlertIssueOccurrenceOption[] = [
  { occurrence: "current", label: "제보 창을 열기 직전에도 문제였어요" },
  { occurrence: "recent", label: "제보 창을 열기 전 1분 안에 있었어요" },
  { occurrence: "historical", label: "제보 창을 열기 1분보다 전에 있었어요" },
];

export const ALERT_ISSUE_OTHER_CATEGORY_OPTIONS: AlertIssueOtherCategoryOption[] = [
  { category: "status-display", label: "화면 표시나 상태 문구" },
  { category: "sound-volume", label: "알림음이나 볼륨" },
  { category: "settings-preset", label: "설정이나 프리셋" },
  { category: "performance-error", label: "속도 저하나 오류" },
  { category: "interaction", label: "조작이나 사용성" },
  { category: "other", label: "그 밖의 문제" },
];

const SCENARIOS_BY_REASON: Record<string, AlertIssueScenarioOption[]> = {
  "rune-missed": [
    { scenario: "not-recognized", label: "룬을 룬으로 인식하지 못했어요" },
    { scenario: "recognized-no-alert", label: "룬으로 표시됐지만 알림이 안 났어요" },
    { scenario: "playback-missing", label: "알림 처리됐다고 나오지만 소리가 안 났어요" },
    { scenario: "repeat-missing", label: "첫 알림 뒤 반복 알림이 안 났어요" },
  ],
  "rune-false-positive": [
    { scenario: "wrong-target", label: "룬이 아닌 것을 룬으로 인식했어요" },
    { scenario: "duplicate-alert", label: "같은 룬을 새 룬처럼 다시 알렸어요" },
    { scenario: "unexpected-playback", label: "감지 표시 없이 알림 소리만 났어요" },
  ],
  "ultima-raid-equipment-missed": [
    { scenario: "not-recognized", label: "가방이 가득 찬 상태를 감지하지 못했어요" },
    { scenario: "recognized-no-alert", label: "가득 참으로 표시됐지만 알림이 안 났어요" },
    { scenario: "playback-missing", label: "알림 처리됐다고 나오지만 소리가 안 났어요" },
    { scenario: "repeat-timing", label: "첫 알림 뒤 반복 횟수나 간격이 달랐어요" },
  ],
  "ultima-raid-equipment-false-alert": [
    { scenario: "wrong-target", label: "가방이 가득 차지 않았는데 감지했어요" },
    { scenario: "unexpected-playback", label: "감지 표시 없이 알림 소리만 났어요" },
  ],
  "ultima-raid-equipment-rearm": [
    { scenario: "repeat-missing", label: "가방을 비운 뒤 다시 가득 찼는데 알림이 없었어요" },
    { scenario: "recognized-no-alert", label: "다시 가득 참으로 표시됐지만 알림이 없었어요" },
    { scenario: "playback-missing", label: "알림 처리됐다고 나오지만 소리가 안 났어요" },
  ],
  "ultima-raid-boss-missed": [
    { scenario: "not-recognized", label: "보스 등장 상태를 감지하지 못했어요" },
    { scenario: "recognized-no-alert", label: "보스 등장으로 표시됐지만 알림이 안 났어요" },
    { scenario: "playback-missing", label: "알림 처리됐다고 나오지만 소리가 안 났어요" },
    { scenario: "repeat-timing", label: "첫 알림 뒤 반복 횟수나 간격이 달랐어요" },
  ],
  "ultima-raid-boss-false-alert": [
    { scenario: "wrong-target", label: "보스가 등장하지 않았는데 감지했어요" },
    { scenario: "unexpected-playback", label: "감지 표시 없이 알림 소리만 났어요" },
  ],
  "ultima-raid-boss-rearm": [
    { scenario: "repeat-missing", label: "다음 스테이지 보스에서 알림이 없었어요" },
    { scenario: "recognized-no-alert", label: "다음 보스 등장으로 표시됐지만 알림이 없었어요" },
    { scenario: "playback-missing", label: "알림 처리됐다고 나오지만 소리가 안 났어요" },
  ],
  "skill-not-detected": [
    { scenario: "not-recognized", label: "스킬 아이콘을 찾지 못했어요" },
    { scenario: "wrong-value", label: "아이콘은 찾았지만 숫자를 읽지 못했어요" },
    { scenario: "recognized-no-alert", label: "시간은 표시됐지만 알림이 안 났어요" },
    { scenario: "playback-missing", label: "알림 처리됐다고 나오지만 소리가 안 났어요" },
  ],
  "skill-alert-timing": [
    { scenario: "recognized-no-alert", label: "예정 시각이 됐는데 알림이 없었어요" },
    { scenario: "early-alert", label: "설정보다 너무 일찍 울렸어요" },
    { scenario: "late-alert", label: "설정보다 늦게 울렸어요" },
    { scenario: "repeat-timing", label: "반복 횟수나 간격이 달랐어요" },
    { scenario: "playback-missing", label: "알림 처리됐다고 나오지만 소리가 안 났어요" },
  ],
  "hunt-stall-missed": [
    { scenario: "not-recognized", label: "멈춘 상태를 감지하지 못했어요" },
    { scenario: "recognized-no-alert", label: "멈춤으로 표시됐지만 알림이 안 났어요" },
    { scenario: "playback-missing", label: "알림 처리됐다고 나오지만 소리가 안 났어요" },
    { scenario: "repeat-missing", label: "첫 알림 뒤 반복 알림이 안 났어요" },
  ],
  "hunt-stall-false-alert": [
    { scenario: "wrong-target", label: "사냥 중인데 멈춘 것으로 판단했어요" },
    { scenario: "duplicate-alert", label: "같은 멈춤 상태에서 너무 자주 울렸어요" },
    { scenario: "unexpected-playback", label: "멈춤 표시 없이 알림 소리만 났어요" },
  ],
  "hunt-stall-reading": [
    { scenario: "wrong-target", label: "다른 화면 영역을 읽은 것 같아요" },
    { scenario: "wrong-value", label: "경험치나 쿨타임 값을 다르게 읽었어요" },
    { scenario: "unstable-value", label: "판독값이 계속 튀거나 흔들렸어요" },
  ],
  "buff-expiry-missed": [
    { scenario: "not-recognized", label: "대상 버프를 찾지 못했어요" },
    { scenario: "wrong-value", label: "버프는 찾았지만 남은 시간을 읽지 못했어요" },
    { scenario: "recognized-no-alert", label: "종료 시각은 표시됐지만 알림이 안 났어요" },
    { scenario: "playback-missing", label: "알림 처리됐다고 나오지만 소리가 안 났어요" },
  ],
  "buff-expiry-false-alert": [
    { scenario: "wrong-target", label: "다른 아이콘을 대상 버프로 인식했어요" },
    { scenario: "duplicate-alert", label: "같은 버프 종료를 다시 알렸어요" },
    { scenario: "unexpected-playback", label: "종료 표시 없이 알림 소리만 났어요" },
  ],
  "buff-expiry-reading": [
    { scenario: "wrong-target", label: "버프 종류를 다르게 인식했어요" },
    { scenario: "wrong-value", label: "남은 시간을 다르게 읽었어요" },
    { scenario: "unstable-value", label: "버프나 시간 판독이 계속 흔들렸어요" },
  ],
  "booster-expiry-missed": [
    { scenario: "not-recognized", label: "부스터 타이머를 찾지 못했어요" },
    { scenario: "wrong-value", label: "타이머는 찾았지만 시간을 읽지 못했어요" },
    { scenario: "recognized-no-alert", label: "종료 시각은 표시됐지만 알림이 안 났어요" },
    { scenario: "playback-missing", label: "알림 처리됐다고 나오지만 소리가 안 났어요" },
  ],
  "booster-expiry-false-alert": [
    { scenario: "wrong-target", label: "다른 숫자를 부스터 타이머로 인식했어요" },
    { scenario: "duplicate-alert", label: "같은 종료 시각을 다시 알렸어요" },
    { scenario: "unexpected-playback", label: "종료 표시 없이 알림 소리만 났어요" },
  ],
  "booster-expiry-reading": [
    { scenario: "wrong-target", label: "다른 화면 영역을 타이머로 읽었어요" },
    { scenario: "wrong-value", label: "부스터 시간을 다르게 읽었어요" },
    { scenario: "unstable-value", label: "부스터 시간이 계속 튀거나 흔들렸어요" },
  ],
  "special-core-missed": [
    { scenario: "not-recognized", label: "특수 코어 발동 아이콘을 찾지 못했어요" },
    { scenario: "recognized-no-alert", label: "발동으로 표시됐지만 알림이 안 났어요" },
    { scenario: "playback-missing", label: "알림 처리됐다고 나오지만 소리가 안 났어요" },
  ],
  "special-core-false-alert": [
    { scenario: "wrong-target", label: "다른 아이콘을 특수 코어로 인식했어요" },
    { scenario: "duplicate-alert", label: "같은 발동을 다시 알렸어요" },
    { scenario: "unexpected-playback", label: "발동 표시 없이 알림 소리만 났어요" },
  ],
  "special-core-timing": [
    { scenario: "early-alert", label: "쿨타임 알림이 너무 일찍 울렸어요" },
    { scenario: "late-alert", label: "쿨타임 알림이 늦게 울렸어요" },
    { scenario: "repeat-timing", label: "발동 또는 쿨타임 알림이 중복됐어요" },
    { scenario: "playback-missing", label: "알림 처리됐다고 나오지만 소리가 안 났어요" },
  ],
  other: [{ scenario: "other", label: "위 항목과 다른 문제예요" }],
};

const EVIDENCE_REQUIREMENTS_BY_SCENARIO: Record<
  AlertIssueScenario,
  AlertIssueEvidenceKey[]
> = {
  "not-recognized": ["sourceImage", "decision"],
  "recognized-no-alert": ["temporalTrace", "stateBeforeAfter", "decision", "playback"],
  "playback-missing": ["decision", "playback"],
  "repeat-missing": ["temporalTrace", "decision", "playback"],
  "wrong-target": ["sourceImage", "decision", "affectedTarget"],
  "duplicate-alert": ["temporalTrace", "decision", "playback"],
  "unexpected-playback": ["decision", "playback"],
  "wrong-value": ["sourceImage", "temporalTrace", "decision"],
  "unstable-value": ["sourceImage", "temporalTrace", "decision"],
  "early-alert": ["temporalTrace", "stateBeforeAfter", "decision", "playback"],
  "late-alert": ["temporalTrace", "stateBeforeAfter", "decision", "playback"],
  "repeat-timing": ["temporalTrace", "decision", "playback"],
  other: [],
};

export function getAlertIssueScenarioOptions(reason: string): AlertIssueScenarioOption[] {
  return SCENARIOS_BY_REASON[reason] ?? SCENARIOS_BY_REASON.other;
}

export function getAlertIssueOccurrenceLabel(occurrence: AlertIssueOccurrence): string {
  return (
    ALERT_ISSUE_OCCURRENCE_OPTIONS.find((option) => option.occurrence === occurrence)?.label ??
    occurrence
  );
}

export function getAlertIssueOtherCategoryLabel(
  category: AlertIssueOtherCategory,
): string {
  return (
    ALERT_ISSUE_OTHER_CATEGORY_OPTIONS.find(
      (option) => option.category === category,
    )?.label ?? category
  );
}

export function getAlertIssueEvidenceRequirements(
  scenario: AlertIssueScenario,
): AlertIssueEvidenceKey[] {
  return EVIDENCE_REQUIREMENTS_BY_SCENARIO[scenario];
}
