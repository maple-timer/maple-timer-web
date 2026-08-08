import { trackAnalyticsEvent } from "./analytics";
import { recordGlobalAlertPlayed } from "./globalAlertCounter";
import type { FeedbackKind } from "../contracts/reporting/feedback";
import type { PrecisionParserFailureReason } from "./buffSlotParser/precisionParserAvailability";
import type { PrecisionParserDiagnosticStage } from "../contracts/recognition/precisionParserDiagnostics";

type FeatureToggleName =
  | "all_alerts"
  | "skill"
  | "rune"
  | "ultima_raid_equipment"
  | "ultima_raid_boss"
  | "hunt_stall"
  | "buff_expiry"
  | "booster_expiry"
  | "special_core"
  | "general_timer";
type AlertFeatureName = Exclude<FeatureToggleName, "all_alerts">;
type AlertPlaybackAction = "initial" | "repeat" | "timer";
type AlertPlaybackContext = {
  alertDetail?: string;
  countdownSource?: "cooldown" | "duration";
  detectionMode?: string;
};
type FeatureSessionMode =
  | "quickslot"
  | "buff_duration"
  | "minimap"
  | "inventory_full"
  | "boss_progress"
  | "manual_experience"
  | "cooldown_presence"
  | "precision"
  | "ocr"
  | "buff_slot"
  | "timer";
type FeatureSessionActiveContext = {
  mode: FeatureSessionMode;
  item?: string;
  enabledCount?: number;
};
export type CaptureLayoutAnalyticsContext = {
  captureResolution: string;
  captureSurface: "browser" | "monitor" | "window" | "unknown";
  captureMatch: "known_exact" | "known_window_chrome" | "unknown";
  gameResolution: string;
};
type CropFeatureName = "skill" | "rune" | "hunt_stall" | "ultima_raid_equipment";
type ThemePreferenceName = "system" | "light" | "dark";
type GuideSource = "header" | "onboarding";
type OnboardingAction = "close" | "dismiss" | "open_guide";
type ResponsibilityNoticeAction = "confirm" | "dismiss";
type DiscordLaunchCampaignAction = "view" | "open_discord" | "dismiss";
type PipTimerToggleAction = "open" | "close" | "unsupported" | "failed";
type PipTimerSettingName =
  | "mode"
  | "alert_color"
  | "visible_item"
  | "item_alert_color"
  | "size"
  | "emphasis"
  | "screen_preview"
  | "maker_step"
  | "preview";
export type ReportAnalyticsType =
  | "general"
  | "skill"
  | "rune"
  | "ultima_raid_equipment"
  | "ultima_raid_boss"
  | "hunt_stall"
  | "buff_expiry"
  | "booster_expiry"
  | "special_core";
type ReportSubmitType = ReportAnalyticsType | FeedbackKind;
type ReportSubmitContext = {
  hasFullScreenshot?: boolean;
  hasCropImages?: boolean;
  hasSettings?: boolean;
};

const AnalyticsEvent = {
  alertPlayed: "alert_played",
  buffExpiryMonitoringStarted: "buff_expiry_monitoring_started",
  buffExpiryTargetGroupChanged: "buff_expiry_target_group_changed",
  captureLayoutObserved: "capture_layout_observed",
  cropSelectComplete: "crop_select_complete",
  cropSelectStart: "crop_select_start",
  customSoundSaved: "custom_sound_saved",
  customSoundSelected: "custom_sound_selected",
  donationOpen: "donation_open",
  discordLaunchCampaignAction: "discord_launch_campaign_action",
  featureSessionActive: "feature_session_active",
  featureToggle: "feature_toggle",
  onboardingAction: "onboarding_action",
  pipTimerConfigChanged: "pip_timer_config_changed",
  pipTimerSettingsOpen: "pip_timer_settings_open",
  pipTimerToggle: "pip_timer_toggle",
  precisionParserReadiness: "precision_parser_readiness",
  presetApply: "preset_apply",
  presetDelete: "preset_delete",
  presetExport: "preset_export",
  presetImport: "preset_import",
  presetSave: "preset_save",
  presetUpdate: "preset_update",
  reportOpen: "report_open",
  reportSubmitFailed: "report_submit_failed",
  reportSubmitStart: "report_submit_start",
  reportSubmitSuccess: "report_submit_success",
  screenShareFailed: "screen_share_failed",
  screenShareStart: "screen_share_start",
  screenShareSuccess: "screen_share_success",
  settingsOpen: "settings_open",
  responsibilityNoticeAction: "responsibility_notice_action",
  themeChanged: "theme_changed",
  usageGuideOpen: "usage_guide_open",
} as const;

