import { describe, expect, it } from "vitest";
import { createBoosterExpiryIncidentBoundary } from "./boosterExpiryIncidentBoundary";
import {
  BOOSTER_EXPIRY_INCIDENT_CURRENT_WINDOW_MS,
  BOOSTER_EXPIRY_INCIDENT_MAX_CONFIGURATION_REVISIONS,
  BOOSTER_EXPIRY_INCIDENT_MAX_FLOW_EPOCHS,
  BOOSTER_EXPIRY_INCIDENT_MAX_FRAMES,
  BOOSTER_EXPIRY_INCIDENT_MAX_LIFECYCLE_EVENTS,
  BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_FRAME_CHARS,
  BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_FRAMES,
  BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
  BOOSTER_EXPIRY_INCIDENT_METADATA_MAX_CHARS,
  BOOSTER_EXPIRY_INCIDENT_REPORT_REQUEST_TARGET_BYTES,
  BOOSTER_EXPIRY_INCIDENT_RETENTION_MS,
  compactBoosterExpiryIncidentEvidenceArchive,
  createBoosterExpiryIncidentEvidenceArchive,
  getBoosterExpiryIncidentEvidenceMetadataChars,
  getBoosterExpiryIncidentEvidenceRequestBytes,
  getBoosterExpiryIncidentEvidenceSupport,
  updateBoosterExpiryIncidentEvidenceArchive,
} from "./boosterExpiryIncidentEvidenceArchive";
import {
  createBoosterExpiryIncidentAlertDecisionId,
  createBoosterExpiryIncidentCandidateAttemptId,
  createBoosterExpiryIncidentConfigurationRevisionId,
  createBoosterExpiryIncidentCycleId,
  createBoosterExpiryIncidentFlowEpochId,
  createBoosterExpiryIncidentFrameId,
  createBoosterExpiryIncidentObservationId,
  createBoosterExpiryIncidentPlaybackAttemptId,
  createBoosterExpiryIncidentResetEpochId,
  createBoosterExpiryIncidentScheduleId,
  type BoosterExpiryIncidentAlertDecision,
  type BoosterExpiryIncidentCandidateAttempt,
  type BoosterExpiryIncidentConfigurationRevision,
  type BoosterExpiryIncidentConfirmedCycle,
  type BoosterExpiryIncidentEvidencePointers,
  type BoosterExpiryIncidentFlowEpoch,
  type BoosterExpiryIncidentFrame,
  type BoosterExpiryIncidentLifecycleEvent,
  type BoosterExpiryIncidentMediaFrame,
  type BoosterExpiryIncidentObservation,
  type BoosterExpiryIncidentPlaybackAttempt,
  type BoosterExpiryIncidentResetEpoch,
  type BoosterExpiryIncidentSchedule,
} from "./boosterExpiryIncidentEvidenceTypes";

