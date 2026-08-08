import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import type {
  BuffExpiryBox,
  BuffExpiryPendingTrack,
  BuffExpiryTrackedBuff,
} from "../src/lib/buffExpiry/buffExpiryTypes";
import { markDueBuffExpiryPrecisionClustersAlerted } from "../src/lib/buffExpiryPrecision/buffExpiryPrecisionAlertClusters";
import type {
  BuffExpiryPrecisionBestGroupCandidate,
  BuffExpiryPrecisionIconObservation,
} from "../src/runtime/buff-expiry/analysis/buffExpiryPrecisionAnalysisRuntime";
import { reconcileBuffExpiryPrecisionTracks } from "../src/features/alerts/runtime/buffExpiryPrecisionTracking";

type ImageDataLike = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

type ManifestFrame = {
  index: number;
  second: number;
  file: string;
  width: number;
  height: number;
};

type Manifest = {
  id?: string;
  title?: string;
  frames?: ManifestFrame[];
  videos?: Array<{
    id: string;
    title: string;
    frameDir: string;
  }>;
};

type TrackingAuditFrame = {
  frame: number;
  second: number;
  file: string;
  sourceFramePath: string;
  boxCount: number;
  acceptedExactCount: number;
  targetObservationCount: number;
  pendingCount: number;
  trackCount: number;
  observations: TrackingObservationSummary[];
  pendingTracks: TrackingPendingSummary[];
  tracks: TrackingTrackSummary[];
  events: TrackingEventSummary[];
  performance: {
    totalMs: number;
    detectMs: number;
    matchMs: number;
    countdownMs: number;
    countdownCount: number;
    countdownModelStatus: string;
  };
};

type TrackingObservationSummary = {
  group: string;
  boxIndex: number;
  row: number;
  col: number;
  score: number;
  margin: number;
  seconds: number | null;
  countdownStatus: string;
  iconPath: string;
};

type TrackingPendingSummary = {
  id: string;
  group: string;
  name: string;
  row: number | null;
  col: number | null;
  observationCount: number;
  seconds: number[];
  predictedExpiresAt: number[];
};

type TrackingTrackSummary = {
  id: string;
  group: string;
  name: string;
  row: number | null;
  col: number | null;
  detectedSeconds: number;
  remainingSeconds: number;
  expiresAt: number;
  lastSeenAt: number;
  staleSeconds: number;
  score: number;
};

type TrackingEventSummary = {
  type:
    | "pending-created"
    | "pending-updated"
    | "confirmed"
    | "track-updated"
    | "track-assisted"
    | "track-dropped"
    | "alert-due";
  group: string;
  name: string;
  trackId: string;
  message: string;
};

type SampleTrackingAudit = {
  id: string;
  title: string;
  frameCount: number;
  processedFrameCount: number;
  firstSecond: number | null;
  lastSecond: number | null;
  confirmedCount: number;
  alertDueCount: number;
  frames: TrackingAuditFrame[];
};

type TrackingAuditSummary = {
  generatedAt: string;
  inputRoot: string;
  outputRoot: string;
  alertLeadSeconds: number[];
  preload: { countdownModelStatus: string };
  sampleCount: number;
  frameCount: number;
  confirmedCount: number;
  alertDueCount: number;
  samples: SampleTrackingAudit[];
};

const defaultInputRoot = "debug-samples/test-resources/buff-expiry/analysis/precision-last-2min-local_20260607_144400/input/local_20260607_144400_last_2min";
const inputRoot = resolve(process.argv[2] ?? defaultInputRoot);
const outputRoot = resolve(
  process.env.BUFF_EXPIRY_PRECISION_TRACKING_OUTPUT_DIR ??
    "debug-samples/test-resources/buff-expiry/analysis/precision-tracking-review",
);
const frameLimit = Number(process.env.BUFF_EXPIRY_PRECISION_TRACKING_FRAME_LIMIT ?? "0");
const alertLeadSeconds = parseAlertLeadSeconds(process.env.BUFF_EXPIRY_PRECISION_TRACKING_ALERT_LEADS ?? "20,15,10,5,1");

