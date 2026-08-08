import { SINGLE_ICON_500001002_POLICY } from "./model.js";
import { createSingleIconMatcher } from "./runtime.js";

export type {
  SingleIconCandidateScore,
  SingleIconImage,
  SingleIconMatchResult,
  SingleIconMatcher,
  SingleIconPolicy,
  SingleIconPrototype,
} from "./runtime.js";

export { SINGLE_ICON_500001002_POLICY };
export { createSingleIconMatcher, describeSingleIconImage, singleIconFeatureLength } from "./runtime.js";

export function create500001002IconMatcher() {
  return createSingleIconMatcher(SINGLE_ICON_500001002_POLICY);
}
