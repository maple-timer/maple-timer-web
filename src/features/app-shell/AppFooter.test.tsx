import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppFooter } from "./AppFooter";

describe("AppFooter", () => {
  afterEach(() => {
    cleanup();
  });

  it("links to both external inquiry channels and opens the privacy notice", () => {
    const onOpenPrivacy = vi.fn();
    render(<AppFooter onOpenPrivacy={onOpenPrivacy} />);

    const discordLink = screen.getByRole("link", { name: "디스코드" });
    expect(discordLink).toHaveAttribute(
      "href",
      "https://discord.gg/ACXssjgs9g",
    );
    expect(discordLink).toHaveAttribute("target", "_blank");
    const discordIcon = discordLink.querySelector(".discord-brand-icon");
    expect(discordIcon).toBeInTheDocument();
    expect(discordIcon?.querySelector("path")).toHaveAttribute("fill", "currentColor");
    expect(screen.getByRole("link", { name: "카카오톡" })).toHaveAttribute(
      "href",
      "https://open.kakao.com/o/sjmV5jti",
    );

    const footerItems = screen.getByRole("navigation", { name: "서비스 안내" }).children;
    expect(Array.from(footerItems).map((item) => item.textContent)).toEqual([
      "개인정보",
      "디스코드",
      "카카오톡",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "개인정보" }));
    expect(onOpenPrivacy).toHaveBeenCalledTimes(1);
  });
});
