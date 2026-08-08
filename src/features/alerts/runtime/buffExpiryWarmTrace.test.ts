import { describe, expect, it, vi } from "vitest";
import {
  attachRemoteRecognitionWarmTraceHandle,
  type RemoteRecognitionWarmTraceBuffScheduledWait,
  type RemoteRecognitionWarmTraceBuffSchedulerPort,
  type RemoteRecognitionWarmTraceBuffTemporalPort,
  type RemoteRecognitionWarmTraceBuffWaitAuthorization,
  type RemoteRecognitionWarmTraceBuffWaitPreparation,
  type RemoteRecognitionWarmTraceFeatureClaim,
  type RemoteRecognitionWarmTraceFeaturePort,
  type RemoteRecognitionWarmTraceHandle,
  type RemoteRecognitionWarmTraceTarget,
} from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import type {
  BuffExpiryPrecisionConfirmedTransition,
  BuffExpiryTrackedBuff,
} from "../../../domain/buff-expiry/precisionTrackingTypes";
import type { BuffExpiryAlertConfig } from "../../../types";
import {
  abandonBuffExpiryWarmTracePreparation,
  authorizeBuffExpiryWarmTraceWait,
  claimBuffExpiryWarmTrace,
  commitBuffExpiryWarmTraceWait,
  completeBuffExpiryWarmTraceMatcher,
  completeBuffExpiryWarmTracePlayback,
  prepareBuffExpiryWarmTraceWait,
  resumeBuffExpiryWarmTraceWait,
  terminateBuffExpiryWarmTraceCandidate,
  terminateBuffExpiryWarmTracePlayback,
  terminateBuffExpiryWarmTraceWaitSlot,
  type BuffExpiryWarmTraceClaim,
  type BuffExpiryWarmTraceScheduleCandidate,
  type BuffExpiryWarmTraceWaitSlot,
} from "./buffExpiryWarmTrace";

const SAMPLED_AT = 100_000;
const TRACK_ID = "next:unionWealth:r0:c0";

function createConfig(
  overrides: Partial<BuffExpiryAlertConfig> = {},
): BuffExpiryAlertConfig {
  return {
    enabled: true,
    alertLeadSeconds: 20,
    selectedBuffIds: [],
    selectedPrecisionTargetGroups: ["unionWealth"],
    soundId: "default",
    volume: 0.8,
    ...overrides,
  };
}

function createTransition(
  overrides: Partial<BuffExpiryPrecisionConfirmedTransition> = {},
): BuffExpiryPrecisionConfirmedTransition {
  return {
    transition: "pending-to-confirmed",
    group: "unionWealth",
    trackId: TRACK_ID,
    acceptedSeconds: 21,
    observedAt: SAMPLED_AT,
    derivedSeconds: 21,
    detectedAt: SAMPLED_AT,
    expiresAt: SAMPLED_AT + 21_000,
    alertedAt: null,
    ...overrides,
  };
}

function createTrack(
  overrides: Partial<BuffExpiryTrackedBuff> = {},
): BuffExpiryTrackedBuff {
  return {
    id: TRACK_ID,
    buffId: "next:unionWealth",
    name: "유니온의 부",
    box: { x: 0, y: 0, width: 32, height: 32, confidence: 0.99 },
    detectedSeconds: 21,
    detectedAt: SAMPLED_AT,
    expiresAt: SAMPLED_AT + 21_000,
    lastSeenAt: SAMPLED_AT,
    alertedAt: null,
    score: 0.99,
    ...overrides,
  };
}

