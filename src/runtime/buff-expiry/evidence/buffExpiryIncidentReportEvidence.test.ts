import { describe, expect, it } from "vitest";
import { createBuffExpiryIncidentReportEvidence } from "./buffExpiryIncidentReportEvidence";
import type {
  BuffExpiryIncidentCycle,
  BuffExpiryIncidentEpisode,
  BuffExpiryIncidentFrame,
  BuffExpiryIncidentObservation,
  FrozenBuffExpiryIncidentEvidence,
} from "./buffExpiryIncidentEvidenceTypes";

describe("createBuffExpiryIncidentReportEvidence", () => {
  it("projects only the selected incident chain and keeps report-time context separate", () => {
    const epoch = {
      id: "buff-expiry-epoch:1:1",
      captureGeneration: 1,
      featureGeneration: 1,
      createdAt: 1_000,
      reason: "enabled",
    };
    const selectedFrame = createFrame(epoch.id, 1, 10_000);
    const unrelatedFrame = createFrame(epoch.id, 2, 11_000);
    const selectedObservation = createObservation(
      selectedFrame,
      "selected-observation",
      "selected-episode",
    );
    const unrelatedObservation = createObservation(
      unrelatedFrame,
      "unrelated-observation",
      "unrelated-episode",
    );
    selectedFrame.observationIds = [selectedObservation.id];
    unrelatedFrame.observationIds = [unrelatedObservation.id];
    const selectedEpisode = createEpisode({
      id: "selected-episode",
      epochId: epoch.id,
      observationId: selectedObservation.id,
      transitionId: "selected-transition",
      cycleId: "selected-cycle",
      sampledAt: 10_000,
    });
    const unrelatedEpisode = createEpisode({
      id: "unrelated-episode",
      epochId: epoch.id,
      observationId: unrelatedObservation.id,
      transitionId: "unrelated-transition",
      cycleId: "unrelated-cycle",
      sampledAt: 11_000,
    });
    const selectedCycle = createCycle(
      epoch.id,
      "selected-cycle",
      selectedEpisode.id,
      "selected-config",
      10_100,
    );
    const unrelatedCycle = createCycle(
      epoch.id,
      "unrelated-cycle",
      unrelatedEpisode.id,
      "unrelated-config",
      11_100,
    );
    const evidence: FrozenBuffExpiryIncidentEvidence = {
      schemaVersion: "buff-expiry-incident-evidence-v1",
      epoch,
      updatedAt: 12_000,
      frozenAt: 12_000,
      frames: [selectedFrame, unrelatedFrame],
      observations: [selectedObservation, unrelatedObservation],
      episodes: [selectedEpisode, unrelatedEpisode],
      transitions: [
        {
          id: "selected-transition",
          episodeId: selectedEpisode.id,
          occurredAt: 10_000,
          kind: "confirmed",
          frameId: selectedFrame.id,
          observationId: selectedObservation.id,
          countdownSeconds: 5,
          reason: null,
        },
        {
          id: "unrelated-transition",
          episodeId: unrelatedEpisode.id,
          occurredAt: 11_000,
          kind: "confirmed",
          frameId: unrelatedFrame.id,
          observationId: unrelatedObservation.id,
          countdownSeconds: 9,
          reason: null,
        },
      ],
      cycles: [selectedCycle, unrelatedCycle],
      cycleEvents: [
        {
          id: "selected-cycle:fired",
          cycleId: selectedCycle.id,
          occurredAt: 10_100,
          status: "fired",
          reason: null,
          frameId: selectedFrame.id,
        },
        {
          id: "unrelated-cycle:fired",
          cycleId: unrelatedCycle.id,
          occurredAt: 11_100,
          status: "fired",
          reason: null,
          frameId: unrelatedFrame.id,
        },
      ],
      attempts: [
        {
          id: "selected-attempt",
          cycleId: selectedCycle.id,
          sequence: 1,
          requestedAt: 10_100,
          startedAt: 10_110,
          failedAt: null,
          status: "started",
          error: null,
          soundId: "default",
          featureVolume: 1,
          masterVolume: 1,
          effectiveVolume: 1,
          visibilityState: "visible",
        },
        {
          id: "unrelated-attempt",
          cycleId: unrelatedCycle.id,
          sequence: 1,
          requestedAt: 11_100,
          startedAt: 11_110,
          failedAt: null,
          status: "started",
          error: null,
          soundId: "default",
          featureVolume: 1,
          masterVolume: 1,
          effectiveVolume: 1,
          visibilityState: "visible",
        },
      ],
      runtimeEvents: [
        {
          id: "selected-event",
          epochId: epoch.id,
          occurredAt: 10_100,
          category: "presentation",
          action: "playback-started",
          frameId: selectedFrame.id,
          episodeId: selectedEpisode.id,
          cycleId: selectedCycle.id,
          configRevision: "selected-config",
          details: {},
        },
        {
          id: "unrelated-event",
          epochId: epoch.id,
          occurredAt: 11_100,
          category: "presentation",
          action: "playback-started",
          frameId: unrelatedFrame.id,
          episodeId: unrelatedEpisode.id,
          cycleId: unrelatedCycle.id,
          configRevision: "unrelated-config",
          details: {},
        },
      ],
      configurationRevisions: [
        { id: "selected-config", capturedAt: 9_900, values: { lead: 5 } },
        { id: "unrelated-config", capturedAt: 10_900, values: { lead: 9 } },
      ],
      frozenState: {
        capturedAt: 12_000,
        epochId: epoch.id,
        status: "tracking",
        activeEpisodeIds: [selectedEpisode.id, unrelatedEpisode.id],
        pendingEpisodeIds: [],
        scheduledCycleIds: [],
        configRevision: "selected-config",
        provider: "webgpu",
      },
      media: [
        createMedia(selectedFrame, "data:image/jpeg;base64,selected"),
        createMedia(unrelatedFrame, "data:image/jpeg;base64,unrelated"),
      ],
      omissions: [],
    };

    const projected = createBuffExpiryIncidentReportEvidence({
      evidence,
      selection: {
        policy: "buff-expiry-scenario-selection-v1",
        status: "matched",
        support: "definitive",
        anchorKind: "attempt",
        selectedEventAt: 10_110,
        affectedGroup: "unionWealth",
        candidateIds: ["selected-attempt", "unrelated-attempt"],
        frameIds: [],
        observationIds: [],
        episodeIds: [],
        cycleIds: [],
        attemptIds: ["selected-attempt"],
        eventIds: ["selected-event"],
        configurationRevisionIds: [],
        mediaFrameIds: [selectedFrame.id],
        ambiguous: false,
        degradationReasons: [],
      },
      reportSampledAt: 20_000,
    });

    expect(projected.frames.map((entry) => entry.id)).toEqual([
      selectedFrame.id,
    ]);
    expect(projected.observations.map((entry) => entry.id)).toEqual([
      selectedObservation.id,
    ]);
    expect(projected.episodes.map((entry) => entry.id)).toEqual([
      selectedEpisode.id,
    ]);
    expect(projected.transitions.map((entry) => entry.id)).toEqual([
      "selected-transition",
    ]);
    expect(projected.cycles.map((entry) => entry.id)).toEqual([
      selectedCycle.id,
    ]);
    expect(projected.cycleEvents.map((entry) => entry.id)).toEqual([
      "selected-cycle:fired",
    ]);
    expect(projected.attempts.map((entry) => entry.id)).toEqual([
      "selected-attempt",
    ]);
    expect(projected.runtimeEvents.map((entry) => entry.id)).toEqual([
      "selected-event",
    ]);
    expect(projected.configurationRevisions.map((entry) => entry.id)).toEqual([
      "selected-config",
    ]);
    expect(projected.media.map((entry) => entry.dataUrl)).toEqual([
      "data:image/jpeg;base64,selected",
    ]);
    expect(projected.reportFrame).toEqual({
      id: "buff-expiry-report-time:20000",
      source: "report-time",
      sampledAt: 20_000,
      sourcePath: "sample.source",
      parserPath: "sample.parser",
      stateBeforePath: "buffExpiry.stateBefore",
      stateAfterPath: "buffExpiry.state",
    });
  });
});

