import type {
  AlertIssueFeature,
  AlertIssueOccurrence,
} from "../../contracts/reporting/alertIssueScenario";
import type {
  AlertReportIncidentJournalEntry,
  AlertReportIncidentJournalSelection,
} from "../../contracts/reporting/alertReportIncident";

export const ALERT_INCIDENT_JOURNAL_WINDOW_MS = 60_000;
// The cap is applied per feature/target so busy skill lists still retain a full minute.
export const ALERT_INCIDENT_JOURNAL_MAX_ENTRIES = 192;
export const ALERT_INCIDENT_CURRENT_WINDOW_MS = 10_000;
const ALERT_INCIDENT_DETAIL_MAX_KEYS = 20;
const ALERT_INCIDENT_STRING_MAX_LENGTH = 240;

export type AlertIncidentJournalEventKind =
  | "sample"
  | "decision"
  | "playback"
  | "lifecycle";

export type AlertIncidentJournalEntry = AlertReportIncidentJournalEntry;

export type AlertIncidentJournalTarget = {
  feature: AlertIssueFeature;
  targetId?: string | null;
};

export type AlertIncidentJournalSelection = AlertReportIncidentJournalSelection;

export type AlertIncidentJournalOccurrenceSelection = {
  status: "matched" | "current-snapshot" | "outside-retention" | "unavailable";
  entries: AlertIncidentJournalEntry[];
  relatedPlaybackEntries: AlertIncidentJournalEntry[];
  selectedEventAt: number | null;
};

export type AlertIncidentJournal = {
  record(
    entry: Omit<AlertIncidentJournalEntry, "configRevision" | "configuration"> & {
      configuration?: Record<string, unknown> | null;
    },
  ): AlertIncidentJournalEntry;
  freeze(target: AlertIncidentJournalTarget, capturedAt?: number): AlertIncidentJournalSelection;
  clear(): void;
};

export function createAlertIncidentJournal(): AlertIncidentJournal {
  let entries: AlertIncidentJournalEntry[] = [];
  let retentionCursorAt = 0;

  return {
    record(input) {
      const configuration = sanitizeRecord(input.configuration ?? null);
      const entry: AlertIncidentJournalEntry = {
        ...input,
        targetId: input.targetId ?? null,
        frameId: input.frameId ?? null,
        cycleId: input.cycleId ?? null,
        status: normalizeText(input.status),
        decision: normalizeText(input.decision),
        value: normalizeValue(input.value),
        configuration,
        configRevision: configuration ? createConfigurationRevision(configuration) : null,
        details: sanitizeRecord(input.details) ?? {},
      };
      const existingIndex = entries.findIndex((candidate) => candidate.id === entry.id);
      if (existingIndex >= 0) {
        entries[existingIndex] = entry;
      } else {
        entries.push(entry);
      }
      // Playback lifecycle callbacks can update an older event after newer
      // samples have arrived. Never let that late update rewind retention.
      retentionCursorAt = Math.max(retentionCursorAt, entry.occurredAt);
      entries = pruneEntries(entries, retentionCursorAt);
      return entry;
    },
    freeze(target, capturedAt = Date.now()) {
      retentionCursorAt = Math.max(retentionCursorAt, capturedAt);
      entries = pruneEntries(entries, retentionCursorAt);
      const targetId = target.targetId ?? null;
      const selected = entries.filter(
        (entry) =>
          entry.feature === target.feature &&
          (targetId === null || entry.targetId === targetId),
      );
      const selectedIds = new Set(selected.map((entry) => entry.id));
      const relatedPlaybackEntries = entries.filter(
        (entry) => entry.kind === "playback" && !selectedIds.has(entry.id),
      );
      return {
        capturedAt,
        windowStartedAt: capturedAt - ALERT_INCIDENT_JOURNAL_WINDOW_MS,
        windowEndedAt: capturedAt,
        target: { feature: target.feature, targetId },
        entries: selected.map(cloneEntry),
        relatedPlaybackEntries: relatedPlaybackEntries.map(cloneEntry),
      };
    },
    clear() {
      entries = [];
      retentionCursorAt = 0;
    },
  };
}

