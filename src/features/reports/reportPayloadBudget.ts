import { reconcileAlertReportIncidentPayload } from "../../contracts/reporting/alertReportIncident";

export const REPORT_PAYLOAD_SOFT_LIMIT_BYTES = 6 * 1024 * 1024;
export const REPORT_PAYLOAD_RETRY_LIMIT_BYTES = 3 * 1024 * 1024;
export const REPORT_PAYLOAD_BUDGET_VERSION = 1;

type MediaCandidate = {
  parent: Record<string, unknown> | unknown[];
  key: string | number;
  path: string;
  byteLength: number;
  priority: number;
  protected: boolean;
};

export type ReportPayloadBudgetDiagnostics = {
  version: typeof REPORT_PAYLOAD_BUDGET_VERSION;
  targetBytes: number;
  originalBytes: number;
  finalBytes: number;
  originalMediaCount: number;
  droppedMediaCount: number;
  droppedBytes: number;
  droppedPaths: string[];
  overTarget: boolean;
};

export function compactReportPayload(
  payload: unknown,
  options: { targetBytes?: number; aggressive?: boolean } = {},
): unknown {
  const targetBytes = options.targetBytes ?? REPORT_PAYLOAD_SOFT_LIMIT_BYTES;
  const cloned = cloneJson(payload);
  if (!isRecord(cloned)) {
    return cloned;
  }

  delete cloned.reportPayloadBudget;
  const originalBytes = getReportPayloadByteLength(cloned);
  const candidates = collectMediaCandidates(cloned);
  const droppable = candidates
    .filter(
      (candidate) =>
        !isRequiredSampleMedia(candidate.path) &&
        (options.aggressive || !candidate.protected),
    )
    .sort(
      (left, right) =>
        Number(left.protected) - Number(right.protected) ||
        left.priority - right.priority ||
        right.byteLength - left.byteLength ||
        left.path.localeCompare(right.path),
    );
  const dropped: MediaCandidate[] = [];
  let currentBytes = originalBytes;

  for (const candidate of droppable) {
    if (currentBytes <= targetBytes) {
      break;
    }
    setCandidateValue(candidate, null);
    dropped.push(candidate);
    currentBytes -= candidate.byteLength;
  }

  recordBuffExpiryCompactionOmissions(cloned, dropped);
  recordSkillIncidentCompactionOmissions(cloned, dropped);
  recordSpecialCoreIncidentCompactionOmissions(cloned, dropped);
  recordUltimaRaidEquipmentCompactionOmissions(cloned, dropped);
  reconcileUltimaRaidEquipmentIncidentBudget(cloned);
  reconcileAlertReportIncidentPayload(cloned);
  reconcileSkillIncidentBudget(cloned);
  reconcileSpecialCoreIncidentBudget(cloned);

  const diagnostics: ReportPayloadBudgetDiagnostics = {
    version: REPORT_PAYLOAD_BUDGET_VERSION,
    targetBytes,
    originalBytes,
    finalBytes: 0,
    originalMediaCount: candidates.length,
    droppedMediaCount: dropped.length,
    droppedBytes: dropped.reduce((sum, candidate) => sum + candidate.byteLength, 0),
    droppedPaths: dropped.slice(0, 24).map((candidate) => candidate.path),
    overTarget: false,
  };
  cloned.reportPayloadBudget = diagnostics;
  stabilizeFinalByteLength(cloned, diagnostics);
  diagnostics.overTarget = diagnostics.finalBytes > targetBytes;
  stabilizeFinalByteLength(cloned, diagnostics);
  return cloned;
}

export function getReportPayloadByteLength(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}

function collectMediaCandidates(root: unknown): MediaCandidate[] {
  const candidates: MediaCandidate[] = [];

  const visit = (value: unknown, path: Array<string | number>) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        if (isImageDataUrl(entry)) {
          candidates.push(createCandidate(value, index, entry, [...path, index]));
        } else if (entry && typeof entry === "object") {
          visit(entry, [...path, index]);
        }
      });
      return;
    }
    if (!isRecord(value)) {
      return;
    }
    Object.entries(value).forEach(([key, entry]) => {
      if (isImageDataUrl(entry)) {
        candidates.push(createCandidate(value, key, entry, [...path, key]));
      } else if (entry && typeof entry === "object") {
        visit(entry, [...path, key]);
      }
    });
  };

  visit(root, []);
  return candidates;
}

