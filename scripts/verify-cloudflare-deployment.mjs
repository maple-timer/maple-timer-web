#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const VALID_CHANNELS = new Set(["preview", "production"]);
const DEFAULT_ATTEMPTS = 60;
const DEFAULT_DELAY_MS = 1_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;
const FULL_LOWERCASE_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const MAX_REVIEWED_BRANCH_LENGTH = 128;
const REVIEWED_BRANCH_CHARACTERS = /^[A-Za-z0-9._/-]+$/;

export function validateDeployContext({
  channel,
  branch,
  status,
  commitSha = "",
  upstreamSha = "",
}) {
  const errors = [];
  if (!VALID_CHANNELS.has(channel)) {
    errors.push(`unsupported channel: ${channel || "missing"}`);
  }
  if (!branch) {
    errors.push("deployment requires a named git branch");
  }
  if (channel === "production" && branch !== "main") {
    errors.push(`production deployment requires main, got ${branch || "detached HEAD"}`);
  }
  if (channel === "production" && branch === "main") {
    if (!upstreamSha) {
      errors.push("production deployment requires a configured upstream main branch");
    } else if (commitSha !== upstreamSha) {
      errors.push("production main must be pushed and match its upstream commit");
    }
  }
  if (status.trim()) {
    errors.push("deployment requires a clean git worktree");
  }
  return errors;
}

export function isValidRemoteRecognitionV1ReviewedBranch(value) {
  if (
    value.length === 0 ||
    value.length > MAX_REVIEWED_BRANCH_LENGTH ||
    !REVIEWED_BRANCH_CHARACTERS.test(value) ||
    value === "@" ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.includes("//") ||
    value.includes("..") ||
    value.includes("@{")
  ) {
    return false;
  }
  return value
    .split("/")
    .every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}

export function validateRemoteRecognitionV1TestArmContext({
  expectedArm,
  channel,
  branch,
  commitSha,
  armValue,
  buildModeValue,
  reviewedCommit,
  reviewedBranch,
}) {
  const errors = [];
  if (!expectedArm) {
    if (armValue === "1") {
      errors.push(
        "standard deployment refuses MAPLE_TIMER_REMOTE_RECOGNITION_V1_TEST_ARM=1",
      );
    }
    if (buildModeValue === "reviewed-preview") {
      errors.push(
        "standard deployment refuses remote V1 reviewed-preview build mode",
      );
    }
    return errors;
  }

  if (channel !== "preview") {
    errors.push("remote V1 test-arm deployment requires preview channel");
  }
  if (armValue !== "1") {
    errors.push(
      "remote V1 test-arm deployment requires MAPLE_TIMER_REMOTE_RECOGNITION_V1_TEST_ARM=1",
    );
  }
  if (buildModeValue !== "reviewed-preview") {
    errors.push(
      "remote V1 test-arm deployment requires reviewed-preview build mode",
    );
  }
  if (!FULL_LOWERCASE_COMMIT_PATTERN.test(reviewedCommit)) {
    errors.push(
      "remote V1 reviewed commit must be a full lowercase commit SHA",
    );
  } else if (reviewedCommit !== commitSha) {
    errors.push("remote V1 reviewed commit must match the current git commit");
  }
  if (!isValidRemoteRecognitionV1ReviewedBranch(reviewedBranch)) {
    errors.push("remote V1 reviewed branch is invalid");
  } else if (reviewedBranch !== branch) {
    errors.push("remote V1 reviewed branch must match the current git branch");
  }
  return errors;
}

export function validateDeploymentBuildInfo(buildInfo, expected) {
  if (!buildInfo || typeof buildInfo !== "object" || Array.isArray(buildInfo)) {
    return ["build-info.json is not an object"];
  }

  const errors = [];
  compareField(errors, "name", buildInfo.name, "maple-timer");
  compareField(errors, "commitSha", buildInfo.commitSha, expected.commitSha);
  compareField(errors, "shortCommit", buildInfo.shortCommit, expected.commitSha.slice(0, 7));
  compareField(errors, "branch", buildInfo.branch, expected.branch);
  compareField(errors, "channel", buildInfo.channel, expected.channel);
  compareField(
    errors,
    "remoteRecognitionV1TestArm",
    buildInfo.remoteRecognitionV1TestArm,
    expected.remoteRecognitionV1TestArm,
  );
  compareField(
    errors,
    "deploymentUrl",
    normalizeUrl(buildInfo.deploymentUrl),
    normalizeUrl(expected.deploymentUrl),
  );

  if (typeof buildInfo.version !== "string" || !buildInfo.version.trim()) {
    errors.push("version is missing");
  }
  if (
    typeof buildInfo.buildTime !== "string" ||
    !Number.isFinite(Date.parse(buildInfo.buildTime))
  ) {
    errors.push(`buildTime is invalid: ${formatValue(buildInfo.buildTime)}`);
  }
  return errors;
}

