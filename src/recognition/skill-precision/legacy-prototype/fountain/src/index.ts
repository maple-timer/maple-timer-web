import { FOUNTAIN_POLICY } from "./model.js";
import { createSingleIconMatcher } from "./runtime.js";

export type {
  SingleIconCandidateScore,
  SingleIconImage,
  SingleIconMatchResult,
  SingleIconMatcher,
  SingleIconPolicy,
  SingleIconPrototype,
} from "./runtime.js";

export { FOUNTAIN_POLICY };
export { createSingleIconMatcher, describeSingleIconImage, singleIconFeatureLength } from "./runtime.js";

export function createFountainMatcher() {
  return createSingleIconMatcher(FOUNTAIN_POLICY);
}
