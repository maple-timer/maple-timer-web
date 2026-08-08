import { describe, expect, it } from "vitest";
import {
  collectBoosterExpiryIncidentCycleObservation,
  completeBoosterExpiryIncidentSchedule,
  createBoosterExpiryIncidentBoundary,
  freezeBoosterExpiryIncidentBoundary,
  getBoosterExpiryIncidentContinuityResetReason,
  isBoosterExpiryIncidentFrameWithinLease,
  isBoosterExpiryIncidentObservationWithinLease,
  recordBoosterExpiryIncidentCycleSupport,
  recordBoosterExpiryIncidentFrame,
  recordBoosterExpiryIncidentObservation,
  registerBoosterExpiryIncidentSchedule,
  requestBoosterExpiryIncidentPlayback,
  resetBoosterExpiryIncidentBoundary,
  restartBoosterExpiryIncidentFlow,
  reviseBoosterExpiryIncidentConfiguration,
  transitionBoosterExpiryIncidentPlayback,
} from "./boosterExpiryIncidentBoundary";
import {
  BOOSTER_EXPIRY_INCIDENT_BOUNDARY_SCHEMA_VERSION,
  type BoosterExpiryIncidentBoundaryResult,
  type BoosterExpiryIncidentBoundaryState,
  type BoosterExpiryIncidentConfiguration,
  type BoosterExpiryIncidentConfirmedCycle,
  type BoosterExpiryIncidentContinuity,
  type BoosterExpiryIncidentFrame,
  type BoosterExpiryIncidentObservation,
  type BoosterExpiryIncidentObservationDecision,
} from "./boosterExpiryIncidentEvidenceTypes";

const T0 = 1_000_000;

const CONTINUITY: BoosterExpiryIncidentContinuity = {
  captureGeneration: 1,
  featureGeneration: 1,
  monitoringGeneration: 1,
  layoutKey: "layout-a",
  sourceGeometryRevision: "1920x1080",
};

const CONFIG: BoosterExpiryIncidentConfiguration = {
  enabled: true,
  alertLeadSeconds: 10,
  soundId: "alert-a",
  featureVolume: 0.8,
  masterVolume: 0.5,
  effectiveVolume: 0.4,
};

