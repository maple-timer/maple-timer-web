export type {
  NumericRecognitionResult as RecognitionResult,
} from "./contracts/recognition/cooldownDigitRecognition";
export type { PixelRegion } from "./contracts/geometry/pixelRegion";

export type DisplayMode =
  | "side-regular"
  | "center-regular"
  | "center-large"
  | "unknown";

export type RuntimeStatus =
  | "idle"
  | "detecting"
  | "running"
  | "alerted"
  | "lost"
  | "paused";

export type RelativeRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RecognitionMode = "digit-template" | "ocr" | "hybrid";

export type CountdownSource = "duration" | "cooldown";

export type SkillDetectionSource = "quickslot" | "buff-duration";

export type SkillPresetId =
  | "sol-janus-dawn-2min"
  | "sol-janus-dawn-80s"
  | "sol-janus-dawn-70s"
  | "sol-janus-dawn-1min"
  | "sol-janus-dawn-deep-v2"
  | "hologram-graffiti-barrier-vi"
  | "erda-fountain"
  | "erda-fountain-deep-v2"
  | "maehwa-yein-vi"
  | "class-install";

export type RepeatConfig = {
  count: number;
  intervalSeconds: number;
};

export type SkillConfig = {
  id: string;
  name: string;
  presetId?: SkillPresetId;
  detectionSource?: SkillDetectionSource;
  countdownSource: CountdownSource;
  durationSeconds: number;
  cooldownDurationSeconds?: number;
  alertThresholdSeconds: number;
  recognitionStartSeconds: number;
  region: RelativeRegion | null;
  regionsByLayout?: Record<string, RelativeRegion>;
  recognitionMode: RecognitionMode;
  soundId: string;
  volume: number;
  repeatAlertEnabled?: boolean;
  repeatAlertIntervalSeconds?: number;
  repeatAlertMaxCount?: number | null;
  repeat?: RepeatConfig;
  enabled: boolean;
};

export type AlertDefaults = {
  volume: number;
  soundId: string;
};

export type RuneAlertConfig = {
  enabled: boolean;
  region: RelativeRegion | null;
  regionsByLayout?: Record<string, RelativeRegion>;
  soundId: string;
  volume: number;
  repeatAlertEnabled?: boolean;
  repeatAlertIntervalSeconds?: number;
  repeatAlertMaxCount?: number | null;
};

export type UltimaRaidEquipmentAlertConfig = {
  enabled: boolean;
  region: RelativeRegion | null;
  regionsByLayout?: Record<string, RelativeRegion>;
  soundId: string;
  volume: number;
  repeatAlertEnabled?: boolean;
  repeatAlertIntervalSeconds?: number;
  repeatAlertMaxCount?: number | null;
  bossAlert: UltimaRaidBossAlertConfig;
};

export type UltimaRaidBossAlertConfig = {
  enabled: boolean;
  soundId: string;
  volume: number;
  repeatAlertEnabled?: boolean;
  repeatAlertIntervalSeconds?: number;
  repeatAlertMaxCount?: number | null;
};

export type HuntStallAlertMode = "manual-experience" | "cooldown-presence";

export type HuntStallAlertConfig = {
  enabled: boolean;
  mode: HuntStallAlertMode;
  stallThresholdSeconds: number;
  manualExperienceRegion?: RelativeRegion | null;
  manualExperienceRegionsByLayout?: Record<string, RelativeRegion>;
  cooldownRegion: RelativeRegion | null;
  cooldownRegionsByLayout?: Record<string, RelativeRegion>;
  cooldownMissingThresholdSeconds: number;
  soundId: string;
  volume: number;
  repeatAlertEnabled?: boolean;
  repeatAlertIntervalSeconds?: number;
  repeatAlertMaxCount?: number | null;
};

export type BuffExpiryAlertConfig = {
  enabled: boolean;
  alertLeadSeconds: number;
  selectedBuffIds: string[];
  selectedPrecisionTargetGroups?: string[];
  soundId: string;
  volume: number;
};

