import { describe, expect, it } from "vitest";
import {
  HUNT_STALL_INCIDENT_MAX_FRAMES,
  HUNT_STALL_INCIDENT_MAX_RESET_EPOCHS,
  HUNT_STALL_INCIDENT_MEDIA_MAX_FRAME_CHARS,
  HUNT_STALL_INCIDENT_MEDIA_MAX_FRAMES,
  HUNT_STALL_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
  HUNT_STALL_INCIDENT_METADATA_MAX_CHARS,
  HUNT_STALL_INCIDENT_RETENTION_MS,
  compactHuntStallIncidentEvidenceArchive,
  createHuntStallIncidentEvidenceArchive,
  getHuntStallIncidentEvidenceMetadataChars,
  updateHuntStallIncidentEvidenceArchive,
} from "./huntStallIncidentEvidenceArchive";
import type {
  HuntStallIncidentActivityEpoch,
  HuntStallIncidentAlertCycle,
  HuntStallIncidentAlertDecision,
  HuntStallIncidentConfigurationRevision,
  HuntStallIncidentFrame,
  HuntStallIncidentLifecycleEvent,
  HuntStallIncidentMediaFrame,
  HuntStallIncidentObservation,
  HuntStallIncidentPlaybackAttempt,
  HuntStallIncidentResetEpoch,
  HuntStallIncidentStallEpisode,
} from "./huntStallIncidentEvidenceTypes";
import {
  createHuntStallIncidentActivityEpochId,
  createHuntStallIncidentAlertCycleId,
  createHuntStallIncidentAlertDecisionId,
  createHuntStallIncidentConfigurationRevisionId,
  createHuntStallIncidentFrameId,
  createHuntStallIncidentObservationId,
  createHuntStallIncidentPlaybackAttemptId,
  createHuntStallIncidentResetEpochId,
  createHuntStallIncidentStallEpisodeId,
} from "./huntStallIncidentEvidenceTypes";

