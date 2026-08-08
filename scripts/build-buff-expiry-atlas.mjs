import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const sourceRootCandidates = [
  process.argv[2],
  process.env.BUFF_EXPIRY_REFS_DIR,
  path.resolve("../maple-buff-detact/countdown_refs"),
  path.resolve("../../maple-buff-detact/countdown_refs"),
  path.resolve("../../../maple-buff-detact/countdown_refs"),
].filter(Boolean);
const SOURCE_ROOT = sourceRootCandidates.find((candidate) => fs.existsSync(candidate));

if (!SOURCE_ROOT) {
  throw new Error(
    "Cannot find countdown_refs. Pass the path as the first argument or set BUFF_EXPIRY_REFS_DIR.",
  );
}

const MANIFEST_PATH = path.join(SOURCE_ROOT, "manifest.json");
const OUTPUT_DIR = path.resolve("public/buff-expiry");
const ATLAS_PATH = path.join(OUTPUT_DIR, "countdown-atlas.png");
const METADATA_PATH = path.join(OUTPUT_DIR, "countdown-metadata.json");

const CELL_SIZE = 32;
const COLUMNS = 16;
const INITIAL_MIN_SECONDS = 21;
const INITIAL_MAX_SECONDS = 59;
const EXCLUDED_BUFF_IDS = new Set([
  // 익스 골드는 사냥 종료 알림의 지원 대상에서 제외했다.
  "extreme_gold",
]);
const COUNTDOWN_REFERENCE_ALIASES = {};

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const activeSamples = manifest.samples.filter(
  (sample) =>
    !EXCLUDED_BUFF_IDS.has(sample.buffId) &&
    sample.kind === "second" &&
    sample.seconds >= INITIAL_MIN_SECONDS &&
    sample.seconds <= INITIAL_MAX_SECONDS,
);

if (!activeSamples.length) {
  throw new Error("No active countdown samples found.");
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const rows = Math.ceil(activeSamples.length / COLUMNS);
const atlas = new PNG({
  width: COLUMNS * CELL_SIZE,
  height: rows * CELL_SIZE,
  colorType: 6,
});
atlas.data.fill(0);

const samples = activeSamples.map((sample, index) => {
  const canonicalSample = canonicalizeCountdownSample(sample);
  const sourcePath = path.join(SOURCE_ROOT, sample.normalizedFile);
  const icon = PNG.sync.read(fs.readFileSync(sourcePath));
  if (icon.width !== CELL_SIZE || icon.height !== CELL_SIZE) {
    throw new Error(`Unexpected icon size for ${sample.normalizedFile}: ${icon.width}x${icon.height}`);
  }

  const atlasX = (index % COLUMNS) * CELL_SIZE;
  const atlasY = Math.floor(index / COLUMNS) * CELL_SIZE;

  for (let y = 0; y < CELL_SIZE; y += 1) {
    const sourceOffset = y * CELL_SIZE * 4;
    const targetOffset = ((atlasY + y) * atlas.width + atlasX) * 4;
    icon.data.copy(atlas.data, targetOffset, sourceOffset, sourceOffset + CELL_SIZE * 4);
  }

  return {
    id: `${canonicalSample.buffId}:${sample.seconds}:${index}`,
    buffId: canonicalSample.buffId,
    name: canonicalSample.name,
    kind: sample.kind,
    seconds: sample.seconds,
    file: sample.file,
    normalizedFile: sample.normalizedFile,
    atlas: {
      x: atlasX,
      y: atlasY,
      width: CELL_SIZE,
      height: CELL_SIZE,
    },
  };
});

fs.writeFileSync(ATLAS_PATH, PNG.sync.write(atlas));
fs.writeFileSync(
  METADATA_PATH,
  `${JSON.stringify(
    {
      version: 1,
      builtAt: new Date().toISOString(),
      source: MANIFEST_PATH,
      canonicalSize: CELL_SIZE,
      initialMinSeconds: INITIAL_MIN_SECONDS,
      initialMaxSeconds: INITIAL_MAX_SECONDS,
      atlas: {
        file: "countdown-atlas.png",
        width: atlas.width,
        height: atlas.height,
        columns: COLUMNS,
        cellSize: CELL_SIZE,
      },
      buffs: manifest.buffs.map(canonicalizeCountdownBuff),
      samples,
    },
    null,
    2,
  )}\n`,
);

console.log(`Wrote ${samples.length} active countdown samples.`);
console.log(ATLAS_PATH);
console.log(METADATA_PATH);

function canonicalizeCountdownSample(sample) {
  const alias = COUNTDOWN_REFERENCE_ALIASES[sample.buffId];
  if (!alias) {
    return sample;
  }
  return {
    ...sample,
    buffId: alias.buffId,
    name: alias.name,
  };
}

function canonicalizeCountdownBuff(buff) {
  const alias = COUNTDOWN_REFERENCE_ALIASES[buff.buffId];
  if (!alias) {
    return buff;
  }
  return {
    ...buff,
    buffId: alias.buffId,
    name: alias.name,
  };
}
