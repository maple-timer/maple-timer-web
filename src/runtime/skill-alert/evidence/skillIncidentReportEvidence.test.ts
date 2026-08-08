import { describe, expect, it } from "vitest";
import {
  freezeSkillIncidentEvidence,
} from "./skillIncidentEvidenceArchive";
import type { SkillReportIncidentSelection } from "./skillIncidentEvidenceSelection";
import { createSkillIncidentReportEvidence } from "./skillIncidentReportEvidence";
import {
  createSkillIncidentRuntimeRecorder,
  recordSkillIncidentPlaybackRequested,
  recordSkillIncidentSample,
} from "./skillIncidentRuntimeRecorder";
import type {
  SkillIncidentRuntimeState,
} from "./skillIncidentEvidenceTypes";

describe("createSkillIncidentReportEvidence", () => {
  it("projects the selected cycle relationship closure and keeps report-time context separate", () => {
    let recorder = createSkillIncidentRuntimeRecorder({ now: 0 });
    const selected = recordSkillIncidentSample({
      previous: recorder,
      input: sample({
        skillId: "selected-skill",
        sampledAt: 1_000,
        withAlert: true,
      }),
    });
    recorder = selected.recorder;
    const attempt = recordSkillIncidentPlaybackRequested({
      previous: recorder,
      decisionId: selected.decisionId!,
      requestedAt: 1_010,
      requestedMonotonicAt: 1_010,
      soundId: "ding",
      featureVolume: 0.8,
      masterVolume: 0.5,
      effectiveVolume: 0.4,
      visibilityState: "visible",
    });
    recorder = attempt.recorder;
    recorder = recordSkillIncidentSample({
      previous: recorder,
      input: sample({
        skillId: "unrelated-skill",
        sampledAt: 1_100,
        withAlert: false,
      }),
    }).recorder;
    const frozen = freezeSkillIncidentEvidence({
      archive: recorder.archive,
      selectedSkillId: "selected-skill",
      frozenAt: 1_200,
      leaseId: "lease-fixed",
    });
    const selection = createSelection({
      selectedSkillId: "selected-skill",
      cycleIds: [selected.cycleId!],
      selectedEventAt: 1_000,
    });

    const evidence = createSkillIncidentReportEvidence({
      evidence: frozen,
      selection,
      reportSampledAt: 9_000,
    });

    expect(evidence.leaseId).toBe("lease-fixed");
    expect(evidence.frames.map((entry) => entry.skillId)).toEqual([
      "selected-skill",
    ]);
    expect(evidence.observations).toHaveLength(1);
    expect(evidence.cycles.map((entry) => entry.id)).toEqual([
      selected.cycleId,
    ]);
    expect(evidence.decisions.map((entry) => entry.id)).toEqual([
      selected.decisionId,
    ]);
    expect(evidence.playbackAttempts.map((entry) => entry.id)).toEqual([
      attempt.attemptId,
    ]);
    expect(evidence.configurations).toHaveLength(1);
    expect(evidence.media).toHaveLength(1);
    expect(evidence.reportFrame).toEqual({
      id: "skill-report-time:9000",
      source: "report-time",
      sampledAt: 9_000,
      sourcePath: "sample.source",
      parserPath: "sample.parser",
      stateBeforePath: "skill.stateBefore",
      stateAfterPath: "skill.state",
    });
    expect(evidence.frames[0].sampledAt).toBe(1_000);
  });

  it("does not let report-time-only context become selected runtime evidence", () => {
    const recorder = recordSkillIncidentSample({
      previous: createSkillIncidentRuntimeRecorder({ now: 0 }),
      input: {
        ...sample({
          skillId: "skill-a",
          sampledAt: 2_000,
          withAlert: false,
        }),
        source: "report-time",
      },
    }).recorder;
    const frozen = freezeSkillIncidentEvidence({
      archive: recorder.archive,
      selectedSkillId: "skill-a",
      frozenAt: 2_100,
    });
    const selection = createSelection({
      selectedSkillId: "skill-a",
      selectedEventAt: null,
      status: "unavailable",
      support: "unsupported",
      degradationReasons: ["report-time-only"],
    });

    const evidence = createSkillIncidentReportEvidence({
      evidence: frozen,
      selection,
      reportSampledAt: 2_500,
    });

    expect(evidence.frames).toEqual([]);
    expect(evidence.observations).toEqual([]);
    expect(evidence.selection.degradationReasons).toEqual([
      "report-time-only",
    ]);
    expect(evidence.reportFrame.sampledAt).toBe(2_500);
  });

  it("caps projected media at twelve stable assets and records degradation", () => {
    const recorded = recordSkillIncidentSample({
      previous: createSkillIncidentRuntimeRecorder({ now: 0 }),
      input: sample({
        skillId: "skill-budget",
        sampledAt: 3_000,
        withAlert: false,
      }),
    });
    const baseFrame = recorded.recorder.archive.frames[0];
    const media = Array.from({ length: 14 }, (_, index) => ({
      id: `skill-media:budget:${index}`,
      frameId: baseFrame.id,
      observationId: recorded.observationId,
      skillIds: ["skill-budget"],
      targetId: "quickslot:skill-budget",
      capturedAt: 3_000 + index,
      reason:
        index === 13
          ? ("playback-failed" as const)
          : ("periodic" as const),
      variant: "quickslot-raw" as const,
      mimeType: "image/png" as const,
      dataUrl: `data:image/png;base64,budget-${index}`,
    }));
    const archive = {
      ...recorded.recorder.archive,
      frames: recorded.recorder.archive.frames.map((entry) => ({
        ...entry,
        mediaIds: media.map((item) => item.id),
      })),
      observations: recorded.recorder.archive.observations.map((entry) => ({
        ...entry,
        mediaIds: media.map((item) => item.id),
      })),
      media,
    };
    const frozen = freezeSkillIncidentEvidence({
      archive,
      selectedSkillId: "skill-budget",
      frozenAt: 4_000,
      leaseId: "lease-budget",
    });
    const selection = createSelection({
      selectedSkillId: "skill-budget",
      selectedEventAt: 3_000,
      frameIds: [recorded.frameId!],
      observationIds: [recorded.observationId!],
      cycleIds: [recorded.cycleId!],
      mediaIds: media.map((entry) => entry.id),
    });

    const evidence = createSkillIncidentReportEvidence({
      evidence: frozen,
      selection,
      reportSampledAt: 4_100,
    });

    expect(evidence.media).toHaveLength(12);
    expect(evidence.media.map((entry) => entry.id)).toContain(
      "skill-media:budget:13",
    );
    expect(evidence.selection).toMatchObject({
      support: "partial",
      degradationReasons: ["payload-compacted"],
    });
    expect(evidence.omissions).toContainEqual(
      expect.objectContaining({
        reason: "payload-compacted",
        count: 2,
      }),
    );
    expect(evidence.budget).toMatchObject({
      mediaLimitCount: 12,
      mediaCount: 12,
      overMetadataLimit: false,
      overMediaLimit: false,
      overRequestTarget: false,
    });
  });
});

