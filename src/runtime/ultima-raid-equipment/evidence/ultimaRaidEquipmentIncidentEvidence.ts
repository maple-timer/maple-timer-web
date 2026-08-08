import type {
  UltimaRaidBagCountState,
  UltimaRaidInventoryFullDetectionSource,
} from "../../../recognition/ultima-raid-equipment/inventoryFullDetector";
import type {
  UltimaRaidBossProgressState,
} from "../../../recognition/ultima-raid-equipment/bossEncounterDetector";
import type {
  AlertIssueOccurrence,
  AlertIssueScenario,
} from "../../../contracts/reporting/alertIssueScenario";
import type {
  UltimaRaidEquipmentRuntimeState,
  UltimaRaidEquipmentRuntimeStatus,
} from "../ultimaRaidEquipmentAlertState";
import type {
  UltimaRaidBossRuntimeState,
  UltimaRaidBossRuntimeStatus,
} from "../ultimaRaidBossAlertState";

export const ULTIMA_RAID_EQUIPMENT_INCIDENT_EVIDENCE_SCHEMA_VERSION =
  "ultima-raid-equipment-incident-evidence-v2" as const;
export const ULTIMA_RAID_EQUIPMENT_INCIDENT_SELECTION_POLICY =
  "ultima-raid-equipment-scenario-selection-v3" as const;
export const ULTIMA_RAID_EQUIPMENT_INCIDENT_RETENTION_MS = 60_000;
export const ULTIMA_RAID_EQUIPMENT_INCIDENT_CURRENT_WINDOW_MS = 10_000;
export const ULTIMA_RAID_EQUIPMENT_INCIDENT_MAX_FRAMES = 72;
export const ULTIMA_RAID_EQUIPMENT_INCIDENT_MAX_MEDIA = 4;
export const ULTIMA_RAID_EQUIPMENT_INCIDENT_PERIODIC_MEDIA_MS = 20_000;
export const ULTIMA_RAID_EQUIPMENT_INCIDENT_MEDIA_MAX_FRAME_CHARS = 220_000;
export const ULTIMA_RAID_EQUIPMENT_INCIDENT_MEDIA_MAX_TOTAL_CHARS = 600_000;

export type UltimaRaidEquipmentIncidentMediaReason =
  | "periodic"
  | "signal-start"
  | "alert"
  | "after-event"
  | "rearmed"
  | "report-open-latest-runtime";

export type UltimaRaidAlertTarget = "equipment" | "boss";

export type UltimaRaidBossIncidentStateSnapshot = {
  status: UltimaRaidBossRuntimeStatus;
  recentBossDetections: boolean[];
  consecutiveNormalFrames: number;
  armed: boolean;
  encounterActive: boolean;
  lastDetectedAt: number | null;
  lastAlertedAt: number | null;
  lastPlaybackAt?: number | null;
  lastError: string | null;
};

export type UltimaRaidEquipmentIncidentStateSnapshot = {
  status: UltimaRaidEquipmentRuntimeStatus;
  recentBagDetections: boolean[];
  recentBannerDetections: boolean[];
  consecutiveBagAbsentFrames: number;
  alertedForCurrentPresence: boolean;
  confidence: number;
  bagCountState?: UltimaRaidBagCountState;
  bagCountOccluded?: boolean;
  bagWarmPixelRatio: number;
  fullBannerDetected: boolean;
  detectionSource: UltimaRaidInventoryFullDetectionSource;
  lastDetectedAt: number | null;
  lastAlertedAt: number | null;
  lastPlaybackAt?: number | null;
  lastError: string | null;
  boss?: UltimaRaidBossIncidentStateSnapshot;
};

