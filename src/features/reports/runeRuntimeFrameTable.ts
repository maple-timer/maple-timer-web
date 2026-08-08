import type {
  RuneAlertTriggerEvidence,
  RuneAlertTriggerFrame,
  RuneRuntimeIncidentEvidence,
  RuneRuntimeIncidentFrame,
} from "../../alertTypes";
import { getRuneDetectionEpisodeId } from "../../lib/runeEpisodeIdentity";
import { createRuneEvidenceFrameId } from "../../lib/runeEvidenceMediaBudget";

export type RuneReportRuntimeFrameRole =
  | "runtime-before"
  | "runtime-signal"
  | "runtime-after"
  | "alert-trigger";

export type RuneReportRuntimeFrame = {
  frameId: string;
  sampledAt: number;
  rawDataUrl: string;
  roles: RuneReportRuntimeFrameRole[];
  episodeIds: string[];
  cycleIds: string[];
  mediaSource: "runtime-incident" | "alert-trigger";
  mediaConflict: boolean;
};

export type RuneReportRuntimeIncident = Omit<
  RuneRuntimeIncidentEvidence,
  "frames"
> & {
  frames: Array<
    Omit<RuneRuntimeIncidentFrame, "rawDataUrl"> & { frameId: string }
  >;
};

export type RuneReportAlertTrigger = Omit<RuneAlertTriggerEvidence, "frames"> & {
  frames: Array<Omit<RuneAlertTriggerFrame, "rawDataUrl"> & { frameId: string }>;
};

export type RuneReportRuntimeFrameTable = {
  runtimeFrames: RuneReportRuntimeFrame[];
  runtimeIncidents: RuneReportRuntimeIncident[];
  runtimeIncident: RuneReportRuntimeIncident | null;
  alertTriggers: RuneReportAlertTrigger[];
  alertTrigger: RuneReportAlertTrigger | null;
};

type MutableRuntimeFrame = RuneReportRuntimeFrame & {
  roleSet: Set<RuneReportRuntimeFrameRole>;
  episodeIdSet: Set<string>;
  cycleIdSet: Set<string>;
};

export function buildRuneReportRuntimeFrameTable({
  runtimeIncident,
  runtimeIncidents,
  alertTrigger,
  alertTriggers,
}: {
  runtimeIncident: RuneRuntimeIncidentEvidence | null;
  runtimeIncidents?: RuneRuntimeIncidentEvidence[];
  alertTrigger: RuneAlertTriggerEvidence | null;
  alertTriggers?: RuneAlertTriggerEvidence[];
}): RuneReportRuntimeFrameTable {
  const incidentList = mergeEvidenceByKey(
    [...(runtimeIncidents ?? []), runtimeIncident].filter(
      (entry): entry is RuneRuntimeIncidentEvidence => Boolean(entry),
    ),
    (entry) => entry.id,
  );
  const triggerList = mergeEvidenceByKey(
    [...(alertTriggers ?? []), alertTrigger].filter(
      (entry): entry is RuneAlertTriggerEvidence => Boolean(entry),
    ),
    (entry) => entry.cycleId,
  );
  const frameTable = new Map<string, MutableRuntimeFrame>();

  incidentList.forEach((incident) => {
    incident.frames.forEach((frame) => {
      registerFrame(frameTable, {
        frame,
        role: `runtime-${frame.phase}`,
        cycleId: null,
        mediaSource: "runtime-incident",
      });
    });
  });
  triggerList.forEach((trigger) => {
    trigger.frames.forEach((frame) => {
      registerFrame(frameTable, {
        frame,
        role: "alert-trigger",
        cycleId: trigger.cycleId,
        mediaSource: "alert-trigger",
      });
    });
  });

  const reportRuntimeIncidents = incidentList.map((incident) => ({
    ...incident,
    frames: incident.frames.map(stripRuntimeFrameMedia),
  }));
  const reportAlertTriggers = triggerList.map((trigger) => ({
    ...trigger,
    frames: trigger.frames.map(stripTriggerFrameMedia),
  }));

  return {
    runtimeFrames: [...frameTable.values()]
      .sort((left, right) => left.sampledAt - right.sampledAt)
      .map(({ roleSet, episodeIdSet, cycleIdSet, ...frame }) => ({
        ...frame,
        roles: [...roleSet].sort(),
        episodeIds: [...episodeIdSet].sort(),
        cycleIds: [...cycleIdSet].sort(),
      })),
    runtimeIncidents: reportRuntimeIncidents,
    runtimeIncident: runtimeIncident
      ? reportRuntimeIncidents.find((entry) => entry.id === runtimeIncident.id) ?? null
      : reportRuntimeIncidents[reportRuntimeIncidents.length - 1] ?? null,
    alertTriggers: reportAlertTriggers,
    alertTrigger: alertTrigger
      ? reportAlertTriggers.find((entry) => entry.cycleId === alertTrigger.cycleId) ?? null
      : reportAlertTriggers[reportAlertTriggers.length - 1] ?? null,
  };
}

function mergeEvidenceByKey<T>(items: T[], getKey: (item: T) => string) {
  const merged = new Map<string, T>();
  items.forEach((item) => merged.set(getKey(item), item));
  return [...merged.values()];
}

function registerFrame(
  frameTable: Map<string, MutableRuntimeFrame>,
  {
    frame,
    role,
    cycleId,
    mediaSource,
  }: {
    frame: RuneRuntimeIncidentFrame | RuneAlertTriggerFrame;
    role: RuneReportRuntimeFrameRole;
    cycleId: string | null;
    mediaSource: RuneReportRuntimeFrame["mediaSource"];
  },
) {
  if (!frame.rawDataUrl) {
    return;
  }
  const frameId = createRuneEvidenceFrameId(frame.sampledAt);
  const episodeId = getRuneDetectionEpisodeId(frame);
  const existing = frameTable.get(frameId);
  if (existing) {
    existing.roleSet.add(role);
    if (episodeId) existing.episodeIdSet.add(episodeId);
    if (cycleId) existing.cycleIdSet.add(cycleId);
    if (existing.rawDataUrl !== frame.rawDataUrl) {
      existing.mediaConflict = true;
      if (mediaSource === "alert-trigger") {
        existing.rawDataUrl = frame.rawDataUrl;
        existing.mediaSource = mediaSource;
      }
    }
    return;
  }

  frameTable.set(frameId, {
    frameId,
    sampledAt: frame.sampledAt,
    rawDataUrl: frame.rawDataUrl,
    roles: [],
    episodeIds: [],
    cycleIds: [],
    mediaSource,
    mediaConflict: false,
    roleSet: new Set([role]),
    episodeIdSet: new Set(episodeId ? [episodeId] : []),
    cycleIdSet: new Set(cycleId ? [cycleId] : []),
  });
}

function stripRuntimeFrameMedia(frame: RuneRuntimeIncidentFrame) {
  const { rawDataUrl: _rawDataUrl, ...metadata } = frame;
  return {
    ...metadata,
    frameId: createRuneEvidenceFrameId(frame.sampledAt),
  };
}

function stripTriggerFrameMedia(frame: RuneAlertTriggerFrame) {
  const { rawDataUrl: _rawDataUrl, ...metadata } = frame;
  return {
    ...metadata,
    frameId: createRuneEvidenceFrameId(frame.sampledAt),
  };
}
