import { parseBuffSlots } from "../../../recognition/buff-slot/parser/parseBuffSlots.js";
import type { BuffIconBox } from "../../../recognition/buff-slot/parser/types.js";
import {
  createBuffSlotCountdownNumberRecognizer,
  type BuffSlotCountdownModelStatus,
  type BuffSlotCountdownNumberRecognizer,
  type BuffSlotCountdownObservation,
} from "../../../recognition/buff-slot/countdown-number";
import type { SkillIconMatcher } from "../../../recognition/skill-precision/legacy-prototype/src";
import {
  createSkillMatcherBundleRuntime,
  type SkillMatcherBundleRuntime,
} from "../../../recognition/skill-precision/skillMatcherBundleRuntime";
import {
  isSkillMatcherBundleSkillId,
  type SkillMatcherBundleSkillId,
} from "../../../recognition/skill-precision/skillMatcherBundleRegistry";
import { createBottomRightRemainingCountRecognizer } from "../../../recognition/skill-precision/remaining-count/bottomRightRemainingCountRecognizer";
import type {
  BottomRightRemainingCountModelStatus,
  BottomRightRemainingCountObservation,
  BottomRightRemainingCountRecognizer,
} from "../../../recognition/skill-precision/remaining-count/bottomRightRemainingCountContract";
import type {
  SkillBuffDurationCandidateIcon,
  SkillBuffDurationDetectedIcon,
  SkillBuffDurationIcon,
  SkillBuffDurationMatch,
  SkillBuffDurationSampleRequest,
  SkillBuffDurationSampleResponse,
  SkillBuffDurationTargetDetection,
  SkillBuffDurationTargetRequest,
} from "./skillPrecisionAnalysisRuntime";

const NORMALIZED_ICON_SIZE = 32;
const MAX_CANDIDATE_ICONS = 40;
const DEFAULT_TARGET_SKILL_ID = "hologramGraffitiBarrierVi";
const DEFAULT_TARGET_REQUEST: SkillBuffDurationTargetRequest = {
  skillId: DEFAULT_TARGET_SKILL_ID,
  detectorId: "hologramGraffitiBarrierVi",
  matcherEngine: "skill-bundle-v1",
  matcherSkillId: "barrier",
  maxBuffRowIndex: 1,
};

type RuntimeMatcherEngine = "prototype" | "skill-bundle-v1";

type BaseCandidateIcon = Omit<SkillBuffDurationCandidateIcon, "match" | "countdown"> & {
  matchResult: RuntimeSkillIconMatchResult;
  matcherEngine: RuntimeMatcherEngine;
};

type RuntimeSkillIconCandidate = {
  detectorId: string;
  skillId: string;
  displayName: string;
  label: string;
  matched: boolean;
  score: number;
  threshold: number;
  margin: number;
  decisionReason: string;
  bundleId?: string | null;
  modelVersion?: string | null;
  gateScore?: number | null;
  gateThreshold?: number | null;
  gateMargin?: number | null;
};

type RuntimeSkillIconMatchResult = {
  kind: "target" | "unknown";
  matched: boolean;
  skillId: string | null;
  appSkillId?: string | null;
  displayName: string | null;
  label: string | null;
  score: number;
  margin: number;
  decisionReason: string;
  bestMatch: RuntimeSkillIconCandidate | null;
  candidates: readonly RuntimeSkillIconCandidate[];
  elapsedMs: number;
  matcherEngine?: string | null;
  bundleId?: string | null;
  modelVersion?: string | null;
  baseSkillId?: string | null;
  gateScore?: number | null;
  gateThreshold?: number | null;
  gateMargin?: number | null;
  bundleDecisions?: readonly RuntimeSkillMatcherBundleDecision[];
};

type RuntimeSkillMatcherBundleDecision = {
  bundleId: string;
  baseSkillId?: string | null;
  decisionReason: string;
};

export type SkillPrecisionAnalysisProcessorOptions = {
  now: () => number;
};

export class SkillPrecisionAnalysisProcessor {
  private skillIconMatchers = new Map<string, Promise<SkillIconMatcher>>();
  private readonly skillMatcherBundleRuntime: SkillMatcherBundleRuntime =
    createSkillMatcherBundleRuntime();
  private countdownRecognizer: BuffSlotCountdownNumberRecognizer | null = null;
  private bottomRightRemainingCountRecognizer: BottomRightRemainingCountRecognizer | null = null;
  private readonly now: () => number;

