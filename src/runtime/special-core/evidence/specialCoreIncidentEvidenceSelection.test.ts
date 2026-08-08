import { describe, expect, it } from "vitest";
import type {
  AlertIssueOtherCategory,
  AlertIssueScenario,
} from "../../../contracts/reporting/alertIssueScenario";
import {
  SPECIAL_CORE_INCIDENT_MAX_RELATED_PLAYBACK,
  createSpecialCoreIncidentEvidenceArchive,
  freezeSpecialCoreIncidentEvidence,
} from "./specialCoreIncidentEvidenceArchive";
import {
  selectSpecialCoreReportIncident,
  type SpecialCoreIncidentOperatorConclusion,
} from "./specialCoreIncidentEvidenceSelection";
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
  type FrozenSpecialCoreIncidentEvidence,
  type SpecialCoreIncidentActivation,
  type SpecialCoreIncidentAlertDecision,
  type SpecialCoreIncidentConfigurationRevision,
  type SpecialCoreIncidentConfirmationAttempt,
  type SpecialCoreIncidentEvidenceArchive,
  type SpecialCoreIncidentFrame,
  type SpecialCoreIncidentFrozenState,
  type SpecialCoreIncidentLifecycleEvent,
  type SpecialCoreIncidentMediaFrame,
  type SpecialCoreIncidentObservation,
  type SpecialCoreIncidentPlaybackAttempt,
  type SpecialCoreIncidentRelatedPlayback,
  type SpecialCoreIncidentReportLease,
  type SpecialCoreIncidentResetEpoch,
  type SpecialCoreIncidentSchedule,
} from "./specialCoreIncidentEvidenceTypes";

const FROZEN_AT = 100_000;

type ScenarioFixture = {
  reason: string;
  scenario: AlertIssueScenario;
  otherCategory?: AlertIssueOtherCategory | null;
  expected: SpecialCoreIncidentOperatorConclusion;
};

const SCENARIO_FIXTURES: Record<string, ScenarioFixture> = {
  C1: {
    reason: "special-core-missed",
    scenario: "not-recognized",
    expected: "recognition-rejected",
  },
  C2: {
    reason: "special-core-missed",
    scenario: "recognized-no-alert",
    expected: "decision-suppressed",
  },
  C3: {
    reason: "special-core-missed",
    scenario: "playback-missing",
    expected: "decision-without-playback",
  },
  C4: {
    reason: "special-core-false-alert",
    scenario: "wrong-target",
    expected: "false-activation-chain-found",
  },
  C5: {
    reason: "special-core-false-alert",
    scenario: "duplicate-alert",
    expected: "separate-activation-alerts-found",
  },
  C6: {
    reason: "special-core-false-alert",
    scenario: "unexpected-playback",
    expected: "unexpected-special-core-playback-found",
  },
  C7: {
    reason: "special-core-timing",
    scenario: "early-alert",
    expected: "early-alert-chain-found",
  },
  C8: {
    reason: "special-core-timing",
    scenario: "late-alert",
    expected: "late-alert-chain-found",
  },
  C9: {
    reason: "special-core-timing",
    scenario: "repeat-timing",
    expected: "same-activation-duplicate-found",
  },
  C10: {
    reason: "special-core-timing",
    scenario: "playback-missing",
    expected: "decision-without-playback",
  },
  C11: {
    reason: "other",
    scenario: "other",
    otherCategory: "status-display",
    expected: "presentation-event-found",
  },
  C12: {
    reason: "other",
    scenario: "other",
    otherCategory: "sound-volume",
    expected: "audio-configuration-found",
  },
  C13: {
    reason: "other",
    scenario: "other",
    otherCategory: "settings-preset",
    expected: "configuration-transition-found",
  },
  C14: {
    reason: "other",
    scenario: "other",
    otherCategory: "performance-error",
    expected: "runtime-error-found",
  },
  C15: {
    reason: "other",
    scenario: "other",
    otherCategory: "interaction",
    expected: "interaction-event-found",
  },
  C16: {
    reason: "other",
    scenario: "other",
    otherCategory: "other",
    expected: "unsupported-other",
  },
};

