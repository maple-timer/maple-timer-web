#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_ENDPOINT = "https://maple-timer.com/api/admin/reports/import";
const KNOWN_LABELS = [
  "ID",
  "유형",
  "사유",
  "연락처",
  "주소",
  "화면 공유",
  "캡처 크기",
  "첨부",
  "스킬",
  "알림 기준",
  "알람음",
  "볼륨",
  "상태",
  "현재 추정 남은 시간",
  "현재 OCR 값",
  "예상 알림까지",
  "타이머 시작 반영값",
  "거부값",
  "인식값",
  "신뢰도",
  "후보 수",
  "메모",
  "샘플 ID",
  "샘플 조회",
  "KV Key",
  "경험치 판독값",
  "변화 없음",
  "사냥 시작 감지",
];

function parseArgs(argv) {
  const args = {
    file: "",
    endpoint: DEFAULT_ENDPOINT,
    since: "2026-04-27T00:00:00+09:00",
    dryRun: false,
    includeTests: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") {
      args.file = argv[++index] || "";
    } else if (arg === "--endpoint") {
      args.endpoint = argv[++index] || DEFAULT_ENDPOINT;
    } else if (arg === "--since") {
      args.since = argv[++index] || args.since;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--include-tests") {
      args.includeTests = true;
    }
  }

  return args;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseFields(content) {
  const matches = [];
  for (const label of KNOWN_LABELS) {
    const pattern = new RegExp(`(?:^|\\n)${escapeRegex(label)}:\\s*`, "g");
    let match;
    while ((match = pattern.exec(content))) {
      matches.push({ label, labelStart: match.index, valueStart: match.index + match[0].length });
    }
  }

  matches.sort((a, b) => a.labelStart - b.labelStart);
  const fields = {};
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    fields[current.label] = content
      .slice(current.valueStart, next ? next.labelStart : content.length)
      .trim();
  }
  return fields;
}

function parseFeedbackMessage(content) {
  const separatorIndex = content.indexOf("\n\n");
  if (separatorIndex < 0) {
    return "";
  }
  return content.slice(separatorIndex + 2).trim();
}

function mapKind(fields, isFeedback) {
  const type = fields["유형"] || "";
  if (isFeedback) {
    if (type === "버그") return "bug";
    if (type === "제안") return "suggestion";
    return "other";
  }

  if (type === "스킬 감지 제보") return "skill-issue";
  if (type === "룬 감지 제보") return "rune-issue";
  if (type === "사냥 멈춤 감지 제보") return "hunt-stall-issue";
  return "skill-issue";
}

function inferContentType(fileName, fallback = "") {
  const ext = path.extname(fileName || "").toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".json") return "application/json";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  if (ext === ".mp4") return "video/mp4";
  return fallback || "application/octet-stream";
}

