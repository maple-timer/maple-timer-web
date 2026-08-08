export interface SingleIconImage {
  readonly width?: number;
  readonly height?: number;
  readonly data: ArrayLike<number>;
}

export interface SingleIconPrototype {
  readonly id: string;
  readonly source: string;
  readonly vector: ArrayLike<number>;
}

export interface SingleIconCalibration {
  readonly generatedAt: string;
  readonly positiveCount: number;
  readonly positivePrototypeCount: number;
  readonly hardNegativePrototypeCount: number;
  readonly manifestNegativeCount: number;
  readonly maxManifestNegativeScore: number;
  readonly minKnownPositiveScore: number;
  readonly minKnownPositiveMargin: number;
}

export interface SingleIconPolicy {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly targetSize: 32;
  readonly featureLength: number;
  readonly threshold: number;
  readonly minMarginVsHardNegative: number;
  readonly positivePrototypes: readonly SingleIconPrototype[];
  readonly hardNegativePrototypes: readonly SingleIconPrototype[];
  readonly calibration: SingleIconCalibration;
}

export interface SingleIconCandidateScore {
  readonly id: string;
  readonly source: string;
  readonly score: number;
}

export interface SingleIconMatchResult {
  readonly id: string;
  readonly label: string;
  readonly matched: boolean;
  readonly score: number;
  readonly threshold: number;
  readonly margin: number;
  readonly minMarginVsHardNegative: number;
  readonly decisionReason:
    | "matched"
    | "below_threshold"
    | "too_close_to_hard_negative"
    | "invalid_input";
  readonly bestPositive: SingleIconCandidateScore | null;
  readonly bestHardNegative: SingleIconCandidateScore | null;
  readonly elapsedMs: number;
}

export interface SingleIconMatcher {
  readonly id: string;
  readonly label: string;
  readonly policy: SingleIconPolicy;
  match(image: SingleIconImage | ArrayLike<number>): SingleIconMatchResult;
  matchBatch(images: readonly (SingleIconImage | ArrayLike<number>)[]): SingleIconMatchResult[];
}

const TARGET_SIZE = 32;
const GRID_SIZE = 8;
const HUE_BINS = 16;
const CELL_FEATURES = 5;
const STAT_FEATURES = 16;
const FEATURE_LENGTH = GRID_SIZE * GRID_SIZE * CELL_FEATURES + GRID_SIZE * GRID_SIZE + HUE_BINS + STAT_FEATURES;

export function createSingleIconMatcher(policy: SingleIconPolicy): SingleIconMatcher {
  validatePolicy(policy);
  const matchOne = (image: SingleIconImage | ArrayLike<number>): SingleIconMatchResult => {
    const start = now();
    try {
      const vector = describeSingleIconImage(image);
      const bestPositive = bestScore(vector, policy.positivePrototypes);
      const bestHardNegative = bestScore(vector, policy.hardNegativePrototypes);
      const score = bestPositive?.score ?? -1;
      const hardNegativeScore = bestHardNegative?.score ?? -1;
      const margin = score - hardNegativeScore;
      let matched = false;
      let decisionReason: SingleIconMatchResult["decisionReason"] = "matched";
      if (score < policy.threshold) {
        decisionReason = "below_threshold";
      } else if (margin < policy.minMarginVsHardNegative) {
        decisionReason = "too_close_to_hard_negative";
      } else {
        matched = true;
      }
      return {
        id: policy.id,
        label: policy.label,
        matched,
        score: round(score),
        threshold: policy.threshold,
        margin: round(margin),
        minMarginVsHardNegative: policy.minMarginVsHardNegative,
        decisionReason,
        bestPositive: bestPositive && { ...bestPositive, score: round(bestPositive.score) },
        bestHardNegative: bestHardNegative && { ...bestHardNegative, score: round(bestHardNegative.score) },
        elapsedMs: round(now() - start),
      };
    } catch {
      return {
        id: policy.id,
        label: policy.label,
        matched: false,
        score: -1,
        threshold: policy.threshold,
        margin: -1,
        minMarginVsHardNegative: policy.minMarginVsHardNegative,
        decisionReason: "invalid_input",
        bestPositive: null,
        bestHardNegative: null,
        elapsedMs: round(now() - start),
      };
    }
  };

  return {
    id: policy.id,
    label: policy.label,
    policy,
    match: matchOne,
    matchBatch(images) {
      return images.map(matchOne);
    },
  };
}

