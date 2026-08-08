import { describe, expect, it } from "vitest";
import type { SpecialCoreReportIncidentSelection } from "./specialCoreIncidentEvidenceSelection";
import { createSpecialCoreIncidentReportEvidence } from "./specialCoreIncidentReportEvidence";
import {
  SPECIAL_CORE_INCIDENT_EVIDENCE_SCHEMA_VERSION,
  type FrozenSpecialCoreIncidentEvidence,
  type SpecialCoreIncidentConfigurationRevision,
  type SpecialCoreIncidentFrame,
  type SpecialCoreIncidentMediaFrame,
  type SpecialCoreIncidentResetEpoch,
} from "./specialCoreIncidentEvidenceTypes";

describe("createSpecialCoreIncidentReportEvidence", () => {
  it("projects only the selected playback and activation chain", () => {
    const evidence = createFrozenEvidence();
    const selection = createSelection({
      playbackAttemptIds: ["selected:playback"],
      mediaFrameIds: ["selected:frame:2"],
      relatedPlaybackIds: ["related:selected"],
    });

    const report = createSpecialCoreIncidentReportEvidence({
      evidence,
      selection,
    });

    expect(report.resetEpochs.map((entry) => entry.id)).toEqual([
      "selected:reset",
    ]);
    expect(report.configurations.map((entry) => entry.id)).toEqual([
      "selected:config",
    ]);
    expect(report.frames.map((entry) => entry.id)).toEqual([
      "selected:frame:1",
      "selected:frame:2",
    ]);
    expect(report.observations.map((entry) => entry.id)).toEqual([
      "selected:observation:1",
      "selected:observation:2",
    ]);
    expect(report.confirmationAttempts.map((entry) => entry.id)).toEqual([
      "selected:confirmation",
    ]);
    expect(report.activations.map((entry) => entry.id)).toEqual([
      "selected:activation",
    ]);
    expect(report.schedules.map((entry) => entry.id)).toEqual([
      "selected:schedule",
    ]);
    expect(report.decisions.map((entry) => entry.id)).toEqual([
      "selected:decision",
    ]);
    expect(report.playbackAttempts.map((entry) => entry.id)).toEqual([
      "selected:playback",
    ]);
    expect(report.lifecycle.map((entry) => entry.id)).toEqual([
      "selected:event",
    ]);
    expect(report.media.map((entry) => entry.frameId)).toEqual([
      "selected:frame:2",
    ]);
    expect(report.relatedPlayback.map((entry) => entry.id)).toEqual([
      "related:selected",
    ]);
    expect(report.selection.frameIds).toEqual([
      "selected:frame:1",
      "selected:frame:2",
    ]);
    expect(report.selection.configurationRevisionIds).toEqual([
      "selected:config",
    ]);
    expect(report.omissions.map((entry) => entry.id)).toEqual([
      "selected:omission",
    ]);
    expect(report.reportFrame).toBeNull();
  });

  it("does not pull an unrelated nearby activation, frame, or media", () => {
    const report = createSpecialCoreIncidentReportEvidence({
      evidence: createFrozenEvidence(),
      selection: createSelection({
        activationIds: ["selected:activation"],
        mediaFrameIds: ["selected:frame:2"],
      }),
    });

    expect(
      report.frames.every((entry) => entry.id.startsWith("selected:")),
    ).toBe(true);
    expect(
      report.activations.every((entry) => entry.id.startsWith("selected:")),
    ).toBe(true);
    expect(
      report.media.every((entry) => entry.id.startsWith("selected:")),
    ).toBe(true);
    expect(report.lifecycle.map((entry) => entry.id)).not.toContain(
      "unrelated:event",
    );
  });

  it("compacts selected media by priority and marks partial support", () => {
    const base = createFrozenEvidence();
    const frames = Array.from({ length: 8 }, (_, index) =>
      createFrame(
        `selected:media-frame:${index}`,
        base.resetEpochs[0]!,
        base.configurationRevisions[0]!,
        index + 10,
        5_000 + index,
      ),
    );
    const media = frames.map((frame, index) =>
      createMedia(
        frame,
        index === 0 ? "playback-failed" : "current",
      ),
    );
    const evidence: FrozenSpecialCoreIncidentEvidence = {
      ...base,
      frames: [...base.frames, ...frames],
      media: [...base.media, ...media],
    };
    const selection = createSelection({
      frameIds: frames.map((entry) => entry.id),
      mediaFrameIds: frames.map((entry) => entry.id),
    });

    const report = createSpecialCoreIncidentReportEvidence({
      evidence,
      selection,
    });

    expect(report.media).toHaveLength(6);
    expect(
      report.media.some((entry) => entry.reason === "playback-failed"),
    ).toBe(true);
    expect(report.selection.support).toBe("partial");
    expect(report.selection.degradationReasons).toContain(
      "payload-compacted",
    );
    expect(report.budget.droppedMediaFrameIds).toHaveLength(2);
    expect(report.omissions).toContainEqual(
      expect.objectContaining({
        reason: "payload-compacted",
        count: 2,
      }),
    );
  });
});

