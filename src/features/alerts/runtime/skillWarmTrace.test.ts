import { describe, expect, it, vi } from "vitest";
import {
  attachRemoteRecognitionWarmTraceHandle,
  type RemoteRecognitionWarmTraceFeatureClaim,
  type RemoteRecognitionWarmTraceFeaturePort,
  type RemoteRecognitionWarmTraceHandle,
  type RemoteRecognitionWarmTraceTarget,
} from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import { createDefaultProfile, createSkill } from "../../../lib/profileFactory";
import {
  getSkillBuffDurationTargetForSkill,
  type SkillBuffDurationTarget,
} from "../../../lib/skillBuffDuration/skillBuffDurationTargets";
import { createRuntimeState } from "../../../lib/timer";
import { getSkillMatcherBundleDescriptorForSkill } from "../../../recognition/skill-precision/skillMatcherBundleRegistry";
import type {
  SkillBuffDurationDetectedIcon,
  SkillBuffDurationSampleResponse,
} from "../../../runtime/skill-precision/analysis/skillPrecisionAnalysisRuntime";
import type { Profile, SkillConfig, SkillRuntimeState } from "../../../types";
import {
  processSkillFrameSample,
  type SkillBuffDurationFrameResult,
  type SkillFrameProcessResult,
} from "./skillFrameProcessor";
import {
  claimSkillWarmTrace,
  completeSkillWarmTraceMatcher,
  completeSkillWarmTracePlayback,
  completeSkillWarmTraceSchedule,
  completeSkillWarmTraceTemporal,
  isSkillWarmTraceLifecycleCurrent,
  terminateSkillWarmTraceCurrentStage,
  terminateSkillWarmTraceStage,
} from "./skillWarmTrace";

type SkillTargetCase = {
  target: Extract<
    RemoteRecognitionWarmTraceTarget,
    "janus" | "hologram-graffiti-barrier" | "fountain" | "yein"
  >;
  presetId: SkillConfig["presetId"];
  targetSkillId:
    | "janusDeepV2"
    | "hologramGraffitiBarrierVi"
    | "fountainDeepV2"
    | "maehwaYeinDeepV1";
  matcherSkillId: "janus" | "barrier" | "fountain" | "maehwaYein";
  detectorId: string;
  bundleId: "skill-deep-v2" | "skill-maehwa-yein-deep-v1";
  modelVersion: string;
  valueKind: "countdown" | "remaining-count";
};

const sharedDescriptor = getSkillMatcherBundleDescriptorForSkill("janus");
const yeinDescriptor = getSkillMatcherBundleDescriptorForSkill("maehwaYein");

const TARGET_CASES = [
  {
    target: "janus",
    presetId: "sol-janus-dawn-deep-v2",
    targetSkillId: "janusDeepV2",
    matcherSkillId: "janus",
    detectorId: "skill-deep-v2:janus",
    bundleId: "skill-deep-v2",
    modelVersion: sharedDescriptor.expectedModelVersion,
    valueKind: "countdown",
  },
  {
    target: "hologram-graffiti-barrier",
    presetId: "hologram-graffiti-barrier-vi",
    targetSkillId: "hologramGraffitiBarrierVi",
    matcherSkillId: "barrier",
    detectorId: "hologramGraffitiBarrierVi",
    bundleId: "skill-deep-v2",
    modelVersion: sharedDescriptor.expectedModelVersion,
    valueKind: "countdown",
  },
  {
    target: "fountain",
    presetId: "erda-fountain-deep-v2",
    targetSkillId: "fountainDeepV2",
    matcherSkillId: "fountain",
    detectorId: "skill-deep-v2:fountain",
    bundleId: "skill-deep-v2",
    modelVersion: sharedDescriptor.expectedModelVersion,
    valueKind: "countdown",
  },
  {
    target: "yein",
    presetId: "maehwa-yein-vi",
    targetSkillId: "maehwaYeinDeepV1",
    matcherSkillId: "maehwaYein",
    detectorId: "skill-maehwa-yein-deep-v1",
    bundleId: "skill-maehwa-yein-deep-v1",
    modelVersion: yeinDescriptor.expectedModelVersion,
    valueKind: "remaining-count",
  },
] as const satisfies readonly SkillTargetCase[];