function sample({
  skillId,
  sampledAt,
  withAlert,
}: {
  skillId: string;
  sampledAt: number;
  withAlert: boolean;
}) {
  const before = state();
  const after = state({
    status: withAlert ? "alerted" : "running",
    observedValue: 5,
    estimatedExpiresAt: sampledAt + 5_000,
    alertedAt: withAlert ? sampledAt : null,
    lastAlertCycleStartedAt: sampledAt,
  });
  return {
    sampledAt,
    monotonicAt: sampledAt,
    skillId,
    enabled: true,
    mode: "quickslot-countdown" as const,
    targetId: `quickslot:${skillId}`,
    epochIdentityKey: `capture:${skillId}`,
    cycleConfigurationKey: "threshold:5",
    epochReason: "normal-runtime-sample",
    provider: "main-thread",
    recognizerVersion: "fixture-v1",
    source: "runtime" as const,
    stateBefore: before,
    stateAfter: after,
    recognitionDecision: "accepted" as const,
    parser: null,
    matcher: null,
    value: {
      kind: "countdown" as const,
      rawValue: 5,
      text: "5",
      confidence: 0.99,
      decision: "accepted" as const,
      reason: "recognized",
    },
    flow: {
      confirmedValue: 5,
      expectedMin: null,
      expectedMax: null,
      decisionReason: "anchor",
      pendingDropObservations: null,
      pendingAlertObservations: null,
    },
    runtimeFailure: null,
    configuration: { skillId, threshold: 5 },
    frameReasons: withAlert ? ["alert-decision"] : ["periodic"],
    media: [
      {
        reason: withAlert ? ("alert-decision" as const) : ("periodic" as const),
        variant: "quickslot-raw" as const,
        mimeType: "image/png" as const,
        dataUrl: `data:image/png;base64,${skillId}`,
      },
    ],
    alertDecision: withAlert
      ? {
          kind: "initial" as const,
          outcome: "requested" as const,
          dueAt: sampledAt,
          dueMonotonicAt: sampledAt,
          reason: "runtime-initial-alert-due",
        }
      : null,
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

function createSelection(
  overrides: Partial<SkillReportIncidentSelection>,
): SkillReportIncidentSelection {
  return {
    policy: "skill-alert-scenario-selection-v1",
    status: "matched",
    support: "definitive",
    anchorKind: "cycle",
    selectedEventAt: 0,
    selectedSkillId: null,
    mode: "quickslot-countdown",
    targetId: null,
    epochId: null,
    candidateIds: [],
    frameIds: [],
    observationIds: [],
    cycleIds: [],
    decisionIds: [],
    arbitrationIds: [],
    attemptIds: [],
    eventIds: [],
    configurationRevisionIds: [],
    mediaIds: [],
    ambiguous: false,
    playbackStartEvidence: "not-recorded",
    physicalAudibility: "unknown",
    degradationReasons: [],
    ...overrides,
  };
}
