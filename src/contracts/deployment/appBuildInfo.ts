export type AppBuildChannel = "local" | "preview" | "production";

export type AppBuildInfo = {
  name: string;
  version: string;
  commitSha: string;
  shortCommit: string;
  branch: string;
  deploymentUrl: string | null;
  buildTime: string;
  channel: AppBuildChannel;
  remoteRecognitionV1TestArm: boolean;
};

export type AppBuildReportInfo = AppBuildInfo & {
  runtimeOrigin: string | null;
  runtimeHostname: string | null;
};

const FALLBACK_BUILD_INFO: AppBuildInfo = {
  name: "maple-timer",
  version: "0.1.0",
  commitSha: "unknown",
  shortCommit: "unknown",
  branch: "unknown",
  deploymentUrl: null,
  buildTime: "unknown",
  channel: "local",
  remoteRecognitionV1TestArm: false,
};

export function parseAppBuildInfo(value: unknown): AppBuildInfo | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<AppBuildInfo>;
  if (
    typeof record.commitSha !== "string" ||
    !record.commitSha ||
    typeof record.buildTime !== "string" ||
    !record.buildTime
  ) {
    return null;
  }

  const channel =
    record.channel === "preview" || record.channel === "production" || record.channel === "local"
      ? record.channel
      : "local";
  const commitSha = record.commitSha;
  const shortCommit =
    typeof record.shortCommit === "string" && record.shortCommit
      ? record.shortCommit
      : commitSha === "unknown"
        ? "unknown"
        : commitSha.slice(0, 7);

  return {
    name: typeof record.name === "string" && record.name ? record.name : FALLBACK_BUILD_INFO.name,
    version:
      typeof record.version === "string" && record.version
        ? record.version
        : FALLBACK_BUILD_INFO.version,
    commitSha,
    shortCommit,
    branch:
      typeof record.branch === "string" && record.branch
        ? record.branch
        : FALLBACK_BUILD_INFO.branch,
    deploymentUrl:
      typeof record.deploymentUrl === "string" && record.deploymentUrl
        ? record.deploymentUrl
        : null,
    buildTime:
      typeof record.buildTime === "string" && record.buildTime
        ? record.buildTime
        : FALLBACK_BUILD_INFO.buildTime,
    channel,
    remoteRecognitionV1TestArm: record.remoteRecognitionV1TestArm === true,
  };
}

export function normalizeAppBuildInfo(value: unknown): AppBuildInfo {
  return parseAppBuildInfo(value) ?? FALLBACK_BUILD_INFO;
}

export function formatAppBuildInfo(info: AppBuildInfo): string {
  const branchAndCommit =
    info.shortCommit === "unknown" ? info.branch : `${info.branch}@${info.shortCommit}`;
  return `${info.channel} ${branchAndCommit}`;
}
