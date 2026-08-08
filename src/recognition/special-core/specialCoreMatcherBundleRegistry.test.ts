import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSpecialCoreMatcherAssetUrl,
  SPECIAL_CORE_MATCHER_BUNDLE,
} from "./specialCoreMatcherBundleRegistry";

describe("specialCoreMatcherBundleRegistry", () => {
  it("pins the copied policy to the expected runtime model", () => {
    const policy = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "public/models/special-core-deep-v2/policy.json"),
        "utf8",
      ),
    ) as { bundleId?: string; modelId?: string; modelVersion?: string };

    expect(policy).toMatchObject({
      bundleId: SPECIAL_CORE_MATCHER_BUNDLE.bundleId,
      modelId: SPECIAL_CORE_MATCHER_BUNDLE.modelId,
      modelVersion: SPECIAL_CORE_MATCHER_BUNDLE.expectedModelVersion,
    });
  });

  it("cache-busts every asset with the pinned model version", () => {
    expect(buildSpecialCoreMatcherAssetUrl("special-core-deep-v2.onnx.data")).toBe(
      "/models/special-core-deep-v2/special-core-deep-v2.onnx.data?v=special-core-20260711-v2",
    );
  });
});