function createFrozenEvidence(): FrozenSpecialCoreIncidentEvidence {
  const selectedReset = createReset("selected", 1, 0);
  const selectedConfig = createConfiguration("selected", selectedReset, 0);
  const unrelatedReset = createReset("unrelated", 2, 2_000);
  const unrelatedConfig = createConfiguration(
    "unrelated",
    unrelatedReset,
    2_000,
  );
  const selected = createChain(
    "selected",
    selectedReset,
    selectedConfig,
    4_000,
  );
  const unrelated = createChain(
    "unrelated",
    unrelatedReset,
    unrelatedConfig,
    4_500,
  );

  return {
    schemaVersion: SPECIAL_CORE_INCIDENT_EVIDENCE_SCHEMA_VERSION,
    updatedAt: 10_000,
    pointers: {
      currentResetEpochId: selectedReset.id,
      currentConfigurationRevisionId: selectedConfig.id,
      latestFrameId: selected.secondFrame.id,
      latestObservationId: selected.secondObservation.id,
      activeConfirmationAttemptId: selected.confirmation.id,
      activeActivationId: selected.activation.id,
      activeScheduleId: selected.schedule.id,
      activeDecisionId: selected.decision.id,
      activePlaybackAttemptId: selected.playback.id,
    },
    resetEpochs: [selectedReset, unrelatedReset],
    configurationRevisions: [selectedConfig, unrelatedConfig],
    frames: [
      selected.firstFrame,
      selected.secondFrame,
      unrelated.firstFrame,
      unrelated.secondFrame,
    ],
    observations: [
      selected.firstObservation,
      selected.secondObservation,
      unrelated.firstObservation,
      unrelated.secondObservation,
    ],
    confirmationAttempts: [selected.confirmation, unrelated.confirmation],
    activations: [selected.activation, unrelated.activation],
    schedules: [selected.schedule, unrelated.schedule],
    decisions: [selected.decision, unrelated.decision],
    playbackAttempts: [selected.playback, unrelated.playback],
    lifecycleEvents: [selected.event, unrelated.event],
    media: [selected.media, unrelated.media],
    omissions: [
      {
        id: "selected:omission",
        occurredAt: 6_000,
        kind: "media",
        reason: "media-budget",
        subjectIds: [selected.secondFrame.id],
        count: 1,
      },
      {
        id: "unrelated:omission",
        occurredAt: 6_500,
        kind: "media",
        reason: "outside-retention",
        subjectIds: [unrelated.secondFrame.id],
        count: 1,
      },
    ],
    frozenAt: 10_000,
    leaseId: "selected:lease",
    lease: {
      id: "selected:lease",
      resetEpochId: selectedReset.id,
      configRevisionId: selectedConfig.id,
      sequence: 1,
      frozenAt: 10_000,
      leasedThroughFrameSequence: 2,
      layoutKey: "layout",
      sourceGeometryRevision: "1920x1080",
      confirmationAttemptId: selected.confirmation.id,
      activationId: selected.activation.id,
      scheduleId: selected.schedule.id,
      decisionId: selected.decision.id,
      playbackAttemptId: selected.playback.id,
    },
    frozenState: {
      capturedAt: 10_000,
      resetEpochId: selectedReset.id,
      configRevisionId: selectedConfig.id,
      enabled: true,
      status: "alerted",
      decision: "alert-fired",
      presentationRevision: "presentation:1",
      latestFrameId: selected.secondFrame.id,
      latestObservationId: selected.secondObservation.id,
      confirmationAttemptId: selected.confirmation.id,
      activationId: selected.activation.id,
      scheduleId: selected.schedule.id,
      decisionId: selected.decision.id,
      playbackAttemptId: selected.playback.id,
    },
    relatedPlayback: [
      {
        id: "related:selected",
        feature: "rune",
        requestedAt: 5_100,
        browserAcceptedAt: 5_110,
        finishedAt: 5_500,
        failedAt: null,
        status: "finished",
      },
      {
        id: "related:unrelated",
        feature: "skill",
        requestedAt: 5_200,
        browserAcceptedAt: 5_210,
        finishedAt: 5_600,
        failedAt: null,
        status: "finished",
      },
    ],
  };
}

