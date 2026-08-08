import { describe, expect, it } from "vitest";
import type {
  AlertIssueOtherCategory,
  AlertIssueScenario,
} from "../../../contracts/reporting/alertIssueScenario";
import {
  createBoosterExpiryIncidentEvidenceArchive,
  freezeBoosterExpiryIncidentEvidence,
} from "./boosterExpiryIncidentEvidenceArchive";
import {
  selectBoosterExpiryReportIncident,
  type BoosterExpiryIncidentOperatorConclusion,
} from "./boosterExpiryIncidentEvidenceSelection";
import type {
  BoosterExpiryIncidentAlertDecision,
  BoosterExpiryIncidentCandidateAttempt,
  BoosterExpiryIncidentConfigurationRevision,
  BoosterExpiryIncidentConfirmedCycle,
  BoosterExpiryIncidentEvidenceArchive,
  BoosterExpiryIncidentFlowEpoch,
  BoosterExpiryIncidentFrame,
  BoosterExpiryIncidentFrozenState,
  BoosterExpiryIncidentLifecycleEvent,
  BoosterExpiryIncidentMediaFrame,
  BoosterExpiryIncidentObservation,
  BoosterExpiryIncidentPlaybackAttempt,
  BoosterExpiryIncidentRelatedPlayback,
  BoosterExpiryIncidentReportLease,
  BoosterExpiryIncidentResetEpoch,
  BoosterExpiryIncidentSchedule,
  FrozenBoosterExpiryIncidentEvidence,
} from "./boosterExpiryIncidentEvidenceTypes";

const FROZEN_AT = 100_000;

type ScenarioFixture = {
  reason: string;
  scenario: AlertIssueScenario;
  otherCategory?: AlertIssueOtherCategory | null;
  expected: BoosterExpiryIncidentOperatorConclusion;
};

const SCENARIO_FIXTURES: Record<string, ScenarioFixture> = {
  B1: {
    reason: "booster-expiry-missed",
    scenario: "not-recognized",
    expected: "recognition-rejected",
  },
  B2: {
    reason: "booster-expiry-missed",
    scenario: "wrong-value",
    expected: "flow-substitution-found",
  },
  B3: {
    reason: "booster-expiry-missed",
    scenario: "recognized-no-alert",
    expected: "decision-suppressed",
  },
  B4: {
    reason: "booster-expiry-missed",
    scenario: "playback-missing",
    expected: "decision-without-playback",
  },
  B5: {
    reason: "booster-expiry-false-alert",
    scenario: "wrong-target",
    expected: "false-cycle-chain-found",
  },
  B6: {
    reason: "booster-expiry-false-alert",
    scenario: "duplicate-alert",
    expected: "valid-new-cycle-found",
  },
  B7: {
    reason: "booster-expiry-false-alert",
    scenario: "unexpected-playback",
    expected: "unexpected-booster-playback-found",
  },
  B8: {
    reason: "booster-expiry-reading",
    scenario: "wrong-target",
    expected: "wrong-target-observation-found",
  },
  B9: {
    reason: "booster-expiry-reading",
    scenario: "wrong-value",
    expected: "flow-substitution-found",
  },
  B10: {
    reason: "booster-expiry-reading",
    scenario: "unstable-value",
    expected: "unstable-sequence-found",
  },
  B11: {
    reason: "other",
    scenario: "other",
    otherCategory: "status-display",
    expected: "presentation-event-found",
  },
  B12: {
    reason: "other",
    scenario: "other",
    otherCategory: "sound-volume",
    expected: "audio-configuration-found",
  },
  B13: {
    reason: "other",
    scenario: "other",
    otherCategory: "settings-preset",
    expected: "configuration-transition-found",
  },
  B14: {
    reason: "other",
    scenario: "other",
    otherCategory: "performance-error",
    expected: "runtime-error-found",
  },
  B15: {
    reason: "other",
    scenario: "other",
    otherCategory: "interaction",
    expected: "interaction-event-found",
  },
  B16: {
    reason: "other",
    scenario: "other",
    otherCategory: "other",
    expected: "unsupported-other",
  },
};