  constructor({ now }: SkillPrecisionAnalysisProcessorOptions) {
    this.now = now;
  }

  async process(request: SkillBuffDurationSampleRequest): Promise<SkillBuffDurationSampleResponse> {
    const started = this.now();
    const targetRequests = normalizeSkillBuffDurationTargetRequests(request.targets);
    const detectStarted = this.now();
    const extracted = request.buffSlotAnalysis ?? await parseBuffSlots(request.imageData, {
      outputSize: NORMALIZED_ICON_SIZE,
      inputMode: request.buffSlotInputMode,
    });
    const detectMs = this.now() - detectStarted;
    const icons = extracted.icons.map(toSkillBuffDurationIcon);
    const parserRowCount = getSkillBuffDurationBoxRows(extracted.boxes).length;
    const maxBuffRowIndex = Math.max(...targetRequests.map((target) => target.maxBuffRowIndex ?? 1));
    const matcherBoxIndexes = getSkillBuffDurationMatcherBoxIndexes(
      extracted.boxes,
      maxBuffRowIndex,
    );
    const matcherIcons = matcherBoxIndexes.flatMap((index) => icons[index] ?? []);
    const matchStarted = this.now();
    const baseCandidateIcons = matcherIcons.length
      ? await this.getBaseCandidateIcons({
          boxes: extracted.boxes,
          icons,
          matcherBoxIndexes,
          matcherIcons,
          targets: targetRequests,
        })
      : [];
    const matchMs = matcherIcons.length ? this.now() - matchStarted : 0;
    const detectedBaseIcons = getDetectedBaseIcons(baseCandidateIcons, targetRequests);
    const numberStarted = this.now();
    const numberObservations = this.getNumberObservations(detectedBaseIcons, targetRequests);
    const numberMs = this.now() - numberStarted;
    const detectionsBySkillId = Object.fromEntries(
      targetRequests.map((target) => [
        target.skillId,
        buildTargetDetection({
          baseCandidateIcons,
          countdownObservations: numberObservations.countdownByBoxIndex,
          remainingCountObservations: numberObservations.remainingCountByBoxIndex,
          target,
        }),
      ]),
    );
    const defaultTargetDetection = detectionsBySkillId[targetRequests[0]?.skillId ?? DEFAULT_TARGET_SKILL_ID] ?? {
      skillId: DEFAULT_TARGET_SKILL_ID,
      detectedCount: 0,
      detectedIcon: null,
      candidateIcons: [],
    };
    const detectedIcons: SkillBuffDurationDetectedIcon[] = defaultTargetDetection.candidateIcons.filter(
      (candidate) => candidate.match.matched,
    );
    const detectedIcon = defaultTargetDetection.detectedIcon;

    return {
      sampledAt: request.sampledAt ?? null,
      boxCount: extracted.boxes.length,
      parserRowCount,
      parserEngine: extracted.engine,
      parserVersion: extracted.parserVersion,
      parserFallbackReason: extracted.fallbackReason ?? null,
      detectedCount: defaultTargetDetection.detectedCount,
      detectedIcon,
      candidateIcons: defaultTargetDetection.candidateIcons,
      detectionsBySkillId,
      unsupported: false,
      unsupportedReason: null,
      performance: {
        totalMs: roundMs(this.now() - started),
        detectMs: roundMs(detectMs),
        matchMs: roundMs(matchMs),
        countdownMs: roundMs(numberMs),
        countdownCount: numberObservations.countdownByBoxIndex.size,
        countdownModelStatus: numberObservations.countdownModelStatus,
        remainingCountMs: roundMs(numberMs),
        remainingCountCount: numberObservations.remainingCountByBoxIndex.size,
        remainingCountModelStatus: numberObservations.remainingCountModelStatus,
        boxCount: extracted.boxes.length,
      },
    };
  }

