import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { normalizeDetectedBuffCrop } from "../public/buff-expiry/external/src/recognition/normalize.js";

const DEFAULT_REPORT_IDS = [
  "05ab8052-85d1-4a77-ba5d-d519bc684ac0",
  "6f4e05c5-8d2a-45f5-b7aa-c1dc982805fb",
  "6798161c-f66c-4608-b573-6dd57e406f0a",
  "da3ff120-ff8e-44b1-b6f3-3309aac3b21c",
  "054a37cc-71bb-46fa-a827-1361926d6293",
];

const OUTPUT_ROOT = path.resolve("debug-samples/test-resources/buff-expiry/matcher/false-positive-feedback");
const API_BASE = "https://preview.maple-timer.pages.dev/api/debug-samples";

const reportIds = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_REPORT_IDS;

await mkdir(path.join(OUTPUT_ROOT, "reports"), { recursive: true });
await mkdir(path.join(OUTPUT_ROOT, "frames"), { recursive: true });
await mkdir(path.join(OUTPUT_ROOT, "icons"), { recursive: true });
await mkdir(path.join(OUTPUT_ROOT, "normalized-icons"), { recursive: true });

const manifest = {
  kind: "buff-expiry-false-positive-feedback",
  generatedAt: new Date().toISOString(),
  source: API_BASE,
  reports: [],
  icons: [],
};

for (const reportId of reportIds) {
  const report = await loadReport(reportId);
  const sample = report?.body?.sample;
  if (!sample?.rawDataUrl || !sample?.roi) {
    console.warn(`Skipping ${reportId}: missing sample raw image or ROI.`);
    continue;
  }

  await writeJson(path.join(OUTPUT_ROOT, "reports", `${reportId}.json`), report);
  const raw = pngFromDataUrl(sample.rawDataUrl);
  const rawFileName = `${reportId}-raw.png`;
  await writePng(path.join(OUTPUT_ROOT, "frames", rawFileName), raw);
  if (sample.processedDataUrl) {
    await writePng(path.join(OUTPUT_ROOT, "frames", `${reportId}-processed.png`), pngFromDataUrl(sample.processedDataUrl));
  }
  if (sample.fullFrameDataUrl) {
    await writePng(path.join(OUTPUT_ROOT, "frames", `${reportId}-full.png`), pngFromDataUrl(sample.fullFrameDataUrl));
  }

  const entries = collectInterestingBoxes(sample);
  manifest.reports.push({
    id: reportId,
    appBuild: report.body?.appBuild ?? null,
    reason: report.body?.reportIssue ?? null,
    capture: report.body?.diagnostics?.capture ?? null,
    rawFileName,
    interestingIconCount: entries.length,
  });

  for (const [index, entry] of entries.entries()) {
    const localBox = toLocalBox(entry.box, sample.roi);
    const crop = cropPng(raw, localBox);
    const normalized = normalizeDetectedBuffCrop(imageDataFromPng(raw), localBox).normalizedIcon;
    const safeLabel = [entry.kind, entry.buffId, entry.seconds ?? "none", index]
      .join("__")
      .replace(/[^a-zA-Z0-9_.-]+/g, "_");
    const iconFileName = `${reportId}__${safeLabel}.png`;
    const normalizedFileName = `${reportId}__${safeLabel}__normalized.png`;

    await writePng(path.join(OUTPUT_ROOT, "icons", iconFileName), crop);
    await writePng(path.join(OUTPUT_ROOT, "normalized-icons", normalizedFileName), pngFromImageData(normalized));

    manifest.icons.push({
      reportId,
      kind: entry.kind,
      buffId: entry.buffId,
      name: entry.name,
      seconds: entry.seconds,
      score: entry.score,
      reason: entry.reason,
      strength: entry.strength,
      box: entry.box,
      localBox,
      iconFileName,
      normalizedFileName,
    });
  }
}

await writeJson(path.join(OUTPUT_ROOT, "manifest.json"), manifest);
console.log(`Wrote ${manifest.icons.length} false-positive icon(s) from ${manifest.reports.length} report(s).`);
console.log(OUTPUT_ROOT);

async function loadReport(reportId) {
  const localPath = path.join(OUTPUT_ROOT, "reports", `${reportId}.json`);
  if (existsSync(localPath)) {
    return JSON.parse(await readFile(localPath, "utf8"));
  }

  const response = await fetch(`${API_BASE}?id=${encodeURIComponent(reportId)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch report ${reportId}: ${response.status}`);
  }
  return response.json();
}

function collectInterestingBoxes(sample) {
  const entries = [];
  for (const match of sample.acceptedMatches ?? []) {
    entries.push({
      kind: "accepted",
      buffId: match.buffId,
      name: match.name,
      seconds: match.seconds,
      score: match.score,
      reason: match.reason,
      strength: match.strength,
      box: match.box,
    });
  }
  for (const track of sample.tracks ?? []) {
    entries.push({
      kind: "track",
      buffId: track.buffId,
      name: track.name,
      seconds: track.detectedSeconds,
      score: track.score,
      reason: "tracked-from-prior-frame",
      strength: null,
      box: track.box,
    });
  }
  for (const pending of sample.pendingTracks ?? []) {
    entries.push({
      kind: "pending",
      buffId: pending.buffId,
      name: pending.name,
      seconds: pending.observations?.at(-1)?.seconds ?? null,
      score: pending.score,
      reason: pending.observations?.at(-1)?.reason ?? "pending",
      strength: pending.observations?.at(-1)?.strength ?? null,
      box: pending.box,
    });
  }

  const byBoxAndKind = new Map();
  for (const entry of entries) {
    byBoxAndKind.set(`${entry.kind}:${boxKey(entry.box)}`, entry);
  }
  return [...byBoxAndKind.values()];
}

function toLocalBox(box, roi) {
  return {
    x: Math.max(0, Math.round(box.x - roi.x)),
    y: Math.max(0, Math.round(box.y - roi.y)),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}

function cropPng(source, box) {
  const width = Math.max(1, Math.min(box.width, source.width - box.x));
  const height = Math.max(1, Math.min(box.height, source.height - box.y));
  const output = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((box.y + y) * source.width + box.x) * 4;
    const targetStart = y * width * 4;
    source.data.copy(output.data, targetStart, sourceStart, sourceStart + width * 4);
  }
  return output;
}

function pngFromDataUrl(dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Expected PNG data URL.");
  }
  return PNG.sync.read(Buffer.from(match[1], "base64"));
}

function imageDataFromPng(png) {
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data),
  };
}

function pngFromImageData(imageData) {
  const png = new PNG({ width: imageData.width, height: imageData.height });
  png.data = Buffer.from(imageData.data);
  return png;
}

async function writePng(filePath, png) {
  await writeFile(filePath, PNG.sync.write(png));
}

async function writeJson(filePath, value) {
  await writeFile(`${filePath}`, `${JSON.stringify(value, null, 2)}\n`);
}

function boxKey(box) {
  return `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.width)}:${Math.round(box.height)}`;
}