describe("boosterExpiryIncidentBoundary", () => {
  it("creates immutable reset, configuration, and Worker-flow identities", () => {
    const state = createState();

    expect(state.schemaVersion).toBe(
      BOOSTER_EXPIRY_INCIDENT_BOUNDARY_SCHEMA_VERSION,
    );
    expect(state.resetEpoch.id).toBe("booster-expiry-reset:session-a:1");
    expect(state.configurationRevision.id).toContain(state.resetEpoch.id);
    expect(state.flowEpoch.id).toContain(state.resetEpoch.id);
    expect(state.flowEpoch.workerGeneration).toBe(1);
  });

  it("requires a reset when enabled continuity changes", () => {
    const state = createState();
    const result = reviseBoosterExpiryIncidentConfiguration({
      previous: state,
      configuration: { ...CONFIG, enabled: false },
      now: T0 + 1,
    });

    expect(result).toMatchObject({
      accepted: false,
      reason: "continuity-reset-required",
    });
  });

  it("distinguishes timing edits from playback-only edits", () => {
    const state = createState();
    const soundEdit = accepted(
      reviseBoosterExpiryIncidentConfiguration({
        previous: state,
        configuration: { ...CONFIG, soundId: "alert-b" },
        now: T0 + 1,
      }),
    );
    const timingEdit = accepted(
      reviseBoosterExpiryIncidentConfiguration({
        previous: soundEdit.state,
        configuration: {
          ...CONFIG,
          soundId: "alert-b",
          alertLeadSeconds: -5,
        },
        now: T0 + 2,
      }),
    );

    expect(soundEdit.value).toMatchObject({
      changed: true,
      timingChanged: false,
      playbackChanged: true,
    });
    expect(timingEdit.value).toMatchObject({
      changed: true,
      timingChanged: true,
      playbackChanged: false,
    });
  });

  it("maps each continuity change to one explicit reset reason", () => {
    expect(
      getBoosterExpiryIncidentContinuityResetReason(CONTINUITY, {
        ...CONTINUITY,
        captureGeneration: 2,
      }),
    ).toBe("stream-replaced");
    expect(
      getBoosterExpiryIncidentContinuityResetReason(CONTINUITY, {
        ...CONTINUITY,
        layoutKey: "layout-b",
      }),
    ).toBe("layout-changed");
    expect(
      getBoosterExpiryIncidentContinuityResetReason(CONTINUITY, {
        ...CONTINUITY,
        sourceGeometryRevision: "2560x1440",
      }),
    ).toBe("source-geometry-changed");
    expect(
      getBoosterExpiryIncidentContinuityResetReason(CONTINUITY, {
        ...CONTINUITY,
        monitoringGeneration: 2,
      }),
    ).toBe("monitoring-generation-changed");
    expect(
      getBoosterExpiryIncidentContinuityResetReason(CONTINUITY, {
        ...CONTINUITY,
        featureGeneration: 2,
      }),
    ).toBe("profile-replaced");
    expect(
      getBoosterExpiryIncidentContinuityResetReason(CONTINUITY, CONTINUITY),
    ).toBeNull();
  });

  it("rejects frames while the feature is disabled", () => {
    const state = createState({ enabled: false });
    expect(
      recordBoosterExpiryIncidentFrame({ previous: state, sampledAt: T0 + 1 }),
    ).toMatchObject({ accepted: false, reason: "feature-disabled" });
  });

  it("rejects duplicate or out-of-order normal samples", () => {
    const first = accepted(
      recordBoosterExpiryIncidentFrame({
        previous: createState(),
        sampledAt: T0 + 1_000,
      }),
    );

    expect(
      recordBoosterExpiryIncidentFrame({
        previous: first.state,
        sampledAt: T0 + 1_000,
      }),
    ).toMatchObject({ accepted: false, reason: "non-monotonic-frame" });
    expect(
      recordBoosterExpiryIncidentFrame({
        previous: first.state,
        sampledAt: T0 + 999,
      }),
    ).toMatchObject({ accepted: false, reason: "non-monotonic-frame" });
  });

  it("separates Worker-flow restart from a confirmed feature cycle", () => {
    const confirmed = confirmCycle(createState(), T0 + 1_000, 120);
    const restarted = accepted(
      restartBoosterExpiryIncidentFlow({
        previous: confirmed.state,
        workerGeneration: 2,
        now: T0 + 7_000,
        reason: "worker-timeout",
      }),
    );

    expect(restarted.value.flowEpoch.id).not.toBe(
      confirmed.state.flowEpoch.id,
    );
    expect(restarted.state.activeCycle?.id).toBe(confirmed.cycle.id);
    expect(restarted.state.activeCandidateAttempt).toBeNull();
  });

  it("rejects an observation from the Worker flow before restart", () => {
    const sample = recordRawObservation(createState(), T0 + 1_000, 120);
    const restarted = accepted(
      restartBoosterExpiryIncidentFlow({
        previous: sample.state,
        workerGeneration: 2,
        now: T0 + 1_500,
        reason: "worker-reset",
      }),
    );

    expect(
      collectBoosterExpiryIncidentCycleObservation({
        previous: restarted.state,
        frame: sample.frame,
        observation: sample.observation,
      }),
    ).toMatchObject({ accepted: false, reason: "stale-flow-epoch" });
  });

  it("accepts only strong raw-flow observations into confirmation", () => {
    const predicted = recordRawObservation(
      createState(),
      T0 + 1_000,
      120,
      "predicted",
    );
    const rejected = recordRawObservation(
      createState(),
      T0 + 1_000,
      120,
      "raw",
      "rejected",
    );

    expect(
      collectBoosterExpiryIncidentCycleObservation({
        previous: predicted.state,
        frame: predicted.frame,
        observation: predicted.observation,
      }),
    ).toMatchObject({ accepted: false, reason: "observation-not-strong" });
    expect(
      collectBoosterExpiryIncidentCycleObservation({
        previous: rejected.state,
        frame: rejected.frame,
        observation: rejected.observation,
      }),
    ).toMatchObject({ accepted: false, reason: "observation-not-accepted" });
  });

  it("rejects strong observations below the 60-second cycle floor", () => {
    const sample = recordRawObservation(createState(), T0 + 1_000, 59);
    expect(
      collectBoosterExpiryIncidentCycleObservation({
        previous: sample.state,
        frame: sample.frame,
        observation: sample.observation,
      }),
    ).toMatchObject({
      accepted: false,
      reason: "remaining-below-confirmation-floor",
    });
  });

  it("confirms exactly six observations over five seconds with four seconds of decrease", () => {
    const confirmed = confirmCycle(createState(), T0 + 1_000, 120, [0, 1, 2, 3, 4, 4]);

    expect(confirmed.attempt.observationIds).toHaveLength(6);
    expect(confirmed.attempt.lastObservedAt - confirmed.attempt.startedAt).toBe(
      5_000,
    );
    expect(
      confirmed.attempt.firstRemainingSeconds -
        confirmed.attempt.lastRemainingSeconds,
    ).toBe(4);
    expect(confirmed.cycle.status).toBe("active");
  });

  it("does not confirm when the observation span is shorter than five seconds", () => {
    let state = createState();
    let lastCycle: BoosterExpiryIncidentConfirmedCycle | null = null;
    for (let index = 0; index < 6; index += 1) {
      const sampled = recordRawObservation(
        state,
        T0 + 1_000 + index * 900,
        120 - index * 0.9,
      );
      const collected = accepted(
        collectBoosterExpiryIncidentCycleObservation({
          previous: sampled.state,
          frame: sampled.frame,
          observation: sampled.observation,
        }),
      );
      state = collected.state;
      lastCycle = collected.value.cycle;
    }

    expect(lastCycle).toBeNull();
    expect(state.activeCandidateAttempt?.observationIds).toHaveLength(6);
  });

  it("does not confirm when the timer decreases less than four seconds", () => {
    let state = createState();
    for (let index = 0; index < 6; index += 1) {
      const sampled = recordRawObservation(
        state,
        T0 + 1_000 + index * 1_000,
        120 - index * 0.5,
      );
      state = accepted(
        collectBoosterExpiryIncidentCycleObservation({
          previous: sampled.state,
          frame: sampled.frame,
          observation: sampled.observation,
        }),
      ).state;
    }

    expect(state.activeCycle).toBeNull();
    expect(state.activeCandidateAttempt?.observationIds).toHaveLength(6);
  });

  it("keeps a candidate at the exact 12-second gap and expires it at 12,001 ms", () => {
    const first = collectOne(createState(), T0 + 1_000, 100);
    const inclusiveSample = recordRawObservation(
      first.state,
      T0 + 13_000,
      88,
    );
    const inclusive = accepted(
      collectBoosterExpiryIncidentCycleObservation({
        previous: inclusiveSample.state,
        frame: inclusiveSample.frame,
        observation: inclusiveSample.observation,
      }),
    );

    const separateFirst = collectOne(createState(), T0 + 1_000, 100);
    const expiredSample = recordRawObservation(
      separateFirst.state,
      T0 + 13_001,
      87.999,
    );
    const expired = accepted(
      collectBoosterExpiryIncidentCycleObservation({
        previous: expiredSample.state,
        frame: expiredSample.frame,
        observation: expiredSample.observation,
      }),
    );

    expect(inclusive.value.attempt.id).toBe(first.attempt.id);
    expect(expired.value.attempt.id).not.toBe(separateFirst.attempt.id);
    expect(expired.value.expiredAttempt).toMatchObject({
      id: separateFirst.attempt.id,
      status: "expired",
      terminalReason: "window-expired",
    });
  });

  it("keeps the 2.5-second expiry tolerance inclusive", () => {
    const first = collectOne(createState(), T0 + 1_000, 100);
    const within = recordRawObservation(
      first.state,
      T0 + 2_000,
      101.5,
    );
    const withinResult = accepted(
      collectBoosterExpiryIncidentCycleObservation({
        previous: within.state,
        frame: within.frame,
        observation: within.observation,
      }),
    );

    const separate = collectOne(createState(), T0 + 1_000, 100);
    const outside = recordRawObservation(
      separate.state,
      T0 + 2_000,
      101.501,
    );
    const outsideResult = accepted(
      collectBoosterExpiryIncidentCycleObservation({
        previous: outside.state,
        frame: outside.frame,
        observation: outside.observation,
      }),
    );

    expect(withinResult.value.attempt.id).toBe(first.attempt.id);
    expect(outsideResult.value.attempt.id).not.toBe(separate.attempt.id);
    expect(outsideResult.value.expiredAttempt?.terminalReason).toBe(
      "incompatible-expiry",
    );
  });

  it("rejects a confirmed candidate that does not extend the active expiry by five seconds", () => {
    const first = confirmCycle(createState(), T0 + 1_000, 120);
    const second = runCandidateSeries(first.state, T0 + 10_000, 100);

    expect(second.cycle).toBeNull();
    expect(second.attempt).toMatchObject({
      status: "rejected",
      terminalReason: "not-new-cycle",
    });
    expect(second.state.activeCycle?.id).toBe(first.cycle.id);
  });

  it("creates a distinct adjacent cycle and closes the previous chain", () => {
    const first = confirmCycle(createState(), T0 + 1_000, 120);
    const second = confirmCycle(first.state, T0 + 10_000, 120);

    expect(second.cycle.id).not.toBe(first.cycle.id);
    expect(second.value.closed?.cycle).toMatchObject({
      id: first.cycle.id,
      status: "replaced",
      terminalReason: "next-cycle",
    });
  });

  it("keeps a confirmed cycle across a supported observation", () => {
    const confirmed = confirmCycle(createState(), T0 + 1_000, 120);
    const support = recordRawObservation(
      confirmed.state,
      T0 + 7_000,
      114,
    );
    const result = accepted(
      recordBoosterExpiryIncidentCycleSupport({
        previous: support.state,
        cycleId: confirmed.cycle.id,
        observation: support.observation,
      }),
    );

    expect(result.value.support).toBe("supported");
    expect(result.value.cycle.contradictionCount).toBe(0);
    expect(result.state.activeCycle?.id).toBe(confirmed.cycle.id);
  });

  it("cancels after two strong contradictory observations", () => {
    const confirmed = confirmCycle(createState(), T0 + 1_000, 120);
    const first = recordRawObservation(
      confirmed.state,
      T0 + 7_000,
      140,
    );
    const firstResult = accepted(
      recordBoosterExpiryIncidentCycleSupport({
        previous: first.state,
        cycleId: confirmed.cycle.id,
        observation: first.observation,
      }),
    );
    const second = recordRawObservation(
      firstResult.state,
      T0 + 8_000,
      139,
    );
    const secondResult = accepted(
      recordBoosterExpiryIncidentCycleSupport({
        previous: second.state,
        cycleId: confirmed.cycle.id,
        observation: second.observation,
      }),
    );

    expect(firstResult.value.support).toBe("contradicted");
    expect(secondResult.value).toMatchObject({
      support: "cancelled",
      cycle: { status: "cancelled", terminalReason: "contradicted" },
    });
    expect(secondResult.state.activeCycle).toBeNull();
  });

  it("keeps exactly 20 seconds without support and cancels at 20,001 ms", () => {
    const confirmed = confirmCycle(createState(), T0 + 1_000, 120);
    const exactSample = recordMissingObservation(
      confirmed.state,
      confirmed.cycle.lastSupportedAt + 20_000,
    );
    const exact = accepted(
      recordBoosterExpiryIncidentCycleSupport({
        previous: exactSample.state,
        cycleId: confirmed.cycle.id,
        observation: exactSample.observation,
      }),
    );
    const outsideSample = recordMissingObservation(
      exact.state,
      confirmed.cycle.lastSupportedAt + 20_001,
    );
    const outside = accepted(
      recordBoosterExpiryIncidentCycleSupport({
        previous: outsideSample.state,
        cycleId: confirmed.cycle.id,
        observation: outsideSample.observation,
      }),
    );

    expect(exact.value.support).toBe("none");
    expect(exact.state.activeCycle?.id).toBe(confirmed.cycle.id);
    expect(outside.value.support).toBe("cancelled");
    expect(outside.value.cycle.terminalReason).toBe("unsupported-too-long");
  });

  it("registers positive and negative lead schedules from the confirmed expiry", () => {
    const positive = confirmCycle(createState(), T0 + 1_000, 120);
    const positiveSchedule = accepted(
      registerBoosterExpiryIncidentSchedule({
        previous: positive.state,
        cycle: positive.cycle,
        registeredAt: T0 + 7_000,
        reason: "cycle-confirmed",
      }),
    );
    const negative = confirmCycle(
      createState({ alertLeadSeconds: -5 }),
      T0 + 1_000,
      120,
    );
    const negativeSchedule = accepted(
      registerBoosterExpiryIncidentSchedule({
        previous: negative.state,
        cycle: negative.cycle,
        registeredAt: T0 + 7_000,
        reason: "cycle-confirmed",
      }),
    );

    expect(positiveSchedule.value.schedule.alertDueAt).toBe(
      positive.cycle.expiresAt - 10_000,
    );
    expect(negativeSchedule.value.schedule.alertDueAt).toBe(
      negative.cycle.expiresAt + 5_000,
    );
  });

  it("does not replace an unchanged schedule for a sound-only edit", () => {
    const confirmed = confirmCycle(createState(), T0 + 1_000, 120);
    const scheduled = scheduleCycle(confirmed.state, confirmed.cycle);
    const edited = accepted(
      reviseBoosterExpiryIncidentConfiguration({
        previous: scheduled.state,
        configuration: { ...CONFIG, soundId: "alert-b" },
        now: T0 + 8_000,
      }),
    );

    expect(
      registerBoosterExpiryIncidentSchedule({
        previous: edited.state,
        cycle: edited.state.activeCycle!,
        registeredAt: T0 + 8_001,
        reason: "configuration-retimed",
      }),
    ).toMatchObject({
      accepted: false,
      reason: "schedule-already-registered",
    });
  });

  it("rejects an old timeout after a timing edit and schedule replacement", () => {
    const confirmed = confirmCycle(createState(), T0 + 1_000, 120);
    const firstSchedule = scheduleCycle(confirmed.state, confirmed.cycle);
    const edited = accepted(
      reviseBoosterExpiryIncidentConfiguration({
        previous: firstSchedule.state,
        configuration: { ...CONFIG, alertLeadSeconds: 20 },
        now: T0 + 8_000,
      }),
    );

    expect(
      completeBoosterExpiryIncidentSchedule({
        previous: edited.state,
        scheduleId: firstSchedule.schedule.id,
        outcome: "fired",
        occurredAt: firstSchedule.schedule.alertDueAt,
      }),
    ).toMatchObject({ accepted: false, reason: "schedule-timing-revised" });

    const replacement = accepted(
      registerBoosterExpiryIncidentSchedule({
        previous: edited.state,
        cycle: edited.state.activeCycle!,
        registeredAt: T0 + 8_001,
        reason: "configuration-retimed",
      }),
    );
    expect(replacement.value.replacedSchedule?.id).toBe(
      firstSchedule.schedule.id,
    );
    expect(
      completeBoosterExpiryIncidentSchedule({
        previous: replacement.state,
        scheduleId: firstSchedule.schedule.id,
        outcome: "fired",
        occurredAt: firstSchedule.schedule.alertDueAt,
      }),
    ).toMatchObject({ accepted: false, reason: "stale-schedule" });
  });

  it("rejects early timeout firing and accepts the exact due boundary", () => {
    const confirmed = confirmCycle(createState(), T0 + 1_000, 120);
    const scheduled = scheduleCycle(confirmed.state, confirmed.cycle);

    expect(
      completeBoosterExpiryIncidentSchedule({
        previous: scheduled.state,
        scheduleId: scheduled.schedule.id,
        outcome: "fired",
        occurredAt: scheduled.schedule.alertDueAt - 1,
      }),
    ).toMatchObject({ accepted: false, reason: "schedule-not-due" });

    const fired = accepted(
      completeBoosterExpiryIncidentSchedule({
        previous: scheduled.state,
        scheduleId: scheduled.schedule.id,
        outcome: "fired",
        occurredAt: scheduled.schedule.alertDueAt,
      }),
    );
    expect(fired.value.decision).toMatchObject({ schedulerDelayMs: 0 });
  });

  it("snapshots playback settings at request and requires browser acceptance before finish", () => {
    const fired = fireCycle(createState(), T0 + 1_000, 120);
    const edited = accepted(
      reviseBoosterExpiryIncidentConfiguration({
        previous: fired.state,
        configuration: {
          ...CONFIG,
          soundId: "alert-b",
          featureVolume: 0.6,
          effectiveVolume: 0.3,
        },
        now: fired.decision.occurredAt + 1,
      }),
    );
    const requested = accepted(
      requestBoosterExpiryIncidentPlayback({
        previous: edited.state,
        decision: fired.decision,
        requestedAt: fired.decision.occurredAt + 2,
      }),
    );

    expect(requested.value).toMatchObject({
      status: "requested",
      soundId: "alert-b",
      featureVolume: 0.6,
      effectiveVolume: 0.3,
    });
    expect(
      transitionBoosterExpiryIncidentPlayback({
        previous: requested.state,
        attemptId: requested.value.id,
        status: "finished",
        occurredAt: fired.decision.occurredAt + 3,
      }),
    ).toMatchObject({
      accepted: false,
      reason: "invalid-playback-transition",
    });

    const started = accepted(
      transitionBoosterExpiryIncidentPlayback({
        previous: requested.state,
        attemptId: requested.value.id,
        status: "browser-play-accepted",
        occurredAt: fired.decision.occurredAt + 3,
      }),
    );
    const finished = accepted(
      transitionBoosterExpiryIncidentPlayback({
        previous: started.state,
        attemptId: started.value.id,
        status: "finished",
        occurredAt: fired.decision.occurredAt + 4,
      }),
    );
    expect(finished.value.status).toBe("finished");
  });

  it("allows playback failure before or after browser acceptance", () => {
    const firstFired = fireCycle(createState(), T0 + 1_000, 120);
    const requested = accepted(
      requestBoosterExpiryIncidentPlayback({
        previous: firstFired.state,
        decision: firstFired.decision,
        requestedAt: firstFired.decision.occurredAt + 1,
      }),
    );
    const failed = accepted(
      transitionBoosterExpiryIncidentPlayback({
        previous: requested.state,
        attemptId: requested.value.id,
        status: "failed",
        occurredAt: firstFired.decision.occurredAt + 2,
        error: "audio-play-rejected",
      }),
    );
    expect(failed.value).toMatchObject({
      status: "failed",
      error: "audio-play-rejected",
    });

    const secondFired = fireCycle(createState(), T0 + 1_000, 120);
    const secondRequest = accepted(
      requestBoosterExpiryIncidentPlayback({
        previous: secondFired.state,
        decision: secondFired.decision,
        requestedAt: secondFired.decision.occurredAt + 1,
      }),
    );
    const acceptedPlayback = accepted(
      transitionBoosterExpiryIncidentPlayback({
        previous: secondRequest.state,
        attemptId: secondRequest.value.id,
        status: "browser-play-accepted",
        occurredAt: secondFired.decision.occurredAt + 2,
      }),
    );
    const laterFailure = accepted(
      transitionBoosterExpiryIncidentPlayback({
        previous: acceptedPlayback.state,
        attemptId: acceptedPlayback.value.id,
        status: "failed",
        occurredAt: secondFired.decision.occurredAt + 3,
        error: "audio-context-closed",
      }),
    );
    expect(laterFailure.value.status).toBe("failed");
  });

  it("prevents duplicate playback for one decision", () => {
    const fired = fireCycle(createState(), T0 + 1_000, 120);
    const requested = accepted(
      requestBoosterExpiryIncidentPlayback({
        previous: fired.state,
        decision: fired.decision,
        requestedAt: fired.decision.occurredAt + 1,
      }),
    );

    expect(
      requestBoosterExpiryIncidentPlayback({
        previous: requested.state,
        decision: fired.decision,
        requestedAt: fired.decision.occurredAt + 2,
      }),
    ).toMatchObject({ accepted: false, reason: "playback-in-flight" });
  });

  it("makes schedule and playback callbacks stale after a full reset", () => {
    const fired = fireCycle(createState(), T0 + 1_000, 120);
    const requested = accepted(
      requestBoosterExpiryIncidentPlayback({
        previous: fired.state,
        decision: fired.decision,
        requestedAt: fired.decision.occurredAt + 1,
      }),
    );
    const reset = accepted(
      resetBoosterExpiryIncidentBoundary({
        previous: requested.state,
        continuity: { ...CONTINUITY, captureGeneration: 2 },
        configuration: CONFIG,
        workerGeneration: 2,
        now: fired.decision.occurredAt + 2,
        reason: "stream-replaced",
      }),
    );

    expect(
      transitionBoosterExpiryIncidentPlayback({
        previous: reset.state,
        attemptId: requested.value.id,
        status: "browser-play-accepted",
        occurredAt: fired.decision.occurredAt + 3,
      }),
    ).toMatchObject({ accepted: false, reason: "stale-playback-attempt" });
    expect(reset.value.closed.playbackAttempt?.id).toBe(requested.value.id);
  });

  it("freezes a report lease before later frames and resets", () => {
    const sample = recordRawObservation(createState(), T0 + 1_000, 120);
    const frozen = freezeBoosterExpiryIncidentBoundary({
      previous: sample.state,
      frozenAt: T0 + 1_000,
    });
    const later = recordRawObservation(frozen.state, T0 + 2_000, 119);

    expect(
      isBoosterExpiryIncidentFrameWithinLease(frozen.lease, sample.frame),
    ).toBe(true);
    expect(
      isBoosterExpiryIncidentObservationWithinLease(
        frozen.lease,
        sample.observation,
      ),
    ).toBe(true);
    expect(
      isBoosterExpiryIncidentFrameWithinLease(frozen.lease, later.frame),
    ).toBe(false);

    const reset = accepted(
      resetBoosterExpiryIncidentBoundary({
        previous: later.state,
        continuity: { ...CONTINUITY, layoutKey: "layout-b" },
        configuration: CONFIG,
        workerGeneration: 2,
        now: T0 + 3_000,
        reason: "layout-changed",
      }),
    );
    const afterReset = recordRawObservation(reset.state, T0 + 4_000, 118);
    expect(
      isBoosterExpiryIncidentFrameWithinLease(frozen.lease, afterReset.frame),
    ).toBe(false);
  });

  it("keeps same-position adjacent timers separate by cycle, schedule, and decision IDs", () => {
    const first = fireCycle(createState(), T0 + 1_000, 120);
    const second = fireCycle(first.state, T0 + 130_000, 120);

    expect(second.cycle.id).not.toBe(first.cycle.id);
    expect(second.schedule.id).not.toBe(first.schedule.id);
    expect(second.decision.id).not.toBe(first.decision.id);
  });
});

