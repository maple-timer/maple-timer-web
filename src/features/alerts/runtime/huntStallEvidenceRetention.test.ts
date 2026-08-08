import { describe, expect, it } from "vitest";
import type { HuntStallCropHistoryFrame } from "../../../alertTypes";
import {
  appendHuntStallCropHistoryFrame,
  HUNT_STALL_CROP_HISTORY_DATA_URL_MAX_CHARS,
} from "./huntStallSampleProcessorShared";

describe("appendHuntStallCropHistoryFrame", () => {
  it("evicts periodic frames before alert evidence when the byte budget is exceeded", () => {
    const chunk = "A".repeat(Math.floor(HUNT_STALL_CROP_HISTORY_DATA_URL_MAX_CHARS / 3));
    const periodic = createFrame(1_000, ["interval"], chunk);
    const alert = createFrame(2_000, ["alert"], chunk);
    const latest = createFrame(3_000, ["status-change"], chunk);

    const result = appendHuntStallCropHistoryFrame([periodic, alert], latest);

    expect(result.map((entry) => entry.sampledAt)).toEqual([2_000, 3_000]);
  });
});

function createFrame(
  sampledAt: number,
  reasons: string[],
  dataUrl: string,
): HuntStallCropHistoryFrame {
  return {
    sampledAt,
    mode: "manual-experience",
    reasons,
    rawDataUrl: `data:image/png;base64,${dataUrl}`,
    processedDataUrl: null,
    regionLabel: "test",
    recognizedText: null,
    confidence: 0,
    foregroundRatio: 0,
    changeScore: 0,
    cooldownVisualChangeScore: null,
    cooldownVisualChanged: false,
    cooldownUsedVisualActivity: false,
    state: {
      status: "detecting",
      lastDecision: "idle",
      recognizedText: null,
      alertedRecognizedText: null,
      lastRejectedRecognizedText: null,
      lastReadFailureReason: null,
      unchangedSeconds: 0,
      cooldownMissingSeconds: 0,
      alertedAt: null,
    },
  };
}
