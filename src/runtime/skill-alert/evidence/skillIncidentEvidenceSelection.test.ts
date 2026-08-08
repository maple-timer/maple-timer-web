import { describe, expect, it } from "vitest";
import type {
  AlertIssueOccurrence,
  AlertIssueOtherCategory,
  AlertIssueScenario,
} from "../../../contracts/reporting/alertIssueScenario";
import {
  SKILL_INCIDENT_MEDIA_MAX_ENTRY_CHARS,
  createSkillIncidentEvidenceArchive,
  freezeSkillIncidentEvidence,
  updateSkillIncidentEvidenceArchive,
  type SkillIncidentEvidencePatch,
} from "./skillIncidentEvidenceArchive";
import { selectSkillReportIncident } from "./skillIncidentEvidenceSelection";
import type {
  FrozenSkillIncidentEvidence,
  SkillIncidentAlertDecision,
  SkillIncidentConfigurationRevision,
  SkillIncidentCycle,
  SkillIncidentEpoch,
  SkillIncidentFrame,
  SkillIncidentLifecycleEvent,
  SkillIncidentMedia,
  SkillIncidentObservation,
  SkillIncidentPlaybackAttempt,
  SkillIncidentTargetArbitration,
} from "./skillIncidentEvidenceTypes";
import {
  createSkillIncidentArbitrationId,
  createSkillIncidentAttemptId,
  createSkillIncidentCycleId,
  createSkillIncidentDecisionId,
  createSkillIncidentEpochId,
  createSkillIncidentFrameId,
  createSkillIncidentObservationId,
} from "./skillIncidentEvidenceTypes";

const NOW = 100_000;

