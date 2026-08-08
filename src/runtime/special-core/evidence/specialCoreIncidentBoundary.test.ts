import { describe, expect, it } from "vitest";
import {
  collectSpecialCoreIncidentConfirmation,
  completeSpecialCoreIncidentSchedule,
  createSpecialCoreIncidentBoundary,
  freezeSpecialCoreIncidentBoundary,
  getSpecialCoreIncidentContinuityResetReason,
  isSpecialCoreIncidentFrameWithinLease,
  recordSpecialCoreIncidentActivationSighting,
  recordSpecialCoreIncidentFrame,
  recordSpecialCoreIncidentObservation,
  registerSpecialCoreIncidentSchedule,
  requestSpecialCoreIncidentPlayback,
  resetSpecialCoreIncidentBoundary,
  reviseSpecialCoreIncidentConfiguration,
  transitionSpecialCoreIncidentPlayback,
} from "./specialCoreIncidentBoundary";
import type {
  SpecialCoreIncidentActivation,
  SpecialCoreIncidentBoundaryResult,
  SpecialCoreIncidentBoundaryState,
  SpecialCoreIncidentClosedBoundary,
  SpecialCoreIncidentConfiguration,
  SpecialCoreIncidentConfirmationKind,
  SpecialCoreIncidentContinuity,
  SpecialCoreIncidentFrame,
  SpecialCoreIncidentObservation,
} from "./specialCoreIncidentEvidenceTypes";

const BASE_CONTINUITY: SpecialCoreIncidentContinuity = {
  captureGeneration: 1,
  featureGeneration: 1,
  parserRuntimeGeneration: "webgpu:1",
  matcherWorkerGeneration: 1,
  layoutKey: "1920x1080",
  sourceGeometryRevision: "top-right:v1",
};

const BASE_CONFIGURATION: SpecialCoreIncidentConfiguration = {
  enabled: true,
  cooldownSeconds: 30,
  alertLeadSeconds: 5,
  soundId: "countdown-a",
  featureVolume: 0.8,
  masterVolume: 0.5,
  effectiveVolume: 0.4,
};

