import type { AppBuildInfo } from "../../src/contracts/deployment/appBuildInfo";
import { isValidRemoteRecognitionV1ReviewedBranch } from "../../src/contracts/deployment/remoteRecognitionV1TestArm";

const FULL_LOWERCASE_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const REVIEWED_PREVIEW_DEPLOYMENT_URL = "https://preview.maple-timer.pages.dev";

export type RemoteRecognitionV1ClientTestBuildArmInput = {
  command: "build" | "serve";
  buildInfo: Pick<
    AppBuildInfo,
    "branch" | "channel" | "commitSha" | "deploymentUrl"
  >;
  gitCommitSha: string;
  gitBranch: string;
  gitStatus: string;
  armValue: string | undefined;
  buildModeValue: string | undefined;
  reviewedCommit: string;
  reviewedBranch: string;
};

export function resolveRemoteRecognitionV1ClientTestBuildArm({
  command,
  buildInfo,
  gitCommitSha,
  gitBranch,
  gitStatus,
  armValue,
  buildModeValue,
  reviewedCommit,
  reviewedBranch,
}: RemoteRecognitionV1ClientTestBuildArmInput): boolean {
  return (
    command === "build" &&
    gitStatus.trim() === "" &&
    buildInfo.channel === "preview" &&
    normalizeUrl(buildInfo.deploymentUrl) === REVIEWED_PREVIEW_DEPLOYMENT_URL &&
    armValue === "1" &&
    buildModeValue === "reviewed-preview" &&
    FULL_LOWERCASE_COMMIT_PATTERN.test(reviewedCommit) &&
    gitCommitSha === reviewedCommit &&
    reviewedCommit === buildInfo.commitSha &&
    isValidRemoteRecognitionV1ReviewedBranch(reviewedBranch) &&
    gitBranch === reviewedBranch &&
    reviewedBranch === buildInfo.branch
  );
}

function normalizeUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}
