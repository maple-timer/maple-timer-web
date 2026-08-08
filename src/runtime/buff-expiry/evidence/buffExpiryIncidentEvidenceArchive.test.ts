import { describe, expect, it } from "vitest";
import type { BuffExpiryTargetGroup } from "../../../contracts/recognition/buffExpiryRecognition";
import {
  BUFF_EXPIRY_INCIDENT_MAX_CYCLE_ATTEMPT_RECORDS,
  BUFF_EXPIRY_INCIDENT_MAX_FRAMES,
  BUFF_EXPIRY_INCIDENT_MEDIA_MAX_FRAME_CHARS,
  BUFF_EXPIRY_INCIDENT_MEDIA_MAX_FRAMES,
  BUFF_EXPIRY_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
  compactBuffExpiryIncidentEvidenceArchive,
  createBuffExpiryIncidentEvidenceArchive,
  enforceBuffExpiryIncidentMediaBudget,
  freezeBuffExpiryIncidentEvidence,
  updateBuffExpiryIncidentEvidenceArchive,
} from "./buffExpiryIncidentEvidenceArchive";
import type {
  BuffExpiryIncidentCycle,
  BuffExpiryIncidentCycleEvent,
  BuffExpiryIncidentEpisode,
  BuffExpiryIncidentEpoch,
  BuffExpiryIncidentFrame,
  BuffExpiryIncidentMedia,
  BuffExpiryIncidentPlaybackAttempt,
  BuffExpiryIncidentRuntimeEvent,
} from "./buffExpiryIncidentEvidenceTypes";
import {
  createBuffExpiryIncidentAttemptId,
  createBuffExpiryIncidentCycleId,
  createBuffExpiryIncidentEpisodeId,
  createBuffExpiryIncidentEpochId,
  createBuffExpiryIncidentFrameId,
} from "./buffExpiryIncidentEvidenceTypes";

