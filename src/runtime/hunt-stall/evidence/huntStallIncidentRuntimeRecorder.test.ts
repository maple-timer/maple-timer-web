import { describe, expect, it } from "vitest";
import { createHuntStallIncidentConfiguration } from "../../../application/reporting/huntStallIncidentConfiguration";
import { updateHuntStallCooldownPresenceRuntimeState } from "../../../lib/huntStallCooldownPresenceRuntime";
import { updateHuntStallManualExperienceRuntimeState } from "../../../lib/huntStallManualExperienceRuntime";
import {
  createHuntStallRuntimeState,
  markHuntStallAlertPlaybackFinished,
} from "../../../lib/huntStallRuntimeState";
import { createDefaultHuntStallAlert } from "../../../lib/storage";
import type { HuntStallReading } from "../../../contracts/recognition/huntStallExperienceRecognition";
import type { HuntStallRuntimeState } from "../../../alertTypes";
import type { HuntStallAlertConfig } from "../../../types";
import {
  createHuntStallIncidentFrozenState,
  createHuntStallIncidentRegionRevision,
  createHuntStallIncidentRuntimeRecorder,
  recordHuntStallIncidentPlaybackRequested,
  recordHuntStallIncidentPlaybackTransition,
  recordHuntStallIncidentSample,
  requestHuntStallIncidentRuntimeReset,
  type HuntStallIncidentRuntimeRecorder,
} from "./huntStallIncidentRuntimeRecorder";

const REGION = { x: 10, y: 20, width: 120, height: 40 };

