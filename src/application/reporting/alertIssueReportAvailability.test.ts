import { describe, expect, it } from "vitest";
import { createDefaultProfile, createSkill } from "../../lib/storage";
import {
  getAlertIssueReportUnavailableMessage,
  isAlertIssueReportButtonDisabled,
} from "./alertIssueReportAvailability";

describe("alertIssueReportAvailability", () => {
  it.each([
    {
      name: "feature off",
      input: { featureEnabled: false, isGloballyDisabled: false, hasReportPayload: true },
    },
    {
      name: "all alerts off",
      input: { featureEnabled: true, isGloballyDisabled: true, hasReportPayload: true },
    },
    {
      name: "report evidence missing",
      input: { featureEnabled: true, isGloballyDisabled: false, hasReportPayload: false },
    },
  ])("disables the report button when $name", ({ input }) => {
    expect(isAlertIssueReportButtonDisabled(input)).toBe(true);
  });

  it("enables the report button only while the feature and evidence are active", () => {
    expect(
      isAlertIssueReportButtonDisabled({
        featureEnabled: true,
        isGloballyDisabled: false,
        hasReportPayload: true,
      }),
    ).toBe(false);
  });

  it("returns feature-specific messages for every disabled alert report target", () => {
    const skill = createSkill({ id: "skill-disabled", enabled: false });
    const defaults = createDefaultProfile();
    const profile = {
      ...defaults,
      skills: [skill],
      runeAlert: { ...defaults.runeAlert!, enabled: false },
      huntStallAlert: { ...defaults.huntStallAlert!, enabled: false },
      buffExpiryAlert: { ...defaults.buffExpiryAlert!, enabled: false },
      boosterExpiryAlert: { ...defaults.boosterExpiryAlert!, enabled: false },
      specialCoreAlert: { ...defaults.specialCoreAlert!, enabled: false },
    };

    expect(
      getAlertIssueReportUnavailableMessage({
        profile,
        target: { kind: "skill", skillId: skill.id, skillName: skill.name },
      }),
    ).toBe("스킬 알림을 켠 뒤 제보할 수 있습니다.");
    expect(
      getAlertIssueReportUnavailableMessage({ profile, target: { kind: "rune" } }),
    ).toBe("룬 알림을 켠 뒤 제보할 수 있습니다.");
    expect(
      getAlertIssueReportUnavailableMessage({ profile, target: { kind: "hunt-stall" } }),
    ).toBe("사냥 멈춤 알림을 켠 뒤 제보할 수 있습니다.");
    expect(
      getAlertIssueReportUnavailableMessage({ profile, target: { kind: "buff-expiry" } }),
    ).toBe("버프 종료 알림을 켠 뒤 제보할 수 있습니다.");
    expect(
      getAlertIssueReportUnavailableMessage({ profile, target: { kind: "booster-expiry" } }),
    ).toBe("부스터 종료 알림을 켠 뒤 제보할 수 있습니다.");
    expect(
      getAlertIssueReportUnavailableMessage({ profile, target: { kind: "special-core" } }),
    ).toBe("특수 코어 알림을 켠 뒤 제보할 수 있습니다.");
  });

  it("prioritizes the global disabled state", () => {
    expect(
      getAlertIssueReportUnavailableMessage({
        profile: createDefaultProfile(),
        target: { kind: "rune" },
        isGloballyDisabled: true,
      }),
    ).toBe("전체 알림을 다시 켠 뒤 제보할 수 있습니다.");
  });
});
