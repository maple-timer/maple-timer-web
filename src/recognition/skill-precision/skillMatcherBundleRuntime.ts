import {
  createPositiveGatedInputTensor,
  disposePositiveGatedTensor,
  loadPositiveGatedOnnxBundle,
  loadPositivePrototypeGate,
  withPositiveGatedOnnxOutputs,
  type LoadedPositiveGatedOnnxBundle,
  type PositiveGatedMatcherImageLike,
} from "../matching/positiveGatedOnnxRuntime";
import {
  decideSkillMatcherBundleBatch,
  mergeSkillMatcherBundleDecisions,
  type SkillMatcherBundleMatchResult,
  type SkillMatcherBundlePolicy,
  type SkillMatcherPositiveGate,
  type SkillMatcherSingleBundleDecision,
} from "./skillMatcherBundleDecision";
import {
  buildSkillMatcherBundleAssetUrl,
  getRequiredSkillMatcherBundleDescriptors,
  type SkillMatcherBundleDescriptor,
  type SkillMatcherBundleSkillId,
} from "./skillMatcherBundleRegistry";

export type SkillMatcherImageLike = PositiveGatedMatcherImageLike;

export type SkillMatcherBundleRuntime = {
  matchBatch(
    images: readonly SkillMatcherImageLike[],
    activeSkillIds: readonly SkillMatcherBundleSkillId[],
  ): Promise<SkillMatcherBundleMatchResult[]>;
};

type LoadedSkillMatcherBundle = {
  descriptor: SkillMatcherBundleDescriptor;
  runtime: LoadedPositiveGatedOnnxBundle<SkillMatcherBundlePolicy>;
  gatePromises: Map<SkillMatcherBundleSkillId, Promise<SkillMatcherPositiveGate>>;
};

export function createSkillMatcherBundleRuntime(): SkillMatcherBundleRuntime {
  return new DefaultSkillMatcherBundleRuntime();
}

class DefaultSkillMatcherBundleRuntime implements SkillMatcherBundleRuntime {
  private readonly bundlePromises = new Map<string, Promise<LoadedSkillMatcherBundle>>();

  async matchBatch(
    images: readonly SkillMatcherImageLike[],
    activeSkillIds: readonly SkillMatcherBundleSkillId[],
  ): Promise<SkillMatcherBundleMatchResult[]> {
    const startedAt = now();
    if (images.length === 0) {
      return [];
    }
    const uniqueActiveSkillIds = [...new Set(activeSkillIds)];
    if (uniqueActiveSkillIds.length === 0) {
      throw new Error("skill-matcher-no-active-targets");
    }
    const descriptors = getRequiredSkillMatcherBundleDescriptors(uniqueActiveSkillIds);
    const bundles = await Promise.all(descriptors.map((descriptor) => this.getBundle(descriptor)));
    const runtime = bundles[0]?.runtime;
    if (!runtime) {
      throw new Error("skill-matcher-runtime-unavailable");
    }
    const input = createPositiveGatedInputTensor(runtime.ort, images);
    try {
      const decisionsByBundle = await Promise.all(
        bundles.map((bundle) => this.runBundle(
          bundle,
          input,
          images.length,
          uniqueActiveSkillIds,
        )),
      );
      return mergeSkillMatcherBundleDecisions(
        decisionsByBundle,
        round(now() - startedAt),
      );
    } finally {
      disposePositiveGatedTensor(input);
    }
  }

  private getBundle(
    descriptor: SkillMatcherBundleDescriptor,
  ): Promise<LoadedSkillMatcherBundle> {
    const cached = this.bundlePromises.get(descriptor.bundleId);
    if (cached) {
      return cached;
    }
    const pending = loadSkillMatcherBundle(descriptor);
    this.bundlePromises.set(descriptor.bundleId, pending);
    pending.catch(() => {
      if (this.bundlePromises.get(descriptor.bundleId) === pending) {
        this.bundlePromises.delete(descriptor.bundleId);
      }
    });
    return pending;
  }