function createPortFixture(
  target: RemoteRecognitionWarmTraceTarget = "union-wealth",
) {
  const handle = {} as RemoteRecognitionWarmTraceHandle;
  const featureClaim = {} as RemoteRecognitionWarmTraceFeatureClaim;
  const authorization = {} as RemoteRecognitionWarmTraceBuffWaitAuthorization;
  const preparation = {} as RemoteRecognitionWarmTraceBuffWaitPreparation;
  const scheduledWait = {} as RemoteRecognitionWarmTraceBuffScheduledWait;
  const carrier = {};
  expect(attachRemoteRecognitionWarmTraceHandle(carrier, handle)).toBe(true);

  const getSeries = vi.fn(() => ({
    target,
    provider: "remote" as const,
    browserClass: "chromium-local-headed" as const,
    loadTier: "v1-owner-one" as const,
  }));
  const claimFeatureOwner = vi.fn(() => featureClaim);
  const completeFeatureStage = vi.fn(() => true);
  const terminateFeatureStage = vi.fn(() => true);
  const terminateFeatureCurrentStage = vi.fn(() => true);
  const completeFeature = vi.fn(() => true);
  const authorizeBuffExpiryPlannedWait = vi.fn(() => authorization);
  const prepareBuffExpiryPlannedWait = vi.fn(() => preparation);
  const commitBuffExpiryPlannedWait = vi.fn(() => scheduledWait);
  const resumeBuffExpiryPlannedWait = vi.fn(() => true);
  const completeBuffExpiryPlannedWait = vi.fn(() => true);
  const terminateBuffExpiryPlannedWait = vi.fn(() => true);

  const featurePort: RemoteRecognitionWarmTraceFeaturePort = {
    getSeries,
    claimFeatureOwner,
    completeFeatureStage,
    terminateFeatureStage,
    terminateFeatureCurrentStage,
    completeFeature,
  };
  const temporalPort: RemoteRecognitionWarmTraceBuffTemporalPort = {
    authorizeBuffExpiryPlannedWait,
  };
  const schedulerPort: RemoteRecognitionWarmTraceBuffSchedulerPort = {
    prepareBuffExpiryPlannedWait,
    commitBuffExpiryPlannedWait,
    resumeBuffExpiryPlannedWait,
    completeBuffExpiryPlannedWait,
    terminateBuffExpiryPlannedWait,
  };

  return {
    carrier,
    handle,
    featureClaim,
    authorization,
    preparation,
    scheduledWait,
    featurePort,
    temporalPort,
    schedulerPort,
    mocks: {
      getSeries,
      claimFeatureOwner,
      completeFeatureStage,
      terminateFeatureStage,
      terminateFeatureCurrentStage,
      completeFeature,
      authorizeBuffExpiryPlannedWait,
      prepareBuffExpiryPlannedWait,
      commitBuffExpiryPlannedWait,
      resumeBuffExpiryPlannedWait,
      completeBuffExpiryPlannedWait,
      terminateBuffExpiryPlannedWait,
    },
  };
}

function claimCanonical(
  fixture: ReturnType<typeof createPortFixture>,
  config = createConfig(),
): BuffExpiryWarmTraceClaim | null {
  return claimBuffExpiryWarmTrace({
    carrier: fixture.carrier,
    config,
    featurePort: fixture.featurePort,
    temporalPort: fixture.temporalPort,
    schedulerPort: fixture.schedulerPort,
  });
}

function authorizeCanonical(
  fixture: ReturnType<typeof createPortFixture>,
): BuffExpiryWarmTraceScheduleCandidate {
  const warmTrace = claimCanonical(fixture);
  expect(warmTrace).not.toBeNull();
  expect(completeBuffExpiryWarmTraceMatcher(warmTrace)).toBe(true);
  const candidate = authorizeBuffExpiryWarmTraceWait({
    warmTrace,
    confirmedTransitions: [createTransition()],
    tracks: [createTrack()],
    sampledAt: SAMPLED_AT,
  });
  expect(candidate).not.toBeNull();
  return candidate!;
}

