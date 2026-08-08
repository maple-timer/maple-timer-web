import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PipTimerDisplay,
  PipTimerItem,
} from "../../../application/pip/pipTimerPresentation";
import { DEFAULT_PIP_TIMER_CONFIG } from "../../../lib/pipTimerSettings";
import {
  PIP_ALERT_BLINK_SETTLE_MS,
  PipTimerWindow,
  injectPipStyles,
} from "./PipTimerWindow";

function createItem(id: string, label: string, secondsUntilAlert: number | null): PipTimerItem {
  return {
    id,
    kind: "skill",
    label,
    statusLabel: secondsUntilAlert === null ? "대기" : "다음 알림",
    secondsUntilAlert,
    tone: secondsUntilAlert === null ? "waiting" : "running",
  };
}

function createBuffExpiryItem(): PipTimerItem {
  return {
    id: "buff-expiry",
    kind: "buff-expiry",
    label: "버프 종료",
    statusLabel: "곧 알림",
    secondsUntilAlert: 0,
    tone: "alert",
  };
}

function createSpecialCoreItem(): PipTimerItem {
  return {
    id: "special-core",
    kind: "special-core",
    label: "특수코어",
    statusLabel: "곧 사용 가능",
    secondsUntilAlert: 4,
    tone: "alert",
    isUrgent: true,
  };
}

function renderPip(display: PipTimerDisplay) {
  return render(<PipTimerWindow display={display} onClose={vi.fn()} />);
}

