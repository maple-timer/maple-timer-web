import type { HuntStallIncidentConfiguration } from "../../runtime/hunt-stall/evidence/huntStallIncidentEvidenceTypes";
import type { HuntStallAlertConfig } from "../../types";
import { applyMasterVolume } from "../../lib/volume";

export function createHuntStallIncidentConfiguration(
  config: HuntStallAlertConfig,
  masterVolume: number,
): HuntStallIncidentConfiguration {
  const manualMode = config.mode === "manual-experience";
  return {
    enabled: config.enabled,
    mode: config.mode,
    thresholdSeconds: manualMode
      ? Math.max(5, Math.min(120, config.stallThresholdSeconds))
      : Math.max(1, Math.min(60, config.cooldownMissingThresholdSeconds)),
    repeatAlertEnabled: manualMode && config.repeatAlertEnabled === true,
    repeatAlertIntervalSeconds:
      manualMode && config.repeatAlertEnabled === true
        ? (config.repeatAlertIntervalSeconds ?? null)
        : null,
    repeatAlertMaxCount:
      manualMode && config.repeatAlertEnabled === true
        ? (config.repeatAlertMaxCount ?? null)
        : null,
    soundId: config.soundId,
    featureVolume: config.volume,
    masterVolume,
    effectiveVolume: applyMasterVolume(config.volume, masterVolume),
  };
}
