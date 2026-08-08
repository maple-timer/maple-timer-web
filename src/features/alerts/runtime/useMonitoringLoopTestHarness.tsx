import { cleanup } from "@testing-library/react";
import type { MutableRefObject, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { vi } from "vitest";
import type {
  HuntStallRuntimeState,
  HuntStallSnapshot,
  RuneRuntimeState,
  RuneSnapshot,
  SkillReportTimeline,
  SkillSnapshot,
} from "../../../alertTypes";
import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryBox,
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
  BuffExpiryTemporalCandidateMatch,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type {
  BoosterExpiryRuntimeState,
  BoosterExpirySnapshot,
} from "../../../lib/boosterExpiry/boosterExpiryTypes";
import {
  createSpecialCoreRuntimeState,
  type SpecialCoreRuntimeState,
  type SpecialCoreSnapshot,
} from "../../../lib/specialCore";
import {
  createSpecialCoreAlertEngine,
} from "../../../platform/runtime-workers/special-core/specialCoreAlertWorkerClient";
import { createBoosterExpiryWorkerClient } from "../../../platform/runtime-workers/booster-expiry/boosterExpiryWorkerClient";
import { createBuffExpiryPrecisionEngine } from "../../../platform/runtime-workers/buff-expiry/buffExpiryPrecisionWorkerClient";
import { createBuffSlotAnalysisEngine } from "../../../platform/runtime-workers/buff-slot-analysis/buffSlotAnalysisWorkerClient";
import { createHuntStallCooldownWorkerClient } from "../../../platform/runtime-workers/hunt-stall-cooldown/huntStallCooldownWorkerClient";
import { captureManualExperienceCropFromVideo } from "../../../lib/huntStallManualExperienceSampling";
import { createHuntStallOcrEngine } from "../../../lib/huntStallOcrEngine";
import { SUPPORTED_BUFF_EXPIRY_BUFF_IDS } from "../../../domain/buff-expiry/catalog";
import { createBuffExpiryRuntimeState } from "../../../lib/buffExpiry/buffExpiryRuntimeState";
import { getBuffExpiryRemainingSeconds } from "../../../lib/buffExpiry/buffExpiryRuntimeTiming";
import { createBoosterExpiryRuntimeState } from "../../../lib/boosterExpiry/boosterExpiryRuntime";
import {
  playAlert,
  playAlertFromOffset,
  playAlertUntilEnded,
  preloadAlertFromOffset,
} from "../../../lib/alert";
import { sampleBuffSlotVideoFrame } from "../../../lib/buffSlotParser/buffSlotFrameCapture";
import { sampleSkill, sampleVideoRegion } from "../../../lib/capture";
import { cropRuneCandidateToUrl, imageDataToUrl } from "../../../lib/imageData";
import { createDefaultProfile, createSkill } from "../../../lib/profileFactory";
import { getRecognitionEngine, type RecognitionEngine } from "../../../lib/recognition";
import { createRuneRuntimeState } from "../../../lib/runeAlert";
import {
  createDefaultBuffExpiryAlert,
  createDefaultBoosterExpiryAlert,
  createDefaultHuntStallAlert,
  createDefaultRuneAlert,
  createDefaultSpecialCoreAlert,
} from "../../../lib/storage";
import { createRuneMaskPreview, detectRuneInMinimap } from "../../../lib/runeDetection";
import { createRuntimeState } from "../../../lib/timer";
import type { Profile, SkillRuntimeState } from "../../../types";
import { useMonitoringLoop } from "./useMonitoringLoop";
import { useSpecialCoreAlertScheduler } from "./useSpecialCoreAlertScheduler";
import type { RuntimeReportEvidenceCoordinator } from "../../../contracts/reporting/runtimeReportEvidence";
import type { AlertIncidentJournal } from "../../../application/reporting/alertIncidentJournal";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import type { PrecisionParserInputTransport } from "../../../contracts/recognition/precisionParserInputTransport";
import type { RemoteRecognitionParserFrameProvider } from "../../../contracts/remote-recognition/remoteRecognitionControlContract";
import type {
  RemoteRecognitionWarmTraceBuffSchedulerPort,
  RemoteRecognitionWarmTraceBuffTemporalPort,
  RemoteRecognitionWarmTracePort,
} from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import { createBuffExpiryIncidentRuntimeRecorder } from "../../../runtime/buff-expiry/evidence/buffExpiryIncidentRuntimeRecorder";
import {
  createSkillIncidentRuntimeRecorder,
  type SkillIncidentRuntimeRecorder,
} from "../../../runtime/skill-alert/evidence/skillIncidentRuntimeRecorder";
import {
  createHuntStallIncidentRuntimeRecorder,
  type HuntStallIncidentRuntimeRecorder,
} from "../../../runtime/hunt-stall/evidence/huntStallIncidentRuntimeRecorder";
import {
  createSpecialCoreIncidentRuntimeRecorder,
  type SpecialCoreIncidentRuntimeRecorder,
} from "../../../runtime/special-core/evidence/specialCoreIncidentRuntimeRecorder";
import {
  createBoosterExpiryIncidentRuntimeRecorder,
  type BoosterExpiryIncidentRuntimeRecorder,
} from "../../../runtime/booster-expiry/evidence/boosterExpiryIncidentRuntimeRecorder";
import {
  createUltimaRaidEquipmentRuntimeState,
  type UltimaRaidEquipmentRuntimeState,
} from "../../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import type { UltimaRaidEquipmentSnapshot } from "../../../runtime/ultima-raid-equipment/ultimaRaidEquipmentSnapshot";
import { createUltimaRaidEquipmentIncidentArchive } from "../../../runtime/ultima-raid-equipment/evidence/ultimaRaidEquipmentIncidentEvidence";

const monitoringLoopHoistedMocks = vi.hoisted(() => ({
  buffExpiryPrecisionEngineMock: {
    process: vi.fn(),
    reset: vi.fn(),
    preload: vi.fn(),
  },
  buffSlotAnalysisEngineMock: {
    process: vi.fn(),
    reset: vi.fn(),
  },
  buffExpiryPreviewMock: {
    createBuffExpiryBoxPreviewUrls: vi.fn(() => ({})),
    createBuffExpiryNormalizedBoxPreviewUrls: vi.fn(() => ({})),
    createBuffExpiryNormalizedBoxPreviewImageData: vi.fn(() => ({})),
    createBuffExpiryProcessedPreview: vi.fn(() => "processed-preview"),
  },
  huntStallCooldownWorkerMock: {
    process: vi.fn(),
    reset: vi.fn(),
  },
  huntStallOcrEngineMock: {
    processCrop: vi.fn(),
    reset: vi.fn(),
    sample: vi.fn(),
  },
  boosterExpiryWorkerMock: {
    process: vi.fn(),
    reset: vi.fn(),
  },
  skillBuffDurationEngineMock: {
    process: vi.fn(),
    reset: vi.fn(),
  },
  specialCoreAlertEngineMock: {
    process: vi.fn(),
    reset: vi.fn(),
  },
  encodeVp8ParserFrameMock: vi.fn(),
  runeDetectionWorkerClientMock: {
    detect: vi.fn(),
    reset: vi.fn(),
  },
}));

export const {
  boosterExpiryWorkerMock,
  buffExpiryPrecisionEngineMock,
  buffSlotAnalysisEngineMock,
  buffExpiryPreviewMock,
  huntStallCooldownWorkerMock,
  huntStallOcrEngineMock,
  runeDetectionWorkerClientMock,
  skillBuffDurationEngineMock,
  specialCoreAlertEngineMock,
  encodeVp8ParserFrameMock,
} = monitoringLoopHoistedMocks;

vi.mock("../../../lib/alert", () => ({
  playAlert: vi.fn().mockResolvedValue(undefined),
  playAlertFromOffset: vi.fn().mockResolvedValue(undefined),
  playAlertUntilEnded: vi.fn().mockResolvedValue(undefined),
  preloadAlertFromOffset: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../platform/remote-recognition/vp8ParserPreviewCodec", () => ({
  encodeVp8ParserFrame: monitoringLoopHoistedMocks.encodeVp8ParserFrameMock,
}));

vi.mock("../../../lib/capture", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/capture")>("../../../lib/capture");
  return {
    ...actual,
    sampleSkill: vi.fn(),
    sampleVideoRegion: vi.fn(),
  };
});

