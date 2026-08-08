import type { SpecialCoreAlertConfig } from "../../types";
import { getSpecialCoreAlertDueAt, normalizeSpecialCoreAlertTiming } from "./specialCoreAlertConfig";
import type {
  SpecialCoreDetectedIcon,
  SpecialCoreDetectionObservation,
  SpecialCoreRuntimeState,
  SpecialCoreSampleResponse,
} from "./specialCoreAlertTypes";

export const SPECIAL_CORE_CONFIRM_WINDOW_MS = 3_000;
export const SPECIAL_CORE_REQUIRED_CONFIRMATIONS = 2;
export const SPECIAL_CORE_EPISODE_ABSENT_MS = 5_000;
export const SPECIAL_CORE_REACQUIRE_EARLY_MS = 4_000;
export const SPECIAL_CORE_REACQUIRE_MIN_ACTIVATION_AGE_MS = 10_000;

export function createSpecialCoreRuntimeState(
  partial: Partial<SpecialCoreRuntimeState> = {},
): SpecialCoreRuntimeState {
  return {
    status: "idle",
    lastSampledAt: null,
    unsupportedReason: null,
    boxCount: 0,
    detectedCount: 0,
    pendingDetections: [],
    pendingDetectionIcons: [],
    activationId: 0,
    activationStartedAt: null,
    activationConfirmedAt: null,
    activationLastSeenAt: null,
    cooldownEndsAt: null,
    alertDueAt: null,
    alertedAt: null,
    lastAlertedAt: null,
    lastAlertPlayback: null,
    lastDetectedIcon: null,
    activationEvidence: null,
    ...partial,
  };
}

export function updateSpecialCoreRuntimeFromSample({
  previous,
  sample,
  config,
  now,
}: {
  previous: SpecialCoreRuntimeState;
  sample: SpecialCoreSampleResponse;
  config: Pick<SpecialCoreAlertConfig, "cooldownSeconds" | "alertLeadSeconds">;
  now: number;
}): SpecialCoreRuntimeState {
  const timing = normalizeSpecialCoreAlertTiming(config);
  const base: SpecialCoreRuntimeState = {
    ...previous,
    lastSampledAt: sample.sampledAt ?? now,
    unsupportedReason: null,
    boxCount: sample.boxCount,
    detectedCount: sample.detectedCount,
  };

  if (sample.detectedIcon) {
    return updateSpecialCoreRuntimeWithDetection({
      previous: base,
      detectedIcon: sample.detectedIcon,
      cooldownSeconds: timing.cooldownSeconds,
      alertLeadSeconds: timing.alertLeadSeconds,
      now,
    });
  }

  return updateSpecialCoreRuntimeWithoutDetection(base, now);
}

export function markSpecialCoreAlerted(
  state: SpecialCoreRuntimeState,
  alertedAt: number,
): SpecialCoreRuntimeState {
  if (!state.alertDueAt || state.alertedAt !== null || alertedAt < state.alertDueAt) {
    return state;
  }

  return {
    ...state,
    status: "alerted",
    alertedAt,
    lastAlertedAt: alertedAt,
  };
}

export function retimeSpecialCoreRuntimeState({
  state,
  config,
}: {
  state: SpecialCoreRuntimeState;
  config: Pick<SpecialCoreAlertConfig, "cooldownSeconds" | "alertLeadSeconds">;
}): SpecialCoreRuntimeState {
  if (state.activationStartedAt === null || state.cooldownEndsAt === null) {
    return state;
  }

  const timing = normalizeSpecialCoreAlertTiming(config);
  const cooldownEndsAt = state.activationStartedAt + timing.cooldownSeconds * 1000;
  const alertDueAt = getSpecialCoreAlertDueAt({
    activationStartedAt: state.activationStartedAt,
    cooldownSeconds: timing.cooldownSeconds,
    alertLeadSeconds: timing.alertLeadSeconds,
  });

  return {
    ...state,
    status: state.alertedAt !== null ? "alerted" : state.status,
    cooldownEndsAt,
    alertDueAt,
  };
}

export function isSpecialCoreAlertDue(
  state: Pick<SpecialCoreRuntimeState, "alertDueAt" | "alertedAt">,
  now: number,
): boolean {
  return state.alertDueAt !== null && state.alertedAt === null && now >= state.alertDueAt;
}

export function getSpecialCoreSecondsUntilAlert(
  state: Pick<SpecialCoreRuntimeState, "alertDueAt" | "alertedAt">,
  now: number,
): number | null {
  if (state.alertDueAt === null || state.alertedAt !== null) {
    return null;
  }
  return Math.max(0, Math.ceil((state.alertDueAt - now) / 1000));
}