describe("buffExpiryWarmTrace", () => {
  it("claims the canonical union-wealth trace and authorizes its exact due-now transition", () => {
    const fixture = createPortFixture();
    const warmTrace = claimCanonical(fixture);

    expect(warmTrace).toMatchObject({
      target: "union-wealth",
      group: "unionWealth",
      phase: "matcher",
    });
    expect(fixture.mocks.claimFeatureOwner).toHaveBeenCalledWith(
      fixture.handle,
      "buff-expiry",
    );
    expect(completeBuffExpiryWarmTraceMatcher(warmTrace)).toBe(true);

    const candidate = authorizeBuffExpiryWarmTraceWait({
      warmTrace,
      confirmedTransitions: [createTransition()],
      tracks: [createTrack()],
      sampledAt: SAMPLED_AT,
    });

    expect(candidate).toMatchObject({
      target: "union-wealth",
      trackId: TRACK_ID,
      sampledAtMs: SAMPLED_AT,
      dueAtMs: SAMPLED_AT + 1_000,
      active: true,
    });
    expect(fixture.mocks.completeFeatureStage.mock.calls).toEqual([
      [fixture.featureClaim, "matcherOcrUs"],
      [fixture.featureClaim, "temporalDecisionUs"],
    ]);
    expect(fixture.mocks.authorizeBuffExpiryPlannedWait).toHaveBeenCalledWith(
      fixture.featureClaim,
      {
        target: "union-wealth",
        trackId: TRACK_ID,
        transition: "pending-to-confirmed",
        acceptedSeconds: 21,
        derivedSeconds: 21,
        sampledAtMs: SAMPLED_AT,
        detectedAtMs: SAMPLED_AT,
        expiresAtMs: SAMPLED_AT + 21_000,
        alertLeadSeconds: 20,
        alertedAtMs: null,
      },
    );
    expect(warmTrace?.phase).toBe("delegated");
  });

  it.each([500, 1_499])(
    "authorizes a natural %i ms planned wait at the accepted jitter boundary",
    (scheduledWaitMs) => {
      const fixture = createPortFixture();
      const warmTrace = claimCanonical(fixture);
      const expiresAt = SAMPLED_AT + 20_000 + scheduledWaitMs;
      expect(completeBuffExpiryWarmTraceMatcher(warmTrace)).toBe(true);

      const candidate = authorizeBuffExpiryWarmTraceWait({
        warmTrace,
        confirmedTransitions: [createTransition({ expiresAt })],
        tracks: [createTrack({ expiresAt })],
        sampledAt: SAMPLED_AT,
      });

      expect(candidate).toMatchObject({
        trackId: TRACK_ID,
        sampledAtMs: SAMPLED_AT,
        dueAtMs: SAMPLED_AT + scheduledWaitMs,
        active: true,
      });
      expect(
        fixture.mocks.authorizeBuffExpiryPlannedWait,
      ).toHaveBeenCalledWith(
        fixture.featureClaim,
        expect.objectContaining({
          expiresAtMs: expiresAt,
          derivedSeconds: 21,
        }),
      );
    },
  );

  it.each([
    {
      name: "non-canonical configuration",
      config: createConfig({
        selectedPrecisionTargetGroups: ["unionWealth", "potion"],
      }),
      target: "union-wealth" as const,
    },
    {
      name: "a different Buff target",
      config: createConfig(),
      target: "union-luck" as const,
    },
  ])("suppresses $name at claim time", ({ config, target }) => {
    const fixture = createPortFixture(target);

    expect(claimCanonical(fixture, config)).toBeNull();
    expect(fixture.mocks.terminateFeatureStage).toHaveBeenCalledWith(
      fixture.featureClaim,
      "matcherOcrUs",
      "suppressed",
    );
  });

  it("ignores a target owned by another feature without claiming it", () => {
    const fixture = createPortFixture("janus");

    expect(claimCanonical(fixture)).toBeNull();
    expect(fixture.mocks.claimFeatureOwner).not.toHaveBeenCalled();
    expect(fixture.mocks.terminateFeatureStage).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a 22-second transition",
      transitions: [
        createTransition({
          acceptedSeconds: 22,
          derivedSeconds: 22,
          expiresAt: SAMPLED_AT + 22_000,
        }),
      ],
      tracks: [
        createTrack({
          detectedSeconds: 22,
          expiresAt: SAMPLED_AT + 22_000,
        }),
      ],
    },
    {
      name: "a transition with no final track",
      transitions: [createTransition()],
      tracks: [],
    },
    {
      name: "multiple otherwise valid transitions",
      transitions: [createTransition(), createTransition()],
      tracks: [createTrack()],
    },
    ...[499, 1_500].map((scheduledWaitMs) => {
      const expiresAt = SAMPLED_AT + 20_000 + scheduledWaitMs;
      return {
        name: `a ${scheduledWaitMs} ms out-of-range planned wait`,
        transitions: [createTransition({ expiresAt })],
        tracks: [createTrack({ expiresAt })],
      };
    }),
  ])(
    "suppresses $name instead of authorizing a wait",
    ({ transitions, tracks }) => {
      const fixture = createPortFixture();
      const warmTrace = claimCanonical(fixture);
      expect(completeBuffExpiryWarmTraceMatcher(warmTrace)).toBe(true);

      expect(
        authorizeBuffExpiryWarmTraceWait({
          warmTrace,
          confirmedTransitions: transitions,
          tracks,
          sampledAt: SAMPLED_AT,
        }),
      ).toBeNull();
      expect(
        fixture.mocks.authorizeBuffExpiryPlannedWait,
      ).not.toHaveBeenCalled();
      expect(fixture.mocks.terminateFeatureStage).toHaveBeenCalledWith(
        fixture.featureClaim,
        "temporalDecisionUs",
        "suppressed",
      );
      expect(warmTrace?.phase).toBe("terminal");
    },
  );

  it("keeps missing and throwing instrumentation fail-open", () => {
    const fixture = createPortFixture();

    expect(
      claimBuffExpiryWarmTrace({
        carrier: fixture.carrier,
        config: createConfig(),
      }),
    ).toBeNull();
    expect(
      claimBuffExpiryWarmTrace({
        carrier: fixture.carrier,
        config: createConfig(),
        featurePort: {
          ...fixture.featurePort,
          claimFeatureOwner: vi.fn(() => null),
        },
        temporalPort: fixture.temporalPort,
        schedulerPort: fixture.schedulerPort,
      }),
    ).toBeNull();
    fixture.mocks.getSeries.mockImplementation(() => {
      throw new Error("get-series failed");
    });
    expect(() => claimCanonical(fixture)).not.toThrow();
    expect(claimCanonical(fixture)).toBeNull();

    const matcherFixture = createPortFixture();
    const matcherClaim = claimCanonical(matcherFixture);
    matcherFixture.mocks.completeFeatureStage.mockImplementation(() => {
      throw new Error("complete failed");
    });
    matcherFixture.mocks.terminateFeatureCurrentStage.mockImplementation(() => {
      throw new Error("cleanup failed");
    });
    expect(() =>
      completeBuffExpiryWarmTraceMatcher(matcherClaim),
    ).not.toThrow();
    expect(completeBuffExpiryWarmTraceMatcher(matcherClaim)).toBe(false);

    const temporalFixture = createPortFixture();
    const temporalClaim = claimCanonical(temporalFixture);
    expect(completeBuffExpiryWarmTraceMatcher(temporalClaim)).toBe(true);
    temporalFixture.mocks.authorizeBuffExpiryPlannedWait.mockImplementation(
      () => {
        throw new Error("authorize failed");
      },
    );
    temporalFixture.mocks.terminateFeatureStage.mockImplementation(() => {
      throw new Error("cleanup failed");
    });
    expect(() =>
      authorizeBuffExpiryWarmTraceWait({
        warmTrace: temporalClaim,
        confirmedTransitions: [createTransition()],
        tracks: [createTrack()],
        sampledAt: SAMPLED_AT,
      }),
    ).not.toThrow();
  });

  it("contains scheduler-port exceptions without changing timer ownership", () => {
    const prepareFixture = createPortFixture();
    const prepareCandidate = authorizeCanonical(prepareFixture);
    prepareFixture.mocks.prepareBuffExpiryPlannedWait.mockImplementation(() => {
      throw new Error("prepare failed");
    });
    prepareFixture.mocks.terminateFeatureStage.mockImplementation(() => {
      throw new Error("cleanup failed");
    });
    expect(() =>
      prepareBuffExpiryWarmTraceWait(prepareCandidate, {
        trackId: TRACK_ID,
        sampledAtMs: SAMPLED_AT,
        dueAtMs: SAMPLED_AT + 1_000,
        delayMs: 1_000,
      }),
    ).not.toThrow();

    const commitFixture = createPortFixture();
    const commitCandidate = authorizeCanonical(commitFixture);
    const prepared = prepareBuffExpiryWarmTraceWait(commitCandidate, {
      trackId: TRACK_ID,
      sampledAtMs: SAMPLED_AT,
      dueAtMs: SAMPLED_AT + 1_000,
      delayMs: 1_000,
    });
    commitFixture.mocks.commitBuffExpiryPlannedWait.mockImplementation(() => {
      throw new Error("commit failed");
    });
    commitFixture.mocks.terminateFeatureStage.mockImplementation(() => {
      throw new Error("cleanup failed");
    });
    expect(() => commitBuffExpiryWarmTraceWait(prepared)).not.toThrow();

    const resumeFixture = createPortFixture();
    const resumeCandidate = authorizeCanonical(resumeFixture);
    const resumePrepared = prepareBuffExpiryWarmTraceWait(resumeCandidate, {
      trackId: TRACK_ID,
      sampledAtMs: SAMPLED_AT,
      dueAtMs: SAMPLED_AT + 1_000,
      delayMs: 1_000,
    });
    const scheduled = commitBuffExpiryWarmTraceWait(resumePrepared);
    const slot: BuffExpiryWarmTraceWaitSlot = { current: scheduled };
    resumeFixture.mocks.resumeBuffExpiryPlannedWait.mockImplementation(() => {
      throw new Error("resume failed");
    });
    resumeFixture.mocks.terminateBuffExpiryPlannedWait.mockImplementation(
      () => {
        throw new Error("cleanup failed");
      },
    );
    expect(() => resumeBuffExpiryWarmTraceWait(slot)).not.toThrow();

    const completeFixture = createPortFixture();
    const completeCandidate = authorizeCanonical(completeFixture);
    const completePrepared = prepareBuffExpiryWarmTraceWait(completeCandidate, {
      trackId: TRACK_ID,
      sampledAtMs: SAMPLED_AT,
      dueAtMs: SAMPLED_AT + 1_000,
      delayMs: 1_000,
    });
    const completeScheduled = commitBuffExpiryWarmTraceWait(completePrepared);
    const completeSlot: BuffExpiryWarmTraceWaitSlot = {
      current: completeScheduled,
    };
    const playback = resumeBuffExpiryWarmTraceWait(completeSlot);
    completeFixture.mocks.completeBuffExpiryPlannedWait.mockImplementation(
      () => {
        throw new Error("complete failed");
      },
    );
    expect(() => completeBuffExpiryWarmTracePlayback(playback)).not.toThrow();
  });

  it("uses prepare, commit, resume, and complete tokens only once", () => {
    const fixture = createPortFixture();
    const candidate = authorizeCanonical(fixture);
    const declaration = {
      trackId: TRACK_ID,
      sampledAtMs: SAMPLED_AT,
      dueAtMs: SAMPLED_AT + 1_000,
      delayMs: 1_000,
    };

    const prepared = prepareBuffExpiryWarmTraceWait(candidate, declaration);
    expect(prepared).not.toBeNull();
    expect(prepareBuffExpiryWarmTraceWait(candidate, declaration)).toBeNull();
    expect(fixture.mocks.prepareBuffExpiryPlannedWait).toHaveBeenCalledTimes(1);

    const scheduled = commitBuffExpiryWarmTraceWait(prepared);
    expect(scheduled).not.toBeNull();
    expect(commitBuffExpiryWarmTraceWait(prepared)).toBeNull();
    expect(fixture.mocks.commitBuffExpiryPlannedWait).toHaveBeenCalledTimes(1);

    const slot: BuffExpiryWarmTraceWaitSlot = { current: scheduled };
    const playback = resumeBuffExpiryWarmTraceWait(slot);
    expect(playback).not.toBeNull();
    expect(resumeBuffExpiryWarmTraceWait(slot)).toBeNull();
    expect(fixture.mocks.resumeBuffExpiryPlannedWait).toHaveBeenCalledTimes(1);

    completeBuffExpiryWarmTracePlayback(playback);
    completeBuffExpiryWarmTracePlayback(playback);
    expect(fixture.mocks.completeBuffExpiryPlannedWait).toHaveBeenCalledTimes(
      1,
    );
  });

  it("cancels or fails every pre-playback ownership shape at most once", () => {
    const candidateFixture = createPortFixture();
    const candidate = authorizeCanonical(candidateFixture);
    terminateBuffExpiryWarmTraceCandidate(candidate, "cancelled");
    terminateBuffExpiryWarmTraceCandidate(candidate, "cancelled");
    expect(candidateFixture.mocks.terminateFeatureStage).toHaveBeenCalledTimes(
      1,
    );
    expect(candidateFixture.mocks.terminateFeatureStage).toHaveBeenCalledWith(
      candidateFixture.featureClaim,
      "scheduleUs",
      "cancelled",
    );

    const preparationFixture = createPortFixture();
    const preparationCandidate = authorizeCanonical(preparationFixture);
    const prepared = prepareBuffExpiryWarmTraceWait(preparationCandidate, {
      trackId: TRACK_ID,
      sampledAtMs: SAMPLED_AT,
      dueAtMs: SAMPLED_AT + 1_000,
      delayMs: 1_000,
    });
    abandonBuffExpiryWarmTracePreparation(prepared);
    abandonBuffExpiryWarmTracePreparation(prepared);
    expect(
      preparationFixture.mocks.terminateFeatureStage,
    ).toHaveBeenCalledTimes(1);
    expect(preparationFixture.mocks.terminateFeatureStage).toHaveBeenCalledWith(
      preparationFixture.featureClaim,
      "scheduleUs",
      "failed",
    );

    const waitFixture = createPortFixture();
    const waitCandidate = authorizeCanonical(waitFixture);
    const waitPrepared = prepareBuffExpiryWarmTraceWait(waitCandidate, {
      trackId: TRACK_ID,
      sampledAtMs: SAMPLED_AT,
      dueAtMs: SAMPLED_AT + 1_000,
      delayMs: 1_000,
    });
    const scheduled = commitBuffExpiryWarmTraceWait(waitPrepared);
    const slot: BuffExpiryWarmTraceWaitSlot = { current: scheduled };
    terminateBuffExpiryWarmTraceWaitSlot(slot, "cancelled");
    terminateBuffExpiryWarmTraceWaitSlot(slot, "cancelled");
    expect(
      waitFixture.mocks.terminateBuffExpiryPlannedWait,
    ).toHaveBeenCalledTimes(1);
    expect(
      waitFixture.mocks.terminateBuffExpiryPlannedWait,
    ).toHaveBeenCalledWith(waitFixture.scheduledWait, "cancelled");

    const playbackFixture = createPortFixture();
    const playbackCandidate = authorizeCanonical(playbackFixture);
    const playbackPrepared = prepareBuffExpiryWarmTraceWait(playbackCandidate, {
      trackId: TRACK_ID,
      sampledAtMs: SAMPLED_AT,
      dueAtMs: SAMPLED_AT + 1_000,
      delayMs: 1_000,
    });
    const playbackScheduled = commitBuffExpiryWarmTraceWait(playbackPrepared);
    const playbackSlot: BuffExpiryWarmTraceWaitSlot = {
      current: playbackScheduled,
    };
    const playback = resumeBuffExpiryWarmTraceWait(playbackSlot);
    terminateBuffExpiryWarmTracePlayback(playback, "failed");
    terminateBuffExpiryWarmTracePlayback(playback, "failed");
    expect(
      playbackFixture.mocks.terminateBuffExpiryPlannedWait,
    ).toHaveBeenCalledTimes(1);
    expect(
      playbackFixture.mocks.terminateBuffExpiryPlannedWait,
    ).toHaveBeenCalledWith(playbackFixture.scheduledWait, "failed");
  });
});
