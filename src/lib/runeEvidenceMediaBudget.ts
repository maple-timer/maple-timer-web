import type {
  RuneAlertTriggerEvidence,
  RuneAlertTriggerFrame,
  RuneRuntimeIncidentEvidence,
  RuneRuntimeIncidentFrame,
} from "../alertTypes";

export const RUNE_EVIDENCE_MEDIA_MAX_FRAMES = 6;
export const RUNE_EVIDENCE_MEDIA_MAX_FRAME_CHARS = 512_000;
export const RUNE_EVIDENCE_MEDIA_MAX_TOTAL_CHARS = 1_500_000;

export type RuneEvidenceMediaBudgetResult = {
  runtimeIncident: RuneRuntimeIncidentEvidence | null;
  runtimeIncidents: RuneRuntimeIncidentEvidence[];
  pendingAlertTriggerFrames: RuneAlertTriggerFrame[];
  lastAlertTrigger: RuneAlertTriggerEvidence | null;
  alertTriggers: RuneAlertTriggerEvidence[];
  budget: {
    policy: "rune-shared-media-v1";
    retainedFrameIds: string[];
    retainedChars: number;
    omittedOversized: number;
    omittedCapacity: number;
  };
};

type FrameCandidate = {
  frameId: string;
  sampledAt: number;
  rawDataUrl: string;
  priority: number;
};

export function enforceRuneEvidenceMediaBudget({
  runtimeIncident,
  runtimeIncidents,
  pendingAlertTriggerFrames,
  lastAlertTrigger,
  alertTriggers,
}: {
  runtimeIncident: RuneRuntimeIncidentEvidence | null;
  runtimeIncidents?: RuneRuntimeIncidentEvidence[];
  pendingAlertTriggerFrames: RuneAlertTriggerFrame[];
  lastAlertTrigger: RuneAlertTriggerEvidence | null;
  alertTriggers?: RuneAlertTriggerEvidence[];
}): RuneEvidenceMediaBudgetResult {
  const incidentList = mergeEvidenceByKey(
    [...(runtimeIncidents ?? []), runtimeIncident].filter(
      (entry): entry is RuneRuntimeIncidentEvidence => Boolean(entry),
    ),
    (entry) => entry.id,
  );
  const triggerList = mergeEvidenceByKey(
    [...(alertTriggers ?? []), lastAlertTrigger].filter(
      (entry): entry is RuneAlertTriggerEvidence => Boolean(entry),
    ),
    (entry) => entry.cycleId,
  );
  const candidates = new Map<string, FrameCandidate>();
  const oversizedFrameIds = new Set<string>();

  const register = (candidate: FrameCandidate) => {
    if (!candidate.rawDataUrl) {
      return;
    }
    if (candidate.rawDataUrl.length > RUNE_EVIDENCE_MEDIA_MAX_FRAME_CHARS) {
      oversizedFrameIds.add(candidate.frameId);
      return;
    }
    const existing = candidates.get(candidate.frameId);
    if (
      !existing ||
      candidate.priority > existing.priority ||
      (candidate.priority === existing.priority && candidate.sampledAt > existing.sampledAt)
    ) {
      candidates.set(candidate.frameId, candidate);
    }
  };

  incidentList.forEach((incident) =>
    incident.frames.forEach((frame) =>
      register(toCandidate(frame, getRuntimeFramePriority(frame))),
    ),
  );
  pendingAlertTriggerFrames.forEach((frame) =>
    register(toCandidate(frame, 110)),
  );
  triggerList.forEach((trigger) =>
    trigger.frames.forEach((frame) => register(toCandidate(frame, 100))),
  );
  lastAlertTrigger?.frames.forEach((frame) =>
    register(toCandidate(frame, 120)),
  );

  const retained = [...candidates.values()]
    .sort(
      (left, right) =>
        right.priority - left.priority || right.sampledAt - left.sampledAt,
    )
    .reduce<FrameCandidate[]>((selected, candidate) => {
      if (selected.length >= RUNE_EVIDENCE_MEDIA_MAX_FRAMES) {
        return selected;
      }
      const retainedChars = selected.reduce(
        (total, entry) => total + entry.rawDataUrl.length,
        0,
      );
      if (
        retainedChars + candidate.rawDataUrl.length >
        RUNE_EVIDENCE_MEDIA_MAX_TOTAL_CHARS
      ) {
        return selected;
      }
      selected.push(candidate);
      return selected;
    }, []);
  const retainedIds = new Set(retained.map((candidate) => candidate.frameId));
  const keepFrameMedia = <T extends { sampledAt: number; rawDataUrl: string }>(
    frame: T,
  ): T =>
    retainedIds.has(createRuneEvidenceFrameId(frame.sampledAt)) || !frame.rawDataUrl
      ? frame
      : { ...frame, rawDataUrl: "" };
  const boundedIncidents = incidentList.map((incident) => {
    const frames = stripUnretainedFrameMedia(incident.frames, keepFrameMedia);
    return frames === incident.frames ? incident : { ...incident, frames };
  });
  const pendingFrames = stripUnretainedFrameMedia(
    pendingAlertTriggerFrames,
    keepFrameMedia,
  );
  const boundedTriggers = triggerList.map((trigger) => {
    const frames = stripUnretainedFrameMedia(trigger.frames, keepFrameMedia);
    return frames === trigger.frames ? trigger : { ...trigger, frames };
  });

  return {
    runtimeIncident: runtimeIncident
      ? boundedIncidents.find((entry) => entry.id === runtimeIncident.id) ?? null
      : null,
    runtimeIncidents: boundedIncidents,
    pendingAlertTriggerFrames: pendingFrames,
    lastAlertTrigger: lastAlertTrigger
      ? boundedTriggers.find((entry) => entry.cycleId === lastAlertTrigger.cycleId) ?? null
      : null,
    alertTriggers: boundedTriggers,
    budget: {
      policy: "rune-shared-media-v1",
      retainedFrameIds: retained
        .sort((left, right) => left.sampledAt - right.sampledAt)
        .map((candidate) => candidate.frameId),
      retainedChars: retained.reduce(
        (total, candidate) => total + candidate.rawDataUrl.length,
        0,
      ),
      omittedOversized: oversizedFrameIds.size,
      omittedCapacity: Math.max(0, candidates.size - retained.length),
    },
  };
}

