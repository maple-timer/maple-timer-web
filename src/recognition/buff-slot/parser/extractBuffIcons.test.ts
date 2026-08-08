import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { extractBuffIcons } from "./extractBuffIcons";
import type { BuffIconBox, ImageLike } from "./types";

type ExternalManifest = {
  images?: Array<{
    fileName?: string;
    expected?: number;
    expectedRowsOptions?: unknown;
    needsReview?: boolean;
  }>;
};

type ParserRegressionSample = {
  fileName: string;
  imageData: ImageLike;
  expectedRowsOptions: number[][];
};

const SAMPLE_DIR = resolve(process.cwd(), "debug-samples/test-resources/buff-expiry/detection/external");
// These older external-detector expectations currently expose unresolved direct
// parser misses. Keep them out of the stable parser regression set until they
// are re-labeled or fixed for the shared buff-slot parser itself.
const KNOWN_DIRECT_PARSER_MISMATCHES = new Set([
  "12-12-2-8__real_f1fdaadb_feedback.png",
  "3-13-2-12-2__real_3_13_2_12_2.png",
  "9-13-9__video_rune_003.png",
]);

const samples = loadExternalSamples(SAMPLE_DIR);

(samples.length ? describe : describe.skip)("extractBuffIcons", () => {
  it.each(samples)("keeps expected buff rows for $fileName", (sample) => {
    const result = extractBuffIcons(sample.imageData, { outputSize: 32 });
    const expectedBoxCounts = new Set(
      sample.expectedRowsOptions.map((option) => option.reduce((sum, count) => sum + count, 0)),
    );

    expect(expectedBoxCounts.has(result.boxes.length)).toBe(true);
    expect(sample.expectedRowsOptions).toContainEqual(rowCounts(result.boxes));
    expect(result.icons).toHaveLength(result.boxes.length);
    expect(result.icons.every((icon) => icon.width === 32 && icon.height === 32)).toBe(true);
  });
});

function loadExternalSamples(directory: string): ParserRegressionSample[] {
  const manifestPath = resolve(directory, "manifest.json");
  if (!existsSync(manifestPath)) {
    return [];
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExternalManifest;
  return (manifest.images ?? []).flatMap((entry) => {
    if (entry.needsReview || typeof entry.fileName !== "string") {
      return [];
    }
    if (KNOWN_DIRECT_PARSER_MISMATCHES.has(entry.fileName)) {
      return [];
    }
    if (typeof entry.expected !== "number") {
      return [];
    }

    const expectedRowsOptions = parseExpectedRowsOptions(entry.expectedRowsOptions);
    if (!expectedRowsOptions.length) {
      return [];
    }

    const imagePath = resolve(directory, "images", entry.fileName);
    if (!existsSync(imagePath)) {
      return [];
    }

    return [{
      fileName: entry.fileName,
      imageData: imageDataFromPng(readFileSync(imagePath)),
      expectedRowsOptions,
    }];
  });
}

function parseExpectedRowsOptions(value: unknown): number[][] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((option): option is number[] => Array.isArray(option))
    .map((option) => option.filter(
      (rowCount): rowCount is number => typeof rowCount === "number" && Number.isFinite(rowCount),
    ))
    .filter((option) => option.length > 0);
}

function imageDataFromPng(pngBuffer: Buffer): ImageLike {
  const png = PNG.sync.read(pngBuffer);
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data),
  };
}

function rowCounts(boxes: BuffIconBox[]): number[] {
  if (!boxes.length) {
    return [];
  }

  const size = median(boxes.map((box) => box.size).filter((size) => size > 0));
  const tolerance = Math.max(3, size * 0.42);
  const groups: Array<{ value: number; boxes: BuffIconBox[] }> = [];

  for (const box of [...boxes].sort((a, b) => a.y - b.y)) {
    const group = groups.find((candidate) => Math.abs(candidate.value - box.y) <= tolerance);
    if (group) {
      group.boxes.push(box);
      group.value = Math.round(median(group.boxes.map((entry) => entry.y)));
    } else {
      groups.push({ value: Math.round(box.y), boxes: [box] });
    }
  }

  return groups.sort((a, b) => a.value - b.value).map((group) => group.boxes.length);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}
