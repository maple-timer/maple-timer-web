import type { SkillSnapshot, SkillTraceSample } from "../../../alertTypes";
import type { SkillIncidentSampleMediaInput } from "../../../runtime/skill-alert/evidence/skillIncidentRuntimeRecorder";
import {
  shouldCaptureSkillIncidentPrecisionMedia,
  shouldCaptureSkillIncidentQuickSlotMedia,
  type SkillIncidentRuntimeRecorder,
  type SkillIncidentSampleInput,
} from "../../../runtime/skill-alert/evidence/skillIncidentRuntimeRecorder";
import type {
  SkillIncidentFlowDecision,
  SkillIncidentMediaReason,
  SkillIncidentMode,
  SkillIncidentRuntimeFailure,
  SkillIncidentRuntimeState,
} from "../../../runtime/skill-alert/evidence/skillIncidentEvidenceTypes";
import { BUFF_SLOT_COUNTDOWN_NUMBER_MODEL_VERSION } from "../../../recognition/buff-slot/countdown-number/buffSlotCountdownNumber";
import { BOTTOM_RIGHT_REMAINING_COUNT_RECOGNIZER_VERSION } from "../../../recognition/skill-precision/remaining-count/bottomRightRemainingCountContract";
import {
  getSkillBuffDurationTargetForSkill,
  isSkillBuffDurationRemainingCountTarget,
} from "../../../lib/skillBuffDuration/skillBuffDurationTargets";
import { getSkillRegionForLayout } from "../../../lib/regions";
import { applyMasterVolume } from "../../../lib/volume";
import type { Profile, SkillConfig, SkillRuntimeState } from "../../../types";
import type {
  SkillBuffDurationFrameResult,
  SkillFrameProcessResult,
} from "./skillFrameProcessor";

export type CreateSkillIncidentRuntimeSampleInputOptions = {
  recorder: SkillIncidentRuntimeRecorder;
  profile: Pick<Profile, "id" | "skillAlertInitialJitterEnabled">;
  skill: SkillConfig;
  masterVolume: number;
  frameLayoutKey: string | null;
  precisionParserRuntimeKey: string | undefined;
  quickRecognizerId: string;
  sampledAt: number;
  monotonicAt: number | null;
  stateBefore: SkillRuntimeState;
  processed: SkillFrameProcessResult;
  rawBuffDurationFrameResult: SkillBuffDurationFrameResult | null;
};

