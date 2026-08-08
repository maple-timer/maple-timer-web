import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const FIXTURE_ROOT = path.resolve("src/lib/buffExpiry/__fixtures__/excluded-buffs");
const MANIFEST_PATH = path.join(FIXTURE_ROOT, "manifest.json");
const OUTPUT_DIR = path.resolve("public/buff-expiry");
const ATLAS_PATH = path.join(OUTPUT_DIR, "excluded-identity-atlas.png");
const METADATA_PATH = path.join(OUTPUT_DIR, "excluded-identity-metadata.json");

const CELL_SIZE = 32;

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const samples = manifest.groups.flatMap((group) => {
  if (Array.isArray(group.identityFiles) && group.identityFiles.length > 0) {
    return group.identityFiles.map((file) => ({
      id: group.id,
      label: makeVariantLabel(group.label, file),
      file,
    }));
  }
  if (group.identityFile) {
    return [{
      id: group.id,
      label: group.label,
      file: group.identityFile,
    }];
  }
  return [];
});

if (!samples.length) {
  throw new Error("No excluded identity samples found.");
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const atlas = new PNG({
  width: samples.length * CELL_SIZE,
  height: CELL_SIZE,
  colorType: 6,
});
atlas.data.fill(0);

const metadataSamples = samples.map((sample, index) => {
  const iconPath = path.join(FIXTURE_ROOT, sample.file);
  const icon = PNG.sync.read(fs.readFileSync(iconPath));
  if (icon.width !== CELL_SIZE || icon.height !== CELL_SIZE) {
    throw new Error(`Unexpected excluded identity icon size for ${sample.file}: ${icon.width}x${icon.height}`);
  }

  const atlasX = index * CELL_SIZE;
  for (let y = 0; y < CELL_SIZE; y += 1) {
    const sourceOffset = y * CELL_SIZE * 4;
    const targetOffset = (y * atlas.width + atlasX) * 4;
    icon.data.copy(atlas.data, targetOffset, sourceOffset, sourceOffset + CELL_SIZE * 4);
  }

  return {
    id: sample.id,
    label: sample.label,
    atlas: {
      x: atlasX,
      y: 0,
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
      atlas: {
        file: "excluded-identity-atlas.png",
        width: atlas.width,
        height: atlas.height,
        cellSize: CELL_SIZE,
      },
      samples: metadataSamples,
    },
    null,
    2,
  )}\n`,
);

console.log(`Wrote ${metadataSamples.length} excluded identity samples.`);
console.log(ATLAS_PATH);
console.log(METADATA_PATH);

function makeVariantLabel(label, file) {
  if (file.includes("expiring_lt_005")) {
    return `${label} <5s`;
  }
  const secondMatch = file.match(/sec_(\d+)/);
  if (secondMatch) {
    return `${label} ${Number(secondMatch[1])}s`;
  }
  return label;
}