describe("buff expiry incident evidence archive", () => {
  it("uses reset epoch and monotonic sequence identities instead of geometry", () => {
    const firstEpoch = createEpoch(1, 1);
    const secondEpoch = createEpoch(1, 2);
    const firstEpisode = createBuffExpiryIncidentEpisodeId({
      epochId: firstEpoch.id,
      group: "potion",
      sequence: 1,
    });
    const secondEpisode = createBuffExpiryIncidentEpisodeId({
      epochId: firstEpoch.id,
      group: "potion",
      sequence: 2,
    });

    expect(firstEpoch.id).not.toBe(secondEpoch.id);
    expect(firstEpisode).not.toBe(secondEpisode);
    expect(
      createBuffExpiryIncidentCycleId({
        epochId: firstEpoch.id,
        dueAt: 20_000,
        episodeIds: [secondEpisode, firstEpisode],
        configRevision: "cfg-a",
      }),
    ).toBe(
      createBuffExpiryIncidentCycleId({
        epochId: firstEpoch.id,
        dueAt: 20_000,
        episodeIds: [firstEpisode, secondEpisode],
        configRevision: "cfg-a",
      }),
    );
  });

  it("freezes a detached open-time snapshot and excludes later events", () => {
    const epoch = createEpoch();
    const firstFrame = createFrame(epoch, 1, 49_000);
    const initial = updateBuffExpiryIncidentEvidenceArchive({
      previous: null,
      epoch,
      now: 50_000,
      patch: {
        frames: [firstFrame],
        media: [createMedia(firstFrame.id, firstFrame.sampledAt, "current")],
      },
    });
    const frozen = freezeBuffExpiryIncidentEvidence({
      archive: initial,
      capturedAt: 50_000,
    });
    const laterFrame = createFrame(epoch, 2, 51_000);
    const updated = updateBuffExpiryIncidentEvidenceArchive({
      previous: initial,
      epoch,
      now: 51_000,
      patch: { frames: [laterFrame] },
    });

    expect(frozen.frames.map((entry) => entry.id)).toEqual([firstFrame.id]);
    expect(updated.frames.map((entry) => entry.id)).toEqual([
      firstFrame.id,
      laterFrame.id,
    ]);
  });

  it("keeps active episode metadata beyond one minute without retaining old images", () => {
    const epoch = createEpoch();
    const oldFrame = createFrame(epoch, 1, 1_000);
    const recentFrame = createFrame(epoch, 2, 120_000);
    const episode = createEpisode(epoch, "unionLuck", 1, {
      startedAt: 1_000,
      lastEventAt: 120_000,
      status: "confirmed",
    });
    const archive = updateBuffExpiryIncidentEvidenceArchive({
      previous: null,
      epoch,
      now: 120_000,
      patch: {
        frames: [oldFrame, recentFrame],
        episodes: [episode],
        media: [
          createMedia(oldFrame.id, oldFrame.sampledAt, "confirmation"),
          createMedia(recentFrame.id, recentFrame.sampledAt, "current"),
        ],
      },
    });

    expect(archive.episodes.map((entry) => entry.id)).toEqual([episode.id]);
    expect(archive.frames.map((entry) => entry.id)).toEqual([recentFrame.id]);
    expect(archive.media.map((entry) => entry.frameId)).toEqual([recentFrame.id]);
  });

  it("uses an inclusive sixty-second terminal episode boundary", () => {
    const epoch = createEpoch();
    const episode = createEpisode(epoch, "unionWealth", 1, {
      startedAt: 1_000,
      lastEventAt: 60_000,
      endedAt: 60_000,
      status: "terminal",
    });
    const archive = updateBuffExpiryIncidentEvidenceArchive({
      previous: null,
      epoch,
      now: 60_000,
      patch: { episodes: [episode] },
    });

    expect(
      compactBuffExpiryIncidentEvidenceArchive(archive, 120_000).episodes,
    ).toHaveLength(1);
    expect(
      compactBuffExpiryIncidentEvidenceArchive(archive, 120_001).episodes,
    ).toHaveLength(0);
  });

  it("bounds frame and cycle/playback metadata", () => {
    const epoch = createEpoch();
    const frames = Array.from({ length: 80 }, (_, index) =>
      createFrame(epoch, index + 1, 1_000 + index),
    );
    const episodes = Array.from({ length: 20 }, (_, index) =>
      createEpisode(epoch, index % 2 ? "potion" : "unionLuck", index + 1, {
        startedAt: 1_000 + index,
        lastEventAt: 1_000 + index,
      }),
    );
    const cycles = episodes.map((episode, index) =>
      createCycle(epoch, episode, 2_000 + index),
    );
    const attempts = cycles.map((cycle, index) =>
      createAttempt(cycle, index + 1, 2_000 + index),
    );
    const archive = updateBuffExpiryIncidentEvidenceArchive({
      previous: null,
      epoch,
      now: 10_000,
      patch: { frames, episodes, cycles, attempts },
    });

    expect(archive.frames).toHaveLength(BUFF_EXPIRY_INCIDENT_MAX_FRAMES);
    expect(archive.cycles.length + archive.attempts.length).toBeLessThanOrEqual(
      BUFF_EXPIRY_INCIDENT_MAX_CYCLE_ATTEMPT_RECORDS,
    );
    expect(
      archive.omissions.some(
        (entry) => entry.reason === "metadata-cap" && entry.kind === "frame",
      ),
    ).toBe(true);
  });

  it("keeps distinct omission records produced by event caps at the same time", () => {
    const epoch = createEpoch();
    const episode = createEpisode(epoch, "unionLuck", 1);
    const cycle = createCycle(epoch, episode, 2_000);
    const cycleEvents: BuffExpiryIncidentCycleEvent[] = Array.from(
      { length: 100 },
      (_, index) => ({
        id: `cycle-event-${index}`,
        cycleId: cycle.id,
        occurredAt: 2_000 + index,
        status: "registered",
        reason: null,
        frameId: null,
      }),
    );
    const runtimeEvents: BuffExpiryIncidentRuntimeEvent[] = Array.from(
      { length: 200 },
      (_, index) => ({
        id: `runtime-event-${index}`,
        epochId: epoch.id,
        occurredAt: 2_000 + index,
        category: "lifecycle",
        action: "sampled",
        frameId: null,
        episodeId: episode.id,
        cycleId: cycle.id,
        configRevision: null,
        details: {},
      }),
    );
    const archive = updateBuffExpiryIncidentEvidenceArchive({
      previous: null,
      epoch,
      now: 10_000,
      patch: {
        episodes: [episode],
        cycles: [cycle],
        cycleEvents,
        runtimeEvents,
      },
    });

    expect(
      archive.omissions
        .filter(
          (entry) => entry.kind === "event" && entry.reason === "metadata-cap",
        )
        .map((entry) => entry.count)
        .sort((left, right) => left - right),
    ).toEqual([4, 8]);
  });

  it("deduplicates media by frame and protects trigger evidence before periodic context", () => {
    const media = [
      createMedia("shared", 1_000, "periodic", image("shared")),
      createMedia("shared", 1_000, "fired-trigger", image("shared")),
      ...Array.from({ length: 8 }, (_, index) =>
        createMedia(
          `periodic-${index}`,
          2_000 + index,
          "periodic",
          image(`periodic-${index}`),
        ),
      ),
    ];
    const result = enforceBuffExpiryIncidentMediaBudget({ media, now: 10_000 });

    expect(result.media).toHaveLength(BUFF_EXPIRY_INCIDENT_MEDIA_MAX_FRAMES);
    expect(result.media.find((entry) => entry.frameId === "shared")?.reason).toBe(
      "fired-trigger",
    );
    expect(result.retainedChars).toBeLessThanOrEqual(
      BUFF_EXPIRY_INCIDENT_MEDIA_MAX_TOTAL_CHARS,
    );
    expect(result.omissions).toEqual([
      expect.objectContaining({ reason: "media-budget-exhausted", count: 1 }),
    ]);
  });

  it("rejects an oversized image without dropping compact frame metadata", () => {
    const result = enforceBuffExpiryIncidentMediaBudget({
      media: [
        createMedia(
          "oversized",
          1_000,
          "fired-trigger",
          "x".repeat(BUFF_EXPIRY_INCIDENT_MEDIA_MAX_FRAME_CHARS + 1),
        ),
      ],
      now: 1_000,
    });

    expect(result.media).toEqual([]);
    expect(result.omissions).toEqual([
      expect.objectContaining({
        reason: "media-oversize",
        subjectIds: ["oversized"],
      }),
    ]);
  });

  it("clears the previous epoch instead of correlating reused slots", () => {
    const firstEpoch = createEpoch(1, 1);
    const firstFrame = createFrame(firstEpoch, 1, 1_000);
    const first = updateBuffExpiryIncidentEvidenceArchive({
      previous: null,
      epoch: firstEpoch,
      now: 1_000,
      patch: { frames: [firstFrame] },
    });
    const secondEpoch = createEpoch(1, 2);
    const secondFrame = createFrame(secondEpoch, 1, 2_000);
    const second = updateBuffExpiryIncidentEvidenceArchive({
      previous: first,
      epoch: secondEpoch,
      now: 2_000,
      patch: { frames: [secondFrame] },
    });

    expect(second.frames.map((entry) => entry.id)).toEqual([secondFrame.id]);
    expect(second.omissions).toEqual([
      expect.objectContaining({
        reason: "reset-epoch",
        subjectIds: [firstEpoch.id],
      }),
    ]);
  });
});