vi.mock("../../../lib/canvasImage", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/canvasImage")>(
    "../../../lib/canvasImage",
  );
  return {
    ...actual,
    imageDataToCanvas: vi.fn(() => null),
    imageDataToUrl: vi.fn(() => "data:image/png;base64,canvas-image"),
  };
});

vi.mock("../../../lib/huntStallOcrEngine", () => ({
  createHuntStallOcrEngine: vi.fn(() => monitoringLoopHoistedMocks.huntStallOcrEngineMock),
}));

vi.mock("../../../lib/huntStallManualExperienceSampling", () => ({
  captureManualExperienceCropFromVideo: vi.fn(() => ({
    imageData: new ImageData(4, 4),
    displayPreviewImageData: new ImageData(4, 4),
    frameReadMs: 0,
    fullFramePreviewMs: null,
    displayPreviewUrl: "data:image/png;base64,hunt-display",
    fullFramePreviewUrl: null,
    rawPreviewUrl: "data:image/png;base64,hunt-raw",
    regionLabel: "manual-experience",
    regionPixels: { x: 0, y: 0, width: 4, height: 4 },
  })),
}));

vi.mock(
  "../../../platform/runtime-workers/hunt-stall-cooldown/huntStallCooldownWorkerClient",
  () => ({
    createHuntStallCooldownWorkerClient: vi.fn(
      () => monitoringLoopHoistedMocks.huntStallCooldownWorkerMock,
    ),
  }),
);

vi.mock("../../../platform/runtime-workers/booster-expiry/boosterExpiryWorkerClient", () => ({
  createBoosterExpiryWorkerClient: vi.fn(
    () => monitoringLoopHoistedMocks.boosterExpiryWorkerMock,
  ),
}));

vi.mock("../../../lib/buffExpiry/buffExpiryPreview", () => ({
  createBuffExpiryBoxPreviewUrls:
    monitoringLoopHoistedMocks.buffExpiryPreviewMock.createBuffExpiryBoxPreviewUrls,
  createBuffExpiryNormalizedBoxPreviewUrls:
    monitoringLoopHoistedMocks.buffExpiryPreviewMock.createBuffExpiryNormalizedBoxPreviewUrls,
  createBuffExpiryNormalizedBoxPreviewImageData:
    monitoringLoopHoistedMocks.buffExpiryPreviewMock.createBuffExpiryNormalizedBoxPreviewImageData,
  createBuffExpiryProcessedPreview:
    monitoringLoopHoistedMocks.buffExpiryPreviewMock.createBuffExpiryProcessedPreview,
}));

vi.mock("../../../platform/frame-capture/buff-expiry/buffExpiryPrecisionCapture", () => ({
  sampleBuffExpiryPrecisionVideoFrame: vi.fn(() => ({
    imageData: new ImageData(1, 1),
    roi: { x: 0, y: 0, width: 1, height: 1 },
    rawPreviewUrl: null,
    fullFramePreviewUrl: null,
  })),
}));

vi.mock("../../../platform/runtime-workers/buff-expiry/buffExpiryPrecisionWorkerClient", () => ({
  createBuffExpiryPrecisionEngine: vi.fn(() => ({
    process: monitoringLoopHoistedMocks.buffExpiryPrecisionEngineMock.process,
    reset: monitoringLoopHoistedMocks.buffExpiryPrecisionEngineMock.reset,
    preload: monitoringLoopHoistedMocks.buffExpiryPrecisionEngineMock.preload,
  })),
}));

vi.mock("../../../platform/runtime-workers/buff-slot-analysis/buffSlotAnalysisWorkerClient", () => ({
  createBuffSlotAnalysisEngine: vi.fn(() => ({
    process: monitoringLoopHoistedMocks.buffSlotAnalysisEngineMock.process,
    reset: monitoringLoopHoistedMocks.buffSlotAnalysisEngineMock.reset,
  })),
}));

vi.mock("../../../lib/boosterExpiry/boosterExpiryCapture", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/boosterExpiry/boosterExpiryCapture")
  >("../../../lib/boosterExpiry/boosterExpiryCapture");
  return {
    ...actual,
    sampleBoosterExpiryVideoFrame: vi.fn(() => ({
      imageData: new ImageData(4, 4),
      rawPreviewUrl: "data:image/png;base64,booster-top",
      region: { x: 0, y: 0, width: 1280, height: 180 },
    })),
    cloneImageData: vi.fn((imageData: ImageData) => imageData),
    createBoosterExpiryTimerPreviewUrl: vi.fn(() => "data:image/png;base64,booster-timer"),
  };
});