describe("huntStallIncidentRuntimeRecorder", () => {
  it("binds manual progress, threshold decision, playback, and repeat to one episode", () => {
    const config = makeConfig({
      mode: "manual-experience",
      stallThresholdSeconds: 5,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 5,
      repeatAlertMaxCount: 2,
    });
    let recorder = createHuntStallIncidentRuntimeRecorder(0);
    let state = createHuntStallRuntimeState();

    ({ recorder, state } = recordManual({
      recorder,
      state,
      config,
      sampledAt: 1_000,
      reading: makeReading("100", "a"),
    }));
    ({ recorder, state } = recordManual({
      recorder,
      state,
      config,
      sampledAt: 2_000,
      reading: makeReading("101", "b"),
    }));
    ({ recorder, state } = recordManual({
      recorder,
      state,
      config,
      sampledAt: 3_000,
      reading: makeReading("101", "b"),
    }));

    expect(recorder.archive.activityEpochs).toHaveLength(1);
    expect(recorder.archive.stallEpisodes).toHaveLength(1);
    expect(recorder.archive.activityEpochs[0]).toMatchObject({
      reason: "manual-progress-confirmed",
      startedAt: 3_000,
    });

    ({ recorder, state } = recordManual({
      recorder,
      state,
      config,
      sampledAt: 8_000,
      reading: makeReading("101", "b"),
    }));
    expect(recorder.archive.decisions).toHaveLength(1);
    expect(recorder.archive.decisions[0]).toMatchObject({
      kind: "initial",
      occurredAt: 8_000,
      dueAt: 8_000,
    });
    expect(recorder.archive.stallEpisodes[0].lastEvaluation).toMatchObject({
      thresholdReached: true,
      outcome: "alert",
    });

    const requested = recordHuntStallIncidentPlaybackRequested({
      previous: recorder,
      requestedAt: 8_010,
      visibilityState: "visible",
    });
    recorder = requested.recorder;
    expect(requested.attemptId).not.toBeNull();
    recorder = recordHuntStallIncidentPlaybackTransition({
      previous: recorder,
      attemptId: requested.attemptId!,
      status: "started",
      occurredAt: 8_020,
    }).recorder;
    recorder = recordHuntStallIncidentPlaybackTransition({
      previous: recorder,
      attemptId: requested.attemptId!,
      status: "finished",
      occurredAt: 8_500,
    }).recorder;
    state = markHuntStallAlertPlaybackFinished(state, state.alertedAt!, 8_500);

    ({ recorder, state } = recordManual({
      recorder,
      state,
      config,
      sampledAt: 13_500,
      reading: makeReading("101", "b"),
    }));
    expect(recorder.archive.decisions).toHaveLength(2);
    expect(recorder.archive.decisions[1]).toMatchObject({
      kind: "repeat",
      dueAt: 13_500,
      cycleId: recorder.archive.decisions[0].cycleId,
      stallEpisodeId: recorder.archive.decisions[0].stallEpisodeId,
    });
  });

  it("keeps cooldown presence pending until confirmed and creates a new episode after rearm", () => {
    const config = makeConfig({
      mode: "cooldown-presence",
      cooldownMissingThresholdSeconds: 1,
    });
    let recorder = createHuntStallIncidentRuntimeRecorder(0);
    let state = createHuntStallRuntimeState();

    ({ recorder, state } = recordCooldown({
      recorder,
      state,
      config,
      sampledAt: 1_000,
      value: 10,
    }));
    expect(recorder.archive.activityEpochs).toHaveLength(0);
    expect(recorder.archive.observations[0].transition?.kind).toBe("presence-pending");

    ({ recorder, state } = recordCooldown({
      recorder,
      state,
      config,
      sampledAt: 2_000,
      value: 9,
    }));
    expect(recorder.archive.activityEpochs).toHaveLength(1);
    expect(recorder.archive.activityEpochs[0].reason).toBe("cooldown-digit-changed");

    ({ recorder, state } = recordCooldown({
      recorder,
      state,
      config,
      sampledAt: 3_000,
      value: null,
    }));
    expect(recorder.archive.decisions).toHaveLength(1);
    expect(recorder.archive.decisions[0].kind).toBe("initial");

    const requested = recordHuntStallIncidentPlaybackRequested({
      previous: recorder,
      requestedAt: 3_010,
    });
    recorder = requested.recorder;
    recorder = recordHuntStallIncidentPlaybackTransition({
      previous: recorder,
      attemptId: requested.attemptId!,
      status: "started",
      occurredAt: 3_020,
    }).recorder;
    recorder = recordHuntStallIncidentPlaybackTransition({
      previous: recorder,
      attemptId: requested.attemptId!,
      status: "finished",
      occurredAt: 3_100,
    }).recorder;

    ({ recorder, state } = recordCooldown({
      recorder,
      state,
      config,
      sampledAt: 4_000,
      value: 8,
    }));
    ({ recorder, state } = recordCooldown({
      recorder,
      state,
      config,
      sampledAt: 5_000,
      value: 7,
    }));
    expect(recorder.archive.activityEpochs).toHaveLength(2);
    expect(recorder.archive.stallEpisodes).toHaveLength(2);
    expect(recorder.archive.stallEpisodes[0]).toMatchObject({
      status: "terminal",
      terminalReason: "activity-accepted",
    });
  });

  it("promotes the exact decision frame when browser playback fails", () => {
    const config = makeConfig({
      mode: "manual-experience",
      stallThresholdSeconds: 5,
    });
    let recorder = createHuntStallIncidentRuntimeRecorder(0);
    let state = createHuntStallRuntimeState();

    for (const [sampledAt, reading] of [
      [1_000, makeReading("100", "a")],
      [2_000, makeReading("101", "b")],
      [3_000, makeReading("101", "b")],
      [8_000, makeReading("101", "b")],
    ] as const) {
      ({ recorder, state } = recordManual({
        recorder,
        state,
        config,
        sampledAt,
        reading,
      }));
    }

    const decision = recorder.archive.decisions[0];
    const requested = recordHuntStallIncidentPlaybackRequested({
      previous: recorder,
      requestedAt: 8_010,
    });
    recorder = requested.recorder;
    recorder = recordHuntStallIncidentPlaybackTransition({
      previous: recorder,
      attemptId: requested.attemptId!,
      status: "failed",
      occurredAt: 8_020,
      error: "audio-playback-rejected",
    }).recorder;

    expect(recorder.archive.playbackAttempts[0]).toMatchObject({
      decisionId: decision.id,
      status: "failed",
      error: "audio-playback-rejected",
    });
    expect(
      recorder.archive.media.find((entry) => entry.frameId === decision.frameId),
    ).toMatchObject({ reason: "playback-failed" });
  });

  it("separates mode, region, stream, and configuration revisions", () => {
    const manual = makeConfig({ mode: "manual-experience" });
    let recorder = createHuntStallIncidentRuntimeRecorder(0);
    let state = createHuntStallRuntimeState();
    ({ recorder, state } = recordManual({
      recorder,
      state,
      config: manual,
      sampledAt: 1_000,
      reading: makeReading("100", "a"),
    }));
    const firstReset = recorder.boundary?.resetEpoch.id;

    const revised = { ...manual, stallThresholdSeconds: 30 };
    ({ recorder, state } = recordManual({
      recorder,
      state,
      config: revised,
      sampledAt: 2_000,
      reading: makeReading("100", "a"),
    }));
    expect(recorder.boundary?.resetEpoch.id).toBe(firstReset);
    expect(recorder.archive.configurationRevisions).toHaveLength(2);

    recorder = requestHuntStallIncidentRuntimeReset({
      previous: recorder,
      reason: "stream-replaced",
      requestedAt: 2_500,
    });
    ({ recorder, state } = recordManual({
      recorder,
      state: createHuntStallRuntimeState(),
      config: revised,
      sampledAt: 3_000,
      reading: makeReading("100", "a"),
    }));
    expect(recorder.boundary?.resetEpoch.id).not.toBe(firstReset);
    expect(recorder.boundary?.resetEpoch.reason).toBe("stream-replaced");

    const cooldown = makeConfig({ mode: "cooldown-presence" });
    ({ recorder } = recordCooldown({
      recorder,
      state: createHuntStallRuntimeState(),
      config: cooldown,
      sampledAt: 4_000,
      value: 10,
      region: { ...REGION, x: 40 },
    }));
    expect(recorder.boundary?.resetEpoch.reason).toBe("mode-changed");
    expect(new Set(recorder.archive.resetEpochs.map((item) => item.id)).size).toBe(3);
  });

  it("records failures, bounded media provenance, and detached presentation state", () => {
    const config = makeConfig({ mode: "manual-experience" });
    let recorder = createHuntStallIncidentRuntimeRecorder(0);
    const before = createHuntStallRuntimeState();
    const after = { ...before, status: "unavailable" as const, lastDecision: "sample-error" as const };
    recorder = recordHuntStallIncidentSample({
      previous: recorder,
      input: makeInput({
        config,
        sampledAt: 1_000,
        stateBefore: before,
        stateAfter: after,
        recognition: {
          decision: "error",
          reason: "worker-timeout",
          rawText: null,
          rawValue: null,
          correctedValue: null,
          fingerprint: null,
          confidence: null,
          foregroundRatio: null,
          visualActivityScore: null,
          visualChangeScore: null,
          usedVisualFallback: false,
          readableStreak: 0,
          visualActivityStreak: 0,
          failure: {
            stage: "timeout",
            code: "worker-timeout",
            message: null,
            durationMs: 1_000,
            recovered: false,
          },
        },
        runtimeFailure: {
          stage: "timeout",
          code: "worker-timeout",
          message: null,
          durationMs: 1_000,
          recovered: false,
        },
      }),
    });

    expect(recorder.archive.frames[0].runtimeFailure).toMatchObject({
      stage: "timeout",
      code: "worker-timeout",
    });
    expect(recorder.archive.media[0]).toMatchObject({
      reason: "runtime-error",
      rawDataUrl: "data:image/png;base64,raw",
    });
    expect(recorder.archive.lifecycleEvents.some((event) => event.action === "runtime-sample-failed")).toBe(true);

    const frozen = createHuntStallIncidentFrozenState({
      recorder,
      capturedAt: 1_100,
      state: after,
    });
    expect(frozen).toMatchObject({
      capturedAt: 1_100,
      status: "unavailable",
      decision: "sample-error",
      latestFrameId: recorder.archive.frames[0].id,
    });
  });
});