describe("booster expiry incident evidence selection", () => {
  for (const [id, fixture] of Object.entries(SCENARIO_FIXTURES)) {
    it(`selects ${id} with an explicit operator conclusion`, () => {
      const evidence = createScenarioEvidence(id);
      const selection = selectBoosterExpiryReportIncident({
        evidence,
        reason: fixture.reason,
        scenario: fixture.scenario,
        occurrence: "current",
        otherCategory: fixture.otherCategory,
      });

      expect(selection.operatorConclusion).toBe(fixture.expected);
      expect(selection.resetEpochId).toBe(evidence.lease.resetEpochId);
      if (id === "B16") {
        expect(selection.support).toBe("unsupported");
      } else {
        expect(selection.anchorKind).not.toBeNull();
        expect(selection.candidateIds.length).toBeGreaterThan(0);
      }
    });
  }

  it("keeps current and recent windows disjoint at exact 10/60 second boundaries", () => {
    const archive = createBaseArchive();
    for (const [sequence, sampledAt] of [
      [1, FROZEN_AT - 60_000],
      [2, FROZEN_AT - 10_001],
      [3, FROZEN_AT - 10_000],
    ] as const) {
      const frame = createFrame(archive, sequence, sampledAt);
      archive.frames.push(frame);
      archive.observations.push(createObservation(frame, "rejected"));
    }
    const evidence = freezeArchive(archive);

    const current = selectScenario(
      evidence,
      "booster-expiry-missed",
      "not-recognized",
      "current",
    );
    expect(current.selectedEventAt).toBe(FROZEN_AT - 10_000);
    expect(current.candidateIds).toHaveLength(1);

    const recent = selectScenario(
      evidence,
      "booster-expiry-missed",
      "not-recognized",
      "recent",
    );
    expect(recent.selectedEventAt).toBe(FROZEN_AT - 10_001);
    expect(recent.candidateIds).toHaveLength(2);

    expect(
      selectScenario(
        evidence,
        "booster-expiry-missed",
        "not-recognized",
        "historical",
      ).status,
    ).toBe("outside-retention");
  });

  it("freezes a detached lease and excludes later frames, resets, and playback transitions", () => {
    const archive = createBaseArchive();
    const chain = createCycleChain(archive, 1, FROZEN_AT - 7_000, {
      decision: true,
      playbackStatus: "requested",
    });
    appendChain(archive, chain);
    const lease = createLease(archive, chain);
    const frozen = freezeBoosterExpiryIncidentEvidence({
      archive,
      lease,
      frozenState: createFrozenState(archive, lease),
    });
    const serialized = JSON.stringify(frozen);

    const lateFrame = createFrame(archive, 99, FROZEN_AT + 1);
    archive.frames.push(lateFrame);
    archive.observations.push(createObservation(lateFrame, "accepted"));
    archive.resetEpochs.push(createReset(2, FROZEN_AT + 1));
    chain.playback!.browserAcceptedAt = FROZEN_AT + 2;
    chain.playback!.status = "browser-play-accepted";

    expect(JSON.stringify(frozen)).toBe(serialized);
    expect(frozen.frames.some((entry) => entry.id === lateFrame.id)).toBe(
      false,
    );
    expect(frozen.resetEpochs).toHaveLength(1);
    expect(frozen.playbackAttempts[0]?.status).toBe("requested");
    expect(frozen).not.toBe(archive);
  });

  it("reuses the same detached value for upload retries", () => {
    const archive = createBaseArchive();
    const frame = createFrame(archive, 1, FROZEN_AT - 500);
    archive.frames.push(frame);
    archive.observations.push(createObservation(frame, "rejected"));
    const frozen = freezeArchive(archive);
    const firstAttempt = JSON.stringify(frozen);

    archive.observations[0]!.reason = "mutated-after-open";
    archive.frames.push(createFrame(archive, 2, FROZEN_AT + 1));
    const retryAttempt = JSON.stringify(frozen);

    expect(retryAttempt).toBe(firstAttempt);
    expect(retryAttempt).not.toContain("mutated-after-open");
  });

  it("removes frozen presentation pointers that refer to post-open records", () => {
    const archive = createBaseArchive();
    const current = createFrame(archive, 1, FROZEN_AT - 1);
    const future = createFrame(archive, 2, FROZEN_AT + 1);
    archive.frames.push(current, future);
    archive.observations.push(
      createObservation(current, "accepted"),
      createObservation(future, "accepted"),
    );
    const lease = createLease(archive);
    const frozenState = createFrozenState(archive, lease);

    const frozen = freezeBoosterExpiryIncidentEvidence({
      archive,
      lease,
      frozenState,
    });
    expect(frozen.frames.map((entry) => entry.id)).toEqual([current.id]);
    expect(frozen.frozenState?.latestFrameId).toBeNull();
    expect(frozen.frozenState?.latestObservationId).toBeNull();
  });

  it("keeps adjacent cycle identities separate and expands only ID-linked chains", () => {
    const archive = createBaseArchive();
    const first = createCycleChain(archive, 1, FROZEN_AT - 15_000, {
      decision: true,
      playbackStatus: "finished",
      expiresAt: 180_000,
    });
    const second = createCycleChain(archive, 2, FROZEN_AT - 7_000, {
      decision: true,
      playbackStatus: "finished",
      expiresAt: 185_000,
    });
    appendChain(archive, first);
    appendChain(archive, second);
    const evidence = freezeArchive(archive, second);

    const selection = selectScenario(
      evidence,
      "booster-expiry-false-alert",
      "duplicate-alert",
    );
    expect(selection.operatorConclusion).toBe("valid-new-cycle-found");
    expect(selection.cycleIds).toEqual([first.cycle.id, second.cycle.id]);
    expect(selection.decisionIds).toEqual([
      first.decision!.id,
      second.decision!.id,
    ]);
    expect(new Set(selection.observationIds).size).toBe(12);
  });

  it("marks equal-time independent incidents as ambiguous instead of guessing", () => {
    const archive = createBaseArchive();
    const firstFrame = createFrame(archive, 1, FROZEN_AT - 500);
    const secondFrame = createFrame(archive, 2, FROZEN_AT - 500);
    archive.frames.push(firstFrame, secondFrame);
    archive.observations.push(
      createObservation(firstFrame, "rejected"),
      createObservation(secondFrame, "rejected"),
    );
    const evidence = freezeArchive(archive);

    const selection = selectScenario(
      evidence,
      "booster-expiry-missed",
      "not-recognized",
    );
    expect(selection.ambiguous).toBe(true);
    expect(selection.operatorConclusion).toBe("ambiguous-incident");
    expect(selection.degradationReasons).toContain("ambiguous-incident");
  });

  it("reports selected media loss without discarding the compact decision chain", () => {
    const archive = createBaseArchive();
    const chain = createCycleChain(archive, 1, FROZEN_AT - 7_000, {
      decision: true,
    });
    appendChain(archive, chain);
    archive.omissions.push({
      id: "omission:media",
      occurredAt: FROZEN_AT - 100,
      kind: "media",
      reason: "media-budget",
      subjectIds: [chain.frames[5]!.id],
      count: 1,
    });
    const evidence = freezeArchive(archive, chain);

    const selection = selectScenario(
      evidence,
      "booster-expiry-false-alert",
      "wrong-target",
    );
    expect(selection.cycleIds).toEqual([chain.cycle.id]);
    expect(selection.mediaFrameIds).toEqual([]);
    expect(selection.support).toBe("partial");
    expect(selection.degradationReasons).toEqual(
      expect.arrayContaining(["media-budget", "selected-media-missing"]),
    );
  });

  it("scopes related playback to the frozen retention window", () => {
    const archive = createBaseArchive();
    const related = [
      createRelatedPlayback("skill", FROZEN_AT - 500),
      createRelatedPlayback("rune", FROZEN_AT - 60_003),
      createRelatedPlayback("hunt-stall", FROZEN_AT + 1),
    ];
    const evidence = freezeArchive(archive, undefined, related);
    expect(evidence.relatedPlayback.map((entry) => entry.feature)).toEqual([
      "skill",
    ]);

    const selection = selectScenario(
      evidence,
      "booster-expiry-false-alert",
      "unexpected-playback",
    );
    expect(selection.operatorConclusion).toBe(
      "unrelated-feature-playback-found",
    );
    expect(selection.relatedPlaybackIds).toEqual([related[0]!.id]);
  });

  it("does not promote malformed or legacy payloads to selected evidence", () => {
    expect(
      selectBoosterExpiryReportIncident({
        evidence: { schemaVersion: "legacy" },
        reason: "booster-expiry-missed",
        scenario: "not-recognized",
        occurrence: "current",
      }),
    ).toMatchObject({
      status: "unavailable",
      operatorConclusion: "legacy-evidence-unavailable",
      degradationReasons: ["legacy-unavailable"],
    });
    expect(
      selectBoosterExpiryReportIncident({
        evidence: null,
        reason: "booster-expiry-missed",
        scenario: "not-recognized",
        occurrence: "current",
      }),
    ).toMatchObject({
      status: "unavailable",
      operatorConclusion: "evidence-unavailable",
    });
  });

  it("treats browser-accepted playback as partial because physical audibility is unknowable", () => {
    const archive = createBaseArchive();
    const chain = createCycleChain(archive, 1, FROZEN_AT - 7_000, {
      decision: true,
      playbackStatus: "finished",
    });
    appendChain(archive, chain);
    const evidence = freezeArchive(archive, chain);

    const selection = selectScenario(
      evidence,
      "booster-expiry-missed",
      "playback-missing",
    );
    expect(selection.operatorConclusion).toBe(
      "physical-audibility-unverifiable",
    );
    expect(selection.support).toBe("partial");
    expect(selection.physicalAudibility).toBe("unknown");
  });
});

