import { useCallback, useState } from "react";
import type { MutableRefObject } from "react";
import type { AlertIssueReportTarget } from "../../application/reporting/alertIssueReportAvailability";
import type { AlertIssueReportDetails } from "./alertReportPayloads";
import {
  type ReportAnalyticsType,
  trackReportOpen,
  trackReportSubmitFailed,
  trackReportSubmitStart,
  trackReportSubmitSuccess,
} from "../../lib/analyticsEvents";
import type { Profile } from "../../types";
import { getAlertIssueReportUnavailableMessage } from "../../application/reporting/alertIssueReportAvailability";
import type {
  AlertIncidentJournal,
  AlertIncidentJournalSelection,
} from "../../application/reporting/alertIncidentJournal";

type AlertIssueReportSubmitter = (
  issue: AlertIssueReportDetails,
  journalSelection?: AlertIncidentJournalSelection | null,
) => Promise<boolean>;

const unavailableAlertIssueSubmitter: AlertIssueReportSubmitter = async () =>
  false;
const ignoreFrozenEvidence = () => undefined;

export function useIssueReportController({
  profileRef,
  submitRuneIssueReport,
  submitUltimaRaidEquipmentIssueReport = unavailableAlertIssueSubmitter,
  submitUltimaRaidBossIssueReport = unavailableAlertIssueSubmitter,
  submitSkillIssueReport,
  submitHuntStallIssueReport,
  submitBuffExpiryIssueReport,
  submitBoosterExpiryIssueReport,
  submitSpecialCoreIssueReport,
  freezeRuneIssueReportEvidence,
  clearRuneIssueReportEvidence,
  freezeUltimaRaidEquipmentIssueReportEvidence = ignoreFrozenEvidence,
  freezeUltimaRaidBossIssueReportEvidence = ignoreFrozenEvidence,
  clearUltimaRaidEquipmentIssueReportEvidence = ignoreFrozenEvidence,
  freezeBuffExpiryIssueReportEvidence,
  clearBuffExpiryIssueReportEvidence,
  freezeSkillIssueReportEvidence,
  clearSkillIssueReportEvidence,
  freezeHuntStallIssueReportEvidence,
  clearHuntStallIssueReportEvidence,
  freezeBoosterExpiryIssueReportEvidence,
  clearBoosterExpiryIssueReportEvidence,
  freezeSpecialCoreIssueReportEvidence,
  clearSpecialCoreIssueReportEvidence,
  isGloballyDisabled,
  alertIncidentJournal,
  setMessage,
}: {
  profileRef: MutableRefObject<Profile>;
  submitRuneIssueReport: AlertIssueReportSubmitter;
  submitUltimaRaidEquipmentIssueReport?: AlertIssueReportSubmitter;
  submitUltimaRaidBossIssueReport?: AlertIssueReportSubmitter;
  submitSkillIssueReport: (
    skillId: string,
    issue: AlertIssueReportDetails,
    journalSelection?: AlertIncidentJournalSelection | null,
  ) => Promise<boolean>;
  submitHuntStallIssueReport: AlertIssueReportSubmitter;
  submitBuffExpiryIssueReport: AlertIssueReportSubmitter;
  submitBoosterExpiryIssueReport: AlertIssueReportSubmitter;
  submitSpecialCoreIssueReport: AlertIssueReportSubmitter;
  freezeRuneIssueReportEvidence: (capturedAt: number) => void;
  clearRuneIssueReportEvidence: () => void;
  freezeUltimaRaidEquipmentIssueReportEvidence?: (
    capturedAt: number,
  ) => void;
  freezeUltimaRaidBossIssueReportEvidence?: (capturedAt: number) => void;
  clearUltimaRaidEquipmentIssueReportEvidence?: () => void;
  freezeBuffExpiryIssueReportEvidence: (capturedAt: number) => void;
  clearBuffExpiryIssueReportEvidence: () => void;
  freezeSkillIssueReportEvidence: (
    skillId: string,
    capturedAt: number,
  ) => void;
  clearSkillIssueReportEvidence: () => void;
  freezeHuntStallIssueReportEvidence: (
    capturedAt: number,
    journalSelection?: AlertIncidentJournalSelection | null,
  ) => void;
  clearHuntStallIssueReportEvidence: () => void;
  freezeBoosterExpiryIssueReportEvidence: (
    capturedAt: number,
    journalSelection?: AlertIncidentJournalSelection | null,
  ) => void;
  clearBoosterExpiryIssueReportEvidence: () => void;
  freezeSpecialCoreIssueReportEvidence: (
    capturedAt: number,
    journalSelection?: AlertIncidentJournalSelection | null,
  ) => void;
  clearSpecialCoreIssueReportEvidence: () => void;
  isGloballyDisabled: boolean;
  alertIncidentJournal?: AlertIncidentJournal;
  setMessage: (message: string) => void;
}) {
  const [issueReportTarget, setIssueReportTarget] = useState<AlertIssueReportTarget | null>(null);
  const [journalSelection, setJournalSelection] =
    useState<AlertIncidentJournalSelection | null>(null);

  const clearFrozenIssueReportEvidence = useCallback(() => {
    clearRuneIssueReportEvidence();
    clearUltimaRaidEquipmentIssueReportEvidence();
    clearBuffExpiryIssueReportEvidence();
    clearSkillIssueReportEvidence();
    clearHuntStallIssueReportEvidence();
    clearBoosterExpiryIssueReportEvidence();
    clearSpecialCoreIssueReportEvidence();
  }, [
    clearBoosterExpiryIssueReportEvidence,
    clearBuffExpiryIssueReportEvidence,
    clearHuntStallIssueReportEvidence,
    clearRuneIssueReportEvidence,
    clearUltimaRaidEquipmentIssueReportEvidence,
    clearSkillIssueReportEvidence,
    clearSpecialCoreIssueReportEvidence,
  ]);

  const openIssueReport = useCallback(
    (target: AlertIssueReportTarget) => {
      const unavailableMessage = getAlertIssueReportUnavailableMessage({
        profile: profileRef.current,
        target,
        isGloballyDisabled,
      });
      if (unavailableMessage) {
        setMessage(unavailableMessage);
        return;
      }

      const capturedAt = Date.now();
      clearFrozenIssueReportEvidence();
      const nextJournalSelection =
        alertIncidentJournal?.freeze(
          getAlertIncidentJournalTarget(target),
          capturedAt,
        ) ?? null;
      if (target.kind === "rune") {
        freezeRuneIssueReportEvidence(capturedAt);
      } else if (target.kind === "ultima-raid-equipment") {
        freezeUltimaRaidEquipmentIssueReportEvidence(capturedAt);
      } else if (target.kind === "ultima-raid-boss") {
        freezeUltimaRaidBossIssueReportEvidence(capturedAt);
      } else if (target.kind === "buff-expiry") {
        freezeBuffExpiryIssueReportEvidence(capturedAt);
      } else if (target.kind === "skill") {
        freezeSkillIssueReportEvidence(target.skillId, capturedAt);
      } else if (target.kind === "hunt-stall") {
        freezeHuntStallIssueReportEvidence(capturedAt, nextJournalSelection);
      } else if (target.kind === "booster-expiry") {
        freezeBoosterExpiryIssueReportEvidence(capturedAt, nextJournalSelection);
      } else if (target.kind === "special-core") {
        freezeSpecialCoreIssueReportEvidence(capturedAt, nextJournalSelection);
      }
      trackReportOpen(getAlertReportType(target));
      setJournalSelection(nextJournalSelection);
      setIssueReportTarget(target);
    },
    [
      alertIncidentJournal,
      clearFrozenIssueReportEvidence,
      freezeBuffExpiryIssueReportEvidence,
      freezeBoosterExpiryIssueReportEvidence,
      freezeHuntStallIssueReportEvidence,
      freezeRuneIssueReportEvidence,
      freezeUltimaRaidEquipmentIssueReportEvidence,
      freezeUltimaRaidBossIssueReportEvidence,
      freezeSkillIssueReportEvidence,
      freezeSpecialCoreIssueReportEvidence,
      isGloballyDisabled,
      profileRef,
      setMessage,
    ],
  );

  const openSkillIssueReport = useCallback(
    (skillId: string) => {
      const skill = profileRef.current.skills.find((item) => item.id === skillId);
      if (!skill) {
        setMessage("제보할 스킬을 찾지 못했습니다.");
        return;
      }

      openIssueReport({ kind: "skill", skillId, skillName: skill.name });
    },
    [openIssueReport, profileRef, setMessage],
  );

  const openRuneIssueReport = useCallback(() => {
    openIssueReport({ kind: "rune" });
  }, [openIssueReport]);

  const openUltimaRaidEquipmentIssueReport = useCallback(() => {
    openIssueReport({ kind: "ultima-raid-equipment" });
  }, [openIssueReport]);

  const openUltimaRaidBossIssueReport = useCallback(() => {
    openIssueReport({ kind: "ultima-raid-boss" });
  }, [openIssueReport]);

  const openHuntStallIssueReport = useCallback(() => {
    openIssueReport({ kind: "hunt-stall" });
  }, [openIssueReport]);

  const openBuffExpiryIssueReport = useCallback(() => {
    openIssueReport({ kind: "buff-expiry" });
  }, [openIssueReport]);

  const openBoosterExpiryIssueReport = useCallback(() => {
    openIssueReport({ kind: "booster-expiry" });
  }, [openIssueReport]);

  const openSpecialCoreIssueReport = useCallback(() => {
    openIssueReport({ kind: "special-core" });
  }, [openIssueReport]);

  const closeIssueReport = useCallback(() => {
    clearFrozenIssueReportEvidence();
    setIssueReportTarget(null);
    setJournalSelection(null);
  }, [clearFrozenIssueReportEvidence]);

  const submitIssueReport = useCallback(
    async (issue: AlertIssueReportDetails) => {
      if (!issueReportTarget) {
        return false;
      }

      const unavailableMessage = getAlertIssueReportUnavailableMessage({
        profile: profileRef.current,
        target: issueReportTarget,
        isGloballyDisabled,
      });
      if (unavailableMessage) {
        closeIssueReport();
        setMessage(unavailableMessage);
        return false;
      }

      const reportType = getAlertReportType(issueReportTarget);
      trackReportSubmitStart(reportType);

      try {
        const didSubmit =
          issueReportTarget.kind === "rune"
            ? await submitAlertIssueWithJournal(
                submitRuneIssueReport,
                issue,
                journalSelection,
              )
            : issueReportTarget.kind === "ultima-raid-equipment"
              ? await submitAlertIssueWithJournal(
                  submitUltimaRaidEquipmentIssueReport,
                  issue,
                  journalSelection,
                )
            : issueReportTarget.kind === "ultima-raid-boss"
              ? await submitAlertIssueWithJournal(
                  submitUltimaRaidBossIssueReport,
                  issue,
                  journalSelection,
                )
            : issueReportTarget.kind === "hunt-stall"
              ? await submitAlertIssueWithJournal(
                  submitHuntStallIssueReport,
                  issue,
                  journalSelection,
                )
              : issueReportTarget.kind === "buff-expiry"
                ? await submitAlertIssueWithJournal(
                    submitBuffExpiryIssueReport,
                    issue,
                    journalSelection,
                  )
              : issueReportTarget.kind === "booster-expiry"
                ? await submitAlertIssueWithJournal(
                    submitBoosterExpiryIssueReport,
                    issue,
                    journalSelection,
                  )
              : issueReportTarget.kind === "special-core"
                ? await submitAlertIssueWithJournal(
                    submitSpecialCoreIssueReport,
                    issue,
                    journalSelection,
                  )
              : await submitSkillIssueWithJournal(
                  submitSkillIssueReport,
                  issueReportTarget.skillId,
                  issue,
                  journalSelection,
                );

        if (didSubmit) {
          clearFrozenIssueReportEvidence();
          trackReportSubmitSuccess(reportType);
        } else {
          trackReportSubmitFailed(reportType);
        }
        return didSubmit;
      } catch (error) {
        trackReportSubmitFailed(reportType);
        throw error;
      }
    },
    [
      isGloballyDisabled,
      issueReportTarget,
      journalSelection,
      closeIssueReport,
      clearFrozenIssueReportEvidence,
      profileRef,
      setMessage,
      submitBuffExpiryIssueReport,
      submitBoosterExpiryIssueReport,
      submitHuntStallIssueReport,
      submitRuneIssueReport,
      submitUltimaRaidEquipmentIssueReport,
      submitUltimaRaidBossIssueReport,
      submitSkillIssueReport,
      submitSpecialCoreIssueReport,
    ],
  );

  return {
    issueReportTarget,
    openSkillIssueReport,
    openRuneIssueReport,
    openUltimaRaidEquipmentIssueReport,
    openUltimaRaidBossIssueReport,
    openHuntStallIssueReport,
    openBuffExpiryIssueReport,
    openBoosterExpiryIssueReport,
    openSpecialCoreIssueReport,
    closeIssueReport,
    submitIssueReport,
  };
}

