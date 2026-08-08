import { describe, expect, it } from "vitest";
import { DEFAULT_PIP_TIMER_CONFIG } from "../../../lib/pipTimerSettings";
import type { PipTimerConfig } from "../../../types";
import {
  createPipTimerSettingsPreviewDisplay,
  DEFAULT_PIP_SETTINGS_PREVIEW_ITEM_KEY,
  getPipMakerPreviewButtonLabel,
  getPipMakerStepMotionView,
  getPipMakerStepView,
  getPipMakerStepViewportHeight,
  getPipTimerActiveDisplay,
  getPipTimerAlertStylePreviewUntil,
  getPipTimerConfigChangeEffects,
  getPipTimerItemAlertColorsAfterChange,
  getPipTimerWindowCleanupPlan,
  PIP_ALERT_STYLE_PREVIEW_MS,
} from "./pipTimerControlViewModel";

function createConfig(patch: Partial<PipTimerConfig> = {}): PipTimerConfig {
  return {
    ...DEFAULT_PIP_TIMER_CONFIG,
    ...patch,
    itemAlertColors: {
      ...DEFAULT_PIP_TIMER_CONFIG.itemAlertColors,
      ...patch.itemAlertColors,
    },
    visibleItems: {
      ...DEFAULT_PIP_TIMER_CONFIG.visibleItems,
      ...patch.visibleItems,
    },
  };
}

describe("createPipTimerSettingsPreviewDisplay", () => {
  it("uses the default preview item as the main preview item", () => {
    const display = createPipTimerSettingsPreviewDisplay(
      createConfig(),
      DEFAULT_PIP_SETTINGS_PREVIEW_ITEM_KEY,
    );

    expect(display.main?.id).toBe("preview-skill");
    expect(display.items.map((item) => item.id)).toEqual([
      "preview-skill",
      "preview-rune",
      "preview-buff-expiry",
      "preview-general-timer",
    ]);
    expect(display.huntStall).toMatchObject({
      badgeLabel: "EXP",
      primaryLabel: "86,649,656,544",
      progressPercent: 46.441,
    });
  });

  it("moves the selected visible item to the front of the preview list", () => {
    const display = createPipTimerSettingsPreviewDisplay(createConfig(), "buffExpiry");

    expect(display.main?.id).toBe("preview-buff-expiry");
    expect(display.items.map((item) => item.id)).toEqual([
      "preview-buff-expiry",
      "preview-skill",
      "preview-rune",
      "preview-general-timer",
    ]);
  });

  it("falls back to the first visible timer item when the selected item is hidden", () => {
    const display = createPipTimerSettingsPreviewDisplay(
      createConfig({
        visibleItems: {
          skills: true,
          rune: false,
          buffExpiry: false,
          generalTimers: true,
          experience: false,
        },
      }),
      "buffExpiry",
    );

    expect(display.main?.id).toBe("preview-skill");
    expect(display.items.map((item) => item.id)).toEqual([
      "preview-skill",
      "preview-general-timer",
    ]);
    expect(display.huntStall).toBeNull();
  });

  it("can preview only the hunt stall strip when timer rows are hidden", () => {
    const display = createPipTimerSettingsPreviewDisplay(
      createConfig({
        visibleItems: {
          skills: false,
          rune: false,
          buffExpiry: false,
          generalTimers: false,
          experience: true,
        },
      }),
      "experience",
    );

    expect(display.main).toBeNull();
    expect(display.items).toEqual([]);
    expect(display.huntStall?.ariaLabel).toBe("경험치 86,649,656,544 46.441%");
  });

  it("uses a special core preview item in boss PiP mode", () => {
    const display = createPipTimerSettingsPreviewDisplay(
      createConfig({ mode: "specialCore" }),
      "skills",
    );

    expect(display.main).toMatchObject({
      id: "preview-special-core",
      kind: "special-core",
      label: "특수코어",
      statusLabel: "곧 사용 가능",
      secondsUntilAlert: 8,
      tone: "alert",
      isUrgent: true,
    });
    expect(display.items).toHaveLength(1);
    expect(display.huntStall).toBeNull();
  });
});

