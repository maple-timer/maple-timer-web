import { parseBuffSlots } from "../../../recognition/buff-slot/parser/parseBuffSlots.js";
import type { BuffIconBox } from "../../../recognition/buff-slot/parser/types.js";
import { createSpecialCoreMatcher } from "../../../recognition/special-core/specialCoreMatcher";
import { SPECIAL_CORE_TARGET_ID } from "../../../recognition/special-core/specialCoreDeepV2Runtime";
import {
  type SpecialCoreIcon,
  type SpecialCoreMatcher,
  type SpecialCoreMatcherResult,
} from "../../../recognition/special-core/specialCoreMatcherTypes";
import {
  type SpecialCoreBox,
  type SpecialCoreCandidateIcon,
  type SpecialCoreMatch,
  type SpecialCoreRowGroup,
  type SpecialCoreSampleRequest,
  type SpecialCoreSampleResponse,
} from "./specialCoreAnalysisRuntime";

const NORMALIZED_ICON_SIZE = 32;
const MAX_CANDIDATE_ICONS = 40;

export type SpecialCoreAnalysisProcessorOptions = {
  now: () => number;
  createMatcher?: () => Promise<SpecialCoreMatcher>;
  parse?: typeof parseBuffSlots;
};

export class SpecialCoreAnalysisProcessor {
  private matcher: Promise<SpecialCoreMatcher> | null = null;
  private readonly now: () => number;
  private readonly createMatcher: () => Promise<SpecialCoreMatcher>;
  private readonly parse: typeof parseBuffSlots;

  constructor({
    now,
    createMatcher: createMatcherValue = createSpecialCoreMatcher,
    parse: parseValue = parseBuffSlots,
  }: SpecialCoreAnalysisProcessorOptions) {
    this.now = now;
    this.createMatcher = createMatcherValue;
    this.parse = parseValue;
  }

  async process(request: SpecialCoreSampleRequest): Promise<SpecialCoreSampleResponse> {
    const started = this.now();
    const detectStarted = this.now();
    const extracted =
      request.buffSlotAnalysis ??
      (await this.parse(request.imageData, {
        outputSize: NORMALIZED_ICON_SIZE,
        inputMode: request.buffSlotInputMode,
      }));
    const detectMs = this.now() - detectStarted;
    const icons = extracted.icons.map(toSpecialCoreIcon);
    const rowGroups = getBuffRowGroups(extracted.boxes);
    const matcherBoxIndexes = rowGroups
      .filter((row) => row.eligible)
      .flatMap((row) => row.boxIndexes);
    const matcherIcons = matcherBoxIndexes.flatMap((index) => icons[index] ?? []);
    const matchStarted = this.now();
    const matcher = matcherIcons.length ? await this.getMatcher() : null;
    const matches = matcher ? await matcher.matchBatch(matcherIcons) : [];
    const matchMs = matcher ? this.now() - matchStarted : 0;
    const candidateIcons = prioritizeCandidateIcons(
      matches.flatMap((match, matchIndex) => {
        const boxIndex = matcherBoxIndexes[matchIndex];
        if (typeof boxIndex !== "number") {
          return [];
        }
        const box = extracted.boxes[boxIndex];
        const icon = icons[boxIndex];
        if (!box || !icon) {
          return [];
        }
        return [
          {
            boxIndex,
            box: toSpecialCoreBox(box),
            icon,
            match: toSpecialCoreMatch(match),
          },
        ];
      }),
    ).slice(0, MAX_CANDIDATE_ICONS);
    const detectedIcons = candidateIcons.filter((candidate) => candidate.match.matched);
    const detectedIcon = detectedIcons.sort(compareSpecialCoreCandidates)[0] ?? null;

    return {
      sampledAt: request.sampledAt ?? null,
      boxCount: extracted.boxes.length,
      parserEngine: extracted.engine,
      parserVersion: extracted.parserVersion,
      parserFallbackReason: extracted.fallbackReason ?? null,
      parserRuntime: extracted.runtime ?? null,
      parsedBoxes: extracted.boxes.map(toSpecialCoreBox),
      rowGroups,
      eligibleBoxIndexes: matcherBoxIndexes,
      detectedCount: detectedIcons.length,
      detectedIcon,
      candidateIcons,
      performance: {
        totalMs: roundMs(this.now() - started),
        detectMs: roundMs(detectMs),
        matchMs: roundMs(matchMs),
        boxCount: extracted.boxes.length,
      },
      unsupported: false,
      unsupportedReason: null,
    };
  }