function createScenarioEvidence(
  id: string,
): FrozenBoosterExpiryIncidentEvidence {
  const archive = createBaseArchive();
  if (id === "B1") {
    const frame = createFrame(archive, 1, FROZEN_AT - 500);
    archive.frames.push(frame);
    archive.observations.push(createObservation(frame, "rejected"));
    return freezeArchive(archive);
  }
  if (id === "B2" || id === "B9") {
    const frame = createFrame(archive, 1, FROZEN_AT - 500);
    archive.frames.push(frame);
    archive.observations.push(
      createObservation(frame, "accepted", {
        rawSeconds: 83,
        selectedSeconds: 78,
      }),
    );
    return freezeArchive(archive);
  }
  if (id === "B3") {
    const chain = createCycleChain(archive, 1, FROZEN_AT - 7_000, {
      scheduleStatus: "suppressed",
    });
    appendChain(archive, chain);
    return freezeArchive(archive, chain);
  }
  if (id === "B4") {
    const chain = createCycleChain(archive, 1, FROZEN_AT - 7_000, {
      decision: true,
    });
    appendChain(archive, chain);
    return freezeArchive(archive, chain);
  }
  if (id === "B5" || id === "B8") {
    const chain = createCycleChain(archive, 1, FROZEN_AT - 7_000, {
      decision: id === "B5",
    });
    appendChain(archive, chain);
    archive.media.push(...chain.frames.map(createMedia));
    return freezeArchive(archive, chain);
  }
  if (id === "B6") {
    const first = createCycleChain(archive, 1, FROZEN_AT - 15_000, {
      decision: true,
      expiresAt: 180_000,
    });
    const second = createCycleChain(archive, 2, FROZEN_AT - 7_000, {
      decision: true,
      expiresAt: 185_000,
    });
    appendChain(archive, first);
    appendChain(archive, second);
    return freezeArchive(archive, second);
  }
  if (id === "B7") {
    const chain = createCycleChain(archive, 1, FROZEN_AT - 7_000, {
      decision: true,
      playbackStatus: "requested",
    });
    appendChain(archive, chain);
    return freezeArchive(archive, chain);
  }
  if (id === "B10") {
    const chain = createCycleChain(archive, 1, FROZEN_AT - 7_000, {
      candidateOnly: true,
    });
    appendChain(archive, chain);
    return freezeArchive(archive, chain);
  }
  if (["B11", "B13", "B14", "B15"].includes(id)) {
    const category =
      id === "B11"
        ? "presentation"
        : id === "B13"
          ? "configuration"
          : id === "B14"
            ? "runtime-error"
            : "interaction";
    archive.lifecycleEvents.push(createEvent(archive, id, category));
    return freezeArchive(archive);
  }
  if (id === "B12") {
    const chain = createCycleChain(archive, 1, FROZEN_AT - 7_000, {
      decision: true,
      playbackStatus: "requested",
    });
    appendChain(archive, chain);
    return freezeArchive(archive, chain);
  }
  return freezeArchive(archive);
}