export type UltimaRaidEquipmentIncidentFrame = {
  id: string;
  sequence: number;
  sampledAt: number;
  detectorVersion: string;
  layoutKey: string | null;
  sourceDimensions: { width: number; height: number };
  sampledRegion: { x: number; y: number; width: number; height: number };
  layoutValid: boolean;
  detected: boolean;
  confidence: number;
  detectionSource: UltimaRaidInventoryFullDetectionSource;
  bagCountState?: UltimaRaidBagCountState;
  bagCountReadable?: boolean;
  bagCountOccluded?: boolean;
  bagFullDetected: boolean;
  bagWarmPixelCount: number;
  bagForegroundPixelCount: number;
  bagReadablePixelCount?: number;
  bagWarmPixelRatio: number;
  largestBagWarmClusterSize: number;
  largestBagWarmClusterWidth?: number;
  largestBagWarmClusterHeight?: number;
  largestBagWarmClusterXRatio?: number;
  largestBagWarmClusterYRatio?: number;
  bagWarmComponentValid?: boolean;
  bagWarmComponentTouchesBoundary?: boolean;
  bagCountRowTopRatio?: number;
  bagCountRowHeightRatio?: number;
  fullBannerDetected: boolean;
  largestBannerClusterSize: number;
  bannerWidthRatio: number;
  bannerHeightRatio: number;
  bannerFillRatio: number;
  shouldAlert: boolean;
  bossDetectorVersion?: string;
  bossProgressState?: UltimaRaidBossProgressState;
  bossBarDetected?: boolean;
  normalProgressBarDetected?: boolean;
  bossBarPixelCount?: number;
  bossBarWidthRatio?: number;
  bossBarHeightRatio?: number;
  bossBarFillRatio?: number;
  normalProgressBarPixelCount?: number;
  normalProgressBarWidthRatio?: number;
  bossShouldAlert?: boolean;
  rearmed: boolean;
  bossRearmed?: boolean;
  stateBefore: UltimaRaidEquipmentIncidentStateSnapshot;
  stateAfter: UltimaRaidEquipmentIncidentStateSnapshot;
  mediaId: string | null;
};

export type UltimaRaidEquipmentIncidentMedia = {
  id: string;
  frameId: string;
  sampledAt: number;
  reason: UltimaRaidEquipmentIncidentMediaReason;
  dataUrl: string;
};

export type UltimaRaidEquipmentIncidentPlaybackAttempt = {
  id: string;
  sequence: number;
  frameId: string | null;
  requestedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  failedAt: number | null;
  status: "requested" | "started" | "finished" | "failed";
  target?: UltimaRaidAlertTarget;
  kind?: "initial" | "repeat";
  cycleId?: number;
  repeatIndex?: number | null;
  repeatMaxCount?: number | null;
  repeatIntervalSeconds?: number | null;
  error: string | null;
  soundId: string;
  featureVolume: number;
  masterVolume: number;
  effectiveVolume: number;
};

export type UltimaRaidEquipmentIncidentArchive = {
  updatedAt: number;
  nextFrameSequence: number;
  nextPlaybackSequence: number;
  latestMediaAt: number | null;
  pendingAfterEvent: boolean;
  frames: UltimaRaidEquipmentIncidentFrame[];
  media: UltimaRaidEquipmentIncidentMedia[];
  playbackAttempts: UltimaRaidEquipmentIncidentPlaybackAttempt[];
  droppedMediaCount: number;
};

export type FrozenUltimaRaidEquipmentIncidentEvidence = {
  schemaVersion: typeof ULTIMA_RAID_EQUIPMENT_INCIDENT_EVIDENCE_SCHEMA_VERSION;
  frozenAt: number;
  archive: UltimaRaidEquipmentIncidentArchive;
};

export type UltimaRaidEquipmentIncidentSelection = {
  policy: typeof ULTIMA_RAID_EQUIPMENT_INCIDENT_SELECTION_POLICY;
  support: "full" | "partial" | "unsupported";
  occurrence: AlertIssueOccurrence;
  scenario: AlertIssueScenario;
  target?: UltimaRaidAlertTarget;
  selectedEventAt: number | null;
  selectedFrameId: string | null;
  frameIds: string[];
  mediaIds: string[];
  playbackAttemptIds: string[];
  degradationReasons: string[];
};

export type UltimaRaidEquipmentIncidentReportEvidence = {
  schemaVersion: typeof ULTIMA_RAID_EQUIPMENT_INCIDENT_EVIDENCE_SCHEMA_VERSION;
  frozenAt: number;
  selection: UltimaRaidEquipmentIncidentSelection;
  frames: UltimaRaidEquipmentIncidentFrame[];
  media: UltimaRaidEquipmentIncidentMedia[];
  playbackAttempts: UltimaRaidEquipmentIncidentPlaybackAttempt[];
  budget: {
    retentionMs: number;
    maxFrames: number;
    maxMedia: number;
    mediaChars: number;
    droppedMediaCount: number;
  };
};

export function createUltimaRaidEquipmentIncidentArchive(
  now = Date.now(),
): UltimaRaidEquipmentIncidentArchive {
  return {
    updatedAt: now,
    nextFrameSequence: 1,
    nextPlaybackSequence: 1,
    latestMediaAt: null,
    pendingAfterEvent: false,
    frames: [],
    media: [],
    playbackAttempts: [],
    droppedMediaCount: 0,
  };
}