  private async runBundle(
    bundle: LoadedSkillMatcherBundle,
    input: ReturnType<typeof createPositiveGatedInputTensor>,
    imageCount: number,
    activeSkillIds: readonly SkillMatcherBundleSkillId[],
  ): Promise<SkillMatcherSingleBundleDecision[]> {
    const activeForBundle = activeSkillIds.filter((skillId) => bundle.descriptor.skills.includes(skillId));
    const gatesPromise = Promise.all(activeForBundle.map(async (skillId) => (
      [skillId, await this.getGate(bundle, skillId)] as const
    )));
    return withPositiveGatedOnnxOutputs({
      bundle: bundle.runtime,
      input,
      errorPrefix: `skill-matcher:${bundle.descriptor.bundleId}`,
      consume: async ({ logits, embeddings }) => {
        const gateEntries = await gatesPromise;
        return decideSkillMatcherBundleBatch({
          policy: bundle.runtime.policy,
          logits,
          embeddings,
          imageCount,
          activeSkillIds: new Set(activeForBundle),
          gates: new Map(gateEntries),
        });
      },
    });
  }

  private getGate(
    bundle: LoadedSkillMatcherBundle,
    skillId: SkillMatcherBundleSkillId,
  ): Promise<SkillMatcherPositiveGate> {
    const cached = bundle.gatePromises.get(skillId);
    if (cached) {
      return cached;
    }
    const pending = loadSkillMatcherGate(bundle, skillId);
    bundle.gatePromises.set(skillId, pending);
    pending.catch(() => {
      if (bundle.gatePromises.get(skillId) === pending) {
        bundle.gatePromises.delete(skillId);
      }
    });
    return pending;
  }
}

async function loadSkillMatcherBundle(
  descriptor: SkillMatcherBundleDescriptor,
): Promise<LoadedSkillMatcherBundle> {
  const runtime = await loadPositiveGatedOnnxBundle({
    policyUrl: buildSkillMatcherBundleAssetUrl(descriptor, descriptor.policyFile),
    buildAssetUrl: (relativePath) => buildSkillMatcherBundleAssetUrl(descriptor, relativePath),
    parsePolicy: (value) => parseSkillMatcherBundlePolicy(value, descriptor),
    errorPrefix: `skill-matcher:${descriptor.bundleId}`,
  });
  return {
    descriptor,
    runtime,
    gatePromises: new Map(),
  };
}

async function loadSkillMatcherGate(
  bundle: LoadedSkillMatcherBundle,
  skillId: SkillMatcherBundleSkillId,
): Promise<SkillMatcherPositiveGate> {
  const gatePolicy = bundle.runtime.policy.postGates[skillId];
  if (!gatePolicy) {
    throw new Error(`skill-matcher-gate-policy-missing:${bundle.descriptor.bundleId}:${skillId}`);
  }
  return loadPositivePrototypeGate({
    url: buildSkillMatcherBundleAssetUrl(bundle.descriptor, gatePolicy.artifact),
    targetId: skillId,
    policy: gatePolicy,
    errorPrefix: `skill-matcher:${bundle.descriptor.bundleId}`,
  });
}

function parseSkillMatcherBundlePolicy(
  value: unknown,
  descriptor: SkillMatcherBundleDescriptor,
): SkillMatcherBundlePolicy {
  if (!isRecord(value)) {
    throw new Error(`skill-matcher-invalid-policy:${descriptor.bundleId}`);
  }
  if (value.contractVersion !== 1 || value.bundleId !== descriptor.bundleId) {
    throw new Error(`skill-matcher-policy-contract-mismatch:${descriptor.bundleId}`);
  }
  if (value.modelVersion !== descriptor.expectedModelVersion) {
    throw new Error(`skill-matcher-policy-version-mismatch:${descriptor.bundleId}`);
  }
  const policy = value as SkillMatcherBundlePolicy;
  if (
    !isRecord(policy.files) ||
    typeof policy.files.onnx !== "string" ||
    typeof policy.files.onnxData !== "string" ||
    !Array.isArray(policy.labels) ||
    !Array.isArray(policy.skills) ||
    !isRecord(policy.thresholds) ||
    !isRecord(policy.output) ||
    !isRecord(policy.output.logits) ||
    !isRecord(policy.output.embedding) ||
    !isRecord(policy.postGates) ||
    !isRecord(policy.modelConfig)
  ) {
    throw new Error(`skill-matcher-policy-shape-mismatch:${descriptor.bundleId}`);
  }
  if (
    policy.skills.length !== descriptor.skills.length ||
    descriptor.skills.some((skillId) => !policy.skills.includes(skillId))
  ) {
    throw new Error(`skill-matcher-policy-skills-mismatch:${descriptor.bundleId}`);
  }
  descriptor.skills.forEach((skillId) => {
    if (typeof policy.thresholds[skillId] !== "number" || !policy.postGates[skillId]) {
      throw new Error(`skill-matcher-policy-target-missing:${descriptor.bundleId}:${skillId}`);
    }
  });
  return policy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
