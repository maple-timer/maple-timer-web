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
import {
  createBoosterExpiryIncidentFrozenState,
  createBoosterExpiryIncidentRuntimeRecorder,
  createBoosterExpirySourceGeometryRevision,
  freezeBoosterExpiryIncidentRuntimeRecorder,
  recordBoosterExpiryIncidentConfigurationObserved,
  recordBoosterExpiryIncidentPlaybackRequested,
  recordBoosterExpiryIncidentPlaybackTransition,
  recordBoosterExpiryIncidentRuntimeSample,
  recordBoosterExpiryIncidentScheduleOutcome,
  recordBoosterExpiryIncidentScheduleRegistered,
  requestBoosterExpiryIncidentFlowRestart,
  requestBoosterExpiryIncidentRuntimeReset,
  shouldCaptureBoosterExpiryIncidentMedia,
  type BoosterExpiryIncidentRuntimeRecorder,
  type BoosterExpiryIncidentRuntimeSampleInput,
} from "./boosterExpiryIncidentRuntimeRecorder";
import type {
  BoosterExpiryIncidentConfiguration,
  BoosterExpiryIncidentRuntimeFailure,
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

describe("booster expiry incident runtime recorder", () => {
  it("records the exact normal sample, compact recognizer result, state pair, and media", () => {
    const before = createBoosterExpiryRuntimeState();
    const result = createWorkerResult(120);
    const after = transition(before, result, 1_000);
    const recorder = recordSample(
      createBoosterExpiryIncidentRuntimeRecorder(0),
      createInput({
        sampledAt: 1_000,
        stateBefore: before,
        stateAfter: after,
        result,
        media: { imageDataUrl: "data:image/png;base64,AAAA" },
      }),
    );

    expect(recorder.archive.frames).toHaveLength(1);
    expect(recorder.archive.frames[0]).toMatchObject({
      sampledAt: 1_000,
      source: {
        kind: "normal-monitoring-top-quarter",
        sourceDimensions: { width: 1920, height: 1080 },
        sampledRegion: { x: 0, y: 0, width: 1920, height: 270 },
      },
    });
    expect(recorder.archive.observations[0]).toMatchObject({
      decision: "accepted",
      recognizerVersion: "timer-catch-flow-v1",
      rawTime: { ok: true, seconds: 120, selectedBy: "timer-catch" },
      selectedTime: { ok: true, seconds: 120 },
      flow: { locked: true, source: "raw" },
      stateBefore: { status: "paused", candidateObservationCount: 0 },
      stateAfter: { status: "confirming", candidateObservationCount: 1 },
    });
    expect(recorder.archive.media[0]).toMatchObject({
      reason: "periodic",
      imageDataUrl: "data:image/png;base64,AAAA",
    });
    expect(recorder.archive.candidateAttempts[0]?.observationIds).toEqual([
      recorder.archive.observations[0]?.id,
    ]);
  });

  it("mirrors six normal 1000 ms samples as one confirmed runtime cycle", () => {
    const confirmed = createConfirmedRecorder();

    expect(confirmed.state.confirmedExpiresAt).toBe(121_000);
    expect(confirmed.recorder.archive.candidateAttempts).toHaveLength(1);
    expect(confirmed.recorder.archive.candidateAttempts[0]).toMatchObject({
      status: "confirmed",
      observationIds: confirmed.recorder.archive.observations.map(
        (entry) => entry.id,
      ),
    });
    expect(confirmed.recorder.archive.cycles).toHaveLength(1);
    expect(confirmed.recorder.archive.cycles[0]).toMatchObject({
      expiresAt: 121_000,
      confirmedAt: 6_000,
      observationIds: confirmed.recorder.archive.observations.map(
        (entry) => entry.id,
      ),
    });
    expect(confirmed.recorder.boundary?.activeCycle?.id).toBe(
      confirmed.recorder.archive.cycles[0]?.id,
    );
  });

  it("keeps missing, rejected, predicted, and runtime-error observations distinct", () => {
    let recorder = createBoosterExpiryIncidentRuntimeRecorder(0);
    let state = createBoosterExpiryRuntimeState();

    const missingAfter = transition(state, null, 1_000);
    recorder = recordSample(
      recorder,
      createInput({
        sampledAt: 1_000,
        stateBefore: state,
        stateAfter: missingAfter,
        result: null,
      }),
    );
    state = missingAfter;

    const rejected = createWorkerResult(null, {
      rawOk: false,
      selectedOk: false,
      reason: "digits-not-found",
    });
    const rejectedAfter = transition(state, rejected, 2_000);
    recorder = recordSample(
      recorder,
      createInput({
        sampledAt: 2_000,
        stateBefore: state,
        stateAfter: rejectedAfter,
        result: rejected,
      }),
    );
    state = rejectedAfter;

    const predicted = createWorkerResult(118, {
      rawOk: false,
      selectedOk: true,
      source: "predicted",
    });
    const predictedAfter = transition(state, predicted, 3_000);
    recorder = recordSample(
      recorder,
      createInput({
        sampledAt: 3_000,
        stateBefore: state,
        stateAfter: predictedAfter,
        result: predicted,
      }),
    );

    const failure: BoosterExpiryIncidentRuntimeFailure = {
      stage: "worker-runtime",
      code: "worker-crashed",
      technicalMessage: "worker stopped",
    };
    recorder = recordSample(
      recorder,
      createInput({
        sampledAt: 4_000,
        stateBefore: predictedAfter,
        stateAfter: predictedAfter,
        result: null,
        runtimeFailure: failure,
      }),
    );

    expect(
      recorder.archive.observations.map((entry) => entry.decision),
    ).toEqual(["missing", "rejected", "accepted", "error"]);
    expect(recorder.archive.observations[2]?.strongForConfirmation).toBe(false);
    expect(recorder.archive.candidateAttempts).toHaveLength(0);
    expect(recorder.archive.frames[3]?.runtimeFailure).toEqual(failure);
    expect(recorder.archive.omissions).toContainEqual(
      expect.objectContaining({ kind: "media", reason: "never-produced" }),
    );
  });

  it("restarts only the Worker flow while preserving a confirmed feature cycle", () => {
    const confirmed = createConfirmedRecorder();
    const cycleId = confirmed.recorder.boundary?.activeCycle?.id;
    const previousFlowId = confirmed.recorder.boundary?.flowEpoch.id;
    const requested = requestBoosterExpiryIncidentFlowRestart({
      previous: confirmed.recorder,
      reason: "worker-timeout",
      requestedAt: 6_500,
    });
    const nextState = transition(confirmed.state, null, 7_000);
    const recorder = recordSample(
      requested,
      createInput({
        sampledAt: 7_000,
        stateBefore: confirmed.state,
        stateAfter: nextState,
        result: null,
      }),
    );

    expect(recorder.boundary?.flowEpoch.id).not.toBe(previousFlowId);
    expect(recorder.boundary?.activeCycle?.id).toBe(cycleId);
    expect(recorder.boundary?.flowEpoch.reason).toBe("worker-timeout");
    expect(
      recorder.archive.lifecycleEvents.some(
        (entry) => entry.action === "worker-flow-restarted",
      ),
    ).toBe(true);
  });

  it("closes the old chain on a full continuity reset", () => {
    const confirmed = createConfirmedRecorder();
    const oldCycleId = confirmed.recorder.boundary?.activeCycle?.id;
    const requested = requestBoosterExpiryIncidentRuntimeReset({
      previous: confirmed.recorder,
      reason: "stream-replaced",
      requestedAt: 6_500,
    });
    const nextState = transition(confirmed.state, null, 7_000);
    const recorder = recordSample(
      requested,
      createInput({
        sampledAt: 7_000,
        stateBefore: confirmed.state,
        stateAfter: nextState,
        result: null,
      }),
    );

    expect(recorder.archive.resetEpochs).toHaveLength(2);
    expect(recorder.boundary?.resetEpoch.reason).toBe("stream-replaced");
    expect(recorder.boundary?.activeCycle).toBeNull();
    expect(
      recorder.archive.cycles.find((entry) => entry.id === oldCycleId),
    ).toMatchObject({
      status: "terminal",
      terminalReason: "reset-epoch",
    });
  });

  it("records configuration, schedule, decision, and playback as one parent-linked chain", () => {
    const confirmed = createConfirmedRecorder();
    const cycleId = confirmed.recorder.boundary!.activeCycle!.id;
    const revised = recordBoosterExpiryIncidentConfigurationObserved({
      previous: confirmed.recorder,
      configuration: {
        ...CONFIGURATION,
        alertLeadSeconds: 5,
        soundId: "booster-expiry-alt",
      },
      occurredAt: 7_000,
    });
    expect(revised.rejectedReason).toBeNull();

    const scheduled = recordBoosterExpiryIncidentScheduleRegistered({
      previous: revised.recorder,
      cycleId,
      registeredAt: 7_001,
      reason: "configuration-retimed",
    });
    const fired = recordBoosterExpiryIncidentScheduleOutcome({
      previous: scheduled.recorder,
      cycleId,
      outcome: "fired",
      occurredAt: 116_001,
    });
    const playback = recordBoosterExpiryIncidentPlaybackRequested({
      previous: fired.recorder,
      cycleId,
      requestedAt: 116_002,
    });
    const accepted = recordBoosterExpiryIncidentPlaybackTransition({
      previous: playback.recorder,
      attemptId: playback.attemptId!,
      status: "browser-play-accepted",
      occurredAt: 116_003,
    });
    const finished = recordBoosterExpiryIncidentPlaybackTransition({
      previous: accepted.recorder,
      attemptId: playback.attemptId!,
      status: "finished",
      occurredAt: 116_500,
    });

    expect(finished.recorder.archive.configurationRevisions).toHaveLength(2);
    expect(finished.recorder.archive.schedules[0]).toMatchObject({
      cycleId,
      status: "fired",
      alertDueAt: 116_000,
    });
    expect(finished.recorder.archive.decisions[0]).toMatchObject({
      cycleId,
      schedulerDelayMs: 1,
    });
    expect(finished.recorder.archive.playbackAttempts[0]).toMatchObject({
      cycleId,
      status: "finished",
      soundId: "booster-expiry-alt",
      effectiveVolume: 0.4,
    });
  });

  it("records two contradictory readings and closes the confirmed cycle", () => {
    const confirmed = createConfirmedRecorder();
    let recorder = confirmed.recorder;
    let state = confirmed.state;
    for (const [sampledAt, remaining] of [
      [7_000, 200],
      [8_000, 199],
    ] as const) {
      const result = createWorkerResult(remaining);
      const stateAfter = transition(state, result, sampledAt);
      recorder = recordSample(
        recorder,
        createInput({ sampledAt, stateBefore: state, stateAfter, result }),
      );
      state = stateAfter;
    }

    expect(state.confirmedExpiresAt).toBeNull();
    expect(recorder.boundary?.activeCycle).toBeNull();
    expect(
      recorder.archive.cycles[recorder.archive.cycles.length - 1],
    ).toMatchObject({
      status: "cancelled",
      terminalReason: "contradicted",
      contradictionCount: 2,
    });
  });

  it("freezes one lease and exposes deterministic media cadence and geometry identity", () => {
    const confirmed = createConfirmedRecorder();
    const frozenState = createBoosterExpiryIncidentFrozenState({
      recorder: confirmed.recorder,
      capturedAt: 7_000,
      state: confirmed.state,
    });
    const frozen = freezeBoosterExpiryIncidentRuntimeRecorder({
      previous: confirmed.recorder,
      frozenAt: 7_000,
    });

    expect(frozen.lease).toMatchObject({
      frozenAt: 7_000,
      cycleId: confirmed.recorder.boundary?.activeCycle?.id,
      leasedThroughFrameSequence: 6,
    });
    expect(frozenState).toMatchObject({
      status: "armed",
      latestFrameId: confirmed.recorder.boundary?.latestFrame?.id,
    });
    expect(
      shouldCaptureBoosterExpiryIncidentMedia({
        recorder: confirmed.recorder,
        sampledAt: 6_500,
      }),
    ).toBe(false);
    expect(
      shouldCaptureBoosterExpiryIncidentMedia({
        recorder: confirmed.recorder,
        sampledAt: 21_000,
      }),
    ).toBe(true);
    expect(
      createBoosterExpirySourceGeometryRevision({
        width: 1920,
        height: 1080,
        region: { x: 0, y: 0, width: 1920, height: 270 },
      }),
    ).toBe(
      createBoosterExpirySourceGeometryRevision({
        width: 1920,
        height: 1080,
        region: { x: 0, y: 0, width: 1920, height: 270 },
      }),
    );
  });
});

function createConfirmedRecorder(): {
  recorder: BoosterExpiryIncidentRuntimeRecorder;
  state: BoosterExpiryRuntimeState;
} {
  let recorder = createBoosterExpiryIncidentRuntimeRecorder(0);
  let state = createBoosterExpiryRuntimeState();
  for (let index = 0; index < 6; index += 1) {
    const sampledAt = (index + 1) * 1_000;
    const result = createWorkerResult(120 - index);
    const stateAfter = transition(state, result, sampledAt);
    recorder = recordSample(
      recorder,
      createInput({
        sampledAt,
        stateBefore: state,
        stateAfter,
        result,
        media:
          index === 0 || index === 5
            ? { imageDataUrl: `data:image/png;base64,${index}` }
            : null,
      }),
    );
    state = stateAfter;
  }
  return { recorder, state };
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

function createWorkerResult(
  seconds: number | null,
  options: {
    rawOk?: boolean;
    selectedOk?: boolean;
    source?: string;
    reason?: string;
  } = {},
): BoosterExpiryWorkerResult {
  const rawOk = options.rawOk ?? seconds !== null;
  const selectedOk = options.selectedOk ?? seconds !== null;
  const reason = options.reason ?? (seconds === null ? "not-found" : "ok");
  const createTime = (ok: boolean) => ({
    ok,
    reason,
    seconds: ok ? seconds : null,
    text: ok && seconds !== null ? `${seconds}` : null,
    format: ok ? ("m:ss" as const) : undefined,
    selectedBy: ok ? "timer-catch" : undefined,
    rect: ok ? { x: 10, y: 20, width: 30, height: 40 } : null,
    digitCount: ok && seconds !== null ? `${seconds}`.length : 0,
  });
  return {
    recognizerVersion: "timer-catch-flow-v1",
    rawTime: createTime(rawOk),
    time: createTime(selectedOk),
    timeRect: {
      ok: rawOk || selectedOk,
      reason,
      rect:
        rawOk || selectedOk ? { x: 10, y: 20, width: 30, height: 40 } : null,
      matchCount: rawOk || selectedOk ? 1 : 0,
      candidateCount: rawOk || selectedOk ? 1 : 0,
    },
    flow: {
      locked: options.source !== "predicted",
      source: options.source ?? "raw",
      predictedSeconds: selectedOk ? seconds : null,
      rawDeltaSeconds: rawOk ? 0 : null,
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

function recordSample(
  previous: BoosterExpiryIncidentRuntimeRecorder,
  input: BoosterExpiryIncidentRuntimeSampleInput,
): BoosterExpiryIncidentRuntimeRecorder {
  return recordBoosterExpiryIncidentRuntimeSample({ previous, input });
}
