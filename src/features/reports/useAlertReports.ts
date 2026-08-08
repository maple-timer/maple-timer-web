import type { MutableRefObject, RefObject } from "react";
import type {
  HuntStallRuntimeState,
  HuntStallSnapshot,
  RuneSnapshot,
  RuneRuntimeState,
  SkillReportTimeline,
  SkillSnapshot,
} from "../../alertTypes";
import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../lib/buffExpiry/buffExpiryTypes";
import type {
  BoosterExpiryRuntimeState,
  BoosterExpirySnapshot,
} from "../../lib/boosterExpiry/boosterExpiryTypes";
import type {
  Profile,
  SkillRuntimeState,
} from "../../types";
import { useRuneAlertReports } from "./useRuneAlertReports";
import { useSkillAlertReports } from "./useSkillAlertReports";
import { useHuntStallAlertReports } from "./useHuntStallAlertReports";
import { useBuffExpiryAlertReports } from "./useBuffExpiryAlertReports";
import { useBoosterExpiryAlertReports } from "./useBoosterExpiryAlertReports";
import { useSpecialCoreAlertReports } from "./useSpecialCoreAlertReports";
import type { RuntimeReportEvidenceCoordinator } from "../../contracts/reporting/runtimeReportEvidence";
import type { BuffExpiryIncidentRuntimeRecorder } from "../../runtime/buff-expiry/evidence/buffExpiryIncidentRuntimeRecorder";
import type { SkillIncidentRuntimeRecorder } from "../../runtime/skill-alert/evidence/skillIncidentRuntimeRecorder";
import type { HuntStallIncidentRuntimeRecorder } from "../../runtime/hunt-stall/evidence/huntStallIncidentRuntimeRecorder";
import type {
  SpecialCoreRuntimeState,
  SpecialCoreSnapshot,
} from "../../lib/specialCore";
import type { SpecialCoreIncidentRuntimeRecorder } from "../../runtime/special-core/evidence/specialCoreIncidentRuntimeRecorder";
import type { BoosterExpiryIncidentRuntimeRecorder } from "../../runtime/booster-expiry/evidence/boosterExpiryIncidentRuntimeRecorder";
import type { UltimaRaidEquipmentRuntimeState } from "../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import type { UltimaRaidEquipmentIncidentArchive } from "../../runtime/ultima-raid-equipment/evidence/ultimaRaidEquipmentIncidentEvidence";
import type { UltimaRaidEquipmentSnapshot } from "../../runtime/ultima-raid-equipment/ultimaRaidEquipmentSnapshot";
import { useUltimaRaidEquipmentAlertReports } from "./useUltimaRaidEquipmentAlertReports";
import type { ReportFrameSourceContext } from "../../contracts/reporting/frameSourceDiagnostics";

