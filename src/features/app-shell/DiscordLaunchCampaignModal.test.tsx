import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscordLaunchCampaignModal } from "./DiscordLaunchCampaignModal";
import { DISCORD_LAUNCH_CAMPAIGN_INVITE_URL } from "./discordLaunchCampaign";

describe("DiscordLaunchCampaignModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("presents the Discord destination and records a real visible mount once", async () => {
    const onVisible = vi.fn();
    const onOpenDiscord = vi.fn();

    const { container } = render(
      <DiscordLaunchCampaignModal
        onDismiss={() => undefined}
        onOpenDiscord={onOpenDiscord}
        onVisible={onVisible}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "메이플 타이머 디스코드가 열렸습니다" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("운영자에게 직접 문의하고, 화면 사진이나 동영상을 편하게 보내세요."),
    ).toBeInTheDocument();
    expect(screen.getByText("운영자와 직접 문의")).toBeInTheDocument();
    expect(
      screen.getByText("자세한 설명과 함께 사진이나 동영상도 편하게 보낼 수 있어요."),
    ).toBeInTheDocument();
    const discordLink = screen.getByRole("link", { name: /디스코드 둘러보기/ });
    expect(discordLink).toHaveAttribute("href", DISCORD_LAUNCH_CAMPAIGN_INVITE_URL);
    expect(discordLink).toHaveAttribute("target", "_blank");
    const discordIcon = discordLink.querySelector(".discord-brand-icon");
    expect(discordIcon).toBeInTheDocument();
    expect(discordIcon?.querySelector("path")).toHaveAttribute("fill", "#FFFFFF");

    const actions = container.querySelector<HTMLElement>(".discord-campaign-actions")!;
    const footerDismiss = within(actions).getByRole("button", { name: "닫기" });
    expect(actions.children[0]).toBe(discordLink);
    expect(actions.children[1]).toBe(footerDismiss);

    await waitFor(() => {
      expect(onVisible).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(discordLink);
    expect(onOpenDiscord).toHaveBeenCalledTimes(1);
  });

  it("dismisses from the footer, close icon, backdrop, and Escape", () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <DiscordLaunchCampaignModal
        onDismiss={onDismiss}
        onOpenDiscord={() => undefined}
        onVisible={() => undefined}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "닫기" })[1]);
    fireEvent.click(screen.getAllByRole("button", { name: "닫기" })[0]);
    fireEvent.mouseDown(container.querySelector(".discord-campaign-backdrop")!);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(4);
  });
});
