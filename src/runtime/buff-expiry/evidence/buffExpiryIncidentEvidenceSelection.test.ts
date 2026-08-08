import { describe, expect, it } from "vitest";
import type {
  AlertIssueOtherCategory,
  AlertIssueScenario,
} from "../../../contracts/reporting/alertIssueScenario";
import type { BuffExpiryTargetGroup } from "../../../contracts/recognition/buffExpiryRecognition";
import {
  createBuffExpiryIncidentEvidenceArchive,
  freezeBuffExpiryIncidentEvidence,
  updateBuffExpiryIncidentEvidenceArchive,
  type BuffExpiryIncidentEvidencePatch,
} from "./buffExpiryIncidentEvidenceArchive";
import { selectBuffExpiryReportIncident } from "./buffExpiryIncidentEvidenceSelection";
import type {
  BuffExpiryIncidentCycle,
  BuffExpiryIncidentEpisode,
  BuffExpiryIncidentEpisodeTransition,
  BuffExpiryIncidentEpoch,
  BuffExpiryIncidentFrame,
  BuffExpiryIncidentMedia,
  BuffExpiryIncidentObservation,
  BuffExpiryIncidentPlaybackAttempt,
  BuffExpiryIncidentRuntimeEvent,
  FrozenBuffExpiryIncidentEvidence,
} from "./buffExpiryIncidentEvidenceTypes";
import {
  createBuffExpiryIncidentAttemptId,
  createBuffExpiryIncidentCycleId,
  createBuffExpiryIncidentEpisodeId,
  createBuffExpiryIncidentEpochId,
  createBuffExpiryIncidentFrameId,
  createBuffExpiryIncidentObservationId,
} from "./buffExpiryIncidentEvidenceTypes";

const FROZEN_AT = 60_000;

