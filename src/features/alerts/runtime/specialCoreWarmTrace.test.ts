import { describe, expect, it, vi } from "vitest";
import {
  attachRemoteRecognitionWarmTraceHandle,
  type RemoteRecognitionWarmTraceFeatureClaim,
  type RemoteRecognitionWarmTraceFeaturePort,
  type RemoteRecognitionWarmTraceHandle,
  type RemoteRecognitionWarmTraceTarget,
} from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import {
  createSpecialCoreRuntimeState,
  updateSpecialCoreRuntimeFromSample,
  type SpecialCoreDetectedIcon,
  type SpecialCoreRuntimeState,
  type SpecialCoreSampleResponse,
} from "../../../lib/specialCore";
import { createDefaultSpecialCoreAlert } from "../../../lib/storage";
import {
  bindSpecialCoreWarmTraceActivation,
  claimSpecialCoreWarmTrace,
  completeSpecialCoreWarmTraceMatcher,
  completeSpecialCoreWarmTracePlayback,
  completeSpecialCoreWarmTraceSchedule,
  takeSpecialCoreWarmTraceActivation,
  terminateSpecialCoreWarmTraceCandidate,
  terminateSpecialCoreWarmTraceForState,
} from "./specialCoreWarmTrace";

const FIRST_AT = 99_000;
const DECISIVE_AT = 100_000;

function createConfig() {
  return {
    ...createDefaultSpecialCoreAlert(),
    enabled: true,
    cooldownSeconds: 11,
    alertLeadSeconds: 10,
  };
}

function createDetectedIcon(
  mode: "primary" | "rescue" | "base-only" = "primary",
): SpecialCoreDetectedIcon {
  const primary = mode === "primary";
  const rescue = mode === "rescue";
  return {
    boxIndex: 0,
    box: { x: 10, y: 10, size: 32, confidence: 0.99, score: 0.98 },
    icon: {
      width: 32,
      height: 32,
      data: new Uint8ClampedArray(32 * 32 * 4),
    },
    match: {
      matched: primary || rescue,
      targetId: primary || rescue ? "specialCore" : null,
      bundleId: "special-core-deep-v2",
      modelId: "special-core-deep-v2",
      modelVersion: "special-core-20260711-v2",
      variantId: "test",
      gateVersion: 2,
      score: primary ? 1 : -0.01,
      threshold: 0,
      margin: primary ? 1 : -0.01,
      gateScore: rescue ? 1 : 0.98,
      gateThreshold: 0.94,
      gateMargin: rescue ? 0.06 : 0.04,
      rescueThreshold: 0.999,
      rescueMargin: rescue ? 0.001 : -0.019,
      basePassed: primary || mode === "base-only",
      positiveGatePassed: primary || rescue,
      primaryPassed: primary,
      rescuePassed: rescue,
      decisionReason: primary
        ? "base_and_positive_gate_passed"
        : rescue
          ? "near_exact_positive_prototype_rescue"
          : "below_positive_gate_threshold",
      elapsedMs: 1,
    },
  };
}

function createResponse({
  sampledAt,
  mode = "primary",
  detectedCount,
}: {
  sampledAt: number;
  mode?: "primary" | "rescue" | "base-only";
  detectedCount?: number;
}): SpecialCoreSampleResponse {
  const icon = createDetectedIcon(mode);
  const matched = icon.match.matched;
  return {
    sampledAt,
    parserEngine: "dl",
    parserVersion: "test-shared-parser",
    parserFallbackReason: null,
    parserRuntime: null,
    boxCount: 1,
    parsedBoxes: [icon.box],
    rowGroups: [
      { rowIndex: 0, y: 10, size: 32, boxIndexes: [0], eligible: true },
    ],
    eligibleBoxIndexes: [0],
    detectedCount: detectedCount ?? (matched ? 1 : 0),
    detectedIcon: matched ? icon : null,
    candidateIcons: [icon],
    performance: { totalMs: 1, detectMs: 0, matchMs: 1, boxCount: 1 },
    unsupported: false,
    unsupportedReason: null,
  };
}

