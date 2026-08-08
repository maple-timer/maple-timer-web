import { describe, expect, it } from "vitest";
import type { HuntStallReportIncidentSelection } from "./huntStallIncidentEvidenceSelection";
import { createHuntStallIncidentReportEvidence } from "./huntStallIncidentReportEvidence";
import {
  HUNT_STALL_INCIDENT_EVIDENCE_SCHEMA_VERSION,
  type FrozenHuntStallIncidentEvidence,
  type HuntStallIncidentConfiguration,
  type HuntStallIncidentFrame,
  type HuntStallIncidentMediaFrame,
} from "./huntStallIncidentEvidenceTypes";

describe("createHuntStallIncidentReportEvidence", () => {
  it("projects only the selected ID-linked incident chain", () => {
    const evidence = createFrozenEvidence();
    const selection = createSelection({
      resetEpochId: "reset:1",
      attemptIds: ["attempt:1"],
      mediaFrameIds: ["frame:1"],
      relatedPlaybackIds: ["related:1"],
    });

    const report = createHuntStallIncidentReportEvidence({
      evidence,
      selection,
    });

    expect(report.resetEpochs.map((entry) => entry.id)).toEqual(["reset:1"]);
    expect(report.configurations.map((entry) => entry.id)).toEqual(["config:1"]);
    expect(report.frames.map((entry) => entry.id)).toEqual(["frame:1"]);
    expect(report.observations.map((entry) => entry.id)).toEqual(["observation:1"]);
    expect(report.activityEpochs.map((entry) => entry.id)).toEqual(["activity:1"]);
    expect(report.stallEpisodes.map((entry) => entry.id)).toEqual(["episode:1"]);
    expect(report.alertCycles.map((entry) => entry.id)).toEqual(["cycle:1"]);
    expect(report.decisions.map((entry) => entry.id)).toEqual(["decision:1"]);
    expect(report.playbackAttempts.map((entry) => entry.id)).toEqual(["attempt:1"]);
    expect(report.lifecycle.map((entry) => entry.id)).toEqual(["event:1"]);
    expect(report.media.map((entry) => entry.frameId)).toEqual(["frame:1"]);
    expect(report.relatedPlayback.map((entry) => entry.id)).toEqual(["related:1"]);
    expect(report.omissions.map((entry) => entry.id)).toEqual(["omission:1"]);
    expect(report.reportFrame).toBeNull();
  });

  it("compacts selected media and marks the report as partial", () => {
    const base = createFrozenEvidence();
    const frames = Array.from({ length: 10 }, (_, index) =>
      createFrame(index + 10, `frame:media:${index}`),
    );
    const media = frames.map((frame, index) =>
      createMedia(frame, index === 0 ? "playback-failed" : "current"),
    );
    const evidence: FrozenHuntStallIncidentEvidence = {
      ...base,
      frames: [...base.frames, ...frames],
      media: [...base.media, ...media],
    };
    const selection = createSelection({
      resetEpochId: "reset:1",
      frameIds: frames.map((entry) => entry.id),
      mediaFrameIds: frames.map((entry) => entry.id),
    });

    const report = createHuntStallIncidentReportEvidence({
      evidence,
      selection,
    });

    expect(report.media).toHaveLength(8);
    expect(report.media.some((entry) => entry.reason === "playback-failed")).toBe(true);
    expect(report.selection.support).toBe("partial");
    expect(report.selection.degradationReasons).toContain("payload-compacted");
    expect(report.budget.droppedMediaFrameIds).toHaveLength(2);
    expect(report.omissions).toContainEqual(
      expect.objectContaining({
        reason: "payload-compacted",
        count: 2,
      }),
    );
  });

  it("does not merge a newer report-open reset into an older selected incident", () => {
    const base = createFrozenEvidence();
    const evidence: FrozenHuntStallIncidentEvidence = {
      ...base,
      lease: {
        ...base.lease,
        resetEpochId: "reset:2",
        configRevisionId: "config:2",
        regionRevision: "region:2",
        activityEpochId: "activity:2",
        stallEpisodeId: "episode:2",
        alertCycleId: null,
        playbackAttemptId: null,
      },
      frozenState: {
        ...base.frozenState!,
        resetEpochId: "reset:2",
        configRevisionId: "config:2",
        latestFrameId: "frame:2",
        latestObservationId: "observation:2",
        activityEpochId: "activity:2",
        stallEpisodeId: "episode:2",
        alertCycleId: null,
        playbackAttemptId: null,
      },
    };

    const report = createHuntStallIncidentReportEvidence({
      evidence,
      selection: createSelection({
        resetEpochId: "reset:1",
        frameIds: ["frame:1"],
        observationIds: ["observation:1"],
        mediaFrameIds: ["frame:1"],
      }),
    });

    expect(report.resetEpochs.map((entry) => entry.id)).toEqual(["reset:1"]);
    expect(report.configurations.map((entry) => entry.id)).toEqual(["config:1"]);
    expect(report.frames.map((entry) => entry.id)).toEqual(["frame:1"]);
  });
});

