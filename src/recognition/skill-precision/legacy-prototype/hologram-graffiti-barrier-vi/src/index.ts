import { HOLOGRAM_GRAFFITI_BARRIER_VI_POLICY } from "./model.js";
import { createSingleIconMatcher } from "./runtime.js";

export type {
  SingleIconCandidateScore,
  SingleIconImage,
  SingleIconMatchResult,
  SingleIconMatcher,
  SingleIconPolicy,
  SingleIconPrototype,
} from "./runtime.js";

export { HOLOGRAM_GRAFFITI_BARRIER_VI_POLICY };
export { createSingleIconMatcher, describeSingleIconImage, singleIconFeatureLength } from "./runtime.js";

export function createHologramGraffitiBarrierViMatcher() {
  return createSingleIconMatcher(HOLOGRAM_GRAFFITI_BARRIER_VI_POLICY);
}