  private async getBaseCandidateIcons({
    boxes,
    icons,
    matcherBoxIndexes,
    matcherIcons,
    targets,
  }: {
    boxes: BuffIconBox[];
    icons: SkillBuffDurationIcon[];
    matcherBoxIndexes: number[];
    matcherIcons: SkillBuffDurationIcon[];
    targets: SkillBuffDurationTargetRequest[];
  }): Promise<BaseCandidateIcon[]> {
    const candidates: BaseCandidateIcon[] = [];
    const prototypeTargets = targets.filter(
      (target) => getRuntimeMatcherEngine(target.matcherEngine) === "prototype",
    );
    if (prototypeTargets.length > 0) {
      const matcher = await this.getSkillIconMatcher(prototypeTargets);
      candidates.push(
        ...this.toBaseCandidateIcons({
          boxes,
          icons,
          matcherBoxIndexes,
          matcherEngine: "prototype",
          matcherVersion: matcher.version,
          matches: matcher.matchBatch(matcherIcons),
        }),
      );
    }

    const bundleTargets = targets.filter(
      (target) => getRuntimeMatcherEngine(target.matcherEngine) === "skill-bundle-v1",
    );
    if (bundleTargets.length > 0) {
      const activeSkillIds = getBundleTargetSkillIds(bundleTargets);
      candidates.push(
        ...this.toBaseCandidateIcons({
          boxes,
          icons,
          matcherBoxIndexes,
          matcherEngine: "skill-bundle-v1",
          matcherVersion: null,
          matches: await this.skillMatcherBundleRuntime.matchBatch(
            matcherIcons,
            activeSkillIds,
          ),
        }),
      );
    }
    return candidates;
  }

  private toBaseCandidateIcons({
    boxes,
    icons,
    matcherBoxIndexes,
    matcherEngine,
    matcherVersion,
    matches,
  }: {
    boxes: BuffIconBox[];
    icons: SkillBuffDurationIcon[];
    matcherBoxIndexes: number[];
    matcherEngine: RuntimeMatcherEngine;
    matcherVersion: string | null;
    matches: readonly RuntimeSkillIconMatchResult[];
  }): BaseCandidateIcon[] {
    return matches.flatMap((match, matchIndex) => {
      const index = matcherBoxIndexes[matchIndex];
      if (typeof index !== "number") {
        return [];
      }
      const box = boxes[index];
      const icon = icons[index];
      if (!box || !icon) {
        return [];
      }
      return [
        {
          boxIndex: index,
          box: {
            x: Math.round(box.x),
            y: Math.round(box.y),
            size: Math.round(box.size),
            confidence: round(box.confidence),
            score: round(box.score),
          },
          icon,
          matcherEngine,
          matchResult: {
            ...match,
            matcherEngine: match.matcherEngine ?? matcherEngine,
            modelVersion: match.modelVersion ?? matcherVersion,
          },
        },
      ];
    });
  }

  private getSkillIconMatcher(targets: SkillBuffDurationTargetRequest[]): Promise<SkillIconMatcher> {
    const enabledIds = getEnabledDetectorIds(targets);
    const cacheKey = enabledIds.join("|") || "*";
    const cached = this.skillIconMatchers.get(cacheKey);
    if (cached) {
      return cached;
    }
    const matcher = import(
      "../../../recognition/skill-precision/legacy-prototype/src"
    ).then(({ createSkillIconMatcher }) =>
      enabledIds.length
        ? createSkillIconMatcher({ enabledIds })
        : createSkillIconMatcher(),
    );
    this.skillIconMatchers.set(cacheKey, matcher);
    return matcher;
  }

  private getCountdownRecognizer(): BuffSlotCountdownNumberRecognizer {
    if (!this.countdownRecognizer) {
      this.countdownRecognizer = createBuffSlotCountdownNumberRecognizer();
    }
    return this.countdownRecognizer;
  }

  private getBottomRightRemainingCountRecognizer(): BottomRightRemainingCountRecognizer {
    if (!this.bottomRightRemainingCountRecognizer) {
      this.bottomRightRemainingCountRecognizer = createBottomRightRemainingCountRecognizer();
    }
    return this.bottomRightRemainingCountRecognizer;
  }

