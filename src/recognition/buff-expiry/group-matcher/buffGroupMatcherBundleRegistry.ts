import type { BuffExpiryTargetGroup } from "../../../contracts/recognition/buffExpiryRecognition";

export type BuffGroupMatcherBundleId =
  | "buff-group-unionluck-deep-v1"
  | "buff-group-unionwealth-deep-v1"
  | "buff-group-potion-deep-v1"
  | "buff-group-expcoupon-deep-v1";

export type BuffGroupMatcherBundleDescriptor = {
  group: BuffExpiryTargetGroup;
  bundleId: BuffGroupMatcherBundleId;
  rootPath: string;
  policyFile: "policy.json";
  expectedModelVersion: string;
};

export const BUFF_GROUP_MATCHER_BUNDLE_DESCRIPTORS: readonly BuffGroupMatcherBundleDescriptor[] = [
  {
    group: "unionWealth",
    bundleId: "buff-group-unionwealth-deep-v1",
    rootPath: "/models/buff-group-unionwealth-deep-v1",
    policyFile: "policy.json",
    expectedModelVersion: "unionwealth-20260711-v1",
  },
  {
    group: "unionLuck",
    bundleId: "buff-group-unionluck-deep-v1",
    rootPath: "/models/buff-group-unionluck-deep-v1",
    policyFile: "policy.json",
    expectedModelVersion: "unionluck-20260711-v1",
  },
  {
    group: "potion",
    bundleId: "buff-group-potion-deep-v1",
    rootPath: "/models/buff-group-potion-deep-v1",
    policyFile: "policy.json",
    expectedModelVersion: "potion-20260711-v1",
  },
  {
    group: "expCoupon",
    bundleId: "buff-group-expcoupon-deep-v1",
    rootPath: "/models/buff-group-expcoupon-deep-v1",
    policyFile: "policy.json",
    expectedModelVersion: "expcoupon-20260711-v1",
  },
];

const DESCRIPTOR_BY_GROUP = new Map(
  BUFF_GROUP_MATCHER_BUNDLE_DESCRIPTORS.map((descriptor) => [descriptor.group, descriptor]),
);

export function getBuffGroupMatcherBundleDescriptor(
  group: BuffExpiryTargetGroup,
): BuffGroupMatcherBundleDescriptor {
  const descriptor = DESCRIPTOR_BY_GROUP.get(group);
  if (!descriptor) {
    throw new Error(`unregistered-buff-group-matcher:${group}`);
  }
  return descriptor;
}

export function getRequiredBuffGroupMatcherBundleDescriptors(
  activeGroups: readonly BuffExpiryTargetGroup[],
): BuffGroupMatcherBundleDescriptor[] {
  const activeSet = new Set(activeGroups);
  return BUFF_GROUP_MATCHER_BUNDLE_DESCRIPTORS.filter((descriptor) => (
    activeSet.has(descriptor.group)
  ));
}

export function buildBuffGroupMatcherBundleAssetUrl(
  descriptor: BuffGroupMatcherBundleDescriptor,
  relativePath: string,
): string {
  if (!isPortableBuffGroupMatcherAssetPath(relativePath)) {
    throw new Error(`invalid-buff-group-matcher-asset-path:${descriptor.bundleId}:${relativePath}`);
  }
  const version = encodeURIComponent(descriptor.expectedModelVersion);
  return `${descriptor.rootPath}/${relativePath}?v=${version}`;
}

function isPortableBuffGroupMatcherAssetPath(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\\")) {
    return false;
  }
  return !value.split("/").some((segment) => segment === ".." || segment === "");
}