function createBaseArchive(): BoosterExpiryIncidentEvidenceArchive {
  const archive = createBoosterExpiryIncidentEvidenceArchive(FROZEN_AT);
  const reset = createReset(1, 1);
  const configuration = createConfiguration(reset);
  const flow = createFlow(reset);
  archive.resetEpochs.push(reset);
  archive.configurationRevisions.push(configuration);
  archive.flowEpochs.push(flow);
  archive.pointers = {
    currentResetEpochId: reset.id,
    currentConfigurationRevisionId: configuration.id,
    currentFlowEpochId: flow.id,
    latestFrameId: null,
    latestObservationId: null,
    activeCandidateAttemptId: null,
    activeCycleId: null,
    activeScheduleId: null,
    activeDecisionId: null,
    activePlaybackAttemptId: null,
  };
  return archive;
}

function createReset(
  sequence: number,
  startedAt: number,
): BoosterExpiryIncidentResetEpoch {
  return {
    id: `reset:${sequence}`,
    sessionId: "session:1",
    sequence,
    startedAt,
    reason: sequence === 1 ? "initialized" : "layout-changed",
    continuity: {
      captureGeneration: sequence,
      featureGeneration: sequence,
      monitoringGeneration: sequence,
      layoutKey: `layout:${sequence}`,
      sourceGeometryRevision: `geometry:${sequence}`,
    },
  };
}

