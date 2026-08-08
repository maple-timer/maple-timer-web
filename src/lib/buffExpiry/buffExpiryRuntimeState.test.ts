import { describe, expect, it } from "vitest";
import { createBuffExpiryRuntimeState } from "./buffExpiryRuntimeState";

describe("buffExpiryRuntimeState", () => {
  it("creates a paused runtime state", () => {
    expect(createBuffExpiryRuntimeState()).toEqual({
      status: "paused",
      tracks: [],
      pendingTracks: [],
      confirmationCandidateCount: 0,
      lastSampledAt: null,
      lastDetectedAt: null,
      lastAlertedAt: null,
      lastAlertPlayback: null,
      lastAlertEvidence: null,
      boxCount: 0,
      acceptedMatchCount: 0,
      unsupportedReason: null,
      performance: null,
    });
  });
});
