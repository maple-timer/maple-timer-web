import { describe, expect, it } from "vitest";
import {
  REMOTE_RECOGNITION_WARM_TRACE_STAGES,
  type RemoteRecognitionWarmTraceFeatureClaim,
  type RemoteRecognitionWarmTraceFeatureOwner,
  type RemoteRecognitionWarmTraceHandle,
  type RemoteRecognitionWarmTraceSharedStage,
  type RemoteRecognitionWarmTraceTarget,
  type RemoteRecognitionWarmTraceBuffWaitAuthorization,
} from "../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import {
  REMOTE_RECOGNITION_WARM_TRACE_LIMITS,
  RemoteRecognitionWarmTraceCollector,
  RemoteRecognitionWarmTraceCollectorError,
} from "./remoteRecognitionWarmTraceCollector";

type Scheduled = {
  callback: () => void;
  delayMs: number;
  cancelled: boolean;
};

function createHarness() {
  let nowMs = 0;
  const scheduled: Scheduled[] = [];
  const collector = new RemoteRecognitionWarmTraceCollector({
    browserClass: "chromium-local-headed",
    monotonicNowMs: () => nowMs,
    scheduleTimeout: (callback, delayMs) => {
      const entry = { callback, delayMs, cancelled: false };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  });
  return {
    collector,
    scheduled,
    setNowMs(value: number) {
      nowMs = value;
    },
    advanceMs(value = 1) {
      nowMs += value;
    },
  };
}

function armAndBegin(
  harness: ReturnType<typeof createHarness>,
  provider: "local" | "remote" = "remote",
  target: RemoteRecognitionWarmTraceTarget = "janus",
  sampledAtMs = 100_000,
) {
  harness.collector.armNextDecisiveTick({ target, provider });
  const handle = harness.collector.beginPhysicalSample();
  expect(handle).not.toBeNull();
  expect(harness.collector.bindPhysicalSample(handle!, sampledAtMs)).toBe(true);
  return handle as RemoteRecognitionWarmTraceHandle;
}

function completeThroughSchedule(
  harness: ReturnType<typeof createHarness>,
  handle: RemoteRecognitionWarmTraceHandle,
): RemoteRecognitionWarmTraceFeatureClaim {
  const sharedStages: readonly RemoteRecognitionWarmTraceSharedStage[] = [
    "captureCropUs",
    "encodeUs",
    "remoteRoundTripUs",
    "responseProjectionUs",
  ];
  for (const stage of sharedStages) {
    harness.advanceMs();
    expect(harness.collector.completeStage(handle, stage)).toBe(true);
  }
  const featureClaim = harness.collector.claimFeatureOwner(handle, "skill");
  expect(featureClaim).not.toBeNull();
  for (const stage of [
    "matcherOcrUs",
    "temporalDecisionUs",
    "scheduleUs",
  ] as const) {
    harness.advanceMs();
    expect(harness.collector.completeFeatureStage(featureClaim!, stage)).toBe(
      true,
    );
  }
  return featureClaim!;
}

function completeBuffThroughTemporal(
  harness: ReturnType<typeof createHarness>,
  target: Extract<
    RemoteRecognitionWarmTraceTarget,
    "union-wealth" | "union-luck" | "potion" | "exp-coupon"
  > = "union-wealth",
  sampledAtMs = 100_000,
) {
  const handle = armAndBegin(harness, "remote", target, sampledAtMs);
  for (const stage of [
    "captureCropUs",
    "encodeUs",
    "remoteRoundTripUs",
    "responseProjectionUs",
  ] as const) {
    harness.advanceMs();
    expect(harness.collector.completeStage(handle, stage)).toBe(true);
  }
  const claim = harness.collector.claimFeatureOwner(handle, "buff-expiry");
  expect(claim).not.toBeNull();
  for (const stage of ["matcherOcrUs", "temporalDecisionUs"] as const) {
    harness.advanceMs();
    expect(harness.collector.completeFeatureStage(claim!, stage)).toBe(true);
  }
  return { handle, claim: claim! };
}

function makeBuffWaitProof(target: "union-wealth" = "union-wealth") {
  return {
    target,
    trackId: "next:unionWealth:r0:c0",
    transition: "pending-to-confirmed" as const,
    acceptedSeconds: 21 as const,
    derivedSeconds: 21 as const,
    sampledAtMs: 100_000,
    detectedAtMs: 100_000,
    expiresAtMs: 121_000,
    alertLeadSeconds: 20 as const,
    alertedAtMs: null,
  };
}

function makeBuffScheduleDeclaration() {
  return {
    trackId: "next:unionWealth:r0:c0",
    sampledAtMs: 100_000,
    dueAtMs: 101_000,
    delayMs: 1_000,
  };
}

describe("RemoteRecognitionWarmTraceCollector", () => {
  it("ignores ordinary physical samples until explicitly armed", () => {
    const harness = createHarness();

    expect(harness.collector.beginPhysicalSample()).toBeNull();
    expect(harness.collector.snapshot()).toEqual([]);
  });

  it("records all eight monotonic stage durations only after playback starts", () => {
    const harness = createHarness();
    const handle = armAndBegin(harness);
    const featureClaim = completeThroughSchedule(harness, handle);

    expect(harness.collector.snapshot()).toEqual([]);
    harness.advanceMs();
    expect(harness.collector.completeFeature(featureClaim)).toBe(true);

    expect(harness.collector.snapshot()).toEqual([
      expect.objectContaining({
        ordinal: 1,
        target: "janus",
        provider: "remote",
        outcome: "completed",
        terminalStage: "playbackAcceptanceUs",
        totalUs: 8_000,
        stageDurationsUs: Object.fromEntries(
          REMOTE_RECOGNITION_WARM_TRACE_STAGES.map((stage) => [stage, 1_000]),
        ),
      }),
    ]);
    expect(harness.collector.completeFeature(featureClaim)).toBe(false);
  });

  it("supports explicit zero-duration stages for local parity", () => {
    const harness = createHarness();
    const handle = armAndBegin(harness, "local");
    harness.advanceMs();
    expect(harness.collector.completeStage(handle, "captureCropUs")).toBe(true);
    expect(harness.collector.completeZeroStage(handle, "encodeUs")).toBe(true);
    expect(
      harness.collector.completeZeroStage(handle, "remoteRoundTripUs"),
    ).toBe(true);
    harness.advanceMs();
    expect(
      harness.collector.completeStage(handle, "responseProjectionUs"),
    ).toBe(true);
    const featureClaim = harness.collector.claimFeatureOwner(handle, "skill");
    expect(featureClaim).not.toBeNull();
    for (const stage of [
      "matcherOcrUs",
      "temporalDecisionUs",
      "scheduleUs",
    ] as const) {
      harness.advanceMs();
      expect(harness.collector.completeFeatureStage(featureClaim!, stage)).toBe(
        true,
      );
    }
    harness.advanceMs();
    expect(harness.collector.completeFeature(featureClaim!)).toBe(true);

    expect(harness.collector.snapshot()[0]).toMatchObject({
      provider: "local",
      outcome: "completed",
      stageDurationsUs: {
        captureCropUs: 1_000,
        encodeUs: 0,
        remoteRoundTripUs: 0,
      },
    });
  });

  it("excludes only the scheduler-authorized remaining Buff wait and keeps overshoot active", () => {
    const harness = createHarness();
    const { claim } = completeBuffThroughTemporal(harness);
    const temporalPort = harness.collector.getBuffExpiryTemporalPort();
    const schedulerPort = harness.collector.getBuffExpirySchedulerPort();

    expect(Object.isFrozen(temporalPort)).toBe(true);
    expect(Object.isFrozen(schedulerPort)).toBe(true);
    expect(Object.keys(temporalPort)).toEqual([
      "authorizeBuffExpiryPlannedWait",
    ]);
    expect(Object.keys(schedulerPort)).toEqual([
      "prepareBuffExpiryPlannedWait",
      "commitBuffExpiryPlannedWait",
      "resumeBuffExpiryPlannedWait",
      "completeBuffExpiryPlannedWait",
      "terminateBuffExpiryPlannedWait",
    ]);

    const authorization = temporalPort.authorizeBuffExpiryPlannedWait(
      claim,
      makeBuffWaitProof(),
    );
    expect(authorization).not.toBeNull();
    expect(harness.collector.completeFeatureStage(claim, "scheduleUs")).toBe(
      false,
    );
    expect(harness.collector.snapshot()).toEqual([]);

    const preparation = schedulerPort.prepareBuffExpiryPlannedWait(
      authorization!,
      makeBuffScheduleDeclaration(),
    );
    expect(preparation).not.toBeNull();
    harness.advanceMs();
    const scheduledWait = schedulerPort.commitBuffExpiryPlannedWait(
      preparation!,
    );
    expect(scheduledWait).not.toBeNull();
    expect(harness.scheduled[1]?.cancelled).toBe(true);
    expect(harness.scheduled[2]?.delayMs).toBe(
      REMOTE_RECOGNITION_WARM_TRACE_LIMITS.hardWallTimeoutMs,
    );
    expect(harness.scheduled[3]?.delayMs).toBe(15_992);
    harness.scheduled[1]?.callback();
    expect(harness.collector.snapshot()).toEqual([]);

    harness.advanceMs(999);
    expect(schedulerPort.resumeBuffExpiryPlannedWait(scheduledWait!)).toBe(
      true,
    );
    harness.advanceMs(5);
    expect(schedulerPort.completeBuffExpiryPlannedWait(scheduledWait!)).toBe(
      true,
    );

    expect(harness.collector.snapshot()).toEqual([
      expect.objectContaining({
        target: "union-wealth",
        outcome: "completed",
        terminalStage: "playbackAcceptanceUs",
        waitMode: "scheduler-planned-excluded",
        scheduledWaitUs: 1_000_000,
        excludedWaitUs: 999_000,
        totalUs: 12_000,
        wallTotalUs: 1_011_000,
        stageDurationsUs: expect.objectContaining({
          scheduleUs: 1_000,
          playbackAcceptanceUs: 5_000,
        }),
      }),
    ]);
    expect(schedulerPort.resumeBuffExpiryPlannedWait(scheduledWait!)).toBe(
      false,
    );
    expect(schedulerPort.completeBuffExpiryPlannedWait(scheduledWait!)).toBe(
      false,
    );
  });

  it("settles early Buff cancellation without discounting unelapsed wait", () => {
    const harness = createHarness();
    const { claim } = completeBuffThroughTemporal(harness);
    const temporalPort = harness.collector.getBuffExpiryTemporalPort();
    const schedulerPort = harness.collector.getBuffExpirySchedulerPort();
    const authorization = temporalPort.authorizeBuffExpiryPlannedWait(
      claim,
      makeBuffWaitProof(),
    );
    const preparation = schedulerPort.prepareBuffExpiryPlannedWait(
      authorization!,
      makeBuffScheduleDeclaration(),
    );
    harness.advanceMs();
    const scheduledWait = schedulerPort.commitBuffExpiryPlannedWait(
      preparation!,
    );
    harness.advanceMs(493);

    expect(
      schedulerPort.terminateBuffExpiryPlannedWait(scheduledWait!, "cancelled"),
    ).toBe(true);
    expect(harness.collector.snapshot()[0]).toMatchObject({
      outcome: "cancelled",
      terminalStage: "playbackAcceptanceUs",
      waitMode: "scheduler-planned-excluded",
      scheduledWaitUs: 1_000_000,
      excludedWaitUs: 493_000,
      totalUs: 7_000,
      wallTotalUs: 500_000,
      stageDurationsUs: { playbackAcceptanceUs: 0 },
    });
  });

  it("fails an early Buff resume and preserves post-due timeout as active latency", () => {
    const early = createHarness();
    const earlyTemporal = completeBuffThroughTemporal(early);
    const earlyTemporalPort = early.collector.getBuffExpiryTemporalPort();
    const earlySchedulerPort = early.collector.getBuffExpirySchedulerPort();
    const earlyAuthorization = earlyTemporalPort.authorizeBuffExpiryPlannedWait(
      earlyTemporal.claim,
      makeBuffWaitProof(),
    );
    const earlyPreparation = earlySchedulerPort.prepareBuffExpiryPlannedWait(
      earlyAuthorization!,
      makeBuffScheduleDeclaration(),
    );
    early.advanceMs();
    const earlyWait = earlySchedulerPort.commitBuffExpiryPlannedWait(
      earlyPreparation!,
    );
    early.advanceMs(998);
    expect(earlySchedulerPort.resumeBuffExpiryPlannedWait(earlyWait!)).toBe(
      false,
    );
    expect(early.collector.snapshot()[0]).toMatchObject({
      outcome: "failed",
      excludedWaitUs: 998_000,
      stageDurationsUs: { playbackAcceptanceUs: 0 },
    });

    const overdue = createHarness();
    const overdueTemporal = completeBuffThroughTemporal(overdue);
    const overdueTemporalPort = overdue.collector.getBuffExpiryTemporalPort();
    const overdueSchedulerPort = overdue.collector.getBuffExpirySchedulerPort();
    const overdueAuthorization =
      overdueTemporalPort.authorizeBuffExpiryPlannedWait(
        overdueTemporal.claim,
        makeBuffWaitProof(),
      );
    const overduePreparation =
      overdueSchedulerPort.prepareBuffExpiryPlannedWait(
        overdueAuthorization!,
        makeBuffScheduleDeclaration(),
      );
    overdue.advanceMs();
    overdueSchedulerPort.commitBuffExpiryPlannedWait(overduePreparation!);
    overdue.advanceMs(15_992);
    overdue.scheduled[3]?.callback();
    expect(overdue.collector.snapshot()[0]).toMatchObject({
      outcome: "timed-out",
      excludedWaitUs: 999_000,
      totalUs: 15_000_000,
      wallTotalUs: 15_999_000,
      stageDurationsUs: { playbackAcceptanceUs: 14_993_000 },
    });
  });

  it("rejects forged, replayed, wrong-proof, and mismatched Buff wait capabilities", () => {
    const forged = createHarness();
    completeBuffThroughTemporal(forged);
    expect(
      forged.collector
        .getBuffExpirySchedulerPort()
        .prepareBuffExpiryPlannedWait(
          Object.freeze({}) as RemoteRecognitionWarmTraceBuffWaitAuthorization,
          makeBuffScheduleDeclaration(),
        ),
    ).toBeNull();
    expect(forged.collector.snapshot()).toEqual([]);

    const mismatch = createHarness();
    const mismatchTemporal = completeBuffThroughTemporal(mismatch);
    const mismatchTemporalPort = mismatch.collector.getBuffExpiryTemporalPort();
    const mismatchSchedulerPort =
      mismatch.collector.getBuffExpirySchedulerPort();
    const authorization = mismatchTemporalPort.authorizeBuffExpiryPlannedWait(
      mismatchTemporal.claim,
      makeBuffWaitProof(),
    );
    expect(
      mismatchSchedulerPort.prepareBuffExpiryPlannedWait(authorization!, {
        ...makeBuffScheduleDeclaration(),
        delayMs: 999,
      }),
    ).toBeNull();
    expect(mismatch.collector.snapshot()[0]).toMatchObject({
      outcome: "failed",
      terminalStage: "scheduleUs",
      waitMode: "none",
    });

    const wrongProof = createHarness();
    const wrongProofTemporal = completeBuffThroughTemporal(wrongProof);
    expect(
      wrongProof.collector
        .getBuffExpiryTemporalPort()
        .authorizeBuffExpiryPlannedWait(wrongProofTemporal.claim, {
          ...makeBuffWaitProof(),
          acceptedSeconds: 22,
        } as never),
    ).toBeNull();
    expect(wrongProof.collector.snapshot()[0]).toMatchObject({
      outcome: "failed",
      terminalStage: "scheduleUs",
    });

    const replay = createHarness();
    const replayTemporal = completeBuffThroughTemporal(replay);
    const replayTemporalPort = replay.collector.getBuffExpiryTemporalPort();
    const replaySchedulerPort = replay.collector.getBuffExpirySchedulerPort();
    const replayAuthorization =
      replayTemporalPort.authorizeBuffExpiryPlannedWait(
        replayTemporal.claim,
        makeBuffWaitProof(),
      );
    const replayPreparation = replaySchedulerPort.prepareBuffExpiryPlannedWait(
      replayAuthorization!,
      makeBuffScheduleDeclaration(),
    );
    expect(
      replaySchedulerPort.prepareBuffExpiryPlannedWait(
        replayAuthorization!,
        makeBuffScheduleDeclaration(),
      ),
    ).toBeNull();
    replay.advanceMs();
    const replayWait = replaySchedulerPort.commitBuffExpiryPlannedWait(
      replayPreparation!,
    );
    expect(
      replaySchedulerPort.commitBuffExpiryPlannedWait(replayPreparation!),
    ).toBeNull();

    const other = createHarness();
    completeBuffThroughTemporal(other);
    expect(
      other.collector
        .getBuffExpirySchedulerPort()
        .resumeBuffExpiryPlannedWait(replayWait!),
    ).toBe(false);
    replay.advanceMs(999);
    expect(replaySchedulerPort.resumeBuffExpiryPlannedWait(replayWait!)).toBe(
      true,
    );
    replay.advanceMs();
    expect(replaySchedulerPort.completeBuffExpiryPlannedWait(replayWait!)).toBe(
      true,
    );
  });

  it("binds Buff authorization to the current physical scheduler tick", () => {
    const stale = createHarness();
    const staleTemporal = completeBuffThroughTemporal(
      stale,
      "union-wealth",
      101_000,
    );

    expect(
      stale.collector
        .getBuffExpiryTemporalPort()
        .authorizeBuffExpiryPlannedWait(
          staleTemporal.claim,
          makeBuffWaitProof(),
        ),
    ).toBeNull();
    expect(stale.collector.snapshot()[0]).toMatchObject({
      outcome: "failed",
      terminalStage: "scheduleUs",
    });

    const rebound = createHarness();
    rebound.collector.armNextDecisiveTick({
      target: "union-wealth",
      provider: "remote",
    });
    const handle = rebound.collector.beginPhysicalSample();
    expect(handle).not.toBeNull();
    expect(rebound.collector.bindPhysicalSample(handle!, 100_000)).toBe(true);
    expect(rebound.collector.bindPhysicalSample(handle!, 100_000)).toBe(true);
    expect(rebound.collector.bindPhysicalSample(handle!, 101_000)).toBe(false);
    expect(rebound.collector.snapshot()[0]).toMatchObject({
      outcome: "failed",
      terminalStage: "captureCropUs",
    });
  });

  it("drops an unmeasurable scheduled terminal record and releases the collector", () => {
    const harness = createHarness();
    const { claim } = completeBuffThroughTemporal(harness);
    const temporalPort = harness.collector.getBuffExpiryTemporalPort();
    const schedulerPort = harness.collector.getBuffExpirySchedulerPort();
    const authorization = temporalPort.authorizeBuffExpiryPlannedWait(
      claim,
      makeBuffWaitProof(),
    );
    const preparation = schedulerPort.prepareBuffExpiryPlannedWait(
      authorization!,
      makeBuffScheduleDeclaration(),
    );
    harness.advanceMs();
    expect(
      schedulerPort.commitBuffExpiryPlannedWait(preparation!),
    ).not.toBeNull();

    harness.setNowMs(Number.NaN);
    expect(harness.collector.cancelOpen("cancelled")).toBe(true);
    expect(harness.collector.snapshot()).toEqual([]);

    harness.setNowMs(200_000);
    expect(() =>
      harness.collector.armNextDecisiveTick({
        target: "janus",
        provider: "remote",
      }),
    ).not.toThrow();
  });

  it("turns invalid order and an invalid clock into bounded failed records", () => {
    const wrongOrder = createHarness();
    const wrongOrderHandle = armAndBegin(wrongOrder);

    expect(
      wrongOrder.collector.completeStage(wrongOrderHandle, "encodeUs"),
    ).toBe(false);
    expect(wrongOrder.collector.snapshot()[0]).toMatchObject({
      outcome: "failed",
      terminalStage: "collector",
      totalUs: 0,
    });

    const invalidClock = createHarness();
    const invalidClockHandle = armAndBegin(invalidClock);
    invalidClock.setNowMs(Number.NaN);
    expect(
      invalidClock.collector.completeStage(invalidClockHandle, "captureCropUs"),
    ).toBe(false);
    expect(invalidClock.collector.snapshot()[0]).toMatchObject({
      outcome: "failed",
      terminalStage: "collector",
    });
  });

  it("rejects synthetic zero transport on remote series", () => {
    const harness = createHarness();
    const handle = armAndBegin(harness, "remote");
    harness.advanceMs();
    harness.collector.completeStage(handle, "captureCropUs");

    expect(harness.collector.completeZeroStage(handle, "encodeUs")).toBe(false);
    expect(harness.collector.snapshot()[0]).toMatchObject({
      outcome: "failed",
      terminalStage: "captureCropUs",
      totalUs: 1_000,
    });
  });

  it("records the failed terminal stage and gives the active deadline precedence", () => {
    const playbackFailure = createHarness();
    const playbackHandle = armAndBegin(playbackFailure);
    const playbackClaim = completeThroughSchedule(
      playbackFailure,
      playbackHandle,
    );
    playbackFailure.advanceMs();

    expect(
      playbackFailure.collector.terminateFeatureStage(
        playbackClaim,
        "playbackAcceptanceUs",
        "failed",
      ),
    ).toBe(true);
    expect(playbackFailure.collector.snapshot()[0]).toMatchObject({
      outcome: "failed",
      terminalStage: "playbackAcceptanceUs",
      totalUs: 8_000,
    });

    const deadline = createHarness();
    const deadlineHandle = armAndBegin(deadline);
    deadline.setNowMs(REMOTE_RECOGNITION_WARM_TRACE_LIMITS.activeTimeoutMs);
    expect(
      deadline.collector.completeStage(deadlineHandle, "captureCropUs"),
    ).toBe(false);
    expect(deadline.collector.snapshot()[0]).toMatchObject({
      outcome: "timed-out",
      terminalStage: "captureCropUs",
      totalUs: 15_000_000,
    });
  });

  it("records arm timeout, partial terminal outcome, and dispose cancellation", () => {
    const armed = createHarness();
    armed.collector.armNextDecisiveTick({
      target: "janus",
      provider: "remote",
    });
    expect(armed.scheduled[0].delayMs).toBe(
      REMOTE_RECOGNITION_WARM_TRACE_LIMITS.armTimeoutMs,
    );
    armed.scheduled[0].callback();
    expect(armed.collector.snapshot()[0]).toMatchObject({
      outcome: "timed-out",
      terminalStage: "collector",
    });

    const partial = createHarness();
    const partialHandle = armAndBegin(partial);
    partial.advanceMs(2);
    partial.collector.completeStage(partialHandle, "captureCropUs");
    expect(partial.collector.terminate(partialHandle, "dropped")).toBe(true);
    expect(partial.collector.snapshot()[0]).toMatchObject({
      outcome: "dropped",
      terminalStage: "captureCropUs",
      totalUs: 2_000,
    });

    const disposed = createHarness();
    armAndBegin(disposed);
    disposed.collector.dispose();
    expect(disposed.collector.snapshot()[0]).toMatchObject({
      outcome: "cancelled",
      terminalStage: "captureCropUs",
    });
    expect(() =>
      disposed.collector.armNextDecisiveTick({
        target: "janus",
        provider: "remote",
      }),
    ).toThrowError(
      expect.objectContaining<
        Partial<RemoteRecognitionWarmTraceCollectorError>
      >({
        code: "trace-collector-closed",
      }),
    );
  });

  it("never throws from feature-facing calls with unknown handles or outcomes", () => {
    const harness = createHarness();
    const unknown = Object.freeze({}) as RemoteRecognitionWarmTraceHandle;

    expect(() =>
      harness.collector.completeStage(unknown, "captureCropUs"),
    ).not.toThrow();
    expect(() =>
      harness.collector.completeZeroStage(
        unknown,
        "captureCropUs" as Parameters<
          typeof harness.collector.completeZeroStage
        >[1],
      ),
    ).not.toThrow();
    expect(() =>
      harness.collector.terminate(
        unknown,
        "invalid" as Parameters<typeof harness.collector.terminate>[1],
      ),
    ).not.toThrow();
    expect(harness.collector.snapshot()).toEqual([]);
  });

  it("fails closed when a cast caller uses completed as a terminal outcome", () => {
    const stageHarness = createHarness();
    const stageHandle = armAndBegin(stageHarness);
    expect(
      stageHarness.collector.terminateStage(
        stageHandle,
        "captureCropUs",
        "completed" as Parameters<
          typeof stageHarness.collector.terminateStage
        >[2],
      ),
    ).toBe(false);
    expect(stageHarness.collector.snapshot()).toEqual([
      expect.objectContaining({
        outcome: "failed",
        terminalStage: "collector",
      }),
    ]);

    const cancelHarness = createHarness();
    armAndBegin(cancelHarness);
    expect(
      cancelHarness.collector.cancelOpen(
        "completed" as Parameters<typeof cancelHarness.collector.cancelOpen>[0],
      ),
    ).toBe(false);
    expect(cancelHarness.collector.snapshot()).toEqual([
      expect.objectContaining({
        outcome: "failed",
        terminalStage: "collector",
      }),
    ]);
  });

  it("records the current stage when an active trace times out", () => {
    const harness = createHarness();
    const handle = armAndBegin(harness);
    harness.advanceMs(2);
    expect(harness.collector.completeStage(handle, "captureCropUs")).toBe(true);
    harness.advanceMs(3);

    expect(harness.scheduled[1]?.delayMs).toBe(
      REMOTE_RECOGNITION_WARM_TRACE_LIMITS.activeTimeoutMs,
    );
    harness.scheduled[1]?.callback();
    expect(harness.collector.snapshot()).toEqual([]);
    harness.setNowMs(REMOTE_RECOGNITION_WARM_TRACE_LIMITS.activeTimeoutMs);
    harness.scheduled[3]?.callback();

    expect(harness.collector.snapshot()).toEqual([
      expect.objectContaining({
        outcome: "timed-out",
        terminalStage: "encodeUs",
        stageDurationsUs: expect.objectContaining({
          captureCropUs: 2_000,
          encodeUs: 14_998_000,
        }),
      }),
    ]);
  });

  it("replaces only a physical sample whose capture stage is still pending", () => {
    const pending = createHarness();
    const pendingHandle = armAndBegin(pending);
    pending.advanceMs(2);

    expect(pending.collector.replacePendingPhysicalSample(pendingHandle)).toBe(
      true,
    );
    expect(pending.collector.snapshot()).toEqual([
      expect.objectContaining({
        outcome: "replaced",
        terminalStage: "captureCropUs",
        totalUs: 2_000,
      }),
    ]);

    const progressed = createHarness();
    const progressedHandle = armAndBegin(progressed);
    progressed.advanceMs();
    expect(
      progressed.collector.completeStage(progressedHandle, "captureCropUs"),
    ).toBe(true);
    expect(
      progressed.collector.replacePendingPhysicalSample(progressedHandle),
    ).toBe(false);
    expect(progressed.collector.snapshot()).toEqual([]);
    progressed.advanceMs();
    expect(
      progressed.collector.completeStage(progressedHandle, "encodeUs"),
    ).toBe(true);
  });

  it("preserves feature stages until the pre-armed target owner claims them", () => {
    const harness = createHarness();
    const handle = armAndBegin(harness);
    for (const stage of [
      "captureCropUs",
      "encodeUs",
      "remoteRoundTripUs",
      "responseProjectionUs",
    ] as const) {
      harness.advanceMs();
      expect(harness.collector.completeStage(handle, stage)).toBe(true);
    }

    expect(
      harness.collector.claimFeatureOwner(handle, "buff-expiry"),
    ).toBeNull();
    expect(
      harness.collector.completeStage(
        handle,
        "matcherOcrUs" as Parameters<typeof harness.collector.completeStage>[1],
      ),
    ).toBe(false);
    expect(
      harness.collector.terminateStage(
        handle,
        "matcherOcrUs" as Parameters<
          typeof harness.collector.terminateStage
        >[1],
        "suppressed",
      ),
    ).toBe(false);
    expect(harness.collector.snapshot()).toEqual([]);
    expect(harness.collector.getSeries(handle)).not.toBeNull();

    const featureClaim = harness.collector.claimFeatureOwner(handle, "skill");
    expect(featureClaim).not.toBeNull();
    expect(harness.collector.claimFeatureOwner(handle, "skill")).toBeNull();
    const forgedClaim = Object.freeze(
      {},
    ) as RemoteRecognitionWarmTraceFeatureClaim;
    expect(
      harness.collector.completeFeatureStage(forgedClaim, "matcherOcrUs"),
    ).toBe(false);
    expect(
      harness.collector.terminateFeatureStage(
        forgedClaim,
        "matcherOcrUs",
        "suppressed",
      ),
    ).toBe(false);
    expect(
      harness.collector.completeStage(handle, "responseProjectionUs"),
    ).toBe(false);
    expect(harness.collector.completeZeroStage(handle, "encodeUs")).toBe(false);
    expect(
      harness.collector.terminateStage(
        handle,
        "responseProjectionUs",
        "failed",
      ),
    ).toBe(false);
    expect(harness.collector.cancelSharedOpen("fallback")).toBe(false);
    expect(harness.collector.snapshot()).toEqual([]);
    expect(harness.collector.getSeries(handle)).not.toBeNull();
    harness.advanceMs();
    expect(
      harness.collector.completeFeatureStage(featureClaim!, "matcherOcrUs"),
    ).toBe(true);
  });

  it.each([
    ["janus", "skill"],
    ["hologram-graffiti-barrier", "skill"],
    ["fountain", "skill"],
    ["yein", "skill"],
    ["union-wealth", "buff-expiry"],
    ["union-luck", "buff-expiry"],
    ["potion", "buff-expiry"],
    ["exp-coupon", "buff-expiry"],
    ["special-core", "special-core"],
  ] as const)(
    "allows only the mapped owner to claim %s",
    (target, expectedOwner) => {
      const harness = createHarness();
      const handle = armAndBegin(harness, "remote", target);
      for (const stage of [
        "captureCropUs",
        "encodeUs",
        "remoteRoundTripUs",
        "responseProjectionUs",
      ] as const) {
        harness.advanceMs();
        expect(harness.collector.completeStage(handle, stage)).toBe(true);
      }
      for (const owner of [
        "skill",
        "buff-expiry",
        "special-core",
      ] as const satisfies readonly RemoteRecognitionWarmTraceFeatureOwner[]) {
        if (owner !== expectedOwner) {
          expect(harness.collector.claimFeatureOwner(handle, owner)).toBeNull();
        }
      }
      expect(
        harness.collector.claimFeatureOwner(handle, expectedOwner),
      ).not.toBeNull();
      expect(harness.collector.snapshot()).toEqual([]);
      expect(harness.collector.cancelOpen("cancelled")).toBe(true);
    },
  );

  it("contains invalid, synchronous, and throwing scheduler behavior", () => {
    expect(
      () =>
        new RemoteRecognitionWarmTraceCollector({
          browserClass: "chromium-local-headed",
          scheduleTimeout: 1 as unknown as NonNullable<
            ConstructorParameters<
              typeof RemoteRecognitionWarmTraceCollector
            >[0]["scheduleTimeout"]
          >,
        }),
    ).toThrowError(
      expect.objectContaining<
        Partial<RemoteRecognitionWarmTraceCollectorError>
      >({
        code: "trace-invalid-options",
      }),
    );

    const invalidReturn = new RemoteRecognitionWarmTraceCollector({
      browserClass: "chromium-local-headed",
      scheduleTimeout: (() => 1) as unknown as NonNullable<
        ConstructorParameters<
          typeof RemoteRecognitionWarmTraceCollector
        >[0]["scheduleTimeout"]
      >,
    });
    expect(() =>
      invalidReturn.armNextDecisiveTick({
        target: "janus",
        provider: "remote",
      }),
    ).toThrowError(
      expect.objectContaining<
        Partial<RemoteRecognitionWarmTraceCollectorError>
      >({
        code: "trace-invalid-options",
      }),
    );
    expect(invalidReturn.snapshot()).toEqual([]);

    let scheduleCount = 0;
    const synchronousActive = new RemoteRecognitionWarmTraceCollector({
      browserClass: "chromium-local-headed",
      monotonicNowMs: () => 0,
      scheduleTimeout: (callback) => {
        scheduleCount += 1;
        if (scheduleCount === 2) {
          callback();
        }
        return () => {
          throw new Error("cancel-failed");
        };
      },
    });
    synchronousActive.armNextDecisiveTick({
      target: "janus",
      provider: "remote",
    });
    expect(() => synchronousActive.beginPhysicalSample()).not.toThrow();
    expect(synchronousActive.beginPhysicalSample()).toBeNull();
    expect(synchronousActive.snapshot()).toEqual([
      expect.objectContaining({ outcome: "failed" }),
    ]);
  });

  it("enforces the completed-series cap before allocating another ordinal", () => {
    const harness = createHarness();
    for (
      let index = 0;
      index < REMOTE_RECOGNITION_WARM_TRACE_LIMITS.completedRecordsPerSeries;
      index += 1
    ) {
      const handle = armAndBegin(harness);
      const featureClaim = completeThroughSchedule(harness, handle);
      harness.advanceMs();
      harness.collector.completeFeature(featureClaim);
    }

    expect(() =>
      harness.collector.armNextDecisiveTick({
        target: "janus",
        provider: "remote",
      }),
    ).toThrowError(
      expect.objectContaining<
        Partial<RemoteRecognitionWarmTraceCollectorError>
      >({
        code: "trace-record-limit",
      }),
    );
    expect(harness.collector.snapshot()).toHaveLength(
      REMOTE_RECOGNITION_WARM_TRACE_LIMITS.completedRecordsPerSeries,
    );
  });
});
