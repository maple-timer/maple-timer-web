import type {
  PipTimerDisplay,
  PipTimerItem,
} from "../../../application/pip/pipTimerPresentation";
import type {
  PipTimerAlertColor,
  PipTimerConfig,
  PipTimerItemAlertColors,
  PipTimerVisibleItems,
} from "../../../types";

export const DEFAULT_PIP_SETTINGS_PREVIEW_ITEM_KEY: keyof PipTimerVisibleItems = "skills";
export const PIP_ALERT_STYLE_PREVIEW_MS = 2_500;
export const PIP_MAKER_STEP_VIEWPORT_BREATHING_ROOM_PX = 12;

export type PipMakerStep = "mode" | "content" | "appearance" | "specialCoreAppearance";

export type PipTimerConfigChangeEffects = {
  resizeSize: PipTimerConfig["size"] | null;
  shouldPreviewAlertStyle: boolean;
};

export type PipTimerWindowCleanupPlan = {
  shouldUnmountRoot: boolean;
  shouldCloseWindow: boolean;
};

export type PipMakerStepView = {
  isModeStep: boolean;
  isContentStep: boolean;
  isSpecialCoreAppearanceStep: boolean;
  stepCounterLabel: string;
};

export type PipMakerStepMotionView = {
  key: PipMakerStep;
  className: string;
  initial: false | { opacity: number; x: number };
  exit: undefined | { opacity: number; x: number };
  transition: { duration: number };
};

export function createPipTimerSettingsPreviewDisplay(
  config: PipTimerConfig,
  preferredMainKey: keyof PipTimerVisibleItems,
): PipTimerDisplay {
  if (config.mode === "specialCore") {
    const item: PipTimerItem = {
      id: "preview-special-core",
      kind: "special-core",
      label: "특수코어",
      statusLabel: "곧 사용 가능",
      secondsUntilAlert: 8,
      tone: "alert",
      isUrgent: true,
    };
    return {
      main: item,
      items: [item],
      huntStall: null,
    };
  }

  const { visibleItems } = config;
  const itemsByKey = new Map<keyof PipTimerVisibleItems, PipTimerItem>();

  if (visibleItems.skills) {
    itemsByKey.set("skills", {
      id: "preview-skill",
      kind: "skill",
      label: "스킬 알림",
      statusLabel: "다음 알림",
      secondsUntilAlert: 12,
      tone: "running",
    });
  }

  if (visibleItems.rune) {
    itemsByKey.set("rune", {
      id: "preview-rune",
      kind: "rune",
      label: "룬",
      statusLabel: "룬 대기",
      secondsUntilAlert: null,
      tone: "waiting",
    });
  }

  if (visibleItems.buffExpiry) {
    itemsByKey.set("buffExpiry", {
      id: "preview-buff-expiry",
      kind: "buff-expiry",
      label: "버프 종료",
      statusLabel: "알림 대기",
      secondsUntilAlert: 18,
      tone: "running",
    });
  }

  if (visibleItems.generalTimers) {
    itemsByKey.set("generalTimers", {
      id: "preview-general-timer",
      kind: "general-timer",
      label: "30분 타이머",
      statusLabel: "진행 중",
      secondsUntilAlert: 180,
      tone: "running",
    });
  }

  const previewOrder: Array<keyof PipTimerVisibleItems> = [
    preferredMainKey,
    "skills",
    "rune",
    "experience",
    "buffExpiry",
    "generalTimers",
  ];
  const items = Array.from(new Set(previewOrder))
    .map((key) => itemsByKey.get(key))
    .filter((item): item is PipTimerItem => Boolean(item));

  return {
    main: items.find((item) => item.tone !== "paused") ?? items[0] ?? null,
    items,
    huntStall: visibleItems.experience
      ? {
          mode: "manual-experience",
          badgeLabel: "EXP",
          primaryLabel: "86,649,656,544",
          secondaryLabel: "46.441%",
          progressPercent: 46.441,
          statusLabel: "현재 경험치",
          isStale: false,
          ariaLabel: "경험치 86,649,656,544 46.441%",
        }
      : null,
  };
}