describe("booster expiry incident evidence archive", () => {
  it("synchronizes current boundary identities without changing live behavior", () => {
    const boundary = createBoosterExpiryIncidentBoundary({
      sessionId: "boundary-session",
      now: 10,
      continuity: {
        captureGeneration: 1,
        featureGeneration: 1,
        monitoringGeneration: 1,
        layoutKey: "layout",
        sourceGeometryRevision: "1920x1080",
      },
      configuration: {
        enabled: true,
        alertLeadSeconds: 5,
        soundId: "sound",
        featureVolume: 1,
        masterVolume: 1,
        effectiveVolume: 1,
      },
      workerGeneration: 1,
    });
    const archive = updateBoosterExpiryIncidentEvidenceArchive({
      previous: null,
      now: 10,
      patch: { boundaryState: boundary },
    });

    expect(archive.pointers).toMatchObject({
      currentResetEpochId: boundary.resetEpoch.id,
      currentConfigurationRevisionId: boundary.configurationRevision.id,
      currentFlowEpochId: boundary.flowEpoch.id,
    });
    expect(archive.resetEpochs).toEqual([boundary.resetEpoch]);
    expect(archive.configurationRevisions).toEqual([
      boundary.configurationRevision,
    ]);
    expect(archive.flowEpochs).toEqual([boundary.flowEpoch]);
  });

  it("classifies exact current and recent support boundaries", () => {
    const now = 100_000;
    expect(
      getBoosterExpiryIncidentEvidenceSupport({
        now,
        occurredAt: now - BOOSTER_EXPIRY_INCIDENT_CURRENT_WINDOW_MS,
      }),
    ).toBe("current");
    expect(
      getBoosterExpiryIncidentEvidenceSupport({
        now,
        occurredAt: now - BOOSTER_EXPIRY_INCIDENT_CURRENT_WINDOW_MS - 1,
      }),
    ).toBe("recent");
    expect(
      getBoosterExpiryIncidentEvidenceSupport({
        now,
        occurredAt: now - BOOSTER_EXPIRY_INCIDENT_RETENTION_MS,
      }),
    ).toBe("recent");
    expect(
      getBoosterExpiryIncidentEvidenceSupport({
        now,
        occurredAt: now - BOOSTER_EXPIRY_INCIDENT_RETENTION_MS - 1,
      }),
    ).toBe("unsupported");
    expect(
      getBoosterExpiryIncidentEvidenceSupport({ now, occurredAt: now + 1 }),
    ).toBe("unsupported");
  });

  it("retains ordinary evidence for exactly 60 seconds without pinning a stale latest frame", () => {
    const fixture = createFixture(0);
    const frame = createFrame(fixture, 1, 1_000);
    const observation = createObservation(frame, 300);
    const initial = updateBoosterExpiryIncidentEvidenceArchive({
      previous: null,
      now: 1_000,
      patch: createFramePatch(fixture, frame, observation),
    });

    const atBoundary = compactBoosterExpiryIncidentEvidenceArchive({
      archive: initial,
      now: 61_000,
    });
    expect(atBoundary.frames.map((entry) => entry.id)).toEqual([frame.id]);
    expect(atBoundary.observations.map((entry) => entry.id)).toEqual([
      observation.id,
    ]);

    const expired = compactBoosterExpiryIncidentEvidenceArchive({
      archive: atBoundary,
      now: 61_001,
    });
    expect(expired.frames).toEqual([]);
    expect(expired.observations).toEqual([]);
    expect(expired.pointers.latestFrameId).toBeNull();
    expect(expired.omissions).toContainEqual(
      expect.objectContaining({ kind: "frame", reason: "outside-retention" }),
    );
  });

  it("protects all six active candidate anchors when ordinary frame pressure reaches the cap", () => {
    const fixture = createFixture(0);
    const frames = Array.from(
      { length: BOOSTER_EXPIRY_INCIDENT_MAX_FRAMES + 1 },
      (_, index) => createFrame(fixture, index + 1, index + 1),
    );
    const observations = frames.map((frame, index) =>
      createObservation(frame, 300 - index),
    );
    const candidate = createCandidate(
      fixture,
      observations.slice(0, 6),
      "collecting",
    );
    const archive = updateBoosterExpiryIncidentEvidenceArchive({
      previous: null,
      now: frames[frames.length - 1]!.sampledAt,
      patch: {
        pointers: {
          ...createPointers(fixture),
          latestFrameId: frames[frames.length - 1]!.id,
          latestObservationId: observations[observations.length - 1]!.id,
          activeCandidateAttemptId: candidate.id,
        },
        resetEpochs: [fixture.reset],
        configurationRevisions: [fixture.configuration],
        flowEpochs: [fixture.flow],
        frames,
        observations,
        candidateAttempts: [candidate],
      },
    });

    expect(archive.frames).toHaveLength(BOOSTER_EXPIRY_INCIDENT_MAX_FRAMES);
    expect(
      candidate.observationIds.every((observationId) => {
        const observation = observations.find((entry) => entry.id === observationId);
        return (
          observation !== undefined &&
          archive.frames.some((entry) => entry.id === observation.frameId)
        );
      }),
    ).toBe(true);
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({ kind: "frame", reason: "metadata-cap" }),
    );
  });

  it("protects a long active cycle through a negative-lead alert and the 60-second incident tail", () => {
    const chain = createActiveChain({ alertLeadSeconds: -5 });
    const deadline =
      chain.cycle.expiresAt +
      5_000 +
      BOOSTER_EXPIRY_INCIDENT_RETENTION_MS;
    const archive = createChainArchive(chain, chain.lastFrame.sampledAt);

    const atBoundary = compactBoosterExpiryIncidentEvidenceArchive({
      archive,
      now: deadline,
    });
    expect(atBoundary.cycles.map((entry) => entry.id)).toEqual([
      chain.cycle.id,
    ]);
    expect(atBoundary.candidateAttempts.map((entry) => entry.id)).toEqual([
      chain.candidate.id,
    ]);
    expect(atBoundary.observations).toHaveLength(6);
    expect(atBoundary.frames).toHaveLength(6);
    expect(atBoundary.schedules.map((entry) => entry.id)).toEqual([
      chain.schedule.id,
    ]);

    const expired = compactBoosterExpiryIncidentEvidenceArchive({
      archive: atBoundary,
      now: deadline + 1,
    });
    expect(expired.cycles).toEqual([]);
    expect(expired.candidateAttempts).toEqual([]);
    expect(expired.observations).toEqual([]);
    expect(expired.schedules).toEqual([]);
  });

  it("expires a terminal cycle chain one millisecond after its 60-second tail", () => {
    const chain = createActiveChain({ alertLeadSeconds: 5 });
    const endedAt = 10_000;
    const cycle: BoosterExpiryIncidentConfirmedCycle = {
      ...chain.cycle,
      status: "cancelled",
      endedAt,
      terminalReason: "contradicted",
    };
    const schedule: BoosterExpiryIncidentSchedule = {
      ...chain.schedule,
      status: "cancelled",
      endedAt,
      outcomeReason: "contradicted",
    };
    const archive = createChainArchive(
      {
        ...chain,
        cycle,
        schedule,
        pointers: {
          ...chain.pointers,
          activeCycleId: null,
          activeScheduleId: null,
        },
      },
      endedAt,
    );

    const atBoundary = compactBoosterExpiryIncidentEvidenceArchive({
      archive,
      now: endedAt + BOOSTER_EXPIRY_INCIDENT_RETENTION_MS,
    });
    expect(atBoundary.cycles).toHaveLength(1);
    expect(atBoundary.frames).toHaveLength(6);

    const expired = compactBoosterExpiryIncidentEvidenceArchive({
      archive: atBoundary,
      now: endedAt + BOOSTER_EXPIRY_INCIDENT_RETENTION_MS + 1,
    });
    expect(expired.cycles).toEqual([]);
    expect(expired.frames).toEqual([]);
  });

  it("keeps an older fired schedule and playback through a later cycle terminal tail", () => {
    const chain = createActiveChain({ alertLeadSeconds: -5 });
    const decisionAt = chain.schedule.alertDueAt;
    const decision: BoosterExpiryIncidentAlertDecision = {
      id: createBoosterExpiryIncidentAlertDecisionId(chain.cycle.id, 1),
      resetEpochId: chain.fixture.reset.id,
      cycleId: chain.cycle.id,
      scheduleId: chain.schedule.id,
      sequence: 1,
      occurredAt: decisionAt,
      dueAt: decisionAt,
      schedulerDelayMs: 0,
      timingConfigRevisionId: chain.fixture.configuration.id,
      firedConfigRevisionId: chain.fixture.configuration.id,
    };
    const playback: BoosterExpiryIncidentPlaybackAttempt = {
      id: createBoosterExpiryIncidentPlaybackAttemptId(chain.cycle.id, 1),
      resetEpochId: chain.fixture.reset.id,
      cycleId: chain.cycle.id,
      scheduleId: chain.schedule.id,
      decisionId: decision.id,
      sequence: 1,
      requestedAt: decisionAt + 1,
      browserAcceptedAt: decisionAt + 2,
      finishedAt: decisionAt + 500,
      failedAt: null,
      status: "finished",
      error: null,
      configRevisionId: chain.fixture.configuration.id,
      soundId: "sound",
      featureVolume: 1,
      masterVolume: 1,
      effectiveVolume: 1,
    };
    const terminalAt = decisionAt + 90_000;
    const terminal = createChainArchive(
      {
        ...chain,
        cycle: {
          ...chain.cycle,
          status: "terminal",
          endedAt: terminalAt,
          terminalReason: "reset-epoch",
        },
        schedule: {
          ...chain.schedule,
          status: "fired",
          endedAt: decisionAt,
        },
        decisions: [decision],
        playbackAttempts: [playback],
        pointers: {
          ...chain.pointers,
          activeCycleId: null,
          activeScheduleId: null,
          activeDecisionId: null,
          activePlaybackAttemptId: null,
        },
      },
      terminalAt,
    );

    const retained = compactBoosterExpiryIncidentEvidenceArchive({
      archive: terminal,
      now: terminalAt + BOOSTER_EXPIRY_INCIDENT_RETENTION_MS,
    });
    expect(retained.cycles).toHaveLength(1);
    expect(retained.schedules).toHaveLength(1);
    expect(retained.decisions).toEqual([decision]);
    expect(retained.playbackAttempts).toEqual([playback]);
    expect(retained.frames).toHaveLength(6);
  });

  it("retains schedule, decision, and browser playback as one immutable chain", () => {
    const chain = createActiveChain({ alertLeadSeconds: 5 });
    const occurredAt = chain.schedule.alertDueAt + 250;
    const decision: BoosterExpiryIncidentAlertDecision = {
      id: createBoosterExpiryIncidentAlertDecisionId(chain.cycle.id, 1),
      resetEpochId: chain.fixture.reset.id,
      cycleId: chain.cycle.id,
      scheduleId: chain.schedule.id,
      sequence: 1,
      occurredAt,
      dueAt: chain.schedule.alertDueAt,
      schedulerDelayMs: 250,
      timingConfigRevisionId: chain.fixture.configuration.id,
      firedConfigRevisionId: chain.fixture.configuration.id,
    };
    const schedule: BoosterExpiryIncidentSchedule = {
      ...chain.schedule,
      status: "fired",
      endedAt: occurredAt,
    };
    const playback: BoosterExpiryIncidentPlaybackAttempt = {
      id: createBoosterExpiryIncidentPlaybackAttemptId(chain.cycle.id, 1),
      resetEpochId: chain.fixture.reset.id,
      cycleId: chain.cycle.id,
      scheduleId: schedule.id,
      decisionId: decision.id,
      sequence: 1,
      requestedAt: occurredAt + 1,
      browserAcceptedAt: occurredAt + 2,
      finishedAt: occurredAt + 500,
      failedAt: null,
      status: "finished",
      error: null,
      configRevisionId: chain.fixture.configuration.id,
      soundId: "sound",
      featureVolume: 1,
      masterVolume: 1,
      effectiveVolume: 1,
    };
    const archive = createChainArchive(
      {
        ...chain,
        cycle: { ...chain.cycle, status: "alerted" },
        schedule,
        decisions: [decision],
        playbackAttempts: [playback],
        pointers: {
          ...chain.pointers,
          activeScheduleId: schedule.id,
          activeDecisionId: decision.id,
          activePlaybackAttemptId: playback.id,
        },
      },
      playback.finishedAt!,
    );

    expect(archive.schedules).toEqual([schedule]);
    expect(archive.decisions).toEqual([decision]);
    expect(archive.playbackAttempts).toEqual([playback]);
  });

  it("bounds rapid reset, configuration, and Worker-flow changes without cross-epoch records", () => {
    const fixtures = Array.from({ length: 12 }, (_, index) =>
      createFixture(index + 1, index + 1),
    );
    const current = fixtures[fixtures.length - 1]!;
    const frames = fixtures.map((fixture, index) =>
      createFrame(fixture, index + 1, fixture.reset.startedAt),
    );
    const archive = updateBoosterExpiryIncidentEvidenceArchive({
      previous: null,
      now: current.reset.startedAt,
      patch: {
        pointers: {
          ...createPointers(current),
          latestFrameId: frames[frames.length - 1]!.id,
        },
        resetEpochs: fixtures.map((entry) => entry.reset),
        configurationRevisions: fixtures.map((entry) => entry.configuration),
        flowEpochs: fixtures.map((entry) => entry.flow),
        frames,
      },
    });

    expect(archive.resetEpochs).toHaveLength(8);
    expect(archive.configurationRevisions).toHaveLength(8);
    expect(archive.flowEpochs).toHaveLength(8);
    expect(archive.frames).toHaveLength(8);
    const retainedResetIds = new Set(
      archive.resetEpochs.map((entry) => entry.id),
    );
    expect(
      archive.frames.every((entry) => retainedResetIds.has(entry.resetEpochId)),
    ).toBe(true);
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({ kind: "frame", reason: "reset-epoch" }),
    );
  });

  it("enforces independent configuration and Worker-flow caps", () => {
    const fixture = createFixture(0);
    const configurations = Array.from(
      { length: BOOSTER_EXPIRY_INCIDENT_MAX_CONFIGURATION_REVISIONS + 1 },
      (_, index) => createConfiguration(fixture.reset, index + 1, index + 1),
    );
    const flows = Array.from(
      { length: BOOSTER_EXPIRY_INCIDENT_MAX_FLOW_EPOCHS + 1 },
      (_, index) => createFlow(fixture.reset, index + 1, index + 1),
    );
    const archive = updateBoosterExpiryIncidentEvidenceArchive({
      previous: null,
      now: configurations[configurations.length - 1]!.capturedAt,
      patch: {
        pointers: {
          ...createPointers(fixture),
          currentConfigurationRevisionId:
            configurations[configurations.length - 1]!.id,
          currentFlowEpochId: flows[flows.length - 1]!.id,
        },
        resetEpochs: [fixture.reset],
        configurationRevisions: configurations,
        flowEpochs: flows,
      },
    });

    expect(archive.configurationRevisions).toHaveLength(
      BOOSTER_EXPIRY_INCIDENT_MAX_CONFIGURATION_REVISIONS,
    );
    expect(archive.flowEpochs).toHaveLength(
      BOOSTER_EXPIRY_INCIDENT_MAX_FLOW_EPOCHS,
    );
    expect(archive.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "configuration",
          reason: "metadata-cap",
        }),
        expect.objectContaining({
          kind: "flow-epoch",
          reason: "metadata-cap",
        }),
      ]),
    );
  });

  it("deduplicates one frame while promoting its most decisive media reason", () => {
    const fixture = createFixture(0);
    const frame = createFrame(fixture, 1, 1_000);
    let archive = updateBoosterExpiryIncidentEvidenceArchive({
      previous: null,
      now: 1_000,
      patch: {
        ...createFramePatch(fixture, frame, null),
        media: [createMedia(frame, "current", 1_000, "current-media")],
      },
    });
    archive = updateBoosterExpiryIncidentEvidenceArchive({
      previous: archive,
      now: 1_001,
      patch: {
        media: [
          createMedia(frame, "alert-decision", 2_000, "decision-media"),
        ],
      },
    });

    expect(archive.media).toHaveLength(1);
    expect(archive.media[0]).toMatchObject({
      id: "current-media",
      frameId: frame.id,
      reason: "alert-decision",
    });
    expect(archive.media[0]?.imageDataUrl).toHaveLength(2_000);
  });

  it("rejects an oversized image without dropping compact frame metadata", () => {
    const fixture = createFixture(0);
    const frame = createFrame(fixture, 1, 1_000);
    const archive = updateBoosterExpiryIncidentEvidenceArchive({
      previous: null,
      now: 1_000,
      patch: {
        ...createFramePatch(fixture, frame, null),
        media: [
          createMedia(
            frame,
            "cycle-confirmation",
            BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_FRAME_CHARS + 1,
          ),
        ],
      },
    });

    expect(archive.frames).toHaveLength(1);
    expect(archive.media).toEqual([]);
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({ kind: "media", reason: "media-oversize" }),
    );
  });

  it("keeps decisive media before periodic context under the aggregate budget", () => {
    const fixture = createFixture(0);
    const frames = [
      createFrame(fixture, 1, 1_000),
      createFrame(fixture, 2, 2_000),
      createFrame(fixture, 3, 3_000),
    ];
    const archive = updateBoosterExpiryIncidentEvidenceArchive({
      previous: null,
      now: 3_000,
      patch: {
        pointers: createPointers(fixture),
        resetEpochs: [fixture.reset],
        configurationRevisions: [fixture.configuration],
        flowEpochs: [fixture.flow],
        frames,
        media: [
          createMedia(frames[0]!, "periodic", 550_000),
          createMedia(frames[1]!, "cycle-confirmation", 550_000),
          createMedia(frames[2]!, "alert-decision", 550_000),
        ],
      },
    });

    expect(archive.media.map((entry) => entry.reason).sort()).toEqual([
      "alert-decision",
      "cycle-confirmation",
    ]);
    expect(archive.media).toHaveLength(2);
    expect(archive.media.length).toBeLessThanOrEqual(
      BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_FRAMES,
    );
    expect(
      archive.media.reduce(
        (total, entry) => total + entry.imageDataUrl.length,
        0,
      ),
    ).toBeLessThanOrEqual(BOOSTER_EXPIRY_INCIDENT_MEDIA_MAX_TOTAL_CHARS);
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({ kind: "media", reason: "media-budget" }),
    );
  });

  it("truncates lifecycle details and enforces the aggregate metadata cap", () => {
    const fixture = createFixture(0);
    const detailArchive = updateBoosterExpiryIncidentEvidenceArchive({
      previous: null,
      now: 1,
      patch: {
        pointers: createPointers(fixture),
        resetEpochs: [fixture.reset],
        configurationRevisions: [fixture.configuration],
        flowEpochs: [fixture.flow],
        lifecycleEvents: [createEvent(fixture, 0, "y".repeat(4_000))],
      },
    });
    expect(detailArchive.lifecycleEvents[0]?.details).toMatchObject({
      omitted: "metadata-cap",
    });

    const frames = Array.from({ length: BOOSTER_EXPIRY_INCIDENT_MAX_FRAMES }, (_, index) => ({
      ...createFrame(fixture, index + 1, index + 1),
      layoutKey: "x".repeat(4_000),
    }));
    const events = Array.from(
      { length: BOOSTER_EXPIRY_INCIDENT_MAX_LIFECYCLE_EVENTS + 1 },
      (_, index) => createEvent(fixture, index, "y".repeat(4_000)),
    );
    const archive = updateBoosterExpiryIncidentEvidenceArchive({
      previous: null,
      now: events[events.length - 1]!.occurredAt,
      patch: {
        pointers: createPointers(fixture),
        resetEpochs: [fixture.reset],
        configurationRevisions: [fixture.configuration],
        flowEpochs: [fixture.flow],
        frames,
        lifecycleEvents: events,
      },
    });

    expect(archive.lifecycleEvents.length).toBeLessThanOrEqual(
      BOOSTER_EXPIRY_INCIDENT_MAX_LIFECYCLE_EVENTS,
    );
    expect(getBoosterExpiryIncidentEvidenceMetadataChars(archive)).toBeLessThanOrEqual(
      BOOSTER_EXPIRY_INCIDENT_METADATA_MAX_CHARS,
    );
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({ reason: "metadata-cap" }),
    );
  });

  it("keeps the worst supported media mix below the report request target", () => {
    const fixture = createFixture(0);
    const frames = [
      createFrame(fixture, 1, 1_000),
      createFrame(fixture, 2, 2_000),
    ];
    const archive = updateBoosterExpiryIncidentEvidenceArchive({
      previous: null,
      now: 2_000,
      patch: {
        pointers: createPointers(fixture),
        resetEpochs: [fixture.reset],
        configurationRevisions: [fixture.configuration],
        flowEpochs: [fixture.flow],
        frames,
        media: [
          createMedia(frames[0]!, "cycle-confirmation", 850_000),
          createMedia(frames[1]!, "alert-decision", 300_000),
        ],
      },
    });

    expect(getBoosterExpiryIncidentEvidenceRequestBytes(archive)).toBeLessThan(
      BOOSTER_EXPIRY_INCIDENT_REPORT_REQUEST_TARGET_BYTES,
    );
  });
});

