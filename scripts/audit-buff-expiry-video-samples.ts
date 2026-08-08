import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import {
  BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID,
  BUFF_EXPIRY_BUFF_CATALOG,
  BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
  BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
  getBuffExpiryCatalogItem,
  getBuffExpiryReferenceIdsForSelection,
  getBuffExpiryTrackingId,
  isSmallPotionBuffExpiryReference,
  SUPPORTED_BUFF_EXPIRY_BUFF_IDS,
} from "../src/lib/buffExpiry/buffExpiryCatalog";
import { getBuffExpiryCaptureRoi, getBuffExpiryFrameCalibration } from "../src/lib/buffExpiry/buffExpiryCalibration";
import {
  markDueBuffExpiryTracksAlerted,
  reconcileBuffExpiryTracks,
  selectBuffExpiryRuntimeMatches,
} from "../src/lib/buffExpiryLegacy/buffExpiryLegacyRuntime";
import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryBox,
  BuffExpiryExpiryCluster,
  BuffExpiryTrackedBuff,
  BuffExpiryPendingTrack,
  BuffExpiryTemporalCandidateMatch,
  BuffExpiryTopMatch,
} from "../src/lib/buffExpiry/buffExpiryTypes";

type Manifest = {
  id?: string;
  title?: string;
  frameCount: number;
  testPurpose?: string;
  expectedBuffGroups?: ManifestExpectedBuffGroup[];
  expectedBehavior?: Record<string, string> | string;
  sourceWidth?: number;
  sourceHeight?: number;
  captureRoi?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  frames: Array<{
    index: number;
    second: number;
    file: string;
    width: number;
    height: number;
  }>;
  videos?: Array<{
    id: string;
    title: string;
    frameDir: string;
    testPurpose?: string;
    expectedBuffGroups?: ManifestExpectedBuffGroup[];
  }>;
};

type ManifestExpectedBuffGroup = {
  id: string;
  label?: string;
  expectation?: string;
};

type ImageDataLike = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

type CountdownSample = {
  id: string;
  buffId: string;
  name: string;
  kind: string;
  seconds: number;
  file: string;
  normalizedFile?: string;
  atlas: { x: number; y: number; width: number; height: number };
  normalizedIcon: ImageDataLike;
};

type RankedCountdownItem = {
  box: Record<string, unknown>;
  normalizedIcon: ImageDataLike;
  countdownMatch: CountdownSample | null;
  countdownCandidate: CountdownSample | null;
  countdownStatus: {
    accepted: boolean;
    secondsAccepted: boolean;
    reason: string;
    score: number;
    buffMargin: number;
    secondMargin: number;
    minAcceptedScore: number;
    minAcceptedBuffMargin: number;
    minAcceptedSecondMargin: number;
  };
  countdownTopMatches: BuffExpiryTopMatch[];
};

type BodyIdentityPrototype = {
  trackingId: string;
  sourceBuffId: string;
  normalizedIcon: ImageDataLike;
};

type BodyIdentityMatch = {
  trackingId: string;
  sourceBuffId: string;
  score: number;
  margin: number;
  accepted: boolean;
};

type BodyIdentityMatches = Map<string, BodyIdentityMatch>;

type ExcludedIdentitySample = {
  id: string;
  label: string;
  atlas: { x: number; y: number; width: number; height: number };
};

type ExcludedIdentityPrototype = {
  id: string;
  label: string;
  normalizedIcon: ImageDataLike;
};

type ExcludedIdentityMatch = {
  id: string;
  label: string;
  score: number;
  margin: number;
  supportedMargin: number;
  blocked: boolean;
};

type FrameDetection = {
  second: number;
  boxes: BuffExpiryBox[];
  acceptedMatches: BuffExpiryAcceptedMatch[];
  temporalCandidateMatches: BuffExpiryTemporalCandidateMatch[];
  acceptedEvents: Array<{
    match: BuffExpiryAcceptedMatch;
    normalizedIcon: ImageDataLike;
  }>;
  unsupportedReason: string | null;
};

type VideoAuditReport = {
  id: string;
  title: string;
  frameDir: string;
  testPurpose: string | null;
  expectedBuffGroups: ManifestExpectedBuffGroup[];
  expectedBehavior: Record<string, string> | string | null;
  expectation: VideoAuditExpectation;
  frameCount: number;
  unsupportedFrames: number;
  boxCountAverage: number;
  acceptedCounts: Record<string, number>;
  confirmations: Array<{
    second: number;
    buffId: string;
    label: string;
    detectedSeconds: number;
    expiresSecond: number;
    triggerIconFile: string | null;
  }>;
  alertEvents: Array<{
    second: number;
    tracks: Array<{
      buffId: string;
      label: string;
      remainingSeconds: number;
      expiresSecond: number;
      iconFile: string | null;
    }>;
  }>;
  statusTransitions: VideoAuditStatusTransition[];
  events: VideoAuditEvent[];
  finalTracks: BuffExpiryTrackedBuff[];
  finalPendingTracks: BuffExpiryPendingTrack[];
  finalTemporalCandidateTracks: BuffExpiryPendingTrack[];
  finalExpiryClusters: BuffExpiryExpiryCluster[];
};

type VideoAuditExpectation = {
  status: "pass" | "fail" | "skip";
  detail: string;
  selectedBuffIds: string[];
  expectedBuffIds: string[];
  missingAlertBuffIds: string[];
  unexpectedAlertBuffIds: string[];
};

type VideoAuditStatusTransition = {
  second: number;
  label: string;
  detail: string;
  className: string;
  trackCount: number;
  pendingTrackCount: number;
  temporalCandidateTrackCount: number;
  expiryClusterCount: number;
  confirmedExpiryClusterCount: number;
};

type VideoAuditEvent =
  | {
      kind: "recognized";
      second: number;
      buffId: string;
      label: string;
      detectedSeconds: number;
      expiresSecond: number;
      score: number;
      reason: string;
      strength: "strong" | "weak";
      iconFile: string | null;
    }
  | {
      kind: "confirmed";
      second: number;
      buffId: string;
      label: string;
      detectedSeconds: number;
      expiresSecond: number;
      triggerIconFile: string | null;
    }
  | {
      kind: "cluster-confirmed";
      second: number;
      clusterId: string;
      centerExpiresSecond: number;
      alertSecond: number;
      observationCount: number;
      inlierCount: number;
      distinctSlotCount: number;
      distinctBuffCount: number;
    }
  | {
      kind: "member-confirmed";
      second: number;
      clusterId: string;
      buffId: string;
      label: string;
      detectedSeconds: number;
      expiresSecond: number;
      triggerIconFile: string | null;
    }
  | {
      kind: "alerted";
      second: number;
      tracks: Array<{
        buffId: string;
        label: string;
        remainingSeconds: number;
        expiresSecond: number;
        iconFile: string | null;
      }>;
    };

const publicBuffExpiryDir = resolve("public/buff-expiry");
const outputDir = resolve(
  process.env.BUFF_EXPIRY_AUDIT_OUTPUT_DIR ??
    `output/buff-expiry-current-video-audit/${new Date().toISOString().replaceAll(":", "-")}`,
);
const alertLeadSeconds = Number(process.env.BUFF_EXPIRY_AUDIT_ALERT_LEAD_SECONDS ?? "15");
const auditSecondFrom = readOptionalNumberEnv("BUFF_EXPIRY_AUDIT_SECOND_FROM");
const auditSecondTo = readOptionalNumberEnv("BUFF_EXPIRY_AUDIT_SECOND_TO");