function createPortFixture(
  target: RemoteRecognitionWarmTraceTarget = "special-core",
) {
  const handle = {} as RemoteRecognitionWarmTraceHandle;
  const featureClaim = {} as RemoteRecognitionWarmTraceFeatureClaim;
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
  const featurePort: RemoteRecognitionWarmTraceFeaturePort = {
    getSeries,
    claimFeatureOwner,
    completeFeatureStage,
    terminateFeatureStage,
    terminateFeatureCurrentStage,
    completeFeature,
  };
  return {
    carrier,
    handle,
    featureClaim,
    featurePort,
    mocks: {
      getSeries,
      claimFeatureOwner,
      completeFeatureStage,
      terminateFeatureStage,
      terminateFeatureCurrentStage,
      completeFeature,
    },
  };
}

function createCanonicalTransition(
  decisiveMode: "primary" | "rescue" = "primary",
  confirmationGapMs = 1_000,
): {
  first: SpecialCoreSampleResponse;
  decisive: SpecialCoreSampleResponse;
  decisiveAt: number;
  stateBefore: SpecialCoreRuntimeState;
  stateAfter: SpecialCoreRuntimeState;
} {
  const config = createConfig();
  const decisiveAt = FIRST_AT + confirmationGapMs;
  const first = createResponse({ sampledAt: FIRST_AT, mode: decisiveMode });
  const stateBefore = updateSpecialCoreRuntimeFromSample({
    previous: createSpecialCoreRuntimeState(),
    sample: first,
    config,
    now: FIRST_AT,
  });
  const decisive = createResponse({
    sampledAt: decisiveAt,
    mode: decisiveMode,
  });
  const stateAfter = updateSpecialCoreRuntimeFromSample({
    previous: stateBefore,
    sample: decisive,
    config,
    now: decisiveAt,
  });
  return { first, decisive, decisiveAt, stateBefore, stateAfter };
}

function bindCanonical(
  fixture: ReturnType<typeof createPortFixture>,
  mode: "primary" | "rescue" = "primary",
) {
  const transition = createCanonicalTransition(mode);
  const warmTrace = claimSpecialCoreWarmTrace({
    carrier: fixture.carrier,
    config: createConfig(),
    featurePort: fixture.featurePort,
  });
  expect(warmTrace).toMatchObject({ phase: "matcher" });
  expect(
    completeSpecialCoreWarmTraceMatcher({
      warmTrace,
      response: transition.decisive,
      sampledAt: transition.decisiveAt,
    }),
  ).toBe(true);
  const candidate = bindSpecialCoreWarmTraceActivation({
    warmTrace,
    response: transition.decisive,
    stateBefore: transition.stateBefore,
    stateAfter: transition.stateAfter,
    sampledAt: transition.decisiveAt,
  });
  expect(candidate).not.toBeNull();
  return { ...transition, warmTrace, candidate: candidate! };
}

