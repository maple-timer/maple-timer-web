import { describe, expect, it } from "vitest";
import { createDefaultProfile, createSkill } from "./profileFactory";
import { migrateProfileRegionsToGameViewport } from "./gameViewportRegionMigration";

const viewport = {
  mode: "calibrated" as const,
  sourceSize: { width: 1766, height: 968 },
  gameResolution: { width: 1366, height: 768 },
  region: { x: 200, y: 100, width: 1366, height: 768 },
  layoutKey: "game:1366x768",
  revision: 3,
};

describe("migrateProfileRegionsToGameViewport", () => {
  it("copies contained quick-slot and hunt regions without changing legacy keys", () => {
    const quickSlotRegion = {
      x: 1200 / 1766,
      y: 700 / 968,
      width: 60 / 1766,
      height: 60 / 968,
    };
    const experienceRegion = {
      x: 500 / 1766,
      y: 820 / 968,
      width: 600 / 1766,
      height: 8 / 968,
    };
    const profile = {
      ...createDefaultProfile(),
      skills: [
        createSkill({
          id: "quick",
          region: quickSlotRegion,
          regionsByLayout: {
            "1766x968": quickSlotRegion,
          },
        }),
      ],
      huntStallAlert: {
        ...createDefaultProfile().huntStallAlert!,
        manualExperienceRegion: experienceRegion,
        manualExperienceRegionsByLayout: {
          "1766x968": experienceRegion,
        },
      },
    };

    const migrated = migrateProfileRegionsToGameViewport({
      profile,
      captureLayoutKey: "1766x968",
      viewport,
    });

    expect(migrated.skills[0].region).toEqual(profile.skills[0].region);
    expect(migrated.skills[0].regionsByLayout?.["1766x968"]).toEqual(
      profile.skills[0].regionsByLayout?.["1766x968"],
    );
    expect(
      migrated.skills[0].regionsByLayout?.["game:1366x768"],
    ).toMatchObject({
      x: expect.closeTo(1000 / 1366, 5),
      y: expect.closeTo(600 / 768, 5),
      width: expect.closeTo(60 / 1366, 5),
      height: expect.closeTo(60 / 768, 5),
    });
    expect(
      migrated.huntStallAlert?.manualExperienceRegionsByLayout?.[
        "game:1366x768"
      ],
    ).toBeDefined();
  });

  it("does not migrate regions that cross the confirmed viewport boundary", () => {
    const outsideRegion = {
      x: 120 / 1766,
      y: 200 / 968,
      width: 120 / 1766,
      height: 80 / 968,
    };
    const profile = {
      ...createDefaultProfile(),
      skills: [
        createSkill({
          id: "outside",
          region: outsideRegion,
          regionsByLayout: { "1766x968": outsideRegion },
        }),
      ],
    };

    const migrated = migrateProfileRegionsToGameViewport({
      profile,
      captureLayoutKey: "1766x968",
      viewport,
    });

    expect(migrated).toBe(profile);
    expect(
      migrated.skills[0].regionsByLayout?.["game:1366x768"],
    ).toBeUndefined();
  });

  it("leaves precision skills and an existing game-space crop unchanged", () => {
    const existingGameRegion = {
      x: 0.8,
      y: 0.8,
      width: 0.04,
      height: 0.07,
    };
    const profile = {
      ...createDefaultProfile(),
      skills: [
        createSkill({
          id: "precision",
          presetId: "sol-janus-dawn-deep-v2",
          regionsByLayout: {
            "1766x968": { x: 0.7, y: 0.7, width: 0.04, height: 0.07 },
          },
        }),
        createSkill({
          id: "existing",
          regionsByLayout: {
            "game:1366x768": existingGameRegion,
          },
        }),
      ],
    };

    const migrated = migrateProfileRegionsToGameViewport({
      profile,
      captureLayoutKey: "1766x968",
      viewport,
    });

    expect(migrated).toBe(profile);
    expect(
      migrated.skills[0].regionsByLayout?.["game:1366x768"],
    ).toBeUndefined();
    expect(
      migrated.skills[1].regionsByLayout?.["game:1366x768"],
    ).toEqual(profile.skills[1].regionsByLayout?.["game:1366x768"]);
  });
});
