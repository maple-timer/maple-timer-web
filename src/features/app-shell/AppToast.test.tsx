import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppToaster } from "./AppToast";

vi.mock("sonner", () => ({
  Toaster: vi.fn((props: Record<string, unknown>) => (
    <div
      data-testid="app-toaster"
      data-position={String(props.position)}
      data-offset={JSON.stringify(props.offset)}
      data-mobile-offset={JSON.stringify(props.mobileOffset)}
    />
  )),
}));

describe("AppToaster", () => {
  it("keeps toast notifications away from the header screen-share control", () => {
    render(<AppToaster themePreference="system" />);

    const toaster = screen.getByTestId("app-toaster");

    expect(toaster).toHaveAttribute("data-position", "bottom-right");
    expect(toaster).toHaveAttribute("data-offset", JSON.stringify({ right: 18, bottom: 18 }));
    expect(toaster).toHaveAttribute(
      "data-mobile-offset",
      JSON.stringify({ right: 14, bottom: 14, left: 14 }),
    );
  });
});