describe("skillWarmTrace owner claim", () => {
  it.each(TARGET_CASES)(
    "claims exactly one enabled $target owner",
    (targetCase) => {
      const fixture = createClaimFixture(targetCase);

      expect(fixture.warmTrace).toMatchObject({
        target: targetCase.target,
        ownerSkillId: fixture.skill.id,
        phase: "matcher",
      });
      expect(fixture.port.claimFeatureOwner).toHaveBeenCalledWith(
        fixture.handle,
        "skill",
      );
      expect(fixture.port.terminateFeatureStage).not.toHaveBeenCalled();
    },
  );

  it("leaves a non-Skill series unclaimed", () => {
    const targetCase = TARGET_CASES[0];
    const fixture = createClaimFixture(targetCase, {
      seriesTarget: "union-wealth",
    });

    expect(fixture.warmTrace).toBeNull();
    expect(fixture.port.claimFeatureOwner).not.toHaveBeenCalled();
  });

  it.each([
    "another enabled quick-slot skill",
    "a duplicate enabled precision skill",
    "a mismatched active target",
  ])("claims then suppresses %s", (scenario) => {
    const targetCase = TARGET_CASES[0];
    const baseSkill = createTargetSkill(targetCase);
    const otherSkill =
      scenario === "another enabled quick-slot skill"
        ? createSkill({ id: "other", enabled: true })
        : createTargetSkill(targetCase, { id: "duplicate" });
    const profile = createProfile(
      scenario === "a mismatched active target"
        ? [baseSkill]
        : [baseSkill, otherSkill],
    );
    const activeTargets =
      scenario === "a mismatched active target"
        ? [getTarget(TARGET_CASES[1])]
        : [getTarget(targetCase)];
    const fixture = createPortFixture(targetCase.target);

    const warmTrace = claimSkillWarmTrace({
      carrier: fixture.carrier,
      activeTargets,
      profile,
      featurePort: fixture.featurePort,
      precisionParserRuntimeKey: "runtime-a",
      gameViewportRevision: 3,
    });

    expect(warmTrace).toBeNull();
    expect(fixture.mocks.claimFeatureOwner).toHaveBeenCalledTimes(1);
    expect(fixture.mocks.terminateFeatureStage).toHaveBeenCalledWith(
      fixture.featureClaim,
      "matcherOcrUs",
      "suppressed",
    );
  });

  it.each([
    "countdown-threshold",
    "remaining-count-threshold",
    "repeat-enabled",
    "initial-jitter-enabled",
  ] as const)("claims then suppresses non-canonical %s config", (scenario) => {
    const targetCase =
      scenario === "remaining-count-threshold"
        ? TARGET_CASES[3]
        : TARGET_CASES[0];
    const skill = createTargetSkill(targetCase, {
      ...(scenario === "countdown-threshold"
        ? { alertThresholdSeconds: 4 }
        : scenario === "remaining-count-threshold"
          ? { alertThresholdSeconds: 2 }
          : scenario === "repeat-enabled"
            ? { repeatAlertEnabled: true }
            : {}),
    });
    const profile = {
      ...createProfile([skill]),
      skillAlertInitialJitterEnabled: scenario === "initial-jitter-enabled",
    };
    const fixture = createPortFixture(targetCase.target);

    expect(
      claimSkillWarmTrace({
        carrier: fixture.carrier,
        activeTargets: [getTarget(targetCase)],
        profile,
        featurePort: fixture.featurePort,
        precisionParserRuntimeKey: "runtime-a",
        gameViewportRevision: 3,
      }),
    ).toBeNull();
    expect(fixture.mocks.terminateFeatureStage).toHaveBeenCalledWith(
      fixture.featureClaim,
      "matcherOcrUs",
      "suppressed",
    );
  });
});

