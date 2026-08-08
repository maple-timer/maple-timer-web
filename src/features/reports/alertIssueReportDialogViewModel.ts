import type { AlertIssueReportTarget } from "../../application/reporting/alertIssueReportAvailability";
import {
  ALERT_ISSUE_OTHER_CATEGORY_OPTIONS,
  ALERT_ISSUE_OCCURRENCE_OPTIONS,
  getAlertIssueScenarioOptions as getAlertIssueScenarioOptionsForReason,
  type AlertIssueAffectedTarget,
  type AlertIssueOccurrenceOption,
  type AlertIssueOtherCategoryOption,
  type AlertIssueScenarioOption,
} from "../../contracts/reporting/alertIssueScenario";

export type AlertIssueReportStep = "preflight" | "issue" | "check";

export type AlertIssueReportOption = {
  reason: string;
  label: string;
};

export type AlertIssueReportDialogCopy = {
  title: string;
  description: string;
  isSingleStep: boolean;
  options: AlertIssueReportOption[];
};

const RUNE_REPORT_OPTIONS: AlertIssueReportOption[] = [
  { reason: "rune-missed", label: "룬이 떴는데 감지가 안돼요" },
  { reason: "rune-false-positive", label: "다른 것을 룬으로 감지해요" },
  { reason: "other", label: "기타" },
];

const ULTIMA_RAID_EQUIPMENT_REPORT_OPTIONS: AlertIssueReportOption[] = [
  {
    reason: "ultima-raid-equipment-missed",
    label: "가방이 가득 찼는데 알림이 안 울려요",
  },
  {
    reason: "ultima-raid-equipment-false-alert",
    label: "가방이 가득 차지 않았는데 알림이 울려요",
  },
  {
    reason: "ultima-raid-equipment-rearm",
    label: "가방을 비운 뒤 다음 알림이 안 울려요",
  },
  { reason: "other", label: "기타" },
];

const ULTIMA_RAID_BOSS_REPORT_OPTIONS: AlertIssueReportOption[] = [
  {
    reason: "ultima-raid-boss-missed",
    label: "보스가 등장했는데 알림이 안 울려요",
  },
  {
    reason: "ultima-raid-boss-false-alert",
    label: "보스가 없는데 알림이 울려요",
  },
  {
    reason: "ultima-raid-boss-rearm",
    label: "다음 보스에서 알림이 안 울려요",
  },
  { reason: "other", label: "기타" },
];

const SKILL_REPORT_OPTIONS: AlertIssueReportOption[] = [
  { reason: "skill-not-detected", label: "감지가 안돼요" },
  { reason: "skill-alert-timing", label: "알림 시점이나 반복이 이상해요" },
  { reason: "other", label: "기타" },
];

const HUNT_STALL_REPORT_OPTIONS: AlertIssueReportOption[] = [
  { reason: "hunt-stall-missed", label: "멈췄는데 알림이 안 울려요" },
  { reason: "hunt-stall-false-alert", label: "사냥 중인데 알림이 울려요" },
  { reason: "hunt-stall-reading", label: "경험치 판독이 이상해요" },
  { reason: "other", label: "기타" },
];

const BUFF_EXPIRY_REPORT_OPTIONS: AlertIssueReportOption[] = [
  { reason: "buff-expiry-missed", label: "버프가 꺼졌는데 알림이 안 울려요" },
  { reason: "buff-expiry-false-alert", label: "버프 종료가 아닌데 알림이 울려요" },
  { reason: "buff-expiry-reading", label: "버프/시간 감지가 이상해요" },
  { reason: "other", label: "기타" },
];

const BOOSTER_EXPIRY_REPORT_OPTIONS: AlertIssueReportOption[] = [
  { reason: "booster-expiry-missed", label: "부스터가 끝나는데 알림이 안 울려요" },
  { reason: "booster-expiry-false-alert", label: "부스터 종료가 아닌데 알림이 울려요" },
  { reason: "booster-expiry-reading", label: "부스터 시간이 이상하게 감지돼요" },
  { reason: "other", label: "기타" },
];

const SPECIAL_CORE_REPORT_OPTIONS: AlertIssueReportOption[] = [
  { reason: "special-core-missed", label: "발동했는데 감지가 안돼요" },
  { reason: "special-core-false-alert", label: "발동이 아닌데 알림이 울려요" },
  { reason: "special-core-timing", label: "쿨타임/알림 시간이 이상해요" },
  { reason: "other", label: "기타" },
];

