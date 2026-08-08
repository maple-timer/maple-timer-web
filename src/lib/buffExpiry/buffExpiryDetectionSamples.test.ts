import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";

type FeedbackDetectionSample = {
  kind: "feedback";
  id: string;
  imageData: ImageData;
  expectedBoxCount: number;
  sideCandidates: number[];
  reason: string;
};

type ExternalDetectionSample = {
  kind: "external";
  fileName: string;
  imageData: ImageData;
  expectedBoxCount: number;
  expectedRowsOptions: number[][];
};

type DetectorResult = {
  boxes: Array<Record<string, unknown>>;
  rowCounts: number[];
  unsupported?: boolean;
};

type DetectorModule = {
  detectBuffs: (
    imageData: ImageData,
    options?: Record<string, unknown>,
  ) => DetectorResult;
};

type ExternalManifest = {
  images?: Array<{
    fileName?: string;
    expected?: number;
    expectedRowsOptions?: unknown;
    needsReview?: boolean;
  }>;
};

const SAMPLE_DIR = process.env.BUFF_EXPIRY_DETECTION_SAMPLE_DIR
  ? resolve(process.env.BUFF_EXPIRY_DETECTION_SAMPLE_DIR)
  : resolve(process.cwd(), "debug-samples/test-resources/buff-expiry/_legacy-detection");

const detectorModuleUrl = pathToFileURL(
  resolve("public/buff-expiry/external/src/detector/detect-buffs.js"),
).href;
const detectorModule = await import(
  /* @vite-ignore */ detectorModuleUrl
) as DetectorModule;

// Detection media stays in gitignored debug-samples. This committed test code
// makes future feedback samples reusable by dropping JSON/PNG files into:
// debug-samples/test-resources/buff-expiry/detection/{feedback,external}.
const feedbackSamples = loadFeedbackSamples(resolve(SAMPLE_DIR, "feedback"));
const externalSamples = loadExternalSamples(resolve(SAMPLE_DIR, "external"));

(feedbackSamples.length ? describe : describe.skip)("local buff expiry feedback detection samples", () => {
  it.each(feedbackSamples)(
    "detects only the true buff stack for $id",
    (sample) => {
      const result = detectorModule.detectBuffs(sample.imageData, {
        fallbackSides: sample.sideCandidates,
        forceFallbackSides: true,
        roiStartXRatio: 0,
        roiEndYRatio: 1,
      });

      expect(result.boxes).toHaveLength(sample.expectedBoxCount);
    },
  );
});

(externalSamples.length ? describe : describe.skip)("external buff detector regression samples", () => {
  it.each(externalSamples)(
    "keeps expected buff rows for $fileName",
    (sample) => {
      const result = detectorModule.detectBuffs(sample.imageData);
      const expectedBoxCounts = new Set(
        sample.expectedRowsOptions.map((option) => option.reduce((sum, count) => sum + count, 0)),
      );

      expect(result.unsupported).not.toBe(true);
      expect(expectedBoxCounts.has(result.boxes.length)).toBe(true);
      expect(sample.expectedRowsOptions).toContainEqual(result.rowCounts);
    },
  );
});

function loadFeedbackSamples(directory: string): FeedbackDetectionSample[] {
  if (!existsSync(directory)) {
    return [];
  }

  return walkFiles(directory)
    .filter((filePath) => filePath.endsWith(".json"))
    .flatMap((jsonPath) => {
      const metadata = JSON.parse(readFileSync(jsonPath, "utf8")) as unknown;
      const expectation = feedbackExpectationFromMetadata(metadata);
      if (!expectation) {
        return [];
      }

      const id = basename(jsonPath, ".json");
      const rawPngPath = resolve(directory, `${id}-raw.png`);
      const png = existsSync(rawPngPath)
        ? readFileSync(rawPngPath)
        : pngBufferFromMetadata(metadata);
      if (!png) {
        return [];
      }

      return [{
        kind: "feedback" as const,
        id,
        imageData: imageDataFromPng(png),
        expectedBoxCount: expectation.expectedBoxCount,
        sideCandidates: expectation.sideCandidates,
        reason: expectation.reason,
      }];
    });
}

function loadExternalSamples(directory: string): ExternalDetectionSample[] {
  const manifestPath = resolve(directory, "manifest.json");
  if (!existsSync(manifestPath)) {
    return [];
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExternalManifest;
  return (manifest.images ?? []).flatMap((entry) => {
    if (entry.needsReview || typeof entry.fileName !== "string") {
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
    if (!existsSync(imagePath) || extname(imagePath).toLowerCase() !== ".png") {
      return [];
    }

    return [{
      kind: "external" as const,
      fileName: entry.fileName,
      imageData: imageDataFromPng(readFileSync(imagePath)),
      expectedBoxCount: entry.expected,
      expectedRowsOptions,
    }];
  });
}

function feedbackExpectationFromMetadata(
  metadata: unknown,
): Pick<FeedbackDetectionSample, "expectedBoxCount" | "sideCandidates" | "reason"> | null {
  if (!isRecord(metadata) || !isRecord(metadata.expectation)) {
    return null;
  }

  const { expectation } = metadata;
  if (
    expectation.kind !== "detect-buff-box-count"
    && expectation.kind !== "reject-extra-background-boxes"
  ) {
    return null;
  }
  if (typeof expectation.expectedBoxCount !== "number") {
    return null;
  }
  if (!Array.isArray(expectation.sideCandidates)) {
    return null;
  }

  const sideCandidates = expectation.sideCandidates.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (!sideCandidates.length) {
    return null;
  }

  return {
    expectedBoxCount: expectation.expectedBoxCount,
    sideCandidates,
    reason: typeof expectation.reason === "string" ? expectation.reason : "unknown",
  };
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

function imageDataFromPng(pngBuffer: Buffer): ImageData {
  const png = PNG.sync.read(pngBuffer);
  return new ImageData(new Uint8ClampedArray(png.data), png.width, png.height);
}

function walkFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = resolve(directory, entry.name);
    return entry.isDirectory() ? walkFiles(filePath) : [filePath];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