describe("hunt stall incident evidence archive", () => {
  it("uses an inclusive sixty-second boundary and records expired evidence", () => {
    const now = 100_000;
    const reset = createReset();
    const config = createConfig(reset);
    const inside = createFrame(reset, config, 1, now - HUNT_STALL_INCIDENT_RETENTION_MS);
    const outside = createFrame(
      reset,
      config,
      2,
      now - HUNT_STALL_INCIDENT_RETENTION_MS - 1,
    );
    const insideObservation = createObservation(inside);
    const outsideObservation = createObservation(outside);

    const archive = updateHuntStallIncidentEvidenceArchive({
      previous: null,
      now,
      patch: {
        currentResetEpochId: reset.id,
        currentConfigurationRevisionId: config.id,
        resetEpochs: [reset],
        configurationRevisions: [config],
        frames: [inside, outside],
        observations: [insideObservation, outsideObservation],
      },
    });

    expect(archive.frames.map((entry) => entry.id)).toEqual([inside.id]);
    expect(archive.observations.map((entry) => entry.id)).toEqual([
      insideObservation.id,
    ]);
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({
        kind: "frame",
        reason: "outside-retention",
        subjectIds: [outside.id],
      }),
    );
  });

  it("retains an active episode anchor past the longest threshold and expires it after termination", () => {
    const now = 200_000;
    const reset = createReset();
    const config = createConfig(reset);
    const anchorFrame = createFrame(reset, config, 1, 1_000);
    const anchorObservation = createObservation(anchorFrame);
    const activity = createActivity(reset, anchorFrame, anchorObservation, 1_000);
    const episode = createEpisode(reset, activity, 1_000, "active");
    const media = createMedia(anchorFrame, "activity-anchor", 20_000);
    const active = updateHuntStallIncidentEvidenceArchive({
      previous: null,
      now,
      patch: {
        currentResetEpochId: reset.id,
        currentConfigurationRevisionId: config.id,
        resetEpochs: [reset],
        configurationRevisions: [config],
        frames: [anchorFrame],
        observations: [anchorObservation],
        activityEpochs: [activity],
        stallEpisodes: [episode],
        media: [media],
      },
    });

    expect(active.frames.map((entry) => entry.id)).toEqual([anchorFrame.id]);
    expect(active.activityEpochs.map((entry) => entry.id)).toEqual([
      activity.id,
    ]);
    expect(active.stallEpisodes.map((entry) => entry.id)).toEqual([episode.id]);
    expect(active.media.map((entry) => entry.id)).toEqual([media.id]);

    const endedAt = now;
    const terminal = updateHuntStallIncidentEvidenceArchive({
      previous: active,
      now,
      patch: {
        activityEpochs: [
          { ...activity, endedAt, terminalReason: "activity-accepted" },
        ],
        stallEpisodes: [
          {
            ...episode,
            status: "terminal",
            endedAt,
            terminalReason: "activity-accepted",
          },
        ],
      },
    });

    expect(
      compactHuntStallIncidentEvidenceArchive({
        archive: terminal,
        now: endedAt + HUNT_STALL_INCIDENT_RETENTION_MS,
      }).stallEpisodes,
    ).toHaveLength(1);
    expect(
      compactHuntStallIncidentEvidenceArchive({
        archive: terminal,
        now: endedAt + HUNT_STALL_INCIDENT_RETENTION_MS + 1,
      }).stallEpisodes,
    ).toHaveLength(0);
  });

  it("keeps the initial decision and the latest attempt for an old active repeat cycle", () => {
    const now = 200_000;
    const chain = createActiveAlertChain();
    const archive = updateHuntStallIncidentEvidenceArchive({
      previous: null,
      now,
      patch: {
        currentResetEpochId: chain.reset.id,
        currentConfigurationRevisionId: chain.config.id,
        resetEpochs: [chain.reset],
        configurationRevisions: [chain.config],
        frames: [chain.frame],
        observations: [chain.observation],
        activityEpochs: [chain.activity],
        stallEpisodes: [chain.episode],
        alertCycles: [chain.cycle],
        decisions: [chain.initialDecision, chain.repeatDecision],
        playbackAttempts: [chain.initialAttempt, chain.repeatAttempt],
      },
    });

    expect(archive.decisions.map((entry) => entry.id)).toEqual([
      chain.initialDecision.id,
      chain.repeatDecision.id,
    ]);
    expect(archive.playbackAttempts.map((entry) => entry.id)).toEqual([
      chain.repeatAttempt.id,
    ]);
    expect(archive.alertCycles.map((entry) => entry.id)).toEqual([
      chain.cycle.id,
    ]);
  });

  it("preserves a protected anchor while bounding recent ordinary frames", () => {
    const now = 200_000;
    const reset = createReset();
    const config = createConfig(reset);
    const anchorFrame = createFrame(reset, config, 1, 1_000);
    const anchorObservation = createObservation(anchorFrame);
    const activity = createActivity(reset, anchorFrame, anchorObservation, 1_000);
    const episode = createEpisode(reset, activity, 1_000, "active");
    const recentFrames = Array.from({ length: 100 }, (_, index) =>
      createFrame(reset, config, index + 2, 150_000 + index),
    );
    const archive = updateHuntStallIncidentEvidenceArchive({
      previous: null,
      now,
      patch: {
        currentResetEpochId: reset.id,
        currentConfigurationRevisionId: config.id,
        resetEpochs: [reset],
        configurationRevisions: [config],
        frames: [anchorFrame, ...recentFrames],
        observations: [
          anchorObservation,
          ...recentFrames.map((entry) => createObservation(entry)),
        ],
        activityEpochs: [activity],
        stallEpisodes: [episode],
      },
    });

    expect(archive.frames).toHaveLength(HUNT_STALL_INCIDENT_MAX_FRAMES);
    expect(archive.frames.some((entry) => entry.id === anchorFrame.id)).toBe(true);
    expect(archive.frames[archive.frames.length - 1]?.id).toBe(
      recentFrames[recentFrames.length - 1]?.id,
    );
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({ kind: "frame", reason: "metadata-cap" }),
    );
  });

  it("keeps leased and decision media before periodic context under hard limits", () => {
    const now = 100_000;
    const reset = createReset();
    const config = createConfig(reset);
    const frames = Array.from({ length: 10 }, (_, index) =>
      createFrame(reset, config, index + 1, 90_000 + index),
    );
    const media = frames.map((frame, index) =>
      createMedia(
        frame,
        index === 1 ? "alert-decision" : "periodic",
        80_000,
      ),
    );
    const archive = updateHuntStallIncidentEvidenceArchive({
      previous: null,
      now,
      protection: { mediaFrameIds: [frames[0].id] },
      patch: {
        currentResetEpochId: reset.id,
        currentConfigurationRevisionId: config.id,
        resetEpochs: [reset],
        configurationRevisions: [config],
        frames,
        observations: frames.map((entry) => createObservation(entry)),
        media,
      },
    });
    const chars = archive.media.reduce(
      (total, entry) =>
        total +
        (entry.rawDataUrl?.length ?? 0) +
        (entry.processedDataUrl?.length ?? 0),
      0,
    );

    expect(archive.media.length).toBeLessThanOrEqual(
      HUNT_STALL_INCIDENT_MEDIA_MAX_FRAMES,
    );
    expect(chars).toBeLessThanOrEqual(
      HUNT_STALL_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
    );
    expect(archive.media.some((entry) => entry.frameId === frames[0].id)).toBe(
      true,
    );
    expect(archive.media.some((entry) => entry.frameId === frames[1].id)).toBe(
      true,
    );
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({ kind: "media", reason: "media-budget" }),
    );
  });

  it("rejects one oversized image without dropping its compact frame", () => {
    const now = 100_000;
    const reset = createReset();
    const config = createConfig(reset);
    const frame = createFrame(reset, config, 1, now);
    const archive = updateHuntStallIncidentEvidenceArchive({
      previous: null,
      now,
      patch: {
        currentResetEpochId: reset.id,
        currentConfigurationRevisionId: config.id,
        resetEpochs: [reset],
        configurationRevisions: [config],
        frames: [frame],
        observations: [createObservation(frame)],
        media: [
          createMedia(
            frame,
            "runtime-error",
            HUNT_STALL_INCIDENT_MEDIA_MAX_FRAME_CHARS + 1,
          ),
        ],
      },
    });

    expect(archive.frames.map((entry) => entry.id)).toEqual([frame.id]);
    expect(archive.media).toEqual([]);
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({ kind: "media", reason: "media-oversize" }),
    );
  });

  it("truncates event detail and remains below the aggregate metadata cap", () => {
    const now = 100_000;
    const reset = createReset();
    const config = createConfig(reset);
    const events: HuntStallIncidentLifecycleEvent[] = Array.from(
      { length: 240 },
      (_, index) => createEvent(reset, 40_000 + index, index),
    );
    const archive = updateHuntStallIncidentEvidenceArchive({
      previous: createHuntStallIncidentEvidenceArchive(0),
      now,
      patch: {
        currentResetEpochId: reset.id,
        currentConfigurationRevisionId: config.id,
        resetEpochs: [reset],
        configurationRevisions: [config],
        lifecycleEvents: events,
      },
    });

    expect(getHuntStallIncidentEvidenceMetadataChars(archive)).toBeLessThanOrEqual(
      HUNT_STALL_INCIDENT_METADATA_MAX_CHARS,
    );
    expect(archive.lifecycleEvents.length).toBeLessThan(events.length);
    expect(archive.lifecycleEvents[0]?.details).toEqual(
      expect.objectContaining({ omitted: "metadata-cap" }),
    );
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({ kind: "event", reason: "metadata-cap" }),
    );
  });

  it("bounds reset storms while retaining the current configuration without a frame", () => {
    const now = 100_000;
    const resets = Array.from({ length: 10 }, (_, index) =>
      createReset(index + 1, 90_000 + index),
    );
    const configs = resets.map((reset, index) =>
      createConfig(reset, 1, 90_000 + index),
    );
    const currentReset = resets[resets.length - 1]!;
    const currentConfig = configs[configs.length - 1]!;
    const archive = updateHuntStallIncidentEvidenceArchive({
      previous: null,
      now,
      protection: { resetEpochIds: [resets[0].id] },
      patch: {
        currentResetEpochId: currentReset.id,
        currentConfigurationRevisionId: currentConfig.id,
        resetEpochs: resets,
        configurationRevisions: configs,
      },
    });

    expect(archive.resetEpochs).toHaveLength(
      HUNT_STALL_INCIDENT_MAX_RESET_EPOCHS,
    );
    expect(archive.resetEpochs.some((entry) => entry.id === resets[0].id)).toBe(
      true,
    );
    expect(archive.currentResetEpochId).toBe(currentReset.id);
    expect(archive.currentConfigurationRevisionId).toBe(currentConfig.id);
    expect(
      archive.configurationRevisions.every((entry) =>
        archive.resetEpochs.some((reset) => reset.id === entry.resetEpochId),
      ),
    ).toBe(true);
  });

  it("keeps an old current configuration before the first sampled frame", () => {
    const reset = createReset(1, 1_000);
    const config = createConfig(reset, 1, 1_000);
    const archive = updateHuntStallIncidentEvidenceArchive({
      previous: null,
      now: 100_000,
      patch: {
        currentResetEpochId: reset.id,
        currentConfigurationRevisionId: config.id,
        resetEpochs: [reset],
        configurationRevisions: [config],
      },
    });

    expect(archive.resetEpochs.map((entry) => entry.id)).toEqual([reset.id]);
    expect(archive.configurationRevisions.map((entry) => entry.id)).toEqual([
      config.id,
    ]);
  });

  it("drops ordinary frames with evicted configurations without dangling references", () => {
    const now = 100_000;
    const chain = createActiveAlertChain();
    const recentConfigs = Array.from({ length: 40 }, (_, index) =>
      createConfig(chain.reset, index + 2, 90_000 + index),
    );
    const recentFrames = recentConfigs.map((config, index) =>
      createFrame(chain.reset, config, index + 2, 90_000 + index),
    );
    const currentConfig = recentConfigs[recentConfigs.length - 1];
    const archive = updateHuntStallIncidentEvidenceArchive({
      previous: null,
      now,
      patch: {
        currentResetEpochId: chain.reset.id,
        currentConfigurationRevisionId: currentConfig.id,
        resetEpochs: [chain.reset],
        configurationRevisions: [chain.config, ...recentConfigs],
        frames: [chain.frame, ...recentFrames],
        observations: [
          chain.observation,
          ...recentFrames.map((entry) => createObservation(entry)),
        ],
        activityEpochs: [chain.activity],
        stallEpisodes: [chain.episode],
        alertCycles: [chain.cycle],
        decisions: [chain.initialDecision, chain.repeatDecision],
        playbackAttempts: [chain.initialAttempt, chain.repeatAttempt],
      },
    });
    const retainedConfigurationIds = new Set(
      archive.configurationRevisions.map((entry) => entry.id),
    );

    expect(archive.configurationRevisions).toHaveLength(32);
    expect(retainedConfigurationIds.has(chain.config.id)).toBe(true);
    expect(archive.frames.some((entry) => entry.id === chain.frame.id)).toBe(
      true,
    );
    expect(
      archive.frames.every((entry) =>
        retainedConfigurationIds.has(entry.configRevisionId),
      ),
    ).toBe(true);
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({ kind: "frame", reason: "metadata-cap" }),
    );
  });
});

