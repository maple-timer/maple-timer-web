import { normalizeDebugSample, type TroubleshooterViewModel } from "../model";
import type { BuffSlotParserInputMode } from "../../../../recognition/buff-slot/parser/types";
import { asRecord } from "../model/sample";
import type {
  CurrentRecognitionResult,
  CurrentRecognitionStage,
} from "./types";

export type RecognitionContext = {
  view: TroubleshooterViewModel;
  imageData: ImageData;
  startedAt: number;
  buffSlotInputMode?: BuffSlotParserInputMode | null;
  sequenceKind?: "alert-trigger" | "runtime-incident";
  sequenceFrames?: Array<{
    imageData: ImageData;
    sampledAt: number;
    label: string;
    src: string;
  }>;
};

export function getFeatureConfig(view: TroubleshooterViewModel, key: string) {
  const normalized = normalizeDebugSample(view.rawSample);
  return asRecord(asRecord(normalized.body[key]).config);
}

export function isBuffDurationSkill(view: TroubleshooterViewModel) {
  const config = getFeatureConfig(view, "skill");
  return config.detectionSource === "buff-duration" || view.modeLabel.includes("버프칸");
}

export function recognitionStage(
  id: string,
  label: string,
  complete: boolean,
  summary: string,
  detail: string,
  incompleteStatus: CurrentRecognitionStage["status"] = "blocked",
): CurrentRecognitionStage {
  return {
    id,
    label,
    status: complete ? "complete" : incompleteStatus,
    summary,
    detail,
  };
}

export function temporalStage(
  id: string,
  label: string,
  summary: string,
): CurrentRecognitionStage {
  return {
    id,
    label,
    status: "unavailable",
    summary,
    detail: "저장된 한 프레임만으로 시간 흐름을 다시 만들 수 없습니다.",
  };
}

export function temporalLimit(subject: string) {
  return `이 결과는 저장된 원본 한 프레임을 현재 인식기에 다시 넣은 값입니다. ${subject}은 저장된 실행 기록으로 별도 판단합니다.`;
}

export function buildRecognitionResult({
  tone,
  title,
  detail,
  startedAt,
  metrics,
  stages,
  evidence,
}: Omit<CurrentRecognitionResult, "durationMs"> & {
  startedAt: number;
}): CurrentRecognitionResult {
  return {
    tone,
    title,
    detail,
    durationMs: Math.max(0, performance.now() - startedAt),
    metrics,
    stages,
    evidence,
  };
}

export function maxFinite(values: Array<number | null | undefined>) {
  const finite = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return finite.length > 0 ? Math.max(...finite) : null;
}
