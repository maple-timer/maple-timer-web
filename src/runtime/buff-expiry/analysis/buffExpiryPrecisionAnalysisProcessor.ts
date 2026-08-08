import {
  BUFF_SLOT_AUTO_PARSER_VERSION,
  parseBuffSlots,
} from "../../../recognition/buff-slot/parser/parseBuffSlots.js";
import {
  BUFF_EXPIRY_TARGET_GROUPS,
  normalizeBuffExpiryTargetGroups,
} from "../../../contracts/recognition/buffExpiryRecognition";
import type {
  BuffExpiryPrecisionBestGroupCandidate,
  BuffExpiryPrecisionBox,
  BuffExpiryPrecisionCountdownModelStatus,
  BuffExpiryPrecisionCountdownObservation,
  BuffExpiryPrecisionIconObservation,
  BuffExpiryPrecisionModuleVersions,
  BuffExpiryPrecisionSampleRequest,
  BuffExpiryPrecisionSampleResponse,
  BuffExpiryPrecisionTargetGroup,
} from "./buffExpiryPrecisionAnalysisRuntime";
import { assignBuffExpiryPrecisionBoxLayout } from "./buffExpiryPrecisionLayout";
import {
  createBuffGroupMatcherBundleRuntime,
  getBuffGroupMatcherModelStatus,
  type BuffGroupMatcherBundleRuntime,
} from "../../../recognition/buff-expiry/group-matcher/buffGroupMatcherBundleRuntime";
import type {
  BuffGroupMatcherBundleCandidate,
  BuffGroupMatcherMatchResult,
} from "../../../recognition/buff-expiry/group-matcher/buffGroupMatcherBundleDecision";
import {
  BUFF_SLOT_COUNTDOWN_NUMBER_MODEL_VERSION as BUFF_EXPIRY_PRECISION_COUNTDOWN_MODEL_VERSION,
  createBuffSlotCountdownNumberRecognizer as createBuffExpiryPrecisionCountdownNumberRecognizer,
  type BuffSlotCountdownNumberRecognizer as BuffExpiryPrecisionCountdownNumberRecognizer,
} from "../../../recognition/buff-slot/countdown-number";
import {
  BUFF_SLOT_CLUSTER_LOCALIZER_VERSION,
  localizeBuffSlotCluster,
} from "../../../recognition/buff-slot/layout/buffSlotClusterLocalization";

const NORMALIZED_ICON_SIZE = 32;
const BUFF_EXPIRY_PRECISION_MODULE_VERSIONS: BuffExpiryPrecisionModuleVersions = {
  runtime: "buff-expiry-precision-runtime-v3",
  parser: BUFF_SLOT_AUTO_PARSER_VERSION,
  matcher: "buff-group-bundle-v1",
  matcherModel: "buff-group-bundles-20260711",
  countdown: BUFF_EXPIRY_PRECISION_COUNTDOWN_MODEL_VERSION,
  localizer: BUFF_SLOT_CLUSTER_LOCALIZER_VERSION,
};
const BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_CANDIDATES: Record<BuffExpiryPrecisionTargetGroup, number> = {
  unionWealth: 1,
  unionLuck: 1,
  potion: 2,
  expCoupon: 1,
};

export type BuffExpiryPrecisionMatcherObservation = {
  id: string;
  capturedAtMs?: number;
  identity: Omit<BuffGroupMatcherMatchResult, "decisionReason"> & { decisionReason: string };
};

export type BuffExpiryPrecisionAnalysisProcessorOptions = {
  now: () => number;
  matcher?: BuffGroupMatcherBundleRuntime;
  parse?: typeof parseBuffSlots;
};

export class BuffExpiryPrecisionAnalysisProcessor {
  private countdownRecognizer: BuffExpiryPrecisionCountdownNumberRecognizer | null = null;
  private readonly now: () => number;
  private readonly matcher: BuffGroupMatcherBundleRuntime;
  private readonly parse: typeof parseBuffSlots;

  constructor({
    now,
    matcher = createBuffGroupMatcherBundleRuntime(),
    parse = parseBuffSlots,
  }: BuffExpiryPrecisionAnalysisProcessorOptions) {
    this.now = now;
    this.matcher = matcher;
    this.parse = parse;
  }

