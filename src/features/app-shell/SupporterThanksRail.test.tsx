import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupporterThanksRail } from "./SupporterThanksRail";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SupporterThanksRail", () => {
  it("renders fallback supporters before the API responds", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));

    render(<SupporterThanksRail onOpenDonation={() => undefined} />);

    expect(screen.getByRole("button", { name: "Maple Timer 후원자 감사 명단 보기" }))
      .toBeInTheDocument();
    expect(screen.getByText("흉폭션")).toBeInTheDocument();
  });

  it("replaces fallback supporters with the runtime API list", async () => {
    const fetchMock = vi.fn(async () => new Response(
        JSON.stringify({
          available: true,
          supporters: [
            { worldId: "luna", worldName: "루나", nickname: "새후원자" },
          ],
        }),
        { status: 200 },
      ));
    vi.stubGlobal("fetch", fetchMock);

    render(<SupporterThanksRail onOpenDonation={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByText("새후원자")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText("흉폭션")).not.toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.maple-timer.com/v1/supporters",
      expect.not.objectContaining({ cache: "no-store" }),
    );
  });
});
