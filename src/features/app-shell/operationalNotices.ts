import { createMapleTimerApiUrl } from "../../lib/mapleTimerApi";
import type { AppBuildChannel } from "../../contracts/deployment/appBuildInfo";
import { appBuildInfo } from "../../platform/runtime-build/currentAppBuildInfo";

export type OperationalNoticeLevel =
  | "info"
  | "success"
  | "warning"
  | "critical"
  | "maintenance";

export type OperationalNoticeChannel = Exclude<AppBuildChannel, "local">;

export type OperationalNotice = {
  id: string;
  level: OperationalNoticeLevel;
  title: string;
  body: string;
  channels: OperationalNoticeChannel[];
  dismissible: boolean;
  link: {
    label: string;
    href: string;
  } | null;
  updatedAt: string | null;
};

export type OperationalIncidentStatus =
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved"
  | "maintenance";

export type OperationalIncidentUpdate = {
  id: string;
  status: OperationalIncidentStatus;
  body: string;
  createdAt: string;
};

export type OperationalIncident = {
  id: string;
  level: OperationalNoticeLevel;
  status: OperationalIncidentStatus;
  title: string;
  summary: string;
  affected: string[];
  channels: OperationalNoticeChannel[];
  startedAt: string;
  resolvedAt: string | null;
  updatedAt: string;
  link: OperationalNotice["link"];
  updates: OperationalIncidentUpdate[];
};

export type OperationalNoticesSnapshot = {
  available: boolean;
  incidents: OperationalIncident[];
  notices: OperationalNotice[];
  updatedAt: string | null;
  pollIntervalMs: number;
};

const OPERATIONAL_STATUS_API_URL = createMapleTimerApiUrl("/v1/operational-status");
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const MIN_POLL_INTERVAL_MS = 30_000;
const MAX_POLL_INTERVAL_MS = 5 * 60_000;
const NOTICE_LEVELS = new Set<OperationalNoticeLevel>([
  "info",
  "success",
  "warning",
  "critical",
  "maintenance",
]);
const INCIDENT_STATUSES = new Set<OperationalIncidentStatus>([
  "investigating",
  "identified",
  "monitoring",
  "resolved",
  "maintenance",
]);

export async function fetchOperationalNotices(
  signal?: AbortSignal,
): Promise<OperationalNoticesSnapshot> {
  const response = await fetch(OPERATIONAL_STATUS_API_URL, {
    method: "GET",
    signal,
  });

  if (!response.ok) {
    throw new Error("operational-notices-unavailable");
  }

  return filterOperationalNoticesSnapshot(
    parseOperationalNoticesSnapshot(await response.json()),
    appBuildInfo.channel,
  );
}

export function parseOperationalNoticesSnapshot(input: unknown): OperationalNoticesSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return createUnavailableSnapshot();
  }

  const payload = input as {
    available?: unknown;
    incidents?: unknown;
    notices?: unknown;
    updatedAt?: unknown;
    pollIntervalMs?: unknown;
  };

  if (payload.available !== true || !Array.isArray(payload.notices)) {
    return createUnavailableSnapshot();
  }

  return {
    available: true,
    incidents: Array.isArray(payload.incidents)
      ? payload.incidents.flatMap((incident) => {
          const parsed = parseOperationalIncident(incident);
          return parsed ? [parsed] : [];
        })
      : [],
    notices: payload.notices.flatMap((notice) => {
      const parsed = parseOperationalNotice(notice);
      return parsed ? [parsed] : [];
    }),
    updatedAt: normalizeTimestamp(payload.updatedAt),
    pollIntervalMs: normalizePollIntervalMs(payload.pollIntervalMs),
  };
}

export function filterOperationalNoticesSnapshot(
  snapshot: OperationalNoticesSnapshot,
  channel: AppBuildChannel,
): OperationalNoticesSnapshot {
  if (channel === "local") {
    return snapshot;
  }

  return {
    ...snapshot,
    incidents: snapshot.incidents.filter((incident) => incident.channels.includes(channel)),
    notices: snapshot.notices.filter((notice) => notice.channels.includes(channel)),
  };
}

function parseOperationalIncident(value: unknown): OperationalIncident | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const incident = value as Omit<OperationalIncident, "channels"> & { channels?: unknown };
  const channels = parseOperationalChannels(incident.channels);
  if (
    typeof incident.id === "string" &&
    incident.id.trim().length > 0 &&
    NOTICE_LEVELS.has(incident.level) &&
    INCIDENT_STATUSES.has(incident.status) &&
    typeof incident.title === "string" &&
    incident.title.trim().length > 0 &&
    typeof incident.summary === "string" &&
    Array.isArray(incident.affected) &&
    incident.affected.every((item) => typeof item === "string") &&
    typeof incident.startedAt === "string" &&
    (incident.resolvedAt === null || typeof incident.resolvedAt === "string") &&
    typeof incident.updatedAt === "string" &&
    (incident.link === null || isNoticeLink(incident.link)) &&
    Array.isArray(incident.updates) &&
    incident.updates.every(isOperationalIncidentUpdate) &&
    channels
  ) {
    return { ...incident, channels };
  }
  return null;
}

function isOperationalIncidentUpdate(value: unknown): value is OperationalIncidentUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const update = value as OperationalIncidentUpdate;
  return (
    typeof update.id === "string" &&
    update.id.trim().length > 0 &&
    INCIDENT_STATUSES.has(update.status) &&
    typeof update.body === "string" &&
    typeof update.createdAt === "string"
  );
}

function parseOperationalNotice(value: unknown): OperationalNotice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const notice = value as Omit<OperationalNotice, "channels"> & { channels?: unknown };
  const channels = parseOperationalChannels(notice.channels);
  if (
    typeof notice.id === "string" &&
    notice.id.trim().length > 0 &&
    NOTICE_LEVELS.has(notice.level) &&
    typeof notice.title === "string" &&
    notice.title.trim().length > 0 &&
    typeof notice.body === "string" &&
    typeof notice.dismissible === "boolean" &&
    (notice.link === null || isNoticeLink(notice.link)) &&
    (notice.updatedAt === null || typeof notice.updatedAt === "string") &&
    channels
  ) {
    return { ...notice, channels };
  }
  return null;
}

function parseOperationalChannels(value: unknown): OperationalNoticeChannel[] | null {
  if (value === undefined || value === null) {
    return ["production", "preview"];
  }
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const channels = value.filter(
    (channel): channel is OperationalNoticeChannel =>
      channel === "production" || channel === "preview",
  );
  if (channels.length !== value.length) {
    return null;
  }
  return [...new Set(channels)];
}

function isNoticeLink(value: unknown): value is OperationalNotice["link"] {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { label?: unknown }).label === "string" &&
    typeof (value as { href?: unknown }).href === "string"
  );
}

function normalizePollIntervalMs(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_POLL_INTERVAL_MS;
  }
  return Math.max(MIN_POLL_INTERVAL_MS, Math.min(MAX_POLL_INTERVAL_MS, Math.floor(parsed)));
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function createUnavailableSnapshot(): OperationalNoticesSnapshot {
  return {
    available: false,
    incidents: [],
    notices: [],
    updatedAt: null,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  };
}
