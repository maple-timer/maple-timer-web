import { describe, expect, it } from "vitest";
import { createRuntimeState } from "./timer";
import {
  hasCooldownCycleRecovered,
  isCooldownRearmCandidate,
  isFreshCooldownStartCandidate,
} from "./timerCooldown";

const cooldownConfig = {
  alertThresholdSeconds: 5,
  countdownSource: "cooldown" as const,
  durationSeconds: 120,
  cooldownDurationSeconds: 56,
};

describe("timer cooldown helpers", () => {
  it("uses recovery tolerance for normal cooldown skills", () => {
    const previous = {
      ...createRuntimeState("cooldown"),
      estimatedExpiresAt: 11_000,
    };

    expect(
      hasCooldownCycleRecovered(
        previous,
        { durationSeconds: 60, presetId: "class-install" },
        56,
        1_000,
      ),
    ).toBe(true);
  });

  it("requires exact recovery for strict Erda Fountain rearm", () => {
    const previous = {
      ...createRuntimeState("erda"),
      estimatedExpiresAt: 11_000,
    };

    expect(
      hasCooldownCycleRecovered(
        previous,
        { durationSeconds: 60, presetId: "erda-fountain" },
        56,
        1_000,
      ),
    ).toBe(false);
  });

  it("filters strict cooldown start candidates near the effective cooldown", () => {
    expect(isFreshCooldownStartCandidate(52, { presetId: "erda-fountain" }, 56)).toBe(false);
    expect(isFreshCooldownStartCandidate(53, { presetId: "erda-fountain" }, 56)).toBe(true);
    expect(isFreshCooldownStartCandidate(20, { presetId: "class-install" }, 56)).toBe(true);
  });

  it("accepts only supported cooldown rearm readings", () => {
    expect(isCooldownRearmCandidate(56, cooldownConfig)).toBe(true);
    expect(isCooldownRearmCandidate(20, cooldownConfig)).toBe(false);
  });
});
