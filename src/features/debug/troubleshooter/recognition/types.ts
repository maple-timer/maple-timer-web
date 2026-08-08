import type {
  PipelineStageStatus,
  TroubleshooterMetric,
  TroubleshooterTone,
} from "../model";

export type CurrentRecognitionStage = {
  id: string;
  label: string;
  status: PipelineStageStatus;
  summary: string;
  detail: string;
};

export type CurrentRecognitionEvidence = {
  id: string;
  label: string;
  description: string;
  src: string;
};

export type CurrentRecognitionResult = {
  tone: TroubleshooterTone;
  title: string;
  detail: string;
  durationMs: number;
  metrics: TroubleshooterMetric[];
  stages: CurrentRecognitionStage[];
  evidence: CurrentRecognitionEvidence[];
};

export type CurrentRecognitionAvailability = {
  available: boolean;
  reason: string;
};