describe("selectBuffExpiryReportIncident", () => {
  it("uses the inclusive ten-second current boundary and excludes report-time context", () => {
    const epoch = createEpoch();
    const outside = createFrame(epoch, 1, 49_999);
    const boundary = createFrame(epoch, 2, 50_000);
    const reportTime = {
      ...createFrame(epoch, 3, 59_000),
      source: "report-time" as const,
    };
    const evidence = createEvidence(epoch, {
      frames: [outside, boundary, reportTime],
      media: [media(outside), media(boundary), media(reportTime)],
    });

    const selection = select(evidence, {
      reason: "buff-expiry-missed",
      scenario: "not-recognized",
      occurrence: "current",
      affectedTargetId: "unionLuck",
    });

    expect(selection).toMatchObject({
      status: "current-snapshot",
      support: "definitive",
      anchorKind: "frame",
      frameIds: [boundary.id],
      mediaFrameIds: [boundary.id],
      ambiguous: false,
    });
    expect(selection.candidateIds).toEqual([boundary.id]);
  });

  it("does not turn retained evidence into a historical diagnosis", () => {
    const epoch = createEpoch();
    const frame = createFrame(epoch, 1, 55_000);
    const selection = select(
      createEvidence(epoch, { frames: [frame], media: [media(frame)] }),
      {
        reason: "buff-expiry-missed",
        scenario: "not-recognized",
        occurrence: "historical",
        affectedTargetId: "unknown",
      },
    );

    expect(selection).toMatchObject({
      status: "outside-retention",
      support: "unsupported",
      degradationReasons: ["outside-retention"],
    });
  });

  it("does not use a no-candidate frame for a group that was not analyzed", () => {
    const epoch = createEpoch();
    const frame = {
      ...createFrame(epoch, 1, 55_000),
      selectedGroups: ["potion" as const],
    };
    const selection = select(
      createEvidence(epoch, { frames: [frame], media: [media(frame)] }),
      {
        reason: "buff-expiry-missed",
        scenario: "not-recognized",
        affectedTargetId: "unionLuck",
      },
    );

    expect(selection).toMatchObject({
      status: "unavailable",
      support: "unsupported",
      degradationReasons: ["never-produced"],
    });
  });

  it("selects a rejected observation for only the reported target group", () => {
    const epoch = createEpoch();
    const frame = createFrame(epoch, 1, 55_000);
    const rejectedLuck = createObservation(frame, "unionLuck", 0, {
      targetAccepted: false,
    });
    const acceptedPotion = createObservation(frame, "potion", 1, {
      targetAccepted: true,
      countdown: acceptedCountdown(30),
    });
    frame.observationIds = [rejectedLuck.id, acceptedPotion.id];
    const evidence = createEvidence(epoch, {
      frames: [frame],
      observations: [rejectedLuck, acceptedPotion],
      media: [media(frame, "rejected-observation")],
    });

    const selection = select(evidence, {
      reason: "buff-expiry-missed",
      scenario: "not-recognized",
      affectedTargetId: "unionLuck",
    });

    expect(selection).toMatchObject({
      affectedGroup: "unionLuck",
      observationIds: [rejectedLuck.id],
      frameIds: [frame.id],
      support: "definitive",
    });
    expect(selection.observationIds).not.toContain(acceptedPotion.id);
  });

  it.each([
    "row-ineligible-upper-half",
    "cross_bundle_conflict",
    "target-bundle-rejected",
  ])("keeps the exact negative decision for %s", (decisionReason) => {
    const epoch = createEpoch();
    const frame = createFrame(epoch, 1, 55_000);
    const observation = createObservation(frame, "unionLuck", 0, {
      targetAccepted: false,
      winningGroup:
        decisionReason === "cross_bundle_conflict" ? null : "unionLuck",
      decisionReason,
      bundleDecisions:
        decisionReason === "cross_bundle_conflict"
          ? [
              bundleDecision("unionLuck", true),
              bundleDecision("potion", true),
            ]
          : [bundleDecision("unionLuck", false)],
    });
    frame.observationIds = [observation.id];

    const selection = select(
      createEvidence(epoch, {
        frames: [frame],
        observations: [observation],
        media: [media(frame, "rejected-observation")],
      }),
      {
        reason: "buff-expiry-missed",
        scenario: "not-recognized",
        affectedTargetId: "unionLuck",
      },
    );

    expect(selection).toMatchObject({
      frameIds: [frame.id],
      observationIds: [observation.id],
      support: "definitive",
    });
  });

  it.each([
    ["frame-capture", "canvas-context-unavailable"],
    ["parser", "parser-session-create-failed"],
    ["matcher", "matcher-worker-timeout"],
    ["countdown", "countdown-inference-failed"],
  ])("keeps typed %s failure evidence", (stage, code) => {
    const epoch = createEpoch();
    const frame = {
      ...createFrame(epoch, 1, 55_000),
      source: "runtime-error" as const,
      runtimeFailure: {
        stage,
        code,
        message: code,
        provider: "wasm",
        recoverable: true,
      },
    };
    const selection = select(
      createEvidence(epoch, {
        frames: [frame],
        media: [media(frame, "current")],
      }),
      {
        reason: "buff-expiry-missed",
        scenario: "not-recognized",
        affectedTargetId: "unknown",
      },
    );

    expect(selection).toMatchObject({
      anchorKind: "frame",
      frameIds: [frame.id],
      support: "definitive",
    });
  });

  it("binds a missing countdown to its accepted target episode", () => {
    const epoch = createEpoch();
    const frame = createFrame(epoch, 1, 54_000);
    const episode = createEpisode(epoch, "unionLuck", 1, 53_000, 54_000);
    const observation = createObservation(frame, "unionLuck", 0, {
      episodeId: episode.id,
      targetAccepted: true,
      countdown: {
        text: null,
        seconds: null,
        status: "missing",
        confidence: null,
        decision: "missing",
        reason: "no-digits",
      },
    });
    frame.observationIds = [observation.id];
    episode.observationIds = [observation.id];
    const selection = select(
      createEvidence(epoch, {
        frames: [frame],
        observations: [observation],
        episodes: [episode],
        media: [media(frame, "accepted-observation")],
      }),
      {
        reason: "buff-expiry-missed",
        scenario: "wrong-value",
        affectedTargetId: "unionLuck",
      },
    );

    expect(selection).toMatchObject({
      anchorKind: "observation",
      episodeIds: [episode.id],
      observationIds: [observation.id],
      support: "definitive",
    });
  });

  it("selects one ordered episode for an unstable countdown", () => {
    const epoch = createEpoch();
    const frame = createFrame(epoch, 1, 55_000);
    const episode = createEpisode(epoch, "expCoupon", 1, 52_000, 55_000);
    const observation = createObservation(frame, "expCoupon", 0, {
      episodeId: episode.id,
      targetAccepted: true,
      countdown: acceptedCountdown(3),
    });
    const transitions = [
      transition(episode, 53_000, "observed", 8),
      transition(episode, 54_000, "countdown-rejected", 3),
      transition(episode, 55_000, "observed", 6),
    ];
    episode.observationIds = [observation.id];
    episode.transitionIds = transitions.map((entry) => entry.id);
    frame.observationIds = [observation.id];
    const selection = select(
      createEvidence(epoch, {
        frames: [frame],
        observations: [observation],
        episodes: [episode],
        transitions,
        media: [media(frame, "accepted-observation")],
      }),
      {
        reason: "buff-expiry-reading",
        scenario: "unstable-value",
        affectedTargetId: "expCoupon",
      },
    );

    expect(selection).toMatchObject({
      anchorKind: "episode",
      episodeIds: [episode.id],
      frameIds: [frame.id],
      support: "definitive",
    });
  });

  it("keeps one episode across a valid decrease, impossible jump, refresh, and recovery", () => {
    const epoch = createEpoch();
    const episode = createEpisode(epoch, "unionWealth", 1, 50_000, 56_000);
    const frames = [51_000, 52_000, 53_000, 54_000, 55_000, 56_000].map(
      (sampledAt, index) => createFrame(epoch, index + 1, sampledAt),
    );
    const values = [10, 9, 3, 8, 60, 59];
    const decisions = [
      "accepted",
      "accepted",
      "implausible",
      "accepted",
      "accepted",
      "accepted",
    ] as const;
    const observations = frames.map((frame, index) => {
      const observation = createObservation(frame, "unionWealth", 0, {
        episodeId: episode.id,
        targetAccepted: true,
        countdown: {
          text: String(values[index]),
          seconds: values[index],
          status: "high",
          confidence: 0.99,
          decision: decisions[index],
          reason: decisions[index] === "implausible" ? "impossible-jump" : null,
        },
      });
      frame.observationIds = [observation.id];
      return observation;
    });
    const transitions = [
      transition(episode, 51_000, "observed", 10),
      transition(episode, 52_000, "observed", 9),
      transition(episode, 53_000, "countdown-rejected", 3),
      transition(episode, 54_000, "observed", 8),
      transition(episode, 55_000, "refreshed", 60),
      transition(episode, 56_000, "observed", 59),
    ];
    episode.observationIds = observations.map((entry) => entry.id);
    episode.transitionIds = transitions.map((entry) => entry.id);
    const evidence = createEvidence(epoch, {
      frames,
      observations,
      episodes: [episode],
      transitions,
      media: frames.map((frame) => media(frame, "accepted-observation")),
    });

    const wrongValue = select(evidence, {
      reason: "buff-expiry-reading",
      scenario: "wrong-value",
      affectedTargetId: "unionWealth",
    });
    const unstable = select(evidence, {
      reason: "buff-expiry-reading",
      scenario: "unstable-value",
      affectedTargetId: "unionWealth",
    });

    expect(wrongValue.observationIds).toEqual([observations[2].id]);
    expect(wrongValue.episodeIds).toEqual([episode.id]);
    expect(unstable.episodeIds).toEqual([episode.id]);
    expect(unstable.frameIds).toEqual(frames.map((entry) => entry.id));
  });

  it("chooses the latest confirmed episode without an alert and ignores an older fired cycle", () => {
    const epoch = createEpoch();
    const oldEpisode = createEpisode(epoch, "unionWealth", 1, 40_000, 45_000);
    const oldCycle = createCycle(epoch, [oldEpisode], 46_000, "fired");
    oldEpisode.cycleIds = [oldCycle.id];
    const currentEpisode = createEpisode(
      epoch,
      "unionWealth",
      2,
      52_000,
      58_000,
    );
    const selection = select(
      createEvidence(epoch, {
        episodes: [oldEpisode, currentEpisode],
        cycles: [oldCycle],
      }),
      {
        reason: "buff-expiry-missed",
        scenario: "recognized-no-alert",
        affectedTargetId: "unionWealth",
      },
    );

    expect(selection).toMatchObject({
      anchorKind: "episode",
      episodeIds: [currentEpisode.id],
      cycleIds: [],
      support: "definitive",
    });
  });

  it("binds a failed playback attempt to the fired cycle and episode", () => {
    const epoch = createEpoch();
    const episode = createEpisode(epoch, "potion", 1, 50_000, 55_000);
    const cycle = createCycle(epoch, [episode], 56_000, "fired");
    episode.cycleIds = [cycle.id];
    const attempt = createAttempt(cycle, 1, 56_010, "failed");
    const selection = select(
      createEvidence(epoch, {
        episodes: [episode],
        cycles: [cycle],
        attempts: [attempt],
      }),
      {
        reason: "buff-expiry-missed",
        scenario: "playback-missing",
        affectedTargetId: "potion",
      },
    );

    expect(selection).toMatchObject({
      anchorKind: "cycle",
      episodeIds: [episode.id],
      cycleIds: [cycle.id],
      attemptIds: [attempt.id],
      support: "definitive",
    });
  });

  it("keeps a browser-started attempt for a user-reported missing sound", () => {
    const epoch = createEpoch();
    const episode = createEpisode(epoch, "potion", 1, 50_000, 55_000);
    const cycle = createCycle(epoch, [episode], 56_000, "fired");
    episode.cycleIds = [cycle.id];
    const attempt = createAttempt(cycle, 1, 56_010, "started");
    const selection = select(
      createEvidence(epoch, {
        episodes: [episode],
        cycles: [cycle],
        attempts: [attempt],
      }),
      {
        reason: "buff-expiry-missed",
        scenario: "playback-missing",
        affectedTargetId: "potion",
      },
    );

    expect(selection).toMatchObject({
      cycleIds: [cycle.id],
      attemptIds: [attempt.id],
      support: "definitive",
    });
  });

  it("retains a long-running active episode and registered cycle as current state", () => {
    const epoch = createEpoch();
    const episode = createEpisode(epoch, "unionLuck", 1, 1_000, 1_000);
    const cycle = createCycle(epoch, [episode], 120_000, "registered");
    cycle.createdAt = 2_000;
    cycle.updatedAt = 2_000;
    episode.cycleIds = [cycle.id];
    const frozenState = {
      capturedAt: FROZEN_AT,
      epochId: epoch.id,
      status: "tracking",
      activeEpisodeIds: [episode.id],
      pendingEpisodeIds: [],
      scheduledCycleIds: [cycle.id],
      configRevision: "cfg-test",
      provider: "webgpu",
    };
    const selection = select(
      createEvidence(
        epoch,
        { episodes: [episode], cycles: [cycle] },
        frozenState,
      ),
      {
        reason: "buff-expiry-missed",
        scenario: "recognized-no-alert",
        occurrence: "current",
        affectedTargetId: "unionLuck",
      },
    );

    expect(selection).toMatchObject({
      status: "current-snapshot",
      episodeIds: [episode.id],
      cycleIds: [cycle.id],
      support: "definitive",
    });
  });

  it.each([
    ["registered", "not-due"],
    ["rescheduled", "lead-changed"],
    ["cancelled", "feature-reset"],
    ["suppressed", "existing-alert-group"],
  ] as const)("keeps %s scheduling state for diagnosis", (status, terminalReason) => {
    const epoch = createEpoch();
    const episode = createEpisode(epoch, "unionLuck", 1, 50_000, 56_000);
    const cycle = createCycle(epoch, [episode], 57_000, status);
    cycle.eventIds = [`${cycle.id}:${status}`];
    episode.cycleIds = [cycle.id];
    const selection = select(
      createEvidence(epoch, {
        episodes: [episode],
        cycles: [cycle],
        cycleEvents: [
          {
            id: cycle.eventIds[0],
            cycleId: cycle.id,
            occurredAt: 57_000,
            status,
            reason: terminalReason,
            frameId: null,
          },
        ],
      }),
      {
        reason: "buff-expiry-missed",
        scenario: "recognized-no-alert",
        affectedTargetId: "unionLuck",
      },
    );

    expect(selection).toMatchObject({
      episodeIds: [episode.id],
      cycleIds: [cycle.id],
      support: "definitive",
    });
  });

  it("keeps the trigger chain for a false-target alert", () => {
    const epoch = createEpoch();
    const frame = createFrame(epoch, 1, 55_000);
    const episode = createEpisode(epoch, "unionLuck", 1, 52_000, 55_000);
    const observation = createObservation(frame, "unionLuck", 0, {
      episodeId: episode.id,
      targetAccepted: true,
      countdown: acceptedCountdown(5),
    });
    frame.observationIds = [observation.id];
    episode.observationIds = [observation.id];
    const cycle = createCycle(epoch, [episode], 56_000, "fired");
    episode.cycleIds = [cycle.id];
    const selection = select(
      createEvidence(epoch, {
        frames: [frame],
        observations: [observation],
        episodes: [episode],
        cycles: [cycle],
        media: [media(frame, "fired-trigger")],
      }),
      {
        reason: "buff-expiry-false-alert",
        scenario: "wrong-target",
        affectedTargetId: "unionLuck",
      },
    );

    expect(selection).toMatchObject({
      anchorKind: "cycle",
      frameIds: [frame.id],
      observationIds: [observation.id],
      episodeIds: [episode.id],
      cycleIds: [cycle.id],
      mediaFrameIds: [frame.id],
      support: "definitive",
    });
  });

  it("keeps only the two latest comparable attempts for a duplicate alert", () => {
    const epoch = createEpoch();
    const episode = createEpisode(epoch, "potion", 1, 40_000, 58_000);
    const cycles = [50_000, 54_000, 58_000].map((at) =>
      createCycle(epoch, [episode], at, "fired"),
    );
    episode.cycleIds = cycles.map((entry) => entry.id);
    const attempts = cycles.map((cycle, index) =>
      createAttempt(cycle, index + 1, cycle.updatedAt, "started"),
    );
    const selection = select(
      createEvidence(epoch, { episodes: [episode], cycles, attempts }),
      {
        reason: "buff-expiry-false-alert",
        scenario: "duplicate-alert",
        affectedTargetId: "potion",
      },
    );

    expect(selection.cycleIds).toEqual([cycles[1].id, cycles[2].id]);
    expect(selection.attemptIds).toEqual([attempts[1].id, attempts[2].id]);
    expect(selection).toMatchObject({
      anchorKind: "attempt",
      ambiguous: true,
      support: "partial",
      degradationReasons: ["ambiguous-target"],
    });
  });

  it("identifies an unexpected started playback without substituting another feature", () => {
    const epoch = createEpoch();
    const episode = createEpisode(epoch, "expCoupon", 1, 50_000, 56_000);
    const cycle = createCycle(epoch, [episode], 56_000, "fired");
    episode.cycleIds = [cycle.id];
    const attempt = createAttempt(cycle, 1, 56_000, "started");
    const selection = select(
      createEvidence(epoch, {
        episodes: [episode],
        cycles: [cycle],
        attempts: [attempt],
      }),
      {
        reason: "buff-expiry-false-alert",
        scenario: "unexpected-playback",
        affectedTargetId: "expCoupon",
      },
    );

    expect(selection).toMatchObject({
      anchorKind: "attempt",
      attemptIds: [attempt.id],
      cycleIds: [cycle.id],
      episodeIds: [episode.id],
      support: "definitive",
    });
  });

  it("does not merge two concurrent potion episodes", () => {
    const epoch = createEpoch();
    const frame = createFrame(epoch, 1, 55_000);
    const first = createEpisode(epoch, "potion", 1, 50_000, 54_000);
    const second = createEpisode(epoch, "potion", 2, 51_000, 55_000);
    const firstObservation = createObservation(frame, "potion", 0, {
      episodeId: first.id,
      targetAccepted: true,
      countdown: acceptedCountdown(30),
    });
    const secondObservation = createObservation(frame, "potion", 1, {
      episodeId: second.id,
      targetAccepted: true,
      countdown: acceptedCountdown(40),
    });
    frame.observationIds = [firstObservation.id, secondObservation.id];
    first.observationIds = [firstObservation.id];
    second.observationIds = [secondObservation.id];
    const selection = select(
      createEvidence(epoch, {
        frames: [frame],
        observations: [firstObservation, secondObservation],
        episodes: [first, second],
        media: [media(frame, "accepted-observation")],
      }),
      {
        reason: "buff-expiry-reading",
        scenario: "wrong-target",
        affectedTargetId: "potion",
      },
    );

    expect(selection.episodeIds).toEqual([second.id]);
    expect(selection.observationIds).toEqual([secondObservation.id]);
    expect(selection).toMatchObject({
      ambiguous: true,
      support: "partial",
      degradationReasons: ["ambiguous-target"],
    });
  });

  it("treats a same-slot replacement as a new single-group episode", () => {
    const epoch = createEpoch();
    const firstFrame = createFrame(epoch, 1, 52_000);
    const secondFrame = createFrame(epoch, 2, 56_000);
    const first = createEpisode(epoch, "unionLuck", 1, 50_000, 52_000);
    first.status = "terminal";
    first.endedAt = 53_000;
    first.terminalReason = "replaced";
    const second = createEpisode(epoch, "unionLuck", 2, 54_000, 56_000);
    const firstObservation = createObservation(firstFrame, "unionLuck", 0, {
      episodeId: first.id,
      targetAccepted: true,
      countdown: acceptedCountdown(10),
    });
    const secondObservation = createObservation(secondFrame, "unionLuck", 0, {
      episodeId: second.id,
      targetAccepted: true,
      countdown: acceptedCountdown(40),
    });
    firstFrame.observationIds = [firstObservation.id];
    secondFrame.observationIds = [secondObservation.id];
    first.observationIds = [firstObservation.id];
    second.observationIds = [secondObservation.id];
    const selection = select(
      createEvidence(epoch, {
        frames: [firstFrame, secondFrame],
        observations: [firstObservation, secondObservation],
        episodes: [first, second],
        media: [
          media(firstFrame, "track-replacement"),
          media(secondFrame, "accepted-observation"),
        ],
      }),
      {
        reason: "buff-expiry-reading",
        scenario: "wrong-target",
        affectedTargetId: "unionLuck",
      },
    );

    expect(selection.episodeIds).toEqual([second.id]);
    expect(selection.observationIds).toEqual([secondObservation.id]);
    expect(selection.ambiguous).toBe(false);
  });

  it("reuses the same frozen incident after a failed submit instead of selecting a later one", () => {
    const epoch = createEpoch();
    const originalFrame = createFrame(epoch, 1, 55_000);
    const archive = updateBuffExpiryIncidentEvidenceArchive({
      previous: createBuffExpiryIncidentEvidenceArchive({ epoch }),
      epoch,
      now: FROZEN_AT,
      patch: {
        frames: [originalFrame],
        media: [media(originalFrame)],
      },
    });
    const frozen = freezeBuffExpiryIncidentEvidence({
      archive,
      capturedAt: FROZEN_AT,
    });
    const laterFrame = createFrame(epoch, 2, 61_000);
    updateBuffExpiryIncidentEvidenceArchive({
      previous: archive,
      epoch,
      now: 61_000,
      patch: { frames: [laterFrame], media: [media(laterFrame)] },
    });
    const options = {
      reason: "buff-expiry-missed",
      scenario: "not-recognized" as const,
      affectedTargetId: "unknown",
    };

    expect(select(frozen, options).frameIds).toEqual([originalFrame.id]);
    expect(select(frozen, options).frameIds).toEqual([originalFrame.id]);
  });

  it.each<{
    category: AlertIssueOtherCategory;
    expectedAnchor: string;
  }>([
    { category: "status-display", expectedAnchor: "state" },
    { category: "sound-volume", expectedAnchor: "attempt" },
    { category: "settings-preset", expectedAnchor: "configuration" },
    { category: "performance-error", expectedAnchor: "event" },
    { category: "interaction", expectedAnchor: "event" },
    { category: "other", expectedAnchor: "event" },
  ])("selects category-compatible evidence for $category", ({ category, expectedAnchor }) => {
    const epoch = createEpoch();
    const frame = {
      ...createFrame(epoch, 1, 52_000),
      source: "runtime-error" as const,
      runtimeFailure: {
        stage: "matcher",
        code: "matcher-failed",
        message: "failed",
        provider: "wasm",
        recoverable: true,
      },
    };
    const episode = createEpisode(epoch, "unionLuck", 1, 50_000, 53_000);
    const cycle = createCycle(epoch, [episode], 54_000, "fired");
    episode.cycleIds = [cycle.id];
    const attempt = createAttempt(cycle, 1, 54_000, "started");
    const events: BuffExpiryIncidentRuntimeEvent[] = [
      runtimeEvent(epoch, "config", 53_000, "configuration", "profile-applied"),
      runtimeEvent(epoch, "error", 54_000, "runtime-error", "worker-failed"),
      runtimeEvent(epoch, "interaction", 55_000, "interaction", "target-changed"),
      runtimeEvent(epoch, "other", 56_000, "presentation", "panel-updated"),
    ];
    const evidence = createEvidence(
      epoch,
      {
        frames: [frame],
        episodes: [episode],
        cycles: [cycle],
        attempts: [attempt],
        runtimeEvents: events,
        configurationRevisions: [
          { id: "cfg-test", capturedAt: 53_000, values: { enabled: true } },
        ],
      },
      {
        capturedAt: FROZEN_AT,
        epochId: epoch.id,
        status: "tracking",
        activeEpisodeIds: [episode.id],
        pendingEpisodeIds: [],
        scheduledCycleIds: [cycle.id],
        configRevision: "cfg-test",
        provider: "wasm",
      },
    );

    const selection = select(evidence, {
      reason: "other",
      scenario: "other",
      affectedTargetId: "unionLuck",
      otherCategory: category,
    });

    expect(selection.anchorKind).toBe(expectedAnchor);
    expect(selection.support).not.toBe("unsupported");
  });

  it("reports the exact reason when selected media was not retained", () => {
    const epoch = createEpoch();
    const frame = createFrame(epoch, 1, 55_000);
    const evidence = createEvidence(epoch, {
      frames: [frame],
      omissions: [
        {
          id: "media-omission",
          occurredAt: 55_000,
          kind: "media",
          reason: "media-budget-exhausted",
          subjectIds: [frame.id],
          count: 1,
        },
      ],
    });
    const selection = select(evidence, {
      reason: "buff-expiry-missed",
      scenario: "not-recognized",
      affectedTargetId: "unknown",
    });

    expect(selection).toMatchObject({
      support: "partial",
      degradationReasons: ["media-budget-exhausted"],
    });
  });
});

