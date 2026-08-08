import type { RuneRuntimeState } from "../alertTypes";

export function getRuneDetectionEpisodeId(
  state: Pick<RuneRuntimeState, "sceneEpoch" | "firstDetectedAt">,
): string | null {
  const firstDetectedAt = state.firstDetectedAt;
  if (firstDetectedAt === null || !Number.isFinite(firstDetectedAt)) {
    return null;
  }
  const sceneEpoch = state.sceneEpoch ?? 0;
  if (!Number.isFinite(sceneEpoch)) {
    return null;
  }
  return `rune-episode:${Math.round(sceneEpoch)}:${Math.round(firstDetectedAt)}`;
}
