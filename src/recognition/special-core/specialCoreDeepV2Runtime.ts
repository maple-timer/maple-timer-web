export const SPECIAL_CORE_TARGET_ID = "specialCore" as const;

export type SpecialCoreTargetId = typeof SPECIAL_CORE_TARGET_ID;
export type RuntimeSpecialCoreIdentityKindV2 = "target" | "unknown";
export type RuntimeSpecialCoreDecisionReasonV2 =
  | "base_and_positive_gate_passed"
  | "near_exact_positive_prototype_rescue"
  | "below_base_threshold"
  | "below_positive_gate_threshold";

export interface SpecialCoreRuntimeSlotRef {
  index?: number;
  x?: number;
  y?: number;
}

export interface SpecialCoreRuntimeImageSource {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface SpecialCoreRuntimeIconInput {
  id: string;
  image: SpecialCoreRuntimeImageSource;
  capturedAtMs?: number;
  slot?: SpecialCoreRuntimeSlotRef;
}

export interface SpecialCoreDeepV2PolicyArtifact {
  contractVersion: 1;
  bundleId: "special-core-deep-v2";
  modelId: "special-core-deep-v2";
  modelVersion: string;
  variantId: string;
  files: {
    onnx: string;
    onnxData: string;
    policy: string;
    positiveGate: string;
  };
  labels: string[];
  targetId: SpecialCoreTargetId;
  backgroundLabel: "background";
  scoreKind: "logitMargin";
  thresholds: Record<SpecialCoreTargetId, number>;
  input: {
    name: string;
    shape: number[];
    layout: "CHW";
    color: "RGB";
    normalization: string;
  };
  output: {
    logits: { name: string; shape: number[]; order: string[] };
    embedding: { name: string; shape: number[]; normalization: string };
  };
  postGates: Record<SpecialCoreTargetId, {
    kind: "positivePrototypeCosine";
    artifact: string;
    score: string;
    threshold: number;
    rescueThreshold: number;
    prototypeCount: number;
    embeddingDim: number;
    rescueIgnoresBaseThreshold: true;
    failureDecision: "unknown";
  }>;
}

export interface SpecialCorePositiveGateArtifact {
  kind: "special-core-positive-embedding-gate";
  version: 2;
  modelId: "special-core-deep-v2";
  targetId: SpecialCoreTargetId;
  embeddingDim: number;
  scoreKind: "max-cosine-to-positive-prototypes";
  threshold: number;
  rescueThreshold: number;
  prototypeCount: number;
  prototypes: number[][];
}

export interface SpecialCoreDeepV2InferenceRequest {
  data: Float32Array;
  dims: [number, 3, 32, 32];
  inputName: string;
  logitsOutputName: string;
  embeddingOutputName: string;
}

export interface SpecialCoreDeepV2InferenceOutput {
  logits: ArrayLike<number>;
  embedding: ArrayLike<number>;
}

export type SpecialCoreDeepV2InferenceRunner = (
  request: SpecialCoreDeepV2InferenceRequest,
) => SpecialCoreDeepV2InferenceOutput | Promise<SpecialCoreDeepV2InferenceOutput>;

export interface RuntimeSpecialCoreIdentityV2 {
  kind: RuntimeSpecialCoreIdentityKindV2;
  targetId: SpecialCoreTargetId | null;
  bundleId: "special-core-deep-v2";
  modelVersion: string;
  score: number;
  margin: number;
  gateScore: number;
  gateMargin: number;
  rescueMargin: number;
  basePassed: boolean;
  positiveGatePassed: boolean;
  primaryPassed: boolean;
  rescuePassed: boolean;
  decisionReason: RuntimeSpecialCoreDecisionReasonV2;
}

export interface RuntimeSpecialCoreResultV2 {
  identity: RuntimeSpecialCoreIdentityV2;
  elapsedMs: number;
}

export interface RuntimeSpecialCoreObservationV2 extends RuntimeSpecialCoreResultV2 {
  id: string;
  capturedAtMs?: number;
  slot?: SpecialCoreRuntimeSlotRef;
}

export interface RuntimeSpecialCoreMatcherV2Options {
  policy: SpecialCoreDeepV2PolicyArtifact;
  positiveGate: SpecialCorePositiveGateArtifact;
  runInference: SpecialCoreDeepV2InferenceRunner;
}

interface PreparedRuntime {
  policy: SpecialCoreDeepV2PolicyArtifact;
  prototypes: Float32Array;
  prototypeCount: number;
  targetIndex: number;
  backgroundIndex: number;
  embeddingDim: number;
  baseThreshold: number;
  gateThreshold: number;
  rescueThreshold: number;
}

const ICON_SIZE = 32;
const PIXEL_COUNT = ICON_SIZE * ICON_SIZE;
const CHANNEL_COUNT = 3;

export class RuntimeSpecialCoreMatcherV2 {
  private readonly runtime: PreparedRuntime;
  private readonly runInference: SpecialCoreDeepV2InferenceRunner;