function createFrame(
  epochId: string,
  sequence: number,
  sampledAt: number,
): BuffExpiryIncidentFrame {
  return {
    id: `frame:${sequence}`,
    epochId,
    sequence,
    sampledAt,
    source: "runtime",
    parser: {
      engine: "dl",
      version: "parser-v1",
      provider: "webgpu",
      modelVersion: "model-v1",
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
    selectedGroups: ["unionWealth"],
    observationIds: [],
    stateBefore: {
      status: "tracking",
      activeEpisodeIds: [],
      pendingEpisodeIds: [],
      scheduledCycleIds: [],
    },
    stateAfter: {
      status: "tracking",
      activeEpisodeIds: [],
      pendingEpisodeIds: [],
      scheduledCycleIds: [],
    },
    runtimeFailure: null,
    mediaFrameId: `frame:${sequence}`,
  };
}

function createObservation(
  frame: BuffExpiryIncidentFrame,
  id: string,
  episodeId: string,
): BuffExpiryIncidentObservation {
  return {
    id,
    frameId: frame.id,
    epochId: frame.epochId,
    episodeId,
    sampledAt: frame.sampledAt,
    group: "unionWealth",
    boxIndex: 0,
    row: 1,
    col: 0,
    targetAccepted: true,
    winningGroup: "unionWealth",
    decisionReason: "accepted",
    bundleDecisions: [],
    countdown: {
      text: "5",
      seconds: 5,
      status: "high",
      confidence: 0.99,
      decision: "accepted",
      reason: null,
    },
  };
}

function createEpisode({
  id,
  epochId,
  observationId,
  transitionId,
  cycleId,
  sampledAt,
}: {
  id: string;
  epochId: string;
  observationId: string;
  transitionId: string;
  cycleId: string;
  sampledAt: number;
}): BuffExpiryIncidentEpisode {
  return {
    id,
    epochId,
    group: "unionWealth",
    sequence: 1,
    status: "confirmed",
    startedAt: sampledAt - 1_000,
    confirmedAt: sampledAt,
    lastEventAt: sampledAt,
    endedAt: null,
    terminalReason: null,
    observationIds: [observationId],
    transitionIds: [transitionId],
    cycleIds: [cycleId],
  };
}

function createCycle(
  epochId: string,
  id: string,
  episodeId: string,
  configRevision: string,
  occurredAt: number,
): BuffExpiryIncidentCycle {
  return {
    id,
    epochId,
    episodeIds: [episodeId],
    dueAt: occurredAt,
    configRevision,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    status: "fired",
    eventIds: [`${id}:fired`],
  };
}

function createMedia(frame: BuffExpiryIncidentFrame, dataUrl: string) {
  return {
    frameId: frame.id,
    sampledAt: frame.sampledAt,
    reason: "fired-trigger" as const,
    dataUrl,
    sourceSize: { width: 1920, height: 1080 },
    roi: { x: 960, y: 0, width: 960, height: 540 },
  };
}
