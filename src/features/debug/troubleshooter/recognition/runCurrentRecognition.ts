import type { TroubleshooterViewModel } from "../model";
import { normalizeDebugSample } from "../model";
import { asArray, asRecord, firstString } from "../model/sample";
import type { BuffSlotParserInputMode } from "../../../../recognition/buff-slot/parser/types";
import { dataUrlToImageData } from "./imageData";
import { getFeatureConfig, isBuffDurationSkill } from "./helpers";
import type {
  CurrentRecognitionAvailability,
  CurrentRecognitionResult,
} from "./types";

export type CurrentRecognitionSource = {
  id: string;
  label: string;
  description: string;
  src: string;
  sequenceKind?: "alert-trigger" | "runtime-incident";
  frames?: Array<{
    label: string;
    src: string;
    sampledAt: number;
  }>;
};

export function getCurrentRecognitionAvailability(
  view: TroubleshooterViewModel,
  sourceId?: string,
): CurrentRecognitionAvailability {
  if (view.feature === "unknown") {
    return {
      available: false,
      reason: "이 제보 유형에 연결된 최신 인식기가 없습니다.",
    };
  }
  if (!getCurrentRecognitionSource(view, sourceId)) {
    return {
      available: false,
      reason: "현재 인식기에 다시 넣을 원본 화면이 저장되지 않았습니다.",
    };
  }
  if (view.feature === "skill" && isBuffDurationSkill(view)) {
    const config = getFeatureConfig(view, "skill");
    if (!firstString(config.presetId)) {
      return {
        available: false,
        reason: "정밀 스킬의 preset 정보가 없어 현재 matcher 대상을 정할 수 없습니다.",
      };
    }
  }
  const source = getCurrentRecognitionSource(view, sourceId);
  return {
    available: true,
    reason: source?.frames && source.frames.length > 1
      ? source.sequenceKind === "runtime-incident"
        ? `실제 감지 루프가 저장한 ${source.frames.length}개 프레임을 현재 인식기와 확정 로직에 다시 넣습니다.`
        : `알림을 확정한 ${source.frames.length}개 프레임을 현재 인식기와 확정 로직에 다시 넣습니다.`
      : "원본 한 프레임을 현재 parser와 인식기에 다시 넣습니다.",
  };
}

export function getCurrentRecognitionSource(
  view: TroubleshooterViewModel,
  sourceId?: string,
): CurrentRecognitionSource | null {
  const sources = getCurrentRecognitionSources(view);
  return sourceId
    ? sources.find((source) => source.id === sourceId) ?? null
    : sources[0] ?? null;
}

