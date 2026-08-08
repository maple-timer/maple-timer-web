import { describe, expect, it } from "vitest";
import {
  acceptHuntStallIncidentActivity,
  createHuntStallIncidentBoundary,
  freezeHuntStallIncidentBoundary,
  getHuntStallIncidentContinuityResetReason,
  isHuntStallIncidentFrameWithinLease,
  recordHuntStallIncidentAlertDecision,
  recordHuntStallIncidentFrame,
  recordHuntStallIncidentObservation,
  requestHuntStallIncidentPlayback,
  resetHuntStallIncidentBoundary,
  reviseHuntStallIncidentConfiguration,
  transitionHuntStallIncidentPlayback,
} from "./huntStallIncidentBoundary";
import type {
  HuntStallIncidentActivityReason,
  HuntStallIncidentAlertDecision,
  HuntStallIncidentBoundaryResult,
  HuntStallIncidentBoundaryState,
  HuntStallIncidentConfiguration,
  HuntStallIncidentContinuity,
  HuntStallIncidentFrame,
  HuntStallIncidentObservation,
} from "./huntStallIncidentEvidenceTypes";

describe("huntStallIncidentBoundary", () => {
  it("keeps one manual stall episode across its initial alert and finished-playback repeat", () => {
    let state = createBoundary();
    const armed = acceptActivity(
      state,
      1_000,
      "manual-progress-confirmed",
    );
    state = armed.state;

    const initial = recordDecision(state, 6_000, "initial");
    state = initial.state;
    const initialRequest = unwrap(
      requestHuntStallIncidentPlayback({
        previous: state,
        decision: initial.decision,
        requestedAt: 6_010,
      }),
    );
    state = initialRequest.state;
    const started = unwrap(
      transitionHuntStallIncidentPlayback({
        previous: state,
        attemptId: initialRequest.value.id,
        status: "started",
        occurredAt: 6_020,
      }),
    );
    state = started.state;
    const finished = unwrap(
      transitionHuntStallIncidentPlayback({
        previous: state,
        attemptId: started.value.id,
        status: "finished",
        occurredAt: 6_500,
      }),
    );
    state = finished.state;

    const repeat = recordDecision(state, 12_000, "repeat");
    state = repeat.state;
    const repeatRequest = unwrap(
      requestHuntStallIncidentPlayback({
        previous: state,
        decision: repeat.decision,
        requestedAt: 12_010,
      }),
    );

    expect(initial.cycle.id).toBe(repeat.cycle.id);
    expect(initial.decision.stallEpisodeId).toBe(armed.stallEpisode.id);
    expect(repeat.decision.stallEpisodeId).toBe(armed.stallEpisode.id);
    expect(repeat.decision.kind).toBe("repeat");
    expect(repeatRequest.value.id).not.toBe(initialRequest.value.id);
    expect(repeatRequest.value.sequence).toBe(2);
    expect(repeatRequest.value).toMatchObject({
      cycleId: initial.cycle.id,
      configRevisionId: repeat.decision.configRevisionId,
      soundId: "alarm-a",
      featureVolume: 0.7,
      masterVolume: 0.5,
      effectiveVolume: 0.35,
    });
  });

  it("does not create duplicate activity or playback identities from one event", () => {
    let state = createBoundary();
    const sampled = captureObservation(state, 1_000);
    const armed = unwrap(
      acceptHuntStallIncidentActivity({
        previous: sampled.state,
        frame: sampled.frame,
        observation: sampled.observation,
        occurredAt: 1_000,
        reason: "manual-progress-confirmed",
      }),
    );
    state = armed.state;
    expect(
      acceptHuntStallIncidentActivity({
        previous: state,
        frame: sampled.frame,
        observation: sampled.observation,
        occurredAt: 1_001,
        reason: "manual-progress-confirmed",
      }),
    ).toMatchObject({
      accepted: false,
      reason: "duplicate-activity-observation",
    });

    const initial = recordDecision(state, 6_000, "initial");
    state = initial.state;
    const requested = unwrap(
      requestHuntStallIncidentPlayback({
        previous: state,
        decision: initial.decision,
        requestedAt: 6_010,
      }),
    );
    state = requested.state;
    state = unwrap(
      transitionHuntStallIncidentPlayback({
        previous: state,
        attemptId: requested.value.id,
        status: "started",
        occurredAt: 6_020,
      }),
    ).state;
    state = unwrap(
      transitionHuntStallIncidentPlayback({
        previous: state,
        attemptId: requested.value.id,
        status: "finished",
        occurredAt: 6_500,
      }),
    ).state;
    expect(
      requestHuntStallIncidentPlayback({
        previous: state,
        decision: initial.decision,
        requestedAt: 6_600,
      }),
    ).toMatchObject({
      accepted: false,
      reason: "decision-playback-already-requested",
    });
  });

  it("never admits a repeat decision in cooldown-presence mode", () => {
    let state = createBoundary({ mode: "cooldown-presence" });
    const armed = acceptActivity(
      state,
      1_000,
      "cooldown-presence-confirmed",
    );
    state = armed.state;
    const initial = recordDecision(state, 3_000, "initial");
    state = initial.state;
    const requested = unwrap(
      requestHuntStallIncidentPlayback({
        previous: state,
        decision: initial.decision,
        requestedAt: 3_010,
      }),
    );
    state = requested.state;
    state = unwrap(
      transitionHuntStallIncidentPlayback({
        previous: state,
        attemptId: requested.value.id,
        status: "started",
        occurredAt: 3_020,
      }),
    ).state;
    state = unwrap(
      transitionHuntStallIncidentPlayback({
        previous: state,
        attemptId: requested.value.id,
        status: "finished",
        occurredAt: 3_500,
      }),
    ).state;
    const sampled = captureObservation(state, 5_000);

    const repeat = recordHuntStallIncidentAlertDecision({
      previous: sampled.state,
      frame: sampled.frame,
      observation: sampled.observation,
      occurredAt: 5_000,
      kind: "repeat",
    });

    expect(repeat).toMatchObject({
      accepted: false,
      reason: "repeat-not-supported",
    });
  });

  it("closes the old episode on accepted activity and rejects its delayed evidence", () => {
    let state = createBoundary();
    const firstActivity = acceptActivity(
      state,
      1_000,
      "manual-progress-confirmed",
    );
    state = firstActivity.state;
    const firstAlert = recordDecision(state, 6_000, "initial");
    state = firstAlert.state;
    const requested = unwrap(
      requestHuntStallIncidentPlayback({
        previous: state,
        decision: firstAlert.decision,
        requestedAt: 6_010,
      }),
    );
    state = requested.state;
    const started = unwrap(
      transitionHuntStallIncidentPlayback({
        previous: state,
        attemptId: requested.value.id,
        status: "started",
        occurredAt: 6_020,
      }),
    );
    state = started.state;

    const secondActivity = acceptActivity(
      state,
      7_000,
      "manual-progress-confirmed",
    );
    state = secondActivity.state;

    expect(secondActivity.activityEpoch.id).not.toBe(
      firstActivity.activityEpoch.id,
    );
    expect(secondActivity.stallEpisode.id).not.toBe(
      firstActivity.stallEpisode.id,
    );
    expect(secondActivity.closed.activityEpoch).toMatchObject({
      id: firstActivity.activityEpoch.id,
      terminalReason: "activity-accepted",
      endedAt: 7_000,
    });
    expect(secondActivity.closed.alertCycle).toMatchObject({
      id: firstAlert.cycle.id,
      status: "terminal",
    });
    expect(secondActivity.closed.playbackAttempt?.id).toBe(started.value.id);

    expect(
      transitionHuntStallIncidentPlayback({
        previous: state,
        attemptId: started.value.id,
        status: "finished",
        occurredAt: 7_500,
      }),
    ).toMatchObject({
      accepted: false,
      reason: "stale-playback-attempt",
    });
    expect(
      requestHuntStallIncidentPlayback({
        previous: state,
        decision: firstAlert.decision,
        requestedAt: 7_500,
      }),
    ).toMatchObject({
      accepted: false,
      reason: "stale-alert-decision",
    });

    const secondAlert = recordDecision(state, 12_000, "initial");
    expect(secondAlert.cycle.id).not.toBe(firstAlert.cycle.id);
    expect(secondAlert.decision.stallEpisodeId).toBe(
      secondActivity.stallEpisode.id,
    );
  });

  it("requires reset epochs for mode, layout, region, stream, worker, and feature continuity", () => {
    const base = makeContinuity();
    const cases: Array<{
      next: HuntStallIncidentContinuity;
      reason: string;
    }> = [
      {
        next: { ...base, captureGeneration: 2 },
        reason: "stream-replaced",
      },
      {
        next: { ...base, mode: "cooldown-presence" },
        reason: "mode-changed",
      },
      { next: { ...base, layoutKey: "layout-b" }, reason: "layout-changed" },
      {
        next: { ...base, regionRevision: "region-b" },
        reason: "region-changed",
      },
      {
        next: { ...base, workerGeneration: 2 },
        reason: "worker-reset",
      },
      {
        next: { ...base, featureGeneration: 2 },
        reason: "profile-replaced",
      },
    ];

    for (const entry of cases) {
      expect(getHuntStallIncidentContinuityResetReason(base, entry.next)).toBe(
        entry.reason,
      );
    }
    expect(getHuntStallIncidentContinuityResetReason(base, { ...base })).toBeNull();
  });

  it("separates manual and cooldown evidence across a real mode reset", () => {
    let state = createBoundary();
    const manualActivity = acceptActivity(
      state,
      1_000,
      "manual-progress-confirmed",
    );
    state = manualActivity.state;
    const manualAlert = recordDecision(state, 6_000, "initial");
    state = manualAlert.state;

    const cooldownContinuity: HuntStallIncidentContinuity = {
      ...state.resetEpoch.continuity,
      mode: "cooldown-presence",
    };
    const reset = unwrap(
      resetHuntStallIncidentBoundary({
        previous: state,
        continuity: cooldownContinuity,
        configuration: makeConfiguration({
          mode: "cooldown-presence",
          repeatAlertEnabled: false,
          repeatAlertIntervalSeconds: null,
          repeatAlertMaxCount: null,
        }),
        now: 7_000,
        reason: "mode-changed",
      }),
    );
    state = reset.state;

    expect(state.resetEpoch.continuity.mode).toBe("cooldown-presence");
    expect(reset.value.closed.stallEpisode?.id).toBe(
      manualActivity.stallEpisode.id,
    );
    expect(
      recordHuntStallIncidentAlertDecision({
        previous: state,
        frame: manualAlert.frame,
        observation: manualAlert.observation,
        occurredAt: 7_100,
        kind: "initial",
      }),
    ).toMatchObject({
      accepted: false,
      reason: "stale-reset-epoch",
    });

    const cooldownActivity = acceptActivity(
      state,
      8_000,
      "cooldown-presence-confirmed",
    );
    expect(cooldownActivity.activityEpoch.mode).toBe("cooldown-presence");
    expect(cooldownActivity.stallEpisode.id).not.toBe(
      manualActivity.stallEpisode.id,
    );
  });

  it("uses disable and enable as hard evidence boundaries", () => {
    let state = createBoundary();
    const armed = acceptActivity(
      state,
      1_000,
      "manual-progress-confirmed",
    );
    state = armed.state;

    const disabled = unwrap(
      resetHuntStallIncidentBoundary({
        previous: state,
        continuity: {
          ...state.resetEpoch.continuity,
          featureGeneration: state.resetEpoch.continuity.featureGeneration + 1,
        },
        configuration: makeConfiguration({ enabled: false }),
        now: 2_000,
        reason: "disabled",
      }),
    );
    state = disabled.state;
    expect(disabled.value.closed.stallEpisode?.id).toBe(armed.stallEpisode.id);
    expect(
      recordHuntStallIncidentFrame({ previous: state, sampledAt: 3_000 }),
    ).toMatchObject({ accepted: false, reason: "feature-disabled" });

    const enabled = unwrap(
      resetHuntStallIncidentBoundary({
        previous: state,
        continuity: {
          ...state.resetEpoch.continuity,
          featureGeneration: state.resetEpoch.continuity.featureGeneration + 1,
        },
        configuration: makeConfiguration({ enabled: true }),
        now: 4_000,
        reason: "enabled",
      }),
    );
    expect(enabled.state.resetEpoch.id).not.toBe(disabled.state.resetEpoch.id);
    expect(enabled.state.activeActivityEpoch).toBeNull();
    expect(
      recordHuntStallIncidentFrame({
        previous: enabled.state,
        sampledAt: 5_000,
      }),
    ).toMatchObject({ accepted: true });
  });

  it("rejects activity semantics from the other mode", () => {
    const manualSample = captureObservation(createBoundary(), 1_000);
    expect(
      acceptHuntStallIncidentActivity({
        previous: manualSample.state,
        frame: manualSample.frame,
        observation: manualSample.observation,
        occurredAt: 1_000,
        reason: "cooldown-presence-confirmed",
      }),
    ).toMatchObject({
      accepted: false,
      reason: "activity-reason-mode-mismatch",
    });

    const cooldownSample = captureObservation(
      createBoundary({ mode: "cooldown-presence" }),
      1_000,
    );
    expect(
      acceptHuntStallIncidentActivity({
        previous: cooldownSample.state,
        frame: cooldownSample.frame,
        observation: cooldownSample.observation,
        occurredAt: 1_000,
        reason: "manual-progress-confirmed",
      }),
    ).toMatchObject({
      accepted: false,
      reason: "activity-reason-mode-mismatch",
    });
  });

  it.each([
    "layout-changed",
    "region-changed",
    "stream-replaced",
    "profile-replaced",
    "preset-replaced",
    "global-disabled",
    "worker-reset",
  ] as const)("prevents %s epochs from donating old frames or cycles", (reason) => {
    let state = createBoundary();
    const firstActivity = acceptActivity(
      state,
      1_000,
      "manual-progress-confirmed",
    );
    state = firstActivity.state;
    const firstAlert = recordDecision(state, 6_000, "initial");
    state = firstAlert.state;
    const oldFrame = firstAlert.frame;
    const oldObservation = firstAlert.observation;
    const nextContinuity = continuityForReset(state.resetEpoch.continuity, reason);
    const reset = unwrap(
      resetHuntStallIncidentBoundary({
        previous: state,
        continuity: nextContinuity,
        configuration: makeConfiguration({ mode: nextContinuity.mode }),
        now: 7_000,
        reason,
      }),
    );
    state = reset.state;

    expect(reset.value.closed.stallEpisode?.id).toBe(
      firstActivity.stallEpisode.id,
    );
    expect(reset.value.closed.alertCycle?.id).toBe(firstAlert.cycle.id);
    expect(
      recordHuntStallIncidentObservation({ previous: state, frame: oldFrame }),
    ).toMatchObject({
      accepted: false,
      reason: "stale-reset-epoch",
    });
    expect(
      recordHuntStallIncidentAlertDecision({
        previous: state,
        frame: oldFrame,
        observation: oldObservation,
        occurredAt: 7_100,
        kind: "initial",
      }),
    ).toMatchObject({
      accepted: false,
      reason: "stale-reset-epoch",
    });
    expect(
      requestHuntStallIncidentPlayback({
        previous: state,
        decision: firstAlert.decision,
        requestedAt: 7_100,
      }),
    ).toMatchObject({
      accepted: false,
      reason: "stale-reset-epoch",
    });
  });

  it("revises threshold, repeat, sound, and volume without changing the active episode", () => {
    let state = createBoundary();
    const armed = acceptActivity(
      state,
      1_000,
      "manual-progress-confirmed",
    );
    state = armed.state;
    const initial = recordDecision(state, 6_000, "initial");
    state = initial.state;
    const initialRequest = unwrap(
      requestHuntStallIncidentPlayback({
        previous: state,
        decision: initial.decision,
        requestedAt: 6_010,
      }),
    );
    state = initialRequest.state;
    state = unwrap(
      transitionHuntStallIncidentPlayback({
        previous: state,
        attemptId: initialRequest.value.id,
        status: "started",
        occurredAt: 6_020,
      }),
    ).state;
    state = unwrap(
      transitionHuntStallIncidentPlayback({
        previous: state,
        attemptId: initialRequest.value.id,
        status: "finished",
        occurredAt: 6_500,
      }),
    ).state;

    const revised = unwrap(
      reviseHuntStallIncidentConfiguration({
        previous: state,
        configuration: makeConfiguration({
          thresholdSeconds: 45,
          repeatAlertIntervalSeconds: 15,
          soundId: "alarm-b",
          featureVolume: 0.4,
          masterVolume: 0.25,
          effectiveVolume: 0.1,
        }),
        now: 7_000,
      }),
    );
    state = revised.state;

    expect(revised.value.changed).toBe(true);
    expect(state.activeActivityEpoch?.id).toBe(armed.activityEpoch.id);
    expect(state.activeStallEpisode?.id).toBe(armed.stallEpisode.id);
    expect(state.activeAlertCycle?.id).toBe(initial.cycle.id);
    expect(
      requestHuntStallIncidentPlayback({
        previous: state,
        decision: initial.decision,
        requestedAt: 7_010,
      }),
    ).toMatchObject({
      accepted: false,
      reason: "configuration-revised-after-decision",
    });

    const repeat = recordDecision(state, 21_000, "repeat");
    state = repeat.state;
    const repeatRequest = unwrap(
      requestHuntStallIncidentPlayback({
        previous: state,
        decision: repeat.decision,
        requestedAt: 21_010,
      }),
    );
    expect(repeat.cycle.id).toBe(initial.cycle.id);
    expect(repeatRequest.value).toMatchObject({
      configRevisionId: revised.value.configurationRevision.id,
      soundId: "alarm-b",
      featureVolume: 0.4,
      masterVolume: 0.25,
      effectiveVolume: 0.1,
    });

    const unchanged = unwrap(
      reviseHuntStallIncidentConfiguration({
        previous: repeatRequest.state,
        configuration: { ...revised.value.configurationRevision.values },
        now: 22_000,
      }),
    );
    expect(unchanged.value.changed).toBe(false);
    expect(unchanged.value.configurationRevision.id).toBe(
      revised.value.configurationRevision.id,
    );
  });

  it("requires an explicit reset for enabled or mode changes", () => {
    const state = createBoundary();

    expect(
      reviseHuntStallIncidentConfiguration({
        previous: state,
        configuration: makeConfiguration({ enabled: false }),
        now: 1_000,
      }),
    ).toMatchObject({
      accepted: false,
      reason: "continuity-reset-required",
    });
    expect(
      reviseHuntStallIncidentConfiguration({
        previous: state,
        configuration: makeConfiguration({ mode: "cooldown-presence" }),
        now: 1_000,
      }),
    ).toMatchObject({
      accepted: false,
      reason: "continuity-reset-required",
    });
  });

  it("freezes report identity at open time and excludes later or reset frames", () => {
    let state = createBoundary();
    const armed = acceptActivity(
      state,
      1_000,
      "manual-progress-confirmed",
    );
    state = armed.state;
    const initial = recordDecision(state, 6_000, "initial");
    state = initial.state;
    const frozen = freezeHuntStallIncidentBoundary({
      previous: state,
      frozenAt: 6_100,
    });
    state = frozen.state;

    expect(frozen.lease).toMatchObject({
      resetEpochId: state.resetEpoch.id,
      activityEpochId: armed.activityEpoch.id,
      stallEpisodeId: armed.stallEpisode.id,
      alertCycleId: initial.cycle.id,
      playbackAttemptId: null,
    });
    expect(isHuntStallIncidentFrameWithinLease(frozen.lease, initial.frame)).toBe(
      true,
    );

    const later = captureObservation(state, 7_000);
    expect(isHuntStallIncidentFrameWithinLease(frozen.lease, later.frame)).toBe(
      false,
    );
    const reset = unwrap(
      resetHuntStallIncidentBoundary({
        previous: later.state,
        continuity: {
          ...later.state.resetEpoch.continuity,
          regionRevision: "region-b",
        },
        configuration: makeConfiguration(),
        now: 8_000,
        reason: "region-changed",
      }),
    );
    const afterReset = captureObservation(reset.state, 9_000);
    expect(
      isHuntStallIncidentFrameWithinLease(frozen.lease, afterReset.frame),
    ).toBe(false);
  });
});

