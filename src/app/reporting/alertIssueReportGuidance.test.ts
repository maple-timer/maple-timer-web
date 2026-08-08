import { describe, expect, it } from "vitest";
import {
  getHuntStallCooldownPresenceReportChecklist,
  getHuntStallManualExperienceReportChecklist,
} from "../../features/alerts/hunt-stall/huntStallChecklist";
import {
  getSkillAlertBuffDurationReportChecklist,
  getSkillAlertQuickslotReportChecklist,
} from "../../features/alerts/skill/skillAlertChecklist";
import { alertIssueReportGuidance } from "./alertIssueReportGuidance";

describe("alertIssueReportGuidance", () => {
  it("composes the feature-owned report guidance without copying it", () => {
    expect(alertIssueReportGuidance).toEqual({
      getSkillQuickslotChecklist: getSkillAlertQuickslotReportChecklist,
      getSkillBuffDurationChecklist: getSkillAlertBuffDurationReportChecklist,
      getHuntStallManualExperienceChecklist:
        getHuntStallManualExperienceReportChecklist,
      getHuntStallCooldownPresenceChecklist:
        getHuntStallCooldownPresenceReportChecklist,
    });
  });
});