describe("skill incident evidence scenario selection", () => {
  it("is honest for missing, malformed, historical, and report-time-only evidence", () => {
    expect(select({ evidence: null })).toMatchObject({
      status: "unavailable",
      support: "unsupported",
      degradationReasons: ["never-produced"],
    });
    expect(select({ evidence: {} })).toMatchObject({
      degradationReasons: ["legacy-unavailable"],
    });

    const epoch = createEpoch("skill-a", "quickslot-countdown");
    const reportTime = createFrame(epoch, 1, NOW - 1_000, {
      source: "report-time",
    });
    const evidence = freeze({
      skillId: "skill-a",
      epochs: [epoch],
      frames: [reportTime],
    });
    expect(select({ evidence })).toMatchObject({
      status: "unavailable",
      degradationReasons: ["report-time-only"],
    });
    expect(
      select({ evidence, occurrence: "historical" }),
    ).toMatchObject({
      status: "outside-retention",
      degradationReasons: ["outside-retention"],
    });
  });

  it("separates current ten seconds from recent sixty seconds and ignores dialog-open drift", () => {
    const epoch = createEpoch("skill-a", "quickslot-countdown");
    const oldFrame = createFrame(epoch, 1, NOW - 30_000);
    const oldObservation = createObservation(oldFrame, {
      recognitionDecision: "rejected",
    });
    attachObservation(oldFrame, oldObservation);
    const currentFrame = createFrame(epoch, 2, NOW - 5_000);
    const currentObservation = createObservation(currentFrame, {
      recognitionDecision: "rejected",
    });
    attachObservation(currentFrame, currentObservation);
    const laterReportTime = createFrame(epoch, 3, NOW - 100, {
      source: "report-time",
    });
    const evidence = freeze({
      skillId: "skill-a",
      epochs: [epoch],
      frames: [oldFrame, currentFrame, laterReportTime],
      observations: [oldObservation, currentObservation],
    });

    const current = select({ evidence, occurrence: "current" });
    const recent = select({ evidence, occurrence: "recent" });
    expect(current.frameIds).toEqual([currentFrame.id]);
    expect(current.candidateIds).not.toContain(
      `observation:${oldObservation.id}`,
    );
    expect(recent.candidateIds).toContain(
      `observation:${oldObservation.id}`,
    );
    expect(recent.frameIds).toEqual([currentFrame.id]);
    expect(recent.frameIds).not.toContain(laterReportTime.id);
  });

  it("selects quick-slot recognition and value failures with their exact media", () => {
    const epoch = createEpoch("skill-a", "quickslot-countdown");
    const rejectedFrame = createFrame(epoch, 1, NOW - 8_000);
    const rejected = createObservation(rejectedFrame, {
      recognitionDecision: "rejected",
      value: valueDecision("missing", null, "no-digits"),
    });
    attachObservation(rejectedFrame, rejected);
    const rejectedMedia = createMedia(rejectedFrame, rejected, "value-rejected");
    const wrongFrame = createFrame(epoch, 2, NOW - 4_000);
    const wrongValue = createObservation(wrongFrame, {
      recognitionDecision: "accepted",
      value: valueDecision("implausible", 3, "flow-jump"),
      flow: {
        confirmedValue: 8,
        expectedMin: 7,
        expectedMax: 9,
        decisionReason: "implausible-drop",
        pendingDropObservations: 1,
        pendingAlertObservations: 0,
      },
    });
    attachObservation(wrongFrame, wrongValue);
    const wrongMedia = createMedia(wrongFrame, wrongValue, "value-rejected");
    const evidence = freeze({
      skillId: "skill-a",
      epochs: [epoch],
      frames: [rejectedFrame, wrongFrame],
      observations: [rejected, wrongValue],
      media: [rejectedMedia, wrongMedia],
    });

    const notRecognized = select({
      evidence,
      scenario: "not-recognized",
    });
    const wrong = select({ evidence, scenario: "wrong-value" });
    expect(notRecognized.observationIds).toEqual([rejected.id]);
    expect(notRecognized.mediaIds).toEqual([rejectedMedia.id]);
    expect(notRecognized.support).toBe("definitive");
    expect(wrong.observationIds).toEqual([wrongValue.id]);
    expect(wrong.mediaIds).toEqual([wrongMedia.id]);
  });

  it("correlates missing media with its stable oversize omission", () => {
    const epoch = createEpoch("skill-a", "quickslot-countdown");
    const frame = createFrame(epoch, 1, NOW - 1_000);
    const observation = createObservation(frame, {
      recognitionDecision: "rejected",
    });
    attachObservation(frame, observation);
    const media = createMedia(frame, observation, "value-rejected");
    media.dataUrl = "x".repeat(SKILL_INCIDENT_MEDIA_MAX_ENTRY_CHARS + 1);
    const evidence = freeze({
      skillId: "skill-a",
      epochs: [epoch],
      frames: [frame],
      observations: [observation],
      media: [media],
    });

    const selected = select({ evidence, scenario: "not-recognized" });
    expect(selected.mediaIds).toEqual([]);
    expect(selected.degradationReasons).toContain("media-oversize");
  });

  it("keeps a quick-slot rearm cycle separate and binds threshold and repeats to it", () => {
    const epoch = createEpoch("skill-a", "quickslot-countdown");
    const firstFrame = createFrame(epoch, 1, NOW - 50_000);
    const firstObservation = createObservation(firstFrame);
    attachObservation(firstFrame, firstObservation);
    const firstCycle = createCycle(epoch, 1, NOW - 50_000, {
      status: "terminal",
      endedAt: NOW - 30_000,
      lastEventAt: NOW - 30_000,
      anchorObservationIds: [firstObservation.id],
      observationIds: [firstObservation.id],
    });

    const rearmFrame = createFrame(epoch, 2, NOW - 20_000);
    const rearmObservation = createObservation(rearmFrame, {
      flow: {
        confirmedValue: 30,
        expectedMin: 29,
        expectedMax: 31,
        decisionReason: "confirmed-rearm",
        pendingDropObservations: 0,
        pendingAlertObservations: 0,
      },
    });
    attachObservation(rearmFrame, rearmObservation);
    const rearmCycle = createCycle(epoch, 2, NOW - 20_000, {
      status: "active",
      lastEventAt: NOW - 1_000,
      anchorObservationIds: [rearmObservation.id],
      observationIds: [rearmObservation.id],
    });
    const initial = createDecision(rearmCycle, "initial", 1, NOW - 8_000);
    const initialAttempt = createAttempt(initial, 1, NOW - 8_000, {
      status: "finished",
      startedAt: NOW - 7_990,
      startedMonotonicAt: NOW - 7_990,
      finishedAt: NOW - 7_000,
      finishedMonotonicAt: NOW - 7_000,
    });
    const repeat = createDecision(rearmCycle, "repeat", 1, NOW - 2_000, {
      dueAt: NOW - 2_000,
      dueMonotonicAt: NOW - 2_000,
    });
    const repeatAttempt = createAttempt(repeat, 1, NOW - 2_000);
    const evidence = freeze({
      skillId: "skill-a",
      epochs: [epoch],
      frames: [firstFrame, rearmFrame],
      observations: [firstObservation, rearmObservation],
      cycles: [firstCycle, rearmCycle],
      decisions: [initial, repeat],
      attempts: [initialAttempt, repeatAttempt],
    });

    const selected = select({
      evidence,
      reason: "skill-alert-timing",
      scenario: "repeat-timing",
    });
    expect(selected.cycleIds).toEqual([rearmCycle.id]);
    expect(selected.cycleIds).not.toContain(firstCycle.id);
    expect(selected.decisionIds).toEqual([initial.id, repeat.id]);
    expect(selected.attemptIds).toEqual([
      initialAttempt.id,
      repeatAttempt.id,
    ]);
    expect(
      repeat.dueMonotonicAt! - initialAttempt.finishedMonotonicAt!,
    ).toBe(5_000);
    for (const scenario of ["early-alert", "late-alert"] as const) {
      expect(
        select({
          evidence,
          reason: "skill-alert-timing",
          scenario,
        }).decisionIds,
      ).toContain(initial.id);
    }
    expect(
      select({
        evidence,
        reason: "skill-alert-timing",
        scenario: "playback-missing",
      }).attemptIds,
    ).toEqual([initialAttempt.id, repeatAttempt.id]);
  });

  it("represents precision parser, matcher, value, six-sample confirmation, refresh, and provider reset", () => {
    const epoch = createEpoch("skill-a", "precision-countdown");
    const frames: SkillIncidentFrame[] = [];
    const observations: SkillIncidentObservation[] = [];

    const parserFrame = createFrame(epoch, 1, NOW - 20_000);
    const parserFailure = createObservation(parserFrame, {
      recognitionDecision: "missing",
      parser: {
        boxCount: 0,
        rowCount: 0,
        eligibleBoxCount: 0,
        candidateCount: 0,
        decisionReason: "parser-zero-box",
      },
    });
    attachObservation(parserFrame, parserFailure);
    frames.push(parserFrame);
    observations.push(parserFailure);

    const matcherFrame = createFrame(epoch, 2, NOW - 19_000);
    const matcherFailure = createObservation(matcherFrame, {
      recognitionDecision: "rejected",
      parser: parserDecision(2, 1),
      matcher: matcherDecision(false, "gate-rejected"),
    });
    attachObservation(matcherFrame, matcherFailure);
    frames.push(matcherFrame);
    observations.push(matcherFailure);

    const valueFrame = createFrame(epoch, 3, NOW - 18_000);
    const valueFailure = createObservation(valueFrame, {
      recognitionDecision: "accepted",
      parser: parserDecision(2, 1),
      matcher: matcherDecision(true, null),
      value: valueDecision("missing", null, "countdown-empty"),
    });
    attachObservation(valueFrame, valueFailure);
    frames.push(valueFrame);
    observations.push(valueFailure);

    const anchors: SkillIncidentObservation[] = [];
    for (let index = 0; index < 6; index += 1) {
      const frame = createFrame(epoch, 4 + index, NOW - 17_000 + index * 1_000);
      const observation = createObservation(frame, {
        parser: parserDecision(2, 1),
        matcher: matcherDecision(true, null),
        value: valueDecision("accepted", 60 - index, null),
      });
      attachObservation(frame, observation);
      frames.push(frame);
      observations.push(observation);
      anchors.push(observation);
    }
    const refreshFrame = createFrame(epoch, 10, NOW - 5_000);
    const refresh = createObservation(refreshFrame, {
      value: valueDecision("accepted", 120, null),
      flow: {
        confirmedValue: 120,
        expectedMin: 52,
        expectedMax: 56,
        decisionReason: "anchor-refresh-rescheduled",
        pendingDropObservations: 0,
        pendingAlertObservations: 0,
      },
    });
    attachObservation(refreshFrame, refresh);
    frames.push(refreshFrame);
    observations.push(refresh);
    const cycle = createCycle(epoch, 1, anchors[0].sampledAt, {
      status: "active",
      confirmedAt: anchors[5].sampledAt,
      lastEventAt: refresh.sampledAt,
      anchorObservationIds: anchors.map((entry) => entry.id),
      observationIds: [...anchors.map((entry) => entry.id), refresh.id],
    });
    const providerReset: SkillIncidentLifecycleEvent = {
      id: "provider-reset",
      skillId: "skill-a",
      epochId: epoch.id,
      occurredAt: NOW - 2_000,
      monotonicAt: NOW - 2_000,
      category: "runtime-error",
      action: "provider-reset",
      frameId: null,
      cycleId: cycle.id,
      configRevisionId: "config:skill-a:1",
      details: { from: "webgpu", to: "wasm", recovered: true },
    };
    const evidence = freeze({
      skillId: "skill-a",
      epochs: [epoch],
      frames,
      observations,
      cycles: [cycle],
      lifecycleEvents: [providerReset],
    });

    expect(select({ evidence, scenario: "not-recognized" }).candidateIds).toEqual(
      expect.arrayContaining([
        `observation:${parserFailure.id}`,
        `observation:${matcherFailure.id}`,
      ]),
    );
    expect(select({ evidence, scenario: "wrong-value" }).observationIds).toContain(
      valueFailure.id,
    );
    const confirmed = select({
      evidence,
      reason: "skill-alert-timing",
      scenario: "recognized-no-alert",
    });
    expect(confirmed.cycleIds).toEqual([cycle.id]);
    expect(confirmed.observationIds).toEqual(
      expect.arrayContaining([
        ...anchors.map((entry) => entry.id),
        refresh.id,
      ]),
    );
    expect(
      select({
        evidence,
        scenario: "other",
        otherCategory: "performance-error",
      }).eventIds,
    ).toContain(providerReset.id);
  });

  it("keeps Yein quarantined drops in one cycle and a confirmed increase in a new cycle", () => {
    const epoch = createEpoch("skill-a", "precision-remaining-count");
    const initialFrame = createFrame(epoch, 1, NOW - 30_000);
    const initial = createObservation(initialFrame, {
      value: countDecision(5),
      flow: countFlow(5, 4, 6, "initial-count"),
    });
    attachObservation(initialFrame, initial);
    const dropFrame = createFrame(epoch, 2, NOW - 20_000);
    const quarantined = createObservation(dropFrame, {
      value: countDecision(1),
      flow: countFlow(5, 4, 5, "quarantined-unreachable-drop", 1),
    });
    attachObservation(dropFrame, quarantined);
    const firstCycle = createCycle(epoch, 1, initial.sampledAt, {
      status: "terminal",
      lastEventAt: quarantined.sampledAt,
      endedAt: NOW - 10_000,
      terminalReason: "confirmed-count-increase",
      anchorObservationIds: [initial.id],
      observationIds: [initial.id, quarantined.id],
      confirmedCount: 5,
      estimatedExpiresAt: null,
    });

    const increaseFrame = createFrame(epoch, 3, NOW - 8_000);
    const increasePending = createObservation(increaseFrame, {
      value: countDecision(7),
      flow: countFlow(5, 5, 7, "increase-pending-confirmation"),
    });
    attachObservation(increaseFrame, increasePending);
    const confirmFrame = createFrame(epoch, 4, NOW - 7_000);
    const increaseConfirmed = createObservation(confirmFrame, {
      value: countDecision(7),
      flow: countFlow(7, 6, 8, "new-cycle-confirmed"),
    });
    attachObservation(confirmFrame, increaseConfirmed);
    const secondCycle = createCycle(epoch, 2, increasePending.sampledAt, {
      status: "active",
      confirmedAt: increaseConfirmed.sampledAt,
      lastEventAt: increaseConfirmed.sampledAt,
      anchorObservationIds: [increasePending.id, increaseConfirmed.id],
      observationIds: [increasePending.id, increaseConfirmed.id],
      confirmedCount: 7,
      estimatedExpiresAt: null,
    });
    const evidence = freeze({
      skillId: "skill-a",
      epochs: [epoch],
      frames: [initialFrame, dropFrame, increaseFrame, confirmFrame],
      observations: [initial, quarantined, increasePending, increaseConfirmed],
      cycles: [firstCycle, secondCycle],
    });

    const wrong = select({ evidence, scenario: "wrong-value" });
    const noAlert = select({ evidence, scenario: "recognized-no-alert" });
    expect(wrong.cycleIds).toEqual([firstCycle.id]);
    expect(wrong.observationIds).toContain(quarantined.id);
    expect(noAlert.cycleIds).toEqual([secondCycle.id]);
    expect(noAlert.cycleIds).not.toContain(firstCycle.id);
  });

  it("records one duplicate-target winner and explicit suppression for the other row", () => {
    const targetId = "precision:janus";
    const winnerEpoch = createEpoch("winner", "precision-countdown", targetId);
    const suppressedEpoch = createEpoch(
      "suppressed",
      "precision-countdown",
      targetId,
    );
    const winnerFrame = createFrame(winnerEpoch, 1, NOW - 5_000, {
      sourceFrameId: "shared-source",
    });
    const suppressedFrame = createFrame(suppressedEpoch, 1, NOW - 5_000, {
      sourceFrameId: "shared-source",
    });
    const winnerObservation = createObservation(winnerFrame, {
      skillIds: ["winner", "suppressed"],
    });
    attachObservation(winnerFrame, winnerObservation);
    attachObservation(suppressedFrame, winnerObservation);
    const winnerCycle = createCycle(winnerEpoch, 1, NOW - 5_000, {
      status: "active",
      lastEventAt: NOW - 1_000,
      observationIds: [winnerObservation.id],
      anchorObservationIds: [winnerObservation.id],
    });
    const suppressedCycle = createCycle(suppressedEpoch, 1, NOW - 5_000, {
      status: "active",
      lastEventAt: NOW - 1_000,
      observationIds: [winnerObservation.id],
      anchorObservationIds: [winnerObservation.id],
    });
    const winnerDecision = createDecision(winnerCycle, "initial", 1, NOW - 1_000);
    const suppressedDecision = createDecision(
      suppressedCycle,
      "initial",
      1,
      NOW - 1_000,
      { outcome: "suppressed-duplicate-target" },
    );
    const arbitrationId = createSkillIncidentArbitrationId(
      "shared-source",
      targetId,
    );
    winnerDecision.arbitrationId = arbitrationId;
    suppressedDecision.arbitrationId = arbitrationId;
    const attempt = createAttempt(winnerDecision, 1, NOW - 1_000);
    const arbitration: SkillIncidentTargetArbitration = {
      id: arbitrationId,
      sourceFrameId: "shared-source",
      targetId,
      occurredAt: NOW - 1_000,
      monotonicAt: NOW - 1_000,
      dueSkillIds: ["winner", "suppressed"],
      winnerSkillId: "winner",
      suppressedSkillIds: ["suppressed"],
      decisionIds: [winnerDecision.id, suppressedDecision.id],
    };
    const evidence = freeze({
      skillId: "suppressed",
      currentEpochIds: {
        winner: winnerEpoch.id,
        suppressed: suppressedEpoch.id,
      },
      epochs: [winnerEpoch, suppressedEpoch],
      frames: [winnerFrame, suppressedFrame],
      observations: [winnerObservation],
      cycles: [winnerCycle, suppressedCycle],
      decisions: [winnerDecision, suppressedDecision],
      attempts: [attempt],
      arbitrations: [arbitration],
    });

    const selected = select({
      evidence,
      scenario: "recognized-no-alert",
      selectedSkillId: "suppressed",
    });
    expect(selected.decisionIds).toContain(suppressedDecision.id);
    expect(selected.arbitrationIds).toEqual([arbitration.id]);
    expect(selected.attemptIds).toEqual([]);
  });

  it("distinguishes requested, accepted start, finish, failure, and legacy start semantics", () => {
    const epoch = createEpoch("skill-a", "quickslot-countdown");
    const frame = createFrame(epoch, 1, NOW - 10_000);
    const observation = createObservation(frame);
    attachObservation(frame, observation);
    const cycle = createCycle(epoch, 1, NOW - 10_000, {
      status: "active",
      lastEventAt: NOW - 1_000,
      observationIds: [observation.id],
      anchorObservationIds: [observation.id],
    });
    const finishedDecision = createDecision(cycle, "initial", 1, NOW - 6_000);
    const finished = createAttempt(finishedDecision, 1, NOW - 6_000, {
      status: "finished",
      startedAt: NOW - 5_990,
      startedMonotonicAt: NOW - 5_990,
      finishedAt: NOW - 5_000,
      finishedMonotonicAt: NOW - 5_000,
    });
    const failedDecision = createDecision(cycle, "repeat", 1, NOW - 1_000);
    const failed = createAttempt(failedDecision, 1, NOW - 1_000, {
      status: "failed",
      startedAt: null,
      startedMonotonicAt: null,
      failedAt: NOW - 990,
      failedMonotonicAt: NOW - 990,
      error: "NotAllowedError",
    });
    const evidence = freeze({
      skillId: "skill-a",
      epochs: [epoch],
      frames: [frame],
      observations: [observation],
      cycles: [cycle],
      decisions: [finishedDecision, failedDecision],
      attempts: [finished, failed],
    });
    const selected = select({ evidence, scenario: "playback-missing" });
    expect(selected.attemptIds).toEqual([finished.id, failed.id]);
    expect(selected.playbackStartEvidence).toBe("browser-play-accepted");
    expect(selected.physicalAudibility).toBe("unknown");

    const legacy = {
      ...evidence,
      attempts: evidence.attempts.map((entry) => ({
        ...entry,
        startedMeaning: "legacy-request-recorded" as const,
      })),
    };
    expect(select({ evidence: legacy, scenario: "playback-missing" })).toMatchObject(
      {
        support: "partial",
        playbackStartEvidence: "legacy-request-only",
        degradationReasons: expect.arrayContaining(["legacy-unavailable"]),
      },
    );
  });

  it("marks equal compatible cycles as ambiguous instead of merging them", () => {
    const epoch = createEpoch("skill-a", "quickslot-countdown");
    const firstFrame = createFrame(epoch, 1, NOW - 5_000);
    const firstObservation = createObservation(firstFrame);
    attachObservation(firstFrame, firstObservation);
    const secondFrame = createFrame(epoch, 2, NOW - 4_000);
    const secondObservation = createObservation(secondFrame);
    attachObservation(secondFrame, secondObservation);
    const firstCycle = createCycle(epoch, 1, NOW - 5_000, {
      confirmedAt: NOW - 5_000,
      lastEventAt: NOW - 1_000,
      observationIds: [firstObservation.id],
      anchorObservationIds: [firstObservation.id],
    });
    const secondCycle = createCycle(epoch, 2, NOW - 4_000, {
      confirmedAt: NOW - 4_000,
      lastEventAt: NOW - 1_000,
      observationIds: [secondObservation.id],
      anchorObservationIds: [secondObservation.id],
    });
    const evidence = freeze({
      skillId: "skill-a",
      epochs: [epoch],
      frames: [firstFrame, secondFrame],
      observations: [firstObservation, secondObservation],
      cycles: [firstCycle, secondCycle],
    });

    const selected = select({ evidence, scenario: "recognized-no-alert" });
    expect(selected.ambiguous).toBe(true);
    expect(selected.cycleIds).toHaveLength(1);
    expect(selected.degradationReasons).toContain("ambiguous-cycle");
  });

  it("routes all typed other leaves to category-compatible evidence", () => {
    const epoch = createEpoch("skill-a", "quickslot-countdown");
    const frame = createFrame(epoch, 1, NOW - 8_000);
    const observation = createObservation(frame);
    attachObservation(frame, observation);
    const cycle = createCycle(epoch, 1, NOW - 8_000, {
      status: "active",
      lastEventAt: NOW - 3_000,
      observationIds: [observation.id],
      anchorObservationIds: [observation.id],
    });
    const decision = createDecision(cycle, "initial", 1, NOW - 3_000);
    const attempt = createAttempt(decision, 1, NOW - 3_000);
    const config = createConfiguration(epoch, NOW - 7_000);
    const events: SkillIncidentLifecycleEvent[] = [
      event(epoch, "presentation", "panel-state", NOW - 6_000),
      event(epoch, "configuration", "preset-changed", NOW - 5_000),
      event(epoch, "runtime-error", "worker-retry", NOW - 4_000),
      event(epoch, "interaction", "toggle-clicked", NOW - 2_000),
    ];
    const evidence = freeze({
      skillId: "skill-a",
      epochs: [epoch],
      frames: [frame],
      observations: [observation],
      cycles: [cycle],
      decisions: [decision],
      attempts: [attempt],
      configurationRevisions: [config],
      lifecycleEvents: events,
    });

    const expectations: Array<[
      AlertIssueOtherCategory,
      "frame" | "attempt" | "configuration" | "event",
    ]> = [
      ["status-display", "event"],
      ["sound-volume", "attempt"],
      ["settings-preset", "event"],
      ["performance-error", "event"],
      ["interaction", "event"],
      ["other", "event"],
    ];
    for (const [category, anchorKind] of expectations) {
      expect(
        select({ evidence, scenario: "other", otherCategory: category })
          .anchorKind,
      ).toBe(anchorKind);
    }
  });
});

