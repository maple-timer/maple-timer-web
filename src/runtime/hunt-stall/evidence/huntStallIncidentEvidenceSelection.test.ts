import { describe, expect, it } from "vitest";
import type {
  AlertIssueOtherCategory,
  AlertIssueScenario,
} from "../../../contracts/reporting/alertIssueScenario";
import {
  HUNT_STALL_INCIDENT_MAX_RELATED_PLAYBACK,
  createHuntStallIncidentEvidenceArchive,
  freezeHuntStallIncidentEvidence,
} from "./huntStallIncidentEvidenceArchive";
import {
  selectHuntStallReportIncident,
  type HuntStallIncidentOperatorConclusion,
} from "./huntStallIncidentEvidenceSelection";
import type {
  FrozenHuntStallIncidentEvidence,
  HuntStallIncidentActivityEpoch,
  HuntStallIncidentAlertCycle,
  HuntStallIncidentAlertDecision,
  HuntStallIncidentConfigurationRevision,
  HuntStallIncidentEvidenceArchive,
  HuntStallIncidentFrame,
  HuntStallIncidentFrozenState,
  HuntStallIncidentLifecycleEvent,
  HuntStallIncidentMediaFrame,
  HuntStallIncidentMode,
  HuntStallIncidentObservation,
  HuntStallIncidentPlaybackAttempt,
  HuntStallIncidentRelatedPlayback,
  HuntStallIncidentReportLease,
  HuntStallIncidentResetEpoch,
  HuntStallIncidentStallEpisode,
} from "./huntStallIncidentEvidenceTypes";

const FROZEN_AT = 100_000;

type ScenarioFixture = {
  reason: string;
  scenario: AlertIssueScenario;
  otherCategory?: AlertIssueOtherCategory | null;
  expected: HuntStallIncidentOperatorConclusion;
};

const SCENARIO_FIXTURES: Record<string, ScenarioFixture> = {
  H1: {
    reason: "hunt-stall-missed",
    scenario: "not-recognized",
    expected: "recognition-rejected",
  },
  H2: {
    reason: "hunt-stall-missed",
    scenario: "recognized-no-alert",
    expected: "decision-suppressed",
  },
  H3: {
    reason: "hunt-stall-missed",
    scenario: "playback-missing",
    expected: "decision-without-playback",
  },
  H4: {
    reason: "hunt-stall-missed",
    scenario: "repeat-missing",
    expected: "repeat-decision-missing",
  },
  H5: {
    reason: "hunt-stall-false-alert",
    scenario: "wrong-target",
    expected: "false-alert-chain-found",
  },
  H6: {
    reason: "hunt-stall-false-alert",
    scenario: "duplicate-alert",
    expected: "same-cycle-alerts-found",
  },
  H7: {
    reason: "hunt-stall-false-alert",
    scenario: "unexpected-playback",
    expected: "playback-presentation-mismatch",
  },
  H8: {
    reason: "hunt-stall-reading",
    scenario: "wrong-target",
    expected: "sampled-region-found",
  },
  H9: {
    reason: "hunt-stall-reading",
    scenario: "wrong-value",
    expected: "temporal-correction-found",
  },
  H10: {
    reason: "hunt-stall-reading",
    scenario: "unstable-value",
    expected: "unstable-sequence-found",
  },
  H11: {
    reason: "other",
    scenario: "other",
    otherCategory: "status-display",
    expected: "presentation-event-found",
  },
  H12: {
    reason: "other",
    scenario: "other",
    otherCategory: "sound-volume",
    expected: "audio-configuration-found",
  },
  H13: {
    reason: "other",
    scenario: "other",
    otherCategory: "settings-preset",
    expected: "configuration-transition-found",
  },
  H14: {
    reason: "other",
    scenario: "other",
    otherCategory: "performance-error",
    expected: "runtime-error-found",
  },
  H15: {
    reason: "other",
    scenario: "other",
    otherCategory: "interaction",
    expected: "interaction-event-found",
  },
  H16: {
    reason: "other",
    scenario: "other",
    otherCategory: "other",
    expected: "unsupported-other",
  },
};

