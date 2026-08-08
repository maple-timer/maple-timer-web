import type { HuntStallRuntimeState, RuneRuntimeState } from "../../alertTypes";
import type {
  BuffExpiryRuntimeState,
  BuffExpiryTrackedBuff,
} from "../../lib/buffExpiry/buffExpiryTypes";
import type {
  BuffExpiryAlertConfig,
  GeneralTimerConfig,
  HuntStallAlertConfig,
  PipTimerVisibleItems,
  RuneAlertConfig,
  SkillConfig,
  SkillRuntimeState,
  SpecialCoreAlertConfig,
} from "../../types";
import {
  getGeneralTimerPreset,
  getGeneralTimerRemainingSeconds,
  getGeneralTimerStatus,
} from "../../domain/general-timer/generalTimers";
import {
  getBuffExpiryEffectiveAlertLeadSeconds,
} from "../../domain/buff-expiry/alertLeadPolicy";
import {
  getEstimatedRemainingSeconds,
  getSignedEstimatedRemainingSeconds,
} from "../../lib/timer";
import {
  getSpecialCoreRemainingSecondsForDisplay,
} from "../../lib/specialCore/specialCoreAlertConfig";
import type { SpecialCoreRuntimeState } from "../../lib/specialCore/specialCoreAlertTypes";

export type PipTimerItemKind =
  | "skill"
  | "rune"
  | "general-timer"
  | "buff-expiry"
  | "hunt-stall"
  | "special-core";
export type PipTimerItemTone = "alert" | "running" | "waiting" | "paused";

export type PipTimerItem = {
  id: string;
  kind: PipTimerItemKind;
  label: string;
  iconLabel?: string;
  iconPaths?: string[];
  statusLabel: string;
  secondsUntilAlert: number | null;
  tone: PipTimerItemTone;
  isUrgent?: boolean;
};

export type PipHuntStallInfo = {
  mode: "manual-experience" | "cooldown-presence";
  badgeLabel: string;
  primaryLabel: string;
  secondaryLabel: string;
  progressPercent: number;
  statusLabel: string;
  isStale: boolean;
  ariaLabel: string;
};

export type PipTimerDisplay = {
  main: PipTimerItem | null;
  items: PipTimerItem[];
  huntStall: PipHuntStallInfo | null;
};

const DEFAULT_PIP_VISIBLE_ITEMS: PipTimerVisibleItems = {
  skills: true,
  rune: true,
  generalTimers: true,
  buffExpiry: true,
  experience: true,
};

const PIP_RECENT_ALERT_VISIBLE_MS = 8_000;

const RUNE_STATUS_LABELS: Record<RuneRuntimeState["status"], string> = {
  paused: "꺼짐",
  "no-stream": "화면 공유 필요",
  "no-region": "미니맵 영역 필요",
  loading: "로딩 중",
  waiting: "룬 대기",
  candidate: "룬 확인 중",
  alerted: "룬 등장",
  unavailable: "감지 오류",
};

const HUNT_STALL_STATUS_LABELS: Record<HuntStallRuntimeState["status"], string> = {
  paused: "꺼짐",
  "no-stream": "화면 공유 필요",
  "no-region": "영역 필요",
  detecting: "읽기 대기",
  watching: "시작 대기",
  active: "감시 중",
  stalled: "멈춤 의심",
  alerted: "알림 완료",
  unavailable: "감지 대기",
};