describe("special core incident evidence selection", () => {
  for (const [id, fixture] of Object.entries(SCENARIO_FIXTURES)) {
    it(`selects ${id} with an explicit operator conclusion`, () => {
      const evidence = createScenarioEvidence(id);
      const selection = selectSpecialCoreReportIncident({
        evidence,
        reason: fixture.reason,
        scenario: fixture.scenario,
        occurrence: "current",
        otherCategory: fixture.otherCategory,
      });

      expect(selection.operatorConclusion).toBe(fixture.expected);
      expect(selection.resetEpochId).toBe(evidence.lease.resetEpochId);
      if (id === "C16") {
        expect(selection.support).toBe("unsupported");
      } else {
        expect(selection.anchorKind).not.toBeNull();
        expect(selection.candidateIds.length).toBeGreaterThan(0);
      }
    });
  }

  it.each([
    ["registered", "schedule-not-due"],
    ["replaced", "schedule-replaced"],
    ["cancelled", "schedule-cancelled"],
    ["suppressed", "decision-suppressed"],
  ] as const)("distinguishes no-alert schedule status %s", (status, expected) => {
    const archive = createBaseArchive();
    const chain = createActivationChain(archive, 1, FROZEN_AT - 2_000);
    chain.schedule.status = status;
    chain.schedule.endedAt =
      status === "registered" ? null : FROZEN_AT - 500;
    appendChain(archive, chain);
    const evidence = freezeArchive(archive, chain);

    const selection = selectScenario(
      evidence,
      "special-core-missed",
      "recognized-no-alert",
    );
    expect(selection.operatorConclusion).toBe(expected);
  });

  it("distinguishes a future schedule from a past-due schedule with no decision", () => {
    const archive = createBaseArchive();
    const chain = createActivationChain(archive, 1, FROZEN_AT - 30_000);
    appendChain(archive, chain);
    const evidence = freezeArchive(archive, chain);

    expect(
      selectScenario(
        evidence,
        "special-core-missed",
        "recognized-no-alert",
      ).operatorConclusion,
    ).toBe("decision-missing");
    expect(
      selectScenario(
        evidence,
        "special-core-missed",
        "playback-missing",
      ).operatorConclusion,
    ).toBe("decision-missing");
  });

  it("distinguishes an accepted single frame and an expired confirmation", () => {
    const singleArchive = createBaseArchive();
    const frame = createFrame(singleArchive, 1, FROZEN_AT - 500);
    const observation = createObservation(frame, "accepted");
    singleArchive.frames.push(frame);
    singleArchive.observations.push(observation);
    const single = freezeArchive(singleArchive);
    expect(
      selectScenario(
        single,
        "special-core-missed",
        "recognized-no-alert",
      ).operatorConclusion,
    ).toBe("recognition-unconfirmed");

    const expiredArchive = createBaseArchive();
    const expiredFrame = createFrame(expiredArchive, 1, FROZEN_AT - 3_500);
    const expiredObservation = createObservation(expiredFrame, "accepted");
    const attempt = createConfirmationAttempt(
      expiredArchive,
      1,
      [expiredObservation],
      "expired",
    );
    expiredArchive.frames.push(expiredFrame);
    expiredArchive.observations.push(expiredObservation);
    expiredArchive.confirmationAttempts.push(attempt);
    const expired = freezeArchive(expiredArchive, {
      confirmation: attempt,
    });
    expect(
      selectScenario(
        expired,
        "special-core-missed",
        "recognized-no-alert",
      ).operatorConclusion,
    ).toBe("confirmation-expired");
  });

  it.each([
    [undefined, "decision-without-playback"],
    ["requested", "playback-requested-only"],
    ["failed", "playback-failed"],
    ["browser-play-accepted", "physical-audibility-unverifiable"],
    ["finished", "physical-audibility-unverifiable"],
  ] as const)("distinguishes playback lifecycle %s", (status, expected) => {
    const archive = createBaseArchive();
    const chain = createActivationChain(archive, 1, FROZEN_AT - 3_000, {
      decision: true,
      playbackStatus: status,
    });
    appendChain(archive, chain);
    const evidence = freezeArchive(archive, chain);
    const selection = selectScenario(
      evidence,
      "special-core-missed",
      "playback-missing",
    );

    expect(selection.operatorConclusion).toBe(expected);
    expect(selection.physicalAudibility).toBe("unknown");
    if (status === "browser-play-accepted" || status === "finished") {
      expect(selection.degradationReasons).toContain(
        "physical-audibility-unknown",
      );
    }
  });

  it("distinguishes valid cooldown reacquire from a same-activation duplicate", () => {
    const archive = createBaseArchive();
    const first = createActivationChain(archive, 1, FROZEN_AT - 6_000, {
      decision: true,
    });
    const reacquired = createActivationChain(archive, 2, FROZEN_AT - 2_000, {
      decision: true,
      confirmationKind: "cooldown-reacquire",
    });
    appendChain(archive, first);
    appendChain(archive, reacquired);
    const evidence = freezeArchive(archive, reacquired);

    const selection = selectScenario(
      evidence,
      "special-core-false-alert",
      "duplicate-alert",
    );
    expect(selection.operatorConclusion).toBe("valid-reacquire-found");
    expect(selection.activationIds).toHaveLength(2);
  });

  it("attributes unexpected audio to bounded related app playback when no Special Core attempt exists", () => {
    const archive = createBaseArchive();
    const related = createRelatedPlayback("rune", FROZEN_AT - 100);
    const evidence = freezeArchive(archive, undefined, [related]);
    const selection = selectScenario(
      evidence,
      "special-core-false-alert",
      "unexpected-playback",
    );

    expect(selection.operatorConclusion).toBe(
      "unrelated-feature-playback-found",
    );
    expect(selection.relatedPlaybackIds).toEqual([related.id]);
    expect(selection.playbackAttemptIds).toEqual([]);
    expect(selection.degradationReasons).toContain(
      "physical-audibility-unknown",
    );
  });

  it("selects the latest related playback even when an older Special Core attempt exists", () => {
    const archive = createBaseArchive();
    const chain = createActivationChain(archive, 1, FROZEN_AT - 4_000, {
      decision: true,
      playbackStatus: "finished",
    });
    appendChain(archive, chain);
    const related = createRelatedPlayback("rune", FROZEN_AT - 100);
    const selection = selectScenario(
      freezeArchive(archive, chain, [related]),
      "special-core-false-alert",
      "unexpected-playback",
    );

    expect(selection.operatorConclusion).toBe(
      "unrelated-feature-playback-found",
    );
    expect(selection.relatedPlaybackIds).toEqual([related.id]);
  });

  it("keeps an older active wrong-target activation selectable as current", () => {
    const archive = createBaseArchive();
    const chain = createActivationChain(archive, 1, FROZEN_AT - 30_000);
    appendChain(archive, chain);
    const selection = selectScenario(
      freezeArchive(archive, chain),
      "special-core-false-alert",
      "wrong-target",
    );

    expect(selection.status).toBe("current-snapshot");
    expect(selection.operatorConclusion).toBe("false-activation-chain-found");
  });

  it("uses an error observation when a runtime lifecycle event was never produced", () => {
    const archive = createBaseArchive();
    const frame = createFrame(archive, 1, FROZEN_AT - 100);
    const observation = createObservation(frame, "error");
    archive.frames.push(frame);
    archive.observations.push(observation);
    const selection = selectScenario(
      freezeArchive(archive),
      "other",
      "other",
      "current",
      "performance-error",
    );

    expect(selection.operatorConclusion).toBe("runtime-error-found");
    expect(selection.observationIds).toEqual([observation.id]);
  });

  it("rejects a malformed relationship that crosses reset epochs", () => {
    const archive = createBaseArchive();
    const chain = createActivationChain(archive, 1, FROZEN_AT - 2_000);
    const other = createResetAndConfiguration(2, FROZEN_AT - 1_500);
    archive.resetEpochs.push(other.reset);
    archive.configurationRevisions.push(other.configuration);
    chain.schedule.resetEpochId = other.reset.id;
    appendChain(archive, chain);
    const selection = selectScenario(
      freezeArchive(archive, chain),
      "special-core-missed",
      "playback-missing",
    );

    expect(selection.operatorConclusion).toBe("evidence-unavailable");
    expect(selection.support).toBe("unsupported");
  });

  it("honors exact current/recent boundaries and rejects historical selection", () => {
    const currentArchive = createBaseArchive();
    const currentFrame = createFrame(currentArchive, 1, FROZEN_AT - 10_000);
    currentArchive.frames.push(currentFrame);
    currentArchive.observations.push(createObservation(currentFrame, "rejected"));
    const current = freezeArchive(currentArchive);
    expect(
      selectScenario(
        current,
        "special-core-missed",
        "not-recognized",
        "current",
      ).status,
    ).toBe("current-snapshot");

    const recentArchive = createBaseArchive();
    const recentFrame = createFrame(recentArchive, 1, FROZEN_AT - 10_001);
    recentArchive.frames.push(recentFrame);
    recentArchive.observations.push(createObservation(recentFrame, "rejected"));
    const recent = freezeArchive(recentArchive);
    expect(
      selectScenario(
        recent,
        "special-core-missed",
        "not-recognized",
        "current",
      ).status,
    ).toBe("outside-retention");
    expect(
      selectScenario(
        recent,
        "special-core-missed",
        "not-recognized",
        "recent",
      ).status,
    ).toBe("matched");

    const edgeArchive = createBaseArchive();
    const edgeFrame = createFrame(edgeArchive, 1, FROZEN_AT - 60_000);
    edgeArchive.frames.push(edgeFrame);
    edgeArchive.observations.push(createObservation(edgeFrame, "rejected"));
    const edge = freezeArchive(edgeArchive);
    expect(
      selectScenario(
        edge,
        "special-core-missed",
        "not-recognized",
        "recent",
      ).status,
    ).toBe("matched");
    expect(
      selectScenario(
        edge,
        "special-core-missed",
        "not-recognized",
        "historical",
      ).operatorConclusion,
    ).toBe("evidence-outside-retention");
  });

  it("never upgrades report-time analysis into runtime incident evidence", () => {
    const archive = createBaseArchive();
    archive.lifecycleEvents.push(
      createEvent(archive, "report-time", "recognition", "report-time-analysis"),
    );
    const selection = selectScenario(
      freezeArchive(archive),
      "special-core-missed",
      "not-recognized",
    );
    expect(selection.operatorConclusion).toBe("report-time-context-only");
    expect(selection.degradationReasons).toContain("report-time-only");
  });

  it("reports exact selected media loss without discarding compact recognition", () => {
    const archive = createBaseArchive();
    const frame = createFrame(archive, 1, FROZEN_AT - 100);
    archive.frames.push(frame);
    archive.observations.push(createObservation(frame, "rejected"));
    archive.omissions.push({
      id: "omission:media",
      occurredAt: FROZEN_AT - 50,
      kind: "media",
      reason: "media-budget",
      subjectIds: [frame.id],
      count: 1,
    });
    const selection = selectScenario(
      freezeArchive(archive),
      "special-core-missed",
      "not-recognized",
    );

    expect(selection.operatorConclusion).toBe("recognition-rejected");
    expect(selection.support).toBe("partial");
    expect(selection.degradationReasons).toContain("selected-media-missing");
    expect(selection.degradationReasons).toContain("media-budget");
  });

  it("keeps equal-time incidents ambiguous instead of merging them", () => {
    const archive = createBaseArchive();
    const first = createFrame(archive, 1, FROZEN_AT - 100);
    archive.frames.push(first);
    archive.observations.push(createObservation(first, "rejected"));

    const other = createResetAndConfiguration(2, FROZEN_AT - 500);
    const second = createFrameFor(other.reset, other.configuration, 1, first.sampledAt);
    archive.resetEpochs.push(other.reset);
    archive.configurationRevisions.push(other.configuration);
    archive.frames.push(second);
    archive.observations.push(createObservation(second, "rejected"));
    const selection = selectScenario(
      freezeArchive(archive),
      "special-core-missed",
      "not-recognized",
    );

    expect(selection.ambiguous).toBe(true);
    expect(selection.operatorConclusion).toBe("ambiguous-incident");
    expect(selection.degradationReasons).toContain("ambiguous-incident");
  });

  it("freezes frame sequence, reset generation, mutable source data, and retry output at dialog open", () => {
    const archive = createBaseArchive();
    const first = createFrame(archive, 1, FROZEN_AT - 100);
    const delayed = createFrame(archive, 2, FROZEN_AT - 200);
    archive.frames.push(first, delayed);
    archive.observations.push(
      createObservation(first, "rejected"),
      createObservation(delayed, "accepted"),
    );
    archive.media.push(createMedia(first));
    const lease = createLease(archive, { leasedThroughFrameSequence: 1 });
    const frozen = freezeSpecialCoreIncidentEvidence({ archive, lease });
    const retry = freezeSpecialCoreIncidentEvidence({ archive, lease });

    archive.frames[0]!.layoutKey = "mutated";
    archive.media[0]!.imageDataUrl = "mutated";
    const future = createResetAndConfiguration(2, FROZEN_AT + 1);
    archive.resetEpochs.push(future.reset);
    archive.configurationRevisions.push(future.configuration);

    expect(frozen.frames.map((entry) => entry.id)).toEqual([first.id]);
    expect(frozen.frames[0]?.layoutKey).toBe("layout");
    expect(frozen.media[0]?.imageDataUrl).toBe("data:image/png;base64,AAAA");
    expect(retry).toEqual(frozen);
  });

  it("scopes future playback transitions to their dialog-open state", () => {
    const archive = createBaseArchive();
    const chain = createActivationChain(archive, 1, FROZEN_AT - 2_000, {
      decision: true,
      playbackStatus: "finished",
    });
    chain.playback!.browserAcceptedAt = FROZEN_AT + 1;
    chain.playback!.finishedAt = FROZEN_AT + 2;
    appendChain(archive, chain);
    const evidence = freezeArchive(archive, chain);

    expect(evidence.playbackAttempts[0]).toMatchObject({
      status: "requested",
      browserAcceptedAt: null,
      finishedAt: null,
    });
  });

  it("bounds unrelated playback and excludes future requests", () => {
    const archive = createBaseArchive();
    const related = Array.from(
      { length: SPECIAL_CORE_INCIDENT_MAX_RELATED_PLAYBACK + 3 },
      (_, index) => createRelatedPlayback("feature", FROZEN_AT - index),
    );
    related.push(createRelatedPlayback("future", FROZEN_AT + 1));
    const evidence = freezeArchive(archive, undefined, related);

    expect(evidence.relatedPlayback).toHaveLength(
      SPECIAL_CORE_INCIDENT_MAX_RELATED_PLAYBACK,
    );
    expect(evidence.relatedPlayback.some((entry) => entry.feature === "future")).toBe(
      false,
    );
  });

  it("labels missing, malformed, and untyped other evidence honestly", () => {
    expect(
      selectSpecialCoreReportIncident({
        evidence: null,
        reason: "special-core-missed",
        scenario: "not-recognized",
        occurrence: "current",
      }).operatorConclusion,
    ).toBe("evidence-unavailable");
    expect(
      selectSpecialCoreReportIncident({
        evidence: { legacy: true },
        reason: "special-core-missed",
        scenario: "not-recognized",
        occurrence: "current",
      }).operatorConclusion,
    ).toBe("legacy-evidence-unavailable");
    expect(
      selectSpecialCoreReportIncident({
        evidence: {
          schemaVersion: "special-core-incident-evidence-v1",
          frozenAt: FROZEN_AT,
          leaseId: "lease:broken",
          lease: null,
          frames: [],
          observations: [],
          activations: [],
          schedules: [],
          decisions: [],
          playbackAttempts: [],
        },
        reason: "special-core-missed",
        scenario: "not-recognized",
        occurrence: "current",
      }).operatorConclusion,
    ).toBe("legacy-evidence-unavailable");
    expect(
      selectSpecialCoreReportIncident({
        evidence: createScenarioEvidence("C16"),
        reason: "other",
        scenario: "other",
        occurrence: "current",
        otherCategory: null,
      }).operatorConclusion,
    ).toBe("unsupported-other");
  });
});