describe("pip timer control view model", () => {
  it("uses the settings preview display only while the maker is open", () => {
    const runtimeDisplay = createPipTimerSettingsPreviewDisplay(createConfig(), "skills");
    const settingsPreviewDisplay = createPipTimerSettingsPreviewDisplay(
      createConfig(),
      "buffExpiry",
    );

    expect(
      getPipTimerActiveDisplay({
        isSettingsOpen: false,
        runtimeDisplay,
        settingsPreviewDisplay,
      }),
    ).toBe(runtimeDisplay);
    expect(
      getPipTimerActiveDisplay({
        isSettingsOpen: true,
        runtimeDisplay,
        settingsPreviewDisplay,
      }),
    ).toBe(settingsPreviewDisplay);
  });

  it("derives resize and alert-style preview effects from config patches", () => {
    expect(
      getPipTimerConfigChangeEffects({ visibleItems: { ...createConfig().visibleItems } }),
    ).toEqual({
      resizeSize: null,
      shouldPreviewAlertStyle: false,
    });
    expect(getPipTimerConfigChangeEffects({ size: "large" })).toEqual({
      resizeSize: "large",
      shouldPreviewAlertStyle: false,
    });
    expect(getPipTimerConfigChangeEffects({ alertColor: "red" })).toEqual({
      resizeSize: null,
      shouldPreviewAlertStyle: true,
    });
    expect(getPipTimerConfigChangeEffects({ mode: "specialCore" })).toEqual({
      resizeSize: null,
      shouldPreviewAlertStyle: true,
    });
    expect(getPipTimerConfigChangeEffects({ emphasis: "flash" })).toEqual({
      resizeSize: null,
      shouldPreviewAlertStyle: true,
    });
    expect(
      getPipTimerConfigChangeEffects({
        itemAlertColors: {
          ...createConfig().itemAlertColors,
          rune: "cyan",
        },
      }),
    ).toEqual({
      resizeSize: null,
      shouldPreviewAlertStyle: true,
    });
  });

  it("updates one item alert color without replacing the other item colors", () => {
    const current = createConfig().itemAlertColors;

    expect(
      getPipTimerItemAlertColorsAfterChange({
        itemAlertColors: current,
        itemKey: "buffExpiry",
        color: "violet",
      }),
    ).toEqual({
      ...current,
      buffExpiry: "violet",
    });
  });

  it("calculates the alert style preview deadline", () => {
    expect(getPipTimerAlertStylePreviewUntil(1_000)).toBe(1_000 + PIP_ALERT_STYLE_PREVIEW_MS);
  });

  it("plans PiP root unmount and native window closing separately", () => {
    expect(
      getPipTimerWindowCleanupPlan({
        closeWindow: true,
        hasPipRoot: true,
        hasPipWindow: true,
        isPipWindowClosed: false,
      }),
    ).toEqual({
      shouldUnmountRoot: true,
      shouldCloseWindow: true,
    });
    expect(
      getPipTimerWindowCleanupPlan({
        closeWindow: false,
        hasPipRoot: true,
        hasPipWindow: true,
        isPipWindowClosed: false,
      }),
    ).toEqual({
      shouldUnmountRoot: true,
      shouldCloseWindow: false,
    });
    expect(
      getPipTimerWindowCleanupPlan({
        closeWindow: true,
        hasPipRoot: false,
        hasPipWindow: true,
        isPipWindowClosed: true,
      }),
    ).toEqual({
      shouldUnmountRoot: false,
      shouldCloseWindow: false,
    });
  });

  it("describes the maker step counter and content flag", () => {
    expect(getPipMakerStepView("mode", "hunting")).toEqual({
      isModeStep: true,
      isContentStep: false,
      isSpecialCoreAppearanceStep: false,
      stepCounterLabel: "1 / 3",
    });
    expect(getPipMakerStepView("content", "hunting")).toEqual({
      isModeStep: false,
      isContentStep: true,
      isSpecialCoreAppearanceStep: false,
      stepCounterLabel: "2 / 3",
    });
    expect(getPipMakerStepView("appearance", "hunting")).toEqual({
      isModeStep: false,
      isContentStep: false,
      isSpecialCoreAppearanceStep: false,
      stepCounterLabel: "3 / 3",
    });
    expect(getPipMakerStepView("mode", "specialCore")).toEqual({
      isModeStep: true,
      isContentStep: false,
      isSpecialCoreAppearanceStep: false,
      stepCounterLabel: "1 / 2",
    });
    expect(getPipMakerStepView("specialCoreAppearance", "specialCore")).toEqual({
      isModeStep: false,
      isContentStep: false,
      isSpecialCoreAppearanceStep: true,
      stepCounterLabel: "2 / 2",
    });
  });

  it("keeps maker step motion direction deterministic", () => {
    expect(
      getPipMakerStepMotionView({ step: "content", shouldReduceMotion: false }),
    ).toEqual({
      key: "content",
      className: "pip-maker-settings two-column",
      initial: { opacity: 0, x: 10 },
      exit: { opacity: 0, x: -10 },
      transition: { duration: 0.16 },
    });
    expect(
      getPipMakerStepMotionView({ step: "appearance", shouldReduceMotion: false }),
    ).toEqual({
      key: "appearance",
      className: "pip-maker-settings two-column compact",
      initial: { opacity: 0, x: 10 },
      exit: { opacity: 0, x: -10 },
      transition: { duration: 0.16 },
    });
    expect(
      getPipMakerStepMotionView({ step: "appearance", shouldReduceMotion: true }),
    ).toEqual({
      key: "appearance",
      className: "pip-maker-settings two-column compact",
      initial: false,
      exit: undefined,
      transition: { duration: 0 },
    });
    expect(
      getPipMakerStepMotionView({
        step: "specialCoreAppearance",
        shouldReduceMotion: false,
      }),
    ).toEqual({
      key: "specialCoreAppearance",
      className: "pip-maker-settings two-column compact special-core-appearance",
      initial: { opacity: 0, x: 10 },
      exit: { opacity: 0, x: -10 },
      transition: { duration: 0.16 },
    });
  });

  it("calculates maker viewport height and preview button labels", () => {
    expect(getPipMakerStepViewportHeight(null)).toBeUndefined();
    expect(getPipMakerStepViewportHeight(120)).toBe(132);
    expect(getPipMakerPreviewButtonLabel(false)).toBe("PIP로 미리보기");
    expect(getPipMakerPreviewButtonLabel(true)).toBe("PIP로 미리보기");
  });
});