export function getUltimaRaidEquipmentIncidentMediaReason({
  archive,
  sampledAt,
  stateBefore,
  stateAfter,
  detected,
  shouldAlert,
  bossDetected = false,
  bossShouldAlert = false,
}: {
  archive: UltimaRaidEquipmentIncidentArchive;
  sampledAt: number;
  stateBefore: UltimaRaidEquipmentRuntimeState;
  stateAfter: UltimaRaidEquipmentRuntimeState;
  detected: boolean;
  shouldAlert: boolean;
  bossDetected?: boolean;
  bossShouldAlert?: boolean;
}): UltimaRaidEquipmentIncidentMediaReason | null {
  if (shouldAlert || bossShouldAlert) {
    return "alert";
  }
  if (archive.pendingAfterEvent) {
    return "after-event";
  }
  if (
    stateBefore.alertedForCurrentPresence &&
    !stateAfter.alertedForCurrentPresence
  ) {
    return "rearmed";
  }
  if (stateBefore.boss.encounterActive && !stateAfter.boss.encounterActive) {
    return "rearmed";
  }
  if (
    detected &&
    stateBefore.recentBagDetections.every((value) => !value) &&
    stateBefore.recentBannerDetections.every((value) => !value)
  ) {
    return "signal-start";
  }
  if (
    bossDetected &&
    stateBefore.boss.recentBossDetections.every((value) => !value)
  ) {
    return "signal-start";
  }
  if (
    archive.latestMediaAt === null ||
    sampledAt - archive.latestMediaAt >=
      ULTIMA_RAID_EQUIPMENT_INCIDENT_PERIODIC_MEDIA_MS
  ) {
    return "periodic";
  }
  return null;
}

