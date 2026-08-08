import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppBuildInfo } from "../../contracts/deployment/appBuildInfo";
import type { RuntimeAssetHealthController } from "../../runtime/runtime-assets/runtimeAssetHealthController";
import {
  fetchLatestBuildInfo,
  installRuntimeAssetHealthMonitoring,
} from "./browserRuntimeAssetHealth";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browserRuntimeAssetHealth", () => {
  it("fetches and validates the uncached same-origin build identity", async () => {
    const build: AppBuildInfo = {
      name: "maple-timer",
      version: "0.1.0",
      commitSha: "commit",
      shortCommit: "commit",
      branch: "main",
      deploymentUrl: "https://maple-timer.com",
      buildTime: "2026-07-16T00:00:00.000Z",
      channel: "production",
      remoteRecognitionV1TestArm: false,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(build),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLatestBuildInfo()).resolves.toEqual(build);
    expect(fetchMock).toHaveBeenCalledWith(
      "/build-info.json",
      expect.objectContaining({
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("installs startup, visibility, interval, and preload-error monitoring once", () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const controller = {
      check: vi.fn().mockResolvedValue(undefined),
      reportFailure: vi.fn(),
    } as unknown as RuntimeAssetHealthController;

    installRuntimeAssetHealthMonitoring(controller);
    installRuntimeAssetHealthMonitoring(controller);

    expect(controller.check).toHaveBeenCalledTimes(1);
    expect(controller.check).toHaveBeenCalledWith({ reason: "startup", force: true });

    document.dispatchEvent(new Event("visibilitychange"));
    expect(controller.check).toHaveBeenCalledWith({ reason: "visibility", force: true });

    vi.advanceTimersByTime(5 * 60_000);
    expect(controller.check).toHaveBeenCalledWith({ reason: "interval", force: true });

    const preloadError = Object.assign(new Event("vite:preloadError", { cancelable: true }), {
      payload: new Error("chunk 404"),
    });
    window.dispatchEvent(preloadError);

    expect(preloadError.defaultPrevented).toBe(true);
    expect(controller.reportFailure).toHaveBeenCalledWith({
      source: "dynamic-import",
      feature: "vite-preload",
      code: "dynamic-import-load-failed",
      message: "chunk 404",
    });
  });
});
