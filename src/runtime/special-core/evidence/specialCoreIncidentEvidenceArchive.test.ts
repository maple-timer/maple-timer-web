import { describe, expect, it } from "vitest";
import { createSpecialCoreIncidentBoundary } from "./specialCoreIncidentBoundary";
import {
  SPECIAL_CORE_INCIDENT_CURRENT_WINDOW_MS,
  SPECIAL_CORE_INCIDENT_MAX_FRAMES,
  SPECIAL_CORE_INCIDENT_MAX_LIFECYCLE_EVENTS,
  SPECIAL_CORE_INCIDENT_MEDIA_MAX_FRAME_CHARS,
  SPECIAL_CORE_INCIDENT_MEDIA_MAX_FRAMES,
  SPECIAL_CORE_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
  SPECIAL_CORE_INCIDENT_METADATA_MAX_CHARS,
  SPECIAL_CORE_INCIDENT_REPORT_REQUEST_TARGET_BYTES,
  SPECIAL_CORE_INCIDENT_RETENTION_MS,
  compactSpecialCoreIncidentEvidenceArchive,
  createSpecialCoreIncidentEvidenceArchive,
  getSpecialCoreIncidentEvidenceMetadataChars,
  getSpecialCoreIncidentEvidenceRequestBytes,
  getSpecialCoreIncidentEvidenceSupport,
  updateSpecialCoreIncidentEvidenceArchive,
} from "./specialCoreIncidentEvidenceArchive";
import {
  createSpecialCoreIncidentActivationId,
  createSpecialCoreIncidentAlertDecisionId,
  createSpecialCoreIncidentConfigurationRevisionId,
  createSpecialCoreIncidentConfirmationAttemptId,
  createSpecialCoreIncidentFrameId,
  createSpecialCoreIncidentObservationId,
  createSpecialCoreIncidentPlaybackAttemptId,
  createSpecialCoreIncidentResetEpochId,
  createSpecialCoreIncidentScheduleId,
  type SpecialCoreIncidentActivation,
  type SpecialCoreIncidentAlertDecision,
  type SpecialCoreIncidentConfigurationRevision,
  type SpecialCoreIncidentConfirmationAttempt,
  type SpecialCoreIncidentFrame,
  type SpecialCoreIncidentLifecycleEvent,
  type SpecialCoreIncidentMediaFrame,
  type SpecialCoreIncidentObservation,
  type SpecialCoreIncidentPlaybackAttempt,
  type SpecialCoreIncidentResetEpoch,
  type SpecialCoreIncidentSchedule,
} from "./specialCoreIncidentEvidenceTypes";