describe("hunt stall incident evidence selection", () => {
  for (const mode of ["manual-experience", "cooldown-presence"] as const) {
    describe(mode, () => {
      for (const [id, fixture] of Object.entries(SCENARIO_FIXTURES)) {
        it(`selects ${id} with an explicit operator conclusion`, () => {
          const evidence = createScenarioEvidence(id, mode);
          const selection = selectHuntStallReportIncident({
            evidence,
            reason: fixture.reason,
            scenario: fixture.scenario,
            occurrence: "current",
            otherCategory: fixture.otherCategory,
          });
          const expected =
            id === "H4" && mode === "cooldown-presence"
              ? "repeat-not-applicable"
              : fixture.expected;

          expect(selection.operatorConclusion).toBe(expected);
          expect(selection.mode).toBe(mode);
          expect(selection.resetEpochId).toBe(evidence.lease.resetEpochId);
          if (id === "H5") {
            expect(selection.externalPlayerActivity).toBe("unknown");
          }
          if (id === "H16" || (id === "H4" && mode === "cooldown-presence")) {
            expect(selection.support).toBe("unsupported");
          } else {
            expect(selection.anchorKind).not.toBeNull();
            expect(selection.candidateIds.length).toBeGreaterThan(0);
          }
        });
      }
    });
  }

  it.each([
    ["not-due", "threshold-not-reached"],
    ["suppressed", "decision-suppressed"],
    ["stale", "decision-stale"],
    ["blocked", "decision-blocked"],
    ["alert", "decision-missing"],
  ] as const)("distinguishes no-alert evaluation outcome %s", (outcome, expected) => {
    const evidence = createScenarioEvidence("H2", "manual-experience", {
      evaluationOutcome: outcome,
    });
    const selection = selectHuntStallReportIncident({
      evidence,
      reason: "hunt-stall-missed",
      scenario: "recognized-no-alert",
      occurrence: "current",
    });

    expect(selection.operatorConclusion).toBe(expected);
    expect(selection.stallEpisodeIds).toHaveLength(1);
    expect(selection.frameIds).toContain("frame:manual-experience:3");
  });

  it.each([
    ["manual-experience", "baseline-established"],
    ["manual-experience", "pending-progress"],
    ["cooldown-presence", "presence-pending"],
  ] as const)(
    "explains an accepted but unconfirmed %s %s observation",
    (mode, transitionKind) => {
      const archive = createScenarioArchive("H1", mode);
      archive.observations[2] = createObservation(archive.frames[2], {
        decision: "accepted",
        transitionKind,
      });
      const frozen = freezeHuntStallIncidentEvidence({
        archive,
        lease: createLease(mode, archive, FROZEN_AT),
      });
      const selection = selectNotRecognized(frozen, "current");

      expect(selection.operatorConclusion).toBe("recognition-unconfirmed");
      expect(selection.observationIds).toEqual([
        `observation:${mode}:3`,
      ]);
    },
  );

  it.each([
    ["manual-experience", "baseline-established"],
    ["cooldown-presence", "presence-pending"],
  ] as const)(
    "distinguishes a recognized but unarmed %s episode",
    (mode, transitionKind) => {
      const archive = createScenarioArchive("H1", mode);
      archive.observations[2] = createObservation(archive.frames[2], {
        decision: "accepted",
        transitionKind,
      });
      const frozen = freezeHuntStallIncidentEvidence({
        archive,
        lease: createLease(mode, archive, FROZEN_AT),
      });
      const selection = selectHuntStallReportIncident({
        evidence: frozen,
        reason: "hunt-stall-missed",
        scenario: "recognized-no-alert",
        occurrence: "current",
      });

      expect(selection.operatorConclusion).toBe("episode-not-armed");
      expect(selection.stallEpisodeIds).toEqual([]);
    },
  );

  it("keeps unreadable-time exclusion in the selected threshold evaluation", () => {
    const archive = createScenarioArchive("H2", "manual-experience", {
      evaluationOutcome: "not-due",
    });
    archive.stallEpisodes[0].lastEvaluation = {
      ...archive.stallEpisodes[0].lastEvaluation!,
      elapsedMs: 4_000,
      thresholdMs: 5_000,
      excludedUnreadableMs: 3_000,
      thresholdReached: false,
      outcome: "not-due",
      reason: "unreadable-time-excluded",
    };
    const frozen = freezeHuntStallIncidentEvidence({
      archive,
      lease: createLease("manual-experience", archive, FROZEN_AT),
    });
    const selection = selectHuntStallReportIncident({
      evidence: frozen,
      reason: "hunt-stall-missed",
      scenario: "recognized-no-alert",
      occurrence: "current",
    });
    const selectedEpisode = frozen.stallEpisodes.find((entry) =>
      selection.stallEpisodeIds.includes(entry.id),
    );

    expect(selection.operatorConclusion).toBe("threshold-not-reached");
    expect(selectedEpisode?.lastEvaluation).toMatchObject({
      excludedUnreadableMs: 3_000,
      reason: "unreadable-time-excluded",
    });
  });

  it("selects a reset that closed the episode before it became due", () => {
    const mode = "manual-experience";
    const archive = createScenarioArchive("H1", mode);
    archive.lifecycleEvents = [
      createEvent(
        "worker-reset-before-due",
        "lifecycle",
        FROZEN_AT - 500,
        "worker-reset",
        mode,
      ),
    ];
    const frozen = freezeHuntStallIncidentEvidence({
      archive,
      lease: createLease(mode, archive, FROZEN_AT),
    });
    const selection = selectHuntStallReportIncident({
      evidence: frozen,
      reason: "hunt-stall-missed",
      scenario: "recognized-no-alert",
      occurrence: "current",
    });

    expect(selection.operatorConclusion).toBe(
      "episode-reset-before-threshold",
    );
    expect(selection.eventIds).toEqual(["event:worker-reset-before-due"]);
  });

  it.each([
    [undefined, "decision-without-playback", "definitive"],
    ["requested", "playback-requested-only", "definitive"],
    ["failed", "playback-failed", "definitive"],
    ["started", "physical-audibility-unverifiable", "partial"],
    ["finished", "physical-audibility-unverifiable", "partial"],
  ] as const)("distinguishes playback lifecycle %s", (status, expected, support) => {
    const evidence = createScenarioEvidence("H3", "manual-experience", {
      playbackStatus: status,
    });
    const selection = selectHuntStallReportIncident({
      evidence,
      reason: "hunt-stall-missed",
      scenario: "playback-missing",
      occurrence: "current",
    });

    expect(selection.operatorConclusion).toBe(expected);
    expect(selection.support).toBe(support);
    expect(selection.physicalAudibility).toBe("unknown");
  });

  it("distinguishes repeat due, limits, and in-flight playback", () => {
    const cases = [
      {
        expected: "repeat-disabled",
        overrides: { repeatEnabled: false },
      },
      {
        expected: "repeat-not-due",
        overrides: { attemptFinishedAt: FROZEN_AT - 1_000 },
      },
      {
        expected: "repeat-limit-reached",
        overrides: { repeatDecisionCount: 1, repeatMaxCount: 1 },
      },
      {
        expected: "repeat-blocked-by-playback",
        overrides: { playbackStatus: "started" as const },
      },
    ];

    for (const testCase of cases) {
      const evidence = createScenarioEvidence(
        "H4",
        "manual-experience",
        testCase.overrides,
      );
      const selection = selectHuntStallReportIncident({
        evidence,
        reason: "hunt-stall-missed",
        scenario: "repeat-missing",
        occurrence: "current",
      });
      expect(selection.operatorConclusion).toBe(testCase.expected);
    }
  });

  it("uses exact current and recent inclusive time boundaries", () => {
    const current = createSingleFrameEvidence(FROZEN_AT - 10_000);
    const currentExpired = createSingleFrameEvidence(FROZEN_AT - 10_001);
    const recent = createSingleFrameEvidence(FROZEN_AT - 60_000);
    const recentExpired = createSingleFrameEvidence(FROZEN_AT - 60_001);

    expect(selectNotRecognized(current, "current").status).toBe(
      "current-snapshot",
    );
    expect(selectNotRecognized(currentExpired, "current").status).toBe(
      "outside-retention",
    );
    expect(selectNotRecognized(currentExpired, "recent").status).toBe(
      "matched",
    );
    expect(selectNotRecognized(recent, "recent").status).toBe("matched");
    expect(selectNotRecognized(recentExpired, "recent").status).toBe(
      "outside-retention",
    );
  });

  it("never substitutes report-time context for production evidence", () => {
    const evidence = createSingleFrameEvidence(FROZEN_AT - 1_000, "report-time");
    const selection = selectNotRecognized(evidence, "current");

    expect(selection.status).toBe("unavailable");
    expect(selection.operatorConclusion).toBe("report-time-context-only");
    expect(selection.degradationReasons).toContain("report-time-only");
  });

  it("marks historical reports unsupported even when newer evidence exists", () => {
    const evidence = createScenarioEvidence("H5", "manual-experience");
    const selection = selectHuntStallReportIncident({
      evidence,
      reason: "hunt-stall-false-alert",
      scenario: "wrong-target",
      occurrence: "historical",
    });

    expect(selection.status).toBe("outside-retention");
    expect(selection.operatorConclusion).toBe("evidence-outside-retention");
    expect(selection.degradationReasons).toEqual(["outside-retention"]);
  });

  it("keeps an old active anchor only as context for a current evaluation", () => {
    const archive = createScenarioArchive("H2", "manual-experience");
    archive.frames[0].sampledAt = 1_000;
    archive.observations[0].sampledAt = 1_000;
    archive.activityEpochs[0].startedAt = 1_000;
    archive.stallEpisodes[0].startedAt = 1_000;
    const frozen = freezeHuntStallIncidentEvidence({
      archive,
      lease: createLease("manual-experience", archive, FROZEN_AT),
    });
    const selection = selectHuntStallReportIncident({
      evidence: frozen,
      reason: "hunt-stall-missed",
      scenario: "recognized-no-alert",
      occurrence: "current",
    });

    expect(selection.selectedEventAt).toBe(FROZEN_AT - 1_000);
    expect(selection.frameIds).toContain("frame:manual-experience:1");
    expect(selection.operatorConclusion).toBe("decision-suppressed");
  });

  it("selects the exact production dimensions and region for a reading report", () => {
    const mode = "cooldown-presence";
    const archive = createScenarioArchive("H8", mode);
    archive.frames[2] = {
      ...archive.frames[2],
      sourceDimensions: { width: 2_560, height: 1_440 },
      region: { x: 1_920, y: 60, width: 180, height: 180 },
      sourceToCrop: {
        scaleX: 0.5,
        scaleY: 0.5,
        offsetX: -960,
        offsetY: -30,
      },
    };
    const frozen = freezeHuntStallIncidentEvidence({
      archive,
      lease: createLease(mode, archive, FROZEN_AT),
    });
    const selection = selectHuntStallReportIncident({
      evidence: frozen,
      reason: "hunt-stall-reading",
      scenario: "wrong-target",
      occurrence: "current",
    });
    const selectedFrame = frozen.frames.find((entry) =>
      selection.frameIds.includes(entry.id),
    );

    expect(selection.operatorConclusion).toBe("sampled-region-found");
    expect(selectedFrame).toMatchObject({
      source: "runtime",
      sourceDimensions: { width: 2_560, height: 1_440 },
      region: { x: 1_920, y: 60, width: 180, height: 180 },
    });
  });

  it("freezes a detached archive at dialog open and reuses it on retry", () => {
    const source = createScenarioArchive("H9", "manual-experience");
    const lease = createLease("manual-experience", source, FROZEN_AT);
    const frozenState = createFrozenState("manual-experience");
    const frozen = freezeHuntStallIncidentEvidence({
      archive: source,
      lease,
      frozenState,
    });
    const before = selectWrongValue(frozen);

    source.frames[2].sampledAt = FROZEN_AT + 10_000;
    source.observations[2].recognition!.correctedValue = 99;
    source.lifecycleEvents.push(
      createEvent("late-event", "interaction", FROZEN_AT + 1, "late-action"),
    );
    frozenState.status = "changed-after-open";
    const firstRetry = selectWrongValue(frozen);
    const secondRetry = selectWrongValue(frozen);

    expect(firstRetry).toEqual(before);
    expect(secondRetry).toEqual(before);
    expect(
      frozen.observations.find((entry) => entry.id.endsWith(":3"))?.recognition
        ?.correctedValue,
    ).toBe(3);
    expect(frozen.frozenState?.status).toBe("watching");
  });

  it("bounds related playback and excludes future or stale records at freeze", () => {
    const source = createScenarioArchive("H7", "manual-experience", {
      omitHuntAttempt: true,
    });
    const relatedPlayback = Array.from(
      { length: HUNT_STALL_INCIDENT_MAX_RELATED_PLAYBACK + 4 },
      (_, index): HuntStallIncidentRelatedPlayback => ({
        id: `related:${index}`,
        feature: "skill",
        requestedAt: FROZEN_AT - 20_000 + index,
        startedAt: null,
        finishedAt: null,
        failedAt: null,
        status: "requested",
      }),
    );
    relatedPlayback.push({
      id: "related:future",
      feature: "skill",
      requestedAt: FROZEN_AT + 1,
      startedAt: null,
      finishedAt: null,
      failedAt: null,
      status: "requested",
    });
    relatedPlayback.push({
      id: "related:stale",
      feature: "skill",
      requestedAt: FROZEN_AT - 60_001,
      startedAt: null,
      finishedAt: null,
      failedAt: null,
      status: "requested",
    });

    const frozen = freezeHuntStallIncidentEvidence({
      archive: source,
      lease: createLease("manual-experience", source, FROZEN_AT),
      relatedPlayback,
    });

    expect(frozen.relatedPlayback).toHaveLength(
      HUNT_STALL_INCIDENT_MAX_RELATED_PLAYBACK,
    );
    expect(frozen.relatedPlayback.map((entry) => entry.id)).not.toContain(
      "related:future",
    );
    expect(frozen.relatedPlayback.map((entry) => entry.id)).not.toContain(
      "related:stale",
    );
  });

  it("does not protect unrelated null-linked lifecycle events", () => {
    const mode = "manual-experience";
    const reset = createReset(mode, 1, 1);
    const config = createConfig(mode, reset.id, 1);
    const archive: HuntStallIncidentEvidenceArchive = {
      ...createHuntStallIncidentEvidenceArchive(FROZEN_AT),
      currentResetEpochId: reset.id,
      currentConfigurationRevisionId: config.id,
      resetEpochs: [reset],
      configurationRevisions: [config],
      lifecycleEvents: [createEvent("old-unrelated", "interaction", 1, "old")],
    };
    const frozen = freezeHuntStallIncidentEvidence({
      archive,
      lease: createLease(mode, archive, FROZEN_AT),
    });

    expect(frozen.lifecycleEvents).toEqual([]);
    expect(frozen.omissions).toContainEqual(
      expect.objectContaining({ kind: "event", reason: "outside-retention" }),
    );
  });

  it.each([
    [
      "manual-experience",
      ["baseline-established", "pending-progress", "activity-confirmed"],
    ],
    ["cooldown-presence", ["armed", "unreadable", "rearmed"]],
  ] as const)("keeps the ordered %s transition sequence", (mode, transitions) => {
    const archive = createScenarioArchive("H10", mode);
    archive.observations = archive.observations.map((entry, index) => ({
      ...entry,
      transition: {
        ...entry.transition!,
        kind: transitions[index],
      },
    }));
    const frozen = freezeHuntStallIncidentEvidence({
      archive,
      lease: createLease(mode, archive, FROZEN_AT),
    });
    const selection = selectHuntStallReportIncident({
      evidence: frozen,
      reason: "hunt-stall-reading",
      scenario: "unstable-value",
      occurrence: "current",
    });

    expect(selection.operatorConclusion).toBe("unstable-sequence-found");
    expect(selection.observationIds).toEqual(
      archive.observations.map((entry) => entry.id),
    );
    expect(selection.mode).toBe(mode);
  });

  it("does not let a post-open reset or adjacent mode replace the leased incident", () => {
    const source = createScenarioArchive("H1", "manual-experience");
    const lease = createLease("manual-experience", source, FROZEN_AT);
    const lateFrame = createFrame(
      "manual-experience",
      4,
      FROZEN_AT - 500,
      { id: "frame:manual-experience:late-response" },
    );
    source.frames.push(lateFrame);
    source.observations.push(
      createObservation(lateFrame, {
        id: "observation:manual-experience:late-response",
        decision: "rejected",
      }),
    );
    source.resetEpochs.push(createReset("cooldown-presence", 2, FROZEN_AT + 1));
    source.frames.push(
      createFrame("cooldown-presence", 4, FROZEN_AT + 1, {
        resetEpochId: "reset:cooldown-presence:2",
      }),
    );
    const frozen = freezeHuntStallIncidentEvidence({ archive: source, lease });
    const selection = selectNotRecognized(frozen, "current");

    expect(selection.mode).toBe("manual-experience");
    expect(selection.frameIds).not.toContain("frame:cooldown-presence:4");
    expect(selection.frameIds).not.toContain(
      "frame:manual-experience:late-response",
    );
    expect(frozen.frames.every((entry) => entry.sampledAt <= FROZEN_AT)).toBe(true);
  });

  it("attributes another feature playback without inventing a Hunt attempt", () => {
    const evidence = createScenarioEvidence("H7", "manual-experience", {
      omitHuntAttempt: true,
      relatedPlayback: [
        {
          id: "skill-playback:1",
          feature: "skill",
          requestedAt: FROZEN_AT - 1_000,
          startedAt: FROZEN_AT - 900,
          finishedAt: FROZEN_AT - 500,
          failedAt: null,
          status: "finished",
        },
      ],
    });
    const selection = selectHuntStallReportIncident({
      evidence,
      reason: "hunt-stall-false-alert",
      scenario: "unexpected-playback",
      occurrence: "current",
    });

    expect(selection.operatorConclusion).toBe(
      "unrelated-feature-playback-found",
    );
    expect(selection.attemptIds).toEqual([]);
    expect(selection.relatedPlaybackIds).toEqual(["skill-playback:1"]);
  });

  it("reports exact media-pressure degradation for the selected frame", () => {
    const evidence = createScenarioEvidence("H9", "manual-experience");
    const selectedFrameId = "frame:manual-experience:3";
    evidence.media = evidence.media.filter(
      (entry) => entry.frameId !== selectedFrameId,
    );
    evidence.omissions.push({
      id: "omission:media-budget",
      occurredAt: FROZEN_AT,
      kind: "media",
      reason: "media-budget",
      subjectIds: [selectedFrameId],
      count: 1,
    });
    const selection = selectWrongValue(evidence);

    expect(selection.operatorConclusion).toBe("temporal-correction-found");
    expect(selection.support).toBe("partial");
    expect(selection.degradationReasons).toContain("media-budget");
  });

  it("does not treat an unrelated expired record as scenario evidence", () => {
    const evidence = createScenarioEvidence("H1", "manual-experience");
    evidence.frames = [];
    evidence.observations = [];
    evidence.media = [];
    evidence.omissions = [
      {
        id: "omission:old-config",
        occurredAt: FROZEN_AT,
        kind: "configuration",
        reason: "outside-retention",
        subjectIds: ["config:unrelated"],
        count: 1,
      },
    ];
    const selection = selectNotRecognized(evidence, "recent");

    expect(selection.status).toBe("unavailable");
    expect(selection.operatorConclusion).toBe("evidence-unavailable");
  });

  it("rejects malformed and legacy evidence without reading hidden fields", () => {
    const malformed = selectHuntStallReportIncident({
      evidence: { schemaVersion: "old", secretConclusion: "alerted" },
      reason: "hunt-stall-missed",
      scenario: "recognized-no-alert",
      occurrence: "current",
    });

    expect(malformed.operatorConclusion).toBe("legacy-evidence-unavailable");
    expect(malformed.degradationReasons).toEqual(["legacy-unavailable"]);
    expect(malformed.candidateIds).toEqual([]);

    const valid = createScenarioEvidence("H1", "manual-experience");
    const malformedLease = selectHuntStallReportIncident({
      evidence: { ...valid, lease: {} },
      reason: "hunt-stall-missed",
      scenario: "not-recognized",
      occurrence: "current",
    });
    expect(malformedLease.operatorConclusion).toBe(
      "legacy-evidence-unavailable",
    );
  });

  it("marks simultaneous chains ambiguous instead of merging their evidence", () => {
    const first = createScenarioArchive("H1", "manual-experience");
    const secondReset = createReset("manual-experience", 2, 1);
    const secondConfig = createConfig("manual-experience", secondReset.id, 2);
    const secondFrame = createFrame("manual-experience", 3, FROZEN_AT - 1_000, {
      id: "frame:manual-experience:other",
      resetEpochId: secondReset.id,
      configRevisionId: secondConfig.id,
    });
    const secondObservation = createObservation(secondFrame, {
      id: "observation:manual-experience:other",
      decision: "rejected",
    });
    first.resetEpochs.push(secondReset);
    first.configurationRevisions.push(secondConfig);
    first.frames.push(secondFrame);
    first.observations.push(secondObservation);
    const frozen = freezeHuntStallIncidentEvidence({
      archive: first,
      lease: createLease("manual-experience", first, FROZEN_AT),
    });
    const selection = selectNotRecognized(frozen, "current");

    expect(selection.operatorConclusion).toBe("ambiguous-incident");
    expect(selection.ambiguous).toBe(true);
    expect(selection.degradationReasons).toContain("ambiguous-incident");
    expect(selection.frameIds).toHaveLength(1);
  });
});