export function getCurrentRecognitionSources(
  view: TroubleshooterViewModel,
): CurrentRecognitionSource[] {
  if (view.feature === "ultima-raid-equipment") {
    const frames = view.evidence
      .filter(
        (item) =>
          item.group === "source" &&
          item.id.startsWith("ultima-raid-equipment-incident-"),
      )
      .filter((item) => typeof item.capturedAt === "number")
      .sort(
        (left, right) =>
          (left.capturedAt ?? 0) - (right.capturedAt ?? 0),
      );
    if (frames.length > 0) {
      return frames
        .slice()
        .reverse()
        .map((frame) => ({
          id: frame.id,
          label: frame.label,
          description:
            "정상 감지 루프가 보관한 한 프레임을 현재 감지기에 다시 넣습니다. 저장 간격이 있는 이미지이므로 당시 연속 확정과 알림 재생은 저장된 런타임 기록에서 따로 확인합니다.",
          src: frame.src,
        }));
    }
  }
  if (view.feature === "booster-expiry") {
    const normalized = normalizeDebugSample(view.rawSample);
    const evidence = asRecord(
      asRecord(normalized.body.sample).boosterExpiryEvidence,
    );
    if (
      firstString(evidence.schemaVersion) ===
      "booster-expiry-incident-evidence-v1"
    ) {
      return view.evidence
        .filter(
          (item) =>
            item.group === "source" &&
            item.id.startsWith("booster-expiry-incident-"),
        )
        .sort(
          (left, right) =>
            (left.capturedAt ?? 0) - (right.capturedAt ?? 0),
        )
        .map((item) => ({
          id: item.id,
          label: item.label,
          description:
            "실제 1000ms 감지 루프가 선택 사건에서 사용한 한 프레임입니다. 현재 코드의 한 프레임 판독만 비교하며 당시 감소 흐름, 확정, 예약과 알림 재생은 재현하지 않습니다.",
          src: item.src,
        }));
    }
  }
  if (view.feature === "special-core") {
    const normalized = normalizeDebugSample(view.rawSample);
    const evidence = asRecord(
      asRecord(normalized.body.sample).specialCoreEvidence,
    );
    if (
      firstString(evidence.schemaVersion) ===
      "special-core-incident-evidence-v1"
    ) {
      return view.evidence
        .filter(
          (item) =>
            item.group === "source" &&
            item.id.startsWith("special-core-incident-"),
        )
        .sort(
          (left, right) =>
            (left.capturedAt ?? 0) - (right.capturedAt ?? 0),
        )
        .map((item) => ({
          id: item.id,
          label: item.label,
          description:
            "실제 감지 루프가 선택 사건에서 사용한 한 프레임입니다. 현재 코드의 한 프레임 판정만 비교하며 당시 연속 확인과 알림 실행을 재현하지 않습니다.",
          src: item.src,
        }));
    }
  }
  if (view.feature === "hunt-stall") {
    const incidentFrames = view.evidence.filter(
      (item) =>
        item.group === "source" &&
        item.id.startsWith("hunt-stall-incident-") &&
        item.id.endsWith("-raw"),
    );
    if (incidentFrames.length > 0) {
      return incidentFrames.map((frame) => ({
        id: frame.id,
        label: frame.label,
        description: frame.description,
        src: frame.src,
      }));
    }
  }
  const reportFrame =
    view.evidence.find((item) => item.id === "source-raw") ??
    view.evidence.find((item) => item.group === "source") ??
    null;
  if (!reportFrame) {
    return [];
  }

  const reportSource: CurrentRecognitionSource = {
    id: reportFrame.id,
    label: view.feature === "rune" ? "제보 프레임" : reportFrame.label,
    description:
      view.feature === "rune"
        ? "제보 버튼을 누른 시점의 미니맵 한 프레임입니다."
        : reportFrame.description,
    src: reportFrame.src,
  };
  if (view.feature !== "rune") {
    return [reportSource];
  }

  const triggerFrames = view.evidence
    .filter((item) => item.id.startsWith("rune-alert-trigger-frame-"))
    .filter((item) => typeof item.capturedAt === "number")
    .sort((left, right) => (left.capturedAt ?? 0) - (right.capturedAt ?? 0));
  const sources: CurrentRecognitionSource[] = [];
  if (triggerFrames.length > 0) {
    const lastFrame = triggerFrames[triggerFrames.length - 1];
    sources.push({
      id: "rune-alert-trigger-sequence",
      label: triggerFrames.length > 1 ? "알림 확정 흐름" : "알림 프레임",
      description: triggerFrames.length > 1
        ? `실제 알림을 확정한 ${triggerFrames.length}개 미니맵 프레임입니다.`
        : "실제 룬 알림을 발생시킨 미니맵 프레임입니다.",
      src: lastFrame.src,
      sequenceKind: "alert-trigger",
      frames: triggerFrames.map((frame) => ({
        label: frame.label,
        src: frame.src,
        sampledAt: frame.capturedAt as number,
      })),
    });
  } else {
    const alertFrame = view.evidence.find((item) => item.id === "rune-last-alert-raw");
    if (alertFrame) {
      sources.push({
        id: alertFrame.id,
        label: "알림 프레임",
        description: "마지막 룬 알림을 실제로 발생시킨 미니맵 한 프레임입니다.",
        src: alertFrame.src,
      });
    }
  }
  const runtimeIncidentFrames = view.evidence
    .filter((item) => item.id.startsWith("rune-runtime-incident-frame-"))
    .filter((item) => typeof item.capturedAt === "number")
    .sort((left, right) => (left.capturedAt ?? 0) - (right.capturedAt ?? 0));
  if (runtimeIncidentFrames.length > 0) {
    const lastFrame = runtimeIncidentFrames[runtimeIncidentFrames.length - 1];
    sources.push({
      id: "rune-runtime-incident-sequence",
      label: runtimeIncidentFrames.length > 1 ? "실제 런타임 흐름" : "실제 런타임 프레임",
      description:
        "제보 버튼 시점 이미지와 별도로, 실제 감지 루프가 사용한 미니맵 원본입니다.",
      src: lastFrame.src,
      sequenceKind: "runtime-incident",
      frames: runtimeIncidentFrames.map((frame) => ({
        label: frame.label,
        src: frame.src,
        sampledAt: frame.capturedAt as number,
      })),
    });
  }
  sources.push(reportSource);
  return sources;
}

