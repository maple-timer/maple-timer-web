import { describe, expect, it } from "vitest";
import type {
  SkillIncidentMode,
  SkillIncidentRuntimeState,
} from "./skillIncidentEvidenceTypes";
import {
  createSkillIncidentRuntimeRecorder,
  recordSkillIncidentAlertDecision,
  recordSkillIncidentPlaybackFailed,
  recordSkillIncidentPlaybackFinished,
  recordSkillIncidentPlaybackRequested,
  recordSkillIncidentPlaybackStarted,
  recordSkillIncidentSample,
  recordSkillIncidentTargetArbitration,
  resetSkillIncidentRuntimeRecorder,
  shouldCaptureSkillIncidentPrecisionMedia,
  shouldCaptureSkillIncidentQuickSlotMedia,
  syncSkillIncidentRuntimeSkills,
  type SkillIncidentRuntimeRecorder,
  type SkillIncidentSampleInput,
} from "./skillIncidentRuntimeRecorder";

describe("skill incident runtime recorder", () => {
  it("keeps ordinary quick-slot readings in one cycle and splits only a runtime-confirmed rearm", () => {
    let recorder = createSkillIncidentRuntimeRecorder({ now: 0 });
    const firstAfter = state({
      status: "running",
      observedValue: 30,
      estimatedExpiresAt: 31_000,
      lastAlertCycleStartedAt: 1_000,
      initialAlertDelaySeconds: 1.5,
      initialAlertDelayCycleStartedAt: 1_000,
    });
    const first = record(recorder, {
      sampledAt: 1_000,
      stateAfter: firstAfter,
    });
    recorder = first.recorder;

    const descending = record(recorder, {
      sampledAt: 2_000,
      stateBefore: firstAfter,
      stateAfter: state({
        ...firstAfter,
        observedValue: 29,
        estimatedExpiresAt: 31_050,
      }),
    });
    recorder = descending.recorder;

    expect(descending.cycleId).toBe(first.cycleId);
    expect(recorder.archive.cycles).toHaveLength(1);
    expect(recorder.archive.cycles[0]).toMatchObject({
      initialAlertDelaySeconds: 1.5,
      status: "active",
    });

    const rearmed = record(recorder, {
      sampledAt: 40_000,
      stateBefore: state({
        ...firstAfter,
        observedValue: 0,
        alertedAt: 30_000,
      }),
      stateAfter: state({
        status: "running",
        observedValue: 30,
        estimatedExpiresAt: 70_000,
        lastAlertCycleStartedAt: 40_000,
        initialAlertDelaySeconds: 0.5,
        initialAlertDelayCycleStartedAt: 40_000,
      }),
    });
    recorder = rearmed.recorder;

    expect(rearmed.cycleId).not.toBe(first.cycleId);
    expect(recorder.archive.cycles).toHaveLength(2);
    expect(
      recorder.archive.cycles.find((entry) => entry.id === first.cycleId),
    ).toMatchObject({ status: "terminal", terminalReason: "timer-rearmed" });
    expect(
      recorder.archive.cycles.find((entry) => entry.id === rearmed.cycleId),
    ).toMatchObject({
      status: "active",
      initialAlertDelaySeconds: 0.5,
    });
  });

  it("retains precision pending anchors, keeps pre-alert refreshes together, and splits a post-alert extension", () => {
    let recorder = createSkillIncidentRuntimeRecorder({ now: 0 });
    const pendingObservationIds: string[] = [];

    for (let index = 1; index <= 5; index += 1) {
      const result = record(recorder, {
        sampledAt: index * 1_000,
        mode: "precision-countdown",
        stateAfter: state({ status: "detecting", observedValue: 30 }),
        flow: precisionFlow("pending-confirmation"),
      });
      recorder = result.recorder;
      pendingObservationIds.push(result.observationId!);
      expect(result.cycleId).toBeNull();
    }

    const confirmedState = state({
      status: "running",
      observedValue: 30,
      estimatedExpiresAt: 36_000,
      lastAlertCycleStartedAt: 6_000,
    });
    const confirmed = record(recorder, {
      sampledAt: 6_000,
      mode: "precision-countdown",
      stateAfter: confirmedState,
      flow: precisionFlow("confirmed"),
    });
    recorder = confirmed.recorder;
    const firstCycle = recorder.archive.cycles.find(
      (entry) => entry.id === confirmed.cycleId,
    )!;
    expect(firstCycle.anchorObservationIds).toEqual([
      ...pendingObservationIds,
      confirmed.observationId,
    ]);

    const refreshedState = state({
      ...confirmedState,
      observedValue: 35,
      estimatedExpiresAt: 42_000,
    });
    const refreshed = record(recorder, {
      sampledAt: 7_000,
      mode: "precision-countdown",
      stateBefore: confirmedState,
      stateAfter: refreshedState,
      flow: precisionFlow("compatible-refresh"),
    });
    recorder = refreshed.recorder;
    expect(refreshed.cycleId).toBe(confirmed.cycleId);
    expect(
      recorder.archive.cycles.find((entry) => entry.id === confirmed.cycleId)
        ?.anchorObservationIds,
    ).toContain(refreshed.observationId);

    const extended = record(recorder, {
      sampledAt: 8_000,
      mode: "precision-countdown",
      stateBefore: state({ ...refreshedState, alertedAt: 7_500 }),
      stateAfter: state({
        ...refreshedState,
        alertedAt: null,
        observedValue: 42,
        estimatedExpiresAt: 50_000,
      }),
      flow: precisionFlow("confirmed-extension"),
    });
    recorder = extended.recorder;

    expect(extended.cycleId).not.toBe(confirmed.cycleId);
    expect(
      recorder.archive.cycles.find((entry) => entry.id === confirmed.cycleId),
    ).toMatchObject({ status: "terminal", terminalReason: "timer-rearmed" });
  });

  it("keeps Yein quarantine in the current cycle and starts a new cycle only after a confirmed increase", () => {
    let recorder = createSkillIncidentRuntimeRecorder({ now: 0 });
    const initial = record(recorder, {
      sampledAt: 1_000,
      mode: "precision-remaining-count",
      stateAfter: state({ status: "running", observedValue: 8 }),
      value: countValue(8),
      flow: remainingCountFlow(8, "initial-confirmed"),
    });
    recorder = initial.recorder;

    const quarantined = record(recorder, {
      sampledAt: 2_000,
      mode: "precision-remaining-count",
      stateBefore: state({ status: "running", observedValue: 8 }),
      stateAfter: state({
        status: "running",
        observedValue: 8,
        pendingReason: "drop-quarantine",
      }),
      value: countValue(3, "implausible", "unreachable-drop"),
      flow: remainingCountFlow(8, "pending-drop"),
    });
    recorder = quarantined.recorder;
    expect(quarantined.cycleId).toBe(initial.cycleId);

    const increased = record(recorder, {
      sampledAt: 3_000,
      mode: "precision-remaining-count",
      stateBefore: state({ status: "running", observedValue: 8 }),
      stateAfter: state({ status: "running", observedValue: 10 }),
      value: countValue(10),
      flow: remainingCountFlow(10, "cycle-reset"),
    });
    recorder = increased.recorder;

    expect(increased.cycleId).not.toBe(initial.cycleId);
    expect(
      recorder.archive.cycles.find((entry) => entry.id === initial.cycleId),
    ).toMatchObject({
      status: "terminal",
      terminalReason: "remaining-count-increase-confirmed",
    });
  });

  it("shares one precision observation and media asset while recording duplicate-target arbitration", () => {
    let recorder = createSkillIncidentRuntimeRecorder({ now: 0 });
    const common = {
      sampledAt: 1_000,
      mode: "precision-countdown" as const,
      targetId: "precision:janus",
      stateAfter: state({
        status: "running",
        observedValue: 30,
        estimatedExpiresAt: 31_000,
        lastAlertCycleStartedAt: 1_000,
      }),
      media: [
        {
          reason: "alert-decision" as const,
          variant: "precision-source" as const,
          mimeType: "image/jpeg" as const,
          dataUrl: "data:image/jpeg;base64,shared-source",
        },
      ],
      alertDecision: {
        kind: "initial" as const,
        outcome: "requested" as const,
        dueAt: 1_000,
        dueMonotonicAt: 1_000,
        reason: null,
      },
    };
    const first = record(recorder, { ...common, skillId: "skill-a" });
    recorder = first.recorder;
    const second = record(recorder, { ...common, skillId: "skill-b" });
    recorder = second.recorder;

    expect(second.sourceFrameId).toBe(first.sourceFrameId);
    expect(second.observationId).toBe(first.observationId);
    expect(recorder.archive.observations).toHaveLength(1);
    expect(recorder.archive.observations[0].skillIds).toEqual([
      "skill-a",
      "skill-b",
    ]);
    expect(recorder.archive.media).toHaveLength(1);
    expect(recorder.archive.media[0].frameId).toBe(first.frameId);
    expect(recorder.archive.media[0].skillIds).toEqual([
      "skill-a",
      "skill-b",
    ]);

    recorder = recordSkillIncidentTargetArbitration({
      previous: recorder,
      sourceFrameId: first.sourceFrameId!,
      targetId: "precision:janus",
      occurredAt: 1_000,
      monotonicAt: 1_000,
      dueSkillIds: ["skill-a", "skill-b"],
      winnerSkillId: "skill-a",
      decisionIds: [first.decisionId!, second.decisionId!],
    });
    expect(
      recorder.archive.decisions.find((entry) => entry.id === first.decisionId),
    ).toMatchObject({ outcome: "requested" });
    expect(
      recorder.archive.decisions.find((entry) => entry.id === second.decisionId),
    ).toMatchObject({
      outcome: "suppressed-duplicate-target",
      reason: "shared-target-playback-won-by-another-skill-row",
    });
  });

  it("records requested, browser-started, finished, and failed playback on the matching cycle", () => {
    const sampled = record(createSkillIncidentRuntimeRecorder({ now: 0 }), {
      sampledAt: 1_000,
      stateAfter: state({
        status: "alerted",
        observedValue: 10,
        estimatedExpiresAt: 11_000,
        alertedAt: 1_000,
        lastAlertCycleStartedAt: 1_000,
      }),
      alertDecision: {
        kind: "initial",
        outcome: "requested",
        dueAt: 1_000,
        dueMonotonicAt: 1_000,
        reason: null,
      },
    });
    let recorder = sampled.recorder;
    const requested = recordSkillIncidentPlaybackRequested({
      previous: recorder,
      decisionId: sampled.decisionId!,
      requestedAt: 1_010,
      requestedMonotonicAt: 1_010,
      soundId: "adam-recall",
      featureVolume: 0.8,
      masterVolume: 0.5,
      effectiveVolume: 0.4,
      visibilityState: "visible",
    });
    recorder = requested.recorder;
    expect(recorder.archive.attempts[0]).toMatchObject({
      status: "requested",
      startedAt: null,
      startedMeaning: null,
    });

    recorder = recordSkillIncidentPlaybackStarted({
      previous: recorder,
      attemptId: requested.attemptId,
      startedAt: 1_020,
      startedMonotonicAt: 1_020,
    });
    recorder = recordSkillIncidentPlaybackFinished({
      previous: recorder,
      attemptId: requested.attemptId,
      finishedAt: 2_000,
      finishedMonotonicAt: 2_000,
    });

    const firstDecision = recorder.archive.decisions.find(
      (entry) => entry.id === sampled.decisionId,
    )!;
    const repeat = recordSkillIncidentAlertDecision({
      previous: recorder,
      skillId: "skill-a",
      cycleId: sampled.cycleId!,
      frameId: sampled.frameId,
      observationId: sampled.observationId,
      occurredAt: 7_000,
      monotonicAt: 7_000,
      configRevisionId: firstDecision.configRevisionId,
      kind: "repeat",
      outcome: "requested",
      dueAt: 7_000,
      dueMonotonicAt: 7_000,
      reason: "repeat-due-after-finish",
    });
    recorder = repeat.recorder;
    const repeatRequest = recordSkillIncidentPlaybackRequested({
      previous: recorder,
      decisionId: repeat.decisionId,
      requestedAt: 7_010,
      requestedMonotonicAt: 7_010,
      soundId: "adam-recall",
      featureVolume: 0.8,
      masterVolume: 0.5,
      effectiveVolume: 0.4,
      visibilityState: "visible",
    });
    recorder = recordSkillIncidentPlaybackFailed({
      previous: repeatRequest.recorder,
      attemptId: repeatRequest.attemptId,
      failedAt: 7_020,
      failedMonotonicAt: 7_020,
      error: "NotAllowedError",
    });

    const initialAttempt = recorder.archive.attempts.find(
      (entry) => entry.id === requested.attemptId,
    )!;
    const repeatAttempt = recorder.archive.attempts.find(
      (entry) => entry.id === repeatRequest.attemptId,
    )!;
    expect(initialAttempt).toMatchObject({
      status: "finished",
      startedMeaning: "browser-play-accepted",
      finishedAt: 2_000,
    });
    expect(repeatAttempt).toMatchObject({
      status: "failed",
      error: "NotAllowedError",
    });
    expect(
      recorder.archive.decisions.find((entry) => entry.id === repeat.decisionId)!
        .dueMonotonicAt! - initialAttempt.finishedMonotonicAt!,
    ).toBe(5_000);
  });

  it("separates configuration revision, timer invalidation, reset epoch, and capture reset", () => {
    let recorder = createSkillIncidentRuntimeRecorder({ now: 0 });
    const runtimeState = state({
      status: "running",
      observedValue: 30,
      estimatedExpiresAt: 31_000,
      lastAlertCycleStartedAt: 1_000,
    });
    const first = record(recorder, {
      sampledAt: 1_000,
      stateAfter: runtimeState,
    });
    recorder = first.recorder;

    const presentationOnly = record(recorder, {
      sampledAt: 2_000,
      stateBefore: runtimeState,
      stateAfter: runtimeState,
      configuration: defaultConfiguration({ soundId: "second-sound" }),
    });
    recorder = presentationOnly.recorder;
    expect(presentationOnly.cycleId).toBe(first.cycleId);
    expect(recorder.archive.configurationRevisions).toHaveLength(2);

    const invalidated = record(recorder, {
      sampledAt: 3_000,
      stateBefore: runtimeState,
      stateAfter: runtimeState,
      cycleConfigurationKey: "threshold:3",
      configuration: defaultConfiguration({ alertThresholdSeconds: 3 }),
    });
    recorder = invalidated.recorder;
    expect(invalidated.cycleId).not.toBe(first.cycleId);
    expect(
      recorder.archive.cycles.find((entry) => entry.id === first.cycleId),
    ).toMatchObject({
      status: "terminal",
      terminalReason: "configuration-invalidated",
    });

    const nextEpoch = record(recorder, {
      sampledAt: 4_000,
      stateBefore: state(),
      stateAfter: state({
        ...runtimeState,
        lastAlertCycleStartedAt: 4_000,
        estimatedExpiresAt: 34_000,
      }),
      epochIdentityKey: "capture:2|quickslot|skill-a",
      cycleConfigurationKey: "threshold:3",
      configuration: defaultConfiguration({ alertThresholdSeconds: 3 }),
    });
    recorder = nextEpoch.recorder;
    expect(recorder.archive.epochs).toHaveLength(2);
    expect(recorder.archive.epochs[0].closedAt).toBe(4_000);

    recorder = resetSkillIncidentRuntimeRecorder({
      previous: recorder,
      now: 5_000,
      reason: "screen-share-ended",
      captureChanged: true,
    });
    expect(recorder.captureGeneration).toBe(2);
    expect(recorder.bindingsBySkill).toEqual({});
    expect(recorder.archive.epochs).toHaveLength(2);
    expect(recorder.archive.currentEpochIds).toEqual({});
  });

  it("closes removed rows and captures precision media only at the bounded cadence", () => {
    let recorder = createSkillIncidentRuntimeRecorder({ now: 0 });
    expect(
      shouldCaptureSkillIncidentPrecisionMedia({ recorder, sampledAt: 1_000 }),
    ).toBe(true);
    const sampled = record(recorder, {
      sampledAt: 1_000,
      mode: "precision-countdown",
      stateAfter: state({
        status: "running",
        observedValue: 30,
        estimatedExpiresAt: 31_000,
        lastAlertCycleStartedAt: 1_000,
      }),
      media: [
        {
          reason: "periodic",
          variant: "precision-source",
          mimeType: "image/jpeg",
          dataUrl: "data:image/jpeg;base64,periodic",
        },
      ],
    });
    recorder = sampled.recorder;

    expect(
      shouldCaptureSkillIncidentPrecisionMedia({ recorder, sampledAt: 15_999 }),
    ).toBe(false);
    expect(
      shouldCaptureSkillIncidentPrecisionMedia({ recorder, sampledAt: 16_000 }),
    ).toBe(true);

    recorder = syncSkillIncidentRuntimeSkills({
      previous: recorder,
      activeSkillIds: [],
      now: 2_000,
    });
    expect(recorder.bindingsBySkill).toEqual({});
    expect(recorder.archive.epochs[0]).toMatchObject({ closedAt: 2_000 });
    expect(recorder.archive.cycles[0]).toMatchObject({
      status: "terminal",
      terminalReason: "skill-removed-or-disabled",
    });
  });

  it("tracks the quick-slot periodic media cadence independently for each row", () => {
    let recorder = createSkillIncidentRuntimeRecorder({ now: 0 });
    expect(
      shouldCaptureSkillIncidentQuickSlotMedia({
        recorder,
        sampledAt: 1_000,
        skillId: "skill-a",
      }),
    ).toBe(true);
    recorder = record(recorder, {
      sampledAt: 1_000,
      stateAfter: state({
        status: "running",
        observedValue: 30,
        estimatedExpiresAt: 31_000,
        lastAlertCycleStartedAt: 1_000,
      }),
      media: [
        {
          reason: "periodic",
          variant: "quickslot-raw",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,quick-a",
        },
      ],
    }).recorder;

    expect(
      shouldCaptureSkillIncidentQuickSlotMedia({
        recorder,
        sampledAt: 15_999,
        skillId: "skill-a",
      }),
    ).toBe(false);
    expect(
      shouldCaptureSkillIncidentQuickSlotMedia({
        recorder,
        sampledAt: 16_000,
        skillId: "skill-a",
      }),
    ).toBe(true);
    expect(
      shouldCaptureSkillIncidentQuickSlotMedia({
        recorder,
        sampledAt: 2_000,
        skillId: "skill-b",
      }),
    ).toBe(true);
  });
});