describe("skillWarmTrace matcher evidence", () => {
  it.each(TARGET_CASES)(
    "accepts the exact raw $target Worker result",
    (targetCase) => {
      const fixture = createClaimFixture(targetCase);
      const response = createResponse(targetCase, {
        sampledAt: 5_000,
        value: targetCase.valueKind === "remaining-count" ? 3 : 0,
      });

      expect(
        completeSkillWarmTraceMatcher({
          warmTrace: fixture.warmTrace,
          response,
          sampledAt: 5_000,
        }),
      ).toBe(true);
      expect(fixture.warmTrace?.phase).toBe("temporal");
      expect(fixture.port.completeFeatureStage).toHaveBeenCalledWith(
        fixture.featureClaim,
        "matcherOcrUs",
      );
    },
  );

  it.each([
    "sampledAt",
    "extra-target-key",
    "detected-count",
    "matched",
    "target-skill-id",
    "detector-id",
    "matcher-engine",
    "bundle-id",
    "model-version",
    "base-skill-id",
    "raw-skill-id",
    "decision-reason",
    "score",
    "threshold",
    "margin",
    "margin-coherence",
    "gate-score",
    "gate-threshold",
    "gate-margin",
    "gate-margin-coherence",
    "second-accepted-candidate",
    "parser-engine",
  ] as const)("suppresses an invalid raw %s field", (field) => {
    const targetCase = TARGET_CASES[0];
    const fixture = createClaimFixture(targetCase);
    const response = createResponse(targetCase, {
      sampledAt: 5_000,
      value: 0,
    });
    mutateInvalidResponse(response, field);

    expect(
      completeSkillWarmTraceMatcher({
        warmTrace: fixture.warmTrace,
        response,
        sampledAt: 5_000,
      }),
    ).toBe(false);
    expect(fixture.warmTrace?.phase).toBe("terminal");
    expect(fixture.port.completeFeatureStage).not.toHaveBeenCalled();
    expect(fixture.port.terminateFeatureCurrentStage).toHaveBeenCalledWith(
      fixture.featureClaim,
      "suppressed",
    );
  });

  it.each([
    { value: 59, accepted: true },
    { value: 60, accepted: false },
  ])(
    "applies the Fountain exclusive bound to $value",
    ({ value, accepted }) => {
      const targetCase = TARGET_CASES[2];
      const fixture = createClaimFixture(targetCase);
      const response = createResponse(targetCase, {
        sampledAt: 5_000,
        value,
      });

      expect(
        completeSkillWarmTraceMatcher({
          warmTrace: fixture.warmTrace,
          response,
          sampledAt: 5_000,
        }),
      ).toBe(accepted);
      expect(fixture.warmTrace?.phase).toBe(accepted ? "temporal" : "terminal");
    },
  );

  it.each([-1, 0, 2.5, 29, Number.NaN])(
    "rejects a non-canonical Yein count %s",
    (value) => {
      const targetCase = TARGET_CASES[3];
      const fixture = createClaimFixture(targetCase);
      const response = createResponse(targetCase, {
        sampledAt: 5_000,
        value,
      });

      expect(
        completeSkillWarmTraceMatcher({
          warmTrace: fixture.warmTrace,
          response,
          sampledAt: 5_000,
        }),
      ).toBe(false);
      expect(fixture.warmTrace?.phase).toBe("terminal");
    },
  );

  it.each([-1, 2.5, Number.NaN])(
    "rejects a non-canonical countdown %s",
    (value) => {
      const targetCase = TARGET_CASES[0];
      const fixture = createClaimFixture(targetCase);
      expect(
        completeSkillWarmTraceMatcher({
          warmTrace: fixture.warmTrace,
          response: createResponse(targetCase, {
            sampledAt: 5_000,
            value,
          }),
          sampledAt: 5_000,
        }),
      ).toBe(false);
    },
  );

  it.each([
    "text",
    "format",
    "text-region",
    "status",
    "countdown-count",
    "remaining-count-count",
  ] as const)("rejects non-canonical countdown %s metadata", (field) => {
    const targetCase = TARGET_CASES[0];
    const fixture = createClaimFixture(targetCase);
    const response = createResponse(targetCase, {
      sampledAt: 5_000,
      value: 0,
    });
    const countdown = response.detectedIcon!.countdown!;
    switch (field) {
      case "text":
        countdown.text = "00";
        break;
      case "format":
        countdown.format = "minutes-seconds";
        break;
      case "text-region":
        countdown.textRegion = "bottom-left";
        break;
      case "status":
        countdown.status = "low";
        break;
      case "countdown-count":
        response.performance.countdownCount = 2;
        break;
      case "remaining-count-count":
        response.performance.remainingCountCount = 1;
        break;
    }

    expect(
      completeSkillWarmTraceMatcher({
        warmTrace: fixture.warmTrace,
        response,
        sampledAt: 5_000,
      }),
    ).toBe(false);
  });

  it.each([
    "expected-count",
    "text",
    "confidence",
    "status",
    "remaining-count-count",
    "countdown-count",
  ] as const)("rejects non-canonical Yein %s metadata", (field) => {
    const targetCase = TARGET_CASES[3];
    const fixture = createClaimFixture(targetCase);
    const response = createResponse(targetCase, {
      sampledAt: 5_000,
      value: 3,
    });
    const remainingCount = response.detectedIcon!.remainingCount!;
    switch (field) {
      case "expected-count":
        remainingCount.expectedCount = 4;
        break;
      case "text":
        remainingCount.text = "03";
        break;
      case "confidence":
        remainingCount.confidence = 0.61;
        break;
      case "status":
        remainingCount.status = "low";
        break;
      case "remaining-count-count":
        response.performance.remainingCountCount = 2;
        break;
      case "countdown-count":
        response.performance.countdownCount = 1;
        break;
    }

    expect(
      completeSkillWarmTraceMatcher({
        warmTrace: fixture.warmTrace,
        response,
        sampledAt: 5_000,
      }),
    ).toBe(false);
  });

  it.each(["countdown-with-count", "yein-with-countdown"] as const)(
    "rejects a mixed value channel: %s",
    (scenario) => {
      const targetCase =
        scenario === "countdown-with-count" ? TARGET_CASES[0] : TARGET_CASES[3];
      const fixture = createClaimFixture(targetCase);
      const response = createResponse(targetCase, {
        sampledAt: 5_000,
        value: scenario === "countdown-with-count" ? 0 : 3,
      });
      if (scenario === "countdown-with-count") {
        response.detectedIcon!.remainingCount = createDetectedIcon(
          TARGET_CASES[3],
          3,
        ).remainingCount;
      } else {
        response.detectedIcon!.countdown = createDetectedIcon(
          TARGET_CASES[0],
          0,
        ).countdown;
      }

      expect(
        completeSkillWarmTraceMatcher({
          warmTrace: fixture.warmTrace,
          response,
          sampledAt: 5_000,
        }),
      ).toBe(false);
    },
  );
});