describe("specialCoreWarmTrace", () => {
  it.each(["primary", "rescue"] as const)(
    "binds the exact second-frame %s activation through playback acceptance once",
    (mode) => {
      const fixture = createPortFixture();
      const { stateAfter, candidate } = bindCanonical(fixture, mode);

      expect(candidate).toMatchObject({
        activationId: 1,
        activationStartedAt: FIRST_AT,
        activationConfirmedAt: DECISIVE_AT,
        alertDueAt: DECISIVE_AT,
        phase: "schedule",
      });
      expect(fixture.mocks.claimFeatureOwner).toHaveBeenCalledWith(
        fixture.handle,
        "special-core",
      );
      expect(takeSpecialCoreWarmTraceActivation(stateAfter)).toBe(candidate);
      expect(takeSpecialCoreWarmTraceActivation(stateAfter)).toBeNull();
      expect(completeSpecialCoreWarmTraceSchedule(candidate)).toBe(true);
      expect(completeSpecialCoreWarmTracePlayback(candidate)).toBe(true);
      expect(completeSpecialCoreWarmTracePlayback(candidate)).toBe(false);
      expect(fixture.mocks.completeFeatureStage.mock.calls).toEqual([
        [fixture.featureClaim, "matcherOcrUs"],
        [fixture.featureClaim, "temporalDecisionUs"],
        [fixture.featureClaim, "scheduleUs"],
      ]);
      expect(fixture.mocks.completeFeature).toHaveBeenCalledTimes(1);
    },
  );

  it("leaves Skill and Buff owners unclaimed", () => {
    for (const target of ["janus", "union-wealth"] as const) {
      const fixture = createPortFixture(target);
      expect(
        claimSpecialCoreWarmTrace({
          carrier: fixture.carrier,
          config: createConfig(),
          featurePort: fixture.featurePort,
        }),
      ).toBeNull();
      expect(fixture.mocks.claimFeatureOwner).not.toHaveBeenCalled();
    }
  });

  it("suppresses noncanonical configuration and matcher provenance", () => {
    const wrongConfig = createPortFixture();
    expect(
      claimSpecialCoreWarmTrace({
        carrier: wrongConfig.carrier,
        config: { ...createConfig(), cooldownSeconds: 12 },
        featurePort: wrongConfig.featurePort,
      }),
    ).toBeNull();
    expect(wrongConfig.mocks.terminateFeatureStage).toHaveBeenCalledWith(
      wrongConfig.featureClaim,
      "matcherOcrUs",
      "suppressed",
    );

    const baseOnly = createPortFixture();
    const warmTrace = claimSpecialCoreWarmTrace({
      carrier: baseOnly.carrier,
      config: createConfig(),
      featurePort: baseOnly.featurePort,
    });
    expect(
      completeSpecialCoreWarmTraceMatcher({
        warmTrace,
        response: createResponse({
          sampledAt: DECISIVE_AT,
          mode: "base-only",
          detectedCount: 1,
        }),
        sampledAt: DECISIVE_AT,
      }),
    ).toBe(false);
    expect(baseOnly.mocks.terminateFeatureCurrentStage).toHaveBeenCalledWith(
      baseOnly.featureClaim,
      "suppressed",
    );

    const highGatePrimary = createPortFixture();
    const highGateTrace = claimSpecialCoreWarmTrace({
      carrier: highGatePrimary.carrier,
      config: createConfig(),
      featurePort: highGatePrimary.featurePort,
    });
    const highGateResponse = createResponse({ sampledAt: DECISIVE_AT });
    highGateResponse.detectedIcon!.match.rescuePassed = true;
    highGateResponse.detectedIcon!.match.rescueMargin = 0.001;
    expect(
      completeSpecialCoreWarmTraceMatcher({
        warmTrace: highGateTrace,
        response: highGateResponse,
        sampledAt: DECISIVE_AT,
      }),
    ).toBe(true);
  });

  it("suppresses a noncausal confirmation and never keys by a reused activation id", () => {
    const noncausal = createPortFixture();
    const transition = createCanonicalTransition();
    const warmTrace = claimSpecialCoreWarmTrace({
      carrier: noncausal.carrier,
      config: createConfig(),
      featurePort: noncausal.featurePort,
    });
    expect(
      completeSpecialCoreWarmTraceMatcher({
        warmTrace,
        response: transition.decisive,
        sampledAt: DECISIVE_AT,
      }),
    ).toBe(true);
    expect(
      bindSpecialCoreWarmTraceActivation({
        warmTrace,
        response: transition.decisive,
        stateBefore: createSpecialCoreRuntimeState(),
        stateAfter: transition.stateAfter,
        sampledAt: DECISIVE_AT,
      }),
    ).toBeNull();
    expect(noncausal.mocks.terminateFeatureCurrentStage).toHaveBeenCalledWith(
      noncausal.featureClaim,
      "suppressed",
    );

    const canonical = createPortFixture();
    const { stateAfter, candidate } = bindCanonical(canonical);
    const sameValues = { ...stateAfter };
    expect(takeSpecialCoreWarmTraceActivation(sameValues)).toBeNull();
    expect(takeSpecialCoreWarmTraceActivation(stateAfter)).toBe(candidate);
    terminateSpecialCoreWarmTraceCandidate(candidate, "replaced");
    terminateSpecialCoreWarmTraceCandidate(candidate, "failed");
    expect(canonical.mocks.terminateFeatureCurrentStage).toHaveBeenCalledTimes(1);
    expect(canonical.mocks.terminateFeatureCurrentStage).toHaveBeenCalledWith(
      canonical.featureClaim,
      "replaced",
    );
  });

  it.each([1_001, 1_499, 2_000, 3_000])(
    "accepts a causal two-frame confirmation with %d ms scheduler jitter",
    (confirmationGapMs) => {
      const fixture = createPortFixture();
      const transition = createCanonicalTransition(
        "primary",
        confirmationGapMs,
      );
      const warmTrace = claimSpecialCoreWarmTrace({
        carrier: fixture.carrier,
        config: createConfig(),
        featurePort: fixture.featurePort,
      });
      expect(
        completeSpecialCoreWarmTraceMatcher({
          warmTrace,
          response: transition.decisive,
          sampledAt: transition.decisiveAt,
        }),
      ).toBe(true);
      const candidate = bindSpecialCoreWarmTraceActivation({
        warmTrace,
        response: transition.decisive,
        stateBefore: transition.stateBefore,
        stateAfter: transition.stateAfter,
        sampledAt: transition.decisiveAt,
      });

      expect(candidate).toMatchObject({
        activationStartedAt: FIRST_AT,
        activationConfirmedAt: transition.decisiveAt,
        alertDueAt: FIRST_AT + 1_000,
      });
      expect(takeSpecialCoreWarmTraceActivation(transition.stateAfter)).toBe(
        candidate,
      );
      terminateSpecialCoreWarmTraceCandidate(candidate, "cancelled");
    },
  );

  it("suppresses a second confirmation outside the three-second product window", () => {
    const fixture = createPortFixture();
    const transition = createCanonicalTransition("primary", 3_001);
    const warmTrace = claimSpecialCoreWarmTrace({
      carrier: fixture.carrier,
      config: createConfig(),
      featurePort: fixture.featurePort,
    });
    expect(
      completeSpecialCoreWarmTraceMatcher({
        warmTrace,
        response: transition.decisive,
        sampledAt: transition.decisiveAt,
      }),
    ).toBe(true);
    expect(
      bindSpecialCoreWarmTraceActivation({
        warmTrace,
        response: transition.decisive,
        stateBefore: transition.stateBefore,
        stateAfter: transition.stateAfter,
        sampledAt: transition.decisiveAt,
      }),
    ).toBeNull();
    expect(fixture.mocks.terminateFeatureCurrentStage).toHaveBeenCalledWith(
      fixture.featureClaim,
      "suppressed",
    );
  });

  it("keeps product decisions fail-open when tracing throws", () => {
    const fixture = createPortFixture();
    fixture.mocks.completeFeatureStage.mockImplementation(() => {
      throw new Error("trace-port-failed");
    });
    fixture.mocks.terminateFeatureCurrentStage.mockImplementation(() => {
      throw new Error("trace-cleanup-failed");
    });
    const warmTrace = claimSpecialCoreWarmTrace({
      carrier: fixture.carrier,
      config: createConfig(),
      featurePort: fixture.featurePort,
    });
    expect(() =>
      completeSpecialCoreWarmTraceMatcher({
        warmTrace,
        response: createResponse({ sampledAt: DECISIVE_AT }),
        sampledAt: DECISIVE_AT,
      }),
    ).not.toThrow();
    expect(warmTrace).toMatchObject({ phase: "terminal" });
  });

  it("terminalizes an unconsumed activation on runtime reset or retime", () => {
    const fixture = createPortFixture();
    const { stateAfter, candidate } = bindCanonical(fixture);

    terminateSpecialCoreWarmTraceForState(stateAfter, "replaced");
    terminateSpecialCoreWarmTraceForState(stateAfter, "failed");

    expect(candidate.phase).toBe("terminal");
    expect(takeSpecialCoreWarmTraceActivation(stateAfter)).toBeNull();
    expect(fixture.mocks.terminateFeatureCurrentStage).toHaveBeenCalledTimes(1);
    expect(fixture.mocks.terminateFeatureCurrentStage).toHaveBeenCalledWith(
      fixture.featureClaim,
      "replaced",
    );
  });
});
