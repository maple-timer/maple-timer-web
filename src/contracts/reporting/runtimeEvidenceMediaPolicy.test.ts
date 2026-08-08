import { describe, expect, it } from "vitest";
import {
  RUNTIME_EVIDENCE_ROLLING_MEDIA_BUDGET_CHARS,
  RUNTIME_EVIDENCE_ROLLING_MEDIA_MAX_CHARS,
  RUNTIME_EVIDENCE_ROLLING_MEDIA_TOTAL_CHARS,
} from "./runtimeEvidenceMediaPolicy";

describe("runtime evidence media policy", () => {
  it("keeps all rolling report image buffers under one aggregate budget", () => {
    expect(RUNTIME_EVIDENCE_ROLLING_MEDIA_BUDGET_CHARS).toEqual({
      buffExpiry: 1_500_000,
      rune: 1_500_000,
      skillQuickSlot: 1_000_000,
      huntStall: 750_000,
      boosterExpiry: 500_000,
      ultimaRaidEquipment: 600_000,
    });
    expect(RUNTIME_EVIDENCE_ROLLING_MEDIA_TOTAL_CHARS).toBe(5_850_000);
    expect(RUNTIME_EVIDENCE_ROLLING_MEDIA_TOTAL_CHARS).toBeLessThanOrEqual(
      RUNTIME_EVIDENCE_ROLLING_MEDIA_MAX_CHARS,
    );
  });
});