vi.mock("../../../lib/buffSlotParser/buffSlotFrameCapture", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/buffSlotParser/buffSlotFrameCapture")
  >("../../../lib/buffSlotParser/buffSlotFrameCapture");
  return {
    ...actual,
    sampleBuffSlotVideoFrame: vi.fn(() => ({
      imageData: new ImageData(4, 4),
      rawPreviewUrl: "data:image/png;base64,skill-buff-slot",
      regionLabel: "2x2",
      sourceSize: { width: 4, height: 4 },
      roi: { x: 2, y: 0, width: 2, height: 2 },
    })),
  };
});

vi.mock(
  "../../../platform/runtime-workers/special-core/specialCoreAlertWorkerClient",
  () => ({
    createSpecialCoreAlertEngine: vi.fn(
      () => monitoringLoopHoistedMocks.specialCoreAlertEngineMock,
    ),
  }),
);

vi.mock("../../../lib/imageData", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/imageData")>("../../../lib/imageData");
  return {
    ...actual,
    cropRuneCandidateToUrl: vi.fn(),
    imageDataToUrl: vi.fn(),
  };
});

vi.mock("../../../lib/recognition", () => ({
  getRecognitionEngine: vi.fn(),
}));

vi.mock("../../../platform/runtime-workers/skill-precision/skillPrecisionWorkerClient", async () => {
  const actual = await vi.importActual<
    typeof import("../../../platform/runtime-workers/skill-precision/skillPrecisionWorkerClient")
  >("../../../platform/runtime-workers/skill-precision/skillPrecisionWorkerClient");
  return {
    ...actual,
    createSkillBuffDurationEngine: vi.fn(() => monitoringLoopHoistedMocks.skillBuffDurationEngineMock),
  };
});

vi.mock("../../../platform/runtime-workers/rune/runeDetectionWorkerClient", async () => {
  const actual = await vi.importActual<
    typeof import("../../../platform/runtime-workers/rune/runeDetectionWorkerClient")
  >(
    "../../../platform/runtime-workers/rune/runeDetectionWorkerClient",
  );
  return {
    ...actual,
    createRuneDetectionWorkerClient: vi.fn(
      () => monitoringLoopHoistedMocks.runeDetectionWorkerClientMock,
    ),
  };
});

vi.mock("../../../lib/runeDetection", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/runeDetection")>(
    "../../../lib/runeDetection",
  );
  return {
    ...actual,
    createRuneMaskPreview: vi.fn(),
    detectRuneInMinimap: vi.fn(),
  };
});

export const createBoosterExpiryWorkerClientMock = vi.mocked(createBoosterExpiryWorkerClient);
export const createBuffExpiryPrecisionEngineMock = vi.mocked(createBuffExpiryPrecisionEngine);
export const createBuffSlotAnalysisEngineMock = vi.mocked(createBuffSlotAnalysisEngine);
export const createHuntStallCooldownWorkerClientMock = vi.mocked(createHuntStallCooldownWorkerClient);
export const createHuntStallOcrEngineMock = vi.mocked(createHuntStallOcrEngine);
export const createSpecialCoreAlertEngineMock = vi.mocked(createSpecialCoreAlertEngine);

export type HarnessApi = {
  buffExpiryRuntimeRef: MutableRefObject<BuffExpiryRuntimeState>;
  buffExpirySnapshotRef: MutableRefObject<BuffExpirySnapshot | null>;
  boosterExpiryRuntimeRef: MutableRefObject<BoosterExpiryRuntimeState>;
  boosterExpirySnapshotRef: MutableRefObject<BoosterExpirySnapshot | null>;
  boosterExpiryIncidentRecorderRef: MutableRefObject<BoosterExpiryIncidentRuntimeRecorder>;
  specialCoreRuntimeRef: MutableRefObject<SpecialCoreRuntimeState>;
  specialCoreSnapshotRef: MutableRefObject<SpecialCoreSnapshot | null>;
  specialCoreIncidentRecorderRef: MutableRefObject<SpecialCoreIncidentRuntimeRecorder>;
  handleMetadata: ReturnType<typeof vi.fn>;
  huntStallRuntimeRef: MutableRefObject<HuntStallRuntimeState>;
  huntStallIncidentRecorderRef: MutableRefObject<HuntStallIncidentRuntimeRecorder>;
  lastAlertErrorRef: MutableRefObject<string | null>;
  onMessage: ReturnType<typeof vi.fn>;
  onNoStream: ReturnType<typeof vi.fn>;
  runeRuntimeRef: MutableRefObject<RuneRuntimeState>;
  runeSnapshotRef: MutableRefObject<RuneSnapshot | null>;
  ultimaRaidEquipmentRuntimeRef: MutableRefObject<UltimaRaidEquipmentRuntimeState>;
  ultimaRaidEquipmentSnapshotRef: MutableRefObject<UltimaRaidEquipmentSnapshot | null>;
  runtimeRef: MutableRefObject<Record<string, SkillRuntimeState>>;
  skillIncidentRecorderRef: MutableRefObject<SkillIncidentRuntimeRecorder>;
  setHuntStallRuntime: ReturnType<typeof vi.fn>;
  setHuntStallSnapshot: ReturnType<typeof vi.fn>;
  setBoosterExpiryRuntime: ReturnType<typeof vi.fn>;
  setBoosterExpirySnapshot: ReturnType<typeof vi.fn>;
  setSpecialCoreRuntime: ReturnType<typeof vi.fn>;
  setSpecialCoreSnapshot: ReturnType<typeof vi.fn>;
  setBuffExpiryRuntime: ReturnType<typeof vi.fn>;
  setBuffExpirySnapshot: ReturnType<typeof vi.fn>;
  setBuffExpiryPrecisionPreloadStatus: ReturnType<typeof vi.fn>;
  setRuneRuntime: ReturnType<typeof vi.fn>;
  setRuneSnapshot: ReturnType<typeof vi.fn>;
  setUltimaRaidEquipmentRuntime: ReturnType<typeof vi.fn>;
  setUltimaRaidEquipmentSnapshot: ReturnType<typeof vi.fn>;
  setRuntimeStates: ReturnType<typeof vi.fn>;
  setSnapshots: ReturnType<typeof vi.fn>;
  skillReportTimelineRef: MutableRefObject<Record<string, SkillReportTimeline>>;
};

export const sampleSkillMock = vi.mocked(sampleSkill);
export const captureManualExperienceCropFromVideoMock = vi.mocked(
  captureManualExperienceCropFromVideo,
);
export const sampleBuffSlotVideoFrameMock = vi.mocked(sampleBuffSlotVideoFrame);
export const sampleVideoRegionMock = vi.mocked(sampleVideoRegion);
export const playAlertMock = vi.mocked(playAlert);
export const playAlertFromOffsetMock = vi.mocked(playAlertFromOffset);
export const playAlertUntilEndedMock = vi.mocked(playAlertUntilEnded);
export const preloadAlertFromOffsetMock = vi.mocked(preloadAlertFromOffset);
export const cropRuneCandidateToUrlMock = vi.mocked(cropRuneCandidateToUrl);
export const imageDataToUrlMock = vi.mocked(imageDataToUrl);
export const getRecognitionEngineMock = vi.mocked(getRecognitionEngine);
export const createRuneMaskPreviewMock = vi.mocked(createRuneMaskPreview);
export const detectRuneInMinimapMock = vi.mocked(detectRuneInMinimap);