export function recordUltimaRaidEquipmentIncidentFrame({
  previous,
  sampledAt,
  detectorVersion,
  layoutKey,
  sourceDimensions,
  sampledRegion,
  detection,
  bossDetection = EMPTY_BOSS_DETECTION,
  shouldAlert,
  bossShouldAlert = false,
  stateBefore,
  stateAfter,
  mediaDataUrl = null,
  mediaReason = null,
}: {
  previous: UltimaRaidEquipmentIncidentArchive;
  sampledAt: number;
  detectorVersion: string;
  layoutKey: string | null;
  sourceDimensions: { width: number; height: number };
  sampledRegion: { x: number; y: number; width: number; height: number };
  detection: {
    layoutValid: boolean;
    detected: boolean;
    confidence: number;
    source: UltimaRaidInventoryFullDetectionSource;
    bagCountState?: UltimaRaidBagCountState;
    bagCountReadable?: boolean;
    bagCountOccluded?: boolean;
    bagFullDetected: boolean;
    bagWarmPixelCount: number;
    bagForegroundPixelCount: number;
    bagReadablePixelCount?: number;
    bagWarmPixelRatio: number;
    largestBagWarmClusterSize: number;
    largestBagWarmClusterWidth?: number;
    largestBagWarmClusterHeight?: number;
    largestBagWarmClusterXRatio?: number;
    largestBagWarmClusterYRatio?: number;
    bagWarmComponentValid?: boolean;
    bagWarmComponentTouchesBoundary?: boolean;
    bagCountRowTopRatio?: number;
    bagCountRowHeightRatio?: number;
    fullBannerDetected: boolean;
    largestBannerClusterSize: number;
    bannerWidthRatio: number;
    bannerHeightRatio: number;
    bannerFillRatio: number;
  };
  bossDetection?: {
    detectorVersion: string;
    progressState: UltimaRaidBossProgressState;
    bossBarDetected: boolean;
    normalBarDetected: boolean;
    bossBarPixelCount: number;
    bossBarWidthRatio: number;
    bossBarHeightRatio: number;
    bossBarFillRatio: number;
    normalBarPixelCount: number;
    normalBarWidthRatio: number;
  };
  shouldAlert: boolean;
  bossShouldAlert?: boolean;
  stateBefore: UltimaRaidEquipmentRuntimeState;
  stateAfter: UltimaRaidEquipmentRuntimeState;
  mediaDataUrl?: string | null;
  mediaReason?: UltimaRaidEquipmentIncidentMediaReason | null;
}): UltimaRaidEquipmentIncidentArchive {
  const sequence = previous.nextFrameSequence;
  const frameId = `ultima-raid-equipment-frame:${sequence}`;
  const acceptedMedia =
    mediaReason &&
    typeof mediaDataUrl === "string" &&
    mediaDataUrl.startsWith("data:image/") &&
    mediaDataUrl.length <= ULTIMA_RAID_EQUIPMENT_INCIDENT_MEDIA_MAX_FRAME_CHARS
      ? {
          id: `ultima-raid-equipment-media:${sequence}`,
          frameId,
          sampledAt,
          reason: mediaReason,
          dataUrl: mediaDataUrl,
        }
      : null;
  const rearmed =
    stateBefore.alertedForCurrentPresence &&
    !stateAfter.alertedForCurrentPresence;
  const bossRearmed =
    stateBefore.boss.encounterActive &&
    !stateAfter.boss.encounterActive;
  const frame: UltimaRaidEquipmentIncidentFrame = {
    id: frameId,
    sequence,
    sampledAt,
    detectorVersion,
    layoutKey,
    sourceDimensions: { ...sourceDimensions },
    sampledRegion: { ...sampledRegion },
    layoutValid: detection.layoutValid,
    detected: detection.detected,
    confidence: detection.confidence,
    detectionSource: detection.source,
    bagCountState: detection.bagCountState,
    bagCountReadable: detection.bagCountReadable,
    bagCountOccluded: detection.bagCountOccluded,
    bagFullDetected: detection.bagFullDetected,
    bagWarmPixelCount: detection.bagWarmPixelCount,
    bagForegroundPixelCount: detection.bagForegroundPixelCount,
    bagReadablePixelCount: detection.bagReadablePixelCount,
    bagWarmPixelRatio: detection.bagWarmPixelRatio,
    largestBagWarmClusterSize: detection.largestBagWarmClusterSize,
    largestBagWarmClusterWidth: detection.largestBagWarmClusterWidth,
    largestBagWarmClusterHeight: detection.largestBagWarmClusterHeight,
    largestBagWarmClusterXRatio: detection.largestBagWarmClusterXRatio,
    largestBagWarmClusterYRatio: detection.largestBagWarmClusterYRatio,
    bagWarmComponentValid: detection.bagWarmComponentValid,
    bagWarmComponentTouchesBoundary:
      detection.bagWarmComponentTouchesBoundary,
    bagCountRowTopRatio: detection.bagCountRowTopRatio,
    bagCountRowHeightRatio: detection.bagCountRowHeightRatio,
    fullBannerDetected: detection.fullBannerDetected,
    largestBannerClusterSize: detection.largestBannerClusterSize,
    bannerWidthRatio: detection.bannerWidthRatio,
    bannerHeightRatio: detection.bannerHeightRatio,
    bannerFillRatio: detection.bannerFillRatio,
    shouldAlert,
    bossDetectorVersion: bossDetection.detectorVersion,
    bossProgressState: bossDetection.progressState,
    bossBarDetected: bossDetection.bossBarDetected,
    normalProgressBarDetected: bossDetection.normalBarDetected,
    bossBarPixelCount: bossDetection.bossBarPixelCount,
    bossBarWidthRatio: bossDetection.bossBarWidthRatio,
    bossBarHeightRatio: bossDetection.bossBarHeightRatio,
    bossBarFillRatio: bossDetection.bossBarFillRatio,
    normalProgressBarPixelCount: bossDetection.normalBarPixelCount,
    normalProgressBarWidthRatio: bossDetection.normalBarWidthRatio,
    bossShouldAlert,
    rearmed,
    bossRearmed,
    stateBefore: snapshotState(stateBefore),
    stateAfter: snapshotState(stateAfter),
    mediaId: acceptedMedia?.id ?? null,
  };
  const next = compactArchive(
    {
      ...previous,
      updatedAt: sampledAt,
      nextFrameSequence: sequence + 1,
      latestMediaAt: acceptedMedia ? sampledAt : previous.latestMediaAt,
      pendingAfterEvent:
        mediaReason === "after-event"
          ? false
          : Boolean(
              shouldAlert ||
                bossShouldAlert ||
                rearmed ||
                bossRearmed ||
                mediaReason === "signal-start",
            ),
      frames: [...previous.frames, frame],
      media: acceptedMedia
        ? [...previous.media, acceptedMedia]
        : previous.media,
      droppedMediaCount:
        previous.droppedMediaCount +
        (mediaReason && mediaDataUrl && !acceptedMedia ? 1 : 0),
    },
    sampledAt,
  );
  return reconcileFrameMedia(next);
}

const EMPTY_BOSS_DETECTION = {
  detectorVersion: "unrecorded",
  progressState: "unreadable",
  bossBarDetected: false,
  normalBarDetected: false,
  bossBarPixelCount: 0,
  bossBarWidthRatio: 0,
  bossBarHeightRatio: 0,
  bossBarFillRatio: 0,
  normalBarPixelCount: 0,
  normalBarWidthRatio: 0,
} as const;

