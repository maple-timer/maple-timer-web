import type {
  BuffExpiryPrecisionContinuityCandidate,
  BuffExpiryBox,
  BuffExpiryPrecisionExactObservation,
} from "../../../domain/buff-expiry/precisionTrackingTypes";
import type {
  BuffExpiryPrecisionBestGroupCandidate,
  BuffExpiryPrecisionCountdownObservation,
  BuffExpiryPrecisionIconObservation,
} from "../../../runtime/buff-expiry/analysis/buffExpiryPrecisionAnalysisRuntime";
import { BUFF_EXPIRY_PRECISION_CONFIRM_MAX_SECONDS } from "../../../domain/buff-expiry/precisionTrackingPolicy";

export {
  getBuffExpiryPrecisionObservationWeight,
  getDerivedRemainingSeconds,
  getPredictedExpiresAt,
  isBuffExpiryPrecisionConfirmationSecond,
} from "../../../domain/buff-expiry/precisionTrackingObservations";

export type { BuffExpiryPrecisionExactObservation } from "../../../domain/buff-expiry/precisionTrackingTypes";

export function toAcceptedExactObservation(
  observation: BuffExpiryPrecisionIconObservation,
  now: number,
): BuffExpiryPrecisionExactObservation[] {
  if (observation.identity.kind !== "target" || !observation.identity.group) {
    return [];
  }
  const seconds = getExactCountdownSeconds(observation.countdown);
  if (seconds === null || seconds < 0 || seconds > BUFF_EXPIRY_PRECISION_CONFIRM_MAX_SECONDS) {
    return [];
  }
  const countdown = observation.countdown!;
  return [
    {
      group: observation.identity.group,
      box: toBuffExpiryBox(observation.box),
      seconds,
      observedAt: now,
      score: observation.identity.score,
      margin: observation.identity.margin,
      reason: observation.identity.decisionReason,
      countdownConfidence: countdown.confidence,
      countdownStatus: countdown.status,
    },
  ];
}

export function getExactCountdownSeconds(countdown: BuffExpiryPrecisionCountdownObservation | null | undefined): number | null {
  if (!countdown || countdown.kind !== "exact" || countdown.totalSeconds === null) {
    return null;
  }
  if (countdown.status === "missing" || countdown.status === "low") {
    return null;
  }
  return countdown.totalSeconds;
}

export function toBuffExpiryPrecisionContinuityCandidates(
  candidates: BuffExpiryPrecisionBestGroupCandidate[],
): BuffExpiryPrecisionContinuityCandidate[] {
  return candidates.map((candidate) => ({
    group: candidate.group,
    box: toBuffExpiryBox(candidate.box),
    accepted: candidate.accepted,
    seconds: getExactCountdownSeconds(candidate.countdown),
    score: candidate.score,
    margin: candidate.margin,
    gateMargin: candidate.gateMargin,
  }));
}

export function toBuffExpiryBox(box: { x: number; y: number; size: number; row: number; col: number }): BuffExpiryBox {
  return {
    x: box.x,
    y: box.y,
    width: box.size,
    height: box.size,
    confidence: 1,
    side: box.size,
    row: box.row,
    col: box.col,
  };
}