patchFileFetch();

const { BuffExpiryPrecisionAnalysisProcessor } = await import(
  "../src/runtime/buff-expiry/analysis/buffExpiryPrecisionAnalysisProcessor"
);

mkdirSync(outputRoot, { recursive: true });

const processor = new BuffExpiryPrecisionAnalysisProcessor({
  now: () => performance.now(),
});
const preload = await processor.preload();
if (preload.countdownModelStatus !== "ready") {
  throw new Error(`Countdown model did not preload: ${preload.countdownModelStatus}`);
}

const sampleDirs = findSampleDirs(inputRoot);
const samples: SampleTrackingAudit[] = [];
for (const sampleDir of sampleDirs) {
  samples.push(await auditSample(sampleDir));
}

const summary: TrackingAuditSummary = {
  generatedAt: new Date().toISOString(),
  inputRoot: relative(process.cwd(), inputRoot),
  outputRoot: relative(process.cwd(), outputRoot),
  alertLeadSeconds,
  preload,
  sampleCount: samples.length,
  frameCount: samples.reduce((sum, sample) => sum + sample.processedFrameCount, 0),
  confirmedCount: samples.reduce((sum, sample) => sum + sample.confirmedCount, 0),
  alertDueCount: samples.reduce((sum, sample) => sum + sample.alertDueCount, 0),
  samples,
};

