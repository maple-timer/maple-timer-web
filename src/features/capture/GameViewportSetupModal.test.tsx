import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameViewportSetupModal } from "./GameViewportSetupModal";

describe("GameViewportSetupModal", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("starts from a fitting known resolution and applies the selected viewport", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const onApply = vi.fn();

    render(
      <GameViewportSetupModal
        captureSize={{ width: 1766, height: 968 }}
        state={{ status: "legacy-passthrough", revision: 0 }}
        verificationStatus="known-capture"
        stream={{} as MediaStream}
        onApply={onApply}
        onClose={() => undefined}
        onUseFullCapture={() => undefined}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "게임 영역 설정" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1366 x 768", { selector: "dd" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "게임 화면 확대" }));
    fireEvent.click(screen.getByRole("button", { name: "게임 영역 사용" }));

    expect(onApply).toHaveBeenCalledWith({
      gameResolution: { width: 1366, height: 768 },
      region: {
        x: 200 / 1766,
        y: 100 / 968,
        width: 1366 / 1766,
        height: 768 / 968,
      },
    });
  });

  it("zooms the visual editor and returns it to the full-screen fit", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const { container } = render(
      <GameViewportSetupModal
        captureSize={{ width: 1766, height: 968 }}
        state={{ status: "legacy-passthrough", revision: 0 }}
        verificationStatus="known-capture"
        stream={{} as MediaStream}
        onApply={() => undefined}
        onClose={() => undefined}
        onUseFullCapture={() => undefined}
      />,
    );

    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "게임 화면 축소" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "화면 이동" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "영역 조절" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "게임 화면 확대" }));

    expect(screen.getByText("125%")).toBeInTheDocument();
    expect(container.querySelector(".game-viewport-editor-scene")).toHaveStyle({
      transform: "scale(1.25)",
    });
    fireEvent.click(screen.getByRole("button", { name: "화면 이동" }));
    expect(screen.getByRole("button", { name: "화면 이동" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "게임 화면 전체 맞춤" }),
    );

    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(container.querySelector(".game-viewport-editor-scene")).toHaveStyle({
      transform: "scale(1)",
    });
    expect(screen.getByRole("button", { name: "영역 조절" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("pans the enlarged scene without changing the selected region", () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 400,
      width: 800,
      height: 400,
      toJSON: () => undefined,
    });
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: () => true,
    });
    const { container } = render(
      <GameViewportSetupModal
        captureSize={{ width: 1766, height: 968 }}
        state={{ status: "legacy-passthrough", revision: 0 }}
        verificationStatus="known-capture"
        stream={{} as MediaStream}
        onApply={() => undefined}
        onClose={() => undefined}
        onUseFullCapture={() => undefined}
      />,
    );
    const regionBox = container.querySelector(".region-box");
    const initialRegionStyle = regionBox?.getAttribute("style");

    fireEvent.click(screen.getByRole("button", { name: "게임 화면 확대" }));

    const stage = screen.getByLabelText("게임 화면 영역 편집기");
    fireEvent.pointerDown(stage, {
      button: 0,
      clientX: 400,
      clientY: 200,
      pointerId: 1,
    });
    fireEvent.pointerMove(stage, {
      clientX: 470,
      clientY: 240,
      pointerId: 1,
    });
    fireEvent.pointerUp(stage, {
      clientX: 470,
      clientY: 240,
      pointerId: 1,
    });

    expect(
      container.querySelector(".game-viewport-editor-pan-layer"),
    ).toHaveStyle({
      transform: "translate3d(0px, 0px, 0)",
    });

    fireEvent.click(screen.getByRole("button", { name: "화면 이동" }));
    fireEvent.pointerDown(stage, {
      button: 0,
      clientX: 400,
      clientY: 200,
      pointerId: 1,
    });
    fireEvent.pointerMove(stage, {
      clientX: 470,
      clientY: 240,
      pointerId: 1,
    });
    fireEvent.pointerUp(stage, {
      clientX: 470,
      clientY: 240,
      pointerId: 1,
    });

    expect(
      container.querySelector(".game-viewport-editor-pan-layer"),
    ).toHaveStyle({
      transform: "translate3d(70px, 40px, 0)",
    });
    expect(regionBox).toHaveAttribute("style", initialRegionStyle);
  });

  it("lets an existing calibration return to the unchanged full-capture path", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const onUseFullCapture = vi.fn();

    render(
      <GameViewportSetupModal
        captureSize={{ width: 1766, height: 968 }}
        state={{
          status: "calibrated",
          calibration: {
            captureSize: { width: 1766, height: 968 },
            gameResolution: { width: 1366, height: 768 },
            region: { x: 200, y: 100, width: 1366, height: 768 },
            revision: 1,
          },
        }}
        verificationStatus="calibrated"
        stream={{} as MediaStream}
        onApply={() => undefined}
        onClose={() => undefined}
        onUseFullCapture={onUseFullCapture}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "공유 화면 그대로 사용" }),
    );
    expect(onUseFullCapture).toHaveBeenCalledOnce();
  });

  it("requires an explicit full-screen confirmation for an unverified capture", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const onUseFullCapture = vi.fn();

    render(
      <GameViewportSetupModal
        captureSize={{ width: 2762, height: 1358 }}
        state={{ status: "legacy-passthrough", revision: 0 }}
        verificationStatus="unverified"
        stream={{} as MediaStream}
        onApply={() => undefined}
        onClose={() => undefined}
        onUseFullCapture={onUseFullCapture}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "공유 화면 그대로 사용",
      }),
    );
    expect(onUseFullCapture).toHaveBeenCalledOnce();
  });

  it("keeps the core pointer interactions visible without a separate help panel", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    render(
      <GameViewportSetupModal
        captureSize={{ width: 1766, height: 968 }}
        state={{ status: "legacy-passthrough", revision: 0 }}
        verificationStatus="unverified"
        stream={{} as MediaStream}
        onApply={() => undefined}
        onClose={() => undefined}
        onUseFullCapture={() => undefined}
      />,
    );

    expect(
      screen.getByText(
        "박스 드래그 · 모서리 조절 · 휠 확대",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "좌상단 크기 조절" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "우하단 크기 조절" }),
    ).toBeInTheDocument();
  });
});