function createState(
  overrides: Partial<BoosterExpiryIncidentConfiguration> = {},
): BoosterExpiryIncidentBoundaryState {
  return createBoosterExpiryIncidentBoundary({
    sessionId: "session-a",
    continuity: CONTINUITY,
    configuration: { ...CONFIG, ...overrides },
    workerGeneration: 1,
    now: T0,
  });
}

function accepted<T>(result: BoosterExpiryIncidentBoundaryResult<T>) {
  if (!result.accepted) {
    throw new Error(`expected accepted result, got ${result.reason}`);
  }
  return result;
}

function recordRawObservation(
  previous: BoosterExpiryIncidentBoundaryState,
  sampledAt: number,
  seconds: number,
  flowSource = "raw",
  decision: BoosterExpiryIncidentObservationDecision = "accepted",
): {
  state: BoosterExpiryIncidentBoundaryState;
  frame: BoosterExpiryIncidentFrame;
  observation: BoosterExpiryIncidentObservation;
} {
  const frame = accepted(
    recordBoosterExpiryIncidentFrame({ previous, sampledAt }),
  );
  const read = {
    ok: true,
    reason: "ok",
    text: String(seconds),
    seconds,
    format: "seconds",
    selectedBy: "timer-flow",
    rect: { x: 10, y: 20, width: 30, height: 12 },
    digitCount: String(seconds).replace(".", "").length,
  };
  const observation = accepted(
    recordBoosterExpiryIncidentObservation({
      previous: frame.state,
      frame: frame.value,
      decision,
      recognizerVersion: "timer-catch-flow-v1",
      rawTime: read,
      selectedTime: read,
      timerRect: read.rect,
      timerCandidateCount: 1,
      timerMatchCount: 1,
      flow: {
        locked: flowSource !== "raw",
        source: flowSource,
        predictedSeconds: seconds,
        rawDeltaSeconds: -1,
      },
      recognitionMs: 3,
      totalMs: 4,
    }),
  );
  return {
    state: observation.state,
    frame: frame.value,
    observation: observation.value,
  };
}