function createConfiguration(
  reset: BoosterExpiryIncidentResetEpoch,
): BoosterExpiryIncidentConfigurationRevision {
  return {
    id: `config:${reset.id}:1`,
    resetEpochId: reset.id,
    sequence: 1,
    capturedAt: reset.startedAt,
    fingerprint: "all:1",
    timingFingerprint: "timing:1",
    playbackFingerprint: "playback:1",
    values: {
      enabled: true,
      alertLeadSeconds: 5,
      soundId: "sound:1",
      featureVolume: 1,
      masterVolume: 1,
      effectiveVolume: 1,
    },
  };
}

function createFlow(
  reset: BoosterExpiryIncidentResetEpoch,
): BoosterExpiryIncidentFlowEpoch {
  return {
    id: `flow:${reset.id}:1`,
    resetEpochId: reset.id,
    sequence: 1,
    workerGeneration: 1,
    startedAt: reset.startedAt,
    reason: "initialized",
  };
}

function createFrame(
  archive: BoosterExpiryIncidentEvidenceArchive,
  sequence: number,
  sampledAt: number,
): BoosterExpiryIncidentFrame {
  const reset = archive.resetEpochs[0]!;
  const flow = archive.flowEpochs[0]!;
  const config = archive.configurationRevisions[0]!;
  return {
    id: `frame:${reset.id}:${sequence}`,
    resetEpochId: reset.id,
    flowEpochId: flow.id,
    configRevisionId: config.id,
    sequence,
    sampledAt,
    layoutKey: reset.continuity.layoutKey,
    sourceGeometryRevision: reset.continuity.sourceGeometryRevision,
    source: {
      kind: "normal-monitoring-top-quarter",
      coordinateSpace: "capture-pixels",
      sourceDimensions: { width: 1280, height: 800 },
      sampledRegion: { x: 0, y: 0, width: 1280, height: 200 },
      maxCaptureWidth: 1280,
      regionLabel: "top-quarter",
    },
    runtimeFailure: null,
    mediaFrameId: null,
  };
}