type SelectOptions = {
  reason: string;
  scenario: AlertIssueScenario;
  occurrence?: "current" | "recent" | "historical";
  affectedTargetId: string;
  otherCategory?: AlertIssueOtherCategory | null;
};

function select(
  evidence: FrozenBuffExpiryIncidentEvidence,
  options: SelectOptions,
) {
  return selectBuffExpiryReportIncident({
    evidence,
    reason: options.reason,
    scenario: options.scenario,
    occurrence: options.occurrence ?? "recent",
    affectedTargetId: options.affectedTargetId,
    otherCategory: options.otherCategory ?? null,
  });
}

function createEvidence(
  epoch: BuffExpiryIncidentEpoch,
  patch: BuffExpiryIncidentEvidencePatch,
  frozenState: FrozenBuffExpiryIncidentEvidence["frozenState"] = null,
) {
  const archive = updateBuffExpiryIncidentEvidenceArchive({
    previous: createBuffExpiryIncidentEvidenceArchive({ epoch }),
    epoch,
    patch,
    now: FROZEN_AT,
  });
  return freezeBuffExpiryIncidentEvidence({
    archive,
    capturedAt: FROZEN_AT,
    frozenState,
  });
}

function createEpoch(): BuffExpiryIncidentEpoch {
  return {
    id: createBuffExpiryIncidentEpochId({
      captureGeneration: 1,
      featureGeneration: 1,
    }),
    captureGeneration: 1,
    featureGeneration: 1,
    createdAt: 0,
    reason: "test",
  };
}