function createScenarioEvidence(id: string): FrozenSpecialCoreIncidentEvidence {
  const archive = createBaseArchive();
  let selected:
    | ReturnType<typeof createActivationChain>
    | { confirmation?: SpecialCoreIncidentConfirmationAttempt }
    | undefined;
  switch (id) {
    case "C1": {
      const frame = createFrame(archive, 1, FROZEN_AT - 100);
      archive.frames.push(frame);
      archive.observations.push(createObservation(frame, "rejected"));
      archive.media.push(createMedia(frame));
      break;
    }
    case "C2": {
      const chain = createActivationChain(archive, 1, FROZEN_AT - 2_000);
      chain.schedule.status = "suppressed";
      chain.schedule.endedAt = FROZEN_AT - 100;
      appendChain(archive, chain);
      selected = chain;
      break;
    }
    case "C3":
    case "C10": {
      const chain = createActivationChain(archive, 1, FROZEN_AT - 3_000, {
        decision: true,
      });
      appendChain(archive, chain);
      selected = chain;
      break;
    }
    case "C4": {
      const chain = createActivationChain(archive, 1, FROZEN_AT - 2_000);
      appendChain(archive, chain);
      archive.media.push(createMedia(chain.firstFrame), createMedia(chain.secondFrame));
      selected = chain;
      break;
    }
    case "C5": {
      const first = createActivationChain(archive, 1, FROZEN_AT - 6_000, {
        decision: true,
      });
      const second = createActivationChain(archive, 2, FROZEN_AT - 2_000, {
        decision: true,
      });
      appendChain(archive, first);
      appendChain(archive, second);
      selected = second;
      break;
    }
    case "C6": {
      const chain = createActivationChain(archive, 1, FROZEN_AT - 2_000, {
        decision: true,
        playbackStatus: "finished",
      });
      appendChain(archive, chain);
      selected = chain;
      break;
    }
    case "C7": {
      const chain = createActivationChain(archive, 1, FROZEN_AT - 2_000, {
        decision: true,
      });
      chain.decision!.occurredAt = chain.decision!.dueAt - 1;
      chain.decision!.schedulerDelayMs = -1;
      chain.schedule.endedAt = chain.decision!.occurredAt;
      appendChain(archive, chain);
      selected = chain;
      break;
    }
    case "C8": {
      const chain = createActivationChain(archive, 1, FROZEN_AT - 2_000, {
        decision: true,
      });
      chain.decision!.schedulerDelayMs = 500;
      chain.decision!.occurredAt = chain.decision!.dueAt + 500;
      chain.schedule.endedAt = chain.decision!.occurredAt;
      appendChain(archive, chain);
      selected = chain;
      break;
    }
    case "C9": {
      const chain = createActivationChain(archive, 1, FROZEN_AT - 4_000, {
        decision: true,
      });
      appendChain(archive, chain);
      const duplicateSchedule: SpecialCoreIncidentSchedule = {
        ...chain.schedule,
        id: createSpecialCoreIncidentScheduleId(chain.activation.id, 2),
        sequence: 2,
        registeredAt: FROZEN_AT - 1_000,
        endedAt: FROZEN_AT - 500,
      };
      const duplicateDecision: SpecialCoreIncidentAlertDecision = {
        ...chain.decision!,
        id: createSpecialCoreIncidentAlertDecisionId(chain.activation.id, 2),
        scheduleId: duplicateSchedule.id,
        sequence: 2,
        occurredAt: FROZEN_AT - 500,
      };
      archive.schedules.push(duplicateSchedule);
      archive.decisions.push(duplicateDecision);
      selected = { ...chain, schedule: duplicateSchedule, decision: duplicateDecision };
      break;
    }
    case "C11":
      archive.lifecycleEvents.push(
        createEvent(archive, "presentation", "presentation", "state-published"),
      );
      break;
    case "C12":
      break;
    case "C13":
      archive.lifecycleEvents.push(
        createEvent(archive, "configuration", "configuration", "preset-replaced"),
      );
      break;
    case "C14":
      archive.lifecycleEvents.push(
        createEvent(archive, "runtime", "runtime-error", "matcher-timeout"),
      );
      break;
    case "C15":
      archive.lifecycleEvents.push(
        createEvent(archive, "interaction", "interaction", "panel-toggled"),
      );
      break;
    case "C16":
      break;
  }
  return freezeArchive(archive, selected);
}

