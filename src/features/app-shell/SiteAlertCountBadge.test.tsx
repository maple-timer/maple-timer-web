import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteAlertCountBadge } from "./SiteAlertCountBadge";
import type { GlobalAlertCountSnapshot } from "../../lib/globalAlertCounter";

const SNAPSHOT: GlobalAlertCountSnapshot = {
  available: true,
  count: 327333,
  counts: {
    today: 12,
    last7Days: 327333,
    month: 327333,
    total: 327333,
  },
  updatedAt: "2026-06-01T12:28:48.285Z",
  pollIntervalMs: 10000,
};

describe("SiteAlertCountBadge", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("cycles through total, today, last 7 days, and last 30 days counts", () => {
    render(<SiteAlertCountBadge snapshot={SNAPSHOT} />);

    const button = screen.getByRole("button", {
      name: "메이플 타이머가 알려준 전체 알림 횟수 327,333회",
    });

    expect(button).toHaveTextContent("전체");
    expect(button).toHaveTextContent("회");

    fireEvent.click(button);
    expect(button).toHaveAccessibleName("메이플 타이머가 알려준 오늘 알림 횟수 12회");
    expect(button).toHaveTextContent("오늘");

    fireEvent.click(button);
    expect(button).toHaveAccessibleName("메이플 타이머가 알려준 최근 일주일 알림 횟수 327,333회");
    expect(button).toHaveTextContent("일주일");

    fireEvent.click(button);
    expect(button).toHaveAccessibleName("메이플 타이머가 알려준 최근 한 달 알림 횟수 327,333회");
    expect(button).toHaveTextContent("한 달");

    fireEvent.click(button);
    expect(button).toHaveAccessibleName("메이플 타이머가 알려준 전체 알림 횟수 327,333회");
    expect(button).toHaveTextContent("전체");
  });

  it("automatically cycles periods and pauses while the user is hovering", () => {
    vi.useFakeTimers();
    render(<SiteAlertCountBadge snapshot={SNAPSHOT} />);

    const button = screen.getByRole("button", {
      name: "메이플 타이머가 알려준 전체 알림 횟수 327,333회",
    });

    act(() => {
      vi.advanceTimersByTime(7_000);
    });
    expect(button).toHaveAccessibleName("메이플 타이머가 알려준 오늘 알림 횟수 12회");

    fireEvent.mouseEnter(button);
    act(() => {
      vi.advanceTimersByTime(7_000);
    });
    expect(button).toHaveAccessibleName("메이플 타이머가 알려준 오늘 알림 횟수 12회");

    fireEvent.mouseLeave(button);
    act(() => {
      vi.advanceTimersByTime(7_000);
    });
    expect(button).toHaveAccessibleName("메이플 타이머가 알려준 최근 일주일 알림 횟수 327,333회");
  });
});
