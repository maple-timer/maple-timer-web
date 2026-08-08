import { describe, expect, it } from "vitest";
import {
  SKILL_INCIDENT_MAX_ATTEMPTS,
  SKILL_INCIDENT_MAX_CYCLES,
  SKILL_INCIDENT_MAX_EVENTS,
  SKILL_INCIDENT_MAX_ORDINARY_FRAMES_PER_SKILL,
  SKILL_INCIDENT_MEDIA_MAX_ENTRIES,
  SKILL_INCIDENT_MEDIA_MAX_ENTRY_CHARS,
  SKILL_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
  SKILL_INCIDENT_METADATA_MAX_CHARS,
  compactSkillIncidentEvidenceArchive,
  createSkillIncidentEvidenceArchive,
  enforceSkillIncidentMediaBudget,
  freezeSkillIncidentEvidence,
  getSkillIncidentProjectedMetadataChars,
  updateSkillIncidentEvidenceArchive,
} from "./skillIncidentEvidenceArchive";
import type {
  SkillIncidentAlertDecision,
  SkillIncidentCycle,
  SkillIncidentEpoch,
  SkillIncidentFrame,
  SkillIncidentLifecycleEvent,
  SkillIncidentMedia,
  SkillIncidentObservation,
  SkillIncidentPlaybackAttempt,
} from "./skillIncidentEvidenceTypes";
import {
  createSkillIncidentAttemptId,
  createSkillIncidentCycleId,
  createSkillIncidentDecisionId,
  createSkillIncidentEpochId,
  createSkillIncidentFrameId,
  createSkillIncidentObservationId,
} from "./skillIncidentEvidenceTypes";

