/// <reference types="node" />

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createReleaseNotesFeed } from "./scripts/release-notes-feed";
import { resolveRemoteRecognitionV1ClientTestBuildArm } from "./scripts/remote-recognition-v1/client-test-build-arm";
import { resolveRemoteRecognitionV1SemanticLabBuildGate } from "./scripts/remote-recognition-v1/semantic-lab-build-gate";
import {
  SEMANTIC_LAB_VITE_FS_DENY,
  createRemoteRecognitionV1SemanticLabViteGuard,
} from "./scripts/remote-recognition-v1/semantic-lab-vite-guard";
import type {
  AppBuildChannel,
  AppBuildInfo,
} from "./src/contracts/deployment/appBuildInfo";
import { PATCH_NOTES } from "./src/lib/patchNotes";

function readGit(args: string[]): Readonly<{ ok: boolean; output: string }> {
  try {
    const output = execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return Object.freeze({ ok: true, output });
  } catch {
    return Object.freeze({ ok: false, output: "" });
  }
}

function getBuildChannel(branch: string): AppBuildChannel {
  const explicit = process.env.VITE_APP_CHANNEL;
  if (
    explicit === "local" ||
    explicit === "preview" ||
    explicit === "production"
  ) {
    return explicit;
  }

  if (process.env.CF_PAGES === "1") {
    return branch === "main" ? "production" : "preview";
  }

  return "local";
}

function createAppBuildInfo({
  gitCommitSha,
  gitBranch,
}: {
  gitCommitSha: string;
  gitBranch: string;
}): AppBuildInfo {
  const commitSha =
    process.env.VITE_APP_COMMIT_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    gitCommitSha ||
    "unknown";
  const branch =
    process.env.VITE_APP_BRANCH ||
    process.env.CF_PAGES_BRANCH ||
    gitBranch ||
    "unknown";
  const deploymentUrl =
    process.env.VITE_APP_DEPLOYMENT_URL || process.env.CF_PAGES_URL || null;

  return {
    name: "maple-timer",
    version: process.env.npm_package_version || "0.1.0",
    commitSha,
    shortCommit: commitSha === "unknown" ? "unknown" : commitSha.slice(0, 7),
    branch,
    deploymentUrl,
    buildTime: process.env.VITE_APP_BUILD_TIME || new Date().toISOString(),
    channel: getBuildChannel(branch),
    remoteRecognitionV1TestArm: false,
  };
}

function appBuildInfoPlugin(appBuildInfo: AppBuildInfo): Plugin {
  const releaseNotesFeed = createReleaseNotesFeed(appBuildInfo, PATCH_NOTES);
  return {
    name: "maple-timer-build-info",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "build-info.json",
        source: `${JSON.stringify(appBuildInfo, null, 2)}\n`,
      });
      this.emitFile({
        type: "asset",
        fileName: "release-notes.json",
        source: `${JSON.stringify(releaseNotesFeed, null, 2)}\n`,
      });
    },
  };
}