export function createTestImageData(width = 4, height = 4): ImageData {
  return new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
}

export function createRecognitionEngine(
  recognize: RecognitionEngine["recognize"] = vi.fn().mockReturnValue({
    value: null,
    confidence: 0,
    debug: { reason: "not-configured" },
  }),
): RecognitionEngine {
  return {
    id: "test-recognition",
    label: "Test recognition",
    recognize,
  };
}

export function createBoosterExpiryTime(seconds: number) {
  return {
    ok: true,
    reason: "ok",
    rect: { x: 100, y: 20, width: 120, height: 36 },
    digitCount: 4,
    seconds,
    text: seconds >= 60
      ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
      : `${seconds}.00`,
    format: seconds >= 60 ? "m:ss" : "ss.cc",
    selectedBy: "test",
  };
}

export function createBoosterExpiryWorkerResult(seconds: number | null) {
  const time = seconds === null ? null : createBoosterExpiryTime(seconds);
  return {
    rawTime: time,
    time,
    timeRect: {
      ok: seconds !== null,
      reason: seconds !== null ? "ok" : "no-timer",
      rect: seconds !== null ? { x: 100, y: 20, width: 120, height: 36 } : null,
      matchCount: seconds !== null ? 1 : 0,
      candidateCount: seconds !== null ? 1 : 0,
    },
    flow: {
      locked: seconds !== null,
      source: seconds !== null ? "raw-lock" : "none",
      predictedSeconds: seconds,
      rawDeltaSeconds: null,
      timestampMs: 0,
    },
  };
}

export const BUFF_EXPIRY_BOX: BuffExpiryBox = {
  x: 10,
  y: 20,
  width: 34,
  height: 34,
  confidence: 0.99,
  side: 34,
};

export function createBuffExpiryMatch(seconds: number): BuffExpiryAcceptedMatch {
  return {
    box: BUFF_EXPIRY_BOX,
    buffId: "union_wealth",
    name: "유니온의 부 III",
    seconds,
    score: 0.98,
    buffMargin: 0.2,
    secondMargin: 0.2,
    reason: "accepted",
    strength: "strong",
    topMatches: [],
  };
}

export function createBuffExpiryTemporalCandidateMatch(
  seconds: number,
  box: BuffExpiryBox,
  buffId = "union_wealth_group",
): BuffExpiryTemporalCandidateMatch {
  return {
    box,
    buffId,
    name: buffId,
    seconds,
    score: 0.91,
    buffMargin: 0.01,
    secondMargin: 0.01,
    reason: "temporal-low-score",
    strength: "weak",
    topMatches: [],
  };
}

export function createBuffExpiryPrecisionSampleResponse(seconds: number) {
  return {
    boxes: [
      {
        x: 10,
        y: 20,
        size: 32,
        row: 1,
        col: 0,
        confidence: 0.99,
        score: 0.98,
      },
    ],
    icons: [
      {
        width: 32,
        height: 32,
        data: new Uint8ClampedArray(32 * 32 * 4),
      },
    ],
    iconObservations: [
      {
        id: "slot:0",
        boxIndex: 0,
        box: {
          x: 10,
          y: 20,
          size: 32,
          row: 1,
          col: 0,
          confidence: 0.99,
          score: 0.98,
        },
        identity: {
          kind: "target" as const,
          group: "unionWealth" as const,
          score: 2,
          margin: 1,
          decisionReason: "target-accepted",
          bestTargetName: "유니온의 부",
          bestExcludedName: null,
        },
        countdown: {
          kind: "exact" as const,
          text: String(seconds),
          totalSeconds: seconds,
          format: "seconds" as const,
          textRegion: "center" as const,
          confidence: 0.96,
          status: "high" as const,
          routerTarget: "center",
          routerConfidence: 0.96,
          routerStatus: "high",
        },
      },
    ],
    bestByGroup: [],
    parserEngine: "rule" as const,
    parserFallbackReason: "webgpu-unavailable",
    moduleVersions: {
      runtime: "test",
      parser: "test",
      matcher: "test",
      matcherModel: "test",
      countdown: "test",
    },
    unsupported: false as const,
    unsupportedReason: null,
    performance: {
      totalMs: 0,
      detectMs: 0,
      matchMs: 0,
      countdownMs: 0,
      countdownCount: 1,
      countdownModelStatus: "ready" as const,
      boxCount: 1,
    },
  };
}

