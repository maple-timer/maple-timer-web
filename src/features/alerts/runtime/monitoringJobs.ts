import { MONITORING_CADENCE } from "./monitoringCadence";
import type { MonitoringJob } from "./useMonitoringScheduler";

export function createMonitoringJobs({
  processSkillRuneFrame,
  runUltimaRaidEquipmentSample,
  runHuntStallSample,
  runBuffExpirySample,
  runBoosterExpirySample,
  runSpecialCoreSample,
}: {
  processSkillRuneFrame: MonitoringJob["run"];
  runUltimaRaidEquipmentSample: MonitoringJob["run"];
  runHuntStallSample: MonitoringJob["run"];
  runBuffExpirySample: MonitoringJob["run"];
  runBoosterExpirySample: MonitoringJob["run"];
  runSpecialCoreSample: MonitoringJob["run"];
}): MonitoringJob[] {
  return [
    {
      id: "skill-rune",
      periodMs: MONITORING_CADENCE.skill.periodMs,
      phaseMs: MONITORING_CADENCE.skill.phaseMs,
      run: processSkillRuneFrame,
    },
    {
      id: "ultima-raid-equipment",
      periodMs: MONITORING_CADENCE.ultimaRaidEquipment.periodMs,
      phaseMs: MONITORING_CADENCE.ultimaRaidEquipment.phaseMs,
      run: runUltimaRaidEquipmentSample,
    },
    {
      id: "hunt-stall",
      periodMs: MONITORING_CADENCE.huntStall.periodMs,
      phaseMs: MONITORING_CADENCE.huntStall.phaseMs,
      run: runHuntStallSample,
    },
    {
      id: "buff-expiry",
      periodMs: MONITORING_CADENCE.buffExpiry.periodMs,
      phaseMs: MONITORING_CADENCE.buffExpiry.phaseMs,
      run: runBuffExpirySample,
    },
    {
      id: "booster-expiry",
      periodMs: MONITORING_CADENCE.boosterExpiry.periodMs,
      phaseMs: MONITORING_CADENCE.boosterExpiry.phaseMs,
      run: runBoosterExpirySample,
    },
    {
      id: "special-core",
      periodMs: MONITORING_CADENCE.specialCore.periodMs,
      phaseMs: MONITORING_CADENCE.specialCore.phaseMs,
      run: runSpecialCoreSample,
    },
  ];
}
