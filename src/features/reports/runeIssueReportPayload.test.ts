import { describe, expect, it } from "vitest";
import type { RuneRuntimeState, RuneSnapshot } from "../../alertTypes";
import {
  RUNE_ONNX_MODEL_VERSION,
  RUNE_ONNX_THRESHOLD,
} from "../../recognition/rune/runeOnnxContract";
import type { RuneAlertConfig } from "../../types";
import {
  buildRuneDebugReportPayload,
  buildRuneIssueReportPayload,
} from "./runeIssueReportPayload";
import type { AlertIncidentJournalSelection } from "../../application/reporting/alertIncidentJournal";

const CURRENT_RUNE_MODEL = RUNE_ONNX_MODEL_VERSION;

const runeConfig: RuneAlertConfig = {
  enabled: true,
  region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  regionsByLayout: {},
  soundId: "default",
  volume: 1,
  repeatAlertEnabled: false,
  repeatAlertIntervalSeconds: 5,
  repeatAlertMaxCount: null,
};

const runeState: RuneRuntimeState = {
  status: "alerted",
  detectorVersion: CURRENT_RUNE_MODEL,
  confidence: 0.9,
  stableCount: 3,
  consecutiveMissCount: 0,
  scenePolicyVersion: "rune-scene-v1",
  sceneEpoch: 2,
  sceneChangedAt: 1_000,
  sceneChangeScore: 0.31,
  scenePendingStableCount: 0,
  firstDetectedAt: 500,
  lastDetectedAt: 1_500,
  lastFoundAt: 500,
  alertedAt: 1_500,
  alertedSceneEpoch: 2,
  lastDetectedCandidate: { x: 20, y: 30, width: 12, height: 12 },
  alertedCandidate: { x: 20, y: 30, width: 12, height: 12 },
  lastRepeatedAlertAt: null,
  repeatedAlertCount: 0,
  lastAlertedAt: 1_500,
  candidateCount: 1,
  lastDecisionReason: "initial-alert",
  lastAlertPlayback: {
    status: "finished",
    decision: "initial",
    cycleId: "2:1500:initial",
    sceneEpoch: 2,
    requestedAt: 1_500,
    startedAt: 1_500,
    finishedAt: 1_900,
    failedAt: null,
    error: null,
    soundId: "default",
    alertVolume: 1,
    masterVolume: 0.8,
    effectiveVolume: 0.8,
  },
  recentSamples: [
    {
      sampledAt: 1_500,
      detected: true,
      confidence: 0.9,
      candidateCount: 1,
      candidate: { x: 20, y: 30, width: 12, height: 12 },
      status: "alerted",
      stableCount: 3,
      consecutiveMissCount: 0,
      scenePolicyVersion: "rune-scene-v1",
      sceneEpoch: 2,
      sceneChanged: true,
      sceneChangeScore: 0.31,
      scenePendingStableCount: 0,
      firstDetectedAt: 500,
      stableDurationMs: 1_000,
      confirmationPolicyVersion: "rune-confirmation-v2",
      confirmationPolicyMode: "all",
      confirmationSatisfied: true,
      confirmationSatisfiedBy: "frames-and-duration",
      shouldAlert: true,
      reason: "initial-alert",
    },
  ],
};

function createRuneSnapshot(partial: Partial<RuneSnapshot> = {}): RuneSnapshot {
  return {
    sampledAt: 2_000,
    detectorVersion: CURRENT_RUNE_MODEL,
    detectionDebug: {
      detectorKind: "onnx-full-frame",
      classifier: CURRENT_RUNE_MODEL,
      modelScore: 0.9,
      modelThreshold: RUNE_ONNX_THRESHOLD,
      inferenceMs: 3.5,
      reason: null,
    },
    rawPreviewUrl: "data:image/png;base64,currentRaw",
    rawPreviewImageData: {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([255, 0, 255, 255]),
    },
    maskPreviewUrl: "data:image/png;base64,currentMask",
    maskPreviewImageData: {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([255, 0, 255, 255]),
    },
    candidatePreviewUrl: "data:image/png;base64,currentCandidate",
    candidatePreviewImageData: {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 255, 255]),
    },
    candidateRawPreviewUrl: "data:image/png;base64,currentRaw",
    candidateRawPreviewImageData: null,
    candidateMaskPreviewUrl: "data:image/png;base64,currentMask",
    candidateMaskPreviewImageData: null,
    candidateRegionLabel: "12x12",
    candidateSampledAt: 2_000,
    candidate: {
      x: 20,
      y: 30,
      width: 12,
      height: 12,
      confidence: 0.9,
      source: "onnx-full-frame",
    },
    detected: true,
    confidence: 0.9,
    candidateCount: 1,
    ...partial,
  };
}

