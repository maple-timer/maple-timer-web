import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { collectPurpleComponents } from "../src/lib/runeComponents";
import { getRuneCandidateCnnCropBounds } from "../src/lib/runeCandidateCnnCrop";
import { collectRuneCandidateProposals } from "../src/lib/runeCandidateProposals";
import type { RuneCandidate, RuneComponent } from "../src/recognition/rune/runeDetectionTypes";
import { buildPurpleMask } from "../src/lib/runeMask";

type RuneSampleExpectation = "detect" | "reject";

type RuneCandidateManifestEntry = {
  sampleId: string;
  samplePath: string;
  sampleExpectation: RuneSampleExpectation;
  reportReason: string;
  candidateIndex: number;
  augmentation: string;
  outputPath: string;
  outputUrl: string;
  sampleUrl: string;
  sampleWidth: number;
  sampleHeight: number;
  source: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pixelCount: number;
};

const DEFAULT_SAMPLE_DIR = "debug-samples/test-resources/rune/feedback";
const DEFAULT_OUTPUT_DIR = "debug-samples/generated/rune-cnn-candidates";
const OUTPUT_SIZE = 48;
const DEFAULT_MAX_PER_SAMPLE = 10;
const DEFAULT_MAX_RAW_PER_SAMPLE = 12;

const args = parseArgs(process.argv.slice(2));
const sampleDir = resolve(args.samples ?? DEFAULT_SAMPLE_DIR);
const outputDir = resolve(args.out ?? DEFAULT_OUTPUT_DIR);
const maxPerSample = Number.parseInt(args.max ?? `${DEFAULT_MAX_PER_SAMPLE}`, 10);
const maxRawPerSample = Number.parseInt(args.maxRaw ?? `${DEFAULT_MAX_RAW_PER_SAMPLE}`, 10);
const shouldAugment = args.augment === "true";

if (!existsSync(sampleDir)) {
  throw new Error(`Rune sample directory does not exist: ${sampleDir}`);
}

mkdirSync(outputDir, { recursive: true });
const sourceOutputDir = resolve(outputDir, "_sources");
mkdirSync(sourceOutputDir, { recursive: true });

const manifest: RuneCandidateManifestEntry[] = [];
for (const fileName of readdirSync(sampleDir).filter((name) => name.endsWith(".json")).sort()) {
  const jsonPath = resolve(sampleDir, fileName);
  const metadata = JSON.parse(readFileSync(jsonPath, "utf8")) as unknown;
  const reportReason = reportReasonFromMetadata(metadata);
  const expectation = expectationFromReportReason(reportReason);
  if (!expectation) {
    continue;
  }

  const sampleId = fileName.replace(/\.json$/, "");
  const pngPath = resolve(sampleDir, `${sampleId}-raw.png`);
  const pngBuffer = existsSync(pngPath) ? readFileSync(pngPath) : pngBufferFromMetadata(metadata);
  if (!pngBuffer) {
    continue;
  }

  const png = PNG.sync.read(pngBuffer);
  const sourceOutputPath = resolve(sourceOutputDir, `${sampleId}.png`);
  writeFileSync(sourceOutputPath, PNG.sync.write(png));
  const imageData = {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data),
  } as ImageData;
  const runtimeProposals = collectRuneCandidateProposals(imageData).candidates;
  const rawProposals = collectRawPurpleComponentCandidates(imageData, runtimeProposals).slice(0, maxRawPerSample);
  const proposals = [...runtimeProposals.slice(0, maxPerSample), ...rawProposals].slice(
    0,
    maxPerSample + maxRawPerSample,
  );
  const sampleOutputDir = resolve(outputDir, expectation, sampleId);
  mkdirSync(sampleOutputDir, { recursive: true });

  proposals.forEach((candidate, candidateIndex) => {
    const variants = createCandidatePatchVariants(png, candidate, shouldAugment);
    variants.forEach((variant) => {
      const outputFileName =
        `${String(candidateIndex + 1).padStart(2, "0")}_${candidate.source ?? "unknown"}_${candidate.confidence.toFixed(3)}_${variant.id}.png`;
      const outputPath = resolve(
        sampleOutputDir,
        outputFileName,
      );
      writeFileSync(outputPath, PNG.sync.write(variant.image));
      manifest.push({
        sampleId,
        samplePath: pngPath,
        sampleExpectation: expectation,
        reportReason: reportReason ?? "unknown",
        candidateIndex,
        augmentation: variant.id,
        outputPath,
        outputUrl: `${expectation}/${sampleId}/${outputFileName}`,
        sampleUrl: `_sources/${sampleId}.png`,
        sampleWidth: png.width,
        sampleHeight: png.height,
        source: candidate.source ?? "unknown",
        confidence: round(candidate.confidence),
        x: candidate.x,
        y: candidate.y,
        width: candidate.width,
        height: candidate.height,
        pixelCount: candidate.pixelCount,
      });
    });
  });
}