function createObservation(
  frame: BoosterExpiryIncidentFrame,
  decision: BoosterExpiryIncidentObservation["decision"],
  values: { rawSeconds?: number; selectedSeconds?: number } = {},
): BoosterExpiryIncidentObservation {
  const rawSeconds = values.rawSeconds ?? 120;
  const selectedSeconds = values.selectedSeconds ?? rawSeconds;
  const hasRead = decision !== "missing" && decision !== "error";
  return {
    id: `observation:${frame.id}`,
    resetEpochId: frame.resetEpochId,
    flowEpochId: frame.flowEpochId,
    frameId: frame.id,
    frameSequence: frame.sequence,
    configRevisionId: frame.configRevisionId,
    sampledAt: frame.sampledAt,
    decision,
    reason: decision === "rejected" ? "digit-gate-reject" : null,
    recognizerVersion: "booster-test-v1",
    rawTime: hasRead ? createTimerRead(rawSeconds) : null,
    selectedTime: hasRead ? createTimerRead(selectedSeconds) : null,
    timerRect: hasRead ? { x: 10, y: 10, width: 80, height: 20 } : null,
    timerCandidateCount: hasRead ? 1 : 0,
    timerMatchCount: hasRead ? 1 : 0,
    flow: hasRead
      ? {
          locked: true,
          source: rawSeconds === selectedSeconds ? "raw-lock" : "predicted",
          predictedSeconds: selectedSeconds,
          rawDeltaSeconds: rawSeconds - selectedSeconds,
        }
      : null,
    strongForConfirmation: decision === "accepted",
    observedExpiresAt:
      decision === "accepted"
        ? frame.sampledAt + selectedSeconds * 1_000
        : null,
    recognitionMs: 3,
    totalMs: 5,
    stateBefore: createRuntimeState(frame.sampledAt - 1, rawSeconds + 1),
    stateAfter: createRuntimeState(frame.sampledAt, selectedSeconds),
  };
}

function createTimerRead(seconds: number) {
  return {
    ok: true,
    reason: "accepted",
    text: `00:${String(seconds % 60).padStart(2, "0")}`,
    seconds,
    format: "mm:ss",
    selectedBy: "best-score",
    rect: { x: 10, y: 10, width: 80, height: 20 },
    digitCount: 4,
  };
}

function createRuntimeState(capturedAt: number, remainingSeconds: number) {
  return {
    capturedAt,
    status: "tracking",
    decision: "accepted",
    rawRemainingSeconds: remainingSeconds,
    remainingSeconds,
    candidateObservationCount: 1,
    confirmedExpiresAt: null,
    alertAt: null,
    alertedAt: null,
    flowSource: "raw-lock",
    locked: true,
  };
}