describe("special core incident boundary", () => {
  it("creates stable reset/config identities and keeps no-op revisions stable", () => {
    const state = createBoundary();
    expect(state.resetEpoch.id).toBe("special-core-reset:session-a:1");
    expect(state.configurationRevision.id).toContain(state.resetEpoch.id);

    const revised = acceptResult(
      reviseSpecialCoreIncidentConfiguration({
        previous: state,
        configuration: BASE_CONFIGURATION,
        now: 10,
      }),
    );
    expect(revised.value.changed).toBe(false);
    expect(revised.state).toBe(state);
  });

  it("separates timing revisions from sound and volume revisions", () => {
    const state = createBoundary();
    const soundRevision = acceptResult(
      reviseSpecialCoreIncidentConfiguration({
        previous: state,
        configuration: {
          ...BASE_CONFIGURATION,
          soundId: "countdown-b",
          featureVolume: 0.6,
          effectiveVolume: 0.3,
        },
        now: 10,
      }),
    );
    expect(soundRevision.value.changed).toBe(true);
    expect(soundRevision.value.timingChanged).toBe(false);

    const timingRevision = acceptResult(
      reviseSpecialCoreIncidentConfiguration({
        previous: soundRevision.state,
        configuration: {
          ...soundRevision.value.configurationRevision.values,
          cooldownSeconds: 40,
        },
        now: 20,
      }),
    );
    expect(timingRevision.value.timingChanged).toBe(true);
  });

  it("requires a reset when enabled continuity changes", () => {
    const state = createBoundary();
    const revised = reviseSpecialCoreIncidentConfiguration({
      previous: state,
      configuration: { ...BASE_CONFIGURATION, enabled: false },
      now: 10,
    });
    expect(revised).toMatchObject({
      accepted: false,
      reason: "continuity-reset-required",
    });

    const reset = acceptResult(
      resetSpecialCoreIncidentBoundary({
        previous: state,
        continuity: { ...BASE_CONTINUITY, featureGeneration: 2 },
        configuration: { ...BASE_CONFIGURATION, enabled: false },
        now: 20,
        reason: "disabled",
      }),
    );
    expect(
      recordSpecialCoreIncidentFrame({ previous: reset.state, sampledAt: 30 }),
    ).toMatchObject({ accepted: false, reason: "feature-disabled" });
  });

  it("maps every continuity change to an explicit reset reason", () => {
    const cases: Array<
      [Partial<SpecialCoreIncidentContinuity>, string]
    > = [
      [{ captureGeneration: 2 }, "stream-replaced"],
      [{ layoutKey: "1366x768" }, "layout-changed"],
      [{ sourceGeometryRevision: "top-right:v2" }, "source-geometry-changed"],
      [{ parserRuntimeGeneration: "wasm:2" }, "parser-runtime-changed"],
      [{ matcherWorkerGeneration: 2 }, "matcher-worker-reset"],
      [{ featureGeneration: 2 }, "profile-replaced"],
    ];
    for (const [patch, reason] of cases) {
      expect(
        getSpecialCoreIncidentContinuityResetReason(BASE_CONTINUITY, {
          ...BASE_CONTINUITY,
          ...patch,
        }),
      ).toBe(reason);
    }
    expect(
      getSpecialCoreIncidentContinuityResetReason(
        BASE_CONTINUITY,
        BASE_CONTINUITY,
      ),
    ).toBeNull();
  });

  it("rejects frames and observations from an older reset epoch", () => {
    let state = createBoundary();
    const first = recordObservation(state, 1_000, "accepted");
    state = first.state;
    const reset = acceptResult(
      resetSpecialCoreIncidentBoundary({
        previous: state,
        continuity: { ...BASE_CONTINUITY, captureGeneration: 2 },
        configuration: BASE_CONFIGURATION,
        now: 1_500,
        reason: "stream-replaced",
      }),
    );

    expect(
      recordSpecialCoreIncidentObservation({
        previous: reset.state,
        frame: first.frame,
        decision: "accepted",
      }),
    ).toMatchObject({ accepted: false, reason: "stale-reset-epoch" });
    expect(
      collectSpecialCoreIncidentConfirmation({
        previous: reset.state,
        frame: first.frame,
        observation: first.observation,
        kind: "new-activation",
      }),
    ).toMatchObject({ accepted: false, reason: "stale-reset-epoch" });
  });

  it("rejects an older frame after a newer frame exists in the same reset", () => {
    const first = recordObservation(createBoundary(), 1_000, "accepted");
    const secondFrame = acceptResult(
      recordSpecialCoreIncidentFrame({
        previous: first.state,
        sampledAt: 2_000,
      }),
    );
    expect(
      collectSpecialCoreIncidentConfirmation({
        previous: secondFrame.state,
        frame: first.frame,
        observation: first.observation,
        kind: "new-activation",
      }),
    ).toMatchObject({ accepted: false, reason: "stale-frame" });
  });

  it("confirms two accepted observations within the inclusive three-second window", () => {
    const first = recordObservation(createBoundary(), 1_000, "accepted");
    const collecting = acceptResult(
      collectSpecialCoreIncidentConfirmation({
        previous: first.state,
        frame: first.frame,
        observation: first.observation,
        kind: "new-activation",
      }),
    );
    const second = recordObservation(collecting.state, 4_000, "accepted");
    const confirmed = acceptResult(
      collectSpecialCoreIncidentConfirmation({
        previous: second.state,
        frame: second.frame,
        observation: second.observation,
        kind: "new-activation",
      }),
    );

    expect(confirmed.value.attempt.status).toBe("confirmed");
    expect(confirmed.value.activation).toMatchObject({
      startedAt: 1_000,
      confirmedAt: 4_000,
      cooldownEndsAt: 31_000,
      alertDueAt: 26_000,
    });
    expect(confirmed.value.activation?.observationIds).toEqual([
      first.observation.id,
      second.observation.id,
    ]);
  });

  it("does not admit rejected matcher observations into confirmation", () => {
    const rejected = recordObservation(createBoundary(), 1_000, "rejected");
    expect(
      collectSpecialCoreIncidentConfirmation({
        previous: rejected.state,
        frame: rejected.frame,
        observation: rejected.observation,
        kind: "new-activation",
      }),
    ).toMatchObject({ accepted: false, reason: "observation-not-accepted" });
  });

  it("expires an attempt after three seconds and starts a distinct attempt", () => {
    const first = recordObservation(createBoundary(), 1_000, "accepted");
    const collecting = acceptResult(
      collectSpecialCoreIncidentConfirmation({
        previous: first.state,
        frame: first.frame,
        observation: first.observation,
        kind: "new-activation",
      }),
    );
    const late = recordObservation(collecting.state, 4_001, "accepted");
    const restarted = acceptResult(
      collectSpecialCoreIncidentConfirmation({
        previous: late.state,
        frame: late.frame,
        observation: late.observation,
        kind: "new-activation",
      }),
    );

    expect(restarted.value.expiredAttempt).toMatchObject({
      id: collecting.value.attempt.id,
      status: "expired",
      terminalReason: "window-expired",
    });
    expect(restarted.value.attempt.id).not.toBe(collecting.value.attempt.id);
    expect(restarted.value.activation).toBeNull();
    expect(restarted.value.attempt.observationIds).toEqual([late.observation.id]);
  });

  it("rejects a duplicate observation within one confirmation attempt", () => {
    const first = recordObservation(createBoundary(), 1_000, "accepted");
    const collecting = acceptResult(
      collectSpecialCoreIncidentConfirmation({
        previous: first.state,
        frame: first.frame,
        observation: first.observation,
        kind: "new-activation",
      }),
    );
    expect(
      collectSpecialCoreIncidentConfirmation({
        previous: collecting.state,
        frame: first.frame,
        observation: first.observation,
        kind: "new-activation",
      }),
    ).toMatchObject({
      accepted: false,
      reason: "duplicate-confirmation-observation",
    });
  });

  it("blocks a new activation during cooldown unless reacquire policy is eligible", () => {
    const confirmed = confirmActivation(createBoundary(), 1_000, 2_000);
    const next = recordObservation(confirmed.state, 10_000, "accepted");
    expect(
      collectSpecialCoreIncidentConfirmation({
        previous: next.state,
        frame: next.frame,
        observation: next.observation,
        kind: "new-activation",
      }),
    ).toMatchObject({ accepted: false, reason: "active-activation-exists" });
    expect(
      collectSpecialCoreIncidentConfirmation({
        previous: next.state,
        frame: next.frame,
        observation: next.observation,
        kind: "cooldown-reacquire",
      }),
    ).toMatchObject({
      accepted: false,
      reason: "cooldown-reacquire-not-eligible",
    });
  });

  it("records same-episode sightings and prevents reacquire inside the absence window", () => {
    const confirmed = confirmActivation(createBoundary(), 1_000, 2_000);
    const sighting = recordObservation(confirmed.state, 25_000, "accepted");
    const updated = acceptResult(
      recordSpecialCoreIncidentActivationSighting({
        previous: sighting.state,
        frame: sighting.frame,
        observation: sighting.observation,
      }),
    );
    expect(updated.value.lastSeenAt).toBe(25_000);

    const recent = recordObservation(updated.state, 27_000, "accepted");
    expect(
      collectSpecialCoreIncidentConfirmation({
        previous: recent.state,
        frame: recent.frame,
        observation: recent.observation,
        kind: "cooldown-reacquire",
      }),
    ).toMatchObject({
      accepted: false,
      reason: "cooldown-reacquire-not-eligible",
    });
  });

  it("creates a distinct activation from an eligible final-window reacquire", () => {
    const firstActivation = confirmActivation(createBoundary(), 1_000, 2_000);
    const first = recordObservation(firstActivation.state, 27_000, "accepted");
    const collecting = acceptResult(
      collectSpecialCoreIncidentConfirmation({
        previous: first.state,
        frame: first.frame,
        observation: first.observation,
        kind: "cooldown-reacquire",
      }),
    );
    const second = recordObservation(collecting.state, 28_000, "accepted");
    const reacquired = acceptResult(
      collectSpecialCoreIncidentConfirmation({
        previous: second.state,
        frame: second.frame,
        observation: second.observation,
        kind: "cooldown-reacquire",
      }),
    );

    expect(reacquired.value.activation?.id).not.toBe(firstActivation.activation.id);
    expect(reacquired.value.activation?.startedAt).toBe(27_000);
    expect(reacquired.value.closed?.activation).toMatchObject({
      id: firstActivation.activation.id,
      status: "terminal",
      terminalReason: "cooldown-reacquired",
    });
  });

  it("finishes an eligible reacquire attempt when its second frame lands at cooldown end", () => {
    const firstActivation = confirmActivation(createBoundary(), 1_000, 2_000);
    const first = recordObservation(firstActivation.state, 29_000, "accepted");
    const collecting = acceptResult(
      collectSpecialCoreIncidentConfirmation({
        previous: first.state,
        frame: first.frame,
        observation: first.observation,
        kind: "cooldown-reacquire",
      }),
    );
    const second = recordObservation(collecting.state, 31_000, "accepted");
    const confirmed = acceptResult(
      collectSpecialCoreIncidentConfirmation({
        previous: second.state,
        frame: second.frame,
        observation: second.observation,
        kind: "cooldown-reacquire",
      }),
    );
    expect(confirmed.value.activation).toMatchObject({
      confirmationKind: "cooldown-reacquire",
      startedAt: 29_000,
      confirmedAt: 31_000,
    });
  });

  it("starts a distinct normal activation after the prior cooldown ends", () => {
    const firstActivation = confirmActivation(createBoundary(), 1_000, 2_000);
    const secondActivation = confirmActivation(
      firstActivation.state,
      31_000,
      32_000,
      "new-activation",
    );
    expect(secondActivation.activation.id).not.toBe(firstActivation.activation.id);
    expect(secondActivation.closed?.activation).toMatchObject({
      id: firstActivation.activation.id,
      terminalReason: "next-activation",
    });
  });

  it("registers and fires one schedule linked to the activation and due time", () => {
    const confirmed = confirmActivation(createBoundary(), 1_000, 2_000);
    const scheduled = registerSchedule(confirmed.state, confirmed.activation, 2_100);
    expect(scheduled.schedule.alertDueAt).toBe(26_000);
    const rescheduled = acceptResult(
      registerSpecialCoreIncidentSchedule({
        previous: scheduled.state,
        activation: scheduled.state.activeActivation!,
        registeredAt: 2_200,
        reason: "browser-rescheduled",
      }),
    );
    expect(rescheduled.value).toMatchObject({
      schedule: {
        reason: "browser-rescheduled",
        alertDueAt: 26_000,
      },
      replacedSchedule: {
        id: scheduled.schedule.id,
        status: "replaced",
      },
    });
    expect(
      completeSpecialCoreIncidentSchedule({
        previous: rescheduled.state,
        scheduleId: rescheduled.value.schedule.id,
        outcome: "fired",
        occurredAt: 25_999,
      }),
    ).toMatchObject({ accepted: false, reason: "schedule-not-due" });

    const fired = acceptResult(
      completeSpecialCoreIncidentSchedule({
        previous: rescheduled.state,
        scheduleId: rescheduled.value.schedule.id,
        outcome: "fired",
        occurredAt: 26_010,
      }),
    );
    expect(fired.value.decision).toMatchObject({
      activationId: confirmed.activation.id,
      scheduleId: rescheduled.value.schedule.id,
      schedulerDelayMs: 10,
    });
  });

  it("requires schedule replacement after a timing revision", () => {
    const confirmed = confirmActivation(createBoundary(), 1_000, 2_000);
    const firstSchedule = registerSchedule(
      confirmed.state,
      confirmed.activation,
      2_100,
    );
    const revised = acceptResult(
      reviseSpecialCoreIncidentConfiguration({
        previous: firstSchedule.state,
        configuration: { ...BASE_CONFIGURATION, cooldownSeconds: 40 },
        now: 3_000,
      }),
    );
    expect(
      completeSpecialCoreIncidentSchedule({
        previous: revised.state,
        scheduleId: firstSchedule.schedule.id,
        outcome: "fired",
        occurredAt: 26_000,
      }),
    ).toMatchObject({ accepted: false, reason: "schedule-timing-revised" });

    const replacement = registerSchedule(
      revised.state,
      revised.state.activeActivation!,
      3_100,
      "configuration-retimed",
    );
    expect(replacement.schedule.alertDueAt).toBe(36_000);
    expect(replacement.replacedSchedule).toMatchObject({
      id: firstSchedule.schedule.id,
      status: "replaced",
    });
    expect(
      completeSpecialCoreIncidentSchedule({
        previous: replacement.state,
        scheduleId: firstSchedule.schedule.id,
        outcome: "fired",
        occurredAt: 36_000,
      }),
    ).toMatchObject({ accepted: false, reason: "stale-schedule" });
  });

  it("keeps a timing schedule valid across sound changes and snapshots playback settings", () => {
    const confirmed = confirmActivation(createBoundary(), 1_000, 2_000);
    const scheduled = registerSchedule(confirmed.state, confirmed.activation, 2_100);
    const revised = acceptResult(
      reviseSpecialCoreIncidentConfiguration({
        previous: scheduled.state,
        configuration: {
          ...BASE_CONFIGURATION,
          soundId: "countdown-b",
          featureVolume: 0.6,
          effectiveVolume: 0.3,
        },
        now: 3_000,
      }),
    );
    expect(revised.value.timingChanged).toBe(false);
    const fired = acceptResult(
      completeSpecialCoreIncidentSchedule({
        previous: revised.state,
        scheduleId: scheduled.schedule.id,
        outcome: "fired",
        occurredAt: 26_000,
      }),
    );
    const requested = acceptResult(
      requestSpecialCoreIncidentPlayback({
        previous: fired.state,
        decision: fired.value.decision!,
        requestedAt: 26_001,
        startOffsetSeconds: 5,
      }),
    );
    expect(requested.value).toMatchObject({
      soundId: "countdown-b",
      featureVolume: 0.6,
      effectiveVolume: 0.3,
      configRevisionId: revised.value.configurationRevision.id,
    });
  });

  it("records cancelled and suppressed schedules without manufacturing an alert decision", () => {
    const confirmed = confirmActivation(createBoundary(), 1_000, 2_000);
    const scheduled = registerSchedule(confirmed.state, confirmed.activation, 2_100);
    const cancelled = acceptResult(
      completeSpecialCoreIncidentSchedule({
        previous: scheduled.state,
        scheduleId: scheduled.schedule.id,
        outcome: "cancelled",
        occurredAt: 5_000,
        reason: "stream-stopped",
      }),
    );
    expect(cancelled.value.schedule).toMatchObject({
      status: "cancelled",
      outcomeReason: "stream-stopped",
    });
    expect(cancelled.value.decision).toBeNull();
    expect(cancelled.state.latestDecision).toBeNull();
  });

  it("requires browser acceptance before a playback can finish", () => {
    const ready = createPlaybackReadyState();
    const requested = acceptResult(
      requestSpecialCoreIncidentPlayback({
        previous: ready.state,
        decision: ready.decision,
        requestedAt: 26_001,
        startOffsetSeconds: 5,
      }),
    );
    expect(
      transitionSpecialCoreIncidentPlayback({
        previous: requested.state,
        attemptId: requested.value.id,
        status: "finished",
        occurredAt: 27_000,
      }),
    ).toMatchObject({
      accepted: false,
      reason: "invalid-playback-transition",
    });

    const started = acceptResult(
      transitionSpecialCoreIncidentPlayback({
        previous: requested.state,
        attemptId: requested.value.id,
        status: "browser-play-accepted",
        occurredAt: 26_010,
      }),
    );
    const finished = acceptResult(
      transitionSpecialCoreIncidentPlayback({
        previous: started.state,
        attemptId: started.value.id,
        status: "finished",
        occurredAt: 27_000,
      }),
    );
    expect(finished.value).toMatchObject({
      status: "finished",
      browserAcceptedAt: 26_010,
      finishedAt: 27_000,
    });
    expect(finished.state.activePlaybackAttempt).toBeNull();
  });

  it("records a request failure without claiming browser playback started", () => {
    const ready = createPlaybackReadyState();
    const requested = acceptResult(
      requestSpecialCoreIncidentPlayback({
        previous: ready.state,
        decision: ready.decision,
        requestedAt: 26_001,
        startOffsetSeconds: 5,
      }),
    );
    const failed = acceptResult(
      transitionSpecialCoreIncidentPlayback({
        previous: requested.state,
        attemptId: requested.value.id,
        status: "failed",
        occurredAt: 26_010,
        error: "NotAllowedError",
      }),
    );
    expect(failed.value).toMatchObject({
      status: "failed",
      browserAcceptedAt: null,
      failedAt: 26_010,
      error: "NotAllowedError",
    });
  });

  it("rejects duplicate requests and stale playback callbacks after reset", () => {
    const ready = createPlaybackReadyState();
    const requested = acceptResult(
      requestSpecialCoreIncidentPlayback({
        previous: ready.state,
        decision: ready.decision,
        requestedAt: 26_001,
        startOffsetSeconds: 5,
      }),
    );
    expect(
      requestSpecialCoreIncidentPlayback({
        previous: requested.state,
        decision: ready.decision,
        requestedAt: 26_002,
        startOffsetSeconds: 5,
      }),
    ).toMatchObject({ accepted: false, reason: "playback-in-flight" });

    const reset = acceptResult(
      resetSpecialCoreIncidentBoundary({
        previous: requested.state,
        continuity: { ...BASE_CONTINUITY, featureGeneration: 2 },
        configuration: BASE_CONFIGURATION,
        now: 26_100,
        reason: "profile-replaced",
      }),
    );
    expect(reset.value.closed.playbackAttempt?.id).toBe(requested.value.id);
    expect(
      transitionSpecialCoreIncidentPlayback({
        previous: reset.state,
        attemptId: requested.value.id,
        status: "browser-play-accepted",
        occurredAt: 26_200,
      }),
    ).toMatchObject({ accepted: false, reason: "stale-playback-attempt" });
  });

  it("does not reuse one alert decision after its playback attempt terminates", () => {
    const ready = createPlaybackReadyState();
    const requested = acceptResult(
      requestSpecialCoreIncidentPlayback({
        previous: ready.state,
        decision: ready.decision,
        requestedAt: 26_001,
        startOffsetSeconds: 5,
      }),
    );
    const failed = acceptResult(
      transitionSpecialCoreIncidentPlayback({
        previous: requested.state,
        attemptId: requested.value.id,
        status: "failed",
        occurredAt: 26_010,
        error: "decode-failed",
      }),
    );
    expect(
      requestSpecialCoreIncidentPlayback({
        previous: failed.state,
        decision: ready.decision,
        requestedAt: 26_020,
        startOffsetSeconds: 5,
      }),
    ).toMatchObject({
      accepted: false,
      reason: "decision-playback-already-requested",
    });
  });

  it("closes pending confirmation and active schedule chains on reset", () => {
    const first = recordObservation(createBoundary(), 1_000, "accepted");
    const collecting = acceptResult(
      collectSpecialCoreIncidentConfirmation({
        previous: first.state,
        frame: first.frame,
        observation: first.observation,
        kind: "new-activation",
      }),
    );
    const pendingReset = acceptResult(
      resetSpecialCoreIncidentBoundary({
        previous: collecting.state,
        continuity: { ...BASE_CONTINUITY, matcherWorkerGeneration: 2 },
        configuration: BASE_CONFIGURATION,
        now: 1_500,
        reason: "matcher-worker-reset",
      }),
    );
    expect(pendingReset.value.closed.confirmationAttempt).toMatchObject({
      id: collecting.value.attempt.id,
      status: "terminal",
      terminalReason: "reset-epoch",
    });

    const confirmed = confirmActivation(createBoundary(), 2_000, 3_000);
    const scheduled = registerSchedule(confirmed.state, confirmed.activation, 3_100);
    const scheduledReset = acceptResult(
      resetSpecialCoreIncidentBoundary({
        previous: scheduled.state,
        continuity: { ...BASE_CONTINUITY, parserRuntimeGeneration: "wasm:2" },
        configuration: BASE_CONFIGURATION,
        now: 4_000,
        reason: "parser-runtime-changed",
      }),
    );
    expect(scheduledReset.value.closed.activation).toMatchObject({
      id: confirmed.activation.id,
      status: "terminal",
      terminalReason: "reset-epoch",
    });
    expect(scheduledReset.value.closed.schedule).toMatchObject({
      id: scheduled.schedule.id,
      status: "cancelled",
      outcomeReason: "reset-epoch",
    });
  });

  it("freezes exact IDs and excludes frames produced after dialog open", () => {
    const ready = createPlaybackReadyState();
    const requested = acceptResult(
      requestSpecialCoreIncidentPlayback({
        previous: ready.state,
        decision: ready.decision,
        requestedAt: 26_001,
        startOffsetSeconds: 5,
      }),
    );
    const frozen = freezeSpecialCoreIncidentBoundary({
      previous: requested.state,
      frozenAt: 26_100,
    });
    expect(frozen.lease).toMatchObject({
      activationId: ready.state.activeActivation?.id,
      scheduleId: ready.state.latestSchedule?.id,
      decisionId: ready.decision.id,
      playbackAttemptId: requested.value.id,
      leasedThroughFrameSequence: requested.state.frameSequence,
    });

    const later = acceptResult(
      recordSpecialCoreIncidentFrame({
        previous: frozen.state,
        sampledAt: 26_200,
      }),
    );
    expect(
      isSpecialCoreIncidentFrameWithinLease(frozen.lease, later.value),
    ).toBe(false);
    expect(
      isSpecialCoreIncidentFrameWithinLease(
        frozen.lease,
        requested.state.latestFrame!,
      ),
    ).toBe(true);
  });

  it("does not admit an older-reset frame into a new report lease", () => {
    const first = acceptResult(
      recordSpecialCoreIncidentFrame({
        previous: createBoundary(),
        sampledAt: 1_000,
      }),
    );
    const reset = acceptResult(
      resetSpecialCoreIncidentBoundary({
        previous: first.state,
        continuity: { ...BASE_CONTINUITY, parserRuntimeGeneration: "wasm:2" },
        configuration: BASE_CONFIGURATION,
        now: 2_000,
        reason: "parser-runtime-changed",
      }),
    );
    const frozen = freezeSpecialCoreIncidentBoundary({
      previous: reset.state,
      frozenAt: 2_100,
    });
    expect(
      isSpecialCoreIncidentFrameWithinLease(frozen.lease, first.value),
    ).toBe(false);
  });
});

