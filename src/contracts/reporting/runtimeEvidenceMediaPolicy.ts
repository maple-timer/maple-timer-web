export const RUNTIME_EVIDENCE_ROLLING_MEDIA_BUDGET_CHARS = {
  buffExpiry: 1_500_000,
  rune: 1_500_000,
  skillQuickSlot: 1_000_000,
  huntStall: 750_000,
  boosterExpiry: 500_000,
  ultimaRaidEquipment: 600_000,
} as const;

export const RUNTIME_EVIDENCE_ROLLING_MEDIA_TOTAL_CHARS = Object.values(
  RUNTIME_EVIDENCE_ROLLING_MEDIA_BUDGET_CHARS,
).reduce((total, budget) => total + budget, 0);

export const RUNTIME_EVIDENCE_ROLLING_MEDIA_MAX_CHARS = 6_100_000;
