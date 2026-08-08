import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { useAppModalController } from "./useAppModalController";

vi.mock("../../lib/analyticsEvents", () => ({
  trackDiscordLaunchCampaignAction: vi.fn(),
  trackDonationOpen: vi.fn(),
  trackOnboardingAction: vi.fn(),
  trackReportOpen: vi.fn(),
  trackResponsibilityNoticeAction: vi.fn(),
  trackUsageGuideOpen: vi.fn(),
}));

vi.mock("./discordLaunchCampaign", () => ({
  markDiscordLaunchCampaignSeen: vi.fn(),
  shouldShowDiscordLaunchCampaign: vi.fn(),
}));

vi.mock("../../lib/onboarding", () => ({
  shouldShowOnboarding: vi.fn(),
}));

vi.mock("../../lib/responsibilityNotice", () => ({
  saveResponsibilityNoticeDismissed: vi.fn(),
  shouldShowResponsibilityNotice: vi.fn(),
}));

type HookApi = ReturnType<typeof useAppModalController>;

const trackDonationOpenMock = vi.mocked(trackDonationOpen);
const trackDiscordLaunchCampaignActionMock = vi.mocked(
  trackDiscordLaunchCampaignAction,
);
const trackOnboardingActionMock = vi.mocked(trackOnboardingAction);
const trackReportOpenMock = vi.mocked(trackReportOpen);
const trackResponsibilityNoticeActionMock = vi.mocked(trackResponsibilityNoticeAction);
const trackUsageGuideOpenMock = vi.mocked(trackUsageGuideOpen);
const shouldShowOnboardingMock = vi.mocked(shouldShowOnboarding);
const shouldShowResponsibilityNoticeMock = vi.mocked(shouldShowResponsibilityNotice);
const saveResponsibilityNoticeDismissedMock = vi.mocked(saveResponsibilityNoticeDismissed);
const markDiscordLaunchCampaignSeenMock = vi.mocked(markDiscordLaunchCampaignSeen);
const shouldShowDiscordLaunchCampaignMock = vi.mocked(
  shouldShowDiscordLaunchCampaign,
);

function getHookApi(apiRef: { current: HookApi | null }): HookApi {
  if (!apiRef.current) {
    throw new Error("hook api is not ready");
  }
  return apiRef.current;
}

function Harness({ onReady }: { onReady: (api: HookApi) => void }) {
  const api = useAppModalController();

  useEffect(() => {
    onReady(api);
  }, [api, onReady]);

  return null;
}

describe("useAppModalController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shouldShowOnboardingMock.mockReturnValue(true);
    shouldShowResponsibilityNoticeMock.mockReturnValue(true);
    shouldShowDiscordLaunchCampaignMock.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
  });

  it("opens feedback and tracks the general report entry point", async () => {
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).openFeedback();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isFeedbackOpen).toBe(true);
    });
    expect(trackReportOpenMock).toHaveBeenCalledWith("general");

    act(() => {
      getHookApi(apiRef).closeFeedback();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isFeedbackOpen).toBe(false);
    });
  });

  it("opens and closes privacy and usage guide modals", async () => {
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).openPrivacy();
      getHookApi(apiRef).openUsageGuide();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isPrivacyOpen).toBe(true);
      expect(getHookApi(apiRef).isUsageGuideOpen).toBe(true);
    });
    expect(trackUsageGuideOpenMock).toHaveBeenCalledWith("header");

    act(() => {
      getHookApi(apiRef).closePrivacy();
      getHookApi(apiRef).closeUsageGuide();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isPrivacyOpen).toBe(false);
      expect(getHookApi(apiRef).isUsageGuideOpen).toBe(false);
    });
  });

  it("closes onboarding and can route from onboarding into the usage guide", async () => {
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    expect(getHookApi(apiRef).isOnboardingOpen).toBe(true);

    act(() => {
      getHookApi(apiRef).closeOnboarding();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isOnboardingOpen).toBe(false);
    });
    expect(trackOnboardingActionMock).toHaveBeenCalledWith("close");

    cleanup();
    apiRef.current = null;

    render(
      <Harness
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).openGuideFromOnboarding();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isOnboardingOpen).toBe(false);
      expect(getHookApi(apiRef).isUsageGuideOpen).toBe(true);
    });
    expect(trackOnboardingActionMock).toHaveBeenCalledWith("open_guide");
    expect(trackUsageGuideOpenMock).toHaveBeenCalledWith("onboarding");
  });

  it("closes responsibility notice without persisting when confirmed", async () => {
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    expect(getHookApi(apiRef).isResponsibilityNoticeOpen).toBe(true);

    act(() => {
      getHookApi(apiRef).confirmResponsibilityNotice();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isResponsibilityNoticeOpen).toBe(false);
    });
    expect(saveResponsibilityNoticeDismissedMock).not.toHaveBeenCalled();
    expect(trackResponsibilityNoticeActionMock).toHaveBeenCalledWith("confirm");
  });

  it("persists responsibility notice dismissal when dismissed permanently", async () => {
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).dismissResponsibilityNotice();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isResponsibilityNoticeOpen).toBe(false);
    });
    expect(saveResponsibilityNoticeDismissedMock).toHaveBeenCalledWith(true);
    expect(trackResponsibilityNoticeActionMock).toHaveBeenCalledWith("dismiss");
  });

  it("tracks opening the donation modal", async () => {
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).openDonation();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isDonationOpen).toBe(true);
    });
    expect(trackDonationOpenMock).toHaveBeenCalledTimes(1);
  });

  it("records the campaign only when shown and closes after opening Discord", async () => {
    shouldShowDiscordLaunchCampaignMock.mockReturnValue(true);
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    expect(getHookApi(apiRef).isDiscordLaunchCampaignOpen).toBe(true);
    expect(markDiscordLaunchCampaignSeenMock).not.toHaveBeenCalled();

    act(() => {
      getHookApi(apiRef).recordDiscordLaunchCampaignVisible();
      getHookApi(apiRef).recordDiscordLaunchCampaignVisible();
    });

    expect(markDiscordLaunchCampaignSeenMock).toHaveBeenCalledTimes(1);
    expect(trackDiscordLaunchCampaignActionMock).toHaveBeenCalledWith("view");

    act(() => {
      getHookApi(apiRef).openDiscordFromLaunchCampaign();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isDiscordLaunchCampaignOpen).toBe(false);
    });
    expect(trackDiscordLaunchCampaignActionMock).toHaveBeenCalledWith(
      "open_discord",
    );
  });

  it("dismisses the campaign without opening Discord", async () => {
    shouldShowDiscordLaunchCampaignMock.mockReturnValue(true);
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).dismissDiscordLaunchCampaign();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isDiscordLaunchCampaignOpen).toBe(false);
    });
    expect(trackDiscordLaunchCampaignActionMock).toHaveBeenCalledWith("dismiss");
  });
});
