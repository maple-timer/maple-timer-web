import { describe, expect, it } from "vitest";
import {
  createSpecialCoreRuntimeState,
  updateSpecialCoreRuntimeFromSample,
  type SpecialCoreDetectedIcon,
  type SpecialCoreRuntimeState,
  type SpecialCoreSnapshot,
} from "../../../lib/specialCore";
import {
  createSpecialCoreIncidentFrozenState,
  createSpecialCoreIncidentRuntimeRecorder,
  createSpecialCoreSourceGeometryRevision,
  recordSpecialCoreIncidentConfigurationObserved,
  recordSpecialCoreIncidentPlaybackRequested,
  recordSpecialCoreIncidentPlaybackTransition,
  recordSpecialCoreIncidentRuntimeSample,
  recordSpecialCoreIncidentScheduleOutcome,
  recordSpecialCoreIncidentScheduleRegistered,
  requestSpecialCoreIncidentRuntimeReset,
  shouldCaptureSpecialCoreIncidentMedia,
  type SpecialCoreIncidentRuntimeRecorder,
  type SpecialCoreIncidentRuntimeSampleInput,
} from "./specialCoreIncidentRuntimeRecorder";
import type {
  SpecialCoreIncidentConfiguration,
  SpecialCoreIncidentRuntimeFailure,
} from "./specialCoreIncidentEvidenceTypes";
import {
  getSpecialCoreIncidentEvidenceMetadataChars,
  SPECIAL_CORE_INCIDENT_METADATA_MAX_CHARS,
} from "./specialCoreIncidentEvidenceArchive";

const CONFIGURATION: SpecialCoreIncidentConfiguration = {
  enabled: true,
  cooldownSeconds: 30,
  alertLeadSeconds: 5,
  soundId: "special-core-countdown-female",
  featureVolume: 0.8,
  masterVolume: 0.5,
  effectiveVolume: 0.4,
};