const POTION_RESCUE_MIN_SCORE = 0.94;
const POTION_RESCUE_MIN_SECOND_MARGIN = 0.004;
const WEAK_COUNTDOWN_MIN_SCORE = 0.92;
const WEAK_COUNTDOWN_MIN_BUFF_MARGIN = 0.01;
const WEAK_COUNTDOWN_MIN_TRACKING_MARGIN = 0.004;
const WEAK_COUNTDOWN_MIN_SECOND_MARGIN = 0.008;
const WEAK_COUNTDOWN_MIN_BODY_IDENTITY_SCORE = 0.915;
const WEAK_SMALL_POTION_MIN_SCORE = 0.92;
const COMPRESSED_SMALL_POTION_MIN_SCORE = 0.895;
const COMPRESSED_SMALL_POTION_MIN_BODY_IDENTITY_SCORE = 0.9;
const COMPRESSED_SMALL_POTION_MIN_SECOND_MARGIN = 0.008;
const GROUPED_COUNTDOWN_MIN_SCORE = 0.94;
const GROUPED_COUNTDOWN_MIN_TRACKING_MARGIN = 0.006;
const INITIAL_COUNTDOWN_STAGE1_TOP_BUFFS = 7;
const TEMPORAL_LOW_SCORE_MIN_SCORE = 0.88;
const TEMPORAL_LOW_SCORE_BASELINE_SCORE = 0.905;
const TEMPORAL_LOW_SCORE_RESCUE_MIN_BODY_MARGIN = 0.02;
const TEMPORAL_LOW_SCORE_RESCUE_MIN_SECOND_MARGIN = 0.004;
const TEMPORAL_LOW_SCORE_MIN_SECONDS = 31;
const TEMPORAL_LOW_SCORE_MAX_SECONDS = 59;
const TEMPORAL_COUNTDOWN_REASONS = new Set(["low-score", "low-buff-margin", "low-second-margin"]);
const COUPON_TEMPORAL_MIN_SCORE = 0.9;
const COUPON_TEMPORAL_MIN_SECOND_MARGIN = 0.006;
const COUPON_TEMPORAL_MIN_BODY_IDENTITY_SCORE = 0.915;
const COUPON_TEMPORAL_WEAK_IDENTITY_MIN_SCORE = 0.904;
const COUPON_TEMPORAL_WEAK_IDENTITY_MIN_COUNTDOWN_SCORE = 0.92;
const COUPON_TEMPORAL_WEAK_IDENTITY_MIN_SECOND_MARGIN = 0.012;
const BODY_IDENTITY_MIN_SCORE = 0.895;
const BODY_IDENTITY_MIN_MARGIN = 0.012;
const BODY_IDENTITY_STRONG_SCORE = 0.94;
const EXCLUDED_IDENTITY_MIN_SCORE = 0.912;
const EXCLUDED_IDENTITY_MIN_MARGIN = 0.02;
const EXCLUDED_IDENTITY_MIN_SUPPORTED_MARGIN = 0;
const EXCLUDED_IDENTITY_MIN_SUPPORTED_MARGIN_BY_ID: Record<string, number> = {
  vip_exp_buff: 0.025,
};
const EXCLUDED_IDENTITY_VIP_ID = "vip_exp_buff";
const EXCLUDED_IDENTITY_COOLDOWN_ID = "cooldown";
const EXCLUDED_IDENTITY_VIP_COOLDOWN_RESCUE_MIN_SCORE = 0.92;
const EXCLUDED_IDENTITY_VIP_COOLDOWN_RESCUE_MIN_SUPPORTED_MARGIN = 0.006;
const EXCLUDED_IDENTITY_VIP_COOLDOWN_RESCUE_MIN_COOLDOWN_SCORE = 0.914;
const TOP_EDGE_TIMER_TEXT_SCAN_ROWS = 12;
const TOP_EDGE_TIMER_TEXT_MIN_PIXELS = 8;
const RECOGNIZED_EVENT_MAX_GAP_SECONDS = 3;
const RECOGNIZED_EVENT_NEW_SEQUENCE_TOLERANCE_SECONDS = 4;

const detectorModule = await import(
  pathToFileURL(resolve("public/buff-expiry/external/src/detector/detect-buffs.js")).href
);
const normalizeModule = await import(
  pathToFileURL(resolve("public/buff-expiry/external/src/recognition/normalize.js")).href
);
const countdownModule = await import(
  pathToFileURL(resolve("public/buff-expiry/external/src/recognition/countdown-matcher.js")).href
);

const inputRoots = process.argv.slice(2);
if (!inputRoots.length) {
  throw new Error("Usage: npx tsx scripts/audit-buff-expiry-video-samples.ts <frame-dir-or-root> [...]");
}

const selectedBuffIds = readSelectedBuffIds();
const selectedReferenceIds = getBuffExpiryReferenceIdsForSelection(selectedBuffIds);
const selectedTrackingIds = new Set([...selectedReferenceIds].map((referenceId) => getBuffExpiryTrackingId(referenceId)));
const bodyIdentityReferenceIds = getBuffExpiryReferenceIdsForSelection([...SUPPORTED_BUFF_EXPIRY_BUFF_IDS]);
const bodyIdentityTrackingIds = new Set([...bodyIdentityReferenceIds].map((referenceId) => getBuffExpiryTrackingId(referenceId)));
const countdownSamples = loadCountdownSamples();
const matcher = countdownModule.prepareInitialCountdownMatcher(countdownSamples, {
  stage1TopBuffs: INITIAL_COUNTDOWN_STAGE1_TOP_BUFFS,
});
const bodyIdentityPrototypes = buildBodyIdentityPrototypes(countdownSamples);
const excludedIdentityPrototypes = loadExcludedIdentityPrototypes();

const videos = inputRoots.flatMap((inputRoot) => loadInputVideos(resolve(inputRoot)));
const reports = videos.map((video) => auditVideo(video));
const expectationFailures = reports.filter((report) => report.expectation.status === "fail");

mkdirSync(outputDir, { recursive: true });
writeFileSync(
  join(outputDir, "buff-expiry-current-video-audit.json"),
  `${JSON.stringify({ alertLeadSeconds, selectedBuffIds, videos: reports }, null, 2)}\n`,
);
writeFileSync(join(outputDir, "buff-expiry-current-video-audit.md"), makeMarkdownReport(reports));
writeFileSync(
  join(outputDir, "buff-expiry-video-events.json"),
  `${JSON.stringify({ alertLeadSeconds, selectedBuffIds, videos: reports.map(toEventReport) }, null, 2)}\n`,
);
writeFileSync(join(outputDir, "buff-expiry-video-events.md"), makeEventMarkdownReport(reports));

console.log(makeConsoleReport(reports));
if (expectationFailures.length) {
  console.log(`\nExpectation failures: ${expectationFailures.length}`);
  for (const report of expectationFailures) {
    console.log(`- ${report.id}: ${report.expectation.detail}`);
  }
  process.exitCode = 1;
}
console.log(`\nReport: ${join(outputDir, "buff-expiry-current-video-audit.md")}`);
console.log(`Events: ${join(outputDir, "buff-expiry-video-events.md")}`);
console.log(`JSON: ${join(outputDir, "buff-expiry-current-video-audit.json")}`);