export function addUltimaRaidEquipmentReportOpenMedia({
  previous,
  capturedAt,
  frameSampledAt,
  dataUrl,
}: {
  previous: UltimaRaidEquipmentIncidentArchive;
  capturedAt: number;
  frameSampledAt: number;
  dataUrl: string | null;
}): UltimaRaidEquipmentIncidentArchive {
  if (
    !dataUrl?.startsWith("data:image/") ||
    dataUrl.length > ULTIMA_RAID_EQUIPMENT_INCIDENT_MEDIA_MAX_FRAME_CHARS
  ) {
    return previous;
  }
  const frame =
    [...previous.frames]
      .reverse()
      .find((entry) => entry.sampledAt <= frameSampledAt) ??
    previous.frames[previous.frames.length - 1] ??
    null;
  if (!frame) {
    return previous;
  }
  if (
    previous.media.some(
      (entry) =>
        entry.frameId === frame.id &&
        entry.reason === "report-open-latest-runtime",
    )
  ) {
    return previous;
  }
  const media: UltimaRaidEquipmentIncidentMedia = {
    id: `ultima-raid-equipment-report-open:${frame.sequence}`,
    frameId: frame.id,
    sampledAt: frame.sampledAt,
    reason: "report-open-latest-runtime",
    dataUrl,
  };
  return reconcileFrameMedia(
    compactArchive(
      {
        ...previous,
        updatedAt: Math.max(previous.updatedAt, capturedAt),
        latestMediaAt: Math.max(previous.latestMediaAt ?? 0, frame.sampledAt),
        media: [...previous.media, media],
      },
      capturedAt,
    ),
  );
}

export function recordUltimaRaidEquipmentPlaybackRequested({
  previous,
  frameId,
  requestedAt,
  soundId,
  featureVolume,
  masterVolume,
  effectiveVolume,
  target = "equipment",
  kind = "initial",
  cycleId = requestedAt,
  repeatIndex = null,
  repeatMaxCount = null,
  repeatIntervalSeconds = null,
}: {
  previous: UltimaRaidEquipmentIncidentArchive;
  frameId: string | null;
  requestedAt: number;
  soundId: string;
  featureVolume: number;
  masterVolume: number;
  effectiveVolume: number;
  target?: UltimaRaidAlertTarget;
  kind?: "initial" | "repeat";
  cycleId?: number;
  repeatIndex?: number | null;
  repeatMaxCount?: number | null;
  repeatIntervalSeconds?: number | null;
}): {
  archive: UltimaRaidEquipmentIncidentArchive;
  playbackId: string;
} {
  const sequence = previous.nextPlaybackSequence;
  const playbackId = `ultima-raid-equipment-playback:${sequence}`;
  return {
    archive: compactArchive(
      {
        ...previous,
        updatedAt: requestedAt,
        nextPlaybackSequence: sequence + 1,
        playbackAttempts: [
          ...previous.playbackAttempts,
          {
            id: playbackId,
            sequence,
            frameId,
            requestedAt,
            startedAt: null,
            finishedAt: null,
            failedAt: null,
            status: "requested",
            target,
            kind,
            cycleId,
            repeatIndex,
            repeatMaxCount,
            repeatIntervalSeconds,
            error: null,
            soundId,
            featureVolume,
            masterVolume,
            effectiveVolume,
          },
        ],
      },
      requestedAt,
    ),
    playbackId,
  };
}

export function recordUltimaRaidEquipmentPlaybackTransition({
  previous,
  playbackId,
  status,
  occurredAt,
  error = null,
}: {
  previous: UltimaRaidEquipmentIncidentArchive;
  playbackId: string;
  status: "started" | "finished" | "failed";
  occurredAt: number;
  error?: string | null;
}): UltimaRaidEquipmentIncidentArchive {
  return compactArchive(
    {
      ...previous,
      updatedAt: occurredAt,
      playbackAttempts: previous.playbackAttempts.map((entry) =>
        entry.id !== playbackId
          ? entry
          : {
              ...entry,
              status,
              startedAt:
                status === "started" ? occurredAt : entry.startedAt,
              finishedAt:
                status === "finished" ? occurredAt : entry.finishedAt,
              failedAt: status === "failed" ? occurredAt : entry.failedAt,
              error: status === "failed" ? error : entry.error,
            },
      ),
    },
    occurredAt,
  );
}

export function freezeUltimaRaidEquipmentIncidentEvidence({
  archive,
  frozenAt,
}: {
  archive: UltimaRaidEquipmentIncidentArchive;
  frozenAt: number;
}): FrozenUltimaRaidEquipmentIncidentEvidence {
  return cloneJson({
    schemaVersion:
      ULTIMA_RAID_EQUIPMENT_INCIDENT_EVIDENCE_SCHEMA_VERSION,
    frozenAt,
    archive: compactArchive(archive, frozenAt),
  });
}

