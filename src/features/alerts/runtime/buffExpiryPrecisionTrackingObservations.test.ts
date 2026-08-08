import { describe, expect, it } from "vitest";
import type {
  BuffExpiryPrecisionBestGroupCandidate,
  BuffExpiryPrecisionCountdownObservation,
} from "../../../runtime/buff-expiry/analysis/buffExpiryPrecisionAnalysisRuntime";
import { toBuffExpiryPrecisionContinuityCandidates } from "./buffExpiryPrecisionTrackingObservations";

function createCountdown(
  status: BuffExpiryPrecisionCountdownObservation["status"],
): BuffExpiryPrecisionCountdownObservation {
  return {
    kind: "exact",
    text: "30",
    totalSeconds: 30,
    format: "seconds",
    textRegion: "center",
    confidence: 0.9,
    status,
    routerTarget: "center",
    routerConfidence: 0.9,
    routerStatus: "ready",
  };
}

function createCandidate(
  status: BuffExpiryPrecisionCountdownObservation["status"],
): BuffExpiryPrecisionBestGroupCandidate {
  return {
    group: "unionLuck",
    boxIndex: 0,
    box: {
      x: 10,
      y: 20,
      size: 32,
      row: 1,
      col: 2,
      confidence: 0.9,
      score: 1,
    },
    accepted: true,
    matcherAccepted: true,
    winningGroup: "unionLuck",
    score: 2,
    margin: 0.5,
    gateMargin: 0.25,
    decisionReason: "target_accepted",
    countdown: createCountdown(status),
  };
}

describe("buff expiry precision tracking observation adapters", () => {
  it("normalizes runtime candidates and excludes low-confidence countdown values", () => {
    const candidates = toBuffExpiryPrecisionContinuityCandidates([
      createCandidate("high"),
      createCandidate("low"),
    ]);

    expect(candidates).toEqual([
      {
        group: "unionLuck",
        box: {
          x: 10,
          y: 20,
          width: 32,
          height: 32,
          confidence: 1,
          side: 32,
          row: 1,
          col: 2,
        },
        accepted: true,
        seconds: 30,
        score: 2,
        margin: 0.5,
        gateMargin: 0.25,
      },
      {
        group: "unionLuck",
        box: {
          x: 10,
          y: 20,
          width: 32,
          height: 32,
          confidence: 1,
          side: 32,
          row: 1,
          col: 2,
        },
        accepted: true,
        seconds: null,
        score: 2,
        margin: 0.5,
        gateMargin: 0.25,
      },
    ]);
  });
});