function createReset(
  sequence = 1,
  startedAt = 0,
): HuntStallIncidentResetEpoch {
  return {
    id: createHuntStallIncidentResetEpochId("test-session", sequence),
    sessionId: "test-session",
    sequence,
    startedAt,
    reason: sequence === 1 ? "initialized" : "worker-reset",
    continuity: {
      captureGeneration: sequence,
      featureGeneration: sequence,
      workerGeneration: sequence,
      mode: "manual-experience",
      layoutKey: "layout:test",
      regionRevision: `region:${sequence}`,
    },
  };
}

function createConfig(
  reset: HuntStallIncidentResetEpoch,
  sequence = 1,
  capturedAt = reset.startedAt,
): HuntStallIncidentConfigurationRevision {
  return {
    id: createHuntStallIncidentConfigurationRevisionId(reset.id, sequence),
    resetEpochId: reset.id,
    sequence,
    capturedAt,
    fingerprint: `config:${reset.sequence}:${sequence}`,
    values: {
      enabled: true,
      mode: reset.continuity.mode,
      thresholdSeconds: 120,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 5,
      repeatAlertMaxCount: null,
      soundId: "test-sound",
      featureVolume: 0.8,
      masterVolume: 0.5,
      effectiveVolume: 0.4,
    },
  };
}