function createEpoch(
  captureGeneration = 1,
  featureGeneration = 1,
): BuffExpiryIncidentEpoch {
  return {
    id: createBuffExpiryIncidentEpochId({
      captureGeneration,
      featureGeneration,
    }),
    captureGeneration,
    featureGeneration,
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

function createEpisode(
  epoch: BuffExpiryIncidentEpoch,
  group: BuffExpiryTargetGroup,
  sequence: number,
  overrides: Partial<BuffExpiryIncidentEpisode> = {},
): BuffExpiryIncidentEpisode {
  const id = createBuffExpiryIncidentEpisodeId({
    epochId: epoch.id,
    group,
    sequence,
  });
  return {
    id,
    epochId: epoch.id,
    group,
    sequence,
    status: "confirmed",
    startedAt: 1_000,
    confirmedAt: 1_000,
    lastEventAt: 1_000,
    endedAt: null,
    terminalReason: null,
    observationIds: [],
    transitionIds: [],
    cycleIds: [],
    ...overrides,
  };
}

function createCycle(
  epoch: BuffExpiryIncidentEpoch,
  episode: BuffExpiryIncidentEpisode,
  occurredAt: number,
): BuffExpiryIncidentCycle {
  const id = createBuffExpiryIncidentCycleId({
    epochId: epoch.id,
    dueAt: occurredAt,
    episodeIds: [episode.id],
    configRevision: "cfg-test",
  });
  episode.cycleIds.push(id);
  return {
    id,
    epochId: epoch.id,
    episodeIds: [episode.id],
    dueAt: occurredAt,
    configRevision: "cfg-test",
    createdAt: occurredAt,
    updatedAt: occurredAt,
    status: "fired",
    eventIds: [],
  };
}

function createAttempt(
  cycle: BuffExpiryIncidentCycle,
  sequence: number,
  requestedAt: number,
): BuffExpiryIncidentPlaybackAttempt {
  return {
    id: createBuffExpiryIncidentAttemptId(cycle.id, sequence),
    cycleId: cycle.id,
    sequence,
    requestedAt,
    startedAt: requestedAt,
    failedAt: null,
    status: "started",
    error: null,
    soundId: "default",
    featureVolume: 1,
    masterVolume: 1,
    effectiveVolume: 1,
    visibilityState: "visible",
  };
}

function createMedia(
  frameId: string,
  sampledAt: number,
  reason: BuffExpiryIncidentMedia["reason"],
  dataUrl = image(frameId),
): BuffExpiryIncidentMedia {
  return {
    frameId,
    sampledAt,
    reason,
    dataUrl,
    sourceSize: { width: 1920, height: 1080 },
    roi: { x: 900, y: 0, width: 1020, height: 389 },
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

function image(value: string) {
  return `data:image/webp;base64,${value}`;
}
