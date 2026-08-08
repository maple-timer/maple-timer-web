export type AlertIssueReportGuidance = {
  getSkillQuickslotChecklist(): string[];
  getSkillBuffDurationChecklist(
    targetName: string,
    valueSubject?: string,
  ): string[];
  getHuntStallManualExperienceChecklist(): string[];
  getHuntStallCooldownPresenceChecklist(): string[];
};
