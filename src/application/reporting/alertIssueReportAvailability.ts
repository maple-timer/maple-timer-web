import {
  createDefaultBoosterExpiryAlert,
  createDefaultBuffExpiryAlert,
  createDefaultHuntStallAlert,
  createDefaultRuneAlert,
  createDefaultSpecialCoreAlert,
  createDefaultUltimaRaidEquipmentAlert,
} from "../../lib/storage";
import type { Profile } from "../../types";

export type AlertIssueReportTarget =
  | { kind: "rune" }
  | { kind: "ultima-raid-equipment" }
  | { kind: "ultima-raid-boss" }
  | { kind: "skill"; skillId: string; skillName: string }
  | { kind: "hunt-stall" }
  | { kind: "buff-expiry" }
  | { kind: "booster-expiry" }
  | { kind: "special-core" };

export function isAlertIssueReportButtonDisabled({
  featureEnabled,
  isGloballyDisabled,
  hasReportPayload,
}: {
  featureEnabled: boolean;
  isGloballyDisabled: boolean;
  hasReportPayload: boolean;
}): boolean {
  return !featureEnabled || isGloballyDisabled || !hasReportPayload;
}

export function getAlertIssueReportUnavailableMessage({
  profile,
  target,
  isGloballyDisabled = false,
}: {
  profile: Profile;
  target: AlertIssueReportTarget;
  isGloballyDisabled?: boolean;
}): string | null {
  if (isGloballyDisabled) {
    return "전체 알림을 다시 켠 뒤 제보할 수 있습니다.";
  }

  const availability = getTargetAvailability(profile, target);
  if (availability.missing) {
    return "제보할 스킬을 찾지 못했습니다.";
  }
  return availability.enabled
    ? null
    : `${availability.label}을 켠 뒤 제보할 수 있습니다.`;
}

function getTargetAvailability(
  profile: Profile,
  target: AlertIssueReportTarget,
): { enabled: boolean; label: string; missing?: boolean } {
  if (target.kind === "skill") {
    const skill = profile.skills.find((item) => item.id === target.skillId);
    return skill
      ? { enabled: skill.enabled, label: "스킬 알림" }
      : { enabled: false, label: "스킬 알림", missing: true };
  }
  if (target.kind === "rune") {
    return {
      enabled: (profile.runeAlert ?? createDefaultRuneAlert()).enabled,
      label: "룬 알림",
    };
  }
  if (target.kind === "ultima-raid-equipment") {
    return {
      enabled: (
        profile.ultimaRaidEquipmentAlert ??
        createDefaultUltimaRaidEquipmentAlert()
      ).enabled,
      label: "울티마 스쿼드 장비 알림",
    };
  }
  if (target.kind === "ultima-raid-boss") {
    return {
      enabled: (
        profile.ultimaRaidEquipmentAlert ??
        createDefaultUltimaRaidEquipmentAlert()
      ).bossAlert.enabled,
      label: "울티마 스쿼드 보스 알림",
    };
  }
  if (target.kind === "hunt-stall") {
    return {
      enabled: (profile.huntStallAlert ?? createDefaultHuntStallAlert()).enabled,
      label: "사냥 멈춤 알림",
    };
  }
  if (target.kind === "buff-expiry") {
    return {
      enabled: (profile.buffExpiryAlert ?? createDefaultBuffExpiryAlert()).enabled,
      label: "버프 종료 알림",
    };
  }
  if (target.kind === "booster-expiry") {
    return {
      enabled: (profile.boosterExpiryAlert ?? createDefaultBoosterExpiryAlert()).enabled,
      label: "부스터 종료 알림",
    };
  }
  if (target.kind === "special-core") {
    return {
      enabled: (profile.specialCoreAlert ?? createDefaultSpecialCoreAlert()).enabled,
      label: "특수 코어 알림",
    };
  }

  const exhaustiveTarget: never = target;
  return exhaustiveTarget;
}
