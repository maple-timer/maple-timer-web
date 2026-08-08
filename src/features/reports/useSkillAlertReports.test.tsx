import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillSnapshot, SkillTraceSample } from "../../alertTypes";
import { createRuntimeReportEvidenceCoordinator } from "../../application/reporting/runtimeReportEvidenceCoordinator";
import type { SkillBuffDurationRuntimeReportPayload } from "../../contracts/reporting/runtimeReportEvidencePayloads";
import { createDefaultProfile, createSkill } from "../../lib/storage";
import { createRuntimeState } from "../../lib/timer";
import { createSkillIncidentRuntimeRecorder } from "../../runtime/skill-alert/evidence/skillIncidentRuntimeRecorder";
import { useSkillAlertReports } from "./useSkillAlertReports";

const mocks = vi.hoisted(() => ({
  postDebugSample: vi.fn(),
}));

vi.mock("./reportClient", () => ({
  getOrCreateReportClientId: () => "test-client",
  postDebugSample: mocks.postDebugSample,
}));

describe("useSkillAlertReports", () => {
  beforeEach(() => {
    mocks.postDebugSample.mockReset();
    mocks.postDebugSample.mockResolvedValue({ id: "sample-1" });
  });

  it("waits for the next runtime frame before submitting a precision report", async () => {
    const skill = createSkill({
      id: "skill-janus",
      presetId: "sol-janus-dawn-deep-v2",
      enabled: true,
    });
    const profile = { ...createDefaultProfile(), skills: [skill] };
    const coordinator = createRuntimeReportEvidenceCoordinator();
    const video = {
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const runtimeState = createRuntimeState(skill.id);
    const snapshot = createRuntimeSnapshot(20_000);
    const traceSample = createTraceSample(20_000);
    const skillIncidentRecorderRef = {
      current: createSkillIncidentRuntimeRecorder({ now: 10_000 }),
    };
    const runtimePayload: SkillBuffDurationRuntimeReportPayload = {
      skillId: skill.id,
      snapshot,
      stateBefore: runtimeState,
      stateAfter: runtimeState,
      traceSample,
      timeline: { samples: [traceSample], alertEvents: [] },
    };
    const onMessage = vi.fn();
    const { result } = renderHook(() =>
      useSkillAlertReports({
        videoRef: { current: video },
        profileRef: { current: profile },
        runtimeRef: { current: { [skill.id]: runtimeState } },
        skillIncidentRecorderRef,
        skillReportTimelineRef: { current: {} },
        snapshots: {},
        currentLayoutKey: "1920x1080",
        runtimeReportEvidenceCoordinator: coordinator,
        onMessage,
      }),
    );

    act(() => {
      result.current.freezeSkillIssueReportEvidence(skill.id, 19_000);
    });

    let submission!: Promise<boolean>;
    act(() => {
      submission = result.current.submitSkillIssueReport(skill.id, {
        reason: "misread",
        label: "감지가 안돼요",
      });
    });

    expect(coordinator.hasPending({
      feature: "skill-buff-duration",
      targetId: skill.id,
    })).toBe(true);
    expect(mocks.postDebugSample).not.toHaveBeenCalled();

    const reportSampledAt = Date.now() + 1;
    act(() => {
      coordinator.publish({
        target: { feature: "skill-buff-duration", targetId: skill.id },
        sampledAt: reportSampledAt,
        source: {
          kind: "buff-slot-top-right-quadrant-v1",
          parserInputMode: "topRightQuadrant",
          coordinateSpace: "capture-pixels",
          sourceSize: { width: 1920, height: 1080 },
          roi: { x: 960, y: 0, width: 960, height: 540 },
          dataUrl: "data:image/png;base64,runtime-roi",
        },
        parser: {
          engine: "dl",
          version: "buff-slot-parser-test-v1",
          fallbackReason: null,
        },
        payload: runtimePayload,
      });
    });

    await expect(submission).resolves.toBe(true);
    expect(mocks.postDebugSample).toHaveBeenCalledTimes(1);
    const submitted = mocks.postDebugSample.mock.calls[0]?.[0];
    expect(submitted.sample).toMatchObject({
      sampledAt: 20_000,
      source: {
        parserInputMode: "topRightQuadrant",
        dataUrl: "data:image/png;base64,runtime-roi",
      },
      parser: {
        engine: "dl",
        version: "buff-slot-parser-test-v1",
        fallbackReason: null,
      },
    });
    expect(submitted.skill.runtimeTimeline.samples).toEqual([traceSample]);
    expect(submitted.sample.skillEvidence).toMatchObject({
      selectedSkillId: skill.id,
      frozenAt: 19_000,
      reportFrame: {
        source: "report-time",
        sampledAt: reportSampledAt,
      },
    });
    expect(submitted.incident).toMatchObject({
      evidence: {
        source: "report-capture",
        sampledAt: null,
        stateBinding: "unavailable",
        mediaCount: 0,
      },
      completeness: {
        sourceImage: false,
        temporalTrace: false,
        stateBeforeAfter: false,
        decision: false,
        playback: false,
        affectedTarget: true,
      },
    });
    expect(onMessage).toHaveBeenLastCalledWith("제보를 보냈습니다.");
  });

  it("reuses the open-time evidence lease after a failed submission", async () => {
    const skill = createSkill({
      id: "skill-quickslot",
      name: "퀵슬롯 스킬",
      enabled: true,
    });
    const profile = { ...createDefaultProfile(), skills: [skill] };
    const runtimeState = createRuntimeState(skill.id);
    const snapshot: SkillSnapshot = {
      sampledAt: 11_000,
      rawPreviewUrl: "data:image/png;base64,quickslot-raw",
      previewUrl: "data:image/png;base64,quickslot-processed",
      regionLabel: "32x32",
      result: { value: 7, confidence: 0.97 },
    };
    const skillIncidentRecorderRef = {
      current: createSkillIncidentRuntimeRecorder({ now: 9_000 }),
    };
    const { result } = renderHook(() =>
      useSkillAlertReports({
        videoRef: { current: null },
        profileRef: { current: profile },
        runtimeRef: { current: { [skill.id]: runtimeState } },
        skillIncidentRecorderRef,
        skillReportTimelineRef: { current: {} },
        snapshots: { [skill.id]: snapshot },
        currentLayoutKey: "1920x1080",
        runtimeReportEvidenceCoordinator:
          createRuntimeReportEvidenceCoordinator(),
        onMessage: vi.fn(),
      }),
    );
    const issue = {
      reason: "skill-not-detected",
      label: "감지가 안돼요",
      scenario: "not-recognized" as const,
      occurrence: "recent" as const,
    };

    act(() => {
      result.current.freezeSkillIssueReportEvidence(skill.id, 10_000);
    });
    mocks.postDebugSample.mockRejectedValueOnce(new Error("network-failed"));

    await expect(
      result.current.submitSkillIssueReport(skill.id, issue),
    ).resolves.toBe(false);
    await expect(
      result.current.submitSkillIssueReport(skill.id, issue),
    ).resolves.toBe(true);

    const firstLease = mocks.postDebugSample.mock.calls[0]?.[0].sample
      .skillEvidence.leaseId;
    const retryLease = mocks.postDebugSample.mock.calls[1]?.[0].sample
      .skillEvidence.leaseId;
    expect(retryLease).toBe(firstLease);

    act(() => {
      result.current.clearSkillIssueReportEvidence();
      result.current.freezeSkillIssueReportEvidence(skill.id, 12_000);
    });
    await expect(
      result.current.submitSkillIssueReport(skill.id, issue),
    ).resolves.toBe(true);
    expect(
      mocks.postDebugSample.mock.calls[2]?.[0].sample.skillEvidence.leaseId,
    ).not.toBe(firstLease);
  });
});

function createRuntimeSnapshot(sampledAt: number): SkillSnapshot {
  return {
    sampledAt,
    rawPreviewUrl: "data:image/png;base64,runtime-roi",
    previewUrl: null,
    regionLabel: "960x540 · 17개 버프칸",
    result: { value: null, confidence: 0 },
    buffDuration: {
      targetSkillId: "janusDeepV2",
      targetDisplayName: "솔 야누스: 새벽",
      detected: false,
      boxCount: 17,
      parserEngine: "dl",
      parserVersion: "buff-slot-parser-test-v1",
      parserFallbackReason: null,
      detectedCount: 0,
      score: null,
      margin: null,
      decisionReason: null,
      performanceMs: 7.5,
      error: null,
      candidateIcons: [],
    },
  };
}

function createTraceSample(sampledAt: number): SkillTraceSample {
  return {
    sampledAt,
    ocrValue: null,
    confidence: 0,
    recognizedText: null,
    reason: "buff-duration-target-missing",
    digitCount: null,
    foregroundRatio: null,
    statusBefore: "idle",
    statusAfter: "idle",
    observedRemainingSeconds: null,
    observedRemainingCount: null,
    estimatedRemainingSeconds: null,
    alertThresholdSeconds: 5,
    alertInSeconds: null,
    alertInCount: null,
    estimatedExpiresAt: null,
    rejectedReading: null,
    pendingShortAnchorCount: null,
    shouldFireAlert: false,
    shouldRepeatAlert: false,
    alertDecision: null,
  };
}
