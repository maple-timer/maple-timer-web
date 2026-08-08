import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "./AppHeader";

vi.mock("./pip/PipTimerControl", () => ({
  PipTimerControl: () => null,
}));

vi.mock("./SiteAlertCountBadge", () => ({
  SiteAlertCountBadge: () => null,
}));

vi.mock("./useSiteAlertCount", () => ({
  useSiteAlertCount: () => ({ status: "loading" }),
}));

describe("AppHeader", () => {
  afterEach(cleanup);

  it("renders the screen-share control supplied by app composition", () => {
    render(
      <AppHeader
        skills={[]}
        states={{}}
        runeAlert={{} as never}
        runeRuntime={{} as never}
        generalTimers={[]}
        huntStallAlert={{} as never}
        huntStallRuntime={{} as never}
        buffExpiryAlert={{} as never}
        buffExpiryRuntime={{} as never}
        specialCoreAlert={{} as never}
        specialCoreRuntime={{} as never}
        pipTimer={{} as never}
        screenShareControl={<button type="button">화면 공유 슬롯</button>}
        screenPreviewStream={null}
        screenPreviewSize={null}
        isAllAlertsDisabled={false}
        hasActiveAlerts={false}
        masterVolume={1}
        onPipTimerChange={vi.fn()}
        onToggleAllAlertsDisabled={vi.fn()}
        onMasterVolumeChange={vi.fn()}
        onMessage={vi.fn()}
        onOpenGuide={vi.fn()}
        onOpenFeedback={vi.fn()}
        onOpenDonation={vi.fn()}
        onOpenCustomSounds={vi.fn()}
        onOpenSettingsManager={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "화면 공유 슬롯" }),
    ).toBeInTheDocument();
  });
});