function loadInputVideos(root: string): Array<{ id: string; title: string; frameDir: string }> {
  const manifestPath = join(root, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing manifest: ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  if (Array.isArray(manifest.videos)) {
    return manifest.videos.map((video) => ({
      id: video.id,
      title: video.title,
      frameDir: resolve(video.frameDir),
    }));
  }
  return [{
    id: manifest.id ?? basename(root),
    title: manifest.title ?? basename(root),
    frameDir: root,
  }];
}

function auditVideo(video: { id: string; title: string; frameDir: string }): VideoAuditReport {
  const manifest = JSON.parse(readFileSync(join(video.frameDir, "manifest.json"), "utf8")) as Manifest;
  const selectedFrames = manifest.frames.filter((frame) =>
    (auditSecondFrom === null || frame.second >= auditSecondFrom) &&
    (auditSecondTo === null || frame.second <= auditSecondTo)
  );
  const frames = selectedFrames.map((frame) => detectFrame(video.frameDir, frame, manifest));
  let tracks: BuffExpiryTrackedBuff[] = [];
  let pendingTracks: BuffExpiryPendingTrack[] = [];
  let temporalCandidateTracks: BuffExpiryPendingTrack[] = [];
  let expiryClusters: BuffExpiryExpiryCluster[] = [];
  const knownTrackIds = new Set<string>();
  const knownClusterIds = new Set<string>();
  const acceptedCounts = Object.fromEntries([...selectedTrackingIds].map((buffId) => [buffId, 0]));
  const confirmations: VideoAuditReport["confirmations"] = [];
  const alertEvents: VideoAuditReport["alertEvents"] = [];
  const statusTransitions: VideoAuditStatusTransition[] = [];
  const events: VideoAuditEvent[] = [];
  const recognizedSequences = new Map<string, { lastSecond: number; expiresSecond: number }>();
  const confirmedIconByTrackId = new Map<string, string>();
  let previousStatusKey: string | null = null;

  for (const frame of frames) {
    const now = frame.second * 1000;
    const trackingMatches = selectBuffExpiryRuntimeMatches({
      acceptedMatches: frame.acceptedMatches,
      hypothesisMatches: [],
      previousTracks: tracks,
      previousPendingTracks: pendingTracks,
      now,
    });
    for (const match of trackingMatches) {
      acceptedCounts[match.buffId] = (acceptedCounts[match.buffId] ?? 0) + 1;
      const expiresSecond = frame.second + match.seconds;
      const previous = recognizedSequences.get(match.buffId);
      if (
        !previous ||
        frame.second - previous.lastSecond > RECOGNIZED_EVENT_MAX_GAP_SECONDS ||
        Math.abs(expiresSecond - previous.expiresSecond) > RECOGNIZED_EVENT_NEW_SEQUENCE_TOLERANCE_SECONDS
      ) {
        const acceptedEvent = findAcceptedEventForMatch(frame.acceptedEvents, match);
        const iconFile = acceptedEvent
          ? writeRecognizedIcon(video.id, frame.second, match, acceptedEvent.normalizedIcon)
          : null;
        events.push({
          kind: "recognized",
          second: frame.second,
          buffId: match.buffId,
          label: getBuffLabel(match.buffId),
          detectedSeconds: match.seconds,
          expiresSecond,
          score: match.score,
          reason: match.reason,
          strength: match.strength,
          iconFile,
        });
      }
      recognizedSequences.set(match.buffId, { lastSecond: frame.second, expiresSecond });
    }
    const reconciled = reconcileBuffExpiryTracks({
      previousTracks: tracks,
      previousPendingTracks: pendingTracks,
      previousTemporalCandidateTracks: temporalCandidateTracks,
      previousExpiryClusters: expiryClusters,
      acceptedMatches: trackingMatches,
      temporalCandidateMatches: frame.temporalCandidateMatches,
      boxes: frame.boxes,
      now,
    });
    for (const cluster of reconciled.expiryClusters) {
      if (cluster.confirmedAt !== null && !knownClusterIds.has(cluster.id)) {
        knownClusterIds.add(cluster.id);
        const inliers = getAuditClusterInlierObservations(cluster);
        events.push({
          kind: "cluster-confirmed",
          second: frame.second,
          clusterId: cluster.id,
          centerExpiresSecond: Math.round(cluster.centerExpiresAt / 1000),
          alertSecond: Math.round((cluster.centerExpiresAt - alertLeadSeconds * 1000) / 1000),
          observationCount: cluster.observations.length,
          inlierCount: inliers.length,
          distinctSlotCount: new Set(inliers.map((observation) => observation.slotKey)).size,
          distinctBuffCount: new Set(inliers.map((observation) => observation.buffId)).size,
        });
      }
    }
    for (const track of reconciled.tracks) {
      if (!knownTrackIds.has(track.id)) {
        knownTrackIds.add(track.id);
        const matchedCluster = findAuditClusterForTrack(reconciled.expiryClusters, track);
        const triggerEvent = findTriggerAcceptedEvent(frame.acceptedEvents, track, now);
        const triggerIconFile = triggerEvent
          ? writeTriggerIcon(video.id, frame.second, track, triggerEvent.normalizedIcon)
          : null;
        if (triggerIconFile) {
          confirmedIconByTrackId.set(track.id, triggerIconFile);
        }
        confirmations.push({
          second: frame.second,
          buffId: track.buffId,
          label: getBuffLabel(track.buffId),
          detectedSeconds: track.detectedSeconds,
          expiresSecond: Math.round(track.expiresAt / 1000),
          triggerIconFile,
        });
        events.push({
          kind: "confirmed",
          second: frame.second,
          buffId: track.buffId,
          label: getBuffLabel(track.buffId),
          detectedSeconds: track.detectedSeconds,
          expiresSecond: Math.round(track.expiresAt / 1000),
          triggerIconFile,
        });
        if (matchedCluster) {
          events.push({
            kind: "member-confirmed",
            second: frame.second,
            clusterId: matchedCluster.id,
            buffId: track.buffId,
            label: getBuffLabel(track.buffId),
            detectedSeconds: track.detectedSeconds,
            expiresSecond: Math.round(track.expiresAt / 1000),
            triggerIconFile,
          });
        }
      }
    }
    const alertUpdate = markDueBuffExpiryTracksAlerted({
      tracks: reconciled.tracks,
      now,
      alertLeadSeconds,
    });
    if (alertUpdate.shouldAlert) {
      const alertedTracks = alertUpdate.tracks
        .filter((track) => track.alertedAt === now)
        .map((track) => ({
          buffId: track.buffId,
          label: getBuffLabel(track.buffId),
          remainingSeconds: Math.max(0, Math.ceil((track.expiresAt - now) / 1000)),
          expiresSecond: Math.round(track.expiresAt / 1000),
          iconFile: confirmedIconByTrackId.get(track.id) ?? null,
        }));
      alertEvents.push({
        second: frame.second,
        tracks: alertedTracks,
      });
      events.push({ kind: "alerted", second: frame.second, tracks: alertedTracks });
    }
    tracks = alertUpdate.tracks;
    pendingTracks = reconciled.pendingTracks;
    temporalCandidateTracks = reconciled.temporalCandidateTracks;
    expiryClusters = reconciled.expiryClusters;

    const statusTransition = getAuditStatusTransition({
      second: frame.second,
      boxCount: frame.boxes.length,
      tracks,
      pendingTracks,
      temporalCandidateTracks,
      expiryClusters,
    });
    const statusKey = statusTransition.label;
    if (statusKey !== previousStatusKey) {
      statusTransitions.push(statusTransition);
      previousStatusKey = statusKey;
    }
  }

  return {
    id: manifest.id ?? video.id,
    title: manifest.title ?? video.title,
    frameDir: video.frameDir,
    testPurpose: manifest.testPurpose ?? null,
    expectedBuffGroups: manifest.expectedBuffGroups ?? [],
    expectedBehavior: manifest.expectedBehavior ?? null,
    expectation: evaluateVideoExpectation({
      expectedBuffGroups: manifest.expectedBuffGroups ?? [],
      alertEvents,
    }),
    frameCount: frames.length,
    unsupportedFrames: frames.filter((frame) => frame.unsupportedReason).length,
    boxCountAverage: round(frames.reduce((sum, frame) => sum + frame.boxes.length, 0) / Math.max(1, frames.length)),
    acceptedCounts,
    confirmations,
    alertEvents,
    statusTransitions,
    events: events.sort((a, b) => a.second - b.second || getEventKindOrder(a.kind) - getEventKindOrder(b.kind)),
    finalTracks: tracks,
    finalPendingTracks: pendingTracks,
    finalTemporalCandidateTracks: temporalCandidateTracks,
    finalExpiryClusters: expiryClusters,
  };
}

function readOptionalNumberEnv(name: string): number | null {
  const value = process.env[name];
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readSelectedBuffIds(): string[] {
  const raw = process.env.BUFF_EXPIRY_AUDIT_SELECTED_BUFF_IDS;
  if (!raw) {
    return [...SUPPORTED_BUFF_EXPIRY_BUFF_IDS];
  }

  const normalized = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => getBuffExpiryTrackingId(value));
  const supportedIds = new Set<string>(SUPPORTED_BUFF_EXPIRY_BUFF_IDS);
  const selected = [...new Set(normalized)].filter((value) => supportedIds.has(value));
  if (!selected.length) {
    throw new Error(`No supported buff ids in BUFF_EXPIRY_AUDIT_SELECTED_BUFF_IDS=${raw}`);
  }
  return selected;
}

function evaluateVideoExpectation({
  expectedBuffGroups,
  alertEvents,
}: {
  expectedBuffGroups: ManifestExpectedBuffGroup[];
  alertEvents: VideoAuditReport["alertEvents"];
}): VideoAuditExpectation {
  const expectedBuffIds = [...new Set(expectedBuffGroups.map((group) => getBuffExpiryTrackingId(group.id)))];
  const base = {
    selectedBuffIds,
    expectedBuffIds,
    missingAlertBuffIds: [] as string[],
    unexpectedAlertBuffIds: [] as string[],
  };

  if (!expectedBuffIds.length) {
    return {
      ...base,
      status: "skip",
      detail: "기대값 없음",
    };
  }
  if (auditSecondFrom !== null || auditSecondTo !== null) {
    return {
      ...base,
      status: "skip",
      detail: "부분 구간 audit에서는 기대값 자동 판정 제외",
    };
  }
  if (selectedBuffIds.length !== 1) {
    return {
      ...base,
      status: "skip",
      detail: "단일 버프 선택 audit에서만 기대값 자동 판정",
    };
  }

  const selectedBuffId = getBuffExpiryTrackingId(selectedBuffIds[0]);
  const alertedBuffIds = new Set(
    alertEvents.flatMap((event) => event.tracks.map((track) => track.buffId)),
  );
  const expectedSelection = expectedBuffIds.includes(selectedBuffId);
  if (expectedSelection && !alertedBuffIds.has(selectedBuffId)) {
    return {
      ...base,
      status: "fail",
      missingAlertBuffIds: [selectedBuffId],
      detail: `기대 알림 누락: ${getBuffLabel(selectedBuffId)}`,
    };
  }
  if (!expectedSelection && alertEvents.length > 0) {
    const unexpectedAlertBuffIds = [...alertedBuffIds];
    return {
      ...base,
      status: "fail",
      unexpectedAlertBuffIds,
      detail: `기대하지 않은 알림: ${unexpectedAlertBuffIds.map(getBuffLabel).join(", ")}`,
    };
  }

  return {
    ...base,
    status: "pass",
    detail: expectedSelection
      ? `기대 알림 확인: ${getBuffLabel(selectedBuffId)}`
      : `무알림 확인: ${getBuffLabel(selectedBuffId)}`,
  };
}

function detectFrame(frameDir: string, frame: Manifest["frames"][number], manifest: Manifest): FrameDetection {
  const png = PNG.sync.read(readFileSync(resolveFramePath(frameDir, frame.file)));
  if (manifest.captureRoi && manifest.sourceWidth && manifest.sourceHeight) {
    const calibration = getBuffExpiryFrameCalibration(manifest.sourceWidth, manifest.sourceHeight);
    if (calibration.unsupportedReason) {
      return {
        second: frame.second,
        boxes: [],
        acceptedMatches: [],
        temporalCandidateMatches: [],
        acceptedEvents: [],
        unsupportedReason: calibration.unsupportedReason,
      };
    }
    const imageData = cropPng(png, { x: 0, y: 0, width: png.width, height: png.height });
    return detectImageData(frame.second, imageData, manifest.captureRoi, calibration.sideCandidates);
  }

  const { calibration, roi } = getBuffExpiryCaptureRoi(png.width, png.height);
  if (calibration.unsupportedReason) {
    return {
      second: frame.second,
      boxes: [],
      acceptedMatches: [],
      temporalCandidateMatches: [],
      acceptedEvents: [],
      unsupportedReason: calibration.unsupportedReason,
    };
  }
  const imageData = cropPng(png, roi);
  return detectImageData(frame.second, imageData, roi, calibration.sideCandidates);
}

function detectImageData(
  second: number,
  imageData: ImageDataLike,
  roi: { x: number; y: number },
  sideCandidates: number[],
): FrameDetection {
  const detection = detectorModule.detectBuffs(imageData, {
    detectorMode: "v3",
    fallbackSides: sideCandidates,
    forceFallbackSides: true,
    roiStartXRatio: 0,
    roiEndYRatio: 1,
  });
  const detectedItems = detection.boxes.map((box: Record<string, unknown>) => ({
    box,
    normalizedIcon: normalizeModule.normalizeDetectedBuffCrop(imageData, box).normalizedIcon,
  }));
  const ranked = countdownModule.rankInitialCountdownMatches(detectedItems, matcher, { topN: 10 }) as RankedCountdownItem[];
  const rankedMatches = ranked.map((item) => {
    const bodyIdentities = resolveBodyIdentityMatches(item.normalizedIcon, bodyIdentityPrototypes);
    const excludedIdentity = resolveExcludedIdentityMatch(item.normalizedIcon, bodyIdentities);
    return {
      item,
      acceptedReference: excludedIdentity.blocked
        ? null
        : resolveIdentityBackedAcceptedCountdownReference(item, bodyIdentities) ??
          resolveAcceptedCountdownReference(item),
      bodyIdentities,
      excludedIdentity,
    };
  });
  const acceptedEvents = dedupeAcceptedEventsByTrackingId(rankedMatches
    .filter(({ acceptedReference, bodyIdentities, excludedIdentity }) => {
      if (excludedIdentity.blocked || !acceptedReference || !selectedReferenceIds.has(acceptedReference.reference.buffId)) {
        return false;
      }
      return isAcceptedReferenceBodyIdentityEligible(acceptedReference, bodyIdentities);
    })
    .map(({ item, acceptedReference }) =>
      ({
        match: serializeAcceptedMatch(
          item,
          roi,
          acceptedReference?.reference ?? null,
          acceptedReference?.reason,
          acceptedReference?.strength,
        ),
        normalizedIcon: item.normalizedIcon,
      }),
    ));
  const temporalCandidateMatches = dedupeTemporalCandidateMatches(rankedMatches
    .flatMap(({ item, acceptedReference, bodyIdentities, excludedIdentity }) => {
      if (excludedIdentity.blocked) {
        return [];
      }
      const temporalCandidateReference = resolveTemporalCandidateReference(
        item,
        acceptedReference,
        bodyIdentities,
      );
      if (!temporalCandidateReference) {
        return [];
      }
      return [serializeTemporalCandidateMatch(item, roi, temporalCandidateReference)];
    }));

  return {
    second,
    boxes: detection.boxes.map((box: Record<string, unknown>) => serializeBox(box, roi)),
    acceptedMatches: acceptedEvents.map((event) => event.match),
    temporalCandidateMatches,
    acceptedEvents,
    unsupportedReason: detection.unsupportedReason ?? null,
  };
}

function resolveFramePath(frameDir: string, frameFile: string): string {
  const directPath = join(frameDir, frameFile);
  if (existsSync(directPath)) {
    return directPath;
  }

  const basenamePath = join(frameDir, basename(frameFile));
  if (existsSync(basenamePath)) {
    return basenamePath;
  }

  const rootRelativePath = resolve(frameFile);
  if (existsSync(rootRelativePath)) {
    return rootRelativePath;
  }

  return directPath;
}

function resolveAcceptedCountdownReference(item: RankedCountdownItem): {
  reference: CountdownSample;
  reason: string;
  strength: "strong" | "weak";
} | null {
  if (hasTopEdgeTimerTextSignal(item.normalizedIcon)) {
    return null;
  }

  if (item.countdownMatch && item.countdownStatus.accepted && item.countdownStatus.secondsAccepted) {
    return { reference: item.countdownMatch, reason: item.countdownStatus.reason, strength: "strong" };
  }
  if (isPotionRescueAccepted(item) && item.countdownCandidate) {
    return { reference: item.countdownCandidate, reason: "potion-rescue", strength: "strong" };
  }
  if (isGroupedCountdownAccepted(item) && item.countdownCandidate) {
    return { reference: item.countdownCandidate, reason: "grouped-countdown", strength: "strong" };
  }
  if (isWeakCountdownCandidate(item) && item.countdownCandidate) {
    return { reference: item.countdownCandidate, reason: "weak-countdown", strength: "weak" };
  }
  return null;
}

function resolveIdentityBackedAcceptedCountdownReference(
  item: RankedCountdownItem,
  bodyIdentities: BodyIdentityMatches,
): {
  reference: CountdownSample;
  reason: string;
  strength: "strong" | "weak";
} | null {
  if (hasTopEdgeTimerTextSignal(item.normalizedIcon)) {
    return null;
  }

  const candidate = item.countdownCandidate;
  if (
    !candidate ||
    !Number.isFinite(candidate.seconds)
  ) {
    return null;
  }
  if (
    candidate.seconds < TEMPORAL_LOW_SCORE_MIN_SECONDS ||
    candidate.seconds > TEMPORAL_LOW_SCORE_MAX_SECONDS
  ) {
    return null;
  }

  const status = item.countdownStatus;
  const smallPotionIdentity = findConfidentSelectedSmallPotionIdentity(bodyIdentities);
  if (!smallPotionIdentity) {
    return null;
  }

  if (
    !selectedReferenceIds.has(candidate.buffId) ||
    !isSmallPotionBuffExpiryReference(candidate.buffId)
  ) {
    if (!isWeakCountdownCandidate(item)) {
      return null;
    }
    return {
      reference: makeSmallPotionReferenceFromCountdown(candidate, smallPotionIdentity.sourceBuffId),
      reason: "small-potion-identity-countdown",
      strength: "weak",
    };
  }

  if (
    !TEMPORAL_COUNTDOWN_REASONS.has(status.reason) ||
    status.score < COMPRESSED_SMALL_POTION_MIN_SCORE ||
    status.secondMargin < COMPRESSED_SMALL_POTION_MIN_SECOND_MARGIN
  ) {
    return null;
  }

  return {
    reference: candidate,
    reason: "small-potion-compressed-countdown",
    strength: "weak",
  };
}

function findConfidentSelectedSmallPotionIdentity(bodyIdentities: BodyIdentityMatches): BodyIdentityMatch | null {
  const selectedSmallPotionReferenceIds = [...selectedReferenceIds].filter(isSmallPotionBuffExpiryReference);
  if (!selectedSmallPotionReferenceIds.length) {
    return null;
  }

  const identity = bodyIdentities.get(BUFF_EXPIRY_SMALL_POTION_GROUP_ID);
  if (
    !identity ||
    !selectedSmallPotionReferenceIds.includes(identity.sourceBuffId) ||
    !isBodyIdentityConfident(bodyIdentities, BUFF_EXPIRY_SMALL_POTION_GROUP_ID) ||
    identity.score < COMPRESSED_SMALL_POTION_MIN_BODY_IDENTITY_SCORE
  ) {
    return null;
  }
  return identity;
}

function makeSmallPotionReferenceFromCountdown(reference: CountdownSample, sourceBuffId: string): CountdownSample {
  return {
    ...reference,
    id: `${sourceBuffId}:${reference.seconds}:identity-countdown`,
    buffId: sourceBuffId,
    name: getBuffExpiryCatalogItem(BUFF_EXPIRY_SMALL_POTION_GROUP_ID)?.label ?? reference.name,
  };
}

function isPotionRescueAccepted(item: RankedCountdownItem): boolean {
  const candidate = item.countdownCandidate;
  const status = item.countdownStatus;
  return (
    candidate !== null &&
    isSmallPotionBuffExpiryReference(candidate.buffId) &&
    status.score >= POTION_RESCUE_MIN_SCORE &&
    status.secondMargin >= POTION_RESCUE_MIN_SECOND_MARGIN
  );
}

function isWeakCountdownCandidate(item: RankedCountdownItem): boolean {
  const candidate = item.countdownCandidate;
  const status = item.countdownStatus;
  const trackingMargin = getTrackingGroupMargin(item);
  const hasStableBuffMatch =
    status.buffMargin >= WEAK_COUNTDOWN_MIN_BUFF_MARGIN ||
    trackingMargin >= WEAK_COUNTDOWN_MIN_TRACKING_MARGIN ||
    (candidate !== null &&
      isSmallPotionBuffExpiryReference(candidate.buffId) &&
      status.score >= WEAK_SMALL_POTION_MIN_SCORE);
  return (
    candidate !== null &&
    Number.isFinite(candidate.seconds) &&
    status.score >= WEAK_COUNTDOWN_MIN_SCORE &&
    hasStableBuffMatch &&
    status.secondMargin >= WEAK_COUNTDOWN_MIN_SECOND_MARGIN
  );
}

function isGroupedCountdownAccepted(item: RankedCountdownItem): boolean {
  const candidate = item.countdownCandidate;
  return (
    candidate !== null &&
    Number.isFinite(candidate.seconds) &&
    item.countdownStatus.score >= GROUPED_COUNTDOWN_MIN_SCORE &&
    item.countdownStatus.secondMargin >= item.countdownStatus.minAcceptedSecondMargin &&
    getTrackingGroupMargin(item) >= GROUPED_COUNTDOWN_MIN_TRACKING_MARGIN
  );
}

function getTrackingGroupMargin(item: RankedCountdownItem): number {
  const candidate = item.countdownCandidate;
  if (!candidate) {
    return item.countdownStatus.buffMargin;
  }

  const candidateTrackingId = getBuffExpiryTrackingId(candidate.buffId);
  const bestSameGroup = item.countdownTopMatches
    .filter((match) => getBuffExpiryTrackingId(match.buffId) === candidateTrackingId)
    .sort((a, b) => b.score - a.score)[0];
  const bestDifferentGroup = item.countdownTopMatches
    .filter((match) => getBuffExpiryTrackingId(match.buffId) !== candidateTrackingId)
    .sort((a, b) => b.score - a.score)[0];

  return round((bestSameGroup?.score ?? item.countdownStatus.score) - (bestDifferentGroup?.score ?? 0));
}

function isTemporalLowScoreCandidate(
  item: RankedCountdownItem,
  acceptedReference: CountdownSample | null,
  bodyIdentities: BodyIdentityMatches,
): boolean {
  if (hasTopEdgeTimerTextSignal(item.normalizedIcon)) {
    return false;
  }

  const candidate = item.countdownCandidate;
  if (!candidate || acceptedReference) {
    return false;
  }
  if (!selectedReferenceIds.has(candidate.buffId)) {
    return false;
  }
  if (
    candidate.seconds < TEMPORAL_LOW_SCORE_MIN_SECONDS ||
    candidate.seconds > TEMPORAL_LOW_SCORE_MAX_SECONDS
  ) {
    return false;
  }
  const status = item.countdownStatus;
  if (
    !TEMPORAL_COUNTDOWN_REASONS.has(status.reason) ||
    status.score < TEMPORAL_LOW_SCORE_MIN_SCORE
  ) {
    return false;
  }

  const trackingId = getBuffExpiryTrackingId(candidate.buffId);
  const identity = bodyIdentities.get(trackingId);
  const hasBaselineScore = status.score >= TEMPORAL_LOW_SCORE_BASELINE_SCORE;
  const hasRescueMargins =
    status.secondMargin >= TEMPORAL_LOW_SCORE_RESCUE_MIN_SECOND_MARGIN &&
    (identity?.margin ?? 0) >= TEMPORAL_LOW_SCORE_RESCUE_MIN_BODY_MARGIN;
  return isBodyIdentityConfident(bodyIdentities, trackingId) && (hasBaselineScore || hasRescueMargins);
}

function resolveTemporalCandidateReference(
  item: RankedCountdownItem,
  acceptedReference: {
    reference: CountdownSample;
    reason: string;
    strength: "strong" | "weak";
  } | null,
  bodyIdentities: BodyIdentityMatches,
): CountdownSample | null {
  if (isTemporalLowScoreCandidate(item, acceptedReference?.reference ?? null, bodyIdentities)) {
    return item.countdownCandidate;
  }
  const relaxedCouponReference = resolveRelaxedCouponTemporalReference(
    item,
    acceptedReference,
    bodyIdentities,
  );
  if (relaxedCouponReference) {
    return relaxedCouponReference;
  }
  return null;
}

function resolveRelaxedCouponTemporalReference(
  item: RankedCountdownItem,
  acceptedReference: {
    reference: CountdownSample;
    reason: string;
    strength: "strong" | "weak";
  } | null,
  bodyIdentities: BodyIdentityMatches,
): CountdownSample | null {
  if (hasTopEdgeTimerTextSignal(item.normalizedIcon)) {
    return null;
  }
  if (acceptedReference?.strength === "strong") {
    return null;
  }

  const candidate = item.countdownCandidate;
  if (!candidate) {
    return null;
  }
  const trackingId = getBuffExpiryTrackingId(candidate.buffId);
  if (
    trackingId !== BUFF_EXPIRY_EXP_COUPON_GROUP_ID &&
    trackingId !== BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID
  ) {
    return null;
  }
  if (
    candidate.seconds < TEMPORAL_LOW_SCORE_MIN_SECONDS ||
    candidate.seconds > TEMPORAL_LOW_SCORE_MAX_SECONDS
  ) {
    return null;
  }

  const status = item.countdownStatus;
  if (
    !TEMPORAL_COUNTDOWN_REASONS.has(status.reason) ||
    status.score < COUPON_TEMPORAL_MIN_SCORE ||
    status.secondMargin < COUPON_TEMPORAL_MIN_SECOND_MARGIN
  ) {
    return null;
  }

  const identity = bodyIdentities.get(trackingId);
  if (
    identity?.accepted === true &&
    selectedReferenceIds.has(identity.sourceBuffId) &&
    identity.score >= COUPON_TEMPORAL_MIN_BODY_IDENTITY_SCORE
  ) {
    return candidate;
  }

  const selectedCouponIdentity = findSelectedCouponTemporalIdentity(bodyIdentities);
  if (
    !selectedCouponIdentity ||
    selectedCouponIdentity.score < COUPON_TEMPORAL_WEAK_IDENTITY_MIN_SCORE ||
    status.score < COUPON_TEMPORAL_WEAK_IDENTITY_MIN_COUNTDOWN_SCORE ||
    status.secondMargin < COUPON_TEMPORAL_WEAK_IDENTITY_MIN_SECOND_MARGIN
  ) {
    return null;
  }

  return {
    ...candidate,
    id: `${selectedCouponIdentity.sourceBuffId}:${candidate.seconds}:coupon-identity-countdown`,
    buffId: selectedCouponIdentity.sourceBuffId,
    name: getBuffExpiryCatalogItem(getBuffExpiryTrackingId(selectedCouponIdentity.sourceBuffId))?.label ?? candidate.name,
  };
}

function findSelectedCouponTemporalIdentity(bodyIdentities: BodyIdentityMatches): BodyIdentityMatch | null {
  return [
    bodyIdentities.get(BUFF_EXPIRY_EXP_COUPON_GROUP_ID),
    bodyIdentities.get(BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID),
  ]
    .filter((identity): identity is BodyIdentityMatch =>
      identity?.accepted === true && selectedReferenceIds.has(identity.sourceBuffId)
    )
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

function buildBodyIdentityPrototypes(samples: CountdownSample[]): BodyIdentityPrototype[] {
  const bySourceBuffId = new Map<string, CountdownSample[]>();
  for (const sample of samples) {
    if (!Number.isFinite(sample.seconds)) {
      continue;
    }
    bySourceBuffId.set(sample.buffId, [...(bySourceBuffId.get(sample.buffId) ?? []), sample]);
  }
  return [...bySourceBuffId.entries()].map(([sourceBuffId, sourceSamples]) => ({
    trackingId: getBuffExpiryTrackingId(sourceBuffId),
    sourceBuffId,
    normalizedIcon: makeAverageImageData(sourceSamples.map((sample) => sample.normalizedIcon)),
  }));
}

function resolveBodyIdentityMatches(
  detectedIcon: ImageDataLike,
  prototypes: BodyIdentityPrototype[],
): BodyIdentityMatches {
  const bestByTrackingId = new Map<string, Omit<BodyIdentityMatch, "margin" | "accepted">>();
  for (const prototype of prototypes) {
    if (!bodyIdentityTrackingIds.has(prototype.trackingId)) {
      continue;
    }
    const score = compareBuffBodyIdentity(detectedIcon, prototype.normalizedIcon);
    const previous = bestByTrackingId.get(prototype.trackingId);
    if (!previous || score > previous.score) {
      bestByTrackingId.set(prototype.trackingId, {
        trackingId: prototype.trackingId,
        sourceBuffId: prototype.sourceBuffId,
        score,
      });
    }
  }
  const ranked = [...bestByTrackingId.values()].sort((a, b) => b.score - a.score);
  const result: BodyIdentityMatches = new Map();
  for (const item of ranked) {
    const nearestOther = ranked.find((candidate) => candidate.trackingId !== item.trackingId);
    const margin = item.score - (nearestOther?.score ?? 0);
    result.set(item.trackingId, {
      ...item,
      score: round(item.score),
      margin: round(margin),
      accepted: item.score >= BODY_IDENTITY_MIN_SCORE,
    });
  }
  return result;
}

function resolveExcludedIdentityMatch(
  detectedIcon: ImageDataLike,
  supportedIdentities: BodyIdentityMatches,
): ExcludedIdentityMatch {
  const ranked = excludedIdentityPrototypes
    .map((prototype) => ({
      id: prototype.id,
      label: prototype.label,
      score: compareBuffBodyIdentity(detectedIcon, prototype.normalizedIcon),
    }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) {
    return {
      id: "",
      label: "",
      score: 0,
      margin: 0,
      supportedMargin: 0,
      blocked: false,
    };
  }

  const nearestOtherScore = ranked.find((candidate) => candidate.id !== best.id)?.score ?? 0;
  const bestScoreById = new Map<string, number>();
  for (const candidate of ranked) {
    if (!bestScoreById.has(candidate.id)) {
      bestScoreById.set(candidate.id, candidate.score);
    }
  }
  const bestSupportedScore = [...supportedIdentities.values()]
    .reduce((bestScore, identity) => Math.max(bestScore, identity.score), 0);
  const margin = best.score - nearestOtherScore;
  const supportedMargin = best.score - bestSupportedScore;
  const minSupportedMargin =
    EXCLUDED_IDENTITY_MIN_SUPPORTED_MARGIN_BY_ID[best.id] ?? EXCLUDED_IDENTITY_MIN_SUPPORTED_MARGIN;
  const cooldownScore = bestScoreById.get(EXCLUDED_IDENTITY_COOLDOWN_ID) ?? 0;
  const isVipCooldownRescue =
    best.id === EXCLUDED_IDENTITY_VIP_ID &&
    best.score >= EXCLUDED_IDENTITY_VIP_COOLDOWN_RESCUE_MIN_SCORE &&
    supportedMargin >= EXCLUDED_IDENTITY_VIP_COOLDOWN_RESCUE_MIN_SUPPORTED_MARGIN &&
    cooldownScore >= EXCLUDED_IDENTITY_VIP_COOLDOWN_RESCUE_MIN_COOLDOWN_SCORE;
  const blocked =
    best.score >= EXCLUDED_IDENTITY_MIN_SCORE &&
    (margin >= EXCLUDED_IDENTITY_MIN_MARGIN || isVipCooldownRescue) &&
    (supportedMargin >= minSupportedMargin || isVipCooldownRescue);

  return {
    id: best.id,
    label: best.label,
    score: round(best.score),
    margin: round(margin),
    supportedMargin: round(supportedMargin),
    blocked,
  };
}

function isBodyIdentityAccepted(bodyIdentities: BodyIdentityMatches, trackingId: string): boolean {
  return bodyIdentities.get(trackingId)?.accepted === true;
}

function isBodyIdentityConfident(bodyIdentities: BodyIdentityMatches, trackingId: string): boolean {
  const identity = bodyIdentities.get(trackingId);
  return (
    identity?.accepted === true &&
    (identity.margin >= BODY_IDENTITY_MIN_MARGIN || identity.score >= BODY_IDENTITY_STRONG_SCORE)
  );
}

function isAcceptedReferenceBodyIdentityEligible(
  acceptedReference: {
    reference: CountdownSample;
    reason: string;
    strength: "strong" | "weak";
  },
  bodyIdentities: BodyIdentityMatches,
): boolean {
  const trackingId = getBuffExpiryTrackingId(acceptedReference.reference.buffId);
  if (acceptedReference.reason === "weak-countdown") {
    return isWeakCountdownBodyIdentityConfident(bodyIdentities, trackingId);
  }
  if (acceptedReference.strength === "weak") {
    return isBodyIdentityConfident(bodyIdentities, trackingId);
  }
  return isBodyIdentityAccepted(bodyIdentities, trackingId);
}

function isWeakCountdownBodyIdentityConfident(bodyIdentities: BodyIdentityMatches, trackingId: string): boolean {
  const identity = bodyIdentities.get(trackingId);
  return (
    identity?.accepted === true &&
    identity.score >= WEAK_COUNTDOWN_MIN_BODY_IDENTITY_SCORE &&
    (identity.margin >= BODY_IDENTITY_MIN_MARGIN || identity.score >= BODY_IDENTITY_STRONG_SCORE)
  );
}

function compareBuffBodyIdentity(detectedIcon: ImageDataLike, referenceIcon: ImageDataLike): number {
  if (detectedIcon.width !== referenceIcon.width || detectedIcon.height !== referenceIcon.height) {
    return 0;
  }
  let weightedDistance = 0;
  let totalWeight = 0;
  for (let y = 0; y < detectedIcon.height; y += 1) {
    for (let x = 0; x < detectedIcon.width; x += 1) {
      const offset = (y * detectedIcon.width + x) * 4;
      const detectedAlpha = detectedIcon.data[offset + 3] / 255;
      const referenceAlpha = referenceIcon.data[offset + 3] / 255;
      if (detectedAlpha <= 0.01 && referenceAlpha <= 0.01) {
        continue;
      }
      const timerArea = isCountdownTimerArea(x, y, detectedIcon.width, detectedIcon.height);
      if (timerArea && (isDigitLike(detectedIcon.data, offset) || isDigitLike(referenceIcon.data, offset))) {
        continue;
      }
      const alphaWeight = 0.25 + Math.max(detectedAlpha, referenceAlpha) * 0.75;
      const timerWeight = timerArea ? 0.55 : 1;
      const colorDistance = rgbDistance(detectedIcon.data, referenceIcon.data, offset);
      const lumaDistance = Math.abs(lumaAt(detectedIcon.data, offset) - lumaAt(referenceIcon.data, offset)) / 255;
      weightedDistance += (colorDistance * 0.72 + lumaDistance * 0.28) * alphaWeight * timerWeight;
      totalWeight += alphaWeight * timerWeight;
    }
  }
  return clamp(1 - (totalWeight ? weightedDistance / totalWeight : 1), 0, 1);
}

function loadCountdownSamples(): CountdownSample[] {
  const metadata = JSON.parse(readFileSync(join(publicBuffExpiryDir, "countdown-metadata.json"), "utf8")) as {
    samples: Array<Omit<CountdownSample, "normalizedIcon">>;
  };
  const atlas = PNG.sync.read(readFileSync(join(publicBuffExpiryDir, "countdown-atlas.png")));
  return metadata.samples.map((sample) => ({
    ...sample,
    normalizedIcon: cropPng(atlas, sample.atlas),
  }));
}

function loadExcludedIdentityPrototypes(): ExcludedIdentityPrototype[] {
  const metadata = JSON.parse(readFileSync(join(publicBuffExpiryDir, "excluded-identity-metadata.json"), "utf8")) as {
    samples: ExcludedIdentitySample[];
  };
  const atlas = PNG.sync.read(readFileSync(join(publicBuffExpiryDir, "excluded-identity-atlas.png")));
  return metadata.samples.map((sample) => ({
    id: sample.id,
    label: sample.label,
    normalizedIcon: cropPng(atlas, sample.atlas),
  }));
}

function makeAverageImageData(images: ImageDataLike[]): ImageDataLike {
  const first = images[0];
  const sums = new Float64Array(first.width * first.height * 4);
  for (const image of images) {
    for (let index = 0; index < image.data.length; index += 1) {
      sums[index] += image.data[index];
    }
  }
  const data = new Uint8ClampedArray(first.width * first.height * 4);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.round(sums[index] / images.length);
  }
  return { width: first.width, height: first.height, data };
}

function cropPng(png: PNG, region: { x: number; y: number; width: number; height: number }): ImageDataLike {
  const data = new Uint8ClampedArray(region.width * region.height * 4);
  for (let y = 0; y < region.height; y += 1) {
    const sourceStart = ((region.y + y) * png.width + region.x) * 4;
    data.set(png.data.subarray(sourceStart, sourceStart + region.width * 4), y * region.width * 4);
  }
  return { width: region.width, height: region.height, data };
}

function serializeAcceptedMatch(
  item: RankedCountdownItem,
  roi: { x: number; y: number },
  reference: CountdownSample | null = item.countdownMatch,
  reason = item.countdownStatus.reason,
  strength: "strong" | "weak" = "strong",
): BuffExpiryTemporalCandidateMatch {
  if (!reference) {
    throw new Error("Accepted countdown match is missing a reference.");
  }
  const trackingId = getBuffExpiryTrackingId(reference.buffId);
  const catalogItem = getBuffExpiryCatalogItem(trackingId);
  return {
    box: serializeBox(item.box, roi),
    buffId: trackingId,
    name: catalogItem?.label ?? reference.name,
    seconds: reference.seconds,
    score: item.countdownStatus.score,
    buffMargin: item.countdownStatus.buffMargin,
    secondMargin: item.countdownStatus.secondMargin,
    reason,
    strength,
    topMatches: item.countdownTopMatches,
  };
}

function serializeTemporalCandidateMatch(
  item: RankedCountdownItem,
  roi: { x: number; y: number },
  reference: CountdownSample | null,
): BuffExpiryAcceptedMatch {
  if (!reference) {
    throw new Error("Temporal candidate match is missing a reference.");
  }
  return {
    ...serializeAcceptedMatch(item, roi, reference, "temporal-low-score", "weak"),
    reason: "temporal-low-score",
    strength: "weak",
  };
}

function serializeBox(box: Record<string, unknown>, roi: { x: number; y: number }): BuffExpiryBox {
  return {
    x: Math.round(Number(box.x) + roi.x),
    y: Math.round(Number(box.y) + roi.y),
    width: Math.round(Number(box.width)),
    height: Math.round(Number(box.height)),
    confidence: round(Number(box.confidence) || 0),
    side: Number.isFinite(Number(box.side)) ? Math.round(Number(box.side)) : undefined,
    row: Number.isFinite(Number(box.row)) ? Math.round(Number(box.row)) : undefined,
    col: Number.isFinite(Number(box.col)) ? Math.round(Number(box.col)) : undefined,
  };
}

function dedupeAcceptedEventsByTrackingId(
  events: Array<{ match: BuffExpiryAcceptedMatch; normalizedIcon: ImageDataLike }>,
): Array<{ match: BuffExpiryAcceptedMatch; normalizedIcon: ImageDataLike }> {
  const byBuffId = new Map<string, { match: BuffExpiryAcceptedMatch; normalizedIcon: ImageDataLike }>();
  for (const event of events) {
    const previous = byBuffId.get(event.match.buffId);
    if (
      !previous ||
      event.match.score > previous.match.score ||
      (event.match.score === previous.match.score && event.match.secondMargin > previous.match.secondMargin)
    ) {
      byBuffId.set(event.match.buffId, event);
    }
  }
  return [...byBuffId.values()];
}

function dedupeTemporalCandidateMatches(
  matches: BuffExpiryTemporalCandidateMatch[],
): BuffExpiryTemporalCandidateMatch[] {
  const byFrameBoxGroupAndSecond = new Map<string, BuffExpiryTemporalCandidateMatch>();
  for (const match of matches) {
    const key = [
      match.buffId,
      match.seconds,
      Math.round(match.box.x),
      Math.round(match.box.y),
      Math.round(match.box.width),
      Math.round(match.box.height),
    ].join(":");
    const previous = byFrameBoxGroupAndSecond.get(key);
    if (
      !previous ||
      match.score > previous.score ||
      (match.score === previous.score && match.secondMargin > previous.secondMargin)
    ) {
      byFrameBoxGroupAndSecond.set(key, match);
    }
  }
  return [...byFrameBoxGroupAndSecond.values()];
}

function findTriggerAcceptedEvent(
  events: Array<{ match: BuffExpiryAcceptedMatch; normalizedIcon: ImageDataLike }>,
  track: BuffExpiryTrackedBuff,
  now: number,
): { match: BuffExpiryAcceptedMatch; normalizedIcon: ImageDataLike } | null {
  return events
    .filter((event) => event.match.buffId === track.buffId)
    .map((event) => ({
      event,
      expiresDistance: Math.abs(now + event.match.seconds * 1000 - track.expiresAt),
    }))
    .filter(({ expiresDistance }) => expiresDistance <= 3000)
    .sort((a, b) => a.expiresDistance - b.expiresDistance || b.event.match.score - a.event.match.score)[0]?.event ?? null;
}

function findAcceptedEventForMatch(
  events: Array<{ match: BuffExpiryAcceptedMatch; normalizedIcon: ImageDataLike }>,
  match: BuffExpiryAcceptedMatch,
): { match: BuffExpiryAcceptedMatch; normalizedIcon: ImageDataLike } | null {
  return events
    .filter((event) => event.match.buffId === match.buffId && event.match.seconds === match.seconds)
    .map((event) => ({
      event,
      boxDistance: getBoxDistance(event.match.box, match.box),
      scoreDistance: Math.abs(event.match.score - match.score),
    }))
    .sort((a, b) => a.boxDistance - b.boxDistance || a.scoreDistance - b.scoreDistance)[0]?.event ?? null;
}

function findAuditClusterForTrack(
  clusters: BuffExpiryExpiryCluster[],
  track: BuffExpiryTrackedBuff,
): BuffExpiryExpiryCluster | null {
  return clusters
    .filter((cluster) => cluster.confirmedAt !== null)
    .map((cluster) => ({
      cluster,
      distance: Math.abs(cluster.centerExpiresAt - track.expiresAt),
    }))
    .filter(({ distance }) => distance <= 3000)
    .sort((a, b) => a.distance - b.distance)[0]?.cluster ?? null;
}

function getAuditClusterInlierObservations(cluster: BuffExpiryExpiryCluster) {
  return cluster.observations.filter(
    (observation) => Math.abs(observation.predictedExpiresAt - cluster.centerExpiresAt) <= 4000,
  );
}

function getAuditStatusTransition({
  second,
  boxCount,
  tracks,
  pendingTracks,
  temporalCandidateTracks,
  expiryClusters,
}: {
  second: number;
  boxCount: number;
  tracks: BuffExpiryTrackedBuff[];
  pendingTracks: BuffExpiryPendingTrack[];
  temporalCandidateTracks: BuffExpiryPendingTrack[];
  expiryClusters: BuffExpiryExpiryCluster[];
}): VideoAuditStatusTransition {
  const now = second * 1000;
  const activeTracks = tracks.filter((track) => track.alertedAt === null);
  const confirmedExpiryClusterCount = expiryClusters.filter((cluster) => cluster.confirmedAt !== null).length;
  const base = {
    second,
    trackCount: tracks.length,
    pendingTrackCount: pendingTracks.length,
    temporalCandidateTrackCount: temporalCandidateTracks.length,
    expiryClusterCount: expiryClusters.length,
    confirmedExpiryClusterCount,
  };

  if (tracks.length && !activeTracks.length) {
    const alertedAt = tracks.reduce<number | null>((latest, track) => {
      if (track.alertedAt === null) {
        return latest;
      }
      return latest === null ? track.alertedAt : Math.max(latest, track.alertedAt);
    }, null);
    return {
      ...base,
      label: "알림 완료",
      detail: alertedAt !== null ? `${Math.max(0, Math.floor((now - alertedAt) / 1000))}초 전 알림` : "알림 완료",
      className: "alerted",
    };
  }

  if (activeTracks.length) {
    const nextTrack = [...activeTracks].sort((a, b) => a.expiresAt - b.expiresAt)[0];
    const remainingSeconds = Math.max(0, Math.ceil((nextTrack.expiresAt - now) / 1000));
    return {
      ...base,
      label: "알림 대기",
      detail: `${activeTracks.length}개 알림 대기 · ${remainingSeconds}초 남음`,
      className: "active",
    };
  }

  if (getAuditConfirmationCandidateCount({ pendingTracks, temporalCandidateTracks, expiryClusters }) > 0) {
    return {
      ...base,
      label: "시간 확인 중",
      detail: "버프 시간 흐름을 확인하는 중",
      className: "active",
    };
  }

  return {
    ...base,
    label: "감지 대기",
    detail: boxCount > 0 ? "지원 버프의 남은 시간을 찾는 중" : "버프칸을 확인하는 중",
    className: "waiting",
  };
}

function getAuditConfirmationCandidateCount({
  pendingTracks,
  temporalCandidateTracks,
  expiryClusters,
}: {
  pendingTracks: BuffExpiryPendingTrack[];
  temporalCandidateTracks: BuffExpiryPendingTrack[];
  expiryClusters: BuffExpiryExpiryCluster[];
}): number {
  const trackCandidateCount = [
    ...pendingTracks,
    ...temporalCandidateTracks,
  ].filter(isAuditDisplayableCandidateTrack).length;
  const clusterCandidateCount = expiryClusters.filter(isAuditDisplayableCluster).length;
  return Math.max(trackCandidateCount, clusterCandidateCount);
}

function isAuditDisplayableCandidateTrack(track: BuffExpiryPendingTrack): boolean {
  return (
    track.observations.length >= 2 ||
    track.observations.some((observation) => observation.strength === "strong")
  );
}

function isAuditDisplayableCluster(cluster: BuffExpiryExpiryCluster): boolean {
  if (cluster.confirmedAt !== null) {
    return true;
  }
  if (cluster.observations.length < 2) {
    return false;
  }
  const observedAt = cluster.observations.map((observation) => observation.observedAt);
  return Math.max(...observedAt) - Math.min(...observedAt) >= 1000;
}

function getBoxDistance(a: BuffExpiryBox, b: BuffExpiryBox): number {
  return (
    Math.abs(a.x - b.x) +
    Math.abs(a.y - b.y) +
    Math.abs(a.width - b.width) +
    Math.abs(a.height - b.height)
  );
}

function writeRecognizedIcon(
  videoId: string,
  second: number,
  match: BuffExpiryAcceptedMatch,
  image: ImageDataLike,
): string {
  const relativePath = join(
    "recognized-icons",
    videoId,
    `${String(second).padStart(4, "0")}s__${match.buffId}__detected-${match.seconds}s__${sanitizeFileSegment(match.reason)}__score-${Math.round(match.score * 10000)}.png`,
  );
  const outputPath = join(outputDir, relativePath);
  mkdirSync(join(outputDir, "recognized-icons", videoId), { recursive: true });
  writePngImageData(outputPath, image);
  return relativePath;
}

function writeTriggerIcon(
  videoId: string,
  second: number,
  track: BuffExpiryTrackedBuff,
  image: ImageDataLike,
): string {
  const relativePath = join(
    "trigger-icons",
    videoId,
    `${String(second).padStart(4, "0")}s__${track.buffId}__detected-${track.detectedSeconds}s__expires-${Math.round(track.expiresAt / 1000)}s.png`,
  );
  const outputPath = join(outputDir, relativePath);
  mkdirSync(join(outputDir, "trigger-icons", videoId), { recursive: true });
  writePngImageData(outputPath, image);
  return relativePath;
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "match";
}

function writePngImageData(filePath: string, image: ImageDataLike): void {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  writeFileSync(filePath, PNG.sync.write(png));
}

function isCountdownTimerArea(x: number, y: number, width: number, height: number): boolean {
  return x > width * 0.05 && x < width * 0.95 && y > height * 0.25 && y < height * 0.82;
}

function isDigitLike(data: Uint8ClampedArray, offset: number): boolean {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return (r > 120 && g > 115 && b < 125 && r + g > b * 2.15) || (max > 178 && max - min < 78);
}

function hasTopEdgeTimerTextSignal(icon: ImageDataLike): boolean {
  let strictTextPixels = 0;
  const scanRows = Math.min(TOP_EDGE_TIMER_TEXT_SCAN_ROWS, icon.height);
  for (let y = 0; y < scanRows; y += 1) {
    for (let x = 0; x < icon.width; x += 1) {
      const offset = (y * icon.width + x) * 4;
      if (isStrictTimerTextPixel(icon.data, offset)) {
        strictTextPixels += 1;
      }
    }
  }
  return strictTextPixels >= TOP_EDGE_TIMER_TEXT_MIN_PIXELS;
}

function isStrictTimerTextPixel(data: Uint8ClampedArray, offset: number): boolean {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return (r > 150 && g > 135 && b < 90 && r + g > b * 2.6) || (max > 205 && max - min < 45);
}

function rgbDistance(a: Uint8ClampedArray, b: Uint8ClampedArray, offset: number): number {
  const dr = a[offset] - b[offset];
  const dg = a[offset + 1] - b[offset + 1];
  const db = a[offset + 2] - b[offset + 2];
  return Math.sqrt(dr * dr + dg * dg + db * db) / 441.6729559300637;
}

function lumaAt(data: Uint8ClampedArray, offset: number): number {
  return data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
}

function makeConsoleReport(reports: VideoAuditReport[]): string {
  const rows = reports.map((report) => [
    report.id,
    String(report.frameCount),
    String(report.boxCountAverage),
    formatExpectation(report.expectation),
    formatCounts(report.acceptedCounts),
    formatConfirmations(report.confirmations),
    formatAlerts(report.alertEvents),
    formatStatusTransitions(report.statusTransitions),
    String(report.finalPendingTracks.length),
  ]);
  const headers = ["sample", "frames", "avg boxes", "expectation", "accepted", "confirmed", "alerts", "status", "pending"];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  return [
    headers.map((header, index) => header.padEnd(widths[index])).join(" | "),
    widths.map((width) => "-".repeat(width)).join("-|-"),
    ...rows.map((row) => row.map((cell, index) => cell.padEnd(widths[index])).join(" | ")),
  ].join("\n");
}

function makeMarkdownReport(reports: VideoAuditReport[]): string {
  return [
    "# Buff Expiry Current Video Audit",
    "",
    `- Alert lead seconds: ${alertLeadSeconds}`,
    `- Selected buffs: ${selectedBuffIds.map(getBuffLabel).join(", ")}`,
    "",
    "| Sample | Frames | Avg boxes | Expectation | Accepted | Confirmed | Alerts | Status | Pending |",
    "|---|---:|---:|---|---|---|---|---|---:|",
    ...reports.map((report) =>
      `| ${report.id} | ${report.frameCount} | ${report.boxCountAverage} | ${formatExpectation(report.expectation)} | ${formatCounts(report.acceptedCounts)} | ${formatConfirmations(report.confirmations)} | ${formatAlerts(report.alertEvents)} | ${formatStatusTransitions(report.statusTransitions)} | ${report.finalPendingTracks.length} |`,
    ),
    "",
  ].join("\n");
}

function makeEventMarkdownReport(reports: VideoAuditReport[]): string {
  const lines = [
    "# Buff Expiry Video Events",
    "",
    `- Alert lead seconds: ${alertLeadSeconds}`,
    "",
  ];
  for (const report of reports) {
    lines.push(`## ${report.title}`);
    lines.push("");
    lines.push(`- ID: ${report.id}`);
    lines.push(`- Frames: ${report.frameCount}`);
    lines.push(`- Avg boxes: ${report.boxCountAverage}`);
    lines.push(`- Unsupported frames: ${report.unsupportedFrames}`);
    if (report.testPurpose) {
      lines.push(`- Purpose: ${report.testPurpose}`);
    }
    if (report.expectedBuffGroups.length) {
      lines.push(`- Expected groups: ${report.expectedBuffGroups.map((group) => group.label ?? getBuffLabel(group.id)).join(", ")}`);
    }
    lines.push(`- Expectation: ${formatExpectation(report.expectation)}`);
    lines.push("");
    if (!report.events.length) {
      lines.push("No recognition, confirmation, or alert events.");
      lines.push("");
      continue;
    }
    lines.push("| Time | Event | Buff | Detail |");
    lines.push("|---:|---|---|---|");
    for (const event of report.events) {
      lines.push(formatEventMarkdownRow(event));
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function formatEventMarkdownRow(event: VideoAuditEvent): string {
  if (event.kind === "recognized") {
    return markdownRow([
      formatTime(event.second),
      "인식",
      event.label,
      `${event.detectedSeconds}s, expires ${formatTime(event.expiresSecond)}, score ${round(event.score)}, ${event.reason}/${event.strength}${event.iconFile ? `, icon ${event.iconFile}` : ""}`,
    ]);
  }
  if (event.kind === "confirmed") {
    const trigger = event.triggerIconFile ? `, trigger ${event.triggerIconFile}` : "";
    return markdownRow([
      formatTime(event.second),
      "확정",
      event.label,
      `${event.detectedSeconds}s, expires ${formatTime(event.expiresSecond)}${trigger}`,
    ]);
  }
  if (event.kind === "cluster-confirmed") {
    return markdownRow([
      formatTime(event.second),
      "클러스터 확정",
      event.clusterId,
      `expires ${formatTime(event.centerExpiresSecond)}, alert ${formatTime(event.alertSecond)}, inliers ${event.inlierCount}/${event.observationCount}, slots ${event.distinctSlotCount}, buffs ${event.distinctBuffCount}`,
    ]);
  }
  if (event.kind === "member-confirmed") {
    const trigger = event.triggerIconFile ? `, trigger ${event.triggerIconFile}` : "";
    return markdownRow([
      formatTime(event.second),
      "클러스터 멤버",
      event.label,
      `${event.detectedSeconds}s, expires ${formatTime(event.expiresSecond)}, cluster ${event.clusterId}${trigger}`,
    ]);
  }
  return markdownRow([
    formatTime(event.second),
    "알림",
    event.tracks.map((track) => track.label).join(", "),
    event.tracks
      .map((track) => `${track.label} remaining ${track.remainingSeconds}s, expires ${formatTime(track.expiresSecond)}`)
      .join("<br>"),
  ]);
}

function toEventReport(report: VideoAuditReport): {
  id: string;
  title: string;
  frameDir: string;
  frameCount: number;
  unsupportedFrames: number;
    boxCountAverage: number;
    testPurpose: string | null;
    expectedBuffGroups: ManifestExpectedBuffGroup[];
    expectedBehavior: Record<string, string> | string | null;
    expectation: VideoAuditExpectation;
    events: VideoAuditEvent[];
    finalTracks: BuffExpiryTrackedBuff[];
    finalPendingTracks: BuffExpiryPendingTrack[];
} {
  return {
    id: report.id,
    title: report.title,
    frameDir: report.frameDir,
    frameCount: report.frameCount,
    unsupportedFrames: report.unsupportedFrames,
    boxCountAverage: report.boxCountAverage,
    testPurpose: report.testPurpose,
    expectedBuffGroups: report.expectedBuffGroups,
    expectedBehavior: report.expectedBehavior,
    expectation: report.expectation,
    events: report.events,
    finalTracks: report.finalTracks,
    finalPendingTracks: report.finalPendingTracks,
  };
}

function getEventKindOrder(kind: VideoAuditEvent["kind"]): number {
  if (kind === "recognized") {
    return 0;
  }
  if (kind === "cluster-confirmed") {
    return 1;
  }
  if (kind === "member-confirmed") {
    return 2;
  }
  if (kind === "confirmed") {
    return 3;
  }
  return 4;
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([buffId, count]) => `${getShortBuffLabel(buffId)}:${count}`)
    .join(", ") || "-";
}

function formatConfirmations(confirmations: VideoAuditReport["confirmations"]): string {
  return confirmations.map((item) => `${getShortBuffLabel(item.buffId)}@${item.second}s(${item.detectedSeconds}s)`).join(", ") || "-";
}

function formatAlerts(alerts: VideoAuditReport["alertEvents"]): string {
  return alerts
    .map((event) => `${event.second}s:${event.tracks.map((track) => `${getShortBuffLabel(track.buffId)} ${track.remainingSeconds}s`).join("+")}`)
    .join(", ") || "-";
}

function formatStatusTransitions(transitions: VideoAuditStatusTransition[]): string {
  return transitions
    .map((event) => `${event.second}s:${event.label}`)
    .join(" > ") || "-";
}

function formatExpectation(expectation: VideoAuditExpectation): string {
  const prefix = expectation.status.toUpperCase();
  return `${prefix}: ${expectation.detail}`;
}

function formatTime(second: number): string {
  const roundedSecond = Math.max(0, Math.round(second));
  const minutes = Math.floor(roundedSecond / 60);
  const seconds = roundedSecond % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function markdownRow(cells: string[]): string {
  return `| ${cells.map(escapeMarkdownCell).join(" | ")} |`;
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll("|", "\\|");
}

function getBuffLabel(buffId: string): string {
  return BUFF_EXPIRY_BUFF_CATALOG.find((item) => item.id === buffId)?.label ?? buffId;
}

function getShortBuffLabel(buffId: string): string {
  return BUFF_EXPIRY_BUFF_CATALOG.find((item) => item.id === buffId)?.shortLabel ?? buffId;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