describe("skillWarmTrace temporal causality", () => {
  it.each(TARGET_CASES.slice(0, 3))(
    "accepts only the sixth normal $target countdown confirmation",
    (targetCase) => {
      const transition = createCountdownTransition(targetCase);

      expect(transition.stateBefore.pendingShortAnchor?.count).toBe(5);
      expect(transition.stateBefore.estimatedExpiresAt).toBeNull();
      expect(
        completeSkillWarmTraceTemporal({
          warmTrace: transition.fixture.warmTrace,
          frame: transition.frame,
          stateBefore: transition.stateBefore,
          processed: transition.processed,
          sampledAt: 5_000,
          skill: transition.fixture.skill,
        }),
      ).toBe(true);
      expect(transition.fixture.warmTrace?.phase).toBe("schedule");
      expect(transition.processed).toMatchObject({
        alertDecision: "initial",
        alertCycleStartedAt: 5_000,
        state: {
          status: "alerted",
          alertedAt: 5_000,
          observedRemainingSeconds: 0,
          pendingShortAnchor: null,
        },
      });
    },
  );

  it("accepts Yein only on the second compatible reachable threshold observation", () => {
    const transition = createYeinTransition();

    expect(transition.stateBefore.pendingRemainingCountAlert?.count).toBe(1);
    expect(
      completeSkillWarmTraceTemporal({
        warmTrace: transition.fixture.warmTrace,
        frame: transition.frame,
        stateBefore: transition.stateBefore,
        processed: transition.processed,
        sampledAt: 5_000,
        skill: transition.fixture.skill,
      }),
    ).toBe(true);
    expect(transition.processed).toMatchObject({
      alertDecision: "initial",
      state: {
        status: "alerted",
        alertedAt: 5_000,
        observedRemainingCount: 3,
        pendingRemainingCountAlert: null,
      },
      traceSample: {
        remainingCountDecision: "alert-threshold-confirmed",
      },
    });
  });

  it.each(["incompatible", "quarantined"] as const)(
    "suppresses a Yein %s transition even if a forged result claims an alert",
    (scenario) => {
      const transition = createYeinTransition();
      const stateBefore = {
        ...transition.stateBefore,
        ...(scenario === "incompatible"
          ? {
              pendingRemainingCountAlert: {
                observedRemainingCount: 8,
                observedAt: 4_000,
                count: 1,
              },
            }
          : {
              observedRemainingCount: 8,
              countObservedAt: 4_000,
              pendingRemainingCountAlert: {
                observedRemainingCount: 3,
                observedAt: 4_000,
                count: 1,
              },
            }),
      };

      expect(
        completeSkillWarmTraceTemporal({
          warmTrace: transition.fixture.warmTrace,
          frame: transition.frame,
          stateBefore,
          processed: transition.processed,
          sampledAt: 5_000,
          skill: transition.fixture.skill,
        }),
      ).toBe(false);
      expect(transition.fixture.warmTrace?.phase).toBe("terminal");
    },
  );

  it("suppresses a zero-gap countdown confirmation", () => {
    const transition = createCountdownTransition(TARGET_CASES[0]);
    const pending = transition.stateBefore.pendingShortAnchor!;

    expect(
      completeSkillWarmTraceTemporal({
        warmTrace: transition.fixture.warmTrace,
        frame: transition.frame,
        stateBefore: {
          ...transition.stateBefore,
          pendingShortAnchor: { ...pending, observedAt: 5_000 },
        },
        processed: transition.processed,
        sampledAt: 5_000,
        skill: transition.fixture.skill,
      }),
    ).toBe(false);
  });

  it.each([
    "matcherEngine",
    "bundleId",
    "modelVersion",
    "baseSkillId",
    "rawSkillId",
    "gateScore",
    "gateThreshold",
    "gateMargin",
  ] as const)("suppresses a mismatched projected %s", (field) => {
    const transition = createCountdownTransition(TARGET_CASES[0]);
    Object.assign(transition.frame.snapshot, {
      [field]: field.startsWith("gate") ? 0.5 : "forged",
    });

    expect(
      completeSkillWarmTraceTemporal({
        warmTrace: transition.fixture.warmTrace,
        frame: transition.frame,
        stateBefore: transition.stateBefore,
        processed: transition.processed,
        sampledAt: 5_000,
        skill: transition.fixture.skill,
      }),
    ).toBe(false);
  });
});