function updateSpecialCoreRuntimeWithDetection({
  previous,
  detectedIcon,
  cooldownSeconds,
  alertLeadSeconds,
  now,
}: {
  previous: SpecialCoreRuntimeState;
  detectedIcon: SpecialCoreDetectedIcon;
  cooldownSeconds: number;
  alertLeadSeconds: number;
  now: number;
}): SpecialCoreRuntimeState {
  const observation = toObservation(detectedIcon, now);
  if (isCooldownLocked(previous, now)) {
    if (canCollectLockedReactivationCandidate(previous, now)) {
      const { pendingDetections, pendingDetectionIcons } = getNextPendingDetectionEvidence(
        previous,
        observation,
        detectedIcon,
      );
      if (pendingDetections.length >= SPECIAL_CORE_REQUIRED_CONFIRMATIONS) {
        return confirmSpecialCoreActivation({
          previous,
          pendingDetections,
          pendingDetectionIcons,
          detectedIcon,
          cooldownSeconds,
          alertLeadSeconds,
          now,
        });
      }

      return {
        ...previous,
        status: previous.alertedAt ? "alerted" : "cooldown",
        pendingDetections,
        pendingDetectionIcons,
        lastDetectedIcon: detectedIcon,
      };
    }

    return {
      ...previous,
      status: previous.alertedAt ? "alerted" : "cooldown",
      pendingDetections: [],
      pendingDetectionIcons: [],
      activationLastSeenAt: shouldTreatAsSameLockedEpisode(previous, now)
        ? now
        : previous.activationLastSeenAt,
      lastDetectedIcon: detectedIcon,
    };
  }

  if (isSameConfirmedEpisode(previous, now)) {
    return {
      ...previous,
      status: previous.alertedAt ? "alerted" : "cooldown",
      activationLastSeenAt: now,
      pendingDetections: [],
      pendingDetectionIcons: [],
      lastDetectedIcon: detectedIcon,
    };
  }

  const { pendingDetections, pendingDetectionIcons } = getNextPendingDetectionEvidence(
    previous,
    observation,
    detectedIcon,
  );
  if (pendingDetections.length < SPECIAL_CORE_REQUIRED_CONFIRMATIONS) {
    return {
      ...previous,
      status: "confirming",
      pendingDetections,
      pendingDetectionIcons,
      activationLastSeenAt: now,
      lastDetectedIcon: detectedIcon,
    };
  }

  return confirmSpecialCoreActivation({
    previous,
    pendingDetections,
    pendingDetectionIcons,
    detectedIcon,
    cooldownSeconds,
    alertLeadSeconds,
    now,
  });
}

function confirmSpecialCoreActivation({
  previous,
  pendingDetections,
  pendingDetectionIcons,
  detectedIcon,
  cooldownSeconds,
  alertLeadSeconds,
  now,
}: {
  previous: SpecialCoreRuntimeState;
  pendingDetections: SpecialCoreDetectionObservation[];
  pendingDetectionIcons: SpecialCoreDetectedIcon[];
  detectedIcon: SpecialCoreDetectedIcon;
  cooldownSeconds: number;
  alertLeadSeconds: number;
  now: number;
}): SpecialCoreRuntimeState {
  const activationStartedAt = pendingDetections[0]?.observedAt ?? now;
  const activationId = previous.activationId + 1;
  const cooldownEndsAt = activationStartedAt + cooldownSeconds * 1000;
  const alertDueAt = getSpecialCoreAlertDueAt({
    activationStartedAt,
    cooldownSeconds,
    alertLeadSeconds,
  });

  return {
    ...previous,
    status: "cooldown",
    pendingDetections: [],
    pendingDetectionIcons: [],
    activationId,
    activationStartedAt,
    activationConfirmedAt: now,
    activationLastSeenAt: now,
    cooldownEndsAt,
    alertDueAt,
    alertedAt: null,
    lastAlertPlayback: null,
    lastDetectedIcon: detectedIcon,
    activationEvidence: {
      activationId,
      activationStartedAt,
      activationConfirmedAt: now,
      confirmationIcons: pendingDetectionIcons.slice(-SPECIAL_CORE_REQUIRED_CONFIRMATIONS),
    },
  };
}

