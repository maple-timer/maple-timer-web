#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_ACCOUNT_ID = "6bc2831899fbc0c8292aac3a558e18e4";
const DEFAULT_PROJECT_NAME = "maple-timer";
const DEFAULT_KEEP_PRODUCTION = 10;
const DEFAULT_KEEP_PREVIEW_PER_BRANCH = 1;
const DEFAULT_ENV_FILE = join(homedir(), ".config", "maple-timer", "cloudflare.env");
const API_BASE_URL = "https://api.cloudflare.com/client/v4";
const PAGE_SIZE = 25;

function parseArgs(argv) {
  const options = {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID,
    projectName: process.env.CLOUDFLARE_PAGES_PROJECT || DEFAULT_PROJECT_NAME,
    keepProduction: DEFAULT_KEEP_PRODUCTION,
    keepPreviewPerBranch: DEFAULT_KEEP_PREVIEW_PER_BRANCH,
    envFile: process.env.MAPLE_TIMER_CLOUDFLARE_ENV_FILE || DEFAULT_ENV_FILE,
    execute: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--execute") {
      options.execute = true;
    } else if (arg === "--account-id" && next) {
      options.accountId = next;
      index += 1;
    } else if (arg === "--project-name" && next) {
      options.projectName = next;
      index += 1;
    } else if (arg === "--keep-production" && next) {
      options.keepProduction = Number(next);
      index += 1;
    } else if (arg === "--keep-preview-per-branch" && next) {
      options.keepPreviewPerBranch = Number(next);
      index += 1;
    } else if (arg === "--env-file" && next) {
      options.envFile = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.keepProduction) || options.keepProduction < 1) {
    throw new Error("--keep-production must be a positive integer.");
  }
  if (!Number.isInteger(options.keepPreviewPerBranch) || options.keepPreviewPerBranch < 1) {
    throw new Error("--keep-preview-per-branch must be a positive integer.");
  }

  return options;
}

function printHelp() {
  console.log(`Usage: npm run cleanup:cloudflare-deployments -- [options]

Options:
  --execute                         Delete deployments. Without this, only prints a dry run.
  --account-id <id>                 Cloudflare account ID.
  --project-name <name>             Cloudflare Pages project name.
  --keep-production <count>         Production deployments to keep. Default: ${DEFAULT_KEEP_PRODUCTION}
  --keep-preview-per-branch <count> Preview deployments to keep per branch. Default: ${DEFAULT_KEEP_PREVIEW_PER_BRANCH}
  --env-file <path>                 Env file containing CLOUDFLARE_API_TOKEN.
`);
}

function parseShellValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\\(.)/g, "$1");
}

function loadToken(envFile) {
  if (process.env.CLOUDFLARE_API_TOKEN) {
    return process.env.CLOUDFLARE_API_TOKEN;
  }

  if (!existsSync(envFile)) {
    return "";
  }

  const contents = readFileSync(envFile, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^(?:export\s+)?CLOUDFLARE_API_TOKEN=(.+)$/);
    if (match) {
      return parseShellValue(match[1]);
    }
  }
  return "";
}

function getDeploymentBranch(deployment) {
  return deployment.deployment_trigger?.metadata?.branch || deployment.branch || "unknown";
}

function getDeploymentCommit(deployment) {
  const hash = deployment.deployment_trigger?.metadata?.commit_hash || deployment.source || "";
  return hash ? hash.slice(0, 7) : "unknown";
}

function getDeploymentCreatedAt(deployment) {
  return deployment.created_on || deployment.createdOn || "";
}

function compareDeploymentNewestFirst(left, right) {
  return new Date(getDeploymentCreatedAt(right)).getTime() - new Date(getDeploymentCreatedAt(left)).getTime();
}

