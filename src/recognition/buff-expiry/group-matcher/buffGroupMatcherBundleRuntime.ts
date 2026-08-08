import {
  createPositiveGatedInputTensor,
  disposePositiveGatedTensor,
  loadPositiveGatedOnnxBundle,
  loadPositivePrototypeGate,
  withPositiveGatedOnnxOutputs,
  type LoadedPositiveGatedOnnxBundle,
  type PositiveGatedMatcherImageLike,
  type PositivePrototypeGate,
} from "../../matching/positiveGatedOnnxRuntime";
import type { BuffExpiryTargetGroup } from "../../../contracts/recognition/buffExpiryRecognition";
import {
  decideBuffGroupMatcherBundleBatch,
  mergeBuffGroupMatcherBundleDecisions,
  type BuffGroupMatcherBundlePolicy,
  type BuffGroupMatcherMatchResult,
  type BuffGroupMatcherSingleBundleDecision,
} from "./buffGroupMatcherBundleDecision";
import {
  buildBuffGroupMatcherBundleAssetUrl,
  getRequiredBuffGroupMatcherBundleDescriptors,
  type BuffGroupMatcherBundleDescriptor,
  type BuffGroupMatcherBundleId,
} from "./buffGroupMatcherBundleRegistry";

export type BuffGroupMatcherModelStatus = "idle" | "loading" | "ready" | "error";

export type BuffGroupMatcherBundleStatus = {
  group: BuffExpiryTargetGroup;
  bundleId: BuffGroupMatcherBundleId;
  modelVersion: string;
  status: Exclude<BuffGroupMatcherModelStatus, "idle">;
  error: string | null;
};

export type BuffGroupMatcherBatchResult = {
  status: BuffGroupMatcherModelStatus;
  results: BuffGroupMatcherMatchResult[];
  bundleStatuses: BuffGroupMatcherBundleStatus[];
  elapsedMs: number;
};

export type BuffGroupMatcherBundleRuntime = {
  preload(activeGroups: readonly BuffExpiryTargetGroup[]): Promise<BuffGroupMatcherBundleStatus[]>;
  matchBatchIfReady(
    images: readonly PositiveGatedMatcherImageLike[],
    activeGroups: readonly BuffExpiryTargetGroup[],
  ): Promise<BuffGroupMatcherBatchResult>;
  getBundleStatuses(
    activeGroups: readonly BuffExpiryTargetGroup[],
  ): BuffGroupMatcherBundleStatus[];
};

type LoadedBuffGroupMatcherBundle = {
  descriptor: BuffGroupMatcherBundleDescriptor;
  runtime: LoadedPositiveGatedOnnxBundle<BuffGroupMatcherBundlePolicy>;
  gate: PositivePrototypeGate<BuffExpiryTargetGroup>;
};

type BundleEntry = {
  descriptor: BuffGroupMatcherBundleDescriptor;
  status: "loading" | "ready" | "error";
  loaded: LoadedBuffGroupMatcherBundle | null;
  error: string | null;
  failedAt: number | null;
  promise: Promise<LoadedBuffGroupMatcherBundle | null>;
};

const ERROR_RETRY_DELAY_MS = 2_000;

export function createBuffGroupMatcherBundleRuntime(): BuffGroupMatcherBundleRuntime {
  return new DefaultBuffGroupMatcherBundleRuntime();
}

class DefaultBuffGroupMatcherBundleRuntime implements BuffGroupMatcherBundleRuntime {
  private readonly entries = new Map<BuffGroupMatcherBundleId, BundleEntry>();

  async preload(
    activeGroups: readonly BuffExpiryTargetGroup[],
  ): Promise<BuffGroupMatcherBundleStatus[]> {
    const descriptors = getRequiredBuffGroupMatcherBundleDescriptors(activeGroups);
    const entries = descriptors.map((descriptor) => this.ensureEntry(descriptor, true));
    const loaded = await Promise.all(entries.map((entry) => entry.promise));
    if (loaded.some((bundle) => bundle === null)) {
      const failed = entries.find((entry) => entry.status === "error");
      throw new Error(failed?.error ?? "buff-group-matcher-preload-failed");
    }
    return this.getBundleStatuses(activeGroups);
  }