describe("skill incident evidence archive", () => {
  it("uses stable skill, epoch, frame, cycle, decision, and attempt identities", () => {
    const firstEpoch = createSkillIncidentEpochId("skill-a", 1);
    const secondEpoch = createSkillIncidentEpochId("skill-a", 2);
    const firstFrame = createSkillIncidentFrameId(firstEpoch, 1);
    const secondFrame = createSkillIncidentFrameId(firstEpoch, 2);
    const cycle = createSkillIncidentCycleId(firstEpoch, 1);
    const decision = createSkillIncidentDecisionId({
      cycleId: cycle,
      kind: "initial",
      sequence: 1,
    });

    expect(firstEpoch).not.toBe(secondEpoch);
    expect(firstFrame).not.toBe(secondFrame);
    expect(createSkillIncidentObservationId(firstFrame, "quickslot:skill-a")).toBe(
      createSkillIncidentObservationId(firstFrame, "quickslot:skill-a"),
    );
    expect(createSkillIncidentAttemptId(decision, 1)).toContain(decision);
  });

  it("enforces per-skill ordinary-frame and aggregate all-skill event caps", () => {
    const now = 100_000;
    const epochs = Array.from({ length: 5 }, (_, index) =>
      createEpoch(`skill-${index}`, 1, 40_000),
    );
    const frames: SkillIncidentFrame[] = [];
    const observations: SkillIncidentObservation[] = [];
    for (const epoch of epochs) {
      for (let index = 0; index < 120; index += 1) {
        const frame = createFrame(epoch, index + 1, 40_000 + index, {
          reasons: ["periodic"],
        });
        const observation = createObservation(frame, {
          recognitionDecision: "accepted",
        });
        frame.observationIds = [observation.id];
        frames.push(frame);
        observations.push(observation);
      }
    }

    const archive = updateSkillIncidentEvidenceArchive({
      previous: null,
      now,
      patch: {
        currentEpochIds: Object.fromEntries(
          epochs.map((entry) => [entry.skillId, entry.id]),
        ),
        epochs,
        frames,
        observations,
      },
    });
    const eventCount =
      archive.frames.length +
      archive.observations.length +
      archive.decisions.length +
      archive.arbitrations.length +
      archive.lifecycleEvents.length;

    expect(eventCount).toBeLessThanOrEqual(SKILL_INCIDENT_MAX_EVENTS);
    for (const epoch of epochs) {
      expect(
        archive.frames.filter((entry) => entry.skillId === epoch.skillId)
          .length,
      ).toBeLessThanOrEqual(SKILL_INCIDENT_MAX_ORDINARY_FRAMES_PER_SKILL);
    }
    expect(
      archive.omissions.some(
        (entry) =>
          entry.reason === "metadata-budget" && entry.kind === "frame",
      ),
    ).toBe(true);
    expect(
      archive.omissions.some(
        (entry) =>
          entry.reason === "metadata-budget" && entry.kind === "event",
      ),
    ).toBe(true);
  });

  it("retains an old compact anchor for an active cycle but expires its image", () => {
    const epoch = createEpoch("skill-a", 1, 0);
    const oldFrame = createFrame(epoch, 1, 10_000, { reasons: ["anchor"] });
    const oldObservation = createObservation(oldFrame);
    oldFrame.observationIds = [oldObservation.id];
    const cycle = createCycle(epoch, 1, 10_000, {
      status: "active",
      lastEventAt: 119_000,
      anchorObservationIds: [oldObservation.id],
      observationIds: [oldObservation.id],
    });
    const archive = updateSkillIncidentEvidenceArchive({
      previous: null,
      now: 120_000,
      patch: {
        currentEpochIds: { "skill-a": epoch.id },
        epochs: [epoch],
        frames: [oldFrame],
        observations: [oldObservation],
        cycles: [cycle],
        media: [createMedia(oldFrame, oldObservation, "anchor", image("old"))],
      },
    });

    expect(archive.frames.map((entry) => entry.id)).toEqual([oldFrame.id]);
    expect(archive.observations.map((entry) => entry.id)).toEqual([
      oldObservation.id,
    ]);
    expect(archive.media).toEqual([]);
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({ reason: "outside-retention", kind: "media" }),
    );
  });

  it("keeps recently closed epochs across a reset and expires them after one minute", () => {
    const first = createEpoch("skill-a", 1, 10_000, 70_000);
    const second = createEpoch("skill-a", 2, 70_000);
    const archive = updateSkillIncidentEvidenceArchive({
      previous: null,
      now: 100_000,
      patch: {
        currentEpochIds: { "skill-a": second.id },
        epochs: [first, second],
      },
    });

    expect(archive.epochs.map((entry) => entry.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(
      compactSkillIncidentEvidenceArchive(archive, 130_001).epochs.map(
        (entry) => entry.id,
      ),
    ).toEqual([second.id]);
  });

  it("caps cycle and playback descriptors while preserving newest records", () => {
    const epoch = createEpoch("skill-a", 1, 40_000);
    const cycles = Array.from({ length: 70 }, (_, index) =>
      createCycle(epoch, index + 1, 40_000 + index),
    );
    const decisions = cycles.flatMap((cycle, cycleIndex) =>
      Array.from({ length: 2 }, (_, attemptIndex) =>
        createDecision(cycle, attemptIndex + 1, 50_000 + cycleIndex * 2 + attemptIndex),
      ),
    );
    const attempts = decisions.map((decision, index) =>
      createAttempt(decision, index + 1, 50_000 + index),
    );
    const archive = updateSkillIncidentEvidenceArchive({
      previous: null,
      now: 100_000,
      patch: {
        currentEpochIds: { "skill-a": epoch.id },
        epochs: [epoch],
        cycles,
        decisions,
        attempts,
      },
    });

    expect(archive.cycles.length).toBeLessThanOrEqual(SKILL_INCIDENT_MAX_CYCLES);
    expect(archive.attempts.length).toBeLessThanOrEqual(
      SKILL_INCIDENT_MAX_ATTEMPTS,
    );
  });

  it("deduplicates shared precision input and protects high-priority media", () => {
    const epoch = createEpoch("skill-a", 1, 40_000, null, "precision-countdown");
    const frame = createFrame(epoch, 1, 90_000);
    const observation = createObservation(frame);
    const shared = image("shared");
    const media = [
      createMedia(frame, observation, "periodic", shared, "shared-periodic"),
      createMedia(frame, observation, "alert-decision", shared, "shared-alert"),
      ...Array.from({ length: 30 }, (_, index) =>
        createMedia(
          frame,
          observation,
          "periodic",
          image(`periodic-${index}`),
          `periodic-${index}`,
        ),
      ),
    ];
    const result = enforceSkillIncidentMediaBudget({ media, now: 100_000 });

    expect(result.deduplicatedCount).toBe(1);
    expect(result.media).toHaveLength(SKILL_INCIDENT_MEDIA_MAX_ENTRIES);
    expect(result.media.some((entry) => entry.id === "shared-alert")).toBe(true);
    expect(result.aliases.get("shared-periodic")).toBe("shared-alert");
    expect(result.retainedChars).toBeLessThanOrEqual(
      SKILL_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
    );
    expect(result.omissions).toContainEqual(
      expect.objectContaining({ reason: "media-budget" }),
    );
  });

  it("rejects oversized exact precision input without modifying it", () => {
    const epoch = createEpoch("skill-a", 1, 0, null, "precision-countdown");
    const frame = createFrame(epoch, 1, 1_000);
    const observation = createObservation(frame);
    const oversized = createMedia(
      frame,
      observation,
      "runtime-error",
      "x".repeat(SKILL_INCIDENT_MEDIA_MAX_ENTRY_CHARS + 1),
      "oversized-source",
    );
    const result = enforceSkillIncidentMediaBudget({
      media: [oversized],
      now: 1_000,
    });

    expect(result.media).toEqual([]);
    expect(result.omissions).toEqual([
      expect.objectContaining({
        reason: "media-oversize",
        subjectIds: ["oversized-source"],
      }),
    ]);
  });

  it("compacts optional metadata under the projected request budget", () => {
    const epoch = createEpoch("skill-a", 1, 40_000);
    const events: SkillIncidentLifecycleEvent[] = Array.from(
      { length: 32 },
      (_, index) => ({
        id: `event-${index}`,
        skillId: "skill-a",
        epochId: epoch.id,
        occurredAt: 60_000 + index,
        monotonicAt: index,
        category: "interaction",
        action: "large-context",
        frameId: null,
        cycleId: null,
        configRevisionId: null,
        details: { value: "x".repeat(16_000) },
      }),
    );
    const archive = updateSkillIncidentEvidenceArchive({
      previous: createSkillIncidentEvidenceArchive(40_000),
      now: 100_000,
      patch: {
        currentEpochIds: { "skill-a": epoch.id },
        epochs: [epoch],
        lifecycleEvents: events,
      },
    });

    expect(getSkillIncidentProjectedMetadataChars(archive)).toBeLessThanOrEqual(
      SKILL_INCIDENT_METADATA_MAX_CHARS,
    );
    expect(archive.lifecycleEvents.length).toBeLessThan(events.length);
    expect(archive.omissions).toContainEqual(
      expect.objectContaining({ reason: "payload-compacted" }),
    );
  });

  it("freezes detached metadata with a stable retry lease and shared media strings", () => {
    const epoch = createEpoch("skill-a", 1, 40_000);
    const frame = createFrame(epoch, 1, 90_000, { reasons: ["value-change"] });
    const observation = createObservation(frame);
    frame.observationIds = [observation.id];
    const media = createMedia(frame, observation, "value-change", image("frame"));
    const archive = updateSkillIncidentEvidenceArchive({
      previous: null,
      now: 100_000,
      patch: {
        currentEpochIds: { "skill-a": epoch.id },
        epochs: [epoch],
        frames: [frame],
        observations: [observation],
        media: [media],
      },
    });
    const first = freezeSkillIncidentEvidence({
      archive,
      selectedSkillId: "skill-a",
      frozenAt: 100_000,
      leaseId: "retry-lease",
    });
    const second = freezeSkillIncidentEvidence({
      archive,
      selectedSkillId: "skill-a",
      frozenAt: 100_000,
      leaseId: "retry-lease",
    });
    archive.frames[0].reasons.push("later-mutation");

    expect(first.leaseId).toBe(second.leaseId);
    expect(first.frames[0].reasons).toEqual(["value-change"]);
    expect(first.media[0].dataUrl).toBe(media.dataUrl);
    expect(second.media[0].id).toBe(first.media[0].id);
  });
});

function createEpoch(
  skillId: string,
  sequence: number,
  createdAt: number,
  closedAt: number | null = null,
  mode: SkillIncidentEpoch["mode"] = "quickslot-countdown",
): SkillIncidentEpoch {
  return {
    id: createSkillIncidentEpochId(skillId, sequence),
    skillId,
    sequence,
    mode,
    targetId:
      mode === "quickslot-countdown" ? `quickslot:${skillId}` : "precision:janus",
    createdAt,
    closedAt,
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
    parser: null,
    matcher: null,
    value: {
      kind: frame.mode === "precision-remaining-count" ? "remaining-count" : "countdown",
      rawValue: 30,
      text: "30",
      confidence: 0.99,
      decision: "accepted",
      reason: null,
    },
    flow: {
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
    status: "terminal",
    startedAt,
    confirmedAt: startedAt,
    lastEventAt: startedAt,
    endedAt: startedAt,
    terminalReason: "completed",
    anchorObservationIds: [],
    observationIds: [],
    decisionIds: [],
    configRevisionIds: [`config:${epoch.skillId}:1`],
    estimatedExpiresAt: startedAt + 30_000,
    confirmedCount: null,
    initialAlertDelaySeconds: 5,
    ...overrides,
  };
}

function createDecision(
  cycle: SkillIncidentCycle,
  sequence: number,
  occurredAt: number,
): SkillIncidentAlertDecision {
  const id = createSkillIncidentDecisionId({
    cycleId: cycle.id,
    kind: sequence === 1 ? "initial" : "repeat",
    sequence,
  });
  cycle.decisionIds.push(id);
  return {
    id,
    epochId: cycle.epochId,
    skillId: cycle.skillId,
    targetId: cycle.targetId,
    cycleId: cycle.id,
    sequence,
    kind: sequence === 1 ? "initial" : "repeat",
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
  };
}

function createAttempt(
  decision: SkillIncidentAlertDecision,
  sequence: number,
  requestedAt: number,
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
    startedAt: requestedAt + 1,
    startedMonotonicAt: requestedAt + 1,
    finishedAt: requestedAt + 1_000,
    finishedMonotonicAt: requestedAt + 1_000,
    failedAt: null,
    failedMonotonicAt: null,
    status: "finished",
    startedMeaning: "browser-play-accepted",
    error: null,
    soundId: "default",
    featureVolume: 1,
    masterVolume: 1,
    effectiveVolume: 1,
    visibilityState: "visible",
  };
}

function createMedia(
  frame: SkillIncidentFrame,
  observation: SkillIncidentObservation,
  reason: SkillIncidentMedia["reason"],
  dataUrl: string,
  id = `media:${frame.id}:${reason}`,
): SkillIncidentMedia {
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
    dataUrl,
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

function image(value: string): string {
  return `data:image/png;base64,${value}`;
}
