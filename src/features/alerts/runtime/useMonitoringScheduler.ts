import { useEffect, useMemo, useRef } from "react";

export type MonitoringJob = {
  id: string;
  periodMs: number;
  phaseMs?: number;
  run: (sampledAt: number) => Promise<void> | void;
};

type JobScheduleState = {
  nextDueAt: number;
  running: boolean;
};

export function useMonitoringScheduler({
  active,
  jobs,
  onInactive,
}: {
  active: boolean;
  jobs: MonitoringJob[];
  onInactive?: () => void;
}) {
  const jobsRef = useRef(jobs);
  const onInactiveRef = useRef(onInactive);
  const jobKey = useMemo(
    () =>
      jobs
        .map((job) => `${job.id}:${job.periodMs}:${job.phaseMs ?? 0}`)
        .join("|"),
    [jobs],
  );

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    onInactiveRef.current = onInactive;
  }, [onInactive]);

  useEffect(() => {
    if (!active) {
      onInactiveRef.current?.();
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;
    const startedAt = Date.now();
    const scheduleState = new Map<string, JobScheduleState>();

    const syncScheduleState = () => {
      const activeJobIds = new Set<string>();
      for (const job of jobsRef.current) {
        activeJobIds.add(job.id);
        if (!scheduleState.has(job.id)) {
          scheduleState.set(job.id, {
            nextDueAt: startedAt + Math.max(0, job.phaseMs ?? 0),
            running: false,
          });
        }
      }

      for (const jobId of scheduleState.keys()) {
        if (!activeJobIds.has(jobId)) {
          scheduleState.delete(jobId);
        }
      }
    };

    const queueNextTick = () => {
      if (cancelled) {
        return;
      }

      syncScheduleState();
      const now = Date.now();
      const nextDueAt = Math.min(
        ...Array.from(scheduleState.values(), (state) => state.nextDueAt),
      );
      const delayMs = Number.isFinite(nextDueAt) ? Math.max(0, nextDueAt - now) : 250;
      timerId = window.setTimeout(runDueJobs, delayMs);
    };

    const runDueJobs = () => {
      if (cancelled) {
        return;
      }

      syncScheduleState();
      const now = Date.now();
      for (const job of jobsRef.current) {
        const state = scheduleState.get(job.id);
        if (!state || state.nextDueAt > now) {
          continue;
        }

        while (state.nextDueAt <= now) {
          state.nextDueAt += job.periodMs;
        }

        if (state.running) {
          continue;
        }

        state.running = true;
        try {
          const result = job.run(now);
          if (result && typeof result.then === "function") {
            void result
              .catch(() => {
                // Individual jobs already publish user-visible errors. The scheduler
                // only prevents one failed sample from stopping the whole monitor.
              })
              .finally(() => {
                state.running = false;
              });
          } else {
            state.running = false;
          }
        } catch {
          state.running = false;
        }
      }

      queueNextTick();
    };

    queueNextTick();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [active, jobKey]);
}