type Fixture = {
  reset: BoosterExpiryIncidentResetEpoch;
  configuration: BoosterExpiryIncidentConfigurationRevision;
  flow: BoosterExpiryIncidentFlowEpoch;
};

function createFixture(startedAt: number, sequence = 1): Fixture {
  const resetId = createBoosterExpiryIncidentResetEpochId("session", sequence);
  const reset: BoosterExpiryIncidentResetEpoch = {
    id: resetId,
    sessionId: "session",
    sequence,
    startedAt,
    reason: sequence === 1 ? "initialized" : "stream-replaced",
    continuity: {
      captureGeneration: sequence,
      featureGeneration: 1,
      monitoringGeneration: 1,
      layoutKey: `layout-${sequence}`,
      sourceGeometryRevision: "1920x1080",
    },
  };
  return {
    reset,
    configuration: createConfiguration(reset, sequence, startedAt),
    flow: createFlow(reset, sequence, startedAt),
  };
}

function createConfiguration(
  reset: BoosterExpiryIncidentResetEpoch,
  sequence: number,
  capturedAt: number,
  alertLeadSeconds = 5,
): BoosterExpiryIncidentConfigurationRevision {
  return {
    id: createBoosterExpiryIncidentConfigurationRevisionId(reset.id, sequence),
    resetEpochId: reset.id,
    sequence,
    capturedAt,
    fingerprint: `config-${sequence}-${alertLeadSeconds}`,
    timingFingerprint: `timing-${sequence}-${alertLeadSeconds}`,
    playbackFingerprint: `playback-${sequence}`,
    values: {
      enabled: true,
      alertLeadSeconds,
      soundId: "sound",
      featureVolume: 1,
      masterVolume: 1,
      effectiveVolume: 1,
    },
  };
}