export type BoosterExpiryAlertConfig = {
  enabled: boolean;
  alertLeadSeconds: number;
  soundId: string;
  volume: number;
};

export type SpecialCoreAlertConfig = {
  enabled: boolean;
  cooldownSeconds: number;
  alertLeadSeconds: number;
  soundId: string;
  volume: number;
};

export type PipTimerSize = "default" | "large" | "focus";

export type PipTimerAlertColor = "amber" | "red" | "cyan" | "violet" | "white";

export type PipTimerEmphasis = "soft" | "balanced" | "strong" | "flash";

export type PipTimerMode = "hunting" | "specialCore";

export type PipTimerVisibleItems = {
  skills: boolean;
  rune: boolean;
  generalTimers: boolean;
  buffExpiry: boolean;
  experience: boolean;
};

export type PipTimerItemAlertColors = Record<keyof PipTimerVisibleItems, PipTimerAlertColor>;

export type PipTimerConfig = {
  mode: PipTimerMode;
  size: PipTimerSize;
  alertColor: PipTimerAlertColor;
  emphasis: PipTimerEmphasis;
  itemAlertColors: PipTimerItemAlertColors;
  visibleItems: PipTimerVisibleItems;
  showScreenPreview?: boolean;
};

export type GeneralTimerPresetId = "30m" | "20m" | "10m" | "2h" | "custom";

export type GeneralTimerConfig = {
  id: string;
  name?: string;
  presetId: GeneralTimerPresetId;
  customDurationSeconds?: number;
  soundId: string;
  volume: number;
  autoRestartEnabled?: boolean;
  enabled: boolean;
  startedAt: number | null;
  endsAt: number | null;
  remainingSecondsAtPause: number | null;
  alertedAt: number | null;
};

export type Profile = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  captureHint?: "window" | "screen";
  displayMode?: DisplayMode;
  skillAlertInitialJitterEnabled?: boolean;
  skills: SkillConfig[];
  runeAlert?: RuneAlertConfig;
  ultimaRaidEquipmentAlert?: UltimaRaidEquipmentAlertConfig;
  huntStallAlert?: HuntStallAlertConfig;
  buffExpiryAlert?: BuffExpiryAlertConfig;
  boosterExpiryAlert?: BoosterExpiryAlertConfig;
  specialCoreAlert?: SpecialCoreAlertConfig;
  pipTimer?: PipTimerConfig;
  generalTimers?: GeneralTimerConfig[];
  masterVolume: number;
  alertDefaults: AlertDefaults;
};

export type SkillRuntimeState = {
  skillId: string;
  observedRemainingSeconds: number | null;
  observedAt: number | null;
  observedRemainingCount: number | null;
  countObservedAt: number | null;
  estimatedExpiresAt: number | null;
  confidence: number;
  status: RuntimeStatus;
  alertedAt: number | null;
  lastRepeatedAlertAt: number | null;
  repeatedAlertCount: number;
  lastAlertCycleStartedAt: number | null;
  initialAlertDelaySeconds: number | null;
  initialAlertDelayCycleStartedAt: number | null;
  rejectedReading: number | null;
  effectiveCooldownDurationSeconds: number | null;
  pendingShortAnchor: {
    observedRemainingSeconds: number;
    maxObservedRemainingSeconds: number;
    observedAt: number;
    estimatedExpiresAt: number;
    count: number;
  } | null;
  pendingRemainingCountIncrease: {
    observedRemainingCount: number;
    observedAt: number;
    count: number;
  } | null;
  pendingRemainingCountDrop: {
    observedRemainingCount: number;
    observedAt: number;
    lastObservedAt: number;
    count: number;
    fromRemainingCount: number;
    minReachableCount: number;
  } | null;
  pendingRemainingCountAlert: {
    observedRemainingCount: number;
    observedAt: number;
    count: number;
  } | null;
  buffDurationCountdownMissingSinceAt: number | null;
  buffDurationTimingEvent: {
    type: "extended";
    occurredAt: number;
  } | null;
};
