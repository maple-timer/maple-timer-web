import {
  createTimerCatchFlow,
  type Rect,
  type TimerCatchResult,
  type TimeReadResult,
} from "./timerCatch/timer";
import type {
  BoosterExpiryCompactTime,
  BoosterExpiryWorkerResult,
} from "./boosterExpiryRecognitionContract";
import { BOOSTER_EXPIRY_RECOGNIZER_VERSION } from "./boosterExpiryRecognitionContract";

const tracker = createTimerCatchFlow({
  autoUpscale: false,
  timerFlow: {
    frameIntervalMs: 1000,
    maxJumpSeconds: 1.25,
    lockToleranceSeconds: 1.5,
    maxHoldSeconds: 12,
    minLockObservations: 2,
    resetJumpSeconds: 5,
  },
});

export function resetBoosterExpiryWorkerCore(): void {
  tracker.reset();
}

export function processBoosterExpiryFrame(
  imageData: ImageData,
  timestampMs: number,
): BoosterExpiryWorkerResult {
  const result = tracker.update(imageData, {
    timestampMs,
    roi: {
      x: 0,
      y: 0,
      width: imageData.width,
      height: imageData.height,
    },
  });
  return compactTimerCatchResult(result);
}

function compactTimerCatchResult(result: TimerCatchResult): BoosterExpiryWorkerResult {
  return {
    recognizerVersion: BOOSTER_EXPIRY_RECOGNIZER_VERSION,
    rawTime: compactTime(result.rawTime),
    time: compactTime(result.time),
    timeRect: {
      ok: result.timeRect.ok,
      reason: result.timeRect.reason,
      rect: result.timeRect.rect,
      matchCount: result.timeRect.matches.length,
      candidateCount: result.timeRect.candidates.length,
    },
    flow: {
      locked: result.flow.locked,
      source: result.flow.source,
      predictedSeconds: result.flow.predictedSeconds,
      rawDeltaSeconds: result.flow.rawDeltaSeconds,
      timestampMs: result.flow.timestampMs,
    },
  };
}

function compactTime(time: TimeReadResult | null): BoosterExpiryCompactTime | null {
  if (!time) {
    return null;
  }

  return {
    ok: time.ok,
    reason: time.reason,
    rect: normalizeRect(time.rect),
    digitCount: time.digits.length,
    seconds: time.seconds,
    text: time.text,
    format: time.format,
    selectedBy: time.selectedBy,
  };
}

function normalizeRect(rect: Rect | null): Rect | null {
  if (!rect) {
    return null;
  }
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}
