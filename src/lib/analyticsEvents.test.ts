import { beforeEach, describe, expect, it, vi } from "vitest";
import { trackAnalyticsEvent } from "./analytics";
import {
  resetFeatureSessionActiveTrackingForTests,
  resetPrecisionParserReadinessTrackingForTests,
  trackAlertPlayed,
  trackBuffExpiryMonitoringStarted,
  trackBuffExpiryTargetGroupChanged,
  trackCaptureLayoutObserved,
  trackCropSelectComplete,
  trackCustomSoundSaved,
  trackCustomSoundSelected,
  trackDonationOpen,
  trackDiscordLaunchCampaignAction,
  trackFeatureSessionActive,
  trackFeatureToggle,
  trackOnboardingAction,
  trackPipTimerConfigChanged,
  trackPipTimerSettingsOpen,
  trackPipTimerToggle,
  trackPresetExport,
  trackPrecisionParserReadiness,
  trackReportOpen,
  trackReportSubmitFailed,
  trackResponsibilityNoticeAction,
  trackScreenShareStart,
  trackThemeChanged,
  trackUsageGuideOpen,
} from "./analyticsEvents";
import { recordGlobalAlertPlayed } from "./globalAlertCounter";

vi.mock("./analytics", () => ({
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock("./globalAlertCounter", () => ({
  recordGlobalAlertPlayed: vi.fn(),
}));

const trackAnalyticsEventMock = vi.mocked(trackAnalyticsEvent);
const recordGlobalAlertPlayedMock = vi.mocked(recordGlobalAlertPlayed);

describe("analyticsEvents", () => {
  beforeEach(() => {
    trackAnalyticsEventMock.mockClear();
    recordGlobalAlertPlayedMock.mockClear();
    resetFeatureSessionActiveTrackingForTests();
    resetPrecisionParserReadinessTrackingForTests();
  });

  it("keeps feature toggle event names and parameter keys stable", () => {
    trackFeatureToggle("rune", true);

    expect(trackAnalyticsEventMock).toHaveBeenCalledWith("feature_toggle", {
      feature: "rune",
      enabled: true,
    });
  });

  it("tracks preset export scope and count", () => {
    trackPresetExport("selected", 1);

    expect(trackAnalyticsEventMock).toHaveBeenCalledWith("preset_export", {
      scope: "selected",
      preset_count: 1,
    });
  });

  it("tracks report events without changing report type keys", () => {
    trackReportOpen("hunt_stall");
    trackReportSubmitFailed("bug", {
      hasFullScreenshot: true,
      hasCropImages: false,
      hasSettings: true,
    });

    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(1, "report_open", {
      report_type: "hunt_stall",
    });
    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(2, "report_submit_failed", {
      report_type: "bug",
      has_full_screenshot: true,
      has_crop_images: false,
      has_settings: true,
    });
  });

  it("tracks screen share and crop selection events", () => {
    trackScreenShareStart("change");
    trackCropSelectComplete("skill");

    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(1, "screen_share_start", {
      action: "change",
    });
    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(2, "crop_select_complete", {
      feature: "skill",
    });
  });

  it("tracks capture layout observations with stable dimensions", () => {
    trackCaptureLayoutObserved({
      captureResolution: "1922x1112",
      captureSurface: "window",
      captureMatch: "known_window_chrome",
      gameResolution: "1920x1080",
    });

    expect(trackAnalyticsEventMock).toHaveBeenCalledWith("capture_layout_observed", {
      capture_resolution: "1922x1112",
      capture_surface: "window",
      capture_match: "known_window_chrome",
      game_resolution: "1920x1080",
    });
  });

  it("tracks product usage events for retention analysis", () => {
    trackAlertPlayed("skill", "initial", {
      alertDetail: "erda-fountain-deep-v2",
      countdownSource: "cooldown",
      detectionMode: "buff_duration",
    });
    trackBuffExpiryMonitoringStarted();
    trackCustomSoundSaved("create");
    trackCustomSoundSelected();

    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(1, "alert_played", {
      feature: "skill",
      action: "initial",
      alert_detail: "erda-fountain-deep-v2",
      countdown_source: "cooldown",
      detection_mode: "buff_duration",
    });
    expect(recordGlobalAlertPlayedMock).toHaveBeenCalledTimes(1);
    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(
      2,
      "buff_expiry_monitoring_started",
      {
        feature: "buff_expiry",
      },
    );
    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(3, "custom_sound_saved", {
      action: "create",
    });
    expect(trackAnalyticsEventMock.mock.calls[3]).toEqual(["custom_sound_selected"]);
  });

  it("tracks feature active sessions once per feature, mode, and item", () => {
    trackFeatureSessionActive("hunt_stall", {
      mode: "manual_experience",
      enabledCount: 1,
    });
    trackFeatureSessionActive("hunt_stall", {
      mode: "manual_experience",
      enabledCount: 1,
    });
    trackFeatureSessionActive("hunt_stall", {
      mode: "cooldown_presence",
      enabledCount: 1,
    });
    trackFeatureSessionActive("skill", {
      mode: "buff_duration",
      item: "erda-fountain-deep-v2",
      enabledCount: 2,
    });

    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(
      1,
      "feature_session_active",
      {
        feature: "hunt_stall",
        mode: "manual_experience",
        item: undefined,
        enabled_count: 1,
      },
    );
    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(
      2,
      "feature_session_active",
      {
        feature: "hunt_stall",
        mode: "cooldown_presence",
        item: undefined,
        enabled_count: 1,
      },
    );
    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(
      3,
      "feature_session_active",
      {
        feature: "skill",
        mode: "buff_duration",
        item: "erda-fountain-deep-v2",
        enabled_count: 2,
      },
    );
  });

  it("tracks newer app shell and PiP interactions with low-cardinality params", () => {
    trackThemeChanged("dark");
    trackDonationOpen();
    trackDiscordLaunchCampaignAction("view");
    trackUsageGuideOpen("onboarding");
    trackOnboardingAction("dismiss");
    trackResponsibilityNoticeAction("confirm");
    trackPipTimerToggle("open");
    trackPipTimerSettingsOpen();
    trackPipTimerConfigChanged("visible_item", { item: "rune", value: false });

    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(1, "theme_changed", {
      value: "dark",
    });
    expect(trackAnalyticsEventMock.mock.calls[1]).toEqual(["donation_open"]);
    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(
      3,
      "discord_launch_campaign_action",
      { action: "view" },
    );
    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(4, "usage_guide_open", {
      source: "onboarding",
    });
    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(5, "onboarding_action", {
      action: "dismiss",
    });
    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(
      6,
      "responsibility_notice_action",
      {
        action: "confirm",
      },
    );
    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(7, "pip_timer_toggle", {
      action: "open",
    });
    expect(trackAnalyticsEventMock.mock.calls[7]).toEqual(["pip_timer_settings_open"]);
    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(9, "pip_timer_config_changed", {
      setting: "visible_item",
      item: "rune",
      value: false,
    });
  });

  it("tracks buff expiry target group selection without high-cardinality values", () => {
    trackBuffExpiryTargetGroupChanged("unionLuck", false, 3);

    expect(trackAnalyticsEventMock).toHaveBeenCalledWith(
      "buff_expiry_target_group_changed",
      {
        group: "unionLuck",
        enabled: false,
        selected_count: 3,
      },
    );
  });

  it("tracks precision parser readiness once per low-cardinality result", () => {
    trackPrecisionParserReadiness("unavailable", "webgpu-unavailable");
    trackPrecisionParserReadiness("unavailable", "webgpu-unavailable");
    trackPrecisionParserReadiness("ready");

    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(
      1,
      "precision_parser_readiness",
      {
        value: "unavailable",
        reason: "webgpu-unavailable",
        item: undefined,
      },
    );
    expect(trackAnalyticsEventMock).toHaveBeenNthCalledWith(
      2,
      "precision_parser_readiness",
      {
        value: "ready",
        reason: undefined,
        item: undefined,
      },
    );
  });
});
