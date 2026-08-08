import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import {
  BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
  getBuffExpiryCatalogItem,
  getBuffExpiryReferenceIdsForSelection,
  getBuffExpiryTrackingId,
  isSmallPotionBuffExpiryReference,
  SUPPORTED_BUFF_EXPIRY_BUFF_IDS,
} from "../src/lib/buffExpiry/buffExpiryCatalog";
import { getBuffExpiryCaptureRoi, getBuffExpiryFrameCalibration } from "../src/lib/buffExpiry/buffExpiryCalibration";

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
  countdownTopMatches: Array<{
    buffId: string;
    name: string;
    kind: string;
    seconds: number | null;
    file: string | null;
    score: number;
    distance: number;
    timerPixels: number;
    digitPixels: number;
  }>;
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

type Manifest = {
  sourceWidth?: number;
  sourceHeight?: number;
  captureRoi?: { x: number; y: number; width: number; height: number };
  frames: Array<{ second: number; file: string; width: number; height: number }>;
};

const publicBuffExpiryDir = resolve("public/buff-expiry");
const outputDir = resolve(process.env.BUFF_EXPIRY_INSPECT_OUTPUT_DIR ?? "/tmp/maple-buff-expiry-inspect");
const selectedBuffIds = readSelectedBuffIds();
const selectedReferenceIds = getBuffExpiryReferenceIdsForSelection(selectedBuffIds);
const bodyIdentityReferenceIds = getBuffExpiryReferenceIdsForSelection([...SUPPORTED_BUFF_EXPIRY_BUFF_IDS]);
const bodyIdentityTrackingIds = new Set([...bodyIdentityReferenceIds].map((referenceId) => getBuffExpiryTrackingId(referenceId)));
const targetTrackingId = process.env.BUFF_EXPIRY_INSPECT_TARGET_BUFF_ID ?? "small_wealth_exp_potion_group";
const secondFrom = Number(process.env.BUFF_EXPIRY_INSPECT_SECOND_FROM ?? "0");
const secondTo = Number(process.env.BUFF_EXPIRY_INSPECT_SECOND_TO ?? `${Number.MAX_SAFE_INTEGER}`);

const POTION_RESCUE_MIN_SCORE = 0.94;
const POTION_RESCUE_MIN_SECOND_MARGIN = 0.004;
const WEAK_COUNTDOWN_MIN_SCORE = 0.92;
const WEAK_COUNTDOWN_MIN_BUFF_MARGIN = 0.01;
const WEAK_COUNTDOWN_MIN_TRACKING_MARGIN = 0.004;
const WEAK_COUNTDOWN_MIN_SECOND_MARGIN = 0.008;
const WEAK_SMALL_POTION_MIN_SCORE = 0.92;
const COMPRESSED_SMALL_POTION_MIN_SCORE = 0.895;
const COMPRESSED_SMALL_POTION_MIN_BODY_IDENTITY_SCORE = 0.9;
const COMPRESSED_SMALL_POTION_MIN_SECOND_MARGIN = 0.008;
const GROUPED_COUNTDOWN_MIN_SCORE = 0.94;
const GROUPED_COUNTDOWN_MIN_TRACKING_MARGIN = 0.006;
const INITIAL_COUNTDOWN_STAGE1_TOP_BUFFS = 7;
const BODY_IDENTITY_MIN_SCORE = 0.895;
const BODY_IDENTITY_MIN_MARGIN = 0.012;
const BODY_IDENTITY_STRONG_SCORE = 0.94;
const TOP_EDGE_TIMER_TEXT_SCAN_ROWS = 12;
const TOP_EDGE_TIMER_TEXT_MIN_PIXELS = 8;

const frameDir = process.argv[2];
if (!frameDir) {
  throw new Error("Usage: npx tsx scripts/inspect-buff-expiry-window.ts <frame-dir>");
}

const detectorModule = await import(
  pathToFileURL(resolve("public/buff-expiry/external/src/detector/detect-buffs.js")).href
);
const normalizeModule = await import(
  pathToFileURL(resolve("public/buff-expiry/external/src/recognition/normalize.js")).href
);
const countdownModule = await import(
  pathToFileURL(resolve("public/buff-expiry/external/src/recognition/countdown-matcher.js")).href
);
const countdownSamples = loadCountdownSamples();
const countdownSampleByFile = new Map(countdownSamples.map((sample) => [sample.file, sample]));
const matcher = countdownModule.prepareInitialCountdownMatcher(countdownSamples, {
  stage1TopBuffs: INITIAL_COUNTDOWN_STAGE1_TOP_BUFFS,
});
const bodyIdentityPrototypes = buildBodyIdentityPrototypes(countdownSamples);
const manifest = JSON.parse(readFileSync(join(frameDir, "manifest.json"), "utf8")) as Manifest;