function createFrozenEvidence(): FrozenHuntStallIncidentEvidence {
  const configuration = createConfiguration();
  const selectedFrame = createFrame(1, "frame:1");
  const adjacentFrame = {
    ...createFrame(2, "frame:2"),
    resetEpochId: "reset:2",
    configRevisionId: "config:2",
  };
  return {
    schemaVersion: HUNT_STALL_INCIDENT_EVIDENCE_SCHEMA_VERSION,
    updatedAt: 20_000,
    currentResetEpochId: "reset:1",
    currentConfigurationRevisionId: "config:1",
    resetEpochs: [
      {
        id: "reset:1",
        sessionId: "session",
        sequence: 1,
        startedAt: 1_000,
        reason: "initialized",
        continuity: {
          captureGeneration: 1,
          featureGeneration: 1,
          workerGeneration: 1,
          mode: "manual-experience",
          layoutKey: "1920x1080",
          regionRevision: "region:1",
        },
      },
      {
        id: "reset:2",
        sessionId: "session",
        sequence: 2,
        startedAt: 9_000,
        reason: "region-changed",
        continuity: {
          captureGeneration: 1,
          featureGeneration: 2,
          workerGeneration: 1,
          mode: "manual-experience",
          layoutKey: "1920x1080",
          regionRevision: "region:2",
        },
      },
    ],
    configurationRevisions: [
      {
        id: "config:1",
        resetEpochId: "reset:1",
        sequence: 1,
        capturedAt: 1_000,
        fingerprint: "config-fingerprint:1",
        values: configuration,
      },
      {
        id: "config:2",
        resetEpochId: "reset:2",
        sequence: 1,
        capturedAt: 9_000,
        fingerprint: "config-fingerprint:2",
        values: configuration,
      },
    ],
    frames: [selectedFrame, adjacentFrame],
    observations: [
      {
        id: "observation:1",
        resetEpochId: "reset:1",
        frameId: "frame:1",
        frameSequence: 1,
        sampledAt: 8_000,
        mode: "manual-experience",
      },
      {
        id: "observation:2",
        resetEpochId: "reset:2",
        frameId: "frame:2",
        frameSequence: 2,
        sampledAt: 9_000,
        mode: "manual-experience",
      },
    ],
    activityEpochs: [
      {
        id: "activity:1",
        resetEpochId: "reset:1",
        sequence: 1,
        mode: "manual-experience",
        startedAt: 8_000,
        anchorFrameId: "frame:1",
        anchorFrameSequence: 1,
        anchorObservationId: "observation:1",
        reason: "manual-progress-confirmed",
        endedAt: null,
        terminalReason: null,
      },
      {
        id: "activity:2",
        resetEpochId: "reset:2",
        sequence: 2,
        mode: "manual-experience",
        startedAt: 9_000,
        anchorFrameId: "frame:2",
        anchorFrameSequence: 2,
        anchorObservationId: "observation:2",
        reason: "manual-progress-confirmed",
        endedAt: null,
        terminalReason: null,
      },
    ],
    stallEpisodes: [
      {
        id: "episode:1",
        resetEpochId: "reset:1",
        activityEpochId: "activity:1",
        sequence: 1,
        mode: "manual-experience",
        startedAt: 8_000,
        status: "alerted",
        alertCycleId: "cycle:1",
        endedAt: null,
        terminalReason: null,
      },
      {
        id: "episode:2",
        resetEpochId: "reset:2",
        activityEpochId: "activity:2",
        sequence: 2,
        mode: "manual-experience",
        startedAt: 9_000,
        status: "active",
        alertCycleId: null,
        endedAt: null,
        terminalReason: null,
      },
    ],
    alertCycles: [
      {
        id: "cycle:1",
        resetEpochId: "reset:1",
        activityEpochId: "activity:1",
        stallEpisodeId: "episode:1",
        sequence: 1,
        mode: "manual-experience",
        startedAt: 8_000,
        initialDecisionId: "decision:1",
        status: "active",
        endedAt: null,
        terminalReason: null,
      },
    ],
    decisions: [
      {
        id: "decision:1",
        resetEpochId: "reset:1",
        activityEpochId: "activity:1",
        stallEpisodeId: "episode:1",
        cycleId: "cycle:1",
        sequence: 1,
        kind: "initial",
        occurredAt: 8_000,
        frameId: "frame:1",
        observationId: "observation:1",
        configRevisionId: "config:1",
      },
    ],
    playbackAttempts: [
      {
        id: "attempt:1",
        resetEpochId: "reset:1",
        activityEpochId: "activity:1",
        stallEpisodeId: "episode:1",
        cycleId: "cycle:1",
        decisionId: "decision:1",
        sequence: 1,
        requestedAt: 8_010,
        startedAt: 8_020,
        finishedAt: 8_300,
        failedAt: null,
        status: "finished",
        error: null,
        configRevisionId: "config:1",
        soundId: "sound",
        featureVolume: 0.8,
        masterVolume: 0.7,
        effectiveVolume: 0.56,
      },
    ],
    lifecycleEvents: [
      {
        id: "event:1",
        resetEpochId: "reset:1",
        occurredAt: 8_020,
        category: "playback",
        action: "playback-started",
        frameId: "frame:1",
        observationId: "observation:1",
        activityEpochId: "activity:1",
        stallEpisodeId: "episode:1",
        cycleId: "cycle:1",
        attemptId: "attempt:1",
        configRevisionId: "config:1",
        details: {},
      },
      {
        id: "event:2",
        resetEpochId: "reset:2",
        occurredAt: 9_010,
        category: "recognition",
        action: "adjacent-event",
        frameId: "frame:2",
        observationId: "observation:2",
        activityEpochId: "activity:2",
        stallEpisodeId: "episode:2",
        cycleId: null,
        attemptId: null,
        configRevisionId: "config:2",
        details: {},
      },
    ],
    media: [
      createMedia(selectedFrame, "alert-decision"),
      createMedia(adjacentFrame, "current"),
    ],
    omissions: [
      {
        id: "omission:1",
        occurredAt: 8_000,
        kind: "frame",
        reason: "metadata-cap",
        subjectIds: ["frame:1"],
        count: 1,
      },
      {
        id: "omission:2",
        occurredAt: 9_000,
        kind: "frame",
        reason: "outside-retention",
        subjectIds: ["frame:2"],
        count: 1,
      },
    ],
    frozenAt: 10_000,
    leaseId: "lease:1",
    lease: {
      id: "lease:1",
      resetEpochId: "reset:1",
      configRevisionId: "config:1",
      sequence: 1,
      frozenAt: 10_000,
      leasedThroughFrameSequence: 10,
      mode: "manual-experience",
      layoutKey: "1920x1080",
      regionRevision: "region:1",
      activityEpochId: "activity:1",
      stallEpisodeId: "episode:1",
      alertCycleId: "cycle:1",
      playbackAttemptId: "attempt:1",
    },
    frozenState: {
      capturedAt: 10_000,
      resetEpochId: "reset:1",
      configRevisionId: "config:1",
      mode: "manual-experience",
      enabled: true,
      status: "alerted",
      decision: "threshold-reached",
      presentationRevision: "presentation:1",
      latestFrameId: "frame:1",
      latestObservationId: "observation:1",
      activityEpochId: "activity:1",
      stallEpisodeId: "episode:1",
      alertCycleId: "cycle:1",
      playbackAttemptId: "attempt:1",
    },
    relatedPlayback: [
      {
        id: "related:1",
        feature: "skill",
        requestedAt: 8_050,
        startedAt: 8_060,
        finishedAt: 8_500,
        failedAt: null,
        status: "finished",
      },
      {
        id: "related:2",
        feature: "rune",
        requestedAt: 9_050,
        startedAt: 9_060,
        finishedAt: null,
        failedAt: null,
        status: "started",
      },
    ],
  };
}