describe("special core incident runtime recorder", () => {
  it("records exact parser input, row eligibility, compact matcher evidence, and state pair", () => {
    const before = createSpecialCoreRuntimeState({ status: "waiting" });
    const transition = createDetectedTransition(before, 1_000);
    const recorder = recordSample(
      createSpecialCoreIncidentRuntimeRecorder(0),
      createInput({
        sampledAt: 1_000,
        stateBefore: before,
        stateAfter: transition.stateAfter,
        snapshot: transition.snapshot,
        media: { imageDataUrl: "data:image/png;base64,AAAA" },
      }),
    );

    const frame = recorder.archive.frames[0]!;
    expect(frame.source).toEqual({
      kind: "normal-shared-parser",
      parserInputMode: "fullFrame",
      coordinateSpace: "capture-pixels",
      sourceDimensions: { width: 1920, height: 1080 },
      parserInputRegion: { x: 0, y: 0, width: 1920, height: 1080 },
      storedMediaKind: "buff-slot-top-right-quadrant-v1",
      storedMediaRegion: { x: 960, y: 0, width: 960, height: 540 },
      regionLabel: "960x540",
    });
    expect(frame.parser).toMatchObject({
      engine: "dl",
      version: "buff-parser-light-v1",
      runtime: {
        executionProvider: "webgpu",
        modelId: "buff-parser-light-v1",
      },
    });
    expect(frame.parsedBoxes).toHaveLength(3);
    expect(frame.rowGroups).toEqual([
      {
        rowIndex: 0,
        y: 10,
        size: 32,
        boxIndexes: [0, 1],
        eligible: true,
      },
      {
        rowIndex: 1,
        y: 52,
        size: 32,
        boxIndexes: [2],
        eligible: false,
      },
    ]);
    expect(frame.eligibleBoxIndexes).toEqual([0, 1]);
    expect(frame.mediaFrameId).toBe(`special-core-media:${frame.id}`);

    const observation = recorder.archive.observations[0]!;
    expect(observation.decision).toBe("accepted");
    expect(observation.selectedCandidateBoxIndex).toBe(0);
    expect(observation.candidates[0]).toMatchObject({
      boxIndex: 0,
      match: {
        matched: true,
        modelId: "special-core-deep-v2",
        decisionReason: "base_and_positive_gate_passed",
      },
    });
    expect(observation.candidates[0]).not.toHaveProperty("icon");
    expect(observation.stateBefore).toMatchObject({
      status: "waiting",
      runtimeActivationId: 0,
      pendingConfirmationCount: 0,
    });
    expect(observation.stateAfter).toMatchObject({
      status: "confirming",
      runtimeActivationId: 0,
      pendingConfirmationCount: 1,
    });
  });

  it("mirrors the existing two-frame runtime confirmation as one linked activation", () => {
    const initial = createSpecialCoreRuntimeState({ status: "waiting" });
    const first = createDetectedTransition(initial, 1_000);
    let recorder = recordSample(
      createSpecialCoreIncidentRuntimeRecorder(0),
      createInput({
        sampledAt: 1_000,
        stateBefore: initial,
        stateAfter: first.stateAfter,
        snapshot: first.snapshot,
      }),
    );
    const second = createDetectedTransition(first.stateAfter, 2_000);
    recorder = recordSample(
      recorder,
      createInput({
        sampledAt: 2_000,
        stateBefore: first.stateAfter,
        stateAfter: second.stateAfter,
        snapshot: second.snapshot,
        media: { imageDataUrl: "data:image/png;base64,BBBB" },
      }),
    );

    expect(recorder.archive.confirmationAttempts).toHaveLength(1);
    expect(recorder.archive.confirmationAttempts[0]).toMatchObject({
      status: "confirmed",
      observationIds: [
        recorder.archive.observations[0]!.id,
        recorder.archive.observations[1]!.id,
      ],
    });
    expect(recorder.archive.activations).toHaveLength(1);
    expect(recorder.archive.activations[0]).toMatchObject({
      runtimeActivationId: 1,
      startedAt: 1_000,
      confirmedAt: 2_000,
      cooldownEndsAt: 31_000,
      alertDueAt: 26_000,
    });
    expect(recorder.boundary?.activeActivation?.runtimeActivationId).toBe(1);
  });

  it("keeps missing, rejected, and runtime-error observations distinct", () => {
    let recorder = createSpecialCoreIncidentRuntimeRecorder(0);
    const waiting = createSpecialCoreRuntimeState({ status: "waiting" });
    const missing = createMissingTransition(waiting, 1_000);
    recorder = recordSample(
      recorder,
      createInput({
        sampledAt: 1_000,
        stateBefore: waiting,
        stateAfter: missing.stateAfter,
        snapshot: missing.snapshot,
      }),
    );
    const rejectedSnapshot = createSnapshot(2_000, null, [createCandidate(false)]);
    recorder = recordSample(
      recorder,
      createInput({
        sampledAt: 2_000,
        stateBefore: missing.stateAfter,
        stateAfter: createSpecialCoreRuntimeState({
          ...missing.stateAfter,
          lastSampledAt: 2_000,
        }),
        snapshot: rejectedSnapshot,
      }),
    );
    const failure: SpecialCoreIncidentRuntimeFailure = {
      stage: "shared-parser",
      code: "model-session-create-failed",
      technicalMessage: "session failed",
      details: { provider: "webgpu" },
    };
    recorder = recordSample(
      recorder,
      createInput({
        sampledAt: 3_000,
        stateBefore: missing.stateAfter,
        stateAfter: createSpecialCoreRuntimeState({
          ...missing.stateAfter,
          status: "unavailable",
          lastSampledAt: 3_000,
          unsupportedReason: "session failed",
        }),
        snapshot: {
          ...createSnapshot(3_000, null, []),
          error: "session failed",
        },
        runtimeFailure: failure,
      }),
    );

    expect(recorder.archive.observations.map((entry) => entry.decision)).toEqual([
      "missing",
      "rejected",
      "error",
    ]);
    expect(
      recorder.archive.frames[recorder.archive.frames.length - 1]?.runtimeFailure,
    ).toEqual(failure);
    expect(
      recorder.archive.lifecycleEvents.some(
        (entry) =>
          entry.category === "runtime-error" &&
          entry.action === "runtime-sample-failed",
      ),
    ).toBe(true);
  });

  it("records configuration revisions without resetting an active incident", () => {
    const confirmed = createConfirmedRecorder();
    const state = confirmed.state;
    const revisedConfiguration = {
      ...CONFIGURATION,
      alertLeadSeconds: 8,
      soundId: "another-sound",
    };
    const next = recordSample(
      confirmed.recorder,
      createInput({
        sampledAt: 3_000,
        configuration: revisedConfiguration,
        stateBefore: state,
        stateAfter: state,
        snapshot: createSnapshot(3_000, null, []),
      }),
    );

    expect(next.archive.resetEpochs).toHaveLength(1);
    expect(next.archive.configurationRevisions).toHaveLength(2);
    expect(next.boundary?.activeActivation?.runtimeActivationId).toBe(1);
    expect(
      next.archive.lifecycleEvents.find(
        (entry) => entry.action === "configuration-revised",
      )?.details,
    ).toMatchObject({ timingChanged: true });
  });

  it("closes the old boundary on stream replacement and rejects cross-reset linkage", () => {
    const confirmed = createConfirmedRecorder();
    const pending = requestSpecialCoreIncidentRuntimeReset({
      previous: confirmed.recorder,
      reason: "stream-replaced",
      requestedAt: 3_000,
    });
    const next = recordSample(
      pending,
      createInput({
        sampledAt: 3_000,
        layoutKey: "1280x720",
        sourceGeometryRevision: "geometry-2",
        stateBefore: createSpecialCoreRuntimeState({ status: "waiting" }),
        stateAfter: createSpecialCoreRuntimeState({ status: "waiting" }),
        snapshot: createSnapshot(3_000, null, []),
      }),
    );

    expect(next.archive.resetEpochs).toHaveLength(2);
    expect(next.archive.activations[0]).toMatchObject({
      status: "terminal",
      terminalReason: "reset-epoch",
    });
    expect(next.boundary?.resetEpoch.reason).toBe("stream-replaced");
    expect(next.boundary?.activeActivation).toBeNull();
  });

  it("links registration, fire decision, browser acceptance, and finish by stable IDs", () => {
    const confirmed = createConfirmedRecorder();
    let recorder = confirmed.recorder;
    const scheduled = recordSpecialCoreIncidentScheduleRegistered({
      previous: recorder,
      runtimeActivationId: 1,
      registeredAt: 2_100,
      reason: "activation-confirmed",
    });
    expect(scheduled.rejectedReason).toBeNull();
    recorder = scheduled.recorder;

    const fired = recordSpecialCoreIncidentScheduleOutcome({
      previous: recorder,
      runtimeActivationId: 1,
      outcome: "fired",
      occurredAt: 26_025,
    });
    expect(fired.rejectedReason).toBeNull();
    recorder = fired.recorder;

    const requested = recordSpecialCoreIncidentPlaybackRequested({
      previous: recorder,
      runtimeActivationId: 1,
      requestedAt: 26_030,
      startOffsetSeconds: 5,
    });
    expect(requested.attemptId).not.toBeNull();
    recorder = requested.recorder;

    const accepted = recordSpecialCoreIncidentPlaybackTransition({
      previous: recorder,
      attemptId: requested.attemptId!,
      status: "browser-play-accepted",
      occurredAt: 26_040,
    });
    recorder = accepted.recorder;
    const finished = recordSpecialCoreIncidentPlaybackTransition({
      previous: recorder,
      attemptId: requested.attemptId!,
      status: "finished",
      occurredAt: 31_000,
    });

    expect(finished.recorder.archive.schedules[0]).toMatchObject({
      status: "fired",
      alertDueAt: 26_000,
    });
    expect(finished.recorder.archive.decisions[0]).toMatchObject({
      occurredAt: 26_025,
      schedulerDelayMs: 25,
    });
    expect(finished.recorder.archive.playbackAttempts[0]).toMatchObject({
      status: "finished",
      requestedAt: 26_030,
      browserAcceptedAt: 26_040,
      finishedAt: 31_000,
      effectiveVolume: 0.4,
      startOffsetSeconds: 5,
    });
  });

  it("rejects a stale numeric runtime activation instead of attaching its timeout", () => {
    const confirmed = createConfirmedRecorder();
    const result = recordSpecialCoreIncidentScheduleRegistered({
      previous: confirmed.recorder,
      runtimeActivationId: 99,
      registeredAt: 2_100,
      reason: "activation-confirmed",
    });

    expect(result.rejectedReason).toBe("stale-activation");
    expect(result.recorder.archive.schedules).toHaveLength(0);
    expect(
      result.recorder.archive.lifecycleEvents[
        result.recorder.archive.lifecycleEvents.length - 1
      ],
    ).toMatchObject({
      category: "runtime-error",
      action: "boundary-rejected",
    });
  });

  it("replaces a schedule only after the matching timing revision is recorded", () => {
    const confirmed = createConfirmedRecorder();
    let recorder = recordSpecialCoreIncidentScheduleRegistered({
      previous: confirmed.recorder,
      runtimeActivationId: 1,
      registeredAt: 2_100,
      reason: "activation-confirmed",
    }).recorder;
    const revisedConfiguration = {
      ...CONFIGURATION,
      alertLeadSeconds: 8,
    };
    recorder = recordSample(
      recorder,
      createInput({
        sampledAt: 3_000,
        configuration: revisedConfiguration,
        stateBefore: confirmed.state,
        stateAfter: {
          ...confirmed.state,
          alertDueAt: 23_000,
        },
        snapshot: createSnapshot(3_000, null, []),
      }),
    );
    recorder = recordSpecialCoreIncidentScheduleRegistered({
      previous: recorder,
      runtimeActivationId: 1,
      registeredAt: 3_010,
      reason: "configuration-retimed",
    }).recorder;

    expect(recorder.archive.schedules).toHaveLength(2);
    expect(recorder.archive.schedules[0]).toMatchObject({ status: "replaced" });
    expect(recorder.archive.schedules[1]).toMatchObject({
      status: "registered",
      alertDueAt: 23_000,
      reason: "configuration-retimed",
    });
  });

  it("records a scheduler-side configuration revision before the next frame", () => {
    const confirmed = createConfirmedRecorder();
    let recorder = recordSpecialCoreIncidentScheduleRegistered({
      previous: confirmed.recorder,
      runtimeActivationId: 1,
      registeredAt: 2_100,
      reason: "activation-confirmed",
    }).recorder;
    const revised = recordSpecialCoreIncidentConfigurationObserved({
      previous: recorder,
      configuration: {
        ...CONFIGURATION,
        alertLeadSeconds: 8,
        soundId: "custom:retimed",
      },
      occurredAt: 2_500,
    });
    recorder = recordSpecialCoreIncidentScheduleRegistered({
      previous: revised.recorder,
      runtimeActivationId: 1,
      registeredAt: 2_501,
      reason: "configuration-retimed",
    }).recorder;

    expect(revised.rejectedReason).toBeNull();
    expect(recorder.archive.configurationRevisions).toHaveLength(2);
    expect(recorder.archive.schedules).toEqual([
      expect.objectContaining({ status: "replaced", alertDueAt: 26_000 }),
      expect.objectContaining({
        status: "registered",
        alertDueAt: 23_000,
        timingConfigRevisionId:
          recorder.boundary?.configurationRevision.id,
      }),
    ]);
  });

  it("captures a detached panel-state identity without inventing physical audibility", () => {
    const confirmed = createConfirmedRecorder();
    const frozen = createSpecialCoreIncidentFrozenState({
      recorder: confirmed.recorder,
      capturedAt: 2_500,
      state: confirmed.state,
    });

    expect(frozen).toMatchObject({
      capturedAt: 2_500,
      enabled: true,
      status: "cooldown",
      decision: "activation-active",
      activationId: confirmed.recorder.boundary?.activeActivation?.id,
    });
    expect(frozen).not.toHaveProperty("audible");
  });

  it("requests sparse source media periodically and always for an in-flight confirmation", () => {
    const empty = createSpecialCoreIncidentRuntimeRecorder(0);
    expect(
      shouldCaptureSpecialCoreIncidentMedia({ recorder: empty, sampledAt: 1_000 }),
    ).toBe(true);

    const initial = createSpecialCoreRuntimeState({ status: "waiting" });
    const first = createDetectedTransition(initial, 1_000);
    const recorder = recordSample(
      empty,
      createInput({
        sampledAt: 1_000,
        stateBefore: initial,
        stateAfter: first.stateAfter,
        snapshot: first.snapshot,
        media: { imageDataUrl: "data:image/png;base64,AAAA" },
      }),
    );
    expect(recorder.boundary?.activeConfirmationAttempt).not.toBeNull();
    expect(
      shouldCaptureSpecialCoreIncidentMedia({ recorder, sampledAt: 2_000 }),
    ).toBe(true);

    const noPending = {
      ...recorder,
      boundary: recorder.boundary
        ? { ...recorder.boundary, activeConfirmationAttempt: null }
        : null,
    };
    expect(
      shouldCaptureSpecialCoreIncidentMedia({ recorder: noPending, sampledAt: 10_000 }),
    ).toBe(false);
    expect(
      shouldCaptureSpecialCoreIncidentMedia({ recorder: noPending, sampledAt: 16_000 }),
    ).toBe(true);
  });

  it("creates a stable source geometry revision from dimensions and ROI", () => {
    const first = createSpecialCoreSourceGeometryRevision({
      width: 1920,
      height: 1080,
      roi: { x: 960, y: 0, width: 960, height: 540 },
    });
    const same = createSpecialCoreSourceGeometryRevision({
      width: 1920,
      height: 1080,
      roi: { x: 960, y: 0, width: 960, height: 540 },
    });
    const changed = createSpecialCoreSourceGeometryRevision({
      width: 1280,
      height: 720,
      roi: { x: 640, y: 0, width: 640, height: 360 },
    });

    expect(first).toBe(same);
    expect(changed).not.toBe(first);
  });

  it("does not mutate the runtime states or candidate icon buffers it mirrors", () => {
    const before = createSpecialCoreRuntimeState({ status: "waiting" });
    const transition = createDetectedTransition(before, 1_000);
    const beforeJson = JSON.stringify(before);
    const afterJson = JSON.stringify(transition.stateAfter);
    const iconCopy = new Uint8ClampedArray(
      transition.snapshot.detectedIcon!.icon.data,
    );

    recordSample(
      createSpecialCoreIncidentRuntimeRecorder(0),
      createInput({
        sampledAt: 1_000,
        stateBefore: before,
        stateAfter: transition.stateAfter,
        snapshot: transition.snapshot,
      }),
    );

    expect(JSON.stringify(before)).toBe(beforeJson);
    expect(JSON.stringify(transition.stateAfter)).toBe(afterJson);
    expect(transition.snapshot.detectedIcon!.icon.data).toEqual(iconCopy);
  });

  it("keeps worst-case normal-loop metadata under the archive cap", () => {
    let recorder = createSpecialCoreIncidentRuntimeRecorder(0);
    let state = createSpecialCoreRuntimeState({ status: "waiting" });
    for (let sequence = 1; sequence <= 72; sequence += 1) {
      const sampledAt = sequence * 1_000;
      const candidates = Array.from({ length: 40 }, (_, index) => ({
        ...createCandidate(false),
        boxIndex: index,
        box: { x: index * 34, y: 10, size: 32, confidence: 0.9, score: 0.8 },
      }));
      const snapshot = createSnapshot(sampledAt, null, candidates);
      const nextState = createSpecialCoreRuntimeState({
        ...state,
        status: "waiting",
        lastSampledAt: sampledAt,
        boxCount: 40,
        detectedCount: 0,
      });
      recorder = recordSample(
        recorder,
        createInput({
          sampledAt,
          stateBefore: state,
          stateAfter: nextState,
          snapshot,
          parsedBoxes: candidates.map((entry) => entry.box),
          rowGroups: [
            {
              rowIndex: 0,
              y: 10,
              size: 32,
              boxIndexes: candidates.map((entry) => entry.boxIndex),
              eligible: true,
            },
          ],
          eligibleBoxIndexes: candidates.map((entry) => entry.boxIndex),
        }),
      );
      state = nextState;
    }

    expect(getSpecialCoreIncidentEvidenceMetadataChars(recorder.archive)).toBeLessThanOrEqual(
      SPECIAL_CORE_INCIDENT_METADATA_MAX_CHARS,
    );
    expect(
      recorder.archive.frames[recorder.archive.frames.length - 1]?.sampledAt,
    ).toBe(72_000);
    expect(
      recorder.archive.observations[recorder.archive.observations.length - 1]
        ?.sampledAt,
    ).toBe(72_000);
    expect(
      recorder.archive.omissions.some(
        (entry) => entry.kind === "frame" && entry.reason === "metadata-cap",
      ),
    ).toBe(true);
  });
});