type ScenarioOverrides = {
  evaluationOutcome?: NonNullable<HuntStallIncidentStallEpisode["lastEvaluation"]>["outcome"];
  playbackStatus?: HuntStallIncidentPlaybackAttempt["status"];
  attemptFinishedAt?: number;
  repeatEnabled?: boolean;
  repeatDecisionCount?: number;
  repeatMaxCount?: number | null;
  omitHuntAttempt?: boolean;
  relatedPlayback?: HuntStallIncidentRelatedPlayback[];
};

function createScenarioEvidence(
  id: string,
  mode: HuntStallIncidentMode,
  overrides: ScenarioOverrides = {},
): FrozenHuntStallIncidentEvidence {
  const archive = createScenarioArchive(id, mode, overrides);
  return freezeHuntStallIncidentEvidence({
    archive,
    lease: createLease(mode, archive, FROZEN_AT),
    frozenState: createFrozenState(mode),
    relatedPlayback: overrides.relatedPlayback,
  });
}

function createScenarioArchive(
  id: string,
  mode: HuntStallIncidentMode,
  overrides: ScenarioOverrides = {},
): HuntStallIncidentEvidenceArchive {
  const reset = createReset(mode, 1, 1);
  const config = createConfig(mode, reset.id, 1, {
    repeatAlertEnabled:
      overrides.repeatEnabled ?? mode === "manual-experience",
    repeatAlertMaxCount: overrides.repeatMaxCount ?? 3,
  });
  const frames = [
    createFrame(mode, 1, FROZEN_AT - 7_000),
    createFrame(mode, 2, FROZEN_AT - 4_000),
    createFrame(mode, 3, FROZEN_AT - 1_000),
  ];
  const observations = frames.map((frame) => createObservation(frame));
  const activity = createActivity(mode, reset.id, frames[0], observations[0]);
  const episode = createEpisode(mode, reset.id, activity.id, frames[2], observations[2], {
    outcome: overrides.evaluationOutcome ?? "alert",
  });
  const cycle = createCycle(mode, reset.id, activity.id, episode.id);
  const initialDecision = createDecision(
    "initial",
    1,
    cycle,
    activity,
    episode,
    frames[1],
    observations[1],
    config,
    FROZEN_AT - 4_000,
  );
  const playbackStatus = overrides.playbackStatus ?? "finished";
  const initialAttempt = createAttempt(
    1,
    cycle,
    activity,
    episode,
    initialDecision,
    config,
    playbackStatus,
    overrides.attemptFinishedAt,
  );
  const repeatDecision = createDecision(
    "repeat",
    2,
    cycle,
    activity,
    episode,
    frames[2],
    observations[2],
    config,
    FROZEN_AT - 1_000,
  );
  const repeatAttempt = createAttempt(
    2,
    cycle,
    activity,
    episode,
    repeatDecision,
    config,
    "finished",
  );
  const media = frames.map(createMedia);
  const archive: HuntStallIncidentEvidenceArchive = {
    ...createHuntStallIncidentEvidenceArchive(FROZEN_AT),
    currentResetEpochId: reset.id,
    currentConfigurationRevisionId: config.id,
    resetEpochs: [reset],
    configurationRevisions: [config],
    frames,
    observations,
    activityEpochs: [activity],
    stallEpisodes: [episode],
    alertCycles: [],
    decisions: [],
    playbackAttempts: [],
    lifecycleEvents: [],
    media,
  };

  switch (id) {
    case "H1":
      archive.activityEpochs = [];
      archive.stallEpisodes = [];
      archive.observations[2] = createObservation(frames[2], {
        decision: "rejected",
        reason: "foreground-gate",
      });
      break;
    case "H2":
      archive.stallEpisodes[0] = {
        ...episode,
        lastEvaluation: {
          ...episode.lastEvaluation!,
          outcome: overrides.evaluationOutcome ?? "suppressed",
          thresholdReached: overrides.evaluationOutcome !== "not-due",
        },
      };
      break;
    case "H3":
      archive.alertCycles = [cycle];
      archive.decisions = [initialDecision];
      if (overrides.playbackStatus) archive.playbackAttempts = [initialAttempt];
      break;
    case "H4": {
      const dueAttempt = createAttempt(
        1,
        cycle,
        activity,
        episode,
        initialDecision,
        config,
        overrides.playbackStatus ?? "finished",
        overrides.attemptFinishedAt ?? FROZEN_AT - 6_000,
      );
      archive.alertCycles = [cycle];
      archive.decisions = [initialDecision];
      archive.playbackAttempts = [dueAttempt];
      if ((overrides.repeatDecisionCount ?? 0) > 0) {
        archive.decisions.push(repeatDecision);
        archive.playbackAttempts.push(repeatAttempt);
      }
      break;
    }
    case "H5":
      archive.alertCycles = [cycle];
      archive.decisions = [initialDecision];
      archive.playbackAttempts = [initialAttempt];
      break;
    case "H6":
      archive.alertCycles = [cycle];
      archive.decisions = [initialDecision, repeatDecision];
      archive.playbackAttempts = [initialAttempt, repeatAttempt];
      break;
    case "H7":
      archive.alertCycles = [cycle];
      archive.decisions = [initialDecision];
      archive.playbackAttempts = overrides.omitHuntAttempt ? [] : [initialAttempt];
      break;
    case "H8":
      break;
    case "H9":
      archive.observations[2] = createObservation(frames[2], {
        rawValue: 8,
        correctedValue: 3,
        transitionKind: "rejected",
      });
      break;
    case "H10":
      archive.observations = [
        createObservation(frames[0], {
          rawValue: 10,
          correctedValue: 10,
          transitionKind: "unchanged",
        }),
        createObservation(frames[1], {
          rawValue: 3,
          correctedValue: 10,
          transitionKind: "pending-progress",
        }),
        createObservation(frames[2], {
          rawValue: 8,
          correctedValue: 8,
          transitionKind: "rejected",
        }),
      ];
      break;
    case "H11":
      archive.lifecycleEvents = [
        createEvent(
          "presentation",
          "presentation",
          FROZEN_AT - 1_000,
          "status-published",
          mode,
        ),
      ];
      break;
    case "H12":
      archive.alertCycles = [cycle];
      archive.decisions = [initialDecision];
      archive.playbackAttempts = [initialAttempt];
      break;
    case "H13":
      archive.lifecycleEvents = [
        createEvent(
          "configuration",
          "configuration",
          FROZEN_AT - 1_000,
          "preset-replaced",
          mode,
        ),
      ];
      break;
    case "H14":
      archive.frames[2] = {
        ...frames[2],
        source: "runtime-error",
        runtimeFailure: {
          stage: "recognition",
          code: "worker-timeout",
          message: "worker timed out",
          durationMs: 1_500,
          recovered: false,
        },
      };
      archive.lifecycleEvents = [
        createEvent(
          "runtime-error",
          "runtime-error",
          FROZEN_AT - 1_000,
          "worker-timeout",
          mode,
        ),
      ];
      break;
    case "H15":
      archive.lifecycleEvents = [
        createEvent(
          "interaction",
          "interaction",
          FROZEN_AT - 1_000,
          "region-picker-complete",
          mode,
        ),
      ];
      break;
    case "H16":
      break;
  }
  return archive;
}

