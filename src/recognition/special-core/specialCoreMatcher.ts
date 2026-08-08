import {
  disposePositiveGatedTensor,
  loadPositiveGatedOnnxBundle,
  withPositiveGatedOnnxOutputs,
  type LoadedPositiveGatedOnnxBundle,
} from "../matching/positiveGatedOnnxRuntime";
import {
  createRuntimeSpecialCoreMatcherV2,
  type RuntimeSpecialCoreResultV2,
  type SpecialCoreDeepV2InferenceRequest,
  type SpecialCoreDeepV2PolicyArtifact,
  type SpecialCorePositiveGateArtifact,
} from "./specialCoreDeepV2Runtime";
import {
  buildSpecialCoreMatcherAssetUrl,
  SPECIAL_CORE_MATCHER_BUNDLE,
} from "./specialCoreMatcherBundleRegistry";
import type {
  SpecialCoreMatcher,
  SpecialCoreMatcherResult,
} from "./specialCoreMatcherTypes";

type LoadedSpecialCoreRuntime = {
  bundle: LoadedPositiveGatedOnnxBundle<SpecialCoreDeepV2PolicyArtifact>;
  gate: SpecialCorePositiveGateArtifact;
  matcher: ReturnType<typeof createRuntimeSpecialCoreMatcherV2>;
};

let runtimePromise: Promise<LoadedSpecialCoreRuntime> | null = null;

export async function createSpecialCoreMatcher(): Promise<SpecialCoreMatcher> {
  const runtime = await getRuntime();
  return {
    version: `${runtime.bundle.policy.bundleId}@${runtime.bundle.policy.modelVersion}:${runtime.bundle.policy.variantId}`,
    async matchBatch(images) {
      const results = await runtime.matcher.matchBatch(images);
      return results.map((result) => toMatcherResult(result, runtime));
    },
  };
}

async function getRuntime(): Promise<LoadedSpecialCoreRuntime> {
  if (runtimePromise) {
    return runtimePromise;
  }
  const pending = initializeRuntime();
  runtimePromise = pending;
  pending.catch(() => {
    if (runtimePromise === pending) {
      runtimePromise = null;
    }
  });
  return pending;
}

async function initializeRuntime(): Promise<LoadedSpecialCoreRuntime> {
  const bundle = await loadPositiveGatedOnnxBundle({
    policyUrl: buildSpecialCoreMatcherAssetUrl(SPECIAL_CORE_MATCHER_BUNDLE.policyFile),
    buildAssetUrl: buildSpecialCoreMatcherAssetUrl,
    parsePolicy: parseSpecialCorePolicy,
    errorPrefix: "special-core-matcher",
  });
  const gate = await fetchPositiveGate(
    buildSpecialCoreMatcherAssetUrl(bundle.policy.files.positiveGate),
  );
  const matcher = createRuntimeSpecialCoreMatcherV2({
    policy: bundle.policy,
    positiveGate: gate,
    runInference: (request) => runInference(bundle, request),
  });
  return { bundle, gate, matcher };
}

async function runInference(
  bundle: LoadedPositiveGatedOnnxBundle<SpecialCoreDeepV2PolicyArtifact>,
  request: SpecialCoreDeepV2InferenceRequest,
) {
  const input = new bundle.ort.Tensor("float32", request.data, request.dims);
  try {
    return await withPositiveGatedOnnxOutputs({
      bundle,
      input,
      errorPrefix: "special-core-matcher",
      consume: ({ logits, embeddings }) => ({ logits, embedding: embeddings }),
    });
  } finally {
    disposePositiveGatedTensor(input);
  }
}

function toMatcherResult(
  result: RuntimeSpecialCoreResultV2,
  runtime: LoadedSpecialCoreRuntime,
): SpecialCoreMatcherResult {
  const { identity } = result;
  const threshold = runtime.bundle.policy.thresholds.specialCore;
  const gateThreshold = runtime.gate.threshold;
  const rescueThreshold = runtime.gate.rescueThreshold;
  const evidence = {
    bundleId: identity.bundleId,
    modelId: runtime.bundle.policy.modelId,
    modelVersion: identity.modelVersion,
    variantId: runtime.bundle.policy.variantId,
    gateVersion: runtime.gate.version,
    score: round(identity.score),
    threshold,
    margin: round(identity.margin),
    gateScore: round(identity.gateScore),
    gateThreshold,
    gateMargin: round(identity.gateMargin),
    rescueThreshold,
    rescueMargin: round(identity.rescueMargin),
    basePassed: identity.basePassed,
    positiveGatePassed: identity.positiveGatePassed,
    primaryPassed: identity.primaryPassed,
    rescuePassed: identity.rescuePassed,
    decisionReason: identity.decisionReason,
    elapsedMs: round(result.elapsedMs),
  } as const;
  if (identity.kind === "target") {
    return {
      ...evidence,
      kind: "target",
      matched: true,
      targetId: "specialCore",
    };
  }
  return {
    ...evidence,
    kind: "unknown",
    matched: false,
    targetId: null,
  };
}

function parseSpecialCorePolicy(value: unknown): SpecialCoreDeepV2PolicyArtifact {
  if (!isRecord(value)) {
    throw new Error("special-core-matcher-invalid-policy");
  }
  if (
    value.contractVersion !== 1 ||
    value.bundleId !== SPECIAL_CORE_MATCHER_BUNDLE.bundleId ||
    value.modelId !== SPECIAL_CORE_MATCHER_BUNDLE.modelId ||
    value.modelVersion !== SPECIAL_CORE_MATCHER_BUNDLE.expectedModelVersion
  ) {
    throw new Error("special-core-matcher-policy-version-mismatch");
  }
  const files = value.files;
  const output = value.output;
  if (
    !isRecord(files) ||
    typeof files.onnx !== "string" ||
    typeof files.onnxData !== "string" ||
    typeof files.positiveGate !== "string" ||
    !isRecord(output) ||
    !isRecord(output.logits) ||
    !isRecord(output.embedding)
  ) {
    throw new Error("special-core-matcher-policy-shape-mismatch");
  }
  return value as unknown as SpecialCoreDeepV2PolicyArtifact;
}

async function fetchPositiveGate(url: string): Promise<SpecialCorePositiveGateArtifact> {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`special-core-matcher-gate-load-failed:${response.status}`);
  }
  return response.json() as Promise<SpecialCorePositiveGateArtifact>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