function createConfirmedRecorder(): {
  recorder: SpecialCoreIncidentRuntimeRecorder;
  state: SpecialCoreRuntimeState;
} {
  const initial = createSpecialCoreRuntimeState({ status: "waiting" });
  const first = createDetectedTransition(initial, 1_000);
  let recorder = recordSample(
    createSpecialCoreIncidentRuntimeRecorder(0),
    createInput({
      sampledAt: 1_000,
      stateBefore: initial,
      stateAfter: first.stateAfter,
      snapshot: first.snapshot,
      media: { imageDataUrl: "data:image/png;base64,AAAA" },
    }),
  );
  const second = createDetectedTransition(first.stateAfter, 2_000);
  recorder = recordSample(
    recorder,
    createInput({
      sampledAt: 2_000,
      stateBefore: first.stateAfter,
      stateAfter: second.stateAfter,
      snapshot: second.snapshot,
      media: { imageDataUrl: "data:image/png;base64,BBBB" },
    }),
  );
  return { recorder, state: second.stateAfter };
}

function createDetectedTransition(
  stateBefore: SpecialCoreRuntimeState,
  sampledAt: number,
) {
  const detectedIcon = createCandidate(true);
  const snapshot = createSnapshot(sampledAt, detectedIcon, [detectedIcon]);
  const stateAfter = updateSpecialCoreRuntimeFromSample({
    previous: stateBefore,
    sample: {
      ...snapshot,
      parserRuntime: null,
      parsedBoxes: [],
      rowGroups: [],
      eligibleBoxIndexes: [],
      unsupported: false,
      unsupportedReason: null,
    },
    config: CONFIGURATION,
    now: sampledAt,
  });
  return { snapshot, stateAfter };
}