export function validateDeploymentReleaseNotesFeed(feed, expected) {
  if (!feed || typeof feed !== "object" || Array.isArray(feed)) {
    return ["release-notes.json is not an object"];
  }

  const errors = [];
  compareField(errors, "release schema", feed.schema, "maple-timer.release-notes");
  compareField(errors, "release version", feed.version, 1);
  if (!feed.build || typeof feed.build !== "object" || Array.isArray(feed.build)) {
    errors.push("release build is missing");
  } else {
    compareField(errors, "release commitSha", feed.build.commitSha, expected.commitSha);
    compareField(errors, "release branch", feed.build.branch, expected.branch);
    compareField(errors, "release channel", feed.build.channel, expected.channel);
  }
  if (
    typeof feed.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(feed.generatedAt))
  ) {
    errors.push(`release generatedAt is invalid: ${formatValue(feed.generatedAt)}`);
  }
  if (!Array.isArray(feed.notes)) {
    errors.push("release notes are missing");
    return errors;
  }

  const ids = new Set();
  for (const [index, note] of feed.notes.entries()) {
    if (!note || typeof note !== "object" || Array.isArray(note)) {
      errors.push(`release note ${index} is not an object`);
      continue;
    }
    if (
      typeof note.id !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/.test(note.id)
    ) {
      errors.push(`release note ${index} id is invalid`);
    } else if (ids.has(note.id)) {
      errors.push(`release note id is duplicated: ${note.id}`);
    } else {
      ids.add(note.id);
    }
    if (
      typeof note.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(note.date)
    ) {
      errors.push(`release note ${index} date is invalid`);
    }
    if (typeof note.content !== "string" || !note.content.trim()) {
      errors.push(`release note ${index} content is invalid`);
    }
    if (
      typeof note.contentHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(note.contentHash)
    ) {
      errors.push(`release note ${index} contentHash is invalid`);
    }
  }
  return errors;
}