function createFrame(
  epoch: BuffExpiryIncidentEpoch,
  sequence: number,
  sampledAt: number,
): BuffExpiryIncidentFrame {
  return {
    id: createBuffExpiryIncidentFrameId(epoch.id, sequence),
    epochId: epoch.id,
    sequence,
    sampledAt,
    source: "runtime",
    parser: {
      engine: "dl",
      version: "parser-test",
      provider: "webgpu",
      modelVersion: "model-test",
    },
    recognition: {
      parserBoxCount: 0,
      parsedRowCount: 0,
      upperExcludedBoxCount: 0,
      eligibleBoxCount: 0,
      matcherObservationCount: 0,
      selectedCandidateCount: 0,
      acceptedTargetCount: 0,
    },
    selectedGroups: ["unionLuck", "unionWealth", "potion", "expCoupon"],
    observationIds: [],
    stateBefore: runtimeState(),
    stateAfter: runtimeState(),
    runtimeFailure: null,
    mediaFrameId: null,
  };
}

function createObservation(
  frame: BuffExpiryIncidentFrame,
  group: BuffExpiryTargetGroup,
  boxIndex: number,
  overrides: Partial<BuffExpiryIncidentObservation> = {},
): BuffExpiryIncidentObservation {
  return {
    id: createBuffExpiryIncidentObservationId({
      frameId: frame.id,
      group,
      boxIndex,
    }),
    frameId: frame.id,
    epochId: frame.epochId,
    episodeId: null,
    sampledAt: frame.sampledAt,
    group,
    boxIndex,
    row: 0,
    col: boxIndex,
    targetAccepted: false,
    winningGroup: group,
    decisionReason: "below-threshold",
    bundleDecisions: [
      {
        group,
        accepted: false,
        score: 0.4,
        margin: -0.1,
        gateMargin: -0.1,
        reason: "below-threshold",
      },
    ],
    countdown: null,
    ...overrides,
  };
}