function createCandidate(
  parent: Record<string, unknown> | unknown[],
  key: string | number,
  value: string,
  path: Array<string | number>,
): MediaCandidate {
  const pathText = path.join(".");
  return {
    parent,
    key,
    path: pathText,
    byteLength: new TextEncoder().encode(value).byteLength,
    priority: getMediaDropPriority(pathText),
    protected: isProtectedIncidentMedia(pathText),
  };
}

function getMediaDropPriority(path: string): number {
  if (path.endsWith("fullFrameDataUrl")) return 0;
  if (/cropHistory|recentRoiFrames|runtimeIncident|replay\.frames/.test(path)) return 1;
  if (/processedDataUrl|maskPreviewUrl/.test(path)) return 2;
  if (/recentEvidence|cropCandidates/.test(path)) return 3;
  if (/candidateIcons|iconEvidence/.test(path)) return 4;
  return 5;
}

function isProtectedIncidentMedia(path: string): boolean {
  return /runtimeFrames|alertTrigger|lastAlertEvidence|activationEvidence|buffExpiryEvidence\.media|skillEvidence\.media|specialCoreEvidence\.media|ultimaRaidEquipmentEvidence\.media/.test(
    path,
  );
}

function reconcileUltimaRaidEquipmentIncidentBudget(
  payload: Record<string, unknown>,
) {
  const sample = isRecord(payload.sample) ? payload.sample : null;
  const evidence = isRecord(sample?.ultimaRaidEquipmentEvidence)
    ? sample.ultimaRaidEquipmentEvidence
    : null;
  const media = Array.isArray(evidence?.media) ? evidence.media : null;
  if (!evidence || !media) {
    return;
  }
  const retained = media.filter(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) && isImageDataUrl(entry.dataUrl),
  );
  if (isRecord(evidence.budget)) {
    evidence.budget.mediaChars = retained.reduce(
      (total, entry) => total + String(entry.dataUrl).length,
      0,
    );
  }
  const incident = isRecord(payload.incident) ? payload.incident : null;
  const incidentEvidence = isRecord(incident?.evidence)
    ? incident.evidence
    : null;
  if (incidentEvidence) {
    incidentEvidence.mediaCount = retained.length;
  }
}

function recordUltimaRaidEquipmentCompactionOmissions(
  payload: Record<string, unknown>,
  dropped: MediaCandidate[],
) {
  const sample = isRecord(payload.sample) ? payload.sample : null;
  const evidence = isRecord(sample?.ultimaRaidEquipmentEvidence)
    ? sample.ultimaRaidEquipmentEvidence
    : null;
  if (!evidence) {
    return;
  }
  const droppedCount = dropped.filter((candidate) =>
    /^sample\.ultimaRaidEquipmentEvidence\.media\.\d+\.dataUrl$/.test(
      candidate.path,
    ),
  ).length;
  if (droppedCount === 0) {
    return;
  }
  if (isRecord(evidence.selection)) {
    evidence.selection.support = "partial";
    const reasons = Array.isArray(evidence.selection.degradationReasons)
      ? evidence.selection.degradationReasons
      : [];
    evidence.selection.degradationReasons = uniqueStrings([
      ...reasons.filter((entry): entry is string => typeof entry === "string"),
      "payload-compacted",
    ]);
  }
  if (isRecord(evidence.budget)) {
    evidence.budget.droppedMediaCount =
      Number(evidence.budget.droppedMediaCount || 0) + droppedCount;
  }
}

function isRequiredSampleMedia(path: string): boolean {
  return (
    path === "sample.source.dataUrl" ||
    path === "sample.rawDataUrl" ||
    path === "sample.processedDataUrl"
  );
}

function setCandidateValue(candidate: MediaCandidate, value: unknown) {
  if (Array.isArray(candidate.parent) && typeof candidate.key === "number") {
    candidate.parent[candidate.key] = value;
    return;
  }
  if (!Array.isArray(candidate.parent) && typeof candidate.key === "string") {
    candidate.parent[candidate.key] = value;
  }
}

