import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultHuntStallAlert } from "../../lib/storage";
import { createHuntStallRuntimeState } from "../../lib/huntStall";
import { createHuntStallReportSnapshot } from "./huntStallReportSnapshot";

const mocks = vi.hoisted(() => ({
  sampleSkill: vi.fn(),
  sampleGameViewportSkill: vi.fn(),
  sampleManualExperienceFromVideo: vi.fn(),
  recognize: vi.fn(),
}));

vi.mock("../../lib/capture", () => ({
  sampleSkill: mocks.sampleSkill,
}));

vi.mock("../../platform/frame-capture/gameViewportSampling", () => ({
  sampleGameViewportSkill: mocks.sampleGameViewportSkill,
}));

vi.mock("../../lib/huntStallManualExperienceSampling", () => ({
  sampleManualExperienceFromVideo: mocks.sampleManualExperienceFromVideo,
}));

vi.mock("../../lib/recognition", () => ({
  getRecognitionEngine: () => ({ recognize: mocks.recognize }),
}));

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

describe("createHuntStallReportSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("samples cooldown evidence from the calibrated game viewport", async () => {
    const config = {
      ...createDefaultHuntStallAlert(),
      mode: "cooldown-presence" as const,
      cooldownRegion: { x: 0.8, y: 0.8, width: 0.04, height: 0.04 },
      cooldownRegionsByLayout: {
        "game:1366x768": {
          x: 0.8,
          y: 0.8,
          width: 0.04,
          height: 0.04,
        },
      },
    };
    mocks.sampleGameViewportSkill.mockReturnValue({
      imageData: {} as ImageData,
      rawPreviewUrl: "data:image/png;base64,raw",
      previewUrl: "data:image/png;base64,processed",
      region: { x: 1, y: 2, width: 32, height: 32 },
    });
    mocks.recognize.mockReturnValue({
      value: 7,
      confidence: 0.9,
      debug: { foregroundRatio: 0.1 },
    });

    await createHuntStallReportSnapshot({
      config,
      layoutKey: "game:1366x768",
      state: createHuntStallRuntimeState(),
      video,
      gameViewport,
    });

    expect(mocks.sampleGameViewportSkill).toHaveBeenCalledWith(
      video,
      gameViewport,
      config.cooldownRegionsByLayout["game:1366x768"],
      true,
    );
    expect(mocks.sampleSkill).not.toHaveBeenCalled();
  });

  it("passes the calibrated source rectangle to experience sampling", async () => {
    const config = {
      ...createDefaultHuntStallAlert(),
      mode: "manual-experience" as const,
      manualExperienceRegion: {
        x: 0,
        y: 0.95,
        width: 1,
        height: 0.03,
      },
      manualExperienceRegionsByLayout: {
        "game:1366x768": {
          x: 0,
          y: 0.95,
          width: 1,
          height: 0.03,
        },
      },
    };
    mocks.sampleManualExperienceFromVideo.mockReturnValue({
      snapshot: {
        sampledAt: 100,
        rawPreviewUrl: "data:image/png;base64,raw",
        processedPreviewUrl: "data:image/png;base64,processed",
        regionLabel: "1366x23",
        recognizedText: "1.234%",
        confidence: 0.9,
        foregroundRatio: 0.1,
        changeScore: 0,
      },
    });

    await createHuntStallReportSnapshot({
      config,
      layoutKey: "game:1366x768",
      state: createHuntStallRuntimeState(),
      video,
      gameViewport,
    });

    expect(mocks.sampleManualExperienceFromVideo).toHaveBeenCalledWith({
      video,
      region: config.manualExperienceRegionsByLayout["game:1366x768"],
      includePreview: true,
      includeReportDiagnostics: true,
      sourceRegion: gameViewport.region,
    });
  });

  it("refuses to sample a fixed HUD report while calibration is stale", async () => {
    await expect(
      createHuntStallReportSnapshot({
        config: createDefaultHuntStallAlert(),
        layoutKey: null,
        state: createHuntStallRuntimeState(),
        video,
        gameViewport: null,
      }),
    ).rejects.toThrow("게임 영역을 먼저 설정해주세요.");
    expect(mocks.sampleManualExperienceFromVideo).not.toHaveBeenCalled();
  });
});
