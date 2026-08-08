import { describe, expect, it } from "vitest";
import type {
  BuffExpiryPendingTrack,
  BuffExpiryTrackedBuff,
} from "../../../domain/buff-expiry/precisionTrackingTypes";
import { createBuffExpiryRuntimeState } from "../../../lib/buffExpiry/buffExpiryRuntimeState";
import type {
  BuffExpiryPrecisionBestGroupCandidate,
  BuffExpiryPrecisionIconObservation,
} from "../analysis/buffExpiryPrecisionAnalysisRuntime";
import {
  createBuffExpiryIncidentRuntimeRecorder,
  getBuffExpiryIncidentEpisodeIdsForTracks,
  recordBuffExpiryIncidentCycleStatus,
  recordBuffExpiryIncidentPlaybackRequested,
  recordBuffExpiryIncidentPlaybackResult,
  recordBuffExpiryIncidentSample,
  registerBuffExpiryIncidentCycle,
  resetBuffExpiryIncidentRuntimeRecorder,
} from "./buffExpiryIncidentRuntimeRecorder";

describe("buff expiry incident runtime recorder", () => {
  it("keeps one episode while a pending track becomes confirmed", () => {
    let recorder = createBuffExpiryIncidentRuntimeRecorder({ now: 0 });
    const pending = createPending("unionLuck", 1_000, 0);
    recorder = recordSample(recorder, 1_000, { nextPending: [pending] });
    const pendingEpisode = recorder.archive.episodes[0]!;

    const confirmed = createTrack("unionLuck", 6_000, 0);
    recorder = recordSample(recorder, 6_000, {
      previousPending: [pending],
      nextTracks: [confirmed],
    });

    expect(recorder.archive.episodes).toHaveLength(1);
    expect(recorder.archive.episodes[0]).toMatchObject({
      id: pendingEpisode.id,
      status: "confirmed",
      confirmedAt: 6_000,
    });
    expect(
      recorder.archive.transitions
        .filter((entry) => entry.episodeId === pendingEpisode.id)
        .map((entry) => entry.kind),
    ).toEqual(["pending", "confirmed"]);
  });

  it("starts a new episode when a later icon reuses the same runtime slot id", () => {
    let recorder = createBuffExpiryIncidentRuntimeRecorder({ now: 0 });
    const first = createTrack("unionLuck", 1_000, 0);
    recorder = recordSample(recorder, 1_000, { nextTracks: [first] });
    const firstEpisodeId = recorder.archive.episodes[0]!.id;

    const replacementPending = createPending("unionLuck", 20_000, 0);
    recorder = recordSample(recorder, 20_000, {
      previousTracks: [first],
      nextPending: [replacementPending],
    });

    expect(recorder.archive.episodes).toHaveLength(2);
    expect(recorder.archive.episodes.find((entry) => entry.id === firstEpisodeId)).toMatchObject({
      status: "terminal",
      terminalReason: "runtime-track-generation-changed",
    });
    const active = recorder.archive.episodes.find((entry) => entry.status === "pending")!;
    expect(active.id).not.toBe(firstEpisodeId);
    expect(
      recorder.archive.transitions.some(
        (entry) => entry.episodeId === firstEpisodeId && entry.kind === "replaced",
      ),
    ).toBe(true);
  });

  it("keeps two potion targets separate and binds their observations by slot", () => {
    let recorder = createBuffExpiryIncidentRuntimeRecorder({ now: 0 });
    const left = createPending("potion", 1_000, 0);
    const right = createPending("potion", 1_000, 1);
    const observations = [
      createIconObservation("potion", 0, 0),
      createIconObservation("potion", 1, 1),
    ];
    recorder = recordSample(recorder, 1_000, {
      iconObservations: observations,
      nextPending: [left, right],
    });

    const episodeIds = recorder.archive.observations.map((entry) => entry.episodeId);
    expect(new Set(episodeIds).size).toBe(2);
    expect(episodeIds.every(Boolean)).toBe(true);
    expect(recorder.archive.episodes).toHaveLength(2);
  });

  it("records a stable cycle and playback attempt against episode ids", () => {
    let recorder = createBuffExpiryIncidentRuntimeRecorder({ now: 0 });
    const track = createTrack("unionWealth", 1_000, 0);
    recorder = recordSample(recorder, 1_000, { nextTracks: [track] });
    const episodeIds = getBuffExpiryIncidentEpisodeIdsForTracks(recorder, [track]);
    const registered = registerBuffExpiryIncidentCycle({
      previous: recorder,
      episodeIds,
      dueAt: 10_000,
      occurredAt: 2_000,
      configuration: configuration(),
    });
    recorder = registered.recorder;
    recorder = recordBuffExpiryIncidentCycleStatus({
      previous: recorder,
      cycleId: registered.cycleId,
      occurredAt: 10_000,
      status: "fired",
    });
    const requested = recordBuffExpiryIncidentPlaybackRequested({
      previous: recorder,
      cycleId: registered.cycleId,
      requestedAt: 10_010,
      soundId: "sound",
      featureVolume: 0.8,
      masterVolume: 0.5,
      effectiveVolume: 0.4,
      visibilityState: "visible",
    });
    recorder = recordBuffExpiryIncidentPlaybackResult({
      previous: requested.recorder,
      attemptId: requested.attemptId,
      occurredAt: 10_020,
      status: "started",
    });

    expect(recorder.archive.cycles[0]).toMatchObject({
      id: registered.cycleId,
      episodeIds,
      status: "fired",
    });
    expect(recorder.archive.attempts[0]).toMatchObject({
      id: requested.attemptId,
      cycleId: registered.cycleId,
      status: "started",
      startedAt: 10_020,
    });
    expect(
      recorder.archive.transitions.filter((entry) =>
        ["scheduled", "alerted"].includes(entry.kind),
      ).map((entry) => entry.kind),
    ).toEqual(["scheduled", "alerted"]);
  });

  it("creates a new epoch and clears slot bindings on feature reset", () => {
    let recorder = createBuffExpiryIncidentRuntimeRecorder({ now: 0 });
    const track = createTrack("expCoupon", 1_000, 0);
    recorder = recordSample(recorder, 1_000, { nextTracks: [track] });
    const previousEpoch = recorder.archive.epoch.id;

    recorder = resetBuffExpiryIncidentRuntimeRecorder({
      previous: recorder,
      now: 2_000,
      reason: "feature-reset",
    });

    expect(recorder.archive.epoch.id).not.toBe(previousEpoch);
    expect(recorder.bindingsByRuntimeId).toEqual({});
    expect(recorder.archive.episodes).toEqual([]);
    expect(recorder.archive.omissions).toEqual([
      expect.objectContaining({ reason: "reset-epoch", subjectIds: [previousEpoch] }),
    ]);
  });

  it("ignores stale timer cancellation after an epoch reset", () => {
    const recorder = createBuffExpiryIncidentRuntimeRecorder({ now: 0 });

    const next = recordBuffExpiryIncidentCycleStatus({
      previous: recorder,
      cycleId: "buff-expiry-cycle:previous-epoch",
      occurredAt: 1_000,
      status: "cancelled",
      reason: "feature-reset",
    });

    expect(next).toBe(recorder);
    expect(next.archive.runtimeEvents).toEqual([]);
  });

  it("records rejected countdown evidence and reuses the exact sampled ROI", () => {
    let recorder = createBuffExpiryIncidentRuntimeRecorder({ now: 0 });
    const pending = createPending("unionLuck", 1_000, 0);
    const icon = createIconObservation("unionLuck", 0, 0, {
      countdown: {
        kind: "exact",
        text: "8",
        totalSeconds: 8,
        format: "seconds",
        textRegion: "center",
        confidence: 0.2,
        status: "low",
        routerTarget: "center",
        routerConfidence: 0.2,
        routerStatus: "low-confidence",
      },
    });
    recorder = recordBuffExpiryIncidentSample({
      previous: recorder,
      input: {
        ...sampleInput(1_000, [icon], [], [], [pending]),
        recentRoiFrames: [{
          sampledAt: 1_000,
          reason: "target-seen",
          sourceSize: { width: 100, height: 50 },
          roi: { x: 50, y: 0, width: 50, height: 25 },
          imageDataUrl: "data:image/jpeg;base64,incident",
          boxCount: 1,
          targetObservationCount: 1,
          countdownObservationCount: 1,
          bestByGroup: [],
          trackCount: 0,
          pendingTrackCount: 1,
        }],
      },
    });

    expect(recorder.archive.observations[0]?.countdown).toMatchObject({
      decision: "rejected",
      seconds: 8,
    });
    expect(recorder.archive.transitions.some((entry) => entry.kind === "countdown-rejected")).toBe(true);
    expect(recorder.archive.frames[0]).toMatchObject({ mediaFrameId: recorder.archive.frames[0]?.id });
    expect(recorder.archive.media[0]).toMatchObject({
      frameId: recorder.archive.frames[0]?.id,
      reason: "accepted-observation",
    });
  });

  it("records parser and row-eligibility counts on the same runtime frame", () => {
    const icon = createIconObservation("unionLuck", 0, 0);
    const recorder = recordBuffExpiryIncidentSample({
      previous: createBuffExpiryIncidentRuntimeRecorder({ now: 0 }),
      input: {
        ...sampleInput(1_000, [icon], [], [], [], []),
        parserBoxes: [
          { x: 0, y: 0, size: 32 },
          { x: 0, y: 40, size: 32 },
          { x: 0, y: 80, size: 32 },
        ],
        buffSlotLocalization: {
          version: "buff-slot-cluster-localizer-v1",
          status: "selected",
          reason: "source-edge-anchor",
          parserBoxCount: 6,
          parserRowCount: 6,
          localizedBoxCount: 3,
          localizedRowCount: 3,
          spatialExcludedBoxCount: 3,
        },
      },
    });

    expect(recorder.archive.frames[0]?.recognition).toEqual({
      parserBoxCount: 6,
      parsedRowCount: 6,
      localizedBoxCount: 3,
      localizedRowCount: 3,
      spatialExcludedBoxCount: 3,
      localizationStatus: "selected",
      localizationReason: "source-edge-anchor",
      localizationVersion: "buff-slot-cluster-localizer-v1",
      upperExcludedBoxCount: 1,
      eligibleBoxCount: 2,
      matcherObservationCount: 1,
      selectedCandidateCount: 1,
      acceptedTargetCount: 1,
    });
  });
});

