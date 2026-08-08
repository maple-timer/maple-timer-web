type OrtModule = typeof import("onnxruntime-web/wasm");
type OrtInferenceSession = Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>;
type OrtSessionOptionsWithExternalData = Parameters<OrtModule["InferenceSession"]["create"]>[1] & {
  externalData?: readonly { path: string; data: string | Uint8Array | ArrayBuffer }[];
};

export type PositiveGatedMatcherImageLike = {
  width: number;
  height: number;
  data: ArrayLike<number>;
};

export type PositiveGatedOnnxPolicy = {
  files: {
    onnx: string;
    onnxData: string;
  };
  output: {
    logits: { name: string };
    embedding: { name: string };
  };
};

export type PositivePrototypeGatePolicy = {
  kind: "positivePrototypeCosine";
  artifact: string;
  threshold: number;
  prototypeCount: number;
  embeddingDim: number;
  failureDecision: "unknown";
};

export type PositivePrototypeGate<TTargetId extends string = string> = {
  targetId: TTargetId;
  threshold: number;
  prototypeCount: number;
  embeddingDim: number;
  prototypes: Float32Array;
};

export type LoadedPositiveGatedOnnxBundle<TPolicy extends PositiveGatedOnnxPolicy> = {
  ort: OrtModule;
  session: OrtInferenceSession;
  inputName: string;
  policy: TPolicy;
};

const WASM_PATH = "/vendor/onnxruntime-web/ort-wasm-simd-threaded.wasm";
const INPUT_WIDTH = 32;
const INPUT_HEIGHT = 32;
const INPUT_CHANNELS = 3;

let ortPromise: Promise<OrtModule> | null = null;

export async function loadPositiveGatedOnnxBundle<TPolicy extends PositiveGatedOnnxPolicy>({
  policyUrl,
  buildAssetUrl,
  parsePolicy,
  errorPrefix,
}: {
  policyUrl: string;
  buildAssetUrl: (relativePath: string) => string;
  parsePolicy: (value: unknown) => TPolicy;
  errorPrefix: string;
}): Promise<LoadedPositiveGatedOnnxBundle<TPolicy>> {
  const [ort, policyValue] = await Promise.all([
    getPositiveGatedOrtRuntime(),
    fetchPositiveGatedJson(policyUrl, `${errorPrefix}-policy-load-failed`),
  ]);
  const policy = parsePolicy(policyValue);
  const session = await ort.InferenceSession.create(
    buildAssetUrl(policy.files.onnx),
    {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      externalData: [{
        path: policy.files.onnxData,
        data: buildAssetUrl(policy.files.onnxData),
      }],
    } as OrtSessionOptionsWithExternalData,
  );
  return {
    ort,
    session,
    inputName: session.inputNames[0] ?? "input",
    policy,
  };
}

export async function loadPositivePrototypeGate<TTargetId extends string>({
  url,
  targetId,
  policy,
  errorPrefix,
}: {
  url: string;
  targetId: TTargetId;
  policy: PositivePrototypeGatePolicy;
  errorPrefix: string;
}): Promise<PositivePrototypeGate<TTargetId>> {
  const value = await fetchPositiveGatedJson(url, `${errorPrefix}-gate-load-failed`);
  return parsePositivePrototypeGate({ value, targetId, policy, errorPrefix });
}

export function parsePositivePrototypeGate<TTargetId extends string>({
  value,
  targetId,
  policy,
  errorPrefix,
}: {
  value: unknown;
  targetId: TTargetId;
  policy: PositivePrototypeGatePolicy;
  errorPrefix: string;
}): PositivePrototypeGate<TTargetId> {
  if (!isRecord(value)) {
    throw new Error(`${errorPrefix}-invalid-gate:${targetId}`);
  }
  if (value.targetId !== targetId) {
    throw new Error(`${errorPrefix}-gate-target-mismatch:${targetId}`);
  }
  if (
    value.threshold !== policy.threshold ||
    value.prototypeCount !== policy.prototypeCount ||
    value.embeddingDim !== policy.embeddingDim
  ) {
    throw new Error(`${errorPrefix}-gate-policy-mismatch:${targetId}`);
  }
  const prototypeRows = value.prototypes;
  if (!Array.isArray(prototypeRows) || prototypeRows.length !== policy.prototypeCount) {
    throw new Error(`${errorPrefix}-gate-prototype-count-mismatch:${targetId}`);
  }
  const prototypes = new Float32Array(policy.prototypeCount * policy.embeddingDim);
  prototypeRows.forEach((row, prototypeIndex) => {
    if (!Array.isArray(row) || row.length !== policy.embeddingDim) {
      throw new Error(`${errorPrefix}-gate-prototype-shape-mismatch:${targetId}`);
    }
    row.forEach((valueAtDimension, dimension) => {
      if (typeof valueAtDimension !== "number" || !Number.isFinite(valueAtDimension)) {
        throw new Error(`${errorPrefix}-gate-prototype-value-invalid:${targetId}`);
      }
      prototypes[prototypeIndex * policy.embeddingDim + dimension] = valueAtDimension;
    });
  });
  return {
    targetId,
    threshold: policy.threshold,
    prototypeCount: policy.prototypeCount,
    embeddingDim: policy.embeddingDim,
    prototypes,
  };
}