async function attachmentToAsset(attachment) {
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`failed to download ${attachment.fileName}: ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = inferContentType(
    attachment.fileName,
    response.headers.get("content-type") || undefined,
  );

  return {
    name: attachment.fileName || `${attachment.id || "attachment"}.bin`,
    type: contentType,
    dataUrl: `data:${contentType};base64,${bytes.toString("base64")}`,
  };
}

function sampleDataUrlAssets(sample) {
  const assets = [];
  if (sample?.rawDataUrl) {
    assets.push({
      name: "sample-raw.png",
      type: "image/png",
      dataUrl: sample.rawDataUrl,
    });
  }
  if (sample?.processedDataUrl) {
    assets.push({
      name: "sample-processed.png",
      type: "image/png",
      dataUrl: sample.processedDataUrl,
    });
  }
  if (sample?.candidateDataUrl) {
    assets.push({
      name: "sample-candidate.png",
      type: "image/png",
      dataUrl: sample.candidateDataUrl,
    });
  }
  return assets;
}

async function debugSampleUrlToAssets(sampleUrl) {
  if (!sampleUrl) {
    return [];
  }

  const response = await fetch(sampleUrl);
  if (!response.ok) {
    throw new Error(`sample lookup failed with ${response.status}`);
  }

  const body = await response.json();
  return sampleDataUrlAssets(body?.body?.sample);
}

function isTestMessage(message) {
  return /codex|report-delivery-test/i.test(message.content || "");
}

function messageToReport(message) {
  const content = message.content || "";
  const isFeedback = content.includes("새 Maple Timer 피드백");
  const isIssue = content.includes("새 Maple Timer 감지 제보");
  if (!isFeedback && !isIssue) {
    return null;
  }

  const fieldSource = isFeedback ? content.split("\n\n")[0] : content;
  const fields = parseFields(fieldSource);
  const id = fields.ID;
  if (!id) {
    return null;
  }

  const contact = fields["연락처"] && fields["연락처"] !== "없음" ? fields["연락처"] : null;
  const kind = mapKind(fields, isFeedback);
  const messageText = isFeedback ? parseFeedbackMessage(content) : fields["메모"] || fields["사유"] || "";

  return {
    id,
    source: isFeedback ? "feedback" : "issue",
    kind,
    status: "unresolved",
    reason: isFeedback ? null : fields["사유"] || null,
    message: messageText,
    contact,
    url: fields["주소"] || "",
    createdAt: new Date(message.timestamp).toISOString(),
    metadata: {
      migrated: true,
      migratedFrom: "discord-export",
      discordMessageId: message.id,
      discordTimestamp: message.timestamp,
      discordAuthor: message.author?.name || "",
      originalType: fields["유형"] || "",
      fields,
      attachmentCount: message.attachments?.length || 0,
    },
    payload: {
      originalContent: content,
      fields,
      discordMessage: {
        id: message.id,
        timestamp: message.timestamp,
        author: message.author?.name || "",
      },
      discordAttachments: (message.attachments || []).map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        fileSizeBytes: attachment.fileSizeBytes,
      })),
    },
    discordAttachments: message.attachments || [],
  };
}

async function importReport(endpoint, token, report) {
  const { discordAttachments, ...payload } = report;
  const assets = [];
  for (const attachment of discordAttachments) {
    try {
      assets.push(await attachmentToAsset(attachment));
    } catch (error) {
      payload.metadata = {
        ...payload.metadata,
        attachmentImportErrors: [
          ...(payload.metadata.attachmentImportErrors || []),
          `${attachment.fileName || attachment.id}: ${error.message}`,
        ],
      };
    }
  }

  const sampleUrl = payload.metadata?.fields?.["샘플 조회"];
  if (payload.source === "issue" && sampleUrl) {
    try {
      assets.push(...(await debugSampleUrlToAssets(sampleUrl)));
    } catch (error) {
      payload.metadata = {
        ...payload.metadata,
        sampleImportErrors: [
          ...(payload.metadata.sampleImportErrors || []),
          error instanceof Error ? error.message : String(error),
        ],
      };
    }
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ...payload, assets }),
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.ADMIN_API_TOKEN || "";
  if (!args.file) {
    throw new Error("--file is required");
  }
  if (!args.dryRun && !token) {
    throw new Error("ADMIN_API_TOKEN is required unless --dry-run is used");
  }

  const exportJson = JSON.parse(await readFile(args.file, "utf8"));
  const since = new Date(args.since);
  const candidates = exportJson.messages
    .filter((message) => new Date(message.timestamp) >= since)
    .filter((message) => message.author?.name === "메이플 타이머")
    .filter((message) => args.includeTests || !isTestMessage(message))
    .map(messageToReport)
    .filter(Boolean);

  const summary = candidates.reduce((acc, report) => {
    acc[report.kind] = (acc[report.kind] || 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({ dryRun: args.dryRun, candidateCount: candidates.length, summary }, null, 2));
  if (args.dryRun) {
    console.log(candidates.slice(0, 8).map((report) => `${report.createdAt} ${report.id} ${report.kind}`).join("\n"));
    return;
  }

  let imported = 0;
  let skipped = 0;
  for (const report of candidates) {
    const result = await importReport(args.endpoint, token, report);
    if (result.skipped) {
      skipped += 1;
    } else {
      imported += 1;
    }
    console.log(`${result.skipped ? "skip" : "import"} ${report.id} ${report.kind} assets=${result.assetCount ?? 0}`);
  }

  console.log(JSON.stringify({ imported, skipped, total: candidates.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
