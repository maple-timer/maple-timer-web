import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import {
  BUFF_EXPIRY_BUFF_CATALOG,
  getBuffExpiryReferenceIdsForSelection,
  getBuffExpiryTrackingId,
  isSmallPotionBuffExpiryReference,
  SUPPORTED_BUFF_EXPIRY_BUFF_IDS,
} from "../src/lib/buffExpiry/buffExpiryCatalog";
import { getBuffExpiryCaptureRoi } from "../src/lib/buffExpiry/buffExpiryCalibration";
import {
  markDueBuffExpiryTracksAlerted,
  reconcileBuffExpiryTracks,
  selectBuffExpiryRuntimeMatches,
} from "../src/lib/buffExpiryLegacy/buffExpiryLegacyRuntime";
import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryBox,
  BuffExpiryPendingTrack,
  BuffExpiryTrackedBuff,
} from "../src/lib/buffExpiry/buffExpiryTypes";

type Manifest = {
  frameCount: number;
  frames: Array<{
    index: number;
    second: number;
    file: string;
    width: number;
    height: number;
  }>;
};

type VideoRootManifest = {
  videos?: Array<{
    id: string;
    title: string;
    frameDir: string;
  }>;
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

type CountdownTopMatch = {
  buffId: string;
  name: string;
  kind: string;
  seconds: number | null;
  file: string | null;
  score: number;
  distance: number;
  timerPixels: number;
  digitPixels: number;
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
  };
  countdownTopMatches: CountdownTopMatch[];
};

type FrameDetection = {
  index: number;
  second: number;
  file: string;
  boxes: BuffExpiryBox[];
  acceptedMatches: BuffExpiryAcceptedMatch[];
  hypothesisMatches: BuffExpiryAcceptedMatch[];
  hypothesisEvidences: HypothesisEvidence[];
  unsupportedReason: string | null;
};

type HypothesisEvidence = {
  frameSecond: number;
  groupId: string;
  groupLabel: string;
  sourceBuffId: string;
  sourceName: string;
  seconds: number;
  score: number;
  rank: number;
  expiresSecond: number;
  box: BuffExpiryBox;
};

type HypothesisCluster = {
  groupId: string;
  groupLabel: string;
  evidenceCount: number;
  uniqueFrameCount: number;
  firstFrameSecond: number;
  lastFrameSecond: number;
  averageScore: number;
  minExpiresSecond: number;
  maxExpiresSecond: number;
  meanExpiresSecond: number;
  secondsProgression: number;
  confirmed: boolean;
  rejectReason: string | null;
  evidences: HypothesisEvidence[];
};

type CurrentGroupResult = {
  groupId: string;
  label: string;
  acceptedCount: number;
  firstAccepted: string | null;
  confirmedSecond: number | null;
  alertSecond: number | null;
  alertCount: number;
};

type HypothesisGroupResult = {
  groupId: string;
  label: string;
  evidenceCount: number;
  confirmed: boolean;
  confirmedSecond: number | null;
  expiresSecond: number | null;
  alertSecond: number | null;
  cluster: HypothesisCluster | null;
};

type HypothesisAlertEvent = {
  alertSecond: number;
  expiresSecond: number;
  groups: string[];
};

type VideoReport = {
  id: string;
  title: string;
  frameCount: number;
  current: {
    groups: CurrentGroupResult[];
    confirmedGroups: string[];
    missedGroups: string[];
    alertCount: number;
  };
  hypothesis: {
    groups: HypothesisGroupResult[];
    confirmedGroups: string[];
    missedGroups: string[];
    alertEvents: HypothesisAlertEvent[];
  };
};

type StaticSampleReport = {
  id: string;
  file: string;
  frameCount: number;
  evidenceCount: number;
  confirmedGroups: string[];
  alertEvents: HypothesisAlertEvent[];
};

const publicBuffExpiryDir = resolve("public/buff-expiry");
const inputRoot = resolve(process.argv[2] ?? "output/buff-expiry-six-videos-1fps");
const outputDir = resolve(process.argv[3] ?? "output/buff-expiry-hypothesis-analysis");
const feedbackImageDir = resolve(process.argv[4] ?? "output/buff-expiry-feedback-samples/images");

