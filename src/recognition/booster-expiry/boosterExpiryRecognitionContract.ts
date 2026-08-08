import type { Rect, TimeReadResult } from "./timerCatch/timer";

export const BOOSTER_EXPIRY_RECOGNIZER_VERSION = "timer-catch-flow-v1";

export type BoosterExpiryCompactTime = Pick<
  TimeReadResult,
  "ok" | "reason" | "seconds" | "text" | "format" | "selectedBy"
> & {
  rect: Rect | null;
  digitCount: number;
};

export type BoosterExpiryWorkerTimerRect = {
  ok: boolean;
  reason: string;
  rect: Rect | null;
  matchCount: number;
  candidateCount: number;
};

export type BoosterExpiryWorkerFlow = {
  locked: boolean;
  source: string;
  predictedSeconds: number | null;
  rawDeltaSeconds: number | null;
  timestampMs: number;
};

export type BoosterExpiryWorkerResult = {
  recognizerVersion?: string | null;
  rawTime: BoosterExpiryCompactTime | null;
  time: BoosterExpiryCompactTime | null;
  timeRect: BoosterExpiryWorkerTimerRect;
  flow: BoosterExpiryWorkerFlow;
};

export type BoosterExpiryWorkerPerformance = {
  recognitionMs: number;
  totalMs: number;
};