export async function runCurrentRecognition(
  view: TroubleshooterViewModel,
  sourceId?: string,
): Promise<CurrentRecognitionResult> {
  const availability = getCurrentRecognitionAvailability(view, sourceId);
  if (!availability.available) {
    throw new Error(availability.reason);
  }

  const source = getCurrentRecognitionSource(view, sourceId);
  if (!source) {
    throw new Error("현재 인식기에 다시 넣을 원본 화면이 없습니다.");
  }

  const sourceFrames = source.frames ?? [{
    label: source.label,
    src: source.src,
    sampledAt: 0,
  }];
  const imageFrames = await Promise.all(
    sourceFrames.map(async (frame) => ({
      ...frame,
      imageData: await dataUrlToImageData(frame.src),
    })),
  );
  const context = {
    view,
    imageData: imageFrames[imageFrames.length - 1].imageData,
    startedAt: performance.now(),
    buffSlotInputMode: getCurrentRecognitionBuffSlotInputMode(view),
    sequenceFrames: source.frames ? imageFrames : undefined,
    sequenceKind: source.sequenceKind,
  };

  switch (view.feature) {
    case "buff-expiry": {
      const { runBuffExpiryRecognition } = await import("./runners/buffExpiry");
      return runBuffExpiryRecognition(context);
    }
    case "booster-expiry": {
      const { runBoosterRecognition } = await import("./runners/booster");
      return runBoosterRecognition(context);
    }
    case "rune": {
      const { runRuneRecognition } = await import("./runners/rune");
      return runRuneRecognition(context);
    }
    case "hunt-stall": {
      const { runHuntStallRecognition } = await import("./runners/huntStall");
      return runHuntStallRecognition(context);
    }
    case "skill": {
      const { runSkillRecognition } = await import("./runners/skill");
      return runSkillRecognition(context);
    }
    case "special-core": {
      const { runSpecialCoreRecognition } = await import("./runners/specialCore");
      return runSpecialCoreRecognition(context);
    }
    case "ultima-raid-equipment": {
      const { runUltimaRaidEquipmentRecognition } = await import(
        "./runners/ultimaRaidEquipment"
      );
      return runUltimaRaidEquipmentRecognition(context);
    }
    default:
      throw new Error("이 제보 유형에 연결된 최신 인식기가 없습니다.");
  }
}

export function getCurrentRecognitionBuffSlotInputMode(
  view: TroubleshooterViewModel,
): BuffSlotParserInputMode | null {
  const normalized = normalizeDebugSample(view.rawSample);
  const sample = asRecord(normalized.body.sample);
  const explicit = firstString(asRecord(sample.source).parserInputMode);
  if (isBuffSlotParserInputMode(explicit)) {
    return explicit;
  }
  if (view.feature === "special-core") {
    const incidentEvidence = asRecord(sample.specialCoreEvidence);
    if (
      firstString(incidentEvidence.schemaVersion) ===
      "special-core-incident-evidence-v1"
    ) {
      const selection = asRecord(incidentEvidence.selection);
      const selectedFrameIds = new Set(
        [
          ...asArray(selection.mediaFrameIds),
          ...asArray(selection.frameIds),
        ].filter((entry): entry is string => typeof entry === "string"),
      );
      const frames = asArray(incidentEvidence.frames).map(asRecord);
      const selectedFrame =
        frames.find((entry) =>
          selectedFrameIds.has(firstString(entry.id) ?? ""),
        ) ?? frames[0];
      const incidentMode = firstString(
        asRecord(selectedFrame?.source).parserInputMode,
      );
      if (isBuffSlotParserInputMode(incidentMode)) {
        return incidentMode;
      }
    }
    return "topRightQuadrant";
  }
  if (view.feature === "skill" && isBuffDurationSkill(view)) {
    return "topRightQuadrant";
  }
  if (view.feature === "buff-expiry") {
    return "fullFrame";
  }
  return null;
}

function isBuffSlotParserInputMode(value: string | null): value is BuffSlotParserInputMode {
  return value === "fullFrame" || value === "topRightQuadrant" || value === "croppedRoi";
}

export type { CurrentRecognitionResult } from "./types";