function createCycleChain(
  archive: BoosterExpiryIncidentEvidenceArchive,
  sequence: number,
  startedAt: number,
  options: {
    candidateOnly?: boolean;
    scheduleStatus?: BoosterExpiryIncidentSchedule["status"];
    decision?: boolean;
    playbackStatus?: BoosterExpiryIncidentPlaybackAttempt["status"];
    expiresAt?: number;
  } = {},
) {
  const frameBase = sequence * 10;
  const frames = Array.from({ length: 6 }, (_, index) =>
    createFrame(archive, frameBase + index + 1, startedAt + index * 1_000),
  );
  const expiresAt = options.expiresAt ?? startedAt + 120_000;
  const observations = frames.map((frame, index) => {
    const remaining = Math.round((expiresAt - frame.sampledAt) / 1_000);
    return createObservation(frame, "accepted", {
      rawSeconds: remaining,
      selectedSeconds: remaining,
    });
  });
  const reset = archive.resetEpochs[0]!;
  const flow = archive.flowEpochs[0]!;
  const config = archive.configurationRevisions[0]!;
  const candidate: BoosterExpiryIncidentCandidateAttempt = {
    id: `candidate:${reset.id}:${sequence}`,
    resetEpochId: reset.id,
    flowEpochId: flow.id,
    sequence,
    startedAt,
    lastObservedAt: frames[5]!.sampledAt,
    observationIds: observations.map((entry) => entry.id),
    firstRemainingSeconds: observations[0]!.selectedTime!.seconds!,
    lastRemainingSeconds: observations[5]!.selectedTime!.seconds!,
    expiresAt,
    expiresAtMin: expiresAt,
    expiresAtMax: expiresAt,
    status: options.candidateOnly ? "rejected" : "confirmed",
    confirmedCycleId: options.candidateOnly
      ? null
      : `cycle:${reset.id}:${sequence}`,
    endedAt: frames[5]!.sampledAt,
    terminalReason: options.candidateOnly ? "incompatible-expiry" : "confirmed",
  };
  const cycle: BoosterExpiryIncidentConfirmedCycle = {
    id: `cycle:${reset.id}:${sequence}`,
    resetEpochId: reset.id,
    sequence,
    candidateAttemptId: candidate.id,
    confirmationFlowEpochId: flow.id,
    observationIds: [...candidate.observationIds],
    confirmedAt: frames[5]!.sampledAt,
    expiresAt,
    timingConfigRevisionId: config.id,
    lastSupportedAt: frames[5]!.sampledAt,
    contradictionCount: 0,
    status: "active",
    endedAt: null,
    terminalReason: null,
  };
  const scheduleStatus =
    options.scheduleStatus ?? (options.decision ? "fired" : "registered");
  const schedule: BoosterExpiryIncidentSchedule = {
    id: `schedule:${cycle.id}:1`,
    resetEpochId: reset.id,
    cycleId: cycle.id,
    sequence: 1,
    reason: "cycle-confirmed",
    registeredAt: cycle.confirmedAt,
    alertDueAt: expiresAt - 5_000,
    confirmedExpiresAt: expiresAt,
    timingConfigRevisionId: config.id,
    status: scheduleStatus,
    endedAt: scheduleStatus === "registered" ? null : FROZEN_AT - 500,
    outcomeReason: scheduleStatus === "suppressed" ? "global-disabled" : null,
  };
  const decision: BoosterExpiryIncidentAlertDecision | null = options.decision
    ? {
        id: `decision:${cycle.id}:1`,
        resetEpochId: reset.id,
        cycleId: cycle.id,
        scheduleId: schedule.id,
        sequence: 1,
        occurredAt: FROZEN_AT - 500 + sequence,
        dueAt: FROZEN_AT - 500,
        schedulerDelayMs: sequence,
        timingConfigRevisionId: config.id,
        firedConfigRevisionId: config.id,
      }
    : null;
  const playback =
    decision && options.playbackStatus
      ? createPlayback(cycle, schedule, decision, options.playbackStatus)
      : null;
  return {
    frames,
    observations,
    candidate,
    cycle,
    schedule,
    decision,
    playback,
  };
}

function createPlayback(
  cycle: BoosterExpiryIncidentConfirmedCycle,
  schedule: BoosterExpiryIncidentSchedule,
  decision: BoosterExpiryIncidentAlertDecision,
  status: BoosterExpiryIncidentPlaybackAttempt["status"],
): BoosterExpiryIncidentPlaybackAttempt {
  const accepted = status === "browser-play-accepted" || status === "finished";
  return {
    id: `playback:${cycle.id}:1`,
    resetEpochId: cycle.resetEpochId,
    cycleId: cycle.id,
    scheduleId: schedule.id,
    decisionId: decision.id,
    sequence: 1,
    requestedAt: decision.occurredAt + 1,
    browserAcceptedAt: accepted ? decision.occurredAt + 2 : null,
    finishedAt: status === "finished" ? decision.occurredAt + 200 : null,
    failedAt: status === "failed" ? decision.occurredAt + 2 : null,
    status,
    error: status === "failed" ? "NotAllowedError" : null,
    configRevisionId: decision.firedConfigRevisionId,
    soundId: "sound:1",
    featureVolume: 1,
    masterVolume: 1,
    effectiveVolume: 1,
  };
}

function appendChain(
  archive: BoosterExpiryIncidentEvidenceArchive,
  chain: ReturnType<typeof createCycleChain>,
): void {
  archive.frames.push(...chain.frames);
  archive.observations.push(...chain.observations);
  archive.candidateAttempts.push(chain.candidate);
  if (!chain.candidate.confirmedCycleId) return;
  archive.cycles.push(chain.cycle);
  archive.schedules.push(chain.schedule);
  if (chain.decision) archive.decisions.push(chain.decision);
  if (chain.playback) archive.playbackAttempts.push(chain.playback);
}

function createMedia(
  frame: BoosterExpiryIncidentFrame,
): BoosterExpiryIncidentMediaFrame {
  return {
    id: `media:${frame.id}`,
    frameId: frame.id,
    resetEpochId: frame.resetEpochId,
    sampledAt: frame.sampledAt,
    reason: "cycle-confirmation",
    imageDataUrl: "data:image/png;base64,AAAA",
  };
}