  async preload(activeGroups?: BuffExpiryPrecisionTargetGroup[]): Promise<{
    countdownModelStatus: BuffExpiryPrecisionCountdownModelStatus;
    matcherModelStatus: "idle" | "loading" | "ready" | "error";
    matcherBundleStatuses: ReturnType<BuffGroupMatcherBundleRuntime["getBundleStatuses"]>;
    moduleVersions: BuffExpiryPrecisionModuleVersions;
  }> {
    const normalizedActiveGroups = normalizeBuffExpiryTargetGroups(activeGroups);
    const [matcherBundleStatuses, countdownModelStatus] = await Promise.all([
      this.matcher.preload(normalizedActiveGroups),
      this.getCountdownRecognizer().preload(),
    ]);
    return {
      countdownModelStatus,
      matcherModelStatus: getBuffGroupMatcherModelStatus(matcherBundleStatuses),
      matcherBundleStatuses,
      moduleVersions: withMatcherBundleVersions(matcherBundleStatuses),
    };
  }

  async process(request: BuffExpiryPrecisionSampleRequest): Promise<BuffExpiryPrecisionSampleResponse> {
    const started = this.now();
    const detectStarted = this.now();
    const extracted = request.buffSlotAnalysis ?? await this.parse(request.imageData, {
      outputSize: NORMALIZED_ICON_SIZE,
      inputMode: request.buffSlotInputMode,
    });
    const detectMs = this.now() - detectStarted;

    const localization = localizeBuffSlotCluster(
      extracted.boxes,
      getBuffSlotSourceSize(request),
    );
    const localizedBoxes = localization.selectedBoxIndexes.flatMap((index) => {
      const box = extracted.boxes[index];
      return box ? [box] : [];
    });
    const boxes = assignBuffExpiryPrecisionBoxLayout(
      localizedBoxes.map((box) => ({
        x: Math.round(box.x),
        y: Math.round(box.y),
        size: Math.round(box.size),
        confidence: round(box.confidence),
        score: round(box.score),
      })),
    );

    const icons = localization.selectedBoxIndexes.flatMap((index) => {
      const icon = extracted.icons[index];
      return icon
        ? [{
            width: icon.width,
            height: icon.height,
            data: new Uint8ClampedArray(icon.data),
          }]
        : [];
    });
    const activeGroups = normalizeBuffExpiryTargetGroups(request.activeGroups);
    const matchStarted = this.now();
    const matcherBatch = await this.matcher.matchBatchIfReady(icons, activeGroups);
    const rawMatcherObservations = toMatcherObservations(
      matcherBatch.results,
      icons.length,
      request.sampledAt,
      matcherBatch.status,
    );
    const matcherObservations = applyBottomFirstTargetEligibility(
      applyUpperRowTargetExclusion(rawMatcherObservations, boxes),
      boxes,
    );
    const matchMs = icons.length ? this.now() - matchStarted : 0;
    const bestGroupDescriptors = selectBestGroupCandidateDescriptors(matcherObservations, boxes);
    const countdownStarted = this.now();
    const countdownObservations = this.getCountdownObservations(icons, matcherObservations);
    const countdownMs = countdownObservations.count ? this.now() - countdownStarted : 0;
    const iconObservations = toPrecisionIconObservations(
      matcherObservations,
      boxes,
      countdownObservations.byBoxIndex,
    );
    const bestByGroup = toBestGroupCandidates(bestGroupDescriptors, countdownObservations.byBoxIndex);
    const performanceMetrics = {
      totalMs: roundMs(this.now() - started),
      detectMs: roundMs(detectMs),
      matchMs: roundMs(matchMs),
      countdownMs: roundMs(countdownMs),
      countdownCount: countdownObservations.count,
      countdownModelStatus: countdownObservations.modelStatus,
      matcherModelStatus: matcherBatch.status,
      matcherBundleStatuses: matcherBatch.bundleStatuses,
      boxCount: extracted.boxes.length,
      localizedBoxCount: boxes.length,
    };

    return {
      boxes: boxes.map((box) => ({
        x: box.x,
        y: box.y,
        size: box.size,
        row: box.row,
        col: box.col,
        confidence: box.confidence,
        score: box.score,
      })),
      icons,
      iconObservations,
      bestByGroup,
      parserEngine: extracted.engine,
      parserFallbackReason: extracted.fallbackReason ?? null,
      buffSlotLocalization: {
        version: localization.version,
        status: localization.status,
        reason: localization.reason,
        parserBoxCount: localization.parserBoxCount,
        parserRowCount: localization.parserRowCount,
        localizedBoxCount: localization.selectedBoxIndexes.length,
        localizedRowCount: localization.selectedRowCount,
        spatialExcludedBoxCount: localization.rejectedBoxIndexes.length,
      },
      moduleVersions: {
        ...withMatcherBundleVersions(matcherBatch.bundleStatuses),
        parser: extracted.parserVersion,
      },
      unsupported: false,
      unsupportedReason: null,
      performance: performanceMetrics,
    };
  }

