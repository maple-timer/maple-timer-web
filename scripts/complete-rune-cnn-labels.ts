import { dirname, resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

type RuneCnnLabel = "positive" | "negative" | "ignore";

type RuneCnnManifestEntry = {
  sampleId: string;
  sampleExpectation: "detect" | "reject";
  candidateIndex: number;
  augmentation: string;
  outputPath: string;
  outputUrl?: string;
  source: string;
  confidence: number;
  label?: RuneCnnLabel;
};

type Args = {
  manifest?: string;
  labels?: string;
  out?: string;
  defaultLabel?: RuneCnnLabel;
  detectDefaultLabel?: RuneCnnLabel;
  rejectDefaultLabel?: RuneCnnLabel;
  propagateAugmentation: boolean;
  positives: string[];
  selected?: string;
  ignoreSamples: string[];
};

type RuneCnnSelectedCandidate = Pick<RuneCnnManifestEntry, "sampleId" | "candidateIndex"> & {
  augmentation?: string;
  source?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

const args = parseArgs(process.argv.slice(2));

if (!args.labels && !args.selected) {
  throw new Error("Missing --labels <path> or --selected <path>. Use the review page download JSON as input.");
}

const manifestPath = resolve(args.manifest ?? "debug-samples/generated/rune-cnn-candidates/manifest.json");
const labelsPath = args.labels ? resolve(args.labels) : undefined;
const outPath = resolve(
  args.out ?? `${dirname(manifestPath)}/rune-cnn-labels.completed.json`,
);
const defaultLabel = args.defaultLabel ?? "negative";

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as RuneCnnManifestEntry[];
const partialLabels = labelsPath
  ? JSON.parse(readFileSync(labelsPath, "utf8")) as RuneCnnManifestEntry[]
  : [];
const exactLabels = new Map<string, RuneCnnLabel>();
const baseLabels = new Map<string, RuneCnnLabel>();
const positiveOverrideBaseLabels = new Set<string>();
const ignoredSamples = new Set(args.ignoreSamples);
const selectedStats = {
  input: 0,
  applied: 0,
  ignored: 0,
  missing: [] as RuneCnnSelectedCandidate[],
};

for (const entry of partialLabels) {
  if (!isLabel(entry.label)) {
    continue;
  }
  exactLabels.set(exactKey(entry), entry.label);
  baseLabels.set(baseKey(entry), entry.label);
}

if (args.selected) {
  const selectedPath = resolve(args.selected);
  const selectedCandidates = JSON.parse(readFileSync(selectedPath, "utf8")) as RuneCnnSelectedCandidate[];
  for (const entry of selectedCandidates) {
    selectedStats.input += 1;
    if (!entry.sampleId || !Number.isInteger(entry.candidateIndex)) {
      throw new Error(`Invalid selected candidate entry in ${selectedPath}`);
    }
    if (ignoredSamples.has(entry.sampleId)) {
      selectedStats.ignored += 1;
      continue;
    }
    const matchedEntry = findSelectedManifestEntry(manifest, entry);
    if (!matchedEntry) {
      selectedStats.missing.push(entry);
      continue;
    }
    selectedStats.applied += 1;
    baseLabels.set(baseKey(matchedEntry), "positive");
    positiveOverrideBaseLabels.add(baseKey(matchedEntry));
    if (entry.augmentation) {
      exactLabels.set(exactKey({
        sampleId: matchedEntry.sampleId,
        candidateIndex: matchedEntry.candidateIndex,
        augmentation: entry.augmentation,
      }), "positive");
    }
  }
}

for (const positive of args.positives) {
  const parsed = parsePositiveOverride(positive);
  if (ignoredSamples.has(parsed.sampleId)) {
    continue;
  }
  exactLabels.set(exactKey(parsed), "positive");
  baseLabels.set(baseKey(parsed), "positive");
  positiveOverrideBaseLabels.add(baseKey(parsed));
}

const completed = manifest.map((entry) => {
  const label = ignoredSamples.has(entry.sampleId)
    ? "ignore"
    : (args.propagateAugmentation && positiveOverrideBaseLabels.has(baseKey(entry))
        ? "positive"
        : undefined) ??
      exactLabels.get(exactKey(entry)) ??
      (args.propagateAugmentation ? baseLabels.get(baseKey(entry)) : undefined) ??
      defaultLabelForExpectation(entry, args, defaultLabel);
  return {
    ...entry,
    label,
  };
});

writeFileSync(outPath, `${JSON.stringify(completed, null, 2)}\n`);

const counts = completed.reduce<Record<string, number>>((acc, entry) => {
  acc[entry.label] = (acc[entry.label] ?? 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  manifest: manifestPath,
  labels: labelsPath,
  selected: args.selected ? resolve(args.selected) : undefined,
  out: outPath,
  total: completed.length,
  counts,
  ignoredSamples: Array.from(ignoredSamples).sort(),
  selectedStats,
}, null, 2));

function parseArgs(rawArgs: string[]): Args {
  const parsed: Args = {
    propagateAugmentation: true,
    positives: [],
    ignoreSamples: [],
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = rawArgs[index + 1] && !rawArgs[index + 1].startsWith("--")
      ? rawArgs[index + 1]
      : "true";
    if (value !== "true") {
      index += 1;
    }

    if (key === "positive") {
      parsed.positives.push(value);
      continue;
    }
    if (key === "ignoreSample") {
      parsed.ignoreSamples.push(value);
      continue;
    }
    if (key === "propagateAugmentation") {
      parsed.propagateAugmentation = value !== "false";
      continue;
    }
    if (key === "defaultLabel" || key === "detectDefaultLabel" || key === "rejectDefaultLabel") {
      if (!isLabel(value)) {
        throw new Error(`Invalid --${key}: ${value}`);
      }
      parsed[key] = value;
      continue;
    }
    if (key === "manifest" || key === "labels" || key === "out" || key === "selected") {
      parsed[key] = value;
    }
  }

  return parsed;
}

function parsePositiveOverride(value: string): Pick<RuneCnnManifestEntry, "sampleId" | "candidateIndex" | "augmentation"> {
  const [sampleId, candidateIndexText, augmentation = "base"] = value.split("::");
  const candidateIndex = Number.parseInt(candidateIndexText, 10);
  if (!sampleId || !Number.isInteger(candidateIndex) || candidateIndex < 0) {
    throw new Error(`Invalid --positive override: ${value}. Use sampleId::candidateIndex::augmentation.`);
  }
  return {
    sampleId,
    candidateIndex,
    augmentation,
  };
}

function exactKey(entry: Pick<RuneCnnManifestEntry, "sampleId" | "candidateIndex" | "augmentation">): string {
  return `${entry.sampleId}::${entry.candidateIndex}::${entry.augmentation}`;
}

function baseKey(entry: Pick<RuneCnnManifestEntry, "sampleId" | "candidateIndex">): string {
  return `${entry.sampleId}::${entry.candidateIndex}`;
}

function findSelectedManifestEntry(
  manifest: RuneCnnManifestEntry[],
  selected: RuneCnnSelectedCandidate,
): RuneCnnManifestEntry | undefined {
  const baseEntries = manifest.filter((entry) =>
    entry.sampleId === selected.sampleId && entry.augmentation === "base"
  );

  const geometryMatched = baseEntries.find((entry) =>
    selected.source === entry.source &&
    selected.x === entry.x &&
    selected.y === entry.y &&
    selected.width === entry.width &&
    selected.height === entry.height
  );
  if (geometryMatched) {
    return geometryMatched;
  }

  return baseEntries.find((entry) => entry.candidateIndex === selected.candidateIndex);
}

function defaultLabelForExpectation(
  entry: Pick<RuneCnnManifestEntry, "sampleExpectation">,
  parsedArgs: Pick<Args, "detectDefaultLabel" | "rejectDefaultLabel">,
  fallback: RuneCnnLabel,
): RuneCnnLabel {
  if (entry.sampleExpectation === "detect") {
    return parsedArgs.detectDefaultLabel ?? fallback;
  }
  return parsedArgs.rejectDefaultLabel ?? fallback;
}

function isLabel(value: unknown): value is RuneCnnLabel {
  return value === "positive" || value === "negative" || value === "ignore";
}