const manifestPath = resolve(outputDir, "manifest.json");
const reviewPath = resolve(outputDir, "review.html");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(reviewPath, renderReviewHtml(manifest));

console.log(`Exported ${manifest.length} rune CNN candidate crops`);
console.log(`manifest: ${manifestPath}`);
console.log(`review: ${reviewPath}`);

type ExportCandidate = RuneCandidate & {
  source: string;
};

type CandidatePatchVariant = {
  id: string;
  image: PNG;
};

function collectRawPurpleComponentCandidates(
  imageData: ImageData,
  existingCandidates: RuneCandidate[],
): ExportCandidate[] {
  const mask = buildPurpleMask(imageData);
  const { components } = collectPurpleComponents(mask, imageData.width, imageData.height);
  return components
    .map((component) => toRawCandidate(component))
    .filter((candidate) => isUsefulRawCandidate(candidate))
    .filter((candidate) => !existingCandidates.some((existing) => overlapsCandidate(existing, candidate)))
    .sort((a, b) => b.pixelCount - a.pixelCount);
}

function toRawCandidate(component: RuneComponent): ExportCandidate {
  return {
    x: component.minX,
    y: component.minY,
    width: component.maxX - component.minX + 1,
    height: component.maxY - component.minY + 1,
    pixelCount: component.pixelCount,
    confidence: 0,
    source: "raw-purple-component",
  };
}

function isUsefulRawCandidate(candidate: ExportCandidate): boolean {
  const area = candidate.width * candidate.height;
  const aspectRatio = candidate.width / Math.max(1, candidate.height);
  return (
    candidate.width >= 4 &&
    candidate.height >= 4 &&
    candidate.width <= 56 &&
    candidate.height <= 56 &&
    aspectRatio >= 0.65 &&
    aspectRatio <= 2.25 &&
    candidate.pixelCount >= 8 &&
    area >= 16 &&
    candidate.pixelCount / Math.max(1, area) >= 0.05
  );
}

function overlapsCandidate(a: RuneCandidate, b: RuneCandidate): boolean {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlapArea = Math.max(0, right - left) * Math.max(0, bottom - top);
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return overlapArea / Math.max(1, smallerArea) > 0.6;
}

function createCandidatePatchVariants(
  source: PNG,
  candidate: RuneCandidate,
  augment: boolean,
): CandidatePatchVariant[] {
  const base = renderCandidatePatch(source, candidate);
  if (!augment) {
    return [{ id: "base", image: base }];
  }

  const variants: CandidatePatchVariant[] = [
    { id: "base", image: base },
    { id: "rotate180", image: rotate180(base) },
    { id: "blur1", image: boxBlur(base, 1) },
  ];
  for (const pixels of [1, 2, 3]) {
    variants.push(
      { id: `shift-up-${pixels}`, image: renderCandidatePatch(source, candidate, 0, -pixels) },
      { id: `shift-down-${pixels}`, image: renderCandidatePatch(source, candidate, 0, pixels) },
      { id: `shift-left-${pixels}`, image: renderCandidatePatch(source, candidate, -pixels, 0) },
      { id: `shift-right-${pixels}`, image: renderCandidatePatch(source, candidate, pixels, 0) },
    );
  }
  return variants;
}