function getSkillTimerItem(
  skill: SkillConfig,
  state: SkillRuntimeState | undefined,
  now: number,
): PipTimerItem {
  if (!skill.enabled || state?.status === "paused") {
    return {
      id: skill.id,
      kind: "skill",
      label: skill.name,
      statusLabel: "중지",
      secondsUntilAlert: null,
      tone: "paused",
    };
  }

  if (!state) {
    return {
      id: skill.id,
      kind: "skill",
      label: skill.name,
      statusLabel: "대기",
      secondsUntilAlert: null,
      tone: "waiting",
    };
  }

  if (state?.status === "alerted") {
    return {
      id: skill.id,
      kind: "skill",
      label: skill.name,
      statusLabel: "재설치",
      secondsUntilAlert: 0,
      tone: "alert",
    };
  }

  const estimatedRemainingSeconds = getEstimatedRemainingSeconds(state, now);
  if (estimatedRemainingSeconds === null) {
    return {
      id: skill.id,
      kind: "skill",
      label: skill.name,
      statusLabel: state?.status === "detecting" ? "감지 중" : "대기",
      secondsUntilAlert: null,
      tone: "waiting",
    };
  }

  const signedEstimatedRemainingSeconds =
    getSignedEstimatedRemainingSeconds(state, now) ?? estimatedRemainingSeconds;
  const secondsUntilAlert = Math.max(
    0,
    signedEstimatedRemainingSeconds - skill.alertThresholdSeconds,
  );

  return {
    id: skill.id,
    kind: "skill",
    label: skill.name,
    statusLabel: secondsUntilAlert === 0 ? "재설치" : "다음 알림",
    secondsUntilAlert,
    tone: secondsUntilAlert === 0 ? "alert" : "running",
  };
}

function getRuneTimerItem(
  runeConfig: RuneAlertConfig,
  runeState: RuneRuntimeState,
): PipTimerItem {
  if (!runeConfig.enabled || runeState.status === "paused") {
    return {
      id: "rune",
      kind: "rune",
      label: "룬",
      statusLabel: "꺼짐",
      secondsUntilAlert: null,
      tone: "paused",
    };
  }

  if (runeState.status === "alerted") {
    return {
      id: "rune",
      kind: "rune",
      label: "룬",
      statusLabel: RUNE_STATUS_LABELS.alerted,
      secondsUntilAlert: 0,
      tone: "alert",
    };
  }

  return {
    id: "rune",
    kind: "rune",
    label: "룬",
    statusLabel: RUNE_STATUS_LABELS[runeState.status],
    secondsUntilAlert: null,
    tone: runeState.status === "candidate" ? "alert" : "waiting",
  };
}

function getGeneralTimerItem(timer: GeneralTimerConfig, now: number): PipTimerItem {
  const status = getGeneralTimerStatus(timer, now);
  const remainingSeconds = getGeneralTimerRemainingSeconds(timer, now);
  const preset = getGeneralTimerPreset(timer.presetId);
  const label =
    timer.name ?? (timer.presetId === "custom" ? "사용자 타이머" : preset.label);
  const iconLabel = preset.iconLabel;
  const iconPaths = preset.iconPaths;

  if (status === "disabled") {
    return {
      id: `general-timer:${timer.id}`,
      kind: "general-timer",
      label,
      iconLabel,
      iconPaths,
      statusLabel: "꺼짐",
      secondsUntilAlert: null,
      tone: "paused",
    };
  }

  if (status === "done") {
    return {
      id: `general-timer:${timer.id}`,
      kind: "general-timer",
      label,
      iconLabel,
      iconPaths,
      statusLabel: "완료",
      secondsUntilAlert: 0,
      tone: "alert",
    };
  }

  if (status === "running") {
    return {
      id: `general-timer:${timer.id}`,
      kind: "general-timer",
      label,
      iconLabel,
      iconPaths,
      statusLabel: "진행 중",
      secondsUntilAlert: remainingSeconds,
      tone: "running",
    };
  }

  if (status === "paused") {
    return {
      id: `general-timer:${timer.id}`,
      kind: "general-timer",
      label,
      iconLabel,
      iconPaths,
      statusLabel: "일시정지",
      secondsUntilAlert: remainingSeconds,
      tone: "paused",
    };
  }

  return {
    id: `general-timer:${timer.id}`,
    kind: "general-timer",
    label,
    iconLabel,
    iconPaths,
    statusLabel: "시작 전",
    secondsUntilAlert: remainingSeconds,
    tone: "paused",
  };
}