function select({
  evidence,
  reason = "skill-not-detected",
  scenario = "not-recognized",
  occurrence = "recent",
  selectedSkillId,
  otherCategory = null,
}: {
  evidence: FrozenSkillIncidentEvidence | Record<string, unknown> | null;
  reason?: string;
  scenario?: AlertIssueScenario;
  occurrence?: AlertIssueOccurrence;
  selectedSkillId?: string;
  otherCategory?: AlertIssueOtherCategory | null;
}) {
  return selectSkillReportIncident({
    evidence,
    reason,
    scenario,
    occurrence,
    selectedSkillId,
    otherCategory,
  });
}

function freeze({
  skillId,
  currentEpochIds,
  ...patch
}: SkillIncidentEvidencePatch & {
  skillId: string;
}): FrozenSkillIncidentEvidence {
  const archive = updateSkillIncidentEvidenceArchive({
    previous: createSkillIncidentEvidenceArchive(NOW - 60_000),
    now: NOW,
    patch: {
      ...patch,
      currentEpochIds:
        currentEpochIds ??
        Object.fromEntries(
          (patch.epochs ?? []).map((entry) => [entry.skillId, entry.id]),
        ),
    },
  });
  return freezeSkillIncidentEvidence({
    archive,
    selectedSkillId: skillId,
    frozenAt: NOW,
    leaseId: `lease:${skillId}`,
  });
}

