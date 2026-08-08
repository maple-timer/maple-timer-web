import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { getBuffExpiryFrameCalibration } from "../buffExpiry/buffExpiryCalibration";
import {
  getBuffExpiryReferenceIdsForSelection,
  getBuffExpiryTrackingId,
  SUPPORTED_BUFF_EXPIRY_BUFF_IDS,
} from "../buffExpiry/buffExpiryCatalog";

type RuntimeTraceFrame = {
  sampledAt: number;
  rejectedMatches?: RejectedTraceMatch[];
};

type RejectedTraceMatch = {
  candidateBuffId?: string | null;
  candidateSeconds?: number | null;
  score?: number;
  reason?: string;
  box?: TemporalBox | null;
};

type TemporalBox = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

type TemporalObservation = {
  sampledAt: number;
  key: string;
  buffId: string;
  seconds: number;
  score: number;
};

type TemporalWindow = {
  key: string;
  buffId: string;
  count: number;
  spanSeconds: number;
  predictedExpirySpreadSeconds: number;
  secondDrop: number;
  averageScore: number;
  fromSeconds: number;
  toSeconds: number;
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

type DetectorModule = {
  detectBuffs: (
    imageData: ImageDataLike,
    options?: Record<string, unknown>,
  ) => { boxes: Array<Record<string, unknown>>; unsupportedReason?: string | null };
};

type NormalizeModule = {
  normalizeDetectedBuffCrop: (
    imageData: ImageDataLike,
    box: Record<string, unknown>,
  ) => { normalizedIcon: ImageDataLike };
};

type CountdownModule = {
  prepareInitialCountdownMatcher: (samples: CountdownSample[], options?: Record<string, unknown>) => unknown;
  rankInitialCountdownMatches: (
    items: Array<{ box: Record<string, unknown>; normalizedIcon: ImageDataLike }>,
    matcher: unknown,
    options?: Record<string, unknown>,
  ) => Array<{
    box: Record<string, unknown>;
    countdownCandidate: CountdownSample | null;
    countdownStatus: {
      score: number;
      reason: string;
    };
  }>;
};

type VideoManifest = {
  sourceWidth?: number;
  sourceHeight?: number;
  captureRoi?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  frames: Array<{
    second: number;
    file: string;
  }>;
};

const RESOURCE_ROOT = resolve(process.cwd(), "debug-samples/test-resources/buff-expiry");
const RUNTIME_REPORTS_DIR = join(RESOURCE_ROOT, "runtime-trace/feedback/reports");
const YOUTUBE_SAMPLE_DIR = resolve(process.cwd(), "debug-samples/test-resources/buff-expiry/video/youtube/fT7HKXoWl4Q");
const LOW_SCORE_MIN = 0.88;
const LOW_SCORE_MAX = 0.92;
const MIN_TEMPORAL_SECONDS = 21;
const SELECTED_REFERENCE_IDS = getBuffExpiryReferenceIdsForSelection([...SUPPORTED_BUFF_EXPIRY_BUFF_IDS]);

const noTemporalWindowReportIds = [
  "357c2411-7666-4735-bcbd-21e8e0567567",
  "39ba7e73-4951-4a21-9522-7cb52626d4e3",
  "c4ec942b-1274-4db9-af11-b99d6afd14f3",
];

const lowScoreTemporalCases = [
  {
    reportId: "640fae37-6e6c-4542-a597-e5ed2b6342af",
    buffId: "union_wealth_group",
    minCount: 6,
    minSpanSeconds: 20,
    maxSpreadSeconds: 1,
    minAverageScore: 0.9,
  },
  {
    reportId: "642aebb7-a099-4d5d-b437-983efb79f19a",
    buffId: "union_luck_group",
    minCount: 4,
    minSpanSeconds: 15,
    maxSpreadSeconds: 1,
    minAverageScore: 0.9,
  },
  {
    reportId: "d25bb915-59ae-4819-aa2b-4a44c425aea5",
    buffId: "union_wealth_group",
    minCount: 8,
    minSpanSeconds: 10,
    maxSpreadSeconds: 1.1,
    minAverageScore: 0.9,
  },
];

(existsSync(RUNTIME_REPORTS_DIR) ? describe : describe.skip)("buff expiry low-score temporal feedback samples", () => {
  it.each(noTemporalWindowReportIds)(
    "does not create a stable low-score temporal window for %s",
    (reportId) => {
      const frames = loadRuntimeTraceFrames(reportId);
      const windows = findConfirmableTemporalWindows(collectRuntimeTraceTemporalObservations(frames));

      expect(windows).toHaveLength(0);
    },
  );

  it.each(lowScoreTemporalCases)(
    "keeps a stable temporal candidate for $reportId $buffId",
    (sample) => {
      const frames = loadRuntimeTraceFrames(sample.reportId);
      const best = findBestTemporalWindow(
        collectRuntimeTraceTemporalObservations(frames),
        sample.buffId,
      );

      expect(best).toBeTruthy();
      expect(best?.count).toBeGreaterThanOrEqual(sample.minCount);
      expect(best?.spanSeconds).toBeGreaterThanOrEqual(sample.minSpanSeconds);
      expect(best?.predictedExpirySpreadSeconds).toBeLessThanOrEqual(sample.maxSpreadSeconds);
      expect(best?.secondDrop).toBeGreaterThanOrEqual(Math.floor(sample.minSpanSeconds) - 2);
      expect(best?.averageScore).toBeGreaterThanOrEqual(sample.minAverageScore);
    },
  );
});

(existsSync(join(YOUTUBE_SAMPLE_DIR, "manifest.json")) ? describe : describe.skip)(
  "buff expiry YouTube temporal sample",
  () => {
    let detectorModule: DetectorModule;
    let normalizeModule: NormalizeModule;
    let countdownModule: CountdownModule;
    let matcher: unknown;

    beforeAll(async () => {
      detectorModule = await import(
        /* @vite-ignore */ pathToFileURL(resolve("public/buff-expiry/external/src/detector/detect-buffs.js")).href
      ) as DetectorModule;
      normalizeModule = await import(
        /* @vite-ignore */ pathToFileURL(resolve("public/buff-expiry/external/src/recognition/normalize.js")).href
      ) as NormalizeModule;
      countdownModule = await import(
        /* @vite-ignore */ pathToFileURL(resolve("public/buff-expiry/external/src/recognition/countdown-matcher.js")).href
      ) as CountdownModule;
      matcher = countdownModule.prepareInitialCountdownMatcher(loadCountdownSamples(), {
        stage1TopBuffs: 7,
      });
    });

    it("exposes 29:03 low-score countdown evidence for temporal analysis", () => {
      const observations = collectVideoTemporalObservations({
        secondFrom: 1743,
        secondTo: 1775,
        detectorModule,
        normalizeModule,
        countdownModule,
        matcher,
      });
      const expCoupon = findBestTemporalWindow(observations, "exp_multiplier_coupon_group");
      const unionWealth = findBestTemporalWindow(observations, "union_wealth_group");

      expect(expCoupon).toBeTruthy();
      expect(expCoupon?.count).toBeGreaterThanOrEqual(8);
      expect(expCoupon?.spanSeconds).toBeGreaterThanOrEqual(7);
      expect(expCoupon?.predictedExpirySpreadSeconds).toBeLessThanOrEqual(3);
      expect(expCoupon?.averageScore).toBeGreaterThanOrEqual(0.88);

      expect(unionWealth).toBeTruthy();
      expect(unionWealth?.count).toBeGreaterThanOrEqual(7);
      expect(unionWealth?.spanSeconds).toBeGreaterThanOrEqual(6);
      expect(unionWealth?.predictedExpirySpreadSeconds).toBeLessThanOrEqual(3);
      expect(unionWealth?.averageScore).toBeGreaterThanOrEqual(0.88);
    }, 60_000);
  },
);

function loadRuntimeTraceFrames(reportId: string): RuntimeTraceFrame[] {
  const reportPath = join(RUNTIME_REPORTS_DIR, `${reportId}.json`);
  if (!existsSync(reportPath)) {
    throw new Error(`Missing runtime trace report: ${reportPath}`);
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
    body?: { sample?: { runtimeTrace?: RuntimeTraceFrame[] } };
    sample?: { runtimeTrace?: RuntimeTraceFrame[] };
  };
  return report.body?.sample?.runtimeTrace ?? report.sample?.runtimeTrace ?? [];
}

function collectRuntimeTraceTemporalObservations(frames: RuntimeTraceFrame[]): TemporalObservation[] {
  const observations: TemporalObservation[] = [];
  for (const frame of frames) {
    for (const match of frame.rejectedMatches ?? []) {
      const observation = temporalObservationFromRejectedMatch(frame.sampledAt, match);
      if (observation) {
        observations.push(observation);
      }
    }
  }
  return observations;
}

function temporalObservationFromRejectedMatch(
  sampledAt: number,
  match: RejectedTraceMatch,
): TemporalObservation | null {
  if (match.reason !== "low-score") {
    return null;
  }
  if (!match.candidateBuffId || typeof match.candidateSeconds !== "number" || typeof match.score !== "number") {
    return null;
  }
  if (match.score < LOW_SCORE_MIN || match.score >= LOW_SCORE_MAX || match.candidateSeconds < MIN_TEMPORAL_SECONDS) {
    return null;
  }
  return {
    sampledAt,
    key: makeTemporalKey(match.candidateBuffId, match.box),
    buffId: match.candidateBuffId,
    seconds: match.candidateSeconds,
    score: match.score,
  };
}

function collectVideoTemporalObservations({
  secondFrom,
  secondTo,
  detectorModule,
  normalizeModule,
  countdownModule,
  matcher,
}: {
  secondFrom: number;
  secondTo: number;
  detectorModule: DetectorModule;
  normalizeModule: NormalizeModule;
  countdownModule: CountdownModule;
  matcher: unknown;
}): TemporalObservation[] {
  const manifest = JSON.parse(readFileSync(join(YOUTUBE_SAMPLE_DIR, "manifest.json"), "utf8")) as VideoManifest;
  if (!manifest.sourceWidth || !manifest.sourceHeight || !manifest.captureRoi) {
    throw new Error("YouTube sample manifest must describe the source capture ROI.");
  }
  const calibration = getBuffExpiryFrameCalibration(manifest.sourceWidth, manifest.sourceHeight);
  if (calibration.unsupportedReason) {
    throw new Error(calibration.unsupportedReason);
  }

  const observations: TemporalObservation[] = [];
  const frames = manifest.frames.filter((frame) => frame.second >= secondFrom && frame.second <= secondTo);
  for (const frame of frames) {
    const png = PNG.sync.read(readFileSync(resolveFramePath(YOUTUBE_SAMPLE_DIR, frame.file)));
    const imageData = cropPng(png, { x: 0, y: 0, width: png.width, height: png.height });
    const detection = detectorModule.detectBuffs(imageData, {
      detectorMode: "v3",
      fallbackSides: calibration.sideCandidates,
      forceFallbackSides: true,
      roiStartXRatio: 0,
      roiEndYRatio: 1,
    });
    const detectedItems = detection.boxes.map((box) => ({
      box,
      normalizedIcon: normalizeModule.normalizeDetectedBuffCrop(imageData, box).normalizedIcon,
    }));
    const rankedItems = countdownModule.rankInitialCountdownMatches(detectedItems, matcher, { topN: 10 });
    for (const item of rankedItems) {
      const candidate = item.countdownCandidate;
      const score = item.countdownStatus.score;
      if (!candidate || !SELECTED_REFERENCE_IDS.has(candidate.buffId)) {
        continue;
      }
      if (score < LOW_SCORE_MIN || score >= LOW_SCORE_MAX || candidate.seconds < MIN_TEMPORAL_SECONDS) {
        continue;
      }
      const buffId = getBuffExpiryTrackingId(candidate.buffId);
      observations.push({
        sampledAt: frame.second * 1000,
        key: makeTemporalKey(buffId, item.box),
        buffId,
        seconds: candidate.seconds,
        score,
      });
    }
  }
  return observations;
}

function findConfirmableTemporalWindows(observations: TemporalObservation[]): TemporalWindow[] {
  return findTemporalWindows(observations).filter(isConfirmableTemporalWindow);
}

function findBestTemporalWindow(
  observations: TemporalObservation[],
  buffId?: string,
): TemporalWindow | null {
  const windows = findConfirmableTemporalWindows(
    buffId ? observations.filter((observation) => observation.buffId === buffId) : observations,
  );
  return windows[0] ?? null;
}

function findTemporalWindows(observations: TemporalObservation[]): TemporalWindow[] {
  const byKey = new Map<string, TemporalObservation[]>();
  for (const observation of observations) {
    byKey.set(observation.key, [...(byKey.get(observation.key) ?? []), observation]);
  }

  const windows: TemporalWindow[] = [];
  for (const [key, group] of byKey) {
    const sorted = group.slice().sort((a, b) => a.sampledAt - b.sampledAt);
    for (let startIndex = 0; startIndex < sorted.length; startIndex += 1) {
      const window: TemporalObservation[] = [];
      for (let index = startIndex; index < sorted.length; index += 1) {
        const current = sorted[index];
        const previous = window[window.length - 1];
        if (previous) {
          if (current.seconds > previous.seconds + 1) {
            break;
          }
        }
        window.push(current);
        if (window.length >= 3) {
          windows.push(makeTemporalWindow(key, window));
        }
      }
    }
  }

  return windows.sort(
    (a, b) =>
      b.count - a.count ||
      b.spanSeconds - a.spanSeconds ||
      a.predictedExpirySpreadSeconds - b.predictedExpirySpreadSeconds ||
      b.averageScore - a.averageScore,
  );
}

function makeTemporalWindow(key: string, observations: TemporalObservation[]): TemporalWindow {
  const first = observations[0];
  const last = observations[observations.length - 1];
  const predictedExpires = observations.map((observation) => observation.sampledAt / 1000 + observation.seconds);
  return {
    key,
    buffId: first.buffId,
    count: observations.length,
    spanSeconds: round((last.sampledAt - first.sampledAt) / 1000),
    predictedExpirySpreadSeconds: round(Math.max(...predictedExpires) - Math.min(...predictedExpires)),
    secondDrop: first.seconds - last.seconds,
    averageScore: round(observations.reduce((sum, observation) => sum + observation.score, 0) / observations.length),
    fromSeconds: first.seconds,
    toSeconds: last.seconds,
  };
}

function isConfirmableTemporalWindow(window: TemporalWindow): boolean {
  return (
    window.count >= 3 &&
    window.spanSeconds >= 5 &&
    window.predictedExpirySpreadSeconds <= 3 &&
    window.secondDrop >= Math.max(1, Math.floor(window.spanSeconds) - 2) &&
    window.averageScore >= LOW_SCORE_MIN
  );
}

function makeTemporalKey(buffId: string, box?: TemporalBox | Record<string, unknown> | null): string {
  const x = roundToGrid(Number(box?.x ?? 0), 4);
  const y = roundToGrid(Number(box?.y ?? 0), 4);
  const width = roundToGrid(Number(box?.width ?? 0), 2);
  const height = roundToGrid(Number(box?.height ?? 0), 2);
  return `${buffId}@${x}:${y}:${width}:${height}`;
}

function resolveFramePath(frameDir: string, frameFile: string): string {
  const directPath = join(frameDir, frameFile);
  if (existsSync(directPath)) {
    return directPath;
  }
  return join(frameDir, "frames", frameFile);
}

function loadCountdownSamples(): CountdownSample[] {
  const metadata = JSON.parse(
    readFileSync(resolve("public/buff-expiry/countdown-metadata.json"), "utf8"),
  ) as {
    samples: Array<Omit<CountdownSample, "normalizedIcon">>;
  };
  const atlas = PNG.sync.read(readFileSync(resolve("public/buff-expiry/countdown-atlas.png")));
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
    data.set(png.data.subarray(sourceStart, sourceStart + region.width * 4), y * region.width * 4);
  }
  return { width: region.width, height: region.height, data };
}

function roundToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