function createReset(
  prefix: string,
  sequence: number,
  startedAt: number,
): SpecialCoreIncidentResetEpoch {
  return {
    id: `${prefix}:reset`,
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
}

function createConfiguration(
  prefix: string,
  reset: SpecialCoreIncidentResetEpoch,
  capturedAt: number,
): SpecialCoreIncidentConfigurationRevision {
  return {
    id: `${prefix}:config`,
    resetEpochId: reset.id,
    sequence: 1,
    capturedAt,
    fingerprint: `${prefix}:fingerprint`,
    timingFingerprint: `${prefix}:timing`,
    values: {
      enabled: true,
      cooldownSeconds: 30,
      alertLeadSeconds: 5,
      soundId: "sound",
      featureVolume: 1,
      masterVolume: 1,
      effectiveVolume: 1,
    },
  };
}

function createChain(
  prefix: string,
  reset: SpecialCoreIncidentResetEpoch,
  configuration: SpecialCoreIncidentConfigurationRevision,
  startedAt: number,
) {
  const firstFrame = createFrame(
    `${prefix}:frame:1`,
    reset,
    configuration,
    1,
    startedAt,
  );
  const secondFrame = createFrame(
    `${prefix}:frame:2`,
    reset,
    configuration,
    2,
    startedAt + 1_000,
  );
  const firstObservation = createObservation(
    `${prefix}:observation:1`,
    firstFrame,
  );
  const secondObservation = createObservation(
    `${prefix}:observation:2`,
    secondFrame,
  );
  const confirmation = {
    id: `${prefix}:confirmation`,
    resetEpochId: reset.id,
    sequence: 1,
    kind: "new-activation" as const,
    startedAt,
    lastObservedAt: startedAt + 1_000,
    observationIds: [firstObservation.id, secondObservation.id],
    status: "confirmed" as const,
    activationId: `${prefix}:activation`,
    endedAt: startedAt + 1_000,
    terminalReason: "confirmed" as const,
  };
  const activation = {
    id: `${prefix}:activation`,
    resetEpochId: reset.id,
    sequence: 1,
    runtimeActivationId: 1,
    confirmationAttemptId: confirmation.id,
    confirmationKind: "new-activation" as const,
    observationIds: [firstObservation.id, secondObservation.id],
    startedAt,
    confirmedAt: startedAt + 1_000,
    lastSeenAt: startedAt + 1_000,
    timingConfigRevisionId: configuration.id,
    cooldownEndsAt: startedAt + 30_000,
    alertDueAt: startedAt + 25_000,
    status: "active" as const,
    endedAt: null,
    terminalReason: null,
  };
  const schedule = {
    id: `${prefix}:schedule`,
    resetEpochId: reset.id,
    activationId: activation.id,
    sequence: 1,
    reason: "activation-confirmed" as const,
    registeredAt: startedAt + 1_000,
    alertDueAt: startedAt + 25_000,
    timingConfigRevisionId: configuration.id,
    status: "fired" as const,
    endedAt: startedAt + 1_100,
    outcomeReason: null,
  };
  const decision = {
    id: `${prefix}:decision`,
    resetEpochId: reset.id,
    activationId: activation.id,
    scheduleId: schedule.id,
    sequence: 1,
    occurredAt: startedAt + 1_100,
    dueAt: startedAt + 1_100,
    schedulerDelayMs: 0,
    timingConfigRevisionId: configuration.id,
    firedConfigRevisionId: configuration.id,
  };
  const playback = {
    id: `${prefix}:playback`,
    resetEpochId: reset.id,
    activationId: activation.id,
    scheduleId: schedule.id,
    decisionId: decision.id,
    sequence: 1,
    requestedAt: startedAt + 1_101,
    browserAcceptedAt: startedAt + 1_102,
    finishedAt: startedAt + 1_300,
    failedAt: null,
    status: "finished" as const,
    error: null,
    configRevisionId: configuration.id,
    soundId: "sound",
    featureVolume: 1,
    masterVolume: 1,
    effectiveVolume: 1,
    startOffsetSeconds: 0,
  };
  const event = {
    id: `${prefix}:event`,
    resetEpochId: reset.id,
    occurredAt: startedAt + 1_102,
    category: "playback" as const,
    action: "playback-finished",
    configRevisionId: configuration.id,
    frameId: secondFrame.id,
    observationId: secondObservation.id,
    confirmationAttemptId: confirmation.id,
    activationId: activation.id,
    scheduleId: schedule.id,
    decisionId: decision.id,
    playbackAttemptId: playback.id,
    details: {},
  };
  return {
    firstFrame,
    secondFrame,
    firstObservation,
    secondObservation,
    confirmation,
    activation,
    schedule,
    decision,
    playback,
    event,
    media: createMedia(secondFrame, "activation-confirmation"),
  };
}

function createFrame(
  id: string,
  reset: SpecialCoreIncidentResetEpoch,
  configuration: SpecialCoreIncidentConfigurationRevision,
  sequence: number,
  sampledAt: number,
): SpecialCoreIncidentFrame {
  return {
    id,
    resetEpochId: reset.id,
    configRevisionId: configuration.id,
    sequence,
    sampledAt,
    layoutKey: reset.continuity.layoutKey,
    sourceGeometryRevision: reset.continuity.sourceGeometryRevision,
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

function createObservation(id: string, frame: SpecialCoreIncidentFrame) {
  return {
    id,
    resetEpochId: frame.resetEpochId,
    frameId: frame.id,
    frameSequence: frame.sequence,
    configRevisionId: frame.configRevisionId,
    sampledAt: frame.sampledAt,
    decision: "accepted" as const,
    reason: null,
    candidates: [],
    selectedCandidateBoxIndex: null,
    stateBefore: null,
    stateAfter: null,
  };
}

function createMedia(
  frame: SpecialCoreIncidentFrame,
  reason: SpecialCoreIncidentMediaFrame["reason"],
): SpecialCoreIncidentMediaFrame {
  return {
    id: `${frame.id}:media`,
    frameId: frame.id,
    resetEpochId: frame.resetEpochId,
    sampledAt: frame.sampledAt,
    reason,
    imageDataUrl: `data:image/png;base64,${frame.id}`,
  };
}

function createSelection(
  overrides: Partial<SpecialCoreReportIncidentSelection> = {},
): SpecialCoreReportIncidentSelection {
  return {
    policy: "special-core-scenario-selection-v1",
    status: "matched",
    support: "definitive",
    anchorKind: "playback-attempt",
    selectedEventAt: 5_102,
    resetEpochId: "selected:reset",
    candidateIds: [],
    frameIds: [],
    observationIds: [],
    confirmationAttemptIds: [],
    activationIds: [],
    scheduleIds: [],
    decisionIds: [],
    playbackAttemptIds: [],
    eventIds: [],
    configurationRevisionIds: [],
    mediaFrameIds: [],
    relatedPlaybackIds: [],
    ambiguous: false,
    operatorConclusion: "browser-playback-accepted",
    physicalAudibility: "unknown",
    degradationReasons: [],
    ...overrides,
  };
}
