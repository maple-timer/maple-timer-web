import type { AppBuildInfo } from "../../contracts/deployment/appBuildInfo";

export type RuntimeAssetHealthStatus = "current" | "update-available" | "update-required";

export type RuntimeAssetFailureSource = "worker" | "dynamic-import" | "render";

export type RuntimeAssetFailure = {
  source: RuntimeAssetFailureSource;
  feature: string;
  code: string;
  message: string;
  occurredAt: string;
};

export type RuntimeBuildCheckReason =
  | "startup"
  | "interval"
  | "visibility"
  | "capture-start"
  | "capture-change"
  | "worker"
  | "dynamic-import"
  | "render"
  | "manual";

export type RuntimeAssetHealthSnapshot = {
  status: RuntimeAssetHealthStatus;
  runningBuild: AppBuildInfo;
  latestBuild: AppBuildInfo | null;
  lastFailure: RuntimeAssetFailure | null;
  lastCheckedAt: string | null;
  lastCheckReason: RuntimeBuildCheckReason | null;
  lastCheckError: string | null;
};

type RuntimeAssetHealthControllerOptions = {
  runningBuild: AppBuildInfo;
  fetchLatestBuild: () => Promise<AppBuildInfo>;
  now?: () => Date;
};

type RuntimeBuildCheckOptions = {
  reason: RuntimeBuildCheckReason;
  force?: boolean;
  maxAgeMs?: number;
};

export function isSameRuntimeBuild(first: AppBuildInfo, second: AppBuildInfo): boolean {
  return (
    first.commitSha === second.commitSha &&
    first.buildTime === second.buildTime &&
    first.channel === second.channel &&
    first.remoteRecognitionV1TestArm === second.remoteRecognitionV1TestArm
  );
}

export function createRuntimeAssetHealthController({
  runningBuild,
  fetchLatestBuild,
  now = () => new Date(),
}: RuntimeAssetHealthControllerOptions) {
  let snapshot: RuntimeAssetHealthSnapshot = {
    status: "current",
    runningBuild,
    latestBuild: null,
    lastFailure: null,
    lastCheckedAt: null,
    lastCheckReason: null,
    lastCheckError: null,
  };
  let pendingCheck: Promise<RuntimeAssetHealthSnapshot> | null = null;
  const listeners = new Set<() => void>();

  const emit = (next: RuntimeAssetHealthSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const isComparable = () =>
    runningBuild.channel !== "local" &&
    runningBuild.commitSha !== "unknown" &&
    runningBuild.buildTime !== "unknown";

  const check = async ({
    reason,
    force = false,
    maxAgeMs = 0,
  }: RuntimeBuildCheckOptions): Promise<RuntimeAssetHealthSnapshot> => {
    if (!isComparable()) {
      return snapshot;
    }

    const checkedAt = snapshot.lastCheckedAt ? Date.parse(snapshot.lastCheckedAt) : Number.NaN;
    if (
      !force &&
      maxAgeMs > 0 &&
      Number.isFinite(checkedAt) &&
      now().getTime() - checkedAt < maxAgeMs
    ) {
      return snapshot;
    }

    if (pendingCheck) {
      return pendingCheck;
    }

    pendingCheck = (async () => {
      try {
        const latestBuild = await fetchLatestBuild();
        const hasVersionSkew = !isSameRuntimeBuild(runningBuild, latestBuild);
        const status: RuntimeAssetHealthStatus = hasVersionSkew
          ? snapshot.lastFailure
            ? "update-required"
            : "update-available"
          : "current";
        emit({
          ...snapshot,
          status,
          latestBuild,
          lastCheckedAt: now().toISOString(),
          lastCheckReason: reason,
          lastCheckError: null,
        });
      } catch (error) {
        emit({
          ...snapshot,
          lastCheckedAt: now().toISOString(),
          lastCheckReason: reason,
          lastCheckError: getErrorMessage(error),
        });
      } finally {
        pendingCheck = null;
      }
      return snapshot;
    })();

    return pendingCheck;
  };

  const reportFailure = (failure: Omit<RuntimeAssetFailure, "occurredAt">) => {
    const latestBuild = snapshot.latestBuild;
    const hasKnownVersionSkew = Boolean(
      latestBuild && !isSameRuntimeBuild(runningBuild, latestBuild),
    );
    emit({
      ...snapshot,
      status: hasKnownVersionSkew ? "update-required" : snapshot.status,
      lastFailure: {
        ...failure,
        occurredAt: now().toISOString(),
      },
    });
    void check({
      reason: failure.source,
      force: true,
    });
  };

  const clearFailure = (feature?: string) => {
    if (!snapshot.lastFailure || (feature && snapshot.lastFailure.feature !== feature)) {
      return;
    }
    const latestBuild = snapshot.latestBuild;
    emit({
      ...snapshot,
      status:
        latestBuild && !isSameRuntimeBuild(runningBuild, latestBuild)
          ? "update-available"
          : "current",
      lastFailure: null,
    });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    check,
    reportFailure,
    clearFailure,
  };
}

export type RuntimeAssetHealthController = ReturnType<
  typeof createRuntimeAssetHealthController
>;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return typeof error === "string" && error ? error : "unknown runtime asset error";
}