describe("special core incident evidence archive", () => {
  it("synchronizes the current reset and configuration from the boundary state", () => {
    const boundary = createSpecialCoreIncidentBoundary({
      sessionId: "boundary-session",
      now: 10,
      continuity: {
        captureGeneration: 1,
        featureGeneration: 1,
        parserRuntimeGeneration: "parser-v1",
        matcherWorkerGeneration: 1,
        layoutKey: "layout",
        sourceGeometryRevision: "1920x1080",
      },
      configuration: {
        enabled: true,
        cooldownSeconds: 30,
        alertLeadSeconds: 5,
        soundId: "sound",
        featureVolume: 1,
        masterVolume: 1,
        effectiveVolume: 1,
      },
    });
    const archive = updateSpecialCoreIncidentEvidenceArchive({
      previous: null,
      now: 10,
      patch: { boundaryState: boundary },
    });

    expect(archive.pointers).toMatchObject({
      currentResetEpochId: boundary.resetEpoch.id,
      currentConfigurationRevisionId: boundary.configurationRevision.id,
    });
    expect(archive.resetEpochs).toEqual([boundary.resetEpoch]);
    expect(archive.configurationRevisions).toEqual([
      boundary.configurationRevision,
    ]);
  });

  it("classifies exact current and recent support boundaries", () => {
    const now = 100_000;
    expect(
      getSpecialCoreIncidentEvidenceSupport({
        now,
        occurredAt: now - SPECIAL_CORE_INCIDENT_CURRENT_WINDOW_MS,
      }),
    ).toBe("current");
    expect(
      getSpecialCoreIncidentEvidenceSupport({
        now,
        occurredAt: now - SPECIAL_CORE_INCIDENT_CURRENT_WINDOW_MS - 1,
      }),
    ).toBe("recent");
    expect(
      getSpecialCoreIncidentEvidenceSupport({
        now,
        occurredAt: now - SPECIAL_CORE_INCIDENT_RETENTION_MS,
      }),
    ).toBe("recent");
    expect(
      getSpecialCoreIncidentEvidenceSupport({
        now,
        occurredAt: now - SPECIAL_CORE_INCIDENT_RETENTION_MS - 1,
      }),
    ).toBe("unsupported");
    expect(
      getSpecialCoreIncidentEvidenceSupport({ now, occurredAt: now + 1 }),
    ).toBe("unsupported");
  });

  it("retains ordinary evidence through 60 seconds and expires it one millisecond later", () => {
    const fixture = createFixture(0);
    const ordinaryFrame = createFrame(fixture, 1, 1_000);
    const ordinaryObservation = createObservation(ordinaryFrame, "rejected");
    const initial = updateSpecialCoreIncidentEvidenceArchive({
      previous: null,
      now: 1_000,
      patch: {
        pointers: {
          currentResetEpochId: fixture.reset.id,
          currentConfigurationRevisionId: fixture.configuration.id,
        },
        resetEpochs: [fixture.reset],
        configurationRevisions: [fixture.configuration],
        frames: [ordinaryFrame],
        observations: [ordinaryObservation],
      },
    });

    const atBoundary = compactSpecialCoreIncidentEvidenceArchive({
      archive: initial,
      now: 61_000,
    });
    expect(atBoundary.frames.map((entry) => entry.id)).toContain(
      ordinaryFrame.id,
    );

    const expired = compactSpecialCoreIncidentEvidenceArchive({
      archive: atBoundary,
      now: 61_001,
    });
    expect(expired.frames).toEqual([]);
    expect(expired.observations).toEqual([]);
    expect(expired.omissions).toContainEqual(
      expect.objectContaining({ kind: "frame", reason: "outside-retention" }),
    );
  });

  it("protects only the compact active activation chain for a 180 second cooldown", () => {
    const fixture = createActiveChainFixture();
    const archive = updateSpecialCoreIncidentEvidenceArchive({
      previous: null,
      now: fixture.secondFrame.sampledAt,
      patch: {
        pointers: fixture.pointers,
        resetEpochs: [fixture.reset],
        configurationRevisions: [fixture.configuration],
        frames: [fixture.firstFrame, fixture.secondFrame],
        observations: [
          fixture.firstObservation,
          fixture.secondObservation,
        ],
        confirmationAttempts: [fixture.confirmation],
        activations: [fixture.activation],
        schedules: [fixture.schedule],
        media: [
          createMedia(
            fixture.firstFrame,
            "activation-confirmation",
            700_000,
          ),
          createMedia(
            fixture.secondFrame,
            "activation-confirmation",
            700_000,
          ),
        ],
      },
    });

    const late = compactSpecialCoreIncidentEvidenceArchive({
      archive,
      now: 179_000,
    });
    expect(late.activations.map((entry) => entry.id)).toEqual([
      fixture.activation.id,
    ]);
    expect(late.confirmationAttempts.map((entry) => entry.id)).toEqual([
      fixture.confirmation.id,
    ]);
    expect(late.frames.map((entry) => entry.id)).toEqual([
      fixture.firstFrame.id,
      fixture.secondFrame.id,
    ]);
    expect(late.media).toHaveLength(2);
    expect(late.frames).toHaveLength(2);
  });

  it("expires a terminal activation chain 60 seconds after its terminal event", () => {
    const fixture = createActiveChainFixture();
    const terminalAt = 5_000;
    const activation: SpecialCoreIncidentActivation = {
      ...fixture.activation,
      status: "terminal",
      endedAt: terminalAt,
      terminalReason: "next-activation",
    };
    const archive = updateSpecialCoreIncidentEvidenceArchive({
      previous: null,
      now: terminalAt,
      patch: {
        pointers: {
          ...fixture.pointers,
          activeActivationId: null,
          activeScheduleId: null,
        },
        resetEpochs: [fixture.reset],
        configurationRevisions: [fixture.configuration],
        frames: [fixture.firstFrame, fixture.secondFrame],
        observations: [
          fixture.firstObservation,
          fixture.secondObservation,
        ],
        confirmationAttempts: [fixture.confirmation],
        activations: [activation],
        schedules: [
          {
            ...fixture.schedule,
            status: "cancelled",
            endedAt: terminalAt,
          },
        ],
      },
    });

    const atBoundary = compactSpecialCoreIncidentEvidenceArchive({
      archive,
      now: terminalAt + SPECIAL_CORE_INCIDENT_RETENTION_MS,
    });
    expect(atBoundary.activations).toHaveLength(1);
    expect(atBoundary.frames).toHaveLength(2);

    const expired = compactSpecialCoreIncidentEvidenceArchive({
      archive: atBoundary,
      now: terminalAt + SPECIAL_CORE_INCIDENT_RETENTION_MS + 1,
    });
    expect(expired.activations).toEqual([]);
    expect(expired.confirmationAttempts).toEqual([]);
    expect(expired.frames).toEqual([]);
  });

  it("keeps the latest frame while bounding ordinary one-second samples", () => {
    const fixture = createFixture(0);
    const frames = Array.from({ length: SPECIAL_CORE_INCIDENT_MAX_FRAMES + 1 }, (_, index) =>
      createFrame(fixture, index + 1, index + 1),
    );
    const latest = frames[frames.length - 1]!;
    const archive = updateSpecialCoreIncidentEvidenceArchive({
      previous: null,
      now: latest.sampledAt,
      patch: {
        pointers: {
          currentResetEpochId: fixture.reset.id,
          currentConfigurationRevisionId: fixture.configuration.id,
          latestFrameId: latest.id,
        },
        resetEpochs: [fixture.reset],
        configurationRevisions: [fixture.configuration],
        frames,
      },
    });

    expect(archive.frames).toHaveLength(SPECIAL_CORE_INCIDENT_MAX_FRAMES);
    expect(archive.frames[archive.frames.length - 1]?.id).toBe(latest.id);
    expect(archive.frames.some((entry) => entry.id === frames[0]?.id)).toBe(
      false,
    );
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({ kind: "frame", reason: "metadata-cap" }),
    );
  });

  it("deduplicates one frame across current and incident media roles", () => {
    const fixture = createFixture(0);
    const frame = createFrame(fixture, 1, 1_000);
    let archive = updateSpecialCoreIncidentEvidenceArchive({
      previous: null,
      now: 1_000,
      patch: createFramePatch(fixture, frame, [
        createMedia(frame, "current", 1_000, "current-media"),
      ]),
    });
    archive = updateSpecialCoreIncidentEvidenceArchive({
      previous: archive,
      now: 1_001,
      patch: {
        media: [createMedia(frame, "alert-decision", 2_000, "decision-media")],
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

  it("rejects one oversized image without dropping its compact frame", () => {
    const fixture = createFixture(0);
    const frame = createFrame(fixture, 1, 1_000);
    const archive = updateSpecialCoreIncidentEvidenceArchive({
      previous: null,
      now: 1_000,
      patch: createFramePatch(fixture, frame, [
        createMedia(
          frame,
          "activation-confirmation",
          SPECIAL_CORE_INCIDENT_MEDIA_MAX_FRAME_CHARS + 1,
        ),
      ]),
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
    const archive = updateSpecialCoreIncidentEvidenceArchive({
      previous: null,
      now: 3_000,
      patch: {
        pointers: {
          currentResetEpochId: fixture.reset.id,
          currentConfigurationRevisionId: fixture.configuration.id,
        },
        resetEpochs: [fixture.reset],
        configurationRevisions: [fixture.configuration],
        frames,
        media: [
          createMedia(frames[0]!, "periodic", 700_000),
          createMedia(frames[1]!, "activation-confirmation", 700_000),
          createMedia(frames[2]!, "alert-decision", 700_000),
        ],
      },
    });

    expect(archive.media.map((entry) => entry.reason).sort()).toEqual([
      "activation-confirmation",
      "alert-decision",
    ]);
    expect(
      archive.media.reduce((total, entry) => total + entry.imageDataUrl.length, 0),
    ).toBeLessThanOrEqual(SPECIAL_CORE_INCIDENT_MEDIA_MAX_TOTAL_CHARS);
    expect(archive.media.length).toBeLessThanOrEqual(
      SPECIAL_CORE_INCIDENT_MEDIA_MAX_FRAMES,
    );
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({ kind: "media", reason: "media-budget" }),
    );
  });

  it("bounds reset storms without losing the current epoch and configuration", () => {
    const resets = Array.from({ length: 12 }, (_, index) =>
      createFixture(index * 1_000, index + 1),
    );
    const current = resets[resets.length - 1]!;
    const frames = resets.map((entry, index) =>
      createFrame(entry, index + 1, entry.reset.startedAt),
    );
    const archive = updateSpecialCoreIncidentEvidenceArchive({
      previous: null,
      now: current.reset.startedAt,
      patch: {
        pointers: {
          currentResetEpochId: current.reset.id,
          currentConfigurationRevisionId: current.configuration.id,
        },
        resetEpochs: resets.map((entry) => entry.reset),
        configurationRevisions: resets.map((entry) => entry.configuration),
        frames,
      },
    });

    expect(archive.resetEpochs).toHaveLength(8);
    expect(archive.resetEpochs[archive.resetEpochs.length - 1]?.id).toBe(
      current.reset.id,
    );
    expect(
      archive.configurationRevisions[
        archive.configurationRevisions.length - 1
      ]?.id,
    ).toBe(
      current.configuration.id,
    );
    expect(archive.pointers.currentResetEpochId).toBe(current.reset.id);
    expect(archive.frames).toHaveLength(8);
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({ kind: "frame", reason: "reset-epoch" }),
    );
  });

  it("truncates event details and enforces the aggregate metadata cap", () => {
    const fixture = createFixture(0);
    const lifecycleEvents = Array.from(
      { length: SPECIAL_CORE_INCIDENT_MAX_LIFECYCLE_EVENTS + 80 },
      (_, index) => createEvent(fixture, index, "x".repeat(4_000)),
    );
    const archive = updateSpecialCoreIncidentEvidenceArchive({
      previous: null,
      now: lifecycleEvents[lifecycleEvents.length - 1]!.occurredAt,
      patch: {
        pointers: {
          currentResetEpochId: fixture.reset.id,
          currentConfigurationRevisionId: fixture.configuration.id,
        },
        resetEpochs: [fixture.reset],
        configurationRevisions: [fixture.configuration],
        lifecycleEvents,
      },
    });

    expect(archive.lifecycleEvents.length).toBeLessThanOrEqual(
      SPECIAL_CORE_INCIDENT_MAX_LIFECYCLE_EVENTS,
    );
    expect(archive.lifecycleEvents[0]?.details).toMatchObject({
      omitted: "metadata-cap",
    });
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({ kind: "event", reason: "metadata-cap" }),
    );
    expect(getSpecialCoreIncidentEvidenceMetadataChars(archive)).toBeLessThanOrEqual(
      SPECIAL_CORE_INCIDENT_METADATA_MAX_CHARS,
    );
  });

  it("keeps a worst-case two-frame confirmation archive below the request target", () => {
    const fixture = createActiveChainFixture();
    const archive = updateSpecialCoreIncidentEvidenceArchive({
      previous: null,
      now: 2_000,
      patch: {
        pointers: fixture.pointers,
        resetEpochs: [fixture.reset],
        configurationRevisions: [fixture.configuration],
        frames: [fixture.firstFrame, fixture.secondFrame],
        observations: [
          fixture.firstObservation,
          fixture.secondObservation,
        ],
        confirmationAttempts: [fixture.confirmation],
        activations: [fixture.activation],
        schedules: [fixture.schedule],
        media: [
          createMedia(
            fixture.firstFrame,
            "activation-confirmation",
            800_000,
          ),
          createMedia(
            fixture.secondFrame,
            "activation-confirmation",
            800_000,
          ),
        ],
      },
    });

    expect(getSpecialCoreIncidentEvidenceRequestBytes(archive)).toBeLessThan(
      SPECIAL_CORE_INCIDENT_REPORT_REQUEST_TARGET_BYTES,
    );
  });

  it("retains the fired schedule, decision, and browser playback lifecycle as one chain", () => {
    const fixture = createActiveChainFixture();
    const decision: SpecialCoreIncidentAlertDecision = {
      id: createSpecialCoreIncidentAlertDecisionId(fixture.activation.id, 1),
      resetEpochId: fixture.reset.id,
      activationId: fixture.activation.id,
      scheduleId: fixture.schedule.id,
      sequence: 1,
      occurredAt: 176_000,
      dueAt: 175_000,
      schedulerDelayMs: 1_000,
      timingConfigRevisionId: fixture.configuration.id,
      firedConfigRevisionId: fixture.configuration.id,
    };
    const schedule: SpecialCoreIncidentSchedule = {
      ...fixture.schedule,
      status: "fired",
      endedAt: decision.occurredAt,
    };
    const playback: SpecialCoreIncidentPlaybackAttempt = {
      id: createSpecialCoreIncidentPlaybackAttemptId(fixture.activation.id, 1),
      resetEpochId: fixture.reset.id,
      activationId: fixture.activation.id,
      scheduleId: schedule.id,
      decisionId: decision.id,
      sequence: 1,
      requestedAt: 176_001,
      browserAcceptedAt: 176_002,
      finishedAt: 176_500,
      failedAt: null,
      status: "finished",
      error: null,
      configRevisionId: fixture.configuration.id,
      soundId: "sound",
      featureVolume: 1,
      masterVolume: 1,
      effectiveVolume: 1,
      startOffsetSeconds: 1,
    };
    const archive = updateSpecialCoreIncidentEvidenceArchive({
      previous: null,
      now: 176_500,
      patch: {
        pointers: {
          ...fixture.pointers,
          activeScheduleId: schedule.id,
          activeDecisionId: decision.id,
          activePlaybackAttemptId: playback.id,
        },
        resetEpochs: [fixture.reset],
        configurationRevisions: [fixture.configuration],
        frames: [fixture.firstFrame, fixture.secondFrame],
        observations: [
          fixture.firstObservation,
          fixture.secondObservation,
        ],
        confirmationAttempts: [fixture.confirmation],
        activations: [fixture.activation],
        schedules: [schedule],
        decisions: [decision],
        playbackAttempts: [playback],
      },
    });

    expect(archive.schedules.map((entry) => entry.id)).toEqual([schedule.id]);
    expect(archive.decisions.map((entry) => entry.id)).toEqual([decision.id]);
    expect(archive.playbackAttempts.map((entry) => entry.id)).toEqual([
      playback.id,
    ]);
    expect(archive.playbackAttempts[0]).toMatchObject({
      browserAcceptedAt: 176_002,
      finishedAt: 176_500,
      status: "finished",
    });
  });
});

function createFixture(startedAt: number, sequence = 1): {
  reset: SpecialCoreIncidentResetEpoch;
  configuration: SpecialCoreIncidentConfigurationRevision;
} {
  const resetId = createSpecialCoreIncidentResetEpochId("session", sequence);
  const reset: SpecialCoreIncidentResetEpoch = {
    id: resetId,
    sessionId: "session",
    sequence,
    startedAt,
    reason: sequence === 1 ? "initialized" : "stream-replaced",
    continuity: {
      captureGeneration: sequence,
      featureGeneration: 1,
      parserRuntimeGeneration: "parser-v1",
      matcherWorkerGeneration: 1,
      layoutKey: "layout",
      sourceGeometryRevision: "1920x1080",
    },
  };
  const configuration: SpecialCoreIncidentConfigurationRevision = {
    id: createSpecialCoreIncidentConfigurationRevisionId(resetId, sequence),
    resetEpochId: resetId,
    sequence,
    capturedAt: startedAt,
    fingerprint: `config-${sequence}`,
    timingFingerprint: `timing-${sequence}`,
    values: {
      enabled: true,
      cooldownSeconds: 180,
      alertLeadSeconds: 5,
      soundId: "sound",
      featureVolume: 1,
      masterVolume: 1,
      effectiveVolume: 1,
    },
  };
  return { reset, configuration };
}

function createFrame(
  fixture: ReturnType<typeof createFixture>,
  sequence: number,
  sampledAt: number,
): SpecialCoreIncidentFrame {
  return {
    id: createSpecialCoreIncidentFrameId(fixture.reset.id, sequence),
    resetEpochId: fixture.reset.id,
    configRevisionId: fixture.configuration.id,
    sequence,
    sampledAt,
    layoutKey: fixture.reset.continuity.layoutKey,
    sourceGeometryRevision:
      fixture.reset.continuity.sourceGeometryRevision,
    source: null,
    parser: null,
    parsedBoxes: [],
    rowGroups: [],
    eligibleBoxIndexes: [],
    timings: null,
    runtimeFailure: null,
    mediaFrameId: null,
  };
}

function createObservation(
  frame: SpecialCoreIncidentFrame,
  decision: SpecialCoreIncidentObservation["decision"] = "accepted",
): SpecialCoreIncidentObservation {
  return {
    id: createSpecialCoreIncidentObservationId(frame.id),
    resetEpochId: frame.resetEpochId,
    frameId: frame.id,
    frameSequence: frame.sequence,
    configRevisionId: frame.configRevisionId,
    sampledAt: frame.sampledAt,
    decision,
    reason: decision === "accepted" ? null : "not-target",
    candidates: [],
    selectedCandidateBoxIndex: null,
    stateBefore: null,
    stateAfter: null,
  };
}

function createActiveChainFixture() {
  const fixture = createFixture(0);
  const firstFrame = createFrame(fixture, 1, 1_000);
  const secondFrame = createFrame(fixture, 2, 2_000);
  const firstObservation = createObservation(firstFrame);
  const secondObservation = createObservation(secondFrame);
  const confirmationId = createSpecialCoreIncidentConfirmationAttemptId(
    fixture.reset.id,
    1,
  );
  const activationId = createSpecialCoreIncidentActivationId(
    fixture.reset.id,
    1,
  );
  const confirmation: SpecialCoreIncidentConfirmationAttempt = {
    id: confirmationId,
    resetEpochId: fixture.reset.id,
    sequence: 1,
    kind: "new-activation",
    startedAt: firstFrame.sampledAt,
    lastObservedAt: secondFrame.sampledAt,
    observationIds: [firstObservation.id, secondObservation.id],
    status: "confirmed",
    activationId,
    endedAt: secondFrame.sampledAt,
    terminalReason: "confirmed",
  };
  const activation: SpecialCoreIncidentActivation = {
    id: activationId,
    resetEpochId: fixture.reset.id,
    sequence: 1,
    runtimeActivationId: 1,
    confirmationAttemptId: confirmation.id,
    confirmationKind: "new-activation",
    observationIds: [...confirmation.observationIds],
    startedAt: firstFrame.sampledAt,
    confirmedAt: secondFrame.sampledAt,
    lastSeenAt: secondFrame.sampledAt,
    timingConfigRevisionId: fixture.configuration.id,
    cooldownEndsAt: 181_000,
    alertDueAt: 176_000,
    status: "active",
    endedAt: null,
    terminalReason: null,
  };
  const schedule: SpecialCoreIncidentSchedule = {
    id: createSpecialCoreIncidentScheduleId(activation.id, 1),
    resetEpochId: fixture.reset.id,
    activationId: activation.id,
    sequence: 1,
    reason: "activation-confirmed",
    registeredAt: secondFrame.sampledAt,
    alertDueAt: activation.alertDueAt,
    timingConfigRevisionId: fixture.configuration.id,
    status: "registered",
    endedAt: null,
    outcomeReason: null,
  };
  return {
    ...fixture,
    firstFrame,
    secondFrame,
    firstObservation,
    secondObservation,
    confirmation,
    activation,
    schedule,
    pointers: {
      currentResetEpochId: fixture.reset.id,
      currentConfigurationRevisionId: fixture.configuration.id,
      latestFrameId: secondFrame.id,
      latestObservationId: secondObservation.id,
      activeConfirmationAttemptId: null,
      activeActivationId: activation.id,
      activeScheduleId: schedule.id,
      activeDecisionId: null,
      activePlaybackAttemptId: null,
    },
  };
}

function createMedia(
  frame: SpecialCoreIncidentFrame,
  reason: SpecialCoreIncidentMediaFrame["reason"],
  chars: number,
  id = `media:${frame.id}`,
): SpecialCoreIncidentMediaFrame {
  return {
    id,
    frameId: frame.id,
    resetEpochId: frame.resetEpochId,
    sampledAt: frame.sampledAt,
    reason,
    imageDataUrl: "x".repeat(chars),
  };
}

function createFramePatch(
  fixture: ReturnType<typeof createFixture>,
  frame: SpecialCoreIncidentFrame,
  media: SpecialCoreIncidentMediaFrame[],
) {
  return {
    pointers: {
      currentResetEpochId: fixture.reset.id,
      currentConfigurationRevisionId: fixture.configuration.id,
      latestFrameId: frame.id,
    },
    resetEpochs: [fixture.reset],
    configurationRevisions: [fixture.configuration],
    frames: [frame],
    media,
  };
}

function createEvent(
  fixture: ReturnType<typeof createFixture>,
  index: number,
  detail: string,
): SpecialCoreIncidentLifecycleEvent {
  return {
    id: `event-${index}`,
    resetEpochId: fixture.reset.id,
    occurredAt: index + 1,
    category: "recognition",
    action: "sampled",
    configRevisionId: fixture.configuration.id,
    frameId: null,
    observationId: null,
    confirmationAttemptId: null,
    activationId: null,
    scheduleId: null,
    decisionId: null,
    playbackAttemptId: null,
    details: { detail },
  };
}
