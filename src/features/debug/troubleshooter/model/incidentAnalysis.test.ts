import { describe, expect, it } from "vitest";
import { analyzeIncidentEvidence } from "./incidentAnalysis";

describe("analyzeIncidentEvidence", () => {
  it("warns when a silent recognized alert lacks atomic state and playback coverage", () => {
    const result = analyzeIncidentEvidence({
      id: "incident-1",
      scenario: "recognized-no-alert",
      scenarioLabel: "인식됐지만 알림이 안 났어요",
      occurrence: "recent",
      affectedTargetLabel: null,
      evidenceSource: "mixed",
      sampledAt: 1_000,
      ageMs: 500,
      windowStartedAt: 1_000,
      windowEndedAt: 4_000,
      frameCount: 4,
      mediaCount: 1,
      stateBinding: "mixed",
      completeness: {
        sourceImage: true,
        temporalTrace: true,
        stateBeforeAfter: false,
        decision: true,
        playback: false,
      },
      journalStatus: "unavailable",
      journalCapturedAt: 900,
      journalEntryCount: 0,
      journalSelectedEventAt: null,
      correlation: {
        frameCount: 0,
        cycleCount: 0,
        playbackCount: 0,
        configRevisionCount: 0,
      },
      evidenceManifest: {
        referenceCount: 2,
        producedReferenceCount: 1,
        retainedReferenceCount: 1,
        missingReferenceIds: ["skill-playback"],
        droppedReferenceIds: [],
        unavailableReferenceIds: ["skill-playback"],
      },
    });

    expect(result.stage.status).toBe("warning");
    expect(result.diagnostics.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        "incident-mixed-evidence",
        "incident-journal-unavailable",
        "incident-required-evidence-missing",
      ])
    );
    expect(result.diagnostics.map((entry) => entry.id)).not.toContain("incident-referenced-evidence-missing");
    const missingDiagnostic = result.diagnostics.find((entry) => entry.id === "incident-required-evidence-missing");
    expect(missingDiagnostic?.detail).toContain("판정 전후 상태");
    expect(missingDiagnostic?.detail).toContain("알림 재생 기록");
  });

  it("accepts complete atomic evidence", () => {
    const result = analyzeIncidentEvidence({
      id: "incident-2",
      scenario: "late-alert",
      scenarioLabel: "늦게 울렸어요",
      occurrence: "current",
      affectedTargetLabel: "솔 야누스",
      evidenceSource: "runtime-atomic",
      sampledAt: 2_000,
      ageMs: 20,
      windowStartedAt: 1_000,
      windowEndedAt: 2_000,
      frameCount: 2,
      mediaCount: 1,
      stateBinding: "before-after",
      completeness: {
        sourceImage: true,
        temporalTrace: true,
        stateBeforeAfter: true,
        decision: true,
        playback: true,
        affectedTarget: true,
      },
      journalStatus: "current-snapshot",
      journalCapturedAt: 2_000,
      journalEntryCount: 4,
      journalSelectedEventAt: 2_000,
      correlation: {
        frameCount: 2,
        cycleCount: 1,
        playbackCount: 1,
        configRevisionCount: 1,
      },
      evidenceManifest: {
        referenceCount: 6,
        producedReferenceCount: 6,
        retainedReferenceCount: 6,
        missingReferenceIds: [],
        droppedReferenceIds: [],
        unavailableReferenceIds: [],
      },
    });

    expect(result.stage.status).toBe("complete");
    expect(result.diagnostics).toEqual([]);
  });

  it("separates playback from another alert in the same time window", () => {
    const result = analyzeIncidentEvidence({
      id: "incident-related-playback",
      scenario: "playback-missing",
      scenarioLabel: "알림 소리가 나지 않았어요",
      occurrence: "recent",
      affectedTargetLabel: "룬 알림",
      evidenceSource: "runtime-snapshot",
      sampledAt: 2_000,
      ageMs: 20,
      windowStartedAt: 1_000,
      windowEndedAt: 2_000,
      frameCount: 2,
      mediaCount: 1,
      stateBinding: "before-after",
      completeness: {
        sourceImage: true,
        temporalTrace: true,
        stateBeforeAfter: true,
        decision: true,
        playback: true,
        affectedTarget: true,
      },
      journalStatus: "matched",
      journalCapturedAt: 2_000,
      journalEntryCount: 2,
      relatedPlaybackEntryCount: 1,
      journalSelectedEventAt: 1_900,
      correlation: {
        frameCount: 1,
        cycleCount: 1,
        playbackCount: 0,
        relatedPlaybackCount: 1,
        configRevisionCount: 1,
      },
      evidenceManifest: {
        referenceCount: 5,
        producedReferenceCount: 5,
        retainedReferenceCount: 5,
        missingReferenceIds: [],
        droppedReferenceIds: [],
        unavailableReferenceIds: [],
      },
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ id: "incident-related-playback", tone: "info" }),
    );
    expect(result.stage.metrics.find((entry) => entry.id === "incident-correlation")?.value).toContain(
      "다른 재생 1",
    );
  });

  it("distinguishes compacted evidence from evidence that was never produced", () => {
    const result = analyzeIncidentEvidence({
      id: "incident-3",
      scenario: "not-recognized",
      scenarioLabel: "인식하지 못했어요",
      occurrence: "current",
      affectedTargetLabel: null,
      evidenceSource: "runtime-atomic",
      sampledAt: 2_000,
      ageMs: 20,
      windowStartedAt: 1_000,
      windowEndedAt: 2_000,
      frameCount: 2,
      mediaCount: 0,
      stateBinding: "before-after",
      completeness: {
        sourceImage: false,
        temporalTrace: true,
        stateBeforeAfter: true,
        decision: true,
        playback: true,
      },
      journalStatus: "current-snapshot",
      journalCapturedAt: 2_000,
      journalEntryCount: 2,
      journalSelectedEventAt: 2_000,
      correlation: {
        frameCount: 2,
        cycleCount: 1,
        playbackCount: 0,
        configRevisionCount: 1,
      },
      evidenceManifest: {
        referenceCount: 7,
        producedReferenceCount: 6,
        retainedReferenceCount: 5,
        missingReferenceIds: ["source", "unused"],
        droppedReferenceIds: ["source"],
        unavailableReferenceIds: ["unused"],
      },
    });

    const diagnostic = result.diagnostics.find((entry) => entry.id === "incident-referenced-evidence-missing");
    expect(diagnostic?.detail).toContain("source");
    expect(diagnostic?.detail).not.toContain("unused");
  });

  it("labels a recent atomic sample as a post-dialog frame", () => {
    const result = analyzeIncidentEvidence({
      id: "incident-recent-runtime-sample",
      scenario: "not-recognized",
      scenarioLabel: "대상을 찾지 못했어요",
      occurrence: "recent",
      affectedTargetLabel: null,
      evidenceSource: "runtime-atomic",
      sampledAt: 5_100,
      ageMs: 20,
      windowStartedAt: 1_000,
      windowEndedAt: 5_100,
      frameCount: 4,
      mediaCount: 1,
      stateBinding: "before-after",
      completeness: {
        sourceImage: true,
        temporalTrace: true,
        stateBeforeAfter: true,
        decision: true,
        playback: true,
      },
      journalStatus: "matched",
      journalCapturedAt: 5_000,
      journalEntryCount: 3,
      journalSelectedEventAt: 4_000,
      correlation: {
        frameCount: 2,
        cycleCount: 0,
        playbackCount: 0,
        configRevisionCount: 1,
      },
      evidenceManifest: {
        referenceCount: 5,
        producedReferenceCount: 5,
        retainedReferenceCount: 5,
        missingReferenceIds: [],
        droppedReferenceIds: [],
        unavailableReferenceIds: [],
      },
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        id: "incident-report-capture-after-event",
        title: "사진은 제보를 시작한 뒤 캡처됐습니다",
      }),
    );
    expect(result.stage.detail).toContain("최근 1분 사건 기록과는 별도 시점");
  });
});
