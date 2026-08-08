import type {
  Rect,
  TimeReadResult,
  TimerFlowCorrection,
  TimerFlowOptions,
} from "./timerTypes";
import {
  makePredictedTimerFlowTime,
  type TimerFlowFormat,
  type UsableTimeReadResult,
} from "./timerFlowTimeFormatting";

type TimerFlowSettings = Required<TimerFlowOptions>;

type TimerFlowObservation = {
  seconds: number;
  timestampMs: number;
  format: TimerFlowFormat;
  sampleTime: UsableTimeReadResult;
  rect: Rect | null;
  observations: number;
};

type TimerFlowState = {
  locked: boolean;
  pending: TimerFlowObservation | null;
  seconds: number | null;
  timestampMs: number | null;
  format: TimerFlowFormat | null;
  sampleTime: UsableTimeReadResult | null;
  rect: Rect | null;
  observations: number;
};

const STALE_TIMER_FLOW_RELOCK_MIN_RAW_SECONDS = 20;

export function makeTimerFlowState(): TimerFlowState {
  return {
    locked: false,
    pending: null,
    seconds: null,
    timestampMs: null,
    format: null,
    sampleTime: null,
    rect: null,
    observations: 0,
  };
}

export function updateTimerFlowState(
  state: TimerFlowState,
  rawTime: TimeReadResult | null,
  rawRect: Rect | null,
  options: TimerFlowOptions = {},
  timestampMsInput: number | null | undefined = null,
): TimerFlowCorrection {
  const settings = makeTimerFlowSettings(options);
  const timestampMs = resolveTimerFlowTimestamp(state, settings, timestampMsInput);
  const prediction = predictTimerFlowSeconds(state, timestampMs);
  const result: TimerFlowCorrection = {
    locked: state.locked,
    source: "none",
    time: null,
    rawTime,
    predictedSeconds: prediction,
    rawDeltaSeconds: null,
    timestampMs,
  };

  if (isUsableTimerFlowRawTime(rawTime)) {
    if (!state.locked) {
      return acceptPendingTimerFlowRaw(state, rawTime, rawRect, timestampMs, settings, result);
    }

    if (prediction == null || !Number.isFinite(prediction)) {
      acceptTimerFlowRaw(state, rawTime, rawRect, timestampMs);
      return {
        ...result,
        locked: state.locked,
        source: "raw",
        time: rawTime,
      };
    }

    const rawDeltaSeconds = rawTime.seconds - prediction;
    result.rawDeltaSeconds = rawDeltaSeconds;
    if (Math.abs(rawDeltaSeconds) <= settings.maxJumpSeconds) {
      if (shouldHoldWeakTimerFlowRaw(rawTime, rawDeltaSeconds)) {
        const predictedTime = makePredictedTimerFlowTime(state, prediction, "flow-weak-raw");
        return {
          ...result,
          locked: state.locked,
          source: predictedTime ? "predicted-weak-raw" : "raw",
          time: predictedTime ?? rawTime,
        };
      }

      acceptTimerFlowRaw(state, rawTime, rawRect, timestampMs);
      return {
        ...result,
        locked: state.locked,
        source: "raw",
        time: rawTime,
      };
    }

    if (rawDeltaSeconds >= settings.resetJumpSeconds) {
      state.locked = false;
      state.pending = makeTimerFlowObservation(rawTime, rawRect, timestampMs);
      return {
        ...result,
        locked: false,
        source: "raw-reset-pending",
        time: rawTime,
      };
    }

    const staleRelock = tryRelockStaleTimerFlowRaw(
      state,
      rawTime,
      rawRect,
      rawDeltaSeconds,
      timestampMs,
      settings,
      result,
    );
    if (staleRelock) {
      return staleRelock;
    }

    const predictedTime = makePredictedTimerFlowTime(state, prediction, "flow-rejected-raw");
    return {
      ...result,
      source: predictedTime ? "predicted-rejected-raw" : "rejected-raw",
      time: predictedTime,
    };
  }

  if (state.locked && canHoldTimerFlowPrediction(state, timestampMs, settings)) {
    const predictedTime = makePredictedTimerFlowTime(state, prediction, "flow-missing-raw");
    return {
      ...result,
      locked: true,
      source: predictedTime ? "predicted-missing-raw" : "none",
      time: predictedTime,
    };
  }

  return result;
}

function shouldHoldWeakTimerFlowRaw(rawTime: UsableTimeReadResult, rawDeltaSeconds: number): boolean {
  if (!isMapleDecimalFormat(rawTime.format)) return false;
  if (rawDeltaSeconds > -0.25) return false;

  const weakMargins = rawTime.digitResults.filter((digit) => (digit.scoreMargin ?? 0) < 0.25).length;
  return rawTime.digitResults.some((digit) => digit.selectedBy === "fuzzy" || (digit.scoreMargin ?? 0) < -0.25 || (digit.confidence ?? 0) < 6) || weakMargins >= 2;
}