export function getAlertIssueReportOptions(
  target: AlertIssueReportTarget,
): AlertIssueReportOption[] {
  if (target.kind === "rune") {
    return RUNE_REPORT_OPTIONS;
  }
  if (target.kind === "ultima-raid-equipment") {
    return ULTIMA_RAID_EQUIPMENT_REPORT_OPTIONS;
  }
  if (target.kind === "ultima-raid-boss") {
    return ULTIMA_RAID_BOSS_REPORT_OPTIONS;
  }
  if (target.kind === "buff-expiry") {
    return BUFF_EXPIRY_REPORT_OPTIONS;
  }
  if (target.kind === "booster-expiry") {
    return BOOSTER_EXPIRY_REPORT_OPTIONS;
  }
  if (target.kind === "special-core") {
    return SPECIAL_CORE_REPORT_OPTIONS;
  }
  if (target.kind === "hunt-stall") {
    return HUNT_STALL_REPORT_OPTIONS;
  }
  return SKILL_REPORT_OPTIONS;
}

export function getAlertIssueReportDialogCopy(
  target: AlertIssueReportTarget,
): AlertIssueReportDialogCopy {
  const options = getAlertIssueReportOptions(target);

  if (target.kind === "rune") {
    return {
      title: "룬 감지 제보",
      description: "룬 감지가 다르게 동작한 상황을 알려주세요.",
      isSingleStep: false,
      options,
    };
  }
  if (target.kind === "ultima-raid-equipment") {
    return {
      title: "울티마 스쿼드 장비 감지 제보",
      description: "장비 가방 알림이 다르게 동작한 상황을 알려주세요.",
      isSingleStep: false,
      options,
    };
  }
  if (target.kind === "ultima-raid-boss") {
    return {
      title: "울티마 스쿼드 보스 감지 제보",
      description: "보스 등장 알림이 다르게 동작한 상황을 알려주세요.",
      isSingleStep: false,
      options,
    };
  }
  if (target.kind === "buff-expiry") {
    return {
      title: "버프 종료 감지 제보",
      description: "버프 종료 알림이 다르게 동작한 상황을 알려주세요.",
      isSingleStep: false,
      options,
    };
  }
  if (target.kind === "booster-expiry") {
    return {
      title: "부스터 종료 감지 제보",
      description: "부스터 종료 알림이 다르게 동작한 상황을 알려주세요.",
      isSingleStep: false,
      options,
    };
  }
  if (target.kind === "hunt-stall") {
    return {
      title: "사냥 멈춤 감지 제보",
      description: "사냥 멈춤 알림이 다르게 동작한 상황을 알려주세요.",
      isSingleStep: false,
      options,
    };
  }
  if (target.kind === "special-core") {
    return {
      title: "특수코어 감지 제보",
      description: "특수 코어 알림이 다르게 동작한 상황을 알려주세요.",
      isSingleStep: false,
      options,
    };
  }
  return {
    title: "스킬 감지 제보",
    description: `${target.skillName} 감지가 다르게 동작한 상황을 알려주세요.`,
    isSingleStep: false,
    options,
  };
}

export function getAlertIssueReportSelectedOption({
  options,
  selectedReason,
}: {
  options: AlertIssueReportOption[];
  selectedReason: string;
}): AlertIssueReportOption {
  return options.find((option) => option.reason === selectedReason) ?? options[0];
}

export function getAlertIssueReportScenarioOptions(
  selectedReason: string,
): AlertIssueScenarioOption[] {
  return getAlertIssueScenarioOptionsForReason(selectedReason);
}

export function getAlertIssueReportOccurrenceOptions(): AlertIssueOccurrenceOption[] {
  return ALERT_ISSUE_OCCURRENCE_OPTIONS;
}

export function getAlertIssueReportOtherCategoryOptions(): AlertIssueOtherCategoryOption[] {
  return ALERT_ISSUE_OTHER_CATEGORY_OPTIONS;
}

export function getAlertIssueReportAffectedTargetOptions(
  target: AlertIssueReportTarget,
): AlertIssueAffectedTarget[] {
  if (target.kind !== "buff-expiry") {
    return [];
  }
  return [
    { id: "unknown", label: "어떤 버프인지 모르겠어요" },
    { id: "unionWealth", label: "유니온의 부" },
    { id: "unionLuck", label: "유니온의 행운" },
    { id: "potion", label: "비약" },
    { id: "expCoupon", label: "경험치 쿠폰" },
  ];
}

export function getAlertIssueReportStepTitle(step: AlertIssueReportStep): string {
  if (step === "preflight") {
    return "제보 전에 확인해주세요";
  }
  return step === "issue" ? "어떤 문제가 있었나요?" : "보내기 전에 확인해주세요";
}

export function getAlertIssueReportSubmitLabel({
  isSingleStep,
  isSubmitting,
  step,
}: {
  isSingleStep: boolean;
  isSubmitting: boolean;
  step: AlertIssueReportStep;
}): string {
  if (isSubmitting) {
    return "전송 중";
  }
  if (step === "preflight") {
    return "문제 선택하기";
  }
  if (isSingleStep || step === "check") {
    return "보내기";
  }
  return "다음";
}

export function getAlertIssueReportCheckPanelClassName(
  target: AlertIssueReportTarget,
): string {
  return target.kind === "skill"
    ? "issue-report-check-panel skill-issue-check-panel"
    : "issue-report-check-panel";
}