function getBuffExpiryTimerItem({
  buffExpiryConfig,
  buffExpiryState,
  now,
}: {
  buffExpiryConfig?: BuffExpiryAlertConfig | null;
  buffExpiryState?: BuffExpiryRuntimeState | null;
  now: number;
}): PipTimerItem | null {
  if (!buffExpiryConfig) {
    return null;
  }

  if (!buffExpiryConfig.enabled || buffExpiryState?.status === "paused") {
    return {
      id: "buff-expiry",
      kind: "buff-expiry",
      label: "버프 종료",
      statusLabel: "꺼짐",
      secondsUntilAlert: null,
      tone: "paused",
    };
  }

  if (!buffExpiryState) {
    return {
      id: "buff-expiry",
      kind: "buff-expiry",
      label: "버프 종료",
      statusLabel: "감지 대기",
      secondsUntilAlert: null,
      tone: "waiting",
    };
  }

  if (buffExpiryState.status === "no-stream") {
    return {
      id: "buff-expiry",
      kind: "buff-expiry",
      label: "버프 종료",
      statusLabel: "화면 공유 필요",
      secondsUntilAlert: null,
      tone: "waiting",
    };
  }

  if (
    buffExpiryState.status === "unsupported" ||
    buffExpiryState.status === "unavailable"
  ) {
    return {
      id: "buff-expiry",
      kind: "buff-expiry",
      label: "버프 종료",
      statusLabel: "감지 대기",
      secondsUntilAlert: null,
      tone: "waiting",
    };
  }

  const activeTracks = buffExpiryState.tracks.filter((track) => track.alertedAt === null);
  const nextTrack = getNearestBuffExpiryTrack(activeTracks);
  if (nextTrack) {
    const alertLeadSeconds = getBuffExpiryEffectiveAlertLeadSeconds(buffExpiryConfig);
    const secondsUntilAlert = Math.max(
      0,
      Math.ceil(
        (nextTrack.expiresAt - alertLeadSeconds * 1000 - now) / 1000,
      ),
    );
    return {
      id: "buff-expiry",
      kind: "buff-expiry",
      label: "버프 종료",
      statusLabel:
        secondsUntilAlert === 0
          ? "곧 알림"
          : activeTracks.length > 1
            ? `${activeTracks.length}개 알림 대기`
            : "알림 대기",
      secondsUntilAlert,
      tone: secondsUntilAlert === 0 ? "alert" : "running",
    };
  }

  const latestAlertedAt = getLatestBuffExpiryAlertedAt(buffExpiryState);
  if (
    latestAlertedAt !== null &&
    now - latestAlertedAt >= 0 &&
    now - latestAlertedAt <= PIP_RECENT_ALERT_VISIBLE_MS
  ) {
    return {
      id: "buff-expiry",
      kind: "buff-expiry",
      label: "버프 종료",
      statusLabel: "알림 완료",
      secondsUntilAlert: 0,
      tone: "alert",
    };
  }

  if ((buffExpiryState.confirmationCandidateCount ?? 0) > 0) {
    return {
      id: "buff-expiry",
      kind: "buff-expiry",
      label: "버프 종료",
      statusLabel: "시간 확인 중",
      secondsUntilAlert: null,
      tone: "waiting",
    };
  }

  return {
    id: "buff-expiry",
    kind: "buff-expiry",
    label: "버프 종료",
    statusLabel: "감지 대기",
    secondsUntilAlert: null,
    tone: "waiting",
  };
}