function renderCandidatePatch(
  source: PNG,
  candidate: RuneCandidate,
  offsetX = 0,
  offsetY = 0,
): PNG {
  const output = new PNG({ width: OUTPUT_SIZE, height: OUTPUT_SIZE });
  const bounds = getRuneCandidateCnnCropBounds(source, candidate, { offsetX, offsetY });

  for (let targetY = 0; targetY < OUTPUT_SIZE; targetY += 1) {
    for (let targetX = 0; targetX < OUTPUT_SIZE; targetX += 1) {
      const sourceX = Math.min(
        source.width - 1,
        Math.max(0, Math.floor(bounds.left + (targetX / OUTPUT_SIZE) * bounds.size)),
      );
      const sourceY = Math.min(
        source.height - 1,
        Math.max(0, Math.floor(bounds.top + (targetY / OUTPUT_SIZE) * bounds.size)),
      );
      const sourceIndex = (sourceY * source.width + sourceX) * 4;
      const targetIndex = (targetY * OUTPUT_SIZE + targetX) * 4;
      output.data[targetIndex] = source.data[sourceIndex];
      output.data[targetIndex + 1] = source.data[sourceIndex + 1];
      output.data[targetIndex + 2] = source.data[sourceIndex + 2];
      output.data[targetIndex + 3] = 255;
    }
  }

  return output;
}

function rotate180(source: PNG): PNG {
  const output = new PNG({ width: source.width, height: source.height });
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      copyPixel(
        source,
        output,
        source.width - 1 - x,
        source.height - 1 - y,
        x,
        y,
      );
    }
  }
  return output;
}

function boxBlur(source: PNG, radius: number): PNG {
  const output = new PNG({ width: source.width, height: source.height });
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;
      for (let sampleY = y - radius; sampleY <= y + radius; sampleY += 1) {
        for (let sampleX = x - radius; sampleX <= x + radius; sampleX += 1) {
          const clampedX = Math.max(0, Math.min(source.width - 1, sampleX));
          const clampedY = Math.max(0, Math.min(source.height - 1, sampleY));
          const index = (clampedY * source.width + clampedX) * 4;
          red += source.data[index];
          green += source.data[index + 1];
          blue += source.data[index + 2];
          alpha += source.data[index + 3];
          count += 1;
        }
      }
      const targetIndex = (y * output.width + x) * 4;
      output.data[targetIndex] = Math.round(red / count);
      output.data[targetIndex + 1] = Math.round(green / count);
      output.data[targetIndex + 2] = Math.round(blue / count);
      output.data[targetIndex + 3] = Math.round(alpha / count);
    }
  }
  return output;
}

function copyPixel(source: PNG, output: PNG, sourceX: number, sourceY: number, targetX: number, targetY: number) {
  const sourceIndex = (sourceY * source.width + sourceX) * 4;
  const targetIndex = (targetY * output.width + targetX) * 4;
  output.data[targetIndex] = source.data[sourceIndex];
  output.data[targetIndex + 1] = source.data[sourceIndex + 1];
  output.data[targetIndex + 2] = source.data[sourceIndex + 2];
  output.data[targetIndex + 3] = source.data[sourceIndex + 3];
}

function parseArgs(rawArgs: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    parsed[arg.slice(2)] = rawArgs[index + 1] && !rawArgs[index + 1].startsWith("--")
      ? rawArgs[index + 1]
      : "true";
  }
  return parsed;
}

function expectationFromReportReason(reason: string | null): RuneSampleExpectation | null {
  if (reason === "rune-missed") {
    return "detect";
  }
  if (reason === "rune-false-positive") {
    return "reject";
  }
  return null;
}

function reportReasonFromMetadata(metadata: unknown): string | null {
  if (!isRecord(metadata)) {
    return null;
  }
  const body = metadata.body;
  if (!isRecord(body)) {
    return null;
  }
  const reportIssue = body.reportIssue;
  if (isRecord(reportIssue) && typeof reportIssue.reason === "string") {
    return reportIssue.reason;
  }
  const sample = body.sample;
  if (isRecord(sample) && typeof sample.reportReason === "string") {
    return sample.reportReason;
  }
  return null;
}

