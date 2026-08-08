import { describe, expect, it } from "vitest";
import type { RuneSnapshot } from "../alertTypes";
import { buildRuneIssueSnapshot } from "./runeIssueSnapshot";
import type { RuneDetectionResult } from "./runeDetection";

const emptyDetection: RuneDetectionResult = {
  detected: false,
  confidence: 0,
  candidates: [],
  debug: {
    purplePixelRatio: 0,
    componentCount: 0,
  },
};

function createSample(rawPreviewUrl: string) {
  return {
    rawPreviewUrl,
    region: { x: 0, y: 0, width: 176, height: 111 },
  };
}

describe("buildRuneIssueSnapshot", () => {
  it("keeps the current frame for false-positive reports", () => {
    const previousSnapshot: RuneSnapshot = {
      sampledAt: 9_000,
      rawPreviewUrl: "data:image/png;base64,laterRaw",
      maskPreviewUrl: "data:image/png;base64,laterMask",
      candidatePreviewUrl: "data:image/png;base64,alertCandidate",
      candidateRawPreviewUrl: "data:image/png;base64,alertRaw",
      candidateMaskPreviewUrl: "data:image/png;base64,alertMask",
      candidateRegionLabel: "12x12",
      candidateSampledAt: 7_000,
      candidate: { x: 4, y: 5, width: 12, height: 12, confidence: 0.81 },
      detected: false,
      confidence: 0,
      candidateCount: 0,
    };

    const snapshot = buildRuneIssueSnapshot({
      previousSnapshot,
      sample: createSample("data:image/png;base64,currentRaw"),
      maskPreviewUrl: "data:image/png;base64,currentMask",
      detection: emptyDetection,
      currentCandidatePreviewUrl: null,
      sampledAt: 10_000,
      issueReason: "rune-false-positive",
    });

    expect(snapshot.rawPreviewUrl).toBe("data:image/png;base64,currentRaw");
    expect(snapshot.maskPreviewUrl).toBe("data:image/png;base64,currentMask");
    expect(snapshot.candidatePreviewUrl).toBeNull();
    expect(snapshot.sampledAt).toBe(10_000);
    expect(snapshot.detected).toBe(false);
    expect(snapshot.confidence).toBe(0);
  });

  it("uses the current frame for non false-positive reports", () => {
    const previousSnapshot: RuneSnapshot = {
      sampledAt: 9_000,
      rawPreviewUrl: "data:image/png;base64,laterRaw",
      maskPreviewUrl: "data:image/png;base64,laterMask",
      candidatePreviewUrl: "data:image/png;base64,oldCandidate",
      candidateRawPreviewUrl: "data:image/png;base64,oldRaw",
      candidateMaskPreviewUrl: "data:image/png;base64,oldMask",
      candidateRegionLabel: "12x12",
      candidateSampledAt: 7_000,
      candidate: { x: 4, y: 5, width: 12, height: 12, confidence: 0.81 },
      detected: true,
      confidence: 0.81,
      candidateCount: 1,
      runtimeIncident: {
        schemaVersion: "rune-runtime-incident-v1",
        id: "1:7000",
        startedAt: 7_000,
        lastSignalAt: 7_000,
        updatedAt: 7_000,
        expiresAt: 67_000,
        detectorVersion: "rune-v13",
        sceneEpoch: 1,
        frames: [],
      },
    };

    const detection: RuneDetectionResult = {
      detected: true,
      confidence: 0.72,
      candidates: [{ x: 10, y: 12, width: 8, height: 8, pixelCount: 40, confidence: 0.72 }],
      debug: {
        purplePixelRatio: 0.02,
        componentCount: 1,
        classifier: "rune-cascade-v8",
        detectorKind: "onnx-cascade",
        proposalCount: 5,
        proposalScore: 0.96,
        selectedProposalRank: 1,
        shapeScore: 0.97,
        shapeThreshold: 0.89,
        shapePass: true,
        appearanceScore: 0.98,
        appearanceThreshold: 0.88,
        appearancePass: true,
        modelScore: 0.72,
        modelThreshold: 0.5,
        proposalInferenceMs: 1.2,
        gateInferenceMs: 0.4,
      },
    };

    const snapshot = buildRuneIssueSnapshot({
      previousSnapshot,
      sample: createSample("data:image/png;base64,currentRaw"),
      maskPreviewUrl: "data:image/png;base64,currentMask",
      detection,
      currentCandidatePreviewUrl: "data:image/png;base64,currentCandidate",
      sampledAt: 10_000,
      issueReason: "rune-missed",
    });

    expect(snapshot.rawPreviewUrl).toBe("data:image/png;base64,currentRaw");
    expect(snapshot.maskPreviewUrl).toBe("data:image/png;base64,currentMask");
    expect(snapshot.candidatePreviewUrl).toBe("data:image/png;base64,currentCandidate");
    expect(snapshot.candidateRawPreviewUrl).toBe("data:image/png;base64,currentRaw");
    expect(snapshot.candidateMaskPreviewUrl).toBe("data:image/png;base64,currentMask");
    expect(snapshot.sampledAt).toBe(10_000);
    expect(snapshot.detectorVersion).toBe("rune-cascade-v8");
    expect(snapshot.candidate).toMatchObject({ x: 10, y: 12, width: 8, height: 8 });
    expect(snapshot.detectionDebug).toMatchObject({
      detectorKind: "onnx-cascade",
      proposalCount: 5,
      selectedProposalRank: 1,
      shapeScore: 0.97,
      shapePass: true,
      appearanceScore: 0.98,
      appearancePass: true,
      proposalInferenceMs: 1.2,
      gateInferenceMs: 0.4,
    });
    expect(snapshot.runtimeIncident).toBe(previousSnapshot.runtimeIncident);
  });
});
