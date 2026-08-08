import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingModal } from "./OnboardingModal";

describe("OnboardingModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the guide video and setup steps", () => {
    render(<OnboardingModal onClose={() => undefined} onDismissPermanently={() => undefined} />);

    expect(screen.getByRole("dialog", { name: "처음 설정은 이렇게 합니다" })).toBeInTheDocument();
    expect(screen.getByLabelText("Maple Timer 사용 방법 영상")).toHaveAttribute(
      "src",
      "/media/getting-started-guide.mp4",
    );
    expect(screen.getByLabelText("Maple Timer 사용 방법 영상")).not.toHaveAttribute("controls");
    expect(screen.getByText("화면 공유")).toBeInTheDocument();
    expect(screen.getByText("기능 켜기")).toBeInTheDocument();
    expect(screen.getByText("영역 선택")).toBeInTheDocument();
    expect(screen.getByText("알림 조정")).toBeInTheDocument();
    expect(screen.getByText("보스용 알림")).toBeInTheDocument();
    expect(screen.getAllByText("제보하기")).toHaveLength(2);
    expect(screen.queryByText("퀵슬롯 스킬 아이콘 선택")).not.toBeInTheDocument();
    expect(screen.getByText(/Chrome, Edge, 네이버 웨일, Brave/)).toBeInTheDocument();
  });

  it("closes without saving when the start button is clicked", () => {
    const onClose = vi.fn();
    const onDismissPermanently = vi.fn();

    render(<OnboardingModal onClose={onClose} onDismissPermanently={onDismissPermanently} />);

    fireEvent.click(screen.getByRole("button", { name: "시작하기" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDismissPermanently).not.toHaveBeenCalled();
  });

  it("saves the hidden preference when requested", () => {
    const onClose = vi.fn();
    const onDismissPermanently = vi.fn();

    render(<OnboardingModal onClose={onClose} onDismissPermanently={onDismissPermanently} />);

    fireEvent.click(screen.getByRole("button", { name: "다시 보지 않기" }));

    expect(onDismissPermanently).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens the detailed guide when requested", () => {
    const onOpenGuide = vi.fn();

    render(
      <OnboardingModal
        onClose={() => undefined}
        onOpenGuide={onOpenGuide}
        onDismissPermanently={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "자세히 보기" }));

    expect(onOpenGuide).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();

    render(<OnboardingModal onClose={onClose} onDismissPermanently={() => undefined} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