const ALERT_LEAD_SECONDS = 30;
const HYPOTHESIS_TOP_MATCH_LIMIT = 10;
const HYPOTHESIS_MIN_SCORE = 0.92;
const HYPOTHESIS_CLUSTER_MAX_EXPIRES_SPREAD_SECONDS = 3;
const HYPOTHESIS_CONFIRM_MIN_UNIQUE_FRAMES = 3;
const HYPOTHESIS_CONFIRM_MIN_FRAME_SPAN_SECONDS = 2;
const HYPOTHESIS_CONFIRM_MIN_COUNTDOWN_PROGRESS_SECONDS = 2;
const HYPOTHESIS_CONFIRM_MIN_AVERAGE_SCORE = 0.9;
const HYPOTHESIS_ALERT_GROUP_WINDOW_SECONDS = 30;

const POTION_RESCUE_MIN_SCORE = 0.94;
const POTION_RESCUE_MIN_SECOND_MARGIN = 0.004;
const WEAK_COUNTDOWN_MIN_SCORE = 0.92;
const WEAK_COUNTDOWN_MIN_BUFF_MARGIN = 0.01;
const WEAK_COUNTDOWN_MIN_SECOND_MARGIN = 0.008;
const WEAK_SMALL_POTION_MIN_SCORE = 0.92;

const detectorModule = await import(
  pathToFileURL(resolve("public/buff-expiry/external/src/detector/detect-buffs.js")).href
);
const normalizeModule = await import(
  pathToFileURL(resolve("public/buff-expiry/external/src/recognition/normalize.js")).href
);
const countdownModule = await import(
  pathToFileURL(resolve("public/buff-expiry/external/src/recognition/countdown-matcher.js")).href
);

const supportedGroupIds = [...SUPPORTED_BUFF_EXPIRY_BUFF_IDS];
const supportedGroupIdSet = new Set<string>(supportedGroupIds);
const countdownSamples = loadCountdownSamples();
const matcher = countdownModule.prepareInitialCountdownMatcher(countdownSamples, {
  stage1TopBuffs: 6,
});
const selectedReferenceIds = getBuffExpiryReferenceIdsForSelection([...SUPPORTED_BUFF_EXPIRY_BUFF_IDS]);

const videos = loadInputVideos(inputRoot);
const videoReports = videos.map((video) => analyzeVideo(video));
const staticSampleReports = analyzeFeedbackSamples(feedbackImageDir);

mkdirSync(outputDir, { recursive: true });
writeFileSync(
  join(outputDir, "buff-expiry-hypothesis-report.json"),
  `${JSON.stringify({ inputRoot, feedbackImageDir, videoReports, staticSampleReports }, null, 2)}\n`,
);
writeFileSync(
  join(outputDir, "buff-expiry-hypothesis-report.md"),
  makeMarkdownReport(videoReports, staticSampleReports),
);

console.log(makeConsoleSummary(videoReports, staticSampleReports));
console.log(`\nReport: ${join(outputDir, "buff-expiry-hypothesis-report.md")}`);
console.log(`JSON: ${join(outputDir, "buff-expiry-hypothesis-report.json")}`);

function loadInputVideos(root: string): Array<{ id: string; title: string; frameDir: string }> {
  const rootManifestPath = join(root, "manifest.json");
  if (existsSync(rootManifestPath)) {
    const manifest = JSON.parse(readFileSync(rootManifestPath, "utf8")) as VideoRootManifest;
    if (Array.isArray(manifest.videos)) {
      return manifest.videos.map((video) => ({
        id: video.id,
        title: video.title,
        frameDir: video.frameDir,
      }));
    }
  }

  if (existsSync(join(root, "manifest.json"))) {
    return [{ id: basename(root), title: basename(root), frameDir: root }];
  }

  throw new Error(`Cannot find video manifests under ${root}`);
}

