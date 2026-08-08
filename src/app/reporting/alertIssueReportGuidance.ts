import type { AlertIssueReportGuidance } from "../../contracts/reporting/alertIssueReportGuidance";
import {
  getHuntStallCooldownPresenceReportChecklist,
  getHuntStallManualExperienceReportChecklist,
} from "../../features/alerts/hunt-stall/huntStallChecklist";
import {
  getSkillAlertBuffDurationReportChecklist,
  getSkillAlertQuickslotReportChecklist,
} from "../../features/alerts/skill/skillAlertChecklist";

export const alertIssueReportGuidance: AlertIssueReportGuidance = {
  getSkillQuickslotChecklist: getSkillAlertQuickslotReportChecklist,
  getSkillBuffDurationChecklist: getSkillAlertBuffDurationReportChecklist,
  getHuntStallManualExperienceChecklist:
    getHuntStallManualExperienceReportChecklist,
  getHuntStallCooldownPresenceChecklist:
    getHuntStallCooldownPresenceReportChecklist,
};