function createFlow(
  reset: BoosterExpiryIncidentResetEpoch,
  sequence: number,
  startedAt: number,
): BoosterExpiryIncidentFlowEpoch {
  return {
    id: createBoosterExpiryIncidentFlowEpochId(reset.id, sequence),
    resetEpochId: reset.id,
    sequence,
    workerGeneration: sequence,
    startedAt,
    reason: sequence === 1 ? "initialized" : "worker-reset",
  };
}

function createFrame(
  fixture: Fixture,
  sequence: number,
  sampledAt: number,
): BoosterExpiryIncidentFrame {
  return {
    id: createBoosterExpiryIncidentFrameId(fixture.reset.id, sequence),
    resetEpochId: fixture.reset.id,
    flowEpochId: fixture.flow.id,
    configRevisionId: fixture.configuration.id,
    sequence,
    sampledAt,
    layoutKey: fixture.reset.continuity.layoutKey,
    sourceGeometryRevision:
      fixture.reset.continuity.sourceGeometryRevision,
    source: null,
    runtimeFailure: null,
    mediaFrameId: null,
  };
}

function createObservation(
  frame: BoosterExpiryIncidentFrame,
  remainingSeconds: number,
  decision: BoosterExpiryIncidentObservation["decision"] = "accepted",
): BoosterExpiryIncidentObservation {
  const observedExpiresAt = frame.sampledAt + remainingSeconds * 1_000;
  return {
    id: createBoosterExpiryIncidentObservationId(frame.id),
    resetEpochId: frame.resetEpochId,
    flowEpochId: frame.flowEpochId,
    frameId: frame.id,
    frameSequence: frame.sequence,
    configRevisionId: frame.configRevisionId,
    sampledAt: frame.sampledAt,
    decision,
    reason: decision === "accepted" ? null : "not-timer",
    recognizerVersion: "booster-v1",
    rawTime: {
      ok: decision === "accepted",
      reason: decision === "accepted" ? "accepted" : "not-timer",
      text: String(remainingSeconds),
      seconds: decision === "accepted" ? remainingSeconds : null,
      format: "seconds",
      selectedBy: "center",
      rect: { x: 1, y: 1, width: 10, height: 10 },
      digitCount: 3,
    },
    selectedTime: null,
    timerRect: { x: 1, y: 1, width: 10, height: 10 },
    timerCandidateCount: 1,
    timerMatchCount: decision === "accepted" ? 1 : 0,
    flow: {
      locked: true,
      source: "raw-lock",
      predictedSeconds: remainingSeconds,
      rawDeltaSeconds: -1,
    },
    strongForConfirmation: decision === "accepted",
    observedExpiresAt: decision === "accepted" ? observedExpiresAt : null,
    recognitionMs: 3,
    totalMs: 4,
    stateBefore: null,
    stateAfter: null,
  };
}