  constructor(options: RuntimeSpecialCoreMatcherV2Options) {
    this.runtime = prepareRuntime(options.policy, options.positiveGate);
    this.runInference = options.runInference;
  }

  async matchIcon(image: SpecialCoreRuntimeImageSource): Promise<RuntimeSpecialCoreResultV2> {
    const [result] = await this.matchBatch([image]);
    return result;
  }

  async matchBatch(images: readonly SpecialCoreRuntimeImageSource[]): Promise<RuntimeSpecialCoreResultV2[]> {
    if (images.length === 0) return [];
    const started = now();
    const identities = await this.inferBatch(images);
    const elapsedMs = now() - started;
    return identities.map((identity) => ({ identity, elapsedMs }));
  }

  async observeIcon(input: SpecialCoreRuntimeIconInput): Promise<RuntimeSpecialCoreObservationV2> {
    const [observation] = await this.observeBatch([input]);
    return observation;
  }

  async observeBatch(items: readonly SpecialCoreRuntimeIconInput[]): Promise<RuntimeSpecialCoreObservationV2[]> {
    if (items.length === 0) return [];
    const started = now();
    const identities = await this.inferBatch(items.map((item) => item.image));
    const elapsedMs = now() - started;
    return items.map((item, index) => ({
      id: item.id,
      capturedAtMs: item.capturedAtMs,
      slot: item.slot,
      identity: identities[index],
      elapsedMs,
    }));
  }

