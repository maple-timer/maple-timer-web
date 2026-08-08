import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationalStatusPage } from "./OperationalStatusPage";

describe("OperationalStatusPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the normal operating state when there are no active notices", async () => {
    stubFetch({
      available: true,
      incidents: [],
      notices: [],
      updatedAt: null,
      pollIntervalMs: 60_000,
    });

    render(<OperationalStatusPage />);

    expect(await screen.findByText("Maple Timer 상태")).toBeInTheDocument();
    expect(screen.getByText("현재 공지 중인 장애나 점검 안내가 없습니다.")).toBeInTheDocument();
  });

  it("lists active incident timelines", async () => {
    stubFetch({
      available: true,
      incidents: [
        {
          id: "skill-alert-regression",
          level: "warning",
          status: "identified",
          title: "스킬 알림 문제를 수정 중입니다",
          summary: "알림 후 일부 스킬이 다시 감지되지 않는 문제를 확인했습니다.",
          affected: ["스킬 알림"],
          startedAt: "2026-06-23T00:00:00.000Z",
          resolvedAt: null,
          updatedAt: "2026-06-23T00:05:00.000Z",
          link: null,
          updates: [
            {
              id: "investigating",
              status: "investigating",
              body: "원인을 확인 중입니다.",
              createdAt: "2026-06-23T00:00:00.000Z",
            },
            {
              id: "identified",
              status: "identified",
              body: "알림 완료 상태 리셋 문제를 확인했습니다.",
              createdAt: "2026-06-23T00:05:00.000Z",
            },
          ],
        },
      ],
      notices: [
        {
          id: "maintenance",
          level: "maintenance",
          title: "점검 안내",
          body: "일부 기능을 점검 중입니다.",
          dismissible: false,
          link: null,
          updatedAt: "2026-06-23T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-06-23T00:00:00.000Z",
      pollIntervalMs: 60_000,
    });

    render(<OperationalStatusPage />);

    expect(await screen.findByText("Maple Timer 상태")).toBeInTheDocument();
    expect(screen.getByText("스킬 알림 문제를 수정 중입니다")).toBeInTheDocument();
    expect(screen.getByText("알림 후 일부 스킬이 다시 감지되지 않는 문제를 확인했습니다.")).toBeInTheDocument();
    expect(screen.getByText("원인을 확인 중입니다.")).toBeInTheDocument();
    expect(screen.getByText("알림 완료 상태 리셋 문제를 확인했습니다.")).toBeInTheDocument();
  });

  it("keeps legacy notice-only payloads readable", async () => {
    stubFetch({
      available: true,
      notices: [
        {
          id: "maintenance",
          level: "maintenance",
          title: "점검 안내",
          body: "일부 기능을 점검 중입니다.",
          dismissible: false,
          link: null,
          updatedAt: "2026-06-23T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-06-23T00:00:00.000Z",
      pollIntervalMs: 60_000,
    });

    render(<OperationalStatusPage />);

    expect(await screen.findByText("Maple Timer 상태")).toBeInTheDocument();
    expect(screen.getByText("점검 안내")).toBeInTheDocument();
    expect(screen.getByText("일부 기능을 점검 중입니다.")).toBeInTheDocument();
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