function pngBufferFromMetadata(metadata: unknown): Buffer | null {
  if (!isRecord(metadata) || !isRecord(metadata.body) || !isRecord(metadata.body.sample)) {
    return null;
  }
  const { rawDataUrl } = metadata.body.sample;
  if (typeof rawDataUrl !== "string") {
    return null;
  }
  const match = /^data:image\/png;base64,(.+)$/.exec(rawDataUrl);
  return match ? Buffer.from(match[1], "base64") : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function renderReviewHtml(entries: RuneCandidateManifestEntry[]): string {
  const payload = JSON.stringify(entries).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Rune CNN Candidate Review</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7faf7;
      --panel: #ffffff;
      --line: #dce7de;
      --text: #14342c;
      --muted: #65776f;
      --accent: #08785f;
      --accent-soft: #e4f6ef;
      --danger: #b42339;
      --danger-soft: #fff0f2;
      --warn: #99610a;
      --warn-soft: #fff7e6;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
    }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      display: grid;
      gap: 10px;
      padding: 18px 22px 14px;
      border-bottom: 1px solid var(--line);
      background: rgba(247, 250, 247, 0.94);
      backdrop-filter: blur(14px);
    }
    h1 {
      margin: 0;
      font-size: 20px;
      letter-spacing: 0;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .pill, button, select {
      height: 30px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255,255,255,0.7);
      color: var(--text);
      font: inherit;
      font-size: 12px;
      font-weight: 700;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 0 10px;
      color: var(--muted);
    }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 0 12px;
      cursor: pointer;
      transition: border-color 140ms ease, background 140ms ease, color 140ms ease, transform 140ms ease;
    }
    button:hover {
      border-color: rgba(8, 120, 95, 0.45);
      background: var(--accent-soft);
      color: var(--accent);
    }
    button:active {
      transform: translateY(1px);
    }
    select {
      padding: 0 30px 0 10px;
    }
    main {
      display: grid;
      gap: 14px;
      padding: 18px 22px 40px;
    }
    .sample {
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--panel);
      box-shadow: 0 14px 35px rgba(20, 52, 44, 0.06);
    }
    .sample-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
    }
    .sample-title {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      font-size: 13px;
      font-weight: 800;
    }
    .sample-body {
      display: grid;
      grid-template-columns: minmax(220px, 320px) 1fr;
      gap: 14px;
      padding: 14px;
    }
    .preview {
      position: sticky;
      top: 118px;
      align-self: start;
      display: grid;
      gap: 10px;
    }
    .source-frame {
      position: relative;
      overflow: hidden;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: #050807;
    }
    .source-frame img {
      display: block;
      width: 100%;
      height: auto;
      image-rendering: pixelated;
    }
    .box {
      position: absolute;
      border: 2px solid #ffbf00;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.55), 0 0 14px rgba(255,191,0,0.8);
      pointer-events: none;
    }
    .candidates {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
      gap: 10px;
    }
    .card {
      display: grid;
      gap: 9px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
      transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
    }
    .card:hover {
      border-color: rgba(8, 120, 95, 0.45);
      box-shadow: 0 8px 20px rgba(20, 52, 44, 0.08);
    }
    .card.selected {
      border-color: rgba(8, 120, 95, 0.65);
      box-shadow: 0 0 0 3px rgba(8, 120, 95, 0.12);
    }
    .crop {
      width: 72px;
      height: 72px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: #050807;
      image-rendering: pixelated;
      place-self: center;
    }
    .meta {
      display: grid;
      gap: 3px;
      min-width: 0;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }
    .label-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }
    .label-row button {
      min-width: 0;
      padding: 0 6px;
    }
    .card[data-label="positive"] {
      background: var(--accent-soft);
      border-color: rgba(8, 120, 95, 0.55);
    }
    .card[data-label="negative"] {
      background: var(--danger-soft);
      border-color: rgba(180, 35, 57, 0.35);
    }
    .card[data-label="ignore"] {
      background: var(--warn-soft);
      border-color: rgba(153, 97, 10, 0.35);
    }
    .empty {
      padding: 42px;
      border: 1px dashed var(--line);
      border-radius: 12px;
      text-align: center;
      color: var(--muted);
      background: rgba(255,255,255,0.65);
    }
    @media (max-width: 900px) {
      .sample-body {
        grid-template-columns: 1fr;
      }
      .preview {
        position: static;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>Rune CNN Candidate Review</h1>
    <div class="toolbar">
      <span class="pill" id="summary">후보 0개</span>
      <span class="pill" id="labelSummary">positive 0 · negative 0 · ignore 0</span>
      <select id="expectationFilter" aria-label="report filter">
        <option value="all">전체 리포트</option>
        <option value="detect">감지 실패 리포트</option>
        <option value="reject">오감지 리포트</option>
      </select>
      <select id="augmentationFilter" aria-label="augmentation filter">
        <option value="all">전체 증강</option>
      </select>
      <select id="labelFilter" aria-label="label filter">
        <option value="all">전체 라벨</option>
        <option value="unlabeled">미검수</option>
        <option value="positive">rune</option>
        <option value="negative">not-rune</option>
        <option value="ignore">skip</option>
      </select>
      <button id="clearLabels" type="button">라벨 초기화</button>
      <button id="downloadLabels" type="button">labels.json 다운로드</button>
    </div>
  </header>
  <main id="root"></main>
  <script>
    const entries = ${payload};
    const storageKey = "maple-rune-cnn-labels:v1";
    const labels = new Map(Object.entries(JSON.parse(localStorage.getItem(storageKey) || "{}")));
    let selectedKey = null;

    const root = document.getElementById("root");
    const summary = document.getElementById("summary");
    const labelSummary = document.getElementById("labelSummary");
    const expectationFilter = document.getElementById("expectationFilter");
    const augmentationFilter = document.getElementById("augmentationFilter");
    const labelFilter = document.getElementById("labelFilter");
    const augmentations = Array.from(new Set(entries.map((entry) => entry.augmentation))).sort();
    for (const augmentation of augmentations) {
      const option = document.createElement("option");
      option.value = augmentation;
      option.textContent = augmentation;
      augmentationFilter.append(option);
    }

    function entryKey(entry) {
      return entry.outputPath;
    }

    function saveLabels() {
      localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(labels.entries())));
      render();
    }

    function getVisibleEntries() {
      return entries.filter((entry) => {
        const label = labels.get(entryKey(entry));
        return (expectationFilter.value === "all" || entry.sampleExpectation === expectationFilter.value) &&
          (augmentationFilter.value === "all" || entry.augmentation === augmentationFilter.value) &&
          (labelFilter.value === "all" ||
            (labelFilter.value === "unlabeled" ? !label : label === labelFilter.value));
      });
    }

    function groupBySample(visibleEntries) {
      const groups = new Map();
      for (const entry of visibleEntries) {
        if (!groups.has(entry.sampleId)) {
          groups.set(entry.sampleId, []);
        }
        groups.get(entry.sampleId).push(entry);
      }
      return Array.from(groups.entries());
    }

    function render() {
      const visibleEntries = getVisibleEntries();
      const labelCounts = { positive: 0, negative: 0, ignore: 0 };
      for (const label of labels.values()) {
        if (labelCounts[label] !== undefined) {
          labelCounts[label] += 1;
        }
      }
      summary.textContent = \`후보 \${visibleEntries.length.toLocaleString()}개 / 전체 \${entries.length.toLocaleString()}개\`;
      labelSummary.textContent = \`positive \${labelCounts.positive} · negative \${labelCounts.negative} · ignore \${labelCounts.ignore}\`;
      root.replaceChildren();

      const groups = groupBySample(visibleEntries);
      if (groups.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "현재 필터에 해당하는 후보가 없습니다.";
        root.append(empty);
        return;
      }

      for (const [sampleId, sampleEntries] of groups) {
        const first = sampleEntries[0];
        const section = document.createElement("section");
        section.className = "sample";
        const head = document.createElement("div");
        head.className = "sample-head";
        head.innerHTML = \`
          <div class="sample-title">
            <span>\${escapeHtml(sampleId)}</span>
            <span class="pill">\${escapeHtml(first.sampleExpectation)}</span>
            <span class="pill">\${escapeHtml(first.reportReason)}</span>
          </div>
          <span class="pill">\${sampleEntries.length} candidates</span>
        \`;
        const body = document.createElement("div");
        body.className = "sample-body";
        const preview = document.createElement("div");
        preview.className = "preview";
        preview.append(createSourcePreview(first, sampleEntries[0]));
        const grid = document.createElement("div");
        grid.className = "candidates";
        for (const entry of sampleEntries) {
          grid.append(createCard(entry, preview));
        }
        body.append(preview, grid);
        section.append(head, body);
        root.append(section);
      }
    }

    function createSourcePreview(sampleEntry, selectedEntry) {
      const wrap = document.createElement("div");
      wrap.className = "source-frame";
      const img = document.createElement("img");
      img.src = sampleEntry.sampleUrl;
      img.alt = sampleEntry.sampleId;
      const box = document.createElement("div");
      box.className = "box";
      wrap.append(img, box);

      img.addEventListener("load", () => updateBox(wrap, img, box, selectedEntry));
      queueMicrotask(() => updateBox(wrap, img, box, selectedEntry));
      return wrap;
    }

    function updateSourcePreview(preview, entry) {
      const frame = preview.querySelector(".source-frame");
      const img = frame?.querySelector("img");
      const box = frame?.querySelector(".box");
      if (frame && img && box) {
        updateBox(frame, img, box, entry);
      }
    }

    function updateBox(frame, img, box, entry) {
      const renderedWidth = img.clientWidth || frame.clientWidth;
      const scale = renderedWidth / Math.max(1, entry.sampleWidth);
      box.style.left = \`\${entry.x * scale}px\`;
      box.style.top = \`\${entry.y * scale}px\`;
      box.style.width = \`\${entry.width * scale}px\`;
      box.style.height = \`\${entry.height * scale}px\`;
    }

    function createCard(entry, preview) {
      const key = entryKey(entry);
      const card = document.createElement("article");
      card.className = "card";
      card.dataset.label = labels.get(key) || "";
      if (selectedKey === key) {
        card.classList.add("selected");
      }
      card.innerHTML = \`
        <img class="crop" src="\${entry.outputUrl}" alt="\${escapeHtml(entry.sampleId)} candidate">
        <div class="meta">
          <strong>#\${entry.candidateIndex + 1} · \${escapeHtml(entry.augmentation)}</strong>
          <span>\${escapeHtml(entry.source)} · conf \${entry.confidence}</span>
          <span>\${entry.width}x\${entry.height} · px \${entry.pixelCount}</span>
        </div>
      \`;
      const buttons = document.createElement("div");
      buttons.className = "label-row";
      buttons.append(
        createLabelButton(key, "positive", "rune"),
        createLabelButton(key, "negative", "not"),
        createLabelButton(key, "ignore", "skip"),
      );
      card.append(buttons);
      card.addEventListener("click", (event) => {
        if (event.target instanceof HTMLButtonElement) {
          return;
        }
        selectedKey = key;
        updateSourcePreview(preview, entry);
        render();
      });
      return card;
    }

    function createLabelButton(key, value, text) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = labels.get(key) === value ? \`✓ \${text}\` : text;
      button.addEventListener("click", () => {
        if (labels.get(key) === value) {
          labels.delete(key);
        } else {
          labels.set(key, value);
        }
        saveLabels();
      });
      return button;
    }

    function downloadLabels() {
      const labeled = entries
        .filter((entry) => labels.has(entryKey(entry)))
        .map((entry) => ({
          ...entry,
          label: labels.get(entryKey(entry)),
        }));
      const blob = new Blob([JSON.stringify(labeled, null, 2) + "\\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "rune-cnn-labels.json";
      anchor.click();
      URL.revokeObjectURL(url);
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    for (const control of [expectationFilter, augmentationFilter, labelFilter]) {
      control.addEventListener("change", render);
    }
    document.getElementById("clearLabels").addEventListener("click", () => {
      if (confirm("현재 브라우저에 저장된 라벨을 모두 지울까요?")) {
        labels.clear();
        saveLabels();
      }
    });
    document.getElementById("downloadLabels").addEventListener("click", downloadLabels);
    render();
  </script>
</body>
</html>`;
}