function createBoundary() {
  return createSpecialCoreIncidentBoundary({
    sessionId: "session-a",
    continuity: BASE_CONTINUITY,
    configuration: BASE_CONFIGURATION,
    now: 0,
  });
}

function recordObservation(
  state: SpecialCoreIncidentBoundaryState,
  sampledAt: number,
  decision: "accepted" | "rejected" | "missing" | "error",
): {
  state: SpecialCoreIncidentBoundaryState;
  frame: SpecialCoreIncidentFrame;
  observation: SpecialCoreIncidentObservation;
} {
  const frame = acceptResult(
    recordSpecialCoreIncidentFrame({ previous: state, sampledAt }),
  );
  const observation = acceptResult(
    recordSpecialCoreIncidentObservation({
      previous: frame.state,
      frame: frame.value,
      decision,
    }),
  );
  return {
    state: observation.state,
    frame: frame.value,
    observation: observation.value,
  };
}

function confirmActivation(
  state: SpecialCoreIncidentBoundaryState,
  firstAt: number,
  secondAt: number,
  kind: SpecialCoreIncidentConfirmationKind = "new-activation",
): {
  state: SpecialCoreIncidentBoundaryState;
  activation: SpecialCoreIncidentActivation;
  closed: SpecialCoreIncidentClosedBoundary | null;
} {
  const first = recordObservation(state, firstAt, "accepted");
  const collecting = acceptResult(
    collectSpecialCoreIncidentConfirmation({
      previous: first.state,
      frame: first.frame,
      observation: first.observation,
      kind,
    }),
  );
  const second = recordObservation(collecting.state, secondAt, "accepted");
  const confirmed = acceptResult(
    collectSpecialCoreIncidentConfirmation({
      previous: second.state,
      frame: second.frame,
      observation: second.observation,
      kind,
    }),
  );
  if (!confirmed.value.activation) {
    throw new Error("expected activation");
  }
  return {
    state: confirmed.state,
    activation: confirmed.value.activation,
    closed: confirmed.value.closed,
  };
}