function recordMissingObservation(
  previous: BoosterExpiryIncidentBoundaryState,
  sampledAt: number,
) {
  const frame = accepted(
    recordBoosterExpiryIncidentFrame({ previous, sampledAt }),
  );
  const observation = accepted(
    recordBoosterExpiryIncidentObservation({
      previous: frame.state,
      frame: frame.value,
      decision: "missing",
      reason: "timer-not-found",
    }),
  );
  return {
    state: observation.state,
    frame: frame.value,
    observation: observation.value,
  };
}

function collectOne(
  previous: BoosterExpiryIncidentBoundaryState,
  sampledAt: number,
  seconds: number,
) {
  const sample = recordRawObservation(previous, sampledAt, seconds);
  const collected = accepted(
    collectBoosterExpiryIncidentCycleObservation({
      previous: sample.state,
      frame: sample.frame,
      observation: sample.observation,
    }),
  );
  return {
    state: collected.state,
    attempt: collected.value.attempt,
    value: collected.value,
  };
}

function runCandidateSeries(
  previous: BoosterExpiryIncidentBoundaryState,
  startedAt: number,
  firstSeconds: number,
  decreases: number[] = [0, 1, 2, 3, 4, 5],
) {
  let state = previous;
  let last: ReturnType<typeof accepted<{
    attempt: import("./boosterExpiryIncidentEvidenceTypes").BoosterExpiryIncidentCandidateAttempt;
    cycle: BoosterExpiryIncidentConfirmedCycle | null;
    expiredAttempt: import("./boosterExpiryIncidentEvidenceTypes").BoosterExpiryIncidentCandidateAttempt | null;
    closed: import("./boosterExpiryIncidentEvidenceTypes").BoosterExpiryIncidentClosedBoundary | null;
  }>> | null = null;
  for (let index = 0; index < decreases.length; index += 1) {
    const sample = recordRawObservation(
      state,
      startedAt + index * 1_000,
      firstSeconds - decreases[index],
    );
    last = accepted(
      collectBoosterExpiryIncidentCycleObservation({
        previous: sample.state,
        frame: sample.frame,
        observation: sample.observation,
      }),
    );
    state = last.state;
  }
  if (!last) {
    throw new Error("candidate series produced no observations");
  }
  return { state, ...last.value, value: last.value };
}