function recordBuffExpiryCompactionOmissions(
  payload: Record<string, unknown>,
  dropped: MediaCandidate[],
) {
  const sample = isRecord(payload.sample) ? payload.sample : null;
  const evidence = isRecord(sample?.buffExpiryEvidence)
    ? sample.buffExpiryEvidence
    : null;
  const media = Array.isArray(evidence?.media) ? evidence.media : null;
  if (!evidence || !media) {
    return;
  }
  const omissions = Array.isArray(evidence.omissions)
    ? evidence.omissions
    : [];
  evidence.omissions = omissions;
  for (const candidate of dropped) {
    const match = candidate.path.match(
      /^sample\.buffExpiryEvidence\.media\.(\d+)\.dataUrl$/,
    );
    if (!match) {
      continue;
    }
    const frame = media[Number(match[1])];
    if (!isRecord(frame) || typeof frame.frameId !== "string") {
      continue;
    }
    const id = `buff-expiry-payload-compacted:${frame.frameId}`;
    if (omissions.some((entry) => isRecord(entry) && entry.id === id)) {
      continue;
    }
    omissions.push({
      id,
      occurredAt:
        typeof evidence.frozenAt === "number" ? evidence.frozenAt : Date.now(),
      kind: "media",
      reason: "payload-compacted",
      subjectIds: [frame.frameId],
      count: 1,
    });
  }
}

function recordSkillIncidentCompactionOmissions(
  payload: Record<string, unknown>,
  dropped: MediaCandidate[],
) {
  const sample = isRecord(payload.sample) ? payload.sample : null;
  const evidence = isRecord(sample?.skillEvidence) ? sample.skillEvidence : null;
  const media = Array.isArray(evidence?.media) ? evidence.media : null;
  if (!evidence || !media) {
    return;
  }
  const omissions = Array.isArray(evidence.omissions)
    ? evidence.omissions
    : [];
  evidence.omissions = omissions;
  const droppedMediaIds: string[] = [];
  for (const candidate of dropped) {
    const match = candidate.path.match(
      /^sample\.skillEvidence\.media\.(\d+)\.dataUrl$/,
    );
    if (!match) {
      continue;
    }
    const entry = media[Number(match[1])];
    if (!isRecord(entry) || typeof entry.id !== "string") {
      continue;
    }
    droppedMediaIds.push(entry.id);
    const id = `skill-payload-compacted:${entry.id}`;
    if (omissions.some((omission) => isRecord(omission) && omission.id === id)) {
      continue;
    }
    omissions.push({
      id,
      occurredAt:
        typeof evidence.frozenAt === "number" ? evidence.frozenAt : Date.now(),
      kind: "media",
      reason: "payload-compacted",
      subjectIds: [entry.id],
      count: 1,
    });
  }
  if (droppedMediaIds.length === 0) {
    return;
  }
  if (isRecord(evidence.selection)) {
    evidence.selection.support = "partial";
    const reasons = Array.isArray(evidence.selection.degradationReasons)
      ? evidence.selection.degradationReasons
      : [];
    evidence.selection.degradationReasons = uniqueStrings([
      ...reasons.filter((entry): entry is string => typeof entry === "string"),
      "payload-compacted",
    ]);
  }
  if (isRecord(evidence.budget)) {
    const previous = Array.isArray(evidence.budget.droppedMediaIds)
      ? evidence.budget.droppedMediaIds
      : [];
    evidence.budget.droppedMediaIds = uniqueStrings([
      ...previous.filter((entry): entry is string => typeof entry === "string"),
      ...droppedMediaIds,
    ]);
  }
}

function reconcileSkillIncidentBudget(payload: Record<string, unknown>) {
  const sample = isRecord(payload.sample) ? payload.sample : null;
  const evidence = isRecord(sample?.skillEvidence) ? sample.skillEvidence : null;
  const media = Array.isArray(evidence?.media) ? evidence.media : null;
  if (!evidence || !media) {
    return;
  }
  const retained = media.filter(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) && isImageDataUrl(entry.dataUrl),
  );
  const mediaChars = retained.reduce(
    (total, entry) => total + String(entry.dataUrl).length,
    0,
  );
  if (isRecord(evidence.budget)) {
    evidence.budget.mediaCount = retained.length;
    evidence.budget.mediaChars = mediaChars;
    evidence.budget.requestChars = JSON.stringify(evidence).length;
    const mediaLimitCount = Number(evidence.budget.mediaLimitCount);
    const mediaLimitChars = Number(evidence.budget.mediaLimitChars);
    const requestTargetChars = Number(evidence.budget.requestTargetChars);
    evidence.budget.overMediaLimit =
      (Number.isFinite(mediaLimitCount) && retained.length > mediaLimitCount) ||
      (Number.isFinite(mediaLimitChars) && mediaChars > mediaLimitChars);
    evidence.budget.overRequestTarget =
      Number.isFinite(requestTargetChars) &&
      Number(evidence.budget.requestChars) > requestTargetChars;
  }
  const incident = isRecord(payload.incident) ? payload.incident : null;
  const incidentEvidence = isRecord(incident?.evidence)
    ? incident.evidence
    : null;
  if (incidentEvidence) {
    incidentEvidence.mediaCount = retained.length;
  }
}

