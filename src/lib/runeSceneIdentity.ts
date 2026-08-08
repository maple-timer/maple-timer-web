export const RUNE_SCENE_IDENTITY_POLICY = {
  version: "rune-scene-v1" as const,
  gridWidth: 16,
  gridHeight: 8,
  changeThreshold: 0.2,
  stableThreshold: 0.08,
  confirmationFrames: 2,
} as const;

const MINIMUM_LUMA_STANDARD_DEVIATION = 0.08;
const NORMALIZED_LUMA_LIMIT = 2;

export type RuneSceneTrackerState = {
  baseline: Uint8Array | null;
  pending: Uint8Array | null;
  pendingStableCount: number;
  sceneEpoch: number;
  lastChangeScore: number | null;
  lastChangedAt: number | null;
  sourceAspectBucket: number | null;
};

export type RuneSceneObservation = {
  policyVersion: typeof RUNE_SCENE_IDENTITY_POLICY.version;
  sceneEpoch: number;
  changed: boolean;
  changeScore: number | null;
  pendingStableCount: number;
  changedAt: number | null;
};

export function createRuneSceneTrackerState(): RuneSceneTrackerState {
  return {
    baseline: null,
    pending: null,
    pendingStableCount: 0,
    sceneEpoch: 0,
    lastChangeScore: null,
    lastChangedAt: null,
    sourceAspectBucket: null,
  };
}

export function updateRuneSceneTracker(
  previous: RuneSceneTrackerState,
  imageData: ImageData,
  now: number,
): { state: RuneSceneTrackerState; observation: RuneSceneObservation } {
  const fingerprint = createRuneSceneFingerprint(imageData);
  const sourceAspectBucket = Math.round((imageData.width / imageData.height) * 100);
  if (
    previous.baseline === null ||
    previous.sourceAspectBucket !== sourceAspectBucket
  ) {
    const state = {
      ...previous,
      baseline: fingerprint,
      pending: null,
      pendingStableCount: 0,
      lastChangeScore: 0,
      sourceAspectBucket,
    };
    return { state, observation: toObservation(state, false) };
  }

  const changeScore = getRuneSceneFingerprintDistance(previous.baseline, fingerprint);
  if (changeScore < RUNE_SCENE_IDENTITY_POLICY.changeThreshold) {
    const state = {
      ...previous,
      baseline: fingerprint,
      pending: null,
      pendingStableCount: 0,
      lastChangeScore: changeScore,
      sourceAspectBucket,
    };
    return { state, observation: toObservation(state, false) };
  }

  const continuesPendingScene =
    previous.pending !== null &&
    getRuneSceneFingerprintDistance(previous.pending, fingerprint) <=
      RUNE_SCENE_IDENTITY_POLICY.stableThreshold;
  const pendingStableCount = continuesPendingScene
    ? previous.pendingStableCount + 1
    : 1;
  if (pendingStableCount < RUNE_SCENE_IDENTITY_POLICY.confirmationFrames) {
    const state = {
      ...previous,
      pending: fingerprint,
      pendingStableCount,
      lastChangeScore: changeScore,
      sourceAspectBucket,
    };
    return { state, observation: toObservation(state, false) };
  }

  const state = {
    ...previous,
    baseline: fingerprint,
    pending: null,
    pendingStableCount: 0,
    sceneEpoch: previous.sceneEpoch + 1,
    lastChangeScore: changeScore,
    lastChangedAt: now,
    sourceAspectBucket,
  };
  return { state, observation: toObservation(state, true) };
}

export function createRuneSceneFingerprint(imageData: ImageData): Uint8Array {
  const { gridWidth, gridHeight } = RUNE_SCENE_IDENTITY_POLICY;
  const sums = new Float64Array(gridWidth * gridHeight);
  const counts = new Uint32Array(gridWidth * gridHeight);
  for (let y = 0; y < imageData.height; y += 1) {
    const gridY = Math.min(gridHeight - 1, Math.floor((y * gridHeight) / imageData.height));
    for (let x = 0; x < imageData.width; x += 1) {
      const gridX = Math.min(gridWidth - 1, Math.floor((x * gridWidth) / imageData.width));
      const sourceIndex = (y * imageData.width + x) * 4;
      const targetIndex = gridY * gridWidth + gridX;
      const red = imageData.data[sourceIndex] ?? 0;
      const green = imageData.data[sourceIndex + 1] ?? 0;
      const blue = imageData.data[sourceIndex + 2] ?? 0;
      sums[targetIndex] += (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
      counts[targetIndex] += 1;
    }
  }

  const luma = Array.from(sums, (sum, index) => sum / Math.max(1, counts[index] ?? 0));
  const mean = luma.reduce((total, value) => total + value, 0) / luma.length;
  const variance =
    luma.reduce((total, value) => total + (value - mean) ** 2, 0) / luma.length;
  const standardDeviation = Math.max(
    MINIMUM_LUMA_STANDARD_DEVIATION,
    Math.sqrt(variance),
  );
  return Uint8Array.from(luma, (value) => {
    const normalized = clamp(
      (value - mean) / standardDeviation,
      -NORMALIZED_LUMA_LIMIT,
      NORMALIZED_LUMA_LIMIT,
    );
    return Math.round(
      ((normalized + NORMALIZED_LUMA_LIMIT) / (NORMALIZED_LUMA_LIMIT * 2)) * 255,
    );
  });
}

export function getRuneSceneFingerprintDistance(
  left: Uint8Array,
  right: Uint8Array,
): number {
  if (left.length !== right.length || left.length === 0) {
    return 1;
  }
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs((left[index] ?? 0) - (right[index] ?? 0)) / 255;
  }
  return total / left.length;
}

function toObservation(
  state: RuneSceneTrackerState,
  changed: boolean,
): RuneSceneObservation {
  return {
    policyVersion: RUNE_SCENE_IDENTITY_POLICY.version,
    sceneEpoch: state.sceneEpoch,
    changed,
    changeScore: state.lastChangeScore,
    pendingStableCount: state.pendingStableCount,
    changedAt: state.lastChangedAt,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
