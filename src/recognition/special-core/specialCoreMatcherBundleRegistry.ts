export const SPECIAL_CORE_MATCHER_BUNDLE = {
  bundleId: "special-core-deep-v2",
  modelId: "special-core-deep-v2",
  expectedModelVersion: "special-core-20260711-v2",
  basePath: "/models/special-core-deep-v2",
  policyFile: "policy.json",
  cacheKey: "special-core-20260711-v2",
} as const;

export function buildSpecialCoreMatcherAssetUrl(relativePath: string): string {
  const normalizedPath = relativePath.replace(/^\.\//, "");
  return `${SPECIAL_CORE_MATCHER_BUNDLE.basePath}/${normalizedPath}?v=${encodeURIComponent(
    SPECIAL_CORE_MATCHER_BUNDLE.cacheKey,
  )}`;
}