function createFrame(
  reset: HuntStallIncidentResetEpoch,
  config: HuntStallIncidentConfigurationRevision,
  sequence: number,
  sampledAt: number,
): HuntStallIncidentFrame {
  return {
    id: createHuntStallIncidentFrameId(reset.id, sequence),
    resetEpochId: reset.id,
    configRevisionId: config.id,
    sequence,
    sampledAt,
    mode: reset.continuity.mode,
    layoutKey: reset.continuity.layoutKey,
    regionRevision: reset.continuity.regionRevision,
  };
}

function createObservation(
  frame: HuntStallIncidentFrame,
): HuntStallIncidentObservation {
  return {
    id: createHuntStallIncidentObservationId(frame.id),
    resetEpochId: frame.resetEpochId,
    frameId: frame.id,
    frameSequence: frame.sequence,
    sampledAt: frame.sampledAt,
    mode: frame.mode,
  };
}

function createActivity(
  reset: HuntStallIncidentResetEpoch,
  frame: HuntStallIncidentFrame,
  observation: HuntStallIncidentObservation,
  startedAt: number,
): HuntStallIncidentActivityEpoch {
  return {
    id: createHuntStallIncidentActivityEpochId(reset.id, 1),
    resetEpochId: reset.id,
    sequence: 1,
    mode: reset.continuity.mode,
    startedAt,
    anchorFrameId: frame.id,
    anchorFrameSequence: frame.sequence,
    anchorObservationId: observation.id,
    reason: "manual-progress-confirmed",
    endedAt: null,
    terminalReason: null,
  };
}

