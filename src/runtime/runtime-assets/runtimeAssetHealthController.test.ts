import { describe, expect, it, vi } from "vitest";
import type { AppBuildInfo } from "../../contracts/deployment/appBuildInfo";
import {
  createRuntimeAssetHealthController,
  isSameRuntimeBuild,
} from "./runtimeAssetHealthController";

const RUNNING_BUILD = createBuild({
  commitSha: "old-commit",
  buildTime: "2026-07-12T00:00:00.000Z",
});

describe("runtimeAssetHealth", () => {
  it("treats a rebuild of the same commit as a different runtime", () => {
    expect(
      isSameRuntimeBuild(
        RUNNING_BUILD,
        createBuild({
          commitSha: RUNNING_BUILD.commitSha,
          buildTime: "2026-07-12T00:05:00.000Z",
        }),
      ),
    ).toBe(false);
  });

  it("treats armed and unarmed remote V1 artifacts as different runtimes", () => {
    expect(
      isSameRuntimeBuild(
        RUNNING_BUILD,
        createBuild({
          commitSha: RUNNING_BUILD.commitSha,
          buildTime: RUNNING_BUILD.buildTime,
          remoteRecognitionV1TestArm: true,
        }),
      ),
    ).toBe(false);
  });

  it("marks a newer deployment as available without interrupting the current session", async () => {
    const latestBuild = createBuild({
      commitSha: "new-commit",
      buildTime: "2026-07-12T00:05:00.000Z",
    });
    const controller = createRuntimeAssetHealthController({
      runningBuild: RUNNING_BUILD,
      fetchLatestBuild: vi.fn().mockResolvedValue(latestBuild),
      now: () => new Date("2026-07-12T00:06:00.000Z"),
    });

    await controller.check({ reason: "startup", force: true });

    expect(controller.getSnapshot()).toMatchObject({
      status: "update-available",
      latestBuild,
      lastFailure: null,
      lastCheckReason: "startup",
    });
  });

  it("requires an update when a runtime asset fails after version skew is known", async () => {
    const controller = createRuntimeAssetHealthController({
      runningBuild: RUNNING_BUILD,
      fetchLatestBuild: vi.fn().mockResolvedValue(
        createBuild({
          commitSha: "new-commit",
          buildTime: "2026-07-12T00:05:00.000Z",
        }),
      ),
      now: () => new Date("2026-07-12T00:06:00.000Z"),
    });
    await controller.check({ reason: "startup", force: true });

    controller.reportFailure({
      source: "worker",
      feature: "rune",
      code: "worker-load-failed",
      message: "404",
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: "update-required",
      lastFailure: {
        source: "worker",
        feature: "rune",
        code: "worker-load-failed",
        message: "404",
      },
    });
  });

  it("keeps the last confirmed version state when build-info cannot be fetched", async () => {
    const fetchLatestBuild = vi
      .fn()
      .mockResolvedValueOnce(
        createBuild({
          commitSha: "new-commit",
          buildTime: "2026-07-12T00:05:00.000Z",
        }),
      )
      .mockRejectedValueOnce(new Error("offline"));
    const controller = createRuntimeAssetHealthController({
      runningBuild: RUNNING_BUILD,
      fetchLatestBuild,
      now: () => new Date("2026-07-12T00:06:00.000Z"),
    });
    await controller.check({ reason: "startup", force: true });

    await controller.check({ reason: "visibility", force: true });

    expect(controller.getSnapshot()).toMatchObject({
      status: "update-available",
      lastCheckReason: "visibility",
      lastCheckError: "offline",
    });
  });

  it("skips remote version checks for local builds", async () => {
    const fetchLatestBuild = vi.fn();
    const controller = createRuntimeAssetHealthController({
      runningBuild: createBuild({ channel: "local" }),
      fetchLatestBuild,
    });

    await controller.check({ reason: "startup", force: true });

    expect(fetchLatestBuild).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBe("current");
  });
});

function createBuild(overrides: Partial<AppBuildInfo> = {}): AppBuildInfo {
  return {
    name: "maple-timer",
    version: "0.1.0",
    commitSha: "commit",
    shortCommit: "commit",
    branch: "main",
    deploymentUrl: "https://maple-timer.com",
    buildTime: "2026-07-12T00:00:00.000Z",
    channel: "production",
    remoteRecognitionV1TestArm: false,
    ...overrides,
  };
}
