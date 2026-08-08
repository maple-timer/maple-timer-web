import { describe, expect, it } from "vitest";
import {
  createBoosterExpiryRuntimeState,
  updateBoosterExpiryRuntimeState,
} from "../../../lib/boosterExpiry/boosterExpiryRuntime";
import type {
  BoosterExpiryRuntimeState,
  BoosterExpiryWorkerResult,
} from "../../../lib/boosterExpiry/boosterExpiryTypes";
import type { BoosterExpiryAlertConfig } from "../../../types";
import { freezeBoosterExpiryIncidentEvidence } from "./boosterExpiryIncidentEvidenceArchive";
import type { BoosterExpiryReportIncidentSelection } from "./boosterExpiryIncidentEvidenceSelection";
import { createBoosterExpiryIncidentReportEvidence } from "./boosterExpiryIncidentReportEvidence";
import {
  createBoosterExpiryIncidentFrozenState,
  createBoosterExpiryIncidentRuntimeRecorder,
  freezeBoosterExpiryIncidentRuntimeRecorder,
  recordBoosterExpiryIncidentPlaybackRequested,
  recordBoosterExpiryIncidentPlaybackTransition,
  recordBoosterExpiryIncidentRuntimeSample,
  recordBoosterExpiryIncidentScheduleOutcome,
  recordBoosterExpiryIncidentScheduleRegistered,
  type BoosterExpiryIncidentRuntimeRecorder,
  type BoosterExpiryIncidentRuntimeSampleInput,
} from "./boosterExpiryIncidentRuntimeRecorder";
import type {
  BoosterExpiryIncidentConfiguration,
  BoosterExpiryIncidentFrame,
  BoosterExpiryIncidentMediaFrame,
  FrozenBoosterExpiryIncidentEvidence,
} from "./boosterExpiryIncidentEvidenceTypes";

const CONFIGURATION: BoosterExpiryIncidentConfiguration = {
  enabled: true,
  alertLeadSeconds: 10,
  soundId: "booster-expiry",
  featureVolume: 0.8,
  masterVolume: 0.5,
  effectiveVolume: 0.4,
};

const RUNTIME_CONFIG: BoosterExpiryAlertConfig = {
  enabled: true,
  alertLeadSeconds: 10,
  soundId: "booster-expiry",
  volume: 0.8,
};

