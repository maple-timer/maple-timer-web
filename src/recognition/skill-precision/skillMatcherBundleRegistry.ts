export type SkillMatcherBundleSkillId =
  | "janus"
  | "barrier"
  | "fountain"
  | "maehwaYein";

export type SkillMatcherBundleId =
  | "skill-deep-v2"
  | "skill-maehwa-yein-deep-v1";

export type SkillMatcherSkillMetadata = {
  skillId: SkillMatcherBundleSkillId;
  appSkillId: string;
  detectorId: string;
  slug: string;
  displayName: string;
};

export type SkillMatcherBundleDescriptor = {
  bundleId: SkillMatcherBundleId;
  rootPath: string;
  policyFile: "policy.json";
  expectedModelVersion: string;
  skills: readonly SkillMatcherBundleSkillId[];
};

export const SKILL_MATCHER_SKILL_METADATA: Readonly<
  Record<SkillMatcherBundleSkillId, SkillMatcherSkillMetadata>
> = {
  janus: {
    skillId: "janus",
    appSkillId: "janus",
    detectorId: "skill-deep-v2:janus",
    slug: "janus",
    displayName: "야누스",
  },
  barrier: {
    skillId: "barrier",
    appSkillId: "hologramGraffitiBarrierVi",
    detectorId: "hologramGraffitiBarrierVi",
    slug: "hologram-graffiti-barrier-vi",
    displayName: "홀로그램 그래피티: 역장VI",
  },
  fountain: {
    skillId: "fountain",
    appSkillId: "fountain",
    detectorId: "skill-deep-v2:fountain",
    slug: "fountain",
    displayName: "파운틴",
  },
  maehwaYein: {
    skillId: "maehwaYein",
    appSkillId: "maehwaYein",
    detectorId: "skill-maehwa-yein-deep-v1",
    slug: "maehwa-yein",
    displayName: "매화검 3초식 : 예인 VI",
  },
};

export const SKILL_MATCHER_BUNDLE_DESCRIPTORS: readonly SkillMatcherBundleDescriptor[] = [
  {
    bundleId: "skill-deep-v2",
    rootPath: "/models/skill-deep-v2-positive-gates-v3",
    policyFile: "policy.json",
    expectedModelVersion: "confirmed-bg-v1-seed20260632-r2-positive-gates-v3",
    skills: ["janus", "barrier", "fountain"],
  },
  {
    bundleId: "skill-maehwa-yein-deep-v1",
    rootPath: "/models/skill-maehwa-yein-deep-v1",
    policyFile: "policy.json",
    expectedModelVersion: "maehwa-yein-20260710-v3-runtime-bundle",
    skills: ["maehwaYein"],
  },
];

const DESCRIPTOR_BY_ID = new Map(
  SKILL_MATCHER_BUNDLE_DESCRIPTORS.map((descriptor) => [descriptor.bundleId, descriptor]),
);

const DESCRIPTOR_BY_SKILL = new Map<SkillMatcherBundleSkillId, SkillMatcherBundleDescriptor>();
SKILL_MATCHER_BUNDLE_DESCRIPTORS.forEach((descriptor) => {
  descriptor.skills.forEach((skillId) => DESCRIPTOR_BY_SKILL.set(skillId, descriptor));
});

export function isSkillMatcherBundleSkillId(value: string): value is SkillMatcherBundleSkillId {
  return value in SKILL_MATCHER_SKILL_METADATA;
}

export function getSkillMatcherSkillMetadata(
  skillId: SkillMatcherBundleSkillId,
): SkillMatcherSkillMetadata {
  return SKILL_MATCHER_SKILL_METADATA[skillId];
}

export function getSkillMatcherBundleDescriptor(
  bundleId: SkillMatcherBundleId,
): SkillMatcherBundleDescriptor {
  const descriptor = DESCRIPTOR_BY_ID.get(bundleId);
  if (!descriptor) {
    throw new Error(`unknown-skill-matcher-bundle:${bundleId}`);
  }
  return descriptor;
}

export function getSkillMatcherBundleDescriptorForSkill(
  skillId: SkillMatcherBundleSkillId,
): SkillMatcherBundleDescriptor {
  const descriptor = DESCRIPTOR_BY_SKILL.get(skillId);
  if (!descriptor) {
    throw new Error(`unregistered-skill-matcher-target:${skillId}`);
  }
  return descriptor;
}

export function getRequiredSkillMatcherBundleDescriptors(
  activeSkillIds: readonly SkillMatcherBundleSkillId[],
): SkillMatcherBundleDescriptor[] {
  const bundleIds = new Set(activeSkillIds.map(
    (skillId) => getSkillMatcherBundleDescriptorForSkill(skillId).bundleId,
  ));
  return SKILL_MATCHER_BUNDLE_DESCRIPTORS.filter((descriptor) => bundleIds.has(descriptor.bundleId));
}

export function buildSkillMatcherBundleAssetUrl(
  descriptor: SkillMatcherBundleDescriptor,
  relativePath: string,
): string {
  if (!isPortableSkillMatcherAssetPath(relativePath)) {
    throw new Error(`invalid-skill-matcher-asset-path:${descriptor.bundleId}:${relativePath}`);
  }
  const version = encodeURIComponent(descriptor.expectedModelVersion);
  return `${descriptor.rootPath}/${relativePath}?v=${version}`;
}

function isPortableSkillMatcherAssetPath(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\\")) {
    return false;
  }
  return !value.split("/").some((segment) => segment === ".." || segment === "");
}