function record(
  previous: SkillIncidentRuntimeRecorder,
  overrides: Partial<SkillIncidentSampleInput> & { sampledAt: number },
) {
  return recordSkillIncidentSample({
    previous,
    input: sampleInput(overrides),
  });
}

function sampleInput(
  overrides: Partial<SkillIncidentSampleInput> & { sampledAt: number },
): SkillIncidentSampleInput {
  const skillId = overrides.skillId ?? "skill-a";
  const mode = overrides.mode ?? "quickslot-countdown";
  const targetId = overrides.targetId ?? targetFor(mode, skillId);
  const provider =
    overrides.provider ?? (mode === "quickslot-countdown" ? "wasm" : "webgpu");
  const stateAfter = overrides.stateAfter ?? state();
  return {
    sampledAt: overrides.sampledAt,
    monotonicAt: overrides.monotonicAt ?? overrides.sampledAt,
    skillId,
    enabled: overrides.enabled ?? true,
    mode,
    targetId,
    epochIdentityKey:
      overrides.epochIdentityKey ?? `capture:1|${mode}|${targetId}|${provider}`,
    cycleConfigurationKey:
      overrides.cycleConfigurationKey ?? "threshold:10|repeat:5:2",
    epochReason: overrides.epochReason ?? "enabled",
    provider,
    recognizerVersion: overrides.recognizerVersion ?? "fixture-v1",
    source: overrides.source ?? "runtime",
    stateBefore: overrides.stateBefore ?? state(),
    stateAfter,
    recognitionDecision: overrides.recognitionDecision ?? "accepted",
    parser:
      overrides.parser === undefined
        ? mode === "quickslot-countdown"
          ? null
          : {
              boxCount: 1,
              rowCount: 1,
              eligibleBoxCount: 1,
              candidateCount: 1,
              decisionReason: "candidate-found",
            }
        : overrides.parser,
    matcher:
      overrides.matcher === undefined
        ? mode === "quickslot-countdown"
          ? null
          : {
              accepted: true,
              candidateCount: 1,
              decisionReason: "accepted",
              bundleId: targetId,
              modelVersion: "fixture-v1",
              score: 0.99,
              threshold: 0.8,
              margin: 0.19,
              gateMargin: null,
            }
        : overrides.matcher,
    value:
      overrides.value ??
      (mode === "precision-remaining-count"
        ? countValue(stateAfter.observedValue ?? 8)
        : countdownValue(stateAfter.observedValue ?? 30)),
    flow:
      overrides.flow ??
      (mode === "precision-remaining-count"
        ? remainingCountFlow(stateAfter.observedValue ?? 8, "compatible")
        : precisionFlow("compatible")),
    runtimeFailure: overrides.runtimeFailure ?? null,
    configuration:
      overrides.configuration ?? defaultConfiguration({ mode, targetId }),
    frameReasons: overrides.frameReasons ?? ["value-change"],
    media: overrides.media,
    alertDecision: overrides.alertDecision ?? null,
  };
}