describe("skillWarmTrace phase and lifecycle", () => {
  it("runs schedule and playback acceptance exactly once", () => {
    const transition = createCountdownTransition(TARGET_CASES[0]);
    expect(
      completeSkillWarmTraceTemporal({
        warmTrace: transition.fixture.warmTrace,
        frame: transition.frame,
        stateBefore: transition.stateBefore,
        processed: transition.processed,
        sampledAt: 5_000,
        skill: transition.fixture.skill,
      }),
    ).toBe(true);

    expect(completeSkillWarmTraceSchedule(transition.fixture.warmTrace)).toBe(
      true,
    );
    expect(completeSkillWarmTracePlayback(transition.fixture.warmTrace)).toBe(
      true,
    );
    expect(completeSkillWarmTracePlayback(transition.fixture.warmTrace)).toBe(
      false,
    );
    expect(transition.fixture.warmTrace?.phase).toBe("terminal");
    expect(transition.fixture.port.completeFeatureStage.mock.calls).toEqual([
      [transition.fixture.featureClaim, "matcherOcrUs"],
      [transition.fixture.featureClaim, "temporalDecisionUs"],
      [transition.fixture.featureClaim, "scheduleUs"],
    ]);
    expect(transition.fixture.port.completeFeature).toHaveBeenCalledTimes(1);
  });

  it.each(["returns-false", "throws"] as const)(
    "terminalizes a matcher completion that $mode",
    (mode) => {
      const fixture = createClaimFixture(TARGET_CASES[0]);
      fixture.port.completeFeatureStage.mockImplementation(() => {
        if (mode === "throws") {
          throw new Error("instrumentation-failed");
        }
        return false;
      });

      expect(
        completeSkillWarmTraceMatcher({
          warmTrace: fixture.warmTrace,
          response: createResponse(TARGET_CASES[0], {
            sampledAt: 5_000,
            value: 0,
          }),
          sampledAt: 5_000,
        }),
      ).toBe(false);
      expect(fixture.warmTrace?.phase).toBe("terminal");
      expect(fixture.port.terminateFeatureCurrentStage).toHaveBeenCalledWith(
        fixture.featureClaim,
        "failed",
      );
    },
  );

  it.each(["returns-false", "throws"] as const)(
    "terminalizes a temporal completion that $mode",
    (mode) => {
      const transition = createCountdownTransition(TARGET_CASES[0]);
      transition.fixture.port.completeFeatureStage.mockImplementation(
        (_claim, stage) => {
          if (stage !== "temporalDecisionUs") {
            return true;
          }
          if (mode === "throws") {
            throw new Error("temporal-instrumentation-failed");
          }
          return false;
        },
      );

      expect(
        completeSkillWarmTraceTemporal({
          warmTrace: transition.fixture.warmTrace,
          frame: transition.frame,
          stateBefore: transition.stateBefore,
          processed: transition.processed,
          sampledAt: 5_000,
          skill: transition.fixture.skill,
        }),
      ).toBe(false);
      expect(transition.fixture.warmTrace?.phase).toBe("terminal");
      expect(
        transition.fixture.port.terminateFeatureCurrentStage,
      ).toHaveBeenCalledWith(transition.fixture.featureClaim, "failed");
    },
  );

  it.each([
    "schedule-false",
    "schedule-throws",
    "playback-false",
    "playback-throws",
  ] as const)("terminalizes $mode without replaying the claim", (mode) => {
    const transition = createCountdownTransition(TARGET_CASES[0]);
    expect(
      completeSkillWarmTraceTemporal({
        warmTrace: transition.fixture.warmTrace,
        frame: transition.frame,
        stateBefore: transition.stateBefore,
        processed: transition.processed,
        sampledAt: 5_000,
        skill: transition.fixture.skill,
      }),
    ).toBe(true);

    if (mode.startsWith("schedule")) {
      transition.fixture.port.completeFeatureStage.mockImplementation(
        (_claim, stage) => {
          if (stage !== "scheduleUs") {
            return true;
          }
          if (mode === "schedule-throws") {
            throw new Error("schedule-instrumentation-failed");
          }
          return false;
        },
      );
      expect(completeSkillWarmTraceSchedule(transition.fixture.warmTrace)).toBe(
        false,
      );
    } else {
      expect(completeSkillWarmTraceSchedule(transition.fixture.warmTrace)).toBe(
        true,
      );
      transition.fixture.port.completeFeature.mockImplementation(() => {
        if (mode === "playback-throws") {
          throw new Error("playback-instrumentation-failed");
        }
        return false;
      });
      expect(completeSkillWarmTracePlayback(transition.fixture.warmTrace)).toBe(
        false,
      );
    }

    expect(transition.fixture.warmTrace?.phase).toBe("terminal");
    expect(
      transition.fixture.port.terminateFeatureCurrentStage,
    ).toHaveBeenCalledWith(transition.fixture.featureClaim, "failed");
  });

  it("tracks exact profile, owner, parser runtime, and viewport lifecycle", () => {
    const fixture = createClaimFixture(TARGET_CASES[0]);
    expect(
      isSkillWarmTraceLifecycleCurrent(fixture.warmTrace, {
        profile: fixture.profile,
        precisionParserRuntimeKey: "runtime-a",
        gameViewportRevision: 3,
      }),
    ).toBe(true);
    expect(
      isSkillWarmTraceLifecycleCurrent(fixture.warmTrace, {
        profile: { ...fixture.profile },
        precisionParserRuntimeKey: "runtime-a",
        gameViewportRevision: 3,
      }),
    ).toBe(false);
    expect(
      isSkillWarmTraceLifecycleCurrent(fixture.warmTrace, {
        profile: fixture.profile,
        precisionParserRuntimeKey: "runtime-b",
        gameViewportRevision: 3,
      }),
    ).toBe(false);
    expect(
      isSkillWarmTraceLifecycleCurrent(fixture.warmTrace, {
        profile: fixture.profile,
        precisionParserRuntimeKey: "runtime-a",
        gameViewportRevision: 4,
      }),
    ).toBe(false);

    expect(
      terminateSkillWarmTraceStage(
        fixture.warmTrace,
        "matcherOcrUs",
        "replaced",
      ),
    ).toBe(true);
    expect(
      terminateSkillWarmTraceCurrentStage(fixture.warmTrace, "cancelled"),
    ).toBe(false);
    expect(
      isSkillWarmTraceLifecycleCurrent(fixture.warmTrace, {
        profile: fixture.profile,
        precisionParserRuntimeKey: "runtime-a",
        gameViewportRevision: 3,
      }),
    ).toBe(false);
  });

  it.each(["returns-false", "throws"] as const)(
    "falls back to current-stage failure when explicit termination $mode",
    (mode) => {
      const fixture = createClaimFixture(TARGET_CASES[0]);
      fixture.port.terminateFeatureStage.mockImplementation(() => {
        if (mode === "throws") {
          throw new Error("stage-termination-failed");
        }
        return false;
      });

      expect(
        terminateSkillWarmTraceStage(
          fixture.warmTrace,
          "matcherOcrUs",
          "replaced",
        ),
      ).toBe(false);
      expect(fixture.port.terminateFeatureCurrentStage).toHaveBeenCalledWith(
        fixture.featureClaim,
        "failed",
      );
      expect(fixture.warmTrace?.phase).toBe("terminal");
    },
  );
});