function createCandidate(
  fixture: Fixture,
  observations: BoosterExpiryIncidentObservation[],
  status: BoosterExpiryIncidentCandidateAttempt["status"],
): BoosterExpiryIncidentCandidateAttempt {
  const first = observations[0]!;
  const last = observations[observations.length - 1]!;
  const expires = observations.map((entry) => entry.observedExpiresAt!);
  return {
    id: createBoosterExpiryIncidentCandidateAttemptId(fixture.reset.id, 1),
    resetEpochId: fixture.reset.id,
    flowEpochId: fixture.flow.id,
    sequence: 1,
    startedAt: first.sampledAt,
    lastObservedAt: last.sampledAt,
    observationIds: observations.map((entry) => entry.id),
    firstRemainingSeconds: first.rawTime!.seconds!,
    lastRemainingSeconds: last.rawTime!.seconds!,
    expiresAt: Math.round(
      expires.reduce((total, value) => total + value, 0) / expires.length,
    ),
    expiresAtMin: Math.min(...expires),
    expiresAtMax: Math.max(...expires),
    status,
    confirmedCycleId: null,
    endedAt: status === "collecting" ? null : last.sampledAt,
    terminalReason: status === "confirmed" ? "confirmed" : null,
  };
}

function createActiveChain({ alertLeadSeconds }: { alertLeadSeconds: number }) {
  const base = createFixture(0);
  const configuration = createConfiguration(
    base.reset,
    1,
    0,
    alertLeadSeconds,
  );
  const fixture = { ...base, configuration };
  const frames = Array.from({ length: 6 }, (_, index) =>
    createFrame(fixture, index + 1, (index + 1) * 1_000),
  );
  const observations = frames.map((frame, index) =>
    createObservation(frame, 300 - index),
  );
  const cycleId = createBoosterExpiryIncidentCycleId(fixture.reset.id, 1);
  const candidate = {
    ...createCandidate(fixture, observations, "confirmed"),
    confirmedCycleId: cycleId,
  };
  const cycle: BoosterExpiryIncidentConfirmedCycle = {
    id: cycleId,
    resetEpochId: fixture.reset.id,
    sequence: 1,
    candidateAttemptId: candidate.id,
    confirmationFlowEpochId: fixture.flow.id,
    observationIds: observations.map((entry) => entry.id),
    confirmedAt: frames[frames.length - 1]!.sampledAt,
    expiresAt: candidate.expiresAt,
    timingConfigRevisionId: configuration.id,
    lastSupportedAt: frames[frames.length - 1]!.sampledAt,
    contradictionCount: 0,
    status: "active",
    endedAt: null,
    terminalReason: null,
  };
  const schedule: BoosterExpiryIncidentSchedule = {
    id: createBoosterExpiryIncidentScheduleId(cycle.id, 1),
    resetEpochId: fixture.reset.id,
    cycleId: cycle.id,
    sequence: 1,
    reason: "cycle-confirmed",
    registeredAt: cycle.confirmedAt,
    alertDueAt: cycle.expiresAt - alertLeadSeconds * 1_000,
    confirmedExpiresAt: cycle.expiresAt,
    timingConfigRevisionId: configuration.id,
    status: "registered",
    endedAt: null,
    outcomeReason: null,
  };
  const pointers: BoosterExpiryIncidentEvidencePointers = {
    ...createPointers(fixture),
    latestFrameId: frames[frames.length - 1]!.id,
    latestObservationId: observations[observations.length - 1]!.id,
    activeCandidateAttemptId: null,
    activeCycleId: cycle.id,
    activeScheduleId: schedule.id,
    activeDecisionId: null,
    activePlaybackAttemptId: null,
  };
  return {
    fixture,
    frames,
    observations,
    lastFrame: frames[frames.length - 1]!,
    candidate,
    cycle,
    schedule,
    decisions: [] as BoosterExpiryIncidentAlertDecision[],
    playbackAttempts: [] as BoosterExpiryIncidentPlaybackAttempt[],
    pointers,
  };
}

