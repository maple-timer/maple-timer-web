import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { PNG } from "pngjs";

const args = process.argv.slice(2);
if (!args.length || args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(args.length ? 0 : 1);
}

const options = parseArgs(args);
const framesDir = resolve(options.positionals[0]);
if (!existsSync(framesDir)) {
  throw new Error(`Frame directory does not exist: ${framesDir}`);
}

const outputPath = resolve(options.output ?? getDefaultOutputPath(framesDir));
const outputDir = dirname(outputPath);
const frameFiles = readdirSync(framesDir)
  .filter((file) => extname(file).toLowerCase() === ".png")
  .sort(naturalCompare);

if (!frameFiles.length) {
  throw new Error(`No PNG frames found in: ${framesDir}`);
}

const fps = Number(options.fps ?? "1");
if (!Number.isFinite(fps) || fps <= 0) {
  throw new Error(`Invalid fps: ${options.fps}`);
}

mkdirSync(outputDir, { recursive: true });

const frames = frameFiles.map((file, index) => {
  const absolutePath = resolve(framesDir, file);
  const png = PNG.sync.read(readFileSync(absolutePath));
  return {
    index,
    second: parseFrameSecond(file) ?? Math.round((index / fps) * 1000) / 1000,
    file: normalizeManifestPath(relative(outputDir, absolutePath)),
    width: png.width,
    height: png.height,
  };
});

const manifest = {
  sourceVideo: options.sourceVideo ?? null,
  sourceUrl: options.sourceUrl ?? null,
  sourceWidth: options.sourceWidth ?? null,
  sourceHeight: options.sourceHeight ?? null,
  captureRoi: options.roi ?? null,
  id: options.id ?? basename(outputDir),
  title: options.title ?? options.id ?? basename(outputDir),
  fps,
  sampling: `${fps} frame${fps === 1 ? "" : "s"} per second`,
  frameCount: frames.length,
  frames,
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Manifest: ${outputPath}`);
console.log(`Frames: ${frames.length}`);
console.log(`Audit input: ${outputDir}`);

function parseArgs(rawArgs) {
  const parsed = {
    positionals: [],
    output: null,
    fps: null,
    id: null,
    title: null,
    sourceVideo: null,
    sourceUrl: null,
    sourceWidth: null,
    sourceHeight: null,
    roi: null,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      parsed.positionals.push(arg);
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? rawArgs[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }
    if (value === undefined) {
      throw new Error(`Missing value for --${key}`);
    }

    switch (key) {
      case "output":
        parsed.output = value;
        break;
      case "fps":
        parsed.fps = value;
        break;
      case "id":
        parsed.id = value;
        break;
      case "title":
        parsed.title = value;
        break;
      case "source-video":
        parsed.sourceVideo = value;
        break;
      case "source-url":
        parsed.sourceUrl = value;
        break;
      case "source-width":
        parsed.sourceWidth = Number(value);
        break;
      case "source-height":
        parsed.sourceHeight = Number(value);
        break;
      case "roi":
        parsed.roi = parseRoi(value);
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if ((parsed.sourceWidth || parsed.sourceHeight || parsed.roi) && !(parsed.sourceWidth && parsed.sourceHeight && parsed.roi)) {
    throw new Error("--source-width, --source-height, and --roi must be provided together.");
  }

  if (parsed.positionals.length !== 1) {
    throw new Error("Expected exactly one frame directory.");
  }
  return parsed;
}

function getDefaultOutputPath(frameDir) {
  if (basename(frameDir) === "frames") {
    return resolve(dirname(frameDir), "manifest.json");
  }
  return resolve(frameDir, "manifest.json");
}

function parseFrameSecond(file) {
  const match = file.match(/(?:^|[_-])sec[_-]?(\d+(?:\.\d+)?)(?:[_-]|\.)/i);
  return match ? Number(match[1]) : null;
}

function parseRoi(value) {
  const [x, y, width, height] = value.split(",").map(Number);
  if (![x, y, width, height].every((item) => Number.isFinite(item)) || width <= 0 || height <= 0) {
    throw new Error(`Invalid --roi value: ${value}. Expected x,y,width,height.`);
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function normalizeManifestPath(path) {
  return path.split("\\").join("/");
}

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function printUsage() {
  console.log(`Usage:
  node scripts/prepare-video-frame-manifest.mjs <frames-dir> [options]

Options:
  --output <path>       Manifest path. Defaults to ../manifest.json when frames-dir is named "frames".
  --fps <number>        Sampling rate used for sequential frame names. Defaults to 1.
  --id <id>             Video/sample id for the manifest.
  --title <title>       Human-readable title.
  --source-video <path> Original local video path.
  --source-url <url>    Original remote video URL.
  --source-width <px>   Original full-frame width when frames are pre-cropped.
  --source-height <px>  Original full-frame height when frames are pre-cropped.
  --roi <x,y,w,h>       Original capture ROI when frames are pre-cropped.
`);
}