function googleAnalyticsHtmlPlugin(): Plugin {
  return {
    name: "maple-timer-google-analytics-html",
    transformIndexHtml(html) {
      return html
        .split("__MAPLE_TIMER_GA_MEASUREMENT_ID__")
        .join(process.env.VITE_GA_MEASUREMENT_ID?.trim() ?? "");
    },
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
export default defineConfig(({ command }) => {
  const gitCommitRead = readGit(["rev-parse", "HEAD"]);
  const gitBranchRead = readGit(["branch", "--show-current"]);
  const gitStatusRead = readGit([
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
  const gitCommitSha = gitCommitRead.ok ? gitCommitRead.output : "";
  const gitBranch = gitBranchRead.ok ? gitBranchRead.output : "";
  const gitStatus = gitStatusRead.ok
    ? gitStatusRead.output
    : "__MAPLE_TIMER_GIT_STATUS_UNAVAILABLE__";
  const baseAppBuildInfo = createAppBuildInfo({ gitCommitSha, gitBranch });
  const remoteRecognitionV1ReviewedCommit =
    process.env.MAPLE_TIMER_REMOTE_RECOGNITION_V1_REVIEWED_COMMIT ?? "";
  const remoteRecognitionV1ReviewedBranch =
    process.env.MAPLE_TIMER_REMOTE_RECOGNITION_V1_REVIEWED_BRANCH ?? "";
  const remoteRecognitionV1TestArm =
    resolveRemoteRecognitionV1ClientTestBuildArm({
      command,
      buildInfo: baseAppBuildInfo,
      gitCommitSha,
      gitBranch,
      gitStatus,
      armValue: process.env.MAPLE_TIMER_REMOTE_RECOGNITION_V1_TEST_ARM,
      buildModeValue:
        process.env.MAPLE_TIMER_REMOTE_RECOGNITION_V1_TEST_BUILD_MODE,
      reviewedCommit: remoteRecognitionV1ReviewedCommit,
      reviewedBranch: remoteRecognitionV1ReviewedBranch,
    });
  const appBuildInfo: AppBuildInfo = {
    ...baseAppBuildInfo,
    remoteRecognitionV1TestArm,
  };
  const remoteRecognitionV1SemanticLab =
    resolveRemoteRecognitionV1SemanticLabBuildGate({
      command,
      buildInfo: appBuildInfo,
      gitCommitSha,
      gitBranch,
      gitStatus,
      requestedValue:
        process.env.MAPLE_TIMER_REMOTE_RECOGNITION_V1_SEMANTIC_LAB,
      modeValue:
        process.env.MAPLE_TIMER_REMOTE_RECOGNITION_V1_SEMANTIC_LAB_MODE,
      reviewedCommit: remoteRecognitionV1ReviewedCommit,
      reviewedBranch: remoteRecognitionV1ReviewedBranch,
      remoteRecognitionV1TestArm,
      apiBaseUrl: process.env.VITE_MAPLE_TIMER_API_BASE_URL,
      testOnly:
        process.env.NODE_ENV === "test" &&
        process.env
          .MAPLE_TIMER_REMOTE_RECOGNITION_V1_SEMANTIC_LAB_TEST_ONLY === "1",
    });

  return {
    define: {
      __APP_BUILD_INFO__: JSON.stringify(appBuildInfo),
      __REMOTE_RECOGNITION_V1_TEST_ARM__: JSON.stringify(
        remoteRecognitionV1TestArm,
      ),
      __REMOTE_RECOGNITION_V1_REVIEWED_COMMIT__: JSON.stringify(
        remoteRecognitionV1ReviewedCommit,
      ),
      __REMOTE_RECOGNITION_V1_REVIEWED_BRANCH__: JSON.stringify(
        remoteRecognitionV1ReviewedBranch,
      ),
      __REMOTE_RECOGNITION_V1_SEMANTIC_LAB__: JSON.stringify(
        remoteRecognitionV1SemanticLab,
      ),
    },
    plugins: [
      createRemoteRecognitionV1SemanticLabViteGuard(
        remoteRecognitionV1SemanticLab,
      ),
      react(),
      appBuildInfoPlugin(appBuildInfo),
      googleAnalyticsHtmlPlugin(),
    ],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          troubleshooter: resolve(
            __dirname,
            "debug-tools/timer-report-troubleshooter.html",
          ),
          ...(remoteRecognitionV1SemanticLab
            ? {
                remoteRecognitionV1SemanticLab: resolve(
                  __dirname,
                  "remote-recognition-v1-semantic-lab.html",
                ),
              }
            : {}),
        },
      },
    },
    server: {
      host: "127.0.0.1",
      allowedHosts: ["127.0.0.1"],
      fs: {
        strict: true,
        deny: [...SEMANTIC_LAB_VITE_FS_DENY],
      },
    },
    worker: {
      format: "es",
    },
  };
});