mkdirSync(outputDir, { recursive: true });
const rows: string[] = [
  [
    "second",
    "box",
    "candidate",
    "candidateSeconds",
    "score",
    "statusReason",
    "buffMargin",
    "secondMargin",
    "trackingMargin",
    "identityScore",
    "identityMargin",
    "identityAccepted",
    "identityConfident",
    "acceptedReason",
    "rejectSummary",
    "topMatches",
    "detectedIcon",
    "referenceIcon",
  ].join(","),
];

for (const frame of manifest.frames) {
  if (frame.second < secondFrom || frame.second > secondTo) {
    continue;
  }
  inspectFrame(frame);
}

writeFileSync(join(outputDir, "buff-expiry-match-inspection.csv"), `${rows.join("\n")}\n`);
console.log(`Wrote ${rows.length - 1} rows to ${join(outputDir, "buff-expiry-match-inspection.csv")}`);

function inspectFrame(frame: Manifest["frames"][number]): void {
  const png = PNG.sync.read(readFileSync(resolveFramePath(frame.file)));
  const { imageData, roi, sideCandidates } = getFrameImageData(png);
  const detection = detectorModule.detectBuffs(imageData, {
    detectorMode: "v3",
    fallbackSides: sideCandidates,
    forceFallbackSides: true,
    roiStartXRatio: 0,
    roiEndYRatio: 1,
  });
  const detectedItems = detection.boxes.map((box: Record<string, unknown>) => ({
    box,
    normalizedIcon: normalizeModule.normalizeDetectedBuffCrop(imageData, box).normalizedIcon as ImageDataLike,
  }));
  const ranked = countdownModule.rankInitialCountdownMatches(detectedItems, matcher, { topN: 10 }) as RankedCountdownItem[];

  ranked.forEach((item, index) => {
    const targetTopMatches = item.countdownTopMatches.filter(
      (match) => match.seconds !== null && getBuffExpiryTrackingId(match.buffId) === targetTrackingId,
    );
    const candidateTrackingId = item.countdownCandidate
      ? getBuffExpiryTrackingId(item.countdownCandidate.buffId)
      : null;
    if (candidateTrackingId !== targetTrackingId && targetTopMatches.length === 0) {
      return;
    }

    const bodyIdentities = resolveBodyIdentityMatches(item.normalizedIcon, bodyIdentityPrototypes);
    const identity = bodyIdentities.get(targetTrackingId) ?? null;
    const acceptedReference =
      resolveIdentityBackedAcceptedCountdownReference(item, bodyIdentities) ??
      resolveAcceptedCountdownReference(item);
    const detectedIconPath = join("icons", `${String(frame.second).padStart(4, "0")}s_box${index}_detected.png`);
    mkdirSync(join(outputDir, "icons"), { recursive: true });
    writePngImageData(join(outputDir, detectedIconPath), item.normalizedIcon);

    const referenceSample = findReferenceSample(item);
    const referenceIconPath = referenceSample
      ? join("icons", `${String(frame.second).padStart(4, "0")}s_box${index}_ref_${sanitize(referenceSample.buffId)}_${referenceSample.seconds}s.png`)
      : "";
    if (referenceSample && referenceIconPath) {
      writePngImageData(join(outputDir, referenceIconPath), referenceSample.normalizedIcon);
    }

    rows.push([
      frame.second,
      JSON.stringify(serializeBox(item.box, roi)),
      candidateTrackingId ?? "",
      item.countdownCandidate?.seconds ?? "",
      round(item.countdownStatus.score),
      item.countdownStatus.reason,
      round(item.countdownStatus.buffMargin),
      round(item.countdownStatus.secondMargin),
      round(getTrackingGroupMargin(item)),
      identity ? round(identity.score) : "",
      identity ? round(identity.margin) : "",
      identity?.accepted ?? "",
      identity ? isBodyIdentityConfident(bodyIdentities, targetTrackingId) : "",
      acceptedReference ? `${acceptedReference.reason}:${acceptedReference.strength}` : "",
      getRejectSummary(item, acceptedReference, bodyIdentities),
      JSON.stringify(item.countdownTopMatches.slice(0, 5).map((match) => ({
        buffId: getBuffExpiryTrackingId(match.buffId),
        seconds: match.seconds,
        score: round(match.score),
      }))),
      detectedIconPath,
      referenceIconPath,
    ].map(csvCell).join(","));
  });
}

