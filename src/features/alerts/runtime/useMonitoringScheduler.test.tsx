import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonitoringJob } from "./useMonitoringScheduler";
import { useMonitoringScheduler } from "./useMonitoringScheduler";

function SchedulerHarness({
  active = true,
  jobs,
  onInactive,
}: {
  active?: boolean;
  jobs: MonitoringJob[];
  onInactive?: () => void;
}) {
  useMonitoringScheduler({
    active,
    jobs,
    onInactive,
  });
  return null;
}

describe("useMonitoringScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("runs jobs at their configured phase and period", () => {
    const skillRune = vi.fn();
    const huntStall = vi.fn();
    const buffExpiry = vi.fn();

    render(
      <SchedulerHarness
        jobs={[
          { id: "skill-rune", periodMs: 450, phaseMs: 450, run: skillRune },
          { id: "hunt-stall", periodMs: 1000, phaseMs: 0, run: huntStall },
          { id: "buff-expiry", periodMs: 1000, phaseMs: 500, run: buffExpiry },
        ]}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(huntStall).toHaveBeenCalledTimes(1);
    expect(skillRune).not.toHaveBeenCalled();
    expect(buffExpiry).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(skillRune).toHaveBeenCalledTimes(1);
    expect(buffExpiry).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(buffExpiry).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(huntStall).toHaveBeenCalledTimes(2);
    expect(skillRune).toHaveBeenCalledTimes(2);
  });

  it("skips overlapping runs for a slow job", async () => {
    const resolvers: Array<() => void> = [];
    const slowJob = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    render(
      <SchedulerHarness
        jobs={[{ id: "slow", periodMs: 1000, phaseMs: 0, run: slowJob }]}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(slowJob).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(slowJob).toHaveBeenCalledTimes(1);

    resolvers[0]?.();
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(slowJob).toHaveBeenCalledTimes(2);
  });

  it("calls the inactive handler without scheduling jobs", () => {
    const job = vi.fn();
    const onInactive = vi.fn();

    render(
      <SchedulerHarness
        active={false}
        jobs={[{ id: "job", periodMs: 1000, phaseMs: 0, run: job }]}
        onInactive={onInactive}
      />,
    );

    expect(onInactive).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(job).not.toHaveBeenCalled();
  });
});