function recordSample(
  recorder: ReturnType<typeof createBuffExpiryIncidentRuntimeRecorder>,
  sampledAt: number,
  {
    iconObservations = [],
    previousPending = [],
    nextPending = [],
    previousTracks = [],
    nextTracks = [],
  }: {
    iconObservations?: BuffExpiryPrecisionIconObservation[];
    previousPending?: BuffExpiryPendingTrack[];
    nextPending?: BuffExpiryPendingTrack[];
    previousTracks?: BuffExpiryTrackedBuff[];
    nextTracks?: BuffExpiryTrackedBuff[];
  },
) {
  return recordBuffExpiryIncidentSample({
    previous: recorder,
    input: sampleInput(
      sampledAt,
      iconObservations,
      previousPending,
      previousTracks,
      nextPending,
      nextTracks,
    ),
  });
}

function sampleInput(
  sampledAt: number,
  iconObservations: BuffExpiryPrecisionIconObservation[],
  previousPending: BuffExpiryPendingTrack[],
  previousTracks: BuffExpiryTrackedBuff[],
  nextPending: BuffExpiryPendingTrack[],
  nextTracks: BuffExpiryTrackedBuff[] = [],
) {
  const stateBefore = {
    ...createBuffExpiryRuntimeState(),
    pendingTracks: previousPending,
    tracks: previousTracks,
  };
  const stateAfter = {
    ...createBuffExpiryRuntimeState(),
    pendingTracks: nextPending,
    tracks: nextTracks,
    status: nextTracks.length ? "tracking" as const : "waiting" as const,
  };
  return {
    sampledAt,
    selectedGroups: ["unionWealth", "unionLuck", "potion", "expCoupon"] as const,
    stateBefore,
    stateAfter,
    iconObservations,
    bestByGroup: iconObservations.map(toBestCandidate),
    parser: {
      engine: "dl",
      version: "parser-v1",
      provider: "webgpu",
      modelVersion: "model-v1",
    },
    configuration: configuration(),
  };
}

