import { createRef } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ALERT_SOUND_ID } from "../../lib/sounds";
import type { SkillConfig } from "../../types";
import { CapturePanel } from "./CapturePanel";
import { WINDOWS_CAPTURE_NOTICE_STORAGE_KEY } from "./windowsCaptureNotice";

function makeSkill(partial: Partial<SkillConfig> = {}): SkillConfig {
  return {
    id: partial.id ?? "skill-1",
    name: partial.name ?? "새 스킬",
    countdownSource: partial.countdownSource ?? "duration",
    durationSeconds: partial.durationSeconds ?? 60,
    alertThresholdSeconds: partial.alertThresholdSeconds ?? 5,
    recognitionStartSeconds: partial.recognitionStartSeconds ?? 60,
    region: partial.region ?? { x: 0.1, y: 0.2, width: 0.04, height: 0.04 },
    recognitionMode: partial.recognitionMode ?? "digit-template",
    soundId: partial.soundId ?? DEFAULT_ALERT_SOUND_ID,
    volume: partial.volume ?? 0.85,
    repeat: partial.repeat,
    enabled: partial.enabled ?? true,
  };
}

const baseProps = {
  captureStatus: "idle" as const,
  captureSize: { width: 1920, height: 1080 },
  videoRef: createRef<HTMLVideoElement>(),
  isCollapsed: false,
  onStartCapture: () => undefined,
  onChangeCapture: () => undefined,
  onToggleCollapsed: () => undefined,
  onMetadata: () => undefined,
};

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
}