export function createSkillBuffDurationSampleResponse({
  remainingCount,
  seconds,
  skillId = "janus",
  target,
}: {
  remainingCount?: number | null;
  seconds: number | null;
  skillId?: string;
  target?: "janus" | "hologram-graffiti-barrier" | "fountain" | "yein";
}) {
  const warmTarget = target ? SKILL_WARM_FIXTURE_TARGETS[target] : null;
  const resolvedSkillId = warmTarget?.targetSkillId ?? skillId;
  const countdown = seconds === null
    ? null
    : {
        kind: "exact" as const,
        text: String(seconds),
        totalSeconds: seconds,
        format: "seconds" as const,
        textRegion: "center" as const,
        confidence: 0.96,
        status: "high" as const,
        routerTarget: "center",
        routerConfidence: 0.96,
        routerStatus: "high",
      };
  const remainingCountObservation = remainingCount == null
    ? null
    : {
        kind: "exact" as const,
        text: String(remainingCount),
        count: remainingCount,
        expectedCount: remainingCount,
        format: "remaining-count" as const,
        textRegion: "bottom-right" as const,
        confidence: 0.97,
        status: "high" as const,
        candidates: [
          {
            text: String(remainingCount),
            count: remainingCount,
            probability: 0.97,
          },
        ],
      };
  const detectedIcon = {
    boxIndex: 0,
    box: {
      x: 120,
      y: 40,
      size: 32,
      confidence: 0.98,
      score: 0.97,
    },
    icon: {
      width: 32,
      height: 32,
      data: new Uint8ClampedArray(32 * 32 * 4),
    },
    match: {
      matched: true,
      skillId: resolvedSkillId,
      displayName: resolvedSkillId,
      detectorId: warmTarget?.detectorId ?? resolvedSkillId,
      matcherEngine: warmTarget ? "skill-bundle-v1" : null,
      bundleId: warmTarget?.bundleId ?? null,
      modelVersion: warmTarget?.modelVersion ?? null,
      baseSkillId: warmTarget?.matcherSkillId ?? resolvedSkillId,
      rawSkillId: warmTarget?.matcherSkillId ?? resolvedSkillId,
      score: 0.95,
      threshold: 0.5,
      margin: warmTarget ? 0.45 : 0.4,
      gateScore: warmTarget ? 0.94 : null,
      gateThreshold: warmTarget ? 0.8 : null,
      gateMargin: warmTarget ? 0.14 : null,
      decisionReason: warmTarget ? "target_accepted" : "target",
    },
    countdown,
    remainingCount: remainingCountObservation,
  };

  return {
    sampledAt: null,
    boxCount: 1,
    parserEngine: "dl" as const,
    parserVersion: "test-shared-parser",
    parserFallbackReason: null,
    detectedCount: 1,
    detectedIcon,
    candidateIcons: [detectedIcon],
    detectionsBySkillId: {
      [resolvedSkillId]: {
        skillId: resolvedSkillId,
        detectedCount: 1,
        detectedIcon,
        candidateIcons: [detectedIcon],
      },
    },
    performance: {
      totalMs: 1,
      detectMs: 1,
      matchMs: 0,
      countdownMs: 0,
      countdownCount: countdown ? 1 : 0,
      countdownModelStatus: "ready" as const,
      remainingCountMs: 0,
      remainingCountCount: remainingCountObservation ? 1 : 0,
      remainingCountModelStatus: remainingCountObservation
        ? ("ready" as const)
        : ("idle" as const),
      boxCount: 1,
    },
    unsupported: false as const,
    unsupportedReason: null,
  };
}

const SKILL_WARM_FIXTURE_TARGETS = {
  janus: {
    targetSkillId: "janusDeepV2",
    matcherSkillId: "janus",
    detectorId: "skill-deep-v2:janus",
    bundleId: "skill-deep-v2",
    modelVersion: "confirmed-bg-v1-seed20260632-r2-positive-gates-v3",
  },
  "hologram-graffiti-barrier": {
    targetSkillId: "hologramGraffitiBarrierVi",
    matcherSkillId: "barrier",
    detectorId: "hologramGraffitiBarrierVi",
    bundleId: "skill-deep-v2",
    modelVersion: "confirmed-bg-v1-seed20260632-r2-positive-gates-v3",
  },
  fountain: {
    targetSkillId: "fountainDeepV2",
    matcherSkillId: "fountain",
    detectorId: "skill-deep-v2:fountain",
    bundleId: "skill-deep-v2",
    modelVersion: "confirmed-bg-v1-seed20260632-r2-positive-gates-v3",
  },
  yein: {
    targetSkillId: "maehwaYeinDeepV1",
    matcherSkillId: "maehwaYein",
    detectorId: "skill-maehwa-yein-deep-v1",
    bundleId: "skill-maehwa-yein-deep-v1",
    modelVersion: "maehwa-yein-20260710-v3-runtime-bundle",
  },
} as const;

export function createProfile(partial: Partial<Profile> = {}): Profile {
  return {
    ...createDefaultProfile(),
    skills: [],
    runeAlert: {
      ...createDefaultRuneAlert(),
      enabled: false,
    },
    huntStallAlert: {
      ...createDefaultHuntStallAlert(),
      enabled: false,
    },
    generalTimers: [],
    ...partial,
  };
}

export function createRuntimeMap(profile: Profile): Record<string, SkillRuntimeState> {
  return Object.fromEntries(
    profile.skills.map((skill) => [skill.id, createRuntimeState(skill.id)]),
  );
}