function createEpisode(
  epoch: BuffExpiryIncidentEpoch,
  group: BuffExpiryTargetGroup,
  sequence: number,
  startedAt: number,
  lastEventAt: number,
): BuffExpiryIncidentEpisode {
  return {
    id: createBuffExpiryIncidentEpisodeId({
      epochId: epoch.id,
      group,
      sequence,
    }),
    epochId: epoch.id,
    group,
    sequence,
    status: "confirmed",
    startedAt,
    confirmedAt: startedAt,
    lastEventAt,
    endedAt: null,
    terminalReason: null,
    observationIds: [],
    transitionIds: [],
    cycleIds: [],
  };
}

function transition(
  episode: BuffExpiryIncidentEpisode,
  occurredAt: number,
  kind: BuffExpiryIncidentEpisodeTransition["kind"],
  countdownSeconds: number,
): BuffExpiryIncidentEpisodeTransition {
  return {
    id: `${episode.id}:transition:${occurredAt}:${kind}`,
    episodeId: episode.id,
    occurredAt,
    kind,
    frameId: null,
    observationId: null,
    countdownSeconds,
    reason: kind === "countdown-rejected" ? "implausible-jump" : null,
  };
}

function createCycle(
  epoch: BuffExpiryIncidentEpoch,
  episodes: BuffExpiryIncidentEpisode[],
  occurredAt: number,
  status: BuffExpiryIncidentCycle["status"],
): BuffExpiryIncidentCycle {
  return {
    id: createBuffExpiryIncidentCycleId({
      epochId: epoch.id,
      dueAt: occurredAt,
      episodeIds: episodes.map((entry) => entry.id),
      configRevision: "cfg-test",
    }),
    epochId: epoch.id,
    episodeIds: episodes.map((entry) => entry.id),
    dueAt: occurredAt,
    configRevision: "cfg-test",
    createdAt: occurredAt,
    updatedAt: occurredAt,
    status,
    eventIds: [],
  };
}