function getKeepSet(deployments, keepProduction, keepPreviewPerBranch) {
  const keepIds = new Set();
  const production = deployments
    .filter((deployment) => deployment.environment === "production")
    .sort(compareDeploymentNewestFirst);
  for (const deployment of production.slice(0, keepProduction)) {
    keepIds.add(deployment.id);
  }

  const previewByBranch = new Map();
  for (const deployment of deployments.filter((item) => item.environment === "preview")) {
    const branch = getDeploymentBranch(deployment);
    const branchDeployments = previewByBranch.get(branch) || [];
    branchDeployments.push(deployment);
    previewByBranch.set(branch, branchDeployments);
  }
  for (const branchDeployments of previewByBranch.values()) {
    branchDeployments.sort(compareDeploymentNewestFirst);
    for (const deployment of branchDeployments.slice(0, keepPreviewPerBranch)) {
      keepIds.add(deployment.id);
    }
  }

  return keepIds;
}

async function cloudflareRequest(token, path, init = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success === false) {
    const errors = body?.errors?.map((error) => error.message).join("; ") || response.statusText;
    throw new Error(`${init.method || "GET"} ${path} failed: ${errors}`);
  }
  return body;
}

async function listDeployments({ token, accountId, projectName }) {
  const deployments = [];
  let page = 1;
  let totalPages = 1;

  do {
    const body = await cloudflareRequest(
      token,
      `/accounts/${accountId}/pages/projects/${projectName}/deployments?per_page=${PAGE_SIZE}&page=${page}`,
    );
    deployments.push(...(body.result || []));
    totalPages = body.result_info?.total_pages || 1;
    page += 1;
  } while (page <= totalPages);

  return deployments;
}

async function deleteDeployment({ token, accountId, projectName, deploymentId }) {
  await cloudflareRequest(
    token,
    `/accounts/${accountId}/pages/projects/${projectName}/deployments/${deploymentId}`,
    { method: "DELETE" },
  );
}

function summarize(deployments, deleteCandidates, keepProduction, keepPreviewPerBranch) {
  const productionCount = deployments.filter((deployment) => deployment.environment === "production").length;
  const previewCount = deployments.filter((deployment) => deployment.environment === "preview").length;
  const deleteProductionCount = deleteCandidates.filter((deployment) => deployment.environment === "production").length;
  const deletePreviewCount = deleteCandidates.filter((deployment) => deployment.environment === "preview").length;

  console.log(
    `Cloudflare Pages deployments: ${deployments.length} total (${productionCount} production, ${previewCount} preview)`,
  );
  console.log(
    `Policy: keep latest ${keepProduction} production and latest ${keepPreviewPerBranch} preview per branch.`,
  );
  console.log(
    `Delete candidates: ${deleteCandidates.length} total (${deleteProductionCount} production, ${deletePreviewCount} preview)`,
  );

  if (deleteCandidates.length === 0) {
    return;
  }

  console.table(
    deleteCandidates.slice(0, 30).map((deployment) => ({
      environment: deployment.environment,
      branch: getDeploymentBranch(deployment),
      commit: getDeploymentCommit(deployment),
      created: getDeploymentCreatedAt(deployment),
      id: deployment.id,
    })),
  );
  if (deleteCandidates.length > 30) {
    console.log(`...and ${deleteCandidates.length - 30} more`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = loadToken(options.envFile);
  if (!token) {
    throw new Error(
      `CLOUDFLARE_API_TOKEN is not set. Put it in the environment or ${options.envFile}.`,
    );
  }

  const deployments = await listDeployments({ ...options, token });
  deployments.sort(compareDeploymentNewestFirst);
  const keepIds = getKeepSet(deployments, options.keepProduction, options.keepPreviewPerBranch);
  const deleteCandidates = deployments.filter((deployment) => !keepIds.has(deployment.id));

  summarize(deployments, deleteCandidates, options.keepProduction, options.keepPreviewPerBranch);

  if (!options.execute) {
    console.log("Dry run only. Re-run with --execute to delete candidates.");
    return;
  }

  for (const deployment of deleteCandidates) {
    process.stdout.write(`Deleting ${deployment.environment} ${deployment.id} (${getDeploymentCommit(deployment)})... `);
    await deleteDeployment({
      ...options,
      token,
      deploymentId: deployment.id,
    });
    console.log("deleted");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
