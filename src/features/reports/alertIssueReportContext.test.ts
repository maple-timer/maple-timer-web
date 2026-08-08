import { createRef, type RefObject } from "react";
import { describe, expect, it, vi } from "vitest";
import { alertIssueReportGuidance } from "../../app/reporting/alertIssueReportGuidance";
import type { AlertIssueReportTarget } from "../../application/reporting/alertIssueReportAvailability";
import type { HuntStallSnapshot, RuneSnapshot, SkillSnapshot } from "../../alertTypes";
import type { Profile, SkillRuntimeState } from "../../types";
import { createHuntStallRuntimeState } from "../../lib/huntStall";
import { createBuffExpiryRuntimeState } from "../../lib/buffExpiry/buffExpiryRuntimeState";
import { createBoosterExpiryRuntimeState } from "../../lib/boosterExpiry/boosterExpiryRuntime";
import type {
  BuffExpiryBox,
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../lib/buffExpiry/buffExpiryTypes";
import type {
  BoosterExpiryRuntimeState,
  BoosterExpirySnapshot,
} from "../../lib/boosterExpiry/boosterExpiryTypes";
import {
  createSpecialCoreRuntimeState,
  type SpecialCoreRuntimeState,
  type SpecialCoreSnapshot,
} from "../../lib/specialCore";
import {
  buildIssueReportContext,
  getFallbackIssueReportContext,
} from "./alertIssueReportContext";
import { createDefaultProfile, createSkill } from "../../lib/storage";
import { createRuntimeState } from "../../lib/timer";
import { createBuffExpiryPrecisionDiagnosticRoiPreview } from "../../platform/frame-capture/buff-expiry/buffExpiryPrecisionCapture";
import type {
  GameViewportCalibrationState,
  ResolvedGameViewport,
} from "../../contracts/geometry/frameSource";

vi.mock("../../platform/frame-capture/buff-expiry/buffExpiryPrecisionCapture", () => ({
  createBuffExpiryPrecisionDiagnosticRoiPreview: vi.fn(() => ({
    sourceSize: { width: 1920, height: 1080 },
    roi: { x: 880, y: 0, width: 1040, height: 389 },
    imageDataUrl: "data:image/webp;base64,buff-live-roi",
  })),
}));

const CAPTURE_SIZE = { width: 1920, height: 1080 };
const VIDEO_REF = createRef<HTMLVideoElement>();

function makeProfile(): Profile {
  return {
    ...createDefaultProfile(),
    skills: [
      createSkill({
        id: "skill-1",
        name: "에르다 파운틴",
        region: { x: 0.1, y: 0.2, width: 0.04, height: 0.04 },
      }),
    ],
    runeAlert: {
      ...createDefaultProfile().runeAlert!,
      region: { x: 0.05, y: 0.1, width: 0.2, height: 0.12 },
    },
  };
}

function makeSkillSnapshot(partial: Partial<SkillSnapshot> = {}): SkillSnapshot {
  return {
    result: partial.result ?? { value: 12, confidence: 0.9 },
    sampledAt: partial.sampledAt ?? 100,
    rawPreviewUrl: partial.rawPreviewUrl ?? "data:image/png;base64,skill-raw",
    previewUrl: partial.previewUrl ?? "data:image/png;base64,skill-preview",
    regionLabel: partial.regionLabel ?? "40x40",
    buffDuration: partial.buffDuration,
  };
}

function makeRuneSnapshot(partial: Partial<RuneSnapshot> = {}): RuneSnapshot {
  return {
    sampledAt: partial.sampledAt ?? 100,
    rawPreviewUrl: partial.rawPreviewUrl ?? "data:image/png;base64,rune-raw",
    maskPreviewUrl: partial.maskPreviewUrl ?? "data:image/png;base64,rune-mask",
    candidatePreviewUrl: partial.candidatePreviewUrl ?? null,
    candidateRawPreviewUrl: partial.candidateRawPreviewUrl ?? null,
    candidateMaskPreviewUrl: partial.candidateMaskPreviewUrl ?? null,
    candidateRegionLabel: partial.candidateRegionLabel ?? null,
    candidateSampledAt: partial.candidateSampledAt ?? null,
    candidate: partial.candidate ?? null,
    detected: partial.detected ?? false,
    confidence: partial.confidence ?? 0.7,
    candidateCount: partial.candidateCount ?? 0,
  };
}

function makeHuntStallSnapshot(partial: Partial<HuntStallSnapshot> = {}): HuntStallSnapshot {
  return {
    sampledAt: partial.sampledAt ?? 100,
    rawPreviewUrl: partial.rawPreviewUrl ?? "data:image/png;base64,hunt-raw",
    processedPreviewUrl: partial.processedPreviewUrl ?? "data:image/png;base64,hunt-processed",
    regionLabel: partial.regionLabel ?? "220x17",
    recognizedText: partial.recognizedText ?? "1,234 [12.345%]",
    debugText: partial.debugText,
    confidence: partial.confidence ?? 0.9,
    foregroundRatio: partial.foregroundRatio ?? 0.05,
    changeScore: partial.changeScore ?? 0,
  };
}

function makeBuffExpirySnapshot(boxes: BuffExpiryBox[]): BuffExpirySnapshot {
  return {
    sampledAt: 100,
    roi: null,
    rawPreviewUrl: "data:image/png;base64,buff-raw",
    processedPreviewUrl: null,
    fullFramePreviewUrl: null,
    boxes,
    acceptedMatches: [],
    rejectedMatches: [],
    tracks: [],
    pendingTracks: [],
    unsupportedReason: null,
    performance: null,
  };
}

function buildContext({
  target,
  profile = makeProfile(),
  runtimeStates = { "skill-1": createRuntimeState("skill-1") },
  snapshots = { "skill-1": makeSkillSnapshot() },
  runeSnapshot = makeRuneSnapshot(),
  huntStallRuntime = createHuntStallRuntimeState(),
  huntStallSnapshot = makeHuntStallSnapshot(),
  buffExpiryRuntime = createBuffExpiryRuntimeState(),
  buffExpirySnapshot = null,
  boosterExpiryRuntime = createBoosterExpiryRuntimeState(),
  boosterExpirySnapshot = null,
  specialCoreRuntime = createSpecialCoreRuntimeState(),
  specialCoreSnapshot = null,
  stream = {} as MediaStream,
  captureSize = CAPTURE_SIZE,
  videoRef = VIDEO_REF,
  captureLayoutKey,
  gameLayoutKey,
  gameViewport,
  gameViewportState,
}: {
  target: AlertIssueReportTarget;
  profile?: Profile;
  runtimeStates?: Record<string, SkillRuntimeState>;
  snapshots?: Record<string, SkillSnapshot>;
  runeSnapshot?: RuneSnapshot | null;
  huntStallRuntime?: ReturnType<typeof createHuntStallRuntimeState>;
  huntStallSnapshot?: HuntStallSnapshot | null;
  buffExpiryRuntime?: BuffExpiryRuntimeState;
  buffExpirySnapshot?: BuffExpirySnapshot | null;
  boosterExpiryRuntime?: BoosterExpiryRuntimeState;
  boosterExpirySnapshot?: BoosterExpirySnapshot | null;
  specialCoreRuntime?: SpecialCoreRuntimeState;
  specialCoreSnapshot?: SpecialCoreSnapshot | null;
  stream?: MediaStream | null;
  captureSize?: typeof CAPTURE_SIZE | null;
  videoRef?: RefObject<HTMLVideoElement | null>;
  captureLayoutKey?: string | null;
  gameLayoutKey?: string | null;
  gameViewport?: ResolvedGameViewport | null;
  gameViewportState?: GameViewportCalibrationState;
}) {
  return buildIssueReportContext({
    target,
    guidance: alertIssueReportGuidance,
    profile,
    runtimeStates,
    snapshots,
    runeSnapshot,
    huntStallRuntime,
    huntStallSnapshot,
    buffExpiryRuntime,
    buffExpirySnapshot,
    boosterExpiryRuntime,
    boosterExpirySnapshot,
    specialCoreRuntime,
    specialCoreSnapshot,
    stream,
    captureSize,
    videoRef,
    currentLayoutKey:
      captureLayoutKey === undefined && gameLayoutKey === undefined
        ? null
        : undefined,
    captureLayoutKey,
    gameLayoutKey,
    gameViewport,
    gameViewportState,
  });
}

function getFallbackContext(target: AlertIssueReportTarget) {
  return getFallbackIssueReportContext(target, alertIssueReportGuidance);
}

describe("alertIssueReportContext", () => {
  it("builds skill issue context from the current stream, region, and latest reading", () => {
    const context = buildContext({
      target: { kind: "skill", skillId: "skill-1", skillName: "에르다 파운틴" },
    });

    expect(context.previewUrl).toBe("data:image/png;base64,skill-raw");
    expect(context.previewLabel).toBe("현재 선택한 스킬 영역");
    expect(context.emptyPreviewLabel).toBe("스킬 영역 대기");
    expect(context.statusText).toBe("숫자를 읽고 알림 시간을 계산 중입니다.");
    expect(context.checklist).toContain(
      "확장 UI를 사용한다면 화면 공유 메뉴에서 게임 영역을 설정해주세요.",
    );
    expect(context.checklist).toContain(
      "퀵슬롯&버프 표시가 [중앙, 크게]인지 확인해주세요.",
    );
    expect(context.checklist).toContain("스킬 아이콘 하나만 선택됐는지 확인해주세요.");

    const missingRegionContext = buildContext({
      target: { kind: "skill", skillId: "skill-1", skillName: "에르다 파운틴" },
      profile: {
        ...makeProfile(),
        skills: [createSkill({ id: "skill-1", name: "에르다 파운틴", region: null })],
      },
    });
    expect(missingRegionContext.statusText).toBe("스킬 영역을 먼저 선택해주세요.");
  });

  it("uses the buff-slot quadrant preview and checklist for buff-duration issue context", () => {
    const skill = createSkill({
      id: "skill-buff-duration",
      name: "솔 야누스 : 새벽",
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      region: { x: 0.2, y: 0.2, width: 0.04, height: 0.04 },
    });
    const context = buildContext({
      target: { kind: "skill", skillId: skill.id, skillName: skill.name },
      profile: { ...makeProfile(), skills: [skill] },
      runtimeStates: { [skill.id]: createRuntimeState(skill.id) },
      snapshots: {
        [skill.id]: makeSkillSnapshot({
          rawPreviewUrl: "data:image/png;base64,buff-slot-quadrant",
          previewUrl: "data:image/png;base64,janus-icon",
          regionLabel: "960x540 · 24개 버프칸",
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
        }),
      },
    });

    expect(context.previewUrl).toBe("data:image/png;base64,buff-slot-quadrant");
    expect(context.previewLabel).toBe("현재 우상단 버프칸 분석 화면");
    expect(context.emptyPreviewLabel).toBe("버프칸 분석 화면 대기");
    expect(context.statusText).toBe("버프칸에서 새벽 아이콘을 확인한 상태입니다.");
    expect(context.checklist).toContain(
      "확장 UI를 사용한다면 화면 공유 메뉴에서 게임 영역을 설정해주세요.",
    );
    expect(context.checklist).toContain("버프 정렬 옵션이 모두 켜져 있는지 확인해주세요.");
    expect(context.checklist).toContain("퀵슬롯&버프표시방식이 [분+초]인지 확인해주세요.");
    expect(context.checklist).toContain("새벽 아이콘과 시간이 보이는지 확인해주세요.");
    expect(context.checklist).not.toContain("스킬 아이콘 하나만 선택됐는지 확인해주세요.");
    expect(context.guideVideoSrc).toBe("/media/janus-buff-duration-settings-guide.mp4");
    expect(context.guideVideoLabel).toBe("버프 즐겨찾기 설정 예시 영상");
    expect(context.guideTitle).toBe("버프 즐겨찾기 확인");
  });

  it("adds a preflight check when skill buff-duration parser output has one row", () => {
    const skill = createSkill({
      id: "skill-buff-duration",
      name: "솔 야누스 : 새벽",
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
      region: { x: 0.2, y: 0.2, width: 0.04, height: 0.04 },
    });
    const context = buildContext({
      target: { kind: "skill", skillId: skill.id, skillName: skill.name },
      profile: { ...makeProfile(), skills: [skill] },
      runtimeStates: { [skill.id]: createRuntimeState(skill.id) },
      snapshots: {
        [skill.id]: makeSkillSnapshot({
          buffDuration: {
            detected: false,
            boxCount: 12,
            parserRowCount: 1,
            detectedCount: 0,
            score: null,
            margin: null,
            decisionReason: null,
            countdown: null,
            countdownModelStatus: "ready",
            performanceMs: 8.4,
            error: null,
            candidateIcons: [],
          },
        }),
      },
    });

    expect(context.preflight).toMatchObject({
      kind: "one-row-buff-slots",
      description:
        "버프 아이콘이 한 줄로 길게 보이면 필요한 버프를 읽지 못할 수 있습니다. 게임 설정을 확인한 뒤 계속 제보해주세요.",
    });

    const twoRowContext = buildContext({
      target: { kind: "skill", skillId: skill.id, skillName: skill.name },
      profile: { ...makeProfile(), skills: [skill] },
      runtimeStates: { [skill.id]: createRuntimeState(skill.id) },
      snapshots: {
        [skill.id]: makeSkillSnapshot({
          buffDuration: {
            detected: false,
            boxCount: 12,
            parserRowCount: 2,
            detectedCount: 0,
            score: null,
            margin: null,
            decisionReason: null,
            countdown: null,
            countdownModelStatus: "ready",
            performanceMs: 8.4,
            error: null,
            candidateIcons: [],
          },
        }),
      },
    });
    expect(twoRowContext.preflight).toBeNull();
  });

  it("treats buff-slot-only Hologram Graffiti reports as buff-duration even without an explicit source", () => {
    const skill = createSkill({
      id: "skill-hologram",
      presetId: "hologram-graffiti-barrier-vi",
      detectionSource: undefined,
      region: { x: 0.2, y: 0.2, width: 0.04, height: 0.04 },
    });
    const context = buildContext({
      target: { kind: "skill", skillId: skill.id, skillName: skill.name },
      profile: { ...makeProfile(), skills: [skill] },
      runtimeStates: { [skill.id]: createRuntimeState(skill.id) },
      snapshots: {
        [skill.id]: makeSkillSnapshot({
          rawPreviewUrl: "data:image/png;base64,buff-slot-quadrant",
          previewUrl: "data:image/png;base64,hologram-icon",
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
        }),
      },
    });

    expect(context.previewLabel).toBe("현재 우상단 버프칸 분석 화면");
    expect(context.statusText).toBe("버프칸에서 역장 아이콘을 확인한 상태입니다.");
    expect(context.checklist).toContain("역장 아이콘과 시간이 보이는지 확인해주세요.");
  });

  it("builds Erda Fountain buff-slot reports from the buff duration target", () => {
    const skill = createSkill({
      id: "skill-fountain",
      presetId: "erda-fountain",
      detectionSource: "buff-duration",
      region: { x: 0.2, y: 0.2, width: 0.04, height: 0.04 },
    });
    const context = buildContext({
      target: { kind: "skill", skillId: skill.id, skillName: skill.name },
      profile: { ...makeProfile(), skills: [skill] },
      runtimeStates: { [skill.id]: createRuntimeState(skill.id) },
      snapshots: {
        [skill.id]: makeSkillSnapshot({
          rawPreviewUrl: "data:image/png;base64,buff-slot-quadrant",
          previewUrl: "data:image/png;base64,fountain-icon",
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
        }),
      },
    });

    expect(context.previewLabel).toBe("현재 우상단 버프칸 분석 화면");
    expect(context.statusText).toBe("버프칸에서 파운틴 아이콘을 확인한 상태입니다.");
    expect(context.checklist).toContain("파운틴 아이콘과 시간이 보이는지 확인해주세요.");
    expect(context.checklist).not.toContain("스킬 아이콘 하나만 선택됐는지 확인해주세요.");
    expect(context.guideVideoSrc).toBe("/media/erda-fountain-buff-duration-settings-guide.mp4");
  });

  it("builds Yein buff-slot reports with the Yein favorite guide video", () => {
    const skill = createSkill({
      id: "skill-yein",
      presetId: "maehwa-yein-vi",
      detectionSource: "buff-duration",
      region: { x: 0.2, y: 0.2, width: 0.04, height: 0.04 },
    });
    const context = buildContext({
      target: { kind: "skill", skillId: skill.id, skillName: skill.name },
      profile: { ...makeProfile(), skills: [skill] },
      runtimeStates: { [skill.id]: createRuntimeState(skill.id) },
      snapshots: {
        [skill.id]: makeSkillSnapshot({
          rawPreviewUrl: "data:image/png;base64,buff-slot-quadrant",
          previewUrl: "data:image/png;base64,yein-icon",
          buffDuration: {
            detected: true,
            boxCount: 24,
            detectedCount: 1,
            score: 0.99,
            margin: 0.04,
            decisionReason: "matched",
            countdown: null,
            remainingCount: {
              count: 3,
              confidence: 0.98,
              kind: "exact",
              text: "3",
              expectedCount: 3,
              format: "remaining-count",
              textRegion: "bottom-right",
              status: "high",
              bestGuess: null,
              candidates: [],
            },
            countdownModelStatus: "ready",
            performanceMs: 8.4,
            error: null,
            candidateIcons: [],
          },
        }),
      },
    });

    expect(context.previewLabel).toBe("현재 우상단 버프칸 분석 화면");
    expect(context.statusText).toBe("버프칸에서 예인 아이콘을 확인한 상태입니다.");
    expect(context.checklist).toContain("예인 아이콘과 남은 횟수가 보이는지 확인해주세요.");
    expect(context.checklist).toContain("버프 정렬 옵션이 모두 켜져 있는지 확인해주세요.");
    expect(context.guideVideoSrc).toBe("/media/maehwa-yein-buff-duration-settings-guide.mp4");
  });

  it("builds rune issue context for missing region, candidate, and detected states", () => {
    const missingRegionContext = buildContext({
      target: { kind: "rune" },
      profile: { ...makeProfile(), runeAlert: { ...makeProfile().runeAlert!, region: null } },
    });
    expect(missingRegionContext.statusText).toBe("미니맵 영역을 먼저 선택해주세요.");

    const candidateContext = buildContext({
      target: { kind: "rune" },
      runeSnapshot: makeRuneSnapshot({ candidatePreviewUrl: "data:image/png;base64,candidate" }),
    });
    expect(candidateContext.previewUrl).toBe("data:image/png;base64,rune-raw");
    expect(candidateContext.previewLabel).toBe("현재 선택한 미니맵 영역");
    expect(candidateContext.statusText).toBe("룬 후보처럼 보이는 부분을 확인 중입니다.");

    const detectedContext = buildContext({
      target: { kind: "rune" },
      runeSnapshot: makeRuneSnapshot({ detected: true }),
    });
    expect(detectedContext.statusText).toBe("최근 룬 후보를 감지한 상태입니다.");
  });

  it("builds hunt stall issue context from stream, status, and snapshot availability", () => {
    const readyContext = buildContext({
      target: { kind: "hunt-stall" },
      huntStallRuntime: { ...createHuntStallRuntimeState(), status: "active" },
    });
    expect(readyContext.previewUrl).toBe("data:image/png;base64,hunt-raw");
    expect(readyContext.previewLabel).toBe("현재 경험치바 감시 영역");
    expect(readyContext.statusText).toBe("경험치바 영역과 상태를 함께 보낼 수 있습니다.");
    expect(readyContext.guideVideoSrc).toBe("/media/manual-experience-band-guide.mp4");
    expect(readyContext.guideTitle).toBe("경험치바 선택 예시");
    expect(readyContext.checklist).toContain(
      "확장 UI를 사용한다면 화면 공유 메뉴에서 게임 영역을 설정해주세요.",
    );
    expect(readyContext.checklist).toContain("경험치바 윗선 위치를 확인해주세요.");
    expect(readyContext.checklist).toContain("해상도를 변경했다면 영역을 다시 선택했는지 확인해주세요.");

    const cooldownContext = buildContext({
      target: { kind: "hunt-stall" },
      profile: {
        ...makeProfile(),
        huntStallAlert: {
          ...makeProfile().huntStallAlert!,
          mode: "cooldown-presence",
          cooldownRegion: { x: 0.4, y: 0.7, width: 0.04, height: 0.04 },
        },
      },
      huntStallRuntime: { ...createHuntStallRuntimeState(), status: "active" },
    });
    expect(cooldownContext.previewLabel).toBe("현재 쿨타임 숫자 감시 영역");
    expect(cooldownContext.guideVideoSrc).toBe("/media/quickslot-crop-guide.mp4");
    expect(cooldownContext.guideTitle).toBe("쿨타임 아이콘 선택 예시");
    expect(cooldownContext.checklist).toContain("쿨타임 아이콘 하나만 선택됐는지 확인해주세요.");
    expect(cooldownContext.checklist).toContain("배경없이 정확히 아이콘만 선택됐는지 확인해주세요.");

    const noStreamContext = buildContext({ target: { kind: "hunt-stall" }, stream: null });
    expect(noStreamContext.statusText).toBe("화면 공유가 필요합니다.");

    const pausedContext = buildContext({
      target: { kind: "hunt-stall" },
      huntStallRuntime: { ...createHuntStallRuntimeState(), status: "paused" },
    });
    expect(pausedContext.statusText).toBe("현재 알림이 꺼져 있습니다.");
  });

  it("builds buff expiry issue context with clearer paused and waiting messages", () => {
    const pausedContext = buildContext({
      target: { kind: "buff-expiry" },
      buffExpiryRuntime: { ...createBuffExpiryRuntimeState(), status: "paused" },
    });
    expect(pausedContext.statusText).toBe("버프 종료 알림이 꺼져 있습니다.");
    expect(pausedContext.checklist).toContain("우상단 버프칸이 보이는지 확인해주세요.");
    expect(pausedContext.checklist).toContain("버프 시간 표시가 [분+초]인지 확인해주세요.");
    expect(pausedContext.checklist).toContain("버프 정렬 옵션이 켜져 있는지 확인해주세요.");

    const waitingContext = buildContext({
      target: { kind: "buff-expiry" },
      buffExpiryRuntime: { ...createBuffExpiryRuntimeState(), status: "waiting" },
    });
    expect(waitingContext.statusText).toBe("지원 버프의 남은 시간을 찾는 중입니다.");
  });

  it("adds a preflight check when buff expiry parser boxes are all on one row", () => {
    const context = buildContext({
      target: { kind: "buff-expiry" },
      buffExpiryRuntime: { ...createBuffExpiryRuntimeState(), status: "waiting" },
      buffExpirySnapshot: makeBuffExpirySnapshot([
        { x: 100, y: 20, width: 32, height: 32, confidence: 0.9, row: 0 },
        { x: 136, y: 20, width: 32, height: 32, confidence: 0.9, row: 0 },
        { x: 172, y: 20, width: 32, height: 32, confidence: 0.9, row: 0 },
        { x: 208, y: 20, width: 32, height: 32, confidence: 0.9, row: 0 },
      ]),
    });

    expect(context.preflight).toMatchObject({
      kind: "one-row-buff-slots",
      description:
        "버프 아이콘이 한 줄로 길게 보이면 필요한 버프를 읽지 못할 수 있습니다. 게임 설정을 확인한 뒤 계속 제보해주세요.",
    });
  });

  it("samples the current upper-right buff ROI for buff expiry review when no snapshot exists", () => {
    const video = {
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const context = buildContext({
      target: { kind: "buff-expiry" },
      buffExpiryRuntime: { ...createBuffExpiryRuntimeState(), status: "waiting" },
      buffExpirySnapshot: null,
      videoRef: { current: video },
    });

    expect(createBuffExpiryPrecisionDiagnosticRoiPreview).toHaveBeenCalledWith(video);
    expect(context.previewUrl).toBe("data:image/webp;base64,buff-live-roi");
    expect(context.statusText).toBe("버프칸 감지 결과와 추적 상태를 함께 보낼 수 있습니다.");
  });

  it("samples buff expiry evidence from the calibrated game viewport", () => {
    vi.mocked(createBuffExpiryPrecisionDiagnosticRoiPreview).mockClear();
    const video = {
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const calibration = {
      captureSize: { width: 1920, height: 1080 },
      gameResolution: { width: 1366, height: 768 },
      region: { x: 277, y: 156, width: 1366, height: 768 },
      revision: 3,
    };
    const context = buildContext({
      target: { kind: "buff-expiry" },
      buffExpiryRuntime: {
        ...createBuffExpiryRuntimeState(),
        status: "waiting",
      },
      videoRef: { current: video },
      captureLayoutKey: "1920x1080",
      gameLayoutKey: "game:1366x768",
      gameViewport: {
        mode: "calibrated",
        sourceSize: calibration.captureSize,
        gameResolution: calibration.gameResolution,
        region: calibration.region,
        layoutKey: "game:1366x768",
        revision: 3,
      },
      gameViewportState: {
        status: "calibrated",
        calibration,
      },
    });

    expect(createBuffExpiryPrecisionDiagnosticRoiPreview).toHaveBeenCalledWith(
      video,
      0.82,
      calibration.region,
    );
    expect(context.previewUrl).toBe(
      "data:image/webp;base64,buff-live-roi",
    );
  });

  it("does not fall back to full capture when game viewport calibration is stale", () => {
    vi.mocked(createBuffExpiryPrecisionDiagnosticRoiPreview).mockClear();
    const calibration = {
      captureSize: { width: 1920, height: 1080 },
      gameResolution: { width: 1366, height: 768 },
      region: { x: 277, y: 156, width: 1366, height: 768 },
      revision: 4,
    };
    const context = buildContext({
      target: { kind: "buff-expiry" },
      captureSize: { width: 1600, height: 900 },
      captureLayoutKey: "1600x900",
      gameLayoutKey: null,
      gameViewport: null,
      gameViewportState: {
        status: "stale",
        calibration,
        captureSize: { width: 1600, height: 900 },
      },
      videoRef: {
        current: {
          readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
          videoWidth: 1600,
          videoHeight: 900,
        } as HTMLVideoElement,
      },
    });

    expect(createBuffExpiryPrecisionDiagnosticRoiPreview).not.toHaveBeenCalled();
    expect(context.previewUrl).toBeNull();
    expect(context.statusText).toBe("게임 영역을 먼저 설정해주세요.");
  });

  it("does not show stale buff expiry ROI after screen sharing is unavailable", () => {
    vi.mocked(createBuffExpiryPrecisionDiagnosticRoiPreview).mockClear();
    const video = {
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const context = buildContext({
      target: { kind: "buff-expiry" },
      buffExpiryRuntime: { ...createBuffExpiryRuntimeState(), status: "waiting" },
      buffExpirySnapshot: null,
      stream: null,
      captureSize: null,
      videoRef: { current: video },
    });

    expect(createBuffExpiryPrecisionDiagnosticRoiPreview).not.toHaveBeenCalled();
    expect(context.previewUrl).toBeNull();
    expect(context.statusText).toBe("화면 공유가 필요합니다.");
  });

  it("builds booster expiry issue context for the review step", () => {
    const context = buildContext({
      target: { kind: "booster-expiry" },
      boosterExpiryRuntime: {
        ...createBoosterExpiryRuntimeState(),
        status: "confirming",
      },
      boosterExpirySnapshot: {
        sampledAt: 100,
        rawPreviewUrl: "data:image/png;base64,booster-raw",
        timerPreviewUrl: "data:image/png;base64,booster-timer",
        regionLabel: "640x120",
        rawTime: null,
        time: null,
        timeRect: null,
        flow: null,
        performance: null,
        runtimeTrace: [],
        timerEvidence: [],
        confirmationEvidence: [],
      },
    });

    expect(context.previewUrl).toBe("data:image/png;base64,booster-timer");
    expect(context.previewLabel).toBe("현재 부스터 타이머 감지 영역");
    expect(context.statusText).toBe("부스터 타이머 판독 결과와 흐름 보정 상태를 함께 보낼 수 있습니다.");
    expect(context.checklist).toContain("화면 중상단 타이머가 보이는지 확인해주세요.");
    expect(context.checklist).toContain("타이머가 UI에 가려지지 않는지 확인해주세요.");
    expect(context.checklist).toContain("판독값과 흐름 정보 전송을 확인해주세요.");
    expect(context.guideVideoSrc).toBe("");
  });

  it("builds special core issue context for the review step", () => {
    const context = buildContext({
      target: { kind: "special-core" },
      specialCoreRuntime: {
        ...createSpecialCoreRuntimeState(),
        status: "cooldown",
      },
      specialCoreSnapshot: {
        sampledAt: 100,
        boxCount: 8,
        detectedCount: 1,
        detectedIcon: null,
        candidateIcons: [],
        performance: {
          totalMs: 12,
          detectMs: 3,
          matchMs: 8,
          boxCount: 8,
        },
      },
    });

    expect(context.previewLabel).toBe("현재 우상단 버프칸 분석 화면");
    expect(context.emptyPreviewLabel).toBe("버프칸 분석 화면 대기");
    expect(context.statusText).toBe("버프칸 분석 화면과 특수코어 후보 상태를 함께 보낼 수 있습니다.");
    expect(context.checklist).toContain("우상단 버프칸이 보이는지 확인해주세요.");
    expect(context.checklist).toContain("특수코어가 실제로 발동한 상황인지 확인해주세요.");
    expect(context.guideVideoSrc).toBe("");
  });

  it("uses the Ultima Squad crop guide for live and fallback report review", () => {
    const target = { kind: "ultima-raid-equipment" } as const;
    const liveContext = buildContext({ target });
    const fallbackContext = getFallbackContext(target);

    [liveContext, fallbackContext].forEach((context) => {
      expect(context.guideVideoSrc).toBe(
        "/media/ultima-raid-equipment-crop-guide.mp4",
      );
      expect(context.guideVideoLabel).toBe(
        "울티마 스쿼드 화면 영역 선택 예시 영상",
      );
      expect(context.guideTitle).toBe("울티마 스쿼드 화면 선택 예시");
    });
  });

  it("returns fallback issue contexts for each report target", () => {
    expect(getFallbackContext({ kind: "rune" })).toMatchObject({
      previewLabel: "현재 선택한 미니맵 영역",
      statusText: "아직 룬 후보를 찾지 못했습니다.",
    });
    expect(getFallbackContext({ kind: "hunt-stall" })).toMatchObject({
      previewLabel: "현재 사냥 멈춤 감지 영역",
      statusText: "제보 시 현재 설정된 감시 방식으로 화면을 다시 판독합니다.",
    });
    expect(getFallbackContext({ kind: "buff-expiry" })).toMatchObject({
      previewLabel: "현재 우상단 버프 감지 영역",
      statusText: "제보 시 최근 버프 감지 상태를 함께 보냅니다.",
    });
    expect(getFallbackContext({ kind: "buff-expiry" }).checklist).toContain(
      "버프칸이 UI에 가려지지 않는지 확인해주세요.",
    );
    expect(getFallbackContext({ kind: "booster-expiry" })).toMatchObject({
      previewLabel: "현재 부스터 타이머 감지 영역",
      statusText: "제보 시 최근 부스터 타이머 감지 상태를 함께 보냅니다.",
    });
    expect(getFallbackContext({ kind: "special-core" })).toMatchObject({
      previewLabel: "현재 우상단 버프칸 분석 화면",
      statusText: "제보 시 최근 특수코어 감지 상태를 함께 보냅니다.",
    });
    expect(
      getFallbackContext({
        kind: "skill",
        skillId: "skill-1",
        skillName: "에르다 파운틴",
      }),
    ).toMatchObject({
      previewLabel: "현재 선택한 스킬 영역",
      statusText: "아직 숫자를 찾지 못했습니다.",
    });
  });
});
