import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { reconcileBuffExpiryPrecisionTracks } from "../src/features/alerts/runtime/buffExpiryPrecisionTracking";
import { getBuffExpiryPrecisionGroupFromBuffId } from "../src/lib/buffExpiryPrecision/buffExpiryPrecisionTrackingConfig";

type ImageDataLike = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

const targetGroups = ["unionWealth", "unionLuck", "potion", "expCoupon"] as const;
type TargetGroup = (typeof targetGroups)[number];

type CountdownAudit = {
  kind: string;
  text: string | null;
  totalSeconds: number | null;
  confidence: number;
  status: string;
  routerTarget: string;
  routerConfidence: number;
  routerStatus: string;
  textRegion: string;
} | null;

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

type FrameAudit = {
  frame: number;
  second: number;
  file: string;
  boxCount: number;
  targetCount: number;
  countdownReadyCount: number;
  performance: {
    totalMs: number;
    detectMs: number;
    matchMs: number;
    countdownMs: number;
    countdownModelStatus: string;
    matcherModelStatus: string;
  };
  targets: Array<{
    boxIndex: number;
    row: number;
    col: number;
    group: string | null;
    score: number;
    margin: number;
    reason: string;
    bestTargetName: string | null;
    iconPath: string;
    countdown: CountdownAudit;
  }>;
  bestByGroup: Array<{
    group: TargetGroup;
    boxIndex: number | null;
    row: number | null;
    col: number | null;
    score: number | null;
    margin: number | null;
    accepted: boolean;
    matcherAccepted: boolean;
    winningGroup: string | null;
    bundleId: string | null;
    modelVersion: string | null;
    gateScore: number | null;
    gateMargin: number | null;
    reason: string | null;
    iconPath: string | null;
    countdown: CountdownAudit;
  }>;
};

type SampleAudit = {
  id: string;
  title: string;
  frameCount: number;
  processedFrameCount: number;
  boxCountRange: [number, number];
  targetFrameCount: number;
  countdownFrameCount: number;
  groups: Record<string, number>;
  countdownByGroup: Record<string, number>;
  expectedGroups: TargetGroup[];
  confirmedGroups: TargetGroup[];
  missingExpectedGroups: TargetGroup[];
  unexpectedConfirmedGroups: TargetGroup[];
  status: "pass" | "fail" | "skip";
  frames: FrameAudit[];
};

type AuditSummary = {
  generatedAt: string;
  inputRoot: string;
  outputRoot: string;
  preload: { countdownModelStatus: string; matcherModelStatus: string };
  sampleCount: number;
  frameCount: number;
  targetFrameCount: number;
  countdownFrameCount: number;
  passedSampleCount: number;
  failedSampleCount: number;
  skippedSampleCount: number;
  samples: SampleAudit[];
};

const defaultInputRoot = "debug-samples/test-resources/buff-expiry/video/local-1fps";
const inputRoot = resolve(process.argv[2] ?? defaultInputRoot);
const outputRoot = resolve(
  process.env.BUFF_EXPIRY_PRECISION_1FPS_OUTPUT_DIR ??
    `debug-samples/test-resources/buff-expiry/analysis/precision-1fps-countdown-review`,
);
const frameLimit = Number(process.env.BUFF_EXPIRY_PRECISION_1FPS_FRAME_LIMIT ?? "0");
const strict = process.argv.includes("--strict");

patchFileFetch();

const { BuffExpiryPrecisionAnalysisProcessor } = await import(
  "../src/runtime/buff-expiry/analysis/buffExpiryPrecisionAnalysisProcessor"
);
mkdirSync(outputRoot, { recursive: true });

const processor = new BuffExpiryPrecisionAnalysisProcessor({
  now: () => performance.now(),
});
const preload = await processor.preload([...targetGroups]);
if (preload.countdownModelStatus !== "ready" || preload.matcherModelStatus !== "ready") {
  throw new Error(
    `Precision models did not preload: matcher=${preload.matcherModelStatus}, countdown=${preload.countdownModelStatus}`,
  );
}