describe("buildRuneIssueReportPayload", () => {
  it("adds the current report contract to debug payloads", () => {
    const payload = buildRuneDebugReportPayload({
      submittedAt: "2026-07-04T00:00:00.000Z",
      url: "https://maple-timer.com/",
      viewportDiagnostics: { userAgent: "vitest", viewport: { width: 1280, height: 720 } },
      captureSize: { width: 1920, height: 1080 },
      layoutKey: "1920x1080",
      sample: {
        imageData: {
          width: 1,
          height: 1,
          data: new Uint8ClampedArray([0, 0, 0, 255]),
        } as ImageData,
        rawPreviewUrl: "data:image/png;base64,raw",
        region: { x: 0, y: 0, width: 320, height: 180 },
      },
      maskPreviewUrl: "data:image/png;base64,mask",
      runeConfig,
      currentRegion: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      runeState,
      lastSnapshot: null,
      detection: {
        detected: false,
        confidence: 0,
        candidates: [],
        debug: { classifier: CURRENT_RUNE_MODEL },
      },
      candidatePreviewUrl: null,
    });

    expect(payload.reportContract).toEqual({
      schema: "maple-timer.alert-report",
      version: 1,
    });
  });

  it("keeps current and last-alert rune evidence without serializing image data snapshots", () => {
    const currentSnapshot = createRuneSnapshot();
    const lastAlertSnapshot = createRuneSnapshot({
      sampledAt: 1_500,
      rawPreviewUrl: "data:image/png;base64,lastLiveRaw",
      maskPreviewUrl: "data:image/png;base64,lastLiveMask",
      candidatePreviewUrl: "data:image/png;base64,lastAlertCandidate",
      candidateRawPreviewUrl: "data:image/png;base64,trigger-1500",
      candidateMaskPreviewUrl: "data:image/png;base64,lastAlertMask",
      candidateSampledAt: 1_500,
      candidate: {
        x: 10,
        y: 11,
        width: 14,
        height: 14,
        confidence: 0.84,
        source: "onnx-full-frame",
      },
      confidence: 0.84,
      lastAlertTrigger: {
        schemaVersion: "rune-alert-trigger-v1",
        cycleId: "2:1500:initial",
        decision: "initial",
        triggeredAt: 1_500,
        detectorVersion: CURRENT_RUNE_MODEL,
        sceneEpoch: 2,
        frames: [
          createAlertTriggerFrame(500, 1, false),
          createAlertTriggerFrame(1_000, 2, false),
          createAlertTriggerFrame(1_500, 3, true),
        ],
      },
    });

    const payload = buildRuneIssueReportPayload({
      submittedAt: "2026-07-04T00:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: { userAgent: "vitest", viewport: { width: 1280, height: 720 } },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      snapshot: currentSnapshot,
      lastAlertSnapshot,
      runeConfig,
      currentRegion: runeConfig.region,
      runeState,
      issue: {
        reason: "rune-false-positive",
        label: "다른 것을 룬으로 감지해요",
        note: "",
      },
    });

    expect(payload.reportContract).toEqual({
      schema: "maple-timer.alert-report",
      version: 1,
    });
    expect(payload.incident.evidenceManifest.references.map((entry) => entry.id)).toEqual([
      "rune-source",
      "rune-report-frame",
      "rune-trace",
      "rune-state-binding",
      "rune-decision",
      "rune-playback",
      "rune-config",
      "rune-runtime",
    ]);
    expect(payload.sample.rawDataUrl).toBe("data:image/png;base64,currentRaw");
    expect(payload.sample.candidateDataUrl).toBe("data:image/png;base64,currentCandidate");
    expect(payload.sample.runeEvidence.current).toMatchObject({
      sampledAt: 2_000,
      detectorVersion: CURRENT_RUNE_MODEL,
      candidateDataUrl: null,
      candidateMediaPath: "sample.candidateDataUrl",
      candidate: { x: 20, y: 30, width: 12, height: 12 },
      detectionDebug: {
        detectorKind: "onnx-full-frame",
        classifier: CURRENT_RUNE_MODEL,
        modelScore: 0.9,
        modelThreshold: RUNE_ONNX_THRESHOLD,
      },
    });
    expect(payload.sample.runeEvidence.lastAlert).toMatchObject({
      sampledAt: 1_500,
      rawDataUrl: null,
      rawFrameId: "frame:1500",
      processedDataUrl: "data:image/png;base64,lastAlertMask",
      candidateDataUrl: "data:image/png;base64,lastAlertCandidate",
      candidate: { x: 10, y: 11, width: 14, height: 14 },
    });
    expect(payload.sample.runeEvidence.alertTrigger).toMatchObject({
      schemaVersion: "rune-alert-trigger-v1",
      cycleId: "2:1500:initial",
      triggeredAt: 1_500,
      detectorVersion: CURRENT_RUNE_MODEL,
      frames: [
        { sampledAt: 500, stableCount: 1, shouldAlert: false },
        { sampledAt: 1_000, stableCount: 2, shouldAlert: false },
        {
          sampledAt: 1_500,
          stableCount: 3,
          confirmationSatisfied: true,
          shouldAlert: true,
          frameId: "frame:1500",
        },
      ],
    });
    expect(payload.sample.runeEvidence.runtimeFrames).toEqual([
      expect.objectContaining({
        frameId: "frame:500",
        rawDataUrl: "data:image/png;base64,trigger-500",
        roles: ["alert-trigger"],
        cycleIds: ["2:1500:initial"],
      }),
      expect.objectContaining({
        frameId: "frame:1000",
        rawDataUrl: "data:image/png;base64,trigger-1000",
      }),
      expect.objectContaining({
        frameId: "frame:1500",
        rawDataUrl: "data:image/png;base64,trigger-1500",
      }),
    ]);
    expect(payload.sample.runeEvidence.alertAttempts).toEqual([
      expect.objectContaining({
        cycleId: "2:1500:initial",
        parentEpisodeId: "rune-episode:2:500",
        frameIds: ["frame:500", "frame:1000", "frame:1500"],
      }),
    ]);
    expect(payload.sample.runeEvidence.episodes).toEqual([
      expect.objectContaining({
        episodeId: "rune-episode:2:500",
        alertAttemptIds: ["2:1500:initial"],
      }),
    ]);
    expect(JSON.stringify(payload.sample.runeEvidence.alertTrigger)).not.toContain(
      "rawDataUrl",
    );
    expect(payload.rune.alertTrigger).toMatchObject({
      cycleId: "2:1500:initial",
      frameCount: 3,
      frames: [
        { sampledAt: 500 },
        { sampledAt: 1_000 },
        { sampledAt: 1_500 },
      ],
    });
    expect(JSON.stringify(payload.rune.alertTrigger)).not.toContain("rawDataUrl");
    expect(payload.rune.lastSnapshot).toMatchObject({
      sampledAt: 2_000,
      detectorVersion: CURRENT_RUNE_MODEL,
      hasRawPreview: true,
      hasMaskPreview: true,
      hasCandidatePreview: true,
    });
    expect(payload.rune).toMatchObject({
      confirmationPolicy: {
        version: "rune-confirmation-v3",
        mode: "all",
        requiredStableFrames: 4,
        requiredStableMilliseconds: 2_500,
      },
      lastDecisionReason: "initial-alert",
      lastAlertPlayback: {
        status: "finished",
        decision: "initial",
        cycleId: "2:1500:initial",
        requestedAt: 1_500,
        startedAt: 1_500,
        effectiveVolume: 0.8,
      },
      runtimeTrace: [
        {
          sampledAt: 1_500,
          detected: true,
          stableCount: 3,
          consecutiveMissCount: 0,
          scenePolicyVersion: "rune-scene-v1",
          sceneEpoch: 2,
          sceneChanged: true,
          sceneChangeScore: 0.31,
          firstDetectedAt: 500,
          stableDurationMs: 1_000,
          confirmationPolicyVersion: "rune-confirmation-v2",
          confirmationPolicyMode: "all",
          confirmationSatisfied: true,
          confirmationSatisfiedBy: "frames-and-duration",
          shouldAlert: true,
          reason: "initial-alert",
        },
      ],
    });
    expect(payload.sample.result.detectorVersion).toBe(CURRENT_RUNE_MODEL);
    expect(payload.rune.state.detectorVersion).toBe(CURRENT_RUNE_MODEL);

    const serialized = JSON.stringify(payload);
    expect(serialized.match(/data:image\/png;base64,trigger-1500/g)).toHaveLength(1);
    expect(serialized).not.toContain("rawPreviewImageData");
    expect(serialized).not.toContain("maskPreviewImageData");
    expect(serialized).not.toContain("candidatePreviewImageData");
  });

  it("recovers a retained false-positive trigger by its playback cycle after the journal expires", () => {
    const trigger = {
      schemaVersion: "rune-alert-trigger-v1" as const,
      cycleId: "2:1500:initial",
      episodeId: "rune-episode:2:500",
      decision: "initial" as const,
      triggeredAt: 1_500,
      detectorVersion: CURRENT_RUNE_MODEL,
      sceneEpoch: 2,
      frames: [
        createAlertTriggerFrame(500, 1, false),
        createAlertTriggerFrame(800, 2, false),
        createAlertTriggerFrame(1_200, 3, false),
        createAlertTriggerFrame(1_500, 4, true),
      ],
    };
    const retainedSnapshot = createRuneSnapshot({
      sampledAt: 105_000,
      candidateSampledAt: 1_500,
      candidateRawPreviewUrl: "data:image/png;base64,trigger-1500",
      lastAlertTrigger: trigger,
      evidenceArchive: {
        policy: "rune-recent-evidence-v1",
        retainedAt: 105_000,
        runtimeIncidents: [],
        alertTriggers: [trigger],
        mediaBudget: {
          policy: "rune-shared-media-v1",
          retainedFrameIds: [
            "frame:500",
            "frame:800",
            "frame:1200",
            "frame:1500",
          ],
          retainedChars: 500,
          omittedOversized: 0,
          omittedCapacity: 0,
        },
      },
    });

    const payload = buildRuneIssueReportPayload({
      submittedAt: new Date(106_000).toISOString(),
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: {
        userAgent: "vitest",
        viewport: { width: 1280, height: 720 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      snapshot: createRuneSnapshot({ sampledAt: 106_000 }),
      lastAlertSnapshot: retainedSnapshot,
      runeConfig,
      currentRegion: runeConfig.region,
      runeState,
      issue: {
        reason: "rune-false-positive",
        label: "다른 것을 룬으로 감지해요",
        scenario: "wrong-target",
        occurrence: "recent",
      },
      journalSelection: createRuneJournalSelection(105_000),
    });

    expect(payload.sample.runeEvidence.selection).toMatchObject({
      status: "unavailable",
      anchorKind: "attempt",
      selectedEventAt: 1_500,
      cycleIds: ["2:1500:initial"],
      degradationReason: "journal-expired-trigger-retained",
    });
    expect(payload.sample.runeEvidence.alertTrigger).toMatchObject({
      cycleId: "2:1500:initial",
      frames: [
        { frameId: "frame:500" },
        { frameId: "frame:800" },
        { frameId: "frame:1200" },
        { frameId: "frame:1500" },
      ],
    });
    expect(payload.sample.runeEvidence.runtimeFrames).toHaveLength(4);
    expect(payload.incident.evidence.source).toBe("runtime-snapshot");
  });

  it("keeps detector failures distinct from negative rune samples", () => {
    const detectionError = {
      code: "rune-detection-worker-runtime-failed",
      phase: "worker-runtime" as const,
      message: "Failed to load worker module",
      occurredAt: 2_000,
      retryCount: 1,
    };
    const errorState: RuneRuntimeState = {
      ...runeState,
      status: "unavailable",
      detectorVersion: null,
      stableCount: 0,
      candidateCount: 0,
      lastDecisionReason: "detector-error",
      lastDetectionError: detectionError,
      recentSamples: [
        {
          sampledAt: 2_000,
          detected: false,
          outcome: "error",
          confidence: 0,
          candidateCount: 0,
          candidate: null,
          status: "unavailable",
          stableCount: 0,
          shouldAlert: false,
          reason: "detector-error",
          error: detectionError,
        },
      ],
    };
    const payload = buildRuneIssueReportPayload({
      submittedAt: "2026-07-12T00:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: {
        userAgent: "vitest",
        viewport: { width: 1280, height: 720 },
        runtimeAssets: {
          status: "update-required",
          runningBuild: {
            name: "maple-timer",
            version: "0.1.0",
            commitSha: "old",
            shortCommit: "old",
            branch: "main",
            deploymentUrl: "https://maple-timer.com",
            buildTime: "2026-07-12T00:00:00.000Z",
            channel: "production",
            remoteRecognitionV1TestArm: false,
          },
          latestBuild: null,
          lastFailure: null,
          lastCheckedAt: null,
          lastCheckReason: "worker",
          lastCheckError: null,
        },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      snapshot: createRuneSnapshot({
        detectorVersion: null,
        detectionError,
        detected: false,
        confidence: 0,
        candidateCount: 0,
      }),
      runeConfig,
      currentRegion: runeConfig.region,
      runeState: errorState,
      issue: {
        reason: "rune-missed",
        label: "룬이 떴는데 감지가 안돼요",
      },
    });

    expect(payload.diagnostics.runtimeAssets).toMatchObject({ status: "update-required" });
    expect(payload.rune.runtimeTrace).toEqual([
      expect.objectContaining({
        outcome: "error",
        reason: "detector-error",
        error: expect.objectContaining({ phase: "worker-runtime", retryCount: 1 }),
      }),
    ]);
    expect(payload.rune.lastSnapshot).toMatchObject({
      detectionError: expect.objectContaining({ code: "rune-detection-worker-runtime-failed" }),
    });
  });

  it("keeps both selected alert attempts for a duplicate-alert report", () => {
    const firstTrigger = {
      schemaVersion: "rune-alert-trigger-v1" as const,
      cycleId: "2:1500:initial",
      episodeId: "rune-episode:2:500",
      decision: "initial" as const,
      triggeredAt: 1_500,
      detectorVersion: CURRENT_RUNE_MODEL,
      sceneEpoch: 2,
      frames: [
        createAlertTriggerFrame(500, 1, false),
        createAlertTriggerFrame(1_000, 2, false),
        createAlertTriggerFrame(1_500, 3, true),
      ],
    };
    const repeatTrigger = {
      schemaVersion: "rune-alert-trigger-v1" as const,
      cycleId: "2:6500:repeat",
      episodeId: "rune-episode:2:500",
      decision: "repeat" as const,
      triggeredAt: 6_500,
      detectorVersion: CURRENT_RUNE_MODEL,
      sceneEpoch: 2,
      frames: [
        createAlertTriggerFrame(4_500, 3, false),
        createAlertTriggerFrame(5_500, 3, false),
        createAlertTriggerFrame(6_500, 3, true),
      ],
    };
    const frozenSnapshot = createRuneSnapshot({
      sampledAt: 7_000,
      candidateSampledAt: 6_500,
      candidateRawPreviewUrl: "data:image/png;base64,trigger-6500",
      lastAlertTrigger: repeatTrigger,
      evidenceArchive: {
        policy: "rune-recent-evidence-v1",
        retainedAt: 7_000,
        runtimeIncidents: [],
        alertTriggers: [firstTrigger, repeatTrigger],
        mediaBudget: {
          policy: "rune-shared-media-v1",
          retainedFrameIds: [
            "frame:500",
            "frame:1000",
            "frame:1500",
            "frame:4500",
            "frame:5500",
            "frame:6500",
          ],
          retainedChars: 500,
          omittedOversized: 0,
          omittedCapacity: 0,
        },
      },
    });
    const journalSelection = createRuneJournalSelection(
      7_000,
      [500, 1_000, 1_500, 4_500, 5_500, 6_500],
      "rune-episode:2:500",
    );
    journalSelection.entries.push(
      {
        id: "rune:playback:initial",
        feature: "rune",
        targetId: null,
        kind: "playback",
        occurredAt: 1_500,
        frameId: "frame:1500",
        cycleId: "2:1500:initial",
        status: "finished",
        decision: "initial",
        value: null,
        configRevision: "cfg-rune",
        configuration: { enabled: true },
        details: { episodeId: "rune-episode:2:500" },
      },
      {
        id: "rune:playback:repeat",
        feature: "rune",
        targetId: null,
        kind: "playback",
        occurredAt: 6_500,
        frameId: "frame:6500",
        cycleId: "2:6500:repeat",
        status: "finished",
        decision: "repeat",
        value: null,
        configRevision: "cfg-rune",
        configuration: { enabled: true },
        details: { episodeId: "rune-episode:2:500" },
      },
    );

    const payload = buildRuneIssueReportPayload({
      submittedAt: new Date(7_000).toISOString(),
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: {
        userAgent: "vitest",
        viewport: { width: 1280, height: 720 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      snapshot: createRuneSnapshot({ sampledAt: 7_000 }),
      lastAlertSnapshot: frozenSnapshot,
      runeConfig,
      currentRegion: runeConfig.region,
      runeState,
      issue: {
        reason: "rune-false-positive",
        label: "알림이 중복으로 울려요",
        scenario: "duplicate-alert",
        occurrence: "recent",
      },
      journalSelection,
    });

    expect(payload.sample.runeEvidence.alertAttempts.map((entry) => entry.cycleId)).toEqual([
      "2:1500:initial",
      "2:6500:repeat",
    ]);
    expect(payload.sample.runeEvidence.alertAttempts[0]?.playbackEvents).toEqual([
      expect.objectContaining({ id: "rune:playback:initial", status: "finished" }),
    ]);
    expect(payload.sample.runeEvidence.episodes).toEqual([
      expect.objectContaining({
        episodeId: "rune-episode:2:500",
        alertAttemptIds: ["2:1500:initial", "2:6500:repeat"],
      }),
    ]);
    expect(payload.sample.runeEvidence.runtimeFrames).toHaveLength(6);
  });

  it("attaches bounded runtime frames to recent missed-rune reports", () => {
    const snapshot = createRuneSnapshot({
      sampledAt: 7_000,
      detected: true,
      runtimeIncident: {
        schemaVersion: "rune-runtime-incident-v1",
        id: "2:1000",
        episodeId: "rune-episode:2:2000",
        startedAt: 1_000,
        lastSignalAt: 4_000,
        updatedAt: 6_000,
        expiresAt: 66_000,
        detectorVersion: CURRENT_RUNE_MODEL,
        sceneEpoch: 2,
        frames: [
          createRuntimeIncidentFrame(1_000, "before", "not-detected"),
          createRuntimeIncidentFrame(2_000, "signal", "near-threshold"),
          createRuntimeIncidentFrame(3_000, "signal", "detected"),
          createRuntimeIncidentFrame(4_000, "signal", "detected"),
          createRuntimeIncidentFrame(5_000, "after", "not-detected"),
          createRuntimeIncidentFrame(6_000, "after", "not-detected"),
        ],
      },
    });

    const payload = buildRuneIssueReportPayload({
      submittedAt: "2026-07-19T00:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: { userAgent: "vitest", viewport: { width: 1280, height: 720 } },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      snapshot,
      lastAlertSnapshot: snapshot,
      runeConfig,
      currentRegion: runeConfig.region,
      runeState,
      issue: {
        reason: "rune-missed",
        label: "룬이 떴는데 감지가 안돼요",
        scenario: "recognized-no-alert",
        occurrence: "recent",
      },
      journalSelection: createRuneJournalSelection(
        7_000,
        [2_000, 3_000, 4_000],
        "rune-episode:2:2000",
      ),
    });

    expect(payload.incident.evidence).toMatchObject({
      source: "mixed",
      sampledAt: 4_000,
      stateBinding: "mixed",
    });
    expect(payload.sample.runeEvidence.runtimeIncident).toMatchObject({
      schemaVersion: "rune-runtime-incident-v1",
      id: "2:1000",
      frames: [
        { phase: "before", source: "runtime" },
        { phase: "signal", outcome: "near-threshold" },
        { phase: "signal", outcome: "detected" },
        { phase: "signal", outcome: "detected" },
        { phase: "after" },
        { phase: "after" },
      ],
    });
    expect(payload.sample.runeEvidence.episodes).toEqual([
      expect.objectContaining({
        episodeId: "rune-episode:2:2000",
        frameIds: [
          "frame:1000",
          "frame:2000",
          "frame:3000",
          "frame:4000",
          "frame:5000",
          "frame:6000",
        ],
      }),
    ]);
    expect(JSON.stringify(payload.sample.runeEvidence.runtimeIncident)).not.toContain(
      "rawDataUrl",
    );
    expect(payload.sample.runeEvidence.runtimeFrames).toHaveLength(6);
    expect(payload.sample.runeEvidence.runtimeFrames[0]).toMatchObject({
      frameId: "frame:1000",
      rawDataUrl: "data:image/png;base64,runtime-1000",
      roles: ["runtime-before"],
    });
    expect(payload.rune.runtimeIncident).toMatchObject({
      frameCount: 6,
      signalFrameCount: 3,
      lastSignalAt: 4_000,
    });
    expect(JSON.stringify(payload.rune.runtimeIncident)).not.toContain("rawDataUrl");
    expect(
      payload.incident.evidenceManifest.references.find((entry) => entry.id === "rune-source"),
    ).toMatchObject({
      produced: true,
      retained: true,
      retainedPaths: expect.arrayContaining(["sample.runeEvidence.runtimeFrames"]),
    });
  });

  it("binds a recent missed report to the retained near-threshold incident", () => {
    const sampledAts = Array.from({ length: 54 }, (_, index) => (index + 1) * 1_000);
    const retainedIncident = {
      schemaVersion: "rune-runtime-incident-v1" as const,
      id: "2:1000",
      episodeId: null,
      startedAt: 1_000,
      lastSignalAt: 3_000,
      updatedAt: 5_000,
      expiresAt: 65_000,
      detectorVersion: CURRENT_RUNE_MODEL,
      sceneEpoch: 2,
      frames: [
        createRuntimeIncidentFrame(1_000, "before", "not-detected"),
        createRuntimeIncidentFrame(2_000, "signal", "near-threshold"),
        createRuntimeIncidentFrame(3_000, "signal", "near-threshold"),
        createRuntimeIncidentFrame(4_000, "after", "not-detected"),
        createRuntimeIncidentFrame(5_000, "after", "not-detected"),
      ],
    };
    const frozenSnapshot = createRuneSnapshot({
      sampledAt: 54_000,
      detected: false,
      confidence: 0.1,
      candidateCount: 0,
      candidate: null,
      runtimeIncident: retainedIncident,
      evidenceArchive: {
        policy: "rune-recent-evidence-v1",
        retainedAt: 54_000,
        runtimeIncidents: [retainedIncident],
        alertTriggers: [],
        mediaBudget: {
          policy: "rune-shared-media-v1",
          retainedFrameIds: retainedIncident.frames.map(
            (frame) => `frame:${frame.sampledAt}`,
          ),
          retainedChars: 500,
          omittedOversized: 0,
          omittedCapacity: 0,
        },
      },
    });
    const reportFrame = createRuneSnapshot({
      sampledAt: 85_000,
      detected: false,
      confidence: 0.1,
      candidateCount: 0,
      candidate: null,
      rawPreviewUrl: "data:image/png;base64,later-report-frame",
    });

    const payload = buildRuneIssueReportPayload({
      submittedAt: new Date(85_000).toISOString(),
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: {
        userAgent: "vitest",
        viewport: { width: 1280, height: 720 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      snapshot: reportFrame,
      lastAlertSnapshot: frozenSnapshot,
      runeConfig,
      currentRegion: runeConfig.region,
      runeState,
      issue: {
        reason: "rune-missed",
        label: "룬이 떴는데 감지가 안돼요",
        scenario: "not-recognized",
        occurrence: "recent",
      },
      journalSelection: createRuneJournalSelection(
        54_000,
        sampledAts,
        null,
        false,
      ),
    });

    expect(payload.sample.runeEvidence.selection).toMatchObject({
      status: "matched",
      anchorKind: "frame",
      selectedEventAt: 3_000,
      candidateCount: 1,
      sampleCount: 54,
      ambiguous: false,
      frameIds: [
        "frame:1000",
        "frame:2000",
        "frame:3000",
        "frame:4000",
        "frame:5000",
      ],
    });
    expect(payload.sample.runeEvidence.runtimeFrames).toHaveLength(5);
    expect(payload.sample.runeEvidence.runtimeIncident).toMatchObject({
      id: "2:1000",
      lastSignalAt: 3_000,
    });
    expect(payload.sample.runeEvidence.reportFrame).toMatchObject({ sampledAt: 85_000 });
    const runtimeSource = payload.incident.evidenceManifest.references.find(
      (entry) => entry.id === "rune-source",
    );
    const reportContext = payload.incident.evidenceManifest.references.find(
      (entry) => entry.id === "rune-report-frame",
    );
    expect(runtimeSource).toMatchObject({
      capturedAt: 3_000,
      frameId: "frame:3000",
      retained: true,
      retainedPaths: ["sample.runeEvidence.runtimeFrames"],
    });
    expect(reportContext).toMatchObject({
      capturedAt: 85_000,
      frameId: "frame:85000",
      retained: true,
    });
    expect(payload.incident.completeness.sourceImage).toBe(true);
  });

  it("does not treat a later report frame as the missing runtime source", () => {
    const payload = buildRuneIssueReportPayload({
      submittedAt: new Date(60_000).toISOString(),
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: {
        userAgent: "vitest",
        viewport: { width: 1280, height: 720 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      snapshot: createRuneSnapshot({ sampledAt: 60_000, detected: false }),
      lastAlertSnapshot: createRuneSnapshot({
        sampledAt: 59_000,
        detected: false,
        runtimeIncident: null,
        evidenceArchive: null,
      }),
      runeConfig,
      currentRegion: runeConfig.region,
      runeState,
      issue: {
        reason: "rune-missed",
        label: "룬이 떴는데 감지가 안돼요",
        scenario: "not-recognized",
        occurrence: "recent",
      },
      journalSelection: createRuneJournalSelection(
        59_000,
        [58_000, 59_000],
        null,
        false,
      ),
    });

    expect(payload.sample.runeEvidence.selection).toMatchObject({
      status: "unavailable",
      candidateCount: 0,
      sampleCount: 2,
    });
    expect(payload.sample.runeEvidence.runtimeFrames).toEqual([]);
    expect(payload.incident.completeness.sourceImage).toBe(false);
    expect(
      payload.incident.evidenceManifest.references.find(
        (entry) => entry.id === "rune-source",
      ),
    ).toMatchObject({ retained: false, retainedPaths: [] });
    expect(
      payload.incident.evidenceManifest.references.find(
        (entry) => entry.id === "rune-report-frame",
      ),
    ).toMatchObject({ retained: true });
  });

  it("rejects runtime evidence captured after the report dialog opened", () => {
    const snapshot = createRuneSnapshot({
      sampledAt: 12_000,
      runtimeIncident: {
        schemaVersion: "rune-runtime-incident-v1",
        id: "3:11000",
        startedAt: 11_000,
        lastSignalAt: 12_000,
        updatedAt: 12_000,
        expiresAt: 72_000,
        detectorVersion: CURRENT_RUNE_MODEL,
        sceneEpoch: 3,
        frames: [createRuntimeIncidentFrame(12_000, "signal", "detected")],
      },
    });
    const payload = buildRuneIssueReportPayload({
      submittedAt: "2026-07-19T00:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: { userAgent: "vitest", viewport: { width: 1280, height: 720 } },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      snapshot,
      lastAlertSnapshot: snapshot,
      runeConfig,
      currentRegion: runeConfig.region,
      runeState,
      issue: {
        reason: "rune-missed",
        label: "룬이 떴는데 감지가 안돼요",
        occurrence: "recent",
      },
      journalSelection: createRuneJournalSelection(10_000),
    });

    expect(payload.sample.runeEvidence.runtimeIncident).toBeNull();
    expect(payload.rune.runtimeIncident).toBeNull();
    expect(payload.incident.evidence.source).toBe("report-capture");
  });

  it("does not attach a later episode or report-time frame to the selected miss", () => {
    const reportFrame = createRuneSnapshot({ sampledAt: 9_000, detected: true });
    const frozenSnapshot = createRuneSnapshot({
      sampledAt: 7_000,
      runtimeIncident: {
        schemaVersion: "rune-runtime-incident-v1",
        id: "3:6000",
        startedAt: 6_000,
        lastSignalAt: 6_000,
        updatedAt: 7_000,
        expiresAt: 67_000,
        detectorVersion: CURRENT_RUNE_MODEL,
        sceneEpoch: 3,
        frames: [createRuntimeIncidentFrame(6_000, "signal", "detected")],
      },
    });
    const journalSelection = createRuneJournalSelection(
      8_000,
      [1_000, 2_000, 3_000],
      "rune-episode:2:1000",
    );
    journalSelection.entries.push(
      ...createRuneJournalSelection(
        8_000,
        [6_000],
        "rune-episode:3:6000",
      ).entries,
      {
        id: "rune:playback:3:7000:initial",
        feature: "rune",
        targetId: null,
        kind: "playback",
        occurredAt: 7_000,
        frameId: "frame:6000",
        cycleId: "3:7000:initial",
        status: "finished",
        decision: "initial",
        value: null,
        configRevision: "cfg-rune",
        configuration: { enabled: true },
        details: { episodeId: "rune-episode:3:6000" },
      },
    );

    const payload = buildRuneIssueReportPayload({
      submittedAt: new Date(10_000).toISOString(),
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: {
        userAgent: "vitest",
        viewport: { width: 1280, height: 720 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      snapshot: reportFrame,
      lastAlertSnapshot: frozenSnapshot,
      runeConfig,
      currentRegion: runeConfig.region,
      runeState,
      issue: {
        reason: "rune-missed",
        label: "룬이 떴는데 감지가 안돼요",
        scenario: "recognized-no-alert",
        occurrence: "recent",
      },
      journalSelection,
    });

    expect(payload.sample.runeEvidence.selection).toMatchObject({
      policy: "rune-scenario-incident-v2",
      anchorKind: "episode",
      episodeIds: ["rune-episode:2:1000"],
      frameIds: ["frame:1000", "frame:2000", "frame:3000"],
    });
    expect(payload.incident.journal.entries.map((entry) => entry.id)).toEqual([
      "rune:sample:1000",
      "rune:sample:2000",
      "rune:sample:3000",
    ]);
    expect(payload.sample.runeEvidence.runtimeIncident).toBeNull();
    expect(payload.sample.runeEvidence.reportFrame).toMatchObject({ sampledAt: 9_000 });
  });

  it("recovers the selected older episode from the frozen recent archive", () => {
    const olderIncident = {
      schemaVersion: "rune-runtime-incident-v1" as const,
      id: "2:1000",
      episodeId: "rune-episode:2:1000",
      startedAt: 1_000,
      lastSignalAt: 3_000,
      updatedAt: 3_000,
      expiresAt: 63_000,
      detectorVersion: CURRENT_RUNE_MODEL,
      sceneEpoch: 2,
      frames: [
        createRuntimeIncidentFrame(1_000, "signal", "detected"),
        createRuntimeIncidentFrame(2_000, "signal", "detected"),
        createRuntimeIncidentFrame(3_000, "signal", "detected"),
      ],
    };
    const laterIncident = {
      schemaVersion: "rune-runtime-incident-v1" as const,
      id: "3:6000",
      episodeId: "rune-episode:3:6000",
      startedAt: 6_000,
      lastSignalAt: 6_000,
      updatedAt: 6_000,
      expiresAt: 66_000,
      detectorVersion: CURRENT_RUNE_MODEL,
      sceneEpoch: 3,
      frames: [
        {
          ...createRuntimeIncidentFrame(6_000, "signal", "detected"),
          sceneEpoch: 3,
          firstDetectedAt: 6_000,
          rawDataUrl: "data:image/png;base64,later-episode",
        },
      ],
    };
    const frozenSnapshot = createRuneSnapshot({
      sampledAt: 7_000,
      runtimeIncident: laterIncident,
      evidenceArchive: {
        policy: "rune-recent-evidence-v1",
        retainedAt: 7_000,
        runtimeIncidents: [olderIncident, laterIncident],
        alertTriggers: [],
        mediaBudget: {
          policy: "rune-shared-media-v1",
          retainedFrameIds: [
            "frame:1000",
            "frame:2000",
            "frame:3000",
            "frame:6000",
          ],
          retainedChars: 200,
          omittedOversized: 0,
          omittedCapacity: 0,
        },
      },
    });
    const payload = buildRuneIssueReportPayload({
      submittedAt: new Date(8_000).toISOString(),
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: {
        userAgent: "vitest",
        viewport: { width: 1280, height: 720 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      snapshot: createRuneSnapshot({ sampledAt: 8_000 }),
      lastAlertSnapshot: frozenSnapshot,
      runeConfig,
      currentRegion: runeConfig.region,
      runeState,
      issue: {
        reason: "rune-missed",
        label: "룬이 떴는데 감지가 안돼요",
        scenario: "recognized-no-alert",
        occurrence: "recent",
      },
      journalSelection: createRuneJournalSelection(
        7_500,
        [1_000, 2_000, 3_000],
        "rune-episode:2:1000",
      ),
    });

    expect(payload.sample.runeEvidence.runtimeIncidents).toHaveLength(1);
    expect(payload.sample.runeEvidence.runtimeIncident).toMatchObject({
      id: "2:1000",
      episodeId: "rune-episode:2:1000",
    });
    expect(payload.sample.runeEvidence.runtimeFrames.map((frame) => frame.frameId)).toEqual([
      "frame:1000",
      "frame:2000",
      "frame:3000",
    ]);
    expect(JSON.stringify(payload)).not.toContain("later-episode");
  });

  it("does not replace an explicitly frozen empty snapshot with later evidence", () => {
    const snapshot = createRuneSnapshot({
      sampledAt: 8_000,
      runtimeIncident: {
        schemaVersion: "rune-runtime-incident-v1",
        id: "2:7000",
        startedAt: 7_000,
        lastSignalAt: 8_000,
        updatedAt: 8_000,
        expiresAt: 68_000,
        detectorVersion: CURRENT_RUNE_MODEL,
        sceneEpoch: 2,
        frames: [createRuntimeIncidentFrame(8_000, "signal", "detected")],
      },
    });
    const payload = buildRuneIssueReportPayload({
      submittedAt: "2026-07-19T00:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: { userAgent: "vitest", viewport: { width: 1280, height: 720 } },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      snapshot,
      lastAlertSnapshot: null,
      runeConfig,
      currentRegion: runeConfig.region,
      runeState,
      issue: {
        reason: "rune-missed",
        label: "룬이 떴는데 감지가 안돼요",
        occurrence: "recent",
      },
      journalSelection: createRuneJournalSelection(8_000),
    });

    expect(payload.sample.runeEvidence.runtimeIncident).toBeNull();
    expect(payload.rune.runtimeIncident).toBeNull();
  });

  it("rejects stale runtime evidence when no journal selection is available", () => {
    const snapshot = createRuneSnapshot({
      sampledAt: 30_000,
      runtimeIncident: {
        schemaVersion: "rune-runtime-incident-v1",
        id: "2:29000",
        startedAt: 29_000,
        lastSignalAt: 30_000,
        updatedAt: 30_000,
        expiresAt: 90_000,
        detectorVersion: CURRENT_RUNE_MODEL,
        sceneEpoch: 2,
        frames: [createRuntimeIncidentFrame(30_000, "signal", "detected")],
      },
    });
    const payload = buildRuneIssueReportPayload({
      submittedAt: new Date(100_001).toISOString(),
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: { userAgent: "vitest", viewport: { width: 1280, height: 720 } },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      snapshot,
      lastAlertSnapshot: snapshot,
      runeConfig,
      currentRegion: runeConfig.region,
      runeState,
      issue: {
        reason: "rune-missed",
        label: "룬이 떴는데 감지가 안돼요",
        occurrence: "recent",
      },
    });

    expect(payload.sample.runeEvidence.runtimeIncident).toBeNull();
    expect(payload.rune.runtimeIncident).toBeNull();
  });

  it("uses the shorter journal window for reports about the current screen", () => {
    const snapshot = createRuneSnapshot({
      sampledAt: 80_000,
      runtimeIncident: {
        schemaVersion: "rune-runtime-incident-v1",
        id: "2:79000",
        startedAt: 79_000,
        lastSignalAt: 80_000,
        updatedAt: 80_000,
        expiresAt: 140_000,
        detectorVersion: CURRENT_RUNE_MODEL,
        sceneEpoch: 2,
        frames: [createRuntimeIncidentFrame(80_000, "signal", "detected")],
      },
    });
    const payload = buildRuneIssueReportPayload({
      submittedAt: new Date(100_000).toISOString(),
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: { userAgent: "vitest", viewport: { width: 1280, height: 720 } },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      snapshot,
      lastAlertSnapshot: snapshot,
      runeConfig,
      currentRegion: runeConfig.region,
      runeState,
      issue: {
        reason: "rune-missed",
        label: "룬이 떴는데 감지가 안돼요",
        occurrence: "current",
      },
      journalSelection: createRuneJournalSelection(100_000),
    });

    expect(payload.sample.runeEvidence.runtimeIncident).toBeNull();
    expect(payload.rune.runtimeIncident).toBeNull();
  });

  it("does not bind the latest runtime image window to a historical report", () => {
    const snapshot = createRuneSnapshot({
      runtimeIncident: {
        schemaVersion: "rune-runtime-incident-v1",
        id: "2:1000",
        startedAt: 1_000,
        lastSignalAt: 2_000,
        updatedAt: 2_000,
        expiresAt: 62_000,
        detectorVersion: CURRENT_RUNE_MODEL,
        sceneEpoch: 2,
        frames: [createRuntimeIncidentFrame(2_000, "signal", "detected")],
      },
    });
    const payload = buildRuneIssueReportPayload({
      submittedAt: "2026-07-19T00:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: { userAgent: "vitest", viewport: { width: 1280, height: 720 } },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      snapshot,
      lastAlertSnapshot: snapshot,
      runeConfig,
      currentRegion: runeConfig.region,
      runeState,
      issue: {
        reason: "rune-missed",
        label: "룬이 떴는데 감지가 안돼요",
        occurrence: "historical",
      },
    });

    expect(payload.incident.evidence.source).toBe("report-capture");
    expect(payload.sample.runeEvidence.runtimeIncident).toBeNull();
    expect(payload.rune.runtimeIncident).toBeNull();
  });
});

function createAlertTriggerFrame(
  sampledAt: number,
  stableCount: number,
  shouldAlert: boolean,
): NonNullable<RuneSnapshot["lastAlertTrigger"]>["frames"][number] {
  return {
    sampledAt,
    detectorVersion: CURRENT_RUNE_MODEL,
    detectionDebug: {
      detectorKind: "onnx-full-frame",
      classifier: CURRENT_RUNE_MODEL,
      modelScore: 0.9,
      modelThreshold: RUNE_ONNX_THRESHOLD,
      inferenceMs: 3.5,
      reason: null,
    },
    rawDataUrl: `data:image/png;base64,trigger-${sampledAt}`,
    detected: true,
    confidence: 0.9,
    candidateCount: 1,
    candidate: {
      x: 20,
      y: 30,
      width: 12,
      height: 12,
      confidence: 0.9,
      source: "onnx-full-frame",
    },
    status: shouldAlert ? "alerted" : "candidate",
    stableCount,
    firstDetectedAt: 500,
    stableDurationMs: sampledAt - 500,
    confirmationSatisfied: shouldAlert,
    confirmationSatisfiedBy: shouldAlert ? "frames-and-duration" : null,
    shouldAlert,
    reason: shouldAlert ? "initial-alert" : "stabilizing",
    sceneEpoch: 2,
  };
}

function createRuntimeIncidentFrame(
  sampledAt: number,
  phase: "before" | "signal" | "after",
  outcome: "detected" | "near-threshold" | "not-detected" | "error",
): NonNullable<RuneSnapshot["runtimeIncident"]>["frames"][number] {
  const detected = outcome === "detected";
  return {
    source: "runtime",
    phase,
    outcome,
    sampledAt,
    detectorVersion: CURRENT_RUNE_MODEL,
    detectionDebug: {
      detectorKind: "onnx-full-frame",
      classifier: CURRENT_RUNE_MODEL,
      modelScore: detected ? 0.9 : outcome === "near-threshold" ? 0.5 : 0.1,
      modelThreshold: RUNE_ONNX_THRESHOLD,
      inferenceMs: 3.5,
      reason: detected ? null : "score-below-threshold",
    },
    detectionError: null,
    rawDataUrl: `data:image/png;base64,runtime-${sampledAt}`,
    detected,
    confidence: detected ? 0.9 : outcome === "near-threshold" ? 0.5 : 0.1,
    candidateCount: detected ? 1 : 0,
    candidate: {
      x: 20,
      y: 30,
      width: 12,
      height: 12,
      confidence: detected ? 0.9 : 0.5,
      source: "onnx-full-frame",
    },
    status: detected ? "candidate" : "waiting",
    stableCount: detected ? 1 : 0,
    firstDetectedAt: detected ? sampledAt : null,
    stableDurationMs: 0,
    confirmationSatisfied: false,
    confirmationSatisfiedBy: null,
    shouldAlert: false,
    reason: detected ? "stabilizing" : "waiting",
    sceneEpoch: 2,
    sceneChanged: false,
    sceneChangeScore: 0.01,
  };
}

function createRuneJournalSelection(
  capturedAt: number,
  sampledAts: number[] = [],
  episodeId: string | null = null,
  detected = true,
): AlertIncidentJournalSelection {
  return {
    capturedAt,
    windowStartedAt: capturedAt - 60_000,
    windowEndedAt: capturedAt,
    target: { feature: "rune", targetId: null },
    entries: sampledAts.map((sampledAt) => ({
      id: `rune:sample:${sampledAt}`,
      feature: "rune",
      targetId: null,
      kind: "sample",
      occurredAt: sampledAt,
      frameId: `frame:${sampledAt}`,
      cycleId: null,
      status: detected ? "candidate" : "waiting",
      decision: detected ? "stabilizing" : "waiting",
      value: detected,
      configRevision: "cfg-rune",
      configuration: { enabled: true },
      details: { episodeId },
    })),
  };
}