function createEpoch(
  skillId: string,
  mode: SkillIncidentEpoch["mode"],
  targetId =
    mode === "quickslot-countdown"
      ? `quickslot:${skillId}`
      : mode === "precision-remaining-count"
        ? "precision:yein"
        : "precision:janus",
): SkillIncidentEpoch {
  return {
    id: createSkillIncidentEpochId(skillId, 1),
    skillId,
    sequence: 1,
    mode,
    targetId,
    createdAt: NOW - 60_000,
    closedAt: null,
    reason: "enabled",
  };
}

function createFrame(
  epoch: SkillIncidentEpoch,
  sequence: number,
  sampledAt: number,
  overrides: Partial<SkillIncidentFrame> = {},
): SkillIncidentFrame {
  return {
    id: createSkillIncidentFrameId(epoch.id, sequence),
    epochId: epoch.id,
    skillId: epoch.skillId,
    sequence,
    sourceFrameId: `source:${sampledAt}`,
    sampledAt,
    monotonicAt: sampledAt,
    source: "runtime",
    mode: epoch.mode,
    targetId: epoch.targetId,
    configRevisionId: `config:${epoch.skillId}:1`,
    provider: epoch.mode === "quickslot-countdown" ? "wasm" : "webgpu",
    recognizerVersion: "fixture-v1",
    observationIds: [],
    stateBefore: state(),
    stateAfter: state(),
    runtimeFailure: null,
    mediaIds: [],
    reasons: ["value-change"],
    ...overrides,
  };
}

