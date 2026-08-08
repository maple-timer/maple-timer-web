import type { Rect, TimeReadResult } from "./timerTypes";

export type TimerFlowFormat = NonNullable<TimeReadResult["format"]>;

export type UsableTimeReadResult = TimeReadResult & {
  seconds: number;
  text: string;
};

export type TimerFlowPredictionSource = {
  format: TimerFlowFormat | null;
  sampleTime: UsableTimeReadResult | null;
  rect: Rect | null;
};

export function makePredictedTimerFlowTime(
  source: TimerFlowPredictionSource,
  seconds: number | null,
  reason: string,
): TimeReadResult | null {
  if (seconds == null || !Number.isFinite(seconds) || !source.sampleTime)
    return null;
  const format = source.format ?? source.sampleTime.format ?? "m:ss";
  return {
    ...source.sampleTime,
    ok: true,
    reason,
    rect: source.rect ?? source.sampleTime.rect ?? null,
    digits: digitsFromTimerFlowSeconds(seconds, format),
    digitResults: [],
    seconds,
    text: formatTimerFlowSeconds(seconds, format),
    format,
    selectedBy: "time-flow",
  };
}

export function formatTimerFlowSeconds(
  seconds: number,
  format: TimerFlowFormat,
): string {
  if (format === "ss.cc" || format === "s.cc") {
    const centiseconds = Math.max(0, Math.round(seconds * 100));
    const wholeSeconds = Math.floor(centiseconds / 100);
    const fraction = centiseconds % 100;
    if (format === "s.cc")
      return `${wholeSeconds % 10}.${String(fraction).padStart(2, "0")}`;
    return `${String(wholeSeconds).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
  }

  const roundedSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(roundedSeconds / 60);
  const secondPart = roundedSeconds % 60;
  if (format === "mm:ss")
    return `${String(minutes).padStart(2, "0")}:${String(secondPart).padStart(2, "0")}`;
  return `${minutes}:${String(secondPart).padStart(2, "0")}`;
}

export function digitsFromTimerFlowSeconds(
  seconds: number,
  format: TimerFlowFormat,
): number[] {
  if (format === "ss.cc" || format === "s.cc") {
    const centiseconds = Math.max(0, Math.round(seconds * 100));
    const wholeSeconds = Math.floor(centiseconds / 100);
    const fraction = centiseconds % 100;
    const digits = [
      Math.floor(wholeSeconds / 10) % 10,
      wholeSeconds % 10,
      Math.floor(fraction / 10),
      fraction % 10,
    ];
    return format === "s.cc" ? digits.slice(1) : digits;
  }

  const roundedSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(roundedSeconds / 60);
  const secondPart = roundedSeconds % 60;
  if (format === "mm:ss")
    return [
      Math.floor(minutes / 10) % 10,
      minutes % 10,
      Math.floor(secondPart / 10),
      secondPart % 10,
    ];
  return [minutes % 10, Math.floor(secondPart / 10), secondPart % 10];
}
