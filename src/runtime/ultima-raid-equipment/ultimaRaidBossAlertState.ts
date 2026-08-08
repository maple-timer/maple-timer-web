import type { UltimaRaidBossDetection } from "../../recognition/ultima-raid-equipment/bossEncounterDetector";

export const ULTIMA_RAID_BOSS_EVIDENCE_WINDOW_SIZE = 3;
export const ULTIMA_RAID_BOSS_REQUIRED_SIGNALS = 2;
export const ULTIMA_RAID_BOSS_REQUIRED_NORMAL_FRAMES = 3;

export type UltimaRaidBossRuntimeStatus =
  | "paused"
  | "no-stream"
  | "no-region"
  | "invalid-region"
  | "initializing"
  | "waiting"
  | "candidate"
  | "active"
  | "unavailable";

export type UltimaRaidBossRuntimeState = {
  status: UltimaRaidBossRuntimeStatus;
  recentBossDetections: boolean[];
  consecutiveNormalFrames: number;
  armed: boolean;
  encounterActive: boolean;
  lastDetectedAt: number | null;
  lastAlertedAt: number | null;
  lastPlaybackAt: number | null;
  lastError: string | null;
};

export type UltimaRaidBossStateUpdate = {
  state: UltimaRaidBossRuntimeState;
  shouldAlert: boolean;
};

export function createUltimaRaidBossRuntimeState(
  status: UltimaRaidBossRuntimeStatus = "initializing",
): UltimaRaidBossRuntimeState {
  return {
    status,
    recentBossDetections: [],
    consecutiveNormalFrames: 0,
    armed: false,
    encounterActive: false,
    lastDetectedAt: null,
    lastAlertedAt: null,
    lastPlaybackAt: null,
    lastError: null,
  };
}

export function updateUltimaRaidBossRuntimeState({
  previous,
  detection,
  now,
  enabled,
  hasStream,
  hasRegion,
}: {
  previous: UltimaRaidBossRuntimeState;
  detection: UltimaRaidBossDetection | null;
  now: number;
  enabled: boolean;
  hasStream: boolean;
  hasRegion: boolean;
}): UltimaRaidBossStateUpdate {
  if (!enabled || !hasStream || !hasRegion) {
    const status: UltimaRaidBossRuntimeStatus = !enabled
      ? "paused"
      : !hasStream
        ? "no-stream"
        : "no-region";
    return {
      state: {
        ...createUltimaRaidBossRuntimeState(status),
        lastAlertedAt: previous.lastAlertedAt,
        lastPlaybackAt: previous.lastPlaybackAt,
      },
      shouldAlert: false,
    };
  }

  if (!detection) {
    return {
      state: {
        ...previous,
        status: previous.encounterActive
          ? "active"
          : previous.armed
            ? "waiting"
            : "initializing",
        recentBossDetections: [],
        consecutiveNormalFrames: 0,
        lastError: null,
      },
      shouldAlert: false,
    };
  }

  if (!detection.layoutValid) {
    return {
      state: {
        ...createUltimaRaidBossRuntimeState("invalid-region"),
        lastAlertedAt: previous.lastAlertedAt,
        lastPlaybackAt: previous.lastPlaybackAt,
      },
      shouldAlert: false,
    };
  }

  if (detection.progressState === "normal") {
    const consecutiveNormalFrames = previous.consecutiveNormalFrames + 1;
    const rearmed =
      !previous.encounterActive ||
      consecutiveNormalFrames >= ULTIMA_RAID_BOSS_REQUIRED_NORMAL_FRAMES;

    return {
      state: {
        ...previous,
        status: rearmed ? "waiting" : "active",
        recentBossDetections: [],
        consecutiveNormalFrames,
        armed: rearmed || previous.armed,
        encounterActive: rearmed ? false : previous.encounterActive,
        lastError: null,
      },
      shouldAlert: false,
    };
  }

  if (detection.progressState === "unreadable") {
    const recentBossDetections = appendEvidence(
      previous.recentBossDetections,
      false,
    );
    return {
      state: {
        ...previous,
        status: previous.encounterActive
          ? "active"
          : countPositiveEvidence(recentBossDetections) > 0
            ? "candidate"
            : previous.armed
              ? "waiting"
              : "initializing",
        recentBossDetections,
        consecutiveNormalFrames: 0,
        lastError: null,
      },
      shouldAlert: false,
    };
  }

  const recentBossDetections = appendEvidence(
    previous.recentBossDetections,
    true,
  );
  const confirmedBoss =
    countPositiveEvidence(recentBossDetections) >=
    ULTIMA_RAID_BOSS_REQUIRED_SIGNALS;
  const shouldAlert = !previous.encounterActive && confirmedBoss;
  const encounterActive = previous.encounterActive || shouldAlert;

  return {
    state: {
      ...previous,
      status: encounterActive ? "active" : "candidate",
      recentBossDetections,
      consecutiveNormalFrames: 0,
      armed: previous.armed || shouldAlert,
      encounterActive,
      lastDetectedAt: now,
      lastAlertedAt: shouldAlert ? now : previous.lastAlertedAt,
      lastError: null,
    },
    shouldAlert,
  };
}

export function markUltimaRaidBossRuntimeUnavailable(
  previous: UltimaRaidBossRuntimeState,
  error: string,
): UltimaRaidBossRuntimeState {
  return {
    ...previous,
    status: "unavailable",
    recentBossDetections: [],
    consecutiveNormalFrames: 0,
    lastError: error,
  };
}

export function releaseUltimaRaidBossAlertAfterPlaybackFailure(
  previous: UltimaRaidBossRuntimeState,
  alertedAt: number,
  error: string,
): UltimaRaidBossRuntimeState {
  if (previous.lastAlertedAt !== alertedAt) {
    return previous;
  }

  return {
    ...previous,
    status: "waiting",
    recentBossDetections: [],
    armed: true,
    encounterActive: false,
    lastError: error,
  };
}

export function markUltimaRaidBossPlaybackFinished(
  previous: UltimaRaidBossRuntimeState,
  finishedAt: number,
): UltimaRaidBossRuntimeState {
  return {
    ...previous,
    lastPlaybackAt: Math.max(previous.lastPlaybackAt ?? 0, finishedAt),
    lastError: null,
  };
}

function appendEvidence(previous: boolean[], value: boolean): boolean[] {
  return [...previous, value].slice(-ULTIMA_RAID_BOSS_EVIDENCE_WINDOW_SIZE);
}

function countPositiveEvidence(evidence: boolean[]): number {
  return evidence.reduce((count, value) => count + (value ? 1 : 0), 0);
}