function createSingleFrameEvidence(
  sampledAt: number,
  source: HuntStallIncidentFrame["source"] = "runtime",
): FrozenHuntStallIncidentEvidence {
  const mode = "manual-experience";
  const reset = createReset(mode, 1, 1);
  const config = createConfig(mode, reset.id, 1);
  const frame = createFrame(mode, 1, sampledAt, { source });
  const observation = createObservation(frame, { decision: "rejected" });
  const archive: HuntStallIncidentEvidenceArchive = {
    ...createHuntStallIncidentEvidenceArchive(FROZEN_AT),
    currentResetEpochId: reset.id,
    currentConfigurationRevisionId: config.id,
    resetEpochs: [reset],
    configurationRevisions: [config],
    frames: [frame],
    observations: [observation],
    media: [createMedia(frame)],
  };
  return freezeHuntStallIncidentEvidence({
    archive,
    lease: {
      ...createLease(mode, archive, FROZEN_AT),
      leasedThroughFrameSequence: 1,
    },
  });
}

function createReset(
  mode: HuntStallIncidentMode,
  sequence: number,
  startedAt: number,
): HuntStallIncidentResetEpoch {
  return {
    id: `reset:${mode}:${sequence}`,
    sessionId: "session",
    sequence,
    startedAt,
    reason: sequence === 1 ? "initialized" : "mode-changed",
    continuity: {
      captureGeneration: sequence,
      featureGeneration: sequence,
      workerGeneration: sequence,
      mode,
      layoutKey: `layout:${mode}`,
      regionRevision: `region:${mode}`,
    },
  };
}