function createMissingTransition(
  stateBefore: SpecialCoreRuntimeState,
  sampledAt: number,
) {
  const snapshot = createSnapshot(sampledAt, null, []);
  const stateAfter = updateSpecialCoreRuntimeFromSample({
    previous: stateBefore,
    sample: {
      ...snapshot,
      parserRuntime: null,
      parsedBoxes: [],
      rowGroups: [],
      eligibleBoxIndexes: [],
      unsupported: false,
      unsupportedReason: null,
    },
    config: CONFIGURATION,
    now: sampledAt,
  });
  return { snapshot, stateAfter };
}

function createSnapshot(
  sampledAt: number,
  detectedIcon: SpecialCoreDetectedIcon | null,
  candidateIcons: SpecialCoreDetectedIcon[],
): SpecialCoreSnapshot {
  return {
    sampledAt,
    error: null,
    parserEngine: "dl",
    parserVersion: "buff-parser-light-v1",
    parserFallbackReason: null,
    boxCount: 3,
    detectedCount: detectedIcon ? 1 : 0,
    detectedIcon,
    candidateIcons,
    performance: {
      totalMs: 11,
      detectMs: 7,
      matchMs: 4,
      boxCount: 3,
    },
  };
}

function createCandidate(matched: boolean): SpecialCoreDetectedIcon {
  return {
    boxIndex: 0,
    box: { x: 10, y: 10, size: 32, confidence: 0.99, score: 0.98 },
    icon: {
      width: 32,
      height: 32,
      data: new Uint8ClampedArray(32 * 32 * 4).fill(127),
    },
    match: {
      matched,
      targetId: matched ? "specialCore" : null,
      bundleId: "special-core-deep-v2",
      modelId: "special-core-deep-v2",
      modelVersion: "v2",
      variantId: "fp32",
      gateVersion: 2,
      score: matched ? 0.99 : 0.2,
      threshold: 0.8,
      margin: matched ? 0.19 : -0.6,
      gateScore: matched ? 0.95 : 0.1,
      gateThreshold: 0.75,
      gateMargin: matched ? 0.2 : -0.65,
      rescueThreshold: 0.9,
      rescueMargin: matched ? 0.09 : -0.7,
      basePassed: matched,
      positiveGatePassed: matched,
      primaryPassed: matched,
      rescuePassed: false,
      decisionReason: matched
        ? "base_and_positive_gate_passed"
        : "below_base_threshold",
      elapsedMs: 3.5,
    },
  };
}

