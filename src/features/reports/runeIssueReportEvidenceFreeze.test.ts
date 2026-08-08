import { describe, expect, it } from "vitest";
import { createRuneRuntimeState } from "../../lib/runeAlert";
import { createDefaultRuneAlert } from "../../lib/storage";
import type { RuneSnapshot } from "../../alertTypes";
import { createFrozenRuneIssueReportEvidence } from "./runeIssueReportEvidenceFreeze";

describe("createFrozenRuneIssueReportEvidence", () => {
  it("keeps report-open state after live refs advance to a new episode", () => {
    const runtimeState = {
      ...createRuneRuntimeState(),
      sceneEpoch: 4,
      firstDetectedAt: 1_000,
      recentSamples: [
        {
          sampledAt: 1_000,
          detected: true,
          confidence: 0.9,
          candidateCount: 1,
          candidate: { x: 1, y: 2, width: 10, height: 10 },
          status: "candidate" as const,
          stableCount: 1,
          shouldAlert: false,
          reason: "stabilizing" as const,
        },
      ],
    };
    const config = {
      ...createDefaultRuneAlert(),
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      regionsByLayout: {
        "1920x1080": { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      },
    };
    const snapshot = createSnapshot(1_000);
    const frozen = createFrozenRuneIssueReportEvidence({
      capturedAt: 1_100,
      frameLayoutKey: "1920x1080",
      currentRegion: config.region,
      runeConfig: config,
      runtimeState,
      snapshot,
    });

    runtimeState.sceneEpoch = 5;
    runtimeState.recentSamples![0].sampledAt = 2_000;
    config.region!.x = 0.8;
    config.regionsByLayout!["1920x1080"].x = 0.8;
    snapshot.runtimeIncident!.frames[0].sampledAt = 2_000;
    snapshot.evidenceArchive!.runtimeIncidents[0].frames[0].sampledAt = 3_000;
    snapshot.evidenceArchive!.mediaBudget.retainedFrameIds[0] = "frame:3000";

    expect(frozen).toMatchObject({
      capturedAt: 1_100,
      currentRegion: { x: 0.1 },
      runeConfig: {
        region: { x: 0.1 },
        regionsByLayout: { "1920x1080": { x: 0.1 } },
      },
      runtimeState: {
        sceneEpoch: 4,
        recentSamples: [{ sampledAt: 1_000 }],
      },
      snapshot: {
        runtimeIncident: { frames: [{ sampledAt: 1_000 }] },
        evidenceArchive: {
          runtimeIncidents: [{ frames: [{ sampledAt: 1_000 }] }],
          mediaBudget: { retainedFrameIds: ["frame:1000"] },
        },
      },
    });
  });

  it("shares immutable image buffers instead of duplicating them", () => {
    const snapshot = createSnapshot(1_000);
    const frozen = createFrozenRuneIssueReportEvidence({
      capturedAt: 1_100,
      frameLayoutKey: null,
      currentRegion: null,
      runeConfig: createDefaultRuneAlert(),
      runtimeState: createRuneRuntimeState(),
      snapshot,
    });

    expect(frozen.snapshot?.rawPreviewImageData).toBe(snapshot.rawPreviewImageData);
    expect(frozen.snapshot?.runtimeIncident?.frames[0].rawDataUrl).toBe(
      snapshot.runtimeIncident?.frames[0].rawDataUrl,
    );
    expect(frozen.snapshot?.evidenceArchive?.runtimeIncidents[0]?.frames[0].rawDataUrl)
      .toBe(snapshot.evidenceArchive?.runtimeIncidents[0]?.frames[0].rawDataUrl);
  });
});

function createSnapshot(sampledAt: number): RuneSnapshot {
  const rawPreviewImageData = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([1, 2, 3, 255]),
  };
  return {
    sampledAt,
    rawPreviewUrl: "data:image/png;base64,runtime",
    rawPreviewImageData,
    maskPreviewUrl: null,
    candidatePreviewUrl: null,
    candidateRawPreviewUrl: null,
    candidateMaskPreviewUrl: null,
    candidateRegionLabel: null,
    candidateSampledAt: null,
    candidate: null,
    detected: false,
    confidence: 0,
    candidateCount: 0,
    runtimeIncident: {
      schemaVersion: "rune-runtime-incident-v1",
      id: "incident-1",
      startedAt: sampledAt,
      lastSignalAt: sampledAt,
      updatedAt: sampledAt,
      expiresAt: sampledAt + 60_000,
      detectorVersion: "rune-v1",
      sceneEpoch: 4,
      frames: [
        {
          source: "runtime",
          phase: "signal",
          outcome: "not-detected",
          sampledAt,
          detectorVersion: "rune-v1",
          detectionDebug: null,
          detectionError: null,
          rawDataUrl: "data:image/png;base64,runtime",
          detected: false,
          confidence: 0,
          candidateCount: 0,
          candidate: null,
          status: "waiting",
          stableCount: 0,
          firstDetectedAt: null,
          stableDurationMs: 0,
          confirmationSatisfied: false,
          confirmationSatisfiedBy: null,
          shouldAlert: false,
          reason: "waiting",
          sceneEpoch: 4,
          sceneChanged: false,
          sceneChangeScore: null,
        },
      ],
    },
    evidenceArchive: {
      policy: "rune-recent-evidence-v1",
      retainedAt: sampledAt,
      runtimeIncidents: [
        {
          schemaVersion: "rune-runtime-incident-v1",
          id: "incident-archive-1",
          episodeId: `rune-episode:4:${sampledAt}`,
          startedAt: sampledAt,
          lastSignalAt: sampledAt,
          updatedAt: sampledAt,
          expiresAt: sampledAt + 60_000,
          detectorVersion: "rune-v1",
          sceneEpoch: 4,
          frames: [
            {
              source: "runtime",
              phase: "signal",
              outcome: "not-detected",
              sampledAt,
              detectorVersion: "rune-v1",
              detectionDebug: null,
              detectionError: null,
              rawDataUrl: "data:image/png;base64,runtime",
              detected: false,
              confidence: 0,
              candidateCount: 0,
              candidate: null,
              status: "waiting",
              stableCount: 0,
              firstDetectedAt: null,
              stableDurationMs: 0,
              confirmationSatisfied: false,
              confirmationSatisfiedBy: null,
              shouldAlert: false,
              reason: "waiting",
              sceneEpoch: 4,
              sceneChanged: false,
              sceneChangeScore: null,
            },
          ],
        },
      ],
      alertTriggers: [],
      mediaBudget: {
        policy: "rune-shared-media-v1",
        retainedFrameIds: [`frame:${sampledAt}`],
        retainedChars: 36,
        omittedOversized: 0,
        omittedCapacity: 0,
      },
    },
  };
}