function createObservation(
  frame: SkillIncidentFrame,
  overrides: Partial<SkillIncidentObservation> = {},
): SkillIncidentObservation {
  return {
    id: createSkillIncidentObservationId(frame.id, frame.targetId),
    frameId: frame.id,
    epochId: frame.epochId,
    skillIds: [frame.skillId],
    targetId: frame.targetId,
    sampledAt: frame.sampledAt,
    monotonicAt: frame.monotonicAt,
    mode: frame.mode,
    recognitionDecision: "accepted",
    parser:
      frame.mode === "quickslot-countdown" ? null : parserDecision(1, 1),
    matcher:
      frame.mode === "quickslot-countdown" ? null : matcherDecision(true, null),
    value:
      frame.mode === "precision-remaining-count"
        ? countDecision(5)
        : valueDecision("accepted", 30, null),
    flow:
      frame.mode === "precision-remaining-count"
        ? countFlow(5, 4, 6, "compatible")
        : {
            confirmedValue: 30,
            expectedMin: 29,
            expectedMax: 31,
            decisionReason: "compatible",
            pendingDropObservations: 0,
            pendingAlertObservations: 0,
          },
    runtimeFailure: null,
    mediaIds: [],
    ...overrides,
  };
}

function attachObservation(
  frame: SkillIncidentFrame,
  observation: SkillIncidentObservation,
) {
  frame.observationIds.push(observation.id);
}