export function describeSingleIconImage(input: SingleIconImage | ArrayLike<number>): Float32Array {
  const image = normalizeInput(input);
  const luma = new Float32Array(TARGET_SIZE * TARGET_SIZE);
  const cells = new Float32Array(GRID_SIZE * GRID_SIZE * CELL_FEATURES);
  const cellWeights = new Float32Array(GRID_SIZE * GRID_SIZE);
  const hueHist = new Float32Array(HUE_BINS);
  const stats = new Float32Array(STAT_FEATURES);

  for (let y = 0; y < TARGET_SIZE; y += 1) {
    for (let x = 0; x < TARGET_SIZE; x += 1) {
      const offset = (y * TARGET_SIZE + x) * 4;
      const alpha = (image[offset + 3] ?? 255) / 255;
      const r = ((image[offset] ?? 0) / 255) * alpha;
      const g = ((image[offset + 1] ?? 0) / 255) * alpha;
      const b = ((image[offset + 2] ?? 0) / 255) * alpha;
      const pixelLuma = 0.299 * r + 0.587 * g + 0.114 * b;
      luma[y * TARGET_SIZE + x] = pixelLuma;

      const { hue, saturation, value } = rgbToHsv(r, g, b);
      const weight = pixelWeight(x, y) * alpha;
      const cell = Math.floor(y / 4) * GRID_SIZE + Math.floor(x / 4);
      const base = cell * CELL_FEATURES;
      cells[base] += r * weight;
      cells[base + 1] += g * weight;
      cells[base + 2] += b * weight;
      cells[base + 3] += pixelLuma * weight;
      cells[base + 4] += saturation * weight;
      cellWeights[cell] += weight;

      const hueBin = Math.min(HUE_BINS - 1, Math.floor(hue * HUE_BINS));
      hueHist[hueBin] += saturation * value * weight;
      accumulateStats(stats, x, y, r, g, b, pixelLuma, hue, saturation, value, weight);
    }
  }

  for (let cell = 0; cell < cellWeights.length; cell += 1) {
    const weight = cellWeights[cell] || 1;
    const base = cell * CELL_FEATURES;
    for (let i = 0; i < CELL_FEATURES; i += 1) {
      cells[base + i] /= weight;
    }
  }

  const edgeCells = new Float32Array(GRID_SIZE * GRID_SIZE);
  const edgeWeights = new Float32Array(GRID_SIZE * GRID_SIZE);
  for (let y = 1; y < TARGET_SIZE - 1; y += 1) {
    for (let x = 1; x < TARGET_SIZE - 1; x += 1) {
      const gx = luma[y * TARGET_SIZE + x + 1] - luma[y * TARGET_SIZE + x - 1];
      const gy = luma[(y + 1) * TARGET_SIZE + x] - luma[(y - 1) * TARGET_SIZE + x];
      const edge = Math.sqrt(gx * gx + gy * gy);
      const weight = pixelWeight(x, y);
      const cell = Math.floor(y / 4) * GRID_SIZE + Math.floor(x / 4);
      edgeCells[cell] += edge * weight;
      edgeWeights[cell] += weight;
    }
  }
  for (let i = 0; i < edgeCells.length; i += 1) {
    edgeCells[i] /= edgeWeights[i] || 1;
  }

  normalizeSegment(hueHist);
  normalizeStats(stats);

  const feature = new Float32Array(FEATURE_LENGTH);
  let cursor = 0;
  feature.set(cells, cursor);
  cursor += cells.length;
  feature.set(edgeCells, cursor);
  cursor += edgeCells.length;
  feature.set(hueHist, cursor);
  cursor += hueHist.length;
  feature.set(stats, cursor);
  l2Normalize(feature);
  return feature;
}

export function cosineSimilarity(left: ArrayLike<number>, right: ArrayLike<number>): number {
  const length = Math.min(left.length, right.length);
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum += (left[i] ?? 0) * (right[i] ?? 0);
  }
  return Math.max(-1, Math.min(1, sum));
}

