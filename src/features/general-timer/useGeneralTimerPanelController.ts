import { useEffect, useRef, useState } from "react";
import {
  getGeneralTimerDurationSeconds,
  getGeneralTimerNextAutoRestartRange,
  getGeneralTimerPreset,
  getGeneralTimerRemainingSeconds,
  getGeneralTimerStatus,
  MAX_GENERAL_TIMER_SECONDS,
  MIN_GENERAL_TIMER_SECONDS,
} from "../../domain/general-timer/generalTimers";
import { trackFeatureSessionActive } from "../../lib/analyticsEvents";
import { createGeneralTimerTickerWorkerClient } from "../../platform/runtime-workers/general-timer/generalTimerTickerWorkerClient";
import type { GeneralTimerConfig, GeneralTimerPresetId } from "../../types";

const GENERAL_TIMER_TICK_INTERVAL_MS = 250;

function clampCustomDurationSeconds(durationSeconds: number) {
  return Math.min(
    MAX_GENERAL_TIMER_SECONDS,
    Math.max(MIN_GENERAL_TIMER_SECONDS, Math.round(durationSeconds)),
  );
}

function trackGeneralTimerSessionActive(
  timer: GeneralTimerConfig,
  enabledCount: number,
) {
  trackFeatureSessionActive("general_timer", {
    mode: "timer",
    item: timer.presetId,
    enabledCount,
  });
}

function hasRunningGeneralTimer({
  timers,
  isGloballyDisabled,
  now,
}: {
  timers: GeneralTimerConfig[];
  isGloballyDisabled: boolean;
  now: number;
}) {
  return (
    !isGloballyDisabled &&
    timers.some((timer) => timer.enabled && getGeneralTimerStatus(timer, now) === "running")
  );
}