export function getPipTimerActiveDisplay({
  isSettingsOpen,
  runtimeDisplay,
  settingsPreviewDisplay,
}: {
  isSettingsOpen: boolean;
  runtimeDisplay: PipTimerDisplay;
  settingsPreviewDisplay: PipTimerDisplay;
}): PipTimerDisplay {
  return isSettingsOpen ? settingsPreviewDisplay : runtimeDisplay;
}

export function getPipTimerConfigChangeEffects(
  patch: Partial<PipTimerConfig>,
): PipTimerConfigChangeEffects {
  return {
    resizeSize: patch.size ?? null,
    shouldPreviewAlertStyle: Boolean(
      patch.mode || patch.alertColor || patch.emphasis || patch.itemAlertColors,
    ),
  };
}

export function getPipTimerItemAlertColorsAfterChange({
  itemAlertColors,
  itemKey,
  color,
}: {
  itemAlertColors: PipTimerItemAlertColors;
  itemKey: keyof PipTimerItemAlertColors;
  color: PipTimerAlertColor;
}): PipTimerItemAlertColors {
  return {
    ...itemAlertColors,
    [itemKey]: color,
  };
}

export function getPipTimerAlertStylePreviewUntil(now: number): number {
  return now + PIP_ALERT_STYLE_PREVIEW_MS;
}

export function getPipTimerWindowCleanupPlan({
  closeWindow,
  hasPipRoot,
  hasPipWindow,
  isPipWindowClosed,
}: {
  closeWindow: boolean;
  hasPipRoot: boolean;
  hasPipWindow: boolean;
  isPipWindowClosed: boolean;
}): PipTimerWindowCleanupPlan {
  return {
    shouldUnmountRoot: hasPipRoot,
    shouldCloseWindow: closeWindow && hasPipWindow && !isPipWindowClosed,
  };
}

export function getPipMakerStepView(
  step: PipMakerStep,
  mode: PipTimerConfig["mode"],
): PipMakerStepView {
  const isModeStep = step === "mode";
  const isContentStep = step === "content";
  const isSpecialCoreAppearanceStep = step === "specialCoreAppearance";
  const totalStepCount = mode === "specialCore" ? 2 : 3;
  const currentStepNumber =
    step === "mode"
      ? 1
      : step === "content" || step === "specialCoreAppearance"
        ? 2
        : 3;

  return {
    isModeStep,
    isContentStep,
    isSpecialCoreAppearanceStep,
    stepCounterLabel: `${currentStepNumber} / ${totalStepCount}`,
  };
}

const PIP_MAKER_STEP_ORDER: Record<PipMakerStep, number> = {
  mode: 0,
  content: 1,
  specialCoreAppearance: 1,
  appearance: 2,
};

export function getPipMakerStepMotionView({
  step,
  shouldReduceMotion,
}: {
  step: PipMakerStep;
  shouldReduceMotion: boolean;
}): PipMakerStepMotionView {
  const order = PIP_MAKER_STEP_ORDER[step];
  const isForwardStep = order > 0;
  const isContentStep = step === "content";
  const isCompactStep = step === "appearance" || step === "specialCoreAppearance";
  return {
    key: step,
    className: `pip-maker-settings ${
      step === "mode" ? "mode-select" : "two-column"
    }${isContentStep ? "" : isCompactStep ? " compact" : ""}${
      step === "specialCoreAppearance" ? " special-core-appearance" : ""
    }`,
    initial: shouldReduceMotion ? false : { opacity: 0, x: isForwardStep ? 10 : -10 },
    exit: shouldReduceMotion ? undefined : { opacity: 0, x: isForwardStep ? -10 : 10 },
    transition: { duration: shouldReduceMotion ? 0 : 0.16 },
  };
}

export function getPipMakerStepViewportHeight(stepHeight: number | null): number | undefined {
  return stepHeight === null
    ? undefined
    : stepHeight + PIP_MAKER_STEP_VIEWPORT_BREATHING_ROOM_PX;
}

export function getPipMakerPreviewButtonLabel(_isPipOpen: boolean): string {
  return "PIP로 미리보기";
}
