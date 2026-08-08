import type { AppBuildInfo } from "../../src/contracts/deployment/appBuildInfo";
import { isValidRemoteRecognitionV1ReviewedBranch } from "../../src/contracts/deployment/remoteRecognitionV1TestArm";

const FULL_LOWERCASE_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const REVIEWED_PREVIEW_DEPLOYMENT_URL = "https://preview.maple-timer.pages.dev";

export type RemoteRecognitionV1SemanticLabBuildGateInput = {
  command: "build" | "serve";
  buildInfo: Pick<
    AppBuildInfo,
    "branch" | "channel" | "commitSha" | "deploymentUrl"
  >;
  gitCommitSha: string;
  gitBranch: string;
  gitStatus: string;
  requestedValue: string | undefined;
  modeValue: string | undefined;
  reviewedCommit: string;
  reviewedBranch: string;
  remoteRecognitionV1TestArm: boolean;
  apiBaseUrl: string | undefined;
  testOnly?: boolean;
};

export function resolveRemoteRecognitionV1SemanticLabBuildGate({
  command,
  buildInfo,
  gitCommitSha,
  gitBranch,
  gitStatus,
  requestedValue,
  modeValue,
  reviewedCommit,
  reviewedBranch,
  remoteRecognitionV1TestArm,
  apiBaseUrl,
  testOnly = false,
}: RemoteRecognitionV1SemanticLabBuildGateInput): boolean {
  if (requestedValue !== "1" || buildInfo.channel === "production") {
    return false;
  }

  if (
    command === "serve" &&
    testOnly &&
    modeValue === "synthetic-test"
  ) {
    return (
      buildInfo.channel === "local" && isExactLoopbackApiBaseUrl(apiBaseUrl)
    );
  }

  if (!hasExactReviewedSourceIdentity({
    buildInfo,
    gitCommitSha,
    gitBranch,
    gitStatus,
    reviewedCommit,
    reviewedBranch,
  })) {
    return false;
  }

  if (command === "serve") {
    return (
      buildInfo.channel === "local" &&
      modeValue === "local-semantic-lab" &&
      isExactLoopbackApiBaseUrl(apiBaseUrl)
    );
  }

  if (
    buildInfo.channel === "local" &&
    buildInfo.deploymentUrl === null &&
    modeValue === "local-semantic-lab" &&
    isExactLoopbackApiBaseUrl(apiBaseUrl)
  ) {
    return true;
  }

  return (
    buildInfo.channel === "preview" &&
    normalizeUrl(buildInfo.deploymentUrl) ===
      REVIEWED_PREVIEW_DEPLOYMENT_URL &&
    modeValue === "reviewed-preview-semantic-lab" &&
    remoteRecognitionV1TestArm
  );
}

function hasExactReviewedSourceIdentity({
  buildInfo,
  gitCommitSha,
  gitBranch,
  gitStatus,
  reviewedCommit,
  reviewedBranch,
}: Pick<
  RemoteRecognitionV1SemanticLabBuildGateInput,
  | "buildInfo"
  | "gitCommitSha"
  | "gitBranch"
  | "gitStatus"
  | "reviewedCommit"
  | "reviewedBranch"
>): boolean {
  return (
    gitStatus.trim() === "" &&
    FULL_LOWERCASE_COMMIT_PATTERN.test(reviewedCommit) &&
    reviewedCommit === gitCommitSha &&
    reviewedCommit === buildInfo.commitSha &&
    isValidRemoteRecognitionV1ReviewedBranch(reviewedBranch) &&
    reviewedBranch === gitBranch &&
    reviewedBranch === buildInfo.branch
  );
}

export function isExactLoopbackApiBaseUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.port !== ""
    );
  } catch {
    return false;
  }
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}