function createConfig(
  mode: HuntStallIncidentMode,
  resetEpochId: string,
  sequence: number,
  overrides: Partial<
    HuntStallIncidentConfigurationRevision["values"]
  > = {},
): HuntStallIncidentConfigurationRevision {
  return {
    id: `config:${mode}:${sequence}`,
    resetEpochId,
    sequence,
    capturedAt: sequence,
    fingerprint: `config-fingerprint:${mode}:${sequence}`,
    values: {
      enabled: true,
      mode,
      thresholdSeconds: 5,
      repeatAlertEnabled: mode === "manual-experience",
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: 3,
      soundId: "sound:default",
      featureVolume: 0.8,
      masterVolume: 0.5,
      effectiveVolume: 0.4,
      ...overrides,
    },
  };
}

function createFrame(
  mode: HuntStallIncidentMode,
  sequence: number,
  sampledAt: number,
  overrides: Partial<HuntStallIncidentFrame> = {},
): HuntStallIncidentFrame {
  return {
    id: `frame:${mode}:${sequence}`,
    resetEpochId: `reset:${mode}:1`,
    configRevisionId: `config:${mode}:1`,
    sequence,
    sampledAt,
    mode,
    layoutKey: `layout:${mode}`,
    regionRevision: `region:${mode}`,
    source: "runtime",
    sourceDimensions: { width: 1920, height: 1080 },
    region: { x: 100, y: 100, width: 360, height: 120 },
    sourceToCrop: { scaleX: 1, scaleY: 1, offsetX: -100, offsetY: -100 },
    recognizer: {
      engine: mode === "manual-experience" ? "ocr" : "cooldown-presence",
      modelId: "model",
      modelVersion: "v1",
      workerVersion: "worker-v1",
      provider: "wasm",
    },
    runtimeFailure: null,
    ...overrides,
  };
}