  private getMatcher(): Promise<SpecialCoreMatcher> {
    if (this.matcher) {
      return this.matcher;
    }
    const pending = this.createMatcher();
    this.matcher = pending;
    pending.catch(() => {
      if (this.matcher === pending) {
        this.matcher = null;
      }
    });
    return pending;
  }
}

export function getTopBuffRowBoxIndexes(
  boxes: BuffIconBox[],
): number[] {
  return getBuffRowGroups(boxes)
    .filter((row) => row.eligible)
    .flatMap((row) => row.boxIndexes);
}

export function getBuffRowGroups(
  boxes: BuffIconBox[],
): SpecialCoreRowGroup[] {
  const rows = getBuffBoxRows(boxes);
  const includedRowCount = Math.ceil(rows.length / 2);
  return rows.map((row, rowIndex) => ({
    rowIndex,
    y: Math.round(row.y),
    size: Math.round(row.size),
    boxIndexes: [...row.indexes],
    eligible: rowIndex < includedRowCount,
  }));
}

function getBuffBoxRows(boxes: BuffIconBox[]): Array<{ y: number; size: number; indexes: number[] }> {
  const rows: Array<{ y: number; size: number; indexes: number[] }> = [];
  boxes.forEach((box, index) => {
    const row = rows.find((candidate) => areBoxesOnSameRow(candidate, box));
    if (!row) {
      rows.push({ y: box.y, size: box.size, indexes: [index] });
      return;
    }
    const nextCount = row.indexes.length + 1;
    row.y = (row.y * row.indexes.length + box.y) / nextCount;
    row.size = Math.max(row.size, box.size);
    row.indexes.push(index);
  });
  return rows.sort((left, right) => left.y - right.y);
}

function areBoxesOnSameRow(row: { y: number; size: number }, box: BuffIconBox): boolean {
  const tolerance = Math.max(6, Math.max(row.size, box.size) * 0.48);
  return Math.abs(row.y - box.y) <= tolerance;
}

function prioritizeCandidateIcons(
  candidateIcons: SpecialCoreCandidateIcon[],
): SpecialCoreCandidateIcon[] {
  return [...candidateIcons].sort(compareSpecialCoreCandidates);
}

function compareSpecialCoreCandidates(
  left: SpecialCoreCandidateIcon,
  right: SpecialCoreCandidateIcon,
): number {
  if (left.match.matched !== right.match.matched) {
    return left.match.matched ? -1 : 1;
  }
  if (right.match.gateScore !== left.match.gateScore) {
    return right.match.gateScore - left.match.gateScore;
  }
  if (right.match.score !== left.match.score) {
    return right.match.score - left.match.score;
  }
  return left.boxIndex - right.boxIndex;
}

function toSpecialCoreBox(box: BuffIconBox): SpecialCoreBox {
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    size: Math.round(box.size),
    confidence: round(box.confidence),
    score: round(box.score),
  };
}

function toSpecialCoreIcon(icon: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): SpecialCoreIcon {
  return {
    width: icon.width,
    height: icon.height,
    data: new Uint8ClampedArray(icon.data),
  };
}

function toSpecialCoreMatch(
  match: SpecialCoreMatcherResult,
): SpecialCoreMatch {
  return {
    matched: match.kind === "target" && match.targetId === SPECIAL_CORE_TARGET_ID,
    targetId: match.targetId,
    bundleId: match.bundleId,
    modelId: match.modelId,
    modelVersion: match.modelVersion,
    variantId: match.variantId,
    gateVersion: match.gateVersion,
    score: round(match.score),
    threshold: match.threshold,
    margin: round(match.margin),
    gateScore: round(match.gateScore),
    gateThreshold: match.gateThreshold,
    gateMargin: round(match.gateMargin),
    rescueThreshold: match.rescueThreshold,
    rescueMargin: round(match.rescueMargin),
    basePassed: match.basePassed,
    positiveGatePassed: match.positiveGatePassed,
    primaryPassed: match.primaryPassed,
    rescuePassed: match.rescuePassed,
    decisionReason: match.decisionReason,
    elapsedMs: round(match.elapsedMs),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}