function createAttempt(
  cycle: BuffExpiryIncidentCycle,
  sequence: number,
  requestedAt: number,
  status: BuffExpiryIncidentPlaybackAttempt["status"],
): BuffExpiryIncidentPlaybackAttempt {
  return {
    id: createBuffExpiryIncidentAttemptId(cycle.id, sequence),
    cycleId: cycle.id,
    sequence,
    requestedAt,
    startedAt: status === "started" ? requestedAt + 1 : null,
    failedAt: status === "failed" ? requestedAt + 1 : null,
    status,
    error: status === "failed" ? "NotAllowedError" : null,
    soundId: "default",
    featureVolume: 0.8,
    masterVolume: 0.5,
    effectiveVolume: 0.4,
    visibilityState: "visible",
  };
}

function runtimeEvent(
  epoch: BuffExpiryIncidentEpoch,
  id: string,
  occurredAt: number,
  category: BuffExpiryIncidentRuntimeEvent["category"],
  action: string,
): BuffExpiryIncidentRuntimeEvent {
  return {
    id,
    epochId: epoch.id,
    occurredAt,
    category,
    action,
    frameId: null,
    episodeId: null,
    cycleId: null,
    configRevision: category === "configuration" ? "cfg-test" : null,
    details: {},
  };
}

function media(
  frame: BuffExpiryIncidentFrame,
  reason: BuffExpiryIncidentMedia["reason"] = "current",
): BuffExpiryIncidentMedia {
  frame.mediaFrameId = frame.id;
  return {
    frameId: frame.id,
    sampledAt: frame.sampledAt,
    reason,
    dataUrl: `data:image/webp;base64,${frame.id}`,
    sourceSize: { width: 1920, height: 1080 },
    roi: { x: 900, y: 0, width: 1020, height: 389 },
  };
}

function acceptedCountdown(seconds: number) {
  return {
    text: String(seconds),
    seconds,
    status: "high",
    confidence: 0.99,
    decision: "accepted" as const,
    reason: null,
  };
}

function bundleDecision(
  group: BuffExpiryTargetGroup,
  accepted: boolean,
) {
  return {
    group,
    accepted,
    score: accepted ? 0.95 : 0.4,
    margin: accepted ? 0.3 : -0.1,
    gateMargin: accepted ? 0.2 : -0.1,
    reason: accepted ? "target-accepted" : "below-threshold",
  };
}

function runtimeState() {
  return {
    status: "waiting",
    activeEpisodeIds: [],
    pendingEpisodeIds: [],
    scheduledCycleIds: [],
  };
}
