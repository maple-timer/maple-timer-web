import type {
  SkillReportTimeline,
  SkillSnapshot,
  SkillTraceSample,
} from "../../alertTypes";
import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../lib/buffExpiry/buffExpiryTypes";
import type {
  SpecialCoreRuntimeState,
  SpecialCoreSnapshot,
} from "../../lib/specialCore";
import type { SkillRuntimeState } from "../../types";
import type { SpecialCoreReportTimeline } from "./specialCoreReportTimeline";

export type SkillBuffDurationRuntimeReportPayload = {
  skillId: string;
  snapshot: SkillSnapshot;
  stateBefore: SkillRuntimeState;
  stateAfter: SkillRuntimeState;
  traceSample: SkillTraceSample;
  timeline: SkillReportTimeline;
};

export type BuffExpiryRuntimeReportPayload = {
  snapshot: BuffExpirySnapshot;
  stateBefore: BuffExpiryRuntimeState;
  stateAfter: BuffExpiryRuntimeState;
};

export type SpecialCoreRuntimeReportPayload = {
  snapshot: SpecialCoreSnapshot;
  stateBefore: SpecialCoreRuntimeState;
  stateAfter: SpecialCoreRuntimeState;
  evidenceHistory: SpecialCoreSnapshot[];
  timeline: SpecialCoreReportTimeline;
};
