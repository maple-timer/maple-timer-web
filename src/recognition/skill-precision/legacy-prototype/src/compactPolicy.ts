export interface SingleIconPolicyLike {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly targetSize: 32;
  readonly featureLength: number;
  readonly threshold: number;
  readonly minMarginVsHardNegative: number;
  readonly positivePrototypes: readonly SingleIconPrototypeLike[];
  readonly hardNegativePrototypes: readonly SingleIconPrototypeLike[];
  readonly calibration: {
    readonly generatedAt: string;
    readonly positiveCount: number;
    readonly positivePrototypeCount: number;
    readonly hardNegativePrototypeCount: number;
    readonly manifestNegativeCount: number;
    readonly maxManifestNegativeScore: number;
    readonly minKnownPositiveScore: number;
    readonly minKnownPositiveMargin: number;
  };
}

export interface SingleIconPrototypeLike {
  readonly id: string;
  readonly source: string;
  readonly vector: Float32Array;
}

export interface CompactSingleIconPolicyArtifact {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly targetSize: 32;
  readonly featureLength: number;
  readonly threshold: number;
  readonly minMarginVsHardNegative: number;
  readonly encoding: "f32-base64-le";
  readonly positivePrototypes: readonly CompactSingleIconPrototypeArtifact[];
  readonly hardNegativePrototypes: readonly CompactSingleIconPrototypeArtifact[];
  readonly calibration: SingleIconPolicyLike["calibration"];
}

export interface CompactSingleIconPrototypeArtifact {
  readonly id: string;
  readonly source: string;
  readonly vectorF32Base64: string;
}

export function createSingleIconPolicyFromCompact(
  artifact: CompactSingleIconPolicyArtifact,
): SingleIconPolicyLike {
  validateCompactPolicyArtifact(artifact);
  return {
    id: artifact.id,
    label: artifact.label,
    version: artifact.version,
    targetSize: artifact.targetSize,
    featureLength: artifact.featureLength,
    threshold: artifact.threshold,
    minMarginVsHardNegative: artifact.minMarginVsHardNegative,
    positivePrototypes: artifact.positivePrototypes.map((prototype) =>
      decodePrototype(prototype, artifact.featureLength),
    ),
    hardNegativePrototypes: artifact.hardNegativePrototypes.map((prototype) =>
      decodePrototype(prototype, artifact.featureLength),
    ),
    calibration: artifact.calibration,
  };
}

function validateCompactPolicyArtifact(artifact: CompactSingleIconPolicyArtifact): void {
  if (artifact.encoding !== "f32-base64-le") {
    throw new Error(`Unsupported single icon policy encoding: ${artifact.encoding}.`);
  }
  if (artifact.targetSize !== 32) {
    throw new Error(`Unsupported single icon target size: ${artifact.targetSize}.`);
  }
  if (artifact.featureLength <= 0) {
    throw new Error(`Invalid single icon feature length: ${artifact.featureLength}.`);
  }
}

function decodePrototype(
  prototype: CompactSingleIconPrototypeArtifact,
  featureLength: number,
): SingleIconPrototypeLike {
  return {
    id: prototype.id,
    source: prototype.source,
    vector: decodeFloat32Base64(prototype.vectorF32Base64, featureLength, prototype.id),
  };
}

function decodeFloat32Base64(encoded: string, expectedLength: number, label: string): Float32Array {
  const bytes = decodeBase64Bytes(encoded);
  const expectedByteLength = expectedLength * Float32Array.BYTES_PER_ELEMENT;
  if (bytes.byteLength !== expectedByteLength) {
    throw new Error(`Invalid ${label} vector byte length: ${bytes.byteLength}.`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Float32Array(expectedLength);
  for (let index = 0; index < expectedLength; index += 1) {
    values[index] = view.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true);
  }
  return values;
}

function decodeBase64Bytes(encoded: string): Uint8Array {
  const bufferCtor = (globalThis as typeof globalThis & {
    Buffer?: { from(value: string, encoding: "base64"): Uint8Array };
  }).Buffer;
  if (bufferCtor) return Uint8Array.from(bufferCtor.from(encoded, "base64"));

  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