function createCycle(
  epoch: SkillIncidentEpoch,
  sequence: number,
  startedAt: number,
  overrides: Partial<SkillIncidentCycle> = {},
): SkillIncidentCycle {
  return {
    id: createSkillIncidentCycleId(epoch.id, sequence),
    epochId: epoch.id,
    skillId: epoch.skillId,
    targetId: epoch.targetId,
    sequence,
    mode: epoch.mode,
    status: "active",
    startedAt,
    confirmedAt: startedAt,
    lastEventAt: startedAt,
    endedAt: null,
    terminalReason: null,
    anchorObservationIds: [],
    observationIds: [],
    decisionIds: [],
    configRevisionIds: [`config:${epoch.skillId}:1`],
    estimatedExpiresAt:
      epoch.mode === "precision-remaining-count" ? null : startedAt + 30_000,
    confirmedCount: epoch.mode === "precision-remaining-count" ? 5 : null,
    initialAlertDelaySeconds: 5,
    ...overrides,
  };
}

function createDecision(
  cycle: SkillIncidentCycle,
  kind: "initial" | "repeat",
  sequence: number,
  occurredAt: number,
  overrides: Partial<SkillIncidentAlertDecision> = {},
): SkillIncidentAlertDecision {
  const id = createSkillIncidentDecisionId({ cycleId: cycle.id, kind, sequence });
  cycle.decisionIds.push(id);
  return {
    id,
    epochId: cycle.epochId,
    skillId: cycle.skillId,
    targetId: cycle.targetId,
    cycleId: cycle.id,
    sequence,
    kind,
    occurredAt,
    monotonicAt: occurredAt,
    dueAt: occurredAt,
    dueMonotonicAt: occurredAt,
    frameId: null,
    observationId: null,
    configRevisionId: `config:${cycle.skillId}:1`,
    arbitrationId: null,
    outcome: "requested",
    reason: null,
    attemptId: null,
    ...overrides,
  };
}