  private getNumberObservations(
    detectedIcons: SkillBuffDurationDetectedIcon[],
    targets: SkillBuffDurationTargetRequest[],
  ): {
    countdownByBoxIndex: Map<number, BuffSlotCountdownObservation>;
    countdownModelStatus: BuffSlotCountdownModelStatus;
    remainingCountByBoxIndex: Map<number, BottomRightRemainingCountObservation>;
    remainingCountModelStatus: BottomRightRemainingCountModelStatus;
  } {
    if (detectedIcons.length <= 0) {
      return {
        countdownByBoxIndex: new Map(),
        countdownModelStatus: "idle",
        remainingCountByBoxIndex: new Map(),
        remainingCountModelStatus: "idle",
      };
    }

    const countdownByBoxIndex = new Map<number, BuffSlotCountdownObservation>();
    const remainingCountByBoxIndex = new Map<number, BottomRightRemainingCountObservation>();
    let countdownModelStatus: BuffSlotCountdownModelStatus = "idle";
    let remainingCountModelStatus: BottomRightRemainingCountModelStatus = "idle";
    detectedIcons.forEach((detectedIcon) => {
      const target = targets.find((item) => item.skillId === detectedIcon.match.skillId);
      if (target?.valueKind === "remaining-count") {
        const recognizer = this.getBottomRightRemainingCountRecognizer();
        const remainingCount = recognizer.recognizeIfReady(detectedIcon.icon);
        remainingCountModelStatus = recognizer.getStatus();
        if (remainingCount) {
          remainingCountByBoxIndex.set(detectedIcon.boxIndex, remainingCount);
        }
        return;
      }

      const recognizer = this.getCountdownRecognizer();
      const countdown = recognizer.recognizeIfReady(detectedIcon.icon);
      countdownModelStatus = recognizer.getStatus();
      if (countdown) {
        countdownByBoxIndex.set(detectedIcon.boxIndex, countdown);
      }
    });
    return {
      countdownByBoxIndex,
      countdownModelStatus,
      remainingCountByBoxIndex,
      remainingCountModelStatus,
    };
  }
}

export function toSkillBuffDurationMatch(
  match: RuntimeSkillIconMatchResult,
  target: SkillBuffDurationTargetRequest | string = DEFAULT_TARGET_SKILL_ID,
): SkillBuffDurationMatch {
  const targetSkillId = typeof target === "string" ? target : target.skillId;
  const matcherSkillId = typeof target === "string" ? target : target.matcherSkillId ?? target.skillId;
  const targetCandidate = match.candidates.find((candidate) => candidate.skillId === matcherSkillId) ?? null;
  const evidenceCandidate = targetCandidate ?? match.bestMatch;
  const targetBundleDecision = targetCandidate?.bundleId
    ? match.bundleDecisions?.find((decision) => decision.bundleId === targetCandidate.bundleId) ?? null
    : null;
  const baseSkillId = targetBundleDecision?.baseSkillId ?? match.baseSkillId ?? null;
  const rawSkillId = baseSkillId ?? match.bestMatch?.skillId ?? match.skillId;
  const matched = match.kind === "target" && match.skillId === matcherSkillId;
  return {
    matched,
    skillId: matched ? targetSkillId : rawSkillId,
    displayName: evidenceCandidate?.displayName ?? match.displayName,
    detectorId: evidenceCandidate?.detectorId ?? null,
    matcherEngine: match.matcherEngine ?? null,
    bundleId: evidenceCandidate?.bundleId ?? match.bundleId ?? null,
    modelVersion: evidenceCandidate?.modelVersion ?? match.modelVersion ?? null,
    baseSkillId,
    rawSkillId,
    score: round(evidenceCandidate?.score ?? match.score),
    threshold: evidenceCandidate?.threshold ?? 0,
    margin: round(evidenceCandidate?.margin ?? match.margin),
    gateScore: evidenceCandidate?.gateScore ?? match.gateScore ?? null,
    gateThreshold: evidenceCandidate?.gateThreshold ?? match.gateThreshold ?? null,
    gateMargin: evidenceCandidate?.gateMargin ?? match.gateMargin ?? null,
    decisionReason: getSkillBuffDurationDecisionReason(
      match,
      matcherSkillId,
      targetCandidate,
      targetBundleDecision,
    ),
  };
}