export function createSkillIncidentRuntimeSampleInput({
  recorder,
  profile,
  skill,
  masterVolume,
  frameLayoutKey,
  precisionParserRuntimeKey,
  quickRecognizerId,
  sampledAt,
  monotonicAt,
  stateBefore,
  processed,
  rawBuffDurationFrameResult,
}: CreateSkillIncidentRuntimeSampleInputOptions): SkillIncidentSampleInput {
  const target = getSkillBuffDurationTargetForSkill(skill);
  const mode = getSkillIncidentMode(skill);
  const targetId = target ? `precision:${target.skillId}` : `quickslot:${skill.id}`;
  const stateAfter = processed.state;
  const runtimeFailure = getSkillIncidentRuntimeFailure({
    processed,
    rawBuffDurationFrameResult,
    precisionParserRuntimeKey,
  });
  const parser = getSkillIncidentParserDecision(rawBuffDurationFrameResult);
  const matcher = getSkillIncidentMatcherDecision(rawBuffDurationFrameResult);
  const value = getSkillIncidentValueDecision({ mode, processed });
  const flow = getSkillIncidentFlowDecision({ mode, processed });
  const periodicMediaDue =
    mode === "quickslot-countdown"
      ? shouldCaptureSkillIncidentQuickSlotMedia({
          recorder,
          sampledAt,
          skillId: skill.id,
        })
      : shouldCaptureSkillIncidentPrecisionMedia({ recorder, sampledAt });
  const frameReasons = getSkillIncidentFrameReasons({
    recorder,
    skillId: skill.id,
    targetId,
    periodicMediaDue,
    processed,
    runtimeFailure,
    stateBefore,
    stateAfter,
    valueDecision: value.decision,
  });
  const mediaReason = getSkillIncidentMediaReason(frameReasons);
  const configuration = getSkillIncidentConfiguration({
    frameLayoutKey,
    masterVolume,
    precisionParserRuntimeKey,
    profile,
    skill,
  });
  const dueAt = getSkillIncidentDecisionDueAt({
    processed,
    sampledAt,
    skill,
    stateBefore,
    stateAfter,
  });
  const provider = getSkillIncidentProvider(
    rawBuffDurationFrameResult,
    precisionParserRuntimeKey,
    mode,
  );

  return {
    sampledAt,
    monotonicAt,
    skillId: skill.id,
    enabled: skill.enabled,
    mode,
    targetId,
    epochIdentityKey: stableValueKey({
      profileId: profile.id,
      mode,
      targetId,
      presetId: skill.presetId ?? null,
      frameLayoutKey,
      region: getSkillRegionForLayout(skill, frameLayoutKey),
      recognizer: getSkillIncidentEpochRecognizerIdentity({
        mode,
        precisionParserRuntimeKey,
        quickRecognizerId,
        skill,
      }),
    }),
    cycleConfigurationKey: stableValueKey({
      countdownSource: skill.countdownSource,
      durationSeconds: skill.durationSeconds,
      cooldownDurationSeconds: skill.cooldownDurationSeconds ?? null,
      recognitionStartSeconds: skill.recognitionStartSeconds,
      recognitionMode: skill.recognitionMode,
    }),
    epochReason: "normal-runtime-sample",
    provider,
    recognizerVersion: getSkillIncidentRecognizerVersion({
      mode,
      processed,
      rawBuffDurationFrameResult,
      quickRecognizerId,
    }),
    source: runtimeFailure ? "runtime-error" : "runtime",
    stateBefore: toSkillIncidentRuntimeState(stateBefore, mode),
    stateAfter: toSkillIncidentRuntimeState(stateAfter, mode),
    recognitionDecision: getSkillIncidentRecognitionDecision({
      mode,
      processed,
      rawBuffDurationFrameResult,
      runtimeFailure,
    }),
    parser,
    matcher,
    value,
    flow,
    runtimeFailure,
    configuration,
    frameReasons,
    media: createSkillIncidentMedia({
      frameReasons,
      mediaReason,
      mode,
      periodicMediaDue,
      processed,
      rawBuffDurationFrameResult,
    }),
    alertDecision: processed.alertDecision
      ? {
          kind: processed.alertDecision,
          outcome: "requested",
          dueAt,
          dueMonotonicAt:
            dueAt !== null && monotonicAt !== null
              ? monotonicAt + (dueAt - sampledAt)
              : null,
          reason:
            processed.alertDecision === "initial"
              ? "runtime-initial-alert-due"
              : "runtime-repeat-alert-due",
        }
      : null,
  };
}

export function getSkillIncidentConfiguration({
  frameLayoutKey,
  masterVolume,
  precisionParserRuntimeKey,
  profile,
  skill,
}: {
  frameLayoutKey: string | null;
  masterVolume: number;
  precisionParserRuntimeKey: string | undefined;
  profile: Pick<Profile, "id" | "skillAlertInitialJitterEnabled">;
  skill: SkillConfig;
}): Record<string, unknown> {
  return {
    profileId: profile.id,
    enabled: skill.enabled,
    presetId: skill.presetId ?? null,
    detectionSource: skill.detectionSource ?? null,
    countdownSource: skill.countdownSource,
    durationSeconds: skill.durationSeconds,
    cooldownDurationSeconds: skill.cooldownDurationSeconds ?? null,
    alertThresholdSeconds: skill.alertThresholdSeconds,
    recognitionStartSeconds: skill.recognitionStartSeconds,
    recognitionMode: skill.recognitionMode,
    repeatAlertEnabled: skill.repeatAlertEnabled ?? false,
    repeatAlertIntervalSeconds: skill.repeatAlertIntervalSeconds ?? null,
    repeatAlertMaxCount: skill.repeatAlertMaxCount ?? null,
    initialAlertJitterEnabled:
      profile.skillAlertInitialJitterEnabled === true,
    frameLayoutKey,
    region: getSkillRegionForLayout(skill, frameLayoutKey),
    precisionParserRuntimeKey: precisionParserRuntimeKey ?? null,
    soundId: skill.soundId,
    volume: skill.volume,
    masterVolume,
    effectiveVolume: applyMasterVolume(skill.volume, masterVolume),
  };
}