function createEpisode(
  reset: HuntStallIncidentResetEpoch,
  activity: HuntStallIncidentActivityEpoch,
  startedAt: number,
  status: HuntStallIncidentStallEpisode["status"],
): HuntStallIncidentStallEpisode {
  return {
    id: createHuntStallIncidentStallEpisodeId(activity.id, 1),
    resetEpochId: reset.id,
    activityEpochId: activity.id,
    sequence: 1,
    mode: reset.continuity.mode,
    startedAt,
    status,
    alertCycleId: null,
    endedAt: null,
    terminalReason: null,
  };
}

function createActiveAlertChain(): {
  reset: HuntStallIncidentResetEpoch;
  config: HuntStallIncidentConfigurationRevision;
  frame: HuntStallIncidentFrame;
  observation: HuntStallIncidentObservation;
  activity: HuntStallIncidentActivityEpoch;
  episode: HuntStallIncidentStallEpisode;
  cycle: HuntStallIncidentAlertCycle;
  initialDecision: HuntStallIncidentAlertDecision;
  repeatDecision: HuntStallIncidentAlertDecision;
  initialAttempt: HuntStallIncidentPlaybackAttempt;
  repeatAttempt: HuntStallIncidentPlaybackAttempt;
} {
  const reset = createReset();
  const config = createConfig(reset);
  const frame = createFrame(reset, config, 1, 1_000);
  const observation = createObservation(frame);
  const activity = createActivity(reset, frame, observation, 1_000);
  const episode = createEpisode(reset, activity, 1_000, "alerted");
  const cycleId = createHuntStallIncidentAlertCycleId(episode.id, 1);
  const initialDecisionId = createHuntStallIncidentAlertDecisionId(
    cycleId,
    "initial",
    1,
  );
  const repeatDecisionId = createHuntStallIncidentAlertDecisionId(
    cycleId,
    "repeat",
    2,
  );
  const cycle: HuntStallIncidentAlertCycle = {
    id: cycleId,
    resetEpochId: reset.id,
    activityEpochId: activity.id,
    stallEpisodeId: episode.id,
    sequence: 1,
    mode: reset.continuity.mode,
    startedAt: 2_000,
    initialDecisionId,
    status: "active",
    endedAt: null,
    terminalReason: null,
  };
  episode.alertCycleId = cycle.id;
  const initialDecision = createDecision({
    id: initialDecisionId,
    kind: "initial",
    occurredAt: 2_000,
    reset,
    config,
    frame,
    observation,
    activity,
    episode,
    cycle,
    sequence: 1,
  });
  const repeatDecision = createDecision({
    id: repeatDecisionId,
    kind: "repeat",
    occurredAt: 8_000,
    reset,
    config,
    frame,
    observation,
    activity,
    episode,
    cycle,
    sequence: 2,
  });
  const initialAttempt = createAttempt(initialDecision, 1, 2_000);
  const repeatAttempt = createAttempt(repeatDecision, 2, 8_000);
  return {
    reset,
    config,
    frame,
    observation,
    activity,
    episode,
    cycle,
    initialDecision,
    repeatDecision,
    initialAttempt,
    repeatAttempt,
  };
}