function createPending(
  group: "unionWealth" | "unionLuck" | "potion" | "expCoupon",
  sampledAt: number,
  col: number,
): BuffExpiryPendingTrack {
  return {
    id: runtimeId(group, col),
    buffId: `next:${group}`,
    name: group,
    box: box(col),
    firstSeenAt: sampledAt,
    lastSeenAt: sampledAt,
    observations: [],
    score: 0.9,
  };
}

function createTrack(
  group: "unionWealth" | "unionLuck" | "potion" | "expCoupon",
  sampledAt: number,
  col: number,
): BuffExpiryTrackedBuff {
  return {
    id: runtimeId(group, col),
    buffId: `next:${group}`,
    name: group,
    box: box(col),
    detectedSeconds: 30,
    detectedAt: sampledAt,
    expiresAt: sampledAt + 30_000,
    lastSeenAt: sampledAt,
    alertedAt: null,
    score: 0.9,
  };
}

function createIconObservation(
  group: "unionWealth" | "unionLuck" | "potion" | "expCoupon",
  boxIndex: number,
  col: number,
  overrides: Partial<BuffExpiryPrecisionIconObservation> = {},
): BuffExpiryPrecisionIconObservation {
  return {
    id: `slot:${boxIndex}`,
    boxIndex,
    box: {
      x: col * 40,
      y: 0,
      size: 32,
      row: 0,
      col,
      confidence: 0.9,
      score: 0.9,
    },
    identity: {
      kind: "target",
      group,
      score: 0.9,
      margin: 0.5,
      decisionReason: "target_accepted",
      bestTargetName: group,
      bestExcludedName: null,
      candidates: [{
        group,
        bundleId: `${group}-bundle`,
        modelVersion: "matcher-v1",
        accepted: true,
        score: 0.9,
        threshold: 0.5,
        margin: 0.4,
        gateScore: 0.9,
        gateThreshold: 0.5,
        gateMargin: 0.4,
        decisionReason: "target_accepted",
      }],
    },
    countdown: {
      kind: "exact",
      text: "30",
      totalSeconds: 30,
      format: "seconds",
      textRegion: "center",
      confidence: 0.9,
      status: "high",
      routerTarget: "center",
      routerConfidence: 0.9,
      routerStatus: "accepted",
    },
    ...overrides,
  };
}

function toBestCandidate(
  observation: BuffExpiryPrecisionIconObservation,
): BuffExpiryPrecisionBestGroupCandidate {
  return {
    group: observation.identity.group!,
    boxIndex: observation.boxIndex,
    box: observation.box,
    accepted: true,
    matcherAccepted: true,
    winningGroup: observation.identity.group,
    score: observation.identity.score,
    margin: observation.identity.margin,
    decisionReason: observation.identity.decisionReason,
    countdown: observation.countdown,
  };
}

function box(col: number) {
  return {
    x: col * 40,
    y: 0,
    width: 32,
    height: 32,
    side: 32,
    row: 0,
    col,
    confidence: 0.9,
  };
}

function runtimeId(group: string, col: number) {
  return `next:${group}:r0:c${col}`;
}

function configuration() {
  return {
    enabled: true,
    alertLeadSeconds: 5,
    soundId: "sound",
    volume: 0.8,
    masterVolume: 0.5,
  };
}