function recordManual({
  recorder,
  state,
  config,
  sampledAt,
  reading,
}: {
  recorder: HuntStallIncidentRuntimeRecorder;
  state: HuntStallRuntimeState;
  config: HuntStallAlertConfig;
  sampledAt: number;
  reading: HuntStallReading;
}) {
  const update = updateHuntStallManualExperienceRuntimeState({
    previous: state,
    reading,
    config,
    now: sampledAt,
    hasStream: true,
    hasRegion: true,
  });
  return {
    recorder: recordHuntStallIncidentSample({
      previous: recorder,
      input: makeInput({
        config,
        sampledAt,
        stateBefore: state,
        stateAfter: update.state,
        shouldAlert: update.shouldAlert,
        alertDecisionKind: update.shouldAlert
          ? update.state.repeatedAlertCount > 0
            ? "repeat"
            : "initial"
          : null,
        recognition: {
          decision: "accepted",
          reason: null,
          rawText: reading.rawRecognizedText ?? reading.recognizedText,
          rawValue: parseNumber(reading.rawRecognizedText ?? reading.recognizedText),
          correctedValue: parseNumber(reading.correctedRecognizedText ?? reading.recognizedText),
          fingerprint: reading.fingerprint,
          confidence: reading.confidence,
          foregroundRatio: reading.foregroundRatio,
          visualActivityScore: null,
          visualChangeScore: null,
          usedVisualFallback: false,
          readableStreak: update.state.stableSampleCount,
          visualActivityStreak: 0,
          failure: null,
        },
      }),
    }),
    state: update.state,
  };
}