const AnalyticsParam = {
  action: "action",
  alertDetail: "alert_detail",
  captureMatch: "capture_match",
  captureResolution: "capture_resolution",
  captureSurface: "capture_surface",
  countdownSource: "countdown_source",
  detectionMode: "detection_mode",
  enabled: "enabled",
  feature: "feature",
  gameResolution: "game_resolution",
  group: "group",
  hasCropImages: "has_crop_images",
  hasFullScreenshot: "has_full_screenshot",
  hasSettings: "has_settings",
  item: "item",
  mode: "mode",
  presetCount: "preset_count",
  selectedCount: "selected_count",
  reportType: "report_type",
  reason: "reason",
  scope: "scope",
  setting: "setting",
  source: "source",
  value: "value",
  enabledCount: "enabled_count",
} as const;

const trackedFeatureSessionActiveKeys = new Set<string>();
const trackedPrecisionParserReadinessKeys = new Set<string>();

export function trackFeatureToggle(feature: FeatureToggleName, enabled: boolean) {
  trackAnalyticsEvent(AnalyticsEvent.featureToggle, {
    [AnalyticsParam.feature]: feature,
    [AnalyticsParam.enabled]: enabled,
  });
}

export function trackFeatureSessionActive(
  feature: AlertFeatureName,
  context: FeatureSessionActiveContext,
) {
  const key = `${feature}:${context.mode}:${context.item ?? ""}`;
  if (trackedFeatureSessionActiveKeys.has(key)) {
    return;
  }
  trackedFeatureSessionActiveKeys.add(key);

  trackAnalyticsEvent(AnalyticsEvent.featureSessionActive, {
    [AnalyticsParam.feature]: feature,
    [AnalyticsParam.mode]: context.mode,
    [AnalyticsParam.item]: context.item,
    [AnalyticsParam.enabledCount]: context.enabledCount,
  });
}

export function resetFeatureSessionActiveTrackingForTests() {
  trackedFeatureSessionActiveKeys.clear();
}

export function trackPrecisionParserReadiness(
  status: "ready" | "unavailable",
  reason?: PrecisionParserFailureReason,
  stage?: PrecisionParserDiagnosticStage,
) {
  const key = `${status}:${reason ?? "none"}:${stage ?? "none"}`;
  if (trackedPrecisionParserReadinessKeys.has(key)) {
    return;
  }
  trackedPrecisionParserReadinessKeys.add(key);

  trackAnalyticsEvent(AnalyticsEvent.precisionParserReadiness, {
    [AnalyticsParam.value]: status,
    [AnalyticsParam.reason]: reason,
    [AnalyticsParam.item]: stage,
  });
}

export function resetPrecisionParserReadinessTrackingForTests() {
  trackedPrecisionParserReadinessKeys.clear();
}

export function trackAlertPlayed(
  feature: AlertFeatureName,
  action?: AlertPlaybackAction,
  context: AlertPlaybackContext = {},
) {
  trackAnalyticsEvent(AnalyticsEvent.alertPlayed, {
    [AnalyticsParam.feature]: feature,
    ...(action ? { [AnalyticsParam.action]: action } : {}),
    ...(context.alertDetail
      ? { [AnalyticsParam.alertDetail]: context.alertDetail }
      : {}),
    ...(context.countdownSource
      ? { [AnalyticsParam.countdownSource]: context.countdownSource }
      : {}),
    ...(context.detectionMode
      ? { [AnalyticsParam.detectionMode]: context.detectionMode }
      : {}),
  });
  recordGlobalAlertPlayed();
}

export function trackBuffExpiryMonitoringStarted() {
  trackAnalyticsEvent(AnalyticsEvent.buffExpiryMonitoringStarted, {
    [AnalyticsParam.feature]: "buff_expiry",
  });
}

export function trackBuffExpiryTargetGroupChanged(
  group: string,
  enabled: boolean,
  selectedCount: number,
) {
  trackAnalyticsEvent(AnalyticsEvent.buffExpiryTargetGroupChanged, {
    [AnalyticsParam.group]: group,
    [AnalyticsParam.enabled]: enabled,
    [AnalyticsParam.selectedCount]: selectedCount,
  });
}

export function trackCustomSoundSaved(action: "create" | "update") {
  trackAnalyticsEvent(AnalyticsEvent.customSoundSaved, {
    [AnalyticsParam.action]: action,
  });
}

export function trackCustomSoundSelected() {
  trackAnalyticsEvent(AnalyticsEvent.customSoundSelected);
}

export function trackSettingsOpen() {
  trackAnalyticsEvent(AnalyticsEvent.settingsOpen);
}

export function trackThemeChanged(value: ThemePreferenceName) {
  trackAnalyticsEvent(AnalyticsEvent.themeChanged, {
    [AnalyticsParam.value]: value,
  });
}

export function trackDonationOpen() {
  trackAnalyticsEvent(AnalyticsEvent.donationOpen);
}

export function trackDiscordLaunchCampaignAction(action: DiscordLaunchCampaignAction) {
  trackAnalyticsEvent(AnalyticsEvent.discordLaunchCampaignAction, {
    [AnalyticsParam.action]: action,
  });
}