describe("CapturePanel", () => {
  beforeEach(() => {
    localStorage.clear();
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the first-share button in the video placeholder", () => {
    render(
      <CapturePanel
        {...baseProps}
        stream={null}
        skills={[makeSkill()]}
      />,
    );

    expect(screen.getByRole("heading", { name: "화면 공유" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "화면 공유 시작" })).toBeInTheDocument();
    const checklistButton = screen.getByRole("button", { name: "화면 공유 체크리스트" });
    expect(checklistButton).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "화면 공유 처리 안내" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Windows 10 장시간 화면공유 안내" })).not.toBeInTheDocument();

    fireEvent.focus(checklistButton);

    expect(screen.getByText("화면 공유 전 확인해주세요.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "확장 UI를 사용한다면 화면 공유 메뉴에서 게임 영역을 설정해주세요.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/설정한 게임 영역은 화면을 변경하거나 공유 크기가 달라지면/),
    ).toBeInTheDocument();
    expect(screen.getByText(/길라잡이, 이벤트 UI, 다른 창 등이 인식 대상 영역을 가리면/)).toBeInTheDocument();
    fireEvent.blur(checklistButton);

    expect(screen.queryByRole("button", { name: "화면 변경" })).not.toBeInTheDocument();
  });

  it("shows a dismissible Windows 10 long screen-share notice only after sharing starts", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

    render(
      <CapturePanel
        {...baseProps}
        captureStatus="active"
        stream={{} as MediaStream}
        skills={[makeSkill()]}
      />,
    );

    expect(screen.getByText("Windows 10 장시간 화면공유 안내")).toBeInTheDocument();
    expect(screen.getByText(/Windows 10 일부 환경에서 장시간 화면공유 후/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다시 보지 않기" }));

    expect(localStorage.getItem(WINDOWS_CAPTURE_NOTICE_STORAGE_KEY)).toBe("1");
    expect(screen.queryByText("Windows 10 장시간 화면공유 안내")).not.toBeInTheDocument();
  });

  it("hides the Windows 10 long screen-share notice for the current session without storing dismissal", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

    render(
      <CapturePanel
        {...baseProps}
        captureStatus="active"
        stream={{} as MediaStream}
        skills={[makeSkill()]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    expect(localStorage.getItem(WINDOWS_CAPTURE_NOTICE_STORAGE_KEY)).toBeNull();
    expect(screen.queryByText("Windows 10 장시간 화면공유 안내")).not.toBeInTheDocument();
  });

  it("does not show the Windows 10 long screen-share notice while collapsed or before sharing starts", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

    const { rerender } = render(
      <CapturePanel
        {...baseProps}
        captureStatus="active"
        stream={{} as MediaStream}
        skills={[makeSkill()]}
        isCollapsed={true}
      />,
    );

    expect(screen.queryByText("Windows 10 장시간 화면공유 안내")).not.toBeInTheDocument();

    rerender(
      <CapturePanel
        {...baseProps}
        captureStatus="active"
        stream={null}
        skills={[makeSkill()]}
      />,
    );

    expect(screen.queryByText("Windows 10 장시간 화면공유 안내")).not.toBeInTheDocument();
  });

  it("shows the change button beside the panel title and renders all crop regions as static boxes", () => {
    const selectedSkill = makeSkill({ id: "skill-1" });
    const otherSkill = makeSkill({
      id: "skill-2",
      region: { x: 0.4, y: 0.3, width: 0.05, height: 0.05 },
    });
    const { container } = render(
      <CapturePanel
        {...baseProps}
        stream={{} as MediaStream}
        skills={[selectedSkill, otherSkill]}
      />,
    );

    expect(screen.getByRole("button", { name: "화면 변경" })).toBeInTheDocument();
    expect(container.querySelectorAll(".region-static-box")).toHaveLength(2);
    expect(container.querySelector(".region-editor")).not.toBeInTheDocument();
  });

  it("shows the matched game resolution instead of the shared window frame size", () => {
    render(
      <CapturePanel
        {...baseProps}
        captureSize={{ width: 1922, height: 1118 }}
        stream={{} as MediaStream}
        skills={[makeSkill()]}
      />,
    );

    expect(screen.getByText("1920 x 1080")).toBeInTheDocument();
    expect(screen.queryByText("1922 x 1118")).not.toBeInTheDocument();
  });

  it("handles taller window chrome when matching the shared game resolution", () => {
    render(
      <CapturePanel
        {...baseProps}
        captureSize={{ width: 1922, height: 1330 }}
        stream={{} as MediaStream}
        skills={[makeSkill()]}
      />,
    );

    expect(screen.getByText("1920 x 1200")).toBeInTheDocument();
  });

  it("notifies metadata updates when the shared video is resized", () => {
    const onMetadata = vi.fn();
    const { container } = render(
      <CapturePanel
        {...baseProps}
        stream={{} as MediaStream}
        skills={[makeSkill()]}
        onMetadata={onMetadata}
      />,
    );

    const video = container.querySelector("video") as HTMLVideoElement;
    fireEvent.resize(video);

    expect(onMetadata).toHaveBeenCalledTimes(1);
  });

  it("collapses the video body while keeping the header controls available", () => {
    const onToggleCollapsed = vi.fn();
    const onStartCapture = vi.fn();
    const { container } = render(
      <CapturePanel
        {...baseProps}
        stream={null}
        skills={[makeSkill()]}
        isCollapsed={true}
        onStartCapture={onStartCapture}
        onToggleCollapsed={onToggleCollapsed}
      />,
    );

    expect(container.querySelector(".video-shell")).toHaveClass("is-collapsed");
    fireEvent.click(within(container).getByRole("button", { name: "화면 공유 시작" }));
    expect(onStartCapture).toHaveBeenCalledTimes(1);

    fireEvent.click(within(container).getByRole("button", { name: "화면 공유 패널 펼치기" }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it("toggles the capture panel from the heading surface", () => {
    const onToggleCollapsed = vi.fn();
    const { container } = render(
      <CapturePanel
        {...baseProps}
        stream={{} as MediaStream}
        skills={[makeSkill()]}
        onToggleCollapsed={onToggleCollapsed}
      />,
    );

    const heading = container.querySelector(".capture-panel-heading");
    expect(heading).not.toBeNull();
    fireEvent.click(heading as Element);

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });
});