export async function verifyCloudflareDeployment({
  url,
  expected,
  fetchImpl = globalThis.fetch,
  attempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("deployment verification requires fetch");
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(`attempts must be a positive integer, got ${attempts}`);
  }

  const buildInfoEndpoint = createAssetUrl(url, "build-info.json");
  const releaseNotesEndpoint = createAssetUrl(url, "release-notes.json");
  let lastErrors = ["deployment verification did not run"];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const [buildInfo, releaseNotesFeed] = await Promise.all([
        fetchJsonAsset({
          endpoint: buildInfoEndpoint,
          fetchImpl,
          requestTimeoutMs,
          attempt,
          label: "build-info.json",
        }),
        fetchJsonAsset({
          endpoint: releaseNotesEndpoint,
          fetchImpl,
          requestTimeoutMs,
          attempt,
          label: "release-notes.json",
        }),
      ]);
      const errors = [
        ...validateDeploymentBuildInfo(buildInfo, expected),
        ...validateDeploymentReleaseNotesFeed(releaseNotesFeed, expected),
      ];
      if (errors.length === 0) {
        return {
          buildInfo,
          releaseNotesFeed,
          attempts: attempt,
          endpoints: {
            buildInfo: buildInfoEndpoint.href,
            releaseNotes: releaseNotesEndpoint.href,
          },
        };
      }
      lastErrors = errors;
    } catch (error) {
      lastErrors = [error instanceof Error ? error.message : String(error)];
    }

    log(
      `Deployment verification ${attempt}/${attempts} pending: ${lastErrors.join("; ")}`,
    );
    if (attempt < attempts && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  throw new Error(
    `Deployment verification failed for ${buildInfoEndpoint.origin}: ${lastErrors.join("; ")}`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const branch = readGit(["branch", "--show-current"]);
  const commitSha = readGit(["rev-parse", "HEAD"]);
  const upstreamSha = readGit(["rev-parse", "@{upstream}"]);
  const status = readGit(["status", "--porcelain", "--untracked-files=all"]);
  const contextErrors = validateDeployContext({
    channel: options.channel,
    branch,
    status,
    commitSha,
    upstreamSha,
  });
  contextErrors.push(
    ...validateRemoteRecognitionV1TestArmContext({
      expectedArm: options.remoteRecognitionV1TestArm,
      channel: options.channel,
      branch,
      commitSha,
      armValue: process.env.MAPLE_TIMER_REMOTE_RECOGNITION_V1_TEST_ARM,
      buildModeValue:
        process.env.MAPLE_TIMER_REMOTE_RECOGNITION_V1_TEST_BUILD_MODE,
      reviewedCommit:
        process.env.MAPLE_TIMER_REMOTE_RECOGNITION_V1_REVIEWED_COMMIT ?? "",
      reviewedBranch:
        process.env.MAPLE_TIMER_REMOTE_RECOGNITION_V1_REVIEWED_BRANCH ?? "",
    }),
  );
  if (contextErrors.length > 0) {
    throw new Error(`Deploy preflight failed: ${contextErrors.join("; ")}`);
  }
  if (!commitSha) {
    throw new Error("Deploy preflight failed: current git commit is unavailable");
  }

  if (options.preflight) {
    console.log(
      `Deploy preflight verified: channel=${options.channel} branch=${branch} commit=${commitSha.slice(0, 7)} remoteV1Arm=${options.remoteRecognitionV1TestArm} worktree=clean${options.channel === "production" ? " upstream=synced" : ""}`,
    );
    return;
  }
  if (!options.url) {
    throw new Error("Deployment verification requires --url");
  }

  const result = await verifyCloudflareDeployment({
    url: options.url,
    expected: {
      commitSha,
      branch,
      channel: options.channel,
      deploymentUrl: options.url,
      remoteRecognitionV1TestArm: options.remoteRecognitionV1TestArm,
    },
    attempts: options.attempts,
    delayMs: options.delayMs,
  });
  console.log(
    `Deployment verified: url=${normalizeUrl(options.url)} commit=${result.buildInfo.shortCommit} branch=${result.buildInfo.branch} channel=${result.buildInfo.channel} remoteV1Arm=${result.buildInfo.remoteRecognitionV1TestArm} releaseNotes=${result.releaseNotesFeed.notes.length} attempts=${result.attempts}`,
  );
}

function parseArgs(args) {
  const options = {
    preflight: false,
    url: null,
    channel: null,
    attempts: DEFAULT_ATTEMPTS,
    delayMs: DEFAULT_DELAY_MS,
    remoteRecognitionV1TestArm: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--preflight") {
      options.preflight = true;
      continue;
    }
    if (argument === "--url") {
      options.url = requireValue(args, ++index, argument);
      continue;
    }
    if (argument === "--channel") {
      options.channel = requireValue(args, ++index, argument);
      continue;
    }
    if (argument === "--attempts") {
      options.attempts = parsePositiveInteger(requireValue(args, ++index, argument), argument);
      continue;
    }
    if (argument === "--delay-ms") {
      options.delayMs = parseNonNegativeInteger(requireValue(args, ++index, argument), argument);
      continue;
    }
    if (argument === "--remote-recognition-v1-test-arm") {
      options.remoteRecognitionV1TestArm = parseBoolean(
        requireValue(args, ++index, argument),
        argument,
      );
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!VALID_CHANNELS.has(options.channel)) {
    throw new Error("--channel must be preview or production");
  }
  return options;
}

async function fetchJsonAsset({
  endpoint,
  fetchImpl,
  requestTimeoutMs,
  attempt,
  label,
}) {
  const requestUrl = new URL(endpoint);
  requestUrl.searchParams.set("deployment-verification", `${Date.now()}-${attempt}`);
  const controller = new AbortController();
  const timeoutId = requestTimeoutMs > 0
    ? setTimeout(() => controller.abort(), requestTimeoutMs)
    : null;

  try {
    const response = await fetchImpl(requestUrl, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${label} returned HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error(`${label} returned invalid JSON`);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} request timed out after ${requestTimeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function createAssetUrl(baseUrl, assetName) {
  const normalizedBase = new URL(baseUrl);
  if (!normalizedBase.pathname.endsWith("/")) {
    normalizedBase.pathname += "/";
  }
  return new URL(assetName, normalizedBase);
}

function compareField(errors, field, actual, expected) {
  if (actual !== expected) {
    errors.push(`${field} expected ${formatValue(expected)}, got ${formatValue(actual)}`);
  }
}

function formatValue(value) {
  return JSON.stringify(value ?? null);
}

function normalizeUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

function requireValue(args, index, argument) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${argument} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value, argument) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${argument} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, argument) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${argument} must be a non-negative integer`);
  }
  return parsed;
}

function parseBoolean(value, argument) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${argument} must be true or false`);
}

function readGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