function createConfiguration(): HuntStallIncidentConfiguration {
  return {
    enabled: true,
    mode: "manual-experience",
    thresholdSeconds: 5,
    repeatAlertEnabled: true,
    repeatAlertIntervalSeconds: 10,
    repeatAlertMaxCount: 2,
    soundId: "sound",
    featureVolume: 0.8,
    masterVolume: 0.7,
    effectiveVolume: 0.56,
  };
}

function createFrame(sequence: number, id: string): HuntStallIncidentFrame {
  return {
    id,
    resetEpochId: "reset:1",
    configRevisionId: "config:1",
    sequence,
    sampledAt: 7_000 + sequence,
    mode: "manual-experience",
    layoutKey: "1920x1080",
    regionRevision: "region:1",
    source: "runtime",
  };
}

function createMedia(
  frame: HuntStallIncidentFrame,
  reason: HuntStallIncidentMediaFrame["reason"],
): HuntStallIncidentMediaFrame {
  return {
    id: `media:${frame.id}`,
    frameId: frame.id,
    resetEpochId: frame.resetEpochId,
    sampledAt: frame.sampledAt,
    reason,
    rawDataUrl: `data:image/png;base64,raw-${frame.id}`,
    processedDataUrl: `data:image/png;base64,processed-${frame.id}`,
  };
}

function createSelection(
  overrides: Partial<HuntStallReportIncidentSelection> = {},
): HuntStallReportIncidentSelection {
  return {
    policy: "hunt-stall-scenario-selection-v1",
    status: "matched",
    support: "definitive",
    anchorKind: "attempt",
    selectedEventAt: 8_010,
    mode: "manual-experience",
    resetEpochId: null,
    candidateIds: ["candidate:1"],
    frameIds: [],
    observationIds: [],
    activityEpochIds: [],
    stallEpisodeIds: [],
    cycleIds: [],
    decisionIds: [],
    attemptIds: [],
    eventIds: [],
    configurationRevisionIds: [],
    mediaFrameIds: [],
    relatedPlaybackIds: [],
    ambiguous: false,
    operatorConclusion: "playback-presentation-consistent",
    physicalAudibility: "unknown",
    externalPlayerActivity: "unknown",
    degradationReasons: [],
    ...overrides,
  };
}
