import type { ResolvedGameViewport } from "../contracts/geometry/frameSource";
import type { Profile, RelativeRegion } from "../types";
import {
  getSkillRegionForLayout,
  hasUsableRegion,
} from "./regions";
import { mapCaptureRelativeRegionToViewport } from "./gameViewport";
import { getSkillBuffDurationTargetForSkill } from "./skillBuffDuration/skillBuffDurationTargets";

type RegionOwner = {
  region?: RelativeRegion | null;
  regionsByLayout?: Record<string, RelativeRegion>;
};

export function migrateProfileRegionsToGameViewport({
  captureLayoutKey,
  profile,
  viewport,
}: {
  captureLayoutKey: string | null;
  profile: Profile;
  viewport: ResolvedGameViewport;
}): Profile {
  if (viewport.mode !== "calibrated" || !captureLayoutKey) {
    return profile;
  }

  let changed = false;
  const skills = profile.skills.map((skill) => {
    if (getSkillBuffDurationTargetForSkill(skill)) {
      return skill;
    }
    const regionsByLayout = migrateRegionMap({
      captureLayoutKey,
      owner: skill,
      viewport,
    });
    if (regionsByLayout === skill.regionsByLayout) {
      return skill;
    }
    changed = true;
    return { ...skill, regionsByLayout };
  });

  let huntStallAlert = profile.huntStallAlert;
  if (huntStallAlert) {
    const manualExperienceRegionsByLayout = migrateRegionMap({
      captureLayoutKey,
      owner: {
        region: huntStallAlert.manualExperienceRegion ?? null,
        regionsByLayout: huntStallAlert.manualExperienceRegionsByLayout,
      },
      viewport,
    });
    const cooldownRegionsByLayout = migrateRegionMap({
      captureLayoutKey,
      owner: {
        region: huntStallAlert.cooldownRegion,
        regionsByLayout: huntStallAlert.cooldownRegionsByLayout,
      },
      viewport,
    });
    if (
      manualExperienceRegionsByLayout !==
        huntStallAlert.manualExperienceRegionsByLayout ||
      cooldownRegionsByLayout !== huntStallAlert.cooldownRegionsByLayout
    ) {
      changed = true;
      huntStallAlert = {
        ...huntStallAlert,
        manualExperienceRegionsByLayout,
        cooldownRegionsByLayout,
      };
    }
  }

  return changed
    ? {
        ...profile,
        skills,
        huntStallAlert,
      }
    : profile;
}

function migrateRegionMap({
  captureLayoutKey,
  owner,
  viewport,
}: {
  captureLayoutKey: string;
  owner: RegionOwner;
  viewport: ResolvedGameViewport;
}): Record<string, RelativeRegion> | undefined {
  const existingTarget = owner.regionsByLayout?.[viewport.layoutKey] ?? null;
  if (hasUsableRegion(existingTarget)) {
    return owner.regionsByLayout;
  }

  const captureRegion = getSkillRegionForLayout(
    {
      region: owner.region ?? null,
      regionsByLayout: owner.regionsByLayout,
    },
    captureLayoutKey,
  );
  if (!captureRegion) {
    return owner.regionsByLayout;
  }

  const mapped = mapCaptureRelativeRegionToViewport(
    captureRegion,
    viewport.sourceSize,
    viewport.region,
  );
  if (!mapped) {
    return owner.regionsByLayout;
  }

  return {
    ...(owner.regionsByLayout ?? {}),
    [viewport.layoutKey]: mapped,
  };
}