describe("createBoosterExpiryIncidentReportEvidence", () => {
  it("projects only the selected playback and confirmed cycle chain", () => {
    const base = createFrozenEvidence();
    const selectedFrame = base.frames[base.frames.length - 1]!;
    const unrelatedFrame: BoosterExpiryIncidentFrame = {
      ...selectedFrame,
      id: "unrelated:frame",
      sequence: 999,
      sampledAt: selectedFrame.sampledAt + 1,
      mediaFrameId: "unrelated:media",
    };
    const unrelatedMedia: BoosterExpiryIncidentMediaFrame = {
      id: "unrelated:media",
      frameId: unrelatedFrame.id,
      resetEpochId: unrelatedFrame.resetEpochId,
      sampledAt: unrelatedFrame.sampledAt,
      reason: "current",
      imageDataUrl: "data:image/png;base64,UNRELATED",
    };
    const evidence: FrozenBoosterExpiryIncidentEvidence = {
      ...base,
      frames: [...base.frames, unrelatedFrame],
      media: [...base.media, unrelatedMedia],
      lifecycleEvents: [
        ...base.lifecycleEvents,
        {
          id: "unrelated:event",
          resetEpochId: unrelatedFrame.resetEpochId,
          occurredAt: unrelatedFrame.sampledAt,
          category: "interaction",
          action: "unrelated",
          configRevisionId: unrelatedFrame.configRevisionId,
          flowEpochId: unrelatedFrame.flowEpochId,
          frameId: null,
          observationId: null,
          candidateAttemptId: null,
          cycleId: null,
          scheduleId: null,
          decisionId: null,
          playbackAttemptId: null,
          details: {},
        },
      ],
    };
    const playback = evidence.playbackAttempts[0]!;

    const report = createBoosterExpiryIncidentReportEvidence({
      evidence,
      selection: createSelection(evidence, {
        playbackAttemptIds: [playback.id],
        frameIds: [selectedFrame.id],
        mediaFrameIds: [selectedFrame.id],
      }),
    });

    expect(report.resetEpochs).toHaveLength(1);
    expect(report.configurations).toHaveLength(1);
    expect(report.flowEpochs).toHaveLength(1);
    expect(report.frames).toHaveLength(6);
    expect(report.observations).toHaveLength(6);
    expect(report.candidateAttempts).toHaveLength(1);
    expect(report.cycles).toHaveLength(1);
    expect(report.schedules).toHaveLength(1);
    expect(report.decisions).toHaveLength(1);
    expect(report.playbackAttempts).toHaveLength(1);
    expect(report.frames.map((entry) => entry.id)).not.toContain(
      unrelatedFrame.id,
    );
    expect(report.media.map((entry) => entry.id)).not.toContain(
      unrelatedMedia.id,
    );
    expect(report.lifecycle.map((entry) => entry.id)).not.toContain(
      "unrelated:event",
    );
    expect(report.selection.frameIds).toHaveLength(6);
    expect(report.selection.cycleIds).toEqual([playback.cycleId]);
    expect(report.reportFrame).toBeNull();
    expect(report.budget.overRequestTarget).toBe(false);
  });

  it("keeps high-value media within the report budget and marks compaction", () => {
    const base = createFrozenEvidence();
    const template = base.frames[base.frames.length - 1]!;
    const frames = Array.from({ length: 10 }, (_, index) => ({
      ...template,
      id: `selected:media-frame:${index}`,
      sequence: 100 + index,
      sampledAt: 120_000 + index,
      mediaFrameId: `selected:media:${index}`,
    }));
    const media = frames.map((frame, index) => ({
      id: `selected:media:${index}`,
      frameId: frame.id,
      resetEpochId: frame.resetEpochId,
      sampledAt: frame.sampledAt,
      reason: index === 0 ? ("playback-failed" as const) : ("current" as const),
      imageDataUrl: `data:image/png;base64,${index}`,
    }));
    const evidence: FrozenBoosterExpiryIncidentEvidence = {
      ...base,
      frames: [...base.frames, ...frames],
      media: [...base.media, ...media],
    };

    const report = createBoosterExpiryIncidentReportEvidence({
      evidence,
      selection: createSelection(evidence, {
        frameIds: frames.map((entry) => entry.id),
        mediaFrameIds: frames.map((entry) => entry.id),
      }),
    });

    expect(report.media).toHaveLength(8);
    expect(report.media.some((entry) => entry.reason === "playback-failed")).toBe(
      true,
    );
    expect(report.selection.support).toBe("partial");
    expect(report.selection.degradationReasons).toContain("payload-compacted");
    expect(report.budget.droppedMediaFrameIds).toHaveLength(2);
    expect(report.omissions).toContainEqual(
      expect.objectContaining({ reason: "payload-compacted", count: 2 }),
    );
  });
});

