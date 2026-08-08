import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponsibilityNoticeModal } from "./ResponsibilityNoticeModal";

describe("ResponsibilityNoticeModal", () => {
  afterEach(cleanup);

  it("shows the responsibility notice and privacy link", () => {
    render(
      <ResponsibilityNoticeModal
        onConfirm={() => undefined}
        onDismissPermanently={() => undefined}
      />,
    );

    expect(screen.getByRole("dialog", { name: "사용 전 확인해주세요" })).toBeInTheDocument();
    expect(screen.getByText("비공식 보조 도구")).toBeInTheDocument();
    expect(screen.getByText("화면 공유 기반 분석")).toBeInTheDocument();
    expect(
      screen.getByText(/별도로 동의한 원격 처리 시험/),
    ).toBeInTheDocument();
    expect(screen.getByText("사용자 책임")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "자세히 보기" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });

  it("confirms for the current session without saving", () => {
    const onConfirm = vi.fn();
    const onDismissPermanently = vi.fn();

    render(
      <ResponsibilityNoticeModal
        onConfirm={onConfirm}
        onDismissPermanently={onDismissPermanently}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "확인하고 시작" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onDismissPermanently).not.toHaveBeenCalled();
  });

  it("saves the hidden preference when requested", () => {
    const onConfirm = vi.fn();
    const onDismissPermanently = vi.fn();

    render(
      <ResponsibilityNoticeModal
        onConfirm={onConfirm}
        onDismissPermanently={onDismissPermanently}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "다시 보지 않기" }));

    expect(onDismissPermanently).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