function createBaseArchive(): SpecialCoreIncidentEvidenceArchive {
  const archive = createSpecialCoreIncidentEvidenceArchive(0);
  const base = createResetAndConfiguration(1, 0);
  archive.resetEpochs = [base.reset];
  archive.configurationRevisions = [base.configuration];
  archive.pointers.currentResetEpochId = base.reset.id;
  archive.pointers.currentConfigurationRevisionId = base.configuration.id;
  return archive;
}

function createResetAndConfiguration(sequence: number, startedAt: number): {
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
    id: createSpecialCoreIncidentConfigurationRevisionId(reset.id, sequence),
    resetEpochId: reset.id,
    sequence,
    capturedAt: startedAt,
    fingerprint: `config-${sequence}`,
    timingFingerprint: `timing-${sequence}`,
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
  return { reset, configuration };
}

function createFrame(
  archive: SpecialCoreIncidentEvidenceArchive,
  sequence: number,
  sampledAt: number,
): SpecialCoreIncidentFrame {
  return createFrameFor(
    archive.resetEpochs[0]!,
    archive.configurationRevisions[0]!,
    sequence,
    sampledAt,
  );
}

function createFrameFor(
  reset: SpecialCoreIncidentResetEpoch,
  configuration: SpecialCoreIncidentConfigurationRevision,
  sequence: number,
  sampledAt: number,
): SpecialCoreIncidentFrame {
  return {
    id: createSpecialCoreIncidentFrameId(reset.id, sequence),
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

function createObservation(
  frame: SpecialCoreIncidentFrame,
  decision: SpecialCoreIncidentObservation["decision"],
): SpecialCoreIncidentObservation {
  return {
    id: createSpecialCoreIncidentObservationId(frame.id),
    resetEpochId: frame.resetEpochId,
    frameId: frame.id,
    frameSequence: frame.sequence,
    configRevisionId: frame.configRevisionId,
    sampledAt: frame.sampledAt,
    decision,
    reason: decision === "rejected" ? "matcher-gate-reject" : null,
    candidates: [],
    selectedCandidateBoxIndex: null,
    stateBefore: null,
    stateAfter: null,
  };
}

function createConfirmationAttempt(
  archive: SpecialCoreIncidentEvidenceArchive,
  sequence: number,
  observations: SpecialCoreIncidentObservation[],
  status: SpecialCoreIncidentConfirmationAttempt["status"] = "confirmed",
  kind: SpecialCoreIncidentConfirmationAttempt["kind"] = "new-activation",
): SpecialCoreIncidentConfirmationAttempt {
  const reset = archive.resetEpochs[0]!;
  const endedAt =
    status === "collecting" ? null : observations[observations.length - 1]!.sampledAt;
  return {
    id: createSpecialCoreIncidentConfirmationAttemptId(reset.id, sequence),
    resetEpochId: reset.id,
    sequence,
    kind,
    startedAt: observations[0]!.sampledAt,
    lastObservedAt: observations[observations.length - 1]!.sampledAt,
    observationIds: observations.map((entry) => entry.id),
    status,
    activationId: null,
    endedAt,
    terminalReason:
      status === "expired"
        ? "window-expired"
        : status === "confirmed"
          ? "confirmed"
          : null,
  };
}

function createActivationChain(
  archive: SpecialCoreIncidentEvidenceArchive,
  sequence: number,
  startedAt: number,
  options: {
    decision?: boolean;
    playbackStatus?: SpecialCoreIncidentPlaybackAttempt["status"];
    confirmationKind?: SpecialCoreIncidentConfirmationAttempt["kind"];
  } = {},
) {
  const frameSequence = sequence * 10;
  const firstFrame = createFrame(archive, frameSequence + 1, startedAt);
  const secondFrame = createFrame(archive, frameSequence + 2, startedAt + 1_000);
  const firstObservation = createObservation(firstFrame, "accepted");
  const secondObservation = createObservation(secondFrame, "accepted");
  const confirmation = createConfirmationAttempt(
    archive,
    sequence,
    [firstObservation, secondObservation],
    "confirmed",
    options.confirmationKind,
  );
  const activationId = createSpecialCoreIncidentActivationId(
    archive.resetEpochs[0]!.id,
    sequence,
  );
  confirmation.activationId = activationId;
  const configuration = archive.configurationRevisions[0]!;
  const activation: SpecialCoreIncidentActivation = {
    id: activationId,
    resetEpochId: archive.resetEpochs[0]!.id,
    sequence,
    runtimeActivationId: sequence,
    confirmationAttemptId: confirmation.id,
    confirmationKind: options.confirmationKind ?? "new-activation",
    observationIds: [...confirmation.observationIds],
    startedAt,
    confirmedAt: secondFrame.sampledAt,
    lastSeenAt: secondFrame.sampledAt,
    timingConfigRevisionId: configuration.id,
    cooldownEndsAt: startedAt + 30_000,
    alertDueAt: startedAt + 25_000,
    status: "active",
    endedAt: null,
    terminalReason: null,
  };
  const schedule: SpecialCoreIncidentSchedule = {
    id: createSpecialCoreIncidentScheduleId(activation.id, 1),
    resetEpochId: activation.resetEpochId,
    activationId: activation.id,
    sequence: 1,
    reason: "activation-confirmed",
    registeredAt: secondFrame.sampledAt,
    alertDueAt: activation.alertDueAt,
    timingConfigRevisionId: configuration.id,
    status: options.decision ? "fired" : "registered",
    endedAt: options.decision ? FROZEN_AT - 500 : null,
    outcomeReason: null,
  };
  const decision = options.decision
    ? {
        id: createSpecialCoreIncidentAlertDecisionId(activation.id, 1),
        resetEpochId: activation.resetEpochId,
        activationId: activation.id,
        scheduleId: schedule.id,
        sequence: 1,
        occurredAt: FROZEN_AT - 500,
        dueAt: FROZEN_AT - 500,
        schedulerDelayMs: 0,
        timingConfigRevisionId: configuration.id,
        firedConfigRevisionId: configuration.id,
      }
    : null;
  const playback =
    decision && options.playbackStatus
      ? createPlayback(activation, schedule, decision, options.playbackStatus)
      : null;
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
  };
}

function createPlayback(
  activation: SpecialCoreIncidentActivation,
  schedule: SpecialCoreIncidentSchedule,
  decision: SpecialCoreIncidentAlertDecision,
  status: SpecialCoreIncidentPlaybackAttempt["status"],
): SpecialCoreIncidentPlaybackAttempt {
  const accepted = status === "browser-play-accepted" || status === "finished";
  return {
    id: createSpecialCoreIncidentPlaybackAttemptId(activation.id, 1),
    resetEpochId: activation.resetEpochId,
    activationId: activation.id,
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
    soundId: "sound",
    featureVolume: 1,
    masterVolume: 1,
    effectiveVolume: 1,
    startOffsetSeconds: 0,
  };
}

function appendChain(
  archive: SpecialCoreIncidentEvidenceArchive,
  chain: ReturnType<typeof createActivationChain>,
): void {
  archive.frames.push(chain.firstFrame, chain.secondFrame);
  archive.observations.push(chain.firstObservation, chain.secondObservation);
  archive.confirmationAttempts.push(chain.confirmation);
  archive.activations.push(chain.activation);
  archive.schedules.push(chain.schedule);
  if (chain.decision) archive.decisions.push(chain.decision);
  if (chain.playback) archive.playbackAttempts.push(chain.playback);
}

function createMedia(frame: SpecialCoreIncidentFrame): SpecialCoreIncidentMediaFrame {
  return {
    id: `media:${frame.id}`,
    frameId: frame.id,
    resetEpochId: frame.resetEpochId,
    sampledAt: frame.sampledAt,
    reason: "activation-confirmation",
    imageDataUrl: "data:image/png;base64,AAAA",
  };
}

function createEvent(
  archive: SpecialCoreIncidentEvidenceArchive,
  id: string,
  category: SpecialCoreIncidentLifecycleEvent["category"],
  action: string,
): SpecialCoreIncidentLifecycleEvent {
  return {
    id: `event:${id}`,
    resetEpochId: archive.resetEpochs[0]!.id,
    occurredAt: FROZEN_AT - 100,
    category,
    action,
    configRevisionId: archive.configurationRevisions[0]!.id,
    frameId: null,
    observationId: null,
    confirmationAttemptId: null,
    activationId: null,
    scheduleId: null,
    decisionId: null,
    playbackAttemptId: null,
    details: {},
  };
}

function createRelatedPlayback(
  feature: string,
  requestedAt: number,
): SpecialCoreIncidentRelatedPlayback {
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
  archive: SpecialCoreIncidentEvidenceArchive,
  options: {
    leasedThroughFrameSequence?: number;
    confirmationAttemptId?: string | null;
    activationId?: string | null;
    scheduleId?: string | null;
    decisionId?: string | null;
    playbackAttemptId?: string | null;
  } = {},
): SpecialCoreIncidentReportLease {
  const reset = archive.resetEpochs[0]!;
  const configuration = archive.configurationRevisions[0]!;
  return {
    id: "lease:1",
    resetEpochId: reset.id,
    configRevisionId: configuration.id,
    sequence: 1,
    frozenAt: FROZEN_AT,
    leasedThroughFrameSequence:
      options.leasedThroughFrameSequence ??
      Math.max(0, ...archive.frames
        .filter((entry) => entry.resetEpochId === reset.id)
        .map((entry) => entry.sequence)),
    layoutKey: reset.continuity.layoutKey,
    sourceGeometryRevision: reset.continuity.sourceGeometryRevision,
    confirmationAttemptId: options.confirmationAttemptId ?? null,
    activationId: options.activationId ?? null,
    scheduleId: options.scheduleId ?? null,
    decisionId: options.decisionId ?? null,
    playbackAttemptId: options.playbackAttemptId ?? null,
  };
}

function createFrozenState(
  archive: SpecialCoreIncidentEvidenceArchive,
  lease: SpecialCoreIncidentReportLease,
): SpecialCoreIncidentFrozenState {
  return {
    capturedAt: lease.frozenAt,
    resetEpochId: lease.resetEpochId,
    configRevisionId: lease.configRevisionId,
    enabled: true,
    status: "ready",
    decision: "waiting",
    presentationRevision: "presentation:1",
    latestFrameId: archive.frames[archive.frames.length - 1]?.id ?? null,
    latestObservationId:
      archive.observations[archive.observations.length - 1]?.id ?? null,
    confirmationAttemptId: lease.confirmationAttemptId,
    activationId: lease.activationId,
    scheduleId: lease.scheduleId,
    decisionId: lease.decisionId,
    playbackAttemptId: lease.playbackAttemptId,
  };
}

function freezeArchive(
  archive: SpecialCoreIncidentEvidenceArchive,
  selected?:
    | Partial<ReturnType<typeof createActivationChain>>
    | { confirmation?: SpecialCoreIncidentConfirmationAttempt },
  relatedPlayback: SpecialCoreIncidentRelatedPlayback[] = [],
): FrozenSpecialCoreIncidentEvidence {
  const lease = createLease(archive, {
    confirmationAttemptId: selected?.confirmation?.id ?? null,
    activationId: selected && "activation" in selected ? selected.activation?.id ?? null : null,
    scheduleId: selected && "schedule" in selected ? selected.schedule?.id ?? null : null,
    decisionId: selected && "decision" in selected ? selected.decision?.id ?? null : null,
    playbackAttemptId:
      selected && "playback" in selected ? selected.playback?.id ?? null : null,
  });
  return freezeSpecialCoreIncidentEvidence({
    archive,
    lease,
    frozenState: createFrozenState(archive, lease),
    relatedPlayback,
  });
}

function selectScenario(
  evidence: FrozenSpecialCoreIncidentEvidence,
  reason: string,
  scenario: AlertIssueScenario,
  occurrence: "current" | "recent" | "historical" = "current",
  otherCategory: AlertIssueOtherCategory | null = null,
) {
  return selectSpecialCoreReportIncident({
    evidence,
    reason,
    scenario,
    occurrence,
    otherCategory,
  });
}