function createBoundary({
  mode = "manual-experience",
}: {
  mode?: HuntStallIncidentContinuity["mode"];
} = {}): HuntStallIncidentBoundaryState {
  return createHuntStallIncidentBoundary({
    sessionId: "test-session",
    continuity: makeContinuity({ mode }),
    configuration: makeConfiguration({ mode }),
    now: 0,
  });
}

function captureObservation(
  state: HuntStallIncidentBoundaryState,
  sampledAt: number,
): {
  state: HuntStallIncidentBoundaryState;
  frame: HuntStallIncidentFrame;
  observation: HuntStallIncidentObservation;
} {
  const frame = unwrap(
    recordHuntStallIncidentFrame({ previous: state, sampledAt }),
  );
  const observation = unwrap(
    recordHuntStallIncidentObservation({
      previous: frame.state,
      frame: frame.value,
    }),
  );
  return {
    state: observation.state,
    frame: frame.value,
    observation: observation.value,
  };
}

function acceptActivity(
  state: HuntStallIncidentBoundaryState,
  sampledAt: number,
  reason: HuntStallIncidentActivityReason,
) {
  const sampled = captureObservation(state, sampledAt);
  const accepted = unwrap(
    acceptHuntStallIncidentActivity({
      previous: sampled.state,
      frame: sampled.frame,
      observation: sampled.observation,
      occurredAt: sampledAt,
      reason,
    }),
  );
  return { ...accepted.value, state: accepted.state };
}