function createObservation(
  frame: HuntStallIncidentFrame,
  overrides: {
    id?: string;
    decision?: "accepted" | "rejected" | "missing" | "error";
    reason?: string;
    rawValue?: number | null;
    correctedValue?: number | null;
    transitionKind?: NonNullable<HuntStallIncidentObservation["transition"]>["kind"];
  } = {},
): HuntStallIncidentObservation {
  return {
    id: overrides.id ?? `observation:${frame.mode}:${frame.sequence}`,
    resetEpochId: frame.resetEpochId,
    frameId: frame.id,
    frameSequence: frame.sequence,
    sampledAt: frame.sampledAt,
    mode: frame.mode,
    recognition: {
      decision: overrides.decision ?? "accepted",
      reason: overrides.reason ?? null,
      rawText: String(overrides.rawValue ?? 10),
      rawValue: overrides.rawValue ?? 10,
      correctedValue: overrides.correctedValue ?? overrides.rawValue ?? 10,
      fingerprint: `fingerprint:${frame.sequence}`,
      confidence: 0.99,
      foregroundRatio: 0.5,
      visualActivityScore: 0.8,
      visualChangeScore: 0.7,
      usedVisualFallback: false,
      readableStreak: frame.sequence,
      visualActivityStreak: frame.sequence,
      failure: null,
    },
    transition: {
      kind: overrides.transitionKind ?? "unchanged",
      reason: overrides.reason ?? null,
      elapsedMs: 5_000,
      thresholdMs: 5_000,
      shouldAlert: overrides.transitionKind === "threshold-reached",
    },
  };
}