export function createUltimaRaidEquipmentIncidentReportEvidence({
  frozen,
  occurrence,
  scenario,
  target = "equipment",
}: {
  frozen: FrozenUltimaRaidEquipmentIncidentEvidence;
  occurrence: AlertIssueOccurrence;
  scenario: AlertIssueScenario;
  target?: UltimaRaidAlertTarget;
}): UltimaRaidEquipmentIncidentReportEvidence {
  const cutoff =
    occurrence === "current"
      ? frozen.frozenAt - ULTIMA_RAID_EQUIPMENT_INCIDENT_CURRENT_WINDOW_MS
      : frozen.frozenAt - ULTIMA_RAID_EQUIPMENT_INCIDENT_RETENTION_MS;
  const frames =
    occurrence === "historical"
      ? []
      : frozen.archive.frames.filter(
          (entry) =>
            entry.sampledAt >= cutoff && entry.sampledAt <= frozen.frozenAt,
        );
  const playbackAttempts =
    occurrence === "historical"
      ? []
      : frozen.archive.playbackAttempts.filter(
          (entry) =>
            (entry.target ?? "equipment") === target &&
            getPlaybackEventAt(entry) >= cutoff &&
            getPlaybackEventAt(entry) <= frozen.frozenAt,
        );
  const anchor = selectAnchorFrame(
    frames,
    playbackAttempts,
    scenario,
    target,
  );
  const media =
    occurrence === "historical"
      ? []
      : frozen.archive.media.filter(
          (entry) =>
            entry.sampledAt >= cutoff && entry.sampledAt <= frozen.frozenAt,
        );
  const support =
    frames.length > 0 && media.length > 0
      ? "full"
      : frames.length > 0
        ? "partial"
        : "unsupported";
  const degradationReasons = [
    ...(occurrence === "historical" ? ["outside-retention"] : []),
    ...(frames.length === 0 && occurrence !== "historical"
      ? ["no-runtime-frames"]
      : []),
    ...(frames.length > 0 && media.length === 0 ? ["no-runtime-media"] : []),
    ...(frozen.archive.droppedMediaCount > 0 ? ["media-budget"] : []),
  ];

  return {
    schemaVersion:
      ULTIMA_RAID_EQUIPMENT_INCIDENT_EVIDENCE_SCHEMA_VERSION,
    frozenAt: frozen.frozenAt,
    selection: {
      policy: ULTIMA_RAID_EQUIPMENT_INCIDENT_SELECTION_POLICY,
      support,
      occurrence,
      scenario,
      target,
      selectedEventAt:
        anchor?.sampledAt ??
        (playbackAttempts.length > 0
          ? getPlaybackEventAt(playbackAttempts[playbackAttempts.length - 1])
          : null),
      selectedFrameId: anchor?.id ?? null,
      frameIds: frames.map((entry) => entry.id),
      mediaIds: media.map((entry) => entry.id),
      playbackAttemptIds: playbackAttempts.map((entry) => entry.id),
      degradationReasons,
    },
    frames,
    media,
    playbackAttempts,
    budget: {
      retentionMs: ULTIMA_RAID_EQUIPMENT_INCIDENT_RETENTION_MS,
      maxFrames: ULTIMA_RAID_EQUIPMENT_INCIDENT_MAX_FRAMES,
      maxMedia: ULTIMA_RAID_EQUIPMENT_INCIDENT_MAX_MEDIA,
      mediaChars: media.reduce(
        (total, entry) => total + entry.dataUrl.length,
        0,
      ),
      droppedMediaCount: frozen.archive.droppedMediaCount,
    },
  };
}

function compactArchive(
  archive: UltimaRaidEquipmentIncidentArchive,
  now: number,
): UltimaRaidEquipmentIncidentArchive {
  const cutoff = now - ULTIMA_RAID_EQUIPMENT_INCIDENT_RETENTION_MS;
  const frames = archive.frames
    .filter((entry) => entry.sampledAt >= cutoff && entry.sampledAt <= now)
    .slice(-ULTIMA_RAID_EQUIPMENT_INCIDENT_MAX_FRAMES);
  const frameIds = new Set(frames.map((entry) => entry.id));
  const mediaCandidates = archive.media.filter(
    (entry) =>
      frameIds.has(entry.frameId) &&
      entry.sampledAt >= cutoff &&
      entry.sampledAt <= now,
  );
  const selectedMedia = selectRetainedMedia(mediaCandidates);
  const droppedByBudget = Math.max(
    0,
    mediaCandidates.length - selectedMedia.length,
  );
  const playbackAttempts = archive.playbackAttempts
    .filter(
      (entry) =>
        getPlaybackEventAt(entry) >= cutoff &&
        getPlaybackEventAt(entry) <= now,
    )
    .slice(-12);
  return {
    ...archive,
    updatedAt: now,
    frames,
    media: selectedMedia,
    playbackAttempts,
    droppedMediaCount: archive.droppedMediaCount + droppedByBudget,
    latestMediaAt:
      selectedMedia[selectedMedia.length - 1]?.sampledAt ?? null,
  };
}