function getSpecialCoreTimerItem({
  specialCoreConfig,
  specialCoreState,
  now,
}: {
  specialCoreConfig?: SpecialCoreAlertConfig | null;
  specialCoreState?: SpecialCoreRuntimeState | null;
  now: number;
}): PipTimerItem {
  const base = {
    id: "special-core",
    kind: "special-core" as const,
    label: "특수코어",
  };

  if (!specialCoreConfig?.enabled) {
    return {
      ...base,
      statusLabel: "특수 코어 알림 꺼짐",
      secondsUntilAlert: null,
      tone: "paused",
    };
  }

  if (!specialCoreState) {
    return {
      ...base,
      statusLabel: "감지 대기",
      secondsUntilAlert: null,
      tone: "waiting",
    };
  }

  if (specialCoreState.status === "needs-stream") {
    return {
      ...base,
      statusLabel: "화면 공유 필요",
      secondsUntilAlert: null,
      tone: "waiting",
    };
  }

  if (specialCoreState.status === "loading") {
    return {
      ...base,
      statusLabel: "감지 준비 중",
      secondsUntilAlert: null,
      tone: "waiting",
    };
  }

  if (specialCoreState.status === "confirming") {
    return {
      ...base,
      statusLabel: "확인 중",
      secondsUntilAlert: null,
      tone: "waiting",
    };
  }

  if (specialCoreState.cooldownEndsAt !== null) {
    const remainingMs = specialCoreState.cooldownEndsAt - now;
    const isReady = remainingMs <= 0;
    const remainingSeconds = isReady
      ? 0
      : getSpecialCoreRemainingSecondsForDisplay({
        cooldownEndsAt: specialCoreState.cooldownEndsAt,
        now,
      }) ?? 0;
    const isUrgent = remainingSeconds <= specialCoreConfig.alertLeadSeconds;
    return {
      ...base,
      statusLabel:
        isReady ? "사용 가능" : isUrgent ? "곧 사용 가능" : "쿨타임",
      secondsUntilAlert: remainingSeconds,
      tone: isUrgent ? "alert" : "running",
      isUrgent,
    };
  }

  return {
    ...base,
    statusLabel:
      specialCoreState.status === "unavailable" ? "감지 대기" : "감지 대기",
    secondsUntilAlert: null,
    tone: "waiting",
  };
}

function getNearestBuffExpiryTrack(
  tracks: BuffExpiryTrackedBuff[],
): BuffExpiryTrackedBuff | null {
  return [...tracks].sort((a, b) => a.expiresAt - b.expiresAt)[0] ?? null;
}

function getLatestBuffExpiryAlertedAt(state: BuffExpiryRuntimeState): number | null {
  return [
    state.lastAlertedAt,
    ...state.tracks.map((track) => track.alertedAt),
  ].reduce<number | null>((latest, alertedAt) => {
    if (alertedAt === null) {
      return latest;
    }
    return latest === null ? alertedAt : Math.max(latest, alertedAt);
  }, null);
}

function comparePipItems(a: PipTimerItem, b: PipTimerItem): number {
  const toneRank: Record<PipTimerItemTone, number> = {
    alert: 0,
    running: 1,
    waiting: 2,
    paused: 3,
  };
  const rankDelta = toneRank[a.tone] - toneRank[b.tone];
  if (rankDelta !== 0) {
    return rankDelta;
  }

  if (a.secondsUntilAlert !== null && b.secondsUntilAlert !== null) {
    return a.secondsUntilAlert - b.secondsUntilAlert;
  }
  if (a.secondsUntilAlert !== null) {
    return -1;
  }
  if (b.secondsUntilAlert !== null) {
    return 1;
  }
  return a.label.localeCompare(b.label, "ko");
}

function getHuntStallTimerItem({
  huntStallConfig,
  huntStallState,
}: {
  huntStallConfig?: HuntStallAlertConfig | null;
  huntStallState?: HuntStallRuntimeState | null;
}): PipTimerItem | null {
  if (!huntStallConfig?.enabled || !huntStallState) {
    return null;
  }

  if (huntStallState.status !== "alerted" && huntStallState.status !== "stalled") {
    return null;
  }

  return {
    id: "hunt-stall",
    kind: "hunt-stall",
    label: "사냥 멈춤",
    statusLabel: HUNT_STALL_STATUS_LABELS[huntStallState.status],
    secondsUntilAlert: 0,
    tone: "alert",
  };
}

