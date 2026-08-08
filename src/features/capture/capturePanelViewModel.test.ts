import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SOUND_ID } from "../../lib/sounds";
import type { RuneAlertConfig, SkillConfig } from "../../types";
import {
  getCapturePanelViewModel,
  getCaptureStaticRegionBoxes,
  getGameResolutionLabel,
} from "./capturePanelViewModel";

function makeSkill(partial: Partial<SkillConfig> = {}): SkillConfig {
  return {
    id: partial.id ?? "skill-1",
    name: partial.name ?? "새 스킬",
    countdownSource: partial.countdownSource ?? "duration",
    durationSeconds: partial.durationSeconds ?? 60,
    alertThresholdSeconds: partial.alertThresholdSeconds ?? 5,
    recognitionStartSeconds: partial.recognitionStartSeconds ?? 60,
    region: partial.region ?? { x: 0.1, y: 0.2, width: 0.04, height: 0.04 },
    recognitionMode: partial.recognitionMode ?? "digit-template",
    soundId: partial.soundId ?? DEFAULT_ALERT_SOUND_ID,
    volume: partial.volume ?? 0.85,
    repeat: partial.repeat,
    enabled: partial.enabled ?? true,
    regionsByLayout: partial.regionsByLayout,
  };
}

describe("capturePanelViewModel", () => {
  it("formats pending, raw, and matched game resolution labels", () => {
    expect(getGameResolutionLabel(null)).toBe("캡처 대기");
    expect(getGameResolutionLabel({ width: 1200, height: 900 })).toBe("1200 x 900");
    expect(getGameResolutionLabel({ width: 1922, height: 1118 })).toBe("1920 x 1080");
    expect(getGameResolutionLabel({ width: 1922, height: 1330 })).toBe("1920 x 1200");
  });

  it("builds capture panel state for collapsed idle capture", () => {
    expect(
      getCapturePanelViewModel({
        stream: null,
        captureStatus: "idle",
        captureSize: null,
        isCollapsed: true,
      }),
    ).toEqual({
      layoutKey: null,
      captureSizeLabel: "캡처 대기",
      canStartCapture: true,
      shellClassName: "video-shell",
      shellStyle: undefined,
      shouldShowCollapsedStartButton: true,
      shouldShowChangeButton: false,
      shouldShowStaticOverlay: false,
      shouldShowPlaceholder: false,
    });
  });

  it("builds capture panel state for active shared video", () => {
    expect(
      getCapturePanelViewModel({
        stream: {} as MediaStream,
        captureStatus: "active",
        captureSize: { width: 1920, height: 1080 },
        currentLayoutKey: "custom-layout",
        isCollapsed: false,
      }),
    ).toEqual({
      layoutKey: "custom-layout",
      captureSizeLabel: "1920 x 1080",
      canStartCapture: false,
      shellClassName: "video-shell has-video",
      shellStyle: { aspectRatio: "1920 / 1080" },
      shouldShowCollapsedStartButton: false,
      shouldShowChangeButton: true,
      shouldShowStaticOverlay: true,
      shouldShowPlaceholder: false,
    });
  });

  it("builds static overlay boxes from layout-specific skill regions and rune region", () => {
    const runeAlert: RuneAlertConfig = {
      enabled: true,
      region: { x: 0.6, y: 0.1, width: 0.08, height: 0.08 },
      soundId: DEFAULT_ALERT_SOUND_ID,
      volume: 1,
    };

    const boxes = getCaptureStaticRegionBoxes({
      skills: [
        makeSkill({
          id: "base-only",
          region: { x: 0.1, y: 0.2, width: 0.04, height: 0.04 },
        }),
        makeSkill({
          id: "layout-skill",
          region: { x: 0.2, y: 0.3, width: 0.04, height: 0.04 },
          regionsByLayout: {
            "1920x1080": { x: 0.4, y: 0.5, width: 0.02, height: 0.03 },
          },
        }),
        makeSkill({
          id: "other-layout-only",
          region: { x: 0.2, y: 0.3, width: 0.04, height: 0.04 },
          regionsByLayout: {
            "2560x1440": { x: 0.4, y: 0.5, width: 0.02, height: 0.03 },
          },
        }),
      ],
      runeAlert,
      layoutKey: "1920x1080",
      sourceAspect: 16 / 9,
    });

    expect(boxes.map((box) => box.id)).toEqual(["base-only", "layout-skill", "rune"]);
    expect(boxes[0].style).toMatchObject({
      left: "10%",
      top: "20%",
    });
    expect(boxes[1].style).toEqual({
      left: "40%",
      top: "50%",
      width: "2.0000000000000018%",
      height: "3.5555555555555562%",
    });
    expect(boxes[2]).toEqual({
      id: "rune",
      className: "region-static-box rune-region-static-box",
      style: {
        left: "60%",
        top: "10%",
        width: "8%",
        height: "8%",
      },
    });
  });

  it("omits static overlay boxes when regions are unusable", () => {
    expect(
      getCaptureStaticRegionBoxes({
        skills: [
          makeSkill({
            region: { x: 0.1, y: 0.1, width: 0.001, height: 0.001 },
          }),
        ],
        runeAlert: {
          enabled: false,
          region: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
          soundId: DEFAULT_ALERT_SOUND_ID,
          volume: 1,
        },
        layoutKey: null,
        sourceAspect: 16 / 9,
      }),
    ).toEqual([]);
  });
});