function createEvent(
  archive: BoosterExpiryIncidentEvidenceArchive,
  id: string,
  category: BoosterExpiryIncidentLifecycleEvent["category"],
): BoosterExpiryIncidentLifecycleEvent {
  return {
    id: `event:${id}`,
    resetEpochId: archive.resetEpochs[0]!.id,
    occurredAt: FROZEN_AT - 100,
    category,
    action: `${category}-test`,
    configRevisionId: archive.configurationRevisions[0]!.id,
    flowEpochId: archive.flowEpochs[0]!.id,
    frameId: null,
    observationId: null,
    candidateAttemptId: null,
    cycleId: null,
    scheduleId: null,
    decisionId: null,
    playbackAttemptId: null,
    details: {},
  };
}

function createRelatedPlayback(
  feature: string,
  requestedAt: number,
): BoosterExpiryIncidentRelatedPlayback {
  return {
    id: `related:${feature}:${requestedAt}`,
    feature,
    requestedAt,
    browserAcceptedAt: requestedAt + 1,
    finishedAt: requestedAt + 2,
    failedAt: null,
    status: "finished",
  };
}

function createLease(
  archive: BoosterExpiryIncidentEvidenceArchive,
  selected?: Partial<ReturnType<typeof createCycleChain>>,
): BoosterExpiryIncidentReportLease {
  const reset = archive.resetEpochs[0]!;
  const config = archive.configurationRevisions[0]!;
  const flow = archive.flowEpochs[0]!;
  return {
    id: "lease:1",
    resetEpochId: reset.id,
    flowEpochId: flow.id,
    configRevisionId: config.id,
    sequence: 1,
    frozenAt: FROZEN_AT,
    leasedThroughFrameSequence: Math.max(
      0,
      ...archive.frames
        .filter((entry) => entry.resetEpochId === reset.id)
        .map((entry) => entry.sequence),
    ),
    layoutKey: reset.continuity.layoutKey,
    sourceGeometryRevision: reset.continuity.sourceGeometryRevision,
    candidateAttemptId: selected?.candidate?.id ?? null,
    cycleId: selected?.cycle?.id ?? null,
    scheduleId: selected?.schedule?.id ?? null,
    decisionId: selected?.decision?.id ?? null,
    playbackAttemptId: selected?.playback?.id ?? null,
  };
}

function createFrozenState(
  archive: BoosterExpiryIncidentEvidenceArchive,
  lease: BoosterExpiryIncidentReportLease,
): BoosterExpiryIncidentFrozenState {
  return {
    capturedAt: lease.frozenAt,
    resetEpochId: lease.resetEpochId,
    flowEpochId: lease.flowEpochId,
    configRevisionId: lease.configRevisionId,
    enabled: true,
    status: "ready",
    decision: "waiting",
    presentationRevision: "presentation:1",
    latestFrameId: archive.frames[archive.frames.length - 1]?.id ?? null,
    latestObservationId:
      archive.observations[archive.observations.length - 1]?.id ?? null,
    candidateAttemptId: lease.candidateAttemptId,
    cycleId: lease.cycleId,
    scheduleId: lease.scheduleId,
    decisionId: lease.decisionId,
    playbackAttemptId: lease.playbackAttemptId,
  };
}

function freezeArchive(
  archive: BoosterExpiryIncidentEvidenceArchive,
  selected?: Partial<ReturnType<typeof createCycleChain>>,
  relatedPlayback: BoosterExpiryIncidentRelatedPlayback[] = [],
): FrozenBoosterExpiryIncidentEvidence {
  const lease = createLease(archive, selected);
  return freezeBoosterExpiryIncidentEvidence({
    archive,
    lease,
    frozenState: createFrozenState(archive, lease),
    relatedPlayback,
  });
}

function selectScenario(
  evidence: FrozenBoosterExpiryIncidentEvidence,
  reason: string,
  scenario: AlertIssueScenario,
  occurrence: "current" | "recent" | "historical" = "current",
  otherCategory: AlertIssueOtherCategory | null = null,
) {
  return selectBoosterExpiryReportIncident({
    evidence,
    reason,
    scenario,
    occurrence,
    otherCategory,
  });
}