export function trackUsageGuideOpen(source: GuideSource) {
  trackAnalyticsEvent(AnalyticsEvent.usageGuideOpen, {
    [AnalyticsParam.source]: source,
  });
}

export function trackOnboardingAction(action: OnboardingAction) {
  trackAnalyticsEvent(AnalyticsEvent.onboardingAction, {
    [AnalyticsParam.action]: action,
  });
}

export function trackResponsibilityNoticeAction(action: ResponsibilityNoticeAction) {
  trackAnalyticsEvent(AnalyticsEvent.responsibilityNoticeAction, {
    [AnalyticsParam.action]: action,
  });
}

export function trackPipTimerToggle(action: PipTimerToggleAction) {
  trackAnalyticsEvent(AnalyticsEvent.pipTimerToggle, {
    [AnalyticsParam.action]: action,
  });
}

export function trackPipTimerSettingsOpen() {
  trackAnalyticsEvent(AnalyticsEvent.pipTimerSettingsOpen);
}

export function trackPipTimerConfigChanged(
  setting: PipTimerSettingName,
  context: { item?: string; value?: string | boolean } = {},
) {
  trackAnalyticsEvent(AnalyticsEvent.pipTimerConfigChanged, {
    [AnalyticsParam.setting]: setting,
    [AnalyticsParam.item]: context.item,
    [AnalyticsParam.value]: context.value,
  });
}

export function trackPresetSave() {
  trackAnalyticsEvent(AnalyticsEvent.presetSave);
}

export function trackPresetUpdate() {
  trackAnalyticsEvent(AnalyticsEvent.presetUpdate);
}

export function trackPresetDelete() {
  trackAnalyticsEvent(AnalyticsEvent.presetDelete);
}

export function trackPresetApply() {
  trackAnalyticsEvent(AnalyticsEvent.presetApply);
}

export function trackPresetImport(presetCount: number) {
  trackAnalyticsEvent(AnalyticsEvent.presetImport, {
    [AnalyticsParam.presetCount]: presetCount,
  });
}

export function trackPresetExport(scope: "all" | "selected", presetCount: number) {
  trackAnalyticsEvent(AnalyticsEvent.presetExport, {
    [AnalyticsParam.scope]: scope,
    [AnalyticsParam.presetCount]: presetCount,
  });
}

export function trackReportOpen(reportType: ReportAnalyticsType) {
  trackAnalyticsEvent(AnalyticsEvent.reportOpen, {
    [AnalyticsParam.reportType]: reportType,
  });
}

export function trackReportSubmitStart(
  reportType: ReportSubmitType,
  context: ReportSubmitContext = {},
) {
  trackAnalyticsEvent(
    AnalyticsEvent.reportSubmitStart,
    buildReportSubmitParams(reportType, context),
  );
}

export function trackReportSubmitSuccess(
  reportType: ReportSubmitType,
  context: ReportSubmitContext = {},
) {
  trackAnalyticsEvent(
    AnalyticsEvent.reportSubmitSuccess,
    buildReportSubmitParams(reportType, context),
  );
}

export function trackReportSubmitFailed(
  reportType: ReportSubmitType,
  context: ReportSubmitContext = {},
) {
  trackAnalyticsEvent(
    AnalyticsEvent.reportSubmitFailed,
    buildReportSubmitParams(reportType, context),
  );
}

export function trackScreenShareStart(action: "start" | "change") {
  trackAnalyticsEvent(AnalyticsEvent.screenShareStart, {
    [AnalyticsParam.action]: action,
  });
}

export function trackScreenShareSuccess() {
  trackAnalyticsEvent(AnalyticsEvent.screenShareSuccess);
}

export function trackCaptureLayoutObserved(context: CaptureLayoutAnalyticsContext) {
  trackAnalyticsEvent(AnalyticsEvent.captureLayoutObserved, {
    [AnalyticsParam.captureResolution]: context.captureResolution,
    [AnalyticsParam.captureSurface]: context.captureSurface,
    [AnalyticsParam.captureMatch]: context.captureMatch,
    [AnalyticsParam.gameResolution]: context.gameResolution,
  });
}

export function trackScreenShareFailed() {
  trackAnalyticsEvent(AnalyticsEvent.screenShareFailed);
}

export function trackCropSelectStart(feature: CropFeatureName) {
  trackAnalyticsEvent(AnalyticsEvent.cropSelectStart, {
    [AnalyticsParam.feature]: feature,
  });
}

export function trackCropSelectComplete(feature: CropFeatureName) {
  trackAnalyticsEvent(AnalyticsEvent.cropSelectComplete, {
    [AnalyticsParam.feature]: feature,
  });
}

function buildReportSubmitParams(reportType: ReportSubmitType, context: ReportSubmitContext) {
  return {
    [AnalyticsParam.reportType]: reportType,
    [AnalyticsParam.hasFullScreenshot]: context.hasFullScreenshot,
    [AnalyticsParam.hasCropImages]: context.hasCropImages,
    [AnalyticsParam.hasSettings]: context.hasSettings,
  };
}