const sampleDirs = findSampleDirs(inputRoot);
const samples: SampleAudit[] = [];

for (const sampleDir of sampleDirs) {
  samples.push(await auditSample(sampleDir));
}

const summary: AuditSummary = {
  generatedAt: new Date().toISOString(),
  inputRoot: relative(process.cwd(), inputRoot),
  outputRoot: relative(process.cwd(), outputRoot),
  preload,
  sampleCount: samples.length,
  frameCount: samples.reduce((sum, sample) => sum + sample.processedFrameCount, 0),
  targetFrameCount: samples.reduce((sum, sample) => sum + sample.targetFrameCount, 0),
  countdownFrameCount: samples.reduce((sum, sample) => sum + sample.countdownFrameCount, 0),
  passedSampleCount: samples.filter((sample) => sample.status === "pass").length,
  failedSampleCount: samples.filter((sample) => sample.status === "fail").length,
  skippedSampleCount: samples.filter((sample) => sample.status === "skip").length,
  samples,
};

writeFileSync(join(outputRoot, "precision-1fps-countdown-audit.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(outputRoot, "precision-1fps-countdown-audit.html"), renderHtml(summary));

console.log(renderConsoleSummary(summary));
console.log(`\nJSON: ${relative(process.cwd(), join(outputRoot, "precision-1fps-countdown-audit.json"))}`);
console.log(`HTML: ${relative(process.cwd(), join(outputRoot, "precision-1fps-countdown-audit.html"))}`);
if (strict && summary.failedSampleCount > 0) {
  process.exitCode = 1;
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

async function auditSample(sampleDir: string): Promise<SampleAudit> {
  const manifest = readJson<Manifest>(join(sampleDir, "manifest.json"));
  const frames = (manifest.frames ?? []).slice(0, frameLimit > 0 ? frameLimit : undefined);
  const sampleId = manifest.id ?? basename(sampleDir);
  const sampleOutputDir = join(outputRoot, "assets", sampleId);
  mkdirSync(sampleOutputDir, { recursive: true });

  const frameAudits: FrameAudit[] = [];
  let tracking: ReturnType<typeof reconcileBuffExpiryPrecisionTracks> = {
    tracks: [],
    pendingTracks: [],
    confirmationCandidateCount: 0,
  };
  const confirmedGroupsSeen = new Set<TargetGroup>();
  for (const frame of frames) {
    const imageData = readPngImageData(resolve(sampleDir, frame.file));
    const response = await processor.process({
      imageData: imageData as unknown as ImageData,
      sampledAt: frame.second * 1000,
      activeGroups: [...targetGroups],
    });
    const bestByGroup = response.bestByGroup.map((candidate, rank) => {
        const icon = response.icons[candidate.boxIndex];
        const box = response.boxes[candidate.boxIndex];
        const iconFileName = `frame_${String(frame.index + 1).padStart(4, "0")}__best_${candidate.group}_${String(
          rank + 1,
        ).padStart(2, "0")}__slot_${String(candidate.boxIndex).padStart(2, "0")}.png`;
        const iconPath = join(sampleOutputDir, iconFileName);
        if (icon) {
          writePngImageData(iconPath, icon);
        }
        return {
          group: candidate.group,
          boxIndex: candidate.boxIndex,
          row: box?.row ?? null,
          col: box?.col ?? null,
          score: round(candidate.score),
          margin: round(candidate.margin),
          accepted: candidate.accepted,
          matcherAccepted: candidate.matcherAccepted ?? candidate.accepted,
          winningGroup: candidate.winningGroup,
          bundleId: candidate.bundleId ?? null,
          modelVersion: candidate.modelVersion ?? null,
          gateScore: candidate.gateScore ?? null,
          gateMargin: candidate.gateMargin ?? null,
          reason: candidate.decisionReason,
          iconPath: relative(outputRoot, iconPath),
          countdown: toCountdownAudit(candidate.countdown),
        };
    });
    const targets = response.iconObservations
      .filter((observation) => observation.identity.kind === "target")
      .map((observation) => {
        const icon = response.icons[observation.boxIndex];
        const iconFileName = `frame_${String(frame.index + 1).padStart(4, "0")}__slot_${String(
          observation.boxIndex,
        ).padStart(2, "0")}__${observation.identity.group ?? "target"}.png`;
        const iconPath = join(sampleOutputDir, iconFileName);
        if (icon) {
          writePngImageData(iconPath, icon);
        }
        return {
          boxIndex: observation.boxIndex,
          row: observation.box.row,
          col: observation.box.col,
          group: observation.identity.group,
          score: observation.identity.score,
          margin: observation.identity.margin,
          reason: observation.identity.decisionReason,
          bestTargetName: observation.identity.bestTargetName,
          iconPath: relative(outputRoot, iconPath),
          countdown: toCountdownAudit(observation.countdown),
        };
      });
    tracking = reconcileBuffExpiryPrecisionTracks({
      previousTracks: tracking.tracks,
      previousPendingTracks: tracking.pendingTracks,
      observations: response.iconObservations,
      bestByGroup: response.bestByGroup,
      now: frame.second * 1000,
    });
    for (const track of tracking.tracks) {
      const group = getBuffExpiryPrecisionGroupFromBuffId(track.buffId);
      if (group) {
        confirmedGroupsSeen.add(group);
      }
    }
    frameAudits.push({
      frame: frame.index + 1,
      second: frame.second,
      file: frame.file,
      boxCount: response.boxes.length,
      targetCount: targets.length,
      countdownReadyCount: targets.filter((target) => target.countdown?.kind === "exact").length,
      performance: {
        totalMs: response.performance.totalMs,
        detectMs: response.performance.detectMs,
        matchMs: response.performance.matchMs ?? 0,
        countdownMs: response.performance.countdownMs ?? 0,
        countdownModelStatus: response.performance.countdownModelStatus ?? "idle",
        matcherModelStatus: response.performance.matcherModelStatus ?? "idle",
      },
      targets,
      bestByGroup,
    });
  }

  const groups: Record<string, number> = {};
  const countdownByGroup: Record<string, number> = {};
  const boxCounts = frameAudits.map((frame) => frame.boxCount);
  for (const frame of frameAudits) {
    for (const target of frame.targets) {
      const group = target.group ?? "unknown";
      groups[group] = (groups[group] ?? 0) + 1;
      if (target.countdown?.kind === "exact") {
        countdownByGroup[group] = (countdownByGroup[group] ?? 0) + 1;
      }
    }
  }

  const expectedGroups = [
    ...new Set(
      (manifest.expectedBuffGroups ?? []).flatMap((entry) => {
        const group = toPrecisionTargetGroup(entry.id);
        return group ? [group] : [];
      }),
    ),
  ];
  const confirmedGroups = [...confirmedGroupsSeen];
  const missingExpectedGroups = expectedGroups.filter((group) => !confirmedGroups.includes(group));
  const unexpectedConfirmedGroups = confirmedGroups.filter((group) => !expectedGroups.includes(group));
  const status = expectedGroups.length === 0
    ? "skip"
    : missingExpectedGroups.length === 0 && unexpectedConfirmedGroups.length === 0
      ? "pass"
      : "fail";

  return {
    id: sampleId,
    title: manifest.title ?? sampleId,
    frameCount: manifest.frames?.length ?? frames.length,
    processedFrameCount: frames.length,
    boxCountRange: boxCounts.length ? [Math.min(...boxCounts), Math.max(...boxCounts)] : [0, 0],
    targetFrameCount: frameAudits.filter((frame) => frame.targetCount > 0).length,
    countdownFrameCount: frameAudits.filter((frame) => frame.countdownReadyCount > 0).length,
    groups,
    countdownByGroup,
    expectedGroups,
    confirmedGroups,
    missingExpectedGroups,
    unexpectedConfirmedGroups,
    status,
    frames: frameAudits,
  };
}

function toPrecisionTargetGroup(value: string): TargetGroup | null {
  const mapping: Record<string, TargetGroup> = {
    union_wealth_group: "unionWealth",
    union_luck_group: "unionLuck",
    small_wealth_exp_potion_group: "potion",
    exp_multiplier_coupon_group: "expCoupon",
  };
  return mapping[value] ?? null;
}

function readDirNames(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function toCountdownAudit(countdown: {
  kind: string;
  text: string | null;
  totalSeconds: number | null;
  confidence: number;
  status: string;
  routerTarget: string;
  routerConfidence: number;
  routerStatus: string;
  textRegion: string;
} | null | undefined): CountdownAudit {
  if (!countdown) return null;
  return {
    kind: countdown.kind,
    text: countdown.text,
    totalSeconds: countdown.totalSeconds,
    confidence: countdown.confidence,
    status: countdown.status,
    routerTarget: countdown.routerTarget,
    routerConfidence: countdown.routerConfidence,
    routerStatus: countdown.routerStatus,
    textRegion: countdown.textRegion,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
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
    const filePath = url.startsWith("file://")
      ? fileURLToPath(url)
      : url.startsWith("/")
        ? resolve("public", url.split("?")[0]!.slice(1))
        : null;
    if (filePath && existsSync(filePath)) {
      const data = new Uint8Array(readFileSync(filePath));
      return new Response(data, {
        status: 200,
        headers: {
          "content-type": filePath.endsWith(".json")
            ? "application/json"
            : filePath.endsWith(".wasm")
              ? "application/wasm"
            : "application/octet-stream",
        },
      });
    }
    if (!originalFetch) {
      throw new Error(`fetch is unavailable for ${url}`);
    }
    return originalFetch(input, init);
  };
}

function renderConsoleSummary(summary: AuditSummary): string {
  const rows = summary.samples.map((sample) => [
    sample.id,
    sample.status,
    `${sample.countdownFrameCount}/${sample.processedFrameCount}`,
    sample.confirmedGroups.join(", ") || "-",
    sample.missingExpectedGroups.join(", ") || "-",
    Object.entries(sample.groups).map(([group, count]) => `${group}:${count}`).join(", ") || "-",
    Object.entries(sample.countdownByGroup).map(([group, count]) => `${group}:${count}`).join(", ") || "-",
  ]);
  const headers = [
    "sample",
    "status",
    "frames with countdown",
    "confirmed",
    "missing",
    "target observations",
    "exact countdown",
  ];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );
  return [
    headers.map((header, index) => header.padEnd(widths[index])).join(" | "),
    widths.map((width) => "-".repeat(width)).join("-|-"),
    ...rows.map((row) => row.map((cell, index) => cell.padEnd(widths[index])).join(" | ")),
  ].join("\n");
}

function renderHtml(summary: AuditSummary): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Buff Expiry Precision 1fps Countdown Audit</title>
  <style>
    body { margin: 0; background: #f7f8f2; color: #142f29; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1440px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    .meta { color: #61716b; font-size: 13px; margin-bottom: 22px; }
    .sample { background: rgba(255,255,255,.72); border: 1px solid #d9e2d8; border-radius: 12px; margin: 16px 0; overflow: hidden; }
    .sample > header { align-items: center; display: flex; gap: 14px; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid #d9e2d8; }
    .sample h2 { font-size: 17px; margin: 0; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { background: #edf5ef; border: 1px solid #cce0d1; border-radius: 999px; color: #0f6d5a; font-size: 12px; font-weight: 700; padding: 5px 9px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #e2e8df; font-size: 12px; padding: 8px; text-align: left; vertical-align: top; }
    th { color: #64736e; font-size: 11px; letter-spacing: .02em; text-transform: uppercase; }
    tr:last-child td { border-bottom: 0; }
    .targets { display: flex; flex-wrap: wrap; gap: 6px; min-width: 260px; }
    .target { align-items: center; background: #fbfcf8; border: 1px solid #dfe7dd; border-radius: 8px; display: grid; gap: 4px 7px; grid-template-columns: 32px minmax(130px, 1fr); padding: 5px; }
    .target img { border-radius: 5px; height: 32px; image-rendering: pixelated; width: 32px; }
    .target strong { font-size: 12px; }
    .target small { color: #66736e; display: block; font-size: 11px; }
    .countdown-ok { color: #007763; font-weight: 800; }
    .countdown-miss { color: #a15a00; font-weight: 800; }
    .perf { color: #67736e; white-space: nowrap; }
  </style>
</head>
<body>
<main>
  <h1>Buff Expiry Precision 1fps Countdown Audit</h1>
  <div class="meta">Generated ${escapeHtml(summary.generatedAt)} · ${summary.sampleCount} samples · ${summary.frameCount} frames · pass ${summary.passedSampleCount} / fail ${summary.failedSampleCount} / skip ${summary.skippedSampleCount}</div>
  ${summary.samples.map(renderSampleHtml).join("\n")}
</main>
</body>
</html>`;
}

function renderSampleHtml(sample: SampleAudit): string {
  const visibleFrames = sample.frames.filter((frame) => frame.targets.length);
  return `<section class="sample">
    <header>
      <div>
        <h2>${escapeHtml(sample.title)}</h2>
        <div class="meta">${escapeHtml(sample.id)} · frames ${sample.processedFrameCount}/${sample.frameCount} · boxes ${sample.boxCountRange.join("-")}</div>
      </div>
      <div class="chips">
        <span class="chip">target frames ${sample.targetFrameCount}</span>
        <span class="chip">countdown frames ${sample.countdownFrameCount}</span>
        <span class="chip">${escapeHtml(sample.status)} · confirmed ${escapeHtml(sample.confirmedGroups.join(", ") || "-")}</span>
        ${sample.missingExpectedGroups.length ? `<span class="chip">missing ${escapeHtml(sample.missingExpectedGroups.join(", "))}</span>` : ""}
        ${Object.entries(sample.countdownByGroup)
          .map(([group, count]) => `<span class="chip">${escapeHtml(group)} exact ${count}</span>`)
          .join("")}
      </div>
    </header>
    <table>
      <thead>
        <tr><th>sec</th><th>boxes</th><th>targets / countdown</th><th>perf</th></tr>
      </thead>
      <tbody>
        ${visibleFrames.map(renderFrameHtml).join("\n") || `<tr><td colspan="4">대상 버프 관측 없음</td></tr>`}
      </tbody>
    </table>
  </section>`;
}

function renderFrameHtml(frame: FrameAudit): string {
  return `<tr>
    <td>${frame.second}s<br/><small>#${frame.frame}</small></td>
    <td>${frame.boxCount}</td>
    <td><div class="targets">${frame.targets.map(renderTargetHtml).join("")}</div></td>
    <td class="perf">total ${frame.performance.totalMs}ms<br/>detect ${frame.performance.detectMs}ms · match ${frame.performance.matchMs}ms<br/>count ${frame.performance.countdownMs}ms · ${escapeHtml(frame.performance.countdownModelStatus)}</td>
  </tr>`;
}

function renderTargetHtml(target: FrameAudit["targets"][number]): string {
  const countdownText = target.countdown?.kind === "exact"
    ? `${target.countdown.text ?? target.countdown.totalSeconds}s`
    : target.countdown
      ? `${target.countdown.kind}/${target.countdown.status}`
      : "no countdown";
  const countdownClass = target.countdown?.kind === "exact" ? "countdown-ok" : "countdown-miss";
  return `<div class="target">
    <img src="${escapeHtml(target.iconPath)}" alt="" />
    <div>
      <strong>${escapeHtml(target.group ?? "unknown")} · slot ${target.boxIndex}</strong>
      <small>row ${target.row}, col ${target.col} · score ${target.score}, margin ${target.margin}</small>
      <small class="${countdownClass}">${escapeHtml(countdownText)}${target.countdown ? ` · conf ${target.countdown.confidence}` : ""}</small>
      <small>${escapeHtml(target.reason)}</small>
    </div>
  </div>`;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
