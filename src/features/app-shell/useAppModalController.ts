import { useCallback, useRef, useState } from "react";
import {
  trackDiscordLaunchCampaignAction,
  trackDonationOpen,
  trackOnboardingAction,
  trackReportOpen,
  trackResponsibilityNoticeAction,
  trackUsageGuideOpen,
} from "../../lib/analyticsEvents";
import { shouldShowOnboarding } from "../../lib/onboarding";
import {
  saveResponsibilityNoticeDismissed,
  shouldShowResponsibilityNotice,
} from "../../lib/responsibilityNotice";
import {
  markDiscordLaunchCampaignSeen,
  shouldShowDiscordLaunchCampaign,
} from "./discordLaunchCampaign";

export function useAppModalController() {
  const [isFeedbackOpen, setFeedbackOpen] = useState(false);
  const [isResponsibilityNoticeOpen, setResponsibilityNoticeOpen] = useState(() =>
    shouldShowResponsibilityNotice(),
  );
  const [isOnboardingOpen, setOnboardingOpen] = useState(() => shouldShowOnboarding());
  const [isUsageGuideOpen, setUsageGuideOpen] = useState(false);
  const [isPrivacyOpen, setPrivacyOpen] = useState(false);
  const [isDonationOpen, setDonationOpen] = useState(false);
  const [isDiscordLaunchCampaignOpen, setDiscordLaunchCampaignOpen] = useState(() =>
    shouldShowDiscordLaunchCampaign(),
  );
  const hasRecordedDiscordLaunchCampaignViewRef = useRef(false);

  const openFeedback = useCallback(() => {
    trackReportOpen("general");
    setFeedbackOpen(true);
  }, []);

  const closeFeedback = useCallback(() => {
    setFeedbackOpen(false);
  }, []);

  const openUsageGuide = useCallback(() => {
    trackUsageGuideOpen("header");
    setUsageGuideOpen(true);
  }, []);

  const closeUsageGuide = useCallback(() => {
    setUsageGuideOpen(false);
  }, []);

  const openPrivacy = useCallback(() => {
    setPrivacyOpen(true);
  }, []);

  const closePrivacy = useCallback(() => {
    setPrivacyOpen(false);
  }, []);

  const openDonation = useCallback(() => {
    trackDonationOpen();
    setDonationOpen(true);
  }, []);

  const closeDonation = useCallback(() => {
    setDonationOpen(false);
  }, []);

  const recordDiscordLaunchCampaignVisible = useCallback(() => {
    if (hasRecordedDiscordLaunchCampaignViewRef.current) {
      return;
    }

    hasRecordedDiscordLaunchCampaignViewRef.current = true;
    markDiscordLaunchCampaignSeen();
    trackDiscordLaunchCampaignAction("view");
  }, []);

  const dismissDiscordLaunchCampaign = useCallback(() => {
    trackDiscordLaunchCampaignAction("dismiss");
    setDiscordLaunchCampaignOpen(false);
  }, []);

  const openDiscordFromLaunchCampaign = useCallback(() => {
    trackDiscordLaunchCampaignAction("open_discord");
    setDiscordLaunchCampaignOpen(false);
  }, []);

  const confirmResponsibilityNotice = useCallback(() => {
    trackResponsibilityNoticeAction("confirm");
    setResponsibilityNoticeOpen(false);
  }, []);

  const dismissResponsibilityNotice = useCallback(() => {
    trackResponsibilityNoticeAction("dismiss");
    saveResponsibilityNoticeDismissed(true);
    setResponsibilityNoticeOpen(false);
  }, []);

  const closeOnboarding = useCallback(() => {
    trackOnboardingAction("close");
    setOnboardingOpen(false);
  }, []);

  const openGuideFromOnboarding = useCallback(() => {
    trackOnboardingAction("open_guide");
    trackUsageGuideOpen("onboarding");
    setOnboardingOpen(false);
    setUsageGuideOpen(true);
  }, []);

  const dismissOnboarding = useCallback(() => {
    trackOnboardingAction("dismiss");
    setOnboardingOpen(false);
  }, []);

  return {
    isFeedbackOpen,
    isResponsibilityNoticeOpen,
    isOnboardingOpen,
    isUsageGuideOpen,
    isPrivacyOpen,
    isDonationOpen,
    isDiscordLaunchCampaignOpen,
    openFeedback,
    closeFeedback,
    openUsageGuide,
    closeUsageGuide,
    openPrivacy,
    closePrivacy,
    openDonation,
    closeDonation,
    recordDiscordLaunchCampaignVisible,
    dismissDiscordLaunchCampaign,
    openDiscordFromLaunchCampaign,
    confirmResponsibilityNotice,
    dismissResponsibilityNotice,
    closeOnboarding,
    openGuideFromOnboarding,
    dismissOnboarding,
  };
}
