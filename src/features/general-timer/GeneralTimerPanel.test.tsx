import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeneralTimerConfig } from "../../types";
import { GeneralTimerPanel } from "./GeneralTimerPanel";

const timer: GeneralTimerConfig = {
  id: "timer-1",
  presetId: "30m",
  soundId: "띵동띵동",
  volume: 1,
  enabled: true,
  startedAt: null,
  endsAt: null,
  remainingSecondsAtPause: null,
  alertedAt: null,
};

describe("GeneralTimerPanel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows the selected preset in the preset picker", () => {
    render(
      <GeneralTimerPanel
        timers={[timer]}
        onAddTimer={() => undefined}
        onChangeTimer={() => undefined}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "일반 타이머 종류" })).toHaveTextContent("30분");
  });

  it("shows an empty state row when there are no timers", () => {
    const onAddTimer = vi.fn(() => "timer-new");
    render(
      <GeneralTimerPanel
        timers={[]}
        onAddTimer={onAddTimer}
        onChangeTimer={() => undefined}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    expect(screen.queryByLabelText("일반 타이머 0개")).not.toBeInTheDocument();
    expect(screen.getByText("등록된 일반 타이머가 없습니다")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "빈 일반 타이머 추가" }));
    expect(onAddTimer).toHaveBeenCalledTimes(1);
  });

  it("opens the preset picker and changes the timer preset", () => {
    const onChangeTimer = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[timer]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "일반 타이머 종류" }));
    expect(screen.getByRole("listbox", { name: "일반 타이머 종류" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "일반 타이머 종류" }).closest("tr"),
    ).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("option", { name: "20분" }));

    expect(onChangeTimer).toHaveBeenCalledWith(
      "timer-1",
      expect.objectContaining({
        presetId: "20m",
        customDurationSeconds: undefined,
        startedAt: null,
        endsAt: null,
        remainingSecondsAtPause: null,
        alertedAt: null,
      }),
    );
    expect(screen.queryByRole("listbox", { name: "일반 타이머 종류" })).not.toBeInTheDocument();
  });

  it("keeps the preset picker closed when globally disabled", () => {
    render(
      <GeneralTimerPanel
        timers={[timer]}
        isGloballyDisabled
        onAddTimer={() => undefined}
        onChangeTimer={() => undefined}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    const trigger = screen.getByRole("button", { name: "일반 타이머 종류" });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);

    expect(screen.queryByRole("listbox", { name: "일반 타이머 종류" })).not.toBeInTheDocument();
  });

  it("closes the preset picker on Escape and outside mouse down", () => {
    render(
      <GeneralTimerPanel
        timers={[timer]}
        onAddTimer={() => undefined}
        onChangeTimer={() => undefined}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    const trigger = screen.getByRole("button", { name: "일반 타이머 종류" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "일반 타이머 종류" })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("listbox", { name: "일반 타이머 종류" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox", { name: "일반 타이머 종류" })).not.toBeInTheDocument();
  });

  it("starts a preset timer from the row button", () => {
    const onChangeTimer = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[timer]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    expect(screen.getByText("30:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    expect(onChangeTimer).toHaveBeenCalledWith(
      "timer-1",
      expect.objectContaining({
        remainingSecondsAtPause: null,
        alertedAt: null,
      }),
    );
    expect(onChangeTimer.mock.calls[0][1].endsAt).toBeGreaterThan(Date.now());
  });

  it("does not create the ticker worker before a general timer is running", () => {
    const createdWorkers: Array<{ postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }> = [];
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage = vi.fn();
      terminate = vi.fn();

      constructor() {
        createdWorkers.push(this);
      }
    }
    vi.stubGlobal("Worker", FakeWorker);

    const { rerender } = render(
      <GeneralTimerPanel
        timers={[timer]}
        onAddTimer={() => undefined}
        onChangeTimer={() => undefined}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    expect(createdWorkers).toHaveLength(0);

    rerender(
      <GeneralTimerPanel
        timers={[{ ...timer, startedAt: 1_000, endsAt: Date.now() + 10_000 }]}
        onAddTimer={() => undefined}
        onChangeTimer={() => undefined}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    expect(createdWorkers).toHaveLength(1);

    rerender(
      <GeneralTimerPanel
        timers={[{ ...timer, remainingSecondsAtPause: 10 }]}
        onAddTimer={() => undefined}
        onChangeTimer={() => undefined}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    expect(createdWorkers[0].terminate).toHaveBeenCalledTimes(1);
  });

  it("starts an idle timer from the current time even while the ticker is stopped", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const onChangeTimer = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[timer]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    vi.setSystemTime(6_000);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));

    expect(onChangeTimer).toHaveBeenCalledWith(
      "timer-1",
      expect.objectContaining({
        startedAt: 6_000,
        endsAt: 1_806_000,
      }),
    );
  });

  it("toggles automatic restart from the timer row", () => {
    const onChangeTimer = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[timer]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    fireEvent.click(screen.getByLabelText("자동 재시작"));

    expect(onChangeTimer).toHaveBeenCalledWith("timer-1", {
      autoRestartEnabled: true,
    });
  });

  it("keeps panel heading bulk action tooltips on one line", () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    render(
      <GeneralTimerPanel
        timers={[{ ...timer, startedAt: 4_990_000, endsAt: 5_020_000 }]}
        onAddTimer={() => undefined}
        onChangeTimer={() => undefined}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    const hoverTooltip = (buttonName: string, tooltipText: string) => {
      const button = screen.getByRole("button", { name: buttonName });
      const target = button.closest(".floating-tooltip-button-target") ?? button;

      fireEvent.mouseEnter(target);
      expect(screen.getByText(tooltipText)).toHaveClass("tooltip-nowrap");
      fireEvent.mouseLeave(target);
    };

    hoverTooltip(
      "일반 타이머 전체 시작 또는 재개",
      "활성화된 일반 타이머 모두 시작 또는 재개",
    );
    hoverTooltip("일반 타이머 전체 일시정지", "진행 중인 일반 타이머 모두 일시정지");
    hoverTooltip("일반 타이머 전체 초기화", "일반 타이머 모두 초기화");
  });

  it("starts all enabled timers from the panel heading", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const onChangeTimer = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[
          timer,
          { ...timer, id: "timer-2", presetId: "custom", customDurationSeconds: 125 },
          { ...timer, id: "timer-disabled", enabled: false },
        ]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "일반 타이머 전체 시작 또는 재개" }));

    expect(onChangeTimer).toHaveBeenCalledTimes(2);
    expect(onChangeTimer).toHaveBeenNthCalledWith(1, "timer-1", {
      startedAt: 2_000_000,
      endsAt: 3_800_000,
      remainingSecondsAtPause: null,
      alertedAt: null,
    });
    expect(onChangeTimer).toHaveBeenNthCalledWith(2, "timer-2", {
      startedAt: 2_000_000,
      endsAt: 2_125_000,
      remainingSecondsAtPause: null,
      alertedAt: null,
    });
  });

  it("resumes paused timers from the panel heading without resetting running timers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(6_000_000);
    const onChangeTimer = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[
          { ...timer, id: "timer-paused", remainingSecondsAtPause: 42 },
          { ...timer, id: "timer-running", startedAt: 5_990_000, endsAt: 6_020_000 },
        ]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "일반 타이머 전체 시작 또는 재개" }));

    expect(onChangeTimer).toHaveBeenCalledTimes(1);
    expect(onChangeTimer).toHaveBeenCalledWith("timer-paused", {
      startedAt: 6_000_000,
      endsAt: 6_042_000,
      remainingSecondsAtPause: null,
      alertedAt: null,
    });
  });

  it("pauses all running timers from the panel heading", () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    const onChangeTimer = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[
          { ...timer, id: "timer-running-a", startedAt: 4_990_000, endsAt: 5_020_000 },
          { ...timer, id: "timer-running-b", startedAt: 4_900_000, endsAt: 5_125_000 },
          { ...timer, id: "timer-paused", remainingSecondsAtPause: 12 },
          { ...timer, id: "timer-disabled", enabled: false, startedAt: 4_990_000, endsAt: 5_020_000 },
        ]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "일반 타이머 전체 일시정지" }));

    expect(onChangeTimer).toHaveBeenCalledTimes(2);
    expect(onChangeTimer).toHaveBeenNthCalledWith(1, "timer-running-a", {
      endsAt: null,
      remainingSecondsAtPause: 20,
    });
    expect(onChangeTimer).toHaveBeenNthCalledWith(2, "timer-running-b", {
      endsAt: null,
      remainingSecondsAtPause: 125,
    });
  });

  it("resets all timers from the panel heading", () => {
    const onChangeTimer = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[
          { ...timer, id: "timer-running", startedAt: 1_000, endsAt: 30_000 },
          { ...timer, id: "timer-paused", remainingSecondsAtPause: 12 },
          { ...timer, id: "timer-complete", startedAt: 1_000, endsAt: 2_000, alertedAt: 2_000 },
          { ...timer, id: "timer-disabled", enabled: false, startedAt: 1_000, endsAt: 30_000 },
        ]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    onChangeTimer.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "일반 타이머 전체 초기화" }));

    expect(onChangeTimer).toHaveBeenCalledTimes(4);
    for (const timerId of ["timer-running", "timer-paused", "timer-complete", "timer-disabled"]) {
      expect(onChangeTimer).toHaveBeenCalledWith(timerId, {
        startedAt: null,
        endsAt: null,
        remainingSecondsAtPause: null,
        alertedAt: null,
      });
    }
  });

  it("pauses running timers when global disable turns on", () => {
    vi.useFakeTimers();
    vi.setSystemTime(8_000_000);
    const onChangeTimer = vi.fn();
    const runningTimer = { ...timer, startedAt: 7_990_000, endsAt: 8_020_000 };
    const { rerender } = render(
      <GeneralTimerPanel
        timers={[runningTimer]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    rerender(
      <GeneralTimerPanel
        timers={[runningTimer]}
        isGloballyDisabled
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    expect(onChangeTimer).toHaveBeenCalledTimes(1);
    expect(onChangeTimer).toHaveBeenCalledWith("timer-1", {
      endsAt: null,
      remainingSecondsAtPause: 20,
    });
  });

  it("pauses a running timer from the row button", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const onChangeTimer = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[{ ...timer, startedAt: 990_000, endsAt: 1_010_000 }]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "일시정지" }));

    expect(onChangeTimer).toHaveBeenCalledWith("timer-1", {
      endsAt: null,
      remainingSecondsAtPause: 10,
    });
  });

  it("resumes a paused timer from the row button", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const onChangeTimer = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[{ ...timer, remainingSecondsAtPause: 12 }]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "재개" }));

    expect(onChangeTimer).toHaveBeenCalledWith("timer-1", {
      startedAt: 2_000_000,
      endsAt: 2_012_000,
      remainingSecondsAtPause: null,
      alertedAt: null,
    });
  });

  it("resets timer runtime fields from the row button", () => {
    const onChangeTimer = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[{ ...timer, startedAt: 1_000, endsAt: 2_000 }]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "초기화" }));

    expect(onChangeTimer).toHaveBeenCalledWith("timer-1", {
      startedAt: null,
      endsAt: null,
      remainingSecondsAtPause: null,
      alertedAt: null,
    });
  });

  it("shows custom minute and second inputs next to the preset selector", () => {
    const onChangeTimer = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[{ ...timer, presetId: "custom", customDurationSeconds: 125 }]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    expect(screen.getByLabelText("일반 타이머 분")).toHaveValue(2);
    expect(screen.getByLabelText("일반 타이머 초")).toHaveValue(5);
  });

  it("resets timer runtime fields when committing a custom duration", () => {
    const onChangeTimer = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[{ ...timer, presetId: "custom", customDurationSeconds: 125 }]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    const minutesInput = screen.getByLabelText("일반 타이머 분");
    fireEvent.focus(minutesInput);
    fireEvent.change(minutesInput, { target: { value: "3" } });
    fireEvent.blur(minutesInput);

    expect(onChangeTimer).toHaveBeenCalledWith("timer-1", {
      customDurationSeconds: 185,
      startedAt: null,
      endsAt: null,
      remainingSecondsAtPause: null,
      alertedAt: null,
    });
  });

  it("keeps the editor controls hidden while the timer row is collapsed", () => {
    render(
      <GeneralTimerPanel
        timers={[timer]}
        onAddTimer={() => undefined}
        onChangeTimer={() => undefined}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    expect(screen.queryByLabelText("일반 타이머 볼륨 100%")).not.toBeInTheDocument();
  });

  it("shows editor controls when the timer row expands", () => {
    render(
      <GeneralTimerPanel
        timers={[timer]}
        onAddTimer={() => undefined}
        onChangeTimer={() => undefined}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "일반 타이머 설정 펼치기" }));

    expect(screen.getByText("알림음")).toBeInTheDocument();
    expect(screen.getByLabelText("일반 타이머 볼륨 100%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "제보" })).not.toBeInTheDocument();
  });

  it("commits a trimmed timer name from the expanded editor", () => {
    const onChangeTimer = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[timer]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "일반 타이머 설정 펼치기" }));
    const nameInput = screen.getByLabelText("일반 타이머 이름");
    expect(nameInput).toHaveAttribute("placeholder", "30분");

    fireEvent.change(nameInput, { target: { value: "  재획비  " } });
    expect(onChangeTimer).not.toHaveBeenCalled();

    fireEvent.blur(nameInput);
    expect(onChangeTimer).toHaveBeenCalledWith("timer-1", { name: "재획비" });
  });

  it("clears the timer name when the editor input is emptied", () => {
    const onChangeTimer = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[{ ...timer, name: "도핑" }]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "일반 타이머 설정 펼치기" }));
    const nameInput = screen.getByLabelText("일반 타이머 이름");
    expect(nameInput).toHaveValue("도핑");

    fireEvent.change(nameInput, { target: { value: "   " } });
    fireEvent.blur(nameInput);
    expect(onChangeTimer).toHaveBeenCalledWith("timer-1", { name: undefined });
  });

  it("shows the saved timer name above the preset picker", () => {
    render(
      <GeneralTimerPanel
        timers={[{ ...timer, name: "도핑30" }]}
        onAddTimer={() => undefined}
        onChangeTimer={() => undefined}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    expect(screen.getByText("도핑30")).toBeInTheDocument();
  });

  it("expands the timer row from blank space in the preset cell", () => {
    const { container } = render(
      <GeneralTimerPanel
        timers={[timer]}
        onAddTimer={() => undefined}
        onChangeTimer={() => undefined}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    const row = container.querySelector<HTMLTableRowElement>("tr.general-timer-row");
    const presetCellSpace = container.querySelector<HTMLDivElement>(
      ".general-timer-preset-inline",
    );
    expect(row).not.toBeNull();
    expect(presetCellSpace).not.toBeNull();

    fireEvent.click(presetCellSpace as HTMLDivElement);

    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("일반 타이머 볼륨 100%")).toBeInTheDocument();
  });

  it("toggles the editor controls from the timer row keyboard shortcut", () => {
    const { container } = render(
      <GeneralTimerPanel
        timers={[timer]}
        onAddTimer={() => undefined}
        onChangeTimer={() => undefined}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    const row = container.querySelector<HTMLTableRowElement>("tr.general-timer-row");
    expect(row).not.toBeNull();

    fireEvent.keyDown(row as HTMLTableRowElement, { key: "Enter" });
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("일반 타이머 볼륨 100%")).toBeInTheDocument();

    fireEvent.keyDown(row as HTMLTableRowElement, { key: " " });
    expect(row).toHaveAttribute("aria-expanded", "false");
  });

  it("does not toggle the row from an interactive child keyboard event", () => {
    render(
      <GeneralTimerPanel
        timers={[timer]}
        onAddTimer={() => undefined}
        onChangeTimer={() => undefined}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={() => undefined}
      />,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "일반 타이머 종류" }), {
      key: "Enter",
    });

    expect(screen.queryByLabelText("일반 타이머 볼륨 100%")).not.toBeInTheDocument();
  });

  it("previews the editor sound from the expanded row", () => {
    const onPreviewSound = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[timer]}
        onAddTimer={() => undefined}
        onChangeTimer={() => undefined}
        onRemoveTimer={() => undefined}
        onPreviewSound={onPreviewSound}
        onTimerAlert={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "일반 타이머 설정 펼치기" }));
    fireEvent.click(screen.getByRole("button", { name: "알림음 재생" }));

    expect(onPreviewSound).toHaveBeenCalledWith(timer.soundId, timer.volume);
  });

  it("expands a newly added timer when the add handler returns its id", () => {
    function Harness() {
      const [timers, setTimers] = useState<GeneralTimerConfig[]>([timer]);

      return (
        <GeneralTimerPanel
          timers={timers}
          onAddTimer={() => {
            const nextTimer = { ...timer, id: "timer-2" };
            setTimers((current) => [...current, nextTimer]);
            return nextTimer.id;
          }}
          onChangeTimer={() => undefined}
          onRemoveTimer={() => undefined}
          onPreviewSound={() => undefined}
          onTimerAlert={() => undefined}
        />
      );
    }

    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "타이머 추가" }));

    expect(screen.getAllByText("30:00")).toHaveLength(2);
    expect(screen.getByLabelText("일반 타이머 볼륨 100%")).toBeInTheDocument();
  });

  it("alerts once when a timer completes after the initial render", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const onChangeTimer = vi.fn();
    const onTimerAlert = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[{ ...timer, startedAt: 9_000, endsAt: 10_500 }]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={onTimerAlert}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(onChangeTimer).toHaveBeenCalledTimes(1);
    expect(onChangeTimer).toHaveBeenCalledWith("timer-1", {
      alertedAt: 10_500,
      remainingSecondsAtPause: 0,
    });
    expect(onTimerAlert).toHaveBeenCalledTimes(1);
    expect(onTimerAlert).toHaveBeenCalledWith(timer.soundId, timer.volume);
  });

  it("restarts an automatic restart timer after playing the completion alert", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const onChangeTimer = vi.fn();
    const onTimerAlert = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[{ ...timer, autoRestartEnabled: true, startedAt: 9_000, endsAt: 10_500 }]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={onTimerAlert}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(onChangeTimer).toHaveBeenCalledWith("timer-1", {
      startedAt: 10_500,
      endsAt: 1_810_500,
      remainingSecondsAtPause: null,
      alertedAt: null,
    });
    expect(onTimerAlert).toHaveBeenCalledTimes(1);
    expect(onTimerAlert).toHaveBeenCalledWith(timer.soundId, timer.volume);
  });

  it("does not drift automatic restart timers when completion is detected late", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const onChangeTimer = vi.fn();
    const onTimerAlert = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[{ ...timer, autoRestartEnabled: true, startedAt: 9_000, endsAt: 10_375 }]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={onTimerAlert}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onChangeTimer).toHaveBeenCalledWith("timer-1", {
      startedAt: 10_375,
      endsAt: 1_810_375,
      remainingSecondsAtPause: null,
      alertedAt: null,
    });
    expect(onTimerAlert).toHaveBeenCalledTimes(1);
  });

  it("does not play an alert for a timer that is already complete on initial render", () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    const onChangeTimer = vi.fn();
    const onTimerAlert = vi.fn();
    render(
      <GeneralTimerPanel
        timers={[{ ...timer, startedAt: 1_000, endsAt: 10_000 }]}
        onAddTimer={() => undefined}
        onChangeTimer={onChangeTimer}
        onRemoveTimer={() => undefined}
        onPreviewSound={() => undefined}
        onTimerAlert={onTimerAlert}
      />,
    );

    expect(onChangeTimer).toHaveBeenCalledWith("timer-1", {
      alertedAt: 20_000,
      remainingSecondsAtPause: 0,
    });
    expect(onTimerAlert).not.toHaveBeenCalled();
  });
});
