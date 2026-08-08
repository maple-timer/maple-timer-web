export type RuneConfirmationPolicyMode = "any" | "all";

export type RuneConfirmationPolicy = {
  version:
    | "rune-confirmation-v1"
    | "rune-confirmation-v2"
    | "rune-confirmation-v3";
  mode: RuneConfirmationPolicyMode;
  requiredStableFrames: number;
  requiredStableMilliseconds: number;
};

export type RuneConfirmationSatisfiedBy =
  | "frames"
  | "duration"
  | "frames-and-duration"
  | null;

export const RUNE_LEGACY_CONFIRMATION_POLICY: RuneConfirmationPolicy = {
  version: "rune-confirmation-v1",
  mode: "any",
  requiredStableFrames: 3,
  requiredStableMilliseconds: 900,
};

export const RUNE_CONFIRMATION_POLICY: RuneConfirmationPolicy = {
  version: "rune-confirmation-v3",
  mode: "all",
  requiredStableFrames: 4,
  requiredStableMilliseconds: 2_500,
};

export const RUNE_REQUIRED_STABLE_FRAMES =
  RUNE_CONFIRMATION_POLICY.requiredStableFrames;
export const RUNE_REQUIRED_STABLE_MILLISECONDS =
  RUNE_CONFIRMATION_POLICY.requiredStableMilliseconds;

export function evaluateRuneConfirmation({
  stableCount,
  firstDetectedAt,
  now,
  policy = RUNE_CONFIRMATION_POLICY,
}: {
  stableCount: number;
  firstDetectedAt: number | null;
  now: number;
  policy?: RuneConfirmationPolicy;
}) {
  const stableDurationMs =
    firstDetectedAt === null ? 0 : Math.max(0, now - firstDetectedAt);
  const framesSatisfied = stableCount >= policy.requiredStableFrames;
  const durationSatisfied =
    firstDetectedAt !== null &&
    stableDurationMs >= policy.requiredStableMilliseconds;
  const satisfied =
    policy.mode === "all"
      ? framesSatisfied && durationSatisfied
      : framesSatisfied || durationSatisfied;
  const satisfiedBy: RuneConfirmationSatisfiedBy = !satisfied
    ? null
    : framesSatisfied && durationSatisfied
      ? "frames-and-duration"
      : framesSatisfied
        ? "frames"
        : "duration";

  return {
    satisfied,
    stableDurationMs,
    framesSatisfied,
    durationSatisfied,
    satisfiedBy,
  };
}

export function parseRuneConfirmationPolicy(
  value: unknown,
  fallback: RuneConfirmationPolicy = RUNE_LEGACY_CONFIRMATION_POLICY,
): RuneConfirmationPolicy {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const record = value as Record<string, unknown>;
  const version = record.version;
  const mode = record.mode;
  const requiredStableFrames = record.requiredStableFrames;
  const requiredStableMilliseconds = record.requiredStableMilliseconds;
  if (
    (version !== "rune-confirmation-v1" &&
      version !== "rune-confirmation-v2" &&
      version !== "rune-confirmation-v3") ||
    (mode !== "any" && mode !== "all") ||
    mode !== (version === "rune-confirmation-v1" ? "any" : "all") ||
    typeof requiredStableFrames !== "number" ||
    !Number.isFinite(requiredStableFrames) ||
    requiredStableFrames <= 0 ||
    typeof requiredStableMilliseconds !== "number" ||
    !Number.isFinite(requiredStableMilliseconds) ||
    requiredStableMilliseconds < 0
  ) {
    return fallback;
  }

  return {
    version,
    mode,
    requiredStableFrames,
    requiredStableMilliseconds,
  };
}
