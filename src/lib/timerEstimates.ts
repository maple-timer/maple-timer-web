import type { SkillRuntimeState } from "../types";

export function getEstimatedRemainingSeconds(
  state: Pick<SkillRuntimeState, "estimatedExpiresAt">,
  now: number,
): number | null {
  if (!state.estimatedExpiresAt) {
    return null;
  }

  return Math.max(0, Math.floor((state.estimatedExpiresAt - now) / 1000));
}

export function getSignedEstimatedRemainingSeconds(
  state: Pick<SkillRuntimeState, "estimatedExpiresAt">,
  now: number,
): number | null {
  if (!state.estimatedExpiresAt) {
    return null;
  }

  const remaining = (state.estimatedExpiresAt - now) / 1000;
  return remaining >= 0 ? Math.floor(remaining) : Math.ceil(remaining);
}
