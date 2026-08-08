import { describe, expect, it, vi } from "vitest";
import { MONITORING_CADENCE } from "./monitoringCadence";
import { createMonitoringJobs } from "./monitoringJobs";

describe("createMonitoringJobs", () => {
  it("keeps the monitoring jobs in their expected cadence order", () => {
    const processSkillRuneFrame = vi.fn();
    const runUltimaRaidEquipmentSample = vi.fn();
    const runHuntStallSample = vi.fn();
    const runBuffExpirySample = vi.fn();
    const runBoosterExpirySample = vi.fn();
    const runSpecialCoreSample = vi.fn();

    const jobs = createMonitoringJobs({
      processSkillRuneFrame,
      runUltimaRaidEquipmentSample,
      runHuntStallSample,
      runBuffExpirySample,
      runBoosterExpirySample,
      runSpecialCoreSample,
    });

    expect(jobs.map((job) => job.id)).toEqual([
      "skill-rune",
      "ultima-raid-equipment",
      "hunt-stall",
      "buff-expiry",
      "booster-expiry",
      "special-core",
    ]);
    expect(jobs).toEqual([
      expect.objectContaining({
        periodMs: MONITORING_CADENCE.skill.periodMs,
        phaseMs: MONITORING_CADENCE.skill.phaseMs,
        run: processSkillRuneFrame,
      }),
      expect.objectContaining({
        periodMs: MONITORING_CADENCE.ultimaRaidEquipment.periodMs,
        phaseMs: MONITORING_CADENCE.ultimaRaidEquipment.phaseMs,
        run: runUltimaRaidEquipmentSample,
      }),
      expect.objectContaining({
        periodMs: MONITORING_CADENCE.huntStall.periodMs,
        phaseMs: MONITORING_CADENCE.huntStall.phaseMs,
        run: runHuntStallSample,
      }),
      expect.objectContaining({
        periodMs: MONITORING_CADENCE.buffExpiry.periodMs,
        phaseMs: MONITORING_CADENCE.buffExpiry.phaseMs,
        run: runBuffExpirySample,
      }),
      expect.objectContaining({
        periodMs: MONITORING_CADENCE.boosterExpiry.periodMs,
        phaseMs: MONITORING_CADENCE.boosterExpiry.phaseMs,
        run: runBoosterExpirySample,
      }),
      expect.objectContaining({
        periodMs: MONITORING_CADENCE.specialCore.periodMs,
        phaseMs: MONITORING_CADENCE.specialCore.phaseMs,
        run: runSpecialCoreSample,
      }),
    ]);
  });
});