function getAlertIncidentJournalTarget(target: AlertIssueReportTarget) {
  if (target.kind === "skill") {
    return { feature: "skill" as const, targetId: target.skillId };
  }
  if (target.kind === "ultima-raid-equipment") {
    return { feature: "ultima-raid-equipment" as const, targetId: "equipment" };
  }
  if (target.kind === "ultima-raid-boss") {
    return { feature: "ultima-raid-equipment" as const, targetId: "boss" };
  }
  return { feature: target.kind };
}

function submitAlertIssueWithJournal(
  submitter: AlertIssueReportSubmitter,
  issue: AlertIssueReportDetails,
  journalSelection: AlertIncidentJournalSelection | null,
) {
  return journalSelection ? submitter(issue, journalSelection) : submitter(issue);
}

function submitSkillIssueWithJournal(
  submitter: (
    skillId: string,
    issue: AlertIssueReportDetails,
    journalSelection?: AlertIncidentJournalSelection | null,
  ) => Promise<boolean>,
  skillId: string,
  issue: AlertIssueReportDetails,
  journalSelection: AlertIncidentJournalSelection | null,
) {
  return journalSelection
    ? submitter(skillId, issue, journalSelection)
    : submitter(skillId, issue);
}

function getAlertReportType(target: AlertIssueReportTarget): ReportAnalyticsType {
  return target.kind === "hunt-stall"
    ? "hunt_stall"
    : target.kind === "buff-expiry"
      ? "buff_expiry"
    : target.kind === "booster-expiry"
      ? "booster_expiry"
    : target.kind === "special-core"
      ? "special_core"
      : target.kind === "ultima-raid-equipment"
        ? "ultima_raid_equipment"
      : target.kind === "ultima-raid-boss"
        ? "ultima_raid_boss"
        : target.kind;
}
