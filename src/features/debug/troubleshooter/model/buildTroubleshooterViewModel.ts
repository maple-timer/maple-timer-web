import { boosterExpiryAdapter } from "./adapters/boosterExpiryAdapter";
import { buffExpiryAdapter } from "./adapters/buffExpiryAdapter";
import { fallbackAdapter } from "./adapters/fallbackAdapter";
import { huntStallAdapter } from "./adapters/huntStallAdapter";
import { runeAdapter } from "./adapters/runeAdapter";
import { skillAdapter } from "./adapters/skillAdapter";
import { specialCoreAdapter } from "./adapters/specialCoreAdapter";
import { ultimaRaidEquipmentAdapter } from "./adapters/ultimaRaidEquipmentAdapter";
import {
  asRecord,
  buildTroubleshooterMetadata,
  normalizeDebugSample,
} from "./sample";
import { analyzeIncidentEvidence } from "./incidentAnalysis";
import type {
  FeatureAdapter,
  TroubleshooterFeature,
  TroubleshooterViewModel,
} from "./types";

const ADAPTERS: Partial<Record<TroubleshooterFeature, FeatureAdapter>> = {
  "buff-expiry": buffExpiryAdapter,
  "booster-expiry": boosterExpiryAdapter,
  rune: runeAdapter,
  "hunt-stall": huntStallAdapter,
  skill: skillAdapter,
  "special-core": specialCoreAdapter,
  "ultima-raid-equipment": ultimaRaidEquipmentAdapter,
};

export function buildTroubleshooterViewModel(
  value: unknown,
  options: { now?: number } = {},
): TroubleshooterViewModel {
  const sample = normalizeDebugSample(value);
  const adapter = ADAPTERS[sample.feature] ?? fallbackAdapter;
  const analysis = adapter.analyze(sample, options.now);
  const metadata = buildTroubleshooterMetadata(sample);
  const sampleNode = asRecord(sample.body.sample);
  const hasFeatureIncidentEvidence =
    (sample.feature === "buff-expiry" &&
      asRecord(sampleNode.buffExpiryEvidence).schemaVersion ===
        "buff-expiry-incident-evidence-v1") ||
    (sample.feature === "skill" &&
      asRecord(sampleNode.skillEvidence).schemaVersion ===
        "skill-incident-evidence-v1") ||
    (sample.feature === "hunt-stall" &&
      asRecord(sampleNode.huntStallEvidence).schemaVersion ===
        "hunt-stall-incident-evidence-v1") ||
    (sample.feature === "special-core" &&
      asRecord(sampleNode.specialCoreEvidence).schemaVersion ===
        "special-core-incident-evidence-v1") ||
    (sample.feature === "ultima-raid-equipment" &&
      [
        "ultima-raid-equipment-incident-evidence-v1",
        "ultima-raid-equipment-incident-evidence-v2",
      ].includes(
        String(
          asRecord(sampleNode.ultimaRaidEquipmentEvidence).schemaVersion ?? "",
        ),
      ));
  const incidentAnalysis = metadata.incident
    ? analyzeIncidentEvidence(metadata.incident, { hasFeatureIncidentEvidence })
    : null;

  return {
    ...analysis,
    metadata,
    summaryMetrics: incidentAnalysis
      ? [...incidentAnalysis.metrics, ...analysis.summaryMetrics]
      : analysis.summaryMetrics,
    diagnostics: incidentAnalysis
      ? [...incidentAnalysis.diagnostics, ...analysis.diagnostics]
      : analysis.diagnostics,
    stages: incidentAnalysis
      ? [incidentAnalysis.stage, ...analysis.stages]
      : analysis.stages,
    rawSample: value,
  };
}