function confirmCycle(
  previous: BoosterExpiryIncidentBoundaryState,
  startedAt: number,
  firstSeconds: number,
  decreases: number[] = [0, 1, 2, 3, 4, 5],
) {
  const series = runCandidateSeries(
    previous,
    startedAt,
    firstSeconds,
    decreases,
  );
  if (!series.cycle) {
    throw new Error("expected candidate series to confirm a cycle");
  }
  return { ...series, cycle: series.cycle };
}

function scheduleCycle(
  previous: BoosterExpiryIncidentBoundaryState,
  cycle: BoosterExpiryIncidentConfirmedCycle,
) {
  const result = accepted(
    registerBoosterExpiryIncidentSchedule({
      previous,
      cycle,
      registeredAt: cycle.confirmedAt + 1,
      reason: "cycle-confirmed",
    }),
  );
  return { state: result.state, schedule: result.value.schedule };
}

function fireCycle(
  previous: BoosterExpiryIncidentBoundaryState,
  startedAt: number,
  firstSeconds: number,
) {
  const confirmed = confirmCycle(previous, startedAt, firstSeconds);
  const scheduled = scheduleCycle(confirmed.state, confirmed.cycle);
  const fired = accepted(
    completeBoosterExpiryIncidentSchedule({
      previous: scheduled.state,
      scheduleId: scheduled.schedule.id,
      outcome: "fired",
      occurredAt: scheduled.schedule.alertDueAt,
    }),
  );
  if (!fired.value.decision) {
    throw new Error("expected fired schedule to create a decision");
  }
  return {
    state: fired.state,
    cycle: confirmed.cycle,
    schedule: fired.value.schedule,
    decision: fired.value.decision,
  };
}