export function singleIconFeatureLength(): number {
  return FEATURE_LENGTH;
}

function normalizeInput(input: SingleIconImage | ArrayLike<number>): ArrayLike<number> {
  const maybeImage = input as SingleIconImage;
  const data = "data" in Object(input) ? maybeImage.data : (input as ArrayLike<number>);
  const width = "data" in Object(input) ? maybeImage.width ?? TARGET_SIZE : TARGET_SIZE;
  const height = "data" in Object(input) ? maybeImage.height ?? TARGET_SIZE : TARGET_SIZE;
  if (width !== TARGET_SIZE || height !== TARGET_SIZE || data.length !== TARGET_SIZE * TARGET_SIZE * 4) {
    throw new Error("single icon matcher expects 32x32 RGBA input");
  }
  return data;
}

function bestScore(vector: ArrayLike<number>, prototypes: readonly SingleIconPrototype[]): SingleIconCandidateScore | null {
  let best: SingleIconCandidateScore | null = null;
  for (const prototype of prototypes) {
    const score = cosineSimilarity(vector, prototype.vector);
    if (!best || score > best.score) {
      best = { id: prototype.id, source: prototype.source, score };
    }
  }
  return best;
}

function validatePolicy(policy: SingleIconPolicy): void {
  if (policy.targetSize !== TARGET_SIZE) throw new Error("invalid target size");
  if (policy.featureLength !== FEATURE_LENGTH) throw new Error("invalid feature length");
  if (policy.positivePrototypes.length === 0) throw new Error("positive prototypes are required");
}

function pixelWeight(x: number, y: number): number {
  let weight = 1;
  if (x >= 8 && x <= 24 && y >= 8 && y <= 24) weight *= 0.42;
  if (x >= 11 && x <= 21 && y >= 11 && y <= 22) weight *= 0.55;
  if (x <= 1 || x >= 30 || y <= 1 || y >= 30) weight *= 0.75;
  return weight;
}

function accumulateStats(
  stats: Float32Array,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  luma: number,
  hue: number,
  saturation: number,
  value: number,
  weight: number,
): void {
  const purpleHue = hue >= 0.68 && hue <= 0.86 ? 1 : 0;
  const violetHue = hue >= 0.6 && hue <= 0.93 ? 1 : 0;
  const center = x >= 8 && x <= 24 && y >= 8 && y <= 24 ? 1 : 0;
  const ringDistance = Math.abs(Math.hypot(x + 0.5 - 16, y + 0.5 - 16) - 11);
  const ring = ringDistance <= 4 ? 1 : 0;
  stats[0] += r * weight;
  stats[1] += g * weight;
  stats[2] += b * weight;
  stats[3] += luma * weight;
  stats[4] += saturation * weight;
  stats[5] += value * weight;
  stats[6] += purpleHue * saturation * weight;
  stats[7] += violetHue * saturation * weight;
  stats[8] += center * r * weight;
  stats[9] += center * g * weight;
  stats[10] += center * b * weight;
  stats[11] += ring * r * weight;
  stats[12] += ring * g * weight;
  stats[13] += ring * b * weight;
  stats[14] += ring * purpleHue * saturation * weight;
  stats[15] += weight;
}

function normalizeStats(stats: Float32Array): void {
  const total = stats[15] || 1;
  for (let i = 0; i < 15; i += 1) {
    stats[i] /= total;
  }
  stats[15] = Math.min(1, total / (TARGET_SIZE * TARGET_SIZE));
}

function rgbToHsv(r: number, g: number, b: number): { hue: number; saturation: number; value: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 1e-6) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  return {
    hue,
    saturation: max <= 1e-6 ? 0 : delta / max,
    value: max,
  };
}

function normalizeSegment(values: Float32Array): void {
  let sum = 0;
  for (const value of values) sum += value;
  if (sum <= 1e-8) return;
  for (let i = 0; i < values.length; i += 1) {
    values[i] /= sum;
  }
}

function l2Normalize(values: Float32Array): void {
  let sum = 0;
  for (const value of values) sum += value * value;
  if (sum <= 1e-10) return;
  const scale = 1 / Math.sqrt(sum);
  for (let i = 0; i < values.length; i += 1) {
    values[i] *= scale;
  }
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
