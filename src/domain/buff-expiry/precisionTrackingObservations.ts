import type { BuffExpiryPrecisionExactObservation } from "./precisionTrackingTypes";
import {
  BUFF_EXPIRY_PRECISION_CONFIRM_MAX_SECONDS,
  BUFF_EXPIRY_PRECISION_CONFIRM_MIN_SECONDS,
} from "./precisionTrackingPolicy";

export function isBuffExpiryPrecisionConfirmationSecond(seconds: number): boolean {
  return seconds >= BUFF_EXPIRY_PRECISION_CONFIRM_MIN_SECONDS && seconds <= BUFF_EXPIRY_PRECISION_CONFIRM_MAX_SECONDS;
}

export function getPredictedExpiresAt(observation: BuffExpiryPrecisionExactObservation): number {
  return observation.observedAt + observation.seconds * 1000;
}

export function getBuffExpiryPrecisionObservationWeight(observation: BuffExpiryPrecisionExactObservation): number {
  const countdownStatusWeight = observation.countdownStatus === "high" ? 1 : 0.72;
  const confidenceWeight = clamp(observation.countdownConfidence, 0.35, 1);
  return Math.round(countdownStatusWeight * confidenceWeight * 1000) / 1000;
}

export function getDerivedRemainingSeconds(expiresAt: number, observedAt: number): number {
  return Math.max(0, Math.round((expiresAt - observedAt) / 1000));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
