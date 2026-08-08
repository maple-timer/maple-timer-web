import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreenShareHeaderControl } from "./ScreenShareHeaderControl";

const legacyGameViewportState = {
  status: "legacy-passthrough" as const,
  revision: 0,
};

describe("ScreenShareHeaderControl", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("beats the whole start control while screen sharing is missing", () => {
    render(
      <ScreenShareHeaderControl
        stream={null}
        captureStatus="idle"
        captureSize={null}
        gameViewportState={legacyGameViewportState}
        gameViewportVerification="unavailable"
        attentionKey={0}
        onStartCapture={() => undefined}
        onChangeCapture={() => undefined}
        onOpenGameViewportSetup={() => undefined}
        onUseFullCaptureAsGameViewport={() => undefined}
      />,
    );

    const control = screen.getByRole("button", { name: "화면 공유 시작" });
    expect(control).toHaveClass("attention-beat");
    expect(screen.getByText("선택 대기")).toBeInTheDocument();
  });

  it("does not highlight the header control after screen sharing starts", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    render(
      <ScreenShareHeaderControl
        stream={{} as MediaStream}
        captureStatus="idle"
        captureSize={{ width: 1920, height: 1080 }}
        gameViewportState={legacyGameViewportState}
        gameViewportVerification="known-capture"
        onStartCapture={() => undefined}
        onChangeCapture={() => undefined}
        onOpenGameViewportSetup={() => undefined}
        onUseFullCaptureAsGameViewport={() => undefined}
      />,
    );

    const control = screen.getByRole("button", { name: "화면 공유 중 1920 x 1080" });
    expect(control).not.toHaveClass("attention-beat");
    expect(control).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the details once when screen sharing becomes active", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    const props = {
      captureStatus: "idle" as const,
      captureSize: null,
      gameViewportState: legacyGameViewportState,
      gameViewportVerification: "unavailable" as const,
      onStartCapture: () => undefined,
      onChangeCapture: () => undefined,
      onOpenGameViewportSetup: () => undefined,
      onUseFullCaptureAsGameViewport: () => undefined,
    };
    const { rerender } = render(<ScreenShareHeaderControl {...props} stream={null} />);

    rerender(
      <ScreenShareHeaderControl
        {...props}
        stream={{} as MediaStream}
        captureSize={{ width: 1368, height: 806 }}
        gameViewportVerification="known-capture"
      />,
    );

    expect(screen.getByRole("button", { name: "화면 공유 중 1366 x 768" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("게임 화면 확인됨")).toBeInTheDocument();
    expect(
      screen.getByText("현재 공유 화면을 게임 화면 기준으로 사용합니다."),
    ).toBeInTheDocument();
  });

  it("opens game-area setup from the screen-share details", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const onOpenGameViewportSetup = vi.fn();

    render(
      <ScreenShareHeaderControl
        stream={{} as MediaStream}
        captureStatus="idle"
        captureSize={{ width: 1766, height: 968 }}
        gameViewportState={{
          status: "calibrated",
          calibration: {
            captureSize: { width: 1766, height: 968 },
            gameResolution: { width: 1366, height: 768 },
            region: { x: 200, y: 100, width: 1366, height: 768 },
            revision: 1,
          },
        }}
        gameViewportVerification="calibrated"
        onStartCapture={() => undefined}
        onChangeCapture={() => undefined}
        onOpenGameViewportSetup={onOpenGameViewportSetup}
        onUseFullCaptureAsGameViewport={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "화면 공유 중 1766 x 968" }),
    );
    expect(await screen.findByText("1366 x 768 설정됨")).toBeInTheDocument();
    const gameViewportRow = screen
      .getByText("게임 화면 영역")
      .closest(".screen-share-header-game-viewport");
    expect(gameViewportRow?.nextElementSibling).toHaveClass(
      "screen-share-header-popover-body",
    );
    expect(
      screen.getByText(
        "설정한 게임 화면을 기준으로 알림을 분석합니다.",
      ),
    ).toBeInTheDocument();
    screen.getByRole("button", { name: "게임 화면 맞추기" }).click();
    expect(onOpenGameViewportSetup).toHaveBeenCalledOnce();
  });

  it("emphasizes game-area setup for a suspicious first capture", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const onUseFullCaptureAsGameViewport = vi.fn();

    render(
      <ScreenShareHeaderControl
        stream={{} as MediaStream}
        captureStatus="idle"
        captureSize={{ width: 1766, height: 968 }}
        gameViewportState={legacyGameViewportState}
        gameViewportVerification="unverified"
        onStartCapture={() => undefined}
        onChangeCapture={() => undefined}
        onOpenGameViewportSetup={() => undefined}
        onUseFullCaptureAsGameViewport={onUseFullCaptureAsGameViewport}
      />,
    );

    const control = screen.getByRole("button", {
      name: "게임 화면 확인 필요 1766 x 968",
    });
    expect(control).toHaveClass("game-viewport-recommended", "attention-beat");
    fireEvent.click(control);

    expect(screen.getByText("게임 화면 확인 필요")).toBeInTheDocument();
    expect(
      screen.getByText("확장 UI 사용 시 게임 화면 영역을 맞춰주세요."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("게임 화면 영역").closest(".screen-share-header-game-viewport"),
    ).toHaveClass("recommended");
    expect(
      screen.getByRole("button", { name: "게임 화면 맞추기" }),
    ).toHaveClass("game-viewport-action-button", "is-primary");
    fireEvent.click(
      screen.getByRole("button", {
        name: "공유 화면 그대로 사용",
      }),
    );
    expect(onUseFullCaptureAsGameViewport).toHaveBeenCalledOnce();
  });

  it("uses the stronger attention state when an existing calibration is stale", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const onUseFullCaptureAsGameViewport = vi.fn();

    render(
      <ScreenShareHeaderControl
        stream={{} as MediaStream}
        captureStatus="idle"
        captureSize={{ width: 1920, height: 1080 }}
        gameViewportState={{
          status: "stale",
          calibration: {
            captureSize: { width: 1766, height: 968 },
            gameResolution: { width: 1366, height: 768 },
            region: { x: 200, y: 100, width: 1366, height: 768 },
            revision: 1,
          },
          captureSize: { width: 1920, height: 1080 },
        }}
        gameViewportVerification="stale"
        onStartCapture={() => undefined}
        onChangeCapture={() => undefined}
        onOpenGameViewportSetup={() => undefined}
        onUseFullCaptureAsGameViewport={onUseFullCaptureAsGameViewport}
      />,
    );

    expect(
      screen.getByRole("button", { name: "게임 화면 다시 설정 필요 1920 x 1080" }),
    ).toHaveClass("game-viewport-required", "attention-beat");
    fireEvent.click(
      screen.getByRole("button", {
        name: "게임 화면 다시 설정 필요 1920 x 1080",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "공유 화면 그대로 사용" }),
    );
    expect(onUseFullCaptureAsGameViewport).toHaveBeenCalledOnce();
  });
});