function createFrozenEvidence(): FrozenBoosterExpiryIncidentEvidence {
  let recorder = createBoosterExpiryIncidentRuntimeRecorder(0);
  let state = createBoosterExpiryRuntimeState();
  for (let index = 0; index < 6; index += 1) {
    const sampledAt = (index + 1) * 1_000;
    const result = createWorkerResult(120 - index);
    const stateAfter = transition(state, result, sampledAt);
    recorder = recordBoosterExpiryIncidentRuntimeSample({
      previous: recorder,
      input: createInput({
        sampledAt,
        stateBefore: state,
        stateAfter,
        result,
        media:
          index === 0 || index === 5
            ? { imageDataUrl: `data:image/png;base64,${index}` }
            : null,
      }),
    });
    state = stateAfter;
  }
  const cycleId = recorder.boundary!.activeCycle!.id;
  recorder = recordBoosterExpiryIncidentScheduleRegistered({
    previous: recorder,
    cycleId,
    registeredAt: 6_001,
    reason: "cycle-confirmed",
  }).recorder;
  recorder = recordBoosterExpiryIncidentScheduleOutcome({
    previous: recorder,
    cycleId,
    outcome: "fired",
    occurredAt: 111_001,
  }).recorder;
  const requested = recordBoosterExpiryIncidentPlaybackRequested({
    previous: recorder,
    cycleId,
    requestedAt: 111_002,
  });
  recorder = requested.recorder;
  recorder = recordBoosterExpiryIncidentPlaybackTransition({
    previous: recorder,
    attemptId: requested.attemptId!,
    status: "browser-play-accepted",
    occurredAt: 111_003,
  }).recorder;
  recorder = recordBoosterExpiryIncidentPlaybackTransition({
    previous: recorder,
    attemptId: requested.attemptId!,
    status: "finished",
    occurredAt: 111_500,
  }).recorder;

  const frozenAt = 112_000;
  const frozenState = createBoosterExpiryIncidentFrozenState({
    recorder,
    capturedAt: frozenAt,
    state,
  });
  const frozen = freezeBoosterExpiryIncidentRuntimeRecorder({
    previous: recorder,
    frozenAt,
  });
  if (!frozen.lease) throw new Error("expected booster expiry report lease");
  return freezeBoosterExpiryIncidentEvidence({
    archive: frozen.recorder.archive,
    lease: frozen.lease,
    frozenState,
    relatedPlayback: [
      {
        id: "related:rune",
        feature: "rune",
        requestedAt: 111_100,
        browserAcceptedAt: 111_101,
        finishedAt: 111_300,
        failedAt: null,
        status: "finished",
      },
    ],
  });
}

function createSelection(
  evidence: FrozenBoosterExpiryIncidentEvidence,
  overrides: Partial<BoosterExpiryReportIncidentSelection>,
): BoosterExpiryReportIncidentSelection {
  return {
    policy: "booster-expiry-scenario-selection-v1",
    status: "matched",
    support: "definitive",
    anchorKind: "playback-attempt",
    selectedEventAt: evidence.playbackAttempts[0]?.requestedAt ?? evidence.frozenAt,
    resetEpochId: evidence.lease.resetEpochId,
    candidateIds: ["selected:playback"],
    flowEpochIds: [],
    frameIds: [],
    observationIds: [],
    candidateAttemptIds: [],
    cycleIds: [],
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

function transition(
  previous: BoosterExpiryRuntimeState,
  result: BoosterExpiryWorkerResult | null,
  now: number,
): BoosterExpiryRuntimeState {
  return updateBoosterExpiryRuntimeState({
    previous,
    result,
    config: RUNTIME_CONFIG,
    now,
    hasStream: true,
  }).state;
}

function createWorkerResult(seconds: number): BoosterExpiryWorkerResult {
  const time = {
    ok: true,
    reason: "ok",
    seconds,
    text: `${seconds}`,
    format: "m:ss" as const,
    selectedBy: "timer-catch",
    rect: { x: 10, y: 20, width: 30, height: 40 },
    digitCount: `${seconds}`.length,
  };
  return {
    recognizerVersion: "timer-catch-flow-v1",
    rawTime: time,
    time,
    timeRect: {
      ok: true,
      reason: "ok",
      rect: time.rect,
      matchCount: 1,
      candidateCount: 1,
    },
    flow: {
      locked: true,
      source: "raw",
      predictedSeconds: seconds,
      rawDeltaSeconds: 0,
      timestampMs: 0,
    },
  };
}

function createInput(
  overrides: Partial<BoosterExpiryIncidentRuntimeSampleInput> &
    Pick<
      BoosterExpiryIncidentRuntimeSampleInput,
      "sampledAt" | "stateBefore" | "stateAfter" | "result"
    >,
): BoosterExpiryIncidentRuntimeSampleInput {
  return {
    configuration: CONFIGURATION,
    monitoringGeneration: 1,
    layoutKey: "1920x1080",
    sourceGeometryRevision: "geometry-1",
    source: {
      kind: "normal-monitoring-top-quarter",
      coordinateSpace: "capture-pixels",
      sourceDimensions: { width: 1920, height: 1080 },
      sampledRegion: { x: 0, y: 0, width: 1920, height: 270 },
      maxCaptureWidth: 1024,
      regionLabel: "1920x270",
    },
    performance: { recognitionMs: 3, totalMs: 4 },
    runtimeFailure: null,
    media: null,
    ...overrides,
  };
}
