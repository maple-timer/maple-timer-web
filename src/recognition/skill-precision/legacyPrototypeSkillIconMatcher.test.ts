import { describe, expect, it } from "vitest";
import {
  createSkillIconMatcher,
  SKILL_ICON_DETECTOR_DEFINITIONS,
  SKILL_ICON_MATCHER_VERSION,
} from "./legacy-prototype/src";

describe("legacy prototype skill icon matcher", () => {
  it("keeps the stored prototype detector contract available", () => {
    expect(SKILL_ICON_DETECTOR_DEFINITIONS.map((definition) => ({
      id: definition.id,
      skillId: definition.skillId,
      version: definition.policy.version,
    }))).toEqual([
      {
        id: "hologramGraffitiBarrierVi",
        skillId: "hologramGraffitiBarrierVi",
        version: "single-icon-hologram-graffiti-barrier-vi-v1-20260619-bandicam1",
      },
    ]);
    expect(SKILL_ICON_MATCHER_VERSION).toBe(
      "hologramGraffitiBarrierVi@single-icon-hologram-graffiti-barrier-vi-v1-20260619-bandicam1",
    );

    const matcher = createSkillIconMatcher({
      enabledIds: ["hologramGraffitiBarrierVi"],
    });
    expect(matcher.version).toBe(SKILL_ICON_MATCHER_VERSION);
    expect(matcher.detectors).toHaveLength(1);
  });
});