function createChainArchive(
  chain: ReturnType<typeof createActiveChain>,
  now: number,
) {
  return updateBoosterExpiryIncidentEvidenceArchive({
    previous: null,
    now,
    patch: {
      pointers: chain.pointers,
      resetEpochs: [chain.fixture.reset],
      configurationRevisions: [chain.fixture.configuration],
      flowEpochs: [chain.fixture.flow],
      frames: chain.frames,
      observations: chain.observations,
      candidateAttempts: [chain.candidate],
      cycles: [chain.cycle],
      schedules: [chain.schedule],
      decisions: chain.decisions,
      playbackAttempts: chain.playbackAttempts,
    },
  });
}

function createPointers(fixture: Fixture) {
  return {
    currentResetEpochId: fixture.reset.id,
    currentConfigurationRevisionId: fixture.configuration.id,
    currentFlowEpochId: fixture.flow.id,
    latestFrameId: null,
    latestObservationId: null,
    activeCandidateAttemptId: null,
    activeCycleId: null,
    activeScheduleId: null,
    activeDecisionId: null,
    activePlaybackAttemptId: null,
  };
}

function createFramePatch(
  fixture: Fixture,
  frame: BoosterExpiryIncidentFrame,
  observation: BoosterExpiryIncidentObservation | null,
) {
  return {
    pointers: {
      ...createPointers(fixture),
      latestFrameId: frame.id,
      latestObservationId: observation?.id ?? null,
    },
    resetEpochs: [fixture.reset],
    configurationRevisions: [fixture.configuration],
    flowEpochs: [fixture.flow],
    frames: [frame],
    observations: observation ? [observation] : [],
  };
}

function createMedia(
  frame: BoosterExpiryIncidentFrame,
  reason: BoosterExpiryIncidentMediaFrame["reason"],
  chars: number,
  id = `media:${frame.id}`,
): BoosterExpiryIncidentMediaFrame {
  return {
    id,
    frameId: frame.id,
    resetEpochId: frame.resetEpochId,
    sampledAt: frame.sampledAt,
    reason,
    imageDataUrl: "x".repeat(chars),
  };
}

function createEvent(
  fixture: Fixture,
  index: number,
  detail: string,
): BoosterExpiryIncidentLifecycleEvent {
  return {
    id: `event-${index}`,
    resetEpochId: fixture.reset.id,
    occurredAt: index + 1,
    category: "recognition",
    action: "sampled",
    configRevisionId: fixture.configuration.id,
    flowEpochId: fixture.flow.id,
    frameId: null,
    observationId: null,
    candidateAttemptId: null,
    cycleId: null,
    scheduleId: null,
    decisionId: null,
    playbackAttemptId: null,
    details: { detail },
  };
}
