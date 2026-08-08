import {
  parseAppBuildInfo,
  type AppBuildInfo,
} from "../../contracts/deployment/appBuildInfo";
import {
  createRuntimeAssetHealthController,
  type RuntimeAssetFailure,
  type RuntimeAssetHealthController,
  type RuntimeAssetHealthSnapshot,
} from "../../runtime/runtime-assets/runtimeAssetHealthController";
import { appBuildInfo } from "../runtime-build/currentAppBuildInfo";

const CHECK_INTERVAL_MS = 5 * 60_000;
const ACTION_CHECK_MAX_AGE_MS = 60_000;
const BUILD_INFO_TIMEOUT_MS = 3_000;

export async function fetchLatestBuildInfo(): Promise<AppBuildInfo> {
  const abortController = new AbortController();
  const timeoutId = window.setTimeout(() => abortController.abort(), BUILD_INFO_TIMEOUT_MS);

  try {
    const response = await fetch("/build-info.json", {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new Error(`build-info request failed (${response.status})`);
    }
    const parsed = parseAppBuildInfo(await response.json());
    if (!parsed) {
      throw new Error("build-info response is invalid");
    }
    return parsed;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const runtimeAssetHealthController = createRuntimeAssetHealthController({
  runningBuild: appBuildInfo,
  fetchLatestBuild: fetchLatestBuildInfo,
});

export function reportRuntimeAssetFailure(
  failure: Omit<RuntimeAssetFailure, "occurredAt">,
) {
  runtimeAssetHealthController.reportFailure(failure);
}

export function clearRuntimeAssetFailure(feature?: string) {
  runtimeAssetHealthController.clearFailure(feature);
}

export function getRuntimeAssetHealthReportSnapshot(): RuntimeAssetHealthSnapshot {
  const snapshot = runtimeAssetHealthController.getSnapshot();
  return {
    ...snapshot,
    runningBuild: { ...snapshot.runningBuild },
    latestBuild: snapshot.latestBuild ? { ...snapshot.latestBuild } : null,
    lastFailure: snapshot.lastFailure ? { ...snapshot.lastFailure } : null,
  };
}

export async function ensureCurrentRuntimeBeforeAction(
  reason: "capture-start" | "capture-change",
): Promise<boolean> {
  const snapshot = await runtimeAssetHealthController.check({
    reason,
    maxAgeMs: ACTION_CHECK_MAX_AGE_MS,
  });
  return snapshot.status === "current";
}

let monitoringInstalled = false;

export function installRuntimeAssetHealthMonitoring(
  controller: RuntimeAssetHealthController = runtimeAssetHealthController,
) {
  if (monitoringInstalled || typeof window === "undefined") {
    return;
  }
  monitoringInstalled = true;

  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    const payload = (event as Event & { payload?: unknown }).payload;
    controller.reportFailure({
      source: "dynamic-import",
      feature: "vite-preload",
      code: "dynamic-import-load-failed",
      message: getErrorMessage(payload),
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void controller.check({ reason: "visibility", force: true });
    }
  });

  window.setInterval(() => {
    void controller.check({ reason: "interval", force: true });
  }, CHECK_INTERVAL_MS);

  void controller.check({ reason: "startup", force: true });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return typeof error === "string" && error ? error : "unknown runtime asset error";
}