export function getSkillIncidentMode(skill: SkillConfig): SkillIncidentMode {
  const target = getSkillBuffDurationTargetForSkill(skill);
  if (!target) {
    return "quickslot-countdown";
  }
  return isSkillBuffDurationRemainingCountTarget(target)
    ? "precision-remaining-count"
    : "precision-countdown";
}

function toSkillIncidentRuntimeState(
  state: SkillRuntimeState,
  mode: SkillIncidentMode,
): SkillIncidentRuntimeState {
  return {
    status: state.status,
    observedValue:
      mode === "precision-remaining-count"
        ? state.observedRemainingCount
        : state.observedRemainingSeconds,
    estimatedExpiresAt: state.estimatedExpiresAt,
    alertedAt: state.alertedAt,
    lastRepeatedAlertAt: state.lastRepeatedAlertAt,
    repeatedAlertCount: state.repeatedAlertCount,
    lastAlertCycleStartedAt: state.lastAlertCycleStartedAt,
    initialAlertDelaySeconds: state.initialAlertDelaySeconds,
    initialAlertDelayCycleStartedAt: state.initialAlertDelayCycleStartedAt,
    rejectedValue: state.rejectedReading,
    pendingReason: getSkillPendingReason(state),
  };
}

function getSkillPendingReason(state: SkillRuntimeState): string | null {
  if (state.pendingShortAnchor) {
    return `short-anchor:${state.pendingShortAnchor.count}`;
  }
  if (state.pendingRemainingCountIncrease) {
    return `remaining-count-increase:${state.pendingRemainingCountIncrease.count}`;
  }
  if (state.pendingRemainingCountDrop) {
    return `remaining-count-drop:${state.pendingRemainingCountDrop.count}`;
  }
  if (state.pendingRemainingCountAlert) {
    return `remaining-count-alert:${state.pendingRemainingCountAlert.count}`;
  }
  if (state.buffDurationCountdownMissingSinceAt !== null) {
    return `countdown-missing:${state.buffDurationCountdownMissingSinceAt}`;
  }
  return state.buffDurationTimingEvent
    ? `${state.buffDurationTimingEvent.type}:${state.buffDurationTimingEvent.occurredAt}`
    : null;
}

function getSkillIncidentParserDecision(
  frame: SkillBuffDurationFrameResult | null,
): SkillIncidentSampleInput["parser"] {
  if (!frame) {
    return null;
  }
  const snapshot = frame.snapshot;
  return {
    boxCount: snapshot.boxCount,
    rowCount: snapshot.parserRowCount ?? null,
    eligibleBoxCount: null,
    candidateCount: snapshot.candidateIcons?.length ?? 0,
    decisionReason:
      frame.parserFailure?.reason ??
      (snapshot.boxCount > 0 ? "parser-boxes-produced" : "parser-no-boxes"),
  };
}

