import type {
  PipTimerAlertColor,
  PipTimerConfig,
  PipTimerEmphasis,
  PipTimerItemAlertColors,
  PipTimerMode,
  PipTimerSize,
  PipTimerVisibleItems,
} from "../types";

export const DEFAULT_PIP_TIMER_ITEM_ALERT_COLORS: PipTimerItemAlertColors = {
  skills: "amber",
  rune: "cyan",
  experience: "violet",
  buffExpiry: "red",
  generalTimers: "white",
};

export const DEFAULT_PIP_TIMER_CONFIG: PipTimerConfig = {
  mode: "hunting",
  size: "default",
  alertColor: "amber",
  emphasis: "balanced",
  itemAlertColors: DEFAULT_PIP_TIMER_ITEM_ALERT_COLORS,
  visibleItems: {
    skills: true,
    rune: true,
    generalTimers: true,
    buffExpiry: true,
    experience: true,
  },
  showScreenPreview: false,
};

export type PipTimerOption<T extends string> = {
  value: T;
  label: string;
  description: string;
};

export const PIP_TIMER_MODE_OPTIONS: Array<PipTimerOption<PipTimerMode>> = [
  {
    value: "hunting",
    label: "사냥용 타이머",
    description: "스킬, 룬, 사냥, 버프 종료, 일반 타이머를 함께 봅니다.",
  },
  {
    value: "specialCore",
    label: "보스용 특수코어",
    description: "특수코어 쿨타임 PIP모드로 사용합니다.",
  },
];

export const PIP_TIMER_SIZE_OPTIONS: Array<PipTimerOption<PipTimerSize>> = [
  {
    value: "default",
    label: "기본",
    description: "작은 창으로 남은 시간을 봅니다.",
  },
  {
    value: "large",
    label: "큼",
    description: "한 화면에서도 더 잘 보이는 크기입니다.",
  },
  {
    value: "focus",
    label: "매우 큼",
    description: "창을 크게 키워 알림 화면처럼 씁니다.",
  },
];

export const PIP_TIMER_ALERT_COLOR_OPTIONS: Array<PipTimerOption<PipTimerAlertColor>> = [
  {
    value: "amber",
    label: "노랑",
    description: "기본 알림색입니다.",
  },
  {
    value: "red",
    label: "빨강",
    description: "가장 강하게 눈에 띕니다.",
  },
  {
    value: "cyan",
    label: "청록",
    description: "어두운 화면에서 선명합니다.",
  },
  {
    value: "violet",
    label: "보라",
    description: "차분하지만 구분이 쉽습니다.",
  },
  {
    value: "white",
    label: "흰색",
    description: "색감이 복잡한 화면에서 또렷합니다.",
  },
];

export const PIP_TIMER_EMPHASIS_OPTIONS: Array<PipTimerOption<PipTimerEmphasis>> = [
  {
    value: "soft",
    label: "은은함",
    description: "색만 살짝 강조합니다.",
  },
  {
    value: "balanced",
    label: "보통",
    description: "현재와 비슷한 강조입니다.",
  },
  {
    value: "strong",
    label: "강하게",
    description: "배경까지 크게 강조합니다.",
  },
  {
    value: "flash",
    label: "점멸",
    description: "놓치지 않도록 화면을 깜빡입니다.",
  },
];

export type PipTimerVisibleItemOption = {
  value: keyof PipTimerVisibleItems;
  label: string;
  description: string;
};

export const PIP_TIMER_VISIBLE_ITEM_OPTIONS: PipTimerVisibleItemOption[] = [
  {
    value: "skills",
    label: "스킬",
    description: "설치기와 쿨타임 알림을 표시합니다.",
  },
  {
    value: "rune",
    label: "룬",
    description: "룬 등장 알림을 표시합니다.",
  },
  {
    value: "experience",
    label: "사냥 멈춤",
    description: "사냥 멈춤 알림 상태를 표시합니다.",
  },
  {
    value: "buffExpiry",
    label: "버프 종료",
    description: "확정된 버프 종료 알림을 표시합니다.",
  },
  {
    value: "generalTimers",
    label: "타이머",
    description: "일반 타이머와 재획 타이머를 표시합니다.",
  },
];

export type PipTimerWindowSize = {
  width: number;
  height: number;
};

export type PipTimerAlertColorTheme = {
  accent: string;
  accentRgb: string;
  surface: string;
  surfaceStrong: string;
  text: string;
};

export const PIP_TIMER_ALERT_COLOR_THEMES: Record<
  PipTimerAlertColor,
  PipTimerAlertColorTheme
> = {
  amber: {
    accent: "#ffd279",
    accentRgb: "255 210 121",
    surface: "#21180d",
    surfaceStrong: "#36220b",
    text: "#1c1407",
  },
  red: {
    accent: "#ff5f6d",
    accentRgb: "255 95 109",
    surface: "#241013",
    surfaceStrong: "#3d1119",
    text: "#2a060b",
  },
  cyan: {
    accent: "#57d8f0",
    accentRgb: "87 216 240",
    surface: "#0b1d22",
    surfaceStrong: "#0c3340",
    text: "#04191f",
  },
  violet: {
    accent: "#b998ff",
    accentRgb: "185 152 255",
    surface: "#19142a",
    surfaceStrong: "#26194a",
    text: "#100722",
  },
  white: {
    accent: "#f5f7ff",
    accentRgb: "245 247 255",
    surface: "#20242b",
    surfaceStrong: "#343b47",
    text: "#11151c",
  },
};