  private getCountdownRecognizer(): BuffExpiryPrecisionCountdownNumberRecognizer {
    if (!this.countdownRecognizer) {
      this.countdownRecognizer = createBuffExpiryPrecisionCountdownNumberRecognizer();
    }
    return this.countdownRecognizer;
  }

  private getCountdownObservations(
    icons: Array<{ width: number; height: number; data: Uint8ClampedArray }>,
    matcherObservations: BuffExpiryPrecisionMatcherObservation[],
  ): {
    byBoxIndex: Map<number, BuffExpiryPrecisionCountdownObservation>;
    count: number;
    modelStatus: "idle" | "loading" | "ready" | "error";
  } {
    const recognizer = icons.length ? this.getCountdownRecognizer() : null;
    if (!recognizer) {
      return { byBoxIndex: new Map(), count: 0, modelStatus: "idle" };
    }

    recognizer.preload();
    const modelStatus = recognizer.getStatus();
    if (modelStatus !== "ready") {
      return { byBoxIndex: new Map(), count: 0, modelStatus };
    }

    const boxIndices = selectCountdownBoxIndices(matcherObservations);
    const byBoxIndex = new Map<number, BuffExpiryPrecisionCountdownObservation>();
    for (const index of boxIndices) {
      const icon = icons[index];
      if (!icon) {
        continue;
      }
      const countdown = recognizer.recognizeIfReady(icon);
      if (countdown) {
        byBoxIndex.set(index, countdown);
      }
    }
    return { byBoxIndex, count: byBoxIndex.size, modelStatus: recognizer.getStatus() };
  }
}

type BestGroupCandidateDescriptor = Omit<BuffExpiryPrecisionBestGroupCandidate, "countdown">;

export function applyUpperRowTargetExclusion(
  observations: BuffExpiryPrecisionMatcherObservation[],
  boxes: BuffExpiryPrecisionBox[],
): BuffExpiryPrecisionMatcherObservation[] {
  const excludedRows = getUpperRowsToExclude(boxes);
  if (!excludedRows.size) {
    return observations;
  }

  return observations.map((observation, index) => {
    const box = boxes[index];
    if (
      !box ||
      !excludedRows.has(Math.round(box.row)) ||
      observation.identity.kind !== "target"
    ) {
      return observation;
    }

    return {
      ...observation,
      identity: {
        ...observation.identity,
        kind: "unknown",
        group: null,
        decisionReason: `upper_rows_target_excluded:${observation.identity.decisionReason}`,
      },
    };
  });
}

export function applyBottomFirstTargetEligibility(
  observations: BuffExpiryPrecisionMatcherObservation[],
  boxes: BuffExpiryPrecisionBox[],
): BuffExpiryPrecisionMatcherObservation[] {
  const selectedTargetIndices = selectBottomFirstTargetIndices(observations, boxes);

  return observations.map((observation, index) => {
    const box = boxes[index];
    if (
      observation.identity.kind !== "target" ||
      !observation.identity.group ||
      !box ||
      !Number.isFinite(box.row) ||
      selectedTargetIndices.has(index)
    ) {
      return observation;
    }

    return {
      ...observation,
      identity: {
        ...observation.identity,
        kind: "unknown",
        group: null,
        decisionReason: `bottom_first_target_excluded:${observation.identity.decisionReason}`,
      },
    };
  });
}

function getUpperRowsToExclude(boxes: BuffExpiryPrecisionBox[]): Set<number> {
  const rows = [
    ...new Set(
      boxes.flatMap((box) => {
        if (!Number.isFinite(box.row)) {
          return [];
        }
        return [Math.round(box.row)];
      }),
    ),
  ].sort((left, right) => left - right);
  const excludedRowCount = Math.floor(rows.length / 2);
  return new Set(rows.slice(0, excludedRowCount));
}