  private async inferBatch(images: readonly SpecialCoreRuntimeImageSource[]): Promise<RuntimeSpecialCoreIdentityV2[]> {
    const request = prepareSpecialCoreDeepV2InputBatch(images, this.runtime.policy);
    const output = await this.runInference(request);
    validateInferenceOutput(output, images.length, this.runtime.policy.labels.length, this.runtime.embeddingDim);
    return decideBatch(output, images.length, this.runtime);
  }
}

export function createRuntimeSpecialCoreMatcherV2(
  options: RuntimeSpecialCoreMatcherV2Options,
): RuntimeSpecialCoreMatcherV2 {
  return new RuntimeSpecialCoreMatcherV2(options);
}

export function prepareSpecialCoreDeepV2InputBatch(
  images: readonly SpecialCoreRuntimeImageSource[],
  policy: SpecialCoreDeepV2PolicyArtifact,
): SpecialCoreDeepV2InferenceRequest {
  const data = new Float32Array(images.length * CHANNEL_COUNT * PIXEL_COUNT);
  for (let batchIndex = 0; batchIndex < images.length; batchIndex += 1) {
    const rgba = validateImageSource(images[batchIndex]).data;
    const batchOffset = batchIndex * CHANNEL_COUNT * PIXEL_COUNT;
    for (let pixelIndex = 0; pixelIndex < PIXEL_COUNT; pixelIndex += 1) {
      const sourceOffset = pixelIndex * 4;
      data[batchOffset + pixelIndex] = rgba[sourceOffset] / 127.5 - 1;
      data[batchOffset + PIXEL_COUNT + pixelIndex] = rgba[sourceOffset + 1] / 127.5 - 1;
      data[batchOffset + 2 * PIXEL_COUNT + pixelIndex] = rgba[sourceOffset + 2] / 127.5 - 1;
    }
  }
  return {
    data,
    dims: [images.length, 3, 32, 32],
    inputName: policy.input.name,
    logitsOutputName: policy.output.logits.name,
    embeddingOutputName: policy.output.embedding.name,
  };
}

function decideBatch(
  output: SpecialCoreDeepV2InferenceOutput,
  batchSize: number,
  runtime: PreparedRuntime,
): RuntimeSpecialCoreIdentityV2[] {
  const identities: RuntimeSpecialCoreIdentityV2[] = [];
  const labelCount = runtime.policy.labels.length;
  for (let batchIndex = 0; batchIndex < batchSize; batchIndex += 1) {
    const logitsOffset = batchIndex * labelCount;
    const targetLogit = output.logits[logitsOffset + runtime.targetIndex];
    const backgroundLogit = output.logits[logitsOffset + runtime.backgroundIndex];
    const score = targetLogit - backgroundLogit;
    const margin = score - runtime.baseThreshold;
    const embeddingOffset = batchIndex * runtime.embeddingDim;
    const gateScore = maxPrototypeDot(
      output.embedding,
      embeddingOffset,
      runtime.embeddingDim,
      runtime.prototypes,
      runtime.prototypeCount,
    );
    const gateMargin = gateScore - runtime.gateThreshold;
    const rescueMargin = gateScore - runtime.rescueThreshold;
    const basePassed = margin >= 0;
    const positiveGatePassed = gateMargin >= 0;
    const primaryPassed = basePassed && positiveGatePassed;
    const rescuePassed = rescueMargin >= 0;
    const matched = primaryPassed || rescuePassed;
    let decisionReason: RuntimeSpecialCoreDecisionReasonV2;
    if (rescuePassed && !primaryPassed) {
      decisionReason = "near_exact_positive_prototype_rescue";
    } else if (primaryPassed) {
      decisionReason = "base_and_positive_gate_passed";
    } else if (!basePassed) {
      decisionReason = "below_base_threshold";
    } else {
      decisionReason = "below_positive_gate_threshold";
    }
    identities.push({
      kind: matched ? "target" : "unknown",
      targetId: matched ? SPECIAL_CORE_TARGET_ID : null,
      bundleId: runtime.policy.bundleId,
      modelVersion: runtime.policy.modelVersion,
      score,
      margin,
      gateScore,
      gateMargin,
      rescueMargin,
      basePassed,
      positiveGatePassed,
      primaryPassed,
      rescuePassed,
      decisionReason,
    });
  }
  return identities;
}

function prepareRuntime(
  policy: SpecialCoreDeepV2PolicyArtifact,
  gate: SpecialCorePositiveGateArtifact,
): PreparedRuntime {
  validatePolicy(policy);
  validateGate(policy, gate);
  const prototypes = new Float32Array(gate.prototypeCount * gate.embeddingDim);
  for (let index = 0; index < gate.prototypes.length; index += 1) {
    prototypes.set(gate.prototypes[index], index * gate.embeddingDim);
  }
  return {
    policy,
    prototypes,
    prototypeCount: gate.prototypeCount,
    targetIndex: policy.labels.indexOf(policy.targetId),
    backgroundIndex: policy.labels.indexOf(policy.backgroundLabel),
    embeddingDim: gate.embeddingDim,
    baseThreshold: policy.thresholds.specialCore,
    gateThreshold: gate.threshold,
    rescueThreshold: gate.rescueThreshold,
  };
}

function validatePolicy(policy: SpecialCoreDeepV2PolicyArtifact): void {
  if (policy.contractVersion !== 1 || policy.bundleId !== "special-core-deep-v2") {
    throw new Error(`Unsupported special-core policy: ${policy.bundleId}/${policy.contractVersion}.`);
  }
  if (policy.modelId !== "special-core-deep-v2" || policy.targetId !== SPECIAL_CORE_TARGET_ID) {
    throw new Error(`Unexpected special-core model identity: ${policy.modelId}/${policy.targetId}.`);
  }
  if (policy.labels.length !== 2 || !policy.labels.includes(policy.targetId) || !policy.labels.includes(policy.backgroundLabel)) {
    throw new Error(`Expected binary labels for ${policy.targetId} and ${policy.backgroundLabel}.`);
  }
  if (policy.scoreKind !== "logitMargin") throw new Error(`Unsupported score kind: ${policy.scoreKind}.`);
  if (!policy.input.name) throw new Error("Special-core policy is missing the ONNX input name.");
  if (!sameShape(policy.input.shape, [1, 3, 32, 32])) {
    throw new Error(`Expected policy input shape [1,3,32,32], got [${policy.input.shape.join(",")}].`);
  }
  if (policy.input.layout !== "CHW" || policy.input.color !== "RGB") {
    throw new Error(`Expected RGB/CHW input, got ${policy.input.color}/${policy.input.layout}.`);
  }
  if (!sameValues(policy.output.logits.order, policy.labels)) {
    throw new Error("Special-core logits order does not match policy labels.");
  }
  if (!sameShape(policy.output.logits.shape, [1, policy.labels.length])) {
    throw new Error("Special-core logits shape does not match policy labels.");
  }
  const gate = policy.postGates.specialCore;
  if (!gate || gate.kind !== "positivePrototypeCosine" || gate.artifact !== policy.files.positiveGate) {
    throw new Error("Special-core positive-gate policy is incomplete.");
  }
  if (!sameShape(policy.output.embedding.shape, [1, gate.embeddingDim])) {
    throw new Error("Special-core embedding shape does not match gate dimensions.");
  }
  assertFinite("base threshold", policy.thresholds.specialCore);
}

function validateGate(
  policy: SpecialCoreDeepV2PolicyArtifact,
  gate: SpecialCorePositiveGateArtifact,
): void {
  const config = policy.postGates.specialCore;
  if (gate.kind !== "special-core-positive-embedding-gate" || gate.version !== 2) {
    throw new Error(`Unsupported special-core gate: ${gate.kind}/${gate.version}.`);
  }
  if (gate.modelId !== policy.modelId || gate.targetId !== policy.targetId) {
    throw new Error(`Special-core gate identity does not match policy: ${gate.modelId}/${gate.targetId}.`);
  }
  if (gate.scoreKind !== "max-cosine-to-positive-prototypes") {
    throw new Error(`Unsupported special-core gate score kind: ${gate.scoreKind}.`);
  }
  if (gate.embeddingDim !== config.embeddingDim || gate.prototypeCount !== config.prototypeCount) {
    throw new Error("Special-core gate dimensions do not match policy.");
  }
  if (gate.prototypes.length !== gate.prototypeCount) {
    throw new Error(`Expected ${gate.prototypeCount} prototypes, got ${gate.prototypes.length}.`);
  }
  if (gate.prototypeCount <= 0) throw new Error("Special-core gate must contain positive prototypes.");
  if (!nearlyEqual(gate.threshold, config.threshold) || !nearlyEqual(gate.rescueThreshold, config.rescueThreshold)) {
    throw new Error("Special-core gate thresholds do not match policy.");
  }
  assertFinite("positive gate threshold", gate.threshold);
  assertFinite("positive rescue threshold", gate.rescueThreshold);
  if (gate.rescueThreshold < gate.threshold) {
    throw new Error("Special-core rescue threshold must be at least as strict as the primary gate.");
  }
  for (let index = 0; index < gate.prototypes.length; index += 1) {
    const prototype = gate.prototypes[index];
    if (prototype.length !== gate.embeddingDim) {
      throw new Error(`Prototype ${index} length ${prototype.length} does not match ${gate.embeddingDim}.`);
    }
    let squaredNorm = 0;
    for (const value of prototype) {
      assertFinite(`prototype ${index}`, value);
      squaredNorm += value * value;
    }
    const norm = Math.sqrt(squaredNorm);
    if (Math.abs(norm - 1) > 0.001) {
      throw new Error(`Prototype ${index} must be L2 normalized, got ${norm}.`);
    }
  }
}

function validateInferenceOutput(
  output: SpecialCoreDeepV2InferenceOutput,
  batchSize: number,
  labelCount: number,
  embeddingDim: number,
): void {
  const expectedLogits = batchSize * labelCount;
  const expectedEmbedding = batchSize * embeddingDim;
  if (output.logits.length !== expectedLogits) {
    throw new Error(`Expected ${expectedLogits} logits, got ${output.logits.length}.`);
  }
  if (output.embedding.length !== expectedEmbedding) {
    throw new Error(`Expected ${expectedEmbedding} embedding values, got ${output.embedding.length}.`);
  }
  for (let index = 0; index < output.logits.length; index += 1) assertFinite("logit", output.logits[index]);
  for (let index = 0; index < output.embedding.length; index += 1) {
    assertFinite("embedding", output.embedding[index]);
  }
}

function maxPrototypeDot(
  embedding: ArrayLike<number>,
  offset: number,
  embeddingDim: number,
  prototypes: Float32Array,
  prototypeCount: number,
): number {
  let maximum = Number.NEGATIVE_INFINITY;
  for (let prototypeIndex = 0; prototypeIndex < prototypeCount; prototypeIndex += 1) {
    const prototypeOffset = prototypeIndex * embeddingDim;
    let total = 0;
    for (let index = 0; index < embeddingDim; index += 1) {
      total += embedding[offset + index] * prototypes[prototypeOffset + index];
    }
    if (total > maximum) maximum = total;
  }
  return maximum;
}

function sameShape(left: readonly number[], right: readonly number[]): boolean {
  return sameValues(left, right);
}

function sameValues<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-8;
}

function assertFinite(label: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`Expected finite ${label}, got ${value}.`);
}

function validateImageSource(image: SpecialCoreRuntimeImageSource): SpecialCoreRuntimeImageSource {
  if (!image || typeof image !== "object") throw new Error("Expected a 32x32 RGBA image source.");
  if (image.width !== ICON_SIZE || image.height !== ICON_SIZE) {
    throw new Error(`Expected a 32x32 image, got ${image.width}x${image.height}.`);
  }
  if (!(image.data instanceof Uint8ClampedArray) || image.data.length !== PIXEL_COUNT * 4) {
    throw new Error("Expected 32x32 RGBA data in a Uint8ClampedArray.");
  }
  return image;
}

function now(): number {
  if (typeof globalThis.performance?.now === "function") return globalThis.performance.now();
  return Date.now();
}