export function selectAlertIncidentJournalOccurrence(
  selection: AlertIncidentJournalSelection | null | undefined,
  occurrence: AlertIssueOccurrence | null | undefined,
): AlertIncidentJournalOccurrenceSelection {
  if (!selection) {
    return {
      status: "unavailable",
      entries: [],
      relatedPlaybackEntries: [],
      selectedEventAt: null,
    };
  }
  if (occurrence === "historical") {
    return {
      status: "outside-retention",
      entries: [],
      relatedPlaybackEntries: [],
      selectedEventAt: null,
    };
  }

  const cutoff =
    occurrence === "current"
      ? selection.capturedAt - ALERT_INCIDENT_CURRENT_WINDOW_MS
      : selection.windowStartedAt;
  const entries = selection.entries.filter(
    (entry) => entry.occurredAt >= cutoff && entry.occurredAt <= selection.capturedAt,
  );
  const relatedPlaybackEntries = (selection.relatedPlaybackEntries ?? []).filter(
    (entry) => entry.occurredAt >= cutoff && entry.occurredAt <= selection.capturedAt,
  );
  if (entries.length === 0) {
    return {
      status: "unavailable",
      entries: [],
      relatedPlaybackEntries,
      selectedEventAt: null,
    };
  }
  const anchored = findPreferredIncidentEvent(entries);
  return {
    status: occurrence === "current" ? "current-snapshot" : "matched",
    entries,
    relatedPlaybackEntries,
    selectedEventAt: anchored?.occurredAt ?? null,
  };
}

export function createAlertIncidentFrameId(sampledAt: number): string {
  return `frame:${Math.round(sampledAt)}`;
}

function findPreferredIncidentEvent(entries: AlertIncidentJournalEntry[]) {
  return (
    [...entries].reverse().find((entry) => entry.kind === "playback") ??
    [...entries].reverse().find((entry) => entry.kind === "decision") ??
    [...entries].reverse().find((entry) => entry.kind === "lifecycle") ??
    entries[entries.length - 1] ??
    null
  );
}

function pruneEntries(entries: AlertIncidentJournalEntry[], now: number) {
  const cutoff = now - ALERT_INCIDENT_JOURNAL_WINDOW_MS;
  const grouped = new Map<string, AlertIncidentJournalEntry[]>();
  entries
    .filter((entry) => entry.occurredAt >= cutoff && entry.occurredAt <= now + 1_000)
    .sort((left, right) => left.occurredAt - right.occurredAt)
    .forEach((entry) => {
      const key = `${entry.feature}:${entry.targetId ?? ""}`;
      const group = grouped.get(key) ?? [];
      group.push(entry);
      grouped.set(key, group);
    });

  return [...grouped.values()]
    .flatMap((group) => group.slice(-ALERT_INCIDENT_JOURNAL_MAX_ENTRIES))
    .sort((left, right) => left.occurredAt - right.occurredAt);
}

function cloneEntry(entry: AlertIncidentJournalEntry): AlertIncidentJournalEntry {
  return JSON.parse(JSON.stringify(entry)) as AlertIncidentJournalEntry;
}

function createConfigurationRevision(configuration: Record<string, unknown>): string {
  const serialized = stableStringify(configuration);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `cfg-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sanitizeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/dataurl|imagedata|preview|pixels|bytes/i.test(key))
    .slice(0, ALERT_INCIDENT_DETAIL_MAX_KEYS)
    .map(([key, entry]) => [key, sanitizeValue(entry)] as const)
    .filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries);
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:")) {
      return undefined;
    }
    if (value.length > ALERT_INCIDENT_STRING_MAX_LENGTH) {
      return value.slice(0, ALERT_INCIDENT_STRING_MAX_LENGTH);
    }
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 12)
      .map(sanitizeValue)
      .filter((entry) => entry !== undefined);
  }
  return sanitizeRecord(value);
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, ALERT_INCIDENT_STRING_MAX_LENGTH)
    : null;
}

function normalizeValue(value: unknown): AlertIncidentJournalEntry["value"] {
  if (typeof value === "string") {
    return value.slice(0, ALERT_INCIDENT_STRING_MAX_LENGTH);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return typeof value === "boolean" ? value : null;
}