writeFileSync(join(outputRoot, "precision-tracking-audit.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(outputRoot, "precision-tracking-audit.html"), renderHtml(summary));

console.log(renderConsoleSummary(summary));
console.log(`\nJSON: ${relative(process.cwd(), join(outputRoot, "precision-tracking-audit.json"))}`);
console.log(`HTML: ${relative(process.cwd(), join(outputRoot, "precision-tracking-audit.html"))}`);

async function auditSample(sampleDir: string): Promise<SampleTrackingAudit> {
  const manifest = readJson<Manifest>(join(sampleDir, "manifest.json"));
  const frames = (manifest.frames ?? []).slice(0, frameLimit > 0 ? frameLimit : undefined);
  const sampleId = manifest.id ?? basename(sampleDir);
  const sampleOutputDir = join(outputRoot, "assets", sampleId);
  mkdirSync(sampleOutputDir, { recursive: true });

  let previousTracks: BuffExpiryTrackedBuff[] = [];
  let previousPendingTracks: BuffExpiryPendingTrack[] = [];
  const alertedByLead = new Map<number, Set<string>>(
    alertLeadSeconds.map((leadSeconds) => [leadSeconds, new Set<string>()]),
  );
  const frameAudits: TrackingAuditFrame[] = [];

  for (const frame of frames) {
    const now = frame.second * 1000;
    const imageData = readPngImageData(resolve(sampleDir, frame.file));
    const response = await processor.process({
      imageData: imageData as unknown as ImageData,
      sampledAt: now,
    });
    const result = reconcileBuffExpiryPrecisionTracks({
      previousTracks,
      previousPendingTracks,
      observations: response.iconObservations,
      bestByGroup: response.bestByGroup,
      now,
    });
    const observations = response.iconObservations.flatMap((observation) =>
      summarizeObservation({
        observation,
        icons: response.icons,
        sampleOutputDir,
        frame,
      }),
    );
    const events = createTrackingEvents({
      previousTracks,
      previousPendingTracks,
      precisionTracks: result.tracks,
      precisionPendingTracks: result.pendingTracks,
      acceptedExactObservations: response.iconObservations,
      bestByGroup: response.bestByGroup,
      now,
      alertedByLead,
    });
    frameAudits.push({
      frame: frame.index + 1,
      second: frame.second,
      file: frame.file,
      sourceFramePath: relative(outputRoot, resolve(sampleDir, frame.file)),
      boxCount: response.boxes.length,
      acceptedExactCount: observations.filter((observation) => observation.seconds !== null).length,
      targetObservationCount: response.iconObservations.filter((observation) => observation.identity.kind === "target").length,
      pendingCount: result.pendingTracks.length,
      trackCount: result.tracks.length,
      observations,
      pendingTracks: result.pendingTracks.map((track) => summarizePendingTrack(track)),
      tracks: result.tracks.map((track) => summarizeTrack(track, now)),
      events,
      performance: {
        totalMs: response.performance.totalMs,
        detectMs: response.performance.detectMs,
        matchMs: response.performance.matchMs ?? 0,
        countdownMs: response.performance.countdownMs ?? 0,
        countdownCount: response.performance.countdownCount ?? 0,
        countdownModelStatus: response.performance.countdownModelStatus ?? "idle",
      },
    });
    previousTracks = result.tracks;
    previousPendingTracks = result.pendingTracks;
  }

  return {
    id: sampleId,
    title: manifest.title ?? sampleId,
    frameCount: manifest.frames?.length ?? frames.length,
    processedFrameCount: frames.length,
    firstSecond: frames[0]?.second ?? null,
    lastSecond: frames[frames.length - 1]?.second ?? null,
    confirmedCount: frameAudits.reduce(
      (sum, frame) => sum + frame.events.filter((event) => event.type === "confirmed").length,
      0,
    ),
    alertDueCount: frameAudits.reduce(
      (sum, frame) => sum + frame.events.filter((event) => event.type === "alert-due").length,
      0,
    ),
    frames: frameAudits,
  };
}

function summarizeObservation({
  observation,
  icons,
  sampleOutputDir,
  frame,
}: {
  observation: BuffExpiryPrecisionIconObservation;
  icons: Array<{ width: number; height: number; data: Uint8ClampedArray }>;
  sampleOutputDir: string;
  frame: ManifestFrame;
}): TrackingObservationSummary[] {
  if (observation.identity.kind !== "target" || !observation.identity.group) {
    return [];
  }
  const icon = icons[observation.boxIndex];
  const iconFileName = `frame_${String(frame.index + 1).padStart(4, "0")}__slot_${String(
    observation.boxIndex,
  ).padStart(2, "0")}__${observation.identity.group}.png`;
  const iconPath = join(sampleOutputDir, iconFileName);
  if (icon) {
    writePngImageData(iconPath, icon);
  }
  return [
    {
      group: observation.identity.group,
      boxIndex: observation.boxIndex,
      row: observation.box.row,
      col: observation.box.col,
      score: observation.identity.score,
      margin: observation.identity.margin,
      seconds:
        observation.countdown?.kind === "exact" && observation.countdown.totalSeconds !== null
          ? observation.countdown.totalSeconds
          : null,
      countdownStatus: observation.countdown
        ? `${observation.countdown.kind}/${observation.countdown.status}`
        : "none",
      iconPath: relative(outputRoot, iconPath),
    },
  ];
}

function summarizePendingTrack(track: BuffExpiryPendingTrack): TrackingPendingSummary {
  return {
    id: track.id,
    group: getGroupFromBuffId(track.buffId),
    name: track.name,
    row: typeof track.box.row === "number" ? track.box.row : null,
    col: typeof track.box.col === "number" ? track.box.col : null,
    observationCount: track.observations.length,
    seconds: track.observations.map((observation) => observation.seconds),
    predictedExpiresAt: track.observations.map(
      (observation) => observation.observedAt + observation.seconds * 1000,
    ),
  };
}

function summarizeTrack(track: BuffExpiryTrackedBuff, now: number): TrackingTrackSummary {
  return {
    id: track.id,
    group: getGroupFromBuffId(track.buffId),
    name: track.name,
    row: typeof track.box.row === "number" ? track.box.row : null,
    col: typeof track.box.col === "number" ? track.box.col : null,
    detectedSeconds: track.detectedSeconds,
    remainingSeconds: Math.max(0, Math.ceil((track.expiresAt - now) / 1000)),
    expiresAt: track.expiresAt,
    lastSeenAt: track.lastSeenAt,
    staleSeconds: Math.max(0, Math.round((now - track.lastSeenAt) / 1000)),
    score: track.score,
  };
}

function createTrackingEvents({
  previousTracks,
  previousPendingTracks,
  precisionTracks,
  precisionPendingTracks,
  acceptedExactObservations,
  bestByGroup,
  now,
  alertedByLead,
}: {
  previousTracks: BuffExpiryTrackedBuff[];
  previousPendingTracks: BuffExpiryPendingTrack[];
  precisionTracks: BuffExpiryTrackedBuff[];
  precisionPendingTracks: BuffExpiryPendingTrack[];
  acceptedExactObservations: BuffExpiryPrecisionIconObservation[];
  bestByGroup: BuffExpiryPrecisionBestGroupCandidate[];
  now: number;
  alertedByLead: Map<number, Set<string>>;
}): TrackingEventSummary[] {
  const events: TrackingEventSummary[] = [];
  const previousPendingById = new Map(previousPendingTracks.map((track) => [track.id, track]));
  const previousTrackById = new Map(previousTracks.map((track) => [track.id, track]));
  const precisionTrackById = new Map(precisionTracks.map((track) => [track.id, track]));
  const acceptedGroupSet = new Set(
    acceptedExactObservations
      .filter((observation) => observation.identity.kind === "target" && observation.countdown?.kind === "exact")
      .map((observation) => observation.identity.group)
      .filter((group): group is string => Boolean(group)),
  );
  const bestExactGroupSet = new Set(
    bestByGroup
      .filter((candidate) => candidate.countdown?.kind === "exact")
      .map((candidate) => candidate.group),
  );

  for (const pending of precisionPendingTracks) {
    const previous = previousPendingById.get(pending.id);
    if (!previous) {
      events.push(createEvent("pending-created", pending, `확인 시작 · ${formatSecondsList(pending.observations.map((item) => item.seconds))}`));
    } else if (previous.observations.length !== pending.observations.length) {
      events.push(createEvent("pending-updated", pending, `확인 누적 ${pending.observations.length}회 · ${formatSecondsList(pending.observations.map((item) => item.seconds))}`));
    }
  }

  for (const track of precisionTracks) {
    const previous = previousTrackById.get(track.id);
    if (!previous) {
      events.push(createEvent("confirmed", track, `확정 · 남은 ${track.detectedSeconds}초 · 종료 ${formatMsTime(track.expiresAt)}`));
      continue;
    }
    if (track.lastSeenAt !== previous.lastSeenAt) {
      const group = getGroupFromBuffId(track.buffId);
      const type = acceptedGroupSet.has(group)
        ? "track-updated"
        : bestExactGroupSet.has(group)
          ? "track-assisted"
          : "track-updated";
      events.push(createEvent(type, track, `${type === "track-assisted" ? "보정 유지" : "관측 갱신"} · 남은 ${track.detectedSeconds}초 · 종료 ${formatMsTime(track.expiresAt)}`));
    }
  }

  for (const previous of previousTracks) {
    if (!precisionTrackById.has(previous.id)) {
      events.push(createEvent("track-dropped", previous, "최근 관측이 없어 트랙 제거"));
      for (const alertedIds of alertedByLead.values()) {
        alertedIds.delete(previous.id);
      }
    }
  }

  for (const leadSeconds of alertLeadSeconds) {
    const alertedIds = alertedByLead.get(leadSeconds);
    if (!alertedIds) continue;
    const tracksForLead = precisionTracks.map((track) =>
      alertedIds.has(track.id) ? { ...track, alertedAt: now } : track,
    );
    const alertUpdate = markDueBuffExpiryPrecisionClustersAlerted({
      tracks: tracksForLead,
      now,
      alertLeadSeconds: leadSeconds,
    });
    const markedTrackIds = new Set(alertUpdate.alertDecision.markedTrackIds);
    if (!alertUpdate.shouldAlert) {
      for (const trackId of markedTrackIds) {
        alertedIds.add(trackId);
      }
      continue;
    }
    for (const trackId of markedTrackIds) {
      alertedIds.add(trackId);
    }
    const alertTracks = alertUpdate.tracks.filter((track) =>
      alertUpdate.alertDecision.newAlertTrackIds.includes(track.id),
    );
    const anchorTrack = alertTracks
      .sort((left, right) => left.expiresAt - right.expiresAt || left.id.localeCompare(right.id))[0];
    if (anchorTrack) {
      events.push(
        createEvent(
          "alert-due",
          anchorTrack,
          `${leadSeconds}초 기준 클러스터 알림 예정 · ${alertTracks.length}개 · 현재 남은 ${Math.max(0, Math.ceil((anchorTrack.expiresAt - now) / 1000))}초`,
        ),
      );
    }
  }

  return events;
}

function createEvent(
  type: TrackingEventSummary["type"],
  track: BuffExpiryPendingTrack | BuffExpiryTrackedBuff,
  message: string,
): TrackingEventSummary {
  return {
    type,
    group: getGroupFromBuffId(track.buffId),
    name: track.name,
    trackId: track.id,
    message,
  };
}

function findSampleDirs(root: string): string[] {
  const manifestPath = join(root, "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = readJson<Manifest>(manifestPath);
    if (Array.isArray(manifest.videos) && manifest.videos.length > 0) {
      return manifest.videos
        .map((video) => resolveFrameDir(root, video.frameDir))
        .filter((entry) => existsSync(join(entry, "manifest.json")))
        .sort();
    }
    if (Array.isArray(manifest.frames)) {
      return [root];
    }
  }
  const entries = readDirNames(root).map((name) => join(root, name));
  return entries.filter((entry) => existsSync(join(entry, "manifest.json"))).sort();
}

function resolveFrameDir(root: string, frameDir: string): string {
  const relativeToRoot = resolve(root, frameDir);
  if (existsSync(join(relativeToRoot, "manifest.json"))) {
    return relativeToRoot;
  }
  return resolve(frameDir);
}

function readDirNames(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readPngImageData(filePath: string): ImageDataLike {
  const png = PNG.sync.read(readFileSync(filePath));
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data),
  };
}

function writePngImageData(filePath: string, image: ImageDataLike): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  writeFileSync(filePath, PNG.sync.write(png));
}