function createClaimFixture(
  targetCase: SkillTargetCase,
  options: {
    seriesTarget?: RemoteRecognitionWarmTraceTarget;
  } = {},
) {
  const skill = createTargetSkill(targetCase);
  const profile = createProfile([skill]);
  const activeTarget = getTarget(targetCase);
  const portFixture = createPortFixture(
    options.seriesTarget ?? targetCase.target,
  );
  const warmTrace = claimSkillWarmTrace({
    carrier: portFixture.carrier,
    activeTargets: [activeTarget],
    profile,
    featurePort: portFixture.featurePort,
    precisionParserRuntimeKey: "runtime-a",
    gameViewportRevision: 3,
  });
  return {
    ...portFixture,
    activeTarget,
    profile,
    skill,
    warmTrace,
    port: portFixture.mocks,
  };
}

function createPortFixture(target: RemoteRecognitionWarmTraceTarget) {
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
  const completeFeatureStage = vi.fn<
    RemoteRecognitionWarmTraceFeaturePort["completeFeatureStage"]
  >(() => true);
  const terminateFeatureStage = vi.fn<
    RemoteRecognitionWarmTraceFeaturePort["terminateFeatureStage"]
  >(() => true);
  const terminateFeatureCurrentStage = vi.fn<
    RemoteRecognitionWarmTraceFeaturePort["terminateFeatureCurrentStage"]
  >(() => true);
  const completeFeature = vi.fn<
    RemoteRecognitionWarmTraceFeaturePort["completeFeature"]
  >(() => true);
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

function createProfile(skills: SkillConfig[]): Profile {
  return {
    ...createDefaultProfile(),
    skills,
  };
}

function createTargetSkill(
  targetCase: SkillTargetCase,
  overrides: Partial<SkillConfig> = {},
): SkillConfig {
  return createSkill({
    id: `skill-${targetCase.target}`,
    presetId: targetCase.presetId,
    detectionSource: "buff-duration",
    enabled: true,
    alertThresholdSeconds: targetCase.valueKind === "remaining-count" ? 3 : 5,
    repeatAlertEnabled: false,
    ...overrides,
  });
}

function getTarget(targetCase: SkillTargetCase): SkillBuffDurationTarget {
  const target = getSkillBuffDurationTargetForSkill(
    createTargetSkill(targetCase),
  );
  if (!target) {
    throw new Error(`missing-test-target:${targetCase.target}`);
  }
  return target;
}

function createResponse(
  targetCase: SkillTargetCase,
  {
    sampledAt,
    value,
  }: {
    sampledAt: number;
    value: number;
  },
): SkillBuffDurationSampleResponse {
  const icon = createDetectedIcon(targetCase, value);
  const targetDetection = {
    skillId: targetCase.targetSkillId,
    detectedCount: 1,
    detectedIcon: icon,
    candidateIcons: [icon],
  };
  return {
    sampledAt,
    boxCount: 1,
    parserRowCount: 1,
    parserEngine: "dl",
    parserVersion: "test-shared-parser",
    parserFallbackReason: null,
    detectedCount: 1,
    detectedIcon: icon,
    candidateIcons: targetDetection.candidateIcons,
    detectionsBySkillId: {
      [targetCase.targetSkillId]: targetDetection,
    },
    performance: {
      totalMs: 1,
      detectMs: 0.25,
      matchMs: 0.25,
      countdownMs: 0.25,
      countdownCount: targetCase.valueKind === "countdown" ? 1 : 0,
      countdownModelStatus:
        targetCase.valueKind === "countdown" ? "ready" : "idle",
      remainingCountMs: 0.25,
      remainingCountCount: targetCase.valueKind === "remaining-count" ? 1 : 0,
      remainingCountModelStatus:
        targetCase.valueKind === "remaining-count" ? "ready" : "idle",
      boxCount: 1,
    },
    unsupported: false,
    unsupportedReason: null,
  };
}

function createDetectedIcon(
  targetCase: SkillTargetCase,
  value: number,
): SkillBuffDurationDetectedIcon {
  return {
    boxIndex: 0,
    box: { x: 10, y: 10, size: 32, confidence: 0.99, score: 0.98 },
    icon: {
      width: 32,
      height: 32,
      data: new Uint8ClampedArray(32 * 32 * 4),
    },
    match: {
      matched: true,
      skillId: targetCase.targetSkillId,
      displayName: targetCase.target,
      detectorId: targetCase.detectorId,
      matcherEngine: "skill-bundle-v1",
      bundleId: targetCase.bundleId,
      modelVersion: targetCase.modelVersion,
      baseSkillId: targetCase.matcherSkillId,
      rawSkillId: targetCase.matcherSkillId,
      score: 0.97,
      threshold: 0.75,
      margin: 0.22,
      gateScore: 0.98,
      gateThreshold: 0.94,
      gateMargin: 0.04,
      decisionReason: "target_accepted",
    },
    countdown:
      targetCase.valueKind === "countdown"
        ? {
            kind: "exact",
            text: String(value),
            totalSeconds: value,
            format: "seconds",
            textRegion: "center",
            confidence: 0.96,
            status: "high",
            routerTarget: "center",
            routerConfidence: 0.96,
            routerStatus: "high",
          }
        : null,
    remainingCount:
      targetCase.valueKind === "remaining-count"
        ? {
            kind: "exact",
            text: String(value),
            count: value,
            expectedCount: value,
            format: "remaining-count",
            textRegion: "bottom-right",
            confidence: 0.96,
            status: "high",
            candidates: [],
          }
        : null,
  };
}

function createFrame(
  targetCase: SkillTargetCase,
  response: SkillBuffDurationSampleResponse,
): SkillBuffDurationFrameResult {
  const detectedIcon = response.detectedIcon!;
  return {
    evidenceSource: null,
    rawPreviewUrl: null,
    previewUrl: null,
    previewImageData: null,
    regionLabel: "test",
    parserRuntime: null,
    parserPerformance: null,
    parserFailure: null,
    snapshot: {
      targetSkillId: targetCase.targetSkillId,
      targetDisplayName: targetCase.target,
      detected: true,
      boxCount: 1,
      parserRowCount: 1,
      parserEngine: "dl",
      parserVersion: "test-shared-parser",
      parserFallbackReason: null,
      detectedCount: 1,
      matcherEngine: detectedIcon.match.matcherEngine ?? null,
      bundleId: detectedIcon.match.bundleId ?? null,
      modelVersion: detectedIcon.match.modelVersion ?? null,
      baseSkillId: detectedIcon.match.baseSkillId ?? null,
      rawSkillId: detectedIcon.match.rawSkillId ?? null,
      score: detectedIcon.match.score,
      threshold: detectedIcon.match.threshold,
      margin: detectedIcon.match.margin,
      gateScore: detectedIcon.match.gateScore ?? null,
      gateThreshold: detectedIcon.match.gateThreshold ?? null,
      gateMargin: detectedIcon.match.gateMargin ?? null,
      decisionReason: detectedIcon.match.decisionReason,
      countdown: detectedIcon.countdown ?? null,
      countdownModelStatus: response.performance.countdownModelStatus,
      remainingCount: detectedIcon.remainingCount ?? null,
      remainingCountModelStatus: response.performance.remainingCountModelStatus,
      performanceMs: response.performance.totalMs,
      error: null,
      candidateIcons: [
        {
          boxIndex: detectedIcon.boxIndex,
          box: detectedIcon.box,
          match: detectedIcon.match,
          countdown: detectedIcon.countdown ?? null,
          remainingCount: detectedIcon.remainingCount ?? null,
          imageDataUrl: null,
        },
      ],
    },
  };
}

function processFrame({
  frame,
  previousState,
  sampledAt,
  skill,
}: {
  frame: SkillBuffDurationFrameResult;
  previousState: SkillRuntimeState;
  sampledAt: number;
  skill: SkillConfig;
}): SkillFrameProcessResult {
  return processSkillFrameSample({
    buffDurationFrameResult: frame,
    frameLayoutKey: null,
    previousState,
    recognize: vi.fn(),
    sampleSkill: vi.fn(),
    sampledAt,
    skill,
  });
}

function createCountdownTransition(targetCase: SkillTargetCase): {
  fixture: ReturnType<typeof createClaimFixture>;
  frame: SkillBuffDurationFrameResult;
  stateBefore: SkillRuntimeState;
  processed: SkillFrameProcessResult;
} {
  if (targetCase.valueKind !== "countdown") {
    throw new Error("countdown-target-required");
  }
  const fixture = createClaimFixture(targetCase);
  let state = createRuntimeState(fixture.skill.id);
  for (let index = 0; index < 5; index += 1) {
    const sampledAt = index * 1_000;
    const response = createResponse(targetCase, {
      sampledAt,
      value: 5 - index,
    });
    state = processFrame({
      frame: createFrame(targetCase, response),
      previousState: state,
      sampledAt,
      skill: fixture.skill,
    }).state;
  }
  const stateBefore = state;
  const response = createResponse(targetCase, {
    sampledAt: 5_000,
    value: 0,
  });
  expect(
    completeSkillWarmTraceMatcher({
      warmTrace: fixture.warmTrace,
      response,
      sampledAt: 5_000,
    }),
  ).toBe(true);
  const frame = createFrame(targetCase, response);
  const processed = processFrame({
    frame,
    previousState: stateBefore,
    sampledAt: 5_000,
    skill: fixture.skill,
  });
  return { fixture, frame, stateBefore, processed };
}

function createYeinTransition(): {
  fixture: ReturnType<typeof createClaimFixture>;
  frame: SkillBuffDurationFrameResult;
  stateBefore: SkillRuntimeState;
  processed: SkillFrameProcessResult;
} {
  const targetCase = TARGET_CASES[3];
  const fixture = createClaimFixture(targetCase);
  const firstResponse = createResponse(targetCase, {
    sampledAt: 4_000,
    value: 3,
  });
  const stateBefore = processFrame({
    frame: createFrame(targetCase, firstResponse),
    previousState: createRuntimeState(fixture.skill.id),
    sampledAt: 4_000,
    skill: fixture.skill,
  }).state;
  const response = createResponse(targetCase, {
    sampledAt: 5_000,
    value: 3,
  });
  expect(
    completeSkillWarmTraceMatcher({
      warmTrace: fixture.warmTrace,
      response,
      sampledAt: 5_000,
    }),
  ).toBe(true);
  const frame = createFrame(targetCase, response);
  const processed = processFrame({
    frame,
    previousState: stateBefore,
    sampledAt: 5_000,
    skill: fixture.skill,
  });
  return { fixture, frame, stateBefore, processed };
}

function mutateInvalidResponse(
  response: SkillBuffDurationSampleResponse,
  field:
    | "sampledAt"
    | "extra-target-key"
    | "detected-count"
    | "matched"
    | "target-skill-id"
    | "detector-id"
    | "matcher-engine"
    | "bundle-id"
    | "model-version"
    | "base-skill-id"
    | "raw-skill-id"
    | "decision-reason"
    | "score"
    | "threshold"
    | "margin"
    | "margin-coherence"
    | "gate-score"
    | "gate-threshold"
    | "gate-margin"
    | "gate-margin-coherence"
    | "second-accepted-candidate"
    | "parser-engine",
): void {
  const icon = response.detectedIcon!;
  switch (field) {
    case "sampledAt":
      response.sampledAt = 4_999;
      return;
    case "extra-target-key":
      response.detectionsBySkillId!.extra = {
        skillId: "extra",
        detectedCount: 0,
        detectedIcon: null,
        candidateIcons: [],
      };
      return;
    case "detected-count":
      response.detectedCount = 2;
      return;
    case "matched":
      icon.match.matched = false;
      return;
    case "target-skill-id":
      icon.match.skillId = "other";
      return;
    case "detector-id":
      icon.match.detectorId = "other";
      return;
    case "matcher-engine":
      icon.match.matcherEngine = "prototype";
      return;
    case "bundle-id":
      icon.match.bundleId = "other";
      return;
    case "model-version":
      icon.match.modelVersion = "other";
      return;
    case "base-skill-id":
      icon.match.baseSkillId = "other";
      return;
    case "raw-skill-id":
      icon.match.rawSkillId = "other";
      return;
    case "decision-reason":
      icon.match.decisionReason = "matched";
      return;
    case "score":
      icon.match.score = 0.74;
      return;
    case "threshold":
      icon.match.threshold = Number.NaN;
      return;
    case "margin":
      icon.match.margin = -0.01;
      return;
    case "margin-coherence":
      icon.match.margin = 0.21;
      return;
    case "gate-score":
      icon.match.gateScore = 0.93;
      return;
    case "gate-threshold":
      icon.match.gateThreshold = Number.NaN;
      return;
    case "gate-margin":
      icon.match.gateMargin = -0.01;
      return;
    case "gate-margin-coherence":
      icon.match.gateMargin = 0.03;
      return;
    case "second-accepted-candidate": {
      const duplicate = {
        ...icon,
        icon: {
          ...icon.icon,
          data: new Uint8ClampedArray(icon.icon.data),
        },
      };
      response.candidateIcons.push(duplicate);
      response.detectionsBySkillId!.janusDeepV2!.candidateIcons.push(duplicate);
      return;
    }
    case "parser-engine":
      response.parserEngine = "rule";
  }
}