function analyzeVideo(video: { id: string; title: string; frameDir: string }): VideoReport {
  const manifestPath = join(video.frameDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const frameDetections = manifest.frames.map((frame) => detectFrame(video.frameDir, frame));
  const currentGroups = supportedGroupIds.map((groupId) => runCurrentGroupScenario(groupId, frameDetections));
  const hypothesisGroups = runHypothesisGroupScenarios(frameDetections);
  const alertEvents = makeHypothesisAlertEvents(hypothesisGroups);

  return {
    id: video.id,
    title: video.title,
    frameCount: manifest.frameCount,
    current: {
      groups: currentGroups,
      confirmedGroups: currentGroups.filter((group) => group.confirmedSecond !== null).map((group) => group.groupId),
      missedGroups: currentGroups.filter((group) => group.confirmedSecond === null).map((group) => group.groupId),
      alertCount: currentGroups.reduce((sum, group) => sum + group.alertCount, 0),
    },
    hypothesis: {
      groups: hypothesisGroups,
      confirmedGroups: hypothesisGroups.filter((group) => group.confirmed).map((group) => group.groupId),
      missedGroups: hypothesisGroups.filter((group) => !group.confirmed).map((group) => group.groupId),
      alertEvents,
    },
  };
}

function analyzeFeedbackSamples(directory: string): StaticSampleReport[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((file) => file.endsWith("-full.png"))
    .sort()
    .map((file) => {
      const id = file.replace(/-full\.png$/, "");
      const imagePath = join(directory, file);
      const png = PNG.sync.read(readFileSync(imagePath));
      const frame = {
        index: 0,
        second: 0,
        file,
        width: png.width,
        height: png.height,
      };
      const detection = detectPngFrame(png, frame);
      const groups = runHypothesisGroupScenarios([detection]);
      return {
        id,
        file,
        frameCount: 1,
        evidenceCount: detection.hypothesisEvidences.length,
        confirmedGroups: groups.filter((group) => group.confirmed).map((group) => group.groupId),
        alertEvents: makeHypothesisAlertEvents(groups),
      };
    });
}

function detectFrame(frameDir: string, frame: Manifest["frames"][number]): FrameDetection {
  return detectPngFrame(PNG.sync.read(readFileSync(join(frameDir, frame.file))), frame);
}

function detectPngFrame(png: PNG, frame: Manifest["frames"][number]): FrameDetection {
  const { calibration, roi } = getBuffExpiryCaptureRoi(png.width, png.height);
  if (calibration.unsupportedReason) {
    return {
      index: frame.index,
      second: frame.second,
      file: frame.file,
      boxes: [],
      acceptedMatches: [],
      hypothesisMatches: [],
      hypothesisEvidences: [],
      unsupportedReason: calibration.unsupportedReason,
    };
  }

  const imageData = cropPng(png, roi);
  const detection = detectorModule.detectBuffs(imageData, {
    fallbackSides: calibration.sideCandidates,
    forceFallbackSides: true,
    roiStartXRatio: 0,
    roiEndYRatio: 1,
  });
  const detectedItems = detection.boxes.map((box: Record<string, unknown>) => ({
    box,
    normalizedIcon: normalizeModule.normalizeDetectedBuffCrop(imageData, box).normalizedIcon,
  }));
  const ranked = countdownModule.rankInitialCountdownMatches(
    detectedItems,
    matcher,
    { topN: HYPOTHESIS_TOP_MATCH_LIMIT },
  ) as RankedCountdownItem[];
  const acceptedMatches = dedupeAcceptedMatchesByTrackingId(ranked
    .map((item) => ({ item, acceptedReference: resolveAcceptedCountdownReference(item) }))
    .filter(({ acceptedReference }) => acceptedReference !== null)
    .map(({ item, acceptedReference }) =>
      serializeAcceptedMatch(
        item,
        roi,
        acceptedReference?.reference ?? null,
        acceptedReference?.reason,
        acceptedReference?.strength,
      ),
    ));

  const hypothesisEvidences = makeHypothesisEvidences(ranked, roi, frame.second);

  return {
    index: frame.index,
    second: frame.second,
    file: frame.file,
    boxes: detection.boxes.map((box: Record<string, unknown>) => serializeBox(box, roi)),
    acceptedMatches,
    hypothesisMatches: hypothesisEvidences.map((evidence) => serializeHypothesisEvidenceMatch(evidence)),
    hypothesisEvidences,
    unsupportedReason: detection.unsupportedReason ?? null,
  };
}

function makeHypothesisEvidences(
  rankedItems: RankedCountdownItem[],
  roi: { x: number; y: number },
  frameSecond: number,
): HypothesisEvidence[] {
  const bestByFrameBoxGroup = new Map<string, HypothesisEvidence>();
  for (const item of rankedItems) {
    const box = serializeBox(item.box, roi);
    item.countdownTopMatches.slice(0, HYPOTHESIS_TOP_MATCH_LIMIT).forEach((match, matchIndex) => {
      if (typeof match.seconds !== "number" || match.score < HYPOTHESIS_MIN_SCORE) {
        return;
      }
      const groupId = getBuffExpiryTrackingId(match.buffId);
      if (
        !supportedGroupIdSet.has(groupId) ||
        !selectedReferenceIds.has(match.buffId)
      ) {
        return;
      }
      const evidence: HypothesisEvidence = {
        frameSecond,
        groupId,
        groupLabel: getBuffLabel(groupId),
        sourceBuffId: match.buffId,
        sourceName: match.name,
        seconds: match.seconds,
        score: match.score,
        rank: matchIndex + 1,
        expiresSecond: frameSecond + match.seconds,
        box,
      };
      const key = [
        frameSecond,
        groupId,
        Math.round(evidence.expiresSecond),
        Math.round(box.x),
        Math.round(box.y),
      ].join(":");
      const previous = bestByFrameBoxGroup.get(key);
      if (!previous || isBetterHypothesisEvidence(evidence, previous)) {
        bestByFrameBoxGroup.set(key, evidence);
      }
    });
  }
  return [...bestByFrameBoxGroup.values()];
}

function runCurrentGroupScenario(groupId: string, frames: FrameDetection[]): CurrentGroupResult {
  let tracks: BuffExpiryTrackedBuff[] = [];
  let pendingTracks: BuffExpiryPendingTrack[] = [];
  let confirmedSecond: number | null = null;
  let alertSecond: number | null = null;
  let alertCount = 0;
  const acceptedFrames: Array<{ second: number; seconds: number; score: number }> = [];

  for (const frame of frames) {
    const now = frame.second * 1000;
    const acceptedMatches = selectBuffExpiryRuntimeMatches({
      acceptedMatches: frame.acceptedMatches.filter((match) => match.buffId === groupId),
      hypothesisMatches: frame.hypothesisMatches.filter((match) => match.buffId === groupId),
      previousTracks: tracks,
      previousPendingTracks: pendingTracks,
      now,
    });
    acceptedFrames.push(...acceptedMatches.map((match) => ({
      second: frame.second,
      seconds: match.seconds,
      score: match.score,
    })));
    const previousHadTracks = tracks.length > 0;
    const reconciled = reconcileBuffExpiryTracks({
      previousTracks: tracks,
      previousPendingTracks: pendingTracks,
      acceptedMatches,
      boxes: frame.boxes,
      now,
    });
    if (!previousHadTracks && reconciled.tracks.length > 0 && confirmedSecond === null) {
      confirmedSecond = frame.second;
    }

    const alertUpdate = markDueBuffExpiryTracksAlerted({
      tracks: reconciled.tracks,
      now,
      alertLeadSeconds: ALERT_LEAD_SECONDS,
    });
    if (alertUpdate.shouldAlert) {
      alertCount += 1;
      alertSecond ??= frame.second;
    }
    tracks = alertUpdate.tracks;
    pendingTracks = reconciled.pendingTracks;
  }

  return {
    groupId,
    label: getBuffLabel(groupId),
    acceptedCount: acceptedFrames.length,
    firstAccepted: acceptedFrames[0] ? `${acceptedFrames[0].second}s:${acceptedFrames[0].seconds}s` : null,
    confirmedSecond,
    alertSecond,
    alertCount,
  };
}

function runHypothesisGroupScenarios(frames: FrameDetection[]): HypothesisGroupResult[] {
  const evidences = frames.flatMap((frame) => frame.hypothesisEvidences);
  const clusters = clusterHypothesisEvidences(evidences);
  return supportedGroupIds.map((groupId) => {
    const groupEvidenceCount = evidences.filter((evidence) => evidence.groupId === groupId).length;
    const groupClusters = clusters
      .filter((cluster) => cluster.groupId === groupId)
      .sort((a, b) => clusterScore(b) - clusterScore(a));
    const confirmedCluster = groupClusters.find((cluster) => cluster.confirmed) ?? null;
    const fallbackCluster = groupClusters[0] ?? null;
    const cluster = confirmedCluster ?? fallbackCluster;
    return {
      groupId,
      label: getBuffLabel(groupId),
      evidenceCount: groupEvidenceCount,
      confirmed: confirmedCluster !== null,
      confirmedSecond: confirmedCluster?.lastFrameSecond ?? null,
      expiresSecond: confirmedCluster ? Math.round(confirmedCluster.meanExpiresSecond) : null,
      alertSecond: confirmedCluster ? Math.max(0, Math.ceil(confirmedCluster.meanExpiresSecond - ALERT_LEAD_SECONDS)) : null,
      cluster,
    };
  });
}

function clusterHypothesisEvidences(evidences: HypothesisEvidence[]): HypothesisCluster[] {
  const byGroup = new Map<string, HypothesisEvidence[]>();
  for (const evidence of evidences) {
    byGroup.set(evidence.groupId, [...(byGroup.get(evidence.groupId) ?? []), evidence]);
  }

  return [...byGroup.entries()].flatMap(([groupId, groupEvidences]) => {
    const sorted = [...groupEvidences].sort((a, b) => a.expiresSecond - b.expiresSecond || b.score - a.score);
    const clusters = new Map<string, HypothesisEvidence[]>();
    for (let startIndex = 0; startIndex < sorted.length; startIndex += 1) {
      const start = sorted[startIndex];
      const endExpiresSecond = start.expiresSecond + HYPOTHESIS_CLUSTER_MAX_EXPIRES_SPREAD_SECONDS;
      const window = sorted.filter((evidence) =>
        evidence.expiresSecond >= start.expiresSecond &&
        evidence.expiresSecond <= endExpiresSecond
      );
      if (window.length === 0) {
        continue;
      }
      const key = window
        .map((evidence) => [
          evidence.frameSecond,
          evidence.groupId,
          evidence.seconds,
          round(evidence.expiresSecond),
          round(evidence.score),
        ].join(":"))
        .join("|");
      clusters.set(key, window);
    }

    return [...clusters.values()].map((cluster) => makeHypothesisCluster(groupId, cluster));
  });
}

function makeHypothesisCluster(groupId: string, evidences: HypothesisEvidence[]): HypothesisCluster {
  const deduped = dedupeEvidenceByFrame(evidences).sort((a, b) => a.frameSecond - b.frameSecond || b.score - a.score);
  const frameSeconds = [...new Set(deduped.map((evidence) => evidence.frameSecond))].sort((a, b) => a - b);
  const expiresSeconds = deduped.map((evidence) => evidence.expiresSecond);
  const first = deduped[0];
  const latest = deduped[deduped.length - 1];
  const firstFrameSecond = frameSeconds[0] ?? 0;
  const lastFrameSecond = frameSeconds[frameSeconds.length - 1] ?? firstFrameSecond;
  const averageScore = deduped.reduce((sum, evidence) => sum + evidence.score, 0) / Math.max(1, deduped.length);
  const minExpiresSecond = Math.min(...expiresSeconds);
  const maxExpiresSecond = Math.max(...expiresSeconds);
  const meanExpiresSecond = getMeanExpiresSecond(deduped);
  const secondsProgression = first && latest ? first.seconds - latest.seconds : 0;
  const rejectReason = getHypothesisRejectReason({
    evidenceCount: deduped.length,
    uniqueFrameCount: frameSeconds.length,
    frameSpan: lastFrameSecond - firstFrameSecond,
    secondsProgression,
    expiresSpread: maxExpiresSecond - minExpiresSecond,
    averageScore,
  });

  return {
    groupId,
    groupLabel: getBuffLabel(groupId),
    evidenceCount: deduped.length,
    uniqueFrameCount: frameSeconds.length,
    firstFrameSecond,
    lastFrameSecond,
    averageScore: round(averageScore),
    minExpiresSecond,
    maxExpiresSecond,
    meanExpiresSecond: round(meanExpiresSecond),
    secondsProgression,
    confirmed: rejectReason === null,
    rejectReason,
    evidences: deduped,
  };
}

function getHypothesisRejectReason({
  evidenceCount,
  uniqueFrameCount,
  frameSpan,
  secondsProgression,
  expiresSpread,
  averageScore,
}: {
  evidenceCount: number;
  uniqueFrameCount: number;
  frameSpan: number;
  secondsProgression: number;
  expiresSpread: number;
  averageScore: number;
}): string | null {
  if (evidenceCount < HYPOTHESIS_CONFIRM_MIN_UNIQUE_FRAMES) {
    return "not-enough-evidence";
  }
  if (uniqueFrameCount < HYPOTHESIS_CONFIRM_MIN_UNIQUE_FRAMES) {
    return "not-enough-frames";
  }
  if (frameSpan < HYPOTHESIS_CONFIRM_MIN_FRAME_SPAN_SECONDS) {
    return "too-short-frame-span";
  }
  if (secondsProgression < HYPOTHESIS_CONFIRM_MIN_COUNTDOWN_PROGRESS_SECONDS) {
    return "countdown-not-progressing";
  }
  if (expiresSpread > HYPOTHESIS_CLUSTER_MAX_EXPIRES_SPREAD_SECONDS) {
    return "expires-spread-too-wide";
  }
  if (averageScore < HYPOTHESIS_CONFIRM_MIN_AVERAGE_SCORE) {
    return "average-score-too-low";
  }
  return null;
}

function makeHypothesisAlertEvents(groups: HypothesisGroupResult[]): HypothesisAlertEvent[] {
  const confirmed = groups
    .filter((group) => group.confirmed && group.expiresSecond !== null)
    .sort((a, b) => (a.expiresSecond ?? 0) - (b.expiresSecond ?? 0));
  const alertGroups: HypothesisGroupResult[][] = [];
  for (const group of confirmed) {
    const target = alertGroups.find((items) => {
      const mean = items.reduce((sum, item) => sum + (item.expiresSecond ?? 0), 0) / items.length;
      return Math.abs(mean - (group.expiresSecond ?? 0)) <= HYPOTHESIS_ALERT_GROUP_WINDOW_SECONDS;
    });
    if (target) {
      target.push(group);
    } else {
      alertGroups.push([group]);
    }
  }

  return alertGroups.map((items) => {
    const expiresSecond = Math.round(
      items.reduce((sum, item) => sum + (item.expiresSecond ?? 0), 0) / items.length,
    );
    return {
      alertSecond: Math.max(0, expiresSecond - ALERT_LEAD_SECONDS),
      expiresSecond,
      groups: items.map((item) => item.groupId),
    };
  });
}

function dedupeEvidenceByFrame(evidences: HypothesisEvidence[]): HypothesisEvidence[] {
  const bestByFrame = new Map<number, HypothesisEvidence>();
  for (const evidence of evidences) {
    const previous = bestByFrame.get(evidence.frameSecond);
    if (!previous || isBetterHypothesisEvidence(evidence, previous)) {
      bestByFrame.set(evidence.frameSecond, evidence);
    }
  }
  return [...bestByFrame.values()];
}

function isBetterHypothesisEvidence(candidate: HypothesisEvidence, previous: HypothesisEvidence): boolean {
  return (
    candidate.score > previous.score ||
    (candidate.score === previous.score && candidate.rank < previous.rank)
  );
}

function getMeanExpiresSecond(evidences: HypothesisEvidence[]): number {
  const totalWeight = evidences.reduce((sum, evidence) => sum + evidence.score, 0);
  if (totalWeight <= 0) {
    return evidences.reduce((sum, evidence) => sum + evidence.expiresSecond, 0) / Math.max(1, evidences.length);
  }
  return evidences.reduce((sum, evidence) => sum + evidence.expiresSecond * evidence.score, 0) / totalWeight;
}

function clusterScore(cluster: HypothesisCluster): number {
  return (
    cluster.evidenceCount * 100 +
    cluster.uniqueFrameCount * 20 +
    cluster.averageScore * 10 -
    (cluster.maxExpiresSecond - cluster.minExpiresSecond) * 5
  );
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

function cropPng(
  png: PNG,
  region: { x: number; y: number; width: number; height: number },
): ImageDataLike {
  const data = new Uint8ClampedArray(region.width * region.height * 4);
  for (let y = 0; y < region.height; y += 1) {
    const sourceStart = ((region.y + y) * png.width + region.x) * 4;
    const sourceEnd = sourceStart + region.width * 4;
    data.set(png.data.subarray(sourceStart, sourceEnd), y * region.width * 4);
  }
  return { width: region.width, height: region.height, data };
}

function serializeAcceptedMatch(
  item: RankedCountdownItem,
  roi: { x: number; y: number },
  reference: CountdownSample | null = item.countdownMatch,
  reason = item.countdownStatus.reason,
  strength: "strong" | "weak" = "strong",
): BuffExpiryAcceptedMatch {
  if (!reference) {
    throw new Error("Accepted countdown match is missing a reference.");
  }
  const groupId = getBuffExpiryTrackingId(reference.buffId);
  return {
    box: serializeBox(item.box, roi),
    buffId: groupId,
    name: getBuffLabel(groupId),
    seconds: reference.seconds,
    score: item.countdownStatus.score,
    buffMargin: item.countdownStatus.buffMargin,
    secondMargin: item.countdownStatus.secondMargin,
    reason,
    strength,
    topMatches: item.countdownTopMatches,
  };
}

function serializeHypothesisEvidenceMatch(evidence: HypothesisEvidence): BuffExpiryAcceptedMatch {
  return {
    box: evidence.box,
    buffId: evidence.groupId,
    name: evidence.groupLabel,
    seconds: evidence.seconds,
    score: evidence.score,
    buffMargin: 0,
    secondMargin: 0,
    reason: "hypothesis-top-match",
    strength: "weak",
    topMatches: [],
  };
}

function resolveAcceptedCountdownReference(
  item: RankedCountdownItem,
): { reference: CountdownSample; reason: string; strength: "strong" | "weak" } | null {
  if (item.countdownMatch && item.countdownStatus.accepted && item.countdownStatus.secondsAccepted) {
    return {
      reference: item.countdownMatch,
      reason: item.countdownStatus.reason,
      strength: "strong",
    };
  }

  if (isPotionRescueAccepted(item) && item.countdownCandidate) {
    return {
      reference: item.countdownCandidate,
      reason: "potion-rescue",
      strength: "strong",
    };
  }

  if (isWeakCountdownCandidate(item) && item.countdownCandidate) {
    return {
      reference: item.countdownCandidate,
      reason: "weak-countdown",
      strength: "weak",
    };
  }

  return null;
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
  const hasStableBuffMatch =
    status.buffMargin >= WEAK_COUNTDOWN_MIN_BUFF_MARGIN ||
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

function dedupeAcceptedMatchesByTrackingId(matches: BuffExpiryAcceptedMatch[]): BuffExpiryAcceptedMatch[] {
  const byBuffId = new Map<string, BuffExpiryAcceptedMatch>();
  for (const match of matches) {
    const previous = byBuffId.get(match.buffId);
    if (
      !previous ||
      match.score > previous.score ||
      (match.score === previous.score && match.secondMargin > previous.secondMargin)
    ) {
      byBuffId.set(match.buffId, match);
    }
  }
  return [...byBuffId.values()];
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

function makeConsoleSummary(videoReports: VideoReport[], staticReports: StaticSampleReport[]): string {
  const lines = [
    "video | current confirmed | hypothesis confirmed | current missed | hypothesis missed | hypothesis alerts",
    "---|---:|---:|---|---|---",
    ...videoReports.map((report) => [
      report.id,
      `${report.current.confirmedGroups.length}/6`,
      `${report.hypothesis.confirmedGroups.length}/6`,
      formatGroupList(report.current.missedGroups),
      formatGroupList(report.hypothesis.missedGroups),
      report.hypothesis.alertEvents.map((event) => `${event.alertSecond}s(${event.groups.length})`).join(", ") || "-",
    ].join(" | ")),
    "",
    `static feedback: ${staticReports.length} sample(s), confirmed=${staticReports.reduce((sum, item) => sum + item.confirmedGroups.length, 0)}, alerts=${staticReports.reduce((sum, item) => sum + item.alertEvents.length, 0)}`,
  ];
  return lines.join("\n");
}

function makeMarkdownReport(videoReports: VideoReport[], staticReports: StaticSampleReport[]): string {
  return [
    "# Buff Expiry Hypothesis Analysis",
    "",
    `- Input root: \`${inputRoot}\``,
    `- Feedback image dir: \`${feedbackImageDir}\``,
    `- Hypothesis: top-${HYPOTHESIS_TOP_MATCH_LIMIT}, min score ${HYPOTHESIS_MIN_SCORE}, expires spread <= ${HYPOTHESIS_CLUSTER_MAX_EXPIRES_SPREAD_SECONDS}s`,
    "",
    "## Summary",
    "",
    "| 영상 | 현재 runtime 확정 | Hypothesis 확정 | 현재 runtime 미검출 | Hypothesis 미검출 | Hypothesis 알림 |",
    "|---|---:|---:|---|---|---|",
    ...videoReports.map((report) =>
      [
        report.title,
        `${report.current.confirmedGroups.length}/6`,
        `${report.hypothesis.confirmedGroups.length}/6`,
        formatGroupList(report.current.missedGroups),
        formatGroupList(report.hypothesis.missedGroups),
        report.hypothesis.alertEvents
          .map((event) => `${event.alertSecond}s / expires ${event.expiresSecond}s / ${event.groups.map(getShortBuffLabel).join(", ")}`)
          .join("<br>") || "-",
      ].join(" | "),
    ).map((row) => `| ${row} |`),
    "",
    "## Per Video Details",
    "",
    ...videoReports.flatMap((report) => [
      `### ${report.title}`,
      "",
      "| 그룹 | Runtime evidence | Runtime 확정 | Runtime 알림 | Hyp evidence | Hyp 확정 | Hyp 종료시각 | Hyp 알림 | Reject/관측 |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---|",
      ...supportedGroupIds.map((groupId) => {
        const current = report.current.groups.find((group) => group.groupId === groupId);
        const hypothesis = report.hypothesis.groups.find((group) => group.groupId === groupId);
        return `| ${getBuffLabel(groupId)} | ${current?.acceptedCount ?? 0} | ${formatMaybeSecond(current?.confirmedSecond ?? null)} | ${formatMaybeSecond(current?.alertSecond ?? null)} | ${hypothesis?.evidenceCount ?? 0} | ${formatMaybeSecond(hypothesis?.confirmedSecond ?? null)} | ${formatMaybeSecond(hypothesis?.expiresSecond ?? null)} | ${formatMaybeSecond(hypothesis?.alertSecond ?? null)} | ${formatHypothesisCluster(hypothesis?.cluster ?? null)} |`;
      }),
      "",
    ]),
    "## Static Feedback Samples",
    "",
    staticReports.length
      ? [
          "| 샘플 | evidence | 확정 | 알림 |",
          "|---|---:|---|---|",
          ...staticReports.map((sample) =>
            `| ${sample.id} | ${sample.evidenceCount} | ${formatGroupList(sample.confirmedGroups)} | ${sample.alertEvents.length ? sample.alertEvents.map((event) => `${event.alertSecond}s`).join(", ") : "-"} |`,
          ),
        ].join("\n")
      : "샘플 없음",
    "",
  ].join("\n");
}

function formatHypothesisCluster(cluster: HypothesisCluster | null): string {
  if (!cluster) {
    return "-";
  }
  const evidence = cluster.evidences
    .slice(0, 5)
    .map((item) => `${item.frameSecond}s:${item.seconds}s@${item.score.toFixed(3)}#${item.rank}`)
    .join(" -> ");
  return [
    cluster.confirmed ? "confirmed" : cluster.rejectReason,
    `avg=${cluster.averageScore}`,
    `spread=${cluster.minExpiresSecond}-${cluster.maxExpiresSecond}`,
    evidence,
  ].filter(Boolean).join(" / ");
}

function formatGroupList(groupIds: string[]): string {
  return groupIds.length ? groupIds.map(getShortBuffLabel).join(", ") : "-";
}

function formatMaybeSecond(value: number | null): string {
  return value === null ? "-" : `${value}s`;
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
