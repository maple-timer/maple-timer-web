import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  SUPPORTED_BUFF_EXPIRY_BUFF_IDS,
  getBuffExpiryCatalogItem,
  getBuffExpiryTrackingId,
} from "../src/lib/buffExpiry/buffExpiryCatalog";

type ExpectedBuffGroup = {
  id: string;
  label?: string;
};

type VideoManifest = {
  id?: string;
  title?: string;
  frameDir?: string;
  expectedBuffGroups?: ExpectedBuffGroup[];
  videos?: Array<{
    id: string;
    title: string;
    frameDir: string;
    expectedBuffGroups?: ExpectedBuffGroup[];
  }>;
};

type AuditJson = {
  selectedBuffIds: string[];
  videos: Array<{
    id: string;
    title: string;
    expectation?: {
      status: "pass" | "fail" | "skip";
      detail: string;
      missingAlertBuffIds?: string[];
      unexpectedAlertBuffIds?: string[];
    };
    confirmations?: Array<{ buffId: string }>;
    alertEvents?: Array<{ tracks: Array<{ buffId: string }> }>;
  }>;
};

type MatrixGroupResult = {
  buffId: string;
  label: string;
  outputDir: string;
  status: "pass" | "fail";
  exitCode: number | null;
  pass: number;
  fail: number;
  skipped: number;
  failures: Array<{
    sampleId: string;
    title: string;
    detail: string;
    missingAlertBuffIds: string[];
    unexpectedAlertBuffIds: string[];
  }>;
};

const defaultInputRoot = "debug-samples/test-resources/buff-expiry/video/local-1fps";
const inputRoots = process.argv.slice(2).map((inputRoot) => resolve(inputRoot));
const resolvedInputRoots = inputRoots.length ? inputRoots : [resolve(defaultInputRoot)];
const outputRoot = resolve(
  process.env.BUFF_EXPIRY_MATRIX_OUTPUT_DIR ??
    `output/buff-expiry-video-matrix/${new Date().toISOString().replaceAll(":", "-")}`,
);

const selectedBuffIds = readMatrixSelectedBuffIds(resolvedInputRoots);
mkdirSync(outputRoot, { recursive: true });

const groupResults = selectedBuffIds.map((buffId) => runGroupAudit(buffId));
const summary = {
  generatedAt: new Date().toISOString(),
  inputRoots: resolvedInputRoots.map((inputRoot) => relative(process.cwd(), inputRoot)),
  outputRoot: relative(process.cwd(), outputRoot),
  selectedBuffIds,
  pass: groupResults.filter((result) => result.status === "pass").length,
  fail: groupResults.filter((result) => result.status === "fail").length,
  groups: groupResults,
};