export function prepareReadyVideo(video: HTMLVideoElement) {
  Object.defineProperty(video, "readyState", {
    configurable: true,
    value: HTMLMediaElement.HAVE_CURRENT_DATA,
  });
  Object.defineProperty(video, "videoWidth", {
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(video, "videoHeight", {
    configurable: true,
    value: 720,
  });
}

function assignState<T>(ref: MutableRefObject<T>, next: SetStateAction<T>) {
  ref.current = typeof next === "function" ? (next as (current: T) => T)(ref.current) : next;
}

export function MonitoringHarness({
  initialRuntimeStates,
  gameViewportRevision = 0,
  onReady,
  profile,
  showDebugColumns = false,
  syncProfileRefDuringRender = true,
  stream,
  runtimeReportEvidenceCoordinator,
  alertIncidentJournal,
  precisionParserInputTransport,
  remoteParserProvider,
  onRemoteParserUnavailable,
  remoteRecognitionWarmTracePort,
  remoteRecognitionWarmTraceBuffTemporalPort,
  remoteRecognitionWarmTraceBuffSchedulerPort,
  withSpecialCoreAlertScheduler = false,
  onMonitoringFrame,
}: {
  initialRuntimeStates?: Record<string, SkillRuntimeState>;
  gameViewportRevision?: number;
  onReady: (api: HarnessApi) => void;
  profile: Profile;
  showDebugColumns?: boolean;
  syncProfileRefDuringRender?: boolean;
  stream: MediaStream | null;
  runtimeReportEvidenceCoordinator?: RuntimeReportEvidenceCoordinator;
  alertIncidentJournal?: AlertIncidentJournal;
  precisionParserInputTransport?: PrecisionParserInputTransport;
  remoteParserProvider?: RemoteRecognitionParserFrameProvider;
  onRemoteParserUnavailable?: (error: unknown, sampledAt: number) => void;
  remoteRecognitionWarmTracePort?: RemoteRecognitionWarmTracePort;
  remoteRecognitionWarmTraceBuffTemporalPort?: RemoteRecognitionWarmTraceBuffTemporalPort;
  remoteRecognitionWarmTraceBuffSchedulerPort?: RemoteRecognitionWarmTraceBuffSchedulerPort;
  withSpecialCoreAlertScheduler?: boolean;
  onMonitoringFrame?: (context: MonitoringFrameContext | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const profileRef = useRef(profile);
  const runtimeRef = useRef<Record<string, SkillRuntimeState>>(
    initialRuntimeStates ?? createRuntimeMap(profile),
  );
  const runeRuntimeRef = useRef<RuneRuntimeState>(createRuneRuntimeState());
  const runeSnapshotRef = useRef<RuneSnapshot | null>(null);
  const ultimaRaidEquipmentRuntimeRef =
    useRef<UltimaRaidEquipmentRuntimeState>(
      createUltimaRaidEquipmentRuntimeState(),
    );
  const ultimaRaidEquipmentSnapshotRef =
    useRef<UltimaRaidEquipmentSnapshot | null>(null);
  const ultimaRaidEquipmentIncidentArchiveRef = useRef(
    createUltimaRaidEquipmentIncidentArchive(),
  );
  const huntStallRuntimeRef = useRef<HuntStallRuntimeState>({
    status: "paused",
    lastChangedAt: null,
    lastSampledAt: null,
    lastReadableAt: null,
    lastReadFailureAt: null,
    unreadableSinceAt: null,
    alertedAt: null,
    lastRepeatedAlertAt: null,
    repeatedAlertCount: 0,
    lastAlertedAt: null,
    stableSampleCount: 0,
    unchangedSeconds: 0,
    fingerprint: null,
    recognizedText: null,
    alertedRecognizedText: null,
    pendingRecognizedText: null,
    pendingRecognizedCount: 0,
    lastRejectedRecognizedText: null,
    lastReadFailureReason: null,
    lastDecision: "idle",
    hasObservedExperienceChange: false,
    hasObservedCooldownPresence: false,
    cooldownLastDetectedAt: null,
    cooldownMissingSinceAt: null,
    cooldownMissingSeconds: 0,
    cooldownConsecutiveReadableCount: 0,
    confidence: 0,
    changeScore: 0,
  });
  const huntStallIncidentRecorderRef = useRef(
    createHuntStallIncidentRuntimeRecorder(0),
  );
  const skillReportTimelineRef = useRef<Record<string, SkillReportTimeline>>({});
  const skillIncidentRecorderRef = useRef(
    createSkillIncidentRuntimeRecorder({ now: 0 }),
  );
  const lastAlertErrorRef = useRef<string | null>(null);
  const handleMetadata = useRef(vi.fn()).current;
  const onMessage = useRef(vi.fn()).current;
  const onNoStream = useRef(vi.fn()).current;
  const setRuntimeStates = useRef(
    vi.fn((next: SetStateAction<Record<string, SkillRuntimeState>>) => {
      assignState(runtimeRef, next);
    }),
  ).current;
  const setSnapshots = useRef(vi.fn((_next: SetStateAction<Record<string, SkillSnapshot>>) => {}))
    .current;
  const setRuneRuntime = useRef(
    vi.fn((next: SetStateAction<RuneRuntimeState>) => {
      assignState(runeRuntimeRef, next);
    }),
  ).current;
  const setRuneSnapshot = useRef(
    vi.fn((next: SetStateAction<RuneSnapshot | null>) => {
      assignState(runeSnapshotRef, next);
    }),
  ).current;
  const setUltimaRaidEquipmentRuntime = useRef(
    vi.fn((next: SetStateAction<UltimaRaidEquipmentRuntimeState>) => {
      assignState(ultimaRaidEquipmentRuntimeRef, next);
    }),
  ).current;
  const setUltimaRaidEquipmentSnapshot = useRef(
    vi.fn((next: SetStateAction<UltimaRaidEquipmentSnapshot | null>) => {
      assignState(ultimaRaidEquipmentSnapshotRef, next);
    }),
  ).current;
  const setHuntStallRuntime = useRef(
    vi.fn((next: SetStateAction<HuntStallRuntimeState>) => {
      assignState(huntStallRuntimeRef, next);
    }),
  ).current;
  const setHuntStallSnapshot = useRef(
    vi.fn((_next: SetStateAction<HuntStallSnapshot | null>) => {}),
  ).current;
  const buffExpiryRuntimeRef = useRef<BuffExpiryRuntimeState>(createBuffExpiryRuntimeState());
  const buffExpirySnapshotRef = useRef<BuffExpirySnapshot | null>(null);
  const setBuffExpiryRuntime = useRef(
    vi.fn((next: SetStateAction<BuffExpiryRuntimeState>) => {
      assignState(buffExpiryRuntimeRef, next);
    }),
  ).current;
  const setBuffExpirySnapshot = useRef(
    vi.fn((next: SetStateAction<BuffExpirySnapshot | null>) => {
      assignState(buffExpirySnapshotRef, next);
    }),
  ).current;
  const setBuffExpiryPrecisionPreloadStatus = useRef(vi.fn()).current;
  const boosterExpiryRuntimeRef = useRef<BoosterExpiryRuntimeState>(
    createBoosterExpiryRuntimeState(),
  );
  const boosterExpirySnapshotRef = useRef<BoosterExpirySnapshot | null>(null);
  const boosterExpiryIncidentRecorderRef = useRef(
    createBoosterExpiryIncidentRuntimeRecorder(0),
  );
  const setBoosterExpiryRuntime = useRef(
    vi.fn((next: SetStateAction<BoosterExpiryRuntimeState>) => {
      assignState(boosterExpiryRuntimeRef, next);
    }),
  ).current;
  const setBoosterExpirySnapshot = useRef(
    vi.fn((next: SetStateAction<BoosterExpirySnapshot | null>) => {
      assignState(boosterExpirySnapshotRef, next);
    }),
  ).current;
  const specialCoreRuntimeRef = useRef<SpecialCoreRuntimeState>(
    createSpecialCoreRuntimeState(),
  );
  const specialCoreSnapshotRef = useRef<SpecialCoreSnapshot | null>(null);
  const specialCoreIncidentRecorderRef = useRef(
    createSpecialCoreIncidentRuntimeRecorder(0),
  );
  const [, setSpecialCoreRenderVersion] = useState(0);
  const setSpecialCoreRuntime = useRef(
    vi.fn((next: SetStateAction<SpecialCoreRuntimeState>) => {
      assignState(specialCoreRuntimeRef, next);
      if (withSpecialCoreAlertScheduler) {
        setSpecialCoreRenderVersion((current) => current + 1);
      }
    }),
  ).current;
  const setSpecialCoreSnapshot = useRef(
    vi.fn((next: SetStateAction<SpecialCoreSnapshot | null>) => {
      assignState(specialCoreSnapshotRef, next);
    }),
  ).current;
  const buffExpiryIncidentRecorderRef = useRef(
    createBuffExpiryIncidentRuntimeRecorder({ now: 0 }),
  );

  if (syncProfileRefDuringRender) {
    profileRef.current = profile;
  }

  useEffect(() => {
    if (!syncProfileRefDuringRender) {
      profileRef.current = profile;
    }
  }, [profile, profileRef, syncProfileRefDuringRender]);

  useMonitoringLoop({
    stream,
    gameViewportRevision,
    videoRef,
    profileRef,
    runtimeRef,
    skillIncidentRecorderRef,
    runeRuntimeRef,
    runeSnapshotRef,
    ultimaRaidEquipmentRuntimeRef,
    ultimaRaidEquipmentSnapshotRef,
    ultimaRaidEquipmentIncidentArchiveRef,
    huntStallRuntimeRef,
    huntStallIncidentRecorderRef,
    buffExpiryRuntimeRef,
    buffExpirySnapshotRef,
    buffExpiryIncidentRecorderRef,
    boosterExpiryRuntimeRef,
    boosterExpiryIncidentRecorderRef,
    specialCoreRuntimeRef,
    specialCoreIncidentRecorderRef,
    skillReportTimelineRef,
    lastAlertErrorRef,
    showDebugColumns,
    handleMetadata,
    setRuntimeStates,
    setSnapshots,
    setRuneRuntime,
    setRuneSnapshot,
    setUltimaRaidEquipmentRuntime,
    setUltimaRaidEquipmentSnapshot,
    setHuntStallRuntime,
    setHuntStallSnapshot,
    setBuffExpiryRuntime,
    setBuffExpirySnapshot,
    setBuffExpiryPrecisionPreloadStatus,
    setBoosterExpiryRuntime,
    setBoosterExpirySnapshot,
    setSpecialCoreRuntime,
    setSpecialCoreSnapshot,
    onMessage,
    onNoStream,
    runtimeReportEvidenceCoordinator,
    alertIncidentJournal,
    precisionParserInputTransport,
    remoteParserProvider,
    onRemoteParserUnavailable,
    remoteRecognitionWarmTracePort,
    remoteRecognitionWarmTraceBuffTemporalPort,
    remoteRecognitionWarmTraceBuffSchedulerPort,
    onMonitoringFrame,
  });

  useEffect(() => {
    onReady({
      buffExpiryRuntimeRef,
      buffExpirySnapshotRef,
      boosterExpiryRuntimeRef,
      boosterExpirySnapshotRef,
      boosterExpiryIncidentRecorderRef,
      specialCoreRuntimeRef,
      specialCoreSnapshotRef,
      specialCoreIncidentRecorderRef,
      handleMetadata,
      huntStallRuntimeRef,
      huntStallIncidentRecorderRef,
      lastAlertErrorRef,
      onMessage,
      onNoStream,
      runeRuntimeRef,
      runeSnapshotRef,
      ultimaRaidEquipmentRuntimeRef,
      ultimaRaidEquipmentSnapshotRef,
      runtimeRef,
      skillIncidentRecorderRef,
      setHuntStallRuntime,
      setHuntStallSnapshot,
      setBoosterExpiryRuntime,
      setBoosterExpirySnapshot,
      setSpecialCoreRuntime,
      setSpecialCoreSnapshot,
      setBuffExpiryRuntime,
      setBuffExpirySnapshot,
      setBuffExpiryPrecisionPreloadStatus,
      setRuneRuntime,
      setRuneSnapshot,
      setUltimaRaidEquipmentRuntime,
      setUltimaRaidEquipmentSnapshot,
      setRuntimeStates,
      setSnapshots,
      skillReportTimelineRef,
    });
  }, [
    buffExpiryRuntimeRef,
    buffExpirySnapshotRef,
    boosterExpiryRuntimeRef,
    boosterExpirySnapshotRef,
    boosterExpiryIncidentRecorderRef,
    handleMetadata,
    huntStallRuntimeRef,
    huntStallIncidentRecorderRef,
    lastAlertErrorRef,
    onMessage,
    onNoStream,
    onReady,
    runeRuntimeRef,
    runeSnapshotRef,
    ultimaRaidEquipmentRuntimeRef,
    ultimaRaidEquipmentSnapshotRef,
    runtimeRef,
    skillIncidentRecorderRef,
    setHuntStallRuntime,
    setHuntStallSnapshot,
    setBoosterExpiryRuntime,
    setBoosterExpirySnapshot,
    setBuffExpiryRuntime,
    setBuffExpirySnapshot,
    setBuffExpiryPrecisionPreloadStatus,
    setRuneRuntime,
    setRuneSnapshot,
    setUltimaRaidEquipmentRuntime,
    setUltimaRaidEquipmentSnapshot,
    setRuntimeStates,
    setSnapshots,
    skillReportTimelineRef,
  ]);

  return (
    <>
      <video
        ref={(node) => {
          videoRef.current = node;
          if (node) {
            prepareReadyVideo(node);
          }
        }}
      />
      {withSpecialCoreAlertScheduler ? (
        <MonitoringSpecialCoreScheduler
          stream={stream}
          gameViewportRevision={gameViewportRevision}
          profileRef={profileRef}
          runtime={specialCoreRuntimeRef.current}
          runtimeRef={specialCoreRuntimeRef}
          incidentRecorderRef={specialCoreIncidentRecorderRef}
          lastAlertErrorRef={lastAlertErrorRef}
          setRuntime={setSpecialCoreRuntime}
          alertIncidentJournal={alertIncidentJournal}
          onMessage={onMessage}
        />
      ) : null}
    </>
  );
}

function MonitoringSpecialCoreScheduler({
  stream,
  gameViewportRevision,
  profileRef,
  runtime,
  runtimeRef,
  incidentRecorderRef,
  lastAlertErrorRef,
  setRuntime,
  alertIncidentJournal,
  onMessage,
}: {
  stream: MediaStream | null;
  gameViewportRevision: number;
  profileRef: MutableRefObject<Profile>;
  runtime: SpecialCoreRuntimeState;
  runtimeRef: MutableRefObject<SpecialCoreRuntimeState>;
  incidentRecorderRef: MutableRefObject<SpecialCoreIncidentRuntimeRecorder>;
  lastAlertErrorRef: MutableRefObject<string | null>;
  setRuntime: (next: SetStateAction<SpecialCoreRuntimeState>) => void;
  alertIncidentJournal?: AlertIncidentJournal;
  onMessage: (message: string) => void;
}) {
  useSpecialCoreAlertScheduler({
    stream,
    gameViewportRevision,
    config:
      profileRef.current.specialCoreAlert ?? createDefaultSpecialCoreAlert(),
    profileRef,
    specialCoreRuntime: runtime,
    specialCoreRuntimeRef: runtimeRef,
    specialCoreIncidentRecorderRef: incidentRecorderRef,
    alertIncidentJournal,
    lastAlertErrorRef,
    setSpecialCoreRuntime: setRuntime,
    onMessage,
  });
  return null;
}

export function resetMonitoringLoopTestMocks() {
vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T00:00:00.000Z"));
    playAlertMock.mockResolvedValue(undefined);
    playAlertFromOffsetMock.mockImplementation(
      async (_soundId, _volume, _offset, options) => {
        options?.onStarted?.();
      },
    );
    playAlertUntilEndedMock.mockResolvedValue(undefined);
    preloadAlertFromOffsetMock.mockResolvedValue(undefined);
    getRecognitionEngineMock.mockReturnValue(createRecognitionEngine());
    huntStallCooldownWorkerMock.process.mockReset();
    huntStallCooldownWorkerMock.process.mockResolvedValue({
      result: {
        value: null,
        confidence: 0,
        debug: { reason: "not-configured" },
      },
      performance: {
        recognitionMs: 0,
        totalMs: 0,
      },
    });
    huntStallCooldownWorkerMock.reset.mockReset();
    captureManualExperienceCropFromVideoMock.mockClear();
    huntStallOcrEngineMock.processCrop.mockReset();
    huntStallOcrEngineMock.processCrop.mockResolvedValue({
      type: "processed",
      id: 0,
      selectedIndex: 0,
      reading: {
        fingerprint: "hunt-fingerprint",
        recognizedText: "12.345%",
        confidence: 0.9,
        foregroundRatio: 0.1,
      },
      barEstimate: null,
      candidates: [
        {
          label: "manual-experience",
          regionPixels: { x: 0, y: 0, width: 4, height: 4 },
          reading: {
            fingerprint: "hunt-fingerprint",
            recognizedText: "12.345%",
            confidence: 0.9,
            foregroundRatio: 0.1,
          },
          processedImageData: new ImageData(4, 4),
          score: 1,
          performance: {
            totalMs: 0,
            frameReadMs: 0,
            ocrMs: 0,
            previewMs: 0,
          },
          barPercent: null,
          barConfidence: null,
          barCoverage: "unknown",
        },
      ],
      performance: {
        totalMs: 0,
        barEstimateMs: null,
        candidateCount: 1,
        candidateMs: 0,
        selectedCandidateMs: 0,
        selectedFrameReadMs: null,
        selectedOcrMs: 0,
        selectedPreviewMs: null,
        fullFramePreviewMs: null,
      },
    });
    huntStallOcrEngineMock.reset.mockReset();
    huntStallOcrEngineMock.sample.mockReset();
    boosterExpiryWorkerMock.process.mockReset();
    boosterExpiryWorkerMock.process.mockResolvedValue({
      result: createBoosterExpiryWorkerResult(null),
      performance: {
        recognitionMs: 0,
        totalMs: 0,
      },
    });
    boosterExpiryWorkerMock.reset.mockReset();
    buffExpiryPrecisionEngineMock.process.mockReset();
    buffExpiryPrecisionEngineMock.preload.mockReset();
    buffExpiryPrecisionEngineMock.preload.mockResolvedValue(undefined);
    buffExpiryPrecisionEngineMock.reset.mockReset();
    buffSlotAnalysisEngineMock.process.mockReset();
    buffSlotAnalysisEngineMock.process.mockResolvedValue({
      sampledAt: Date.now(),
      analysis: {
        icons: [],
        boxes: [],
        engine: "rule",
        parserVersion: "test-shared-parser",
      },
      performance: {
        totalMs: 0,
        detectMs: 0,
        boxCount: 0,
      },
      unsupported: false,
      unsupportedReason: null,
    });
    buffSlotAnalysisEngineMock.reset.mockReset();
    buffExpiryPreviewMock.createBuffExpiryBoxPreviewUrls.mockReset();
    buffExpiryPreviewMock.createBuffExpiryNormalizedBoxPreviewUrls.mockReset();
    buffExpiryPreviewMock.createBuffExpiryNormalizedBoxPreviewImageData.mockReset();
    buffExpiryPreviewMock.createBuffExpiryProcessedPreview.mockReset();
    buffExpiryPreviewMock.createBuffExpiryBoxPreviewUrls.mockReturnValue({});
    buffExpiryPreviewMock.createBuffExpiryNormalizedBoxPreviewUrls.mockReturnValue({});
    buffExpiryPreviewMock.createBuffExpiryNormalizedBoxPreviewImageData.mockReturnValue({});
    buffExpiryPreviewMock.createBuffExpiryProcessedPreview.mockReturnValue("processed-preview");
    buffExpiryPrecisionEngineMock.process.mockResolvedValue(createBuffExpiryPrecisionSampleResponse(30));
    skillBuffDurationEngineMock.process.mockReset();
    skillBuffDurationEngineMock.process.mockResolvedValue(
      createSkillBuffDurationSampleResponse({ seconds: null }),
    );
    skillBuffDurationEngineMock.reset.mockReset();
    encodeVp8ParserFrameMock.mockReset();
    encodeVp8ParserFrameMock.mockResolvedValue({
      encodedVp8: new Uint8Array([1, 2, 3]).buffer,
      encodedBytes: 3,
      encodeMs: 1,
    });
    specialCoreAlertEngineMock.process.mockReset();
    specialCoreAlertEngineMock.process.mockResolvedValue({
      sampledAt: Date.now(),
      parserEngine: "rule",
      parserVersion: "test-shared-parser",
      parserFallbackReason: null,
      parserRuntime: null,
      boxCount: 0,
      parsedBoxes: [],
      rowGroups: [],
      eligibleBoxIndexes: [],
      detectedCount: 0,
      detectedIcon: null,
      candidateIcons: [],
      performance: {
        totalMs: 0,
        detectMs: 0,
        matchMs: 0,
        boxCount: 0,
      },
      unsupported: false,
      unsupportedReason: null,
    });
    specialCoreAlertEngineMock.reset.mockReset();
    sampleVideoRegionMock.mockReset();
    sampleVideoRegionMock.mockReturnValue({
      imageData: new ImageData(4, 4),
      rawPreviewUrl: "data:image/png;base64,booster-top",
      region: { x: 0, y: 0, width: 1280, height: 180 },
    });
    sampleBuffSlotVideoFrameMock.mockReset();
    sampleBuffSlotVideoFrameMock.mockReturnValue({
      imageData: new ImageData(4, 4),
      rawPreviewUrl: "data:image/png;base64,skill-buff-slot",
      regionLabel: "1280x180",
      sourceSize: { width: 4, height: 4 },
      roi: { x: 2, y: 0, width: 2, height: 2 },
    });
    runeDetectionWorkerClientMock.detect.mockReset();
    runeDetectionWorkerClientMock.detect.mockImplementation((imageData: ImageData) =>
      Promise.resolve(detectRuneInMinimapMock(imageData)),
    );
    runeDetectionWorkerClientMock.reset.mockReset();
}

export function cleanupMonitoringLoopTestHarness() {
cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
}
