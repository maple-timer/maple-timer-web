import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillSnapshot } from "../../alertTypes";
import { createDefaultProfile, createSkill } from "../../lib/storage";
import { createRuntimeState } from "../../lib/timer";
import { createSkillIssueReportSnapshotContext } from "./skillReportSnapshot";

const mocks = vi.hoisted(() => ({
  sampleSkill: vi.fn(),
  sampleGameViewportSkill: vi.fn(),
  recognize: vi.fn(),
}));

vi.mock("../../lib/capture", () => ({
  sampleSkill: mocks.sampleSkill,
}));

vi.mock("../../lib/recognition", () => ({
  getRecognitionEngine: () => ({
    recognize: mocks.recognize,
  }),
}));

vi.mock("../../platform/frame-capture/gameViewportSampling", () => ({
  sampleGameViewportSkill: mocks.sampleGameViewportSkill,
}));

describe("createSkillIssueReportSnapshotContext", () => {
  beforeEach(() => {
    mocks.sampleSkill.mockReset();
    mocks.sampleGameViewportSkill.mockReset();
    mocks.recognize.mockReset();
  });

  it("keeps an existing skill snapshot and calculates timing context", async () => {
    const skill = createSkill({
      id: "skill-1",
      name: "솔 야누스",
      alertThresholdSeconds: 5,
      region: { x: 0.1, y: 0.1, width: 0.05, height: 0.05 },
    });
    const snapshot: SkillSnapshot = {
      sampledAt: 1_000,
      rawPreviewUrl: "data:image/png;base64,raw",
      previewUrl: "data:image/png;base64,preview",
      regionLabel: "48x48",
      result: { value: 9, confidence: 0.9 },
    };
    const state = {
      ...createRuntimeState(skill.id),
      estimatedExpiresAt: 25_000,
    };

    const context = await createSkillIssueReportSnapshotContext({
      profile: { ...createDefaultProfile(), skills: [skill] },
      skillId: skill.id,
      snapshots: { [skill.id]: snapshot },
      runtimeStates: { [skill.id]: state },
      video: null,
      layoutKey: null,
      now: 10_000,
    });

    expect(context.snapshot).toBe(snapshot);
    expect(context.estimatedRemainingSeconds).toBe(15);
    expect(context.alertInSeconds).toBe(10);
    expect(mocks.sampleSkill).not.toHaveBeenCalled();
  });

  it("samples the current region when the stored snapshot is missing images", async () => {
    const skill = createSkill({
      id: "skill-1",
      name: "에르다 파운틴",
      alertThresholdSeconds: 3,
      region: { x: 0.2, y: 0.2, width: 0.04, height: 0.04 },
    });
    const video = {
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    mocks.sampleSkill.mockReturnValue({
      imageData: {} as ImageData,
      rawPreviewUrl: "data:image/png;base64,new-raw",
      previewUrl: "data:image/png;base64,new-preview",
      region: { width: 77, height: 55 },
    });
    mocks.recognize.mockReturnValue({ value: 7, confidence: 0.88 });

    const context = await createSkillIssueReportSnapshotContext({
      profile: { ...createDefaultProfile(), skills: [skill] },
      skillId: skill.id,
      snapshots: {},
      runtimeStates: {},
      video,
      layoutKey: null,
      now: 20_000,
    });

    expect(mocks.sampleSkill).toHaveBeenCalledWith(video, skill.region, true);
    expect(context.snapshot).toEqual({
      sampledAt: 20_000,
      rawPreviewUrl: "data:image/png;base64,new-raw",
      previewUrl: "data:image/png;base64,new-preview",
      regionLabel: "77x55",
      result: { value: 7, confidence: 0.88 },
    });
  });

  it("samples a missing quickslot snapshot from the calibrated game viewport", async () => {
    const skill = createSkill({
      id: "skill-1",
      name: "에르다 파운틴",
      region: { x: 0.2, y: 0.2, width: 0.04, height: 0.04 },
      regionsByLayout: {
        "game:1366x768": {
          x: 0.2,
          y: 0.2,
          width: 0.04,
          height: 0.04,
        },
      },
    });
    const video = {
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const gameViewport = {
      mode: "calibrated" as const,
      sourceSize: { width: 1920, height: 1080 },
      gameResolution: { width: 1366, height: 768 },
      region: { x: 277, y: 156, width: 1366, height: 768 },
      layoutKey: "game:1366x768",
      revision: 2,
    };
    mocks.sampleGameViewportSkill.mockReturnValue({
      imageData: {} as ImageData,
      rawPreviewUrl: "data:image/png;base64,game-raw",
      previewUrl: "data:image/png;base64,game-preview",
      region: { x: 550, y: 310, width: 40, height: 40 },
    });
    mocks.recognize.mockReturnValue({ value: 8, confidence: 0.91 });

    const context = await createSkillIssueReportSnapshotContext({
      profile: { ...createDefaultProfile(), skills: [skill] },
      skillId: skill.id,
      snapshots: {},
      runtimeStates: {},
      video,
      layoutKey: "game:1366x768",
      gameViewport,
      now: 20_000,
    });

    expect(mocks.sampleGameViewportSkill).toHaveBeenCalledWith(
      video,
      gameViewport,
      skill.regionsByLayout?.["game:1366x768"],
      true,
    );
    expect(mocks.sampleSkill).not.toHaveBeenCalled();
    expect(context.snapshot?.rawPreviewUrl).toBe(
      "data:image/png;base64,game-raw",
    );
  });

  it("uses the exact runtime evidence instead of a stale buff-duration snapshot", async () => {
    const skill = createSkill({
      id: "skill-buff-duration",
      name: "솔 야누스 : 새벽",
      presetId: "sol-janus-dawn-deep-v2",
      detectionSource: "buff-duration",
      region: { x: 0.2, y: 0.2, width: 0.04, height: 0.04 },
    });
    const snapshot: SkillSnapshot = {
      sampledAt: 19_000,
      rawPreviewUrl: "data:image/png;base64,stale-quickslot-crop",
      previewUrl: "data:image/png;base64,janus-icon",
      regionLabel: "24개 버프칸",
      result: { value: 41, confidence: 0.93 },
      buffDuration: {
        detected: true,
        boxCount: 24,
        detectedCount: 1,
        score: 0.99,
        margin: 0.04,
        decisionReason: "matched",
        countdown: null,
        countdownModelStatus: "ready",
        performanceMs: 8.4,
        error: null,
        candidateIcons: [],
      },
    };
    const runtimeSnapshot: SkillSnapshot = {
      sampledAt: 20_000,
      rawPreviewUrl: "data:image/png;base64,buff-slot-quadrant",
      previewUrl: null,
      regionLabel: "960x540 · 17개 버프칸",
      result: { value: null, confidence: 0 },
      buffDuration: {
        targetSkillId: "janusDeepV2",
        targetDisplayName: "솔 야누스: 새벽",
        detected: false,
        boxCount: 17,
        parserEngine: "dl",
        parserVersion: "test-parser-v1",
        parserFallbackReason: null,
        detectedCount: 0,
        matcherEngine: "skill-bundle-v1",
        bundleId: "skill-deep-v2",
        modelVersion: "shared-test-v2",
        baseSkillId: "janus",
        score: 1.2,
        margin: 1.5,
        gateScore: 0.92,
        gateThreshold: 0.95,
        decisionReason: "positive_gate_below_threshold",
        performanceMs: 7.5,
        error: null,
        candidateIcons: [],
      },
    };
    const runtimeState = createRuntimeState(skill.id);

    const context = await createSkillIssueReportSnapshotContext({
      profile: { ...createDefaultProfile(), skills: [skill] },
      skillId: skill.id,
      snapshots: { [skill.id]: snapshot },
      runtimeStates: {},
      video: null,
      layoutKey: null,
      now: 20_000,
      runtimeEvidence: {
        skillId: skill.id,
        snapshot: runtimeSnapshot,
        stateBefore: runtimeState,
        stateAfter: runtimeState,
        traceSample: createTraceSample(20_000),
        timeline: { samples: [], alertEvents: [] },
      },
    });

    expect(mocks.sampleSkill).not.toHaveBeenCalled();
    expect(context.snapshot).toBe(runtimeSnapshot);
    expect(context.state).toBe(runtimeState);
    expect(context.snapshot).not.toEqual(snapshot);
  });

  it("uses runtime evidence for buff-slot-only Hologram reports", async () => {
    const skill = createSkill({
      id: "skill-hologram",
      presetId: "hologram-graffiti-barrier-vi",
      region: { x: 0.2, y: 0.2, width: 0.04, height: 0.04 },
    });
    const snapshot: SkillSnapshot = {
      sampledAt: 19_000,
      rawPreviewUrl: "data:image/png;base64,stale-quickslot-crop",
      previewUrl: "data:image/png;base64,hologram-icon",
      regionLabel: "24개 버프칸",
      result: { value: 41, confidence: 0.93 },
      buffDuration: {
        detected: true,
        boxCount: 24,
        detectedCount: 1,
        score: 0.99,
        margin: 0.04,
        decisionReason: "matched",
        countdown: null,
        countdownModelStatus: "ready",
        performanceMs: 8.4,
        error: null,
        candidateIcons: [],
      },
    };
    const runtimeSnapshot: SkillSnapshot = {
      sampledAt: 20_000,
      rawPreviewUrl: "data:image/png;base64,buff-slot-quadrant",
      previewUrl: null,
      regionLabel: "960x540 · 17개 버프칸",
      result: { value: null, confidence: 0 },
      buffDuration: {
        targetSkillId: "hologramGraffitiBarrierVi",
        detected: false,
        boxCount: 17,
        detectedCount: 0,
        score: null,
        margin: null,
        decisionReason: null,
        performanceMs: 7.5,
        error: null,
        candidateIcons: [],
      },
    };
    const runtimeState = createRuntimeState(skill.id);

    const context = await createSkillIssueReportSnapshotContext({
      profile: { ...createDefaultProfile(), skills: [skill] },
      skillId: skill.id,
      snapshots: { [skill.id]: snapshot },
      runtimeStates: {},
      video: null,
      layoutKey: null,
      now: 20_000,
      runtimeEvidence: {
        skillId: skill.id,
        snapshot: runtimeSnapshot,
        stateBefore: runtimeState,
        stateAfter: runtimeState,
        traceSample: createTraceSample(20_000),
        timeline: { samples: [], alertEvents: [] },
      },
    });

    expect(mocks.sampleSkill).not.toHaveBeenCalled();
    expect(context.snapshot).toBe(runtimeSnapshot);
  });

  it("does not submit a stale quickslot crop when the report frame is unavailable", async () => {
    const skill = createSkill({
      id: "skill-buff-duration",
      name: "솔 야누스 : 새벽",
      presetId: "sol-janus-dawn-deep-v2",
      detectionSource: "buff-duration",
      region: { x: 0.2, y: 0.2, width: 0.04, height: 0.04 },
    });
    const snapshot: SkillSnapshot = {
      sampledAt: 19_000,
      rawPreviewUrl: "data:image/png;base64,stale-quickslot-crop",
      previewUrl: "data:image/png;base64,janus-icon",
      regionLabel: "24개 버프칸",
      result: { value: 41, confidence: 0.93 },
      buffDuration: {
        detected: true,
        boxCount: 24,
        detectedCount: 1,
        score: 0.99,
        margin: 0.04,
        decisionReason: "matched",
        countdown: null,
        countdownModelStatus: "ready",
        performanceMs: 8.4,
        error: null,
        candidateIcons: [],
      },
    };

    const context = await createSkillIssueReportSnapshotContext({
      profile: { ...createDefaultProfile(), skills: [skill] },
      skillId: skill.id,
      snapshots: { [skill.id]: snapshot },
      runtimeStates: {},
      video: null,
      layoutKey: null,
      now: 20_000,
    });

    expect(mocks.sampleSkill).not.toHaveBeenCalled();
    expect(context.snapshot).toBeNull();
  });
});

function createTraceSample(sampledAt: number) {
  return {
    sampledAt,
    ocrValue: null,
    confidence: 0,
    recognizedText: null,
    reason: "target-missing",
    digitCount: null,
    foregroundRatio: null,
    statusBefore: "idle",
    statusAfter: "idle",
    observedRemainingSeconds: null,
    estimatedRemainingSeconds: null,
    alertThresholdSeconds: 5,
    alertInSeconds: null,
    estimatedExpiresAt: null,
    rejectedReading: null,
    pendingShortAnchorCount: null,
    shouldFireAlert: false,
    shouldRepeatAlert: false,
    alertDecision: null,
  };
}