function getSkillIncidentMatcherDecision(
  frame: SkillBuffDurationFrameResult | null,
): SkillIncidentSampleInput["matcher"] {
  if (!frame || frame.parserFailure) {
    return null;
  }
  const snapshot = frame.snapshot;
  const best = snapshot.candidateIcons?.[0]?.match ?? null;
  return {
    accepted: snapshot.detected,
    candidateCount: snapshot.candidateIcons?.length ?? 0,
    decisionReason:
      snapshot.decisionReason ?? best?.decisionReason ?? "matcher-no-candidate",
    bundleId: snapshot.bundleId ?? best?.bundleId ?? null,
    modelVersion: snapshot.modelVersion ?? best?.modelVersion ?? null,
    score: snapshot.score ?? best?.score ?? null,
    threshold: snapshot.threshold ?? best?.threshold ?? null,
    margin: snapshot.margin ?? best?.margin ?? null,
    gateMargin: snapshot.gateMargin ?? best?.gateMargin ?? null,
  };
}

function getSkillIncidentValueDecision({
  mode,
  processed,
}: {
  mode: SkillIncidentMode;
  processed: SkillFrameProcessResult;
}): SkillIncidentSampleInput["value"] {
  const snapshot = processed.snapshot;
  const rawValue =
    mode === "precision-remaining-count"
      ? snapshot.buffDuration?.remainingCount?.count ?? null
      : mode === "precision-countdown"
        ? snapshot.buffDuration?.countdown?.totalSeconds ?? null
        : snapshot.result.value;
  const text =
    mode === "precision-remaining-count"
      ? snapshot.buffDuration?.remainingCount?.text ?? null
      : mode === "precision-countdown"
        ? snapshot.buffDuration?.countdown?.text ?? null
        : snapshot.result.debug?.recognizedText ??
          (rawValue === null ? null : String(rawValue));
  const confidence =
    mode === "precision-remaining-count"
      ? snapshot.buffDuration?.remainingCount?.confidence ?? null
      : mode === "precision-countdown"
        ? snapshot.buffDuration?.countdown?.confidence ?? null
        : snapshot.result.confidence;
  const flowReason = processed.traceSample.remainingCountDecision ?? "";
  const rejected =
    rawValue !== null &&
    (processed.state.rejectedReading === rawValue ||
      /implausible|rejected/.test(flowReason));
  const unsupported =
    mode === "precision-countdown" &&
    snapshot.buffDuration?.countdown?.kind === "not_supported";
  return {
    kind:
      mode === "precision-remaining-count" ? "remaining-count" : "countdown",
    rawValue,
    text,
    confidence,
    decision:
      rawValue === null
        ? unsupported
          ? "rejected"
          : "missing"
        : rejected
          ? "implausible"
          : "accepted",
    reason:
      processed.traceSample.remainingCountDecision ??
      processed.traceSample.reason ??
      null,
  };
}

function getSkillIncidentFlowDecision({
  mode,
  processed,
}: {
  mode: SkillIncidentMode;
  processed: SkillFrameProcessResult;
}): SkillIncidentFlowDecision | null {
  const trace = processed.traceSample;
  if (mode === "precision-remaining-count") {
    return {
      confirmedValue: processed.state.observedRemainingCount,
      expectedMin: trace.remainingCountExpectedMin ?? null,
      expectedMax: trace.remainingCountExpectedMax ?? null,
      decisionReason: trace.remainingCountDecision ?? null,
      pendingDropObservations:
        trace.pendingRemainingCountDropObservations ?? null,
      pendingAlertObservations:
        trace.pendingRemainingCountAlertObservations ?? null,
    };
  }
  return {
    confirmedValue: processed.state.observedRemainingSeconds,
    expectedMin: null,
    expectedMax: null,
    decisionReason:
      processed.state.pendingShortAnchor
        ? `pending-anchor:${processed.state.pendingShortAnchor.count}`
        : processed.state.buffDurationTimingEvent?.type ??
          trace.reason ??
          null,
    pendingDropObservations: null,
    pendingAlertObservations: null,
  };
}