function recordCooldown({
  recorder,
  state,
  config,
  sampledAt,
  value,
  region = REGION,
}: {
  recorder: HuntStallIncidentRuntimeRecorder;
  state: HuntStallRuntimeState;
  config: HuntStallAlertConfig;
  sampledAt: number;
  value: number | null;
  region?: typeof REGION;
}) {
  const result = {
    value,
    confidence: value === null ? 0 : 1,
    debug: { recognizedText: value === null ? undefined : String(value), reason: value === null ? "empty" : undefined },
  };
  const update = updateHuntStallCooldownPresenceRuntimeState({
    previous: state,
    result,
    activity: null,
    config,
    now: sampledAt,
    hasStream: true,
    hasRegion: true,
  });
  return {
    recorder: recordHuntStallIncidentSample({
      previous: recorder,
      input: makeInput({
        config,
        sampledAt,
        stateBefore: state,
        stateAfter: update.state,
        shouldAlert: update.shouldAlert,
        alertDecisionKind: update.shouldAlert ? "initial" : null,
        region,
        recognition: {
          decision: value === null ? "missing" : "accepted",
          reason: result.debug.reason ?? null,
          rawText: result.debug.recognizedText ?? null,
          rawValue: value,
          correctedValue: value,
          fingerprint: null,
          confidence: result.confidence,
          foregroundRatio: null,
          visualActivityScore: null,
          visualChangeScore: update.state.cooldownVisualChangeScore ?? null,
          usedVisualFallback: update.state.cooldownUsedVisualActivity === true,
          readableStreak: update.state.cooldownConsecutiveReadableCount,
          visualActivityStreak: update.state.cooldownConsecutiveVisualActivityCount ?? 0,
          failure: null,
        },
      }),
    }),
    state: update.state,
  };
}

function makeInput({
  config,
  sampledAt,
  stateBefore,
  stateAfter,
  recognition,
  runtimeFailure = null,
  shouldAlert = false,
  alertDecisionKind = null,
  region = REGION,
}: {
  config: HuntStallAlertConfig;
  sampledAt: number;
  stateBefore: HuntStallRuntimeState;
  stateAfter: HuntStallRuntimeState;
  recognition: Parameters<typeof recordHuntStallIncidentSample>[0]["input"]["recognition"];
  runtimeFailure?: Parameters<typeof recordHuntStallIncidentSample>[0]["input"]["runtimeFailure"];
  shouldAlert?: boolean;
  alertDecisionKind?: "initial" | "repeat" | null;
  region?: typeof REGION;
}) {
  const layoutKey = "1920x1080";
  return {
    sampledAt,
    configuration: createHuntStallIncidentConfiguration(config, 0.5),
    mode: config.mode,
    layoutKey,
    regionRevision: createHuntStallIncidentRegionRevision({
      mode: config.mode,
      layoutKey,
      region,
    }),
    sourceDimensions: { width: 1920, height: 1080 },
    region,
    sourceToCrop: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 },
    stateBefore,
    stateAfter,
    recognition,
    recognizer: {
      engine: config.mode === "manual-experience" ? "experience-ocr" : "cooldown-digit",
      modelId: null,
      modelVersion: "test-v1",
      workerVersion: "test-worker-v1",
      provider: "wasm",
    },
    runtimeFailure,
    timings: {
      captureMs: 1,
      cropMs: 1,
      recognitionMs: 2,
      transitionMs: 1,
      totalMs: 5,
    },
    shouldAlert,
    alertDecisionKind,
    media: {
      rawDataUrl: "data:image/png;base64,raw",
      processedDataUrl: "data:image/png;base64,processed",
    },
  };
}

function makeReading(value: string, token: string): HuntStallReading {
  return {
    fingerprint: token.repeat(128),
    recognizedText: value,
    rawRecognizedText: value,
    correctedRecognizedText: value,
    confidence: 0.99,
    foregroundRatio: 0.1,
  };
}

function makeConfig(
  override: Partial<HuntStallAlertConfig> = {},
): HuntStallAlertConfig {
  return {
    ...createDefaultHuntStallAlert(),
    enabled: true,
    manualExperienceRegion: { x: 0.1, y: 0.2, width: 0.2, height: 0.05 },
    cooldownRegion: { x: 0.1, y: 0.2, width: 0.05, height: 0.05 },
    ...override,
  };
}

function parseNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