  async matchBatchIfReady(
    images: readonly PositiveGatedMatcherImageLike[],
    activeGroups: readonly BuffExpiryTargetGroup[],
  ): Promise<BuffGroupMatcherBatchResult> {
    const startedAt = now();
    const descriptors = getRequiredBuffGroupMatcherBundleDescriptors(activeGroups);
    descriptors.forEach((descriptor) => this.ensureEntry(descriptor, false));
    const bundleStatuses = this.getBundleStatuses(activeGroups);
    const status = getBuffGroupMatcherModelStatus(bundleStatuses);
    if (status !== "ready" || images.length === 0) {
      return {
        status,
        results: [],
        bundleStatuses,
        elapsedMs: roundMs(now() - startedAt),
      };
    }

    const bundles = descriptors.map((descriptor) => {
      const loaded = this.entries.get(descriptor.bundleId)?.loaded;
      if (!loaded) {
        throw new Error(`buff-group-matcher-bundle-not-ready:${descriptor.bundleId}`);
      }
      return loaded;
    });
    const input = createPositiveGatedInputTensor(bundles[0].runtime.ort, images);
    try {
      const decisionsByBundle: BuffGroupMatcherSingleBundleDecision[][] = [];
      for (const bundle of bundles) {
        decisionsByBundle.push(await runBuffGroupMatcherBundle(bundle, input, images.length));
      }
      const elapsedMs = roundMs(now() - startedAt);
      return {
        status: "ready",
        results: mergeBuffGroupMatcherBundleDecisions(decisionsByBundle, elapsedMs),
        bundleStatuses,
        elapsedMs,
      };
    } finally {
      disposePositiveGatedTensor(input);
    }
  }

  getBundleStatuses(
    activeGroups: readonly BuffExpiryTargetGroup[],
  ): BuffGroupMatcherBundleStatus[] {
    return getRequiredBuffGroupMatcherBundleDescriptors(activeGroups).map((descriptor) => {
      const entry = this.entries.get(descriptor.bundleId);
      return {
        group: descriptor.group,
        bundleId: descriptor.bundleId,
        modelVersion: entry?.loaded?.runtime.policy.modelVersion ?? descriptor.expectedModelVersion,
        status: entry?.status ?? "loading",
        error: entry?.error ?? null,
      };
    });
  }

  private ensureEntry(
    descriptor: BuffGroupMatcherBundleDescriptor,
    retryError: boolean,
  ): BundleEntry {
    const existing = this.entries.get(descriptor.bundleId);
    if (existing?.status === "ready" || existing?.status === "loading") {
      return existing;
    }
    if (
      existing?.status === "error" &&
      !retryError &&
      existing.failedAt !== null &&
      now() - existing.failedAt < ERROR_RETRY_DELAY_MS
    ) {
      return existing;
    }

    const entry = {} as BundleEntry;
    entry.descriptor = descriptor;
    entry.status = "loading";
    entry.loaded = null;
    entry.error = null;
    entry.failedAt = null;
    entry.promise = loadBuffGroupMatcherBundle(descriptor).then(
      (loaded) => {
        entry.status = "ready";
        entry.loaded = loaded;
        return loaded;
      },
      (error) => {
        entry.status = "error";
        entry.error = error instanceof Error ? error.message : "buff-group-matcher-load-failed";
        entry.failedAt = now();
        return null;
      },
    );
    this.entries.set(descriptor.bundleId, entry);
    return entry;
  }
}