function createDecision({
  id,
  kind,
  occurredAt,
  reset,
  config,
  frame,
  observation,
  activity,
  episode,
  cycle,
  sequence,
}: {
  id: string;
  kind: "initial" | "repeat";
  occurredAt: number;
  reset: HuntStallIncidentResetEpoch;
  config: HuntStallIncidentConfigurationRevision;
  frame: HuntStallIncidentFrame;
  observation: HuntStallIncidentObservation;
  activity: HuntStallIncidentActivityEpoch;
  episode: HuntStallIncidentStallEpisode;
  cycle: HuntStallIncidentAlertCycle;
  sequence: number;
}): HuntStallIncidentAlertDecision {
  return {
    id,
    resetEpochId: reset.id,
    activityEpochId: activity.id,
    stallEpisodeId: episode.id,
    cycleId: cycle.id,
    sequence,
    kind,
    occurredAt,
    frameId: frame.id,
    observationId: observation.id,
    configRevisionId: config.id,
  };
}

function createAttempt(
  decision: HuntStallIncidentAlertDecision,
  sequence: number,
  requestedAt: number,
): HuntStallIncidentPlaybackAttempt {
  return {
    id: createHuntStallIncidentPlaybackAttemptId(decision.cycleId, sequence),
    resetEpochId: decision.resetEpochId,
    activityEpochId: decision.activityEpochId,
    stallEpisodeId: decision.stallEpisodeId,
    cycleId: decision.cycleId,
    decisionId: decision.id,
    sequence,
    requestedAt,
    startedAt: requestedAt + 1,
    finishedAt: requestedAt + 2,
    failedAt: null,
    status: "finished",
    error: null,
    configRevisionId: decision.configRevisionId,
    soundId: "test-sound",
    featureVolume: 0.8,
    masterVolume: 0.5,
    effectiveVolume: 0.4,
  };
}

function createMedia(
  frame: HuntStallIncidentFrame,
  reason: HuntStallIncidentMediaFrame["reason"],
  chars: number,
): HuntStallIncidentMediaFrame {
  return {
    id: `media:${frame.id}`,
    frameId: frame.id,
    resetEpochId: frame.resetEpochId,
    sampledAt: frame.sampledAt,
    reason,
    rawDataUrl: `data:image/webp;base64,${"x".repeat(chars)}`,
    processedDataUrl: null,
  };
}

function createEvent(
  reset: HuntStallIncidentResetEpoch,
  occurredAt: number,
  sequence: number,
): HuntStallIncidentLifecycleEvent {
  return {
    id: `event:${sequence}`,
    resetEpochId: reset.id,
    occurredAt,
    category: "runtime-error",
    action: "large-diagnostic-context",
    frameId: null,
    observationId: null,
    activityEpochId: null,
    stallEpisodeId: null,
    cycleId: null,
    attemptId: null,
    configRevisionId: null,
    details: { value: "x".repeat(4_000), sequence },
  };
}