function getSkillIncidentRuntimeFailure({
  processed,
  rawBuffDurationFrameResult,
  precisionParserRuntimeKey,
}: {
  processed: SkillFrameProcessResult;
  rawBuffDurationFrameResult: SkillBuffDurationFrameResult | null;
  precisionParserRuntimeKey: string | undefined;
}): SkillIncidentRuntimeFailure | null {
  const parserFailure = rawBuffDurationFrameResult?.parserFailure ?? null;
  if (parserFailure) {
    return {
      stage: parserFailure.diagnostic?.stage ?? "parser",
      code:
        parserFailure.diagnostic?.code ?? parserFailure.reason ?? "parser-failed",
      message: parserFailure.technicalMessage,
      provider: parsePrecisionProvider(precisionParserRuntimeKey),
      recoverable: null,
    };
  }
  const failure = processed.traceSample.runtimeFailure;
  if (!failure) {
    const message = rawBuffDurationFrameResult?.snapshot.error ?? null;
    return message
      ? {
          stage: "precision-worker",
          code: "precision-worker-failed",
          message,
          provider: parsePrecisionProvider(precisionParserRuntimeKey),
          recoverable: null,
        }
      : null;
  }
  return {
    stage: failure.stage,
    code: failure.code,
    message: failure.technicalMessage,
    provider: null,
    recoverable: null,
  };
}

function getSkillIncidentRecognitionDecision({
  mode,
  processed,
  rawBuffDurationFrameResult,
  runtimeFailure,
}: {
  mode: SkillIncidentMode;
  processed: SkillFrameProcessResult;
  rawBuffDurationFrameResult: SkillBuffDurationFrameResult | null;
  runtimeFailure: SkillIncidentRuntimeFailure | null;
}): SkillIncidentSampleInput["recognitionDecision"] {
  if (runtimeFailure) {
    return "error";
  }
  if (mode === "quickslot-countdown") {
    return processed.snapshot.result.value === null ? "missing" : "accepted";
  }
  const snapshot = rawBuffDurationFrameResult?.snapshot;
  if (!snapshot || snapshot.boxCount <= 0) {
    return "missing";
  }
  return snapshot.detected ? "accepted" : "rejected";
}

function getSkillIncidentFrameReasons({
  recorder,
  skillId,
  targetId,
  periodicMediaDue,
  processed,
  runtimeFailure,
  stateBefore,
  stateAfter,
  valueDecision,
}: {
  recorder: SkillIncidentRuntimeRecorder;
  skillId: string;
  targetId: string;
  periodicMediaDue: boolean;
  processed: SkillFrameProcessResult;
  runtimeFailure: SkillIncidentRuntimeFailure | null;
  stateBefore: SkillRuntimeState;
  stateAfter: SkillRuntimeState;
  valueDecision: SkillIncidentSampleInput["value"]["decision"];
}): string[] {
  const reasons: string[] = [];
  if (periodicMediaDue) reasons.push("periodic");
  if (processed.alertDecision) reasons.push("alert-decision");
  if (runtimeFailure) reasons.push("runtime-error");
  if (stateBefore.status !== stateAfter.status) reasons.push("status-change");
  if (
    stateBefore.lastAlertCycleStartedAt !== stateAfter.lastAlertCycleStartedAt
  ) {
    reasons.push("anchor");
  }
  if (stateBefore.rejectedReading !== stateAfter.rejectedReading) {
    reasons.push("value-rejected");
  }
  if (valueDecision === "rejected" || valueDecision === "implausible") {
    reasons.push("value-rejected");
  }
  if (isNearSkillAlertThreshold(processed.traceSample)) {
    reasons.push("threshold");
  }
  const latestObservation = [...recorder.archive.observations]
    .reverse()
    .find(
      (entry) =>
        entry.skillIds.includes(skillId) && entry.targetId === targetId,
    );
  const rawValue = getSkillIncidentRawValue(processed.snapshot, processed.traceSample);
  if (latestObservation && latestObservation.value.rawValue !== rawValue) {
    reasons.push("value-change");
  }
  return reasons.length > 0 ? unique(reasons) : ["sample"];
}