function getPipHuntStallInfo({
  huntStallConfig,
  huntStallState,
  now,
}: {
  huntStallConfig?: HuntStallAlertConfig | null;
  huntStallState?: HuntStallRuntimeState | null;
  now: number;
}): PipHuntStallInfo | null {
  if (!huntStallConfig?.enabled || !huntStallState) {
    return null;
  }

  if (huntStallConfig.mode === "cooldown-presence") {
    return getPipCooldownHuntStallInfo({
      huntStallConfig,
      huntStallState,
      now,
    });
  }

  if (huntStallConfig.mode === "manual-experience") {
    return getPipManualExperienceHuntStallInfo({
      huntStallConfig,
      huntStallState,
    });
  }

  return null;
}

function getPipManualExperienceHuntStallInfo({
  huntStallConfig,
  huntStallState,
}: {
  huntStallConfig: HuntStallAlertConfig;
  huntStallState: HuntStallRuntimeState;
}): PipHuntStallInfo {
  const thresholdSeconds = clampHuntStallThresholdSeconds(
    huntStallConfig.stallThresholdSeconds,
  );
  const unchangedSeconds = Math.max(0, huntStallState.unchangedSeconds);
  const statusLabel = HUNT_STALL_STATUS_LABELS[huntStallState.status];
  const isInactive =
    huntStallState.status === "no-stream" ||
    huntStallState.status === "paused" ||
    huntStallState.status === "unavailable" ||
    huntStallState.status === "no-region";
  const progressPercent =
    huntStallState.status === "alerted" || huntStallState.status === "stalled"
      ? 100
      : Math.max(0, Math.min(100, (unchangedSeconds / thresholdSeconds) * 100));
  const primaryLabel = huntStallState.hasObservedExperienceChange
    ? "변화 없음"
    : "변화 대기";
  const secondaryLabel =
    huntStallState.status === "no-region"
      ? "영역 필요"
      : huntStallState.status === "no-stream"
        ? "공유 필요"
        : `${unchangedSeconds}초`;

  return {
    mode: "manual-experience",
    badgeLabel: "EXP",
    primaryLabel,
    secondaryLabel,
    progressPercent,
    statusLabel,
    isStale: isInactive,
    ariaLabel: `수동 경험치 인식 ${primaryLabel} ${secondaryLabel}`,
  };
}

function getPipCooldownHuntStallInfo({
  huntStallConfig,
  huntStallState,
  now,
}: {
  huntStallConfig: HuntStallAlertConfig;
  huntStallState: HuntStallRuntimeState;
  now: number;
}): PipHuntStallInfo {
  const thresholdSeconds = Math.max(
    1,
    Math.min(60, huntStallConfig.cooldownMissingThresholdSeconds),
  );
  const unchangedSeconds = Math.max(0, huntStallState.unchangedSeconds);
  const statusLabel = HUNT_STALL_STATUS_LABELS[huntStallState.status];
  const isInactive =
    huntStallState.status === "no-stream" ||
    huntStallState.status === "paused" ||
    huntStallState.status === "unavailable" ||
    huntStallState.status === "no-region";
  const progressPercent =
    huntStallState.status === "alerted" || huntStallState.status === "stalled"
      ? 100
      : Math.max(0, Math.min(100, (unchangedSeconds / thresholdSeconds) * 100));
  const cooldownValue = normalizeCooldownText(huntStallState.recognizedText);
  const primaryLabel = cooldownValue ? `숫자 ${cooldownValue}` : "숫자 대기";
  const secondaryLabel = getCooldownHuntStallSecondaryLabel({
    state: huntStallState,
    thresholdSeconds,
    unchangedSeconds,
    now,
  });

  return {
    mode: "cooldown-presence",
    badgeLabel: "쿨타임",
    primaryLabel,
    secondaryLabel,
    progressPercent,
    statusLabel,
    isStale: isInactive,
    ariaLabel: `쿨타임 인식 ${primaryLabel} ${secondaryLabel}`,
  };
}

function clampHuntStallThresholdSeconds(value: number): number {
  return Math.max(5, Math.min(120, value));
}