const PIP_TIMER_WINDOW_SIZES: Record<PipTimerSize, PipTimerWindowSize> = {
  default: { width: 360, height: 320 },
  large: { width: 560, height: 420 },
  focus: { width: 860, height: 560 },
};

const PIP_TIMER_MODE_VALUES = new Set<PipTimerMode>(
  PIP_TIMER_MODE_OPTIONS.map((option) => option.value),
);
const PIP_TIMER_SIZE_VALUES = new Set<PipTimerSize>(
  PIP_TIMER_SIZE_OPTIONS.map((option) => option.value),
);
const PIP_TIMER_ALERT_COLOR_VALUES = new Set<PipTimerAlertColor>(
  PIP_TIMER_ALERT_COLOR_OPTIONS.map((option) => option.value),
);
const PIP_TIMER_EMPHASIS_VALUES = new Set<PipTimerEmphasis>(
  PIP_TIMER_EMPHASIS_OPTIONS.map((option) => option.value),
);

function normalizeOption<T extends string>(
  value: unknown,
  validValues: Set<T>,
  fallback: T,
): T {
  return typeof value === "string" && validValues.has(value as T) ? (value as T) : fallback;
}

function createDefaultVisibleItems(): PipTimerVisibleItems {
  return { ...DEFAULT_PIP_TIMER_CONFIG.visibleItems };
}

function createDefaultItemAlertColors(): PipTimerItemAlertColors {
  return { ...DEFAULT_PIP_TIMER_ITEM_ALERT_COLORS };
}

function normalizeVisibleItems(value: unknown): PipTimerVisibleItems {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createDefaultVisibleItems();
  }

  const partial = value as Partial<PipTimerVisibleItems>;
  const defaults = createDefaultVisibleItems();
  return {
    skills: typeof partial.skills === "boolean" ? partial.skills : defaults.skills,
    rune: typeof partial.rune === "boolean" ? partial.rune : defaults.rune,
    generalTimers:
      typeof partial.generalTimers === "boolean"
        ? partial.generalTimers
        : defaults.generalTimers,
    buffExpiry:
      typeof partial.buffExpiry === "boolean" ? partial.buffExpiry : defaults.buffExpiry,
    experience:
      typeof partial.experience === "boolean" ? partial.experience : defaults.experience,
  };
}

function normalizeItemAlertColors(value: unknown): PipTimerItemAlertColors {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createDefaultItemAlertColors();
  }

  const partial = value as Partial<PipTimerItemAlertColors>;
  const defaults = createDefaultItemAlertColors();
  return {
    skills: normalizeOption(partial.skills, PIP_TIMER_ALERT_COLOR_VALUES, defaults.skills),
    rune: normalizeOption(partial.rune, PIP_TIMER_ALERT_COLOR_VALUES, defaults.rune),
    experience: normalizeOption(
      partial.experience,
      PIP_TIMER_ALERT_COLOR_VALUES,
      defaults.experience,
    ),
    buffExpiry: normalizeOption(
      partial.buffExpiry,
      PIP_TIMER_ALERT_COLOR_VALUES,
      defaults.buffExpiry,
    ),
    generalTimers: normalizeOption(
      partial.generalTimers,
      PIP_TIMER_ALERT_COLOR_VALUES,
      defaults.generalTimers,
    ),
  };
}

export function normalizePipTimerConfig(value: unknown): PipTimerConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createDefaultPipTimerConfig();
  }

  const partial = value as Partial<PipTimerConfig>;
  return {
    mode: normalizeOption(
      partial.mode,
      PIP_TIMER_MODE_VALUES,
      DEFAULT_PIP_TIMER_CONFIG.mode,
    ),
    size: normalizeOption(
      partial.size,
      PIP_TIMER_SIZE_VALUES,
      DEFAULT_PIP_TIMER_CONFIG.size,
    ),
    alertColor: normalizeOption(
      partial.alertColor,
      PIP_TIMER_ALERT_COLOR_VALUES,
      DEFAULT_PIP_TIMER_CONFIG.alertColor,
    ),
    emphasis: normalizeOption(
      partial.emphasis,
      PIP_TIMER_EMPHASIS_VALUES,
      DEFAULT_PIP_TIMER_CONFIG.emphasis,
    ),
    itemAlertColors: normalizeItemAlertColors(partial.itemAlertColors),
    visibleItems: normalizeVisibleItems(partial.visibleItems),
    showScreenPreview:
      typeof partial.showScreenPreview === "boolean"
        ? partial.showScreenPreview
        : DEFAULT_PIP_TIMER_CONFIG.showScreenPreview,
  };
}

export function createDefaultPipTimerConfig(): PipTimerConfig {
  return {
    ...DEFAULT_PIP_TIMER_CONFIG,
    itemAlertColors: createDefaultItemAlertColors(),
    visibleItems: createDefaultVisibleItems(),
  };
}

export function getPipTimerWindowSize(size: PipTimerSize): PipTimerWindowSize {
  return PIP_TIMER_WINDOW_SIZES[size] ?? PIP_TIMER_WINDOW_SIZES.default;
}

export function getPipTimerAlertColorTheme(
  color: PipTimerAlertColor,
): PipTimerAlertColorTheme {
  return PIP_TIMER_ALERT_COLOR_THEMES[color] ?? PIP_TIMER_ALERT_COLOR_THEMES.amber;
}