function isNearSkillAlertThreshold(trace: SkillTraceSample): boolean {
  return Boolean(
    trace.shouldFireAlert ||
      trace.shouldRepeatAlert ||
      (trace.alertInSeconds !== null && trace.alertInSeconds <= 1) ||
      (trace.alertInCount !== undefined &&
        trace.alertInCount !== null &&
        trace.alertInCount <= 1),
  );
}

function getSkillIncidentRawValue(
  snapshot: SkillSnapshot,
  trace: SkillTraceSample,
): number | null {
  return (
    snapshot.buffDuration?.remainingCount?.count ??
    snapshot.buffDuration?.countdown?.totalSeconds ??
    trace.ocrValue ??
    null
  );
}

function getSkillIncidentMediaReason(
  frameReasons: string[],
): SkillIncidentMediaReason | null {
  if (frameReasons.includes("runtime-error")) return "runtime-error";
  if (frameReasons.includes("alert-decision")) return "alert-decision";
  if (frameReasons.includes("value-rejected")) return "value-rejected";
  if (frameReasons.includes("threshold")) return "threshold";
  if (frameReasons.includes("anchor")) return "anchor";
  if (frameReasons.includes("status-change")) return "status-change";
  if (frameReasons.includes("value-change")) return "value-change";
  if (frameReasons.includes("periodic")) return "periodic";
  return null;
}

function createSkillIncidentMedia({
  frameReasons,
  mediaReason,
  mode,
  periodicMediaDue,
  processed,
  rawBuffDurationFrameResult,
}: {
  frameReasons: string[];
  mediaReason: SkillIncidentMediaReason | null;
  mode: SkillIncidentMode;
  periodicMediaDue: boolean;
  processed: SkillFrameProcessResult;
  rawBuffDurationFrameResult: SkillBuffDurationFrameResult | null;
}): SkillIncidentSampleMediaInput[] | undefined {
  const eventMediaNeeded = frameReasons.some((reason) =>
    [
      "runtime-error",
      "alert-decision",
      "value-rejected",
      "threshold",
      "anchor",
      "status-change",
    ].includes(reason),
  );
  const reason = mediaReason ?? "current";
  const media: SkillIncidentSampleMediaInput[] = [];
  if (mode === "quickslot-countdown") {
    if (!periodicMediaDue && !eventMediaNeeded) {
      return undefined;
    }
    if (processed.snapshot.rawPreviewUrl) {
      media.push({
        reason,
        variant: "quickslot-raw",
        mimeType: getDataUrlMimeType(processed.snapshot.rawPreviewUrl),
        dataUrl: processed.snapshot.rawPreviewUrl,
      });
    }
    if (processed.snapshot.previewUrl) {
      media.push({
        reason,
        variant: "quickslot-processed",
        mimeType: getDataUrlMimeType(processed.snapshot.previewUrl),
        dataUrl: processed.snapshot.previewUrl,
      });
    }
    return media.length > 0 ? media : undefined;
  }

  const source = rawBuffDurationFrameResult?.evidenceSource?.dataUrl ?? null;
  if (source) {
    media.push({
      reason,
      variant: "precision-source",
      mimeType: getDataUrlMimeType(source),
      dataUrl: source,
    });
  }
  if (periodicMediaDue || eventMediaNeeded) {
    const candidates = getBoundedPrecisionCandidateMedia(processed.snapshot);
    media.push(
      ...candidates.map((dataUrl) => ({
        reason,
        variant: "precision-candidate" as const,
        mimeType: getDataUrlMimeType(dataUrl),
        dataUrl,
      })),
    );
  }
  return media.length > 0 ? media : undefined;
}

function getBoundedPrecisionCandidateMedia(snapshot: SkillSnapshot): string[] {
  const candidates = snapshot.buffDuration?.candidateIcons ?? [];
  return [...candidates]
    .sort(
      (left, right) =>
        Number(right.match.matched) - Number(left.match.matched) ||
        right.match.score - left.match.score,
    )
    .map((entry) => entry.imageDataUrl)
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 2);
}