function recordDecision(
  state: HuntStallIncidentBoundaryState,
  sampledAt: number,
  kind: "initial" | "repeat",
): {
  state: HuntStallIncidentBoundaryState;
  frame: HuntStallIncidentFrame;
  observation: HuntStallIncidentObservation;
  decision: HuntStallIncidentAlertDecision;
  cycle: ReturnType<typeof unwrapDecision>["cycle"];
} {
  const sampled = captureObservation(state, sampledAt);
  const recorded = unwrapDecision(
    recordHuntStallIncidentAlertDecision({
      previous: sampled.state,
      frame: sampled.frame,
      observation: sampled.observation,
      occurredAt: sampledAt,
      kind,
    }),
  );
  return {
    state: recorded.state,
    frame: sampled.frame,
    observation: sampled.observation,
    decision: recorded.decision,
    cycle: recorded.cycle,
  };
}

function unwrapDecision(
  result: ReturnType<typeof recordHuntStallIncidentAlertDecision>,
) {
  const accepted = unwrap(result);
  return {
    state: accepted.state,
    decision: accepted.value.decision,
    cycle: accepted.value.cycle,
  };
}

function unwrap<T>(result: HuntStallIncidentBoundaryResult<T>) {
  if (!result.accepted) {
    throw new Error(`Expected accepted result, received ${result.reason}`);
  }
  return result;
}