function getFrameImageData(png: PNG): { imageData: ImageDataLike; roi: { x: number; y: number }; sideCandidates: number[] } {
  if (manifest.captureRoi && manifest.sourceWidth && manifest.sourceHeight) {
    const calibration = getBuffExpiryFrameCalibration(manifest.sourceWidth, manifest.sourceHeight);
    if (calibration.unsupportedReason) {
      throw new Error(calibration.unsupportedReason);
    }
    return {
      imageData: cropPng(png, { x: 0, y: 0, width: png.width, height: png.height }),
      roi: manifest.captureRoi,
      sideCandidates: calibration.sideCandidates,
    };
  }

  const { calibration, roi } = getBuffExpiryCaptureRoi(png.width, png.height);
  if (calibration.unsupportedReason) {
    throw new Error(calibration.unsupportedReason);
  }
  return {
    imageData: cropPng(png, roi),
    roi,
    sideCandidates: calibration.sideCandidates,
  };
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
  bodyIdentities: Map<string, BodyIdentityMatch>,
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
  if (candidate.seconds < 31 || candidate.seconds > 59) {
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

function findConfidentSelectedSmallPotionIdentity(
  bodyIdentities: Map<string, BodyIdentityMatch>,
): BodyIdentityMatch | null {
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

function getRejectSummary(
  item: RankedCountdownItem,
  acceptedReference: ReturnType<typeof resolveAcceptedCountdownReference>,
  bodyIdentities: Map<string, BodyIdentityMatch>,
): string {
  if (acceptedReference && !selectedReferenceIds.has(acceptedReference.reference.buffId)) {
    return "unselected-buff";
  }
  if (!item.countdownCandidate) {
    return "no-countdown-candidate";
  }
  const trackingId = getBuffExpiryTrackingId(item.countdownCandidate.buffId);
  const identity = bodyIdentities.get(trackingId);
  const reasons = [];
  if (item.countdownStatus.score < WEAK_COUNTDOWN_MIN_SCORE) {
    reasons.push(`score<${WEAK_COUNTDOWN_MIN_SCORE}`);
  }
  if (item.countdownStatus.secondMargin < WEAK_COUNTDOWN_MIN_SECOND_MARGIN) {
    reasons.push(`secondMargin<${WEAK_COUNTDOWN_MIN_SECOND_MARGIN}`);
  }
  if (!identity?.accepted) {
    reasons.push("identity-rejected");
  } else if (!isBodyIdentityConfident(bodyIdentities, trackingId)) {
    reasons.push("identity-not-confident");
  }
  return reasons.join(";") || "accepted-or-other";
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
  return (bestSameGroup?.score ?? item.countdownStatus.score) - (bestDifferentGroup?.score ?? 0);
}

function resolveBodyIdentityMatches(
  detectedIcon: ImageDataLike,
  prototypes: BodyIdentityPrototype[],
): Map<string, BodyIdentityMatch> {
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
  const result = new Map<string, BodyIdentityMatch>();
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

function isBodyIdentityConfident(bodyIdentities: Map<string, BodyIdentityMatch>, trackingId: string): boolean {
  const identity = bodyIdentities.get(trackingId);
  return (
    identity?.accepted === true &&
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

function makeAverageImageData(images: ImageDataLike[]): ImageDataLike {
  const first = images[0];
  if (!first) {
    throw new Error("Cannot average empty image set.");
  }
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

function findReferenceSample(item: RankedCountdownItem): CountdownSample | null {
  const top = item.countdownTopMatches.find(
    (match) => getBuffExpiryTrackingId(match.buffId) === targetTrackingId && match.file !== null,
  );
  if (!top?.file) {
    return null;
  }
  return countdownSampleByFile.get(top.file) ??
    countdownSamples.find(
      (sample) => sample.buffId === top.buffId && sample.seconds === top.seconds,
    ) ??
    null;
}

function serializeBox(box: Record<string, unknown>, roi: { x: number; y: number }) {
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

function resolveFramePath(frameFile: string): string {
  const directPath = join(frameDir, frameFile);
  if (existsSync(directPath)) {
    return directPath;
  }
  const basenamePath = join(frameDir, basename(frameFile));
  if (existsSync(basenamePath)) {
    return basenamePath;
  }
  return resolve(frameFile);
}

function cropPng(png: PNG, region: { x: number; y: number; width: number; height: number }): ImageDataLike {
  const data = new Uint8ClampedArray(region.width * region.height * 4);
  for (let y = 0; y < region.height; y += 1) {
    const sourceStart = ((region.y + y) * png.width + region.x) * 4;
    data.set(png.data.subarray(sourceStart, sourceStart + region.width * 4), y * region.width * 4);
  }
  return { width: region.width, height: region.height, data };
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

function readSelectedBuffIds(): string[] {
  const raw = process.env.BUFF_EXPIRY_INSPECT_SELECTED_BUFF_IDS;
  if (!raw) {
    return [...SUPPORTED_BUFF_EXPIRY_BUFF_IDS];
  }
  const supportedIds = new Set<string>(SUPPORTED_BUFF_EXPIRY_BUFF_IDS);
  const selected = [...new Set(raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => getBuffExpiryTrackingId(value)))]
    .filter((value) => supportedIds.has(value));
  if (!selected.length) {
    throw new Error(`No supported buff ids in BUFF_EXPIRY_INSPECT_SELECTED_BUFF_IDS=${raw}`);
  }
  return selected;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function csvCell(value: unknown): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function sanitize(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-");
}
