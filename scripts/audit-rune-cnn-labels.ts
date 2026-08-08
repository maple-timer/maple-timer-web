import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type RuneCnnLabel = "positive" | "negative" | "ignore";

type RuneCnnLabeledEntry = {
  sampleId: string;
  sampleExpectation: "detect" | "reject";
  candidateIndex: number;
  augmentation: string;
  source: string;
  confidence: number;
  label: RuneCnnLabel;
};

const args = parseArgs(process.argv.slice(2));
const labelsPath = resolve(args.labels ?? args._[0] ?? "debug-samples/generated/rune-cnn-candidates/rune-cnn-labels.completed.json");
const entries = JSON.parse(readFileSync(labelsPath, "utf8")) as RuneCnnLabeledEntry[];

const samples = new Map<string, RuneCnnLabeledEntry[]>();
for (const entry of entries) {
  const key = entry.sampleId;
  const sampleEntries = samples.get(key) ?? [];
  sampleEntries.push(entry);
  samples.set(key, sampleEntries);
}

const labelCounts = countBy(entries, (entry) => entry.label);
const expectationCounts = countBy(entries, (entry) => entry.sampleExpectation);
const sourceByLabel = {
  positive: countBy(entries.filter((entry) => entry.label === "positive"), (entry) => entry.source),
  negative: countBy(entries.filter((entry) => entry.label === "negative"), (entry) => entry.source),
};

const sampleSummaries = Array.from(samples.entries()).map(([sampleId, sampleEntries]) => {
  const expectation = sampleEntries[0]?.sampleExpectation ?? "reject";
  const positives = sampleEntries.filter((entry) => entry.label === "positive");
  const runtimeEntries = sampleEntries.filter((entry) => entry.source !== "raw-purple-component");
  const topRuntime = runtimeEntries.reduce<RuneCnnLabeledEntry | null>(
    (best, entry) => (!best || entry.confidence > best.confidence ? entry : best),
    null,
  );
  const productionDetected = (topRuntime?.confidence ?? 0) >= 0.58;
  return {
    sampleId,
    expectation,
    candidateCount: sampleEntries.length,
    positiveCount: positives.length,
    productionDetected,
    topRuntime: topRuntime
      ? {
        source: topRuntime.source,
        confidence: topRuntime.confidence,
        label: topRuntime.label,
        candidateIndex: topRuntime.candidateIndex,
      }
      : null,
  };
});

const detectSamples = sampleSummaries.filter((sample) => sample.expectation === "detect");
const rejectSamples = sampleSummaries.filter((sample) => sample.expectation === "reject");
const missingPositiveDetectSamples = detectSamples.filter((sample) => sample.positiveCount === 0);
const positiveRejectSamples = rejectSamples.filter((sample) => sample.positiveCount > 0);

const productionMetrics = {
  truePositive: detectSamples.filter((sample) => sample.productionDetected).length,
  falseNegative: detectSamples.filter((sample) => !sample.productionDetected).length,
  trueNegative: rejectSamples.filter((sample) => !sample.productionDetected).length,
  falsePositive: rejectSamples.filter((sample) => sample.productionDetected).length,
};

const summary = {
  labelsPath,
  candidates: entries.length,
  samples: samples.size,
  labelCounts,
  expectationCounts,
  sourceByLabel,
  candidateGeneratorRecall: {
    detectSamples: detectSamples.length,
    detectSamplesWithPositive: detectSamples.length - missingPositiveDetectSamples.length,
    missingPositiveDetectSamples: missingPositiveDetectSamples.map((sample) => sample.sampleId),
    rejectSamplesWithPositive: positiveRejectSamples.map((sample) => sample.sampleId),
  },
  productionHeuristicOnSameSamples: productionMetrics,
};

console.log(JSON.stringify(summary, null, 2));

function parseArgs(rawArgs: string[]): { labels?: string; _: string[] } {
  const parsed: { labels?: string; _: string[] } = { _: [] };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--labels") {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --labels");
      }
      parsed.labels = value;
      index += 1;
      continue;
    }
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
    }
  }
  return parsed;
}

function countBy<T>(values: T[], getKey: (value: T) => string): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    const key = getKey(value);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}