writeFileSync(join(outputRoot, "buff-expiry-video-matrix.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(outputRoot, "buff-expiry-video-matrix.md"), makeMarkdownReport(groupResults));

console.log(makeConsoleReport(groupResults));
console.log(`\nJSON: ${relative(process.cwd(), join(outputRoot, "buff-expiry-video-matrix.json"))}`);
console.log(`Markdown: ${relative(process.cwd(), join(outputRoot, "buff-expiry-video-matrix.md"))}`);

if (summary.fail > 0) {
  process.exitCode = 1;
}

function readMatrixSelectedBuffIds(roots: string[]): string[] {
  const raw = process.env.BUFF_EXPIRY_MATRIX_SELECTED_BUFF_IDS;
  if (raw) {
    return normalizeBuffIds(raw.split(","));
  }

  const ids: string[] = [];
  for (const root of roots) {
    for (const expected of readExpectedGroups(root)) {
      const trackingId = getBuffExpiryTrackingId(expected.id);
      if (!ids.includes(trackingId)) {
        ids.push(trackingId);
      }
    }
  }
  return normalizeBuffIds(ids);
}

function normalizeBuffIds(ids: string[]): string[] {
  const supported = new Set<string>(SUPPORTED_BUFF_EXPIRY_BUFF_IDS);
  const normalized = ids
    .map((id) => getBuffExpiryTrackingId(id.trim()))
    .filter((id) => supported.has(id));
  const unique = [...new Set(normalized)];
  if (!unique.length) {
    throw new Error("No supported buff ids found for matrix audit.");
  }
  return unique;
}

function readExpectedGroups(root: string): ExpectedBuffGroup[] {
  const manifest = readManifest(root);
  if (!Array.isArray(manifest.videos)) {
    return manifest.expectedBuffGroups ?? [];
  }

  return manifest.videos.flatMap((video) => {
    if (Array.isArray(video.expectedBuffGroups) && video.expectedBuffGroups.length) {
      return video.expectedBuffGroups;
    }
    const frameDir = resolve(video.frameDir);
    return readManifest(frameDir).expectedBuffGroups ?? [];
  });
}

function readManifest(root: string): VideoManifest {
  const manifestPath = join(root, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing manifest: ${manifestPath}`);
  }
  return JSON.parse(readFileSync(manifestPath, "utf8")) as VideoManifest;
}

function runGroupAudit(buffId: string): MatrixGroupResult {
  const outputDir = join(outputRoot, buffId);
  mkdirSync(outputDir, { recursive: true });

  const child = spawnSync(
    "npx",
    ["tsx", "scripts/audit-buff-expiry-video-samples.ts", ...resolvedInputRoots],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        BUFF_EXPIRY_AUDIT_SELECTED_BUFF_IDS: buffId,
        BUFF_EXPIRY_AUDIT_OUTPUT_DIR: outputDir,
        BUFF_EXPIRY_AUDIT_SECOND_FROM: "",
        BUFF_EXPIRY_AUDIT_SECOND_TO: "",
      },
    },
  );

  writeFileSync(join(outputDir, "stdout.log"), child.stdout ?? "");
  writeFileSync(join(outputDir, "stderr.log"), child.stderr ?? "");

  const auditPath = join(outputDir, "buff-expiry-current-video-audit.json");
  const audit = existsSync(auditPath)
    ? JSON.parse(readFileSync(auditPath, "utf8")) as AuditJson
    : null;
  const videoResults = audit?.videos ?? [];
  const failures = videoResults
    .filter((video) => video.expectation?.status === "fail")
    .map((video) => ({
      sampleId: video.id,
      title: video.title,
      detail: video.expectation?.detail ?? "unknown failure",
      missingAlertBuffIds: video.expectation?.missingAlertBuffIds ?? [],
      unexpectedAlertBuffIds: video.expectation?.unexpectedAlertBuffIds ?? [],
    }));
  const pass = videoResults.filter((video) => video.expectation?.status === "pass").length;
  const fail = failures.length;
  const skipped = videoResults.filter((video) => video.expectation?.status === "skip" || !video.expectation).length;
  const status = child.status === 0 && fail === 0 ? "pass" : "fail";

  return {
    buffId,
    label: getBuffLabel(buffId),
    outputDir: relative(process.cwd(), outputDir),
    status,
    exitCode: child.status,
    pass,
    fail,
    skipped,
    failures,
  };
}

function makeConsoleReport(results: MatrixGroupResult[]): string {
  const rows = results.map((result) => [
    result.label,
    result.status.toUpperCase(),
    String(result.pass),
    String(result.fail),
    String(result.skipped),
    result.outputDir,
  ]);
  const headers = ["buff", "status", "pass", "fail", "skip", "output"];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  const table = [
    headers.map((header, index) => header.padEnd(widths[index])).join(" | "),
    widths.map((width) => "-".repeat(width)).join("-|-"),
    ...rows.map((row) => row.map((cell, index) => cell.padEnd(widths[index])).join(" | ")),
  ];
  const failures = results.flatMap((result) =>
    result.failures.map((failure) => `- ${result.label} / ${failure.sampleId}: ${failure.detail}`),
  );
  return failures.length ? `${table.join("\n")}\n\nFailures:\n${failures.join("\n")}` : table.join("\n");
}

function makeMarkdownReport(results: MatrixGroupResult[]): string {
  const lines = [
    "# Buff Expiry Video Matrix Audit",
    "",
    `- Inputs: ${resolvedInputRoots.map((inputRoot) => `\`${relative(process.cwd(), inputRoot)}\``).join(", ")}`,
    "",
    "| Buff | Status | Pass | Fail | Skip | Output |",
    "|---|---|---:|---:|---:|---|",
    ...results.map((result) =>
      `| ${result.label} | ${result.status.toUpperCase()} | ${result.pass} | ${result.fail} | ${result.skipped} | \`${result.outputDir}\` |`,
    ),
    "",
  ];
  const failures = results.filter((result) => result.failures.length);
  if (failures.length) {
    lines.push("## Failures", "");
    for (const result of failures) {
      for (const failure of result.failures) {
        lines.push(`- ${result.label} / \`${failure.sampleId}\`: ${failure.detail}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function getBuffLabel(buffId: string): string {
  return getBuffExpiryCatalogItem(buffId)?.label ?? buffId;
}