describe("PipTimerWindow", () => {
  it("removes the main document scrollbar gutter in the PiP document", () => {
    const pipDocument = document.implementation.createHTMLDocument("PIP");

    injectPipStyles({ document: pipDocument } as Window);

    const injectedStyle = pipDocument.head.querySelector("style:last-child");
    expect(injectedStyle?.textContent).toContain("scrollbar-gutter: auto");
    expect(injectedStyle?.textContent).toContain("overflow: hidden");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps only two secondary rows when the hunt stall strip is visible", () => {
    renderPip({
      main: createItem("main", "에르다 파운틴", 12),
      items: [
        createItem("main", "에르다 파운틴", 12),
        createItem("janus", "솔 야누스", 28),
        createItem("rune", "룬", null),
        createItem("timer", "30분", 186),
      ],
      huntStall: {
        mode: "manual-experience",
        badgeLabel: "EXP",
        primaryLabel: "86,649,656,544",
        secondaryLabel: "46.441%",
        progressPercent: 46.441,
        statusLabel: "현재 경험치",
        isStale: false,
        ariaLabel: "경험치 86,649,656,544 46.441%",
      },
    });

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("솔 야누스")).toBeInTheDocument();
    expect(screen.getByText("룬")).toBeInTheDocument();
    expect(screen.queryByText("30분")).not.toBeInTheDocument();
    expect(screen.getByLabelText("경험치 86,649,656,544 46.441%")).toBeInTheDocument();
  });

  it("keeps three secondary rows during settings preview even with hunt stall visible", () => {
    render(
      <PipTimerWindow
        display={{
          main: createItem("main", "스킬 알림", 12),
          items: [
            createItem("main", "스킬 알림", 12),
            createItem("rune", "룬", null),
            createItem("buff", "버프 종료", 18),
            createItem("timer", "30분 타이머", 180),
          ],
          huntStall: {
            mode: "manual-experience",
            badgeLabel: "EXP",
            primaryLabel: "86,649,656,544",
            secondaryLabel: "46.441%",
            progressPercent: 46.441,
            statusLabel: "현재 경험치",
            isStale: false,
            ariaLabel: "경험치 86,649,656,544 46.441%",
          },
        }}
        isSettingsPreview
        onClose={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("30분 타이머")).toBeInTheDocument();
    expect(screen.getByLabelText("경험치 86,649,656,544 46.441%")).toBeInTheDocument();
  });

  it("keeps three secondary rows when the hunt stall strip is hidden", () => {
    renderPip({
      main: createItem("main", "에르다 파운틴", 12),
      items: [
        createItem("main", "에르다 파운틴", 12),
        createItem("janus", "솔 야누스", 28),
        createItem("rune", "룬", null),
        createItem("timer", "30분", 186),
      ],
      huntStall: null,
    });

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("30분")).toBeInTheDocument();
  });

  it("applies the configured PiP alert visual style", () => {
    const { container } = render(
      <PipTimerWindow
        config={{
          ...DEFAULT_PIP_TIMER_CONFIG,
          size: "focus",
          alertColor: "red",
          emphasis: "flash",
          itemAlertColors: {
            ...DEFAULT_PIP_TIMER_CONFIG.itemAlertColors,
            skills: "red",
          },
        }}
        display={{
          main: {
            ...createItem("main", "에르다 파운틴", 0),
            tone: "alert",
          },
          items: [],
          huntStall: null,
        }}
        onClose={vi.fn()}
      />,
    );

    const root = container.querySelector(".pip-window");
    expect(root).not.toBeNull();
    expect(root as HTMLElement).toHaveClass("size-focus");
    expect(root as HTMLElement).toHaveClass("emphasis-flash");
    expect(root as HTMLElement).toHaveClass("urgent");
    expect(root as HTMLElement).toHaveStyle({ "--pip-alert-color": "#ff5f6d" });
  });

  it("uses the configured main item kind color", () => {
    const { container } = render(
      <PipTimerWindow
        config={{
          ...DEFAULT_PIP_TIMER_CONFIG,
          alertColor: "cyan",
          itemAlertColors: {
            ...DEFAULT_PIP_TIMER_CONFIG.itemAlertColors,
            buffExpiry: "red",
          },
        }}
        display={{
          main: createBuffExpiryItem(),
          items: [createBuffExpiryItem()],
          huntStall: null,
        }}
        onClose={vi.fn()}
      />,
    );

    const root = container.querySelector(".pip-window");
    expect(root).not.toBeNull();
    expect(root as HTMLElement).toHaveStyle({ "--pip-alert-color": "#ff5f6d" });
  });

  it("uses global color and urgent styling for special core PiP mode", () => {
    const { container } = render(
      <PipTimerWindow
        config={{
          ...DEFAULT_PIP_TIMER_CONFIG,
          mode: "specialCore",
          alertColor: "cyan",
          itemAlertColors: {
            ...DEFAULT_PIP_TIMER_CONFIG.itemAlertColors,
            skills: "red",
          },
        }}
        display={{
          main: createSpecialCoreItem(),
          items: [createSpecialCoreItem()],
          huntStall: null,
        }}
        onClose={vi.fn()}
      />,
    );

    const root = container.querySelector(".pip-window");
    expect(root).not.toBeNull();
    expect(root as HTMLElement).toHaveClass("urgent");
    expect(root as HTMLElement).toHaveStyle({ "--pip-alert-color": "#57d8f0" });
    expect(screen.getByText("특수코어")).toBeInTheDocument();
    expect(screen.getByText("곧 사용 가능")).toBeInTheDocument();
  });

  it("renders the shared screen preview when the PiP option is enabled", () => {
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      writable: true,
      value: null,
    });
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const stream = { id: "screen-stream" } as MediaStream;

    render(
      <PipTimerWindow
        config={{
          ...DEFAULT_PIP_TIMER_CONFIG,
          showScreenPreview: true,
        }}
        display={{
          main: createItem("main", "에르다 파운틴", 9),
          items: [],
          huntStall: null,
        }}
        screenPreviewStream={stream}
        screenPreviewSize={{ width: 1922, height: 1112 }}
        onClose={vi.fn()}
      />,
    );

    const preview = screen.getByLabelText("공유 화면 미리보기");
    const video = screen.getByLabelText("공유 화면") as HTMLVideoElement;
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveClass("has-source-size");
    expect(preview).toHaveClass("has-crop");
    expect(preview).toHaveStyle({
      "--pip-screen-video-top": "-2.9629629629629632%",
      "--pip-screen-video-left": "-0.052083333333333336%",
    });
    expect(video.srcObject).toBe(stream);
    expect(playSpy).toHaveBeenCalledTimes(1);

    playSpy.mockRestore();
  });

  it("does not render the shared screen preview in special core mode", () => {
    const stream = { id: "screen-stream" } as MediaStream;

    const { container } = render(
      <PipTimerWindow
        config={{
          ...DEFAULT_PIP_TIMER_CONFIG,
          mode: "specialCore",
          showScreenPreview: true,
        }}
        display={{
          main: createSpecialCoreItem(),
          items: [createSpecialCoreItem()],
          huntStall: null,
        }}
        screenPreviewStream={stream}
        screenPreviewSize={{ width: 1922, height: 1112 }}
        onClose={vi.fn()}
      />,
    );

    const root = container.querySelector(".pip-window");
    expect(root as HTMLElement).not.toHaveClass("with-screen-preview");
    expect(screen.queryByLabelText("공유 화면 미리보기")).not.toBeInTheDocument();
  });

  it("keeps alert emphasis classes when the shared screen preview is visible", () => {
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      writable: true,
      value: null,
    });
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const stream = { id: "screen-stream" } as MediaStream;

    const { container } = render(
      <PipTimerWindow
        config={{
          ...DEFAULT_PIP_TIMER_CONFIG,
          alertColor: "red",
          emphasis: "flash",
          itemAlertColors: {
            ...DEFAULT_PIP_TIMER_CONFIG.itemAlertColors,
            skills: "red",
          },
          showScreenPreview: true,
        }}
        display={{
          main: {
            ...createItem("main", "에르다 파운틴", 0),
            tone: "alert",
          },
          items: [],
          huntStall: null,
        }}
        screenPreviewStream={stream}
        screenPreviewSize={{ width: 1922, height: 1112 }}
        onClose={vi.fn()}
      />,
    );

    const root = container.querySelector(".pip-window");
    expect(root).not.toBeNull();
    expect(root as HTMLElement).toHaveClass("with-screen-preview");
    expect(root as HTMLElement).toHaveClass("emphasis-flash");
    expect(root as HTMLElement).toHaveClass("urgent");
    expect(root as HTMLElement).toHaveStyle({ "--pip-alert-color": "#ff5f6d" });

    playSpy.mockRestore();
  });

  it("does not flash before the configured alert timing is reached", () => {
    const { container } = render(
      <PipTimerWindow
        config={{
          ...DEFAULT_PIP_TIMER_CONFIG,
          size: "focus",
          alertColor: "red",
          emphasis: "flash",
        }}
        display={{
          main: createItem("main", "에르다 파운틴", 9),
          items: [],
          huntStall: null,
        }}
        onClose={vi.fn()}
      />,
    );

    const root = container.querySelector(".pip-window");
    expect(root).not.toBeNull();
    expect(root as HTMLElement).not.toHaveClass("urgent");
    expect(root as HTMLElement).not.toHaveClass("critical");
  });

  it("changes the shared alert state and master volume from PiP controls", () => {
    const onToggleAllAlertsDisabled = vi.fn();
    const onMasterVolumeChange = vi.fn();

    render(
      <PipTimerWindow
        display={{
          main: createItem("main", "에르다 파운틴", 9),
          items: [],
          huntStall: null,
        }}
        masterVolume={0.65}
        onToggleAllAlertsDisabled={onToggleAllAlertsDisabled}
        onMasterVolumeChange={onMasterVolumeChange}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "전체 알림 비활성화" }));
    expect(onToggleAllAlertsDisabled).toHaveBeenCalledWith(true);

    const volumeSlider = screen.getByRole("slider", { name: "마스터 볼륨" });
    expect(volumeSlider).toHaveAttribute("aria-valuenow", "65");
    fireEvent.keyDown(volumeSlider, { key: "ArrowLeft" });
    expect(onMasterVolumeChange).toHaveBeenCalledWith(0.6);
  });

  it("shows the disabled state and restores alerts from the PiP control", () => {
    const onToggleAllAlertsDisabled = vi.fn();

    render(
      <PipTimerWindow
        display={{ main: null, items: [], huntStall: null }}
        isAllAlertsDisabled
        onToggleAllAlertsDisabled={onToggleAllAlertsDisabled}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("모든 알림이 비활성화되었습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "전체 알림 다시 활성화" }));
    expect(onToggleAllAlertsDisabled).toHaveBeenCalledWith(false);
  });

  describe("alert blink settling", () => {
    function createAlertedItem(id: string, label: string): PipTimerItem {
      return {
        id,
        kind: "skill",
        label,
        statusLabel: "재설치",
        secondsUntilAlert: 0,
        tone: "alert",
      };
    }

    function renderAlerted(item: PipTimerItem, others: PipTimerItem[] = []) {
      return render(
        <PipTimerWindow
          display={{ main: item, items: [item, ...others], huntStall: null }}
          onClose={vi.fn()}
        />,
      );
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("stops blinking once an alert has held past the settle delay", () => {
      vi.useFakeTimers();
      const { container } = renderAlerted(createAlertedItem("seq-1", "시퀀스 1"));
      const root = container.querySelector(".pip-window") as HTMLElement;

      expect(root).toHaveClass("urgent");
      expect(root).not.toHaveClass("alert-settled");

      act(() => {
        vi.advanceTimersByTime(PIP_ALERT_BLINK_SETTLE_MS);
      });

      expect(root).toHaveClass("urgent");
      expect(root).toHaveClass("alert-settled");
    });

    it("blinks again when a different item starts alerting", () => {
      vi.useFakeTimers();
      const first = createAlertedItem("seq-1", "시퀀스 1");
      const second = createAlertedItem("seq-2", "시퀀스 2");
      const { container, rerender } = renderAlerted(first);
      const root = container.querySelector(".pip-window") as HTMLElement;

      act(() => {
        vi.advanceTimersByTime(PIP_ALERT_BLINK_SETTLE_MS);
      });
      expect(root).toHaveClass("alert-settled");

      rerender(
        <PipTimerWindow
          display={{ main: second, items: [second, first], huntStall: null }}
          onClose={vi.fn()}
        />,
      );
      expect(root).not.toHaveClass("alert-settled");

      // Returning to the older alert must not restart its blink.
      rerender(
        <PipTimerWindow
          display={{ main: first, items: [first, second], huntStall: null }}
          onClose={vi.fn()}
        />,
      );
      expect(root).toHaveClass("alert-settled");
    });

    it("keeps the settings preview blinking so the style stays previewable", () => {
      vi.useFakeTimers();
      const { container } = render(
        <PipTimerWindow
          display={{ main: null, items: [], huntStall: null }}
          isAlertStylePreview
          isSettingsPreview
          onClose={vi.fn()}
        />,
      );
      const root = container.querySelector(".pip-window") as HTMLElement;

      expect(root).toHaveClass("urgent");
      act(() => {
        vi.advanceTimersByTime(PIP_ALERT_BLINK_SETTLE_MS * 3);
      });
      expect(root).not.toHaveClass("alert-settled");
    });

    it("stops animating the settled window while keeping its alert colour", () => {
      const pipDocument = document.implementation.createHTMLDocument("PIP");
      injectPipStyles({ document: pipDocument } as Window);
      const styles = pipDocument.head.querySelector("style:last-child")?.textContent ?? "";

      const settledRule = styles
        .split("}")
        .find((block) => block.includes(".pip-window.urgent.alert-settled"));
      expect(settledRule).toContain("animation: none");
      expect(styles).toContain(".pip-window.emphasis-flash.urgent.alert-settled");
    });
  });
});