function selectRetainedMedia(
  candidates: UltimaRaidEquipmentIncidentMedia[],
): UltimaRaidEquipmentIncidentMedia[] {
  const sorted = [...candidates].sort(
    (left, right) =>
      left.sampledAt - right.sampledAt || left.id.localeCompare(right.id),
  );
  if (sorted.length <= ULTIMA_RAID_EQUIPMENT_INCIDENT_MAX_MEDIA) {
    return enforceMediaCharBudget(sorted);
  }
  const eventAnchor =
    findLatestMediaByReasons(sorted, ["alert"]) ??
    findLatestMediaByReasons(sorted, ["signal-start", "rearmed"]) ??
    sorted[sorted.length - 1];
  const selected = new Map<string, UltimaRaidEquipmentIncidentMedia>();
  addMedia(selected, eventAnchor);
  addMedia(
    selected,
    [...sorted]
      .reverse()
      .find((entry) => entry.sampledAt < eventAnchor.sampledAt),
  );
  addMedia(
    selected,
    sorted.find((entry) => entry.sampledAt > eventAnchor.sampledAt),
  );
  addMedia(selected, sorted[sorted.length - 1]);
  for (const entry of [...sorted].reverse()) {
    if (selected.size >= ULTIMA_RAID_EQUIPMENT_INCIDENT_MAX_MEDIA) {
      break;
    }
    addMedia(selected, entry);
  }
  return enforceMediaCharBudget(
    [...selected.values()].sort(
      (left, right) =>
        left.sampledAt - right.sampledAt || left.id.localeCompare(right.id),
    ),
  );
}

function enforceMediaCharBudget(
  entries: UltimaRaidEquipmentIncidentMedia[],
): UltimaRaidEquipmentIncidentMedia[] {
  const retained: UltimaRaidEquipmentIncidentMedia[] = [];
  let total = 0;
  for (const entry of [...entries].reverse()) {
    if (
      retained.length >= ULTIMA_RAID_EQUIPMENT_INCIDENT_MAX_MEDIA ||
      total + entry.dataUrl.length >
        ULTIMA_RAID_EQUIPMENT_INCIDENT_MEDIA_MAX_TOTAL_CHARS
    ) {
      continue;
    }
    retained.push(entry);
    total += entry.dataUrl.length;
  }
  return retained.reverse();
}

function reconcileFrameMedia(
  archive: UltimaRaidEquipmentIncidentArchive,
): UltimaRaidEquipmentIncidentArchive {
  const mediaIds = new Set(archive.media.map((entry) => entry.id));
  return {
    ...archive,
    frames: archive.frames.map((entry) => ({
      ...entry,
      mediaId:
        entry.mediaId && mediaIds.has(entry.mediaId) ? entry.mediaId : null,
    })),
  };
}

function selectAnchorFrame(
  frames: UltimaRaidEquipmentIncidentFrame[],
  playbackAttempts: UltimaRaidEquipmentIncidentPlaybackAttempt[],
  scenario: AlertIssueScenario,
  target: UltimaRaidAlertTarget,
): UltimaRaidEquipmentIncidentFrame | null {
  if (frames.length === 0) {
    return null;
  }
  if (scenario === "repeat-missing") {
    let rearmedIndex = -1;
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      if (isFrameRearmed(frames[index], target)) {
        rearmedIndex = index;
        break;
      }
    }
    if (rearmedIndex >= 0) {
      return (
        [...frames.slice(rearmedIndex + 1)]
          .reverse()
          .find(
            (entry) =>
              isFrameDetected(entry, target) &&
              !isFrameAlertRequested(entry, target),
          ) ??
        frames[rearmedIndex]
      );
    }
  }
  if (
    scenario === "playback-missing" ||
    scenario === "unexpected-playback" ||
    scenario === "duplicate-alert" ||
    scenario === "repeat-timing" ||
    scenario === "repeat-missing"
  ) {
    const playback =
      (scenario === "repeat-timing"
        ? [...playbackAttempts]
            .reverse()
            .find(
              (entry) =>
                (entry.target ?? "equipment") === target &&
                entry.kind === "repeat",
            )
        : null) ??
      [...playbackAttempts]
        .reverse()
        .find((entry) => (entry.target ?? "equipment") === target) ??
      playbackAttempts[playbackAttempts.length - 1];
    const playbackFrame = playback?.frameId
      ? frames.find((entry) => entry.id === playback.frameId)
      : null;
    return (
      playbackFrame ??
      [...frames]
        .reverse()
        .find((entry) => isFrameAlertRequested(entry, target)) ??
      frames[frames.length - 1]
    );
  }
  if (scenario === "not-recognized") {
    return (
      [...frames]
        .reverse()
        .find(
          (entry) =>
            isFrameDetected(entry, target) &&
            !isFrameAlertRequested(entry, target),
        ) ?? frames[frames.length - 1]
    );
  }
  if (scenario === "recognized-no-alert") {
    return (
      [...frames]
        .reverse()
        .find(
          (entry) =>
            (isFrameDetected(entry, target) ||
              getFrameStatus(entry, target) === "candidate" ||
              getFrameStatus(entry, target) === "alerted" ||
              getFrameStatus(entry, target) === "active") &&
            !isFrameAlertRequested(entry, target),
        ) ?? frames[frames.length - 1]
    );
  }
  if (scenario === "wrong-target") {
    const reversedFrames = [...frames].reverse();
    return (
      reversedFrames.find((entry) =>
        isFrameAlertRequested(entry, target),
      ) ??
      reversedFrames.find((entry) => isFrameDetected(entry, target)) ??
      frames[frames.length - 1]
    );
  }
  return frames[frames.length - 1];
}