function createAttempt(
  decision: SkillIncidentAlertDecision,
  sequence: number,
  requestedAt: number,
  overrides: Partial<SkillIncidentPlaybackAttempt> = {},
): SkillIncidentPlaybackAttempt {
  const id = createSkillIncidentAttemptId(decision.id, sequence);
  decision.attemptId = id;
  return {
    id,
    epochId: decision.epochId,
    skillId: decision.skillId,
    cycleId: decision.cycleId,
    decisionId: decision.id,
    sequence,
    requestedAt,
    requestedMonotonicAt: requestedAt,
    startedAt: requestedAt + 10,
    startedMonotonicAt: requestedAt + 10,
    finishedAt: null,
    finishedMonotonicAt: null,
    failedAt: null,
    failedMonotonicAt: null,
    status: "started",
    startedMeaning: "browser-play-accepted",
    error: null,
    soundId: "default",
    featureVolume: 0.8,
    masterVolume: 0.5,
    effectiveVolume: 0.4,
    visibilityState: "visible",
    ...overrides,
  };
}

function createMedia(
  frame: SkillIncidentFrame,
  observation: SkillIncidentObservation,
  reason: SkillIncidentMedia["reason"],
): SkillIncidentMedia {
  const id = `media:${frame.id}:${reason}`;
  frame.mediaIds.push(id);
  observation.mediaIds.push(id);
  return {
    id,
    frameId: frame.id,
    observationId: observation.id,
    skillIds: observation.skillIds,
    targetId: observation.targetId,
    capturedAt: frame.sampledAt,
    reason,
    variant:
      frame.mode === "quickslot-countdown"
        ? "quickslot-raw"
        : "precision-source",
    mimeType: "image/png",
    dataUrl: `data:image/png;base64,${id}`,
  };
}

