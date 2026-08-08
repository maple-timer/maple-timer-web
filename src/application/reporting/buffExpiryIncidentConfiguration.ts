import { applyMasterVolume } from "../../lib/volume";
import type { BuffExpiryAlertConfig } from "../../types";

export function createBuffExpiryIncidentConfiguration(
  config: BuffExpiryAlertConfig,
  masterVolume: number,
) {
  return {
    enabled: config.enabled,
    alertLeadSeconds: config.alertLeadSeconds,
    selectedBuffIds: [...config.selectedBuffIds],
    selectedPrecisionTargetGroups: [
      ...(config.selectedPrecisionTargetGroups ?? []),
    ],
    soundId: config.soundId,
    volume: config.volume,
    masterVolume,
    effectiveVolume: applyMasterVolume(config.volume, masterVolume),
  };
}