function selectBottomFirstTargetIndices(
  observations: BuffExpiryPrecisionMatcherObservation[],
  boxes: BuffExpiryPrecisionBox[],
): Set<number> {
  const selected = new Set<number>();

  for (const group of BUFF_EXPIRY_TARGET_GROUPS) {
    const maxCandidates = BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_CANDIDATES[group] ?? 1;
    let remaining = maxCandidates;
    const rows = getTargetRowsForGroup(observations, boxes, group);

    for (const row of rows) {
      const rowTargetIndices = observations
        .flatMap((observation, index) => {
          const box = boxes[index];
          if (
            observation.identity.kind !== "target" ||
            observation.identity.group !== group ||
            !box ||
            !Number.isFinite(box.row) ||
            Math.round(box.row) !== row
          ) {
            return [];
          }
          return [index];
        })
        .sort((left, right) => compareTargetObservationPriority(left, right, observations, boxes));

      for (const index of rowTargetIndices.slice(0, remaining)) {
        selected.add(index);
      }
      remaining -= rowTargetIndices.length;
      if (remaining <= 0) {
        break;
      }
    }
  }

  return selected;
}

function getTargetRowsForGroup(
  observations: BuffExpiryPrecisionMatcherObservation[],
  boxes: BuffExpiryPrecisionBox[],
  group: BuffExpiryPrecisionTargetGroup,
): number[] {
  return [
    ...new Set(
      observations.flatMap((observation, index) => {
        const box = boxes[index];
        if (
          observation.identity.kind !== "target" ||
          observation.identity.group !== group ||
          !box ||
          !Number.isFinite(box.row)
        ) {
          return [];
        }
        return [Math.round(box.row)];
      }),
    ),
  ].sort((left, right) => right - left);
}

function compareTargetObservationPriority(
  leftIndex: number,
  rightIndex: number,
  observations: BuffExpiryPrecisionMatcherObservation[],
  boxes: BuffExpiryPrecisionBox[],
): number {
  const left = observations[leftIndex]!;
  const right = observations[rightIndex]!;
  const leftBox = boxes[leftIndex];
  const rightBox = boxes[rightIndex];
  return (
    (right.identity.margin ?? Number.NEGATIVE_INFINITY) -
      (left.identity.margin ?? Number.NEGATIVE_INFINITY) ||
    (right.identity.score ?? Number.NEGATIVE_INFINITY) -
      (left.identity.score ?? Number.NEGATIVE_INFINITY) ||
    (leftBox?.col ?? 0) - (rightBox?.col ?? 0)
  );
}

function selectCountdownBoxIndices(
  matcherObservations: BuffExpiryPrecisionMatcherObservation[],
): number[] {
  const indices = new Set<number>();
  for (let index = 0; index < matcherObservations.length; index += 1) {
    if (matcherObservations[index]?.identity.kind === "target") {
      indices.add(index);
    }
  }
  return [...indices].sort((left, right) => left - right);
}

export function selectBestGroupCandidateDescriptors(
  observations: BuffExpiryPrecisionMatcherObservation[],
  boxes: BuffExpiryPrecisionBox[],
): BestGroupCandidateDescriptor[] {
  const selected: BestGroupCandidateDescriptor[] = [];
  for (const group of BUFF_EXPIRY_TARGET_GROUPS) {
    selected.push(
      ...observations
        .flatMap((observation, index) => {
          const box = boxes[index];
          const candidate = observation.identity.candidates.find((item) => item.group === group);
          if (!box || !candidate) {
            return [];
          }
          const accepted = observation.identity.kind === "target" && observation.identity.group === group;
          return [
            {
              group,
              boxIndex: index,
              box,
              accepted,
              matcherAccepted: candidate.accepted,
              winningGroup: accepted ? group : null,
              score: round(candidate.score),
              margin: round(candidate.margin),
              bundleId: candidate.bundleId,
              modelVersion: candidate.modelVersion,
              gateScore: candidate.gateScore,
              gateMargin: candidate.gateMargin,
              decisionReason: getCandidateDecisionReason(observation, candidate, accepted),
            },
          ];
        })
        .sort(compareBestGroupCandidateDescriptor)
        .slice(0, BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_CANDIDATES[group]),
    );
  }
  return selected;
}

function compareBestGroupCandidateDescriptor(
  left: BestGroupCandidateDescriptor,
  right: BestGroupCandidateDescriptor,
): number {
  return (
    Number(right.accepted) - Number(left.accepted) ||
    Number(right.matcherAccepted) - Number(left.matcherAccepted) ||
    (right.gateMargin ?? Number.NEGATIVE_INFINITY) -
      (left.gateMargin ?? Number.NEGATIVE_INFINITY) ||
    right.margin - left.margin ||
    right.score - left.score ||
    left.box.row - right.box.row ||
    left.box.col - right.box.col
  );
}

