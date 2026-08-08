import { SUPPORTED_BUFF_EXPIRY_BUFF_IDS } from "../../domain/buff-expiry/catalog";
import { getBuffExpiryEffectiveAlertLeadSeconds } from "../../domain/buff-expiry/alertLeadPolicy";
import { getBuffExpiryPrecisionSelectedTargetGroups } from "../../domain/buff-expiry/precisionTrackingPolicy";
import { getSkillBuffDurationTargetForSkill } from "../../lib/skillBuffDuration/skillBuffDurationTargets";
import type { AlertReportIncidentIssue } from "../../contracts/reporting/alertReportIncident";
import type { RuntimeAssetHealthSnapshot } from "../../runtime/runtime-assets/runtimeAssetHealthController";
import type {
  BuffExpiryAlertConfig,
  BoosterExpiryAlertConfig,
  HuntStallAlertConfig,
  RuneAlertConfig,
  SkillConfig,
  SpecialCoreAlertConfig,
  UltimaRaidEquipmentAlertConfig,
} from "../../types";
import type { ReportFrameSourceDiagnostics } from "../../contracts/reporting/frameSourceDiagnostics";

export type CaptureDiagnostics = {
  hasStream: boolean;
  size: { width: number; height: number } | null;
  layoutKey: string | null;
  frameSource?: ReportFrameSourceDiagnostics;
};

export type ViewportDiagnostics = {
  userAgent: string;
  viewport: {
    width: number;
    height: number;
  };
  runtimeAssets?: RuntimeAssetHealthSnapshot;
};

export type ReportBase = {
  submittedAt: string;
  url: string;
  viewportDiagnostics: ViewportDiagnostics;
};

export type AlertIssueReportDetails = AlertReportIncidentIssue;

export function getRuneConfigSnapshot(runeConfig: RuneAlertConfig) {
  return {
    enabled: runeConfig.enabled,
    region: runeConfig.region,
    regionsByLayout: runeConfig.regionsByLayout ?? {},
    soundId: runeConfig.soundId,
    volume: runeConfig.volume,
    repeatAlertEnabled: runeConfig.repeatAlertEnabled === true,
    repeatAlertIntervalSeconds: runeConfig.repeatAlertIntervalSeconds ?? null,
    repeatAlertMaxCount: runeConfig.repeatAlertMaxCount ?? null,
  };
}

export function getUltimaRaidEquipmentConfigSnapshot(
  config: UltimaRaidEquipmentAlertConfig,
) {
  return {
    enabled: config.enabled,
    region: config.region,
    regionsByLayout: config.regionsByLayout ?? {},
    soundId: config.soundId,
    volume: config.volume,
    repeatAlertEnabled: config.repeatAlertEnabled === true,
    repeatAlertIntervalSeconds: config.repeatAlertIntervalSeconds ?? null,
    repeatAlertMaxCount: config.repeatAlertMaxCount ?? null,
    bossAlert: {
      enabled: config.bossAlert.enabled,
      soundId: config.bossAlert.soundId,
      volume: config.bossAlert.volume,
      repeatAlertEnabled: config.bossAlert.repeatAlertEnabled === true,
      repeatAlertIntervalSeconds:
        config.bossAlert.repeatAlertIntervalSeconds ?? null,
      repeatAlertMaxCount: config.bossAlert.repeatAlertMaxCount ?? null,
    },
  };
}

export function getSkillConfigSnapshot(skill: SkillConfig) {
  const detectionSource = getSkillBuffDurationTargetForSkill(skill)
    ? "buff-duration"
    : skill.detectionSource ?? "quickslot";

  return {
    presetId: skill.presetId ?? null,
    detectionSource,
    name: skill.name,
    enabled: skill.enabled,
    countdownSource: skill.countdownSource,
    durationSeconds: skill.durationSeconds,
    cooldownDurationSeconds: skill.cooldownDurationSeconds ?? null,
    alertThresholdSeconds: skill.alertThresholdSeconds,
    recognitionStartSeconds: skill.recognitionStartSeconds,
    soundId: skill.soundId,
    volume: skill.volume,
    repeatAlertEnabled: skill.repeatAlertEnabled === true,
    repeatAlertIntervalSeconds: skill.repeatAlertIntervalSeconds ?? null,
    repeatAlertMaxCount: skill.repeatAlertMaxCount ?? null,
  };
}

export function getHuntStallConfigSnapshot(config: HuntStallAlertConfig) {
  return {
    enabled: config.enabled,
    mode: config.mode,
    stallThresholdSeconds: config.stallThresholdSeconds,
    manualExperienceRegion: config.manualExperienceRegion,
    manualExperienceRegionsByLayout: config.manualExperienceRegionsByLayout ?? {},
    cooldownRegion: config.cooldownRegion,
    cooldownRegionsByLayout: config.cooldownRegionsByLayout ?? {},
    cooldownMissingThresholdSeconds: config.cooldownMissingThresholdSeconds,
    soundId: config.soundId,
    volume: config.volume,
    repeatAlertEnabled: config.repeatAlertEnabled === true,
    repeatAlertIntervalSeconds: config.repeatAlertIntervalSeconds ?? null,
    repeatAlertMaxCount: config.repeatAlertMaxCount ?? null,
  };
}

export function getBuffExpiryConfigSnapshot(config: BuffExpiryAlertConfig) {
  return {
    enabled: config.enabled,
    alertLeadSeconds: getBuffExpiryEffectiveAlertLeadSeconds(config),
    supportedBuffIds: [...SUPPORTED_BUFF_EXPIRY_BUFF_IDS],
    selectedBuffIds: config.selectedBuffIds,
    selectedPrecisionTargetGroups: getBuffExpiryPrecisionSelectedTargetGroups(config),
    soundId: config.soundId,
    volume: config.volume,
  };
}

export function getBoosterExpiryConfigSnapshot(config: BoosterExpiryAlertConfig) {
  return {
    enabled: config.enabled,
    alertLeadSeconds: config.alertLeadSeconds,
    soundId: config.soundId,
    volume: config.volume,
  };
}

export function getSpecialCoreConfigSnapshot(config: SpecialCoreAlertConfig) {
  return {
    enabled: config.enabled,
    cooldownSeconds: config.cooldownSeconds,
    alertLeadSeconds: config.alertLeadSeconds,
    soundId: config.soundId,
    volume: config.volume,
  };
}