function snapshotState(
  state: UltimaRaidEquipmentRuntimeState,
): UltimaRaidEquipmentIncidentStateSnapshot {
  return {
    status: state.status,
    recentBagDetections: [...state.recentBagDetections],
    recentBannerDetections: [...state.recentBannerDetections],
    consecutiveBagAbsentFrames: state.consecutiveBagAbsentFrames,
    alertedForCurrentPresence: state.alertedForCurrentPresence,
    confidence: state.confidence,
    bagCountState: state.bagCountState,
    bagCountOccluded: state.bagCountOccluded,
    bagWarmPixelRatio: state.bagWarmPixelRatio,
    fullBannerDetected: state.fullBannerDetected,
    detectionSource: state.detectionSource,
    lastDetectedAt: state.lastDetectedAt,
    lastAlertedAt: state.lastAlertedAt,
    lastPlaybackAt: state.lastPlaybackAt,
    lastError: state.lastError,
    boss: snapshotBossState(state.boss),
  };
}

function snapshotBossState(
  state: UltimaRaidBossRuntimeState,
): UltimaRaidBossIncidentStateSnapshot {
  return {
    status: state.status,
    recentBossDetections: [...state.recentBossDetections],
    consecutiveNormalFrames: state.consecutiveNormalFrames,
    armed: state.armed,
    encounterActive: state.encounterActive,
    lastDetectedAt: state.lastDetectedAt,
    lastAlertedAt: state.lastAlertedAt,
    lastPlaybackAt: state.lastPlaybackAt,
    lastError: state.lastError,
  };
}

function isFrameDetected(
  frame: UltimaRaidEquipmentIncidentFrame,
  target: UltimaRaidAlertTarget,
): boolean {
  return target === "boss"
    ? frame.bossBarDetected === true
    : frame.detected;
}

function isFrameAlertRequested(
  frame: UltimaRaidEquipmentIncidentFrame,
  target: UltimaRaidAlertTarget,
): boolean {
  return target === "boss"
    ? frame.bossShouldAlert === true
    : frame.shouldAlert;
}

function isFrameRearmed(
  frame: UltimaRaidEquipmentIncidentFrame | undefined,
  target: UltimaRaidAlertTarget,
): boolean {
  if (!frame) {
    return false;
  }
  return target === "boss" ? frame.bossRearmed === true : frame.rearmed;
}

function getFrameStatus(
  frame: UltimaRaidEquipmentIncidentFrame,
  target: UltimaRaidAlertTarget,
): string {
  return target === "boss"
    ? frame.stateAfter.boss?.status ?? "unknown"
    : frame.stateAfter.status;
}

function getPlaybackEventAt(
  entry: UltimaRaidEquipmentIncidentPlaybackAttempt,
): number {
  return (
    entry.failedAt ??
    entry.finishedAt ??
    entry.startedAt ??
    entry.requestedAt
  );
}

function findLatestMediaByReasons(
  entries: UltimaRaidEquipmentIncidentMedia[],
  reasons: UltimaRaidEquipmentIncidentMediaReason[],
): UltimaRaidEquipmentIncidentMedia | null {
  return (
    [...entries].reverse().find((entry) => reasons.includes(entry.reason)) ??
    null
  );
}

function addMedia(
  target: Map<string, UltimaRaidEquipmentIncidentMedia>,
  entry: UltimaRaidEquipmentIncidentMedia | undefined,
) {
  if (entry) {
    target.set(entry.id, entry);
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