export function createPositiveGatedInputTensor(
  ort: OrtModule,
  images: readonly PositiveGatedMatcherImageLike[],
) {
  const floats = createPositiveGatedInputData(images);
  return new ort.Tensor("float32", floats, [
    images.length,
    INPUT_CHANNELS,
    INPUT_HEIGHT,
    INPUT_WIDTH,
  ]);
}

export function createPositiveGatedInputData(
  images: readonly PositiveGatedMatcherImageLike[],
): Float32Array {
  const floats = new Float32Array(images.length * INPUT_CHANNELS * INPUT_WIDTH * INPUT_HEIGHT);
  images.forEach((image, imageIndex) => {
    if (image.width !== INPUT_WIDTH || image.height !== INPUT_HEIGHT) {
      throw new Error(`positive-gated-matcher-invalid-input-size:${image.width}x${image.height}`);
    }
    if (image.data.length < INPUT_WIDTH * INPUT_HEIGHT * 4) {
      throw new Error("positive-gated-matcher-invalid-input-data");
    }
    const base = imageIndex * INPUT_CHANNELS * INPUT_WIDTH * INPUT_HEIGHT;
    for (let pixelIndex = 0; pixelIndex < INPUT_WIDTH * INPUT_HEIGHT; pixelIndex += 1) {
      const rgbaIndex = pixelIndex * 4;
      floats[base + pixelIndex] = normalizeRgb(image.data[rgbaIndex] ?? 0);
      floats[base + INPUT_WIDTH * INPUT_HEIGHT + pixelIndex] = normalizeRgb(
        image.data[rgbaIndex + 1] ?? 0,
      );
      floats[base + INPUT_WIDTH * INPUT_HEIGHT * 2 + pixelIndex] = normalizeRgb(
        image.data[rgbaIndex + 2] ?? 0,
      );
    }
  });
  return floats;
}

export async function withPositiveGatedOnnxOutputs<T>({
  bundle,
  input,
  errorPrefix,
  consume,
}: {
  bundle: LoadedPositiveGatedOnnxBundle<PositiveGatedOnnxPolicy>;
  input: ReturnType<typeof createPositiveGatedInputTensor>;
  errorPrefix: string;
  consume: (outputs: { logits: Float32Array; embeddings: Float32Array }) => T | Promise<T>;
}): Promise<T> {
  let outputs: Awaited<ReturnType<OrtInferenceSession["run"]>> | null = null;
  try {
    outputs = await bundle.session.run({ [bundle.inputName]: input });
    const logitsOutput = outputs[bundle.policy.output.logits.name];
    const embeddingOutput = outputs[bundle.policy.output.embedding.name];
    if (!(logitsOutput?.data instanceof Float32Array)) {
      throw new Error(`${errorPrefix}-invalid-logits`);
    }
    if (!(embeddingOutput?.data instanceof Float32Array)) {
      throw new Error(`${errorPrefix}-invalid-embedding`);
    }
    return await consume({
      logits: logitsOutput.data,
      embeddings: embeddingOutput.data,
    });
  } finally {
    disposePositiveGatedOutputs(outputs);
  }
}

export function getMaximumPositivePrototypeCosine<TTargetId extends string>(
  embeddings: Float32Array,
  embeddingOffset: number,
  gate: PositivePrototypeGate<TTargetId>,
): number {
  let best = Number.NEGATIVE_INFINITY;
  for (let prototypeIndex = 0; prototypeIndex < gate.prototypeCount; prototypeIndex += 1) {
    const prototypeOffset = prototypeIndex * gate.embeddingDim;
    let score = 0;
    for (let dimension = 0; dimension < gate.embeddingDim; dimension += 1) {
      score += embeddings[embeddingOffset + dimension] * gate.prototypes[prototypeOffset + dimension];
    }
    if (score > best) {
      best = score;
    }
  }
  return best;
}

export function disposePositiveGatedTensor(tensor: { dispose?: () => void } | null | undefined): void {
  tensor?.dispose?.();
}

async function getPositiveGatedOrtRuntime(): Promise<OrtModule> {
  ortPromise = ortPromise ?? import("onnxruntime-web/wasm").then((ort) => {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = { wasm: WASM_PATH };
    return ort;
  });
  return ortPromise;
}

async function fetchPositiveGatedJson(url: string, errorCode: string): Promise<unknown> {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`${errorCode}:${response.status}`);
  }
  return response.json();
}

function disposePositiveGatedOutputs(outputs: Record<string, unknown> | null): void {
  if (!outputs) {
    return;
  }
  Object.values(outputs).forEach((output) => {
    disposePositiveGatedTensor(output as { dispose?: () => void });
  });
}

function normalizeRgb(value: number): number {
  return (value / 255 - 0.5) / 0.5;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