function state(
  overrides: Partial<SkillIncidentRuntimeState> = {},
): SkillIncidentRuntimeState {
  return {
    status: "idle",
    observedValue: null,
    estimatedExpiresAt: null,
    alertedAt: null,
    lastRepeatedAlertAt: null,
    repeatedAlertCount: 0,
    lastAlertCycleStartedAt: null,
    initialAlertDelaySeconds: null,
    initialAlertDelayCycleStartedAt: null,
    rejectedValue: null,
    pendingReason: null,
    ...overrides,
  };
}

function targetFor(mode: SkillIncidentMode, skillId: string): string {
  if (mode === "quickslot-countdown") {
    return `quickslot:${skillId}`;
  }
  return mode === "precision-remaining-count"
    ? "precision:yein"
    : "precision:janus";
}

function defaultConfiguration(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    alertThresholdSeconds: 10,
    repeatAlertEnabled: true,
    repeatAlertIntervalSeconds: 5,
    repeatAlertMaxCount: 2,
    soundId: "default",
    volume: 0.8,
    ...overrides,
  };
}

function countdownValue(value: number) {
  return {
    kind: "countdown" as const,
    rawValue: value,
    text: String(value),
    confidence: 0.99,
    decision: "accepted" as const,
    reason: null,
  };
}

function countValue(
  value: number,
  decision: "accepted" | "missing" | "rejected" | "implausible" = "accepted",
  reason: string | null = null,
) {
  return {
    kind: "remaining-count" as const,
    rawValue: value,
    text: String(value),
    confidence: 0.99,
    decision,
    reason,
  };
}

function precisionFlow(reason: string) {
  return {
    confirmedValue: 30,
    expectedMin: 29,
    expectedMax: 31,
    decisionReason: reason,
    pendingDropObservations: 0,
    pendingAlertObservations: 0,
  };
}

function remainingCountFlow(value: number, reason: string) {
  return {
    confirmedValue: value,
    expectedMin: Math.max(0, value - 1),
    expectedMax: value + 1,
    decisionReason: reason,
    pendingDropObservations: reason === "pending-drop" ? 1 : 0,
    pendingAlertObservations: 0,
  };
}