function createInput(
  overrides: Partial<SpecialCoreIncidentRuntimeSampleInput> &
    Pick<
      SpecialCoreIncidentRuntimeSampleInput,
      "sampledAt" | "stateBefore" | "stateAfter" | "snapshot"
    >,
): SpecialCoreIncidentRuntimeSampleInput {
  return {
    configuration: CONFIGURATION,
    parserRuntimeGeneration: "webgpu:default:ready",
    layoutKey: "1920x1080",
    sourceGeometryRevision: "geometry-1",
    source: {
      kind: "normal-shared-parser",
      parserInputMode: "fullFrame",
      coordinateSpace: "capture-pixels",
      sourceDimensions: { width: 1920, height: 1080 },
      parserInputRegion: { x: 0, y: 0, width: 1920, height: 1080 },
      storedMediaKind: "buff-slot-top-right-quadrant-v1",
      storedMediaRegion: { x: 960, y: 0, width: 960, height: 540 },
      regionLabel: "960x540",
    },
    parser: {
      engine: "dl",
      version: "buff-parser-light-v1",
      fallbackReason: null,
      runtime: {
        recognitionEngine: "dl",
        parserVersion: "buff-parser-light-v1",
        modelId: "buff-parser-light-v1",
        modelInputWidth: 960,
        modelInputHeight: 544,
        onnxRuntimeVersion: "1.22.0",
        executionProvider: "webgpu",
        selectionSource: "default",
        wasmThreads: null,
      },
    },
    parsedBoxes: [
      { x: 10, y: 10, size: 32, confidence: 0.99, score: 0.98 },
      { x: 48, y: 10, size: 32, confidence: 0.98, score: 0.97 },
      { x: 10, y: 52, size: 32, confidence: 0.97, score: 0.96 },
    ],
    rowGroups: [
      {
        rowIndex: 0,
        y: 10,
        size: 32,
        boxIndexes: [0, 1],
        eligible: true,
      },
      {
        rowIndex: 1,
        y: 52,
        size: 32,
        boxIndexes: [2],
        eligible: false,
      },
    ],
    eligibleBoxIndexes: [0, 1],
    timings: {
      totalMs: 11,
      detectMs: 7,
      matchMs: 4,
      sharedParserTotalMs: 7,
      sharedParserDetectMs: 6,
      resultAgeMs: 0,
      droppedSampleCount: 0,
    },
    runtimeFailure: null,
    media: null,
    ...overrides,
  };
}

function recordSample(
  previous: SpecialCoreIncidentRuntimeRecorder,
  input: SpecialCoreIncidentRuntimeSampleInput,
): SpecialCoreIncidentRuntimeRecorder {
  return recordSpecialCoreIncidentRuntimeSample({ previous, input });
}