export function useAlertReports({
  videoRef,
  profileRef,
  runtimeRef,
  skillIncidentRecorderRef,
  runeRuntimeRef,
  runeSnapshotRef,
  ultimaRaidEquipmentRuntimeRef,
  ultimaRaidEquipmentSnapshotRef,
  ultimaRaidEquipmentIncidentArchiveRef,
  huntStallRuntimeRef,
  huntStallIncidentRecorderRef,
  huntStallSnapshotRef,
  buffExpiryRuntimeRef,
  buffExpirySnapshotRef,
  buffExpiryIncidentRecorderRef,
  boosterExpiryRuntimeRef,
  boosterExpirySnapshotRef,
  boosterExpiryIncidentRecorderRef,
  specialCoreRuntimeRef,
  specialCoreSnapshotRef,
  specialCoreIncidentRecorderRef,
  skillReportTimelineRef,
  snapshots,
  reportFrameSourceContext,
  runtimeReportEvidenceCoordinator,
  onMessage,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  profileRef: MutableRefObject<Profile>;
  runtimeRef: MutableRefObject<Record<string, SkillRuntimeState>>;
  skillIncidentRecorderRef: MutableRefObject<SkillIncidentRuntimeRecorder>;
  runeRuntimeRef: MutableRefObject<RuneRuntimeState>;
  runeSnapshotRef: MutableRefObject<RuneSnapshot | null>;
  ultimaRaidEquipmentRuntimeRef: MutableRefObject<UltimaRaidEquipmentRuntimeState>;
  ultimaRaidEquipmentSnapshotRef: MutableRefObject<UltimaRaidEquipmentSnapshot | null>;
  ultimaRaidEquipmentIncidentArchiveRef: MutableRefObject<UltimaRaidEquipmentIncidentArchive>;
  huntStallRuntimeRef: MutableRefObject<HuntStallRuntimeState>;
  huntStallIncidentRecorderRef: MutableRefObject<HuntStallIncidentRuntimeRecorder>;
  huntStallSnapshotRef: MutableRefObject<HuntStallSnapshot | null>;
  buffExpiryRuntimeRef: MutableRefObject<BuffExpiryRuntimeState>;
  buffExpirySnapshotRef: MutableRefObject<BuffExpirySnapshot | null>;
  buffExpiryIncidentRecorderRef: MutableRefObject<BuffExpiryIncidentRuntimeRecorder>;
  boosterExpiryRuntimeRef: MutableRefObject<BoosterExpiryRuntimeState>;
  boosterExpirySnapshotRef: MutableRefObject<BoosterExpirySnapshot | null>;
  boosterExpiryIncidentRecorderRef: MutableRefObject<BoosterExpiryIncidentRuntimeRecorder>;
  specialCoreRuntimeRef: MutableRefObject<SpecialCoreRuntimeState>;
  specialCoreSnapshotRef: MutableRefObject<SpecialCoreSnapshot | null>;
  specialCoreIncidentRecorderRef: MutableRefObject<SpecialCoreIncidentRuntimeRecorder>;
  skillReportTimelineRef: MutableRefObject<Record<string, SkillReportTimeline>>;
  snapshots: Record<string, SkillSnapshot>;
  reportFrameSourceContext: ReportFrameSourceContext;
  runtimeReportEvidenceCoordinator: RuntimeReportEvidenceCoordinator;
  onMessage: (message: string) => void;
}) {
  const {
    isRuneDebugSubmitting,
    isRuneFalsePositiveSubmitting,
    submitRuneDebugSample,
    submitRuneIssueReport,
    freezeRuneIssueReportEvidence,
    clearRuneIssueReportEvidence,
  } = useRuneAlertReports({
    videoRef,
    profileRef,
    runeRuntimeRef,
    runeSnapshotRef,
    currentLayoutKey: reportFrameSourceContext.captureLayoutKey,
    reportFrameSourceContext,
    onMessage,
  });
  const {
    isUltimaRaidEquipmentIssueSubmitting,
    isUltimaRaidBossIssueSubmitting,
    submitUltimaRaidEquipmentIssueReport,
    submitUltimaRaidBossIssueReport,
    freezeUltimaRaidEquipmentIssueReportEvidence,
    freezeUltimaRaidBossIssueReportEvidence,
    clearUltimaRaidEquipmentIssueReportEvidence,
  } = useUltimaRaidEquipmentAlertReports({
    videoRef,
    profileRef,
    runtimeRef: ultimaRaidEquipmentRuntimeRef,
    snapshotRef: ultimaRaidEquipmentSnapshotRef,
    incidentArchiveRef: ultimaRaidEquipmentIncidentArchiveRef,
    currentLayoutKey: reportFrameSourceContext.captureLayoutKey,
    reportFrameSourceContext,
    onMessage,
  });
  const {
    submittingSkillMisreadId,
    submitSkillIssueReport,
    freezeSkillIssueReportEvidence,
    clearSkillIssueReportEvidence,
  } = useSkillAlertReports({
    videoRef,
    profileRef,
    runtimeRef,
    skillIncidentRecorderRef,
    skillReportTimelineRef,
    snapshots,
    currentLayoutKey: reportFrameSourceContext.gameLayoutKey,
    reportFrameSourceContext,
    runtimeReportEvidenceCoordinator,
    onMessage,
  });
  const {
    isHuntStallDebugSubmitting,
    isHuntStallIssueSubmitting,
    submitHuntStallDebugSample,
    submitHuntStallIssueReport,
    freezeHuntStallIssueReportEvidence,
    clearHuntStallIssueReportEvidence,
  } = useHuntStallAlertReports({
    videoRef,
    profileRef,
    huntStallRuntimeRef,
    huntStallIncidentRecorderRef,
    huntStallSnapshotRef,
    currentLayoutKey: reportFrameSourceContext.gameLayoutKey,
    reportFrameSourceContext,
    onMessage,
  });
  const {
    isBuffExpiryIssueSubmitting,
    submitBuffExpiryIssueReport,
    freezeBuffExpiryIssueReportEvidence,
    clearBuffExpiryIssueReportEvidence,
  } = useBuffExpiryAlertReports({
      videoRef,
      profileRef,
      buffExpiryRuntimeRef,
      buffExpirySnapshotRef,
      buffExpiryIncidentRecorderRef,
      currentLayoutKey: reportFrameSourceContext.gameLayoutKey,
      reportFrameSourceContext,
      runtimeReportEvidenceCoordinator,
      onMessage,
    });
  const {
    isBoosterExpiryIssueSubmitting,
    submitBoosterExpiryIssueReport,
    freezeBoosterExpiryIssueReportEvidence,
    clearBoosterExpiryIssueReportEvidence,
  } = useBoosterExpiryAlertReports({
      videoRef,
      profileRef,
      boosterExpiryRuntimeRef,
      boosterExpirySnapshotRef,
      boosterExpiryIncidentRecorderRef,
      currentLayoutKey: reportFrameSourceContext.gameLayoutKey,
      reportFrameSourceContext,
      onMessage,
    });
  const {
    isSpecialCoreIssueSubmitting,
    submitSpecialCoreIssueReport,
    freezeSpecialCoreIssueReportEvidence,
    clearSpecialCoreIssueReportEvidence,
  } = useSpecialCoreAlertReports({
    videoRef,
    profileRef,
    specialCoreRuntimeRef,
    specialCoreSnapshotRef,
    specialCoreIncidentRecorderRef,
    currentLayoutKey: reportFrameSourceContext.gameLayoutKey,
    reportFrameSourceContext,
    onMessage,
  });

  return {
    isRuneDebugSubmitting,
    isRuneFalsePositiveSubmitting,
    isUltimaRaidEquipmentIssueSubmitting,
    isUltimaRaidBossIssueSubmitting,
    isHuntStallDebugSubmitting,
    isHuntStallIssueSubmitting,
    isBuffExpiryIssueSubmitting,
    isBoosterExpiryIssueSubmitting,
    isSpecialCoreIssueSubmitting,
    submittingSkillMisreadId,
    submitRuneDebugSample,
    submitRuneIssueReport,
    freezeRuneIssueReportEvidence,
    clearRuneIssueReportEvidence,
    submitUltimaRaidEquipmentIssueReport,
    submitUltimaRaidBossIssueReport,
    freezeUltimaRaidEquipmentIssueReportEvidence,
    freezeUltimaRaidBossIssueReportEvidence,
    clearUltimaRaidEquipmentIssueReportEvidence,
    submitSkillIssueReport,
    freezeSkillIssueReportEvidence,
    clearSkillIssueReportEvidence,
    submitHuntStallDebugSample,
    submitHuntStallIssueReport,
    freezeHuntStallIssueReportEvidence,
    clearHuntStallIssueReportEvidence,
    submitBuffExpiryIssueReport,
    freezeBuffExpiryIssueReportEvidence,
    clearBuffExpiryIssueReportEvidence,
    submitBoosterExpiryIssueReport,
    freezeBoosterExpiryIssueReportEvidence,
    clearBoosterExpiryIssueReportEvidence,
    submitSpecialCoreIssueReport,
    freezeSpecialCoreIssueReportEvidence,
    clearSpecialCoreIssueReportEvidence,
  };
}