function toBestGroupCandidates(
  descriptors: BestGroupCandidateDescriptor[],
  countdownObservations: Map<number, BuffExpiryPrecisionCountdownObservation>,
): BuffExpiryPrecisionBestGroupCandidate[] {
  return descriptors.map((candidate) => ({
    ...candidate,
    countdown: countdownObservations.get(candidate.boxIndex) ?? null,
  }));
}

function toMatcherObservations(
  results: BuffGroupMatcherMatchResult[],
  imageCount: number,
  sampledAt: number | undefined,
  matcherStatus: "idle" | "loading" | "ready" | "error",
): BuffExpiryPrecisionMatcherObservation[] {
  if (results.length > 0 && results.length !== imageCount) {
    throw new Error("buff-group-matcher-result-length-mismatch");
  }
  return Array.from({ length: imageCount }, (_, index) => ({
    id: `slot:${index}`,
    ...(typeof sampledAt === "number" ? { capturedAtMs: sampledAt } : {}),
    identity: results[index] ?? createUnavailableMatcherResult(matcherStatus),
  }));
}

function toPrecisionIconObservations(
  observations: BuffExpiryPrecisionMatcherObservation[],
  boxes: BuffExpiryPrecisionBox[],
  countdownObservations: Map<number, BuffExpiryPrecisionCountdownObservation>,
): BuffExpiryPrecisionIconObservation[] {
  return observations.flatMap((observation, index) => {
    const box = boxes[index];
    if (!box) {
      return [];
    }
    const identity = observation.identity;
    return [
      {
        id: observation.id,
        boxIndex: index,
        box,
        identity: {
          kind: identity.kind,
          group: identity.group,
          score: round(identity.score ?? 0),
          margin: round(identity.margin ?? 0),
          bundleId: identity.bundleId,
          modelVersion: identity.modelVersion,
          gateScore: identity.gateScore,
          gateMargin: identity.gateMargin,
          decisionReason: identity.decisionReason,
          bestTargetName: identity.group,
          bestExcludedName: null,
          candidates: identity.candidates,
        },
        countdown: countdownObservations.get(index) ?? null,
      },
    ];
  });
}

function getCandidateDecisionReason(
  observation: BuffExpiryPrecisionMatcherObservation,
  candidate: BuffGroupMatcherBundleCandidate,
  accepted: boolean,
): string {
  if (
    accepted ||
    (candidate.accepted && observation.identity.decisionReason.includes("target_excluded"))
  ) {
    return observation.identity.decisionReason;
  }
  if (observation.identity.decisionReason === "cross_bundle_conflict") {
    return "cross_bundle_conflict";
  }
  return candidate.decisionReason;
}

function createUnavailableMatcherResult(
  status: "idle" | "loading" | "ready" | "error",
): BuffExpiryPrecisionMatcherObservation["identity"] {
  return {
    kind: "unknown",
    group: null,
    bundleId: null,
    modelVersion: null,
    score: null,
    margin: null,
    gateScore: null,
    gateMargin: null,
    decisionReason: `matcher_${status}`,
    candidates: [],
    bundleDecisions: [],
    elapsedMs: 0,
  };
}

function withMatcherBundleVersions(
  statuses: Array<{ group: BuffExpiryPrecisionTargetGroup; bundleId: string; modelVersion: string }>,
): BuffExpiryPrecisionModuleVersions {
  return {
    ...BUFF_EXPIRY_PRECISION_MODULE_VERSIONS,
    matcherBundles: statuses.map(({ group, bundleId, modelVersion }) => ({
      group,
      bundleId,
      modelVersion,
    })),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function getBuffSlotSourceSize(
  request: BuffExpiryPrecisionSampleRequest,
): { width: number; height: number } | null {
  if (
    request.sourceSize &&
    Number.isFinite(request.sourceSize.width) &&
    request.sourceSize.width > 0 &&
    Number.isFinite(request.sourceSize.height) &&
    request.sourceSize.height > 0
  ) {
    return request.sourceSize;
  }
  if (
    request.imageData &&
    Number.isFinite(request.imageData.width) &&
    request.imageData.width > 0 &&
    Number.isFinite(request.imageData.height) &&
    request.imageData.height > 0
  ) {
    return {
      width: request.imageData.width,
      height: request.imageData.height,
    };
  }
  return null;
}