function registerSchedule(
  state: SpecialCoreIncidentBoundaryState,
  activation: SpecialCoreIncidentActivation,
  registeredAt: number,
  reason: "activation-confirmed" | "configuration-retimed" | "browser-rescheduled" =
    "activation-confirmed",
) {
  const result = acceptResult(
    registerSpecialCoreIncidentSchedule({
      previous: state,
      activation,
      registeredAt,
      reason,
    }),
  );
  return {
    state: result.state,
    schedule: result.value.schedule,
    replacedSchedule: result.value.replacedSchedule,
  };
}

function createPlaybackReadyState() {
  const confirmed = confirmActivation(createBoundary(), 1_000, 2_000);
  const scheduled = registerSchedule(confirmed.state, confirmed.activation, 2_100);
  const fired = acceptResult(
    completeSpecialCoreIncidentSchedule({
      previous: scheduled.state,
      scheduleId: scheduled.schedule.id,
      outcome: "fired",
      occurredAt: 26_000,
    }),
  );
  if (!fired.value.decision) {
    throw new Error("expected alert decision");
  }
  return { state: fired.state, decision: fired.value.decision };
}

function acceptResult<T>(result: SpecialCoreIncidentBoundaryResult<T>) {
  if (!result.accepted) {
    throw new Error(`expected accepted result, received ${result.reason}`);
  }
  return result;
}