function makeContinuity(
  partial: Partial<HuntStallIncidentContinuity> = {},
): HuntStallIncidentContinuity {
  return {
    captureGeneration: 1,
    featureGeneration: 1,
    workerGeneration: 1,
    mode: "manual-experience",
    layoutKey: "layout-a",
    regionRevision: "region-a",
    ...partial,
  };
}

function makeConfiguration(
  partial: Partial<HuntStallIncidentConfiguration> = {},
): HuntStallIncidentConfiguration {
  return {
    enabled: true,
    mode: "manual-experience",
    thresholdSeconds: 30,
    repeatAlertEnabled: true,
    repeatAlertIntervalSeconds: 30,
    repeatAlertMaxCount: 2,
    soundId: "alarm-a",
    featureVolume: 0.7,
    masterVolume: 0.5,
    effectiveVolume: 0.35,
    ...partial,
  };
}

function continuityForReset(
  current: HuntStallIncidentContinuity,
  reason:
    | "layout-changed"
    | "region-changed"
    | "stream-replaced"
    | "profile-replaced"
    | "preset-replaced"
    | "global-disabled"
    | "worker-reset",
): HuntStallIncidentContinuity {
  if (reason === "layout-changed") {
    return { ...current, layoutKey: "layout-b" };
  }
  if (reason === "region-changed") {
    return { ...current, regionRevision: "region-b" };
  }
  if (reason === "stream-replaced") {
    return { ...current, captureGeneration: current.captureGeneration + 1 };
  }
  if (reason === "worker-reset") {
    return { ...current, workerGeneration: current.workerGeneration + 1 };
  }
  return { ...current, featureGeneration: current.featureGeneration + 1 };
}
