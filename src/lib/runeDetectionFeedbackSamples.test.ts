import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { detectRuneInMinimap } from "./runeDetection";

type LocalRuneSample = {
  id: string;
  expectation: "detect" | "reject";
  reason: string;
  imageData: ImageData;
};

const SAMPLE_DIR = process.env.RUNE_FEEDBACK_SAMPLE_DIR
  ? resolve(process.env.RUNE_FEEDBACK_SAMPLE_DIR)
  : resolve(process.cwd(), "debug-samples/test-resources/rune/feedback");

// Real feedback images stay in gitignored debug-samples. The test logic is
// committed so new feedback cases automatically become regression samples.
const localSamples = loadLocalRuneSamples(SAMPLE_DIR);
const shouldRunLocalSamples = localSamples.length > 0;

(shouldRunLocalSamples ? describe : describe.skip)("local rune feedback image samples", () => {
  it.each(localSamples.filter((sample) => sample.expectation === "detect"))(
    "detects reported rune sample $id",
    (sample) => {
      const result = detectRuneInMinimap(sample.imageData);

      expect(result.detected).toBe(true);
    },
  );

  it.each(localSamples.filter((sample) => sample.expectation === "reject"))(
    "rejects reported false-positive sample $id",
    (sample) => {
      const result = detectRuneInMinimap(sample.imageData);

      expect(result.detected).toBe(false);
    },
  );
});

function loadLocalRuneSamples(directory: string): LocalRuneSample[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".json"))
    .flatMap((fileName) => {
      const jsonPath = resolve(directory, fileName);
      const metadata = JSON.parse(readFileSync(jsonPath, "utf8")) as unknown;
      const id = fileName.replace(/\.json$/, "");
      const expectation = expectationFromMetadata(metadata);
      if (!expectation) {
        return [];
      }

      const pngPath = resolve(directory, `${id}-raw.png`);
      const png = existsSync(pngPath)
        ? readFileSync(pngPath)
        : pngBufferFromMetadata(metadata);
      if (!png) {
        return [];
      }

      return [{
        id,
        expectation,
        reason: reportReasonFromMetadata(metadata) ?? "unknown",
        imageData: imageDataFromPng(png),
      }];
    });
}

function expectationFromMetadata(metadata: unknown): LocalRuneSample["expectation"] | null {
  const reason = reportReasonFromMetadata(metadata);
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

function imageDataFromPng(pngBuffer: Buffer): ImageData {
  const png = PNG.sync.read(pngBuffer);
  return new ImageData(new Uint8ClampedArray(png.data), png.width, png.height);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