function tryRelockStaleTimerFlowRaw(
  state: TimerFlowState,
  rawTime: UsableTimeReadResult,
  rawRect: Rect | null,
  rawDeltaSeconds: number,
  timestampMs: number,
  settings: TimerFlowSettings,
  result: TimerFlowCorrection,
): TimerFlowCorrection | null {
  if (rawDeltaSeconds > -settings.resetJumpSeconds) return null;
  if (rawTime.seconds < STALE_TIMER_FLOW_RELOCK_MIN_RAW_SECONDS) return null;

  const pending = state.pending;
  if (!pending || !isTimerFlowTransitionPlausible(pending, rawTime, timestampMs, settings.lockToleranceSeconds)) {
    state.pending = makeTimerFlowObservation(rawTime, rawRect, timestampMs);
    return null;
  }

  acceptTimerFlowRaw(state, rawTime, rawRect, timestampMs);
  state.observations = Math.max(settings.minLockObservations, pending.observations + 1);
  return {
    ...result,
    locked: true,
    source: "raw-relock",
    time: rawTime,
  };
}

function acceptPendingTimerFlowRaw(
  state: TimerFlowState,
  rawTime: UsableTimeReadResult,
  rawRect: Rect | null,
  timestampMs: number,
  settings: TimerFlowSettings,
  result: TimerFlowCorrection,
): TimerFlowCorrection {
  const pending = state.pending;
  if (!pending || !isTimerFlowTransitionPlausible(pending, rawTime, timestampMs, settings.lockToleranceSeconds)) {
    state.pending = makeTimerFlowObservation(rawTime, rawRect, timestampMs);
    if (settings.minLockObservations <= 1) {
      acceptTimerFlowRaw(state, rawTime, rawRect, timestampMs);
      return {
        ...result,
        locked: true,
        source: "raw-lock",
        time: rawTime,
      };
    }

    return {
      ...result,
      locked: false,
      source: "raw-pending",
      time: rawTime,
    };
  }

  acceptTimerFlowRaw(state, rawTime, rawRect, timestampMs);
  state.observations = Math.max(settings.minLockObservations, pending.observations + 1);
  return {
    ...result,
    locked: true,
    source: "raw-lock",
    time: rawTime,
  };
}

function acceptTimerFlowRaw(state: TimerFlowState, rawTime: UsableTimeReadResult, rawRect: Rect | null, timestampMs: number): void {
  state.locked = true;
  state.pending = null;
  state.seconds = rawTime.seconds;
  state.timestampMs = timestampMs;
  state.format = rawTime.format ?? state.format ?? "m:ss";
  state.sampleTime = rawTime;
  state.rect = rawTime.rect ?? rawRect ?? state.rect;
  state.observations += 1;
}

function makeTimerFlowObservation(rawTime: UsableTimeReadResult, rawRect: Rect | null, timestampMs: number): TimerFlowObservation {
  return {
    seconds: rawTime.seconds,
    timestampMs,
    format: rawTime.format ?? "m:ss",
    sampleTime: rawTime,
    rect: rawTime.rect ?? rawRect ?? null,
    observations: 1,
  };
}

function isTimerFlowTransitionPlausible(previous: TimerFlowObservation, rawTime: UsableTimeReadResult, timestampMs: number, toleranceSeconds: number): boolean {
  const elapsedSeconds = Math.max(0, (timestampMs - previous.timestampMs) / 1000);
  const expectedSeconds = Math.max(0, previous.seconds - elapsedSeconds);
  return Math.abs(rawTime.seconds - expectedSeconds) <= toleranceSeconds;
}

function predictTimerFlowSeconds(state: TimerFlowState, timestampMs: number): number | null {
  if (!state.locked || state.seconds == null || state.timestampMs == null || !Number.isFinite(state.seconds) || !Number.isFinite(state.timestampMs)) return null;
  const elapsedSeconds = Math.max(0, (timestampMs - state.timestampMs) / 1000);
  return Math.max(0, state.seconds - elapsedSeconds);
}

function canHoldTimerFlowPrediction(state: TimerFlowState, timestampMs: number, settings: TimerFlowSettings): boolean {
  if (state.timestampMs == null || !Number.isFinite(state.timestampMs)) return false;
  return (timestampMs - state.timestampMs) / 1000 <= settings.maxHoldSeconds;
}

function isUsableTimerFlowRawTime(time: TimeReadResult | null): time is UsableTimeReadResult {
  return Boolean(time?.ok && typeof time.text === "string" && time.seconds != null && Number.isFinite(time.seconds));
}

function resolveTimerFlowTimestamp(state: TimerFlowState, settings: TimerFlowSettings, timestampMsInput: number | null | undefined): number {
  if (timestampMsInput != null && Number.isFinite(timestampMsInput)) return timestampMsInput;
  if (state.timestampMs != null && Number.isFinite(state.timestampMs)) return state.timestampMs + settings.frameIntervalMs;
  if (state.pending?.timestampMs != null && Number.isFinite(state.pending.timestampMs)) return state.pending.timestampMs + settings.frameIntervalMs;
  return 0;
}

function makeTimerFlowSettings(options: TimerFlowOptions = {}): TimerFlowSettings {
  return {
    frameIntervalMs: Math.max(1, Math.round(options.frameIntervalMs ?? 1000)),
    maxJumpSeconds: Math.max(0, options.maxJumpSeconds ?? 1.25),
    lockToleranceSeconds: Math.max(0, options.lockToleranceSeconds ?? 1.5),
    maxHoldSeconds: Math.max(0, options.maxHoldSeconds ?? 12),
    minLockObservations: Math.max(1, Math.round(options.minLockObservations ?? 2)),
    resetJumpSeconds: Math.max(0, options.resetJumpSeconds ?? 30),
  };
}

function isMapleDecimalFormat(format: TimeReadResult["format"] | undefined): boolean {
  return format === "ss.cc" || format === "s.cc";
}