function getSkillBuffDurationDecisionReason(
  match: RuntimeSkillIconMatchResult,
  targetSkillId: string,
  targetCandidate: RuntimeSkillIconCandidate | null,
  targetBundleDecision: RuntimeSkillMatcherBundleDecision | null,
): string {
  if (match.decisionReason === "cross_bundle_conflict") {
    return "cross_bundle_conflict";
  }
  if (match.kind === "target" && match.skillId === targetSkillId) {
    return targetCandidate?.decisionReason ?? match.decisionReason;
  }
  if (targetBundleDecision) {
    if (targetBundleDecision.decisionReason === "base_target_disabled") {
      return "base_target_disabled";
    }
    if (
      targetBundleDecision.baseSkillId &&
      targetBundleDecision.baseSkillId !== targetSkillId
    ) {
      return "other_skill_target";
    }
    return targetBundleDecision.decisionReason;
  }
  if (match.kind === "target" && match.skillId !== targetSkillId) {
    return "other_skill_target";
  }
  if (match.decisionReason === "base_target_disabled") {
    return "base_target_disabled";
  }
  return targetCandidate?.decisionReason === "not_base_target"
    ? match.decisionReason
    : targetCandidate?.decisionReason ?? match.bestMatch?.decisionReason ?? match.decisionReason;
}

export function getSkillBuffDurationMatcherBoxIndexes(
  boxes: BuffIconBox[],
  maxBuffRowIndex = 1,
): number[] {
  const rows = getSkillBuffDurationBoxRows(boxes);
  const eligibleRowCount = getSkillBuffDurationEligibleRowCount(rows.length, maxBuffRowIndex);
  const eligibleIndexes = new Set(
    rows
      .slice(0, eligibleRowCount)
      .flatMap((row) => row.indexes),
  );
  return boxes
    .map((_, index) => index)
    .filter((index) => eligibleIndexes.has(index));
}

function getSkillBuffDurationEligibleRowCount(rowCount: number, maxBuffRowIndex: number): number {
  if (rowCount <= 0) {
    return 0;
  }
  const configuredRowCount = Math.max(1, maxBuffRowIndex + 1);
  const upperRowCount = rowCount <= 2 ? 1 : 2;
  return Math.min(rowCount, configuredRowCount, upperRowCount);
}