function recordSpecialCoreIncidentCompactionOmissions(
  payload: Record<string, unknown>,
  dropped: MediaCandidate[],
) {
  const sample = isRecord(payload.sample) ? payload.sample : null;
  const evidence = isRecord(sample?.specialCoreEvidence)
    ? sample.specialCoreEvidence
    : null;
  const media = Array.isArray(evidence?.media) ? evidence.media : null;
  if (!evidence || !media) {
    return;
  }
  const omissions = Array.isArray(evidence.omissions)
    ? evidence.omissions
    : [];
  evidence.omissions = omissions;
  const droppedFrameIds: string[] = [];
  for (const candidate of dropped) {
    const match = candidate.path.match(
      /^sample\.specialCoreEvidence\.media\.(\d+)\.imageDataUrl$/,
    );
    if (!match) {
      continue;
    }
    const entry = media[Number(match[1])];
    if (!isRecord(entry) || typeof entry.frameId !== "string") {
      continue;
    }
    droppedFrameIds.push(entry.frameId);
    const id = `special-core-payload-compacted:${entry.frameId}`;
    if (omissions.some((omission) => isRecord(omission) && omission.id === id)) {
      continue;
    }
    omissions.push({
      id,
      occurredAt:
        typeof evidence.frozenAt === "number" ? evidence.frozenAt : Date.now(),
      kind: "media",
      reason: "payload-compacted",
      subjectIds: [entry.frameId],
      count: 1,
    });
  }
  if (droppedFrameIds.length === 0) {
    return;
  }
  if (isRecord(evidence.selection)) {
    evidence.selection.support = "partial";
    const reasons = Array.isArray(evidence.selection.degradationReasons)
      ? evidence.selection.degradationReasons
      : [];
    evidence.selection.degradationReasons = uniqueStrings([
      ...reasons.filter((entry): entry is string => typeof entry === "string"),
      "payload-compacted",
    ]);
  }
  if (isRecord(evidence.budget)) {
    const previous = Array.isArray(evidence.budget.droppedMediaFrameIds)
      ? evidence.budget.droppedMediaFrameIds
      : [];
    evidence.budget.droppedMediaFrameIds = uniqueStrings([
      ...previous.filter((entry): entry is string => typeof entry === "string"),
      ...droppedFrameIds,
    ]);
  }
}

function reconcileSpecialCoreIncidentBudget(payload: Record<string, unknown>) {
  const sample = isRecord(payload.sample) ? payload.sample : null;
  const evidence = isRecord(sample?.specialCoreEvidence)
    ? sample.specialCoreEvidence
    : null;
  const media = Array.isArray(evidence?.media) ? evidence.media : null;
  if (!evidence || !media) {
    return;
  }
  const retained = media.filter(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) && isImageDataUrl(entry.imageDataUrl),
  );
  const mediaChars = retained.reduce(
    (total, entry) => total + String(entry.imageDataUrl).length,
    0,
  );
  if (isRecord(evidence.budget)) {
    evidence.budget.mediaCount = retained.length;
    evidence.budget.mediaChars = mediaChars;
    evidence.budget.requestBytes = getReportPayloadByteLength(evidence);
    const mediaLimitCount = Number(evidence.budget.mediaLimitCount);
    const mediaLimitChars = Number(evidence.budget.mediaLimitChars);
    const requestTargetBytes = Number(evidence.budget.requestTargetBytes);
    evidence.budget.overMediaLimit =
      (Number.isFinite(mediaLimitCount) && retained.length > mediaLimitCount) ||
      (Number.isFinite(mediaLimitChars) && mediaChars > mediaLimitChars);
    evidence.budget.overRequestTarget =
      Number.isFinite(requestTargetBytes) &&
      Number(evidence.budget.requestBytes) > requestTargetBytes;
  }
  const incident = isRecord(payload.incident) ? payload.incident : null;
  const incidentEvidence = isRecord(incident?.evidence)
    ? incident.evidence
    : null;
  if (incidentEvidence) {
    incidentEvidence.mediaCount = retained.length;
  }
}

function cloneJson(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  return typeof serialized === "string" ? JSON.parse(serialized) : value;
}

function stabilizeFinalByteLength(
  payload: Record<string, unknown>,
  diagnostics: ReportPayloadBudgetDiagnostics,
) {
  for (let index = 0; index < 4; index += 1) {
    const next = getReportPayloadByteLength(payload);
    if (diagnostics.finalBytes === next) {
      return;
    }
    diagnostics.finalBytes = next;
  }
}

function isImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
