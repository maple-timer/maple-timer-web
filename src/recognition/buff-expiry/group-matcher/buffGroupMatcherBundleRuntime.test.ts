import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUFF_GROUP_MATCHER_BUNDLE_DESCRIPTORS,
} from "./buffGroupMatcherBundleRegistry";
import {
  getBuffGroupMatcherModelStatus,
  parseBuffGroupMatcherBundlePolicy,
} from "./buffGroupMatcherBundleRuntime";

describe("buff group matcher bundle runtime", () => {
  it.each(BUFF_GROUP_MATCHER_BUNDLE_DESCRIPTORS)(
    "accepts the copied $bundleId policy contract",
    (descriptor) => {
      const value = JSON.parse(readFileSync(
        resolve(process.cwd(), `public${descriptor.rootPath}/${descriptor.policyFile}`),
        "utf8",
      ));
      const policy = parseBuffGroupMatcherBundlePolicy(value, descriptor);

      expect(policy.bundleId).toBe(descriptor.bundleId);
      expect(policy.modelVersion).toBe(descriptor.expectedModelVersion);
      expect(policy.groups).toEqual([descriptor.group]);
    },
  );

  it("aggregates bundle load status without hiding errors", () => {
    const base = {
      group: "potion" as const,
      bundleId: "buff-group-potion-deep-v1" as const,
      modelVersion: "test",
      error: null,
    };
    expect(getBuffGroupMatcherModelStatus([])).toBe("idle");
    expect(getBuffGroupMatcherModelStatus([{ ...base, status: "ready" }])).toBe("ready");
    expect(getBuffGroupMatcherModelStatus([{ ...base, status: "loading" }])).toBe("loading");
    expect(getBuffGroupMatcherModelStatus([
      { ...base, status: "loading" },
      { ...base, status: "error", error: "failed" },
    ])).toBe("error");
  });
});