function createActivity(
  mode: HuntStallIncidentMode,
  resetEpochId: string,
  frame: HuntStallIncidentFrame,
  observation: HuntStallIncidentObservation,
): HuntStallIncidentActivityEpoch {
  return {
    id: `activity:${mode}:1`,
    resetEpochId,
    sequence: 1,
    mode,
    startedAt: frame.sampledAt,
    anchorFrameId: frame.id,
    anchorFrameSequence: frame.sequence,
    anchorObservationId: observation.id,
    reason:
      mode === "manual-experience"
        ? "manual-progress-confirmed"
        : "cooldown-presence-confirmed",
    endedAt: null,
    terminalReason: null,
  };
}

function createEpisode(
  mode: HuntStallIncidentMode,
  resetEpochId: string,
  activityEpochId: string,
  frame: HuntStallIncidentFrame,
  observation: HuntStallIncidentObservation,
  overrides: {
    outcome: NonNullable<HuntStallIncidentStallEpisode["lastEvaluation"]>["outcome"];
  },
): HuntStallIncidentStallEpisode {
  return {
    id: `episode:${mode}:1`,
    resetEpochId,
    activityEpochId,
    sequence: 1,
    mode,
    startedAt: FROZEN_AT - 7_000,
    status: "active",
    alertCycleId: null,
    endedAt: null,
    terminalReason: null,
    lastEvaluation: {
      frameId: frame.id,
      observationId: observation.id,
      evaluatedAt: frame.sampledAt,
      elapsedMs: 6_000,
      thresholdMs: 5_000,
      excludedUnreadableMs: 0,
      thresholdReached: true,
      outcome: overrides.outcome,
      reason: overrides.outcome === "alert" ? null : `reason:${overrides.outcome}`,
    },
  };
}

function createCycle(
  mode: HuntStallIncidentMode,
  resetEpochId: string,
  activityEpochId: string,
  stallEpisodeId: string,
): HuntStallIncidentAlertCycle {
  return {
    id: `cycle:${mode}:1`,
    resetEpochId,
    activityEpochId,
    stallEpisodeId,
    sequence: 1,
    mode,
    startedAt: FROZEN_AT - 5_000,
    initialDecisionId: `decision:${mode}:initial:1`,
    status: "active",
    endedAt: null,
    terminalReason: null,
  };
}