function getCooldownHuntStallSecondaryLabel({
  state,
  thresholdSeconds,
  unchangedSeconds,
  now,
}: {
  state: HuntStallRuntimeState;
  thresholdSeconds: number;
  unchangedSeconds: number;
  now: number;
}): string {
  if (state.status === "alerted") {
    const alertedAt = state.alertedAt ?? now;
    const elapsedSeconds = Math.max(0, Math.floor((now - alertedAt) / 1000));
    return `알림 후 ${elapsedSeconds}초`;
  }

  if (state.status === "stalled") {
    return `${unchangedSeconds}초 변화 없음`;
  }

  if (state.status === "active") {
    return unchangedSeconds > 0
      ? `변화 없음 ${unchangedSeconds}초`
      : "쿨타임 변화 감시";
  }

  if (state.status === "watching") {
    return "쿨타임 시작 대기";
  }

  if (state.status === "detecting") {
    return "쿨타임 숫자 확인 중";
  }

  if (state.status === "no-region") {
    return "영역 선택 필요";
  }

  if (state.status === "no-stream") {
    return "화면 공유 필요";
  }

  if (state.status === "paused") {
    return "꺼짐";
  }

  return `기준 ${thresholdSeconds}초`;
}

function normalizeCooldownText(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  return trimmed && /^\d{1,3}$/.test(trimmed) ? trimmed : null;
}

export function getPipTimerDisplay({
  skills,
  states,
  runeConfig,
  runeState,
  generalTimers = [],
  huntStallConfig,
  huntStallState,
  buffExpiryConfig,
  buffExpiryState,
  visibleItems = DEFAULT_PIP_VISIBLE_ITEMS,
  now,
}: {
  skills: SkillConfig[];
  states: Record<string, SkillRuntimeState>;
  runeConfig: RuneAlertConfig | null;
  runeState: RuneRuntimeState;
  generalTimers?: GeneralTimerConfig[];
  huntStallConfig?: HuntStallAlertConfig | null;
  huntStallState?: HuntStallRuntimeState | null;
  buffExpiryConfig?: BuffExpiryAlertConfig | null;
  buffExpiryState?: BuffExpiryRuntimeState | null;
  visibleItems?: PipTimerVisibleItems;
  now: number;
}): PipTimerDisplay {
  const skillItems = visibleItems.skills
    ? skills.map((skill) => getSkillTimerItem(skill, states[skill.id], now))
    : [];
  const runeItems = visibleItems.rune && runeConfig
    ? [getRuneTimerItem(runeConfig, runeState)]
    : [];
  const generalTimerItems = visibleItems.generalTimers
    ? generalTimers.map((timer) => getGeneralTimerItem(timer, now))
    : [];
  const buffExpiryItem = visibleItems.buffExpiry
    ? getBuffExpiryTimerItem({ buffExpiryConfig, buffExpiryState, now })
    : null;
  const huntStallItem = visibleItems.experience
    ? getHuntStallTimerItem({ huntStallConfig, huntStallState })
    : null;
  const items = [
    ...skillItems,
    ...runeItems,
    ...generalTimerItems,
    ...(buffExpiryItem ? [buffExpiryItem] : []),
    ...(huntStallItem ? [huntStallItem] : []),
  ];
  const sortedItems = items.sort(comparePipItems);

  return {
    main: sortedItems.find((item) => item.tone !== "paused") ?? sortedItems[0] ?? null,
    items: sortedItems,
    huntStall: visibleItems.experience
      ? getPipHuntStallInfo({ huntStallConfig, huntStallState, now })
      : null,
  };
}

export function getSpecialCorePipTimerDisplay({
  specialCoreConfig,
  specialCoreState,
  now,
}: {
  specialCoreConfig?: SpecialCoreAlertConfig | null;
  specialCoreState?: SpecialCoreRuntimeState | null;
  now: number;
}): PipTimerDisplay {
  const item = getSpecialCoreTimerItem({
    specialCoreConfig,
    specialCoreState,
    now,
  });

  return {
    main: item,
    items: [item],
    huntStall: null,
  };
}
