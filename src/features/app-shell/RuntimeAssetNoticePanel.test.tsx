import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeAssetHealthSnapshot } from "../../runtime/runtime-assets/runtimeAssetHealthController";
import { RuntimeAssetNoticePanel } from "./RuntimeAssetNoticePanel";

const runtimeHealthMock = vi.hoisted(() => ({
  snapshot: null as RuntimeAssetHealthSnapshot | null,
  listeners: new Set<() => void>(),
}));

vi.mock("../../platform/runtime-assets/browserRuntimeAssetHealth", () => ({
  runtimeAssetHealthController: {
    getSnapshot: () => runtimeHealthMock.snapshot,
    subscribe: (listener: () => void) => {
      runtimeHealthMock.listeners.add(listener);
      return () => {
        runtimeHealthMock.listeners.delete(listener);
      };
    },
  },
}));

describe("RuntimeAssetNoticePanel", () => {
  beforeEach(() => {
    runtimeHealthMock.snapshot = createSnapshot("current");
  });

  afterEach(() => {
    cleanup();
    runtimeHealthMock.listeners.clear();
  });

  it("stays hidden while the running build is current", () => {
    render(<RuntimeAssetNoticePanel />);

    expect(screen.queryByLabelText("새 버전 안내")).not.toBeInTheDocument();
  });

  it("shows a non-dismissible refresh action for an available update", () => {
    runtimeHealthMock.snapshot = createSnapshot("update-available");

    render(<RuntimeAssetNoticePanel />);

    expect(screen.getByText("새 버전이 준비되었습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "새 버전 적용" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /닫기/ })).not.toBeInTheDocument();
  });

  it("uses the required copy after a runtime asset failure", () => {
    runtimeHealthMock.snapshot = createSnapshot("update-required");

    render(<RuntimeAssetNoticePanel />);

    expect(screen.getByText("새 버전 적용 필요")).toBeInTheDocument();
    expect(screen.getByText("감지 기능을 계속 사용하려면 새 버전을 적용해주세요.")).toBeInTheDocument();
  });
});

function createSnapshot(
  status: RuntimeAssetHealthSnapshot["status"],
): RuntimeAssetHealthSnapshot {
  return {
    status,
    runningBuild: {
      name: "maple-timer",
      version: "0.1.0",
      commitSha: "old",
      shortCommit: "old",
      branch: "main",
      deploymentUrl: "https://maple-timer.com",
      buildTime: "2026-07-12T00:00:00.000Z",
      channel: "production",
      remoteRecognitionV1TestArm: false,
    },
    latestBuild: null,
    lastFailure: null,
    lastCheckedAt: null,
    lastCheckReason: null,
    lastCheckError: null,
  };
}