export function useGeneralTimerPanelController({
  timers,
  isGloballyDisabled,
  onAddTimer,
  onChangeTimer,
  onTimerAlert,
}: {
  timers: GeneralTimerConfig[];
  isGloballyDisabled: boolean;
  onAddTimer: () => string | void;
  onChangeTimer: (timerId: string, patch: Partial<GeneralTimerConfig>) => void;
  onTimerAlert: (soundId: string, volume: number) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [expandedTimerIds, setExpandedTimerIds] = useState<string[]>([]);
  const completedRef = useRef(new Set<string>());
  const didInitialSweepRef = useRef(false);
  const wasGloballyDisabledRef = useRef(isGloballyDisabled);
  const shouldRunTicker = hasRunningGeneralTimer({ timers, isGloballyDisabled, now });

  useEffect(() => {
    if (!shouldRunTicker) {
      return;
    }

    let isMounted = true;
    let fallbackIntervalId: number | null = null;

    const startFallbackTicker = () => {
      if (fallbackIntervalId !== null) {
        return;
      }

      setNow(Date.now());
      fallbackIntervalId = window.setInterval(
        () => setNow(Date.now()),
        GENERAL_TIMER_TICK_INTERVAL_MS,
      );
    };

    const workerClient = createGeneralTimerTickerWorkerClient();
    const started = workerClient.start({
      intervalMs: GENERAL_TIMER_TICK_INTERVAL_MS,
      onTick: (tickNow) => {
        if (isMounted) {
          setNow(tickNow);
        }
      },
      onUnavailable: () => {
        if (isMounted) {
          startFallbackTicker();
        }
      },
    });
    if (!started) {
      startFallbackTicker();
      return () => {
        isMounted = false;
        if (fallbackIntervalId !== null) {
          window.clearInterval(fallbackIntervalId);
        }
      };
    }

    return () => {
      isMounted = false;
      workerClient.stop();
      if (fallbackIntervalId !== null) {
        window.clearInterval(fallbackIntervalId);
      }
    };
  }, [shouldRunTicker]);

  useEffect(() => {
    for (const timer of timers) {
      const remainingSeconds = getGeneralTimerRemainingSeconds(timer, now);
      if (timer.endsAt !== null && remainingSeconds > 0) {
        completedRef.current.delete(timer.id);
      }

      if (
        !timer.enabled ||
        isGloballyDisabled ||
        timer.endsAt === null ||
        timer.alertedAt !== null ||
        remainingSeconds > 0 ||
        completedRef.current.has(timer.id)
      ) {
        continue;
      }

      completedRef.current.add(timer.id);
      if (didInitialSweepRef.current) {
        if (timer.autoRestartEnabled === true) {
          const restartRange = getGeneralTimerNextAutoRestartRange(timer, now);
          onChangeTimer(timer.id, {
            startedAt: restartRange.startedAt,
            endsAt: restartRange.endsAt,
            remainingSecondsAtPause: null,
            alertedAt: null,
          });
          onTimerAlert(timer.soundId, timer.volume);
          continue;
        }

        onChangeTimer(timer.id, { alertedAt: now, remainingSecondsAtPause: 0 });
        onTimerAlert(timer.soundId, timer.volume);
        continue;
      }

      onChangeTimer(timer.id, { alertedAt: now, remainingSecondsAtPause: 0 });
    }

    didInitialSweepRef.current = true;
  }, [isGloballyDisabled, now, onChangeTimer, onTimerAlert, timers]);

  useEffect(() => {
    const wasGloballyDisabled = wasGloballyDisabledRef.current;
    wasGloballyDisabledRef.current = isGloballyDisabled;
    if (wasGloballyDisabled || !isGloballyDisabled) {
      return;
    }

    for (const timer of timers) {
      if (!timer.enabled || getGeneralTimerStatus(timer, now) !== "running") {
        continue;
      }

      onChangeTimer(timer.id, {
        endsAt: null,
        remainingSecondsAtPause: getGeneralTimerRemainingSeconds(timer, now),
      });
    }
  }, [isGloballyDisabled, now, onChangeTimer, timers]);

  const toggleExpanded = (timerId: string) => {
    setExpandedTimerIds((current) =>
      current.includes(timerId)
        ? current.filter((id) => id !== timerId)
        : [...current, timerId],
    );
  };

  const updatePreset = (timer: GeneralTimerConfig, presetId: GeneralTimerPresetId) => {
    const preset = getGeneralTimerPreset(presetId);
    onChangeTimer(timer.id, {
      presetId,
      customDurationSeconds:
        presetId === "custom"
          ? timer.customDurationSeconds ?? preset.durationSeconds
          : undefined,
      startedAt: null,
      endsAt: null,
      remainingSecondsAtPause: null,
      alertedAt: null,
    });
  };

  const changeCustomDuration = (timerId: string, durationSeconds: number) => {
    onChangeTimer(timerId, {
      customDurationSeconds: clampCustomDurationSeconds(durationSeconds),
      startedAt: null,
      endsAt: null,
      remainingSecondsAtPause: null,
      alertedAt: null,
    });
  };

  const startOrPauseTimer = (timer: GeneralTimerConfig) => {
    if (isGloballyDisabled || !timer.enabled) {
      return;
    }

    const actionNow = Date.now();
    const status = getGeneralTimerStatus(timer, actionNow);
    if (status === "running") {
      onChangeTimer(timer.id, {
        endsAt: null,
        remainingSecondsAtPause: getGeneralTimerRemainingSeconds(timer, actionNow),
      });
      return;
    }

    const remainingSeconds =
      status === "paused" && timer.remainingSecondsAtPause !== null
        ? timer.remainingSecondsAtPause
        : getGeneralTimerDurationSeconds(timer);
    trackGeneralTimerSessionActive(
      timer,
      timers.filter((candidate) => candidate.enabled).length,
    );
    onChangeTimer(timer.id, {
      startedAt: actionNow,
      endsAt: actionNow + remainingSeconds * 1000,
      remainingSecondsAtPause: null,
      alertedAt: null,
    });
  };

  const startAllEnabledTimers = () => {
    if (isGloballyDisabled) {
      return;
    }

    const enabledTimerCount = timers.filter((timer) => timer.enabled).length;
    const actionNow = Date.now();
    for (const timer of timers) {
      if (!timer.enabled) {
        continue;
      }

      const status = getGeneralTimerStatus(timer, actionNow);
      if (status === "running") {
        continue;
      }

      completedRef.current.delete(timer.id);
      const remainingSeconds =
        status === "paused" && timer.remainingSecondsAtPause !== null
          ? timer.remainingSecondsAtPause
          : getGeneralTimerDurationSeconds(timer);
      trackGeneralTimerSessionActive(timer, enabledTimerCount);
      onChangeTimer(timer.id, {
        startedAt: actionNow,
        endsAt: actionNow + remainingSeconds * 1000,
        remainingSecondsAtPause: null,
        alertedAt: null,
      });
    }
  };

  const pauseAllRunningTimers = () => {
    if (isGloballyDisabled) {
      return;
    }

    const actionNow = Date.now();
    for (const timer of timers) {
      if (!timer.enabled || getGeneralTimerStatus(timer, actionNow) !== "running") {
        continue;
      }

      onChangeTimer(timer.id, {
        endsAt: null,
        remainingSecondsAtPause: getGeneralTimerRemainingSeconds(timer, actionNow),
      });
    }
  };

  const resetTimer = (timerId: string) => {
    completedRef.current.delete(timerId);
    onChangeTimer(timerId, {
      startedAt: null,
      endsAt: null,
      remainingSecondsAtPause: null,
      alertedAt: null,
    });
  };

  const resetAllTimers = () => {
    completedRef.current.clear();
    for (const timer of timers) {
      onChangeTimer(timer.id, {
        startedAt: null,
        endsAt: null,
        remainingSecondsAtPause: null,
        alertedAt: null,
      });
    }
  };

  const addAndExpandTimer = () => {
    const timerId = onAddTimer();
    if (!timerId) {
      return;
    }
    setExpandedTimerIds((current) =>
      current.includes(timerId) ? current : [...current, timerId],
    );
  };

  return {
    now,
    expandedTimerIds,
    toggleExpanded,
    updatePreset,
    changeCustomDuration,
    startOrPauseTimer,
    startAllEnabledTimers,
    pauseAllRunningTimers,
    resetTimer,
    resetAllTimers,
    addAndExpandTimer,
  };
}
