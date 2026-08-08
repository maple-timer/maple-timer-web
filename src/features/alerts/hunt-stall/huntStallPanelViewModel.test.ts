import { describe, expect, it } from "vitest";
import type { HuntStallRuntimeState, HuntStallSnapshot } from "../../../alertTypes";
import type { HuntStallAlertConfig } from "../../../types";
import { getHuntStallPanelViewModel } from "./huntStallPanelViewModel";

const config: HuntStallAlertConfig = {
  enabled: true,
  mode: "manual-experience",
  stallThresholdSeconds: 10,
  manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
  manualExperienceRegionsByLayout: {},
  cooldownRegion: null,
  cooldownRegionsByLayout: {},
  cooldownMissingThresholdSeconds: 7,
  soundId: "띵동띵동",
  volume: 0.8,
};

const state: HuntStallRuntimeState = {
  status: "active",
  lastChangedAt: 1_000,
  lastSampledAt: 2_000,
  lastReadableAt: 2_000,
  lastReadFailureAt: null,
  unreadableSinceAt: null,
  alertedAt: null,
  lastRepeatedAlertAt: null,
  repeatedAlertCount: 0,
  lastAlertedAt: null,
  stableSampleCount: 3,
  unchangedSeconds: 0,
  fingerprint: "101",
  recognizedText: "1,530,768,605,709 [11.120%]",
  alertedRecognizedText: null,
  pendingRecognizedText: null,
  pendingRecognizedCount: 0,
  lastRejectedRecognizedText: null,
  lastReadFailureReason: null,
  lastDecision: "stable",
  hasObservedExperienceChange: true,
  hasObservedCooldownPresence: false,
  cooldownLastDetectedAt: null,
  cooldownMissingSinceAt: null,
  cooldownMissingSeconds: 0,
  cooldownConsecutiveReadableCount: 0,
  confidence: 0.98,
  changeScore: 0,
};

const snapshot: HuntStallSnapshot = {
  sampledAt: 3_000,
  rawPreviewUrl: "data:image/png;base64,raw",
  displayPreviewUrl: "data:image/png;base64,display",
  processedPreviewUrl: "data:image/png;base64,processed",
  mode: "manual-experience",
  regionLabel: "220x17",
  recognizedText: "149,655,215 [46.441%]",
  confidence: 0.98,
  foregroundRatio: 0.07,
  changeScore: 0,
};

function getViewModel(
  overrides: Partial<Parameters<typeof getHuntStallPanelViewModel>[0]> = {},
) {
  return getHuntStallPanelViewModel({
    config,
    state,
    snapshot,
    hasStream: true,
    currentLayoutKey: null,
    now: 9_000,
    ...overrides,
  });
}