function createConfiguration(
  epoch: SkillIncidentEpoch,
  capturedAt: number,
): SkillIncidentConfigurationRevision {
  return {
    id: `config:${epoch.skillId}:1`,
    skillId: epoch.skillId,
    epochId: epoch.id,
    capturedAt,
    values: {
      mode: epoch.mode,
      targetId: epoch.targetId,
      thresholdSeconds: 5,
      repeatCount: 2,
      repeatIntervalSeconds: 5,
    },
  };
}

function event(
  epoch: SkillIncidentEpoch,
  category: SkillIncidentLifecycleEvent["category"],
  action: string,
  occurredAt: number,
): SkillIncidentLifecycleEvent {
  return {
    id: `${category}:${action}`,
    skillId: epoch.skillId,
    epochId: epoch.id,
    occurredAt,
    monotonicAt: occurredAt,
    category,
    action,
    frameId: null,
    cycleId: null,
    configRevisionId: `config:${epoch.skillId}:1`,
    details: {},
  };
}

function parserDecision(boxCount: number, rowCount: number) {
  return {
    boxCount,
    rowCount,
    eligibleBoxCount: boxCount,
    candidateCount: boxCount,
    decisionReason: null,
  };
}

function matcherDecision(accepted: boolean, reason: string | null) {
  return {
    accepted,
    candidateCount: 1,
    decisionReason: reason,
    bundleId: "janus-v1",
    modelVersion: "v1",
    score: accepted ? 0.99 : 0.1,
    threshold: 0.8,
    margin: accepted ? 0.19 : -0.7,
    gateMargin: accepted ? 0.1 : -0.1,
  };
}

function valueDecision(
  decision: SkillIncidentObservation["value"]["decision"],
  rawValue: number | null,
  reason: string | null,
) {
  return {
    kind: "countdown" as const,
    rawValue,
    text: rawValue === null ? null : String(rawValue),
    confidence: rawValue === null ? null : 0.99,
    decision,
    reason,
  };
}

function countDecision(rawValue: number) {
  return {
    kind: "remaining-count" as const,
    rawValue,
    text: String(rawValue),
    confidence: 0.99,
    decision: "accepted" as const,
    reason: null,
  };
}

function countFlow(
  confirmedValue: number,
  expectedMin: number,
  expectedMax: number,
  decisionReason: string,
  pendingDropObservations = 0,
) {
  return {
    confirmedValue,
    expectedMin,
    expectedMax,
    decisionReason,
    pendingDropObservations,
    pendingAlertObservations: 0,
  };
}

function state() {
  return {
    status: "tracking",
    observedValue: 30,
    estimatedExpiresAt: null,
    alertedAt: null,
    lastRepeatedAlertAt: null,
    repeatedAlertCount: 0,
    lastAlertCycleStartedAt: null,
    initialAlertDelaySeconds: null,
    initialAlertDelayCycleStartedAt: null,
    rejectedValue: null,
    pendingReason: null,
  };
}