async function loadBuffGroupMatcherBundle(
  descriptor: BuffGroupMatcherBundleDescriptor,
): Promise<LoadedBuffGroupMatcherBundle> {
  const runtime = await loadPositiveGatedOnnxBundle({
    policyUrl: buildBuffGroupMatcherBundleAssetUrl(descriptor, descriptor.policyFile),
    buildAssetUrl: (relativePath) => buildBuffGroupMatcherBundleAssetUrl(descriptor, relativePath),
    parsePolicy: (value) => parseBuffGroupMatcherBundlePolicy(value, descriptor),
    errorPrefix: `buff-group-matcher:${descriptor.bundleId}`,
  });
  const gatePolicy = runtime.policy.postGates[descriptor.group];
  if (!gatePolicy) {
    throw new Error(`buff-group-matcher-gate-policy-missing:${descriptor.bundleId}`);
  }
  const gate = await loadPositivePrototypeGate({
    url: buildBuffGroupMatcherBundleAssetUrl(descriptor, gatePolicy.artifact),
    targetId: descriptor.group,
    policy: gatePolicy,
    errorPrefix: `buff-group-matcher:${descriptor.bundleId}`,
  });
  return { descriptor, runtime, gate };
}

async function runBuffGroupMatcherBundle(
  bundle: LoadedBuffGroupMatcherBundle,
  input: ReturnType<typeof createPositiveGatedInputTensor>,
  imageCount: number,
): Promise<BuffGroupMatcherSingleBundleDecision[]> {
  return withPositiveGatedOnnxOutputs({
    bundle: bundle.runtime,
    input,
    errorPrefix: `buff-group-matcher:${bundle.descriptor.bundleId}`,
    consume: ({ logits, embeddings }) => decideBuffGroupMatcherBundleBatch({
      policy: bundle.runtime.policy,
      logits,
      embeddings,
      imageCount,
      gate: bundle.gate,
    }),
  });
}

export function parseBuffGroupMatcherBundlePolicy(
  value: unknown,
  descriptor: BuffGroupMatcherBundleDescriptor,
): BuffGroupMatcherBundlePolicy {
  if (!isRecord(value)) {
    throw new Error(`buff-group-matcher-invalid-policy:${descriptor.bundleId}`);
  }
  if (value.contractVersion !== 1 || value.bundleId !== descriptor.bundleId) {
    throw new Error(`buff-group-matcher-policy-contract-mismatch:${descriptor.bundleId}`);
  }
  if (value.modelVersion !== descriptor.expectedModelVersion) {
    throw new Error(`buff-group-matcher-policy-version-mismatch:${descriptor.bundleId}`);
  }
  const policy = value as BuffGroupMatcherBundlePolicy;
  if (
    !isRecord(policy.files) ||
    typeof policy.files.onnx !== "string" ||
    typeof policy.files.onnxData !== "string" ||
    !Array.isArray(policy.labels) ||
    !Array.isArray(policy.groups) ||
    !isRecord(policy.thresholds) ||
    !isRecord(policy.output) ||
    !isRecord(policy.output.logits) ||
    !isRecord(policy.output.embedding) ||
    !isRecord(policy.postGates)
  ) {
    throw new Error(`buff-group-matcher-policy-shape-mismatch:${descriptor.bundleId}`);
  }
  if (
    policy.groups.length !== 1 ||
    policy.groups[0] !== descriptor.group ||
    !policy.labels.includes(descriptor.group) ||
    !policy.labels.includes(policy.backgroundLabel) ||
    typeof policy.thresholds[descriptor.group] !== "number" ||
    !policy.postGates[descriptor.group]
  ) {
    throw new Error(`buff-group-matcher-policy-target-mismatch:${descriptor.bundleId}`);
  }
  if (
    policy.input.layout !== "CHW" ||
    policy.input.color !== "RGB" ||
    policy.input.shape[1] !== 3 ||
    policy.input.shape[2] !== 32 ||
    policy.input.shape[3] !== 32 ||
    policy.output.embedding.shape[1] !== policy.postGates[descriptor.group]?.embeddingDim
  ) {
    throw new Error(`buff-group-matcher-policy-io-mismatch:${descriptor.bundleId}`);
  }
  return policy;
}

export function getBuffGroupMatcherModelStatus(
  statuses: readonly BuffGroupMatcherBundleStatus[],
): BuffGroupMatcherModelStatus {
  if (statuses.length === 0) {
    return "idle";
  }
  if (statuses.some((entry) => entry.status === "error")) {
    return "error";
  }
  if (statuses.some((entry) => entry.status === "loading")) {
    return "loading";
  }
  return "ready";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}
