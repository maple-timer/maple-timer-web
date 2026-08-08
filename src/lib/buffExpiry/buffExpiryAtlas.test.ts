import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

type AtlasMetadata = {
  canonicalSize: number;
  initialMinSeconds: number;
  initialMaxSeconds: number;
  source?: string | string[];
  samples: Array<{
    id: string;
    buffId: string;
    name: string;
    kind: string;
    seconds: number;
    file: string;
    sourceSet?: string;
    atlas: { x: number; y: number; width: number; height: number };
  }>;
};

type ImageDataLike = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

describe("buff expiry countdown atlas", () => {
  it("contains initial countdown samples that self-match through the imported matcher", async () => {
    const metadata = readAtlasMetadata();
    const atlas = PNG.sync.read(readFileSync(assetPath("../../../public/buff-expiry/countdown-atlas.png")));
    const matcherModuleUrl = pathToFileURL(
      assetPath("../../../public/buff-expiry/external/src/recognition/countdown-matcher.js"),
    ).href;
    const matcherModule = await import(
      /* @vite-ignore */ matcherModuleUrl
    );

    const samples = metadata.samples.map((sample) => ({
      ...sample,
      normalizedIcon: cropAtlasIcon(atlas, sample.atlas),
    }));
    const matcher = matcherModule.prepareInitialCountdownMatcher(samples, {
      stage1TopBuffs: 7,
    });
    const results = matcherModule.rankInitialCountdownMatches(
      samples.map((sample) => ({ normalizedIcon: sample.normalizedIcon })),
      matcher,
    );

    expect(metadata.canonicalSize).toBe(32);
    expect(metadata.initialMinSeconds).toBe(21);
    expect(metadata.initialMaxSeconds).toBe(59);
    expect(samples).toHaveLength(1170);
    expect(matcher.activeSampleCount).toBe(1170);
    expect(samples.filter((sample) => sample.sourceSet === "legacy")).toHaveLength(585);
    expect(samples.filter((sample) => sample.sourceSet === "new")).toHaveLength(585);
    expect(samples.some((sample) => sample.buffId === "extreme_gold")).toBe(false);
    expect(samples.some((sample) => sample.buffId === "mvp_exp_3x_coupon")).toBe(true);
    expect(samples.some((sample) => sample.buffId === "exp_3x_coupon")).toBe(true);
    expect(samples.some((sample) => sample.buffId === "exp_4x_coupon")).toBe(true);
    expect(samples.some((sample) => sample.buffId === "bonus_exp_coupon_50")).toBe(true);
    expect(samples.some((sample) => sample.buffId === "mvp_bonus_exp_coupon_50")).toBe(true);
    expect(samples.some((sample) => sample.buffId === "mvp_exp_4x_coupon" && sample.seconds === 41)).toBe(true);
    expect(samples.some((sample) => sample.buffId === "mvp_exp_coupon_70" && sample.seconds === 41)).toBe(true);
    expect(
      samples.some((sample) => sample.buffId === "small_exp_accumulation_potion" && sample.seconds === 41),
    ).toBe(true);
    expect(samples.filter((sample) => sample.buffId === "union_luck")).toHaveLength(234);
    expect(samples.filter((sample) => sample.buffId === "union_wealth")).toHaveLength(234);
    expect(samples.some((sample) => sample.file.startsWith("union_luck_i/"))).toBe(true);
    expect(samples.some((sample) => sample.file.startsWith("union_luck_ii/"))).toBe(true);
    expect(samples.some((sample) => sample.file.startsWith("union_wealth_i/"))).toBe(true);
    expect(samples.some((sample) => sample.file.startsWith("union_wealth_ii/"))).toBe(true);
    expect(results).toHaveLength(samples.length);

    const failures = results.flatMap((result: { countdownMatch?: unknown }, index: number) =>
      result.countdownMatch ? [] : [samples[index].id],
    );
    expect(failures).toEqual([]);

    for (const [index, result] of results.entries()) {
      const match = result.countdownMatch as { buffId: string; seconds: number };
      expect(match.buffId).toBe(samples[index].buffId);
      expect(match.seconds).toBe(samples[index].seconds);
    }
  });
});

function readAtlasMetadata(): AtlasMetadata {
  return JSON.parse(
    readFileSync(assetPath("../../../public/buff-expiry/countdown-metadata.json"), "utf8"),
  ) as AtlasMetadata;
}

function cropAtlasIcon(
  atlas: PNG,
  region: { x: number; y: number; width: number; height: number },
): ImageDataLike {
  const data = new Uint8ClampedArray(region.width * region.height * 4);
  for (let y = 0; y < region.height; y += 1) {
    const sourceStart = ((region.y + y) * atlas.width + region.x) * 4;
    const sourceEnd = sourceStart + region.width * 4;
    data.set(atlas.data.subarray(sourceStart, sourceEnd), y * region.width * 4);
  }
  return { width: region.width, height: region.height, data };
}

function assetPath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}