function createDecision(
  kind: "initial" | "repeat",
  sequence: number,
  cycle: HuntStallIncidentAlertCycle,
  activity: HuntStallIncidentActivityEpoch,
  episode: HuntStallIncidentStallEpisode,
  frame: HuntStallIncidentFrame,
  observation: HuntStallIncidentObservation,
  config: HuntStallIncidentConfigurationRevision,
  occurredAt: number,
): HuntStallIncidentAlertDecision {
  return {
    id: `decision:${cycle.mode}:${kind}:${sequence}`,
    resetEpochId: cycle.resetEpochId,
    activityEpochId: activity.id,
    stallEpisodeId: episode.id,
    cycleId: cycle.id,
    sequence,
    kind,
    occurredAt,
    frameId: frame.id,
    observationId: observation.id,
    configRevisionId: config.id,
    dueAt: occurredAt,
    evaluation: { outcome: "alert", reason: null },
  };
}

function createAttempt(
  sequence: number,
  cycle: HuntStallIncidentAlertCycle,
  activity: HuntStallIncidentActivityEpoch,
  episode: HuntStallIncidentStallEpisode,
  decision: HuntStallIncidentAlertDecision,
  config: HuntStallIncidentConfigurationRevision,
  status: HuntStallIncidentPlaybackAttempt["status"],
  finishedAtOverride?: number,
): HuntStallIncidentPlaybackAttempt {
  const defaultRequestedAt = decision.occurredAt + 10;
  const requestedAt =
    status === "finished" && finishedAtOverride !== undefined
      ? Math.min(defaultRequestedAt, finishedAtOverride - 100)
      : defaultRequestedAt;
  return {
    id: `attempt:${cycle.mode}:${sequence}`,
    resetEpochId: cycle.resetEpochId,
    activityEpochId: activity.id,
    stallEpisodeId: episode.id,
    cycleId: cycle.id,
    decisionId: decision.id,
    sequence,
    requestedAt,
    startedAt: status === "requested" ? null : requestedAt + 10,
    finishedAt:
      status === "finished" ? finishedAtOverride ?? requestedAt + 100 : null,
    failedAt: status === "failed" ? requestedAt + 100 : null,
    status,
    error: status === "failed" ? "NotAllowedError" : null,
    configRevisionId: config.id,
    soundId: config.values.soundId,
    featureVolume: config.values.featureVolume,
    masterVolume: config.values.masterVolume,
    effectiveVolume: config.values.effectiveVolume,
    visibilityState: "visible",
  };
}

function createEvent(
  id: string,
  category: HuntStallIncidentLifecycleEvent["category"],
  occurredAt: number,
  action: string,
  mode: HuntStallIncidentMode = "manual-experience",
): HuntStallIncidentLifecycleEvent {
  return {
    id: `event:${id}`,
    resetEpochId: `reset:${mode}:1`,
    occurredAt,
    category,
    action,
    frameId: null,
    observationId: null,
    activityEpochId: null,
    stallEpisodeId: null,
    cycleId: null,
    attemptId: null,
    configRevisionId: `config:${mode}:1`,
    details: { action },
  };
}

function createMedia(frame: HuntStallIncidentFrame): HuntStallIncidentMediaFrame {
  return {
    id: `media:${frame.id}`,
    frameId: frame.id,
    resetEpochId: frame.resetEpochId,
    sampledAt: frame.sampledAt,
    reason: frame.sequence === 3 ? "value-transition" : "periodic",
    rawDataUrl: `data:image/webp;base64,raw-${frame.id}`,
    processedDataUrl: `data:image/webp;base64,processed-${frame.id}`,
  };
}

function createLease(
  mode: HuntStallIncidentMode,
  archive: HuntStallIncidentEvidenceArchive,
  frozenAt: number,
): HuntStallIncidentReportLease {
  const latestAttempt = archive.playbackAttempts[archive.playbackAttempts.length - 1];
  return {
    id: `lease:${mode}:1`,
    resetEpochId: `reset:${mode}:1`,
    configRevisionId: `config:${mode}:1`,
    sequence: 1,
    frozenAt,
    leasedThroughFrameSequence: 3,
    mode,
    layoutKey: `layout:${mode}`,
    regionRevision: `region:${mode}`,
    activityEpochId: archive.activityEpochs[0]?.id ?? null,
    stallEpisodeId: archive.stallEpisodes[0]?.id ?? null,
    alertCycleId: archive.alertCycles[0]?.id ?? null,
    playbackAttemptId: latestAttempt?.id ?? null,
  };
}

function createFrozenState(
  mode: HuntStallIncidentMode,
): HuntStallIncidentFrozenState {
  return {
    capturedAt: FROZEN_AT,
    resetEpochId: `reset:${mode}:1`,
    configRevisionId: `config:${mode}:1`,
    mode,
    enabled: true,
    status: "watching",
    decision: "waiting",
    presentationRevision: "presentation:1",
    latestFrameId: `frame:${mode}:3`,
    latestObservationId: `observation:${mode}:3`,
    activityEpochId: `activity:${mode}:1`,
    stallEpisodeId: `episode:${mode}:1`,
    alertCycleId: null,
    playbackAttemptId: null,
  };
}

function selectNotRecognized(
  evidence: FrozenHuntStallIncidentEvidence,
  occurrence: "current" | "recent",
) {
  return selectHuntStallReportIncident({
    evidence,
    reason: "hunt-stall-missed",
    scenario: "not-recognized",
    occurrence,
  });
}

function selectWrongValue(evidence: FrozenHuntStallIncidentEvidence) {
  return selectHuntStallReportIncident({
    evidence,
    reason: "hunt-stall-reading",
    scenario: "wrong-value",
    occurrence: "current",
  });
}