describe("getHuntStallPanelViewModel", () => {
  it("shows a game viewport setup state without disabling the alert settings", () => {
    const viewModel = getViewModel({ isGameViewportReady: false });

    expect(viewModel.statusView).toEqual({
      label: "게임 영역 설정 필요",
      detail: "화면 공유 메뉴에서 설정",
      className: "warning",
    });
    expect(viewModel.cropLabel).toBe("게임 영역 설정 필요");
    expect(viewModel.manualExperienceStatusDetail).toBe(
      "화면 공유 메뉴에서 게임 영역 설정",
    );
  });

  it("uses manual experience labels and threshold settings in experience mode", () => {
    const viewModel = getViewModel();

    expect(viewModel.isCooldownPresenceMode).toBe(false);
    expect(viewModel.isManualExperienceMode).toBe(true);
    expect(viewModel.displayStatus).toBe("active");
    expect(viewModel.manualExperiencePreviewUrl).toBe(snapshot.displayPreviewUrl);
    expect(viewModel.thresholdValue).toBe(10);
    expect(viewModel.thresholdAriaLabel).toBe("사냥 멈춤 기준");
    expect(viewModel.thresholdRangeHint).toBe("5-120초");
    expect(viewModel.thresholdMin).toBe(5);
    expect(viewModel.thresholdMax).toBe(120);
    expect(viewModel.lastActivityLabel).toBe("마지막 경험치 변화");
    expect(viewModel.lastActivityAt).toBe(1_000);
  });

  it("does not show a last experience increase before hunting has been observed", () => {
    const viewModel = getViewModel({
      state: {
        ...state,
        status: "watching",
        lastChangedAt: 1_000,
        hasObservedExperienceChange: false,
      },
    });

    expect(viewModel.statusView.label).toBe("시작 대기");
    expect(viewModel.lastActivityAt).toBeNull();
  });

  it("uses cooldown mode labels and trusted cooldown readings", () => {
    const viewModel = getViewModel({
      config: {
        ...config,
        mode: "cooldown-presence",
        cooldownRegion: { x: 10, y: 20, width: 40, height: 40 },
      },
      state: {
        ...state,
        recognizedText: "7",
        unchangedSeconds: 3,
        hasObservedCooldownPresence: true,
        lastDecision: "cooldown-readable",
      },
      snapshot: {
        ...snapshot,
        mode: "cooldown-presence",
        recognizedText: "7",
      },
    });

    expect(viewModel.isCooldownPresenceMode).toBe(true);
    expect(viewModel.displayStatus).toBe("active");
    expect(viewModel.cooldownCropLabel).toBe("쿨타임 확인");
    expect(viewModel.cropLabel).toBe("쿨타임 확인");
    expect(viewModel.cooldownValueLabel).toBe("7");
    expect(viewModel.cooldownPreviewUrl).toBe(snapshot.rawPreviewUrl);
    expect(viewModel.thresholdValue).toBe(7);
    expect(viewModel.thresholdAriaLabel).toBe("쿨타임 변화 없음 멈춤 기준");
    expect(viewModel.thresholdRangeHint).toBe("1-60초");
    expect(viewModel.editorColSpan).toBe(8);
    expect(viewModel.lastActivityLabel).toBe("마지막 변화");
    expect(viewModel.lastActivityNow).toBe(9_000);
    expect(viewModel.cooldownStatusDetail).toBe("숫자/화면 변화 확인 중");
  });

  it("ignores manual experience preview snapshots in cooldown mode", () => {
    const viewModel = getViewModel({
      config: {
        ...config,
        mode: "cooldown-presence",
        cooldownRegion: { x: 10, y: 20, width: 40, height: 40 },
      },
      snapshot: {
        ...snapshot,
        mode: "manual-experience",
        rawPreviewUrl: "data:image/png;base64,manual-raw",
        displayPreviewUrl: "data:image/png;base64,manual-display",
      },
    });

    expect(viewModel.cooldownPreviewUrl).toBeNull();
    expect(viewModel.cooldownPreviewImageData).toBeNull();
    expect(viewModel.cooldownCropLabel).toBe("쿨타임 확인");
  });

  it("uses wall-clock time for the last activity metric while readable samples are active", () => {
    const viewModel = getViewModel({
      state: {
        ...state,
        lastChangedAt: 1_000,
        lastSampledAt: 4_000,
        unchangedSeconds: 3,
        unreadableSinceAt: null,
      },
      now: 9_000,
    });

    expect(viewModel.lastActivityAt).toBe(1_000);
    expect(viewModel.lastActivityNow).toBe(9_000);
  });

  it("keeps the last activity metric pinned to the last sample while unreadable", () => {
    const viewModel = getViewModel({
      state: {
        ...state,
        status: "unavailable",
        lastChangedAt: 1_000,
        lastSampledAt: 4_000,
        unreadableSinceAt: 4_000,
      },
      now: 9_000,
    });

    expect(viewModel.lastActivityAt).toBe(1_000);
    expect(viewModel.lastActivityNow).toBe(4_000);
  });

  it("uses manual experience mode labels and the selected experience band", () => {
    const viewModel = getViewModel({
      config: {
        ...config,
        mode: "manual-experience",
        manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
      },
      snapshot: {
        ...snapshot,
        mode: "manual-experience",
      },
    });

    expect(viewModel.isManualExperienceMode).toBe(true);
    expect(viewModel.usesManualCrop).toBe(true);
    expect(viewModel.displayStatus).toBe("active");
    expect(viewModel.manualExperienceCropLabel).toBe("경험치바 확인");
    expect(viewModel.cropLabel).toBe("경험치바 확인");
    expect(viewModel.manualExperiencePreviewUrl).toBe(snapshot.displayPreviewUrl);
    expect(viewModel.editorColSpan).toBe(8);
    expect(viewModel.lastActivityLabel).toBe("마지막 경험치 변화");
    expect(viewModel.statusView.detail).toBe("마지막 변화 0초 전");
  });

  it("keeps manual experience previews visible when only canvas image data is available", () => {
    const imageData = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(2 * 2 * 4),
    };
    const viewModel = getViewModel({
      config: {
        ...config,
        mode: "manual-experience",
        manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
      },
      snapshot: {
        ...snapshot,
        mode: "manual-experience",
        displayPreviewUrl: null,
        rawPreviewUrl: null,
        rawPreviewImageData: imageData,
      },
    });

    expect(viewModel.manualExperiencePreviewUrl).toBeNull();
    expect(viewModel.manualExperiencePreviewImageData).toBe(imageData);
  });

  it("prefers original display crop data over the scaled OCR crop", () => {
    const rawImageData = {
      width: 6,
      height: 6,
      data: new Uint8ClampedArray(6 * 6 * 4),
    };
    const displayImageData = {
      width: 3,
      height: 3,
      data: new Uint8ClampedArray(3 * 3 * 4),
    };
    const viewModel = getViewModel({
      config: {
        ...config,
        mode: "manual-experience",
        manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
      },
      snapshot: {
        ...snapshot,
        mode: "manual-experience",
        rawPreviewUrl: "data:image/png;base64,scaled",
        rawPreviewImageData: rawImageData,
        displayPreviewUrl: "data:image/png;base64,original",
        displayPreviewImageData: displayImageData,
      },
    });

    expect(viewModel.manualExperiencePreviewUrl).toBe("data:image/png;base64,original");
    expect(viewModel.manualExperiencePreviewImageData).toBe(displayImageData);
  });

  it("blocks manual experience monitoring when the current layout has no selected band", () => {
    const viewModel = getViewModel({
      config: {
        ...config,
        mode: "manual-experience",
        manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
        manualExperienceRegionsByLayout: {
          other: { x: 0.33, y: 0.95, width: 0.34, height: 0.01 },
        },
      },
      currentLayoutKey: "current",
    });

    expect(viewModel.displayStatus).toBe("no-region");
    expect(viewModel.manualExperienceCropLabel).toBe("다시 선택 필요");
    expect(viewModel.cropLabel).toBe("다시 선택 필요");
    expect(viewModel.manualExperiencePreviewUrl).toBeNull();
  });

  it("blocks cooldown monitoring when the current layout has no cooldown region", () => {
    const viewModel = getViewModel({
      config: {
        ...config,
        mode: "cooldown-presence",
        cooldownRegion: { x: 10, y: 20, width: 40, height: 40 },
        cooldownRegionsByLayout: {
          other: { x: 20, y: 30, width: 40, height: 40 },
        },
      },
      currentLayoutKey: "current",
    });

    expect(viewModel.displayStatus).toBe("no-region");
    expect(viewModel.cooldownCropLabel).toBe("쿨타임 영역 다시 선택");
    expect(viewModel.cropLabel).toBe("쿨타임 영역 다시 선택");
    expect(viewModel.cooldownValueLabel).toBe("영역 필요");
    expect(viewModel.cooldownStatusDetail).toBe("쿨타임 아이콘 영역 필요");
  });

  it("hides untrusted cooldown OCR text behind visual activity fallback", () => {
    const viewModel = getViewModel({
      config: {
        ...config,
        mode: "cooldown-presence",
        cooldownRegion: { x: 10, y: 20, width: 40, height: 40 },
      },
      state: {
        ...state,
        recognizedText: "7",
        hasObservedCooldownPresence: true,
        cooldownUsedVisualActivity: true,
        lastDecision: "cooldown-visual-active",
      },
      snapshot: {
        ...snapshot,
        mode: "cooldown-presence",
        recognizedText: "19",
      },
    });

    expect(viewModel.cooldownValueLabel).toBe("화면 변화");
  });
});