function getSkillIncidentDecisionDueAt({
  processed,
  sampledAt,
  skill,
  stateBefore,
  stateAfter,
}: {
  processed: SkillFrameProcessResult;
  sampledAt: number;
  skill: SkillConfig;
  stateBefore: SkillRuntimeState;
  stateAfter: SkillRuntimeState;
}): number | null {
  if (!processed.alertDecision) {
    return null;
  }
  if (processed.alertDecision === "repeat") {
    return stateBefore.lastRepeatedAlertAt === null
      ? sampledAt
      : stateBefore.lastRepeatedAlertAt +
          (skill.repeatAlertIntervalSeconds ?? 0) * 1_000;
  }
  if (stateAfter.observedRemainingCount !== null) {
    return sampledAt;
  }
  if (stateAfter.estimatedExpiresAt === null) {
    return sampledAt;
  }
  return (
    stateAfter.estimatedExpiresAt -
    skill.alertThresholdSeconds * 1_000 +
    (stateAfter.initialAlertDelaySeconds ?? 0) * 1_000
  );
}

function getSkillIncidentProvider(
  frame: SkillBuffDurationFrameResult | null,
  precisionParserRuntimeKey: string | undefined,
  mode: SkillIncidentMode,
): string | null {
  if (mode === "quickslot-countdown") {
    return "main-thread";
  }
  return (
    frame?.parserRuntime?.executionProvider ??
    parsePrecisionProvider(precisionParserRuntimeKey)
  );
}

function parsePrecisionProvider(value: string | undefined): string | null {
  const provider = value?.split(":")[0] ?? null;
  return provider === "webgpu" || provider === "wasm" || provider === "remote"
    ? provider
    : null;
}

function getSkillIncidentEpochRecognizerIdentity({
  mode,
  precisionParserRuntimeKey,
  quickRecognizerId,
  skill,
}: {
  mode: SkillIncidentMode;
  precisionParserRuntimeKey: string | undefined;
  quickRecognizerId: string;
  skill: SkillConfig;
}) {
  if (mode === "quickslot-countdown") {
    return { quickRecognizerId };
  }
  const target = getSkillBuffDurationTargetForSkill(skill);
  return {
    precisionParserRuntimeKey: precisionParserRuntimeKey ?? null,
    detectorId: target?.detectorId ?? null,
    matcherEngine: target?.matcherEngine ?? null,
    matcherSkillId: target?.matcherSkillId ?? null,
    valueKind: target?.valueKind ?? "countdown",
    valueReaderVersion:
      mode === "precision-remaining-count"
        ? BOTTOM_RIGHT_REMAINING_COUNT_RECOGNIZER_VERSION
        : BUFF_SLOT_COUNTDOWN_NUMBER_MODEL_VERSION,
  };
}

function getSkillIncidentRecognizerVersion({
  mode,
  processed,
  rawBuffDurationFrameResult,
  quickRecognizerId,
}: {
  mode: SkillIncidentMode;
  processed: SkillFrameProcessResult;
  rawBuffDurationFrameResult: SkillBuffDurationFrameResult | null;
  quickRecognizerId: string;
}): string {
  if (mode === "quickslot-countdown") {
    return quickRecognizerId;
  }
  const snapshot = processed.snapshot.buffDuration;
  const valueVersion =
    mode === "precision-remaining-count"
      ? BOTTOM_RIGHT_REMAINING_COUNT_RECOGNIZER_VERSION
      : BUFF_SLOT_COUNTDOWN_NUMBER_MODEL_VERSION;
  return [
    rawBuffDurationFrameResult?.parserRuntime?.parserVersion ??
      snapshot?.parserVersion ??
      "parser-unknown",
    snapshot?.bundleId ?? "matcher-bundle-unknown",
    snapshot?.modelVersion ?? "matcher-model-unknown",
    valueVersion,
  ].join("+");
}

function getDataUrlMimeType(dataUrl: string): "image/png" | "image/jpeg" {
  return dataUrl.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
}

function stableValueKey(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableValueKey).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableValueKey(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