function mergeEvidenceByKey<T>(items: T[], getKey: (item: T) => string) {
  const merged = new Map<string, T>();
  items.forEach((item) => merged.set(getKey(item), item));
  return [...merged.values()];
}

function stripUnretainedFrameMedia<T extends { sampledAt: number; rawDataUrl: string }>(
  frames: T[],
  strip: (frame: T) => T,
): T[] {
  let changed = false;
  const bounded = frames.map((frame) => {
    const next = strip(frame);
    changed ||= next !== frame;
    return next;
  });
  return changed ? bounded : frames;
}

export function createRuneEvidenceFrameId(sampledAt: number) {
  return `frame:${Math.round(sampledAt)}`;
}

function toCandidate(
  frame: RuneRuntimeIncidentFrame | RuneAlertTriggerFrame,
  priority: number,
): FrameCandidate {
  return {
    frameId: createRuneEvidenceFrameId(frame.sampledAt),
    sampledAt: frame.sampledAt,
    rawDataUrl: frame.rawDataUrl,
    priority,
  };
}

function getRuntimeFramePriority(frame: RuneRuntimeIncidentFrame) {
  if (frame.shouldAlert) {
    return 95;
  }
  if (frame.outcome === "detected") {
    return 90;
  }
  if (frame.outcome === "error") {
    return 85;
  }
  if (frame.outcome === "near-threshold") {
    return 70;
  }
  return frame.phase === "before" ? 30 : 20;
}
