import { describe, expect, it } from "vitest";
import {
  BUFF_GROUP_MATCHER_BUNDLE_DESCRIPTORS,
  buildBuffGroupMatcherBundleAssetUrl,
  getBuffGroupMatcherBundleDescriptor,
  getRequiredBuffGroupMatcherBundleDescriptors,
} from "./buffGroupMatcherBundleRegistry";

describe("buff group matcher bundle registry", () => {
  it("registers one independent bundle for every supported group", () => {
    expect(BUFF_GROUP_MATCHER_BUNDLE_DESCRIPTORS.map((descriptor) => descriptor.group)).toEqual([
      "unionWealth",
      "unionLuck",
      "potion",
      "expCoupon",
    ]);
    expect(new Set(BUFF_GROUP_MATCHER_BUNDLE_DESCRIPTORS.map((descriptor) => descriptor.bundleId)).size)
      .toBe(4);
  });

  it("returns only bundles required by active groups in stable registry order", () => {
    expect(
      getRequiredBuffGroupMatcherBundleDescriptors(["expCoupon", "unionLuck", "expCoupon"])
        .map((descriptor) => descriptor.group),
    ).toEqual(["unionLuck", "expCoupon"]);
  });

  it("cache-busts portable bundle paths with the pinned model version", () => {
    const descriptor = getBuffGroupMatcherBundleDescriptor("potion");
    expect(buildBuffGroupMatcherBundleAssetUrl(descriptor, "policy.json")).toBe(
      "/models/buff-group-potion-deep-v1/policy.json?v=potion-20260711-v1",
    );
    expect(() => buildBuffGroupMatcherBundleAssetUrl(descriptor, "../policy.json")).toThrow(
      "invalid-buff-group-matcher-asset-path",
    );
  });
});
