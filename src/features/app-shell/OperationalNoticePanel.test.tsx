import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationalNoticePanel } from "./OperationalNoticePanel";

describe("OperationalNoticePanel", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders live notices and stores dismissals by notice id", async () => {
    stubFetch({
      available: true,
      pollIntervalMs: 60_000,
      updatedAt: "2026-06-23T00:00:00.000Z",
      notices: [
        {
          id: "erda-fountain",
          level: "warning",
          title: "에르다 파운틴 알림 문제를 수정했습니다",
          body: "문제가 계속되면 새로고침 후 제보를 보내주세요.",
          dismissible: true,
          link: { label: "상태 보기", href: "/status" },
          updatedAt: "2026-06-23T00:05:00.000Z",
        },
      ],
    });

    render(<OperationalNoticePanel />);

    expect(await screen.findByText("에르다 파운틴 알림 문제를 수정했습니다")).toBeInTheDocument();
    expect(screen.getByText("문제가 계속되면 새로고침 후 제보를 보내주세요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "상태 보기" })).toHaveAttribute("href", "/status");
    expect(screen.getByRole("link", { name: "상태 보기" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "상태 보기" })).toHaveAttribute("rel", "noreferrer");

    fireEvent.click(screen.getByRole("button", { name: /공지 닫기/ }));

    await waitFor(() => {
      expect(screen.queryByText("에르다 파운틴 알림 문제를 수정했습니다")).not.toBeInTheDocument();
    });
    expect(localStorage.getItem("maple-timer.operational-notices.dismissed.v1")).toContain(
      "erda-fountain",
    );
  });

  it("stays hidden when the notices endpoint is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );

    render(<OperationalNoticePanel />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByLabelText("운영 공지")).not.toBeInTheDocument();
  });

  it("stays hidden after a successful empty response", async () => {
    stubFetch({
      available: true,
      pollIntervalMs: 60_000,
      updatedAt: "2026-08-03T00:00:00.000Z",
      notices: [],
    });

    render(<OperationalNoticePanel />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByLabelText("운영 공지")).not.toBeInTheDocument();
  });

  it("only shows the first notice when multiple banner notices are returned", async () => {
    stubFetch({
      available: true,
      pollIntervalMs: 60_000,
      updatedAt: "2026-06-23T00:00:00.000Z",
      notices: [
        {
          id: "primary",
          level: "critical",
          title: "대표 운영 안내",
          body: "메인에는 이 안내만 표시됩니다.",
          dismissible: true,
          link: { label: "상태 보기", href: "/status" },
          updatedAt: "2026-06-23T00:05:00.000Z",
        },
        {
          id: "secondary",
          level: "warning",
          title: "두 번째 운영 안내",
          body: "상태 페이지에서만 확인합니다.",
          dismissible: true,
          link: { label: "상태 보기", href: "/status" },
          updatedAt: "2026-06-23T00:06:00.000Z",
        },
      ],
    });

    render(<OperationalNoticePanel />);

    expect(await screen.findByText("대표 운영 안내")).toBeInTheDocument();
    expect(screen.queryByText("두 번째 운영 안내")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /공지 닫기/ }));

    await waitFor(() => {
      expect(screen.queryByText("대표 운영 안내")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("두 번째 운영 안내")).not.toBeInTheDocument();
  });
});

function stubFetch(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}