function getSkillBuffDurationBoxRows(boxes: BuffIconBox[]): Array<{ y: number; size: number; indexes: number[] }> {
  const rows: Array<{ y: number; size: number; indexes: number[] }> = [];
  boxes.forEach((box, index) => {
    const row = rows.find((candidate) => areSkillBuffDurationBoxesOnSameRow(candidate, box));
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

function areSkillBuffDurationBoxesOnSameRow(
  row: { y: number; size: number },
  box: BuffIconBox,
): boolean {
  const tolerance = Math.max(6, Math.max(row.size, box.size) * 0.48);
  return Math.abs(row.y - box.y) <= tolerance;
}

function prioritizeCandidateIcons(
  candidateIcons: SkillBuffDurationCandidateIcon[],
): SkillBuffDurationCandidateIcon[] {
  return [...candidateIcons].sort((left, right) => {
    if (left.match.matched !== right.match.matched) {
      return left.match.matched ? -1 : 1;
    }
    if (right.match.score !== left.match.score) {
      return right.match.score - left.match.score;
    }
    return left.boxIndex - right.boxIndex;
  });
}

function normalizeSkillBuffDurationTargetRequests(
  targets: SkillBuffDurationTargetRequest[] | undefined,
): SkillBuffDurationTargetRequest[] {
  if (!targets?.length) {
    return [DEFAULT_TARGET_REQUEST];
  }

  const seen = new Set<string>();
  const normalized: SkillBuffDurationTargetRequest[] = targets.flatMap((target) => {
    const skillId = typeof target.skillId === "string" ? target.skillId : "";
    if (!skillId || seen.has(skillId)) {
      return [];
    }
    seen.add(skillId);
    const matcherEngine = getRuntimeMatcherEngine(target.matcherEngine);
    const valueKind: SkillBuffDurationTargetRequest["valueKind"] =
      target.valueKind === "remaining-count" ? "remaining-count" : "countdown";
    const requestedMatcherSkillId =
      typeof target.matcherSkillId === "string" ? target.matcherSkillId : undefined;
    const matcherSkillId = matcherEngine === "skill-bundle-v1"
      ? requestedMatcherSkillId ?? inferBundleMatcherSkillId(skillId)
      : requestedMatcherSkillId;
    return [
      {
        skillId,
        matcherEngine,
        matcherSkillId,
        detectorId: typeof target.detectorId === "string" ? target.detectorId : undefined,
        maxBuffRowIndex: Math.max(0, Math.floor(target.maxBuffRowIndex ?? 1)),
        valueKind,
      },
    ];
  });
  return normalized.length ? normalized : [DEFAULT_TARGET_REQUEST];
}

function getEnabledDetectorIds(targets: SkillBuffDurationTargetRequest[]): string[] {
  return [...new Set(targets.flatMap((target) => {
    const detectorId = typeof target.detectorId === "string" ? target.detectorId.trim() : "";
    return detectorId ? [detectorId] : [];
  }))].sort();
}

function getDetectedBaseIcons(
  baseCandidateIcons: BaseCandidateIcon[],
  targets: SkillBuffDurationTargetRequest[],
): SkillBuffDurationDetectedIcon[] {
  return baseCandidateIcons.flatMap((candidate) => {
    const target = targets.find((item) => {
      if (!isCandidateRelevantToTarget(candidate, item)) {
        return false;
      }
      return candidate.matchResult.skillId === (item.matcherSkillId ?? item.skillId);
    });
    if (!target || candidate.matchResult.kind !== "target") {
      return [];
    }
    return [
      {
        boxIndex: candidate.boxIndex,
        box: candidate.box,
        icon: candidate.icon,
        match: toSkillBuffDurationMatch(candidate.matchResult, target),
      },
    ];
  });
}

function buildTargetDetection({
  baseCandidateIcons,
  countdownObservations,
  remainingCountObservations,
  target,
}: {
  baseCandidateIcons: BaseCandidateIcon[];
  countdownObservations: Map<number, BuffSlotCountdownObservation>;
  remainingCountObservations: Map<number, BottomRightRemainingCountObservation>;
  target: SkillBuffDurationTargetRequest;
}): SkillBuffDurationTargetDetection {
  const candidateIcons = prioritizeCandidateIcons(
    baseCandidateIcons.filter((candidate) => isCandidateRelevantToTarget(candidate, target)).map((candidate) => ({
      boxIndex: candidate.boxIndex,
      box: candidate.box,
      icon: candidate.icon,
      match: toSkillBuffDurationMatch(candidate.matchResult, target),
      countdown: countdownObservations.get(candidate.boxIndex) ?? null,
      remainingCount: remainingCountObservations.get(candidate.boxIndex) ?? null,
    })),
  ).slice(0, MAX_CANDIDATE_ICONS);
  const detectedIcons = candidateIcons.filter((candidate) => candidate.match.matched);
  return {
    skillId: target.skillId,
    detectedCount: detectedIcons.length,
    detectedIcon: detectedIcons.sort((a, b) => b.match.score - a.match.score)[0] ?? null,
    candidateIcons,
  };
}

function isCandidateRelevantToTarget(
  candidate: BaseCandidateIcon,
  target: SkillBuffDurationTargetRequest,
): boolean {
  return candidate.matcherEngine === getRuntimeMatcherEngine(target.matcherEngine);
}

function getRuntimeMatcherEngine(
  matcherEngine: SkillBuffDurationTargetRequest["matcherEngine"],
): RuntimeMatcherEngine {
  return matcherEngine === "skill-bundle-v1" ||
    matcherEngine === "deep-v2" ||
    matcherEngine === "maehwa-yein-deep-v1"
    ? "skill-bundle-v1"
    : "prototype";
}

function getBundleTargetSkillIds(
  targets: SkillBuffDurationTargetRequest[],
): SkillMatcherBundleSkillId[] {
  return [...new Set(targets.map((target) => {
    const matcherSkillId = target.matcherSkillId ?? inferBundleMatcherSkillId(target.skillId);
    if (!matcherSkillId || !isSkillMatcherBundleSkillId(matcherSkillId)) {
      throw new Error(`unknown-skill-matcher-bundle-target:${target.skillId}`);
    }
    return matcherSkillId;
  }))];
}

function inferBundleMatcherSkillId(skillId: string): SkillMatcherBundleSkillId | undefined {
  if (skillId === "janusDeepV2" || skillId === "janus") return "janus";
  if (skillId === "hologramGraffitiBarrierVi" || skillId === "barrier") return "barrier";
  if (skillId === "fountainDeepV2" || skillId === "fountain") return "fountain";
  if (skillId === "maehwaYeinDeepV1" || skillId === "maehwaYein") return "maehwaYein";
  return undefined;
}

function toSkillBuffDurationIcon(icon: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): SkillBuffDurationIcon {
  return {
    width: icon.width,
    height: icon.height,
    data: new Uint8ClampedArray(icon.data),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}