function patchFileFetch(): void {
  const originalFetch = globalThis.fetch?.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("file://")) {
      const filePath = fileURLToPath(url);
      const text = readFileSync(filePath, "utf8");
      return new Response(text, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (!originalFetch) {
      throw new Error(`fetch is unavailable for ${url}`);
    }
    return originalFetch(input, init);
  };
}

function parseAlertLeadSeconds(value: string): number[] {
  return value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry >= 0)
    .sort((left, right) => right - left);
}

function getGroupFromBuffId(buffId: string): string {
  return buffId.startsWith("next:") ? buffId.slice("next:".length) : buffId;
}

function formatSecondsList(seconds: number[]): string {
  return seconds.map((second) => `${second}초`).join(" → ");
}

function formatMsTime(ms: number): string {
  return formatSecondTime(Math.round(ms / 1000));
}

function formatSecondTime(second: number): string {
  const minutes = Math.floor(second / 60);
  const seconds = Math.max(0, second % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderConsoleSummary(summary: TrackingAuditSummary): string {
  const rows = summary.samples.map((sample) => [
    sample.id,
    `${formatSecondTime(sample.firstSecond ?? 0)}-${formatSecondTime(sample.lastSecond ?? 0)}`,
    String(sample.processedFrameCount),
    String(sample.confirmedCount),
    String(sample.alertDueCount),
  ]);
  const headers = ["sample", "range", "frames", "confirmed", "alert due"];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );
  return [
    headers.map((header, index) => header.padEnd(widths[index])).join(" | "),
    widths.map((width) => "-".repeat(width)).join("-|-"),
    ...rows.map((row) => row.map((cell, index) => cell.padEnd(widths[index])).join(" | ")),
  ].join("\n");
}

function renderHtml(summary: TrackingAuditSummary): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Buff Expiry Precision Tracking Audit</title>
  <style>
    :root { color-scheme: light; background: #f5f7f1; color: #16332d; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; }
    main { max-width: 1560px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    .meta { color: #68766f; font-size: 13px; margin-bottom: 16px; }
    .summary, .nav { display: flex; flex-wrap: wrap; gap: 7px; margin: 14px 0 22px; }
    .chip, .nav a { border: 1px solid #d2dfd3; background: #fff; border-radius: 999px; color: #16332d; font-size: 12px; font-weight: 750; padding: 6px 10px; text-decoration: none; }
    .nav a.eventful { border-color: #00a887; background: #eaf8f2; color: #006b58; }
    .frame { background: rgba(255,255,255,.84); border: 1px solid #d8e2d7; border-radius: 14px; margin: 16px 0; overflow: hidden; }
    .frame.eventful { border-color: #00a887; box-shadow: 0 0 0 2px rgba(0,168,135,.08); }
    .frame > header { display: flex; justify-content: space-between; gap: 16px; padding: 12px 14px; border-bottom: 1px solid #e2e9e0; }
    .frame > header strong { display: block; font-size: 18px; }
    .frame > header span { color: #6a7771; display: block; font-size: 12px; margin-top: 2px; }
    .body { display: grid; grid-template-columns: 330px minmax(280px, 1fr) minmax(320px, 1.2fr); gap: 14px; padding: 14px; }
    .full { display: block; border: 1px solid #dce5db; border-radius: 10px; overflow: hidden; background: #111; }
    .full img { display: block; width: 100%; height: auto; }
    h3 { color: #65746d; font-size: 12px; margin: 0 0 8px; }
    .list { display: flex; flex-direction: column; gap: 7px; }
    .pill { align-items: center; background: #fbfcf8; border: 1px solid #dde6db; border-radius: 10px; display: grid; grid-template-columns: 36px minmax(0,1fr); gap: 8px; padding: 6px; }
    .pill img { border-radius: 6px; height: 36px; image-rendering: pixelated; width: 36px; }
    .pill b { display: block; font-size: 12px; }
    .pill span, .pill em { display: block; font-size: 11px; }
    .pill span { color: #69766f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pill em { color: #007d66; font-style: normal; font-weight: 900; }
    .state-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .state-card, .event { border: 1px solid #dde6db; border-radius: 10px; background: #fbfcf8; padding: 8px; }
    .state-card strong, .event strong { display: block; font-size: 12px; }
    .state-card small, .event small { color: #65746d; display: block; font-size: 11px; line-height: 1.45; margin-top: 3px; }
    .event.confirmed, .event.alert-due { border-color: #a7dccb; background: #eaf8f2; color: #006b58; }
    .event.track-dropped { border-color: #e9c6b3; background: #fff5ee; color: #8b4a21; }
    .empty { border: 1px dashed #d7e0d5; border-radius: 10px; color: #87918d; font-size: 12px; margin: 0; padding: 14px; text-align: center; }
    footer { border-top: 1px solid #e2e9e0; color: #6c7872; font-size: 11px; padding: 9px 14px; }
    @media (max-width: 1180px) { .body { grid-template-columns: 1fr; } .full { max-width: 520px; } }
  </style>
</head>
<body>
<main>
  <h1>Buff Expiry Precision Tracking Audit</h1>
  <div class="meta">Generated ${escapeHtml(summary.generatedAt)} · ${summary.frameCount} frames · leads ${summary.alertLeadSeconds.join(", ")}s</div>
  ${summary.samples.map(renderSampleHtml).join("\n")}
</main>
</body>
</html>`;
}

function renderSampleHtml(sample: SampleTrackingAudit): string {
  return `<section>
    <div class="summary">
      <span class="chip">${escapeHtml(sample.title)}</span>
      <span class="chip">range ${formatSecondTime(sample.firstSecond ?? 0)}-${formatSecondTime(sample.lastSecond ?? 0)}</span>
      <span class="chip">frames ${sample.processedFrameCount}</span>
      <span class="chip">confirmed ${sample.confirmedCount}</span>
      <span class="chip">alert due ${sample.alertDueCount}</span>
    </div>
    <div class="nav">
      ${sample.frames.map((frame) => `<a class="${frame.events.length ? "eventful" : ""}" href="#s${frame.second}">${formatSecondTime(frame.second)}</a>`).join("")}
    </div>
    ${sample.frames.map(renderFrameHtml).join("\n")}
  </section>`;
}

function renderFrameHtml(frame: TrackingAuditFrame): string {
  const framePath = frame.sourceFramePath;
  const isEventful = frame.events.length > 0;
  return `<article class="frame ${isEventful ? "eventful" : ""}" id="s${frame.second}">
    <header>
      <div>
        <strong>${formatSecondTime(frame.second)}</strong>
        <span>${frame.second}s · frame #${frame.frame} · boxes ${frame.boxCount} · target ${frame.targetObservationCount} · exact ${frame.acceptedExactCount} · pending ${frame.pendingCount} · tracks ${frame.trackCount}</span>
      </div>
    </header>
    <div class="body">
      <a class="full" href="${escapeHtml(framePath)}"><img src="${escapeHtml(framePath)}" alt="" /></a>
      <section>
        <h3>관측</h3>
        <div class="list">${frame.observations.map(renderObservationHtml).join("") || `<p class="empty">대상 관측 없음</p>`}</div>
      </section>
      <section>
        <h3>상태 / 이벤트</h3>
        <div class="state-grid">
          ${frame.pendingTracks.map(renderPendingHtml).join("")}
          ${frame.tracks.map(renderTrackHtml).join("")}
        </div>
        <div class="list" style="margin-top: 8px;">${frame.events.map(renderEventHtml).join("") || `<p class="empty">상태 변화 없음</p>`}</div>
      </section>
    </div>
    <footer>perf total ${frame.performance.totalMs}ms · detect ${frame.performance.detectMs}ms · match ${frame.performance.matchMs}ms · countdown ${frame.performance.countdownMs}ms/${frame.performance.countdownCount} · ${escapeHtml(frame.performance.countdownModelStatus)}</footer>
  </article>`;
}

function renderObservationHtml(observation: TrackingObservationSummary): string {
  return `<div class="pill">
    <img src="${escapeHtml(observation.iconPath)}" alt="" />
    <div>
      <b>${escapeHtml(groupLabel(observation.group))} · slot ${observation.boxIndex}</b>
      <span>r${observation.row} c${observation.col} · score ${observation.score} · margin ${observation.margin}</span>
      <em>${observation.seconds === null ? `남은 지속시간 없음 · ${escapeHtml(observation.countdownStatus)}` : `남은 ${observation.seconds}초`}</em>
    </div>
  </div>`;
}

function renderPendingHtml(track: TrackingPendingSummary): string {
  return `<div class="state-card">
    <strong>확인 중 · ${escapeHtml(groupLabel(track.group))}</strong>
    <small>slot r${track.row ?? "-"} c${track.col ?? "-"} · ${track.observationCount}회 · ${formatSecondsList(track.seconds)}</small>
  </div>`;
}

function renderTrackHtml(track: TrackingTrackSummary): string {
  return `<div class="state-card">
    <strong>확정 · ${escapeHtml(groupLabel(track.group))}</strong>
    <small>남은 ${track.remainingSeconds}초 · 종료 ${formatMsTime(track.expiresAt)} · stale ${track.staleSeconds}s · score ${track.score}</small>
  </div>`;
}

function renderEventHtml(event: TrackingEventSummary): string {
  return `<div class="event ${event.type}">
    <strong>${escapeHtml(eventLabel(event.type))} · ${escapeHtml(groupLabel(event.group))}</strong>
    <small>${escapeHtml(event.message)}</small>
  </div>`;
}

function groupLabel(group: string): string {
  const labels: Record<string, string> = {
    unionWealth: "유니온의 부",
    unionLuck: "유니온의 행운",
    potion: "비약",
    expCoupon: "경험치 쿠폰",
  };
  return labels[group] ?? group;
}

function eventLabel(type: TrackingEventSummary["type"]): string {
  const labels: Record<TrackingEventSummary["type"], string> = {
    "pending-created": "확인 시작",
    "pending-updated": "확인 누적",
    confirmed: "확정",
    "track-updated": "갱신",
    "track-assisted": "보정 유지",
    "track-dropped": "제거",
    "alert-due": "알림 예정",
  };
  return labels[type];
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