function updateSpecialCoreRuntimeWithoutDetection(
  previous: SpecialCoreRuntimeState,
  now: number,
): SpecialCoreRuntimeState {
  const { pendingDetections, pendingDetectionIcons } = getRecentPendingDetectionEvidence(previous, now);

  if (previous.alertDueAt !== null) {
    return {
      ...previous,
      status: previous.alertedAt ? "alerted" : "cooldown",
      pendingDetections,
      pendingDetectionIcons,
    };
  }

  return {
    ...previous,
    status: pendingDetections.length > 0 ? "confirming" : "waiting",
    pendingDetections,
    pendingDetectionIcons,
  };
}

function getNextPendingDetectionEvidence(
  previous: SpecialCoreRuntimeState,
  observation: SpecialCoreDetectionObservation,
  detectedIcon: SpecialCoreDetectedIcon,
): Pick<SpecialCoreRuntimeState, "pendingDetections" | "pendingDetectionIcons"> {
  const recent = previous.pendingDetections
    .map((item, index) => ({
      observation: item,
      icon: previous.pendingDetectionIcons[index],
    }))
    .filter(
      (item): item is { observation: SpecialCoreDetectionObservation; icon: SpecialCoreDetectedIcon } =>
        Boolean(item.icon) &&
        observation.observedAt - item.observation.observedAt <= SPECIAL_CORE_CONFIRM_WINDOW_MS,
    );
  const next = [...recent, { observation, icon: detectedIcon }].slice(-SPECIAL_CORE_REQUIRED_CONFIRMATIONS);
  return {
    pendingDetections: next.map((item) => item.observation),
    pendingDetectionIcons: next.map((item) => item.icon),
  };
}

function getRecentPendingDetectionEvidence(
  previous: SpecialCoreRuntimeState,
  now: number,
): Pick<SpecialCoreRuntimeState, "pendingDetections" | "pendingDetectionIcons"> {
  const lastObservedAt = previous.pendingDetections[previous.pendingDetections.length - 1]?.observedAt ?? 0;
  if (
    previous.pendingDetections.length <= 0 ||
    now - lastObservedAt > SPECIAL_CORE_CONFIRM_WINDOW_MS
  ) {
    return {
      pendingDetections: [],
      pendingDetectionIcons: [],
    };
  }

  return {
    pendingDetections: previous.pendingDetections,
    pendingDetectionIcons: previous.pendingDetectionIcons.slice(0, previous.pendingDetections.length),
  };
}

function isSameConfirmedEpisode(previous: SpecialCoreRuntimeState, now: number): boolean {
  if (previous.pendingDetections.length > 0) {
    return false;
  }
  if (previous.activationStartedAt === null || previous.activationLastSeenAt === null) {
    return false;
  }
  return now - previous.activationLastSeenAt <= SPECIAL_CORE_EPISODE_ABSENT_MS;
}

function isCooldownLocked(previous: SpecialCoreRuntimeState, now: number): boolean {
  return previous.cooldownEndsAt !== null && now < previous.cooldownEndsAt;
}

function canCollectLockedReactivationCandidate(
  previous: SpecialCoreRuntimeState,
  now: number,
): boolean {
  if (previous.activationStartedAt === null || previous.cooldownEndsAt === null) {
    return false;
  }
  if (now < previous.cooldownEndsAt - SPECIAL_CORE_REACQUIRE_EARLY_MS) {
    return false;
  }
  if (now - previous.activationStartedAt < SPECIAL_CORE_REACQUIRE_MIN_ACTIVATION_AGE_MS) {
    return false;
  }
  if (
    previous.activationLastSeenAt !== null &&
    now - previous.activationLastSeenAt <= SPECIAL_CORE_EPISODE_ABSENT_MS
  ) {
    return false;
  }
  return true;
}

function shouldTreatAsSameLockedEpisode(
  previous: SpecialCoreRuntimeState,
  now: number,
): boolean {
  if (previous.activationStartedAt === null) {
    return false;
  }
  if (now - previous.activationStartedAt <= SPECIAL_CORE_REACQUIRE_MIN_ACTIVATION_AGE_MS) {
    return true;
  }
  return (
    previous.activationLastSeenAt !== null &&
    now - previous.activationLastSeenAt <= SPECIAL_CORE_EPISODE_ABSENT_MS
  );
}

function toObservation(
  detectedIcon: SpecialCoreDetectedIcon,
  observedAt: number,
): SpecialCoreDetectionObservation {
  return {
    observedAt,
    boxIndex: detectedIcon.boxIndex,
    box: detectedIcon.box,
    score: detectedIcon.match.score,
    margin: detectedIcon.match.margin,
  };
}
